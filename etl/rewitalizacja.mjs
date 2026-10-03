// Obszar rewitalizacji Krakowa (#125): czy adres leży w podobszarze rewitalizacji. Kategoria
// „kontekst": fakt na karcie, bez wpływu na wynik.
//
// Źródło: MSIP, zbiór 2341 „Obszar rewitalizacji w Mieście Krakowie od 2022" (usługa
// Rewitalizacja_od_2022, warstwa 0 „Podobszary rewitalizacji", trzy wielokąty), wyznaczony uchwałą
// Nr XCVII/2644/22 Rady Miasta Krakowa z 12 października 2022 r. (Dz. Urz. Woj. Małopolskiego
// 2022 poz. 6865).
//
// Dlaczego warstwa 0, a nie zbiór 2342 z opisu zadania: zbiór 2342 to szerszy obszar analizy
// stanu kryzysowego (6 podobszarów, warstwa 1 tej samej usługi), a zadanie mówi o adresie
// „objętym programem rewitalizacji". Tę szerszą warstwę pomijamy w całości: na karcie jest tylko
// to, co wyznaczono do rewitalizacji, i tylko jako „objęty programem rewitalizacji".
//
// Poza Krakowem null (brak danych): inne gminy mają własne programy, których tu nie ma.
// Uruchom: node etl/rewitalizacja.mjs. Surowa warstwa trafia do etl/.cache/rewitalizacja.geojson
// (żeby pobrać ponownie, usuń ten plik). Gdy Node odrzuci certyfikat MSIP: NODE_EXTRA_CA_CERTS.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dzis, pobierzDoCache, wczytajAdresy, zapiszWskaznik } from './lib/wspolne.mjs'

const WARSTWA =
  'https://msip.um.krakow.pl/arcgis/rest/services/Obserwatorium/Rewitalizacja_od_2022/MapServer/0'
const ZBIOR = 'https://msip.krakow.pl/dataset/2341'
const LICENCJA_MSIP = 'Regulamin MSIP: https://msip.krakow.pl/getHtml?dok_id=228972'
const UCHWALA = 'XCVII/2644/22'
const TERYT_KRAKOW = '1261011'
export const ETYKIETA = 'objęty programem rewitalizacji'

/** Wielokąty podobszarów z GeoJSON z MSIP; błąd przy zmianie uchwały albo kształtu danych. */
export function podobszary(geojson) {
  if (geojson?.type !== 'FeatureCollection' || !Array.isArray(geojson.features))
    throw new Error('Rewitalizacja: oczekiwano FeatureCollection')
  if (geojson.exceededTransferLimit) throw new Error('Rewitalizacja: warstwa ucięta limitem MSIP')
  if (!geojson.features.length) throw new Error('Rewitalizacja: pusta warstwa')
  return geojson.features.map((f) => {
    const typ = f.geometry?.type
    if (typ !== 'Polygon' && typ !== 'MultiPolygon')
      throw new Error(`Rewitalizacja: oczekiwano wielokąta, jest ${typ}`)
    if (!String(f.properties?.uchwała ?? '').includes(UCHWALA))
      throw new Error(
        `Rewitalizacja: podobszar poza uchwałą ${UCHWALA} – sprawdź zmianę uchwały i opis wskaźnika`,
      )
    const nazwa = String(f.properties?.nazwa_gpr ?? '').trim()
    if (!nazwa) throw new Error('Rewitalizacja: podobszar bez nazwy')
    const wielokaty = typ === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates
    return { nazwa, wielokaty, bbox: bbox(wielokaty) }
  })
}

function bbox(wielokaty) {
  const b = [Infinity, Infinity, -Infinity, -Infinity]
  for (const w of wielokaty)
    for (const [x, y] of w[0]) {
      b[0] = Math.min(b[0], x)
      b[1] = Math.min(b[1], y)
      b[2] = Math.max(b[2], x)
      b[3] = Math.max(b[3], y)
    }
  return b
}

function wPierscieniu(lon, lat, pierscien) {
  let wSrodku = false
  for (let i = 0, j = pierscien.length - 1; i < pierscien.length; j = i++) {
    const [xi, yi] = pierscien[i]
    const [xj, yj] = pierscien[j]
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) wSrodku = !wSrodku
  }
  return wSrodku
}

/** Punkt w wielokącie z otworami: pierwszy pierścień to obrys, kolejne to dziury. */
export function punktWWielokacie(lon, lat, pierscienie) {
  return (
    wPierscieniu(lon, lat, pierscienie[0]) &&
    !pierscienie.slice(1).some((otwor) => wPierscieniu(lon, lat, otwor))
  )
}

/** Podobszar zawierający punkt albo null. */
export function znajdzPodobszar(lon, lat, lista) {
  return (
    lista.find(
      (p) =>
        lon >= p.bbox[0] &&
        lon <= p.bbox[2] &&
        lat >= p.bbox[1] &&
        lat <= p.bbox[3] &&
        p.wielokaty.some((w) => punktWWielokacie(lon, lat, w)),
    ) ?? null
  )
}

