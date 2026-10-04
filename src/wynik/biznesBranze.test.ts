// Słownik branż trybu „Biznes” (E10, #105–#107): aliasy starych linków, grupy listy, odmiana
// i filtry flagowe. Testy na prawdziwym katalogu `public/dane/uslugi` pilnują, żeby nowa branża
// z ETL nie została bez grupy, odmiany albo filtra (bez katalogu są pomijane).
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  ALIASY_BRANZ,
  BRANZE_W_DOPELNIACZU,
  branzaWDopelniaczu,
  DOMYSLNA_BRANZA,
  ETYKIETA_MIN_2_ZRODLA,
  FILTRY_FLAG,
  filtrFlagiWlaczony,
  filtryFlagBranzy,
  GRUPA_INNE,
  GRUPY_BRANZ,
  grupujBranze,
  konkurencjaWDopelniaczu,
  opisFiltrow,
  rozwiazBranze,
  zFiltremFlagi,
  zFiltremZrodel,
} from './biznesBranze.ts'
import { BEZ_FILTROW, czytajKatalog, type KatalogUslug, type PlikUslug } from './biznesUslugi.ts'
import { pobierzStan } from './stan.ts'
import { czytajHash, zapiszHash } from './url.ts'

const PAUZA = String.fromCodePoint(0x2014)
const ZNANE = ['sklep_spozywczy', 'poz', 'apteka', 'dentysta', 'restauracja', 'fryzjer']

// ── Aliasy starych linków ────────────────────────────────────────────────────────────────

test('stare id z linków prowadzą do branż z katalogu usług', () => {
  assert.equal(rozwiazBranze('sklep'), 'sklep_spozywczy')
  assert.equal(rozwiazBranze('przychodnia'), 'poz')
  assert.equal(rozwiazBranze('kosmetyczka'), 'salon_kosmetyczny')
  assert.equal(rozwiazBranze('mieso'), 'sklep_miesny')
  assert.equal(rozwiazBranze('zoologiczny'), 'sklep_zoologiczny')
  // Ze znanym katalogiem alias nadal działa (id po aliasie jest w katalogu).
  assert.equal(rozwiazBranze('sklep', ZNANE), 'sklep_spozywczy')
  assert.equal(rozwiazBranze('przychodnia', ZNANE), 'poz')
})

test('id z katalogu przechodzi bez zmian, a nieznane wraca do domyślnej branży', () => {
  for (const id of ZNANE) {
    assert.equal(rozwiazBranze(id), id)
    assert.equal(rozwiazBranze(id, ZNANE), id)
  }
  assert.equal(rozwiazBranze('nie_ma_takiej', ZNANE), DOMYSLNA_BRANZA)
  assert.equal(rozwiazBranze('', ZNANE), DOMYSLNA_BRANZA)
  // Bez katalogu (jeszcze się nie wczytał) nieznane id nie jest zamieniane: nie wiadomo, czy jest nieznane.
  assert.equal(rozwiazBranze('nie_ma_takiej'), 'nie_ma_takiej')
  // Alias jest idempotentny: drugi przebieg niczego nie zmienia.
  for (const alias of Object.keys(ALIASY_BRANZ))
    assert.equal(rozwiazBranze(rozwiazBranze(alias)), rozwiazBranze(alias))
  // Zbiór i tablica dają to samo.
  assert.equal(rozwiazBranze('sklep', new Set(ZNANE)), 'sklep_spozywczy')
})

test('klucze prototypu obiektu nie są branżami ani aliasami', () => {
  for (const id of ['constructor', 'toString', 'hasOwnProperty', '__proto__', 'valueOf']) {
    assert.equal(rozwiazBranze(id), id)
    assert.equal(rozwiazBranze(id, ZNANE), DOMYSLNA_BRANZA)
    assert.equal(branzaWDopelniaczu(id), 'punktów tej branży')
    assert.deepEqual(filtryFlagBranzy(id), [])
    assert.equal(konkurencjaWDopelniaczu(id, BEZ_FILTROW), 'punktów tej branży')
  }
})

