<script setup lang="ts">
import {computed} from 'vue'
import {short, tokenColor, tokenLabel} from '../core/format'
import {knownAddress} from '../core/knownAddresses'
import {tokenNameFor} from '../core/tokenNames'
import {markFor} from '../core/verified'
import VerifiedMark from './VerifiedMark.vue'

// Every address has two spellings of the same 20 bytes: NoM's z1… and the
// EVM's 0x…. The explorer shows one and tooltips both. A verified contract
// carries a check beside it. In place of the hash, since it means nothing to
// read at a glance: a NoM embedded contract's name (Pillar, Plasma, …), or a
// token's "Name (SYMBOL)" — the Token tracker's own naming scheme — or a
// verified contract's bare name, in that order. An explicit `label` wins over
// all three.
const props = withDefaults(
  defineProps<{address?: string | null; nom?: boolean; length?: number; label?: string}>(),
  {nom: false, length: 8},
)

const known = computed(() => knownAddress(props.address))
const token = computed(() => tokenNameFor(props.address))
// "path/File.sol:Name" from the compiler, down to the bare contract name.
const verifiedName = computed(() => markFor(props.address)?.name.split(':').pop())

const display = computed(() => {
  if (!props.address) return '—'
  if (props.label) return props.label
  if (known.value) return known.value.name
  if (token.value) return tokenLabel(token.value.name, token.value.symbol)
  if (verifiedName.value) return verifiedName.value
  return short(props.address, props.nom ? 10 : props.length, 6)
})

// ZNN and QSR (native or wrapped) keep their marketing color even here,
// where they show up as a token tracker name rather than a bare symbol.
const brand = computed(() => (token.value ? tokenColor(token.value.symbol) : undefined))

const tooltip = computed(() => {
  if (!props.address) return ''
  if (known.value) return `${props.address} — ${known.value.description}`
  if (token.value) return props.address
  if (verifiedName.value) return `${props.address} — verified as ${verifiedName.value}`
  return props.address
})
</script>

<template>
  <span v-if="address" class="inline-flex items-center gap-1 min-w-0 align-baseline">
    <router-link :to="`/address/${address}`" class="mono text-[13px] link" :style="brand ? {color: brand} : undefined" :title="tooltip">
      {{ display }}
    </router-link>
    <VerifiedMark :address="address" />
  </span>
  <span v-else class="text-[var(--color-dim)]">—</span>
</template>
