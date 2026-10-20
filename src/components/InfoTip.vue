<script setup lang="ts">
// A marker that explains a term on hover, focus or tap.
//
// Positioned against the viewport rather than its own row: the panels these sit
// in clip their overflow to keep their corners, and a tooltip anchored inside
// one gets cut in half.
import {ref} from 'vue'
import Icon from './Icon.vue'

const props = withDefaults(defineProps<{text: string; label?: string; size?: number}>(), {size: 13})

const marker = ref<HTMLElement | null>(null)
const open = ref(false)
const at = ref({top: 0, left: 0})

const WIDTH = 280
const width = ref(WIDTH)

// A tap on a phone arrives as focus and then click. Focus opens the tip, and a
// plain toggle on click shut it again in the same gesture, so a tip was
// unreadable by touch. A click that lands straight after the open is that
// same tap, not a second one.
let openedAt = 0

function show() {
  const box = marker.value?.getBoundingClientRect()
  if (!box) return
  width.value = Math.min(WIDTH, window.innerWidth - 24)
  at.value = {top: box.bottom + 8, left: Math.max(12, Math.min(box.left, window.innerWidth - width.value - 12))}
  if (!open.value) openedAt = Date.now()
  open.value = true
}

function toggle() {
  if (open.value && Date.now() - openedAt > 400) open.value = false
  else show()
}

// Hover is for a mouse; a finger "enters" on tap and would race the click.
function hover(e: PointerEvent, on: boolean) {
  if (e.pointerType !== 'mouse') return
  if (on) show()
  else open.value = false
}
</script>

<template>
  <span
    ref="marker"
    class="inline-flex align-middle"
    @pointerenter="hover($event, true)"
    @pointerleave="hover($event, false)"
    @focusin="show"
    @focusout="open = false"
  >
    <button
      type="button"
      class="text-dim/70 hover:text-fg transition-colors"
      :aria-label="props.label ? `What is ${props.label}?` : 'More information'"
      @click="toggle"
    >
      <Icon name="info" :size="size" />
    </button>

    <Teleport to="body">
      <span
        v-if="open"
        class="pop fixed z-50 block px-3 py-2 text-[12.5px] text-soft pointer-events-none leading-snug"
        :style="{top: `${at.top}px`, left: `${at.left}px`, width: `${width}px`}"
        role="tooltip"
      >
        {{ text }}
      </span>
    </Teleport>
  </span>
</template>
