<script setup lang="ts">
import {useRoute} from 'vue-router'
const route = useRoute()
</script>

<template>
  <div class="panel px-6 py-12 text-center">
    <h1 class="text-[20px] font-semibold tracking-[-0.02em]">Nothing at this address</h1>
    <p class="text-[13.5px] text-dim mt-2 max-w-[48ch] mx-auto">
      <code class="mono break-all">{{ route.fullPath }}</code> is not a page here. The search box takes a block, a
      transaction, an address or a momentum.
    </p>
    <div class="mt-5 flex flex-wrap items-center justify-center gap-2">
      <router-link to="/" class="btn btn-sm btn-plasma">Go to the overview</router-link>
      <router-link to="/about" class="btn btn-sm">How this chain works</router-link>
    </div>
  </div>
</template>
