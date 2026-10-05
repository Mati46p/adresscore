// Podpowiedź przy liczbie: znaczek „i”, a po kliknięciu pełna definicja ze słownika (co liczy,
// okres, kierunek skali i – ważniejsze od reszty – pułapka interpretacji).
//
// DLACZEGO NIE `title=`: natywny dymek pojawia się po sekundzie, nie da się go otworzyć palcem i
// nie widać go na zrzucie ekranu ani na rzutniku. Wyjaśnienie liczby nie może istnieć tylko dla
// myszy na komputerze.
//
// DLACZEGO NATYWNY POPOVER: dymek trafia do warstwy górnej, więc nie przytnie go żaden
// `overflow-x: auto` (a tabele panelu są w przewijanych opakowaniach). Przeglądarka daje przy
// okazji zamykanie klawiszem Esc i kliknięciem obok, bez własnego kodu. Przycisk przełącza dymek
// deklaratywnie (`popovertarget`), więc klik na otwartym dymku go zamyka, zamiast otwierać znowu.
//
// DOSTĘPNOŚĆ: to przycisk (Tab, Enter, spacja) z `aria-expanded` i `aria-describedby`, więc
// definicja jest dostępna czytnikowi także bez otwierania. Hover nie jest jedyną ścieżką; w ogóle
// nie otwiera dymka (cel nie ucieka spod kursora, a dotyk działa tak samo).
// Elementy dymka to `span`y (z `display: block` w CSS), żeby podpowiedź mogła stać także w
// nagłówku (`h2`/`h3` przyjmuje tylko treść liniową).
import { useId, useRef, useState } from 'react'
import { haslo, type KluczHasla } from '@/panel/slownik'

/** Odstęp dymka od znaczka i od krawędzi okna. */
const LUZ = 8

export function Podpowiedz({ klucz }: { klucz: KluczHasla }) {
  const h = haslo(klucz)
  const idDymka = useId()
  const przycisk = useRef<HTMLButtonElement>(null)
  const dymek = useRef<HTMLSpanElement>(null)
  const [otwarta, setOtwarta] = useState(false)

  /** Pozycja liczona raz, przy otwarciu: pod znaczkiem, a gdy brakuje miejsca, nad nim. */
  function ustawPozycje() {
    const znaczek = przycisk.current
    const okno = dymek.current
    if (!znaczek || !okno) return
    const p = znaczek.getBoundingClientRect()
    const d = okno.getBoundingClientRect()
    const left = Math.max(LUZ, Math.min(p.left, window.innerWidth - d.width - LUZ))
    const zmiesciSieNizej = p.bottom + LUZ + d.height <= window.innerHeight - LUZ
    const top = zmiesciSieNizej ? p.bottom + LUZ : Math.max(LUZ, p.top - d.height - LUZ)
    okno.style.left = `${left}px`
    okno.style.top = `${top}px`
    okno.dataset.gotowy = ''
  }

  return (
    <>
      <button
        ref={przycisk}
        type="button"
        className="panel-podpowiedz"
        popoverTarget={idDymka}
        aria-expanded={otwarta}
        aria-describedby={idDymka}
        aria-label={`Co to znaczy: ${h.nazwa}`}
        onBlur={() => {
          // Fokus uciekł z klawiatury: dymek nie zostaje otwarty na ekranie (Esc też go zamyka).
          if (dymek.current?.matches(':popover-open')) dymek.current.hidePopover()
        }}
      >
        <span aria-hidden="true">i</span>
      </button>
      {/* `role=tooltip`, nie `dialog`: treść opisuje liczbę, więc czytnik ma ją podać jako
          objaśnienie, a nie ogłaszać okno modalne i przenosić do niego fokus. */}
      <span
        ref={dymek}
        id={idDymka}
        popover="auto"
        role="tooltip"
        className="panel-podpowiedz-dymek"
        onToggle={(e) => {
          const otwarty = e.newState === 'open'
          setOtwarta(otwarty)
          if (otwarty) ustawPozycje()
          else if (dymek.current) delete dymek.current.dataset.gotowy
        }}
      >
        <span className="panel-podpowiedz-nazwa">{h.nazwa}</span>
        <span>{h.liczy}</span>
        {h.pulapka ? (
          <span className="panel-podpowiedz-pulapka">
            <strong>Uwaga: </strong>
            {h.pulapka}
          </span>
        ) : null}
        {h.kierunek ? (
          <span className="panel-podpowiedz-meta">Kierunek skali: {h.kierunek}</span>
        ) : null}
        {h.okno ? <span className="panel-podpowiedz-meta">Okres: {h.okno}</span> : null}
      </span>
    </>
  )
}
