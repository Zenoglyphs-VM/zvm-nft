import test from 'node:test'
import assert from 'node:assert/strict'
import {existsSync, readFileSync} from 'node:fs'
import {stripTypeScriptTypes} from 'node:module'
import {createContext, SourceTextModule, SyntheticModule} from 'node:vm'

// Execute the shipped order-entry functions with explicit synthetic capabilities.
// No SDK, browser, provider, signature or settlement runs in these controls.
const nft = existsSync(new URL('../src/pages/NftItemPage.vue', import.meta.url))
const source = new URL(nft ? '../src/pages/NftItemPage.vue' : '../src/components/ListDialog.vue', import.meta.url)
const zero = '0x' + '0'.repeat(40), address = n => '0x' + String(n).repeat(40)
const owner = address(1), collectionAddress = address(2), exchangeAddressValue = address(3)
const parseUnits = (value, decimals) => {
  const [whole, fraction = ''] = value.split('.')
  if (!/^\d+$/.test(whole) || !/^\d*$/.test(fraction) || fraction.length > decimals) throw new Error('invalid synthetic amount')
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt((fraction || '0').padEnd(decimals, '0'))
}
function functionSource(text, name) {
  const start = text.indexOf('async function ' + name + '() {')
  assert.ok(start >= 0)
  const end = text.indexOf('\n}\n', start)
  assert.ok(end > start)
  return text.slice(start, end + 2)
}
async function quoteModule() {
  const program = new SourceTextModule(stripTypeScriptTypes(readFileSync(new URL('../src/core/order-quote.ts', import.meta.url), 'utf8'), {mode: 'strip'}),
    {context: createContext({console})})
  await program.link(() => {throw new Error('unexpected quote-helper import')})
  await program.evaluate({timeout: 5000})
  return program.namespace
}
async function listingFixture(surface = 'list') {
  const calls = {approvals: [], funding: [], orders: [], signs: [], posts: [], errors: []}
  const price = {value: '1.25'}, currency = {value: 'qsr'}, days = {value: 30}
  const info = {l2: {chainId: 7340470}, apps: {exchange: exchangeAddressValue, rewardToken: null, wrappedZnn: address(4)}}
  const provider = {}, wallet = {info, address: owner, chainId: 7340470, provider,
    evm: {address: owner, chainId: 7340470, provider}}
  const endpoint = {url: 'https://fixture.invalid', rpc: 'https://fixture.invalid/rpc', info, chainId: 7340470}
  const props = {open: true, collection: collectionAddress, tokenId: '7', name: 'Fixture',
    items: [{collection: collectionAddress, tokenId: '7', name: 'Fixture', collectionName: 'Fixture'}]}
  const quantity = {value: 2}, selected = {value: new Set([collectionAddress + ':7'])}
  const pageAddress = {value: surface === 'bulk' ? owner : collectionAddress}
  const collection = {value: collectionAddress}, tokenId = {value: '7'}
  const panel = {value: surface === 'offer' ? 'offer' : 'list'}, offering = {value: true}
  const qsr = {get value() {return info.apps.rewardToken}}
  const decimal = {get value() {return currency.value === 'qsr' ? 8 : 18}}
  const hooks = {}, busy = {value: false}
  const approvalFor = async (...args) => {calls.approvals.push(args); await hooks.approval?.(); return []}
  const market = {busy, error: {value: ''}, account: () => nft ? wallet.evm.address : wallet.address, approvalFor, run: async (build, options, nftSign) => {
    busy.value = true
    try {
      await build()
      if (nft) await nftSign.fn()
      else await options.sign.run()
      return true
    } catch (error) {calls.errors.push(error.message); return false}
    finally {busy.value = false}
  }}
  const quote = await quoteModule(), orders = await orderModule()
  const funding = async (...args) => {calls.funding.push(args); await hooks.approval?.(); return []}
  const context = createContext({console, price, currency, days, wallet, endpoint, props, qsr,
    currencyDecimals: decimal, decimals: decimal,
    currencyAddress: {get value() {return currency.value === 'qsr' && qsr.value ? qsr.value : zero}},
    amount: {get value() {return parseUnits(price.value, decimal.value)}},
    name: {value: 'Fixture'}, symbol: {get value() {return currency.value.toUpperCase()}},
    collection, tokenId, collectionInfo: {value: {name: 'Fixture'}},
    collections: {get value() {return props.items}}, panel, offering, address: pageAddress,
    bulkPrice: price, bulkDays: days, offerPrice: price, offerCount: quantity, quantity, selected,
    unlisted: {get value() {return props.items}}, key: item => item.collection + ':' + item.tokenId,
    wrapped: {get value() {return info.apps.wrappedZnn}},
    market, approvalFor, exchangeAddress: () => info.apps.exchange,
    exchange: () => ({address: info.apps.exchange, wrappedZnn: info.apps.wrappedZnn}),
    parseUnits, SELL: 0, BUY: 1, closePanel: () => {}, burst: () => {}, button: {value: null}, emit: () => {},
    bidFunding: funding, offerFunding: funding, load: async () => {}, offers: {value: []}, api: {nftOffers: async () => []},
    sameAddress: (a, b) => !!a && !!b && a.toLowerCase() === b.toLowerCase(),
    ...quote, orderDuration: orders.orderDuration,
    newOrder: async (fields, duration) => {const order = {...fields, duration}; calls.orders.push(order); await hooks.nonce?.(); return order},
    signOrder: async order => {calls.signs.push(order); await hooks.sign?.(); return {order}},
    signOrders: async orders => {calls.signs.push(...orders); await hooks.sign?.(); return orders.map(order => ({order}))},
    submitOrders: async inputs => {calls.posts.push(inputs)},
  })
  const path = surface === 'bulk' ? '../src/pages/NftAccountPage.vue' : surface === 'collection-offer' ? '../src/pages/NftCollectionPage.vue' :
    surface === 'offer' && !nft ? '../src/components/OfferDialog.vue' : null
  const method = surface === 'bulk' ? 'listSelected' : surface === 'collection-offer' ? 'submitOffer' : surface === 'offer' ? 'offer' : 'list'
  const text = functionSource(readFileSync(path ? new URL(path, import.meta.url) : source, 'utf8'), method)
  const program = new SourceTextModule(stripTypeScriptTypes(text + '\nexport {' + method + ' as execute}', {mode: 'strip'}), {context})
  await program.link(() => {throw new Error('unexpected listing-function import')})
  await program.evaluate({timeout: 5000})
  return {calls, list: program.namespace.execute, info, wallet, endpoint, price, currency, days, props, hooks,
    quantity, selected, pageAddress, collection, tokenId, panel, offering}
}
async function orderModule(options = {}) {
  const forbidden = () => {throw new Error('undeclared order-entry capability')}
  const info = {l2: {chainId: 7340470}, apps: {exchange: exchangeAddressValue}}
  const wallet = {info, address: owner, provider: {}, evm: {address: owner, provider: {}}}
  const endpoint = {info, chainId: 7340470}
  const evm = {publicClient: () => ({readContract: async () => {await options.nonce?.(); return 3n}}), walletClient: () => ({signTypedData: forbidden})}
  const modules = new Map([
    ['viem', {concat: forbidden, encodeFunctionData: forbidden, hashStruct: forbidden, keccak256: forbidden, parseAbi: value => value}],
    ['./api', {api: {}}], ['./evm', evm], ['@zvm/web/evm', evm], ['./wallet', {wallet}],
    ['./endpoint', {endpoint}], ['./format', {ZERO: zero}],
  ])
  const Clock = class extends Date {static now() {return 1700000000000}}
  const context = createContext({console, Date: Clock, crypto: {getRandomValues: bytes => bytes.fill(1)}})
  const text = stripTypeScriptTypes(readFileSync(new URL('../src/core/orders.ts', import.meta.url), 'utf8'), {mode: 'strip'})
  const program = new SourceTextModule(text, {context})
  await program.link(name => {
    assert.ok(modules.has(name), 'unexpected order-entry import: ' + name)
    const exports = modules.get(name)
    return new SyntheticModule(Object.keys(exports), function () {
      for (const [key, value] of Object.entries(exports)) this.setExport(key, value)
    }, {context})
  })
  await program.evaluate({timeout: 5000})
  return program.namespace
}

