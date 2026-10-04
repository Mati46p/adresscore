/**
 * Silnik trybu „Biznes” (E10, #105–#107): uproszczony model Huffa. Każdy heks popytu dzieli się
 * między punkty usługi w promieniu branży; atrakcyjność punktu maleje z odległością.
 *
 * Wydajność: indeks buduje się RAZ na branżę (`zbudujIndeks`), a ocena stawianego miejsca liczy
 * tylko heksy w jego promieniu – Huff zmienia się wyłącznie lokalnie, bo nowy punkt konkuruje
 * tylko z punktami, które leżą w zasięgu tych samych heksów. Wynik jest taki sam jak przy
 * przeliczeniu całego miasta (pilnuje tego test z odniesieniem „na brute force”).
 */
export type KomorkaPopytu = [
  h3: string,
  lon: number,
  lat: number,
  adresy: number,
  ludnosc: number,
  kursy: number,
]
export type PunktUslugi = [lon: number, lat: number, nazwa: string]
export interface Miejsce {
  lon: number
  lat: number
}
export interface OcenaMiejsca {
  adresyWZasiegu: number
  mieszkancyWZasiegu: number
  kursySzczytSrednio: number
  konkurenci: number
  przydzieloneAdresy: number
  przydzielonyPopyt: number
  udzialProcent: number
  /**
   * Pozycja w rozkładzie ISTNIEJĄCYCH punktów branży, które mają popyt w zasięgu (0–100):
   * odsetek punktów z mniejszym przydziałem, remisy po połowie. `null` = nie ma z czym
   * porównać (miejsce bez adresów w zasięgu albo brak punktów odniesienia).
   */
  percentyl: number | null
  /** Ile istniejących punktów weszło do rozkładu, z którego liczono `percentyl`. */
  porownanoZ: number
  najblizszyKonkurent: string | null
  odlegloscKonkurenta: number | null
}
export interface BialaPlama {
  h3: string
  /**
   * Adresy w zasięgu na jeden istniejący punkt. `null`, gdy w zasięgu nie ma ŻADNEGO punktu:
   * wtedy nie ma przez co dzielić, a to inna kategoria niż heks z jednym punktem (patrz
   * `bezPunktu`). Wcześniej `max(1, konkurenci)` zlewał oba przypadki.
   */
  adresyNaPunkt: number | null
  adresyWZasiegu: number
  konkurenci: number
  najblizszyKonkurent: string | null
  skala: number
}

// ── Parametry modelu ─────────────────────────────────────────────────────────────────────

/** Stopnie na metry dla szerokości Krakowa: płaska aproksymacja, na obszarze danych błąd poniżej 0,5%. */
export const METRY_LON = 71_450
export const METRY_LAT = 111_200
/** Bok kratki siatki wyszukiwania; nie zależy od promienia branży, więc siatka heksów jest wspólna. */
const KRATKA_M = 400
/** Siatka nie ma prawa zająć więcej kratek, nawet gdy dane rozsypią się po całym kraju. */
const MAKS_KRATEK = 1_000_000
/** Punkt bliżej niż tyle metrów od stawianego miejsca to ten sam obiekt (nie dwa identyczne sklepy). */
export const PROMIEN_TEGO_SAMEGO_M = 25
/** Poniżej tej odległości punkt nie jest już atrakcyjniejszy – klient i tak jest „na miejscu”. */
const MIN_ODLEGLOSC_M = 80
const WYKLADNIK_ODLEGLOSCI = 1.6
/** Premia za kursy w porannym szczycie: do 20 kursów po 1,5% popytu (łącznie najwyżej +30%). */
const MAKS_KURSOW_W_PREMII = 20
const PREMIA_ZA_KURS = 0.015

const x = (lon: number) => lon * METRY_LON
const y = (lat: number) => lat * METRY_LAT
const atrakcyjnosc = (metry: number) =>
  1 / Math.pow(Math.max(MIN_ODLEGLOSC_M, metry), WYKLADNIK_ODLEGLOSCI)

/** Udziały dla jednego źródła popytu sumują się do 1. */
export function udzialyHuffa(odleglosci: readonly number[]): number[] {
  if (!odleglosci.length) return []
  const atrakcyjnosci = odleglosci.map(atrakcyjnosc)
  const suma = atrakcyjnosci.reduce((a, b) => a + b, 0)
  return atrakcyjnosci.map((a) => a / suma)
}

/** Indeks popytu: osoby NSP 2021 plus niewielka premia za kursy w porannym szczycie. */
export function popytKomorki(adresy: number, ludnosc: number, kursy: number): number {
  const bazowy = ludnosc > 0 ? ludnosc : adresy * 2
  return bazowy * (1 + Math.min(Math.max(kursy, 0), MAKS_KURSOW_W_PREMII) * PREMIA_ZA_KURS)
}

// ── Siatka wyszukiwania ──────────────────────────────────────────────────────────────────

