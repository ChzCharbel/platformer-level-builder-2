import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { ThemeProvider } from './context/ThemeContext'
import Upload from './pages/Upload'
import Processing from './pages/Processing'
import Play from './pages/Play'
import NotFound from './pages/NotFound'

export default function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Upload />} />
          <Route path="/processing" element={<Processing />} />
          <Route path="/play/:id" element={<Play />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
  )
}
