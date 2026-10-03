// Uruchom: node --test 'src/ai/*.test.ts'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import type { PlikWskaznika, WskaznikMeta } from '../kontrakty/index.ts'
import {
  BRAK_DANYCH,
  drugieWywolanie,
  ID_DRUGIEJ,
  ID_PYTANIA,
  idTematu,
  listaWarstw,
  MAKS_ODPOWIEDZI,
  MIN_PROPOZYCJI,
  NIE_WIEM,
  nazwaProsta,
  odpowiedz,
  odpowiedzi,
  PROG_BEZ_PROPOZYCJI,
  PROG_DRUGIEJ,
  PROG_PEWNOSCI,
  PROG_TEMATU,
  propozycje,
  przetworz,
  przetworzWiele,
  regula,
  regulaWiele,
  regulyZTematami,
  TEMATY,
  tematWarstwy,
  type WarstwaDanych,
  wybierzWarstwy,
  wygladaNaZlozone,
  zapytajOAdres,
  zapytajOAdresWiele,
  zapytajOAdresZPropozycjami,
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
/** #153: kolejne odpowiedzi pośrednika – pierwsza na pierwsze wywołanie, druga na drugie… */
function fetchKolejno(...jsony: unknown[]) {
  const wywolania: {
    pytania: Record<string, { typ: string; polecenie: string; kryteria?: Record<string, string> }>
  }[] = []
  const f = (async (_url: unknown, init?: RequestInit) => {
    wywolania.push(JSON.parse(String(init?.body)))
    const json = jsony[Math.min(wywolania.length - 1, jsony.length - 1)]
    return { ok: true, status: 200, json: async () => json } as Response
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

// --- Pytania złożone (#146) ---------------------------------------------------------------

type OdpTestowa = Record<
  string,
  { typ: 'choice'; wybor: string; pewnosc: number } | { typ: 'noul'; noul: number }
>

describe('tematy – pytania złożone (#146)', () => {
  const metas = metasZDanych()
  const pelna = listaWarstw(metas)
  const ids = new Set(pelna.map((p) => p.id))
  const temat = (id: string) => TEMATY.find((t) => t.id === id) as (typeof TEMATY)[number]

  /** Odpowiedź JEV: choice + noul tematów (brakujące tematy = brak odpowiedzi). */
  const odp = (wybor: string, pewnosc: number, tematy: Record<string, number> = {}) => {
    const o: OdpTestowa = { [ID_PYTANIA]: { typ: 'choice', wybor, pewnosc } }
    for (const [t, noul] of Object.entries(tematy)) o[idTematu(temat(t))] = { typ: 'noul', noul }
    return o
  }

  it('każda warstwa domyślna i każda warstwa tematu jest na liście (bez atrap)', () => {
    assert.ok(TEMATY.length >= 2 && TEMATY.length <= 15)
    for (const t of TEMATY) {
      assert.ok(ids.has(t.domyslna), `${t.id}: domyślnej ${t.domyslna} nie ma na liście`)
      assert.ok(t.warstwy.includes(t.domyslna), `${t.id}: domyślna spoza grupy`)
      for (const w of t.warstwy) assert.ok(ids.has(w), `${t.id}: warstwy ${w} nie ma na liście`)
      assert.ok(t.twierdzenie.length > 0 && t.twierdzenie.length <= 300)
      assert.match(idTematu(t), /^[a-z0-9_-]{1,40}$/i)
      assert.ok(!t.twierdzenie.includes('\u2014'), 'pauza zamiast półpauzy')
    }
  })

  it('warstwa należy najwyżej do jednego tematu, id tematów unikalne', () => {
    const wszystkie = TEMATY.flatMap((t) => t.warstwy)
    assert.equal(new Set(wszystkie).size, wszystkie.length)
    assert.equal(new Set(TEMATY.map((t) => t.id)).size, TEMATY.length)
  })

  it('zapytanie ma ≤ 16 pytań: choice + noul na każdy temat', () => {
    const z = zapytanieJev('Jak głośno i daleko do tramwaju?', pelna)
    const klucze = Object.keys(z.pytania)
    assert.ok(klucze.length <= 16, `${klucze.length} pytań`)
    assert.equal(klucze[0], ID_PYTANIA)
    assert.equal(klucze.length, 1 + TEMATY.length)
    for (const t of TEMATY) assert.equal(z.pytania[idTematu(t)]?.typ, 'noul')
  })

  it('temat bez warstwy na liście nie trafia do zapytania', () => {
    const z = zapytanieJev('cokolwiek', LISTA)
    const tematy = Object.keys(z.pytania).filter((k) => k !== ID_PYTANIA)
    // LISTA testowa: apteka (zdrowie), przystanek (komunikacja), hałas, cena.
    assert.deepEqual(tematy.sort(), [
      'temat_ceny',
      'temat_halas',
      'temat_komunikacja',
      'temat_zdrowie',
    ])
  })

  it('warstwa główna pierwsza, potem tematy malejąco po noul; ≤ 3, bez duplikatów, temat raz', () => {
    const w = przetworzWiele(
      odp('halas_ldwn', 0.9, { halas: 0.95, zielen: 0.7, komunikacja: 0.9, powietrze: 0.8 }),
      pelna,
      'Jak głośno, zielono, z powietrzem i daleko do tramwaju?',
    )
    assert.ok(w)
    assert.deepEqual(w.warstwy, ['halas_ldwn', 'przystanek_odleglosc', 'pm25_srednia'])
    assert.ok(w.warstwy.length <= MAKS_ODPOWIEDZI)
    assert.equal(new Set(w.warstwy).size, w.warstwy.length)
    assert.equal(new Set(w.warstwy.map(tematWarstwy)).size, w.warstwy.length)
  })

  it('temat poniżej progu jest pomijany; dokładnie na progu – wchodzi', () => {
    const pod = przetworzWiele(
      odp('halas_ldwn', 0.9, { komunikacja: PROG_TEMATU - 0.01 }),
      pelna,
      'jak głośno',
    )
    assert.deepEqual(pod?.warstwy, ['halas_ldwn'])
    const na = przetworzWiele(odp('halas_ldwn', 0.9, { komunikacja: PROG_TEMATU }), pelna, 'x')
    assert.deepEqual(na?.warstwy, ['halas_ldwn', 'przystanek_odleglosc'])
  })

  it('temat warstwy głównej nic nie dokłada; reguły wskazują lepszą warstwę z grupy', () => {
    const w = przetworzWiele(
      odp('pm25_srednia', 0.9, { powietrze: 0.99, zielen: 0.9 }),
      pelna,
      'Jak tu z powietrzem i czy są drzewa pod oknem?',
    )
    // „drzew” → reguła drzewa_100m zamiast domyślnej zieleni z WorldCover.
    assert.deepEqual(w?.warstwy, ['pm25_srednia', 'drzewa_100m'])
  })

  it('#147: dwa różne obiekty z jednego tematu → druga warstwa z reguł, bez nowego wywołania', () => {
    // Przedszkole + żłobek: JEV wybiera przedszkole, temat szkół ma noul wysoko, reguły trafiają
    // w obie warstwy – druga stoi zaraz po pierwszej.
    const w = przetworzWiele(
      odp('przedszkole_odleglosc', 0.9, { szkoly: 0.98, demografia: 0.65 }),
      pelna,
      'Blisko do przedszkola i żłobka?',
    )
    assert.deepEqual(w?.warstwy, ['przedszkole_odleglosc', 'zlobek_odleglosc', 'ludnosc_1km'])
    // Apteka + przychodnia; rower + stojaki.
    assert.deepEqual(
      przetworzWiele(
        odp('apteka_odleglosc', 0.9, { zdrowie: 0.98 }),
        pelna,
        'Apteka i przychodnia?',
      )?.warstwy,
      ['apteka_odleglosc', 'przychodnia_odleglosc'],
    )
    assert.deepEqual(
      przetworzWiele(
        odp('rower_infrastruktura_odleglosc', 0.9, { rower: 0.98 }),
        pelna,
        'Dojadę rowerem i gdzie go przypiąć?',
      )?.warstwy,
      ['rower_infrastruktura_odleglosc', 'stojaki_300m'],
    )
  })

  it('#150: „gdzie przypiąć rower” → stojaki, bez trasy rowerowej (samo „rower” to słowo tematu)', () => {
    const pytanie = 'Jest gdzie przypiąć rower pod blokiem?'
    assert.deepEqual(
      przetworzWiele(odp('stojaki_300m', 0.9, { rower: 0.98 }), pelna, pytanie)?.warstwy,
      ['stojaki_300m'],
    )
    assert.deepEqual(regulaWiele(pytanie, pelna).warstwy, ['stojaki_300m'])
    assert.equal(regula(pytanie, pelna).warstwa, 'stojaki_300m')
    // Jazda rowerem nazywa trasę – wtedy obie warstwy, jak w #147.
    assert.deepEqual(
      przetworzWiele(
        odp('stojaki_300m', 0.9, { rower: 0.98 }),
        pelna,
        'Dojadę rowerem do pracy i gdzie go przypiąć?',
      )?.warstwy,
      ['stojaki_300m', 'rower_infrastruktura_odleglosc'],
    )
  })

  it('#150: „z psem do weterynarza” → bez zieleni (reguły i przetwarzanie)', () => {
    const pytanie = 'Daleko z psem do weterynarza?'
    // noul jak na żywo dla nowych twierdzeń: sklepy (usługi) 0,97, zieleń 0,03.
    const w = przetworzWiele(
      odp('weterynarz_odleglosc', 0.9, { sklepy: 0.97, zielen: 0.03 }),
      pelna,
      pytanie,
    )
    assert.deepEqual(w?.warstwy, ['weterynarz_odleglosc'])
    assert.ok(!regulaWiele(pytanie, pelna).warstwy.some((x) => tematWarstwy(x) === 'zielen'))
    // #152: dopisek zieleni i twierdzenie tematu (to, co widzi JEV) wróciły do #147, więc
    // asercje o ich brzmieniu z #150 są usunięte; zostaje przetwarzanie i reguły.
  })

  it('#153: „z psem do weta” – twierdzenia zieleni i zdrowia wykluczają weterynarza; bez zieleni i bez drugiego wywołania', async () => {
    const zielen = temat('zielen').twierdzenie
    assert.match(zielen, /weterynarz/)
    assert.match(zielen, /posiadanie psa to nie to/)
    // Spacer i park zostają w twierdzeniu – „gdzie wyjść z psem, jakiś park” to nadal zieleń.
    assert.match(zielen, /parki/)
    assert.match(zielen, /spacer/)
    assert.match(temat('zdrowie').twierdzenie, /Weterynarz to nie to/)
    // Mock: JEV wybiera weterynarza, zieleń i zdrowie pod progiem (jak po poprawce).
    const pytanie = 'Daleko stąd z psem do weta?'
    const { f, wywolania } = fetchKolejno({
      odpowiedzi: odp('weterynarz_odleglosc', 0.93, { zielen: 0.2, zdrowie: 0.3, sklepy: 0.76 }),
      powod: null,
    })
    const r = await wybierzWarstwy(pytanie, pelna, { fetch: f })
    assert.equal(r.zrodlo, 'jev')
    assert.deepEqual(r.wynik.warstwy, ['weterynarz_odleglosc'])
    assert.ok(!r.wynik.warstwy.some((x) => tematWarstwy(x) === 'zielen'))
    assert.equal(wywolania.length, 1)
    assert.equal(r.drugie, null)
  })

  it('#153: dwa z jednego tematu przez JEV – reguły znają tylko przedszkole, drugie wywołanie dokłada żłobek', async () => {
    const pytanie = 'Czy blisko jest przedszkole, a dla młodszego jakaś opieka na cały dzień?'
    // Reguły nie znają drugiego obiektu – bez JEV byłaby jedna warstwa.
    assert.deepEqual(regulaWiele(pytanie, pelna).warstwy, ['przedszkole_odleglosc'])
    const { f, wywolania } = fetchKolejno(
      { odpowiedzi: odp('przedszkole_odleglosc', 0.9, { szkoly: 0.95 }), powod: null },
      {
        odpowiedzi: { [ID_DRUGIEJ]: { typ: 'choice', wybor: 'zlobek_odleglosc', pewnosc: 0.88 } },
        powod: null,
      },
    )
    const r = await wybierzWarstwy(pytanie, pelna, { fetch: f })
    assert.deepEqual(r.wynik.warstwy, ['przedszkole_odleglosc', 'zlobek_odleglosc'])
    assert.equal(r.drugie, 'szkoly')
    assert.equal(wywolania.length, 2)
    // Drugie zapytanie: jedno pytanie, tylko warstwy tematu o innym obiekcie + nie_wiem na końcu.
    const druga = wywolania[1]?.pytania[ID_DRUGIEJ]
    assert.equal(Object.keys(wywolania[1]?.pytania ?? {}).length, 1)
    assert.equal(druga?.typ, 'choice')
    const opcje = Object.keys(druga?.kryteria ?? {})
    assert.ok(!opcje.includes('przedszkole_odleglosc'))
    assert.ok(opcje.includes('zlobek_odleglosc'))
    assert.equal(opcje.at(-1), NIE_WIEM)
    for (const w of opcje.slice(0, -1)) assert.equal(tematWarstwy(w), 'szkoly')
    assert.ok((druga?.polecenie.length ?? 0) <= 300)
  })

  it('#153: drugie wywołanie – nie_wiem, niska pewność albo błąd → zostaje jedna warstwa', async () => {
    const pytanie = 'Czy blisko jest przedszkole, a dla młodszego jakaś opieka na cały dzień?'
    const pierwsza = {
      odpowiedzi: odp('przedszkole_odleglosc', 0.9, { szkoly: 0.95 }),
      powod: null,
    }
    for (const druga of [
      {
        odpowiedzi: { [ID_DRUGIEJ]: { typ: 'choice', wybor: NIE_WIEM, pewnosc: 0.95 } },
        powod: null,
      },
      {
        odpowiedzi: {
          [ID_DRUGIEJ]: { typ: 'choice', wybor: 'zlobek_odleglosc', pewnosc: PROG_DRUGIEJ - 0.01 },
        },
        powod: null,
      },
      // Spoza listy drugiego wywołania (ten sam obiekt co pierwsza) – odrzucone.
      {
        odpowiedzi: {
          [ID_DRUGIEJ]: { typ: 'choice', wybor: 'przedszkole_odleglosc', pewnosc: 0.99 },
        },
        powod: null,
      },
      { odpowiedzi: null, powod: 'blad' },
    ]) {
      const { f, wywolania } = fetchKolejno(pierwsza, druga)
      const r = await wybierzWarstwy(pytanie, pelna, { fetch: f })
      assert.deepEqual(r.wynik.warstwy, ['przedszkole_odleglosc'])
      assert.equal(r.zrodlo, 'jev')
      assert.equal(wywolania.length, 2)
    }
  })

  it('#153: bez drugiego wywołania, gdy pytanie o jedno, temat nisko albo reguły już dały obie warstwy', async () => {
    const przypadki: [string, OdpTestowa][] = [
      // Pytanie nie wygląda na złożone.
      ['Daleko do przedszkola?', odp('przedszkole_odleglosc', 0.9, { szkoly: 0.95 })],
      // Temat pod progiem.
      [
        'Przedszkole, i co jeszcze?',
        odp('przedszkole_odleglosc', 0.9, { szkoly: PROG_TEMATU - 0.01 }),
      ],
      // Reguły nazwały oba obiekty (#147) – druga warstwa już jest.
      ['Blisko do przedszkola i żłobka?', odp('przedszkole_odleglosc', 0.9, { szkoly: 0.98 })],
      // Temat bez różnych obiektów (powietrze).
      ['Smog, a zimą dym z pieców?', odp('pm25_srednia', 0.9, { powietrze: 0.98 })],
    ]
    for (const [pytanie, o] of przypadki) {
      const { f, wywolania } = fetchKolejno({ odpowiedzi: o, powod: null })
      const r = await wybierzWarstwy(pytanie, pelna, { fetch: f })
      assert.equal(wywolania.length, 1, pytanie)
      assert.equal(r.drugie, null, pytanie)
    }
    // Brak JEV → reguły, bez drugiego wywołania.
    const { f, wywolania } = fetchKolejno({ odpowiedzi: null, powod: 'brak-klucza' })
    const r = await wybierzWarstwy('Przedszkole, a dla młodszego?', pelna, { fetch: f })
    assert.equal(r.zrodlo, 'zapas')
    assert.equal(wywolania.length, 1)
  })

  it('#153: wygladaNaZlozone i drugieWywolanie – tylko wolne miejsce i temat z obiektami', () => {
    assert.equal(wygladaNaZlozone('Daleko do przedszkola?'), false)
    assert.equal(wygladaNaZlozone('Apteka i przychodnia?'), true)
    assert.equal(wygladaNaZlozone('Jest apteka? A lekarz?'), true)
    assert.equal(wygladaNaZlozone('Jak tu z parkingiem'), false)
    // Pełna odpowiedź (3 warstwy) – nie ma miejsca na drugą.
    assert.equal(
      drugieWywolanie(
        odp('apteka_odleglosc', 0.9, { zdrowie: 0.95 }),
        ['apteka_odleglosc', 'halas_ldwn', 'pm25_srednia'],
        pelna,
        'Apteka, cisza i powietrze?',
      ),
      null,
    )
    const d = drugieWywolanie(
      odp('apteka_odleglosc', 0.9, { zdrowie: 0.95 }),
      ['apteka_odleglosc'],
      pelna,
      'Apteka, a jak coś poważniejszego to gdzie?',
    )
    assert.equal(d?.temat, 'zdrowie')
    const opcje = Object.keys(
      (d?.zapytanie.pytania[ID_DRUGIEJ] as { kryteria: Record<string, string> }).kryteria,
    )
    assert.deepEqual(opcje, [
      'przychodnia_odleglosc',
      'przychodnia_bez_barier_odleglosc',
      'defibrylator_odleglosc',
      NIE_WIEM,
    ])
  })

  it('#147: druga warstwa z tematu tylko w wolne miejsce, bez duplikatów, ≤ 3', () => {
    const w = przetworzWiele(
      odp('przedszkole_odleglosc', 0.9, { szkoly: 0.98, halas: 0.9, zielen: 0.9 }),
      pelna,
      'Przedszkole, żłobek, cisza i zieleń?',
    )
    // Różne tematy mają pierwszeństwo – żłobek się nie mieści.
    assert.deepEqual(w?.warstwy, ['przedszkole_odleglosc', 'halas_ldwn', 'zielen_worldcover_100m'])
    assert.equal(new Set(w?.warstwy).size, w?.warstwy.length)
  })

  it('#147: jedna rzecz z tematu albo temat miar jednej rzeczy → jedna warstwa jak dotąd', () => {
    // Tylko przedszkole – reguły trafiają jedną warstwę w temacie.
    assert.deepEqual(
      przetworzWiele(
        odp('przedszkole_odleglosc', 0.9, { szkoly: 0.98 }),
        pelna,
        'Daleko do przedszkola?',
      )?.warstwy,
      ['przedszkole_odleglosc'],
    )
    // Przychodnia bez barier i „lekarz” to ten sam obiekt – bez drugiej warstwy.
    assert.deepEqual(
      przetworzWiele(
        odp('przychodnia_bez_barier_odleglosc', 0.9, { zdrowie: 0.98 }),
        pelna,
        'Czy przychodnia jest bez barier dla wózka, daleko do lekarza?',
      )?.warstwy,
      ['przychodnia_bez_barier_odleglosc'],
    )
    // Obiekty tematu to jego warstwy.
    for (const t of TEMATY)
      for (const w of Object.keys(t.obiekty ?? {})) assert.ok(t.warstwy.includes(w), w)
    // Powietrze to kilka miar jednego (smog i piece) – bez drugiej warstwy.
    assert.deepEqual(
      przetworzWiele(
        odp('pm25_srednia', 0.9, { powietrze: 0.98 }),
        pelna,
        'Da się tu oddychać zimą, jak palą w piecach?',
      )?.warstwy,
      ['pm25_srednia'],
    )
  })

  it('pewne nie_wiem → „nie wiem” bez dodatków, nawet gdy tematy są wysoko', () => {
    assert.deepEqual(
      przetworzWiele(odp(NIE_WIEM, 0.9, { ceny: 0.9, halas: 0.8 }), pelna, 'czynsz?'),
      { warstwy: [] },
    )
  })

  it('niepewny wybór główny albo spoza listy → reguła (null)', () => {
    assert.equal(przetworzWiele(odp('halas_ldwn', 0.3, { halas: 0.99 }), pelna, 'x'), null)
    assert.equal(przetworzWiele(odp('sklep_atrapa', 0.99, { sklepy: 0.99 }), LISTA, 'x'), null)
  })

  it('atrapy nigdy: ani jako warstwa główna, ani jako dodatek', () => {
    const atrapa = meta('halas_ldwn', 'spokoj', { atrapa: true })
    const lista = listaWarstw([...metas.filter((m) => m.id !== 'halas_ldwn'), atrapa])
    // halas_ldwn jest atrapą → temat bierze inną warstwę z grupy, nigdy atrapę.
    const w = przetworzWiele(odp('przystanek_odleglosc', 0.9, { halas: 0.9 }), lista, 'x')
    assert.deepEqual(w?.warstwy, ['przystanek_odleglosc', 'halas_obwarzanek_lden'])
    const o = odpowiedzi({ warstwy: ['sklep_atrapa', 'halas_ldwn'] }, WSKAZNIKI, 0, 'jev')
    assert.deepEqual(
      o.map((x) => (x.rodzaj === 'warstwa' ? x.warstwa : x.rodzaj)),
      ['halas_ldwn'],
    )
  })
})

describe('regulaWiele – reguła zapasowa z kilkoma tematami', () => {
  const pelna = listaWarstw(metasZDanych())
  const PRZYPADKI: [string, string[]][] = [
    ['Jak głośno i daleko do tramwaju?', ['halas_ldwn', 'przystanek_odleglosc']],
    ['Daleko do tramwaju i jak głośno?', ['przystanek_odleglosc', 'halas_ldwn']],
    ['Ile kosztuje metr i czy nie zalewa?', ['cena_m2_mediana', 'powodz_1proc']],
    [
      'Czy jest zielono, cicho i bezpiecznie wieczorem?',
      ['zielen_worldcover_100m', 'halas_ldwn', 'miejscowe_zagrozenia_gmina_2025'],
    ],
    // Dwie reguły z jednego tematu (powietrze) → jedna warstwa; remis – wyżej w REGULY.
    ['Jaki smog i ile NO2?', ['no2_srednia']],
    // #147: dwa różne obiekty z jednego tematu → dwie warstwy.
    ['Blisko do przedszkola i żłobka?', ['przedszkole_odleglosc', 'zlobek_odleglosc']],
    ['Jest tu apteka i przychodnia na spacer?', ['apteka_odleglosc', 'przychodnia_odleglosc']],
    ['Jak głośno tu jest?', ['halas_ldwn']],
    ['Jaki jest kolor nieba?', []],
  ]
  for (const [pytanie, oczekiwane] of PRZYPADKI) {
    it(`„${pytanie}” → ${oczekiwane.join(' + ') || 'nie wiem'}`, () => {
      assert.deepEqual(regulaWiele(pytanie, pelna).warstwy, oczekiwane)
    })
  }

  it('najwyżej 3 warstwy, bez duplikatów, jedna na temat', () => {
    const w = regulaWiele(
      'Głośno? Przystanek? Zielono? Smog? Zalewa? Sklep? Apteka? Cena metra?',
      pelna,
    ).warstwy
    assert.equal(w.length, MAKS_ODPOWIEDZI)
    assert.deepEqual(w, ['halas_ldwn', 'przystanek_odleglosc', 'zielen_worldcover_100m'])
    assert.equal(new Set(w.map(tematWarstwy)).size, w.length)
  })

  it('pytanie o jedno: ta sama warstwa co reguła pojedyncza', () => {
    for (const p of [
      'Jak głośno tu jest?',
      'Daleko do przystanku?',
      'Czy zalewa?',
      'Ile kosztuje metr?',
    ])
      assert.deepEqual(regulaWiele(p, pelna).warstwy, [regula(p, pelna).warstwa])
  })
})

describe('zapytajOAdresWiele – całość z wstrzykniętym fetch', () => {
  it('jedno wywołanie, kilka odpowiedzi z danych w kolejności, każda ze źródłem', async () => {
    const { f, wywolania } = fetchZ({
      odpowiedzi: {
        [ID_PYTANIA]: { typ: 'choice', wybor: 'halas_ldwn', pewnosc: 0.9 },
        temat_komunikacja: { typ: 'noul', noul: 0.93 },
        temat_ceny: { typ: 'noul', noul: 0.71 },
        temat_zdrowie: { typ: 'noul', noul: 0.2 },
      },
      powod: null,
    })
    const o = await zapytajOAdresWiele(
      'Jak głośno, daleko do tramwaju i ile za metr?',
      WSKAZNIKI,
      2,
      { fetch: f },
    )
    assert.equal(wywolania.length, 1)
    assert.deepEqual(
      o.map((x) => (x.rodzaj === 'warstwa' ? [x.warstwa, x.tekstWartosci] : x.rodzaj)),
      [
        ['halas_ldwn', '57,5 dB'],
        ['przystanek_odleglosc', '1200 m'],
        ['cena_m2_mediana', '9000 zł/m²'],
      ],
    )
    for (const x of o) assert.ok(x.rodzaj === 'warstwa' && x.zrodlo && x.rozdzielczosc)
  })

  it('brak danych pod adresem dla dodatku → „brak danych”, nie zero', async () => {
    const { f } = fetchZ({
      odpowiedzi: {
        [ID_PYTANIA]: { typ: 'choice', wybor: 'przystanek_odleglosc', pewnosc: 0.9 },
        temat_ceny: { typ: 'noul', noul: 0.9 },
      },
      powod: null,
    })
    const o = await zapytajOAdresWiele('przystanek i ceny', WSKAZNIKI, 0, { fetch: f })
    const c = o[1]
    assert.ok(c?.rodzaj === 'warstwa' && c.warstwa === 'cena_m2_mediana')
    assert.equal(c.wartosc, null)
    assert.equal(c.tekstWartosci, BRAK_DANYCH)
  })

  it('brak JEV → reguła z kilkoma tematami', async () => {
    const { f } = fetchZ({ odpowiedzi: null, powod: 'brak-klucza' })
    const o = await zapytajOAdresWiele('Jak głośno i daleko do tramwaju?', WSKAZNIKI, 0, {
      fetch: f,
    })
    assert.deepEqual(
      o.map((x) => (x.rodzaj === 'warstwa' ? `${x.warstwa}/${x.zrodloOdpowiedzi}` : x.rodzaj)),
      ['halas_ldwn/reguly', 'przystanek_odleglosc/reguly'],
    )
  })

  it('pytanie o jedno = jedna odpowiedź, ta sama co zapytajOAdres', async () => {
    const { f } = jevWybral('halas_ldwn', 0.9)
    const wiele = await zapytajOAdresWiele('Jak głośno?', WSKAZNIKI, 0, { fetch: f })
    const jedna = await zapytajOAdres('Jak głośno?', WSKAZNIKI, 0, { fetch: f })
    assert.equal(wiele.length, 1)
    assert.deepEqual(wiele[0], jedna)
  })

  it('nie wiem → jedna odpowiedź „nie wiem”', async () => {
    const { f } = jevWybral(NIE_WIEM, 0.9)
    const o = await zapytajOAdresWiele('Jaka będzie pogoda?', WSKAZNIKI, 0, { fetch: f })
    assert.equal(o.length, 1)
    assert.equal(o[0]?.rodzaj, 'nie-wiem')
  })
})

// --- #156: dwie propozycje (R4) i tematy przy słabym wyborze głównym (R5) -----------------

type OdpJev = Parameters<typeof przetworzWiele>[0]
/** Odpowiedź pośrednika z rozkładem (#154) i ocenami tematów. */
const zRozkladem = (
  wybor: string,
  pewnosc: number | null,
  prawdopodobienstwa?: Record<string, number>,
  tematy: Record<string, number> = {},
): OdpJev => {
  const o: OdpJev = {
    [ID_PYTANIA]: {
      typ: 'choice',
      wybor,
      pewnosc,
      ...(prawdopodobienstwa && { prawdopodobienstwa }),
    },
  }
  for (const [t, noul] of Object.entries(tematy)) o[`temat_${t}`] = { typ: 'noul', noul }
  return o
}

describe('#156 R4 – dwie propozycje przy pewności 0,5–0,9', () => {
  const rozklad = { halas_ldwn: 0.7, przystanek_odleglosc: 0.2, nie_wiem: 0.1 }

  it('0,5–0,9 z rozkładem → dwie propozycje, warstwy jak dotąd', () => {
    for (const p of [PROG_PEWNOSCI, 0.7, PROG_BEZ_PROPOZYCJI]) {
      const r = przetworzWiele(zRozkladem('halas_ldwn', p, rozklad), LISTA, 'Jak tu jest?')
      assert.deepEqual(r?.warstwy, ['halas_ldwn'])
      assert.deepEqual(
        r?.propozycje?.map((x) => x.warstwa),
        ['halas_ldwn', 'przystanek_odleglosc'],
        `pewność ${p}`,
      )
    }
  })

  it('> 0,9 → odpowiedź od razu, bez propozycji', () => {
    const r = przetworzWiele(zRozkladem('halas_ldwn', 0.91, rozklad), LISTA, 'Jak głośno?')
    assert.deepEqual(r, { warstwy: ['halas_ldwn'] })
  })

  it('< 0,5 albo brak pewności → reguły (null), mimo rozkładu', () => {
    assert.equal(przetworzWiele(zRozkladem('halas_ldwn', 0.49, rozklad), LISTA, 'x'), null)
    assert.equal(przetworzWiele(zRozkladem('halas_ldwn', null, rozklad), LISTA, 'x'), null)
    assert.equal(propozycje(zRozkladem('halas_ldwn', 0.3, rozklad), LISTA), null)
  })

  it('nie_wiem i id spoza listy (także atrapa) nie są propozycjami', () => {
    const o = zRozkladem('nie_wiem', 0.6, {
      nie_wiem: 0.6,
      nieznana_warstwa: 0.2,
      sklep_atrapa: 0.1,
      cena_m2_mediana: 0.06,
      przystanek_odleglosc: 0.05,
      halas_ldwn: 0.04,
    })
    assert.deepEqual(propozycje(o, LISTA), ['cena_m2_mediana', 'przystanek_odleglosc'])
    // nie_wiem w paśmie: warstwy puste jak dotąd, propozycje obok.
    const r = przetworzWiele(o, LISTA, 'Coś tu?')
    assert.deepEqual(r?.warstwy, [])
    assert.equal(r?.propozycje?.length, 2)
  })

  it(`tylko jedna warstwa z p ≥ ${MIN_PROPOZYCJI} → bez propozycji, jak dotąd`, () => {
    const o = zRozkladem('halas_ldwn', 0.8, {
      halas_ldwn: 0.8,
      nie_wiem: 0.18,
      cena_m2_mediana: 0.02,
    })
    assert.equal(propozycje(o, LISTA), null)
    assert.deepEqual(przetworzWiele(o, LISTA, 'Jak głośno?'), { warstwy: ['halas_ldwn'] })
    const nw = zRozkladem('nie_wiem', 0.7, {
      nie_wiem: 0.7,
      cena_m2_mediana: 0.29,
      halas_ldwn: 0.01,
    })
    assert.deepEqual(przetworzWiele(nw, LISTA, 'Drogo?'), { warstwy: [] })
  })

  it('brak rozkładu → dokładnie jak dotąd', () => {
    for (const p of [0.5, 0.7, 0.9, 0.95]) {
      assert.deepEqual(przetworzWiele(zRozkladem('halas_ldwn', p), LISTA, 'Jak głośno?'), {
        warstwy: ['halas_ldwn'],
      })
    }
    // Rozkład bez sensownych liczb też nic nie zmienia.
    const zle = zRozkladem('halas_ldwn', 0.7, { halas_ldwn: Number.NaN, przystanek_odleglosc: 7 })
    assert.equal(propozycje(zle, LISTA), null)
  })

  it('każda propozycja ma własne dodatki z tematów (bez duplikatu tematu)', () => {
    const o = zRozkladem(
      'halas_ldwn',
      0.7,
      { halas_ldwn: 0.6, przystanek_odleglosc: 0.3, nie_wiem: 0.1 },
      { komunikacja: 0.9, ceny: 0.8 },
    )
    const r = przetworzWiele(o, LISTA, 'Jak tu jest?')
    assert.deepEqual(r?.warstwy, ['halas_ldwn', 'przystanek_odleglosc', 'cena_m2_mediana'])
    assert.deepEqual(r?.propozycje, [
      {
        warstwa: 'halas_ldwn',
        warstwy: ['halas_ldwn', 'przystanek_odleglosc', 'cena_m2_mediana'],
      },
      { warstwa: 'przystanek_odleglosc', warstwy: ['przystanek_odleglosc', 'cena_m2_mediana'] },
    ])
  })

  it('całość: propozycje z danymi i nazwą prostymi słowami; wyraźne pytanie bez zmian', async () => {
    const { f } = fetchZ({ odpowiedzi: zRozkladem('halas_ldwn', 0.7, rozklad), powod: null })
    const w = await zapytajOAdresZPropozycjami('Jak tu jest?', WSKAZNIKI, 2, { fetch: f })
    assert.deepEqual(
      w.propozycje?.map((p) => [
        p.nazwa,
        p.odpowiedzi.map((o) => (o.rodzaj === 'warstwa' ? o.tekstWartosci : o.rodzaj)),
      ]),
      [
        ['Najwyższe pasmo hałasu', ['57,5 dB']],
        ['Najbliższy przystanek', ['1200 m']],
      ],
    )
    for (const p of w.propozycje ?? [])
      for (const o of p.odpowiedzi) assert.ok(o.rodzaj === 'warstwa' && o.zrodlo && o.rozdzielczosc)
    // Bez kliknięcia: te same odpowiedzi co zapytajOAdresWiele.
    const wiele = await zapytajOAdresWiele('Jak tu jest?', WSKAZNIKI, 2, { fetch: f })
    assert.deepEqual(w.odpowiedzi, wiele)

    const pewne = fetchZ({ odpowiedzi: zRozkladem('halas_ldwn', 0.95, rozklad), powod: null })
    const j = await zapytajOAdresZPropozycjami('Jak głośno?', WSKAZNIKI, 2, { fetch: pewne.f })
    assert.equal(j.propozycje, null)
    assert.equal(j.odpowiedzi.length, 1)
  })

  it('nazwaProsta zdejmuje tylko dopisek w nawiasie na końcu', () => {
    assert.equal(nazwaProsta('Najwyższe pasmo hałasu (LDWN)'), 'Najwyższe pasmo hałasu')
    assert.equal(nazwaProsta('PM2,5 – średnia roczna'), 'PM2,5 – średnia roczna')
    assert.equal(nazwaProsta('(X)'), '(X)')
  })
})

describe('#156 R5 – tematy JEV nie przepadają przy słabym wyborze głównym', () => {
  const pelna = listaWarstw(metasZDanych())

  it('wybór < 0,5: reguły + tematy JEV ≥ progu, do 3, bez duplikatów, jeden na temat', () => {
    const o = zRozkladem('zielen_worldcover_100m', 0.49, undefined, {
      halas: 0.96,
      bezpieczenstwo: 0.93,
      ceny: 0.9,
      zielen: 0.68,
      powodz: PROG_TEMATU - 0.01,
    })
    const pytanie = 'Jak głośno?'
    assert.deepEqual(regulaWiele(pytanie, pelna).warstwy, ['halas_ldwn'])
    const r = regulyZTematami(o, pelna, pytanie)
    assert.equal(r.tematyZJev, true)
    assert.equal(r.warstwy.length, MAKS_ODPOWIEDZI)
    assert.equal(new Set(r.warstwy).size, r.warstwy.length)
    assert.equal(new Set(r.warstwy.map(tematWarstwy)).size, r.warstwy.length)
    // Reguły pierwsze; hałas już jest, więc temat hałasu nic nie dokłada; dalej malejąco po noul.
    assert.deepEqual(r.warstwy, ['halas_ldwn', 'oswietlenie_100m', 'cena_m2_mediana'])
    assert.ok(!r.warstwy.some((w) => tematWarstwy(w) === 'powodz'))
  })

  it('bez tematów ≥ progu → dokładnie reguły', () => {
    const o = zRozkladem('halas_ldwn', 0.3, undefined, { ceny: 0.5 })
    const pytanie = 'Jak głośno i daleko do tramwaju?'
    assert.deepEqual(regulyZTematami(o, pelna, pytanie), regulaWiele(pytanie, pelna))
  })

  it('całość: niska pewność → reguły + temat JEV, podpis „reguły i JEV”', async () => {
    const { f, wywolania } = fetchZ({
      odpowiedzi: zRozkladem('halas_ldwn', 0.3, {}, { ceny: 0.9 }),
      powod: null,
    })
    const o = await zapytajOAdresWiele('Jak głośno?', WSKAZNIKI, 2, { fetch: f })
    assert.equal(wywolania.length, 1)
    assert.deepEqual(
      o.map((x) => (x.rodzaj === 'warstwa' ? `${x.warstwa}/${x.zrodloOdpowiedzi}` : x.rodzaj)),
      ['halas_ldwn/reguly-i-jev', 'cena_m2_mediana/reguly-i-jev'],
    )
  })

  it('wybór spoza listy (odpowiedź null) → też reguły + tematy', async () => {
    const { f } = fetchZ({
      odpowiedzi: { [ID_PYTANIA]: null, temat_komunikacja: { typ: 'noul', noul: 0.8 } },
      powod: null,
    })
    const r = await wybierzWarstwy('Jak tu z dojazdem?', pelna, { fetch: f })
    assert.equal(r.zrodlo, 'zapas')
    assert.deepEqual(r.wynik.warstwy, ['przystanek_odleglosc'])
  })

  it('+ #153: drugie wywołanie po drugi obiekt z tematu działa też tutaj', async () => {
    const pytanie = 'Czy blisko jest przedszkole, a dla młodszego jakaś opieka na cały dzień?'
    const { f, wywolania } = fetchKolejno(
      {
        odpowiedzi: zRozkladem('przedszkole_odleglosc', 0.4, undefined, { szkoly: 0.95 }),
        powod: null,
      },
      {
        odpowiedzi: { [ID_DRUGIEJ]: { typ: 'choice', wybor: 'zlobek_odleglosc', pewnosc: 0.88 } },
        powod: null,
      },
    )
    const r = await wybierzWarstwy(pytanie, pelna, { fetch: f })
    assert.equal(r.zrodlo, 'zapas')
    assert.deepEqual(r.wynik.warstwy, ['przedszkole_odleglosc', 'zlobek_odleglosc'])
    assert.equal(wywolania.length, 2)
  })

  it('brak JEV (błąd pośrednika) → same reguły, jak dotąd', async () => {
    const { f } = fetchZ({ odpowiedzi: null, powod: 'blad' })
    const r = await wybierzWarstwy('Jak głośno?', pelna, { fetch: f })
    assert.deepEqual(r.wynik, regulaWiele('Jak głośno?', pelna))
  })
})
