// Kompakt: transport pochodny z public/dane/adresy.json i wskazniki/*.json (#34).
// Źródłem prawdy zostaje JSON z kontraktu. Kompakt układa te same dane tak, żeby pierwszy widok
// (mapa, ranking, panel) ściągał kilkaset kB zamiast 10 MB: „heksy najpierw, adresy na żądanie".
//
//   node etl/kompakt.mjs             – generuje public/dane/kompakt/ (idempotentnie)
//   node etl/kompakt.mjs --sprawdz   – kod wyjścia 1, gdy kompakt nie odpowiada JSON-om
//
// Pliki:
//   indeks.json        – wersja, skale warstw, lista kafli; loader porównuje go z manifestem
//   heksy.<skrót>.bin  – heksy r10 (i rodzice r9, r8): liczba adresów, główna ulica, dzielnica
//   warstwy/<id>.<skrót>.bin – jedna warstwa na heksach r10, r9, r8: średnia ocena 0–100
//                        i udział adresów z danymi. Start ładuje tylko warstwy z wagą > 0,
//                        reszta dochodzi przy włączeniu – macierz nie rośnie z liczbą warstw.
//   filtry/<id>.<skrót>.bin – min i max oceny heksów r10 jednej warstwy → twardy filtr
//   kafle/<r7>.<skrót>.json.gz – adresy jednego heksu H3 r7 z surowymi wartościami i etykietami
//                        wszystkich warstw → karta, porównanie, klik w mapę
//   szukaj.<skrót>.bin – ulice, numery i miejscowości wszystkich adresów → wyszukiwarka
//   id.<skrót>.bin     – id wszystkich adresów → tylko stare linki bez podpowiedzi heksu
//
// Oceny liczy ten sam silnik co przeglądarka (src/wynik/silnik.ts), więc skala, percentyle
// i kierunki nie mają drugiej implementacji. Ocenę zapisujemy dla kierunku „więcej = lepiej";
// „mniej = lepiej" to dokładnie 100 − ocena (patrz ocenWartosc).
//
// Format .bin: gzip( 'AKS1' | u32 LE długość nagłówka | nagłówek JSON | sekcje po 8 bajtów ).
// Sekcje wielobajtowe mają przetasowane bajty (płaszczyzny), bo gzip ściska je lepiej.
// Dekoder: src/wynik/kompakt.ts.
//
// Każdy gzip ma nagłówek niezależny od systemu (etl/lib/gzip.mjs): nazwy plików niosą skrót ich
// bajtów, więc bez tego ten sam kompakt policzony na macOS, Linuksie i Windowsie dostawał inne
// nazwy, a `--sprawdz` zwracał 1 na czystym main (#179). Nie wołaj tu `gzipSync` wprost.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cellToParent } from 'h3-js'
import { ocenyWskaznika, przygotujWskaznik } from '../src/wynik/silnik.ts'
import { gzipDeterministyczny } from './lib/gzip.mjs'

export const FORMAT = 2
/** Rozdzielczość kafla adresów: r7 to ok. 450 adresów (najwyżej ~2700) w Krakowie. */
export const RES_KAFLA = 7
/** Kafel r7 z większą liczbą adresów dzielimy na dzieci r8 (cel: kafel poniżej ok. 100 kB gzip). */
export const MAKS_KAFEL = 1500
/** Ocena heksu w u8: 0–100, 255 = brak danych. Pół punktu kosztowało 20% więcej bajtów. */
export const SKALA_OCENY = 1
/** Udział adresów z danymi w u8: 0–200 = udział × 200. */
export const SKALA_UDZIALU = 200
export const BRAK_U8 = 255
const MAGIA = 'AKS1'
const TYPY = {
  u8: Uint8Array,
  u16: Uint16Array,
  u32: Uint32Array,
  i32: Int32Array,
  f64: Float64Array,
}

// ── Plik binarny ─────────────────────────────────────────────────────────────────────────

