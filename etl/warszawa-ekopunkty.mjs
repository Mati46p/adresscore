// Eko-punkty odpadów w Warszawie (#234): odległość od adresu do najbliższego stałego punktu
// z API dane.um.warszawa.pl (action get_bos_ekopunkty, JSON z polami szerokosc/dlugosc, 775 punktów).
// Punkt ma listę typów (typ_punktu). Wchodzą punkty z co najmniej jednym typem stałym: Miejski Punkt
// Elektroodpadów, odbiór przeterminowanych leków, pojemnik na małe elektrośmieci, Punkt
// Selektywnego Zbierania Odpadów Komunalnych. Odpadają punkty wyłącznie mobilne (zbiórka
// objazdowa, brak stałego miejsca) i jadłodzielnie (wymiana jedzenia, to nie odpady).
// Uruchom: ADRESCORE_MIASTO=warszawa node etl/warszawa-ekopunkty.mjs
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pobierzAction, ramkaAdresow, wRamce, wymagajWarszawy } from './lib/warszawa-api.mjs'
import { zapiszOdleglosc } from './lib/warszawa-wskaznik.mjs'
import { MIASTO, wczytajAdresy } from './lib/wspolne.mjs'

export const ACTION = 'get_bos_ekopunkty'
const WYKLUCZONE = /^(mobilny|jadłodzielnia)/i

/** Czy typ punktu to stałe miejsce oddania odpadów. */
export const typStaly = (rodzaj) => !WYKLUCZONE.test(String(rodzaj ?? '').trim())

/** Punkty { lon, lat, atr } ze stałymi typami; reszta jest liczona w `odrzucone` z powodem. */
export function punktyEkopunktow(rekordy) {
  const punkty = []
  const odrzucone = { bezWspolrzednych: 0, tylkoMobilneLubJadlodzielnie: 0 }
  for (const r of rekordy) {
    const lon = Number(r.dlugosc)
    const lat = Number(r.szerokosc)
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || lon === 0 || lat === 0) {
      odrzucone.bezWspolrzednych++
      continue
    }
    const typy = (r.typ_punktu ?? []).map((t) => t.rodzaj)
    if (!typy.some(typStaly)) {
      odrzucone.tylkoMobilneLubJadlodzielnie++
      continue
    }
    punkty.push({ lon, lat, atr: { typy, dzielnica: r.dzielnica ?? null } })
  }
  return { punkty, odrzucone }
}

async function main() {
  wymagajWarszawy(MIASTO)
  const { result, pobrano } = await pobierzAction(ACTION)
  const { adresy } = wczytajAdresy()
  const ramka = ramkaAdresow(adresy)
  const { punkty: stale, odrzucone } = punktyEkopunktow(result)
  const punkty = stale.filter((p) => wRamce(p, ramka))
  const typy = {}
  for (const p of punkty) for (const t of p.atr.typy) typy[t] = (typy[t] ?? 0) + 1
  console.log(
    `Eko-punkty: ${result.length} rekordów, odrzucone ${JSON.stringify(odrzucone)}, poza ramką ${stale.length - punkty.length}, w użyciu ${punkty.length}; typy: ${JSON.stringify(typy)}`,
  )
  zapiszOdleglosc({
    id: 'ekopunkt_odleglosc',
    kategoria: 'codziennosc',
    nazwa: 'Najbliższy eko-punkt odpadów',
    opis: `Odległość do najbliższego stałego eko-punktu z rejestru m.st. Warszawy (${punkty.length} punktów: elektroodpady, przeterminowane leki, PSZOK). Większość to apteki z odbiorem leków, więc wartość mówi o najbliższym miejscu oddania któregoś z tych odpadów, nie każdego. Pominięto punkty mobilne (zbiórka objazdowa) i jadłodzielnie.`,
    zakres: [0, 1500],
    zadanie: 234,
    zrodlo: {
      nazwa: 'm.st. Warszawa – eko-punkty (Biuro Ochrony Środowiska)',
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
