// Wypadki drogowe z SEWIK (Policja) 2018–2024 → dwie warstwy heksowe H3 r8 (#69).
// Uruchom: node etl/wypadki.mjs <zrzut SEWIK XML (rozpakowany plik lub katalog z plikami .xml)>
// Parser strumieniowy: plik czytamy kawałkami i wycinamy kolejne bloki <ZDARZENIE>…</ZDARZENIE>,
// więc 458 MB XML nie trafia do pamięci. Surowy zrzut trzymaj w etl/.cache/sewik/ i usuń po biegu.
// Opis, wagi i założenia o polach: etl/wypadki.md.
import { createReadStream, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { cellToParent, latLngToCell } from 'h3-js'
import { dzis, wczytajAdresy, zapiszWskaznik } from './lib/wspolne.mjs'

export const RES = 8
export const LATA = [2018, 2024]
/** Waga zdarzenia: każde zdarzenie 1 + ofiary. Zabity (na miejscu lub do 30 dni) waży najwięcej. */
export const WAGI = { zdarzenie: 1, zabity: 10, ciezko: 4, lekko: 1 }
// Kody stanu uczestnika w SEWIK (pole STUC_KOD / SSRU_KOD): Z, ZM – zabity; RC – ranny ciężko;
// RL – ranny lekko. Rodzaj uczestnika (SRUZ_KOD / RODZAJ_UCZESTNIKA): P / I – pieszy.
// Rower: rodzaj pojazdu (RODZAJ_POJAZDU / SRPO_KOD) z „rower” w nazwie albo kod IS101.
const STAN = { Z: 'zabity', ZM: 'zabity', RC: 'ciezko', RL: 'lekko' }

/** Proste pola bloku XML (bez zagnieżdżeń) → { NAZWA: tekst }. Pierwsze wystąpienie wygrywa. */
export function pola(xml) {
  const wynik = {}
  for (const m of xml.matchAll(/<([A-Z_0-9]+)>([^<]*)<\/\1>/gi)) {
    const k = m[1].toUpperCase()
    if (!(k in wynik)) wynik[k] = m[2].trim()
  }
  return wynik
}

const bloki = (xml, tag) =>
  [...xml.matchAll(new RegExp(`<${tag}[\\s>][\\s\\S]*?<\\/${tag}>`, 'gi'))].map((m) => m[0])

/** Współrzędna z SEWIK: „50,0614” albo „50.0614”; zero i puste = brak. */
export function liczba(t) {
  if (t == null || t === '') return null
  const v = Number(String(t).replace(',', '.'))
  return Number.isFinite(v) && v !== 0 ? v : null
}

/** Jeden blok <ZDARZENIE> → zdarzenie albo null, gdy rok poza zakresem lub brak GPS. */
export function zdarzenie(xml) {
  const sam = xml.replace(/<(UCZESTNIK|POJAZD)[\s>][\s\S]*?<\/\1>/gi, '')
  const p = pola(sam)
  const rok = Number((p.DATA_ZDARZ ?? p.DATA_ZDARZENIA ?? '').slice(0, 4))
  if (!(rok >= LATA[0] && rok <= LATA[1])) return null
  let lat = liczba(p.WSP_GPS_Y ?? p.GPS_Y ?? p.SZEROKOSC)
  let lon = liczba(p.WSP_GPS_X ?? p.GPS_X ?? p.DLUGOSC)
  if (lat !== null && lon !== null && lat < 30 && lon > 30) [lat, lon] = [lon, lat] // zamienione osie
  const ofiary = { zabity: 0, ciezko: 0, lekko: 0 }
  let pieszy = false
  let rower = false
  const rowerowy = (t) => /rower/i.test(t ?? '') || /^IS101$/i.test(t ?? '')
  for (const poj of bloki(xml, 'POJAZD')) {
    const pp = pola(poj.replace(/<UCZESTNIK[\s>][\s\S]*?<\/UCZESTNIK>/gi, ''))
    if (rowerowy(pp.RODZAJ_POJAZDU) || rowerowy(pp.SRPO_KOD)) rower = true
  }
  for (const u of bloki(xml, 'UCZESTNIK')) {
    const pu = pola(u)
    const stan = STAN[(pu.STUC_KOD ?? pu.SSRU_KOD ?? pu.STAN ?? '').toUpperCase()]
    if (stan) ofiary[stan]++
    const rodzaj = (pu.SRUZ_KOD ?? pu.RODZAJ_UCZESTNIKA ?? '').toUpperCase()
    if (rodzaj === 'P' || rodzaj === 'I' || rodzaj.startsWith('PIESZ')) pieszy = true
  }
  return {
    id: p.ID ?? null,
    rok,
    lat: lat !== null && lon !== null ? lat : null,
    lon: lat !== null && lon !== null ? lon : null,
    powiat: p.POWIAT ?? null,
    ulica: p.ULICA_ADRES ?? p.ULICA ?? null,
    ...ofiary,
    pieszyLubRower: pieszy || rower,
    waga:
      WAGI.zdarzenie +
      WAGI.zabity * ofiary.zabity +
      WAGI.ciezko * ofiary.ciezko +
      WAGI.lekko * ofiary.lekko,
  }
}

/** Strumieniowo: kawałki tekstu → zdarzenia (asynchroniczny generator). */
export async function* czytajZdarzenia(kawalki) {
  let bufor = ''
  for await (const k of kawalki) {
    bufor += k
    let koniec = bufor.lastIndexOf('</ZDARZENIE>')
    if (koniec < 0) continue
    koniec += '</ZDARZENIE>'.length
    for (const b of bloki(bufor.slice(0, koniec), 'ZDARZENIE')) {
      const z = zdarzenie(b)
      if (z) yield z
    }
    bufor = bufor.slice(koniec)
  }
}

/**
 * Sumuje wagi w heksach r8 obszaru (komórki, w których są adresy). Zdarzenia spoza obszaru i bez GPS
 * tylko liczymy. Wynik: średnia roczna waga na heks.
 */
export function agreguj(zdarzenia, obszar) {
  const lat = LATA[1] - LATA[0] + 1
  const wszystkie = new Map()
  const piesi = new Map()
  const stat = { razem: 0, bezGps: 0, pozaObszarem: 0, wObszarze: 0 }
  for (const z of zdarzenia) {
    stat.razem++
    if (z.lat === null) {
      stat.bezGps++
      continue
    }
    const h = latLngToCell(z.lat, z.lon, RES)
    if (!obszar.has(h)) {
      stat.pozaObszarem++
      continue
    }
    stat.wObszarze++
    wszystkie.set(h, (wszystkie.get(h) ?? 0) + z.waga)
    if (z.pieszyLubRower) piesi.set(h, (piesi.get(h) ?? 0) + z.waga)
  }
  const naRok = (m) => new Map([...m].map(([h, v]) => [h, v / lat]))
  return { wszystkie: naRok(wszystkie), piesi: naRok(piesi), stat }
}

async function* zPlikow(sciezka) {
  const pliki = statSync(sciezka).isDirectory()
    ? readdirSync(sciezka)
        .filter((f) => f.toLowerCase().endsWith('.xml'))
        .sort()
        .map((f) => join(sciezka, f))
    : [sciezka]
  for (const f of pliki) yield* createReadStream(f, { encoding: 'utf8', highWaterMark: 1 << 20 })
}

async function main() {
  const sciezka = process.argv[2]
  if (!sciezka) {
    console.error('Podaj ścieżkę do rozpakowanego zrzutu SEWIK XML (patrz etl/wypadki.md).')
    process.exitCode = 1
    return
  }
  const { adresy } = wczytajAdresy()
  const obszar = new Set(adresy.map((a) => cellToParent(a.h3, RES)))
  const lista = []
  for await (const z of czytajZdarzenia(zPlikow(sciezka))) lista.push(z)
  const { wszystkie, piesi, stat } = agreguj(lista, obszar)
  console.log('SEWIK:', stat)
  if (stat.wObszarze === 0)
    throw new Error('Żadne zdarzenie nie trafiło do obszaru – sprawdź pola GPS')
  const pobrano = dzis()
  const zrodla = [
    {
      nazwa:
        'System Ewidencji Wypadków i Kolizji (SEWIK), Komenda Główna Policji; zrzut sewik.pl; opracowanie i udostępnienie: Polskie Obserwatorium Bezpieczeństwa Ruchu Drogowego, Instytut Transportu Samochodowego (obserwatoriumbrd.pl)',
      url: 'https://sewik.pl',
      licencja: 'Dane publiczne KGP; wymagana atrybucja „Źródło: Polskie Obserwatorium BRD, ITS”',
      dataDanych: `${LATA[0]}–${LATA[1]}`,
      pobrano,
    },
  ]
  const wspolne = {
    jednostka: 'pkt wagi / rok',
    kategoria: 'bezpieczenstwo',
    kierunek: 'mniej-lepiej',
    rozdzielczosc: 'heks',
    zadanie: 69,
    zrodla,
  }
  const opisWagi = `Średnia roczna (${LATA[0]}–${LATA[1]}) suma wag zdarzeń w heksie H3 r8 (~0,7 km²): zdarzenie ${WAGI.zdarzenie}, każdy zabity +${WAGI.zabity}, ciężko ranny +${WAGI.ciezko}, lekko ranny +${WAGI.lekko}. Zdarzenia bez GPS pominięte (${stat.bezGps} z ${stat.razem}). Miejsce zdarzenia, nie adres zamieszkania ofiar.`
  zapiszWskaznik(
    {
      ...wspolne,
      id: 'wypadki_heks',
      nazwa: 'Wypadki i kolizje drogowe w okolicy',
      opis: opisWagi,
    },
    adresy.map((a) => wszystkie.get(cellToParent(a.h3, RES)) ?? 0),
  )
  zapiszWskaznik(
    {
      ...wspolne,
      id: 'wypadki_piesi_rowerzysci_heks',
      nazwa: 'Wypadki z pieszymi i rowerzystami w okolicy',
      opis: `Tylko zdarzenia z udziałem pieszego lub roweru. ${opisWagi}`,
    },
    adresy.map((a) => piesi.get(cellToParent(a.h3, RES)) ?? 0),
  )
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href)
  main().catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
