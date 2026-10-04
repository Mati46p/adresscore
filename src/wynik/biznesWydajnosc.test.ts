// Silnik trybu „Biznes” na PRAWDZIWYCH plikach: popyt z public/dane/biznes, punkty usług z katalogu
// public/dane/uslugi (przez adapter `biznesUslugi.ts`, tą samą drogą co worker). Sprawdza czas
// oceny miejsca (cel z przeglądu E10: poniżej 200 ms; od #105 oceny trwają ułamki milisekundy),
// zgodność wyniku przyrostowego z przeliczeniem całego miasta, rozkład porównawczy bez punktów
// spoza obszaru popytu i to, że filtry konkurencji zmieniają ocenę tak, jakby filtrowanej listy
// punktów w ogóle nie było. Bez plików testy są pomijane.
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  bezPunktu,
  bialePlamyZIndeksu,
  type IndeksBiznesu,
  type KomorkaPopytu,
  METRY_LAT,
  METRY_LON,
  type Miejsce,
  ocenMiejsceWIndeksie,
  PROMIEN_TEGO_SAMEGO_M,
  przygotujKomorki,
  zbudujIndeks,
} from './biznes.ts'
import { ocenaPelna, przydzialyPelne } from './biznesOdniesienie.ts'
import {
  BEZ_FILTROW,
  type FiltryUslug,
  type KatalogUslug,
  type PlikUslug,
  punktyBranzy,
} from './biznesUslugi.ts'

const sciezka = (plik: string) =>
  fileURLToPath(new URL(`../../public/dane/${plik}`, import.meta.url))
const maDane =
  existsSync(sciezka('biznes/popyt.json')) && existsSync(sciezka('uslugi/katalog.json'))
const opcje = {
  skip: maDane ? false : 'brak plików public/dane/biznes/popyt.json i public/dane/uslugi',
}

/** Branże do pomiaru: sklep (2619), paczkomat (2319), restauracja (3160) i myjnia (najdłuższy zasięg, 2000 m). */
const POMIAROWE = ['sklep_spozywczy', 'paczkomat', 'restauracja', 'myjnia'] as const

/** Czas (ms) i wynik funkcji. */
function zmierz<T>(f: () => T): [T, number] {
  const start = performance.now()
  const wynik = f()
  return [wynik, performance.now() - start]
}

let komorkiPopytu: KomorkaPopytu[] | null = null
function popyt(): KomorkaPopytu[] {
  komorkiPopytu ??= (
    JSON.parse(readFileSync(sciezka('biznes/popyt.json'), 'utf8')) as { komorki: KomorkaPopytu[] }
  ).komorki
  return komorkiPopytu
}

const plikBranzy = (id: string) =>
  JSON.parse(readFileSync(sciezka(`uslugi/${id}.json`), 'utf8')) as PlikUslug

/** Branża tak, jak dostaje ją worker: plik → adapter (z filtrami) → punkty i zasięg z katalogu. */
function wczytaj(branza: string, filtry: FiltryUslug = BEZ_FILTROW) {
  const { punkty, zasiegM, wPliku } = punktyBranzy(plikBranzy(branza), filtry)
  return { komorki: popyt(), punkty, promien: zasiegM, wPliku }
}

const MIEJSCA: Miejsce[] = [
  { lon: 19.9385, lat: 50.0614 }, // centrum Krakowa
  { lon: 19.9, lat: 50.02 }, // Skotniki
  { lon: 20.0, lat: 50.09 }, // Nowa Huta
  { lon: 19.95, lat: 50.04 },
  { lon: 20.2, lat: 50.2 }, // peryferie, mało adresów
  { lon: 20.9, lat: 50.4 }, // poza danymi o popycie
  { lon: 19.85, lat: 50.08 },
  { lon: 19.99, lat: 50.05 },
]

const bliskie = (x: number, y: number) => Math.abs(x - y) <= 1e-9 * (1 + Math.abs(y))

