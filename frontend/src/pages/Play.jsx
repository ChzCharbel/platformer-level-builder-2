import { useEffect, useRef, useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Share2, RefreshCw, Home, Star, ChevronRight, ChevronLeft, Brain, CheckCircle, XCircle, Lightbulb, AlertTriangle } from 'lucide-react'

// ──────────────────────────────────────────────
// CONSTANTS
// ──────────────────────────────────────────────
const TILE_SIZE      = 32
const COYOTE_MS      = 100
const JUMP_BUFFER_MS = 120
const LABEL_LEFT     = 28   // px reserved for row number labels
const LABEL_TOP      = 20   // px reserved for col number labels

// ──────────────────────────────────────────────
// CANVAS RENDERER — pure functions
// ──────────────────────────────────────────────
function drawPlatform(ctx, x, y, ts) {
  ctx.fillStyle = '#a8956a'
  ctx.fillRect(x, y, ts, ts)
  ctx.fillStyle = '#c4ab82'
  ctx.fillRect(x, y, ts, 4)
  ctx.fillStyle = '#8a7450'
  ctx.fillRect(x, y + ts - 2, ts, 2)
  ctx.fillRect(x + ts - 2, y, 2, ts)
}

function drawSpike(ctx, x, y, ts) {
  ctx.fillStyle = '#ef4444'
  ctx.strokeStyle = '#dc2626'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(x + ts / 2, y + 2)
  ctx.lineTo(x + ts - 2, y + ts - 2)
  ctx.lineTo(x + 2, y + ts - 2)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()
}

