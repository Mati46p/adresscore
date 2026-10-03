// Okolica adresu w 3D: MapLibre (ten sam podkład co mapa) + deck.gl nałożony w tej samej
// kamerze. Ciężki moduł – ładuje go leniwie Sekcja3D, dopiero gdy sekcja jest na ekranie.
// Cień od słońca (#21): światło z PanelCienia, efekt deck.gl odtwarzany przy zmianie czasu.
import {
  AmbientLight,
  DirectionalLight,
  LightingEffect,
  type PickingInfo,
  _SunLight as SunLight,
} from '@deck.gl/core'
import { PathLayer, SolidPolygonLayer } from '@deck.gl/layers'
import { MapboxOverlay } from '@deck.gl/mapbox'
import { AttributionControl, Map as MapaLibre, NavigationControl } from 'maplibre-gl'
import { useEffect, useRef, useState } from 'react'
import { POLSKIE_NAPISY, STYL } from '@/mapa/MapaKrakowa'
import { useDane } from '@/wynik/dane'
import { useStan } from '@/wynik/stan'
import { policzWyniki } from '@/wynik/useWyniki'
import { type BudynkiOkolicy, wczytajBudynkiWokol } from './kontrakt'
import {
  type BudynekOkolicy,
  budynekAdresu,
  budynkiOkolicy,
  kolorBudynku,
  naRgba,
  odmiana,
  wysokoscBryly,
} from './laczenie'
import './miasto3d.css'
import { PanelCienia, type Swiatlo, useSwiatlo } from './PanelCienia'
import { dymekPozwolenia, PanelPozwolen, usePozwolenia, warstwaPozwolen } from './Pozwolenia3D'
import type { Pozwolenie } from './pozwolenia'

const AKCENT = naRgba('#1F5C46')
const NAPISY = {
  ...POLSKIE_NAPISY,
  'CooperativeGesturesHandler.WindowsHelpText': 'Użyj Ctrl + kółko, żeby przybliżyć mapę',
  'CooperativeGesturesHandler.MacHelpText': 'Użyj ⌘ + kółko, żeby przybliżyć mapę',
  'CooperativeGesturesHandler.MobileHelpText': 'Przesuwaj mapę dwoma palcami',
}
const BIEL = naRgba('#FFFFFF')
const ADRESY = ['adres', 'adresy', 'adresów'] as const

// Stałe światło trybu lekkiego (telefon, cień wyłączony bezpiecznikiem): rozproszone +
// kierunkowe z południowego zachodu, żeby ściany różniły się jasnością i bryły czytały się
// jako bryły, a nie płaskie plamy.
const SWIATLO_STALE = new LightingEffect({
  otoczenie: new AmbientLight({ color: [255, 255, 255], intensity: 1.6 }),
  kierunkowe: new DirectionalLight({
    color: [255, 255, 255],
    intensity: 1.2,
    direction: [1, 2, -3],
  }),
})

/** Światło od słońca o wybranej chwili; w nocy tylko przygaszone rozproszone. */
function efektSwiatla(s: Swiatlo | null): LightingEffect {
  if (!s) return SWIATLO_STALE
  if (s.noc) {
    return new LightingEffect({
      otoczenie: new AmbientLight({ color: [200, 210, 235], intensity: 1.1 }),
    })
  }
  const efekt = new LightingEffect({
    otoczenie: new AmbientLight({ color: [255, 255, 255], intensity: 1.2 }),
    slonce: new SunLight({
      timestamp: s.znacznik,
      color: [255, 250, 235],
      intensity: 1.35,
      _shadow: s.cien,
    }),
  })
  efekt.shadowColor = [0, 0, 0, 0.35]
  return efekt
}

/** Kwadrat ok. 1,4 km wokół adresu: przezroczysta ziemia, na którą padają cienie. */
function ziemia(lon: number, lat: number): [number, number][] {
  const dLat = 700 / 111_320
  const dLon = dLat / Math.cos(lat * (Math.PI / 180))
  return [
    [lon - dLon, lat - dLat],
    [lon + dLon, lat - dLat],
    [lon + dLon, lat + dLat],
    [lon - dLon, lat + dLat],
  ]
}

type Stan =
  | { stan: 'ladowanie' }
  | { stan: 'gotowe'; dane: BudynkiOkolicy }
  | { stan: 'blad'; blad: string }