test(
  'ocena miejsca na prawdziwych danych liczy się w ułamku milisekundy (cel: poniżej 1 ms)',
  opcje,
  (t) => {
    const indeksKomorek = przygotujKomorki(popyt())
    for (const branza of POMIAROWE) {
      const { punkty, promien } = wczytaj(branza)
      const [indeks, czasIndeksu] = zmierz(() => zbudujIndeks(indeksKomorek, punkty, promien))
      const [plamy, czasPlam] = zmierz(() => bialePlamyZIndeksu(indeks))
      const czasy: number[] = []
      // Dwa przebiegi: pierwszy na zimnym JIT, drugi na rozgrzanym kodzie.
      for (let przebieg = 0; przebieg < 2; przebieg++)
        for (const miejsce of MIEJSCA) {
          const [, czas] = zmierz(() => ocenMiejsceWIndeksie(indeks, miejsce))
          czasy.push(czas)
          // Także PIERWSZE wywołania (zimny JIT) mieszczą się w celu z przeglądu E10.
          assert.ok(
            czas < 200,
            `${branza}: ocena ${JSON.stringify(miejsce)} trwała ${czas.toFixed(1)} ms`,
          )
        }
      const rozgrzane = czasy.slice(MIEJSCA.length).sort((a, b) => a - b)
      const mediana = rozgrzane[Math.floor(rozgrzane.length / 2)] as number
      t.diagnostic(
        `${branza} (${punkty.length} punktów, ${promien} m): indeks ${czasIndeksu.toFixed(0)} ms, ` +
          `białe plamy ${czasPlam.toFixed(0)} ms (${plamy.length} heksów), ` +
          `ocena: mediana ${mediana.toFixed(3)} ms, maksimum ${(rozgrzane.at(-1) as number).toFixed(3)} ms`,
      )
      // Zapas ponad dziesięciokrotny względem pomiaru (0,01–0,08 ms): łapie powrót do pełnego przeliczenia.
      assert.ok(mediana < 1, `${branza}: mediana oceny ${mediana.toFixed(3)} ms`)
      assert.ok(
        czasIndeksu + czasPlam < 3000,
        `${branza}: indeks i białe plamy powinny liczyć się raz`,
      )
    }
  },
)

test('indeks liczy się raz: kolejne oceny nie przebudowują siatek', opcje, () => {
  const { komorki, punkty, promien } = wczytaj('sklep_spozywczy')
  const indeks = zbudujIndeks(przygotujKomorki(komorki), punkty, promien)
  const przed = { komorki: indeks.komorki, siatka: indeks.siatkaPunktow, rozklad: indeks.rozklad }
  for (const miejsce of MIEJSCA) ocenMiejsceWIndeksie(indeks, miejsce)
  assert.equal(indeks.komorki, przed.komorki)
  assert.equal(indeks.siatkaPunktow, przed.siatka)
  assert.equal(indeks.rozklad, przed.rozklad)
})

/**
 * Porównuje indeks z przeliczeniem pełnym (każdy heks × każdy punkt, bez siatek): przydziały
 * całego rynku i ocenę kilku miejsc, w tym dwóch dokładnie na istniejących punktach (punkt jest
 * wtedy ZASTĘPOWANY, nie dublowany). Pełne przeliczenie trwa ok. 1,3 s na miejsce.
 */
