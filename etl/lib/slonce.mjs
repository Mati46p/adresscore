// Godziny słońca 21 grudnia przed fasadą adresu (zadanie #122): czyste funkcje, bez zależności.
// Skrypt: etl/slonce.mjs (+ etl/slonce-worker.mjs), test: node --test etl/slonce.test.mjs.
//
// Model:
//  1. Układ lokalny w metrach, oś y = północ, więc azymut słońca idzie wprost do promienia.
//  2. Punkt obserwacji: 1 m przed fasadą najbliższą punktowi adresowemu, na wysokości okna
//     najwyższej kondygnacji, ale nie wyżej niż 6 m.
//  3. Słońce 21 grudnia (wzór NOAA), próbki równo w czasie od wschodu do zachodu.
//  4. Promień od punktu w stronę słońca wznosi się o tg(wysokości) na metr. Zasłania go każda
//     krawędź obrysu, którą promień przetnie niżej niż dach budynku (bryła LoD1 = pryzma).
//  5. Słońce za płaszczyzną fasady (kąt do normalnej > 90°) nie świeci na okno.
// Bez drzew i terenu (poziom gruntu wszędzie ten sam) – ograniczenia opisuje meta wskaźnika.

const RAD = Math.PI / 180
const DEG = 180 / Math.PI
const DOBA_MS = 86_400_000

/** Wysokość punktu obserwacji nad gruntem: okno ok. 2. piętra (założenie z zadania, nie pomiar). */
export const Z_OKNA = 6
/** Najniższy punkt obserwacji (parter), gdy budynek jest niższy niż Z_PARTER + POD_DACHEM. */
export const Z_PARTER = 1.5
/** LoD1 daje wysokość dachu (mediana ALS); okno najwyższej kondygnacji jest o tyle niżej. */
export const POD_DACHEM = 2
/** Odsunięcie punktu obserwacji od fasady (m). */
export const ODSUNIECIE = 1
/**
 * Dalej niż tyle nie szukamy zasłon (m). 300 m z opisu zadania ucinało długie cienie przy niskim
 * słońcu: na próbie 3000 adresów wobec zasięgu 3000 m wynik był zawyżony średnio o 1,5 min,
 * a w skrajnym przypadku o godzinę. Zasięg 1000 m daje średnio 0,2 min i najwyżej 12 min różnicy,
 * a koszt jest ten sam co przy 300 m (ułamek sekundy na 3000 adresów).
 */
export const D_MAX = 1000
/** Dalej niż tyle od punktu adresowego do krawędzi obrysu adres nie ma „swojej” fasady (m). */
export const MAX_ODL_FASADY = 6

// ---------------------------------------------------------------------------------------------
// Układ lokalny

export const SRODEK = Object.freeze({ lon: 19.94, lat: 50.06 })

/** Metry na stopień szerokości i długości na szerokości lat (WGS84, szeregi trygonometryczne). */
export function metryNaStopien(lat) {
  const f = lat * RAD
  return {
    lat: 111132.92 - 559.82 * Math.cos(2 * f) + 1.175 * Math.cos(4 * f) - 0.0023 * Math.cos(6 * f),
    lon: 111412.84 * Math.cos(f) - 93.5 * Math.cos(3 * f) + 0.118 * Math.cos(5 * f),
  }
}

const M_NA_STOPIEN = metryNaStopien(SRODEK.lat)

/**
 * WGS84 → metry względem środka Krakowa (x = wschód, y = północ). Jedna skala na całe miasto:
 * odległości odbiegają od geodezyjnych o najwyżej 0,2% na przekątnej miasta (test z elipsoidą),
 * czyli kierunek promienia o ułamek stopnia.
 */
export function naMetry(lon, lat) {
  return [(lon - SRODEK.lon) * M_NA_STOPIEN.lon, (lat - SRODEK.lat) * M_NA_STOPIEN.lat]
}

// ---------------------------------------------------------------------------------------------
// Słońce

