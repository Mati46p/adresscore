// Uruchom: node --test 'src/ai/*.test.ts'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import type { PlikWskaznika, WskaznikMeta } from '../kontrakty/index.ts'
import {
  BRAK_DANYCH,
  ID_PYTANIA,
  listaWarstw,
  NIE_WIEM,
  odpowiedz,
  PROG_PEWNOSCI,
  przetworz,
  regula,
  type WarstwaDanych,
  zapytajOAdres,
  zapytanieJev,
} from './zapytajOAdres.ts'

const meta = (
  id: string,
  kategoria: WskaznikMeta['kategoria'],
  extra: Partial<WskaznikMeta> = {},
) =>
  ({
    id,
    kategoria,
    nazwa: `Warstwa ${id}`,
    opis: `Opis ${id}. Drugie zdanie.`,
    jednostka: 'm',
    kierunek: 'mniej-lepiej',
    rozdzielczosc: 'adres',
    zrodla: [
      {
        nazwa: `Źródło ${id}`,
        url: `https://x/${id}`,
        licencja: 'CC',
        dataDanych: '2025',
        pobrano: '2026-10-03',
      },
    ],
    zadanie: 1,
    ...extra,
  }) as WskaznikMeta

const halas = meta('halas_ldwn', 'spokoj', {
  nazwa: 'Najwyższe pasmo hałasu (LDWN)',
  jednostka: 'dB',
  rozdzielczosc: 'rejon',
  rozmiar: 'wielokąt pasma mapy akustycznej',
})
const przystanek = meta('przystanek_odleglosc', 'transport', { nazwa: 'Najbliższy przystanek' })
const sklepAtrapa = meta('sklep_atrapa', 'codziennosc', { atrapa: true })
const cena = meta('cena_m2_mediana', 'kontekst', { jednostka: 'zł/m²', rozdzielczosc: 'heks' })
const apteka = meta('apteka_odleglosc', 'codziennosc')

const WSKAZNIKI: WarstwaDanych[] = [
  { meta: halas, wartosci: [62.5, null, 57.5], etykiety: ['60–64,9 dB LDWN', null, null] },
  { meta: przystanek, wartosci: [240, 0, 1200] },
  { meta: sklepAtrapa, wartosci: [1, 2, 3] },
  { meta: cena, wartosci: [null, 14038.67, 9000] },
  { meta: apteka, wartosci: [300, 300, 300], niedostepny: 'błąd pobrania' },
]
/** Metadane wszystkich warstw z public/dane/wskazniki – to samo, co manifest przy buildzie. */
function metasZDanych(): WskaznikMeta[] {
  const katalog = 'public/dane/wskazniki'
  return readdirSync(katalog)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => (JSON.parse(readFileSync(`${katalog}/${f}`, 'utf8')) as PlikWskaznika).meta)
}

const LISTA = listaWarstw(WSKAZNIKI.map((w) => w.meta))

function fetchZ(json: unknown, status = 200) {
  const wywolania: unknown[] = []
  const f = (async (_url: unknown, init?: RequestInit) => {
    wywolania.push(JSON.parse(String(init?.body)))
    return { ok: status >= 200 && status < 300, status, json: async () => json } as Response
  }) as typeof fetch
  return { f, wywolania }
}
const jevWybral = (wybor: string, pewnosc: number | null) =>
  fetchZ({ odpowiedzi: { [ID_PYTANIA]: { typ: 'choice', wybor, pewnosc } }, powod: null })

describe('listaWarstw', () => {
  it('bez atrap, w stałej kolejności niezależnej od manifestu', () => {
    const ids = LISTA.map((p) => p.id)
    assert.deepEqual(ids, [
      'apteka_odleglosc',
      'przystanek_odleglosc',
      'halas_ldwn',
      'cena_m2_mediana',
    ])
    const odwrotnie = listaWarstw(WSKAZNIKI.map((w) => w.meta).reverse())
    assert.deepEqual(
      odwrotnie.map((p) => p.id),
      ids,
    )
    assert.ok(!ids.includes('sklep_atrapa'))
  })

  it('opisy w limicie pośrednika, nie_wiem na końcu zapytania', () => {
    for (const p of LISTA) assert.ok(p.opis.length <= 300)
    const z = zapytanieJev('Jak głośno?', LISTA)
    const p = z.pytania[ID_PYTANIA]
    assert.equal(p?.typ, 'choice')
    const klucze = Object.keys(p?.typ === 'choice' ? p.kryteria : {})
    assert.deepEqual(klucze, [...LISTA.map((x) => x.id), NIE_WIEM])
  })

  it('prawdziwy katalog public/dane: bez atrap, ≤ 128 opcji, każde id spełnia format pośrednika', () => {
    const metas = metasZDanych()
    const lista = listaWarstw(metas)
    assert.ok(lista.length > 10 && lista.length + 1 <= 128)
    for (const p of lista) {
      assert.match(p.id, /^[a-z0-9_-]+$/i)
      assert.ok(p.opis.length > 0 && p.opis.length <= 300)
    }
    assert.ok(lista.every((p) => !metas.find((m) => m.id === p.id)?.atrapa))
  })
})

