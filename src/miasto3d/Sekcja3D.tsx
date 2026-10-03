// Lekka obudowa sekcji „Okolica w 3D” na karcie adresu. deck.gl i druga instancja mapy to
// kilkaset kB, więc moduł sceny ładuje się dopiero, gdy sekcja zbliża się do ekranu.
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { trybLekki } from '@/wynik/lekki'

const Okolica3D = lazy(() => import('./Okolica3D'))

export function Sekcja3D() {
  const ref = useRef<HTMLElement>(null)
  const [widoczna, setWidoczna] = useState(false)
  const lekki = trybLekki()

  useEffect(() => {
    const el = ref.current
    if (!el || widoczna || lekki) return
    if (!('IntersectionObserver' in window)) {
      setWidoczna(true)
      return
    }
    const obserwator = new IntersectionObserver(
      (wpisy) => {
        if (wpisy.some((w) => w.isIntersecting)) setWidoczna(true)
      },
      { rootMargin: '300px' },
    )
    obserwator.observe(el)
    return () => obserwator.disconnect()
  }, [widoczna, lekki])

  if (lekki) return null

  return (
    <section ref={ref} aria-labelledby="h-3d" className="karta">
      <h2 id="h-3d" className="okol-h2">
        Okolica w 3D
      </h2>
      <p className="okol-podpis">Budynki w promieniu 500 m w kolorze wyniku ich adresów.</p>
      {widoczna ? (
        <Suspense fallback={<div className="m3d-mapa m3d-zaslepka">Wczytuję widok 3D…</div>}>
          <Okolica3D />
        </Suspense>
      ) : (
        <div className="m3d-mapa m3d-zaslepka" />
      )}
    </section>
  )
}
