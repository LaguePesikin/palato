import './style.css'
import { buildQuestionRound, type Question, type GameDifficulty } from './questionRound'
import { generateRandomNick } from './randomNick'
import { getOrCreatePlayerId } from './playerId'
import { submitScore, fetchLeaderboard } from './leaderboardApi'

type Phase = 'landing' | 'loading' | 'playing' | 'result'

type AnswerRecord = {
  images: string[]
  answerIndex: number
  selectedChoice: number
  isCorrect: boolean
}

type ResultPayload = {
  nickName: string
  correctCount: number
  totalCount: number
  elapsedSec: string
  /** 用于服务端校验得分 */
  elapsedMs: number
  /** 得分 = max(0, 答对数×100 − 总耗时秒) */
  finalScore: number
  wrongQuestions: AnswerRecord[]
}

/** 每题答对计 100 分，总分减去用时（秒，含小数）；不低于 0。 */
function computeFinalScore(correctCount: number, elapsedMs: number): number {
  const raw = correctCount * 100 - elapsedMs / 1000
  return Math.max(0, raw)
}

const app = document.querySelector<HTMLDivElement>('#app')!

const WECHAT_ID = 'TheKinginYellow09'
const FEISHU_QR_SRC = `${import.meta.env.BASE_URL}feishu-qrcode.png`
const FEISHU_WIKI_URL =
  'https://my.feishu.cn/wiki/MJjvwajV5idenGkixF5cZl5qnic?from=from_copylink'

function buildWebShareCopy(url: string): string {
  return `一款让你不再被AI骗到的小游戏！点击链接开玩：${url}`
}

const DIFF_LABEL: Record<GameDifficulty, string> = {
  easy: '简单',
  medium: '中等',
  hard: '困难',
  hell: '地狱',
}

const state: {
  phase: Phase
  nickName: string
  difficulty: GameDifficulty
  questions: Question[]
  currentIndex: number
  selectedChoice: number | null
  correctCount: number
  startTime: number
  previewSrc: string | null
  answerRecords: AnswerRecord[]
  resultPayload: ResultPayload | null
} = {
  phase: 'landing',
  nickName: '',
  difficulty: 'easy',
  questions: [],
  currentIndex: 0,
  selectedChoice: null,
  correctCount: 0,
  startTime: 0,
  previewSrc: null,
  answerRecords: [],
  resultPayload: null,
}

let gameDom: {
  progressEl: HTMLElement
  diffEl: HTMLElement | null
  imgs: HTMLImageElement[]
  frames: HTMLElement[]
  choices: HTMLButtonElement[]
  btnNext: HTMLButtonElement
} | null = null

let previewLayer: HTMLDivElement | null = null

function explain(err: string): string {
  if (err === 'CONFIG_CATALOG_NEED_REMOTE') {
    return '请配置腾讯云 COS：在 web/.env 中设置 VITE_COS_BUCKET 与 VITE_COS_REGION（或 VITE_IMAGE_CDN_BASE），否则无法按 UUID 索引加载题目图。'
  }
  if (err === 'TRUE_POOL_EMPTY') {
    return '未找到真图索引：请确认 web/src/catalog/true-images-index.json 已提交，且 COS 上 true_images 目录已上传。'
  }
  if (err === 'FALSE_POOL_EMPTY') {
    return '当前难度下没有假图：请确认 catalog 中 difficulty_from_detector 与 COS 子目录（easy/medium/hard/extreme）一致并已上传。'
  }
  if (err === 'TRUE_POOL_SMALL') {
    return '真图数量不足以完成本局题量（已按池子自动压缩题数后仍不足）。请增加 true_images 或调低难度期望题数。'
  }
  if (err === 'FALSE_POOL_SMALL') {
    return '假图数量不足：当前难度池子内 UUID 图不够抽满本局。请增加该难度 COS 图或调低期望题数。'
  }
  return '题目加载失败。'
}

function collectUniqueImageUrls(questions: Question[]): string[] {
  const set = new Set<string>()
  for (const q of questions) {
    for (const u of q.images) {
      set.add(u)
    }
  }
  return [...set]
}

