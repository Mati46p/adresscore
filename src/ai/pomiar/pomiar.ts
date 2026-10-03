// Pomiar JEV po polsku (#18): zbiory wzorcowe (zbior-opisz.json, zbior-zapytaj.json) →
// JEV kontra reguły na tych samych pozycjach. Wyniki i metoda: WYNIKI.md.
//
// Użycie (z katalogu repo):
//   node src/ai/pomiar/pomiar.ts                      # tylko reguły, bez sieci i bez klucza
//   node --env-file=.env.local src/ai/pomiar/pomiar.ts --na-zywo [--tylko a|b] [--wyjscie plik.json]
//   … --zbior kontrolny     # zbiór pisany na ślepo (#147): tylko liczby zbiorcze, bez błędów
//   … --zbior kontrolny2    # drugi zbiór na ślepo (#152), mierzony raz: tak samo, tylko liczby
//   … --zbior kontrolny3    # trzeci zbiór na ślepo (#153), mierzony raz; + przekrój po cechach
//   … --zbior kontrolny4    # czwarty zbiór na ślepo (#157, 40 + 35), mierzony raz; + propozycje #156
//   … --zbior kontrolny5    # piąty zbiór na ślepo (#163), mierzony raz: przed i po w jednym wywołaniu
//   … --zbior kontrolny6    # szósty zbiór na ślepo (#170, 150 + 150), mierzony raz; + przedziały Wilsona
//   … --zbior kontrolny7    # siódmy zbiór na ślepo (#174, 120 + 150): pomiar #172 i #173 osobno
//   … --zbior kontrolny8    # ósmy zbiór na ślepo (#184, 150 opisów, bez B): siła, „nie chcę”,
//                           # nowe potrzeby – pomiar #182 i #183 osobno
//   … --zbior-wlasny a.json b.json  # własne zbiory do strojenia (#163), z błędami pozycja po pozycji
//   … --przed-po <commit> --wyjscie-przed p.json --wyjscie po.json [--wyjscie-proste s.json]
//                           # #163: JEDNO wywołanie na pozycję z pytaniami trzech wersji naraz:
//                           # „przed” (kod z <commit>), „po” (bieżący) i „proste” (bieżący bez
//                           # nie_dla, przykładów i kryteriów prawda/fałsz). Pytania są niezależne
//                           # (dokumentacja TypeSafe), więc to sparowane porównanie za 1/3 ceny.
//   … --tylko-pisane        # bez pozycji naśladujących mowę (MOWIONE niżej) – przekrój pomocniczy
//   … --z-pliku wynik.json  # bez sieci: przelicza zapisany przebieg (--wyjscie) od nowa
//
// Na żywo każda pozycja to JEDNO wywołanie JEV (ok. 58 na przebieg – to kosztuje). Idzie
// tą samą ścieżką co aplikacja: klient (jev.ts, timeout 1,5 s) → pośrednik (api/_jev.js,
// timeout 800 ms) → api.typesafe.ai. Z jednej odpowiedzi liczymy trzy systemy:
//   reguly       – zRegul / regula (bez AI),
//   jev_surowy   – sama odpowiedź JEV (B: wybór bez progu pewności; A: bez reguł zapasowych),
//   jev_z_zapasem – to, co naprawdę widzi użytkownik (JEV z progiem, poniżej progu reguły).
// B liczy też pytania złożone (#146): do 3 warstw na odpowiedź (`wiele`), a z zapisanych ocen
// tematów (noul) przelicza inne progi bez nowych wywołań.
// Klucz czyta tylko pośrednik z process.env; skrypt go nie wypisuje ani nie zapisuje.
// Do pliku wyjścia trafiają wyłącznie wyniki po przetworzeniu (bez surowych odpowiedzi API).
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import type { PlikWskaznika } from '../../kontrakty/index.ts'
import type { OdpowiedzJev, OpcjeKlienta, ZapytanieJev } from '../jev.ts'
import * as opiszTeraz from '../opiszSiebie.ts'
import {
  BRAMKA,
  KATEGORIE_OCENIANE,
  type KategoriaOceniana,
  nicNieZrozumiano,
  POTRZEBY,
  PROG_BRAMKI,
  PUSTE_ZROZUMIENIE,
  type Zrozumienie,
  zRegul,
} from '../opiszSiebie.ts'
import * as zapytajTeraz from '../zapytajOAdres.ts'
import {
  ID_PYTANIA,
  idTematu,
  listaWarstw,
  NIE_WIEM,
  PROG_TEMATU,
  przetworzWiele,
  regula,
  regulaWiele,
  TEMATY,
  type WyborWarstw,
} from '../zapytajOAdres.ts'
import { kategoriaPoWycofaniu, tematyPoWycofaniu, warstwaPoWycofaniu } from './wycofane.ts'

// ── Zbiory ────────────────────────────────────────────────────────────────────────────────

interface PozycjaOpisz {
  id: string
  tekst: string
  cechy?: string[]
  persona: string | null
  persona_tez?: string[]
  nic?: boolean
  potrzeby: string[]
  kategorie_wazne?: string[]
  kategorie_niewazne?: string[]
  /** #184 (zbiór nr 8): siła każdej potrzeby wzorca, 1–3. */
  sila?: Record<string, number>
  /** #184 (zbiór nr 8): rzeczy, których osoba nie chce w pobliżu (id ze słownika #182). */
  nie_chce?: string[]
}
interface PozycjaZapytaj {
  id: string
  pytanie: string
  cechy?: string[]
  tematy: string[][]
}

const argv = process.argv.slice(2)
const iZbior = argv.indexOf('--zbior')
/**
 * `--zbior kontrolny` (#147): zbiór odłożony, pisany na ślepo przez osobnego agenta bez dostępu
 * do kodu. Na nim nic nie stroimy – raport pokazuje tylko liczby zbiorcze (bez tekstów i bez
 * błędów pozycja po pozycji), żeby strojenie go nie widziało.
 */
const NAZWA_ZBIORU = iZbior >= 0 ? argv[iZbior + 1] : undefined
/**
 * `--zbior kontrolny2` (#152): drugi zbiór na ślepo – pisał go inny agent, bez dostępu do kodu,
 * poleceń i zbioru nr 1. Wybór części wersji końcowej patrzył na zbiór nr 1, więc wynik
 * nagłówkowy daje zbiór nr 2, mierzony raz. Raport jak dla `kontrolny`: tylko liczby zbiorcze.
 */
const PLIKI_KONTROLNE: Record<string, { opisz: string; zapytaj?: string }> = {
  kontrolny: { opisz: 'kontrolny-opisz.json', zapytaj: 'kontrolny-zapytaj.json' },
  kontrolny2: { opisz: 'kontrolny2-opisz.json', zapytaj: 'kontrolny2-zapytaj.json' },
  // #153: trzeci zbiór na ślepo, z cechami pułapek (`domownik`, `cudza_sytuacja`,
  // `pies_bez_spaceru`, `dwa_z_tematu`) – raport ma też przekrój po cechach, tylko liczby.
  kontrolny3: { opisz: 'kontrolny3-opisz.json', zapytaj: 'kontrolny3-zapytaj.json' },
  // #157: czwarty zbiór na ślepo, większy (40 opisów, 35 pytań), cechy `profil_glowny`,
  // `profil_niejasny`, `cudza_sytuacja`, `domownik` (A) i `niejednoznaczne`, `zlozone`, `spoza` (B).
  kontrolny4: { opisz: 'kontrolny4-opisz.json', zapytaj: 'kontrolny4-zapytaj.json' },
  // #163: piąty zbiór na ślepo, z cechą `bliska_pomylka` (opcje, które JEV myli) – cel #163.
  kontrolny5: { opisz: 'kontrolny5-opisz.json', zapytaj: 'kontrolny5-zapytaj.json' },
  // #170: szósty zbiór na ślepo, duży (150 opisów, 150 pytań) – wynik z przedziałami Wilsona.
  kontrolny6: { opisz: 'kontrolny6-opisz.json', zapytaj: 'kontrolny6-zapytaj.json' },
  // #174: siódmy zbiór na ślepo (120 opisów, 150 pytań), cechy `lagodne` (#172) i
  // `przypadkowe_slowo` (#173) – cztery osobne przebiegi: bez zmian, każda osobno, obie.
  kontrolny7: { opisz: 'kontrolny7-opisz.json', zapytaj: 'kontrolny7-zapytaj.json' },
  // #184: ósmy zbiór na ślepo, tylko „opisz siebie” (150 opisów) – pola `sila` (1–3)
  // i `nie_chce`, sześć nowych potrzeb (#183); słownik etykiet: etykiety-k8.txt.
  kontrolny8: { opisz: 'kontrolny8-opisz.json' },
}
if (NAZWA_ZBIORU !== undefined && !PLIKI_KONTROLNE[NAZWA_ZBIORU]) {
  console.error(
    `Nieznany zbiór: ${NAZWA_ZBIORU} (znane: ${Object.keys(PLIKI_KONTROLNE).join(', ')})`,
  )
  process.exit(2)
}
const PLIKI = NAZWA_ZBIORU === undefined ? undefined : PLIKI_KONTROLNE[NAZWA_ZBIORU]
const KONTROLNY = PLIKI !== undefined
/** #163: własne zbiory do strojenia (ścieżki), liczone jak zbiór wzorcowy – z błędami. */
const iWlasny = argv.indexOf('--zbior-wlasny')
const WLASNY = iWlasny >= 0 ? { opisz: argv[iWlasny + 1], zapytaj: argv[iWlasny + 2] } : undefined

const KATALOG = new URL('./', import.meta.url)
const czytaj = (plik: string) => JSON.parse(readFileSync(new URL(plik, KATALOG), 'utf8'))
const czytajWlasny = (plik: string | undefined) =>
  plik ? (JSON.parse(readFileSync(plik, 'utf8')).pozycje ?? []) : []
/**
 * Zbiór kontrolny ma ten sam schemat z dwiema różnicami: „spoza zakresu” to `[["nie_wiem"]]`
 * (u nas `[]`), a „nic” nie jest jawne – to profil null i brak potrzeb.
 */
