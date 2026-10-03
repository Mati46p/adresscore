import assert from 'node:assert/strict'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { do2180, pierscien } from './lib/geo.mjs'
import { odlegloscDoObiektu, pierscienieZSciezki, rozbierzId } from './lib/nid-wms.mjs'
import { DANE, wczytajAdresy } from './lib/wspolne.mjs'
import {
  dataDanychRejestru,
  IndeksRejestru,
  kluczSondy,
  opisWskaznika,
  PROMIEN_M,
  pokrycieWykazu,
  rownolegle,
  SLOWNIK_ETYKIET,
  zbudujWpisy,
  zgodnoscAdresowa,
} from './zabytki-nid.mjs'

// Pauza (U+2014) jest zakazana w polskich tekstach projektu; zapis przez kod znaku, żeby sam
// plik testu jej nie zawierał.
const PAUZA = String.fromCharCode(0x2014)

// ── Pomocnicze ───────────────────────────────────────────────────────────────────────────────

const kwadrat = (i, x0, y0, x1, y1, pierscienieDodatkowe = []) => ({
  i,
  rodzaj: 'wielokat',
  pierscienie: [
    pierscien([
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
    ]),
    ...pierscienieDodatkowe,
  ],
  bbox: [x0, y0, x1, y1],
  pole: (x1 - x0) * (y1 - y0),
})
const punkt = (i, x, y) => ({
  i,
  rodzaj: 'punkt',
  pierscienie: [Float64Array.of(x, y)],
  bbox: [x, y, x, y],
  pole: 0,
})
const linia = (i, x0, y0, x1, y1) => ({
  i,
  rodzaj: 'linia',
  pierscienie: [Float64Array.of(x0, y0, x1, y1)],
  bbox: [Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1)],
  pole: 0,
})
const wpis = (o, klucz, klasa, liczony = true) => ({ o, klucz, typ: null, klasa, liczony })
const id = (typ, numer) => `PL.1.9.ZIPOZ.NID_N_12_${typ}.${numer}`

// ── Liczenie w promieniu i etykieta ──────────────────────────────────────────────────────────

test('IndeksRejestru: promień 500 m liczy odległość od obrysu, a nie od środka', () => {
  const budynek = kwadrat(0, 0, 0, 100, 100)
  const r = new IndeksRejestru([wpis(budynek, 'A', 'obiekt')])
  assert.equal(PROMIEN_M, 500)
  assert.deepEqual(r.zapytaj(50, 50), { liczba: 1, klasa: 'obiekt' }, 'adres w obrysie liczy się')
  // 499 m od krawędzi: w promieniu; 501 m: poza
  assert.equal(r.zapytaj(100 + 499, 50).liczba, 1)
  assert.equal(r.zapytaj(100 + 501, 50).liczba, 0)
  // po przekątnej: 300 m na wschód i 400 m na północ od narożnika = dokładnie 500 m (włącznie)
  assert.equal(r.zapytaj(400, 500).liczba, 1)
  assert.equal(r.zapytaj(400, 500.5).liczba, 0)
  // środek obiektu leży dalej niż 500 m, a krawędź w promieniu: obiekt jest liczony
  const duzy = new IndeksRejestru([wpis(kwadrat(1, 0, 0, 2000, 40), 'D', 'obiekt')])
  assert.equal(duzy.zapytaj(1000, 500).liczba, 1)
  assert.deepEqual(duzy.zapytaj(1000, 541), { liczba: 0, klasa: null })
})

test('IndeksRejestru: ten sam wpis w kilku częściach liczy się raz, otoczenie nie liczy się wcale, ale daje etykietę', () => {
  const r = new IndeksRejestru([
    wpis(kwadrat(0, 0, 0, 10, 10), 'ZESPOL', 'obszar'),
    wpis(kwadrat(1, 50, 0, 60, 10), 'ZESPOL', 'obszar'), // druga część tego samego wpisu
    wpis(kwadrat(2, 100, 0, 110, 10), 'BUDYNEK', 'obiekt'),
    wpis(kwadrat(3, 20, 0, 200, 200), 'OT-1', 'otoczenie', false),
  ])
  assert.deepEqual(
    r.zapytaj(55, 5),
    { liczba: 2, klasa: 'obszar' },
    'zespół w dwóch częściach liczy się raz, plus budynek; otoczenia nie liczymy',
  )
  assert.deepEqual(r.zapytaj(30, 100), { liczba: 2, klasa: 'otoczenie' })
  // nowe zapytanie nie dziedziczy stanu po poprzednim
  assert.deepEqual(r.zapytaj(5000, 5000), { liczba: 0, klasa: null })
})

