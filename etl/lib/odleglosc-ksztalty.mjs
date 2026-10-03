// Najbliższa odległość punktu od zbioru odcinków (łamane, krawędzie wielokątów, punkty) oraz test
// „punkt w wielokącie". Układ płaski w metrach (np. EPSG:2180), bez zależności zewnętrznych.
// Indeks to siatka kwadratowych komórek. Zapytanie przegląda kolejne pierścienie komórek wokół
// punktu i kończy, gdy znaleziony odcinek jest bliżej niż granica nieprzejrzanego obszaru, więc
// wynik jest dokładny, a nie przybliżony (test porównuje go z przeglądem wszystkich odcinków).

const PRZESUNIECIE = 1 << 20
const klucz = (ix, iy) => (ix + PRZESUNIECIE) * 2_097_152 + (iy + PRZESUNIECIE)

/** Kwadrat odległości punktu P od odcinka AB; odcinek zerowej długości jest punktem. */
export function kwadratOdleglosciDoOdcinka(px, py, ax, ay, bx, by) {
  const dx = bx - ax
  const dy = by - ay
  const dl2 = dx * dx + dy * dy
  let t = 0
  if (dl2 > 0) {
    t = ((px - ax) * dx + (py - ay) * dy) / dl2
    t = t < 0 ? 0 : t > 1 ? 1 : t
  }
  const ex = px - (ax + t * dx)
  const ey = py - (ay + t * dy)
  return ex * ex + ey * ey
}

export function odlegloscDoOdcinka(px, py, ax, ay, bx, by) {
  return Math.sqrt(kwadratOdleglosciDoOdcinka(px, py, ax, ay, bx, by))
}

/**
 * Czy punkt leży wewnątrz wielokąta. `pierscienie` to zewnętrzny obrys i ewentualne otwory
 * (reguła parzystości, więc kolejność i kierunek pierścieni nie mają znaczenia).
 */
export function punktWPierscieniach(px, py, pierscienie) {
  let wewnatrz = false
  for (const p of pierscienie) {
    // Dostęp przez indeks, a nie destrukturyzację: z destrukturyzacją ta pętla zajmowała 22 z 31 s
    // całego skryptu (profil), po zmianie skrypt liczy się w 8 s.
    for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
      const xi = p[i][0]
      const yi = p[i][1]
      const xj = p[j][0]
      const yj = p[j][1]
      if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) wewnatrz = !wewnatrz
    }
  }
  return wewnatrz
}

export class IndeksOdcinkow {
  /** @param {number} komorka bok komórki siatki w metrach (rząd typowej odległości do najbliższego obiektu) */
  constructor(komorka) {
    if (!(komorka > 0)) throw new Error('Bok komórki musi być dodatni')
    this.komorka = komorka
    this.ax = []
    this.ay = []
    this.bx = []
    this.by = []
    this.siatka = new Map()
    // Zakres zajętych komórek [ix0, iy0, ix1, iy1] – ogranicza liczbę pierścieni w zapytaniu.
    this.zakresKomorek = [
      Number.POSITIVE_INFINITY,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    ]
  }

  get liczba() {
    return this.ax.length
  }

  dodajOdcinek(ax, ay, bx, by) {
    const id = this.ax.length
    this.ax.push(ax)
    this.ay.push(ay)
    this.bx.push(bx)
    this.by.push(by)
    const k = this.komorka
    const x0 = Math.floor(Math.min(ax, bx) / k)
    const x1 = Math.floor(Math.max(ax, bx) / k)
    const y0 = Math.floor(Math.min(ay, by) / k)
    const y1 = Math.floor(Math.max(ay, by) / k)
    const z = this.zakresKomorek
    z[0] = Math.min(z[0], x0)
    z[1] = Math.min(z[1], y0)
    z[2] = Math.max(z[2], x1)
    z[3] = Math.max(z[3], y1)
    for (let ix = x0; ix <= x1; ix++)
      for (let iy = y0; iy <= y1; iy++) {
        const c = klucz(ix, iy)
        const lista = this.siatka.get(c)
        if (lista) lista.push(id)
        else this.siatka.set(c, [id])
      }
  }

  dodajPunkt(x, y) {
    this.dodajOdcinek(x, y, x, y)
  }

  /** Łamana [[x, y], ...]; pierścień wielokąta trzeba przekazać z powtórzonym pierwszym punktem. */
  dodajLamana(punkty) {
    if (punkty.length === 1) this.dodajPunkt(punkty[0][0], punkty[0][1])
    for (let i = 1; i < punkty.length; i++)
      this.dodajOdcinek(punkty[i - 1][0], punkty[i - 1][1], punkty[i][0], punkty[i][1])
  }

