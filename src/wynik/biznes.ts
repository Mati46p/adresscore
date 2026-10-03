/** Uproszczony model Huffa: każdy heks popytu dzieli się między punkty w promieniu branży. */
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
  percentyl: number
  najblizszyKonkurent: string | null
  odlegloscKonkurenta: number | null
}
export interface BialaPlama {
  h3: string
  adresyNaPunkt: number
  konkurenci: number
  najblizszyKonkurent: string | null
  skala: number
}

const METRY_LON = 71_450
const METRY_LAT = 111_200
const ROZMIAR_KRATKI = 600
const x = (lon: number) => lon * METRY_LON
const y = (lat: number) => lat * METRY_LAT
const dystans = (a: Miejsce, b: Miejsce) => Math.hypot(x(a.lon) - x(b.lon), y(a.lat) - y(b.lat))
const klucz = (gx: number, gy: number) => gx + ':' + gy

function indeks<T extends Miejsce>(obiekty: readonly T[]): Map<string, T[]> {
  const wynik = new Map<string, T[]>()
  for (const obiekt of obiekty) {
    const k = klucz(
      Math.floor(x(obiekt.lon) / ROZMIAR_KRATKI),
      Math.floor(y(obiekt.lat) / ROZMIAR_KRATKI),
    )
    const lista = wynik.get(k) ?? []
    lista.push(obiekt)
    wynik.set(k, lista)
  }
  return wynik
}

function wPromieniu<T extends Miejsce>(
  mapa: Map<string, T[]>,
  miejsce: Miejsce,
  promien: number,
): T[] {
  const wynik: T[] = []
  const minX = Math.floor((x(miejsce.lon) - promien) / ROZMIAR_KRATKI)
  const maxX = Math.floor((x(miejsce.lon) + promien) / ROZMIAR_KRATKI)
  const minY = Math.floor((y(miejsce.lat) - promien) / ROZMIAR_KRATKI)
  const maxY = Math.floor((y(miejsce.lat) + promien) / ROZMIAR_KRATKI)
  for (let gx = minX; gx <= maxX; gx++)
    for (let gy = minY; gy <= maxY; gy++)
      for (const obiekt of mapa.get(klucz(gx, gy)) ?? [])
        if (dystans(miejsce, obiekt) <= promien) wynik.push(obiekt)
  return wynik
}

/** Udziały dla jednego źródła popytu sumują się do 1. */
export function udzialyHuffa(odleglosci: readonly number[]): number[] {
  if (!odleglosci.length) return []
  const atrakcyjnosci = odleglosci.map((metry) => 1 / Math.pow(Math.max(80, metry), 1.6))
  const suma = atrakcyjnosci.reduce((a, b) => a + b, 0)
  return atrakcyjnosci.map((a) => a / suma)
}

interface Komorka extends Miejsce {
  h3: string
  adresy: number
  ludnosc: number
  kursy: number
}
interface Punkt extends Miejsce {
  id: number
  nazwa: string
}
interface WynikSurowy {
  adresy: number
  popyt: number
}

const komorkiZTablic = (dane: readonly KomorkaPopytu[]): Komorka[] =>
  dane.map(([h3, lon, lat, adresy, ludnosc, kursy]) => ({ h3, lon, lat, adresy, ludnosc, kursy }))
const punktyZTablic = (dane: readonly PunktUslugi[]): Punkt[] =>
  dane.map(([lon, lat, nazwa], id) => ({ lon, lat, nazwa, id }))

/** Indeks popytu: osoby NSP 2021 plus niewielka premia za kursy w porannym szczycie. */
function popyt(c: Komorka): number {
  const bazowy = c.ludnosc > 0 ? c.ludnosc : c.adresy * 2
  return bazowy * (1 + Math.min(Math.max(c.kursy, 0), 20) * 0.015)
}

function rozdziel(
  komorki: readonly Komorka[],
  punkty: readonly Punkt[],
  promien: number,
): { wyniki: WynikSurowy[]; nieobsluzoneAdresy: number } {
  const idx = indeks(punkty)
  const wyniki = punkty.map(() => ({ adresy: 0, popyt: 0 }))
  let nieobsluzoneAdresy = 0
  for (const cell of komorki) {
    const bliskie = wPromieniu(idx, cell, promien)
    if (!bliskie.length) {
      nieobsluzoneAdresy += cell.adresy
      continue
    }
    const udzialy = udzialyHuffa(bliskie.map((b) => dystans(cell, b)))
    for (let j = 0; j < bliskie.length; j++) {
      const punkt = bliskie[j]
      if (!punkt) continue
      const wynik = wyniki[punkt.id]
      if (!wynik) continue
      wynik.adresy += cell.adresy * (udzialy[j] ?? 0)
      wynik.popyt += popyt(cell) * (udzialy[j] ?? 0)
    }
  }
  return { wyniki, nieobsluzoneAdresy }
}

