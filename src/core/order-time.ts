// Signed order times remain exact even outside JavaScript's calendar range.
export type OrderTime = string | number | bigint

function seconds(value: unknown): bigint | null {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) return null
  if (typeof value !== 'bigint' && typeof value !== 'number' &&
      !(typeof value === 'string' && /^[0-9]{1,20}$/.test(value))) return null
  const result = BigInt(value)
  return result >= 0n && result < (1n << 64n) ? result : null
}

/** A calendar label only when the exact millisecond value fits Date. */
export function orderDate(value: unknown): string {
  const ts = seconds(value)
  if (ts === null) return '-'
  if (ts > 8_640_000_000_000n) return 'Far future'
  return new Date(Number(ts * 1000n)).toLocaleDateString()
}

export function orderExpiry(value: unknown): string {
  const ts = seconds(value)
  if (ts === null) return '-'
  return ts <= BigInt(Math.floor(Date.now() / 1000)) ? 'expired' : orderDate(ts)
}

/** Integer arithmetic keeps even the largest uint64 countdown exact. */
export function orderCountdown(value: unknown): string {
  const ts = seconds(value)
  if (ts === null) return ''
  const delta = ts - BigInt(Math.floor(Date.now() / 1000))
  const s = delta > 0n ? delta : 0n
  if (s >= 86400n) return `${s / 86400n}d ${(s % 86400n) / 3600n}h`
  if (s >= 3600n) return `${s / 3600n}h ${(s % 3600n) / 60n}m`
  if (s >= 60n) return `${s / 60n}m ${s % 60n}s`
  return `${s}s`
}