function preloadImages(urls: string[], onProgress: (done: number, total: number) => void): Promise<void> {
  const total = urls.length
  if (total === 0) {
    onProgress(0, 0)
    return Promise.resolve()
  }

  let done = 0
  const bump = () => {
    done += 1
    onProgress(done, total)
  }

  return Promise.all(
    urls.map(
      (url) =>
        new Promise<void>((resolve) => {
          const im = new Image()
          im.decoding = 'async'
          const fin = () => {
            bump()
            resolve()
          }
          im.onload = fin
          im.onerror = fin
          im.src = url
        })
    )
  ).then(() => {})
}

function teardownGame() {
  gameDom = null
  removePreviewLayer()
}

function removePreviewLayer() {
  if (previewLayer) {
    previewLayer.remove()
    previewLayer = null
  }
  state.previewSrc = null
}

function ensurePreviewLayer(): HTMLDivElement {
  if (previewLayer) return previewLayer
  const el = document.createElement('div')
  el.className = 'preview-mask preview-hidden'
  el.id = 'game-preview-mask'
  el.innerHTML = `
    <div class="preview-stage" id="game-preview-stage">
      <img class="preview-img" id="game-preview-img" alt="" />
    </div>
    <div class="preview-tip">点击画面关闭</div>
  `
  const close = () => {
    el.classList.add('preview-hidden')
    state.previewSrc = null
  }
  el.addEventListener('click', close)
  el.querySelector('#game-preview-stage')!.addEventListener('click', (e) => {
    e.stopPropagation()
    close()
  })
  document.body.appendChild(el)
  previewLayer = el
  return el
}

function openPreview(src: string) {
  state.previewSrc = src
  const layer = ensurePreviewLayer()
  const img = layer.querySelector('#game-preview-img') as HTMLImageElement
  img.src = src
  layer.classList.remove('preview-hidden')
}

function render() {
  if (state.phase === 'landing') {
    teardownGame()
    renderLanding()
    return
  }
  if (state.phase === 'loading') {
    renderLoading()
    return
  }
  if (state.phase === 'result') {
    teardownGame()
    renderResultView()
    return
  }
  if (!gameDom) {
    mountPlayingUI()
  }
  updatePlayingUI()
}

function bindDailyChallengeModal() {
  const overlay = document.getElementById('daily-tip-overlay')
  if (!overlay) return
  const close = () => overlay.classList.add('hidden')
  document.getElementById('daily-tip-panel-inner')?.addEventListener('click', (e) => {
    e.stopPropagation()
  })
  overlay.addEventListener('click', close)
  document.getElementById('btn-daily-tip-close')?.addEventListener('click', close)
  document.getElementById('btn-daily-challenge')?.addEventListener('click', () => {
    overlay.classList.remove('hidden')
  })
}

function rankOverlayHtml(): string {
  return `
    <div class="daily-tip-overlay hidden" id="rank-tip-overlay">
      <div class="daily-tip-panel rank-tip-panel-wide" id="rank-tip-panel-inner">
        <p class="daily-tip-text rank-heading">排行榜 🏆</p>
        <p class="rank-tip-hint" id="rank-tip-hint"></p>
        <div class="rank-board-scroll" id="rank-board-list"></div>
        <button type="button" class="daily-tip-close" id="btn-rank-tip-close">关闭</button>
      </div>
    </div>
  `
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

let rankHandlersBound = false
function ensureRankBoardHandlers() {
  if (rankHandlersBound) return
  rankHandlersBound = true
  getOrCreatePlayerId()
  app.addEventListener('click', (e) => {
    const rankOverlay = document.getElementById('rank-tip-overlay')
    if (rankOverlay && !rankOverlay.classList.contains('hidden') && e.target === rankOverlay) {
      rankOverlay.classList.add('hidden')
      return
    }
    const t = e.target as HTMLElement
    if (t.closest('#btn-rank-tip-close')) {
      document.getElementById('rank-tip-overlay')?.classList.add('hidden')
      return
    }
    if (t.closest('#btn-rank-board')) {
      void openRankBoardModal()
    }
  })
}

async function openRankBoardModal() {
  const overlay = document.getElementById('rank-tip-overlay')
  const hint = document.getElementById('rank-tip-hint')
  const list = document.getElementById('rank-board-list')
  if (!overlay || !hint || !list) return

  const diffSelect = document.getElementById('difficulty-select') as HTMLSelectElement | null
  const difficulty = (diffSelect?.value || state.difficulty) as GameDifficulty

  overlay.classList.remove('hidden')
  hint.textContent = '加载中…'
  list.innerHTML = ''

  const res = await fetchLeaderboard(difficulty, 50)
  if (!res.ok) {
    hint.textContent =
      res.error === 'NOT_CONFIGURED'
        ? '排行榜尚未开通：部署时需配置 Upstash Redis 环境变量。'
        : res.message
    return
  }

  hint.textContent = `${DIFF_LABEL[difficulty]} · 展示前 ${res.entries.length} 名`

  if (res.entries.length === 0) {
    list.innerHTML = '<p class="rank-empty">暂无记录，完成一局即有机会上榜～</p>'
    return
  }

  list.innerHTML = res.entries
    .map(
      (row) => `
    <div class="rank-row">
      <span class="rank-row-num">${row.rank}</span>
      <span class="rank-row-nick">${escapeHtml(row.nickName)}</span>
      <span class="rank-row-score">${row.finalScore.toFixed(2)}</span>
    </div>`
    )
    .join('')
}

function bindContactModal() {
  const overlay = document.getElementById('contact-overlay')
  if (!overlay) return
  const close = () => overlay.classList.add('hidden')
  document.getElementById('contact-panel-inner')?.addEventListener('click', (e) => {
    e.stopPropagation()
  })
  overlay.addEventListener('click', () => {
    close()
  })
  document.getElementById('btn-contact-close')?.addEventListener('click', close)
  document.getElementById('btn-open-contact')?.addEventListener('click', () => {
    overlay.classList.remove('hidden')
  })
  document.getElementById('copy-wechat')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(WECHAT_ID)
      alert('已复制微信号')
    } catch {
      prompt('请手动复制微信号：', WECHAT_ID)
    }
  })
}