function porownajZPelnym(
  t: { diagnostic(tekst: string): void },
  etykieta: string,
  komorki: readonly KomorkaPopytu[],
  punkty: ReturnType<typeof wczytaj>['punkty'],
  promien: number,
  indeks: IndeksBiznesu,
  miejsca: readonly Miejsce[],
  naIstniejacych: number,
) {
  const przed = przydzialyPelne(komorki, punkty, promien)
  // Przydziały popytu i adresów oraz liczba heksów w zasięgu: każdy punkt, nie tylko próbka.
  for (let j = 0; j < punkty.length; j++) {
    assert.ok(
      bliskie(indeks.przydzialPopytu[j] as number, przed.popyt[j] as number),
      `${etykieta}: popyt ${j}`,
    )
    assert.ok(
      bliskie(indeks.przydzialAdresow[j] as number, przed.adresy[j] as number),
      `${etykieta}: adresy ${j}`,
    )
    assert.equal(indeks.heksowWZasiegu[j], przed.heksow[j], `${etykieta}: heksy w zasięgu ${j}`)
  }
  const naSklepach = punkty
    .map((p, j) => ({ p, j }))
    .filter(({ j }) => (indeks.heksowWZasiegu[j] as number) > 20)
    .slice(0, naIstniejacych)
    .map(({ p }) => ({ lon: p[0] + 0.00003, lat: p[1] - 0.00002 }))
  let zastapione = 0
  for (const miejsce of [...miejsca, ...naSklepach]) {
    const a = ocenMiejsceWIndeksie(indeks, miejsce)
    const [b, czas] = zmierz(() => ocenaPelna(komorki, punkty, promien, miejsce, przed))
    t.diagnostic(
      `${etykieta}: pełne przeliczenie ${JSON.stringify(miejsce)}: ${czas.toFixed(0)} ms`,
    )
    if (b.zastapiony >= 0) zastapione++
    for (const pole of [
      'adresyWZasiegu',
      'mieszkancyWZasiegu',
      'kursySzczytSrednio',
      'przydzieloneAdresy',
      'przydzielonyPopyt',
    ] as const)
      assert.ok(bliskie(a[pole], b[pole]), `${etykieta} ${pole}: ${a[pole]} vs ${b[pole]}`)
    for (const pole of [
      'konkurenci',
      'udzialProcent',
      'percentyl',
      'porownanoZ',
      'najblizszyKonkurent',
      'odlegloscKonkurenta',
    ] as const)
      assert.equal(a[pole], b[pole], `${etykieta} ${pole} dla ${JSON.stringify(miejsce)}`)
    // Udziały popytu w zasięgu domykają się do liczby adresów w zasięgu.
    assert.ok(bliskie(a.przydzieloneAdresy + b.adresyKonkurentow, a.adresyWZasiegu))
  }
  // Zwykłe miejsce kontrolne (np. centrum) też może wypaść w 25 m od punktu, więc „co najmniej”.
  assert.ok(
    zastapione >= naIstniejacych,
    `${etykieta}: miejsca na istniejących punktach: ${zastapione}`,
  )
}

test(
  'wynik przyrostowy = przeliczenie całego miasta na prawdziwych danych (sklep, zasięg z katalogu)',
  opcje,
  (t) => {
    const { komorki, punkty, promien } = wczytaj('sklep_spozywczy')
    const indeks = zbudujIndeks(przygotujKomorki(komorki), punkty, promien)
    // Pełne przeliczenie trwa ok. 1,3 s na miejsce, więc tylko kilka punktów kontrolnych.
    porownajZPelnym(
      t,
      'sklep_spozywczy',
      komorki,
      punkty,
      promien,
      indeks,
      [MIEJSCA[0], MIEJSCA[2], MIEJSCA[4]] as Miejsce[],
      2,
    )
  },
)

for (const branza of ['paczkomat', 'restauracja'] as const)
  test(
    `wynik przyrostowy = przeliczenie całego miasta na prawdziwych danych (${branza})`,
    opcje,
    (t) => {
      const { komorki, punkty, promien } = wczytaj(branza)
      const indeks = zbudujIndeks(przygotujKomorki(komorki), punkty, promien)
      porownajZPelnym(
        t,
        branza,
        komorki,
        punkty,
        promien,
        indeks,
        [MIEJSCA[0], MIEJSCA[4]] as Miejsce[],
        1,
      )
    },
  )

