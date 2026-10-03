// Pozwolenia na budowę wokół adresów w obwarzanku Krakowa → wskaźnik `inwestycje_500m_obwarzanek`.
//
// Odpowiednik `inwestycje_500m` (etl/pozwolenia.mjs, MSIP) dla 13 gmin obwarzanka. MSIP obejmuje
// tylko Kraków, więc tu źródłem jest ogólnopolski rejestr GUNB.
//
// Źródło decyzji: Główny Urząd Nadzoru Budowlanego, Rejestr Wniosków, Decyzji i Zgłoszeń
//   w sprawach budowlanych (RWDZ), województwo małopolskie – dane.gov.pl, zbiór 3467, zasób 2716739
//   (CSV w zipie, licencja CC0 1.0, aktualizacja co tydzień). Jeden wiersz = decyzja × działka.
//   Rejestr NIE ma współrzędnych, a pola inwestora i projektanta (dane osobowe) pomijamy już
//   przy odczycie – do żadnego pliku wynikowego nie trafiają.
// Położenie: identyfikator działki (jednostka ewidencyjna + obręb + numer) → geometria z ULDK GUGiK
//   (etl/lib/uldk.mjs). Decyzja dostaje jeden punkt: środek ciężkości jej działek ważony polem –
//   tak samo, jak MSIP-owy `pozwolenia.mjs` liczy środek działki decyzji.
//
// Definicja ta sama co w `inwestycje_500m` (żeby Kraków i gminy były porównywalne):
//   decyzje wydane od 2025-01-01 do daty danych, zakres budowa / rozbudowa / nadbudowa (jak
//   `zakr_inw` w MSIP; „roboty inne" tylko gdy opis zaczyna się od budowa|rozbudowa|nadbudowa),
//   bez sieci, instalacji, dróg i innej infrastruktury oraz bez dostawek wind, dźwigów i balkonów.
//   Wartość: liczba takich decyzji, których punkt leży do 500 m od adresu (EPSG:2180, odległość
//   płaska, błąd skali poniżej 0,1%).
// Różnice względem MSIP (większość wynika z pól RWDZ, nie z wyboru):
//   – RWDZ nie podaje rodzaju rozstrzygnięcia; w pliku są decyzje o pozwoleniu na budowę (symbol
//     sprawy 6740), bez odmów i umorzeń widocznych w MSIP;
//   – „infrastrukturę" rozpoznajemy po opisie inwestycji (pierwszy wymieniony obiekt: budynek czy
//     instalacja/droga/sieć…), a przy braku rozstrzygnięcia po kategorii obiektu i rodzaju inwestycji;
//   – zmiany wcześniejszych decyzji („Zmiana decyzji nr …") odrzucamy: to nie nowe pozwolenia, a
//     filtr MSIP przepuszcza część z nich (78 z 1423 decyzji), bo ma ustawiony zakres budowy;
//   – rejestr bywa niespójny (zakres „rozbudowa" przy opisie „Przebudowa i remont…" albo
//     „Rozbiórka…"), więc rozbudowa i nadbudowa wymagają w opisie słowa budowa, rozbudowa,
//     nadbudowa lub dobudowa;
//   – decyzje bez ustalonego położenia (działka nieznana w ULDK po rozdzieleniu lub scaleniu) oraz
//     z działkami dalej niż 2 km od siebie są pomijane, więc wartości mogą być lekko
//     niedoszacowane; liczbę wypisujemy przy każdym biegu.
// Kontrola spójności wypisywana przy każdym biegu: ta sama metoda dla adresów Krakowa vs
//   `inwestycje_500m` (stosunek średnich i korelacja); korelacja poniżej 0,5 przerywa bieg.
//
// Zasięg: liczą się decyzje z 13 gmin obwarzanka, z Krakowa (jednostki RWDZ 126102–126105) i z gmin
//   dotykających bufora 600 m wokół tego obszaru (sprawdzone w ULDK `GetCommuneByXY`, 2026-10-03),
//   żeby okrąg 500 m przy granicy nie ucinał sąsiednich inwestycji.
// `null` dla adresów w Krakowie – tam obowiązuje `inwestycje_500m` z MSIP.
//
// Uruchom: node etl/pozwolenia-obwarzanek.mjs
//   (zip RWDZ i geometrie działek trafiają do etl/.cache; drugi bieg ich używa,
//    --bez-pobierania = tryb suchy: tylko cache, nic nie zapisuje)

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { DuckDBInstance } from '@duckdb/node-api'
import { unzipSync } from 'fflate'
import { do2180 } from './lib/geo.mjs'
import { pobierzTrwale } from './lib/pobieranie.mjs'
import { indeksPunktow, sumaWPromieniu } from './lib/przestrzen.mjs'
import { parsujWkt, pobierzDzialki, srodekIPole } from './lib/uldk.mjs'
import { CACHE, DANE, dzis, wczytajAdresy, zapiszWskaznik } from './lib/wspolne.mjs'

