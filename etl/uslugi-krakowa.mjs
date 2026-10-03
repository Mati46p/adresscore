// Warstwa „usługi Krakowa" (#120): odległość w linii prostej od adresu w Krakowie do najbliższego
// obiektu – sport, Centra Aktywności Seniora, pitniki zewnętrzne i policja.
// Źródła: MSIP Obserwatorium (ArcGIS REST, regulamin MSIP) i otwartedane.um.krakow.pl (CAS).
// Kategorie: codzienność (sport, CAS, pitniki) i bezpieczeństwo (policja).
// Poza Krakowem wszystkie wskaźniki mają null: źródła obejmują tylko miasto (obwarzanek bez danych).
// Kultury tu nie ma: warstwę kultura_odleglosc dał już #124 z OSM, z lepszym pokryciem Krakowa
// (mediana 595 m wobec 746 m z rejestrów MSIP, więc drugi wskaźnik tylko dublowałby wynik).
// Uruchom po aktualizacji adresów: node etl/uslugi-krakowa.mjs (surowe pobrania: etl/.cache/uslugi-krakowa/).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  czytelnaNazwa,
  najblizszy,
  najnowszaData,
  odczytajPunkty,
  pobierzJson,
  pobierzTekstZCache,
  punktyCAS,
  rzutPL2000,
  TERYT_KRAKOWA,
} from './lib/uslugi-krakowa.mjs'
import { DANE, dzis, wczytajAdresy, zapiszWskaznik } from './lib/wspolne.mjs'

const MSIP = 'https://msip.um.krakow.pl/arcgis/rest/services'
const CAS_API = 'https://api.um.krakow.pl/opendata-spoleczenstwo-centra-aktywnosci-seniora/v1'
const CAS_KARTA =
  'https://otwartedane.um.krakow.pl/zbiory-danych/centra-aktywnosci-seniora-w-krakowie'
const CAS_WARUNKI =
  'https://otwartedane.um.krakow.pl/warunki-wykorzystania-danych-udostepnianych-w-portalu'
const licencjaMsip = (przetworzono) =>
  `Regulamin MSIP: https://msip.krakow.pl/getHtml?dok_id=228972; atrybucja: Gmina Miejska Kraków, Portal MSIP Obserwatorium (https://msip.krakow.pl); przetworzono: ${przetworzono}`
const PRZETWORZENIE_ODLEGLOSCI = 'odległość w linii prostej do najbliższego obiektu'
const LICENCJA_CAS = `Warunki portalu otwartedane.um.krakow.pl: ${CAS_WARUNKI} (swobodne ponowne wykorzystanie); atrybucja: Gmina Miejska Kraków, otwartedane.um.krakow.pl, czas wytworzenia i pozyskania danych w polach dataDanych i pobrano; przetworzono: geokodowanie po punktach adresowych MSIP i odległość w linii prostej do najbliższego obiektu`

/** Adres bez „, Kraków" na końcu: „Zakopiańska 103, Kraków" → „Zakopiańska 103". */
const ulicaZAdresu = (adres) =>
  String(adres ?? '')
    .replace(/\s+/g, ' ')
    .replace(/,\s*Kraków\s*$/i, '')
    .trim()

/** Część adresu przed pierwszym przecinkiem („Szeroka 35,31-053 Kraków" → „Szeroka 35"). */
const ulicaPrzedPrzecinkiem = (adres) =>
  String(adres ?? '')
    .split(',')[0]
    ?.replace(/\s+/g, ' ')
    .trim() ?? ''

/** „Park Jordana, ul. 3 Maja"; adres pomijamy, gdy tylko powtarza nazwę („Zamek Królewski na Wawelu"). */
function etykietaPitnika(a) {
  const nazwa = czytelnaNazwa(a.MIEJSCE, 45)
  const adres = ulicaZAdresu(a.ADRES).replace(/^Kraków,\s*/i, '')
  const sama = (s) => s.toLocaleLowerCase('pl').replace(/\s+/g, ' ')
  return !adres || sama(adres) === sama(nazwa) ? nazwa : `${nazwa}, ${adres}`
}

