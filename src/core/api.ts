// The ZVM node's API.
//
// Same shapes as the node-embedded pages this is derived from, with one change
// that runs through every call: the path is built from the configured endpoint
// instead of a leading slash, because this bundle has no node of its own.

import {base} from './endpoint'

export interface ChainInfo {
  l1: {chainId: number; frontier: number; rpc: string; inbox: string; vault: string; explorer?: string}
  l2: {
    chainId: number
    rpc: string
    head: number
    headHash: string
    finalized: number
    gasLimit: number
    gasPerPlasma: number
    maxNativeGas: number
    maxNativeGasPerBlk: number
    maxTxGas: number
    /** The execution ruleset: isthmus (Prague) or karst (Osaka). */
    evm: string
    genesisHash: string
    startMomentum: number
    finalityDepth: number
    baseFee?: string
    timestamp?: number
    /** Which activation heights this chain has, which are live, and the fee
     * market in force — `eip1559` reflects the market fork when it is past. */
    forks?: {
      gas: {scheduled: boolean; active: boolean; momentum?: number}
      wire: {scheduled: boolean; active: boolean; momentum?: number}
      market: {scheduled: boolean; active: boolean; momentum?: number}
      nativeFloor?: number
      nativeCeil?: number
      eip1559?: {denominator: number; elasticity: number; targetGas: number; maxRisePct: number; maxFallPct: number}
    }
  }
  derivation: {momentum: number; momentumHash: string; lag: number}
  predeploys: Record<string, string>
  /** Present when the node was given a deployment written by `zvm bench setup`. */
  uniswapV2?: {factory: string; router: string; weth: string; tokens: string[]}
  /** Present when the node was given one written by `zvm apps setup`. */
  apps?: {
    /** Settles signed orders (D28). */
    exchange: string
    /** What bids are paid in: nothing is escrowed, so a bid is an allowance. */
    wrappedZnn?: string
    collectionFactory: string
    collectionImplementation: string
    farm: string
    rewardToken: string
    znnQsrPair?: string
    collections?: string[]
    mediaUrl?: string
  }
  /** Present when this node stores NFT images and metadata. */
  media?: {
    publicUrl: string
    loadUrl: string
    cdn: boolean
    host: string
    maxImageBytes: number
    maxJsonBytes: number
    uploads: boolean
  }
  prices?: {enabled: boolean; source: string; updatedAt: number; stale: boolean}
  relayer?: any
  bridge?: any
  faucet?: any
}

// The price types are @zvm/web's, so that this app, the explorer and glyphswap
// read one endpoint through one declaration of what it returns. PricePair is
// what this app called DexScreenerPair.
import type {PriceSnapshot} from '@zvm/web'
export type {PricePair, PriceQuote, TokenPrice, PriceSnapshot} from '@zvm/web'

export interface PairToken {
  address: string
  symbol: string
  name: string
  decimals: number
  usd?: number
  anchor?: string
}

export interface PairRow {
  pair: string
  factory: string
  token0: PairToken
  token1: PairToken
  reserve0: string
  reserve1: string
  base: string
  quote: string
  price: number
  priceUsd?: number
  change24h?: number
  volume24h: {base: number; quote: number; usd?: number}
  trades24h: number
  liquidityUsd: number
  lastTradeAt?: number
  createdAt: number
}

export interface Candle {
  t: number
  o: number
  h: number
  l: number
  c: number
  v: number
  n: number
}

export interface CandleSet {
  pair: string
  interval: number
  base: string
  quote: string
  candles: Candle[]
  usd: boolean
  usdAsset?: string
  usdSince?: number
}

export interface TradeRow {
  block: number
  index: number
  timestamp: number
  tx: string
  kind: string
  account: string
  base: number
  quote: number
  price: number
  usd?: number
}

export interface BlockRow {
  number: number
  hash: string
  timestamp: number
  momentum: number
  momentumHash: string
  txs: number
  userTxs: number
  gasUsed: number
  gasLimit: number
  baseFee: string
  size: number
  messages: number
  zvmBytes: number
  nomBlocks: number
  buildMs: number
}

export interface TxRow {
  hash: string
  index: number
  type: number
  lane: string
  nomHash: string | null
  from: string
  to: string | null
  value: string
  gasUsed: number
  status: number
  selector: string | null
  contract: string | null
}

