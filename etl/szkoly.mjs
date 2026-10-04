// Źródła: Mapa Egzaminów MEN/CIE (E8, wrzesień 2026), SIO/RSPO MEN (30.09.2025)
// oraz oficjalne punkty adresowe MSIP/PRG z public/dane/adresy.json.
// Licencje: SIO CC BY 4.0; mapa nie wskazuje odrębnej licencji w eksporcie;
// punkty adresowe według licencji zapisanej w adresy.json.
// Liczy średnią arytmetyczną wyników z polskiego, matematyki i angielskiego
// najbliższej szkoły z opublikowanymi trzema wynikami w promieniu 1,5 km.
// Uruchom: node etl/szkoly.mjs
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { strFromU8, unzipSync } from 'fflate'
import { MIASTO_INFO, WOJEWODZTWO } from './lib/miasto.mjs'
import { DANE, dzis, pobierzDoCache, wczytajAdresy, zapiszWskaznik } from './lib/wspolne.mjs'

/** Nazwa województwa w arkuszu E8 („Małopolskie", „Łódzkie"); bez ADRESCORE_MIASTO zostaje Małopolska. */
const WOJ_E8 = WOJEWODZTWO.charAt(0).toLocaleUpperCase('pl') + WOJEWODZTWO.slice(1)

const E8_URL =
  'https://mapa.wyniki.edu.pl/MapaEgzaminow/assets/data/CSV/E8/2026/E8_2026_szkoly_09.xlsx'
const SIO_URL =
  'https://api.dane.gov.pl/media/resources/20260216/Wykaz_szk%C3%B3%C5%82_i_plac%C3%B3wek_o%C5%9Bwiatowych_30.09.2025_.csv'
const xmlText = (s) =>
  s
    .replace(/<[^>]*>/g, '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')

function arkuszE8(path) {
  const zip = unzipSync(readFileSync(path))
  const shared = [
    ...strFromU8(zip['xl/sharedStrings.xml']).matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g),
  ].map((m) => xmlText(m[1]))
  const sheet = strFromU8(zip['xl/worksheets/sheet2.xml'])
  const out = new Map()
  for (const row of sheet.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells = {}
    for (const cell of row[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const col = cell[1].match(/\br="([A-Z]+)/)?.[1]
      if (!['B', 'G', 'I', 'J', 'N', 'S', 'X'].includes(col)) continue
      const raw = cell[2]?.match(/<v>([\s\S]*?)<\/v>/)?.[1]
      if (raw !== undefined) cells[col] = /\bt="s"/.test(cell[1]) ? shared[Number(raw)] : raw
    }
    if (cells.B !== WOJ_E8 || !cells.G) continue
    const wyniki = ['N', 'S', 'X'].map((k) => Number(cells[k]))
    if (
      wyniki.some((v) => !Number.isFinite(v) || v < 0 || v > 100) ||
      ['N', 'S', 'X'].some((k) => cells[k] === undefined || cells[k] === '')
    )
      continue
    out.set(String(cells.G), {
      nazwa: cells.J,
      wynik: wyniki.reduce((a, b) => a + b, 0) / 3,
      publiczna: cells.I,
    })
  }
  return out
}

function csvRows(csv) {
  const rows = []
  let row = [],
    value = '',
    quoted = false
  for (let i = 0; i < csv.length; i++) {
    const c = csv[i]
    if (c === '"') {
      if (quoted && csv[i + 1] === '"') {
        value += '"'
        i++
      } else quoted = !quoted
    } else if (c === ',' && !quoted) {
      row.push(value)
      value = ''
    } else if ((c === '\n' || c === '\r') && !quoted) {
      if (c === '\r' && csv[i + 1] === '\n') i++
      row.push(value)
      value = ''
      if (row.length > 1) rows.push(row)
      row = []
    } else value += c
  }
  if (row.length || value) {
    row.push(value)
    rows.push(row)
  }
  return rows
}

function norm(s) {
  return (s ?? '')
    .toLowerCase()
    .replaceAll('ł', 'l')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/^(?:(?:ul\.|ulica|os\.|osiedle|al\.|aleja|pl\.|plac)\s+)+/i, '')
    .replace(/[^a-z0-9]/g, '')
}
function miejscowosc(s) {
  return norm(
    (s ?? '').replace(/^Kraków-.+$/, 'Kraków').replace(
      MIASTO_INFO ? new RegExp(`^${MIASTO_INFO.nazwa}[-,].*$`) : /^$^/,
      MIASTO_INFO?.nazwa ?? '',
    ),
  )
}
function klucz(miasto, ulica, nr) {
  return `${miejscowosc(miasto)}|${norm(ulica)}|${norm(nr)}`
}

