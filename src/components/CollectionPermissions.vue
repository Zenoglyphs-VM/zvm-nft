<script setup lang="ts">
// Reads chain permission before offering removal. Signatures remain separate:
// granting access later can make an uncancelled listing usable again.
import {computed, onMounted, onUnmounted, ref, watch} from 'vue'
import {isAddress, type Address} from 'viem'
import {publicClient} from '../core/evm'
import {endpoint} from '../core/endpoint'
import {wallet, wrongChain} from '../core/wallet'
import {exchangeAddress, useMarket} from '../core/market'
import StepList from './StepList.vue'
import {collectionAbi, revokeCollectionCall} from '../core/nft'

const props = defineProps<{owner: string; collections: readonly {collection: string; collectionName?: string}[]}>()
const emit = defineEmits<{changed: []}>()
const market = useMarket()
type Row = {collection: Address; name: string; approved: boolean | null; loading: boolean; error: string}
const rows = ref<Row[]>([])
let generation = 0
let refreshing = false
let timer: ReturnType<typeof setInterval> | undefined

const identity = computed(() => {
  const chainId = wallet.info?.l2.chainId
  const operator = exchangeAddress()
  const account = wallet.evm.address
  if (!chainId || !operator || !isAddress(operator) || !isAddress(props.owner) ||
    !account || account.toLowerCase() !== props.owner.toLowerCase() || wrongChain.value) return null
  return {chainId, operator: operator as Address, owner: props.owner as Address, endpoint: endpoint.url}
})
const collections = computed(() => {
  const unique = new Map<string, {collection: Address; name: string}>()
  for (const entry of props.collections) {
    if (!isAddress(entry.collection)) continue
    const key = entry.collection.toLowerCase()
    if (!unique.has(key)) unique.set(key, {collection: entry.collection as Address, name: entry.collectionName || entry.collection})
  }
  return [...unique.values()].sort((a, b) => a.collection.toLowerCase().localeCompare(b.collection.toLowerCase()))
})
const scope = computed(() => identity.value ? JSON.stringify([identity.value, collections.value.map(r => r.collection.toLowerCase())]) : '')

async function refresh() {
  const selected = identity.value
  if (!selected || refreshing || market.busy.value) return
  const key = scope.value
  const epoch = ++generation
  refreshing = true
  const client = publicClient(selected.chainId)
  try {
    // Four reads at a time; the shared client's normal HTTP batching still applies.
    for (let offset = 0; offset < rows.value.length; offset += 4) {
      if (epoch !== generation || key !== scope.value) return
      const batch = rows.value.slice(offset, offset + 4)
      await Promise.all(batch.map(async row => {
        row.loading = true
        try {
          const value = await client.readContract({address: row.collection, abi: collectionAbi,
            functionName: 'isApprovedForAll', args: [selected.owner, selected.operator]})
          if (epoch !== generation || key !== scope.value) return
          if (typeof value !== 'boolean') throw new Error('Permission response was not a boolean.')
          row.approved = value
          row.error = ''
        } catch {
          if (epoch !== generation || key !== scope.value) return
          row.approved = null
          row.error = 'Could not read permission. Refresh before trying again.'
        } finally {
          if (epoch === generation && key === scope.value) row.loading = false
        }
      }))
    }
  } finally {
    refreshing = false
  }
}

watch(scope, () => {
  generation++
  rows.value = identity.value ? collections.value.map(row => ({...row, approved: null, loading: false, error: ''})) : []
  void refresh()
}, {immediate: true})

async function revoke(row: Row) {
  const selected = identity.value
  const key = scope.value
  if (!selected || row.approved !== true || row.loading || market.busy.value) return
  const build = () => {
    if (scope.value !== key) throw new Error('The account or network changed. Check the permission again.')
    return [{...revokeCollectionCall(row.collection, selected.operator, row.name), guard: () => {
      if (scope.value !== key) throw new Error('The account or network changed. Check the permission again.')
    }}]
  }
  const after = async () => {
    // A real receipt is required by run before this callback can execute.
    if (scope.value !== key) return
    emit('changed')
  }
  await market.run(build, after)
  if (scope.value === key) await refresh()
}

onMounted(() => {
  timer = setInterval(() => {if (!document.hidden) void refresh()}, 5000)
})
onUnmounted(() => {generation++; clearInterval(timer)})
</script>

<template>
  <section v-if="identity && rows.length" class="card p-4 grid gap-3" data-testid="collection-permissions">
    <h2 class="font-medium">Collection permissions</h2>
    <p class="text-[13px] text-[var(--color-dim)]">
      Exchange access applies to every token you hold in a collection. Removing it stops trading through this exchange,
      but does not cancel signed orders. Allowing access again can make uncancelled listings usable again.
    </p>
    <div v-for="row in rows" :key="row.collection" class="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] items-center"
      data-testid="collection-permission" :data-collection="row.collection"
      :data-approval="row.approved === null ? 'unknown' : row.approved ? 'granted' : 'removed'">
      <div class="min-w-0">
        <p class="text-[13px] truncate">{{ row.name }}</p>
        <p class="text-[12px] mono break-all text-[var(--color-dim)]">{{ row.collection }}</p>
        <p v-if="row.error" role="status" class="text-[12px] text-[var(--color-danger)]">{{ row.error }}</p>
        <p v-else class="text-[12px] text-[var(--color-dim)]">{{ row.loading ? 'Checking permission...' : row.approved === null ? 'Permission unknown' : row.approved ? 'Exchange access allowed' : 'Exchange access removed' }}</p>
      </div>
      <button class="btn px-3 py-2 text-[12.5px]" data-testid="revoke-exchange"
        :disabled="market.busy.value || row.loading || row.approved !== true" @click="revoke(row)">
        {{ market.busy.value ? 'Waiting for execution...' : 'Revoke exchange access' }}
      </button>
    </div>
    <button class="btn justify-self-start text-[12px]" :disabled="market.busy.value" @click="refresh">Refresh permissions</button>
    <p v-if="market.error.value" role="status" class="text-[13px] text-[var(--color-danger)]">{{ market.error.value }}</p>
    <StepList :steps="market.steps.value" />
  </section>
</template>
