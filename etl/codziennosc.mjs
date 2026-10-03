// Warstwa „codzienność pieszo" (#8): odległość w linii prostej od adresu do najbliższego
//   – sklepu spożywczego (OpenStreetMap, Geofabrik malopolskie-latest, ODbL),
//   – apteki (Rejestr Aptek, Centrum e-Zdrowia, CC BY 4.0 – dane otwarte),
//   – publicznej szkoły podstawowej i przedszkola (SIO/RSPO, MEN, CC BY 4.0),
//   – żłobka lub klubu dziecięcego (Rejestr Żłobków i Klubów Dziecięcych, MRPiPS, CC0 1.0),
//   – gabinetu lekarza POZ (RPWDL, Centrum e-Zdrowia, CC BY 4.0),
// oraz liczba rodzajów usług w promieniu 1200 m w linii prostej.
// Szkoły, apteki i POZ nie mają współrzędnych w rejestrach – geokodujemy adresy usługą GUGiK UUG.
// Uruchom: node etl/codziennosc.mjs. Surowe dane trafiają do etl/.cache, drugi bieg ich nie pobiera.
// Wynik: public/dane/wskazniki/{sklep,apteka,szkola_podst,przedszkole,zlobek,przychodnia}_odleglosc.json
// i uslugi_15min.json. Odległość jest w linii prostej – bez sieci pieszej.
import { pathToFileURL } from 'node:url'
import { czytelnaNazwa, czyWPromieniu, indeksPunktow } from './lib/codziennosc-geo.mjs'
import {
  apteki,
  przedszkola,
  przychodniePoz,
  punktyOsm,
  szkolyPodstawowe,
  zlobki,
} from './lib/codziennosc-zrodla.mjs'
import { dzis, wczytajAdresy, zapiszWskaznik } from './lib/wspolne.mjs'

const ZADANIE = 8
const PROMIEN_15MIN = 1200
const MAX_SZUKANIE = 15_000

const zrodlo = (nazwa, url, licencja, dataDanych) => ({
  nazwa,
  url,
  licencja,
  dataDanych,
  pobrano: dzis(),
})

const zrodlaDanych = ({ stanOsm, stanRpwdl }) => ({
  osm: zrodlo(
    'OpenStreetMap, ekstrakt Geofabrik – małopolskie (sklepy, gastronomia, banki, poczta, biblioteki)',
    'https://download.geofabrik.de/europe/poland/malopolskie.html',
    'Open Database License (ODbL) 1.0, https://www.openstreetmap.org/copyright; © OpenStreetMap contributors',
    stanOsm ?? dzis(),
  ),
  // Stan SIO wynika z nazwy zasobu na dane.gov.pl, stan żłobków z daty zasobu (2026-09-30).
  sio: zrodlo(
    'SIO – Wykaz szkół i placówek oświatowych wg stanu bazy na 30.09.2025 (MEN); adresy geokodowane usługą GUGiK UUG',
    'https://dane.gov.pl/pl/dataset/839,wykaz-szkol-i-placowek-oswiatowych',
    'CC BY 4.0',
    '2025-09-30',
  ),
  zlobki: zrodlo(
    'Rejestr Żłobków i Klubów Dziecięcych – lista instytucji (MRPiPS)',
    'https://dane.gov.pl/pl/dataset/29751,rejestr-zlobkow-lista-instytucji',
    'CC0 1.0',
    '2026-09-30',
  ),
  // Rejestr Aptek to żywy rejestr, więc „stan" to dzień pobrania.
  apteki: zrodlo(
    'Rejestr Aptek Ogólnodostępnych i Punktów Aptecznych (Centrum e-Zdrowia); adresy geokodowane usługą GUGiK UUG',
    'https://rejestry.ezdrowie.gov.pl/ra/search/public',
    'Dane publiczne rejestru, jawne z mocy ustawy – Prawo farmaceutyczne',
    dzis(),
  ),
  rpwdl: zrodlo(
    'Rejestr Podmiotów Wykonujących Działalność Leczniczą – komórki „poradnia (gabinet) lekarza POZ" (Centrum e-Zdrowia); adresy geokodowane usługą GUGiK UUG',
    'https://dane.gov.pl/pl/dataset/728,rejestr-podmiotow-wykonujacych-dzialalnosc-lecznicza',
    'CC BY 4.0',
    stanRpwdl ?? dzis(),
  ),
})

