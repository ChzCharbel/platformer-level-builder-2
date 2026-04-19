import { useState, useRef, useCallback, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Upload as UploadIcon, Camera, X, AlertCircle } from 'lucide-react'
import SplitText from '../components/bits/SplitText'
import Aurora from '../components/bits/Aurora'
import StarBorder from '../components/bits/StarBorder'
import ThemeToggle from '../components/bits/ThemeToggle'

const MAX_SIZE = 10 * 1024 * 1024 // 10 MB

// Hand-drawn SVG symbols for the legend
const LEGEND = [
  {
    symbol: 'cube',
    label: 'Tile / Platform',
    hint: 'Shaded cube',
    color: '#a8956a',
    svg: (
      <>
        <rect x="3" y="9" width="22" height="18" rx="2" fill="#c4ab82" stroke="#a8956a" strokeWidth="2" />
        <rect x="3" y="9" width="22" height="5" rx="2" fill="#d6c090" stroke="#a8956a" strokeWidth="2" />
        <polygon points="3,9 9,4 31,4 25,9" fill="#e2cfaa" stroke="#a8956a" strokeWidth="2" strokeLinejoin="round" />
      </>
    ),
  },
  {
    symbol: 'triangle',
    label: 'Spike / Hazard',
    hint: 'Triangle',
    color: '#ef4444',
    svg: (
      <polygon points="16,4 28,28 4,28"
        stroke="#ef4444" strokeWidth="2.5" fill="#fecaca" strokeLinejoin="round" />
    ),
  },
  {
    symbol: 'circle',
    label: 'Spawn Point',
    hint: 'Circle',
    color: '#3b82f6',
    svg: (
      <>
        <circle cx="16" cy="16" r="11" stroke="#3b82f6" strokeWidth="2.5" fill="#dbeafe" />
        <text x="16" y="21" fontSize="12" textAnchor="middle" fill="#3b82f6" fontFamily="monospace" fontWeight="bold">P</text>
      </>
    ),
  },
  {
    symbol: 'star',
    label: 'Finish / Goal',
    hint: 'Star',
    color: '#22c55e',
    svg: (
      <text x="16" y="23" fontSize="22" textAnchor="middle"
        fill="#22c55e" fontFamily="sans-serif">★</text>
    ),
  },
]

function LegendCard({ label, hint, svg }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col items-center gap-2 p-3 rounded-xl backdrop-blur-sm
                 border shadow-sm min-w-[80px] flex-1"
      style={{ background: 'var(--bg-glass)', borderColor: 'var(--border-ui)' }}
    >
      <svg width="32" height="32" viewBox="0 0 32 32" aria-hidden="true">
        {svg}
      </svg>
      <span className="text-xs font-bold text-center leading-tight" style={{ color: 'var(--text-secondary)' }}>{label}</span>
      <span className="text-[11px] text-center" style={{ color: 'var(--text-muted)' }}>Draw a {hint}</span>
    </motion.div>
  )
}

function CameraModal({ onCapture, onClose }) {
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const canvasRef = useRef(null)

  useEffect(() => {
    navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1920 } },
      audio: false,
    }).then(stream => {
      streamRef.current = stream
      if (videoRef.current) videoRef.current.srcObject = stream
    }).catch(err => {
      alert('Could not access camera: ' + err.message)
      onClose()
    })
    return () => {
      streamRef.current?.getTracks().forEach(t => t.stop())
    }
  }, [onClose])

  const snap = () => {
    const video = videoRef.current
    const canvas = canvasRef.current
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    canvas.getContext('2d').drawImage(video, 0, 0)
    canvas.toBlob(blob => {
      const f = new File([blob], 'camera-snap.jpg', { type: 'image/jpeg' })
      streamRef.current?.getTracks().forEach(t => t.stop())
      onCapture(f)
    }, 'image/jpeg', 0.92)
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black"
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="w-full h-full object-cover"
      />
      <canvas ref={canvasRef} className="hidden" />
      <div className="absolute bottom-10 flex gap-6">
        <button
          onClick={snap}
          className="w-16 h-16 rounded-full bg-white border-4 border-orange-400 shadow-xl
                     hover:scale-110 transition-transform"
          aria-label="Take photo"
        />
        <button
          onClick={onClose}
          className="w-16 h-16 rounded-full bg-stone-800/80 flex items-center justify-center
                     hover:bg-stone-700 transition-colors"
          aria-label="Cancel"
        >
          <X size={28} className="text-white" />
        </button>
      </div>
    </motion.div>
  )
}

