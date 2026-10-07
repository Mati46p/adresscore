// Router wspólnego workera obliczeń (#108): oba tryby w jednej instancji, rozłączne stany,
// zwalnianie jednego trybu bez ruszania drugiego i izolacja błędów. Router nie dotyka `self`
// ani `fetch`, więc działa tu tak samo jak w workerze.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Adres, WskaznikMeta } from '../kontrakty/index.ts'
import { MIASTA } from '../kontrakty/miasta.ts'
import type { KomorkaPopytu } from './biznes.ts'
import type { PlikUslug } from './biznesUslugi.ts'
import { type DoWorkera, utworzRouter, type ZWorkera } from './obliczenia.ts'
import { BLAD_BEZ_POPYTU } from './obliczeniaBiznes.ts'
import { grupujHeksy, przygotujWskaznik } from './silnik.ts'
import { type BazaSymulacji, type Obiekt, przygotujBaze, symuluj } from './symulacja.ts'

// ── Dane testowe ─────────────────────────────────────────────────────────────────────────

type AdresSym = Pick<Adres, 'lon' | 'lat' | 'dzielnica' | 'gmina' | 'h3'>
const RYNEK = { lon: 19.9372, lat: 50.0614 }
const M_LAT = 1 / 111_320
const M_LON = 1 / (111_320 * Math.cos((RYNEK.lat * Math.PI) / 180))

function meta(id: string, dodatki: Partial<WskaznikMeta> = {}): WskaznikMeta {
  return {
    id,
    kategoria: 'transport',
    nazwa: id,
    opis: '',
    jednostka: 'm',
    kierunek: 'mniej-lepiej',
    rozdzielczosc: 'adres',
    zrodla: [],
    zadanie: 0,
    ...dodatki,
  }
}

/** Mała baza Miasta: siatka 6 × 6 adresów co 150 m i jedna warstwa „przystanek”. */
function bazaMiasta(): BazaSymulacji {
  const adresy: AdresSym[] = []
  for (let y = 0; y < 6; y++)
    for (let x = 0; x < 6; x++)
      adresy.push({
        lon: RYNEK.lon + (x - 3) * 150 * M_LON,
        lat: RYNEK.lat + (y - 3) * 150 * M_LAT,
        dzielnica: 'I Stare Miasto',
        gmina: 'Kraków',
        h3: `h${Math.floor(x / 3)}_${Math.floor(y / 3)}`,
      })
  const odleglosc = (a: AdresSym) =>
    Math.hypot((a.lon - RYNEK.lon) / M_LON, (a.lat - RYNEK.lat) / M_LAT)
  const wskaznik = przygotujWskaznik({
    meta: meta('przystanek_odleglosc', { zakres: [0, 1500] }),
    wartosci: adresy.map(odleglosc),
    wersjaAdresow: 'test',
  })
  return przygotujBaze({
    adresy,
    grupy: grupujHeksy(adresy.map((a) => a.h3)),
    wskazniki: [wskaznik],
    wagi: { przystanek_odleglosc: 4 },
  })
}

const OBIEKT: Obiekt = { typ: 'przystanek', lon: RYNEK.lon + 200 * M_LON, lat: RYNEK.lat }

/** Mały popyt Biznesu: siatka 5 × 4 heksów co ~200 m. */
const POPYT: { komorki: KomorkaPopytu[]; zrodla: { nazwa: string }[] } = {
  komorki: Array.from({ length: 20 }, (_, i): KomorkaPopytu => {
    const x = i % 5
    const y = Math.floor(i / 5)
    return [`h${i}`, 19.94 + x * 0.003, 50.06 + y * 0.002, 100 + i, 300 + i * 5, 4]
  }),
  zrodla: [{ nazwa: 'Popyt testowy' }],
}

const PLIK_APTEKI: PlikUslug = {
  wersja: 1,
  branza: 'apteka',
  nazwa: 'Apteka',
  zasiegPieszyM: 800,
  n: 3,
  bityZrodel: { osm: 1, overture: 2 },
  licencja: '',
  atrybucja: '',
  kolumny: {
    lon: [19.941, 19.949, 19.953],
    lat: [50.061, 50.062, 50.066],
    zr: [1, 3, 3],
    nazwa: ['A', 'B', null],
  },
}

