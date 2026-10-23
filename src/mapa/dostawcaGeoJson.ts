// Dostarcza mapie GeoJSON heksów zbudowany w workerze (geometriaWorker.ts) jako URL (blob:).
// `GeoJSONSource.setData(obiekt)` klonuje cały obiekt na wątku głównym (ok. 3 s dla ok. 400 tys.
// obiektów na telefonie z CPU ×4); `setData(url)` każe MapLibre pobrać i sparsować dane w jego
// własnym workerze (w MapLibre 6 `setData(string)` to URL, a `blob:` przechodzi przez zwykły fetch).
import type { GeoJSONSource, Map as MapLibre, MapSourceDataEvent } from 'maplibre-gl'
import { kolekcjaZWartosciami, type Otoczka, zbudujOtoczke } from './geometria.ts'
import type { DoWorkera, ZWorkera } from './geometriaWorker.ts'
import { KolejkaZlecen } from './kolejkaZlecen.ts'

interface ZlecenieHeksow {
  klucze: string[]
  w: Float64Array
}

/**
 * Dwa workery, bo jeden liczył zlecenia szeregowo: heksy bieżącego miasta (r10) czekały za tłem 24
 * miast (setki tysięcy `cellToBoundary` + `JSON.stringify`) i mgłą, a pierwszy kolor padał po 11,8 s
 * przy 1,65 s do załadowania kompaktu. Kanał 0 to wyłącznie bieżące miasto, kanał 1 tło i mgła, i
 * rusza dopiero po `otworzTlo()` (pierwszy kolor). Priorytet w kanale: r10 < r9 < r8 < tło < mgła.
 */
const KANAL_MIASTA = 0
const KANAL_TLA = 1
const PRIORYTET_MGLY = 5
const PRIORYTETY: Record<string, number> = {
  'heksy-r10': 0,
  'heksy-r9': 1,
  'heksy-r8': 2,
  'tlo-r9': 3,
  'tlo-r8': 4,
}
const priorytetZrodla = (zrodlo: string) => PRIORYTETY[zrodlo] ?? 3
const kanalZrodla = (zrodlo: string) => (zrodlo.startsWith('heksy-') ? KANAL_MIASTA : KANAL_TLA)

/** Po tym czasie tło rusza także bez pierwszego koloru bieżącego miasta. */
const ZAPAS_OTWARCIA_TLA_MS = 8000

export class DostawcaGeoJson {
  private readonly workery: (Worker | null)[] = [null, null]
  private readonly kolejki = [new KolejkaZlecen<DoWorkera>(), new KolejkaZlecen<DoWorkera>()]
  private readonly zajete = [false, false]
  private tloOtwarte = false
  /** Zbiór r8 mgły, której wynik jeszcze nie wrócił (zapas, gdy worker padnie). */
  private mglaR8: string[] | null = null
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
    // Zapas: miasto bez heksów (albo zerwany pierwszy kolor) nie może wstrzymać tła i mgły na zawsze.
    setTimeout(() => this.otworzTlo(), ZAPAS_OTWARCIA_TLA_MS)
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
    if (!this.mozeWorker()) return this.zastosujSynchronicznie(zrodlo, zlecenie)
    this.wTrakcie.set(zrodlo, zlecenie)
    const wiadomosc: DoWorkera = { rodzaj: 'heksy', id, zrodlo, klucze, w }
    // Zlecenie tego samego źródła zastępuje oczekujące (worker go nie zaczął, więc nie liczy starego).
    // Bez przekazania bufora: kopia ok. 200 KB jest tania, a zlecenie zostaje w `wTrakcie` na zapas.
    const k = kanalZrodla(zrodlo)
    this.kolejki[k]?.ustaw(zrodlo, priorytetZrodla(zrodlo), wiadomosc)
    this.pompuj(k)
  }

  /** Odblokowuje kanał tła i mgły – wołać po pierwszym kolorze bieżącego miasta. Idempotentne. */
  otworzTlo() {
    if (this.tloOtwarte) return
    this.tloOtwarte = true
    this.pompuj(KANAL_TLA)
  }

  /** Mgła z r8: worker, a bez niego wynik od ręki z wątku głównego. `fn` dostaje tylko aktualny wynik. */
  mgla(r8: string[], fn: (o: Otoczka) => void) {
    this.obslugaMgly = fn
    const id = ++this.nrMgly
    if (!this.mozeWorker()) return fn(zbudujOtoczke(r8))
    this.mglaR8 = r8
    this.kolejki[KANAL_TLA]?.ustaw('mgla', PRIORYTET_MGLY, { rodzaj: 'mgla', id, r8 })
    this.pompuj(KANAL_TLA)
  }

  /** Unieważnia oczekującą mgłę (wynik z workera zostanie odrzucony). */
  anulujMgle() {
    this.nrMgly++
  }

  zniszcz() {
    this.zniszczony = true
    this.mapa.off('sourcedata', this.nasluch)
    this.zatrzymajWorkery()
    for (const lista of this.urle.values()) for (const u of lista) URL.revokeObjectURL(u)
    this.urle.clear()
    this.poZaladowaniu.clear()
    this.wTrakcie.clear()
    this.zastosowane.clear()
  }

  private mozeWorker(): boolean {
    return !this.blad && !this.zniszczony && typeof Worker !== 'undefined'
  }

  private zatrzymajWorkery() {
    for (const w of this.workery) w?.terminate()
    this.workery.fill(null)
    for (const k of this.kolejki) while (k.nastepne());
  }

  /** Wysyła następne zlecenie kanału, gdy worker jest wolny (kanał tła czeka na pierwszy kolor). */
  private pompuj(k: number) {
    if (this.zajete[k] || this.zniszczony || (k === KANAL_TLA && !this.tloOtwarte)) return
    const nastepne = this.kolejki[k]?.nastepne()
    if (!nastepne) return
    let worker = this.workery[k] ?? null
    if (!worker) {
      try {
        worker = new Worker(new URL('./geometriaWorker.ts', import.meta.url), { type: 'module' })
        worker.onmessage = (e: MessageEvent<ZWorkera>) => {
          this.zajete[k] = false
          this.przyWyniku(e.data)
          this.pompuj(k)
        }
        worker.onerror = () => this.przyBledzie()
        this.workery[k] = worker
      } catch {
        return this.przyBledzie()
      }
    }
    this.zajete[k] = true
    worker.postMessage(nastepne.zlecenie)
  }

  private przyWyniku(odp: ZWorkera) {
    if (this.zniszczony) return
    if (odp.rodzaj === 'mgla') {
      // Wynik starszy niż ostatnie zlecenie odpowiada już nieaktualnemu zbiorowi miast.
      if (odp.id === this.nrMgly) {
        this.mglaR8 = null
        this.obslugaMgly?.(odp.otoczka)
      }
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
    this.zatrzymajWorkery()
    this.zajete.fill(false)
    for (const [zrodlo, zlecenie] of [...this.wTrakcie])
      this.zastosujSynchronicznie(zrodlo, zlecenie)
    // Mgła czekająca w workerze albo w kolejce: zapas na wątku głównym.
    const r8 = this.mglaR8
    this.mglaR8 = null
    if (r8) this.obslugaMgly?.(zbudujOtoczke(r8))
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
