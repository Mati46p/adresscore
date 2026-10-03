// Zabytki z rejestru NID w promieniu 500 m od adresu (#143). Kategoria „kontekst": fakt na karcie,
// bez wpływu na wynik (sąsiedztwo zabytku bywa atutem okolicy i ograniczeniem, więc kierunek jest
// neutralny). Etykieta mówi, czy sam adres leży w obrysie obiektu z rejestru, na obszarze wpisanym
// (zespół, park, cmentarz, układ urbanistyczny) albo w otoczeniu zabytku.
//
// Dlaczego nie CSV i REST API NID: otwarte pliki NID (dane.gov.pl, zbiór 1130, CC BY 4.0) mają
// adresy bez współrzędnych, a po adresie PRG da się zlokalizować tylko część pozycji (to robi
// zabytki.mjs, #125: poza Krakowem 11% adresów). Usługi WFS NID obejmują tylko Pomniki Historii
// i listę UNESCO. Geometrię całego rejestru oddaje wyłącznie publiczna usługa przeglądania INSPIRE
// (WMS Immovable_Monuments), więc skrypt czyta z niej wektory i identyfikatory (etl/lib/nid-wms.mjs):
//   1. jedno żądanie GetMap w formacie SVG dla całego regionu adresów (obiekty w kolejności bazy);
//   2. sondy GetFeatureInfo w punktach pokrywanych przez obiekty: odpowiedź to INSPIREID i nazwy
//      obiektów pod punktem w tej samej kolejności, więc i-ty identyfikator należy do i-tego obiektu
//      SVG. Sondy się nakładają, a każdy obiekt jest sprawdzany wielokrotnie, jeśli leży pod wieloma;
//      sprzeczność identyfikatorów zatrzymuje eksport;
//   3. identyfikator niesie typ wpisu (BK budynek, BL budowla, MA mała architektura, ZE zespół,
//      ZZ park, CM cmentarz, UU układ urbanistyczny, KK krajobraz, SK szlak, OT otoczenie). Otoczenia
//      i strefy ochrony (516 z 3197 wpisów regionu, 16%) nie są zabytkami, więc nie liczą się do
//      wartości, ale trafiają do etykiety, bo roboty w otoczeniu też wymagają zgody konserwatora.
//
// Wartość: liczba różnych wpisów (INSPIREID) w promieniu, liczona po odległości od obrysu, więc
// obiekt, w którym leży adres, wlicza się (0 m). Wpis rysowany jako kilka obiektów liczy się raz.
// 0 to „brak wpisu w danych NID w tym promieniu"; pozycje, których NID nie zlokalizował (ok. 1%
// wykazu), nie są liczone, więc wartość jest dolnym oszacowaniem.
//
// Kontrola jakości (każdy bieg, wynik w logu): pokrycie wykazu CSV zbioru 1130 przez obiekty usługi
// (po INSPIREID), odległość punktów PRG od obiektu o tym samym identyfikatorze (dokładne
// dopasowanie adresu z CSV), liczba obiektów bez identyfikatora i sprzeczności sond.
//
// Uruchom: node etl/zabytki-nid.mjs. Surowe pobrania w etl/.cache/ (zabytki-nid-*: SVG regionu,
// sondy GetFeatureInfo, zasoby i CSV zbioru 1130); żeby pobrać ponownie, usuń te pliki.
import { createHash } from 'node:crypto'
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import KDBush from 'kdbush'
import { do2180, odlegloscDoBbox } from './lib/geo.mjs'
import {
  IndeksPokrycia,
  klasaWpisu,
  NAGLOWKI_NID,
  odlegloscDoObiektu,
  oknoZapytania,
  parsujGfi,
  parsujSvg,
  planujSondy,
  przypiszId,
  rozbierzId,
  TYP_OTOCZENIA,
  urlGetFeatureInfo,
  urlGetMap,
  WMS_REJESTRU,
} from './lib/nid-wms.mjs'
import { CACHE, DANE, pobierzDoCache, wczytajAdresy, zapiszWskaznik } from './lib/wspolne.mjs'
import { dekodujNid, gminaNid, norm, rekordyNid } from './zabytki.mjs'

