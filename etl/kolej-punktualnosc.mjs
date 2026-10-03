// Punktualność pociągów na najbliższej stacji kolejowej → wskaźnik kolej_punktualnosc (#139).
// Źródło: Urząd Transportu Kolejowego (dane.gov.pl, zbiór „Przewozy pasażerskie”, CC0 1.0),
// czytane z tabel z-dykty.pl `kolej_punktualnosc` i `kolej_stacje` przez PostgREST publicznym
// kluczem anon. Uzupełnia #111 (`kolej_odleglosc` liczy odległość do stacji Kolei Małopolskich,
// ta warstwa niesie jakość kursowania na stacji z danych całego kraju).
// Uruchom: node etl/kolej-punktualnosc.mjs. Zmienne ZDYKTY_SUPABASE_URL i ZDYKTY_ANON_KEY biorą
// się ze środowiska albo z .env.local; klucza nie wypisujemy ani nie zapisujemy.
// Opis metody, licencja, kontrola i ograniczenia: etl/kolej-punktualnosc.md.

import { createHash } from 'node:crypto'
import { statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { indeksPrzystankow } from './gtfs-przystanki.mjs'
import { najblizszyPunkt } from './kolej-km.mjs'
import { kluczZPliku } from './lib/uslugi-ceidg.mjs'
import { DANE, dzis, KORZEN, wczytajAdresy, zapiszWskaznik } from './lib/wspolne.mjs'

const ID = 'kolej_punktualnosc'
const TERYT_KRAKOW = '1261011'
const STRONA = 1000
/** Plik wskaźnika ma mieścić się poniżej 2 MB (kontrakt danych); przekroczenie zatrzymuje ETL. */
const MAKS_BAJTOW = 2_000_000

/** Promień „najbliższej stacji” w metrach, w linii prostej (zasięg pieszy i rowerowy). */
export const PROMIEN_M = 3000
/**
 * Najmniej zatrzymań w roku, od którego stacja ma wskaźnik (ponad pięć dziennie). Dwa powody:
 *  1. wynik pokazujemy z dokładnością 0,1 pp, a przy 2000 zatrzymań jedno opóźnione przesuwa go
 *     o 0,05 pp, czyli o pół kroku; poniżej procent opisuje kilka pociągów, nie stację;
 *  2. pomiar na stacjach Krakowa (zbiór UTK 2024 kontra liczba opóźnionych zatrzymań z 2025 r.):
 *     pięć stacji z ruchem poniżej 2000 (Przylasek, Kościelniki, Piastów, Lubocza, Nowa Huta) ma
 *     w 2025 r. od 3,9 do 38 razy więcej opóźnionych zatrzymań niż w 2024 r., więc rozkład się zmienił i
 *     rocznik 2024 ich nie opisuje. Między 1967 a 4859 zatrzymań nie ma w okolicy żadnej stacji,
 *     więc każdy próg z tego przedziału daje ten sam wynik; 2000 to najmniejsza okrągła liczba.
 * Dla porównania z-dykty używa 5000 w rankingu stacji (tam liczy się kolejność, tu wartość).
 */
export const MIN_ZATRZYMAN = 2000
/** Granice Polski z zapasem: pozycja stacji spoza nich (np. 0,0 w niektórych feedach) odpada. */
const GRANICE_PL = { lat: [48.9, 55.0], lon: [14.0, 24.3] }
/** Kontrola ruchu: ile razy musi się zmienić liczba opóźnionych zatrzymań, by ostrzec w logu. */
const PROG_ZMIANY_RUCHU = 3

const KATALOG_UTK = 'https://dane.gov.pl/pl/dataset/1650,liczba-przewiezionych-pasazerow'
const ZRODLO_POLOZENIA = 'https://mkuran.pl/gtfs/polish_trains.zip'

/**
 * Zasoby UTK na dane.gov.pl (zbiór 1650), sprawdzone 2026-10-03 przez API 1.4
 * (`/resources/<id>`, pole data_date). Rocznik spoza tej tabeli zatrzymuje ETL: najpierw trzeba
 * sprawdzić zasoby i datę publikacji, a nie podstawiać dane starszego rocznika.
 * Rocznik 2025 ma u UTK tylko licznik (opóźnione zatrzymania), bez liczby wszystkich zatrzymań,
 * więc udziału nie da się policzyć; stąd najnowszy rocznik użyty tu to 2024.
 */
export const ROCZNIKI_UTK = {
  2024: { opublikowano: '2025-06-27', zatrzymania: 67808, opoznione: 67804 },
}

// --- Dostęp do z-dykty -------------------------------------------------------------------------

/** Adres i klucz anon z-dykty: środowisko, potem .env.local. Wartości nigdy nie trafiają do logu. */
export function daneDostepu(env = process.env, plikEnv = join(KORZEN, '.env.local')) {
  const url = env.ZDYKTY_SUPABASE_URL || kluczZPliku(plikEnv, 'ZDYKTY_SUPABASE_URL')
  const klucz = env.ZDYKTY_ANON_KEY || kluczZPliku(plikEnv, 'ZDYKTY_ANON_KEY')
  if (!url || !klucz)
    throw new Error(
      'Brak ZDYKTY_SUPABASE_URL albo ZDYKTY_ANON_KEY (zmienne środowiskowe lub .env.local)',
    )
  if (!/^https:\/\/[^\s/?#]+\/?$/.test(url))
    throw new Error('ZDYKTY_SUPABASE_URL: oczekiwano adresu w postaci https://<host>')
  return { url: url.replace(/\/$/, ''), klucz }
}

/** Błąd, którego ponawianie nie ma sensu (odmowa dostępu, zły adres, zła kolumna). */
class BladZapytania extends Error {}

async function pobierzStrone(dostep, tabela, zapytanie, od, opcje) {
  const { fetchFn, strona, proby, pauzaMs } = opcje
  const url = `${dostep.url}/rest/v1/${tabela}?${zapytanie}`
  let ostatni
  for (let proba = 1; proba <= proby; proba++) {
    try {
      const odpowiedz = await fetchFn(url, {
        headers: {
          apikey: dostep.klucz,
          Range: `${od}-${od + strona - 1}`,
          'Range-Unit': 'items',
          Prefer: 'count=exact',
        },
        signal: AbortSignal.timeout(60_000),
      })
      // 429 (limit tempa) ponawiamy z pauzą; pozostałe 4xx to błąd zapytania albo dostępu.
      if (odpowiedz.status >= 400 && odpowiedz.status < 500 && odpowiedz.status !== 429)
        throw new BladZapytania(`z-dykty ${tabela}: HTTP ${odpowiedz.status}`)
      if (!odpowiedz.ok) throw new Error(`HTTP ${odpowiedz.status}`)
      const razem = /\/(\d+)$/.exec(odpowiedz.headers.get('content-range') ?? '')
      if (!razem) throw new Error('brak liczby wierszy w nagłówku Content-Range')
      const dane = await odpowiedz.json()
      if (!Array.isArray(dane)) throw new Error('odpowiedź nie jest tablicą wierszy')
      return { dane, razem: Number(razem[1]) }
    } catch (blad) {
      if (blad instanceof BladZapytania) throw blad
      ostatni = blad
      if (proba < proby) await new Promise((resolve) => setTimeout(resolve, proba * pauzaMs))
    }
  }
  throw new Error(`z-dykty ${tabela}: nie udało się pobrać strony od ${od}: ${ostatni?.message}`)
}

/**
 * Czyta całą tabelę PostgREST stronami (Range) i sprawdza, że dostała tyle wierszy, ile zadeklarował
 * serwer. Zapytanie musi mieć jednoznaczne `order`, inaczej strony mogłyby się nakładać.
 */
export async function pobierzTabele(dostep, tabela, zapytanie, opcje = {}) {
  const ustawienia = { fetchFn: fetch, strona: STRONA, proby: 3, pauzaMs: 1000, ...opcje }
  const wiersze = []
  let razem = null
  while (razem === null || wiersze.length < razem) {
    const { dane, razem: deklarowane } = await pobierzStrone(
      dostep,
      tabela,
      zapytanie,
      wiersze.length,
      ustawienia,
    )
    razem = deklarowane
    if (razem > 0 && !dane.length)
      throw new Error(`z-dykty ${tabela}: pusta strona po ${wiersze.length} z ${razem} wierszy`)
    wiersze.push(...dane)
    if (!razem) break
  }
  if (wiersze.length !== razem)
    throw new Error(
      `z-dykty ${tabela}: pobrano ${wiersze.length} wierszy, serwer deklaruje ${razem}`,
    )
  return wiersze
}

// --- Rachunek punktualności ---------------------------------------------------------------------

const liczba = (v) => typeof v === 'number' && Number.isFinite(v)

/**
 * Najnowszy rocznik, w którym (prawie) każdy wiersz ma i licznik, i mianownik. Rocznik z samym
 * licznikiem (UTK 2025) odpada: udziału nie wolno liczyć, a zero w mianowniku nie jest pomiarem.
 */
export function wybierzRok(wiersze) {
  const poRoku = new Map()
  for (const w of wiersze) {
    if (w.miesiac !== 0) continue
    const s = poRoku.get(w.rok) ?? { wszystkie: 0, pelne: 0 }
    s.wszystkie++
    if (liczba(w.zatrzymania) && liczba(w.opoznione)) s.pelne++
    poRoku.set(w.rok, s)
  }
  const lata = [...poRoku]
    .filter(([, s]) => s.pelne / s.wszystkie >= 0.95)
    .map(([rok]) => rok)
    .sort((a, b) => b - a)
  if (!lata.length) throw new Error('Brak rocznika UTK z liczbą zatrzymań (mianownikiem)')
  return lata[0]
}

/**
 * Zatrzymania i opóźnione zatrzymania stacji w roku, zsumowane po przewoźnikach: UTK od 2024 r. daje
 * stację × przewoźnik, a pytanie dotyczy stacji. Stacja z choćby jednym niepełnym wierszem dostaje
 * `pelne: false` i nie liczy się: pominięty wiersz zaniżałby opóźnienia albo ruch po cichu.
 */
export function agregujRok(wiersze, rok) {
  const wynik = new Map()
  for (const w of wiersze) {
    if (w.rok !== rok || w.miesiac !== 0) continue
    const a = wynik.get(w.stacja) ?? { zatrzymania: 0, opoznione: 0, pelne: true }
    if (liczba(w.zatrzymania) && liczba(w.opoznione) && w.zatrzymania >= 0 && w.opoznione >= 0) {
      a.zatrzymania += w.zatrzymania
      a.opoznione += w.opoznione
    } else a.pelne = false
    wynik.set(w.stacja, a)
  }
  return wynik
}

/** Odsetek zatrzymań bez opóźnienia (procent, jedno miejsce po przecinku); 0 to zmierzone zero. */
export function punktualnosc(opoznione, zatrzymania) {
  return Math.round((1000 * (zatrzymania - opoznione)) / zatrzymania) / 10
}

const wPolsce = (s) =>
  liczba(s.lat) &&
  liczba(s.lon) &&
  s.lat >= GRANICE_PL.lat[0] &&
  s.lat <= GRANICE_PL.lat[1] &&
  s.lon >= GRANICE_PL.lon[0] &&
  s.lon <= GRANICE_PL.lon[1]

/**
 * Stacje, od których można liczyć wskaźnik. Położenie z-dykty pochodzi z dopasowania nazw UTK do
 * przystanków GTFS; metoda `gtfs` to nazwa 1:1, a `gtfs-prefiks` bierze pozycję jednego z kilku
 * kandydatów z tej samej gminy (do kilku km błędu), więc przy promieniu 3 km jej nie używamy.
 * Zwraca też liczbę odrzuconych stacji wg powodu, żeby log pokazał, co zniknęło i dlaczego.
 */
export function stacjeDoWarstwy(stacje, agregat, min = MIN_ZATRZYMAN) {
  const przyjete = []
  const odrzucone = {
    metoda: 0,
    polozenie: 0,
    bezPomiaru: 0,
    niepelne: 0,
    niespojne: 0,
    malyRuch: 0,
  }
  const odrzuc = (powod) => {
    odrzucone[powod]++
  }
  for (const s of stacje) {
    if (s.metoda !== 'gtfs') {
      odrzuc('metoda')
      continue
    }
    if (!wPolsce(s)) {
      odrzuc('polozenie')
      continue
    }
    const a = agregat.get(s.nazwa)
    if (!a) {
      odrzuc('bezPomiaru')
      continue
    }
    if (!a.pelne) {
      odrzuc('niepelne')
      continue
    }
    if (a.opoznione > a.zatrzymania) {
      odrzuc('niespojne')
      continue
    }
    if (a.zatrzymania < min) {
      odrzuc('malyRuch')
      continue
    }
    przyjete.push({
      nazwa: s.nazwa,
      lat: s.lat,
      lon: s.lon,
      zatrzymania: a.zatrzymania,
      opoznione: a.opoznione,
      punktualne: punktualnosc(a.opoznione, a.zatrzymania),
    })
  }
  return { stacje: przyjete, odrzucone }
}

/** Dla każdego adresu: wskaźnik najbliższej kwalifikowanej stacji w promieniu; dalej brak danych. */
export function liczWarstwe(adresy, stacje, promien = PROMIEN_M) {
  const indeks = stacje.length ? indeksPrzystankow(stacje) : null
  const trafienia = adresy.map((adres) => najblizszyPunkt(adres, stacje, indeks, promien))
  return { wartosci: trafienia.map((t) => (t ? t.punkt.punktualne : null)), trafienia }
}

/**
 * Stosunek liczby opóźnionych zatrzymań w późniejszym roku do bazowego, dla stacji, które mają
 * oba. Opóźnione zatrzymania rosną z ruchem, więc skok o rząd wielkości znaczy zmianę rozkładu
 * (nowa linia, zamknięcie), po której wskaźnik z roku bazowego opisuje już inną stację.
 */
export function zmianaOpoznien(wiersze, rokBazowy, rokPozniejszy) {
  const sumy = (rok) => {
    const m = new Map()
    for (const w of wiersze)
      if (w.rok === rok && w.miesiac === 0 && liczba(w.opoznione))
        m.set(w.stacja, (m.get(w.stacja) ?? 0) + w.opoznione)
    return m
  }
  const bazowe = sumy(rokBazowy)
  const pozniejsze = sumy(rokPozniejszy)
  const wynik = new Map()
  for (const [stacja, o] of bazowe) {
    const p = pozniejsze.get(stacja)
    if (o > 0 && p !== undefined) wynik.set(stacja, p / o)
  }
  return wynik
}

// --- Metadane ------------------------------------------------------------------------------------

/** Metadane wskaźnika. `odcisk` to skrót SHA-256 wierszy rocznika, z których liczono warstwę. */
export function zbudujMeta({ rok, dataStacji, odcisk, pobrano }) {
  const zasob = ROCZNIKI_UTK[rok]
  if (!zasob) throw new Error(`Rocznik ${rok}: brak wpisu w ROCZNIKI_UTK`)
  return {
    id: ID,
    kategoria: 'transport',
    nazwa: 'Punktualność pociągów na najbliższej stacji',
    opis: `Odsetek zatrzymań pociągów na najbliższej stacji kolejowej, które nie były opóźnione o 6 minut lub więcej (próg UTK), w ${rok} r. Wszyscy przewoźnicy pasażerscy razem, stacja do ${PROMIEN_M / 1000} km w linii prostej, z co najmniej ${MIN_ZATRZYMAN} zatrzymań w roku (ponad pięć dziennie; mniej to za mało na procent). To punktualność pociągów, które zatrzymują się na stacji, a nie ocena stacji ani gminy; nie mówi, jak często pociągi jadą (zob. warstwa kolej_kursy_szczyt_h). Brak takiej stacji w promieniu ${PROMIEN_M / 1000} km oznacza brak danych, nie zero. Najnowszy rocznik UTK z pełnymi danymi to ${rok}; zmiany rozkładu od ${rok + 1} r. nie są uwzględnione. Wartość obliczona przez adresscore z danych UTK przetworzonych przez z-dykty.pl.`,
    jednostka: '%',
    kierunek: 'wiecej-lepiej',
    rozdzielczosc: 'adres',
    zakres: [80, 100],
    zadanie: 139,
    zrodla: [
      {
        nazwa: `Urząd Transportu Kolejowego – liczba zatrzymań pociągów pasażerskich i liczba opóźnionych zatrzymań w ${rok} r. (dane.gov.pl, zbiór „Przewozy pasażerskie”, zasoby ${zasob.zatrzymania} i ${zasob.opoznione}, opublikowane ${zasob.opublikowano}); przetworzone przez z-dykty.pl (CC BY 4.0); odcisk SHA-256 wierszy ${odcisk.slice(0, 12)}`,
        url: KATALOG_UTK,
        licencja:
          'CC0 1.0 (UTK, dane.gov.pl); zestawienie po stacjach przetworzone przez z-dykty.pl na licencji CC BY 4.0 z atrybucją „z-dykty.pl”; wskaźnik obliczony przez adresscore',
        dataDanych: String(rok),
        pobrano,
      },
      {
        nazwa:
          'z-dykty.pl – położenie stacji (tabela kolej_stacje): nazwy stacji UTK dopasowane do przystanków rozkładu PKP PLK z GTFS mkuran.pl (tylko dopasowania 1:1 po nazwie)',
        url: ZRODLO_POLOZENIA,
        licencja:
          'Warunki ponownego wykorzystania danych sektora publicznego PKP PLK (wg mkuran.pl); dopasowanie stacji przez z-dykty.pl na licencji CC BY 4.0',
        dataDanych: dataStacji,
        pobrano,
      },
    ],
  }
}

// --- Kontrola jakości ---------------------------------------------------------------------------

/** Pięć wartości z niepustych: najmniejsza, 5. percentyl, mediana, 95. percentyl, największa. */
function rozklad(wartosci) {
  const z = wartosci.filter((v) => v !== null).sort((a, b) => a - b)
  if (!z.length) return null
  const q = (p) => z[Math.min(z.length - 1, Math.floor(p * (z.length - 1) + 0.5))]
  return { n: z.length, min: z[0], p5: q(0.05), mediana: q(0.5), p95: q(0.95), max: z.at(-1) }
}

function podsumuj(wartosci, adresy) {
  const grupy = [
    ['Kraków', (a) => a.teryt === TERYT_KRAKOW],
    ['obwarzanek', (a) => a.teryt !== TERYT_KRAKOW],
  ]
  for (const [nazwa, wybor] of grupy) {
    const v = wartosci.filter((_, i) => wybor(adresy[i]))
    const r = rozklad(v)
    console.log(
      `${ID} | ${nazwa}: ${r ? `${r.n}/${v.length} z wartością (${((100 * r.n) / v.length).toFixed(1)}%), min ${r.min}, p5 ${r.p5}, mediana ${r.mediana}, p95 ${r.p95}, max ${r.max}` : `0/${v.length} z wartością`}`,
    )
  }
}

/** Znane miejsca do ręcznej kontroli wyników (miejscowość, ulica, numer w adresy.json). */
const KONTROLA = [
  { miejscowosc: 'Kraków', ulica: 'Pawia', nr: '5' },
  { miejscowosc: 'Kraków', ulica: 'Rynek Główny', nr: '10' },
  { miejscowosc: 'Kraków', ulica: 'Wielicka', nr: '256' },
  { miejscowosc: 'Wieliczka', ulica: 'Rynek Górny', nr: '7' },
  { miejscowosc: 'Skawina', ulica: 'Rynek', nr: '2' },
  { miejscowosc: 'Niepołomice', ulica: 'Rynek', nr: '19' },
  { miejscowosc: 'Zabierzów', ulica: 'Krakowska', nr: '22' },
  { miejscowosc: 'Kocmyrzów', ulica: 'Na Błonie', nr: '6' },
  { miejscowosc: 'Mogilany', ulica: 'Zakopiańska', nr: '66' },
]

function kontrola(adresy, trafienia) {
  console.log('Kontrola na znanych miejscach:')
  for (const k of KONTROLA) {
    const i = adresy.findIndex(
      (a) => a.miejscowosc === k.miejscowosc && a.ulica === k.ulica && a.nr === k.nr,
    )
    const opis = i < 0 ? 'brak w adresach' : opiszTrafienie(trafienia[i])
    console.log(`  ${k.miejscowosc} ${k.ulica} ${k.nr}: ${opis}`)
  }
}

function opiszTrafienie(t) {
  if (!t) return `brak stacji w promieniu ${PROMIEN_M / 1000} km`
  const s = t.punkt
  return `${s.nazwa}, ${Math.round(t.metry)} m, ${s.punktualne}% punktualnych z ${s.zatrzymania} zatrzymań`
}

/** Stacje użyte dla co najmniej jednego adresu, od najliczniej wybieranych. */
function uzyteStacje(trafienia) {
  const m = new Map()
  for (const t of trafienia) {
    if (!t) continue
    const w = m.get(t.punkt.nazwa) ?? { stacja: t.punkt, adresow: 0 }
    w.adresow++
    m.set(t.punkt.nazwa, w)
  }
  return [...m.values()].sort((a, b) => b.adresow - a.adresow)
}

// --- Bieg ---------------------------------------------------------------------------------------

export async function generuj() {
  const dostep = daneDostepu()
  const stacje = await pobierzTabele(
    dostep,
    'kolej_stacje',
    'select=nazwa,lat,lon,metoda,zaktualizowano&order=nazwa.asc',
  )
  const pierwszyRok = Math.min(...Object.keys(ROCZNIKI_UTK).map(Number))
  const pomiary = await pobierzTabele(
    dostep,
    'kolej_punktualnosc',
    `select=stacja,rok,miesiac,przewoznik,zatrzymania,opoznione&miesiac=eq.0&rok=gte.${pierwszyRok}&order=stacja.asc,rok.asc,przewoznik.asc`,
  )
  if (stacje.length < 2000 || pomiary.length < 1000)
    throw new Error(
      `Podejrzanie mało danych z-dykty: ${stacje.length} stacji, ${pomiary.length} pomiarów`,
    )

  const rok = wybierzRok(pomiary)
  const wierszeRoku = pomiary.filter((w) => w.rok === rok)
  const odcisk = createHash('sha256').update(JSON.stringify(wierszeRoku)).digest('hex')
  const agregat = agregujRok(pomiary, rok)
  const { stacje: kwalifikowane, odrzucone } = stacjeDoWarstwy(stacje, agregat)
  const razemOpoznione = [...agregat.values()].reduce((s, a) => s + a.opoznione, 0)
  const razemZatrzymania = [...agregat.values()].reduce((s, a) => s + a.zatrzymania, 0)
  const udzialKraju = (100 * razemOpoznione) / razemZatrzymania
  console.log(
    `z-dykty: ${stacje.length} stacji, ${pomiary.length} pomiarów od ${pierwszyRok}; rocznik ${rok}: ${wierszeRoku.length} wierszy, odcisk SHA-256 ${odcisk}`,
  )
  console.log(
    `Krajowy udział opóźnionych zatrzymań w ${rok}: ${udzialKraju.toFixed(2)}% (${razemOpoznione} z ${razemZatrzymania})`,
  )
  console.log(
    `Stacje do warstwy: ${kwalifikowane.length}; odrzucone wg powodu: ${JSON.stringify(odrzucone)}`,
  )
  // Licznik większy od mianownika to objaw różnego zakresu obu plików UTK (tytuł licznika wspomina
  // też przewozy towarowe), nie błąd pojedynczej stacji: wtedy wskaźnik byłby zawyżony.
  if (odrzucone.niespojne > 0.01 * agregat.size)
    throw new Error(
      `${odrzucone.niespojne} stacji ma więcej opóźnionych zatrzymań niż zatrzymań: licznik i mianownik obejmują różny zakres`,
    )
  if (!(udzialKraju > 3 && udzialKraju < 20) || kwalifikowane.length < 1500)
    throw new Error('Wyniki spoza spodziewanego zakresu: sprawdź dane z-dykty i układ pliku UTK')

  const { adresy } = wczytajAdresy()
  const { wartosci, trafienia } = liczWarstwe(adresy, kwalifikowane)
  const stacjeDataIso = stacje
    .map((s) => s.zaktualizowano)
    .filter(Boolean)
    .sort()
    .at(-1)
  if (!stacjeDataIso) throw new Error('Brak daty aktualizacji stacji (zaktualizowano) w z-dykty')
  const meta = zbudujMeta({
    rok,
    dataStacji: stacjeDataIso.slice(0, 10),
    odcisk,
    pobrano: dzis(),
  })
  zapiszWskaznik(meta, wartosci)
  const bajty = statSync(join(DANE, 'wskazniki', `${ID}.json`)).size
  console.log(`Plik ${ID}.json: ${(bajty / 1e6).toFixed(2)} MB`)
  if (bajty >= MAKS_BAJTOW)
    throw new Error(`Plik ${ID}.json ma ${bajty} B, a limit kontraktu to ${MAKS_BAJTOW} B`)

  podsumuj(wartosci, adresy)
  const uzyte = uzyteStacje(trafienia)
  console.log(`Użytych stacji: ${uzyte.length}; najczęściej wybierane:`)
  for (const { stacja, adresow } of uzyte.slice(0, 12))
    console.log(
      `  ${stacja.nazwa}: ${adresow} adresów, ${stacja.punktualne}% z ${stacja.zatrzymania} zatrzymań`,
    )
  const rokPozniejszy = Math.max(...pomiary.map((w) => w.rok))
  if (rokPozniejszy > rok) {
    const zmiany = zmianaOpoznien(pomiary, rok, rokPozniejszy)
    const odchylone = uzyte.filter(({ stacja }) => {
      const r = zmiany.get(stacja.nazwa)
      return r !== undefined && (r >= PROG_ZMIANY_RUCHU || r <= 1 / PROG_ZMIANY_RUCHU)
    })
    for (const { stacja, adresow } of odchylone)
      console.log(
        `UWAGA ${stacja.nazwa} (${adresow} adresów): liczba opóźnionych zatrzymań w ${rokPozniejszy} r. to ${zmiany.get(stacja.nazwa).toFixed(1)} razy tyle co w ${rok} r., rozkład mógł się zmienić`,
      )
  }
  kontrola(adresy, trafienia)
  return { rok, meta, wartosci, trafienia, kwalifikowane }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1])
  generuj().catch((blad) => {
    console.error(blad.message)
    process.exitCode = 1
  })