/** Jednorazowo alokowany bufor wyników zapytania „w promieniu” (rośnie, gdy trzeba). */
class Wyniki {
  n = 0
  idx = new Int32Array(256)
  d = new Float64Array(256)
  /** Miejsce na wagę liczoną przez wołającego, w tej samej kolejności co `idx`. */
  w = new Float64Array(256)
  dodaj(i: number, odleglosc: number) {
    if (this.n === this.idx.length) {
      const nowa = this.n * 2
      const idx = new Int32Array(nowa)
      const d = new Float64Array(nowa)
      const w = new Float64Array(nowa)
      idx.set(this.idx)
      d.set(this.d)
      w.set(this.w)
      this.idx = idx
      this.d = d
      this.w = w
    }
    this.idx[this.n] = i
    this.d[this.n] = odleglosc
    this.n++
  }
}

/** Siatka kratek w układzie CSR: `elementy[start[k] .. start[k + 1])` to obiekty kratki `k`. */
interface Siatka {
  bok: number
  gx0: number
  gy0: number
  szer: number
  wys: number
  start: Int32Array
  elementy: Int32Array
}

function zbudujSiatke(xs: Float64Array, ys: Float64Array): Siatka {
  const n = xs.length
  if (n === 0)
    return {
      bok: KRATKA_M,
      gx0: 0,
      gy0: 0,
      szer: 0,
      wys: 0,
      start: new Int32Array(1),
      elementy: new Int32Array(0),
    }
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (let i = 0; i < n; i++) {
    const px = xs[i] as number
    const py = ys[i] as number
    if (px < minX) minX = px
    if (px > maxX) maxX = px
    if (py < minY) minY = py
    if (py > maxY) maxY = py
  }
  const bok = Math.max(KRATKA_M, Math.sqrt(((maxX - minX) * (maxY - minY)) / MAKS_KRATEK))
  const gx0 = Math.floor(minX / bok)
  const gy0 = Math.floor(minY / bok)
  const szer = Math.floor(maxX / bok) - gx0 + 1
  const wys = Math.floor(maxY / bok) - gy0 + 1
  const start = new Int32Array(szer * wys + 1)
  const kratkaObiektu = new Int32Array(n)
  for (let i = 0; i < n; i++) {
    const k =
      (Math.floor((ys[i] as number) / bok) - gy0) * szer +
      (Math.floor((xs[i] as number) / bok) - gx0)
    kratkaObiektu[i] = k
    start[k + 1] = (start[k + 1] as number) + 1
  }
  for (let k = 0; k < szer * wys; k++)
    start[k + 1] = (start[k + 1] as number) + (start[k] as number)
  const wolne = start.slice(0, szer * wys)
  const elementy = new Int32Array(n)
  for (let i = 0; i < n; i++) {
    const k = kratkaObiektu[i] as number
    elementy[wolne[k] as number] = i
    wolne[k] = (wolne[k] as number) + 1
  }
  return { bok, gx0, gy0, szer, wys, start, elementy }
}

/** Obiekty siatki w promieniu `r` (metry) od punktu: indeks i odległość w `wyniki`. */
function wPromieniu(
  s: Siatka,
  xs: Float64Array,
  ys: Float64Array,
  px: number,
  py: number,
  r: number,
  wyniki: Wyniki,
): void {
  wyniki.n = 0
  if (s.szer === 0) return
  const r2 = r * r
  const gxMin = Math.max(0, Math.floor((px - r) / s.bok) - s.gx0)
  const gxMax = Math.min(s.szer - 1, Math.floor((px + r) / s.bok) - s.gx0)
  const gyMin = Math.max(0, Math.floor((py - r) / s.bok) - s.gy0)
  const gyMax = Math.min(s.wys - 1, Math.floor((py + r) / s.bok) - s.gy0)
  for (let gy = gyMin; gy <= gyMax; gy++) {
    for (let gx = gxMin; gx <= gxMax; gx++) {
      const k = gy * s.szer + gx
      const koniec = s.start[k + 1] as number
      for (let e = s.start[k] as number; e < koniec; e++) {
        const i = s.elementy[e] as number
        const dx = (xs[i] as number) - px
        const dy = (ys[i] as number) - py
        const d2 = dx * dx + dy * dy
        if (d2 <= r2) wyniki.dodaj(i, Math.sqrt(d2))
      }
    }
  }
}

// ── Indeksy ──────────────────────────────────────────────────────────────────────────────

/** Heksy popytu w układzie tablic i z siatką. Nie zależy od branży – buduje się raz na worker. */
export interface IndeksKomorek {
  readonly n: number
  readonly h3: readonly string[]
  readonly x: Float64Array
  readonly y: Float64Array
  readonly adresy: Float64Array
  readonly ludnosc: Float64Array
  readonly kursy: Float64Array
  /** Indeks popytu heksu (`popyt`), liczony raz. */
  readonly popyt: Float64Array
  readonly siatka: Siatka
}

