<script setup lang="ts">
import {computed, onMounted, onUnmounted, reactive, ref, shallowRef, watch} from 'vue'
import {formatUnits, isAddress, keccak256, stringToHex} from 'viem'
import {endpoint, base} from '../core/endpoint'
import {wallet, wrongChain} from '../core/wallet'
import {exchangeAddress} from '../core/market'
import {runCalls, type Step} from '../core/lanes'
import {CreditController, creditJournalKey, CREDIT_HISTORY_LIMIT, type CreditContext, type CreditView, type CreditEntry} from '../core/credits'
import {creditRpc} from '../core/credit-rpc'
import {walletJournalKey} from '../core/credit-wallet'
import {creditReadData, creditWithdrawData} from '../core/credit-calls'
import StepList from './StepList.vue'

const props = defineProps<{owner: string}>()
const steps = ref<Step[]>([])
const view = shallowRef<CreditView>({amount: null, loading: false, busy: false, canWithdraw: false,
  unsaved: false, error: '', note: '', entries: []})
const available = ref(false)
const downloadError = ref('')
const hashes = reactive<Record<string, string>>(Object.create(null))
const canCoordinate = computed(() => typeof navigator !== 'undefined' && !!navigator.locks)
let selected: {context: CreditContext; provider: unknown} | null = null
const chainId = () => wallet.info?.l2.chainId ?? null
const rpcUrl = () => `${base()}/rpc`
const exchange = () => exchangeAddress()
const account = () => wallet.evm.address
const provider = () => wallet.evm.provider
const walletChain = () => wallet.evm.chainId

const controller = new CreditController({
  storage: {getItem: key => localStorage.getItem(key), setItem: (key, value) => localStorage.setItem(key, value)},
  exclusive: async (key, action) => {
    if (!navigator.locks) throw new Error('Withdrawal coordination is unavailable.')
    await navigator.locks.request(key, {mode: 'exclusive', ifAvailable: true}, async lock => {
      if (!lock) throw new Error('Another withdrawal is already active in this browser.')
      await action()
    })
  },
  canSend: context => !!selected && context.rpc === selected.context.rpc &&
    selected.provider === provider() && !!provider() && canCoordinate.value && endpoint.health === 'ok' &&
    !wrongChain.value && walletChain() === context.chainId && account()?.toLowerCase() === context.owner,
  send: async call => {
    steps.value = []
    await runCalls([call], next => {steps.value = next})
  },
  wallet: context => {
    const captured = provider()
    const current = () => !!selected && selected.context.rpc === context.rpc && selected.provider === captured &&
      captured === provider() && endpoint.health === 'ok' && !wrongChain.value && walletChain() === context.chainId && account()?.toLowerCase() === context.owner
    if (!captured || !current()) return null
    return {
      id: () => '0x' + Array.from(crypto.getRandomValues(new Uint8Array(64)), byte => byte.toString(16).padStart(2, '0')).join(''),
      request: args => {
        if (!current()) throw new Error('The wallet context changed. Review the saved request before continuing.')
        return captured.request(args as any)
      },
    }
  },
  readData: creditReadData, withdrawData: creditWithdrawData(), id: () => crypto.randomUUID(),
  changed: next => {view.value = next},
})
watch([() => props.owner, chainId, rpcUrl, exchange, () => endpoint.health, account, provider, walletChain], () => {
  const chain = chainId(), ex = exchange(), rpc = rpcUrl()
  downloadError.value = ''
  steps.value = []
  if (!chain || !ex || typeof ex !== 'string' || !isAddress(ex) || /^0x0{40}$/i.test(ex) ||
    !isAddress(props.owner) || !rpc || endpoint.health !== 'ok') {
    available.value = false
    selected = null
    controller.setContext(null)
    return
  }
  const context: CreditContext = {chainId: chain, owner: props.owner.toLowerCase(), exchange: ex.toLowerCase(),
    endpointHash: keccak256(stringToHex(rpc)), rpc: creditRpc(rpc)}
  selected = {context, provider: provider()}
  available.value = true
  controller.setContext(context)
}, {immediate: true, flush: 'sync'})

const mine = computed(() => !!account() && account()!.toLowerCase() === props.owner.toLowerCase())
const amount = computed(() => view.value.amount === null ? '' : formatUnits(view.value.amount, 18))
const stateWord = {unknown: 'Original wallet request needs review', pending: 'Canonical receipt not confirmed',
  executed: 'Wallet transaction confirmed; credit was read again', reverted: 'Transaction reverted; credit was read again',
  'not-submitted': 'Wallet reports this request was not sent and will not be retried',
  'other-context': 'Reconnect the original chain context before resolving this withdrawal'}
