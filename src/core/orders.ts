// Signed orders (D28), from the page: what a listing or a bid is, how a wallet
// signs one or many, how the node is handed them, and the exchange calls that
// fill and cancel them.
//
// The hashing here is internal/orderbook's, which is ZVMExchange's; all three
// are pinned by the same vectors (`npm run verify:vectors`).

import {concat, encodeFunctionData, hashStruct, keccak256, parseAbi, type Address, type Hex} from 'viem'
import {api} from './api'
import {publicClient, walletClient} from './evm'
import {wallet} from './wallet'
import type {Call} from './uniswap'

export const SELL = 0
export const BUY = 1
export const KIND_SINGLE = 0
export const KIND_BULK = 1
export const KIND_ONCHAIN = 2

export interface Order {
  trader: Address
  side: number
  collection: Address
  tokenId: bigint
  anyToken: boolean
  amount: bigint
  paymentToken: Address
  price: bigint
  listingTime: bigint
  expirationTime: bigint
  nonce: bigint
  salt: bigint
}

export interface Input {
  order: Order
  kind: number
  signature: Hex
  proof: Hex[]
}

export const orderTypes = {
  Order: [
    {name: 'trader', type: 'address'},
    {name: 'side', type: 'uint8'},
    {name: 'collection', type: 'address'},
    {name: 'tokenId', type: 'uint256'},
    {name: 'anyToken', type: 'bool'},
    {name: 'amount', type: 'uint256'},
    {name: 'paymentToken', type: 'address'},
    {name: 'price', type: 'uint256'},
    {name: 'listingTime', type: 'uint64'},
    {name: 'expirationTime', type: 'uint64'},
    {name: 'nonce', type: 'uint256'},
    {name: 'salt', type: 'uint256'},
  ],
  OrderRoot: [{name: 'root', type: 'bytes32'}],
} as const

export const exchangeAbi = parseAbi([
  'struct Order { address trader; uint8 side; address collection; uint256 tokenId; bool anyToken; uint256 amount; address paymentToken; uint256 price; uint64 listingTime; uint64 expirationTime; uint256 nonce; uint256 salt; }',
  'struct Input { Order order; uint8 kind; bytes signature; bytes32[] proof; }',
  'function buy(Input sell) payable',
  'function buyMany(Input[] sells) payable returns (uint256)',
  'function acceptBid(Input bid, uint256 tokenId)',
  'function cancelOrders(Order[] orders)',
  'function approveOrders(Order[] orders)',
  'function incrementNonce()',
  'function nonces(address) view returns (uint256)',
  'function checkOrder(Input input) view returns (uint8 code, uint256 remaining)',
  'function feeBps() view returns (uint256)',
  'function credits(address) view returns (uint256)',
  'function withdrawCredits()',
])

export const wethAbi = parseAbi([
  'function deposit() payable',
  'function withdraw(uint256)',
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address, address) view returns (uint256)',
  'function approve(address, uint256) returns (bool)',
])

/** The exchange this node serves, and what bids are paid in. */
export function exchange(): {address: Address; wrappedZnn: Address | null} | null {
  const apps = wallet.info?.apps
  if (!apps?.exchange) return null
  return {address: apps.exchange as Address, wrappedZnn: (apps.wrappedZnn as Address) || null}
}

function domain() {
  const ex = exchange()
  if (!ex || !wallet.info) throw new Error('no exchange on this chain')
  return {name: 'ZVM Exchange', version: '1', chainId: wallet.info.l2.chainId, verifyingContract: ex.address}
}

/** The order's EIP-712 struct hash: its identity on the exchange and in the book. */
export function orderHash(o: Order): Hex {
  return hashStruct({data: o, primaryType: 'Order', types: orderTypes})
}

/** OpenZeppelin's commutative Keccak: sort, then hash. */
function hashPair(a: Hex, b: Hex): Hex {
  return BigInt(a) <= BigInt(b) ? keccak256(concat([a, b])) : keccak256(concat([b, a]))
}

/**
 * The Merkle tree a bulk signature covers, and every leaf's proof — built the
 * way internal/orderbook builds it, an odd node carried up unhashed.
 */
