// Wypadki i kolizje drogowe z SEWIK (Policja) 2018–2024 → dwie warstwy heksowe H3 r8 (#69).
// Uruchom: node etl/wypadki.mjs <zrzut SEWIK: plik .xml, katalog z plikami .xml (także w podkatalogach) albo stdin>
// Zrzut: https://sewik.pl (XML, jeden plik na województwo i rok). Surowe pliki trzymaj w etl/.cache/sewik/
// (poza gitem). Schemat pól i wyniki kontroli: etl/wypadki.md.
// Parser jest strumieniowy: plik czytamy kawałkami i wycinamy kolejne bloki <ZDARZENIE>…</ZDARZENIE>, więc
// pamięć nie zależy od rozmiaru zrzutu.
import { createReadStream, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { cellToParent, latLngToCell } from 'h3-js'
import { dzis, wczytajAdresy, zapiszWskaznik } from './lib/wspolne.mjs'

export const RES = 8
export const LATA = [2018, 2024]
export const LICZBA_LAT = LATA[1] - LATA[0] + 1
/**
 * Waga zdarzenia: samo zdarzenie 1 (kolizja bez ofiar też coś znaczy) plus ofiary. Zabity (na miejscu albo
 * w ciągu 30 dni) waży najwięcej, ciężko ranny 4, lekko ranny 1.
 */
export const WAGI = { zdarzenie: 1, zabity: 10, ciezko: 4, lekko: 1 }
/** Stan uczestnika (STUC_KOD): ZM zabity na miejscu, ZC zmarł w ciągu 30 dni, RC ranny ciężko, RL lekko. */
export const STAN = { ZM: 'zabity', ZC: 'zabity', RC: 'ciezko', RL: 'lekko' }
/**
 * Rower: RODZAJ_POJAZDU IS101 (do 2021 r., częściowo 2022) i IS201 (od 2022 r.). Kody wywnioskowane z danych,
 * bo zrzut nie ma słownika: pojazd bez ubezpieczyciela, badań technicznych i roku produkcji, ok. 38%
 * poszkodowanych kierujących. Hulajnogi elektryczne (IS240, kod od 2022 r.) świadomie poza warstwą – szereg
 * 2018–2024 byłby niespójny.
 */
export const KODY_ROWERU = new Set(['IS101', 'IS201'])
/** Pieszy: uczestnik bez pojazdu o rodzaju SSRU_KOD = I (K kierujący, P pasażer; O od 2022 r. pomijamy). */
export const KOD_PIESZEGO = 'I'
/** Punkt zdarzenia dalej niż tyle od punktu GUS jego miejscowości to błąd współrzędnych (literówka). */
export const MAKS_KM_OD_GUS = 25
/** Obwiednia województwa małopolskiego z zapasem: punkt spoza niej to literówka (także bez punktu GUS). */
const OBWIEDNIA = { lonMin: 18.5, lonMax: 21.5, latMin: 49.0, latMax: 50.7 }

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

// ── Współrzędne ──────────────────────────────────────────────────────────────────────────

// SEWIK zapisuje WSP_GPS_X (długość) i WSP_GPS_Y (szerokość) napisem „DD*MM'SSs”: stopnie, minuty, sekundy
// i dziesiąte części sekundy (19*57'313 = 19°57'31,3" = 19,95869°). Sprawdzone na drogach OSM (Małopolska,
// 2018–2024): tak odczytane punkty leżą (mediana) 2 m od osi najbliższej drogi, odczyt „minuty
// z tysięcznymi” (19°57,313') 38 m; sewik.pl w swoim zrzucie SQL liczy tak samo, ale bez sprawdzania zakresów.
// Część jednostek wpisywała stopnie dziesiętne w tym samym kształcie (19*80'205 = 19,80205°) – wtedy „minuty”
// albo „sekundy” przekraczają 59 i odczyt DMS odpada. Od 2020 r. zdarzają się też zwykłe liczby dziesiętne
// (19.9565).
const GWIAZDKA = /^(\d{1,3})\*(\d{1,2})'(\d{2,3})$/
const DZIESIETNA = /^\d{1,3}[.,]\d+$/

/**
 * Dwa możliwe odczyty jednej współrzędnej: { dms, dec } (null = odczyt niemożliwy). „DD*MM'SSs” ma oba, o ile
 * minuty i sekundy < 60; zwykła liczba dziesiętna tylko dec; reszta (literówki typu „50*2''332”) żadnego.
 */
export function odczyty(tekst) {
  const t = (tekst ?? '').trim()
  const g = GWIAZDKA.exec(t)
  if (g) {
    const minuty = Number(g[2])
    const sekundy = g[3].length === 3 ? Number(`${g[3].slice(0, 2)}.${g[3][2]}`) : Number(g[3])
    return {
      dms: minuty < 60 && sekundy < 60 ? Number(g[1]) + minuty / 60 + sekundy / 3600 : null,
      dec: Number(`${g[1]}.${g[2].padStart(2, '0')}${g[3]}`),
    }
  }
  return { dms: null, dec: DZIESIETNA.test(t) ? Number(t.replace(',', '.')) : null }
}

/** Odległość w km (haversine). */
export function odlegloscKm(lat1, lon1, lat2, lon2) {
  const rad = Math.PI / 180
  const a =
    Math.sin(((lat2 - lat1) * rad) / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lon2 - lon1) * rad) / 2) ** 2
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(a)))
}

