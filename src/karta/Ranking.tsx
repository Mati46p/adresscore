import { useDane } from '@/wynik/dane'
import { rankingUlic } from '@/wynik/rankingUlic'
import { useWyniki } from '@/wynik/useWyniki'
import { liczba } from './adres'

/** Pięć ulic z najwyższą średnią oceną adresów dla aktualnych wag lub wybranej warstwy. */
export function Ranking() {
  const dane = useDane()
  const wyniki = useWyniki()
  if (dane.stan !== 'gotowe' || !wyniki) return <p className="komunikat">Wczytuję dane…</p>

  const najlepsze = rankingUlic(
    dane.adresy,
    wyniki.naAdres,
    wyniki.wykluczenia.wykluczony,
    wyniki.heksy,
  )
  const atrapa = dane.plikAdresow.atrapa || dane.wskazniki.some((w) => w.meta.atrapa)

  return (
    <section
      aria-labelledby="h-ranking"
      className="szukaj-ranking"
      style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
    >
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <h2 id="h-ranking" className="etykieta-sekcji">
          Najlepiej pasujące ulice · {wyniki.podpis}
        </h2>
        {atrapa && <span className="atrapa">dane przykładowe</span>}
      </div>
      {najlepsze.length === 0 ? (
        <p style={{ margin: 0, color: 'var(--tekst-2)' }}>Ustaw wagi, żeby policzyć wynik.</p>
      ) : (
        <>
          <p style={{ margin: 0, color: 'var(--tekst-2)' }}>
            Wynik ulicy to średnia ocen adresów z dostępnymi danymi.
          </p>
          <ol className="lista-wynikow">
            {najlepsze.map((ulica) => (
              <li key={ulica.slug}>
                <a className="pozycja-wyniku" href={`/katalog/${ulica.slug}`}>
                  <span className="plakietka-wyniku">{liczba(ulica.wynik)}</span>
                  <span>
                    {ulica.nazwa}, {ulica.miejscowosc}
                    {ulica.dzielnica && (
                      <span style={{ color: 'var(--tekst-3)' }}> · {ulica.dzielnica}</span>
                    )}
                  </span>
                </a>
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  )
}
