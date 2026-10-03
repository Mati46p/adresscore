// #177: „czy mapa spełnia potrzebę” – miara bez JEV i bez sieci, deterministyczna.
//
// Użycie (z katalogu repo, potrzebna historia git z BAZA; ok. 40 s):
//   node src/ai/pomiar/spelnienie.ts            # tabele markdown na stdout (do WYNIKI.md)
//   node src/ai/pomiar/spelnienie.ts --top 300  # inny rozmiar „najlepszych adresów” (domyślnie 100)
//   node src/ai/pomiar/spelnienie.ts --syntetyczne  # #183: nowe potrzeby na przypadkach syntetycznych
//   node src/ai/pomiar/spelnienie.ts --182      # tylko tabele 4–5: siła i „nie chcę” (#182), ok. 6 s
//
// Dla opisów ze zbioru wzorcowego i zbiorów kontrolnych nr 1–7 bierzemy WZORCOWY profil
// i WZORCOWE potrzeby (etykiety, nie odpowiedź JEV) i liczymy wagi na kilka sposobów:
//   profil – sam profil (`ustawieniaPersony`); profil null = PERSONA_DOMYSLNA, jak u nowego
//            użytkownika, który niczego nie zmieniał,
//   stara  – profil + potrzeby: tabela POTRZEBY i `wagiZeZrozumienia` sprzed #177 (BAZA),
//   skład  – stara tabela, ale bieżące `wagiZeZrozumienia` (#177: poziom kategorii podnosi
//            tylko warstwy, które profil już liczy) – osobno widać, co daje samo składanie,
//   nowa   – bieżąca tabela i bieżące `wagiZeZrozumienia`.
// Silnik (`wynikiWszystkich`, tryb „kupuję”) liczy wynik wszystkich adresów, a my patrzymy na
// TOP najlepszych. Każda potrzeba ma 1–2 wskaźniki spełnienia z surowych danych (MIARY, np.
// pies → zieleń w 100 m i odległość do weterynarza).
//
// Tabela 1 (profil → profil + potrzeby): mediana wskaźnika w top adresów opisu, potem mediana
// po opisach z tą potrzebą. Opis ma zwykle kilka potrzeb naraz, więc tu miesza się wpływ
// wszystkich (np. senior + cisza + zieleń odsuwa top od przychodni).
// Tabela 2 (efekt krańcowy): ten sam opis z potrzebą i bez niej (reszta potrzeb bez zmian) –
// czy SAMA ta potrzeba przesuwa top we właściwą stronę. Mediana zmian po opisach i liczba
// opisów, w których wskaźnik się poprawił / pogorszył.
// Tabela 3 (skutki uboczne): warstwy liczone w wyniku, rozrzut wyników wszystkich adresów
// (p90 − p10; czy rozkład się nie spłaszcza), „wynik samego profilu” w nowym top (ile kosztuje
// dopasowanie do potrzeb) i wspólna część top z top samego profilu.
//
// Opisy bez wzorcowych potrzeb nic tu nie mierzą i są pomijane. Wynik dla tego samego zestawu
// (tabela + profil + potrzeby) liczymy raz, a oceny warstw silnik trzyma w pamięci
// (`ocenyWskaznika`), więc każdy przebieg to tylko suma ważona.
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import type { PlikWskaznika, WskaznikMeta } from '../../kontrakty/index.ts'
import { PERSONA_DOMYSLNA, type PersonaId, ustawieniaPersony } from '../../wynik/persony.ts'
import {
  type Kierunki,
  kierunekEfektywny,
  przygotujWskaznik,
  type WskaznikPrzygotowany,
  wynikiWszystkich,
} from '../../wynik/silnik.ts'
import * as nowa from '../opiszSiebie.ts'

/** `main` przed #177 (z #171, #174 i #176) – stara tabela POTRZEBY. */
const BAZA = '430153e'
const TRYB = 'kupuje' as const
const argv = process.argv.slice(2)
const iTop = argv.indexOf('--top')
const TOP = iTop >= 0 ? Number(argv[iTop + 1]) : 100

const KORZEN = new URL('../../../', import.meta.url)
const AI = new URL('../', import.meta.url)
const POMIAR = new URL('./', import.meta.url)

