import { useState } from 'react'
import { MapaKrakowa } from '@/mapa/MapaKrakowa'
import { useDane } from '@/wynik/dane'
import { kierunekEfektywny } from '@/wynik/silnik'
import {
  dodajDoPorownania,
  pokazOkolice,
  przejdz,
  useStan,
  ustawWarstwe,
  usunZPorownania,
  wybierzAdres,
} from '@/wynik/stan'
import { MAKS_POROWNANIE } from '@/wynik/url'
import { useWyniki } from '@/wynik/useWyniki'
import { opisAdresu } from './adres'
import { PanelFiltrow } from './panel/PanelFiltrow'
import { Ranking } from './Ranking'
import { adresWKliknietymHeksie } from './wyszukiwarka/heks'
import './szukaj.css'

// Stała, bo nowa pusta mapa przy każdym renderze wymuszałaby przemalowanie warstwy heksów.
const BRAK_HEKSOW: ReadonlyMap<string, number | null> = new Map()

/** Ekran 1 wg docs/makieta/Main.dc.html: panel filtrów po lewej, mapa po prawej. */
export function EkranSzukaj() {
  const dane = useDane()
  const warstwa = useStan((s) => s.warstwa)
  const wybrany = useStan((s) => s.wybrany)
  const porownanie = useStan((s) => s.porownanie)
  const kierunki = useStan((s) => s.kierunki)
  const [komunikatHeksow, setKomunikatHeksow] = useState('')
  const wyniki = useWyniki()
  const adres = dane.stan === 'gotowe' && wybrany !== null ? dane.adresy[wybrany] : undefined
  const wybraneAdresy =
    dane.stan === 'gotowe'
      ? porownanie.flatMap((i) => {
          const wybranyAdres = dane.adresy[i]
          return wybranyAdres ? [wybranyAdres] : []
        })
      : []
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
            <p>
              Profil i wagi poniżej od razu przeliczają kolory na mapie. Kliknij mapę, żeby zobaczyć
              okolicę i dodać jej heks do porównania.
            </p>
          </div>
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
              wykluczone={wyniki?.wykluczoneHeksy}
              wybrany={adres ? { lon: adres.lon, lat: adres.lat } : null}
              onKlik={(lon, lat) => {
                if (dane.stan !== 'gotowe') return
                const kandydat = adresWKliknietymHeksie(dane.adresy, lon, lat)
                if (!kandydat.adres) {
                  setKomunikatHeksow('W tym heksie nie ma adresu. Wybierz inny heks.')
                  return
                }
                const juzWybrany = wybraneAdresy.find((a) => a.h3 === kandydat.h3)
                wybierzAdres(juzWybrany?.i ?? kandydat.adres.i)
                if (juzWybrany) {
                  usunZPorownania(juzWybrany.i)
                  setKomunikatHeksow('Usunięto heks z porównania.')
                  return
                }
                if (porownanie.length >= MAKS_POROWNANIE) {
                  setKomunikatHeksow('Możesz porównać maksymalnie 5 heksów. Usuń jeden z listy.')
                  return
                }
                dodajDoPorownania(kandydat.adres.i)
                setKomunikatHeksow('Dodano heks do porównania.')
              }}
            />
            {wybraneAdresy.length > 0 ? (
              <div
                className="heksy-pasek"
                aria-label="Heksy do porównania"
                data-liczba={wybraneAdresy.length}
              >
                <div className="heksy-pasek__naglowek">
                  <strong>Heksy do porównania</strong>
                  <span>
                    {wybraneAdresy.length}/{MAKS_POROWNANIE}
                  </span>
                </div>
                <button
                  type="button"
                  className="heksy-pasek__akcja"
                  onClick={() => przejdz('porownanie')}
                >
                  Porównaj ({wybraneAdresy.length})
                </button>
                <div className="heksy-pasek__lista">
                  {wybraneAdresy.map((a) => (
                    <span
                      className="heksy-pasek__chip"
                      data-aktywny={a.i === wybrany || undefined}
                      key={a.i}
                    >
                      <span title={`${opisAdresu(a)} · heks ${a.h3}`}>{opisAdresu(a)}</span>
                      <button
                        type="button"
                        aria-label={`Usuń heks ${opisAdresu(a)} z porównania`}
                        onClick={() => usunZPorownania(a.i)}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            ) : (
              <span className="heksy-podpowiedz">Kliknij heks, aby porównać</span>
            )}
            <span className="sr-only" role="status">
              {komunikatHeksow}
            </span>
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
                {wyniki?.wykluczenia.wykluczony[adres.i] ? ' · wykluczony filtrem' : ''}
                {wyniki?.wykluczenia.niewiadomy[adres.i]
                  ? ' · nie wiemy, czy spełnia filtr (brak danych)'
                  : ''}
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
