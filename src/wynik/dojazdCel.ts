// Planowy dojazd komunikacją do celu wybranego przez użytkownika (#85, kontynuacja #38).
// Graf rozkładu: `public/dane/dojazd/graf.json` z `etl/dojazd-gtfs-graf.mjs` (GTFS ZTP, jeden dzień).
// Dla celu i godziny wyjścia skanujemy odjazdy od końca okna (profil jak w etl/dojazd-gtfs.mjs):
// raz na (cel zaokrąglony, godzina) dostajemy najwcześniejszy przyjazd dla każdego przystanku,
// a czas z dowolnego adresu to już tylko kilka przystanków w zasięgu dojścia. Nie liczymy
// 176 tys. adresów na kliknięcie – tylko adresy, które użytkownik właśnie ogląda.
// Czysta logika, bez DOM: działa w workerze (`dojazdCel.worker.ts`) i w `node --test`.

export const MAX_DOJSCIE_M = 1_200
export const MAX_PRZESIADKA_M = 350
export const PREDKOSC_PIESZO_MS = 1.25 // po linii prostej, nie po chodnikach
export const BUFOR_PRZESIADKI_MIN = 2
export const MAX_PODROZ_MIN = 120
/** Cel zaokrąglany do 0,001° (ok. 70–110 m) – klucz cache i faktycznie liczony punkt. */
export const ZAOKRAGLENIE_CELU = 1_000
const BRAK = 0xffff
const CACHE_MAX = 8

export interface ZrodloGrafu {
  nazwa: string
  url: string
  licencja?: string
  dataDanych: string
  pobrano?: string
}

/** Plik z ETL: przystanki [lon·1e5, lat·1e5, …], kursy [przystanek, Δprzyjazd, postój, flagi, …]. */
export interface GrafPlik {
  wersja: 1
  dataRozkladu: string
  okno: { start: number; koniec: number }
  zrodla: ZrodloGrafu[]
  przystanki: number[]
  kursy: number[][]
}

export interface Punkt {
  lat: number
  lon: number
}

export interface ModelRozkladu {
  dataRozkladu: string
  okno: { start: number; koniec: number }
  zrodla: ZrodloGrafu[]
  lat: Float64Array
  lon: Float64Array
  // Zdarzenia (przystanek w kursie), posortowane malejąco po odjeździe, w kursie od końca.
  zKurs: Uint32Array
  zStop: Uint32Array
  zArr: Uint16Array
  zDep: Uint16Array
  zFlagi: Uint8Array
  liczbaKursow: number
  siatka: Map<string, number[]>
  /** Sąsiedztwo przesiadek: CSR – [od[i], od[i+1]) w sasiad/sasiadMin. */
  sasiadOd: Uint32Array
  sasiad: Uint32Array
  sasiadMin: Uint16Array
}

export interface ProfilCelu {
  cel: Punkt
  odjazd: number
  koniec: number
  /** Najwcześniejszy przyjazd (minuta dnia) przy wejściu na przystanek w minucie odjazd + k. */
  wejscie: Uint16Array[]
  /** Liczba przystanków, z których w ogóle da się dojechać. */
  osiagalne: number
}

export function odlegloscM(a: Punkt, b: Punkt): number {
  const r = Math.PI / 180
  const x = (b.lon - a.lon) * r * Math.cos(((a.lat + b.lat) / 2) * r)
  const y = (b.lat - a.lat) * r
  return Math.sqrt(x * x + y * y) * 6_371_000
}

export const minutyPieszo = (m: number) => Math.ceil(m / PREDKOSC_PIESZO_MS / 60)

const KOMORKA = 0.01
const klucz = (lat: number, lon: number) =>
  `${Math.floor(lat / KOMORKA)}:${Math.floor(lon / KOMORKA)}`

function wPromieniu(model: Pick<ModelRozkladu, 'siatka' | 'lat' | 'lon'>, p: Punkt, r: number) {
  const dLat = Math.ceil(r / 111_000 / KOMORKA)
  const dLon = Math.ceil(r / (111_000 * Math.cos((p.lat * Math.PI) / 180)) / KOMORKA)
  const la = Math.floor(p.lat / KOMORKA)
  const lo = Math.floor(p.lon / KOMORKA)
  const wynik: { i: number; m: number }[] = []
  for (let a = la - dLat; a <= la + dLat; a++)
    for (let b = lo - dLon; b <= lo + dLon; b++)
      for (const i of model.siatka.get(`${a}:${b}`) ?? []) {
        const m = odlegloscM(p, { lat: model.lat[i]!, lon: model.lon[i]! })
        if (m <= r) wynik.push({ i, m })
      }
  return wynik
}

