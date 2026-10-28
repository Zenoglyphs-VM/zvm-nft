<script setup lang="ts">
// One token: what it is, who holds it, what it costs, and every way to trade it.
// Listing and bidding are signatures handed to the node (D28) — no transaction,
// nothing spent. Buying and accepting a bid are transactions, and so is
// cancelling, because a signature cannot be taken back any other way.
import {computed, onBeforeUnmount, onMounted, ref, watch} from 'vue'
import {useRoute} from 'vue-router'
import {type Address} from 'viem'
import {api} from '../core/api'
import {wallet} from '../core/wallet'
import {endpoint} from '../core/endpoint'
import {listingQuote, relistingQuote, quoteContextGuard, guardedQuoteCalls} from '../core/order-quote'
import {publicClient} from '../core/evm'
import {ago, number, orderDate, short, units} from '../core/format'
import {mediaURL} from '../core/media'
import {currencyOf, isZero, parseMeta} from '../core/nft'
import {exchangeAddress, sameAddress, useMarket} from '../core/market'
import {
  acceptBidCall,
  bidFunding,
  buyCall,
  BUY,
  cancelOrdersCall,
  exchange,
  fetchInput,
  newOrder,
  orderDuration,
  SELL,
  signOrder,
  submitOrders,
} from '../core/orders'
import {allowance, approveCall} from '../core/uniswap'
import Panel from '../components/Panel.vue'
import Badge from '@zvm/web/components/Badge.vue'
import StateBlock from '../components/StateBlock.vue'
import AddressLink from '../components/AddressLink.vue'
import HashLink from '../components/HashLink.vue'
import NftImage from '../components/NftImage.vue'
import StepList from '../components/StepList.vue'
import Usd from '../components/Usd.vue'

const route = useRoute()
const collection = computed(() => String(route.params.addr))
const tokenId = computed(() => String(route.params.id))
const item = ref<any>(null)
const loading = ref(true)
const error = ref<string | null>(null)
const panel = ref<'none' | 'list' | 'offer'>('none')
const price = ref('')
const currency = ref<'znn' | 'qsr'>('znn')
const days = ref(30)

const market = useMarket()
const meta = computed(() => parseMeta(item.value?.meta))
const qsr = computed(() => wallet.info?.apps?.rewardToken ?? null)
const listing = computed(() => item.value?.listing ?? null)
const listingCurrency = computed(() => currencyOf(listing.value?.currency, qsr.value))
const isOwner = computed(() => sameAddress(market.account(), item.value?.owner))
const offers = computed<any[]>(() => item.value?.offers ?? [])
const collectionInfo = computed(() => item.value?.collectionInfo ?? null)
const wrapped = computed(() => exchange()?.wrappedZnn ?? null)

async function load() {
  try {
    item.value = await api.item(collection.value, tokenId.value)
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
  timer = window.setInterval(() => {
    if (!market.busy.value) load()
  }, 15_000)
})
onBeforeUnmount(() => clearInterval(timer))
watch(() => [route.params.addr, route.params.id], () => {
  loading.value = true
  item.value = null
  load()
})

const name = computed(() => item.value?.name || `#${tokenId.value}`)
const closePanel = async () => {
  panel.value = 'none'
  price.value = ''
  await load()
}

async function buy() {
  const ex = exchangeAddress()
  const buyer = market.account()
  if (!ex || !buyer || !listing.value) return
  await market.run(async () => {
    const input = await fetchInput(listing.value.hash)
    const calls = []
    // A listing in an ERC-20 is paid with an allowance, not with value.
    if (!isZero(input.order.paymentToken)) {
      const client = publicClient(wallet.info!.l2.chainId)
      if ((await allowance(client, input.order.paymentToken, buyer, ex)) < input.order.price) {
        calls.push(approveCall({address: input.order.paymentToken, symbol: listingCurrency.value.symbol}, ex, input.order.price))
      }
    }
    calls.push(buyCall(ex, input, `Buy ${name.value}`))
    return calls
  }, load)
}

