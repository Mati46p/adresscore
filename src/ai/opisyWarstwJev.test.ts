// Uruchom: node --test src/ai/
// #163: opisy warstw dla JEV – każda warstwa z public/dane ma zwykłe zdanie, bez skrótów i żargonu.
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import type { PlikWskaznika, WskaznikMeta } from '../kontrakty/index.ts'
import { MAKS_POLA, OPISY_WARSTW_DLA_JEV, SKROTY, ZARGON } from './opisyWarstwJev.ts'
import { ID_PYTANIA, kryteria, listaWarstw, zapytanieJev } from './zapytajOAdres.ts'

function metasZDanych(): WskaznikMeta[] {
  const katalog = 'public/dane/wskazniki'
  return readdirSync(katalog)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => (JSON.parse(readFileSync(`${katalog}/${f}`, 'utf8')) as PlikWskaznika).meta)
}
const METAS = metasZDanych()
const teksty = (o: (typeof OPISY_WARSTW_DLA_JEV)[string]) => [
  o.co,
  ...(o.nie_dla ? [o.nie_dla] : []),
  ...(o.przyklady ?? []),
]
const uciec = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

describe('OPISY_WARSTW_DLA_JEV', () => {
  it('każda warstwa bez atrapy z public/dane ma opis (nowa warstwa = dopisz opis tutaj)', () => {
    const brak = METAS.filter((m) => !m.atrapa && !OPISY_WARSTW_DLA_JEV[m.id]).map((m) => m.id)
    assert.deepEqual(brak, [], `Brak opisu dla JEV w src/ai/opisyWarstwJev.ts: ${brak.join(', ')}`)
  })

  it('bez wpisów dla warstw, których nie ma w danych', () => {
    const ids = new Set(METAS.map((m) => m.id))
    assert.deepEqual(
      Object.keys(OPISY_WARSTW_DLA_JEV).filter((id) => !ids.has(id)),
      [],
    )
  })

  it('każde pole ≤ 300 znaków, niepuste, przykładów 1–5 (limity pośrednika)', () => {
    for (const [id, o] of Object.entries(OPISY_WARSTW_DLA_JEV)) {
      for (const t of teksty(o)) assert.ok(t.trim().length > 0 && t.length <= MAKS_POLA, id)
      if (o.przyklady) assert.ok(o.przyklady.length >= 1 && o.przyklady.length <= 5, id)
    }
  })

  it('każdy skrót z listy ma rozwinięcie w tym samym opisie', () => {
    for (const [id, o] of Object.entries(OPISY_WARSTW_DLA_JEV)) {
      const tekst = teksty(o).join(' ')
      for (const [skrot, rozwiniecie] of Object.entries(SKROTY)) {
        const jest = new RegExp(`(?<![\\p{L}\\d])${uciec(skrot)}(?![\\p{L}\\d])`, 'u').test(tekst)
        if (jest) assert.match(tekst, rozwiniecie, `${id}: skrót ${skrot} bez rozwinięcia`)
      }
    }
  })

  it('bez żargonu technicznego (oczko siatki, H3, interferometria…)', () => {
    for (const [id, o] of Object.entries(OPISY_WARSTW_DLA_JEV))
      for (const z of ZARGON) assert.doesNotMatch(teksty(o).join(' '), z, id)
  })

  // #192 (uzbrojenie po #72 obejmuje cały Kraków) i #69 (wypadki): tylko te sześć warstw, bo ich
  // opisy dopisano albo poprawiono pod zasięg i rozdzielczość z meta. Reszty test nie obejmuje:
  // liczby są tam zapisane inaczej niż w meta (np. „7–9” wobec „07:00”) albo spoza meta (wiek żłobka).
  const UZBROJENIE = [
    'uzbrojenie_gaz_50m',
    'uzbrojenie_kanalizacja_50m',
    'uzbrojenie_prad_50m',
    'uzbrojenie_woda_50m',
  ]
  const WYPADKI = ['wypadki_heks', 'wypadki_piesi_rowerzysci_heks']
  const metaWarstwy = (id: string) => METAS.find((m) => m.id === id)
  const liczby = (s: string) => [...s.matchAll(/\d+(?:,\d+)?/g)].map((m) => m[0])

  it('#192: opisy uzbrojenia obejmują Kraków i gminy wokół, bez zawężenia do gmin i obrzeży', () => {
    for (const id of UZBROJENIE) {
      const co = OPISY_WARSTW_DLA_JEV[id]?.co ?? ''
      assert.match(co, /w Krakowie i gminach wokół/, id)
      assert.doesNotMatch(co, /tylko gmin|obrzeż/, id)
      assert.match(co, /nie dowodzi braku przyłącza/, id)
    }
  })

  it('#192, #69: liczby w opisach uzbrojenia i wypadków są z meta, obszar wypadków bez własnego szacunku', () => {
    for (const id of [...UZBROJENIE, ...WYPADKI]) {
      const meta = metaWarstwy(id)
      assert.ok(meta, `brak warstwy ${id} w danych`)
      const zMeta = new Set(
        liczby(
          [meta.nazwa, meta.opis, meta.rozmiar ?? '', ...meta.zrodla.map((z) => z.dataDanych)].join(
            ' ',
          ),
        ),
      )
      const obce = liczby(OPISY_WARSTW_DLA_JEV[id]?.co ?? '').filter((n) => !zMeta.has(n))
      assert.deepEqual(obce, [], `${id}: liczby spoza meta`)
    }
    for (const id of WYPADKI) {
      const pole = /(\d+,\d+) km²/.exec(metaWarstwy(id)?.rozmiar ?? '')?.[1]
      assert.ok(pole, `${id}: meta.rozmiar bez powierzchni w km²`)
      assert.ok(OPISY_WARSTW_DLA_JEV[id]?.co.includes(`${pole} kilometra kwadratowego`), id)
    }
  })

  it('test skrótów działa: skrót bez rozwinięcia jest wyłapany', () => {
    const tekst = 'Odległość do najbliższego P+R i SCT.'
    const wylapane = Object.entries(SKROTY)
      .filter(([s]) => new RegExp(`(?<![\\p{L}\\d])${uciec(s)}(?![\\p{L}\\d])`, 'u').test(tekst))
      .filter(([, r]) => !r.test(tekst))
      .map(([s]) => s)
    assert.deepEqual(wylapane.sort(), ['P+R', 'SCT'])
  })

  it('nie_dla i przykłady tylko przy mylonych opcjach (powódź, powietrze, hałas/przystanek, cena)', () => {
    const zeStruktura = Object.entries(OPISY_WARSTW_DLA_JEV)
      .filter(([, o]) => o.nie_dla || o.przyklady)
      .map(([id]) => id)
      .sort()
    assert.deepEqual(zeStruktura, [
      'bap_srednia',
      'cena_m2_mediana',
      'halas_ldwn',
      'no2_srednia',
      'paleniska_200m',
      'pm10_srednia',
      'pm25_srednia',
      'powodz_10proc',
      'przewietrzanie_klasa',
      'przystanek_odleglosc',
    ])
  })
})

