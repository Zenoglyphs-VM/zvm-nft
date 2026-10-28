import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {stripTypeScriptTypes} from 'node:module'
import {createContext, SourceTextModule} from 'node:vm'

async function runtime() {
  const context = createContext({AbortController, setTimeout, clearTimeout, TextDecoder, console,
    fetch: () => {throw new Error('No undeclared transport')}})
  const program = new SourceTextModule(stripTypeScriptTypes(readFileSync(new URL('../src/core/credit-rpc.ts', import.meta.url), 'utf8'), {mode: 'strip'}), {context})
  await program.link(name => {throw new Error('Unexpected RPC dependency: ' + name)})
  await program.evaluate({timeout: 5000})
  return program.namespace
}
const scope = () => ({signal: new AbortController().signal, bytes: 0})
const reply = (request, result = null) => JSON.stringify({jsonrpc: '2.0', id: request.id, result})
function body(chunks, {hold = false, unjoinedCancel = false} = {}) {
  let cancelled = false, index = 0
  return {get cancelled() {return cancelled}, stream: new ReadableStream({
    pull(controller) {
      if (index < chunks.length) controller.enqueue(chunks[index++])
      else if (!hold) controller.close()
    },
    cancel() {cancelled = true; if (unjoinedCancel) return new Promise(() => {})},
  })}
}

test('bounded credit RPC preserves exact params and refuses redirects', async () => {
  const api = await runtime(), calls = []
  const rpc = api.creditRpc('https://node.example/rpc', async (url, options) => {
    const request = JSON.parse(options.body); calls.push({url, options, request})
    return new Response(reply(request, '0x' + '0'.repeat(64)), {headers: {'content-type': 'application/json'}})
  })
  const selected = {blockHash: '0x' + '1'.repeat(64), requireCanonical: true}
  assert.equal(await rpc('eth_call', [{to: '0x' + '2'.repeat(40), data: '0x12345678'}, selected], scope()), '0x' + '0'.repeat(64))
  assert.equal(calls.length, 1); assert.equal(calls[0].options.redirect, 'error')
  assert.deepEqual(calls[0].request.params[1], selected)
})
test('write methods are refused before any transport', async () => {
  const api = await runtime(); let calls = 0
  const rpc = api.creditRpc('https://node.example/rpc', async () => {calls++; throw new Error('Undeclared')})
  await assert.rejects(rpc('eth_sendTransaction', [], scope()), /unavailable/)
  assert.equal(calls, 0)
})
test('a declared oversize response is cancelled before consumption', async () => {
  const api = await runtime(), stream = body([new Uint8Array([1])], {hold: true})
  const rpc = api.creditRpc('https://node.example/rpc', async () => new Response(stream.stream,
    {headers: {'content-length': String(api.CREDIT_RESPONSE_BYTES + 1)}}))
  await assert.rejects(rpc('eth_chainId', [], scope()), /read limit/)
  assert.equal(stream.cancelled, true)
})
test('streamed bytes enforce the actual per-response cap', async () => {
  const api = await runtime(), stream = body([new Uint8Array(api.CREDIT_RESPONSE_BYTES), new Uint8Array(1)], {hold: true})
  const rpc = api.creditRpc('https://node.example/rpc', async () => new Response(stream.stream))
  await assert.rejects(rpc('eth_chainId', [], scope()), /read limit/)
  assert.equal(stream.cancelled, true)
})
test('multiple calls share the same aggregate read budget', async () => {
  const api = await runtime()
  const rpc = api.creditRpc('https://node.example/rpc', async (_, options) => new Response(reply(JSON.parse(options.body), '0x1')))
  const read = scope(); read.bytes = api.CREDIT_READ_BYTES - 1
  await assert.rejects(rpc('eth_chainId', [], read), /read limit/)
  assert.ok(read.bytes > api.CREDIT_READ_BYTES)
})
for (const [name, response] of [
  ['another request id', request => ({jsonrpc: '2.0', id: request.id + 1, result: '0x0'})],
  ['an RPC error beside a result', request => ({jsonrpc: '2.0', id: request.id, result: '0x0', error: {code: -1}})],
  ['an absent result', request => ({jsonrpc: '2.0', id: request.id})],
  ['another protocol version', request => ({jsonrpc: '1.0', id: request.id, result: '0x0'})],
]) {
  test(name + ' cannot become a successful credit read', async () => {
    const api = await runtime()
    const rpc = api.creditRpc('https://node.example/rpc', async (_, options) => new Response(JSON.stringify(response(JSON.parse(options.body)))))
    await assert.rejects(rpc('eth_chainId', [], scope()), /invalid/)
  })
}
test('an interrupted body read settles even when transport cancellation never resolves', async () => {
  const api = await runtime(), abort = new AbortController()
  const stream = body([new TextEncoder().encode('{')], {hold: true, unjoinedCancel: true})
  const rpc = api.creditRpc('https://node.example/rpc', async () => new Response(stream.stream))
  const reading = rpc('eth_chainId', [], {signal: abort.signal, bytes: 0})
  await new Promise(done => setImmediate(done)); abort.abort()
  await assert.rejects(reading, /interrupted/)
  assert.equal(stream.cancelled, true)
})
test('HTTP failures retain refusal and cancel the owned response', async () => {
  const api = await runtime(), stream = body([new Uint8Array([1])], {hold: true})
  const rpc = api.creditRpc('https://node.example/rpc', async () => new Response(stream.stream, {status: 503}))
  await assert.rejects(rpc('eth_chainId', [], scope()), /Could not read/)
  assert.equal(stream.cancelled, true)
})
test('invalid UTF-8 is rejected rather than repaired into JSON', async () => {
  const api = await runtime()
  const rpc = api.creditRpc('https://node.example/rpc', async () => new Response(new Uint8Array([0xc3, 0x28])))
  await assert.rejects(rpc('eth_chainId', [], scope()))
})
