// Dostarcza mapie GeoJSON heksów zbudowany w workerze (geometriaWorker.ts) jako URL (blob:).
// `GeoJSONSource.setData(obiekt)` klonuje cały obiekt na wątku głównym (ok. 3 s dla ok. 400 tys.
// obiektów na telefonie z CPU ×4); `setData(url)` każe MapLibre pobrać i sparsować dane w jego
// własnym workerze (w MapLibre 6 `setData(string)` to URL, a `blob:` przechodzi przez zwykły fetch).
import type { GeoJSONSource, Map as MapLibre, MapSourceDataEvent } from 'maplibre-gl'
import { kolekcjaZWartosciami, type Otoczka, zbudujOtoczke } from './geometria.ts'
import type { DoWorkera, ZWorkera } from './geometriaWorker.ts'

interface ZlecenieHeksow {
  klucze: string[]
  w: Float64Array
}

export class DostawcaGeoJson {
  private worker: Worker | null = null
  private blad = false
  private zniszczony = false
  /** Numer ostatniego zlecenia heksów na źródło – wynik o innym numerze jest już nieaktualny. */
  private readonly zlecenia = new Map<string, number>()
  /** Zlecenie, którego wynik jeszcze nie wrócił z workera (zapas, gdy worker padnie). */
  private readonly wTrakcie = new Map<string, ZlecenieHeksow>()
  /** Numer zlecenia, którego URL oddano mapie (`setData`), ale dane jeszcze się nie załadowały. */
  private readonly zastosowane = new Map<string, number>()
  /** URL-e blobów źródła; zwalniane dopiero po załadowaniu danych, bo MapLibre pobiera je z opóźnieniem. */
  private readonly urle = new Map<string, string[]>()
  /** Co zrobić po załadowaniu najnowszych danych źródła (np. wyczyścić feature-state). */
  private readonly poZaladowaniu = new Map<string, (() => void)[]>()
  private nrMgly = 0
  private obslugaMgly: ((o: Otoczka) => void) | null = null
  private readonly nasluch = (e: MapSourceDataEvent) => this.przyZaladowaniu(e)

  constructor(private readonly mapa: MapLibre) {
    mapa.on('sourcedata', this.nasluch)
  }

  /** Czy dla źródła jest zlecenie, którego dane jeszcze nie zostały załadowane przez mapę. */
  czeka(zrodlo: string): boolean {
    return this.wTrakcie.has(zrodlo) || this.zastosowane.has(zrodlo)
  }

  /** Woła `fn` po załadowaniu najnowszych danych źródła; od ręki, gdy nic nie czeka. */
  kiedyZaladowane(zrodlo: string, fn: () => void) {
    if (!this.czeka(zrodlo)) return fn()
    this.poZaladowaniu.set(zrodlo, [...(this.poZaladowaniu.get(zrodlo) ?? []), fn])
  }

  /**
   * Zleca zbudowanie poligonów i `setData(url)`. `fn` wchodzi po załadowaniu tych danych (nie wcześniej:
   * feature-state musi znikać razem ze starą bazą właściwości). Starsze zlecenie traci ważność, ale
   * jego `fn` zostaje w kolejce i wykona się po załadowaniu najnowszych danych.
   */
  zlec(zrodlo: string, klucze: string[], w: Float64Array, fn: () => void) {
    const id = (this.zlecenia.get(zrodlo) ?? 0) + 1
    this.zlecenia.set(zrodlo, id)
    this.poZaladowaniu.set(zrodlo, [...(this.poZaladowaniu.get(zrodlo) ?? []), fn])
    const zlecenie = { klucze, w }
    const worker = this.zapewnijWorkera()
    if (!worker) return this.zastosujSynchronicznie(zrodlo, zlecenie)
    this.wTrakcie.set(zrodlo, zlecenie)
    const wiadomosc: DoWorkera = { rodzaj: 'heksy', id, zrodlo, klucze, w }
    // Bez przekazania bufora: kopia ok. 200 KB jest tania, a zlecenie zostaje w `wTrakcie` na zapas.
    worker.postMessage(wiadomosc)
  }

