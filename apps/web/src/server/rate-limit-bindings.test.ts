import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { rateLimitBuckets } from '@loora/rpc/rate-limit'

interface RateLimitConfig {
  name: string
  namespace_id: string
  simple: { limit: number; period: number }
}

const wrangler = JSON.parse(
  readFileSync(new URL('../../wrangler.jsonc', import.meta.url), 'utf8'),
) as { ratelimits?: RateLimitConfig[] }

describe('web rate limit bindings', () => {
  const declared = new Map(
    (wrangler.ratelimits ?? []).map((entry) => [entry.name, entry]),
  )

  it('declares every bucket with the limit and window the code expects', () => {
    for (const { binding, rule } of Object.values(rateLimitBuckets)) {
      expect(declared.get(binding)?.simple, binding).toEqual({
        limit: rule.limit,
        period: rule.windowMs / 1_000,
      })
    }
  })

  it('declares nothing the code does not count', () => {
    const used = new Set<string>(
      Object.values(rateLimitBuckets).map(({ binding }) => binding),
    )
    expect([...declared.keys()].filter((name) => !used.has(name))).toEqual([])
  })

  it('gives each binding its own namespace', () => {
    const ids = [...declared.values()].map((entry) => entry.namespace_id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