export const PROMIEN_M = 500
const ZBIOR = 'https://dane.gov.pl/pl/dataset/1130,rejestr-zabytkow-nieruchomych'
const ZASOBY = 'https://api.dane.gov.pl/1.4/datasets/1130/resources'
const CAPABILITIES = `${WMS_REJESTRU}?request=GetCapabilities&service=WMS`
const LICENCJA = `CC BY 4.0 (dane.gov.pl, zbiór 1130: ${ZBIOR}); metadane INSPIRE: brak ograniczeń w dostępie i użyciu`
const ROWNOLEGLE_SONDY = 5

/** Etykiety adresu: ranga decyduje, którą pokazać, gdy adres leży w kilku wpisach naraz. */
const RANGA = { obiekt: 3, obszar: 2, otoczenie: 1 }
const KLASY_WG_RANGI = [null, 'otoczenie', 'obszar', 'obiekt']

export const SLOWNIK_ETYKIET = {
  obiekt:
    'Adres leży w obrysie obiektu z rejestru zabytków – prace przy nim wymagają pozwolenia konserwatora.',
  obszar:
    'Adres leży na obszarze z rejestru zabytków (zespół, park, cmentarz lub układ urbanistyczny) – czy to dotyczy budynku, rozstrzyga konserwator.',
  otoczenie:
    'Adres leży w otoczeniu zabytku z rejestru – roboty budowlane w otoczeniu wymagają pozwolenia konserwatora.',
}

// ── Pobieranie ───────────────────────────────────────────────────────────────────────────────

const pauza = (ms) => new Promise((r) => setTimeout(r, ms))

/** Tekst z kilkoma próbami; odpowiedź inna niż 200 albo urwana to błąd, nie dane. */
async function pobierzTekst(url, limitMs) {
  let ostatni
  for (let proba = 1; proba <= 4; proba++) {
    try {
      const odp = await fetch(url, { headers: NAGLOWKI_NID, signal: AbortSignal.timeout(limitMs) })
      if (odp.ok) return await odp.text()
      ostatni = new Error(`${url.slice(0, 120)} → ${odp.status}`)
    } catch (blad) {
      ostatni = blad
    }
    await pauza(1500 * proba)
  }
  throw ostatni
}

/**
 * SVG regionu do etl/.cache/ (raz). Odpowiedź z błędem usługi (HTTP 200 z ServiceExceptionReport)
 * nie trafia do cache, bo kolejne biegi czytałyby awarię jako dane.
 */
async function pobierzSvg(okno) {
  const nazwa = `zabytki-nid-imd-${okno.x0}_${okno.y0}-${okno.szer}x${okno.wys}-${okno.rozdz}.svg`
  const cel = join(CACHE, nazwa)
  if (!existsSync(cel)) {
    const tekst = await pobierzTekst(urlGetMap(okno), 600_000)
    parsujSvg(tekst, okno)
    mkdirSync(CACHE, { recursive: true })
    writeFileSync(cel, tekst)
  }
  return { tekst: readFileSync(cel, 'utf8'), plik: cel }
}

export const kluczSondy = (s) => `${s.x.toFixed(2)},${s.y.toFixed(2)}`

function wczytajCacheSond(plik) {
  const cache = new Map()
  if (!existsSync(plik)) return cache
  for (const linia of readFileSync(plik, 'utf8').split('\n')) {
    if (!linia) continue
    try {
      const w = JSON.parse(linia)
      cache.set(w.k, w.o)
    } catch {
      // ostatnia linia urwana przez przerwany bieg: sonda zostanie wykonana ponownie
    }
  }
  return cache
}

