import type { JSX } from 'react'
import { liczbaPelna, odmianaAdresow } from '@/wynik/rankingLuk'
import type { WynikSymulacji } from '@/wynik/symulacja'

export interface BilansSymulacjiProps {
  /** „Wariant A” / „Wariant B”. */
  tytul: string
  wynik: WynikSymulacji
  /** Wariant edytowany teraz na mapie – nagłówek dostaje wyróżnienie. */
  aktywny: boolean
}

/** Orzeczenie po liczbie: „1 adres awansuje”, „3 adresy awansują”, „5 adresów awansuje”. */
const orzeczenie = (n: number, pojedyncza: string, mnoga: string) =>
  odmianaAdresow(n) === 'adresy' ? mnoga : pojedyncza

const sumaWyjsc = (w: Record<string, number>) => Object.values(w).reduce((s, x) => s + x, 0)

/**
 * Bilans jednego wariantu (#98): ile adresów awansuje o literę i ile wychodzi z luki,
 * w pełnych liczbach, z rozbiciem na okolice. Wiersz „Razem” = nagłówek (pilnuje tego test silnika).
 */
export function BilansSymulacji({ tytul, wynik, aktywny }: BilansSymulacjiProps): JSX.Element {
  const id = `bilans-${tytul.replace(/\W+/g, '-').toLowerCase()}`
  if (wynik.obiekty === 0) {
    return (
      <section className="bilans" aria-labelledby={id} data-aktywny={aktywny ? '' : undefined}>
        <h3 id={id} className="bilans__tytul">
          {tytul}
        </h3>
        <p className="bilans__pusty">
          Kliknij mapę, żeby postawić obiekt. Bilans policzy się od razu.
        </p>
      </section>
    )
  }
  const wychodziRazem = wynik.luki.reduce((s, l) => s + l.wychodzi, 0)
  return (
    <section className="bilans" aria-labelledby={id} data-aktywny={aktywny ? '' : undefined}>
      <h3 id={id} className="bilans__tytul">
        {tytul}
      </h3>
      <p className="bilans__glowna">
        <strong className="bilans__liczba">{liczbaPelna(wynik.awans)}</strong>{' '}
        {odmianaAdresow(wynik.awans)} {orzeczenie(wynik.awans, 'awansuje', 'awansują')} o co
        najmniej jedną literę
      </p>
      {wynik.luki.map((l) => (
        <p key={l.warstwa} className="bilans__glowna">
          <strong className="bilans__liczba">{liczbaPelna(l.wychodzi)}</strong>{' '}
          {odmianaAdresow(l.wychodzi)} {orzeczenie(l.wychodzi, 'wychodzi', 'wychodzą')} z luki
          <span className="bilans__dopisek">
            {' '}
            – {l.prog.naglowek}: było {liczbaPelna(l.przed)}, zostaje{' '}
            {liczbaPelna(l.przed - l.wychodzi)}
          </span>
        </p>
      ))}
      {wynik.spadek > 0 && (
        <p className="bilans__uwaga">
          {liczbaPelna(wynik.spadek)} {odmianaAdresow(wynik.spadek)}{' '}
          {orzeczenie(wynik.spadek, 'traci', 'tracą')} literę – w ustawieniach wyniku odwrócono
          kierunek tej warstwy („im dalej, tym lepiej”).
        </p>
      )}
      <p className="bilans__zasieg">
        Krótsza droga dla {liczbaPelna(wynik.zasieg)} {wynik.zasieg === 1 ? 'adresu' : 'adresów'}.
      </p>

      {wynik.okolice.length > 0 && (
        <table className="bilans__tabela">
          <caption className="sr-only">{tytul} – zmiany w podziale na okolice</caption>
          <thead>
            <tr>
              <th scope="col">Okolica</th>
              <th scope="col" className="bilans__num">
                Awans litery
              </th>
              <th scope="col" className="bilans__num">
                Wyjście z luki
              </th>
            </tr>
          </thead>
          <tbody>
            {wynik.okolice.map((o) => (
              <tr key={o.id}>
                <th scope="row">
                  {o.nazwa}
                  {o.typ === 'gmina' && <span className="bilans__typ"> gmina</span>}
                </th>
                <td className="bilans__num">{liczbaPelna(o.awans)}</td>
                <td className="bilans__num">{liczbaPelna(sumaWyjsc(o.wychodzi))}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">Razem</th>
              <td className="bilans__num">{liczbaPelna(wynik.awans)}</td>
              <td className="bilans__num">{liczbaPelna(wychodziRazem)}</td>
            </tr>
          </tfoot>
        </table>
      )}
    </section>
  )
}
