import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const binding = vi.hoisted(() => ({
  current: null as null | {
    limit: (options: { key: string }) => Promise<{ success: boolean }>
  },
  names: [] as string[],
}))

vi.mock('@loora/rpc/rate-limit-bindings', () => ({
  rateLimitBinding: (name: string) => {
    binding.names.push(name)
    return binding.current
  },
}))

import {
  callerIdentity,
  clientAddress,
  rateLimit,
  rateLimitBuckets,
  rateLimitHeaders,
  rateLimits,
  resetRateLimitCounters,
  tooManyRequestsResponse,
  UNKNOWN_ADDRESS,
} from './rate-limit'

beforeEach(() => {
  binding.current = null
  binding.names = []
  resetRateLimitCounters()
})

afterEach(() => {
  vi.useRealTimers()
})

function identity(name: string) {
  return `${name}-${Math.random()}`
}

// `auth-credentials` is the tightest bucket, so these tests reach its limit in
// a handful of requests.
const tight = 'auth-credentials'
const tightLimit = rateLimitBuckets[tight].rule.limit

async function spend(bucket: typeof tight | 'github', who: string, times: number) {
  for (let index = 0; index < times; index += 1) {
    expect((await rateLimit(bucket, who)).ok).toBe(true)
  }
}

describe('rateLimit in memory', () => {
  it('serves a caller up to the limit and refuses the next request', async () => {
    const who = identity('caller')

    await spend(tight, who, tightLimit - 1)
    const last = await rateLimit(tight, who)
    expect(last.ok).toBe(true)
    expect(last.remaining).toBe(0)

    const refused = await rateLimit(tight, who)
    expect(refused.ok).toBe(false)
    expect(refused.remaining).toBe(0)
    expect(refused.retryAfterSeconds).toBe(60)
  })

  it('counts each caller on its own', async () => {
    const first = identity('first')
    const second = identity('second')

    await spend(tight, first, tightLimit)
    expect((await rateLimit(tight, first)).ok).toBe(false)
    expect((await rateLimit(tight, second)).ok).toBe(true)
  })

  it('keeps buckets apart so one endpoint cannot spend the budget of another', async () => {
    const who = identity('caller')

    await spend(tight, who, tightLimit)
    expect((await rateLimit(tight, who)).ok).toBe(false)
    expect((await rateLimit('github', who)).ok).toBe(true)
  })

  it('serves the caller again once the window has rolled', async () => {
    vi.useFakeTimers()
    const who = identity('caller')

    await spend(tight, who, tightLimit)
    expect((await rateLimit(tight, who)).ok).toBe(false)
    vi.advanceTimersByTime(rateLimitBuckets[tight].rule.windowMs + 1)
    expect((await rateLimit(tight, who)).ok).toBe(true)
  })
})

describe('rateLimit through a Cloudflare binding', () => {
  it('asks the bucket\'s own binding, keyed by the caller', async () => {
    const keys: string[] = []
    binding.current = {
      limit: async ({ key }) => {
        keys.push(key)
        return { success: keys.length === 1 }
      },
    }

    const served = await rateLimit('rpc', 'user:1')
    const refused = await rateLimit('rpc', 'user:1')

    expect(binding.names).toEqual(['RATE_LIMIT_RPC', 'RATE_LIMIT_RPC'])
    expect(keys).toEqual(['user:1', 'user:1'])
    expect(served).toMatchObject({ ok: true, limit: rateLimits.rpc.limit })
    expect(refused).toMatchObject({ ok: false, remaining: 0, retryAfterSeconds: 60 })
  })

  it('counts in memory when the binding throws, rather than failing the request', async () => {
    binding.current = {
      limit: async () => {
        throw new Error('binding unavailable')
      },
    }
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const who = identity('caller')

    await spend(tight, who, tightLimit)
    expect((await rateLimit(tight, who)).ok).toBe(false)
    error.mockRestore()
  })
})