/**
 * Położenie słońca wzorem NOAA (General Solar Position Calculations, uproszczony SPA):
 * wysokość geometryczna i azymut (od północy, zgodnie z ruchem wskazówek zegara), w stopniach.
 * Błąd rzędu 0,01° – dużo poniżej błędu modelu miasta.
 */
export function polozenieSlonca(czasMs, lat, lon) {
  const jd = czasMs / DOBA_MS + 2440587.5
  const t = (jd - 2451545) / 36525
  const l0 = (280.46646 + t * (36000.76983 + t * 0.0003032)) % 360
  const m = 357.52911 + t * (35999.05029 - 0.0001537 * t)
  const ekscentr = 0.016708634 - t * (0.000042037 + 0.0000001267 * t)
  const mr = m * RAD
  const srodek =
    Math.sin(mr) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
    Math.sin(2 * mr) * (0.019993 - 0.000101 * t) +
    Math.sin(3 * mr) * 0.000289
  const omega = (125.04 - 1934.136 * t) * RAD
  const lambda = (l0 + srodek - 0.00569 - 0.00478 * Math.sin(omega)) * RAD
  const ukosnik =
    (23 +
      (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60 +
      0.00256 * Math.cos(omega)) *
    RAD
  const deklinacja = Math.asin(Math.sin(ukosnik) * Math.sin(lambda))
  const y = Math.tan(ukosnik / 2) ** 2
  const l0r = l0 * RAD
  // równanie czasu w minutach
  const rownanieCzasu =
    4 *
    DEG *
    (y * Math.sin(2 * l0r) -
      2 * ekscentr * Math.sin(mr) +
      4 * ekscentr * y * Math.sin(mr) * Math.cos(2 * l0r) -
      0.5 * y * y * Math.sin(4 * l0r) -
      1.25 * ekscentr * ekscentr * Math.sin(2 * mr))
  const minutaUtc = (((czasMs / 60_000) % 1440) + 1440) % 1440
  const czasSloneczny = (((minutaUtc + rownanieCzasu + 4 * lon) % 1440) + 1440) % 1440
  const kat = (czasSloneczny / 4 - 180) * RAD // kąt godzinny, 0 = południe słoneczne
  const fi = lat * RAD
  const sinWys =
    Math.sin(fi) * Math.sin(deklinacja) + Math.cos(fi) * Math.cos(deklinacja) * Math.cos(kat)
  const wysokosc = Math.asin(Math.max(-1, Math.min(1, sinWys))) * DEG
  // azymut liczony od południa (na zachód +), potem przesunięty o 180° do układu od północy
  const odPoludnia = Math.atan2(
    Math.sin(kat),
    Math.cos(kat) * Math.sin(fi) - Math.tan(deklinacja) * Math.cos(fi),
  )
  const azymut = (((odPoludnia * DEG + 180) % 360) + 360) % 360
  return { wysokosc, azymut }
}

/**
 * Wysokość górnego brzegu tarczy nad horyzontem (stopnie): wysokość geometryczna środka
 * + refrakcja (Sæmundsson, ciśnienie 1010 hPa, 10 °C) + promień tarczy (16′). Dodatnia = jest
 * choć skrawek słońca. Wschód i zachód wychodzą wtedy w granicach pół minuty od tablic
 * (USNO liczy stałe 34′ + 16′; refrakcja zmienna z wysokością jest dokładniejsza wyżej).
 */
export function wysokoscEfektywna(wysokosc) {
  // Wzór Sæmundssona ma biegun przy −5,11°; poniżej −1,5° słońce i tak jest pod horyzontem
  // (wysokość efektywna ok. −0,5° i mniej), więc nie ma sensu go tam stosować.
  if (wysokosc < -1.5) return wysokosc
  const refrakcja = 1.02 / Math.tan((wysokosc + 10.3 / (wysokosc + 5.11)) * RAD) / 60
  return wysokosc + refrakcja + 16 / 60
}

/**
 * Próbki słońca w ciągu dnia: chwile równo rozłożone w czasie między wschodem a zachodem
 * (środki równych przedziałów, krok ok. `krokMin` minut), więc suma wag = dokładna długość dnia.
 * Dla każdej: azymut, sin/cos azymutu (wektor poziomy: x = wschód, y = północ) i tg wysokości
 * efektywnej (patrz wysokoscEfektywna).
 */
export function probkiSlonca({ lat, lon, rok = 2026, miesiac = 12, dzien = 21, krokMin = 1 }) {
  const doba = Date.UTC(rok, miesiac - 1, dzien)
  const wys = (t) => wysokoscEfektywna(polozenieSlonca(t, lat, lon).wysokosc)
  const przeciecie = (od, doo) => {
    // bisekcja: wys(od) i wys(doo) po różnych stronach zera
    let a = od
    let b = doo
    const wA = wys(a) > 0
    for (let i = 0; i < 40; i++) {
      const c = (a + b) / 2
      if (wys(c) > 0 === wA) a = c
      else b = c
    }
    return (a + b) / 2
  }
  const wschody = []
  const zachody = []
  let poprzednia = wys(doba)
  for (let m = 1; m <= 1440; m++) {
    const t = doba + m * 60_000
    const teraz = wys(t)
    if (poprzednia <= 0 && teraz > 0) wschody.push(przeciecie(t - 60_000, t))
    if (poprzednia > 0 && teraz <= 0) zachody.push(przeciecie(t - 60_000, t))
    poprzednia = teraz
  }
  if (wschody.length !== 1 || zachody.length !== 1)
    throw new Error(
      `Oczekiwano jednego wschodu i zachodu, jest ${wschody.length} i ${zachody.length}`,
    )
  const [wschod] = wschody
  const [zachod] = zachody
  if (zachod <= wschod) throw new Error('Zachód przed wschodem (doba UTC przecina dzień)')
  const dlugoscMs = zachod - wschod
  const n = Math.max(1, Math.round(dlugoscMs / (krokMin * 60_000)))
  const az = new Float64Array(n)
  const sinAz = new Float64Array(n)
  const cosAz = new Float64Array(n)
  const tg = new Float64Array(n)
  const wysokosci = new Float64Array(n)
  for (let k = 0; k < n; k++) {
    const t = wschod + ((k + 0.5) * dlugoscMs) / n
    const p = polozenieSlonca(t, lat, lon)
    az[k] = p.azymut
    sinAz[k] = Math.sin(p.azymut * RAD)
    cosAz[k] = Math.cos(p.azymut * RAD)
    wysokosci[k] = wysokoscEfektywna(p.wysokosc)
    tg[k] = Math.tan(wysokosci[k] * RAD)
  }
  return {
    n,
    wschodMs: wschod,
    zachodMs: zachod,
    dlugoscH: dlugoscMs / 3_600_000,
    wagaH: dlugoscMs / 3_600_000 / n,
    az,
    sinAz,
    cosAz,
    tg,
    wysokosci,
  }
}

// ---------------------------------------------------------------------------------------------
// Scena: krawędzie obrysów w siatce komórek

/** Obiekty GeoJSON (Polygon / MultiPolygon, WGS84, `height_m`) → budynki w metrach. */
export function budynkiZGeoJson(obiekty) {
  const budynki = []
  for (const f of obiekty) {
    const h = f.properties?.height_m
    if (!Number.isFinite(h) || h <= 0) continue
    const wielokaty =
      f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates : [f.geometry.coordinates]
    for (const wielokat of wielokaty)
      budynki.push({
        h,
        pierscienie: wielokat.map((p) => p.map(([lon, lat]) => naMetry(lon, lat))),
      })
  }
  return budynki
}

function poleZeZnakiem(pierscien, n) {
  let s = 0
  for (let i = 0; i < n; i++) {
    const a = pierscien[i]
    const b = pierscien[(i + 1) % n]
    s += a[0] * b[1] - b[0] * a[1]
  }
  return s / 2
}

/** Czy odcinek AB ma wspólny punkt z prostokątem (Liang–Barsky). */
function odcinekWProstokacie(ax, ay, bx, by, x0, y0, x1, y1) {
  let t0 = 0
  let t1 = 1
  const dx = bx - ax
  const dy = by - ay
  const p = [-dx, dx, -dy, dy]
  const q = [ax - x0, x1 - ax, ay - y0, y1 - ay]
  for (let i = 0; i < 4; i++) {
    const pi = p[i]
    const qi = q[i]
    if (pi === 0) {
      if (qi < 0) return false
    } else {
      const r = qi / pi
      if (pi < 0) {
        if (r > t1) return false
        if (r > t0) t0 = r
      } else {
        if (r < t0) return false
        if (r < t1) t1 = r
      }
    }
  }
  return true
}

/**
 * Buduje scenę z budynków w metrach: `{ h, pierscienie: [[ [x, y], ... ], ...] }`
 * (pierwszy pierścień zewnętrzny, reszta otwory). Orientację normalizujemy: zewnętrzny
 * przeciwnie do ruchu wskazówek zegara, otwory zgodnie, więc PRAWA strona krawędzi A→B
 * jest zawsze „na zewnątrz bryły".
 *
 * Krawędzie: `kraw[4e..4e+3]` = Ax, Ay, wektor AB; `wys[e]` = wysokość budynku. Siatka komórek
 * w formacie CSR: krawędzie komórki c to `lista[start[c] .. start[c+1])`, `maxH[c]` = najwyższy
 * budynek, którego krawędź dotyka komórki.
 */
export function zbudujScene(budynki, { komorka = 25 } = {}) {
  let gornaGranica = 0
  for (const b of budynki) for (const p of b.pierscienie) gornaGranica += p.length
  const kraw = new Float64Array(4 * gornaGranica)
  const wys = new Float32Array(gornaGranica)
  let liczba = 0
  let hMax = 0
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const b of budynki) {
    b.pierscienie.forEach((p, r) => {
      let n = p.length
      if (n > 1 && p[0][0] === p[n - 1][0] && p[0][1] === p[n - 1][1]) n--
      if (n < 3) return
      const odwroc = poleZeZnakiem(p, n) > 0 !== (r === 0)
      const v = (j) => (odwroc ? p[n - 1 - j] : p[j])
      for (let i = 0; i < n; i++) {
        const a = v(i)
        const c = v((i + 1) % n)
        const ex = c[0] - a[0]
        const ey = c[1] - a[1]
        if (ex * ex + ey * ey < 1e-12) continue
        kraw[4 * liczba] = a[0]
        kraw[4 * liczba + 1] = a[1]
        kraw[4 * liczba + 2] = ex
        kraw[4 * liczba + 3] = ey
        wys[liczba] = b.h
        liczba++
        minX = Math.min(minX, a[0], c[0])
        maxX = Math.max(maxX, a[0], c[0])
        minY = Math.min(minY, a[1], c[1])
        maxY = Math.max(maxY, a[1], c[1])
      }
    })
    hMax = Math.max(hMax, b.h)
  }
  if (liczba === 0) throw new Error('Scena bez krawędzi')

  const gx0 = Math.floor(minX / komorka) * komorka - komorka
  const gy0 = Math.floor(minY / komorka) * komorka - komorka
  const nx = Math.ceil((maxX - gx0) / komorka) + 2
  const ny = Math.ceil((maxY - gy0) / komorka) + 2
  const zakresKomorek = (e) => {
    const ax = kraw[4 * e]
    const ay = kraw[4 * e + 1]
    const bx = ax + kraw[4 * e + 2]
    const by = ay + kraw[4 * e + 3]
    return [
      Math.max(0, Math.floor((Math.min(ax, bx) - 1e-6 - gx0) / komorka)),
      Math.min(nx - 1, Math.floor((Math.max(ax, bx) + 1e-6 - gx0) / komorka)),
      Math.max(0, Math.floor((Math.min(ay, by) - 1e-6 - gy0) / komorka)),
      Math.min(ny - 1, Math.floor((Math.max(ay, by) + 1e-6 - gy0) / komorka)),
    ]
  }
  const dotyka = (e, i0, i1, j0, j1, i, j) => {
    if (i0 === i1 && j0 === j1) return true
    const ax = kraw[4 * e]
    const ay = kraw[4 * e + 1]
    return odcinekWProstokacie(
      ax,
      ay,
      ax + kraw[4 * e + 2],
      ay + kraw[4 * e + 3],
      gx0 + i * komorka - 1e-6,
      gy0 + j * komorka - 1e-6,
      gx0 + (i + 1) * komorka + 1e-6,
      gy0 + (j + 1) * komorka + 1e-6,
    )
  }
  const start = new Int32Array(nx * ny + 1)
  for (let e = 0; e < liczba; e++) {
    const [i0, i1, j0, j1] = zakresKomorek(e)
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) if (dotyka(e, i0, i1, j0, j1, i, j)) start[j * nx + i + 1]++
  }
  for (let c = 0; c < nx * ny; c++) start[c + 1] += start[c]
  const lista = new Int32Array(start[nx * ny])
  const wypelnienie = new Int32Array(nx * ny)
  const maxH = new Float32Array(nx * ny)
  for (let e = 0; e < liczba; e++) {
    const [i0, i1, j0, j1] = zakresKomorek(e)
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++)
        if (dotyka(e, i0, i1, j0, j1, i, j)) {
          const c = j * nx + i
          lista[start[c] + wypelnienie[c]++] = e
          if (wys[e] > maxH[c]) maxH[c] = wys[e]
        }
  }
  return {
    liczbaKrawedzi: liczba,
    kraw: kraw.slice(0, 4 * liczba),
    wys: wys.slice(0, liczba),
    nx,
    ny,
    kom: komorka,
    gx0,
    gy0,
    start,
    lista,
    maxH,
    hMax,
  }
}

