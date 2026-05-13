import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getRedis, metaKey, zkey } from './_redis'

const DIFFS = new Set(['easy', 'medium', 'hard', 'hell'])
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function serverScore(correct: number, elapsedMs: number): number {
  return Math.max(0, correct * 100 - elapsedMs / 1000)
}

function clampNick(raw: unknown): string {
  const s = typeof raw === 'string' ? raw.trim().slice(0, 32) : '玩家'
  return s.replace(/[<>"']/g, '') || '玩家'
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('content-type', 'application/json; charset=utf-8')

  if (req.method !== 'POST') {
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

  const body = (typeof req.body === 'object' && req.body) || {}
  const playerId = body.playerId as string
  const difficulty = body.difficulty as string
  const nickName = clampNick(body.nickName)
  const finalScore = Number(body.finalScore)
  const correctCount = Number(body.correctCount)
  const totalCount = Number(body.totalCount)
  const elapsedMs = Number(body.elapsedMs)

  if (!playerId || !UUID_RE.test(playerId)) {
    res.status(400).json({ ok: false, error: 'INVALID_PLAYER_ID' })
    return
  }
  if (!difficulty || !DIFFS.has(difficulty)) {
    res.status(400).json({ ok: false, error: 'INVALID_DIFFICULTY' })
    return
  }
  if (
    !Number.isFinite(finalScore) ||
    !Number.isFinite(correctCount) ||
    !Number.isFinite(totalCount) ||
    !Number.isFinite(elapsedMs)
  ) {
    res.status(400).json({ ok: false, error: 'INVALID_NUMBERS' })
    return
  }
  if (correctCount < 0 || totalCount < 1 || correctCount > totalCount || totalCount > 30) {
    res.status(400).json({ ok: false, error: 'INVALID_COUNTS' })
    return
  }
  if (elapsedMs < 0 || elapsedMs > 3_600_000) {
    res.status(400).json({ ok: false, error: 'INVALID_TIME' })
    return
  }

  const expected = serverScore(correctCount, elapsedMs)
  if (Math.abs(finalScore - expected) > 0.08) {
    res.status(400).json({ ok: false, error: 'SCORE_MISMATCH' })
    return
  }

  const zk = zkey(difficulty)
  const mk = metaKey(playerId)

  const prevScoreRaw = await redis.zscore(zk, playerId)
  const prevScore = prevScoreRaw == null ? null : Number(prevScoreRaw)

  if (prevScore != null && finalScore <= prevScore) {
    res.status(200).json({ ok: true, updated: false, bestScore: prevScore })
    return
  }

  const meta = {
    nickName,
    finalScore,
    correctCount,
    totalCount,
    elapsedMs,
    difficulty,
    updatedAt: new Date().toISOString(),
  }

  await redis.set(mk, JSON.stringify(meta))
  await redis.zadd(zk, { score: finalScore, member: playerId })

  res.status(200).json({ ok: true, updated: true, bestScore: finalScore })
}
