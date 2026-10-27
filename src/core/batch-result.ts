import {decodeEventLog, formatUnits, keccak256, parseAbi, stringToHex, type Address, type Hex, type TransactionReceipt} from 'viem'
import {orderHash, SELL, type Input} from './orders'

const filledAbi = parseAbi([
  'event OrderFilled(bytes32 indexed orderHash, address indexed maker, address indexed taker, uint8 side, address collection, uint256 tokenId, address paymentToken, uint256 price, uint256 royalty, uint256 fee)',
])
const filledTopic = keccak256(stringToHex('OrderFilled(bytes32,address,address,uint8,address,uint256,address,uint256,uint256,uint256)'))
const same = (a: string | null | undefined, b: string) => !!a && a.toLowerCase() === b.toLowerCase()
const native = (address: Address) => /^0x0{40}$/i.test(address)

export interface BatchResult {
  requested: number
  bought: number
  purchasedHashes: Hex[]
  skippedHashes: Hex[]
  unspentNative: bigint
}

/** The exchange may skip any input; a successful receipt alone is no fill count. */
export function batchResult(receipt: TransactionReceipt, exchange: Address, buyer: Address,
  inputs: readonly Input[], nativeSent: bigint): BatchResult {
  if (receipt.status !== 'success' || !same(receipt.to, exchange) || !same(receipt.from, buyer) || nativeSent < 0n) {
    throw new Error('The purchase receipt does not match this checkout.')
  }
  const expected = new Map(inputs.map(input => [orderHash(input.order).toLowerCase(), input]))
  if (!inputs.length || expected.size !== inputs.length || inputs.some(input => input.order.side !== SELL)) {
    throw new Error('The checkout contains duplicate or invalid listings.')
  }
  const purchased = new Set<string>()
  let nativeSpent = 0n
  for (const log of receipt.logs) {
    if (!same(log.address, exchange) || !same(log.topics[0], filledTopic)) continue
    if (log.removed) throw new Error('The purchase log is no longer canonical.')
    const {args} = decodeEventLog({abi: filledAbi, data: log.data, topics: log.topics, strict: true})
    const hash = args.orderHash.toLowerCase()
    const input = expected.get(hash)
    if (!input || purchased.has(hash) || args.side !== SELL || !same(args.taker, buyer) ||
        !same(args.maker, input.order.trader) || !same(args.collection, input.order.collection) ||
        args.tokenId !== input.order.tokenId || !same(args.paymentToken, input.order.paymentToken) ||
        args.price !== input.order.price || args.royalty + args.fee > args.price) {
      throw new Error('The purchase log does not match a selected listing.')
    }
    purchased.add(hash)
    if (native(input.order.paymentToken)) nativeSpent += args.price
  }
  if (nativeSpent > nativeSent) throw new Error('The receipt spent more ZNN than this checkout sent.')
  return {
    requested: inputs.length,
    bought: purchased.size,
    purchasedHashes: [...purchased] as Hex[],
    skippedHashes: [...expected.keys()].filter(hash => !purchased.has(hash)) as Hex[],
    unspentNative: nativeSent - nativeSpent,
  }
}

export function batchMessage(result: BatchResult): string {
  const count = result.bought === 0 ? 'No items were bought.' :
    `Bought ${result.bought} of ${result.requested} item${result.requested === 1 ? '' : 's'}.`
  return result.unspentNative === 0n ? count :
    `${count} ${formatUnits(result.unspentNative, 18)} ZNN unspent (returned or recorded as exchange credit).`
}