test('selected QSR without a configured token cannot become a native-price listing', async () => {
  const f = await listingFixture()
  await f.list()
  assert.equal(f.calls.signs.length, 0)
  assert.equal(f.calls.posts.length, 0)
  assert.equal(f.calls.approvals.length, 0)
})
test('the supported one-hour duration creates the same exact expiry in both order clients', async () => {
  const module = await orderModule()
  const order = await module.newOrder({side: 0, collection: collectionAddress, tokenId: 7n, price: 125000000n}, 1 / 24)
  assert.equal(order.expirationTime, 1700003600n)
  assert.equal(order.listingTime, 1699999700n)
  assert.equal(order.price, 125000000n)
})

for (const currency of ['znn', 'qsr']) {
  test('an exact ' + currency + ' listing keeps the quoted token, amount and duration', async () => {
    const f = await listingFixture(); f.currency.value = currency; f.info.apps.rewardToken = address(4)
    await f.list()
    assert.deepEqual(f.calls.errors, []); assert.equal(f.calls.signs.length, 1); assert.equal(f.calls.posts.length, 1)
    assert.equal(f.calls.orders[0].paymentToken, currency === 'qsr' ? address(4) : zero)
    assert.equal(f.calls.orders[0].price, currency === 'qsr' ? 125000000n : 1250000000000000000n)
    assert.equal(f.calls.orders[0].duration, 30)
  })
}
test('editing price, currency or duration during approval preserves the original request', async () => {
  const f = await listingFixture(); f.info.apps.rewardToken = address(4)
  f.hooks.approval = () => {f.price.value = '99'; f.currency.value = 'znn'; f.days.value = 1}
  await f.list()
  assert.deepEqual(f.calls.errors, []); assert.equal(f.calls.signs.length, 1)
  assert.equal(f.calls.orders[0].paymentToken, address(4)); assert.equal(f.calls.orders[0].price, 125000000n)
  assert.equal(f.calls.orders[0].duration, 30)
})
const changes = {
  account: f => {if (nft) f.wallet.evm.address = address(5); else f.wallet.address = address(5)},
  chain: f => {if (nft) f.info.l2.chainId++; else f.endpoint.chainId++},
  provider: f => {if (nft) f.wallet.evm.provider = {}; else f.wallet.provider = {}},
  endpoint: f => {if (nft) f.endpoint.url += '/changed'; else f.endpoint.rpc += '/changed'},
  exchange: f => {f.info.apps.exchange = address(5)},
  currency: f => {f.info.apps.rewardToken = address(5)},
  missingCurrency: f => {f.info.apps.rewardToken = null},
}
for (const [name, mutate] of Object.entries(changes)) {
  test('a ' + name + ' change during approval prevents a signature or order POST', async () => {
    const f = await listingFixture(); f.info.apps.rewardToken = address(4)
    f.hooks.approval = () => mutate(f); await f.list()
    assert.equal(f.calls.approvals.length, 1); assert.equal(f.calls.signs.length, 0); assert.equal(f.calls.posts.length, 0)
    assert.match(f.calls.errors[0], /changed|review/i)
  })
}
test('a context change during nonce preparation cannot reach the wallet', async () => {
  const f = await listingFixture(); f.info.apps.rewardToken = address(4)
  f.hooks.nonce = () => changes.account(f); await f.list()
  assert.equal(f.calls.orders.length, 1); assert.equal(f.calls.signs.length, 0); assert.equal(f.calls.posts.length, 0)
})
test('a context change during signing cannot publish or create another signature', async () => {
  const f = await listingFixture(); f.info.apps.rewardToken = address(4)
  f.hooks.sign = () => changes.endpoint(f); await f.list()
  assert.equal(f.calls.signs.length, 1); assert.equal(f.calls.posts.length, 0)
})
for (const input of ['0', '-1', '1e3', '1,2', '0.000000001']) {
  test('invalid or unrepresentable QSR price is refused before approval: ' + input, async () => {
    const f = await listingFixture(); f.info.apps.rewardToken = address(4); f.price.value = input; await f.list()
    assert.equal(f.calls.approvals.length, 0); assert.equal(f.calls.signs.length, 0); assert.equal(f.calls.posts.length, 0)
  })
}
for (const token of [zero, 'not-an-address', '0x123']) {
  test('invalid QSR configuration cannot become a native listing: ' + token, async () => {
    const f = await listingFixture(); f.info.apps.rewardToken = token; await f.list()
    assert.equal(f.calls.approvals.length, 0); assert.equal(f.calls.signs.length, 0); assert.equal(f.calls.posts.length, 0)
  })
}
for (const days of [0, -1, 1 / 1000000, NaN, Infinity, Number.MAX_SAFE_INTEGER]) {
  test('duration never rounds invalid seconds: ' + String(days), async () => {
    const module = await orderModule()
    assert.throws(() => module.orderDuration(days), /duration|seconds/i)
  })
}
test('exact durations preserve the existing day and hour choices', async () => {
  const module = await orderModule()
  for (const days of [1 / 24, 1, 3, 7, 30, 180, 365]) assert.equal(module.orderDuration(days), BigInt(days * 86400))
})
test('mutable caller fields cannot replace the original fields during a nonce read', async () => {
  const fields = {side: 0, collection: collectionAddress, tokenId: 7n, price: 125000000n}
  const module = await orderModule({nonce: () => {fields.price = 1n; fields.collection = address(5)}})
  const order = await module.newOrder(fields, 1)
  assert.equal(order.price, 125000000n); assert.equal(order.collection, collectionAddress)
})
test('base-unit conversion and relisting text preserve all uint256 precision', async () => {
  const q = await quoteModule(), max = (1n << 256n) - 1n
  for (const value of [1n, 125000001n, 250000000000000001n, max]) {
    for (const decimals of [8, 18]) assert.equal(q.quotedAmount(q.quoteAmountText(value, decimals), decimals), value)
  }
  assert.equal(q.quotedAmount('1,234.56780001', 8), 123456780001n)
  assert.equal(q.quoteAmountText(125000001n, 8), '1.25000001')
  assert.throws(() => q.quotedAmount(q.quoteAmountText(1n << 256n, 18), 18))
})
test('counts and totals refuse ambiguous numeric values and overflow', async () => {
  const q = await quoteModule()
  for (const value of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => q.quotedCount(value))
  assert.equal(q.quoteTotal(125000000n, q.quotedCount(2)), 250000000n)
  assert.throws(() => q.quoteTotal((1n << 256n) - 1n, 2n))
})
test('quote call guards preserve the original call guard and refuse stale dispatch', async () => {
  const q = await quoteModule(), events = []; let valid = true
  const [call] = q.guardedQuoteCalls([{guard: () => events.push('original'), data: '0x'}], () => {
    if (!valid) throw new Error('changed'); events.push('quote')
  })
  call.guard(); assert.deepEqual(events, ['quote', 'original'])
  valid = false; assert.throws(() => call.guard(), /changed/); assert.deepEqual(events, ['quote', 'original'])
})