const start = performance.now()
const zrodlaAdresow = JSON.parse(readFileSync(join(DANE, 'adresy.json'), 'utf8')).zrodla
const [{ adresy, wersja }, plikE8, plikSIO] = await Promise.all([
  Promise.resolve(wczytajAdresy()),
  pobierzDoCache(E8_URL, 'e8-2026.xlsx'),
  pobierzDoCache(SIO_URL, 'sio-2025.csv'),
])
const wyniki = arkuszE8(plikE8)
if (wyniki.size < 1000) throw new Error('Eksport E8 ma za mało szkół; sprawdź układ arkusza')
const indeksAdresow = new Map()
for (const a of adresy) {
  const k = klucz(a.miejscowosc, a.ulica, a.nr)
  // Raz wykryta niejednoznaczność adresu musi pozostać niejednoznacznością.
  if (indeksAdresow.has(k) && indeksAdresow.get(k) === null) continue
  const old = indeksAdresow.get(k)
  if (!old) indeksAdresow.set(k, a)
  else if (Math.abs(old.lon - a.lon) + Math.abs(old.lat - a.lat) > 0.002) indeksAdresow.set(k, null)
}
const rows = csvRows(readFileSync(plikSIO, 'utf8'))
const head = new Map(rows.shift().map((v, i) => [v, i]))
const field = (r, k) => r[head.get(k)] ?? ''
const gminy = new Set(adresy.map((a) => a.teryt))
const szkoly = []
const brakLokalizacji = []
for (const r of rows) {
  const rspo = field(r, 'RSPO')
  const wynik = wyniki.get(rspo)
  if (
    !wynik ||
    !gminy.has(field(r, 'idTerytGmina')) ||
    field(r, 'Typ podmiotu') !== 'Szkoła podstawowa'
  )
    continue
  const a = indeksAdresow.get(
    klucz(field(r, 'Miejscowość'), field(r, 'Ulica'), field(r, 'Numer domu')),
  )
  if (!a) {
    brakLokalizacji.push(rspo)
    continue
  }
  szkoly.push({ ...wynik, rspo, lon: a.lon, lat: a.lat })
}
if (!szkoly.length) throw new Error('Brak szkół z wiarygodną lokalizacją')

// Siatka ogranicza kandydatów do 9 sąsiednich pól; dystans liczymy po kuli.
const BOK = 0.015
const pole = (lon, lat) => `${Math.floor(lon / BOK)}|${Math.floor(lat / BOK)}`
const grid = new Map()
for (const s of szkoly) {
  const k = pole(s.lon, s.lat)
  if (!grid.has(k)) grid.set(k, [])
  grid.get(k).push(s)
}
function metry(a, b) {
  const rad = Math.PI / 180
  const dlat = (b.lat - a.lat) * rad,
    dlon = (b.lon - a.lon) * rad
  const h =
    Math.sin(dlat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dlon / 2) ** 2
  return 12742000 * Math.asin(Math.sqrt(h))
}
const wartosci = [],
  najblizsza = [],
  odleglosciM = []
const indeksSzkol = new Map(szkoly.map((s, i) => [s.rspo, i]))
for (const a of adresy) {
  const x = Math.floor(a.lon / BOK),
    y = Math.floor(a.lat / BOK)
  let nearest = null,
    distance = 1500
  for (let dx = -2; dx <= 2; dx++)
    for (let dy = -1; dy <= 1; dy++) {
      for (const s of grid.get(`${x + dx}|${y + dy}`) ?? []) {
        const d = metry(a, s)
        if (d < distance) {
          distance = d
          nearest = s
        }
      }
    }
  wartosci.push(nearest?.wynik ?? null)
  najblizsza.push(nearest ? indeksSzkol.get(nearest.rspo) : null)
  odleglosciM.push(nearest ? Math.round(distance) : null)
}
// Pełne etykiety dla 176 tys. adresów przekroczyłyby limit 2 MB pliku wskaźnika.
// Zachowujemy nazwę szkoły i odległość w osobnym, wersjonowanym pliku szczegółów.
const szczegoly = {
  wersjaAdresow: wersja,
  szkoly: szkoly.map((s) => ({
    rspo: s.rspo,
    nazwa: s.nazwa,
    wynik: Math.round(s.wynik * 100) / 100,
  })),
  najblizsza,
  odleglosciM,
}
writeFileSync(join(DANE, 'szkoly_e8_szczegoly.json'), JSON.stringify(szczegoly))
console.log(
  `E8: ${wyniki.size} wyników w Małopolsce, ${szkoly.length} szkół z adresem, ${brakLokalizacji.length} bez dokładnego dopasowania.`,
)
zapiszWskaznik(
  {
    id: 'szkola_podst_wynik_e8',
    nazwa: 'Wynik E8 najbliższej szkoły z danymi',
    opis: 'Średnia arytmetyczna szkolnych średnich z języka polskiego, matematyki i języka angielskiego w 2026 r. dla najbliższej szkoły z opublikowanymi trzema wynikami w promieniu 1,5 km w linii prostej. Średnie są publikowane przy co najmniej 5 zdających z danego przedmiotu. Uwzględniono szkoły publiczne i niepubliczne, których RSPO i adres połączono z oficjalnym punktem adresowym. To nie musi być najbliższa szkoła w ogóle ani szkoła obwodowa; adres nie potwierdza możliwości zapisania dziecka. Brak wyniku oznacza brak danych w tym promieniu, nie słaby wynik szkoły. Wynik zależy m.in. od składu uczniów i nie jest bezpośrednią miarą jakości nauczania.',
    jednostka: '%',
    kategoria: 'kontekst',
    rozdzielczosc: 'adres',
    kierunek: 'neutralny',
    zakres: [0, 100],
    zadanie: 39,
    zrodla: [
      {
        nazwa: 'MEN/CIE, Mapa Egzaminów, E8 2026 – szkoły (wrzesień)',
        url: E8_URL,
        licencja: 'Brak odrębnej licencji podanej przy eksporcie; dane urzędowe MEN/CIE',
        dataDanych: '2026-09-16',
        pobrano: dzis(),
      },
      {
        nazwa: 'MEN, wykaz szkół SIO/RSPO na 30.09.2025',
        url: 'https://dane.gov.pl/pl/dataset/839,wykaz-szko-i-placowek-oswiatowych/resource/1254769',
        licencja: 'CC BY 4.0',
        dataDanych: '2025-09-30',
        pobrano: dzis(),
      },
      ...zrodlaAdresow,
    ],
  },
  wartosci,
)
console.log(`Czas: ${((performance.now() - start) / 1000).toFixed(1)} s`)
