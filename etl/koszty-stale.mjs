// Koszty stałe wzorcowego gospodarstwa w gminie (#140): roczny szacunek w zł dla 3 osób w mieszkaniu
// 60 m² = opłata za odpady + podatek od nieruchomości. Warstwa gminna: każdy adres gminy dostaje
// tę samą liczbę, a brak danych gminy to null, nigdy 0.
//
// Kategoria „kontekst”, kierunek „neutralny”, jak pozostałe warstwy gminne (#44). To fakt o gminie,
// nie ocena adresu: wysokie opłaty gmina przeznacza na usługi, a liczba stała w obrębie gminy
// przesunęłaby o ten sam skok wynik wszystkich jej adresów, gdyby wpadła do „codzienności”.
// Do wyniku wchodzą tylko warstwy kontekstu z listy KONTEKST_DO_WYNIKU (src/wynik/silnik.ts, tor
// integracji); tej warstwy na liście nie ma, więc zostaje faktem na karcie.
//
// Opłata za odpady = 3 × wpływy z opłaty / liczba mieszkańców. Wpływy to dochody gminy w rozdz. 90002,
// §0490, wykonanie 2025 (sprawozdania Rb-27S, tabela budzet_pozycje w z-dykty.pl), mieszkańcy to
// GUS BDL (tabela wskazniki, kod ludnosc). Nie bierzemy widoku mv_smieci_gmina: sumuje §0490
// ze WSZYSTKICH rozdziałów, więc w Krakowie dolicza 120,8 mln zł opłat parkingowych (rozdz. 60019)
// i zawyża opłatę o jedną trzecią (671 zamiast 508 zł na osobę).
//
// Podatek = 60 m² × stawka podatku od budynków mieszkalnych z uchwały rady gminy obowiązującej
// w 2026 r. Tabela podatki_skutki (Rb-PDP) niesie wpływy i skutki ulg, nie stawki, więc stawki idą
// z uchwał w Dzienniku Urzędowym Województwa Małopolskiego: etl/koszty-stale-stawki-2026.json.
//
// Uruchom: node etl/koszty-stale.mjs
//   (ZDYKTY_SUPABASE_URL i ZDYKTY_ANON_KEY z env albo .env.local; pobranie ląduje w etl/.cache/)
// Stawki względem źródła (ELI, wymaga pdftotext w PATH):
//   node --use-system-ca etl/koszty-stale.mjs --sprawdz-eli
//   (serwer e-dziennika nie wysyła certyfikatu pośredniego, więc Node potrzebuje magazynu systemu)
// Test: node --test etl/koszty-stale.test.mjs. Opis metody i kontroli: etl/koszty-stale.md.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { dataPobrania } from './lib/pobieranie.mjs'
import { kluczZPliku } from './lib/uslugi-ceidg.mjs'
import { CACHE, KORZEN, pobierzDoCache, wczytajAdresy, zapiszWskaznik } from './lib/wspolne.mjs'

export const ID = 'gmina_koszty_stale_rok'
export const ZADANIE = 140
/** Gospodarstwo wzorcowe: tyle osób płaci opłatę za odpady… */
export const OSOBY = 3
/** …i tyle metrów kwadratowych powierzchni użytkowej ma mieszkanie opodatkowane jako budynek mieszkalny. */
export const POWIERZCHNIA_M2 = 60
export const ROK_ODPADOW = 2025
export const ROK_STAWEK = 2026
/** Górna granica ustawowa stawki dla budynków mieszkalnych w 2026 r. (zł od 1 m² powierzchni użytkowej). */
export const MAKS_STAWKA_ZL_M2 = 1.25
/** Poniżej tego wpływu na osobę opłata idzie przez budżet związku międzygminnego (próg jak w z-dykty): brak danych. */
export const MIN_ODPADY_NA_OSOBE = 50
/** Powyżej tego wpływu na osobę dane uznajemy za błędne (w 14 gminach największy wynosi 538 zł). */
export const MAKS_ODPADY_NA_OSOBE = 1500
const MAKS_GMIN_W_ZAPYTANIU = 100