/** Wykonuje fn na elementach z ograniczoną liczbą równoległych zadań; wyniki w kolejności wejścia. */
export async function rownolegle(elementy, limit, fn) {
  const wyniki = new Array(elementy.length)
  let nastepny = 0
  const pracownik = async () => {
    while (nastepny < elementy.length) {
      const i = nastepny++
      wyniki[i] = await fn(elementy[i], i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, elementy.length) }, pracownik))
  return wyniki
}

/** Sondy GetFeatureInfo z cache JSONL (dopisywanym na bieżąco, więc przerwany bieg wznawia się). */
async function wykonajSondy(sondy, plikCache) {
  const cache = wczytajCacheSond(plikCache)
  let wykonane = 0
  const start = Date.now()
  return rownolegle(sondy, ROWNOLEGLE_SONDY, async (s) => {
    const klucz = kluczSondy(s)
    if (cache.has(klucz)) return cache.get(klucz)
    try {
      const obiekty = parsujGfi(await pobierzTekst(urlGetFeatureInfo(s.x, s.y), 60_000))
      cache.set(klucz, obiekty)
      appendFileSync(plikCache, `${JSON.stringify({ k: klucz, o: obiekty })}\n`)
      if (++wykonane % 500 === 0)
        console.log(`  sondy: ${wykonane} nowych, ${((Date.now() - start) / 1000).toFixed(0)} s`)
      return obiekty
    } catch (blad) {
      console.warn(`  sonda ${klucz} nieudana: ${blad.message}`)
      return null
    }
  })
}

/**
 * Identyfikatory obiektów SVG w kilku rundach: kolejna runda bierze inne punkty dla obiektów, których
 * sonda nie dała spójnej odpowiedzi (np. punkt tuż przy krawędzi uproszczonego wielokąta).
 */
export async function rozwiazIdentyfikatory(obiekty, indeks, plikCache, rundy = 3) {
  const sondy = []
  let wynik = przypiszId([])
  let bezPunktu = []
  const dziennik = []
  for (let runda = 0; runda < rundy; runda++) {
    const plan = planujSondy(obiekty, indeks, {
      rozwiazane: new Set(wynik.przypisania.keys()),
      proba: runda,
    })
    bezPunktu = plan.bezPunktu
    if (!plan.sondy.length) break
    const wyniki = await wykonajSondy(plan.sondy, plikCache)
    plan.sondy.forEach((s, i) => {
      sondy.push({ pokrywane: s.pokrywane, obiekty: wyniki[i] ?? null })
    })
    wynik = przypiszId(sondy)
    dziennik.push(
      `runda ${runda + 1}: ${plan.sondy.length} sond, rozwiązanych obiektów ${wynik.przypisania.size}`,
    )
  }
  return { ...wynik, sondy: sondy.length, bezPunktu, dziennik }
}

// ── Wpisy rejestru i liczenie w promieniu ────────────────────────────────────────────────────

/**
 * Wpisy do liczenia: obiekt SVG + klucz wpisu (INSPIREID albo „f<numer>" bez identyfikatora), typ
 * i klasa (obiekt/obszar/otoczenie). Otoczenia nie liczą się do wartości (liczony = false).
 */
export function zbudujWpisy(obiekty, przypisania) {
  return obiekty.map((o) => {
    const p = przypisania.get(o.i)
    const typ = p ? (rozbierzId(p.id)?.typ ?? null) : null
    return {
      o,
      klucz: p ? p.id : `f${o.i}`,
      typ,
      klasa: klasaWpisu(typ, o.pole),
      liczony: typ !== TYP_OTOCZENIA,
    }
  })
}

/** Połowa przekątnej obwiedni, powyżej której wpis sprawdzamy dla każdego zapytania zamiast przez KDBush. */
const DUZY_PROMIEN_M = 250

