// Synchronizacja danych miast: lokalne public/dane → wolumen na serwerze Hetzner (#237).
// Dane ETL nie leżą w gicie ani w obrazie; serwer (serwer/serwer.mjs, zmienna DANE_DIR) czyta je z
// wolumenu pod tymi samymi adresami /dane/... Opis: docs/hetzner.md, sekcja „Dane miast".
//
//   node scripts/dane-wyslij.mjs --dry-run     # tylko lista zmian, nic nie jedzie na serwer
//   node scripts/dane-wyslij.mjs               # wysyła nowe i zmienione pliki
//   node scripts/dane-wyslij.mjs miasta/lodz   # tylko podkatalog (względem public/dane)
//
// Zmienne: WDROZ_SSH (alias SSH, domyślnie jak w scripts/wdroz-coolify.mjs), DANE_ZDALNY (katalog
// wolumenu na serwerze). Przyrost: plik jedzie, gdy nie ma go na serwerze albo różni się rozmiarem
// lub czasem modyfikacji (sekundy). Niczego nie kasuje. Manifesty (manifest.json) składamy lokalnie
// z plików wskaźników, bo obraz ich nie zawiera. Node, nie rsync: rsync nie ma na Windows.
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { slugiMiast, zbudujManifest } from './manifest-danych.mjs'

const HOST = process.env.WDROZ_SSH ?? 'zdykty-prod'
const ZDALNY = process.env.DANE_ZDALNY ?? '/data/adresscore/dane'
const KORZEN = fileURLToPath(new URL('../public/dane', import.meta.url))

const argumenty = process.argv.slice(2)
const proba = argumenty.includes('--dry-run')
const podkatalog = argumenty.find((a) => !a.startsWith('--')) ?? ''

if (!/^[\w./-]*$/.test(ZDALNY) || !ZDALNY.startsWith('/')) {
  console.error(`DANE_ZDALNY musi być ścieżką bezwzględną bez znaków specjalnych: ${ZDALNY}`)
  process.exit(1)
}
if (!existsSync(KORZEN)) {
  console.error(`Brak ${KORZEN}: nie ma co wysyłać (dane powstają lokalnie z etl/).`)
  process.exit(1)
}
if (podkatalog.includes('..')) {
  console.error('Podkatalog nie może zawierać „..".')
  process.exit(1)
}

/** Wszystkie pliki katalogu: ścieżka względna (z „/") → { rozmiar, sekundy }. */
function przejdz(katalog, baza, wynik = new Map()) {
  for (const w of readdirSync(katalog, { withFileTypes: true })) {
    const pelna = join(katalog, w.name)
    if (w.isDirectory()) przejdz(pelna, baza, wynik)
    else if (w.isFile()) {
      const info = statSync(pelna)
      wynik.set(relative(baza, pelna).split(sep).join('/'), {
        rozmiar: info.size,
        sekundy: Math.floor(info.mtimeMs / 1000),
      })
    }
  }
  return wynik
}

// Manifesty: te same pliki co w `pnpm dev`, składane do katalogu tymczasowego (nie do public/dane).
const staging = mkdtempSync(join(tmpdir(), 'dane-manifesty-'))
function zapiszManifest(sciezka, katalogWskaznikow) {
  const cel = join(staging, sciezka)
  mkdirSync(join(cel, '..'), { recursive: true })
  writeFileSync(cel, zbudujManifest(katalogWskaznikow))
}
if (existsSync(join(KORZEN, 'wskazniki')))
  zapiszManifest('manifest.json', join(KORZEN, 'wskazniki'))
for (const slug of slugiMiast(KORZEN))
  zapiszManifest(`miasta/${slug}/manifest.json`, join(KORZEN, 'miasta', slug, 'wskazniki'))

