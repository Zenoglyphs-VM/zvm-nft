import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {stripTypeScriptTypes} from 'node:module'
import {createContext, SourceTextModule, SyntheticModule} from 'node:vm'
import {concat, decodeFunctionData, encodeFunctionData, hashStruct, hashTypedData, keccak256, parseAbi} from 'viem'

// Execute the actual UI module with the installed, lockfile-selected viem.
// The checked-in Core submodule supplies the Go golden vectors; no second
// fixture or remote vector download is needed. Wallet/API/network calls are
// synthetic capabilities: no browser, signing key, RPC or settlement is used.
const source = new URL('../src/core/orders.ts', import.meta.url)
const vectorBytes = readFileSync(new URL('../zvm-core/vectors/vectors.json', import.meta.url))
const vectors = JSON.parse(vectorBytes).exchange
const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url)))
const installed = JSON.parse(readFileSync(new URL('../node_modules/viem/package.json', import.meta.url)))
assert.equal(installed.version, lock.packages['node_modules/viem'].version)
const zero = '0x' + '0'.repeat(40)
const signature = '0x112233'
const plain = (value) => JSON.parse(JSON.stringify(value, (_, v) => typeof v === 'bigint' ? v.toString() : v))

async function fixture() {
  const prompts = []
  const forbidden = () => { throw new Error('unexpected network, contract read or API call') }
  const info = {l2: {chainId: vectors.chainId}, apps: {exchange: vectors.exchange, wrappedZnn: zero}}
  const wallet = {info, evm: {address: vectors.orders[0].order.trader, provider: {}}}
  const endpoint = {info, chainId: vectors.chainId}
  const evm = {publicClient: forbidden, walletClient: () => ({signTypedData: async (request) => {
    prompts.push(request)
    return signature
  }})}
  const modules = new Map([
    ['viem', {concat, encodeFunctionData, hashStruct, keccak256, parseAbi}],
    ['./api', {api: {submitOrders: forbidden, order: forbidden}}],
    ['./evm', evm], ['@zvm/web/evm', evm], ['./wallet', {wallet}],
    ['./endpoint', {endpoint}], ['./format', {ZERO: zero}],
  ])
  const context = createContext({console, fetch: forbidden})
  const program = new SourceTextModule(stripTypeScriptTypes(readFileSync(source, 'utf8'), {mode: 'strip'}), {context})
  await program.link((specifier) => {
    assert.ok(modules.has(specifier), 'unexpected order-module dependency: ' + specifier)
    const exports = modules.get(specifier)
    return new SyntheticModule(Object.keys(exports), function () {
      for (const [key, value] of Object.entries(exports)) this.setExport(key, value)
    }, {context})
  })
  await program.evaluate({timeout: 5000})
  return {module: program.namespace, prompts, info, endpoint}
}

for (const [i, vector] of vectors.orders.entries()) {
  test('actual order hash matches Go golden order ' + i, async () => {
    const f = await fixture(), order = f.module.fromWire(vector.order)
    assert.equal(f.module.orderHash(order), vector.hash)
  })

  test('single wallet request matches Go EIP-712 digest ' + i, async () => {
    const f = await fixture(), order = f.module.fromWire(vector.order)
    const input = await f.module.signOrder(order)
    assert.equal(f.prompts.length, 1)
    assert.equal(f.prompts[0].primaryType, 'Order')
    assert.equal(hashTypedData(f.prompts[0]), vector.digest)
    assert.strictEqual(input.order, order)
    assert.equal(input.kind, f.module.KIND_SINGLE)
    assert.equal(input.signature, signature)
    assert.equal(input.proof.length, 0)
  })
}

test('three-leaf tree, odd carry and every proof match the Go golden tree', async () => {
  const f = await fixture(), leaves = [...vectors.bulk.leaves], before = [...leaves]
  const tree = f.module.orderTree(leaves)
  assert.equal(tree.root, vectors.bulk.root)
  assert.deepEqual(plain(tree.proofs), vectors.bulk.proofs)
  assert.deepEqual(leaves, before)
  for (let i = 0; i < leaves.length; i++) assert.equal(f.module.processProof(leaves[i], tree.proofs[i]), vectors.bulk.root)
})

