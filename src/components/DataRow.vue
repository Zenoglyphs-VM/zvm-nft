<script setup lang="ts">
// One fact on a detail page: what it is on the left, what it says on the right.
//
// Half of what an explorer shows is jargon, so most rows carry a sentence
// explaining the term. That sentence lives behind an info marker rather than
// under every label: printed inline it doubled the height of every page and
// buried the values, which are what people came for.
import InfoTip from './InfoTip.vue'

defineProps<{label: string; help?: string}>()
</script>

<template>
  <div class="grid gap-x-6 gap-y-1 px-4 py-3 border-b border-line last:border-b-0 sm:grid-cols-[210px_minmax(0,1fr)]">
    <dt class="text-[13px] text-dim flex items-center gap-1.5">
      {{ label }}
      <InfoTip v-if="help" :text="help" :label="label" />
    </dt>
    <dd class="min-w-0 text-[13.5px]"><slot /></dd>
  </div>
</template>