test('stary link ze sklepem czytany przez url.ts trafia do sklepu spożywczego', () => {
  // `url.ts` czyta parametr `b` bez zmian i dla pustego linku daje stary id `sklep`.
  assert.equal(czytajHash('#/biznes').branza, 'sklep')
  assert.equal(rozwiazBranze(czytajHash('#/biznes').branza ?? ''), DOMYSLNA_BRANZA)
  const stary = czytajHash('#/biznes?b=sklep&a=19.940000,50.060000')
  assert.equal(stary.branza, 'sklep')
  assert.equal(rozwiazBranze(stary.branza ?? '', ZNANE), 'sklep_spozywczy')
  // Punkty ze starego linku są przy tym zachowane: alias nie czyści stanu.
  assert.deepEqual(stary.punktA, { lon: 19.94, lat: 50.06 })
  assert.equal(rozwiazBranze(czytajHash('#/biznes?b=przychodnia').branza ?? '', ZNANE), 'poz')
  // Nowe id z podkreśleniem przechodzi regułę parametru `b` i wraca po zapisie.
  const nowy = czytajHash('#/biznes?b=sklep_spozywczy')
  assert.equal(nowy.branza, 'sklep_spozywczy')
  assert.ok(zapiszHash(nowy).includes('b=sklep_spozywczy'))
  const salon = czytajHash('#/biznes?b=salon_kosmetyczny')
  assert.equal(salon.branza, 'salon_kosmetyczny')
})

test('domyślna branża w stanie aplikacji (stare id) wczytuje sklep spożywczy', () => {
  // `stan.ts` zostaje przy starym id `sklep`; ekran wczytuje plik po aliasie, więc stan i URL się nie zmieniają.
  assert.equal(rozwiazBranze(pobierzStan().branza), DOMYSLNA_BRANZA)
  assert.equal(rozwiazBranze(pobierzStan().branza, ZNANE), DOMYSLNA_BRANZA)
})

// ── Grupy listy ──────────────────────────────────────────────────────────────────────────

test('grupowanie zachowuje kolejność grup i branż, a branże spoza słownika idą do „Inne”', () => {
  const branze = [
    { id: 'myjnia' },
    { id: 'nowa_branza' },
    { id: 'apteka' },
    { id: 'sklep_spozywczy' },
    { id: 'poz' },
  ]
  const grupy = grupujBranze(branze)
  assert.deepEqual(
    grupy.map((g) => [g.nazwa, g.branze.map((b) => b.id)]),
    [
      ['Zdrowie', ['apteka', 'poz']],
      ['Handel', ['sklep_spozywczy']],
      ['Auto', ['myjnia']],
      [GRUPA_INNE.nazwa, ['nowa_branza']],
    ],
  )
  assert.deepEqual(grupujBranze([]), [])
})

test('grupy mają unikalne id i nazwy, a branża stoi w jednej grupie', () => {
  const grupy = new Set(GRUPY_BRANZ.map((g) => g.id))
  assert.equal(grupy.size, GRUPY_BRANZ.length)
  assert.equal(new Set(GRUPY_BRANZ.map((g) => g.nazwa)).size, GRUPY_BRANZ.length)
  const wszystkie = GRUPY_BRANZ.flatMap((g) => g.branze)
  assert.equal(new Set(wszystkie).size, wszystkie.length, 'branża w dwóch grupach')
  assert.ok(!grupy.has(GRUPA_INNE.id))
})

// ── Filtry flagowe, opisy ────────────────────────────────────────────────────────────────

