<script setup lang="ts">
import {short} from '../core/format'

defineProps<{
  hash?: string | null
  to?: string
  head?: number
  tail?: number
}>()
</script>

<template>
  <router-link v-if="hash && to" :to="to" class="mono text-[13px] link" :title="hash">
    {{ short(hash, head ?? 10, tail ?? 6) }}
  </router-link>
  <span v-else-if="hash" class="mono text-[13px]" :title="hash">{{ short(hash, head ?? 10, tail ?? 6) }}</span>
  <span v-else class="text-[var(--color-dim)]">—</span>
</template>