// ── Kontrola routera ─────────────────────────────────────────────────────────────────────

/** Router z zapisem odpowiedzi i licznikiem pobrań. `pobierz` można podmienić (np. na wstrzymane). */
function srodowisko(pobierz?: (sciezka: string) => Promise<unknown>) {
  const odpowiedzi: ZWorkera[] = []
  const pobrane: string[] = []
  const router = utworzRouter({
    wyslij: (o) => odpowiedzi.push(o),
    pobierz:
      pobierz ??
      (async (sciezka) => {
        pobrane.push(sciezka)
        if (sciezka === '/dane/biznes/popyt.json') return structuredClone(POPYT)
        if (sciezka === '/dane/uslugi/apteka.json') return structuredClone(PLIK_APTEKI)
        throw new Error(`${sciezka}: HTTP 404`)
      }),
  })
  const wyslij = (w: DoWorkera) => router(w)
  const typy = () => odpowiedzi.map((o) => `${o.tryb}:${o.typ}`)
  return { router, wyslij, odpowiedzi, pobrane, typy }
}

/** Katalog danych Krakowa, jedynego zbioru z popytem (D8); worker dostaje go od wątku głównego. */
const BAZA = '/dane'

const INIT_APTEKI: DoWorkera = {
  tryb: 'biznes',
  typ: 'init',
  baza: BAZA,
  branza: 'apteka',
  filtry: { min2Zrodla: false, flagi: {} },
}

describe('oba tryby w jednym workerze', () => {
  it('Miasto: baza, potem licz – wynik taki sam jak z wątku głównego, z polem tryb', async () => {
    const { wyslij, odpowiedzi } = srodowisko()
    const baza = bazaMiasta()
    await wyslij({ tryb: 'miasto', typ: 'baza', baza })
    assert.equal(odpowiedzi.length, 0, 'sama baza nie daje odpowiedzi')
    await wyslij({ tryb: 'miasto', typ: 'licz', id: 5, warianty: [[OBIEKT], []] })
    const o = odpowiedzi[0]
    assert.ok(o && o.tryb === 'miasto' && o.typ === 'wynik')
    assert.equal(o.id, 5)
    assert.deepEqual(o.wyniki, [symuluj(baza, [OBIEKT]), symuluj(baza, [])])
    assert.ok(o.ms >= 0)
  })

  it('Miasto: licz przed bazą jest pomijane, a sugeruj odpowiada', async () => {
    const { wyslij, odpowiedzi } = srodowisko()
    await wyslij({ tryb: 'miasto', typ: 'licz', id: 1, warianty: [[]] })
    assert.equal(odpowiedzi.length, 0)
    await wyslij({ tryb: 'miasto', typ: 'baza', baza: bazaMiasta() })
    await wyslij({ tryb: 'miasto', typ: 'sugeruj', id: 2, typObiektu: 'przystanek', obiekty: [] })
    const o = odpowiedzi[0]
    assert.ok(o && o.tryb === 'miasto' && o.typ === 'sugestia')
    assert.equal(o.id, 2)
  })

  it('Biznes: start pobiera popyt, init buduje indeks, ocen ocenia miejsce', async () => {
    const { wyslij, odpowiedzi, pobrane } = srodowisko()
    await wyslij({ tryb: 'biznes', typ: 'start', baza: BAZA })
    assert.deepEqual(pobrane, ['/dane/biznes/popyt.json'])
    await wyslij(INIT_APTEKI)
    // Popyt pobrany raz (start), plik branży raz.
    assert.deepEqual(pobrane, ['/dane/biznes/popyt.json', '/dane/uslugi/apteka.json'])
    const g = odpowiedzi[0]
    assert.ok(g && g.tryb === 'biznes' && g.typ === 'gotowe')
    assert.equal(g.meta.id, 'apteka')
    assert.equal(g.meta.poFiltrach, 3)
    assert.equal(g.punkty.length, 3)
    assert.equal(g.zrodla[0]?.nazwa, 'Popyt testowy')
    await wyslij({
      tryb: 'biznes',
      typ: 'ocen',
      id: 'a',
      punkt: { lon: 19.945, lat: 50.063 },
      wersja: g.wersja,
    })
    const o = odpowiedzi[1]
    assert.ok(o && o.tryb === 'biznes' && o.typ === 'ocena')
    assert.equal(o.id, 'a')
    assert.ok(o.ocena.adresyWZasiegu > 0)
    // Miejsca A–E: ostatnie dostaje odpowiedź z własnym id.
    await wyslij({
      tryb: 'biznes',
      typ: 'ocen',
      id: 'e',
      punkt: { lon: 19.95, lat: 50.064 },
      wersja: g.wersja,
    })
    const e = odpowiedzi[2]
    assert.ok(e && e.tryb === 'biznes' && e.typ === 'ocena')
    assert.equal(e.id, 'e')
  })

  it('oba tryby naraz: odpowiedzi mają właściwy tryb i nie mieszają stanów', async () => {
    const { wyslij, odpowiedzi, typy } = srodowisko()
    await wyslij({ tryb: 'miasto', typ: 'baza', baza: bazaMiasta() })
    await wyslij(INIT_APTEKI)
    await wyslij({ tryb: 'miasto', typ: 'licz', id: 1, warianty: [[OBIEKT]] })
    assert.deepEqual(typy(), ['biznes:gotowe', 'miasto:wynik'])
    const g = odpowiedzi[0]
    assert.ok(g && g.tryb === 'biznes' && g.typ === 'gotowe')
    await wyslij({
      tryb: 'biznes',
      typ: 'ocen',
      id: 'b',
      punkt: { lon: 19.945, lat: 50.063 },
      wersja: g.wersja,
    })
    assert.deepEqual(typy(), ['biznes:gotowe', 'miasto:wynik', 'biznes:ocena'])
  })
})