  /** Mgła z r8: worker, a bez niego wynik od ręki z wątku głównego. `fn` dostaje tylko aktualny wynik. */
  mgla(r8: string[], fn: (o: Otoczka) => void) {
    this.obslugaMgly = fn
    const id = ++this.nrMgly
    const worker = this.zapewnijWorkera()
    if (!worker) return fn(zbudujOtoczke(r8))
    const wiadomosc: DoWorkera = { rodzaj: 'mgla', id, r8 }
    worker.postMessage(wiadomosc)
  }

  /** Unieważnia oczekującą mgłę (wynik z workera zostanie odrzucony). */
  anulujMgle() {
    this.nrMgly++
  }

  zniszcz() {
    this.zniszczony = true
    this.mapa.off('sourcedata', this.nasluch)
    this.worker?.terminate()
    this.worker = null
    for (const lista of this.urle.values()) for (const u of lista) URL.revokeObjectURL(u)
    this.urle.clear()
    this.poZaladowaniu.clear()
    this.wTrakcie.clear()
    this.zastosowane.clear()
  }

  private zapewnijWorkera(): Worker | null {
    if (this.worker) return this.worker
    if (this.blad || this.zniszczony || typeof Worker === 'undefined') return null
    try {
      const worker = new Worker(new URL('./geometriaWorker.ts', import.meta.url), {
        type: 'module',
      })
      worker.onmessage = (e: MessageEvent<ZWorkera>) => this.przyWyniku(e.data)
      worker.onerror = () => this.przyBledzie()
      this.worker = worker
    } catch {
      this.blad = true
    }
    return this.worker
  }

  private przyWyniku(odp: ZWorkera) {
    if (this.zniszczony) return
    if (odp.rodzaj === 'mgla') {
      // Wynik starszy niż ostatnie zlecenie odpowiada już nieaktualnemu zbiorowi miast.
      if (odp.id === this.nrMgly) this.obslugaMgly?.(odp.otoczka)
      return
    }
    if (odp.id !== this.zlecenia.get(odp.zrodlo)) return
    this.wTrakcie.delete(odp.zrodlo)
    const zrodlo = this.mapa.getSource<GeoJSONSource>(odp.zrodlo)
    if (!zrodlo) return this.zakoncz(odp.zrodlo)
    const url = URL.createObjectURL(odp.blob)
    this.urle.set(odp.zrodlo, [...(this.urle.get(odp.zrodlo) ?? []), url])
    this.zastosowane.set(odp.zrodlo, odp.id)
    void zrodlo.setData(url)
  }

  /** Worker nie wstał albo padł: to, co zlecone, liczy się synchronicznie na wątku głównym. */
  private przyBledzie() {
    this.blad = true
    this.worker?.terminate()
    this.worker = null
    for (const [zrodlo, zlecenie] of [...this.wTrakcie])
      this.zastosujSynchronicznie(zrodlo, zlecenie)
    // Mgła czekająca w workerze: zapas przyjdzie przy następnym zleceniu (debounce w MapaKrakowa).
  }

  private zastosujSynchronicznie(zrodlo: string, z: ZlecenieHeksow) {
    this.wTrakcie.delete(zrodlo)
    this.mapa
      .getSource<GeoJSONSource>(zrodlo)
      ?.setData(kolekcjaZWartosciami(z.klucze, z.w) as unknown as GeoJSON.GeoJSON)
    this.zakoncz(zrodlo)
  }

  private przyZaladowaniu(e: MapSourceDataEvent) {
    if (!e.isSourceLoaded || e.sourceDataType === 'metadata') return
    const zrodlo = e.sourceId
    // `isSourceLoaded` znaczy, że mapa niczego już nie dopobiera, więc URL-e wszystkich dotąd
    // oddanych danych można zwolnić. Zlecenie, które jeszcze czeka w workerze, nie ma URL-a.
    this.zwolnijUrle(zrodlo)
    if (this.zastosowane.get(zrodlo) !== this.zlecenia.get(zrodlo)) return
    this.zakoncz(zrodlo)
  }

  private zakoncz(zrodlo: string) {
    this.zastosowane.delete(zrodlo)
    const lista = this.poZaladowaniu.get(zrodlo)
    this.poZaladowaniu.delete(zrodlo)
    for (const fn of lista ?? []) fn()
  }

  private zwolnijUrle(zrodlo: string) {
    for (const u of this.urle.get(zrodlo) ?? []) URL.revokeObjectURL(u)
    this.urle.delete(zrodlo)
  }
}
