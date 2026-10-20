// What this app tells @zvm/web about itself. Imported first, before anything
// that reads a number or builds a client.

import {configure} from '@zvm/web'

import {base} from './endpoint'

configure({
  // A dash: in a table, a value the node did not give us is not zero.
  empty: '-',
  // The node serves the API, the EVM RPC and the UI from one port.
  rpcUrl: () => `${base()}/rpc`,
  // Where this explorer lives, for a wallet's "view on explorer" link.
  appUrl: () => (typeof window === 'undefined' ? '' : `${window.location.origin}${import.meta.env.BASE_URL.replace(/\/$/, '')}`),
  chainName: () => 'ZVM',
})
