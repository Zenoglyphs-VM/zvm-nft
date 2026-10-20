<script setup lang="ts">
// A panel that opens. Built on <details> so keyboard and find-in-page work
// without being re-implemented, with the marker replaced by a chevron.
import Icon from './Icon.vue'

withDefaults(defineProps<{title: string; open?: boolean}>(), {open: false})
</script>

<template>
  <details class="panel overflow-hidden group" :open="open">
    <summary
      class="flex items-center gap-3 px-4 py-3 cursor-pointer select-none list-none hover:bg-raised transition-colors"
    >
      <div class="min-w-0 grow">
        <h2 class="ledger">{{ title }}</h2>
      </div>
      <Icon name="down" :size="16" class="chevron text-dim" />
    </summary>
    <div class="border-t border-line"><slot /></div>
  </details>
</template>

<style scoped>
summary::-webkit-details-marker,
summary::marker {
  display: none;
  content: '';
}

/* The chevron lives inside Icon, so a scoped rule needs :deep to reach it.
   Written out rather than as a group-open utility, which does not cross the
   child component's style scope. */
.chevron {
  transition: transform 150ms var(--ease);
}
details[open] > summary .chevron {
  transform: rotate(180deg);
}
</style>
