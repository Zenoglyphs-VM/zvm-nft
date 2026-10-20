<script setup lang="ts">
defineProps<{loading?: boolean; error?: string | null; empty?: boolean; emptyText?: string}>()
</script>

<template>
  <div v-if="loading" class="px-4 py-6 text-[var(--color-dim)] text-[13px]">Loading…</div>
  <div v-else-if="error" class="px-4 py-6 text-[var(--color-danger)] text-[13px] mono">{{ error }}</div>
  <div v-else-if="empty" class="px-4 py-6 text-[var(--color-dim)] text-[13px]">{{ emptyText ?? 'Nothing here yet.' }}</div>
  <slot v-else />
</template>