export function orderTree(leaves: Hex[]): {root: Hex; proofs: Hex[][]} {
  const proofs: Hex[][] = leaves.map(() => [])
  const pos = leaves.map((_, i) => i)
  let level = [...leaves]
  while (level.length > 1) {
    const next: Hex[] = []
    for (let i = 0; i < level.length; i += 2) next.push(i + 1 === level.length ? level[i] : hashPair(level[i], level[i + 1]))
    pos.forEach((p, leaf) => {
      const sibling = p ^ 1
      if (sibling < level.length) proofs[leaf].push(level[sibling])
      pos[leaf] = p >> 1
    })
    level = next
  }
  return {root: level[0], proofs}
}

export function processProof(leaf: Hex, proof: Hex[]): Hex {
  return proof.reduce((h, p) => hashPair(h, p), leaf)
}

function signer() {
  const from = wallet.evm.address as Address | null
  if (!from || !wallet.evm.provider || !wallet.info) throw new Error('connect a wallet first')
  return {from, client: walletClient(wallet.evm.provider, wallet.info.l2.chainId, from)}
}

/** The trader's nonce on the exchange: an order signed with any other is void. */
export async function traderNonce(trader: Address): Promise<bigint> {
  const ex = exchange()
  if (!ex) throw new Error('no exchange on this chain')
  return publicClient(wallet.info!.l2.chainId).readContract({address: ex.address, abi: exchangeAbi, functionName: 'nonces', args: [trader]})
}

function randomSalt(): bigint {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return BigInt(`0x${[...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')}`)
}

/** An order from this wallet, opening a few minutes ago so clock skew never makes it "not yet open". */
export async function newOrder(fields: Pick<Order, 'side' | 'collection' | 'tokenId' | 'price'> & Partial<Order>, days: number): Promise<Order> {
  const {from} = signer()
  const now = BigInt(Math.floor(Date.now() / 1000))
  return {
    trader: from,
    anyToken: false,
    amount: 1n,
    paymentToken: '0x0000000000000000000000000000000000000000',
    listingTime: now - 300n,
    expirationTime: now + BigInt(days) * 86_400n,
    nonce: await traderNonce(from),
    salt: randomSalt(),
    ...fields,
  }
}

/** Signs one order: one wallet prompt, no transaction. */
export async function signOrder(o: Order): Promise<Input> {
  const {from, client} = signer()
  const signature = await client.signTypedData({account: from, domain: domain(), types: orderTypes, primaryType: 'Order', message: o})
  return {order: o, kind: KIND_SINGLE, signature, proof: []}
}

/** Signs many orders with one prompt, over their Merkle root — Blur's bulk listing. */
export async function signOrders(orders: Order[]): Promise<Input[]> {
  if (orders.length === 1) return [await signOrder(orders[0])]
  const {from, client} = signer()
  const {root, proofs} = orderTree(orders.map(orderHash))
  const signature = await client.signTypedData({
    account: from,
    domain: domain(),
    types: orderTypes,
    primaryType: 'OrderRoot',
    message: {root},
  })
  return orders.map((order, i) => ({order, kind: KIND_BULK, signature, proof: proofs[i]}))
}

const toWire = (o: Order) => ({
  ...o,
  tokenId: o.tokenId.toString(),
  amount: o.amount.toString(),
  price: o.price.toString(),
  listingTime: Number(o.listingTime),
  expirationTime: Number(o.expirationTime),
  nonce: o.nonce.toString(),
  salt: o.salt.toString(),
})

export function fromWire(o: any): Order {
  return {
    trader: o.trader,
    side: Number(o.side),
    collection: o.collection,
    tokenId: BigInt(o.tokenId),
    anyToken: !!o.anyToken,
    amount: BigInt(o.amount),
    paymentToken: o.paymentToken,
    price: BigInt(o.price),
    listingTime: BigInt(o.listingTime),
    expirationTime: BigInt(o.expirationTime),
    nonce: BigInt(o.nonce),
    salt: BigInt(o.salt),
  }
}

/** Hands signed orders to the node's book; throws with the node's reason if any is refused. */
export async function submitOrders(inputs: Input[]): Promise<void> {
  const res = await api.submitOrders(inputs.map((i) => ({...i, order: toWire(i.order)})))
  const refused = res.results.find((r) => !r.ok)
  if (refused) throw new Error(`the node refused the order: ${refused.reason}`)
}

