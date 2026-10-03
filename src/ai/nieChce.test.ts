// Uruchom: node --test src/ai/
// #182: potrzeby „na nie” w „opisz siebie” – bez sieci (JEV atrapą).
// #187: siła potrzeby z #182 cofnięta (zamrożenie JEV) – testy pilnują, że jej nie ma.
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import type { PlikWskaznika, WskaznikMeta } from '../kontrakty/index.ts'
import { kierunekEfektywny } from '../wynik/silnik.ts'
import type { OdpowiedzJev } from './jev.ts'
import * as opisz from './opiszSiebie.ts'
import {
  kierunkiPotrzeb,
  NA_NIE,
  nicNieZrozumiano,
  POTRZEBY,
  PROG_NA_NIE,
  przetworzOdpowiedzi,
  wagiZeZrozumienia,
  type Zrozumienie,
  zapytanieOpiszSiebie,
  zRegul,
} from './opiszSiebie.ts'

const METAS: WskaznikMeta[] = readdirSync('public/dane/wskazniki')
  .filter((f) => f.endsWith('.json'))
  .sort()
  .map(
    (f) => (JSON.parse(readFileSync(`public/dane/wskazniki/${f}`, 'utf8')) as PlikWskaznika).meta,
  )
const META = new Map(METAS.map((m) => [m.id, m]))
const BIEZACE = { wagi: {}, kierunki: {} }

const noul = (x: number): OdpowiedzJev => ({ typ: 'noul', noul: x })
const score = (x: number, pewnosc = 0.9): OdpowiedzJev => ({ typ: 'score', ocena: x, pewnosc })
/** Odpowiedzi JEV: bramka otwarta, profil nieznany (bez zmiany profilu). */
const odp = (o: Record<string, OdpowiedzJev>): Record<string, OdpowiedzJev | null> => ({
  profil: { typ: 'choice', wybor: 'nieznany', pewnosc: 0.9 },
  nikt_nie_szuka: noul(0.05),
  sytuacja_nieaktualna: noul(0.05),
  ...o,
})
const zr = (z: Partial<Zrozumienie>): Zrozumienie => ({
  persona: null,
  kategorie: {},
  wskazniki: {},
  potrzeby: [],
  zrozumialem: [],
  ...z,
})

describe('zamrożenie (#187): bez siły potrzeby', () => {
  it('zapytanie: 29 pytań, żadnego pytania o siłę (s_dom, s_otoczenie, s_dojazd)', () => {
    const ids = Object.keys(zapytanieOpiszSiebie('Mam psa, park byłoby miło').pytania)
    assert.equal(ids.length, 29)
    for (const id of ['s_dom', 's_otoczenie', 's_dojazd']) assert.ok(!ids.includes(id), id)
    // Jedyne pytania score to poziomy kategorii.
    const z = zapytanieOpiszSiebie('x')
    for (const [id, p] of Object.entries(z.pytania))
      if ((p as { typ: string }).typ === 'score') assert.match(id, /^kat_/)
    // Z modułu zniknęło wszystko, co liczyło siłę.
    for (const nazwa of ['wagaZSily', 'GRUPY_SILY', 'SKALA_SILY', 'OPISY_SILY', 'silaZRegul'])
      assert.equal((opisz as Record<string, unknown>)[nazwa], undefined, nazwa)
  })

  it('JEV: wagi każdej potrzeby z twierdzeniem = wagi z tabeli POTRZEBY; oceny „siły” bez wpływu', () => {
    for (const p of POTRZEBY) {
      if (!p.twierdzenie) continue
      const z = przetworzOdpowiedzi(
        odp({
          [`p_${p.id}`]: noul(0.95),
          // Stare pytania o siłę – gdyby przyszły, nie zmieniają niczego.
          s_dom: score(1),
          s_otoczenie: score(1),
          s_dojazd: score(1),
        }),
      )
      assert.ok(z, p.id)
      assert.deepEqual(z.wskazniki, { ...p.wskazniki }, p.id)
      assert.equal((z as unknown as Record<string, unknown>).sily, undefined, p.id)
      const chip = z.zrozumialem.find((x) => x.rodzaj === 'potrzeba')
      assert.equal(chip?.opis, undefined, p.id)
    }
  })

  it('reguły: „byłoby miło” i „koniecznie” nie zmieniają wag – maksimum z tabeli', () => {
    const tabela = (ids: string[]) => {
      const w: Record<string, number> = {}
      for (const p of POTRZEBY.filter((x) => ids.includes(x.id)))
        for (const [id, v] of Object.entries(p.wskazniki)) w[id] = Math.max(w[id] ?? 0, v)
      return w
    }
    for (const tekst of [
      'Mam psa, park byłoby miło',
      'Mam psa, park koniecznie',
      'Mam psa i park',
    ]) {
      const z = zRegul(tekst)
      assert.deepEqual(z.potrzeby, ['pies', 'zielen'], tekst)
      assert.deepEqual(z.wskazniki, tabela(['pies', 'zielen']), tekst)
      assert.equal((z as unknown as Record<string, unknown>).sily, undefined, tekst)
    }
  })

  it('wagi w wyniku: zieleń waży tak samo bez względu na słowa siły', () => {
    const wagi = (tekst: string) => wagiZeZrozumienia(zRegul(tekst), 'kupuje', METAS, BIEZACE).wagi
    assert.deepEqual(wagi('Park byłoby miło'), wagi('Park koniecznie'))
  })
})

