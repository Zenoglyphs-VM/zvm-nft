import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {stripTypeScriptTypes} from 'node:module'
import {createContext, SourceTextModule} from 'node:vm'

// Execute the shipped model with explicit synthetic RPC, storage and wallet
// capabilities. This is recovery/control evidence, not settlement evidence.
const owner = '0x' + '1'.repeat(40), exchange = '0x' + '2'.repeat(40)
const H = c => '0x' + c.repeat(64)
const hash = H('3'), genesis = H('a'), endpointHash = H('b')
const data = '0x12345678', amount = 250000000000000000n
const deferred = () => {let resolve; const promise = new Promise(done => {resolve = done}); return {promise, resolve}}
const rawBlock = (number, hash) => ({number: '0x' + number.toString(16), hash})
async function model() {
  const context = createContext({AbortController, setTimeout, clearTimeout, console})
  const code = stripTypeScriptTypes(readFileSync(new URL('../src/core/credits.ts', import.meta.url), 'utf8'), {mode: 'strip'})
  const program = new SourceTextModule(code, {context})
  const wallet = new SourceTextModule(stripTypeScriptTypes(readFileSync(new URL('../src/core/credit-wallet.ts', import.meta.url), 'utf8'), {mode: 'strip'}), {context})
  await program.link(name => {if (name === './credit-wallet') return wallet; throw new Error('Unexpected runtime dependency: ' + name)})
  await program.evaluate({timeout: 5000})
  return {...program.namespace, ...wallet.namespace}
}
async function fixture(t, shared = {}) {
  const api = await model(), records = shared.records ?? new Map(), locks = shared.locks ?? new Set()
  const state = {credit: amount, nonce: 1n, height: 5n, hash: H('5'), genesis,
    mode: 'success', failSet: false, failGet: false, sendError: null, onRead: null, walletGate: null, receiptGate: null,
    prompts: 0, requests: [], receipts: new Map(), transactions: new Map(), blocks: new Map([[0n, genesis], [5n, H('5')]]), id: 0}
  const ctx = {chainId: 7340470, owner, exchange, endpointHash, rpc: async (method, params, read) => {
    state.requests.push({method, params})
    assert.ok(read.signal)
    switch (method) {
      case 'eth_chainId': return '0x' + ctx.chainId.toString(16)
      case 'eth_getBlockByNumber': {
        const n = params[0] === 'latest' ? state.height : BigInt(params[0])
        const h = n === 0n ? state.genesis : state.blocks.get(n)
        return h ? rawBlock(n, h) : null
      }
      case 'eth_call': {
        assert.equal(params[0].to, exchange)
        assert.equal(params[1].requireCanonical, true)
        assert.equal(params[1].blockHash, state.hash)
        if (state.onRead) {const override = await state.onRead(); if (override !== undefined) return override}
        return '0x' + state.credit.toString(16).padStart(64, '0')
      }
      case 'eth_getTransactionCount': return '0x' + state.nonce.toString(16)
      case 'eth_getTransactionReceipt': return state.receipts.get(params[0]) ?? null
      case 'eth_getTransactionByHash': return state.transactions.get(params[0]) ?? null
      default: throw new Error('Undeclared RPC: ' + method)
    }
  }}
  const storage = {getItem(key) {if (state.failGet) throw new Error('Storage unavailable'); return records.get(key) ?? null},
    setItem(key, value) {if (state.failSet) throw new Error('Storage full'); records.set(key, value)}}
  const finish = (status = '0x1', credit = 0n) => {
    state.height = 6n; state.hash = H('6'); state.blocks.set(6n, state.hash)
    state.nonce = 2n; state.credit = credit
    state.receipts.set(hash, {transactionHash: hash, blockNumber: '0x6', blockHash: state.hash, status})
    state.transactions.set(hash, {hash, from: owner, to: exchange, input: data, value: '0x0', nonce: '0x1', chainId: '0x' + ctx.chainId.toString(16)})
  }
  const views = []
  const capabilities = {storage, exclusive: async (key, action) => {
    if (locks.has(key)) throw new Error('Already held')
    locks.add(key)
    try {await action()} finally {locks.delete(key)}
  }, canSend: () => true, readData: () => '0xabcdef00', withdrawData: data,
    id: () => 'withdraw-' + (++state.id), changed: view => views.push(view), send: async call => {
      let requested = false
      try {
        call.guard(); call.onRequest(); call.guard(); requested = true; state.prompts++
        if (state.walletGate) await state.walletGate.promise
        if (state.mode === 'reject') throw Object.assign(new Error('Rejected'), {code: 4001})
        if (state.mode === 'unknown') throw new Error('Transport ended without a hash')
        if (state.mode === 'before-send') throw state.sendError
        if (state.mode === 'save-failure') state.failSet = true
        call.onSubmitted(hash)
        if (state.receiptGate) await state.receiptGate.promise
        if (state.mode === 'receipt-rejected') throw Object.assign(new Error('Receipt rejected'), {code: 4001})
        if (state.mode === 'pending') return
        if (state.mode === 'reverted') finish('0x0', amount)
        else if (state.mode === 'inner-failed') finish('0x1', amount)
        else finish()
      } catch (error) {try {call.onFailed(error, requested)} catch { /* runner retains the original failure */ }}
    }}
  const controller = new api.CreditController(capabilities)
  t.after(() => {state.walletGate?.resolve(); state.receiptGate?.resolve(); controller.dispose()})
  controller.setContext(ctx)
  await controller.refresh()
  const key = api.creditJournalKey(ctx)
  const saved = () => JSON.parse(records.get(key) ?? '{"schema":1,"records":[]}').records
  return {api, controller, state, ctx, key, records, locks, capabilities, storage, views, finish, saved,
    refresh: () => controller.refresh()}
}

