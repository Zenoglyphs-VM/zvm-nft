import type {CreditRead, CreditRpc} from './credit-rpc'
import {walletJournalKey, readWalletJournal, walletRequest, supportsWalletCalls, walletMethodUnsupported,
  boundedWalletRequest, parseWalletResult, appendWalletResult, walletResultComplete, walletQuantity, sameWalletLog,
  directWalletRejection, mergeWalletEvidence,
  WALLET_CALL_JOURNAL_BYTES, WALLET_CALL_RESULTS, type CreditWallet, type WalletWithdrawalRecord} from './credit-wallet'

export const CREDIT_HISTORY_LIMIT = 32
export const CREDIT_JOURNAL_BYTES = 64 * 1024
const ADDRESS = /^0x[0-9a-fA-F]{40}$/
const HASH = /^0x[0-9a-fA-F]{64}$/
const DECIMAL = /^(0|[1-9][0-9]*)$/
const QUANTITY = /^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/
const equal = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()
const hex = (n: bigint) => '0x' + n.toString(16)

export interface CreditContext {
  chainId: number
  owner: string
  exchange: string
  endpointHash: string
  rpc: CreditRpc
}
export interface LegacyWithdrawalRecord {
  id: string
  chainId: number
  owner: string
  exchange: string
  endpointHash: string
  genesis: string
  head: string
  headHash: string
  nonce: string
  data: string
  value: '0'
  hash: string | null
  source: 'wallet' | 'recovered'
}
export type WithdrawalRecord = LegacyWithdrawalRecord | WalletWithdrawalRecord
export interface CreditCall {
  to: `0x${string}`
  data: `0x${string}`
  value: bigint
  gas: bigint
  label: string
  guard: () => void
  onRequest: () => void
  onSubmitted: (hash: string) => void
  onFailed: (error: unknown, requested: boolean) => void
}
export interface CreditEntry {
  record: WithdrawalRecord
  state: 'unknown' | 'pending' | 'executed' | 'reverted' | 'not-submitted' | 'other-context'
  note?: string
}
export interface CreditView {
  amount: bigint | null
  loading: boolean
  busy: boolean
  canWithdraw: boolean
  unsaved: boolean
  error: string
  note: string
  entries: CreditEntry[]
}
export interface CreditCapabilities {
  storage: Pick<Storage, 'getItem' | 'setItem'>
  exclusive: (key: string, action: () => Promise<void>) => Promise<void>
  canSend: (context: CreditContext) => boolean
  send: (call: CreditCall) => Promise<void>
  wallet?: (context: CreditContext) => CreditWallet | null
  readData: (owner: string) => string
  withdrawData: string
  id: () => string
  changed: (view: CreditView) => void
}
interface Block {number: bigint; hash: string}
interface Snapshot {amount: bigint; nonce: bigint; genesis: string; head: Block; entries: CreditEntry[]}
interface Proof {input: string; entry: CreditEntry}
class CreditFault extends Error {}