export interface MomentumRow {
  height: number
  hash: string
  timestamp: number
  l2Number: number
  l2Hash: string
  txs: number
  messages: number
  dropped: number
  nomBlocks: number
  zvmBytes: number
  zvmPlasma: number
  gasUsed: number
  buildMs: number
  attempts: number
}

export interface MessageRow {
  nomHash: string
  momentum: number
  index: number
  author: string
  kind: string
  status: string
  reason: string
  bytes: number
  plasma: number
  token: string
  amount: string
  txs: string[] | null
  dropped: {hash: string; reason: string}[] | null
}

/** A directory, sized by walking it. `allocated` is blocks on disk, which is not always the files' length. */
export interface DiskUsage {
  name: string
  path: string
  bytes: number
  allocated: number
  files: number
  error?: string
}

/** A run of consecutive momentums and what their account blocks carried. */
export interface NomWindow {
  momentums: number
  from: number
  to: number
  seconds: number
  blocks: number
  dataBytes: number
  emptyMomentums: number
}

export interface OpsReport {
  at: number
  instance: {
    startedAt: number
    uptimeSeconds: number
    hostname: string
    pid: number
    go: string
    os: string
    arch: string
    cpus: number
    goroutines: number
    memory: {heapAlloc: number; heapInuse: number; sys: number; gcCycles: number; lastGcAt: number; gcPauseTotalMs: number}
    build: {module: string; version: string; revision?: string; revisionTime?: string; modified?: boolean}
    services: Record<string, boolean>
  }
  storage: {
    at: number
    tookMs: number
    volumes: DiskUsage[]
    media: DiskUsage | null
    index: {
      path: string
      bytes: number
      allocated: number
      walBytes: number
      pageSize: number
      pages: number
      freePages: number
      tablesAt: number
      tablesMs: number
      tables: {name: string; rows: number; bytes?: number}[]
      error?: string
    }
  } | null
  history: {t: number; l2: number; bytes: Record<string, number>}[]
  derivation: {
    status: {l1Frontier: number; derivedMomentum: number; l2Number: number; lagMomentums: number; finalizedL2: number}
    window: NomWindow & {messages: number; txs: number; plasma: number; dropped: number; retried: number}
    buildMs: {p50: number; p95: number; p99: number; max: number; mean: number}
    totals: {momentums: number; firstAt: number; lastAt: number; blocks: number; dataBytes: number; plasma: number; messages: number; txs: number; dropped: number}
  }
  engine: {client?: string; syncing?: boolean; txpool?: {pending: number; queued: number}; ancients?: number; head?: number; headAt?: number; error?: string}
  l1: {
    version?: string
    commit?: string
    sync?: {state: number; currentHeight: number; targetHeight: number}
    peers?: number
    frontier?: number
    frontierAt?: number
    momentumVersion?: number
    error?: string
  }
  /** null when the node was started with -mainnet-rpc=off. */
  mainnet: {
    rpc: string
    pending?: boolean
    at?: number
    error?: string
    chainId?: number
    version?: string
    frontier?: number
    frontierAt?: number
    genesisAt?: number
    momentumVersion?: number
    window?: NomWindow | null
    blockCap: number
    disk: {bytes: number; source: string} | null
  } | null
}

/** Sources published for a contract, and how closely they reproduced its code. */
export interface VerifiedSource {
  address: string
  /** exact: every byte, metadata hash included. partial: every byte but the metadata. */
  match: 'exact' | 'partial'
  /** path/File.sol:Name */
  name: string
  compiler: string
  abi: any[]
  sources: Record<string, string>
  settings: Record<string, any>
  constructorArgs?: string
  creationMatch?: 'exact' | 'partial'
  verifiedAt: number
  /** Set when these sources were verified at another address with identical code. */
  similarTo?: string
}

export interface ContractDetail {
  address: string
  codeSize: number
  codeHash: string
  code: string
  creation: {creator: string; tx: string; block: number} | null
  /** Whether this node verifies contracts at all. */
  verification: boolean
  verified: VerifiedSource | null
  proxy: {kind: string; implementation: string; verified: {name: string; match: string; abi: any[]} | null} | null
  selectors: {selector: string; count: number}[]
}

export interface ContractAbiInfo {
  address: string
  name: string | null
  abi: any[] | null
  implementation: {address: string; name: string; abi: any[]} | null
}

export interface VerifyJob {
  id: string
  address: string
  contract: string
  compiler: string
  status: 'queued' | 'running' | 'verified' | 'failed'
  message?: string
  match?: 'exact' | 'partial'
  createdAt: number
  finishedAt?: number
}