describe('lista warstw dla JEV z opisami #163', () => {
  const lista = listaWarstw(METAS)

  it('opis z OPISY_WARSTW_DLA_JEV, a nie techniczny opis z danych', () => {
    const p = lista.find((x) => x.id === 'przewietrzanie_klasa')
    assert.match(p?.opis ?? '', /czy okolica jest przewietrzana/)
    assert.doesNotMatch(p?.opis ?? '', /anemologiczn/)
    assert.equal(p?.nie_dla, OPISY_WARSTW_DLA_JEV.przewietrzanie_klasa?.nie_dla)
  })

  it('warstwa bez wpisu dostaje opis z danych (aplikacja działa, test wyżej się wywraca)', () => {
    const meta = {
      ...METAS[0],
      id: 'nowa_warstwa',
      nazwa: 'Nowa',
      jednostka: 'm',
      opis: 'Zdanie. Drugie.',
    }
    const [p] = listaWarstw([meta as WskaznikMeta])
    assert.equal(p?.opis, 'Nowa (m). Zdanie.')
    assert.equal(p?.nie_dla, undefined)
  })

  it('choice: opcja to obiekt { co, nie_dla?, przyklady? }, nie_wiem zostaje tekstem', () => {
    const k = kryteria(lista)
    assert.deepEqual(k.halas_ldwn, {
      co: OPISY_WARSTW_DLA_JEV.halas_ldwn?.co,
      nie_dla: OPISY_WARSTW_DLA_JEV.halas_ldwn?.nie_dla,
      przyklady: OPISY_WARSTW_DLA_JEV.halas_ldwn?.przyklady,
    })
    assert.deepEqual(k.apteka_odleglosc, { co: OPISY_WARSTW_DLA_JEV.apteka_odleglosc?.co })
    assert.equal(typeof k.nie_wiem, 'string')
  })

  it('całe zapytanie przechodzi przez pośrednika i ma pod limitem ciała funkcji', async () => {
    const sciezka = new URL('../../api/_jev.js', import.meta.url).href
    const { sprawdzZapytanie } = (await import(sciezka)) as {
      sprawdzZapytanie: (c: unknown) => { blad?: string; pytania: Record<string, unknown> }
    }
    const z = zapytanieJev('Czy tu zalewa?', lista)
    const api = sprawdzZapytanie(z)
    assert.equal(api.blad, undefined)
    assert.ok(JSON.stringify(z).length < 64_000)
    const opcje = (api.pytania[ID_PYTANIA] as { criteria: Record<string, unknown> }).criteria
    assert.deepEqual(Object.keys(opcje.powodz_10proc as object), ['what', 'not_for', 'examples'])
  })
})
