# Order compatibility and interface responsibilities

Both frontends use the same exchange protocol. A presentation change must not
change the order schema, EIP-712 domain, nonce meaning or bulk proof rules.

| Repository | Responsibility |
| --- | --- |
| `zvm-core` | Canonical Go order encoding, bulk tree and committed golden vectors. |
| `zvm-node` | Exchange contracts, order validation, indexing and the shared market API. |
| `zvm-nft` | Standalone collection, item, account, creation and basic market pages. |
| `zvm-karum` | The broader discovery interface, including search, activity, watchlists, offers and a shopping cart. |

The two UI repositories own their respective presentation and transaction
adapters. They share one protocol; neither UI defines a separate order format.
This contribution documents those source responsibilities. Maintainer agreement
on the long-term product/support boundary remains a separate roadmap gate.

## Exact integer transport

Decode unsigned order fields from bigint values, decimal strings or exact safe
JSON numbers. Reject negative, overflowing, fractional or already rounded
numbers. `side` must be the numeric sell/buy value and `anyToken` must be a
boolean. Do not coerce strings such as `"false"` into signed order fields.

The current Node API emits numeric `uint64` timestamps. Ordinary outbound
timestamps retain that format; values above JavaScript's safe integer limit
fail before API submission. Full-width decimal strings can be decoded exactly,
but full-width outbound timestamps require a coordinated API migration. The
client must never silently round the value covered by a signature.

An empty bulk batch has the Go zero root and requests no wallet signature.
Nonempty batches retain the sorted-pair Keccak tree and carry an odd node up
without hashing it again.

## Checks

After checking out submodules and installing the lockfile dependencies:

```sh
npm ci
npm run test:orders
npm run verify:vectors
npm run typecheck
npm run build
```

`test:orders` executes the actual TypeScript order module. Wire tests forbid
cryptographic, ABI, network and wallet capabilities. The separate vector tests
use the installed lockfile-selected `viem` for actual hashes, EIP-712 digests
and ABI encoding, comparing against `zvm-core/vectors/vectors.json` directly.
There is no duplicate vector fixture or runtime vector download. The NFT CI
also recomputes the shared pinned Core vectors with Go; both frontends currently
pin that same Core commit.

Wallet prompts and API/network operations in these tests are synthetic. An ABI
round trip does not execute a Solidity sale. Browser/provider integration,
Solidity comparison at the combined UI revisions, bulk settlement/refunds,
royalties, ERC-1271 authorization, cancellations and reorged ownership/approvals
across both interfaces remain required for complete marketplace qualification.

Retained contract-only tests and green UI builds do not close those interface
integration gates. No production, release or custody claim follows from them.