describe('potrzeby „na nie” (#182)', () => {
  it('id ze słownika zbioru nr 8, w tej kolejności', () => {
    assert.deepEqual(
      NA_NIE.map((n) => n.id),
      ['zycie_nocne_obok', 'turysci', 'szkola_obok', 'duza_droga', 'przemysl', 'imprezy', 'budowy'],
    )
  })

  it('każda warstwa z tabeli istnieje i liczy się w silniku z kierunkiem „nie chcę”', () => {
    for (const n of NA_NIE)
      for (const [id, { waga, kierunek }] of Object.entries(n.warstwy)) {
        const m = META.get(id)
        assert.ok(m, `${n.id}: brak warstwy ${id}`)
        assert.ok(!m.atrapa, id)
        assert.notEqual(m.kategoria, 'kontekst', id)
        assert.equal(kierunekEfektywny(m, { [id]: kierunek }), kierunek, id)
        assert.ok(waga >= 1 && waga <= 4, id)
      }
  })

  it('dwa „nie chcę” nie chcą przeciwnych kierunków na tej samej warstwie', () => {
    const k: Record<string, string> = {}
    for (const n of NA_NIE)
      for (const [id, { kierunek }] of Object.entries(n.warstwy)) {
        if (k[id]) assert.equal(k[id], kierunek, id)
        k[id] = kierunek
      }
  })

  it('kierunki tabeli: bary mniej, noclegi mniej, szkoła dalej, hałas mniej, zakłady dalej, imprezy mniej, budowy mniej', () => {
    const k = (id: string) =>
      Object.fromEntries(
        Object.entries(NA_NIE.find((n) => n.id === id)?.warstwy ?? {}).map(([w, x]) => [
          w,
          x.kierunek,
        ]),
      )
    assert.equal(k('zycie_nocne_obok').zycie_nocne_300m, 'mniej-lepiej')
    assert.equal(k('zycie_nocne_obok').gastronomia_odleglosc, 'wiecej-lepiej')
    assert.equal(k('turysci').noclegi_lozka_300m, 'mniej-lepiej')
    assert.equal(k('szkola_obok').szkola_odleglosc, 'wiecej-lepiej')
    assert.equal(k('duza_droga').halas_ldwn, 'mniej-lepiej')
    assert.equal(k('przemysl').emitent_odleglosc, 'wiecej-lepiej')
    assert.equal(k('przemysl').seveso_odleglosc, 'wiecej-lepiej')
    assert.equal(k('imprezy').imprezy_obiekty_dni_500m_2025_26, 'mniej-lepiej')
    assert.equal(k('budowy').inwestycje_500m, 'mniej-lepiej')
  })

  it('JEV: noul ≥ progu → „nie chcę”, chip i kierunek w wagach', () => {
    const z = przetworzOdpowiedzi(
      odp({ n_zycie_nocne_obok: noul(0.95), n_budowy: noul(PROG_NA_NIE - 0.01) }),
    )
    assert.ok(z && !nicNieZrozumiano(z))
    assert.deepEqual(z.nieChce, ['zycie_nocne_obok'])
    assert.ok(z.zrozumialem.some((p) => p.rodzaj === 'na_nie' && p.procent === 95))
    const u = wagiZeZrozumienia(z, 'kupuje', METAS, BIEZACE)
    assert.equal(u.kierunki.zycie_nocne_300m, 'mniej-lepiej')
    assert.equal(u.wagi.zycie_nocne_300m, 4)
    assert.equal(u.kierunki.gastronomia_odleglosc, 'wiecej-lepiej')
    assert.equal(u.persona, 'wlasna')
  })

  it('zamknięta bramka: „nie chcę” zostaje tylko bardzo pewne', () => {
    const z = przetworzOdpowiedzi({
      ...odp({ n_turysci: noul(0.95), n_budowy: noul(0.7) }),
      nikt_nie_szuka: noul(0.9),
    })
    assert.deepEqual(z?.nieChce, ['turysci'])
  })

  it('reguły: „nie chcę mieszkać obok szkoły” to szkola_obok, a nie dzieci', () => {
    const z = zRegul('Nie chcę mieszkać obok szkoły, hałas mnie wykańcza')
    assert.deepEqual(z.nieChce, ['szkola_obok'])
    assert.ok(!z.potrzeby.includes('dzieci'))
    assert.ok(z.potrzeby.includes('cisza'))
  })

  it('reguły: odmowy z różnymi słowami; „nie chcę daleko do szkoły” to nie odmowa', () => {
    assert.deepEqual(zRegul('Byle nie przy stadionie').nieChce, ['imprezy'])
    assert.deepEqual(zRegul('Z dala od huty i kominów').nieChce, ['przemysl'])
    assert.deepEqual(zRegul('Mam dość turystów z walizkami').nieChce, ['turysci'])
    assert.deepEqual(zRegul('Żadnych klubów pod oknem').nieChce, ['zycie_nocne_obok'])
    assert.deepEqual(zRegul('Nie chcę ruchliwej ulicy pod oknem').nieChce, ['duza_droga'])
    assert.deepEqual(zRegul('Mam dość budowy za oknem').nieChce, ['budowy'])
    assert.equal(zRegul('Nie chcę mieć daleko do szkoły, mamy dzieci').nieChce, undefined)
    assert.equal(zRegul('Lubię knajpy blisko').nieChce, undefined)
  })
})