/**
 * Wpisy rejestru z szybkim pytaniem „ile różnych wpisów w promieniu i w czym leży punkt". Małe obiekty
 * trafiają do KDBush po środku obwiedni, rzadkie wielkie (parki, układy urbanistyczne) są sprawdzane
 * zawsze, żeby jeden gigant nie powiększał promienia szukania.
 */
export class IndeksRejestru {
  constructor(wpisy) {
    const polowa = (w) => Math.hypot(w.o.bbox[2] - w.o.bbox[0], w.o.bbox[3] - w.o.bbox[1]) / 2
    this.male = wpisy.filter((w) => polowa(w) <= DUZY_PROMIEN_M)
    this.duze = wpisy.filter((w) => polowa(w) > DUZY_PROMIEN_M)
    this.promienMax = this.male.reduce((m, w) => Math.max(m, polowa(w)), 0)
    this.kd = new KDBush(Math.max(this.male.length, 1))
    for (const w of this.male)
      this.kd.add((w.o.bbox[0] + w.o.bbox[2]) / 2, (w.o.bbox[1] + w.o.bbox[3]) / 2)
    if (!this.male.length) this.kd.add(0, 0)
    this.kd.finish()
  }

  /**
   * @returns {{ liczba: number, klasa: 'obiekt' | 'obszar' | 'otoczenie' | null }} liczba różnych
   * wpisów (bez otoczeń) w promieniu od punktu [x, y] w metrach EPSG:2180 oraz najsilniejsza
   * klasa wpisu, w którego obrysie leży punkt (null poza wszystkimi).
   */
  zapytaj(x, y, promien = PROMIEN_M) {
    const klucze = new Set()
    let ranga = 0
    const sprawdz = (w) => {
      if (odlegloscDoBbox(x, y, w.o.bbox) > promien) return
      const d = odlegloscDoObiektu(x, y, w.o)
      if (d > promien) return
      if (w.liczony) klucze.add(w.klucz)
      if (d === 0 && w.o.rodzaj === 'wielokat') ranga = Math.max(ranga, RANGA[w.klasa] ?? 0)
    }
    if (this.male.length)
      for (const i of this.kd.within(x, y, promien + this.promienMax)) {
        const w = this.male[i]
        if (w) sprawdz(w)
      }
    for (const w of this.duze) sprawdz(w)
    return { liczba: klucze.size, klasa: KLASY_WG_RANGI[ranga] ?? null }
  }
}

// ── Kontrola jakości względem wykazu CSV ─────────────────────────────────────────────────────

const nrNorm = (s) =>
  String(s ?? '')
    .toLowerCase()
    .replace(/\s+/g, '')
const kluczAdresu = (gmina, miejscowosc, ulica, nr) =>
  `${norm(gmina)}|${norm(miejscowosc)}|${norm(ulica)}|${nrNorm(nr)}`

/**
 * Pokrycie wykazu CSV (zbiór 1130) przez obiekty usługi: ile pozycji (bez otoczeń) z gmin adresów
 * ma w usłudze obiekt o tym samym INSPIREID. Brak oznacza pozycję bez lokalizacji w usłudze.
 * Zwraca też udział pozycji z położeniem przybliżonym, niepewnym albo „nie dotyczy".
 */
export function pokrycieWykazu(rekordy, gminy, idZUslugi, wojewodztwo = 'małopolskie') {
  const wg = new Map()
  let pozycji = 0
  let znalezione = 0
  let niedokladne = 0
  for (const r of rekordy) {
    if (r.WOJEWODZTWO !== wojewodztwo) continue
    const gmina = gminaNid(r.GMINA)
    if (!gminy.has(gmina) || rozbierzId(r.INSPIRE_ID)?.typ === TYP_OTOCZENIA) continue
    const w = wg.get(gmina) ?? { pozycji: 0, znalezione: 0 }
    w.pozycji++
    pozycji++
    if (idZUslugi.has(r.INSPIRE_ID)) {
      w.znalezione++
      znalezione++
    }
    if (r.DOKLADNOSC_POLOZENIA && r.DOKLADNOSC_POLOZENIA !== 'dokładny') niedokladne++
    wg.set(gmina, w)
  }
  return { pozycji, znalezione, niedokladne, wgGminy: wg }
}