export const PLIK_STAWEK = join(KORZEN, 'etl', 'koszty-stale-stawki-2026.json')
export const PLIK_ODPADOW = join(KORZEN, 'etl', 'koszty-stale-odpady-2025.json')

export const ELI_BAZA = 'https://edziennik.malopolska.uw.gov.pl'
const NAGLOWKI = { 'User-Agent': 'adresscore-etl/1.0 (HackYeah 2026; https://adresscore.pl)' }
const ISO = /^\d{4}-\d{2}-\d{2}$/
// Myślniki spotykane w uchwałach: łącznik, półpauza, pauza i znak minus (różne edytory aktów).
const MYSLNIKI = [0x2010, 0x2011, 0x2012, 0x2013, 0x2014, 0x2212]
  .map((k) => String.fromCodePoint(k))
  .join('')
const MYSLNIK = `[-${MYSLNIKI}]`

// --- Stawki podatku z uchwał ---------------------------------------------------------------------

/**
 * Stawka podatku od budynków mieszkalnych (zł od 1 m² powierzchni użytkowej) z tekstu uchwały.
 * Szuka pozycji „mieszkalnych –” w części „od budynków lub ich części” i bierze jedyną kwotę
 * przed następnym punktem listy; zapisy w 14 uchwałach różnią się myślnikami, kolejnością
 * kwoty i numeracją punktów, a PDF wstawia nagłówek strony w środek pozycji.
 */
export function stawkaMieszkalne(tekst) {
  const t = tekst.replace(/\s+/g, ' ')
  const czesci = [...t.matchAll(/od budynków lub ich części/gi)]
  if (czesci.length !== 1)
    throw new Error(`Oczekiwano jednej części „od budynków lub ich części”, jest ${czesci.length}`)
  const okno = t.slice(czesci[0].index, czesci[0].index + 400)
  const poz = okno.search(new RegExp(`mieszkalnych\\s*${MYSLNIK}`))
  if (poz < 0) throw new Error('Brak pozycji „mieszkalnych –” w części o budynkach')
  const reszta = okno.slice(poz)
  const koniec = reszta.search(/\s(?:b|2)\)\s/)
  const pozycja = (koniec < 0 ? reszta : reszta.slice(0, koniec)).trim()
  const kwoty = [...pozycja.matchAll(/(\d+(?:,\d{1,2})?)\s*zł/g)]
  if (kwoty.length !== 1)
    throw new Error(`Pozycja „mieszkalnych” ma ${kwoty.length} kwot zamiast jednej: ${pozycja}`)
  return { stawka: Number(kwoty[0][1].replace(',', '.')), pozycja }
}

