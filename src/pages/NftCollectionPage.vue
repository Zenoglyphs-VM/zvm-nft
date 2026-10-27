<script setup lang="ts">
// One collection: its items, what has happened to them, and the offers standing
// against the whole collection. A collection offer is a signed bid for any of
// its tokens (D28), and sweeping the floor is one transaction for many listings.
import {computed, onBeforeUnmount, onMounted, ref, watch} from 'vue'
import {useRoute} from 'vue-router'
import {parseUnits, type Address} from 'viem'
import {api} from '../core/api'
import {wallet} from '../core/wallet'
import {publicClient} from '../core/evm'
import {ago, number, orderExpiry, units} from '../core/format'
import {collectionAbi, currencyOf, isZero, parseMeta} from '../core/nft'
import {exchangeAddress, sameAddress, useMarket} from '../core/market'
import {bidFunding, BUY, buyManyCall, exchange, fetchFillable, newOrder, signOrder, submitOrders} from '../core/orders'
import Panel from '../components/Panel.vue'
import Badge from '@zvm/web/components/Badge.vue'
import StateBlock from '../components/StateBlock.vue'
import StatTile from '../components/StatTile.vue'
import AddressLink from '../components/AddressLink.vue'
import HashLink from '../components/HashLink.vue'
import NftImage from '../components/NftImage.vue'
import NftCard from '../components/NftCard.vue'
import StepList from '../components/StepList.vue'
import Usd from '../components/Usd.vue'

const route = useRoute()
const address = computed(() => String(route.params.addr))
const collection = ref<any>(null)
const items = ref<any[]>([])
const activity = ref<any[]>([])
const offers = ref<any[]>([])
const royaltyBps = ref<number | null>(null)
const loading = ref(true)
const error = ref<string | null>(null)
const tab = ref<'items' | 'activity' | 'offers'>('items')
const listedOnly = ref(false)
const sort = ref('id')
const offering = ref(false)
const offerPrice = ref('')
const offerCount = ref(1)
const sweepCount = ref(3)

const market = useMarket()
const meta = computed(() => parseMeta(collection.value?.meta))
const qsr = computed(() => wallet.info?.apps?.rewardToken ?? null)

async function loadItems() {
  items.value = await api.collectionItems(address.value, {limit: 60, sort: sort.value, listed: listedOnly.value ? 1 : 0})
}

async function load() {
  try {
    const [c] = await Promise.all([api.collection(address.value), loadItems()])
    collection.value = c
    error.value = null
    // The royalty the contract itself reports, on a sale of 10,000 units.
    try {
      const client = publicClient(wallet.info!.l2.chainId)
      const [, amount] = await client.readContract({
        address: address.value as Address,
        abi: collectionAbi,
        functionName: 'royaltyInfo',
        args: [0n, 10_000n],
      })
      royaltyBps.value = Number(amount)
    } catch {
      royaltyBps.value = null
    }
  } catch (err: any) {
    error.value = err?.message ?? String(err)
  } finally {
    loading.value = false
  }
}

async function loadTab() {
  if (tab.value === 'activity' && !activity.value.length) activity.value = await api.collectionActivity(address.value, {limit: 60})
  if (tab.value === 'offers') offers.value = await api.nftOffers({collection: address.value, collectionOnly: 1, limit: 50})
}

let timer: number
onMounted(async () => {
  await load()
  timer = window.setInterval(async () => {
    if (!market.busy.value) {
      await load()
      activity.value = []
      await loadTab()
    }
  }, 20_000)
})
onBeforeUnmount(() => clearInterval(timer))
watch(() => route.params.addr, () => {
  loading.value = true
  activity.value = []
  load()
})
watch(tab, loadTab)
watch([listedOnly, sort], loadItems)

async function submitOffer() {
  const bidder = market.account()
  const wrapped = exchange()?.wrappedZnn
  if (!bidder || !wrapped || !offerPrice.value) return
  const price = parseUnits(offerPrice.value, 18)
  const count = BigInt(offerCount.value)
  await market.run(
    () => bidFunding(bidder, price * count),
    async () => {
      offering.value = false
      offerPrice.value = ''
      offers.value = await api.nftOffers({collection: address.value, collectionOnly: 1, limit: 50})
    },
    {
      label: `Sign an offer of ${offerPrice.value} ZNN each for ${offerCount.value} item${offerCount.value === 1 ? '' : 's'}`,
      fn: async () => {
        const order = await newOrder(
          {side: BUY, collection: address.value as Address, tokenId: 0n, anyToken: true, amount: count, price, paymentToken: wrapped},
          30,
        )
        await submitOrders([await signOrder(order)])
      },
    },
  )
}

