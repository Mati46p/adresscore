// Czujniki obywatelskie Sensor.Community: pobieranie dziennych plików archiwum i kontrola jakości
// odczytów pyłu (zadanie #144). Moduł dla etl/sensor-community.mjs; wynik to tabela zgodności
// z modelem GIOŚ do strony metody, a NIE wskaźnik (żadna wartość adresu się nie zmienia).
//
// Źródło: https://archive.sensor.community/<rok>/<dzień>/<dzień>_<typ>_sensor_<id>.csv.gz –
//   jeden plik na czujnik i dobę (UTC), bez klucza i konta. Licencja archiwum (00disclamer.md
//   w repozytorium projektu): ODbL 1.0 dla bazy, DbCL 1.0 dla zawartości. Archiwum ma tylko
//   czujniki zewnętrzne. Lista czujników: żywe API (static/v2/data.24h.json), które wymaga
//   nagłówka User-Agent z kontaktem.
// Czas: wszystkie godziny w UTC, od 1 stycznia 00:00 UTC; rok = rok modelu GIOŚ.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { CACHE } from './wspolne.mjs'

export const ARCHIWUM = 'https://archive.sensor.community'
export const DANE_ZYWE = 'https://data.sensor.community/static/v2/data.24h.json'
export const USER_AGENT =
  'adresscore-etl/1.0 (HackYeah 2026; jednorazowe pobranie; https://github.com/Mati46p/adresscore)'

/** Czujniki pyłu, które w archiwum mają kolumny P1 (PM10) i P2 (PM2,5). */
export const TYPY_PYLU = [
  'SDS011',
  'SPS30',
  'PMS1003',
  'PMS3003',
  'PMS5003',
  'PMS6003',
  'PMS7003',
  'HPM',
  'NEXTPM',
  'SEN5X',
]
/** Czujniki wilgotności, od najbardziej wiarygodnych (SHT3x, BME280) do najsłabszych (DHT). */
export const TYPY_WILGOTNOSCI = [
  'SHT31',
  'SHT35',
  'SHT30',
  'BME280',
  'BME680',
  'HTU21D',
  'DHT22',
  'DHT11',
  'SHT11',
  'SHT15',
]

/** Reguły kontroli jakości – jedno miejsce, żeby opis metody w wyniku nie rozjechał się z kodem. */
export const REGULY = {
  /** Odczyt pyłu poza [0, 999) µg/m³ to błąd (SDS011 nasyca się przy 999,9). */
  maxOdczytu: 999,
  /** Odczyt > mnożnik × mediana godziny + dodatek to pojedynczy skok, nie pomiar. */
  skok: { p2: [3, 15], p1: [3, 25] },
  /** Godzina ważna od tylu odczytów (po usunięciu skoków); czujnik raportujący rzadziej: od połowy swojej typowej liczby, min. 1. */
  minOdczytowWGodzinie: 3,
  /** Godzina z ≥ tylu odczytami o tej samej wartości PM2,5 = zawieszony czujnik. */
  zawieszenieOdczytow: 6,
  /** Wilgotność powyżej tego progu (%) zawyża odczyty optyczne (rosnące krople), więc godzina nie wchodzi do średniej „suchej”. */
  progWilgotnosci: 80,
  /** Doba z ≥ tylu odczytami wilgotności o rozstępie < maks. to zawieszony czujnik wilgotności. */
  wilgotnoscZawieszona: { minOdczytow: 30, maxRozstep: 0.5 },
  minOdczytowWilgotnosciWGodzinie: 2,
  /** Godzina odstająca względem pozostałych czujników: > mnożnik × mediana + dodatek (albo poniżej mediana / dolny). */
  odstajaca: { mnoznik: 4, dodatek: 30, dolny: 5, medianaDlaDolnego: 20, minCzujnikow: 5 },
  /** PM2,5 większe od PM10 o więcej niż tolerancja to niespójna godzina (uszkodzony kanał PM10). */
  niespojnosc: { wzgledna: 0.15, bezwzgledna: 2 },
  /** Czujnik wchodzi do tabeli przy takim pokryciu godzin roku i takiej liczbie miesięcy z danymi. */
  minPokrycie: 0.75,
  minMiesiecy: 10,
  minGodzinWMiesiacu: 200,
  minGodzinSuchychWMiesiacu: 50,
  /** Maksymalny udział godzin wyrzuconych jako odstające / zawieszone / niespójne. */
  maxUdzialOdstajacych: 0.1,
  maxUdzialZawieszonych: 0.1,
  maxUdzialNiespojnych: 0.25,
  /** Zmiana lokalizacji: dominująca pozycja ma < tego udziału odczytów albo druga jest dalej niż tyle metrów. */
  minUdzialLokalizacji: 0.9,
  maxPrzesuniecieM: 250,
}

