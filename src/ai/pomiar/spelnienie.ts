// #177: „czy mapa spełnia potrzebę” – miara bez JEV i bez sieci, deterministyczna.
//
// Użycie (z katalogu repo, potrzebna historia git z BAZA; ok. 40 s):
//   node src/ai/pomiar/spelnienie.ts            # tabele markdown na stdout (do WYNIKI.md)
//   node src/ai/pomiar/spelnienie.ts --top 300  # inny rozmiar „najlepszych adresów” (domyślnie 100)
//   node src/ai/pomiar/spelnienie.ts --syntetyczne  # #183: nowe potrzeby na przypadkach syntetycznych
//   node src/ai/pomiar/spelnienie.ts --182      # tylko tabela 4: „nie chcę” (#182), ok. 6 s
//   node src/ai/pomiar/spelnienie.ts --k8 [--jev]  # #187: zbiór nr 8, etykiety wzorcowe (albo JEV) – kod R0 (#184),
//                                               # R3 z siłą (#182) i bieżący (zamrożony)
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

// ── #182: „nie chcę” – przypadki syntetyczne ─────────────────────────────────────────────
//
// W starych zbiorach złota nie ma „nie chcę”, więc mierzymy na własnych przypadkach: 7 „nie
// chcę” × 3 konteksty (profil + typowa potrzeba) – czy top adresów odsuwa się od rzeczy
// niechcianej. Bez JEV, deterministycznie. Tylko ta część: `--182` (bez historii git).
// #187: tabela 5 (siła 1 / 2 / 3) usunięta razem z siłą potrzeby.

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
/** Jak `zloz` w opiszSiebie.ts: wagi potrzeb z tabeli, „nie chcę” osobno. */
function przebieg182(
  persona: PersonaId | null,
  ids: readonly string[],
  nieChce: readonly string[] = [],
): Przebieg {
  const z = zrozumienie(nowa, persona, ids)
  return przebieg(nowa.wagiZeZrozumienia({ ...z, nieChce }, TRYB, METAS, baza(null)))
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
      const z = przebieg182(k.persona, k.potrzeby, [nie])
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
}
const tylko182 = argv.includes('--182')
if (tylko182) {
  sekcja182()
  process.exit(0)
}

// ── #187: zbiór nr 8 – wzorcowe etykiety, trzy wersje kodu ──────────────────────────────────
//
// Czy strata starych potrzeb na mapie z #184 (+53 / −114 przy wzorcu, z czego +60 / −105 daje
// sama siła) znika po cofnięciu siły? Dla każdego opisu zbioru nr 8 z potrzebą albo „nie chcę”
// liczymy top adresów z WZORCOWYCH etykiet trzema wersjami `opiszSiebie.ts` na tych samych
// danych i tym samym silniku:
//   R0 – `a78589d` (BASE z #184: bez #182 i #183; „nie chcę” i nowych potrzeb nie zna),
//   R3 – `81b6602` (#182 z siłą i „nie chcę” + #183; siła ze wzorca przez `wagaZSily`),
//   F  – bieżący kod (zamrożony, #187: #183 + „nie chcę”, bez siły).
// Wskaźniki spełnienia: MIARY i MIARY_NIE (stała miarka). Pary opis × wskaźnik: lepiej / gorzej
// niż sam profil, a sparowanie wersji pokazuje, która na tej samej parze wypada lepiej
// (dokładny test McNemara). Na silniku sprzed #188 odtwarza co do pary tabelę „Spełnienie na
// mapie” z #184 (wtedy skrypt poza repo, `mapa8.ts`); silnik po #188 daje inne liczby
// (WYNIKI.md, „Zamrożenie (#187)”). `--jev`: etykiety JEV z przebiegów #184 zamiast wzorca.

interface PozycjaK8 {
  id: string
  persona: PersonaId | null
  potrzeby: string[]
  sila: Record<string, number>
  nie_chce: string[]
}
type ModulK8 = Modul & {
  /** Tylko w R3 (#182, cofnięte w #187). */
  wagaZSily?: (waga: number, sila: number | undefined) => number
  NA_NIE?: readonly { id: string }[]
}
const NOWE_183 = new Set(['auto', 'wozek', 'praca_zdalna', 'zycie_nocne', 'sport', 'student'])