// ── Dane ──────────────────────────────────────────────────────────────────────────────────

const katalog = new URL('public/dane/wskazniki/', KORZEN)
const WSKAZNIKI: WskaznikPrzygotowany[] = readdirSync(katalog)
  .filter((f) => f.endsWith('.json'))
  .sort()
  .map((f) =>
    przygotujWskaznik(JSON.parse(readFileSync(new URL(f, katalog), 'utf8')) as PlikWskaznika),
  )
const METAS: WskaznikMeta[] = WSKAZNIKI.map((w) => w.meta)
const N = Math.min(...WSKAZNIKI.map((w) => w.wartosci.length))
const PO_ID = new Map(WSKAZNIKI.map((w) => [w.meta.id, w]))

interface Pozycja {
  id: string
  persona: PersonaId | null
  potrzeby: string[]
}
const ZBIORY = [
  'zbior-opisz.json',
  'kontrolny-opisz.json',
  ...[2, 3, 4, 5, 6, 7].map((n) => `kontrolny${n}-opisz.json`),
]
const POZYCJE: Pozycja[] = ZBIORY.flatMap(
  (f) => JSON.parse(readFileSync(new URL(f, POMIAR), 'utf8')).pozycje as Pozycja[],
).filter((p) => p.potrzeby.length > 0)

// ── Wskaźniki spełnienia ──────────────────────────────────────────────────────────────────

interface Miara {
  id: string
  /** Kierunek „lepiej” dla tej potrzeby (nie zawsze kierunek warstwy). */
  lepiej: 'mniej' | 'wiecej'
  /**
   * Odsetek top adresów (z danymi) z wartością > `powyzej` zamiast mediany – dla warstw, gdzie
   * mediana stoi na dnie skali (hałas: najniższe pasmo 50 dB ma ¼ adresów z danymi).
   */
  powyzej?: number
}
export const MIARY: Readonly<Record<string, readonly Miara[]>> = {
  dzieci: [
    { id: 'przedszkole_odleglosc', lepiej: 'mniej' },
    { id: 'plac_zabaw_odleglosc', lepiej: 'mniej' },
  ],
  pies: [
    { id: 'zielen_worldcover_100m', lepiej: 'wiecej' },
    { id: 'weterynarz_odleglosc', lepiej: 'mniej' },
  ],
  zielen: [
    { id: 'zielen_worldcover_100m', lepiej: 'wiecej' },
    { id: 'zielen_udzial', lepiej: 'wiecej' },
  ],
  powietrze: [
    { id: 'pm25_srednia', lepiej: 'mniej' },
    { id: 'no2_srednia', lepiej: 'mniej' },
  ],
  rower: [
    { id: 'rower_infrastruktura_odleglosc', lepiej: 'mniej' },
    { id: 'stojaki_300m', lepiej: 'wiecej' },
  ],
  bez_samochodu: [
    { id: 'przystanek_odleglosc', lepiej: 'mniej' },
    { id: 'kursy_szczyt_h', lepiej: 'wiecej' },
  ],
  senior: [
    { id: 'przychodnia_odleglosc', lepiej: 'mniej' },
    { id: 'lawki_300m', lepiej: 'wiecej' },
  ],
  praca_centrum: [{ id: 'rynek_czas_min', lepiej: 'mniej' }],
  zdrowie: [
    { id: 'przychodnia_odleglosc', lepiej: 'mniej' },
    { id: 'apteka_odleglosc', lepiej: 'mniej' },
  ],
  lotnisko: [{ id: 'lotnisko_czas_min', lepiej: 'mniej' }],
  cisza: [
    { id: 'halas_ldwn', lepiej: 'mniej', powyzej: 50 },
    { id: 'zycie_nocne_300m', lepiej: 'mniej', powyzej: 0 },
  ],
  sklepy: [
    { id: 'sklep_odleglosc', lepiej: 'mniej' },
    { id: 'gastronomia_odleglosc', lepiej: 'mniej' },
  ],
  // Powódź Q10 (> 0 m) ma 29 adresów – top 100 jej nie dotyka, więc mierzymy osuwiska.
  bezpieczenstwo: [
    { id: 'teren_osuwiskowy', lepiej: 'mniej', powyzej: 0 },
    { id: 'oswietlenie_100m', lepiej: 'wiecej' },
  ],
  inwestycja: [{ id: 'inwestycje_500m', lepiej: 'wiecej' }],
  singiel: [
    { id: 'kursy_szczyt_h', lepiej: 'wiecej' },
    { id: 'rynek_czas_min', lepiej: 'mniej' },
  ],
  // #183: nowe potrzeby. Warstwy 0/1 i „zwykle zero” jako odsetek top z wartością > 0.
  auto: [
    { id: 'dojazd_utwardzony', lepiej: 'wiecej', powyzej: 0 },
    { id: 'spp_podstrefa', lepiej: 'mniej', powyzej: 0 },
  ],
  wozek: [
    { id: 'obnizone_krawezniki_300m', lepiej: 'wiecej' },
    { id: 'przychodnia_bez_barier_odleglosc', lepiej: 'mniej' },
  ],
  praca_zdalna: [
    { id: 'halas_ldwn', lepiej: 'mniej', powyzej: 50 },
    { id: 'zielen_worldcover_100m', lepiej: 'wiecej' },
  ],
  zycie_nocne: [
    { id: 'zycie_nocne_300m', lepiej: 'wiecej', powyzej: 0 },
    { id: 'gastronomia_odleglosc', lepiej: 'mniej' },
  ],
  sport: [
    { id: 'sport_odleglosc', lepiej: 'mniej' },
    { id: 'silownia_plenerowa_odleglosc', lepiej: 'mniej' },
  ],
  student: [
    { id: 'akademik_odleglosc', lepiej: 'mniej' },
    { id: 'kursy_szczyt_h', lepiej: 'wiecej' },
  ],
}

