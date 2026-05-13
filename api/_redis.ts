import { Redis } from '@upstash/redis'

const PREFIX = 'balatu:lb:v1'

export function getRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim()
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim()
  if (!url || !token) return null
  try {
    // 非法 URL（非 https、含错字符等）时 new Redis 会抛 UrlError；避免直接把 Serverless 打崩成 500
    // 关闭自动 pipeline：单请求 handler 里无收益，减少边缘运行时差异
    return new Redis({ url, token, enableAutoPipelining: false })
  } catch (e) {
    console.error('[balatu redis] init failed:', e)
    return null
  }
}

export function zkey(difficulty: string): string {
  return `${PREFIX}:z:${difficulty}`
}

export function metaKey(playerId: string): string {
  return `${PREFIX}:meta:${playerId}`
}