function storageChanged(event: StorageEvent) {
  if (selected && (event.key === null || event.key === creditJournalKey(selected.context) || event.key === walletJournalKey(selected.context))) void controller.refresh()
}
function receiptHashes(entry: CreditEntry): string[] {
  if (entry.record.source !== 'wallet-calls') return []
  return [...new Set(entry.record.wallet.results.flatMap(result => result.receipts.map(receipt => receipt.transactionHash)))]
}
function withdraw() {steps.value = []; void controller.withdraw()}
function download() {
  try {
    const raw = controller.exportRecord()
    if (!raw) return
    const url = URL.createObjectURL(new Blob([raw], {type: 'application/json'}))
    const link = document.createElement('a')
    link.href = url
    link.download = 'exchange-credit-withdrawals.json'
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 0)
  } catch {downloadError.value = 'Could not export the saved record. Keep any original hash shown here and in the wallet.'}
}
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  window.addEventListener('storage', storageChanged)
  timer = setInterval(() => {if (!document.hidden) void controller.refresh()}, 15000)
})
onUnmounted(() => {clearInterval(timer); window.removeEventListener('storage', storageChanged); controller.dispose()})
</script>

<template>
  <section v-if="available" class="card p-4 grid gap-3" data-testid="exchange-credits"
    :data-credit-amount="view.loading || view.amount === null ? 'unknown' : view.amount.toString()">
    <div class="flex flex-wrap items-center gap-3">
      <h2 class="font-medium grow">Exchange credit</h2>
      <strong class="mono break-all" data-testid="exchange-credit-amount">{{ view.loading ? 'Checking...' : view.amount === null ? 'Unavailable' : `${amount} ZNN` }}</strong>
    </div>
    <p class="text-[13px] text-[var(--color-dim)]">Native ZNN held by the exchange after a payout or refund could not be delivered.
      Withdrawal sends all credit available when it executes to this account.</p>
    <div class="flex flex-wrap gap-2">
      <button class="btn btn-sm btn-plasma" data-testid="withdraw-exchange-credit" :disabled="!view.canWithdraw" @click="withdraw()">
        {{ view.busy ? 'Waiting for the wallet or execution...' : 'Withdraw available ZNN' }}
      </button>
      <button class="btn btn-sm" :disabled="view.busy || view.loading" @click="controller.refresh()">Refresh credit</button>
      <button v-if="view.entries.length || view.error" class="btn btn-sm" @click="download">Download recovery record</button>
      <button v-if="view.unsaved" class="btn btn-sm" :disabled="view.busy" @click="controller.saveRecovery()">Retry saving recovery details</button>
    </div>
    <p v-if="!mine" class="text-[12px] text-[var(--color-dim)]">Connect this account with the wallet control to withdraw its credit.</p>
    <p v-else-if="wrongChain" role="status" class="text-[12px] text-[var(--color-dim)]">Switch the wallet to this node's network before withdrawing.</p>
    <p v-if="!canCoordinate" role="status" class="text-[12px] text-[var(--color-dim)]">Withdrawal requires a browser with secure storage coordination. Credit can still be read.</p>
    <p v-if="view.entries.length >= CREDIT_HISTORY_LIMIT" role="status" class="text-[12px]">Recovery history is full. Export and review it before another withdrawal.</p>
    <p v-if="view.error" role="status" class="text-[13px] text-[var(--color-danger)]">{{ view.error }}</p>
    <p v-if="view.note" role="status" class="text-[13px] text-[var(--color-dim)]">{{ view.note }}</p>
    <p v-if="view.unsaved" role="status" class="text-[13px] text-[var(--color-danger)]">Recovery details have not been saved. Download the recovery record before leaving; another withdrawal is stopped.</p>
    <p v-if="downloadError" role="status" class="text-[13px] text-[var(--color-danger)]">{{ downloadError }}</p>
    <div v-for="entry in view.entries" :key="entry.record.id" class="grid gap-1 text-[12px]" data-testid="credit-withdrawal" :data-state="entry.state">
      <p>{{ stateWord[entry.state] }}</p>
      <p v-if="entry.note">{{ entry.note }}</p>
      <template v-if="entry.record.source === 'wallet-calls'">
        <p>Original wallet request identifier</p>
        <code class="break-all" data-testid="credit-wallet-call-id">{{ entry.record.wallet.request.id }}</code>
        <p v-if="receiptHashes(entry).length">Wallet-associated transaction hashes</p>
        <code v-for="hash in receiptHashes(entry)" :key="hash" class="break-all" data-testid="credit-withdrawal-hash">{{ hash }}</code>
        <button class="btn btn-sm justify-self-start" :disabled="view.busy || view.loading" @click="controller.refresh()">Check saved wallet request</button>
      </template>
      <code v-else-if="entry.record.hash" class="break-all" data-testid="credit-withdrawal-hash">{{ entry.record.hash }}</code>
      <div v-else-if="entry.state === 'unknown'" class="flex flex-wrap gap-2">
        <input v-model="hashes[entry.record.id]" class="input mono min-w-0 grow" aria-label="Original withdrawal transaction hash" placeholder="Paste the original hash from the wallet" />
        <button class="btn btn-sm" :disabled="view.busy || view.loading || !/^0x[0-9a-fA-F]{64}$/.test(hashes[entry.record.id] || '')"
          @click="controller.recoverHash(entry.record.id, hashes[entry.record.id] || '')">Check original hash</button>
      </div>
    </div>
    <StepList :steps="steps" />
  </section>
</template>