describe('reguła sprzecznych kierunków (#182)', () => {
  it('„nie chcę” wygrywa z profilem: Inwestor (budowy więcej = lepiej) + „budowy” → mniej', () => {
    const u = wagiZeZrozumienia(
      zr({ persona: 'inwestor', nieChce: ['budowy'] }),
      'kupuje',
      METAS,
      BIEZACE,
    )
    assert.equal(u.kierunki.inwestycje_500m, 'mniej-lepiej')
    assert.equal(u.wagi.inwestycje_500m, 4)
    assert.equal(u.persona, 'wlasna')
  })

  it('„nie chcę” wygrywa z potrzebą na tak i nie bierze jej przeciwnej wagi', () => {
    // dzieci: plac zabaw blisko (4); szkola_obok: plac zabaw dalej (1).
    const z = przetworzOdpowiedzi(odp({ p_dzieci: noul(0.95), n_szkola_obok: noul(0.9) }))
    const u = wagiZeZrozumienia(z as Zrozumienie, 'kupuje', METAS, BIEZACE)
    assert.equal(u.kierunki.plac_zabaw_odleglosc, 'wiecej-lepiej')
    assert.equal(u.wagi.plac_zabaw_odleglosc, 1) // nie 4 z „dzieci”
    assert.equal(u.kierunki.szkola_odleglosc, 'wiecej-lepiej')
    // Szkoła podstawowa (inna warstwa) zostaje „blisko” z potrzeby dzieci.
    assert.equal(u.kierunki.szkola_podst_odleglosc, undefined)
    assert.equal(u.wagi.szkola_podst_odleglosc, 4)
  })

  it('„nie chcę” bierze zgodną wagę: cisza (hałas 4) + duza_droga (hałas 4, NO2 2)', () => {
    const u = wagiZeZrozumienia(
      zr({ potrzeby: ['cisza'], wskazniki: { halas_ldwn: 4 }, nieChce: ['duza_droga'] }),
      'kupuje',
      METAS,
      BIEZACE,
    )
    assert.equal(u.wagi.halas_ldwn, 4)
    assert.equal(u.wagi.no2_srednia, 2)
    // Ten sam kierunek co w meta – bez jawnego wpisu w kierunkach.
    assert.equal(u.kierunki.halas_ldwn, undefined)
  })

  it('dwie potrzeby na tak z przeciwnymi kierunkami: wygrywa wcześniejsza w tabeli (#187)', () => {
    // Syntetyczna tabela: „cisza” chce mniej barów, „nocne” (jak zycie_nocne z #183) więcej.
    const tabela = [
      {
        id: 'cisza',
        etykieta: 'c',
        wzorce: [],
        kategorie: {},
        wskazniki: {},
        kierunki: { zycie_nocne_300m: 'mniej-lepiej' },
      },
      {
        id: 'nocne',
        etykieta: 'n',
        wzorce: [],
        kategorie: {},
        wskazniki: {},
        kierunki: { zycie_nocne_300m: 'wiecej-lepiej' },
      },
    ] as const satisfies readonly (typeof POTRZEBY)[number][]
    const k = (potrzeby: string[], t: readonly (typeof POTRZEBY)[number][] = tabela) =>
      kierunkiPotrzeb({ potrzeby }, t).naTak.zycie_nocne_300m
    assert.equal(k(['cisza', 'nocne']), 'mniej-lepiej')
    // Kolejność w rozpoznaniu nie ma znaczenia – liczy się kolejność tabeli.
    assert.equal(k(['nocne', 'cisza']), 'mniej-lepiej')
    assert.equal(k(['nocne', 'cisza'], [...tabela].reverse()), 'wiecej-lepiej')
    assert.equal(k(['nocne']), 'wiecej-lepiej')
  })

  it('„nie chcę” wygrywa z potrzebą na tak o przeciwnym kierunku (syntetycznie)', () => {
    const tabela = [
      {
        id: 'nocne',
        etykieta: 'n',
        wzorce: [],
        kategorie: {},
        wskazniki: {},
        kierunki: { zycie_nocne_300m: 'wiecej-lepiej' },
      },
    ] as const satisfies readonly (typeof POTRZEBY)[number][]
    const k = kierunkiPotrzeb({ potrzeby: ['nocne'], nieChce: ['zycie_nocne_obok'] }, tabela)
    assert.equal(k.naTak.zycie_nocne_300m, 'wiecej-lepiej')
    assert.equal(k.naNie.zycie_nocne_300m?.kierunek, 'mniej-lepiej')
    // wagiZeZrozumienia stosuje naNie po naTak – sprawdzone niżej na prawdziwej tabeli.
  })

  it('profil wygrywa z potrzebą na tak (#177 bez zmian), „nie chcę” z profilem', () => {
    const u = wagiZeZrozumienia(
      zr({ persona: 'rodzina', potrzeby: ['pies'], nieChce: ['zycie_nocne_obok'] }),
      'kupuje',
      METAS,
      BIEZACE,
    )
    assert.equal(u.kierunki.inwestycje_500m, 'mniej-lepiej') // z profilu Rodzina
    assert.equal(u.kierunki.zycie_nocne_300m, 'mniej-lepiej')
  })

  it('prawdziwa tabela: „życie nocne” (#183) + „knajpy pod oknem” → bary mniej = lepiej, waga 4', () => {
    const z = przetworzOdpowiedzi(
      odp({ p_zycie_nocne: noul(0.95), n_zycie_nocne_obok: noul(0.9) }),
    ) as Zrozumienie
    assert.ok(z.potrzeby.includes('zycie_nocne'))
    const u = wagiZeZrozumienia(z, 'kupuje', METAS, BIEZACE)
    assert.equal(u.kierunki.zycie_nocne_300m, 'mniej-lepiej')
    assert.equal(u.wagi.zycie_nocne_300m, 4)
    // Bez „nie chcę” ta sama potrzeba chce barów blisko.
    const bez = wagiZeZrozumienia(
      przetworzOdpowiedzi(odp({ p_zycie_nocne: noul(0.95) })) as Zrozumienie,
      'kupuje',
      METAS,
      BIEZACE,
    )
    assert.equal(bez.kierunki.zycie_nocne_300m, 'wiecej-lepiej')
  })

  it('pełne zapytanie: 29 pytań (≤ 32) i przechodzi przez pośrednika', async () => {
    const sciezka = new URL('../../api/_jev.js', import.meta.url).href
    const { LIMITY, sprawdzZapytanie } = (await import(sciezka)) as {
      LIMITY: { pytan: number; pytaniaZnakow: number }
      sprawdzZapytanie: (c: unknown) => { blad?: string; pytania: object }
    }
    const z = zapytanieOpiszSiebie('Nie chcę knajp pod oknem, park bardzo ważny')
    assert.ok(Object.keys(z.pytania).length <= LIMITY.pytan)
    assert.equal(Object.keys(z.pytania).length, 29)
    const api = sprawdzZapytanie(z)
    assert.equal(api.blad, undefined)
    assert.ok(JSON.stringify(api.pytania).length < LIMITY.pytaniaZnakow)
  })
})
