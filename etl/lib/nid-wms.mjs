// Rejestr zabytków nieruchomych NID przez publiczną usługę INSPIRE WMS (GeoMedia WebMap).
//
// Dlaczego WMS: otwarte pliki NID (CSV i REST API na dane.gov.pl, zbiór 1130) mają tylko adresy,
// bez współrzędnych, a usługi WFS NID obejmują wyłącznie Pomniki Historii i listę UNESCO. Geometrię
// całego rejestru oddaje tylko usługa przeglądania INSPIRE_IMD, i to na dwa sposoby:
//   * GetMap w formacie SVG – wektory wszystkich obiektów okna w kolejności bazy, bez atrybutów;
//   * GetFeatureInfo – atrybuty (INSPIREID, nazwa) obiektów pod jednym punktem, w tej samej kolejności.
// Kolejność jest wspólna, więc sonda GetFeatureInfo w punkcie przypisuje identyfikatory kolejnym
// obiektom SVG, które ten punkt pokrywają (przypiszId sprawdza spójność wielu sond).
//
// Układ: EPSG:2180 (metry, x = wschód, y = północ). Serwer w WMS 1.3.0 czyta BBOX tego układu jako
// północ, wschód (północ pierwsza), a w metadanych SVG oddaje lewy brzeg (x) i górny (y).
import { odlegloscDoOdcinka, pierscien, punktWPierscieniu } from './geo.mjs'

export const HOST_NID = 'usluga.zabytek.gov.pl'
export const WMS_REJESTRU = `https://${HOST_NID}/INSPIRE_IMD/service.svc/get`
export const WARSTWA_REJESTRU = 'Immovable_Monuments'
export const NAGLOWKI_NID = { 'User-Agent': 'adresscore-etl/1.0 (HackYeah 2026)' }

/** Serwer odrzuca obrazy powyżej ok. 25 tys. px na bok (błąd HRESULT); 20 tys. działa. */
export const MAX_PX = 20_000

// ── Okno zapytania ───────────────────────────────────────────────────────────────────────────

/**
 * Okno GetMap obejmujące punkty [x, y] (EPSG:2180) z marginesem. Piksel ma dokładnie `rozdz` metrów
 * i okno jest jego wielokrotnością, więc serwer niczego nie koryguje (przy niezgodnych proporcjach
 * sam zmienia zakres, a wtedy współrzędne z SVG przesunęłyby się względem zapytania).
 */
export function oknoZapytania(punkty, { margines = 500, maxPx = MAX_PX, minRozdz = 1 } = {}) {
  if (!punkty.length) throw new Error('Brak punktów do obliczenia okna zapytania')
  let xMin = Number.POSITIVE_INFINITY
  let yMin = Number.POSITIVE_INFINITY
  let xMax = Number.NEGATIVE_INFINITY
  let yMax = Number.NEGATIVE_INFINITY
  for (const [x, y] of punkty) {
    xMin = Math.min(xMin, x)
    xMax = Math.max(xMax, x)
    yMin = Math.min(yMin, y)
    yMax = Math.max(yMax, y)
  }
  const x0 = Math.floor(xMin - margines)
  const y0 = Math.floor(yMin - margines)
  const szerokoscM = Math.ceil(xMax + margines) - x0
  const wysokoscM = Math.ceil(yMax + margines) - y0
  // Rozdzielczość w setnych metra, zaokrąglona w górę, żeby żaden bok nie przekroczył maxPx.
  const rozdz = Math.max(minRozdz, Math.ceil((Math.max(szerokoscM, wysokoscM) / maxPx) * 100) / 100)
  const szer = Math.ceil(szerokoscM / rozdz)
  const wys = Math.ceil(wysokoscM / rozdz)
  return { x0, y0, x1: x0 + szer * rozdz, y1: y0 + wys * rozdz, szer, wys, rozdz }
}

const liczba = (n) => String(Math.round(n * 1000) / 1000)

