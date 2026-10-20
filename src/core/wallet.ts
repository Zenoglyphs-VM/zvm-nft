// Who is connected, and what the node currently says about the chain — in one
// place, so no page re-attaches listeners or re-polls on its own.
//
// Two wallets, because this chain has two lanes. An EVM wallet signs an
// ordinary transaction that a relayer posts to NoM. Syrius signs a Zenon
// account block, which *is* the signature for the native lane. They are not
// interchangeable, and the header shows both rather than pretending one
// "connect" covers the chain.

import {reactive, computed, watch} from 'vue'
import type {Address} from 'viem'
import * as evm from './evm'
import {api, type ChainInfo} from './api'
import {endpoint, check} from './endpoint'

interface State {
  info: ChainInfo | null
  infoError: string | null
  evm: {name: string | null; address: Address | null; chainId: number | null; provider: any | null}
  error: string | null
}

export const wallet = reactive<State>({
  info: null,
  infoError: null,
  evm: {name: null, address: null, chainId: null, provider: null},
  error: null,
})

export const evmReady = computed(() => !!wallet.evm.address)

/** True when the wallet is pointed at a different chain than the node serves. */
export const wrongChain = computed(
  () => !!wallet.evm.address && !!wallet.info && wallet.evm.chainId !== wallet.info.l2.chainId,
)

let timer: number | undefined

export async function refreshInfo() {
  try {
    wallet.info = await api.info()
    wallet.infoError = null
  } catch (err: any) {
    wallet.infoError = err?.message ?? String(err)
  }
}

export function startPolling(intervalMs = 5000) {
  if (timer) return
  refreshInfo()
  timer = window.setInterval(refreshInfo, intervalMs)
}

// A new node is a new chain until proven otherwise: drop what the old one said
// rather than showing its head height under the new endpoint's name.
watch(
  () => endpoint.url,
  () => {
    wallet.info = null
    wallet.infoError = null
    refreshInfo()
  },
)

export async function connectEvm(provider: any, name: string) {
  wallet.error = null
  const chainId = wallet.info?.l2.chainId
  if (!chainId) throw new Error('No node connected. Set the endpoint first.')
  try {
    const address = await evm.connect(provider, chainId)
    wallet.evm = {name, address, chainId, provider}
    provider.on?.('accountsChanged', (accounts: Address[]) => {
      wallet.evm.address = accounts?.[0] ?? null
      if (!accounts?.length) disconnectEvm()
    })
    provider.on?.('chainChanged', (id: string) => {
      wallet.evm.chainId = Number(id)
    })
  } catch (err: any) {
    wallet.error = readable(err)
    throw err
  }
}

export function disconnectEvm() {
  wallet.evm = {name: null, address: null, chainId: null, provider: null}
}

/** Switches the connected wallet back to the chain this node serves. */
export async function switchToChain() {
  const chainId = wallet.info?.l2.chainId
  if (!chainId || !wallet.evm.provider) return
  try {
    await evm.ensureChain(wallet.evm.provider, chainId)
    wallet.evm.chainId = chainId
  } catch (err: any) {
    wallet.error = readable(err)
  }
}

const readable = (err: any): string => err?.shortMessage ?? err?.message ?? String(err)

export function init() {
  check()
  startPolling()
}