/** „Biedronka, 140 m". Bez nazwy: opis rodzaju. */
const etykieta = (nazwa, metry, domyslna) =>
  `${czytelnaNazwa(nazwa) || domyslna}, ${Math.round(metry)} m`

/**
 * Najbliższy punkt dla każdego adresu. Zwraca { wartosci, etykiety }.
 * Brak punktu w promieniu MAX_SZUKANIE = null (brak danych), nie 0.
 */
function odleglosci(adresy, punkty, domyslnaNazwa) {
  const najblizszy = indeksPunktow(punkty)
  const wartosci = []
  const etykiety = []
  for (const a of adresy) {
    const w = najblizszy(a.lat, a.lon, MAX_SZUKANIE)
    wartosci.push(w ? Math.round(w.metry) : null)
    etykiety.push(w ? etykieta(w.punkt.nazwa, w.metry, domyslnaNazwa) : null)
  }
  return { wartosci, etykiety }
}

const raportZrodla = (nazwa, s) =>
  console.log(
    s.razem === undefined
      ? `${nazwa}: ${s.punkty.length} punktów w obszarze`
      : `${nazwa}: ${s.punkty.length} punktów w obszarze (z ${s.razem} wpisów, adres znaleziono dla ${s.trafione})`,
  )

export async function licz() {
  const { adresy } = wczytajAdresy()
  const t0 = Date.now()
  console.log(`Adresy: ${adresy.length}`)

  const { stan: stanOsm, rodzaje: osm } = await punktyOsm()
  const oswiata = { sp: await szkolyPodstawowe(), przedszkole: await przedszkola() }
  const zlob = await zlobki()
  const apt = await apteki()
  const poz = await przychodniePoz()
  const Z = zrodlaDanych({ stanOsm, stanRpwdl: poz.stan })
  raportZrodla('OSM sklepy', { punkty: osm.sklep })
  raportZrodla('szkoły podstawowe', oswiata.sp)
  raportZrodla('przedszkola', oswiata.przedszkole)
  raportZrodla('żłobki i kluby', zlob)
  raportZrodla('apteki', apt)
  raportZrodla('POZ', poz)
  const tLiczenie = Date.now()

  const warstwy = [
    {
      meta: {
        id: 'sklep_odleglosc',
        nazwa: 'Najbliższy sklep spożywczy',
        opis: 'Odległość w linii prostej do najbliższego sklepu spożywczego z OpenStreetMap. Liczymy supermarkety, sklepy osiedlowe (convenience), warzywniaki, piekarnie i sklepy mięsne, bo tam robisz codzienne zakupy. Pomijamy drogerie i kioski.',
        zakres: [0, 1500],
        zrodla: [Z.osm],
      },
      punkty: osm.sklep,
      domyslna: 'Sklep spożywczy',
    },
    {
      meta: {
        id: 'apteka_odleglosc',
        nazwa: 'Najbliższa apteka',
        opis: 'Odległość w linii prostej do najbliższej czynnej apteki ogólnodostępnej lub punktu aptecznego z Rejestru Aptek. Apteki szpitalne nie są liczone.',
        zakres: [0, 2500],
        zrodla: [Z.apteki],
      },
      punkty: apt.punkty,
      domyslna: 'Apteka',
    },
    {
      meta: {
        id: 'szkola_podst_odleglosc',
        nazwa: 'Najbliższa szkoła podstawowa',
        opis: 'Odległość w linii prostej do najbliższej publicznej szkoły podstawowej (SIO, stan 30.09.2025). Szkoły specjalne nie są liczone. To odległość, a nie obwód szkolny: dziecko może należeć do innej szkoły.',
        zakres: [0, 2000],
        zrodla: [Z.sio],
      },
      punkty: oswiata.sp.punkty,
      domyslna: 'Szkoła podstawowa',
    },
    {
      meta: {
        id: 'przedszkole_odleglosc',
        nazwa: 'Najbliższe przedszkole',
        opis: 'Odległość w linii prostej do najbliższego przedszkola, punktu przedszkolnego albo oddziału przedszkolnego przy szkole podstawowej (SIO, stan 30.09.2025), publicznych i niepublicznych. Placówki specjalne nie są liczone.',
        zakres: [0, 1500],
        zrodla: [Z.sio],
      },
      punkty: oswiata.przedszkole.punkty,
      domyslna: 'Przedszkole',
    },
    {
      meta: {
        id: 'zlobek_odleglosc',
        nazwa: 'Najbliższy żłobek',
        opis: 'Odległość w linii prostej do najbliższego żłobka lub klubu dziecięcego z Rejestru Żłobków i Klubów Dziecięcych. Nie liczymy placówek z zawieszoną działalnością. Rejestr nie mówi, czy są wolne miejsca.',
        zakres: [0, 3000],
        zrodla: [Z.zlobki],
      },
      punkty: zlob.punkty,
      domyslna: 'Żłobek',
    },
    {
      meta: {
        id: 'przychodnia_odleglosc',
        nazwa: 'Najbliższa przychodnia POZ',
        opis: 'Odległość w linii prostej do najbliższego gabinetu lekarza podstawowej opieki zdrowotnej wpisanego do Rejestru Podmiotów Wykonujących Działalność Leczniczą. Rejestr nie potwierdza umowy z NFZ ani wolnych miejsc w deklaracjach.',
        zakres: [0, 3000],
        zrodla: [Z.rpwdl],
      },
      punkty: poz.punkty,
      domyslna: 'Gabinet POZ',
    },
  ]

  for (const w of warstwy) {
    const { wartosci, etykiety } = odleglosci(adresy, w.punkty, w.domyslna)
    zapiszWskaznik(
      {
        ...w.meta,
        kategoria: 'codziennosc',
        jednostka: 'm',
        kierunek: 'mniej-lepiej',
        rozdzielczosc: 'adres',
        zadanie: ZADANIE,
      },
      wartosci,
      etykiety,
    )
  }

  zapiszUslugi15min(adresy, warstwy, osm, Z)
  console.log(
    `Czas: pobieranie i geokodowanie ${((tLiczenie - t0) / 1000).toFixed(1)} s, liczenie ${((Date.now() - tLiczenie) / 1000).toFixed(1)} s`,
  )
}