const ZBIOR_A_SUROWY: PozycjaOpisz[] = KONTROLNY
  ? (czytaj(PLIKI.opisz).pozycje as PozycjaOpisz[]).map((p) => ({
      ...p,
      nic: p.nic ?? (p.persona === null && p.potrzeby.length === 0 && !(p.nie_chce ?? []).length),
    }))
  : WLASNY
    ? czytajWlasny(WLASNY.opisz)
    : czytaj('zbior-opisz.json').pozycje
const ZBIOR_B_SUROWY: PozycjaZapytaj[] = KONTROLNY
  ? PLIKI.zapytaj === undefined
    ? [] // #184: zbiór nr 8 ma tylko część A
    : (czytaj(PLIKI.zapytaj).pozycje as PozycjaZapytaj[]).map((p) => ({
        ...p,
        tematy: p.tematy.filter((t) => !(t.length === 1 && t[0] === NIE_WIEM)),
      }))
  : WLASNY
    ? czytajWlasny(WLASNY.zapytaj)
    : czytaj('zbior-zapytaj.json').pozycje

/**
 * #176: zbiory są zamrożone, a #171 wycofał część warstw i kategorię `przyszlosc`. Stare id
 * liczymy jak ich następców (wycofane.ts). Grupa z samymi warstwami wycofanymi bez następcy
 * przepada; pozycja bez żadnej grupy po tej zamianie wypada z liczenia (to nie „spoza zakresu”).
 */
const ZBIOR_A_PELNY: PozycjaOpisz[] = ZBIOR_A_SUROWY.map((p) => ({
  ...p,
  ...(p.kategorie_wazne && { kategorie_wazne: p.kategorie_wazne.map(kategoriaPoWycofaniu) }),
  ...(p.kategorie_niewazne && {
    kategorie_niewazne: p.kategorie_niewazne.map(kategoriaPoWycofaniu),
  }),
}))
const PO_WYCOFANIU = ZBIOR_B_SUROWY.map((p) => ({ p, w: tematyPoWycofaniu(p.tematy) }))
/** Ile pozycji B dotyka #171: ze starym id, z pominiętą grupą, wyłączone z liczenia. */
export const WYCOFANIE_B = {
  zmienione: PO_WYCOFANIU.filter((x) => x.w.zmienione > 0).length,
  zPominietaGrupa: PO_WYCOFANIU.filter((x) => x.w.pominiete > 0).length,
  pominieteGrupy: PO_WYCOFANIU.reduce((acc, x) => acc + x.w.pominiete, 0),
  wylaczone: PO_WYCOFANIU.filter((x) => x.w.tematy.length === 0 && x.w.pominiete > 0).map(
    (x) => x.p.id,
  ),
}
const ZBIOR_B_PELNY: PozycjaZapytaj[] = PO_WYCOFANIU.filter(
  (x) => !(x.w.tematy.length === 0 && x.w.pominiete > 0),
).map(({ p, w }) => ({ ...p, tematy: w.tematy }))

/**
 * #152: pole w aplikacji jest PISANE, nie dyktowane. Pozycje, których pułapka to zjawisko
 * mowy (poprawianie się w pół zdania), są w przekroju „tylko pisane” pomijane. Wybór z cech
 * `sprzecznosc` po przeczytaniu tych pozycji: sprzeczne życzenia („centrum, ale cisza”) da się
 * napisać, więc zostają; zostaje też wszystko, co typowe dla pisania (bez polskich znaków,
 * literówki, slang, cudza sytuacja, hipoteza). Wynik nagłówkowy to zawsze pełny zbiór.
 */
export const MOWIONE: Readonly<Record<string, string>> = {
  'K2-A10': 'samokorekta w pół zdania („nie potrzebuję auta… no dobra, auto mamy”)',
}
const TYLKO_PISANE = argv.includes('--tylko-pisane')
const pisane = (id: string) => !TYLKO_PISANE || !(id in MOWIONE)
const ZBIOR_A = ZBIOR_A_PELNY.filter((p) => pisane(p.id))
const ZBIOR_B = ZBIOR_B_PELNY.filter((p) => pisane(p.id))

const KORZEN = new URL('../../../', import.meta.url)
const katalogWskaznikow = new URL('public/dane/wskazniki/', KORZEN)
const METAS = readdirSync(katalogWskaznikow)
  .filter((f) => f.endsWith('.json'))
  .map(
    (f) => (JSON.parse(readFileSync(new URL(f, katalogWskaznikow), 'utf8')) as PlikWskaznika).meta,
  )
const LISTA = listaWarstw(METAS)

/** Potrzeby, o które pytamy JEV (z twierdzeniem) – na nich porównanie jest uczciwe. */
const POTRZEBY_JEV = new Set(POTRZEBY.filter((p) => p.twierdzenie).map((p) => p.id))

// ── Wywołanie przez pośrednika ────────────────────────────────────────────────────────────

interface Wywolanie {
  ms: number
  odpowiedzi: Record<string, OdpowiedzJev | null> | null
  powod: string | null
  /** #170: nieudane próby przed tą (status: 429, 5xx, `timeout`, `siec`) – ponowione. */
  ponowienia?: string[]
}

/**
 * #170: inne okna wołają JEV równolegle, więc przejściowe błędy (429, 5xx, sieć, timeout
 * pośrednika) ponawiamy z rosnącym odstępem. Nieudana próba nigdy nie liczy się jako odpowiedź
 * (ani jako zapas): liczy się pierwsza udana, a próby nieudane trafiają do `ponowienia`.
 * Czas pozycji to czas udanej próby. Po wyczerpaniu prób zostaje błąd – jak w aplikacji, zapas.
 */
const MAX_PROB = 6
const odstep = (proba: number) => Math.min(30_000, 1000 * 2 ** proba) + Math.random() * 500
const czekaj = (ms: number) => new Promise((r) => setTimeout(r, ms))
/** #170: wszystkie nieudane próby z całego przebiegu (do raportu ryzyka timeoutu). */
const NIEUDANE: { status: string; ms: number }[] = []
let ostatniStatus = 'ok'
const fetchDoJev = (async (url: string | URL | Request, init?: RequestInit) => {
  try {
    const r = await fetch(url, init)
    ostatniStatus = String(r.status)
    return r
  } catch (e) {
    ostatniStatus = (e as Error).name === 'TimeoutError' ? 'timeout' : 'siec'
    throw e
  }
}) as typeof fetch
const przejsciowy = (status: string) =>
  status === '429' || status === 'timeout' || status === 'siec' || Number(status) >= 500

type Posrednik = {
  obsluz: (a: Record<string, unknown>) => Promise<{ status: number; json: unknown }>
  utworzLimiter: (o: Record<string, number>) => unknown
}

let liczbaWywolan = 0

async function klientNaZywo(): Promise<{
  opcje: () => OpcjeKlienta
  ostatnie: () => Wywolanie
  /** #153: wszystkie wywołania od początku (pytanie może mieć dwa). */
  wszystkie: () => readonly Wywolanie[]
}> {
  // Ścieżka w zmiennej – TS nie typuje pliku JS, a i tak wołamy tylko dwie funkcje.
  const sciezka = new URL('api/_jev.js', KORZEN).href
  const { obsluz, utworzLimiter } = (await import(sciezka)) as Posrednik
  const limiter = utworzLimiter({ oknoMs: 60_000, naIp: 1000, naInstancje: 1000 })
  let ostatnie: Wywolanie = { ms: 0, odpowiedzi: null, powod: 'brak' }
  const wszystkie: Wywolanie[] = []
  const fetchPrzezPosrednika = (async (_url: string | URL | Request, init?: RequestInit) => {
    const ponowienia: string[] = []
    for (let proba = 0; ; proba++) {
      ostatniStatus = 'ok'
      const t0 = performance.now()
      liczbaWywolan++
      const r = await obsluz({
        metoda: 'POST',
        cialo: JSON.parse(String(init?.body)),
        ip: 'pomiar',
        env: process.env,
        limiter,
        fetch: fetchDoJev,
      })
      const ms = Math.round(performance.now() - t0)
      const json = r.json as { odpowiedzi?: Wywolanie['odpowiedzi']; powod?: string | null }
      const nieudana = json.powod === 'blad' && przejsciowy(ostatniStatus)
      if (nieudana && proba + 1 < MAX_PROB) {
        ponowienia.push(ostatniStatus)
        NIEUDANE.push({ status: ostatniStatus, ms })
        process.stderr.write(`  ponowienie po ${ostatniStatus} (${ms} ms)\n`)
        await czekaj(odstep(proba))
        continue
      }
      ostatnie = {
        ms,
        odpowiedzi: json.odpowiedzi ?? null,
        powod: json.powod ?? null,
        ...(ponowienia.length && { ponowienia }),
      }
      wszystkie.push(ostatnie)
      return new Response(JSON.stringify(r.json), { status: r.status })
    }
  }) as typeof fetch
  return {
    opcje: () => ({ fetch: fetchPrzezPosrednika }),
    ostatnie: () => ostatnie,
    wszystkie: () => wszystkie,
  }
}

type Klient = Awaited<ReturnType<typeof klientNaZywo>>

/** Kod, który buduje zapytania i przetwarza odpowiedzi (#163: bieżący albo z innego commitu). */
interface Modul {
  opisz: Pick<
    typeof opiszTeraz,
    'opiszSiebie' | 'przetworzOdpowiedzi' | 'bramkaZamknieta' | 'zapytanieOpiszSiebie'
  >
  zapytaj: Pick<typeof zapytajTeraz, 'wybierzWarstwy' | 'zapytanieJev'>
  lista: ReturnType<typeof listaWarstw>
}
const MODUL_TERAZ: Modul = { opisz: opiszTeraz, zapytaj: zapytajTeraz, lista: LISTA }

/**
 * #163: kod z innego commitu (np. `main` przed zmianą) – pliki wyciągnięte z repozytorium obok
 * bieżących (te same importy względne), tak jak w `zgodnosc147.ts`. Pliki tymczasowe znikają
 * na końcu przebiegu.
 */
