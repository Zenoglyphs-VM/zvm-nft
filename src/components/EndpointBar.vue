<script setup lang="ts">
// Which node this explorer reads. Optional in the sense that it has a working
// default and most people never touch it; it is a plain text field because
// pointing a explorer at your own node should not need a menu.
import {computed, ref, watch} from 'vue'
import {endpoint, setEndpoint, check, DEFAULT_ENDPOINT, isLoopback, mixedContentBlocked} from '../core/endpoint'
import {wallet} from '../core/wallet'
import {number} from '../core/format'
import Icon from './Icon.vue'

const draft = ref(endpoint.url)
const open = ref(false)
const busy = ref(false)
const field = ref<HTMLInputElement | null>(null)

watch(
  () => endpoint.url,
  (v) => (draft.value = v),
)

const dirty = computed(() => draft.value.trim() !== endpoint.url)

const tone = computed(() => {
  if (busy.value || endpoint.health === 'checking') return 'var(--warn)'
  if (endpoint.health === 'ok') return 'var(--znn-ink)'
  if (endpoint.health === 'error') return 'var(--danger)'
  return 'var(--dim)'
})

const status = computed(() => {
  if (busy.value || endpoint.health === 'checking') return 'Checking the node…'
  if (endpoint.health === 'ok') {
    const parts = [`Chain ${endpoint.chainId}`]
    if (endpoint.latency !== null) parts.push(`${endpoint.latency} ms`)
    if (wallet.info) parts.push(`block ${number(wallet.info.l2.head)}`)
    return parts.join(' · ')
  }
  if (endpoint.health === 'error') return endpoint.error ?? 'Not reachable'
  return 'Not checked yet'
})

/** Shown before a request is made, because the browser will refuse this one. */
const willBlock = computed(() => mixedContentBlocked(draft.value.trim()))

async function apply() {
  busy.value = true
  try {
    await setEndpoint(draft.value)
  } finally {
    busy.value = false
  }
  if (endpoint.health === 'ok') open.value = false
}

async function retry() {
  busy.value = true
  try {
    await check()
  } finally {
    busy.value = false
  }
}

function useDefault() {
  draft.value = DEFAULT_ENDPOINT
  field.value?.focus()
}
</script>

<template>
  <div class="relative">
    <form class="flex items-center gap-1.5" @submit.prevent="apply">
      <div class="relative">
        <span
          class="absolute left-2.5 top-1/2 -translate-y-1/2 dot"
          :class="endpoint.health === 'checking' || busy ? 'live-dot' : ''"
          :style="{background: tone}"
        />
        <input
          ref="field"
          v-model="draft"
          class="input pl-7 pr-8 w-[210px] sm:w-[248px] text-[12px]"
          spellcheck="false"
          autocomplete="off"
          aria-label="ZVM node endpoint"
          :placeholder="DEFAULT_ENDPOINT"
          @focus="open = true"
          @keydown.escape="((draft = endpoint.url), (open = false))"
        />
        <button
          type="button"
          class="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 text-dim hover:text-fg transition-colors"
          :title="open ? 'Hide node details' : 'Show node details'"
          @click="open = !open"
        >
          <Icon name="down" :size="13" :class="open ? 'rotate-180 transition-transform' : 'transition-transform'" />
        </button>
      </div>
      <button v-if="dirty" class="btn btn-sm btn-plasma" type="submit" :disabled="busy">Use node</button>
    </form>

    <!-- Details, diagnostics and the one browser rule that catches people out. -->
    <div v-if="open" class="absolute right-0 mt-2 z-50 pop p-3 w-[330px] max-w-[92vw]">
      <div class="flex items-start gap-2">
        <span class="dot mt-1.5" :style="{background: tone}" />
        <div class="min-w-0 grow">
          <p class="text-[13px]" :style="{color: endpoint.health === 'error' ? 'var(--danger)' : 'var(--fg)'}">
            {{ status }}
          </p>
          <p v-if="endpoint.hint" class="text-[12px] text-dim mt-1">{{ endpoint.hint }}</p>
        </div>
      </div>

      <p v-if="willBlock" class="mt-2.5 text-[12px] rounded p-2" style="background: color-mix(in srgb, var(--warn) 12%, transparent); color: var(--warn)">
        Your browser will block this: an HTTPS page cannot load plain HTTP. Loopback is the
        exception, so <code class="mono">http://localhost</code> works and a LAN address does not.
      </p>

      <div class="mt-3 flex flex-wrap items-center gap-1.5">
        <button class="btn btn-sm" :disabled="busy" @click="retry">
          <Icon name="refresh" :size="13" /> Check again
        </button>
        <button class="btn btn-sm btn-quiet" @click="useDefault">Use default</button>
        <span class="grow" />
        <button class="btn btn-sm btn-quiet" @click="open = false">Close</button>
      </div>

      <p class="mt-3 pt-2.5 border-t border-line text-[12px] text-dim">
        The node's explorer port, which serves <code class="mono">/api</code> and
        <code class="mono">/rpc</code>. 47000 by default.
        <template v-if="isLoopback(endpoint.url)">
          Your browser talks to this one directly. Nothing is proxied.
        </template>
      </p>
    </div>
  </div>
</template>