test('IndeksRejestru: etykieta to najsilniejsza klasa wpisu, w którego obrysie leży adres; otwór i brzeg nie liczą się jak wnętrze', () => {
  const dziura = pierscien([
    [40, 40],
    [60, 40],
    [60, 60],
    [40, 60],
  ])
  const r = new IndeksRejestru([
    wpis(kwadrat(0, 0, 0, 100, 100), 'UKLAD', 'obszar'),
    wpis(kwadrat(1, 0, 0, 100, 100, [dziura]), 'PARK', 'obszar'),
    wpis(kwadrat(2, 45, 45, 55, 55), 'KAPLICA', 'obiekt'),
    wpis(kwadrat(3, -50, -50, 150, 150), 'OTOCZENIE', 'otoczenie', false),
  ])
  assert.equal(r.zapytaj(50, 50).klasa, 'obiekt', 'budynek w otworze parku')
  assert.equal(r.zapytaj(10, 10).klasa, 'obszar', 'obszar mocniejszy niż otoczenie')
  assert.equal(r.zapytaj(-20, 10).klasa, 'otoczenie')
  // linia i punkt nie mają wnętrza: wskazują tylko, że wpis jest w pobliżu
  const l = new IndeksRejestru([
    wpis(linia(0, 0, 0, 100, 0), 'MUR', 'obiekt'),
    wpis(punkt(1, 0, 0), 'KRZYZ', 'obiekt'),
  ])
  assert.deepEqual(l.zapytaj(0, 0), { liczba: 2, klasa: null })
})

test('IndeksRejestru: wynik zgodny z liczeniem brutalnym na losowych obiektach, także wielkich', () => {
  let ziarno = 4242
  const los = () => {
    ziarno = (ziarno * 1103515245 + 12345) % 2147483648
    return ziarno / 2147483648
  }
  const wpisy = []
  for (let i = 0; i < 400; i++) {
    const x = los() * 8000
    const y = los() * 8000
    const t = los()
    const o =
      t < 0.7
        ? kwadrat(i, x, y, x + 5 + los() * 60, y + 5 + los() * 60)
        : t < 0.85
          ? linia(i, x, y, x + los() * 300, y + los() * 300)
          : t < 0.97
            ? punkt(i, x, y)
            : kwadrat(i, x, y, x + 600 + los() * 900, y + 40 + los() * 80) // wielki, wąski
    // co czwarty obiekt ma wspólny klucz z poprzednim (wpis o kilku częściach); co dziesiąty to otoczenie
    const klucz = i % 4 === 3 ? `k${i - 1}` : `k${i}`
    wpisy.push(wpis(o, klucz, i % 10 === 0 ? 'otoczenie' : 'obiekt', i % 10 !== 0))
  }
  const r = new IndeksRejestru(wpisy)
  for (let n = 0; n < 150; n++) {
    const x = los() * 8000
    const y = los() * 8000
    const klucze = new Set()
    for (const w of wpisy)
      if (w.liczony && odlegloscDoObiektu(x, y, w.o) <= PROMIEN_M) klucze.add(w.klucz)
    assert.equal(r.zapytaj(x, y).liczba, klucze.size, `punkt ${n}`)
  }
})

