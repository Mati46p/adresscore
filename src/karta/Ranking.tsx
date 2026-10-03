import { useDane } from '@/wynik/dane'
import { hrefDla, useStan } from '@/wynik/stan'
import { useWyniki } from '@/wynik/useWyniki'
import { liczba, opisAdresu } from './adres'

const ILE = 5

/** „Najlepiej pasujące teraz" z makiety – pięć adresów z najwyższą wartością aktywnej warstwy. */
export function Ranking() {
  const dane = useDane()
  const wyniki = useWyniki()
  const stan = useStan((s) => s)
  if (dane.stan !== 'gotowe' || !wyniki) return <p className="komunikat">Wczytuję dane…</p>

  // Jedno przejście zamiast sortowania 70 tys. wyników przy każdej zmianie wagi.
  const najlepsze: number[] = []
  const v = wyniki.naAdres
  const wykluczony = wyniki.wykluczenia.wykluczony
  for (let i = 0; i < v.length; i++) {
    const x = v[i] as number
    if (x !== x || wykluczony[i]) continue
    if (najlepsze.length < ILE || x > (v[najlepsze[ILE - 1] as number] as number)) {
      najlepsze.push(i)
      najlepsze.sort((a, b) => (v[b] as number) - (v[a] as number))
      if (najlepsze.length > ILE) najlepsze.pop()
    }
  }
  const atrapa = dane.plikAdresow.atrapa || dane.wskazniki.some((w) => w.meta.atrapa)

  return (
    <section
      aria-labelledby="h-ranking"
      className="szukaj-ranking"
      style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
    >
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <h2 id="h-ranking" className="etykieta-sekcji">
          Najlepiej pasujące teraz · {wyniki.podpis}
        </h2>
        {atrapa && <span className="atrapa">dane przykładowe</span>}
      </div>
      {najlepsze.length === 0 ? (
        <p style={{ margin: 0, color: 'var(--tekst-2)' }}>
          {wyniki.wykluczenia.liczbaWykluczonych > 0
            ? 'Twarde filtry wykluczyły wszystkie adresy z wynikiem. Poluzuj próg.'
            : 'Ustaw wagi, żeby policzyć wynik.'}
        </p>
      ) : (
        <ol className="lista-wynikow">
          {najlepsze.map((i) => {
            const adres = dane.adresy[i]
            if (!adres) return null
            return (
              <li key={i}>
                <a
                  className="pozycja-wyniku"
                  href={hrefDla(stan, { ekran: 'okolica', wybrany: i })}
                >
                  <span className="plakietka-wyniku">{liczba(v[i])}</span>
                  <span>
                    {opisAdresu(adres)}
                    {adres.dzielnica && (
                      <span style={{ color: 'var(--tekst-3)' }}> · {adres.dzielnica}</span>
                    )}
                  </span>
                </a>
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}
