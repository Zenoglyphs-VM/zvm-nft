import type {CreditContext, LegacyWithdrawalRecord} from './credits'

export const WALLET_CALLS_VERSION = '2.0.0'
export const WALLET_CALL_RESULTS = 8
export const WALLET_CALL_RECEIPTS = 16
export const WALLET_CALL_JOURNAL_BYTES = 64 * 1024
const HASH = /^0x[0-9a-fA-F]{64}$/
const ADDRESS = /^0x[0-9a-fA-F]{40}$/
const ID = /^0x[0-9a-f]{128}$/
const QUANTITY = /^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/
const decimal = (v: unknown) => typeof v === 'string' && /^(0|[1-9][0-9]*)$/.test(v) && v.length <= 78 && BigInt(v) < (1n << 256n)
const object = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v)
const keys = (v: object, names: string[]) => Object.keys(v).sort().join(',') === names.sort().join(',')
const hex = (v: bigint) => '0x' + v.toString(16)
const fault = () => new Error('The wallet recovery response needs review. Keep the original request identifier.')

export interface WalletRequest {
  version: '2.0.0'
  id: string
  from: string
  chainId: string
  atomicRequired: false
  calls: [{to: string; data: string; value: '0x0'}]
}
export interface WalletLog {address: string; data: string; topics: string[]}
export interface WalletReceipt {
  transactionHash: string
  blockHash: string
  blockNumber: string
  gasUsed: string
  status: '0x0' | '0x1'
  logs: WalletLog[]
}
export interface WalletResult {
  version: '2.0.0'
  id: string
  chainId: string
  status: 100 | 200 | 400 | 500 | 600
  atomic: boolean
  receipts: WalletReceipt[]
}
export interface WalletWithdrawalRecord extends Omit<LegacyWithdrawalRecord, 'source'> {
  source: 'wallet-calls'
  wallet: {request: WalletRequest; results: WalletResult[]; dispatchRejection?: {method: 'wallet_sendCalls'; code: 4001}}
}
export interface CreditWallet {
  request: (args: {method: string; params: unknown[]}) => Promise<unknown>
  id: () => string
}

export function directWalletRejection(error: unknown): boolean {
  // Only the direct response to wallet_sendCalls has this meaning. A nested
  // error or a later status-query failure cannot prove rejection of a send.
  return object(error) && error.code === 4001
}

export function mergeWalletEvidence(saved: WalletWithdrawalRecord, pending: WalletWithdrawalRecord): WalletWithdrawalRecord {
  const stable = (row: WalletWithdrawalRecord) => JSON.stringify({...row, wallet: {request: row.wallet.request, results: []}})
  const a = saved.wallet.results, b = pending.wallet.results
  if (stable(saved) !== stable(pending) || a.slice(0, Math.min(a.length, b.length))
    .some((result, index) => JSON.stringify(result) !== JSON.stringify(b[index])))
    throw new Error('Wallet request or observation histories diverged. Keep both versions for review.')
  const dispatchRejection = saved.wallet.dispatchRejection ?? pending.wallet.dispatchRejection
  return {...saved, wallet: {request: saved.wallet.request, results: a.length > b.length ? a : b,
    ...(dispatchRejection ? {dispatchRejection} : {})}}
}