export const OKNO_OD = '2025-01-01'
export const PROMIEN = 500
const TERYT_KRAKOW = '1261011'
const ZASOB = 2716739
const URL_POBRANIA = `https://api.dane.gov.pl/resources/${ZASOB},wnioski-i-decyzje-w-sprawach-budowlanych-wojewodztwo-maopolskie/file`
const URL_METADANYCH = `https://api.dane.gov.pl/1.4/resources/${ZASOB}`
const URL_ZBIORU = 'https://dane.gov.pl/pl/dataset/3467'
const URL_ULDK = 'https://uldk.gugik.gov.pl/'
const PLIK_CSV = join(CACHE, 'gunb-malopolskie.csv')
const PLIK_ULDK = join(CACHE, 'gunb-dzialki-uldk.jsonl')

// Jednostki ewidencyjne Krakowa w RWDZ (cztery, nie 126101): Śródmieście, Krowodrza, Nowa Huta, Podgórze.
export const JEDNOSTKI_KRAKOWA = ['126102', '126103', '126104', '126105']
// Gminy dotykające bufora 600 m wokół Krakowa i 13 gmin (kody TERYT bez ostatniej cyfry).
export const SASIEDZI = [
  '120601', // Czernichów
  '120603', // Iwanowice
  '120604', // Jerzmanowice-Przeginia
  '120606', // Krzeszowice
  '120610', // Skała
  '120612', // Słomniki
  '121901', // Biskupice
  '121902', // Gdów
  '121903', // Kłaj
  '121403', // Nowe Brzesko
  '121405', // Proszowice
  '121406', // Radziemice
  '120901', // Dobczyce
  '120903', // Myślenice
  '120906', // Siepraw
  '120907', // Sułkowice
  '120103', // Drwinia
  '121802', // Brzeźnica
  '121803', // Kalwaria Zebrzydowska
  '121804', // Lanckorona
]

// ---------------------------------------------------------------------------------------------
// Rozpoznawanie decyzji (czyste funkcje, objęte testem)