/**
 * Kontrola położenia: pozycje wykazu z dokładnym adresem w PRG (miejscowość, ulica i numer) →
 * odległość punktu PRG od najbliższego obiektu usługi o tym samym INSPIREID (0 = adres leży w
 * obrysie). Błędne przypisanie identyfikatorów dałoby odległości rzędu setek metrów.
 */
export function zgodnoscAdresowa(rekordy, adresy, obiektyPoId, wojewodztwo = 'małopolskie') {
  const gminy = new Set(adresy.map((a) => a.gmina))
  const indeks = new Map()
  for (const a of adresy) {
    const k = kluczAdresu(a.gmina, a.miejscowosc, a.ulica, a.nr)
    const lista = indeks.get(k)
    if (lista) lista.push(a)
    else indeks.set(k, [a])
  }
  const odleglosci = []
  let dopasowane = 0
  for (const r of rekordy) {
    if (r.WOJEWODZTWO !== wojewodztwo || !nrNorm(r.NR_ADRESOWY)) continue
    const gmina = gminaNid(r.GMINA)
    if (!gminy.has(gmina) || rozbierzId(r.INSPIRE_ID)?.typ === TYP_OTOCZENIA) continue
    const adresyPozycji = indeks.get(kluczAdresu(gmina, r.MIEJSCOWOSC, r.ULICA, r.NR_ADRESOWY))
    if (!adresyPozycji) continue
    dopasowane++
    const obiekty = obiektyPoId.get(r.INSPIRE_ID)
    if (!obiekty) continue
    let d = Number.POSITIVE_INFINITY
    for (const a of adresyPozycji) {
      const [x, y] = do2180(a.lon, a.lat)
      for (const o of obiekty) d = Math.min(d, odlegloscDoObiektu(x, y, o))
    }
    odleglosci.push(d)
  }
  odleglosci.sort((a, b) => a - b)
  const kwantyl = (p) =>
    odleglosci[Math.min(odleglosci.length - 1, Math.floor(p * odleglosci.length))]
  const do_ = (m) => odleglosci.filter((d) => d <= m).length
  return {
    dopasowane,
    zObiektem: odleglosci.length,
    mediana: kwantyl(0.5),
    p90: kwantyl(0.9),
    w0m: do_(0),
    w50m: do_(50),
  }
}

/** Data danych NID z zasobów zbioru 1130 (dane.gov.pl): zasób usługi INSPIRE_IMD, a przy braku CSV. */
export function dataDanychRejestru(zasoby) {
  const lista = (zasoby ?? []).map((z) => z.attributes).filter((a) => a?.data_date)
  const usluga = lista.find((a) => String(a.link ?? '').includes('INSPIRE_IMD'))
  const csv = lista.find((a) => a.format === 'csv')
  const data = (usluga ?? csv)?.data_date
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data ?? '')) throw new Error('NID: brak daty danych rejestru')
  return { dataDanych: data, urlCsv: csv?.download_url ?? null }
}

const proc = (a, b) => Math.round((100 * a) / b)
const spacje = (n) => n.toLocaleString('pl-PL')

