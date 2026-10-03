// Źródło: WFS RCN Wydziału Geodezji UMK, https://geodezja.eco.um.krakow.pl/cgi-bin/krakow-rcn.
// Dane RCN są nieodpłatne od 13.02.2026 (Prawo geodezyjne i kartograficzne); liczymy medianę brutto zł/m²
// mieszkań z ostatnich 24 miesięcy w H3 r8 (min. 10 transakcji), potem r7, inaczej null.
// Uruchom: node etl/ceny.mjs. Strony GML są buforowane w etl/.cache/.
import { readFileSync, statSync } from 'node:fs'
import { cellToParent, latLngToCell } from 'h3-js'
import proj4 from 'proj4'
import { dzis, pobierzDoCache, wczytajAdresy, zapiszWskaznik } from './lib/wspolne.mjs'

const ZRODLO = 'https://geodezja.eco.um.krakow.pl/cgi-bin/krakow-rcn'
const DZIEN = dzis()
const POCZATEK = new Date(`${DZIEN}T00:00:00Z`)
POCZATEK.setUTCMonth(POCZATEK.getUTCMonth() - 24)
const OD = POCZATEK.toISOString().slice(0, 10)
const filtr = `<fes:Filter xmlns:fes="http://www.opengis.net/fes/2.0"><fes:And><fes:PropertyIsGreaterThanOrEqualTo><fes:ValueReference>DOK_DATA</fes:ValueReference><fes:Literal>${OD}</fes:Literal></fes:PropertyIsGreaterThanOrEqualTo><fes:PropertyIsEqualTo><fes:ValueReference>LOK_FUNKCJA</fes:ValueReference><fes:Literal>mieszkalna</fes:Literal></fes:PropertyIsEqualTo></fes:And></fes:Filter>`
const baza = new URL(ZRODLO)
// Serwer zwraca 0 rekordów, gdy SRSNAME występuje razem z FILTER; używamy domyślnego EPSG:2178.
baza.search = new URLSearchParams({
  SERVICE: 'WFS',
  REQUEST: 'GetFeature',
  VERSION: '2.0.0',
  TYPENAMES: 'ms:lokale',
  FILTER: filtr,
}).toString()
const ident = OD.replaceAll('-', '')
const trafienia = await pobierzDoCache(`${baza}&RESULTTYPE=hits`, `rcn-${ident}-2178-hits.xml`)
const wynik = readFileSync(trafienia, 'utf8')
const liczba = Number(wynik.match(/numberMatched="(\d+)"/)?.[1])
if (!Number.isInteger(liczba)) throw new Error('RCN: nie udało się odczytać liczby rekordów WFS')
if (liczba > 200000) throw new Error(`RCN: niespodziewana liczba rekordów ${liczba}`)

proj4.defs(
  'EPSG:2178',
  '+proj=tmerc +lat_0=0 +lon_0=21 +k=0.999923 +x_0=7500000 +y_0=0 +ellps=GRS80 +units=m +no_defs',
)
const grupy8 = new Map(),
  grupy7 = new Map()
const widziane = new Set()
let poprawne = 0,
  odrzucone = 0
let najnowsza = OD
const pole = (xml, nazwa) =>
  xml.match(new RegExp(`<ms:${nazwa}>([^<]*)<\\/ms:${nazwa}>`))?.[1]?.trim() ?? ''

async function pobierzStrone(start) {
  const url = `${baza}&COUNT=${Math.min(1000, liczba - start)}&STARTINDEX=${start}`
  const nazwa = `rcn-${ident}-2178-${start}.xml`
  for (let proba = 1; proba <= 4; proba++) {
    try {
      return await pobierzDoCache(url, nazwa)
    } catch (blad) {
      if (proba === 4) throw blad
      await new Promise((resolve) => setTimeout(resolve, proba * 2000))
    }
  }
}