/** Waliduje plik ze stawkami; zwraca Map TERYT → wpis. Błąd w pliku zatrzymuje skrypt, nie wchodzi na kartę. */
export function sprawdzStawki(plik) {
  const bledy = []
  if (plik?.rok !== ROK_STAWEK) bledy.push(`rok: oczekiwano ${ROK_STAWEK}`)
  if (!ISO.test(plik?.sprawdzono ?? '')) bledy.push('sprawdzono: RRRR-MM-DD')
  if (plik?.maksimum?.zlM2 !== MAKS_STAWKA_ZL_M2)
    bledy.push(`maksimum.zlM2: oczekiwano ${MAKS_STAWKA_ZL_M2}`)
  if (!plik?.maksimum?.zrodlo) bledy.push('maksimum.zrodlo: wymagane')
  if (!Array.isArray(plik?.gminy) || !plik.gminy.length) bledy.push('gminy: brak pozycji')
  const wynik = new Map()
  for (const g of plik?.gminy ?? []) {
    const nazwa = `${g.teryt ?? '?'} ${g.gmina ?? '?'}`
    if (!/^\d{7}$/.test(g.teryt ?? '')) bledy.push(`${nazwa}: teryt to 7 cyfr`)
    if (wynik.has(g.teryt)) bledy.push(`${nazwa}: powtórzony TERYT`)
    wynik.set(g.teryt, g)
    if (!g.gmina) bledy.push(`${nazwa}: brak nazwy gminy`)
    if (!Number.isFinite(g.stawkaZlM2) || g.stawkaZlM2 <= 0 || g.stawkaZlM2 > MAKS_STAWKA_ZL_M2)
      bledy.push(`${nazwa}: stawka ${g.stawkaZlM2} poza (0; ${MAKS_STAWKA_ZL_M2}] zł/m²`)
    const a = g.akt ?? {}
    if (!/^POL_WOJ_MP\/\d{4}\/\d+$/.test(a.eli ?? '')) bledy.push(`${nazwa}: akt.eli`)
    if (!/stawek podatku od nieruchomości/i.test(a.tytul ?? ''))
      bledy.push(`${nazwa}: akt.tytul nie dotyczy stawek podatku od nieruchomości`)
    for (const k of ['dataUchwalenia', 'ogloszono', 'obowiazujeOd'])
      if (!ISO.test(a[k] ?? '')) bledy.push(`${nazwa}: akt.${k} w formacie RRRR-MM-DD`)
    if (a.dataUchwalenia > a.ogloszono) bledy.push(`${nazwa}: uchwała starsza niż ogłoszenie`)
    if (a.obowiazujeOd > `${ROK_STAWEK}-01-01`)
      bledy.push(`${nazwa}: uchwała wchodzi w życie po 1 stycznia ${ROK_STAWEK}`)
    const zapis = Number.isFinite(g.stawkaZlM2) ? g.stawkaZlM2.toFixed(2).replace('.', ',') : '?'
    if (!a.cytat?.includes(zapis)) bledy.push(`${nazwa}: akt.cytat nie zawiera kwoty ${zapis}`)
  }
  if (bledy.length) throw new Error(`Stawki podatku: ${bledy.join('; ')}`)
  return wynik
}

// --- Opłata za odpady z z-dykty ------------------------------------------------------------------

/**
 * Z odpowiedzi PostgREST (budzet_pozycje: dochody, rozdz. 90002, §0490; wskazniki: kod ludnosc)
 * robi Map TERYT → { wykonanie, ludnosc }. Brak wiersza w którejś tabeli = gminy nie ma w mapie.
 * Zły rok, rozdział albo duplikat to błąd: wolimy stanąć niż policzyć z cudzych pieniędzy.
 */
export function odczytajOdpady(budzet, ludnosc, rok = ROK_ODPADOW) {
  const wynik = new Map()
  const populacja = new Map()
  for (const r of ludnosc) {
    if (r.rok !== rok || r.kod !== 'ludnosc')
      throw new Error(`Ludność: nieoczekiwany wiersz ${JSON.stringify(r)}`)
    if (populacja.has(r.gmina_teryt)) throw new Error(`Ludność: powtórzony TERYT ${r.gmina_teryt}`)
    const l = Number(r.wartosc)
    if (!Number.isFinite(l) || l <= 0) throw new Error(`Ludność: zła wartość ${r.gmina_teryt}`)
    populacja.set(r.gmina_teryt, l)
  }
  const widziane = new Set()
  for (const r of budzet) {
    if (
      r.rok !== rok ||
      r.strona !== 'D' ||
      r.dzial !== '900' ||
      r.rozdzial !== '90002' ||
      r.paragraf !== '0490'
    )
      throw new Error(`Budżet: nieoczekiwany wiersz ${JSON.stringify(r)}`)
    if (widziane.has(r.gmina_teryt)) throw new Error(`Budżet: powtórzony TERYT ${r.gmina_teryt}`)
    widziane.add(r.gmina_teryt)
    const w = Number(r.wykonanie)
    if (!Number.isFinite(w) || w < 0) throw new Error(`Budżet: zła kwota ${r.gmina_teryt}`)
    const l = populacja.get(r.gmina_teryt)
    if (l !== undefined) wynik.set(r.gmina_teryt, { wykonanie: w, ludnosc: l })
  }
  return wynik
}

// --- Składanie wskaźnika -----------------------------------------------------------------------------

/**
 * Rozbicie kosztu gminy na dwa składniki w pełnych złotych. Suma jest sumą zaokrąglonych
 * składników, więc liczby na karcie dodają się do siebie bez grosza różnicy.
 * Brak wpływów, brak mieszkańców, brak stawki albo wpływ poniżej progu związku gmin → null.
 */