const lokalne = przejdz(KORZEN, KORZEN)
// Manifest zawsze jedzie (znacznik czasu w treści), więc nie porównujemy go z serwerem.
const manifesty = [...przejdz(staging, staging).keys()]
for (const m of manifesty) lokalne.delete(m)
if (podkatalog) {
  const prefiks = `${podkatalog.replace(/\/+$/, '')}/`
  for (const k of [...lokalne.keys()]) if (!k.startsWith(prefiks)) lokalne.delete(k)
}

function ssh(polecenie, opcje = {}) {
  return spawnSync('ssh', ['-o', 'BatchMode=yes', HOST, polecenie], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    ...opcje,
  })
}

// Stan serwera: rozmiar i sekundy modyfikacji. Brak katalogu = pusta mapa (pierwsza wysyłka).
const lista = ssh(
  `[ -d '${ZDALNY}' ] && cd '${ZDALNY}' && find . -type f -printf '%P\\t%s\\t%T@\\n' || true`,
)
if (lista.status !== 0 && proba) {
  console.warn(
    `[dry-run] brak połączenia z ${HOST}, liczę względem pustego serwera: ${lista.stderr}`,
  )
} else if (lista.status !== 0) {
  console.error(`ssh ${HOST}: kod ${lista.status} ${lista.stderr ?? ''}`)
  process.exit(1)
}
const zdalne = new Map()
for (const wiersz of (lista.stdout ?? '').split('\n')) {
  const [sciezka, rozmiar, czas] = wiersz.split('\t')
  if (sciezka) zdalne.set(sciezka, { rozmiar: Number(rozmiar), sekundy: Math.floor(Number(czas)) })
}

const doWyslania = [...lokalne].filter(([k, l]) => {
  const z = zdalne.get(k)
  return !z || z.rozmiar !== l.rozmiar || z.sekundy !== l.sekundy
})
const bajty = doWyslania.reduce((s, [, l]) => s + l.rozmiar, 0)
console.log(
  `${proba ? '[dry-run] ' : ''}${HOST}:${ZDALNY} – plików lokalnie ${lokalne.size}, do wysłania ${doWyslania.length} (${(bajty / 1024 / 1024).toFixed(1)} MiB) + ${manifesty.length} manifestów`,
)
if (proba) {
  for (const [k] of doWyslania.slice(0, 20)) console.log(`  + ${k}`)
  if (doWyslania.length > 20) console.log(`  … i ${doWyslania.length - 20} kolejnych`)
  for (const m of manifesty) console.log(`  + ${m} (generowany)`)
  process.exit(0)
}

/** tar lokalnie → ssh → tar na serwerze; zachowuje czasy modyfikacji, więc kolejny bieg pomija pliki. */
function wyslij(baza, pliki) {
  if (!pliki.length) return Promise.resolve()
  return new Promise((zakoncz, odrzuc) => {
    const pakuj = spawn('tar', ['-c', '-f', '-', '-C', baza, '-T', '-'], {
      stdio: ['pipe', 'pipe', 'inherit'],
    })
    const rozpakuj = spawn(
      'ssh',
      ['-o', 'BatchMode=yes', HOST, `mkdir -p '${ZDALNY}' && tar -x -f - -C '${ZDALNY}'`],
      { stdio: ['pipe', 'inherit', 'inherit'] },
    )
    pakuj.stdout.pipe(rozpakuj.stdin)
    pakuj.stdin.end(`${pliki.join('\n')}\n`)
    let kody = 0
    let zostalo = 2
    const koniec = (kod) => {
      kody += kod ?? 1
      if (--zostalo === 0) kody === 0 ? zakoncz() : odrzuc(new Error(`tar/ssh: błąd (${kody})`))
    }
    pakuj.on('close', koniec)
    rozpakuj.on('close', koniec)
  })
}

await wyslij(
  KORZEN,
  doWyslania.map(([k]) => k),
)
await wyslij(staging, manifesty)
console.log('Gotowe. Serwer czyta pliki od razu (DANE_DIR), restart kontenera niepotrzebny.')
