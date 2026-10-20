// The swap page's shared state: which Uniswap deployment this chain has, its
// tokens and pools, and what the connected account holds. Swap and Pool read
// the same pools, so one refresh serves both.

import {reactive} from 'vue'
import type {Address} from 'viem'
import {api} from './api'
import {publicClient} from './evm'
import {wallet} from './wallet'
import {account} from './lanes'
import * as uni from './uniswap'

interface DexState {
  /** absent: the node has no deployment; stale: it names a router this chain does not have. */
  status: 'loading' | 'absent' | 'stale' | 'ready' | 'error'
  error: string
  router: Address | null
  factory: Address | null
  weth: Address | null
  multicall: Address | null
  tokens: uni.Token[]
  pools: uni.Pool[]
  balances: Record<string, bigint>
  /** LP balances, index-aligned with pools. */
  lp: bigint[]
}

export const dex = reactive<DexState>({
  status: 'loading',
  error: '',
  router: null,
  factory: null,
  weth: null,
  multicall: null,
  tokens: [],
  pools: [],
  balances: {},
  lp: [],
})

export const dexAccount = () => account()

const client = () => publicClient(wallet.info!.l2.chainId)

export function tokenByKey(key: string): uni.Token | undefined {
  return dex.tokens.find((t) => uni.tokenKey(t) === key)
}

export function tokenByAddress(address: string): uni.Token | undefined {
  // The ERC-20 spelling, never ZNN: a pool holds WZNN.
  return dex.tokens.find((t) => !t.native && uni.same(t.address, address))
}

export async function loadDex(): Promise<void> {
  try {
    const info = wallet.info ?? (wallet.info = await api.info())
    const d = info.uniswapV2
    if (!d) {
      dex.status = 'absent'
      return
    }
    const code = await client().getCode({address: d.router as Address})
    if (!code || code === '0x') {
      dex.status = 'stale'
      return
    }
    dex.router = d.router as Address
    dex.factory = d.factory as Address
    dex.weth = d.weth as Address
    dex.multicall = info.predeploys.Multicall3 as Address

    const [pools, indexed] = await Promise.all([
      uni.loadPools(client(), dex.multicall, dex.factory),
      api.tokens({limit: 100}).catch(() => [] as any[]),
    ])
    const listed = [
      ...d.tokens,
      ...pools.flatMap((p) => [p.token0, p.token1]),
      ...indexed.filter((t) => t.kind === 'erc20').map((t) => t.address as string),
    ]
    const tokens = await uni.loadTokens(client(), dex.multicall, dex.weth, listed)
    // The deployment's own tokens first, wrapped ZNN last: it is ZNN's plumbing.
    const rank = (t: uni.Token) =>
      uni.same(t.address, dex.weth!) ? 2 : d.tokens.some((a) => uni.same(a, t.address)) ? 0 : 1
    tokens.sort((a, b) => rank(a) - rank(b) || a.symbol.localeCompare(b.symbol))
    dex.tokens = [uni.nativeToken(dex.weth), ...tokens]
    dex.pools = pools
    dex.status = 'ready'
    await refreshAccount()
  } catch (err: any) {
    dex.status = 'error'
    dex.error = err?.shortMessage ?? err?.message ?? String(err)
  }
}

export async function refreshAccount(): Promise<void> {
  const owner = dexAccount()
  if (!owner || dex.status !== 'ready') {
    dex.balances = {}
    dex.lp = []
    return
  }
  const [balances, lp] = await Promise.all([
    uni.loadBalances(client(), dex.multicall!, owner, dex.tokens),
    uni.lpBalances(client(), dex.multicall!, owner, dex.pools),
  ])
  dex.balances = balances
  dex.lp = lp
}

/** Reserves move every block that trades, so the page refreshes once a momentum. */
export async function refreshDex(): Promise<void> {
  if (dex.status !== 'ready') return
  const pools = await uni.loadPools(client(), dex.multicall!, dex.factory!)
  const known = new Set(dex.tokens.map((t) => t.address.toLowerCase()))
  const unseen = pools.flatMap((p) => [p.token0, p.token1]).filter((a) => !known.has(a.toLowerCase()))
  if (unseen.length) dex.tokens.push(...(await uni.loadTokens(client(), dex.multicall!, dex.weth!, unseen)))
  dex.pools = pools
  await refreshAccount()
}

/** Adds a token someone pasted, and returns it. */
export async function importToken(address: string): Promise<uni.Token> {
  const existing = tokenByAddress(address)
  if (existing) return existing
  const [token] = await uni.loadTokens(client(), dex.multicall!, dex.weth!, [address])
  if (!token) throw new Error('that address has no ERC-20 decimals()')
  dex.tokens.push(token)
  await refreshAccount()
  return token
}
