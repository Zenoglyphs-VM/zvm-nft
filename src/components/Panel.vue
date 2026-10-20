<script setup lang="ts">
defineProps<{title?: string; subtitle?: string}>()
</script>

<template>
  <section class="card overflow-hidden">
    <header v-if="title || $slots.actions" class="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-[var(--color-line)]">
      <div>
        <h2 class="ledger">{{ title }}</h2>
        <p v-if="subtitle" class="text-[13px] text-[var(--color-dim)] mt-0.5">{{ subtitle }}</p>
      </div>
      <div class="flex items-center gap-2">
        <slot name="actions" />
      </div>
    </header>
    <div :class="$slots.actions || title ? '' : ''">
      <slot />
    </div>
  </section>
</template>