const naWspolnym = (tablica) => {
  const w = new tablica.constructor(new SharedArrayBuffer(tablica.byteLength))
  w.set(tablica)
  return w
}

/** Kopia sceny na SharedArrayBuffer: workery czytają te same bajty, bez kopiowania. */
export function udostepnijScene(scena) {
  const wynik = { ...scena }
  for (const [k, v] of Object.entries(scena)) if (ArrayBuffer.isView(v)) wynik[k] = naWspolnym(v)
  return wynik
}

// ---------------------------------------------------------------------------------------------
// Promień słoneczny

/**
 * Czy promień z (px, py) na wysokości z0, w poziomym kierunku (ux, uy) (wektor jednostkowy),
 * wznoszący się o tg na metr, jest zasłonięty? Zasłania go krawędź obrysu, którą promień
 * przetnie w odległości d ≤ min(dMax, ...) niżej niż jej dach: z0 + d·tg < wysokość.
 * Ponieważ promień tylko się wznosi, wystarczy przecięcie z krawędzią – wejście do bryły
 * następuje zawsze przez krawędź obrysu, a punkt startu leży poza bryłami.
 * Przechodzimy przez komórki siatki (Amanatides–Woo) i pomijamy te, w których żaden dach
 * nie sięga wysokości promienia przy wejściu do komórki.
 */