function footerLinksHtml(): string {
  return `
      <div class="footer-links">
        <blockquote class="footer-quote">
          在 AI 生成内容日渐泛滥的今日，保持怀疑、审慎的态度，<br />
          不仅是对著作权和创作本身的尊重，<br />
          同时也是坚守属于人类“自主思考”的阵地。
        </blockquote>
        <span class="footer-contact-lead">想知道图像生成模型的工作原理？</span>
        <a
          class="footer-link"
          id="link-tech"
          href="${FEISHU_WIKI_URL}"
          target="_blank"
          rel="noopener noreferrer"
        >点击这里</a>
        <div class="footer-contact-inline">
          <span class="footer-contact-lead">如果您有意见或建议，或想要了解更多好玩的开源项目，可以</span>
          <button type="button" class="footer-link footer-link-btn" id="btn-open-contact">联系作者</button>
          <span class="footer-contact-lead">，请备注来意</span>
        </div>
      </div>
  `
}

function contactOverlayHtml(): string {
  return `
    <div class="contact-overlay hidden" id="contact-overlay">
      <div class="contact-panel" id="contact-panel-inner">
        <div class="contact-title">联系作者</div>
        <button type="button" class="contact-row contact-row-btn" id="copy-wechat">
          <span class="contact-label">微信：</span>
          <span class="contact-value">${WECHAT_ID}</span>
          <span class="contact-tip">（点击复制）</span>
        </button>
        <div class="contact-row contact-feishu-block">
          <span class="contact-label">飞书：</span>
          <img class="contact-feishu-qr" src="${FEISHU_QR_SRC}" alt="飞书二维码" />
        </div>
        <button type="button" class="contact-close" id="btn-contact-close">关闭</button>
      </div>
    </div>
  `
}

/** 按得分比例给评语；全对时不再展示「错题」按钮（题量非 10 时也按比例对齐）。 */
function scoreComment(correct: number, total: number): { text: string; hideWrongBtn: boolean } {
  if (total <= 0) return { text: '', hideWrongBtn: false }
  if (correct === total) {
    return {
      text: '天哪😱！神中神！你是怎么做到全对的！',
      hideWrongBtn: true,
    }
  }
  const pct = correct / total
  if (pct >= 0.7) {
    return { text: '🐂🍺！AI已经几乎骗不到你了！', hideWrongBtn: false }
  }
  if (pct >= 0.4) {
    return { text: 'emmmm...貌似还得练...', hideWrongBtn: false }
  }
  return { text: '快告诉我你不是瞎蒙的！', hideWrongBtn: false }
}

