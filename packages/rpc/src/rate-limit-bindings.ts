/**
 * Where a Cloudflare Rate Limiting binding comes from. Outside a Worker there
 * are none, so every bucket counts in memory. The web app's Cloudflare build
 * aliases this module to `apps/web/src/server/rate-limit-bindings.mts`, which
 * reads the bindings declared in `apps/web/wrangler.jsonc`.
 */

export interface RateLimitBinding {
  limit(options: { key: string }): Promise<{ success: boolean }>
}

export function rateLimitBinding(_name: string): RateLimitBinding | null {
  return null
}
