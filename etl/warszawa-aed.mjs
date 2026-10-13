// Defibrylatory AED w Warszawie (#234): odległość od adresu do najbliższego publicznego AED z API
// dane.um.warszawa.pl (action get_scb_lokalizacja_defibrylatorow, GeoJSON, 710 punktów).
// Wchodzą tylko urządzenia z device_public_access = „Publiczny” (610); „Prywatny” (100) odpada,
// bo nie jest przeznaczony dla przypadkowego świadka. Dostępność w ciągu doby (pole
// device_availability: Tak / Ograniczona / Nie) jest w danych słabo opisana, więc jej nie
// filtrujemy, tylko piszemy o niej w opisie. Istnieje też warstwa OSM `defibrylator_odleglosc`
// (inne źródło, neutralny kierunek); ta ma osobny id i jej nie nadpisuje.
// Uruchom: ADRESCORE_MIASTO=warszawa node etl/warszawa-aed.mjs
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

export const ACTION = 'get_scb_lokalizacja_defibrylatorow'

/** Tylko urządzenia publiczne; liczbę pozostałych zwraca osobno, żeby była widoczna w statystyce. */
export function punktyAed(features) {
  const wszystkie = punktyZFeatures(features)
  const publiczne = wszystkie.filter(
    (p) =>
      String(p.atr.device_public_access ?? '')
        .trim()
        .toLowerCase() === 'publiczny',
  )
  return { publiczne, odrzucone: wszystkie.length - publiczne.length }
}

async function main() {
  wymagajWarszawy(MIASTO)
  const { result, pobrano } = await pobierzAction(ACTION)
  const { adresy } = wczytajAdresy()
  const ramka = ramkaAdresow(adresy)
  const { publiczne, odrzucone } = punktyAed(result)
  const punkty = publiczne.filter((p) => wRamce(p, ramka))
  const dost = {}
  for (const p of punkty)
    dost[p.atr.device_availability] = (dost[p.atr.device_availability] ?? 0) + 1
  console.log(
    `AED: ${result.length} rekordów, niepublicznych odrzucono ${odrzucone}, publicznych w Warszawie ${punkty.length}; dostępność: ${JSON.stringify(dost)}`,
  )
  zapiszOdleglosc({
    id: 'defibrylator_um_odleglosc',
    kategoria: 'bezpieczenstwo',
    nazwa: 'Najbliższy publiczny defibrylator AED',
    opis: `Odległość do najbliższego publicznego defibrylatora AED z rejestru m.st. Warszawy (${punkty.length} urządzeń oznaczonych jako publiczne; ${odrzucone} niepublicznych pominięto). Większość urządzeń wisi wewnątrz budynków i jest dostępna tylko w godzinach ich otwarcia, więc odległość pokazuje, gdzie stoi najbliższy AED, a nie czy da się go użyć o każdej porze.`,
    zakres: [0, 1000],
    zadanie: 234,
    zrodlo: {
      nazwa: 'm.st. Warszawa – lokalizacje defibrylatorów AED',
      action: ACTION,
      dataDanych: pobrano,
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