export interface TokenHolders {
  kind: string
  /** How many addresses hold any. */
  holders: number
  /** What they hold between them: base units, or token count for an NFT. */
  held: string
  rows: {address: string; quantity: string; tokens?: number}[]
}

export interface TokenTransferRow {
  tx: string
  index: number
  block: number
  timestamp: number
  from: string
  to: string
  value: string | null
  tokenId: string | null
  /** The selector the transaction called, and on which contract. */
  selector: string | null
  txTo: string | null
  lane: string | null
}

export class ApiError extends Error {}

const TIMEOUT_MS = 10_000

const hostOf = (url: string) => {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${base()}${path}`
  let res: Response
  try {
    res = await fetch(url, {...init, signal: AbortSignal.timeout(TIMEOUT_MS)})
  } catch (err: any) {
    if (err?.name === 'TimeoutError') throw new ApiError(`${hostOf(url)} did not answer in time`)
    // A cross-origin failure reaches JavaScript as a bare TypeError with no
    // detail: the browser keeps the reason to itself and only prints it to the
    // console. A node that is up but answering badly (a duplicated
    // Access-Control-Allow-Origin header, say) looks exactly like one that is
    // down, so the message has to name both rather than assert the wrong one.
    throw new ApiError(`${hostOf(url)} did not answer. It may be down, or refusing this page's request.`)
  }
  const body = await res.json().catch(() => null)
  if (!res.ok) throw new ApiError(body?.error ?? `${res.status} ${res.statusText}`)
  return body as T
}

const get = <T>(path: string) => request<T>(path, {headers: {accept: 'application/json'}})

const post = <T>(path: string, payload: unknown) =>
  request<T>(path, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(payload)})

const qs = (params: Record<string, string | number | undefined>) => {
  const q = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join('&')
  return q ? `?${q}` : ''
}