export function zasloniete(S, px, py, z0, ux, uy, tg, dMax) {
  const dlugosc = Math.min(dMax, (S.hMax - z0) / tg)
  if (!(dlugosc > 0)) return false
  const { nx, ny, kom, gx0, gy0, start, lista, maxH, kraw, wys } = S
  let ix = Math.floor((px - gx0) / kom)
  let iy = Math.floor((py - gy0) / kom)
  if (ix < 0 || iy < 0 || ix >= nx || iy >= ny) return false
  const sx = ux > 0 ? 1 : -1
  const sy = uy > 0 ? 1 : -1
  const dx = ux === 0 ? Number.POSITIVE_INFINITY : kom / Math.abs(ux)
  const dy = uy === 0 ? Number.POSITIVE_INFINITY : kom / Math.abs(uy)
  let tx = ux === 0 ? Number.POSITIVE_INFINITY : (gx0 + (ux > 0 ? ix + 1 : ix) * kom - px) / ux
  let ty = uy === 0 ? Number.POSITIVE_INFINITY : (gy0 + (uy > 0 ? iy + 1 : iy) * kom - py) / uy
  let t0 = 0
  for (;;) {
    const c = iy * nx + ix
    const prog = z0 + t0 * tg
    if (maxH[c] > prog) {
      const koniec = start[c + 1]
      for (let k = start[c]; k < koniec; k++) {
        const e = lista[k]
        const h = wys[e]
        if (h <= prog) continue
        const o = 4 * e
        const sxe = kraw[o + 2]
        const sye = kraw[o + 3]
        const mian = ux * sye - uy * sxe
        if (mian === 0) continue
        const wx = kraw[o] - px
        const wy = kraw[o + 1] - py
        const t = (wx * uy - wy * ux) / mian
        if (t < 0 || t >= 1) continue
        const d = (wx * sye - wy * sxe) / mian
        if (d <= 1e-9 || d > dlugosc) continue
        if (z0 + d * tg < h) return true
      }
    }
    if (tx < ty) {
      t0 = tx
      if (t0 > dlugosc) return false
      tx += dx
      ix += sx
      if (ix < 0 || ix >= nx) return false
    } else {
      t0 = ty
      if (t0 > dlugosc) return false
      ty += dy
      iy += sy
      if (iy < 0 || iy >= ny) return false
    }
  }
}