test('exact uint256 credit is read at a canonical hash and never rounded', async t => {
  const f = await fixture(t)
  f.state.credit = (1n << 256n) - 1n
  await f.refresh()
  assert.equal(f.controller.snapshot().amount, f.state.credit)
  assert.equal(f.controller.snapshot().canWithdraw, true)
  assert.equal(f.state.prompts, 0)
})
test('zero credit never opens a wallet', async t => {
  const f = await fixture(t); f.state.credit = 0n; await f.refresh(); await f.controller.withdraw()
  assert.equal(f.controller.snapshot().amount, 0n); assert.equal(f.state.prompts, 0)
})
test('unavailable credit is unknown rather than zero', async t => {
  const f = await fixture(t); f.state.onRead = () => {throw new Error('RPC unavailable')}; await f.refresh()
  assert.equal(f.controller.snapshot().amount, null); assert.equal(f.controller.snapshot().canWithdraw, false)
})
test('a changed canonical read is refused before withdrawal', async t => {
  const f = await fixture(t)
  f.state.onRead = () => {f.state.blocks.set(5n, H('c'))}
  await f.refresh(); await f.controller.withdraw()
  assert.equal(f.controller.snapshot().amount, null); assert.equal(f.state.prompts, 0)
})
test('successful execution refreshes actual credit and retains the original call and hash', async t => {
  const f = await fixture(t); await f.controller.withdraw()
  const view = f.controller.snapshot()
  assert.equal(f.state.prompts, 1); assert.equal(view.amount, 0n); assert.equal(view.entries[0].state, 'executed')
  assert.equal(f.saved()[0].hash, hash); assert.equal(f.saved()[0].data, data); assert.equal(f.saved()[0].value, '0')
  assert.equal(f.saved()[0].endpointHash, endpointHash)
  assert.equal(JSON.stringify(f.saved()).includes('http'), false)
})
test('a successful outer wallet receipt never makes remaining credit disappear', async t => {
  const f = await fixture(t); f.state.mode = 'inner-failed'; await f.controller.withdraw()
  assert.equal(f.controller.snapshot().amount, amount)
  assert.equal(f.controller.snapshot().entries[0].state, 'executed')
  assert.match(f.controller.snapshot().note, /review the transaction/i)
})
test('a canonical reverted transaction preserves the balance and exact hash', async t => {
  const f = await fixture(t); f.state.mode = 'reverted'; await f.controller.withdraw()
  assert.equal(f.controller.snapshot().amount, amount); assert.equal(f.controller.snapshot().entries[0].state, 'reverted')
  assert.equal(f.saved()[0].hash, hash)
})
test('an unavailable receipt blocks a second request and survives reload', async t => {
  const f = await fixture(t); f.state.mode = 'pending'; await f.controller.withdraw(); await f.controller.withdraw()
  assert.equal(f.state.prompts, 1); assert.equal(f.controller.snapshot().entries[0].state, 'pending')
  const second = await fixture(t, {records: f.records, locks: f.locks})
  assert.equal(second.controller.snapshot().canWithdraw, false); await second.controller.withdraw(); assert.equal(second.state.prompts, 0)
})
test('loss of the wallet result before its hash retains the original unresolved intent', async t => {
  const f = await fixture(t); f.state.mode = 'unknown'; await f.controller.withdraw(); await f.controller.withdraw()
  assert.equal(f.state.prompts, 1); assert.equal(f.saved()[0].hash, null)
  assert.equal(f.controller.snapshot().entries[0].state, 'unknown'); assert.equal(f.controller.snapshot().canWithdraw, false)
})
test('an explicit wallet rejection removes only its own never-submitted intent', async t => {
  const f = await fixture(t); f.state.mode = 'reject'; await f.controller.withdraw()
  assert.equal(f.state.prompts, 1); assert.equal(f.saved().length, 0); assert.equal(f.controller.snapshot().canWithdraw, true)
})
test('storage refusal prevents the wallet prompt', async t => {
  const f = await fixture(t); f.state.failSet = true; await f.controller.withdraw()
  assert.equal(f.state.prompts, 0); assert.equal(f.saved().length, 0)
})
test('hash persistence failure keeps the exact hash visible and exportable', async t => {
  const f = await fixture(t); f.state.mode = 'save-failure'; await f.controller.withdraw()
  const view = f.controller.snapshot()
  assert.equal(f.state.prompts, 1); assert.equal(view.unsaved, true); assert.equal(view.canWithdraw, false)
  assert.equal(view.entries[0].record.hash, hash); assert.equal(JSON.parse(f.controller.exportRecord()).records[0].hash, hash)
  f.state.failSet = false; await f.controller.saveRecovery()
  assert.equal(f.saved()[0].hash, hash); assert.equal(f.controller.snapshot().unsaved, false); assert.equal(f.state.prompts, 1)
})
test('storage read failure after submission does not hide the in-memory recovery hash', async t => {
  const f = await fixture(t); f.state.mode = 'save-failure'; await f.controller.withdraw(); f.state.failGet = true; await f.refresh()
  assert.equal(f.controller.snapshot().entries[0].record.hash, hash)
  const exported = JSON.parse(f.controller.exportRecord()); assert.equal(exported.completeJournal, false); assert.equal(exported.records[0].hash, hash)
})
test('canonical replacement reopens uncertainty without signing again; restoration reuses the same hash', async t => {
  const f = await fixture(t); await f.controller.withdraw()
  f.state.blocks.set(6n, H('c')); f.state.hash = H('c'); f.state.credit = amount; f.state.receipts.delete(hash)
  await f.refresh(); assert.equal(f.controller.snapshot().entries[0].state, 'pending'); assert.equal(f.controller.snapshot().canWithdraw, false)
  await f.controller.withdraw(); assert.equal(f.state.prompts, 1)
  f.finish(); await f.refresh(); assert.equal(f.controller.snapshot().entries[0].state, 'executed'); assert.equal(f.saved()[0].hash, hash)
})
test('an unchanged canonical prefix reuses verified receipts rather than scanning history again', async t => {
  const f = await fixture(t); await f.controller.withdraw()
  const before = f.state.requests.filter(r => r.method === 'eth_getTransactionReceipt').length
  f.state.height = 7n; f.state.hash = H('7'); f.state.blocks.set(7n, f.state.hash); await f.refresh()
  assert.equal(f.state.requests.filter(r => r.method === 'eth_getTransactionReceipt').length, before)
})
test('late credit responses from an old account cannot publish into its replacement', async t => {
  const f = await fixture(t), started = deferred(), release = deferred()
  f.state.onRead = async () => {started.resolve(); await release.promise}
  const old = f.refresh(); await started.promise
  f.controller.setContext(null); release.resolve(); await old
  assert.equal(f.controller.snapshot().amount, null); assert.equal(f.controller.snapshot().canWithdraw, false)
})
test('a hash arriving after an account change stays with its original account record', async t => {
  const f = await fixture(t); f.state.walletGate = deferred()
  const pending = f.controller.withdraw()
  while (f.state.prompts === 0) await new Promise(done => setImmediate(done))
  f.controller.setContext(null); f.state.walletGate.resolve(); await pending
  assert.equal(f.saved()[0].owner, owner); assert.equal(f.saved()[0].hash, hash); assert.equal(f.controller.snapshot().amount, null)
})
test('two cooperating pages share the exclusive request and pending journal', async t => {
  const shared = {records: new Map(), locks: new Set()}, first = await fixture(t, shared), second = await fixture(t, shared)
  first.state.walletGate = deferred(); first.state.mode = 'unknown'
  const pending = first.controller.withdraw()
  while (first.state.prompts === 0) await new Promise(done => setImmediate(done))
  await second.controller.withdraw(); assert.equal(second.state.prompts, 0)
  first.state.walletGate.resolve(); await pending
  await second.refresh(); assert.equal(second.controller.snapshot().canWithdraw, false)
})
test('manual recovery checks the exact original call and never broadcasts', async t => {
  const f = await fixture(t); f.state.mode = 'unknown'; await f.controller.withdraw(); const id = f.saved()[0].id
  f.finish(); await f.controller.recoverHash(id, hash)
  assert.equal(f.saved()[0].hash, hash); assert.equal(f.saved()[0].source, 'recovered'); assert.equal(f.state.prompts, 1)
  assert.equal(f.controller.snapshot().entries[0].state, 'executed')
})
for (const [field, replacement] of [['from', exchange], ['to', owner], ['input', '0x87654321'], ['value', '0x1'], ['nonce', '0x0'], ['chainId', '0x1']]) {
  test('manual recovery refuses a different ' + field, async t => {
    const f = await fixture(t); f.state.mode = 'unknown'; await f.controller.withdraw(); const id = f.saved()[0].id
    f.finish(); f.state.transactions.get(hash)[field] = replacement
    await f.controller.recoverHash(id, hash)
    assert.equal(f.saved()[0].hash, null); assert.equal(f.state.prompts, 1); assert.equal(f.controller.snapshot().canWithdraw, false)
  })
}
test('a different genesis cannot retire the original unresolved request', async t => {
  const f = await fixture(t); f.state.mode = 'unknown'; await f.controller.withdraw(); f.state.genesis = H('f'); await f.refresh()
  assert.equal(f.controller.snapshot().entries[0].state, 'other-context'); assert.equal(f.controller.snapshot().canWithdraw, false)
})
for (const [name, raw] of [['malformed JSON', '{'], ['unknown schema', '{"schema":2,"records":[]}'], ['oversized data', ' '.repeat(65537)]]) {
  test(name + ' preserves the original value and refuses another wallet request', async t => {
    const f = await fixture(t); f.records.set(f.key, raw); await f.refresh(); await f.controller.withdraw()
    assert.equal(f.records.get(f.key), raw); assert.equal(f.controller.snapshot().amount, null); assert.equal(f.state.prompts, 0)
  })
}
test('provider rejection recognition is code-bound and finite', async t => {
  const f = await fixture(t)
  assert.equal(f.api.walletRejected({cause: {code: 4001}}), true)
  assert.equal(f.api.walletRejected({message: 'user rejected'}), false)
  const cycle = {}; cycle.cause = cycle; assert.equal(f.api.walletRejected(cycle), false)
})

