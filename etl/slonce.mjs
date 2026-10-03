// Godziny słońca 21 grudnia przed fasadą adresu (zadanie #122): wskaźnik slonce_grudzien_h.
// Dane: obrysy i wysokości dachów GUGiK LoD1 2024 (public/dane/budynki-3d.geojson, powiat Kraków)
// oraz punkty adresowe MSIP. Model i jego ograniczenia: etl/lib/slonce.mjs i meta wskaźnika niżej.
// Uruchom: node etl/slonce.mjs [--watki=N] [--probka=N]. --probka liczy tylko pierwsze N adresów
// Krakowa i niczego nie zapisuje. Surowych pobrań nie ma – wszystko z plików w repo.
//
// Zasięg: budynki obejmują tylko miasto Kraków, więc adresy obwarzanka dostają null (brak danych),
// nie 0. Tak samo adres w Krakowie bez budynku bliżej niż MAX_ODL_FASADY.
import { readFileSync } from 'node:fs'
import { availableParallelism } from 'node:os'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
import {
  budynkiZGeoJson,
  D_MAX,
  etykietaFasady,
  MAX_ODL_FASADY,
  naMetry,
  probkiSlonca,
  SRODEK,
  udostepnijScene,
  zbudujScene,
} from './lib/slonce.mjs'
import { DANE, wczytajAdresy, zapiszWskaznik } from './lib/wspolne.mjs'

const argument = (nazwa) => process.argv.find((a) => a.startsWith(`--${nazwa}=`))?.split('=')[1]
const WATKI = Number(argument('watki') ?? Math.max(1, availableParallelism() - 1))
const PROBKA = argument('probka') ? Number(argument('probka')) : null
const PACZKA = 256

// Adresy, dla których ręcznie sprawdzamy, czy wynik ma sens (patrz zadanie #122).
const MIEJSCA_KONTROLNE = [
  ['Rynek Główny', '10'],
  ['Floriańska', '1'],
  ['Karmelicka', '1'],
  ['Plac Nowy', '1'],
  ['Józefa Dietla', '15'],
  ['Tadeusza Kościuszki', '1'],
  ['Aleja Jana Pawła II', '170'],
  ['Zamek Wawel', '1'],
]

const wspolna = (Typ, n) => new Typ(new SharedArrayBuffer(n * Typ.BYTES_PER_ELEMENT))
const odczyt = (plik) => JSON.parse(readFileSync(join(DANE, plik), 'utf8'))
const sekundy = (od) => ((performance.now() - od) / 1000).toFixed(1)

const start = performance.now()
const { adresy } = wczytajAdresy()
const geojson = odczyt('budynki-3d.geojson')
const metaBudynkow = odczyt('budynki-3d.meta.json')
const zrodloAdresow = odczyt('adresy.json').zrodla[0]
const scena = udostepnijScene(zbudujScene(budynkiZGeoJson(geojson.features)))
// Jedna trajektoria słońca dla całego miasta (środek Krakowa). Na skrajach miasta słońce stoi
// inaczej o najwyżej 0,2° (ok. 1,5 min przy wschodzie), czyli poniżej błędu samego modelu.
const slonce = probkiSlonca({ lat: SRODEK.lat, lon: SRODEK.lon })
const godzinaCET = (ms) => new Date(ms + 3_600_000).toISOString().slice(11, 19)
console.log(
  `Budynki: ${geojson.features.length}, krawędzi ${scena.liczbaKrawedzi}. Słońce 21.12: wschód ${godzinaCET(slonce.wschodMs)}, zachód ${godzinaCET(slonce.zachodMs)} (CET), ${slonce.dlugoscH.toFixed(2)} h, ${slonce.n} próbek. Wczytanie ${sekundy(start)} s.`,
)

const N = adresy.length
const x = wspolna(Float64Array, N)
const y = wspolna(Float64Array, N)
const wKrakowie = []
adresy.forEach((a, i) => {
  ;[x[i], y[i]] = naMetry(a.lon, a.lat)
  if (a.gmina === 'Kraków') wKrakowie.push(i)
})
const doLiczenia = wspolna(
  Int32Array,
  PROBKA ? Math.min(PROBKA, wKrakowie.length) : wKrakowie.length,
)
doLiczenia.set(wKrakowie.slice(0, doLiczenia.length))
const godziny = wspolna(Float32Array, N).fill(Number.NaN)
const strony = wspolna(Uint8Array, N).fill(255)
const licznik = new Int32Array(new SharedArrayBuffer(4))

const obliczenia = performance.now()
const policzone = await Promise.all(
  Array.from(
    { length: WATKI },
    () =>
      new Promise((resolve, reject) => {
        const watek = new Worker(new URL('./slonce-worker.mjs', import.meta.url), {
          workerData: {
            scena,
            slonce,
            x,
            y,
            doLiczenia,
            licznik,
            godziny,
            strony,
            paczka: PACZKA,
          },
        })
        watek.once('message', (m) => resolve(m.policzone))
        watek.once('error', reject)
        watek.once(
          'exit',
          (kod) => kod !== 0 && reject(new Error(`Wątek zakończył się kodem ${kod}`)),
        )
      }),
  ),
)
const razem = policzone.reduce((a, b) => a + b, 0)
console.log(
  `Obliczenia: ${doLiczenia.length} adresów Krakowa, ${WATKI} wątków, ${sekundy(obliczenia)} s. Z fasadą w ${MAX_ODL_FASADY} m: ${razem} (${((100 * razem) / doLiczenia.length).toFixed(1)}%).`,
)