function quantity(value: unknown): bigint {
  if (typeof value !== 'string' || value.length > 66 || !QUANTITY.test(value)) throw new CreditFault('Credit RPC returned an invalid quantity.')
  return BigInt(value)
}
function block(value: unknown): Block {
  const v = value as Record<string, unknown> | null
  if (!v || typeof v.hash !== 'string' || !HASH.test(v.hash)) throw new CreditFault('The credit block is unavailable.')
  return {number: quantity(v.number), hash: v.hash as string}
}
function checkedContext(value: CreditContext): CreditContext {
  if (!Number.isSafeInteger(value.chainId) || value.chainId <= 0 || !ADDRESS.test(value.owner) ||
    !ADDRESS.test(value.exchange) || !HASH.test(value.endpointHash) || typeof value.rpc !== 'function')
    throw new CreditFault('The account or exchange context is unavailable.')
  return {...value, owner: value.owner.toLowerCase(), exchange: value.exchange.toLowerCase()}
}
export function creditJournalKey(context: Pick<CreditContext, 'chainId' | 'owner' | 'exchange'>): string {
  return 'zvm.exchange-credits.v1:' + context.chainId + ':' + context.exchange.toLowerCase() + ':' + context.owner.toLowerCase()
}
export function readCreditJournal(raw: string | null, context: CreditContext, data: string): LegacyWithdrawalRecord[] {
  if (raw === null) return []
  if (raw.length > CREDIT_JOURNAL_BYTES) throw new CreditFault('Saved withdrawal history exceeds its read limit. Keep it for review.')
  let parsed: any
  try {parsed = JSON.parse(raw)} catch {throw new CreditFault('Saved withdrawal history could not be read. Keep it for review.')}
  if (!parsed || parsed.schema !== 1 || Object.keys(parsed).sort().join(',') !== 'records,schema' ||
    !Array.isArray(parsed.records) || parsed.records.length > CREDIT_HISTORY_LIMIT)
    throw new CreditFault('Saved withdrawal history needs review before another withdrawal.')
  const ids = new Set<string>(), hashes = new Set<string>()
  return parsed.records.map((r: any) => {
    const keys = ['id','chainId','owner','exchange','endpointHash','genesis','head','headHash','nonce','data','value','hash','source'].sort().join(',')
    if (!r || Object.keys(r).sort().join(',') !== keys || typeof r.id !== 'string' || !/^[a-zA-Z0-9-]{1,64}$/.test(r.id) ||
      ids.has(r.id) || r.chainId !== context.chainId || r.owner !== context.owner.toLowerCase() || r.exchange !== context.exchange.toLowerCase() ||
      typeof r.endpointHash !== 'string' || !HASH.test(r.endpointHash) || typeof r.genesis !== 'string' || !HASH.test(r.genesis) || typeof r.headHash !== 'string' || !HASH.test(r.headHash) ||
      typeof r.head !== 'string' || !DECIMAL.test(r.head) || r.head.length > 78 ||
      typeof r.nonce !== 'string' || !DECIMAL.test(r.nonce) || r.nonce.length > 78 ||
      r.value !== '0' || r.data !== data || !['wallet','recovered'].includes(r.source) ||
      (r.hash !== null && (typeof r.hash !== 'string' || !HASH.test(r.hash) || hashes.has(r.hash.toLowerCase()))) ||
      (r.hash === null && r.source !== 'wallet')) throw new CreditFault('Saved withdrawal history needs review before another withdrawal.')
    ids.add(r.id)
    if (r.hash !== null) hashes.add(r.hash.toLowerCase())
    return {...r}
  })
}
export function walletRejected(error: unknown): boolean {
  const seen = new Set<unknown>()
  let value: any = error
  for (let i = 0; i < 8 && value && !seen.has(value); i++) {
    seen.add(value)
    if (value.code === 4001) return true
    value = value.cause
  }
  return false
}
const terminal = (entry: CreditEntry) => entry.state === 'executed' || entry.state === 'reverted' || entry.state === 'not-submitted'
const copyRecord = (row: WithdrawalRecord): WithdrawalRecord => JSON.parse(JSON.stringify(row))

export class CreditController {
  private context: CreditContext | null = null
  private generation = 0
  private busy = false
  private reading: Promise<void> | null = null
  private abort: AbortController | null = null
  private again = false
  private disposed = false
  private unsaved = new Map<string, WithdrawalRecord>()
  private cache: {key: string; genesis: string; head: Block; proofs: Map<string, Proof>} | null = null
  private value: CreditView = {amount: null, loading: false, busy: false, canWithdraw: false, unsaved: false, error: '', note: '', entries: []}
  private capabilities: CreditCapabilities

