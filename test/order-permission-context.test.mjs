import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {stripTypeScriptTypes} from 'node:module'
import {createContext, SourceTextModule, SyntheticModule} from 'node:vm'

// Execute the actual transaction runner with explicit synthetic read/wallet
// capabilities. These controls qualify preparation fencing, not settlement.
const source = new URL('../src/core/lanes.ts', import.meta.url)
const owner = '0x' + '1'.repeat(40)
const operator = '0x' + '2'.repeat(40)
const hash = '0x' + '3'.repeat(64)
function deferred() {
  let resolve
  const promise = new Promise(done => {resolve = done})
  return {promise, resolve}
}
async function fixture(status = 'success', receiptError = null) {
  const started = deferred(), release = deferred()
  const counts = {estimate: 0, fees: 0, send: 0, receipt: 0}
  const receipt = {status, transactionHash: hash, from: owner, to: operator, logs: []}
  const client = {
    estimateGas: async () => {counts.estimate++; started.resolve(); await release.promise; return 21000n},
    waitForTransactionReceipt: async () => {counts.receipt++; if (receiptError) throw receiptError; return receipt},
  }
  const evm = {publicClient: () => client,
    estimateFees: async () => {counts.fees++; return {maxFeePerGas: 200n, maxPriorityFeePerGas: 100n}},
    walletClient: () => ({sendTransaction: async () => {counts.send++; return hash}})}
  const wallet = {info: {l2: {chainId: 7340470}}, evm: {address: owner, provider: {}}, address: owner, provider: {}}
  const modules = new Map([
    ['./evm', evm], ['@zvm/web/evm', evm], ['./wallet', {wallet}],
    ['./endpoint', {endpoint: {chainId: 7340470}}], ['vue', {reactive: value => value}],
  ])
  const context = createContext({console})
  const program = new SourceTextModule(stripTypeScriptTypes(readFileSync(source, 'utf8'), {mode: 'strip'}), {context})
  await program.link(specifier => {
    assert.ok(modules.has(specifier), 'unexpected transaction-runner import: ' + specifier)
    const exports = modules.get(specifier)
    return new SyntheticModule(Object.keys(exports), function () {
      for (const [key, value] of Object.entries(exports)) this.setExport(key, value)
    }, {context})
  })
  await program.evaluate({timeout: 5000})
  return {run: program.namespace.runCalls, started, release, counts, receipt}
}
const call = guard => ({to: operator, value: 0n, data: '0x', gas: 70000n, label: 'Remove fixture permission', guard})

test('permission context refusal precedes estimation and any wallet request', async () => {
  const f = await fixture()
  f.release.resolve()
  const steps = await f.run([call(() => {throw new Error('Account changed')})], () => {})
  assert.equal(steps[0].state, 'failed')
  assert.match(steps[0].detail, /Account changed/)
  assert.deepEqual(f.counts, {estimate: 0, fees: 0, send: 0, receipt: 0})
})

test('permission context change during asynchronous estimation prevents submission', async () => {
  const f = await fixture()
  let valid = true
  const result = f.run([call(() => {if (!valid) throw new Error('Network changed')})], () => {})
  await f.started.promise
  valid = false
  f.release.resolve()
  const steps = await result
  assert.equal(steps[0].state, 'failed')
  assert.match(steps[0].detail, /Network changed/)
  assert.deepEqual(f.counts, {estimate: 1, fees: 1, send: 0, receipt: 0})
})

test('existing calls without a context guard still wait for their receipt', async () => {
  const f = await fixture()
  const states = []
  const result = f.run([call(undefined)], steps => states.push(steps[0].state))
  await f.started.promise
  f.release.resolve()
  const steps = await result
  assert.equal(steps[0].state, 'done')
  assert.strictEqual(steps[0].receipt, f.receipt)
  assert.equal(steps[0].receipt.transactionHash, hash)
  assert.equal(f.counts.send, 1)
  assert.equal(f.counts.receipt, 1)
  assert.ok(states.includes('published'))
  assert.equal(states.at(-1), 'done')
})

for (const [name, status, error] of [
  ['a reverted transaction', 'reverted', null],
  ['an unavailable receipt', 'success', new Error('Receipt unavailable')],
]) {
  test(name + ' cannot supply a successful checkout receipt', async () => {
    const f = await fixture(status, error)
    f.release.resolve()
    const steps = await f.run([call(undefined)], () => {})
    assert.equal(steps[0].state, 'failed')
    assert.equal(steps[0].receipt, undefined)
    assert.equal(f.counts.send, 1)
    assert.equal(f.counts.receipt, 1)
  })
}
