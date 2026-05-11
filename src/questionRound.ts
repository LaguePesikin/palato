/**
 * 网页版题目图：
 * - 默认本地：public/images/true-n.jpeg、false-n.jpeg
 * - 腾讯云 COS：配置 VITE_COS_BUCKET + VITE_COS_REGION，拼接
 *   https://{bucket}.cos.{region}.myqcloud.com/{难度目录}/true-n.{ext}
 * - 或自定义根 URL：VITE_IMAGE_CDN_BASE（不含难度目录，脚本会追加 easy|medium|hard|extreme）
 *
 * 远程扩展名默认 png（与 COS 资源一致），可用 VITE_GAME_IMAGE_EXT 覆盖。
 * hell 难度对应存储目录名 extreme（与 assets 目录一致）。
 *
 * 难度题量：easy 5 / medium 8 / hard、hell 各 10（hell 多 shuffle 一次）。
 */

export type Question = {
  answerIndex: number
  images: string[]
}

export type BuildResult =
  | { ok: true; questions: Question[] }
  | { ok: false; error: string }

export type GameDifficulty = 'easy' | 'medium' | 'hard' | 'hell'

export const GAME_CONFIG = {
  TRUE_IMAGE_MAX_INDEX: 10,
  FALSE_IMAGE_MAX_INDEX: 30,
}

const QUESTIONS_PER_ROUND: Record<GameDifficulty, number> = {
  easy: 5,
  medium: 8,
  hard: 10,
  hell: 10,
}

function shuffle<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
}

function sampleUnique(maxIndex: number, count: number): number[] | null {
  if (maxIndex < count) return null
  const pool = Array.from({ length: maxIndex }, (_, i) => i + 1)
  shuffle(pool)
  return pool.slice(0, count)
}

function sampleWithReplacement(maxIndex: number, count: number): number[] {
  const out: number[] = []
  for (let i = 0; i < count; i++) {
    out.push(Math.floor(Math.random() * maxIndex) + 1)
  }
  return out
}

function imageUrl(prefix: string, kind: 'true' | 'false', index: number, ext: string): string {
  return `${prefix}${kind}-${index}.${ext}`
}

/** hell 在 COS 上与文件夹 extreme 对应 */
function difficultyFolder(difficulty: GameDifficulty): string {
  if (difficulty === 'hell') {
    const folder = (import.meta.env.VITE_COS_HELL_FOLDER as string | undefined)?.trim()
    return folder || 'extreme'
  }
  return difficulty
}

function remoteStorageRoot(): string | null {
  const explicit = (import.meta.env.VITE_IMAGE_CDN_BASE as string | undefined)?.trim()
  if (explicit) {
    return explicit.replace(/\/+$/, '')
  }
  const bucket = (import.meta.env.VITE_COS_BUCKET as string | undefined)?.trim()
  const region = (import.meta.env.VITE_COS_REGION as string | undefined)?.trim()
  if (bucket && region) {
    return `https://${bucket}.cos.${region}.myqcloud.com`
  }
  return null
}

function imageExtension(remote: boolean): string {
  if (!remote) return 'jpeg'
  const raw = ((import.meta.env.VITE_GAME_IMAGE_EXT as string | undefined) || 'png').trim()
  return raw.replace(/^\./, '')
}

function imagesPrefix(difficulty: GameDifficulty): string {
  const remoteRoot = remoteStorageRoot()
  if (remoteRoot) {
    const dir = difficultyFolder(difficulty)
    return `${remoteRoot}/${dir}/`
  }
  const base = import.meta.env.BASE_URL || '/'
  return base.endsWith('/') ? `${base}images/` : `${base}/images/`
}

export function buildQuestionRound(
  config: typeof GAME_CONFIG = GAME_CONFIG,
  options?: { difficulty?: GameDifficulty }
): BuildResult {
  const difficulty: GameDifficulty = options?.difficulty ?? 'hard'
  const n = QUESTIONS_PER_ROUND[difficulty] ?? 10

  const remote = remoteStorageRoot() !== null
  const prefix = imagesPrefix(difficulty)
  const ext = imageExtension(remote)
  const trueMax = config.TRUE_IMAGE_MAX_INDEX
  const falseMax = config.FALSE_IMAGE_MAX_INDEX

  if (trueMax < n) {
    return { ok: false, error: 'TRUE_POOL_SMALL' }
  }
  if (falseMax < 1) {
    return { ok: false, error: 'FALSE_POOL_EMPTY' }
  }

  const trueSamples = sampleUnique(trueMax, n)
  if (!trueSamples) {
    return { ok: false, error: 'TRUE_POOL_SMALL' }
  }

  const needFalse = n * 3
  let falseSamples: number[]
  if (falseMax >= needFalse) {
    const f = sampleUnique(falseMax, needFalse)
    if (!f) return { ok: false, error: 'FALSE_POOL_SMALL' }
    falseSamples = f
  } else {
    falseSamples = sampleWithReplacement(falseMax, needFalse)
  }

  const questions: Question[] = []

  for (let q = 0; q < n; q++) {
    const truePath = imageUrl(prefix, 'true', trueSamples[q], ext)
    const falses = [
      imageUrl(prefix, 'false', falseSamples[q * 3], ext),
      imageUrl(prefix, 'false', falseSamples[q * 3 + 1], ext),
      imageUrl(prefix, 'false', falseSamples[q * 3 + 2], ext),
    ]

    type Slot = { kind: 't' | 'f'; src: string }
    const slots: Slot[] = [{ kind: 't', src: truePath }, ...falses.map((src) => ({ kind: 'f' as const, src }))]
    shuffle(slots)
    if (difficulty === 'hell') {
      shuffle(slots)
    }

    let answerIndex = -1
    const images = slots.map((s, idx) => {
      if (s.kind === 't') answerIndex = idx
      return s.src
    })

    questions.push({ answerIndex, images })
  }

  return { ok: true, questions }
}