// --- Definicje źródeł ---------------------------------------------------------------------
// `usluga` wiąże warstwę z wpisem w USLUGI (jedno źródło w metadanych na usługę MSIP).
// `min` to strażnik: poniżej tej liczby obiektów usługa zwróciła coś uciętego albo się zmieniła.
// `pole` to pole z datą aktualności rekordów (ms); bez niego data stanu pochodzi z katalogu
// metadanych MSIP (https://msip.um.krakow.pl/geoportal/rest/metadata/search) i jest wpisana
// niżej jako `dataStala` razem z identyfikatorem wpisu.

const USLUGI = {
  sport: {
    nazwa: 'obiekty sportowe ZIS (ZIS/ZIS_OBIEKTY_SPORTOWE_APP, warstwa 25)',
    url: `${MSIP}/ZIS/ZIS_OBIEKTY_SPORTOWE_APP/MapServer/25`,
  },
  pitniki: {
    nazwa: 'pitniki zewnętrzne (Obserwatorium/GK_Pitniki, warstwa 0)',
    url: `${MSIP}/Obserwatorium/GK_Pitniki/MapServer/0`,
  },
  policja: {
    nazwa:
      'komisariaty, siedziby pomocnicze komisariatów i Komenda Miejska Policji (Obserwatorium/K07_Admini_i_Bezpiecz, warstwy 5–6)',
    url: `${MSIP}/Obserwatorium/K07_Admini_i_Bezpiecz/MapServer`,
  },
}

const SPORT = [
  {
    klucz: 'sport',
    usluga: 'sport',
    url: USLUGI.sport.url,
    min: 150,
    pole: 'data_imp',
    etykieta: (a) => {
      const nazwa = czytelnaNazwa(a.name, 55)
      const dyscyplina = String(a.type_of_ac ?? '').trim()
      return dyscyplina ? `${nazwa} (${dyscyplina})` : nazwa
    },
  },
]

const PITNIKI = [
  {
    klucz: 'pitniki',
    usluga: 'pitniki',
    url: USLUGI.pitniki.url,
    min: 50,
    // Warstwa nie ma pola z datą: wpis „GK Pitniki zewnętrzne" w katalogu metadanych MSIP
    // (id d0129a5db2ff4757ae61860ff409458b), rewizja 2025-04-28.
    dataStala: '2025-04-28',
    filtr: (a) => String(a.OBIEKT ?? '').trim() === 'Pitnik zewnętrzny',
    etykieta: etykietaPitnika,
  },
]

// Warstwa 6 powtarza siedziby główne komisariatów z warstwy 5 i zawiera jednostki, które nie
// obsługują mieszkańca danego rejonu (Komenda Wojewódzka, Komenda Powiatowa, Komisariat Wodny).
const rodzajPolicji = (a) =>
  String(a.rodzaj ?? '')
    .trim()
    .toLocaleLowerCase('pl')
const OPISY_POLICJI = new Map([
  ['siedziba pomocnicza', (a) => `Siedziba pomocnicza komisariatu ${String(a.komisariat).trim()}`],
  ['komenda miejska policji w krakowie', () => 'Komenda Miejska Policji'],
])

const POLICJA = [
  {
    klucz: 'komisariaty',
    usluga: 'policja',
    url: `${USLUGI.policja.url}/5`,
    min: 8,
    // Warstwy nie mają pola z datą: usługa „Administracja i bezpieczeństwo" w katalogu metadanych
    // MSIP (id c5c83dd78915493e905611b7b1c8e22e), rewizja 2024-05-13.
    dataStala: '2024-05-13',
    etykieta: (a) => `${czytelnaNazwa(a.nazwa, 50)}, ${ulicaPrzedPrzecinkiem(a.adres)}`,
  },
  {
    klucz: 'posterunki',
    usluga: 'policja',
    url: `${USLUGI.policja.url}/6`,
    min: 3,
    dataStala: '2024-05-13',
    filtr: (a) => OPISY_POLICJI.has(rodzajPolicji(a)),
    etykieta: (a) =>
      `${OPISY_POLICJI.get(rodzajPolicji(a))?.(a)}, ${String(a.ulica).trim()} ${String(a.numer).trim()}`,
  },
]

