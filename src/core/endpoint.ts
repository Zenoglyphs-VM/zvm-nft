// Which node this explorer is reading.
//
// The node-embedded explorer this is derived from asked its own origin for
// everything. Nothing here has an origin worth asking: it is a static bundle on
// GitHub Pages, so the node is a setting, and every request in the app is built
// from `base()` rather than a leading slash.
//
// The ZVM node already answers with `Access-Control-Allow-Origin: *`
// (internal/api/api.go), so a cross-origin read needs nothing from the operator.

import {reactive, computed} from 'vue'

import {isLoopback, mixedContentBlocked} from '@zvm/web/url'

const KEY = 'zvm.endpoint'
// Both shared with glyphswap: what a browser treats as trustworthy, and what
// it refuses before the request is made, are facts about browsers.
export {isLoopback, mixedContentBlocked}

// The node this build reads comes from the environment (see .env.example), so
// no node is written into the source. VITE_ZVM_NODE is a ZVM node's base URL,
// the one its /api and /rpc hang off; a local zvm-devnet's is
// http://localhost:47080/zvm.
export const DEFAULT_ENDPOINT = normalize(import.meta.env.VITE_ZVM_NODE as string)

export type Health = 'idle' | 'checking' | 'ok' | 'error'

export interface EndpointState {
  /** Normalized base URL: scheme, host, port, no trailing slash. */
  url: string
  health: Health
  /** What went wrong, written for the person who has to fix it. */
  error: string | null
  /** A second line naming the fix, when there is a specific one. */
  hint: string | null
  /** Round trip to /api/info, in ms. */
  latency: number | null
  chainId: number | null
}

export const endpoint = reactive<EndpointState>({
  url: initial(),
  health: 'idle',
  error: null,
  hint: null,
  latency: null,
  chainId: null,
})

/**
 * Accepts what people actually paste: a bare host, a host:port, the RPC path,
 * or the explorer root. All of them mean the same node.
 */
export function normalize(input: string): string {
  let s = input.trim()
  if (!s) return ''
  if (!/^https?:\/\//i.test(s)) s = `http://${s}`
  let u: URL
  try {
    u = new URL(s)
  } catch {
    return ''
  }
  // The node serves the API, the EVM RPC and the UI from one port, so any of
  // its paths identifies it. Keep a genuine sub-path (a node behind a reverse
  // proxy at /zvm), drop the ones that are endpoints rather than a base.
  let path = u.pathname.replace(/\/+$/, '')
  path = path.replace(/\/(rpc|l1rpc|api|healthz)$/i, '')
  return `${u.protocol}//${u.host}${path}`
}

function initial(): string {
  // A link can carry the node, so one can be shared: ?rpc=https://host
  try {
    const q = new URLSearchParams(location.search)
    const fromQuery = q.get('rpc') ?? q.get('node') ?? q.get('endpoint')
    if (fromQuery) {
      const url = normalize(fromQuery)
      if (url) {
        save(url)
        return url
      }
    }
  } catch {
    /* no query, or no location */
  }
  try {
    const saved = localStorage.getItem(KEY)
    if (saved) return saved
  } catch {
    /* storage can be blocked */
  }
  return DEFAULT_ENDPOINT
}

function save(url: string) {
  try {
    localStorage.setItem(KEY, url)
  } catch {
    /* storage can be blocked; the endpoint still works for this tab */
  }
}

export const base = () => endpoint.url

/** Points the explorer at a different node and re-checks it. */
export async function setEndpoint(input: string): Promise<boolean> {
  const url = normalize(input)
  if (!url) {
    endpoint.error = `That is not a URL. Try ${DEFAULT_ENDPOINT}`
    endpoint.hint = null
    endpoint.health = 'error'
    return false
  }
  endpoint.url = url
  save(url)
  return check()
}

export function resetEndpoint() {
  return setEndpoint(DEFAULT_ENDPOINT)
}

let checking: Promise<boolean> | null = null

/** Asks the node who it is, and classifies the failure when it does not answer. */
export function check(): Promise<boolean> {
  if (checking) return checking
  checking = run().finally(() => {
    checking = null
  })
  return checking
}

async function run(): Promise<boolean> {
  const url = endpoint.url
  endpoint.health = 'checking'
  endpoint.error = null
  endpoint.hint = null

  if (mixedContentBlocked(url)) {
    fail(
      `This page is served over HTTPS and cannot load ${new URL(url).host} over plain HTTP.`,
      'Use an HTTPS address, or http://localhost, which browsers allow from an HTTPS page.',
    )
    return false
  }

  const started = performance.now()
  try {
    const res = await fetch(`${url}/api/info`, {
      headers: {accept: 'application/json'},
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) {
      fail(`${new URL(url).host} answered ${res.status} ${res.statusText}.`, 'Check the port. A ZVM node serves /api/info on its explorer port, 47000 by default.')
      return false
    }
    const body = await res.json()
    if (!body?.l2?.chainId) {
      fail(`${new URL(url).host} answered, but not like a ZVM node.`, 'Point this at the node’s explorer port rather than op-reth or the NoM RPC.')
      return false
    }
    endpoint.latency = Math.round(performance.now() - started)
    endpoint.chainId = Number(body.l2.chainId)
    endpoint.health = 'ok'
    endpoint.error = null
    endpoint.hint = null
    return true
  } catch (err: any) {
    if (err?.name === 'TimeoutError') {
      fail(`${hostOf(url)} did not answer within 8 seconds.`, 'The node may be starting up, or the port may be firewalled.')
      return false
    }
    // A cross-origin failure is opaque by design: the browser will not say
    // whether it was DNS, a refused connection, CORS, or Chrome's local network
    // check. Naming the likely causes beats repeating "failed to fetch".
    fail(
      `Could not reach ${hostOf(url)}.`,
      isLoopback(url)
        ? 'Start the node, or check the port. If it is running, your browser may be asking you to allow access to local network devices.'
        : 'Check the node is running and reachable, and that it allows requests from this page.',
    )
    return false
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

function fail(error: string, hint: string | null) {
  endpoint.health = 'error'
  endpoint.error = error
  endpoint.hint = hint
  endpoint.latency = null
  endpoint.chainId = null
}

export const reachable = computed(() => endpoint.health === 'ok')