/** An order as the exchange wants it for a fill. */
export async function fetchInput(hash: string): Promise<Input> {
  const r = await api.order(hash)
  if (!r.fillable) throw new Error(`that order can no longer be filled: ${r.reason}`)
  return {order: fromWire(r.input.order), kind: r.input.kind, signature: (r.input.signature || '0x') as Hex, proof: r.input.proof ?? []}
}

/**
 * The fillable ones of a list, in order, skipping the rest.
 *
 * An off-chain book (D36) is eventually consistent by construction: a row is
 * written when the order is signed and cleared when the fill is *derived*, so
 * between those a listing someone else has just bought is still showing. One
 * order buys one item and may fail on its own, but a sweep that refuses the
 * whole basket because one item sold a moment ago would be unusable exactly
 * when the floor is moving.
 */
export async function fetchFillable(hashes: string[]): Promise<Input[]> {
  const settled = await Promise.allSettled(hashes.map((h) => fetchInput(h)))
  return settled.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []))
}

// --- exchange calls -------------------------------------------------------------

export function buyCall(ex: Address, input: Input, label: string): Call {
  const value = input.order.paymentToken === '0x0000000000000000000000000000000000000000' ? input.order.price : 0n
  return {to: ex, value, gas: 400_000n, label, data: encodeFunctionData({abi: exchangeAbi, functionName: 'buy', args: [input]})}
}

export function buyManyCall(ex: Address, inputs: Input[], total: bigint): Call {
  return {
    to: ex,
    value: total,
    gas: 300_000n * BigInt(inputs.length) + 80_000n,
    label: `Buy ${inputs.length} items`,
    data: encodeFunctionData({abi: exchangeAbi, functionName: 'buyMany', args: [inputs]}),
  }
}

export function acceptBidCall(ex: Address, input: Input, tokenId: bigint, label: string): Call {
  return {to: ex, value: 0n, gas: 400_000n, label, data: encodeFunctionData({abi: exchangeAbi, functionName: 'acceptBid', args: [input, tokenId]})}
}

export function cancelOrdersCall(ex: Address, orders: Order[], label = 'Cancel the order'): Call {
  return {to: ex, value: 0n, gas: 60_000n + 30_000n * BigInt(orders.length), label, data: encodeFunctionData({abi: exchangeAbi, functionName: 'cancelOrders', args: [orders]})}
}

export function incrementNonceCall(ex: Address): Call {
  return {to: ex, value: 0n, gas: 60_000n, label: 'Cancel every order you have signed', data: encodeFunctionData({abi: exchangeAbi, functionName: 'incrementNonce'})}
}

/**
 * What a bid needs before it can be signed: enough wrapped ZNN, and an
 * allowance for the exchange. Nothing is escrowed, so a bid is only as good as
 * these two — which the node checks before it shows the bid.
 */
export async function bidFunding(owner: Address, total: bigint): Promise<Call[]> {
  const ex = exchange()
  if (!ex?.wrappedZnn) throw new Error('this chain has no wrapped ZNN to bid in')
  const client = publicClient(wallet.info!.l2.chainId)
  const [held, allowed] = await Promise.all([
    client.readContract({address: ex.wrappedZnn, abi: wethAbi, functionName: 'balanceOf', args: [owner]}),
    client.readContract({address: ex.wrappedZnn, abi: wethAbi, functionName: 'allowance', args: [owner, ex.address]}),
  ])
  const calls: Call[] = []
  if (held < total) {
    calls.push({
      to: ex.wrappedZnn, value: total - held, gas: 60_000n, label: 'Wrap ZNN to bid with',
      data: encodeFunctionData({abi: wethAbi, functionName: 'deposit'}),
    })
  }
  if (allowed < total) {
    calls.push({
      to: ex.wrappedZnn, value: 0n, gas: 60_000n, label: 'Let the exchange spend it when a bid is taken',
      data: encodeFunctionData({abi: wethAbi, functionName: 'approve', args: [ex.address, total]}),
    })
  }
  return calls
}