export default function Okolica3D() {
  const dane = useDane()
  const wybrany = useStan((s) => s.wybrany)
  const wagi = useStan((s) => s.wagi)
  const kierunki = useStan((s) => s.kierunki)
  const adres = dane.stan === 'gotowe' && wybrany !== null ? dane.adresy[wybrany] : null
  const lon = adres?.lon ?? null
  const lat = adres?.lat ?? null

  const [budynkiStan, setBudynkiStan] = useState<Stan>({ stan: 'ladowanie' })
  useEffect(() => {
    if (lon === null || lat === null) return
    let aktualne = true
    setBudynkiStan({ stan: 'ladowanie' })
    wczytajBudynkiWokol(lon, lat).then(
      (d) => aktualne && setBudynkiStan({ stan: 'gotowe', dane: d }),
      (e) => aktualne && setBudynkiStan({ stan: 'blad', blad: String(e) }),
    )
    return () => {
      aktualne = false
    }
  }, [lon, lat])

  const budynki =
    dane.stan === 'gotowe' && adres && budynkiStan.stan === 'gotowe'
      ? budynkiOkolicy(
          budynkiStan.dane.budynki,
          dane.adresy,
          policzWyniki(dane, wagi, kierunki, 'wynik').naAdres,
          adres.lon,
          adres.lat,
        )
      : []
  const wybranyBudynek = adres ? budynekAdresu(budynki, adres) : null
  const swiatlo = useSwiatlo(lon ?? 0, lat ?? 0)
  const pozwolenia = usePozwolenia(lon, lat)
  const [pokazPozwolenia, setPokazPozwolenia] = useState(true)
  const zrodlaPozwolen =
    dane.stan === 'gotowe'
      ? (dane.manifest.wskazniki.find((w) => w.id === 'inwestycje_500m')?.zrodla ?? [])
      : []

  if (!adres || lon === null || lat === null) return null

  const brakDanych = budynkiStan.stan === 'gotowe' && budynki.length === 0
  const zWynikiem = budynki.filter((b) => b.wynik !== null).length

  return (
    <div className="m3d">
      <Scena
        lon={lon}
        lat={lat}
        budynki={budynki}
        wybrany={wybranyBudynek}
        swiatlo={swiatlo.swiatlo}
        pozwolenia={pokazPozwolenia && pozwolenia.stan === 'gotowe' ? pozwolenia.lista : []}
      />
      {budynki.length > 0 && <PanelCienia {...swiatlo} />}
      <PanelPozwolen
        stan={pozwolenia}
        widoczne={pokazPozwolenia}
        onPrzelacz={setPokazPozwolenia}
        zrodla={zrodlaPozwolen}
      />
      {budynkiStan.stan === 'ladowanie' && <p className="m3d-komunikat">Wczytuję budynki…</p>}
      {budynkiStan.stan === 'blad' && (
        <p className="m3d-komunikat">Nie udało się wczytać budynków. Spróbuj odświeżyć stronę.</p>
      )}
      {brakDanych && (
        <p className="m3d-komunikat">
          Budynki 3D dla tej okolicy są w przygotowaniu. Wynik adresu nie zależy od tej sekcji.
        </p>
      )}
      {budynki.length > 0 && (
        <Opis
          budynki={budynki.length}
          zWynikiem={zWynikiem}
          wybrany={wybranyBudynek}
          zrodla={budynkiStan.stan === 'gotowe' ? budynkiStan.dane.zrodla : []}
        />
      )}
    </div>
  )
}

function Scena({
  lon,
  lat,
  budynki,
  wybrany,
  swiatlo,
  pozwolenia,
}: {
  lon: number
  lat: number
  budynki: BudynekOkolicy[]
  wybrany: BudynekOkolicy | null
  /** null = tryb lekki: stałe światło, bez cienia. */
  swiatlo: Swiatlo | null
  pozwolenia: Pozwolenie[]
}) {
  const kontener = useRef<HTMLDivElement>(null)
  const mapaRef = useRef<MapaLibre | null>(null)
  const nakladkaRef = useRef<MapboxOverlay | null>(null)

  // Mapa raz na montowanie; zmiana adresu przesuwa kamerę, nie tworzy mapy od nowa.
  useEffect(() => {
    if (!kontener.current) return
    const mapa = new MapaLibre({
      container: kontener.current,
      style: STYL,
      center: [lon, lat],
      zoom: 16.4,
      pitch: 55,
      bearing: -20,
      maxPitch: 70,
      attributionControl: false,
      locale: NAPISY,
      // Karta przewija się kółkiem; mapa przejmuje kółko dopiero z Ctrl, na dotyku dwoma palcami.
      cooperativeGestures: true,
    })
    mapa.addControl(new AttributionControl({ compact: true }), 'bottom-right')
    mapa.addControl(new NavigationControl({ visualizePitch: true }), 'top-right')
    const nakladka = new MapboxOverlay({ interleaved: false, layers: [] })
    mapa.addControl(nakladka)
    mapaRef.current = mapa
    nakladkaRef.current = nakladka
    return () => {
      nakladkaRef.current = null
      mapaRef.current = null
      mapa.remove()
    }
  }, [])

  useEffect(() => {
    mapaRef.current?.jumpTo({ center: [lon, lat] })
  }, [lon, lat])

  const cien = swiatlo?.cien === true && !swiatlo.noc
  useEffect(() => {
    nakladkaRef.current?.setProps({
      layers: [
        // Ziemia tylko przy cieniu: bez niej cienie nie mają na co paść (podkład to MapLibre).
        ...(cien
          ? [
              new SolidPolygonLayer<[number, number][]>({
                id: 'ziemia',
                data: [ziemia(lon, lat)],
                getPolygon: (p) => p,
                getFillColor: [0, 0, 0, 0],
              }),
            ]
          : []),
        ...warstwy(budynki, wybrany),
        ...(pozwolenia.length > 0 ? [warstwaPozwolen(pozwolenia)] : []),
      ],
      getTooltip: dymek,
    })
  }, [budynki, wybrany, cien, lon, lat, pozwolenia])

  // Efekt odtwarzany przy każdej zmianie czasu: deck nie przerysowuje sceny, gdy zmienia się
  // tylko znacznik wewnątrz istniejącego światła.
  const znacznik = swiatlo?.znacznik
  const noc = swiatlo?.noc
  const zSlonca = swiatlo !== null
  useEffect(() => {
    const efekt = efektSwiatla(
      zSlonca && znacznik !== undefined ? { znacznik, cien, noc: noc === true } : null,
    )
    nakladkaRef.current?.setProps({ effects: [efekt] })
  }, [zSlonca, znacznik, cien, noc])

  return (
    <div
      ref={kontener}
      className="m3d-mapa"
      role="img"
      aria-label="Budynki w promieniu 500 m od adresu w kolorze wyniku. Opis tekstowy pod mapą."
    />
  )
}