test('zbudujWpisy: klucz to INSPIREID albo f<numer>, otoczenia nie są liczone, klasa z typu i pola', () => {
  const obiekty = [
    kwadrat(0, 0, 0, 20, 20),
    kwadrat(1, 0, 0, 20, 20),
    kwadrat(2, 0, 0, 200, 200),
    kwadrat(3, 0, 0, 1000, 1000),
    linia(4, 0, 0, 10, 0),
  ]
  const przypisania = new Map([
    [0, { id: id('BK', 1), nazwa: 'dom' }],
    [1, { id: id('OT', 2), nazwa: 'działka' }],
    [2, { id: id('UU', 3), nazwa: 'układ' }],
  ])
  const w = zbudujWpisy(obiekty, przypisania)
  assert.deepEqual(
    w.map((x) => [x.klucz, x.typ, x.klasa, x.liczony]),
    [
      [id('BK', 1), 'BK', 'obiekt', true],
      [id('OT', 2), 'OT', 'otoczenie', false],
      [id('UU', 3), 'UU', 'obszar', true],
      ['f3', null, 'obszar', true], // bez identyfikatora, ponad 1 ha
      ['f4', null, 'obiekt', true],
    ],
  )
})

// ── Kontrola względem wykazu CSV ─────────────────────────────────────────────────────────────

const rekord = (
  idWpisu,
  gmina,
  miejscowosc,
  ulica,
  nr,
  dokladnosc = 'dokładny',
  woj = 'małopolskie',
) => ({
  INSPIRE_ID: idWpisu,
  WOJEWODZTWO: woj,
  GMINA: gmina,
  MIEJSCOWOSC: miejscowosc,
  ULICA: ulica,
  NR_ADRESOWY: nr,
  DOKLADNOSC_POLOZENIA: dokladnosc,
})

test('pokrycieWykazu: pozycje z gmin adresów bez otoczeń, ile ma obiekt w usłudze i ile ma położenie niedokładne', () => {
  const rekordy = [
    rekord(id('BK', 1), 'Kraków', 'Kraków', 'Floriańska', '1'),
    rekord(id('BK', 2), 'Kraków', 'Kraków', 'Floriańska', '2', 'przybliżony'),
    rekord(id('OT', 3), 'Kraków', 'Kraków', '', '', 'dokładny'), // otoczenie: poza kontrolą
    rekord(id('BK', 4), 'Wieliczka - miasto', 'Wieliczka', 'Rynek Górny', '11', 'niepewny'),
    rekord(id('BK', 5), 'Gdów', 'Gdów', 'Rynek', '1'), // gmina spoza adresów
    rekord(id('BK', 6), 'Kraków', 'Kraków', 'Floriańska', '6', 'dokładny', 'mazowieckie'),
  ]
  const w = pokrycieWykazu(
    rekordy,
    new Set(['Kraków', 'Wieliczka']),
    new Set([id('BK', 1), id('BK', 4)]),
  )
  assert.equal(w.pozycji, 3)
  assert.equal(w.znalezione, 2)
  assert.equal(w.niedokladne, 2)
  assert.deepEqual(w.wgGminy.get('Kraków'), { pozycji: 2, znalezione: 1 })
  assert.deepEqual(w.wgGminy.get('Wieliczka'), { pozycji: 1, znalezione: 1 })
})

test('zgodnoscAdresowa: odległość punktu PRG od obiektu o tym samym identyfikatorze (0 w obrysie)', () => {
  const [x, y] = do2180(19.94, 50.06)
  const adres = (gmina, miejscowosc, ulica, nr, dx, dy) => {
    // przesunięcie w metrach przez odwrotną zamianę nie jest potrzebne: punkty adresów liczymy z lon/lat
    const lon = 19.94 + dx / 71_500
    const lat = 50.06 + dy / 111_200
    return { gmina, miejscowosc, ulica, nr, lon, lat }
  }
  const adresy = [
    adres('Kraków', 'Kraków', 'Floriańska', '1', 0, 0),
    adres('Kraków', 'Kraków', 'Floriańska', '2', 0, 0),
    adres('Wieliczka', 'Wieliczka', 'Rynek Górny', '11', 0, 0),
  ]
  const obiekty = new Map([
    [id('BK', 1), [kwadrat(0, x - 10, y - 10, x + 10, y + 10)]], // adres w obrysie
    [id('BK', 2), [kwadrat(1, x + 100, y - 10, x + 120, y + 10)]], // 100 m obok
  ])
  const rekordy = [
    rekord(id('BK', 1), 'Kraków', 'Kraków', 'Floriańska', '1'),
    rekord(id('BK', 2), 'Kraków', 'Kraków', 'Floriańska', '2'),
    rekord(id('BK', 3), 'Wieliczka - miasto', 'Wieliczka', 'Rynek Górny', '11'), // brak obiektu w usłudze
    rekord(id('BK', 4), 'Kraków', 'Kraków', 'Floriańska', ''), // bez numeru: nie da się dopasować
    rekord(id('OT', 5), 'Kraków', 'Kraków', 'Floriańska', '1'), // otoczenie: poza kontrolą
  ]
  const z = zgodnoscAdresowa(rekordy, adresy, obiekty)
  assert.equal(z.dopasowane, 3)
  assert.equal(z.zObiektem, 2)
  assert.equal(z.w0m, 1)
  assert.equal(z.w50m, 1)
  assert.ok(Math.abs((z.p90 ?? 0) - 100) < 1, `p90 ${z.p90}`)
})