test('bulk wallet request uses one prompt and the exact Go root digest', async () => {
  const f = await fixture(), orders = vectors.orders.map((v) => f.module.fromWire(v.order))
  const inputs = await f.module.signOrders(orders)
  assert.equal(f.prompts.length, 1)
  assert.equal(f.prompts[0].primaryType, 'OrderRoot')
  assert.equal(hashTypedData(f.prompts[0]), vectors.bulk.digest)
  assert.equal(inputs.length, orders.length)
  for (let i = 0; i < inputs.length; i++) {
    assert.strictEqual(inputs[i].order, orders[i])
    assert.equal(inputs[i].kind, f.module.KIND_BULK)
    assert.equal(inputs[i].signature, signature)
    assert.deepEqual(plain(inputs[i].proof), vectors.bulk.proofs[i])
  }
})

test('a one-element bulk request signs the single-order type', async () => {
  const f = await fixture(), order = f.module.fromWire(vectors.orders[0].order)
  const inputs = await f.module.signOrders([order])
  assert.equal(f.prompts.length, 1)
  assert.equal(inputs[0].kind, f.module.KIND_SINGLE)
  assert.equal(hashTypedData(f.prompts[0]), vectors.orders[0].digest)
})

test('every order field participates in the signed struct identity', async () => {
  const f = await fixture(), original = f.module.fromWire(vectors.orders[0].order)
  for (const key of Object.keys(original)) {
    const changed = {...original}
    if (typeof changed[key] === 'bigint') changed[key] += 1n
    else if (typeof changed[key] === 'boolean') changed[key] = !changed[key]
    else if (key === 'side') changed[key] = changed[key] === 0 ? 1 : 0
    else changed[key] = '0x' + 'f'.repeat(40)
    assert.notEqual(f.module.orderHash(changed), vectors.orders[0].hash, 'unsigned field: ' + key)
  }
})

test('a different connected chain changes the requested signature digest', async () => {
  const f = await fixture()
  f.info.l2.chainId++
  f.endpoint.chainId++
  await f.module.signOrder(f.module.fromWire(vectors.orders[0].order))
  assert.notEqual(hashTypedData(f.prompts[0]), vectors.orders[0].digest)
})

test('a different exchange changes the requested signature digest', async () => {
  const f = await fixture()
  f.info.apps.exchange = '0x' + 'a'.repeat(40)
  await f.module.signOrder(f.module.fromWire(vectors.orders[0].order))
  assert.notEqual(hashTypedData(f.prompts[0]), vectors.orders[0].digest)
})

test('a missing exchange prevents a wallet prompt', async () => {
  const f = await fixture()
  f.info.apps.exchange = null
  await assert.rejects(() => f.module.signOrder(f.module.fromWire(vectors.orders[0].order)))
  assert.equal(f.prompts.length, 0)
})

test('native buy call preserves the complete order and exact payment', async () => {
  const f = await fixture(), order = f.module.fromWire(vectors.orders[0].order)
  const input = {order, kind: f.module.KIND_SINGLE, signature, proof: []}
  const call = f.module.buyCall(vectors.exchange, input, 'Buy fixture')
  const decoded = decodeFunctionData({abi: f.module.exchangeAbi, data: call.data})
  assert.equal(call.to, vectors.exchange)
  assert.equal(call.value, order.price)
  assert.equal(decoded.functionName, 'buy')
  assert.equal(f.module.orderHash(decoded.args[0].order), vectors.orders[0].hash)
})

test('bulk buy call preserves order sequence, kind, signatures and proofs', async () => {
  const f = await fixture(), inputs = vectors.orders.map((v, i) => ({
    order: f.module.fromWire(v.order), kind: f.module.KIND_BULK, signature, proof: vectors.bulk.proofs[i],
  }))
  const total = inputs.filter((i) => i.order.paymentToken === zero).reduce((sum, i) => sum + i.order.price, 0n)
  const call = f.module.buyManyCall(vectors.exchange, inputs, total)
  const decoded = decodeFunctionData({abi: f.module.exchangeAbi, data: call.data})
  assert.equal(decoded.functionName, 'buyMany')
  assert.equal(call.value, total)
  assert.equal(decoded.args[0].length, inputs.length)
  for (let i = 0; i < inputs.length; i++) {
    assert.equal(f.module.orderHash(decoded.args[0][i].order), vectors.orders[i].hash)
    assert.equal(decoded.args[0][i].kind, f.module.KIND_BULK)
    assert.equal(decoded.args[0][i].signature, signature)
    assert.deepEqual(plain(decoded.args[0][i].proof), vectors.bulk.proofs[i])
  }
})

console.log('ORDER-RUNTIME-QUALIFICATION ' + JSON.stringify({
  node: process.version, viem: installed.version, lockedViem: lock.packages['node_modules/viem'].version,
  coreVectorsSha256: createHash('sha256').update(vectorBytes).digest('hex'),
  actualUIHashingAndABI: true, actualBrowserWalletGoOrSolidityExecution: false,
}))