  constructor(capabilities: CreditCapabilities) {
    if (!/^0x[0-9a-fA-F]{8}$/.test(capabilities.withdrawData)) throw new Error('Exact withdrawal calldata is required.')
    this.capabilities = capabilities
  }
  snapshot(): CreditView {
    const ctx = this.context
    const unsaved = !!ctx && [...this.unsaved.values()].some(r => creditJournalKey(r) === creditJournalKey(ctx))
    const entries = this.value.entries.map(e => ({...e, record: copyRecord(e.record)}))
    if (ctx) for (const pending of this.unsaved.values()) {
      if (creditJournalKey(pending) !== creditJournalKey(ctx)) continue
      const entry = entries.find(e => e.record.id === pending.id)
      if (entry) {entry.record = copyRecord(pending); entry.state = 'pending'}
      else entries.push({record: copyRecord(pending), state: 'pending'})
    }
    return {...this.value, busy: this.busy, unsaved,
      canWithdraw: !!ctx && !this.busy && !this.value.loading && !this.value.error && !unsaved &&
        this.value.amount !== null && this.value.amount > 0n && this.value.entries.length < CREDIT_HISTORY_LIMIT && this.value.entries.every(terminal) && this.capabilities.canSend(ctx),
      entries}
  }
  private emit() {if (!this.disposed) this.capabilities.changed(this.snapshot())}
  setContext(value: CreditContext | null) {
    this.generation++
    this.abort?.abort()
    this.context = value ? checkedContext(value) : null
    this.cache = null
    this.value = {amount: null, loading: false, busy: this.busy, canWithdraw: false, unsaved: false, error: '', note: '', entries: []}
    this.emit()
    if (this.reading) this.again = true
    else void this.refresh()
  }
  dispose() {this.disposed = true; this.generation++; this.abort?.abort()}
  private guard(context: CreditContext, generation: number) {
    if (this.disposed || this.generation !== generation || this.context !== context)
      throw new CreditFault('The account or network changed. Review the credit again.')
  }
  private records(context: CreditContext): WithdrawalRecord[] {
    const rows: WithdrawalRecord[] = [...readCreditJournal(this.capabilities.storage.getItem(creditJournalKey(context)), context, this.capabilities.withdrawData),
      ...readWalletJournal(this.capabilities.storage.getItem(walletJournalKey(context)), context, this.capabilities.withdrawData)]
    if (rows.length > CREDIT_HISTORY_LIMIT || new Set(rows.map(row => row.id)).size !== rows.length)
      throw new CreditFault('Combined withdrawal history needs review before continuing.')
    for (const pending of this.unsaved.values()) {
      if (creditJournalKey(pending) !== creditJournalKey(context)) continue
      const row = rows.find(r => r.id === pending.id)
      if (!row || (row.hash !== null && row.hash !== pending.hash)) throw new CreditFault('The saved recovery record changed. Keep the original transaction hash.')
      if (row.source === 'wallet-calls' || pending.source === 'wallet-calls') {
        if (row.source !== 'wallet-calls' || pending.source !== 'wallet-calls' ||
          JSON.stringify(row.wallet.request) !== JSON.stringify(pending.wallet.request))
          throw new CreditFault('The original wallet call request changed. Keep its saved identifier.')
        try {Object.assign(row, mergeWalletEvidence(row, pending))}
        catch {throw new CreditFault('Saved and unsaved wallet observations diverged. Download both versions for review.')}
        continue
      }
      Object.assign(row, copyRecord(pending))
    }
    return rows
  }
  private write(context: CreditContext, rows: LegacyWithdrawalRecord[], expected: string | null) {
    const key = creditJournalKey(context)
    const raw = JSON.stringify({schema: 1, records: rows})
    readCreditJournal(raw, context, this.capabilities.withdrawData)
    if (raw.length > CREDIT_JOURNAL_BYTES || this.capabilities.storage.getItem(key) !== expected)
      throw new CreditFault('Saved withdrawal history changed. Review it before continuing.')
    this.capabilities.storage.setItem(key, raw)
    if (this.capabilities.storage.getItem(key) !== raw) throw new CreditFault('The withdrawal recovery record could not be verified.')
  }
  private writeWallet(context: CreditContext, rows: WalletWithdrawalRecord[], expected: string | null) {
    const key = walletJournalKey(context), raw = JSON.stringify({schema: 1, records: rows})
    readWalletJournal(raw, context, this.capabilities.withdrawData)
    if (raw.length > WALLET_CALL_JOURNAL_BYTES || this.capabilities.storage.getItem(key) !== expected)
      throw new CreditFault('Wallet recovery history changed or is full. Keep the original request identifier.')
    this.capabilities.storage.setItem(key, raw)
    if (this.capabilities.storage.getItem(key) !== raw) throw new CreditFault('The wallet recovery record could not be verified.')
  }
  private async selectWallet(context: CreditContext, generation: number): Promise<CreditWallet | null> {
    const wallet = this.capabilities.wallet?.(context)
    if (!wallet) return null
    try {
      const capabilities = await boundedWalletRequest(wallet, 'wallet_getCapabilities', [context.owner, [hex(BigInt(context.chainId))]])
      this.guard(context, generation)
      if (!this.capabilities.canSend(context)) throw new CreditFault('The connected wallet changed during preparation.')
      return supportsWalletCalls(capabilities, context.chainId) ? wallet : null
    } catch (error) {
      this.guard(context, generation)
      if (walletMethodUnsupported(error)) return null
      throw new CreditFault('Wallet capabilities could not be checked. Refresh before preparing another withdrawal.')
    }
  }
  private async sendWallet(context: CreditContext, generation: number, snapshot: Snapshot, base: LegacyWithdrawalRecord, wallet: CreditWallet) {
    this.guard(context, generation)
    if (!this.capabilities.canSend(context)) throw new CreditFault('The connected wallet changed before submission.')
    if (JSON.stringify(this.records(context)) !== JSON.stringify(snapshot.entries.map(entry => entry.record)))
      throw new CreditFault('Withdrawal history changed during wallet preparation.')
    const record: WalletWithdrawalRecord = {...base, source: 'wallet-calls', wallet: {
      request: walletRequest(context, base.data, wallet.id()), results: []}}
    const key = walletJournalKey(context), raw = this.capabilities.storage.getItem(key)
    const rows = readWalletJournal(raw, context, this.capabilities.withdrawData)
    this.writeWallet(context, [...rows, record], raw)
    this.value.entries = [...snapshot.entries, {record: copyRecord(record), state: 'unknown'}]
    this.emit()
    // The complete caller-generated id and exact request are durable before the
    // provider sees a send. Any response loss is resolved only by this same id.
    let response: any
    try {response = await boundedWalletRequest(wallet, 'wallet_sendCalls', [JSON.parse(JSON.stringify(record.wallet.request))], 60000)}
    catch (error) {
      if (directWalletRejection(error)) {
        try {this.saveDispatchRejection(context, record)}
        catch {throw new CreditFault('The wallet reported rejection, but its recovery details could not be saved. Download the record before leaving.')}
        throw new CreditFault('The wallet rejected this request. Its saved record is retained; no automatic retry was made.')
      }
      throw error
    }
    this.guard(context, generation)
    if (!response || typeof response !== 'object' || Array.isArray(response) || response.id !== record.wallet.request.id)
      throw new CreditFault('The wallet response did not identify the saved request. Review its status without sending again.')
    this.value.note = 'The wallet accepted this request identifier. Its status and canonical receipts are checked without sending it again.'
  }
  private saveDispatchRejection(context: CreditContext, original: WalletWithdrawalRecord) {
    const rejected: WalletWithdrawalRecord = {...original, wallet: {...original.wallet, dispatchRejection: {method: 'wallet_sendCalls', code: 4001}}}
    this.unsaved.set(original.id, copyRecord(rejected))
    // Retain the original request's response even after an account generation
    // changes. The immutable payload and journal key remain bound to its owner.
    const raw = this.capabilities.storage.getItem(walletJournalKey(context))
    const rows = readWalletJournal(raw, context, this.capabilities.withdrawData)
    const own = rows.find(row => row.id === original.id)
    if (!own) throw new CreditFault('The original wallet recovery record changed after rejection.')
    Object.assign(own, mergeWalletEvidence(own, rejected))
    this.unsaved.set(original.id, copyRecord(own))
    this.writeWallet(context, rows, raw)
    this.unsaved.delete(original.id)
  }
  private async inspectWallet(context: CreditContext, generation: number, original: WalletWithdrawalRecord, genesis: string, head: Block, read: CreditRead): Promise<CreditEntry> {
    if (!equal(original.genesis, genesis)) return {record: original, state: 'other-context'}
    let record = original, note = ''
    if (read.signal.aborted) throw new CreditFault('The credit read timed out. Refresh before reviewing the request.')
    const wallet = this.capabilities.canSend(context) && record.wallet.results.length < WALLET_CALL_RESULTS ? this.capabilities.wallet?.(context) : null
    if (wallet) {
      let response: unknown, received = false
      try {
        response = await boundedWalletRequest(wallet, 'wallet_getCallsStatus', [record.wallet.request.id])
        this.guard(context, generation)
        if (!this.capabilities.canSend(context)) throw new CreditFault('The wallet context changed during recovery.')
        received = true
      } catch {
        this.guard(context, generation)
        // Retained associated receipts or a direct dispatch rejection remain
        // evidence when a wallet forgets an id. An unknown id alone is unresolved.
        note = 'Current wallet status is unavailable. Retained receipts are checked; keep this original request identifier.'
        if ((!this.capabilities.canSend(context) || !record.wallet.results.length) && !record.wallet.dispatchRejection) return {record, state: 'unknown', note}
      }
      if (received) {
        try {
          record = appendWalletResult(record, parseWalletResult(response, record.wallet.request, context.chainId))
          if (JSON.stringify(record) !== JSON.stringify(original)) this.unsaved.set(record.id, copyRecord(record))
        } catch {
          return {record, state: 'unknown', note: 'The wallet returned conflicting or invalid recovery details. Keep the original request identifier.'}
        }
      }
    }
    if (read.signal.aborted) throw new CreditFault('The credit read timed out. Retain the wallet recovery details.')
    const latest = record.wallet.results[record.wallet.results.length - 1]
    if (record.wallet.dispatchRejection) {
      if (record.wallet.results.some(result => result.status !== 400 || result.receipts.length))
        return {record, state: 'unknown', note: 'Wallet status conflicts with its original rejection. Keep the request and every receipt for review.'}
      return {record, state: 'not-submitted', note: 'The wallet reported user rejection of this send request. Its original record is retained; another request requires your action.'}
    }
    if (!latest || !walletResultComplete(record)) return {record, state: 'unknown', note: note || 'The complete wallet receipt group is unresolved.'}
    if (latest.status === 400) return {record, state: 'not-submitted', note: 'The wallet reports that this request was not included and will not be retried.'}
    let previous: {number: bigint; index: bigint} | null = null
    for (const claim of latest.receipts) {
      const receipt: any = await context.rpc('eth_getTransactionReceipt', [claim.transactionHash], read)
      this.guard(context, generation)
      if (receipt === null) return {record, state: 'pending', note}
      if (!receipt || typeof receipt.transactionHash !== 'string' || !HASH.test(receipt.transactionHash) ||
        !equal(receipt.transactionHash, claim.transactionHash) || typeof receipt.blockHash !== 'string' || !HASH.test(receipt.blockHash) ||
        !['0x0','0x1'].includes(receipt.status) || !Array.isArray(receipt.logs)) throw new CreditFault('A wallet-associated canonical receipt is invalid.')
      const number = quantity(receipt.blockNumber), index = walletQuantity(receipt.transactionIndex)
      if (number > head.number || number !== walletQuantity(claim.blockNumber) || !equal(receipt.blockHash, claim.blockHash) ||
        receipt.status !== claim.status || walletQuantity(receipt.gasUsed) !== walletQuantity(claim.gasUsed) ||
        claim.logs.some(log => !receipt.logs.some((actual: unknown) => sameWalletLog(actual, log))))
        return {record, state: 'pending', note: 'A retained wallet receipt does not match the current canonical node receipt.'}
      const canonical = block(await context.rpc('eth_getBlockByNumber', [hex(number), false], read))
      this.guard(context, generation)
      if (canonical.number !== number || !equal(canonical.hash, receipt.blockHash)) return {record, state: 'pending', note}
      if (previous && (number < previous.number || (number === previous.number && index <= previous.index)))
        return {record, state: 'unknown', note: 'Wallet receipts are not in their canonical inclusion order.'}
      previous = {number, index}
    }
    if (latest.status === 100) return {record, state: 'pending', note}
    if (latest.status === 600) return {record, state: 'unknown', note: 'The wallet reports a partial failure. Review every retained receipt before another request.'}
    return {record, state: latest.status === 200 ? 'executed' : 'reverted',
      note: note || 'Wallet-reported completion and every canonical receipt were checked. Available exchange credit was read independently.'}
  }
  private async inspect(context: CreditContext, row: LegacyWithdrawalRecord, genesis: string, head: Block, read: CreditRead): Promise<CreditEntry> {
    if (!equal(row.genesis, genesis)) return {record: row, state: 'other-context'}
    if (!row.hash) return {record: row, state: 'unknown'}
    const receipt: any = await context.rpc('eth_getTransactionReceipt', [row.hash], read)
    if (receipt === null) return {record: row, state: 'pending'}
    if (!receipt || typeof receipt.blockHash !== 'string' || !HASH.test(receipt.blockHash) ||
      typeof receipt.transactionHash !== 'string' || !HASH.test(receipt.transactionHash) || !equal(receipt.transactionHash, row.hash) ||
      !['0x0','0x1'].includes(receipt.status)) throw new CreditFault('The withdrawal receipt is invalid. Keep its original hash.')
    const number = quantity(receipt.blockNumber)
    if (number > head.number) return {record: row, state: 'pending'}
    const at = block(await context.rpc('eth_getBlockByNumber', [hex(number), false], read))
    if (at.number !== number || !equal(at.hash, receipt.blockHash)) return {record: row, state: 'pending'}
    // A wallet may execute from a contract account through an outer transaction.
    // Its reported hash is retained; receipt success alone never sets credit to zero.
    if (row.source === 'recovered') await this.exactTransaction(context, row, row.hash, read)
    return {record: row, state: receipt.status === '0x1' ? 'executed' : 'reverted'}
  }
  private async exactTransaction(context: CreditContext, row: LegacyWithdrawalRecord, hash: string, read: CreditRead) {
    const tx: any = await context.rpc('eth_getTransactionByHash', [hash], read)
    if (!tx || !equal(String(tx.hash), hash) || !equal(String(tx.from), row.owner) || !equal(String(tx.to), row.exchange) ||
      typeof tx.input !== 'string' || !equal(tx.input, row.data) || quantity(tx.value) !== 0n || quantity(tx.nonce) < BigInt(row.nonce) ||
      (tx.chainId !== undefined && quantity(tx.chainId) !== BigInt(context.chainId)))
      throw new CreditFault('This hash does not identify the original withdrawal call. Keep the request for wallet review.')
  }
  private async load(context: CreditContext, generation: number, locked = false): Promise<Snapshot> {
    const abort = new AbortController()
    this.abort = abort
    const timer = setTimeout(() => abort.abort(), 30000)
    const read: CreditRead = {signal: abort.signal, bytes: 0}
    const rpc = async (method: string, params: unknown[]) => {
      const result = await context.rpc(method, params, read)
      this.guard(context, generation)
      if (abort.signal.aborted) throw new CreditFault('The credit read timed out. Refresh before withdrawing.')
      return result
    }
    try {
      const walletBefore = this.capabilities.storage.getItem(walletJournalKey(context))
      const rows = this.records(context)
      if (quantity(await rpc('eth_chainId', [])) !== BigInt(context.chainId)) throw new CreditFault('This node serves a different chain.')
      const genesis = block(await rpc('eth_getBlockByNumber', ['0x0', false]))
      const head = block(await rpc('eth_getBlockByNumber', ['latest', false]))
      if (genesis.number !== 0n) throw new CreditFault('The chain origin is unavailable.')
      const selector = {blockHash: head.hash, requireCanonical: true}
      const amountRaw = await rpc('eth_call', [{to: context.exchange, data: this.capabilities.readData(context.owner)}, selector])
      if (typeof amountRaw !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(amountRaw)) throw new CreditFault('The exchange credit response is invalid.')
      const amount = BigInt(amountRaw)
      const nonce = quantity(await rpc('eth_getTransactionCount', [context.owner, selector]))
      let previous = this.cache
      if (previous && (previous.key !== creditJournalKey(context) || !equal(previous.genesis, genesis.hash) || previous.head.number > head.number)) previous = null
      if (previous) {
        const anchor = block(await rpc('eth_getBlockByNumber', [hex(previous.head.number), false]))
        if (anchor.number !== previous.head.number || !equal(anchor.hash, previous.head.hash)) previous = null
      }
      const entries: CreditEntry[] = new Array(rows.length)
      const proofs = new Map<string, Proof>()
      let cursor = 0
      const worker = async () => {
        for (;;) {
          const index = cursor++
          if (index >= rows.length) return
          const row = rows[index], input = JSON.stringify(row)
          const cached = previous?.proofs.get(row.id)
          const entry = row.source === 'wallet-calls' ? await this.inspectWallet(context, generation, row, genesis.hash, head, read)
            : cached?.input === input ? {...cached.entry, record: row} : await this.inspect(context, row, genesis.hash, head, read)
          this.guard(context, generation)
          entries[index] = entry
          if (terminal(entry) && row.source !== 'wallet-calls') proofs.set(row.id, {input, entry})
        }
      }
      await Promise.all(Array.from({length: Math.min(4, rows.length)}, worker))
      const end = block(await rpc('eth_getBlockByNumber', [hex(head.number), false]))
      if (end.number !== head.number || !equal(end.hash, head.hash) || quantity(await rpc('eth_chainId', [])) !== BigInt(context.chainId))
        throw new CreditFault('The canonical credit view changed. Refresh before withdrawing.')
      this.guard(context, generation)
      const walletRows = entries.filter(entry => entry.record.source === 'wallet-calls').map(entry => entry.record as WalletWithdrawalRecord)
      if (JSON.stringify(walletRows) !== JSON.stringify(readWalletJournal(walletBefore, context, this.capabilities.withdrawData))) {
        for (const row of walletRows) this.unsaved.set(row.id, copyRecord(row))
        const save = async () => {
          this.guard(context, generation)
          this.writeWallet(context, walletRows, walletBefore)
          for (const row of walletRows) this.unsaved.delete(row.id)
        }
        if (locked) await save()
        else await this.capabilities.exclusive(creditJournalKey(context), save)
      }
      this.cache = {key: creditJournalKey(context), genesis: genesis.hash, head, proofs}
      return {amount, nonce, genesis: genesis.hash, head, entries}
    } catch (error) {
      // Preserve a newly learned receipt group even when its node proof is
      // temporarily unavailable. Persistence never upgrades it to execution.
      if (this.generation === generation && !this.disposed && [...this.unsaved.values()].some(row => row.source === 'wallet-calls' && creditJournalKey(row) === creditJournalKey(context))) {
        try {
          const save = async () => {
            this.guard(context, generation)
            const raw = this.capabilities.storage.getItem(walletJournalKey(context))
            const rows = this.records(context).filter(row => row.source === 'wallet-calls') as WalletWithdrawalRecord[]
            this.writeWallet(context, rows, raw)
            for (const row of rows) this.unsaved.delete(row.id)
          }
          if (locked) await save()
          else await this.capabilities.exclusive(creditJournalKey(context), save)
        } catch { /* unsaved details remain visible and exportable */ }
      }
      throw error
    } finally {
      clearTimeout(timer)
      abort.abort()
      if (this.abort === abort) this.abort = null
    }
  }
  refresh(): Promise<void> {
    if (this.disposed || !this.context || this.busy) return Promise.resolve()
    if (this.reading) return this.reading
    const context = this.context, generation = this.generation
    this.value.loading = true
    this.value.error = ''
    this.emit()
    const operation = this.load(context, generation).then(snapshot => {
      this.guard(context, generation)
      this.value.amount = snapshot.amount
      this.value.entries = snapshot.entries
    }).catch(error => {
      if (this.generation !== generation || this.disposed) return
      this.value.amount = null
      this.value.error = error instanceof CreditFault ? error.message : 'Could not read exchange credit. Refresh before withdrawing.'
      try {this.value.entries = this.records(context).map(record => ({record, state: 'pending'}))} catch { /* preserve the read refusal */ }
    }).finally(() => {
      if (this.generation === generation) this.value.loading = false
      this.reading = null
      this.emit()
      if (this.again) {this.again = false; void this.refresh()}
    })
    this.reading = operation
    return operation
  }
  async withdraw(): Promise<void> {
    if (!this.snapshot().canWithdraw || !this.context || this.reading) return
    const context = this.context, generation = this.generation
    this.busy = true
    this.value.note = ''
    this.emit()
    try {
      await this.capabilities.exclusive(creditJournalKey(context), async () => {
        this.guard(context, generation)
        const snapshot = await this.load(context, generation, true)
        if (snapshot.amount === 0n || !snapshot.entries.every(terminal) || !this.capabilities.canSend(context))
          throw new CreditFault('Review the credit and any earlier withdrawal before continuing.')
        const key = creditJournalKey(context)
        const raw = this.capabilities.storage.getItem(key)
        const rows = readCreditJournal(raw, context, this.capabilities.withdrawData)
        if (JSON.stringify(this.records(context)) !== JSON.stringify(snapshot.entries.map(entry => entry.record)))
          throw new CreditFault('Withdrawal history changed during preparation. Review it again.')
        if (snapshot.entries.length >= CREDIT_HISTORY_LIMIT) throw new CreditFault('Withdrawal history is full. Export and review it before continuing.')
        const record: LegacyWithdrawalRecord = {id: this.capabilities.id(), chainId: context.chainId,
          owner: context.owner, exchange: context.exchange, endpointHash: context.endpointHash,
          genesis: snapshot.genesis, head: snapshot.head.number.toString(), headHash: snapshot.head.hash,
          nonce: snapshot.nonce.toString(), data: this.capabilities.withdrawData, value: '0', hash: null, source: 'wallet'}
        const guard = () => {this.guard(context, generation); if (!this.capabilities.canSend(context)) throw new CreditFault('The wallet or network changed. Review the withdrawal again.')}
        guard()
        if (snapshot.entries.some(entry => entry.record.id === record.id)) throw new CreditFault('The recovery identifier is already in use.')
        const wallet = await this.selectWallet(context, generation)
        if (wallet) {
          await this.sendWallet(context, generation, snapshot, record, wallet)
          return
        }
        let saved = false
        const failed = (error: unknown, requested: boolean) => {
          if (record.hash !== null || (requested && !walletRejected(error))) return
          const latest = this.capabilities.storage.getItem(key)
          const current = readCreditJournal(latest, context, this.capabilities.withdrawData)
          const own = current.find(row => row.id === record.id)
          if (own && JSON.stringify(own) === JSON.stringify(record)) this.write(context, current.filter(row => row.id !== record.id), latest)
        }
        await this.capabilities.send({to: context.exchange as `0x${string}`, data: record.data as `0x${string}`,
          value: 0n, gas: 100000n, label: 'Withdraw available ZNN credit', guard,
          onRequest: () => {
            guard(); this.write(context, [...rows, record], raw); saved = true
            if (this.generation === generation) {
              this.value.entries = [...snapshot.entries, {record: {...record}, state: 'unknown'}]
              this.emit()
            }
          },
          onSubmitted: hash => {
            if (!saved || !HASH.test(hash)) throw new CreditFault('The wallet did not return a valid transaction hash. Keep the original request.')
            record.hash = hash
            this.unsaved.set(record.id, {...record})
            if (this.generation === generation) {
              const shown = this.value.entries.find(entry => entry.record.id === record.id)
              if (shown) {shown.record = {...record}; shown.state = 'pending'}
              this.emit()
            }
            const latest = this.capabilities.storage.getItem(key)
            const current = readCreditJournal(latest, context, this.capabilities.withdrawData)
            const own = current.find(row => row.id === record.id)
            if (!own || own.hash !== null) throw new CreditFault('The original recovery record changed after submission.')
            Object.assign(own, record)
            this.write(context, current, latest)
            this.unsaved.delete(record.id)
          }, onFailed: failed})
        if (this.generation === generation) this.value.note = 'The wallet request ended. Available credit is read again from the exchange; review the transaction before trying again.'
      })
    } catch (error) {
      if (this.generation === generation) this.value.note = error instanceof CreditFault ? error.message : 'The withdrawal could not be prepared or confirmed. Keep any original transaction hash and review the wallet.'
    } finally {
      this.busy = false
      this.emit()
      await this.refresh()
    }
  }
  async recoverHash(id: string, hash: string): Promise<void> {
    if (!this.context || this.busy || this.reading || !HASH.test(hash)) return
    const context = this.context, generation = this.generation
    this.busy = true
    this.emit()
    try {
      await this.capabilities.exclusive(creditJournalKey(context), async () => {
        const snapshot = await this.load(context, generation, true)
        const key = creditJournalKey(context), raw = this.capabilities.storage.getItem(key)
        const rows = readCreditJournal(raw, context, this.capabilities.withdrawData)
        if (JSON.stringify(this.records(context)) !== JSON.stringify(snapshot.entries.map(entry => entry.record)))
          throw new CreditFault('Withdrawal history changed during recovery. Review it again.')
        const row = rows.find(entry => entry.id === id)
        if (!row || row.hash !== null || !equal(row.genesis, snapshot.genesis) || rows.some(entry => entry.hash && equal(entry.hash, hash)))
          throw new CreditFault('The original withdrawal request is unavailable for this recovery.')
        const abort = new AbortController(), timer = setTimeout(() => abort.abort(), 10000)
        try {await this.exactTransaction(context, row, hash, {signal: abort.signal, bytes: 0})}
        finally {clearTimeout(timer); abort.abort()}
        this.guard(context, generation)
        row.hash = hash
        row.source = 'recovered'
        this.write(context, rows, raw)
      })
      this.value.note = 'The exact withdrawal hash was saved. Its canonical receipt is checked without sending another transaction.'
    } catch (error) {
      if (this.generation === generation) this.value.note = error instanceof CreditFault ? error.message : 'Could not recover this hash. Keep the original wallet request.'
    } finally {this.busy = false; this.emit(); await this.refresh()}
  }
  async saveRecovery(): Promise<void> {
    if (!this.context || this.busy) return
    const context = this.context, generation = this.generation
    try {
      await this.capabilities.exclusive(creditJournalKey(context), async () => {
        this.guard(context, generation)
        const key = creditJournalKey(context), raw = this.capabilities.storage.getItem(key)
        const rows = this.records(context)
        if (rows.some(row => row.source !== 'wallet-calls' && this.unsaved.has(row.id)))
          this.write(context, rows.filter(row => row.source !== 'wallet-calls') as LegacyWithdrawalRecord[], raw)
        if (rows.some(row => row.source === 'wallet-calls' && this.unsaved.has(row.id)))
          this.writeWallet(context, rows.filter(row => row.source === 'wallet-calls') as WalletWithdrawalRecord[], this.capabilities.storage.getItem(walletJournalKey(context)))
        for (const row of rows) this.unsaved.delete(row.id)
      })
    } catch {this.value.note = 'The transaction hash still could not be saved. Download the recovery record before leaving.'}
    await this.refresh()
  }
  exportRecord(): string {
    if (!this.context) return ''
    try {
      const rows = this.records(this.context)
      if (rows.some(row => row.source === 'wallet-calls')) return JSON.stringify({schema: 2,
        legacy: {schema: 1, records: rows.filter(row => row.source !== 'wallet-calls')},
        walletCalls: {schema: 1, records: rows.filter(row => row.source === 'wallet-calls')}}, null, 2)
      return JSON.stringify({schema: 1, records: rows}, null, 2)
    } catch {
      const pending = [...this.unsaved.values()].filter(row => creditJournalKey(row) === creditJournalKey(this.context!))
      if (pending.some(row => row.source === 'wallet-calls')) {
        let persistedWalletCallsRaw: string | null = null
        try {
          const raw = this.capabilities.storage.getItem(walletJournalKey(this.context))
          if (raw !== null && raw.length <= WALLET_CALL_JOURNAL_BYTES) persistedWalletCallsRaw = raw
        } catch { /* unsaved details remain exportable when storage cannot be read */ }
        return JSON.stringify({schema: 2, completeJournal: false,
          legacy: {schema: 1, records: pending.filter(row => row.source !== 'wallet-calls')},
          walletCalls: {schema: 1, records: pending.filter(row => row.source === 'wallet-calls')}, persistedWalletCallsRaw}, null, 2)
      }
      if (pending.length) return JSON.stringify({schema: 1, completeJournal: false, records: pending}, null, 2)
      const raw = this.capabilities.storage.getItem(creditJournalKey(this.context))
      const walletRaw = this.capabilities.storage.getItem(walletJournalKey(this.context))
      if (walletRaw !== null && walletRaw.length <= WALLET_CALL_JOURNAL_BYTES && (raw === null || raw.length <= CREDIT_JOURNAL_BYTES))
        return JSON.stringify({schema: 2, completeJournal: false, legacyRaw: raw, walletCallsRaw: walletRaw}, null, 2)
      if (raw !== null && raw.length <= CREDIT_JOURNAL_BYTES) return raw
      throw new CreditFault('The saved recovery record cannot be exported within its read limit.')
    }
  }
}
