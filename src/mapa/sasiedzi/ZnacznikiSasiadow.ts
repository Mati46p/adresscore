// Warstwa „Lepszego sąsiada” (#95): okrąg promienia wokół wybranego adresu i znaczniki
// kandydatów z literą. Tylko propsy – wspólny stan wyboru karty i mapy trzyma sekcja z #94.
//
// - Najechanie albo fokus → `onWybierz(k)` (k = pozycja na liście, jak na karcie z #94 – wybór
//   zostaje po zjechaniu kursora) i dymek „adres – litera X”.
// - Klik, Enter albo spacja → `onOtworz(k)` (karta kandydata). Klik nie dochodzi do mapy, więc
//   nie wybiera heksu pod znacznikiem.
// - Pusta lista albo `srodek === null` → nic nie rysujemy (sekcja zamknięta).
// - Znaczniki stoją w miejscu: bez przyciągania i powiększania pod kursorem – to cele kliknięcia.
import { type GeoJSONSource, type Map as MapaLibre, Marker, Popup } from 'maplibre-gl'
import { type RefObject, useEffect, useRef } from 'react'
import { lec } from '../lot.ts'
import { przeniesNazwyNaWierzch } from '../podklad.ts'
import {
  czyWidoczne,
  graniceOkregu,
  kluczZnacznikow,
  okragWokol,
  type SasiedziNaMapie,
  type Znacznik,
  znacznikiSasiadow,
} from './model.ts'
import './sasiedzi.css'

const ZRODLO_OKREGU = 'sasiedzi-okrag'
const KOLOR_OKREGU = '#1F5C46'
const pusty = (): GeoJSON.FeatureCollection => ({ type: 'FeatureCollection', features: [] })

/** Zdarzenia, które nie mogą dojść do mapy: inaczej klik w znacznik byłby też klikiem w mapę. */
const ZDARZENIA_TYLKO_ZNACZNIKA = [
  'mousedown',
  'mouseup',
  'click',
  'dblclick',
  'touchstart',
  'touchend',
  'pointerdown',
  'pointerup',
] as const

function dodajWarstwyOkregu(mapa: MapaLibre) {
  if (mapa.getSource(ZRODLO_OKREGU)) return
  mapa.addSource(ZRODLO_OKREGU, { type: 'geojson', data: pusty() })
  mapa.addLayer({
    id: ZRODLO_OKREGU,
    type: 'fill',
    source: ZRODLO_OKREGU,
    paint: { 'fill-color': KOLOR_OKREGU, 'fill-opacity': 0.07 },
  })
  mapa.addLayer({
    id: `${ZRODLO_OKREGU}-linia`,
    type: 'line',
    source: ZRODLO_OKREGU,
    paint: { 'line-color': KOLOR_OKREGU, 'line-width': 2, 'line-dasharray': [2, 1.5] },
  })
  // Nazwy ulic i dzielnic zostają czytelne nad okręgiem.
  przeniesNazwyNaWierzch(mapa)
}

function ustawWybor(przycisk: HTMLElement, wybrany: boolean) {
  przycisk.classList.toggle('mapa-sasiad--wybrany', wybrany)
  if (wybrany) przycisk.setAttribute('aria-current', 'true')
  else przycisk.removeAttribute('aria-current')
}

/**
 * Rysuje warstwę na mapie z `mapaRef`, gdy `gotowa` (po `load`). Wołana raz z `MapaKrakowa`;
 * `sasiedzi` undefined = warstwa wyłączona.
 */
