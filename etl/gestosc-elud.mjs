// Gęstość zameldowań stałych z MSIP (#74): wskaźnik gestosc_zaludnienia_100m dla adresów w Krakowie.
//
// Źródło: Gmina Miejska Kraków, Portal MSIP Obserwatorium (https://msip.krakow.pl), usługa ArcGIS
// REST Elud/Elud_Hex100/MapServer/0, czyli „Zameldowania stałe – siatka Hex 100m”: heksagony
// o boku 100 m (ok. 2,6 ha) z liczbą stałych zameldowań z bazy meldunkowej Urzędu Miasta Krakowa
// (pole r_ogolem) i datą stanu (pole na_dzien). Opis zbioru: https://msip.krakow.pl/dataset/2282.
// To agregat, nie adres, więc nie ma tu danych osobowych. Licencja: Regulamin MSIP, który zabrania
// ciągłego pośredniczenia w usługach miasta – dlatego jedno pobranie do etl/.cache/ i plik
// statyczny liczony skryptem. Obejmuje tylko Kraków: adres w gminie obwarzanka dostaje null.
//
// Decyzje (dlaczego):
//  - Wartość = liczba zameldowanych ÷ pole heksagonu w hektarach, z pola liczonego z geometrii
//    zwróconej przez usługę, a nie ze stałej 2,598 ha. Rozmiar siatki sprawdzamy osobno (bok
//    100 m, regularny sześciokąt): gdyby MSIP zmienił siatkę, skrypt staje, zamiast po cichu
//    opisywać inny rozmiar niż ten, z którego liczy.
//  - Brak heksagonu = null, nie 0. Najmniejsza liczba zameldowań w zbiorze to 3 (stan z 2024-06-30:
//    156 heksagonów z 3, 149 z 4, 163 z 5), a z 1 albo 2 nie ma żadnego, choć przy takim rozkładzie
//    powinny być liczne. Zbiór nie podaje więc małych liczebności, a adres w takim miejscu ma
//    „mniej niż 3 zameldowanych w heksagonie”, co nie jest zmierzonym zerem. Dotyczy ok. 5%
//    adresów Krakowa, rozproszonych po wszystkich dzielnicach (także tuż obok ludnych
//    heksagonów), więc „poza heksagonami” nie znaczy „na pustkowiu”. Dlatego `sprawdzZbior`
//    zatrzymuje skrypt, gdy w zbiorze pojawi się heksagon bez zameldowanych: wtedy brak
//    heksagonu miałby już inne znaczenie i opis wskaźnika by kłamał.
//  - Heksagon znajdujemy indeksem środków (kdbush) i testem punkt w wielokącie, a nie
//    arytmetyką siatki ani najbliższym środkiem: w siatce są dziury (heksagony bez wpisu),
//    a najbliższy środek przypisałby adres z dziury sąsiadowi z inną gęstością.
//  - Zameldowanie to nie zamieszkanie, więc kategoria „kontekst”, kierunek „neutralny”: wartość
//    nie wchodzi do wyniku adresu. Warstwa nie dubluje ludnosc_1km (NSP 2021, ludność wg miejsca
//    zwykłego pobytu w oczku 1 km): inna definicja, inna rozdzielczość, więc obie zostają,
//    a opis ostrzega przed mieszaniem.
//  - Zaokrąglenie do 0,1 os./ha: liczba zameldowanych to liczba całkowita w ok. 2,6 ha (jedna
//    osoba to 0,38 os./ha), więc dokładniejszy zapis sugerowałby precyzję, której nie ma.
//  - Bez `etykiety`: karta pokazuje liczbę z jednostką, a etykieta dla adresu bez wartości
//    i tak nie jest czytana.
//
// Uruchom: node etl/gestosc-elud.mjs (pobranie buforowane w etl/.cache/msip/elud_hex100/).
import { fileURLToPath } from 'node:url'
import { pierscien, punktWPierscieniu } from './lib/geo.mjs'
import { dataZMs, LICENCJA_MSIP, MSIP, naMetry, pobierzWarstwe } from './lib/msip.mjs'
import { indeksPunktow } from './lib/przestrzen.mjs'
import { dzis, wczytajAdresy, zapiszWskaznik } from './lib/wspolne.mjs'

