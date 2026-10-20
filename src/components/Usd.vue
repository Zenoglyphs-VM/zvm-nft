<script setup lang="ts">
// A dollar value beside an amount. A token the node has no price for shows
// nothing at all rather than a zero, and the tooltip says where the price came
// from — a derived price is not the same claim as a quoted one.
import {computed} from 'vue'
import {fmtUsd, usdSource, usdValue} from '../core/prices'

const props = withDefaults(
  defineProps<{
    amount?: bigint | string | number | null
    decimals?: number
    token?: string | null
    value?: number | null
    compact?: boolean
    prefix?: string
    dash?: string
  }>(),
  {decimals: 18, token: 'znn', compact: false, prefix: '', dash: ''},
)

const dollars = computed(() => {
  if (props.value !== undefined && props.value !== null) return props.value
  if (props.value === null) return null
  return usdValue(props.amount ?? null, props.decimals, props.token)
})
const source = computed(() => usdSource(props.token))
</script>

<template>
  <span v-if="dollars !== null && dollars !== undefined" class="mono text-[var(--color-dim)]" :title="source">
    {{ prefix }}{{ fmtUsd(dollars, {compact}) }}
  </span>
  <span v-else-if="dash" class="text-[var(--color-dim)]">{{ dash }}</span>
</template>