test('filtr flagowy włącza się i wyłącza bez mutowania poprzednich ustawień', () => {
  const [nfz] = filtryFlagBranzy('dentysta')
  assert.ok(nfz)
  assert.equal(filtrFlagiWlaczony(BEZ_FILTROW, nfz), false)
  const wlaczone = zFiltremFlagi(BEZ_FILTROW, nfz, true)
  assert.deepEqual(wlaczone.flagi, { nfz: 'tylko' })
  assert.equal(filtrFlagiWlaczony(wlaczone, nfz), true)
  assert.deepEqual(BEZ_FILTROW.flagi, {}, 'stała BEZ_FILTROW nie może się zmienić')
  const wylaczone = zFiltremFlagi(wlaczone, nfz, false)
  assert.deepEqual(wylaczone.flagi, {})
  assert.deepEqual(wlaczone.flagi, { nfz: 'tylko' })
  // Włączenie jednego filtra nie rusza „co najmniej 2 źródła” i odwrotnie.
  const zeZrodlami = zFiltremZrodel(wlaczone, true)
  assert.equal(zeZrodlami.min2Zrodla, true)
  assert.deepEqual(zeZrodlami.flagi, { nfz: 'tylko' })
  assert.equal(zFiltremZrodel(zeZrodlami, false).min2Zrodla, false)
  // Filtr z innego trybu (restauracja „bez”) nie jest włączony, gdy ustawiono „tylko”.
  const [fast] = filtryFlagBranzy('restauracja')
  assert.ok(fast)
  assert.equal(
    filtrFlagiWlaczony({ min2Zrodla: false, flagi: { fast_food: 'tylko' } }, fast),
    false,
  )
  assert.equal(filtrFlagiWlaczony(zFiltremFlagi(BEZ_FILTROW, fast, true), fast), true)
})

test('konkurencja w zdaniu mówi, z kim porównano: dentysta z NFZ, restauracje bez fast foodu', () => {
  assert.equal(konkurencjaWDopelniaczu('dentysta', BEZ_FILTROW), 'gabinetów stomatologicznych')
  assert.equal(
    konkurencjaWDopelniaczu('dentysta', { min2Zrodla: false, flagi: { nfz: 'tylko' } }),
    'gabinetów stomatologicznych z umową NFZ',
  )
  assert.equal(
    konkurencjaWDopelniaczu('restauracja', { min2Zrodla: false, flagi: { fast_food: 'bez' } }),
    'restauracji bez fast foodów',
  )
  assert.equal(
    konkurencjaWDopelniaczu('fryzjer', { min2Zrodla: false, flagi: { barber: 'tylko' } }),
    'barberów',
  )
  // „Co najmniej 2 źródła” nie zmienia rodzaju punktów, więc nie zmienia rzeczownika.
  assert.equal(konkurencjaWDopelniaczu('apteka', { ...BEZ_FILTROW, min2Zrodla: true }), 'aptek')
  // Flaga innej branży (zostaje w stanie po zmianie branży) niczego nie zmienia.
  assert.equal(
    konkurencjaWDopelniaczu('apteka', { min2Zrodla: false, flagi: { nfz: 'tylko' } }),
    'aptek',
  )
  // Stary alias też się odmienia.
  assert.equal(konkurencjaWDopelniaczu('sklep', BEZ_FILTROW), 'sklepów spożywczych')
})

test('opis filtrów na karcie: brak filtrów to brak zdania, filtry po przecinku', () => {
  assert.equal(opisFiltrow('dentysta', BEZ_FILTROW), null)
  assert.equal(
    opisFiltrow('dentysta', { min2Zrodla: false, flagi: { nfz: 'tylko' } }),
    'Konkurencja po filtrach: tylko gabinety z umową NFZ.',
  )
  assert.equal(
    opisFiltrow('dentysta', { min2Zrodla: true, flagi: { nfz: 'tylko' } }),
    'Konkurencja po filtrach: tylko punkty potwierdzone w co najmniej 2 źródłach, tylko gabinety z umową NFZ.',
  )
  assert.equal(
    opisFiltrow('sklep_spozywczy', { ...BEZ_FILTROW, min2Zrodla: true }),
    'Konkurencja po filtrach: tylko punkty potwierdzone w co najmniej 2 źródłach.',
  )
  // Flaga obca dla branży nie trafia do opisu.
  assert.equal(opisFiltrow('apteka', { min2Zrodla: false, flagi: { nfz: 'tylko' } }), null)
  assert.ok(ETYKIETA_MIN_2_ZRODLA.startsWith('Tylko punkty'))
})

test('żaden tekst słownika nie ma pauzy (w polskim UI jest półpauza)', () => {
  const teksty = [
    ...Object.values(BRANZE_W_DOPELNIACZU),
    ...GRUPY_BRANZ.map((g) => g.nazwa),
    ...Object.values(FILTRY_FLAG).flatMap((l) =>
      l.flatMap((d) => [d.etykieta, d.opis, d.konkurencja]),
    ),
    ETYKIETA_MIN_2_ZRODLA,
  ]
  for (const t of teksty) assert.ok(!t.includes(PAUZA), t)
})

