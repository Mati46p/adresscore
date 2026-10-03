import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, URL } from 'node:url'
import babel from '@rolldown/plugin-babel'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

// Manifest wskaźników składany z plików, a nie pisany ręcznie: każda warstwa ETL dokłada
// tylko swój plik, więc równoległe gałęzie nie konfliktują na wspólnej liście.
function manifestDanych(): Plugin {
  const katalog = fileURLToPath(new URL('./public/dane/wskazniki', import.meta.url))
  const zbuduj = () => {
    const pliki = existsSync(katalog) ? readdirSync(katalog).filter((p) => p.endsWith('.json')) : []
    const wskazniki = pliki.sort().map((p) => {
      const { meta, wersjaAdresow } = JSON.parse(readFileSync(join(katalog, p), 'utf8'))
      return { ...meta, wersjaAdresow }
    })
    return JSON.stringify({ wygenerowano: new Date().toISOString(), wskazniki })
  }
  return {
    name: 'manifest-danych',
    configureServer(serwer) {
      serwer.middlewares.use('/dane/manifest.json', (_zad, odp) => {
        odp.setHeader('Content-Type', 'application/json')
        odp.end(zbuduj())
      })
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'dane/manifest.json', source: zbuduj() })
    },
  }
}

export default defineConfig({
  plugins: [react(), babel({ presets: [reactCompilerPreset()] }), manifestDanych()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: { port: 5180 },
})