export function przygotujKomorki(dane: readonly KomorkaPopytu[]): IndeksKomorek {
  const n = dane.length
  const h3: string[] = []
  const xs = new Float64Array(n)
  const ys = new Float64Array(n)
  const adresy = new Float64Array(n)
  const ludnosc = new Float64Array(n)
  const kursy = new Float64Array(n)
  const pop = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const [id, lon, lat, a, l, kk] = dane[i] as KomorkaPopytu
    h3.push(id)
    xs[i] = x(lon)
    ys[i] = y(lat)
    adresy[i] = a
    ludnosc[i] = l
    kursy[i] = kk
    pop[i] = popytKomorki(a, l, kk)
  }
  return {
    n,
    h3,
    x: xs,
    y: ys,
    adresy,
    ludnosc,
    kursy,
    popyt: pop,
    siatka: zbudujSiatke(xs, ys),
  }
}

/** Wszystko, co wynika z istniejących punktów jednej branży. Buduje się raz po wyborze branży. */
export interface IndeksBiznesu {
  readonly promien: number
  readonly komorki: IndeksKomorek
  readonly nPunktow: number
  readonly px: Float64Array
  readonly py: Float64Array
  readonly nazwy: readonly string[]
  readonly siatkaPunktow: Siatka
  /** Per heks: suma atrakcyjności punktów w zasięgu (mianownik Huffa). */
  readonly sumaAtrakcyjnosci: Float64Array
  /** Per heks: ile punktów w zasięgu. */
  readonly punktowWZasiegu: Int32Array
  /** Per heks: najbliższy punkt w zasięgu albo -1. */
  readonly najblizszyPunkt: Int32Array
  /** Per punkt: popyt i adresy przydzielone przez model przy obecnym układzie punktów. */
  readonly przydzialPopytu: Float64Array
  readonly przydzialAdresow: Float64Array
  /** Per punkt: ile heksów popytu ma w swoim zasięgu. 0 = punkt poza obszarem danych. */
  readonly heksowWZasiegu: Int32Array
  /** Przydziały popytu punktów, które mają popyt w zasięgu – rosnąco. To rozkład porównawczy. */
  readonly rozklad: Float64Array
  /** Adresy w heksach bez żadnego punktu w zasięgu. */
  readonly nieobsluzoneAdresy: number
}

export function zbudujIndeks(
  komorki: IndeksKomorek,
  uslugi: readonly PunktUslugi[],
  promien: number,
): IndeksBiznesu {
  const np = uslugi.length
  const px = new Float64Array(np)
  const py = new Float64Array(np)
  const nazwy: string[] = []
  for (let j = 0; j < np; j++) {
    const [lon, lat, nazwa] = uslugi[j] as PunktUslugi
    px[j] = x(lon)
    py[j] = y(lat)
    nazwy.push(nazwa)
  }
  const siatkaPunktow = zbudujSiatke(px, py)
  const nc = komorki.n
  const sumaAtrakcyjnosci = new Float64Array(nc)
  const punktowWZasiegu = new Int32Array(nc)
  const najblizszyPunkt = new Int32Array(nc).fill(-1)
  const przydzialPopytu = new Float64Array(np)
  const przydzialAdresow = new Float64Array(np)
  const heksowWZasiegu = new Int32Array(np)
  const bliskie = new Wyniki()
  let nieobsluzoneAdresy = 0
  for (let i = 0; i < nc; i++) {
    wPromieniu(
      siatkaPunktow,
      px,
      py,
      komorki.x[i] as number,
      komorki.y[i] as number,
      promien,
      bliskie,
    )
    const k = bliskie.n
    punktowWZasiegu[i] = k
    if (k === 0) {
      nieobsluzoneAdresy += komorki.adresy[i] as number
      continue
    }
    let suma = 0
    let najblizszy = -1
    let najblizszaOdleglosc = Infinity
    for (let t = 0; t < k; t++) {
      const a = atrakcyjnosc(bliskie.d[t] as number)
      bliskie.w[t] = a
      suma += a
      const odleglosc = bliskie.d[t] as number
      const j = bliskie.idx[t] as number
      // Remis odległości rozstrzyga niższy indeks punktu, żeby wynik nie zależał od kolejności kratek.
      if (
        odleglosc < najblizszaOdleglosc ||
        (odleglosc === najblizszaOdleglosc && j < najblizszy)
      ) {
        najblizszaOdleglosc = odleglosc
        najblizszy = j
      }
    }
    sumaAtrakcyjnosci[i] = suma
    najblizszyPunkt[i] = najblizszy
    const popytKomorki = komorki.popyt[i] as number
    const adresyKomorki = komorki.adresy[i] as number
    for (let t = 0; t < k; t++) {
      const j = bliskie.idx[t] as number
      const udzial = (bliskie.w[t] as number) / suma
      przydzialPopytu[j] = (przydzialPopytu[j] as number) + popytKomorki * udzial
      przydzialAdresow[j] = (przydzialAdresow[j] as number) + adresyKomorki * udzial
      heksowWZasiegu[j] = (heksowWZasiegu[j] as number) + 1
    }
  }
  const wRozkladzie: number[] = []
  for (let j = 0; j < np; j++)
    if ((heksowWZasiegu[j] as number) > 0) wRozkladzie.push(przydzialPopytu[j] as number)
  const rozklad = Float64Array.from(wRozkladzie).sort()
  return {
    promien,
    komorki,
    nPunktow: np,
    px,
    py,
    nazwy,
    siatkaPunktow,
    sumaAtrakcyjnosci,
    punktowWZasiegu,
    najblizszyPunkt,
    przydzialPopytu,
    przydzialAdresow,
    heksowWZasiegu,
    rozklad,
    nieobsluzoneAdresy,
  }
}

