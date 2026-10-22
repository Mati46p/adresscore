import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, URL } from 'node:url'
import babel from '@rolldown/plugin-babel'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import { slugiMiast, zbudujManifest } from './scripts/manifest-danych.mjs'

// Manifest wskaźników składany z plików, a nie pisany ręcznie: każda warstwa ETL dokłada
// tylko swój plik, więc równoległe gałęzie nie konfliktują na wspólnej liście.
//
// Jeden manifest na zbiór danych: Kraków (public/dane/wskazniki → /dane/manifest.json) i każde
// miasto (public/dane/miasta/<slug>/wskazniki → /dane/miasta/<slug>/manifest.json, #223). Ten sam
// kod zamiast pliku manifestu z ETL: druga kopia logiki cicho by gniła i któryś zbiór miałby
// manifest rozjechany z własnymi wskaźnikami (jedno źródło prawdy).
function manifestDanych(): Plugin {
  const korzen = fileURLToPath(new URL('./public/dane', import.meta.url))
  const katalogMiast = join(korzen, 'miasta')
  const zbuduj = zbudujManifest
  // Miasta z katalogiem wskaźników, czytane przy każdym użyciu: dev widzi nowe miasto bez restartu.
  const slugi = () => slugiMiast(korzen)
  return {
    name: 'manifest-danych',
    configureServer(serwer) {
      serwer.middlewares.use('/dane/manifest.json', (_zad, odp) => {
        odp.setHeader('Content-Type', 'application/json')
        odp.end(zbuduj(join(korzen, 'wskazniki')))
      })
      // Connect obcina prefiks z adresu: tu `zad.url` to np. „/lodz/manifest.json". Slug przechodzi
      // przez listę katalogów, więc nie da się wyjść poza public/dane/miasta. Reszta plików miast
      // (adresy, kompakt, wskaźniki) idzie dalej do statycznego serwera Vite.
      serwer.middlewares.use('/dane/miasta', (zad, odp, dalej) => {
        const slug = /^\/([a-z]+)\/manifest\.json(?:\?.*)?$/.exec(zad.url ?? '')?.[1]
        if (!slug || !slugi().includes(slug)) return dalej()
        odp.setHeader('Content-Type', 'application/json')
        odp.end(zbuduj(join(katalogMiast, slug, 'wskazniki')))
      })
    },
    generateBundle() {
      // Dane leżą poza repo (#237): w buildzie bez nich (obraz Dockera) manifesty zostają na
      // wolumenie z danymi, gdzie dokłada je scripts/dane-wyslij.mjs. Pusty manifest w dist
      // przesłaniałby ten prawdziwy, więc go nie emitujemy.
      if (!existsSync(join(korzen, 'wskazniki'))) return
      this.emitFile({
        type: 'asset',
        fileName: 'dane/manifest.json',
        source: zbuduj(join(korzen, 'wskazniki')),
      })
      for (const slug of slugi()) {
        this.emitFile({
          type: 'asset',
          fileName: `dane/miasta/${slug}/manifest.json`,
          source: zbuduj(join(katalogMiast, slug, 'wskazniki')),
        })
      }
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