export function walletJournalKey(context: Pick<CreditContext, 'chainId' | 'exchange' | 'owner'>): string {
  return 'zvm.exchange-credit-calls.v1:' + context.chainId + ':' + context.exchange.toLowerCase() + ':' + context.owner.toLowerCase()
}
export function walletQuantity(value: unknown): bigint {
  if (typeof value !== 'string' || value.length > 66 || !QUANTITY.test(value)) throw fault()
  return BigInt(value)
}
function chain(value: unknown, expected: number): string {
  // Wallet responses may pad a chain id, unlike outbound JSON-RPC quantities.
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{1,64}$/.test(value) || BigInt(value) !== BigInt(expected)) throw fault()
  return hex(BigInt(expected))
}
export function walletRequest(context: CreditContext, data: string, id: string): WalletRequest {
  if (!ID.test(id) || /^0x0+$/.test(id) || !/^0x[0-9a-fA-F]{8}$/.test(data)) throw fault()
  return {version: WALLET_CALLS_VERSION, id, from: context.owner.toLowerCase(), chainId: hex(BigInt(context.chainId)),
    atomicRequired: false, calls: [{to: context.exchange.toLowerCase(), data, value: '0x0'}]}
}
export function supportsWalletCalls(value: unknown, chainId: number): boolean {
  if (!object(value) || Object.keys(value).length > 16) throw fault()
  const matches = Object.keys(value).filter(k => /^0x[0-9a-fA-F]{1,64}$/.test(k) && BigInt(k) === BigInt(chainId))
  if (matches.length > 1) throw fault()
  if (!matches.length) return false
  const selected = value[matches[0]]
  if (!object(selected) || Object.keys(selected).length > 16) throw fault()
  if (!Object.prototype.hasOwnProperty.call(selected, 'atomic')) return false
  if (!object(selected.atomic) || !['supported', 'ready', 'unsupported'].includes(selected.atomic.status)) throw fault()
  return true
}
export function walletMethodUnsupported(error: unknown): boolean {
  const seen = new Set<unknown>()
  let current: any = error
  for (let i = 0; i < 8 && object(current) && !seen.has(current); i++) {
    seen.add(current)
    if (current.code === -32601 || current.code === 4200) return true
    current = current.cause
  }
  return false
}
export async function boundedWalletRequest(wallet: CreditWallet, method: string, params: unknown[], milliseconds = 8000): Promise<unknown> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([Promise.resolve().then(() => wallet.request({method, params})), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('The wallet response timed out. The saved request must be reviewed without resubmitting.')), milliseconds)
    })])
  } finally {clearTimeout(timer)}
}
function log(value: unknown): WalletLog {
  if (!object(value) || typeof value.address !== 'string' || !ADDRESS.test(value.address) || typeof value.data !== 'string' ||
    value.data.length > 8194 || !/^0x(?:[0-9a-fA-F]{2})*$/.test(value.data) || !Array.isArray(value.topics) ||
    value.topics.length > 4 || value.topics.some((t: unknown) => typeof t !== 'string' || !HASH.test(t))) throw fault()
  return {address: value.address.toLowerCase(), data: value.data.toLowerCase(), topics: value.topics.map((t: string) => t.toLowerCase())}
}
export function parseWalletResult(value: unknown, request: WalletRequest, chainId: number): WalletResult {
  if (!object(value) || value.version !== WALLET_CALLS_VERSION || value.id !== request.id || typeof value.atomic !== 'boolean' ||
    ![100,200,400,500,600].includes(value.status)) throw fault()
  const chainIdHex = chain(value.chainId, chainId)
  const receipts = value.receipts === undefined ? [] : value.receipts
  if (!Array.isArray(receipts) || receipts.length > WALLET_CALL_RECEIPTS ||
    (value.status === 400 && receipts.length) || ([200,500,600].includes(value.status) && !receipts.length)) throw fault()
  const hashes = new Set<string>()
  let totalLogs = 0, totalBytes = 0
  const parsed = receipts.map((r: unknown): WalletReceipt => {
    if (!object(r) || typeof r.transactionHash !== 'string' || !HASH.test(r.transactionHash) ||
      hashes.has(r.transactionHash.toLowerCase()) || typeof r.blockHash !== 'string' || !HASH.test(r.blockHash) ||
      !['0x0','0x1'].includes(r.status) || !Array.isArray(r.logs) || (totalLogs += r.logs.length) > 64) throw fault()
    const logs: WalletLog[] = r.logs.map(log)
    totalBytes += logs.reduce((n, l) => n + l.data.length + l.topics.join('').length, 0)
    if (totalBytes > 32 * 1024) throw fault()
    hashes.add(r.transactionHash.toLowerCase())
    return {transactionHash: r.transactionHash.toLowerCase(), blockHash: r.blockHash.toLowerCase(),
      blockNumber: hex(walletQuantity(r.blockNumber)), gasUsed: hex(walletQuantity(r.gasUsed)), status: r.status, logs}
  })
  if (value.status === 200 && parsed.some(r => r.status !== '0x1')) throw fault()
  return {version: WALLET_CALLS_VERSION, id: request.id, chainId: chainIdHex, status: value.status, atomic: value.atomic, receipts: parsed}
}
export function appendWalletResult(record: WalletWithdrawalRecord, result: WalletResult): WalletWithdrawalRecord {
  const results = record.wallet.results
  if (results.length && JSON.stringify(results[results.length - 1]) === JSON.stringify(result)) return record
  if (results.length >= WALLET_CALL_RESULTS) throw new Error('Wallet recovery history is full. Download the record before further review.')
  return {...record, wallet: {...record.wallet, results: [...results, result]}}
}
export function walletResultComplete(record: WalletWithdrawalRecord): boolean {
  const results = record.wallet.results, latest = results[results.length - 1]
  if (!latest) return false
  if (results.some(r => r.status === 400) && results.some(r => r.receipts.length > 0)) return false
  const current = new Set(latest.receipts.map(r => r.transactionHash))
  return results.every(r => r.receipts.every(receipt => current.has(receipt.transactionHash)))
}
export function readWalletJournal(raw: string | null, context: CreditContext, data: string): WalletWithdrawalRecord[] {
  if (raw === null) return []
  if (raw.length > WALLET_CALL_JOURNAL_BYTES) throw fault()
  let parsed: unknown
  try {parsed = JSON.parse(raw)} catch {throw fault()}
  if (!object(parsed) || !keys(parsed, ['schema','records']) || parsed.schema !== 1 || !Array.isArray(parsed.records) || parsed.records.length > 32) throw fault()
  const ids = new Set<string>(), calls = new Set<string>()
  return parsed.records.map((row: unknown) => {
    if (!object(row) || !keys(row, ['id','chainId','owner','exchange','endpointHash','genesis','head','headHash','nonce','data','value','hash','source','wallet']) ||
      typeof row.id !== 'string' || !/^[a-zA-Z0-9-]{1,64}$/.test(row.id) || ids.has(row.id) || row.chainId !== context.chainId ||
      row.owner !== context.owner.toLowerCase() || row.exchange !== context.exchange.toLowerCase() || row.data !== data || row.value !== '0' ||
      row.hash !== null || row.source !== 'wallet-calls' || !decimal(row.head) || !decimal(row.nonce) ||
      ['genesis','headHash','endpointHash'].some(k => typeof row[k] !== 'string' || !HASH.test(row[k])) ||
      !object(row.wallet) || !(keys(row.wallet, ['request','results']) || keys(row.wallet, ['request','results','dispatchRejection'])) || !object(row.wallet.request)) throw fault()
    const request = walletRequest(context, data, row.wallet.request.id)
    if (!keys(row.wallet.request, ['version','id','from','chainId','atomicRequired','calls']) ||
      JSON.stringify(row.wallet.request) !== JSON.stringify(request) || calls.has(request.id) ||
      !Array.isArray(row.wallet.results) || row.wallet.results.length > WALLET_CALL_RESULTS) throw fault()
    const results = row.wallet.results.map((r: unknown) => parseWalletResult(r, request, context.chainId))
    if (JSON.stringify(results) !== JSON.stringify(row.wallet.results)) throw fault()
    const wallet: WalletWithdrawalRecord['wallet'] = {request, results}
    if (Object.prototype.hasOwnProperty.call(row.wallet, 'dispatchRejection')) {
      const rejection = row.wallet.dispatchRejection
      if (!object(rejection) || !keys(rejection, ['method','code']) || rejection.method !== 'wallet_sendCalls' || rejection.code !== 4001) throw fault()
      wallet.dispatchRejection = {method: 'wallet_sendCalls', code: 4001}
    }
    ids.add(row.id); calls.add(request.id)
    return {...row, wallet} as WalletWithdrawalRecord
  })
}
export function sameWalletLog(value: unknown, expected: WalletLog): boolean {
  try {return JSON.stringify(log(value)) === JSON.stringify(expected)} catch {return false}
}
