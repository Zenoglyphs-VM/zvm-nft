import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {stripTypeScriptTypes} from 'node:module'
import {createContext, SourceTextModule, SyntheticModule} from 'node:vm'
import {concat, decodeEventLog, encodeAbiParameters, encodeEventTopics, encodeFunctionData,
  formatUnits, hashStruct, keccak256, parseAbi, stringToHex} from 'viem'

// Execute the actual receipt and order modules with lockfile-selected viem.
// Event bytes use the exchange ABI. These controls exercise receipt handling;
// actual browser/provider/relayer and EVM execution have separate qualifications.
const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url)))
const installed = JSON.parse(readFileSync(new URL('../node_modules/viem/package.json', import.meta.url)))
assert.equal(installed.version, lock.packages['node_modules/viem'].version)
const orderSource = readFileSync(new URL('../src/core/orders.ts', import.meta.url), 'utf8')
const resultSource = readFileSync(new URL('../src/core/batch-result.ts', import.meta.url), 'utf8')
const vectors = JSON.parse(readFileSync(new URL('../zvm-core/vectors/vectors.json', import.meta.url))).exchange
const zero = '0x' + '0'.repeat(40), buyer = '0x' + '9'.repeat(40), token = '0x' + '8'.repeat(40)
const txHash = '0x' + '3'.repeat(64), quarter = 250_000_000_000_000_000n
const eventAbi = parseAbi([
  'event OrderFilled(bytes32 indexed orderHash, address indexed maker, address indexed taker, uint8 side, address collection, uint256 tokenId, address paymentToken, uint256 price, uint256 royalty, uint256 fee)',
])
const dataTypes = [{type: 'uint8'}, {type: 'address'}, {type: 'uint256'}, {type: 'address'},
  {type: 'uint256'}, {type: 'uint256'}, {type: 'uint256'}]
const plain = value => JSON.parse(JSON.stringify(value, (_, item) => typeof item === 'bigint' ? item.toString() : item))
const forbidden = () => {throw new Error('unexpected wallet, API, RPC or network capability')}

async function fixture() {
  const info = {l2: {chainId: vectors.chainId}, apps: {exchange: vectors.exchange, wrappedZnn: zero}}
  const wallet = {info, evm: {address: buyer, provider: {}}}
  const sdk = {concat, decodeEventLog, encodeFunctionData, formatUnits, hashStruct, keccak256, parseAbi, stringToHex}
  const dependencies = new Map([
    ['viem', sdk], ['./api', {api: {submitOrders: forbidden, order: forbidden}}],
    ['./evm', {publicClient: forbidden, walletClient: forbidden}],
    ['@zvm/web/evm', {publicClient: forbidden, walletClient: forbidden}],
    ['./wallet', {wallet}], ['./endpoint', {endpoint: {info, chainId: vectors.chainId}}],
    ['./format', {ZERO: zero}],
  ])
  const context = createContext({console, fetch: forbidden})
  const link = specifier => {
    assert.ok(dependencies.has(specifier), 'unexpected receipt module dependency: ' + specifier)
    const exports = dependencies.get(specifier)
    return new SyntheticModule(Object.keys(exports), function () {
      for (const [key, value] of Object.entries(exports)) this.setExport(key, value)
    }, {context})
  }
  const orders = new SourceTextModule(stripTypeScriptTypes(orderSource, {mode: 'strip'}), {context})
  await orders.link(link)
  await orders.evaluate({timeout: 5000})
  const result = new SourceTextModule(stripTypeScriptTypes(resultSource, {mode: 'strip'}), {context})
  await result.link(specifier => specifier === './orders' ? orders : link(specifier))
  await result.evaluate({timeout: 5000})
  const inputs = [1n, 2n].map(tokenId => ({
    order: {...orders.namespace.fromWire(vectors.orders[0].order), tokenId, amount: 1n, side: 0,
      anyToken: false, paymentToken: zero, price: quarter},
    kind: 0, signature: '0x112233', proof: [],
  }))
  const hash = input => orders.namespace.orderHash(input.order)
  function log(input, change = {}) {
    const args = {orderHash: hash(input), maker: input.order.trader, taker: buyer, side: 0,
      collection: input.order.collection, tokenId: input.order.tokenId, paymentToken: input.order.paymentToken,
      price: input.order.price, royalty: 0n, fee: 0n, ...change}
    return {address: vectors.exchange, removed: false, transactionHash: txHash,
      topics: encodeEventTopics({abi: eventAbi, eventName: 'OrderFilled', args}),
      data: encodeAbiParameters(dataTypes, [args.side, args.collection, args.tokenId,
        args.paymentToken, args.price, args.royalty, args.fee])}
  }
  const receipt = logs => ({status: 'success', from: buyer, to: vectors.exchange, transactionHash: txHash, logs})
  const read = (logs, sent = quarter * 2n, selected = inputs, change = {}) =>
    result.namespace.batchResult({...receipt(logs), ...change}, vectors.exchange, buyer, selected, sent)
  return {inputs, hash, log, read, message: result.namespace.batchMessage}
}

