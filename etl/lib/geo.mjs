// Geometria dla warstw ETL liczących odległości do obiektów i obszarów (ryzyka, przyroda).
// Wszystko liczymy w EPSG:2180 (PUWG 1992, metry). W regionie Krakowa skala tego układu różni się
// od 1 o ok. 0,07%, czyli o ok. 3 m na 5 km – mniej niż niepewność punktu adresowego.
import KDBush from 'kdbush'
import proj4 from 'proj4'

export const EPSG2180 =
  '+proj=tmerc +lat_0=0 +lon_0=19 +k=0.9993 +x_0=500000 +y_0=-5300000 +ellps=GRS80 +units=m +no_defs'
const NA_2180 = proj4('EPSG:4326', EPSG2180)

/** [lon, lat] w WGS84 → [x, y] w metrach EPSG:2180 (x = wschód, y = północ). */
export function do2180(lon, lat) {
  return NA_2180.forward([lon, lat])
}

export const odlegloscM = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by)

/** Pierścień jako płaska tablica [x0, y0, x1, y1, …], zawsze domknięty (ostatni punkt = pierwszy). */
export function pierscien(punkty) {
  const n = punkty.length
  if (n < 3) throw new Error(`Pierścień ma ${n} punktów, potrzeba co najmniej 3`)
  const zamkniety = punkty[0][0] === punkty[n - 1][0] && punkty[0][1] === punkty[n - 1][1]
  const wynik = new Float64Array((zamkniety ? n : n + 1) * 2)
  for (let i = 0; i < n; i++) {
    wynik[2 * i] = punkty[i][0]
    wynik[2 * i + 1] = punkty[i][1]
  }
  if (!zamkniety) {
    wynik[2 * n] = punkty[0][0]
    wynik[2 * n + 1] = punkty[0][1]
  }
  return wynik
}

/** Wielokąt: pierwszy pierścień zewnętrzny, kolejne to otwory. `dane` – dowolny ładunek obiektu. */
export function wielokat(pierscienie, dane = null) {
  const zewn = pierscienie[0]
  if (!zewn) throw new Error('Wielokąt bez pierścienia zewnętrznego')
  let xmin = Infinity
  let ymin = Infinity
  let xmax = -Infinity
  let ymax = -Infinity
  for (let i = 0; i < zewn.length; i += 2) {
    xmin = Math.min(xmin, zewn[i])
    xmax = Math.max(xmax, zewn[i])
    ymin = Math.min(ymin, zewn[i + 1])
    ymax = Math.max(ymax, zewn[i + 1])
  }
  return { pierscienie, bbox: [xmin, ymin, xmax, ymax], dane }
}

/** Parsuje współrzędne GeoJSON (Polygon / MultiPolygon, WGS84) do wielokątów w EPSG:2180. */
export function wielokatyZGeojson(geometria, dane = null) {
  const zbiory =
    geometria.type === 'Polygon'
      ? [geometria.coordinates]
      : geometria.type === 'MultiPolygon'
        ? geometria.coordinates
        : null
  if (!zbiory) throw new Error(`Oczekiwano Polygon/MultiPolygon, jest ${geometria.type}`)
  return zbiory.map((pierscienie) =>
    wielokat(
      pierscienie.map((r) => pierscien(r.map(([lon, lat]) => do2180(lon, lat)))),
      dane,
    ),
  )
}

/** Reguła parzystości: czy punkt leży w pierścieniu (brzeg liczy się dowolnie). */
export function punktWPierscieniu(x, y, p) {
  let wewnatrz = false
  const n = p.length / 2
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = p[2 * i]
    const yi = p[2 * i + 1]
    const xj = p[2 * j]
    const yj = p[2 * j + 1]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) wewnatrz = !wewnatrz
  }
  return wewnatrz
}

export function punktWWielokacie(x, y, w) {
  const [xmin, ymin, xmax, ymax] = w.bbox
  if (x < xmin || x > xmax || y < ymin || y > ymax) return false
  if (!punktWPierscieniu(x, y, w.pierscienie[0])) return false
  for (let k = 1; k < w.pierscienie.length; k++)
    if (punktWPierscieniu(x, y, w.pierscienie[k])) return false
  return true
}

export function odlegloscDoOdcinka(px, py, ax, ay, bx, by) {
  const dx = bx - ax
  const dy = by - ay
  const d2 = dx * dx + dy * dy
  const t = d2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / d2))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

