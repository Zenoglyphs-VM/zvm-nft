// Sending contract calls from the connected wallet, and knowing when they
// landed. The wallet signs an ordinary transaction; the node's /rpc hands it to
// the relayer, which posts it to NoM, and it is a ZVM transaction once the
// momentum carrying it is derived.

import type {Address, Hex, TransactionReceipt} from 'viem'
import {estimateFees, publicClient, walletClient} from './evm'
import {wallet} from './wallet'
/** One contract call a wallet is asked to sign. */
export interface Call {
  to: Address
  data: Hex
  value: bigint
  /** Recheck the selected account and node after asynchronous preparation. */
  guard?: () => void
  /** Synchronously retain recovery context immediately before a wallet request. */
  onRequest?: () => void
  /** Synchronously retain the wallet's exact hash before waiting for execution. */
  onSubmitted?: (hash: string) => void
  /** Distinguish failures before dispatch from an uncertain requested outcome. */
  onFailed?: (error: unknown, requested: boolean) => void
  /** A generous limit, used where estimating is impossible. */
  gas: bigint
  label: string
}

export interface Step {
  label: string
  state: 'pending' | 'signing' | 'published' | 'done' | 'failed'
  txHash?: string
  detail?: string
  /** The executed receipt, kept in memory for flow-specific reconciliation. */
  receipt?: TransactionReceipt
}

/** The account calls are sent from, or null when no wallet is connected. */
export function account(): Address | null {
  return (wallet.evm.address as Address | null) ?? null
}

const reason = (err: any): string => err?.shortMessage ?? err?.details ?? err?.message ?? String(err)
const RECEIPT = {pollingInterval: 2_000, timeout: 600_000}

async function estimate(from: Address, call: Call): Promise<bigint> {
  const client = publicClient(wallet.info!.l2.chainId)
  const est = await client.estimateGas({account: from, to: call.to, data: call.data, value: call.value})
  return (est * 13n) / 10n
}

/**
 * Runs calls in order, waiting for each receipt, because a wallet estimates the
 * next transaction against the chain as it is.
 */
export async function runCalls(calls: Call[], update: (steps: Step[]) => void): Promise<Step[]> {
  const info = wallet.info
  if (!info) throw new Error('chain info not loaded yet')
  const steps: Step[] = calls.map((c) => ({label: c.label, state: 'pending'}))
  const emit = () => update(steps.map((s) => ({...s})))
  const client = publicClient(info.l2.chainId)
  emit()

  const from = account()
  if (!from || !wallet.evm.provider) throw new Error('connect a wallet first')
  const signer = walletClient(wallet.evm.provider, info.l2.chainId, from)
  for (const [i, call] of calls.entries()) {
    const step = steps[i]
    let requested = false
    try {
      call.guard?.()
      step.state = 'signing'
      emit()
      const [gas, {maxFeePerGas, maxPriorityFeePerGas}] = await Promise.all([estimate(from, call), estimateFees(info.l2.chainId)])
      call.guard?.()
      if (call.onRequest) {
        call.onRequest()
        call.guard?.()
      }
      requested = true
      const hash = await signer.sendTransaction({to: call.to, data: call.data, value: call.value, gas, maxFeePerGas, maxPriorityFeePerGas})
      step.txHash = hash
      call.onSubmitted?.(hash)
      step.state = 'published'
      emit()
      const r = await client.waitForTransactionReceipt({hash, ...RECEIPT})
      if (r.status !== 'success') throw new Error('reverted on the ZVM')
      step.receipt = r
      step.state = 'done'
      emit()
    } catch (err) {
      step.state = 'failed'
      step.detail = reason(err)
      try {call.onFailed?.(err, requested)} catch {
        step.detail += ' The recovery record could not be updated; keep any original transaction hash.'
      }
      emit()
      return steps
    }
  }
  return steps
}

/** A step that is not a transaction — a signature handed to the node. */
export async function runStep(label: string, steps: Step[], update: (steps: Step[]) => void, fn: () => Promise<string | void>): Promise<boolean> {
  const step: Step = {label, state: 'signing'}
  steps.push(step)
  update(steps.map((s) => ({...s})))
  try {
    const detail = await fn()
    step.state = 'done'
    if (detail) step.detail = detail
    update(steps.map((s) => ({...s})))
    return true
  } catch (err) {
    step.state = 'failed'
    step.detail = reason(err)
    update(steps.map((s) => ({...s})))
    return false
  }
}