describe('zwalnianie trybu', () => {
  it('zwolnij Biznes oddaje jego stan, a Miasto liczy dalej', async () => {
    const { wyslij, odpowiedzi, typy, pobrane } = srodowisko()
    await wyslij({ tryb: 'miasto', typ: 'baza', baza: bazaMiasta() })
    await wyslij(INIT_APTEKI)
    const g = odpowiedzi[0]
    assert.ok(g && g.tryb === 'biznes' && g.typ === 'gotowe')
    await wyslij({ tryb: 'biznes', typ: 'zwolnij' })
    // Biznes: indeks oddany – ocena bez nowego init nie odpowiada.
    await wyslij({
      tryb: 'biznes',
      typ: 'ocen',
      id: 'a',
      punkt: { lon: 19.945, lat: 50.063 },
      wersja: g.wersja,
    })
    assert.deepEqual(typy(), ['biznes:gotowe'])
    // Miasto: baza nietknięta.
    await wyslij({ tryb: 'miasto', typ: 'licz', id: 1, warianty: [[OBIEKT]] })
    assert.deepEqual(typy(), ['biznes:gotowe', 'miasto:wynik'])
    // Biznes po zwolnieniu pobiera dane od nowa (cache oddany).
    const pobraniaPrzed = pobrane.length
    await wyslij(INIT_APTEKI)
    assert.equal(pobrane.length, pobraniaPrzed + 2)
  })

  it('zwolnij Miasto oddaje bazę, a Biznes ocenia dalej', async () => {
    const { wyslij, odpowiedzi, typy } = srodowisko()
    await wyslij({ tryb: 'miasto', typ: 'baza', baza: bazaMiasta() })
    await wyslij(INIT_APTEKI)
    const g = odpowiedzi[0]
    assert.ok(g && g.tryb === 'biznes' && g.typ === 'gotowe')
    await wyslij({ tryb: 'miasto', typ: 'zwolnij' })
    await wyslij({ tryb: 'miasto', typ: 'licz', id: 1, warianty: [[OBIEKT]] })
    assert.deepEqual(typy(), ['biznes:gotowe'], 'bez bazy licz jest pomijane')
    await wyslij({
      tryb: 'biznes',
      typ: 'ocen',
      id: 'a',
      punkt: { lon: 19.945, lat: 50.063 },
      wersja: g.wersja,
    })
    assert.deepEqual(typy(), ['biznes:gotowe', 'biznes:ocena'])
  })

  it('zwolnij w trakcie pobierania unieważnia init: wynik nie wraca do ekranu, którego nie ma', async () => {
    const wstrzymane: (() => void)[] = []
    const { wyslij, typy } = srodowisko((sciezka) =>
      new Promise<void>((ok) => wstrzymane.push(ok)).then(() => {
        if (sciezka === '/dane/biznes/popyt.json') return structuredClone(POPYT)
        return structuredClone(PLIK_APTEKI)
      }),
    )
    const init = wyslij(INIT_APTEKI) // czeka na dwa pobrania
    await wyslij({ tryb: 'biznes', typ: 'zwolnij' })
    for (const ok of wstrzymane.splice(0)) ok()
    await init
    assert.deepEqual(typy(), [], 'żadnego „gotowe” po zwolnieniu')
  })
})

