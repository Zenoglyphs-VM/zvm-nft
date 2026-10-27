<script setup lang="ts">
// One account's side of the market: what it holds, what it made, what it is
// selling, and the offers on both sides of it.
//
// Selling many at once is Blur's bulk listing (D28): pick the items, set one
// price, and one signature over the Merkle root of every order lists them all.
import {computed, onMounted, ref, watch} from 'vue'
import {useRoute} from 'vue-router'
import {parseUnits, type Address} from 'viem'
import {api} from '../core/api'
import {base} from '../core/endpoint'
import {ago, number, units} from '../core/format'
import {currencyOf, parseMeta} from '../core/nft'
import {exchangeAddress, sameAddress, useMarket} from '../core/market'
import {cancelOrdersCall, fetchInput, incrementNonceCall, newOrder, SELL, signOrders, submitOrders} from '../core/orders'
import {wallet} from '../core/wallet'
import Panel from '../components/Panel.vue'
import Badge from '@zvm/web/components/Badge.vue'
import StateBlock from '../components/StateBlock.vue'
import AddressLink from '../components/AddressLink.vue'
import HashLink from '../components/HashLink.vue'
import NftCard from '../components/NftCard.vue'
import NftImage from '../components/NftImage.vue'
import StepList from '../components/StepList.vue'
import Usd from '../components/Usd.vue'

const route = useRoute()
const address = computed(() => String(route.params.addr))
const profile = ref<any>(null)
const loading = ref(true)
const error = ref<string | null>(null)
const tab = ref<'owned' | 'created' | 'listings' | 'offers' | 'activity'>('owned')
const selected = ref<Set<string>>(new Set())
const bulkPrice = ref('')
const bulkDays = ref(30)

const market = useMarket()
const qsr = computed(() => wallet.info?.apps?.rewardToken ?? null)
const isMine = computed(() => sameAddress(market.account(), address.value))
const key = (i: any) => `${i.collection}:${i.tokenId}`
const unlisted = computed<any[]>(() => (profile.value?.owned ?? []).filter((i: any) => !i.listing))

async function load() {
  try {
    profile.value = await api.nftAccount(address.value)
    error.value = null
  } catch (err: any) {
    error.value = err?.message ?? String(err)
  } finally {
    loading.value = false
  }
}
onMounted(load)
watch(() => route.params.addr, () => {
  loading.value = true
  selected.value = new Set()
  load()
})

function toggle(i: any) {
  const next = new Set(selected.value)
  next.has(key(i)) ? next.delete(key(i)) : next.add(key(i))
  selected.value = next
}

function selectAll() {
  selected.value = selected.value.size === unlisted.value.length ? new Set() : new Set(unlisted.value.map(key))
}

/** Lists every selected item at one price, with one signature. */
async function listSelected() {
  const ex = exchangeAddress()
  const owner = market.account()
  if (!ex || !owner || !bulkPrice.value || !selected.value.size) return
  const price = parseUnits(bulkPrice.value, 18)
  const items = unlisted.value.filter((i) => selected.value.has(key(i)))
  const collections = [...new Map(items.map((i) => [i.collection.toLowerCase(), i])).values()]
  await market.run(
    async () => (await Promise.all(collections.map((c) => market.approvalFor(c.collection, owner, ex, c.collectionName || 'a collection')))).flat(),
    async () => {
      selected.value = new Set()
      bulkPrice.value = ''
      await load()
    },
    {
      label: `Sign one listing for ${items.length} item${items.length === 1 ? '' : 's'} at ${bulkPrice.value} ZNN each`,
      fn: async () => {
        const orders = []
        for (const i of items) {
          orders.push(await newOrder({side: SELL, collection: i.collection as Address, tokenId: BigInt(i.tokenId), price}, bulkDays.value))
        }
        await submitOrders(await signOrders(orders))
        return `${orders.length} listings, one signature, no transaction`
      },
    },
  )
}

async function cancelOrder(o: any, label: string) {
  const ex = exchangeAddress()
  if (!ex) return
  await market.run(async () => [cancelOrdersCall(ex, [(await fetchInput(o.hash)).order], label)], load)
}

/** One transaction that voids everything this account has signed. */
async function cancelEverything() {
  const ex = exchangeAddress()
  if (!ex) return
  await market.run(() => [incrementNonceCall(ex)], load)
}

const tabs = [
  {key: 'owned', label: 'Collected'},
  {key: 'created', label: 'Created'},
  {key: 'listings', label: 'Selling'},
  {key: 'offers', label: 'Offers'},
  {key: 'activity', label: 'Activity'},
] as const
</script>

