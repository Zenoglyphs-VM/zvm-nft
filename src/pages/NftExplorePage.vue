<script setup lang="ts">
// Everything the chain's NFT market has: collections by volume, what just sold,
// and what is for sale right now. Every ERC-721 on the chain is here, not only
// the ones this chain's factory made.
import {computed, onBeforeUnmount, onMounted, ref} from 'vue'
import {api} from '../core/api'
import {wallet} from '../core/wallet'
import {ago, number, units} from '../core/format'
import {fmtUsd, usdValue} from '../core/prices'
import {currencyOf, parseMeta} from '../core/nft'
import Panel from '../components/Panel.vue'
import StatTile from '../components/StatTile.vue'
import StateBlock from '../components/StateBlock.vue'
import AddressLink from '../components/AddressLink.vue'
import NftImage from '../components/NftImage.vue'
import Usd from '../components/Usd.vue'

const overview = ref<any>(null)
const loading = ref(true)
const error = ref<string | null>(null)
const sort = ref('volume')

async function load() {
  try {
    const [o, collections] = await Promise.all([api.nft(), api.collections({limit: 60, sort: sort.value})])
    overview.value = {...o, collections}
    error.value = null
  } catch (err: any) {
    error.value = err?.message ?? String(err)
  } finally {
    loading.value = false
  }
}

let timer: number
onMounted(() => {
  load()
  timer = window.setInterval(load, 15_000)
})
onBeforeUnmount(() => clearInterval(timer))

const znn = (v: number | null | undefined) => (v === null || v === undefined ? '—' : v.toLocaleString('en-US', {maximumFractionDigits: 4}))
const usdOfZNN = (amount: number | null | undefined) => (amount === null || amount === undefined ? null : usdValue(BigInt(Math.round(amount * 1e8)), 8, 'znn'))
const image = (row: any) => parseMeta(row?.meta).image ?? ''
const qsr = computed(() => wallet.info?.apps?.rewardToken ?? null)
const marketplace = computed(() => wallet.info?.apps?.exchange ?? null)

function setSort(v: string) {
  sort.value = v
  load()
}
</script>

