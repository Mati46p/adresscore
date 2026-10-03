// Wnioski „Czyste Powietrze” na 100 budynków jednorodzinnych w gminie (#141). Warstwa gminna: każdy
// adres gminy dostaje tę samą liczbę, a brak danych gminy to null, nigdy 0.
//
// Kategoria „przyszlosc”, kierunek „wiecej-lepiej” (tak ustalono w zadaniu #141): więcej wniosków
// o dopłatę do wymiany źródła ciepła i termomodernizacji znaczy więcej domów w gminie w trakcie
// przejścia na czystsze ogrzewanie. Warstwa jest stała w obrębie gminy, więc przesuwa o ten sam
// skok wynik wszystkich jej adresów (w odróżnieniu od warstw „kontekstu”, które wynik pomijają).
//
// Licznik: raport NFOŚiGW „Czyste Powietrze w liczbach od 31 marca 2025 r.” (PDF „Raport WoD nowego
// PPCP”, stan na 12.12.2025). Układ WFOŚiGW → powiat → gmina, bez TERYT: gminę łączymy z adresami
// po powiecie, nazwie i rodzaju gminy, a dopasowanie pilnuje kod gminy z rankingu (niżej).
// Bierzemy kolumnę „liczba wniosków o dofinansowanie ogółem” (wnioski złożone, nie umowy ani
// wypłaty); pozostałe kolumny (rodzaje źródeł ciepła, termomodernizacja) trafiają do etykiety.
//
// Mianownik: ranking gmin NFOŚiGW za okres 01.04.2022–31.12.2023 (stan na 31.12.2023), kolumna
// „Liczba budynków jednorodzinnych w całej gminie”. Ten sam wydawca i ten sam serwis co raport;
// ranking niesie kod gminy (TERYT, 7 cyfr), więc od razu wiadomo, którą gminę opisuje wiersz.
//
// Odczyt PDF: `pdftotext -raw` (kolejność strumienia, jeden wiersz tabeli = jedna linia). Tryb
// -layout rozjeżdża nazwy i liczby, bo komórki z nazwami są wyśrodkowane pionowo. Raport sprawdza
// się sam: sumy gmin zgadzają się z wierszem powiatu, powiaty z funduszem, fundusze z wierszem
// „Łącznie” (16 funduszy, 380 powiatów, 2477 gmin). Do migawki trafiają wiersze 4 powiatów
// obszaru (dosłownie, z numerem strony PDF) i 14 wierszy rankingu: etl/czyste-powietrze-dane.json.
//
// Uruchom: node etl/czyste-powietrze.mjs            (z migawki, bez sieci i bez pdftotext)
//          node --use-system-ca etl/czyste-powietrze.mjs --odswiez
//            (pobiera oba PDF-y do etl/.cache/, czyta je pdftotext, nadpisuje migawkę)
// Serwer czystepowietrze.gov.pl nie wysyła certyfikatu pośredniego, więc Node potrzebuje magazynu
// systemu (--use-system-ca); weryfikacji TLS nie wyłączamy.
// Test: node --test etl/czyste-powietrze.test.mjs. Opis metody i kontroli: etl/czyste-powietrze.md.
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { dataPobrania } from './lib/pobieranie.mjs'
import { KORZEN, pobierzDoCache, wczytajAdresy, zapiszWskaznik } from './lib/wspolne.mjs'

export const ID = 'gmina_czyste_powietrze_wnioski_100_domow'
export const ZADANIE = 141
export const PLIK_DANYCH = join(KORZEN, 'etl', 'czyste-powietrze-dane.json')

export const FUNDUSZ = 'WFOŚiGW w Krakowie'
export const WOJEWODZTWO = 'małopolskie'
/** Początek nowego programu wg strony raportu: „obejmuje okres od 31 marca 2025 r.”. */
export const POCZATEK_PROGRAMU = '2025-03-31'
/** Raport obejmuje całą Polskę: 16 funduszy, 380 powiatów (ziemskich i grodzkich) i 2477 gmin. */
export const OCZEKIWANE = { fundusze: 16, powiaty: 380, gminy: 2477 }

const RAPORT_STRONA =
  'https://czystepowietrze.gov.pl/efekty-programu/raport-nfosigw-czyste-powietrze-w-liczbach-od-31-marca-2025'
export const RAPORT_URL = `${RAPORT_STRONA}/Raport_WoD_nowego_PPCP_-_stan_na_12-12-2025.pdf`
const RANKING_STRONA =
  'https://czystepowietrze.gov.pl/partnerzy/gminy/ranking-gmin/drugi-ranking-gmin'
export const RANKING_URL =
  'https://czystepowietrze.gov.pl/wazne-komunikaty/ranking-gmin/ranking-gmin-01-04-2022-31-12-2023.pdf'
