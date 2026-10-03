import { useDane } from '@/wynik/dane'
import { PERSONY, TRYBY } from '@/wynik/persony'
import { useStan, ustawTryb, wybierzPersone } from '@/wynik/stan'

/**
 * Slot #36 – persony, tryb kupuję/wynajmuję, wagi 0–4 i kierunki (makieta: Main.dc.html,
 * sekcje „Czego szukasz", „Profil", „Warstwy i wagi").
 * TODO #36: grupy warstw z wagami (ustawWage) i kierunkami (ustawKierunek), źródło przy
 * każdej warstwie, licznik aktywnych. Tryb i persony poniżej to minimum, żeby mapa żyła.
 */
export function PanelFiltrow() {
  const dane = useDane()
  const tryb = useStan((s) => s.tryb)
  const persona = useStan((s) => s.persona)
  const wagi = useStan((s) => s.wagi)
  const aktywne = Object.values(wagi).filter((w) => w > 0).length
  const wszystkie = dane.stan === 'gotowe' ? dane.wskazniki.length : 0

  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <h1 style={{ margin: 0, fontSize: 28, lineHeight: 1.15, letterSpacing: '-0.02em' }}>
          Znajdź okolicę w Krakowie
        </h1>
        <p style={{ margin: 0, fontSize: 15, lineHeight: 1.5, color: 'var(--tekst-2)' }}>
          Każda zmiana po lewej od razu przelicza kolory na mapie.
        </p>
      </div>

      <section
        aria-labelledby="h-tryb"
        style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
      >
        <h2 id="h-tryb" className="etykieta-sekcji">
          Czego szukasz
        </h2>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {TRYBY.map((t) => (
            <button
              key={t.id}
              type="button"
              className="seg"
              title={t.opis}
              aria-pressed={tryb === t.id}
              onClick={() => ustawTryb(t.id)}
            >
              {t.nazwa}
            </button>
          ))}
        </div>
      </section>

      <section
        aria-labelledby="h-persona"
        style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
      >
        <h2 id="h-persona" className="etykieta-sekcji">
          Profil (ustawia wagi)
        </h2>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {PERSONY.map((p) => (
            <button
              key={p.id}
              type="button"
              className="seg"
              title={p.opis}
              aria-pressed={persona === p.id}
              onClick={() => wybierzPersone(p.id)}
            >
              {p.nazwa}
            </button>
          ))}
        </div>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--tekst-2)' }}>
          {aktywne} z {wszystkie} warstw aktywnych{persona === 'wlasna' ? ' · wagi własne' : ''}
        </p>
      </section>
    </>
  )
}