// ── Ocena miejsca ────────────────────────────────────────────────────────────────────────

/** Ile elementów posortowanej tablicy jest mniejszych od `wartosc` i ile równych. */
export function pozycjaWRozkladzie(posortowane: Float64Array, wartosc: number): [number, number] {
  let lo = 0
  let hi = posortowane.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if ((posortowane[mid] as number) < wartosc) lo = mid + 1
    else hi = mid
  }
  const mniejsze = lo
  hi = posortowane.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if ((posortowane[mid] as number) <= wartosc) lo = mid + 1
    else hi = mid
  }
  return [mniejsze, lo - mniejsze]
}

/**
 * Ocena stawianego miejsca na gotowym indeksie. Przelicza tylko heksy w promieniu miejsca:
 * udział nowego punktu w heksie to `a_nowy / (suma_istniejących + a_nowy)`, a suma istniejących
 * jest już w indeksie (bez punktu zastąpionego, jeśli miejsce leży na istniejącym obiekcie).
 */
export function ocenMiejsceWIndeksie(indeks: IndeksBiznesu, miejsce: Miejsce): OcenaMiejsca {
  const { komorki, promien } = indeks
  const mx = x(miejsce.lon)
  const my = y(miejsce.lat)
  const r2 = promien * promien

  const punkty = new Wyniki()
  wPromieniu(indeks.siatkaPunktow, indeks.px, indeks.py, mx, my, promien, punkty)
  let najblizszy = -1
  let najblizszaOdleglosc = Infinity
  for (let t = 0; t < punkty.n; t++) {
    const odleglosc = punkty.d[t] as number
    const j = punkty.idx[t] as number
    if (odleglosc < najblizszaOdleglosc || (odleglosc === najblizszaOdleglosc && j < najblizszy)) {
      najblizszaOdleglosc = odleglosc
      najblizszy = j
    }
  }
  // Punkt na istniejącym obiekcie porównujemy jako ten sam obiekt, a nie dwa identyczne sklepy.
  const zastapiony =
    najblizszy >= 0 && najblizszaOdleglosc <= PROMIEN_TEGO_SAMEGO_M ? najblizszy : -1
  let konkurent = -1
  let odlegloscKonkurenta = Infinity
  for (let t = 0; t < punkty.n; t++) {
    const j = punkty.idx[t] as number
    if (j === zastapiony) continue
    const odleglosc = punkty.d[t] as number
    if (odleglosc < odlegloscKonkurenta || (odleglosc === odlegloscKonkurenta && j < konkurent)) {
      odlegloscKonkurenta = odleglosc
      konkurent = j
    }
  }
  const zx = zastapiony >= 0 ? (indeks.px[zastapiony] as number) : 0
  const zy = zastapiony >= 0 ? (indeks.py[zastapiony] as number) : 0

  const heksy = new Wyniki()
  wPromieniu(komorki.siatka, komorki.x, komorki.y, mx, my, promien, heksy)
  let adresyWZasiegu = 0
  let mieszkancyWZasiegu = 0
  let kursyWazone = 0
  let przydzieloneAdresy = 0
  let przydzielonyPopyt = 0
  for (let t = 0; t < heksy.n; t++) {
    const i = heksy.idx[t] as number
    const adresy = komorki.adresy[i] as number
    adresyWZasiegu += adresy
    mieszkancyWZasiegu += komorki.ludnosc[i] as number
    kursyWazone += (komorki.kursy[i] as number) * adresy
    const nowy = atrakcyjnosc(heksy.d[t] as number)
    let istniejace = indeks.sumaAtrakcyjnosci[i] as number
    if (zastapiony >= 0) {
      const dx = (komorki.x[i] as number) - zx
      const dy = (komorki.y[i] as number) - zy
      const d2 = dx * dx + dy * dy
      // Zastąpiony punkt wypada z mianownika tylko tam, gdzie wcześniej w nim był.
      if (d2 <= r2) istniejace = Math.max(0, istniejace - atrakcyjnosc(Math.sqrt(d2)))
    }
    const udzial = nowy / (istniejace + nowy)
    przydzieloneAdresy += adresy * udzial
    przydzielonyPopyt += (komorki.popyt[i] as number) * udzial
  }

  let percentyl: number | null = null
  let porownanoZ = indeks.rozklad.length
  if (adresyWZasiegu > 0) {
    let [mniejsze, rowne] = pozycjaWRozkladzie(indeks.rozklad, przydzielonyPopyt)
    // Miejsce na istniejącym obiekcie nie porównuje się samo ze sobą.
    if (zastapiony >= 0 && (indeks.heksowWZasiegu[zastapiony] as number) > 0) {
      const wlasny = indeks.przydzialPopytu[zastapiony] as number
      if (wlasny < przydzielonyPopyt) mniejsze--
      else if (wlasny === przydzielonyPopyt) rowne--
      porownanoZ--
    }
    if (porownanoZ > 0) percentyl = Math.round((100 * (mniejsze + rowne / 2)) / porownanoZ)
  }

  return {
    adresyWZasiegu,
    mieszkancyWZasiegu,
    kursySzczytSrednio: adresyWZasiegu ? kursyWazone / adresyWZasiegu : 0,
    konkurenci: punkty.n - (zastapiony >= 0 ? 1 : 0),
    przydzieloneAdresy,
    przydzielonyPopyt,
    udzialProcent: adresyWZasiegu ? Math.round((100 * przydzieloneAdresy) / adresyWZasiegu) : 0,
    percentyl,
    porownanoZ,
    najblizszyKonkurent: konkurent >= 0 ? indeks.nazwy[konkurent] || null : null,
    odlegloscKonkurenta: konkurent >= 0 ? Math.round(odlegloscKonkurenta) : null,
  }
}

