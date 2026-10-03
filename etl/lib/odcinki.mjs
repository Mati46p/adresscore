// Najbliższy odcinek łamanej w układzie metrycznym (np. EPSG:2178 albo 2180).
// Dlaczego własny indeks, a nie kdbush po wierzchołkach: droga rowerowa ma wierzchołki co kilkadziesiąt
// metrów, więc odległość do najbliższego WIERZCHOŁKA zawyża odległość do drogi nawet o pół odstępu.
// Tu liczymy odległość do samego odcinka, a siatka jednorodna ogranicza kandydatów do sąsiedztwa.

/** Odległość punktu P od odcinka AB w jednostkach układu współrzędnych. */
export function odlegloscDoOdcinka(px, py, ax, ay, bx, by) {
  const dx = bx - ax
  const dy = by - ay
  const d2 = dx * dx + dy * dy
  let t = d2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / d2
  if (t < 0) t = 0
  else if (t > 1) t = 1
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

// Klucz komórki jako liczba (szybciej niż napis). Zakres ±2^20 komórek – dla komórki 250 m to ±262 km.
const PRZESUNIECIE = 2 ** 20
const klucz = (ix, iy) => (ix + PRZESUNIECIE) * 2 ** 21 + (iy + PRZESUNIECIE)

export class IndeksOdcinkow {
  /** @param komorka bok komórki siatki w metrach (≥ 10); ~250 m pasuje do dróg i do zapytań ≤ 1 km */
  constructor(komorka = 250) {
    if (!(komorka >= 10)) throw new Error('Komórka siatki musi mieć co najmniej 10 m')
    this.komorka = komorka
    this.ax = []
    this.ay = []
    this.bx = []
    this.by = []
    this.znacznik = []
    this.siatka = new Map()
    this.liczbaLinii = 0
    this.dlugosc = 0
    this.stempel = null
    this.numerZapytania = 0
    // Zakres zajętych komórek [i0, j0, i1, j1] – ogranicza liczbę pierścieni, więc pętla zawsze się kończy.
    this.zakresKomorek = [Infinity, Infinity, -Infinity, -Infinity]
  }

  get liczbaOdcinkow() {
    return this.ax.length
  }

  /**
   * Dodaje łamaną [[x, y], …]. `znacznik` wraca z zapytania (np. rodzaj drogi). Odcinki dłuższe niż
   * komórka są dzielone, żeby każdy trafiał do kilku komórek, a nie do setek.
   */
  dodajLinie(punkty, znacznik = null) {
    if (!Array.isArray(punkty) || punkty.length < 2) return false
    let dodano = false
    for (let i = 1; i < punkty.length; i++) {
      const [x1, y1] = punkty[i - 1]
      const [x2, y2] = punkty[i]
      if (![x1, y1, x2, y2].every(Number.isFinite)) continue
      const dl = Math.hypot(x2 - x1, y2 - y1)
      const czesci = Math.max(1, Math.ceil(dl / this.komorka))
      for (let c = 0; c < czesci; c++) {
        const t0 = c / czesci
        const t1 = (c + 1) / czesci
        this.#dodajOdcinek(
          x1 + (x2 - x1) * t0,
          y1 + (y2 - y1) * t0,
          x1 + (x2 - x1) * t1,
          y1 + (y2 - y1) * t1,
          znacznik,
        )
      }
      this.dlugosc += dl
      dodano = true
    }
    if (dodano) this.liczbaLinii++
    return dodano
  }

  #dodajOdcinek(x1, y1, x2, y2, znacznik) {
    const id = this.ax.length
    this.ax.push(x1)
    this.ay.push(y1)
    this.bx.push(x2)
    this.by.push(y2)
    this.znacznik.push(znacznik)
    const k = this.komorka
    const i0 = Math.floor(Math.min(x1, x2) / k)
    const i1 = Math.floor(Math.max(x1, x2) / k)
    const j0 = Math.floor(Math.min(y1, y2) / k)
    const j1 = Math.floor(Math.max(y1, y2) / k)
    const z = this.zakresKomorek
    z[0] = Math.min(z[0], i0)
    z[1] = Math.min(z[1], j0)
    z[2] = Math.max(z[2], i1)
    z[3] = Math.max(z[3], j1)
    for (let ix = i0; ix <= i1; ix++)
      for (let iy = j0; iy <= j1; iy++) {
        const kl = klucz(ix, iy)
        const lista = this.siatka.get(kl)
        if (lista) lista.push(id)
        else this.siatka.set(kl, [id])
      }
  }

  /**
   * Najbliższy odcinek w promieniu `maxOdleglosc` (m) albo null. Przeszukuje pierścienie komórek
   * wokół punktu i kończy, gdy żaden dalszy pierścień nie może dać bliższego trafienia: punkt leży
   * wewnątrz swojej komórki, więc pierścień r+1 jest od niego oddalony o co najmniej r · komórka.
   */
  najblizszy(x, y, maxOdleglosc = Infinity) {
    if (!this.ax.length || !Number.isFinite(x) || !Number.isFinite(y)) return null
    if (!this.stempel || this.stempel.length < this.ax.length)
      this.stempel = new Int32Array(this.ax.length)
    const numer = ++this.numerZapytania
    const k = this.komorka
    const cx = Math.floor(x / k)
    const cy = Math.floor(y / k)
    let najlepsza = Infinity
    let id = -1
    const sprawdz = (ix, iy) => {
      const lista = this.siatka.get(klucz(ix, iy))
      if (!lista) return
      for (const o of lista) {
        if (this.stempel[o] === numer) continue
        this.stempel[o] = numer
        const d = odlegloscDoOdcinka(x, y, this.ax[o], this.ay[o], this.bx[o], this.by[o])
        if (d < najlepsza) {
          najlepsza = d
          id = o
        }
      }
    }
    // Pierścienie liczymy najwyżej do pokrycia całej zajętej siatki, żeby pętla zawsze się kończyła.
    const [i0, j0, i1, j1] = this.zakresKomorek
    const granica = Math.max(
      Math.abs(cx - i0),
      Math.abs(cx - i1),
      Math.abs(cy - j0),
      Math.abs(cy - j1),
    )
    for (let r = 0; r <= granica; r++) {
      if (r === 0) sprawdz(cx, cy)
      else {
        for (let ix = cx - r; ix <= cx + r; ix++) {
          sprawdz(ix, cy - r)
          sprawdz(ix, cy + r)
        }
        for (let iy = cy - r + 1; iy <= cy + r - 1; iy++) {
          sprawdz(cx - r, iy)
          sprawdz(cx + r, iy)
        }
      }
      if (najlepsza <= r * k || r * k >= maxOdleglosc) break
    }
    if (id < 0 || najlepsza > maxOdleglosc) return null
    return { metry: najlepsza, znacznik: this.znacznik[id] }
  }
}
