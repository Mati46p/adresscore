// Pełny ETL jednego miasta (tryb ADRESCORE_MIASTO) od zera do kompaktu. Przepis: docs/etapy/miasta-20.md.
//
//   node etl/miasto-calosc.mjs <slug>                 – wszystko (PRG, adresy, warstwy, kompakt)
//   node etl/miasto-calosc.mjs <slug> --od <krok>     – wznowienie od kroku (nazwa z listy KROKI)
//   node etl/miasto-calosc.mjs <slug> --tylko <krok>  – jeden krok
//   node etl/miasto-calosc.mjs --lista                – nazwy kroków
//
// Kroki wołają skrypty tak jak ręcznie (ADRESCORE_MIASTO=<slug> node etl/<skrypt>.mjs), po kolei,
// z pomiarem czasu. Pierwszy błąd przerywa (kod 1) i podaje komendę wznowienia. Surowe pobrania
// (etl/.cache) są wspólne i wznawialne, więc ponowny bieg jest szybki. Bezpieczne zasady równoległości:
// patrz sekcja „Przepis ETL miasta" w docs/etapy/miasta-20.md.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MIASTA } from './lib/miasta.mjs'
import { MIASTA as USTAWIENIA } from './lib/miasto.mjs'
import { CACHE, KORZEN } from './lib/wspolne.mjs'

/** Kolejność wynika z zależności: adresy → źródła ogólnopolskie → OSM/usługi → transport → kompakt. */
export const KROKI = [
  { nazwa: 'prg', opis: 'punkty adresowe PRG (python, etl/.cache/prg-miasta/<teryt>.json)' },
  { nazwa: 'adresy', skrypt: 'miasta-adresy.mjs', arg: 'slug' },
  { nazwa: 'zasoby', opis: 'PBF województwa i GTFS miasta (pobranie pod blokadą, wspólne cache)' },
  { nazwa: 'budynki', skrypt: 'budynki.mjs' },
  { nazwa: 'budynki-kafle', skrypt: 'budynki-kafle.mjs' },
  { nazwa: 'gus', skrypt: 'gus.mjs' },
  { nazwa: 'zamoznosc', skrypt: 'zamoznosc.mjs' },
  { nazwa: 'przestepstwa', skrypt: 'przestepstwa.mjs' },
  { nazwa: 'frekwencja', skrypt: 'frekwencja.mjs' },
  { nazwa: 'wybory-sejm-2023', skrypt: 'wybory-sejm-2023.mjs' },
  { nazwa: 'pozary', skrypt: 'pozary.mjs' },
  { nazwa: 'szkoly', skrypt: 'szkoly.mjs' },
  { nazwa: 'azbest', skrypt: 'azbest.mjs' },
  { nazwa: 'seveso', skrypt: 'seveso.mjs' },
  { nazwa: 'prtr', skrypt: 'prtr.mjs' },
  { nazwa: 'powodz', skrypt: 'powodz.mjs' },
  { nazwa: 'osiadanie', skrypt: 'osiadanie.mjs' },
  { nazwa: 'halas-obwarzanek', skrypt: 'halas-obwarzanek.mjs' },
  { nazwa: 'zielen-worldcover', skrypt: 'zielen-worldcover.mjs' },
  { nazwa: 'swiatlo-viirs', skrypt: 'swiatlo-viirs.mjs' },
  { nazwa: 'powietrze', skrypt: 'powietrze.mjs' },
  { nazwa: 'uzbrojenie', skrypt: 'uzbrojenie.mjs' },
  {
    nazwa: 'sewik',
    opis: 'zrzut SEWIK województwa (pobranie archiwum raz, rozpakowanie pod blokadą)',
  },
  { nazwa: 'wypadki', skrypt: 'wypadki.mjs', arg: 'sewik' },
  { nazwa: 'zabytki-nid', skrypt: 'zabytki-nid.mjs' },
  { nazwa: 'codziennosc', skrypt: 'codziennosc.mjs' }, // pobiera RPWDL do etl/.cache/rpwdl, którego potrzebuje sor
  { nazwa: 'sor', skrypt: 'sor.mjs' },
  { nazwa: 'rowery', skrypt: 'rowery.mjs' },
  { nazwa: 'uslugi-osm', skrypt: 'uslugi-osm.mjs' },
  { nazwa: 'osm-uslugi', skrypt: 'osm-uslugi.mjs' },
  { nazwa: 'osm-uzupelnienie', skrypt: 'osm-uzupelnienie.mjs' },
  { nazwa: 'uslugi', skrypt: 'uslugi.mjs' },
  { nazwa: 'gtfs-przystanki', skrypt: 'gtfs-przystanki.mjs' },
  { nazwa: 'dojazd-gtfs', skrypt: 'dojazd-gtfs.mjs' },
  { nazwa: 'dojazd-gtfs-graf', skrypt: 'dojazd-gtfs-graf.mjs' },
  { nazwa: 'uprosc-kryteria', skrypt: 'uprosc-kryteria.mjs', warunek: 'tryb-miasta' },
  { nazwa: 'kompakt', skrypt: 'kompakt.mjs' },
]