function warstwy(budynki: BudynekOkolicy[], wybrany: BudynekOkolicy | null) {
  const jestWybrany = wybrany !== null
  return [
    new SolidPolygonLayer<BudynekOkolicy>({
      id: 'budynki',
      data: budynki,
      extruded: true,
      getPolygon: (b) => b.obrys,
      getElevation: wysokoscBryly,
      getFillColor: (b) =>
        kolorBudynku(b.litera, b === wybrany ? 'wybrany' : jestWybrany ? 'przygaszony' : 'zwykly'),
      material: { ambient: 0.45, diffuse: 0.6, shininess: 8, specularColor: [40, 40, 40] },
      pickable: true,
      autoHighlight: true,
      highlightColor: [255, 255, 255, 70],
      updateTriggers: { getFillColor: [wybrany?.id] },
    }),
    // Obrys wybranego budynku na wysokości dachu: biała obwódka pod akcentem, żeby akcent
    // był widoczny także na ciemnozielonej bryle klasy A.
    ...(wybrany
      ? [BIEL, AKCENT].map(
          (kolor, n) =>
            new PathLayer<BudynekOkolicy>({
              id: `wybrany-obrys-${n}`,
              data: [wybrany],
              getPath: (b) => {
                const h = wysokoscBryly(b) + 0.3
                const pierscien = b.obrys.map(([x, y]) => [x, y, h] as [number, number, number])
                const pierwszy = pierscien[0]
                return pierwszy ? [...pierscien, pierwszy] : pierscien
              },
              getColor: kolor,
              getWidth: n === 0 ? 6 : 3,
              widthUnits: 'pixels',
              jointRounded: true,
            }),
        )
      : []),
  ]
}

function dymek({ object, layer }: PickingInfo<BudynekOkolicy | Pozwolenie>) {
  if (!object) return null
  if (layer?.id === 'pozwolenia') {
    return { text: dymekPozwolenia(object as Pozwolenie), className: 'm3d-dymek' }
  }
  return dymekBudynku(object as BudynekOkolicy)
}

function dymekBudynku(object: BudynekOkolicy) {
  const wynik =
    object.wynik === null
      ? object.adresy.length === 0
        ? 'budynek bez adresu'
        : 'brak danych o wyniku'
      : `klasa ${object.litera}, wynik ${Math.round(object.wynik)}`
  const adresy = object.adresy.length > 1 ? ` · ${odmiana(object.adresy.length, ADRESY)}` : ''
  return { text: `${wynik}${adresy}\n${opisWysokosci(object)}`, className: 'm3d-dymek' }
}

function opisWysokosci(b: BudynekOkolicy): string {
  if (b.wysokosc === null) return 'wysokość nieznana'
  const m = Math.round(b.wysokosc)
  return b.zrodloWysokosci === 'kondygnacje'
    ? `ok. ${m} m (z liczby kondygnacji)`
    : `${m} m (pomiar lotniczy)`
}

function Opis({
  budynki,
  zWynikiem,
  wybrany,
  zrodla,
}: {
  budynki: number
  zWynikiem: number
  wybrany: BudynekOkolicy | null
  zrodla: BudynkiOkolicy['zrodla']
}) {
  return (
    <div className="m3d-opis">
      <p>
        {odmiana(budynki, ['budynek', 'budynki', 'budynków'])} w promieniu 500 m, {zWynikiem} z
        wynikiem adresu. Kolor bryły to klasa A–G średniej z adresów w budynku. Szare bryły nie mają
        adresu albo danych – to nie zła ocena.
        {wybrany && ` Twój budynek: ${opisWysokosci(wybrany)}.`}
      </p>
      {zrodla.length > 0 && (
        <p className="m3d-zrodla">
          Budynki:{' '}
          {zrodla.map((z, n) => (
            <span key={z.url}>
              {n > 0 && ', '}
              <a href={z.url} target="_blank" rel="noreferrer">
                {z.nazwa}
              </a>{' '}
              (stan danych: {z.dataDanych}; {z.licencja})
            </span>
          ))}
          .
        </p>
      )}
    </div>
  )
}