test(
  'rozkład porównawczy pomija punkty spoza obszaru popytu (usługi obejmują też obwarzanek)',
  opcje,
  () => {
    const katalog = JSON.parse(readFileSync(sciezka('uslugi/katalog.json'), 'utf8')) as KatalogUslug
    const komorki = przygotujKomorki(popyt())
    let bezPopytuRazem = 0
    for (const { id } of katalog.branze) {
      const { punkty, promien } = wczytaj(id)
      const indeks = zbudujIndeks(komorki, punkty, promien)
      const bezPopytu = Array.from(indeks.heksowWZasiegu).filter((n) => n === 0).length
      bezPopytuRazem += bezPopytu
      // Rozkład to dokładnie punkty z popytem w zasięgu: punkt bez popytu nie rozmywa percentyla zerem.
      assert.equal(indeks.rozklad.length, punkty.length - bezPopytu, id)
      assert.ok(
        indeks.rozklad.every((v) => v > 0),
        `${id}: zero w rozkładzie`,
      )
      assert.ok(
        indeks.rozklad.every((v, i, r) => i === 0 || (r[i - 1] as number) <= v),
        `${id}: rozkład nie jest posortowany`,
      )
    }
    assert.ok(bezPopytuRazem > 1000, `punktów spoza popytu w 26 branżach: ${bezPopytuRazem}`)
    // Duże branże mają ich setki, a ocena w centrum porównuje się wyłącznie z punktami z popytem.
    for (const id of ['sklep_spozywczy', 'paczkomat', 'restauracja']) {
      const { punkty, promien } = wczytaj(id)
      const indeks = zbudujIndeks(komorki, punkty, promien)
      const bezPopytu = punkty.length - indeks.rozklad.length
      assert.ok(bezPopytu > 100, `${id}: poza popytem tylko ${bezPopytu} punktów`)
      // Miejsce kontrolne w Krakowie, bez punktu w promieniu „tego samego obiektu” (miejsce na
      // istniejącym punkcie porównuje się bez niego samego, co ma własny test w biznes.test.ts).
      const wolne = MIEJSCA.find(
        (m) =>
          !punkty.some(
            ([lon, lat]) =>
              Math.hypot((lon - m.lon) * METRY_LON, (lat - m.lat) * METRY_LAT) <=
              PROMIEN_TEGO_SAMEGO_M,
          ),
      ) as Miejsce
      const kontrolne = ocenMiejsceWIndeksie(indeks, wolne)
      assert.equal(kontrolne.porownanoZ, indeks.rozklad.length, id)
      assert.ok(kontrolne.adresyWZasiegu > 0 && kontrolne.percentyl !== null, id)
      // Punkt spoza obszaru popytu nie ma heksu w zasięgu: ocena w jego miejscu to „brak danych o popycie”.
      const j = Array.from(indeks.heksowWZasiegu).findIndex((n) => n === 0)
      const p = punkty[j] as (typeof punkty)[number]
      const naMargines = ocenMiejsceWIndeksie(indeks, { lon: p[0], lat: p[1] })
      assert.equal(naMargines.adresyWZasiegu, 0, `${id}: ${p[2] || 'punkt bez nazwy'}`)
      assert.equal(naMargines.percentyl, null, id)
    }
  },
)

test('białe plamy na prawdziwych danych: osobna kategoria „brak punktu w zasięgu”', opcje, () => {
  for (const branza of ['sklep_spozywczy', 'myjnia']) {
    const { komorki, punkty, promien } = wczytaj(branza)
    const indeks = zbudujIndeks(przygotujKomorki(komorki), punkty, promien)
    const plamy = bialePlamyZIndeksu(indeks)
    assert.equal(plamy.length, komorki.length)
    const bez = plamy.filter(bezPunktu)
    const z = plamy.filter((p) => !bezPunktu(p))
    assert.ok(bez.length > 0 && z.length > 0, branza)
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
      assert.equal(ocena.adresyWZasiegu, p.adresyWZasiegu, branza)
    }
  }
})

// ── Filtry konkurencji w silniku ─────────────────────────────────────────────────────────