// Kontrola: średnia godzin wg strony fasady. Fasady od północy muszą mieć dokładnie 0 h (słońce
// 21.12 świeci z azymutów ok. 127°–233°), południowe najwięcej – inaczej coś jest odwrócone.
const wgStrony = Array.from({ length: 8 }, () => ({ n: 0, suma: 0, zero: 0 }))
for (let k = 0; k < doLiczenia.length; k++) {
  const i = doLiczenia[k]
  if (Number.isNaN(godziny[i])) continue
  const s = wgStrony[strony[i]]
  s.n++
  s.suma += godziny[i]
  if (godziny[i] === 0) s.zero++
}
for (const [j, s] of wgStrony.entries())
  console.log(
    `  fasada ${etykietaFasady(j).padEnd(10)} n=${String(s.n).padStart(6)}  średnio ${(s.suma / Math.max(1, s.n)).toFixed(2)} h  0 h: ${((100 * s.zero) / Math.max(1, s.n)).toFixed(0)}%`,
  )
const policzoneWartosci = [...doLiczenia]
  .map((i) => godziny[i])
  .filter((v) => !Number.isNaN(v))
  .sort((a, b) => a - b)
const kwantyl = (p) => policzoneWartosci[Math.floor(p * (policzoneWartosci.length - 1))].toFixed(2)
console.log(
  `  kwantyle (h): p10 ${kwantyl(0.1)}, p25 ${kwantyl(0.25)}, p50 ${kwantyl(0.5)}, p75 ${kwantyl(0.75)}, p90 ${kwantyl(0.9)}, max ${kwantyl(1)}`,
)
console.log('Miejsca kontrolne:')
for (const [ulica, nr] of MIEJSCA_KONTROLNE) {
  const a = adresy.find((p) => p.gmina === 'Kraków' && p.ulica === ulica && p.nr === nr)
  if (!a) console.log(`  ${ulica} ${nr}: brak w adresach`)
  else if (Number.isNaN(godziny[a.i]))
    console.log(`  ${ulica} ${nr}: brak danych (brak budynku przy adresie)`)
  else
    console.log(
      `  ${`${ulica} ${nr}`.padEnd(30)} ${etykietaFasady(strony[a.i]).padEnd(18)} ${godziny[a.i].toFixed(1)} h`,
    )
}

if (PROBKA) {
  console.log('Tryb --probka: wskaźnika nie zapisano.')
  process.exit(0)
}

const wartosci = adresy.map((_, i) =>
  Number.isNaN(godziny[i]) ? null : Math.round(godziny[i] * 10) / 10,
)
const etykiety = adresy.map((_, i) => (Number.isNaN(godziny[i]) ? null : etykietaFasady(strony[i])))

zapiszWskaznik(
  {
    id: 'slonce_grudzien_h',
    kategoria: 'spokoj',
    nazwa: 'Słońce 21 grudnia',
    opis: `Godziny bezpośredniego słońca 21 grudnia, w najkrótszy dzień roku (bez przeszkód ${slonce.dlugoscH.toFixed(1).replace('.', ',')} h). Liczone w punkcie 1 m przed fasadą najbliższą punktowi adresowemu, na wysokości okna najwyższej kondygnacji (do 6 m); etykieta podaje, w którą stronę świata patrzy fasada. Słońce co minutę wg wzoru NOAA, zasłaniają je bryły budynków LoD1 GUGiK w promieniu ${D_MAX / 1000} km, a słońce za płaszczyzną fasady nie świeci, więc fasada od północy ma zawsze 0 h. Bez drzew, terenu i budynków spoza modelu; przy granicy miasta brak zasłon z sąsiednich gmin. Tylko adresy w Krakowie z budynkiem bliżej niż ${MAX_ODL_FASADY} m od punktu adresowego, reszta bez danych.`,
    jednostka: 'h',
    kierunek: 'wiecej-lepiej',
    rozdzielczosc: 'adres',
    zakres: [0, 8],
    zadanie: 122,
    zrodla: [
      {
        nazwa: `${metaBudynkow.nazwa} – obrysy i wysokości dachów`,
        url: metaBudynkow.url,
        licencja: metaBudynkow.licencja,
        dataDanych: String(metaBudynkow.rocznikModelu),
        pobrano: metaBudynkow.pobrano,
      },
      {
        nazwa:
          'Gmina Miejska Kraków, Portal MSIP Obserwatorium (https://msip.krakow.pl) – punkty adresowe EMUiA',
        url: zrodloAdresow.url,
        licencja: zrodloAdresow.licencja,
        dataDanych: zrodloAdresow.dataDanych,
        pobrano: zrodloAdresow.pobrano,
      },
    ],
  },
  wartosci,
  etykiety,
)
console.log(`Czas całkowity: ${sekundy(start)} s`)