/** To samo bez siatki: wszystkie krawędzie po kolei (wzorzec do testów). */
export function zaslonieteBezSiatki(S, px, py, z0, ux, uy, tg, dMax) {
  const { kraw, wys, liczbaKrawedzi } = S
  for (let e = 0; e < liczbaKrawedzi; e++) {
    const o = 4 * e
    const sxe = kraw[o + 2]
    const sye = kraw[o + 3]
    const mian = ux * sye - uy * sxe
    if (mian === 0) continue
    const wx = kraw[o] - px
    const wy = kraw[o + 1] - py
    const t = (wx * uy - wy * ux) / mian
    if (t < 0 || t >= 1) continue
    const d = (wx * sye - wy * sxe) / mian
    if (d <= 1e-9 || d > dMax) continue
    if (z0 + d * tg < wys[e]) return true
  }
  return false
}

// ---------------------------------------------------------------------------------------------
// Fasada adresu

const K_KANDYDATOW = 8
const kandydatKrawedz = new Int32Array(K_KANDYDATOW)
const kandydatOdleglosc = new Float64Array(K_KANDYDATOW) // kwadrat odległości
const kandydatKlucz = new Float64Array(K_KANDYDATOW) // kolejność: odległość, przy remisie normalna do adresu

/** Czy odcinek (x1, y1)–(x2, y2) przecina którąkolwiek krawędź (poza `ignoruj`)? */
function odcinekPrzecinaKrawedz(S, x1, y1, x2, y2, ignoruj) {
  const { nx, ny, kom, gx0, gy0, start, lista, kraw } = S
  const i0 = Math.max(0, Math.floor((Math.min(x1, x2) - gx0) / kom))
  const i1 = Math.min(nx - 1, Math.floor((Math.max(x1, x2) - gx0) / kom))
  const j0 = Math.max(0, Math.floor((Math.min(y1, y2) - gy0) / kom))
  const j1 = Math.min(ny - 1, Math.floor((Math.max(y1, y2) - gy0) / kom))
  const rx = x2 - x1
  const ry = y2 - y1
  for (let j = j0; j <= j1; j++)
    for (let i = i0; i <= i1; i++) {
      const c = j * nx + i
      for (let k = start[c]; k < start[c + 1]; k++) {
        const e = lista[k]
        if (e === ignoruj) continue
        const sxe = kraw[4 * e + 2]
        const sye = kraw[4 * e + 3]
        const mian = rx * sye - ry * sxe
        if (mian === 0) continue
        const wx = kraw[4 * e] - x1
        const wy = kraw[4 * e + 1] - y1
        const d = (wx * sye - wy * sxe) / mian
        const t = (wx * ry - wy * rx) / mian
        if (d >= 0 && d <= 1 && t >= 0 && t <= 1) return true
      }
    }
  return false
}