const czekaj = (ms) => new Promise((r) => setTimeout(r, ms))

export const czyPrzestepny = (rok) => (rok % 4 === 0 && rok % 100 !== 0) || rok % 400 === 0
export const godzinWRoku = (rok) => (czyPrzestepny(rok) ? 8784 : 8760)

/** Wszystkie doby roku jako 'RRRR-MM-DD'. */
export function dniRoku(rok) {
  const dni = []
  for (let d = Date.UTC(rok, 0, 1); new Date(d).getUTCFullYear() === rok; d += 86_400_000)
    dni.push(new Date(d).toISOString().slice(0, 10))
  return dni
}

/** Numer godziny od 1 stycznia 00:00 UTC dla znacznika 'RRRR-MM-DDTGG:MM:SS' albo -1 poza rokiem. */
export function indeksGodziny(znacznik, rok) {
  const r = Number(znacznik.slice(0, 4))
  const m = Number(znacznik.slice(5, 7))
  const d = Number(znacznik.slice(8, 10))
  const g = Number(znacznik.slice(11, 13))
  if (r !== rok || !(m >= 1 && m <= 12) || !(d >= 1 && d <= 31) || !(g >= 0 && g <= 23)) return -1
  return Math.round((Date.UTC(r, m - 1, d, g) - Date.UTC(rok, 0, 1)) / 3_600_000)
}

/** Miesiąc (0–11) każdej godziny roku. */
export function miesiaceGodzin(rok) {
  const wynik = new Uint8Array(godzinWRoku(rok))
  const t0 = Date.UTC(rok, 0, 1)
  for (let h = 0; h < wynik.length; h++) wynik[h] = new Date(t0 + h * 3_600_000).getUTCMonth()
  return wynik
}

export function mediana(liczby) {
  if (!liczby.length) return Number.NaN
  const t = [...liczby].sort((a, b) => a - b)
  const s = t.length >> 1
  return t.length % 2 ? t[s] : (t[s - 1] + t[s]) / 2
}

const srednia = (t) => t.reduce((s, x) => s + x, 0) / t.length
const zaokr = (v, miejsca = 2) => {
  const k = 10 ** miejsca
  return Math.round(v * k) / k
}

/** Indeksy kolumn nagłówka CSV (separator ;). */
function kolumny(naglowek) {
  const t = naglowek.trim().split(';')
  return Object.fromEntries(t.map((n, i) => [n, i]))
}

function dodajLokalizacje(mapa, c, ix) {
  if (ix.location === undefined || ix.lat === undefined || ix.lon === undefined) return
  const klucz = `${c[ix.location]}|${c[ix.lat]}|${c[ix.lon]}`
  mapa.set(klucz, (mapa.get(klucz) ?? 0) + 1)
}

const lokalizacjeJakoObiekt = (mapa) =>
  [...mapa.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([klucz, wiersze]) => {
      const [location, lat, lon] = klucz.split('|')
      return { location: Number(location), lat: Number(lat), lon: Number(lon), wiersze }
    })

/**
 * Doba pliku pyłu → średnie godzinowe. Wiersze: sensor_id;sensor_type;location;lat;lon;timestamp;P1;…;P2;…
 * (P1 = PM10, P2 = PM2,5). SPS30 publikuje pod swoim identyfikatorem dwa strumienie: pełne wiersze
 * (kolumna P4) i krótkie wiersze P1/P2 z jednej cyfrą po przecinku, które są innym czujnikiem
 * (SDS011) – bierzemy tylko pełne.
 * Wynik: godziny [[h, n, p1, p2, min2, max2, skoki], …] (n po usunięciu skoków), odrzucone odczyty i pozycje.
 */