/** Rodzaje usług liczone w uslugi_15min: sześć warstw powyżej plus cztery z OSM. */
function zapiszUslugi15min(adresy, warstwy, osm, Z) {
  const rodzaje = [
    ...warstwy.map((w) => ({
      nazwa: {
        sklep_odleglosc: 'sklep spożywczy',
        apteka_odleglosc: 'apteka',
        szkola_podst_odleglosc: 'szkoła podstawowa',
        przedszkole_odleglosc: 'przedszkole',
        zlobek_odleglosc: 'żłobek',
        przychodnia_odleglosc: 'przychodnia POZ',
      }[w.meta.id],
      punkty: w.punkty,
    })),
    { nazwa: 'gastronomia', punkty: osm.gastro },
    { nazwa: 'bank lub bankomat', punkty: osm.bank },
    { nazwa: 'poczta lub paczkomat', punkty: osm.poczta },
    { nazwa: 'biblioteka', punkty: osm.biblioteka },
  ]
  const indeksy = rodzaje.map((r) => indeksPunktow(r.punkty))
  const wartosci = []
  const etykiety = []
  for (const a of adresy) {
    const brak = []
    let ile = 0
    rodzaje.forEach((r, i) => {
      if (czyWPromieniu(indeksy[i], a.lat, a.lon, PROMIEN_15MIN)) ile++
      else brak.push(r.nazwa)
    })
    wartosci.push(ile)
    etykiety.push(
      brak.length ? `Brak w 1200 m: ${brak.join(', ')}` : 'Wszystkie rodzaje usług w 1200 m',
    )
  }
  zapiszWskaznik(
    {
      id: 'uslugi_15min',
      kategoria: 'codziennosc',
      nazwa: 'Rodzaje usług w promieniu 1,2 km',
      opis: `Liczba rodzajów usług (z ${rodzaje.length}) w promieniu 1200 m w linii prostej: ${rodzaje.map((r) => r.nazwa).join(', ')}. Każdy rodzaj liczy się raz, bez względu na liczbę punktów. Rzeczywista droga piesza i czas dojścia mogą być dłuższe.`,
      jednostka: 'rodzajów',
      kierunek: 'wiecej-lepiej',
      rozdzielczosc: 'adres',
      zakres: [0, rodzaje.length],
      zadanie: ZADANIE,
      zrodla: [Z.osm, Z.sio, Z.zlobki, Z.apteki, Z.rpwdl],
    },
    wartosci,
    etykiety,
  )
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await licz()
