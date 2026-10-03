// Źródła: z-dykty.pl MCP (pośrednik danych BZP; informacja publiczna, wymagane wskazanie pośrednika),
// e-Zamówienia API BZP (Urząd Zamówień Publicznych; informacja publiczna), adresy MSIP/PRG.
// Liczy ogłoszenia o wyniku zamówień miejskich z ostatnich 24 miesięcy, których kwotę i dzielnicę
// da się potwierdzić. Uruchomienie: node etl/przetargi.mjs. Surowe strony trafiają do etl/.cache/.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { CACHE, dzis, wczytajAdresy, zapiszWskaznik } from './lib/wspolne.mjs'

const TERYT = '1261011'
const MCP = 'https://z-dykty.pl/api/mcp'
const BZP = 'https://ezamowienia.gov.pl/mo-board/api/v1/notice'
const katalog = join(CACHE, 'przetargi')
mkdirSync(katalog, { recursive: true })

const dzien = dzis()
const poczatek = new Date(`${dzien}T00:00:00Z`)
poczatek.setUTCMonth(poczatek.getUTCMonth() - 24)
const od = poczatek.toISOString().slice(0, 10)
const klucz = `${od}_${dzien}`
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const normalizuj = (s) =>
  (s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')

async function jsonZSieci(url, opcje) {
  for (let proba = 0; proba < 5; proba++) {
    const r = await fetch(url, { ...opcje, signal: AbortSignal.timeout(30000) })
    if (r.status === 403 || r.status === 429 || r.status >= 500) {
      await sleep(Number(r.headers.get('retry-after') || 2 ** proba) * 1000)
      continue
    }
    if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`)
    return r.json()
  }
  throw new Error(`${url}: limit lub błąd serwera po pięciu próbach`)
}

async function listaZDyKty() {
  const gotowe = join(katalog, `mcp_${klucz}_gotowe.json`)
  if (existsSync(gotowe)) return JSON.parse(readFileSync(gotowe, 'utf8'))
  const wszystkie = []
  let kursor = null
  let strona = 0
  for (;;) {
    const sciezka = join(katalog, `mcp_${klucz}_${String(strona).padStart(4, '0')}.json`)
    let wynik
    if (existsSync(sciezka)) wynik = JSON.parse(readFileSync(sciezka, 'utf8'))
    else {
      const args = { gmina: TERYT, typ: 'wynik', od, do: dzien, limit: 50 }
      if (kursor) args.kursor = kursor
      const odpowiedz = await jsonZSieci(MCP, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'przetargi', arguments: args },
        }),
      })
      wynik = odpowiedz.result?.structuredContent
      if (odpowiedz.result?.isError || !Array.isArray(wynik?.dane))
        throw new Error(
          `MCP przetargi: ${odpowiedz.result?.content?.[0]?.text || 'niepełna odpowiedź'}`,
        )
      writeFileSync(sciezka, JSON.stringify(wynik))
      await sleep(1100) // publiczny MCP: 60 wywołań na minutę
    }
    wszystkie.push(...wynik.dane)
    kursor = wynik.kursor
    strona++
    if (!kursor) break
    if (strona > 1000) throw new Error('MCP: ponad 1000 stron; przerwano dla bezpieczeństwa')
  }
  writeFileSync(gotowe, JSON.stringify(wszystkie))
  return wszystkie
}

// Tylko jednostki miejskie. Sam fakt, że zamawiający ma adres w Krakowie, nie wystarcza.
const miejski =
  /gmina miejska krakow|urzad miasta krakowa|zarzad (drog miasta krakowa|zieleni miejskiej|inwestycji miejskich|budynkow komunalnych|transportu publicznego|cmentarzy komunalnych)|miejskie (przedsiebiorstwo|centrum|osrodek|jednostka|zaklad)|krakowski holding komunalny/i

function indeksUlic(adresy) {
  const ulice = new Map()
  for (const a of adresy) {
    if (!a.dzielnica || a.gmina !== 'Kraków' || !a.ulica) continue
    const nazwa = normalizuj(a.ulica)
    if (nazwa.length < 5) continue
    if (!ulice.has(nazwa)) ulice.set(nazwa, new Set())
    ulice.get(nazwa).add(a.dzielnica)
  }
  const indeks = new Map()
  for (const [ulica, dzielnice] of ulice) {
    if (dzielnice.size !== 1) continue // ulica przechodzi przez więcej niż jedną dzielnicę
    const slowo = ulica.split(' ').at(-1)
    if (!indeks.has(slowo)) indeks.set(slowo, [])
    indeks.get(slowo).push([ulica, [...dzielnice][0]])
  }
  return indeks
}

function dzielnicaOpisu(rekord, indeks) {
  const opis = ` ${normalizuj(`${rekord.tytul || ''} ${rekord.przedmiot || ''}`)} `
  const trafienia = new Set()
  for (const slowo of new Set(opis.trim().split(' '))) {
    for (const [ulica, dzielnica] of indeks.get(slowo) || []) {
      // Pojedyncza nazwa potrzebuje oznaczenia ulicy; dłuższa nazwa ma własny kontekst.
      const wzorzec = ulica.includes(' ') ? ` ${ulica} ` : ` ul ${ulica} `
      if (opis.includes(wzorzec) || opis.includes(` ulica ${ulica} `)) trafienia.add(dzielnica)
    }
  }
  return trafienia.size === 1 ? [...trafienia][0] : null
}

function kwotyZHtml(html) {
  const tekst = (html || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/\s+/g, ' ')
  const kwoty = [...tekst.matchAll(/Wartość umowy\s*\/\s*umowy ramowej\s*:\s*([\d\s.,]+)\s*PLN/gi)]
    .map((m) => Number(m[1].replace(/\s/g, '').replace(/\./g, '').replace(',', '.')))
    .filter((n) => Number.isFinite(n) && n >= 0)
  return kwoty.length ? kwoty.reduce((a, b) => a + b, 0) : null
}

async function kwotaBZP(rekord) {
  const numer = rekord.id?.match(/\d{4}\/BZP\s*\d+/)?.[0]
  if (!numer) return null // unijne ogłoszenia TED nie są w krajowym API BZP
  const sciezka = join(katalog, `bzp_${numer.replace(/\W+/g, '_')}.json`)
  if (existsSync(sciezka)) return JSON.parse(readFileSync(sciezka, 'utf8')).kwota
  const url = new URL(BZP)
  for (const [k, v] of Object.entries({
    NoticeType: 'TenderResultNotice',
    NoticeNumber: numer,
    PublicationDateFrom: `${rekord.data_publikacji}T00:00:00`,
    PublicationDateTo: `${rekord.data_publikacji}T23:59:59`,
    PageSize: '20',
  }))
    url.searchParams.set(k, v)
  const dane = await jsonZSieci(url)
  await sleep(1000)
  if (!Array.isArray(dane)) throw new Error(`BZP ${numer}: nieprawidłowa odpowiedź`)
  const ogloszenia = dane.filter(
    (x) =>
      x.bzpNumber === numer && normalizuj(x.organizationName) === normalizuj(rekord.zamawiajacy),
  )
  const kwoty = ogloszenia.map((x) => kwotyZHtml(x.htmlBody)).filter((n) => n !== null)
  const kwota = kwoty.length ? kwoty.at(-1) : null
  writeFileSync(sciezka, JSON.stringify({ kwota }))
  return kwota
}

const { adresy } = wczytajAdresy()
const indeks = indeksUlic(adresy)
const surowe = await listaZDyKty()
const dataDanych =
  surowe
    .map((x) => x.data_publikacji)
    .filter(Boolean)
    .sort()
    .at(-1) || dzien
const agregaty = new Map()
let miejskie = 0
let przypisane = 0
let zKwota = 0
for (const rekord of surowe) {
  if (!miejski.test(normalizuj(rekord.zamawiajacy))) continue
  miejskie++
  const dzielnica = dzielnicaOpisu(rekord, indeks)
  if (!dzielnica) continue
  przypisane++
  const kwota = await kwotaBZP(rekord)
  if (kwota === null) continue
  zKwota++
  const a = agregaty.get(dzielnica) || { liczba: 0, suma: 0, przyklad: null }
  a.liczba++
  a.suma += kwota
  if (!a.przyklad) a.przyklad = rekord.tytul
  agregaty.set(dzielnica, a)
}
if (!zKwota)
  throw new Error(
    `Nie ma ogłoszeń z potwierdzoną dzielnicą i kwotą (${surowe.length} wyników, ${miejskie} miejskich, ${przypisane} przypisanych). Brak pliku wskaźnika.`,
  )
const wartosci = adresy.map((a) => agregaty.get(a.dzielnica)?.liczba ?? null)
const odmiana = (n) =>
  n === 1
    ? 'przetarg'
    : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14)
      ? 'przetargi'
      : 'przetargów'
const etykiety = adresy.map((a) => {
  const x = agregaty.get(a.dzielnica)
  if (!x) return null
  const caly = x.przyklad?.replace(/\s+/g, ' ').trim() || 'zamówienie miejskie'
  const tytul = caly.length <= 40 ? caly : `${caly.slice(0, 40).replace(/\s+\S*$/, '')}…`
  return `${x.liczba} ${odmiana(x.liczba)}, ${(x.suma / 1e6).toLocaleString('pl-PL', { maximumFractionDigits: 2 })} mln zł, np. ${tytul}`
})
zapiszWskaznik(
  {
    id: 'przetargi_dzielnica',
    nazwa: 'Przetargi miejskie w dzielnicy',
    opis: `Liczba ogłoszeń o wyniku zamówień miejskich opublikowanych ${od}–${dzien} z jednoznaczną dzielnicą i potwierdzoną wartością umowy w PLN. Suma kwot w etykiecie. Rejestr może być niepełny; null oznacza brak przypisanych rekordów, nie potwierdzone zero.`,
    jednostka: 'przetargi',
    kategoria: 'przyszlosc',
    kierunek: 'neutralny',
    rozdzielczosc: 'rejon',
    rozmiar: 'dzielnica Krakowa',
    zadanie: 43,
    zakres: [0, 100],
    zrodla: [
      {
        nazwa: 'z-dykty.pl, publiczny serwer MCP (pośrednik BZP)',
        url: 'https://z-dykty.pl/dla-programistow',
        licencja: 'Informacja publiczna; wymagane wskazanie źródła i pośrednika',
        dataDanych,
        pobrano: dzien,
      },
      {
        nazwa: 'Urząd Zamówień Publicznych, API BZP e-Zamówienia',
        url: BZP,
        licencja: 'Informacja publiczna; ponowne wykorzystanie według regulaminu e-Zamówienia',
        dataDanych,
        pobrano: dzien,
      },
      ...JSON.parse(readFileSync(join('public', 'dane', 'adresy.json'), 'utf8')).zrodla,
    ],
  },
  wartosci,
  etykiety,
)
console.log(
  `Wyniki: ${surowe.length}; miejskie: ${miejskie}; dzielnica: ${przypisane}; kwota BZP: ${zKwota}; dzielnic z danymi: ${agregaty.size}`,
)
