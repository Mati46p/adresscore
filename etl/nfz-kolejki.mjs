// Kolejki do lekarzy specjalistów: mediana czasu oczekiwania w poradniach NFZ do 3 km od adresu
// → wskaźnik `nfz_kolejki_dni` (zadanie #138).
//
// Źródło: NFZ, Informator o Terminach Leczenia (API Terminy Leczenia, https://api.nfz.gov.pl/),
// dane.gov.pl zbiór 1455, licencja CC BY 4.0. Czytamy go z tabeli `nfz_kolejki` w z-dykty.pl, która
// ten informator przetwarza (PostgREST, publiczny klucz anon). Zmienne ZDYKTY_SUPABASE_URL
// i ZDYKTY_ANON_KEY idą z .env.local (poza repo). Surowe pobranie zostaje w
// etl/.cache/nfz-kolejki/ i drugi bieg go używa; `--odswiez` pobiera dane od nowa.
//
// Co liczy: dla adresu bierzemy poradnie specjalistyczne w promieniu 3 km (linia prosta, EPSG:2180).
// W każdej z 12 specjalności liczymy medianę czasów oczekiwania, a wynik to mediana tych
// specjalności. Zasady (każda ma powód):
//   - Tylko przypadek stabilny (zwykłe skierowanie). Przypadki pilne mają osobną, krótszą kolejkę;
//     wymieszane zaniżałyby czas, na który czeka typowy pacjent.
//   - Tylko poradnie dla dorosłych. Poradnie dziecięce, poradnie szpitali i centrów dziecięcych
//     (też te bez „dla dzieci” w nazwie) i poradnie dla kobiet w ciąży obsługują inną populację
//     i mają własne kolejki.
//   - Pomijamy onkologię (szybka ścieżka, czasy nieporównywalne z innymi specjalnościami),
//     tomografię i rezonans (diagnostyka, nie wizyta u lekarza) oraz kardiochirurgię (2 wpisy).
//   - Najpierw mediana w każdej specjalności, potem mediana specjalności. Czasy różnią się
//     między specjalnościami kilkukrotnie (okulistyka ok. 140 dni, laryngologia ok. 20), więc
//     mediana wszystkich wpisów razem mierzyłaby głównie to, ile poradni danej specjalności
//     stoi w okolicy, a nie długość kolejek.
//   - Wartość dopiero od 3 specjalności w promieniu. Mediana z 1–2 liczb to jedna konkretna
//     poradnia; brak wartości (null) znaczy „za mało danych”, nie „brak kolejki”.
//   - Czas to `srednio_dni` zgłoszone przez poradnię; 0 to prawdziwa wartość („przyjmują na
//     bieżąco”), brak sprawozdania (null) odpada. Bierzemy tylko najnowszy okres sprawozdawczy.
//
// Położenie poradni: z-dykty nie ma współrzędnych, a `gmina_teryt` wskazuje siedzibę
// świadczeniodawcy, nie miejsce świadczenia (wpis z Tarnowa ma TERYT Krakowa). Dlatego
// dopasowujemy miejscowość, ulicę i numer z NFZ do punktów adresowych z adresy.json (MSIP, PRG).
// Poradnie spoza 14 gmin z adresy.json nie mają tam punktów i nie wchodzą do wskaźnika.
//
// Uruchom: node etl/nfz-kolejki.mjs [--odswiez]

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { do2180 } from './lib/geo.mjs'
import { bezOgonkow } from './lib/nazwy.mjs'
import { indeksPunktow } from './lib/przestrzen.mjs'
import { CACHE, DANE, dzis, KORZEN, wczytajAdresy, zapiszWskaznik } from './lib/wspolne.mjs'

export const ID = 'nfz_kolejki_dni'
export const ZADANIE = 138
export const PROMIEN_M = 3000
export const MIN_SPECJALNOSCI = 3
export const PRZYPADEK_STABILNY = 1
/** Punkty adresowe tej samej ulicy i numeru dalej od siebie nie opisują jednego miejsca. */
const MAKS_ROZPROSZENIE_M = 150
/** Powyżej tego rozmiaru plik wskaźnika łamie kontrakt (docs/etapy/kontrakt-danych.md). */
const MAKS_ROZMIAR_B = 2_000_000
const STRONA = 1000 // limit wierszy na odpowiedź PostgREST (max-rows)
const ZRODLO_URL = 'https://api.nfz.gov.pl/app-itl-api/'
const KATALOG_URL = 'https://dane.gov.pl/pl/dataset/1455,informator-o-terminach-leczenia'
// Pauzę i półpauzę podajemy kodem znaku: literał pauzy w źródle łamałby regułę typografii PL,
// a formatter zamienia zapis \u na sam znak.
const PAUZA = String.fromCharCode(0x2014)
const POLPAUZA = String.fromCharCode(0x2013)
const KOLUMNY = [
  'id',
  'swiadczenie',
  'przypadek',
  'oddzial',
  'swiadczeniodawca_kod',
  'swiadczeniodawca',
  'miejsce',
  'miejscowosc',
  'adres',
  'oczekujacych',
  'srednio_dni',
  'okres',
  'zaktualizowano',
]