const strony = []
for (let start = 0; start < liczba; start += 1000) strony.push(start)
const plikiStron = []
for (let i = 0; i < strony.length; i += 2) {
  const paczka = strony.slice(i, i + 2)
  const pliki = await Promise.all(paczka.map(pobierzStrone))
  plikiStron.push(...pliki)
}
// Transakcja obejmująca kilka lokali nie jest pojedynczą obserwacją ceny mieszkania.
const liczbyAktow = new Map()
for (const plik of plikiStron) {
  const xml = readFileSync(plik, 'utf8')
  for (const match of xml.matchAll(/<wfs:member>([\s\S]*?)<\/wfs:member>/g)) {
    const id = pole(match[1], 'TRAN_LOKALNY_ID_IIP')
    if (id) liczbyAktow.set(id, (liczbyAktow.get(id) ?? 0) + 1)
  }
}
for (let j = 0; j < plikiStron.length; j++) {
  const start = strony[j]
  const count = Math.min(1000, liczba - start)
  const plik = plikiStron[j]
  const xml = readFileSync(plik, 'utf8')
  const zwrocone = Number(xml.match(/numberReturned="(\d+)"/)?.[1])
  if (zwrocone !== count)
    throw new Error(`RCN: strona ${start}: oczekiwano ${count}, zwrócono ${zwrocone}`)
  for (const match of xml.matchAll(/<wfs:member>([\s\S]*?)<\/wfs:member>/g)) {
    const r = match[1]
    const data = pole(r, 'DOK_DATA').slice(0, 10)
    const pow = Number(pole(r, 'LOK_POW_UZYT'))
    // Cena lokalu jest precyzyjniejsza; cena całej transakcji bywa sumą kilku lokali.
    const cena = Number(pole(r, 'LOK_CENA_BRUTTO'))
    const metr = cena / pow
    const id = pole(r, 'TRAN_LOKALNY_ID_IIP')
    const pos = r.match(/<gml:pos>([\d.]+) ([\d.]+)<\/gml:pos>/)?.[0]?.match(/([\d.]+) ([\d.]+)/)
    if (
      pole(r, 'TERYT') !== '1261' ||
      data < OD ||
      data > DZIEN ||
      !Number.isFinite(pow) ||
      pow < 15 ||
      !Number.isFinite(cena) ||
      cena <= 0 ||
      metr < 2000 ||
      metr > 60000 ||
      !pos ||
      !id ||
      liczbyAktow.get(id) !== 1 ||
      widziane.has(id)
    ) {
      odrzucone++
      continue
    }
    // WFS EPSG:2178 podaje formalną kolejność osi: northing, easting.
    const [lon, lat] = proj4('EPSG:2178', 'EPSG:4326', [Number(pos[2]), Number(pos[1])])
    if (lon < 19.6 || lon > 20.4 || lat < 49.8 || lat > 50.3) {
      odrzucone++
      continue
    }
    widziane.add(id)
    const h8 = latLngToCell(lat, lon, 8)
    const h7 = cellToParent(h8, 7)
    if (!grupy8.has(h8)) grupy8.set(h8, [])
    if (!grupy7.has(h7)) grupy7.set(h7, [])
    grupy8.get(h8).push(metr)
    grupy7.get(h7).push(metr)
    poprawne++
    if (data > najnowsza) najnowsza = data
  }
}

function mediana(a) {
  a.sort((x, y) => x - y)
  const n = a.length
  return (a[Math.floor((n - 1) / 2)] + a[Math.floor(n / 2)]) / 2
}
const stat8 = new Map(
  [...grupy8]
    .filter(([, a]) => a.length >= 10)
    .map(([h, a]) => [h, { n: a.length, wartosc: mediana(a) }]),
)
const stat7 = new Map(
  [...grupy7]
    .filter(([, a]) => a.length >= 10)
    .map(([h, a]) => [h, { n: a.length, wartosc: mediana(a) }]),
)
const { adresy } = wczytajAdresy()
const wartosci = [],
  etykiety = []
let r8 = 0,
  r7 = 0
for (const a of adresy) {
  if (a.gmina !== 'Kraków') {
    wartosci.push(null)
    etykiety.push(null)
    continue
  }
  const h8 = latLngToCell(a.lat, a.lon, 8)
  const s8 = stat8.get(h8)
  const s7 = stat7.get(cellToParent(h8, 7))
  const s = s8 ?? s7
  if (s8) r8++
  else if (s7) r7++
  wartosci.push(s?.wartosc ?? null)
  etykiety.push(
    s
      ? `mediana z ${s.n} transakcji, ${OD.slice(0, 4)}–${DZIEN.slice(0, 4)} (H3 r${s8 ? 8 : 7})`
      : null,
  )
}
const pobrano = statSync(trafienia).mtime.toISOString().slice(0, 10)
zapiszWskaznik(
  {
    id: 'cena_m2_mediana',
    kategoria: 'kontekst',
    nazwa: 'Mediana ceny m²',
    opis: `Mediana ceny brutto 1 m² lokali mieszkalnych z aktów ${OD}–${DZIEN}; tylko akty z jednym lokalem i ceną przypisaną do lokalu. Co najmniej 10 transakcji w H3 r8, inaczej H3 r7, inaczej brak danych. Wykluczono powierzchnię <15 m² i cenę m² poza 2 000–60 000 zł. Dane wyłącznie dla Krakowa.`,
    jednostka: 'zł/m²',
    kierunek: 'neutralny',
    rozdzielczosc: 'heks',
    rozmiar: 'H3 r8 (średnia powierzchnia ~0,74 km²), przy <10 transakcjach H3 r7 (~5,16 km²)',
    zakres: [2000, 60000],
    zadanie: 26,
    zrodla: [
      {
        nazwa: 'Urząd Miasta Krakowa, WFS Rejestr Cen Nieruchomości',
        url: ZRODLO,
        licencja:
          'Nieodpłatne udostępnianie ustawowe od 13.02.2026 (Dz.U. 2025 poz. 1542); WFS nie wskazuje odrębnej licencji',
        dataDanych: najnowsza,
        pobrano,
      },
    ],
  },
  wartosci,
  etykiety,
)
console.log(
  `RCN: ${liczba} rekordów WFS, ${poprawne} transakcji po filtrach, ${odrzucone} odrzuconych; adresy H3 r8: ${r8}, r7: ${r7}`,
)