/**
 * Ocena „od zera”: buduje indeks przy każdym wywołaniu (kilkaset ms na danych całego miasta).
 * Do testów i jednorazowych obliczeń; aplikacja trzyma indeks w workerze (`zbudujIndeks`).
 */
export function ocenMiejsce(
  dane: readonly KomorkaPopytu[],
  uslugi: readonly PunktUslugi[],
  promien: number,
  miejsce: Miejsce,
): OcenaMiejsca {
  return ocenMiejsceWIndeksie(zbudujIndeks(przygotujKomorki(dane), uslugi, promien), miejsce)
}

// ── Białe plamy ──────────────────────────────────────────────────────────────────────────

const adresyWZasiegu = new WeakMap<IndeksKomorek, Map<number, Float64Array>>()

/**
 * Adresy w zasięgu każdego heksu: suma po heksach w promieniu (z samym heksem), czyli te same
 * adresy, które liczy ocena miejsca. Zależy wyłącznie od heksów popytu i promienia, nie od punktów
 * branży ani od filtrów, więc liczy się raz na parę (heksy, promień). To najdroższa część białych
 * plam (ok. 50 ms przy 500 m, ok. 370 ms przy 2000 m), a zmiana filtra albo branży o tym samym
 * zasięgu powtarzałaby ją na próżno. Zwracana tablica jest wspólna: wołający tylko ją czytają.
 */
export function adresyWZasieguHeksow(komorki: IndeksKomorek, promien: number): Float64Array {
  let poPromieniu = adresyWZasiegu.get(komorki)
  if (!poPromieniu) {
    poPromieniu = new Map()
    adresyWZasiegu.set(komorki, poPromieniu)
  }
  const znane = poPromieniu.get(promien)
  if (znane) return znane
  const wynik = new Float64Array(komorki.n)
  const sasiedzi = new Wyniki()
  for (let i = 0; i < komorki.n; i++) {
    wPromieniu(
      komorki.siatka,
      komorki.x,
      komorki.y,
      komorki.x[i] as number,
      komorki.y[i] as number,
      promien,
      sasiedzi,
    )
    let suma = 0
    for (let t = 0; t < sasiedzi.n; t++) suma += komorki.adresy[sasiedzi.idx[t] as number] as number
    wynik[i] = suma
  }
  poPromieniu.set(promien, wynik)
  return wynik
}

/**
 * Per heks r10: adresy w zasięgu, punkty w zasięgu i najbliższy konkurent. Adresy w zasięgu to
 * suma po heksach w promieniu branży (z samym heksem), czyli te same adresy, które liczy ocena.
 */
export function bialePlamyZIndeksu(indeks: IndeksBiznesu): BialaPlama[] {
  const { komorki, promien } = indeks
  const adresyWPromieniu = adresyWZasieguHeksow(komorki, promien)
  const surowe: BialaPlama[] = []
  for (let i = 0; i < komorki.n; i++) {
    const adresyWZasiegu = adresyWPromieniu[i] as number
    const k = indeks.punktowWZasiegu[i] as number
    const najblizszy = indeks.najblizszyPunkt[i] as number
    surowe.push({
      h3: komorki.h3[i] as string,
      adresyNaPunkt: k > 0 ? adresyWZasiegu / k : null,
      adresyWZasiegu,
      konkurenci: k,
      najblizszyKonkurent: najblizszy >= 0 ? indeks.nazwy[najblizszy] || null : null,
      skala: 0,
    })
  }
  const prog = progSkaliPlam(surowe)
  for (const p of surowe) p.skala = skalaPlamy(p, prog)
  return surowe
}

