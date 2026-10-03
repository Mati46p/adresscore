import { hrefDla, useStan } from '@/wynik/stan'
import type { Ekran } from '@/wynik/url'
import { Logo } from './Logo'
import { przygotujEkran } from './ladowanieEkranow'

const KROKI: { ekran: Ekran; etykieta: string }[] = [
  { ekran: 'szukaj', etykieta: 'Szukaj' },
  { ekran: 'katalog', etykieta: 'Katalog adresów' },
  { ekran: 'biznes', etykieta: 'Dla biznesu' },
  { ekran: 'porownanie', etykieta: 'Porównanie' },
]

export function Naglowek() {
  const stan = useStan((s) => s)

  return (
    <header className="naglowek">
      <a href={hrefDla(stan, { ekran: 'szukaj' })} className="logo">
        <Logo />
        <span>adresscore</span>
        <span className="logo-miasto">Kraków</span>
      </a>
      <nav aria-label="Kroki" className="kroki">
        {KROKI.map((k) => (
          <a
            key={k.ekran}
            href={hrefDla(stan, {
              ekran: k.ekran,
              ...(k.ekran === 'biznes' ? { tryb: 'biznes' } : {}),
            })}
            onMouseEnter={() => przygotujEkran(k.ekran)}
            onFocus={() => przygotujEkran(k.ekran)}
            className="krok"
            aria-current={stan.ekran === k.ekran ? 'step' : undefined}
          >
            {k.etykieta}
          </a>
        ))}
        <a
          href={hrefDla(stan, { ekran: 'metoda' })}
          onMouseEnter={() => przygotujEkran('metoda')}
          onFocus={() => przygotujEkran('metoda')}
          className="krok krok-metoda"
          aria-current={stan.ekran === 'metoda' ? 'page' : undefined}
        >
          Metoda i źródła
        </a>
      </nav>
    </header>
  )
}