async function list() {
  const ex = exchangeAddress(), owner = market.account()
  if (!ex || !owner || !price.value || market.busy.value) return
  const draft = {collection: collection.value, tokenId: tokenId.value, price: price.value,
    currency: currency.value, days: days.value, rewardToken: qsr.value, name: name.value,
    collectionName: collectionInfo.value?.name ?? 'this collection'}
  const selection = () => panel.value === 'list' ? collection.value.toLowerCase() + ':' + tokenId.value : ''
  const read = () => ({endpoint: endpoint.url, chainId: wallet.info?.l2.chainId, walletChainId: wallet.evm.chainId,
    owner: market.account(), signer: wallet.evm.address, provider: wallet.evm.provider,
    exchange: exchangeAddress(), paymentToken: draft.currency === 'qsr' ? qsr.value : '0x0000000000000000000000000000000000000000', selection: selection()})
  const captured = {...read(), owner, exchange: ex,
    paymentToken: draft.currency === 'qsr' ? draft.rewardToken : '0x0000000000000000000000000000000000000000',
    selection: draft.collection.toLowerCase() + ':' + draft.tokenId}
  let prepared: {quote: ReturnType<typeof listingQuote>; guard: () => void} | null = null
  await market.run(async () => {
    const quote = listingQuote(draft.price, draft.currency, draft.rewardToken)
    orderDuration(draft.days)
    const guard = quoteContextGuard(read, captured)
    prepared = {quote, guard}
    const calls = await market.approvalFor(draft.collection as Address, owner, ex, draft.collectionName)
    guard()
    return guardedQuoteCalls(calls, guard)
  }, closePanel, {
    label: `Sign a listing of ${draft.name} for ${draft.price} ${draft.currency.toUpperCase()}`,
    fn: async () => {
      if (!prepared) throw new Error('Review the listing before signing.')
      const {quote, guard} = prepared
      guard()
      const order = await newOrder({side: SELL, collection: draft.collection as Address,
        tokenId: BigInt(draft.tokenId), price: quote.amount, paymentToken: quote.paymentToken}, draft.days)
      guard()
      const input = await signOrder(order)
      guard()
      await submitOrders([input])
      guard()
      return 'no transaction: the node holds your signature until someone buys'
    },
  })
}

async function cancel() {
  const ex = exchangeAddress()
  if (!ex || !listing.value) return
  await market.run(async () => [cancelOrdersCall(ex, [(await fetchInput(listing.value.hash)).order], `Take ${name.value} off sale`)], load)
}

async function offer() {
  const ex = exchangeAddress(), bidder = market.account(), token = wrapped.value
  if (!ex || !bidder || !token || !price.value || market.busy.value) return
  const draft = {collection: collection.value, tokenId: tokenId.value, price: price.value,
    days: days.value, name: name.value, paymentToken: token}
  const read = () => ({endpoint: endpoint.url, chainId: wallet.info?.l2.chainId, walletChainId: wallet.evm.chainId,
    owner: market.account(), signer: wallet.evm.address, provider: wallet.evm.provider,
    exchange: exchangeAddress(), paymentToken: wrapped.value,
    selection: panel.value === 'offer' ? collection.value.toLowerCase() + ':' + tokenId.value : ''})
  const captured = {...read(), owner: bidder, exchange: ex, paymentToken: draft.paymentToken,
    selection: draft.collection.toLowerCase() + ':' + draft.tokenId}
  let prepared: {quote: ReturnType<typeof listingQuote>; guard: () => void} | null = null
  await market.run(async () => {
    const quote = listingQuote(draft.price, 'znn')
    orderDuration(draft.days)
    const guard = quoteContextGuard(read, captured)
    prepared = {quote, guard}
    const calls = await bidFunding(bidder, quote.amount)
    guard()
    return guardedQuoteCalls(calls, guard)
  }, closePanel, {
    label: `Sign an offer of ${draft.price} ZNN for ${draft.name}`,
    fn: async () => {
      if (!prepared) throw new Error('Review the offer before signing.')
      const {quote, guard} = prepared
      guard()
      const order = await newOrder({side: BUY, collection: draft.collection as Address,
        tokenId: BigInt(draft.tokenId), price: quote.amount, paymentToken: draft.paymentToken}, draft.days)
      guard()
      const input = await signOrder(order)
      guard()
      await submitOrders([input])
      guard()
    },
  })
}

