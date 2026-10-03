// Sieć krótkich odcinków z indeksem siatkowym w układzie metrycznym (np. EPSG:2180).
// Do czego: najbliższy odcinek do punktu, dopasowanie odcinka z drugiego źródła (bliski i równoległy)
// oraz długość dróg w kole z podziałem na klasy (udział dróg gruntowych w promieniu 300 m).
// Dlaczego nie IndeksOdcinkow z lib/odcinki.mjs: tamten zwraca tylko odległość i znacznik, a tu
// potrzebujemy numeru odcinka (żeby zmienić klasę po dopasowaniu), kierunku odcinka i długości
// obciętej do koła.

/** Odległość punktu P od odcinka AB. */
export function odlegloscDoOdcinka(px, py, ax, ay, bx, by) {
  const dx = bx - ax
  const dy = by - ay
  const d2 = dx * dx + dy * dy
  let t = d2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / d2
  if (t < 0) t = 0
  else if (t > 1) t = 1
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

/**
 * Długość części odcinka AB, która leży w kole o środku C i promieniu r. Rozwiązujemy równanie
 * |A + t·(B − A) − C|² = r² i obcinamy t do [0, 1]; odcinek styczny albo poza kołem daje 0.
 */
export function dlugoscWKole(ax, ay, bx, by, cx, cy, r) {
  const dx = bx - ax
  const dy = by - ay
  const a = dx * dx + dy * dy
  if (a === 0) return 0
  const fx = ax - cx
  const fy = ay - cy
  const b = 2 * (fx * dx + fy * dy)
  const delta = b * b - 4 * a * (fx * fx + fy * fy - r * r)
  if (delta <= 0) return 0
  const pierwiastek = Math.sqrt(delta)
  const t1 = Math.max(0, (-b - pierwiastek) / (2 * a))
  const t2 = Math.min(1, (-b + pierwiastek) / (2 * a))
  return t2 > t1 ? (t2 - t1) * Math.sqrt(a) : 0
}

const KLASY = 4 // klasa 0–3; znaczenie nadaje wołający (np. 0 nieznana, 1 utwardzona, 2 gruntowa)

export class SiecOdcinkow {
  /**
   * @param {{ komorka?: number, maxOdcinek?: number }} opcje `komorka` – bok komórki siatki (m);
   *   `maxOdcinek` – najdłuższy kawałek po podziale (m). Dłuższe odcinki dzielimy, żeby każdy trafiał
   *   do kilku komórek, a klasę dało się zmieniać na krótkich fragmentach drogi.
   */
  constructor({ komorka = 100, maxOdcinek = 30 } = {}) {
    if (!(komorka >= 10)) throw new Error('Komórka siatki musi mieć co najmniej 10 m')
    if (!(maxOdcinek > 0)) throw new Error('maxOdcinek musi być dodatni')
    this.komorka = komorka
    this.maxOdcinek = maxOdcinek
    this._ax = []
    this._ay = []
    this._bx = []
    this._by = []
    this._klasa = []
    this._detal = []
    this._zrodlo = []
    this._ranga = []
    this._wlasciciel = []
    this.zbudowana = false
    /** Odległość najlepszego trafienia z ostatniego wywołania `najblizszy*` (m). */
    this.odleglosc = Infinity
  }

  get liczba() {
    return this.zbudowana ? this.ax.length : this._ax.length
  }

  /**
   * Dodaje łamaną [[x, y], …] jako krótkie odcinki. Atrybuty trafiają do każdego kawałka:
   * `klasa` 0–3, `detal`, `zrodlo` i `ranga` (liczby 0–255), `wlasciciel` (numer linii u wołającego).
   * @returns {number} liczba dodanych odcinków
   */
  dodajLinie(punkty, { klasa = 0, detal = 0, zrodlo = 0, ranga = 0, wlasciciel = -1 } = {}) {
    if (this.zbudowana) throw new Error('Sieć jest już zbudowana')
    if (!(klasa >= 0 && klasa < KLASY)) throw new Error(`klasa poza zakresem 0–${KLASY - 1}`)
    let dodano = 0
    for (let i = 1; i < punkty.length; i++) {
      const [x1, y1] = punkty[i - 1]
      const [x2, y2] = punkty[i]
      if (![x1, y1, x2, y2].every(Number.isFinite)) continue
      const dl = Math.hypot(x2 - x1, y2 - y1)
      if (dl === 0) continue
      const czesci = Math.max(1, Math.ceil(dl / this.maxOdcinek))
      for (let c = 0; c < czesci; c++) {
        const t0 = c / czesci
        const t1 = (c + 1) / czesci
        this._ax.push(x1 + (x2 - x1) * t0)
        this._ay.push(y1 + (y2 - y1) * t0)
        this._bx.push(x1 + (x2 - x1) * t1)
        this._by.push(y1 + (y2 - y1) * t1)
        this._klasa.push(klasa)
        this._detal.push(detal)
        this._zrodlo.push(zrodlo)
        this._ranga.push(ranga)
        this._wlasciciel.push(wlasciciel)
        dodano++
      }
    }
    return dodano
  }

  /** Dodaje jeden gotowy odcinek bez dzielenia (np. przeniesiony z innej sieci). */
  dodajOdcinek(
    ax,
    ay,
    bx,
    by,
    { klasa = 0, detal = 0, zrodlo = 0, ranga = 0, wlasciciel = -1 } = {},
  ) {
    if (this.zbudowana) throw new Error('Sieć jest już zbudowana')
    if (!(klasa >= 0 && klasa < KLASY)) throw new Error(`klasa poza zakresem 0–${KLASY - 1}`)
    if (![ax, ay, bx, by].every(Number.isFinite) || (ax === bx && ay === by)) return false
    this._ax.push(ax)
    this._ay.push(ay)
    this._bx.push(bx)
    this._by.push(by)
    this._klasa.push(klasa)
    this._detal.push(detal)
    this._zrodlo.push(zrodlo)
    this._ranga.push(ranga)
    this._wlasciciel.push(wlasciciel)
    return true
  }

  /** Zamyka dodawanie: tablice zamieniamy na typowane i budujemy siatkę w układzie CSR. */
  zbuduj() {
    if (this.zbudowana) return this
    const n = this._ax.length
    this.ax = Float64Array.from(this._ax)
    this.ay = Float64Array.from(this._ay)
    this.bx = Float64Array.from(this._bx)
    this.by = Float64Array.from(this._by)
    this.klasa = Uint8Array.from(this._klasa)
    this.detal = Uint8Array.from(this._detal)
    this.zrodlo = Uint8Array.from(this._zrodlo)
    this.ranga = Uint8Array.from(this._ranga)
    this.wlasciciel = Int32Array.from(this._wlasciciel)
    this._ax = this._ay = this._bx = this._by = null
    this._klasa = this._detal = this._zrodlo = this._ranga = this._wlasciciel = null
    this.dlugosc = new Float64Array(n)
    this.kx = new Float64Array(n) // jednostkowy wektor kierunku
    this.ky = new Float64Array(n)
    let xmin = Infinity
    let ymin = Infinity
    let xmax = -Infinity
    let ymax = -Infinity
    for (let i = 0; i < n; i++) {
      const dx = this.bx[i] - this.ax[i]
      const dy = this.by[i] - this.ay[i]
      const dl = Math.hypot(dx, dy)
      this.dlugosc[i] = dl
      this.kx[i] = dx / dl
      this.ky[i] = dy / dl
      xmin = Math.min(xmin, this.ax[i], this.bx[i])
      xmax = Math.max(xmax, this.ax[i], this.bx[i])
      ymin = Math.min(ymin, this.ay[i], this.by[i])
      ymax = Math.max(ymax, this.ay[i], this.by[i])
    }
    const k = this.komorka
    this.x0 = n ? xmin : 0
    this.y0 = n ? ymin : 0
    this.nx = n ? Math.floor((xmax - xmin) / k) + 1 : 1
    this.ny = n ? Math.floor((ymax - ymin) / k) + 1 : 1
    if (this.nx * this.ny > 80_000_000)
      throw new Error(`Siatka ${this.nx} × ${this.ny} komórek jest za duża – zawęź obszar`)
    const liczniki = new Int32Array(this.nx * this.ny + 1)
    const zakres = (i) => [
      Math.floor((Math.min(this.ax[i], this.bx[i]) - this.x0) / k),
      Math.floor((Math.max(this.ax[i], this.bx[i]) - this.x0) / k),
      Math.floor((Math.min(this.ay[i], this.by[i]) - this.y0) / k),
      Math.floor((Math.max(this.ay[i], this.by[i]) - this.y0) / k),
    ]
    for (let i = 0; i < n; i++) {
      const [i0, i1, j0, j1] = zakres(i)
      for (let j = j0; j <= j1; j++)
        for (let ix = i0; ix <= i1; ix++) liczniki[j * this.nx + ix + 1]++
    }
    for (let c = 1; c < liczniki.length; c++) liczniki[c] += liczniki[c - 1]
    this.poczatki = liczniki
    this.lista = new Int32Array(liczniki[liczniki.length - 1])
    const wypelnienie = Int32Array.from(liczniki.subarray(0, liczniki.length - 1))
    for (let i = 0; i < n; i++) {
      const [i0, i1, j0, j1] = zakres(i)
      for (let j = j0; j <= j1; j++)
        for (let ix = i0; ix <= i1; ix++) this.lista[wypelnienie[j * this.nx + ix]++] = i
    }
    this.stempel = new Int32Array(n)
    this.numerZapytania = 0
    this.zbudowana = true
    return this
  }

  /** Zakres komórek [i0, i1, j0, j1] pokrywający kwadrat o boku 2·promien wokół punktu (obcięty do siatki). */
  _komorki(x, y, promien) {
    const k = this.komorka
    return [
      Math.max(0, Math.floor((x - promien - this.x0) / k)),
      Math.min(this.nx - 1, Math.floor((x + promien - this.x0) / k)),
      Math.max(0, Math.floor((y - promien - this.y0) / k)),
      Math.min(this.ny - 1, Math.floor((y + promien - this.y0) / k)),
    ]
  }

  /**
   * Numer najbliższego odcinka w promieniu `maxM` albo -1; odległość w `this.odleglosc`.
   * Z `kierunek` = [ux, uy, cosMin] bierze tylko odcinki prawie równoległe do wektora (|cos| ≥ cosMin).
   * Z `klasa` ≥ 0 bierze tylko odcinki tej klasy, a z `minRanga` > 0 tylko odcinki o randze co najmniej tyle.
   * Przy remisie wygrywa mniejszy numer odcinka, więc wynik nie zależy od kolejności komórek.
   */
  najblizszy(x, y, maxM, kierunek = null, klasa = -1, minRanga = 0) {
    if (!this.zbudowana) throw new Error('Najpierw zbuduj()')
    this.odleglosc = Infinity
    if (!this.ax.length || !Number.isFinite(x) || !Number.isFinite(y)) return -1
    const numer = ++this.numerZapytania
    const [i0, i1, j0, j1] = this._komorki(x, y, maxM)
    let najlepsza = Infinity
    let id = -1
    for (let j = j0; j <= j1; j++)
      for (let ix = i0; ix <= i1; ix++) {
        const c = j * this.nx + ix
        for (let p = this.poczatki[c]; p < this.poczatki[c + 1]; p++) {
          const o = this.lista[p]
          if (this.stempel[o] === numer) continue
          this.stempel[o] = numer
          if (klasa >= 0 && this.klasa[o] !== klasa) continue
          if (minRanga > 0 && this.ranga[o] < minRanga) continue
          if (kierunek) {
            const cos = Math.abs(this.kx[o] * kierunek[0] + this.ky[o] * kierunek[1])
            if (cos < kierunek[2]) continue
          }
          const d = odlegloscDoOdcinka(x, y, this.ax[o], this.ay[o], this.bx[o], this.by[o])
          if (d < najlepsza || (d === najlepsza && o < id)) {
            najlepsza = d
            id = o
          }
        }
      }
    if (id < 0 || najlepsza > maxM) return -1
    this.odleglosc = najlepsza
    return id
  }

  /**
   * Numery odcinków oddalonych od punktu o najwyżej `promien` m (każdy raz, kolejność dowolna);
   * odległości w `this.odleglosci` (tablica równoległa do wyniku).
   */
  wPromieniu(x, y, promien) {
    if (!this.zbudowana) throw new Error('Najpierw zbuduj()')
    const wynik = []
    this.odleglosci = []
    if (!this.ax.length) return wynik
    const numer = ++this.numerZapytania
    const [i0, i1, j0, j1] = this._komorki(x, y, promien)
    for (let j = j0; j <= j1; j++)
      for (let ix = i0; ix <= i1; ix++) {
        const c = j * this.nx + ix
        for (let p = this.poczatki[c]; p < this.poczatki[c + 1]; p++) {
          const o = this.lista[p]
          if (this.stempel[o] === numer) continue
          this.stempel[o] = numer
          const d = odlegloscDoOdcinka(x, y, this.ax[o], this.ay[o], this.bx[o], this.by[o])
          if (d <= promien) {
            wynik.push(o)
            this.odleglosci.push(d)
          }
        }
      }
    return wynik
  }

  /**
   * Sumy długości odcinków w kole (obcięte do koła) wg klasy: wynik[klasa] += długość.
   * `wynik` – Float64Array(4) wyzerowany przez wołającego.
   */
  dlugosciWKole(x, y, promien, wynik) {
    if (!this.zbudowana) throw new Error('Najpierw zbuduj()')
    if (!this.ax.length) return wynik
    const numer = ++this.numerZapytania
    const [i0, i1, j0, j1] = this._komorki(x, y, promien)
    for (let j = j0; j <= j1; j++)
      for (let ix = i0; ix <= i1; ix++) {
        const c = j * this.nx + ix
        for (let p = this.poczatki[c]; p < this.poczatki[c + 1]; p++) {
          const o = this.lista[p]
          if (this.stempel[o] === numer) continue
          this.stempel[o] = numer
          wynik[this.klasa[o]] += dlugoscWKole(
            this.ax[o],
            this.ay[o],
            this.bx[o],
            this.by[o],
            x,
            y,
            promien,
          )
        }
      }
    return wynik
  }
}