export function agregujPylDnia(tekst, rok) {
  const linie = tekst.split('\n')
  const ix = kolumny(linie[0] ?? '')
  const wynik = { godziny: [], lokalizacje: [], wiersze: 0, poZakresie: 0 }
  if (ix.P1 === undefined || ix.P2 === undefined || ix.timestamp === undefined) return wynik
  const wGodzinie = new Map()
  const lokalizacje = new Map()
  for (let k = 1; k < linie.length; k++) {
    const linia = linie[k]
    if (!linia) continue
    const c = linia.replace(/\r$/, '').split(';')
    if (ix.P4 !== undefined && (c[ix.P4] ?? '') === '') continue
    wynik.wiersze++
    dodajLokalizacje(lokalizacje, c, ix)
    const p1 = Number.parseFloat(c[ix.P1])
    const p2 = Number.parseFloat(c[ix.P2])
    const h = indeksGodziny(c[ix.timestamp] ?? '', rok)
    if (h < 0) continue
    const poprawny =
      p1 >= 0 &&
      p1 < REGULY.maxOdczytu &&
      p2 >= 0 &&
      p2 < REGULY.maxOdczytu &&
      !(p1 === 0 && p2 === 0)
    if (!poprawny) {
      wynik.poZakresie++
      continue
    }
    const g = wGodzinie.get(h)
    if (g) {
      g.p1.push(p1)
      g.p2.push(p2)
    } else wGodzinie.set(h, { p1: [p1], p2: [p2] })
  }
  for (const [h, g] of [...wGodzinie.entries()].sort((a, b) => a[0] - b[0])) {
    const m1 = mediana(g.p1)
    const m2 = mediana(g.p2)
    const [k2, d2] = REGULY.skok.p2
    const [k1, d1] = REGULY.skok.p1
    const p1 = []
    const p2 = []
    for (let i = 0; i < g.p1.length; i++) {
      if (g.p2[i] > k2 * m2 + d2 || g.p1[i] > k1 * m1 + d1) continue
      p1.push(g.p1[i])
      p2.push(g.p2[i])
    }
    wynik.godziny.push([
      h,
      p2.length,
      p2.length ? zaokr(srednia(p1)) : 0,
      p2.length ? zaokr(srednia(p2)) : 0,
      p2.length ? Math.min(...p2) : 0,
      p2.length ? Math.max(...p2) : 0,
      g.p2.length - p2.length,
    ])
  }
  wynik.lokalizacje = lokalizacjeJakoObiekt(lokalizacje)
  return wynik
}

/**
 * Doba pliku wilgotności (BME280, SHT3x, DHT22…) → średnie godzinowe [[h, n, wilgotnosc], …].
 * Doba z zawieszonym czujnikiem (rozstęp odczytów < 0,5 p.p. przy ≥ 30 odczytach – np. DHT22
 * zapisujący całą dobę 84,9%) nie daje żadnych godzin: nie wiemy, jaka była wilgotność.
 */
export function agregujWilgotnoscDnia(tekst, rok) {
  const linie = tekst.split('\n')
  const ix = kolumny(linie[0] ?? '')
  const wynik = { godziny: [], lokalizacje: [], wiersze: 0, zawieszona: false }
  if (ix.humidity === undefined || ix.timestamp === undefined) return wynik
  const wGodzinie = new Map()
  const lokalizacje = new Map()
  let min = Infinity
  let max = -Infinity
  let n = 0
  for (let k = 1; k < linie.length; k++) {
    const linia = linie[k]
    if (!linia) continue
    const c = linia.replace(/\r$/, '').split(';')
    wynik.wiersze++
    dodajLokalizacje(lokalizacje, c, ix)
    const w = Number.parseFloat(c[ix.humidity])
    const h = indeksGodziny(c[ix.timestamp] ?? '', rok)
    if (h < 0 || !(w > 0 && w <= 100)) continue
    n++
    min = Math.min(min, w)
    max = Math.max(max, w)
    const lista = wGodzinie.get(h)
    if (lista) lista.push(w)
    else wGodzinie.set(h, [w])
  }
  wynik.lokalizacje = lokalizacjeJakoObiekt(lokalizacje)
  const z = REGULY.wilgotnoscZawieszona
  if (n >= z.minOdczytow && max - min < z.maxRozstep) {
    wynik.zawieszona = true
    return wynik
  }
  for (const [h, lista] of [...wGodzinie.entries()].sort((a, b) => a[0] - b[0]))
    wynik.godziny.push([h, lista.length, zaokr(srednia(lista))])
  return wynik
}

/** Pobiera dobowy plik czujnika. null = brak pliku (404), błąd sieci po kilku próbach rzuca. */
export async function pobierzTekstDnia(typ, id, dzien, { proby = 5 } = {}) {
  const url = `${ARCHIWUM}/${dzien.slice(0, 4)}/${dzien}/${dzien}_${typ.toLowerCase()}_sensor_${id}.csv.gz`
  for (let p = 1; ; p++) {
    try {
      const r = await fetch(url, {
        headers: { 'user-agent': USER_AGENT },
        signal: AbortSignal.timeout(60_000),
      })
      if (r.status === 404) return null
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return gunzipSync(Buffer.from(await r.arrayBuffer())).toString('utf8')
    } catch (e) {
      if (p >= proby) throw new Error(`${url}: ${e.cause?.code ?? e.message}`)
      await czekaj(500 * 2 ** (p - 1))
    }
  }
}

/** Równoległe wykonanie `fn` na elementach z limitem jednoczesnych zadań; wyniki w kolejności wejścia. */
export async function rownolegle(elementy, limit, fn) {
  const wyniki = new Array(elementy.length)
  let nastepny = 0
  async function robotnik() {
    for (;;) {
      const i = nastepny++
      if (i >= elementy.length) return
      wyniki[i] = await fn(elementy[i], i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, elementy.length) }, robotnik))
  return wyniki
}