describe('błędy jednego trybu nie psują drugiego', () => {
  it('wyjątek w Mieście wraca jako blad z id żądania, a Biznes działa', async () => {
    const { wyslij, odpowiedzi, typy } = srodowisko()
    // Uszkodzona baza: obsługa Miasta rzuci przy liczeniu.
    await wyslij({ tryb: 'miasto', typ: 'baza', baza: {} as BazaSymulacji })
    await wyslij({ tryb: 'miasto', typ: 'licz', id: 9, warianty: [[OBIEKT]] })
    const b = odpowiedzi[0]
    assert.ok(b && b.tryb === 'miasto' && b.typ === 'blad')
    assert.equal(b.id, 9)
    assert.ok(b.blad.length > 0)
    await wyslij(INIT_APTEKI)
    assert.deepEqual(typy(), ['miasto:blad', 'biznes:gotowe'])
  })

  it('wyjątek w Biznesie (plik, którego nie ma) to blad z wersją, a Miasto liczy', async () => {
    const { wyslij, odpowiedzi, typy } = srodowisko()
    await wyslij({ tryb: 'miasto', typ: 'baza', baza: bazaMiasta() })
    await wyslij({ ...INIT_APTEKI, branza: 'nie_ma_takiej' } as DoWorkera)
    const b = odpowiedzi[0]
    assert.ok(b && b.tryb === 'biznes' && b.typ === 'blad')
    assert.match(b.blad, /404/)
    await wyslij({ tryb: 'miasto', typ: 'licz', id: 1, warianty: [[]] })
    assert.deepEqual(typy(), ['biznes:blad', 'miasto:wynik'])
  })

  it('id branży spoza katalogu nie trafia do ścieżki pobrania', async () => {
    const { wyslij, odpowiedzi, pobrane } = srodowisko()
    await wyslij({ ...INIT_APTEKI, branza: '../../sekret' } as DoWorkera)
    const b = odpowiedzi.at(-1)
    assert.ok(b && b.tryb === 'biznes' && b.typ === 'blad')
    assert.ok(!pobrane.some((p) => p.includes('sekret')))
  })

  it('byle co z ekranu (zły punkt, nieznany tryb, brak filtrów) jest pomijane, nie wywala routera', async () => {
    const { wyslij, odpowiedzi } = srodowisko()
    await wyslij({ ...INIT_APTEKI, filtry: null } as unknown as DoWorkera)
    const g = odpowiedzi[0]
    assert.ok(g && g.tryb === 'biznes' && g.typ === 'gotowe')
    assert.equal(g.meta.filtry.min2Zrodla, false)
    for (const punkt of [null, { lon: 'x', lat: 1 }, { lon: Number.NaN, lat: 50 }, undefined]) {
      await wyslij({
        tryb: 'biznes',
        typ: 'ocen',
        id: 'a',
        punkt,
        wersja: g.wersja,
      } as unknown as DoWorkera)
    }
    await wyslij({ tryb: 'inny', typ: 'cokolwiek' } as unknown as DoWorkera)
    assert.equal(odpowiedzi.length, 1, 'żadna z tych wiadomości nie dała odpowiedzi')
  })
})

