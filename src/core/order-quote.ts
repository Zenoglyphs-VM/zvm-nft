// Exact user-entered prices and the context an order-entry action was made in.
// No provider error, URL or account metadata is serialized by these helpers.
type Address = `0x${string}`
const ZERO = ('0x' + '0'.repeat(40)) as Address
const ADDRESS = /^0x[0-9a-fA-F]{40}$/
const UINT256 = 1n << 256n

function decimals(value: number) {
  if (!Number.isInteger(value) || value < 0 || value > 18) throw new Error('The price currency needs review.')
}
export function quotedAmount(input: string, precision: number): bigint {
  decimals(precision)
  if (typeof input !== 'string' || input.length > 256) throw new Error('Enter an exact positive price.')
  const value = input.trim()
  if (!/^(?:[0-9]+|[0-9]{1,3}(?:,[0-9]{3})+)(?:\.[0-9]+)?$/.test(value))
    throw new Error('Enter a decimal price without signs or exponents.')
  const [whole, fraction = ''] = value.replace(/,/g, '').split('.')
  if (fraction.length > precision) throw new Error('The price has more decimal places than this currency supports.')
  const result = BigInt(whole) * 10n ** BigInt(precision) + BigInt((fraction || '0').padEnd(precision, '0'))
  if (result <= 0n || result >= UINT256) throw new Error('Enter a positive price within the supported amount range.')
  return result
}
export function quoteAmountText(input: string | bigint, precision: number): string {
  decimals(precision)
  if (typeof input !== 'bigint' && (typeof input !== 'string' || !/^[0-9]{1,78}$/.test(input)))
    throw new Error('The original listing price needs review.')
  const value = BigInt(input)
  if (value < 0n || value >= UINT256) throw new Error('The original listing price is out of range.')
  if (!precision) return value.toString()
  const scale = 10n ** BigInt(precision)
  const fraction = (value % scale).toString().padStart(precision, '0').replace(/0+$/, '')
  return (value / scale).toString() + (fraction ? '.' + fraction : '')
}
export function quotedCount(value: number): bigint {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error('Enter a positive whole number of items.')
  return BigInt(value)
}
export function quoteTotal(price: bigint, count: bigint): bigint {
  const result = price * count
  if (price <= 0n || count <= 0n || result >= UINT256) throw new Error('The total order amount is out of range.')
  return result
}
export function listingQuote(input: string, currency: 'znn' | 'qsr', rewardToken?: string | null) {
  let paymentToken: Address = ZERO
  if (currency !== 'znn' && currency !== 'qsr') throw new Error('Choose a supported listing currency.')
  if (currency === 'qsr') {
    if (typeof rewardToken !== 'string' || !ADDRESS.test(rewardToken) || /^0x0{40}$/i.test(rewardToken))
      throw new Error('QSR is unavailable on this node. Review the currency before listing.')
    paymentToken = rewardToken.toLowerCase() as Address
  }
  const precision = currency === 'qsr' ? 8 : 18
  const amount = quotedAmount(input, precision)
  return Object.freeze({amount, paymentToken, decimals: precision,
    symbol: currency === 'qsr' ? 'QSR' : 'ZNN', text: quoteAmountText(amount, precision)})
}
export function relistingQuote(input: string, paymentToken: string | null | undefined, rewardToken?: string | null) {
  if (typeof paymentToken !== 'string' || !ADDRESS.test(paymentToken))
    throw new Error('Review the original listing currency before setting its price.')
  let currency: 'znn' | 'qsr'
  if (/^0x0{40}$/i.test(paymentToken)) currency = 'znn'
  else if (typeof rewardToken === 'string' && ADDRESS.test(rewardToken) &&
           paymentToken.toLowerCase() === rewardToken.toLowerCase()) currency = 'qsr'
  else throw new Error('Choose a supported listing currency and enter its price.')
  return {currency, text: quoteAmountText(input, currency === 'qsr' ? 8 : 18)}
}

export interface OrderQuoteContext {
  endpoint: string
  chainId: number | null | undefined
  walletChainId: number | null | undefined
  owner: string | null | undefined
  signer: string | null | undefined
  exchange: string | null | undefined
  provider: unknown
  paymentToken: string | null | undefined
  selection: string
}
function context(value: OrderQuoteContext) {
  const addr = (input: unknown, nonzero = true) => {
    if (typeof input !== 'string' || !ADDRESS.test(input) || (nonzero && /^0x0{40}$/i.test(input)))
      throw new Error('Review the connected account, currency and exchange before signing.')
    return input.toLowerCase()
  }
  const owner = addr(value.owner), signer = addr(value.signer)
  if (owner !== signer || typeof value.chainId !== 'number' || !Number.isSafeInteger(value.chainId) || value.chainId <= 0 ||
      value.walletChainId !== value.chainId || !value.provider ||
      !['object', 'function'].includes(typeof value.provider) || Array.isArray(value.provider) ||
      typeof value.endpoint !== 'string' || !value.endpoint ||
      typeof value.selection !== 'string' || !value.selection || value.selection.length > 16384)
    throw new Error('Review the selected items and connected EVM account before signing.')
  return {...value, owner, signer, exchange: addr(value.exchange), paymentToken: addr(value.paymentToken, false)}
}
export function quoteContextGuard(read: () => OrderQuoteContext, captured = read()): () => void {
  const original = context(captured)
  const guard = () => {
    let current: ReturnType<typeof context>
    try {current = context(read())}
    catch {throw new Error('The account, network or selected items changed. Review the order again.')}
    if (Object.keys(original).some(key => current[key as keyof typeof current] !== original[key as keyof typeof original]))
      throw new Error('The account, network or selected items changed. Review the order again.')
  }
  guard()
  return guard
}
export function guardedQuoteCalls<T extends {guard?: () => void}>(calls: T[], guard: () => void): T[] {
  return calls.map(call => {
    const previous = call.guard
    return {...call, guard: () => {guard(); previous?.()}}
  })
}