/** Buys the cheapest listings in one transaction, skipping any sold a moment earlier. */
async function sweep() {
  const ex = exchangeAddress()
  const buyer = market.account()
  if (!ex || !buyer) return
  await market.run(async () => {
    const listings = await api.nftListings({collection: address.value, sort: 'price', limit: 50})
    const picked = listings.filter((l) => isZero(l.currency) && !sameAddress(l.seller, buyer)).slice(0, sweepCount.value)
    if (!picked.length) throw new Error('nothing here is for sale in ZNN by someone else')
    const inputs = await fetchFillable(picked.map((l) => l.hash))
    if (!inputs.length) throw new Error('every listing here was bought a moment ago — try again')
    const total = inputs.reduce((sum, i) => sum + i.order.price, 0n)
    return [buyManyCall(ex, inputs, total)]
  }, load)
}
</script>

<template>
  <StateBlock :loading="loading" :error="error">
    <div v-if="collection" class="grid gap-4">
      <Panel>
        <div class="p-4 flex flex-wrap gap-4">
          <div class="w-24 shrink-0"><NftImage :src="meta.image" :alt="collection.name" /></div>
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2">
              <h1 class="text-[17px] font-semibold tracking-tight">{{ collection.name || 'Unnamed collection' }}</h1>
              <Badge tone="plain">{{ collection.symbol }}</Badge>
              <Badge v-if="collection.factory" tone="good" title="Created by this chain's collection factory">factory</Badge>
              <Badge v-if="royaltyBps" tone="info">{{ (royaltyBps / 100).toFixed(2) }}% royalty</Badge>
            </div>
            <p v-if="meta.description" class="text-[13px] text-[var(--color-dim)] mt-1 max-w-[70ch]">{{ meta.description }}</p>
            <div class="flex flex-wrap gap-x-5 gap-y-1 mt-2 text-[12.5px]">
              <span class="text-[var(--color-dim)]">Contract <AddressLink :address="collection.address" :length="6" /></span>
              <span v-if="collection.creator" class="text-[var(--color-dim)]">
                Created by <AddressLink :address="collection.creator" :length="6" />
              </span>
            </div>
          </div>
          <div class="flex items-start gap-2">
            <div v-if="collection.listed" class="flex items-center gap-1">
              <input v-model.number="sweepCount" type="number" min="1" max="20" aria-label="How many to sweep" class="input w-[64px]" />
              <button class="btn" :disabled="market.busy.value || !market.account()" @click="sweep">Sweep the floor</button>
            </div>
            <button class="btn" :disabled="!exchangeAddress()" @click="offering = !offering">Make a collection offer</button>
          </div>
        </div>
        <div v-if="offering" class="px-4 pb-4 grid gap-3 max-w-[520px]">
          <div class="grid gap-2 sm:grid-cols-[minmax(0,1fr)_120px]">
            <div class="rounded-[6px] border border-[var(--color-line)] bg-[var(--color-sunk)] p-3">
              <div class="ledger">Price each</div>
              <div class="flex items-center gap-2">
                <input v-model="offerPrice" inputmode="decimal" placeholder="0" aria-label="Offer price each" class="flex-1 min-w-0 bg-transparent outline-none mono text-[20px]" />
                <span class="mono text-[13px]">ZNN</span>
              </div>
            </div>
            <div class="rounded-[6px] border border-[var(--color-line)] bg-[var(--color-sunk)] p-3">
              <div class="ledger">Items</div>
              <input v-model.number="offerCount" type="number" min="1" max="50" aria-label="How many items" class="w-full bg-transparent outline-none mono text-[20px]" />
            </div>
          </div>
          <p class="text-[12.5px] text-[var(--color-dim)]">
            An offer is a signature, paid in wrapped ZNN when someone sells into it; nothing leaves your wallet until then. Any holder of a
            token in this collection can take it, and it is shown only while you can still pay.
          </p>
          <button class="btn btn-plasma justify-center py-2" :disabled="market.busy.value || !offerPrice || !market.account()" @click="submitOffer">
            {{ market.busy.value ? 'Working…' : !market.account() ? 'Connect a wallet' : 'Sign the offer' }}
          </button>
        </div>
        <!-- Outside the offer form on purpose: sweeping the floor is an action
             of this page too, and putting its steps inside the form meant a
             sweep that failed said nothing at all. -->
        <div v-if="market.error.value || market.steps.value.length" class="px-4 pb-4 grid gap-3 max-w-[520px]">
          <p v-if="market.error.value" data-market-error class="text-[13px] text-[var(--color-danger)]">{{ market.error.value }}</p>
          <StepList :steps="market.steps.value" />
        </div>
      </Panel>

      <div class="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Floor"
          :value="collection.floor !== null && collection.floor !== undefined ? `${collection.floor} ZNN` : '—'"
          :hint="`${number(collection.listed ?? 0)} for sale`"
        />
        <StatTile label="Volume" :value="`${collection.volume} ZNN`" :hint="`${number(collection.sales)} sales`" />
        <StatTile label="Items" :value="number(collection.items)" :hint="`${number(collection.owners)} owners`" />
        <StatTile label="24h" :value="`${collection.volume24h} ZNN`" :hint="`${number(collection.sales24h)} sales`" />
      </div>

      <Panel>
        <template #actions>
          <div class="flex flex-wrap items-center gap-1">
            <button v-for="t in ['items', 'activity', 'offers']" :key="t" class="btn px-3 py-1 text-[12.5px] capitalize" :class="tab === t ? 'bg-[var(--color-muted)] font-medium' : ''" @click="tab = t as any">
              {{ t }}
            </button>
          </div>
        </template>

        <div v-if="tab === 'items'">
          <div class="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-[var(--color-line)]">
            <button class="btn px-2.5 py-1 text-[12.5px]" :class="listedOnly ? 'bg-[var(--color-muted)]' : ''" @click="listedOnly = !listedOnly">
              For sale only
            </button>
            <select v-model="sort" class="input w-[190px]" aria-label="Sort items">
              <option value="id">Token id</option>
              <option value="price_asc">Price: low to high</option>
              <option value="price_desc">Price: high to low</option>
              <option value="recent">Recently minted</option>
            </select>
            <span class="flex-1" />
            <span class="ledger">{{ items.length }} shown</span>
          </div>
          <StateBlock :empty="!items.length" empty-text="Nothing here yet.">
            <div class="p-4 grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              <NftCard v-for="i in items" :key="i.tokenId" :collection="collection.address" :item="i" />
            </div>
          </StateBlock>
        </div>

        <StateBlock v-else-if="tab === 'activity'" :empty="!activity.length" empty-text="Nothing has happened yet.">
          <div class="overflow-x-auto">
            <table class="w-full text-[13px] min-w-[680px]">
              <thead>
                <tr class="ledger">
                  <th class="th">What</th><th class="th">Item</th><th class="th">From</th><th class="th">To</th>
                  <th class="th text-right">Price</th><th class="th">When</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(a, i) in activity" :key="i">
                  <td class="td">
                    <Badge :tone="a.kind === 'sale' || a.kind === 'bid-accepted' ? 'good' : a.kind === 'list' ? 'info' : a.kind === 'offer' ? 'accent' : 'plain'">{{ a.kind }}</Badge>
                  </td>
                  <td class="td">
                    <router-link v-if="a.tokenId" :to="`/item/${collection.address}/${a.tokenId}`" class="link mono">#{{ a.tokenId }}</router-link>
                    <span v-else class="text-[var(--color-dim)]">collection</span>
                  </td>
                  <td class="td"><AddressLink :address="a.from" :length="6" /></td>
                  <td class="td"><AddressLink v-if="a.to" :address="a.to" :length="6" /><span v-else class="text-[var(--color-dim)]">—</span></td>
                  <td class="td text-right mono whitespace-nowrap">
                    <template v-if="a.price">
                      {{ units(a.price, currencyOf(a.currency, qsr).decimals, 4) }} {{ currencyOf(a.currency, qsr).symbol }}
                    </template>
                    <span v-else class="text-[var(--color-dim)]">—</span>
                  </td>
                  <td class="td text-[12.5px] text-[var(--color-dim)] whitespace-nowrap">
                    {{ ago(a.timestamp) }}
                    <template v-if="a.tx"> · <HashLink :hash="a.tx" :to="`/tx/${a.tx}`" :head="6" :tail="4" /></template>
                    <template v-else> · signed</template>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </StateBlock>

        <StateBlock v-else :empty="!offers.length" empty-text="No offer stands against this collection.">
          <table class="w-full text-[13px]">
            <thead>
              <tr class="ledger"><th class="th">From</th><th class="th text-right">Each</th><th class="th text-right">Items</th><th class="th">Expires</th></tr>
            </thead>
            <tbody>
              <tr v-for="o in offers" :key="o.hash">
                <td class="td"><AddressLink :address="o.bidder" :length="8" /></td>
                <td class="td text-right mono">
                  {{ units(o.price, 18, 4) }} ZNN
                  <div class="text-[12px]"><Usd :amount="o.price" :decimals="18" token="znn" /></div>
                </td>
                <td class="td text-right mono">{{ o.quantity - o.filled }} of {{ o.quantity }}</td>
                <td class="td text-[12.5px] text-[var(--color-dim)]">{{ orderExpiry(o.expiry) }}</td>
              </tr>
            </tbody>
          </table>
          <p class="px-4 py-3 text-[12.5px] text-[var(--color-dim)]">
            To take one of these, open an item you own in this collection and accept from there.
          </p>
        </StateBlock>
      </Panel>
    </div>
  </StateBlock>
</template>
