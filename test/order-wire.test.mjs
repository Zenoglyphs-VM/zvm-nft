import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {stripTypeScriptTypes} from 'node:module'
import {createContext, SourceTextModule, SyntheticModule} from 'node:vm'

// This file executes the real order module for integer/wire control flow only.
// Crypto, ABI calls, reads and wallet operations are unavailable. It does not
// qualify hashing, settlement, a browser or an actual wallet/provider.
const source = process.env.ZVM_A08_ORDER_SOURCE || new URL('../src/core/orders.ts', import.meta.url)
const name = process.env.ZVM_A08_MARKET_NAME || 'market'
const zero = '0x' + '0'.repeat(40)
const address = (n) => '0x' + n.toString(16).padStart(40, '0')
const base = () => ({trader: address(1), side: 0, collection: address(2), tokenId: '1', anyToken: false,
  amount: '1', paymentToken: zero, price: '17', listingTime: '1700000000', expirationTime: '1700000001', nonce: '0', salt: '1'})
const uint256 = ['tokenId', 'amount', 'price', 'nonce', 'salt']
const uint64 = ['listingTime', 'expirationTime']
const expected = {baselineFailures: [], baselinePasses: []}

function check(label, baselineFails, fn) {
  const full = name + ': ' + label
  expected[baselineFails ? 'baselineFailures' : 'baselinePasses'].push(full)
  test(full, fn)
}

async function fixture() {
  const calls = {api: [], prompts: []}
  const forbidden = () => { throw new Error('UNEXPECTED_CAPABILITY in wire-only fixture') }
  const info = {l2: {chainId: 7340470}, apps: {exchange: address(3), wrappedZnn: address(4)}}
  const wallet = {info, evm: {address: address(1), provider: {}}, address: address(1), provider: {}}
  const endpoint = {info, chainId: info.l2.chainId}
  const api = {submitOrders: async (inputs) => {
    calls.api.push(JSON.parse(JSON.stringify(inputs)))
    return {results: inputs.map(() => ({ok: true}))}
  }}
  const evm = {publicClient: forbidden, walletClient: () => ({signTypedData: async (request) => {
    calls.prompts.push(request)
    return '0x'
  }})}
  const modules = new Map([
    ['viem', {concat: forbidden, encodeFunctionData: forbidden, hashStruct: forbidden,
      keccak256: forbidden, parseAbi: (value) => value}],
    ['./api', {api}], ['./evm', evm], ['@zvm/web/evm', evm], ['./wallet', {wallet}],
    ['./endpoint', {endpoint}], ['./format', {ZERO: zero}],
  ])
  const context = createContext({Buffer, fetch: forbidden, console: {log: forbidden, error: forbidden}})
  const text = stripTypeScriptTypes(readFileSync(source, 'utf8'), {mode: 'strip'})
  const program = new SourceTextModule(text, {context})
  await program.link((specifier) => {
    assert.ok(modules.has(specifier), 'unexpected order-module import: ' + specifier)
    const exports = modules.get(specifier)
    return new SyntheticModule(Object.keys(exports), function () {
      for (const [key, value] of Object.entries(exports)) this.setExport(key, value)
    }, {context})
  })
  await program.evaluate({timeout: 5000})
  return {module: program.namespace, calls}
}

function refused(fn) {
  let error
  try { fn() } catch (caught) { error = caught }
  assert.ok(error, 'ambiguous or out-of-range wire value was accepted')
  assert.doesNotMatch(String(error), /UNEXPECTED_CAPABILITY/)
}

check('wire decodes an ordinary immutable order exactly', false, async () => {
  const f = await fixture(), input = Object.freeze(base()), before = JSON.stringify(input)
  const result = f.module.fromWire(input)
  for (const key of [...uint256, ...uint64]) assert.equal(result[key], BigInt(input[key]))
  assert.equal(result.anyToken, false)
  assert.equal(result.side, 0)
  assert.equal(JSON.stringify(input), before)
  assert.equal(f.calls.api.length + f.calls.prompts.length, 0)
})

