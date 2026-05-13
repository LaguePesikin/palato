import { Redis } from '@upstash/redis'

const PREFIX = 'balatu:lb:v1'

export function getRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) return null
  return new Redis({ url, token })
}

export function zkey(difficulty: string): string {
  return `${PREFIX}:z:${difficulty}`
}

export function metaKey(playerId: string): string {
  return `${PREFIX}:meta:${playerId}`
}