test('a rejection code after a known hash never erases its original transaction', async t => {
  const f = await fixture(t); f.state.mode = 'receipt-rejected'; await f.controller.withdraw()
  assert.equal(f.saved()[0].hash, hash); assert.equal(f.controller.snapshot().canWithdraw, false)
})
test('a full bounded history is retained and never opens another request', async t => {
  const f = await fixture(t); await f.controller.withdraw()
  const base = f.saved()[0], rows = Array.from({length: f.api.CREDIT_HISTORY_LIMIT}, (_, i) => ({...base,
    id: 'history-' + i, hash: '0x' + (100 + i).toString(16).padStart(64, '0')}))
  for (const row of rows) f.state.receipts.set(row.hash, {transactionHash: row.hash, blockNumber: '0x6', blockHash: f.state.hash, status: '0x1'})
  f.records.set(f.key, JSON.stringify({schema: 1, records: rows})); f.state.credit = amount
  await f.refresh(); await f.controller.withdraw()
  assert.equal(f.controller.snapshot().entries.length, f.api.CREDIT_HISTORY_LIMIT)
  assert.equal(f.controller.snapshot().canWithdraw, false); assert.equal(f.state.prompts, 1)
  assert.equal(JSON.parse(f.controller.exportRecord()).records.length, rows.length)
})
test('a history change during asynchronous preparation precedes a wallet request', async t => {
  const original = await fixture(t); original.state.mode = 'unknown'; await original.controller.withdraw()
  const f = await fixture(t)
  f.state.onRead = () => {f.records.set(f.key, original.records.get(original.key))}
  await f.controller.withdraw()
  assert.equal(f.state.prompts, 0); assert.equal(f.controller.snapshot().entries[0].state, 'unknown')
})
test('a chain identifier change refuses a balance and a new request', async t => {
  const f = await fixture(t); f.ctx.chainId = 1; await f.refresh(); await f.controller.withdraw()
  assert.equal(f.controller.snapshot().amount, null); assert.equal(f.state.prompts, 0)
})
test('a malformed receipt hash cannot confirm a saved transaction', async t => {
  const f = await fixture(t); f.state.mode = 'pending'; await f.controller.withdraw(); f.finish()
  f.state.receipts.get(hash).transactionHash = [hash]
  await f.refresh(); assert.equal(f.controller.snapshot().amount, null); assert.equal(f.saved()[0].hash, hash)
})
test('a reconnect to the same visible account still rejects the prior read generation', async t => {
  const f = await fixture(t), started = deferred(), release = deferred()
  f.state.onRead = async () => {started.resolve(); await release.promise; return '0x' + 7500n.toString(16).padStart(64, '0')}
  const reading = f.refresh(); await started.promise
  f.controller.setContext(null); f.state.credit = 999n; f.state.onRead = null; f.controller.setContext(f.ctx)
  const first = f.views.length; release.resolve(); await reading; await f.refresh()
  assert.equal(f.controller.snapshot().amount, 999n)
  assert.equal(f.views.slice(first).some(view => view.amount === 7500n), false)
})
test('duplicate saved hashes cannot retire separate unresolved requests', async t => {
  const f = await fixture(t); f.state.mode = 'pending'; await f.controller.withdraw()
  const original = f.saved()[0], raw = JSON.stringify({schema: 1, records: [original, {...original, id: 'different'}]})
  f.records.set(f.key, raw); await f.refresh()
  assert.equal(f.controller.snapshot().amount, null); assert.equal(f.records.get(f.key), raw)
})
test('array-shaped origin hashes are refused instead of coerced', async t => {
  const f = await fixture(t); f.state.mode = 'pending'; await f.controller.withdraw()
  const original = f.saved()[0]; original.genesis = [original.genesis]
  const raw = JSON.stringify({schema: 1, records: [original]}); f.records.set(f.key, raw); await f.refresh()
  assert.equal(f.controller.snapshot().amount, null); assert.equal(f.records.get(f.key), raw)
})

