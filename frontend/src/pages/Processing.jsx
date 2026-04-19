import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import ThemeToggle from '../components/bits/ThemeToggle'

const API = import.meta.env.VITE_API_URL || ''

const MESSAGES = [
  'Reading your sketch...',
  'Detecting platforms...',
  'Placing spikes and coins...',
  'Teaching the level to jump...',
  'Almost there...',
]

function useRotatingText(items, interval = 1800) {
  const [index, setIndex] = useState(0)
  useEffect(() => {
    const id = setInterval(() => {
      setIndex((i) => (i + 1) % items.length)
    }, interval)
    return () => clearInterval(id)
  }, [items, interval])
  return items[index]
}

// Skeleton grid that "forms" while waiting
function SkeletonLevel() {
  const cols = 18
  const rows = 10
  const platforms = [
    [8,9],[9,9],[10,9],[11,9],[12,9],[13,9],[14,9],[15,9],[16,9],[17,9],
    [0,9],[1,9],[2,9],[3,9],[4,9],[5,9],[6,9],[7,9],
    [2,6],[3,6],[4,6],[5,6],
    [10,6],[11,6],[12,6],
    [6,3],[7,3],[8,3],
    [14,3],[15,3],
  ]
  const tileSet = new Set(platforms.map(([c, r]) => `${c},${r}`))

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 0.8 }}
      className="mt-10 rounded-2xl overflow-hidden shadow-inner"
      style={{ width: cols * 20, maxWidth: '100%', border: '1px solid var(--border-ui)' }}
      aria-hidden="true"
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${cols}, 20px)`,
          gridTemplateRows: `repeat(${rows}, 20px)`,
          gap: 1,
          background: 'var(--bg-card)',
          padding: 4,
        }}
      >
        {Array.from({ length: rows }, (_, r) =>
          Array.from({ length: cols }, (_, c) => {
            const key = `${c},${r}`
            const isPlatform = tileSet.has(key)
            return (
              <motion.div
                key={key}
                initial={{ opacity: 0, scale: 0.5 }}
                animate={{
                  opacity: isPlatform ? 1 : 0.08,
                  scale: 1,
                  background: isPlatform ? '#f97316' : '#4a4560',
                }}
                transition={{
                  delay: (c + r * cols) * 0.003,
                  type: 'spring',
                  stiffness: 200,
                  damping: 20,
                }}
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: 3,
                }}
              />
            )
          })
        )}
      </div>
    </motion.div>
  )
}

export default function Processing() {
  const { state } = useLocation()
  const navigate = useNavigate()
  const currentMessage = useRotatingText(MESSAGES)
  const [elapsed, setElapsed] = useState(0)
  const [uploadError, setUploadError] = useState(null)
  const didUpload = useRef(false)

  useEffect(() => {
    if (!state?.file) {
      navigate('/', { replace: true })
    }
  }, [state, navigate])

  useEffect(() => {
    const id = setInterval(() => setElapsed((e) => e + 1), 1000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    if (!state?.file || didUpload.current) return
    didUpload.current = true

    async function upload() {
      const form = new FormData()
      form.append('image', state.file)

      try {
        let res
        try {
          res = await fetch(`${API}/upload`, { method: 'POST', body: form })
        } catch {
          throw new Error('Cannot reach the backend. Make sure the server is running on port 3000.')
        }
        const text = await res.text()
        if (!text) throw new Error('Backend returned an empty response. Check that the server is running.')
        let json
        try { json = JSON.parse(text) } catch {
          throw new Error('Backend returned invalid JSON. Check the server logs.')
        }
        if (!res.ok) throw new Error(json.error || 'Upload failed')
        if (!json.data || !Array.isArray(json.data)) {
          throw new Error('The AI could not read a level from that image. Try a clearer photo.')
        }
        if (json.data.flat().every((t) => t === 0)) {
          throw new Error('The level appears to be empty. Make sure your sketch has clear symbols.')
        }

        const id = Math.random().toString(36).slice(2, 8)
        localStorage.setItem(`level_${id}`, JSON.stringify(json))
        navigate(`/play/${id}`, { replace: true })
      } catch (err) {
        setUploadError(err.message)
      }
    }

    upload()
  }, [state, navigate])

  if (uploadError) {
    return (
      <div className="relative min-h-dvh flex flex-col items-center justify-center px-6" style={{ background: 'var(--bg-base)' }}>
        <div className="absolute top-4 right-4 z-20">
          <ThemeToggle />
        </div>
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="max-w-md w-full text-center"
        >
          <div className="text-6xl mb-4">😬</div>
          <h2 className="text-2xl font-bold mb-3" style={{ color: 'var(--text-base)' }}>Something went wrong</h2>
          <p className="mb-8" style={{ color: 'var(--text-muted)' }}>{uploadError}</p>
          <button
            onClick={() => navigate('/')}
            className="px-8 py-4 bg-orange-500 hover:bg-orange-600 text-white font-bold rounded-2xl
                       transition-colors text-lg"
          >
            Try Again
          </button>
        </motion.div>
      </div>
    )
  }

  return (
    <div className="relative min-h-dvh flex flex-col items-center justify-center px-6" style={{ background: 'var(--bg-base)' }}>
      <div className="absolute top-4 right-4 z-20">
        <ThemeToggle />
      </div>

      {/* Spinner ring */}
      <motion.div
        initial={{ opacity: 0, scale: 0.7 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ type: 'spring', stiffness: 200, damping: 18 }}
        className="relative w-24 h-24 mb-8"
      >
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 1.2, repeat: Infinity, ease: 'linear' }}
          className="absolute inset-0 rounded-full border-4 border-transparent border-t-orange-500"
        />
        <motion.div
          animate={{ rotate: -360 }}
          transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
          className="absolute inset-2 rounded-full border-4 border-transparent border-t-amber-400"
        />
        <div className="absolute inset-0 flex items-center justify-center text-3xl">✏️</div>
      </motion.div>

      {/* Rotating status message */}
      <div className="h-8 relative overflow-hidden">
        <AnimatePresence mode="wait">
          <motion.p
            key={currentMessage}
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -20, opacity: 0 }}
            transition={{ duration: 0.35 }}
            className="text-xl font-semibold text-center"
            style={{ color: 'var(--text-base)' }}
          >
            {currentMessage}
          </motion.p>
        </AnimatePresence>
      </div>

      <p className="text-sm mt-3" style={{ color: 'var(--text-muted)' }}>
        {elapsed < 5
          ? 'AI is analyzing your sketch...'
          : elapsed < 12
            ? 'This usually takes 10-20 seconds...'
            : 'Hang tight, the AI is thinking hard...'}
      </p>

      {elapsed >= 8 && <SkeletonLevel />}
    </div>
  )
}