/**
 * Fasada „adresu": krawędź obrysu najbliższa punktowi adresowemu (x, y). Zwraca punkt
 * obserwacji (px, py) = odsunięcie m od najbliższego punktu krawędzi wzdłuż normalnej
 * na zewnątrz oraz tę normalną (nx, ny). Jeśli punkt wypadłby w innej bryle (np. we wnęce
 * L-ki), bierze kolejną najbliższą krawędź. Brak krawędzi bliżej niż maxOdl = null.
 */
export function znajdzFasade(S, x, y, { maxOdl = MAX_ODL_FASADY, odsuniecie = ODSUNIECIE } = {}) {
  const { nx, ny, kom, gx0, gy0, start, lista, kraw } = S
  const ic = Math.floor((x - gx0) / kom)
  const jc = Math.floor((y - gy0) / kom)
  if (ic < 0 || jc < 0 || ic >= nx || jc >= ny) return null
  const max2 = maxOdl * maxOdl
  let liczba = 0
  for (let j = Math.max(0, jc - 1); j <= Math.min(ny - 1, jc + 1); j++)
    for (let i = Math.max(0, ic - 1); i <= Math.min(nx - 1, ic + 1); i++) {
      const c = j * nx + i
      for (let k = start[c]; k < start[c + 1]; k++) {
        const e = lista[k]
        const ax = kraw[4 * e]
        const ay = kraw[4 * e + 1]
        const ex = kraw[4 * e + 2]
        const ey = kraw[4 * e + 3]
        const dl2 = ex * ex + ey * ey
        const s = Math.max(0, Math.min(1, ((x - ax) * ex + (y - ay) * ey) / dl2))
        const dx = x - (ax + s * ex)
        const dy = y - (ay + s * ey)
        const d2 = dx * dx + dy * dy
        if (d2 > max2) continue
        let jest = false
        for (let m = 0; m < liczba; m++)
          if (kandydatKrawedz[m] === e) {
            jest = true
            break
          }
        if (jest) continue
        // Punkt w „strefie wierzchołka" ma tę samą odległość do obu ścian narożnika. Przy takim
        // remisie bierzemy ścianę, której normalna na zewnątrz jest bardziej zwrócona do adresu.
        const klucz = d2 - (1e-9 * (ey * dx - ex * dy)) / Math.sqrt(dl2)
        // wstawienie z zachowaniem rosnącego klucza
        let poz = liczba < K_KANDYDATOW ? liczba : K_KANDYDATOW - 1
        if (liczba === K_KANDYDATOW && klucz >= kandydatKlucz[poz]) continue
        while (poz > 0 && kandydatKlucz[poz - 1] > klucz) {
          kandydatKlucz[poz] = kandydatKlucz[poz - 1]
          kandydatOdleglosc[poz] = kandydatOdleglosc[poz - 1]
          kandydatKrawedz[poz] = kandydatKrawedz[poz - 1]
          poz--
        }
        kandydatKlucz[poz] = klucz
        kandydatOdleglosc[poz] = d2
        kandydatKrawedz[poz] = e
        if (liczba < K_KANDYDATOW) liczba++
      }
    }
  for (let m = 0; m < liczba; m++) {
    const e = kandydatKrawedz[m]
    const ax = kraw[4 * e]
    const ay = kraw[4 * e + 1]
    const ex = kraw[4 * e + 2]
    const ey = kraw[4 * e + 3]
    const dl = Math.hypot(ex, ey)
    const s = Math.max(0, Math.min(1, ((x - ax) * ex + (y - ay) * ey) / (dl * dl)))
    const fx = ax + s * ex
    const fy = ay + s * ey
    const nxn = ey / dl // prawa strona krawędzi = na zewnątrz bryły
    const nyn = -ex / dl
    const px = fx + odsuniecie * nxn
    const py = fy + odsuniecie * nyn
    // odcinek F'→P (F' o 1 cm od fasady) nie może przecinać żadnej innej ściany
    if (odcinekPrzecinaKrawedz(S, fx + 0.01 * nxn, fy + 0.01 * nyn, px, py, e)) continue
    return { px, py, nx: nxn, ny: nyn, odleglosc: Math.sqrt(kandydatOdleglosc[m]), krawedz: e }
  }
  return null
}