export function useZnacznikiSasiadow(
  mapaRef: RefObject<MapaLibre | null>,
  gotowa: boolean,
  sasiedzi: SasiedziNaMapie | undefined,
): void {
  const znaczniki = znacznikiSasiadow(sasiedzi)
  const klucz = kluczZnacznikow(znaczniki)
  const wybrany = sasiedzi?.wybrany ?? null
  const znacznikiRef = useRef<Znacznik[]>(znaczniki)
  const sasiedziRef = useRef(sasiedzi)
  const przyciskiRef = useRef(new Map<number, HTMLElement>())

  useEffect(() => {
    znacznikiRef.current = znaczniki
    sasiedziRef.current = sasiedzi
  })

  const srodek = czyWidoczne(sasiedzi) ? sasiedzi?.srodek : null
  const lon = srodek?.lon ?? null
  const lat = srodek?.lat ?? null
  const promienM = sasiedzi?.promienM ?? 0

  useEffect(() => {
    const mapa = mapaRef.current
    if (!mapa || !gotowa) return
    dodajWarstwyOkregu(mapa)
    const zrodlo = mapa.getSource<GeoJSONSource>(ZRODLO_OKREGU)
    if (lon === null || lat === null || !(promienM > 0)) zrodlo?.setData(pusty())
    else zrodlo?.setData(okragWokol(lon, lat, promienM))
  }, [mapaRef, gotowa, lon, lat, promienM])

  // Przy adresie kamera stoi na zoomie ≥ 16 – na telefonie okrąg 500 m i znaczniki wychodzą poza
  // ekran. Po otwarciu sekcji oddalamy tak, żeby okrąg się zmieścił; nigdy nie przybliżamy.
  // Lot do adresu (efekt w MapaKrakowa) startuje w tym samym commicie, więc czekamy na jego koniec.
  useEffect(() => {
    const mapa = mapaRef.current
    if (!mapa || !gotowa || lon === null || lat === null || !(promienM > 0)) return
    let aktualny = true
    const dopasuj = () => {
      if (!aktualny || mapaRef.current !== mapa) return
      const granice = graniceOkregu(lon, lat, promienM)
      const widok = mapa.getBounds()
      if (widok.contains(granice[0]) && widok.contains(granice[1])) return
      const kamera = mapa.cameraForBounds(granice, { padding: 48 })
      if (kamera?.zoom === undefined || kamera.zoom >= mapa.getZoom()) return
      void lec(mapa, kamera)
    }
    const zwloka = window.setTimeout(() => {
      if (mapa.isMoving()) mapa.once('moveend', dopasuj)
      else dopasuj()
    })
    return () => {
      aktualny = false
      clearTimeout(zwloka)
      mapa.off('moveend', dopasuj)
    }
  }, [mapaRef, gotowa, lon, lat, promienM])

  // Znaczniki odtwarzamy tylko przy zmianie zbioru kandydatów (klucz), nie przy zmianie wyboru –
  // inaczej każdy fokus przebudowywałby przyciski i gubił fokus klawiatury.
  useEffect(() => {
    const mapa = mapaRef.current
    if (!mapa || !gotowa || !klucz) return
    const dymek = new Popup({
      closeButton: false,
      closeOnClick: false,
      className: 'mapa-dymek',
      anchor: 'bottom',
      offset: 26,
    })
    const przyciski = przyciskiRef.current
    const markery: Marker[] = []
    for (const z of znacznikiRef.current) {
      const przycisk = document.createElement('button')
      przycisk.type = 'button'
      przycisk.className = 'mapa-sasiad'
      przycisk.textContent = z.litera
      przycisk.style.setProperty('--sasiad-tlo', z.tlo)
      przycisk.style.setProperty('--sasiad-tekst', z.tekst)
      for (const typ of ZDARZENIA_TYLKO_ZNACZNIKA) {
        przycisk.addEventListener(typ, (e) => e.stopPropagation())
      }
      const pokaz = () => {
        dymek.setLngLat([z.lon, z.lat]).setText(z.dymek).addTo(mapa)
        sasiedziRef.current?.onWybierz(z.k)
      }
      const schowaj = () => dymek.remove()
      przycisk.addEventListener('mouseenter', pokaz)
      przycisk.addEventListener('focus', pokaz)
      przycisk.addEventListener('mouseleave', () => {
        if (document.activeElement !== przycisk) schowaj()
      })
      przycisk.addEventListener('blur', schowaj)
      przycisk.addEventListener('click', () => sasiedziRef.current?.onOtworz(z.k))

      const marker = new Marker({ element: przycisk, anchor: 'center' })
        .setLngLat([z.lon, z.lat])
        .addTo(mapa)
      // Marker nadpisuje etykietę domyślną („Map marker”) – ustawiamy naszą po utworzeniu.
      przycisk.setAttribute('aria-label', z.opis)
      ustawWybor(przycisk, z.wybrany)
      przyciski.set(z.k, przycisk)
      markery.push(marker)
    }
    return () => {
      dymek.remove()
      for (const m of markery) m.remove()
      przyciski.clear()
    }
  }, [mapaRef, gotowa, klucz])

  useEffect(() => {
    for (const [k, przycisk] of przyciskiRef.current) ustawWybor(przycisk, k === wybrany)
  }, [wybrany])
}
