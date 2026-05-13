import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getRedis, metaKey, zkey } from './_redis.js'

const DIFFS = new Set(['easy', 'medium', 'hard', 'hell'])

type Meta = {
  nickName: string
  finalScore: number
  correctCount: number
  totalCount: number
}

/** Upstash get 可能返回已解析的 object，也可能仍是 string */
function parseStoredMeta(raw: unknown): Partial<Meta> | null {
  if (raw == null) return null
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Partial<Meta>
  }
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as Partial<Meta>
    } catch {
      return null
    }
  }
  return null
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('content-type', 'application/json; charset=utf-8')

  if (req.method !== 'GET') {
    res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED' })
    return
  }

  const redis = getRedis()
  if (!redis) {
    res.status(503).json({
      ok: false,
      error: 'NOT_CONFIGURED',
      message:
        '未连接 Redis：请在 Vercel 配置 UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN（须为 https REST 地址），并确认无多余空格或错误字符。',
    })
    return
  }

  const difficulty = String(req.query.difficulty || 'hard')
  if (!DIFFS.has(difficulty)) {
    res.status(400).json({ ok: false, error: 'INVALID_DIFFICULTY' })
    return
  }

  const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || '50'), 10) || 50))

  const entries: {
    rank: number
    nickName: string
    finalScore: number
    correctCount: number
    totalCount: number
  }[] = []

  try {
    const zk = zkey(difficulty)
    /** withScores 时为 [member, score, …]；泛型须为数组类型，见 @upstash/redis ZRangeCommand */
    const flatRaw = await redis.zrange<(string | number)[]>(zk, 0, limit - 1, { rev: true, withScores: true })
    const flat = Array.isArray(flatRaw) ? flatRaw : []

    for (let i = 0; i < flat.length; i += 2) {
      const member = flat[i]
      const scoreStr = flat[i + 1]
      if (member == null || scoreStr == null) continue
      const raw = await redis.get(metaKey(String(member)))
      let nick = '玩家'
      let correctCount = 0
      let totalCount = 0
      const m = parseStoredMeta(raw)
      if (m) {
        if (typeof m.nickName === 'string') nick = m.nickName.slice(0, 32)
        if (typeof m.correctCount === 'number') correctCount = m.correctCount
        if (typeof m.totalCount === 'number') totalCount = m.totalCount
      }
      entries.push({
        rank: entries.length + 1,
        nickName: nick,
        finalScore: Number(scoreStr),
        correctCount,
        totalCount,
      })
    }
  } catch (e) {
    console.error('[balatu leaderboard]', e)
    res.status(500).json({
      ok: false,
      error: 'REDIS_QUERY_FAILED',
      message: '排行榜服务暂时不可用',
    })
    return
  }

  res.status(200).json({ ok: true, entries })
}
