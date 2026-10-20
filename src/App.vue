<script setup lang="ts">
import {computed, onMounted, ref} from 'vue'
import {wallet, init} from './core/wallet'
import {endpoint, check} from './core/endpoint'
import {startPrices} from './core/prices'
import {number} from './core/format'
import ConnectBar from './components/ConnectBar.vue'
import EndpointBar from './components/EndpointBar.vue'
import Icon from './components/Icon.vue'
import ZenoglyphMark from '@zvm/web/components/ZenoglyphMark.vue'
import LatticeBackground from '@zvm/web/components/LatticeBackground.vue'

const nav = [
  {to: '/', label: 'Explore', icon: 'image' as const},
  {to: '/create', label: 'Create', icon: 'plus' as const},
]

const menuOpen = ref(false)

const theme = ref(document.documentElement.getAttribute('data-theme') ?? 'dark')
function toggleTheme() {
  theme.value = theme.value === 'dark' ? 'light' : 'dark'
  document.documentElement.setAttribute('data-theme', theme.value)
  try {
    localStorage.setItem('zvm.theme', theme.value)
  } catch {
    /* storage can be blocked; the theme still applies for this tab */
  }
}

// The search belongs on every page except the front one, which has its own.
const offline = computed(() => endpoint.health === 'error')

onMounted(() => {
  init()
  startPrices()
})
</script>

<template>
  <div class="min-h-screen flex flex-col">
    <LatticeBackground />

    <header class="sticky top-0 z-30 border-b border-line bg-bg/85 backdrop-blur-md">
      <div class="mx-auto max-w-[1280px] px-4 py-2.5 flex items-center gap-3">
        <router-link to="/" class="flex items-center gap-2.5 shrink-0" title="ZVM Explorer">
          <ZenoglyphMark :size="26" />
          <span class="font-semibold tracking-[-0.02em] text-[15.5px] hidden sm:block">ZVM</span>
        </router-link>

        <nav class="hidden lg:flex items-center gap-0.5 text-[13.5px] min-w-0">
          <router-link
            v-for="item in nav"
            :key="item.to"
            :to="item.to"
            class="px-2.5 py-1.5 rounded text-dim hover:text-fg hover:bg-raised transition-colors"
            active-class="!text-fg bg-raised"
            >{{ item.label }}</router-link
          >
        </nav>

        <span class="grow" />

        <router-link
          to="/about"
          class="btn btn-sm btn-quiet px-2"
          style="color: var(--znn-ink)"
          title="How this chain works"
        >
          <Icon name="info" :size="15" />
          <span class="sr-only">How this chain works</span>
        </router-link>

        <button class="btn btn-sm btn-quiet px-2" :title="`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`" @click="toggleTheme">
          <Icon :name="theme === 'dark' ? 'sun' : 'moon'" :size="15" />
          <span class="sr-only">Switch theme</span>
        </button>

        <div class="hidden md:block"><ConnectBar /></div>
        <div class="hidden sm:block"><EndpointBar /></div>

        <button class="btn btn-sm btn-quiet px-2 lg:hidden" title="Menu" @click="menuOpen = !menuOpen">
          <Icon :name="menuOpen ? 'x' : 'menu'" :size="16" />
          <span class="sr-only">Menu</span>
        </button>
      </div>

      <!-- Small screens: the nav and the controls that did not fit. -->
      <div v-if="menuOpen" class="lg:hidden border-t border-line px-4 py-3 grid gap-3 bg-surface">
        <div class="grid grid-cols-2 gap-1">
          <router-link
            v-for="item in nav"
            :key="item.to"
            :to="item.to"
            class="px-3 py-2 rounded text-[13.5px] text-dim hover:bg-raised flex items-center gap-2.5 transition-colors"
            active-class="!text-fg bg-raised"
            @click="menuOpen = false"
          >
            <Icon :name="item.icon" :size="15" />{{ item.label }}
          </router-link>
        </div>
        <div class="md:hidden"><ConnectBar /></div>
        <div class="sm:hidden"><EndpointBar /></div>
      </div>
    </header>

    <!-- One banner, not one per failed request: when the node is unreachable,
         every page below is empty for the same reason. -->
    <div v-if="offline" class="border-b" style="border-color: color-mix(in srgb, var(--danger) 35%, transparent); background: color-mix(in srgb, var(--danger) 9%, transparent)">
      <div class="mx-auto max-w-[1280px] px-4 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
        <Icon name="alert" :size="15" style="color: var(--danger)" />
        <span>{{ endpoint.error }}</span>
        <span v-if="endpoint.hint" class="text-dim">{{ endpoint.hint }}</span>
        <button class="btn btn-sm ml-auto" @click="check()"><Icon name="refresh" :size="13" /> Try again</button>
      </div>
    </div>

    <main class="mx-auto w-full max-w-[1280px] px-4 py-5 flex-1 grid grid-cols-[minmax(0,1fr)] gap-5 content-start">
      <p v-if="wallet.error" class="card px-4 py-2.5 text-[13px]" style="color: var(--danger)">{{ wallet.error }}</p>
      <router-view />
    </main>

    <footer class="border-t border-line mt-6 bg-bg/85 backdrop-blur-md">
      <div class="mx-auto max-w-[1280px] px-4 py-5 flex flex-wrap gap-x-8 gap-y-3 text-[12.5px] text-dim">
        <div>
          <div class="ledger mb-1">Reading</div>
          <div class="mono">{{ endpoint.url }}</div>
        </div>
        <div v-if="wallet.info">
          <div class="ledger mb-1">ZVM</div>
          <div class="mono">
            chain {{ wallet.info.l2.chainId }} · block {{ number(wallet.info.l2.head) }} · finalized
            {{ number(wallet.info.l2.finalized) }}
          </div>
        </div>
        <div v-if="wallet.info">
          <div class="ledger mb-1">Network of Momentum</div>
          <div class="mono">
            chain {{ wallet.info.l1.chainId }} · momentum {{ number(wallet.info.l1.frontier) }}
          </div>
        </div>
      </div>
    </footer>
  </div>
</template>