function odlegloscDoPierscienia(x, y, p) {
  let najmniej = Infinity
  for (let i = 0; i + 3 < p.length; i += 2) {
    const d = odlegloscDoOdcinka(x, y, p[i], p[i + 1], p[i + 2], p[i + 3])
    if (d < najmniej) najmniej = d
  }
  return najmniej
}

/** Odległość punktu od wielokąta: 0 w środku (poza otworami), inaczej do najbliższego brzegu. */
export function odlegloscDoWielokata(x, y, w) {
  if (punktWWielokacie(x, y, w)) return 0
  let najmniej = Infinity
  for (const p of w.pierscienie) najmniej = Math.min(najmniej, odlegloscDoPierscienia(x, y, p))
  return najmniej
}

export function odlegloscDoBbox(x, y, [xmin, ymin, xmax, ymax]) {
  return Math.hypot(Math.max(xmin - x, 0, x - xmax), Math.max(ymin - y, 0, y - ymax))
}

const KROK_KLUCZA = 1 << 20

/** Numery komórek siatki (od najmniejszego do największego), które obejmuje przedział [a, b] na osi. */
const zakresKomorek = (a, b, poczatek, komorka) => [
  Math.floor((Math.min(a, b) - poczatek) / komorka),
  Math.floor((Math.max(a, b) - poczatek) / komorka),
]

/**
 * Najbliższy wielokąt do punktu. Brzegi wszystkich pierścieni trafiają do siatki kwadratów
 * (`komorka` metrów); zapytanie przegląda kolejne „obwódki” komórek wokół punktu i kończy,
 * gdy najlepszy wynik jest bliższy niż najbliższa nieprzejrzana obwódka.
 * Punkt wewnątrz wielokąta daje 0. Przy zbiegu (nakładające się obszary, ta sama odległość)
 * wygrywa mniejszy `dane.priorytet`.
 */
export class IndeksWielokatow {
  constructor(wielokaty, komorka = 1000) {
    this.wielokaty = wielokaty
    this.komorka = komorka
    this.x0 = Math.min(...wielokaty.map((w) => w.bbox[0]))
    this.y0 = Math.min(...wielokaty.map((w) => w.bbox[1]))
    this.siatka = new Map()
    let liczba = 0
    for (const w of wielokaty) for (const p of w.pierscienie) liczba += p.length / 2 - 1
    // odcinek s: współrzędne w odcinki[4s..4s+3], numer wielokąta w wlasciciel[s]
    this.odcinki = new Float64Array(liczba * 4)
    this.wlasciciel = new Int32Array(liczba)
    let s = 0
    wielokaty.forEach((w, idx) => {
      for (const p of w.pierscienie) {
        for (let i = 0; i + 3 < p.length; i += 2, s++) {
          this.odcinki.set([p[i], p[i + 1], p[i + 2], p[i + 3]], 4 * s)
          this.wlasciciel[s] = idx
          const [ax, bx] = zakresKomorek(p[i], p[i + 2], this.x0, komorka)
          const [ay, by] = zakresKomorek(p[i + 1], p[i + 3], this.y0, komorka)
          for (let cx = ax; cx <= bx; cx++)
            for (let cy = ay; cy <= by; cy++) {
              const klucz = cx * KROK_KLUCZA + cy
              const lista = this.siatka.get(klucz)
              if (lista) lista.push(s)
              else this.siatka.set(klucz, [s])
            }
        }
      }
    })
  }

  priorytet(idx) {
    return this.wielokaty[idx]?.dane?.priorytet ?? 0
  }

  /** Indeksy wielokątów, w których wnętrzu leży punkt. */
  zawierajace(x, y) {
    const wynik = []
    this.wielokaty.forEach((w, idx) => {
      if (punktWWielokacie(x, y, w)) wynik.push(idx)
    })
    return wynik
  }