// ---------- które świadczenia ----------

const kluczGrupy = (tekst) => bezOgonkow(tekst).replace(/\s+/g, ' ').trim()

/** Grupy świadczeń z z-dykty (pole `swiadczenie`) wchodzące do wskaźnika → nazwa specjalności. */
export const SPECJALNOSCI = new Map(
  Object.entries({
    'ŚWIADCZENIA Z ZAKRESU OKULISTYKI': 'okulistyka',
    'ŚWIADCZENIA Z ZAKRESU OTOLARYNGOLOGII': 'laryngologia',
    'ŚWIADCZENIA Z ZAKRESU NEUROLOGII': 'neurologia',
    'ŚWIADCZENIA Z ZAKRESU ORTOPEDII I TRAUMATOLOGII NARZĄDU RUCHU': 'ortopedia',
    'ŚWIADCZENIA Z ZAKRESU GRUŹLICY I CHORÓB PŁUC': 'pulmonologia',
    'ŚWIADCZENIA Z ZAKRESU ENDOKRYNOLOGII': 'endokrynologia',
    'ŚWIADCZENIA Z ZAKRESU UROLOGII': 'urologia',
    'ŚWIADCZENIA Z ZAKRESU DIABETOLOGII': 'diabetologia',
    'PORADNIA DERMATOLOGICZNA': 'dermatologia',
    'PORADNIA REUMATOLOGICZNA': 'reumatologia',
    'ŚWIADCZENIA Z ZAKRESU NEFROLOGII': 'nefrologia',
    'ŚWIADCZENIA Z ZAKRESU GASTROENTEROLOGII': 'gastroenterologia',
  }).map(([grupa, nazwa]) => [kluczGrupy(grupa), nazwa]),
)

/** Grupy świadczeń znane z z-dykty, ale świadomie poza wskaźnikiem (powody w nagłówku pliku). */
export const POMINIETE_GRUPY = new Set(
  [
    'ŚWIADCZENIA Z ZAKRESU ONKOLOGII',
    'TOMOGRAFIA KOMPUTEROWA',
    'REZONANS MAGNETYCZNY',
    'PORADNIA KARDIOCHIRURGICZNA',
  ].map(kluczGrupy),
)

/** Miejsce świadczenia będące poradnią lub gabinetem (nie pracownią diagnostyczną ani oddziałem). */
const PORADNIA = /^(?:specjalistyczna\s+)?(?:poradnia|gabinet|przychodnia)\b/
/** Poradnie dla dzieci i kobiet w ciąży: inna populacja, własne kolejki. */
const INNA_POPULACJA = /dziec|ciezarn/
/** Szpitale i centra dziecięce: ich poradnie (też te bez „dla dzieci” w nazwie) leczą tylko dzieci. */
const PLACOWKA_DZIECIECA = /dziec/

/**
 * Wiersze `nfz_kolejki` po filtrach wskaźnika (przypadek stabilny, 12 specjalności, poradnie dla
 * dorosłych, znany czas oczekiwania, najnowszy okres). Zwraca też bilans: ile wierszy odpadło i dlaczego.
 */
export function wybierzWiersze(wiersze) {
  const okres = wiersze.reduce((maks, w) => (w.okres && w.okres > maks ? w.okres : maks), '')
  const bilans = {
    wszystkie: wiersze.length,
    okres,
    innyPrzypadek: 0,
    pominieteGrupy: 0,
    nieznaneGrupy: new Map(),
    nieporadnia: 0,
    innaPopulacja: 0,
    bezCzasu: 0,
    starszyOkres: 0,
    wybrane: 0,
  }
  const wybrane = []
  for (const w of wiersze) {
    if (w.przypadek !== PRZYPADEK_STABILNY) {
      bilans.innyPrzypadek++
      continue
    }
    const grupa = kluczGrupy(w.swiadczenie ?? '')
    const specjalnosc = SPECJALNOSCI.get(grupa)
    if (!specjalnosc) {
      if (POMINIETE_GRUPY.has(grupa)) bilans.pominieteGrupy++
      else
        bilans.nieznaneGrupy.set(w.swiadczenie, (bilans.nieznaneGrupy.get(w.swiadczenie) ?? 0) + 1)
      continue
    }
    const miejsce = bezOgonkow(w.miejsce ?? '')
    if (!PORADNIA.test(miejsce)) {
      bilans.nieporadnia++
      continue
    }
    if (
      INNA_POPULACJA.test(miejsce) ||
      PLACOWKA_DZIECIECA.test(bezOgonkow(w.swiadczeniodawca ?? ''))
    ) {
      bilans.innaPopulacja++
      continue
    }
    if (!Number.isFinite(w.srednio_dni) || w.srednio_dni < 0) {
      bilans.bezCzasu++
      continue
    }
    if (w.okres !== okres) {
      bilans.starszyOkres++
      continue
    }
    wybrane.push({ ...w, specjalnosc })
  }
  bilans.wybrane = wybrane.length
  return { wybrane, bilans }
}