const TYMCZASOWE: URL[] = []
async function modulZCommitu(commit: string): Promise<Modul> {
  const pokaz = (sciezka: string) =>
    execFileSync('git', ['show', `${commit}:${sciezka}`], {
      cwd: KORZEN,
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
    })
  const AI = new URL('../', import.meta.url)
  const plik = (nazwa: string) => {
    const u = new URL(`_przed_${nazwa}`, AI)
    writeFileSync(u, pokaz(`src/ai/${nazwa}`))
    TYMCZASOWE.push(u)
    return u
  }
  const opisz = (await import(plik('opiszSiebie.ts').href)) as typeof opiszTeraz
  const zapytaj = (await import(plik('zapytajOAdres.ts').href)) as typeof zapytajTeraz
  return { opisz, zapytaj, lista: zapytaj.listaWarstw(METAS) }
}

/** #163: wersja „proste” – bieżące opisy bez `nie_dla`, przykładów i kryteriów prawda/fałsz. */
export function bezStruktury(z: ZapytanieJev): ZapytanieJev {
  const pytania: ZapytanieJev['pytania'] = {}
  for (const [id, p] of Object.entries(z.pytania)) {
    if (p.typ === 'noul') pytania[id] = { typ: 'noul', polecenie: p.polecenie }
    else if (p.typ === 'choice')
      pytania[id] = {
        ...p,
        kryteria: Object.fromEntries(
          Object.entries(p.kryteria).map(([k, v]) => [k, typeof v === 'string' ? v : { co: v.co }]),
        ),
      }
    else pytania[id] = p
  }
  return { ...z, pytania }
}

type Wariant = 'po' | 'przed' | 'proste'
const WARIANTY = ['po', 'przed', 'proste'] as const

/**
 * #163: pytania trzech wersji w jednym zapytaniu. Pytanie takie samo jak w „po” zostaje pod swoim
 * id (JEV odpowiada na nie raz), inne dostaje przedrostek (`a_` przed, `b_` proste). Zwraca mapę:
 * wersja → id w wersji → id w zapytaniu.
 */
export function scalWersje(wersje: Record<Wariant, ZapytanieJev>) {
  const rowne = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
  const mapa: Record<Wariant, Record<string, string>> = { po: {}, przed: {}, proste: {} }
  for (const id of Object.keys(wersje.po.pytania)) mapa.po[id] = id
  for (const id of Object.keys(wersje.przed.pytania))
    mapa.przed[id] = rowne(wersje.po.pytania[id], wersje.przed.pytania[id]) ? id : `a_${id}`
  for (const id of Object.keys(wersje.proste.pytania)) {
    const p = wersje.proste.pytania[id]
    mapa.proste[id] = rowne(wersje.po.pytania[id], p)
      ? id
      : rowne(wersje.przed.pytania[id], p)
        ? (mapa.przed[id] as string)
        : `b_${id}`
  }
  return mapa
}

/**
 * #163: klienci trzech wersji na jednym wywołaniu. Pierwsze wywołanie pozycji (opisz: `profil`,
 * zapytaj: `warstwa`) idzie raz, z pytaniami wszystkich wersji; każda wersja dostaje swoje
 * odpowiedzi pod swoimi id. Drugie wywołanie (#153) idzie na żywo, z pamięcią po treści.
 * Czas pierwszego wywołania to czas zapytania z trzema wersjami (większe niż w aplikacji).
 */
async function klienciPrzedPo(przed: Modul) {
  const posrednik = (await import(new URL('api/_jev.js', KORZEN).href)) as {
    sprawdzZapytanie: (c: unknown) => {
      blad?: string
      stan: string
      pytania: Record<string, unknown>
    }
    wolajJev: (
      z: { stan: string; pytania: Record<string, unknown> },
      o: { klucz?: string; timeoutMs?: number },
    ) => Promise<{ odpowiedzi: Wywolanie['odpowiedzi']; powod: string | null }>
  }
  type Pierwsze = {
    ms: number
    powod: string | null
    odp: Record<Wariant, Wywolanie['odpowiedzi']>
  }
  const pierwsze = new Map<string, Pierwsze>()
  const drugie = new Map<string, Wywolanie>()
  const zywy = await klientNaZywo()

  async function pierwszeWywolanie(cialo: ZapytanieJev): Promise<Pierwsze> {
    const opisz = 'profil' in cialo.pytania
    const tekst = cialo.stan
    const po = opisz
      ? opiszTeraz.zapytanieOpiszSiebie(tekst)
      : zapytajTeraz.zapytanieJev(tekst, LISTA)
    const wersje: Record<Wariant, ZapytanieJev> = {
      po,
      przed: opisz
        ? przed.opisz.zapytanieOpiszSiebie(tekst)
        : przed.zapytaj.zapytanieJev(tekst, przed.lista),
      proste: bezStruktury(po),
    }
    // Każda wersja osobno przez walidację pośrednika (limit 16 pytań, długości, pola opisów).
    const api = {} as Record<Wariant, Record<string, unknown>>
    for (const w of WARIANTY) {
      const z = posrednik.sprawdzZapytanie(wersje[w])
      if (z.blad) throw new Error(`Wersja ${w}: ${z.blad}`)
      api[w] = z.pytania
    }
    const mapa = scalWersje(wersje)
    const pytania: Record<string, unknown> = {}
    for (const w of WARIANTY)
      for (const [id, wId] of Object.entries(mapa[w])) pytania[wId] = api[w][id]
    const t0 = performance.now()
    liczbaWywolan++
    const r = await posrednik.wolajJev(
      { stan: tekst.slice(0, 2000), pytania },
      { klucz: process.env.JEV_API_KEY, timeoutMs: 5000 },
    )
    const ms = Math.round(performance.now() - t0)
    const odp = {} as Record<Wariant, Wywolanie['odpowiedzi']>
    for (const w of WARIANTY) {
      const o = r.odpowiedzi
      odp[w] = o
        ? Object.fromEntries(Object.entries(mapa[w]).map(([id, wId]) => [id, o[wId] ?? null]))
        : null
    }
    return { ms, powod: r.powod, odp }
  }

  return (w: Wariant): Klient => {
    let ostatnie: Wywolanie = { ms: 0, odpowiedzi: null, powod: 'brak' }
    const wszystkie: Wywolanie[] = []
    const f = (async (url: string | URL | Request, init?: RequestInit) => {
      const cialo = JSON.parse(String(init?.body)) as ZapytanieJev
      if ('profil' in cialo.pytania || ID_PYTANIA in cialo.pytania) {
        const klucz = `${'profil' in cialo.pytania ? 'A' : 'B'}|${cialo.stan}`
        let p = pierwsze.get(klucz)
        if (!p) {
          p = await pierwszeWywolanie(cialo)
          pierwsze.set(klucz, p)
        }
        ostatnie = { ms: p.ms, odpowiedzi: p.odp[w], powod: p.powod }
      } else {
        const klucz = String(init?.body)
        let d = drugie.get(klucz)
        if (!d) {
          await zywy.opcje().fetch?.(url, init)
          d = zywy.ostatnie()
          drugie.set(klucz, d)
        }
        ostatnie = d
      }
      wszystkie.push(ostatnie)
      return new Response(
        JSON.stringify({ odpowiedzi: ostatnie.odpowiedzi, powod: ostatnie.powod }),
        { status: 200 },
      )
    }) as typeof fetch
    return { opcje: () => ({ fetch: f }), ostatnie: () => ostatnie, wszystkie: () => wszystkie }
  }
}

// ── Statystyki ────────────────────────────────────────────────────────────────────────────

const pct = (x: number) => `${(x * 100).toFixed(0)}%`
const srednia = (xs: readonly number[]) =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : Number.NaN
const maks = (xs: readonly number[]) => (xs.length ? Math.max(...xs) : Number.NaN)
function kwantyl(xs: readonly number[], q: number): number {
  const s = [...xs].sort((a, b) => a - b)
  if (!s.length) return Number.NaN
  return s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)] ?? Number.NaN
}

/** #170: 95% przedział Wilsona dla k sukcesów z n (z = 1,96). */
export function wilson(k: number, n: number, z = 1.96): [number, number] {
  if (!n) return [Number.NaN, Number.NaN]
  const p = k / n
  const m = 1 + (z * z) / n
  const srodek = (p + (z * z) / (2 * n)) / m
  const pol = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / m
  return [Math.max(0, srodek - pol), Math.min(1, srodek + pol)]
}

/** #170: dokładny dwustronny test McNemara – b i c to pary niezgodne (tylko A trafia, tylko B). */
export function mcnemar(b: number, c: number): number {
  const n = b + c
  if (!n) return 1
  let suma = 0
  let logP = -n * Math.LN2
  for (let i = 0; i <= Math.min(b, c); i++) {
    suma += Math.exp(logP)
    logP += Math.log((n - i) / (i + 1))
  }
  return Math.min(1, 2 * suma)
}

interface Licznik {
  tp: number
  fp: number
  fn: number
}
const nowyLicznik = (): Licznik => ({ tp: 0, fp: 0, fn: 0 })
function dolicz(l: Licznik, wzorzec: ReadonlySet<string>, wynik: ReadonlySet<string>) {
  for (const x of wynik)
    if (wzorzec.has(x)) l.tp++
    else l.fp++
  for (const x of wzorzec) if (!wynik.has(x)) l.fn++
}
function prf(l: Licznik) {
  const p = l.tp + l.fp ? l.tp / (l.tp + l.fp) : 0
  const r = l.tp + l.fn ? l.tp / (l.tp + l.fn) : 0
  return { p, r, f1: p + r ? (2 * p * r) / (p + r) : 0 }
}
const rowne = (a: ReadonlySet<string>, b: ReadonlySet<string>) =>
  a.size === b.size && [...a].every((x) => b.has(x))

// ── A: opisz siebie ───────────────────────────────────────────────────────────────────────

/** Kategorie ważne wg wzorca: z potrzeb wzorca (tabela POTRZEBY, poziom ≥ 3) + jawne. */
function kategorieWzorca(p: PozycjaOpisz): Set<string> {
  const k = new Set<string>(p.kategorie_wazne ?? [])
  for (const id of p.potrzeby) {
    const potrzeba = POTRZEBY.find((x) => x.id === id)
    for (const [kat, w] of Object.entries(potrzeba?.kategorie ?? {})) if (w >= 3) k.add(kat)
  }
  for (const x of p.kategorie_niewazne ?? []) k.delete(x)
  return k
}
const kategoriePoziom = (z: Zrozumienie, warunek: (poziom: number) => boolean) =>
  new Set(
    (Object.entries(z.kategorie) as [KategoriaOceniana, number][])
      .filter(([, w]) => warunek(w))
      .map(([k]) => k),
  )