function tasuj(tablica) {
  const bajty = new Uint8Array(tablica.buffer, tablica.byteOffset, tablica.byteLength)
  const w = tablica.BYTES_PER_ELEMENT
  if (w === 1) return bajty
  const n = tablica.length
  const wynik = new Uint8Array(bajty.length)
  for (let i = 0; i < n; i++) for (let b = 0; b < w; b++) wynik[b * n + i] = bajty[i * w + b]
  return wynik
}

function typTablicy(tablica) {
  for (const [nazwa, Typ] of Object.entries(TYPY)) if (tablica instanceof Typ) return nazwa
  throw new Error('Nieobsługiwany typ sekcji')
}

/** Składa nagłówek i sekcje (obiekt nazwa → tablica typowana) w jeden plik gzip. */
export function zapakuj(naglowek, sekcje) {
  const opisy = Object.entries(sekcje).map(([nazwa, t]) => ({
    nazwa,
    typ: typTablicy(t),
    n: t.length,
  }))
  const json = Buffer.from(JSON.stringify({ ...naglowek, sekcje: opisy }), 'utf8')
  const wyrownaj = (x) => Math.ceil(x / 8) * 8
  const dlugosc = Buffer.alloc(4)
  dlugosc.writeUInt32LE(json.length)
  const czesci = [Buffer.from(MAGIA, 'ascii'), dlugosc, json]
  czesci.push(Buffer.alloc(wyrownaj(8 + json.length) - 8 - json.length))
  for (const t of Object.values(sekcje)) {
    const bajty = tasuj(t)
    czesci.push(Buffer.from(bajty.buffer, bajty.byteOffset, bajty.byteLength))
    czesci.push(Buffer.alloc(wyrownaj(bajty.byteLength) - bajty.byteLength))
  }
  return gzipDeterministyczny(Buffer.concat(czesci))
}

// ── Kolumny ──────────────────────────────────────────────────────────────────────────────

const typDla = (max) => (max <= 0xff ? 'u8' : max <= 0xffff ? 'u16' : 'u32')

/** Kolumna z powtórzeniami (ulica, gmina, kod…) → słownik + indeksy. null zostaje w słowniku. */
export function kolumnaSlownikowa(nazwa, wartosci) {
  const pozycja = new Map()
  const slownik = []
  const indeksy = new Uint32Array(wartosci.length)
  for (let i = 0; i < wartosci.length; i++) {
    const v = wartosci[i] ?? null
    let p = pozycja.get(v)
    if (p === undefined) {
      p = slownik.length
      pozycja.set(v, p)
      slownik.push(v)
    }
    indeksy[i] = p
  }
  return {
    opis: { rodzaj: 'slownik', sekcja: nazwa, slownik },
    sekcje: { [nazwa]: TYPY[typDla(Math.max(0, slownik.length - 1))].from(indeksy) },
  }
}

const H3 = /^[0-9a-f]{15}$/

/** Posortowana lista heksów jako para u32 (górne 7 i dolne 8 cyfr szesnastkowych). */
export function kolumnaListyHeksow(nazwa, heksy) {
  if (!heksy.every((h) => H3.test(h))) throw new Error(`Nietypowy indeks H3 w ${nazwa}`)
  return {
    opis: { rodzaj: 'h3', gora: `${nazwa}Gora`, dol: `${nazwa}Dol` },
    sekcje: {
      [`${nazwa}Gora`]: Uint32Array.from(heksy, (h) => Number.parseInt(h.slice(0, 7), 16)),
      [`${nazwa}Dol`]: Uint32Array.from(heksy, (h) => Number.parseInt(h.slice(7), 16)),
    },
  }
}