/**
 * #183: przypadki syntetyczne – złote potrzeby nowych id nie istnieją jeszcze w zbiorach 1–7
 * (zbiór nr 8 jest ślepy). Profil i potrzeby bazowe jak w typowych opisach; liczymy efekt
 * krańcowy: profil + potrzeby bazowe → to samo + nowa potrzeba.
 */
interface Syntetyczny {
  id: string
  persona: PersonaId | null
  bazowe: string[]
  nowa: string
}
export const SYNTETYCZNE: readonly Syntetyczny[] = [
  { id: 'S01', persona: 'rodzina', bazowe: ['dzieci'], nowa: 'auto' },
  { id: 'S02', persona: 'singiel', bazowe: ['praca_centrum'], nowa: 'auto' },
  { id: 'S03', persona: null, bazowe: ['zielen', 'cisza'], nowa: 'auto' },
  { id: 'S04', persona: 'senior', bazowe: ['zdrowie'], nowa: 'auto' },
  { id: 'S05', persona: 'senior', bazowe: ['zdrowie'], nowa: 'wozek' },
  { id: 'S06', persona: null, bazowe: [], nowa: 'wozek' },
  { id: 'S07', persona: 'rodzina', bazowe: ['dzieci'], nowa: 'wozek' },
  { id: 'S08', persona: 'singiel', bazowe: ['bez_samochodu'], nowa: 'wozek' },
  { id: 'S09', persona: 'singiel', bazowe: [], nowa: 'praca_zdalna' },
  { id: 'S10', persona: 'rodzina', bazowe: ['dzieci'], nowa: 'praca_zdalna' },
  { id: 'S11', persona: null, bazowe: ['pies'], nowa: 'praca_zdalna' },
  { id: 'S12', persona: 'singiel', bazowe: ['bez_samochodu', 'sklepy'], nowa: 'praca_zdalna' },
  { id: 'S13', persona: 'singiel', bazowe: [], nowa: 'zycie_nocne' },
  { id: 'S14', persona: 'singiel', bazowe: ['bez_samochodu'], nowa: 'zycie_nocne' },
  { id: 'S15', persona: null, bazowe: ['praca_centrum'], nowa: 'zycie_nocne' },
  { id: 'S16', persona: 'singiel', bazowe: ['cisza'], nowa: 'zycie_nocne' },
  { id: 'S17', persona: 'singiel', bazowe: [], nowa: 'sport' },
  { id: 'S18', persona: 'rodzina', bazowe: ['dzieci'], nowa: 'sport' },
  { id: 'S19', persona: null, bazowe: ['rower'], nowa: 'sport' },
  { id: 'S20', persona: 'senior', bazowe: ['zielen'], nowa: 'sport' },
  { id: 'S21', persona: 'singiel', bazowe: ['singiel'], nowa: 'student' },
  { id: 'S22', persona: 'singiel', bazowe: ['bez_samochodu'], nowa: 'student' },
  { id: 'S23', persona: null, bazowe: ['koszty'], nowa: 'student' },
  { id: 'S24', persona: 'rodzina', bazowe: ['dzieci'], nowa: 'student' },
  { id: 'S25', persona: 'singiel', bazowe: ['rower'], nowa: 'student' },
]

