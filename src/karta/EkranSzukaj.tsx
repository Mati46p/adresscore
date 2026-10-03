import { MapaKrakowa } from '@/mapa/MapaKrakowa'
import { useDane } from '@/wynik/dane'
import { kierunekEfektywny } from '@/wynik/silnik'
import { pokazOkolice, useStan, ustawWarstwe, wybierzAdres } from '@/wynik/stan'
import { useWyniki } from '@/wynik/useWyniki'
import { PanelFiltrow } from './panel/PanelFiltrow'
import { Ranking } from './Ranking'
import { najblizszyAdres } from './wyszukiwarka/najblizszy'
import { Wyszukiwarka } from './wyszukiwarka/Wyszukiwarka'

// Stała, bo nowa pusta mapa przy każdym renderze wymuszałaby przemalowanie warstwy heksów.
const BRAK_HEKSOW: ReadonlyMap<string, number | null> = new Map()

/** Ekran 1 wg docs/makieta/Main.dc.html: panel filtrów po lewej, mapa po prawej. */
export function EkranSzukaj() {
  const dane = useDane()
  const warstwa = useStan((s) => s.warstwa)
  const wybrany = useStan((s) => s.wybrany)
  const kierunki = useStan((s) => s.kierunki)
  const wyniki = useWyniki()
  const adres = dane.stan === 'gotowe' && wybrany !== null ? dane.adresy[wybrany] : undefined
  const wynikWybranego = adres && wyniki ? wyniki.naAdres[adres.i] : undefined
  // Przełącznik pokazuje tylko warstwy, które coś oceniają. Liczy się kierunek efektywny:
  // warstwa neutralna z kierunkiem nadanym przez personę wchodzi do wyniku, więc ma przycisk.
  const warstwy =
    dane.stan === 'gotowe'
      ? dane.wskazniki.filter((w) => kierunekEfektywny(w.meta, kierunki) !== null)
      : []

  return (
    <main className="szukaj">
      <div className="szukaj-lewa">
        <div className="szukaj-wyszukaj">
          <div className="panel-wstep">
            <h1 tabIndex={-1}>Znajdź okolicę w Krakowie</h1>
            <p>Profil i wagi poniżej od razu przeliczają kolory na mapie.</p>
          </div>
          {dane.stan === 'gotowe' ? (
            <Wyszukiwarka adresy={dane.adresy} onWybierz={pokazOkolice} />
          ) : (
            <p className="etykieta-sekcji">Wczytuję adresy…</p>
          )}
        </div>
        <aside aria-label="Filtry" className="szukaj-filtry">
          <PanelFiltrow />
        </aside>
      </div>

      <div className="szukaj-prawa">
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
          <div className="slot-mapy" data-slot="mapa">
            <MapaKrakowa
              heksy={wyniki?.heksy ?? BRAK_HEKSOW}
              podpisWarstwy={wyniki?.podpis ?? 'Twój wynik'}
              wybrany={adres ? { lon: adres.lon, lat: adres.lat } : null}
              onKlik={(lon, lat) => {
                if (dane.stan !== 'gotowe') return
                wybierzAdres(najblizszyAdres(dane.adresy, lon, lat))
              }}
            />
          </div>
          {adres && (
            <div className="wybrany-adres">
              <span role="status">
                <strong>
                  {adres.ulica ?? adres.miejscowosc} {adres.nr}
                </strong>
                {' · '}
                {wynikWybranego === undefined || Number.isNaN(wynikWybranego)
                  ? 'brak danych'
                  : `${wyniki?.podpis}: ${Math.round(wynikWybranego)}`}
              </span>
              <button type="button" className="seg wlaczony" onClick={() => pokazOkolice(adres.i)}>
                Otwórz kartę
              </button>
            </div>
          )}
        </section>
        <Ranking />
      </div>
    </main>
  )
}
