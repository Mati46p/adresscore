// Warstwa: powietrze (zadanie #7) – roczne średnie PM2,5, PM10, NO2 i BaP z modelu GIOŚ.
//
// Źródło: GIOŚ, „Modelowanie na potrzeby ocen" (mapy rozkładów stężeń do rocznej oceny jakości
//   powietrza), https://powietrze.gios.gov.pl/pjp/maps/modeling. Dane z usługi ArcGIS GIOŚ
//   (wody.gios.gov.pl), warstwy „<rok> Ochrona zdrowia <wskaźnik> (śr. roczna)", wielokąty oczek.
// Licencja: ponowne wykorzystanie informacji sektora publicznego. Wymagane wskazanie źródła
//   („Źródło danych: GIOŚ - EKOINFONET") i informacja o przetworzeniu. Przetworzenie tutaj:
//   adres dostaje wartość oczka, w którym leży.
// Co liczy: dla każdego adresu średnią roczną stężenia z oczka modelu (µg/m³, BaP w ng/m³).
//   Rozmiar oczka wynika z danych: siatka drobna 0,005° (ok. 360 × 560 m) i gruba 0,025°
//   (ok. 1,8 × 2,8 km), nakładają się, wygrywa drobniejsze oczko.
//   Najnowszy rok z kompletem wskaźników wykrywa skrypt sam.
// Stacje pomiarowe nie wchodzą do wartości. Porównanie ze stacjami: node etl/powietrze-kontrola.mjs.
// Uruchom: node etl/powietrze.mjs (surowe pobrania trafiają do etl/.cache, drugi bieg ich używa).

import {
  bboxAdresow,
  doPuwg,
  indeksOczek,
  pobierzOczka,
  WSKAZNIKI,
  znajdzRok,
} from './lib/powietrze.mjs'
import { dzis, wczytajAdresy, zapiszWskaznik } from './lib/wspolne.mjs'

const { adresy } = wczytajAdresy()
const { rok, warstwy } = await znajdzRok()
const bbox = bboxAdresow(adresy)
console.log(`Rok modelu: ${rok}, obszar EPSG:2180: ${bbox.join(', ')}`)

const punkty = adresy.map((a) => doPuwg(a.lon, a.lat))

const METADANE = {
  'PM2.5': {
    nazwa: 'PM2,5 – średnia roczna',
    jednostka: 'µg/m³',
    zakres: [5, 30],
    norma: {
      wartosc: 5,
      opis: 'Wytyczna WHO 2021 (średnia roczna). Norma UE: 25 µg/m³ dziś (faza II: 20), 10 µg/m³ od 2030',
      zrodlo: 'WHO AQG 2021; dyrektywy 2008/50/WE i 2024/2881',
    },
    opis: (r) =>
      `Średnie roczne stężenie pyłu PM2,5 z modelu GIOŚ za ${r}, w oczku siatki. Pył drobny, wnika głęboko do płuc. Wytyczna WHO 2021: 5 µg/m³. UE: 25 µg/m³ (faza II 20), od 2030 dyrektywa 2024/2881 obniża do 10 µg/m³.`,
  },
  PM10: {
    nazwa: 'PM10 – średnia roczna',
    jednostka: 'µg/m³',
    zakres: [10, 50],
    norma: {
      wartosc: 15,
      opis: 'Wytyczna WHO 2021 (średnia roczna). Norma UE: 40 µg/m³ dziś, 20 µg/m³ od 2030',
      zrodlo: 'WHO AQG 2021; dyrektywy 2008/50/WE i 2024/2881',
    },
    opis: (r) =>
      `Średnie roczne stężenie pyłu PM10 z modelu GIOŚ za ${r}, w oczku siatki. Wytyczna WHO 2021: 15 µg/m³. UE: 40 µg/m³, od 2030 dyrektywa 2024/2881 obniża do 20 µg/m³.`,
  },
  NO2: {
    nazwa: 'NO2 – średnia roczna',
    jednostka: 'µg/m³',
    zakres: [5, 50],
    norma: {
      wartosc: 10,
      opis: 'Wytyczna WHO 2021 (średnia roczna). Norma UE: 40 µg/m³ dziś, 20 µg/m³ od 2030',
      zrodlo: 'WHO AQG 2021; dyrektywy 2008/50/WE i 2024/2881',
    },
    opis: (r) =>
      `Średnie roczne stężenie dwutlenku azotu z modelu GIOŚ za ${r}, w oczku siatki. Źródło: głównie ruch drogowy. Wytyczna WHO 2021: 10 µg/m³. UE: 40 µg/m³, od 2030 dyrektywa 2024/2881 obniża do 20 µg/m³.`,
  },
  BaP: {
    nazwa: 'Benzo(a)piren – średnia roczna',
    jednostka: 'ng/m³',
    zakres: [0, 4],
    norma: {
      wartosc: 1,
      opis: 'Poziom docelowy UE (średnia roczna). WHO 2021 nie podaje wytycznej dla BaP',
      zrodlo: 'Dyrektywa 2004/107/WE; dyrektywa 2024/2881 (1 ng/m³ od 2030)',
    },
    opis: (r) =>
      `Średnie roczne stężenie benzo(a)pirenu (rakotwórczy składnik pyłu, głównie ze spalania węgla i drewna w piecach) z modelu GIOŚ za ${r}, w oczku siatki. Poziom docelowy UE: 1 ng/m³, ta sama wartość w dyrektywie 2024/2881 od 2030. WHO nie ma wytycznej dla BaP.`,
  },
}