const LICZBA = /^([^0-9]*-)([1-9]\d{0,14})$/
const UUID = /^([^0-9]*-)([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/

/** Id adresów: „msip-<liczba>" jako różnice f64, „prg-<uuid>" jako 16 bajtów, reszta tekstem. */
export function kolumnaId(ids) {
  const rodzaje = []
  const klucze = new Map()
  const rodzaj = new Uint8Array(ids.length)
  const liczby = []
  const uuid = []
  const inne = []
  const rodzajDla = (prefiks, typ) => {
    const k = `${typ}|${prefiks}`
    let r = klucze.get(k)
    if (r === undefined) {
      r = rodzaje.length
      if (r > 255) throw new Error('Ponad 255 prefiksów id')
      klucze.set(k, r)
      rodzaje.push({ prefiks, typ })
    }
    return r
  }
  let poprzednia = 0
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i]
    const u = UUID.exec(id)
    const l = u ? null : LICZBA.exec(id)
    if (u) {
      rodzaj[i] = rodzajDla(u[1], 'uuid')
      uuid.push(u[2].replaceAll('-', ''))
    } else if (l) {
      rodzaj[i] = rodzajDla(l[1], 'liczba')
      const v = Number(l[2])
      liczby.push(v - poprzednia)
      poprzednia = v
    } else {
      rodzaj[i] = rodzajDla('', 'tekst')
      inne.push(id)
    }
  }
  const bajtyUuid = new Uint8Array(uuid.length * 16)
  uuid.forEach((h, k) => {
    for (let b = 0; b < 16; b++)
      bajtyUuid[k * 16 + b] = Number.parseInt(h.slice(2 * b, 2 * b + 2), 16)
  })
  return {
    opis: { rodzaj: 'id', rodzaje, inne, sekcja: 'idRodzaj', liczby: 'idLiczby', uuid: 'idUuid' },
    sekcje: { idRodzaj: rodzaj, idLiczby: Float64Array.from(liczby), idUuid: bajtyUuid },
  }
}

function polacz(kolumny) {
  const opisy = {}
  const sekcje = {}
  for (const [nazwa, k] of Object.entries(kolumny)) {
    if (k.opis) opisy[nazwa] = k.opis
    for (const [s, t] of Object.entries(k.sekcje)) {
      if (s in sekcje) throw new Error(`Powtórzona sekcja ${s}`)
      sekcje[s] = t
    }
  }
  return { opisy, sekcje }
}

// ── Agregaty heksów ──────────────────────────────────────────────────────────────────────

/**
 * Średnia, min, max ocen i udział adresów z danymi dla każdej grupy (heksu) i warstwy.
 * `grupa[i]` = indeks heksu i-tego adresu. Tablice warstwa-major: [warstwa × liczbaGrup].
 */
export function agregujOceny(ocenyWarstw, grupa, liczbaGrup) {
  const L = ocenyWarstw.length
  const razem = new Uint32Array(liczbaGrup)
  for (let i = 0; i < grupa.length; i++) razem[grupa[i]]++
  const srednia = new Uint8Array(L * liczbaGrup).fill(BRAK_U8)
  const udzial = new Uint8Array(L * liczbaGrup)
  const min = new Uint8Array(L * liczbaGrup).fill(BRAK_U8)
  const max = new Uint8Array(L * liczbaGrup).fill(BRAK_U8)
  const suma = new Float64Array(liczbaGrup)
  const liczba = new Uint32Array(liczbaGrup)
  const mn = new Float64Array(liczbaGrup)
  const mx = new Float64Array(liczbaGrup)
  for (let k = 0; k < L; k++) {
    const oceny = ocenyWarstw[k]
    suma.fill(0)
    liczba.fill(0)
    mn.fill(Infinity)
    mx.fill(-Infinity)
    for (let i = 0; i < grupa.length; i++) {
      const o = oceny[i]
      if (o !== o) continue
      const g = grupa[i]
      suma[g] += o
      liczba[g]++
      if (o < mn[g]) mn[g] = o
      if (o > mx[g]) mx[g] = o
    }
    for (let g = 0; g < liczbaGrup; g++) {
      const p = k * liczbaGrup + g
      udzial[p] = Math.round((SKALA_UDZIALU * liczba[g]) / razem[g])
      if (liczba[g] === 0) continue
      srednia[p] = Math.round((suma[g] / liczba[g]) * SKALA_OCENY)
      // Zaokrąglenie na zewnątrz: filtr na heksie wyklucza tylko wtedy, gdy na pewno.
      min[p] = Math.floor(mn[g])
      max[p] = Math.ceil(mx[g])
    }
  }
  return { razem, srednia, udzial, min, max }
}

