import { lazy, Suspense, useState } from 'react'
import { PoleOpiszSiebie } from '@/ai/PoleOpiszSiebie'
import { useDane } from '@/wynik/dane'
import { BIZNESY, warstwyBiznesu } from '@/wynik/persony'
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
import { usePropsSasiadowMapy } from '@/wynik/useSasiedzi'
import { useWyniki } from '@/wynik/useWyniki'
import { useWstepnaMapa } from '@/wynik/wstepnaMapa'
import { opisAdresu } from './adres'
import { PanelBudzetu } from './panel/PanelBudzetu'
import { PanelFiltrow } from './panel/PanelFiltrow'
import { Ranking } from './Ranking'
import { adresWKliknietymHeksie } from './wyszukiwarka/heks'
import './szukaj.css'

const MapaKrakowa = lazy(async () => ({
  default: (await import('@/mapa/MapaKrakowa')).MapaKrakowa,
}))

// Stała, bo nowa pusta mapa przy każdym renderze wymuszałaby przemalowanie warstwy heksów.
const BRAK_HEKSOW: ReadonlyMap<string, number | null> = new Map()

/** Ekran 1 wg docs/makieta/Main.dc.html: panel filtrów po lewej, mapa po prawej. */
export function EkranSzukaj() {
  const dane = useDane()
  const tryb = useStan((s) => s.tryb)
  const biznes = useStan((s) => s.biznes)
  const warstwa = useStan((s) => s.warstwa)
  const wybrany = useStan((s) => s.wybrany)
  const porownanie = useStan((s) => s.porownanie)
  const kierunki = useStan((s) => s.kierunki)
  const [komunikatHeksow, setKomunikatHeksow] = useState('')
  const [warstwyRozwiniete, setWarstwyRozwiniete] = useState(false)
  const wyniki = useWyniki()
  const sasiedzi = usePropsSasiadowMapy()
  const wstepnaMapa = useWstepnaMapa(dane.stan !== 'gotowe')
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
      ? dane.wskazniki.filter(
          (w) =>
            kierunekEfektywny(w.meta, kierunki) !== null &&
            (tryb !== 'biznes' ||
              warstwyBiznesu(biznes).some((id) => id === w.meta.id && !w.meta.atrapa)),
        )
      : []

  return (
    <main className="szukaj">
      <div className="szukaj-lewa">
        <div className="szukaj-wyszukaj">
          <div className="panel-wstep">
            <h1 tabIndex={-1}>
              {tryb === 'biznes'
                ? `Znajdź miejsce na działalność: ${BIZNESY.find((b) => b.id === biznes)?.nazwa ?? 'biznes'}`
                : 'Znajdź okolicę w Krakowie'}
            </h1>
            <p>
              {tryb === 'biznes'
                ? 'Wagi konkurencji i liczby stałych mieszkańców przeliczają kolory na mapie. Wybierz rodzaj działalności poniżej, kliknij heks i porównaj okolice.'
                : 'Profil i wagi poniżej od razu przeliczają kolory na mapie. Kliknij mapę, żeby zobaczyć okolicę i dodać jej heks do porównania.'}
            </p>
          </div>
        </div>
        <aside aria-label="Filtry" className="szukaj-filtry">
          <PoleOpiszSiebie />
          <PanelFiltrow />
          <PanelBudzetu />
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
              Wynik tej okolicy
            </button>
            {warstwy
              .filter((w) => warstwyRozwiniete || warstwa === w.meta.id)
              .map((w) => (
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
            {warstwy.length > 0 && (
              <button
                type="button"
                className="seg pasek-warstw__wiecej"
                aria-expanded={warstwyRozwiniete}
                onClick={() => setWarstwyRozwiniete(!warstwyRozwiniete)}
              >
                {warstwyRozwiniete ? 'Zwiń warstwy ▴' : `Inne warstwy (${warstwy.length}) ▾`}
              </button>
            )}
          </div>
          <div className="slot-mapy" data-slot="mapa">
            <Suspense
              fallback={
                <p className="komunikat" role="status">
                  Wczytuję mapę…
                </p>
              }
            >
              <MapaKrakowa
                heksy={wyniki?.heksy ?? wstepnaMapa?.heksy ?? BRAK_HEKSOW}
                podpisWarstwy={wyniki?.podpis ?? wstepnaMapa?.podpis ?? 'Wynik tej okolicy'}
                wykluczone={wyniki?.wykluczoneHeksy}
                sasiedzi={sasiedzi}
                wybrany={adres ? { lon: adres.lon, lat: adres.lat } : null}
                widok3d
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
            </Suspense>
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
                  : `${wyniki?.podpis ?? 'Wynik tej okolicy'}: ${Math.round(wynikWybranego)}`}
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
