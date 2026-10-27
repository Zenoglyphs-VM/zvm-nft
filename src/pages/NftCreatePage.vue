<script setup lang="ts">
// Making something: a collection, or a token in one you own.
//
// The picture and the metadata are stored by the node under their own hash, and
// what goes on chain is that address. Storing anything asks the wallet for one
// signature — not a transaction, and nothing is spent — so that the node knows
// whose upload it is.
import {computed, onMounted, ref, watch} from 'vue'
import {useRouter} from 'vue-router'
import type {Address} from 'viem'
import {api} from '../core/api'
import {wallet} from '../core/wallet'
import {publicClient} from '../core/evm'
import {bytes} from '../core/format'
import {IMAGE_TYPES, maxImageBytes, uploadBytes, uploadJSON} from '../core/media'
import {collectionFromLogs, createCollectionCall, metadataDoc, mintCall, mintedTokenId} from '../core/nft'
import {factoryAddress, useMarket} from '../core/market'
import Panel from '../components/Panel.vue'
import StepList from '../components/StepList.vue'
import NftImage from '../components/NftImage.vue'

const router = useRouter()
const market = useMarket()
const tab = ref<'collection' | 'item'>('collection')

const name = ref('')
const symbol = ref('')
const description = ref('')
const royalty = ref(5)
const file = ref<File | null>(null)
const preview = ref('')
const uploading = ref('')

const collections = ref<any[]>([])
const target = ref('')
const traits = ref<{trait_type: string; value: string}[]>([{trait_type: '', value: ''}])

const factory = computed(() => factoryAddress())
const account = computed(() => market.account())
const canUpload = computed(() => !!wallet.info?.media?.uploads)

async function loadMine() {
  const owner = account.value
  if (!owner) {
    collections.value = []
    return
  }
  const profile = await api.nftAccount(owner).catch(() => null)
  collections.value = profile?.created ?? []
  if (!target.value && collections.value.length) target.value = collections.value[0].address
}
onMounted(loadMine)
watch(() => wallet.evm.address, loadMine)

function pick(event: Event) {
  const input = event.target as HTMLInputElement
  const chosen = input.files?.[0] ?? null
  market.error.value = ''
  if (chosen && chosen.size > maxImageBytes()) {
    market.error.value = `that image is ${bytes(chosen.size)}; this node stores up to ${bytes(maxImageBytes())}`
    input.value = ''
    return
  }
  file.value = chosen
  preview.value = chosen ? URL.createObjectURL(chosen) : ''
}

async function createCollection() {
  const to = factory.value
  const owner = account.value
  if (!to || !owner || !name.value || !symbol.value) return
  let contractURI = ''
  try {
    uploading.value = 'Storing the collection image…'
    const image = file.value ? await uploadBytes(file.value, file.value.type) : null
    uploading.value = 'Storing the collection metadata…'
    const doc = await uploadJSON({name: name.value, description: description.value, image: image?.url ?? ''})
    contractURI = doc.url
  } catch (err: any) {
    market.error.value = err?.message ?? String(err)
    return
  } finally {
    uploading.value = ''
  }
  const ok = await market.run(() => [createCollectionCall(to, name.value, symbol.value, contractURI, Math.round(royalty.value * 100))])
  if (!ok) return
  const hash = market.steps.value[market.steps.value.length - 1]?.txHash
  if (hash && wallet.info) {
    const receipt = await publicClient(wallet.info.l2.chainId).getTransactionReceipt({hash: hash as `0x${string}`})
    const created = collectionFromLogs(receipt.logs as any, to)
    if (created) {
      router.push(`/collection/${created}`)
      return
    }
  }
  await loadMine()
}

async function mint() {
  const owner = account.value
  const collection = target.value
  if (!owner || !collection || !name.value) return
  let uri = ''
  try {
    uploading.value = 'Storing the image…'
    const image = file.value ? await uploadBytes(file.value, file.value.type) : null
    uploading.value = 'Storing the metadata…'
    const doc = await uploadJSON(metadataDoc(name.value, description.value, image?.url ?? '', traits.value))
    uri = doc.url
  } catch (err: any) {
    market.error.value = err?.message ?? String(err)
    return
  } finally {
    uploading.value = ''
  }
  const ok = await market.run(() => [mintCall(collection as Address, owner, uri, `Mint ${name.value}`)])
  if (!ok) return
  const hash = market.steps.value[market.steps.value.length - 1]?.txHash
  if (hash && wallet.info) {
    const receipt = await publicClient(wallet.info.l2.chainId).getTransactionReceipt({hash: hash as `0x${string}`})
    const id = mintedTokenId(receipt.logs as any, collection)
    if (id !== null) router.push(`/item/${collection}/${id}`)
  }
}

const busyLabel = computed(() => uploading.value || (market.busy.value ? 'Working…' : ''))
</script>