// ---------- adres NFZ → punkt adresowy ----------

/** Numer domu na końcu adresu; zakres („35-37”), lokal („38/219”) i dopisek („BUD. I”) pomijamy. */
const NUMER = /^(.*?)[\s,]+(\d+)\s*([A-Za-z]{0,3})\b(?:\s*[-/].*)?$/

/**
 * „UL. GRZEGÓRZECKA 67 C” → { ulica: „UL. GRZEGÓRZECKA”, nr: „67c”, nrBazowy: „67” }.
 * Bez numeru na końcu: nr = null (adres nie wskazuje budynku).
 */
export function parsujAdres(adres) {
  const tekst = String(adres ?? '')
    .replace(/\s+/g, ' ')
    .replace(/\s+BUD\.?\s.*$/i, '')
    .trim()
  const m = tekst.match(NUMER)
  if (!m) return { ulica: tekst, nr: null, nrBazowy: null }
  return { ulica: m[1], nr: `${m[2]}${m[3]}`.toLowerCase(), nrBazowy: m[2] }
}

const normalizuj = (tekst) =>
  bezOgonkow(tekst)
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

/** Słowa rodzaju ulicy: NFZ pisze „AL.”, „OS.”, „UL. UL.”, a punkty adresowe pełne słowa albo nic. */
const RODZAJE_ULIC = new Set(['ul', 'ulica', 'aleja', 'al', 'osiedle', 'os', 'plac', 'pl'])

/** Człony nazwy ulicy bez rodzaju („UL. AL. F. FOCHA” → [„f”, „focha”]). */
export function czlonyUlicy(ulica) {
  return normalizuj(ulica)
    .split(' ')
    .filter((c) => c && !RODZAJE_ULIC.has(c))
}

const czlonZgodny = (x, y) =>
  x === y || (x.length <= 4 && y.startsWith(x)) || (y.length <= 4 && x.startsWith(y))

/**
 * Czy dwie nazwy ulic mogą oznaczać to samo. Porównujemy od końca krótszej nazwy, bo NFZ pomija
 * imię („Kopernika” = „Mikołaja Kopernika”), skraca je do inicjału („F. Focha”) albo tytułu
 * („ks.”, „gen.”). Co najmniej jeden człon musi być równy w całości, żeby sam skrót nie wystarczał.
 */
export function ulicaZgodna(a, b) {
  const n = Math.min(a.length, b.length)
  if (!n) return false
  let rowne = 0
  for (let i = 1; i <= n; i++) {
    const x = a[a.length - i]
    const y = b[b.length - i]
    if (!czlonZgodny(x, y)) return false
    if (x === y) rowne++
  }
  return rowne > 0
}

/** Nazwy miejscowości do wyszukania: pełna i bez dopisku po myślniku („KRAKÓW-PODGÓRZE” → krakow). */
function nazwyMiejscowosci(miejscowosc) {
  const surowa = String(miejscowosc ?? '')
  return [...new Set([normalizuj(surowa), normalizuj(surowa.split('-')[0])])].filter(Boolean)
}

const numerBazowy = (nr) => String(nr ?? '').match(/^\d+/)?.[0] ?? ''
const nrNorm = (nr) =>
  String(nr ?? '')
    .toLowerCase()
    .replace(/\s+/g, '')

/** Indeks adresów: miejscowość|numer (pełny i bazowy) → punkty adresowe. */
export function indeksAdresow(adresy) {
  const poNumerze = new Map()
  const poBazowym = new Map()
  const miejscowosci = new Set()
  const zUlicami = new Set()
  const dodaj = (mapa, klucz, a) => {
    const lista = mapa.get(klucz)
    if (lista) lista.push(a)
    else mapa.set(klucz, [a])
  }
  for (const a of adresy) {
    const m = normalizuj(a.miejscowosc)
    miejscowosci.add(m)
    if (a.ulica) zUlicami.add(m)
    dodaj(poNumerze, `${m}|${nrNorm(a.nr)}`, a)
    dodaj(poBazowym, `${m}|${numerBazowy(a.nr)}`, a)
  }
  const bezUlic = new Set([...miejscowosci].filter((m) => !zUlicami.has(m)))
  return { poNumerze, poBazowym, miejscowosci, bezUlic }
}

