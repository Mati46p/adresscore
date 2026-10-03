import { liczba, opisAdresu } from '@/karta/adres'
import { KATEGORIE } from '@/kontrakty'
import { useDane } from '@/wynik/dane'
import { dodajDoPorownania, hrefDla, useStan } from '@/wynik/stan'
import { useWynikAdresu } from '@/wynik/useWyniki'

/**
 * Slot #12 – karta okolicy wg docs/makieta/Okolica.dc.html: wynik i litera, „Dlaczego taki
 * wynik", rozbicie na warstwy (waga, ocena, wkład), źródła z datą i rozdzielczością.
 * TODO #12: pełny układ z makiety. Dane: useWynikAdresu(wybrany) → WynikAdresu.
 */
export function EkranOkolica() {
  const dane = useDane()
  const stan = useStan((s) => s)
  const wynik = useWynikAdresu(stan.wybrany)
  const adres = dane.stan === 'gotowe' && stan.wybrany !== null ? dane.adresy[stan.wybrany] : null

  return (
    <main className="tresc">
      <a
        href={hrefDla(stan, { ekran: 'szukaj' })}
        style={{ alignSelf: 'flex-start', padding: '10px 0' }}
      >
        Wróć do mapy
      </a>
      {dane.stan === 'ladowanie' && <p className="komunikat">Wczytuję dane…</p>}
      {dane.stan === 'gotowe' && (!adres || !wynik) && (
        <p className="komunikat">Wybierz adres na mapie albo w wyszukiwarce.</p>
      )}
      {adres && wynik && (
        <>
          <section className="karta" aria-labelledby="h-adres">
            <h1 id="h-adres" style={{ margin: 0, fontSize: 32, letterSpacing: '-0.02em' }}>
              {opisAdresu(adres)}
            </h1>
            <p style={{ color: 'var(--tekst-2)' }}>
              Wynik <span className="mono">{liczba(wynik.wynik)}</span> na 100 · litera{' '}
              <strong>{wynik.litera ?? '–'}</strong> · pewność{' '}
              <span className="mono">{Math.round(wynik.pewnosc * 100)}%</span>
              {wynik.warstwy.some((w) => w.meta.atrapa) && (
                <>
                  {' '}
                  <span className="atrapa">dane przykładowe</span>
                </>
              )}
            </p>
            <button type="button" className="seg" onClick={() => dodajDoPorownania(wynik.i)}>
              Dodaj do porównania
            </button>
          </section>
          <section className="karta" aria-labelledby="h-kategorie">
            <h2 id="h-kategorie" style={{ marginTop: 0 }}>
              Kategorie
            </h2>
            <ul>
              {wynik.kategorie
                .filter((k) => k.kategoria !== 'kontekst')
                .map((k) => (
                  <li key={k.kategoria}>
                    {KATEGORIE[k.kategoria]}: <span className="mono">{liczba(k.ocena)}</span>
                    {k.ocena === null && ' (brak danych)'}
                  </li>
                ))}
            </ul>
          </section>
        </>
      )}
    </main>
  )
}