// ── Wagi ──────────────────────────────────────────────────────────────────────────────────

type Modul = Pick<typeof nowa, 'POTRZEBY' | 'wagiZeZrozumienia'>
type Ustawienia = { wagi: Record<string, number>; kierunki: Kierunki }

/** To samo co `zloz` w opiszSiebie.ts (bez chipów): maksimum po potrzebach. */
function zrozumienie(
  m: Modul,
  persona: PersonaId | null,
  ids: readonly string[],
): nowa.Zrozumienie {
  const kategorie: nowa.Zrozumienie['kategorie'] = {}
  const wskazniki: Record<string, number> = {}
  for (const id of ids) {
    const p = m.POTRZEBY.find((x) => x.id === id)
    if (!p) continue
    for (const [k, w] of Object.entries(p.kategorie) as [nowa.KategoriaOceniana, number][])
      kategorie[k] = Math.max(kategorie[k] ?? 0, w)
    for (const [i, w] of Object.entries(p.wskazniki)) wskazniki[i] = Math.max(wskazniki[i] ?? 0, w)
  }
  return { persona, kategorie, wskazniki, potrzeby: [...ids], zrozumialem: [] }
}

/** Profil null = bieżące ustawienia nowego użytkownika, czyli profil domyślny. */
const baza = (persona: PersonaId | null): Ustawienia =>
  ustawieniaPersony(persona ?? PERSONA_DOMYSLNA, TRYB, METAS)

// ── Silnik i top adresów ──────────────────────────────────────────────────────────────────

interface Przebieg {
  wynik: Float32Array
  top: Uint32Array
  /** Rozrzut wyników wszystkich adresów: p90 − p10. */
  rozrzut: number
  /** Warstwy, które naprawdę liczą się do wyniku (waga > 0 i jest kierunek). */
  warstwy: number
}

function przebieg(u: Ustawienia): Przebieg {
  const wynik = wynikiWszystkich(WSKAZNIKI, u.wagi, u.kierunki, N)
  const liczby = Float32Array.from(wynik.filter((v) => v === v)).sort()
  const p = (q: number) => liczby[Math.floor((liczby.length - 1) * q)] as number
  // Próg TOP-tej wartości; remisy na progu bierzemy w kolejności indeksu (deterministycznie).
  const prog = liczby[liczby.length - TOP] as number
  const top: number[] = []
  for (let i = 0; i < N; i++) if ((wynik[i] as number) > prog) top.push(i)
  for (let i = 0; i < N && top.length < TOP; i++) if (wynik[i] === prog) top.push(i)
  const warstwy = METAS.filter(
    (m) => (u.wagi[m.id] ?? 0) > 0 && kierunekEfektywny(m, u.kierunki) !== null,
  ).length
  return { wynik, top: Uint32Array.from(top), rozrzut: p(0.9) - p(0.1), warstwy }
}

const pamiec = new Map<string, Przebieg>()
/** Wynik dla tabeli (albo samego profilu przy braku potrzeb), z pamięci. */
function licz(nazwa: string, m: Modul, persona: PersonaId | null, ids: readonly string[]) {
  const klucz = ids.length ? `${nazwa}|${persona}|${[...ids].sort().join(',')}` : `-|${persona}`
  let w = pamiec.get(klucz)
  if (!w) {
    w = przebieg(
      ids.length
        ? m.wagiZeZrozumienia(zrozumienie(m, persona, ids), TRYB, METAS, baza(null))
        : baza(persona),
    )
    pamiec.set(klucz, w)
  }
  return w
}

