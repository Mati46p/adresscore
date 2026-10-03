// Atrapa danych, żeby E3 (wynik, karta, mapa) pracował, zanim ETL dostarczy prawdziwe warstwy.
// node etl/atrapa.mjs            – atrapa adresów (tylko gdy brak adresy.json) + atrapa wskaźników
// node etl/atrapa.mjs wskazniki  – przelicza wyłącznie wskaźniki z meta.atrapa (po nowych adresach)
// Prawdziwy wskaźnik o tym samym id nadpisuje plik atrapy; atrapa nigdy nie nadpisze prawdziwego.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { latLngToCell } from 'h3-js'
import { DANE, dzis, wczytajAdresy, wersjaAdresow, zapiszWskaznik } from './lib/wspolne.mjs'

// Deterministyczny generator – każdy bieg daje te same liczby.
let ziarno = 46
const los = () => {
  ziarno = (ziarno * 1103515245 + 12345) % 2147483648
  return ziarno / 2147483648
}

const sciezkaAdresow = join(DANE, 'adresy.json')
if (process.argv[2] !== 'wskazniki' && !existsSync(sciezkaAdresow)) {
  const ulice = [
    'Długa',
    'Karmelicka',
    'Wielicka',
    'Kamieńskiego',
    'Bora-Komorowskiego',
    'Nowohucka',
  ]
  const dzielnice = [
    'I Stare Miasto',
    'V Krowodrza',
    'XIII Podgórze',
    'XIV Czyżyny',
    'XVIII Nowa Huta',
  ]
  const k = {
    id: [],
    miejscowosc: [],
    ulica: [],
    nr: [],
    kod: [],
    dzielnica: [],
    gmina: [],
    teryt: [],
    lon: [],
    lat: [],
    h3: [],
  }
  for (let i = 0; i < 3000; i++) {
    const lat = +(49.98 + los() * 0.13).toFixed(6)
    const lon = +(19.8 + los() * 0.28).toFixed(6)
    k.id.push(`atrapa-${i}`)
    k.miejscowosc.push('Kraków')
    k.ulica.push(ulice[i % ulice.length])
    k.nr.push(String(1 + (i % 120)))
    k.kod.push('30-001')
    k.dzielnica.push(dzielnice[i % dzielnice.length])
    k.gmina.push('Kraków')
    k.teryt.push('1261011')
    k.lon.push(lon)
    k.lat.push(lat)
    k.h3.push(latLngToCell(lat, lon, 10))
  }
  const zrodlo = {
    nazwa: 'Atrapa',
    url: 'about:blank',
    licencja: '-',
    dataDanych: dzis(),
    pobrano: dzis(),
  }
  mkdirSync(DANE, { recursive: true })
  writeFileSync(
    sciezkaAdresow,
    JSON.stringify({ wersja: wersjaAdresow(k), zrodla: [zrodlo], atrapa: true, kolumny: k }),
  )
  console.log('adresy.json: atrapa 3000 punktów')
}

const { adresy } = wczytajAdresy()
const ZRODLO = [
  {
    nazwa: 'Atrapa (dane wymyślone)',
    url: 'about:blank',
    licencja: '-',
    dataDanych: dzis(),
    pobrano: dzis(),
  },
]
// Odległość od Rynku – atrapy mają przestrzenny sens (centrum głośniejsze, peryferie dalej od sklepów).
const odRynku = (a) => Math.hypot((a.lat - 50.0617) * 111, (a.lon - 19.9373) * 71.5)