const odlegloscPlaska = (a, b) => {
  const [ax, ay] = do2180(a.lon, a.lat)
  const [bx, by] = do2180(b.lon, b.lat)
  return Math.hypot(ax - bx, ay - by)
}

/** Jedno miejsce, jeśli wszyscy kandydaci leżą blisko pierwszego; inaczej null (niejednoznaczne). */
function jednoznaczne(kandydaci) {
  const [pierwszy] = kandydaci
  return kandydaci.every((a) => odlegloscPlaska(a, pierwszy) <= MAKS_ROZPROSZENIE_M)
    ? pierwszy
    : null
}

/**
 * Punkt adresowy dla miejsca świadczenia z NFZ (miejscowość + adres). Kolejność prób: ulica
 * i pełny numer, ulica i numer bazowy („5G” → „5A”), a w miejscowości bez ulic sam numer.
 * @returns {{ adres: object, tryb: string } | { brak: 'poza obszarem' | 'bez numeru' | 'nie znaleziono' | 'niejednoznaczne' }}
 */
export function znajdzAdres(miejscowosc, adres, indeks) {
  const miejscowosci = nazwyMiejscowosci(miejscowosc).filter((m) => indeks.miejscowosci.has(m))
  if (!miejscowosci.length) return { brak: 'poza obszarem' }
  const p = parsujAdres(adres)
  if (!p.nr) return { brak: 'bez numeru' }
  const ulica = czlonyUlicy(p.ulica)
  let niejednoznaczne = false
  for (const m of miejscowosci) {
    const proby = [
      ['numer', indeks.poNumerze.get(`${m}|${p.nr}`), true],
      ['numer bazowy', indeks.poBazowym.get(`${m}|${p.nrBazowy}`), true],
    ]
    // Wieś numerowana (w punktach adresowych bez ulic): adres NFZ to nazwa wsi i numer, więc
    // wystarcza numer. Gdy NFZ podaje ulicę, której wieś nie ma, to prawie na pewno inna wieś
    // o tej samej nazwie (Zagórze pod Chrzanowem, nie Zagórze w gminie Niepołomice) – nie zgadujemy.
    if (indeks.bezUlic.has(m) && (!ulica.length || ulica.join(' ') === m))
      proby.push(['wieś bez ulic', indeks.poNumerze.get(`${m}|${p.nr}`), false])
    for (const [tryb, kandydaci, zUlica] of proby) {
      const pasujace = (kandydaci ?? []).filter((a) =>
        zUlica ? a.ulica && ulicaZgodna(ulica, czlonyUlicy(a.ulica)) : !a.ulica,
      )
      if (!pasujace.length) continue
      const wybrany = jednoznaczne(pasujace)
      if (wybrany) return { adres: wybrany, tryb }
      niejednoznaczne = true
    }
  }
  return { brak: niejednoznaczne ? 'niejednoznaczne' : 'nie znaleziono' }
}

// ---------- poradnie i wartości dla adresów ----------