function mediana(xs: readonly number[]): number {
  const s = xs.filter((x) => !Number.isNaN(x)).sort((a, b) => a - b)
  if (s.length === 0) return Number.NaN
  const m = s.length >> 1
  return s.length % 2 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2
}

function miaraTop(top: Uint32Array, m: Miara): number {
  const w = PO_ID.get(m.id)
  if (!w) return Number.NaN
  const xs: number[] = []
  for (const i of top) {
    const v = w.wartosci[i]
    if (v !== null && v !== undefined && !Number.isNaN(v)) xs.push(v)
  }
  if (m.powyzej === undefined) return mediana(xs)
  const prog = m.powyzej
  return xs.length ? (100 * xs.filter((x) => x > prog).length) / xs.length : Number.NaN
}

const sredniaTop = (wynik: Float32Array, top: Uint32Array) => {
  let s = 0
  for (const i of top) s += wynik[i] as number
  return s / top.length
}
const wspolne = (a: Uint32Array, b: Uint32Array) => {
  const z = new Set(a)
  let n = 0
  for (const i of b) if (z.has(i)) n++
  return n / a.length
}

const f = (x: number, c = 1) => (Number.isNaN(x) ? '–' : x.toFixed(c).replace('.', ','))
const lepsze = (m: Miara, d: number) => (m.lepiej === 'mniej' ? d < 0 : d > 0)
const znak = (m: Miara, d: number) =>
  Number.isNaN(d) || Math.abs(d) < 1e-9 ? '=' : lepsze(m, d) ? '↑' : '↓'
const jednostka = (m: Miara) =>
  m.powyzej === undefined
    ? (PO_ID.get(m.id)?.meta.jednostka ?? '')
    : `% top z > ${String(m.powyzej).replace('.', ',')}`

// ── #182: siła potrzeby i „nie chcę” – przypadki syntetyczne ─────────────────────────────
//
// W starych zbiorach złota prawie nie ma siły ani „nie chcę”, więc mierzymy na własnych
// przypadkach: (a) 7 „nie chcę” × 3 konteksty (profil + typowa potrzeba) – czy top adresów
// odsuwa się od rzeczy niechcianej; (b) 8 potrzeb × siła 1 / 2 / 3 – czy siła 3 przesuwa top
// mocniej niż 1. Bez JEV, deterministycznie. Tylko ta część: `--182` (bez historii git).

const MIARY_NIE: Readonly<Record<string, Miara>> = {
  zycie_nocne_obok: { id: 'zycie_nocne_300m', lepiej: 'mniej', powyzej: 0 },
  turysci: { id: 'noclegi_lozka_300m', lepiej: 'mniej', powyzej: 0 },
  szkola_obok: { id: 'szkola_odleglosc', lepiej: 'wiecej' },
  duza_droga: { id: 'halas_ldwn', lepiej: 'mniej', powyzej: 55 },
  przemysl: { id: 'emitent_odleglosc', lepiej: 'wiecej' },
  imprezy: { id: 'imprezy_obiekty_dni_500m_2025_26', lepiej: 'mniej', powyzej: 0 },
  budowy: { id: 'inwestycje_500m', lepiej: 'mniej' },
}
const KONTEKSTY_182: readonly { persona: PersonaId | null; potrzeby: string[] }[] = [
  { persona: 'rodzina', potrzeby: ['dzieci'] },
  { persona: 'singiel', potrzeby: ['bez_samochodu'] },
  { persona: 'senior', potrzeby: ['zdrowie'] },
]
const SILY_182: readonly { persona: PersonaId | null; potrzeba: string }[] = [
  { persona: 'rodzina', potrzeba: 'dzieci' },
  { persona: null, potrzeba: 'pies' },
  { persona: null, potrzeba: 'zielen' },
  { persona: null, potrzeba: 'powietrze' },
  { persona: 'singiel', potrzeba: 'bez_samochodu' },
  { persona: 'senior', potrzeba: 'zdrowie' },
  { persona: 'singiel', potrzeba: 'rower' },
  { persona: null, potrzeba: 'cisza' },
]