const atrapy = [
  {
    id: 'sklep_odleglosc',
    kategoria: 'codziennosc',
    nazwa: 'Najbliższy sklep spożywczy',
    opis: 'Odległość w linii prostej do sklepu spożywczego (OSM).',
    jednostka: 'm',
    kierunek: 'mniej-lepiej',
    rozdzielczosc: 'adres',
    zakres: [0, 2000],
    zadanie: 8,
    f: (a) => 80 + odRynku(a) * 60 * los(),
  },
  {
    id: 'przystanek_odleglosc',
    kategoria: 'transport',
    nazwa: 'Najbliższy przystanek',
    opis: 'Odległość do przystanku tramwaju lub autobusu (GTFS ZTP).',
    jednostka: 'm',
    kierunek: 'mniej-lepiej',
    rozdzielczosc: 'adres',
    zakres: [0, 1500],
    zadanie: 5,
    f: (a) => 60 + odRynku(a) * 40 * los(),
    e: () => 'Rondo Mogilskie',
  },
  {
    id: 'halas_ldwn',
    kategoria: 'spokoj',
    nazwa: 'Hałas drogowy (LDWN)',
    opis: 'Pasmo hałasu całodobowego z mapy akustycznej 2022.',
    jednostka: 'dB',
    kierunek: 'mniej-lepiej',
    rozdzielczosc: 'adres',
    zakres: [40, 80],
    zadanie: 4,
    norma: {
      wartosc: 64,
      opis: 'Dopuszczalny LDWN dla zabudowy mieszkaniowej',
      zrodlo: 'Rozporządzenie MŚ z 14.06.2007',
    },
    f: (a) => (los() < 0.05 ? null : Math.max(40, 72 - odRynku(a) * 2 + los() * 8)),
  },
  {
    id: 'pm25_srednia',
    kategoria: 'spokoj',
    nazwa: 'PM2,5 – średnia roczna',
    opis: 'Modelowane stężenie roczne (GIOŚ).',
    jednostka: 'µg/m³',
    kierunek: 'mniej-lepiej',
    rozdzielczosc: 'siatka',
    rozmiar: '1 km',
    zakres: [5, 30],
    zadanie: 7,
    norma: { wartosc: 5, opis: 'Wytyczna WHO 2021', zrodlo: 'WHO AQG 2021' },
    f: (a) => 14 + los() * 6 - odRynku(a) * 0.3,
  },
  {
    id: 'zielen_udzial',
    kategoria: 'spokoj',
    nazwa: 'Udział zieleni',
    opis: 'Odsetek powierzchni z roślinnością w oczku 100 m.',
    jednostka: '%',
    kierunek: 'wiecej-lepiej',
    rozdzielczosc: 'siatka',
    rozmiar: '100 m',
    zakres: [0, 100],
    zadanie: 6,
    f: (a) => Math.min(100, 10 + odRynku(a) * 6 + los() * 20),
  },
  {
    id: 'inwestycje_500m',
    kategoria: 'przyszlosc',
    nazwa: 'Pozwolenia na budowę w 500 m',
    opis: 'Liczba decyzji o pozwoleniu na budowę 2025–2026 w promieniu 500 m.',
    jednostka: 'szt.',
    kierunek: 'neutralny',
    rozdzielczosc: 'adres',
    zakres: [0, 50],
    zadanie: 27,
    f: () => Math.floor(los() * 30),
  },
  {
    id: 'powodz_1proc',
    kategoria: 'bezpieczenstwo',
    nazwa: 'Zagrożenie powodzią (1%)',
    opis: 'Głębokość wody przy powodzi raz na 100 lat; 0 = poza strefą.',
    jednostka: 'm',
    kierunek: 'mniej-lepiej',
    rozdzielczosc: 'adres',
    zakres: [0, 4],
    zadanie: 23,
    f: () => (los() < 0.08 ? los() * 2 : 0),
  },
  {
    id: 'cena_m2_mediana',
    kategoria: 'kontekst',
    nazwa: 'Mediana ceny m²',
    opis: 'Mediana ceny transakcyjnej m² mieszkań w promieniu 1 km (RCN).',
    jednostka: 'zł/m²',
    kierunek: 'neutralny',
    rozdzielczosc: 'heks',
    rozmiar: '1 km',
    zadanie: 26,
    f: (a) => 18000 - odRynku(a) * 600 + los() * 2000,
  },
]

for (const { f, e, ...meta } of atrapy) {
  const cel = join(DANE, 'wskazniki', `${meta.id}.json`)
  if (existsSync(cel) && !JSON.parse(readFileSync(cel, 'utf8')).meta.atrapa) continue
  zapiszWskaznik(
    { ...meta, zrodla: ZRODLO, atrapa: true },
    adresy.map((a) => f(a)),
    e ? adresy.map(e) : undefined,
  )
}
