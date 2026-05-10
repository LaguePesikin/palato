import './style.css'
import { buildQuestionRound, type Question, type GameDifficulty } from './questionRound'
import { drawPoster, type PosterPayload } from './poster'
import { generateRandomNick } from './randomNick'

type Phase = 'landing' | 'tech' | 'loading' | 'playing' | 'poster'

const app = document.querySelector<HTMLDivElement>('#app')!

const POSTER_W = 375
const POSTER_H = 720

const WECHAT_ID = 'TheKinginYellow09'
const FEISHU_QR_SRC = `${import.meta.env.BASE_URL}feishu-qrcode.png`

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
  posterPayload: PosterPayload | null
} = {
  phase: 'landing',
  nickName: '',
  difficulty: 'hard',
  questions: [],
  currentIndex: 0,
  selectedChoice: null,
  correctCount: 0,
  startTime: 0,
  previewSrc: null,
  posterPayload: null,
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
    return '图库数量不足当前难度：请增加 public/images 下的图，或配置 VITE_IMAGE_CDN_BASE 指向更大图库。'
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
  if (state.phase === 'tech') {
    teardownGame()
    renderTechPage()
    return
  }
  if (state.phase === 'landing') {
    teardownGame()
    renderLanding()
    return
  }
  if (state.phase === 'loading') {
    renderLoading()
    return
  }
  if (state.phase === 'poster') {
    teardownGame()
    renderPosterView()
    return
  }
  if (!gameDom) {
    mountPlayingUI()
  }
  updatePlayingUI()
}

function renderTechPage() {
  removePreviewLayer()
  app.innerHTML = `
    <div class="tech-page">
      <button type="button" class="btn-back-tech" id="btn-tech-back">← 返回首页</button>
      <h1 class="tech-title">技术说明</h1>
      <p class="tech-placeholder">这里将补充「模型生成图片」相关的技术细节与文章。</p>
      <p class="tech-hint">内容建设中，敬请期待。</p>
    </div>
  `
  document.getElementById('btn-tech-back')!.onclick = () => {
    state.phase = 'landing'
    render()
  }
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
      </div>
      <button type="button" class="btn-daily-challenge" id="btn-daily-challenge">每日挑战 ⏳</button>
      <div class="diff-wrap">
        <button type="button" class="diff-btn diff-easy" data-difficulty="easy">难度: 简单 😆</button>
        <button type="button" class="diff-btn diff-medium" data-difficulty="medium">难度: 中等 🤨</button>
        <button type="button" class="diff-btn diff-hard" data-difficulty="hard">难度: 困难 🤯</button>
        <button type="button" class="diff-btn diff-hell" data-difficulty="hell">难度: 地狱 😈</button>
      </div>
      <div class="footer-links">
        <span class="footer-contact-lead">想知道图像生成模型的工作原理？</span>
        <a class="footer-link" href="#" id="link-tech">点击这里</a>
        <div class="footer-contact-inline">
          <span class="footer-contact-lead">如果想要接触好玩的开源项目，可以</span>
          <button type="button" class="footer-link footer-link-btn" id="btn-open-contact">联系作者</button>
          <span class="footer-contact-lead">，请备注来意</span>
        </div>
      </div>
    </div>
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

  document.querySelectorAll('.diff-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const d = (btn as HTMLElement).dataset.difficulty as GameDifficulty
      startWithDifficulty(d)
    })
  })

  document.getElementById('link-tech')!.addEventListener('click', (e) => {
    e.preventDefault()
    state.phase = 'tech'
    render()
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
  state.previewSrc = null
  state.phase = 'loading'
  render()
}

function renderLoading() {
  const urls = collectUniqueImageUrls(state.questions)
  const total = urls.length
  app.innerHTML = `
    <div class="loading-screen">
      <h2 class="loading-title">正在加载本局题目</h2>
      <p class="loading-desc">
        预先加载本局全部图片（共 <strong>${total}</strong> 张，去重后），完成后才会开始计时。
      </p>
      <div class="loading-bar-outer">
        <div class="loading-bar-inner" id="load-bar-inner" style="width: 0%"></div>
      </div>
      <p class="loading-count" id="load-count">0 / ${total}</p>
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
  if (state.selectedChoice === question.answerIndex) {
    state.correctCount += 1
  }

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

  state.posterPayload = {
    nickName: state.nickName || '玩家',
    correctCount: state.correctCount,
    totalCount: total,
    elapsedSec,
  }
  state.phase = 'poster'
  render()
}

function renderPosterView() {
  const data = state.posterPayload!
  app.innerHTML = `
    <div class="poster-page">
      <h2 class="poster-heading">成绩单海报</h2>
      <canvas id="poster-canvas" class="poster-canvas-el" width="${POSTER_W}" height="${POSTER_H}"></canvas>
      <div class="poster-actions">
        <button type="button" class="btn-save-img" id="btn-save-png">保存为图片</button>
        <button type="button" class="btn-home" id="btn-home">返回首页</button>
      </div>
    </div>
  `

  const canvas = document.getElementById('poster-canvas') as HTMLCanvasElement
  const ctx = canvas.getContext('2d')!
  drawPoster(ctx, POSTER_W, POSTER_H, data)

  document.getElementById('btn-save-png')!.onclick = () => {
    canvas.toBlob((blob) => {
      if (!blob) return
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `扒拉图成绩单-${data.nickName}.png`
      a.click()
      URL.revokeObjectURL(url)
    }, 'image/png')
  }

  document.getElementById('btn-home')!.onclick = () => {
    state.phase = 'landing'
    state.questions = []
    state.posterPayload = null
    state.nickName = ''
    render()
  }
}

render()
