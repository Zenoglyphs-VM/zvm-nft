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
  await program.link(name => {throw new Error('Unexpected runtime dependency: ' + name)})
  await program.evaluate({timeout: 5000})
  return program.namespace
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