const KATALOG = (rok) => join(CACHE, 'sensor-community', String(rok))

/**
 * Rok danych jednego czujnika (pył albo wilgotność): 365 plików dobowych → jeden plik w cache.
 * Zapis dopiero po przejściu wszystkich dób (404 = doba bez danych), więc przerwany bieg niczego
 * nie psuje, a drugi bieg nie pyta serwera o to, co już ma.
 */
export async function rocznikCzujnika({ rodzaj, typ, id, rok, limit = 8 }) {
  const plik = join(KATALOG(rok), `${rodzaj}_${typ.toLowerCase()}_${id}.json`)
  if (existsSync(plik)) {
    try {
      return JSON.parse(readFileSync(plik, 'utf8'))
    } catch {
      // przerwany zapis – pobieramy od nowa
    }
  }
  const dni = dniRoku(rok)
  const agreguj = rodzaj === 'pyl' ? agregujPylDnia : agregujWilgotnoscDnia
  const dobowe = await rownolegle(dni, limit, async (dzien) => {
    const tekst = await pobierzTekstDnia(typ, id, dzien)
    return tekst === null ? null : agreguj(tekst, rok)
  })
  const lokalizacje = new Map()
  const godziny = []
  const zawieszoneDni = []
  let dniZPlikiem = 0
  dobowe.forEach((d, i) => {
    if (!d) return
    dniZPlikiem++
    godziny.push(...d.godziny)
    if (d.zawieszona) zawieszoneDni.push(dni[i])
    for (const l of d.lokalizacje) {
      const klucz = `${l.location}|${l.lat}|${l.lon}`
      lokalizacje.set(klucz, (lokalizacje.get(klucz) ?? 0) + l.wiersze)
    }
  })
  const wynik = {
    rodzaj,
    typ,
    id,
    rok,
    pobrano: new Date().toISOString().slice(0, 10),
    dniZPlikiem,
    dniBezPliku: dni.length - dniZPlikiem,
    zawieszoneDni,
    lokalizacje: lokalizacjeJakoObiekt(lokalizacje),
    godziny,
  }
  mkdirSync(KATALOG(rok), { recursive: true })
  writeFileSync(plik, JSON.stringify(wynik))
  return wynik
}

// ---------------------------------------------------------------------------------------------
// Kontrola jakości – czyste funkcje na tablicach godzinowych (NaN = brak ważnej wartości).

/** Typowa liczba odczytów na godzinę: mediana po godzinach z danymi (częstotliwość raportowania czujnika). */
export function typowaLiczbaOdczytow(godziny) {
  return mediana(godziny.map((g) => g[1]))
}

/**
 * Najmniejsza liczba odczytów, od której godzina jest ważna: połowa typowej liczby odczytów
 * czujnika, ale w granicach od 1 do `maks`. Czujnik raportujący raz na godzinę (jeden odczyt
 * to już średnia godzinowa) nie może przegrywać z wymogiem trzech odczytów.
 */
export function minOdczytowDlaCzujnika(typowa, maks) {
  return Number.isFinite(typowa) ? Math.max(1, Math.min(maks, Math.ceil(typowa / 2))) : maks
}

/** Rocznik pyłu → tablice godzinowe PM10 i PM2,5; godziny zawieszone i za krótkie to NaN. */
export function godzinyPylu(rocznik) {
  const n = godzinWRoku(rocznik.rok)
  const minOdczytow = minOdczytowDlaCzujnika(
    typowaLiczbaOdczytow(rocznik.godziny),
    REGULY.minOdczytowWGodzinie,
  )
  const p1 = new Float64Array(n).fill(Number.NaN)
  const p2 = new Float64Array(n).fill(Number.NaN)
  const wynik = { p1, p2, zawieszone: 0, zaKrotkie: 0, skoki: 0, godzinZOdczytami: 0 }
  for (const [h, liczba, a, b, min2, max2, skoki] of rocznik.godziny) {
    wynik.godzinZOdczytami++
    wynik.skoki += skoki ?? 0
    if (liczba < minOdczytow) {
      wynik.zaKrotkie++
      continue
    }
    if (liczba >= REGULY.zawieszenieOdczytow && min2 === max2) {
      wynik.zawieszone++
      continue
    }
    p1[h] = a
    p2[h] = b
  }
  return wynik
}

/**
 * Godziny, w których PM2,5 przekracza PM10 ponad tolerancję: kanał PM10 (albo PM2,5) kłamie,
 * więc obie wartości godziny idą do kosza. Zwraca liczbę usuniętych godzin.
 */
