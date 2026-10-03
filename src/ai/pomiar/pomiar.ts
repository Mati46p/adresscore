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
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import type { PlikWskaznika } from '../../kontrakty/index.ts'
import type { OdpowiedzJev, OpcjeKlienta } from '../jev.ts'
import {
  BRAMKA,
  bramkaZamknieta,
  KATEGORIE_OCENIANE,
  type KategoriaOceniana,
  nicNieZrozumiano,
  opiszSiebie,
  POTRZEBY,
  PROG_BRAMKI,
  PUSTE_ZROZUMIENIE,
  przetworzOdpowiedzi,
  type Zrozumienie,
  zRegul,
} from '../opiszSiebie.ts'
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
  wybierzWarstwy,
} from '../zapytajOAdres.ts'

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
const PLIKI_KONTROLNE: Record<string, { opisz: string; zapytaj: string }> = {
  kontrolny: { opisz: 'kontrolny-opisz.json', zapytaj: 'kontrolny-zapytaj.json' },
  kontrolny2: { opisz: 'kontrolny2-opisz.json', zapytaj: 'kontrolny2-zapytaj.json' },
  // #153: trzeci zbiór na ślepo, z cechami pułapek (`domownik`, `cudza_sytuacja`,
  // `pies_bez_spaceru`, `dwa_z_tematu`) – raport ma też przekrój po cechach, tylko liczby.
  kontrolny3: { opisz: 'kontrolny3-opisz.json', zapytaj: 'kontrolny3-zapytaj.json' },
  // #157: czwarty zbiór na ślepo, większy (40 opisów, 35 pytań), cechy `profil_glowny`,
  // `profil_niejasny`, `cudza_sytuacja`, `domownik` (A) i `niejednoznaczne`, `zlozone`, `spoza` (B).
  kontrolny4: { opisz: 'kontrolny4-opisz.json', zapytaj: 'kontrolny4-zapytaj.json' },
}
if (NAZWA_ZBIORU !== undefined && !PLIKI_KONTROLNE[NAZWA_ZBIORU]) {
  console.error(
    `Nieznany zbiór: ${NAZWA_ZBIORU} (znane: ${Object.keys(PLIKI_KONTROLNE).join(', ')})`,
  )
  process.exit(2)
}
const PLIKI = NAZWA_ZBIORU === undefined ? undefined : PLIKI_KONTROLNE[NAZWA_ZBIORU]
const KONTROLNY = PLIKI !== undefined

const KATALOG = new URL('./', import.meta.url)
const czytaj = (plik: string) => JSON.parse(readFileSync(new URL(plik, KATALOG), 'utf8'))
/**
 * Zbiór kontrolny ma ten sam schemat z dwiema różnicami: „spoza zakresu” to `[["nie_wiem"]]`
 * (u nas `[]`), a „nic” nie jest jawne – to profil null i brak potrzeb.
 */
const ZBIOR_A_PELNY: PozycjaOpisz[] = KONTROLNY
  ? (czytaj(PLIKI.opisz).pozycje as PozycjaOpisz[]).map((p) => ({
      ...p,
      nic: p.nic ?? (p.persona === null && p.potrzeby.length === 0),
    }))
  : czytaj('zbior-opisz.json').pozycje
const ZBIOR_B_PELNY: PozycjaZapytaj[] = KONTROLNY
  ? (czytaj(PLIKI.zapytaj).pozycje as PozycjaZapytaj[]).map((p) => ({
      ...p,
      tematy: p.tematy.filter((t) => !(t.length === 1 && t[0] === NIE_WIEM)),
    }))
  : czytaj('zbior-zapytaj.json').pozycje

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
}

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
    const t0 = performance.now()
    liczbaWywolan++
    const r = await obsluz({
      metoda: 'POST',
      cialo: JSON.parse(String(init?.body)),
      ip: 'pomiar',
      env: process.env,
      limiter,
    })
    const json = r.json as { odpowiedzi?: Wywolanie['odpowiedzi']; powod?: string | null }
    ostatnie = {
      ms: Math.round(performance.now() - t0),
      odpowiedzi: json.odpowiedzi ?? null,
      powod: json.powod ?? null,
    }
    wszystkie.push(ostatnie)
    return new Response(JSON.stringify(r.json), { status: r.status })
  }) as typeof fetch
  return {
    opcje: () => ({ fetch: fetchPrzezPosrednika }),
    ostatnie: () => ostatnie,
    wszystkie: () => wszystkie,
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
  }
}

const zZrozumienia = (z: Zrozumienie) => ({
  persona: z.persona,
  potrzeby: z.potrzeby,
  kategorie: z.kategorie,
  nic: nicNieZrozumiano(z),
})

async function biegA(naZywo: Awaited<ReturnType<typeof klientNaZywo>> | null): Promise<WynikA[]> {
  const wyniki: WynikA[] = []
  for (const p of ZBIOR_A) {
    const w: WynikA = {
      id: p.id,
      tekst: p.tekst,
      wzorzec: { persona: p.persona, potrzeby: p.potrzeby, nic: Boolean(p.nic) },
      systemy: { reguly: zZrozumienia(zRegul(p.tekst)) },
    }
    if (naZywo) {
      const r = await opiszSiebie(p.tekst, naZywo.opcje())
      const o = naZywo.ostatnie()
      const odp = o.odpowiedzi
      w.systemy.jev_surowy = zZrozumienia((odp && przetworzOdpowiedzi(odp)) ?? PUSTE_ZROZUMIENIE)
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
        zamknieta: Boolean(odp && bramkaZamknieta(odp)),
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
  }
}

async function biegB(naZywo: Awaited<ReturnType<typeof klientNaZywo>> | null): Promise<WynikB[]> {
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
      const r = await wybierzWarstwy(p.pytanie, LISTA, naZywo.opcje())
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
      `- Wywołań JEV w tym przebiegu: ${liczbaWywolan}`,
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

  if (KONTROLNY) {
    out.push('', 'Zbiór kontrolny: bez błędów pozycja po pozycji (nie stroimy na nim).')
    return { tekst: out.join('\n'), podsumowanie }
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
const klient = naZywo ? await klientNaZywo() : null
// --z-pliku: zapisany przebieg (bez sieci), tylko pozycje bieżącego zbioru (np. tylko pisane).
const zapisany = zPliku
  ? (JSON.parse(readFileSync(zPliku, 'utf8')) as { a: WynikA[]; b: WynikB[] })
  : null
const idsA = new Set(ZBIOR_A.map((p) => p.id))
const idsB = new Set(ZBIOR_B.map((p) => p.id))
// --tylko a|b: drugi zbiór liczy się bez sieci (same reguły) – oszczędza wywołania JEV.
const a = zapisany
  ? zapisany.a.filter((w) => idsA.has(w.id))
  : await biegA(tylko === 'b' ? null : klient)
const b = zapisany
  ? zapisany.b.filter((w) => idsB.has(w.id))
  : await biegB(tylko === 'a' ? null : klient)
const { tekst, podsumowanie } = raport(
  a,
  b,
  naZywo || Boolean(zapisany?.a.some((w) => w.jev) || zapisany?.b.some((w) => w.jev)),
)
console.log(tekst)
if (wyjscie) {
  writeFileSync(
    wyjscie,
    `${JSON.stringify({ data: new Date().toISOString(), naZywo, podsumowanie, a, b }, null, 2)}\n`,
  )
  console.error(`Zapisano ${wyjscie}`)
}
