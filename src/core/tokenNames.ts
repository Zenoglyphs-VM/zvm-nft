// Which addresses on a page are tokens, asked of the node in batches — the
// same shape as core/verified.ts, for the same reason: a page can render
// dozens of AddressLinks, and each asking alone would be dozens of requests.

import {reactive} from 'vue'
import {api} from './api'
import {isNomAddress, nomToHex} from './address'

export interface TokenName {
  name: string
  symbol: string
}

// Lower-case 0x address → its name, or null once the node has said it has none.
const names = reactive(new Map<string, TokenName | null>())
const pending = new Set<string>()
let timer: number | undefined

const BATCH = 100

function keyOf(address: string): string | null {
  const s = address.trim()
  const hex = isNomAddress(s) ? nomToHex(s) : s
  return /^0x[0-9a-fA-F]{40}$/.test(hex) ? hex.toLowerCase() : null
}

async function flush() {
  timer = undefined
  const keys = [...pending]
  pending.clear()
  for (let i = 0; i < keys.length; i += BATCH) {
    const chunk = keys.slice(i, i + BATCH)
    try {
      const found = await api.tokenNames(chunk)
      const byKey = new Map(Object.entries(found).map(([k, v]) => [k.toLowerCase(), v]))
      for (const k of chunk) names.set(k, byKey.get(k) ?? null)
    } catch {
      // Unanswered is shown as unnamed; the next page load asks again.
      for (const k of chunk) names.set(k, null)
    }
  }
}

/** The token name/symbol for an address: undefined while the node is being asked, null when there is none. */
export function tokenNameFor(address: string | null | undefined): TokenName | null | undefined {
  if (!address) return null
  const key = keyOf(address)
  if (!key) return null
  if (!names.has(key) && !pending.has(key)) {
    pending.add(key)
    timer ??= window.setTimeout(flush, 40)
  }
  return names.get(key)
}
