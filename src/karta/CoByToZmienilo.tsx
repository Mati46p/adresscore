import { useState } from 'react'
import {
  DOMYSLNE_ZALOZENIA,
  normalizujZalozenia,
  policzScenariusze,
  type WarstwaDoDzialania,
  type ZalozeniaDzialania,
} from './dzialanie'
import './co-by-to-zmienilo.css'

export interface CoByToZmieniloProps {
  /** wynikAdresu(...).warstwy z silnika E3 */
  warstwy: readonly WarstwaDoDzialania[]
}

const liczba = new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 1 })
const kwota = new Intl.NumberFormat('pl-PL', {
  style: 'currency',
  currency: 'PLN',
  maximumFractionDigits: 0,
})

function PoleLiczbowe({
  etykieta,
  wartosc,
  min,
  max,
  krok = 1,
  jednostka,
  onChange,
}: {
  etykieta: string
  wartosc: number
  min: number
  max: number
  krok?: number
  jednostka: string
  onChange: (wartosc: number) => void
}) {
  return (
    <label className="dzialanie-pole">
      <span>{etykieta}</span>
      <span className="dzialanie-input">
        <input
          type="number"
          min={min}
          max={max}
          step={krok}
          value={wartosc}
          onChange={(event) => onChange(Number(event.target.value))}
        />
        <span>{jednostka}</span>
      </span>
    </label>
  )
}

export function CoByToZmienilo({ warstwy }: CoByToZmieniloProps) {
  const [zalozenia, setZalozenia] = useState<ZalozeniaDzialania>(DOMYSLNE_ZALOZENIA)
  const [pokazWzor, setPokazWzor] = useState(false)
  const z = normalizujZalozenia(zalozenia)
  const scenariusze = policzScenariusze(warstwy, z)

  function zmienWyjscia(id: string, wartosc: number) {
    setZalozenia((obecne) => ({
      ...obecne,
      wyjsciaTygodniowo: { ...obecne.wyjsciaTygodniowo, [id]: wartosc },
    }))
  }

  return (
    <section className="dzialanie" aria-labelledby="dzialanie-tytul">
      <div className="dzialanie-naglowek">
        <span className="dzialanie-kicker">CO BY TO ZMIENIŁO?</span>
        <h2 id="dzialanie-tytul">Bliżej na co dzień</h2>
        <p>
          Sprawdź scenariusz dla słabszych warstw okolicy. Liczymy możliwy czas w drodze, gdy
          codzienny cel znajdzie się bliżej.
        </p>
      </div>
      {scenariusze.length === 0 ? (
        <p className="dzialanie-pusto">
          Nie ma teraz mierzalnego scenariusza dla tego adresu. Brak danych nie oznacza złej oceny.
        </p>
      ) : (
        scenariusze.map((scenariusz) => {
          const zrodlo = scenariusz.meta.zrodla[0]
          return (
            <article className="dzialanie-scenariusz" key={scenariusz.id}>
              <div className="dzialanie-scenariusz-top">
                <div>
                  <span className="dzialanie-label">SCENARIUSZ</span>
                  <h3>{scenariusz.tytul}</h3>
                </div>
                <span className="dzialanie-ocena">
                  Ocena {Math.round(scenariusz.ocena ?? 0)}/100
                </span>
              </div>
              <p className="dzialanie-opis">{scenariusz.dzialanie}</p>
              <div className="dzialanie-odleglosc">
                <span>
                  Obecnie <strong>{liczba.format(scenariusz.obecnieMetry)} m</strong>
                </span>
                <span aria-hidden="true">→</span>
                <span>
                  Scenariusz <strong>{scenariusz.celMetry} m</strong>
                </span>
              </div>
              <div className="dzialanie-liczby">
                <div>
                  <strong>{liczba.format(scenariusz.godzinyRocznie)} h</strong>
                  <span>różnica czasu w uproszczonym modelu na rok</span>
                </div>
                <div>
                  <strong>{kwota.format(scenariusz.wartoscCzasuRocznie)}</strong>
                  <span>wartość tego czasu według Twojej stawki</span>
                </div>
              </div>
              <PoleLiczbowe
                etykieta="Podróże w obie strony"
                wartosc={z.wyjsciaTygodniowo[scenariusz.id] ?? 0}
                min={0}
                max={50}
                jednostka="/ tydz."
                onChange={(wartosc) => zmienWyjscia(scenariusz.id, wartosc)}
              />
              <p className="dzialanie-zrodlo">
                {scenariusz.atrapa && <strong>Dane przykładowe · </strong>}
                Pomiar: {scenariusz.meta.nazwa} · {scenariusz.meta.rozdzielczosc}
                {scenariusz.meta.rozmiar ? ` ${scenariusz.meta.rozmiar}` : ''}
                {zrodlo && (
                  <>
                    {' '}
                    · {zrodlo.nazwa}, stan {zrodlo.dataDanych}
                  </>
                )}
                {zrodlo?.url.startsWith('https://') && (
                  <>
                    {' '}
                    ·{' '}
                    <a href={zrodlo.url} target="_blank" rel="noreferrer">
                      Otwórz źródło
                    </a>
                  </>
                )}
              </p>
            </article>
          )
        })
      )}
      <div className="dzialanie-zalozenia">
        <h3>Twoje założenia</h3>
        <div className="dzialanie-pola">
          <PoleLiczbowe
            etykieta="Tempo marszu"
            wartosc={z.kmNaGodzine}
            min={1}
            max={10}
            krok={0.1}
            jednostka="km/h"
            onChange={(wartosc) => setZalozenia((obecne) => ({ ...obecne, kmNaGodzine: wartosc }))}
          />
          <PoleLiczbowe
            etykieta="Wartość godziny"
            wartosc={z.zlZaGodzine}
            min={0}
            max={1000}
            jednostka="zł/h"
            onChange={(wartosc) => setZalozenia((obecne) => ({ ...obecne, zlZaGodzine: wartosc }))}
          />
        </div>
        <button
          type="button"
          className="dzialanie-wzor-przycisk"
          onClick={() => setPokazWzor((obecny) => !obecny)}
          aria-expanded={pokazWzor}
        >
          Jak to liczymy? <span aria-hidden="true">{pokazWzor ? '−' : '+'}</span>
        </button>
        {pokazWzor && (
          <div className="dzialanie-wzor">
            <p>
              Godziny rocznie = różnica odległości ÷ tempo marszu × 2 × podróże tygodniowo × 52.
              Wartość czasu = godziny × Twoja stawka.
            </p>
            <p>
              Odległość w danych może być mierzona w linii prostej. Model nie uwzględnia sieci ulic,
              czasu oczekiwania ani innych podróży. Wynik nie przewiduje rzeczywistej oszczędności,
              nowej inwestycji ani wydatków gotówkowych.
            </p>
          </div>
        )}
      </div>
    </section>
  )
}
