// Silnik trybu „Biznes” na PRAWDZIWYCH plikach z public/dane/biznes: czas oceny miejsca
// (cel z przeglądu E10: poniżej 200 ms; przed zmianą 110–280 ms przy każdej ocenie) i zgodność
// wyniku przyrostowego z przeliczeniem całego miasta. Bez plików testy są pomijane.
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  bezPunktu,
  bialePlamyZIndeksu,
  type KomorkaPopytu,
  METRY_LAT,
  METRY_LON,
  type Miejsce,
  ocenMiejsceWIndeksie,
  type PunktUslugi,
  przygotujKomorki,
  zbudujIndeks,
} from './biznes.ts'
import { ocenaPelna, przydzialyPelne } from './biznesOdniesienie.ts'

const sciezka = (plik: string) =>
  fileURLToPath(new URL(`../../public/dane/biznes/${plik}`, import.meta.url))
const maDane = existsSync(sciezka('popyt.json')) && existsSync(sciezka('sklep.json'))
const opcje = { skip: maDane ? false : 'brak plików public/dane/biznes/popyt.json i sklep.json' }

/** Czas (ms) i wynik funkcji. */
function zmierz<T>(f: () => T): [T, number] {
  const start = performance.now()
  const wynik = f()
  return [wynik, performance.now() - start]
}

interface PlikBranzy {
  meta: { zasiegM: number }
  punkty: PunktUslugi[]
}

function wczytaj(branza: string) {
  const { komorki } = JSON.parse(readFileSync(sciezka('popyt.json'), 'utf8')) as {
    komorki: KomorkaPopytu[]
  }
  const plik = JSON.parse(readFileSync(sciezka(`${branza}.json`), 'utf8')) as PlikBranzy
  return { komorki, punkty: plik.punkty, promien: plik.meta.zasiegM }
}

const MIEJSCA: Miejsce[] = [
  { lon: 19.9385, lat: 50.0614 }, // centrum Krakowa
  { lon: 19.9, lat: 50.02 }, // Skotniki
  { lon: 20.0, lat: 50.09 }, // Nowa Huta
  { lon: 19.95, lat: 50.04 },
  { lon: 20.2, lat: 50.2 }, // peryferie, mało adresów
  { lon: 20.9, lat: 50.4 }, // poza danymi o popycie
]

test('ocena sklepu na prawdziwych danych liczy się w mniej niż 200 ms', opcje, (t) => {
  const { komorki, punkty, promien } = wczytaj('sklep')
  const [indeksKomorek, czasKomorek] = zmierz(() => przygotujKomorki(komorki))
  const [indeks, czasIndeksu] = zmierz(() => zbudujIndeks(indeksKomorek, punkty, promien))
  const [plamy, czasPlam] = zmierz(() => bialePlamyZIndeksu(indeks))
  t.diagnostic(
    `heksy ${czasKomorek.toFixed(0)} ms, indeks ${czasIndeksu.toFixed(0)} ms, ` +
      `białe plamy ${czasPlam.toFixed(0)} ms (przed zmianą: ok. 1100–1800 ms), ${plamy.length} heksów`,
  )
  const czasy: number[] = []
  for (const miejsce of MIEJSCA) {
    const [, czas] = zmierz(() => ocenMiejsceWIndeksie(indeks, miejsce))
    czasy.push(czas)
    // Także PIERWSZE wywołanie (zimny JIT) mieści się w celu.
    assert.ok(czas < 200, `ocena ${JSON.stringify(miejsce)} trwała ${czas.toFixed(1)} ms`)
  }
  const posortowane = [...czasy].sort((a, b) => a - b)
  t.diagnostic(
    `ocena miejsca: mediana ${(posortowane[Math.floor(posortowane.length / 2)] as number).toFixed(2)} ms, ` +
      `maksimum ${(posortowane.at(-1) as number).toFixed(2)} ms (przed zmianą: 110–280 ms)`,
  )
  // Rozsądny bezpiecznik całości; zmierzone ok. 0,2 s, więc zapas ponad dziesięciokrotny.
  assert.ok(
    czasKomorek + czasIndeksu + czasPlam < 3000,
    'indeks i białe plamy powinny liczyć się raz, w ułamku sekundy',
  )
})

test('indeks liczy się raz: kolejne oceny nie przebudowują siatek', opcje, () => {
  const { komorki, punkty, promien } = wczytaj('sklep')
  const indeks = zbudujIndeks(przygotujKomorki(komorki), punkty, promien)
  const przed = { komorki: indeks.komorki, siatka: indeks.siatkaPunktow, rozklad: indeks.rozklad }
  for (const miejsce of MIEJSCA) ocenMiejsceWIndeksie(indeks, miejsce)
  assert.equal(indeks.komorki, przed.komorki)
  assert.equal(indeks.siatkaPunktow, przed.siatka)
  assert.equal(indeks.rozklad, przed.rozklad)
})