  /**
   * Odległość (m) od punktu do najbliższego obiektu albo null, gdy nic nie leży w `maxPromien`.
   * Wynik dokładny: obiekt spoza przejrzanych pierścieni jest dalej niż każdy zwrócony wynik.
   */
  najblizszy(px, py, maxPromien = Number.POSITIVE_INFINITY) {
    if (!this.ax.length) return null
    const k = this.komorka
    const cx = Math.floor(px / k)
    const cy = Math.floor(py / k)
    const { ax, ay, bx, by, siatka } = this
    let najlepszy2 = Number.POSITIVE_INFINITY
    const skan = (ix, iy) => {
      const lista = siatka.get(klucz(ix, iy))
      if (!lista) return
      for (let n = 0; n < lista.length; n++) {
        const i = lista[n]
        const d2 = kwadratOdleglosciDoOdcinka(px, py, ax[i], ay[i], bx[i], by[i])
        if (d2 < najlepszy2) najlepszy2 = d2
      }
    }
    // Poza zasięgiem danych pierścieni jest tyle, ile potrzeba do pokrycia całej siatki.
    const maxPierscien = Number.isFinite(maxPromien)
      ? Math.ceil(maxPromien / k) + 1
      : this.#pierscieniDoPokryciaSiatki(cx, cy)
    for (let r = 0; r <= maxPierscien; r++) {
      // Obiekty w pierścieniach >= r leżą dalej niż (r - 1) * k od punktu.
      if (r > 1 && najlepszy2 <= ((r - 1) * k) ** 2) break
      if (r === 0) skan(cx, cy)
      else {
        for (let ix = cx - r; ix <= cx + r; ix++) {
          skan(ix, cy - r)
          skan(ix, cy + r)
        }
        for (let iy = cy - r + 1; iy <= cy + r - 1; iy++) {
          skan(cx - r, iy)
          skan(cx + r, iy)
        }
      }
    }
    if (najlepszy2 === Number.POSITIVE_INFINITY) return null
    const d = Math.sqrt(najlepszy2)
    return d <= maxPromien ? d : null
  }

  #pierscieniDoPokryciaSiatki(cx, cy) {
    const [x0, y0, x1, y1] = this.zakresKomorek
    return Math.max(Math.abs(cx - x0), Math.abs(cx - x1), Math.abs(cy - y0), Math.abs(cy - y1)) + 1
  }
}

/** Wielokąty (z otworami) z szybkim pytaniem „czy punkt leży w którymkolwiek z nich". */
export class IndeksWielokatow {
  constructor(komorka) {
    if (!(komorka > 0)) throw new Error('Bok komórki musi być dodatni')
    this.komorka = komorka
    this.wielokaty = []
    this.obwiednie = []
    this.siatka = new Map()
  }

  get liczba() {
    return this.wielokaty.length
  }

  dodaj(pierscienie) {
    let x0 = Number.POSITIVE_INFINITY
    let y0 = Number.POSITIVE_INFINITY
    let x1 = Number.NEGATIVE_INFINITY
    let y1 = Number.NEGATIVE_INFINITY
    for (const p of pierscienie)
      for (const [x, y] of p) {
        x0 = Math.min(x0, x)
        y0 = Math.min(y0, y)
        x1 = Math.max(x1, x)
        y1 = Math.max(y1, y)
      }
    const id = this.wielokaty.length
    this.wielokaty.push(pierscienie)
    this.obwiednie.push([x0, y0, x1, y1])
    const k = this.komorka
    for (let ix = Math.floor(x0 / k); ix <= Math.floor(x1 / k); ix++)
      for (let iy = Math.floor(y0 / k); iy <= Math.floor(y1 / k); iy++) {
        const c = klucz(ix, iy)
        const lista = this.siatka.get(c)
        if (lista) lista.push(id)
        else this.siatka.set(c, [id])
      }
  }

  zawiera(px, py) {
    const k = this.komorka
    const lista = this.siatka.get(klucz(Math.floor(px / k), Math.floor(py / k)))
    if (!lista) return false
    for (const id of lista) {
      const [x0, y0, x1, y1] = this.obwiednie[id]
      if (
        px >= x0 &&
        px <= x1 &&
        py >= y0 &&
        py <= y1 &&
        punktWPierscieniach(px, py, this.wielokaty[id])
      )
        return true
    }
    return false
  }
}