/** Jak `zloz` w opiszSiebie.ts: wagi potrzeb przez siłę, „nie chcę” osobno. */
function przebieg182(
  persona: PersonaId | null,
  ids: readonly string[],
  sily: Readonly<Record<string, nowa.Sila>> = {},
  nieChce: readonly string[] = [],
): Przebieg {
  const z = zrozumienie(nowa, persona, ids)
  for (const id of Object.keys(z.wskazniki)) delete z.wskazniki[id]
  for (const id of ids) {
    const p = nowa.POTRZEBY.find((x) => x.id === id)
    for (const [w, waga] of Object.entries(p?.wskazniki ?? {}))
      z.wskazniki[w] = Math.max(z.wskazniki[w] ?? 0, nowa.wagaZSily(waga, sily[id]))
  }
  return przebieg(nowa.wagiZeZrozumienia({ ...z, sily, nieChce }, TRYB, METAS, baza(null)))
}

function sekcja182() {
  const fm = (x: number) => (Number.isNaN(x) ? '–' : x.toFixed(1).replace('.', ','))
  console.log(
    `\n**4. #182 „nie chcę”: profil + potrzeba → to samo + „nie chcę”** (top ${TOP}; ↑ = dalej od rzeczy niechcianej)\n`,
  )
  console.log(
    '| „Nie chcę” | Wskaźnik | Kontekst | Bez | Z „nie chcę” | Zmiana | Top wspólne z „bez” (%) |',
  )
  console.log('|---|---|---|---|---|---|---|')
  let lepiej = 0
  let gorzej = 0
  for (const [nie, m] of Object.entries(MIARY_NIE))
    for (const k of KONTEKSTY_182) {
      const bez = przebieg182(k.persona, k.potrzeby)
      const z = przebieg182(k.persona, k.potrzeby, {}, [nie])
      const a = miaraTop(bez.top, m)
      const b = miaraTop(z.top, m)
      if (Math.abs(b - a) > 1e-9) lepsze(m, b - a) ? lepiej++ : gorzej++
      console.log(
        `| ${nie} | ${m.id} (${jednostka(m)}) | ${k.persona} + ${k.potrzeby.join(', ')} | ${fm(a)} | ${fm(b)} | ${znak(m, b - a)} ${fm(b - a)} | ${Math.round(100 * wspolne(bez.top, z.top))} |`,
      )
    }
  console.log(
    `\nPrzypadków: ${Object.keys(MIARY_NIE).length * KONTEKSTY_182.length}; lepiej ${lepiej}, gorzej ${gorzej}, bez zmiany reszta.\n`,
  )

  console.log(
    '**5. #182 siła: profil → profil + potrzeba z siłą 1 / 2 / 3** (zmiana wskaźnika względem samego profilu)\n',
  )
  console.log('| Potrzeba | Wskaźnik | Profil | Siła 1 | Siła 2 | Siła 3 | 3 mocniej niż 1? |')
  console.log('|---|---|---|---|---|---|---|')
  let mocniej = 0
  let wszystkie = 0
  for (const s of SILY_182)
    for (const m of MIARY[s.potrzeba] ?? []) {
      const profil = miaraTop(przebieg182(s.persona, []).top, m)
      const d = ([1, 2, 3] as const).map(
        (sila) =>
          miaraTop(przebieg182(s.persona, [s.potrzeba], { [s.potrzeba]: sila }).top, m) - profil,
      ) as [number, number, number]
      // „Mocniej” = siła 3 przesuwa we właściwą stronę co najmniej tyle, co siła 1.
      const dobrze = (x: number) => (m.lepiej === 'mniej' ? -x : x)
      const ok = dobrze(d[2]) >= dobrze(d[0]) - 1e-9
      wszystkie++
      if (ok) mocniej++
      console.log(
        `| ${s.potrzeba} | ${m.id} (${jednostka(m)}) | ${s.persona ?? PERSONA_DOMYSLNA} | ${znak(m, d[0])} ${fm(d[0])} | ${znak(m, d[1])} ${fm(d[1])} | ${znak(m, d[2])} ${fm(d[2])} | ${ok ? 'tak' : 'nie'} |`,
      )
    }
  console.log(`\nSiła 3 co najmniej tak mocno jak 1: ${mocniej} / ${wszystkie}.`)
}
const tylko182 = argv.includes('--182')
if (tylko182) {
  sekcja182()
  process.exit(0)
}

