// #152: czy wersja końcowa wysyła do JEV te same zapytania co #147 (commit 5a8e872)?
// Bez sieci i bez klucza. Jeśli tak, odpowiedzi JEV z pomiarów #147 przenoszą się wprost
// (po stronie JEV nic się nie zmieniło) – różnić może się tylko przetwarzanie reguł z #150.
//
// Użycie (z katalogu repo, potrzebna historia git z 5a8e872):
//   node src/ai/pomiar/zgodnosc147.ts
//
// Skrypt wyciąga opiszSiebie.ts i zapytajOAdres.ts z 5a8e872 do plików tymczasowych obok
// obecnych (te same importy względne), buduje zapytania dla wszystkich tekstów ze wszystkich
// zbiorów i porównuje je bajt w bajt (JSON.stringify). Porównuje też listę warstw dla JEV
// zbudowaną z metadanych warstw w 5a8e872 i teraz. Wypisuje tylko liczby, bez tekstów.
//
// Kod wyjścia 1 = różni się KOD budujący zapytania (na tej samej liście warstw). Inna lista
// warstw (dane dodane po 5a8e872, np. wyniki Sejmu 2023 z #134) to nie błąd kodu – skrypt ją
// tylko wypisuje, bo zmienia opcje wyboru, które widzi JEV, i trzeba o niej pamiętać.
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import type { PlikWskaznika, WskaznikMeta } from '../../kontrakty/index.ts'
import * as opiszTeraz from '../opiszSiebie.ts'
import * as zapytajTeraz from '../zapytajOAdres.ts'

const COMMIT = '5a8e872'
const KORZEN = new URL('../../../', import.meta.url)
const AI = new URL('../', import.meta.url)
const git = (...a: string[]) =>
  execFileSync('git', a, { cwd: KORZEN, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })

const tymczasowe = {
  opisz: new URL('_zgodnosc147_opiszSiebie.ts', AI),
  zapytaj: new URL('_zgodnosc147_zapytajOAdres.ts', AI),
}
writeFileSync(tymczasowe.opisz, git('show', `${COMMIT}:src/ai/opiszSiebie.ts`))
writeFileSync(tymczasowe.zapytaj, git('show', `${COMMIT}:src/ai/zapytajOAdres.ts`))

let bledy = 0
try {
  const opisz147 = (await import(tymczasowe.opisz.href)) as typeof opiszTeraz
  const zapytaj147 = (await import(tymczasowe.zapytaj.href)) as typeof zapytajTeraz

  const czytaj = (plik: string) =>
    JSON.parse(readFileSync(new URL(plik, import.meta.url), 'utf8')).pozycje as Record<
      string,
      string
    >[]
  const ZBIORY = [
    ['wzorcowy', 'zbior-opisz.json', 'zbior-zapytaj.json'],
    ['kontrolny', 'kontrolny-opisz.json', 'kontrolny-zapytaj.json'],
    ['kontrolny2', 'kontrolny2-opisz.json', 'kontrolny2-zapytaj.json'],
  ] as const

  // Lista warstw dla JEV: metadane teraz i w 5a8e872 (warstwy dodane później też by ją zmieniły).
  const katalog = new URL('public/dane/wskazniki/', KORZEN)
  const metasTeraz: WskaznikMeta[] = readdirSync(katalog)
    .filter((f) => f.endsWith('.json'))
    .map((f) => (JSON.parse(readFileSync(new URL(f, katalog), 'utf8')) as PlikWskaznika).meta)
  const metas147: WskaznikMeta[] = git('ls-tree', '--name-only', COMMIT, 'public/dane/wskazniki/')
    .split('\n')
    .filter((f) => f.endsWith('.json'))
    .map((f) => (JSON.parse(git('show', `${COMMIT}:${f}`)) as PlikWskaznika).meta)
  const lista = zapytajTeraz.listaWarstw(metasTeraz)
  const lista147 = zapytaj147.listaWarstw(metas147)
  const listaRowna = JSON.stringify(lista) === JSON.stringify(lista147)
  const ids147 = new Set(lista147.map((p) => p.id))
  const nowe = lista.filter((p) => !ids147.has(p.id)).map((p) => p.id)
  const zmienione = lista.filter(
    (p) =>
      ids147.has(p.id) && JSON.stringify(lista147.find((x) => x.id === p.id)) !== JSON.stringify(p),
  ).length
  const ubyle = lista147.filter((p) => !lista.some((x) => x.id === p.id)).length
  console.log(
    `Lista warstw dla JEV (${lista.length} teraz, ${lista147.length} w ${COMMIT}): ${listaRowna ? 'identyczna' : 'RÓŻNA'}`,
  )
  if (!listaRowna)
    console.log(
      `  nowe warstwy: ${nowe.join(', ') || '–'}; zmienione opisy: ${zmienione}; usunięte: ${ubyle}`,
    )

  for (const [nazwa, plikA, plikB] of ZBIORY) {
    const teksty = czytaj(plikA).map((p) => p.tekst ?? '')
    const pytania = czytaj(plikB).map((p) => p.pytanie ?? '')
    const rowneA = teksty.filter(
      (t) =>
        JSON.stringify(opiszTeraz.zapytanieOpiszSiebie(t)) ===
        JSON.stringify(opisz147.zapytanieOpiszSiebie(t)),
    ).length
    // „zapytaj”: całe zapytanie (polecenie, opisy warstw z dopiskami, twierdzenia tematów).
    // Osobno: ten sam kod na tej samej liście warstw, i pełne zapytanie z listą z 5a8e872.
    const jak = (q: string) => JSON.stringify(zapytajTeraz.zapytanieJev(q, lista))
    const rowneKod = pytania.filter(
      (q) => jak(q) === JSON.stringify(zapytaj147.zapytanieJev(q, lista)),
    ).length
    const rowneB = pytania.filter(
      (q) => jak(q) === JSON.stringify(zapytaj147.zapytanieJev(q, lista147)),
    ).length
    bledy += teksty.length - rowneA + pytania.length - rowneKod
    console.log(
      `${nazwa}: „opisz siebie” ${rowneA}/${teksty.length} identycznych; „zapytaj o adres” – kod na tej samej liście ${rowneKod}/${pytania.length}, całe zapytanie ${rowneB}/${pytania.length}`,
    )
  }
} finally {
  rmSync(tymczasowe.opisz, { force: true })
  rmSync(tymczasowe.zapytaj, { force: true })
}
console.log(
  bledy === 0 ? `Kod zapytań do JEV identyczny z ${COMMIT}.` : `Różnic w kodzie zapytań: ${bledy}.`,
)
process.exit(bledy === 0 ? 0 : 1)
