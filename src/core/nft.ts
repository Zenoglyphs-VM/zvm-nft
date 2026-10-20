// The collection factory and a collection, as calls this page can make. The
// exchange and its signed orders are in orders.ts (D28).

import {decodeEventLog, encodeFunctionData, parseAbi, type Address, type Hex} from 'viem'
import type {Call} from './uniswap'

export const factoryEventAbi = parseAbi([
  'event CollectionCreated(address indexed collection, address indexed creator, string name, string symbol)',
])

export const transferEventAbi = parseAbi(['event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)'])

type RawLog = {address: string; topics: readonly string[]; data: string}

/** The collection a create transaction made, read from the factory's own event. */
export function collectionFromLogs(logs: readonly RawLog[], factory: string): Address | null {
  for (const log of logs) {
    if (log.address.toLowerCase() !== factory.toLowerCase()) continue
    try {
      const decoded = decodeEventLog({abi: factoryEventAbi, data: log.data as Hex, topics: log.topics as [Hex, ...Hex[]]})
      if (decoded.eventName === 'CollectionCreated') return (decoded.args as {collection: Address}).collection
    } catch {
      // Another event from the same contract.
    }
  }
  return null
}

/** The token a mint created: the first Transfer out of nothing. */
export function mintedTokenId(logs: readonly RawLog[], collection: string): bigint | null {
  for (const log of logs) {
    if (log.address.toLowerCase() !== collection.toLowerCase()) continue
    try {
      const decoded = decodeEventLog({abi: transferEventAbi, data: log.data as Hex, topics: log.topics as [Hex, ...Hex[]]})
      const args = decoded.args as {from: Address; tokenId: bigint}
      if (/^0x0{40}$/i.test(args.from)) return args.tokenId
    } catch {
      // Not a Transfer.
    }
  }
  return null
}

export const collectionAbi = parseAbi([
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function owner() view returns (address)',
  'function totalSupply() view returns (uint256)',
  'function nextTokenId() view returns (uint256)',
  'function contractURI() view returns (string)',
  'function tokenURI(uint256 tokenId) view returns (string)',
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function royaltyInfo(uint256 tokenId, uint256 salePrice) view returns (address, uint256)',
  'function isApprovedForAll(address owner, address operator) view returns (bool)',
  'function setApprovalForAll(address operator, bool approved)',
  'function mint(address to, string uri) returns (uint256)',
  'function mintBatch(address to, string[] uris) returns (uint256)',
  'function drop() view returns (uint128 price, uint32 maxSupply, uint32 maxPerWallet, uint32 start, uint32 end)',
  'function publicMint(uint256 quantity) payable returns (uint256)',
  'function setDrop(uint128 price, uint32 maxSupply, uint32 maxPerWallet, uint32 start, uint32 end)',
])

export const factoryAbi = parseAbi([
  'function createCollection(string name, string symbol, string contractURI, string baseURI, uint96 royaltyBps) returns (address)',
  'function collectionsLength() view returns (uint256)',
  'function collections(uint256) view returns (address)',
])

/** ZNN itself, as a currency. */
export const NATIVE: Address = '0x0000000000000000000000000000000000000000'

export const expiryIn = (days: number) => BigInt(Math.floor(Date.now() / 1000) + days * 86400)

export function approveCollectionCall(collection: Address, market: Address, name = 'this collection'): Call {
  return {
    to: collection,
    value: 0n,
    gas: 70_000n,
    label: `Let the exchange move ${name}`,
    data: encodeFunctionData({abi: collectionAbi, functionName: 'setApprovalForAll', args: [market, true]}),
  }
}

export function createCollectionCall(factory: Address, name: string, symbol: string, contractURI: string, royaltyBps: number): Call {
  return {
    to: factory,
    value: 0n,
    // A clone plus its initialisation: what a native call's plasma can buy,
    // which is the whole reason collections are clones.
    gas: 900_000n,
    label: `Create ${name}`,
    data: encodeFunctionData({
      abi: factoryAbi,
      functionName: 'createCollection',
      args: [name, symbol, contractURI, '', BigInt(royaltyBps)],
    }),
  }
}

export function mintCall(collection: Address, to: Address, uri: string, label: string): Call {
  return {to: collection, value: 0n, gas: 260_000n, label, data: encodeFunctionData({abi: collectionAbi, functionName: 'mint', args: [to, uri]})}
}

export function publicMintCall(collection: Address, quantity: number, price: bigint, label: string): Call {
  return {
    to: collection,
    value: price * BigInt(quantity),
    gas: 120_000n + 90_000n * BigInt(quantity),
    label,
    data: encodeFunctionData({abi: collectionAbi, functionName: 'publicMint', args: [BigInt(quantity)]}),
  }
}

/** The metadata a mint writes, in the shape every marketplace reads. */
export function metadataDoc(name: string, description: string, image: string, traits: {trait_type: string; value: string}[]) {
  return {name, description, image, attributes: traits.filter((t) => t.trait_type && t.value)}
}

export interface TokenMeta {
  name?: string
  description?: string
  image?: string
  attributes?: {trait_type?: string; value?: unknown; display_type?: string}[]
}

export function parseMeta(raw: unknown): TokenMeta {
  if (!raw) return {}
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as TokenMeta
    } catch {
      return {}
    }
  }
  return raw as TokenMeta
}

export const isZero = (a: string | null | undefined) => !a || /^0x0{40}$/i.test(a)

/** A currency's symbol and decimals, for showing a price. */
export function currencyOf(address: string | null | undefined, qsr: string | null | undefined): {symbol: string; decimals: number; key: string} {
  if (isZero(address)) return {symbol: 'ZNN', decimals: 18, key: 'znn'}
  if (qsr && address && address.toLowerCase() === qsr.toLowerCase()) return {symbol: 'QSR', decimals: 8, key: qsr.toLowerCase()}
  return {symbol: 'token', decimals: 18, key: (address ?? '').toLowerCase()}
}

export type {Hex}