/** Najczęstsza wartość w każdej grupie (nazwa ulicy, dzielnica heksu do rankingu). */
function dominanta(wartosci, grupa, liczbaGrup) {
  const liczniki = Array.from({ length: liczbaGrup }, () => new Map())
  for (let i = 0; i < grupa.length; i++) {
    const m = liczniki[grupa[i]]
    m.set(wartosci[i], (m.get(wartosci[i]) ?? 0) + 1)
  }
  return liczniki.map((m) => {
    let best = null
    let ile = -1
    for (const [v, c] of m) {
      if (c > ile || (c === ile && String(v) < String(best))) {
        best = v
        ile = c
      }
    }
    return best
  })
}

// ── Składanie całości (czyste, bez dysku – testowalne) ───────────────────────────────────

const skrot = (bufor) => createHash('sha256').update(bufor).digest('hex')
const porownajPl = new Intl.Collator('pl', { numeric: true }).compare

/**
 * Z pliku adresów i plików wskaźników daje indeks i mapę ścieżka → zawartość.
 * Nazwa pliku niesie skrót treści, więc te same JSON-y dają te same bajty i nazwy.
 * `kolejnosc[j]` = indeks w adresy.json adresu, który w kompakcie ma indeks j.
 */
export function zbudujKompakt(plikAdresow, plikiWskaznikow, okolice = null) {
  const k = plikAdresow.kolumny
  const n = k.id.length
  const pliki = new Map()
  const dodaj = (nazwa, zawartosc, rozszerzenie = 'bin') => {
    const sha256 = skrot(zawartosc)
    const sciezka = `${nazwa}.${sha256.slice(0, 10)}.${rozszerzenie}`
    pliki.set(sciezka, zawartosc)
    return { plik: sciezka, bajty: zawartosc.length, sha256 }
  }
  const dodajBin = (nazwa, naglowek, kolumny) => {
    const { opisy, sekcje } = polacz(kolumny)
    return dodaj(nazwa, zapakuj({ format: FORMAT, ...naglowek, kolumny: opisy }, sekcje))
  }

  // Heksy posortowane jako tekst = jako liczba H3, więc dzieci jednego rodzica (r7, r8, r9)
  // leżą obok siebie: kafel to ciągły zakres adresów, a heks to ciągły zakres w kaflu.
  const heksy = [...new Set(k.h3)].sort()
  const pozycjaHeksu = new Map(heksy.map((h, p) => [h, p]))
  const heksAdresu = Uint32Array.from(k.h3, (h) => pozycjaHeksu.get(h))
  const nazwaUlicy = k.ulica.map((u, i) => u ?? k.miejscowosc[i])
  const ulicaHeksu = dominanta(nazwaUlicy, heksAdresu, heksy.length)

  // Kolejność adresów w kompakcie: heks, potem najpierw jego główna ulica, ulica, numer.
  // Pierwszy adres heksu reprezentuje go w rankingu (link do karty).
  const glowna = (i) => Number(nazwaUlicy[i] !== ulicaHeksu[heksAdresu[i]])
  const kolejnosc = Array.from({ length: n }, (_, i) => i).sort(
    (a, b) =>
      heksAdresu[a] - heksAdresu[b] ||
      glowna(a) - glowna(b) ||
      porownajPl(nazwaUlicy[a] ?? '', nazwaUlicy[b] ?? '') ||
      porownajPl(k.nr[a] ?? '', k.nr[b] ?? '') ||
      a - b,
  )
  const wgKolejnosci = (kolumna) => kolejnosc.map((i) => kolumna[i])
  const grupa10 = Uint32Array.from(kolejnosc, (i) => heksAdresu[i])
  const odHeksu = new Uint32Array(heksy.length)
  for (let i = 0; i < grupa10.length; i++) {
    if (i === 0 || grupa10[i] !== grupa10[i - 1]) odHeksu[grupa10[i]] = i
  }

  const wersja = plikAdresow.wersja
  const zgodne = []
  const pominiete = {}
  for (const w of [...plikiWskaznikow].sort((a, b) => a.meta.id.localeCompare(b.meta.id))) {
    if (w.wersjaAdresow === wersja && w.wartosci.length === n) zgodne.push(w)
    else pominiete[w.meta.id] = w.wersjaAdresow
  }
  const przygotowane = zgodne.map((w) => przygotujWskaznik(w))
  const ocenyWarstw = przygotowane.map((w) => {
    const oceny = ocenyWskaznika(w, 'wiecej-lepiej')
    return Float32Array.from(kolejnosc, (i) => oceny[i])
  })

  // Poziomy r10 (adres → heks) i rodzice r9, r8 (dla mapy przy oddaleniu).
  const poziom = (res) => {
    if (res === 10) return { lista: heksy, grupa: grupa10 }
    const rodzicHeksu = heksy.map((h) => cellToParent(h, res))
    const lista = [...new Set(rodzicHeksu)].sort()
    const p = new Map(lista.map((h, j) => [h, j]))
    const rodzic = Uint32Array.from(rodzicHeksu, (h) => p.get(h))
    return { lista, grupa: Uint32Array.from(grupa10, (g) => rodzic[g]) }
  }
  const poziomy = [10, 9, 8].map((res) => ({ res, ...poziom(res) }))
  const kolumnyHeksow = {}
  const agregaty = []
  for (const { res, lista, grupa } of poziomy) {
    const a = agregujOceny(ocenyWarstw, grupa, lista.length)
    agregaty.push(a)
    kolumnyHeksow[`r${res}`] = kolumnaListyHeksow(`h3r${res}`, lista)
    kolumnyHeksow[`liczba${res}`] = {
      sekcje: {
        [`liczba${res}`]: TYPY[typDla(a.razem.reduce((x, y) => Math.max(x, y), 0))].from(a.razem),
      },
    }
  }
  const dzielnicaHeksu = dominanta(
    k.dzielnica.map((d, i) => d ?? k.gmina[i]),
    heksAdresu,
    heksy.length,
  )
  kolumnyHeksow.ulica = kolumnaSlownikowa('ulica', ulicaHeksu)
  kolumnyHeksow.dzielnica = kolumnaSlownikowa('dzielnica', dzielnicaHeksu)
  kolumnyHeksow.od = { sekcje: { od: odHeksu } }
  const naglowekHeksow = {
    n,
    wersja,
    skalaOceny: SKALA_OCENY,
    skalaUdzialu: SKALA_UDZIALU,
    brak: BRAK_U8,
  }
  const plikHeksow = dodajBin('heksy', naglowekHeksow, kolumnyHeksow)

  // Jedna warstwa = jeden plik: wiersz macierzy dla każdej rozdzielczości.
  const plikiWarstw = {}
  const plikiFiltrow = {}
  przygotowane.forEach((w, j) => {
    const sekcje = {}
    poziomy.forEach(({ res, lista }, p) => {
      const H = lista.length
      sekcje[`ocena${res}`] = agregaty[p].srednia.slice(j * H, (j + 1) * H)
      sekcje[`udzial${res}`] = agregaty[p].udzial.slice(j * H, (j + 1) * H)
    })
    const id = w.meta.id
    plikiWarstw[id] = dodajBin(`warstwy/${id}`, { ...naglowekHeksow, id }, { dane: { sekcje } })
    const H = heksy.length
    const a = agregaty[0]
    plikiFiltrow[id] = dodajBin(
      `filtry/${id}`,
      { ...naglowekHeksow, id },
      {
        dane: {
          sekcje: {
            udzial: a.udzial.slice(j * H, (j + 1) * H),
            min: a.min.slice(j * H, (j + 1) * H),
            max: a.max.slice(j * H, (j + 1) * H),
          },
        },
      },
    )
  })

  // Kafle: ciągłe zakresy adresów (dzięki sortowaniu heksów). Heks r7 ma zwykle ok. 450 adresów,
  // ale w gęstej zabudowie ponad 2000 (kafel ~200 kB gzip), więc taki r7 dzielimy na dzieci r8.
  // Dzieci r8 są ciągłe w kolejności kompaktu z tego samego powodu co r7: indeks H3 trzyma
  // rodzica w górnych bitach, więc sortowanie po r10 zagnieżdża r7 → r8 → r10 bez zmiany klucza.
  const kafle = []
  const dodajKafel = (od, doo, res) => {
    const klucz = cellToParent(heksy[grupa10[od]], res)
    const zakres = kolejnosc.slice(od, doo)
    const kolumny = {}
    for (const nazwa of Object.keys(k)) kolumny[nazwa] = zakres.map((i) => k[nazwa][i] ?? null)
    // `i` = pozycja adresu w adresy.json (kolejność kompaktu jest inna): pozwala dolać dane
    // kafla do tablic zbudowanych z pełnego pliku bez przeszukiwania po id.
    kolumny.i = zakres
    const wartosci = {}
    const etykiety = {}
    for (const w of zgodne) {
      wartosci[w.meta.id] = zakres.map((i) => w.wartosci[i])
      if (w.etykiety?.some((e) => e !== null)) {
        etykiety[w.meta.id] = zakres.map((i) => w.etykiety[i] ?? null)
      }
    }
    const tresc = {
      format: FORMAT,
      wersja,
      kafel: klucz,
      od,
      n: doo - od,
      kolumny,
      wartosci,
      etykiety,
    }
    const plik = dodaj(
      `kafle/${klucz}`,
      gzipDeterministyczny(Buffer.from(JSON.stringify(tresc))),
      'json.gz',
    )
    kafle.push({ h3: klucz, res, od, n: doo - od, plik: plik.plik })
  }
  const koniecGrupy = (od, res) => {
    const klucz = cellToParent(heksy[grupa10[od]], res)
    let doo = od
    while (doo < n && cellToParent(heksy[grupa10[doo]], res) === klucz) doo++
    return doo
  }
  for (let od = 0, doo; od < n; od = doo) {
    doo = koniecGrupy(od, RES_KAFLA)
    if (doo - od <= MAKS_KAFEL) {
      dodajKafel(od, doo, RES_KAFLA)
      continue
    }
    for (let o = od, d; o < doo; o = d) {
      d = koniecGrupy(o, RES_KAFLA + 1)
      dodajKafel(o, d, RES_KAFLA + 1)
    }
  }

  // Okolice: prostokąt [[zachód, południe], [wschód, północ]] i liczba adresów każdej okolicy.
  // Tak samo jak graniceOkolicy (src/mapa/luki): adresy bez położenia (0,0) pomijamy. Minimalny
  // bok (MIN_BOK) dokłada aplikacja, bo to decyzja kamery, nie danych.
  let plikOkolic = null
  if (okolice) {
    const ramki = {}
    okolice.kolumny.okolica.forEach((p, i) => {
      if (p === null || p === undefined) return
      const lon = k.lon[i]
      const lat = k.lat[i]
      if (!Number.isFinite(lon) || !Number.isFinite(lat) || (lon === 0 && lat === 0)) return
      const id = okolice.idOkolic[p]
      const r = ramki[id]
      if (!r)
        ramki[id] = {
          prostokat: [
            [lon, lat],
            [lon, lat],
          ],
          n: 1,
        }
      else {
        const [[z, s], [w, pn]] = r.prostokat
        r.prostokat = [
          [Math.min(z, lon), Math.min(s, lat)],
          [Math.max(w, lon), Math.max(pn, lat)],
        ]
        r.n++
      }
    })
    const posortowane = Object.fromEntries(
      Object.entries(ramki).sort(([a], [b]) => (a < b ? -1 : 1)),
    )
    plikOkolic = dodaj(
      'okolice',
      Buffer.from(JSON.stringify({ format: FORMAT, wersjaAdresow: wersja, okolice: posortowane })),
      'json',
    )
  }

  const plikSzukaj = dodajBin(
    'szukaj',
    { n, wersja },
    Object.fromEntries(
      ['miejscowosc', 'ulica', 'nr', 'kod', 'dzielnica', 'gmina', 'teryt'].map((nazwa) => [
        nazwa,
        kolumnaSlownikowa(nazwa, wgKolejnosci(k[nazwa])),
      ]),
    ),
  )
  const plikId = dodajBin('id', { n, wersja }, { id: kolumnaId(wgKolejnosci(k.id)) })

  // Wersja kompaktu: adresy + treść każdej warstwy. Zmiana czegokolwiek = nowa wersja.
  const h = createHash('sha256').update(wersja)
  for (const w of zgodne) h.update(skrot(JSON.stringify(w)))
  const wskazniki = {}
  const skale = {}
  przygotowane.forEach((w, j) => {
    let zDanymi = 0
    for (const v of w.wartosci) if (v !== null && v === v) zDanymi++
    wskazniki[w.meta.id] = {
      wersjaAdresow: zgodne[j].wersjaAdresow,
      meta: w.meta,
      pokrycie: { zDanymi, wszystkich: n },
      heksy: plikiWarstw[w.meta.id],
      filtr: plikiFiltrow[w.meta.id],
    }
    skale[w.meta.id] = w.skala
  })
  // Skale osobno: karta potrzebuje ich dopiero z pierwszym kaflem, a skala percentylowa
  // może nieść tablicę progów, która nie powinna obciążać startu.
  const plikSkal = dodaj('skale', Buffer.from(JSON.stringify(skale)), 'json')
  const indeks = {
    format: FORMAT,
    wersja: h.digest('hex').slice(0, 12),
    wersjaAdresow: wersja,
    n,
    zrodla: plikAdresow.zrodla,
    ...(plikAdresow.atrapa ? { atrapa: true } : {}),
    resKafla: RES_KAFLA,
    // Dodatki formatu 2 (addytywne): stary kod je ignoruje, nowy po nich pozna, że kafle niosą
    // kolumnę `i`, mogą być r8, a okolice są w pliku bocznym – i startuje z kompaktu.
    rozszerzenia: ['i', 'r8', 'okolice'],
    ...(plikOkolic ? { okolice: plikOkolic } : {}),
    heksy: plikHeksow,
    skale: plikSkal,
    szukaj: plikSzukaj,
    id: plikId,
    wskazniki,
    pominiete,
    kafle,
  }
  return { indeks, pliki, kolejnosc }
}