/** Heks bez żadnego punktu branży w zasięgu – osobna kategoria, nie „heks z jednym punktem”. */
export const bezPunktu = (p: Pick<BialaPlama, 'konkurenci'>) => p.konkurenci === 0

/** Wartość, przy której kolor mapy osiąga 100; wyższe wartości są nasycone. */
export function progNasycenia(wartosci: readonly number[]): number {
  const posortowane = [...wartosci].sort((a, b) => a - b)
  return posortowane[Math.floor(posortowane.length * 0.95)] || 1
}

/**
 * Próg nasycenia skali białych plam: 95. percentyl adresów na punkt, liczony wyłącznie po
 * heksach, które mają jakikolwiek punkt. Heksy bez punktu nie mają tej liczby, więc nie mogą
 * jej zawyżać – inaczej górny koniec legendy pokazywałby „adresy na punkt”, których nie ma.
 */
export function progSkaliPlam(plamy: readonly Pick<BialaPlama, 'adresyNaPunkt'>[]): number {
  const wartosci: number[] = []
  for (const p of plamy) if (p.adresyNaPunkt !== null) wartosci.push(p.adresyNaPunkt)
  return progNasycenia(wartosci)
}

/**
 * Kolor heksu 0–100. Heks z punktami: adresy na punkt względem progu nasycenia. Heks bez punktu
 * nie ma ilorazu, więc idzie wg liczby adresów w zasięgu, jak dla JEDNEGO punktu (dolne
 * ograniczenie: faktyczna luka jest co najmniej tak duża).
 */
export function skalaPlamy(
  p: Pick<BialaPlama, 'adresyNaPunkt' | 'adresyWZasiegu'>,
  prog: number,
): number {
  const wartosc = p.adresyNaPunkt ?? p.adresyWZasiegu
  return Math.min(100, (100 * wartosc) / prog)
}

export function obliczBialePlamy(
  dane: readonly KomorkaPopytu[],
  uslugi: readonly PunktUslugi[],
  promien: number,
): BialaPlama[] {
  return bialePlamyZIndeksu(zbudujIndeks(przygotujKomorki(dane), uslugi, promien))
}

// ── Pomocnicze (zgodność wstecz i testy niezmienników) ───────────────────────────────────

/** Przydział popytu każdego istniejącego punktu, w kolejności `uslugi`. */
export function obliczBazowePunkty(
  dane: readonly KomorkaPopytu[],
  uslugi: readonly PunktUslugi[],
  promien: number,
): number[] {
  return Array.from(zbudujIndeks(przygotujKomorki(dane), uslugi, promien).przydzialPopytu)
}

/** Suma przydziałów i nieobsłużonych adresów równa się liczbie adresów wejściowych. */
export function bilansPopytu(
  dane: readonly KomorkaPopytu[],
  uslugi: readonly PunktUslugi[],
  promien: number,
) {
  const indeks = zbudujIndeks(przygotujKomorki(dane), uslugi, promien)
  let przydzielone = 0
  for (const a of indeks.przydzialAdresow) przydzielone += a
  return { przydzielone, nieobsluzone: indeks.nieobsluzoneAdresy }
}

// ── Pozycja i czynniki słowami (#107) ────────────────────────────────────────────────────

/**
 * Progi słownej oceny pozycji w rozkładzie: kwintyle, czyli pasma po 20 punktów percentyla.
 * Pasmo „umiarkowana” to wyłącznie środek rozkładu (40–59); percentyl 0 jest „bardzo niską”.
 */
export const PROGI_POZYCJI = { bardzoWysoka: 80, wysoka: 60, umiarkowana: 40, niska: 20 } as const

export type Pozycja = 'bardzo-wysoka' | 'wysoka' | 'umiarkowana' | 'niska' | 'bardzo-niska'

export function pozycjaPercentyla(percentyl: number): Pozycja {
  if (percentyl >= PROGI_POZYCJI.bardzoWysoka) return 'bardzo-wysoka'
  if (percentyl >= PROGI_POZYCJI.wysoka) return 'wysoka'
  if (percentyl >= PROGI_POZYCJI.umiarkowana) return 'umiarkowana'
  if (percentyl >= PROGI_POZYCJI.niska) return 'niska'
  return 'bardzo-niska'
}

/**
 * Progi czynników „za i przeciw”. Liczby z rozkładu na 3000 losowych heksach Krakowa (sklep,
 * 2026-10-04), żeby słowa „dużo” i „mało” znaczyły coś w skali tego miasta:
 * - udział miejsca w adresach zasięgu: mediana 46%, dolny decyl 8%;
 * - kursy w porannym szczycie (średnia po adresach zasięgu): dolny kwartyl 1,0, górny 4,4;
 * - odległość najbliższego konkurenta liczona w częściach zasięgu branży, bo zasięg to 800–1200 m.
 */
export const PROGI_CZYNNIKOW = {
  udzialDuzy: 50,
  udzialMaly: 10,
  kursyDuzo: 5,
  kursyMalo: 1,
  konkurentBlisko: 0.15,
  konkurentDaleko: 0.6,
} as const