/**
 * Wysokość punktu obserwacji dla budynku o wysokości dachu `h`: 6 m z zadania, ale nie wyżej
 * niż okno najwyższej kondygnacji (2 m pod dachem) i nie niżej niż parter. Bez tego punkt przy
 * niskim domu wypadał w powietrzu nad dachem i zawyżał wynik (dla fasad południowych
 * budynków niższych niż 6 m średnio o ok. 1,2 h).
 */
export function wysokoscOkna(h) {
  return Math.min(Z_OKNA, Math.max(Z_PARTER, h - POD_DACHEM))
}

/**
 * Godziny bezpośredniego słońca przed fasadą: próbki, w których słońce jest przed płaszczyzną
 * fasady i promień nie trafia w żaden dach. Każda próbka waży `slonce.wagaH` godzin.
 */
export function godzinySlonca(S, fasada, slonce, { z = Z_OKNA, dMax = D_MAX } = {}) {
  const { sinAz, cosAz, tg, n, wagaH } = slonce
  let swieci = 0
  for (let k = 0; k < n; k++) {
    if (fasada.nx * sinAz[k] + fasada.ny * cosAz[k] <= 0) continue
    if (!zasloniete(S, fasada.px, fasada.py, z, sinAz[k], cosAz[k], tg[k], dMax)) swieci++
  }
  return swieci * wagaH
}

