// The NFT market's dollar prices.
//
// The store, the types and the arithmetic are @zvm/web's: the explorer and
// glyphswap read the same endpoint and print the same numbers, and an item
// worth $4.12 in one app and $0.00 in another is a bug a buyer has no way to
// diagnose. What is this app's is the endpoint it asks and the shape its pages
// already import.

import {prices as shared, format} from '@zvm/web'

import {base} from './endpoint'

const store = shared.createPrices(() => base())

export const prices = store.state
export const refreshPrices = () => store.refresh()
export const startPrices = (intervalMs = 30_000) => store.start(intervalMs)

export const znnUsd = () => store.znnUsd()
export const qsrUsd = () => store.qsrUsd()
export const pricesStale = () => store.stale()
export const usdOf = (token: string | null | undefined) => store.usdOf(token)
export const usdValue = (
  amount: bigint | string | number | null | undefined,
  decimals: number,
  token: string | null | undefined,
) => store.usdValue(amount, decimals, token)
export const usdSource = (token: string | null | undefined) => store.usdSource(token)

export const fmtUsd = format.usd
export const fmtChange = format.change
export const changeTone = format.changeTone

export type {PriceQuote, TokenPrice, PriceSnapshot} from '@zvm/web'
