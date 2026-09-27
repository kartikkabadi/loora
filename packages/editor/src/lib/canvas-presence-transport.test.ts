import { afterEach, beforeEach, describe, expect, vi, test } from 'vitest'
import { createCanvasDocument } from '@loora/canvas/model'
import { configureRuntime } from '@loora/platform'

vi.doMock('@loora/rpc/client', () => ({
  orpc: {
    canvas: {
      get: vi.fn(async () => ({ document: createCanvasDocument('Test', 'test'), revision: 0 })),
      apply: vi.fn(async () => ({ revision: 0, transactionIds: [] })),
    },
  },
}))

const { CanvasSyncController } = await import('./canvas-client')

interface FetchCall {
  url: string
  body: unknown
  credentials: RequestCredentials | undefined
}

/**
 * Presence rides the socket and nothing else. Before the socket exists, or
 * when there is no socket service at all, a cursor frame is dropped rather than
 * posted over HTTP.
 */
function stubFetch(ticket: (() => Promise<Response>) | null) {
  const calls: FetchCall[] = []
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = String(input)
    let body: unknown = null
    try {
      body = init?.body ? JSON.parse(String(init.body)) : null
    } catch {
      body = init?.body ?? null
    }
    calls.push({ url, body, credentials: init?.credentials })
    if (url.includes('/api/realtime-ticket')) {
      // No ticket source means "stay pending forever" for this test.
      return ticket ? ticket() : new Promise<Response>(() => {})
    }
    return new Response(null, { status: 204 })
  }) as typeof fetch
  return calls
}

const originalFetch = globalThis.fetch

async function openController() {
  const controller = await CanvasSyncController.open(
    { designId: 'design-1', draftId: null },
    createCanvasDocument('Test', 'test'),
    0,
  )
  // Let the presence heartbeat's first send and the ticket request settle.
  await new Promise((resolve) => setTimeout(resolve, 20))
  return controller
}

describe('presence transport', () => {
  beforeEach(() => {
    configureRuntime({ apiOrigin: 'https://api.loora.test' })
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    configureRuntime({ apiOrigin: '' })
  })

  test('posts nothing over HTTP while the socket is still being ticketed', async () => {
    const calls = stubFetch(null)

    const controller = await openController()
    controller.publishPresence({ cursor: { x: 12, y: 20 }, selection: ['hero'] })
    await new Promise((resolve) => setTimeout(resolve, 120))

    expect(
      calls.some(
        (call) =>
          call.url === 'https://api.loora.test/api/realtime-ticket' &&
          call.credentials === 'include',
      ),
    ).toBe(true)
    expect(calls.some((call) => call.url.includes('/api/canvas-presence'))).toBe(false)
    await controller.close()
  })

  test('posts nothing over HTTP and stops ticketing when realtime is not configured', async () => {
    const calls = stubFetch(
      async () => new Response(JSON.stringify({ configured: false }), { status: 503 }),
    )

    const controller = await openController()
    controller.publishPresence({ cursor: { x: 4, y: 8 }, selection: [] })
    await new Promise((resolve) => setTimeout(resolve, 120))

    const tickets = calls.filter((call) => call.url.includes('/api/realtime-ticket'))
    expect(tickets).toHaveLength(1)
    expect(calls.some((call) => call.url.includes('/api/canvas-presence'))).toBe(false)
    expect(calls.some((call) => call.url.includes('/api/canvas-events'))).toBe(false)
    await controller.close()
  })
})
