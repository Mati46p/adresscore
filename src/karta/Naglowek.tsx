import { hrefDla, useStan } from '@/wynik/stan'
import type { Ekran } from '@/wynik/url'
import { Logo } from './Logo'

const KROKI: { ekran: Ekran; etykieta: string }[] = [
  { ekran: 'szukaj', etykieta: '1 Szukaj' },
  { ekran: 'okolica', etykieta: '2 Okolica' },
  { ekran: 'porownanie', etykieta: '3 Porównanie' },
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
            href={hrefDla(stan, { ekran: k.ekran })}
            className="krok"
            aria-current={stan.ekran === k.ekran ? 'step' : undefined}
          >
            {k.etykieta}
          </a>
        ))}
        <a
          href={hrefDla(stan, { ekran: 'metoda' })}
          className="krok krok-metoda"
          aria-current={stan.ekran === 'metoda' ? 'page' : undefined}
        >
          Metoda i źródła
        </a>
      </nav>
    </header>
  )
}