<template>
  <div class="grid gap-4 max-w-[760px]">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 class="text-[17px] font-semibold tracking-tight">Create</h1>
        <p class="text-[13px] text-[var(--color-dim)]">
          A collection is a clone of one contract, so creating one costs about a third of a million gas rather than several million.
        </p>
      </div>
    </div>

    <div class="flex gap-1">
      <button class="btn" :class="tab === 'collection' ? 'bg-[var(--color-muted)] font-medium' : ''" @click="tab = 'collection'">Collection</button>
      <button class="btn" :class="tab === 'item' ? 'bg-[var(--color-muted)] font-medium' : ''" @click="tab = 'item'">Item</button>
    </div>

    <Panel v-if="!factory || !canUpload" title="Not available on this node">
      <div class="p-4 text-[13px] grid gap-2">
        <p v-if="!factory">This node serves no collection factory. Run <code class="mono">zvm apps setup</code>.</p>
        <p v-if="!canUpload">
          This node stores no media, so there is nowhere to put the picture. Start it with
          <code class="mono">-media-dir /data/media</code>.
        </p>
      </div>
    </Panel>

    <Panel v-else :title="tab === 'collection' ? 'New collection' : 'New item'">
      <div class="p-4 grid gap-4 sm:grid-cols-[minmax(0,1fr)_200px]">
        <div class="grid gap-3">
          <div v-if="tab === 'item'" class="grid gap-1">
            <label class="ledger" for="collection">Collection</label>
            <select id="collection" v-model="target" class="input">
              <option v-for="c in collections" :key="c.address" :value="c.address">{{ c.name || c.address }}</option>
            </select>
            <p v-if="!collections.length" class="text-[12.5px] text-[var(--color-dim)]">
              You have not created a collection yet — make one first.
            </p>
          </div>

          <div class="grid gap-1">
            <label class="ledger" for="name">Name</label>
            <input id="name" v-model="name" class="input" :placeholder="tab === 'collection' ? 'Zenon Momentums' : 'Momentum #13'" />
          </div>

          <div v-if="tab === 'collection'" class="grid gap-1">
            <label class="ledger" for="symbol">Symbol</label>
            <input id="symbol" v-model="symbol" class="input" placeholder="MOM" maxlength="12" />
          </div>

          <div class="grid gap-1">
            <label class="ledger" for="description">Description</label>
            <textarea id="description" v-model="description" class="input h-20 resize-y" placeholder="What is this?"></textarea>
          </div>

          <div v-if="tab === 'collection'" class="grid gap-1">
            <label class="ledger" for="royalty">Royalty, percent of each sale</label>
            <input id="royalty" v-model.number="royalty" type="number" min="0" max="10" step="0.5" class="input w-[120px]" />
            <p class="text-[12.5px] text-[var(--color-dim)]">
              Paid to you on every sale through this marketplace, capped at 10%. Another marketplace may read the same ERC-2981 answer and
              ignore it — that is true everywhere.
            </p>
          </div>

          <div v-if="tab === 'item'" class="grid gap-2">
            <span class="ledger">Traits</span>
            <div v-for="(t, i) in traits" :key="i" class="flex gap-2">
              <input v-model="t.trait_type" class="input flex-1" placeholder="Palette" :aria-label="`Trait ${i + 1} name`" />
              <input v-model="t.value" class="input flex-1" placeholder="Plasma" :aria-label="`Trait ${i + 1} value`" />
              <button class="btn px-2" @click="traits.splice(i, 1)" aria-label="Remove this trait">×</button>
            </div>
            <button class="btn w-fit px-2.5 py-1 text-[12.5px]" @click="traits.push({trait_type: '', value: ''})">Add a trait</button>
          </div>
        </div>

        <div class="grid gap-2 content-start">
          <span class="ledger">Picture</span>
          <div class="card overflow-hidden"><NftImage :src="preview" :rounded="false" /></div>
          <input type="file" :accept="IMAGE_TYPES" class="text-[12px]" aria-label="Choose a picture" @change="pick" />
          <p class="text-[12px] text-[var(--color-dim)]">
            Up to {{ bytes(maxImageBytes()) }}. It is stored under the hash of its bytes, so the same picture is the same object forever.
          </p>
        </div>
      </div>

      <div class="px-4 pb-4 grid gap-2">
        <button
          class="btn btn-plasma justify-center py-2.5"
          :disabled="market.busy.value || !!uploading || !account || !name || (tab === 'collection' ? !symbol : !target)"
          @click="tab === 'collection' ? createCollection() : mint()"
        >
          {{ busyLabel || (!account ? 'Connect a wallet' : tab === 'collection' ? 'Create the collection' : 'Mint it') }}
        </button>
        <p class="text-[12.5px] text-[var(--color-dim)]">
          Storing the picture asks your wallet to sign in to this node once (Sign-In with Ethereum). It is not a transaction: nothing is
          published and nothing is spent.
        </p>
        <p v-if="market.error.value" class="text-[13px] text-[var(--color-danger)] break-words">{{ market.error.value }}</p>
        <StepList :steps="market.steps.value" />
      </div>
    </Panel>
  </div>
</template>