const wObwiedni = (lat, lon) =>
  lon >= OBWIEDNIA.lonMin &&
  lon <= OBWIEDNIA.lonMax &&
  lat >= OBWIEDNIA.latMin &&
  lat <= OBWIEDNIA.latMax

/**
 * Z napisów WSP_GPS_X/Y wybiera punkt zdarzenia: odczyt DMS (obie osie), a gdy odpada – stopnie dziesiętne
 * (obie osie). Punkt GUS miejscowości (GPS_X_GUS/GPS_Y_GUS) służy tylko do odrzucania literówek: punkt dalszy
 * niż MAKS_KM_OD_GUS od miejscowości nie jest używany, a odczyt dziesiętny zastępuje DMS tylko wtedy, gdy DMS
 * leży poza tym promieniem. Nie wybieramy odczytu „bliższego punktowi GUS”: dla Krakowa to środek miasta
 * (±13 km), a na drogach OSM DMS trafia w 99,8% przypadków rozstrzygalnych (etl/wypadki.md). Bez punktu GUS
 * punkt musi leżeć w obwiedni województwa. Zwraca { lat, lon, tryb: 'DMS' | 'dziesietne' } albo null.
 */
export function ustalPunkt(x, y, gus = null) {
  const ox = odczyty(x)
  const oy = odczyty(y)
  const kandydat = (lon, lat, tryb) =>
    lon !== null && lat !== null && wObwiedni(lat, lon) ? { lat, lon, tryb } : null
  const kandydaci = [kandydat(ox.dms, oy.dms, 'DMS'), kandydat(ox.dec, oy.dec, 'dziesietne')]
  const blisko = (k) => k && (!gus || odlegloscKm(k.lat, k.lon, gus.lat, gus.lon) <= MAKS_KM_OD_GUS)
  return kandydaci.find(blisko) ?? null
}

/** Punkt GUS z pól zdarzenia („19,985…”, przecinek dziesiętny) albo null. */
function punktGus(p) {
  const lon = Number((p.GPS_X_GUS ?? '').replace(',', '.'))
  const lat = Number((p.GPS_Y_GUS ?? '').replace(',', '.'))
  return p.GPS_X_GUS && p.GPS_Y_GUS && Number.isFinite(lon) && Number.isFinite(lat) && lon && lat
    ? { lat, lon }
    : null
}

// ── Zdarzenie ────────────────────────────────────────────────────────────────────────────