export function rozbijGmine(odpady, stawka) {
  if (!odpady || !stawka) return null
  const naOsobe = odpady.wykonanie / odpady.ludnosc
  if (naOsobe < MIN_ODPADY_NA_OSOBE) return null
  if (naOsobe > MAKS_ODPADY_NA_OSOBE)
    throw new Error(`Wpływ z opłaty ${Math.round(naOsobe)} zł na osobę wygląda na błąd danych`)
  const smieci = Math.round(OSOBY * naOsobe)
  const podatek = Math.round(POWIERZCHNIA_M2 * stawka.stawkaZlM2)
  return { naOsobe, smieci, podatek, razem: smieci + podatek }
}

/** Opis do karty: z czego składa się liczba. Liczby bez separatora tysięcy, jak w pl-PL dla 4 cyfr. */
export function etykieta(r) {
  return `odpady ${r.smieci} zł + podatek ${r.podatek} zł (${OSOBY} os., ${POWIERZCHNIA_M2} m²)`
}

/**
 * Wartości i etykiety dla wszystkich adresów. Etykieta to klucz słownika (jeden wpis na gminę),
 * bo powtarzanie pełnego opisu przy 176 tys. adresów rozsadziłoby plik.
 */
export function zbudujWskaznik(adresy, odpady, stawki) {
  const teryty = [...new Set(adresy.map((a) => a.teryt))].sort()
  const rozbicia = new Map(teryty.map((t) => [t, rozbijGmine(odpady.get(t), stawki.get(t))]))
  const klucze = new Map()
  const slownikEtykiet = {}
  for (const [teryt, r] of rozbicia) {
    if (!r) continue
    const klucz = klucze.size.toString(36)
    klucze.set(teryt, klucz)
    slownikEtykiet[klucz] = etykieta(r)
  }
  return {
    rozbicia,
    slownikEtykiet,
    wartosci: adresy.map((a) => rozbicia.get(a.teryt)?.razem ?? null),
    etykiety: adresy.map((a) => klucze.get(a.teryt) ?? null),
  }
}

/** Metadane wskaźnika; daty pobrania z plików w cache, żeby drugi bieg nie udawał świeżego pobrania. */
export function zbudujMeta({ pobranoZdykty, urlBudzet, urlLudnosc, pobranoStawek }) {
  const cc = 'https://creativecommons.org/licenses/by/4.0/'
  return {
    id: ID,
    nazwa: 'Roczne koszty stałe mieszkania w gminie (szacunek)',
    opis: `Szacunek rocznych kosztów stałych wzorcowego gospodarstwa: ${OSOBY} osoby w mieszkaniu ${POWIERZCHNIA_M2} m² w budynku mieszkalnym. Opłata za odpady: ${OSOBY} × średni wpływ opłaty na mieszkańca gminy w ${ROK_ODPADOW} r. (dochody gminy w rozdz. 90002, §0490, podzielone przez liczbę mieszkańców według GUS). Podatek od nieruchomości: ${POWIERZCHNIA_M2} m² × stawka dla budynków mieszkalnych z uchwały rady gminy obowiązującej w ${ROK_STAWEK} r. To średnia gminy, nie rachunek konkretnego domu: wpływy z opłaty obejmują wszystkich płatników w gminie, także firmy i instytucje, więc wynik może odbiegać od faktycznej opłaty w obie strony. Pominięto udział w gruncie, ulgi i zwolnienia oraz wodę, energię, ogrzewanie i czynsz. Wartość dotyczy całej gminy, nie adresu. Źródło wtórne: z-dykty.pl; metoda: https://z-dykty.pl/metodologia`,
    jednostka: 'zł/rok',
    kategoria: 'kontekst',
    kierunek: 'neutralny',
    rozdzielczosc: 'gmina',
    zadanie: ZADANIE,
    zrodla: [
      {
        nazwa: 'z-dykty.pl – Podatki i opłaty lokalne gminy (przykład: Kraków)',
        url: 'https://z-dykty.pl/gmina/krakow-1261011/podatki',
        licencja: `Opracowanie CC BY 4.0 – ${cc}; atrybucja z-dykty.pl`,
        dataDanych: `rocznik ${ROK_ODPADOW}`,
        pobrano: pobranoZdykty,
      },
      {
        nazwa:
          'Ministerstwo Finansów – sprawozdania budżetowe JST Rb-27S, przetworzone przez z-dykty.pl (CC BY 4.0)',
        url: urlBudzet,
        licencja: `CC BY 4.0 (metadane zbioru na dane.gov.pl); przetworzone przez z-dykty.pl (CC BY 4.0) – ${cc}`,
        dataDanych: `rocznik ${ROK_ODPADOW}`,
        pobrano: pobranoZdykty,
      },
      {
        nazwa:
          'GUS – Bank Danych Lokalnych, ludność ogółem, przetworzone przez z-dykty.pl (CC BY 4.0)',
        url: urlLudnosc,
        licencja: `CC BY 4.0 (warunki Portalu API GUS); przetworzone przez z-dykty.pl (CC BY 4.0) – ${cc}`,
        dataDanych: `rocznik ${ROK_ODPADOW}`,
        pobrano: pobranoZdykty,
      },
      {
        nazwa:
          'Uchwały rad gmin w sprawie stawek podatku od nieruchomości – Dziennik Urzędowy Województwa Małopolskiego',
        url: `${ELI_BAZA}/`,
        licencja:
          'Akty prawa miejscowego: nie podlegają ochronie prawnoautorskiej (art. 4 pkt 1 ustawy o prawie autorskim i prawach pokrewnych)',
        dataDanych: `stawki obowiązujące w ${ROK_STAWEK} r.`,
        pobrano: pobranoStawek,
      },
    ],
  }
}

