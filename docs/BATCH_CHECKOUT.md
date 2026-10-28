# Batch checkout results

`buyMany` may skip listings that become unavailable before execution. A
successful transaction receipt does not establish that every requested item was
bought. Both the count and the cart update use `OrderFilled` events emitted by
the selected exchange in the executed checkout receipt.

The receipt must belong to the captured buyer and exchange. Each counted event
must identify a unique selected sell order and agree with its maker, collection,
token, currency and exact price. Removed, malformed, duplicate or mismatched
fill logs stop reconciliation. A failed or unavailable receipt supplies no
successful checkout result. The transaction runner keeps successful receipts in
memory; it does not add receipt payloads to browser activity storage.

Only purchased hashes are removed from the cart. Skipped listings and entries
added while a checkout is pending remain available for review. A zero-fill
receipt reports that no items were bought. Native amounts use integer arithmetic
throughout. Unused ZNN can be returned directly or recorded as exchange credit
when the contract cannot deliver the native refund; the result does not promise
a direct transfer. ERC-20 prices do not reduce the reported unused native amount.

Account, chain, node and exchange changes stop prepared calls before wallet
submission. A context change after execution preserves the existing cart for
review. The standalone collection sweep also checks the selected collection.

Run `npm run test:orders`, `npm run typecheck` and `npm run build` with the locked
dependencies and Core submodule. The receipt tests execute the actual order and
receipt modules with the locked Viem hashing and event codec. They use synthetic
receipts and forbidden wallet/network capabilities, so they do not establish
browser/provider/relayer execution, native refunds, canonical recovery, production
readiness or the complete market acceptance matrix. Those require separate,
source-bound integration evidence.
