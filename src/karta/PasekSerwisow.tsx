import type { MouseEvent } from 'react'
import { hrefDla, useStan } from '@/wynik/stan'
import './serwisy.css'

// Sieć serwisów CPDP. adresscore pominięty – to my.
const SERWISY = [
  { cel: 'psoz', href: 'https://psoz.pl', nazwa: 'psoz.pl', logo: 'storage/logos/psoz.svg' },
  {
    cel: 'cpdp',
    href: 'https://cpdp.media',
    nazwa: 'cpdp.media',
    logo: 'images/brand/cpdp-mark.svg',
  },
  {
    cel: 'openbooks',
    href: 'https://openbooks.pl',
    nazwa: 'openbooks.pl',
    logo: 'storage/logos/openbooks.svg',
  },
  {
    cel: 'leniwy-posel',
    href: 'https://leniwyposel.pl',
    nazwa: 'leniwyposel.pl',
    logo: 'storage/logos/leniwy-posel.svg',
  },
  {
    cel: 'wyniki-szkol',
    href: 'https://cpdp.media/edukacja/',
    nazwa: 'Wyniki szkół',
    logo: 'storage/logos/wyniki-szkol.svg',
  },
  {
    cel: 'wokanda',
    href: 'https://cpdp.media/sady/',
    nazwa: 'Wokanda',
    logo: 'storage/logos/wokanda.svg',
  },
  {
    cel: 'z-dykty',
    href: 'https://z-dykty.pl',
    nazwa: 'z-dykty.pl',
    logo: 'storage/logos/z-dykty.svg',
  },
  {
    cel: 'mapa-przestepczosci',
    href: 'https://cpdp.media/przestepczosc/',
    nazwa: 'Mapa przestępczości',
    logo: 'storage/logos/mapa-przestepczosci.svg',
  },
]

/** Cienki pasek nad nagłówkiem, na każdym ekranie. Jego wysokość siedzi w --wys-naglowka (styles.css). */
const PRAWNE = [
  { id: 'met-prywatnosc', etykieta: 'Prywatność' },
  { id: 'met-cookies', etykieta: 'Cookies' },
  { id: 'met-regulamin', etykieta: 'Regulamin' },
]

/** Przewija do sekcji Metody, także z innego ekranu (Metoda ładuje się leniwie). */
function doSekcji(zdarzenie: MouseEvent<HTMLAnchorElement>, id: string) {
  // Na Metodzie przewijamy od razu; z innego ekranu link zmienia hash, a pętla czeka na sekcję.
  if (document.getElementById(id)) {
    zdarzenie.preventDefault()
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    return
  }
  const start = performance.now()
  const szukaj = () => {
    const sekcja = document.getElementById(id)
    // Po zmianie ekranu powłoka przenosi fokus na h1 i przewija na górę, więc czekamy chwilę dłużej.
    if (sekcja) setTimeout(() => sekcja.scrollIntoView({ block: 'start' }), 300)
    else if (performance.now() - start < 5000) requestAnimationFrame(szukaj)
  }
  requestAnimationFrame(szukaj)
}

export function PasekSerwisow() {
  const stan = useStan((s) => s)
  const hrefMetody = hrefDla(stan, { ekran: 'metoda' })
  return (
    <nav className="serwisy" aria-labelledby="serwisy-h">
      <h2 id="serwisy-h" className="serwisy-tytul">
        Serwisy współpracujące
      </h2>
      <ul>
        {SERWISY.map((s) => (
          <li key={s.cel}>
            <a href={s.href} target="_blank" rel="noopener" data-cel={`partner-${s.cel}`}>
              <img
                src={`https://cpdp.media/${s.logo}`}
                alt=""
                width={16}
                height={16}
                loading="lazy"
              />
              {s.nazwa}
              <span className="sr-only">(otwiera się w nowej karcie)</span>
            </a>
          </li>
        ))}
      </ul>
      <ul className="serwisy-prawne">
        {PRAWNE.map((p) => (
          <li key={p.id}>
            <a href={hrefMetody} onClick={(e) => doSekcji(e, p.id)}>
              {p.etykieta}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  )
}

/** Przycisk „Dla dziennikarzy” w nagłówku. */
export function PrzyciskDziennikarze() {
  return (
    <a
      className="dziennikarze"
      href="https://cpdp.media"
      target="_blank"
      rel="noopener"
      data-cel="partner-cpdp"
    >
      Dla dziennikarzy <span aria-hidden="true">↗</span>
      <span className="sr-only">(otwiera się w nowej karcie)</span>
    </a>
  )
}
