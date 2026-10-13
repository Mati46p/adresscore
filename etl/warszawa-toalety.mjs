// Toalety publiczne Warszawy (#234): odległość od adresu do najbliższej toalety z API
// dane.um.warszawa.pl (action get_m_toalety, GeoJSON, 695 punktów, stan kwiecień 2026).
// Wszystkie typy wchodzą: stacjonarne, w stacjach metra, automatyczne i przenośne. Przenośne (213)
// bywają sezonowe, a API nie podaje, które, więc nie da się ich uczciwie odsiać; opis to mówi.
// Uruchom: ADRESCORE_MIASTO=warszawa node etl/warszawa-toalety.mjs
// Surowe dane: etl/.cache/warszawa-api/ (pobranie jednorazowe).
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  pobierzAction,
  punktyZFeatures,
  ramkaAdresow,
  wRamce,
  wymagajWarszawy,
} from './lib/warszawa-api.mjs'
import { zapiszOdleglosc } from './lib/warszawa-wskaznik.mjs'
import { MIASTO, wczytajAdresy } from './lib/wspolne.mjs'

export const ACTION = 'get_m_toalety'

const MIESIACE = [
  'styczeń',
  'luty',
  'marzec',
  'kwiecień',
  'maj',
  'czerwiec',
  'lipiec',
  'sierpień',
  'wrzesień',
  'październik',
  'listopad',
  'grudzień',
]

/** Punkty toalet z rekordów GeoJSON; atrybuty (typ, dzielnica…) zostają w polu atr. */
export const punktyToalet = (features) => punktyZFeatures(features)

/** Stan danych z pola aktu_dan („Kwiecień 2026”) → ostatni dzień najpóźniejszego miesiąca (ISO) albo null. */
export function dataStanu(features) {
  let najlepsza = null
  for (const f of features) {
    const m = /^\s*(\p{L}+)\s+(\d{4})\s*$/u.exec(String(f.properties?.aktu_dan ?? ''))
    const i = m ? MIESIACE.indexOf(m[1].toLowerCase()) : -1
    if (i < 0) continue
    const iso = new Date(Date.UTC(Number(m[2]), i + 1, 0)).toISOString().slice(0, 10)
    if (!najlepsza || iso > najlepsza) najlepsza = iso
  }
  return najlepsza
}

async function main() {
  wymagajWarszawy(MIASTO)
  const { result, pobrano } = await pobierzAction(ACTION)
  const { adresy } = wczytajAdresy()
  const ramka = ramkaAdresow(adresy)
  const punkty = punktyToalet(result).filter((p) => wRamce(p, ramka))
  const typy = {}
  for (const p of punkty) typy[p.atr.typ] = (typy[p.atr.typ] ?? 0) + 1
  console.log(
    `Toalety: ${result.length} rekordów, ${punkty.length} w obrębie Warszawy; typy: ${JSON.stringify(typy)}`,
  )
  zapiszOdleglosc({
    id: 'toaleta_publiczna_odleglosc',
    kategoria: 'codziennosc',
    nazwa: 'Najbliższa toaleta publiczna',
    opis: `Odległość do najbliższej toalety publicznej z rejestru m.st. Warszawy (${punkty.length} punktów: stacjonarne, w stacjach metra, automatyczne i przenośne). Toalety przenośne mogą być sezonowe, a rejestr tego nie rozróżnia. Toaleta w budynku może być w danej chwili zamknięta, bo godziny otwarcia są w rejestrze opisowe.`,
    zakres: [0, 1500],
    zadanie: 234,
    zrodlo: {
      nazwa: 'm.st. Warszawa – toalety publiczne',
      action: ACTION,
      dataDanych: dataStanu(result) ?? pobrano,
      pobrano,
    },
    punkty,
  })
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((blad) => {
    console.error(blad)
    process.exitCode = 1
  })
}
