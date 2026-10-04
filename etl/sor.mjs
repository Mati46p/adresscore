// Najbliższy SOR (#186): odległość w linii prostej od adresu do najbliższego czynnego szpitalnego
// oddziału ratunkowego w Małopolsce. Czasu dojazdu karetki nie ma w otwartych danych (#127), ale
// położenie SOR-ów jest w RPWDL: komórki z kodem resortowym VIII 4902 („szpitalny oddział ratunkowy").
// Izby przyjęć (4900, 4910) odpadają – to wejścia na planowe przyjęcia, także w szpitalach jednego dnia.
//
// RPWDL i cache geokodera UUG dzielimy z #8 (etl/.cache/rpwdl, etl/.cache/uug-cache-v2.json).
// Uruchom: node etl/sor.mjs
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { czytelnaNazwa, geokoduj, odlegloscMetry } from './lib/codziennosc-geo.mjs'
import { MIASTO_INFO, WOJEWODZTWO } from './lib/miasto.mjs'
import { wierszeKomorek } from './lib/uslugi-rpwdl.mjs'
import { CACHE, dzis, wczytajAdresy, zapiszWskaznik } from './lib/wspolne.mjs'

export const KOD_SOR = '4902'
/** Adres SOR-u geokodujemy do budynku, ale wejście na oddział bywa po drugiej stronie kampusu. */
export const KROK_M = 50

/** Klucz budynku: dwie komórki pod jednym adresem to jeden punkt na mapie. */
const kluczAdresu = (w) =>
  [w.miejscowosc, w.ulica, w.nr]
    .map((x) => `${x ?? ''}`.trim().replace(/\.$/, '').toLowerCase())
    .join('|')

/** Wiersze RPWDL → unikalne punkty { nazwa, miejscowosc, ulica, nr, kod }. */
export function unikalnePunkty(wiersze) {
  const mapa = new Map()
  for (const w of wiersze) {
    const k = kluczAdresu(w)
    if (!mapa.has(k)) mapa.set(k, { ...w, nr: `${w.nr}`.trim().replace(/\.$/, '') })
  }
  return [...mapa.values()]
}

/** Najbliższy SOR w linii prostej; przy remisie wygrywa wcześniejszy na liście. */
export function najblizszy(adres, sory) {
  if (!Number.isFinite(adres.lat) || !Number.isFinite(adres.lon)) return null
  let wynik = null
  for (const s of sory) {
    const metry = odlegloscMetry(adres.lat, adres.lon, s.lat, s.lon)
    if (!wynik || metry < wynik.metry) wynik = { sor: s, metry }
  }
  return wynik
}

export const zaokraglij = (metry, krok = KROK_M) => Math.round(metry / krok) * krok

function stanRpwdl() {
  try {
    const info = readFileSync(join(CACHE, 'rpwdl', 'Info.txt'), 'latin1')
    return info.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? null
  } catch {
    return null
  }
}

async function main() {
  const wiersze = await wierszeKomorek([KOD_SOR])
  const punkty = unikalnePunkty(wiersze)
  const geo = await geokoduj(punkty)
  const sory = []
  let pominiete = 0
  for (const [i, p] of punkty.entries()) {
    if (!geo[i]) {
      // Tryb miasta: SOR w odległej części województwa bez adresu w UUG nie zatrzymuje całej warstwy
      // (dla Krakowa każdy z ok. 20 SOR-ów musi mieć położenie, inaczej błąd).
      if (MIASTO_INFO) {
        console.warn(
          `SOR bez współrzędnych z UUG (pominięty): ${p.nazwa}, ${p.miejscowosc} ${p.ulica} ${p.nr}`,
        )
        pominiete++
        continue
      }
      throw new Error(
        `SOR bez współrzędnych z UUG: ${p.nazwa}, ${p.miejscowosc} ${p.ulica} ${p.nr}`,
      )
    }
    sory.push({ ...p, ...geo[i], etykieta: `${czytelnaNazwa(p.nazwa)} (${p.miejscowosc})` })
  }
  if (sory.length < (MIASTO_INFO ? 3 : 15))
    throw new Error(`Za mało SOR-ów w województwie ${WOJEWODZTWO}: ${sory.length}`)

  const { adresy } = wczytajAdresy()
  const wyniki = adresy.map((a) => najblizszy(a, sory))
  const wartosci = wyniki.map((w) => (w ? zaokraglij(w.metry) : null))
  const etykiety = wyniki.map((w) => w?.sor.etykieta ?? null)
  const maks = wartosci.reduce((m, v) => Math.max(m, v ?? 0), 0)
  const stan = stanRpwdl() ?? dzis()

  zapiszWskaznik(
    {
      id: 'sor_odleglosc',
      kategoria: 'bezpieczenstwo',
      nazwa: 'Najbliższy SOR',
      opis: `Odległość w linii prostej od adresu do najbliższego z ${sory.length} czynnych szpitalnych oddziałów ratunkowych w ${MIASTO_INFO ? `województwie ${WOJEWODZTWO}` : 'Małopolsce'} (RPWDL, stan na ${stan}). To nie jest czas dojazdu karetki – ten nie ma otwartych danych – ani trasa drogowa. Nie liczymy izb przyjęć, nocnej pomocy lekarskiej ani SOR-ów poza ${MIASTO_INFO ? `województwem ${WOJEWODZTWO}` : 'Małopolską'}, więc na skraju województwa odległość może być zawyżona. Adres szpitala geokodowany do budynku, stąd zaokrąglenie do 50 m. Etykieta podaje szpital.${pominiete ? ` Z rejestru pominięto ${pominiete} SOR bez położenia w geokoderze UUG.` : ''}`,
      jednostka: 'm',
      kierunek: 'mniej-lepiej',
      rozdzielczosc: 'adres',
      zakres: [0, Math.ceil(maks / 5_000) * 5_000],
      zadanie: 186,
      zrodla: [
        {
          nazwa:
            'Rejestr Podmiotów Wykonujących Działalność Leczniczą – komórki „szpitalny oddział ratunkowy" (kod 4902, Centrum e-Zdrowia); adresy geokodowane usługą GUGiK UUG',
          url: 'https://dane.gov.pl/pl/dataset/728,rejestr-podmiotow-wykonujacych-dzialalnosc-lecznicza',
          licencja: 'CC BY 4.0',
          dataDanych: stan,
          pobrano: dzis(),
        },
      ],
    },
    wartosci,
    etykiety,
  )

  console.log(`SOR: ${sory.length} punktów, najdalszy adres ${maks} m`)
  for (const s of sory) console.log(`  ${s.etykieta}: ${s.ulica} ${s.nr}`)
  const rozklad = new Map()
  for (const e of etykiety) rozklad.set(e, (rozklad.get(e) ?? 0) + 1)
  console.log(
    [...rozklad.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([e, n]) => `  ${e}: ${n} adresów`)
      .join('\n'),
  )
  for (const [miejscowosc, ulica, nr] of MIASTO_INFO
    ? []
    : [
        ['Kraków', 'Rynek Główny', '1'],
        ['Kraków', 'Rzepakowa', '10'],
        ['Wieliczka', 'Rynek Górny', '1'],
      ]) {
    const i = adresy.findIndex(
      (a) => a.miejscowosc === miejscowosc && a.ulica === ulica && a.nr === nr,
    )
    console.log(
      `Kontrola ${miejscowosc}, ${ulica} ${nr}: ${i < 0 ? 'brak adresu w PRG' : `${wartosci[i]} m – ${etykiety[i]}`}`,
    )
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1])
  main().catch((blad) => {
    console.error(blad)
    process.exitCode = 1
  })