export function zbudujModel(graf: GrafPlik): ModelRozkladu {
  if (graf.wersja !== 1) throw new Error('Nieznana wersja grafu dojazdu')
  const n = graf.przystanki.length / 2
  const lat = new Float64Array(n)
  const lon = new Float64Array(n)
  const siatka = new Map<string, number[]>()
  for (let i = 0; i < n; i++) {
    const x = graf.przystanki[2 * i]! / 1e5
    const y = graf.przystanki[2 * i + 1]! / 1e5
    lon[i] = x
    lat[i] = y
    const k = klucz(y, x)
    const lista = siatka.get(k)
    if (lista) lista.push(i)
    else siatka.set(k, [i])
  }
  let m = 0
  for (const k of graf.kursy) m += k.length / 4
  const zKurs = new Uint32Array(m)
  const zStop = new Uint32Array(m)
  const zArr = new Uint16Array(m)
  const zDep = new Uint16Array(m)
  const zFlagi = new Uint8Array(m)
  const zSeq = new Uint16Array(m)
  let e = 0
  graf.kursy.forEach((k, t) => {
    let poprzedni = 0
    for (let j = 0; j < k.length; j += 4) {
      const arr = poprzedni + k[j + 1]!
      const dep = arr + k[j + 2]!
      zKurs[e] = t
      zStop[e] = k[j]!
      zArr[e] = arr
      zDep[e] = dep
      zFlagi[e] = k[j + 3]!
      zSeq[e] = j / 4
      poprzedni = dep
      e++
    }
  })
  const kolejnosc = Array.from({ length: m }, (_, i) => i).sort(
    (a, b) => zDep[b]! - zDep[a]! || zSeq[b]! - zSeq[a]!,
  )
  const przestaw = <T extends Uint32Array | Uint16Array | Uint8Array>(src: T): T => {
    const dst = new (src.constructor as new (n: number) => T)(m)
    for (let i = 0; i < m; i++) dst[i] = src[kolejnosc[i]!]!
    return dst
  }
  const czesc = { siatka, lat, lon }
  const sasiadOd = new Uint32Array(n + 1)
  const sasiad: number[] = []
  const sasiadMin: number[] = []
  for (let i = 0; i < n; i++) {
    sasiadOd[i] = sasiad.length
    for (const q of wPromieniu(czesc, { lat: lat[i]!, lon: lon[i]! }, MAX_PRZESIADKA_M)) {
      if (q.i === i) continue
      sasiad.push(q.i)
      sasiadMin.push(minutyPieszo(q.m) + BUFOR_PRZESIADKI_MIN)
    }
  }
  sasiadOd[n] = sasiad.length
  return {
    dataRozkladu: graf.dataRozkladu,
    okno: graf.okno,
    zrodla: graf.zrodla,
    lat,
    lon,
    zKurs: przestaw(zKurs),
    zStop: przestaw(zStop),
    zArr: przestaw(zArr),
    zDep: przestaw(zDep),
    zFlagi: przestaw(zFlagi),
    liczbaKursow: graf.kursy.length,
    siatka,
    sasiadOd,
    sasiad: Uint32Array.from(sasiad),
    sasiadMin: Uint16Array.from(sasiadMin),
  }
}

export function zaokraglijCel(p: Punkt): Punkt {
  return {
    lat: Math.round(p.lat * ZAOKRAGLENIE_CELU) / ZAOKRAGLENIE_CELU,
    lon: Math.round(p.lon * ZAOKRAGLENIE_CELU) / ZAOKRAGLENIE_CELU,
  }
}

/** Godziny wyjścia, dla których okno grafu mieści pełne 2 h podróży. */
export function dostepneGodziny(model: Pick<ModelRozkladu, 'okno'>): number[] {
  const wynik: number[] = []
  for (
    let t = Math.ceil(model.okno.start / 60) * 60;
    t + MAX_PODROZ_MIN <= model.okno.koniec;
    t += 60
  )
    wynik.push(t)
  return wynik
}

/**
 * Profil najwcześniejszych przyjazdów do celu dla wyjścia w minucie `odjazd` (minuta dnia).
 * Uwzględnia czekanie, pozostanie w pojeździe, przesiadki (min. 2 min, do 350 m po prostej)
 * i dojście od przystanku do celu (do 1,2 km po prostej). Przyjazd po odjazd + 2 h = brak trasy.
 */
