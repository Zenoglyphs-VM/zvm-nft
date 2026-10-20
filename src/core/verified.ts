// Which addresses on a page are verified contracts, asked of the node in
// batches: an address list renders dozens of links, and each asking alone would
// be dozens of requests.

import {reactive} from 'vue'
import {api} from './api'
import {isNomAddress, nomToHex} from './address'

export interface VerifiedMark {
  name: string
  match: 'exact' | 'partial'
  /** The address forwards to verified code rather than being it. */
  proxy?: boolean
}

// Lower-case 0x address → its mark, or null once the node has said it has none.
const marks = reactive(new Map<string, VerifiedMark | null>())
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
      const found = await api.verifiedMarks(chunk)
      const byKey = new Map(Object.entries(found).map(([k, v]) => [k.toLowerCase(), v]))
      for (const k of chunk) marks.set(k, byKey.get(k) ?? null)
    } catch {
      // Unanswered is shown as unverified; the next page load asks again.
      for (const k of chunk) marks.set(k, null)
    }
  }
}

/** The mark for an address: undefined while the node is being asked, null when there is none. */
export function markFor(address: string | null | undefined): VerifiedMark | null | undefined {
  if (!address) return null
  const key = keyOf(address)
  if (!key) return null
  if (!marks.has(key) && !pending.has(key)) {
    pending.add(key)
    timer ??= window.setTimeout(flush, 40)
  }
  return marks.get(key)
}

/** Forget what is known about an address, after its sources were published. */
export function forgetMark(address: string) {
  const key = keyOf(address)
  if (key) marks.delete(key)
}