export function urlGetMap(okno) {
  const u = new URL(WMS_REJESTRU)
  const p = {
    service: 'WMS',
    version: '1.3.0',
    request: 'GetMap',
    layers: WARSTWA_REJESTRU,
    styles: '',
    crs: 'EPSG:2180',
    bbox: [okno.y0, okno.x0, okno.y1, okno.x1].map(liczba).join(','),
    width: String(okno.szer),
    height: String(okno.wys),
    format: 'image/svg+xml',
  }
  for (const [k, v] of Object.entries(p)) u.searchParams.set(k, v)
  return u.toString()
}

/**
 * GetFeatureInfo w punkcie: okno 6 × 6 m i 61 px (piksel 10 cm), wybór w środkowym pikselu. Przy takiej
 * skali tolerancja wyboru (kilka pikseli) to centymetry, więc zwracane są dokładnie obiekty
 * pokrywające punkt. Przy skali regionu ta sama usługa zwraca setki obiektów z okolicy.
 */
export function urlGetFeatureInfo(x, y, polowaBoku = 3) {
  const u = new URL(WMS_REJESTRU)
  const p = {
    service: 'WMS',
    version: '1.3.0',
    request: 'GetFeatureInfo',
    layers: WARSTWA_REJESTRU,
    query_layers: WARSTWA_REJESTRU,
    styles: '',
    crs: 'EPSG:2180',
    bbox: [y - polowaBoku, x - polowaBoku, y + polowaBoku, x + polowaBoku].map(liczba).join(','),
    width: '61',
    height: '61',
    i: '30',
    j: '30',
    info_format: 'application/gml+xml; version=3.1',
    feature_count: '100',
  }
  for (const [k, v] of Object.entries(p)) u.searchParams.set(k, v)
  return u.toString()
}

// ── Ścieżki SVG ──────────────────────────────────────────────────────────────────────────────

const TOKENY = /[MmLlHhVvZzCcSsQqTtAa]|-?\d*\.?\d+(?:[eE][-+]?\d+)?/g

/**
 * Atrybut d ścieżki SVG jako pierścienie punktów [x, y] w pikselach. Usługa używa wyłącznie
 * poleceń M, L, H, V (małe i duże) oraz Z; inne polecenie to zmiana formatu i zatrzymuje eksport.
 */
export function pierscienieZSciezki(d) {
  const tokeny = d.match(TOKENY) ?? []
  const pierscienie = []
  let biezacy = null
  let x = 0
  let y = 0
  let polecenie = null
  let i = 0
  const nastepna = () => {
    const v = Number(tokeny[i++])
    if (!Number.isFinite(v)) throw new Error(`Ścieżka SVG: brak liczby w „${d.slice(0, 60)}”`)
    return v
  }
  while (i < tokeny.length) {
    const t = tokeny[i] ?? ''
    if (/^[A-Za-z]$/.test(t)) {
      i++
      if (!'MmLlHhVvZz'.includes(t)) throw new Error(`Ścieżka SVG: nieobsługiwane polecenie ${t}`)
      polecenie = t
      if (t === 'Z' || t === 'z') {
        if (biezacy) pierscienie.push(biezacy)
        biezacy = null
      } else if (t === 'M' || t === 'm') {
        if (biezacy) pierscienie.push(biezacy)
        biezacy = []
        const a = nastepna()
        const b = nastepna()
        x = t === 'M' ? a : x + a
        y = t === 'M' ? b : y + b
        biezacy.push([x, y])
        // kolejne pary po M to niejawne L
        polecenie = t === 'M' ? 'L' : 'l'
      }
      continue
    }
    if (!biezacy || !polecenie) throw new Error('Ścieżka SVG: odcinek bez początku (M)')
    if (polecenie === 'L' || polecenie === 'l') {
      const a = nastepna()
      const b = nastepna()
      x = polecenie === 'L' ? a : x + a
      y = polecenie === 'L' ? b : y + b
    } else if (polecenie === 'H' || polecenie === 'h') {
      const a = nastepna()
      x = polecenie === 'H' ? a : x + a
    } else if (polecenie === 'V' || polecenie === 'v') {
      const a = nastepna()
      y = polecenie === 'V' ? a : y + a
    } else throw new Error(`Ścieżka SVG: liczby po poleceniu ${polecenie}`)
    biezacy.push([x, y])
  }
  if (biezacy) pierscienie.push(biezacy)
  return pierscienie
}