export function profilDoCelu(model: ModelRozkladu, cel: Punkt, odjazd: number): ProfilCelu {
  if (odjazd < model.okno.start || odjazd + MAX_PODROZ_MIN > model.okno.koniec)
    throw new Error('Godzina wyjścia poza oknem rozkładu')
  const n = model.lat.length
  const koniec = odjazd + MAX_PODROZ_MIN
  const dlugosc = koniec - odjazd + 1
  const profil = Array.from({ length: dlugosc + 1 }, () => new Uint16Array(n).fill(BRAK))
  const doCelu = new Map<number, number>()
  for (const p of wPromieniu(model, cel, MAX_DOJSCIE_M)) doCelu.set(p.i, minutyPieszo(p.m))
  const kurs = new Uint16Array(model.liczbaKursow).fill(BRAK)
  const { zKurs, zStop, zArr, zDep, zFlagi, sasiadOd, sasiad, sasiadMin } = model
  const at = (t: number) => profil[t - odjazd]!
  let j = 0
  while (j < zDep.length && zDep[j]! > koniec) j++
  for (let t = koniec; t >= odjazd; t--) {
    const obecny = at(t)
    if (t < koniec) obecny.set(at(t + 1)) // czekanie na następny kurs
    for (const [i, min] of doCelu)
      if (t + min <= koniec && t + min < obecny[i]!) obecny[i] = t + min
    // Przesiadka piesza trwa ≥ 2 min, więc jej stan docelowy jest już policzony.
    for (let i = 0; i < n; i++)
      for (let q = sasiadOd[i]!; q < sasiadOd[i + 1]!; q++) {
        const t2 = t + sasiadMin[q]!
        if (t2 <= koniec) {
          const v = at(t2)[sasiad[q]!]!
          if (v < obecny[i]!) obecny[i] = v
        }
      }
    while (j < zDep.length && zDep[j] === t) {
      const s = zStop[j]!
      const k = zKurs[j]!
      const arr = zArr[j]!
      const flagi = zFlagi[j]!
      let najlepszy = kurs[k]!
      if (flagi & 2 && arr >= odjazd && arr <= koniec) {
        const piesza = doCelu.get(s)
        if (piesza !== undefined && arr + piesza <= koniec)
          najlepszy = Math.min(najlepszy, arr + piesza)
        const t2 = arr + BUFOR_PRZESIADKI_MIN
        if (t2 <= koniec) najlepszy = Math.min(najlepszy, at(t2)[s]!)
      }
      kurs[k] = najlepszy
      if (flagi & 1 && najlepszy < obecny[s]!) obecny[s] = najlepszy
      j++
    }
  }
  // Dojście z adresu trwa najwyżej ~16 min – reszty profilu nie trzymamy w cache.
  const wejscie = profil.slice(0, Math.min(dlugosc, minutyPieszo(MAX_DOJSCIE_M) + 1))
  let osiagalne = 0
  for (let i = 0; i < n; i++) if (wejscie[0]![i] !== BRAK) osiagalne++
  return { cel, odjazd, koniec, wejscie, osiagalne }
}

/** Minuty od wyjścia z punktu do celu albo null, gdy model nie zna trasy w 2 h. */
export function czasZPunktu(model: ModelRozkladu, profil: ProfilCelu, p: Punkt): number | null {
  if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon)) return null
  let najlepszy = BRAK
  const bezposrednio = odlegloscM(p, profil.cel)
  if (bezposrednio <= MAX_DOJSCIE_M) najlepszy = profil.odjazd + minutyPieszo(bezposrednio)
  for (const q of wPromieniu(model, p, MAX_DOJSCIE_M)) {
    const k = minutyPieszo(q.m)
    if (k < profil.wejscie.length) najlepszy = Math.min(najlepszy, profil.wejscie[k]![q.i]!)
  }
  return najlepszy === BRAK || najlepszy > profil.koniec ? null : najlepszy - profil.odjazd
}

/** Mały cache LRU profili po (cel zaokrąglony, godzina wyjścia). */
export class CacheProfili {
  #mapa = new Map<string, ProfilCelu>()
  readonly model: ModelRozkladu
  constructor(model: ModelRozkladu) {
    this.model = model
  }
  profil(cel: Punkt, odjazd: number): { profil: ProfilCelu; zCache: boolean } {
    const c = zaokraglijCel(cel)
    const k = `${c.lat},${c.lon}|${odjazd}`
    const stary = this.#mapa.get(k)
    if (stary) {
      this.#mapa.delete(k)
      this.#mapa.set(k, stary)
      return { profil: stary, zCache: true }
    }
    const profil = profilDoCelu(this.model, c, odjazd)
    this.#mapa.set(k, profil)
    if (this.#mapa.size > CACHE_MAX) this.#mapa.delete(this.#mapa.keys().next().value as string)
    return { profil, zCache: false }
  }
}
