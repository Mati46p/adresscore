import { hrefDla, useStan } from '@/wynik/stan'
import { TRYBY_APLIKACJI, trybEkranu } from '@/wynik/trybyAplikacji'
import type { Ekran } from '@/wynik/url'
import { Logo } from './Logo'
import { przygotujEkran } from './ladowanieEkranow'
import './tryby.css'

// Kroki zwykłej pracy mieszkańca. „Dla miasta” i „Dla biznesu” to osobne tryby (przełącznik obok).
const KROKI: { ekran: Ekran; etykieta: string }[] = [
  { ekran: 'szukaj', etykieta: 'Szukaj' },
  { ekran: 'katalog', etykieta: 'Katalog adresów' },
  { ekran: 'porownanie', etykieta: 'Porównanie' },
]

export function Naglowek() {
  const stan = useStan((s) => s)
  const aktywnyTryb = trybEkranu(stan.ekran)

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
      <nav aria-label="Tryb pracy" className="tryby">
        {TRYBY_APLIKACJI.map((t) => (
          <a
            key={t.id}
            href={hrefDla(stan, {
              ekran: t.ekran,
              ...(t.id === 'biznes' ? { tryb: 'biznes' } : {}),
            })}
            onMouseEnter={() => przygotujEkran(t.ekran)}
            onFocus={() => przygotujEkran(t.ekran)}
            className="tryb"
            aria-current={aktywnyTryb === t.id ? 'page' : undefined}
          >
            {t.etykieta}
          </a>
        ))}
      </nav>
    </header>
  )
}