/** Pobiera warstwę i zamienia obiekty na punkty z etykietą; sprawdza strażnik `min`. */
async function wczytajWarstwe(z) {
  const odp = await pobierzJson(
    `${z.url}/query?${new URLSearchParams({ where: '1=1', outFields: '*', outSR: '4326', f: 'json' })}`,
    `${z.klucz}.json`,
  )
  const { punkty, pominiete } = odczytajPunkty(odp)
  const wybrane = punkty
    .filter((p) => (z.filtr ? z.filtr(p.atr) : true))
    .map((p) => ({ lon: p.lon, lat: p.lat, etykieta: z.etykieta(p.atr), atr: p.atr }))
  if (wybrane.length < z.min)
    throw new Error(`${z.klucz}: ${wybrane.length} obiektów, oczekiwano co najmniej ${z.min}`)
  const dataDanych = z.pole
    ? najnowszaData(
        wybrane.map((p) => p.atr),
        z.pole,
      )
    : z.dataStala
  if (!dataDanych) throw new Error(`${z.klucz}: brak daty stanu danych`)
  console.log(
    `${z.klucz}: ${wybrane.length} obiektów (bez geometrii pominięto ${pominiete}, odrzucone filtrem ${punkty.length - wybrane.length}), dane z ${dataDanych}`,
  )
  return { ...z, punkty: wybrane, dataDanych }
}

/** Centra Aktywności Seniora z API otwartedane.um.krakow.pl, geokodowane po adresach projektu. */
async function wczytajCAS(adresyKrakowa) {
  const meta = await pobierzJson(`${CAS_API}/metadata`, 'cas-metadata.json')
  const lista = await pobierzJson(`${CAS_API}/cas-lista`, 'cas-lista.json')
  const wiersze = lista.value
  const zgloszone = meta.value?.[0]?.number_of_rows
  if (!Array.isArray(wiersze) || lista['@odata.nextLink'] || wiersze.length !== zgloszone)
    throw new Error(`CAS: ${wiersze?.length} wierszy, API zgłasza ${zgloszone}`)
  const karta = await pobierzTekstZCache(CAS_KARTA, 'cas-karta.html')
  const m = /Data aktualizacji:\s*(\d{2})\.(\d{2})\.(\d{4})/.exec(karta)
  if (!m) throw new Error('CAS: nie znaleziono daty aktualizacji na karcie zbioru')
  const dataDanych = `${m[3]}-${m[2]}-${m[1]}`
  const { punkty, odrzucone } = punktyCAS(wiersze, adresyKrakowa)
  if (punkty.length < 55)
    throw new Error(`CAS: tylko ${punkty.length} lokalizacji z ${wiersze.length}`)
  console.log(
    `CAS: ${wiersze.length} wierszy w rejestrze, ${punkty.length} lokalizacji po geokodowaniu, dane z ${dataDanych}`,
  )
  for (const o of odrzucone) console.log(`  CAS bez współrzędnych: ${o.nazwa} (${o.powod})`)
  // Rejestr CAS skraca nazwy ulic („Batorego"), PRG ma pełne („Stefana Batorego"): to nadal dokładny
  // adres (ulica i numer budynku), więc liczymy je osobno od numerów zastępczych („144" za „144A").
  const skrocone = punkty.filter((p) => p.atr.metoda.startsWith('skrocona')).length
  console.log(`  CAS z nazwą ulicy skróconą w rejestrze, dopasowaną jednoznacznie: ${skrocone}`)
  for (const p of punkty) {
    const { metoda, dzielnicaRejestru, dzielnicaAdresu } = p.atr
    if (metoda.includes(', numer '))
      console.log(`  CAS z numerem zastępczym: ${p.etykieta} – ${metoda}`)
    if (dzielnicaAdresu && !dzielnicaAdresu.startsWith(`${dzielnicaRejestru} `))
      console.log(
        `  CAS w innej dzielnicy niż w rejestrze: ${p.etykieta} (${dzielnicaRejestru} / ${dzielnicaAdresu})`,
      )
  }
  return { wierszy: wiersze.length, punkty, odrzucone, dataDanych }
}