  /** @returns {{ odleglosc: number, wielokat: number } | null} null, gdy nic nie leży w `maxM`. */
  najblizszy(x, y, maxM) {
    const wewnatrz = this.zawierajace(x, y)
    if (wewnatrz.length) {
      let wybrany = wewnatrz[0]
      for (const idx of wewnatrz) if (this.priorytet(idx) < this.priorytet(wybrany)) wybrany = idx
      return { odleglosc: 0, wielokat: wybrany }
    }
    const k = this.komorka
    const cx = Math.floor((x - this.x0) / k)
    const cy = Math.floor((y - this.y0) / k)
    const maxObwodka = Math.ceil(maxM / k) + 1
    let najlepsza = Infinity
    let wlasciciel = -1
    const o = this.odcinki
    const sprawdz = (klucz) => {
      const lista = this.siatka.get(klucz)
      if (!lista) return
      for (const s of lista) {
        const d = odlegloscDoOdcinka(x, y, o[4 * s], o[4 * s + 1], o[4 * s + 2], o[4 * s + 3])
        const w = this.wlasciciel[s]
        if (d < najlepsza - 1e-9) {
          najlepsza = d
          wlasciciel = w
        } else if (
          d <= najlepsza + 1e-9 &&
          wlasciciel >= 0 &&
          this.priorytet(w) < this.priorytet(wlasciciel)
        ) {
          najlepsza = Math.min(najlepsza, d)
          wlasciciel = w
        }
      }
    }
    for (let r = 0; r <= maxObwodka; r++) {
      // najbliższy punkt komórki z obwódki r jest odległy o co najmniej (r - 1) · komórka
      if (najlepsza <= (r - 1) * k) break
      if (r === 0) sprawdz(cx * KROK_KLUCZA + cy)
      else {
        for (let i = -r; i <= r; i++) {
          sprawdz((cx + i) * KROK_KLUCZA + (cy - r))
          sprawdz((cx + i) * KROK_KLUCZA + (cy + r))
        }
        for (let j = -r + 1; j <= r - 1; j++) {
          sprawdz((cx - r) * KROK_KLUCZA + (cy + j))
          sprawdz((cx + r) * KROK_KLUCZA + (cy + j))
        }
      }
    }
    if (wlasciciel < 0 || najlepsza > maxM) return null
    return { odleglosc: najlepsza, wielokat: wlasciciel }
  }
}

/**
 * Zlicza wielokąty (obrysy budynków) w promieniu od punktu – odległość do obrysu, więc budynek,
 * w którym leży punkt, liczy się (0 m). Małe obrysy trafiają do KDBush po środku bbox, rzadkie
 * wielkie (hale, kompleksy) sprawdzamy zawsze, żeby jeden gigant nie powiększał promienia szukania.
 */
export class LicznikWielokatow {
  constructor(wielokaty, { duzyPromien = 250 } = {}) {
    const polowaPrzekatnej = (w) => Math.hypot(w.bbox[2] - w.bbox[0], w.bbox[3] - w.bbox[1]) / 2
    this.male = wielokaty.filter((w) => polowaPrzekatnej(w) <= duzyPromien)
    this.duze = wielokaty.filter((w) => polowaPrzekatnej(w) > duzyPromien)
    this.promienMax = this.male.reduce((m, w) => Math.max(m, polowaPrzekatnej(w)), 0)
    this.indeks = new KDBush(Math.max(this.male.length, 1))
    for (const w of this.male)
      this.indeks.add((w.bbox[0] + w.bbox[2]) / 2, (w.bbox[1] + w.bbox[3]) / 2)
    if (!this.male.length) this.indeks.add(0, 0)
    this.indeks.finish()
  }

  policz(x, y, promien) {
    let n = 0
    const trafia = (w) =>
      odlegloscDoBbox(x, y, w.bbox) <= promien && odlegloscDoWielokata(x, y, w) <= promien
    if (this.male.length)
      for (const i of this.indeks.within(x, y, promien + this.promienMax))
        if (trafia(this.male[i])) n++
    for (const w of this.duze) if (trafia(w)) n++
    return n
  }
}

/**
 * Najbliższy punkt (zakłady, instalacje) w promieniu `maxM`. Szukamy kolejnymi promieniami
 * (podwajanie): `within` zwraca wszystkie punkty z koła, więc minimum z koła jest minimum globalnym.
 */
export class IndeksPunktow {
  constructor(punkty) {
    this.punkty = punkty
    this.indeks = new KDBush(Math.max(punkty.length, 1))
    for (const p of punkty) this.indeks.add(p.x, p.y)
    if (!punkty.length) this.indeks.add(0, 0)
    this.indeks.finish()
  }

  /** @returns {{ odleglosc: number, punkt: object } | null} */
  najblizszy(x, y, maxM) {
    if (!this.punkty.length) return null
    for (let r = 500; ; r *= 2) {
      const promien = Math.min(r, maxM)
      let najlepszy = null
      let d = Infinity
      for (const i of this.indeks.within(x, y, promien)) {
        const p = this.punkty[i]
        const odl = odlegloscM(x, y, p.x, p.y)
        if (odl < d) {
          d = odl
          najlepszy = p
        }
      }
      if (najlepszy) return { odleglosc: d, punkt: najlepszy }
      if (promien >= maxM) return null
    }
  }
}
