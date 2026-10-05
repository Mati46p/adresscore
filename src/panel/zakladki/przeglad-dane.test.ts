// Układ danych zakładki „Przegląd” (T055). Oczekiwania policzone ręcznie, a zestaw „T” jest lustrem
// świata T z testu bazy (supabase/tests/analityka_panel.test.sql, teraz = 2026-10-26 13:30:00Z), więc
// kafle, wykresy i roboty są sprawdzane na tych samych liczbach, które baza zwraca w tym teście.
// Pilnowane: brak danych to null (nie 0), doba i godzina zmiany czasu nie gubią punktów, zmiana
// tylko między pełnymi dobami, podstawą udziału ludzie/boty jest SUMA (CLAUDE.md „Liczby na ekranie”).
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { formatLiczby, udzialy } from '../arytmetyka.ts'
import { dzienWarszawy, godzinaWarszawy } from '../czas.ts'
import { KLUCZE_HASEL } from '../slownik.ts'
import type {
  PrzegladRuchu,
  WierszBotaAi,
  WierszSeriiDziennej,
  WierszSeriiGodzinowej,
} from '../typy.ts'
import { WIDOKI } from '../widoki.ts'
import {
  DNI_WYKRESU,
  GODZIN_WYKRESU,
  type KafleRuchu,
  kafleRuchu,
  MIN_ODNIESIENIA_ZMIANY,
  opisPokrycia,
  opisZmiany,
  type PunktDniaRuchu,
  pomiarZSerii,
  punktyGodzinowe,
  segmentyLudzieBoty,
  uwagaPierwszejDoby,
  uzupelnijSerieDzienna,
  wierszeCrawlerowAi,
  wierszePozostalychRobotow,
  type ZmianaDobowa,
  zmianaWobecPoprzedniejDoby,
} from './przeglad-dane.ts'

/** Pauza (U+2014) z kodu znaku: literał w źródle zostałby znormalizowany przez formatter. */
const PAUZA = String.fromCharCode(0x2014)

// ── Świat T: odpowiedzi bazy na znanym zestawie zdarzeń ───────────────────────────────────

/**
 * `admin_przeglad` dla teraz = 2026-10-26 13:30:00Z (14:30 w Warszawie). Wartości z komentarzy testu SQL:
 *  - unikalni dziś 9, wczoraj 7 (doba 25.10 trwała 25 godzin), 7 dób = 1 + 0 + 0 + 1 + 5 + 7 + 9 = 23,
 *    średnia 23 / 7 = 3,2857 (dzielnik stały),
 *  - odsłony: 24 h = 5 + 10 = 15, 7 dób = 1 + 1 + 8 + 11 + 10 = 31, 30 dób = 31 + 13 + 1 = 45,
 *  - szczyt godzinowy 19.10 10:00Z (12:00 w Warszawie) = 8, szczyt dobowy 19.10 = 13,
 *  - teraz na stronie 4, ludzie 24 h = 15 (= odsłony 24 h), boty 24 h = 2 + 2 + 2 + 1 = 7.
 */
const PRZEGLAD_T: PrzegladRuchu = {
  unikalni_dzis: 9,
  unikalni_wczoraj: 7,
  unikalni_7d: 23,
  unikalni_srednia_7d: 3.2857,
  odslony_24h: 15,
  odslony_7d: 31,
  odslony_30d: 45,
  szczyt_godzina: { godzina: '2026-10-19T10:00:00Z', odslony: 8 },
  szczyt_dzien: { dzien: '2026-10-19', odslony: 13 },
  teraz_5min: 4,
  ludzie_24h: 15,
  boty_24h: 7,
}

/**
 * `admin_seria_dzienna(30)` dla świata T: tylko doby z wierszem. 27.09 (pierwsza chwila okna),
 * 19.10 (13 odsłon, 6 osób, bot gptbot), 20.10 (1 odsłona, 2 odsłony perplexitybota), 22.10 i 24.10 z
 * zestawienia dziennego (5/0/0 oraz 100/50/7, celowo inne niż surowe), 23.10, 25.10 (11/7/2) i dziś
 * 26.10 (10/9/6, na żywo). Doby 28.09–18.10 oraz 21.10 nie mają wiersza.
 */
const SERIA_T: WierszSeriiDziennej[] = [
  { dzien: '2026-09-27', odslony: 1, unikalni: 1, odslony_boty: 0 },
  { dzien: '2026-10-19', odslony: 13, unikalni: 6, odslony_boty: 1 },
  { dzien: '2026-10-20', odslony: 1, unikalni: 1, odslony_boty: 2 },
  { dzien: '2026-10-22', odslony: 5, unikalni: 0, odslony_boty: 0 },
  { dzien: '2026-10-23', odslony: 1, unikalni: 1, odslony_boty: 0 },
  { dzien: '2026-10-24', odslony: 100, unikalni: 50, odslony_boty: 7 },
  { dzien: '2026-10-25', odslony: 11, unikalni: 7, odslony_boty: 2 },
  { dzien: '2026-10-26', odslony: 10, unikalni: 9, odslony_boty: 6 },
]

/**
 * Godziny, w których coś się działo (klucz `RRRR-MM-DDTHH`, UTC): [odsłony ludzi, unikalni, odsłony
 * botów]. Reszta z 48 godzin to zera. Sumy: odsłony ludzi 3 + 11 + 9 = 23, boty 8 (jak w teście SQL:
 * „23/8”). Godziny 25.10 00:00Z i 01:00Z to dwie godziny „02:00–03:00” doby zmiany czasu.
 */
const GODZINY_T: Readonly<Record<string, readonly [number, number, number]>> = {
  '2026-10-24T15': [1, 1, 0],
  '2026-10-24T21': [1, 1, 0],
  '2026-10-24T22': [1, 1, 0],
  '2026-10-25T00': [1, 1, 0],
  '2026-10-25T01': [1, 1, 0],
  '2026-10-25T06': [2, 1, 0],
  '2026-10-25T08': [0, 0, 1],
  '2026-10-25T12': [1, 1, 0],
  '2026-10-25T14': [4, 1, 0],
  '2026-10-25T20': [0, 0, 1],
  '2026-10-25T22': [1, 1, 0],
  '2026-10-25T23': [1, 1, 0],
  '2026-10-26T02': [0, 0, 1],
  '2026-10-26T03': [0, 0, 2],
  '2026-10-26T05': [0, 0, 2],
  '2026-10-26T07': [2, 1, 0],
  '2026-10-26T09': [1, 1, 0],
  '2026-10-26T10': [1, 1, 0],
  '2026-10-26T11': [1, 0, 0],
  '2026-10-26T13': [4, 6, 1],
}

/** `ile` kolejnych godzin od `start` (ISO UTC), tak jak buduje je `generate_series` w czasie bezwzględnym. */
function seriaGodzin(
  start: string,
  ile: number,
  wartosci: Readonly<Record<string, readonly [number, number, number]>> = {},
): WierszSeriiGodzinowej[] {
  const t0 = Date.parse(start)
  return Array.from({ length: ile }, (_, i) => {
    const godzina = new Date(t0 + i * 3_600_000).toISOString()
    const [odslony, unikalni, odslonyBoty] = wartosci[godzina.slice(0, 13)] ?? [0, 0, 0]
    return { godzina, odslony, unikalni, odslony_boty: odslonyBoty }
  })
}

/** `admin_boty_ai(30)` dla świata T (kolejność z bazy: klasa `ai` na górze). */
const BOTY_T: WierszBotaAi[] = [
  { rodzina: 'gptbot', klasa: 'ai', odslony: 3, ostatnio: '2026-10-26T13:28:00Z' },
  { rodzina: 'claudebot', klasa: 'ai', odslony: 2, ostatnio: '2026-10-26T05:00:00Z' },
  { rodzina: 'perplexitybot', klasa: 'ai', odslony: 2, ostatnio: '2026-10-20T08:01:00Z' },
  { rodzina: 'googlebot', klasa: 'wyszukiwarka', odslony: 2, ostatnio: '2026-10-26T03:01:00Z' },
  { rodzina: '(nieznana)', klasa: 'inny', odslony: 1, ostatnio: '2026-10-26T02:00:00Z' },
  { rodzina: 'curl', klasa: 'narzedzie', odslony: 1, ostatnio: '2026-10-25T08:00:00Z' },
]

const DZIS_T = '2026-10-26'

/** Zmiana, która musi istnieć (asercja zamiast rzutowania). */
function wymagana(zmiana: ZmianaDobowa | null): ZmianaDobowa {
  assert.ok(zmiana, 'oczekiwano zmiany')
  return zmiana
}

