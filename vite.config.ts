import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, URL } from 'node:url'
import babel from '@rolldown/plugin-babel'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Plugin } from 'vite'

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

// Endpoint zapisu zdarzeń pomiaru w `pnpm dev` (T067). Na produkcji obsługuje go api/zdarzenie.js
// (funkcja Vercela albo serwer Node na Coolify); Vite nie ma funkcji hostingu, więc TEN SAM `handler`
// podpinamy jako middleware pod /api/zdarzenie. Plik ładuje ssrLoadModule, więc zmiany w api/ działają
// bez restartu serwera. `apply: 'serve'` = nic w buildzie i nic w paczce przeglądarki.
function endpointZdarzen(): Plugin {
  let env: Record<string, string> = {}
  return {
    name: 'endpoint-zdarzen',
    apply: 'serve',
    configResolved(konfiguracja) {
      // Prefiks pusty zamiast VITE_: endpoint czyta SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY i
      // ADRESSCORE_HOSTY z .env.local, a klucz serwisowy NIGDY nie może mieć prefiksu VITE_
      // (trafiłby do przeglądarki). Zmienne z procesu mają pierwszeństwo przed plikami.
      env = loadEnv(konfiguracja.mode, konfiguracja.envDir || process.cwd(), '')
    },
    configureServer(serwer) {
      serwer.middlewares.use('/api/zdarzenie', async (zad, odp) => {
        try {
          const modul = await serwer.ssrLoadModule('/api/zdarzenie.js')
          await modul.default(zad, odp, { env: { ...env, ...process.env } })
        } catch (blad) {
          // Analityka nie psuje nawigacji także w dev: awaria handlera to 204 i wiersz w terminalu.
          serwer.config.logger.error(
            `/api/zdarzenie: ${blad instanceof Error ? blad.message : 'nieznany błąd'}`,
          )
          if (!odp.writableEnded) {
            odp.statusCode = 204
            odp.end()
          }
        }
      })
    },
  }
}

export default defineConfig({
  plugins: [
    react(),
    babel({ presets: [reactCompilerPreset()] }),
    manifestDanych(),
    endpointZdarzen(),
  ],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: { port: 5180 },
})