test('the recovery record and wallet hash are visible while the receipt wait is still active', async t => {
  const f = await fixture(t); f.state.receiptGate = deferred()
  const sending = f.controller.withdraw()
  while (f.saved().at(-1)?.hash !== hash) await new Promise(done => setImmediate(done))
  assert.equal(f.controller.snapshot().busy, true); assert.equal(f.controller.snapshot().entries[0].record.hash, hash)
  assert.equal(JSON.parse(f.controller.exportRecord()).records[0].hash, hash)
  f.state.receiptGate.resolve(); await sending
})

// These wallet/provider controls use synthetic capabilities. Actual account,
// relayer and EVM qualification is recorded separately at its exact UI revision.
function installWallet(t, f, options = {}) {
  const s = {sends: 0, statuses: [], discoveries: [], result: null, statusError: options.statusError ?? null,
    sendError: options.sendError ?? null, capabilityError: options.capabilityError ?? null,
    capabilities: options.capabilities ?? {['0x' + f.ctx.chainId.toString(16)]: {atomic: {status: 'unsupported'}}},
    response: null, statusGate: null, onStatus: null, next: 0}
  const makeReceipt = (h = hash, index = '0x0') => {
    const r = f.state.receipts.get(h)
    Object.assign(r, {gasUsed: '0xa180', transactionIndex: index, logs: []})
    return {transactionHash: h, blockHash: r.blockHash, blockNumber: r.blockNumber, gasUsed: r.gasUsed, status: r.status, logs: []}
  }
  const makeResult = (id, status = 200, receipts = []) => ({version: '2.0.0', id,
    chainId: '0x' + f.ctx.chainId.toString(16), status, atomic: false, receipts})
  const wallet = {id: () => '0x' + (++s.next).toString(16).padStart(128, '0'), request: async ({method, params}) => {
    if (method === 'wallet_getCapabilities') {
      s.discoveries.push(params)
      if (s.capabilityError) throw s.capabilityError
      return s.capabilities
    }
    if (method === 'wallet_sendCalls') {
      const request = params[0]
      s.sends++
      const durable = saved().at(-1)
      assert.ok(durable, 'the request is durable before dispatch')
      assert.equal(JSON.stringify(durable.wallet.request), JSON.stringify(request))
      assert.equal(durable.hash, null)
      if (!options.pending) {
        f.finish('0x1', options.credit ?? 0n)
        s.result = makeResult(request.id, options.status ?? 200, [makeReceipt()])
      } else s.result = makeResult(request.id, 100)
      if (s.sendError) throw s.sendError
      return s.response ?? {id: request.id}
    }
    if (method === 'wallet_getCallsStatus') {
      s.statuses.push(params)
      const result = structuredClone(s.result)
      if (s.statusGate) await s.statusGate.promise
      if (s.statusError) throw s.statusError
      if (s.onStatus) return s.onStatus(params, result)
      return result
    }
    throw new Error('Unexpected wallet method: ' + method)
  }}
  f.capabilities.wallet = () => wallet
  const key = f.api.walletJournalKey(f.ctx)
  const saved = () => JSON.parse(f.records.get(key) ?? '{"schema":1,"records":[]}').records
  t.after(() => s.statusGate?.resolve())
  return {...f, w: s, walletKey: key, wallet, walletSaved: saved, makeResult, makeReceipt}
}
async function walletFixture(t, options = {}) {return installWallet(t, await fixture(t, options.shared), options)}

