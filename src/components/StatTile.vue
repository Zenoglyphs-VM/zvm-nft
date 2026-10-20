<script setup lang="ts">
defineProps<{label: string; value: string | number; hint?: string; tone?: 'plain' | 'good' | 'warn' | 'bad'}>()
</script>

<template>
  <div class="card px-3.5 py-3 sm:px-4 min-w-0">
    <div class="ledger">{{ label }}</div>
    <div
      class="mono text-[17px] sm:text-[20px] leading-7 mt-1 font-semibold tracking-tight break-words"
      :class="{
        'text-[var(--color-primary-ink)]': tone === 'good',
        'text-[var(--color-warning)]': tone === 'warn',
        'text-[var(--color-danger)]': tone === 'bad',
      }"
    >
      {{ value }}
    </div>
    <div v-if="hint" class="text-[12.5px] text-[var(--color-dim)] mt-0.5">{{ hint }}</div>
  </div>
</template>