// ── Dysk ─────────────────────────────────────────────────────────────────────────────────

const KORZEN = join(dirname(fileURLToPath(import.meta.url)), '..')
// ADRESCORE_MIASTO=<slug> → public/dane/miasta/<slug> (jak w lib/wspolne.mjs)
const MIASTO = process.env.ADRESCORE_MIASTO || null
const DANE = join(KORZEN, 'public', 'dane', ...(MIASTO ? ['miasta', MIASTO] : []))
// ADRESCORE_KOMPAKT_WYJSCIE=<katalog> – zapis do osobnego katalogu bazowego (test na kopii, bez
// ruszania wspólnych danych); wejście zostaje jak zawsze w public/dane.
const WYJSCIE = process.env.ADRESCORE_KOMPAKT_WYJSCIE || null
const KOMPAKT = WYJSCIE
  ? join(WYJSCIE, ...(MIASTO ? ['miasta', MIASTO] : []), 'kompakt')
  : join(DANE, 'kompakt')

export function wczytajZrodla(dane = DANE) {
  const plikAdresow = JSON.parse(readFileSync(join(dane, 'adresy.json'), 'utf8'))
  const katalog = join(dane, 'wskazniki')
  const pliki = existsSync(katalog) ? readdirSync(katalog).filter((p) => p.endsWith('.json')) : []
  const wskazniki = pliki.map((p) => JSON.parse(readFileSync(join(katalog, p), 'utf8')))
  // Okolice tylko Krakowa; plik z innej wersji adresów albo o złej długości pomijamy jak aplikacja.
  const sciezkaOkolic = join(dane, 'okolice.json')
  let okolice = null
  if (existsSync(sciezkaOkolic)) {
    const o = JSON.parse(readFileSync(sciezkaOkolic, 'utf8'))
    if (
      o.wersjaAdresow === plikAdresow.wersja &&
      o.kolumny.okolica.length === plikAdresow.kolumny.id.length
    )
      okolice = o
  }
  return { plikAdresow, wskazniki, okolice }
}