export const TERYT_KRAKOW = '1261011'
export const ID_WSKAZNIKA = 'gestosc_zaludnienia_100m'
const WARSTWA = 'Elud/Elud_Hex100/MapServer/0'
const KATALOG_ZBIORU = 'https://msip.krakow.pl/dataset/2282'
/** Bok heksagonu siatki (m) – z nazwy usługi „Hex100”; sprawdzany na geometrii. */
export const BOK_HEKSA = 100
const M2_W_HA = 10_000
/** Poniżej tego odsetka adresów Krakowa z wartością zakładamy błąd (np. układ współrzędnych). */
export const MIN_POKRYCIE_KRAKOWA = 0.9
const liczba = new Intl.NumberFormat('pl-PL')

// ── Funkcje czyste (testowane w gestosc-elud.test.mjs) ──────────────────────────────────

/**
 * Pole wielokąta w m² ze wzoru Gaussa; współrzędne przesuwamy do pierwszego wierzchołka, bo
 * iloczyny rzędu 7,4 mln × 5,5 mln zjadałyby dokładność. Znak orientacji pomijamy.
 */
export function poleWielokata(punkty) {
  const [x0, y0] = punkty[0]
  let suma = 0
  for (let i = 0, j = punkty.length - 1; i < punkty.length; j = i++) {
    suma += (punkty[j][0] - x0) * (punkty[i][1] - y0) - (punkty[i][0] - x0) * (punkty[j][1] - y0)
  }
  return Math.abs(suma) / 2
}

/** Osoby na hektar: liczba zameldowanych ÷ pole w hektarach. */
export const gestoscNaHa = (zameldowani, poleM2) => zameldowani / (poleM2 / M2_W_HA)

/** Do 0,1 os./ha – patrz „Decyzje” w nagłówku. */
export const zaokraglijGestosc = (v) => Math.round(v * 10) / 10

/**
 * Heksagony z odpowiedzi usługi MSIP: sprawdzamy to, na czym opiera się opis wskaźnika.
 * Każdy obiekt to jeden regularny sześciokąt o boku `bok` (pole z tolerancją i wierzchołki
 * w odległości `bok` od środka), z unikalnym grid_id, nieujemną liczbą całkowitą zameldowań
 * i datą stanu zgodną z jej zapisem tekstowym. Cokolwiek innego zatrzymuje liczenie.
 *
 * @returns {{ heksy: object[], daty: string[], suma: number, min: number, max: number }}
 */
