// Test A/A (#157): ten sam zestaw zapytań do JEV dwa razy na tym samym kodzie i przypiętym
// modelu (`MODEL_JEV` w api/_jev.js). Różnice między przebiegami to szum – próg, poniżej którego
// różnicy między dwiema wersjami nie wolno brać za skutek zmiany.
//
// Zestaw: co druga pozycja ze zbiorów do strojenia (`zbior-opisz.json` bez pustych tekstów,
// `zbior-zapytaj.json`) – zbiory już użyte, żadnego zbioru kontrolnego.
//
// Użycie (z katalogu repo, ok. 56 płatnych wywołań):
//   node --env-file=.env.local src/ai/pomiar/aa.ts --wyjscie <scratchpad>/aa.json
//   node src/ai/pomiar/aa.ts --z-pliku <scratchpad>/aa.json      # bez sieci: sam raport
// Klucz czyta tylko pośrednik z process.env; skrypt go nie wypisuje ani nie zapisuje.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import type { PlikWskaznika } from '../../kontrakty/index.ts'
import type { OdpowiedzJev, OpcjeKlienta } from '../jev.ts'
import {
  nicNieZrozumiano,
  opiszSiebie,
  POTRZEBY,
  PROG_BRAMKI,
  PROG_POTRZEBY,
} from '../opiszSiebie.ts'
import { listaWarstw, PROG_TEMATU, wybierzWarstwy } from '../zapytajOAdres.ts'

const KATALOG = new URL('./', import.meta.url)
const KORZEN = new URL('../../../', import.meta.url)
const czytaj = (plik: string) => JSON.parse(readFileSync(new URL(plik, KATALOG), 'utf8'))

interface PozycjaOpisz {
  id: string
  tekst: string
  persona: string | null
  persona_tez?: string[]
  nic?: boolean
  potrzeby: string[]
}
interface PozycjaZapytaj {
  id: string
  pytanie: string
  tematy: string[][]
}

const coDruga = <T>(xs: readonly T[]) => xs.filter((_, i) => i % 2 === 0)
export const ZESTAW_A: PozycjaOpisz[] = coDruga(
  (czytaj('zbior-opisz.json').pozycje as PozycjaOpisz[]).filter((p) => p.tekst.trim()),
)
export const ZESTAW_B: PozycjaZapytaj[] = coDruga(czytaj('zbior-zapytaj.json').pozycje)

const katalogWskaznikow = new URL('public/dane/wskazniki/', KORZEN)
const LISTA = listaWarstw(
  readdirSync(katalogWskaznikow)
    .filter((f) => f.endsWith('.json'))
    .map(
      (f) =>
        (JSON.parse(readFileSync(new URL(f, katalogWskaznikow), 'utf8')) as PlikWskaznika).meta,
    ),
)
const POTRZEBY_JEV = new Set(POTRZEBY.filter((p) => p.twierdzenie).map((p) => p.id))

// ── Wywołanie przez pośrednika (jak w pomiar.ts) ────────────────────────────────────────

type Odpowiedzi = Record<string, OdpowiedzJev | null> | null
let liczbaWywolan = 0

async function klient() {
  const { obsluz, utworzLimiter } = (await import(new URL('api/_jev.js', KORZEN).href)) as {
    obsluz: (a: Record<string, unknown>) => Promise<{ status: number; json: unknown }>
    utworzLimiter: (o: Record<string, number>) => unknown
  }
  const limiter = utworzLimiter({ oknoMs: 60_000, naIp: 1000, naInstancje: 1000 })
  const wszystkie: { ms: number; odpowiedzi: Odpowiedzi }[] = []
  const f = (async (_u: string | URL | Request, init?: RequestInit) => {
    const t0 = performance.now()
    liczbaWywolan++
    const r = await obsluz({
      metoda: 'POST',
      cialo: JSON.parse(String(init?.body)),
      ip: 'pomiar-aa',
      env: process.env,
      limiter,
    })
    const json = r.json as { odpowiedzi?: Odpowiedzi }
    wszystkie.push({ ms: Math.round(performance.now() - t0), odpowiedzi: json.odpowiedzi ?? null })
    return new Response(JSON.stringify(r.json), { status: r.status })
  }) as typeof fetch
  return { opcje: (): OpcjeKlienta => ({ fetch: f }), wszystkie }
}

interface Pomiar {
  id: string
  /** Odpowiedzi JEV na kolejne wywołania tej pozycji (B: czasem dwa). */
  odpowiedzi: Odpowiedzi[]
  ms: number
  zrodlo: string
  /** Końcowa odpowiedź, którą widzi użytkownik, jako porównywalny tekst. */
  koniec: string
  /** Trafienie wg wzorca: A – „dokładnie”, B – warstwa główna. */
  trafne: boolean
}

