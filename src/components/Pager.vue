<script setup lang="ts">
// The listings are cursor-paged, not offset-paged: the node answers "rows
// before this id", which stays correct while new blocks land under you. So
// there is no last page to jump to and no total to count, and the control says
// what it can honestly do.
import Icon from './Icon.vue'

defineProps<{page: number; hasPrev: boolean; hasNext: boolean; size?: number}>()
const emit = defineEmits<{first: []; prev: []; next: []; resize: [n: number]}>()

const SIZES = [25, 50, 100]
</script>

<template>
  <div class="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 border-t border-line">
    <label class="flex items-center gap-2 text-[12.5px] text-dim">
      Rows
      <select
        class="input w-auto py-1 px-2 text-[12.5px] cursor-pointer"
        :value="size ?? 25"
        @change="emit('resize', Number(($event.target as HTMLSelectElement).value))"
      >
        <option v-for="n in SIZES" :key="n" :value="n">{{ n }}</option>
      </select>
    </label>

    <div class="flex items-center gap-1.5">
      <button class="btn btn-sm btn-quiet" :disabled="!hasPrev" title="Newest" @click="emit('first')">
        <Icon name="first" :size="14" />
        <span class="sr-only">Jump to newest</span>
      </button>
      <button class="btn btn-sm" :disabled="!hasPrev" @click="emit('prev')">
        <Icon name="left" :size="14" /> Newer
      </button>
      <span class="mono text-[12.5px] text-dim px-2 tabular-nums">Page {{ page }}</span>
      <button class="btn btn-sm" :disabled="!hasNext" @click="emit('next')">
        Older <Icon name="right" :size="14" />
      </button>
    </div>
  </div>
</template>