/** Waga ofiar: { zabity, ciezko, lekko } → liczba (z wagą samego zdarzenia). */
export const wagaZdarzenia = (o) =>
  WAGI.zdarzenie + WAGI.zabity * o.zabity + WAGI.ciezko * o.ciezko + WAGI.lekko * o.lekko

const puste = () => ({ zabity: 0, ciezko: 0, lekko: 0 })

/**
 * Jeden blok <ZDARZENIE> → zdarzenie. `lat`/`lon` = null, gdy brak użytecznych współrzędnych. `ofiary` to
 * wszyscy poszkodowani, `ofiaryNiechronieni` tylko piesi i rowerzyści (pasażer roweru też); `niechronieni` mówi,
 * czy w zdarzeniu brał udział pieszy albo rower.
 */
export function zdarzenie(xml) {
  const sam = xml.replace(/<(POJAZDY|UCZESTNICY)>[\s\S]*?<\/\1>/gi, '')
  const p = pola(sam)
  const rok = Number((p.DATA_ZDARZ ?? p.DATA_ZDARZENIA ?? '').slice(0, 4))
  const punkt = ustalPunkt(p.WSP_GPS_X, p.WSP_GPS_Y, punktGus(p))
  const rowery = new Set()
  let rower = false
  for (const poj of bloki(xml, 'POJAZD')) {
    const pp = pola(poj)
    if (KODY_ROWERU.has((pp.RODZAJ_POJAZDU ?? '').toUpperCase())) {
      rower = true
      if (pp.ID) rowery.add(pp.ID)
    }
  }
  const ofiary = puste()
  const ofiaryNiechronieni = puste()
  let pieszy = false
  for (const o of bloki(xml, 'OSOBA')) {
    const po = pola(o)
    const niechroniony = po.SSRU_KOD === KOD_PIESZEGO || (po.ZSPO_ID && rowery.has(po.ZSPO_ID))
    if (po.SSRU_KOD === KOD_PIESZEGO) pieszy = true
    const stan = STAN[(po.STUC_KOD ?? '').toUpperCase()]
    if (stan) {
      ofiary[stan]++
      if (niechroniony) ofiaryNiechronieni[stan]++
    }
  }
  const niechronieni = pieszy || rower
  return {
    id: p.ID ?? null,
    rok,
    lat: punkt?.lat ?? null,
    lon: punkt?.lon ?? null,
    tryb: punkt?.tryb ?? null,
    powiat: p.POWIAT ?? null,
    gmina: p.GMINA ?? null,
    teryt: p.KOD_GUS ?? null,
    miejscowosc: p.MIEJSCOWOSC ?? null,
    ulica: p.ULICA_ADRES ?? null,
    pieszy,
    rower,
    niechronieni,
    ofiary,
    ofiaryNiechronieni,
    waga: wagaZdarzenia(ofiary),
    wagaNiechronieni: niechronieni ? wagaZdarzenia(ofiaryNiechronieni) : 0,
  }
}

/** Strumieniowo: kawałki tekstu → zdarzenia z lat LATA (asynchroniczny generator). */
export async function* czytajZdarzenia(kawalki) {
  let bufor = ''
  for await (const k of kawalki) {
    bufor += k
    let koniec = bufor.lastIndexOf('</ZDARZENIE>')
    if (koniec < 0) continue
    koniec += '</ZDARZENIE>'.length
    for (const b of bloki(bufor.slice(0, koniec), 'ZDARZENIE')) {
      const z = zdarzenie(b)
      if (z.rok >= LATA[0] && z.rok <= LATA[1]) yield z
    }
    bufor = bufor.slice(koniec)
  }
}

// ── Agregacja do heksów ──────────────────────────────────────────────────────────────────

const pustaKomorka = () => ({ zdarzenia: 0, zabity: 0, ciezko: 0, lekko: 0, waga: 0 })