const zaokr10 = (m) => Math.round(m / 10) * 10
const mediana = (t) => [...t].sort((a, b) => a - b)[Math.floor(t.length / 2)]
const wymiar = (m) =>
  m >= 1000 ? `${(m / 1000).toFixed(1).replace('.', ',')} km` : `${zaokr10(m)} m`
/** Rozmiar oczek z danych. Siatka jest dwustopniowa (drobna 0,005°, gruba 0,025°), więc opisujemy obie. */
const opisRozmiaru = (uzyte, adresyWOczku) => {
  const klasy = { drobna: [], gruba: [] }
  for (const o of uzyte) klasy[o.x1 - o.x0 < 1000 ? 'drobna' : 'gruba'].push(o)
  const udzial = (l) => l.reduce((s, o) => s + (adresyWOczku.get(o.fid) ?? 0), 0)
  const razem = udzial(uzyte)
  const czesci = Object.entries(klasy)
    .filter(([, l]) => l.length)
    .map(([, l]) => ({
      txt: `${wymiar(mediana(l.map((o) => o.x1 - o.x0)))} × ${wymiar(mediana(l.map((o) => o.y1 - o.y0)))}`,
      n: udzial(l),
    }))
    .sort((a, b) => b.n - a.n)
  if (czesci.length === 1) return `ok. ${czesci[0].txt}`
  return `ok. ${czesci.map((c) => `${c.txt} (${Math.round((100 * c.n) / razem)}% adresów)`).join(', ')}`
}

for (const [wskaznik, idWarstwy] of Object.entries(warstwy)) {
  const m = METADANE[wskaznik]
  const oczka = await pobierzOczka(rok, wskaznik, idWarstwy, bbox)
  const znajdz = indeksOczek(oczka)
  const wartosci = []
  const uzyte = new Map()
  const liczba = new Map()
  for (const [x, y] of punkty) {
    const o = znajdz(x, y)
    if (!o || o.v === null) {
      wartosci.push(null)
      continue
    }
    wartosci.push(o.v)
    uzyte.set(o.fid, o)
    liczba.set(o.fid, (liczba.get(o.fid) ?? 0) + 1)
  }
  const rozmiar = opisRozmiaru([...uzyte.values()], liczba)
  console.log(
    `${wskaznik}: oczek w obszarze ${oczka.length}, użytych ${uzyte.size}, rozmiar ${rozmiar}`,
  )

  zapiszWskaznik(
    {
      id: WSKAZNIKI[wskaznik].id,
      kategoria: 'spokoj',
      nazwa: m.nazwa,
      opis: m.opis(rok),
      jednostka: m.jednostka,
      kierunek: 'mniej-lepiej',
      rozdzielczosc: 'siatka',
      rozmiar,
      zakres: m.zakres,
      zadanie: 7,
      norma: m.norma,
      zrodla: [
        {
          nazwa: `GIOŚ – Modelowanie na potrzeby ocen, ${rok}, ${wskaznik}, średnia roczna (Źródło danych: GIOŚ - EKOINFONET)`,
          url: 'https://powietrze.gios.gov.pl/pjp/maps/modeling',
          licencja:
            'Ponowne wykorzystanie informacji sektora publicznego; wymagane wskazanie źródła GIOŚ - EKOINFONET i informacja o przetworzeniu (wartość oczka przypisana adresowi)',
          dataDanych: rok,
          pobrano: dzis(),
        },
        // Uzupełnienie (decyzja #63): wartość zostaje z GIOŚ, odczyt czujników to osobna
        // warstwa kontekstowa powietrze_inpost_indeks (#80) bez wpływu na wynik.
        ...(wskaznik.startsWith('PM')
          ? [
              {
                nazwa:
                  'Uzupełnienie: indeks z czujników paczkomatów InPost (migawka, źródło nieoficjalne) – warstwa „Powietrze – czujnik w paczkomacie”',
                url: 'https://api-shipx-pl.easypack24.net/v1/points',
                licencja:
                  'Dane operatora prywatnego bez licencji otwartej; nie zmieniają wartości GIOŚ ani wyniku',
                dataDanych: dzis(),
                pobrano: dzis(),
              },
            ]
          : []),
      ],
    },
    wartosci,
  )
}