export function usunNiespojne(p1, p2) {
  const { wzgledna, bezwzgledna } = REGULY.niespojnosc
  let usuniete = 0
  for (let h = 0; h < p1.length; h++) {
    if (Number.isNaN(p1[h]) || Number.isNaN(p2[h])) continue
    if (p2[h] > p1[h] + Math.max(bezwzgledna, wzgledna * p1[h])) {
      p1[h] = Number.NaN
      p2[h] = Number.NaN
      usuniete++
    }
  }
  return usuniete
}

/** Mediana po czujnikach dla każdej godziny; NaN, gdy ważnych wartości jest mniej niż `min`. */
export function medianyGodzinowe(tablice, min = REGULY.odstajaca.minCzujnikow) {
  const n = tablice[0]?.length ?? 0
  const wynik = new Float64Array(n).fill(Number.NaN)
  for (let h = 0; h < n; h++) {
    const w = []
    for (const t of tablice) if (!Number.isNaN(t[h])) w.push(t[h])
    if (w.length >= min) wynik[h] = mediana(w)
  }
  return wynik
}

/**
 * Godziny odstające względem mediany pozostałych czujników: bardzo wysokie (> 4× mediana + 30)
 * albo bardzo niskie przy wysokiej medianie (< mediana / 5, gdy mediana > 20). Zeruje je w
 * `wartosci` i zwraca ich liczbę. `mediany` liczy się z wszystkich czujników razem, więc jeden
 * odstający czujnik prawie nie przesuwa mediany.
 */
export function usunOdstajace(wartosci, mediany) {
  const { mnoznik, dodatek, dolny, medianaDlaDolnego } = REGULY.odstajaca
  let usuniete = 0
  for (let h = 0; h < wartosci.length; h++) {
    const v = wartosci[h]
    const m = mediany[h]
    if (Number.isNaN(v) || Number.isNaN(m)) continue
    if (v > mnoznik * m + dodatek || (m > medianaDlaDolnego && v < m / dolny)) {
      wartosci[h] = Number.NaN
      usuniete++
    }
  }
  return usuniete
}

/**
 * Wilgotność godzinowa lokalizacji z jednego lub kilku czujników: średnia z czujników, które
 * mają w tej godzinie wystarczająco odczytów i nie są zawieszone w tej dobie (doba zawieszona
 * nie wnosi godzin już na etapie agregacji).
 */
export function godzinyWilgotnosci(roczniki, rok) {
  const n = godzinWRoku(rok)
  const suma = new Float64Array(n)
  const ile = new Uint8Array(n)
  for (const r of roczniki) {
    const minOdczytow = minOdczytowDlaCzujnika(
      typowaLiczbaOdczytow(r.godziny),
      REGULY.minOdczytowWilgotnosciWGodzinie,
    )
    for (const [h, liczba, w] of r.godziny) {
      if (liczba < minOdczytow) continue
      suma[h] += w
      ile[h]++
    }
  }
  const wynik = new Float64Array(n).fill(Number.NaN)
  for (let h = 0; h < n; h++) if (ile[h]) wynik[h] = suma[h] / ile[h]
  return wynik
}

/** Kopia tablicy z NaN tam, gdzie wilgotność przekracza próg albo jest nieznana. */
export function tylkoSuche(wartosci, wilgotnosc, prog = REGULY.progWilgotnosci) {
  const wynik = new Float64Array(wartosci.length).fill(Number.NaN)
  for (let h = 0; h < wartosci.length; h++)
    if (!Number.isNaN(wartosci[h]) && !Number.isNaN(wilgotnosc[h]) && wilgotnosc[h] <= prog)
      wynik[h] = wartosci[h]
  return wynik
}

/**
 * Średnia roczna jako średnia ze średnich miesięcznych (każdy miesiąc liczy się tak samo, więc
 * luka w jednym sezonie nie przesuwa wyniku tak, jak przy średniej ze wszystkich godzin).
 * Do roku wchodzą miesiące z co najmniej `minGodzin` ważnych godzin; potrzeba `minMiesiecy` takich miesięcy.
 */
export function sredniaRoczna(wartosci, rok, { minGodzin, minMiesiecy = REGULY.minMiesiecy }) {
  const mies = miesiaceGodzin(rok)
  const suma = new Float64Array(12)
  const ile = new Uint16Array(12)
  let godziny = 0
  for (let h = 0; h < wartosci.length; h++) {
    if (Number.isNaN(wartosci[h])) continue
    suma[mies[h]] += wartosci[h]
    ile[mies[h]]++
    godziny++
  }
  const miesieczne = []
  for (let m = 0; m < 12; m++)
    if (ile[m] >= minGodzin)
      miesieczne.push({ miesiac: m + 1, godziny: ile[m], srednia: suma[m] / ile[m] })
  return {
    srednia: miesieczne.length >= minMiesiecy ? srednia(miesieczne.map((x) => x.srednia)) : null,
    godziny,
    miesiace: miesieczne.length,
    miesieczne,
  }
}