test('relisting preserves the complete original QSR price and selected currency', async () => {
  const q = await quoteModule(), raw = '125000001'
  const seed = q.relistingQuote(raw, address(4), address(4))
  assert.equal(seed.currency, 'qsr'); assert.equal(seed.text, '1.25000001')
  assert.equal(q.listingQuote(seed.text, seed.currency, address(4)).amount.toString(), raw)
  assert.equal(q.relistingQuote('250000000000000001', zero, null).text, '0.250000000000000001')
  for (const token of [null, undefined, 'not-an-address', address(5)]) assert.throws(() => q.relistingQuote(raw, token, address(4)))
})
test('the listed collection or item cannot change while approval is pending', async () => {
  const f = await listingFixture(); f.info.apps.rewardToken = address(4)
  f.hooks.approval = () => {if (nft) f.tokenId.value = '8'; else f.props.items[0].tokenId = '8'}
  await f.list(); assert.equal(f.calls.signs.length, 0); assert.equal(f.calls.posts.length, 0)
})
test('closing the active order form prevents a late signature', async () => {
  const f = await listingFixture(); f.info.apps.rewardToken = address(4)
  f.hooks.approval = () => {if (nft) f.panel.value = 'none'; else f.props.open = false}
  await f.list(); assert.equal(f.calls.signs.length, 0); assert.equal(f.calls.posts.length, 0)
})
for (const surface of nft ? ['offer', 'collection-offer'] : ['offer']) {
  test(surface + ' freezes the amount, count, duration and wrapped token before funding', async () => {
    const f = await listingFixture(surface)
    if (!nft) f.props.tokenId = null
    f.hooks.approval = () => {f.price.value = '99'; f.quantity.value = 9; f.days.value = 1}
    await f.list()
    assert.deepEqual(f.calls.errors, []); assert.equal(f.calls.posts.length, 1); assert.equal(f.calls.funding.length, 1)
    const count = surface === 'collection-offer' || !nft ? 2n : 1n
    assert.equal(f.calls.funding[0][1], 1250000000000000000n * count)
    assert.equal(f.calls.orders[0].price, 1250000000000000000n); assert.equal(f.calls.orders[0].paymentToken, address(4))
    assert.equal(f.calls.orders[0].duration, 30)
    if (count > 1n) assert.equal(f.calls.orders[0].amount, 2n)
  })
  for (const stage of ['approval', 'nonce', 'sign']) {
    test(surface + ' fences an account change during ' + stage, async () => {
      const f = await listingFixture(surface); f.hooks[stage] = () => changes.account(f)
      await f.list(); assert.equal(f.calls.posts.length, 0)
      assert.equal(f.calls.signs.length, stage === 'sign' ? 1 : 0)
    })
  }
  test(surface + ' rejects a changed wrapped-token mapping after funding preparation', async () => {
    const f = await listingFixture(surface); f.hooks.approval = () => {f.info.apps.wrappedZnn = address(5)}
    await f.list(); assert.equal(f.calls.funding.length, 1); assert.equal(f.calls.signs.length, 0); assert.equal(f.calls.posts.length, 0)
  })
}
if (nft) {
  test('bulk listing snapshots every item and duration before collection approval', async () => {
    const f = await listingFixture('bulk')
    f.props.items.push({...f.props.items[0], tokenId: '8'}); f.selected.value.add(collectionAddress + ':8')
    f.hooks.approval = () => {f.price.value = '9'; f.days.value = 1}
    await f.list(); assert.deepEqual(f.calls.errors, []); assert.equal(f.calls.orders.length, 2); assert.equal(f.calls.posts.length, 1)
    for (const order of f.calls.orders) {assert.equal(order.price, 1250000000000000000n); assert.equal(order.duration, 30)}
    assert.equal(f.calls.orders[0].tokenId, 7n); assert.equal(f.calls.orders[1].tokenId, 8n)
  })
  test('changing the bulk selection cannot create a partial signature over a different set', async () => {
    const f = await listingFixture('bulk'); f.hooks.approval = () => f.selected.value.clear()
    await f.list(); assert.equal(f.calls.signs.length, 0); assert.equal(f.calls.posts.length, 0)
  })
  test('a bulk account-route change during nonce preparation cannot reach signing', async () => {
    const f = await listingFixture('bulk'); f.hooks.nonce = () => {f.pageAddress.value = address(5)}
    await f.list(); assert.equal(f.calls.orders.length, 1); assert.equal(f.calls.signs.length, 0); assert.equal(f.calls.posts.length, 0)
  })
} else {
  test('an item offer funds exactly one item even after a prior collection quantity', async () => {
    const f = await listingFixture('offer'); f.quantity.value = 9
    await f.list(); assert.deepEqual(f.calls.errors, []); assert.equal(f.calls.funding[0][1], 1250000000000000000n)
    assert.equal(f.calls.orders[0].amount, 1n)
  })
  test('fractional collection quantities are refused before wrapping or approval', async () => {
    const f = await listingFixture('offer'); f.props.tokenId = null; f.quantity.value = 1.5
    await f.list(); assert.equal(f.calls.funding.length, 0); assert.equal(f.calls.signs.length, 0); assert.equal(f.calls.posts.length, 0)
  })
}
