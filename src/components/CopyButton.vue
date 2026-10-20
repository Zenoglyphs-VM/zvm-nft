<script setup lang="ts">
// Every hash on the page is truncated, so every hash needs a way to get the
// whole thing. The button keeps the same name through the flow: "Copy" becomes
// "Copied".
import {ref, onUnmounted} from 'vue'
import Icon from './Icon.vue'

const props = withDefaults(defineProps<{value?: string | null; label?: string; size?: number}>(), {size: 13})

const done = ref(false)
const failed = ref(false)
let timer: number | undefined

async function copy() {
  if (!props.value) return
  try {
    await navigator.clipboard.writeText(props.value)
    done.value = true
    failed.value = false
  } catch {
    // Clipboard access needs a secure context and permission; neither is
    // guaranteed, and a silent no-op would look like a broken button.
    failed.value = true
  }
  clearTimeout(timer)
  timer = window.setTimeout(() => {
    done.value = false
    failed.value = false
  }, 1600)
}

onUnmounted(() => clearTimeout(timer))
</script>

<template>
  <button
    v-if="value"
    type="button"
    class="relative inline-flex items-center gap-1 align-middle text-dim hover:text-fg transition-colors"
    :title="failed ? 'Your browser blocked the clipboard' : done ? 'Copied' : `Copy ${label ?? 'to clipboard'}`"
    @click.stop.prevent="copy"
  >
    <Icon :name="failed ? 'alert' : done ? 'check' : 'copy'" :size="size" :class="done ? 'text-znn' : ''" />
    <!-- relative on the button anchors this: unanchored, the absolute label
         escaped a table's scroll box and widened the whole page on a phone. -->
    <span class="sr-only">{{ done ? 'Copied' : `Copy ${label ?? 'value'}` }}</span>
  </button>
</template>