/** Liczba ważnych (nie-NaN) godzin. */
export const ileWaznych = (t) => t.reduce((s, v) => s + (Number.isNaN(v) ? 0 : 1), 0)

const RAD = Math.PI / 180
export function odlegloscM(lat1, lon1, lat2, lon2) {
  const dLat = (lat2 - lat1) * RAD
  const dLon = (lon2 - lon1) * RAD
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(dLon / 2) ** 2
  return 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(a)))
}

/**
 * Pozycja czujnika w roku: najczęstsza lokalizacja i informacja, czy czujnik się nie przemieszczał
 * (inna pozycja o ≥ 10% odczytów albo dalej niż 250 m od dominującej = przeniesiony).
 */
export function pozycjaCzujnika(lokalizacje) {
  if (!lokalizacje.length) return { pozycja: null, stala: false }
  const razem = lokalizacje.reduce((s, l) => s + l.wiersze, 0)
  const [glowna, ...inne] = lokalizacje
  const udzial = glowna.wiersze / razem
  const przeniesiony = inne.some(
    (l) =>
      l.wiersze / razem >= 1 - REGULY.minUdzialLokalizacji &&
      odlegloscM(glowna.lat, glowna.lon, l.lat, l.lon) > REGULY.maxPrzesuniecieM,
  )
  return {
    pozycja: { location: glowna.location, lat: glowna.lat, lon: glowna.lon },
    udzial,
    stala: udzial >= REGULY.minUdzialLokalizacji && !przeniesiony,
  }
}

/**
 * Ocena czujników: kontrola jakości godzin → średnie roczne („wszystkie godziny” i „suche”, czyli
 * z godzin o wilgotności ≤ 80%) → decyzja, czy czujnik wchodzi do tabeli.
 * Wejście: { id, typ, location, pyl: rocznik pyłu, wilgotnosc: [roczniki wilgotności] }.
 * Mediany po czujnikach (reguła odstających) liczone ze wszystkich czujników wejścia.
 */
export function ocenCzujniki(czujniki, rok) {
  const wstepne = czujniki.map((c) => {
    const g = godzinyPylu(c.pyl)
    const przed = ileWaznych(g.p2)
    const niespojne = usunNiespojne(g.p1, g.p2)
    return { c, g, przed, niespojne }
  })
  const med1 = medianyGodzinowe(wstepne.map((w) => w.g.p1))
  const med2 = medianyGodzinowe(wstepne.map((w) => w.g.p2))
  const godzinRoku = godzinWRoku(rok)
  return wstepne.map(({ c, g, przed, niespojne }) => {
    const odstajace2 = usunOdstajace(g.p2, med2)
    const odstajace1 = usunOdstajace(g.p1, med1)
    const wilgotnosc = c.wilgotnosc.length ? godzinyWilgotnosci(c.wilgotnosc, rok) : null
    const policz = (p, odstajace) => {
      const wszystkie = sredniaRoczna(p, rok, { minGodzin: REGULY.minGodzinWMiesiacu })
      const suche = wilgotnosc
        ? sredniaRoczna(tylkoSuche(p, wilgotnosc), rok, {
            minGodzin: REGULY.minGodzinSuchychWMiesiacu,
          })
        : null
      return {
        wszystkie: wszystkie.srednia,
        suche: suche?.srednia ?? null,
        godzinWszystkich: wszystkie.godziny,
        godzinSuchych: suche?.godziny ?? 0,
        miesiace: wszystkie.miesiace,
        miesiaceSuche: suche?.miesiace ?? 0,
        odstajace,
      }
    }
    const pm25 = policz(g.p2, odstajace2)
    const pm10 = policz(g.p1, odstajace1)
    const pokrycie = ileWaznych(g.p2) / godzinRoku
    let wilgotnych = 0
    let bezPomiaru = 0
    let sumaWilgotnosci = 0
    let zPomiarem = 0
    if (wilgotnosc)
      for (let h = 0; h < godzinRoku; h++) {
        if (Number.isNaN(g.p2[h])) continue
        if (Number.isNaN(wilgotnosc[h])) {
          bezPomiaru++
          continue
        }
        zPomiarem++
        sumaWilgotnosci += wilgotnosc[h]
        if (wilgotnosc[h] > REGULY.progWilgotnosci) wilgotnych++
      }
    const pozycja = pozycjaCzujnika(c.pyl.lokalizacje)
    const udzial = (czesc, calosc) => (calosc ? czesc / calosc : 0)
    const powody = []
    if (!pozycja.stala) powody.push('niestabilna lub zmieniona lokalizacja w ciągu roku')
    if (pokrycie < REGULY.minPokrycie)
      powody.push(`pokrycie godzin ${Math.round(100 * pokrycie)}% < ${100 * REGULY.minPokrycie}%`)
    if (pm25.miesiace < REGULY.minMiesiecy)
      powody.push(`dane (≥ ${REGULY.minGodzinWMiesiacu} h) w ${pm25.miesiace} z 12 miesięcy`)
    if (udzial(odstajace2, przed) > REGULY.maxUdzialOdstajacych)
      powody.push(`odstające godziny w ${Math.round(100 * udzial(odstajace2, przed))}% pomiarów`)
    if (udzial(g.zawieszone, g.godzinZOdczytami) > REGULY.maxUdzialZawieszonych)
      powody.push(
        `zawieszone odczyty w ${Math.round(100 * udzial(g.zawieszone, g.godzinZOdczytami))}% godzin`,
      )
    if (udzial(niespojne, przed) > REGULY.maxUdzialNiespojnych)
      powody.push(`PM2,5 większe od PM10 w ${Math.round(100 * udzial(niespojne, przed))}% godzin`)
    return {
      id: c.id,
      typ: c.typ,
      location: c.location,
      przyjety: powody.length === 0,
      powody,
      pozycja: pozycja.pozycja,
      pokrycie,
      godzinWaznych: ileWaznych(g.p2),
      usuniete: {
        odstajace: odstajace2,
        zawieszone: g.zawieszone,
        niespojne,
        skoki: g.skoki,
        zaKrotkie: g.zaKrotkie,
      },
      wilgotnosc: wilgotnosc
        ? {
            godzinWilgotnych: wilgotnych,
            godzinBezPomiaru: bezPomiaru,
            godzinSuchych: pm25.godzinSuchych,
            srednia: zPomiarem ? sumaWilgotnosci / zPomiarem : null,
          }
        : null,
      pm25,
      pm10,
    }
  })
}