check('wire preserves exact full-width decimal strings', false, async () => {
  const f = await fixture(), input = base(), max = (2n ** 256n - 1n).toString()
  for (const key of uint256) input[key] = max
  for (const key of uint64) input[key] = (2n ** 64n - 1n).toString()
  const result = f.module.fromWire(input)
  for (const key of uint256) assert.equal(result[key], BigInt(max))
  for (const key of uint64) assert.equal(result[key], 2n ** 64n - 1n)
})

check('wire accepts exact legacy safe numeric fields', false, async () => {
  const f = await fixture(), input = base()
  for (const key of [...uint256, ...uint64]) input[key] = Number(input[key])
  const result = f.module.fromWire(input)
  for (const key of [...uint256, ...uint64]) assert.equal(result[key], BigInt(input[key]))
})

check('wire submits ordinary exact values without changing the legacy API format', false, async () => {
  const f = await fixture(), input = f.module.fromWire(base())
  await f.module.submitOrders([{order: input, kind: 0, signature: '0x', proof: []}])
  assert.equal(f.calls.api.length, 1)
  const sent = f.calls.api[0][0].order
  for (const key of uint256) assert.equal(sent[key], base()[key])
  for (const key of uint64) assert.equal(sent[key], Number(base()[key]))
  assert.equal(f.calls.prompts.length, 0)
})

check('wire refuses a missing required integer', false, async () => {
  const f = await fixture(), input = base()
  delete input.nonce
  refused(() => f.module.fromWire(input))
})

check('wire refuses a fractional integer', false, async () => {
  const f = await fixture()
  refused(() => f.module.fromWire({...base(), tokenId: 1.5}))
})

for (const key of [...uint256, ...uint64]) {
  check('wire refuses a precision-lost JSON number in ' + key, true, async () => {
    const f = await fixture(), input = base()
    input[key] = JSON.parse('9007199254740993')
    assert.equal(input[key], 9007199254740992, 'fixture must exercise actual JSON number rounding')
    refused(() => f.module.fromWire(input))
  })
  check('wire refuses a negative unsigned value in ' + key, true, async () => {
    const f = await fixture()
    refused(() => f.module.fromWire({...base(), [key]: '-1'}))
  })
}

for (const key of uint256) check('wire refuses uint256 overflow in ' + key, true, async () => {
  const f = await fixture()
  refused(() => f.module.fromWire({...base(), [key]: (2n ** 256n).toString()}))
})

for (const key of uint64) check('wire refuses uint64 overflow in ' + key, true, async () => {
  const f = await fixture()
  refused(() => f.module.fromWire({...base(), [key]: (2n ** 64n).toString()}))
})

for (const value of ['false', null]) check('wire refuses non-boolean anyToken ' + String(value), true, async () => {
  const f = await fixture()
  refused(() => f.module.fromWire({...base(), anyToken: value}))
})

for (const value of [2, '0', null]) check('wire refuses invalid side ' + typeof value + ':' + String(value), true, async () => {
  const f = await fixture()
  refused(() => f.module.fromWire({...base(), side: value}))
})

for (const key of uint64) check('wire refuses lossy outbound timestamp ' + key + ' before API submission', true, async () => {
  const f = await fixture(), order = f.module.fromWire(base())
  order[key] = 9007199254740993n
  let error
  try { await f.module.submitOrders([{order, kind: 0, signature: '0x', proof: []}]) } catch (caught) { error = caught }
  assert.ok(error, 'the API received a rounded timestamp from an exact bigint')
  assert.doesNotMatch(String(error), /UNEXPECTED_CAPABILITY/)
  assert.equal(f.calls.api.length, 0)
})

check('wire empty tree matches the Go zero root', true, async () => {
  const f = await fixture(), result = f.module.orderTree([])
  assert.equal(result.root, '0x' + '0'.repeat(64))
  assert.equal(result.proofs.length, 0)
})

check('wire empty bulk input requests no wallet prompt', true, async () => {
  const f = await fixture(), result = await f.module.signOrders([])
  assert.equal(result.length, 0)
  assert.equal(f.calls.prompts.length + f.calls.api.length, 0)
})

console.log('A08-CASE-MANIFEST ' + JSON.stringify(expected))
