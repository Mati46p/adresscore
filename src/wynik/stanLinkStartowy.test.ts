// Link jest źródłem prawdy od pierwszej klatki (#108): branża, miejsca A–E i filtry Biznesu z linku są
// w stanie ZANIM wczytają się adresy (2–12 s), a zmiana użytkownika w tym oknie nie jest cofana,
// gdy adresy się wczytają. Regresja: `podlaczDane` czytał link drugi raz i przywracał wybór z linku.
//
// Stan aplikacji to moduł z jednym obiektem, więc testy idą jedną historią, po kolei – tak jak
// użytkownik: wejście z linku → zmiany w oknie ładowania → adresy → dalsza nawigacja.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { BEZ_FILTROW } from './biznesUslugi.ts'
import {
  pobierzStan,
  podlaczDane,
  ustawBranze,
  ustawFiltryBiznesu,
  ustawPunktBiznesu,
  wczytajLinkStartowy,
  zastosujUrlPrzedDanymi,
  zastosujZmianeUrl,
} from './stan.ts'
import { czytajHash, ID_MIEJSC } from './url.ts'

const A = '19.940000,50.060000'
const C = '19.950000,50.070000'
const PUNKT_A = { lon: 19.94, lat: 50.06 }
const PUNKT_B = { lon: 19.95, lat: 50.07 }
/** Miejsca A–E: `null` = puste. */
const miejsca = (...zajete: ({ lon: number; lat: number } | null)[]) =>
  ID_MIEJSC.map((_, i) => zajete[i] ?? null)
const WSKAZNIKI = [
  { id: 'halas_ldwn', kategoria: 'spokoj' as const },
  { id: 'sklep_odleglosc', kategoria: 'codziennosc' as const },
]

test('start z linku: stan ma branżę, miejsca i filtry, zanim adresy się wczytają', () => {
  // Miejsca w zapisie `m=` (puste pozycje między średnikami): A i C, a nie A i B.
  wczytajLinkStartowy(czytajHash(`#/biznes?b=apteka&m=${A};;${C}&k=2z`))
  const s = pobierzStan()
  assert.equal(s.ekran, 'biznes')
  assert.equal(s.tryb, 'biznes')
  assert.equal(s.branza, 'apteka')
  assert.deepEqual(s.miejsca, miejsca(PUNKT_A, null, PUNKT_B))
  assert.deepEqual(s.filtryBiznesu, { min2Zrodla: true, flagi: {} })
})

test('zmiana hasha przed adresami (wklejony link, Wstecz) też od razu trafia do stanu', () => {
  // Stary link z `a=` (miejsce A) nadal działa.
  zastosujUrlPrzedDanymi(czytajHash(`#/biznes?b=restauracja&a=${A}&k=-fast_food`))
  const s = pobierzStan()
  assert.equal(s.branza, 'restauracja')
  assert.deepEqual(s.miejsca, miejsca(PUNKT_A))
  assert.deepEqual(s.filtryBiznesu, { min2Zrodla: false, flagi: { fast_food: 'bez' } })
})

test('przejście na inny ekran i z powrotem przed adresami nie gubi wyboru', () => {
  zastosujUrlPrzedDanymi(czytajHash('#/porownanie'))
  assert.equal(pobierzStan().ekran, 'porownanie')
  assert.equal(pobierzStan().branza, 'restauracja')
  assert.deepEqual(pobierzStan().miejsca, miejsca(PUNKT_A))
  zastosujUrlPrzedDanymi(czytajHash(`#/biznes?b=restauracja&a=${A}&k=-fast_food`))
  assert.equal(pobierzStan().ekran, 'biznes')
})

test('zmiana użytkownika w trakcie ładowania przeżywa wczytanie adresów', () => {
  // Użytkownik nie czeka na adresy: zmienia branżę, stawia miejsce B i włącza filtr.
  ustawBranze('fryzjer')
  ustawPunktBiznesu('b', PUNKT_B)
  ustawFiltryBiznesu({ min2Zrodla: true, flagi: { barber: 'tylko' } })
  const przed = pobierzStan()
  // Link nadal (do tej chwili) mówi o restauracji – dokładnie tak wyglądał błąd.
  podlaczDane(['id-1', 'id-2'], WSKAZNIKI, [])
  const po = pobierzStan()
  assert.equal(po.branza, 'fryzjer')
  // Zmiana branży nie kasuje miejsc (te same lokalizacje można porównać dla innej branży).
  assert.deepEqual(po.miejsca, miejsca(PUNKT_A, PUNKT_B))
  assert.deepEqual(po.filtryBiznesu, { min2Zrodla: true, flagi: { barber: 'tylko' } })
  // Filtry ani miejsca nie dostają nowej tożsamości, więc worker nie przelicza się drugi raz.
  assert.equal(po.filtryBiznesu, przed.filtryBiznesu)
  assert.equal(po.miejsca, przed.miejsca)
  assert.equal(po.ekran, 'biznes')
})

test('po adresach link bez parametrów Biznesu nie kasuje wyboru (jak obiekty symulatora)', () => {
  zastosujZmianeUrl(czytajHash('#/porownanie'))
  let s = pobierzStan()
  assert.equal(s.ekran, 'porownanie')
  assert.equal(s.branza, 'fryzjer')
  assert.deepEqual(s.miejsca, miejsca(PUNKT_A, PUNKT_B))
  assert.deepEqual(s.filtryBiznesu, { min2Zrodla: true, flagi: { barber: 'tylko' } })

  zastosujZmianeUrl(czytajHash('#/miasto'))
  s = pobierzStan()
  assert.equal(s.ekran, 'symulator')
  assert.equal(s.branza, 'fryzjer')
})

test('po adresach link Biznesu zastępuje wybór, a gołe #/biznes przywraca domyślny', () => {
  zastosujZmianeUrl(czytajHash(`#/biznes?b=dentysta&c=${C}&k=nfz`))
  let s = pobierzStan()
  assert.equal(s.ekran, 'biznes')
  assert.equal(s.branza, 'dentysta')
  // Stary zapis `c=` to miejsce B; A zostaje puste, bo link jej nie ma.
  assert.deepEqual(s.miejsca, miejsca(null, PUNKT_B))
  assert.deepEqual(s.filtryBiznesu, { min2Zrodla: false, flagi: { nfz: 'tylko' } })

  zastosujZmianeUrl(czytajHash('#/biznes'))
  s = pobierzStan()
  assert.equal(s.branza, 'sklep')
  assert.deepEqual(s.miejsca, miejsca())
  assert.equal(s.filtryBiznesu, BEZ_FILTROW)
})