describe('przetworz', () => {
  const odp = (wybor: string, pewnosc: number | null) => ({
    [ID_PYTANIA]: { typ: 'choice' as const, wybor, pewnosc },
  })
  it('przyjmuje id z listy przy pewności ≥ progu', () => {
    assert.deepEqual(przetworz(odp('halas_ldwn', 0.9), LISTA), { warstwa: 'halas_ldwn' })
    assert.deepEqual(przetworz(odp('halas_ldwn', PROG_PEWNOSCI), LISTA), { warstwa: 'halas_ldwn' })
  })
  it('odrzuca wybór spoza listy (także atrapę)', () => {
    assert.equal(przetworz(odp('nieistniejaca', 0.99), LISTA), null)
    assert.equal(przetworz(odp('sklep_atrapa', 0.99), LISTA), null)
  })
  it('niska albo brak pewności → reguła', () => {
    assert.equal(przetworz(odp('halas_ldwn', 0.3), LISTA), null)
    assert.equal(przetworz(odp('halas_ldwn', null), LISTA), null)
    assert.equal(przetworz({ [ID_PYTANIA]: null }, LISTA), null)
  })
  it('pewne nie_wiem to uczciwe „nie wiem”', () => {
    assert.deepEqual(przetworz(odp(NIE_WIEM, 0.8), LISTA), { warstwa: null })
  })
})

describe('regula – polskie pytania', () => {
  const pelna = listaWarstw(metasZDanych())
  const PRZYPADKI: [string, string | null][] = [
    ['Jak głośno tu jest?', 'halas_ldwn'],
    ['czy jest cicho w nocy', 'halas_ldwn'],
    ['Daleko do przystanku?', 'przystanek_odleglosc'],
    ['Jak często jeździ tramwaj rano?', 'kursy_szczyt_h'],
    ['Czy jest tu zielono?', 'zielen_worldcover_100m'],
    ['Jakie powietrze?', 'pm25_srednia'],
    ['A smog zimą?', 'pm25_srednia'],
    ['Czy zalewa?', 'powodz_1proc'],
    ['Była tu powódź?', 'powodz_1proc'],
    ['Ile kosztuje metr?', 'cena_m2_mediana'],
    ['Gdzie najbliższa apteka?', 'apteka_odleglosc'],
    ['Daleko do lekarza?', 'przychodnia_odleglosc'],
    ['Czy jest przedszkole blisko?', 'przedszkole_odleglosc'],
    ['Jak dobra jest szkoła – wyniki egzaminu?', 'szkola_podst_wynik_e8'],
    ['Ile jadę do Rynku?', 'rynek_czas_min'],
    ['Jak dojadę na lotnisko?', 'lotnisko_czas_min'],
    ['Gdzie zaparkuję?', 'spp_podstrefa'],
    ['Czy mogę tu parkować za darmo?', 'spp_podstrefa'],
    ['Czy tu jest strefa czystego transportu?', 'sct_w_strefie'],
    ['Czy w okolicy dużo się buduje?', 'inwestycje_500m'],
    ['Jaki jest kolor nieba?', null],
    ['', null],
  ]
  for (const [pytanie, oczekiwana] of PRZYPADKI) {
    it(`„${pytanie}” → ${oczekiwana ?? 'nie wiem'}`, () => {
      assert.deepEqual(regula(pytanie, pelna), { warstwa: oczekiwana })
    })
  }

  it('bierze tylko warstwy z listy (zastępczą, gdy głównej brak)', () => {
    const bezWorldcover = pelna.filter((p) => p.id !== 'zielen_worldcover_100m')
    assert.deepEqual(regula('czy zielono', bezWorldcover), { warstwa: 'zielen_udzial' })
    assert.deepEqual(
      regula(
        'jak głośno',
        LISTA.filter((p) => p.id !== 'halas_ldwn'),
      ),
      {
        warstwa: null,
      },
    )
  })
})