// ── Geometria obiektów ───────────────────────────────────────────────────────────────────────

function obwiednia(pierscienie) {
  let x0 = Number.POSITIVE_INFINITY
  let y0 = Number.POSITIVE_INFINITY
  let x1 = Number.NEGATIVE_INFINITY
  let y1 = Number.NEGATIVE_INFINITY
  for (const p of pierscienie)
    for (let i = 0; i < p.length; i += 2) {
      x0 = Math.min(x0, p[i])
      x1 = Math.max(x1, p[i])
      y0 = Math.min(y0, p[i + 1])
      y1 = Math.max(y1, p[i + 1])
    }
  return [x0, y0, x1, y1]
}

/** Pole pierścienia (wzór Gaussa), zawsze dodatnie. */
function polePierscienia(p) {
  let s = 0
  const n = p.length / 2
  for (let i = 0, j = n - 1; i < n; j = i++) s += p[2 * j] * p[2 * i + 1] - p[2 * i] * p[2 * j + 1]
  return Math.abs(s / 2)
}

/**
 * Pole figury z pierścieni: reguła parzystości, czyli pierścień leżący w parzystej liczbie innych
 * dodaje swoje pole, w nieparzystej odejmuje (otwór). Obejmuje też wielokąty z kilku części.
 */
export function poleFigury(pierscienie) {
  let suma = 0
  pierscienie.forEach((p, k) => {
    let glebokosc = 0
    for (let m = 0; m < pierscienie.length; m++)
      if (m !== k && punktWPierscieniu(p[0], p[1], pierscienie[m])) glebokosc++
    suma += (glebokosc % 2 ? -1 : 1) * polePierscienia(p)
  })
  return Math.max(0, suma)
}

/** Czy punkt leży wewnątrz wielokąta (reguła parzystości po wszystkich pierścieniach). */
export function wewnatrzObiektu(x, y, o) {
  if (o.rodzaj !== 'wielokat') return false
  const [x0, y0, x1, y1] = o.bbox
  if (x < x0 || x > x1 || y < y0 || y > y1) return false
  let wewnatrz = false
  for (const p of o.pierscienie) if (punktWPierscieniu(x, y, p)) wewnatrz = !wewnatrz
  return wewnatrz
}

function odlegloscDoLamanej(x, y, p) {
  let najmniej = Number.POSITIVE_INFINITY
  for (let i = 0; i + 3 < p.length; i += 2) {
    const d = odlegloscDoOdcinka(x, y, p[i], p[i + 1], p[i + 2], p[i + 3])
    if (d < najmniej) najmniej = d
  }
  return najmniej
}

/** Odległość punktu od obiektu: 0 w środku wielokąta, inaczej do najbliższego brzegu, linii albo punktu. */
export function odlegloscDoObiektu(x, y, o) {
  if (o.rodzaj === 'punkt') return Math.hypot(x - o.pierscienie[0][0], y - o.pierscienie[0][1])
  if (wewnatrzObiektu(x, y, o)) return 0
  let najmniej = Number.POSITIVE_INFINITY
  for (const p of o.pierscienie) najmniej = Math.min(najmniej, odlegloscDoLamanej(x, y, p))
  return najmniej
}

// ── Parser SVG ───────────────────────────────────────────────────────────────────────────────

const atrybut = (tekst, nazwa) => new RegExp(`${nazwa}="([^"]*)"`).exec(tekst)?.[1]

