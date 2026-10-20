# zvm-nft guide

A standalone NFT marketplace for the **ZVM**, the EVM that Zenon's Network of
Momentum orders. It is a static bundle with no backend of its own: every
collection, item and order on the page is read by your browser from a ZVM node
you choose.

Point it at a devnet on your laptop, a colleague's node, or a public one. The
endpoint is a control in the header and a `?rpc=` query parameter, so a link can
carry the node it was read from.

```sh
npm install
npm run dev        # http://localhost:47300/zvm-nft/
npm run build      # static files in dist/
npm run typecheck
```

## What it does

| Page | |
|---|---|
| `/` | Every collection the node knows, with volume, floor and what is listed now |
| `/collection/:addr` | One collection: its items, its activity, and a floor sweep |
| `/item/:addr/:id` | One item: owner, history, the orders on it, buy and list |
| `/account/:addr` | What an account holds, has listed, and has bid on |
| `/create` | Mint a collection and its items, including from a Zenon account |
| `/about` | Why listing is free here, and why the book lives on a node |

## Two things that are not like other marketplaces

**Listing costs nothing.** An order is an **EIP-712 signature**, as on OpenSea
and Blur — free, instant, and one signature over a Merkle root lists many items
at once. Only a fill is a transaction. Bids are paid in wrapped ZNN against an
*allowance*, so nothing is escrowed while an offer stands.

**The book is per-node, and eventually consistent.** A signature is not chain
state, so the chain cannot give it back: the node's index can be dropped and
rebuilt from the chain at any time, and its order book cannot. An order you see
may have been filled a moment ago, and a floor sweep has to tolerate that. Point
the page at a different node and you are looking at a different book — the items
are the same, the offers on them may not be.

There is also no mempool to be front-run out of: order on this chain is whatever
NoM committed before anyone here saw it.

## Talking to a node

Unlike [`zvm-glyphswap`](https://github.com/Zenoglyphs-VM/zvm-glyphswap), which reads Uniswap V2 straight off
the contracts, this page needs a node's API — the index answers "who owns this"
and the order book holds every unfilled signature, and neither is on the chain
in a form a browser can read. So the endpoint here is a node's API base (the
URL its `/api` and `/rpc` hang off), not a bare JSON-RPC URL, and a node
without `-apps` pointing at a deployment has an empty market to show. The
build's default is `VITE_ZVM_NODE`, which it stops without; no node is built
in.

Images and metadata resolve against **the node**, not against this page. Objects
are stored under the hash of their bytes, so a token URI of
`https://nft.example.org/<hash>.png` and the same object served by a node are the
same thing, and the page follows whichever the node says to load from.

## Shared code

The bech32 encoding, the number formatting, the viem chain definition and the
relayer's fee policy come from **@zvm/web**, in
[`zvm-core/web`](https://github.com/Zenoglyphs-VM/zvm-core/tree/main/web), so this app, the explorer and glyphswap
cannot drift on any of them. It is resolved from the zvm-core submodule through
a Vite alias and a tsconfig path — the same arrangement as the Go modules'
`replace ./zvm-core` — so clone this repo with `--recurse-submodules`.

The market's server side — the index, the order book, the media store and
`apps setup` — is in [`zvm-node`](https://github.com/Zenoglyphs-VM/zvm-node), and the Solidity behind it is in
`zvm-node/contracts/apps`.
