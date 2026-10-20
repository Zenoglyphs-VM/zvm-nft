<script setup lang="ts">
// A token's art. The URL on chain names the object by its own hash, so this
// resolves it to wherever the node says objects should be read from — the CDN
// hostname when one is in front of it, this node otherwise.
import {computed, ref, watch} from 'vue'
import {mediaURL} from '../core/media'

const props = withDefaults(defineProps<{src?: string | null; alt?: string; rounded?: boolean}>(), {rounded: true})
const failed = ref(false)
const url = computed(() => mediaURL(props.src))
watch(url, () => (failed.value = false))
</script>

<template>
  <div
    class="relative w-full aspect-square overflow-hidden bg-[var(--color-sunk)]"
    :class="rounded ? 'rounded-[6px]' : ''"
  >
    <img
      v-if="url && !failed"
      :src="url"
      :alt="alt ?? ''"
      loading="lazy"
      class="w-full h-full object-cover"
      @error="failed = true"
    />
    <!-- A thumbnail is too small for a sentence: the mark stands in, and the
         title says which case it is. -->
    <div
      v-else
      class="w-full h-full grid place-items-center text-[var(--color-line-strong)]"
      :title="url ? 'this image did not load' : 'no image'"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="w-1/3 h-1/3" aria-hidden="true">
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <path d="m4 16 4.5-4.5a1.5 1.5 0 0 1 2 0L15 16" />
        <circle cx="15" cy="8.5" r="1.5" />
      </svg>
    </div>
  </div>
</template>