// ── Zgodność z prawdziwym katalogiem ─────────────────────────────────────────────────────

const sciezka = (plik: string) =>
  fileURLToPath(new URL(`../../public/dane/uslugi/${plik}`, import.meta.url))
const maDane = existsSync(sciezka('katalog.json'))
const opcje = { skip: maDane ? false : 'brak public/dane/uslugi/katalog.json' }
const katalog = (): KatalogUslug =>
  czytajKatalog(JSON.parse(readFileSync(sciezka('katalog.json'), 'utf8')))

test('aliasy nie przesłaniają branż z katalogu i wskazują branże, które w nim są', opcje, () => {
  const ids = new Set(katalog().branze.map((b) => b.id))
  for (const [alias, cel] of Object.entries(ALIASY_BRANZ)) {
    assert.ok(!ids.has(alias), `alias ${alias} jest też id branży`)
    assert.ok(ids.has(cel), `alias ${alias} wskazuje ${cel}, którego nie ma w katalogu`)
  }
  assert.ok(ids.has(DOMYSLNA_BRANZA))
})

test('każda z 26 branż z katalogu ma grupę, własną odmianę i brak martwych wpisów', opcje, () => {
  const k = katalog()
  const ids = new Set(k.branze.map((b) => b.id))
  assert.equal(ids.size, 26)
  for (const { id, nazwa } of k.branze) {
    assert.ok(Object.hasOwn(BRANZE_W_DOPELNIACZU, id), `brak odmiany dla ${nazwa} (${id})`)
    assert.notEqual(branzaWDopelniaczu(id), 'punktów tej branży', id)
    assert.ok(
      GRUPY_BRANZ.some((g) => g.branze.includes(id)),
      `${nazwa} (${id}) nie ma grupy`,
    )
  }
  // Wpisy słownika bez branży w katalogu byłyby martwe (literówka w id).
  for (const id of Object.keys(BRANZE_W_DOPELNIACZU)) assert.ok(ids.has(id), `odmiana dla ${id}`)
  for (const g of GRUPY_BRANZ)
    for (const id of g.branze) assert.ok(ids.has(id), `grupa ${g.id}: ${id}`)
  for (const id of Object.keys(FILTRY_FLAG)) assert.ok(ids.has(id), `filtr dla ${id}`)
  // Lista z katalogu: wszystkie 26 branż, każda raz, bez grupy „Inne”.
  const grupy = grupujBranze(k.branze)
  assert.deepEqual(
    grupy.map((g) => g.id),
    GRUPY_BRANZ.map((g) => g.id),
  )
  assert.equal(grupy.flatMap((g) => g.branze).length, 26)
  assert.ok(!grupy.some((g) => g.id === GRUPA_INNE.id))
})

test(
  'każda flaga z plików branż ma filtr, a każdy filtr wskazuje flagę z pliku i z katalogu',
  opcje,
  () => {
    const k = katalog()
    const plik = (id: string) =>
      JSON.parse(readFileSync(sciezka(`${id}.json`), 'utf8')) as PlikUslug
    let flag = 0
    for (const b of k.branze) {
      const wPliku = Object.keys(plik(b.id).bityFlag ?? {})
      const zFiltrow = filtryFlagBranzy(b.id).map((d) => d.flaga)
      assert.deepEqual(zFiltrow.sort(), wPliku.sort(), `flagi i filtry branży ${b.id}`)
      for (const def of filtryFlagBranzy(b.id)) {
        assert.ok(def.flaga in b.mapowanie.flagi, `${b.id}: flaga ${def.flaga} w katalogu`)
        assert.ok(def.etykieta.length > 5 && def.opis.length > 20 && def.konkurencja.length > 3)
        flag++
      }
    }
    assert.equal(flag, 3)
  },
)

test('dentysta z NFZ: opis nie obiecuje więcej niż flaga (brak wpisu nie dowodzi braku umowy)', () => {
  const [nfz] = filtryFlagBranzy('dentysta')
  assert.ok(nfz)
  assert.match(nfz.etykieta, /umow/)
  assert.match(nfz.opis, /Informator/)
  assert.match(nfz.opis, /nie dowodzi braku umowy/)
})
