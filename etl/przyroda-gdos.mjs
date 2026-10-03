// Odległość od adresu do najbliższej chronionej przyrody: rezerwaty, parki narodowe i krajobrazowe,
// Natura 2000 (obszary ptasie i siedliskowe), użytki ekologiczne, zespoły przyrodniczo-krajobrazowe.
// Źródło: GDOŚ, Centralny Rejestr Form Ochrony Przyrody, usługa WFS https://sdi.gdos.gov.pl/wfs.
// Poza wskaźnikiem zostają: otuliny (strefy buforowe, nie obszar chroniony), obszary chronionego
// krajobrazu (obejmują większość regionu, więc nic by nie różnicowały), pomniki przyrody
// (pojedyncze drzewa i głazy) i stanowiska dokumentacyjne (obiekty geologiczne, zwykle niedostępne).
// Adres w obrębie obszaru = 0 m, poza nim odległość do najbliższej granicy.
// Uruchom: node etl/przyroda-gdos.mjs. Surowe pobrania: etl/.cache/ryzyka/.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { do2180, IndeksWielokatow, wielokatyZGeojson } from './lib/geo.mjs'
import { dataPobrania, plikCache, pobierzTrwale } from './lib/pobieranie.mjs'
import { wczytajAdresy, zapiszWskaznik } from './lib/wspolne.mjs'

const WFS = 'https://sdi.gdos.gov.pl/wfs'
const ZBIOR = 'https://dane.gov.pl/pl/dataset/471,centralny-rejestr-form-ochrony-przyrody'
/** Rodzaje obszarów i ich pierwszeństwo przy nakładaniu się (mniejsza liczba = ostrzejsza ochrona). */
export const FORMY = [
  { warstwa: 'ParkiNarodowe', rodzaj: 'park narodowy', priorytet: 1 },
  { warstwa: 'Rezerwaty', rodzaj: 'rezerwat przyrody', priorytet: 2 },
  { warstwa: 'ParkiKrajobrazowe', rodzaj: 'park krajobrazowy', priorytet: 3 },
  { warstwa: 'ObszarySpecjalnejOchrony', rodzaj: 'Natura 2000, obszar ptasi', priorytet: 4 },
  { warstwa: 'SpecjalneObszaryOchrony', rodzaj: 'Natura 2000, obszar siedliskowy', priorytet: 4 },
  { warstwa: 'UzytkiEkologiczne', rodzaj: 'użytek ekologiczny', priorytet: 5 },
  {
    warstwa: 'ZespolyPrzyrodniczoKrajobrazowe',
    rodzaj: 'zespół przyrodniczo-krajobrazowy',
    priorytet: 6,
  },
]
/** Margines pobierania wokół adresów (stopnie): ok. 28 km na północ-południe i 29 km na wschód-zachód. */
const MARGINES = { lon: 0.4, lat: 0.25 }
const ZAKRES_M = 25_000
/** Etykieta z nazwą obszaru tylko w pobliżu – dalej nazwa nie wpływa na decyzję, a waży w pliku. */
const PROMIEN_ETYKIETY_M = 300

/** Otulina to strefa buforowa wokół obszaru chronionego, a nie sam obszar – nie liczymy jej. */
export const czyOtulina = (nazwa) => /otulin/i.test(String(nazwa ?? ''))

/**
 * Wielokąty (EPSG:2180) jednej warstwy GDOŚ bez otulin. `dane` niesie nazwę, rodzaj i pierwszeństwo.
 * Zwraca też liczbę pominiętych otulin.
 */
export function wielokatyForm(features, forma) {
  const wielokaty = []
  let otuliny = 0
  for (const f of features) {
    const nazwa = f.properties?.nazwa ?? null
    if (czyOtulina(nazwa)) {
      otuliny++
      continue
    }
    if (!f.geometry) throw new Error(`${forma.warstwa}: obiekt ${f.id} bez geometrii`)
    wielokaty.push(
      ...wielokatyZGeojson(f.geometry, {
        nazwa: nazwa ? String(nazwa).trim() : null,
        rodzaj: forma.rodzaj,
        priorytet: forma.priorytet,
      }),
    )
  }
  return { wielokaty, otuliny }
}

export function etykietaObszaru(dane) {
  return dane.nazwa ? `${dane.rodzaj}: ${dane.nazwa}` : dane.rodzaj
}

/** Wartość wskaźnika: 0 tylko w obrębie obszaru, poza nim co najmniej 1 m (zaokrąglenie nie zeruje). */
export const metryDoObszaru = (odleglosc) =>
  odleglosc <= 0 ? 0 : Math.max(1, Math.round(odleglosc))

/** bbox pobierania: zakres współrzędnych adresów powiększony o margines (lon, lat, WGS84). */
export function bboxPobierania(adresy, margines = MARGINES) {
  let lonMin = Infinity
  let latMin = Infinity
  let lonMax = -Infinity
  let latMax = -Infinity
  for (const a of adresy) {
    lonMin = Math.min(lonMin, a.lon)
    lonMax = Math.max(lonMax, a.lon)
    latMin = Math.min(latMin, a.lat)
    latMax = Math.max(latMax, a.lat)
  }
  const r = (v) => Math.round(v * 100) / 100
  return [
    r(lonMin - margines.lon),
    r(latMin - margines.lat),
    r(lonMax + margines.lon),
    r(latMax + margines.lat),
  ]
}