interface WynikA {
  id: string
  tekst: string
  wzorzec: { persona: string | null; potrzeby: string[]; nic: boolean }
  systemy: Record<
    string,
    {
      persona: string | null
      potrzeby: string[]
      kategorie: Partial<Record<KategoriaOceniana, number>>
      nic: boolean
    }
  >
  jev?: {
    ms: number
    zrodlo: string
    powod: string | null
    /** Wybór profilu i pewność JEV – przed progiem; #157: z rozkładem (#154), gdy jest. */
    profil: {
      wybor: string
      pewnosc: number | null
      prawdopodobienstwa?: Record<string, number>
    } | null
    /** Ocena twierdzeń (noul 0–1) dla potrzeb z twierdzeniem. */
    noul: Record<string, number | null>
    poziomy: Record<string, number | null>
    /** #153: oceny twierdzeń bramki (noul 0–1), id z BRAMKA. */
    bramka: Record<string, number | null>
    /** #153: bramka zamknięta (profil bez zmian, tylko pewne potrzeby). */
    zamknieta: boolean
    /** #170: nieudane próby przed udaną (ponowione), gdy były. */
    ponowienia?: string[]
  }
}

const zZrozumienia = (z: Zrozumienie) => ({
  persona: z.persona,
  potrzeby: z.potrzeby,
  kategorie: z.kategorie,
  nic: nicNieZrozumiano(z),
})

async function biegA(naZywo: Klient | null, modul: Modul = MODUL_TERAZ): Promise<WynikA[]> {
  const wyniki: WynikA[] = []
  for (const p of ZBIOR_A) {
    const w: WynikA = {
      id: p.id,
      tekst: p.tekst,
      wzorzec: { persona: p.persona, potrzeby: p.potrzeby, nic: Boolean(p.nic) },
      systemy: { reguly: zZrozumienia(zRegul(p.tekst)) },
    }
    if (naZywo) {
      const r = await modul.opisz.opiszSiebie(p.tekst, naZywo.opcje())
      const o = naZywo.ostatnie()
      const odp = o.odpowiedzi
      w.systemy.jev_surowy = zZrozumienia(
        (odp && modul.opisz.przetworzOdpowiedzi(odp)) ?? PUSTE_ZROZUMIENIE,
      )
      w.systemy.jev_z_zapasem = zZrozumienia(r.wynik)
      const profil = odp?.profil
      const noul: Record<string, number | null> = {}
      for (const id of POTRZEBY_JEV) {
        const x = odp?.[`p_${id}`]
        noul[id] = x?.typ === 'noul' ? x.noul : null
      }
      const poziomy: Record<string, number | null> = {}
      for (const k of KATEGORIE_OCENIANE) {
        const x = odp?.[`kat_${k}`]
        poziomy[k] = x?.typ === 'score' ? x.ocena : null
      }
      const bramka: Record<string, number | null> = {}
      for (const x of BRAMKA) {
        const o = odp?.[x.id]
        bramka[x.id] = o?.typ === 'noul' ? o.noul : null
      }
      w.jev = {
        ms: o.ms,
        zrodlo: r.zrodlo,
        powod: r.powod,
        profil:
          profil?.typ === 'choice'
            ? {
                wybor: profil.wybor,
                pewnosc: profil.pewnosc,
                ...(profil.prawdopodobienstwa && { prawdopodobienstwa: profil.prawdopodobienstwa }),
              }
            : null,
        noul,
        poziomy,
        bramka,
        zamknieta: Boolean(odp && modul.opisz.bramkaZamknieta(odp)),
        ...(o.ponowienia && { ponowienia: o.ponowienia }),
      }
      process.stderr.write(`A ${p.id} ${o.ms} ms ${r.zrodlo}\n`)
    }
    wyniki.push(w)
  }
  return wyniki
}

function ocenA(wyniki: readonly WynikA[], system: string) {
  const potrzeby10 = nowyLicznik()
  const potrzebyWszystkie = nowyLicznik()
  const kategorie = nowyLicznik()
  let persona = 0
  let dokladnie = 0
  let nicOk = 0
  let nicN = 0
  let niewazneTrafione = 0
  let niewazneN = 0
  const bledy: { id: string; opis: string }[] = []
  for (const w of wyniki) {
    const s = w.systemy[system]
    if (!s) continue
    const p = ZBIOR_A.find((x) => x.id === w.id) as PozycjaOpisz
    const dopuszczalne = new Set<string | null>([p.persona, ...(p.persona_tez ?? [])])
    const personaOk = dopuszczalne.has(s.persona)
    if (personaOk) persona++
    const wz10 = new Set(p.potrzeby.filter((x) => POTRZEBY_JEV.has(x)))
    const wy10 = new Set(s.potrzeby.filter((x) => POTRZEBY_JEV.has(x)))
    dolicz(potrzeby10, wz10, wy10)
    dolicz(potrzebyWszystkie, new Set(p.potrzeby), new Set(s.potrzeby))
    const z = { ...PUSTE_ZROZUMIENIE, kategorie: s.kategorie }
    dolicz(
      kategorie,
      kategorieWzorca(p),
      kategoriePoziom(z, (x) => x >= 3),
    )
    for (const k of p.kategorie_niewazne ?? []) {
      niewazneN++
      if ((s.kategorie[k as KategoriaOceniana] ?? 2) <= 1) niewazneTrafione++
    }
    if (p.nic) {
      nicN++
      if (s.nic) nicOk++
    }
    const nicZgodne = Boolean(p.nic) === s.nic
    if (personaOk && rowne(wz10, wy10) && nicZgodne) dokladnie++
    else {
      const brak = [...wz10].filter((x) => !wy10.has(x))
      const nadmiar = [...wy10].filter((x) => !wz10.has(x))
      bledy.push({
        id: w.id,
        opis: [
          personaOk ? '' : `profil ${s.persona ?? '–'} zamiast ${p.persona ?? '–'}`,
          brak.length ? `pominięte: ${brak.join(', ')}` : '',
          nadmiar.length ? `nadmiar: ${nadmiar.join(', ')}` : '',
          nicZgodne ? '' : s.nic ? 'nic nie zrozumiał' : 'coś zrozumiał z pustego',
        ]
          .filter(Boolean)
          .join('; '),
      })
    }
  }
  return {
    n: wyniki.length,
    persona: persona / wyniki.length,
    potrzeby10: prf(potrzeby10),
    potrzeby10Licznik: potrzeby10,
    potrzebyWszystkie: prf(potrzebyWszystkie),
    kategorie: prf(kategorie),
    dokladnie: dokladnie / wyniki.length,
    nic: { ok: nicOk, n: nicN },
    niewazne: { ok: niewazneTrafione, n: niewazneN },
    bledy,
  }
}

// ── B: zapytaj o adres ────────────────────────────────────────────────────────────────────

interface WynikB {
  id: string
  pytanie: string
  tematy: string[][]
  systemy: Record<string, string | null>
  /** Pytania złożone (#146): wszystkie pokazane warstwy, w kolejności; [] = „nie wiem”. */
  wiele: Record<string, string[]>
  jev?: {
    ms: number
    zrodlo: string
    powod: string | null
    wybor: string | null
    pewnosc: number | null
    /** Ocena twierdzeń tematów (noul 0–1) – do strojenia progu bez nowych wywołań. */
    tematy: Record<string, number | null>
    /** #153: liczba wywołań na to pytanie (2 = było drugie, po drugi obiekt z tematu). */
    wywolan: number
    /** #153: temat drugiego wywołania albo null. */
    drugie: string | null
    /** #157: rozkład wyboru warstwy z JEV (#154), gdy jest. */
    prawdopodobienstwa?: Record<string, number>
    /** #156: dwie propozycje „Chodziło Ci o…?” (id warstw) albo null – odpowiedź od razu. */
    propozycje: string[] | null
    /** #170: nieudane próby przed udanymi (ponowione), gdy były. */
    ponowienia?: string[]
  }
}

async function biegB(naZywo: Klient | null, modul: Modul = MODUL_TERAZ): Promise<WynikB[]> {
  const wyniki: WynikB[] = []
  for (const p of ZBIOR_B) {
    const w: WynikB = {
      id: p.id,
      pytanie: p.pytanie,
      tematy: p.tematy,
      systemy: { reguly: regula(p.pytanie, LISTA).warstwa },
      wiele: { reguly: regulaWiele(p.pytanie, LISTA).warstwy },
    }
    if (naZywo) {
      // Ta sama ścieżka co zapytajOAdresWiele(), bez wczytywania wartości warstw (#153: z drugim
      // wywołaniem, gdy trzeba). Czas pytania = suma jego wywołań.
      const przed = naZywo.wszystkie().length
      const r = await modul.zapytaj.wybierzWarstwy(p.pytanie, modul.lista, naZywo.opcje())
      const wywolania = naZywo.wszystkie().slice(przed)
      const o = wywolania[0] ?? naZywo.ostatnie()
      const msRazem = wywolania.reduce((acc, x) => acc + x.ms, 0)
      const x = o.odpowiedzi?.[ID_PYTANIA]
      const surowy = x?.typ === 'choice' ? x : null
      w.systemy.jev_surowy = surowy && surowy.wybor !== NIE_WIEM ? surowy.wybor : null
      w.systemy.jev_z_zapasem = r.wynik.warstwy[0] ?? null
      w.wiele.jev_z_zapasem = r.wynik.warstwy
      const tematy: Record<string, number | null> = {}
      for (const t of TEMATY) {
        const n = o.odpowiedzi?.[idTematu(t)]
        tematy[t.id] = n?.typ === 'noul' ? n.noul : null
      }
      w.jev = {
        ms: msRazem,
        zrodlo: r.zrodlo,
        powod: r.powod,
        wybor: surowy?.wybor ?? null,
        pewnosc: surowy?.pewnosc ?? null,
        tematy,
        wywolan: wywolania.length,
        drugie: r.drugie,
        ...(surowy?.prawdopodobienstwa && { prawdopodobienstwa: surowy.prawdopodobienstwa }),
        propozycje: r.wynik.propozycje?.map((x) => x.warstwa) ?? null,
        ...(wywolania.some((x) => x.ponowienia) && {
          ponowienia: wywolania.flatMap((x) => x.ponowienia ?? []),
        }),
      }
      process.stderr.write(
        `B ${p.id} ${msRazem} ms ${r.zrodlo} ×${wywolania.length}${r.wynik.propozycje ? ' propozycje' : ''}\n`,
      )
    }
    wyniki.push(w)
  }
  return wyniki
}

