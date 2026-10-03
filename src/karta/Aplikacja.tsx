import { lazy, Suspense, useEffect, useRef } from 'react'
import { Pokaz3D, parametrPokazu } from '@/miasto3d/Pokaz3D'
import { useDane } from '@/wynik/dane'
import { hrefAdresu } from '@/wynik/slug'
import { useStan } from '@/wynik/stan'
import { opisAdresu } from './adres'
import { EkranSzukaj } from './EkranSzukaj'
import { KatalogAdresow } from './KatalogAdresow'
import { ladujMetode, ladujOkolice, ladujPorownanie, przygotujEkran } from './ladowanieEkranow'
import { Naglowek } from './Naglowek'

const EkranOkolica = lazy(async () => ({ default: (await ladujOkolice()).EkranOkolica }))
const EkranPorownanie = lazy(async () => ({ default: (await ladujPorownanie()).EkranPorownanie }))
const Metoda = lazy(async () => ({ default: (await ladujMetode()).Metoda }))
const EkranBiznes = lazy(async () => ({
  default: (await import('./biznes/EkranBiznes')).EkranBiznes,
}))

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
          : ekran === 'biznes'
            ? 'Miejsce na biznes'
            : ekran === 'katalog'
              ? 'Katalog adresów Krakowa'
              : 'Szukaj okolicy'

  // Przejście = inny ekran albo, na karcie, inny adres. Klik w mapę na Szukaj niczego nie resetuje.
  const klucz = ekran === 'okolica' ? `okolica:${wybrany}` : ekran
  const poprzedniKlucz = useRef(klucz)
  const czekaNaFokus = useRef(false)

  useEffect(() => {
    if (ekran === 'okolica' && !adres) return
    if (ekran === 'katalog' && location.pathname.startsWith('/katalog/')) return
    document.title = `${tytul} – adresscore`
  }, [tytul, ekran, adres])

  useEffect(() => {
    if (ekran === 'okolica' && !adres) return
    const sciezka =
      ekran === 'okolica' && adres
        ? hrefAdresu(adres)
        : ekran === 'katalog'
          ? location.pathname.startsWith('/katalog/')
            ? location.pathname
            : '/katalog'
          : '/'
    let link = document.querySelector<HTMLLinkElement>('link[rel="canonical"]')
    if (!link) {
      link = document.createElement('link')
      link.rel = 'canonical'
      document.head.append(link)
    }
    link.href = `https://adresscore.pl${sciezka}`
  }, [ekran, adres])

  useEffect(() => {
    const nastepny = ekran === 'szukaj' ? 'okolica' : ekran === 'okolica' ? 'porownanie' : 'metoda'
    let bezczynnosc: number | undefined
    // Import po bezczynności nie konkuruje z pierwszym renderem i pobraniem mapy.
    const timer = window.setTimeout(() => {
      if ('requestIdleCallback' in window) {
        bezczynnosc = window.requestIdleCallback(() => przygotujEkran(nastepny))
      } else {
        przygotujEkran(nastepny)
      }
    }, 2000)
    return () => {
      window.clearTimeout(timer)
      if (bezczynnosc !== undefined) window.cancelIdleCallback(bezczynnosc)
    }
  }, [ekran])

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
      {ekran === 'katalog' && <KatalogAdresow />}
      <Suspense
        fallback={
          <main className="tresc">
            <p className="komunikat" role="status">
              Wczytuję ekran…
            </p>
          </main>
        }
      >
        {ekran === 'okolica' && <EkranOkolica />}
        {ekran === 'porownanie' && <EkranPorownanie />}
        {ekran === 'metoda' && <Metoda />}
        {ekran === 'biznes' && <EkranBiznes />}
      </Suspense>
    </>
  )
}
