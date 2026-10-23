// Zakładki z dostępnością (tablist): strzałki, Home/End, roving tabindex. Używane w arkuszu i na desktopie.
import type { KeyboardEvent, ReactNode } from 'react'

export interface Zakladka {
  id: string
  etykieta: string
}

interface Props {
  zakladki: Zakladka[]
  wybrana: string
  onWybierz: (id: string) => void
  /** Prefiks identyfikatorów: `${id}-zakladka-X`, `${id}-panel-X`. */
  id: string
  /** Etykieta listy zakładek dla czytnika ekranu. */
  etykieta?: string
  /** Render panelu wybranej zakładki; alternatywa dla `children`. */
  panel?: (id: string) => ReactNode
  children?: ReactNode
}

export function Zakladki({ zakladki, wybrana, onWybierz, id, etykieta, panel, children }: Props) {
  function naKlawisz(e: KeyboardEvent<HTMLDivElement>) {
    const i = zakladki.findIndex((z) => z.id === wybrana)
    let nast = -1
    if (e.key === 'ArrowRight') nast = (i + 1) % zakladki.length
    else if (e.key === 'ArrowLeft') nast = (i - 1 + zakladki.length) % zakladki.length
    else if (e.key === 'Home') nast = 0
    else if (e.key === 'End') nast = zakladki.length - 1
    if (nast < 0) return
    const cel = zakladki[nast]
    if (!cel) return
    e.preventDefault()
    onWybierz(cel.id)
    // Fokus idzie za wyborem (wzorzec z automatyczną aktywacją).
    document.getElementById(`${id}-zakladka-${cel.id}`)?.focus()
  }

  return (
    <>
      <div
        className="zakladki"
        role="tablist"
        aria-label={etykieta}
        onKeyDown={naKlawisz}
        style={{ gridTemplateColumns: `repeat(${zakladki.length}, 1fr)` }}
      >
        {zakladki.map((z) => (
          <button
            key={z.id}
            type="button"
            role="tab"
            id={`${id}-zakladka-${z.id}`}
            aria-selected={z.id === wybrana}
            aria-controls={`${id}-panel-${z.id}`}
            tabIndex={z.id === wybrana ? 0 : -1}
            onClick={() => onWybierz(z.id)}
          >
            {z.etykieta}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={`${id}-panel-${wybrana}`}
        aria-labelledby={`${id}-zakladka-${wybrana}`}
      >
        {panel ? panel(wybrana) : children}
      </div>
    </>
  )
}
