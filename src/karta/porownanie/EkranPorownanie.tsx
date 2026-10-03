import { liczba, opisAdresu } from '@/karta/adres'
import { useDane } from '@/wynik/dane'
import { hrefDla, useStan, usunZPorownania } from '@/wynik/stan'
import { MAKS_POROWNANIE } from '@/wynik/url'
import { useWyniki } from '@/wynik/useWyniki'

/**
 * Slot #48 – porównanie do 5 okolic wg docs/makieta/Porownanie.dc.html: wykres radarowy
 * po kategoriach, tabela, werdykt.
 * TODO #48: radar i tabela. Rozbicie per adres: wynikAdresu(i, dane.wskazniki, wagi, kierunki).
 */
export function EkranPorownanie() {
  const dane = useDane()
  const stan = useStan((s) => s)
  const wyniki = useWyniki()

  return (
    <main className="tresc">
      <h1 style={{ margin: 0, fontSize: 36, letterSpacing: '-0.02em' }}>
        Porównaj okolice pod siebie
      </h1>
      {stan.porownanie.length === 0 ? (
        <p className="komunikat">
          Lista jest pusta. Dodaj do {MAKS_POROWNANIE} adresów z karty okolicy.{' '}
          <a href={hrefDla(stan, { ekran: 'szukaj' })}>Wróć do mapy</a>
        </p>
      ) : (
        <ol className="lista-wynikow">
          {stan.porownanie.map((i) => {
            const adres = dane.stan === 'gotowe' ? dane.adresy[i] : undefined
            const v = wyniki?.naAdres[i]
            return (
              <li key={i} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <a
                  className="pozycja-wyniku"
                  style={{ flex: 1 }}
                  href={hrefDla(stan, { ekran: 'okolica', wybrany: i })}
                >
                  <span
                    className="plakietka-wyniku"
                    data-brak={v === undefined || Number.isNaN(v) ? '' : undefined}
                  >
                    {liczba(v)}
                  </span>
                  {adres ? opisAdresu(adres) : '…'}
                </a>
                <button type="button" className="seg" onClick={() => usunZPorownania(i)}>
                  Usuń<span className="sr-only"> {adres ? opisAdresu(adres) : ''}</span>
                </button>
              </li>
            )
          })}
        </ol>
      )}
    </main>
  )
}