/**
 * Wartość modelu w punkcie czujnika: średnia z adresów w promieniu 100 m (jeśli brak, 250 m).
 * Czujnik nie stoi na adresie, a pozycje bywają zaokrąglone do ok. 100 m, więc średnia z sąsiedztwa
 * jest uczciwsza niż wartość jednego najbliższego adresu. `indeks` = KDBush po współrzędnych
 * `adresyXY` (metry), `wartosci` – wartość wskaźnika (null = brak) dla każdego adresu.
 * `najblizszy` to numer najbliższego adresu (do nazwy dzielnicy i gminy), niezależnie od jego wartości.
 */
export function modelPrzyPunkcie(x, y, adresyXY, indeks, wartosci, promienie = [100, 250]) {
  for (const promien of promienie) {
    let suma = 0
    let n = 0
    let najblizszy = -1
    let odleglosc = Infinity
    for (const i of indeks.within(x, y, promien)) {
      const d = Math.hypot(adresyXY[i][0] - x, adresyXY[i][1] - y)
      if (d < odleglosc) {
        odleglosc = d
        najblizszy = i
      }
      if (wartosci[i] !== null) {
        suma += wartosci[i]
        n++
      }
    }
    if (n)
      return {
        wartosc: suma / n,
        adresow: n,
        promien,
        najblizszy,
        odlegloscM: Math.round(odleglosc),
      }
  }
  return null
}

// ---------------------------------------------------------------------------------------------
// Statystyki zgodności model–czujnik.

export function pearson(x, y) {
  const n = x.length
  if (n < 5) return null
  const mx = srednia(x)
  const my = srednia(y)
  let sxy = 0
  let sxx = 0
  let syy = 0
  for (let i = 0; i < n; i++) {
    sxy += (x[i] - mx) * (y[i] - my)
    sxx += (x[i] - mx) ** 2
    syy += (y[i] - my) ** 2
  }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : null
}

export const GRUPY = ['Kraków', 'obwarzanek']

/**
 * Podsumowanie zgodności dla PM2,5 i PM10: osobno Kraków, obwarzanek i razem; średnia czujnika
 * „suche” (wilgotność ≤ 80%) i „wszystkie” (bez filtra wilgotności); model „adres” (z doprecyzowaniem)
 * i „oczko” (surowa wartość GIOŚ). Wiersz: { grupa, pm25|pm10: { model, modelOczko, czujnik: { suche, wszystkie } } }.
 */
export function podsumuj(wiersze) {
  const wynik = {}
  for (const [klucz, pole] of [
    ['PM2.5', 'pm25'],
    ['PM10', 'pm10'],
  ]) {
    wynik[klucz] = {}
    for (const grupa of [...GRUPY, 'razem']) {
      const w = wiersze.filter((x) => grupa === 'razem' || x.grupa === grupa)
      const blok = { czujnikow: w.length }
      for (const miara of ['suche', 'wszystkie']) {
        const dla = w.filter((x) => x[pole].czujnik[miara] !== null)
        const pary = (wariant) =>
          dla
            .filter((x) => x[pole][wariant] !== null)
            .map((x) => ({ model: x[pole][wariant], czujnik: x[pole].czujnik[miara] }))
        blok[miara] = {
          adres: statystykiZgodnosci(pary('model')),
          oczko: statystykiZgodnosci(pary('modelOczko')),
        }
      }
      wynik[klucz][grupa] = blok
    }
  }
  return wynik
}

