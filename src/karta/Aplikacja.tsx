import { useDane } from '@/wynik/dane'
import { useStan } from '@/wynik/stan'
import { EkranSzukaj } from './EkranSzukaj'
import { Naglowek } from './Naglowek'
import { EkranOkolica } from './okolica/EkranOkolica'
import { EkranPorownanie } from './porownanie/EkranPorownanie'

/** Powłoka: nagłówek z krokami i ekran wybrany przez hash (#/, #/adres/<id>, #/porownanie). */
export function Aplikacja() {
  const ekran = useStan((s) => s.ekran)
  const dane = useDane()

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
    </>
  )
}