// ── Źródło, opis, pomocnicze ─────────────────────────────────────────────────────────────────

test('dataDanychRejestru: data zasobu usługi INSPIRE_IMD, a przy jej braku zasobu CSV', () => {
  const zasoby = [
    {
      attributes: {
        format: 'xml',
        link: 'https://usluga.zabytek.gov.pl/INSPIRE_IMD/service.svc/get?x',
        data_date: '2026-09-30',
      },
    },
    {
      attributes: {
        format: 'csv',
        download_url: 'https://api.dane.gov.pl/x/file',
        data_date: '2026-09-15',
      },
    },
    { attributes: { format: 'html', link: 'https://api.zabytek.gov.pl', data_date: null } },
  ]
  assert.deepEqual(dataDanychRejestru(zasoby), {
    dataDanych: '2026-09-30',
    urlCsv: 'https://api.dane.gov.pl/x/file',
  })
  assert.equal(dataDanychRejestru(zasoby.slice(1)).dataDanych, '2026-09-15')
  assert.throws(
    () => dataDanychRejestru([{ attributes: { format: 'csv', data_date: 'wczoraj' } }]),
    /daty danych/,
  )
  assert.throws(() => dataDanychRejestru([]), /daty danych/)
})

test('opisWskaznika: liczby z danych, zastrzeżenia, bez pauzy', () => {
  const opis = opisWskaznika({ rozdz: 2.59, pokrycieProc: 99, niedokladneProc: 9 })
  assert.match(opis, /500 m/)
  assert.match(opis, /rozdzielczości 2,59 m/)
  assert.match(opis, /dla 9% pozycji/)
  assert.match(opis, /ok\. 1% wykazu/)
  assert.match(opis, /dolne oszacowanie/)
  assert.match(opis, /bez otoczeń/)
  assert.match(opis, /Nie wpływa na wynik/)
  assert.match(
    opisWskaznika({ rozdz: 2.59, pokrycieProc: 100, niedokladneProc: 9 }),
    /ok\. 1% wykazu/,
  )
  assert.ok(!opis.includes(PAUZA))
  for (const t of Object.values(SLOWNIK_ETYKIET)) assert.ok(!t.includes(PAUZA))
})

test('rownolegle: wyniki w kolejności wejścia, liczba zadań naraz ograniczona', async () => {
  let naraz = 0
  let maks = 0
  const wyniki = await rownolegle([5, 1, 4, 2, 3, 6, 7, 0], 3, async (n) => {
    naraz++
    maks = Math.max(maks, naraz)
    await new Promise((r) => setTimeout(r, n))
    naraz--
    return n * 2
  })
  assert.deepEqual(wyniki, [10, 2, 8, 4, 6, 12, 14, 0])
  assert.ok(maks <= 3 && maks >= 2, `naraz ${maks}`)
  assert.deepEqual(await rownolegle([], 4, async () => 1), [])
  assert.equal(kluczSondy({ x: 567_066.123, y: 244_247.1 }), '567066.12,244247.10')
  // sanity pomocniczych importów
  assert.deepEqual(pierscienieZSciezki('M1 1l1 1')[0], [
    [1, 1],
    [2, 2],
  ])
  assert.equal(rozbierzId(id('BK', 7))?.typ, 'BK')
})

// ── Wygenerowany plik wskaźnika ──────────────────────────────────────────────────────────────