export default function Upload() {
  const navigate = useNavigate()
  const inputRef = useRef(null)
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [dragOver, setDragOver] = useState(false)
  const [error, setError] = useState(null)
  const [cameraOpen, setCameraOpen] = useState(false)

  const validateAndSet = useCallback((f) => {
    setError(null)
    if (!f.type.startsWith('image/')) {
      setError('Please upload an image file (JPG, PNG, HEIC, etc.)')
      return
    }
    if (f.size > MAX_SIZE) {
      setError('Image is too large. Max size is 10 MB.')
      return
    }
    if (preview) URL.revokeObjectURL(preview)
    setFile(f)
    setPreview(URL.createObjectURL(f))
  }, [preview])

  const onDrop = (e) => {
    e.preventDefault()
    setDragOver(false)
    const f = e.dataTransfer.files[0]
    if (f) validateAndSet(f)
  }

  const onFileChange = (e) => {
    const f = e.target.files[0]
    if (f) validateAndSet(f)
    e.target.value = ''
  }

  const clearFile = (e) => {
    e.stopPropagation()
    if (preview) URL.revokeObjectURL(preview)
    setFile(null)
    setPreview(null)
    setError(null)
  }

  const handleGenerate = () => {
    if (!file) return
    navigate('/processing', { state: { file, fileName: file.name } })
  }

  const handleDemo = () => {
    const E = '', T = 'T', S = 'S', P = 'P', G = 'G', C = 'C'
    const demoLevel = {
      data: [
        [E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E],
        [E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E],
        [E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,T,T,G,E],
        [E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E],
        [E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,T,T,T,E,E,E,E,E],
        [E,E,E,E,E,E,E,E,E,E,E,E,E,E,C,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E],
        [E,E,E,E,E,E,E,E,E,E,E,E,E,T,T,T,E,E,E,E,T,T,E,E,E,E,E,E,E,E],
        [E,E,E,E,E,E,E,E,E,E,C,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E],
        [E,E,E,E,E,E,E,E,T,T,T,T,E,E,E,E,E,T,T,T,E,E,E,E,E,E,E,E,E,E],
        [E,E,E,E,C,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E],
        [E,E,T,T,T,T,T,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E],
        [E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E],
        [P,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E,E],
        [T,T,T,T,S,T,T,T,S,T,T,S,S,T,T,T,S,T,T,T,T,S,T,T,T,T,T,T,T,T],
        [T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T],
      ]
    }
    localStorage.setItem('level_demo', JSON.stringify(demoLevel))
    navigate('/play/demo')
  }

  const handleCameraCapture = useCallback((f) => {
    setCameraOpen(false)
    validateAndSet(f)
  }, [validateAndSet])

  return (
    <>
    <AnimatePresence>
      {cameraOpen && (
        <CameraModal
          onCapture={handleCameraCapture}
          onClose={() => setCameraOpen(false)}
        />
      )}
    </AnimatePresence>
    <div className="relative min-h-dvh flex flex-col items-center justify-center px-4 py-12 overflow-hidden">
      <Aurora />

      {/* Theme toggle – top-right corner */}
      <div className="absolute top-4 right-4 z-20">
        <ThemeToggle />
      </div>

      {/* Hero */}
      <div className="relative z-10 text-center max-w-2xl w-full">
        <h1 className="text-5xl sm:text-6xl font-black leading-tight mb-4 tracking-tight" style={{ color: 'var(--text-base)' }}>
          <SplitText text="Sketch a Level." className="block" />
          <span className="block text-orange-500">
            <SplitText text="Play It." />
          </span>
        </h1>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.6 }}
          className="text-lg sm:text-xl mb-10"
          style={{ color: 'var(--text-secondary)' }}
        >
          Draw a platformer on grid paper. Take a photo. Watch it come alive.
        </motion.p>

        {/* Legend */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.7 }}
          className="mb-8"
        >
          <p className="text-sm font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--text-muted)' }}>
            What to draw on your grid paper
          </p>
          <p className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>Use these symbols so the AI knows what each cell means</p>
          <div className="flex flex-wrap justify-center gap-3">
            {LEGEND.map((item, i) => (
              <motion.div
                key={item.symbol}
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.8 + i * 0.07 }}
              >
                <LegendCard {...item} />
              </motion.div>
            ))}
          </div>
        </motion.div>

        {/* Two input options */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.9 }}
          className="relative"
        >
          <AnimatePresence mode="wait">
            {!preview ? (
              <motion.div
                key="options"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="grid grid-cols-2 gap-4"
              >
                {/* Upload option */}
                <div
                  role="button"
                  tabIndex={0}
                  aria-label="Upload an image from your device"
                  onClick={() => inputRef.current?.click()}
                  onKeyDown={(e) => e.key === 'Enter' && inputRef.current?.click()}
                  onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={onDrop}
                  className="flex flex-col items-center justify-center gap-3 p-8 rounded-3xl
                             border-2 border-dashed cursor-pointer transition-all duration-200
                             backdrop-blur-sm shadow-lg"
                  style={{
                    background: dragOver ? 'var(--bg-glass-drag)' : 'var(--bg-glass)',
                    borderColor: dragOver ? '#f97316' : 'var(--border-ui)',
                    transform: dragOver ? 'scale(1.02)' : undefined,
                  }}
                >
                  <div className="w-14 h-14 rounded-2xl bg-orange-100 flex items-center justify-center">
                    <UploadIcon size={26} className="text-orange-500" />
                  </div>
                  <div className="text-center">
                    <p className="font-bold text-base" style={{ color: 'var(--text-secondary)' }}>Upload</p>
                    <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>Browse or drag a photo</p>
                  </div>
                </div>

                {/* Camera option */}
                <div
                  role="button"
                  tabIndex={0}
                  aria-label="Take a photo with your camera"
                  onClick={() => setCameraOpen(true)}
                  onKeyDown={(e) => e.key === 'Enter' && setCameraOpen(true)}
                  className="flex flex-col items-center justify-center gap-3 p-8 rounded-3xl
                             border-2 border-dashed cursor-pointer transition-all duration-200
                             backdrop-blur-sm shadow-lg hover:scale-[1.02]"
                  style={{
                    background: 'var(--bg-glass)',
                    borderColor: 'var(--border-ui)',
                  }}
                >
                  <div className="w-14 h-14 rounded-2xl bg-sky-100 flex items-center justify-center">
                    <Camera size={26} className="text-sky-500" />
                  </div>
                  <div className="text-center">
                    <p className="font-bold text-base" style={{ color: 'var(--text-secondary)' }}>Camera</p>
                    <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>Take a photo now</p>
                  </div>
                </div>
              </motion.div>
            ) : (
              /* Preview */
              <motion.div
                key="preview"
                initial={{ opacity: 0, scale: 0.97 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                className="relative rounded-3xl border-2 border-orange-300 backdrop-blur-sm shadow-xl overflow-hidden"
                style={{ background: 'var(--bg-glass-hover)' }}
              >
                <img
                  src={preview}
                  alt="Your sketch preview"
                  className="w-full max-h-72 object-contain p-4"
                />
                <button
                  onClick={clearFile}
                  aria-label="Remove image and choose again"
                  className="absolute top-3 right-3 p-1.5 rounded-full bg-stone-800/70 text-white
                             hover:bg-stone-800 transition-colors"
                >
                  <X size={16} />
                </button>
                <p className="text-sm pb-3 px-4 truncate" style={{ color: 'var(--text-muted)' }}>{file?.name}</p>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Hidden file input */}
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            className="sr-only"
            aria-hidden="true"
            onChange={onFileChange}
          />

          {/* Error */}
          <AnimatePresence>
            {error && (
              <motion.div
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                role="alert"
                className="mt-3 flex items-center gap-2 px-4 py-3 rounded-xl
                           bg-red-500/10 border border-red-500/30 text-red-400 text-sm"
              >
                <AlertCircle size={16} className="flex-shrink-0" />
                {error}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Generate button */}
          <AnimatePresence>
            {file && !error && (
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 12 }}
                className="mt-6"
              >
                <StarBorder onClick={handleGenerate} className="w-full text-xl py-5">
                  ✨ Generate Level
                </StarBorder>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Demo button */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1.1 }}
            className="mt-6 text-center"
          >
            <button
              onClick={handleDemo}
              className="text-sm hover:text-orange-500 underline underline-offset-4 transition-colors"
              style={{ color: 'var(--text-muted)' }}
            >
              🎮 Try a demo level instead
            </button>
          </motion.div>
        </motion.div>
      </div>
    </div>
    </>
  )
}