/**
 * Sumuje zdarzenia w heksach r8 obszaru (komórki, w których są adresy). Zdarzenia spoza obszaru i bez punktu
 * tylko liczymy. Wynik: dwie mapy heks → { zdarzenia, zabity, ciezko, lekko, waga } z sumami za całe LATA.
 * Zdarzenia z tym samym `id` liczymy raz (plik poprawiony i oryginalny obok siebie). `gminy` to 6-cyfrowe
 * prefiksy TERYT gmin obszaru: według nich (KOD_GUS zdarzenia) liczymy, ile zdarzeń z tych gmin nie ma punktu.
 */
export function agreguj(zdarzenia, obszar, gminy = new Set()) {
  const wszystkie = new Map()
  const niechronieni = new Map()
  const widziane = new Set()
  const stat = {
    razem: 0,
    duplikaty: 0,
    bezPunktu: 0,
    pozaObszarem: 0,
    wObszarze: 0,
    wObszarzeNiechronieni: 0,
    wGminach: 0,
    bezPunktuWGminach: 0,
    wgRoku: {},
    tryby: { DMS: 0, dziesietne: 0 },
  }
  const dodaj = (mapa, h, o, waga) => {
    const k = mapa.get(h) ?? pustaKomorka()
    k.zdarzenia++
    k.zabity += o.zabity
    k.ciezko += o.ciezko
    k.lekko += o.lekko
    k.waga += waga
    mapa.set(h, k)
  }
  for (const z of zdarzenia) {
    if (z.id !== null) {
      if (widziane.has(z.id)) {
        stat.duplikaty++
        continue
      }
      widziane.add(z.id)
    }
    stat.razem++
    const wGminie = Boolean(z.teryt) && gminy.has(z.teryt.slice(0, 6))
    if (wGminie) stat.wGminach++
    if (z.lat === null) {
      stat.bezPunktu++
      if (wGminie) stat.bezPunktuWGminach++
      continue
    }
    const h = latLngToCell(z.lat, z.lon, RES)
    if (!obszar.has(h)) {
      stat.pozaObszarem++
      continue
    }
    stat.wObszarze++
    stat.wgRoku[z.rok] = (stat.wgRoku[z.rok] ?? 0) + 1
    stat.tryby[z.tryb] = (stat.tryby[z.tryb] ?? 0) + 1
    dodaj(wszystkie, h, z.ofiary, z.waga)
    if (z.niechronieni) {
      stat.wObszarzeNiechronieni++
      dodaj(niechronieni, h, z.ofiaryNiechronieni, z.wagaNiechronieni)
    }
  }
  return { wszystkie, niechronieni, stat }
}

// ── Etykiety i warstwy ───────────────────────────────────────────────────────────────────

/** Polska liczba mnoga: 1 zdarzenie, 2–4 zdarzenia (poza 12–14), reszta zdarzeń. */
export function odmiana(n, jeden, kilka, wiele) {
  if (n === 1) return jeden
  const reszta10 = n % 10
  const reszta100 = n % 100
  return reszta10 >= 2 && reszta10 <= 4 && !(reszta100 >= 12 && reszta100 <= 14) ? kilka : wiele
}

/** Etykieta heksu na karcie adresu. `k` = komórka z agreguj() albo undefined (brak zdarzeń). */
export function etykietaHeksu(k, rodzaj) {
  const lata = `${LATA[0]}–${LATA[1]}`
  const kto = rodzaj === 'niechronieni' ? ' z pieszymi lub rowerzystami' : ''
  if (!k || k.zdarzenia === 0) return `brak zdarzeń${kto} w latach ${lata}`
  const niechronieni = rodzaj === 'niechronieni'
  const liczby = `zabici: ${k.zabity}, ciężko ranni: ${k.ciezko}, lekko ranni: ${k.lekko}`
  const ofiary =
    k.zabity + k.ciezko + k.lekko === 0
      ? niechronieni
        ? 'bez poszkodowanych pieszych i rowerzystów'
        : 'bez ofiar'
      : niechronieni
        ? `poszkodowani piesi i rowerzyści – ${liczby}`
        : liczby
  return `${k.zdarzenia} ${odmiana(k.zdarzenia, 'zdarzenie', 'zdarzenia', 'zdarzeń')}${kto} w latach ${lata} (${ofiary})`
}

