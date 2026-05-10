/**
 * 网页版题目图：默认 public/images/true-n.jpeg、false-n.jpeg
 * 可选环境变量 VITE_IMAGE_CDN_BASE（如 COS/CDN 根路径，以 / 结尾），便于国内加速、不把大图放 GitHub。
 *
 * 难度题量与小程序一致：easy 5 / medium 8 / hard、hell 各 10（hell 多 shuffle 一次）。
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

function imageUrl(prefix: string, kind: 'true' | 'false', index: number): string {
  return `${prefix}${kind}-${index}.jpeg`
}

function imagesPrefix(): string {
  const cdn = (import.meta.env.VITE_IMAGE_CDN_BASE as string | undefined)?.trim()
  if (cdn) {
    return cdn.endsWith('/') ? cdn : `${cdn}/`
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

  const prefix = imagesPrefix()
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
    const truePath = imageUrl(prefix, 'true', trueSamples[q])
    const falses = [
      imageUrl(prefix, 'false', falseSamples[q * 3]),
      imageUrl(prefix, 'false', falseSamples[q * 3 + 1]),
      imageUrl(prefix, 'false', falseSamples[q * 3 + 2]),
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