function renderWrongListHtml(wrong: AnswerRecord[]): string {
  if (wrong.length === 0) {
    return '<p class="wrong-empty">本轮没有错题，真棒！</p>'
  }
  const labels = ['A', 'B', 'C', 'D']
  return wrong
    .map((w, idx) => {
      const thumbs = w.images
        .map(
          (src) =>
            `<img class="wrong-thumb" src="${src}" alt="" loading="lazy" width="80" height="80" role="button" tabindex="0" title="点击放大" />`
        )
        .join('')
      return `
        <div class="wrong-item">
          <div class="wrong-item-head">错题 ${idx + 1}</div>
          <p class="wrong-item-meta">你选择 <strong>${labels[w.selectedChoice]}</strong> · 正确为 <strong>${labels[w.answerIndex]}</strong></p>
          <div class="wrong-item-grid">${thumbs}</div>
        </div>`
    })
    .join('')
}

function renderLanding() {
  removePreviewLayer()
  app.innerHTML = `
    <div class="landing">
      <h1>扒拉图 🔍</h1>
      <p class="sub">AI 生图越来越真实了？😱</p>
      <p class="sub">通过这个简单测试，来看看你分辨 AI 图片的能力 👉</p>
      <label class="nick-label" for="nick-input">昵称</label>
      <div class="nick-input-wrap">
        <input
          id="nick-input"
          class="nick-field nick-field-grow"
          type="text"
          maxlength="20"
          placeholder="填写昵称"
        />
        <button type="button" class="dice-btn" id="btn-dice-nick" title="随机昵称">🎲</button>
      </div>
      <div class="rules">
        <p>每题四张照片，仅一张为真实拍摄，其余三张为 AI 生成的；</p>
        <p>你的目标是找出唯一真实的那张</p>
        <p>答题不限时；结束后按照正确率和耗时计分</p>
        <p>欢迎分享链接给朋友们一起玩</p>
        <p>（不同难度的题目，使用不同的生图模型和提示词配置）</p>
      </div>
      <button type="button" class="btn-daily-challenge" id="btn-daily-challenge">每日挑战 ⏳</button>
      <button type="button" class="btn-rank-board" id="btn-rank-board">排行榜 🏆</button>
      <div class="start-game-row">
        <label class="sr-only" for="difficulty-select">选择难度</label>
        <select id="difficulty-select" class="difficulty-select" aria-label="选择难度">
          <option value="easy" ${state.difficulty === 'easy' ? 'selected' : ''}>难度: 简单 😆</option>
          <option value="medium" ${state.difficulty === 'medium' ? 'selected' : ''}>难度: 中等 🤨</option>
          <option value="hard" ${state.difficulty === 'hard' ? 'selected' : ''}>难度: 困难 🤯</option>
          <option value="hell" ${state.difficulty === 'hell' ? 'selected' : ''}>难度: 地狱 😈</option>
        </select>
        <button type="button" class="btn-start-game" id="btn-start-game">开始游戏</button>
      </div>
      ${footerLinksHtml()}
    </div>
    ${contactOverlayHtml()}
    <div class="daily-tip-overlay hidden" id="daily-tip-overlay">
      <div class="daily-tip-panel" id="daily-tip-panel-inner">
        <p class="daily-tip-text">每日挑战暂未开放，请稍等一哈</p>
        <button type="button" class="daily-tip-close" id="btn-daily-tip-close">好的</button>
      </div>
    </div>
    ${rankOverlayHtml()}
  `

  const input = document.getElementById('nick-input') as HTMLInputElement
  input.value = state.nickName
  input.addEventListener('input', () => {
    state.nickName = input.value.trim()
  })

  document.getElementById('btn-dice-nick')!.onclick = () => {
    const nick = generateRandomNick(20)
    state.nickName = nick
    input.value = nick
  }

  const diffSelect = document.getElementById('difficulty-select') as HTMLSelectElement
  diffSelect.addEventListener('change', () => {
    state.difficulty = diffSelect.value as GameDifficulty
  })
  document.getElementById('btn-start-game')!.addEventListener('click', () => {
    startWithDifficulty(diffSelect.value as GameDifficulty)
  })

  bindContactModal()
  bindDailyChallengeModal()
}