export interface CzynnikOceny {
  kierunek: 'za' | 'przeciw' | 'neutralny'
  tekst: string
}

const liczbaCzynnika = new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 1 })

/** Odmiana po liczebniku: 1 adres, 2 adresy, 5 adresów, 22 adresy, 112 adresów. */
export function odmiana(n: number, jeden: string, kilka: string, wiele: string): string {
  if (n === 1) return jeden
  const j = n % 10
  const d = n % 100
  return j >= 2 && j <= 4 && (d < 12 || d > 14) ? kilka : wiele
}

interface Kandydat extends CzynnikOceny {
  /** 0–1: jak daleko od środka skali; steruje wyborem, gdy czynników jest więcej niż trzy. */
  moc: number
  /** Czynnik bez wyraźnego znaku: trafia do wyniku tylko po to, by były co najmniej dwa. */
  wypelniacz: boolean
}

function czynnikPozycji(o: OcenaMiejsca): Kandydat {
  if (o.percentyl === null) {
    return o.adresyWZasiegu === 0
      ? {
          kierunek: 'przeciw',
          tekst:
            'W zasięgu nie ma żadnego adresu z danych o popycie, więc miejsca nie da się ocenić.',
          moc: 1,
          wypelniacz: false,
        }
      : {
          kierunek: 'neutralny',
          tekst:
            'Brak istniejących punktów tej branży z popytem w zasięgu, nie ma z czym porównać.',
          moc: 0,
          wypelniacz: true,
        }
  }
  const moc = Math.abs(o.percentyl - 50) / 50
  switch (pozycjaPercentyla(o.percentyl)) {
    case 'bardzo-wysoka':
      return {
        kierunek: 'za',
        tekst:
          o.percentyl === 100
            ? 'Przydział klientów wyższy niż przy każdym istniejącym punkcie tej branży.'
            : 'Przydział klientów należy do najwyższych wśród istniejących punktów tej branży.',
        moc,
        wypelniacz: false,
      }
    case 'wysoka':
      return {
        kierunek: 'za',
        tekst: 'Przydział klientów wyższy niż przy większości istniejących punktów tej branży.',
        moc,
        wypelniacz: false,
      }
    case 'umiarkowana':
      return {
        kierunek: 'neutralny',
        tekst: 'Przydział klientów zbliżony do typowego dla istniejących punktów tej branży.',
        moc,
        wypelniacz: true,
      }
    case 'niska':
      return {
        kierunek: 'przeciw',
        tekst: 'Przydział klientów niższy niż przy większości istniejących punktów tej branży.',
        moc,
        wypelniacz: false,
      }
    default:
      return {
        kierunek: 'przeciw',
        tekst:
          o.percentyl === 0
            ? 'Przydział klientów niższy niż przy każdym istniejącym punkcie tej branży.'
            : 'Przydział klientów należy do najniższych wśród istniejących punktów tej branży.',
        moc,
        wypelniacz: false,
      }
  }
}

function czynnikKonkurencji(o: OcenaMiejsca, zasiegM: number): Kandydat {
  if (o.konkurenci === 0)
    return {
      kierunek: 'za',
      tekst: `Brak konkurencji: żaden punkt tej branży nie leży w promieniu ${zasiegM} m.`,
      moc: 1,
      wypelniacz: false,
    }
  const moc = Math.min(1, Math.abs(o.udzialProcent - 30) / 70)
  const konkurenci = o.konkurenci === 1 ? '1 konkurentem' : `${o.konkurenci} konkurentami`
  if (o.udzialProcent >= PROGI_CZYNNIKOW.udzialDuzy)
    return {
      kierunek: 'za',
      tekst: `Miejsce przejmuje około ${o.udzialProcent}% adresów w zasięgu, dzieląc je z ${konkurenci}.`,
      moc,
      wypelniacz: false,
    }
  if (o.udzialProcent <= PROGI_CZYNNIKOW.udzialMaly)
    return {
      kierunek: 'przeciw',
      tekst: `Miejsce przejmuje tylko około ${o.udzialProcent}% adresów w zasięgu, dzieląc je z ${konkurenci}.`,
      moc,
      wypelniacz: false,
    }
  return {
    kierunek: 'neutralny',
    tekst: `Miejsce przejmuje około ${o.udzialProcent}% adresów w zasięgu, dzieląc je z ${konkurenci}.`,
    moc,
    wypelniacz: true,
  }
}