const trafione = (tematy: string[][], wybor: string | null) =>
  tematy.length === 0 ? wybor === null : tematy.some((t) => wybor !== null && t.includes(wybor))

function ocenB(wyniki: readonly WynikB[], system: string) {
  const grupy = { pojedyncze: [0, 0], zlozone: [0, 0], spoza: [0, 0] }
  let ok = 0
  const pokrycia: number[] = []
  const bledy: { id: string; opis: string }[] = []
  for (const w of wyniki) {
    const wybor = w.systemy[system]
    if (wybor === undefined) continue
    const t = trafione(w.tematy, wybor)
    if (t) ok++
    const g =
      w.tematy.length === 0 ? grupy.spoza : w.tematy.length > 1 ? grupy.zlozone : grupy.pojedyncze
    g[1] = (g[1] ?? 0) + 1
    if (t) g[0] = (g[0] ?? 0) + 1
    if (w.tematy.length > 1)
      pokrycia.push(
        w.tematy.filter((x) => wybor !== null && x.includes(wybor)).length / w.tematy.length,
      )
    if (!t)
      bledy.push({
        id: w.id,
        opis: `${wybor ?? 'nie_wiem'} zamiast ${w.tematy.length ? w.tematy.map((x) => x.join('|')).join(' + ') : 'nie_wiem'}`,
      })
  }
  return {
    n: wyniki.length,
    trafnosc: ok / wyniki.length,
    grupy,
    pokrycie: srednia(pokrycia),
    bledy,
  }
}

/**
 * Pytania złożone (#146) na liście warstw: pokrycie tematów złożonych, trafność warstwy
 * głównej na pojedynczych, „nie wiem” bez dodatków spoza zakresu, precyzja dodatków.
 */
export function ocenWiele(
  wyniki: readonly { tematy: string[][]; wiele: Record<string, string[]> }[],
  system: string,
) {
  const w = wyniki.filter((x) => x.wiele[system] !== undefined)
  const wTemacie = (tematy: string[][], warstwa: string) => tematy.some((t) => t.includes(warstwa))
  const pojedyncze = w.filter((x) => x.tematy.length === 1)
  const zlozone = w.filter((x) => x.tematy.length > 1)
  const spoza = w.filter((x) => x.tematy.length === 0)
  const glowna = (x: (typeof w)[number]) => x.wiele[system]?.[0]
  const pokrycia = zlozone.map(
    (x) =>
      x.tematy.filter((t) => (x.wiele[system] ?? []).some((l) => t.includes(l))).length /
      x.tematy.length,
  )
  const zakres = w.filter((x) => x.tematy.length > 0)
  const warstwy = zakres.flatMap((x) => (x.wiele[system] ?? []).map((l) => wTemacie(x.tematy, l)))
  const dodatkiPojedyncze = pojedyncze.flatMap((x) =>
    (x.wiele[system] ?? []).slice(1).map((l) => wTemacie(x.tematy, l)),
  )
  return {
    pojedyncze: [
      pojedyncze.filter((x) => {
        const g = glowna(x)
        return g !== undefined && wTemacie(x.tematy, g)
      }).length,
      pojedyncze.length,
    ],
    pokrycie: srednia(pokrycia),
    zlozoneKomplet: [pokrycia.filter((x) => x === 1).length, zlozone.length],
    spoza: [spoza.filter((x) => (x.wiele[system] ?? []).length === 0).length, spoza.length],
    precyzja: warstwy.length ? warstwy.filter(Boolean).length / warstwy.length : Number.NaN,
    precyzjaKN: [warstwy.filter(Boolean).length, warstwy.length],
    falszyweDodatkiPojedyncze: dodatkiPojedyncze.filter((x) => !x).length,
    pojedynczeZFalszywymDodatkiem: pojedyncze.filter((x) =>
      (x.wiele[system] ?? []).slice(1).some((l) => !wTemacie(x.tematy, l)),
    ).length,
    srednioWarstw: srednia(zakres.map((x) => (x.wiele[system] ?? []).length)),
  }
}

/**
 * #157: dwie propozycje z #156 i pasma pewności wyboru. Przy pewności 0,5–0,9 i rozkładzie z JEV
 * karta pyta „Chodziło Ci o…?” i pokazuje dwie warstwy do kliknięcia. Liczymy to osobno od
 * odpowiedzi od razu: „propozycja zawiera warstwę z wzorca” = któraś z dwóch jest w którymś
 * temacie wzorca (pytanie spoza zakresu z propozycjami to zawsze pudło – wzorcem jest „nie wiem”).
 * „Trafne od razu” = warstwa główna (jak w `ocenB`). „Po kliknięciu” = pytania bez propozycji
 * liczone jak od razu, z propozycjami – czy wśród nich jest warstwa z wzorca.
 */
export function ocenPropozycje(
  wyniki: readonly {
    tematy: string[][]
    systemy: Record<string, string | null>
    jev?: { pewnosc: number | null; propozycje?: string[] | null; wybor?: string | null }
  }[],
) {
  const zJev = wyniki.filter((w) => w.jev)
  const odRazu = (w: (typeof zJev)[number]) => trafione(w.tematy, w.systemy.jev_z_zapasem ?? null)
  const wPropozycji = (w: (typeof zJev)[number]) =>
    w.tematy.length > 0 &&
    (w.jev?.propozycje ?? []).some((l) => w.tematy.some((t) => t.includes(l)))
  const pasmo = (od: number, doo: number, wlacznie: boolean) =>
    zJev.filter((w) => {
      const p = w.jev?.pewnosc
      return p != null && p >= od && (wlacznie ? p <= doo : p < doo)
    })
  const pasma = {
    powyzej: zJev.filter((w) => (w.jev?.pewnosc ?? -1) > 0.9),
    srodek: pasmo(0.5, 0.9, true),
    ponizej: zJev.filter((w) => w.jev?.pewnosc == null || (w.jev.pewnosc ?? 0) < 0.5),
  }
  const zPropozycjami = zJev.filter((w) => w.jev?.propozycje)
  return {
    n: zJev.length,
    pasma: Object.fromEntries(
      Object.entries(pasma).map(([k, xs]) => [
        k,
        {
          n: xs.length,
          odRazu: xs.filter(odRazu).length,
          zPropozycjami: xs.filter((w) => w.jev?.propozycje).length,
        },
      ]),
    ) as Record<keyof typeof pasma, { n: number; odRazu: number; zPropozycjami: number }>,
    propozycje: {
      n: zPropozycjami.length,
      odRazu: zPropozycjami.filter(odRazu).length,
      wPropozycji: zPropozycjami.filter(wPropozycji).length,
      spoza: zPropozycjami.filter((w) => w.tematy.length === 0).length,
    },
    odRazu: zJev.filter(odRazu).length,
    poKliknieciu: zJev.filter((w) => (w.jev?.propozycje ? wPropozycji(w) : odRazu(w))).length,
  }
}

/** Strojenie progu bez nowych wywołań: składa wynik od nowa z zapisanych ocen JEV. */
function przeliczProg(w: WynikB, prog: number): string[] {
  const j = w.jev
  if (!j) return []
  const odp: Record<string, OdpowiedzJev | null> = {
    [ID_PYTANIA]: j.wybor === null ? null : { typ: 'choice', wybor: j.wybor, pewnosc: j.pewnosc },
  }
  for (const t of TEMATY) {
    const n = j.tematy[t.id]
    odp[idTematu(t)] = n === null || n === undefined ? null : { typ: 'noul', noul: n }
  }
  // Pośrednik nie odpowiedział wcale (błąd, timeout) → zapas, jak w aplikacji.
  if (j.powod !== null && j.powod !== 'nieczytelne') return regulaWiele(w.pytanie, LISTA).warstwy
  const r: WyborWarstw | null = przetworzWiele(odp, LISTA, w.pytanie, prog)
  return (r ?? regulaWiele(w.pytanie, LISTA)).warstwy
}

// ── Raport ────────────────────────────────────────────────────────────────────────────────

/** #184: zbiór bez części B (nr 8) – bez pustych sekcji i wierszy B w raporcie. */
export function bezCzesciB(linie: readonly string[]): string[] {
  const out: string[] = []
  let wB = false
  for (const l of linie) {
    if (l.startsWith('## ')) wB = l.startsWith('## B') || l.startsWith('## Przekrój po cechach – B')
    if (!wB && !l.startsWith('| B')) out.push(l)
  }
  return out
}

