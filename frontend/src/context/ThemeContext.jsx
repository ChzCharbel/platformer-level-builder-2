import { createContext, useContext, useEffect, useState } from 'react'

const ThemeContext = createContext(null)

function resolveTheme(pref) {
  if (pref === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return pref
}

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(
    () => localStorage.getItem('theme-preference') || 'system'
  )

  useEffect(() => {
    function apply() {
      document.documentElement.dataset.theme = resolveTheme(theme)
    }
    apply()
    if (theme !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [theme])

  function setTheme(pref) {
    localStorage.setItem('theme-preference', pref)
    setThemeState(pref)
  }

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  return useContext(ThemeContext)
}
