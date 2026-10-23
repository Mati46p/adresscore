import { useEffect } from 'react'
import { MIASTO_DOMYSLNE } from '@/kontrakty'
import { pozwolNaPelneDane, useDane } from '@/wynik/dane'
import { useMiasto } from '@/wynik/miastoDanych'
import { opisZrodelOkolic } from '@/wynik/miejsceAdresu'
import { rankingUlic } from '@/wynik/rankingUlic'
import { slugUlicy } from '@/wynik/slug'
import { dodajDoPorownania, hrefDla, useStan, usunZPorownania } from '@/wynik/stan'
import { MAKS_POROWNANIE } from '@/wynik/url'
import { useRankingWstepny } from '@/wynik/useRankingKompakt'
import { useWyniki } from '@/wynik/useWyniki'
import { useWynikiMapy } from '@/wynik/useWynikiMapy'
import { liczba, opisAdresu } from './adres'

/** Poziom koloru plakietki: wysoki / średni / niski wynik (kolory z tokenów, liczba zawsze obok). */
function poziomWyniku(wynik: number | null | undefined): 'wysoki' | 'sredni' | 'niski' {
  if (wynik === null || wynik === undefined || Number.isNaN(wynik)) return 'niski'
  return wynik >= 75 ? 'wysoki' : wynik >= 70 ? 'sredni' : 'niski'
}

/**
 * Pięć ulic bieżącego miasta z najwyższą średnią oceną adresów dla aktualnych wag lub wybranej warstwy.
 * `nazwaWarstwy` to podpis wybranej warstwy z przeglądu: miasto, które jej nie ma, nie zna jej nazwy.
 */
export function Ranking({ nazwaWarstwy }: { nazwaWarstwy: string }) {
  const dane = useDane()
  const wyniki = useWyniki()
  const stan = useStan((s) => s)
  const miasto = useMiasto()
  const wstepne = useRankingWstepny(5)
  const wynikiMapy = useWynikiMapy()
  // Dokładny ranking liczy się na wszystkich adresach, więc otwarcie zakładki otwiera pełne dane (bramka
  // w `dane.ts`). Do ich dojścia stoi wstępny ranking z heksów kompaktu.
  useEffect(() => {
    pozwolNaPelneDane()
  }, [])
  if (dane.stan !== 'gotowe' || !wyniki) {
    if (!wstepne || !wynikiMapy) return <p className="komunikat">Wczytuję dane…</p>
    return (
      <section
        aria-labelledby="h-ranking"
        className="szukaj-ranking"
        data-wstepny
        style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
      >
        <h2 id="h-ranking" className="etykieta-sekcji">
          Najlepiej pasujące ulice {miasto.wMiescie} ·{' '}
          {wynikiMapy.brakWarstwy ? nazwaWarstwy : wynikiMapy.podpis}
        </h2>
        {/* Stały region: czytnik ogłasza przejście od wstępnego do dokładnego rankingu. */}
        <p role="status" style={{ margin: 0, color: 'var(--tekst-2)' }}>
          {dane.stan === 'blad'
            ? 'Wstępny ranking z heksów – nie udało się policzyć dokładnego.'
            : 'Wstępny ranking z heksów – liczę dokładny…'}
        </p>
        {wynikiMapy.brakWarstwy ? (
          <p style={{ margin: 0, color: 'var(--tekst-2)' }}>
            Warstwy „{nazwaWarstwy}” nie ma {miasto.wMiescie}, więc nie ułożymy rankingu ulic. Brak
            danych to nie zero – wybierz „Wynik tej okolicy” albo warstwę z listy nad mapą.
          </p>
        ) : wstepne.length === 0 ? (
          <p style={{ margin: 0, color: 'var(--tekst-2)' }}>Ustaw wagi, żeby policzyć wynik.</p>
        ) : (
          <ol className="lista-wynikow">
            {/* Pozycje przybliżone nie mają prawdziwego sluga ani adresu do porównania: bez linków i przycisku. */}
            {wstepne.map((ulica) => (
              <li className="ranking-ulica" key={ulica.slug}>
                <span className="pozycja-wyniku">
                  <span className="plakietka-wyniku" data-poziom={poziomWyniku(ulica.wynik)}>
                    {liczba(ulica.wynik)}
                  </span>
                  <span className="ranking-ulica__opis">
                    <span className="ranking-ulica__nazwa">{ulica.nazwa}</span>
                    <small>{ulica.miejscowosc}</small>
                  </span>
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>
    )
  }

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
                  <a
                    className="pozycja-wyniku"
                    href={hrefUlicy(ulica)}
                    title={
                      adresPorownania ? `Do porównania: ${opisAdresu(adresPorownania)}` : undefined
                    }
                  >
                    {/* Liczba zawsze widoczna; kolor to tylko trzeci poziom, bez znaczenia samego koloru. */}
                    <span className="plakietka-wyniku" data-poziom={poziomWyniku(ulica.wynik)}>
                      {liczba(ulica.wynik)}
                    </span>
                    <span className="ranking-ulica__opis">
                      <span className="ranking-ulica__nazwa">{ulica.nazwa}</span>
                      <small>
                        {ulica.miejscowosc}
                        {ulica.okolica && ` · ${ulica.okolica}`}
                      </small>
                    </span>
                  </a>
                  <button
                    className="ranking-ulica__dodaj"
                    type="button"
                    aria-pressed={dodano}
                    aria-label={`${dodano ? 'Usuń z porównania' : pelne ? 'Limit 5 adresów, nie dodasz do porównania' : 'Dodaj do porównania'} adres ${adresPorownania ? opisAdresu(adresPorownania) : ulica.nazwa}`}
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
                  />
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
