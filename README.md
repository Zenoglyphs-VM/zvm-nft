# zvm-nft

An NFT marketplace for the ZVM, the EVM that Zenon's Network of Momentum
orders. A static bundle with no backend: collections, items and orders are read
from a ZVM node's API, the one the build names or one set in the header or with
`?rpc=`.

```sh
git clone --recurse-submodules https://github.com/Zenoglyphs-VM/zvm-nft
npm install
cp .env.example .env
npm run dev        # http://localhost:47300/zvm-nft/
npm run build      # dist/
npm run typecheck
npm run test:orders # exact wire values and pinned Go order vectors
```

No node is built in. `VITE_ZVM_NODE` is a node's API base, the URL its `/api`
and `/rpc` hang off, not a bare JSON-RPC URL: ownership and the order book come
from the node's index. The build stops without it; `.env.example` has the public
devnet's. The server side is in
[zvm-node](https://github.com/Zenoglyphs-VM/zvm-node), and the shared code
(`@zvm/web`) is compiled from the
[zvm-core](https://github.com/Zenoglyphs-VM/zvm-core) submodule.

MIT licence. The full guide, with how it works and why:
[docs/GUIDE.md](docs/GUIDE.md).

Order protocol, frontend responsibilities and remaining integration gates:
[docs/ORDER_COMPATIBILITY.md](docs/ORDER_COMPATIBILITY.md).
