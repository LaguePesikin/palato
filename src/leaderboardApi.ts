import type { GameDifficulty } from './questionRound'

function apiUrl(path: string): string {
  const base = (import.meta.env.VITE_LEADERBOARD_API_BASE as string | undefined)?.trim()
  if (base) return `${base.replace(/\/+$/, '')}${path.startsWith('/') ? path : `/${path}`}`
  return new URL(path, window.location.origin).toString()
}

export type SubmitScorePayload = {
  playerId: string
  nickName: string
  difficulty: GameDifficulty
  finalScore: number
  correctCount: number
  totalCount: number
  elapsedMs: number
}

export async function submitScore(payload: SubmitScorePayload): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(apiUrl('/api/submit-score'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string }
    if (!res.ok) {
      return { ok: false, error: data.error || `HTTP_${res.status}` }
    }
    return { ok: !!data.ok, error: data.error }
  } catch {
    return { ok: false, error: 'NETWORK' }
  }
}

export type LeaderboardRow = {
  rank: number
  nickName: string
  finalScore: number
  correctCount: number
  totalCount: number
}

export async function fetchLeaderboard(
  difficulty: GameDifficulty,
  limit = 50
): Promise<{ ok: true; entries: LeaderboardRow[] } | { ok: false; error: string; message: string }> {
  try {
    const q = new URLSearchParams({ difficulty, limit: String(limit) })
    const res = await fetch(`${apiUrl('/api/leaderboard')}?${q.toString()}`)
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean
      error?: string
      message?: string
      entries?: LeaderboardRow[]
    }
    if (!res.ok) {
      return {
        ok: false,
        error: data.error || `HTTP_${res.status}`,
        message: data.message || '排行榜暂不可用',
      }
    }
    if (!data.ok || !Array.isArray(data.entries)) {
      return {
        ok: false,
        error: data.error || 'BAD_RESPONSE',
        message: data.message || '排行榜暂不可用',
      }
    }
    return { ok: true, entries: data.entries }
  } catch {
    return { ok: false, error: 'NETWORK', message: '网络错误，无法加载排行榜' }
  }
}
