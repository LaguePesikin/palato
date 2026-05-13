/** 匿名设备 ID：存 localStorage，用于排行榜去重 / 取个人最高分（弱身份） */
const STORAGE_KEY = 'balatu_anon_player_id'

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function getOrCreatePlayerId(): string {
  try {
    const existing = localStorage.getItem(STORAGE_KEY)
    if (existing && UUID_RE.test(existing)) return existing
    const id = crypto.randomUUID()
    localStorage.setItem(STORAGE_KEY, id)
    return id
  } catch {
    return crypto.randomUUID()
  }
}