export function heksyZObiektow(obiekty, { bok = BOK_HEKSA, tolerancja = 0.005 } = {}) {
  if (!obiekty?.length) throw new Error('Warstwa zameldowań jest pusta')
  const poleWzorca = ((3 * Math.sqrt(3)) / 2) * bok ** 2
  const identyfikatory = new Set()
  const daty = new Set()
  let suma = 0
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY

  const heksy = obiekty.map((o, nr) => {
    const a = o.attributes ?? {}
    const miejsce = `heksagon ${a.grid_id ?? `#${nr}`}`
    if (!a.grid_id || identyfikatory.has(a.grid_id))
      throw new Error(`${miejsce}: brak albo powtórzony grid_id`)
    identyfikatory.add(a.grid_id)
    if (!Number.isInteger(a.r_ogolem) || a.r_ogolem < 0)
      throw new Error(`${miejsce}: r_ogolem ${a.r_ogolem} nie jest nieujemną liczbą całkowitą`)

    const pierscienie = o.geometry?.rings
    if (pierscienie?.length !== 1 || pierscienie[0].length !== 7)
      throw new Error(
        `${miejsce}: oczekiwano jednego pierścienia o 7 punktach (zamknięty sześciokąt)`,
      )
    const wierzcholki = pierscienie[0].slice(0, 6)
    const x = wierzcholki.reduce((s, p) => s + p[0], 0) / 6
    const y = wierzcholki.reduce((s, p) => s + p[1], 0) / 6
    const poleM2 = poleWielokata(pierscienie[0])
    const odchylenie = Math.abs(poleM2 - poleWzorca) / poleWzorca
    const odlegloscWierzcholka = wierzcholki.map((p) => Math.hypot(p[0] - x, p[1] - y))
    const zlyPromien = odlegloscWierzcholka.some((d) => Math.abs(d - bok) > bok * tolerancja)
    if (odchylenie > tolerancja || zlyPromien)
      throw new Error(
        `${miejsce}: to nie regularny sześciokąt o boku ${bok} m (pole ${poleM2.toFixed(1)} m², oczekiwane ${poleWzorca.toFixed(1)} m²) – sprawdź siatkę w źródle przed liczeniem`,
      )

    if (!Number.isFinite(a.na_dzien)) throw new Error(`${miejsce}: brak daty stanu (na_dzien)`)
    const data = dataZMs(a.na_dzien)
    if (a.na_dzien_txt && a.na_dzien_txt !== data)
      throw new Error(`${miejsce}: na_dzien ${data} różni się od na_dzien_txt ${a.na_dzien_txt}`)
    daty.add(data)

    suma += a.r_ogolem
    min = Math.min(min, a.r_ogolem)
    max = Math.max(max, a.r_ogolem)
    return {
      id: a.grid_id,
      zameldowani: a.r_ogolem,
      poleM2,
      x,
      y,
      pierscien: pierscien(pierscienie[0]),
    }
  })
  return { heksy, daty: [...daty].sort(), suma, min, max }
}

/** Indeks środków heksagonów; `promien` to najdalszy wierzchołek od środka (zasięg zapytania). */
export function zbudujIndeksHeksow(heksy) {
  const indeks = indeksPunktow(heksy.map((h) => [h.x, h.y]))
  let promien = 0
  for (const h of heksy)
    for (let i = 0; i < h.pierscien.length; i += 2)
      promien = Math.max(promien, Math.hypot(h.pierscien[i] - h.x, h.pierscien[i + 1] - h.y))
  return { heksy, indeks, promien }
}

/**
 * Heksagon zawierający punkt (metry EPSG:2178) albo null, gdy punkt leży poza heksagonami zbioru.
 * Punkt na wspólnym brzegu dwóch heksagonów dostaje ten o bliższym środku (przy remisie
 * o mniejszym id), więc wynik nie zależy od kolejności w odpowiedzi usługi.
 */
export function znajdzHeks({ heksy, indeks, promien }, x, y) {
  let wybrany = null
  let odleglosc = Number.POSITIVE_INFINITY
  // +0,5 m zapasu na zaokrąglenie współrzędnych w źródle (geometryPrecision 2)
  for (const i of indeks.within(x, y, promien + 0.5)) {
    const h = heksy[i]
    if (!punktWPierscieniu(x, y, h.pierscien)) continue
    const d = Math.hypot(h.x - x, h.y - y)
    if (d < odleglosc || (d === odleglosc && h.id < wybrany.id)) {
      odleglosc = d
      wybrany = h
    }
  }
  return wybrany
}

/** Heksagon dla każdego punktu z `xy` (null tam, gdzie punkt jest null albo poza heksagonami). */
export const przypiszHeksy = (xy, indeksHeksow) =>
  xy.map((p) => (p ? znajdzHeks(indeksHeksow, p[0], p[1]) : null))