async function przebieg(k: Awaited<ReturnType<typeof klient>>) {
  const a: Pomiar[] = []
  for (const p of ZESTAW_A) {
    const przed = k.wszystkie.length
    const r = await opiszSiebie(p.tekst, k.opcje())
    const w = k.wszystkie.slice(przed)
    const z = r.wynik
    const wz10 = p.potrzeby.filter((x) => POTRZEBY_JEV.has(x)).sort()
    const wy10 = z.potrzeby.filter((x) => POTRZEBY_JEV.has(x)).sort()
    const personaOk = new Set([p.persona, ...(p.persona_tez ?? [])]).has(z.persona)
    a.push({
      id: p.id,
      odpowiedzi: w.map((x) => x.odpowiedzi),
      ms: w.reduce((s, x) => s + x.ms, 0),
      zrodlo: r.zrodlo,
      koniec: JSON.stringify({
        persona: z.persona,
        potrzeby: z.potrzeby,
        kategorie: Object.entries(z.kategorie).sort(),
      }),
      trafne: personaOk && wz10.join() === wy10.join() && Boolean(p.nic) === nicNieZrozumiano(z),
    })
    process.stderr.write(`A ${p.id} ${r.zrodlo}\n`)
  }
  const b: Pomiar[] = []
  for (const p of ZESTAW_B) {
    const przed = k.wszystkie.length
    const r = await wybierzWarstwy(p.pytanie, LISTA, k.opcje())
    const w = k.wszystkie.slice(przed)
    const glowna = r.wynik.warstwy[0] ?? null
    b.push({
      id: p.id,
      odpowiedzi: w.map((x) => x.odpowiedzi),
      ms: w.reduce((s, x) => s + x.ms, 0),
      zrodlo: r.zrodlo,
      koniec: JSON.stringify({
        warstwy: r.wynik.warstwy,
        propozycje: (r.wynik.propozycje ?? []).map((x) => x.warstwa),
      }),
      trafne:
        p.tematy.length === 0
          ? glowna === null
          : p.tematy.some((t) => glowna !== null && t.includes(glowna)),
    })
    process.stderr.write(`B ${p.id} ${r.zrodlo} ×${w.length}\n`)
  }
  return { a, b }
}

// ── Porównanie dwóch przebiegów ──────────────────────────────────────────────────────────

const srednia = (xs: readonly number[]) =>
  xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : Number.NaN
const maks = (xs: readonly number[]) => (xs.length ? Math.max(...xs) : Number.NaN)
function kwantyl(xs: readonly number[], q: number) {
  const s = [...xs].sort((x, y) => x - y)
  return s.length ? (s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)] as number) : Number.NaN
}
const f2 = (x: number) => (Number.isNaN(x) ? '–' : x.toFixed(3))
const pct = (x: number, n: number) => `${x}/${n} (${n ? Math.round((x / n) * 100) : 0}%)`

/** Próg dla oceny noul o danym id (do liczenia przeskoków przez próg). */
const progNoul = (id: string) =>
  id.startsWith('p_') ? PROG_POTRZEBY : id.startsWith('temat_') ? PROG_TEMATU : PROG_BRAMKI

function porownaj(nazwa: string, x: Pomiar[], y: Pomiar[]) {
  const wybor = { zgodne: 0, n: 0 }
  const dPewnosc: number[] = []
  const dNoul: number[] = []
  const noulPrzeskok = { n: 0, przez: 0 }
  const score = { zgodne: 0, n: 0 }
  const dProb: number[] = []
  let koniecInny = 0
  let zrodloInne = 0
  let trafne1 = 0
  let trafne2 = 0
  const wywolan: [number, number] = [0, 0]
  for (const p of x) {
    const q = y.find((z) => z.id === p.id)
    if (!q) continue
    wywolan[0] += p.odpowiedzi.length
    wywolan[1] += q.odpowiedzi.length
    if (p.koniec !== q.koniec) koniecInny++
    if (p.zrodlo !== q.zrodlo) zrodloInne++
    if (p.trafne) trafne1++
    if (q.trafne) trafne2++
    // Porównujemy tylko pierwsze wywołanie (to samo zapytanie w obu przebiegach).
    const o1 = p.odpowiedzi[0] ?? {}
    const o2 = q.odpowiedzi[0] ?? {}
    for (const id of new Set([...Object.keys(o1 ?? {}), ...Object.keys(o2 ?? {})])) {
      const u = o1?.[id]
      const v = o2?.[id]
      if (!u || !v || u.typ !== v.typ) continue
      if (u.typ === 'choice' && v.typ === 'choice') {
        wybor.n++
        if (u.wybor === v.wybor) wybor.zgodne++
        if (u.pewnosc !== null && v.pewnosc !== null) dPewnosc.push(Math.abs(u.pewnosc - v.pewnosc))
        const pu = u.prawdopodobienstwa ?? {}
        const pv = v.prawdopodobienstwa ?? {}
        for (const k of new Set([...Object.keys(pu), ...Object.keys(pv)]))
          dProb.push(Math.abs((pu[k] ?? 0) - (pv[k] ?? 0)))
      } else if (u.typ === 'noul' && v.typ === 'noul') {
        dNoul.push(Math.abs(u.noul - v.noul))
        noulPrzeskok.n++
        const prog = progNoul(id)
        if (u.noul >= prog !== v.noul >= prog) noulPrzeskok.przez++
      } else if (u.typ === 'score' && v.typ === 'score') {
        score.n++
        if (u.ocena === v.ocena) score.zgodne++
      }
    }
  }
  const n = x.length
  return {
    nazwa,
    n,
    wybor,
    dPewnosc: { srednio: srednia(dPewnosc), p95: kwantyl(dPewnosc, 0.95), max: maks(dPewnosc) },
    dNoul: {
      srednio: srednia(dNoul),
      p95: kwantyl(dNoul, 0.95),
      max: maks(dNoul),
      n: dNoul.length,
    },
    noulPrzeskok,
    score,
    dProb: { srednio: srednia(dProb), max: maks(dProb) },
    koniecInny,
    zrodloInne,
    trafne: [trafne1, trafne2],
    wywolan,
  }
}