export function obliczBialePlamy(
  dane: readonly KomorkaPopytu[],
  uslugi: readonly PunktUslugi[],
  promien: number,
): BialaPlama[] {
  const komorki = komorkiZTablic(dane)
  const punkty = punktyZTablic(uslugi)
  const idxKomorek = indeks(komorki)
  const idxPunktow = indeks(punkty)
  const surowe = komorki.map((cell) => {
    const popytOkolicy = wPromieniu(idxKomorek, cell, promien).reduce((s, c) => s + c.adresy, 0)
    const konkurenci = wPromieniu(idxPunktow, cell, promien)
    const najblizszy = konkurenci.sort((a, b) => dystans(cell, a) - dystans(cell, b))[0]
    return {
      h3: cell.h3,
      adresyNaPunkt: popytOkolicy / Math.max(1, konkurenci.length),
      konkurenci: konkurenci.length,
      najblizszyKonkurent: najblizszy?.nazwa || null,
      skala: 0,
    }
  })
  const p95 = progNasycenia(surowe.map((r) => r.adresyNaPunkt))
  for (const r of surowe) r.skala = Math.min(100, (100 * r.adresyNaPunkt) / p95)
  return surowe
}

/** Wartość, przy której kolor mapy osiąga 100; wyższe wartości są nasycone. */
export function progNasycenia(wartosci: readonly number[]): number {
  const posortowane = [...wartosci].sort((a, b) => a - b)
  return posortowane[Math.floor(posortowane.length * 0.95)] || 1
}

export function ocenMiejsce(
  dane: readonly KomorkaPopytu[],
  uslugi: readonly PunktUslugi[],
  promien: number,
  miejsce: Miejsce,
  wartosciBazowe = obliczBazowePunkty(dane, uslugi, promien),
): OcenaMiejsca {
  const komorki = komorkiZTablic(dane)
  const bazowePunkty = punktyZTablic(uslugi)
  const indeksKomorek = indeks(komorki)
  const indeksPunktow = indeks(bazowePunkty)
  const bliskie = wPromieniu(indeksPunktow, miejsce, promien).sort(
    (a, b) => dystans(miejsce, a) - dystans(miejsce, b),
  )
  const najblizszy = bliskie[0]
  const bliskieKomorki = wPromieniu(indeksKomorek, miejsce, promien)
  const adresyWZasiegu = bliskieKomorki.reduce((s, c) => s + c.adresy, 0)
  const mieszkancyWZasiegu = bliskieKomorki.reduce((s, c) => s + c.ludnosc, 0)
  const kursySzczytSrednio = adresyWZasiegu
    ? bliskieKomorki.reduce((s, c) => s + c.kursy * c.adresy, 0) / adresyWZasiegu
    : 0
  const punktNowy = { ...miejsce, id: bazowePunkty.length, nazwa: 'Nowe miejsce' }
  // Punkt na istniejącym obiekcie porównujemy jako ten sam obiekt, a nie dwa identyczne sklepy.
  const zastapiony = najblizszy && dystans(miejsce, najblizszy) <= 25 ? najblizszy.id : -1
  const najblizszyKonkurent = bliskie.find((p) => p.id !== zastapiony)
  const punktyDoOceny = bazowePunkty
    .filter((p) => p.id !== zastapiony)
    .map((p, id) => ({ ...p, id }))
  punktNowy.id = punktyDoOceny.length
  const wynik = rozdziel(komorki, [...punktyDoOceny, punktNowy], promien).wyniki.at(-1)
  const wartosc = wynik?.popyt ?? 0
  const percentyl = wartosciBazowe.length
    ? Math.round(
        (100 *
          wartosciBazowe.reduce((s, v) => s + (v < wartosc ? 1 : v === wartosc ? 0.5 : 0), 0)) /
          wartosciBazowe.length,
      )
    : 0
  return {
    adresyWZasiegu,
    mieszkancyWZasiegu,
    kursySzczytSrednio,
    konkurenci: bliskie.length - (zastapiony >= 0 ? 1 : 0),
    przydzieloneAdresy: wynik?.adresy ?? 0,
    przydzielonyPopyt: wartosc,
    udzialProcent: adresyWZasiegu ? Math.round((100 * (wynik?.adresy ?? 0)) / adresyWZasiegu) : 0,
    percentyl,
    najblizszyKonkurent: najblizszyKonkurent?.nazwa || null,
    odlegloscKonkurenta: najblizszyKonkurent
      ? Math.round(dystans(miejsce, najblizszyKonkurent))
      : null,
  }
}

export function obliczBazowePunkty(
  dane: readonly KomorkaPopytu[],
  uslugi: readonly PunktUslugi[],
  promien: number,
): number[] {
  return rozdziel(komorkiZTablic(dane), punktyZTablic(uslugi), promien).wyniki.map((w) => w.popyt)
}

/** Suma przydziałów i nieobsłużonych adresów równa się liczbie adresów wejściowych. */
export function bilansPopytu(
  dane: readonly KomorkaPopytu[],
  uslugi: readonly PunktUslugi[],
  promien: number,
) {
  const wynik = rozdziel(komorkiZTablic(dane), punktyZTablic(uslugi), promien)
  return {
    przydzielone: wynik.wyniki.reduce((s, w) => s + w.adresy, 0),
    nieobsluzone: wynik.nieobsluzoneAdresy,
  }
}
