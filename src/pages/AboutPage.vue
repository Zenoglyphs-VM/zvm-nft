<script setup lang="ts">
import Panel from '../components/Panel.vue'
</script>

<template>
  <div class="stack">
    <header class="page-head">
      <h1>How this market works</h1>
      <p class="lede">
        It is a marketplace for a chain whose order comes from somewhere else. Two things follow from that, and
        between them they explain everything that looks unusual here.
      </p>
    </header>

    <Panel title="Listing costs nothing">
      <p>
        A listing is an <strong>EIP-712 signature</strong>, not a transaction — the same shape OpenSea and Blur use.
        Signing is free and instant, and one signature over a Merkle root lists many items at once. Only a
        <em>fill</em> is a transaction.
      </p>
      <p>
        Bids are paid in wrapped ZNN against an <strong>allowance</strong>. Nothing is escrowed, so a standing offer
        costs you nothing while it stands, and it simply stops being fillable if you spend the balance elsewhere.
      </p>
      <p>
        An account with no EVM key still sells. It puts its order on chain with <code>approveOrders</code> —
        Seaport's <code>validate</code> — which is the path a Zenon account takes, with ERC-1271 as the other way in.
      </p>
    </Panel>

    <Panel title="Unfilled orders live on a node, not on the chain">
      <p>
        A signature is not chain state, so the chain cannot give it back. The node's index can be dropped and
        rebuilt from the chain at any time; its order book cannot. That means the book is <em>eventually
        consistent</em>: an order you see may have been filled a moment ago, and anything that sweeps a floor has to
        be ready for that.
      </p>
      <p>
        It also means the book is per-node. This page shows the orders the node you are pointed at was handed. Point
        it somewhere else and you are looking at a different book.
      </p>
    </Panel>

    <Panel title="The chain underneath">
      <p>
        The ZVM is a <strong>based rollup</strong>: Zenon's Network of Momentum orders every transaction, and one
        momentum derives exactly one EVM block. There is no sequencer to reorder a mint, and no mempool to front-run
        one out of — the order is whatever NoM committed before anyone here saw it.
      </p>
      <p>
        Collections are <strong>EIP-1167 clones</strong>, because deploying a full ERC-721 is blocked by plasma
        rather than gas: creating one from a Zenon account has to fit in what a single fusion buys.
      </p>
      <p>
        Images and metadata are stored under the hash of their bytes and served immutable. The bytes are the name,
        so nothing can be swapped out from under a token after it sells.
      </p>
    </Panel>

    <Panel title="This page has no backend">
      <p>
        It is a static bundle. Every number on it is read by your browser from the ZVM node you choose, in the
        header or through a <code>?rpc=</code> parameter, so a link can carry the node it was read from. Point it at
        a devnet on your laptop, a colleague's node, or a public one.
      </p>
    </Panel>
  </div>
</template>