// ── Stara tabela z BAZA ───────────────────────────────────────────────────────────────────

const tymczasowy = new URL('_spelnienie_stare_opiszSiebie.ts', AI)
writeFileSync(
  tymczasowy,
  execFileSync('git', ['show', `${BAZA}:src/ai/opiszSiebie.ts`], {
    cwd: KORZEN,
    encoding: 'utf8',
  }),
)
let stara: Modul
try {
  stara = (await import(tymczasowy.href)) as Modul
} finally {
  rmSync(tymczasowy)
}
/** Stara tabela, bieżące składanie (kierunki bieżącej tabeli przy wadze 0 nic nie robią). */
const sklad: Modul = { POTRZEBY: stara.POTRZEBY, wagiZeZrozumienia: nowa.wagiZeZrozumienia }
const TABELE = { stara, sklad, nowa } as const
type Tabela = keyof typeof TABELE
const WARIANTY = ['profil', 'stara', 'sklad', 'nowa'] as const
type Wariant = (typeof WARIANTY)[number]

// ── Pomiar ────────────────────────────────────────────────────────────────────────────────

const przebiegi = (p: Pozycja): Record<Wariant, Przebieg> => ({
  profil: licz('-', nowa, p.persona, []),
  stara: licz('stara', stara, p.persona, p.potrzeby),
  sklad: licz('sklad', sklad, p.persona, p.potrzeby),
  nowa: licz('nowa', nowa, p.persona, p.potrzeby),
})

if (argv.includes('--syntetyczne')) {
  console.log(
    `#183 – przypadki syntetyczne: ${SYNTETYCZNE.length}, adresy: ${N}, top: ${TOP}. Efekt krańcowy nowej potrzeby (bieżąca tabela i składanie). ↑ = lepiej dla potrzeby.\n`,
  )
  console.log(
    '| Przypadek | Profil | Potrzeby bazowe | Nowa | Wskaźnik | Bez | Z nową | Zmiana | Top wspólne (%) |',
  )
  console.log('|---|---|---|---|---|---|---|---|---|')
  const zbiorczo = new Map<string, number[]>()
  for (const c of SYNTETYCZNE) {
    const bez = licz('nowa', nowa, c.persona, c.bazowe)
    const z = licz('nowa', nowa, c.persona, [...c.bazowe, c.nowa])
    for (const m of MIARY[c.nowa] ?? []) {
      const a = miaraTop(bez.top, m)
      const b = miaraTop(z.top, m)
      const klucz = `${c.nowa}|${m.id}`
      zbiorczo.set(klucz, [...(zbiorczo.get(klucz) ?? []), b - a])
      console.log(
        `| ${c.id} | ${c.persona ?? 'domyślny'} | ${c.bazowe.join(', ') || '–'} | ${c.nowa} | ${m.id} (${jednostka(m)}) | ${f(a)} | ${f(b)} | ${znak(m, b - a)} ${f(b - a)} | ${f(100 * wspolne(bez.top, z.top), 0)} |`,
      )
    }
  }
  console.log(
    '\n| Nowa potrzeba | Wskaźnik | Mediana zmiany | Przypadki lepiej / gorzej / bez zmian |',
  )
  console.log('|---|---|---|---|')
  for (const [klucz, zmiany] of zbiorczo) {
    const [potrzeba, id] = klucz.split('|') as [string, string]
    const m = (MIARY[potrzeba] ?? []).find((x) => x.id === id) as Miara
    const d = mediana(zmiany)
    const ok = zmiany.filter((z) => Math.abs(z) > 1e-9 && lepsze(m, z)).length
    const zle = zmiany.filter((z) => Math.abs(z) > 1e-9 && !lepsze(m, z)).length
    console.log(
      `| ${potrzeba} | ${id} (${jednostka(m)}) | ${znak(m, d)} ${f(d)} | ${ok} / ${zle} / ${zmiany.length - ok - zle} |`,
    )
  }
  process.exit(0)
}

const wiersze = POZYCJE.map((p) => ({ p, w: przebiegi(p) }))