test('plik wskaźnika: liczba dla każdego adresu, etykiety ze słownika, znane miejsca, rozmiar', (t) => {
  const sciezka = join(DANE, 'wskazniki', 'zabytki_rejestr_500m.json')
  if (!existsSync(sciezka)) return t.skip('brak wygenerowanego pliku (node etl/zabytki-nid.mjs)')
  const plik = JSON.parse(readFileSync(sciezka, 'utf8'))
  const { wersja, adresy } = wczytajAdresy()
  assert.equal(plik.wersjaAdresow, wersja)
  assert.equal(plik.wartosci.length, adresy.length)
  assert.equal(plik.etykiety.length, adresy.length)
  assert.ok(statSync(sciezka).size < 2 * 1024 * 1024, 'kontrakt: plik wskaźnika poniżej 2 MB')
  const m = plik.meta
  assert.equal(m.id, 'zabytki_rejestr_500m')
  assert.equal(m.kategoria, 'kontekst')
  assert.equal(m.kierunek, 'neutralny')
  assert.equal(m.rozdzielczosc, 'adres')
  assert.equal(m.zadanie, 143)
  assert.ok(!JSON.stringify(m).includes(PAUZA))
  assert.ok(m.zrodla.every((z) => z.url && z.licencja && z.dataDanych && z.pobrano))
  assert.ok(
    m.zrodla.some(
      (z) => /Narodowy Instytut Dziedzictwa/.test(z.nazwa) && /CC BY 4\.0/.test(z.licencja),
    ),
  )
  assert.deepEqual(plik.slownikEtykiet, SLOWNIK_ETYKIET)

  // 0 to zmierzone zero, więc każdy adres ma liczbę całkowitą
  assert.ok(plik.wartosci.every((v) => Number.isInteger(v) && v >= 0))
  assert.ok(plik.etykiety.every((e) => e === null || e in SLOWNIK_ETYKIET))
  const bezWpisu = plik.wartosci.filter((v) => v === 0).length
  assert.ok(
    bezWpisu > 0.5 * adresy.length && bezWpisu < 0.9 * adresy.length,
    `adresów bez wpisu: ${bezWpisu}`,
  )
  // adres w obrysie, na obszarze albo w otoczeniu ma w promieniu co najmniej jeden wpis albo tylko otoczenie
  const zEtykieta = plik.etykiety.filter(Boolean).length
  assert.ok(zEtykieta > 3_000 && zEtykieta < 30_000, `adresów z etykietą: ${zEtykieta}`)
  assert.ok(m.zakres[1] >= 100 && m.zakres[1] <= 1_000)

  // Znane miejsca: Stare Miasto gęsto i w obrysie wpisów, peryferie puste
  const wUlicy = (gmina, ulica) =>
    adresy.flatMap((a, i) => (a.gmina === gmina && a.ulica === ulica ? [i] : []))
  for (const ulica of ['Rynek Główny', 'Floriańska']) {
    const idx = wUlicy('Kraków', ulica)
    assert.ok(idx.length > 0, ulica)
    for (const i of idx) assert.ok((plik.wartosci[i] ?? 0) >= 300, `${ulica}: ${plik.wartosci[i]}`)
    assert.ok(
      idx.some((i) => plik.etykiety[i] === 'obiekt'),
      `${ulica}: jakiś adres w obrysie zabytku`,
    )
  }
  const nowaHuta = wUlicy('Kraków', 'Osiedle Teatralne')
  assert.ok(nowaHuta.length > 0 && nowaHuta.some((i) => plik.etykiety[i] === 'obszar'))
  const wieliczka = wUlicy('Wieliczka', 'Rynek Górny')
  assert.ok(wieliczka.some((i) => (plik.wartosci[i] ?? 0) >= 20))
  // kopalnia soli pod miastem to obszar, a nie obiekt: adresy Wieliczki nie dostają masowo etykiety „obiekt”
  const obiektyWieliczka = adresy.filter(
    (a, i) => a.gmina === 'Wieliczka' && plik.etykiety[i] === 'obiekt',
  ).length
  assert.ok(obiektyWieliczka < 300, `Wieliczka, adresów w obiekcie: ${obiektyWieliczka}`)
})