function raport(a: WynikA[], b: WynikB[], naZywo: boolean) {
  const wszystkie = ['reguly', 'jev_surowy', 'jev_z_zapasem']
  const systemyA = wszystkie.filter((s) => a.some((w) => w.systemy[s]))
  const systemyB = wszystkie.filter((s) => b.some((w) => s in w.systemy))
  const out: string[] = []
  out.push(
    `# Zbiór: ${KONTROLNY ? `${NAZWA_ZBIORU} (na ślepo)` : 'wzorcowy (do strojenia)'}${
      TYLKO_PISANE
        ? `, tylko pisane (bez: ${
            [...ZBIOR_A_PELNY, ...ZBIOR_B_PELNY]
              .filter((p) => !pisane(p.id))
              .map((p) => p.id)
              .join(', ') || '–'
          })`
        : ''
    }`,
    '',
    `## A – opisz siebie (${a.length} pozycji)`,
    '',
  )
  out.push(
    '| system | profil | potrzeby P / R / F1 (10 z twierdzeniem) | potrzeby F1 (wszystkie 15) | kategorie P / R / F1 | dokładnie | „nic” | „obojętne” |',
    '|---|---|---|---|---|---|---|---|',
  )
  const ocenyA = Object.fromEntries(systemyA.map((s) => [s, ocenA(a, s)]))
  for (const s of systemyA) {
    const o = ocenyA[s] as ReturnType<typeof ocenA>
    out.push(
      `| ${s} | ${pct(o.persona)} | ${pct(o.potrzeby10.p)} / ${pct(o.potrzeby10.r)} / ${pct(o.potrzeby10.f1)} | ${pct(o.potrzebyWszystkie.f1)} | ${pct(o.kategorie.p)} / ${pct(o.kategorie.r)} / ${pct(o.kategorie.f1)} | ${pct(o.dokladnie)} | ${o.nic.ok}/${o.nic.n} | ${o.niewazne.ok}/${o.niewazne.n} |`,
    )
  }
  out.push('', `## B – zapytaj o adres (${b.length} pytań)`, '')
  if (WYCOFANIE_B.zmienione > 0)
    out.push(
      `Warstwy wycofane w #171 (mapa: wycofane.ts) – pytania ze starym id liczonym jak następca: ${WYCOFANIE_B.zmienione}; z pominiętą grupą „wycofana bez następcy”: ${WYCOFANIE_B.zPominietaGrupa} (grup: ${WYCOFANIE_B.pominieteGrupy}); wyłączone z liczenia: ${WYCOFANIE_B.wylaczone.length}${KONTROLNY ? '' : WYCOFANIE_B.wylaczone.length ? ` (${WYCOFANIE_B.wylaczone.join(', ')})` : ''}.`,
      '',
    )
  out.push(
    '| system | trafność | pojedyncze | złożone (trafiony 1 temat) | spoza zakresu | pokrycie złożonych |',
    '|---|---|---|---|---|---|',
  )
  const ocenyB = Object.fromEntries(systemyB.map((s) => [s, ocenB(b, s)]))
  for (const s of systemyB) {
    const o = ocenyB[s] as ReturnType<typeof ocenB>
    const g = (x: number[]) => `${x[0]}/${x[1]}`
    out.push(
      `| ${s} | ${pct(o.trafnosc)} | ${g(o.grupy.pojedyncze)} | ${g(o.grupy.zlozone)} | ${g(o.grupy.spoza)} | ${pct(o.pokrycie)} |`,
    )
  }

  out.push(
    '',
    `## B – pytania złożone (#146): do 3 warstw, próg tematu ${PROG_TEMATU}`,
    '',
    '| system | pojedyncze (warstwa główna) | pokrycie złożonych | złożone w komplecie | spoza → „nie wiem” bez dodatków | precyzja warstw | fałszywe dodatki na pojedynczych (pytań) | średnio warstw |',
    '|---|---|---|---|---|---|---|---|',
  )
  const ocenyWiele: Record<string, ReturnType<typeof ocenWiele>> = {}
  const wierszWiele = (nazwa: string, o: ReturnType<typeof ocenWiele>) =>
    `| ${nazwa} | ${o.pojedyncze[0]}/${o.pojedyncze[1]} | ${pct(o.pokrycie)} | ${o.zlozoneKomplet[0]}/${o.zlozoneKomplet[1]} | ${o.spoza[0]}/${o.spoza[1]} | ${pct(o.precyzja)} | ${o.falszyweDodatkiPojedyncze} (${o.pojedynczeZFalszywymDodatkiem}) | ${o.srednioWarstw.toFixed(2)} |`
  for (const s of ['reguly', 'jev_z_zapasem']) {
    if (!b.some((w) => s in w.wiele)) continue
    const o = ocenWiele(b, s)
    ocenyWiele[s] = o
    out.push(wierszWiele(s, o))
  }
  if (naZywo) {
    out.push('', 'Strojenie progu tematu z tych samych odpowiedzi JEV (bez nowych wywołań):', '')
    out.push(
      '| próg | pojedyncze | pokrycie złożonych | złożone w komplecie | spoza | precyzja | fałszywe dodatki (pytań) | średnio warstw |',
      '|---|---|---|---|---|---|---|---|',
    )
    for (const prog of [0.5, 0.6, 0.7, 0.8, 0.9]) {
      const przeliczone = b.map((w) => ({ tematy: w.tematy, wiele: { x: przeliczProg(w, prog) } }))
      out.push(wierszWiele(String(prog), ocenWiele(przeliczone, 'x')))
    }
    if (!KONTROLNY) out.push('', 'Oceny tematów ≥ 0,3 (noul):', '')
    for (const w of KONTROLNY ? [] : b) {
      const t = Object.entries(w.jev?.tematy ?? {})
        .filter(([, v]) => v !== null && v >= 0.3)
        .sort((x, y) => (y[1] ?? 0) - (x[1] ?? 0))
        .map(([k, v]) => `${k} ${v?.toFixed(2)}`)
      out.push(
        `- ${w.id} [${(w.wiele.jev_z_zapasem ?? []).join(', ') || 'nie wiem'}] ${t.join(', ') || '–'}`,
      )
    }
  }

  let podsumowanie: Record<string, unknown> = { oceny: { a: ocenyA, b: ocenyB, wiele: ocenyWiele } }
  if (naZywo) {
    const msA = a.flatMap((w) => (w.jev ? [w.jev.ms] : []))
    const msB = b.flatMap((w) => (w.jev ? [w.jev.ms] : []))
    const ms = [...msA, ...msB]
    const lat = (xs: number[]) => `${kwantyl(xs, 0.5)} / ${kwantyl(xs, 0.95)} / ${maks(xs)} ms`
    const zapasA = a.filter((w) => w.jev?.zrodlo === 'zapas')
    const zapasB = b.filter((w) => w.jev?.zrodlo === 'zapas')
    const powody = (xs: (WynikA | WynikB)[]) =>
      Object.entries(
        xs.reduce<Record<string, number>>((acc, w) => {
          const k = w.jev?.powod ?? '?'
          acc[k] = (acc[k] ?? 0) + 1
          return acc
        }, {}),
      )
        .map(([k, v]) => `${k} ${v}`)
        .join(', ')

    // Kalibracja A: pewność wyboru profilu (przed progiem) na trafnych vs błędnych.
    const profilTrafny: number[] = []
    const profilBledny: number[] = []
    for (const w of a) {
      const p = ZBIOR_A.find((x) => x.id === w.id) as PozycjaOpisz
      const pr = w.jev?.profil
      if (!pr || pr.pewnosc === null) continue
      const wybor = pr.wybor === 'nieznany' ? null : pr.wybor
      const ok = new Set<string | null>([p.persona, ...(p.persona_tez ?? [])]).has(wybor)
      ;(ok ? profilTrafny : profilBledny).push(pr.pewnosc)
    }
    // Kalibracja potrzeb: noul na potrzebach, które są we wzorcu, vs tych, których nie ma.
    const noulTak: number[] = []
    const noulNie: number[] = []
    for (const w of a) {
      const p = ZBIOR_A.find((x) => x.id === w.id) as PozycjaOpisz
      for (const [id, v] of Object.entries(w.jev?.noul ?? {}))
        if (v !== null) (p.potrzeby.includes(id) ? noulTak : noulNie).push(v)
    }
    // Kalibracja B: pewność wyboru warstwy na trafnych vs błędnych (wybór bez progu).
    const warstwaTrafna: number[] = []
    const warstwaBledna: number[] = []
    for (const w of b) {
      if (!w.jev || w.jev.pewnosc === null) continue
      const ok = trafione(w.tematy, w.systemy.jev_surowy ?? null)
      ;(ok ? warstwaTrafna : warstwaBledna).push(w.jev.pewnosc)
    }
    // #157: margines p1 − p2 z rozkładu (#154) na trafnych vs błędnych wyborach warstwy.
    const marginesy = { trafna: [] as number[], bledna: [] as number[] }
    for (const w of b) {
      const pr = w.jev?.prawdopodobienstwa
      if (!w.jev || !pr) continue
      const [p1 = 0, p2 = 0] = Object.values(pr).sort((x, y) => y - x)
      ;(trafione(w.tematy, w.systemy.jev_surowy ?? null)
        ? marginesy.trafna
        : marginesy.bledna
      ).push(p1 - p2)
    }
    const sr = (xs: number[]) => `${srednia(xs).toFixed(2)} (n=${xs.length})`
    out.push(
      '',
      '## JEV: zapas, opóźnienie, kalibracja',
      '',
      `- Wywołań JEV w tym przebiegu: ${liczbaWywolan} (w tym nieudanych i ponowionych: ${NIEUDANE.length}${
        NIEUDANE.length
          ? ` – ${Object.entries(
              NIEUDANE.reduce<Record<string, number>>(
                (acc, x) => ({ ...acc, [x.status]: (acc[x.status] ?? 0) + 1 }),
                {},
              ),
            )
              .map(([k, v]) => `${k} × ${v}`)
              .join(', ')}`
          : ''
      })`,
      `- Pozycje z odpowiedzią JEV (bez błędu wywołania; „nieczytelne” = JEV odpowiedział, ale pod progiem – to zapas wyżej): ${[...a, ...b].filter((w) => w.jev && (w.jev.powod === null || w.jev.powod === 'nieczytelne')).length}/${[...a, ...b].filter((w) => w.jev).length}; pozycje, które potrzebowały ponowienia: ${[...a, ...b].filter((w) => w.jev?.ponowienia).length}`,
      `- Zapas (reguły zamiast JEV) A: ${zapasA.length}/${a.length} (${powody(zapasA) || '–'})`,
      `- Zapas (reguły zamiast JEV) B: ${zapasB.length}/${b.length} (${powody(zapasB) || '–'})`,
      `- Opóźnienie p50 / p95 / max: A ${lat(msA)}; B ${lat(msB)}; razem ${lat(ms)}`,
      `- A, pewność profilu: trafny ${sr(profilTrafny)}, błędny ${sr(profilBledny)}`,
      `- A, noul potrzeb: we wzorcu ${sr(noulTak)}, poza wzorcem ${sr(noulNie)}`,
      ...BRAMKA.map(
        (x) =>
          `- A, bramka „${x.id}” (#153): średnio ${sr(a.flatMap((w) => (w.jev?.bramka?.[x.id] == null ? [] : [w.jev.bramka[x.id] as number])))}, ≥ ${PROG_BRAMKI}: ${a.filter((w) => (w.jev?.bramka?.[x.id] ?? 0) >= PROG_BRAMKI).length}`,
      ),
      `- A, bramka zamknięta: ${a.filter((w) => w.jev?.zamknieta).length}/${a.filter((w) => w.jev).length}`,
      `- B, drugie wywołanie (#153): ${b.filter((w) => (w.jev?.wywolan ?? 0) > 1).length}/${b.filter((w) => w.jev).length} pytań; p50 / max pytań z jednym wywołaniem ${lat(b.flatMap((w) => (w.jev && w.jev.wywolan <= 1 ? [w.jev.ms] : [])))}; z dwoma ${lat(b.flatMap((w) => (w.jev && w.jev.wywolan > 1 ? [w.jev.ms] : [])))}`,
      `- B, pewność warstwy: trafna ${sr(warstwaTrafna)}, błędna ${sr(warstwaBledna)}`,
      `- Rozkład (#154) w odpowiedzi: A profil ${a.filter((w) => w.jev?.profil?.prawdopodobienstwa).length}/${a.filter((w) => w.jev?.profil).length}, B wybór ${b.filter((w) => w.jev?.prawdopodobienstwa).length}/${b.filter((w) => w.jev?.wybor != null).length}`,
      `- B, różnica p1 − p2 rozkładu: trafna ${sr(marginesy.trafna)}, błędna ${sr(marginesy.bledna)}`,
    )
    // #157: dwie propozycje (#156) i pasma pewności wyboru – osobno od odpowiedzi od razu.
    const op = ocenPropozycje(b)
    const ul = (x: number, n: number) => `${x}/${n}${n ? ` (${pct(x / n)})` : ''}`
    out.push(
      '',
      '## B – dwie propozycje (#156) i pasma pewności wyboru',
      '',
      '| pasmo pewności wyboru | pytań | warstwa główna trafna od razu | z propozycjami |',
      '|---|---|---|---|',
      `| > 0,9 (odpowiedź od razu) | ${op.pasma.powyzej.n} | ${ul(op.pasma.powyzej.odRazu, op.pasma.powyzej.n)} | ${op.pasma.powyzej.zPropozycjami} |`,
      `| 0,5–0,9 | ${op.pasma.srodek.n} | ${ul(op.pasma.srodek.odRazu, op.pasma.srodek.n)} | ${op.pasma.srodek.zPropozycjami} |`,
      `| < 0,5 albo brak (reguły + tematy JEV) | ${op.pasma.ponizej.n} | ${ul(op.pasma.ponizej.odRazu, op.pasma.ponizej.n)} | ${op.pasma.ponizej.zPropozycjami} |`,
      '',
      `- Pytania z dwiema propozycjami: ${op.propozycje.n}/${op.n}; w nich warstwa główna trafna od razu ${ul(op.propozycje.odRazu, op.propozycje.n)}, **warstwa z wzorca wśród dwóch propozycji ${ul(op.propozycje.wPropozycji, op.propozycje.n)}**; spoza zakresu z propozycjami: ${op.propozycje.spoza}`,
      `- Cały zbiór B: trafne od razu ${ul(op.odRazu, op.n)}; po kliknięciu właściwej propozycji (gdzie są) ${ul(op.poKliknieciu, op.n)}`,
    )
    podsumowanie.propozycje = op
    podsumowanie = {
      ...podsumowanie,
      wywolan: liczbaWywolan,
      nieudane: NIEUDANE,
      zapas: { a: zapasA.length, b: zapasB.length },
      bramkaZamknieta: a.filter((w) => w.jev?.zamknieta).length,
      drugieWywolanie: b.filter((w) => (w.jev?.wywolan ?? 0) > 1).length,
      opoznienie: {
        a: { p50: kwantyl(msA, 0.5), p95: kwantyl(msA, 0.95), max: maks(msA) },
        b: { p50: kwantyl(msB, 0.5), p95: kwantyl(msB, 0.95), max: maks(msB) },
        razem: { p50: kwantyl(ms, 0.5), p95: kwantyl(ms, 0.95), max: maks(ms) },
      },
      kalibracja: {
        profil: { trafny: srednia(profilTrafny), bledny: srednia(profilBledny) },
        noul: { wzorzec: srednia(noulTak), poza: srednia(noulNie) },
        warstwa: { trafna: srednia(warstwaTrafna), bledna: srednia(warstwaBledna) },
      },
    }
  }
  // #153: przekrój po cechach zbioru (np. `domownik`, `dwa_z_tematu`) – tylko liczby zbiorcze.
  const cechyA = [...new Set(ZBIOR_A.flatMap((p) => p.cechy ?? []))].sort()
  const cechyB = [...new Set(ZBIOR_B.flatMap((p) => p.cechy ?? []))].sort()
  if (cechyA.length) {
    out.push(
      '',
      '## Przekrój po cechach – A (liczby zbiorcze)',
      '',
      '| cecha | n | system | profil | potrzeby P / R / F1 | dokładnie | bramka zamknięta |',
      '|---|---|---|---|---|---|---|',
    )
    for (const c of cechyA) {
      const ids = new Set(ZBIOR_A.filter((p) => p.cechy?.includes(c)).map((p) => p.id))
      const wycinek = a.filter((w) => ids.has(w.id))
      for (const s of systemyA) {
        const o = ocenA(wycinek, s)
        const zamk = s === 'reguly' ? '–' : String(wycinek.filter((w) => w.jev?.zamknieta).length)
        out.push(
          `| ${c} | ${wycinek.length} | ${s} | ${pct(o.persona)} | ${pct(o.potrzeby10.p)} / ${pct(o.potrzeby10.r)} / ${pct(o.potrzeby10.f1)} | ${pct(o.dokladnie)} | ${zamk} |`,
        )
      }
    }
  }
  if (cechyB.length) {
    out.push(
      '',
      '## Przekrój po cechach – B (liczby zbiorcze)',
      '',
      '| cecha | n | system | warstwa główna | pokrycie złożonych | precyzja | fałszywe dodatki (pojedyncze) | średnio warstw | z propozycjami: wzorzec wśród nich | po kliknięciu |',
      '|---|---|---|---|---|---|---|---|---|---|',
    )
    for (const c of cechyB) {
      const ids = new Set(ZBIOR_B.filter((p) => p.cechy?.includes(c)).map((p) => p.id))
      const wycinek = b.filter((w) => ids.has(w.id))
      for (const s of ['reguly', 'jev_z_zapasem']) {
        if (!wycinek.some((w) => s in w.wiele)) continue
        const o = ocenB(wycinek, s)
        const m = ocenWiele(wycinek, s)
        const op = s === 'reguly' ? null : ocenPropozycje(wycinek)
        out.push(
          `| ${c} | ${wycinek.length} | ${s} | ${pct(o.trafnosc)} | ${Number.isNaN(m.pokrycie) ? '–' : pct(m.pokrycie)} | ${Number.isNaN(m.precyzja) ? '–' : pct(m.precyzja)} | ${m.falszyweDodatkiPojedyncze} | ${m.srednioWarstw.toFixed(2)} | ${op ? `${op.propozycje.wPropozycji}/${op.propozycje.n}` : '–'} | ${op ? `${op.poKliknieciu}/${op.n}` : '–'} |`,
        )
      }
    }
  }

  // #170: 95% przedziały Wilsona dla miar, które są proporcją pozycji, i porównanie sparowane
  // JEV vs reguły (pary niezgodne, dokładny test McNemara). Pokrycie złożonych to średnia
  // ułamków, a nie proporcja pozycji – bez przedziału. P/R potrzeb i precyzja warstw liczą
  // potrzeby/warstwy, nie pozycje (kilka na pozycję), więc ich przedział jest przybliżony.
  const przedzialy: Record<string, unknown> = {}
  {
    const jev = 'jev_z_zapasem'
    const kn = (k: number, n: number) => {
      const [d, g] = wilson(k, n)
      return n ? `${k}/${n} = ${pct(k / n)} [${pct(d)}–${pct(g)}]` : '–'
    }
    const trafneA = (s: string) => {
      const persona = new Set<string>()
      for (const w of a) {
        const x = w.systemy[s]
        const p = ZBIOR_A.find((y) => y.id === w.id) as PozycjaOpisz
        if (x && new Set<string | null>([p.persona, ...(p.persona_tez ?? [])]).has(x.persona))
          persona.add(w.id)
      }
      const bledne = new Set(ocenA(a, s).bledy.map((e) => e.id))
      const dokladnie = new Set(a.filter((w) => w.systemy[s] && !bledne.has(w.id)).map((w) => w.id))
      return { persona, dokladnie }
    }
    const trafneB = (s: string, xs: readonly WynikB[] = b) =>
      new Set(
        xs
          .filter((w) => s in w.systemy && trafione(w.tematy, w.systemy[s] ?? null))
          .map((w) => w.id),
      )
    const pary = (r: Set<string>, j: Set<string>) => {
      const tylkoJ = [...j].filter((x) => !r.has(x)).length
      const tylkoR = [...r].filter((x) => !j.has(x)).length
      return { tylkoJev: tylkoJ, tylkoReguly: tylkoR, p: mcnemar(tylkoJ, tylkoR) }
    }
    const wiersze: {
      miara: string
      r: [number, number]
      j?: [number, number]
      p?: ReturnType<typeof pary>
    }[] = []
    const maJevA = a.some((w) => w.systemy[jev])
    const maJevB = b.some((w) => jev in w.systemy)
    const rA = trafneA('reguly')
    const jA = maJevA ? trafneA(jev) : null
    wiersze.push(
      {
        miara: 'A: profil trafiony',
        r: [rA.persona.size, a.length],
        ...(jA && {
          j: [jA.persona.size, a.length] as [number, number],
          p: pary(rA.persona, jA.persona),
        }),
      },
      {
        miara: 'A: cały opis dokładnie',
        r: [rA.dokladnie.size, a.length],
        ...(jA && {
          j: [jA.dokladnie.size, a.length] as [number, number],
          p: pary(rA.dokladnie, jA.dokladnie),
        }),
      },
    )
    const lA = (s: string) => ocenyA[s]?.potrzeby10Licznik
    const rl = lA('reguly') as Licznik
    const jl = lA(jev)
    wiersze.push(
      {
        miara: 'A: potrzeby – precyzja (potrzeb, przybliżony)',
        r: [rl.tp, rl.tp + rl.fp],
        ...(jl && { j: [jl.tp, jl.tp + jl.fp] as [number, number] }),
      },
      {
        miara: 'A: potrzeby – pełność (potrzeb, przybliżony)',
        r: [rl.tp, rl.tp + rl.fn],
        ...(jl && { j: [jl.tp, jl.tp + jl.fn] as [number, number] }),
      },
    )
    const rB = trafneB('reguly')
    const jB = maJevB ? trafneB(jev) : null
    wiersze.push({
      miara: 'B: trafna warstwa główna od razu (albo „nie wiem”)',
      r: [rB.size, b.length],
      ...(jB && { j: [jB.size, b.length] as [number, number], p: pary(rB, jB) }),
    })
    for (const [nazwa, filtr] of [
      ['B: pojedyncze – warstwa główna', (w: WynikB) => w.tematy.length === 1],
      ['B: złożone – trafiony choć jeden temat', (w: WynikB) => w.tematy.length > 1],
      ['B: spoza zakresu → „nie wiem”', (w: WynikB) => w.tematy.length === 0],
    ] as const) {
      const xs = b.filter(filtr)
      const r = trafneB('reguly', xs)
      const j = maJevB ? trafneB(jev, xs) : null
      wiersze.push({
        miara: nazwa,
        r: [r.size, xs.length],
        ...(j && { j: [j.size, xs.length] as [number, number], p: pary(r, j) }),
      })
    }
    const wr = ocenyWiele.reguly
    const wj = ocenyWiele[jev]
    if (wr)
      wiersze.push(
        {
          miara: 'B: złożone z kompletem tematów',
          r: wr.zlozoneKomplet as [number, number],
          ...(wj && { j: wj.zlozoneKomplet as [number, number] }),
        },
        {
          miara: 'B: precyzja warstw (warstw, przybliżony)',
          r: wr.precyzjaKN as [number, number],
          ...(wj && { j: wj.precyzjaKN as [number, number] }),
        },
      )
    if (naZywo && maJevB) {
      const op = ocenPropozycje(b)
      wiersze.push(
        {
          miara: 'B: po kliknięciu właściwej propozycji (#156, górna granica)',
          r: [rB.size, b.length],
          j: [op.poKliknieciu, op.n],
        },
        {
          miara: 'B: z propozycjami – wzorzec wśród dwóch',
          r: [0, 0],
          j: [op.propozycje.wPropozycji, op.propozycje.n],
        },
      )
    }
    out.push(
      '',
      '## Przedziały ufności 95% (Wilson) i porównanie sparowane (#170)',
      '',
      '| miara | reguły | JEV | pary niezgodne: tylko JEV / tylko reguły | p (McNemar, dokładny) |',
      '|---|---|---|---|---|',
    )
    for (const w of wiersze) {
      out.push(
        `| ${w.miara} | ${w.r[1] ? kn(...w.r) : '–'} | ${w.j ? kn(...w.j) : '–'} | ${w.p ? `${w.p.tylkoJev} / ${w.p.tylkoReguly}` : '–'} | ${w.p ? (w.p.p < 0.001 ? '< 0,001' : w.p.p.toFixed(3)) : '–'} |`,
      )
      przedzialy[w.miara] = {
        reguly: { k: w.r[0], n: w.r[1], ci: wilson(...w.r) },
        ...(w.j && { jev: { k: w.j[0], n: w.j[1], ci: wilson(...w.j) } }),
        ...(w.p && { pary: w.p }),
      }
    }
  }
  podsumowanie.przedzialy = przedzialy

  if (KONTROLNY) {
    out.push('', 'Zbiór kontrolny: bez błędów pozycja po pozycji (nie stroimy na nim).')
    return { tekst: (b.length ? out : bezCzesciB(out)).join('\n'), podsumowanie }
  }
  out.push('', '## Błędy', '')
  for (const s of wszystkie) {
    if (!ocenyA[s] && !ocenyB[s]) continue
    out.push(`### ${s}`, '')
    for (const e of ocenyA[s]?.bledy ?? []) out.push(`- ${e.id}: ${e.opis}`)
    for (const e of ocenyB[s]?.bledy ?? []) out.push(`- ${e.id}: ${e.opis}`)
    out.push('')
  }
  return { tekst: out.join('\n'), podsumowanie }
}

