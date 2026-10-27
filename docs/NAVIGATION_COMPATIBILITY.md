# NFT navigation compatibility

The standalone application uses `/collection/:addr`, `/item/:addr/:id`,
`/account/:addr` and `/create`. Collection and item pages consume the router's
`addr` parameter, including when the same component remains mounted during a
route change. Token IDs remain strings.

Cards, account/activity rows, collection links and create/mint completion links
generate the standalone routes. Earlier `/nft`, `/nft/create`, `/nft/:addr` and
`/nft/:addr/:id` bookmarks remain Vue Router aliases of the same pages. The
configured deployment base path is applied by the router; API paths retain
their existing `/api/nft` names.

The actual Chrome/Go HTTP integration first reproduced an item request to
`/api/nft/items/undefined/1` on the previous source. The route repair is
qualified separately from order-vector, signature, Solidity and chain evidence.
Browser checks exercise the real pages, canonical collection/item navigation,
legacy bookmarks and the generated explore/create link. No wallet transaction
or media upload is required for navigation qualification.

Address links inside the marketplace open `/account/:addr`. The former
`/address/:addr` spelling remains an alias for shared bookmarks and wallet
explorer links. The account page's separate Explorer view opens the configured
node's `/address/:addr` page rather than an absent local explorer route.
The real-page regression checks owner/account navigation and the legacy alias
against the running Go market; it does not claim to render the external node
explorer.