test('wallet call id and exact zero-value request are durable before the only dispatch', async t => {
  const f = await walletFixture(t)
  assert.equal(f.w.discoveries.length, 0, 'no fingerprinting during account reads')
  await f.controller.withdraw()
  const row = f.walletSaved()[0]
  assert.equal(f.w.sends, 1); assert.equal(f.state.prompts, 0)
  assert.equal(row.wallet.request.version, '2.0.0'); assert.equal(row.wallet.request.from, owner)
  assert.equal(row.wallet.request.calls.length, 1); assert.equal(row.wallet.request.calls[0].to, exchange)
  assert.equal(row.wallet.request.calls[0].data, data); assert.equal(row.wallet.request.calls[0].value, '0x0')
  assert.equal(row.wallet.request.atomicRequired, false); assert.match(row.wallet.request.id, /^0x[0-9a-f]{128}$/)
  assert.equal(JSON.stringify(f.w.discoveries), JSON.stringify([[owner, ['0x' + f.ctx.chainId.toString(16)]]]))
  assert.equal(f.controller.snapshot().entries[0].state, 'executed'); assert.equal(f.controller.snapshot().amount, 0n)
  assert.equal(row.wallet.results[0].receipts[0].transactionHash, hash)
})
test('lost send response recovers the saved id after reload without a second send or signature', async t => {
  const f = await walletFixture(t, {sendError: new Error('Response lost'), statusError: {code: 5730}})
  await f.controller.withdraw(); await f.controller.withdraw()
  const id = f.walletSaved()[0].wallet.request.id
  assert.equal(f.w.sends, 1); assert.equal(f.state.prompts, 0); assert.equal(f.walletSaved()[0].wallet.results.length, 0)
  assert.equal(f.controller.snapshot().canWithdraw, false)
  const reloaded = await fixture(t, {records: f.records, locks: f.locks})
  reloaded.finish()
  const g = installWallet(t, reloaded)
  g.w.result = g.makeResult(id, 200, [g.makeReceipt()])
  await g.refresh()
  assert.equal(g.w.sends, 0); assert.equal(g.state.prompts, 0)
  assert.equal(g.controller.snapshot().entries[0].state, 'executed')
  assert.ok(g.w.statuses.every(params => params.length === 1 && params[0] === id))
  assert.equal(g.walletSaved()[0].wallet.request.id, id)
})
test('wallet capabilities may fall back only before a send method was dispatched', async t => {
  const f = await walletFixture(t, {capabilityError: {code: -32601}})
  await f.controller.withdraw()
  assert.equal(f.state.prompts, 1); assert.equal(f.w.sends, 0); assert.equal(f.walletSaved().length, 0)
})
test('absence of this chain capability uses the legacy path before dispatch', async t => {
  const f = await walletFixture(t, {capabilities: {'0x1': {atomic: {status: 'supported'}}}})
  await f.controller.withdraw(); assert.equal(f.state.prompts, 1); assert.equal(f.w.sends, 0)
})
test('ambiguous capability failure does not open either sending path', async t => {
  const f = await walletFixture(t, {capabilityError: new Error('Disconnected')})
  await f.controller.withdraw()
  assert.equal(f.state.prompts, 0); assert.equal(f.w.sends, 0); assert.equal(f.walletSaved().length, 0)
})
test('storage refusal prevents wallet_sendCalls and preserves the legacy journal', async t => {
  const f = await walletFixture(t); f.state.failSet = true; await f.controller.withdraw()
  assert.equal(f.state.prompts, 0); assert.equal(f.w.sends, 0); assert.equal(f.walletSaved().length, 0)
  assert.equal(f.records.get(f.key), undefined)
})
test('a send response with a different id never changes the original recovery id', async t => {
  const f = await walletFixture(t, {statusError: {code: 5730}})
  f.w.response = {id: H('f')}; await f.controller.withdraw(); await f.controller.withdraw()
  const id = f.walletSaved()[0].wallet.request.id
  assert.notEqual(id, f.w.response.id); assert.equal(f.w.sends, 1); assert.equal(f.state.prompts, 0)
  assert.ok(f.w.statuses.every(params => params[0] === id)); assert.equal(f.controller.snapshot().canWithdraw, false)
  f.w.statusError = null; await f.refresh(); assert.equal(f.controller.snapshot().entries[0].state, 'executed')
})
for (const [field, value] of [['id', H('f')], ['version', '1.0'], ['chainId', '0x1'], ['atomic', 'true'], ['status', 201]]) {
  test('malformed wallet ' + field + ' remains unresolved even after a valid earlier receipt', async t => {
    const f = await walletFixture(t); await f.controller.withdraw()
    const original = structuredClone(f.w.result)
    f.w.result[field] = value; f.state.credit = amount; await f.refresh(); await f.controller.withdraw()
    assert.equal(f.controller.snapshot().entries[0].state, 'unknown'); assert.equal(f.controller.snapshot().canWithdraw, false)
    assert.equal(f.w.sends, 1); assert.equal(f.state.prompts, 0)
    assert.equal(f.walletSaved()[0].wallet.results.length, 1)
    f.w.result = original; await f.refresh(); assert.equal(f.controller.snapshot().entries[0].state, 'executed')
  })
}
test('a wallet-confirmed group stays pending when the actual node receipt is absent', async t => {
  const f = await walletFixture(t); await f.controller.withdraw(); f.state.receipts.delete(hash); f.state.credit = amount
  await f.refresh(); await f.controller.withdraw()
  assert.equal(f.controller.snapshot().entries[0].state, 'pending'); assert.equal(f.w.sends, 1)
})
test('canonical removal and restoration reuse the saved id, all hashes and original send', async t => {
  const f = await walletFixture(t); await f.controller.withdraw()
  const before = JSON.stringify(f.walletSaved()[0].wallet.request)
  f.state.blocks.set(6n, H('c')); f.state.hash = H('c'); f.state.credit = amount
  await f.refresh(); await f.controller.withdraw()
  assert.equal(f.controller.snapshot().entries[0].state, 'pending'); assert.equal(f.w.sends, 1)
  f.finish(); f.makeReceipt(); await f.refresh()
  assert.equal(f.controller.snapshot().entries[0].state, 'executed')
  assert.equal(JSON.stringify(f.walletSaved()[0].wallet.request), before); assert.equal(f.w.sends, 1)
})
test('all receipts in a non-atomic group must match canonical node data', async t => {
  const f = await walletFixture(t); await f.controller.withdraw()
  const second = H('4')
  f.state.receipts.set(second, {...f.state.receipts.get(hash), transactionHash: second, transactionIndex: '0x1'})
  f.w.result.receipts.push(f.makeReceipt(second, '0x1'))
  await f.refresh(); assert.equal(f.controller.snapshot().entries[0].state, 'executed')
  f.state.receipts.delete(second); f.state.credit = amount; await f.refresh(); await f.controller.withdraw()
  assert.equal(f.controller.snapshot().entries[0].state, 'pending'); assert.equal(f.w.sends, 1)
  assert.equal(f.walletSaved()[0].wallet.results.at(-1).receipts.length, 2)
})
test('a later response cannot silently drop an earlier wallet receipt hash', async t => {
  const f = await walletFixture(t); await f.controller.withdraw()
  const first = structuredClone(f.w.result)
  const second = H('4')
  f.state.receipts.set(second, {...f.state.receipts.get(hash), transactionHash: second, transactionIndex: '0x1'})
  f.w.result.receipts.push(f.makeReceipt(second, '0x1')); await f.refresh()
  f.w.result = first; f.state.credit = amount; await f.refresh(); await f.controller.withdraw()
  assert.equal(f.controller.snapshot().entries[0].state, 'unknown'); assert.equal(f.w.sends, 1)
  const history = f.walletSaved()[0].wallet.results
  assert.ok(history.some(result => result.receipts.some(receipt => receipt.transactionHash === second)))
})
test('wallet receipt order is checked against actual block and transaction positions', async t => {
  const f = await walletFixture(t); await f.controller.withdraw()
  const second = H('4')
  f.state.receipts.set(second, {...f.state.receipts.get(hash), transactionHash: second, transactionIndex: '0x1'})
  f.w.result.receipts.unshift(f.makeReceipt(second, '0x1')); await f.refresh()
  assert.equal(f.controller.snapshot().entries[0].state, 'unknown'); assert.equal(f.controller.snapshot().canWithdraw, false)
})
test('inner wallet failure is distinct from a successful outer bundle receipt', async t => {
  const f = await walletFixture(t, {status: 500, credit: amount}); await f.controller.withdraw()
  assert.equal(f.state.receipts.get(hash).status, '0x1')
  assert.equal(f.controller.snapshot().entries[0].state, 'reverted'); assert.equal(f.controller.snapshot().amount, amount)
  assert.equal(f.w.sends, 1)
})
test('partial wallet failure keeps the whole receipt group under review', async t => {
  const f = await walletFixture(t, {status: 600, credit: amount}); await f.controller.withdraw(); await f.controller.withdraw()
  assert.equal(f.controller.snapshot().entries[0].state, 'unknown'); assert.equal(f.w.sends, 1)
  assert.match(f.controller.snapshot().entries[0].note, /partial failure/i)
})
test('an offchain failure is retained as a wallet assertion and is never retried automatically', async t => {
  const f = await walletFixture(t, {pending: true}); await f.controller.withdraw()
  f.w.result.status = 400; await f.refresh()
  assert.equal(f.controller.snapshot().entries[0].state, 'not-submitted'); assert.equal(f.walletSaved().length, 1)
  assert.equal(f.w.sends, 1); assert.equal(f.controller.snapshot().canWithdraw, true)
})
test('a different genesis never queries or retires the original wallet request', async t => {
  const f = await walletFixture(t, {pending: true}); await f.controller.withdraw()
  const before = f.w.statuses.length; f.state.genesis = H('f'); await f.refresh()
  assert.equal(f.w.statuses.length, before); assert.equal(f.controller.snapshot().entries[0].state, 'other-context')
})
test('an unresolved legacy request fences wallet capability discovery and new dispatch', async t => {
  const original = await fixture(t); original.state.mode = 'unknown'; await original.controller.withdraw()
  const raw = original.records.get(original.key)
  const f = installWallet(t, original); await f.refresh(); await f.controller.withdraw()
  assert.equal(f.w.discoveries.length, 0); assert.equal(f.w.sends, 0); assert.equal(f.records.get(f.key), raw)
})
test('a terminal legacy record stays byte-for-byte unchanged when the new protocol is used', async t => {
  const original = await fixture(t); await original.controller.withdraw(); original.state.credit = amount
  const raw = original.records.get(original.key)
  const f = installWallet(t, original); await f.refresh(); await f.controller.withdraw()
  assert.equal(f.w.sends, 1); assert.equal(f.records.get(f.key), raw)
  assert.equal(f.controller.snapshot().entries.length, 2)
  const exported = JSON.parse(f.controller.exportRecord())
  assert.equal(exported.schema, 2); assert.equal(exported.legacy.records.length, 1); assert.equal(exported.walletCalls.records.length, 1)
})
test('new wallet receipt details survive storage failure and can be saved without resending', async t => {
  const f = await walletFixture(t)
  f.w.onStatus = (_params, result) => {f.state.failSet = true; return result}
  await f.controller.withdraw()
  assert.equal(f.controller.snapshot().unsaved, true); assert.equal(f.controller.snapshot().canWithdraw, false)
  assert.equal(JSON.parse(f.controller.exportRecord()).walletCalls.records[0].wallet.results[0].receipts[0].transactionHash, hash)
  f.state.failSet = false; f.w.onStatus = null; await f.controller.saveRecovery()
  assert.equal(f.controller.snapshot().unsaved, false); assert.equal(f.walletSaved()[0].wallet.results[0].receipts[0].transactionHash, hash)
  assert.equal(f.w.sends, 1)
})
test('a newly learned receipt is durable even if its current node proof is malformed', async t => {
  const f = await walletFixture(t)
  f.w.onStatus = (_params, result) => {f.state.receipts.get(hash).transactionIndex = null; return result}
  await f.controller.withdraw()
  assert.equal(f.walletSaved()[0].wallet.results[0].receipts[0].transactionHash, hash)
  assert.equal(f.controller.snapshot().amount, null); assert.equal(f.w.sends, 1)
})
for (const raw of ['{', '{"schema":2,"records":[]}', ' '.repeat(65537)]) {
  test('malformed wallet journal is retained and blocks both dispatch paths: ' + raw.slice(0, 24), async t => {
    const f = await walletFixture(t); f.records.set(f.walletKey, raw); await f.refresh(); await f.controller.withdraw()
    assert.equal(f.records.get(f.walletKey), raw); assert.equal(f.controller.snapshot().amount, null)
    assert.equal(f.w.sends, 0); assert.equal(f.state.prompts, 0)
  })
}
test('status expiration cannot clear an unresolved saved id or permit a replacement send', async t => {
  const f = await walletFixture(t, {pending: true}); await f.controller.withdraw()
  const raw = f.records.get(f.walletKey); f.w.statusError = {code: 5730}; await f.refresh(); await f.controller.withdraw()
  assert.equal(f.records.get(f.walletKey), raw); assert.equal(f.controller.snapshot().canWithdraw, false); assert.equal(f.w.sends, 1)
})
test('a full bounded wallet observation history is preserved without another status query', async t => {
  const f = await walletFixture(t, {pending: true}); await f.controller.withdraw()
  const row = f.walletSaved()[0], result = row.wallet.results[0]
  row.wallet.results = Array.from({length: f.api.WALLET_CALL_RESULTS}, (_, i) => ({...result, atomic: i % 2 === 0}))
  const raw = JSON.stringify({schema: 1, records: [row]}); f.records.set(f.walletKey, raw)
  const before = f.w.statuses.length; await f.refresh(); await f.controller.withdraw()
  assert.equal(f.records.get(f.walletKey), raw); assert.equal(f.w.statuses.length, before); assert.equal(f.w.sends, 1)
})
test('a read timeout never calls the provider again when its late promise resolves', async t => {
  const api = await model(), gate = deferred(); let calls = 0
  await assert.rejects(api.boundedWalletRequest({id: () => '', request: () => {calls++; return gate.promise}}, 'wallet_getCallsStatus', ['saved-id'], 2), /timed out/i)
  gate.resolve({id: 'late-id'}); await new Promise(done => setImmediate(done)); assert.equal(calls, 1)
})
test('an account generation change fences a late status response before any journal update', async t => {
  const f = await walletFixture(t, {pending: true}); await f.controller.withdraw()
  const raw = f.records.get(f.walletKey); f.w.statusGate = deferred()
  const before = f.w.statuses.length, reading = f.refresh()
  while (f.w.statuses.length === before) await new Promise(done => setImmediate(done))
  f.controller.setContext(null); f.w.statusGate.resolve(); await reading
  assert.equal(f.records.get(f.walletKey), raw); assert.equal(f.controller.snapshot().amount, null); assert.equal(f.w.sends, 1)
})

