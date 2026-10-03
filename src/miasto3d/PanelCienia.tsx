// Cień od słońca (#21): suwaki godziny i dnia roku + skróty. Telefon dostaje bryły bez cienia
// i bez suwaków (burza E5, 17c), a każde urządzenie – bezpiecznik, który wyłącza cień, gdy
// klatki spadają poniżej ~30 na sekundę podczas ruchu suwaka.
import { useRef, useState } from 'react'
import {
  type ChwilaLokalna,
  chwilaLokalna,
  dzienRoku,
  klatkiZaWolne,
  liczbaDniRoku,
  opisDnia,
  opisGodziny,
  wysokoscSlonca,
  znacznikCzasu,
} from './slonce'

export interface Swiatlo {
  /** Chwila w UTC (ms) dla `_SunLight`. */
  znacznik: number
  cien: boolean
  /** Słońce pod horyzontem: bez słońca i bez cienia. */
  noc: boolean
}

type Skrot = 'teraz' | 'lato' | 'zima'

// 14:00, nie 16:00: 21 grudnia słońce zachodzi w Krakowie ok. 15:40, więc o 16:00 cienia nie ma.
const SKROTY: { id: Skrot; nazwa: string; chwila: (rok: number) => ChwilaLokalna }[] = [
  { id: 'teraz', nazwa: 'Teraz', chwila: () => chwilaLokalna(Date.now()) },
  {
    id: 'lato',
    nazwa: '21 czerwca, 14:00',
    chwila: (rok) => ({ rok, dzien: dzienRoku(rok, 6, 21), minuta: 14 * 60 }),
  },
  {
    id: 'zima',
    nazwa: '21 grudnia, 14:00',
    chwila: (rok) => ({ rok, dzien: dzienRoku(rok, 12, 21), minuta: 14 * 60 }),
  },
]

const PROBKA_MS = 1000

export function useSwiatlo(lon: number, lat: number) {
  const [lekki] = useState(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia('(pointer: coarse), (max-width: 860px)').matches,
  )
  const [chwila, setChwila] = useState(() => chwilaLokalna(Date.now()))
  const [skrot, setSkrot] = useState<Skrot | null>('teraz')
  const [wylaczony, setWylaczony] = useState(false)
  const probka = useRef<{ odstepy: number[]; koniec: number; ostatnia: number } | null>(null)

  const znacznik = znacznikCzasu(chwila.rok, chwila.dzien, chwila.minuta)
  const wysokosc = wysokoscSlonca(znacznik, lat, lon)
  const swiatlo: Swiatlo | null = lekki ? null : { znacznik, cien: !wylaczony, noc: wysokosc <= 0 }

  // Odstępy między klatkami przez sekundę po zmianie czasu; tylko gdy cień jest włączony.
  function probkuj() {
    if (lekki || wylaczony || probka.current) return
    const start = performance.now()
    probka.current = { odstepy: [], koniec: start + PROBKA_MS, ostatnia: start }
    const klatka = (t: number) => {
      const p = probka.current
      if (!p) return
      p.odstepy.push(t - p.ostatnia)
      p.ostatnia = t
      if (t < p.koniec) {
        requestAnimationFrame(klatka)
        return
      }
      probka.current = null
      if (klatkiZaWolne(p.odstepy)) setWylaczony(true)
    }
    requestAnimationFrame(klatka)
  }

  function ustaw(nowa: ChwilaLokalna, nowySkrot: Skrot | null) {
    setChwila(nowa)
    setSkrot(nowySkrot)
    probkuj()
  }

  return { swiatlo, lekki, chwila, skrot, ustaw, wysokosc, wylaczony }
}

export function PanelCienia({
  lekki,
  chwila,
  skrot,
  ustaw,
  wysokosc,
  wylaczony,
}: ReturnType<typeof useSwiatlo>) {
  if (lekki) {
    return (
      <p className="m3d-komunikat">
        Cień od słońca o wybranej porze dnia i roku pokazujemy na komputerze.
      </p>
    )
  }
  const dni = liczbaDniRoku(chwila.rok)
  const godzina = opisGodziny(chwila.minuta)
  const dzien = opisDnia(chwila.rok, chwila.dzien)
  return (
    <fieldset className="m3d-cien">
      <legend className="m3d-cien-tytul">Cień o wybranej porze</legend>
      <div className="m3d-cien-skroty">
        {SKROTY.map((s) => (
          <button
            key={s.id}
            type="button"
            className="seg"
            aria-pressed={skrot === s.id}
            onClick={() => ustaw(s.chwila(chwila.rok), s.id)}
          >
            {s.nazwa}
          </button>
        ))}
      </div>
      <label className="m3d-suwak">
        <span>
          Godzina <output className="mono">{godzina}</output>
        </span>
        <input
          type="range"
          min={0}
          max={1435}
          step={5}
          value={chwila.minuta}
          aria-valuetext={godzina}
          onChange={(e) => ustaw({ ...chwila, minuta: Number(e.target.value) }, null)}
        />
      </label>
      <label className="m3d-suwak">
        <span>
          Dzień <output className="mono">{dzien}</output>
        </span>
        <input
          type="range"
          min={1}
          max={dni}
          step={1}
          value={chwila.dzien}
          aria-valuetext={dzien}
          onChange={(e) => ustaw({ ...chwila, dzien: Number(e.target.value) }, null)}
        />
      </label>
      <p className="m3d-cien-stan">
        {wysokosc <= 0
          ? `${dzien}, ${godzina}: słońce pod horyzontem, cienia nie ma.`
          : `${dzien}, ${godzina}: słońce ${Math.round(wysokosc)}° nad horyzontem.`}
        {wylaczony &&
          ' Cień wyłączony – to urządzenie nie nadąża z jego liczeniem. Bryły i kolory zostają.'}
      </p>
    </fieldset>
  )
}