async function modulZ(commit: string, nazwa: string): Promise<ModulK8> {
  const plik = new URL(`_spelnienie_${nazwa}_opiszSiebie.ts`, AI)
  writeFileSync(
    plik,
    execFileSync('git', ['show', `${commit}:src/ai/opiszSiebie.ts`], {
      cwd: KORZEN,
      encoding: 'utf8',
    }),
  )
  try {
    return (await import(plik.href)) as ModulK8
  } finally {
    rmSync(plik)
  }
}

/** Zrozumienie ze wzorca tak, jak złożyłby je `zloz` danej wersji (bez chipów). */
function zWzorca(
  m: ModulK8,
  p: PozycjaK8,
  { bezNie = false, bez183 = false }: { bezNie?: boolean; bez183?: boolean } = {},
): nowa.Zrozumienie {
  const znane = p.potrzeby.filter(
    (id) => m.POTRZEBY.some((x) => x.id === id) && !(bez183 && NOWE_183.has(id)),
  )
  const z: nowa.Zrozumienie & { sily?: Record<string, number> } = zrozumienie(m, p.persona, znane)
  const wagaZSily = m.wagaZSily
  if (wagaZSily) {
    for (const id of Object.keys(z.wskazniki)) delete z.wskazniki[id]
    for (const id of znane)
      for (const [w, waga] of Object.entries(m.POTRZEBY.find((x) => x.id === id)?.wskazniki ?? {}))
        z.wskazniki[w] = Math.max(z.wskazniki[w] ?? 0, wagaZSily(waga, p.sila[id]))
    z.sily = Object.fromEntries(znane.map((id) => [id, p.sila[id] as number]))
  }
  if (m.NA_NIE && !bezNie) z.nieChce = p.nie_chce.filter((id) => m.NA_NIE?.some((n) => n.id === id))
  return z
}

function mcnemar(b: number, c: number): number {
  const n = b + c
  if (!n) return 1
  let suma = 0
  let lp = -n * Math.LN2
  for (let i = 0; i <= Math.min(b, c); i++) {
    suma += Math.exp(lp)
    lp += Math.log((n - i) / (i + 1))
  }
  return Math.min(1, 2 * suma)
}
const fp = (x: number) => (x < 0.001 ? '< 0,001' : x.toFixed(3).replace('.', ','))

