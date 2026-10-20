import {copyFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import {dirname, resolve} from 'node:path'
import {defineConfig, loadEnv} from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwind from '@tailwindcss/vite'

// GitHub Pages serves a project site from /<repo>/, and a user site or custom
// domain from /. BASE_PATH lets the same build serve either; the workflow sets
// it from the repository name.
const base = process.env.BASE_PATH ?? '/zvm-nft/'

/**
 * GitHub Pages has no SPA rewrite, so a deep link like /collection/0xabc… is a 404.
 * It does serve 404.html for any unmatched path, and a copy of index.html there
 * boots the app with the URL intact, so the router reads the real path and the
 * address bar never shows a redirect.
 */
function pagesFallback() {
  return {
    name: 'pages-404-fallback',
    closeBundle() {
      const dir = resolve(__dirname, 'dist')
      copyFileSync(resolve(dir, 'index.html'), resolve(dir, '404.html'))
    },
  }
}

// The shared half of the front ends lives in zvm-core, beside the Go packages
// every ZVM process shares, and is compiled from the zvm-core submodule at
// ./zvm-core, the same arrangement as the Go modules' `replace ./zvm-core`.
//
// vue and viem are peer dependencies of those sources, so they are pinned to
// this app's own copies, which guarantees one Vue instance rather than two.
const require = createRequire(import.meta.url)
const peer = (name: string) => dirname(require.resolve(`${name}/package.json`))

// The node and origins this page reads are never built in (see .env.example).
// A build without them would ship a page that talks to nothing, so it stops
// here and says what to set.
function requireEnv(env: Record<string, string>, names: string[]) {
  const missing = names.filter((n) => !env[n])
  if (missing.length) {
    throw new Error(`${missing.join(', ')} not set: copy .env.example to .env, or set them in the environment`)
  }
}

export default defineConfig(({mode}) => {
  requireEnv(loadEnv(mode, process.cwd(), 'VITE_'), ['VITE_ZVM_NODE'])
  return {
    base,
    resolve: {
      alias: {
        '@zvm/web': resolve(__dirname, 'zvm-core/web/src'),
        vue: peer('vue'),
        viem: peer('viem'),
      },
      dedupe: ['vue', 'viem'],
    },
    plugins: [vue(), tailwind(), pagesFallback()],
    build: {
      target: 'es2022',
      // Fonts inline as base64 past this, which bloats the CSS and delays first
      // paint; they are better as their own cacheable files.
      assetsInlineLimit: 4096,
    },
    server: {port: 47300},
  }
})
