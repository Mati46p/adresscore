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

// Tryb offline demo (#100): po jednym otwarciu online aplikacja i mapa działają bez sieci.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((e) => console.warn('Bez trybu offline:', e))
  })
}