/**
 * Wartości i etykiety dla adresów jednej warstwy: średnia roczna waga heksu r8 adresu, etykieta ze słownika
 * (klucz = numer heksu w obszarze). Heks bez zdarzeń ma 0 – SEWIK obejmuje cały kraj, więc to pomiar,
 * nie brak danych; zdarzeń bez użytecznego punktu jest mniej niż 1% (etl/wypadki.md).
 */
export function warstwaAdresow(adresy, komorki, rodzaj) {
  const wartosci = []
  const etykiety = []
  const slownikEtykiet = {}
  const klucze = new Map()
  for (const a of adresy) {
    const h = cellToParent(a.h3, RES)
    const k = komorki.get(h)
    wartosci.push((k?.waga ?? 0) / LICZBA_LAT)
    if (!klucze.has(h)) {
      const klucz = klucze.size.toString(36)
      klucze.set(h, klucz)
      slownikEtykiet[klucz] = etykietaHeksu(k, rodzaj)
    }
    etykiety.push(klucze.get(h))
  }
  return { wartosci, etykiety, slownikEtykiet }
}

// ── Wejście ──────────────────────────────────────────────────────────────────────────────

function pliki(sciezka) {
  if (!statSync(sciezka).isDirectory()) return [sciezka]
  return readdirSync(sciezka, { recursive: true })
    .filter((f) => f.toLowerCase().endsWith('.xml'))
    .sort()
    .map((f) => join(sciezka, f))
}

async function* zPlikow(sciezka) {
  if (sciezka === '-' || sciezka === 'stdin') {
    process.stdin.setEncoding('utf8')
    yield* process.stdin
    return
  }
  for (const f of pliki(sciezka))
    yield* createReadStream(f, { encoding: 'utf8', highWaterMark: 1 << 20 })
}

export const zrodla = (pobrano) => [
  {
    nazwa:
      'System Ewidencji Wypadków i Kolizji (SEWIK), Komenda Główna Policji – zrzut bazy XML 2018–2024 udostępniony na sewik.pl',
    url: 'https://sewik.pl',
    licencja:
      'Dane z policyjnej bazy SEWIK. Serwis sewik.pl (niekomercyjny, tworzony przez wolontariuszy) udostępnia zrzut do pobrania bez rejestracji, nie podaje jego licencji, a w sprawie użycia komercyjnego odsyła do kontaktu mailowego. Projekt konkursowy to użycie niekomercyjne; przed komercyjnym trzeba uzyskać zgodę',
    dataDanych: `${LATA[0]}–${LATA[1]}`,
    pobrano,
  },
  {
    nazwa:
      'Instytut Transportu Samochodowego – Polskie Obserwatorium Bezpieczeństwa Ruchu Drogowego (obserwatoriumbrd.pl)',
    url: 'https://obserwatoriumbrd.pl/mapa-wypadkow/',
    licencja:
      'Atrybucja zachowawcza: regulamin Obserwatorium wymaga podania źródła „Instytut Transportu Samochodowego – Polskie Obserwatorium Bezpieczeństwa Ruchu Drogowego” (art. 6), pozwala na użycie niekomercyjne bez zgody, a komercyjne za zgodą administratora mapy (art. 7). adresscore liczy z surowego zrzutu SEWIK, nie z mapy Obserwatorium https://obserwatoriumbrd.pl/mapa-wypadkow/regulamin/',
    dataDanych: `${LATA[0]}–${LATA[1]}`,
    pobrano,
  },
]

const spacje = (n) => n.toLocaleString('pl-PL')
const procent = (czesc, calosc) => `${((100 * czesc) / calosc).toFixed(1).replace('.', ',')}%`

