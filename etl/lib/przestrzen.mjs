// Proste narzędzia przestrzenne dla ETL. Współrzędne płaskie w metrach (EPSG:2178), więc
// odległość to zwykłe Pitagorasowe – bez bibliotek geometrycznych i bez zależności poza kdbush.
import KDBush from 'kdbush'

/** Odległość punktu (px, py) od odcinka a–b (z końcami; odcinek zerowej długości = punkt). */
export function odlegloscDoOdcinka(px, py, ax, ay, bx, by) {
  const dx = bx - ax
  const dy = by - ay
  const dl2 = dx * dx + dy * dy
  const t = dl2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / dl2))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

/**
 * Indeks siatkowy odcinków. Każdy odcinek trafia do wszystkich komórek swojego prostokąta
 * otaczającego (dla ukośnych to nadmiar, ale najbliższy odcinek jest wtedy zawsze znaleziony).
 * Klucz komórki to gęsty indeks liczbowy, a nie tekst – zapytań jest kilkadziesiąt tysięcy.
 *
 * @param {ArrayLike<number>[]} odcinki tablica [ax, ay, bx, by]
 * @param {number} komorka bok komórki w metrach
 */
export function zbudujIndeksOdcinkow(odcinki, komorka = 250) {
  let iMin = Infinity
  let iMax = -Infinity
  let jMin = Infinity
  let jMax = -Infinity
  const zakresy = odcinki.map(([ax, ay, bx, by]) => {
    const z = [
      Math.floor(Math.min(ax, bx) / komorka),
      Math.floor(Math.max(ax, bx) / komorka),
      Math.floor(Math.min(ay, by) / komorka),
      Math.floor(Math.max(ay, by) / komorka),
    ]
    iMin = Math.min(iMin, z[0])
    iMax = Math.max(iMax, z[1])
    jMin = Math.min(jMin, z[2])
    jMax = Math.max(jMax, z[3])
    return z
  })
  const szer = jMax - jMin + 1
  const siatka = new Map()
  zakresy.forEach(([i0, i1, j0, j1], numer) => {
    for (let i = i0; i <= i1; i++)
      for (let j = j0; j <= j1; j++) {
        const klucz = (i - iMin) * szer + (j - jMin)
        const lista = siatka.get(klucz)
        if (lista) lista.push(numer)
        else siatka.set(klucz, [numer])
      }
  })
  return { komorka, siatka, odcinki, iMin, iMax, jMin, jMax, szer }
}

/**
 * Najbliższy odcinek: przeszukujemy pierścienie komórek wokół punktu. Po przejrzeniu pierścienia
 * r każdy nieprzejrzany odcinek leży dalej niż r · komórka (punkt jest wewnątrz swojej komórki,
 * a nieprzejrzane komórki są co najmniej r + 1 komórek stąd), więc przy wyniku ≤ r · komórka
 * można skończyć. Zwraca { metry, numer } albo null dla pustego indeksu.
 */
export function najblizszyOdcinek(indeks, px, py) {
  const { komorka, siatka, odcinki, iMin, iMax, jMin, jMax, szer } = indeks
  if (!odcinki.length) return null
  const ci = Math.floor(px / komorka)
  const cj = Math.floor(py / komorka)
  const promienMax = Math.max(
    Math.abs(ci - iMin),
    Math.abs(ci - iMax),
    Math.abs(cj - jMin),
    Math.abs(cj - jMax),
  )
  let metry = Number.POSITIVE_INFINITY
  let numer = -1
  const sprawdz = (i, j) => {
    if (i < iMin || i > iMax || j < jMin || j > jMax) return
    const lista = siatka.get((i - iMin) * szer + (j - jMin))
    if (!lista) return
    for (const n of lista) {
      const [ax, ay, bx, by] = odcinki[n]
      const d = odlegloscDoOdcinka(px, py, ax, ay, bx, by)
      if (d < metry) {
        metry = d
        numer = n
      }
    }
  }
  for (let r = 0; r <= promienMax; r++) {
    if (r === 0) sprawdz(ci, cj)
    else {
      for (let i = ci - r; i <= ci + r; i++) {
        sprawdz(i, cj - r)
        sprawdz(i, cj + r)
      }
      for (let j = cj - r + 1; j <= cj + r - 1; j++) {
        sprawdz(ci - r, j)
        sprawdz(ci + r, j)
      }
    }
    if (metry <= r * komorka) break
  }
  return numer < 0 ? null : { metry, numer }
}

/** Indeks punktów [x, y] pod zapytania „ile w promieniu" (kdbush). */
export function indeksPunktow(punkty) {
  const indeks = new KDBush(punkty.length)
  for (const [x, y] of punkty) indeks.add(x, y)
  indeks.finish()
  return indeks
}

/** Suma wag punktów w promieniu (włącznie z brzegiem). Bez wag każdy punkt liczy się jako 1. */
export function sumaWPromieniu(indeks, x, y, promien, wagi) {
  let suma = 0
  for (const i of indeks.within(x, y, promien)) suma += wagi ? (wagi[i] ?? 0) : 1
  return suma
}

/**
 * Grupowanie łańcuchowe (single linkage): punkty oddalone o najwyżej `eps` metrów, także
 * pośrednio przez inne punkty, trafiają do jednej grupy. Zwraca tablicę grup (indeksy punktów).
 */
export function grupujPunkty(punkty, eps) {
  if (!punkty.length) return []
  const indeks = indeksPunktow(punkty)
  const rodzic = Int32Array.from(punkty, (_, i) => i)
  const korzen = (i) => {
    let k = i
    while (rodzic[k] !== k) {
      rodzic[k] = rodzic[rodzic[k]]
      k = rodzic[k]
    }
    return k
  }
  punkty.forEach(([x, y], i) => {
    for (const j of indeks.within(x, y, eps)) {
      const a = korzen(i)
      const b = korzen(j)
      if (a !== b) rodzic[a] = b
    }
  })
  const grupy = new Map()
  for (let i = 0; i < punkty.length; i++) {
    const k = korzen(i)
    const grupa = grupy.get(k)
    if (grupa) grupa.push(i)
    else grupy.set(k, [i])
  }
  return [...grupy.values()]
}

/** Środek ciężkości grupy punktów [x, y]. */
export function srodekGrupy(punkty, grupa) {
  let sx = 0
  let sy = 0
  for (const i of grupa) {
    sx += punkty[i][0]
    sy += punkty[i][1]
  }
  return [sx / grupa.length, sy / grupa.length]
}
