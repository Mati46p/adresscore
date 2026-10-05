// Pasek zakładek panelu (wzorzec WAI-ARIA „Tabs”). Rodzic montuje wyłącznie aktywną zakładkę, więc
// zapytania do bazy idą tylko po dane widoczne na ekranie (a pozostałe leżą w pamięci podręcznej).
//
// DOSTĘPNOŚĆ: `role=tablist`/`tab`, `aria-selected`, sterowanie strzałkami (←/→, Home/End) i
// „roving tabindex”: do paska wchodzi się Tabem raz, dalej strzałkami, jak w natywnych zakładkach.
// Aktywacja jest automatyczna (fokus = zmiana zakładki), bo panele są tanie do przełączenia.
// Stan aktywny jest jedynym akcentem paska (pogrubienie, kolor i podkreślenie akcentu).
import { type KeyboardEvent, useRef } from 'react'

export interface ElementPaska<T extends string> {
  id: T
  etykieta: string
  /** Doprecyzowanie dla czytników ekranu i podpowiedzi przy najechaniu. */
  tytul?: string
}

/** Id elementu `tab`; panel po drugiej stronie używa `idPanelu` z tym samym prefiksem. */
export function idPrzyciskuZakladki(prefiks: string, id: string): string {
  return `${prefiks}-tab-${id}`
}

/** Id elementu `tabpanel`. */
export function idPanelu(prefiks: string, id: string): string {
  return `${prefiks}-panel-${id}`
}

export function PasekZakladek<T extends string>({
  zakladki,
  aktywna,
  naZmiane,
  prefiks,
  etykieta,
}: {
  zakladki: readonly ElementPaska<T>[]
  aktywna: T
  naZmiane: (id: T) => void
  /** Prefiks id wiążących `tab` z `tabpanel`. */
  prefiks: string
  /** Nazwa paska dla czytników ekranu. */
  etykieta: string
}) {
  const przyciski = useRef<(HTMLButtonElement | null)[]>([])

  function naKlawisz(e: KeyboardEvent<HTMLDivElement>) {
    const ile = zakladki.length
    if (ile === 0) return
    const teraz = Math.max(
      0,
      zakladki.findIndex((z) => z.id === aktywna),
    )
    let cel: number
    switch (e.key) {
      case 'ArrowRight':
        cel = (teraz + 1) % ile
        break
      case 'ArrowLeft':
        cel = (teraz - 1 + ile) % ile
        break
      case 'Home':
        cel = 0
        break
      case 'End':
        cel = ile - 1
        break
      default:
        return
    }
    e.preventDefault()
    const nowa = zakladki[cel]
    if (!nowa) return
    naZmiane(nowa.id)
    przyciski.current[cel]?.focus()
  }

  return (
    // Klawisze obsługuje kontener, bo zdarzenie wraca z fokusowanej zakładki.
    <div role="tablist" aria-label={etykieta} className="panel-zakladki" onKeyDown={naKlawisz}>
      {zakladki.map((z, i) => {
        const wybrana = z.id === aktywna
        return (
          <button
            key={z.id}
            type="button"
            role="tab"
            id={idPrzyciskuZakladki(prefiks, z.id)}
            aria-controls={idPanelu(prefiks, z.id)}
            aria-selected={wybrana}
            tabIndex={wybrana ? 0 : -1}
            title={z.tytul}
            className="panel-zakladka"
            ref={(el) => {
              przyciski.current[i] = el
            }}
            onClick={() => naZmiane(z.id)}
          >
            {z.etykieta}
          </button>
        )
      })}
    </div>
  )
}
