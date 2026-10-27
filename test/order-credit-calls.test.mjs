import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {stripTypeScriptTypes} from 'node:module'
import {createContext, SourceTextModule, SyntheticModule} from 'node:vm'
import {concat, decodeFunctionData, encodeFunctionData, hashStruct, keccak256, parseAbi, stringToHex} from 'viem'

const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url)))
const installed = JSON.parse(readFileSync(new URL('../node_modules/viem/package.json', import.meta.url)))
assert.equal(installed.version, lock.packages['node_modules/viem'].version)
const source = readFileSync(new URL('../src/core/orders.ts', import.meta.url), 'utf8')
const callsSource = readFileSync(new URL('../src/core/credit-calls.ts', import.meta.url), 'utf8')
const owner = '0x' + '1'.repeat(40), exchange = '0x' + '2'.repeat(40)
const forbidden = () => {throw new Error('Unexpected wallet RPC or API operation')}
async function fixture() {
  const info = {l2: {chainId: 7340470}, apps: {exchange}}
  const context = createContext({console, fetch: forbidden})
  const dependencies = new Map([
    ['viem', {concat, encodeFunctionData, hashStruct, keccak256, parseAbi, stringToHex}],
    ['./wallet', {wallet: {info, evm: {address: owner, provider: {}}, address: owner}}],
    ['./api', {api: {submitOrders: forbidden, order: forbidden}}],
    ['./evm', {publicClient: forbidden, walletClient: forbidden}],
    ['@zvm/web/evm', {publicClient: forbidden, walletClient: forbidden}],
    ['./endpoint', {endpoint: {info, chainId: 7340470}}], ['./format', {ZERO: '0x' + '0'.repeat(40)}],
  ])
  const link = name => {
    assert.ok(dependencies.has(name), 'Unexpected credit codec dependency: ' + name)
    const values = dependencies.get(name)
    return new SyntheticModule(Object.keys(values), function () {
      for (const [key, value] of Object.entries(values)) this.setExport(key, value)
    }, {context})
  }
  const orders = new SourceTextModule(stripTypeScriptTypes(source, {mode: 'strip'}), {context})
  await orders.link(link); await orders.evaluate({timeout: 5000})
  const calls = new SourceTextModule(stripTypeScriptTypes(callsSource, {mode: 'strip'}), {context})
  await calls.link(name => name === './orders' ? orders : link(name)); await calls.evaluate({timeout: 5000})
  return {abi: orders.namespace.exchangeAbi, calls: calls.namespace}
}
test('credit read calldata identifies the exact requested owner in the actual exchange ABI', async () => {
  const f = await fixture(), data = f.calls.creditReadData(owner)
  const result = decodeFunctionData({abi: f.abi, data})
  assert.equal(result.functionName, 'credits'); assert.deepEqual(result.args, [owner])
  assert.equal(data, keccak256(stringToHex('credits(address)')).slice(0, 10) + owner.slice(2).padStart(64, '0'))
})
test('withdrawal calldata calls the existing all-credit function with no alternate recipient', async () => {
  const f = await fixture(), data = f.calls.creditWithdrawData()
  const result = decodeFunctionData({abi: f.abi, data})
  assert.equal(result.functionName, 'withdrawCredits'); assert.deepEqual(result.args ?? [], [])
  assert.equal(data, keccak256(stringToHex('withdrawCredits()')).slice(0, 10)); assert.equal(data.length, 10)
})
test('invalid credit owner bytes are refused by the locked SDK', async () => {
  const f = await fixture(); assert.throws(() => f.calls.creditReadData('0x1'))
})
console.log('CREDIT-CALLS-RUNTIME ' + JSON.stringify({node: process.version, SDKVersion: installed.version,
  sourceSha256: createHash('sha256').update(source).digest('hex'),
  creditCallsSha256: createHash('sha256').update(callsSource).digest('hex'),
  actualLockedSDKAndExchangeABI: true, actualWalletOrEVMExecuted: false}))
