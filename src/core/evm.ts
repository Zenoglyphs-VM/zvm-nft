// EVM wallets and the viem clients, from @zvm/web.
//
// The two app-specific pieces stay here: this explorer's endpoint is a node's
// API base with the JSON-RPC hanging off it, and its "view on explorer" link
// points at itself.

import {base} from './endpoint'

export * from '@zvm/web/evm'

/** The node's JSON-RPC, which is its explorer port plus /rpc. */
export const rpcUrl = () => `${base()}/rpc`

/** Where this explorer lives, for the wallet's "view on explorer" link. */
export function explorerUrl(): string {
  if (typeof window === 'undefined') return ''
  return `${window.location.origin}${import.meta.env.BASE_URL.replace(/\/$/, '')}`
}