/** Wartość dla adresu: 1/0 w Krakowie, null poza nim (brak danych, nie „poza obszarem"). */
export function wartoscAdresu(adres, lista) {
  if (adres.teryt !== TERYT_KRAKOW) return { wartosc: null, etykieta: null, podobszar: null }
  const p = znajdzPodobszar(adres.lon, adres.lat, lista)
  return p
    ? { wartosc: 1, etykieta: ETYKIETA, podobszar: p.nazwa }
    : { wartosc: 0, etykieta: null, podobszar: null }
}

/** „Podobszar rewitalizacji Kazimierz-Stradom" → „Kazimierz-Stradom" do opisu. */
const krotkaNazwa = (nazwa) => nazwa.replace(/^Podobszar rewitalizacji\s+/i, '')

export function opisWskaznika(lista) {
  const nazwy = lista.map((p) => krotkaNazwa(p.nazwa)).join(', ')
  return `1 = adres leży w obszarze rewitalizacji Krakowa wyznaczonym uchwałą Rady Miasta Krakowa z 12 października 2022 r. (podobszary: ${nazwy}), czyli tam, gdzie miasto planuje i prowadzi działania rewitalizacyjne. 0 = adres w Krakowie poza tym obszarem. Poza Krakowem brak danych: inne gminy mają własne programy. To informacja o kierunku działań miasta, a nie ocena okolicy; nie wpływa na wynik.`
}

async function main() {
  const plik = await pobierzDoCache(
    `${WARSTWA}/query?where=1%3D1&outFields=*&returnGeometry=true&outSR=4326&f=geojson`,
    'rewitalizacja.geojson',
    { headers: { 'User-Agent': 'adresscore-etl/1.0 (HackYeah 2026)' } },
  )
  const lista = podobszary(JSON.parse(readFileSync(plik, 'utf8')))
  const { adresy } = wczytajAdresy()
  const wyniki = adresy.map((a) => wartoscAdresu(a, lista))
  const pobrano = dzis()
  zapiszWskaznik(
    {
      id: 'obszar_rewitalizacji',
      kategoria: 'kontekst',
      nazwa: 'Obszar rewitalizacji',
      opis: opisWskaznika(lista),
      jednostka: 'status',
      kierunek: 'neutralny',
      rozdzielczosc: 'adres',
      zakres: [0, 1],
      zadanie: 125,
      zrodla: [
        {
          nazwa:
            'Gmina Miejska Kraków, Portal MSIP Obserwatorium (https://msip.krakow.pl) – Obszar rewitalizacji w Mieście Krakowie od 2022',
          url: ZBIOR,
          licencja: LICENCJA_MSIP,
          dataDanych: '2022-10-12',
          pobrano,
        },
        {
          nazwa:
            'Uchwała Nr XCVII/2644/22 Rady Miasta Krakowa z dnia 12 października 2022 r. (Dz. Urz. Woj. Małopolskiego 2022 poz. 6865)',
          url: 'http://edziennik.malopolska.uw.gov.pl/legalact/2022/6865/',
          licencja: 'Akt prawa miejscowego (informacja publiczna)',
          dataDanych: '2022-10-12',
          pobrano,
        },
      ],
    },
    wyniki.map((w) => w.wartosc),
    wyniki.map((w) => w.etykieta),
  )

  const poPodobszarach = new Map()
  for (const w of wyniki)
    if (w.podobszar) poPodobszarach.set(w.podobszar, (poPodobszarach.get(w.podobszar) ?? 0) + 1)
  console.log(
    `Rewitalizacja: ${lista.length} podobszary; adresów w obszarze: ${[...poPodobszarach.entries()].map(([n, c]) => `${krotkaNazwa(n)} ${c}`).join(', ')}`,
  )
  // Kontrola na znanych miejscach: Kazimierz i osiedla Nowej Huty w obszarze, Stare Miasto poza nim.
  const kontrola = [
    ['Kraków', 'Szeroka'],
    ['Kraków', 'Miodowa'],
    ['Kraków', 'Osiedle Teatralne'],
    ['Kraków', 'Rynek Główny'],
    ['Kraków', 'Floriańska'],
    ['Wieliczka', 'Rynek Górny'],
  ]
  for (const [miejscowosc, ulica] of kontrola) {
    const i = adresy.findIndex((a) => a.miejscowosc === miejscowosc && a.ulica === ulica)
    console.log(
      `Kontrola ${miejscowosc}, ${ulica} ${i < 0 ? '(brak adresu w PRG)' : `${adresy[i].nr}: ${wyniki[i].wartosc} ${wyniki[i].podobszar ?? ''}`}`,
    )
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1])
  main().catch((blad) => {
    console.error(blad)
    process.exitCode = 1
  })
