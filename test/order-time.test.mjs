import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {stripTypeScriptTypes} from 'node:module'
import {createContext, SourceTextModule} from 'node:vm'

// Pure formatting only: no SDK, wallet, API, browser or network capability.
const source = process.env.ZVM_A08_TIME_SOURCE || new URL('../src/core/order-time.ts', import.meta.url)
const Clock = class extends Date {static now() {return 1700000000000}}
const program = new SourceTextModule(stripTypeScriptTypes(readFileSync(source, 'utf8'), {mode: 'strip'}),
  {context: createContext({Date: Clock})})
await program.link(() => {throw new Error('unexpected time formatter import')})
await program.evaluate({timeout: 5000})
const {orderDate, orderExpiry, orderCountdown} = program.namespace

test('order dates preserve ordinary safe numeric and string values', () => {
  assert.equal(orderDate(1700000000), orderDate('1700000000'))
  assert.equal(orderDate(0), orderDate(0n))
  assert.notEqual(orderDate(1700000000), 'Far future')
  assert.doesNotMatch(orderDate(0), /Invalid/)
})

test('order dates bound exact millisecond conversion before constructing Date', () => {
  assert.doesNotMatch(orderDate('8640000000000'), /Invalid|Far future/)
  for (const v of ['8640000000001', '9007199254740993', '9223372036854775808', '18446744073709551615']) {
    assert.equal(orderDate(v), 'Far future')
  }
})

test('order countdowns use exact full-width integer arithmetic', () => {
  assert.equal(orderCountdown('18446744073709551615'), '213503982314925d 8h')
  assert.equal(orderCountdown('1700000105'), '1m 45s')
  assert.equal(orderCountdown(1700003601n), '1h 0m')
  assert.equal(orderCountdown('0'), '0s')
})

test('order expiry compares exact seconds without a lossy date conversion', () => {
  assert.equal(orderExpiry('1699999999'), 'expired')
  assert.equal(orderExpiry('1700000000'), 'expired')
  assert.equal(orderExpiry('18446744073709551615'), 'Far future')
  assert.notEqual(orderExpiry('1700000001'), 'expired')
})

test('invalid or rounded order times cannot become a misleading date', () => {
  for (const value of [null, undefined, '', '-1', '1.5', '1e3', '18446744073709551616', 1.5, -1,
    JSON.parse('9007199254740993'), NaN, Infinity, true]) {
    assert.equal(orderDate(value), '-')
    assert.equal(orderExpiry(value), '-')
    assert.equal(orderCountdown(value), '')
  }
})