test('wallet recovery details remain a protocol-tagged partial export when storage reads fail', async t => {
  const f = await walletFixture(t)
  f.w.onStatus = (_params, result) => {f.state.failSet = true; return result}
  await f.controller.withdraw(); f.state.failGet = true; await f.refresh()
  const exported = JSON.parse(f.controller.exportRecord())
  assert.equal(exported.schema, 2); assert.equal(exported.completeJournal, false)
  assert.equal(exported.walletCalls.records[0].wallet.results[0].receipts[0].transactionHash, hash)
  assert.equal(exported.persistedWalletCallsRaw, null); assert.equal(f.w.sends, 1)
})
test('divergent saved and unsaved observation histories preserve both versions without overwriting', async t => {
  const f = await walletFixture(t); await f.controller.withdraw()
  const second = H('4'), third = H('7')
  f.state.receipts.set(second, {...f.state.receipts.get(hash), transactionHash: second, transactionIndex: '0x1'})
  f.w.result.receipts.push(f.makeReceipt(second, '0x1')); f.state.failSet = true; await f.refresh()
  assert.equal(f.controller.snapshot().unsaved, true)
  const stored = f.walletSaved()[0]
  stored.wallet.results.push({...stored.wallet.results[0], receipts: [...stored.wallet.results[0].receipts,
    {...stored.wallet.results[0].receipts[0], transactionHash: third}]})
  const raw = JSON.stringify({schema: 1, records: [stored]}); f.records.set(f.walletKey, raw); f.state.failSet = false
  await f.refresh(); await f.controller.saveRecovery()
  assert.equal(f.records.get(f.walletKey), raw); assert.equal(f.controller.snapshot().canWithdraw, false)
  const exported = JSON.parse(f.controller.exportRecord())
  assert.equal(exported.completeJournal, false); assert.equal(exported.persistedWalletCallsRaw, raw)
  assert.ok(JSON.stringify(exported.walletCalls).includes(second)); assert.ok(exported.persistedWalletCallsRaw.includes(third))
  assert.equal(f.w.sends, 1)
})
test('two pages cannot dispatch a second wallet request against the same unresolved journal', async t => {
  const shared = {records: new Map(), locks: new Set()}
  const first = await walletFixture(t, {shared, pending: true}), second = await walletFixture(t, {shared})
  await first.controller.withdraw(); await second.controller.withdraw()
  assert.equal(first.w.sends, 1); assert.equal(second.w.sends, 0); assert.equal(second.state.prompts, 0)
  assert.equal(second.w.discoveries.length, 0)
})

