# Exact order-entry quotes

A listing or offer keeps the amount, currency, selected items, quantity and
expiry chosen for the original action. Approval, nonce reads and wallet prompts
must not turn a later form edit or account/node change into another order.

| Entry | Base units | Required payment token |
| --- | --- | --- |
| ZNN listing | 18 decimal places | Explicit native zero address |
| QSR listing | 8 decimal places | Configured nonzero reward token |
| ZNN offer | 18 decimal places | Configured wrapped-ZNN contract |

A missing QSR configuration is an error. It never selects the native token while
retaining QSR precision. Price parsing accepts exact decimal values and correctly
grouped thousands separators. Signs, exponents, malformed groups, unsupported
decimal places, zero and uint256 overflow are refused before approval or funding.
Collection counts must be positive safe whole numbers; aggregate funding cannot
overflow uint256. An individual offer funds one item even if a previous dialog
used a larger collection quantity.

Both order clients calculate duration in exact whole seconds. The one-hour
choice already offered by Karum remains 3600 seconds. Fractional or invalid
seconds are refused rather than rounded. The standalone NFT page retains its
existing days control. Caller-supplied order fields are copied before a nonce
read so a mutable object cannot replace the original fields during that wait.

The entry action captures its selected item identifiers, quote and connected
context before asynchronous preparation. Returned approval/funding calls retain
both the quote guard and any existing call guard. The owner, reported signing
account, provider, node endpoint, chain, exchange, selected currency contract and
active item selection are rechecked before signing and order submission. Closing
or changing the active selection requires another explicit action. Editing a
price, currency, count or duration while preparation is pending cannot replace
the original request or its progress label. A context refusal does not create
another signature or POST the result to another node.

Relisting uses the original base-unit price and original currency. The formatted
four/six-decimal price shown in a table is presentation only. For example, QSR
base units `125000001` reopen as `1.25000001`, with QSR still selected. Unknown or
missing original currency metadata requires a fresh supported-currency choice;
it cannot silently seed a native listing.

`test/order-quote.test.mjs` executes the production order-entry functions and
pure quote helpers with explicit synthetic approval, nonce, wallet and API
capabilities. It performs no SDK, browser, provider or settlement execution.
The normal frontend workflow separately runs the actual locked hashing/ABI
controls, Vue typecheck and production build. Actual page, relayer, Go and EVM
campaigns require their own exact-source records. Earlier financial campaigns
keep their original order-module and UI revisions; changing order-entry source
does not re-label an older execution as a new one.

These controls do not complete the original marketplace acceptance. Product
ownership, actual mixed-currency settlement, nonzero royalty and ERC-1271 browser
paths, generic wallet mappings, independent NoM/full-daemon evidence and the
remaining original roadmap gates still need separate qualification.