const PLIK_RAPORTU = 'czyste-powietrze-raport-wod-stan-2025-12-12.pdf'
const PLIK_RANKINGU = 'czyste-powietrze-ranking-gmin-2022-2023.pdf'
export const LICENCJA =
  'informacja publiczna, ponowne wykorzystanie z podaniem źródła; brak jawnej licencji otwartej'

/** Kolumny raportu w kolejności z PDF: klucz w kodzie i nagłówek z raportu (po sklejeniu linii). */
export const KOLUMNY = [
  ['wnioski', 'Liczba wniosków o dofinansowanie ogółem'],
  ['siec', 'Podłączenie do sieci ciepłowniczej'],
  ['pcPowWoda', 'Pompa ciepła powietrze/woda'],
  ['pcPowWodaPodw', 'Pompa ciepła powietrze/woda o podwyższonej klasie efektywności energetycznej'],
  ['pcPowPowA1', 'Pompa ciepła powietrze/powietrze (o klasie efektywności min. A+)'],
  ['pcPowPowA2', 'Pompa ciepła powietrze/powietrze (o klasie efektywności energetycznej min. A++)'],
  ['pcGrunt', 'Gruntowa pompa ciepła o podwyższonej klasie efektywności energetycznej'],
  ['kociolDrewno', 'Kocioł zgazowujący drewno o podwyższonym standardzie'],
  ['kociolPellet', 'Kocioł na pellet drzewny o podwyższonym standardzie'],
  ['elektryczne', 'Ogrzewanie elektryczne'],
  ['termo', 'Liczba wniosków obejmujących termomodernizację budynku'],
]
const POMPY = ['pcPowWoda', 'pcPowWodaPodw', 'pcPowPowA1', 'pcPowPowA2', 'pcGrunt']
const RODZAJE = { 1: 'gmina miejska', 2: 'gmina wiejska', 3: 'gmina miejsko-wiejska' }

// --- Pomocnicze: liczby i teksty --------------------------------------------------------------

/** Liczba z separatorem tysięcy jak w raporcie: „1 484” (zwykła spacja). */
export const jakWRaporcie = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')

/** Liczba do etykiety: od pięciu cyfr z twardą spacją, cztery cyfry bez separatora (norma PL). */
export const liczba = (n) =>
  n >= 10000 ? String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') : String(n)

export function odmiana(n, jeden, kilka, wiele) {
  if (n === 1) return jeden
  const j = n % 10
  const d = n % 100
  return j >= 2 && j <= 4 && !(d >= 12 && d <= 14) ? kilka : wiele
}

/** 2025-12-12 → 12.12.2025. */
export function dataPl(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? '')
  if (!m) throw new Error(`Data nie jest w formacie RRRR-MM-DD: ${iso}`)
  return `${m[3]}.${m[2]}.${m[1]}`
}

const dataIso = (pl) => pl.split('.').reverse().join('-')

/** Wartość wskaźnika: wnioski na 100 budynków, do 0,01 (tak jak zapisuje ją zapiszWskaznik). */
export function naSto(wnioski, budynki) {
  if (!Number.isFinite(wnioski) || !Number.isFinite(budynki) || budynki <= 0 || wnioski < 0)
    return null
  return Math.round((10000 * wnioski) / budynki) / 100
}

const przecinek = (v) => v.toFixed(2).replace('.', ',')

// --- Raport: układ WFOŚiGW → powiat → gmina ---------------------------------------------------