<template>
  <StateBlock :loading="loading" :error="error">
    <div v-if="profile" class="grid gap-4">
      <Panel>
        <div class="p-4 flex flex-wrap items-center gap-3">
          <div>
            <div class="ledger">Account</div>
            <div class="mono text-[15px] break-all">{{ profile.address }}</div>
          </div>
          <Badge v-if="isMine" tone="good">yours</Badge>
          <span class="flex-1" />
          <button
            v-if="isMine && profile.openOrders?.length"
            class="btn"
            :disabled="market.busy.value"
            :title="`Voids all ${profile.openOrders.length} orders you have signed, in one transaction`"
            @click="cancelEverything"
          >
            Cancel all {{ profile.openOrders.length }} orders
          </button>
          <a class="btn" :href="`${base()}/address/${profile.address}`" target="_blank" rel="noreferrer">Explorer view</a>
        </div>
      </Panel>

      <Panel>
        <template #actions>
          <div class="flex flex-wrap gap-1">
            <button
              v-for="t in tabs"
              :key="t.key"
              class="btn px-3 py-1 text-[12.5px]"
              :class="tab === t.key ? 'bg-[var(--color-muted)] font-medium' : ''"
              @click="tab = t.key"
            >
              {{ t.label }}
            </button>
          </div>
        </template>

        <StateBlock v-if="tab === 'owned'" :empty="!profile.owned?.length" empty-text="No NFTs here.">
          <div v-if="isMine && unlisted.length" class="px-4 pt-4 flex flex-wrap items-end gap-2">
            <button class="btn" @click="selectAll">{{ selected.size === unlisted.length ? 'Clear' : `Select all ${unlisted.length} unlisted` }}</button>
            <label class="grid gap-1">
              <span class="ledger">Price each, ZNN</span>
              <input v-model="bulkPrice" inputmode="decimal" placeholder="0" aria-label="Price each" class="input w-[120px]" />
            </label>
            <label class="grid gap-1">
              <span class="ledger">Days</span>
              <input v-model.number="bulkDays" type="number" min="1" max="365" aria-label="Days" class="input w-[80px]" />
            </label>
            <button class="btn btn-plasma" :disabled="market.busy.value || !selected.size || !bulkPrice" @click="listSelected">
              List {{ selected.size || '' }} selected
            </button>
            <span class="text-[12.5px] text-[var(--color-dim)]">one signature for all of them</span>
          </div>
          <div class="p-4 grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            <div v-for="i in profile.owned" :key="key(i)" class="relative">
              <NftCard :collection="i.collection" :item="i" :collection-name="i.collectionName" />
              <label
                v-if="isMine && !i.listing"
                class="absolute top-2 left-2 rounded bg-[var(--color-bg)]/90 px-1.5 py-0.5 flex items-center gap-1 text-[12px] cursor-pointer"
              >
                <input type="checkbox" :checked="selected.has(key(i))" :aria-label="`Select #${i.tokenId}`" @change="toggle(i)" />
              </label>
            </div>
          </div>
        </StateBlock>

        <StateBlock v-else-if="tab === 'created'" :empty="!profile.created?.length" empty-text="This account has created no collection.">
          <table class="w-full text-[13px]">
            <tbody>
              <tr v-for="c in profile.created" :key="c.address">
                <td class="td w-14">
                  <router-link :to="`/collection/${c.address}`"><NftImage :src="parseMeta(c.meta).image" :alt="c.name" /></router-link>
                </td>
                <td class="td">
                  <router-link :to="`/collection/${c.address}`" class="link font-medium">{{ c.name || 'Unnamed' }}</router-link>
                  <div class="text-[12px] text-[var(--color-dim)] mono">{{ c.symbol }}</div>
                </td>
                <td class="td text-right mono">{{ number(c.items) }} items</td>
                <td class="td text-right mono">{{ c.volume }} ZNN traded</td>
              </tr>
            </tbody>
          </table>
        </StateBlock>

        <StateBlock v-else-if="tab === 'listings'" :empty="!profile.listings?.length" empty-text="Nothing listed.">
          <table class="w-full text-[13px]">
            <tbody>
              <tr v-for="l in profile.listings" :key="l.hash">
                <td class="td w-14">
                  <router-link :to="`/item/${l.collection}/${l.tokenId}`"><NftImage :src="l.image" :alt="l.name" /></router-link>
                </td>
                <td class="td">
                  <router-link :to="`/item/${l.collection}/${l.tokenId}`" class="link">{{ l.name || `#${l.tokenId}` }}</router-link>
                  <div class="text-[12px] text-[var(--color-dim)]">
                    {{ l.collectionName }}
                    <Badge v-if="l.kind === 1" tone="plain" class="ml-1" title="Signed together with other listings">bulk</Badge>
                    <Badge v-if="l.kind === 2" tone="plain" class="ml-1" title="Approved with a transaction rather than a signature">on chain</Badge>
                  </div>
                </td>
                <td class="td text-right mono whitespace-nowrap">
                  {{ units(l.price, currencyOf(l.currency, qsr).decimals, 4) }} {{ currencyOf(l.currency, qsr).symbol }}
                  <div class="text-[12px]"><Usd :amount="l.price" :decimals="currencyOf(l.currency, qsr).decimals" :token="currencyOf(l.currency, qsr).key" /></div>
                </td>
                <td class="td text-right">
                  <button v-if="isMine" class="btn px-2.5 py-1 text-[12.5px]" :disabled="market.busy.value" @click="cancelOrder(l, `Take #${l.tokenId} off sale`)">Cancel</button>
                </td>
              </tr>
            </tbody>
          </table>
        </StateBlock>

        <div v-else-if="tab === 'offers'">
          <StateBlock :empty="!profile.offersMade?.length && !profile.offersReceived?.length" empty-text="No offers either way.">
            <div class="grid md:grid-cols-2">
              <div class="border-b md:border-b-0 md:border-r border-[var(--color-line)]">
                <div class="px-4 py-2 ledger">Made</div>
                <table class="w-full text-[13px]">
                  <tbody>
                    <tr v-for="o in profile.offersMade ?? []" :key="`m${o.hash}`">
                      <td class="td">
                        <router-link v-if="o.tokenId" :to="`/item/${o.collection}/${o.tokenId}`" class="link mono">#{{ o.tokenId }}</router-link>
                        <router-link v-else :to="`/collection/${o.collection}`" class="link">whole collection</router-link>
                        <div class="text-[12px] text-[var(--color-dim)]">{{ o.quantity - o.filled }} of {{ o.quantity }} left</div>
                      </td>
                      <td class="td text-right mono">{{ units(o.price, 18, 4) }} ZNN</td>
                      <td class="td text-right">
                        <button v-if="isMine" class="btn px-2.5 py-1 text-[12.5px]" :disabled="market.busy.value" @click="cancelOrder(o, 'Withdraw the offer')">Withdraw</button>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div>
                <div class="px-4 py-2 ledger">Received</div>
                <table class="w-full text-[13px]">
                  <tbody>
                    <tr v-for="o in profile.offersReceived ?? []" :key="`r${o.hash}`">
                      <td class="td">
                        <router-link v-if="o.tokenId" :to="`/item/${o.collection}/${o.tokenId}`" class="link mono">#{{ o.tokenId }}</router-link>
                        <router-link v-else :to="`/collection/${o.collection}`" class="link">whole collection</router-link>
                        <div class="text-[12px] text-[var(--color-dim)]">from <AddressLink :address="o.bidder" :length="6" /></div>
                      </td>
                      <td class="td text-right mono">{{ units(o.price, 18, 4) }} ZNN</td>
                      <td class="td text-right text-[12px] text-[var(--color-dim)]">accept from the item</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </StateBlock>
        </div>

        <StateBlock v-else :empty="!profile.activity?.length" empty-text="Nothing yet.">
          <table class="w-full text-[13px]">
            <tbody>
              <tr v-for="(a, i) in profile.activity" :key="i">
                <td class="td"><Badge :tone="a.kind === 'sale' || a.kind === 'bid-accepted' ? 'good' : a.kind === 'list' ? 'info' : a.kind === 'offer' ? 'accent' : 'plain'">{{ a.kind }}</Badge></td>
                <td class="td">
                  <router-link v-if="a.tokenId" :to="`/item/${a.collection}/${a.tokenId}`" class="link mono">#{{ a.tokenId }}</router-link>
                  <AddressLink v-else :address="a.collection" :length="6" />
                </td>
                <td class="td"><AddressLink :address="a.from" :length="6" /></td>
                <td class="td"><AddressLink v-if="a.to" :address="a.to" :length="6" /></td>
                <td class="td text-right mono">{{ a.price ? units(a.price, 18, 4) + ' ZNN' : '—' }}</td>
                <td class="td text-[12.5px] text-[var(--color-dim)]">
                  {{ ago(a.timestamp) }}
                  <template v-if="a.tx"> · <HashLink :hash="a.tx" :to="`/tx/${a.tx}`" :head="6" :tail="4" /></template>
                  <template v-else> · signed</template>
                </td>
              </tr>
            </tbody>
          </table>
        </StateBlock>
      </Panel>

      <p v-if="market.error.value" data-market-error class="text-[13px] text-[var(--color-danger)]">{{ market.error.value }}</p>
      <StepList :steps="market.steps.value" />
    </div>
  </StateBlock>
</template>