describe('Biznes: katalog danych z wiadomości (#223)', () => {
  const nowe = (baza: unknown) => ({ tryb: 'biznes', typ: 'init', branza: 'apteka', baza }) as const

  it('każde miasto z rejestru to zbiór bez popytu: nic się nie pobiera, init odpowiada powodem', async () => {
    const miasta = MIASTA.filter((m) => m.katalog !== '')
    assert.ok(miasta.length > 0)
    for (const m of miasta) {
      const { wyslij, odpowiedzi, pobrane } = srodowisko()
      const baza = `/dane/${m.katalog}`
      await wyslij({ tryb: 'biznes', typ: 'start', baza })
      await wyslij({ ...INIT_APTEKI, baza } as DoWorkera)
      assert.deepEqual(pobrane, [], `${m.slug}: ani popyt, ani plik branży`)
      const b = odpowiedzi[0]
      assert.ok(b && b.tryb === 'biznes' && b.typ === 'blad', m.slug)
      assert.equal(b.blad, BLAD_BEZ_POPYTU)
    }
  })

  it('zły katalog (puste, względne, z „..”, z zapytaniem, nie tekst) to blad bez żadnego pobrania', async () => {
    for (const zla of ['', '/', 'dane', '/dane/', '/dane/../x', '/dane?x=1', null, undefined, 42]) {
      const { wyslij, odpowiedzi, pobrane } = srodowisko()
      await wyslij({ tryb: 'biznes', typ: 'start', baza: zla } as unknown as DoWorkera)
      await wyslij({ ...nowe(zla), filtry: { min2Zrodla: false, flagi: {} } } as DoWorkera)
      assert.deepEqual(pobrane, [], JSON.stringify(zla))
      const b = odpowiedzi.at(-1)
      assert.ok(b && b.tryb === 'biznes' && b.typ === 'blad', JSON.stringify(zla))
      assert.match(b.blad, /katalog/i)
    }
  })

  it('popyt i pliki branż są pamiętane po pełnej ścieżce: inny katalog to inne pliki, nie cudze', async () => {
    const pobrane: string[] = []
    const { wyslij, odpowiedzi } = srodowisko(async (sciezka) => {
      pobrane.push(sciezka)
      if (sciezka.endsWith('/biznes/popyt.json')) return structuredClone(POPYT)
      if (sciezka.endsWith('/uslugi/apteka.json')) {
        // Nazwa lokalu zdradza, z którego pliku przyszły punkty.
        const plik = structuredClone(PLIK_APTEKI)
        plik.kolumny.nazwa = [sciezka, sciezka, sciezka]
        return plik
      }
      throw new Error(`${sciezka}: HTTP 404`)
    })
    const punktyZ = (o: ZWorkera | undefined) => {
      assert.ok(o && o.tryb === 'biznes' && o.typ === 'gotowe')
      return o.punkty.map((p) => p[2])
    }
    await wyslij({ ...INIT_APTEKI, baza: '/dane' } as DoWorkera)
    await wyslij({ ...INIT_APTEKI, baza: '/inna/dane' } as DoWorkera)
    assert.deepEqual(pobrane, [
      '/dane/biznes/popyt.json',
      '/dane/uslugi/apteka.json',
      '/inna/dane/biznes/popyt.json',
      '/inna/dane/uslugi/apteka.json',
    ])
    assert.deepEqual(new Set(punktyZ(odpowiedzi[0])), new Set(['/dane/uslugi/apteka.json']))
    assert.deepEqual(new Set(punktyZ(odpowiedzi[1])), new Set(['/inna/dane/uslugi/apteka.json']))
    // Powrót do pierwszego katalogu: plik branży z pamięci, popyt (jeden naraz) od nowa.
    await wyslij({ ...INIT_APTEKI, baza: '/dane' } as DoWorkera)
    assert.deepEqual(pobrane.slice(4), ['/dane/biznes/popyt.json'])
    assert.deepEqual(new Set(punktyZ(odpowiedzi[2])), new Set(['/dane/uslugi/apteka.json']))
  })

  it('start dla Krakowa pobiera popyt z góry, a init nie pobiera go drugi raz', async () => {
    const { wyslij, pobrane } = srodowisko()
    await wyslij({ tryb: 'biznes', typ: 'start', baza: BAZA })
    await wyslij(INIT_APTEKI)
    assert.equal(pobrane.filter((p) => p.endsWith('/biznes/popyt.json')).length, 1)
  })
})
