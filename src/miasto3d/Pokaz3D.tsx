// Link do prezentacji (`?pokaz` albo `?pokaz=<id adresu>`): pełny ekran „Okolicy w 3D”
// z lotem Polska → adres (burza E5, 12d; decyzja #130). Strona główna zostaje bez zmian.
// Lekki moduł – scenę z deck.gl ładuje leniwie.
import { lazy, Suspense, useEffect } from 'react'
import { opisAdresu } from '@/karta/adres'
import { KOLORY_ETYKIETY, type LiteraEtykiety } from '@/karta/okolica/kolory'
import type { Adres } from '@/kontrakty'
import { useDane } from '@/wynik/dane'
import { useWynikAdresu } from '@/wynik/useWyniki'
import { odlegloscM } from './laczenie'

const Okolica3D = lazy(() => import('./Okolica3D'))

/** Rynek Główny 3 (Sukiennice) – adres pokazu, gdy link nie podaje własnego. */
const ADRES_DOMYSLNY = 'msip-2147483674266'
const RYNEK: [number, number] = [19.937562, 50.061713]

export function parametrPokazu(): string | null {
  try {
    return new URLSearchParams(window.location.search).get('pokaz')
  } catch {
    return null
  }
}

function adresPokazu(adresy: Adres[], id: string): Adres | null {
  const z = adresy.find((a) => a.id === (id || ADRES_DOMYSLNY))
  if (z) return z
  // Id z linku nie istnieje (inna wersja danych) – najbliższy adres Rynku zamiast pustego ekranu.
  let najblizszy: Adres | null = null
  let min = Infinity
  for (const a of adresy) {
    const d = odlegloscM(RYNEK[0], RYNEK[1], a.lon, a.lat)
    if (d < min) {
      min = d
      najblizszy = a
    }
  }
  return najblizszy
}

export function Pokaz3D({ id }: { id: string }) {
  const dane = useDane()
  const adres = dane.stan === 'gotowe' ? adresPokazu(dane.adresy, id) : null
  const wynik = useWynikAdresu(adres?.i ?? null)
  const nazwa = adres ? opisAdresu(adres) : ''

  useEffect(() => {
    document.title = nazwa ? `${nazwa} w 3D – adresscore` : 'adresscore'
  }, [nazwa])

  if (dane.stan === 'blad') {
    return (
      <p role="alert" className="komunikat">
        Nie udało się wczytać danych: {dane.blad}
      </p>
    )
  }
  if (!adres) return <div className="m3d-pokaz m3d-zaslepka">Wczytuję dane…</div>

  const litera = wynik?.litera as LiteraEtykiety | null | undefined
  const kolory = litera ? KOLORY_ETYKIETY[litera] : null
  const bezPokazu = `${window.location.pathname}#/adres/${adres.id}`

  return (
    <main className="m3d-pokaz-ekran">
      <Suspense fallback={<div className="m3d-pokaz m3d-zaslepka">Wczytuję widok 3D…</div>}>
        <Okolica3D
          adresI={adres.i}
          pokaz
          naglowek={
            <header className="m3d-pokaz-glowa">
              <h1 className="m3d-pokaz-h1">{nazwa}</h1>
              <p className="m3d-pokaz-wynik">
                {kolory && litera ? (
                  <span
                    className="m3d-pokaz-litera"
                    style={{ background: kolory.tlo, color: kolory.tekst }}
                  >
                    {litera}
                  </span>
                ) : (
                  <span className="m3d-pokaz-litera m3d-pokaz-brak">–</span>
                )}
                {wynik?.wynik == null
                  ? 'brak danych o wyniku'
                  : `wynik ${Math.round(wynik.wynik)} na 100`}
              </p>
              <p className="m3d-pokaz-linki">
                <a href={bezPokazu}>Pełna karta adresu</a>
                <a href={window.location.pathname}>Wyjdź z pokazu</a>
              </p>
            </header>
          }
        />
      </Suspense>
    </main>
  )
}