export function opisWskaznika({ rozdz, pokrycieProc, niedokladneProc }) {
  return `Liczba wpisów rejestru zabytków nieruchomych (obiekty, zespoły, parki, cmentarze, układy urbanistyczne; bez otoczeń i stref ochrony) w promieniu ${PROMIEN_M} m od adresu. Liczymy odległość od obrysu, więc wpis, w którego obrysie leży adres, wlicza się, a wpis o kilku częściach liczy się raz. Źródło to usługa INSPIRE Narodowego Instytutu Dziedzictwa: lokalizacje pochodzą z wektorów w rozdzielczości ${String(rozdz).replace('.', ',')} m, więc są orientacyjne (kilka metrów), a dla ${niedokladneProc}% pozycji NID podaje położenie przybliżone, niepewne albo żadne. 0 znaczy brak wpisu w danych NID w tym promieniu; pozycje bez lokalizacji w usłudze (ok. ${Math.max(1, 100 - pokrycieProc)}% wykazu) nie są liczone, więc wartość to dolne oszacowanie. Etykieta pokazuje, czy sam adres leży w obrysie obiektu z rejestru, na obszarze wpisanym (zespół, park, cmentarz, układ urbanistyczny) albo w otoczeniu zabytku. Roboty w obrysie obiektu i w otoczeniu wymagają pozwolenia wojewódzkiego konserwatora zabytków, a na obszarze wpisanym zakres rozstrzyga konserwator. Dane orientacyjne, nie zastępują wypisu z rejestru. Nie wpływa na wynik.`
}

// ── Bieg ─────────────────────────────────────────────────────────────────────────────────────

const rozmiarPliku = (sciezka) => (statSync(sciezka).size / 1024 / 1024).toFixed(2)

