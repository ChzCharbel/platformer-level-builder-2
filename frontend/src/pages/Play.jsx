import { useEffect, useRef, useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Share2, RefreshCw, Home, Star, ChevronRight, ChevronLeft, Brain, CheckCircle, XCircle, Lightbulb, AlertTriangle, Cpu } from 'lucide-react'
import ThemeToggle from '../components/bits/ThemeToggle'

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

function drawPlayer(ctx, x, y, w, h, cpuMode = false) {
  ctx.save()
  ctx.fillStyle = cpuMode ? '#00aaff' : '#f97316'
  ctx.fillRect(x, y, w, h)
  ctx.fillStyle = cpuMode ? '#aadeff' : '#fed7aa'
  ctx.fillRect(x + w * 0.2, y + h * 0.12, w * 0.6, h * 0.3)
  ctx.fillStyle = cpuMode ? '#003366' : '#1c1917'
  ctx.fillRect(x + w * 0.22, y + h * 0.15, w * 0.18, h * 0.18)
  ctx.fillRect(x + w * 0.58, y + h * 0.15, w * 0.18, h * 0.18)
  ctx.restore()
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.arcTo(x + w, y, x + w, y + r, r)
  ctx.lineTo(x + w, y + h - r)
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r)
  ctx.lineTo(x + r, y + h)
  ctx.arcTo(x, y + h, x, y + h - r, r)
  ctx.lineTo(x, y + r)
  ctx.arcTo(x, y, x + r, y, r)
  ctx.closePath()
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
      className="fixed bottom-6 left-1/2 -translate-x-1/2 px-6 py-3 rounded-2xl text-sm font-semibold shadow-xl z-50"
      style={{ background: 'var(--bg-card)', color: 'var(--text-base)', border: '1px solid var(--border-ui)' }}
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
        <span className="font-bold" style={{ color: 'var(--text-secondary)' }}>{Number(value).toFixed(decimals)}</span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        className="w-full h-[3px] appearance-none rounded outline-none cursor-pointer
                   [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3
                   [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full
                   [&::-webkit-slider-thumb]:bg-orange-400 [&::-webkit-slider-thumb]:cursor-pointer"
        style={{ background: 'var(--bg-subtle)' }}
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

  // Dev mode
  const [isDevMode, setIsDevMode] = useState(false)
  const devModeRef = useRef(false)

  // Simulate mode
  const [simulateMode, setSimulateMode] = useState(false)
  const simulateModeRef = useRef(false)
  const aiStateRef = useRef({ queue: [], current: null, timer: 0, lastCmdType: null })
  const simDeathsRef = useRef([])   // death positions recorded during simulate runs
  const k2ResultRef  = useRef(null) // latest K2 result, readable inside game loop

  // Physics panel open/close
  const [physPanelOpen, setPhysPanelOpen] = useState(true)

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
  // Sync devMode → devModeRef
  useEffect(() => { devModeRef.current = isDevMode }, [isDevMode])
  // Sync simulateMode → simulateModeRef; reset AI state on toggle-on
  useEffect(() => {
    simulateModeRef.current = simulateMode
    if (simulateMode) {
      aiStateRef.current = { queue: [], current: null, timer: 0, lastCmdType: null }
      simDeathsRef.current = []  // fresh run — clear previous deaths
    }
  }, [simulateMode])
  // Keep k2ResultRef in sync so the game loop can read it without closure issues
  useEffect(() => { k2ResultRef.current = k2Result }, [k2Result])

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

    // Record a simulate-mode death and trigger K2 re-analysis every 2 deaths
    function recordSimDeath(col, row) {
      simDeathsRef.current.push({ col, row })
      const count = simDeathsRef.current.length
      // Re-run K2 on 1st death, then every 2nd after
      if (count === 1 || count % 2 === 0) {
        verifyPhysRef.current = {
          gravity: physRef.current.gravity, jumpStrength: physRef.current.jumpStrength,
          moveSpeed: physRef.current.moveSpeed, tileSize: TILE_SIZE,
        }
        setVerifyTrigger(t => t + 1)
        setToast(`K2 re-analysing after ${count} death${count > 1 ? 's' : ''}…`)
      }
    }

    // ── AI Decision Tree ──────────────────────────────────────────
    // Builds a physics-derived jump envelope each call (so slider
    // changes take effect immediately), scans the surroundings, then
    // chooses an action.  Philosophy: attempt any jump that is within
    // the physics envelope.  Die trying > wait indefinitely.
    function generateAICommands() {
      // 1. Locate goal
      let goalCol = null, goalRow = null
      outer: for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++)
          if (grid[r][c] === 'G') { goalCol = c; goalRow = r; break outer }
      if (goalCol === null) return [{ type: 'WAIT', duration: 500, label: 'NO_GOAL' }]

      const pCol = Math.floor((g.px + TILE * 0.375) / TILE)
      const pRow = Math.floor((g.py + TILE * 0.45)  / TILE)
      const dx   = goalCol - pCol
      const dy   = goalRow - pRow  // positive = goal is lower

      if (Math.abs(dx) < 1) {
        if (dy < 0) return [{ type: 'JUMP', duration: 120, label: 'JUMP_TO_GOAL' }]
        return [{ type: 'WAIT', duration: 200, label: 'WAIT_FALL' }]
      }

      const dir  = dx > 0 ? 'RIGHT' : 'LEFT'
      const move = `MOVE_${dir}`
      const jump = `JUMP_${dir}`
      const col  = (n) => dir === 'RIGHT' ? pCol + n : pCol - n
      const isSpike = (r, c) => grid[r]?.[c] === 'S'

      // 2. Physics envelope — recalculated from current slider values every call
      const { jumpStrength, gravity, moveSpeed } = physRef.current
      const apexTiles  = jumpStrength * jumpStrength / (2 * gravity * TILE) // max height (tiles)
      const airTime    = 2 * jumpStrength / gravity                          // full air time (s)
      const reachTiles = (moveSpeed / Math.SQRT2) * airTime / TILE           // horizontal reach (tiles)

      // 3. Ceiling clearance: free tiles directly above player
      let ceilClear = 0
      for (let r = pRow - 1; r >= Math.max(0, pRow - Math.ceil(apexTiles) - 1); r--) {
        if (isSolid(grid, r, pCol)) break
        ceilClear++
      }
      // Can we jump at all? Need the player on the ground with at least 1 tile above.
      const canJump = g.onGround && ceilClear >= 1
      // Can we clear an obstacle of H tiles? Checks both apex height and ceiling room.
      const clears = (h) => apexTiles >= h && ceilClear >= h

      // 4. Spike check along the low arc (ground level + 1 tile above).
      //    Only spike tiles are hard blockers — ceilings just reduce clearance.
      function spikeInPath() {
        for (let i = 1; i <= Math.ceil(reachTiles); i++) {
          const c = col(i)
          if (isSpike(pRow, c) || isSpike(pRow - 1, c)) return true
        }
        return false
      }

      // 5. Gap width: consecutive missing-floor columns ahead
      let gapWidth = 0
      for (let i = 1; i <= Math.ceil(reachTiles) + 2; i++) {
        if (!isSolid(grid, pRow + 1, col(i)) && !isSolid(grid, pRow, col(i))) gapWidth = i
        else break
      }

      // 6. Per-column terrain for the first tile ahead
      const t1 = {
        wall:  isSolid(grid, pRow,     col(1)),
        ceil:  isSolid(grid, pRow - 1, col(1)),
        floor: isSolid(grid, pRow + 1, col(1)),
        spike: isSpike(pRow, col(1)) || isSpike(pRow + 1, col(1)),
      }
      const gapAhead = isSolid(grid, pRow + 1, pCol) && !t1.floor && !t1.wall

      // 7. K2 bottleneck awareness — check if K2 has flagged any tile
      //    within the next few columns as a known hard spot.
      const k2Bottlenecks = k2ResultRef.current?.bottlenecks ?? []
      const nearBottleneck = k2Bottlenecks.find(b => {
        const colDist = Math.abs(b.x - col(1))
        return colDist <= Math.max(1, Math.ceil(reachTiles * 0.5)) && Math.abs(b.y - pRow) <= 2
      })

      // ── Decision tree ────────────────────────────────────────────
      // Each branch first checks ideal conditions, then falls back to
      // "attempt anyway" — the bot should try rather than stand still.

      // Spike at foot level → must jump
      if (t1.spike) {
        if (canJump)
          return [{ type: jump, duration: 420, label: clears(1) ? 'JUMP_SPIKE' : 'SPIKE_ATTEMPT' },
                  { type: move, duration: 260, label: 'CLEAR_SPIKE' }]
        return [{ type: 'WAIT', duration: 300, label: 'SPIKE_NO_ROOM' }]
      }

      // Wall ahead → hop over; height = 1 or 2 tiles
      if (t1.wall) {
        if (canJump) {
          const h = t1.ceil ? 2 : 1
          return [{ type: jump, duration: h > 1 ? 480 : 360, label: clears(h) ? 'JUMP_WALL' : 'WALL_ATTEMPT' },
                  { type: move, duration: 260, label: 'CLEAR_WALL' }]
        }
        return [{ type: 'WAIT', duration: 300, label: 'WALL_NO_ROOM' }]
      }

      // Gap ahead → jump if within reach, otherwise attempt anyway
      if (gapAhead) {
        if (canJump)
          return [{ type: jump, duration: 460, label: gapWidth <= reachTiles ? `JUMP_GAP_${gapWidth}T` : 'GAP_ATTEMPT' }]
        return [{ type: 'WAIT', duration: 300, label: 'GAP_NO_JUMP' }]
      }

      // Goal is elevated → jump + move toward it
      if (dy < -1 && g.onGround) {
        if (canJump)
          return [{ type: jump, duration: 140, label: clears(-dy) ? 'JUMP_ELEVATED' : 'ELEVATED_ATTEMPT' },
                  { type: move, duration: 380, label: 'RISE_TO_GOAL' }]
      }

      // Default: walk toward goal.
      // If K2 flagged this area as a bottleneck, creep forward slowly
      // so the safety sensor has time to react before we commit.
      if (nearBottleneck) {
        const reason = nearBottleneck.reason?.slice(0, 40) ?? 'K2 flagged danger'
        return [{ type: move, duration: 160, label: `K2_CAUTION: ${reason}` }]
      }
      const stride = Math.min(Math.abs(dx) * 60 + 200, 400)
      return [{ type: move, duration: stride, label: 'APPROACH_GOAL' }]
    }

    // Advance the AI command queue each frame and apply keys to g.keys
    const CODE_MAP = {
      JUMP:       'g.jumpBufferTimer = JUMP_BUFFER_MS',
      JUMP_RIGHT: 'g.jumpBufferTimer = JUMP_BUFFER_MS  |  keys.ArrowRight = true',
      JUMP_LEFT:  'g.jumpBufferTimer = JUMP_BUFFER_MS  |  keys.ArrowLeft = true',
      MOVE_RIGHT: 'keys.ArrowRight = true  →  pvx = +moveSpeed',
      MOVE_LEFT:  'keys.ArrowLeft = true   →  pvx = -moveSpeed',
      WAIT:       'keys = {}  (idle)',
    }
    function processAICommands(dt) {
      const ai = aiStateRef.current

      // ── Per-frame safety sensor ──────────────────────────────────
      // While executing any MOVE command, check 1 tile ahead every frame.
      // If a gap, spike, or wall appears, cancel immediately so the queue
      // refills and generateAICommands() re-evaluates at the true edge.
      if (ai.current?.type?.startsWith('MOVE')) {
        const pCol = Math.floor((g.px + TILE * 0.375) / TILE)
        const pRow = Math.floor((g.py + TILE * 0.45)  / TILE)
        const step = ai.current.type === 'MOVE_RIGHT' ? 1 : -1
        const look = pCol + step
        const gapNow  = isSolid(grid, pRow + 1, pCol) && !isSolid(grid, pRow + 1, look)
        const wallNow = isSolid(grid, pRow, look)
        const spike   = grid[pRow]?.[look] === 'S' || grid[pRow + 1]?.[look] === 'S'
        if (gapNow || wallNow || spike) {
          ai.current = null; ai.queue = []; ai.timer = 0
          g.keys = {}; return
        }
      }

      ai.timer += dt * 1000

      // Consume expired command
      if (ai.current && ai.timer >= ai.current.duration) {
        ai.timer = 0
        ai.current = ai.queue.length > 0 ? ai.queue.shift() : null
      }

      // Refill empty queue — interleave 700ms pauses between every command
      if (!ai.current && ai.queue.length === 0) {
        const cmds = generateAICommands()
        const withPauses = []
        for (const c of cmds) {
          withPauses.push(c)
          withPauses.push({ type: 'WAIT', duration: 700, label: 'PAUSE' })
        }
        ai.queue = withPauses.slice(1)
        ai.current = withPauses[0] ?? { type: 'WAIT', duration: 400, label: 'IDLE' }
        ai.timer = 0
      }

      // Toast when a non-WAIT command starts
      const cmd = ai.current
      if (cmd && cmd.type !== 'WAIT' && cmd.type !== ai.lastCmdType) {
        ai.lastCmdType = cmd.type
        const code = CODE_MAP[cmd.type]
        if (code) setToast(`↳ ${code}`)
      }

      // Apply command → virtual key presses
      g.keys = {}
      if (!cmd) return
      if (cmd.type === 'MOVE_RIGHT' || cmd.type === 'JUMP_RIGHT') g.keys['ArrowRight'] = true
      if (cmd.type === 'MOVE_LEFT'  || cmd.type === 'JUMP_LEFT')  g.keys['ArrowLeft']  = true
      if ((cmd.type === 'JUMP' || cmd.type === 'JUMP_RIGHT' || cmd.type === 'JUMP_LEFT') && ai.timer < 50)
        g.jumpBufferTimer = JUMP_BUFFER_MS
    }

    function onKeyDown(e) {
      // Any key press exits simulate mode and hands back control
      if (simulateModeRef.current) { setSimulateMode(false); return }
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

    let wasSim = false
    function physicsUpdate(dt) {
      if (g.state !== 'playing') return
      // AI autopilot overrides keyboard input
      if (simulateModeRef.current) {
        processAICommands(dt)
        wasSim = true
      } else if (wasSim) {
        // Simulate just turned off — clear any keys the AI left behind
        g.keys = {}
        wasSim = false
      }
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
      const bottom1 = Math.floor((g.py + ph - 0.01) / TILE)
      for (let c = left1; c <= right1; c++) {
        if (g.pvy > 0 && isSolid(grid, bottom1, c)) { g.py = bottom1 * TILE - ph; g.pvy = 0; g.onGround = true }
        if (g.pvy < 0 && isSolid(grid, top1,    c)) { g.py = (top1 + 1) * TILE;   g.pvy = 0 }
      }

      if (wasOnGround && !g.onGround && g.pvy >= 0) g.coyoteTimer = COYOTE_MS
      if (g.py > levelH + 200) {
        if (simulateModeRef.current) recordSimDeath(Math.round(g.px / TILE), Math.round((g.py - 200) / TILE))
        g.state = 'dead'; setTimeout(respawn, 400); return
      }

      const top2    = Math.floor(g.py / TILE)
      const bottom2 = Math.floor((g.py + ph - 1) / TILE)
      const left2   = Math.floor(g.px / TILE)
      const right2  = Math.floor((g.px + pw - 1) / TILE)
      for (let r = top2; r <= bottom2; r++) {
        for (let c = left2; c <= right2; c++) {
          const t = getTile(grid, r, c)
          if (t === 'S') {
            if (simulateModeRef.current) recordSimDeath(c, r)
            g.state = 'dead'; setTimeout(respawn, 400); return
          }
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

      // Theme-aware canvas colors
      const isLight = document.documentElement.dataset.theme === 'light'
      const c_bg      = isLight ? '#dedad3' : '#1e1b2e'
      const c_label   = isLight ? '#d4d0c8' : '#16142a'
      const c_grid    = isLight ? 'rgba(0,0,0,0.04)' : 'rgba(255,255,255,0.03)'
      const c_border  = isLight ? 'rgba(0,0,0,0.18)' : 'rgba(122,162,247,0.25)'
      const c_coords  = isLight ? '#7a756e' : '#4a4a6a'

      // Background
      ctx.fillStyle = c_bg
      ctx.fillRect(0, 0, W, H)

      // Label margin backgrounds
      ctx.fillStyle = c_label
      ctx.fillRect(0, 0, LABEL_LEFT, H)
      ctx.fillRect(0, 0, W, LABEL_TOP)

      // Clip to game area
      ctx.save()
      ctx.beginPath()
      ctx.rect(LABEL_LEFT, LABEL_TOP, gameW, gameH)
      ctx.clip()

      // Grid faint lines
      ctx.strokeStyle = c_grid
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
        drawPlayer(ctx, LABEL_LEFT + g.px - camX, LABEL_TOP + g.py - camY, pw, ph, simulateModeRef.current)
      }

      // ── Simulate Mode overlay ──
      if (simulateModeRef.current) {
        const ai = aiStateRef.current
        const cmd = ai.current

        // "CPU" label above player
        if (g.state === 'playing') {
          const hx = LABEL_LEFT + g.px - camX + pw / 2
          const hy = LABEL_TOP  + g.py - camY - 12
          ctx.save()
          ctx.font = 'bold 9px monospace'
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.shadowColor = '#00aaff'
          ctx.shadowBlur = 8
          ctx.fillStyle = '#00d4ff'
          ctx.fillText('CPU', hx, hy)
          ctx.restore()
        }

        // Command Terminal box (top-left of game area)
        const TX = LABEL_LEFT + 8, TY = LABEL_TOP + 8, TW = 200, TH = 120
        ctx.save()
        ctx.fillStyle = 'rgba(0,8,22,0.90)'
        roundRect(ctx, TX, TY, TW, TH, 5)
        ctx.fill()
        ctx.strokeStyle = '#00aaff'
        ctx.lineWidth = 1
        roundRect(ctx, TX, TY, TW, TH, 5)
        ctx.stroke()

        ctx.font = 'bold 9px monospace'
        ctx.textAlign = 'left'
        ctx.textBaseline = 'top'

        // Header
        ctx.fillStyle = '#00d4ff'
        const deaths = simDeathsRef.current.length
        const deathBadge = deaths > 0 ? `  [${deaths} death${deaths > 1 ? 's' : ''}]` : ''
        ctx.fillText(`> CPU AUTOPILOT ACTIVE${deathBadge}`, TX + 8, TY + 7)
        ctx.strokeStyle = 'rgba(0,170,255,0.2)'
        ctx.lineWidth = 1
        ctx.beginPath(); ctx.moveTo(TX + 6, TY + 20); ctx.lineTo(TX + TW - 6, TY + 20); ctx.stroke()

        if (cmd) {
          const progress = Math.min(ai.timer / cmd.duration, 1)
          const timeLeft = Math.max(0, (cmd.duration - ai.timer) / 1000).toFixed(1)
          ctx.fillStyle = '#ffffff'
          ctx.fillText(`EXEC: ${cmd.type}`, TX + 8, TY + 26)
          ctx.fillStyle = 'rgba(0,200,255,0.5)'
          ctx.fillText(`WHY: ${cmd.label}`, TX + 8, TY + 38)

          // Progress bar
          ctx.fillStyle = '#001a2e'
          ctx.fillRect(TX + 8, TY + 52, TW - 16, 5)
          ctx.fillStyle = '#00aaff'
          ctx.fillRect(TX + 8, TY + 52, (TW - 16) * progress, 5)
          ctx.fillStyle = 'rgba(180,230,255,0.6)'
          ctx.fillText(`${timeLeft}s`, TX + TW - 26, TY + 47)
        }

        // Queue preview
        ctx.strokeStyle = 'rgba(0,170,255,0.2)'
        ctx.beginPath(); ctx.moveTo(TX + 6, TY + 62); ctx.lineTo(TX + TW - 6, TY + 62); ctx.stroke()
        ctx.fillStyle = 'rgba(0,200,255,0.7)'
        ctx.fillText('QUEUE:', TX + 8, TY + 67)
        const preview = ai.queue.slice(0, 3)
        if (preview.length === 0) {
          ctx.fillStyle = '#334455'
          ctx.fillText('  computing…', TX + 8, TY + 79)
        }
        preview.forEach((qc, i) => {
          ctx.fillStyle = i === 0 ? '#aaffcc' : 'rgba(100,160,180,0.6)'
          ctx.fillText(`  ${i + 1}. ${qc.type}  (${(qc.duration / 1000).toFixed(1)}s)`, TX + 8, TY + 79 + i * 13)
        })

        // Cancel hint
        ctx.fillStyle = 'rgba(0,150,220,0.35)'
        ctx.fillText('[ PRESS ANY KEY TO CANCEL ]', TX + 8, TY + TH - 10)
        ctx.restore()
      }

      // Dead flash
      if (g.state === 'dead') {
        ctx.fillStyle = 'rgba(239,68,68,0.25)'
        ctx.fillRect(LABEL_LEFT, LABEL_TOP, gameW, gameH)
      }

      // ── Dev Mode overlay ──
      if (devModeRef.current) {
        const pw2 = TILE * 0.75
        const ph2 = TILE * 0.9

        // Tile hitboxes
        ctx.save()
        ctx.setLineDash([3, 3])
        ctx.lineWidth = 1
        for (let r = startRow; r <= endRow; r++) {
          for (let c = startCol; c <= endCol; c++) {
            const t = getTile(grid, r, c)
            if (t === 0) continue
            const tx = LABEL_LEFT + c * TILE - camX
            const ty = LABEL_TOP  + r * TILE - camY
            if (t === 1 || t === 'T') { ctx.strokeStyle = '#00ff41'; ctx.strokeRect(tx + 0.5, ty + 0.5, TILE - 1, TILE - 1) }
            else if (t === 'S')       { ctx.strokeStyle = '#ff4444'; ctx.strokeRect(tx + 0.5, ty + 0.5, TILE - 1, TILE - 1) }
            else if (t === 'G')       { ctx.strokeStyle = '#22c55e'; ctx.strokeRect(tx + 0.5, ty + 0.5, TILE - 1, TILE - 1) }
          }
        }
        ctx.setLineDash([])
        ctx.restore()

        // Player hitbox + velocity arrow + label
        if (g.state === 'playing') {
          const sx = LABEL_LEFT + g.px - camX
          const sy = LABEL_TOP  + g.py - camY

          // Hitbox
          ctx.save()
          ctx.strokeStyle = '#ff9900'
          ctx.lineWidth = 2
          ctx.strokeRect(sx, sy, pw2, ph2)

          // Velocity arrow
          const cx2 = sx + pw2 / 2
          const cy2 = sy + ph2 / 2
          const scale = 0.08
          const ex = cx2 + g.pvx * scale
          const ey = cy2 + g.pvy * scale
          const len = Math.hypot(ex - cx2, ey - cy2)
          ctx.strokeStyle = '#ff9900'
          ctx.lineWidth = 2
          ctx.beginPath()
          ctx.moveTo(cx2, cy2)
          ctx.lineTo(ex, ey)
          if (len > 4) {
            const ang = Math.atan2(ey - cy2, ex - cx2)
            ctx.lineTo(ex - 7 * Math.cos(ang - 0.4), ey - 7 * Math.sin(ang - 0.4))
            ctx.moveTo(ex, ey)
            ctx.lineTo(ex - 7 * Math.cos(ang + 0.4), ey - 7 * Math.sin(ang + 0.4))
          }
          ctx.stroke()

          // State label
          const col2 = Math.round(g.px / TILE)
          const row2 = Math.round(g.py / TILE)
          const pState = g.onGround ? 'GROUNDED' : (g.pvy < 0 ? 'JUMPING' : 'FALLING')
          const displayVy = g.onGround ? 0 : Math.round(g.pvy)
          const labelX = sx
          const labelY = sy - 34
          ctx.fillStyle = 'rgba(0,0,0,0.75)'
          ctx.fillRect(labelX, labelY, 136, 30)
          ctx.fillStyle = '#00ff41'
          ctx.font = '9px monospace'
          ctx.textAlign = 'left'
          ctx.textBaseline = 'top'
          ctx.fillText(`[col:${col2} row:${row2}]  vx:${Math.round(g.pvx)}`, labelX + 3, labelY + 3)
          ctx.fillText(`vy:${displayVy}  ${pState}`, labelX + 3, labelY + 15)
          ctx.restore()
        }
      }

      ctx.restore() // end clip

      // Level border
      ctx.strokeStyle = c_border
      ctx.lineWidth = 1
      ctx.strokeRect(LABEL_LEFT, LABEL_TOP, gameW, gameH)

      // ── Coordinate labels ──
      ctx.fillStyle = c_coords
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
          body: JSON.stringify({ grid: levelData.data, physicsParams: verifyPhysRef.current, deathPositions: simDeathsRef.current }),
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
    // Mouse movement exits simulate mode
    if (simulateModeRef.current) { setSimulateMode(false); return }
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
      <div className="min-h-dvh flex flex-col items-center justify-center px-6" style={{ background: 'var(--bg-base)' }}>
        <div className="text-6xl mb-4">🗺️</div>
        <h2 className="text-2xl font-bold mb-3" style={{ color: 'var(--text-base)' }}>Level not found</h2>
        <p className="text-stone-400 mb-8 text-center max-w-sm">{loadError}</p>
        <button onClick={() => navigate('/')} className="px-8 py-4 bg-orange-500 hover:bg-orange-600 text-white font-bold rounded-2xl transition-colors text-lg">
          Draw a New Level
        </button>
      </div>
    )
  }

  if (!levelData) {
    return (
      <div className="min-h-dvh flex items-center justify-center" style={{ background: 'var(--bg-base)' }}>
        <div className="text-lg animate-pulse" style={{ color: 'var(--text-base)' }}>Loading level...</div>
      </div>
    )
  }

  return (
    <div className="flex h-dvh overflow-hidden" style={{ background: 'var(--bg-base)' }}>

      {/* ── Physics Sidebar ── */}
      <div className={`flex-shrink-0 flex flex-col overflow-hidden transition-all duration-300 ${physPanelOpen ? 'w-52' : 'w-0'}`}>
      <div
        className={`w-52 flex-shrink-0 flex flex-col p-4 gap-4 overflow-y-auto h-full transition-colors duration-300 ${
          isDevMode ? 'bg-[#060d06] border-r border-[#00ff41]/30' : 'border-r'
        }`}
        style={isDevMode ? {} : { background: 'var(--bg-primary)', borderColor: 'var(--border-ui)' }}
      >
        <p
          className={`text-[10px] font-bold tracking-widest uppercase border-b pb-2 font-mono ${
            isDevMode ? 'text-[#00ff41] border-[#00ff41]/30' : 'text-orange-400'
          }`}
          style={isDevMode ? {} : { borderColor: 'var(--border-ui)' }}
        >
          {isDevMode ? '> PHYSICS_SYS' : 'Physics Tuner'}
        </p>
        <div className={`flex flex-col gap-4 ${isDevMode ? '[&_span]:font-mono [&_span]:text-[#00ff41]' : ''}`}>
          <SliderRow label={isDevMode ? 'gravity'       : 'Gravity'}       min={400}  max={4000} step={100}  decimals={0} value={phys.gravity}      onChange={v => setPhysParam('gravity',      v)} />
          <SliderRow label={isDevMode ? 'jump_force'    : 'Jump Strength'} min={100}  max={1400} step={50}   decimals={0} value={phys.jumpStrength} onChange={v => setPhysParam('jumpStrength', v)} />
          <SliderRow label={isDevMode ? 'player_speed'  : 'Move Speed'}    min={50}   max={800}  step={10}   decimals={0} value={phys.moveSpeed}    onChange={v => setPhysParam('moveSpeed',    v)} />
          <SliderRow label={isDevMode ? 'friction'      : 'Friction'}      min={0.10} max={1.00} step={0.05} decimals={2} value={phys.friction}     onChange={v => setPhysParam('friction',     v)} />
          <SliderRow label={isDevMode ? 'max_fall'      : 'Max Fall'}      min={200}  max={3000} step={100}  decimals={0} value={phys.maxFall}      onChange={v => setPhysParam('maxFall',      v)} />
        </div>
        {isDevMode && (
          <div className="bg-[#0a1a0a] border border-[#00ff41]/20 rounded-lg p-2 font-mono text-[9px] text-[#00ff41]/70 space-y-0.5">
            <p>grav: {phys.gravity} px/s²</p>
            <p>jump: {phys.jumpStrength} px/s</p>
            <p>spd:  {phys.moveSpeed} px/s</p>
            <p>fric: {phys.friction.toFixed(2)}</p>
          </div>
        )}
        <button
          onClick={handleUpdateAnalysis}
          disabled={k2Phase === 'thinking'}
          className={`mt-auto py-3 px-4 font-bold text-xs tracking-widest uppercase rounded-xl transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
            isDevMode
              ? 'bg-[#0a1f0a] border border-[#00ff41]/50 text-[#00ff41] hover:bg-[#0f2f0f] font-mono'
              : 'bg-orange-500/15 border border-orange-500/40 text-orange-400 hover:bg-orange-500/25'
          }`}
        >
          {isDevMode ? '> RUN_ANALYSIS' : '⚙ Update Analysis'}
        </button>
      </div>
      </div>

      {/* ── Main column ── */}
      <div className="flex flex-col flex-1 overflow-hidden">

        {/* Top bar */}
        <div className="flex items-center gap-3 px-4 py-2 border-b flex-shrink-0" style={{ background: 'var(--bg-topbar)', borderColor: 'var(--border-ui)' }}>
          <button onClick={() => navigate('/')} aria-label="Go home"
            className="p-2 rounded-lg text-stone-400 hover:bg-white/10 transition-colors"
            style={{ color: 'var(--text-muted)' }}
          >
            <Home size={18} />
          </button>
          <h1 className="text-sm font-bold truncate flex-1" style={{ color: 'var(--text-base)' }}>{levelData.title || 'Your Level'}</h1>
          <div className="flex items-center gap-0.5" aria-label={`Difficulty: ${difficulty} out of 5 stars`}>
            {Array.from({ length: 5 }, (_, i) => (
              <Star key={i} size={14} className={i < difficulty ? 'text-amber-400 fill-amber-400' : 'text-stone-600'} />
            ))}
          </div>
          {levelData.data?.flat().some(t => t === 'C') && (
            <span className="text-amber-400 text-sm font-bold">🪙 {score}</span>
          )}
          <button
            onClick={() => setSimulateMode(s => !s)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-mono text-xs font-bold tracking-tight transition-all border ${
              simulateMode
                ? 'bg-[#001a2e] border-[#00aaff] text-[#00d4ff] shadow-[0_0_10px_#00aaff44]'
                : 'bg-[#111] border-stone-700 text-stone-500 hover:text-stone-300 hover:border-stone-500'
            }`}
          >
            <Cpu size={12} />
            {simulateMode ? 'AUTO: ON_' : 'AUTO'}
          </button>
          <button
            onClick={() => setIsDevMode(d => !d)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-mono text-xs font-bold tracking-tight transition-all border ${
              isDevMode
                ? 'bg-[#0a1f0a] border-[#00ff41] text-[#00ff41] shadow-[0_0_10px_#00ff4144]'
                : 'bg-[#111] border-stone-700 text-stone-500 hover:text-stone-300 hover:border-stone-500'
            }`}
          >
            {isDevMode ? '> DEV: ON_' : '> DEV'}
          </button>
          <button onClick={handleShare} aria-label="Share this level"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 transition-colors text-sm font-medium"
            style={{ color: 'var(--text-secondary)' }}
          >
            <Share2 size={14} /> Share
          </button>
          <button onClick={() => navigate('/')} aria-label="Create a new level"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-orange-500/20 text-orange-400 hover:bg-orange-500/30 hover:text-orange-300 transition-colors text-sm font-medium">
            <RefreshCw size={14} /> New Level
          </button>
          <ThemeToggle />
        </div>

        {/* HUD */}
        <div className="text-center text-[11px] py-1 flex-shrink-0" style={{ color: 'var(--text-muted)' }}>
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
                  className="fixed z-50 pointer-events-none border border-[#7aa2f7] rounded-xl
                             px-3 py-2 max-w-[220px] shadow-xl"
                  style={{ background: 'var(--bg-tooltip)', left: tooltipPos.x + 14, top: tooltipPos.y - 10 }}
                >
                  <p className="text-[11px] font-bold mb-1" style={{ color: 'var(--text-base)' }}>{hoveredSuggestion.problem}</p>
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
                    className="rounded-3xl p-10 text-center shadow-2xl max-w-sm mx-4"
                    style={{ background: 'var(--bg-card)', border: '1px solid var(--border-ui)' }}
                  >
                    <div className="text-6xl mb-4">🎉</div>
                    <h2 className="text-3xl font-black mb-2" style={{ color: 'var(--text-base)' }}>You Win!</h2>
                    <p className="text-stone-400 mb-1">Time: <span className="font-bold" style={{ color: 'var(--text-base)' }}>{winTime.toFixed(1)}s</span></p>
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
                        className="px-6 py-3 bg-white/10 hover:bg-white/20 font-semibold rounded-2xl transition-colors flex items-center justify-center gap-2"
                        style={{ color: 'var(--text-secondary)' }}
                      >
                        <Share2 size={16} /> Share This Level
                      </button>
                      <button onClick={() => navigate('/')}
                        className="px-6 py-3 text-stone-400 font-medium transition-colors text-sm hover:text-orange-400">
                        Draw a New Level
                      </button>
                    </div>
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* K2 Analysis Panel */}
          <div
            className={`flex flex-col border-l transition-all duration-300 overflow-hidden flex-shrink-0 ${panelOpen ? 'w-72' : 'w-0'}`}
            style={{ background: 'var(--bg-primary)', borderColor: 'var(--border-ui)' }}
          >
            <div className="flex items-center gap-2 px-3 py-2 border-b flex-shrink-0" style={{ borderColor: 'var(--border-ui)' }}>
              <Brain size={14} style={{ color: 'var(--k2-label)' }} />
              <span className="text-xs font-bold uppercase tracking-widest flex-1" style={{ color: 'var(--k2-heading)' }}>K2 Analysis</span>
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
                  <p className="text-[10px] font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--k2-label)' }}>Reasoning</p>
                  <div ref={thinkScrollRef} className="rounded-lg p-2 max-h-40 overflow-y-auto font-mono text-[10px] leading-relaxed whitespace-pre-wrap" style={{ background: 'var(--bg-subtle)', color: 'var(--k2-mono)' }}>
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
                    <span className="font-bold text-sm" style={{ color: k2Result.solvable ? 'var(--k2-win)' : 'var(--k2-lose)' }}>
                      {k2Result.solvable ? 'Beatable!' : 'Not Beatable'}
                    </span>
                  </div>

                  {k2Result.kid_summary && (
                    <p className="leading-relaxed italic" style={{ color: 'var(--text-secondary)' }}>"{k2Result.kid_summary}"</p>
                  )}

                  {k2Result.design_suggestions?.length > 0 && (
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-widest mb-1.5 flex items-center gap-1" style={{ color: 'var(--k2-tip-label)' }}>
                        <Lightbulb size={10} /> Tips <span className="normal-case" style={{ color: 'var(--k2-body)' }}>(hover ? on canvas)</span>
                      </p>
                      <div className="space-y-1.5">
                        {k2Result.design_suggestions.map((s, i) => (
                          <div key={i} className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-2">
                            <p className="font-bold text-[11px]" style={{ color: 'var(--k2-tip-title)' }}>{s.problem}</p>
                            <p className="text-[10px] mt-0.5 leading-relaxed" style={{ color: 'var(--k2-body)' }}>{s.suggestion}</p>
                            <p className="text-[9px] mt-0.5" style={{ color: 'var(--k2-tip-pos)' }}>col {s.x}, row {s.y}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {k2Result.bottlenecks?.length > 0 && (
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-widest mb-1.5 flex items-center gap-1" style={{ color: 'var(--k2-hard-label)' }}>
                        <AlertTriangle size={10} /> Hard Spots
                      </p>
                      <div className="space-y-1.5">
                        {k2Result.bottlenecks.map((b, i) => (
                          <div key={i} className="bg-red-500/10 border border-red-500/20 rounded-lg p-2">
                            <p className="text-[10px] leading-relaxed" style={{ color: 'var(--k2-body)' }}>{b.reason}</p>
                            <p className="text-[9px] mt-0.5" style={{ color: 'var(--k2-hard-pos)' }}>col {b.x}, row {b.y}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}

              {k2Phase === 'error' && (
                <div className="space-y-3">
                  <div className="rounded-xl p-4 text-center" style={{ background: 'var(--bg-subtle)' }}>
                    <div className="text-3xl mb-2">🤔</div>
                    <p className="font-semibold text-sm mb-1" style={{ color: 'var(--k2-error-title)' }}>K2 is thinking elsewhere</p>
                    <p className="text-[10px] leading-relaxed" style={{ color: 'var(--k2-body)' }}>The AI reasoning engine isn't connected yet — but the level is still fully playable!</p>
                  </div>
                </div>
              )}

              {k2Phase === 'idle' && <p className="text-stone-600 text-center pt-4">Waiting…</p>}
            </div>
          </div>

          {/* Left panel toggle */}
          <button
            onClick={() => setPhysPanelOpen(o => !o)}
            className="absolute top-1/2 -translate-y-1/2 z-10 w-5 h-10 rounded-r-lg flex items-center justify-center text-stone-400 hover:text-white transition-colors"
            style={{ left: '0px', transition: 'left 0.3s', background: 'var(--bg-subtle)', border: '1px solid var(--border-ui)' }}
          >
            {physPanelOpen ? <ChevronLeft size={12} /> : <ChevronRight size={12} />}
          </button>

          {/* Right panel toggle */}
          <button
            onClick={() => setPanelOpen(o => !o)}
            className="absolute top-1/2 -translate-y-1/2 z-10 w-5 h-10 rounded-l-lg flex items-center justify-center text-stone-400 hover:text-white transition-colors"
            style={{ right: panelOpen ? '288px' : '0px', transition: 'right 0.3s', background: 'var(--bg-subtle)', border: '1px solid var(--border-ui)' }}
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