async function accept(o: any) {
  const ex = exchangeAddress()
  const owner = market.account()
  if (!ex || !owner) return
  await market.run(async () => {
    const input = await fetchInput(o.hash)
    return [
      ...(await market.approvalFor(collection.value as Address, owner, ex, collectionInfo.value?.name ?? 'this collection')),
      acceptBidCall(ex, input, BigInt(tokenId.value), `Sell ${name.value} for ${units(o.price, 18, 4)} ZNN`),
    ]
  }, load)
}

async function withdrawOffer(o: any) {
  const ex = exchangeAddress()
  if (!ex) return
  await market.run(async () => [cancelOrdersCall(ex, [(await fetchInput(o.hash)).order], 'Withdraw the offer')], load)
}

function openPanel(which: 'list' | 'offer') {
  panel.value = panel.value === which ? 'none' : which
  price.value = ''
  if (which !== 'list' || !listing.value) return
  try {
    const original = relistingQuote(listing.value.price, listing.value.currency, qsr.value)
    currency.value = original.currency
    price.value = original.text
  } catch (err: any) {market.error.value = err?.message ?? 'Review the original listing price.'}
}
</script>

<template>
  <StateBlock :loading="loading" :error="error">
    <div v-if="item" class="grid gap-4 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)] items-start">
      <div class="grid gap-3">
        <div class="card overflow-hidden"><NftImage :src="item.image" :alt="name" :rounded="false" /></div>
        <Panel v-if="meta.attributes?.length" title="Traits">
          <div class="p-3 grid gap-2 grid-cols-2">
            <div v-for="(t, i) in meta.attributes" :key="i" class="rounded-[6px] border border-[var(--color-line)] bg-[var(--color-sunk)] p-2">
              <div class="ledger truncate">{{ t.trait_type ?? 'trait' }}</div>
              <div class="mono text-[13px] truncate">{{ t.value }}</div>
            </div>
          </div>
        </Panel>
        <Panel title="Details">
          <dl class="p-4 grid gap-2 text-[13px]">
            <div class="flex justify-between gap-3"><dt class="text-[var(--color-dim)]">Contract</dt><dd><AddressLink :address="item.collection" :length="6" /></dd></div>
            <div class="flex justify-between gap-3"><dt class="text-[var(--color-dim)]">Token id</dt><dd class="mono">{{ item.tokenId }}</dd></div>
            <div class="flex justify-between gap-3"><dt class="text-[var(--color-dim)]">Standard</dt><dd class="mono">ERC-721</dd></div>
            <div class="flex justify-between gap-3"><dt class="text-[var(--color-dim)]">Minted</dt><dd class="mono">block {{ number(item.mintedBlock) }}</dd></div>
            <div v-if="item.uri" class="flex justify-between gap-3">
              <dt class="text-[var(--color-dim)]">Metadata</dt>
              <dd><a class="link mono text-[12.5px]" :href="mediaURL(item.uri)" target="_blank" rel="noreferrer">{{ short(item.uri, 14, 8) }}</a></dd>
            </div>
          </dl>
        </Panel>
      </div>

      <div class="grid gap-4">
        <Panel>
          <div class="p-4 grid gap-3">
            <div>
              <router-link :to="`/collection/${item.collection}`" class="link text-[13px]">{{ collectionInfo?.name || 'Collection' }}</router-link>
              <h1 class="text-[20px] font-semibold tracking-tight mt-0.5">{{ name }}</h1>
              <p class="text-[13px] text-[var(--color-dim)] mt-1">
                Held by <AddressLink :address="item.owner" :length="8" />
                <Badge v-if="isOwner" tone="good" class="ml-2">yours</Badge>
              </p>
            </div>
            <p v-if="meta.description" class="text-[13px] leading-relaxed max-w-[70ch]">{{ meta.description }}</p>

            <div class="rounded-[6px] border border-[var(--color-line)] bg-[var(--color-sunk)] p-4 grid gap-3">
              <template v-if="listing">
                <div>
                  <div class="ledger">Price</div>
                  <div class="mono text-[26px] leading-tight">
                    {{ units(listing.price, listingCurrency.decimals, 6) }} {{ listingCurrency.symbol }}
                  </div>
                  <div class="text-[13px]">
                    <Usd :amount="listing.price" :decimals="listingCurrency.decimals" :token="listingCurrency.key" />
                    <span class="text-[var(--color-dim)]"> · listed by </span><AddressLink :address="listing.seller" :length="6" />
                    <span class="text-[var(--color-dim)]"> · until {{ orderDate(listing.expiry) }}</span>
                  </div>
                </div>
                <div class="flex flex-wrap gap-2">
                  <button v-if="!isOwner" class="btn btn-plasma px-4 py-2" :disabled="market.busy.value || !market.account()" @click="buy">
                    {{ market.busy.value ? 'Working…' : 'Buy now' }}
                  </button>
                  <button v-if="isOwner" class="btn px-4 py-2" :disabled="market.busy.value" @click="cancel">Take off sale</button>
                  <button v-if="isOwner" class="btn px-4 py-2" @click="openPanel('list')">Change price</button>
                  <button v-if="!isOwner" class="btn px-4 py-2" @click="openPanel('offer')">Make an offer</button>
                </div>
              </template>
              <template v-else>
                <div class="text-[13px] text-[var(--color-dim)]">Not for sale.</div>
                <div class="flex flex-wrap gap-2">
                  <button v-if="isOwner" class="btn btn-plasma px-4 py-2" @click="openPanel('list')">List for sale</button>
                  <button v-else class="btn btn-plasma px-4 py-2" @click="openPanel('offer')">Make an offer</button>
                </div>
              </template>

              <div v-if="panel !== 'none'" class="grid gap-3 border-t border-[var(--color-line)] pt-3">
                <div class="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                  <div class="rounded-[6px] border border-[var(--color-line)] bg-[var(--color-bg)] p-3">
                    <div class="ledger">{{ panel === 'list' ? 'Asking price' : 'Your offer' }}</div>
                    <div class="flex items-center gap-2">
                      <input v-model="price" inputmode="decimal" placeholder="0" :aria-label="panel === 'list' ? 'Asking price' : 'Offer price'" class="flex-1 min-w-0 bg-transparent outline-none mono text-[22px]" />
                      <select v-if="panel === 'list'" v-model="currency" class="input w-[90px]" aria-label="Currency">
                        <option value="znn">ZNN</option>
                        <option v-if="qsr" value="qsr">QSR</option>
                      </select>
                      <span v-else class="mono text-[14px]">ZNN</span>
                    </div>
                  </div>
                  <div class="rounded-[6px] border border-[var(--color-line)] bg-[var(--color-bg)] p-3">
                    <div class="ledger">Days</div>
                    <input v-model.number="days" type="number" min="1" max="365" aria-label="Days until it expires" class="w-[80px] bg-transparent outline-none mono text-[22px]" />
                  </div>
                </div>
                <p v-if="panel === 'offer'" class="text-[12.5px] text-[var(--color-dim)]">
                  An offer is a signature: nothing leaves your wallet until the owner accepts. It is paid in wrapped ZNN, so the first
                  offer wraps what it needs and lets the exchange spend it — up to two transactions, once.
                </p>
                <p v-else class="text-[12.5px] text-[var(--color-dim)]">
                  A listing is a signature: the token stays in your wallet and nothing is sent. The first listing in a collection also lets
                  the exchange move its tokens, which is one transaction, once.
                </p>
                <button class="btn btn-plasma justify-center py-2" :disabled="market.busy.value || !price || !market.account()" @click="panel === 'list' ? list() : offer()">
                  {{ market.busy.value ? 'Working…' : !market.account() ? 'Connect a wallet' : panel === 'list' ? 'List it' : 'Sign the offer' }}
                </button>
              </div>

              <p v-if="market.error.value" class="text-[13px] text-[var(--color-danger)] break-words">{{ market.error.value }}</p>
              <StepList :steps="market.steps.value" />
            </div>
          </div>
        </Panel>

        <Panel title="Offers" subtitle="shown only while the bidder can still pay">
          <StateBlock :empty="!offers.length" empty-text="No offers on this item.">
            <table class="w-full text-[13px]">
              <tbody>
                <tr v-for="o in offers" :key="o.hash">
                  <td class="td">
                    <span class="mono">{{ units(o.price, 18, 4) }} ZNN</span>
                    <span v-if="o.quantity > 1" class="text-[12px] text-[var(--color-dim)]"> × {{ o.quantity - o.filled }}</span>
                    <Badge v-if="o.isCollection" tone="plain" class="ml-2" title="An offer for any item in this collection">collection</Badge>
                    <div class="text-[12px]"><Usd :amount="o.price" :decimals="18" token="znn" /></div>
                  </td>
                  <td class="td"><AddressLink :address="o.bidder" :length="6" /></td>
                  <td class="td text-[12.5px] text-[var(--color-dim)]">until {{ orderDate(o.expiry) }}</td>
                  <td class="td text-right">
                    <button v-if="isOwner" class="btn px-2.5 py-1 text-[12.5px]" :disabled="market.busy.value" @click="accept(o)">Accept</button>
                    <button
                      v-else-if="sameAddress(market.account(), o.bidder)"
                      class="btn px-2.5 py-1 text-[12.5px]"
                      :disabled="market.busy.value"
                      @click="withdrawOffer(o)"
                    >
                      Withdraw
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </StateBlock>
        </Panel>

        <Panel title="History">
          <StateBlock :empty="!item.sales?.length && !item.transfers?.length" empty-text="Nothing yet.">
            <table class="w-full text-[13px]">
              <tbody>
                <tr v-for="s in item.sales ?? []" :key="`${s.tx}-${s.index}`">
                  <td class="td"><Badge tone="good">{{ s.acceptedBid ? 'offer taken' : 'sale' }}</Badge></td>
                  <td class="td"><AddressLink :address="s.seller" :length="6" /> <span class="text-[var(--color-dim)]">→</span> <AddressLink :address="s.buyer" :length="6" /></td>
                  <td class="td text-right mono whitespace-nowrap">
                    {{ units(s.price, currencyOf(s.currency, qsr).decimals, 4) }} {{ currencyOf(s.currency, qsr).symbol }}
                  </td>
                  <td class="td text-[12.5px] text-[var(--color-dim)] whitespace-nowrap">
                    {{ ago(s.timestamp) }} · <HashLink :hash="s.tx" :to="`/tx/${s.tx}`" :head="6" :tail="4" />
                  </td>
                </tr>
                <tr v-for="(t, i) in item.transfers ?? []" :key="`t${i}`">
                  <td class="td"><Badge tone="plain">transfer</Badge></td>
                  <td class="td"><AddressLink :address="t.from" :length="6" /> <span class="text-[var(--color-dim)]">→</span> <AddressLink :address="t.to" :length="6" /></td>
                  <td class="td text-right mono text-[var(--color-dim)]">—</td>
                  <td class="td text-[12.5px] text-[var(--color-dim)]">#{{ t.tokenId }}</td>
                </tr>
              </tbody>
            </table>
          </StateBlock>
        </Panel>
      </div>
    </div>
  </StateBlock>
</template>
