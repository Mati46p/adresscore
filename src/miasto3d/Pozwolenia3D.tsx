// „Co powstanie obok” (#31): pozwolenia na budowę jako słupki w miejscu działek.
// Słupek ma stałą wysokość – to znak miejsca, nie wysokość przyszłego budynku (tej nie ma
// w rejestrze), i mówi to legenda.
import { ColumnLayer } from '@deck.gl/layers'
import { useEffect, useState } from 'react'
import type { Zrodlo } from '@/kontrakty'
import { odmiana } from './laczenie'
import {
  GRUPY,
  type GrupaPozwolenia,
  grupa,
  liczbyGrup,
  opisDaty,
  type Pozwolenie,
  pozwoleniaWokol,
  zGeojson,
} from './pozwolenia'

/** Wyżej niż typowa kamienica (ok. 20 m), żeby słupek było widać zza dachów. */
const WYSOKOSC_ZNAKU_M = 35

let wszystkie: Promise<Pozwolenie[]> | null = null

function wczytaj(): Promise<Pozwolenie[]> {
  wszystkie ??= fetch(`${import.meta.env.BASE_URL}dane/pozwolenia.geojson`)
    .then((r) => {
      if (!r.ok) throw new Error(`pozwolenia.geojson: ${r.status}`)
      return r.json()
    })
    .then(zGeojson)
    .catch((e) => {
      // Następna karta spróbuje jeszcze raz.
      wszystkie = null
      throw e
    })
  return wszystkie
}

export type StanPozwolen =
  | { stan: 'ladowanie' }
  | { stan: 'gotowe'; lista: Pozwolenie[] }
  | { stan: 'blad' }

export function usePozwolenia(lon: number | null, lat: number | null): StanPozwolen {
  const [stan, setStan] = useState<StanPozwolen>({ stan: 'ladowanie' })
  useEffect(() => {
    if (lon === null || lat === null) return
    let aktualne = true
    wczytaj().then(
      (w) => aktualne && setStan({ stan: 'gotowe', lista: pozwoleniaWokol(w, lon, lat) }),
      () => aktualne && setStan({ stan: 'blad' }),
    )
    return () => {
      aktualne = false
    }
  }, [lon, lat])
  return stan
}

export function warstwaPozwolen(lista: Pozwolenie[]) {
  return new ColumnLayer<Pozwolenie>({
    id: 'pozwolenia',
    data: lista,
    getPosition: (p) => [p.lon, p.lat],
    getElevation: WYSOKOSC_ZNAKU_M,
    radius: 2.5,
    diskResolution: 12,
    extruded: true,
    getFillColor: (p) => GRUPY[grupa(p.rodzaj)].kolor,
    // Znak, nie budynek: nie rzuca cienia na okolicę. ShadowPass czyta `shadowEnabled`,
    // ale typy ColumnLayer 9.4 go nie znają – stąd rozwinięcie zamiast zwykłego pola.
    ...({ shadowEnabled: false } as Record<string, unknown>),
    pickable: true,
    autoHighlight: true,
    highlightColor: [255, 255, 255, 110],
  })
}

export function dymekPozwolenia(p: Pozwolenie): string {
  const opis = p.opis ? `\n${p.opis}` : ''
  return `Pozwolenie na budowę: ${p.rodzaj}, ${p.zakres}\ndecyzja ${opisDaty(p.data)}${opis}`
}

export function PanelPozwolen({
  stan,
  widoczne,
  onPrzelacz,
  zrodla,
}: {
  stan: StanPozwolen
  /** Źródła warstwy inwestycje_500m z manifestu – ten sam rejestr co punkty. */
  zrodla: Zrodlo[]
  widoczne: boolean
  onPrzelacz: (w: boolean) => void
}) {
  if (stan.stan === 'blad') {
    return <p className="m3d-komunikat">Nie udało się wczytać pozwoleń na budowę.</p>
  }
  if (stan.stan === 'ladowanie') return null
  const liczby = liczbyGrup(stan.lista)
  return (
    <div className="m3d-pozw">
      <label className="m3d-pozw-przelacznik">
        <input
          type="checkbox"
          checked={widoczne}
          onChange={(e) => onPrzelacz(e.target.checked)}
          disabled={stan.lista.length === 0}
        />
        <span>
          Co powstanie obok:{' '}
          {stan.lista.length === 0
            ? 'brak pozwoleń na budowę z lat 2025–2026 w promieniu 500 m'
            : `${odmiana(stan.lista.length, ['pozwolenie', 'pozwolenia', 'pozwoleń'])} na budowę z lat 2025–2026 w promieniu 500 m`}
        </span>
      </label>
      {stan.lista.length > 0 && (
        <>
          <ul className="m3d-pozw-legenda">
            {(Object.keys(GRUPY) as GrupaPozwolenia[])
              .filter((g) => liczby[g] > 0)
              .map((g) => (
                <li key={g}>
                  <span
                    className="m3d-kropka"
                    aria-hidden="true"
                    style={{ background: `rgb(${GRUPY[g].kolor.slice(0, 3).join(' ')})` }}
                  />
                  {GRUPY[g].nazwa}: {liczby[g]}
                </li>
              ))}
          </ul>
          <p className="m3d-pozw-uwaga">
            Słupek pokazuje miejsce działki, nie wysokość przyszłego budynku – rejestr pozwoleń jej
            nie podaje.
            {zrodla.map((z) => (
              <span key={z.url}>
                {' '}
                Źródło:{' '}
                <a href={z.url} target="_blank" rel="noreferrer">
                  {z.nazwa}
                </a>{' '}
                (stan danych: {z.dataDanych}).
              </span>
            ))}
          </p>
        </>
      )}
    </div>
  )
}