function drawCoin(ctx, x, y, ts, frame) {
  const pulse = 1 + Math.sin(frame * 0.08) * 0.1
  ctx.save()
  ctx.translate(x + ts / 2, y + ts / 2)
  ctx.scale(pulse, pulse)
  ctx.fillStyle = '#fbbf24'
  ctx.strokeStyle = '#f59e0b'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.arc(0, 0, ts * 0.32, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = '#fef3c7'
  ctx.beginPath()
  ctx.arc(-ts * 0.06, -ts * 0.06, ts * 0.1, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

function drawGoal(ctx, x, y, ts, frame) {
  ctx.save()
  ctx.translate(x + ts / 2, y + ts / 2)
  ctx.rotate(Math.sin(frame * 0.05) * 0.15)
  ctx.font = `${ts * 0.8}px sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.shadowColor = '#22c55e'
  ctx.shadowBlur = 12
  ctx.fillText('★', 0, 2)
  ctx.restore()
}

function drawPlayer(ctx, x, y, w, h) {
  ctx.save()
  ctx.fillStyle = '#f97316'
  ctx.fillRect(x, y, w, h)
  ctx.fillStyle = '#fed7aa'
  ctx.fillRect(x + w * 0.2, y + h * 0.12, w * 0.6, h * 0.3)
  ctx.fillStyle = '#1c1917'
  ctx.fillRect(x + w * 0.22, y + h * 0.15, w * 0.18, h * 0.18)
  ctx.fillRect(x + w * 0.58, y + h * 0.15, w * 0.18, h * 0.18)
  ctx.restore()
}

// ──────────────────────────────────────────────
// PARTICLE BURST
// ──────────────────────────────────────────────
function makeParticles(x, y) {
  return Array.from({ length: 6 }, () => ({
    x, y,
    vx: (Math.random() - 0.5) * 180,
    vy: -(Math.random() * 150 + 60),
    life: 1,
    color: Math.random() > 0.5 ? '#fbbf24' : '#fef3c7',
    r: 4 + Math.random() * 4,
  }))
}

// ──────────────────────────────────────────────
// TILE HELPERS
// ──────────────────────────────────────────────
function isSolid(grid, row, col) {
  if (row < 0 || col < 0 || row >= grid.length || col >= (grid[0]?.length ?? 0)) return false
  const t = grid[row][col]; return t === 1 || t === 'T'
}

function getTile(grid, row, col) {
  if (row < 0 || col < 0 || row >= grid.length || col >= (grid[0]?.length ?? 0)) return 0
  return grid[row][col]
}

// ──────────────────────────────────────────────
// LEVEL LOAD
// ──────────────────────────────────────────────
function loadLevel(levelData) {
  const grid = levelData.data
  const rows = grid.length
  const cols = grid[0]?.length ?? 0
  let spawnX = TILE_SIZE
  let spawnY = TILE_SIZE
  const coins = new Set()
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const t = grid[r][c]
      if (t === 'P') { spawnX = c * TILE_SIZE; spawnY = r * TILE_SIZE }
      if (t === 'C') coins.add(`${r},${c}`)
    }
  }
  return { grid, rows, cols, spawnX, spawnY, coins }
}

// ──────────────────────────────────────────────
// DIFFICULTY STARS
// ──────────────────────────────────────────────
function rateDifficulty(grid) {
  if (!grid) return 1
  const flat = grid.flat()
  const total = flat.length
  const spikes = flat.filter((t) => t === 'S').length
  const ratio = spikes / Math.max(total, 1)
  if (ratio > 0.12) return 5
  if (ratio > 0.07) return 4
  if (ratio > 0.03) return 3
  if (ratio > 0.01) return 2
  return 1
}

// ──────────────────────────────────────────────
// TOAST
// ──────────────────────────────────────────────
function Toast({ message, onDone }) {
  useEffect(() => {
    const id = setTimeout(onDone, 2500)
    return () => clearTimeout(id)
  }, [onDone])
  return (
    <motion.div
      initial={{ y: 20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 20, opacity: 0 }}
      className="fixed bottom-6 left-1/2 -translate-x-1/2 px-6 py-3 bg-stone-800 text-white
                 rounded-2xl text-sm font-semibold shadow-xl z-50"
    >
      {message}
    </motion.div>
  )
}

// ──────────────────────────────────────────────
// PHYSICS SLIDER ROW
// ──────────────────────────────────────────────
function SliderRow({ label, id, min, max, step, value, decimals = 0, onChange }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-between text-[10px]">
        <span className="text-stone-500">{label}</span>
        <span className="text-stone-200 font-bold">{Number(value).toFixed(decimals)}</span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        className="w-full h-[3px] appearance-none rounded bg-[#2a2a4a] outline-none cursor-pointer
                   [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3
                   [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full
                   [&::-webkit-slider-thumb]:bg-orange-400 [&::-webkit-slider-thumb]:cursor-pointer"
      />
    </div>
  )
}

// ──────────────────────────────────────────────
// PLAY PAGE
// ──────────────────────────────────────────────
export default function Play() {
  const { id } = useParams()
  const navigate = useNavigate()
  const canvasRef = useRef(null)
  const gameRef = useRef(null)
  const rafRef = useRef(null)

  const [levelData, setLevelData] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [gameWon, setGameWon] = useState(false)
  const [winTime, setWinTime] = useState(0)

  // Physics slider state (drives UI + game loop via physRef)
  const [phys, setPhys] = useState({
    gravity: 1800, jumpStrength: 600, moveSpeed: 280, friction: 0.75, maxFall: 1400,
  })
  const physRef = useRef(phys)

  // K2 panel
  const [panelOpen, setPanelOpen] = useState(true)
  const [k2Phase, setK2Phase] = useState('idle')
  const [k2Thinking, setK2Thinking] = useState('')
  const [k2Result, setK2Result] = useState(null)
  const [k2Error, setK2Error] = useState(null)
  const [verifyTrigger, setVerifyTrigger] = useState(0)
  const verifyPhysRef = useRef({ gravity: 1800, jumpStrength: 600, moveSpeed: 280, tileSize: TILE_SIZE })
  const thinkScrollRef = useRef(null)

  const [toast, setToast] = useState(null)
  const [score, setScore] = useState(0)

  // For '?' suggestion hover tooltip
  const camRef = useRef({ x: 0, y: 0 })
  const designSuggestionsRef = useRef([])
  const [hoveredSuggestion, setHoveredSuggestion] = useState(null)
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 })

  // Load level
  useEffect(() => {
    const raw = localStorage.getItem(`level_${id}`)
    if (!raw) { setLoadError('Level not found. It may have expired or the link is invalid.'); return }
    try { setLevelData(JSON.parse(raw)) } catch { setLoadError('Level data is corrupted.') }
  }, [id])

  // Sync phys state → physRef so game loop always reads latest values
  useEffect(() => { physRef.current = phys }, [phys])

  // Update a single physics param
  const setPhysParam = useCallback((key, val) => {
    setPhys(prev => ({ ...prev, [key]: val }))
  }, [])

  // Game loop
  useEffect(() => {
    if (!levelData || !canvasRef.current) return
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    const { grid, rows, cols, spawnX, spawnY, coins: initialCoins } = loadLevel(levelData)
    const TILE = TILE_SIZE
    const levelW = cols * TILE
    const levelH = rows * TILE

    const g = {
      px: spawnX, py: spawnY,
      pvx: 0, pvy: 0,
      onGround: false,
      coyoteTimer: 0,
      jumpBufferTimer: 0,
      spawnX, spawnY,
      coins: new Set(initialCoins),
      particles: [],
      frame: 0,
      startTime: performance.now(),
      state: 'playing',
      keys: {},
    }
    gameRef.current = g

    const initialCoinCount = initialCoins.size
    function syncScore() { setScore(initialCoinCount - g.coins.size) }

    function onKeyDown(e) {
      g.keys[e.code] = true
      if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(e.code)) e.preventDefault()
      if (e.code === 'KeyR') respawn()
      if (e.code === 'ArrowUp' || e.code === 'KeyW' || e.code === 'Space') {
        g.jumpBufferTimer = JUMP_BUFFER_MS
      }
    }
    function onKeyUp(e) { g.keys[e.code] = false }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)

    function respawn() {
      g.px = g.spawnX; g.py = g.spawnY
      g.pvx = 0; g.pvy = 0
      g.onGround = false
      g.state = 'playing'
    }

    function physicsUpdate(dt) {
      if (g.state !== 'playing') return
      const { gravity, jumpStrength, moveSpeed, friction, maxFall } = physRef.current
      const pw = TILE * 0.75
      const ph = TILE * 0.9
      const goLeft  = !!(g.keys['ArrowLeft']  || g.keys['KeyA'])
      const goRight = !!(g.keys['ArrowRight'] || g.keys['KeyD'])

      const hSpeed = g.onGround ? moveSpeed : moveSpeed / Math.SQRT2
      if (goLeft)  g.pvx = -hSpeed
      if (goRight) g.pvx =  hSpeed
      if (!goLeft && !goRight) { g.pvx *= friction; if (Math.abs(g.pvx) < 0.5) g.pvx = 0 }

      if (!g.onGround) g.coyoteTimer = Math.max(0, g.coyoteTimer - dt * 1000)
      if (g.jumpBufferTimer > 0) g.jumpBufferTimer = Math.max(0, g.jumpBufferTimer - dt * 1000)

      const canJump = g.onGround || g.coyoteTimer > 0
      if (canJump && g.jumpBufferTimer > 0) {
        g.pvy = -jumpStrength
        g.onGround = false
        g.coyoteTimer = 0
        g.jumpBufferTimer = 0
      }

      g.pvy = Math.min(g.pvy + gravity * dt, maxFall)

      g.px += g.pvx * dt
      const left0   = Math.floor(g.px / TILE)
      const right0  = Math.floor((g.px + pw - 1) / TILE)
      const top0    = Math.floor(g.py / TILE)
      const bottom0 = Math.floor((g.py + ph - 1) / TILE)
      for (let r = top0; r <= bottom0; r++) {
        if (g.pvx > 0 && isSolid(grid, r, right0)) { g.px = right0 * TILE - pw; g.pvx = 0 }
        if (g.pvx < 0 && isSolid(grid, r, left0))  { g.px = (left0 + 1) * TILE; g.pvx = 0 }
      }

      const wasOnGround = g.onGround
      g.onGround = false
      g.py += g.pvy * dt
      const left1   = Math.floor(g.px / TILE)
      const right1  = Math.floor((g.px + pw - 1) / TILE)
      const top1    = Math.floor(g.py / TILE)
      const bottom1 = Math.floor((g.py + ph - 1) / TILE)
      for (let c = left1; c <= right1; c++) {
        if (g.pvy > 0 && isSolid(grid, bottom1, c)) { g.py = bottom1 * TILE - ph; g.pvy = 0; g.onGround = true }
        if (g.pvy < 0 && isSolid(grid, top1,    c)) { g.py = (top1 + 1) * TILE;   g.pvy = 0 }
      }

      if (wasOnGround && !g.onGround && g.pvy >= 0) g.coyoteTimer = COYOTE_MS
      if (g.py > levelH + 200) { g.state = 'dead'; setTimeout(respawn, 400); return }

      const top2    = Math.floor(g.py / TILE)
      const bottom2 = Math.floor((g.py + ph - 1) / TILE)
      const left2   = Math.floor(g.px / TILE)
      const right2  = Math.floor((g.px + pw - 1) / TILE)
      for (let r = top2; r <= bottom2; r++) {
        for (let c = left2; c <= right2; c++) {
          const t = getTile(grid, r, c)
          if (t === 'S') { g.state = 'dead'; setTimeout(respawn, 400); return }
          if (t === 'G') {
            g.state = 'win'
            setGameWon(true)
            setWinTime((performance.now() - g.startTime) / 1000)
            return
          }
          const coinKey = `${r},${c}`
          if (t === 'C' && g.coins.has(coinKey)) {
            g.coins.delete(coinKey)
            g.particles.push(...makeParticles(c * TILE + TILE / 2, r * TILE + TILE / 2))
            syncScore()
          }
        }
      }
    }

    function renderFrame() {
      const W = canvas.width
      const H = canvas.height
      const gameW = W - LABEL_LEFT
      const gameH = H - LABEL_TOP

      const pw = TILE * 0.75
      const ph = TILE * 0.9
      let camX = g.px + pw / 2 - gameW / 2
      let camY = g.py + ph / 2 - gameH / 2
      camX = Math.max(0, Math.min(camX, levelW - gameW))
      camY = Math.max(0, Math.min(camY, levelH - gameH))
      camRef.current = { x: camX, y: camY }

      // Background
      ctx.fillStyle = '#1e1b2e'
      ctx.fillRect(0, 0, W, H)

      // Label margin backgrounds
      ctx.fillStyle = '#16142a'
      ctx.fillRect(0, 0, LABEL_LEFT, H)
      ctx.fillRect(0, 0, W, LABEL_TOP)

      // Clip to game area
      ctx.save()
      ctx.beginPath()
      ctx.rect(LABEL_LEFT, LABEL_TOP, gameW, gameH)
      ctx.clip()

      // Grid faint lines
      ctx.strokeStyle = 'rgba(255,255,255,0.03)'
      ctx.lineWidth = 1
      const startCol = Math.floor(camX / TILE)
      const endCol   = Math.ceil((camX + gameW) / TILE)
      const startRow = Math.floor(camY / TILE)
      const endRow   = Math.ceil((camY + gameH) / TILE)
      ctx.beginPath()
      for (let c = startCol; c <= endCol; c++) {
        const x = LABEL_LEFT + c * TILE - camX
        ctx.moveTo(x, LABEL_TOP); ctx.lineTo(x, H)
      }
      for (let r = startRow; r <= endRow; r++) {
        const y = LABEL_TOP + r * TILE - camY
        ctx.moveTo(LABEL_LEFT, y); ctx.lineTo(W, y)
      }
      ctx.stroke()

      // Tiles
      for (let r = startRow; r <= endRow; r++) {
        for (let c = startCol; c <= endCol; c++) {
          const t = getTile(grid, r, c)
          const x = LABEL_LEFT + c * TILE - camX
          const y = LABEL_TOP  + r * TILE - camY
          if (t === 1 || t === 'T')                          drawPlatform(ctx, x, y, TILE)
          else if (t === 'S')                                drawSpike(ctx, x, y, TILE)
          else if (t === 'G')                                drawGoal(ctx, x, y, TILE, g.frame)
          else if (t === 'C' && g.coins.has(`${r},${c}`))   drawCoin(ctx, x, y, TILE, g.frame)
        }
      }

      // Design suggestion '?' markers
      for (const s of designSuggestionsRef.current) {
        const sx = LABEL_LEFT + s.x * TILE - camX + TILE / 2
        const sy = LABEL_TOP  + s.y * TILE - camY + TILE / 2
        if (sx < LABEL_LEFT || sx > W || sy < LABEL_TOP || sy > H) continue
        ctx.save()
        ctx.shadowColor = '#7aa2f7'
        ctx.shadowBlur  = 12
        ctx.fillStyle   = 'rgba(122,162,247,0.88)'
        ctx.beginPath()
        ctx.arc(sx, sy, TILE * 0.3, 0, Math.PI * 2)
        ctx.fill()
        ctx.shadowBlur = 0
        ctx.fillStyle  = '#0e0e14'
        ctx.font       = `bold ${Math.round(TILE * 0.36)}px monospace`
        ctx.textAlign  = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText('?', sx, sy)
        ctx.restore()
      }

      // Particles
      g.particles = g.particles.filter(p => p.life > 0)
      for (const p of g.particles) {
        ctx.globalAlpha = p.life
        ctx.fillStyle = p.color
        ctx.beginPath()
        ctx.arc(LABEL_LEFT + p.x - camX, LABEL_TOP + p.y - camY, p.r, 0, Math.PI * 2)
        ctx.fill()
        p.x += p.vx * 0.016; p.y += p.vy * 0.016; p.vy += 200 * 0.016; p.life -= 0.05
      }
      ctx.globalAlpha = 1

      // Player
      if (g.state === 'playing') {
        drawPlayer(ctx, LABEL_LEFT + g.px - camX, LABEL_TOP + g.py - camY, pw, ph)
      }

      // Dead flash
      if (g.state === 'dead') {
        ctx.fillStyle = 'rgba(239,68,68,0.25)'
        ctx.fillRect(LABEL_LEFT, LABEL_TOP, gameW, gameH)
      }

      ctx.restore() // end clip

      // Level border
      ctx.strokeStyle = 'rgba(122,162,247,0.25)'
      ctx.lineWidth = 1
      ctx.strokeRect(LABEL_LEFT, LABEL_TOP, gameW, gameH)

      // ── Coordinate labels ──
      ctx.fillStyle = '#4a4a6a'
      ctx.font = '9px monospace'

      // Column numbers every 5
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      for (let c = startCol; c <= endCol; c++) {
        if (c % 5 !== 0) continue
        const x = LABEL_LEFT + c * TILE - camX
        if (x < LABEL_LEFT || x > W) continue
        ctx.fillText(String(c), x, LABEL_TOP / 2)
      }

      // Row numbers every 5
      ctx.textAlign = 'right'
      for (let r = startRow; r <= endRow; r++) {
        if (r % 5 !== 0) continue
        const y = LABEL_TOP + r * TILE - camY
        if (y < LABEL_TOP || y > H) continue
        ctx.fillText(String(r), LABEL_LEFT - 3, y)
      }

      g.frame++
    }

    let lastTime = 0
    function loop(ts) {
      const dt = Math.min((ts - lastTime) / 1000, 0.05)
      lastTime = ts
      physicsUpdate(dt)
      renderFrame()
      rafRef.current = requestAnimationFrame(loop)
    }
    rafRef.current = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(rafRef.current)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [levelData])

  // ── K2 verification ──
  useEffect(() => {
    if (!levelData?.data) return
    setK2Phase('thinking')
    setK2Thinking('')
    setK2Result(null)
    setK2Error(null)
    designSuggestionsRef.current = []
    let cancelled = false

    async function runVerify() {
      try {
        const res = await fetch('/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ grid: levelData.data, physicsParams: verifyPhysRef.current }),
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: 'Request failed' }))
          if (!cancelled) { setK2Error(err.error || 'Verification failed'); setK2Phase('error') }
          return
        }
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buf = '', curEvent = null
        while (true) {
          const { done, value } = await reader.read()
          if (done || cancelled) break
          buf += decoder.decode(value, { stream: true })
          const lines = buf.split('\n')
          buf = lines.pop()
          for (const line of lines) {
            if (line.startsWith('event: ')) { curEvent = line.slice(7).trim() }
            else if (line.startsWith('data: ') && curEvent) {
              try {
                const parsed = JSON.parse(line.slice(6))
                if (curEvent === 'thinking') setK2Thinking(prev => prev + parsed.text)
                else if (curEvent === 'result') {
                  if (!cancelled) {
                    setK2Result(parsed)
                    setK2Phase('done')
                    designSuggestionsRef.current = Array.isArray(parsed.design_suggestions) ? parsed.design_suggestions : []
                  }
                }
                else if (curEvent === 'error') {
                  if (!cancelled) { setK2Error(parsed.message); setK2Phase('error') }
                }
              } catch {}
              curEvent = null
            }
          }
        }
      } catch (err) {
        if (!cancelled) { setK2Error(err.message); setK2Phase('error') }
      }
    }
    runVerify()
    return () => { cancelled = true }
  }, [levelData, verifyTrigger])

  // Auto-scroll thinking log
  useEffect(() => {
    if (thinkScrollRef.current) thinkScrollRef.current.scrollTop = thinkScrollRef.current.scrollHeight
  }, [k2Thinking])

  // Resize canvas
  const containerRef = useRef(null)
  useEffect(() => {
    if (!containerRef.current || !canvasRef.current) return
    function resize() {
      const rect = containerRef.current.getBoundingClientRect()
      canvasRef.current.width  = rect.width
      canvasRef.current.height = rect.height
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(containerRef.current)
    return () => ro.disconnect()
  }, [levelData])

  // Canvas hover — show tooltip for '?' suggestion markers
  const handleCanvasMouseMove = useCallback((e) => {
    if (!canvasRef.current || designSuggestionsRef.current.length === 0) {
      setHoveredSuggestion(null); return
    }
    const rect   = canvasRef.current.getBoundingClientRect()
    const scaleX = canvasRef.current.width  / rect.width
    const scaleY = canvasRef.current.height / rect.height
    const mx = (e.clientX - rect.left) * scaleX
    const my = (e.clientY - rect.top)  * scaleY
    const { x: camX, y: camY } = camRef.current
    const r = TILE_SIZE * 0.3 + 4

    for (const s of designSuggestionsRef.current) {
      const sx = LABEL_LEFT + s.x * TILE_SIZE - camX + TILE_SIZE / 2
      const sy = LABEL_TOP  + s.y * TILE_SIZE - camY + TILE_SIZE / 2
      if (Math.hypot(mx - sx, my - sy) <= r) {
        setHoveredSuggestion(s)
        setTooltipPos({ x: e.clientX, y: e.clientY })
        return
      }
    }
    setHoveredSuggestion(null)
  }, [])

  const handleUpdateAnalysis = useCallback(() => {
    verifyPhysRef.current = {
      gravity:      phys.gravity,
      jumpStrength: phys.jumpStrength,
      moveSpeed:    phys.moveSpeed,
      tileSize:     TILE_SIZE,
    }
    setVerifyTrigger(t => t + 1)
  }, [phys])

  const handleShare = useCallback(() => {
    navigator.clipboard.writeText(window.location.href)
      .then(() => setToast('Link copied to clipboard!'))
      .catch(() => setToast('Copy this URL: ' + window.location.href))
  }, [])

  const difficulty = levelData ? rateDifficulty(levelData.data) : 0

  if (loadError) {
    return (
      <div className="min-h-dvh flex flex-col items-center justify-center px-6 bg-[#0f0e1a]">
        <div className="text-6xl mb-4">🗺️</div>
        <h2 className="text-2xl font-bold text-white mb-3">Level not found</h2>
        <p className="text-stone-400 mb-8 text-center max-w-sm">{loadError}</p>
        <button onClick={() => navigate('/')} className="px-8 py-4 bg-orange-500 hover:bg-orange-600 text-white font-bold rounded-2xl transition-colors text-lg">
          Draw a New Level
        </button>
      </div>
    )
  }

  if (!levelData) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-[#0f0e1a]">
        <div className="text-white text-lg animate-pulse">Loading level...</div>
      </div>
    )
  }

  return (
    <div className="flex h-dvh bg-[#0f0e1a] overflow-hidden">

      {/* ── Physics Sidebar ── */}
      <div className="w-52 flex-shrink-0 bg-[#0d0b1e] border-r border-white/10 flex flex-col p-4 gap-4 overflow-y-auto">
        <p className="text-[10px] font-bold tracking-widest uppercase text-orange-400 border-b border-white/10 pb-2">
          Physics Tuner
        </p>
        <div className="flex flex-col gap-4">
          <SliderRow label="Gravity"       min={400}  max={4000} step={100}  decimals={0} value={phys.gravity}      onChange={v => setPhysParam('gravity',      v)} />
          <SliderRow label="Jump Strength" min={100}  max={1400} step={50}   decimals={0} value={phys.jumpStrength} onChange={v => setPhysParam('jumpStrength', v)} />
          <SliderRow label="Move Speed"    min={50}   max={800}  step={10}   decimals={0} value={phys.moveSpeed}    onChange={v => setPhysParam('moveSpeed',    v)} />
          <SliderRow label="Friction"      min={0.10} max={1.00} step={0.05} decimals={2} value={phys.friction}     onChange={v => setPhysParam('friction',     v)} />
          <SliderRow label="Max Fall"      min={200}  max={3000} step={100}  decimals={0} value={phys.maxFall}      onChange={v => setPhysParam('maxFall',      v)} />
        </div>
        <button
          onClick={handleUpdateAnalysis}
          disabled={k2Phase === 'thinking'}
          className="mt-auto py-3 px-4 bg-orange-500/15 border border-orange-500/40 text-orange-400
                     font-bold text-xs tracking-widest uppercase rounded-xl hover:bg-orange-500/25
                     transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          ⚙ Update Analysis
        </button>
      </div>

      {/* ── Main column ── */}
      <div className="flex flex-col flex-1 overflow-hidden">

        {/* Top bar */}
        <div className="flex items-center gap-3 px-4 py-2 bg-[#16142a] border-b border-white/10 flex-shrink-0">
          <button onClick={() => navigate('/')} aria-label="Go home"
            className="p-2 rounded-lg text-stone-400 hover:text-white hover:bg-white/10 transition-colors">
            <Home size={18} />
          </button>
          <h1 className="text-sm font-bold text-white truncate flex-1">{levelData.title || 'Your Level'}</h1>
          <div className="flex items-center gap-0.5" aria-label={`Difficulty: ${difficulty} out of 5 stars`}>
            {Array.from({ length: 5 }, (_, i) => (
              <Star key={i} size={14} className={i < difficulty ? 'text-amber-400 fill-amber-400' : 'text-stone-600'} />
            ))}
          </div>
          {levelData.data?.flat().some(t => t === 'C') && (
            <span className="text-amber-400 text-sm font-bold">🪙 {score}</span>
          )}
          <button onClick={handleShare} aria-label="Share this level"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 text-stone-300 hover:bg-white/20 hover:text-white transition-colors text-sm font-medium">
            <Share2 size={14} /> Share
          </button>
          <button onClick={() => navigate('/')} aria-label="Create a new level"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-orange-500/20 text-orange-400 hover:bg-orange-500/30 hover:text-orange-300 transition-colors text-sm font-medium">
            <RefreshCw size={14} /> New Level
          </button>
        </div>

        {/* HUD */}
        <div className="text-center text-[11px] text-stone-600 py-1 flex-shrink-0">
          Arrow Keys / WASD to move · Space / Up to jump · R to reset
        </div>

        {/* Canvas + K2 panel */}
        <div className="flex flex-1 overflow-hidden relative">

          {/* Canvas */}
          <div ref={containerRef} className="flex-1 relative">
            <canvas
              ref={canvasRef}
              className="w-full h-full block"
              aria-label="Platformer game canvas"
              tabIndex={0}
              onMouseMove={handleCanvasMouseMove}
              onMouseLeave={() => setHoveredSuggestion(null)}
            />

            {/* Design suggestion tooltip */}
            <AnimatePresence>
              {hoveredSuggestion && (
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="fixed z-50 pointer-events-none bg-[#10102a] border border-[#7aa2f7] rounded-xl
                             px-3 py-2 max-w-[220px] shadow-xl"
                  style={{ left: tooltipPos.x + 14, top: tooltipPos.y - 10 }}
                >
                  <p className="text-[11px] font-bold text-white mb-1">{hoveredSuggestion.problem}</p>
                  <p className="text-[10px] text-stone-400 leading-relaxed">{hoveredSuggestion.suggestion}</p>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Win overlay */}
            <AnimatePresence>
              {gameWon && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                  className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm">
                  <motion.div
                    initial={{ scale: 0.7, y: 30 }} animate={{ scale: 1, y: 0 }}
                    transition={{ type: 'spring', stiffness: 250, damping: 20 }}
                    className="bg-[#1e1b2e] border border-white/20 rounded-3xl p-10 text-center shadow-2xl max-w-sm mx-4">
                    <div className="text-6xl mb-4">🎉</div>
                    <h2 className="text-3xl font-black text-white mb-2">You Win!</h2>
                    <p className="text-stone-400 mb-1">Time: <span className="text-white font-bold">{winTime.toFixed(1)}s</span></p>
                    {score > 0 && <p className="text-amber-400 mb-6">Coins: <span className="font-bold">{score}</span></p>}
                    <div className="flex flex-col gap-3 mt-6">
                      <button
                        onClick={() => {
                          setGameWon(false)
                          if (gameRef.current) {
                            gameRef.current.state = 'playing'
                            gameRef.current.px = gameRef.current.spawnX
                            gameRef.current.py = gameRef.current.spawnY
                            gameRef.current.pvx = 0
                            gameRef.current.pvy = 0
                          }
                        }}
                        className="px-6 py-3 bg-orange-500 hover:bg-orange-600 text-white font-bold rounded-2xl transition-colors text-lg">
                        Play Again
                      </button>
                      <button onClick={handleShare}
                        className="px-6 py-3 bg-white/10 hover:bg-white/20 text-white font-semibold rounded-2xl transition-colors flex items-center justify-center gap-2">
                        <Share2 size={16} /> Share This Level
                      </button>
                      <button onClick={() => navigate('/')}
                        className="px-6 py-3 text-stone-400 hover:text-white font-medium transition-colors text-sm">
                        Draw a New Level
                      </button>
                    </div>
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* K2 Analysis Panel */}
          <div className={`flex flex-col bg-[#0d0b1e] border-l border-white/10 transition-all duration-300 overflow-hidden flex-shrink-0 ${panelOpen ? 'w-72' : 'w-0'}`}>
            <div className="flex items-center gap-2 px-3 py-2 border-b border-white/10 flex-shrink-0">
              <Brain size={14} className="text-violet-400" />
              <span className="text-xs font-bold text-violet-300 uppercase tracking-widest flex-1">K2 Analysis</span>
              {k2Phase === 'thinking' && (
                <span className="flex gap-0.5">
                  {[0,1,2].map(i => (
                    <motion.span key={i} className="w-1 h-1 rounded-full bg-violet-400 block"
                      animate={{ opacity: [0.3,1,0.3] }} transition={{ duration: 1, repeat: Infinity, delay: i*0.2 }} />
                  ))}
                </span>
              )}
              {k2Phase === 'done' && k2Result?.solvable  && <CheckCircle size={14} className="text-emerald-400" />}
              {k2Phase === 'done' && !k2Result?.solvable && <XCircle size={14} className="text-red-400" />}
              {k2Phase === 'error' && <AlertTriangle size={14} className="text-amber-400" />}
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-3 text-xs">
              {k2Thinking && (
                <div>
                  <p className="text-[10px] font-semibold text-violet-500 uppercase tracking-widest mb-1">Reasoning</p>
                  <div ref={thinkScrollRef} className="bg-[#16132a] rounded-lg p-2 max-h-40 overflow-y-auto font-mono text-[10px] text-violet-300/70 leading-relaxed whitespace-pre-wrap">
                    {k2Thinking}
                  </div>
                </div>
              )}

              {k2Phase === 'done' && k2Result && (
                <>
                  <div className={`flex items-center gap-2 px-3 py-2 rounded-lg ${k2Result.solvable ? 'bg-emerald-500/15 border border-emerald-500/30' : 'bg-red-500/15 border border-red-500/30'}`}>
                    {k2Result.solvable
                      ? <CheckCircle size={16} className="text-emerald-400 flex-shrink-0" />
                      : <XCircle    size={16} className="text-red-400 flex-shrink-0" />}
                    <span className={`font-bold text-sm ${k2Result.solvable ? 'text-emerald-300' : 'text-red-300'}`}>
                      {k2Result.solvable ? 'Beatable!' : 'Not Beatable'}
                    </span>
                  </div>

                  {k2Result.kid_summary && (
                    <p className="text-stone-300 leading-relaxed italic">"{k2Result.kid_summary}"</p>
                  )}

                  {k2Result.design_suggestions?.length > 0 && (
                    <div>
                      <p className="text-[10px] font-semibold text-amber-400/80 uppercase tracking-widest mb-1.5 flex items-center gap-1">
                        <Lightbulb size={10} /> Tips <span className="text-stone-600 normal-case">(hover ? on canvas)</span>
                      </p>
                      <div className="space-y-1.5">
                        {k2Result.design_suggestions.map((s, i) => (
                          <div key={i} className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-2">
                            <p className="font-bold text-amber-300 text-[11px]">{s.problem}</p>
                            <p className="text-stone-400 text-[10px] mt-0.5 leading-relaxed">{s.suggestion}</p>
                            <p className="text-amber-500/50 text-[9px] mt-0.5">col {s.x}, row {s.y}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {k2Result.bottlenecks?.length > 0 && (
                    <div>
                      <p className="text-[10px] font-semibold text-red-400/80 uppercase tracking-widest mb-1.5 flex items-center gap-1">
                        <AlertTriangle size={10} /> Hard Spots
                      </p>
                      <div className="space-y-1.5">
                        {k2Result.bottlenecks.map((b, i) => (
                          <div key={i} className="bg-red-500/10 border border-red-500/20 rounded-lg p-2">
                            <p className="text-stone-400 text-[10px] leading-relaxed">{b.reason}</p>
                            <p className="text-red-500/50 text-[9px] mt-0.5">col {b.x}, row {b.y}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}

              {k2Phase === 'error' && (
                <div className="space-y-3">
                  <div className="bg-[#16132a] rounded-xl p-4 text-center">
                    <div className="text-3xl mb-2">🤔</div>
                    <p className="text-violet-300 font-semibold text-sm mb-1">K2 is thinking elsewhere</p>
                    <p className="text-stone-500 text-[10px] leading-relaxed">The AI reasoning engine isn't connected yet — but the level is still fully playable!</p>
                  </div>
                </div>
              )}

              {k2Phase === 'idle' && <p className="text-stone-600 text-center pt-4">Waiting…</p>}
            </div>
          </div>

          {/* Panel toggle */}
          <button
            onClick={() => setPanelOpen(o => !o)}
            className="absolute top-1/2 -translate-y-1/2 z-10 w-5 h-10 bg-[#16132a] border border-white/10
                       rounded-l-lg flex items-center justify-center text-stone-400 hover:text-white transition-colors"
            style={{ right: panelOpen ? '288px' : '0px', transition: 'right 0.3s' }}
          >
            {panelOpen ? <ChevronRight size={12} /> : <ChevronLeft size={12} />}
          </button>

        </div>
      </div>

      {/* Toast */}
      <AnimatePresence>
        {toast && <Toast message={toast} onDone={() => setToast(null)} />}
      </AnimatePresence>
    </div>
  )
}