function startWithDifficulty(difficulty: GameDifficulty) {
  const nick = (document.getElementById('nick-input') as HTMLInputElement)?.value?.trim() || state.nickName
  if (!nick) {
    alert('请先输入昵称')
    return
  }
  state.nickName = nick
  state.difficulty = difficulty
  const round = buildQuestionRound(undefined, { difficulty })
  if (!round.ok) {
    alert(explain(round.error))
    return
  }
  state.questions = round.questions
  state.currentIndex = 0
  state.selectedChoice = null
  state.correctCount = 0
  state.answerRecords = []
  state.previewSrc = null
  state.phase = 'loading'
  render()
}

function renderLoading() {
  const urls = collectUniqueImageUrls(state.questions)
  const total = urls.length
  app.innerHTML = `
    <div class="loading-screen">
      <div class="loading-screen-inner">
        <h2 class="loading-title">加载题目中，请稍候</h2>
        <div class="loading-bar-outer">
          <div class="loading-bar-inner" id="load-bar-inner" style="width: 0%"></div>
        </div>
      </div>
    </div>
  `

  const bar = () => document.getElementById('load-bar-inner')
  const cnt = () => document.getElementById('load-count')

  preloadImages(urls, (done, t) => {
    const b = bar()
    const c = cnt()
    if (!b) return
    const pct = t === 0 ? 100 : Math.min(100, Math.round((done / t) * 100))
    b.style.width = `${pct}%`
    if (c) c.textContent = `${done} / ${t}`
  })
    .then(() => {
      state.startTime = Date.now()
      state.phase = 'playing'
      gameDom = null
      mountPlayingUI()
      updatePlayingUI()
    })
    .catch(() => {
      alert('图片加载异常，请刷新重试')
      state.phase = 'landing'
      state.questions = []
      render()
    })
}

function currentQuestion(): Question {
  return state.questions[state.currentIndex]
}

function mountPlayingUI() {
  removePreviewLayer()
  const diffText = DIFF_LABEL[state.difficulty] || '困难'
  app.innerHTML = `
    <div class="game-root" id="game-root">
      <div class="game-top">
        <button type="button" class="btn-game-back" id="btn-game-home" aria-label="返回首页">⬅️</button>
        <div class="game-top-right">
          <span id="game-progress">第 1 / ${state.questions.length} 题</span>
          <span class="game-diff" id="game-diff-label">难度：${diffText}</span>
        </div>
      </div>
      <div class="game-title">哪张照片是真实拍摄的？</div>
      <div class="game-hint">点击图片可放大查看</div>
      <div class="grid">
        ${[0, 1, 2, 3]
          .map(
            (i) => `
        <div class="grid-cell">
          <div class="pic-frame" data-frame="${i}">
            <div class="pic-crop">
              <img class="pic" id="game-pic-${i}" alt="" data-preview-index="${i}" />
            </div>
          </div>
          <span class="pic-label">${['A', 'B', 'C', 'D'][i]}</span>
        </div>`
          )
          .join('')}
      </div>
      <div class="choices">
        ${[0, 1, 2, 3]
          .map(
            (i) => `
        <button type="button" class="choice-btn" data-choice="${i}">${['A', 'B', 'C', 'D'][i]}</button>`
          )
          .join('')}
      </div>
      <button type="button" class="next-btn" id="btn-next" disabled>下一题</button>
    </div>
  `

  const imgs = [0, 1, 2, 3].map((i) => document.getElementById(`game-pic-${i}`) as HTMLImageElement)
  const frames = [0, 1, 2, 3].map(
    (i) => document.querySelector(`[data-frame="${i}"]`) as HTMLElement
  )
  const choices = [...document.querySelectorAll('[data-choice]')] as HTMLButtonElement[]
  const btnNext = document.getElementById('btn-next') as HTMLButtonElement
  const progressEl = document.getElementById('game-progress') as HTMLElement
  const diffEl = document.getElementById('game-diff-label')

  gameDom = { progressEl, diffEl, imgs, frames, choices, btnNext }

  imgs.forEach((img) => {
    img.addEventListener('click', () => {
      const i = Number(img.dataset.previewIndex)
      openPreview(currentQuestion().images[i])
    })
  })

  choices.forEach((btn) => {
    btn.addEventListener('click', () => {
      state.selectedChoice = Number(btn.dataset.choice)
      updateSelectionOnly()
    })
  })

  btnNext.addEventListener('click', () => goNext())

  document.getElementById('btn-game-home')!.addEventListener('click', () => {
    if (!confirm('确定返回首页？本局进度将丢失')) return
    state.phase = 'landing'
    state.questions = []
    state.currentIndex = 0
    state.selectedChoice = null
    state.correctCount = 0
    state.previewSrc = null
    gameDom = null
    teardownGame()
    render()
  })
}

