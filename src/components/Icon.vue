<script setup lang="ts">
// Lucide, inlined. The system calls for Lucide everywhere and no emoji; a
// bundle that must stay CDN-free and small carries the dozen paths it uses
// rather than the package.
import {computed} from 'vue'

const props = withDefaults(defineProps<{name: keyof typeof PATHS; size?: number; stroke?: number}>(), {
  size: 16,
  stroke: 2,
})

const PATHS = {
  search: ['M21 21l-4.34-4.34', 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z'],
  copy: ['M20 8H10a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V10a2 2 0 0 0-2-2Z', 'M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2'],
  check: ['M20 6 9 17l-5-5'],
  x: ['M18 6 6 18', 'M6 6l12 12'],
  sun: ['M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z', 'M12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4'],
  moon: ['M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z'],
  external: ['M15 3h6v6', 'M10 14 21 3', 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6'],
  left: ['m15 18-6-6 6-6'],
  right: ['m9 18 6-6-6-6'],
  first: ['m11 17-5-5 5-5', 'm18 17-5-5 5-5'],
  last: ['m13 17 5-5-5-5', 'm6 17 5-5-5-5'],
  down: ['m6 9 6 6 6-6'],
  plus: ['M5 12h14', 'M12 5v14'],
  image: [
    'M3 3h18a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z',
    'M8.5 11a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z',
    'm21 15-5-5L5 21',
  ],
  wallet: ['M19 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0 0 4h15a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5', 'M17.5 13a.5.5 0 1 0 0-1 .5.5 0 0 0 0 1Z'],
  plug: ['M12 22v-5', 'M9 7V2', 'M15 7V2', 'M6 13a6 6 0 0 0 12 0V7H6v6Z'],
  alert: ['M12 9v4', 'M10.3 3.9 2.2 18a2 2 0 0 0 1.7 3h16.2a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z', 'M12 17h.01'],
  ok: ['M22 11.1V12a10 10 0 1 1-5.9-9.1', 'M9 11l3 3L22 4'],
  fail: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z', 'm15 9-6 6', 'm9 9 6 6'],
  clock: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z', 'M12 6v6l4 2'],
  refresh: ['M3 12a9 9 0 0 1 15-6.7L21 8', 'M21 3v5h-5', 'M21 12a9 9 0 0 1-15 6.7L3 16', 'M3 21v-5h5'],
  layers: ['m12.8 2.5 8.1 4a1 1 0 0 1 0 1.8l-8.1 4a2 2 0 0 1-1.6 0l-8.1-4a1 1 0 0 1 0-1.8l8.1-4a2 2 0 0 1 1.6 0Z', 'm22 12.5-9.2 4.5a2 2 0 0 1-1.6 0L2 12.5'],
  cube: ['m21 8-9-5-9 5v8l9 5 9-5V8Z', 'm3 8 9 5 9-5', 'M12 13v9'],
  receipt: ['M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z', 'M8 8h8', 'M8 12h8', 'M8 16h5'],
  coins: ['M9 16a7 7 0 1 0 0-14 7 7 0 0 0 0 14Z', 'M15.5 8.5a7 7 0 1 1-9 9'],
  drop: ['M12 22a7 7 0 0 0 7-7c0-4-3.5-7.6-7-13-3.5 5.4-7 9-7 13a7 7 0 0 0 7 7Z'],
  gauge: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z', 'm14.5 9.5-3.5 3.5'],
  code: ['m16 18 6-6-6-6', 'm8 6-6 6 6 6'],
  book: ['M4 19.5A2.5 2.5 0 0 1 6.5 17H20', 'M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z'],
  bridge: ['M3 18v-6a9 9 0 0 1 18 0v6', 'M3 14h18', 'M8 14v6', 'M16 14v6'],
  server: ['M20 3H4a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1V4a1 1 0 0 0-1-1Z', 'M20 15H4a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-4a1 1 0 0 0-1-1Z', 'M6 6h.01', 'M6 18h.01'],
  menu: ['M4 6h16', 'M4 12h16', 'M4 18h16'],
  arrow: ['M5 12h14', 'm12 5 7 7-7 7'],
  info: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z', 'M12 16v-4', 'M12 8h.01'],
} as const

const paths = computed(() => PATHS[props.name] ?? [])
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    :stroke-width="stroke"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    class="shrink-0"
  >
    <path v-for="(d, i) in paths" :key="i" :d="d" />
  </svg>
</template>