/**
 * Obiekty z SVG GetMap w kolejności bazy. Każdy obiekt to jeden element `<use>` z kreską (linia)
 * albo z wypełnieniem i kreską (wielokąt), albo symbol punktu. Zwraca { obiekty, meta }; obiekt:
 * { i, rodzaj: 'wielokat' | 'linia' | 'punkt', pierscienie: Float64Array[], bbox, pole }.
 * Współrzędne w metrach EPSG:2180, przeliczone z pikseli metadanymi SVG i sprawdzone z oknem.
 */
export function parsujSvg(tekst, okno) {
  if (!/<svg[\s>]/.test(tekst) || !tekst.includes('gwmroot'))
    throw new Error('Odpowiedź nie jest SVG z usługi GeoMedia WebMap')
  const meta = {}
  for (const m of tekst.matchAll(/gmwmsvg:(\w+)="([^"]*)"/g)) meta[m[1]] = m[2]
  const x0 = Number(meta.storageoffsetx)
  const y1 = Number(meta.storageoffsety)
  const skala = Number(meta.displaytostoragescale) // piksele na metr
  if (![x0, y1, skala].every(Number.isFinite) || skala <= 0)
    throw new Error('SVG bez metadanych przeliczenia współrzędnych')
  if (
    meta.readoutunit !== 'm' ||
    Number(meta.rotationangle) !== 0 ||
    Number(meta.storagetoreadoutscale) !== 1
  )
    throw new Error(`SVG: nieoczekiwane jednostki albo obrót (${JSON.stringify(meta)})`)
  if (okno) {
    // Zmieniony przez serwer zakres to przesunięcie wszystkich współrzędnych: zatrzymujemy eksport.
    const zgodne =
      Math.abs(x0 - okno.x0) < 0.01 &&
      Math.abs(y1 - okno.y1) < 0.01 &&
      Math.abs(skala * okno.rozdz - 1) < 1e-6
    if (!zgodne)
      throw new Error(
        `SVG ma inny zakres niż zapytanie: x0 ${x0} (zapytano ${okno.x0}), y1 ${y1} (${okno.y1}), ${skala} px/m (${1 / okno.rozdz})`,
      )
  }

  const stylCss = tekst.slice(tekst.indexOf('<style'), tekst.indexOf('</style>'))
  const klasy = new Map()
  for (const m of stylCss.matchAll(/\.([A-Za-z0-9_-]+)\s*\{([^}]*)\}/g)) {
    const [, nazwa, cialo = ''] = m
    if (!nazwa || /-[HS]-$/.test(nazwa) || nazwa.startsWith('GWM')) continue
    if (/fill:\s*none/.test(cialo)) klasy.set(nazwa, 'kontur')
    else if (/stroke:\s*none/.test(cialo) && /fill:\s*#/.test(cialo))
      klasy.set(nazwa, 'wypelnienie')
  }
  if (![...klasy.values()].includes('kontur') || ![...klasy.values()].includes('wypelnienie'))
    throw new Error('SVG: nie rozpoznano klas wypełnienia i kreski (zmiana stylu usługi?)')

  const sciezki = new Map()
  for (const m of tekst.matchAll(/<path id="([^"]+)" d="([^"]*)"/g))
    sciezki.set(m[1] ?? '', m[2] ?? '')

  // Uzycia jednego obiektu mają wspólny rdzeń id („X.0” wypełnienie, „X.1” kreska).
  const grupy = new Map()
  for (const m of tekst.matchAll(/<use\b([^>]*?)\/?>/g)) {
    const a = m[1] ?? ''
    const id = atrybut(a, ' id')
    const href = atrybut(a, 'xlink:href')?.replace(/^#/, '')
    const klasa = atrybut(a, 'class')
    if (!id || !href || !klasa) continue
    const rdzen = id.replace(/\.\d+$/, '')
    let g = grupy.get(rdzen)
    if (!g) {
      g = []
      grupy.set(rdzen, g)
    }
    g.push({ href, klasa, transformacja: atrybut(a, 'transform') })
  }

  const naMetry = ([px, py]) => [x0 + px / skala, y1 - py / skala]
  const obiekty = []
  for (const [rdzen, uzycia] of grupy) {
    const punkt = uzycia.find((u) => u.href === '_GWMSquarePoint')
    if (punkt) {
      const t = /translate\(\s*([-\d.]+)[ ,]+([-\d.]+)\s*\)/.exec(punkt.transformacja ?? '')
      if (!t) throw new Error(`SVG: punkt ${rdzen} bez translate`)
      const [x, y] = naMetry([Number(t[1]), Number(t[2])])
      obiekty.push({
        i: obiekty.length,
        rodzaj: 'punkt',
        pierscienie: [Float64Array.of(x, y)],
        bbox: [x, y, x, y],
        pole: 0,
      })
      continue
    }
    const wyp = uzycia.find((u) => klasy.get(u.klasa) === 'wypelnienie')
    const kontur = uzycia.find((u) => klasy.get(u.klasa) === 'kontur')
    const uzycie = wyp ?? kontur
    if (!uzycie) throw new Error(`SVG: obiekt ${rdzen} bez rozpoznanej klasy`)
    const d = sciezki.get(uzycie.href)
    if (d === undefined) throw new Error(`SVG: brak ścieżki ${uzycie.href}`)
    const surowe = pierscienieZSciezki(d)
      .map((p) => p.map(naMetry))
      .filter((p) => p.length > 0)
    let rodzaj = wyp ? 'wielokat' : 'linia'
    let pierscienie
    if (rodzaj === 'wielokat') {
      // Wielokąt zwinięty przy grubym pikselu do 1–2 punktów traci wypełnienie: traktujemy go jak linię.
      const dobre = surowe.filter((p) => p.length >= 3)
      if (dobre.length) pierscienie = dobre.map((p) => pierscien(p))
      else rodzaj = 'linia'
    }
    if (rodzaj === 'linia')
      pierscienie = surowe.map((p) => Float64Array.from(p.flatMap(([x, y]) => [x, y])))
    if (!pierscienie?.length) throw new Error(`SVG: obiekt ${rdzen} bez geometrii`)
    obiekty.push({
      i: obiekty.length,
      rodzaj,
      pierscienie,
      bbox: obwiednia(pierscienie),
      pole: rodzaj === 'wielokat' ? poleFigury(pierscienie) : 0,
    })
  }
  return { obiekty, meta }
}

// ── GetFeatureInfo ───────────────────────────────────────────────────────────────────────────

const ID_REJESTRU = /^PL\.1\.9\.ZIPOZ\.NID_N_(\d{2})_([A-Z]{2})\.(\d+)$/

/** „PL.1.9.ZIPOZ.NID_N_12_BK.198432” → { wojewodztwo: '12', typ: 'BK', numer: 198432 } albo null. */
export function rozbierzId(id) {
  const m = ID_REJESTRU.exec(id ?? '')
  return m ? { wojewodztwo: m[1], typ: m[2], numer: Number(m[3]) } : null
}

/**
 * Obiekty z odpowiedzi GetFeatureInfo (GML Intergraph) w kolejności serwera: [{ id, nazwa, typ }].
 * Odpowiedź z błędem usługi zamiast kolekcji to wyjątek, a nie „zero obiektów”.
 */
export function parsujGfi(xml) {
  if (!xml.includes('<FeatureCollection'))
    throw new Error(`GetFeatureInfo bez FeatureCollection: ${xml.slice(0, 200)}`)
  const wynik = []
  for (const blok of xml.split('<gml:featureMember>').slice(1)) {
    const atr = {}
    for (const m of blok.matchAll(/<Attribute Name="([^"]+)">([^<]*)<\/Attribute>/g))
      atr[m[1] ?? ''] = m[2] ?? ''
    const id = atr.INSPIREID
    if (!id) throw new Error('GetFeatureInfo: obiekt bez INSPIREID')
    wynik.push({ id, nazwa: atr.SITENAME ?? '', typ: rozbierzId(id)?.typ ?? null })
  }
  return wynik
}

// ── Sondy: planowanie i przypisanie identyfikatorów ──────────────────────────────────────────

const KOMORKA_INDEKSU_M = 250

/**
 * Odległość od linii albo punktu, w której GetFeatureInfo przy pikselu 10 cm jeszcze „trafia” obiekt
 * (sprawdzone na punktach: trafienie dokładnie w punkcie, brak już 1 m obok).
 */
export const TOLERANCJA_TRAFIENIA_M = 0.25

/**
 * Siatka obiektów do pytań „co trafia sonda w punkcie” (wielokąty pokrywające punkt oraz linie
 * i punkty w tolerancji) i „jak daleko jest najbliższy brzeg wielokąta”.
 */
export class IndeksPokrycia {
  constructor(obiekty) {
    this.obiekty = obiekty
    this.siatka = new Map()
    for (const o of obiekty) {
      const m = o.rodzaj === 'wielokat' ? 0 : 1
      const [x0, y0, x1, y1] = o.bbox
      const k = KOMORKA_INDEKSU_M
      for (let ix = Math.floor((x0 - m) / k); ix <= Math.floor((x1 + m) / k); ix++)
        for (let iy = Math.floor((y0 - m) / k); iy <= Math.floor((y1 + m) / k); iy++) {
          const klucz = `${ix}:${iy}`
          const lista = this.siatka.get(klucz)
          if (lista) lista.push(o.i)
          else this.siatka.set(klucz, [o.i])
        }
    }
  }

  /** Indeksy obiektów zarejestrowanych w komórkach w odległości `zasieg` m od punktu (bez powtórzeń). */
  kandydaci(x, y, zasieg = 0) {
    const k = KOMORKA_INDEKSU_M
    const wynik = new Set()
    for (let ix = Math.floor((x - zasieg) / k); ix <= Math.floor((x + zasieg) / k); ix++)
      for (let iy = Math.floor((y - zasieg) / k); iy <= Math.floor((y + zasieg) / k); iy++)
        for (const i of this.siatka.get(`${ix}:${iy}`) ?? []) wynik.add(i)
    return wynik
  }

  /** Indeksy obiektów trafianych w punkcie, rosnąco (czyli w kolejności bazy). */
  trafione(x, y, tolerancja = TOLERANCJA_TRAFIENIA_M) {
    return [...this.kandydaci(x, y)]
      .filter((i) => {
        const o = this.obiekty[i]
        if (!o) return false
        return o.rodzaj === 'wielokat'
          ? wewnatrzObiektu(x, y, o)
          : odlegloscDoObiektu(x, y, o) <= tolerancja
      })
      .sort((a, b) => a - b)
  }

  /** Najmniejsza odległość od krawędzi wielokątów leżących w pobliżu punktu (do `zasieg` m). */
  odlegloscDoKrawedzi(x, y, zasieg = 8) {
    let najmniej = Number.POSITIVE_INFINITY
    for (const i of this.kandydaci(x, y, zasieg)) {
      const o = this.obiekty[i]
      if (!o || o.rodzaj !== 'wielokat') continue
      const [x0, y0, x1, y1] = o.bbox
      if (x < x0 - zasieg || x > x1 + zasieg || y < y0 - zasieg || y > y1 + zasieg) continue
      for (const p of o.pierscienie) najmniej = Math.min(najmniej, odlegloscDoLamanej(x, y, p))
    }
    return najmniej
  }
}

/**
 * Punkty kandydujące do sondy, najlepszy pierwszy. Wielokąt: punkty wewnątrz od najgłębszego;
 * głębokość to odległość od najbliższej krawędzi dowolnego wielokąta w pobliżu, bo im dalej od
 * krawędzi, tym mniejsze ryzyko, że przy uproszczonej geometrii SVG punkt trafi po innej stronie
 * krawędzi niż w danych źródłowych. Punkt: on sam. Linia: wierzchołki (leżą na rzeczywistej linii,
 * a środki odcinków mogą leżeć obok niej) w kolejności: pierwszy, ostatni, środkowy, pozostałe.
 */
export function kandydaciSondy(o, indeks) {
  if (o.rodzaj === 'punkt') {
    const [x, y] = o.pierscienie[0] ?? []
    return [{ x, y, glebokosc: 0 }]
  }
  if (o.rodzaj === 'linia') {
    const wierzcholki = []
    for (const p of o.pierscienie)
      for (let i = 0; i < p.length; i += 2) wierzcholki.push({ x: p[i], y: p[i + 1], glebokosc: 0 })
    const n = wierzcholki.length
    const kolejnosc = [0, n - 1, Math.floor(n / 2)]
    for (let i = 0; i < n; i++) if (!kolejnosc.includes(i)) kolejnosc.push(i)
    return kolejnosc.flatMap((i) => (wierzcholki[i] ? [wierzcholki[i]] : []))
  }
  const [x0, y0, x1, y1] = o.bbox
  const nx = Math.min(40, Math.max(6, Math.ceil((x1 - x0) / 2)))
  const ny = Math.min(40, Math.max(6, Math.ceil((y1 - y0) / 2)))
  const kandydaci = []
  for (let a = 0; a < nx; a++)
    for (let b = 0; b < ny; b++) {
      const x = x0 + ((x1 - x0) * (a + 0.5)) / nx
      const y = y0 + ((y1 - y0) * (b + 0.5)) / ny
      if (!wewnatrzObiektu(x, y, o)) continue
      kandydaci.push({ x, y, glebokosc: indeks.odlegloscDoKrawedzi(x, y) })
    }
  return kandydaci.sort((p, q) => q.glebokosc - p.glebokosc || p.x - q.x || p.y - q.y)
}

/**
 * Plan sond: najpierw wielokąty od najmniejszego, potem linie i punkty. Sonda w najgłębszym punkcie
 * wielokąta trafia też wszystkie wielokąty nad nim, więc zagnieżdżone obiekty (budynek w zespole
 * w układzie) kosztują jedno zapytanie. `proba` (0, 1, 2…) wybiera kolejnego kandydata w kolejnych
 * rundach po niepowodzeniu poprzedniej.
 *
 * @returns {{ sondy: { x: number, y: number, pokrywane: number[], glebokosc: number }[], bezPunktu: number[] }}
 */
export function planujSondy(obiekty, indeks, { rozwiazane = new Set(), proba = 0 } = {}) {
  const doZrobienia = obiekty
    .filter((o) => !rozwiazane.has(o.i))
    .sort(
      (a, b) =>
        Number(a.rodzaj !== 'wielokat') - Number(b.rodzaj !== 'wielokat') ||
        a.pole - b.pole ||
        a.i - b.i,
    )
  const pokryte = new Set()
  const sondy = []
  const bezPunktu = []
  for (const o of doZrobienia) {
    if (pokryte.has(o.i)) continue
    const kandydaci = kandydaciSondy(o, indeks)
    // Kolejne próby biorą kandydatów oddalonych od poprzednich co najmniej o 1,5 m.
    const wybrany = rozproszone(kandydaci, proba)
    if (!wybrany) {
      bezPunktu.push(o.i)
      pokryte.add(o.i)
      continue
    }
    const pokrywane = indeks.trafione(wybrany.x, wybrany.y)
    // Sonda ma trafić obiekt, dla którego ją wybrano; inaczej odpowiedź nic o nim nie powie.
    if (!pokrywane.includes(o.i)) {
      bezPunktu.push(o.i)
      pokryte.add(o.i)
      continue
    }
    for (const i of pokrywane) pokryte.add(i)
    sondy.push({ ...wybrany, pokrywane })
  }
  return { sondy, bezPunktu }
}

function rozproszone(kandydaci, proba) {
  const wybrane = []
  for (const c of kandydaci) {
    if (wybrane.every((w) => Math.hypot(w.x - c.x, w.y - c.y) >= 1.5)) wybrane.push(c)
    if (wybrane.length > proba) break
  }
  return wybrane[proba] ?? null
}

/**
 * Przypisuje identyfikatory obiektom SVG z wyników sond. Sonda jest wiarygodna tylko wtedy, gdy
 * liczba obiektów z GetFeatureInfo równa się liczbie obiektów SVG trafianych w punkcie; wtedy i-ty
 * identyfikator należy do i-tego obiektu w kolejności bazy. Głosy z wielu sond sumujemy
 * (obiekt pod wieloma sondami, jak układ urbanistyczny, jest sprawdzany wielokrotnie), a sprzeczność
 * to obiekt z dwoma różnymi identyfikatorami. Ten sam identyfikator na wielu wielokątach jest
 * normalny: wpis o kilku częściach bywa rysowany jako kilka obiektów.
 *
 * @param {{ pokrywane: number[], obiekty: { id: string, nazwa?: string }[] | null }[]} sondy
 * @returns {{ przypisania: Map<number, { id: string, nazwa: string }>, sprzeczne: number[], niezgodne: number, sondyOk: number }}
 */
export function przypiszId(sondy) {
  const glosy = new Map()
  let niezgodne = 0
  let sondyOk = 0
  for (const s of sondy) {
    if (!s.obiekty || s.obiekty.length !== s.pokrywane.length) {
      niezgodne++
      continue
    }
    sondyOk++
    s.pokrywane.forEach((i, pozycja) => {
      const o = s.obiekty?.[pozycja]
      if (!o) return
      let g = glosy.get(i)
      if (!g) {
        g = new Map()
        glosy.set(i, g)
      }
      const wpis = g.get(o.id) ?? { id: o.id, nazwa: o.nazwa ?? '', glosy: 0 }
      wpis.glosy++
      g.set(o.id, wpis)
    })
  }
  const przypisania = new Map()
  const sprzeczne = []
  for (const [i, g] of glosy) {
    const wpisy = [...g.values()].sort((a, b) => b.glosy - a.glosy || a.id.localeCompare(b.id))
    if (wpisy.length > 1) sprzeczne.push(i)
    const [pierwszy] = wpisy
    if (pierwszy) przypisania.set(i, { id: pierwszy.id, nazwa: pierwszy.nazwa })
  }
  return { przypisania, sprzeczne, niezgodne, sondyOk }
}

// ── Typy wpisów rejestru ─────────────────────────────────────────────────────────────────────

/** Typy identyfikatorów NID: obiekt (budynek, budowla, mała architektura), obszar, otoczenie. */
export const TYPY_OBIEKTOW = new Set(['BK', 'BL', 'MA'])
export const TYPY_OBSZAROW = new Set(['ZE', 'ZZ', 'CM', 'UU', 'KK', 'SK'])
export const TYP_OTOCZENIA = 'OT'

/**
 * Pole (m²), powyżej którego budynek, budowla albo mała architektura (BK, BL, MA) jest w praktyce
 * obszarem: w Krakowie i okolicy to kopalnia soli w Wieliczce (235 ha, jej obrys pokrywa centrum
 * miasta) i wały ziemne, a forty i kopce zostają poniżej (do ok. 10 ha).
 */
export const GRANICA_DUZEGO_OBIEKTU_M2 = 100_000

/** Pole (m²), do którego wielokąt o nieznanym typie uznajemy za obiekt, a powyżej za obszar. */
export const GRANICA_OBIEKTU_M2 = 10_000

/**
 * Klasa wpisu na potrzeby etykiety: 'obiekt' | 'obszar' | 'otoczenie'. Typ nieznany (wielokąt bez
 * zidentyfikowanego wpisu albo nowy kod NID) rozstrzyga pole, bo parki, cmentarze i układy są duże,
 * a budynki małe.
 */
export function klasaWpisu(typ, pole) {
  if (typ === TYP_OTOCZENIA) return 'otoczenie'
  if (TYPY_OBIEKTOW.has(typ)) return pole > GRANICA_DUZEGO_OBIEKTU_M2 ? 'obszar' : 'obiekt'
  if (TYPY_OBSZAROW.has(typ)) return 'obszar'
  return pole > GRANICA_OBIEKTU_M2 ? 'obszar' : 'obiekt'
}
