import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { PoleOpiszSiebie } from '@/ai/PoleOpiszSiebie'
import { okolicaNaMapie } from '@/mapa/okolica/granice'
import { wczytajGraniceOkolic } from '@/mapa/okolica/wczytajGranice'
import { useDane } from '@/wynik/dane'
import { miejsceAdresu, miejsceOkolicy } from '@/wynik/miejsceAdresu'
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
import type { WybranaOkolica } from './okolicaWybrana'
import { PasekOkolicy } from './PasekOkolicy'
import { PanelBudzetu } from './panel/PanelBudzetu'
import { PanelDojazdu } from './panel/PanelDojazdu'
import { PanelFiltrow } from './panel/PanelFiltrow'
import { Ranking } from './Ranking'
import { adresWKliknietymHeksie } from './wyszukiwarka/heks'
import type { WynikOkolicy } from './wyszukiwarka/szukajOkolic'
import { Wyszukiwarka } from './wyszukiwarka/Wyszukiwarka'
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
  // Telefon: mapę da się zwinąć do paska warstw, żeby filtry i ranking dostały cały ekran.
  const [mapaZwinieta, setMapaZwinieta] = useState(false)
  // Okolica z pola wyszukiwarki żyje w stanie ekranu: link i stan aplikacji nie znają okolic (url.ts, stan.ts).
  const [okolica, setOkolica] = useState<WybranaOkolica | null>(null)
  const [komunikatOkolicy, setKomunikatOkolicy] = useState('')
  const wyborOkolicy = useRef(0)
  const sekcjaMapy = useRef<HTMLElement>(null)
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
  const ogloszenieOkolicy = okolica
    ? `Wybrano okolicę ${okolica.miejsce.nazwa}. ${okolica.miejsce.opis ?? ''}`.trim()
    : komunikatOkolicy
  // Okolica wybranego adresu: jednostka SIM albo miejscowość z okolice.json, bez pliku dzielnica albo gmina.
  const miejsceWybranego =
    adres && dane.stan === 'gotowe' ? miejsceAdresu(adres, adres.i, dane.okolice) : null
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

  // Wybór okolicy z podpowiedzi. Granice jednostek SIM ładują się przy pierwszym fokusie w polu (albo tu,
  // gdy ktoś wybrał szybciej); miejscowość granic nie potrzebuje. Nowszy wybór wyprzedza starszy, który
  // jeszcze czeka na plik.
  async function wybierzOkolice(wynik: WynikOkolicy) {
    if (dane.stan !== 'gotowe' || !dane.okolice) return
    const numer = ++wyborOkolicy.current
    setKomunikatOkolicy('Wczytuję granice okolicy…')
    const granice = wynik.rodzaj === 'sim' ? await wczytajGraniceOkolic() : null
    if (numer !== wyborOkolicy.current) return
    const naMapie = okolicaNaMapie(wynik.id, granice, dane.adresy, dane.okolice)
    const miejsce = miejsceOkolicy(dane.okolice, wynik.id)
    if (!naMapie || !miejsce) {
      setOkolica(null)
      setKomunikatOkolicy('Nie mamy położenia tej okolicy na mapie.')
      return
    }
    setKomunikatOkolicy('')
    setOkolica({ naMapie, miejsce, nazwaOsm: wynik.nazwaOsm })
  }

  function wyczyscOkolice(zKlawiatury: boolean) {
    wyborOkolicy.current++
    setOkolica(null)
    setKomunikatOkolicy('')
    // Przycisk znika razem z paskiem: z klawiatury fokus wraca do pola (dotyk nie otwiera przez to klawiatury ekranowej).
    if (zKlawiatury) {
      document.querySelector<HTMLInputElement>('.szukaj-wyszukaj input[role="combobox"]')?.focus()
    }
  }

  // Telefon: pole i pasek okolicy stoją nad mapą, więc po wyborze mapa bywa poza ekranem. Przewijamy tylko tyle,
  // żeby cała mapa była widoczna (nic się nie dzieje, gdy już jest), a przy ograniczonym ruchu bez animacji.
  useEffect(() => {
    const sekcja = sekcjaMapy.current
    if (!okolica || !sekcja || !window.matchMedia('(max-width: 860px)').matches) return
    const bezRuchu = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    sekcja.scrollIntoView({ block: 'nearest', behavior: bezRuchu ? 'auto' : 'smooth' })
  }, [okolica])

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
          {dane.stan === 'gotowe' && dane.okolice ? (
            // Pole szuka okolic, nie adresów: na Szukaj oglądamy mapę (decyzja właściciela, commit 80c7aad),
            // a adresy są w Katalogu adresów. Włączenie adresów to prop `adresy` + `onWybierz`.
            <Wyszukiwarka
              okolice={dane.okolice}
              onWybierzOkolice={(w) => void wybierzOkolice(w)}
              onFokus={() => void wczytajGraniceOkolic()}
              etykieta="Nazwa okolicy"
              placeholder="np. Ruczaj, Rakowice, Kurdwanów"
            />
          ) : dane.stan === 'ladowanie' ? (
            <p className="etykieta-sekcji">Wczytuję okolice…</p>
          ) : null}
          {komunikatOkolicy && <p className="szukaj-okolica-komunikat">{komunikatOkolicy}</p>}
          {okolica && <PasekOkolicy okolica={okolica} onZamknij={wyczyscOkolice} />}
          {/* Stały region: czytnik ogłasza zmianę tekstu, a nie samo pojawienie się paska z treścią. */}
          <span className="sr-only" role="status">
            {ogloszenieOkolicy}
          </span>
        </div>
        <aside aria-label="Filtry" className="szukaj-filtry">
          <PoleOpiszSiebie />
          <PanelFiltrow />
          <PanelBudzetu />
          <PanelDojazdu />
        </aside>
      </div>

      <div className="szukaj-prawa">
        <section
          aria-label="Mapa Krakowa"
          className="szukaj-mapa"
          data-zwinieta={mapaZwinieta || undefined}
          ref={sekcjaMapy}
        >
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
          <div className="slot-mapy" data-slot="mapa" id="slot-mapy">
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
                okolica={okolica?.naMapie ?? null}
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
                {miejsceWybranego && (
                  <small className="wybrany-adres__miejsce">
                    {miejsceWybranego.rodzaj === 'zapas' ? (
                      miejsceWybranego.nazwa
                    ) : (
                      <>
                        Okolica: <strong>{miejsceWybranego.nazwa}</strong>
                        {miejsceWybranego.podpis && `, ${miejsceWybranego.podpis}`}
                      </>
                    )}
                  </small>
                )}
              </span>
              <button type="button" className="seg wlaczony" onClick={() => pokazOkolice(adres.i)}>
                Otwórz kartę
              </button>
            </div>
          )}
          <button
            type="button"
            className="szukaj-mapa__zwin"
            aria-expanded={!mapaZwinieta}
            aria-controls="slot-mapy"
            onClick={() => setMapaZwinieta(!mapaZwinieta)}
          >
            {mapaZwinieta ? 'Pokaż mapę ▾' : 'Zwiń mapę ▴'}
          </button>
        </section>
        <Ranking />
      </div>
    </main>
  )
}