test(
  'filtr liczy się tak, jakby wycięte punkty w ogóle nie istniały (konkurenci i percentyl)',
  opcje,
  () => {
    const przypadki: { branza: string; filtry: FiltryUslug }[] = [
      { branza: 'dentysta', filtry: { min2Zrodla: false, flagi: { nfz: 'tylko' } } },
      { branza: 'restauracja', filtry: { min2Zrodla: false, flagi: { fast_food: 'bez' } } },
      { branza: 'fryzjer', filtry: { min2Zrodla: false, flagi: { barber: 'tylko' } } },
      { branza: 'sklep_spozywczy', filtry: { min2Zrodla: true, flagi: {} } },
      { branza: 'apteka', filtry: { min2Zrodla: true, flagi: {} } },
    ]
    const komorki = przygotujKomorki(popyt())
    for (const { branza, filtry } of przypadki) {
      const wszystkie = wczytaj(branza)
      const zawezone = wczytaj(branza, filtry)
      assert.ok(
        zawezone.punkty.length > 0 && zawezone.punkty.length < wszystkie.punkty.length,
        branza,
      )
      assert.equal(zawezone.wPliku, wszystkie.punkty.length, `${branza}: „z N” to punkty pliku`)
      const pelny = zbudujIndeks(komorki, wszystkie.punkty, wszystkie.promien)
      const indeks = zbudujIndeks(komorki, zawezone.punkty, zawezone.promien)
      // Zasięg nie zależy od filtra.
      assert.equal(zawezone.promien, wszystkie.promien)
      assert.ok(
        indeks.rozklad.length < pelny.rozklad.length,
        `${branza}: rozkład po filtrze jest mniejszy`,
      )
      const miejsca = [MIEJSCA[0], MIEJSCA[2], MIEJSCA[3]] as Miejsce[]
      for (const miejsce of miejsca) {
        const przed = ocenMiejsceWIndeksie(pelny, miejsce)
        const po = ocenMiejsceWIndeksie(indeks, miejsce)
        // Mniej konkurentów, nie więcej, a rozkład porównawczy składa się tylko z zawężonej listy.
        assert.ok(
          po.konkurenci <= przed.konkurenci,
          `${branza}: konkurenci ${po.konkurenci} > ${przed.konkurenci}`,
        )
        assert.ok(po.porownanoZ <= indeks.rozklad.length)
        assert.ok(
          po.przydzieloneAdresy >= przed.przydzieloneAdresy - 1e-9,
          `${branza}: miejsce nie może zyskać mniej, gdy ubywa konkurencji`,
        )
        // Adresy w zasięgu to popyt, nie konkurencja: filtr ich nie rusza.
        assert.equal(po.adresyWZasiegu, przed.adresyWZasiegu)
      }
    }
  },
)

test(
  'ocena po filtrze zgadza się z pełnym przeliczeniem na zawężonej liście (dentysta z NFZ)',
  opcje,
  () => {
    const filtry: FiltryUslug = { min2Zrodla: false, flagi: { nfz: 'tylko' } }
    const { komorki, punkty, promien } = wczytaj('dentysta', filtry)
    assert.equal(punkty.length, 155, 'flaga nfz ma 155 punktów dentysty')
    const indeks = zbudujIndeks(przygotujKomorki(komorki), punkty, promien)
    const przed = przydzialyPelne(komorki, punkty, promien)
    for (const miejsce of [MIEJSCA[0], MIEJSCA[2], MIEJSCA[4]] as Miejsce[]) {
      const a = ocenMiejsceWIndeksie(indeks, miejsce)
      const b = ocenaPelna(komorki, punkty, promien, miejsce, przed)
      assert.equal(a.konkurenci, b.konkurenci)
      assert.equal(a.percentyl, b.percentyl)
      assert.equal(a.porownanoZ, b.porownanoZ)
      assert.ok(bliskie(a.przydzielonyPopyt, b.przydzielonyPopyt))
    }
  },
)

test(
  'lista pusta po filtrach: ocena bez konkurencji i bez percentyla, a nie wyjątek',
  opcje,
  () => {
    // Filtry mogą wyciąć wszystkie punkty (ekran pokazuje wtedy ostrzeżenie), więc silnik musi to znieść.
    const indeks = zbudujIndeks(przygotujKomorki(popyt()), [], 1000)
    const ocena = ocenMiejsceWIndeksie(indeks, MIEJSCA[0] as Miejsce)
    assert.equal(ocena.konkurenci, 0)
    assert.equal(ocena.percentyl, null)
    assert.equal(ocena.porownanoZ, 0)
    assert.equal(ocena.najblizszyKonkurent, null)
    assert.ok(ocena.adresyWZasiegu > 0)
    assert.equal(ocena.udzialProcent, 100)
    const plamy = bialePlamyZIndeksu(indeks)
    assert.equal(plamy.length, popyt().length)
    assert.ok(plamy.every(bezPunktu))
  },
)
