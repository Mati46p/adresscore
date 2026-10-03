// WYŁĄCZNIE DLA TESTÓW. Odniesienie „pełne” dla silnika trybu Biznes: przelicza model Huffa dla
// KAŻDEGO heksu i KAŻDEGO punktu, bez siatki i bez indeksów (tak liczył silnik przed #105).
// Wolne (heksy × punkty), ale tak proste, że nie dzieli z silnikiem żadnego kodu poza wzorami
// z `biznes.ts` (projekcja, popyt heksu, udziały Huffa) – dlatego nadaje się na wyrocznię.
import {
  type KomorkaPopytu,
  METRY_LAT,
  METRY_LON,
  type Miejsce,
  PROMIEN_TEGO_SAMEGO_M,
  type PunktUslugi,
  popytKomorki,
  udzialyHuffa,
} from './biznes.ts'

/** Odległość w metrach; bez `Math.hypot`, które przy milionach par jest kilkanaście razy wolniejsze. */
const dystans = (alon: number, alat: number, blon: number, blat: number) => {
  const dx = (alon - blon) * METRY_LON
  const dy = (alat - blat) * METRY_LAT
  return Math.sqrt(dx * dx + dy * dy)
}

export interface OcenaPelna {
  adresyWZasiegu: number
  mieszkancyWZasiegu: number
  kursySzczytSrednio: number
  konkurenci: number
  przydzieloneAdresy: number
  przydzielonyPopyt: number
  udzialProcent: number
  percentyl: number | null
  porownanoZ: number
  najblizszyKonkurent: string | null
  odlegloscKonkurenta: number | null
  /** Adresy zasięgu miejsca, które po jego dodaniu przypadają istniejącym punktom (suma). */
  adresyKonkurentow: number
  /** Indeks punktu zastąpionego przez miejsce albo -1. */
  zastapiony: number
}

/** Przydział popytu i adresów dla każdego punktu z listy, w obecnym układzie punktów. */
export function przydzialyPelne(
  dane: readonly KomorkaPopytu[],
  uslugi: readonly PunktUslugi[],
  promien: number,
): { popyt: number[]; adresy: number[]; heksow: number[] } {
  const popyt = uslugi.map(() => 0)
  const adresy = uslugi.map(() => 0)
  const heksow = uslugi.map(() => 0)
  for (const [, lon, lat, a, l, kursy] of dane) {
    const wZasiegu: number[] = []
    const odleglosci: number[] = []
    uslugi.forEach(([plon, plat], j) => {
      const d = dystans(lon, lat, plon, plat)
      if (d <= promien) {
        wZasiegu.push(j)
        odleglosci.push(d)
      }
    })
    const udzialy = udzialyHuffa(odleglosci)
    wZasiegu.forEach((j, t) => {
      popyt[j] = (popyt[j] as number) + popytKomorki(a, l, kursy) * (udzialy[t] as number)
      adresy[j] = (adresy[j] as number) + a * (udzialy[t] as number)
      heksow[j] = (heksow[j] as number) + 1
    })
  }
  return { popyt, adresy, heksow }
}

/**
 * Ocena miejsca przez przeliczenie całego miasta od zera. `przed` (przydziały obecnego układu
 * punktów) można policzyć raz i podać przy kolejnych miejscach – nie zależy od miejsca.
 */
export function ocenaPelna(
  dane: readonly KomorkaPopytu[],
  uslugi: readonly PunktUslugi[],
  promien: number,
  miejsce: Miejsce,
  przed = przydzialyPelne(dane, uslugi, promien),
): OcenaPelna {
  const bliskie = uslugi
    .map(([lon, lat, nazwa], id) => ({
      id,
      nazwa,
      d: dystans(miejsce.lon, miejsce.lat, lon, lat),
    }))
    .filter((p) => p.d <= promien)
    .sort((a, b) => a.d - b.d || a.id - b.id)
  const najblizszy = bliskie[0]
  const zastapiony = najblizszy && najblizszy.d <= PROMIEN_TEGO_SAMEGO_M ? najblizszy.id : -1
  const konkurent = bliskie.find((p) => p.id !== zastapiony)

  // Punkty po zamianie: bez zastąpionego, z nowym na końcu.
  const aktywne = uslugi.filter((_, id) => id !== zastapiony)
  const zNowym: PunktUslugi[] = [...aktywne, [miejsce.lon, miejsce.lat, 'Nowe miejsce']]
  const nowy = zNowym.length - 1
  const zasieg = dane.filter(
    ([, lon, lat]) => dystans(miejsce.lon, miejsce.lat, lon, lat) <= promien,
  )
  const po = przydzialyPelne(dane, zNowym, promien)

  const adresyWZasiegu = zasieg.reduce((s, c) => s + c[3], 0)
  const mieszkancy = zasieg.reduce((s, c) => s + c[4], 0)
  const kursy = adresyWZasiegu ? zasieg.reduce((s, c) => s + c[5] * c[3], 0) / adresyWZasiegu : 0
  const przydzieloneAdresy = po.adresy[nowy] as number
  const przydzielonyPopyt = po.popyt[nowy] as number

  // Rozkład porównawczy: istniejące punkty z popytem w zasięgu, każdy w OBECNYM układzie rynku
  // (przed dodaniem miejsca). Punkt zastąpiony przez miejsce nie porównuje się sam ze sobą.
  const wRozkladzie = przed.popyt.filter(
    (_, j) => j !== zastapiony && (przed.heksow[j] as number) > 0,
  )
  let percentyl: number | null = null
  if (adresyWZasiegu > 0 && wRozkladzie.length > 0) {
    const mniejsze = wRozkladzie.filter((v) => v < przydzielonyPopyt).length
    const rowne = wRozkladzie.filter((v) => v === przydzielonyPopyt).length
    percentyl = Math.round((100 * (mniejsze + rowne / 2)) / wRozkladzie.length)
  }
  // Konkurenci liczeni tylko na heksach zasięgu miejsca: to część adresów, którą z nim dzielą.
  const wZasiegu = przydzialyPelne(zasieg, zNowym, promien)
  const adresyKonkurentow = wZasiegu.adresy.slice(0, nowy).reduce((s, v) => s + v, 0)
  return {
    adresyWZasiegu,
    mieszkancyWZasiegu: mieszkancy,
    kursySzczytSrednio: kursy,
    konkurenci: bliskie.length - (zastapiony >= 0 ? 1 : 0),
    przydzieloneAdresy,
    przydzielonyPopyt,
    udzialProcent: adresyWZasiegu ? Math.round((100 * przydzieloneAdresy) / adresyWZasiegu) : 0,
    percentyl,
    porownanoZ: wRozkladzie.length,
    najblizszyKonkurent: konkurent ? konkurent.nazwa || null : null,
    odlegloscKonkurenta: konkurent ? Math.round(konkurent.d) : null,
    adresyKonkurentow,
    zastapiony,
  }
}