// ── Start ─────────────────────────────────────────────────────────────────────────────────

const iZPliku = argv.indexOf('--z-pliku')
const zPliku = iZPliku >= 0 ? argv[iZPliku + 1] : undefined
const naZywo = argv.includes('--na-zywo') && !zPliku
const iWyjscie = argv.indexOf('--wyjscie')
const wyjscie = iWyjscie >= 0 ? argv[iWyjscie + 1] : undefined

if (naZywo && !process.env.JEV_API_KEY) {
  console.error(
    '--na-zywo wymaga JEV_API_KEY (node --env-file=.env.local …). Bez flagi: same reguły.',
  )
  process.exit(2)
}
const iTylko = argv.indexOf('--tylko')
const tylko = iTylko >= 0 ? argv[iTylko + 1] : undefined
// --z-pliku: zapisany przebieg (bez sieci), tylko pozycje bieżącego zbioru (np. tylko pisane).
const zapisany = zPliku
  ? (JSON.parse(readFileSync(zPliku, 'utf8')) as { a: WynikA[]; b: WynikB[] })
  : null
const idsA = new Set(ZBIOR_A.map((p) => p.id))
const idsB = new Set(ZBIOR_B.map((p) => p.id))

/**
 * #176: zapisany przebieg sprzed #171 ma stare id po obu stronach. Wzorzec bierzemy z bieżącego
 * zbioru (już po wycofaniu), a odpowiedzi systemów zamieniamy na następców (wycofane.ts) –
 * inaczej stara odpowiedź `powodz_1proc` nie trafiłaby w grupę `powodz_10proc`.
 */