// --- Pobranie z z-dykty ------------------------------------------------------------------------------

function kluczZEnv(nazwa) {
  return process.env[nazwa] || kluczZPliku(join(KORZEN, '.env.local'), nazwa)
}

/** Zapytanie do PostgREST z-dykty; odpowiedź ląduje w etl/.cache/ (klucz idzie w nagłówku, nie w adresie). */
async function zapytajZdykty(tabela, filtry, plik) {
  const baza = kluczZEnv('ZDYKTY_SUPABASE_URL')
  const klucz = kluczZEnv('ZDYKTY_ANON_KEY')
  if (!baza || !klucz)
    throw new Error(
      'Brak ZDYKTY_SUPABASE_URL albo ZDYKTY_ANON_KEY (zmienna środowiska albo .env.local)',
    )
  const adres = `${baza.replace(/\/+$/, '')}/rest/v1/${tabela}?${new URLSearchParams(filtry)}`
  const sciezka = await pobierzDoCache(adres, plik, {
    headers: { apikey: klucz, accept: 'application/json' },
    signal: AbortSignal.timeout(60_000),
  })
  return { wiersze: JSON.parse(readFileSync(sciezka, 'utf8')), pobrano: dataPobrania(sciezka) }
}

async function pobierzOdpady(teryty) {
  if (teryty.length > MAKS_GMIN_W_ZAPYTANIU)
    throw new Error(`Więcej niż ${MAKS_GMIN_W_ZAPYTANIU} gmin w zapytaniu: dodaj stronicowanie`)
  const lista = `in.(${teryty.join(',')})`
  const skrot = createHash('sha256').update(teryty.join(',')).digest('hex').slice(0, 8)
  const budzet = await zapytajZdykty(
    'budzet_pozycje',
    {
      select: 'gmina_teryt,rok,strona,dzial,rozdzial,paragraf,plan,wykonanie,zrodlo_url',
      gmina_teryt: lista,
      rok: `eq.${ROK_ODPADOW}`,
      strona: 'eq.D',
      dzial: 'eq.900',
      rozdzial: 'eq.90002',
      paragraf: 'eq.0490',
    },
    `z-dykty-odpady-budzet-${ROK_ODPADOW}-${skrot}.json`,
  )
  const ludnosc = await zapytajZdykty(
    'wskazniki',
    {
      select: 'gmina_teryt,kod,rok,wartosc,jednostka,zrodlo_url',
      gmina_teryt: lista,
      kod: 'eq.ludnosc',
      rok: `eq.${ROK_ODPADOW}`,
    },
    `z-dykty-odpady-ludnosc-${ROK_ODPADOW}-${skrot}.json`,
  )
  const adresyZrodel = (wiersze, nazwa) => {
    const urle = new Set(wiersze.map((w) => w.zrodlo_url))
    if (urle.size !== 1)
      throw new Error(`${nazwa}: oczekiwano jednego adresu źródła, jest ${urle.size}`)
    return [...urle][0]
  }
  return {
    odpady: odczytajOdpady(budzet.wiersze, ludnosc.wiersze),
    urlBudzet: adresyZrodel(budzet.wiersze, 'budzet_pozycje'),
    urlLudnosc: adresyZrodel(ludnosc.wiersze, 'wskazniki'),
    pobrano: [budzet.pobrano, ludnosc.pobrano].sort()[0],
  }
}