describe('odpowiedz – liczba zawsze z danych', () => {
  it('wartość, jednostka, źródło i rozdzielczość z warstwy dla adresu i', () => {
    const o = odpowiedz({ warstwa: 'halas_ldwn' }, WSKAZNIKI, 0, 'jev')
    assert.equal(o.rodzaj, 'warstwa')
    if (o.rodzaj !== 'warstwa') return
    assert.equal(o.wartosc, 62.5)
    assert.equal(o.tekst, '62,5 dB – 60–64,9 dB LDWN')
    assert.equal(o.tekstWartosci, '62,5 dB')
    assert.equal(o.opisMiejsca, '60–64,9 dB LDWN')
    assert.equal(o.jednostka, 'dB')
    assert.equal(o.zrodlo, 'Źródło halas_ldwn')
    assert.equal(o.rozdzielczosc, 'rejon wielokąt pasma mapy akustycznej')
    assert.equal(o.etykieta, 'Najwyższe pasmo hałasu (LDWN)')
    assert.equal(o.zrodloOdpowiedzi, 'jev')
  })

  it('null → „brak danych”, nigdy zero; zero z danych zostaje zerem', () => {
    const brak = odpowiedz({ warstwa: 'halas_ldwn' }, WSKAZNIKI, 1, 'reguly')
    assert.ok(brak.rodzaj === 'warstwa' && brak.wartosc === null && brak.tekst === BRAK_DANYCH)
    const zero = odpowiedz({ warstwa: 'przystanek_odleglosc' }, WSKAZNIKI, 1, 'reguly')
    assert.ok(zero.rodzaj === 'warstwa' && zero.wartosc === 0 && zero.tekst === '0 m')
    const pozaTablica = odpowiedz({ warstwa: 'przystanek_odleglosc' }, WSKAZNIKI, 99, 'reguly')
    assert.ok(pozaTablica.rodzaj === 'warstwa' && pozaTablica.tekst === BRAK_DANYCH)
  })

  it('warstwa niedostępna → brak danych mimo wartości w pamięci', () => {
    const o = odpowiedz({ warstwa: 'apteka_odleglosc' }, WSKAZNIKI, 0, 'reguly')
    assert.ok(o.rodzaj === 'warstwa' && o.wartosc === null && o.niedostepny)
  })

  it('nie wiem / atrapa → podpowiedzi zamiast liczby', () => {
    const o = odpowiedz({ warstwa: null }, WSKAZNIKI, 0, 'reguly')
    assert.equal(o.rodzaj, 'nie-wiem')
    if (o.rodzaj === 'nie-wiem') {
      assert.deepEqual(o.podpowiedzi, [
        'Jak głośno tu jest?',
        'Daleko do przystanku?',
        'Ile kosztuje metr?',
      ])
    }
    assert.equal(odpowiedz({ warstwa: 'sklep_atrapa' }, WSKAZNIKI, 0, 'jev').rodzaj, 'nie-wiem')
  })
})

describe('zapytajOAdres – całość z wstrzykniętym fetch', () => {
  it('JEV pewny → jego warstwa, liczba z danych (nie z odpowiedzi JEV)', async () => {
    const { f, wywolania } = fetchZ({
      odpowiedzi: {
        [ID_PYTANIA]: { typ: 'choice', wybor: 'cena_m2_mediana', pewnosc: 0.92, wartosc: 999 },
      },
      powod: null,
    })
    const o = await zapytajOAdres('ile za metr', WSKAZNIKI, 1, { fetch: f })
    assert.ok(o.rodzaj === 'warstwa')
    assert.equal(o.warstwa, 'cena_m2_mediana')
    assert.equal(o.wartosc, 14038.67)
    assert.equal(o.zrodloOdpowiedzi, 'jev')
    assert.equal(wywolania.length, 1)
  })

  it('JEV niepewny → reguła', async () => {
    const { f } = jevWybral('cena_m2_mediana', 0.2)
    const o = await zapytajOAdres('Jak głośno tu jest?', WSKAZNIKI, 0, { fetch: f })
    assert.ok(
      o.rodzaj === 'warstwa' && o.warstwa === 'halas_ldwn' && o.zrodloOdpowiedzi === 'reguly',
    )
  })

  it('JEV spoza listy → reguła', async () => {
    const { f } = jevWybral('sklep_atrapa', 0.99)
    const o = await zapytajOAdres('daleko do przystanku', WSKAZNIKI, 2, { fetch: f })
    assert.ok(o.rodzaj === 'warstwa' && o.warstwa === 'przystanek_odleglosc')
    assert.equal(o.wartosc, 1200)
    assert.equal(o.zrodloOdpowiedzi, 'reguly')
  })

  it('brak klucza / błąd sieci → reguła, nigdy wyjątek', async () => {
    const { f } = fetchZ({ odpowiedzi: null, powod: 'brak-klucza' })
    const o = await zapytajOAdres('jak głośno', WSKAZNIKI, 1, { fetch: f })
    assert.ok(o.rodzaj === 'warstwa' && o.tekst === BRAK_DANYCH && o.zrodloOdpowiedzi === 'reguly')
    const zepsuty = (async () => {
      throw new Error('offline')
    }) as typeof fetch
    const n = await zapytajOAdres('kolor nieba', WSKAZNIKI, 0, { fetch: zepsuty })
    assert.equal(n.rodzaj, 'nie-wiem')
  })

  it('na prawdziwym pliku warstwy wartość = wartosci[i]', async () => {
    const plik = JSON.parse(
      readFileSync('public/dane/wskazniki/przystanek_odleglosc.json', 'utf8'),
    ) as PlikWskaznika
    const i = plik.wartosci.findIndex((v) => v !== null)
    const { f } = fetchZ({ odpowiedzi: null, powod: 'brak-klucza' })
    const o = await zapytajOAdres('daleko do przystanku?', [plik], i, { fetch: f })
    assert.ok(o.rodzaj === 'warstwa')
    assert.equal(o.wartosc, plik.wartosci[i])
    assert.equal(o.jednostka, plik.meta.jednostka)
    assert.equal(o.rozdzielczosc, plik.meta.rozdzielczosc)
  })
})
