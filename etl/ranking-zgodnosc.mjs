// Bramka zgodności rankingu ulic (#247, B5): top 5 z `rankingKompakt` (kafle + przybliżenie z heksów)
// kontra `rankingUlic` na pełnych danych, dla wszystkich person × trybów (Kupuję/Wynajmuję) × trzech
// zestawów filtrów. Cel: 100% zgodnego top 5 (te same ulice w tej samej kolejności).
// Uruchom: node etl/ranking-zgodnosc.mjs [--kandydaci=40] [--persony=a,b] [--cicho]
// Poza `pnpm verify` (wymaga public/dane z kompaktem z rozszerzeniami i adresy.json).
import { existsSync, readFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { maskujWykluczone, policzWykluczenia } from '../src/wynik/filtry.ts'
import { zakryjBrakiHeksow } from '../src/wynik/heksy.ts'
import { skaleKafli, wczytajKafel, wyczyscKafle } from '../src/wynik/kafle.ts'
import { rozpakuj } from '../src/wynik/kompakt.ts'
import { filtrZPliku } from '../src/wynik/kompaktBiezaceLogika.ts'
import { ladujDaneMiasta } from '../src/wynik/ladowanieDanych.ts'
import { PERSONY, ustawieniaPersony } from '../src/wynik/persony.ts'
import { podstawaZPliku, warstwaZPliku } from '../src/wynik/przegladLiczenie.ts'
import {
  KANDYDACI,
  planKafli,
  przyblizenieUlic,
  rankingKompakt,
} from '../src/wynik/rankingKompakt.ts'
import { rankingUlic } from '../src/wynik/rankingUlic.ts'
import { mapaHeksow, srednieHeksow } from '../src/wynik/silnik.ts'
import { ocenyMapy } from '../src/wynik/warstwaMapy.ts'
import { policzWynikiMapy } from '../src/wynik/wynikiMapy.ts'

const arg = (nazwa) => process.argv.find((a) => a.startsWith(`--${nazwa}=`))?.split('=')[1]
const kandydaci = Number(arg('kandydaci') ?? KANDYDACI)
const tylkoPersony = arg('persony')?.split(',')
const DANE = new URL('../public/dane/', import.meta.url)
const KOMPAKT = new URL('kompakt/', DANE)
if (!existsSync(new URL('indeks.json', KOMPAKT)) || !existsSync(new URL('adresy.json', DANE))) {
  console.error('Brak public/dane (kompakt albo adresy.json) – nie ma na czym porównać.')
  process.exit(2)
}

const indeks = JSON.parse(readFileSync(new URL('indeks.json', KOMPAKT), 'utf8'))
if (!indeks.rozszerzenia?.includes('i')) {
  console.error('Kompakt bez rozszerzenia „i” (stary format) – bramka pominięta.')
  process.exit(2)
}
const manifest = {
  wersja: indeks.wersja,
  wskazniki: Object.values(indeks.wskazniki).map((w) => ({
    ...w.meta,
    wersjaAdresow: w.wersjaAdresow,
  })),
}
const odczyt = (sciezka) => new Uint8Array(readFileSync(new URL(sciezka, KOMPAKT)))

// ── pełne dane (ścieżka odniesienia) ─────────────────────────────────────────────────────
const pelne = await ladujDaneMiasta({
  slug: 'krakow',
  baza: '/dane',
  pobierzJson: async (s) => {
    const sciezka = s.replace(/^\/dane\//, '')
    if (sciezka === 'manifest.json' && !existsSync(new URL(sciezka, DANE))) return manifest
    return JSON.parse(readFileSync(new URL(sciezka, DANE), 'utf8'))
  },
  ostrzez: () => {},
})
// Jak `rozwinAdresy` z kontraktów (ten moduł czyta `import.meta.env`, którego pod gołym node nie ma).
const kol = pelne.plikAdresow.kolumny
const adresy = kol.id.map((id, i) => ({
  i,
  id,
  miejscowosc: kol.miejscowosc[i] ?? '',
  ulica: kol.ulica[i] ?? null,
  nr: kol.nr[i] ?? '',
  kod: kol.kod[i] ?? null,
  dzielnica: kol.dzielnica[i] ?? null,
  gmina: kol.gmina[i] ?? '',
  teryt: kol.teryt[i] ?? '',
  lon: kol.lon[i] ?? 0,
  lat: kol.lat[i] ?? 0,
  h3: kol.h3[i] ?? '',
}))
const n = adresy.length

// ── dane heksów (jak w aplikacji: podstawa, warstwy, filtry, skale z kompaktu) ───────────
const podstawa = podstawaZPliku(await rozpakuj(odczyt(indeks.heksy.plik)))
const warstwy = new Map()
for (const [id, w] of Object.entries(indeks.wskazniki))
  warstwy.set(id, warstwaZPliku(await rozpakuj(odczyt(w.heksy.plik))))
const filtryHeksow = new Map()
const skaleJson = JSON.parse(readFileSync(new URL(indeks.skale.plik, KOMPAKT), 'utf8'))
const daneHeksow = {
  stan: 'gotowe',
  miasto: 'krakow',
  manifest,
  indeks,
  podstawa,
  warstwy,
  nieudane: new Set(),
  filtr: (id) => filtryHeksow.get(id) ?? null,
  skala: (id) => skaleJson[id] ?? null,
}
for (const [id, w] of Object.entries(indeks.wskazniki))
  filtryHeksow.set(id, filtrZPliku(await rozpakuj(odczyt(w.filtr.plik))))

const skaleKaf = skaleKafli(indeks, skaleJson)
let pobranoKafli = 0
const wczytaj = (wpis, signal) =>
  wczytajKafel('/dane', wpis, skaleKaf, {
    signal,
    pobierz: async (url) => {
      pobranoKafli++
      return odczyt(url.slice(url.indexOf('kafle/')))
    },
  })

// ── zestawy ───────────────────────────────────────────────────────────────────────────────
const ZESTAWY = [
  ['bez filtrów', []],
  ['jeden filtr', [{ id: 'przystanek_odleglosc', warunek: 'max', prog: 150 }]],
  [
    'dwa filtry',
    [
      { id: 'przystanek_odleglosc', warunek: 'max', prog: 150 },
      { id: 'sklep_odleglosc', warunek: 'max', prog: 200 },
    ],
  ],
]

function pelnyRanking(wagi, kierunki, filtry) {
  const { naAdres } = ocenyMapy(pelne.wskazniki, wagi, kierunki, 'wynik', n)
  const wykl = policzWykluczenia(pelne.wskazniki, filtry, n)
  const zMaska = wykl.liczbaWykluczonych > 0
  const heksy = mapaHeksow(
    zakryjBrakiHeksow(
      srednieHeksow(
        zMaska ? maskujWykluczone(naAdres, wykl.wykluczony) : naAdres,
        pelne.grupyHeksow,
      ),
      pelne.grupyHeksow,
      pelne.wskazniki,
      wagi,
      kierunki,
      'wynik',
    ),
    pelne.grupyHeksow,
  )
  return rankingUlic(adresy, naAdres, wykl.wykluczony, heksy, pelne.okolice, 5)
}

// ── porównanie ────────────────────────────────────────────────────────────────────────────
let razem = 0
let zgodne = 0
let zgodneZbiorem = 0
let wspolne = 0
const roznice = []
const kafleNaRanking = []
const bajtyNaRanking = []
const czasy = []
const persony = PERSONY.filter((p) => !tylkoPersony || tylkoPersony.includes(p.id))
for (const persona of persony) {
  for (const tryb of ['kupuje', 'wynajmuje']) {
    const { wagi, kierunki } = ustawieniaPersony(persona.id, tryb, manifest.wskazniki)
    for (const [nazwaZestawu, filtry] of ZESTAWY) {
      const wzor = pelnyRanking(wagi, kierunki, filtry)
      const wyniki = policzWynikiMapy(daneHeksow, wagi, kierunki, 'wynik', filtry)
      if (!wyniki) throw new Error('wyniki mapy niegotowe')
      wyczyscKafle()
      pobranoKafli = 0
      const t0 = performance.now()
      const k = await rankingKompakt({
        podstawa,
        indeks,
        wyniki,
        wagi,
        kierunki,
        warstwa: 'wynik',
        filtry,
        wczytaj,
        okolice: pelne.okolice,
        kandydaci,
        strategia: arg('strategia') ?? 'ulice',
        promien: Number(arg('promien') ?? 0),
        limitBajtow: arg('limit') ? Number(arg('limit')) : undefined,
      })
      czasy.push(performance.now() - t0)
      kafleNaRanking.push(k.kafli)
      bajtyNaRanking.push(k.bajty)
      if (process.argv.includes('--diag') && razem === 0) {
        const kand = przyblizenieUlic(podstawa, wyniki, 200)
        const plan = planKafli(indeks, kand.slice(0, kandydaci))
        for (const p of wzor) {
          const idx = kand.findIndex((c) => c.nazwa === p.nazwa)
          const c = kand[idx]
          const pokryta = c ? plan.pokryci.includes(c) : false
          console.log(
            `DIAG ${p.nazwa}: pełne ${p.wynik.toFixed(1)} (${p.liczbaAdresow} adr.) | miejsce w przybliżeniu ${idx + 1}` +
              (c
                ? ` (${c.wynik.toFixed(1)}, ${c.liczbaAdresow} adr. w ${c.heksy.length} heks.), pokryta=${pokryta}`
                : ''),
          )
        }
        console.log(
          `DIAG kafli w planie ${plan.kafle.length}, pokrytych ${plan.pokryci.length}/${kandydaci}`,
        )
      }
      const a = wzor.map((p) => p.slug)
      const b = k.ulice.map((p) => p.slug)
      razem++
      wspolne += b.filter((x) => a.includes(x)).length / Math.max(a.length, 1)
      const rowne = a.length === b.length && a.every((s, i) => s === b[i])
      if (rowne) zgodne++
      else {
        if (a.length === b.length && new Set(a).size === new Set([...a, ...b]).size) zgodneZbiorem++
        roznice.push({
          persona: persona.id,
          tryb,
          zestaw: nazwaZestawu,
          pelne: wzor.map((p) => `${p.nazwa} ${p.wynik.toFixed(1)}`),
          kompakt: k.ulice.map((p) => `${p.nazwa} ${p.wynik.toFixed(1)}`),
        })
      }
    }
  }
}

console.log(`Średnio wspólnych ulic w top 5: ${((100 * wspolne) / razem).toFixed(0)}%`)
const mediana = (t) => [...t].sort((x, y) => x - y)[Math.floor(t.length / 2)] ?? 0
console.log(
  `Zgodność top 5 (kandydaci ${kandydaci}): ${zgodne}/${razem} = ${((100 * zgodne) / razem).toFixed(1)}%` +
    (zgodneZbiorem ? ` (+${zgodneZbiorem} z tym samym zbiorem, inna kolejność)` : ''),
)
console.log(
  `Kafle na ranking: mediana ${mediana(kafleNaRanking)}, maks ${Math.max(...kafleNaRanking)}; ` +
    `szacunek ~${Math.round(mediana(bajtyNaRanking) / 1000)} KB (mediana); ` +
    `czas dokładnego etapu: mediana ${mediana(czasy).toFixed(0)} ms, maks ${Math.max(...czasy).toFixed(0)} ms (z dysku)`,
)
if (!process.argv.includes('--cicho'))
  for (const r of roznice.slice(0, 25))
    console.log(
      `\n${r.persona} / ${r.tryb} / ${r.zestaw}\n  pełne:   ${r.pelne.join(' | ')}\n  kompakt: ${r.kompakt.join(' | ')}`,
    )
if (roznice.length > 25) console.log(`\n… i ${roznice.length - 25} kolejnych różnic`)
void planKafli
void przyblizenieUlic
process.exit(zgodne === razem ? 0 : 1)
