import { env } from 'cloudflare:workers'
import type { RateLimitBinding } from '@loora/rpc/rate-limit-bindings'

export type { RateLimitBinding }

/** The `ratelimits` binding of that name, when this Worker declares one. */
export function rateLimitBinding(name: string): RateLimitBinding | null {
  const binding = (env as unknown as Record<string, unknown>)[name]
  return binding &&
    typeof (binding as Partial<RateLimitBinding>).limit === 'function'
    ? (binding as RateLimitBinding)
    : null
}
