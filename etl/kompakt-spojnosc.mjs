// Szybka kontrola kompaktów wszystkich miast (w `pnpm verify`): każda warstwa z `wskazniki/` musi
// być w `kompakt/indeks.json`, a każdy plik z indeksu na dysku. Dokładne porównanie treści robi
// `node etl/kompakt.mjs --sprawdz`, ale trwa ok. 35 s na miasto. Tu sekundy, a łapie przypadek
// z #234: nowa warstwa bez przebudowy kompaktu i miasto znika z mapy kraju.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const DANE = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'dane')
const MIASTA = join(DANE, 'miasta')
const katalogi = [
  ['krakow', DANE],
  ...(existsSync(MIASTA) ? readdirSync(MIASTA).map((m) => [m, join(MIASTA, m)]) : []),
]

const bledy = []
for (const [miasto, dane] of katalogi) {
  const sciezka = join(dane, 'kompakt', 'indeks.json')
  if (!existsSync(sciezka)) continue // dane poza gitem (#237) – nie ma czego sprawdzać
  const indeks = JSON.parse(readFileSync(sciezka, 'utf8'))
  const katalogW = join(dane, 'wskazniki')
  const ids = existsSync(katalogW)
    ? readdirSync(katalogW)
        .filter((p) => p.endsWith('.json'))
        .map((p) => p.slice(0, -5))
    : []
  for (const id of ids) if (!indeks.wskazniki[id]) bledy.push(`${miasto}: ${id} brak w kompakcie`)
  for (const id of Object.keys(indeks.wskazniki))
    if (!ids.includes(id)) bledy.push(`${miasto}: ${id} w kompakcie, brak pliku warstwy`)
}

if (bledy.length) {
  console.error(bledy.join('\n'))
  console.error('Przebuduj: ADRESCORE_MIASTO=<slug> node etl/kompakt.mjs (Kraków bez zmiennej)')
  process.exit(1)
}
console.log(`Kompakty spójne (${katalogi.length} zbiorów).`)
