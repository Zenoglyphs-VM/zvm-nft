// The bits every market surface repeats: whether the exchange may move a
// collection's tokens yet, and running an action — the transactions it needs,
// then the signature, if it is an order (D28).

import {ref} from 'vue'
import type {Address} from 'viem'
import {publicClient} from './evm'
import {wallet} from './wallet'
import {dexAccount} from './dexState'
import {runCalls, runStep, type Step} from './lanes'
import {approveCollectionCall, collectionAbi} from './nft'
import type {Call} from './uniswap'

export function useMarket() {
  const steps = ref<Step[]>([])
  const busy = ref(false)
  const error = ref('')

  /**
   * Runs an action: the calls it needs, in order, then `sign` — a signature
   * handed to the node, which is what a listing or a bid is. Refreshes after.
   */
  async function run(
    build: () => Promise<Call[]> | Call[],
    after?: () => Promise<void> | void,
    sign?: {label: string; fn: () => Promise<string | void>},
  ): Promise<boolean> {
    busy.value = true
    error.value = ''
    steps.value = []
    try {
      const calls = await build()
      if (!calls.length && !sign) return false
      let done = calls.length ? await runCalls(calls, (s) => (steps.value = s)) : []
      let ok = done.every((s) => s.state === 'done')
      if (ok && sign) {
        const list = [...done]
        ok = await runStep(sign.label, list, (s) => (steps.value = s), sign.fn)
      }
      if (ok && after) await after()
      return ok
    } catch (err: any) {
      error.value = err?.shortMessage ?? err?.message ?? String(err)
      return false
    } finally {
      busy.value = false
    }
  }

  /** The approval a seller needs once per collection, and only if it is missing. */
  async function approvalFor(collection: Address, owner: Address, operator: Address, name: string): Promise<Call[]> {
    const client = publicClient(wallet.info!.l2.chainId)
    const approved = await client.readContract({
      address: collection,
      abi: collectionAbi,
      functionName: 'isApprovedForAll',
      args: [owner, operator],
    })
    return approved ? [] : [approveCollectionCall(collection, operator, name)]
  }

  return {steps, busy, error, run, approvalFor, account: dexAccount}
}

export const exchangeAddress = () => (wallet.info?.apps?.exchange ?? null) as Address | null
export const factoryAddress = () => (wallet.info?.apps?.collectionFactory ?? null) as Address | null
export const sameAddress = (a?: string | null, b?: string | null) => !!a && !!b && a.toLowerCase() === b.toLowerCase()