export function mediana(liczby) {
  const s = [...liczby].sort((a, b) => a - b)
  if (!s.length) return null
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/**
 * Poradnie z położeniem: jedna pozycja na (świadczeniodawca, punkt adresowy, specjalność), z czasem
 * równym medianie wpisów (np. „PORADNIA NEUROLOGICZNA” i „…NEUROLOGICZNA I” tego samego zakładu).
 * Bilans mówi, ile miejsc z obszaru adresy.json udało się dopasować.
 */
export function zbudujPoradnie(wybrane, indeks) {
  const bilans = {
    miejsc: 0,
    wObszarze: 0,
    dopasowane: 0,
    wierszyWObszarze: 0,
    wierszyDopasowanych: 0,
    tryby: {},
    niedopasowane: [],
  }
  const miejsca = new Map()
  const poradnie = new Map()
  for (const w of wybrane) {
    const kluczMiejsca = `${w.miejscowosc}|${w.adres}`
    let wynik = miejsca.get(kluczMiejsca)
    if (!wynik) {
      wynik = znajdzAdres(w.miejscowosc, w.adres, indeks)
      miejsca.set(kluczMiejsca, wynik)
      bilans.miejsc++
      if (wynik.brak !== 'poza obszarem') bilans.wObszarze++
      if (wynik.adres) {
        bilans.dopasowane++
        bilans.tryby[wynik.tryb] = (bilans.tryby[wynik.tryb] ?? 0) + 1
      } else if (wynik.brak !== 'poza obszarem')
        bilans.niedopasowane.push(`${w.miejscowosc}, ${w.adres} (${wynik.brak})`)
    }
    if (wynik.brak !== 'poza obszarem') bilans.wierszyWObszarze++
    if (!wynik.adres) continue
    bilans.wierszyDopasowanych++
    const klucz = `${w.oddzial}|${w.swiadczeniodawca_kod}|${wynik.adres.id}|${w.specjalnosc}`
    const poradnia = poradnie.get(klucz)
    if (poradnia) poradnia.dni.push(w.srednio_dni)
    else {
      const [x, y] = do2180(wynik.adres.lon, wynik.adres.lat)
      poradnie.set(klucz, {
        klucz,
        specjalnosc: w.specjalnosc,
        x,
        y,
        lon: wynik.adres.lon,
        lat: wynik.adres.lat,
        nazwa: w.swiadczeniodawca,
        adres: `${w.adres}, ${w.miejscowosc}`,
        dni: [w.srednio_dni],
      })
    }
  }
  return {
    poradnie: [...poradnie.values()].map((p) => ({ ...p, dni: mediana(p.dni) })),
    bilans,
  }
}

/** Mediana po specjalnościach z poradni w zbiorze; null przy mniej niż `minimum` specjalności. */
function wartoscZPoradni(poradnie, minimum) {
  const poSpecjalnosci = new Map()
  for (const p of poradnie) {
    const lista = poSpecjalnosci.get(p.specjalnosc)
    if (lista) lista.push(p.dni)
    else poSpecjalnosci.set(p.specjalnosc, [p.dni])
  }
  const k = poSpecjalnosci.size
  if (k < minimum) return { k, wartosc: null }
  return { k, wartosc: Math.round(mediana([...poSpecjalnosci.values()].map(mediana))) }
}

/**
 * Wartość dla każdego adresu: poradnie w promieniu (EPSG:2180, linia prosta). Zwraca wartości
 * (całe dni albo null) oraz liczbę specjalności `k` i poradni `n` w promieniu każdego adresu.
 */
export function policzWartosci(
  adresy,
  poradnie,
  { promien = PROMIEN_M, minimum = MIN_SPECJALNOSCI } = {},
) {
  if (!poradnie.length) throw new Error('Brak poradni z położeniem – nie ma czego liczyć')
  const indeks = indeksPunktow(poradnie.map((p) => [p.x, p.y]))
  const wartosci = new Array(adresy.length).fill(null)
  const k = new Uint8Array(adresy.length)
  const n = new Uint16Array(adresy.length)
  for (const a of adresy) {
    const [x, y] = do2180(a.lon, a.lat)
    const w = indeks.within(x, y, promien).map((i) => poradnie[i])
    n[a.i] = w.length
    const wynik = wartoscZPoradni(w, minimum)
    k[a.i] = wynik.k
    wartosci[a.i] = wynik.wartosc
  }
  return { wartosci, k, n }
}

// ---------- etykiety ----------

/** Odmiana: 1 → jeden, 2–4 (poza 12–14) → kilka, reszta → wiele. */
export function liczebnik(n, jeden, kilka, wiele) {
  if (n === 1) return jeden
  const j = n % 10
  const d = n % 100
  return j >= 2 && j <= 4 && !(d >= 12 && d <= 14) ? kilka : wiele
}

const specjalnosci = (k) => `${k} ${liczebnik(k, 'specjalność', 'specjalności', 'specjalności')}`
const poradni = (n) => `${n} ${liczebnik(n, 'poradnia', 'poradnie', 'poradni')}`

/**
 * Etykiety dla karty jako klucze słownika (pełne napisy dla 176 tys. adresów przekroczyłyby 2 MB):
 * ile specjalności i poradni leży w promieniu albo dlaczego nie ma wartości.
 * Klucze: kolejne liczby w systemie 36, nadawane po posortowaniu par (k, n), więc stałe między biegami.
 */
export function etykietyKolejek(
  { wartosci, k, n },
  { promien = PROMIEN_M, minimum = MIN_SPECJALNOSCI } = {},
) {
  const km = `${promien / 1000} km`.replace('.', ',')
  const opisy = new Map() // „k/n” albo „k” (brak wartości) → napis
  const klucze = new Array(wartosci.length)
  const rodzaj = (i) => (wartosci[i] === null ? `${k[i]}` : `${k[i]}/${n[i]}`)
  for (let i = 0; i < wartosci.length; i++) {
    const r = rodzaj(i)
    klucze[i] = r
    if (opisy.has(r)) continue
    if (wartosci[i] !== null)
      opisy.set(r, `${specjalnosci(k[i])}, ${poradni(n[i])} w promieniu ${km}`)
    else if (k[i] === 0) opisy.set(r, `Brak poradni z danymi NFZ w promieniu ${km}`)
    else
      opisy.set(
        r,
        `W promieniu ${km} tylko ${specjalnosci(k[i])} (potrzeba co najmniej ${minimum}), za mało na medianę`,
      )
  }
  const posortowane = [...opisy.keys()].sort((a, b) => {
    const [ak = 0, an = 0] = a.split('/').map(Number)
    const [bk = 0, bn = 0] = b.split('/').map(Number)
    return ak - bk || an - bn
  })
  const slownik = {}
  const id = new Map()
  posortowane.forEach((r, i) => {
    id.set(r, i.toString(36))
    slownik[i.toString(36)] = opisy.get(r)
  })
  return { etykiety: klucze.map((r) => id.get(r)), slownik }
}

// ---------- kontrola niezależna ----------

const RAD = Math.PI / 180
/** Odległość na kuli (haversine) – inna metoda niż rzut EPSG:2180, więc nadaje się do kontroli. */
function odlegloscGeodezyjna(aLat, aLon, bLat, bLon) {
  const dLat = (bLat - aLat) * RAD
  const dLon = (bLon - aLon) * RAD
  const s =
    Math.sin(dLat / 2) ** 2 + Math.cos(aLat * RAD) * Math.cos(bLat * RAD) * Math.sin(dLon / 2) ** 2
  return 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(s)))
}

