import { Sun, Moon, Monitor } from 'lucide-react'
import { useTheme } from '../../context/ThemeContext'

const OPTIONS = [
  { value: 'light',  label: 'Light',  Icon: Sun },
  { value: 'dark',   label: 'Dark',   Icon: Moon },
  { value: 'system', label: 'System', Icon: Monitor },
]

export default function ThemeToggle({ className = '' }) {
  const { theme, setTheme } = useTheme()
  return (
    <div
      role="group"
      aria-label="Color theme"
      className={`flex items-center rounded-lg overflow-hidden border border-[var(--border-ui)] ${className}`}
    >
      {OPTIONS.map(({ value, label, Icon }) => (
        <button
          key={value}
          onClick={() => setTheme(value)}
          title={label}
          aria-label={`${label} theme`}
          aria-pressed={theme === value}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold transition-colors ${
            theme === value
              ? 'bg-orange-500 text-white'
              : 'text-[var(--text-muted)] hover:bg-[var(--bg-subtle)] hover:text-[var(--text-base)]'
          }`}
        >
          <Icon size={12} />
          <span className="hidden sm:inline">{label}</span>
        </button>
      ))}
    </div>
  )
}