console.log(
  `Opisy z potrzebami: ${POZYCJE.length} (zbiór wzorcowy + kontrolne nr 1–7), adresy: ${N}, top: ${TOP}. ` +
    '↑ = lepiej dla potrzeby, ↓ = gorzej.\n',
)
console.log('**1. Profil → profil + wszystkie potrzeby opisu** (mediana po opisach z potrzebą)\n')
console.log(
  '| Potrzeba | Opisów | Wskaźnik | Profil | Stara | Stara tabela, nowe składanie | Nowa | Stara − profil | Nowa − profil |',
)
console.log('|---|---|---|---|---|---|---|---|---|')
for (const [potrzeba, miary] of Object.entries(MIARY)) {
  const moje = wiersze.filter((x) => x.p.potrzeby.includes(potrzeba))
  if (moje.length === 0) continue // #183: nowe potrzeby nie mają jeszcze złota w zbiorach 1–7
  for (const m of miary) {
    const [a, b, s, c] = WARIANTY.map((v) => mediana(moje.map((x) => miaraTop(x.w[v].top, m))))
    console.log(
      `| ${potrzeba} | ${moje.length} | ${m.id} (${jednostka(m)}) | ${f(a as number)} | ${f(b as number)} | ${f(s as number)} | ${f(c as number)} | ${znak(m, (b as number) - (a as number))} ${f((b as number) - (a as number))} | ${znak(m, (c as number) - (a as number))} ${f((c as number) - (a as number))} |`,
    )
  }
}

console.log(
  '\n**2. Efekt krańcowy: ten sam opis bez potrzeby → z potrzebą** (mediana zmiany; opisy lepiej / gorzej)\n',
)
console.log('| Potrzeba | Wskaźnik | Stara | Stara tabela, nowe składanie | Nowa |')
console.log('|---|---|---|---|---|')
for (const [potrzeba, miary] of Object.entries(MIARY)) {
  const moje = POZYCJE.filter((p) => p.potrzeby.includes(potrzeba))
  if (moje.length === 0) continue
  for (const m of miary) {
    const kolumna = (t: Tabela) => {
      const zmiany = moje.map((p) => {
        const bez = p.potrzeby.filter((x) => x !== potrzeba)
        const przed = miaraTop(licz(t, TABELE[t], p.persona, bez).top, m)
        return miaraTop(licz(t, TABELE[t], p.persona, p.potrzeby).top, m) - przed
      })
      const d = mediana(zmiany)
      const ok = zmiany.filter((z) => !Number.isNaN(z) && Math.abs(z) > 1e-9 && lepsze(m, z))
      const zle = zmiany.filter((z) => !Number.isNaN(z) && Math.abs(z) > 1e-9 && !lepsze(m, z))
      return `${znak(m, d)} ${f(d)} (${ok.length} / ${zle.length})`
    }
    console.log(
      `| ${potrzeba} | ${m.id} (${jednostka(m)}) | ${kolumna('stara')} | ${kolumna('sklad')} | ${kolumna('nowa')} |`,
    )
  }
}

console.log('\n**3. Skutki uboczne** (mediana po opisach z potrzebami)\n')
console.log('| | Profil | Stara | Stara tabela, nowe składanie | Nowa |')
console.log('|---|---|---|---|---|')
const kol = (fn: (p: Przebieg, x: (typeof wiersze)[number]) => number, c = 1) =>
  WARIANTY.map((v) => f(mediana(wiersze.map((x) => fn(x.w[v], x))), c)).join(' | ')
console.log(`| Warstwy liczone w wyniku | ${kol((p) => p.warstwy, 0)} |`)
console.log(`| Rozrzut wyników adresów (p90 − p10, pkt) | ${kol((p) => p.rozrzut)} |`)
console.log(
  `| Wynik samego profilu w top ${TOP} (śr., pkt) | ${kol((p, x) => sredniaTop(x.w.profil.wynik, p.top))} |`,
)
console.log(
  `| Top ${TOP} wspólne z top samego profilu (%) | ${kol((p, x) => 100 * wspolne(x.w.profil.top, p.top), 0)} |`,
)
console.log(`\nZestawy wag policzone: ${pamiec.size}.`)

sekcja182()
