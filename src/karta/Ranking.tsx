import { MIASTO_DOMYSLNE } from '@/kontrakty'
import { useDane } from '@/wynik/dane'
import { useMiasto } from '@/wynik/miastoDanych'
import { opisZrodelOkolic } from '@/wynik/miejsceAdresu'
import { rankingUlic } from '@/wynik/rankingUlic'
import { slugUlicy } from '@/wynik/slug'
import { dodajDoPorownania, hrefDla, useStan, usunZPorownania } from '@/wynik/stan'
import { MAKS_POROWNANIE } from '@/wynik/url'
import { useWyniki } from '@/wynik/useWyniki'
import { liczba, opisAdresu } from './adres'

/**
 * Pięć ulic bieżącego miasta z najwyższą średnią oceną adresów dla aktualnych wag lub wybranej warstwy.
 * `nazwaWarstwy` to podpis wybranej warstwy z przeglądu: miasto, które jej nie ma, nie zna jej nazwy.
 */
export function Ranking({ nazwaWarstwy }: { nazwaWarstwy: string }) {
  const dane = useDane()
  const wyniki = useWyniki()
  const stan = useStan((s) => s)
  const miasto = useMiasto()
  if (dane.stan !== 'gotowe' || !wyniki) return <p className="komunikat">Wczytuję dane…</p>

  const najlepsze = rankingUlic(
    dane.adresy,
    wyniki.naAdres,
    wyniki.wykluczenia.wykluczony,
    wyniki.heksy,
    dane.okolice,
  )
  const atrapa = dane.plikAdresow.atrapa || dane.wskazniki.some((w) => w.meta.atrapa)
  // Strona ulicy (/katalog/<slug>) istnieje tylko dla Krakowa (FR-015). Ulica z innego miasta prowadzi do karty
  // adresu, który pokazuje wiersz („Do porównania: …”), zamiast do nieistniejącej strony.
  const hrefUlicy = (ulica: (typeof najlepsze)[number]) =>
    miasto.slug === MIASTO_DOMYSLNE
      ? `/katalog/${ulica.slug}`
      : hrefDla(stan, { ekran: 'okolica', wybrany: ulica.adresDoPorownania })

  return (
    <section
      aria-labelledby="h-ranking"
      className="szukaj-ranking"
      style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
    >
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <h2 id="h-ranking" className="etykieta-sekcji">
          Najlepiej pasujące ulice {miasto.wMiescie} ·{' '}
          {wyniki.brakWarstwy ? nazwaWarstwy : wyniki.podpis}
        </h2>
        {atrapa && <span className="atrapa">dane przykładowe</span>}
        {stan.porownanie.length > 0 && (
          <a className="ranking-porownaj" href={hrefDla(stan, { ekran: 'porownanie' })}>
            Porównaj wybrane ({stan.porownanie.length}/{MAKS_POROWNANIE})
          </a>
        )}
      </div>
      {wyniki.brakWarstwy ? (
        // Warstwa wybrana w innym mieście: tu jej nie ma, więc brak danych, a nie wynik łączny ani zero (FR-004).
        <p style={{ margin: 0, color: 'var(--tekst-2)' }}>
          Warstwy „{nazwaWarstwy}” nie ma {miasto.wMiescie}, więc nie ułożymy rankingu ulic. Brak
          danych to nie zero – wybierz „Wynik tej okolicy” albo warstwę z listy nad mapą.
        </p>
      ) : najlepsze.length === 0 ? (
        <p style={{ margin: 0, color: 'var(--tekst-2)' }}>Ustaw wagi, żeby policzyć wynik.</p>
      ) : (
        <>
          <p style={{ margin: 0, color: 'var(--tekst-2)' }}>
            Wynik ulicy to średnia ocen adresów z dostępnymi danymi.
          </p>
          <ol className="lista-wynikow">
            {najlepsze.map((ulica) => {
              const wybranyAdres = stan.porownanie.find((i) => {
                const wybrany = dane.adresy[i]
                return wybrany && slugUlicy(wybrany) === ulica.slug
              })
              const dodano = wybranyAdres !== undefined
              const adresPorownania = dane.adresy[wybranyAdres ?? ulica.adresDoPorownania]
              const pelne = stan.porownanie.length >= MAKS_POROWNANIE
              return (
                <li className="ranking-ulica" key={ulica.slug}>
                  <a className="pozycja-wyniku" href={hrefUlicy(ulica)}>
                    <span className="plakietka-wyniku">{liczba(ulica.wynik)}</span>
                    <span className="ranking-ulica__opis">
                      <span>
                        {ulica.nazwa}, {ulica.miejscowosc}
                        {ulica.okolica && (
                          <span style={{ color: 'var(--tekst-3)' }}> · {ulica.okolica}</span>
                        )}
                      </span>
                      {adresPorownania && (
                        <small>Do porównania: {opisAdresu(adresPorownania)}</small>
                      )}
                    </span>
                  </a>
                  <button
                    className="ranking-ulica__dodaj"
                    type="button"
                    aria-pressed={dodano}
                    aria-label={`${dodano ? 'Usuń z porównania' : 'Dodaj do porównania'} adres ${adresPorownania ? opisAdresu(adresPorownania) : ulica.nazwa}`}
                    title={
                      adresPorownania
                        ? `Porównywany adres: ${opisAdresu(adresPorownania)}`
                        : undefined
                    }
                    disabled={!dodano && pelne}
                    onClick={() => {
                      if (wybranyAdres !== undefined) usunZPorownania(wybranyAdres)
                      else dodajDoPorownania(ulica.adresDoPorownania)
                    }}
                  >
                    {dodano
                      ? 'Usuń z porównania'
                      : pelne
                        ? 'Limit 5 adresów'
                        : 'Dodaj do porównania'}
                  </button>
                </li>
              )
            })}
          </ol>
          <p style={{ margin: 0, color: 'var(--tekst-3)', fontSize: '0.85em' }}>
            {opisZrodelOkolic(dane.okolice, miasto.slug === MIASTO_DOMYSLNE)}
          </p>
        </>
      )}
    </section>
  )
}