function updateSelectionOnly() {
  if (!gameDom) return
  const sel = state.selectedChoice
  gameDom.frames.forEach((fr, i) => {
    fr.classList.toggle('selected', sel === i)
  })
  gameDom.choices.forEach((btn, i) => {
    btn.classList.toggle('active', sel === i)
  })
  gameDom.btnNext.disabled = sel === null
}

function updatePlayingUI() {
  if (!gameDom) return
  const q = currentQuestion()
  const n = state.questions.length
  gameDom.progressEl.textContent = `第 ${state.currentIndex + 1} / ${n} 题`
  if (gameDom.diffEl) {
    gameDom.diffEl.textContent = `难度：${DIFF_LABEL[state.difficulty] || '困难'}`
  }

  gameDom.imgs.forEach((img, i) => {
    const nextSrc = q.images[i]
    if (img.getAttribute('src') !== nextSrc) {
      img.src = nextSrc
    }
  })

  updateSelectionOnly()
}

function goNext() {
  if (state.selectedChoice === null) return
  const question = currentQuestion()
  const choice = state.selectedChoice
  const isCorrect = choice === question.answerIndex
  if (isCorrect) {
    state.correctCount += 1
  }
  state.answerRecords.push({
    images: [...question.images],
    answerIndex: question.answerIndex,
    selectedChoice: choice,
    isCorrect,
  })

  const next = state.currentIndex + 1
  if (next >= state.questions.length) {
    finishChallenge()
    return
  }

  state.currentIndex = next
  state.selectedChoice = null
  updatePlayingUI()
}

function finishChallenge() {
  const elapsedMs = Date.now() - state.startTime
  const elapsedSec = (elapsedMs / 1000).toFixed(3)
  const total = state.questions.length
  const finalScore = computeFinalScore(state.correctCount, elapsedMs)

  state.resultPayload = {
    nickName: state.nickName || '玩家',
    correctCount: state.correctCount,
    totalCount: total,
    elapsedSec,
    elapsedMs,
    finalScore,
    wrongQuestions: state.answerRecords.filter((r) => !r.isCorrect),
  }
  state.phase = 'result'
  render()
  const payload = state.resultPayload
  if (payload) void submitRoundScoreAsync(payload)
}

async function submitRoundScoreAsync(data: ResultPayload) {
  const r = await submitScore({
    playerId: getOrCreatePlayerId(),
    nickName: data.nickName,
    difficulty: state.difficulty,
    finalScore: data.finalScore,
    correctCount: data.correctCount,
    totalCount: data.totalCount,
    elapsedMs: data.elapsedMs,
  })
  if (!r.ok && r.error !== 'NETWORK') {
    console.warn('submit score failed', r.error)
  }
}