describe('clientAddress', () => {
  it('counts the address Cloudflare stamped, not the forwarded chain', () => {
    const headers = new Headers({
      'cf-connecting-ip': '203.0.113.7',
      'x-forwarded-for': '198.51.100.4, 203.0.113.7',
    })
    expect(clientAddress(headers)).toBe('203.0.113.7')
  })

  it('refuses a forwarded chain a caller could have contributed to', () => {
    // The attack this closes: a caller who sends their own x-forwarded-for
    // stays at the front of the chain, and one who varies it gets a fresh
    // bucket per request.
    const forged = new Headers({
      'x-forwarded-for': '1.2.3.4, 203.0.113.7, 10.0.0.1',
    })
    expect(clientAddress(forged)).toBe(UNKNOWN_ADDRESS)
    expect(clientAddress(new Headers())).toBe(UNKNOWN_ADDRESS)
  })

  it('takes a single-entry forwarded header, which no client added to', () => {
    expect(
      clientAddress(new Headers({ 'x-forwarded-for': ' 203.0.113.7 ' })),
    ).toBe('203.0.113.7')
  })

  it('does not let a caller name themselves through cf-connecting-ip alone', () => {
    // Cloudflare overwrites this header, so a value that arrives with one is
    // Cloudflare's. Without Cloudflare there is no such header to trust — the
    // point of the test is that nothing *else* is trusted in its place.
    const headers = new Headers({ 'x-real-ip': '1.2.3.4' })
    expect(clientAddress(headers)).toBe(UNKNOWN_ADDRESS)
  })
})

describe('callerIdentity', () => {
  it('counts a signed-in caller as themselves, not as their address', () => {
    const headers = new Headers({ 'cf-connecting-ip': '203.0.113.7' })
    expect(callerIdentity(headers, 'user_1')).toBe('user:user_1')
    expect(callerIdentity(headers)).toBe('ip:203.0.113.7')
  })

  it('keeps two addresses in separate buckets', async () => {
    const first = new Headers({ 'cf-connecting-ip': '203.0.113.7' })
    const second = new Headers({ 'cf-connecting-ip': '198.51.100.4' })

    await spend(tight, callerIdentity(first), tightLimit)
    expect((await rateLimit(tight, callerIdentity(first))).ok).toBe(false)
    expect((await rateLimit(tight, callerIdentity(second))).ok).toBe(true)
  })
})

describe('tooManyRequestsResponse', () => {
  it('answers 429 with the headers a client needs to back off', async () => {
    const response = tooManyRequestsResponse({
      ok: false,
      limit: 30,
      remaining: 0,
      retryAfterSeconds: 60,
    })

    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('60')
    expect(response.headers.get('X-RateLimit-Limit')).toBe('30')
    expect(response.headers.get('X-RateLimit-Remaining')).toBe('0')
    expect(await response.text()).toContain('Too many requests')
  })

  it('reports the same numbers through the header helper', () => {
    expect(
      rateLimitHeaders({ ok: true, limit: 10, remaining: 4, retryAfterSeconds: 1 }),
    ).toEqual({
      'Retry-After': '1',
      'X-RateLimit-Limit': '10',
      'X-RateLimit-Remaining': '4',
    })
  })
})

describe('rateLimits', () => {
  it('leaves room for what the editor actually sends', () => {
    // One tab flushes a canvas batch about every 250ms. A limit under that
    // would trip during ordinary work.
    expect(rateLimits.rpc.limit).toBeGreaterThan(240)
    for (const rule of Object.values(rateLimits)) {
      expect(rule.limit).toBeGreaterThan(0)
      expect(rule.windowMs).toBeGreaterThan(0)
    }
  })
})

describe('rateLimitBuckets', () => {
  it('only uses windows a Cloudflare binding can count', () => {
    for (const { rule } of Object.values(rateLimitBuckets)) {
      expect([10_000, 60_000]).toContain(rule.windowMs)
    }
  })

  it('gives every bucket a binding of its own', () => {
    const names = Object.values(rateLimitBuckets).map(({ binding }) => binding)
    expect(new Set(names).size).toBe(names.length)
  })
})