async function main() {
  const { adresy } = wczytajAdresy()
  const punkty = adresy.map((a) => do2180(a.lon, a.lat))
  const okno = oknoZapytania(punkty, { margines: PROMIEN_M })
  console.log(
    `Okno EPSG:2180: ${okno.x0}, ${okno.y0} – ${okno.x1.toFixed(0)}, ${okno.y1.toFixed(0)} (${okno.szer} × ${okno.wys} px po ${okno.rozdz} m)`,
  )

  const svg = await pobierzSvg(okno)
  const pobrano = statSync(svg.plik).mtime.toISOString().slice(0, 10)
  const { obiekty } = parsujSvg(svg.tekst, okno)
  const rodzaje = { wielokat: 0, linia: 0, punkt: 0 }
  for (const o of obiekty) rodzaje[o.rodzaj]++
  console.log(
    `SVG (${rozmiarPliku(svg.plik)} MB, pobrano ${pobrano}): ${obiekty.length} obiektów – wielokąty ${rodzaje.wielokat}, linie ${rodzaje.linia}, punkty ${rodzaje.punkt}`,
  )
  if (obiekty.length < 1_000)
    throw new Error(`Podejrzanie mało obiektów w SVG (${obiekty.length}): zmiana usługi?`)

  const skrotSvg = createHash('sha1').update(svg.tekst).digest('hex').slice(0, 10)
  const plikSond = join(CACHE, `zabytki-nid-sondy-${skrotSvg}.jsonl`)
  const indeks = new IndeksPokrycia(obiekty)
  const ident = await rozwiazIdentyfikatory(obiekty, indeks, plikSond)
  for (const linia of ident.dziennik) console.log(`  ${linia}`)
  const nierozwiazane = obiekty.length - ident.przypisania.size
  console.log(
    `Identyfikatory: ${ident.przypisania.size}/${obiekty.length} obiektów, sondy spójne ${ident.sondyOk}, niespójne ${ident.niezgodne}, sprzeczne obiekty ${ident.sprzeczne.length}, bez punktu sondy ${ident.bezPunktu.length}`,
  )
  if (ident.sprzeczne.length)
    throw new Error(
      `${ident.sprzeczne.length} obiektów dostało różne identyfikatory z różnych sond: kolejność GetFeatureInfo nie zgadza się z kolejnością SVG`,
    )
  if (nierozwiazane > 0.03 * obiekty.length)
    throw new Error(`Bez identyfikatora ${nierozwiazane} z ${obiekty.length} obiektów (próg 3%)`)

  const wpisy = zbudujWpisy(obiekty, ident.przypisania)
  const wgTypu = new Map()
  const unikalne = new Set()
  for (const w of wpisy) {
    if (unikalne.has(w.klucz)) continue
    unikalne.add(w.klucz)
    const t = w.typ ?? (w.o.rodzaj === 'wielokat' ? '?' : w.o.rodzaj)
    wgTypu.set(t, (wgTypu.get(t) ?? 0) + 1)
  }
  console.log(
    `Wpisy: ${unikalne.size} różnych; typy: ${[...wgTypu]
      .sort((a, b) => b[1] - a[1])
      .map(([t, n]) => `${t} ${n}`)
      .join(', ')}`,
  )

  // Kontrola względem wykazu CSV zbioru 1130
  const zasoby = JSON.parse(
    readFileSync(
      await pobierzDoCache(ZASOBY, 'zabytki-nid-zasoby.json', { headers: NAGLOWKI_NID }),
      'utf8',
    ),
  )
  const { dataDanych, urlCsv } = dataDanychRejestru(zasoby.data)
  if (!urlCsv) throw new Error('NID: w zbiorze 1130 nie ma zasobu CSV')
  const plikCsv = await pobierzDoCache(urlCsv, `zabytki-nid-rejestr-${dataDanych}.csv`, {
    headers: NAGLOWKI_NID,
  })
  const rekordy = rekordyNid(dekodujNid(readFileSync(plikCsv)))
  const gminy = new Set(adresy.map((a) => a.gmina))
  const idZUslugi = new Set([...ident.przypisania.values()].map((p) => p.id))
  const pokrycie = pokrycieWykazu(rekordy, gminy, idZUslugi)
  const pokrycieProc = proc(pokrycie.znalezione, pokrycie.pozycji)
  const niedokladneProc = proc(pokrycie.niedokladne, pokrycie.pozycji)
  console.log(
    `Wykaz CSV ${dataDanych} (${spacje(rekordy.length)} pozycji w kraju): w gminach adresów ${spacje(pokrycie.pozycji)} pozycji bez otoczeń, w usłudze ${spacje(pokrycie.znalezione)} (${pokrycieProc}%), położenie przybliżone/niepewne/nie dotyczy ${niedokladneProc}%`,
  )
  console.log(
    `  wg gmin: ${[...pokrycie.wgGminy].map(([g, w]) => `${g} ${w.znalezione}/${w.pozycji}`).join(', ')}`,
  )
  const poId = new Map()
  for (const [i, p] of ident.przypisania) {
    const o = obiekty[i]
    if (!o) continue
    const lista = poId.get(p.id)
    if (lista) lista.push(o)
    else poId.set(p.id, [o])
  }
  const zgodnosc = zgodnoscAdresowa(rekordy, adresy, poId)
  console.log(
    `Położenie: ${zgodnosc.dopasowane} pozycji z dokładnym adresem w PRG, ${zgodnosc.zObiektem} z obiektem w usłudze; odległość punktu PRG od obiektu o tym id: mediana ${zgodnosc.mediana?.toFixed(1)} m, p90 ${zgodnosc.p90?.toFixed(0)} m, w obrysie ${zgodnosc.w0m}, do 50 m ${zgodnosc.w50m}`,
  )
  if (pokrycieProc < 90)
    throw new Error(`Usługa pokrywa tylko ${pokrycieProc}% wykazu CSV (próg 90%)`)
  if (zgodnosc.zObiektem < 100 || zgodnosc.w50m < 0.7 * zgodnosc.zObiektem)
    throw new Error(
      `Położenie obiektów nie zgadza się z adresami PRG: do 50 m ${zgodnosc.w50m} z ${zgodnosc.zObiektem}`,
    )

  // Wartości dla adresów
  const rejestr = new IndeksRejestru(wpisy)
  const start = performance.now()
  const wyniki = punkty.map(([x, y]) => rejestr.zapytaj(x, y))
  console.log(
    `Policzono ${adresy.length} adresów w ${((performance.now() - start) / 1000).toFixed(1)} s`,
  )
  const wartosci = wyniki.map((w) => w.liczba)
  const etykiety = wyniki.map((w) => w.klasa)

  const krakowskie = (a) => a.teryt === '1261011'
  const posortowane = (filtr) => wartosci.filter((_, i) => filtr(adresy[i])).sort((a, b) => a - b)
  const opisz = (nazwa, v) => {
    const q = (p) => v[Math.min(v.length - 1, Math.floor(p * v.length))]
    console.log(
      `${nazwa}: ${v.length} adresów, bez wpisu w ${PROMIEN_M} m ${v.filter((x) => x === 0).length}, mediana ${q(0.5)}, p90 ${q(0.9)}, p99 ${q(0.99)}, maks ${v[v.length - 1]}`,
    )
  }
  const krakow = posortowane(krakowskie)
  opisz('Kraków', krakow)
  opisz(
    'Gminy obwarzanka',
    posortowane((a) => !krakowskie(a)),
  )
  const wgEtykiet = new Map()
  for (const e of etykiety) wgEtykiet.set(e, (wgEtykiet.get(e) ?? 0) + 1)
  console.log(`Etykiety: ${[...wgEtykiet].map(([e, n]) => `${e ?? 'brak'} ${n}`).join(', ')}`)

  const wszystkie = [...wartosci].sort((a, b) => a - b)
  const p999 = wszystkie[Math.min(wszystkie.length - 1, Math.floor(0.999 * wszystkie.length))] ?? 0
  zapiszWskaznik(
    {
      id: 'zabytki_rejestr_500m',
      kategoria: 'kontekst',
      nazwa: 'Zabytki z rejestru w promieniu 500 m',
      opis: opisWskaznika({ rozdz: okno.rozdz, pokrycieProc, niedokladneProc }),
      jednostka: 'szt.',
      kierunek: 'neutralny',
      rozdzielczosc: 'adres',
      rozmiar: `promień ${PROMIEN_M} m`,
      zakres: [0, Math.ceil(p999 / 10) * 10],
      zadanie: 143,
      zrodla: [
        {
          nazwa:
            'Narodowy Instytut Dziedzictwa – Rejestr zabytków nieruchomych (księga A), usługa INSPIRE WMS Immovable_Monuments; przetworzono: wektory z GetMap (SVG) i identyfikatory z GetFeatureInfo',
          url: CAPABILITIES,
          licencja: LICENCJA,
          dataDanych,
          pobrano,
        },
      ],
    },
    wartosci,
    etykiety,
    SLOWNIK_ETYKIET,
  )
  console.log(`Plik: ${rozmiarPliku(join(DANE, 'wskazniki', 'zabytki_rejestr_500m.json'))} MB`)

  // Kontrola na znanych miejscach: Stare Miasto i Kazimierz gęsto, peryferie rzadko.
  const kontrola = [
    ['Kraków', 'Rynek Główny'],
    ['Kraków', 'Floriańska'],
    ['Kraków', 'Szeroka'],
    ['Kraków', 'Osiedle Teatralne'],
    ['Wieliczka', 'Rynek Górny'],
    ['Niepołomice', 'Rynek'],
  ]
  for (const [miejscowosc, ulica] of kontrola) {
    const i = adresy.findIndex((a) => a.miejscowosc === miejscowosc && a.ulica === ulica)
    console.log(
      `Kontrola ${miejscowosc}, ${ulica} ${i < 0 ? '(brak adresu w PRG)' : `${adresy[i]?.nr}: ${wartosci[i]}${etykiety[i] ? ` – ${etykiety[i]}` : ''}`}`,
    )
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1])
  main().catch((blad) => {
    console.error(blad)
    process.exitCode = 1
  })