const WIERSZ_GMINY = /^(.+?) \| (gmina miejska|gmina wiejska|gmina miejsko-wiejska) (\d[\d ]*)$/u
const WIERSZ_LACZNIE = /^(Łącznie) (\d[\d ]*)$/u
const WIERSZ_FUNDUSZU = /^(WFOŚiGW (?:w|we) \p{L}+(?: \p{L}+)*) (\d[\d ]*)$/u
const WIERSZ_POWIATU = /^(\p{L}[\p{L} .'-]*?) (\d[\d ]*)$/u

/**
 * Jedenaście liczb wiersza jako obiekt wg KOLUMNY albo null, gdy liczb jest inaczej niż jedenaście
 * (separator tysięcy to też spacja, więc wiersz z liczbą ≥ 1000 ma więcej tokenów niż kolumn).
 */
export function liczbyWiersza(tekst) {
  const tokeny = tekst.trim().split(' ')
  if (tokeny.length !== KOLUMNY.length || !tokeny.every((t) => /^\d{1,3}$/.test(t))) return null
  return Object.fromEntries(KOLUMNY.map(([klucz], i) => [klucz, Number(tokeny[i])]))
}

/** Wiersz gminy z raportu (dosłowna linia z pdftotext -raw): nazwa, rodzaj i liczby. */
export function odczytajWierszGminy(wiersz) {
  const m = WIERSZ_GMINY.exec(wiersz.trim())
  if (!m) throw new Error(`To nie jest wiersz gminy z raportu: „${wiersz}”`)
  const wartosci = liczbyWiersza(m[3])
  if (!wartosci)
    throw new Error(`Wiersz gminy ma inną liczbę kolumn niż ${KOLUMNY.length}: „${wiersz}”`)
  return { nazwa: m[1], rodzaj: m[2], wartosci }
}

/** Sprawdza, że nagłówki kolumn na pierwszej stronie raportu mają kolejność z KOLUMNY. */
export function sprawdzNaglowek(tekst) {
  const pierwsza = tekst.split('\f')[0].replace(/\s+/g, ' ').replace(/\/ /g, '/')
  let od = 0
  for (const [, naglowek] of KOLUMNY) {
    const i = pierwsza.indexOf(naglowek, od)
    if (i < 0)
      throw new Error(
        `Raport: brak nagłówka „${naglowek}” po wcześniejszych (inna kolejność kolumn?)`,
      )
    od = i + naglowek.length
  }
}

/** Data stanu z nagłówka każdej strony: „Dane wg stanu na 12.12.2025 r.”. Musi być jedna. */
export function stanRaportu(tekst) {
  const daty = new Set(
    [...tekst.matchAll(/Dane wg stanu na (\d{2}\.\d{2}\.\d{4}) r\./g)].map((m) => dataIso(m[1])),
  )
  if (daty.size !== 1) throw new Error(`Raport: oczekiwano jednej daty stanu, jest ${daty.size}`)
  return [...daty][0]
}

/** Suma kolumn po dzieciach, zapisana tak jak w raporcie (do porównania z wierszem rodzica). */
function sumaJakWRaporcie(dzieci) {
  return KOLUMNY.map(([klucz]) =>
    jakWRaporcie(dzieci.reduce((s, d) => s + d.wartosci[klucz], 0)),
  ).join(' ')
}

/**
 * Cały raport jako drzewo fundusz → powiat → gmina, z dosłownymi wierszami i numerem strony PDF.
 * Każdy poziom sprawdza się sumą: gminy dają wiersz powiatu, powiaty wiersz funduszu, fundusze
 * wiersz „Łącznie”. Porównujemy teksty, więc wiersze z separatorem tysięcy nie wymagają zgadywania.
 * Błąd sumy oznacza gubienie albo dublowanie wierszy przy odczycie PDF.
 */
export function odczytajRaport(tekst, oczekiwane = OCZEKIWANE) {
  sprawdzNaglowek(tekst)
  const stan = stanRaportu(tekst)
  const fundusze = []
  let lacznie = null
  let fundusz = null
  let powiat = null
  tekst.split('\f').forEach((strona, i) => {
    for (const surowa of strona.split(/\r?\n/)) {
      const wiersz = surowa.trim()
      let m = WIERSZ_LACZNIE.exec(wiersz)
      if (m) {
        lacznie = { wiersz, strona: i + 1, liczby: m[2] }
        continue
      }
      m = WIERSZ_FUNDUSZU.exec(wiersz)
      if (m) {
        fundusz = { nazwa: m[1], wiersz, strona: i + 1, liczby: m[2], powiaty: [] }
        fundusze.push(fundusz)
        powiat = null
        continue
      }
      m = WIERSZ_GMINY.exec(wiersz)
      if (m) {
        if (!powiat) throw new Error(`Raport: gmina przed pierwszym powiatem: „${wiersz}”`)
        powiat.gminy.push({ ...odczytajWierszGminy(wiersz), wiersz, strona: i + 1 })
        continue
      }
      m = WIERSZ_POWIATU.exec(wiersz)
      if (m) {
        if (!fundusz) throw new Error(`Raport: powiat przed pierwszym funduszem: „${wiersz}”`)
        powiat = { nazwa: m[1], wiersz, strona: i + 1, liczby: m[2], gminy: [] }
        fundusz.powiaty.push(powiat)
      }
    }
  })
  if (!lacznie) throw new Error('Raport: brak wiersza „Łącznie”')
  let gmin = 0
  let powiatow = 0
  for (const f of fundusze) {
    for (const p of f.powiaty) {
      if (!p.gminy.length) throw new Error(`Raport: powiat ${p.nazwa} bez gmin`)
      const suma = sumaJakWRaporcie(p.gminy)
      if (suma !== p.liczby)
        throw new Error(
          `Raport: gminy powiatu ${p.nazwa} (${f.nazwa}) dają ${suma}, wiersz ma ${p.liczby}`,
        )
      p.wartosci = Object.fromEntries(
        KOLUMNY.map(([k]) => [k, p.gminy.reduce((s, g) => s + g.wartosci[k], 0)]),
      )
      gmin += p.gminy.length
      powiatow++
    }
    const suma = sumaJakWRaporcie(f.powiaty)
    if (suma !== f.liczby)
      throw new Error(`Raport: powiaty ${f.nazwa} dają ${suma}, wiersz ma ${f.liczby}`)
    f.wartosci = Object.fromEntries(
      KOLUMNY.map(([k]) => [k, f.powiaty.reduce((s, p) => s + p.wartosci[k], 0)]),
    )
  }
  const sumaPolska = KOLUMNY.map(([k]) =>
    jakWRaporcie(fundusze.reduce((s, f) => s + f.wartosci[k], 0)),
  ).join(' ')
  if (sumaPolska !== lacznie.liczby)
    throw new Error(`Raport: fundusze dają ${sumaPolska}, wiersz „Łącznie” ma ${lacznie.liczby}`)
  if (
    oczekiwane &&
    (fundusze.length !== oczekiwane.fundusze ||
      powiatow !== oczekiwane.powiaty ||
      gmin !== oczekiwane.gminy)
  )
    throw new Error(
      `Raport: ${fundusze.length} funduszy, ${powiatow} powiatów, ${gmin} gmin (oczekiwano ${oczekiwane.fundusze}, ${oczekiwane.powiaty}, ${oczekiwane.gminy})`,
    )
  return {
    stan,
    fundusze,
    lacznie,
    kontrola: { fundusze: fundusze.length, powiaty: powiatow, gminy: gmin },
  }
}

// --- Ranking gmin: kod gminy i liczba budynków jednorodzinnych --------------------------------

const WIERSZ_RANKINGU =
  /^(\d+)\. (\S+) (\d{7}) (.+) \((\d)\) (miejska|wiejska|miejsko-wiejska) (.+?) (\d{1,3}(?: \d{3})*(?: \d{1,3}(?: \d{3})*)?) (\d+,\d{2})%$/u
const LICZBA_Z_SEPARATOREM = /^\d{1,3}(?: \d{3})*$/

/**
 * Dwie liczby z tokenów „2 137 265” albo „41 172 1 019”: spacja dzieli kolumny i grupy tysięcy,
 * więc bierzemy podziały, w których obie części są poprawnymi liczbami, i zostawiamy ten, który
 * zgadza się ze wskaźnikiem z tego samego wiersza (wnioski / budynki, do 0,01 punktu proc.).
 */
export function podzielLiczby(tekst, wskaznikPct) {
  const tokeny = tekst.trim().split(' ')
  const wyniki = []
  for (let k = 1; k < tokeny.length; k++) {
    const a = tokeny.slice(0, k).join(' ')
    const b = tokeny.slice(k).join(' ')
    if (!LICZBA_Z_SEPARATOREM.test(a) || !LICZBA_Z_SEPARATOREM.test(b)) continue
    const budynki = Number(a.replaceAll(' ', ''))
    const wnioski = Number(b.replaceAll(' ', ''))
    if (budynki > 0 && naSto(wnioski, budynki) === wskaznikPct) wyniki.push({ budynki, wnioski })
  }
  return wyniki
}

/** Jeden wiersz rankingu: dosłowna linia z pdftotext -raw → obiekt albo błąd z powodem. */
export function odczytajWierszRankingu(wiersz) {
  const m = WIERSZ_RANKINGU.exec(wiersz.trim())
  if (!m) throw new Error(`To nie jest wiersz rankingu: „${wiersz}”`)
  const [, lp, wojewodztwo, teryt, nazwa, , rodzaj, powiat, liczby, procent] = m
  const wskaznik = Number(procent.replace(',', '.'))
  const podzialy = podzielLiczby(liczby, wskaznik)
  if (podzialy.length !== 1)
    throw new Error(
      `Ranking: liczby „${liczby}” (${procent}%) dzielą się na ${podzialy.length} sposobów: „${wiersz}”`,
    )
  // Rodzaj sprawdzamy słowem względem siódmej cyfry TERYT. Cyfra w nawiasie po nazwie jest w PDF
  // niespójna (22 gminy miejsko-wiejskie mają przy nazwie „(2)”), więc jej nie porównujemy.
  if (RODZAJE[teryt[6]] !== `gmina ${rodzaj}`)
    throw new Error(`Ranking: rodzaj gminy niezgodny z kodem ${teryt}: „${wiersz}”`)
  return {
    lp: Number(lp),
    wojewodztwo,
    teryt,
    nazwa,
    rodzaj: `gmina ${rodzaj}`,
    powiat,
    ...podzialy[0],
    wskaznik,
  }
}

/**
 * Wszystkie wiersze rankingu po TERYT. Wiersze, których nie da się odczytać jednoznacznie (w PDF są
 * dwa z literówką w kodzie albo bez rodzaju), trafiają do `pominiete`: potrzebne są tylko gminy
 * obszaru, a brak któregoś z 14 wierszy zatrzyma budowę migawki. Kolejność wierszy to kontrola
 * odczytu: ranking jest posortowany malejąco po wskaźniku aktywności.
 */
export function odczytajRanking(tekst) {
  const wiersze = new Map()
  const pominiete = []
  let poprzedni = null
  tekst.split('\f').forEach((strona, i) => {
    for (const surowa of strona.split(/\r?\n/)) {
      const linia = surowa.trim()
      if (!/^\d+\. /.test(linia)) continue
      let w
      try {
        w = odczytajWierszRankingu(linia)
      } catch {
        pominiete.push(linia)
        continue
      }
      if (poprzedni && (w.lp <= poprzedni.lp || w.wskaznik > poprzedni.wskaznik))
        throw new Error(`Ranking: zaburzona kolejność przy wierszu „${linia}”`)
      if (wiersze.has(w.teryt)) throw new Error(`Ranking: powtórzony kod gminy ${w.teryt}`)
      wiersze.set(w.teryt, { ...w, wiersz: linia, strona: i + 1 })
      poprzedni = w
    }
  })
  return { wiersze, pominiete }
}

/** Okres i stan rankingu z nagłówka PDF: „01.04.2022 - 31.12.2023” i „na dzień 31.12.2023 r.”. */
export function okresRankingu(tekst) {
  const pierwsza = tekst.split('\f')[0].replace(/\s+/g, ' ')
  const okres = /okres (\d{2}\.\d{2}\.\d{4}) - (\d{2}\.\d{2}\.\d{4})/.exec(pierwsza)
  const stan = /na dzień (\d{2}\.\d{2}\.\d{4}) r\./.exec(pierwsza)
  if (!okres || !stan) throw new Error('Ranking: brak okresu albo daty stanu w nagłówku')
  return { od: dataIso(okres[1]), do: dataIso(okres[2]), stan: dataIso(stan[1]) }
}

// --- Migawka: 4 powiaty z raportu i 14 wierszy rankingu ---------------------------------------

/**
 * Migawka wejścia (zapisywana do JSON): dosłowne wiersze z numerem strony PDF, bez liczb
 * wyliczonych, żeby recenzent mógł je porównać z PDF-em, a test odtworzyć każdą sumę.
 * `gminy`: [{ teryt, gmina }] z adresów.
 */
export function zbudujMigawke({ raport, ranking, okres, gminy, zrodla }) {
  const wybrane = []
  const powiaty = []
  for (const g of [...gminy].sort((a, b) => (a.teryt < b.teryt ? -1 : 1))) {
    const r = ranking.wiersze.get(g.teryt)
    if (!r)
      throw new Error(
        `Ranking: brak gminy ${g.gmina} (${g.teryt})${ranking.pominiete.some((l) => l.includes(g.teryt)) ? ', wiersz jest w PDF, ale nie da się go odczytać' : ''}`,
      )
    if (r.nazwa !== g.gmina)
      throw new Error(`Ranking: kod ${g.teryt} to „${r.nazwa}”, w adresach „${g.gmina}”`)
    if (r.wojewodztwo !== WOJEWODZTWO)
      throw new Error(`Ranking: ${g.gmina} nie leży w ${WOJEWODZTWO}`)
    wybrane.push({
      teryt: g.teryt,
      gmina: g.gmina,
      ranking: { strona: r.strona, wiersz: r.wiersz },
    })
    if (!powiaty.includes(r.powiat)) powiaty.push(r.powiat)
  }
  const fundusz = raport.fundusze.find((f) => f.nazwa === FUNDUSZ)
  if (!fundusz) throw new Error(`Raport: brak funduszu ${FUNDUSZ}`)
  return {
    opis: 'Wejście wskaźnika gmina_czyste_powietrze_wnioski_100_domow: dosłowne wiersze raportu NFOŚiGW „Czyste Powietrze w liczbach” (4 powiaty, wszystkie ich gminy) i rankingu gmin NFOŚiGW (14 gmin obszaru) z numerem strony PDF. Plik generuje etl/czyste-powietrze.mjs --odswiez (pdftotext -raw), nie edytuj ręcznie.',
    raport: {
      ...zrodla.raport,
      stan: raport.stan,
      fundusz: FUNDUSZ,
      kontrola: raport.kontrola,
      lacznie: raport.lacznie.liczby,
    },
    ranking: {
      ...zrodla.ranking,
      okresOd: okres.od,
      okresDo: okres.do,
      stan: okres.stan,
      wierszy: ranking.wiersze.size,
      pominiete: ranking.pominiete.length,
    },
    powiaty: powiaty.map((nazwa) => {
      const p = fundusz.powiaty.find((x) => x.nazwa === nazwa)
      if (!p) throw new Error(`Raport: brak powiatu ${nazwa} w ${FUNDUSZ}`)
      return {
        nazwa,
        strona: p.strona,
        wiersz: p.wiersz,
        gminy: p.gminy.map((g) => ({ strona: g.strona, wiersz: g.wiersz })),
      }
    }),
    gminy: wybrane,
  }
}

/**
 * Sprawdza migawkę i zwraca dane 14 gmin: Map TERYT → { gmina, powiat, rodzaj, wnioski, kolumny,
 * budynki, wskaznik2022 }. Każda gmina ma dokładnie jeden wiersz w raporcie (po powiecie, nazwie
 * i rodzaju), a sumy gmin 4 powiatów zgadzają się z wierszami powiatów co do jednej liczby.
 */
export function sprawdzMigawke(plik, nazwyGmin) {
  const bledy = []
  const wiersze = new Map()
  for (const p of plik?.powiaty ?? []) {
    const gminy = p.gminy.map((g) => ({ ...odczytajWierszGminy(g.wiersz), strona: g.strona }))
    const m = WIERSZ_POWIATU.exec(p.wiersz)
    if (!m || m[1] !== p.nazwa) bledy.push(`powiat ${p.nazwa}: wiersz „${p.wiersz}”`)
    else if (sumaJakWRaporcie(gminy) !== m[2])
      bledy.push(`powiat ${p.nazwa}: gminy dają ${sumaJakWRaporcie(gminy)}, wiersz ma ${m[2]}`)
    wiersze.set(p.nazwa, gminy)
  }
  const wynik = new Map()
  const widziane = new Set()
  for (const g of plik?.gminy ?? []) {
    const nazwa = `${g.teryt ?? '?'} ${g.gmina ?? '?'}`
    if (!/^\d{7}$/.test(g.teryt ?? '')) bledy.push(`${nazwa}: teryt to 7 cyfr`)
    if (widziane.has(g.teryt)) bledy.push(`${nazwa}: powtórzony TERYT`)
    widziane.add(g.teryt)
    if (nazwyGmin.get(g.teryt) !== g.gmina)
      bledy.push(`${nazwa}: w adresach „${nazwyGmin.get(g.teryt) ?? 'brak'}”`)
    let r
    try {
      r = odczytajWierszRankingu(g.ranking.wiersz)
    } catch (blad) {
      bledy.push(`${nazwa}: ${blad.message}`)
      continue
    }
    if (r.teryt !== g.teryt || r.nazwa !== g.gmina)
      bledy.push(`${nazwa}: wiersz rankingu opisuje ${r.teryt} ${r.nazwa}`)
    const kandydaci = (wiersze.get(r.powiat) ?? []).filter(
      (w) => w.nazwa === g.gmina && w.rodzaj === r.rodzaj,
    )
    if (kandydaci.length !== 1) {
      bledy.push(
        `${nazwa}: w raporcie ${kandydaci.length} wierszy dla powiatu ${r.powiat}, ${r.rodzaj}`,
      )
      continue
    }
    wynik.set(g.teryt, {
      teryt: g.teryt,
      gmina: g.gmina,
      powiat: r.powiat,
      rodzaj: r.rodzaj,
      kolumny: kandydaci[0].wartosci,
      wnioski: kandydaci[0].wartosci.wnioski,
      budynki: r.budynki,
      wnioski2022: r.wnioski,
      wskaznik2022: r.wskaznik,
    })
  }
  for (const teryt of nazwyGmin.keys())
    if (!widziane.has(teryt)) bledy.push(`${teryt} ${nazwyGmin.get(teryt)}: brak w migawce`)
  if (bledy.length) throw new Error(`Migawka Czystego Powietrza: ${bledy.join('; ')}`)
  return wynik
}

// --- Składanie wskaźnika ------------------------------------------------------------------------

/**
 * Opis do karty: liczby gminy i rodzaje źródeł ciepła we wnioskach. Wniosek może obejmować wymianę
 * źródła ciepła, termomodernizację albo obie rzeczy; kolumny raportu liczą wnioski z daną pozycją.
 */
export function etykieta(g, stan) {
  const k = g.kolumny
  const pozycje = [
    ['kocioł na pellet', k.kociolPellet],
    ['kocioł na drewno', k.kociolDrewno],
    ['pompa ciepła', POMPY.reduce((s, klucz) => s + k[klucz], 0)],
    ['ogrzewanie elektryczne', k.elektryczne],
    ['sieć ciepłownicza', k.siec],
  ]
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
  const zrodla = pozycje.length
    ? pozycje.map(([nazwa, n]) => `${nazwa} ${n}`).join(', ')
    : 'brak wniosków z wymianą źródła ciepła'
  return `${g.gmina}: ${liczba(g.wnioski)} ${odmiana(g.wnioski, 'wniosek', 'wnioski', 'wniosków')} o dofinansowanie z programu Czyste Powietrze (od ${dataPl(POCZATEK_PROGRAMU)} do ${dataPl(stan)}) na ${liczba(g.budynki)} budynków jednorodzinnych w gminie, czyli ${przecinek(naSto(g.wnioski, g.budynki))} na 100 domów. Wymiana źródła ciepła we wnioskach: ${zrodla}. Termomodernizacja we wnioskach: ${k.termo}. Wynik całej gminy, nie okolicy adresu.`
}

/**
 * Wartości i etykiety dla wszystkich adresów. Etykieta to klucz słownika (jeden wpis na gminę),
 * bo powtarzanie pełnego opisu przy 176 tys. adresów rozsadziłoby plik. Gmina bez licznika albo
 * mianownika dostaje null i brak etykiety.
 */
export function zbudujWskaznik(adresy, dane, stan) {
  const teryty = [...new Set(adresy.map((a) => a.teryt))].sort()
  const wartosci = new Map(
    teryty.map((t) => {
      const g = dane.get(t)
      return [t, g ? naSto(g.wnioski, g.budynki) : null]
    }),
  )
  const klucze = new Map()
  const slownikEtykiet = {}
  for (const t of teryty) {
    if (wartosci.get(t) === null) continue
    const klucz = klucze.size.toString(36)
    klucze.set(t, klucz)
    slownikEtykiet[klucz] = etykieta(dane.get(t), stan)
  }
  return {
    poGminie: wartosci,
    slownikEtykiet,
    wartosci: adresy.map((a) => wartosci.get(a.teryt)),
    etykiety: adresy.map((a) => klucze.get(a.teryt) ?? null),
  }
}

/** Metadane wskaźnika; daty pobrania i stanu bierzemy z migawki, nie z zegara. */
export function zbudujMeta(migawka) {
  const { raport, ranking } = migawka
  return {
    id: ID,
    nazwa: 'Wnioski Czyste Powietrze na 100 domów w gminie',
    opis: `Liczba wniosków o dofinansowanie z programu Czyste Powietrze (nowy program, od ${dataPl(POCZATEK_PROGRAMU)} do ${dataPl(raport.stan)}) na 100 budynków jednorodzinnych w gminie. Wniosek może dotyczyć wymiany źródła ciepła (kocioł, pompa ciepła), termomodernizacji albo obu. To wnioski złożone, nie umowy ani wypłaty, i obejmują niespełna dziewięć miesięcy trwania nowego programu, więc nie opisują całej historii dopłat do pieców. Liczba budynków jednorodzinnych pochodzi z rankingu gmin NFOŚiGW (stan na ${dataPl(ranking.stan)}). Wartość dotyczy całej gminy, nie adresu.`,
    jednostka: 'wniosków/100 domów',
    kategoria: 'przyszlosc',
    kierunek: 'wiecej-lepiej',
    rozdzielczosc: 'gmina',
    rozmiar: 'gmina',
    zadanie: ZADANIE,
    zrodla: [
      {
        nazwa: `Narodowy Fundusz Ochrony Środowiska i Gospodarki Wodnej (NFOŚiGW) – Raport „Czyste Powietrze w liczbach od 31 marca 2025 r.” (Raport WoD nowego PPCP): wnioski o dofinansowanie wg gmin`,
        url: raport.url,
        licencja: LICENCJA,
        dataDanych: raport.stan,
        pobrano: raport.pobrano,
      },
      {
        nazwa: `Narodowy Fundusz Ochrony Środowiska i Gospodarki Wodnej (NFOŚiGW) – Ranking gmin w programie Czyste Powietrze za okres ${dataPl(ranking.okresOd)}–${dataPl(ranking.okresDo)}: liczba budynków jednorodzinnych w gminie`,
        url: ranking.url,
        licencja: LICENCJA,
        dataDanych: ranking.stan,
        pobrano: ranking.pobrano,
      },
    ],
  }
}

// --- Pobranie i odczyt PDF (tryb --odswiez) -----------------------------------------------------

async function pobierzPdf(url, plik) {
  try {
    return await pobierzDoCache(url, plik, { signal: AbortSignal.timeout(120_000) })
  } catch (blad) {
    if (blad.cause?.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE')
      throw new Error(
        'Certyfikat czystepowietrze.gov.pl nie przechodzi weryfikacji w Node (serwer nie wysyła certyfikatu pośredniego): uruchom z flagą --use-system-ca',
      )
    throw blad
  }
}

/** Tekst PDF w kolejności strumienia (`pdftotext -raw`) i wersja narzędzia do migawki. */
function tekstPdf(sciezka) {
  const wersja = spawnSync('pdftotext', ['-v'], { encoding: 'utf8' })
  if (wersja.error?.code === 'ENOENT') throw new Error('Brak pdftotext (poppler albo Xpdf) w PATH')
  const wynik = spawnSync('pdftotext', ['-enc', 'UTF-8', '-raw', sciezka, '-'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  if (wynik.status !== 0)
    throw new Error(`pdftotext nie odczytał ${sciezka} (usuń plik z cache i spróbuj ponownie)`)
  const narzedzie = `${(wersja.stderr || wersja.stdout).split(/\r?\n/)[0].trim()} -raw`
  return { tekst: wynik.stdout, narzedzie }
}

const sha256 = (sciezka) => createHash('sha256').update(readFileSync(sciezka)).digest('hex')

async function odswiezMigawke(adresy) {
  const sciezkaRaportu = await pobierzPdf(RAPORT_URL, PLIK_RAPORTU)
  const sciezkaRankingu = await pobierzPdf(RANKING_URL, PLIK_RANKINGU)
  const { tekst: tekstRaportu, narzedzie } = tekstPdf(sciezkaRaportu)
  const { tekst: tekstRankingu } = tekstPdf(sciezkaRankingu)
  const raport = odczytajRaport(tekstRaportu)
  const ranking = odczytajRanking(tekstRankingu)
  const okres = okresRankingu(tekstRankingu)
  const gminy = [
    ...new Map(adresy.map((a) => [a.teryt, { teryt: a.teryt, gmina: a.gmina }])).values(),
  ]
  const migawka = zbudujMigawke({
    raport,
    ranking,
    okres,
    gminy,
    zrodla: {
      raport: {
        nazwa:
          'Raport NFOŚiGW – Czyste Powietrze w liczbach od 31 marca 2025 r. (Raport WoD nowego PPCP)',
        strona: RAPORT_STRONA,
        url: RAPORT_URL,
        sha256: sha256(sciezkaRaportu),
        pobrano: dataPobrania(sciezkaRaportu),
        narzedzie,
      },
      ranking: {
        nazwa: 'Ranking gmin NFOŚiGW w programie Czyste Powietrze',
        strona: RANKING_STRONA,
        url: RANKING_URL,
        sha256: sha256(sciezkaRankingu),
        pobrano: dataPobrania(sciezkaRankingu),
        narzedzie,
      },
    },
  })
  // sprawdzenie od razu, zanim migawka trafi na dysk
  sprawdzMigawke(migawka, new Map(gminy.map((g) => [g.teryt, g.gmina])))
  writeFileSync(PLIK_DANYCH, `${JSON.stringify(migawka, null, 2)}\n`)
  console.log(
    `Raport: ${raport.kontrola.fundusze} funduszy, ${raport.kontrola.powiaty} powiatów, ${raport.kontrola.gminy} gmin, sumy zgodne do wiersza „Łącznie”; ranking: ${ranking.wiersze.size} gmin odczytanych, ${ranking.pominiete.length} pominiętych (literówki w PDF)`,
  )
}

// --- Uruchomienie ------------------------------------------------------------------------------

export function wczytajMigawke() {
  return JSON.parse(readFileSync(PLIK_DANYCH, 'utf8'))
}

async function main() {
  const { adresy } = wczytajAdresy()
  if (process.argv.includes('--odswiez')) await odswiezMigawke(adresy)
  const migawka = wczytajMigawke()
  const nazwy = new Map(adresy.map((a) => [a.teryt, a.gmina]))
  const dane = sprawdzMigawke(migawka, nazwy)
  const w = zbudujWskaznik(adresy, dane, migawka.raport.stan)
  zapiszWskaznik(zbudujMeta(migawka), w.wartosci, w.etykiety, w.slownikEtykiet)
  const ile = new Map()
  for (const a of adresy) ile.set(a.teryt, (ile.get(a.teryt) ?? 0) + 1)
  console.log('gmina                  adresów  wnioski  domów jednorodz.  na 100 domów')
  for (const [teryt, g] of [...dane].sort(
    (a, b) => b[1].wnioski / b[1].budynki - a[1].wnioski / a[1].budynki,
  ))
    console.log(
      `${g.gmina.padEnd(22)} ${String(ile.get(teryt)).padStart(7)}  ${String(g.wnioski).padStart(7)}  ${String(g.budynki).padStart(16)}  ${String(w.poGminie.get(teryt)).padStart(11)}`,
    )
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch((e) => {
    console.error(e.message)
    process.exitCode = 1
  })