const ZAKRESY = new Map([
  ['budowa nowego/nowych obiektów budowlanych', 'budowa'],
  ['rozbudowa istniejącego/istniejących obiektów budowlanych', 'rozbudowa'],
  ['nadbudowa istniejącego/istniejących obiektów budowlanych', 'nadbudowa'],
])
const ROBOTY_INNE = 'wykonanie robót budowlanych innych niż wymienione powyżej'
// Ten sam wzorzec co w pozwolenia.mjs: zakres z początku opisu (po ewentualnym „ul. X – ").
const ZAKRES_Z_OPISU = /^[\s?"„]*(?:ul\.[^-–]*[-–]\s*)?(budowa|rozbudowa|nadbudowa)/i

/** Zakres decyzji: budowa | rozbudowa | nadbudowa, albo null (przebudowa, rozbiórka, odbudowa…). */
export function zakresDecyzji({ zakres, opis }) {
  const z = ZAKRESY.get(zakres ?? '')
  if (z) return z
  if (zakres && zakres !== ROBOTY_INNE) return null
  const s = (opis ?? '').match(ZAKRES_Z_OPISU)
  return s ? s[1].toLowerCase() : null
}

// `\b` w JS nie zna polskich liter, więc granicę słowa budujemy z klas Unicode.
const OD_SLOWA = '(?<![\\p{L}\\p{N}])'
const DO_SLOWA = '(?![\\p{L}\\p{N}])'
const wzor = (rdzenie) => new RegExp(`${OD_SLOWA}(?:${rdzenie.join('|')})`, 'iu')

// Obiekt kubaturowy lub obiekt, który zmienia zabudowę wokół adresu. Rdzenie obejmują mianownik
// i dopełniacz („budynek", „budynku"), bo opisy bywają zapisane jak nazwa: „Budynek mieszkalny…".
const OBIEKT = wzor([
  'budynek',
  'budynk',
  'dom(?:u|ów|y|ek|ki|em|ach|kiem)?' + DO_SLOWA,
  'hal(?:a|ę|i|y|ą|e|ach)' + DO_SLOWA,
  'garaż',
  'wiat(?:a|ę|y|ą|ach)' + DO_SLOWA,
  'pawilon',
  'kiosk',
  'stajn',
  'obor(?:a|ę|y|ą)' + DO_SLOWA,
  'stodoł',
  'szop(?:a|ę|y|ą)' + DO_SLOWA,
  'magazyn',
  'przedszkol',
  'szko[łl]',
  'żłob',
  'kości[óo]ł',
  'kaplic',
  'remiz',
  'świetlic',
  'hotel',
  'pensjonat',
  'motel',
  'apartamentow',
  'stacj\\p{L}* paliw',
  'zespoł\\p{L}* (?:usługow|biurow|magazynow|handlow|mieszkaln|zabudow)',
  'obiekt\\p{L}* (?:handlow|usługow|biurow|magazynow|produkcyjn|przemysłow|sportow|kubaturow|gastronomi|oświat|kultur)',
  'boisk',
  'kort(?:y|ów|u)?' + DO_SLOWA,
  'stadion',
  'trybun',
  'skatepark',
  'pumptrack',
  'plac(?:u)? zabaw',
])
// Infrastruktura: sieci, instalacje, drogi, mury, zbiorniki – MSIP-owe „Infrastruktura …" i reklamy.
const INFRASTRUKTURA = wzor([
  'instalacj',
  'sie(?:ć|ci)' + DO_SLOWA,
  'sieciow',
  'przyłącz',
  'kanalizacj',
  'wodoci',
  'gazoci',
  'rurociąg',
  'lini(?:a|i|ę|e)' + DO_SLOWA,
  'oświetlen',
  'drog',
  'zjazd',
  'chodnik',
  'ścieżk',
  'parking',
  'plac(?:u)?(?! zabaw)' + DO_SLOWA,
  'mur(?:u|y|ów|ek|ki|em)?' + DO_SLOWA,
  'ogrodzeni',
  'taras',
  'schod',
  'ścian\\p{L}* oporow',
  'zbiornik',
  'oczyszczaln',
  'studni',
  'przepust',
  'most(?:u|y|ów)?' + DO_SLOWA,
  'kładk',
  'fotowolt',
  'stacj\\p{L}* (?:transformator|bazow|uzdatni|redukcyjn|pomiarow)',
  'maszt',
  'wież(?:a|y|ę)' + DO_SLOWA,
  'silos',
  'słup',
  'komor',
  'pompown',
  'hydrant',
  'rów(?:u|y|ów)?' + DO_SLOWA,
  'nawierzch',
  'utwardzeni',
  'zagospodarowani',
  'reklam',
  'tablic',
  'nośnik',
  'pylon',
])
// Kategorie obiektów budowlanych z załącznika do Prawa budowlanego, które są budynkami:
// I–III (jednorodzinne, rolnicze, niewielkie), IX–XVIII (kultura, kult, zdrowie, administracja,
// mieszkalne, zakwaterowanie, sport, biura, handel i usługi, przemysł).
const KATEGORIE_BUDYNKOW = new Set([
  'I',
  'II',
  'III',
  'IX',
  'X',
  'XI',
  'XII',
  'XIII',
  'XIV',
  'XV',
  'XVI',
  'XVII',
  'XVIII',
])
const DOM_JEDNORODZINNY = 'Budynek mieszkalny jednorodzinny'
// Zmiana wcześniejszej decyzji („Zmiana decyzji nr … z dnia …", w tym z literówkami): to nie jest
// nowe pozwolenie, a pierwotna decyzja bywa sprzed lat albo też mieści się w oknie – liczylibyśmy
// jedną inwestycję dwa razy. Zakres „bez przeniesień decyzji" z definicji MSIP idzie tą samą logiką.
const ZMIANA_DECYZJI = /^[\s"„]*zmian\p{L}*[^.]{0,40}?(?:decyz|deyz|pozwolen)/iu
// Windy, dźwigi i balkony: jak w MSIP, dostawka do istniejącego budynku nie zmienia zabudowy.
const WINDY_BALKONY = wzor([
  'wind(?:a|ę|y|ą|zie|ach|ami)?' + DO_SLOWA,
  'window',
  'dźwig',
  'balkon',
  'loggi',
])
// Rejestr bywa niespójny: zakres „rozbudowa" przy opisie „Przebudowa i remont…" albo „Rozbiórka…".
// Nowa zabudowa to opis ze słowem budowa, rozbudowa, nadbudowa lub dobudowa (nie „przebudowa").
const BUDOWA_W_OPISIE = /(?<![\p{L}])(?:roz|nad|do)?budow(?:a|ę|y|ie|ą)(?![\p{L}])/iu
const ROZBIORKA = /^[\s"„]*rozbiórk/iu

/**
 * Początek opisu, który nazywa przedmiot decyzji: bez ogona „wraz z instalacjami…", który jest
 * w prawie każdym opisie domu („Budynek mieszkalny z instalacjami…" to budynek, a nie instalacja).
 */
export function naglowekOpisu(opis) {
  const t = (opis ?? '').replace(/\s+/g, ' ').trim()
  const ogon = t.search(/ (?:wraz|oraz|z|ze|na dz|na działce|w m\.|w miejscowości) |[,;:(]/iu)
  return ogon > 0 ? t.slice(0, ogon) : t
}

/** Pierwszy wymieniony w nagłówku opisu obiekt: 'obiekt' | 'infrastruktura' | null (brak rozstrzygnięcia). */
export function pierwszyObiekt(opis) {
  const t = naglowekOpisu(opis)
  const o = OBIEKT.exec(t)
  const i = INFRASTRUKTURA.exec(t)
  if (o && (!i || o.index <= i.index)) return 'obiekt'
  if (i) return 'infrastruktura'
  return null
}

/**
 * Czy decyzja dotyczy obiektu, który zmienia zabudowę (a nie sieci, drogi, instalacji…).
 * Opis rozstrzyga pierwszy wymieniony obiekt („Budowa instalacji gazowej w budynku" to instalacja);
 * gdy opis nic nie mówi, decydują kategoria obiektu i rodzaj inwestycji z rejestru.
 */
export function czyBudynek({ opis, kategoria, rodzaj }) {
  const p = pierwszyObiekt(opis)
  if (p) return p === 'obiekt'
  return rodzaj === DOM_JEDNORODZINNY || KATEGORIE_BUDYNKOW.has(kategoria ?? '')
}

/** Czy decyzja wchodzi do liczenia (okno dat, zakres, obiekt). `w.data` to RRRR-MM-DD. */
export function czyLiczona(w) {
  if (!(w.data >= OKNO_OD)) return false
  const zakres = zakresDecyzji(w)
  if (!zakres) return false
  const opis = w.opis ?? ''
  if (ZMIANA_DECYZJI.test(opis)) return false
  if (!czyBudynek(w)) return false
  // Winda, dźwig albo balkon jako przedmiot decyzji wyklucza zawsze; wzmianka o windzie na końcu
  // opisu nowego budynku („budynek wielorodzinny z windami") nie wyklucza, przy rozbudowie tak.
  if (WINDY_BALKONY.test(naglowekOpisu(opis))) return false
  if (zakres !== 'budowa' && WINDY_BALKONY.test(opis)) return false
  if (ROZBIORKA.test(opis) && !BUDOWA_W_OPISIE.test(opis)) return false
  if (zakres !== 'budowa' && !BUDOWA_W_OPISIE.test(opis)) return false
  return true
}

/** Identyfikator działki dla ULDK: WWPPGG_R.OOOO.NR (null, gdy któryś człon ma zły kształt). */
export function idDzialki({ jednostka, obreb, dzialka }) {
  const nr = (dzialka ?? '').trim()
  if (!/^\d{6}_\d$/.test(jednostka ?? '') || !/^\d{4}$/.test(obreb ?? '')) return null
  if (!/^[\p{L}\p{N}/.-]+$/u.test(nr)) return null
  return `${jednostka}.${obreb}.${nr}`
}

/**
 * Identyfikatory zastępcze dla działki, której ULDK nie zna (podzielona, scalona, przenumerowana
 * po wydaniu decyzji): ta sama działka z arkuszem mapy, potem sąsiednie podnumery, potem działka
 * macierzysta. To kilkadziesiąt metrów od właściwej, więc nie psuje promienia 500 m.
 */
export function kandydaciZastepczy(id, arkusz) {
  const i = id.lastIndexOf('.') + 1
  const pre = id.slice(0, i)
  const nr = id.slice(i)
  const wynik = []
  if (arkusz && /^\d{1,3}$/.test(arkusz)) wynik.push(`${pre}AR_${arkusz}.${nr}`)
  const [glowny, pod] = nr.split('/')
  if (/^\d+$/.test(glowny ?? '')) {
    if (pod === undefined) {
      for (const k of [1, 2, 3]) wynik.push(`${pre}${glowny}/${k}`)
    } else if (/^\d+$/.test(pod)) {
      const m = Number(pod)
      for (const k of [m - 1, m + 1, m - 2, m + 2]) if (k >= 1) wynik.push(`${pre}${glowny}/${k}`)
      wynik.push(`${pre}${glowny}`)
    }
  }
  return [...new Set(wynik)].filter((x) => x !== id)
}

/** Wiersze CSV (decyzja × działka) → decyzje z listą działek; powtórzone wiersze scala. */
export function zbierzDecyzje(wiersze) {
  const decyzje = new Map()
  for (const w of wiersze) {
    let d = decyzje.get(w.nr)
    if (!d) {
      d = {
        nr: w.nr,
        data: w.data,
        zakres: w.zakres,
        kategoria: w.kategoria,
        rodzaj: w.rodzaj,
        opis: w.opis,
        jednostki: new Set(),
        dzialki: new Map(),
      }
      decyzje.set(w.nr, d)
    }
    d.jednostki.add(w.jednostka.slice(0, 6))
    const id = idDzialki(w)
    if (id && !d.dzialki.has(id)) d.dzialki.set(id, w.arkusz ?? null)
  }
  return decyzje
}

// ---------------------------------------------------------------------------------------------
// Położenie decyzji

// Działki jednej decyzji oddalone od siebie o ponad 2 km (w danych: kilka na 2 395 decyzji)
// nie mają wspólnego położenia – średnia z nich wskazywałaby miejsce, gdzie nic nie powstaje.
export const ROZRZUT_MAX_M = 2000

/**
 * Punkt decyzji: środek ciężkości jej działek ważony polem (jak w MSIP). `geometrie` to
 * Map id → { wkt } | { brak }; null, gdy żadnej działki nie znamy albo leżą zbyt daleko od siebie.
 */
export function punktDecyzji(idyDzialek, geometrie) {
  const srodki = []
  for (const id of idyDzialek) {
    const g = geometrie.get(id)
    if (!g?.wkt) continue
    const s = srodekIPole(parsujWkt(g.wkt))
    if (s) srodki.push(s)
  }
  if (!srodki.length) return null
  const pole = srodki.reduce((a, s) => a + s.pole, 0)
  const x = srodki.reduce((a, s) => a + s.x * s.pole, 0) / pole
  const y = srodki.reduce((a, s) => a + s.y * s.pole, 0) / pole
  const rozrzut = Math.max(...srodki.map((s) => Math.hypot(s.x - x, s.y - y)))
  if (rozrzut > ROZRZUT_MAX_M) return null
  return { x, y, pole, znalezione: srodki.length, rozrzut }
}

// ---------------------------------------------------------------------------------------------
// Odczyt i pobrania

async function przygotujCsv() {
  if (existsSync(PLIK_CSV)) return PLIK_CSV
  // Zip ma 35 MB, a serwer dane.gov.pl potrafi się zawiesić: dłuższy limit czasu i ponowienia.
  const zip = await pobierzTrwale(URL_POBRANIA, 'gunb-malopolskie.zip', { limitMs: 600_000 })
  const pliki = unzipSync(readFileSync(zip), {
    filter: (f) => f.name.toLowerCase().endsWith('.csv'),
  })
  const nazwa = Object.keys(pliki)[0]
  if (!nazwa) throw new Error('Zip RWDZ nie zawiera pliku CSV')
  writeFileSync(PLIK_CSV, pliki[nazwa])
  return PLIK_CSV
}

/** Data stanu zasobu z dane.gov.pl; przy braku sieci data najnowszej decyzji w pliku. */
async function dataStanu(najnowszaDecyzja) {
  try {
    const r = await fetch(URL_METADANYCH, { signal: AbortSignal.timeout(30_000) })
    const dd = (await r.json())?.data?.attributes?.data_date
    if (/^\d{4}-\d{2}-\d{2}$/.test(dd ?? '')) return dd
  } catch {}
  return najnowszaDecyzja
}

async function wczytajWiersze(csv, jednostki) {
  const instancja = await DuckDBInstance.create(':memory:')
  const db = await instancja.connect()
  const lista = jednostki.map((j) => `'${j}'`).join(',')
  // Świadomie wybieramy tylko potrzebne kolumny: nazwa_inwestor i projektant_* to dane osobowe.
  const wynik = await db.runAndReadAll(`
    SELECT numer_gunb AS nr,
           substr(data_wydania_decyzji, 1, 10) AS data,
           jednosta_numer_ew AS jednostka,
           obreb_numer AS obreb,
           trim(numer_dzialki) AS dzialka,
           numer_arkusza_dzialki AS arkusz,
           rodzaj_inwestycji AS rodzaj,
           kategoria,
           nazwa_zamierzenia_bud AS zakres,
           nazwa_zam_budowlanego AS opis
    FROM read_csv('${csv}', delim=';', header=true, quote='"', all_varchar=true,
                  null_padding=true, parallel=false)
    WHERE data_wydania_decyzji >= '${OKNO_OD}'
      AND substr(jednosta_numer_ew, 1, 6) IN (${lista})`)
  return wynik.getRowObjects()
}

/** Rozpoznaje działki decyzji w ULDK; dla decyzji bez żadnej znanej działki próbuje zastępczych. */
async function rozpoznajDzialki(decyzje, { pobieraj }) {
  const geometrie = new Map()
  const wczytaj = async (idy) => {
    if (!idy.length) return
    if (!pobieraj) {
      // Tryb suchy: tylko to, co już w cache (pobierzDzialki bez sieci nie istnieje, więc czytamy plik).
      if (!existsSync(PLIK_ULDK)) return
      for (const linia of readFileSync(PLIK_ULDK, 'utf8').split('\n')) {
        if (!linia) continue
        const r = JSON.parse(linia)
        if (!geometrie.has(r.id)) geometrie.set(r.id, r.brak ? { brak: true } : { wkt: r.wkt })
      }
      return
    }
    let bledy = 0
    for (let podejscie = 1; podejscie <= 3; podejscie++) {
      const wynik = await pobierzDzialki(idy, { plikCache: PLIK_ULDK, wspolbieznosc: 8 })
      // Bez nadpisywania: cache zawiera „brak" dla działek, którym w poprzedniej rundzie
      // przypisaliśmy już geometrię zastępczą.
      for (const [id, g] of wynik.dzialki) if (!geometrie.has(id)) geometrie.set(id, g)
      bledy = wynik.bledy
      if (!bledy) return
      console.log(`ULDK: ${bledy} działek bez odpowiedzi serwera, ponawiam (${podejscie}/3)`)
    }
    // Garstka działek, na które serwer powiatu uparcie nie odpowiada, nie blokuje biegu: bez
    // geometrii taka działka po prostu nie ma położenia (decyzja trafia do „bez położenia").
    if (bledy > Math.max(5, 0.01 * idy.length))
      throw new Error(
        `ULDK: ${bledy} działek nadal bez odpowiedzi – uruchom skrypt ponownie (cache zostaje)`,
      )
    console.log(`ULDK: ${bledy} działek bez odpowiedzi po trzech próbach – traktuję jak nieznane`)
  }

  await wczytaj([...new Set(decyzje.flatMap((d) => [...d.dzialki.keys()]))])
  let zastepcze = 0
  const bezPunktu = (d) => ![...d.dzialki.keys()].some((id) => geometrie.get(id)?.wkt)
  for (let runda = 0; runda < 5; runda++) {
    const potrzebne = decyzje.filter(bezPunktu)
    if (!potrzebne.length) break
    const pary = []
    for (const d of potrzebne)
      for (const [id, arkusz] of d.dzialki) {
        const k = kandydaciZastepczy(id, arkusz)[runda]
        if (k) pary.push([id, k])
      }
    if (!pary.length) break
    await wczytaj([...new Set(pary.map(([, k]) => k))])
    for (const [id, k] of pary)
      if (geometrie.get(k)?.wkt && !geometrie.get(id)?.wkt) {
        geometrie.set(id, { wkt: geometrie.get(k).wkt, zastepcza: true })
        zastepcze++
      }
  }
  return { geometrie, zastepcze }
}

// ---------------------------------------------------------------------------------------------
// Liczenie

/** Liczba decyzji w promieniu od adresu (wspólny indeks punktów, współrzędne w metrach). */
const liczDecyzje = (indeks, x, y) => sumaWPromieniu(indeks, x, y, PROMIEN)

/** Kontrola spójności: ta sama metoda dla adresów Krakowa vs `inwestycje_500m` z MSIP. */
function kontrolaKrakow(adresy, indeks) {
  const plik = join(DANE, 'wskazniki', 'inwestycje_500m.json')
  if (!existsSync(plik)) return null
  const msip = JSON.parse(readFileSync(plik, 'utf8')).wartosci
  let n = 0
  let sa = 0
  let sb = 0
  let saa = 0
  let sbb = 0
  let sab = 0
  for (const a of adresy) {
    if (a.teryt !== TERYT_KRAKOW || msip[a.i] === null) continue
    const [x, y] = do2180(a.lon, a.lat)
    const rwdz = liczDecyzje(indeks, x, y)
    const m = msip[a.i]
    n++
    sa += rwdz
    sb += m
    saa += rwdz * rwdz
    sbb += m * m
    sab += rwdz * m
  }
  const cov = sab / n - (sa / n) * (sb / n)
  const r = cov / Math.sqrt((saa / n - (sa / n) ** 2) * (sbb / n - (sb / n) ** 2))
  return { adresow: n, sredniaRwdz: sa / n, sredniaMsip: sb / n, stosunek: sa / sb, korelacja: r }
}

async function main() {
  const pobieraj = !process.argv.includes('--bez-pobierania')
  const pobrano = dzis()
  const { adresy } = wczytajAdresy()
  const gminyAdresow = [
    ...new Set(adresy.filter((a) => a.teryt !== TERYT_KRAKOW).map((a) => a.teryt.slice(0, 6))),
  ]
  if (gminyAdresow.length !== 13)
    throw new Error(`Oczekiwano 13 gmin obwarzanka, jest ${gminyAdresow.length}`)

  const csv = await przygotujCsv()
  const jednostki = [...gminyAdresow, ...JEDNOSTKI_KRAKOWA, ...SASIEDZI]
  const wiersze = await wczytajWiersze(csv, jednostki)
  const dataDanych = await dataStanu(wiersze.reduce((m, w) => (w.data > m ? w.data : m), OKNO_OD))
  const wszystkie = zbierzDecyzje(wiersze)
  const decyzje = [...wszystkie.values()].filter(czyLiczona)
  const dzialek = new Set(decyzje.flatMap((d) => [...d.dzialki.keys()])).size
  console.log(
    `RWDZ: ${wiersze.length} wierszy, ${wszystkie.size} decyzji od ${OKNO_OD}, do liczenia ${decyzje.length} (${dzialek} działek)`,
  )

  const { geometrie, zastepcze } = await rozpoznajDzialki(decyzje, { pobieraj })
  const punkty = []
  let bezPunktu = 0
  for (const d of decyzje) {
    const p = punktDecyzji(d.dzialki.keys(), geometrie)
    if (p) punkty.push({ ...p, nr: d.nr, jednostki: d.jednostki })
    else bezPunktu++
  }
  const wGminach = (zbior) =>
    punkty.filter((p) => [...p.jednostki].some((j) => zbior.includes(j))).length
  console.log(
    `Położenie ustalone dla ${punkty.length} z ${decyzje.length} decyzji (bez: ${bezPunktu}, ${((100 * bezPunktu) / decyzje.length).toFixed(1)}%); działek zastępczych: ${zastepcze}`,
  )
  console.log(
    `Punkty: obwarzanek ${wGminach(gminyAdresow)}, Kraków ${wGminach(JEDNOSTKI_KRAKOWA)}, sąsiednie gminy ${wGminach(SASIEDZI)}`,
  )

  const indeks = indeksPunktow(punkty.map((p) => [p.x, p.y]))
  const kontrola = kontrolaKrakow(adresy, indeks)
  if (kontrola)
    console.log(
      `Kontrola w Krakowie (${kontrola.adresow} adresów): RWDZ średnio ${kontrola.sredniaRwdz.toFixed(2)}, MSIP ${kontrola.sredniaMsip.toFixed(2)}, stosunek ${kontrola.stosunek.toFixed(2)}, korelacja ${kontrola.korelacja.toFixed(3)}`,
    )

  const wartosci = adresy.map((a) => {
    if (a.teryt === TERYT_KRAKOW) return null
    const [x, y] = do2180(a.lon, a.lat)
    return liczDecyzje(indeks, x, y)
  })
  if (!pobieraj) {
    const z = wartosci.filter((v) => v !== null)
    const maks = z.reduce((a, b) => Math.max(a, b), 0)
    console.log(
      `Tryb suchy: ${z.length} adresów, średnio ${(z.reduce((a, b) => a + b, 0) / z.length).toFixed(2)}, maks ${maks} – nic nie zapisano`,
    )
    return
  }

  // Bezpieczniki: lepiej nie opublikować pliku niż opublikować wartości z uszkodzonego pobrania.
  const udzial = (100 * bezPunktu) / decyzje.length
  if (udzial > 15)
    throw new Error(`Położenia nie ustalono dla ${udzial.toFixed(1)}% decyzji – sprawdź ULDK`)
  if (kontrola && kontrola.korelacja < 0.5)
    throw new Error(
      `Kontrola w Krakowie: korelacja z MSIP ${kontrola.korelacja.toFixed(2)} – sprawdź układ współrzędnych i położenie decyzji`,
    )
  const procent = (x) => x.toFixed(1).replace('.', ',')
  const kontrolaOpis = kontrola
    ? `; ta sama metoda w Krakowie daje ${Math.round(100 * kontrola.stosunek)}% liczby z MSIP (korelacja ${kontrola.korelacja.toFixed(2).replace('.', ',')})`
    : ''
  zapiszWskaznik(
    {
      id: 'inwestycje_500m_obwarzanek',
      kategoria: 'przyszlosc',
      nazwa: 'Pozwolenia na budowę w 500 m – gminy obwarzanka (2025–2026)',
      opis: `Liczba pozwoleń na budowę, rozbudowę i nadbudowę budynków z lat 2025–2026 (do ${dataDanych}) w promieniu 500 m od adresu, liczona od środka działek decyzji – jak inwestycje_500m w Krakowie, ale z rejestru GUNB (RWDZ) i ewidencji gruntów (ULDK). Bez sieci, instalacji i dróg. Liczą się też decyzje za granicą gminy, w tym w Krakowie. Ok. ${procent(udzial)}% decyzji bez ustalonego położenia pominięto, więc wartość bywa lekko zaniżona${kontrolaOpis}. W Krakowie brak danych (null) – patrz inwestycje_500m.`,
      jednostka: 'szt.',
      kierunek: 'neutralny',
      rozdzielczosc: 'adres',
      zakres: [0, 50],
      zadanie: 123,
      zrodla: [
        {
          nazwa:
            'GUNB – Rejestr Wniosków, Decyzji i Zgłoszeń w sprawach budowlanych (RWDZ), województwo małopolskie (zasób 2716739)',
          url: URL_ZBIORU,
          licencja: 'CC0 1.0: https://creativecommons.org/publicdomain/zero/1.0/',
          dataDanych,
          pobrano,
        },
        {
          nazwa: 'GUGiK – Usługa Lokalizacji Działek Katastralnych (ULDK), geometria działek EGiB',
          url: URL_ULDK,
          licencja:
            'Dane EGiB (geometria działek) udostępniane bezpłatnie przez GUGiK: https://www.geoportal.gov.pl/pl/dane/ewidencja-gruntow-i-budynkow-egib/',
          dataDanych: pobrano,
          pobrano,
        },
      ],
    },
    wartosci,
  )
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