/** Zapis wejścia do wskaźnika: 14 wierszy, żeby test i recenzent mogli policzyć wynik bez dostępu do z-dykty. */
function zapiszMigawke(odpady, { urlBudzet, urlLudnosc, pobrano }) {
  const gminy = {}
  for (const t of [...odpady.keys()].sort()) gminy[t] = odpady.get(t)
  const plik = {
    opis: 'Wejście wskaźnika gmina_koszty_stale_rok: wykonanie dochodów gminy w rozdz. 90002, §0490 (zł) i liczba mieszkańców. Plik generuje etl/koszty-stale.mjs z tabel budzet_pozycje i wskazniki w z-dykty.pl, nie edytuj ręcznie.',
    rok: ROK_ODPADOW,
    pobrano,
    zrodla: { budzet: urlBudzet, ludnosc: urlLudnosc },
    gminy,
  }
  writeFileSync(PLIK_ODPADOW, `${JSON.stringify(plik, null, 2)}\n`)
}

// --- Weryfikacja stawek względem ELI -------------------------------------------------------------------

async function pobierzEli(sciezka, opcje = {}) {
  try {
    return await fetch(`${ELI_BAZA}${sciezka}`, {
      headers: NAGLOWKI,
      signal: AbortSignal.timeout(60_000),
      ...opcje,
    })
  } catch (blad) {
    if (blad.cause?.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE')
      throw new Error(
        'Certyfikat e-dziennika nie przechodzi weryfikacji w Node: uruchom z flagą --use-system-ca (node --use-system-ca etl/koszty-stale.mjs --sprawdz-eli)',
      )
    throw blad
  }
}

/** Tekst PDF uchwały z ELI przez pdftotext (poppler); PDF ląduje w etl/.cache/eli/. */
async function tekstUchwaly(eli) {
  mkdirSync(join(CACHE, 'eli'), { recursive: true })
  const plik = `eli/${eli.replace(/\//g, '_')}.pdf`
  let sciezka
  try {
    sciezka = await pobierzDoCache(`${ELI_BAZA}/api/eli/acts/${eli}/text.pdf`, plik, {
      headers: NAGLOWKI,
      signal: AbortSignal.timeout(120_000),
    })
  } catch (blad) {
    if (blad.cause?.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE')
      throw new Error('Certyfikat e-dziennika: uruchom z flagą --use-system-ca')
    throw blad
  }
  try {
    return execFileSync('pdftotext', ['-enc', 'UTF-8', '-layout', sciezka, '-'], {
      encoding: 'utf8',
      maxBuffer: 20 * 1024 * 1024,
    })
  } catch (blad) {
    if (blad.code === 'ENOENT') throw new Error('Brak pdftotext (poppler) w PATH')
    throw new Error(`pdftotext nie odczytał ${sciezka} (usuń plik z cache i spróbuj ponownie)`)
  }
}

const bezSpacji = (s) => s.replace(/\s+/g, ' ').trim()

/** Porównuje każdy wpis z plikiem stawek z uchwałą w ELI: status, tytuł, stawka i rok wejścia w życie. */
export async function sprawdzStawkiWEli(stawki) {
  const wyniki = []
  for (const g of stawki.values()) {
    const bledy = []
    const meta = await (await pobierzEli(`/api/eli/acts/${g.akt.eli}`)).json()
    if (meta.status !== 'obowiązujący') bledy.push(`status w ELI: ${meta.status}`)
    if (bezSpacji(meta.title) !== bezSpacji(g.akt.tytul)) bledy.push('tytuł inny niż w pliku')
    const tekst = await tekstUchwaly(g.akt.eli)
    let odczytana = null
    try {
      odczytana = stawkaMieszkalne(tekst).stawka
      if (odczytana !== g.stawkaZlM2)
        bledy.push(`stawka w uchwale ${odczytana}, w pliku ${g.stawkaZlM2}`)
    } catch (blad) {
      bledy.push(blad.message)
    }
    const rok = g.akt.obowiazujeOd.slice(0, 4)
    if (!bezSpacji(tekst).includes(`1 stycznia ${rok}`))
      bledy.push(`tekst nie zawiera daty „1 stycznia ${rok}”`)
    wyniki.push({ teryt: g.teryt, gmina: g.gmina, eli: g.akt.eli, odczytana, bledy })
  }
  return wyniki
}

// --- Uruchomienie -------------------------------------------------------------------------------------------

function wczytajStawki() {
  return sprawdzStawki(JSON.parse(readFileSync(PLIK_STAWEK, 'utf8')))
}

async function sprawdzEli() {
  const stawki = wczytajStawki()
  const wyniki = await sprawdzStawkiWEli(stawki)
  for (const w of wyniki)
    console.log(
      `${w.bledy.length ? 'BŁĄD' : 'ok  '} ${w.teryt} ${w.gmina.padEnd(22)} ${String(w.odczytana).padEnd(5)} ${w.eli}${w.bledy.length ? ` – ${w.bledy.join('; ')}` : ''}`,
    )
  const zle = wyniki.filter((w) => w.bledy.length).length
  console.log(`Sprawdzono ${wyniki.length} uchwał w ELI, błędów: ${zle}`)
  if (zle) process.exitCode = 1
}

async function main() {
  const { adresy } = wczytajAdresy()
  const stawki = wczytajStawki()
  const teryty = [...new Set(adresy.map((a) => a.teryt))].sort()
  const { odpady, urlBudzet, urlLudnosc, pobrano } = await pobierzOdpady(teryty)
  zapiszMigawke(odpady, { urlBudzet, urlLudnosc, pobrano })
  const { wartosci, etykiety, slownikEtykiet, rozbicia } = zbudujWskaznik(adresy, odpady, stawki)
  const meta = zbudujMeta({
    pobranoZdykty: pobrano,
    urlBudzet,
    urlLudnosc,
    pobranoStawek: JSON.parse(readFileSync(PLIK_STAWEK, 'utf8')).sprawdzono,
  })
  zapiszWskaznik(meta, wartosci, etykiety, slownikEtykiet)
  const ileAdresow = new Map()
  for (const a of adresy) ileAdresow.set(a.teryt, (ileAdresow.get(a.teryt) ?? 0) + 1)
  const nazwy = new Map(adresy.map((a) => [a.teryt, a.gmina]))
  console.log('gmina                  adresów  zł/os.  odpady  zł/m²  podatek  razem')
  for (const [teryt, r] of rozbicia)
    console.log(
      `${nazwy.get(teryt).padEnd(22)} ${String(ileAdresow.get(teryt)).padStart(7)}  ${r ? r.naOsobe.toFixed(1).padStart(6) : '  brak'}  ${r ? String(r.smieci).padStart(6) : '      '}  ${stawki.get(teryt) ? stawki.get(teryt).stawkaZlM2.toFixed(2).padStart(5) : ' brak'}  ${r ? String(r.podatek).padStart(7) : '       '}  ${r ? String(r.razem).padStart(5) : ''}`,
    )
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  (process.argv.includes('--sprawdz-eli') ? sprawdzEli() : main()).catch((e) => {
    console.error(e.message)
    process.exitCode = 1
  })
