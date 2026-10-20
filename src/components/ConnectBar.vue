<script setup lang="ts">
// MetaMask, Rabby, Phantom, and anything else that announces itself through
// EIP-6963. Connecting is optional: it is needed only to call a contract from
// an address page.
import {computed, onMounted, onUnmounted, ref} from 'vue'
import {wallet, connectEvm, disconnectEvm, wrongChain, switchToChain} from '../core/wallet'
import {knownWallets, requestWallets, onWallets, type Discovered} from '../core/evm'
import {short} from '../core/format'
import {endpoint} from '../core/endpoint'
import Icon from './Icon.vue'

const wallets = ref<Discovered[]>([])
const picking = ref(false)
const busy = ref(false)

let off: (() => void) | undefined
onMounted(() => {
  wallets.value = requestWallets()
  off = onWallets(() => (wallets.value = knownWallets()))
})
onUnmounted(() => off?.())

const label = computed(() => (wallet.evm.address ? short(wallet.evm.address, 6, 4) : 'Connect wallet'))
const canConnect = computed(() => endpoint.health === 'ok' && !!wallet.info)

async function pick(w: Discovered) {
  picking.value = false
  busy.value = true
  try {
    await connectEvm(w.provider, w.name)
  } catch {
    // wallet.error carries the message; the header shows it.
  } finally {
    busy.value = false
  }
}

function toggle() {
  if (wallet.evm.address) return disconnectEvm()
  wallets.value = requestWallets()
  picking.value = !picking.value
}
</script>

<template>
  <div class="flex items-center gap-1.5">
    <div class="relative">
      <button
        class="btn btn-sm"
        :disabled="busy || (!canConnect && !wallet.evm.address)"
        :title="canConnect || wallet.evm.address ? 'MetaMask, Rabby, Phantom' : 'Connect to a node first'"
        @click="toggle"
      >
        <span class="dot" :style="{background: wallet.evm.address ? 'var(--znn-ink)' : 'var(--line-strong)'}" />
        <span class="mono text-[12px]">{{ label }}</span>
      </button>

      <div v-if="picking" class="absolute right-0 mt-2 z-50 pop p-1 w-[228px]">
        <button
          v-for="w in wallets"
          :key="w.id"
          class="w-full text-left px-2.5 py-2 rounded flex items-center gap-2.5 hover:bg-raised transition-colors"
          @click="pick(w)"
        >
          <img v-if="w.icon" :src="w.icon" alt="" class="w-4 h-4 rounded" />
          <Icon v-else name="wallet" :size="15" class="text-dim" />
          <span class="text-[13px]">{{ w.name }}</span>
        </button>
        <p v-if="!wallets.length" class="px-2.5 py-2.5 text-[12.5px] text-dim">
          No EVM wallet in this browser. Install MetaMask, Rabby or Phantom, then reload.
        </p>
      </div>
    </div>

    <button
      v-if="wrongChain"
      class="btn btn-sm"
      style="color: var(--warn); border-color: var(--warn)"
      @click="switchToChain"
    >
      <Icon name="alert" :size="13" /> Switch network
    </button>
  </div>
</template>
