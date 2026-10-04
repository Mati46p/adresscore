// Okolica wybrana w wyszukiwarce na mapie (#185): obrys jednostki SIM i przelot kamery do jej granic.
// Tylko propsy – co pokazać, mówi `OkolicaNaMapie` z `granice.ts`; tu wyłącznie rysowanie i lot.
//
// - Nowy obiekt `okolica` = nowy wybór = przelot, także gdy to ta sama okolica co poprzednio (użytkownik
//   mógł odjechać). Dlatego lot zależy od tożsamości obiektu, nie od liczb ramki jak `granice` w MapaKrakowa.
// - `okolica` null albo bez obrysu (miejscowość) = brak linii na mapie; sam przelot zostaje.
// - Linia ma białą poświatę pod ciemnym obrysem, żeby była czytelna na każdym kolorze heksu i podkładu.
import type { GeoJSONSource, Map as MapaLibre } from 'maplibre-gl'
import { type RefObject, useEffect, useRef } from 'react'
import { lec } from '../lot.ts'
import { przeniesNazwyNaWierzch } from '../podklad.ts'
import type { OkolicaNaMapie } from './granice.ts'

const ZRODLO = 'okolica-obrys'
const WARSTWA_POSWIATY = `${ZRODLO}-poswiata`
/** Ciemny granat tekstu aplikacji (`--tekst`): ten sam kolor ma obrys „błysku” heksów. */
const KOLOR_OBRYSU = '#18202B'
const pusty = (): GeoJSON.FeatureCollection => ({ type: 'FeatureCollection', features: [] })

function dodajWarstwy(mapa: MapaLibre) {
  if (mapa.getSource(ZRODLO)) return
  mapa.addSource(ZRODLO, { type: 'geojson', data: pusty() })
  mapa.addLayer({
    id: WARSTWA_POSWIATY,
    type: 'line',
    source: ZRODLO,
    layout: { 'line-join': 'round' },
    paint: { 'line-color': '#FFFFFF', 'line-width': 6, 'line-opacity': 0.85, 'line-blur': 0.5 },
  })
  mapa.addLayer({
    id: ZRODLO,
    type: 'line',
    source: ZRODLO,
    layout: { 'line-join': 'round' },
    paint: { 'line-color': KOLOR_OBRYSU, 'line-width': 2.5 },
  })
  // Nazwy ulic i dzielnic zostają czytelne nad obrysem.
  przeniesNazwyNaWierzch(mapa)
}

/**
 * Rysuje obrys i leci do okolicy na mapie z `mapaRef`, gdy `gotowa` (po `load`). Wołana raz z `MapaKrakowa`.
 * `przedLotem` biegnie tuż przed przelotem (mapa kończy w nim intro, jak przy `granice`).
 */
export function useObrysOkolicy(
  mapaRef: RefObject<MapaLibre | null>,
  gotowa: boolean,
  okolica: OkolicaNaMapie | null | undefined,
  przedLotem: () => void,
): void {
  const przedLotemRef = useRef(przedLotem)
  useEffect(() => {
    przedLotemRef.current = przedLotem
  })

  const obrys = okolica?.obrys ?? null
  useEffect(() => {
    const mapa = mapaRef.current
    if (!mapa || !gotowa) return
    dodajWarstwy(mapa)
    mapa
      .getSource<GeoJSONSource>(ZRODLO)
      ?.setData(obrys ? { type: 'FeatureCollection', features: [obrys] } : pusty())
  }, [mapaRef, gotowa, obrys])

  useEffect(() => {
    const mapa = mapaRef.current
    if (!mapa || !gotowa || !okolica) return
    przedLotemRef.current()
    const kamera = mapa.cameraForBounds(okolica.granice, { padding: 48, maxZoom: 16 })
    if (kamera) void lec(mapa, kamera)
  }, [mapaRef, gotowa, okolica])
}
