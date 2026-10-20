<script setup lang="ts">
import {computed} from 'vue'
import {units} from '../core/format'
import {currencyOf} from '../core/nft'
import {wallet} from '../core/wallet'
import NftImage from './NftImage.vue'
import Usd from './Usd.vue'

const props = defineProps<{
  collection: string
  item: {tokenId: string; name?: string; image?: string; owner?: string; listing?: {price: string; currency: string; priceNum: number}}
  collectionName?: string
}>()

const qsr = computed(() => wallet.info?.apps?.rewardToken ?? null)
const currency = computed(() => currencyOf(props.item.listing?.currency, qsr.value))
const label = computed(() => props.item.name || `#${props.item.tokenId}`)
</script>

<template>
  <router-link
    :to="`/nft/${collection}/${item.tokenId}`"
    class="card overflow-hidden hover:border-[var(--color-line-strong)] transition-colors block"
  >
    <NftImage :src="item.image" :alt="label" :rounded="false" />
    <div class="p-3 grid gap-1">
      <div class="text-[13.5px] font-medium truncate">{{ label }}</div>
      <div v-if="collectionName" class="text-[12px] text-[var(--color-dim)] truncate">{{ collectionName }}</div>
      <div v-if="item.listing" class="flex items-baseline justify-between gap-2 pt-1">
        <span class="mono text-[13px]">{{ units(item.listing.price, currency.decimals, 4) }} {{ currency.symbol }}</span>
        <Usd :amount="item.listing.price" :decimals="currency.decimals" :token="currency.key" />
      </div>
      <div v-else class="text-[12px] text-[var(--color-dim)] pt-1">Not for sale</div>
    </div>
  </router-link>
</template>