const pl = (v, miejsca = 1) => v.toFixed(miejsca).replace('.', ',').replace('-', '−')

/**
 * Zdania z liczbami dla strony metody – same fakty z `podsumuj` i tabeli, bez wniosków, które
 * zależałyby od tego, jak wyjdą liczby. Kraków osobno dla średniej z wszystkich godzin i „suche”.
 * `wiersze` służą do podania rozrzutu wilgotności między stanowiskami.
 */
export function zdaniaWyniku(podsumowanie, wiersze) {
  const zdania = []
  for (const [klucz, nazwa] of [
    ['PM2.5', 'PM2,5'],
    ['PM10', 'PM10'],
  ])
    for (const [miara, opis] of [
      ['wszystkie', 'średnie z wszystkich godzin'],
      ['suche', 'średnie z godzin o wilgotności do 80%'],
    ]) {
      const s = podsumowanie[klucz].Kraków[miara].adres
      if (!s.n) continue
      const korelacja =
        s.korelacja === null ? 'nieliczona (poniżej 5 czujników)' : pl(s.korelacja, 2)
      zdania.push(
        `${nazwa}, Kraków, ${opis}, ${s.n} czujników: model ${pl(s.sredniaModelu)} µg/m³, średnia czujników ${pl(s.sredniaCzujnikow)} µg/m³ (pojedyncze czujniki od ${pl(s.zakresCzujnikow[0])} do ${pl(s.zakresCzujnikow[1])}), mediana stosunku czujnik/model ${pl(s.medianaStosunku, 2)}, średni błąd bezwzględny ${pl(s.mae)} µg/m³, korelacja model–czujnik ${korelacja}.`,
      )
    }
  const wilgotnosci = wiersze.filter((w) => w.wilgotnosc?.srednia != null)
  if (wilgotnosci.length) {
    const sr = wilgotnosci.map((w) => w.wilgotnosc.srednia)
    const udzialy = wilgotnosci.map(
      (w) =>
        (100 * w.wilgotnosc.godzinWilgotnych) /
        (w.wilgotnosc.godzinWilgotnych + w.wilgotnosc.godzinSuchych),
    )
    zdania.push(
      `Wilgotność zmierzona przy czujnikach pyłu (${wilgotnosci.length} stanowisk): średnia roczna od ${pl(Math.min(...sr), 0)}% do ${pl(Math.max(...sr), 0)}%, udział godzin powyżej ${REGULY.progWilgotnosci}% od ${pl(Math.min(...udzialy), 0)}% do ${pl(Math.max(...udzialy), 0)}%.`,
    )
  }
  return zdania
}

/**
 * Zgodność modelu z czujnikami: pary { model, czujnik } w µg/m³. Różnica = model − czujnik
 * (dodatnia: model wyższy). Udziały „w ±25%” i „w ±50%” liczone względem wartości czujnika.
 */
export function statystykiZgodnosci(pary) {
  const n = pary.length
  if (!n) return { n: 0 }
  const roznice = pary.map((p) => p.model - p.czujnik)
  const wzgledne = pary.map((p) => Math.abs(p.model - p.czujnik) / p.czujnik)
  const stosunki = pary.filter((p) => p.model > 0).map((p) => p.czujnik / p.model)
  const czujniki = pary.map((p) => p.czujnik)
  return {
    n,
    sredniaModelu: zaokr(srednia(pary.map((p) => p.model))),
    sredniaCzujnikow: zaokr(srednia(czujniki)),
    zakresCzujnikow: [zaokr(Math.min(...czujniki)), zaokr(Math.max(...czujniki))],
    medianaStosunku: stosunki.length ? zaokr(mediana(stosunki)) : null,
    medianaRoznicy: zaokr(mediana(roznice)),
    sredniaRoznica: zaokr(srednia(roznice)),
    mae: zaokr(srednia(roznice.map(Math.abs))),
    rmse: zaokr(Math.sqrt(srednia(roznice.map((r) => r * r)))),
    maeProc: zaokr(100 * srednia(wzgledne), 1),
    korelacja: (() => {
      const r = pearson(
        pary.map((p) => p.model),
        pary.map((p) => p.czujnik),
      )
      return r === null ? null : zaokr(r)
    })(),
    udzialW25: zaokr(wzgledne.filter((w) => w <= 0.25).length / n, 2),
    udzialW50: zaokr(wzgledne.filter((w) => w <= 0.5).length / n, 2),
  }
}