function adresWfs(warstwa, bbox, dodatek) {
  return `${WFS}?service=WFS&version=2.0.0&request=GetFeature&typeNames=GDOS:${warstwa}&bbox=${bbox.join(',')},EPSG:4326${dodatek}`
}

/** Warstwa GDOŚ w bbox jako GeoJSON (WGS84, lon/lat); liczbę obiektów sprawdzamy zapytaniem „hits”. */
async function pobierzWarstwe(warstwa, bbox) {
  const klucz = bbox.join('_')
  const plikHits = await pobierzTrwale(
    adresWfs(warstwa, bbox, '&resultType=hits'),
    plikCache(`gdos_${warstwa}_${klucz}_hits.xml`),
  )
  const zgloszone = Number(/numberMatched="(\d+)"/.exec(readFileSync(plikHits, 'utf8'))?.[1])
  const plik = await pobierzTrwale(
    adresWfs(warstwa, bbox, '&outputFormat=application/json&srsName=EPSG:4326'),
    plikCache(`gdos_${warstwa}_${klucz}.json`),
  )
  let geojson
  try {
    geojson = JSON.parse(readFileSync(plik, 'utf8'))
  } catch {
    throw new Error(`GDOŚ ${warstwa}: odpowiedź nie jest GeoJSON (usuń ${plik})`)
  }
  if (geojson.type !== 'FeatureCollection' || !Array.isArray(geojson.features))
    throw new Error(`GDOŚ ${warstwa}: to nie jest FeatureCollection (usuń ${plik})`)
  if (!Number.isFinite(zgloszone) || geojson.features.length !== zgloszone)
    throw new Error(
      `GDOŚ ${warstwa}: pobrano ${geojson.features.length}, usługa zgłasza ${zgloszone}`,
    )
  return { features: geojson.features, pobrano: dataPobrania(plik) }
}

async function main() {
  const { adresy } = wczytajAdresy()
  const bbox = bboxPobierania(adresy)
  console.log(`bbox pobierania (lon/lat): ${bbox.join(', ')}`)
  const wszystkie = []
  let pobrano = null
  for (const forma of FORMY) {
    const { features, pobrano: kiedy } = await pobierzWarstwe(forma.warstwa, bbox)
    pobrano ??= kiedy
    const { wielokaty, otuliny } = wielokatyForm(features, forma)
    console.log(
      `${forma.warstwa}: ${features.length} obiektów, w tym ${otuliny} otulin pominiętych, ${wielokaty.length} wielokątów`,
    )
    wszystkie.push(...wielokaty)
  }
  const indeks = new IndeksWielokatow(wszystkie, 1000)
  const start = performance.now()
  const wyniki = adresy.map((a) => {
    const [x, y] = do2180(a.lon, a.lat)
    return indeks.najblizszy(x, y, ZAKRES_M)
  })
  console.log(`Odległości policzone w ${((performance.now() - start) / 1000).toFixed(1)} s`)
  const bezWyniku = wyniki.filter((w) => w === null).length
  if (bezWyniku) throw new Error(`${bezWyniku} adresów bez obszaru chronionego w ${ZAKRES_M} m`)
  const wartosci = wyniki.map((w) => metryDoObszaru(w.odleglosc))
  const etykiety = wyniki.map((w) =>
    w.odleglosc <= PROMIEN_ETYKIETY_M ? etykietaObszaru(wszystkie[w.wielokat].dane) : null,
  )
  const wObrebie = wartosci.filter((v) => v === 0).length
  const maks = wartosci.reduce((m, v) => Math.max(m, v), 0)
  console.log(
    `W obrębie obszaru: ${wObrebie} adresów, maks. odległość ${maks} m, z etykietą ${etykiety.filter(Boolean).length}`,
  )

  zapiszWskaznik(
    {
      id: 'przyroda_chroniona_odleglosc',
      kategoria: 'spokoj',
      nazwa: 'Odległość od chronionej przyrody',
      opis: `Odległość od punktu adresu do najbliższego obszaru chronionej przyrody: rezerwatu, parku narodowego lub krajobrazowego, obszaru Natura 2000, użytku ekologicznego albo zespołu przyrodniczo-krajobrazowego. 0 m = adres leży w obrębie takiego obszaru, poza nim liczymy odległość do najbliższej granicy. Nie liczymy otulin, obszarów chronionego krajobrazu, pomników przyrody ani stanowisk dokumentacyjnych. Obszar chroniony nie oznacza ogólnodostępnego terenu rekreacyjnego, a część obszarów (np. Natura 2000 wzdłuż rzek) leży w zabudowie. Etykieta z rodzajem i nazwą obszaru jest podana dla adresów w odległości do ${PROMIEN_ETYKIETY_M} m.`,
      jednostka: 'm',
      kierunek: 'mniej-lepiej',
      rozdzielczosc: 'adres',
      zakres: [0, 5000],
      zadanie: 116,
      zrodla: [
        {
          nazwa:
            'GDOŚ – Centralny Rejestr Form Ochrony Przyrody, usługa WFS: rezerwaty, parki narodowe i krajobrazowe, Natura 2000, użytki ekologiczne, zespoły przyrodniczo-krajobrazowe',
          url: WFS,
          licencja: `CC0 1.0 (dane.gov.pl, zbiór 471: ${ZBIOR})`,
          dataDanych: pobrano,
          pobrano,
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