const PYTHONY = ['python3', 'python', 'py']
function znajdzPythona() {
  for (const p of PYTHONY) {
    const r = spawnSync(p, ['-c', 'import sys; sys.exit(0 if sys.version_info[0] == 3 else 1)'], {
      stdio: 'ignore',
    })
    if (r.status === 0) return p
  }
  throw new Error('Brak Pythona 3 w PATH (python3, python, py)')
}

function uruchom(slug, polecenie, argumenty) {
  const start = Date.now()
  const r = spawnSync(polecenie, argumenty, {
    cwd: KORZEN,
    stdio: 'inherit',
    env: { ...process.env, ADRESCORE_MIASTO: slug },
  })
  return { kod: r.status ?? 1, sek: Math.round((Date.now() - start) / 1000) }
}

/** Blokada katalogiem (atomowa): pobrania wspólnych plików cache nie mogą biec w dwóch procesach naraz. */
async function podBlokada(nazwa, praca) {
  mkdirSync(CACHE, { recursive: true })
  const katalog = join(CACHE, `.blokada-${nazwa}`)
  for (;;) {
    try {
      mkdirSync(katalog)
      break
    } catch (blad) {
      if (blad.code !== 'EEXIST') throw blad
      await new Promise((ok) => setTimeout(ok, 5000))
    }
  }
  try {
    return await praca()
  } finally {
    rmSync(katalog, { recursive: true, force: true })
  }
}

async function zasoby(slug) {
  const info = USTAWIENIA[slug]
  const kod = `
    const m = await import('./etl/lib/miasto.mjs')
    const g = await import('./etl/lib/gtfs-miasta.mjs')
    const p = await m.pbfRegionu()
    console.log('PBF', p.plik, p.stan)
    for (const f of g.FEEDY_MIASTA ?? []) {
      const { meta } = await g.wczytajFeedMiasta(f)
      console.log('GTFS', f.grupa, meta.bajty, 'B', meta.dataPobrania)
    }
    if (g.BRAK_GTFS_MIASTA) console.log('GTFS: brak otwartego feedu dla tego miasta (szara kategoria)')`
  return podBlokada(`zasoby-${info.pbf}`, async () => {
    const w = uruchom(slug, process.execPath, ['--input-type=module', '-e', kod])
    return w
  })
}

const SEWIK_URL = 'http://mocniak.pl/sewik/fixed-sewik-xml-(2018-25).tar.xz'

/** Archiwum SEWIK (480 MB, raz) i rozpakowanie plików województwa do etl/.cache/sewik/raw/<woj>/. */
async function sewik(slug) {
  const woj = USTAWIENIA[slug].pbf
  const raw = join(CACHE, 'sewik', 'raw', woj)
  return podBlokada('sewik', async () => {
    if (existsSync(raw) && readdirSync(raw).length > 0) return { kod: 0, sek: 0 }
    const archiwum = join(CACHE, 'sewik', 'sewik-xml-2018-24.tar.xz')
    mkdirSync(join(CACHE, 'sewik'), { recursive: true })
    let sek = 0
    if (!existsSync(archiwum)) {
      const w = uruchom(slug, 'curl', [
        '-L',
        '--fail',
        '--retry',
        '3',
        '-o',
        `${archiwum}.tmp`,
        SEWIK_URL,
      ])
      sek += w.sek
      if (w.kod !== 0) return w
      renameSync(`${archiwum}.tmp`, archiwum)
    }
    const w = uruchom(slug, znajdzPythona(), ['-I', 'etl/sewik-rozpakuj.py', woj])
    return { kod: w.kod, sek: sek + w.sek }
  })
}

