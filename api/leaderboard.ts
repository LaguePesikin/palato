import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getRedis, metaKey, zkey } from './_redis'

const DIFFS = new Set(['easy', 'medium', 'hard', 'hell'])

type Meta = {
  nickName: string
  finalScore: number
  correctCount: number
  totalCount: number
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
      message: '服务端未配置 UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN',
    })
    return
  }

  const difficulty = String(req.query.difficulty || 'hard')
  if (!DIFFS.has(difficulty)) {
    res.status(400).json({ ok: false, error: 'INVALID_DIFFICULTY' })
    return
  }

  const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || '50'), 10) || 50))

  const zk = zkey(difficulty)
  const flat = await redis.zrange<string>(zk, 0, limit - 1, { rev: true, withScores: true })

  const entries: {
    rank: number
    nickName: string
    finalScore: number
    correctCount: number
    totalCount: number
  }[] = []

  for (let i = 0; i < flat.length; i += 2) {
    const member = flat[i]
    const scoreStr = flat[i + 1]
    if (member == null || scoreStr == null) continue
    const raw = await redis.get<string>(metaKey(member))
    let nick = '玩家'
    let correctCount = 0
    let totalCount = 0
    if (raw) {
      try {
        const m = JSON.parse(raw) as Partial<Meta>
        if (typeof m.nickName === 'string') nick = m.nickName.slice(0, 32)
        if (typeof m.correctCount === 'number') correctCount = m.correctCount
        if (typeof m.totalCount === 'number') totalCount = m.totalCount
      } catch {
        /* ignore */
      }
    }
    entries.push({
      rank: entries.length + 1,
      nickName: nick,
      finalScore: Number(scoreStr),
      correctCount,
      totalCount,
    })
  }

  res.status(200).json({ ok: true, entries })
}