function plikiNaDysku(katalog) {
  if (!existsSync(katalog)) return []
  return readdirSync(katalog, { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile())
    .map((d) => relative(katalog, join(d.parentPath, d.name)))
}

function main() {
  const t0 = performance.now()
  const { plikAdresow, wskazniki, okolice } = wczytajZrodla()
  const { indeks, pliki } = zbudujKompakt(plikAdresow, wskazniki, okolice)
  const indeksJson = `${JSON.stringify(indeks)}\n`
  const sciezkaIndeksu = join(KOMPAKT, 'indeks.json')

  if (process.argv.includes('--sprawdz')) {
    const obecny = existsSync(sciezkaIndeksu) ? readFileSync(sciezkaIndeksu, 'utf8') : ''
    const brakujace = [...pliki.keys()].filter((p) => !existsSync(join(KOMPAKT, p)))
    if (obecny !== indeksJson || brakujace.length) {
      console.error('Kompakt nieaktualny – uruchom: node etl/kompakt.mjs')
      process.exit(1)
    }
    console.log('Kompakt aktualny.')
    return
  }

  const potrzebne = new Set([...pliki.keys(), 'indeks.json'])
  for (const p of plikiNaDysku(KOMPAKT)) if (!potrzebne.has(p)) rmSync(join(KOMPAKT, p))
  for (const [p, bufor] of pliki) {
    const cel = join(KOMPAKT, p)
    if (existsSync(cel)) continue // nazwa ze skrótem = ta sama treść
    mkdirSync(dirname(cel), { recursive: true })
    writeFileSync(cel, bufor)
  }
  writeFileSync(sciezkaIndeksu, indeksJson)

  const kb = (b) => `${(b / 1024).toFixed(0)} KB`
  const gz = (b) => gzipDeterministyczny(b).length
  const kafleGz = indeks.kafle.map((x) => pliki.get(x.plik).length)
  const r8 = indeks.kafle.filter((x) => x.res === 8).length
  const warstwy = Object.values(indeks.wskazniki).map((w) => w.heksy.bajty)
  const sumaW = warstwy.reduce((a, b) => a + b, 0)
  const srW = sumaW / Math.max(1, warstwy.length)
  const sr = kafleGz.reduce((a, b) => a + b, 0) / kafleGz.length
  console.log(
    `kompakt ${indeks.wersja}: heksy ${kb(indeks.heksy.bajty)} + indeks ${kb(gz(Buffer.from(indeksJson)))} gzip, ` +
      `warstwa śr. ${kb(srW)} (razem ${kb(sumaW)}, ${warstwy.length} warstw); ` +
      `${indeks.kafle.length} kafli (r8: ${r8}), okolice ${indeks.okolice ? kb(indeks.okolice.bajty) : '–'}, śr. ${kb(sr)} gzip (max ${kb(Math.max(...kafleGz))}); ` +
      `szukaj ${kb(indeks.szukaj.bajty)}, id ${kb(indeks.id.bajty)} (${(performance.now() - t0).toFixed(0)} ms)`,
  )
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main()