<template>
  <div class="grid gap-4">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="text-[17px] font-semibold tracking-tight">NFTs</h1>
        <p class="text-[13px] text-[var(--color-dim)]">
          Listings and offers are signatures, as on OpenSea and Blur: free to make, and many listings are one wallet prompt.
        </p>
      </div>
      <router-link to="/create" class="btn btn-plasma">Create</router-link>
    </div>

    <div class="grid gap-3 grid-cols-2 lg:grid-cols-4">
      <StatTile label="Collections" :value="number(overview?.totals?.collections ?? 0)" :hint="`${number(overview?.totals?.items ?? 0)} items`" />
      <StatTile label="Volume" :value="`${znn(overview?.totals?.volume)} ZNN`" :hint="fmtUsd(usdOfZNN(overview?.totals?.volume), {dash: 'all time'})" />
      <StatTile label="Volume, 24h" :value="`${znn(overview?.totals?.volume24h)} ZNN`" :hint="`${number(overview?.totals?.sales ?? 0)} sales all time`" />
      <StatTile label="For sale" :value="number(overview?.totals?.listed ?? 0)" hint="listings anyone can fill right now" />
    </div>

    <Panel title="Collections">
      <template #actions>
        <div class="flex gap-1">
          <button
            v-for="s in [
              {key: 'volume', label: 'Volume'},
              {key: 'floor', label: 'Floor'},
              {key: 'items', label: 'Items'},
              {key: 'recent', label: 'Newest'},
            ]"
            :key="s.key"
            class="btn px-2.5 py-1 text-[12.5px]"
            :class="sort === s.key ? 'bg-[var(--color-muted)] font-medium' : ''"
            @click="setSort(s.key)"
          >
            {{ s.label }}
          </button>
        </div>
      </template>
      <StateBlock :loading="loading" :error="error" :empty="!overview?.collections?.length" empty-text="No ERC-721 has moved on this chain yet.">
        <div class="overflow-x-auto">
          <table class="w-full text-[13px] min-w-[780px]">
            <thead>
              <tr class="ledger">
                <th class="th">Collection</th>
                <th class="th text-right">Floor</th>
                <th class="th text-right">Volume</th>
                <th class="th text-right">24h</th>
                <th class="th text-right">Items</th>
                <th class="th text-right">Owners</th>
                <th class="th text-right">Listed</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="c in overview?.collections ?? []" :key="c.address">
                <td class="td">
                  <router-link :to="`/collection/${c.address}`" class="flex items-center gap-3 min-w-0">
                    <div class="w-10 shrink-0"><NftImage :src="image(c)" :alt="c.name" /></div>
                    <div class="min-w-0">
                      <div class="font-medium truncate">{{ c.name || 'Unnamed collection' }}</div>
                      <div class="text-[12px] text-[var(--color-dim)] mono truncate">{{ c.symbol }}</div>
                    </div>
                  </router-link>
                </td>
                <td class="td text-right mono whitespace-nowrap">
                  <template v-if="c.floor !== null && c.floor !== undefined">
                    {{ znn(c.floor) }} ZNN
                    <div class="text-[12px]"><Usd :value="usdOfZNN(c.floor)" /></div>
                  </template>
                  <span v-else class="text-[var(--color-dim)]">—</span>
                </td>
                <td class="td text-right mono whitespace-nowrap">
                  {{ znn(c.volume) }} ZNN
                  <div class="text-[12px]"><Usd :value="usdOfZNN(c.volume)" /></div>
                </td>
                <td class="td text-right mono">{{ znn(c.volume24h) }}</td>
                <td class="td text-right mono">{{ number(c.items) }}</td>
                <td class="td text-right mono">{{ number(c.owners) }}</td>
                <td class="td text-right mono">{{ number(c.listed ?? 0) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </StateBlock>
    </Panel>

    <div class="grid gap-4 lg:grid-cols-2">
      <Panel title="Just sold">
        <StateBlock :empty="!overview?.sales?.length" empty-text="Nothing has sold yet.">
          <table class="w-full text-[13px]">
            <tbody>
              <tr v-for="s in overview?.sales ?? []" :key="`${s.tx}-${s.index}`">
                <td class="td w-12">
                  <router-link :to="`/item/${s.collection}/${s.tokenId}`"><NftImage :src="s.image" :alt="s.name" /></router-link>
                </td>
                <td class="td">
                  <router-link :to="`/item/${s.collection}/${s.tokenId}`" class="link">{{ s.name || `#${s.tokenId}` }}</router-link>
                  <div class="text-[12px] text-[var(--color-dim)] truncate">{{ s.collectionName }} · {{ ago(s.timestamp) }}</div>
                </td>
                <td class="td text-right mono whitespace-nowrap">
                  {{ units(s.price, currencyOf(s.currency, qsr).decimals, 4) }} {{ currencyOf(s.currency, qsr).symbol }}
                  <div class="text-[12px]">
                    <Usd :amount="s.price" :decimals="currencyOf(s.currency, qsr).decimals" :token="currencyOf(s.currency, qsr).key" />
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </StateBlock>
      </Panel>

      <Panel title="Just listed">
        <StateBlock :empty="!overview?.listings?.length" empty-text="Nothing is for sale yet.">
          <table class="w-full text-[13px]">
            <tbody>
              <tr v-for="l in overview?.listings ?? []" :key="l.hash">
                <td class="td w-12">
                  <router-link :to="`/item/${l.collection}/${l.tokenId}`"><NftImage :src="l.image" :alt="l.name" /></router-link>
                </td>
                <td class="td">
                  <router-link :to="`/item/${l.collection}/${l.tokenId}`" class="link">{{ l.name || `#${l.tokenId}` }}</router-link>
                  <div class="text-[12px] text-[var(--color-dim)] truncate">
                    {{ l.collectionName }} · by <AddressLink :address="l.seller" :length="6" />
                  </div>
                </td>
                <td class="td text-right mono whitespace-nowrap">
                  {{ units(l.price, currencyOf(l.currency, qsr).decimals, 4) }} {{ currencyOf(l.currency, qsr).symbol }}
                  <div class="text-[12px]">
                    <Usd :amount="l.price" :decimals="currencyOf(l.currency, qsr).decimals" :token="currencyOf(l.currency, qsr).key" />
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </StateBlock>
      </Panel>
    </div>

    <p v-if="!marketplace" class="card px-4 py-3 text-[13px] text-[var(--color-dim)]">
      This node was started without an application deployment, so nothing can be listed or bought from this page. Run
      <code class="mono">zvm apps setup</code> and start the node with <code class="mono">-apps bench/apps.json</code>.
    </p>
  </div>
</template>
