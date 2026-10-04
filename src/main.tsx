import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from '@/App'
import '@/styles.css'

const root = document.getElementById('root')
if (!root) throw new Error('Brak #root w index.html')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Karta otwarta przed deployem trzyma stary index, a chunki starego builda już nie istnieją (404).
// Jedno przeładowanie pobiera świeży index; znacznik w sessionStorage chroni przed pętlą.
window.addEventListener('vite:preloadError', (e) => {
  try {
    const teraz = Date.now()
    const ostatnio = Number(sessionStorage.getItem('przeladowanie-po-deployu') ?? 0)
    if (teraz - ostatnio < 10_000) return
    sessionStorage.setItem('przeladowanie-po-deployu', String(teraz))
  } catch {}
  e.preventDefault()
  window.location.reload()
})

// Tryb offline demo (#100): po jednym otwarciu online aplikacja i mapa działają bez sieci.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((e) => console.warn('Bez trybu offline:', e))
  })
}
