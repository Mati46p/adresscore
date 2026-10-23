// Dolny arkusz z trzema stanami (zwinięty / połowa / pełny): przeciąganie, rzut z prędkością, klawiatura.
// Ruch idzie wprost do stylu (`--arkusz-y`), bez setState w trakcie gestu. Decyzję „telefon czy desktop” podejmuje rodzic.
import { type ReactNode, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import {
  najblizszyProg,
  type PrzesuniecieStanu,
  predkosc,
  przesunieciaStanow,
  zGumka,
} from './fizykaArkusza'
import './arkusz.css'

export type StanArkusza = 'zwiniety' | 'polowa' | 'pelny'

interface Props {
  stan: StanArkusza
  onStan: (s: StanArkusza) => void
  /** aria-label uchwytu i <aside>. */
  etykieta: string
  /** Zawsze widoczny (stan zwinięty): podsumowanie i pole. */
  naglowek: ReactNode
  /** Reszta, widoczna w stanach połowa i pełny. */
  children: ReactNode
  /** Wysokość widocznej części arkusza po osiadnięciu (do paddingu mapy). */
  onOdstep?: (px: number) => void
}

const KOLEJNOSC: StanArkusza[] = ['zwiniety', 'polowa', 'pelny']
const PROG_RUCHU = 8
const MIN_ZWINIETY = 112
const POLE = 'input, textarea, select'

interface Pomiar {
  wysokosc: number
  progi: PrzesuniecieStanu
}

function ograniczRuch(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** Wywołuje `fn` po zakończeniu przejścia transformacji (od razu przy reduced-motion). */
function poOsiadnieciu(el: HTMLElement, fn: () => void) {
  if (ograniczRuch()) {
    fn()
    return
  }
  let zrobione = false
  const raz = () => {
    if (zrobione) return
    zrobione = true
    el.removeEventListener('transitionend', naKoniec)
    window.clearTimeout(zapas)
    fn()
  }
  const naKoniec = (e: TransitionEvent) => {
    if (e.target === el && e.propertyName === 'transform') raz()
  }
  // Zapas na przypadek, gdy transitionend nie przyjdzie (brak zmiany pozycji, karta w tle).
  const zapas = window.setTimeout(raz, 450)
  el.addEventListener('transitionend', naKoniec)
}

function zmierz(aside: HTMLElement, naglowek: HTMLElement, uchwyt: HTMLElement): Pomiar {
  const vh = window.visualViewport?.height ?? window.innerHeight
  const wysokosc = aside.offsetHeight
  const wysZwinietego = Math.max(MIN_ZWINIETY, uchwyt.offsetHeight + naglowek.offsetHeight)
  return { wysokosc, progi: przesunieciaStanow(vh, vh - wysokosc - 8, wysZwinietego) }
}

function stanDlaProgu(y: number, progi: PrzesuniecieStanu): StanArkusza {
  return KOLEJNOSC.reduce((a, b) => (Math.abs(progi[b] - y) < Math.abs(progi[a] - y) ? b : a))
}

export function ArkuszDolny({ stan, onStan, etykieta, naglowek, children, onOdstep }: Props) {
  const idTresci = useId()
  const asideRef = useRef<HTMLElement>(null)
  const uchwytRef = useRef<HTMLButtonElement>(null)
  const naglowekRef = useRef<HTMLDivElement>(null)
  const trescRef = useRef<HTMLDivElement>(null)
  const [pomiar, setPomiar] = useState<Pomiar | null>(null)

  // Najświeższe wartości dla natywnych nasłuchów gestu (zakładane raz, bez ponownego podpinania).
  const swiezo = useRef({ stan, onStan, onOdstep, pomiar })
  useEffect(() => {
    swiezo.current = { stan, onStan, onOdstep, pomiar }
  })
  const przeciagniety = useRef(false)
  const pierwszy = useRef(true)

  // Pomiar: zmiana rozmiaru okna, klawiatura (visualViewport) i wysokość nagłówka.
  useLayoutEffect(() => {
    const aside = asideRef.current
    const nag = naglowekRef.current
    const uch = uchwytRef.current
    if (!aside || !nag || !uch) return
    const odmierz = () => setPomiar(zmierz(aside, nag, uch))
    odmierz()
    const obserwator = new ResizeObserver(odmierz)
    obserwator.observe(nag)
    obserwator.observe(aside)
    window.addEventListener('resize', odmierz)
    window.visualViewport?.addEventListener('resize', odmierz)
    return () => {
      obserwator.disconnect()
      window.removeEventListener('resize', odmierz)
      window.visualViewport?.removeEventListener('resize', odmierz)
    }
  }, [])

  // Ustawienie arkusza w stanie z propsa (po zmianie stanu albo pomiaru).
  useLayoutEffect(() => {
    const aside = asideRef.current
    if (!aside || !pomiar) return
    const y = pomiar.progi[stan]
    if (pierwszy.current) {
      // Pierwsze ustawienie bez animacji, żeby arkusz nie wjeżdżał z dołu przy montowaniu.
      pierwszy.current = false
      aside.dataset.przeciaganie = 'tak'
      aside.style.setProperty('--arkusz-y', `${y}px`)
      aside.getBoundingClientRect()
      delete aside.dataset.przeciaganie
      swiezo.current.onOdstep?.(Math.round(pomiar.wysokosc - y))
      return
    }
    aside.style.setProperty('--arkusz-y', `${y}px`)
    poOsiadnieciu(aside, () => swiezo.current.onOdstep?.(Math.round(pomiar.wysokosc - y)))
  }, [stan, pomiar])

  // Gest przeciągania: pointer na uchwycie i nagłówku, dotyk na treści (z przejmowaniem przy scrollTop 0).
  useEffect(() => {
    const aside = asideRef.current
    const uchwyt = uchwytRef.current
    const nag = naglowekRef.current
    const tresc = trescRef.current
    if (!aside || !uchwyt || !nag || !tresc) return

    type Gest = {
      start: number
      y0: number
      zlapany: boolean
      probki: { y: number; t: number }[]
    }
    let g: Gest | null = null
    let biezace = 0

    const progiTeraz = () => swiezo.current.pomiar?.progi
    const poczatek = (clientY: number) => {
      const p = progiTeraz()
      if (!p) return
      g = { start: clientY, y0: p[swiezo.current.stan], zlapany: false, probki: [] }
      biezace = g.y0
    }
    const ruch = (clientY: number): boolean => {
      const p = progiTeraz()
      if (!g || !p) return false
      const dy = clientY - g.start
      if (!g.zlapany && Math.abs(dy) > PROG_RUCHU) {
        g.zlapany = true
        aside.dataset.przeciaganie = 'tak'
      }
      if (!g.zlapany) return false
      g.probki.push({ y: clientY, t: performance.now() })
      if (g.probki.length > 5) g.probki.shift()
      biezace = zGumka(g.y0 + dy, 0, p.zwiniety)
      aside.style.setProperty('--arkusz-y', `${biezace}px`)
      return true
    }
    const koniec = () => {
      const p = progiTeraz()
      const ten = g
      g = null
      if (!ten?.zlapany || !p) return
      przeciagniety.current = true
      window.setTimeout(() => {
        przeciagniety.current = false
      }, 0)
      const cel = najblizszyProg(biezace, predkosc(ten.probki), [p.pelny, p.polowa, p.zwiniety])
      delete aside.dataset.przeciaganie
      aside.getBoundingClientRect()
      aside.style.setProperty('--arkusz-y', `${cel}px`)
      const nowy = stanDlaProgu(cel, p)
      if (nowy !== swiezo.current.stan) swiezo.current.onStan(nowy)
      const wysokosc = swiezo.current.pomiar?.wysokosc ?? 0
      poOsiadnieciu(aside, () => swiezo.current.onOdstep?.(Math.round(wysokosc - cel)))
    }

    // Pointer (mysz, rysik, dotyk) na uchwycie i nagłówku.
    const wDol = (e: PointerEvent) => {
      if (e.button !== 0 || (e.target as Element).closest(POLE)) return
      poczatek(e.clientY)
    }
    const wRuchu = (e: PointerEvent) => {
      const bylZlapany = g?.zlapany
      if (ruch(e.clientY) && !bylZlapany) {
        ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
      }
    }
    const wGore = () => koniec()
    for (const el of [uchwyt, nag] as HTMLElement[]) {
      el.addEventListener('pointerdown', wDol)
      el.addEventListener('pointermove', wRuchu)
      el.addEventListener('pointerup', wGore)
      el.addEventListener('pointercancel', wGore)
    }
    // Po przeciągnięciu uchwyt nie ma zmieniać stanu kliknięciem.
    const tlumKlik = (e: Event) => {
      if (przeciagniety.current) e.stopPropagation()
    }
    uchwyt.addEventListener('click', tlumKlik, true)

    // Dotyk na treści.
    const dotykStart = (e: TouchEvent) => poczatek(e.touches[0]?.clientY ?? 0)
    const dotykRuch = (e: TouchEvent) => {
      if (!g) return
      const y = e.touches[0]?.clientY ?? 0
      if (swiezo.current.stan === 'pelny' && !g.zlapany) {
        const p = progiTeraz()
        // Treść jeszcze się przewija albo ruch w górę: gest należy do przewijania.
        if (tresc.scrollTop > 0 || y <= g.start) {
          g.start = y
          g.y0 = p ? p.pelny : 0
          return
        }
      }
      if (ruch(y) || swiezo.current.stan !== 'pelny') e.preventDefault()
    }
    tresc.addEventListener('touchstart', dotykStart, { passive: true })
    tresc.addEventListener('touchmove', dotykRuch, { passive: false })
    tresc.addEventListener('touchend', koniec)
    tresc.addEventListener('touchcancel', koniec)

    return () => {
      for (const el of [uchwyt, nag] as HTMLElement[]) {
        el.removeEventListener('pointerdown', wDol)
        el.removeEventListener('pointermove', wRuchu)
        el.removeEventListener('pointerup', wGore)
        el.removeEventListener('pointercancel', wGore)
      }
      uchwyt.removeEventListener('click', tlumKlik, true)
      tresc.removeEventListener('touchstart', dotykStart)
      tresc.removeEventListener('touchmove', dotykRuch)
      tresc.removeEventListener('touchend', koniec)
      tresc.removeEventListener('touchcancel', koniec)
    }
  }, [])

  const indeks = KOLEJNOSC.indexOf(stan)

  function zmienPoziom(krok: number) {
    const nowy = KOLEJNOSC[Math.min(KOLEJNOSC.length - 1, Math.max(0, indeks + krok))] ?? stan
    if (nowy !== stan) onStan(nowy)
  }

  return (
    <aside
      ref={asideRef}
      className="arkusz"
      aria-label={etykieta}
      data-stan={stan}
      onKeyDown={(e) => {
        if (e.key !== 'Escape' || e.defaultPrevented || stan === 'zwiniety') return
        e.preventDefault()
        zmienPoziom(-1)
        uchwytRef.current?.focus()
      }}
      onFocusCapture={(e) => {
        if (stan !== 'pelny' && (e.target as Element).matches(POLE)) onStan('pelny')
      }}
    >
      <button
        ref={uchwytRef}
        type="button"
        className="arkusz__uchwyt"
        aria-expanded={stan !== 'zwiniety'}
        aria-controls={idTresci}
        aria-label={etykieta}
        onClick={() => onStan(KOLEJNOSC[(indeks + 1) % KOLEJNOSC.length] ?? stan)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp') {
            e.preventDefault()
            zmienPoziom(1)
          } else if (e.key === 'ArrowDown') {
            e.preventDefault()
            zmienPoziom(-1)
          }
        }}
      />
      <div ref={naglowekRef} className="arkusz__naglowek">
        {naglowek}
      </div>
      <div ref={trescRef} id={idTresci} className="arkusz__tresc" inert={stan === 'zwiniety'}>
        {children}
      </div>
    </aside>
  )
}