/**
 * Wartość (m, zaokrąglona) i etykieta najbliższego obiektu dla każdego adresu; poza Krakowem null.
 * Odległość w metrach układu PL-2000, czyli w linii prostej (nie po sieci pieszej).
 */
export function policzOdleglosci(adresy, punkty) {
  const cele = punkty.map((p) => {
    const [x, y] = rzutPL2000(p.lon, p.lat)
    return { x, y, etykieta: p.etykieta }
  })
  const wartosci = new Array(adresy.length).fill(null)
  const etykiety = new Array(adresy.length).fill(null)
  for (const a of adresy) {
    if (a.teryt !== TERYT_KRAKOWA) continue
    const [x, y] = rzutPL2000(a.lon, a.lat)
    const t = najblizszy(x, y, cele)
    if (!t) continue
    wartosci[a.i] = Math.round(t.metry)
    etykiety[a.i] = t.punkt.etykieta
  }
  return { wartosci, etykiety }
}

/** Adresy kontrolne: pod tym adresem stoi obiekt, więc odległość ma być niewielka, a etykieta znana. */
export const KONTROLE = [
  {
    ulica: 'Szeroka',
    nr: '35',
    wskaznik: 'policja_odleglosc',
    maks: 60,
    etykieta: /Komisariat policji I /i,
  },
  {
    ulica: 'Osiedle Zgody',
    nr: '10',
    wskaznik: 'policja_odleglosc',
    maks: 60,
    etykieta: /Komisariat policji VIII/i,
  },
  {
    ulica: 'Rynek Główny',
    nr: '1',
    wskaznik: 'pitnik_odleglosc',
    maks: 60,
    etykieta: /Rynek Główny Ratusz/i,
  },
  {
    ulica: 'Berka Joselewicza',
    nr: '28',
    wskaznik: 'cas_odleglosc',
    maks: 60,
    etykieta: /Senior w Centrum/,
  },
  {
    ulica: 'Filipa Eisenberga',
    nr: '4',
    wskaznik: 'sport_odleglosc',
    maks: 100,
    etykieta: /Przystań/,
  },
]

const percentyl = (posortowane, p) =>
  posortowane[Math.min(posortowane.length - 1, Math.floor(p * posortowane.length))]

