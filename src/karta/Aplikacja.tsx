import { lazy, Suspense, useEffect, useRef } from 'react'
import { Pokaz3D, parametrPokazu } from '@/miasto3d/Pokaz3D'
import { useDane } from '@/wynik/dane'
import { useMiasto } from '@/wynik/miastoDanych'
import { hrefAdresu } from '@/wynik/slug'
import { useStan } from '@/wynik/stan'
import { opisAdresu } from './adres'
import { EkranSzukaj } from './EkranSzukaj'
import { KatalogAdresow } from './KatalogAdresow'
import {
  ladujBiznes,
  ladujMetode,
  ladujMiasto,
  ladujOkolice,
  ladujPanel,
  ladujPorownanie,
  przygotujEkran,
} from './ladowanieEkranow'
import { sciezkaKanoniczna, tytulEkranu } from './miastoTeksty'
import './aplikacja.css'
import { Naglowek } from './Naglowek'

const EkranOkolica = lazy(async () => ({ default: (await ladujOkolice()).EkranOkolica }))
const EkranPorownanie = lazy(async () => ({ default: (await ladujPorownanie()).EkranPorownanie }))
const Metoda = lazy(async () => ({ default: (await ladujMetode()).Metoda }))
const EkranBiznes = lazy(async () => ({
  default: (await ladujBiznes()).EkranBiznes,
}))
const EkranMiasto = lazy(async () => ({
  default: (await ladujMiasto()).EkranMiasto,
}))
const EkranPanel = lazy(async () => ({ default: (await ladujPanel()).EkranPanel }))

/** Powłoka: nagłówek z krokami i ekran wybrany przez hash (#/, #/adres/<id>, #/porownanie). */
export function Aplikacja() {
  // Link do prezentacji: pełny ekran 3D zamiast powłoki (#130).
  const pokaz = parametrPokazu()
  const ekran = useStan((s) => s.ekran)
  if (pokaz !== null) return <Pokaz3D id={pokaz} />
  // Panel admina (#/panel) żyje poza powłoką, jak prezentacja 3D: bez nagłówka mapy, bez tytułu i
  // canonicala serwisu (panel ma własny tytuł i noindex) i bez `useDane()`, które pobrałoby ~70 tys.
  // adresów dla kogoś, kto chce tylko zobaczyć statystyki. Rozgałęzienie jest tutaj, a nie w
  // `Powloka`, żeby nie dotykać kolejności jej hooków; `Powloka` montuje się od zera po wyjściu z panelu.
  if (ekran === 'panel') {
    return (
      <Suspense
        fallback={
          <main className="tresc">
            <p className="komunikat" role="status">
              Wczytuję panel…
            </p>
          </main>
        }
      >
        <EkranPanel />
      </Suspense>
    )
  }
  return <Powloka />
}

function Powloka() {
  const ekran = useStan((s) => s.ekran)
  const wybrany = useStan((s) => s.wybrany)
  const nieznaneMiasto = useStan((s) => s.nieznaneMiasto)
  const miasto = useMiasto()
  const dane = useDane()
  const gotowe = dane.stan === 'gotowe'
  const adres = dane.stan === 'gotowe' && wybrany !== null ? dane.adresy[wybrany] : undefined
  const nazwaAdresu = adres ? opisAdresu(adres) : 'Karta okolicy'

  // Tytuły ekranów z własnym adresem (/, /adres/…, /metoda) są dla Krakowa te same co w HTML z serwera
  // (index.html, api/seo.js): Google indeksuje tytuł po wykonaniu JS, więc rozjazd podmieniłby go. Inne
  // miasto dostaje własną nazwę (#223) – tytuły i adres kanoniczny: miastoTeksty.ts.
  const tytul = tytulEkranu(ekran, miasto, nazwaAdresu)

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
    // Strony SEO (karta adresu, katalog) są tylko dla Krakowa (FR-015): adres kanoniczny karty z innego
    // miasta nie ma wskazywać nieistniejącego /adres/<slug>, tylko stronę główną (sciezkaKanoniczna).
    const sciezka = sciezkaKanoniczna({
      ekran,
      miasto: miasto.slug,
      sciezkaAdresu: adres ? hrefAdresu(adres) : null,
      pathname: location.pathname,
    })
    let link = document.querySelector<HTMLLinkElement>('link[rel="canonical"]')
    if (!link) {
      link = document.createElement('link')
      link.rel = 'canonical'
      document.head.append(link)
    }
    link.href = `https://adresscore.pl${sciezka}`
  }, [ekran, adres, miasto.slug])

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
      {/* Link z `mst=` spoza rejestru (literówka, miasto z nowszej wersji): otwieramy Kraków, ale mówimy to
          wprost, zamiast po cichu pokazać inne miasto, niż prosił link (#223, contracts/url.md). */}
      {nieznaneMiasto && (
        <p role="status" className="komunikat komunikat--info">
          Nie mamy danych dla tego miasta. Pokazujemy {miasto.nazwa}.
        </p>
      )}
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
        {ekran === 'miasto' && <EkranMiasto />}
      </Suspense>
    </>
  )
}