test('wynik przyrostowy = przeliczenie całego miasta na prawdziwych danych', opcje, (t) => {
  const { komorki, punkty, promien } = wczytaj('sklep')
  const indeks = zbudujIndeks(przygotujKomorki(komorki), punkty, promien)
  const przed = przydzialyPelne(komorki, punkty, promien)
  // Dwa miejsca dokładnie na istniejących sklepach: punkt jest wtedy ZASTĘPOWANY, nie dublowany.
  const naSklepach = punkty
    .map((p, j) => ({ p, j }))
    .filter(({ j }) => (indeks.heksowWZasiegu[j] as number) > 20)
    .slice(0, 2)
    .map(({ p }) => ({ lon: p[0] + 0.00003, lat: p[1] - 0.00002 }))
  // Pełne przeliczenie trwa ok. 1,3 s na miejsce, więc tylko kilka punktów kontrolnych.
  const miejsca = [MIEJSCA[0], MIEJSCA[2], MIEJSCA[4], ...naSklepach] as Miejsce[]
  let zastapione = 0
  for (const miejsce of miejsca) {
    const a = ocenMiejsceWIndeksie(indeks, miejsce)
    const [b, czas] = zmierz(() => ocenaPelna(komorki, punkty, promien, miejsce, przed))
    t.diagnostic(`pełne przeliczenie ${JSON.stringify(miejsce)}: ${czas.toFixed(0)} ms`)
    if (b.zastapiony >= 0) zastapione++
    const bliskie = (x: number, y: number) => Math.abs(x - y) <= 1e-9 * (1 + Math.abs(y))
    for (const pole of [
      'adresyWZasiegu',
      'mieszkancyWZasiegu',
      'kursySzczytSrednio',
      'przydzieloneAdresy',
      'przydzielonyPopyt',
    ] as const)
      assert.ok(bliskie(a[pole], b[pole]), `${pole}: ${a[pole]} vs ${b[pole]}`)
    for (const pole of [
      'konkurenci',
      'udzialProcent',
      'percentyl',
      'porownanoZ',
      'najblizszyKonkurent',
      'odlegloscKonkurenta',
    ] as const)
      assert.equal(a[pole], b[pole], `${pole} dla ${JSON.stringify(miejsce)}`)
    // Udziały popytu w zasięgu domykają się do liczby adresów w zasięgu.
    assert.ok(bliskie(a.przydzieloneAdresy + b.adresyKonkurentow, a.adresyWZasiegu))
  }
  assert.equal(zastapione, 2)
})

test('rozkład porównawczy pomija punkty spoza obszaru popytu (nie cała Małopolska)', opcje, () => {
  const { komorki, punkty, promien } = wczytaj('sklep')
  const indeks = zbudujIndeks(przygotujKomorki(komorki), punkty, promien)
  const bezPopytu = Array.from(indeks.heksowWZasiegu).filter((n) => n === 0).length
  assert.ok(bezPopytu > 0, 'plik sklepów obejmuje punkty spoza obszaru popytu')
  assert.equal(indeks.rozklad.length, punkty.length - bezPopytu)
  assert.ok(indeks.rozklad.every((v) => v > 0))
  // Ocena w centrum Krakowa porównuje się z punktami z popytem, a nie z tysiącem zer.
  const centrum = ocenMiejsceWIndeksie(indeks, MIEJSCA[0] as Miejsce)
  assert.equal(centrum.porownanoZ, indeks.rozklad.length)
  assert.ok(centrum.percentyl !== null)
})

test('białe plamy na prawdziwych danych: osobna kategoria „brak punktu w zasięgu”', opcje, () => {
  const { komorki, punkty, promien } = wczytaj('sklep')
  const indeks = zbudujIndeks(przygotujKomorki(komorki), punkty, promien)
  const plamy = bialePlamyZIndeksu(indeks)
  assert.equal(plamy.length, komorki.length)
  const bez = plamy.filter(bezPunktu)
  const z = plamy.filter((p) => !bezPunktu(p))
  assert.ok(bez.length > 0 && z.length > 0)
  for (const p of bez) assert.equal(p.adresyNaPunkt, null)
  for (const p of z) assert.ok((p.adresyNaPunkt as number) > 0)
  for (const p of plamy) assert.ok(p.skala >= 0 && p.skala <= 100)
  // Adresy w zasięgu heksu to dokładnie to, co liczy ocena miejsca ustawionego w jego środku.
  const probka = plamy.filter((_, i) => i % 3500 === 0)
  for (const p of probka) {
    const i = indeks.komorki.h3.indexOf(p.h3)
    const ocena = ocenMiejsceWIndeksie(indeks, {
      lon: (indeks.komorki.x[i] as number) / METRY_LON,
      lat: (indeks.komorki.y[i] as number) / METRY_LAT,
    })
    assert.equal(ocena.adresyWZasiegu, p.adresyWZasiegu)
  }
})