function czynnikOdleglosci(o: OcenaMiejsca, zasiegM: number): Kandydat | null {
  if (o.odlegloscKonkurenta === null || zasiegM <= 0) return null
  const czesc = o.odlegloscKonkurenta / zasiegM
  const nazwa = o.najblizszyKonkurent ?? 'punkt bez nazwy'
  if (czesc <= PROGI_CZYNNIKOW.konkurentBlisko)
    return {
      kierunek: 'przeciw',
      tekst: `Konkurent tuż obok: ${nazwa}, ${o.odlegloscKonkurenta} m.`,
      moc: Math.min(1, (PROGI_CZYNNIKOW.konkurentBlisko - czesc) / PROGI_CZYNNIKOW.konkurentBlisko),
      wypelniacz: false,
    }
  if (czesc >= PROGI_CZYNNIKOW.konkurentDaleko)
    return {
      kierunek: 'za',
      tekst: `Najbliższy konkurent (${nazwa}) dopiero ${o.odlegloscKonkurenta} m stąd.`,
      moc: Math.min(
        1,
        (czesc - PROGI_CZYNNIKOW.konkurentDaleko) / (1 - PROGI_CZYNNIKOW.konkurentDaleko),
      ),
      wypelniacz: false,
    }
  return null
}

/** „23,2 kursu” (ułamek wymaga dopełniacza liczby pojedynczej), ale „5 kursów”, „2 kursy”. */
export function kursyZeSlowem(srednia: number): string {
  const zaokraglone = Math.round(srednia * 10) / 10
  if (Number.isInteger(zaokraglone))
    return `${zaokraglone} ${odmiana(zaokraglone, 'kurs', 'kursy', 'kursów')}`
  return `${liczbaCzynnika.format(zaokraglone)} kursu`
}

function czynnikKomunikacji(o: OcenaMiejsca): Kandydat | null {
  if (o.adresyWZasiegu === 0) return null
  const kursy = kursyZeSlowem(o.kursySzczytSrednio)
  if (o.kursySzczytSrednio >= PROGI_CZYNNIKOW.kursyDuzo)
    return {
      kierunek: 'za',
      tekst: `Dobry dojazd komunikacją: średnio ${kursy} w porannym szczycie.`,
      moc: Math.min(1, (o.kursySzczytSrednio - PROGI_CZYNNIKOW.kursyDuzo) / 10),
      wypelniacz: false,
    }
  if (o.kursySzczytSrednio < PROGI_CZYNNIKOW.kursyMalo)
    return {
      kierunek: 'przeciw',
      tekst: `Słaby dojazd komunikacją: średnio ${kursy} w porannym szczycie.`,
      moc: Math.min(1, PROGI_CZYNNIKOW.kursyMalo - o.kursySzczytSrednio),
      wypelniacz: false,
    }
  return null
}

/**
 * 2–3 czynniki „za i przeciw” słowami. Najpierw te, które przekraczają progi
 * (`PROGI_POZYCJI`, `PROGI_CZYNNIKOW`), od najmocniejszego; gdy jest ich mniej niż dwa,
 * uzupełnia neutralnymi opisami pozycji i konkurencji.
 */
export function czynnikiOceny(ocena: OcenaMiejsca, zasiegM: number): CzynnikOceny[] {
  const wszystkie = [
    czynnikPozycji(ocena),
    czynnikKonkurencji(ocena, zasiegM),
    czynnikOdleglosci(ocena, zasiegM),
    czynnikKomunikacji(ocena),
  ].filter((k): k is Kandydat => k !== null)
  const wyrazne = wszystkie.filter((k) => !k.wypelniacz).sort((a, b) => b.moc - a.moc)
  const wypelniacze = wszystkie.filter((k) => k.wypelniacz)
  const wybrane = [...wyrazne, ...wypelniacze].slice(0, Math.max(2, Math.min(3, wyrazne.length)))
  return wybrane.map(({ kierunek, tekst }) => ({ kierunek, tekst }))
}

// ── Udziały na karcie (#107) ─────────────────────────────────────────────────────────────

export interface RozbicieZasiegu {
  adresyWZasiegu: number
  /** Adresy z zasięgu, które model przydziela temu miejscu (całkowite). */
  toMiejsce: number
  /** Reszta: adresy przypadające istniejącym punktom. `toMiejsce + konkurenci = adresyWZasiegu`. */
  konkurenci: number
  procentToMiejsce: number
  /** Dopełnienie do 100, więc oba procenty na karcie zawsze dają 100 (albo 0 przy braku adresów). */
  procentKonkurenci: number
}

/**
 * Udziały popytu pokazane na karcie. Każdy adres z zasięgu jest dzielony między nowe miejsce
 * i istniejące punkty, więc oba udziały muszą się domykać do liczby adresów w zasięgu
 * (inwariant sprawdza test). Liczby całkowite, żeby suma na ekranie zgadzała się co do sztuki.
 */
export function rozbicieZasiegu(ocena: OcenaMiejsca): RozbicieZasiegu {
  const wZasiegu = Math.round(ocena.adresyWZasiegu)
  const toMiejsce = Math.min(wZasiegu, Math.max(0, Math.round(ocena.przydzieloneAdresy)))
  const procent = wZasiegu > 0 ? Math.round((100 * toMiejsce) / wZasiegu) : 0
  return {
    adresyWZasiegu: wZasiegu,
    toMiejsce,
    konkurenci: wZasiegu - toMiejsce,
    procentToMiejsce: procent,
    procentKonkurenci: wZasiegu > 0 ? 100 - procent : 0,
  }
}
