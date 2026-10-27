# Exchange credit and withdrawal recovery

Account pages read native ZNN held by `ZVMExchange.credits(owner)` after a payout
or refund could not be delivered. The displayed amount is the actual uint256
returned at a canonical block hash. A failed or changing read is unavailable;
it is never converted to zero. `withdrawCredits()` sends all credit available
when it executes to the calling account. It accepts no alternate recipient or
fixed withdrawal amount.

Both interfaces expose the same read, withdrawal and recovery model. They use
the existing wallet transaction runner, estimate fees/gas normally and recheck
the selected account, provider, chain, node and exchange before dispatch. An
account or network change cannot publish an old response into the new view.
Once a wallet request has been dispatched, this client cannot revoke it.

## Exact recovery record

The browser saves the immutable account/chain/exchange, chain origin, prepared
head/nonce, zero value and exact calldata immediately before opening the wallet
request. It saves the wallet's original transaction hash before waiting for a
receipt. The node URL stays in a read closure; the journal stores only its
fingerprint. No private key, wallet secret or endpoint credential is stored.

A missing result/hash or receipt stops another withdrawal. Reload and a second
cooperating page retain that refusal. Pages use an exclusive Web Lock with
`ifAvailable`; unsupported coordination refuses withdrawal while still allowing
credit reads. Locks and browser storage coordinate only within the same origin,
not across different origins, devices or noncooperating applications.

Only a failure before dispatch or an explicit EIP-1193 `4001` wallet rejection
can remove that request's own never-submitted record. A rejection while waiting
for an already known hash never erases it. A post-submission storage failure
keeps the hash visible and exportable in memory and stops another request until
the recovery record can be saved. Downloads are local review material, not an
automatic import, authenticated chain proof or history-discard operation.

For a request that returned no hash, a supplied original hash must identify the
exact direct call: owner, exchange, calldata, zero value, chain and prepared
nonce bound. Recovery is read-only and never signs, replaces or resends. A
contract-wallet wrapper needs its accepted wallet-specific recovery mapping;
an unrelated outer transaction is not accepted as a direct-call substitute.

Wallet-reported execution hashes are associated with the original request by
the connected wallet. Their canonical receipts are checked, but a successful
outer receipt alone does not establish the result of every contract-wallet
inner call. The available credit is always read again. Remaining credit is not
silently cleared or described as a completed payout. Contract wallets must
support sending the call from the credited account through their provider;
generic Safe/user-operation mapping and physical-wallet acceptance remain open.

## Canonicality and resource limits

The model checks the RPC chain, genesis, block-hash-selected credit and nonce,
receipts and canonical block hashes, and rechecks the observation head. A
canonical replacement makes missing/orphaned receipts unresolved again;
restoration checks the same original hashes without another wallet request.
Verified receipts are reused only while their previously checked canonical
prefix remains selected. This avoids repeatedly scanning unchanged history.

Read-only transport allows six declared methods, rejects redirects, binds RPC
IDs, caps a response at 256 KiB and a complete read at 2 MiB, and bounds request
and complete-read lifetimes to 8 and 30 seconds. At most four history entries
are checked concurrently. Polls are serialized, run every 15 seconds only when
the page is visible, and stop on unmount. The journal accepts at most 32 records
and 64 KiB of ASCII serialized data. Full, malformed, changed or unavailable
history is retained and refuses another withdrawal; it is not trimmed by age.
These proposed bounds require maintainer acceptance for supported workloads.

The RPC, browser storage and cooperating wallet remain trust boundaries.
Consistency with one RPC is not independent NoM canonicality/finality,
authenticated deployment/epoch authority or protection against valid-looking
history rewritten by another script. Browser storage is continuity evidence,
not authentication. Independent node/reset, wallet, browser/platform, storage
policy and maintainer/owner acceptance remain required.

## Verification scope

Standard Node controls execute the actual model, bounded transport and wallet
runner with explicit synthetic capabilities. Separate locked-SDK cases execute
the real exchange ABI and credit calldata helpers. Typecheck and production
build do not establish a browser withdrawal, account-contract execution or
settlement. Actual page/provider/relayer and credited accepting/rejecting
receiver execution need their own source-bound integration evidence. Existing
contract-adapter financial campaigns and browser recovery profiles keep their
original source/module/run identities.

The original full A08 acceptance remains unchanged: supported product ownership,
Go/TS/Solidity order parity, bulk fills/refunds, royalties, ERC-1271,
cancellations and reorged ownership/approvals across both interfaces. Credit
controls alone do not complete that acceptance or establish production readiness.

References: [EIP-1193](https://eips.ethereum.org/EIPS/eip-1193),
[Web Locks](https://w3c.github.io/web-locks/).