function renderResultView() {
  const data = state.resultPayload!
  const wrongHtml = renderWrongListHtml(data.wrongQuestions)
  const comment = scoreComment(data.correctCount, data.totalCount)
  const wrongBtnHtml = comment.hideWrongBtn
    ? ''
    : `<button type="button" class="btn-result-secondary" id="btn-review-wrong">看看我错哪儿了？😦</button>`

  app.innerHTML = `
    <div class="result-page">
      <h2 class="result-title">最终成绩 🤔</h2>
      <p class="result-nick">${escapeHtml(data.nickName)}<span class="result-nick-label"></span></p>
      <p class="result-score">得分：<strong>${data.finalScore.toFixed(2)}</strong></p>
      <p class="result-line">正确率：<strong>${data.correctCount}/${data.totalCount}</strong></p>
      <p class="result-line">总耗时：<strong>${data.elapsedSec}</strong> 秒</p>
      ${
        comment.text
          ? `<p class="result-comment">${comment.text}</p>`
          : ''
      }
      <div class="result-actions">
        ${wrongBtnHtml}
        <button type="button" class="btn-result-secondary" id="btn-rank-board">排行榜 🏆</button>
        <button type="button" class="btn-result-secondary" id="btn-copy-site-url">复制链接，可分享给朋友玩~ 😎</button>
        <button type="button" class="btn-result-primary" id="btn-result-home">回到首页 👈</button>
      </div>
      ${footerLinksHtml()}
    </div>
    ${contactOverlayHtml()}
    ${rankOverlayHtml()}
    <div class="wrong-overlay hidden" id="wrong-overlay">
      <div class="wrong-panel" id="wrong-panel-inner">
        <div class="wrong-panel-title">错题回顾</div>
        <div class="wrong-scroll" id="wrong-list-root">${wrongHtml}</div>
        <button type="button" class="wrong-close" id="btn-wrong-close">关闭</button>
      </div>
    </div>
    <div class="wrong-zoom-overlay hidden" id="wrong-zoom-overlay" role="dialog" aria-modal="true" aria-label="图片放大">
      <button type="button" class="wrong-zoom-close" id="btn-wrong-zoom-close" aria-label="关闭放大">✕</button>
      <img class="wrong-zoom-img" id="wrong-zoom-img" src="" alt="放大预览" />
    </div>
  `

  const wrongOverlay = document.getElementById('wrong-overlay')!
  const wrongPanel = document.getElementById('wrong-panel-inner')!
  document.getElementById('btn-review-wrong')?.addEventListener('click', () => {
    wrongOverlay.classList.remove('hidden')
  })
  document.getElementById('btn-wrong-close')!.addEventListener('click', () => {
    wrongOverlay.classList.add('hidden')
  })
  wrongOverlay.addEventListener('click', (e) => {
    if (e.target === wrongOverlay) wrongOverlay.classList.add('hidden')
  })
  wrongPanel.addEventListener('click', (e) => {
    e.stopPropagation()
  })

  const wrongZoom = document.getElementById('wrong-zoom-overlay')
  const wrongZoomImg = document.getElementById('wrong-zoom-img') as HTMLImageElement | null
  const wrongListRoot = document.getElementById('wrong-list-root')

  const closeWrongZoom = () => {
    wrongZoom?.classList.add('hidden')
    if (wrongZoomImg) wrongZoomImg.src = ''
  }

  const openWrongZoom = (src: string) => {
    if (!wrongZoom || !wrongZoomImg || !src) return
    wrongZoomImg.src = src
    wrongZoom.classList.remove('hidden')
  }

  wrongListRoot?.addEventListener('click', (e) => {
    const el = e.target as HTMLElement
    if (el.tagName !== 'IMG' || !el.classList.contains('wrong-thumb')) return
    openWrongZoom((el as HTMLImageElement).currentSrc || (el as HTMLImageElement).src)
  })

  wrongListRoot?.addEventListener(
    'keydown',
    (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return
      const el = e.target as HTMLElement
      if (el.tagName !== 'IMG' || !el.classList.contains('wrong-thumb')) return
      e.preventDefault()
      openWrongZoom((el as HTMLImageElement).currentSrc || (el as HTMLImageElement).src)
    },
    true
  )

  wrongZoom?.addEventListener('click', (e) => {
    if (e.target === wrongZoom) closeWrongZoom()
  })
  document.getElementById('btn-wrong-zoom-close')?.addEventListener('click', (e) => {
    e.stopPropagation()
    closeWrongZoom()
  })
  wrongZoomImg?.addEventListener('click', () => {
    closeWrongZoom()
  })

  const onWrongZoomEscape = (ev: KeyboardEvent) => {
    if (ev.key !== 'Escape') return
    if (!wrongZoom || wrongZoom.classList.contains('hidden')) return
    closeWrongZoom()
  }
  document.addEventListener('keydown', onWrongZoomEscape)

  document.getElementById('btn-copy-site-url')!.addEventListener('click', async () => {
    const url = window.location.href
    const text = buildWebShareCopy(url)
    try {
      await navigator.clipboard.writeText(text)
      alert('已复制分享文案')
    } catch {
      prompt('请手动复制：', text)
    }
  })

  document.getElementById('btn-result-home')!.addEventListener('click', () => {
    document.removeEventListener('keydown', onWrongZoomEscape)
    state.phase = 'landing'
    state.questions = []
    state.resultPayload = null
    state.answerRecords = []
    state.nickName = ''
    render()
  })

  bindContactModal()
}

ensureRankBoardHandlers()
render()
