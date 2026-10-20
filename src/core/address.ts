// bech32, and the two spellings of a ZVM address. Shared with glyphswap through
// @zvm/web, because an address that decodes to different bytes in two apps
// sends money to two different places.

export * from '@zvm/web/address'