const TEMATY_ZBIORU = new Map(ZBIOR_B.map((p) => [p.id, p.tematy]))
const bezPowtorzen = (xs: readonly string[]) => [...new Set(xs)]
function zapisanyBPoWycofaniu(w: WynikB): WynikB {
  return {
    ...w,
    tematy: TEMATY_ZBIORU.get(w.id) ?? w.tematy,
    systemy: Object.fromEntries(
      Object.entries(w.systemy).map(([s, x]) => [s, warstwaPoWycofaniu(x)]),
    ),
    wiele: Object.fromEntries(
      Object.entries(w.wiele).map(([s, xs]) => [
        s,
        bezPowtorzen(xs.map((x) => warstwaPoWycofaniu(x))),
      ]),
    ),
    ...(w.jev && {
      jev: {
        ...w.jev,
        wybor: warstwaPoWycofaniu(w.jev.wybor),
        propozycje: w.jev.propozycje?.map((x) => warstwaPoWycofaniu(x)) ?? null,
      },
    }),
  }
}
function zapisanyAPoWycofaniu(w: WynikA): WynikA {
  const systemy: WynikA['systemy'] = {}
  for (const [s, x] of Object.entries(w.systemy)) {
    const kategorie: Record<string, number> = {}
    for (const [k, poziom] of Object.entries(x.kategorie)) {
      const nowa = kategoriaPoWycofaniu(k)
      kategorie[nowa] = Math.max(kategorie[nowa] ?? 0, poziom ?? 0)
    }
    systemy[s] = { ...x, kategorie }
  }
  return { ...w, systemy }
}

const zapisz = (plik: string | undefined, a: WynikA[], b: WynikB[], podsumowanie: unknown) => {
  if (!plik) return
  writeFileSync(
    plik,
    `${JSON.stringify({ data: new Date().toISOString(), naZywo, podsumowanie, a, b }, null, 2)}\n`,
  )
  console.error(`Zapisano ${plik}`)
}

// #163: --przed-po <commit> – trzy wersje (przed, po, proste) na jednym wywołaniu na pozycję.
const iPrzedPo = argv.indexOf('--przed-po')
const commitPrzed = iPrzedPo >= 0 ? argv[iPrzedPo + 1] : undefined
if (commitPrzed && naZywo) {
  const wyjscia: Record<Wariant, string | undefined> = {
    po: wyjscie,
    przed: argv[argv.indexOf('--wyjscie-przed') + 1],
    proste: argv.includes('--wyjscie-proste')
      ? argv[argv.indexOf('--wyjscie-proste') + 1]
      : undefined,
  }
  if (!argv.includes('--wyjscie-przed')) wyjscia.przed = undefined
  try {
    const przed = await modulZCommitu(commitPrzed)
    const klienci = await klienciPrzedPo(przed)
    for (const w of WARIANTY) {
      const modul = w === 'przed' ? przed : MODUL_TERAZ
      const a = await biegA(tylko === 'b' ? null : klienci(w), modul)
      const b = await biegB(tylko === 'a' ? null : klienci(w), modul)
      // Wywołań tylko z tej wersji nie ma – licznik to wywołania na żywo od początku przebiegu.
      const { tekst, podsumowanie } = raport(a, b, true)
      console.log(`\n# Wersja: ${w}${w === 'przed' ? ` (${commitPrzed})` : ''}\n`)
      console.log(tekst)
      zapisz(wyjscia[w], a, b, podsumowanie)
    }
    console.error(`Wywołań na żywo razem: ${liczbaWywolan}`)
  } finally {
    for (const u of TYMCZASOWE) rmSync(u, { force: true })
  }
} else {
  const klient = naZywo ? await klientNaZywo() : null
  // --tylko a|b: drugi zbiór liczy się bez sieci (same reguły) – oszczędza wywołania JEV.
  const a = zapisany
    ? zapisany.a.filter((w) => idsA.has(w.id)).map(zapisanyAPoWycofaniu)
    : await biegA(tylko === 'b' ? null : klient)
  const b = zapisany
    ? zapisany.b.filter((w) => idsB.has(w.id)).map(zapisanyBPoWycofaniu)
    : await biegB(tylko === 'a' ? null : klient)
  const { tekst, podsumowanie } = raport(
    a,
    b,
    naZywo || Boolean(zapisany?.a.some((w) => w.jev) || zapisany?.b.some((w) => w.jev)),
  )
  console.log(tekst)
  zapisz(wyjscie, a, b, podsumowanie)
}