const wartosci = (kafle: KafleRuchu) =>
  [...kafle.ludzie, ...kafle.odslony].map((k) => [k.etykieta, k.wartosc] as const)

/** Liczba jako samodzielny token („7” nie pasuje do „17” ani „7,5”). */
function zawieraLiczbe(tekst: string, liczba: string): boolean {
  const wzor = liczba.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?<![\\d,.])${wzor}(?![\\d,])`).test(tekst)
}

/** Generator mulberry32: to samo ziarno daje ten sam ciąg, niezależnie od silnika JS. */
function generator(ziarno: number): () => number {
  let stan = ziarno >>> 0
  return () => {
    stan = (stan + 0x6d2b79f5) >>> 0
    let t = stan
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ── Okna zapytań ──────────────────────────────────────────────────────────────────────────

describe('okna zakładki to te same liczby, które idą do bazy', () => {
  it('stałe okien równają się domyślnym parametrom widoków z rejestru (jedno źródło prawdy)', () => {
    assert.equal(WIDOKI.seria_dzienna.domyslne.p_dni, DNI_WYKRESU)
    assert.equal(WIDOKI.boty_ai.domyslne.p_dni, DNI_WYKRESU)
    assert.equal(WIDOKI.seria_godzinowa.domyslne.p_godzin, GODZIN_WYKRESU)
    assert.equal(DNI_WYKRESU, 30)
    assert.equal(GODZIN_WYKRESU, 48)
  })

  it('klucze słownika użyte w kaflach istnieją (literówka nie zniknie jako brak podpowiedzi)', () => {
    const kafle = kafleRuchu({
      przeglad: PRZEGLAD_T,
      pomiar: pomiarZSerii(SERIA_T),
      dzis: DZIS_T,
      zmianaWczoraj: null,
    })
    for (const k of [...kafle.ludzie, ...kafle.odslony]) {
      assert.ok(KLUCZE_HASEL.includes(k.klucz), `brak hasła ${k.klucz}`)
    }
  })
})

// ── Początek pomiaru ──────────────────────────────────────────────────────────────────────

describe('pomiarZSerii: co wiemy o pomiarze z serii dziennej', () => {
  it('seria niedostępna (null) to „nieznany”: niczego nie wnioskujemy', () => {
    assert.deepEqual(pomiarZSerii(null), { rodzaj: 'nieznany' })
    assert.deepEqual(pomiarZSerii(undefined), { rodzaj: 'nieznany' })
  })

  it('seria pobrana, ale bez wiersza, to „pusty”: w oknie nie zapisano żadnego zdarzenia', () => {
    assert.deepEqual(pomiarZSerii([]), { rodzaj: 'pusty' })
  })

  it('pierwsza doba z wierszem wyznacza początek danych, także gdy wiersze przyszły nieposortowane', () => {
    const wiersze = [...SERIA_T].reverse()
    assert.deepEqual(pomiarZSerii(wiersze), { rodzaj: 'od', pierwszyDzien: '2026-09-27' })
  })

  it('same nieczytelne wiersze to nie dowód ciszy: „nieznany”, a nie „pusty”', () => {
    const smieci = [{ dzien: 'nie data' }, { dzien: '2026-02-30' }, null, {}] as never
    assert.deepEqual(pomiarZSerii(smieci), { rodzaj: 'nieznany' })
  })
})

// ── Seria dzienna ─────────────────────────────────────────────────────────────────────────

describe('uzupelnijSerieDzienna: doby bez wiersza', () => {
  const seria = uzupelnijSerieDzienna(SERIA_T, 30, DZIS_T)
  const wDniu = (dzien: string) => seria.find((p) => p.dzien === dzien)

  it('30 kolejnych dób warszawskich kończących się dziś, rosnąco, bez luk i dubli', () => {
    assert.equal(seria.length, 30)
    assert.equal(seria[0]?.dzien, '2026-09-27')
    assert.equal(seria[29]?.dzien, '2026-10-26')
    assert.equal(new Set(seria.map((p) => p.dzien)).size, 30)
    // Doba zmiany czasu 25.10 (25 godzin) jest jedną dobą w serii dziennej.
    const indeks = seria.findIndex((p) => p.dzien === '2026-10-25')
    assert.deepEqual(
      seria.slice(indeks - 1, indeks + 2).map((p) => p.dzien),
      ['2026-10-24', '2026-10-25', '2026-10-26'],
    )
  })

  it('doba z wierszem dostaje liczby z bazy (nic nie jest przeliczane ani zaokrąglane)', () => {
    assert.deepEqual(wDniu('2026-10-24'), {
      dzien: '2026-10-24',
      odslony: 100,
      unikalni: 50,
      boty: 7,
    })
    assert.deepEqual(wDniu('2026-10-26'), {
      dzien: '2026-10-26',
      odslony: 10,
      unikalni: 9,
      boty: 6,
    })
    assert.deepEqual(wDniu('2026-10-19'), {
      dzien: '2026-10-19',
      odslony: 13,
      unikalni: 6,
      boty: 1,
    })
  })

  it('doba bez wiersza PO początku pomiaru to prawdziwe zero (pomiar działał, nikt nie przyszedł)', () => {
    // 27.09 to pierwsza doba z danymi, więc 28.09 i 21.10 (bez wiersza) są zerami, nie przerwą.
    assert.deepEqual(wDniu('2026-09-28'), { dzien: '2026-09-28', odslony: 0, unikalni: 0, boty: 0 })
    assert.deepEqual(wDniu('2026-10-21'), { dzien: '2026-10-21', odslony: 0, unikalni: 0, boty: 0 })
  })

  it('suma odsłon z serii zgadza się z sumą wierszy: 1 + 13 + 1 + 5 + 1 + 100 + 11 + 10 = 142', () => {
    assert.equal(
      seria.reduce((s, p) => s + (p.odslony ?? 0), 0),
      142,
    )
    assert.equal(
      seria.reduce((s, p) => s + (p.boty ?? 0), 0),
      18, // 0 + 1 + 2 + 0 + 0 + 7 + 2 + 6
    )
  })

  it('okno 6 dób jak w teście SQL: doba PRZED pierwszym wierszem (21.10) to przerwa, nie zero', () => {
    // Test bazy dla 6 dób zwraca 22–26.10 i brak wiersza dla 21.10 („brak zestawienia i brak zdarzeń”).
    const wiersze = SERIA_T.filter((w) => w.dzien >= '2026-10-22')
    const krotka = uzupelnijSerieDzienna(wiersze, 6, DZIS_T)
    assert.deepEqual(
      krotka.map((p) => p.dzien),
      ['2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25', '2026-10-26'],
    )
    assert.deepEqual(krotka[0], { dzien: '2026-10-21', odslony: null, unikalni: null, boty: null })
    assert.deepEqual(krotka[1], { dzien: '2026-10-22', odslony: 5, unikalni: 0, boty: 0 })
  })

  it('pusta odpowiedź: same przerwy (null), nigdy zera udające pomiar', () => {
    const pusta = uzupelnijSerieDzienna([], 30, DZIS_T)
    assert.equal(pusta.length, 30)
    assert.ok(pusta.every((p) => p.odslony === null && p.unikalni === null && p.boty === null))
  })

  it('jeden dzień danych (pierwszy dzień serwisu): 29 przerw i jedna doba z liczbami', () => {
    const jedna = uzupelnijSerieDzienna(
      [{ dzien: DZIS_T, odslony: 12, unikalni: 5, odslony_boty: 0 }],
      30,
      DZIS_T,
    )
    assert.equal(jedna.filter((p) => p.odslony === null).length, 29)
    assert.deepEqual(jedna[29], { dzien: DZIS_T, odslony: 12, unikalni: 5, boty: 0 })
    // Zero w wierszu to faktyczne zero (np. dzień tylko z botami), nie brak danych.
    const tylkoBoty = uzupelnijSerieDzienna(
      [{ dzien: DZIS_T, odslony: 0, unikalni: 0, odslony_boty: 4 }],
      3,
      DZIS_T,
    )
    assert.deepEqual(tylkoBoty[2], { dzien: DZIS_T, odslony: 0, unikalni: 0, boty: 4 })
  })

  it('doba bez wiersza na końcu (dziś, nikt jeszcze nie wszedł) po początku pomiaru to zero', () => {
    const wczoraj = uzupelnijSerieDzienna(
      [{ dzien: '2026-10-25', odslony: 3, unikalni: 2, odslony_boty: 0 }],
      3,
      DZIS_T,
    )
    assert.deepEqual(wczoraj[2], { dzien: DZIS_T, odslony: 0, unikalni: 0, boty: 0 })
  })

  it('zegar admina spóźniony o dobę: seria kończy się na ostatniej dobie z bazy', () => {
    const spozniony = uzupelnijSerieDzienna(SERIA_T, 30, '2026-10-25')
    assert.equal(spozniony.length, 30)
    assert.equal(spozniony[29]?.dzien, '2026-10-26')
    assert.deepEqual(spozniony[29], { dzien: DZIS_T, odslony: 10, unikalni: 9, boty: 6 })
  })

  it('wiersze śmieciowe: niepoprawne doby pomijane, niepoprawne liczby to null (nie 0), duplikat doby: ostatni wygrywa', () => {
    const wiersze = [
      { dzien: '2026-10-25', odslony: Number.NaN, unikalni: -4, odslony_boty: null },
      { dzien: '2026-10-26', odslony: 1, unikalni: 1, odslony_boty: 1 },
      { dzien: '2026-10-26', odslony: 7, unikalni: 3, odslony_boty: 2 },
      { dzien: '2026-02-30', odslony: 99, unikalni: 99, odslony_boty: 99 },
      { dzien: 'wczoraj', odslony: 99, unikalni: 99, odslony_boty: 99 },
      null,
    ] as never
    const wynik = uzupelnijSerieDzienna(wiersze, 2, DZIS_T)
    assert.deepEqual(wynik, [
      { dzien: '2026-10-25', odslony: null, unikalni: null, boty: null },
      { dzien: DZIS_T, odslony: 7, unikalni: 3, boty: 2 },
    ])
  })

  it('nieczytelne „dziś” nie wywala: seria kończy się na ostatniej dobie z danych albo jest pusta', () => {
    assert.equal(uzupelnijSerieDzienna(SERIA_T, 5, '')[4]?.dzien, DZIS_T)
    assert.deepEqual(uzupelnijSerieDzienna([], 5, ''), [])
  })
})

// ── Seria godzinowa ───────────────────────────────────────────────────────────────────────

describe('punktyGodzinowe: godziny z bazy, także w dobie zmiany czasu', () => {
  const wiersze = seriaGodzin('2026-10-24T14:00:00Z', GODZIN_WYKRESU, GODZINY_T)
  const pomiar = pomiarZSerii(SERIA_T)
  const punkty = punktyGodzinowe(wiersze, pomiar)
  const wDniuWarszawy = (dzien: string) => punkty.filter((p) => dzienWarszawy(p.godzina) === dzien)

  it('fixture to 48 godzin od 24.10 14:00Z do 26.10 13:00Z, tak jak w teście SQL', () => {
    assert.equal(wiersze.length, 48)
    assert.equal(wiersze[0]?.godzina, '2026-10-24T14:00:00.000Z')
    assert.equal(wiersze[47]?.godzina, '2026-10-26T13:00:00.000Z')
  })

  it('wszystkie 48 punktów, rosnąco, z unikalnym kluczem; nic nie zgubione ani zdublowane', () => {
    assert.equal(punkty.length, 48)
    assert.equal(new Set(punkty.map((p) => p.godzina)).size, 48)
    const czasy = punkty.map((p) => Date.parse(p.godzina))
    assert.deepEqual(
      czasy,
      [...czasy].sort((a, b) => a - b),
    )
    // Każdy krok to dokładnie godzina (ciągłość w czasie bezwzględnym, także przez zmianę czasu).
    for (let i = 1; i < czasy.length; i++) {
      assert.equal((czasy[i] ?? 0) - (czasy[i - 1] ?? 0), 3_600_000)
    }
  })

  it('sumy z 48 godzin: odsłony ludzi 23, odsłony botów 8 (jak „23/8” w teście SQL)', () => {
    assert.equal(
      punkty.reduce((s, p) => s + (p.odslony ?? 0), 0),
      23,
    )
    assert.equal(
      punkty.reduce((s, p) => s + (p.boty ?? 0), 0),
      8,
    )
  })

  it('doba zmiany czasu 25.10 ma 25 godzin; dwa „02:00” to dwa osobne punkty', () => {
    // 24.10: godziny 14:00Z–21:00Z (16:00–23:00 CEST) = 8; 25.10: 25; 26.10: od 00:00 CET do 14:00 CET = 15.
    assert.equal(wDniuWarszawy('2026-10-24').length, 8)
    assert.equal(wDniuWarszawy('2026-10-25').length, 25)
    assert.equal(wDniuWarszawy('2026-10-26').length, 15)
    const godziny25 = wDniuWarszawy('2026-10-25').map((p) => godzinaWarszawy(p.godzina))
    assert.deepEqual(
      godziny25,
      [0, 1, 2, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23],
    )
    const dwie = ['2026-10-25T00:00:00.000Z', '2026-10-25T01:00:00.000Z'].map((iso) =>
      punkty.find((p) => p.godzina === iso),
    )
    assert.deepEqual(
      dwie.map((p) => [p?.godzina, godzinaWarszawy(p?.godzina ?? ''), p?.odslony]),
      [
        ['2026-10-25T00:00:00.000Z', 2, 1],
        ['2026-10-25T01:00:00.000Z', 2, 1],
      ],
    )
  })

  it('godziny z bazy: bez ruchu 0, odsłona bez odcisku nie jest unikalna, boty osobno', () => {
    const wg = (iso: string) => punkty.find((p) => p.godzina === iso)
    assert.deepEqual(wg('2026-10-26T13:00:00.000Z'), {
      godzina: '2026-10-26T13:00:00.000Z',
      odslony: 4,
      unikalni: 6,
      boty: 1,
    })
    assert.deepEqual(wg('2026-10-26T11:00:00.000Z'), {
      godzina: '2026-10-26T11:00:00.000Z',
      odslony: 1,
      unikalni: 0,
      boty: 0,
    })
    assert.deepEqual(wg('2026-10-26T05:00:00.000Z'), {
      godzina: '2026-10-26T05:00:00.000Z',
      odslony: 0,
      unikalni: 0,
      boty: 2,
    })
    // Cisza po początku pomiaru to prawdziwe zero.
    assert.deepEqual(wg('2026-10-25T03:00:00.000Z'), {
      godzina: '2026-10-25T03:00:00.000Z',
      odslony: 0,
      unikalni: 0,
      boty: 0,
    })
  })

  it('doba 23-godzinna (29.03.2026, wiosenna zmiana czasu) nie dokłada nieistniejącej godziny 02:00', () => {
    // 28.03 22:00Z = 23:00 CET; doba 29.03 trwa od 28.03 23:00Z do 29.03 22:00Z (wyłącznie) = 23 godziny.
    const wiosna = punktyGodzinowe(seriaGodzin('2026-03-28T22:00:00Z', 26), { rodzaj: 'nieznany' })
    const doba = wiosna.filter((p) => dzienWarszawy(p.godzina) === '2026-03-29')
    assert.equal(doba.length, 23)
    assert.deepEqual(
      doba.map((p) => godzinaWarszawy(p.godzina)),
      [0, 1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23],
    )
  })

  it('wejście nieposortowane i ta sama chwila w dwóch zapisach: jedna pozycja, ostatni zapis wygrywa', () => {
    const wynik = punktyGodzinowe(
      [
        { godzina: '2026-10-26T13:00:00+00:00', odslony: 9, unikalni: 9, odslony_boty: 9 },
        { godzina: '2026-10-26T12:00:00Z', odslony: 2, unikalni: 1, odslony_boty: 0 },
        { godzina: '2026-10-26T13:00:00Z', odslony: 4, unikalni: 3, odslony_boty: 1 },
      ],
      { rodzaj: 'nieznany' },
    )
    assert.deepEqual(wynik, [
      { godzina: '2026-10-26T12:00:00.000Z', odslony: 2, unikalni: 1, boty: 0 },
      { godzina: '2026-10-26T13:00:00.000Z', odslony: 4, unikalni: 3, boty: 1 },
    ])
  })

  it('wiersze śmieciowe: niepoprawna godzina pomijana, niepoprawna liczba to null (nie 0)', () => {
    const wynik = punktyGodzinowe(
      [
        { godzina: 'dziś rano', odslony: 5, unikalni: 5, odslony_boty: 5 },
        { godzina: '2026-10-26T13:00:00Z', odslony: Number.NaN, unikalni: -1, odslony_boty: 2 },
        null,
      ] as never,
      { rodzaj: 'nieznany' },
    )
    assert.deepEqual(wynik, [
      { godzina: '2026-10-26T13:00:00.000Z', odslony: null, unikalni: null, boty: 2 },
    ])
  })

  it('pusta odpowiedź to pusta lista (wykres pokaże pustą oś z napisem)', () => {
    assert.deepEqual(punktyGodzinowe([], { rodzaj: 'nieznany' }), [])
  })

  it('godziny sprzed pierwszej doby danych: zera to null, liczby dodatnie zostają', () => {
    // Pomiar zaczął się 26.10: zerowe godziny z 24–25.10 to brak pomiaru, ale ruch, który tam jednak
    // jest (dowód danych), nie znika.
    const odDzis = punktyGodzinowe(wiersze, { rodzaj: 'od', pierwszyDzien: DZIS_T })
    const wg = (iso: string) => odDzis.find((p) => p.godzina === iso)
    assert.deepEqual(wg('2026-10-25T03:00:00.000Z'), {
      godzina: '2026-10-25T03:00:00.000Z',
      odslony: null,
      unikalni: null,
      boty: null,
    })
    assert.equal(wg('2026-10-25T06:00:00.000Z')?.odslony, 2)
    assert.equal(wg('2026-10-25T08:00:00.000Z')?.boty, 1)
    // Godziny od początku doby 26.10 (czas warszawski: 25.10 23:00Z) są prawdziwymi zerami.
    assert.equal(wg('2026-10-26T01:00:00.000Z')?.odslony, 0)
    assert.equal(wg('2026-10-25T23:00:00.000Z')?.odslony, 1)
  })

  it('pusty pomiar (nic w 30 dobach): wszystkie zera to null, więc wykres jest pusty', () => {
    const pusty = punktyGodzinowe(seriaGodzin('2026-10-25T14:00:00Z', 24), { rodzaj: 'pusty' })
    assert.equal(pusty.length, 24)
    assert.ok(pusty.every((p) => p.odslony === null && p.unikalni === null && p.boty === null))
  })

  it('pomiar nieznany (seria dzienna jeszcze nie dotarła): zera zostają zerami', () => {
    const nieznany = punktyGodzinowe(seriaGodzin('2026-10-25T14:00:00Z', 2), { rodzaj: 'nieznany' })
    assert.deepEqual(
      nieznany.map((p) => p.odslony),
      [0, 0],
    )
  })
})

describe('uwagaPierwszejDoby: jedna doba z danymi nie tworzy linii', () => {
  it('dane tylko z jednej doby (pierwszy dzień pomiaru) → zdanie, że to nie awaria', () => {
    const seria = uzupelnijSerieDzienna(
      [{ dzien: DZIS_T, odslony: 5, unikalni: 3, odslony_boty: 0 }],
      30,
      DZIS_T,
    )
    assert.equal(
      uwagaPierwszejDoby(seria),
      'Dane są dopiero z jednej doby, więc wykres pokazuje pojedyncze punkty zamiast linii: najedź lub dotknij punkt, żeby zobaczyć wartości.',
    )
  })

  it('od drugiej doby (także zerowej) linia już jest, więc zdania nie ma', () => {
    const dwie = uzupelnijSerieDzienna(
      [{ dzien: '2026-10-25', odslony: 2, unikalni: 1, odslony_boty: 0 }],
      30,
      DZIS_T,
    ) // 25.10 z danymi i dzisiejsza doba bez wiersza = 0 po początku pomiaru
    assert.equal(uwagaPierwszejDoby(dwie), null)
    assert.equal(uwagaPierwszejDoby(uzupelnijSerieDzienna(SERIA_T, 30, DZIS_T)), null)
  })

  it('pusta seria (wykres sam pisze „brak danych”) i seria niedostępna → bez zdania', () => {
    assert.equal(uwagaPierwszejDoby(uzupelnijSerieDzienna([], 30, DZIS_T)), null)
    assert.equal(uwagaPierwszejDoby(null), null)
    assert.equal(uwagaPierwszejDoby([]), null)
  })

  it('doba z samymi botami też jest danymi (zero ludzi to wynik, nie przerwa)', () => {
    const seria = uzupelnijSerieDzienna(
      [{ dzien: DZIS_T, odslony: 0, unikalni: 0, odslony_boty: 4 }],
      5,
      DZIS_T,
    )
    assert.notEqual(uwagaPierwszejDoby(seria), null)
  })
})

// ── Zmiana wobec poprzedniej doby ─────────────────────────────────────────────────────────

describe('zmianaWobecPoprzedniejDoby: wczoraj wobec przedwczoraj, nigdy dziś', () => {
  const punkt = (dzien: string, unikalni: number | null): PunktDniaRuchu => ({
    dzien,
    odslony: unikalni,
    unikalni,
    boty: 0,
  })

  it('świat T: wczoraj 7, przedwczoraj 50 → różnica −43, spadek o 86,0% (przez zmianaProcentowa)', () => {
    // (7 − 50) / 50 × 100 = −86. Odniesienie 50 ≥ progu, więc procent jest podany.
    const zmiana = zmianaWobecPoprzedniejDoby(uzupelnijSerieDzienna(SERIA_T, 30, DZIS_T))
    assert.deepEqual(zmiana, { teraz: 7, wtedy: 50, roznica: -43, procent: -86 })
    assert.equal(opisZmiany(wymagana(zmiana)), 'spadek o 86,0% wobec przedwczoraj')
  })

  it('wzrost: 150 wobec 100 → +50,0%; liczy się z dwóch zamkniętych dób, a dziś jest pomijane', () => {
    const seria = [
      punkt('2026-10-24', 100),
      punkt('2026-10-25', 150),
      punkt('2026-10-26', 1), // dzisiejsza doba, niepełna: nie wolno jej porównywać
    ]
    const zmiana = zmianaWobecPoprzedniejDoby(seria)
    assert.deepEqual(zmiana, { teraz: 150, wtedy: 100, roznica: 50, procent: 50 })
    assert.equal(opisZmiany(wymagana(zmiana)), 'wzrost o 50,0% wobec przedwczoraj')
  })

  it(`próg odniesienia ${MIN_ODNIESIENIA_ZMIANY}: równo na progu jest procent, poniżej różnica bezwzględna`, () => {
    const naProgu = zmianaWobecPoprzedniejDoby([
      punkt('2026-10-24', 20),
      punkt('2026-10-25', 30),
      punkt('2026-10-26', 0),
    ])
    assert.equal(naProgu?.procent, 50) // (30 − 20) / 20 × 100
    const ponizej = zmianaWobecPoprzedniejDoby([
      punkt('2026-10-24', 19),
      punkt('2026-10-25', 30),
      punkt('2026-10-26', 0),
    ])
    assert.equal(ponizej?.procent, null)
    assert.equal(ponizej?.roznica, 11)
    assert.equal(opisZmiany(wymagana(ponizej)), 'o 11 więcej niż przedwczoraj')
  })

  it('odniesienie zero: nie ma procentu (dzielenie przez zero), jest różnica bezwzględna', () => {
    const zmiana = zmianaWobecPoprzedniejDoby([
      punkt('2026-10-24', 0),
      punkt('2026-10-25', 5),
      punkt('2026-10-26', 0),
    ])
    assert.deepEqual(zmiana, { teraz: 5, wtedy: 0, roznica: 5, procent: null })
    assert.equal(opisZmiany(wymagana(zmiana)), 'o 5 więcej niż przedwczoraj')
  })

  it('spadek przy małym odniesieniu mówi „mniej”, a równe doby „tyle samo”', () => {
    const mniej = zmianaWobecPoprzedniejDoby([
      punkt('2026-10-24', 12),
      punkt('2026-10-25', 9),
      punkt('2026-10-26', 0),
    ])
    assert.equal(opisZmiany(wymagana(mniej)), 'o 3 mniej niż przedwczoraj')
    const rowne = zmianaWobecPoprzedniejDoby([
      punkt('2026-10-24', 40),
      punkt('2026-10-25', 40),
      punkt('2026-10-26', 0),
    ])
    assert.equal(opisZmiany(wymagana(rowne)), 'tyle samo co przedwczoraj')
    const zera = zmianaWobecPoprzedniejDoby([
      punkt('2026-10-24', 0),
      punkt('2026-10-25', 0),
      punkt('2026-10-26', 0),
    ])
    assert.equal(opisZmiany(wymagana(zera)), 'tyle samo co przedwczoraj')
  })

  it('różnica poniżej precyzji procentu (5001 wobec 5000 = 0,02%) to „tyle samo”, nie „wzrost o 0,0%”', () => {
    const zmiana = zmianaWobecPoprzedniejDoby([
      punkt('2026-10-24', 5000),
      punkt('2026-10-25', 5001),
      punkt('2026-10-26', 0),
    ])
    assert.equal(zmiana?.roznica, 1)
    assert.equal(zmiana?.procent, 0)
    assert.equal(opisZmiany(wymagana(zmiana)), 'tyle samo co przedwczoraj')
  })

  it('brak punktu odniesienia: przerwa (null), za krótka seria albo luka w dobach → null, nie 0%', () => {
    assert.equal(
      zmianaWobecPoprzedniejDoby([
        punkt('2026-10-24', null),
        punkt('2026-10-25', 30),
        punkt('2026-10-26', 2),
      ]),
      null,
    )
    assert.equal(
      zmianaWobecPoprzedniejDoby([
        punkt('2026-10-24', 30),
        punkt('2026-10-25', null),
        punkt('2026-10-26', 2),
      ]),
      null,
    )
    assert.equal(
      zmianaWobecPoprzedniejDoby([punkt('2026-10-25', 30), punkt('2026-10-26', 2)]),
      null,
    )
    assert.equal(zmianaWobecPoprzedniejDoby([]), null)
    // Dwie doby, które nie są kolejne, nie są „wczoraj” i „przedwczoraj”.
    assert.equal(
      zmianaWobecPoprzedniejDoby([
        punkt('2026-10-20', 30),
        punkt('2026-10-25', 30),
        punkt('2026-10-26', 2),
      ]),
      null,
    )
  })

  it('pierwszy dzień pomiaru: przedwczoraj jest przerwą, więc zmiany nie ma', () => {
    const seria = uzupelnijSerieDzienna(
      [
        { dzien: '2026-10-25', odslony: 6, unikalni: 3, odslony_boty: 0 },
        { dzien: DZIS_T, odslony: 2, unikalni: 1, odslony_boty: 0 },
      ],
      30,
      DZIS_T,
    )
    assert.equal(zmianaWobecPoprzedniejDoby(seria), null)
  })
})

// ── Kafle ─────────────────────────────────────────────────────────────────────────────────

describe('kafleRuchu: wartości kafli na znanym zestawie', () => {
  const pomiar = pomiarZSerii(SERIA_T)
  const zmiana = zmianaWobecPoprzedniejDoby(uzupelnijSerieDzienna(SERIA_T, 30, DZIS_T))
  const kafle = kafleRuchu({ przeglad: PRZEGLAD_T, pomiar, dzis: DZIS_T, zmianaWczoraj: zmiana })

  it('świat T: kafle równają się liczbom z bazy (ręczne przeliczenie z testu SQL)', () => {
    assert.deepEqual(wartosci(kafle), [
      ['Teraz na stronie', 4],
      ['Unikalni (dziś)', 9],
      ['Unikalni (wczoraj)', 7],
      ['Unikalni (7 dób, suma)', 23],
      ['Średnio na dobę (7 dni)', 3.2857],
      ['Odsłony (24 h)', 15],
      ['Odsłony (7 dni)', 31],
      ['Odsłony (30 dni)', 45],
      ['Szczyt godzinowy', 8],
      ['Szczyt dobowy', 13],
    ])
  })

  it('średnia z 7 dób to suma ÷ 7 (23 / 7 = 3,2857), pokazywana z jedną cyfrą: 3,3', () => {
    assert.equal(Math.round((23 / 7) * 10_000) / 10_000, 3.2857)
    const srednia = kafle.ludzie.find((k) => k.klucz === 'przeglad.unikalniSrednia7d')
    assert.equal(srednia?.miejsca, 1)
    assert.equal(formatLiczby(srednia?.wartosc, srednia?.miejsca), '3,3')
  })

  it('tylko średnia ma cyfrę po przecinku: pozostałe kafle to liczby całkowite (bez „15,0”)', () => {
    const miejsca = Object.fromEntries(
      [...kafle.ludzie, ...kafle.odslony].map((k) => [k.klucz, k.miejsca]),
    )
    assert.equal(miejsca['przeglad.unikalniSrednia7d'], 1)
    for (const [klucz, m] of Object.entries(miejsca)) {
      if (klucz !== 'przeglad.unikalniSrednia7d') assert.equal(m, 0, klucz)
    }
  })

  it('szczyty mają datę i godzinę w czasie warszawskim, godzina jako zakres', () => {
    // 2026-10-19T10:00:00Z to 12:00 w Warszawie (CEST); 19.10.2026 to poniedziałek.
    const g = kafle.odslony.find((k) => k.klucz === 'przeglad.szczytGodzina')
    assert.equal(g?.podpis, 'pon. 19.10, 12:00–12:59')
    const d = kafle.odslony.find((k) => k.klucz === 'przeglad.szczytDzien')
    assert.equal(d?.podpis, 'pon. 19.10')
  })

  it('podpisy: okno, jednostka i pułapka; wczoraj niesie zmianę wobec przedwczoraj', () => {
    assert.deepEqual(
      [...kafle.ludzie, ...kafle.odslony].map((k) => k.podpis),
      [
        'ostatnie 5 minut, bez botów',
        'trwająca doba, liczba rośnie do północy',
        'pełna doba, spadek o 86,0% wobec przedwczoraj',
        'suma dobowych, nie liczba osób',
        'średnia dobowa, do porównań między okresami',
        'ostatnie 24 godziny, ruchome okno',
        '7 ostatnich dób, w tym niepełna dzisiejsza',
        '30 ostatnich dób, w tym niepełna dzisiejsza',
        'pon. 19.10, 12:00–12:59',
        'pon. 19.10',
      ],
    )
  })

  it('podpis kafla nie powtarza jego własnej liczby (ta sama liczba dwa razy w kadrze to usterka)', () => {
    for (const k of [...kafle.ludzie, ...kafle.odslony]) {
      if (k.wartosc === null) continue
      assert.ok(
        !zawieraLiczbe(k.podpis, formatLiczby(k.wartosc, k.miejsca)),
        `${k.etykieta}: podpis „${k.podpis}” powtarza liczbę kafla`,
      )
    }
  })

  it('etykieta kafla to nazwa hasła słownika, więc podpowiedź i kafel nie rozjeżdżają się w nazwie', () => {
    assert.deepEqual(
      kafle.ludzie.map((k) => k.klucz),
      [
        'przeglad.teraz5min',
        'przeglad.unikalniDzis',
        'przeglad.unikalniWczoraj',
        'przeglad.unikalni7d',
        'przeglad.unikalniSrednia7d',
      ],
    )
    assert.deepEqual(
      kafle.odslony.map((k) => k.klucz),
      [
        'przeglad.odslony24h',
        'przeglad.odslony7d',
        'przeglad.odslony30d',
        'przeglad.szczytGodzina',
        'przeglad.szczytDzien',
      ],
    )
  })

  it('Historia 3, scenariusz 2: dwie osoby i jeden bot w 5 minutach → „teraz na stronie” = 2', () => {
    // `admin_przeglad` liczy w teraz_5min tylko ludzi; bot trafia wyłącznie do boty_24h, nie do kafla.
    const k = kafleRuchu({
      przeglad: { ...PRZEGLAD_T, teraz_5min: 2, boty_24h: 1 },
      pomiar,
      dzis: DZIS_T,
      zmianaWczoraj: null,
    })
    assert.equal(k.ludzie[0]?.etykieta, 'Teraz na stronie')
    assert.equal(k.ludzie[0]?.wartosc, 2)
  })

  it('Historia 3, scenariusz 1: trzy doby → kafle zgadzają się z przeliczeniem z serii dobowej', () => {
    // 05.10: 10 odsłon / 4 osoby, 06.10: 20 / 8, 07.10 (dziś, niepełna): 5 / 3.
    // Ręcznie: unikalni 7 dób = 4 + 8 + 3 = 15 (doby sprzed 05.10 nie miały pomiaru), średnia 15 / 7 =
    // 2,1429, odsłony 7 i 30 dób = 10 + 20 + 5 = 35.
    const dzis = '2026-10-07'
    const wiersze: WierszSeriiDziennej[] = [
      { dzien: '2026-10-05', odslony: 10, unikalni: 4, odslony_boty: 1 },
      { dzien: '2026-10-06', odslony: 20, unikalni: 8, odslony_boty: 2 },
      { dzien: '2026-10-07', odslony: 5, unikalni: 3, odslony_boty: 0 },
    ]
    const seria = uzupelnijSerieDzienna(wiersze, 30, dzis)
    const suma = (okno: number, pole: 'odslony' | 'unikalni') =>
      seria.slice(-okno).reduce((s, p) => s + (p[pole] ?? 0), 0)
    const przeglad: PrzegladRuchu = {
      unikalni_dzis: 3,
      unikalni_wczoraj: 8,
      unikalni_7d: suma(7, 'unikalni'),
      unikalni_srednia_7d: Math.round((suma(7, 'unikalni') / 7) * 10_000) / 10_000,
      odslony_24h: 14,
      odslony_7d: suma(7, 'odslony'),
      odslony_30d: suma(30, 'odslony'),
      szczyt_godzina: { godzina: '2026-10-06T09:00:00Z', odslony: 6 },
      szczyt_dzien: { dzien: '2026-10-06', odslony: 20 },
      teraz_5min: 1,
      ludzie_24h: 14,
      boty_24h: 1,
    }
    const k = kafleRuchu({
      przeglad,
      pomiar: pomiarZSerii(wiersze),
      dzis,
      zmianaWczoraj: zmianaWobecPoprzedniejDoby(seria),
    })
    assert.deepEqual(wartosci(k), [
      ['Teraz na stronie', 1],
      ['Unikalni (dziś)', 3],
      ['Unikalni (wczoraj)', 8],
      ['Unikalni (7 dób, suma)', 15],
      ['Średnio na dobę (7 dni)', 2.1429],
      ['Odsłony (24 h)', 14],
      ['Odsłony (7 dni)', 35],
      ['Odsłony (30 dni)', 35],
      ['Szczyt godzinowy', 6],
      ['Szczyt dobowy', 20],
    ])
    // Odniesienie (4 osoby) jest poniżej progu, więc zmiana jest różnicą bezwzględną, nie 100%.
    assert.equal(k.ludzie[2]?.podpis, 'pełna doba, o 4 więcej niż przedwczoraj')
    assert.equal(
      opisPokrycia(pomiarZSerii(wiersze), dzis, k),
      'Zdarzenia w oknie 30 dób zaczynają się od pon. 05.10.2026 (dane obejmują 3 z 30 dób), więc sumy z 7 i 30 dni oraz średnia z 7 dni są zaniżone.',
    )
  })
})

describe('kafleRuchu: brak danych to null, nigdy zero udające pomiar (FR-040)', () => {
  const ZERA: PrzegladRuchu = {
    unikalni_dzis: 0,
    unikalni_wczoraj: 0,
    unikalni_7d: 0,
    unikalni_srednia_7d: 0,
    odslony_24h: 0,
    odslony_7d: 0,
    odslony_30d: 0,
    szczyt_godzina: null,
    szczyt_dzien: null,
    teraz_5min: 0,
    ludzie_24h: 0,
    boty_24h: 0,
  }

  it('pusty pomiar (nic w 30 dobach): każdy kafel jest szary, szczyty też', () => {
    const kafle = kafleRuchu({
      przeglad: ZERA,
      pomiar: pomiarZSerii([]),
      dzis: DZIS_T,
      zmianaWczoraj: null,
    })
    assert.ok(
      wartosci(kafle).every(([, wartosc]) => wartosc === null),
      JSON.stringify(wartosci(kafle)),
    )
    // Szczyty mówią, dlaczego ich nie ma; reszta zostawia powód zdaniu nad kaflami.
    assert.equal(kafle.odslony[3]?.podpis, 'brak odsłon ludzi w ostatnich 30 dobach')
    assert.equal(kafle.odslony[4]?.podpis, 'brak odsłon ludzi w ostatnich 30 dobach')
    assert.equal(kafle.ludzie[0]?.podpis, '')
  })

  it('świeży serwis, pierwszy dzień: „wczoraj” jest szare („pomiar jeszcze nie działał”), reszta liczy', () => {
    const przeglad: PrzegladRuchu = {
      ...ZERA,
      unikalni_dzis: 3,
      unikalni_7d: 3,
      unikalni_srednia_7d: 0.4286,
      odslony_24h: 5,
      odslony_7d: 5,
      odslony_30d: 5,
      szczyt_godzina: { godzina: '2026-10-26T09:00:00Z', odslony: 4 },
      szczyt_dzien: { dzien: DZIS_T, odslony: 5 },
      teraz_5min: 1,
      ludzie_24h: 5,
    }
    const pomiar = pomiarZSerii([{ dzien: DZIS_T, odslony: 5, unikalni: 3, odslony_boty: 0 }])
    const kafle = kafleRuchu({ przeglad, pomiar, dzis: DZIS_T, zmianaWczoraj: null })
    const wczoraj = kafle.ludzie[2]
    assert.equal(wczoraj?.etykieta, 'Unikalni (wczoraj)')
    assert.equal(wczoraj?.wartosc, null)
    assert.equal(wczoraj?.podpis, 'pomiar jeszcze nie działał')
    assert.deepEqual(
      wartosci(kafle).filter(([, wartosc]) => wartosc === null),
      [['Unikalni (wczoraj)', null]],
    )
    assert.equal(kafle.ludzie[1]?.wartosc, 3)
    assert.equal(kafle.odslony[2]?.wartosc, 5)
  })

  it('serwis z pomiarem od tygodni i cichą chwilą: zera zostają zerami (to prawdziwy wynik)', () => {
    const kafle = kafleRuchu({
      przeglad: {
        ...ZERA,
        szczyt_godzina: PRZEGLAD_T.szczyt_godzina,
        szczyt_dzien: PRZEGLAD_T.szczyt_dzien,
      },
      pomiar: pomiarZSerii(SERIA_T),
      dzis: DZIS_T,
      zmianaWczoraj: null,
    })
    assert.equal(kafle.ludzie[0]?.wartosc, 0) // nikt nie jest teraz na stronie
    assert.equal(kafle.ludzie[2]?.wartosc, 0) // wczoraj po początku pomiaru: zero, nie brak
    assert.equal(kafle.odslony[0]?.wartosc, 0)
  })

  it('pomiar zaczął się WCZORAJ: zero z wczoraj to prawdziwy wynik (np. same boty), nie brak pomiaru', () => {
    const kafle = kafleRuchu({
      przeglad: { ...ZERA, unikalni_dzis: 2, odslony_24h: 3 },
      pomiar: pomiarZSerii([
        { dzien: '2026-10-25', odslony: 0, unikalni: 0, odslony_boty: 4 },
        { dzien: DZIS_T, odslony: 3, unikalni: 2, odslony_boty: 0 },
      ]),
      dzis: DZIS_T,
      zmianaWczoraj: null,
    })
    assert.equal(kafle.ludzie[2]?.etykieta, 'Unikalni (wczoraj)')
    assert.equal(kafle.ludzie[2]?.wartosc, 0)
    assert.equal(kafle.ludzie[2]?.podpis, 'pełna doba')
  })

  it('pomiar nieznany (seria dzienna jeszcze nie dotarła): niczego nie ukrywamy, zera zostają', () => {
    const kafle = kafleRuchu({
      przeglad: ZERA,
      pomiar: pomiarZSerii(null),
      dzis: DZIS_T,
      zmianaWczoraj: null,
    })
    assert.equal(kafle.ludzie[0]?.wartosc, 0)
    assert.equal(kafle.ludzie[2]?.wartosc, 0)
  })

  it('liczby dodatnie nigdy nie są ukrywane, nawet gdy seria mówi „pusty” (dowód danych wygrywa)', () => {
    const kafle = kafleRuchu({
      przeglad: { ...ZERA, unikalni_dzis: 3, odslony_24h: 4 },
      pomiar: pomiarZSerii([]),
      dzis: DZIS_T,
      zmianaWczoraj: null,
    })
    assert.equal(kafle.ludzie[1]?.wartosc, 3)
    assert.equal(kafle.odslony[0]?.wartosc, 4)
    assert.equal(kafle.ludzie[0]?.wartosc, null)
  })

  it('odpowiedź nieczytelna: pola brakujące, ujemne, NaN albo tekst to null, bez wyjątku', () => {
    const smieci = {
      unikalni_dzis: 'dużo',
      unikalni_wczoraj: -3,
      unikalni_7d: Number.NaN,
      odslony_24h: Number.POSITIVE_INFINITY,
      szczyt_godzina: { godzina: 'kiedyś', odslony: 5 },
      szczyt_dzien: { dzien: '2026-02-30', odslony: 5 },
    } as unknown as PrzegladRuchu
    const kafle = kafleRuchu({
      przeglad: smieci,
      pomiar: pomiarZSerii(SERIA_T),
      dzis: DZIS_T,
      zmianaWczoraj: null,
    })
    assert.ok(wartosci(kafle).every(([, wartosc]) => wartosc === null))
    // Pole nieobecne to niezgodność odpowiedzi, a nie „brak ruchu”: bez zmyślonego powodu.
    assert.equal(kafle.odslony[3]?.podpis, '')
    assert.equal(kafle.odslony[4]?.podpis, '')
  })

  it('szczyt równy zero nie jest szczytem (kontrakt: brak ruchu to null)', () => {
    const kafle = kafleRuchu({
      przeglad: {
        ...PRZEGLAD_T,
        szczyt_godzina: { godzina: '2026-10-19T10:00:00Z', odslony: 0 },
        szczyt_dzien: { dzien: '2026-10-19', odslony: 0 },
      },
      pomiar: pomiarZSerii(SERIA_T),
      dzis: DZIS_T,
      zmianaWczoraj: null,
    })
    assert.equal(kafle.odslony[3]?.wartosc, null)
    assert.equal(kafle.odslony[4]?.wartosc, null)
  })
})

describe('opisPokrycia: zdanie nad kaflami, gdy pomiar nie obejmuje okna', () => {
  const kafleT = kafleRuchu({
    przeglad: PRZEGLAD_T,
    pomiar: pomiarZSerii(SERIA_T),
    dzis: DZIS_T,
    zmianaWczoraj: null,
  })

  it('okno pełne (dane od początku okna 30 dób) → brak uwagi', () => {
    // Okno 30 dób kończące się 26.10 zaczyna się 27.09, czyli dokładnie w pierwszej dobie danych.
    assert.equal(opisPokrycia({ rodzaj: 'od', pierwszyDzien: '2026-09-27' }, DZIS_T, kafleT), null)
    assert.equal(opisPokrycia({ rodzaj: 'od', pierwszyDzien: '2026-08-01' }, DZIS_T, kafleT), null)
  })

  it('dane od 11.10: okno 7 dni pełne, 30 dni niepełne (16 z 30 dób) → zaniżona tylko suma z 30 dni', () => {
    // Doby 11.10–26.10 włącznie = 16.
    assert.equal(
      opisPokrycia({ rodzaj: 'od', pierwszyDzien: '2026-10-11' }, DZIS_T, kafleT),
      'Zdarzenia w oknie 30 dób zaczynają się od niedz. 11.10.2026 (dane obejmują 16 z 30 dób), więc suma z 30 dni jest zaniżona.',
    )
  })

  it('dane od 24.10: oba okna niepełne (3 z 30 dób) → zaniżone sumy 7 i 30 dni oraz średnia', () => {
    assert.equal(
      opisPokrycia({ rodzaj: 'od', pierwszyDzien: '2026-10-24' }, DZIS_T, kafleT),
      'Zdarzenia w oknie 30 dób zaczynają się od sob. 24.10.2026 (dane obejmują 3 z 30 dób), więc sumy z 7 i 30 dni oraz średnia z 7 dni są zaniżone.',
    )
  })

  it('granica okna 7 dni: dane od 20.10 (dokładnie 7 dób) → okno 7 dni pełne', () => {
    const tekst = opisPokrycia({ rodzaj: 'od', pierwszyDzien: '2026-10-20' }, DZIS_T, kafleT)
    assert.match(tekst ?? '', /dane obejmują 7 z 30 dób\), więc suma z 30 dni jest zaniżona\.$/)
  })

  it('pierwszy dzień serwisu: dane obejmują 1 z 30 dób', () => {
    const tekst = opisPokrycia({ rodzaj: 'od', pierwszyDzien: DZIS_T }, DZIS_T, kafleT)
    assert.match(tekst ?? '', /dane obejmują 1 z 30 dób/)
  })

  it('pusty pomiar: zdanie tylko, gdy kafle są znane i żaden nie jest dodatni', () => {
    const zera = kafleRuchu({
      przeglad: {
        ...PRZEGLAD_T,
        unikalni_dzis: 0,
        unikalni_wczoraj: 0,
        unikalni_7d: 0,
        unikalni_srednia_7d: 0,
        odslony_24h: 0,
        odslony_7d: 0,
        odslony_30d: 0,
        szczyt_godzina: null,
        szczyt_dzien: null,
        teraz_5min: 0,
      },
      pomiar: pomiarZSerii([]),
      dzis: DZIS_T,
      zmianaWczoraj: null,
    })
    const tekst = opisPokrycia({ rodzaj: 'pusty' }, DZIS_T, zera)
    assert.match(tekst ?? '', /^W ostatnich 30 dobach nie zarejestrowano żadnych zdarzeń/)
    assert.match(tekst ?? '', /zakładce Jakość/)
    // Kafle jeszcze nieznane albo z dodatnią liczbą: zdanie przeczyłoby temu, co widać.
    assert.equal(opisPokrycia({ rodzaj: 'pusty' }, DZIS_T, null), null)
    assert.equal(opisPokrycia({ rodzaj: 'pusty' }, DZIS_T, kafleT), null)
  })

  it('nic nie wiemy o serii albo zegar się rozjechał → brak uwagi', () => {
    assert.equal(opisPokrycia({ rodzaj: 'nieznany' }, DZIS_T, kafleT), null)
    assert.equal(opisPokrycia({ rodzaj: 'od', pierwszyDzien: '2026-10-24' }, null, kafleT), null)
    // Początek danych „w przyszłości” względem dziś = rozjazd zegarów, nie ostrzeżenie.
    assert.equal(opisPokrycia({ rodzaj: 'od', pierwszyDzien: '2026-10-27' }, DZIS_T, kafleT), null)
  })
})

// ── Ludzie i boty ─────────────────────────────────────────────────────────────────────────

describe('segmentyLudzieBoty: dwie części jednej całości, podstawą jest SUMA', () => {
  const sumaProcentow = (udzialy_: readonly (number | null)[]) =>
    udzialy_.reduce<number>((s, u) => s + (u ?? 0), 0)

  it('świat T: ludzie 15, boty 7 → 68,2% i 31,8% (podstawa 22), razem dokładnie 100,0%', () => {
    // 15 / 22 = 68,18…% oraz 7 / 22 = 31,81…%. Podłogi na jednym miejscu po przecinku to 68,1 i 31,8
    // (razem 99,9); brakującą dziesiątą dostaje wiersz z większą resztą ułamkową (0,818 wobec 0,18),
    // czyli ludzie: 68,2.
    const segmenty = segmentyLudzieBoty(PRZEGLAD_T)
    assert.deepEqual(
      segmenty.map((s) => [s.klucz, s.etykieta, s.wartosc]),
      [
        ['ludzie', 'Ludzie', 15],
        ['boty', 'Boty', 7],
      ],
    )
    const procenty = udzialy(segmenty, 'wartosc')
    assert.deepEqual(procenty, [68.2, 31.8])
    assert.equal(Math.round(sumaProcentow(procenty) * 10), 1000)
  })

  it('podstawą jest suma obu grup, a nie większa z nich: 90 i 10 to 90% i 10% (nie 100% i 11,1%)', () => {
    const procenty = udzialy(
      segmentyLudzieBoty({ ...PRZEGLAD_T, ludzie_24h: 90, boty_24h: 10 }),
      'wartosc',
    )
    assert.deepEqual(procenty, [90, 10])
  })

  it('kolory za bytem: ludzie jak seria „odsłony” (slot 1), boty szare', () => {
    assert.deepEqual(
      segmentyLudzieBoty(PRZEGLAD_T).map((s) => s.kolor),
      [1, 'szary'],
    )
  })

  it('same boty → 0% i 100%; sami ludzie → 100% i 0% (zero przy dodatniej sumie to faktyczne zero)', () => {
    assert.deepEqual(
      udzialy(segmentyLudzieBoty({ ...PRZEGLAD_T, ludzie_24h: 0, boty_24h: 5 }), 'wartosc'),
      [0, 100],
    )
    assert.deepEqual(
      udzialy(segmentyLudzieBoty({ ...PRZEGLAD_T, ludzie_24h: 8, boty_24h: 0 }), 'wartosc'),
      [100, 0],
    )
  })

  it('obie grupy puste (suma 0): udziały to null, nie 0% ani NaN', () => {
    const segmenty = segmentyLudzieBoty({ ...PRZEGLAD_T, ludzie_24h: 0, boty_24h: 0 })
    assert.deepEqual(udzialy(segmenty, 'wartosc'), [null, null])
  })

  it('jedna część nieczytelna → obie bez wartości (udział drugiej wobec nieznanej całości byłby fałszem)', () => {
    const segmenty = segmentyLudzieBoty({
      ...PRZEGLAD_T,
      ludzie_24h: Number.NaN,
      boty_24h: 5,
    })
    assert.deepEqual(
      segmenty.map((s) => s.wartosc),
      [null, null],
    )
    assert.deepEqual(udzialy(segmenty, 'wartosc'), [null, null])
  })

  it('to samo, gdy nieczytelna jest druga część (boty): ludzie też bez wartości', () => {
    const segmenty = segmentyLudzieBoty({ ...PRZEGLAD_T, ludzie_24h: 40, boty_24h: -2 })
    assert.deepEqual(
      segmenty.map((s) => s.wartosc),
      [null, null],
    )
  })

  it('INWARIANT (400 losowych par): segmenty sumują się do 100,0 ± 0,1, a udział = część ÷ suma', () => {
    const los = generator(20261005)
    let sprawdzone = 0
    for (let i = 0; i < 400; i++) {
      // Mieszanka: małe liczby, miliony, jedna grupa dużo większa od drugiej, zera.
      const ludzie = los() < 0.15 ? 0 : Math.floor(los() ** 3 * 2_000_000)
      const boty = los() < 0.15 ? 0 : Math.floor(los() ** 3 * 2_000_000)
      const procenty = udzialy(
        segmentyLudzieBoty({ ...PRZEGLAD_T, ludzie_24h: ludzie, boty_24h: boty }),
        'wartosc',
      )
      if (ludzie + boty === 0) {
        assert.deepEqual(procenty, [null, null])
        continue
      }
      sprawdzone++
      assert.ok(Math.abs(sumaProcentow(procenty) - 100) <= 0.1, `${ludzie}/${boty}: ${procenty}`)
      assert.equal(Math.round(sumaProcentow(procenty) * 10), 1000, `${ludzie}/${boty}`)
      const dokladny = (ludzie / (ludzie + boty)) * 100
      assert.ok(Math.abs((procenty[0] ?? Number.NaN) - dokladny) < 0.1 + 1e-9, `${ludzie}/${boty}`)
    }
    assert.ok(sprawdzone > 300, `sprawdzono tylko ${sprawdzone} par`)
  })
})

// ── Roboty ────────────────────────────────────────────────────────────────────────────────

describe('crawlery AI i pozostałe roboty', () => {
  it('tylko klasa „ai”, malejąco po odsłonach; remis rozstrzyga nazwa (jak w bazie)', () => {
    const ai = wierszeCrawlerowAi(BOTY_T)
    assert.deepEqual(
      ai.map((w) => [w.rodzina, w.odslony]),
      [
        ['gptbot', 3],
        ['claudebot', 2],
        ['perplexitybot', 2],
      ],
    )
  })

  it('kolejność nie zależy od kolejności wejścia (remisy po nazwie, nie po tym, co baza zwróciła pierwsze)', () => {
    const odwrocone = [...BOTY_T].reverse()
    assert.deepEqual(wierszeCrawlerowAi(odwrocone), wierszeCrawlerowAi(BOTY_T))
    assert.deepEqual(wierszePozostalychRobotow(odwrocone), wierszePozostalychRobotow(BOTY_T))
  })

  it('ostatnia wizyta w czasie warszawskim: zimą +1 h, latem +2 h', () => {
    const wg = Object.fromEntries(wierszeCrawlerowAi(BOTY_T).map((w) => [w.rodzina, w.ostatnia]))
    // 26.10 13:28Z → 14:28 CET (zmiana czasu była 25.10); 26.10 05:00Z → 06:00; 20.10 08:01Z → 10:01 CEST.
    assert.equal(wg.gptbot, '26.10, 14:28')
    assert.equal(wg.claudebot, '26.10, 06:00')
    assert.equal(wg.perplexitybot, '20.10, 10:01')
  })

  it('pozostałe roboty: klasa po polsku, kolejność jak w bazie (googlebot, „(nieznana)”, curl)', () => {
    const inne = wierszePozostalychRobotow(BOTY_T)
    assert.deepEqual(
      inne.map((w) => [w.rodzina, w.klasa, w.odslony, w.ostatnia]),
      [
        ['googlebot', 'Wyszukiwarki', 2, '26.10, 04:01'],
        ['(nieznana)', 'Inne', 1, '26.10, 03:00'],
        ['curl', 'Narzędzia i skrypty', 1, '25.10, 09:00'],
      ],
    )
  })

  it('dwie tabele rozłączne i razem dają wszystkie roboty z bazy (nic nie zginęło)', () => {
    const razem = [...wierszeCrawlerowAi(BOTY_T), ...wierszePozostalychRobotow(BOTY_T)]
    assert.equal(razem.length, BOTY_T.length)
    assert.equal(new Set(razem.map((w) => w.klucz)).size, BOTY_T.length)
    assert.equal(
      razem.reduce((s, w) => s + w.odslony, 0),
      BOTY_T.reduce((s, w) => s + w.odslony, 0),
    )
  })

  it('nieznana klasa wraca sama (nowa klasa w bazie jest widoczna, nie znika)', () => {
    const inne = wierszePozostalychRobotow([
      { rodzina: 'x', klasa: 'nowa-klasa', odslony: 1, ostatnio: '2026-10-26T13:28:00Z' },
    ])
    assert.equal(inne[0]?.klasa, 'nowa-klasa')
  })

  it('ta sama rodzina w dwóch klasach to dwa wiersze o różnych kluczach', () => {
    const wiersze: WierszBotaAi[] = [
      { rodzina: 'google', klasa: 'ai', odslony: 1, ostatnio: '2026-10-26T13:28:00Z' },
      { rodzina: 'google', klasa: 'wyszukiwarka', odslony: 5, ostatnio: '2026-10-26T13:28:00Z' },
    ]
    assert.equal(wierszeCrawlerowAi(wiersze).length, 1)
    assert.equal(wierszePozostalychRobotow(wiersze).length, 1)
    assert.notEqual(
      wierszeCrawlerowAi(wiersze)[0]?.klucz,
      wierszePozostalychRobotow(wiersze)[0]?.klucz,
    )
  })

  it('wiersze śmieciowe są pomijane, czas nieczytelny to null, pusta lista to pusta lista', () => {
    const wiersze = [
      { rodzina: '', klasa: 'ai', odslony: 4, ostatnio: '2026-10-26T13:28:00Z' },
      { rodzina: 'zly', klasa: 'ai', odslony: Number.NaN, ostatnio: '2026-10-26T13:28:00Z' },
      { rodzina: 'ujemny', klasa: 'ai', odslony: -1, ostatnio: '2026-10-26T13:28:00Z' },
      { rodzina: 'bezklasy', odslony: 1, ostatnio: '2026-10-26T13:28:00Z' },
      { rodzina: 'dobry', klasa: 'ai', odslony: 2, ostatnio: 'wczoraj' },
      null,
    ] as never
    const ai = wierszeCrawlerowAi(wiersze)
    assert.deepEqual(
      ai.map((w) => [w.rodzina, w.ostatnia]),
      [['dobry', null]],
    )
    assert.deepEqual(wierszeCrawlerowAi([]), [])
    assert.deepEqual(wierszePozostalychRobotow([]), [])
  })

  it('tekst z bazy zostaje tekstem: rodzina nie jest przerabiana ani składana w znacznik', () => {
    const wredna = '<img src=x onerror=alert(1)>'
    const [wiersz] = wierszeCrawlerowAi([
      { rodzina: wredna, klasa: 'ai', odslony: 1, ostatnio: '2026-10-26T13:28:00Z' },
    ])
    assert.equal(wiersz?.rodzina, wredna)
    assert.equal(typeof wiersz?.rodzina, 'string')
  })
})

// ── Typografia ────────────────────────────────────────────────────────────────────────────

describe('wygenerowane teksty', () => {
  it('żaden tekst widoczny na ekranie nie zawiera pauzy (U+2014), tylko półpauzę', () => {
    const teksty: string[] = []
    const kafle = kafleRuchu({
      przeglad: PRZEGLAD_T,
      pomiar: pomiarZSerii(SERIA_T),
      dzis: DZIS_T,
      zmianaWczoraj: zmianaWobecPoprzedniejDoby(uzupelnijSerieDzienna(SERIA_T, 30, DZIS_T)),
    })
    for (const k of [...kafle.ludzie, ...kafle.odslony]) teksty.push(k.etykieta, k.podpis)
    for (const dzien of ['2026-10-11', '2026-10-24', DZIS_T]) {
      teksty.push(opisPokrycia({ rodzaj: 'od', pierwszyDzien: dzien }, DZIS_T, kafle) ?? '')
    }
    teksty.push(opisPokrycia({ rodzaj: 'pusty' }, DZIS_T, null) ?? '')
    for (const roznica of [-43, 0, 3, 150]) {
      teksty.push(opisZmiany({ teraz: 1, wtedy: 1, roznica, procent: null }))
      teksty.push(opisZmiany({ teraz: 1, wtedy: 1, roznica, procent: roznica }))
    }
    for (const w of [...wierszeCrawlerowAi(BOTY_T), ...wierszePozostalychRobotow(BOTY_T)]) {
      teksty.push(w.klasa, w.ostatnia ?? '')
    }
    assert.ok(teksty.length > 30, 'test niczego nie zmierzył')
    for (const tekst of teksty) assert.ok(!tekst.includes(PAUZA), `pauza w: ${tekst}`)
  })
})