/** Stop, gdy pokrycie Krakowa jest podejrzanie niskie (typowo: pomylony układ współrzędnych). */
export function wymagajPokrycia(krakow, zWartoscia, minimum = MIN_POKRYCIE_KRAKOWA) {
  if (krakow === 0 || zWartoscia / krakow < minimum)
    throw new Error(
      `Wartość ma ${zWartoscia} z ${krakow} adresów Krakowa (minimum ${(100 * minimum).toFixed(0)}%) – sprawdź układ współrzędnych i siatkę`,
    )
}

/**
 * Warunki, na których stoi opis wskaźnika: jedna data stanu (opis podaje „stan na ...”) i brak
 * heksagonów bez zameldowanych (inaczej brak heksagonu nie znaczyłby „mniej niż próg”).
 */
export function sprawdzZbior({ daty, min }) {
  if (daty.length !== 1)
    throw new Error(
      `Heksagony mają ${daty.length} dat stanu (${daty.join(', ')}), oczekiwano jednej`,
    )
  if (min < 1)
    throw new Error(
      'Zbiór zawiera heksagony bez zameldowanych – brak heksagonu przestaje oznaczać „mniej niż próg”, zmień interpretację',
    )
}

/** Opis dla karty. Liczby z danych, a odmiana rzeczowników nie zależy od ich wartości. */
export function opisWskaznika({ liczbaHeksow, suma, min, dataDanych }) {
  const data = dataDanych.split('-').reverse().join('.')
  return [
    'Liczba osób zameldowanych na pobyt stały w heksagonie siatki MSIP, w którym leży adres, w przeliczeniu na hektar.',
    'Heksagon ma bok 100 m, czyli ok. 2,6 ha powierzchni (w poprzek ok. 170–200 m), więc to średnia z całego tego obszaru, razem z zielenią, wodami i terenami przemysłowymi, a nie gęstość przy samym budynku.',
    `Stan bazy meldunkowej Urzędu Miasta Krakowa na ${data}; liczba heksagonów w zbiorze: ${liczba.format(liczbaHeksow)}, razem w nich zameldowań stałych: ${liczba.format(suma)}.`,
    'Zameldowanie nie jest faktycznym zamieszkaniem: zbiór nie obejmuje osób mieszkających bez zameldowania na pobyt stały (np. części studentów, najemców i cudzoziemców), a zameldowani mogą mieszkać gdzie indziej.',
    'Nie jest to też liczba mieszkańców ze spisu powszechnego NSP 2021, który ma inną definicję i oczka 1 km.',
    `Najmniejsza liczba zameldowań w heksagonie zbioru to ${min} (heksagonów z mniejszą liczbą nie ma w danych), więc adres leżący poza heksagonami nie ma wartości: to brak danych, nie zero.`,
    'Tylko Kraków – dla gmin obwarzanka brak danych (null, nie zero).',
  ].join(' ')
}

// ── Wskaźnik ────────────────────────────────────────────────────────────────────────────

/** Znane miejsca: wypisujemy, żeby kontrola była widoczna w logu każdego biegu. */
const KONTROLE = [
  ['Kraków', 'Rynek Główny', '1'],
  ['Kraków', 'Osiedle Kalinowe', '13'], // heksagon DE-29, jeden z najgęstszych w mieście
  ['Kraków', 'Jana Kurczaba', '33'], // heksagon DC-80, najgęstszy
  ['Kraków', 'Józefińska', '1'],
  ['Kraków', 'Pychowicka', '1'],
  ['Kraków', 'Benedyktyńska', '37'], // Tyniec, obrzeża
  ['Kraków', 'Podgórki Tynieckie', '1'], // rzadka zabudowa
  ['Kraków', 'Kopiec Krakusa', '1'],
  ['Mogilany', 'Zakopiańska', '62'], // obwarzanek: null
  ['Balice', 'kpt. Mieczysława Medweckiego', '14'], // obwarzanek: null
]

