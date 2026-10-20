<script setup lang="ts">
// A small check beside a contract whose sources are published. Lucide's
// badge-check, with the words for it in the title and for screen readers, so
// the mark never relies on its colour.
import {computed} from 'vue'
import {markFor} from '../core/verified'

const props = withDefaults(defineProps<{address?: string | null; size?: number}>(), {size: 13})

const mark = computed(() => markFor(props.address))
const label = computed(() => {
  const m = mark.value
  if (!m) return ''
  const name = m.name.split(':').pop()
  return m.proxy ? `Proxy to verified contract ${name}` : `Verified contract: ${name}, ${m.match} match`
})
</script>

<template>
  <span v-if="mark" class="inline-flex shrink-0 items-center text-[var(--znn-ink)]" :title="label">
    <svg
      :width="size"
      :height="size"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2.25"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path
        d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z"
      />
      <path d="m9 12 2 2 4-4" />
    </svg>
    <span class="sr-only">{{ label }}</span>
  </span>
</template>