/**
 * Przelicza `liczba` adresów (równo rozłożonych) pełnym przeglądem poradni na kuli i porównuje
 * z wartościami z indeksu przestrzennego. Adres, którego wynik zmienia się po przesunięciu
 * promienia o ±`luz` m, to przypadek graniczny (rzut i kula różnią się o ~0,1%), nie rozbieżność.
 */
export function kontrolaNiezalezna(
  adresy,
  poradnie,
  { wartosci },
  { liczba = 600, promien = PROMIEN_M, minimum = MIN_SPECJALNOSCI, luz = 15 } = {},
) {
  const krok = Math.max(1, Math.floor(adresy.length / liczba))
  const wynik = { sprawdzone: 0, graniczne: 0, rozbieznosci: [] }
  for (let i = 0; i < adresy.length; i += krok) {
    const a = adresy[i]
    const wartoscDla = (r) =>
      wartoscZPoradni(
        poradnie.filter((p) => odlegloscGeodezyjna(a.lat, a.lon, p.lat, p.lon) <= r),
        minimum,
      ).wartosc
    const wartosc = wartoscDla(promien)
    wynik.sprawdzone++
    if (wartoscDla(promien - luz) !== wartosc || wartoscDla(promien + luz) !== wartosc) {
      wynik.graniczne++
      continue
    }
    if (wartosc !== wartosci[a.i])
      wynik.rozbieznosci.push({ i: a.i, kula: wartosc, indeks: wartosci[a.i] })
  }
  return wynik
}

// ---------- pobieranie z z-dykty ----------

function zmiennaSrodowiska(nazwa) {
  if (!process.env[nazwa]) {
    try {
      process.loadEnvFile(join(KORZEN, '.env.local'))
    } catch {
      /* brak pliku: zgłosimy brak zmiennej niżej */
    }
  }
  const wartosc = process.env[nazwa]
  if (!wartosc) throw new Error(`Brak zmiennej ${nazwa} (ustaw w .env.local, poza repo)`)
  return wartosc.replace(/\/+$/, '')
}

async function pobierzStrone(url, klucz, proby = 3) {
  for (let i = 1; ; i++) {
    try {
      const r = await fetch(url, {
        headers: { apikey: klucz, Prefer: 'count=exact' },
        signal: AbortSignal.timeout(60_000),
      })
      if (!r.ok) throw new Error(`z-dykty ${r.status}: ${(await r.text()).slice(0, 200)}`)
      const razem = Number(r.headers.get('content-range')?.split('/')[1])
      return { wiersze: await r.json(), razem }
    } catch (blad) {
      if (i === proby) throw blad
      await new Promise((ok) => setTimeout(ok, 1000 * i))
    }
  }
}

/** Wszystkie wiersze `nfz_kolejki` z podanych województw (stronicowanie limit/offset). */
async function pobierzKolejki(wojewodztwa) {
  const adres = zmiennaSrodowiska('ZDYKTY_SUPABASE_URL')
  const klucz = zmiennaSrodowiska('ZDYKTY_ANON_KEY')
  const wiersze = []
  let razem = null
  for (let od = 0; razem === null || od < razem; od += STRONA) {
    const url = `${adres}/rest/v1/nfz_kolejki?select=${KOLUMNY.join(',')}&woj_teryt=in.(${wojewodztwa.join(',')})&order=id&limit=${STRONA}&offset=${od}`
    const strona = await pobierzStrone(url, klucz)
    razem = strona.razem
    wiersze.push(...strona.wiersze)
    if (!strona.wiersze.length) break
  }
  if (!Number.isFinite(razem) || wiersze.length !== razem)
    throw new Error(`Niepełne pobranie nfz_kolejki: ${wiersze.length} z ${razem}`)
  const brakujace = KOLUMNY.filter((kolumna) => wiersze.length && !(kolumna in wiersze[0]))
  if (brakujace.length) throw new Error(`z-dykty zmieniło schemat nfz_kolejki: brak ${brakujace}`)
  return wiersze
}

