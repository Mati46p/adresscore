// Uruchom: node --test src/ai/
// #182: siła potrzeby (1–3) i potrzeby „na nie” w „opisz siebie” – bez sieci (JEV atrapą).
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import type { PlikWskaznika, WskaznikMeta } from '../kontrakty/index.ts'
import { kierunekEfektywny } from '../wynik/silnik.ts'
import type { OdpowiedzJev } from './jev.ts'
import {
  GRUPY_SILY,
  kierunkiPotrzeb,
  NA_NIE,
  nicNieZrozumiano,
  OPISY_SILY,
  POTRZEBY,
  PROG_NA_NIE,
  przetworzOdpowiedzi,
  SKALA_SILY,
  silaZRegul,
  wagaZSily,
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

describe('siła potrzeby (#182)', () => {
  it('wagaZSily: 3 = tabela, 2 = −1, 1 = −2, najmniej 1; brak siły = tabela', () => {
    assert.deepEqual(
      [4, 3, 2, 1].map((w) => [3, 2, 1].map((s) => wagaZSily(w, s as 1 | 2 | 3))),
      [
        [4, 3, 2],
        [3, 2, 1],
        [2, 1, 1],
        [1, 1, 1],
      ],
    )
    assert.equal(wagaZSily(4, undefined), 4)
  })

  it('siła z oceny grupy: dzieci 3, zieleń 1; minimalne wagi skalowane', () => {
    const z = przetworzOdpowiedzi(
      odp({ p_dzieci: noul(0.98), p_zielen: noul(0.7), s_dom: score(2.6), s_otoczenie: score(1) }),
    )
    assert.ok(z)
    assert.deepEqual(z.sily, { dzieci: 3, zielen: 1 })
    assert.equal(z.wskazniki.przedszkole_odleglosc, 4) // dzieci, tabela 4, siła 3
    assert.equal(z.wskazniki.zielen_worldcover_100m, 2) // zieleń, tabela 4, siła 1
    assert.equal(z.wskazniki.przyroda_chroniona_odleglosc, 1) // tabela 2, siła 1 → min. 1
    const chip = z.zrozumialem.find((p) => p.etykieta === 'zieleń')
    assert.equal(chip?.opis, OPISY_SILY[1])
  })

  it('ocena grupy 0 („nie mówi”) albo brak odpowiedzi = brak siły (waga z tabeli)', () => {
    const z = przetworzOdpowiedzi(odp({ p_pies: noul(0.95), s_dom: score(0.2) }))
    assert.equal(z?.sily, undefined)
    assert.equal(z?.wskazniki.wybieg_psy_odleglosc, 3)
  })

  it('siła 3 daje w wynikowych wagach więcej niż siła 1 (ta sama potrzeba, ten sam profil)', () => {
    const wagi = (s: 1 | 3) =>
      wagiZeZrozumienia(
        przetworzOdpowiedzi(odp({ p_zielen: noul(0.95), s_otoczenie: score(s) })) as Zrozumienie,
        'kupuje',
        METAS,
        BIEZACE,
      ).wagi
    assert.ok((wagi(3).zielen_udzial ?? 0) > (wagi(1).zielen_udzial ?? 0))
  })

  it('każda potrzeba w GRUPY_SILY istnieje i jest w jednej grupie; skala 0–3', () => {
    const ids = GRUPY_SILY.flatMap((g) => g.potrzeby)
    assert.equal(new Set(ids).size, ids.length)
    for (const id of ids)
      assert.ok(
        POTRZEBY.some((p) => p.id === id),
        id,
      )
    assert.equal(SKALA_SILY.length, 4)
  })

  it('reguły: „koniecznie” = 3, „byłoby miło” = 1, bez słów siły = brak', () => {
    assert.equal(silaZRegul('Park koniecznie blisko'), 3)
    assert.equal(silaZRegul('Byłoby miło mieć park'), 1)
    assert.equal(silaZRegul('Mam psa'), undefined)
    assert.deepEqual(zRegul('Mam psa, park byłoby miło').sily, { pies: 1, zielen: 1 })
    assert.equal(zRegul('Mam psa').sily, undefined)
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

  it('dwie potrzeby na tak z przeciwnymi kierunkami: silniejsza wygrywa, remis = wcześniejsza', () => {
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
    const k = (sily: Record<string, 1 | 2 | 3>) =>
      kierunkiPotrzeb({ potrzeby: ['cisza', 'nocne'], sily }, tabela).naTak.zycie_nocne_300m
    assert.equal(k({ cisza: 1, nocne: 3 }), 'wiecej-lepiej')
    assert.equal(k({ cisza: 3, nocne: 2 }), 'mniej-lepiej')
    assert.equal(k({ cisza: 2, nocne: 2 }), 'mniej-lepiej') // remis: wcześniejsza w tabeli
    assert.equal(k({}), 'mniej-lepiej') // brak siły = 3 dla obu, remis
    assert.equal(k({ cisza: 2 }), 'wiecej-lepiej') // brak siły „nocne” = 3 > 2
  })

  it('„nie chcę” wygrywa z silną potrzebą na tak o przeciwnym kierunku (syntetycznie)', () => {
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
    const k = kierunkiPotrzeb(
      { potrzeby: ['nocne'], sily: { nocne: 3 }, nieChce: ['zycie_nocne_obok'] },
      tabela,
    )
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

  it('pełne zapytanie: ≤ 32 pytań i przechodzi przez pośrednika', async () => {
    const sciezka = new URL('../../api/_jev.js', import.meta.url).href
    const { LIMITY, sprawdzZapytanie } = (await import(sciezka)) as {
      LIMITY: { pytan: number; pytaniaZnakow: number }
      sprawdzZapytanie: (c: unknown) => { blad?: string; pytania: object }
    }
    const z = zapytanieOpiszSiebie('Nie chcę knajp pod oknem, park bardzo ważny')
    assert.ok(Object.keys(z.pytania).length <= LIMITY.pytan)
    const api = sprawdzZapytanie(z)
    assert.equal(api.blad, undefined)
    assert.ok(JSON.stringify(api.pytania).length < LIMITY.pytaniaZnakow)
  })
})
