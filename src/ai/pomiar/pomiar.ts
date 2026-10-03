// Pomiar JEV po polsku (#18): zbiory wzorcowe (zbior-opisz.json, zbior-zapytaj.json) →
// JEV kontra reguły na tych samych pozycjach. Wyniki i metoda: WYNIKI.md.
//
// Użycie (z katalogu repo):
//   node src/ai/pomiar/pomiar.ts                      # tylko reguły, bez sieci i bez klucza
//   node --env-file=.env.local src/ai/pomiar/pomiar.ts --na-zywo [--tylko a|b] [--wyjscie plik.json]
//
// Na żywo każda pozycja to JEDNO wywołanie JEV (ok. 58 na przebieg – to kosztuje). Idzie
// tą samą ścieżką co aplikacja: klient (jev.ts, timeout 1,5 s) → pośrednik (api/_jev.js,
// timeout 800 ms) → api.typesafe.ai. Z jednej odpowiedzi liczymy trzy systemy:
//   reguly       – zRegul / regula (bez AI),
//   jev_surowy   – sama odpowiedź JEV (B: wybór bez progu pewności; A: bez reguł zapasowych),
//   jev_z_zapasem – to, co naprawdę widzi użytkownik (JEV z progiem, poniżej progu reguły).
// Klucz czyta tylko pośrednik z process.env; skrypt go nie wypisuje ani nie zapisuje.
// Do pliku wyjścia trafiają wyłącznie wyniki po przetworzeniu (bez surowych odpowiedzi API).
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import type { PlikWskaznika } from '../../kontrakty/index.ts'
import type { OdpowiedzJev, OpcjeKlienta } from '../jev.ts'
import { zJevem } from '../jev.ts'
import {
  KATEGORIE_OCENIANE,
  type KategoriaOceniana,
  nicNieZrozumiano,
  opiszSiebie,
  POTRZEBY,
  PUSTE_ZROZUMIENIE,
  przetworzOdpowiedzi,
  type Zrozumienie,
  zRegul,
} from '../opiszSiebie.ts'
import {
  ID_PYTANIA,
  listaWarstw,
  NIE_WIEM,
  przetworz,
  regula,
  zapytanieJev,
} from '../zapytajOAdres.ts'

// ── Zbiory ────────────────────────────────────────────────────────────────────────────────

interface PozycjaOpisz {
  id: string
  tekst: string
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
  tematy: string[][]
}

const KATALOG = new URL('./', import.meta.url)
const czytaj = (plik: string) => JSON.parse(readFileSync(new URL(plik, KATALOG), 'utf8'))
const ZBIOR_A: PozycjaOpisz[] = czytaj('zbior-opisz.json').pozycje
const ZBIOR_B: PozycjaZapytaj[] = czytaj('zbior-zapytaj.json').pozycje

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

async function klientNaZywo(): Promise<{ opcje: () => OpcjeKlienta; ostatnie: () => Wywolanie }> {
  // Ścieżka w zmiennej – TS nie typuje pliku JS, a i tak wołamy tylko dwie funkcje.
  const sciezka = new URL('api/_jev.js', KORZEN).href
  const { obsluz, utworzLimiter } = (await import(sciezka)) as Posrednik
  const limiter = utworzLimiter({ oknoMs: 60_000, naIp: 1000, naInstancje: 1000 })
  let ostatnie: Wywolanie = { ms: 0, odpowiedzi: null, powod: 'brak' }
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
    return new Response(JSON.stringify(r.json), { status: r.status })
  }) as typeof fetch
  return { opcje: () => ({ fetch: fetchPrzezPosrednika }), ostatnie: () => ostatnie }
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
    /** Wybór profilu i pewność JEV – przed progiem. */
    profil: { wybor: string; pewnosc: number | null } | null
    /** Ocena twierdzeń (noul 0–1) dla potrzeb z twierdzeniem. */
    noul: Record<string, number | null>
    poziomy: Record<string, number | null>
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
      w.jev = {
        ms: o.ms,
        zrodlo: r.zrodlo,
        powod: r.powod,
        profil: profil?.typ === 'choice' ? { wybor: profil.wybor, pewnosc: profil.pewnosc } : null,
        noul,
        poziomy,
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
  jev?: {
    ms: number
    zrodlo: string
    powod: string | null
    wybor: string | null
    pewnosc: number | null
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
    }
    if (naZywo) {
      // Ta sama ścieżka co zapytajOAdres(), bez wczytywania wartości warstw.
      const r = await zJevem(
        zapytanieJev(p.pytanie, LISTA),
        (odp) => przetworz(odp, LISTA),
        () => regula(p.pytanie, LISTA),
        naZywo.opcje(),
      )
      const o = naZywo.ostatnie()
      const x = o.odpowiedzi?.[ID_PYTANIA]
      const surowy = x?.typ === 'choice' ? x : null
      w.systemy.jev_surowy = surowy && surowy.wybor !== NIE_WIEM ? surowy.wybor : null
      w.systemy.jev_z_zapasem = r.wynik.warstwa
      w.jev = {
        ms: o.ms,
        zrodlo: r.zrodlo,
        powod: r.powod,
        wybor: surowy?.wybor ?? null,
        pewnosc: surowy?.pewnosc ?? null,
      }
      process.stderr.write(`B ${p.id} ${o.ms} ms ${r.zrodlo}\n`)
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

// ── Raport ────────────────────────────────────────────────────────────────────────────────

function raport(a: WynikA[], b: WynikB[], naZywo: boolean) {
  const wszystkie = ['reguly', 'jev_surowy', 'jev_z_zapasem']
  const systemyA = wszystkie.filter((s) => a.some((w) => w.systemy[s]))
  const systemyB = wszystkie.filter((s) => b.some((w) => s in w.systemy))
  const out: string[] = []
  out.push(`## A – opisz siebie (${a.length} pozycji)`, '')
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

  let podsumowanie: Record<string, unknown> = { oceny: { a: ocenyA, b: ocenyB } }
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
      `- B, pewność warstwy: trafna ${sr(warstwaTrafna)}, błędna ${sr(warstwaBledna)}`,
    )
    podsumowanie = {
      ...podsumowanie,
      wywolan: liczbaWywolan,
      zapas: { a: zapasA.length, b: zapasB.length },
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

const argv = process.argv.slice(2)
const naZywo = argv.includes('--na-zywo')
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
// --tylko a|b: drugi zbiór liczy się bez sieci (same reguły) – oszczędza wywołania JEV.
const a = await biegA(tylko === 'b' ? null : klient)
const b = await biegB(tylko === 'a' ? null : klient)
const { tekst, podsumowanie } = raport(a, b, naZywo)
console.log(tekst)
if (wyjscie) {
  writeFileSync(
    wyjscie,
    `${JSON.stringify({ data: new Date().toISOString(), naZywo, podsumowanie, a, b }, null, 2)}\n`,
  )
  console.error(`Zapisano ${wyjscie}`)
}
