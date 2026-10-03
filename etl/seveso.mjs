// Odległość od adresu do najbliższego zakładu Seveso (ZDR i ZZR), rejestr GIOŚ.
// Współrzędne: INSPIRE OGC API Features GIOŚ (seveso:ProductionFacility, żywy rejestr). Wykaz xlsx
// GIOŚ „wg stanu na 31.12.2025” nie ma współrzędnych (tylko adres), więc nie wystarcza do liczenia
// odległości: służy jako lista kontrolna razem z API bieżącego rejestru GIOŚ (też bez współrzędnych).
// Rejestr jest krajowy, więc każdy adres dostaje wynik (nigdy null).
// Uruchom: node etl/seveso.mjs. Surowe pobrania: etl/.cache/ryzyka/.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { unzipSync } from 'fflate'
import { do2180, IndeksPunktow } from './lib/geo.mjs'
import { bezOgonkow, skrocNazwe, tenSamZaklad } from './lib/nazwy.mjs'
import { dataPobrania, plikCache, pobierzKolekcje, pobierzTrwale } from './lib/pobieranie.mjs'
import { wczytajAdresy, zapiszWskaznik } from './lib/wspolne.mjs'

const URL_OGC =
  'https://inspire.gios.gov.pl/wss/ogc/features/collections/seveso%3AProductionFacility/items?limit=500&f=application%2Fgeo%2Bjson'
const URL_KOLEKCJI =
  'https://inspire.gios.gov.pl/wss/ogc/features/collections/seveso:ProductionFacility'
const URL_REJESTRU = 'https://dane.gios.gov.pl/api/powazne-awarie/v1/zaklady'
const URL_WYKAZU =
  'https://www.gov.pl/web/gios/di-zaklady-stwarzajace-zagrozenie-wystapienia-powaznej-awarii-przemyslowej'
const URL_XLSX = 'https://www.gov.pl/attachment/8170229e-3edd-4660-ab16-0c7f24fba0b8'
const ZBIOR_SEVESO =
  'https://dane.gov.pl/pl/dataset/2540,zaklady-stwarzajace-zagrozenie-wystapienia-powaznej-awarii-przemyslowej-seveso'
const ZBIOR_API = 'https://dane.gov.pl/pl/dataset/34643,api-powazne-awarie'
const ZAKRES_M = 150_000
const ZAOKRAGLENIE_M = 10
/** Etykieta z nazwą zakładu tylko w pobliżu – dalej nazwa nie wpływa na decyzję, a waży w pliku. */
const PROMIEN_ETYKIETY_M = 3_000
/** Województwa porównywane z rejestrem: Małopolska i sąsiedzi, z których zakład może być najbliższy. */
const WOJEWODZTWA_KONTROLI = ['małopolskie', 'śląskie', 'świętokrzyskie']
const POLSKA = { lon: [14, 24.5], lat: [48.9, 55.1] }

/** Zakłady z GeoJSON INSPIRE: tylko sprawne, z punktem w Polsce. Zwraca też liczbę odrzuconych. */
export function zakladyZGeojson(features) {
  const zaklady = []
  const odrzucone = { niesprawne: 0, bezPunktu: 0, poza: 0, nieznanaKlasa: 0 }
  for (const f of features) {
    const p = f.properties ?? {}
    if (p.status_statusType !== 'sprawny') {
      odrzucone.niesprawne++
      continue
    }
    if (!['ZDR', 'ZZR'].includes(p.sevesoType)) {
      odrzucone.nieznanaKlasa++
      continue
    }
    const [lon, lat] = f.geometry?.type === 'Point' ? f.geometry.coordinates : []
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
      odrzucone.bezPunktu++
      continue
    }
    if (lon < POLSKA.lon[0] || lon > POLSKA.lon[1] || lat < POLSKA.lat[0] || lat > POLSKA.lat[1]) {
      odrzucone.poza++
      continue
    }
    const [x, y] = do2180(lon, lat)
    zaklady.push({
      id: f.id,
      nazwa: skrocNazwe(p.name),
      nazwaPelna: p.name,
      typ: p.sevesoType,
      lon,
      lat,
      x,
      y,
    })
  }
  return { zaklady, odrzucone }
}

