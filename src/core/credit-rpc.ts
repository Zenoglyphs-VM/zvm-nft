// Read-only credit/recovery RPC with explicit transport and aggregate limits.
// The endpoint stays in this closure; withdrawal records never store its URL.
export interface CreditRead {
  signal: AbortSignal
  bytes: number
}
export type CreditRpc = (method: string, params: unknown[], read: CreditRead) => Promise<unknown>

export const CREDIT_RESPONSE_BYTES = 256 * 1024
export const CREDIT_READ_BYTES = 2 * 1024 * 1024
const METHODS = new Set(['eth_chainId', 'eth_getBlockByNumber', 'eth_call',
  'eth_getTransactionCount', 'eth_getTransactionByHash', 'eth_getTransactionReceipt'])

export function creditRpc(url: string, transport: typeof fetch = fetch): CreditRpc {
  let sequence = 0
  return async (method, params, read) => {
    if (!METHODS.has(method) || read.signal.aborted) throw new Error('Credit read is unavailable.')
    const controller = new AbortController()
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
    const stop = () => {
      controller.abort()
      if (reader) void reader.cancel().catch(() => {})
    }
    read.signal.addEventListener('abort', stop, {once: true})
    const timer = setTimeout(stop, 8000)
    let finished = false
    try {
      const id = ++sequence
      const response = await transport(url, {method: 'POST', redirect: 'error',
        headers: {'content-type': 'application/json', accept: 'application/json'},
        body: JSON.stringify({jsonrpc: '2.0', id, method, params}), signal: controller.signal})
      if (response.body) reader = response.body.getReader()
      if (!response.ok || !reader) throw new Error('Could not read exchange credit.')
      const declared = response.headers.get('content-length')
      if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > CREDIT_RESPONSE_BYTES))
        throw new Error('Credit response exceeds the read limit.')
      const decoder = new TextDecoder('utf-8', {fatal: true})
      const parts: string[] = []
      let bytes = 0
      for (;;) {
        const chunk = await reader.read()
        if (chunk.done) {finished = true; break}
        bytes += chunk.value.byteLength
        read.bytes += chunk.value.byteLength
        if (bytes > CREDIT_RESPONSE_BYTES || read.bytes > CREDIT_READ_BYTES)
          throw new Error('Credit response exceeds the read limit.')
        parts.push(decoder.decode(chunk.value, {stream: true}))
      }
      parts.push(decoder.decode())
      if (controller.signal.aborted || read.signal.aborted) throw new Error('Credit read was interrupted.')
      const body = JSON.parse(parts.join(''))
      if (!body || Array.isArray(body) || body.jsonrpc !== '2.0' || body.id !== id ||
        Object.prototype.hasOwnProperty.call(body, 'error') || !Object.prototype.hasOwnProperty.call(body, 'result'))
        throw new Error('Credit RPC response is invalid.')
      return body.result
    } finally {
      clearTimeout(timer)
      read.signal.removeEventListener('abort', stop)
      controller.abort()
      // Abort owns the fetch lifetime; an uncooperative cancellation promise
      // must not hold a completed or refused read open indefinitely.
      if (reader && !finished) void reader.cancel().catch(() => {})
      reader?.releaseLock()
    }
  }
}
