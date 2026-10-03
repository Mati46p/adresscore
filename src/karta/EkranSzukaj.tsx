import { MapaPolski } from '@/components/MapaPolski'
import { useDane } from '@/wynik/dane'
import { useStan, ustawWarstwe } from '@/wynik/stan'
import { PanelFiltrow } from './panel/PanelFiltrow'
import { Ranking } from './Ranking'

/** Ekran 1 wg docs/makieta/Main.dc.html: panel filtrów po lewej, mapa po prawej. */
export function EkranSzukaj() {
  const dane = useDane()
  const warstwa = useStan((s) => s.warstwa)
  // Przełącznik pokazuje tylko warstwy, które coś oceniają – kontekst nie ma skali 0–100.
  const warstwy =
    dane.stan === 'gotowe'
      ? dane.wskazniki.filter(
          (w) => w.meta.kategoria !== 'kontekst' && w.meta.kierunek !== 'neutralny',
        )
      : []

  return (
    <main className="szukaj">
      <aside aria-label="Filtry" className="szukaj-panel">
        {/* TODO #11: <Wyszukiwarka adresy={dane.adresy} onWybierz={pokazOkolice} /> z @/karta/wyszukiwarka/Wyszukiwarka */}
        <div data-slot="wyszukiwarka">
          <label htmlFor="szukaj-adres" className="etykieta-sekcji">
            Adres
          </label>
          <input
            id="szukaj-adres"
            className="pole"
            type="search"
            placeholder="np. ul. Długa 12, Kraków"
            disabled
            aria-describedby="szukaj-adres-wkrotce"
          />
          <small id="szukaj-adres-wkrotce" style={{ color: 'var(--tekst-3)' }}>
            Wyszukiwarka wkrótce.
          </small>
        </div>
        <PanelFiltrow />
      </aside>

      <section aria-label="Mapa Krakowa" className="szukaj-mapa">
        <div role="group" aria-label="Co pokazuje mapa" className="pasek-warstw">
          <button
            type="button"
            className="seg"
            aria-pressed={warstwa === 'wynik'}
            onClick={() => ustawWarstwe('wynik')}
          >
            Twój wynik
          </button>
          {warstwy.map((w) => (
            <button
              key={w.meta.id}
              type="button"
              className="seg"
              aria-pressed={warstwa === w.meta.id}
              onClick={() => ustawWarstwe(w.meta.id)}
            >
              {w.meta.nazwa}
            </button>
          ))}
        </div>
        {/* TODO #13: <MapaKrakowa heksy={wyniki.heksy} podpisWarstwy={wyniki.podpis} wybrany=… onKlik=… /> */}
        <div className="slot-mapy" data-slot="mapa">
          <MapaPolski />
        </div>
        <Ranking />
      </section>
    </main>
  )
}
