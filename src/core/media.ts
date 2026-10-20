// The node's media store, from the page.
//
// Every path here resolves against the *node*, not against this page. The
// pages this is derived from were served by the node itself, so a token URI of
// `/media/<hash>.png` was same-origin and worked by accident. A static bundle
// has no node of its own, and resolving those against its own origin asks
// GitHub Pages for art it has never heard of.
//
// Objects are named by the hash of their bytes, so a token URI written as
// https://nft.example.org/<hash>.png and the same object served by this node are
// the same thing. `mediaURL` rewrites one to the other, which is what lets a
// page show art before that hostname is in front of anything.
//
// Uploading takes a signature, once per session: a Sign-In with Ethereum
// (EIP-4361) message the node writes, which the wallet shows as a sign-in
// bound to this site (D31).

import type {Address} from 'viem'
import {api} from './api'
import {base as nodeBase} from './endpoint'
import {wallet} from './wallet'
import {walletClient} from './evm'

const HASH = /^[0-9a-f]{64}$/

/** Where this page should load a stored object from, given any spelling of it. */
export function mediaURL(uri: string | null | undefined): string {
  if (!uri) return ''
  if (uri.startsWith('data:')) return uri
  const base = wallet.info?.media?.loadUrl
  try {
    const url = new URL(uri, nodeBase())
    const parts = url.pathname.replace(/^\/media\//, '/').split('/').filter(Boolean)
    const [hash] = (parts[0] ?? '').split('.')
    if (!base || !HASH.test(hash)) return url.toString()
    const root = base.startsWith('http') ? base.replace(/\/$/, '') : nodeBase() + base
    return `${root}/${parts.join('/')}`
  } catch {
    return ''
  }
}

interface Session {
  token: string
  address: string
  expiresAt: number
}

const KEY = 'zvm.media.session'

function cached(address: string): Session | null {
  try {
    const raw = sessionStorage.getItem(KEY)
    if (!raw) return null
    const s = JSON.parse(raw) as Session
    if (s.address.toLowerCase() !== address.toLowerCase()) return null
    if (s.expiresAt * 1000 < Date.now() + 60_000) return null
    return s
  } catch {
    return null
  }
}

/**
 * Signs in to the media store, once per wallet per tab. The message says what
 * it is for, which address and site it binds, and when it stops working;
 * nothing else is signed, and nothing is broadcast.
 */
export async function mediaSession(): Promise<Session> {
  const address = wallet.evm.address
  if (!address || !wallet.evm.provider || !wallet.info) throw new Error('connect a wallet first')
  const have = cached(address)
  if (have) return have

  const {message} = await api.mediaChallenge(address)
  const signature = await walletClient(wallet.evm.provider, wallet.info.l2.chainId, address as Address).signMessage({
    account: address as Address,
    message,
  })
  const session = {...(await api.mediaSession({address, message, signature})), address}
  try {
    sessionStorage.setItem(KEY, JSON.stringify(session))
  } catch {
    // A private window keeps nothing; the session still works for this upload.
  }
  return session
}

export interface Stored {
  hash: string
  url: string
  contentType: string
  size: number
}

export async function uploadBytes(data: Blob, contentType: string): Promise<Stored> {
  const session = await mediaSession()
  const res = await fetch('/api/media', {
    method: 'POST',
    headers: {'content-type': contentType, authorization: `Bearer ${session.token}`},
    body: data,
  })
  const body = await res.json().catch(() => ({error: `${res.status} ${res.statusText}`}))
  if (!res.ok) throw new Error(body?.error ?? `${res.status} ${res.statusText}`)
  return body as Stored
}

export function uploadJSON(doc: unknown): Promise<Stored> {
  return uploadBytes(new Blob([JSON.stringify(doc)], {type: 'application/json'}), 'application/json')
}

/** The image types the store takes, for a file picker's accept attribute. */
export const IMAGE_TYPES = 'image/png,image/jpeg,image/gif,image/webp,image/avif,image/svg+xml'

export function maxImageBytes(): number {
  return wallet.info?.media?.maxImageBytes ?? 10 * 1024 * 1024
}
