<script setup lang="ts">
import type {Step} from '../core/lanes'
import Badge from '@zvm/web/components/Badge.vue'
import HashLink from './HashLink.vue'

defineProps<{steps: Step[]}>()

// One word per state, as everywhere else in the app.
const tone = {pending: 'plain', signing: 'warn', published: 'info', done: 'good', failed: 'bad'} as const
const word = {pending: 'Queued', signing: 'Awaiting wallet', published: 'Sent', done: 'Confirmed', failed: 'Failed'}
</script>

<template>
  <ol v-if="steps.length" class="grid gap-3 text-[13px]">
    <li v-for="(s, i) in steps" :key="i" class="grid gap-1" :data-state="s.state">
      <div class="flex items-center justify-between gap-2">
        <span class="min-w-0">{{ s.label }}</span>
        <Badge :tone="tone[s.state]">{{ word[s.state] }}</Badge>
      </div>
      <div v-if="s.txHash" class="flex flex-wrap gap-x-4 text-[12.5px] text-[var(--color-dim)]">
        <span>ZVM <HashLink :hash="s.txHash" :to="`/tx/${s.txHash}`" :head="10" /></span>
      </div>
      <p v-if="s.detail" class="text-[12.5px] mono break-words" :class="s.state === 'failed' ? 'text-[var(--color-danger)]' : 'text-[var(--color-dim)]'">
        {{ s.detail }}
      </p>
    </li>
  </ol>
</template>
