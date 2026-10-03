// Generuje SVG na slajd dla jury dopiero po potwierdzeniu publicznego URL demo.
// Wymaga qrencode (macOS: brew install qrencode).

import { spawnSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const url = process.argv[2]
const cel = resolve(process.argv[3] ?? 'docs/pitch/qr-demo.svg')
if (!url || !/^https:\/\/[^\s/]+(?:\/[^\s]*)?$/.test(url)) {
  console.error(
    'Użycie: node scripts/generuj-qr-pitch.mjs https://PUBLICZNY-URL [docs/pitch/qr-demo.svg]',
  )
  process.exit(2)
}
mkdirSync(dirname(cel), { recursive: true })
const wynik = spawnSync('qrencode', ['-l', 'H', '-m', '4', '-t', 'SVG', '-o', cel, url], {
  stdio: 'inherit',
})
if (wynik.error) {
  console.error(`Nie udało się uruchomić qrencode: ${wynik.error.message}`)
  process.exit(1)
}
if (wynik.status !== 0) process.exit(wynik.status ?? 1)
console.log(`QR: ${cel} → ${url}`)