export const api = {
  info: () => get<ChainInfo>('/api/info'),
  blocks: (p: {limit?: number; before?: number} = {}) => get<BlockRow[]>(`/api/blocks${qs(p)}`),
  block: (id: string | number) => get<any>(`/api/blocks/${id}`),
  txs: (p: {limit?: number; before?: number; lane?: string; users?: number} = {}) => get<TxRow[]>(`/api/txs${qs(p)}`),
  tx: (hash: string) => get<any>(`/api/txs/${hash}`),
  address: (addr: string) => get<any>(`/api/address/${addr}`),
  addressTxs: (addr: string, p: {limit?: number; before?: number} = {}) => get<TxRow[]>(`/api/address/${addr}/txs${qs(p)}`),
  addressTransfers: (addr: string, p: {limit?: number} = {}) => get<any[]>(`/api/address/${addr}/transfers${qs(p)}`),
  tokens: (p: {limit?: number} = {}) => get<any[]>(`/api/tokens${qs(p)}`),
  /** Only the ones the indexer already knows come back, keyed by checksummed address. */
  tokenNames: (addresses: string[]) =>
    get<Record<string, {name: string; symbol: string}>>(`/api/tokens/names${qs({addresses: addresses.join(',')})}`),
  token: (addr: string) => get<any>(`/api/tokens/${addr}`),
  tokenHolders: (addr: string, p: {limit?: number} = {}) => get<TokenHolders>(`/api/tokens/${addr}/holders${qs(p)}`),
  /** before is the last row's block:index. */
  tokenTransfers: (addr: string, p: {limit?: number; before?: string} = {}) =>
    get<TokenTransferRow[]>(`/api/tokens/${addr}/transfers${qs(p)}`),
  momentums: (p: {limit?: number; before?: number} = {}) => get<MomentumRow[]>(`/api/momentums${qs(p)}`),
  momentum: (height: number | string) => get<{momentum: MomentumRow; messages: MessageRow[]}>(`/api/momentums/${height}`),
  nom: (hash: string) => get<MessageRow>(`/api/nom/${hash}`),
  bridge: (p: {limit?: number} = {}) => get<any>(`/api/bridge${qs(p)}`),
  stats: (p: {limit?: number} = {}) => get<{series: any[]; totals: any}>(`/api/stats${qs(p)}`),
  txHistory: (p: {hours?: number; buckets?: number} = {}) =>
    get<{series: {timestamp: number; txs: number; total: number}[]; total: number; windowTxs: number; since: number}>(
      `/api/stats/txhistory${qs(p)}`,
    ),
  contracts: (p: {limit?: number} = {}) => get<any[]>(`/api/contracts${qs(p)}`),
  ops: () => get<OpsReport>('/api/ops'),

  // Contracts and publishing their sources.
  contract: (addr: string) => get<ContractDetail>(`/api/contracts/${addr}`),
  contractAbi: (addr: string) => get<ContractAbiInfo>(`/api/contracts/${addr}/abi`),
  /** Only the verified ones come back, keyed by checksummed address. */
  verifiedMarks: (addresses: string[]) =>
    get<Record<string, {name: string; match: 'exact' | 'partial'; proxy?: boolean}>>(`/api/contracts/verified${qs({addresses: addresses.join(',')})}`),
  compilers: () => get<{latest: string; builds: {version: string; longVersion: string}[]}>('/api/verify/compilers'),
  verify: (body: {address: string; compiler: string; contract: string; input: unknown; constructorArgs?: string}) =>
    post<VerifyJob>('/api/verify', body),
  verifyJob: (id: string) => get<VerifyJob>(`/api/verify/${id}`),
  search: (q: string) => get<{kind: string; id: string}>(`/api/search${qs({q})}`),
  faucetStatus: () => get<any>('/api/faucet'),
  drip: (address: string) => post<any>('/api/faucet', {address}),

  // Markets: dollar prices, pools, candles and trades.
  prices: () => get<PriceSnapshot>('/api/prices'),
  priceHistory: (asset: string, hours = 24) => get<{asset: string; samples: {t: number; usd: number}[]}>(`/api/prices/history${qs({asset, hours})}`),
  pairs: () => get<PairRow[]>('/api/dex/pairs'),
  pair: (pair: string) => get<PairRow>(`/api/dex/pairs/${pair}`),
  candles: (pair: string, p: {interval?: number; limit?: number; quote?: string; usd?: number} = {}) =>
    get<CandleSet>(`/api/dex/pairs/${pair}/candles${qs(p)}`),
  trades: (pair: string, p: {limit?: number; quote?: string; all?: number} = {}) => get<TradeRow[]>(`/api/dex/pairs/${pair}/trades${qs(p)}`),

  // The NFT market.
  nft: () => get<any>('/api/nft'),
  collections: (p: {limit?: number; sort?: string} = {}) => get<any[]>(`/api/nft/collections${qs(p)}`),
  collection: (addr: string) => get<any>(`/api/nft/collections/${addr}`),
  collectionItems: (addr: string, p: {limit?: number; offset?: number; sort?: string; listed?: number} = {}) =>
    get<any[]>(`/api/nft/collections/${addr}/items${qs(p)}`),
  collectionActivity: (addr: string, p: {limit?: number} = {}) => get<any[]>(`/api/nft/collections/${addr}/activity${qs(p)}`),
  item: (collection: string, id: string) => get<any>(`/api/nft/items/${collection}/${id}`),
  nftAccount: (addr: string) => get<any>(`/api/nft/accounts/${addr}`),
  feeSeries: (q: {limit?: number} = {}) => get<{series: any[]; totals: any}>(`/api/fees/series${qs(q)}`),
  nftSales: (p: {limit?: number; collection?: string} = {}) => get<any[]>(`/api/nft/sales${qs(p)}`),
  nftListings: (p: {limit?: number; collection?: string; sort?: string} = {}) => get<any[]>(`/api/nft/listings${qs(p)}`),
  nftOffers: (p: {limit?: number; collection?: string; collectionOnly?: number} = {}) => get<any[]>(`/api/nft/offers${qs(p)}`),
  nftOrders: (p: {trader?: string; collection?: string; tokenId?: string; side?: string; all?: number; limit?: number} = {}) =>
    get<any[]>(`/api/nft/orders${qs(p)}`),
  order: (hash: string) =>
    get<{hash: string; input: any; status: string; code: number; reason: string; fillable: boolean}>(`/api/nft/orders/${hash}`),
  submitOrders: (orders: unknown[]) =>
    post<{results: {hash: string; ok: boolean; code: number; reason?: string}[]}>('/api/nft/orders', {orders}),

  // The media store: a signature buys a session, a session uploads bytes.
  mediaChallenge: (address: string) => get<{message: string; expiresAt: number}>(`/api/media/challenge${qs({address})}`),
  mediaSession: (body: {address: string; message: string; signature: string}) =>
    post<{token: string; address: string; expiresAt: number}>('/api/media/session', body),
}