async function sekcjaK8() {
  const pozycje = (
    JSON.parse(readFileSync(new URL('kontrolny8-opisz.json', POMIAR), 'utf8'))
      .pozycje as PozycjaK8[]
  ).filter((p) => p.potrzeby.length || p.nie_chce.length)
  const r0 = await modulZ('a78589d', 'r0')
  const r3 = await modulZ('81b6602', 'r3')
  const zamrozony = nowa as ModulK8
  type Zr = (p: PozycjaK8) => nowa.Zrozumienie
  const zJev = argv.includes('--jev')
  /**
   * `--jev`: zamiast wzorca zrozumienie JEV z przebiegów #184 (to, co widział użytkownik).
   * R0 i R3 z ich plików; zamrożony z pliku R3 bez siły, z wagami z tabeli – odtworzenie
   * `--przelicz` daje dokładnie to (rozpoznanie identyczne, różnią się tylko `sily` i wagi).
   */
  const zPliku = (plik: string) => {
    const a = JSON.parse(readFileSync(new URL(`przebiegi/${plik}`, POMIAR), 'utf8')).a as {
      id: string
      systemy: { jev_z_zapasem: nowa.Zrozumienie }
    }[]
    const mapa = new Map(a.map((w) => [w.id, w.systemy.jev_z_zapasem]))
    return (p: PozycjaK8) => ({ ...(mapa.get(p.id) as nowa.Zrozumienie), zrozumialem: [] })
  }
  const bezSily =
    (zr: Zr): Zr =>
    (p) => {
      const { sily: _sily, ...z } = zr(p) as nowa.Zrozumienie & { sily?: unknown }
      return { ...z, wskazniki: zrozumienie(zamrozony, null, z.potrzeby).wskazniki }
    }
  // Rozkład wersji zamrożonej (tylko wzorzec): F bez „nie chcę” (= sam #183) i F bez nowych
  // potrzeb (= R0 + „nie chcę”) – ten sam kod i te same dane, inne etykiety.
  const WERSJE: Record<string, { m: ModulK8; zr: Zr }> = zJev
    ? {
        R0: { m: r0, zr: zPliku('k8-r0-184.json') },
        R3: { m: r3, zr: zPliku('k8-r3-184.json') },
        F: { m: zamrozony, zr: bezSily(zPliku('k8-r3-184.json')) },
      }
    : {
        R0: { m: r0, zr: (p) => zWzorca(r0, p) },
        R3: { m: r3, zr: (p) => zWzorca(r3, p) },
        F: { m: zamrozony, zr: (p) => zWzorca(zamrozony, p) },
        'F bez „nie chcę”': { m: zamrozony, zr: (p) => zWzorca(zamrozony, p, { bezNie: true }) },
        'F bez #183': { m: zamrozony, zr: (p) => zWzorca(zamrozony, p, { bez183: true }) },
      }
  type Wersja = string
  const nazwy = Object.keys(WERSJE) as Wersja[]
  interface Para {
    id: string
    grupa: 'stare' | 'nowe' | 'nie'
    sila: number | null
    miara: Miara
    profil: number
    w: Record<Wersja, number>
  }
  const pary: Para[] = []
  const topProfilu = new Map<string, Uint32Array>()
  for (const p of pozycje) {
    const kp = String(p.persona)
    if (!topProfilu.has(kp)) topProfilu.set(kp, przebieg(baza(p.persona)).top)
    const tp = topProfilu.get(kp) as Uint32Array
    const topy = Object.fromEntries(
      nazwy.map((v) => [
        v,
        przebieg(
          (WERSJE[v] as { m: ModulK8; zr: Zr }).m.wagiZeZrozumienia(
            (WERSJE[v] as { m: ModulK8; zr: Zr }).zr(p),
            TRYB,
            METAS,
            baza(null),
          ) as Ustawienia,
        ).top,
      ]),
    ) as Record<Wersja, Uint32Array>
    const dodaj = (id: string, grupa: Para['grupa'], sila: number | null, m: Miara) =>
      pary.push({
        id,
        grupa,
        sila,
        miara: m,
        profil: miaraTop(tp, m),
        w: Object.fromEntries(nazwy.map((v) => [v, miaraTop(topy[v] as Uint32Array, m)])) as Record<
          Wersja,
          number
        >,
      })
    for (const id of p.potrzeby)
      for (const m of MIARY[id] ?? [])
        dodaj(id, NOWE_183.has(id) ? 'nowe' : 'stare', p.sila[id] ?? null, m)
    for (const id of p.nie_chce) {
      const m = MIARY_NIE[id]
      if (m) dodaj(id, 'nie', null, m)
    }
  }
  const zle = (m: Miara, d: number) => Math.abs(d) > 1e-9 && !lepsze(m, d)
  const dobre = (m: Miara, d: number) => Math.abs(d) > 1e-9 && lepsze(m, d)
  const GRUPY = [
    ['stare', 'stare potrzeby'],
    ['nowe', 'nowe potrzeby (#183)'],
    ['nie', '„nie chcę” (#182)'],
  ] as const
  const zbior = (xs: Para[]) => xs.filter((x) => !Number.isNaN(x.profil))

  console.log(
    `#187 – zbiór nr 8, etykiety ${zJev ? 'JEV (przebiegi #184)' : 'wzorcowe'}: ${pozycje.length} opisów z potrzebą albo „nie chcę”, adresy: ${N}, top: ${TOP}.\n`,
  )
  console.log('**Względem samego profilu** (pary opis × wskaźnik: lepiej / gorzej / bez zmiany)\n')
  console.log(`| Grupa | n | ${nazwy.join(' | ')} |`)
  console.log(`|---|---|${nazwy.map(() => '---').join('|')}|`)
  for (const [g, opis] of GRUPY) {
    const xs = zbior(pary.filter((x) => x.grupa === g))
    const kol = (v: Wersja) => {
      const ds = xs.map((x) => (x.w[v] ?? Number.NaN) - x.profil).filter((d) => !Number.isNaN(d))
      const a = xs.filter((x) => dobre(x.miara, (x.w[v] ?? Number.NaN) - x.profil)).length
      const b = xs.filter((x) => zle(x.miara, (x.w[v] ?? Number.NaN) - x.profil)).length
      return `${a} / ${b} / ${ds.length - a - b}`
    }
    console.log(`| ${opis} | ${xs.length} | ${nazwy.map(kol).join(' | ')} |`)
  }
  const sparuj = (xs: Para[], a: Wersja, b: Wersja) => {
    let plus = 0
    let minus = 0
    for (const x of xs) {
      const d = (x.w[b] ?? Number.NaN) - (x.w[a] ?? Number.NaN)
      if (Number.isNaN(d)) continue
      if (dobre(x.miara, d)) plus++
      else if (zle(x.miara, d)) minus++
    }
    return `+${plus} / −${minus}, p = ${fp(mcnemar(plus, minus))}`
  }
  const POROWNANIA = (
    [
      ['R0', 'R3'],
      ['R0', 'F'],
      ['R3', 'F'],
      ['R0', 'F bez „nie chcę”'],
      ['R0', 'F bez #183'],
    ] as const
  ).filter(([a, b]) => a in WERSJE && b in WERSJE)
  console.log(
    '\n**Sparowane** (ta sama para opis × wskaźnik: druga wersja lepiej / gorzej niż pierwsza)\n',
  )
  console.log(`| Grupa | ${POROWNANIA.map(([a, b]) => `${a} → ${b}`).join(' | ')} |`)
  console.log(`|---|${POROWNANIA.map(() => '---').join('|')}|`)
  for (const [g, opis] of GRUPY) {
    const xs = pary.filter((x) => x.grupa === g)
    console.log(`| ${opis} | ${POROWNANIA.map(([a, b]) => sparuj(xs, a, b)).join(' | ')} |`)
  }
  console.log('\n**Stare potrzeby wg siły we wzorcu** (sparowane jak wyżej)\n')
  console.log(`| Siła we wzorcu | n | ${POROWNANIA.map(([a, b]) => `${a} → ${b}`).join(' | ')} |`)
  console.log(`|---|---|${POROWNANIA.map(() => '---').join('|')}|`)
  for (const sila of [1, 2, 3]) {
    const xs = pary.filter((x) => x.grupa === 'stare' && x.sila === sila)
    console.log(
      `| ${sila} | ${xs.length} | ${POROWNANIA.map(([a, b]) => sparuj(xs, a, b)).join(' | ')} |`,
    )
  }
  console.log(
    '\n**Mediana wskaźnika w top po opisach** („nie chcę” i nowe potrzeby; profil i wersje)\n',
  )
  console.log(`| Etykieta | Wskaźnik | Opisów | Profil | ${nazwy.join(' | ')} |`)
  console.log(`|---|---|---|---|${nazwy.map(() => '---').join('|')}|`)
  const klucze = [
    ...new Set(pary.filter((x) => x.grupa !== 'stare').map((x) => `${x.id}|${x.miara.id}`)),
  ]
  for (const k of klucze) {
    const xs = pary.filter((x) => `${x.id}|${x.miara.id}` === k)
    const m = (xs[0] as Para).miara
    const [id] = k.split('|')
    const kol = (fn: (x: Para) => number) => f(mediana(xs.map(fn)))
    console.log(
      `| ${xs[0]?.grupa === 'nie' ? 'nie chcę: ' : ''}${id} | ${m.id} (${jednostka(m)}) | ${xs.length} | ${kol((x) => x.profil)} | ${nazwy.map((v) => kol((x) => x.w[v] ?? Number.NaN)).join(' | ')} |`,
    )
  }
}
if (argv.includes('--k8')) {
  await sekcjaK8()
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
    const [a, b, s, c] = WARIANTY.map((v) =>
      mediana(moje.map((x) => miaraTop((x.w[v] ?? Number.NaN).top, m))),
    )
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
  WARIANTY.map((v) => f(mediana(wiersze.map((x) => fn(x.w[v] ?? Number.NaN, x))), c)).join(' | ')
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