/** Surowe wiersze z cache (etl/.cache/nfz-kolejki/) albo z z-dykty; data pobrania zostaje w pliku. */
async function wczytajKolejki(wojewodztwa, { odswiez }) {
  const plik = join(CACHE, 'nfz-kolejki', `nfz_kolejki_woj${wojewodztwa.join('-')}.json`)
  if (!odswiez && existsSync(plik)) return JSON.parse(readFileSync(plik, 'utf8'))
  const wiersze = await pobierzKolejki(wojewodztwa)
  const dane = { pobrano: dzis(), wojewodztwa, wiersze }
  mkdirSync(join(CACHE, 'nfz-kolejki'), { recursive: true })
  writeFileSync(plik, JSON.stringify(dane))
  return dane
}

// ---------- uruchomienie ----------

const kwantyl = (posortowane, p) => posortowane[Math.floor((posortowane.length - 1) * p)]

async function main() {
  const start = performance.now()
  const { wersja, adresy } = wczytajAdresy()
  const wojewodztwa = [...new Set(adresy.map((a) => a.teryt.slice(0, 2)))].sort()
  const { pobrano, wiersze } = await wczytajKolejki(wojewodztwa, {
    odswiez: process.argv.includes('--odswiez'),
  })

  const { wybrane, bilans } = wybierzWiersze(wiersze)
  console.log(
    `NFZ (z-dykty): ${bilans.wszystkie} wierszy, okres ${bilans.okres}, po filtrach ${bilans.wybrane} (przypadek pilny ${bilans.innyPrzypadek}, pominięte grupy ${bilans.pominieteGrupy}, nie poradnie ${bilans.nieporadnia}, dzieci i ciąża ${bilans.innaPopulacja}, bez czasu ${bilans.bezCzasu}, starszy okres ${bilans.starszyOkres})`,
  )
  if (bilans.nieznaneGrupy.size)
    console.warn(
      `UWAGA: nowe grupy świadczeń w z-dykty, nie ujęte we wskaźniku: ${[...bilans.nieznaneGrupy.keys()].join('; ')}`,
    )
  for (const [kluczGrupyZrodla, nazwa] of SPECJALNOSCI) {
    if (!wybrane.some((w) => w.specjalnosc === nazwa))
      throw new Error(
        `Brak wpisów specjalności „${nazwa}” (${kluczGrupyZrodla}): zmiana w z-dykty?`,
      )
  }

  const { poradnie, bilans: geo } = zbudujPoradnie(wybrane, indeksAdresow(adresy))
  const procent = (a, b) => `${((100 * a) / b).toFixed(1)}%`
  console.log(
    `Dopasowanie adresów NFZ do punktów adresowych: ${geo.dopasowane}/${geo.wObszarze} miejsc w obszarze adresy.json (${procent(geo.dopasowane, geo.wObszarze)}), wierszy ${geo.wierszyDopasowanych}/${geo.wierszyWObszarze} (${procent(geo.wierszyDopasowanych, geo.wierszyWObszarze)}); tryby ${JSON.stringify(geo.tryby)}; poza obszarem ${geo.miejsc - geo.wObszarze} miejsc`,
  )
  for (const n of geo.niedopasowane) console.log(`  bez położenia: ${n}`)
  console.log(
    `Poradnie z położeniem: ${poradnie.length} (specjalność × świadczeniodawca × punkt adresowy), ${new Set(poradnie.map((p) => `${p.lon}|${p.lat}`)).size} różnych punktów`,
  )
  if (geo.wObszarze < 20 || geo.dopasowane / geo.wObszarze < 0.8)
    throw new Error('Dopasowanie adresów poniżej 80%: zmienił się format adresów NFZ?')

  const wynik = policzWartosci(adresy, poradnie)
  const kontrola = kontrolaNiezalezna(adresy, poradnie, wynik)
  console.log(
    `Kontrola niezależna (kula, pełny przegląd poradni): ${kontrola.sprawdzone} adresów, ${kontrola.graniczne} granicznych, ${kontrola.rozbieznosci.length} rozbieżności`,
  )
  if (kontrola.rozbieznosci.length)
    throw new Error(
      `Rozbieżności z kontrolą niezależną: ${JSON.stringify(kontrola.rozbieznosci.slice(0, 5))}`,
    )

  const z = wynik.wartosci.filter((v) => v !== null).sort((a, b) => a - b)
  console.log(
    `Wartości: min ${z[0]}, p10 ${kwantyl(z, 0.1)}, mediana ${kwantyl(z, 0.5)}, p90 ${kwantyl(z, 0.9)}, p99 ${kwantyl(z, 0.99)}, max ${z.at(-1)} dni`,
  )
  const poGminie = new Map()
  for (const a of adresy) {
    const g = poGminie.get(a.gmina) ?? { razem: 0, wartosc: 0 }
    g.razem++
    if (wynik.wartosci[a.i] !== null) g.wartosc++
    poGminie.set(a.gmina, g)
  }
  console.log(
    `Pokrycie wg gmin: ${[...poGminie].map(([g, { razem, wartosc }]) => `${g} ${wartosc}/${razem}`).join(', ')}`,
  )

  const { etykiety, slownik } = etykietyKolejek(wynik)
  const adresyZrodla = JSON.parse(readFileSync(join(DANE, 'adresy.json'), 'utf8')).zrodla
  const km = `${PROMIEN_M / 1000} km`
  const sciezka = join(DANE, 'wskazniki', `${ID}.json`)
  zapiszWskaznik(
    {
      id: ID,
      kategoria: 'kontekst',
      nazwa: 'Czas oczekiwania do specjalisty NFZ w promieniu 3 km',
      opis: `Mediana czasu oczekiwania (dni) na pierwszą wizytę, jaki podają poradnie specjalistyczne NFZ w promieniu ${km} w linii prostej (stan: ${bilans.okres}). Dla każdej z ${SPECJALNOSCI.size} specjalności (okulistyka, laryngologia, neurologia, ortopedia, pulmonologia, endokrynologia, urologia, diabetologia, dermatologia, reumatologia, nefrologia, gastroenterologia) bierzemy medianę z poradni, a wynik to mediana tych specjalności; potrzeba co najmniej ${MIN_SPECJALNOSCI} specjalności, inaczej brak wartości. Tylko przypadek stabilny (zwykłe skierowanie) i poradnie dla dorosłych; bez onkologii, diagnostyki obrazowej i poradni dziecięcych. Czas to średnia dni oczekiwania zgłoszona przez poradnię, nie gwarancja terminu; 0 znaczy, że przyjmują na bieżąco. Wartość zależy od tego, jakie specjalności są w pobliżu, i nie mówi o czasie dojazdu ani o dostępności wolnych terminów. Położenie poradni ustalono z adresu w NFZ i punktów adresowych MSIP/PRG (${procent(geo.dopasowane, geo.wObszarze).replace('.', ',')} miejsc w obszarze mapy); poradnie poza 14 gminami obszaru nie wchodzą do wskaźnika. Brak wartości znaczy za mało poradni z danymi w promieniu, nie brak kolejki.`,
      jednostka: 'dni',
      kierunek: 'mniej-lepiej',
      rozdzielczosc: 'adres',
      zakres: [0, 200],
      zadanie: ZADANIE,
      zrodla: [
        {
          nazwa:
            'Narodowy Fundusz Zdrowia – Informator o Terminach Leczenia (API Terminy Leczenia); przetworzone przez z-dykty.pl (CC BY 4.0)',
          url: ZRODLO_URL,
          licencja: `CC BY 4.0 (${KATALOG_URL}); źródło danych: ${ZRODLO_URL} (wymóg regulaminu API); przetworzono: filtr przypadku stabilnego i poradni dla dorosłych, położenie z adresu, mediana w promieniu ${km}`,
          dataDanych: bilans.okres,
          pobrano,
        },
        // Źródła adresów przejmujemy z adresy.json; pauzę z ich nazw zamieniamy na półpauzę.
        ...adresyZrodla.map((zrodlo) => ({
          ...zrodlo,
          nazwa: `Położenie poradni: ${zrodlo.nazwa.replaceAll(PAUZA, POLPAUZA)}`,
        })),
      ],
    },
    wynik.wartosci,
    etykiety,
    slownik,
  )
  const rozmiar = statSync(sciezka).size
  console.log(
    `Plik: ${(rozmiar / 1e6).toFixed(2)} MB (limit ${MAKS_ROZMIAR_B / 1e6} MB), wersja adresów ${wersja}, czas ${((performance.now() - start) / 1000).toFixed(1)} s`,
  )
  if (rozmiar >= MAKS_ROZMIAR_B)
    throw new Error(`Plik wskaźnika ${rozmiar} B przekracza limit 2 MB`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1])
  main().catch((blad) => {
    console.error(blad)
    process.exitCode = 1
  })
