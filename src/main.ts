import './style.css'
import { buildQuestionRound, type Question, type GameDifficulty } from './questionRound'
import { generateRandomNick } from './randomNick'

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
  wrongQuestions: AnswerRecord[]
}

const app = document.querySelector<HTMLDivElement>('#app')!

const WECHAT_ID = 'TheKinginYellow09'
const FEISHU_QR_SRC = `${import.meta.env.BASE_URL}feishu-qrcode.png`
const FEISHU_WIKI_URL =
  'https://my.feishu.cn/wiki/MJjvwajV5idenGkixF5cZl5qnic?from=from_copylink'

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
  if (err === 'TRUE_POOL_SMALL') {
    return '图库数量不足当前难度：请增加对应难度的远端（COS）或本地 public/images 资源，或调高题库索引上限。'
  }
  if (err === 'FALSE_POOL_EMPTY') return '未找到 false 图。'
  if (err === 'FALSE_POOL_SMALL') return 'false 图数量不足。'
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
        <span class="footer-contact-lead">想知道图像生成模型的工作原理？</span>
        <a
          class="footer-link"
          id="link-tech"
          href="${FEISHU_WIKI_URL}"
          target="_blank"
          rel="noopener noreferrer"
        >点击这里</a>
        <div class="footer-contact-inline">
          <span class="footer-contact-lead">如果想要接触好玩的开源项目，可以</span>
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
            `<img class="wrong-thumb" src="${src}" alt="" loading="lazy" width="80" height="80" />`
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
      <p class="sub">通过这个简单测试，来看看你分辨 AI 生成图片的能力</p>
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
        <p>总共 <strong>10</strong> 题，每题四张照片，其中仅有一张是真实拍摄</p>
        <p>其余三张为 AI 生成的</p>
        <p>你的目标是找出唯一真实的那张</p>
        <p>答题不限时；结束后可生成正确率和耗时结果</p>
        <p>欢迎分享链接给朋友们一起玩</p>
        <p>（不同难度的题目，使用不同的生图模型和提示词配置）</p>
      </div>
      <button type="button" class="btn-daily-challenge" id="btn-daily-challenge">每日挑战 ⏳</button>
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

  state.resultPayload = {
    nickName: state.nickName || '玩家',
    correctCount: state.correctCount,
    totalCount: total,
    elapsedSec,
    wrongQuestions: state.answerRecords.filter((r) => !r.isCorrect),
  }
  state.phase = 'result'
  render()
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
      <p class="result-nick">${data.nickName}<span class="result-nick-label">（昵称）</span></p>
      <p class="result-line">正确率：<strong>${data.correctCount}/${data.totalCount}</strong></p>
      <p class="result-line">总耗时：<strong>${data.elapsedSec}</strong> 秒</p>
      ${
        comment.text
          ? `<p class="result-comment">${comment.text}</p>`
          : ''
      }
      <div class="result-actions">
        ${wrongBtnHtml}
        <button type="button" class="btn-result-secondary" id="btn-copy-site-url">复制链接，可分享给朋友玩~ 😎</button>
        <button type="button" class="btn-result-primary" id="btn-result-home">回到首页 👈</button>
      </div>
      ${footerLinksHtml()}
    </div>
    ${contactOverlayHtml()}
    <div class="wrong-overlay hidden" id="wrong-overlay">
      <div class="wrong-panel" id="wrong-panel-inner">
        <div class="wrong-panel-title">错题回顾</div>
        <div class="wrong-scroll" id="wrong-list-root">${wrongHtml}</div>
        <button type="button" class="wrong-close" id="btn-wrong-close">关闭</button>
      </div>
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

  document.getElementById('btn-copy-site-url')!.addEventListener('click', async () => {
    const url = window.location.href
    try {
      await navigator.clipboard.writeText(url)
      alert('已复制当前网页链接')
    } catch {
      prompt('请手动复制链接：', url)
    }
  })

  document.getElementById('btn-result-home')!.addEventListener('click', () => {
    state.phase = 'landing'
    state.questions = []
    state.resultPayload = null
    state.answerRecords = []
    state.nickName = ''
    render()
  })

  bindContactModal()
}

render()