test('a full batch counts only exact exchange fill events and preserves the selected inputs', async () => {
  const f = await fixture(), before = plain(f.inputs)
  const value = f.read(f.inputs.map(input => f.log(input)))
  assert.deepEqual(plain(value), {requested: 2, bought: 2,
    purchasedHashes: f.inputs.map(f.hash), skippedHashes: [], unspentNative: '0'})
  assert.deepEqual(plain(f.inputs), before)
  assert.equal(f.message(value), 'Bought 2 of 2 items.')
})

test('a partial batch retains skipped listings and reports exact unused native payment', async () => {
  const f = await fixture(), value = f.read([f.log(f.inputs[1])])
  assert.equal(value.bought, 1)
  assert.deepEqual(plain(value.purchasedHashes), [f.hash(f.inputs[1])])
  assert.deepEqual(plain(value.skippedHashes), [f.hash(f.inputs[0])])
  assert.equal(value.unspentNative, quarter)
  assert.equal(f.message(value), 'Bought 1 of 2 items. 0.25 ZNN unspent (returned or recorded as exchange credit).')
})

test('a successful zero-fill batch reports no purchase and the whole unused payment', async () => {
  const f = await fixture(), value = f.read([])
  assert.equal(value.bought, 0)
  assert.deepEqual(plain(value.purchasedHashes), [])
  assert.deepEqual(plain(value.skippedHashes), f.inputs.map(f.hash))
  assert.equal(value.unspentNative, quarter * 2n)
  assert.equal(f.message(value), 'No items were bought. 0.5 ZNN unspent (returned or recorded as exchange credit).')
})

test('other contracts and other event types cannot inflate the purchase count', async () => {
  const f = await fixture(), foreign = {...f.log(f.inputs[0]), address: token}
  const unrelated = {...f.log(f.inputs[0]), topics: ['0x' + 'f'.repeat(64)]}
  const value = f.read([foreign, unrelated, f.log(f.inputs[1])])
  assert.equal(value.bought, 1)
  assert.deepEqual(plain(value.purchasedHashes), [f.hash(f.inputs[1])])
})

test('ERC-20 prices do not reduce the unused native payment in a mixed batch', async () => {
  const f = await fixture()
  f.inputs[0].order.paymentToken = token
  f.inputs[0].order.price = (1n << 200n) + 1n
  const value = f.read(f.inputs.map(input => f.log(input)), quarter)
  assert.equal(value.bought, 2)
  assert.equal(value.unspentNative, 0n)
})

test('large native prices and unused amounts retain every integer bit', async () => {
  const f = await fixture(), price = (1n << 200n) + 1n, unspent = (1n << 80n) + 1n
  f.inputs[0].order.price = price
  const value = f.read([f.log(f.inputs[0])], price + unspent)
  assert.equal(value.unspentNative, unspent)
  assert.match(f.message(value), new RegExp(formatUnits(unspent, 18).replace('.', '\\.')))
})

for (const [name, change] of [
  ['a different order hash', {orderHash: '0x' + 'f'.repeat(64)}],
  ['a different maker', {maker: buyer}],
  ['a different taker', {taker: token}],
  ['a buy-side event', {side: 1}],
  ['a different collection', {collection: token}],
  ['a different token', {tokenId: 77n}],
  ['a different currency', {paymentToken: token}],
  ['a different price', {price: quarter + 1n}],
  ['royalty and fees above the price', {royalty: quarter, fee: 1n}],
]) {
  test(name + ' prevents checkout reconciliation', async () => {
    const f = await fixture()
    assert.throws(() => f.read([f.log(f.inputs[0], change)]))
  })
}

test('duplicate fill logs cannot remove an extra cart entry', async () => {
  const f = await fixture(), log = f.log(f.inputs[0])
  assert.throws(() => f.read([log, log]))
})

test('removed or malformed fill logs cannot reconcile a checkout', async () => {
  const f = await fixture(), log = f.log(f.inputs[0])
  assert.throws(() => f.read([{...log, removed: true}]))
  assert.throws(() => f.read([{...log, data: '0x12'}]))
})

for (const [name, change] of [
  ['a reverted receipt', {status: 'reverted'}],
  ['a different transaction sender', {from: token}],
  ['a different transaction target', {to: token}],
]) {
  test(name + ' cannot confirm this checkout', async () => {
    const f = await fixture()
    assert.throws(() => f.read([f.log(f.inputs[0])], quarter * 2n, f.inputs, change))
  })
}

test('native spending above the submitted amount is refused', async () => {
  const f = await fixture()
  assert.throws(() => f.read([f.log(f.inputs[0])], quarter - 1n))
  assert.throws(() => f.read([], -1n))
})

test('duplicate, empty or buy-side selected inputs are refused', async () => {
  const f = await fixture()
  assert.throws(() => f.read([], quarter, []))
  assert.throws(() => f.read([], quarter, [f.inputs[0], f.inputs[0]]))
  f.inputs[0].order.side = 1
  assert.throws(() => f.read([]))
})

console.log('BATCH-RECEIPT-QUALIFICATION ' + JSON.stringify({
  node: process.version, viem: installed.version, lockedViem: lock.packages['node_modules/viem'].version,
  orderSourceSha256: createHash('sha256').update(orderSource).digest('hex'),
  receiptSourceSha256: createHash('sha256').update(resultSource).digest('hex'),
  actualUIHashingAndEventABI: true, actualBrowserRelayerOrEVMExecution: false,
}))
