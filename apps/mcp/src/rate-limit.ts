import type { RateLimitBinding } from './env'

export type Decision = {
  ok: boolean
  limit: number
  remaining: number
  retryAfter: number
}

export type RateLimitRule = {
  limit: number
  windowMs: number
}

/** Same buckets the Rust transport counted, documented on `@loora/rpc/rate-limit`. */
export const mcpRateLimits = {
  mcp: { limit: 240, windowMs: 60_000 },
  'mcp-address': { limit: 600, windowMs: 60_000 },
  'mcp-anonymous': { limit: 60, windowMs: 60_000 },
} as const satisfies Record<string, RateLimitRule>

const MEMORY_TRACKED_KEYS = 50_000

type MemoryEntry = { hits: number; expiresAt: number }

export type RateLimiterOptions = {
  bindings?: {
    mcp?: RateLimitBinding
    'mcp-address'?: RateLimitBinding
    'mcp-anonymous'?: RateLimitBinding
  }
  now?: () => number
}

export class RateLimiter {
  private readonly bindings: RateLimiterOptions['bindings']
  private readonly now: () => number
  private readonly memory = new Map<string, MemoryEntry>()

  constructor(options: RateLimiterOptions = {}) {
    this.bindings = options.bindings
    this.now = options.now ?? Date.now
  }

  async check(bucket: keyof typeof mcpRateLimits, identity: string) {
    const rule = mcpRateLimits[bucket]
    const binding = this.bindings?.[bucket]
    if (binding) {
      const { success } = await binding.limit({ key: identity })
      return {
        ok: success,
        limit: rule.limit,
        remaining: success ? rule.limit : 0,
        retryAfter: Math.max(1, Math.ceil(rule.windowMs / 1_000)),
      } satisfies Decision
    }
    const hits = this.countMemory(`ratelimit:${bucket}:${identity}`, rule.windowMs)
    return {
      ok: hits <= rule.limit,
      limit: rule.limit,
      remaining: Math.max(0, rule.limit - hits),
      retryAfter: Math.max(1, Math.ceil(rule.windowMs / 1_000)),
    } satisfies Decision
  }

  private countMemory(key: string, windowMs: number) {
    const now = this.now()
    const seen = this.memory.get(key)
    if (!seen || seen.expiresAt <= now) {
      if (this.memory.size >= MEMORY_TRACKED_KEYS) {
        for (const [id, entry] of this.memory) {
          if (entry.expiresAt <= now) this.memory.delete(id)
        }
        if (this.memory.size >= MEMORY_TRACKED_KEYS) {
          const oldest = this.memory.keys().next()
          if (!oldest.done) this.memory.delete(oldest.value)
        }
      }
      this.memory.set(key, { hits: 1, expiresAt: now + windowMs })
      return 1
    }
    seen.hits += 1
    return seen.hits
  }
}

export function callerIdentity(headers: Headers) {
  const connecting = headers.get('cf-connecting-ip')?.trim()
  if (connecting) return `ip:${connecting}`
  const forwarded = headers.get('x-forwarded-for')?.trim()
  if (forwarded && !forwarded.includes(',')) return `ip:${forwarded}`
  return 'ip:unknown'
}