function wypiszKontrole(adresy, wartosci, heksy) {
  console.log('Kontrola na znanych adresach (gęstość os./ha | heksagon, zameldowani):')
  for (const [miejscowosc, ulica, nr] of KONTROLE) {
    const i = adresy.findIndex(
      (a) => a.miejscowosc === miejscowosc && a.ulica === ulica && a.nr === nr,
    )
    if (i < 0) {
      console.log(`  ${ulica} ${nr}, ${miejscowosc}: brak w adresach`)
      continue
    }
    const h = heksy[i]
    console.log(
      `  ${ulica} ${nr}, ${miejscowosc}: ${wartosci[i] ?? 'null'}${h ? ` | ${h.id}, ${h.zameldowani}` : ''}`,
    )
  }
}

export async function main() {
  const start = performance.now()
  const { adresy } = wczytajAdresy()
  const xy = adresy.map((a) => (a.teryt === TERYT_KRAKOW ? naMetry(a.lon, a.lat) : null))
  const krakow = xy.filter(Boolean).length
  console.log(`Adresów: ${adresy.length}, w Krakowie: ${krakow}`)

  const { obiekty } = await pobierzWarstwe(WARSTWA, { katalog: 'msip/elud_hex100' })
  const { heksy, daty, suma, min, max } = heksyZObiektow(obiekty)
  sprawdzZbior({ daty, min })
  console.log(
    `Heksagonów: ${heksy.length}, suma zameldowań: ${suma}, zakres na heksagon: ${min}–${max}, stan na ${daty[0]}`,
  )

  const indeks = zbudujIndeksHeksow(heksy)
  const trafione = przypiszHeksy(xy, indeks)
  const wartosci = trafione.map((h) =>
    h ? zaokraglijGestosc(gestoscNaHa(h.zameldowani, h.poleM2)) : null,
  )
  const zWartoscia = wartosci.filter((v) => v !== null).length
  console.log(
    `Adresy Krakowa w heksagonie: ${zWartoscia} z ${krakow} (${((100 * zWartoscia) / krakow).toFixed(1)}%), poza heksagonami (null): ${krakow - zWartoscia}`,
  )
  wymagajPokrycia(krakow, zWartoscia)

  const uzyte = new Set(trafione.filter(Boolean).map((h) => h.id))
  console.log(`Heksagonów z co najmniej jednym adresem: ${uzyte.size} z ${heksy.length}`)

  const pobrano = dzis()
  zapiszWskaznik(
    {
      id: ID_WSKAZNIKA,
      kategoria: 'kontekst',
      nazwa: 'Gęstość zaludnienia wg zameldowań stałych',
      opis: opisWskaznika({
        liczbaHeksow: heksy.length,
        suma,
        min,
        dataDanych: daty[0],
      }),
      jednostka: 'os./ha',
      kierunek: 'neutralny',
      rozdzielczosc: 'siatka',
      rozmiar: 'heksagonów o boku 100 m',
      // 99. percentyl adresów to ok. 273 os./ha, najgęstszy heksagon ok. 630.
      zakres: [0, 300],
      zadanie: 74,
      zrodla: [
        {
          nazwa:
            'Gmina Miejska Kraków, Portal MSIP Obserwatorium – Zameldowania stałe, siatka heksagonów 100 m (Elud_Hex100)',
          url: `${MSIP}/${WARSTWA}`,
          licencja: `${LICENCJA_MSIP}; zbiór „Zameldowania stałe”: ${KATALOG_ZBIORU}`,
          dataDanych: daty[0],
          pobrano,
        },
      ],
    },
    wartosci,
  )

  const posortowane = wartosci.filter((v) => v !== null).sort((a, b) => a - b)
  const q = (p) => posortowane[Math.min(posortowane.length - 1, Math.floor(p * posortowane.length))]
  console.log(
    `  gęstość [os./ha] w adresach: min ${q(0)}, p10 ${q(0.1)}, mediana ${q(0.5)}, p90 ${q(0.9)}, p99 ${q(0.99)}, maks. ${q(1)}`,
  )
  wypiszKontrole(adresy, wartosci, trafione)
  console.log(`Czas: ${((performance.now() - start) / 1000).toFixed(1)} s`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main()