const STRONY_SWIATA = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
// Etykieta idzie do pliku wskaźnika przy każdym adresie, więc jest krótka: karta składa ją
// po wartości („5,6 h – płd."), a znaczenie podaje opis wskaźnika.
const NAZWY_STRON = [
  'płn.',
  'płn.-wsch.',
  'wsch.',
  'płd.-wsch.',
  'płd.',
  'płd.-zach.',
  'zach.',
  'płn.-zach.',
]

/** Numer strony świata 0–7 (0 = północ, 2 = wschód, ...) normalnej fasady (nx, ny). */
export function numerStrony(nx, ny) {
  const az = (Math.atan2(nx, ny) * DEG + 360) % 360
  return Math.round(az / 45) % 8
}

/** Azymut normalnej fasady → „S", „NE" itd. */
export const stronaSwiata = (nx, ny) => STRONY_SWIATA[numerStrony(nx, ny)]

/** Strona świata, w którą patrzy fasada, po polsku: „płd.-zach.". */
export const etykietaFasady = (numer) => NAZWY_STRON[numer]

/**
 * Cały wskaźnik dla jednego adresu: godziny słońca przed fasadą albo null, gdy punkt adresowy
 * nie ma budynku w odległości `maxOdl`. `numerStrony` = strona świata fasady (0–7).
 */
export function obliczAdres(S, slonce, x, y, opcje = {}) {
  const fasada = znajdzFasade(S, x, y, opcje)
  if (!fasada) return null
  const z = wysokoscOkna(S.wys[fasada.krawedz])
  return {
    godziny: godzinySlonca(S, fasada, slonce, { z, dMax: opcje.dMax ?? D_MAX }),
    numerStrony: numerStrony(fasada.nx, fasada.ny),
    z,
    odleglosc: fasada.odleglosc,
  }
}
