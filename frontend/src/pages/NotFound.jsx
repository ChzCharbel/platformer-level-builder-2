import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import ThemeToggle from '../components/bits/ThemeToggle'

export default function NotFound() {
  const navigate = useNavigate()
  return (
    <div className="relative min-h-dvh flex flex-col items-center justify-center px-6" style={{ background: 'var(--bg-base)' }}>
      <div className="absolute top-4 right-4 z-20">
        <ThemeToggle />
      </div>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center"
      >
        <div className="text-8xl mb-6">🗺️</div>
        <h1 className="text-4xl font-black mb-3" style={{ color: 'var(--text-base)' }}>Page Not Found</h1>
        <p className="mb-8 max-w-xs" style={{ color: 'var(--text-muted)' }}>
          This level or page does not exist. Head back and sketch something new.
        </p>
        <button
          onClick={() => navigate('/')}
          className="px-8 py-4 bg-orange-500 hover:bg-orange-600 text-white font-bold rounded-2xl
                     transition-colors text-lg shadow-lg shadow-orange-200/40"
        >
          Back to Upload
        </button>
      </motion.div>
    </div>
  )
}