/** Opis warstwy na karcie adresu (pole „przetworzenie przez adresscore”). */
export function opisWarstwy(rodzaj, stat) {
  const wagi = `zdarzenie ${WAGI.zdarzenie} pkt, zabity +${WAGI.zabity} (także zmarły w ciągu 30 dni), ciężko ranny +${WAGI.ciezko}, lekko ranny +${WAGI.lekko}`
  const bezPunktu =
    stat.wGminach > 0
      ? `W gminach obszaru ${spacje(stat.bezPunktuWGminach)} z ${spacje(stat.wGminach)} zdarzeń (${procent(stat.bezPunktuWGminach, stat.wGminach)}) nie miało użytecznych współrzędnych i nie weszło do warstwy.`
      : `${spacje(stat.bezPunktu)} z ${spacje(stat.razem)} zdarzeń nie miało użytecznych współrzędnych i nie weszło do warstwy.`
  const kto =
    rodzaj === 'niechronieni'
      ? 'Tylko zdarzenia z udziałem pieszego albo rowerzysty (bez hulajnóg elektrycznych); wagę liczą wyłącznie poszkodowani piesi i rowerzyści.'
      : 'Wypadki z ofiarami i kolizje bez ofiar; wagę liczą wszyscy poszkodowani.'
  return `${kto} Średnia roczna waga zdarzeń z lat ${LATA[0]}–${LATA[1]} w heksie o powierzchni ok. 0,74 km² wokół adresu: ${wagi}. To miejsce zdarzenia, nie zamieszkania poszkodowanych; liczby zgłoszone Policji, bez przeliczenia na natężenie ruchu. ${bezPunktu} Zero oznacza brak zdarzeń z punktem w heksie.`
}

async function main() {
  const sciezka = process.argv[2]
  if (!sciezka) {
    console.error(
      'Podaj ścieżkę do zrzutu SEWIK XML (plik, katalog albo stdin; patrz etl/wypadki.md).',
    )
    process.exitCode = 1
    return
  }
  const { adresy } = wczytajAdresy()
  const obszar = new Set(adresy.map((a) => cellToParent(a.h3, RES)))
  const gminy = new Set(adresy.map((a) => a.teryt.slice(0, 6)))
  const lista = []
  for await (const z of czytajZdarzenia(zPlikow(sciezka))) lista.push(z)
  const { wszystkie, niechronieni, stat } = agreguj(lista, obszar, gminy)
  console.log('SEWIK:', JSON.stringify(stat))
  if (stat.wObszarze === 0)
    throw new Error('Żadne zdarzenie nie trafiło do obszaru – sprawdź pola GPS')
  const pobrano = dzis()
  const wspolne = {
    jednostka: 'pkt ciężkości / rok',
    kategoria: 'bezpieczenstwo',
    kierunek: 'mniej-lepiej',
    rozdzielczosc: 'heks',
    rozmiar: 'H3 r8 (średnia powierzchnia ~0,74 km²)',
    zadanie: 69,
    zrodla: zrodla(pobrano),
  }
  const w = warstwaAdresow(adresy, wszystkie, 'wszystkie')
  zapiszWskaznik(
    {
      ...wspolne,
      id: 'wypadki_heks',
      nazwa: 'Wypadki i kolizje drogowe w okolicy',
      opis: opisWarstwy('wszystkie', stat),
    },
    w.wartosci,
    w.etykiety,
    w.slownikEtykiet,
  )
  const n = warstwaAdresow(adresy, niechronieni, 'niechronieni')
  zapiszWskaznik(
    {
      ...wspolne,
      id: 'wypadki_piesi_rowerzysci_heks',
      nazwa: 'Wypadki z pieszymi i rowerzystami w okolicy',
      opis: opisWarstwy('niechronieni', stat),
    },
    n.wartosci,
    n.etykiety,
    n.slownikEtykiet,
  )
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href)
  main().catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