test('direct user rejection stays terminal when the wallet never retained a batch status', async t => {
  const f = await walletFixture(t, {pending: true, sendError: Object.assign(new Error('User rejected'), {code: 4001}), statusError: {code: 5730}})
  await f.controller.withdraw()
  assert.equal(f.w.sends, 1); assert.equal(f.state.prompts, 0)
  assert.equal(f.controller.snapshot().entries[0].state, 'not-submitted')
  assert.equal(f.controller.snapshot().canWithdraw, true)
  assert.equal(f.walletSaved().length, 1)
})

test('a rejected request survives reload without batch status and a new request needs another user action', async t => {
  const f = await walletFixture(t, {pending: true, sendError: Object.assign(new Error('Rejected'), {code: 4001}), statusError: {code: 5730}})
  await f.controller.withdraw(); const raw = f.records.get(f.walletKey), id = f.walletSaved()[0].wallet.request.id
  const g = installWallet(t, await fixture(t, {records: f.records, locks: f.locks}), {pending: true, statusError: {code: 5730}})
  g.state.id = 1; g.w.next = 1; await g.refresh(); await g.refresh()
  assert.equal(g.controller.snapshot().entries[0].state, 'not-submitted'); assert.equal(g.controller.snapshot().canWithdraw, true)
  assert.equal(g.w.sends, 0); assert.equal(g.records.get(g.walletKey), raw)
  await g.controller.withdraw()
  assert.equal(g.w.sends, 1); assert.equal(g.walletSaved().length, 2)
  assert.equal(g.walletSaved()[0].wallet.request.id, id); assert.notEqual(g.walletSaved()[1].wallet.request.id, id)
  assert.equal(JSON.stringify(g.walletSaved()[0]), JSON.stringify(f.walletSaved()[0]))
})
for (const error of [{cause: {code: 4001}}, {code: '4001'}, {code: 4900}, {message: 'User rejected request'}, 4001]) {
  test('ambiguous or nested rejection stays unresolved: ' + JSON.stringify(error), async t => {
    const f = await walletFixture(t, {pending: true, sendError: error, statusError: {code: 5730}})
    await f.controller.withdraw(); await f.controller.withdraw()
    assert.equal(f.w.sends, 1); assert.equal(f.controller.snapshot().entries[0].state, 'unknown')
    assert.equal(f.controller.snapshot().canWithdraw, false)
    assert.equal(f.walletSaved()[0].wallet.dispatchRejection, undefined)
  })
}
test('a status-query rejection cannot become a send-request rejection', async t => {
  const f = await walletFixture(t, {pending: true, statusError: {code: 4001}})
  await f.controller.withdraw(); await f.controller.withdraw()
  assert.equal(f.walletSaved()[0].wallet.dispatchRejection, undefined)
  assert.equal(f.controller.snapshot().entries[0].state, 'unknown'); assert.equal(f.w.sends, 1)
})
test('a receipt contradicting a direct rejection retains both facts and blocks another send', async t => {
  const f = await walletFixture(t, {credit: amount, sendError: Object.assign(new Error('Rejected'), {code: 4001})})
  await f.controller.withdraw(); await f.controller.withdraw()
  const row = f.walletSaved()[0]
  assert.equal(row.wallet.dispatchRejection.code, 4001); assert.equal(row.wallet.results[0].status, 200)
  assert.equal(row.wallet.results[0].receipts[0].transactionHash, hash)
  assert.equal(f.controller.snapshot().entries[0].state, 'unknown'); assert.equal(f.controller.snapshot().canWithdraw, false); assert.equal(f.w.sends, 1)
})
test('pending status contradicting rejection cannot silently retire the saved request', async t => {
  const f = await walletFixture(t, {pending: true, sendError: Object.assign(new Error('Rejected'), {code: 4001})})
  await f.controller.withdraw(); await f.controller.withdraw()
  assert.equal(f.walletSaved()[0].wallet.dispatchRejection.code, 4001)
  assert.equal(f.walletSaved()[0].wallet.results[0].status, 100)
  assert.equal(f.controller.snapshot().entries[0].state, 'unknown'); assert.equal(f.w.sends, 1)
})
test('the direct rejection annotation survives a later offchain wallet status', async t => {
  const f = await walletFixture(t, {pending: true, sendError: Object.assign(new Error('Rejected'), {code: 4001}), statusError: {code: 5730}})
  await f.controller.withdraw(); f.w.statusError = null; f.w.result.status = 400; await f.refresh()
  const row = f.walletSaved()[0]
  assert.equal(row.wallet.dispatchRejection.code, 4001); assert.equal(row.wallet.results[0].status, 400)
  assert.equal(f.controller.snapshot().entries[0].state, 'not-submitted'); assert.equal(f.w.sends, 1)
})
test('rejection persistence failure keeps the exact original id and annotation exportable', async t => {
  const f = await walletFixture(t, {pending: true, statusError: {code: 5730}})
  f.wallet.request = async ({method, params}) => {
    if (method === 'wallet_getCapabilities') return f.w.capabilities
    if (method === 'wallet_getCallsStatus') throw {code: 5730}
    assert.equal(method, 'wallet_sendCalls'); assert.equal(params[0].id, f.walletSaved()[0].wallet.request.id)
    f.w.sends++; f.state.failSet = true; throw Object.assign(new Error('Rejected'), {code: 4001})
  }
  await f.controller.withdraw(); const id = f.walletSaved()[0].wallet.request.id
  assert.equal(f.walletSaved()[0].wallet.dispatchRejection, undefined)
  assert.equal(f.controller.snapshot().unsaved, true); assert.equal(f.controller.snapshot().canWithdraw, false)
  const exported = JSON.parse(f.controller.exportRecord())
  assert.equal(exported.walletCalls.records[0].wallet.request.id, id)
  assert.equal(exported.walletCalls.records[0].wallet.dispatchRejection.code, 4001)
  f.state.failSet = false; await f.controller.saveRecovery()
  assert.equal(f.walletSaved()[0].wallet.dispatchRejection.code, 4001)
  assert.equal(f.controller.snapshot().unsaved, false); assert.equal(f.controller.snapshot().canWithdraw, true); assert.equal(f.w.sends, 1)
})
test('a late rejection is saved only under its original owner after context change', async t => {
  const f = await walletFixture(t, {pending: true, statusError: {code: 5730}}), gate = deferred();let entered = false
  f.wallet.request = async ({method}) => {
    if (method === 'wallet_getCapabilities') return f.w.capabilities
    if (method === 'wallet_getCallsStatus') throw {code: 5730}
    assert.equal(method, 'wallet_sendCalls'); f.w.sends++; entered = true; await gate.promise; throw {code: 4001}
  }
  t.after(() => gate.resolve())
  const operation = f.controller.withdraw()
  while (!entered) await new Promise(done => setImmediate(done))
  f.controller.setContext(null); gate.resolve(); await operation
  assert.equal(f.walletSaved()[0].owner, owner); assert.equal(f.walletSaved()[0].wallet.dispatchRejection.code, 4001)
  assert.equal(f.controller.snapshot().amount, null); assert.equal(f.controller.snapshot().canWithdraw, false)
})
test('old wallet journal bytes remain unchanged while being read without rejection metadata', async t => {
  const f = await walletFixture(t, {pending: true}); await f.controller.withdraw()
  const raw = f.records.get(f.walletKey); await f.refresh(); await f.refresh()
  assert.equal(f.records.get(f.walletKey), raw); assert.equal(f.walletSaved()[0].wallet.dispatchRejection, undefined)
})
for (const rejection of [null, {method: 'eth_sendTransaction', code: 4001}, {method: 'wallet_sendCalls', code: '4001'}, {method: 'wallet_sendCalls', code: 4001, extra: true}]) {
  test('invalid dispatch annotation is retained and refused: ' + JSON.stringify(rejection), async t => {
    const f = await walletFixture(t, {pending: true}); await f.controller.withdraw()
    const row = f.walletSaved()[0]; row.wallet.dispatchRejection = rejection
    const raw = JSON.stringify({schema: 1, records: [row]}); f.records.set(f.walletKey, raw); await f.refresh(); await f.controller.withdraw()
    assert.equal(f.records.get(f.walletKey), raw); assert.equal(f.controller.snapshot().amount, null); assert.equal(f.w.sends, 1)
  })
}
