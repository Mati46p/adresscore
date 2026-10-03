import { useEffect, useRef } from 'react'
import { Pokaz3D, parametrPokazu } from '@/miasto3d/Pokaz3D'
import { Metoda } from '@/strony/Metoda'
import { useDane } from '@/wynik/dane'
import { useStan } from '@/wynik/stan'
import { opisAdresu } from './adres'
import { EkranSzukaj } from './EkranSzukaj'
import { Naglowek } from './Naglowek'
import { EkranOkolica } from './okolica/EkranOkolica'
import { EkranPorownanie } from './porownanie/EkranPorownanie'

/** Powłoka: nagłówek z krokami i ekran wybrany przez hash (#/, #/adres/<id>, #/porownanie). */
export function Aplikacja() {
  // Link do prezentacji: pełny ekran 3D zamiast powłoki (#130).
  const pokaz = parametrPokazu()
  if (pokaz !== null) return <Pokaz3D id={pokaz} />
  return <Powloka />
}

function Powloka() {
  const ekran = useStan((s) => s.ekran)
  const wybrany = useStan((s) => s.wybrany)
  const dane = useDane()
  const gotowe = dane.stan === 'gotowe'
  const adres = dane.stan === 'gotowe' && wybrany !== null ? dane.adresy[wybrany] : undefined
  const nazwaAdresu = adres ? opisAdresu(adres) : 'Karta okolicy'

  const tytul =
    ekran === 'okolica'
      ? nazwaAdresu
      : ekran === 'porownanie'
        ? 'Porównanie'
        : ekran === 'metoda'
          ? 'Metoda i źródła'
          : 'Szukaj okolicy'

  // Przejście = inny ekran albo, na karcie, inny adres. Klik w mapę na Szukaj niczego nie resetuje.
  const klucz = ekran === 'okolica' ? `okolica:${wybrany}` : ekran
  const poprzedniKlucz = useRef(klucz)
  const czekaNaFokus = useRef(false)

  useEffect(() => {
    document.title = `${tytul} – adresscore`
  }, [tytul])

  useEffect(() => {
    // Pierwsze wejście: ani przewijania, ani przenoszenia fokusu.
    if (poprzedniKlucz.current !== klucz) {
      poprzedniKlucz.current = klucz
      czekaNaFokus.current = true
      window.scrollTo(0, 0)
    }
    if (!czekaNaFokus.current) return
    // Karta czeka na dane, więc h1 może pojawić się dopiero po wczytaniu – efekt biegnie wtedy ponownie.
    const h1 = document.querySelector<HTMLElement>('main h1')
    if (!h1) return
    if (!h1.hasAttribute('tabindex')) h1.setAttribute('tabindex', '-1')
    h1.focus({ preventScroll: true })
    czekaNaFokus.current = false
  }, [klucz, gotowe])

  return (
    <>
      <Naglowek />
      {dane.stan === 'blad' && (
        <p role="alert" className="komunikat">
          Nie udało się wczytać danych: {dane.blad}
        </p>
      )}
      {ekran === 'szukaj' && <EkranSzukaj />}
      {ekran === 'okolica' && <EkranOkolica />}
      {ekran === 'porownanie' && <EkranPorownanie />}
      {ekran === 'metoda' && <Metoda />}
    </>
  )
}