const odkoduj = (s) =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(Number.parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&')

/**
 * Wykaz GIOŚ (xlsx z dwoma arkuszami: ZDR i ZZR). Wiersz danych ma w kolumnie A numer porządkowy,
 * B = województwo, C = nazwa zakładu, D = adres. Klasę rozpoznajemy po tytule w A1 arkusza.
 */
export function wykazZXlsx(bufor) {
  const pliki = unzipSync(new Uint8Array(bufor))
  const tekst = (nazwa) => (pliki[nazwa] ? new TextDecoder().decode(pliki[nazwa]) : '')
  const slownik = [...tekst('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
    odkoduj([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('')),
  )
  const wynik = []
  for (const arkusz of Object.keys(pliki).filter((k) =>
    /^xl\/worksheets\/sheet\d+\.xml$/.test(k),
  )) {
    const wiersze = [...tekst(arkusz).matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)].map((w) => {
      const kolumny = {}
      for (const c of w[1].matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const v = /<v>([\s\S]*?)<\/v>/.exec(c[3] ?? '')?.[1]
        const wbudowany = /<is>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>/.exec(c[3] ?? '')?.[1]
        const typ = /t="(\w+)"/.exec(c[2])?.[1]
        const wartosc = typ === 's' ? slownik[Number(v)] : odkoduj(wbudowany ?? v ?? '')
        kolumny[c[1]] = (wartosc ?? '').replace(/\s+/g, ' ').trim()
      }
      return kolumny
    })
    const tytul = wiersze[0]?.A ?? ''
    const klasa = /\(ZDR\)/.test(tytul) ? 'ZDR' : /\(ZZR\)/.test(tytul) ? 'ZZR' : null
    if (!klasa) continue
    for (const w of wiersze)
      if (/^\d+$/.test(w.A ?? '') && w.C)
        wynik.push({
          klasa,
          wojewodztwo: (w.B ?? '').toLowerCase(),
          nazwa: w.C,
          adres: w.D ?? '',
        })
  }
  return wynik
}

/** Strona odpowiedzi API rejestru GIOŚ → wpisy w tym samym kształcie co wykaz xlsx. */
export function wpisyZApi(odpowiedz) {
  if (odpowiedz?.wynik?.status !== 'SUKCES')
    throw new Error(`API rejestru GIOŚ: ${JSON.stringify(odpowiedz?.wynik?.blad ?? odpowiedz)}`)
  return odpowiedz.dane.strona.map((z) => ({
    klasa: z.klasyfikacjaZakladu,
    wojewodztwo: String(z.wojewodztwo).toLowerCase(),
    nazwa: String(z.nazwaZakladu).replace(/\s+/g, ' ').trim(),
    adres: [z.kodPocztowy, z.miejscowosc, z.ulica].filter(Boolean).join(' '),
  }))
}

/**
 * Porównanie rejestru INSPIRE z listą wpisów (wykaz xlsx albo API) dla wybranych województw.
 * Zwraca wpisy bez odpowiednika w INSPIRE (ta sama klasa ZDR/ZZR i podobna nazwa).
 */
export function porownajZWykazem(wykaz, zaklady, wojewodztwa) {
  const wybrane = wykaz.filter((w) => wojewodztwa.includes(w.wojewodztwo))
  const brak = wybrane.filter(
    (w) => !zaklady.some((z) => z.typ === w.klasa && tenSamZaklad(z.nazwaPelna, w.nazwa)),
  )
  return { razem: wybrane.length, zgodne: wybrane.length - brak.length, brak }
}

export function etykietaZakladu(zaklad) {
  return `${zaklad.nazwa} (${zaklad.typ})`
}

/** Bieżący rejestr GIOŚ dla województwa (strony po 50, numeracja od 0). */
async function rejestrBiezacy(wojewodztwo) {
  const wpisy = []
  let pobrano = null
  for (let strona = 0; strona < 20; strona++) {
    const url = `${URL_REJESTRU}?numerStrony=${strona}&liczbaElementowNaStronie=50&wojewodztwo=${encodeURIComponent(wojewodztwo)}`
    const plik = await pobierzTrwale(
      url,
      plikCache(`seveso_rejestr_${bezOgonkow(wojewodztwo)}_${strona}.json`),
    )
    pobrano ??= dataPobrania(plik)
    const czesc = wpisyZApi(JSON.parse(readFileSync(plik, 'utf8')))
    wpisy.push(...czesc)
    if (czesc.length < 50) break
  }
  return { wpisy, pobrano }
}

async function main() {
  const kolekcja = await pobierzKolekcje(URL_OGC, 'seveso')
  const { zaklady, odrzucone } = zakladyZGeojson(kolekcja.features)
  console.log(
    `INSPIRE Seveso: ${kolekcja.features.length} obiektów, użyto ${zaklady.length}, odrzucone ${JSON.stringify(odrzucone)}`,
  )
  if (zaklady.length < 400) throw new Error(`Podejrzanie mało zakładów Seveso: ${zaklady.length}`)

  // Kontrola 1 (twarda): INSPIRE musi pokrywać bieżący rejestr GIOŚ w Małopolsce i u sąsiadów.
  const rejestr = []
  let pobranoRejestr = null
  for (const woj of WOJEWODZTWA_KONTROLI) {
    const r = await rejestrBiezacy(woj)
    rejestr.push(...r.wpisy)
    pobranoRejestr ??= r.pobrano
  }
  const kontrolaRejestru = porownajZWykazem(rejestr, zaklady, WOJEWODZTWA_KONTROLI)
  console.log(
    `Rejestr bieżący (API GIOŚ): ${kontrolaRejestru.razem} zakładów, zgodnych z INSPIRE ${kontrolaRejestru.zgodne}`,
  )
  for (const b of kontrolaRejestru.brak)
    console.log(`  brak w INSPIRE: ${b.klasa} ${b.wojewodztwo} ${b.nazwa} | ${b.adres}`)
  if (kontrolaRejestru.brak.length)
    throw new Error('INSPIRE nie pokrywa bieżącego rejestru GIOŚ – uzupełnij współrzędne')

  // Kontrola 2 (informacyjna): wykaz xlsx na 31.12.2025 może różnić się od stanu bieżącego.
  const xlsx = await pobierzTrwale(URL_XLSX, plikCache('seveso_wykaz_2025-12-31.xlsx'))
  const wykaz = wykazZXlsx(readFileSync(xlsx))
  const kontrolaWykazu = porownajZWykazem(wykaz, zaklady, WOJEWODZTWA_KONTROLI)
  console.log(
    `Wykaz xlsx 31.12.2025: ${wykaz.length} zakładów w kraju, w województwach kontroli ${kontrolaWykazu.razem}, zgodnych z INSPIRE ${kontrolaWykazu.zgodne}`,
  )
  for (const b of kontrolaWykazu.brak)
    console.log(`  tylko w wykazie 31.12.2025: ${b.klasa} ${b.wojewodztwo} ${b.nazwa} | ${b.adres}`)

  const { adresy } = wczytajAdresy()
  const indeks = new IndeksPunktow(zaklady)
  const wyniki = adresy.map((a) => {
    const [x, y] = do2180(a.lon, a.lat)
    return indeks.najblizszy(x, y, ZAKRES_M)
  })
  if (wyniki.some((w) => w === null)) throw new Error('Adres bez zakładu Seveso w zasięgu')
  const wartosci = wyniki.map((w) => Math.round(w.odleglosc / ZAOKRAGLENIE_M) * ZAOKRAGLENIE_M)
  const etykiety = wyniki.map((w) =>
    w.odleglosc <= PROMIEN_ETYKIETY_M ? etykietaZakladu(w.punkt) : null,
  )
  const maks = wartosci.reduce((m, v) => Math.max(m, v), 0)
  const p99 = [...wartosci].sort((a, b) => a - b)[Math.floor(0.99 * wartosci.length)]
  console.log(`Maks. odległość ${maks} m, z etykietą ${etykiety.filter(Boolean).length} adresów`)

  zapiszWskaznik(
    {
      id: 'seveso_odleglosc',
      kategoria: 'bezpieczenstwo',
      nazwa: 'Odległość od zakładu Seveso',
      opis: `Odległość w linii prostej od punktu adresu do najbliższego zakładu o dużym (ZDR) lub zwiększonym (ZZR) ryzyku poważnej awarii przemysłowej, czyli zakładu Seveso, z rejestru GIOŚ. Rejestr jest krajowy, więc każdy adres ma wynik. Mierzymy do punktu lokalizacji zakładu z rejestru INSPIRE (ok. 1,5% współrzędnych jest podanych z dokładnością do ok. 1 km), a nie do granicy terenu czy strefy zagrożenia; zasięg skutków awarii zależy od zakładu i substancji. Odległość zaokrąglona do ${ZAOKRAGLENIE_M} m. Etykieta z nazwą i klasą najbliższego zakładu jest podana dla adresów w odległości do ${PROMIEN_ETYKIETY_M} m.`,
      jednostka: 'm',
      kierunek: 'wiecej-lepiej',
      rozdzielczosc: 'adres',
      zakres: [0, Math.ceil(p99 / 5000) * 5000],
      zadanie: 116,
      zrodla: [
        {
          nazwa:
            'GIOŚ – Zakłady stwarzające zagrożenie wystąpienia poważnej awarii przemysłowej (SEVESO), INSPIRE OGC API Features: współrzędne i klasa ZDR/ZZR',
          url: URL_KOLEKCJI,
          licencja: `CC BY 4.0 (dane.gov.pl, zbiór 2540: ${ZBIOR_SEVESO})`,
          dataDanych: kolekcja.dataDanych,
          pobrano: kolekcja.pobrano,
        },
        {
          nazwa:
            'GIOŚ – rejestr zakładów ZZR i ZDR, API bieżącego rejestru (kontrola kompletności w województwach małopolskim, śląskim i świętokrzyskim)',
          url: URL_REJESTRU,
          licencja: `CC BY 4.0 (dane.gov.pl, zbiór 34643: ${ZBIOR_API})`,
          dataDanych: pobranoRejestr,
          pobrano: pobranoRejestr,
        },
        {
          nazwa:
            'GIOŚ – Wykaz zakładów stwarzających zagrożenie wystąpienia poważnej awarii przemysłowej wg stanu na 31.12.2025 (lista kontrolna, bez współrzędnych)',
          url: URL_WYKAZU,
          licencja: `CC BY 4.0 (te same dane na dane.gov.pl, zbiór 2540: ${ZBIOR_SEVESO})`,
          dataDanych: '2025-12-31',
          pobrano: dataPobrania(xlsx),
        },
      ],
    },
    wartosci,
    etykiety,
  )
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1])
  main().catch((blad) => {
    console.error(blad)
    process.exitCode = 1
  })