function raport(r1: { a: Pomiar[]; b: Pomiar[] }, r2: { a: Pomiar[]; b: Pomiar[] }) {
  const out = [
    '# Test A/A (#157) – dwa przebiegi tego samego kodu na przypiętym modelu',
    '',
    '| | n | wybór (choice) zgodny | |Δ pewności| średnio / p95 / max | |Δ noul| średnio / p95 / max (ocen) | noul po różnych stronach progu | poziom (score) zgodny | |Δ p| opcji średnio / max | końcowa odpowiedź inna | źródło (JEV/zapas) inne | trafne: przebieg 1 / 2 | wywołań 1 / 2 |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|',
  ]
  for (const c of [
    porownaj('A – opisz siebie', r1.a, r2.a),
    porownaj('B – zapytaj o adres', r1.b, r2.b),
  ])
    out.push(
      `| ${c.nazwa} | ${c.n} | ${pct(c.wybor.zgodne, c.wybor.n)} | ${f2(c.dPewnosc.srednio)} / ${f2(c.dPewnosc.p95)} / ${f2(c.dPewnosc.max)} | ${f2(c.dNoul.srednio)} / ${f2(c.dNoul.p95)} / ${f2(c.dNoul.max)} (${c.dNoul.n}) | ${pct(c.noulPrzeskok.przez, c.noulPrzeskok.n)} | ${c.score.n ? pct(c.score.zgodne, c.score.n) : '–'} | ${f2(c.dProb.srednio)} / ${f2(c.dProb.max)} | ${pct(c.koniecInny, c.n)} | ${c.zrodloInne} | ${c.trafne[0]} / ${c.trafne[1]} | ${c.wywolan[0]} / ${c.wywolan[1]} |`,
    )
  const ms = (r: { a: Pomiar[]; b: Pomiar[] }) => [...r.a, ...r.b].map((x) => x.ms)
  for (const [i, r] of [r1, r2].entries())
    out.push(
      '',
      `Przebieg ${i + 1}: opóźnienie na pozycję p50 / p95 / max ${kwantyl(ms(r), 0.5)} / ${kwantyl(ms(r), 0.95)} / ${maks(ms(r))} ms`,
    )
  const rozne = (x: Pomiar[], y: Pomiar[]) =>
    x.filter((p) => y.find((q) => q.id === p.id)?.koniec !== p.koniec).map((p) => p.id)
  out.push(
    '',
    `Pozycje z inną końcową odpowiedzią: ${[...rozne(r1.a, r2.a), ...rozne(r1.b, r2.b)].join(', ') || '–'}`,
  )
  return out.join('\n')
}

// ── Start ─────────────────────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2)
const arg = (n: string) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : undefined)
const zPliku = arg('--z-pliku')
const wyjscie = arg('--wyjscie')
let dane: { r1: { a: Pomiar[]; b: Pomiar[] }; r2: { a: Pomiar[]; b: Pomiar[] } }
if (zPliku) dane = JSON.parse(readFileSync(zPliku, 'utf8'))
else {
  if (!process.env.JEV_API_KEY) {
    console.error('Wymaga JEV_API_KEY (node --env-file=.env.local …) albo --z-pliku.')
    process.exit(2)
  }
  const k = await klient()
  const r1 = await przebieg(k)
  const r2 = await przebieg(k)
  dane = { r1, r2 }
  console.error(`Wywołań JEV: ${liczbaWywolan}`)
  if (wyjscie)
    writeFileSync(
      wyjscie,
      `${JSON.stringify({ data: new Date().toISOString(), ...dane }, null, 2)}\n`,
    )
}
console.log(raport(dane.r1, dane.r2))