async function main() {
  const start = performance.now()
  const { adresy } = wczytajAdresy()
  const krakow = adresy.filter((a) => a.teryt === TERYT_KRAKOWA)
  if (krakow.length < 60_000)
    throw new Error(`Adresów w Krakowie: ${krakow.length}, oczekiwano ponad 60 tys.`)
  const pobrano = dzis()
  // Stan punktów adresowych MSIP, po których geokodujemy CAS, bierzemy z metadanych adresy.json.
  const zrodloAdresow = JSON.parse(readFileSync(join(DANE, 'adresy.json'), 'utf8')).zrodla.find(
    (z) => z.url.includes('msip.krakow.pl'),
  )
  if (!zrodloAdresow) throw new Error('adresy.json: brak źródła MSIP w metadanych')

  const [sport, pitniki, policja] = await Promise.all(
    [SPORT, PITNIKI, POLICJA].map((grupa) => Promise.all(grupa.map(wczytajWarstwe))),
  )
  const cas = await wczytajCAS(krakow)

  /** Jedno źródło na usługę MSIP: liczba obiektów łączna, data stanu najnowsza z warstw usługi. */
  const zrodlaMsip = (warstwy) =>
    [...new Set(warstwy.map((w) => w.usluga))].map((klucz) => {
      const naUsludze = warstwy.filter((w) => w.usluga === klucz)
      const obiektow = naUsludze.reduce((s, w) => s + w.punkty.length, 0)
      return {
        nazwa: `Gmina Miejska Kraków, Portal MSIP Obserwatorium – ${USLUGI[klucz].nazwa}, ${obiektow} obiektów`,
        url: USLUGI[klucz].url,
        licencja: licencjaMsip(PRZETWORZENIE_ODLEGLOSCI),
        dataDanych: naUsludze
          .map((w) => w.dataDanych)
          .sort()
          .at(-1),
        pobrano,
      }
    })
  const razem = (warstwy) => warstwy.reduce((s, w) => s + w.punkty.length, 0)
  const wszystkie = (warstwy) => warstwy.flatMap((w) => w.punkty)
  const wspolne = {
    jednostka: 'm',
    kierunek: 'mniej-lepiej',
    rozdzielczosc: 'adres',
    zadanie: 120,
  }
  // Zakres skali = 0 m do 95. percentyla odległości w Krakowie (zmierzonego 2026-10-03),
  // zaokrąglony do 500 m, żeby kilka najdalszych przedmieść nie spłaszczyło skali reszcie miasta.

  const definicje = [
    {
      meta: {
        ...wspolne,
        id: 'sport_odleglosc',
        kategoria: 'codziennosc',
        nazwa: 'Najbliższy obiekt sportowy',
        zakres: [0, 2000],
        opis: `Odległość w linii prostej (nie trasa pieszo) od adresu w Krakowie do najbliższego z ${razem(sport)} obiektów sportowych z wykazu Zarządu Infrastruktury Sportowej (m.in. boiska, hale, stadiony, korty i lodowiska; etykieta podaje nazwę i dyscyplinę). Wykaz nie jest pełnym spisem boisk, sal i siłowni w mieście (starszy spis MSIP z 2021 r. liczy ponad 2 tys. pozycji) i nie podaje godzin ani warunków wstępu. Data stanu to data importu rekordów do MSIP. Obiekty poza granicą Krakowa nie są liczone, więc przy granicy miasta odległość bywa zawyżona. Poza Krakowem brak danych.`,
        zrodla: zrodlaMsip(sport),
      },
      punkty: wszystkie(sport),
    },
    {
      meta: {
        ...wspolne,
        id: 'cas_odleglosc',
        kategoria: 'codziennosc',
        nazwa: 'Najbliższe Centrum Aktywności Seniora',
        zakres: [0, 3500],
        opis: `Odległość w linii prostej (nie trasa pieszo) od adresu w Krakowie do najbliższego z ${cas.punkty.length} Centrów Aktywności Seniora (wykaz miasta liczy ${cas.wierszy} wierszy, w tym powtórzenia; wierszy bez współrzędnych pominięto: ${cas.odrzucone.length}). Adresy CAS zamieniono na współrzędne po punktach adresowych MSIP, bez zewnętrznego geokodera. Wskaźnik ważny głównie dla persony senior. Nie uwzględnia godzin, oferty zajęć ani wolnych miejsc; CAS dla rozproszonych seniorów z XVIII dzielnicy liczony jest w tych miejscach zajęć, którym udało się przypisać adres. Obiekty poza granicą Krakowa nie są liczone. Poza Krakowem brak danych.`,
        zrodla: [
          {
            nazwa: `Gmina Miejska Kraków, otwartedane.um.krakow.pl – Centra Aktywności Seniora w Krakowie, ${cas.punkty.length} lokalizacji`,
            url: CAS_KARTA,
            licencja: LICENCJA_CAS,
            dataDanych: cas.dataDanych,
            pobrano,
          },
          {
            nazwa:
              'Gmina Miejska Kraków, Portal MSIP Obserwatorium – punkty adresowe EMUiA (adresy.json), do ustalenia współrzędnych adresów CAS',
            url: zrodloAdresow.url,
            licencja: licencjaMsip('współrzędne adresów CAS'),
            dataDanych: zrodloAdresow.dataDanych,
            pobrano,
          },
        ],
      },
      punkty: cas.punkty,
    },
    {
      meta: {
        ...wspolne,
        id: 'pitnik_odleglosc',
        kategoria: 'codziennosc',
        nazwa: 'Najbliższy pitnik zewnętrzny',
        zakres: [0, 5500],
        opis: `Odległość w linii prostej (nie trasa pieszo) od adresu w Krakowie do najbliższego z ${razem(pitniki)} pitników zewnętrznych z programu „Dobra woda prosto z kranu" (parki, place, tereny rekreacyjne). Nie liczymy pitników w szkołach, urzędach, szpitalach i lokalach „Kranowianka" (razem 188), bo mają ograniczony dostęp (godziny instytucji, klienci lokalu). Rejestr nie podaje godzin ani sezonu działania, więc bliski pitnik nie gwarantuje wody o każdej porze. Obiekty poza granicą Krakowa nie są liczone. Poza Krakowem brak danych.`,
        zrodla: zrodlaMsip(pitniki),
      },
      punkty: wszystkie(pitniki),
    },
    {
      meta: {
        ...wspolne,
        id: 'policja_odleglosc',
        kategoria: 'bezpieczenstwo',
        nazwa: 'Najbliższa jednostka policji',
        zakres: [0, 8500],
        opis: `Dostępność policji, nie przestępczość: odległość w linii prostej od adresu w Krakowie do najbliższej z ${razem(policja)} jednostek – komisariatów, siedzib pomocniczych komisariatów i Komendy Miejskiej Policji. Nie liczymy Komendy Wojewódzkiej, Komendy Powiatowej ani Komisariatu Wodnego. Wskaźnik nie mówi nic o bezpieczeństwie okolicy, czasie reakcji patroli ani godzinach otwarcia. Jednostki poza granicą Krakowa nie są liczone. Poza Krakowem brak danych.`,
        zrodla: zrodlaMsip(policja),
      },
      punkty: wszystkie(policja),
    },
  ]

  const wyniki = new Map()
  for (const d of definicje) {
    const { wartosci, etykiety } = policzOdleglosci(adresy, d.punkty)
    zapiszWskaznik(d.meta, wartosci, etykiety)
    wyniki.set(d.meta.id, { wartosci, etykiety })
    const w = krakow.map((a) => wartosci[a.i]).sort((x, y) => x - y)
    console.log(
      `  ${d.meta.id}: ${d.punkty.length} punktów, Kraków: mediana ${percentyl(w, 0.5)} m, 90. percentyl ${percentyl(w, 0.9)} m, 95. ${percentyl(w, 0.95)} m, max ${w.at(-1)} m`,
    )
  }

  console.log('Kontrola na znanych adresach:')
  for (const k of KONTROLE) {
    const a = krakow.find((x) => x.ulica === k.ulica && x.nr === k.nr)
    if (!a) throw new Error(`Kontrola: brak adresu ${k.ulica} ${k.nr} w Krakowie`)
    const { wartosci, etykiety } = wyniki.get(k.wskaznik)
    console.log(`  ${k.ulica} ${k.nr}: ${k.wskaznik} = ${wartosci[a.i]} m – ${etykiety[a.i]}`)
  }
  console.log(`Czas: ${((performance.now() - start) / 1000).toFixed(1)} s`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1])
  main().catch((blad) => {
    console.error(blad)
    process.exitCode = 1
  })