/** Krok uprosc-kryteria działa w trybie miasta dopiero po merge #232; wcześniej jest pomijany (nie psuje danych). */
function warunekSpelniony(krok) {
  if (krok.warunek !== 'tryb-miasta') return true
  return readFileSync(join(KORZEN, 'etl', krok.skrypt), 'utf8').includes('MIASTO')
}

async function main() {
  const arg = process.argv.slice(2)
  if (arg.includes('--lista')) {
    console.log(KROKI.map((k) => k.nazwa).join('\n'))
    return
  }
  const slug = arg.find((a) => !a.startsWith('--') && MIASTA[a])
  if (!slug)
    throw new Error('Użycie: node etl/miasto-calosc.mjs <slug> [--od <krok>|--tylko <krok>]')
  const wartosc = (flaga) => arg[arg.indexOf(flaga) + 1]
  const od = arg.includes('--od') ? wartosc('--od') : null
  const tylko = arg.includes('--tylko') ? wartosc('--tylko') : null
  for (const n of [od, tylko].filter(Boolean))
    if (!KROKI.some((k) => k.nazwa === n)) throw new Error(`Nieznany krok: ${n}`)

  const teryt = MIASTA[slug].teryt4 // powiat (4 cyfry); TERYT gminy miasta = powiat + '011'
  const terytGminy = `${teryt}011`
  let aktywny = !od
  const czasy = []
  const poczatek = Date.now()
  for (const krok of KROKI) {
    if (od && krok.nazwa === od) aktywny = true
    if (!aktywny || (tylko && krok.nazwa !== tylko)) continue
    if (!warunekSpelniony(krok)) {
      console.log(
        `\n=== [${slug}] ${krok.nazwa}: pominięty (skrypt bez trybu miasta, czeka na #232) ===`,
      )
      continue
    }
    console.log(`\n=== [${slug}] ${krok.nazwa} ===`)
    let w
    if (krok.nazwa === 'prg') {
      // Plik .json PRG istnieje = pobranie już zrobione (wznawialne); kasuj go, żeby pobrać ponownie.
      if (existsSync(join(CACHE, 'prg-miasta', `${terytGminy}.json`))) w = { kod: 0, sek: 0 }
      else
        w = await podBlokada('prg', async () =>
          uruchom(slug, znajdzPythona(), ['-I', 'etl/prg-miasta.py', terytGminy]),
        )
    } else if (krok.nazwa === 'zasoby') w = await zasoby(slug)
    else if (krok.nazwa === 'sewik') w = await sewik(slug)
    else
      w = uruchom(slug, process.execPath, [
        join('etl', krok.skrypt),
        ...(krok.arg === 'slug' ? [slug] : []),
        ...(krok.arg === 'sewik' ? [join(CACHE, 'sewik', 'raw', USTAWIENIA[slug].pbf)] : []),
      ])
    czasy.push([krok.nazwa, w.sek])
    console.log(`--- [${slug}] ${krok.nazwa}: ${w.kod === 0 ? 'OK' : `BŁĄD ${w.kod}`}, ${w.sek} s`)
    if (w.kod !== 0) {
      console.error(
        `\nPrzerwano na kroku „${krok.nazwa}". Wznów: node etl/miasto-calosc.mjs ${slug} --od ${krok.nazwa}`,
      )
      process.exit(1)
    }
  }
  console.log(`\nCzasy kroków [s]: ${czasy.map(([n, s]) => `${n}=${s}`).join(' ')}`)
  console.log(`[${slug}] razem ${Math.round((Date.now() - poczatek) / 1000)} s`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main()
