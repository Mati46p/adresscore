import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { PoleOpiszSiebie } from '@/ai/PoleOpiszSiebie'
import { miasto as miastoZRejestru, type SlugMiasta } from '@/kontrakty'
import { kadrZapasowyMiasta, WIDOK_MIAST } from '@/mapa/lot'
import { type OkolicaNaMapie, okolicaNaMapie } from '@/mapa/okolica/granice'
import { wczytajGraniceOkolic } from '@/mapa/okolica/wczytajGranice'
import { useDane } from '@/wynik/dane'
import { useMiasto, useTylkoKrakow } from '@/wynik/miastoDanych'
import { miejsceAdresu, miejsceOkolicy } from '@/wynik/miejsceAdresu'
import { BIZNESY, warstwyBiznesu } from '@/wynik/persony'
import { usePrzeglad } from '@/wynik/przeglad'
import { zamknijSasiadow } from '@/wynik/sasiedziStan'
import { kierunekEfektywny } from '@/wynik/silnik'
import {
  dodajDoPorownania,
  pobierzStan,
  pokazOkolice,
  przejdz,
  useStan,
  ustawMiasto,
  ustawWarstwe,
  usunZPorownania,
  wybierzAdres,
} from '@/wynik/stan'
import { czytajHash, MAKS_POROWNANIE } from '@/wynik/url'
import { usePropsSasiadowMapy } from '@/wynik/useSasiedzi'
import { useWyniki } from '@/wynik/useWyniki'
import { opisAdresu } from './adres'
import {
  biernikMiasta,
  decyzjaKamery,
  linkWskazujeMiejsce,
  naglowekSzukaj,
  ogloszenieZmianyMiasta,
  ostrzezenieOPrzelaczeniu,
  ZOOM_ZMIANY_MIASTA,
} from './miastoTeksty'
import type { WybranaOkolica } from './okolicaWybrana'
import { PasekOkolicy } from './PasekOkolicy'
import { PanelBudzetu } from './panel/PanelBudzetu'
import { PanelDojazdu } from './panel/PanelDojazdu'
import { PanelFiltrow } from './panel/PanelFiltrow'
import { Ranking } from './Ranking'
import { WyborMiasta } from './WyborMiasta'
import { adresWKliknietymHeksie } from './wyszukiwarka/heks'
import type { WynikOkolicy } from './wyszukiwarka/szukajOkolic'
import { Wyszukiwarka } from './wyszukiwarka/Wyszukiwarka'
import './szukaj.css'

const MapaKrakowa = lazy(async () => ({
  default: (await import('@/mapa/MapaKrakowa')).MapaKrakowa,
}))

// Stała, bo nowa pusta mapa przy każdym renderze wymuszałaby przemalowanie warstwy heksów.
const BRAK_HEKSOW: ReadonlyMap<string, number | null> = new Map()

// Czy aplikację otwarto linkiem, który wskazuje miasto albo adres (FR-012)? Czytane raz, przy wczytaniu
// modułu: stan zna wtedy miasto z linku, ale po pierwszym kliku to samo pytanie zadane stanowi dałoby
// już inną odpowiedź. Taki link startuje przy swoim miejscu, a bez niego mapa pokazuje wszystkie miasta.
const START_Z_MIEJSCEM = linkWskazujeMiejsce(
  czytajHash(window.location.hash, window.location.search),
  window.location.pathname,
)
// Widok wszystkich miast należy do pierwszego wejścia na ten ekran w sesji. Powrót z innego ekranu
// (katalog, porównanie) ma zostać przy bieżącym mieście, a nie cofnąć użytkownika do widoku kraju.
let widokWszystkichMiastPokazany = false

/**
 * Po zmianie miasta z listy albo kliku kamera dostaje chwilę spokoju (ms): ruch, który przerywa lot do
 * nowego miasta, kończy się zdarzeniem z POPRZEDNIM środkiem kadru i nie może przełączyć miasta z powrotem.
 */
const SPOKOJ_PO_ZMIANIE_MIASTA_MS = 800

/** Do czego leci kamera po wyborze miasta: obrys jego przeglądu, a gdy jeszcze go nie ma – kadr wokół środka. */
function lotDoMiasta(slug: SlugMiasta, granice: OkolicaNaMapie['granice'] | null): OkolicaNaMapie {
  // Ten sam kanał co okolica z wyszukiwarki (nowy obiekt = nowy przelot, także na to samo miasto), tylko bez
  // obrysu: `granice` mapy reagują na zmianę liczb, więc drugi wybór tego samego miasta nie ruszyłby kamery.
  return { id: `miasto:${slug}`, granice: granice ?? kadrZapasowyMiasta(slug), obrys: null }
}

/** Ekran 1 wg docs/makieta/Main.dc.html: panel filtrów po lewej, mapa po prawej. */
export function EkranSzukaj() {
  const dane = useDane()
  const miasto = useMiasto()
  // Funkcje oparte na danych tylko krakowskich (D8): w innym mieście zamiast nich komunikat.
  const wInnymMiescie = useTylkoKrakow()
  const przeglad = usePrzeglad()
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
  // Cel przelotu kamery: okolica z wyszukiwarki albo miasto z listy (nowy obiekt = nowy przelot). Pamięta
  // miasto, dla którego powstał – po zmianie miasta nie może rysować obrysu ani lecieć do cudzego miejsca.
  const [cel, setCel] = useState<{ miasto: SlugMiasta; naMapie: OkolicaNaMapie } | null>(null)
  // Miasto, nad którym stoi kamera, gdy zmiana bieżącego miasta wyczyściłaby wybór (D5): „Przełącz na …”.
  const [propozycja, setPropozycja] = useState<SlugMiasta | null>(null)
  const [ogloszenieMiasta, setOgloszenieMiasta] = useState('')
  const wyborOkolicy = useRef(0)
  const sekcjaMapy = useRef<HTMLElement>(null)
  const ostatniZoom = useRef(0)
  const spokojDo = useRef(0)
  // Kadr startowy (D4): widok wszystkich miast – tylko przy pierwszym wejściu bez linku z miejscem. Stały
  // przez życie ekranu (mapa pamięta go od pierwszej klatki), więc `useState`, a nie wartość z renderu.
  const [kadrStartowy] = useState(() =>
    START_Z_MIEJSCEM || widokWszystkichMiastPokazany ? null : WIDOK_MIAST,
  )
  useEffect(() => {
    widokWszystkichMiastPokazany = true
  }, [])
  // Wszystko, co należało do poprzedniego miasta, znika razem z nim (stan ekranu, jak wybór w stanie
  // aplikacji): okolica i komunikaty z wyszukiwarki (jej dane ma tylko Kraków), propozycja przełączenia
  // i cel przelotu, który powstał dla innego miasta. Wzorzec jak w Naglowek: stan pochodny bez efektu.
  const [miastoEkranu, setMiastoEkranu] = useState(miasto.slug)
  if (miastoEkranu !== miasto.slug) {
    setMiastoEkranu(miasto.slug)
    setOkolica(null)
    setKomunikatOkolicy('')
    setKomunikatHeksow('')
    setPropozycja(null)
    setCel((c) => (c?.miasto === miasto.slug ? c : null))
  }
  const wyniki = useWyniki()
  const sasiedzi = usePropsSasiadowMapy()
  // Legenda i nagłówek ranking nazywają warstwę: miasto, które jej nie ma, nie zna jej nazwy, więc bierzemy
  // ją z przeglądu (zna ją każde miasto, które warstwę ma).
  const brakWarstwy = wyniki?.brakWarstwy === true
  const podpis = wyniki && !brakWarstwy ? wyniki.podpis : przeglad.podpis
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
    // Miasto mogło się zmienić, zanim przyszedł plik granic: okolica z poprzedniego miasta nie wróci na ekran.
    if (numer !== wyborOkolicy.current || pobierzStan().miasto !== miasto.slug) return
    const naMapie = okolicaNaMapie(wynik.id, granice, dane.adresy, dane.okolice)
    const miejsce = miejsceOkolicy(dane.okolice, wynik.id)
    if (!naMapie || !miejsce) {
      setOkolica(null)
      setCel(null)
      setKomunikatOkolicy('Nie mamy położenia tej okolicy na mapie.')
      return
    }
    setKomunikatOkolicy('')
    setOkolica({ naMapie, miejsce, nazwaOsm: wynik.nazwaOsm })
    setCel({ miasto: miasto.slug, naMapie })
  }

  function wyczyscOkolice(zKlawiatury: boolean) {
    wyborOkolicy.current++
    setOkolica(null)
    setCel(null)
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

  /**
   * Zmienia bieżące miasto. Stan aplikacji czyści wybrany adres, porównanie, symulator i miejsca Biznesu
   * (FR-007), a tu dochodzi to, co należy do ekranu: sekcja „Lepszy sąsiad” (indeks adresu z poprzedniego
   * miasta wskazywałby cudzy adres), propozycja przełączenia i ogłoszenie dla czytnika.
   * `lot` – czy kamera ma polecieć do miasta: tak po wyborze z listy i kliku w jego heks z daleka, nie tak,
   * gdy kamera już stoi nad nim (zmiana kamerą, przycisk „Przełącz na …”).
   */
  function zmienMiasto(
    slug: SlugMiasta,
    opcje: { lot: boolean; klik?: { lon: number; lat: number } },
  ) {
    if (slug !== miasto.slug) {
      const czyscimy = { adres: wybrany !== null, porownanie: porownanie.length > 0 }
      ustawMiasto(slug, opcje.klik ? { klik: opcje.klik } : undefined)
      zamknijSasiadow()
      spokojDo.current = performance.now() + SPOKOJ_PO_ZMIANIE_MIASTA_MS
      setOgloszenieMiasta(ogloszenieZmianyMiasta(miastoZRejestru(slug).nazwa, czyscimy))
    }
    setPropozycja(null)
    if (opcje.lot) {
      const granice = przeglad.miasta.find((m) => m.slug === slug)?.granice ?? null
      setCel({ miasto: slug, naMapie: lotDoMiasta(slug, granice) })
    }
  }

  // Kamera stanęła (moveend): nad innym miastem przy zbliżeniu ulicznym miasto zmienia się samo, ale tylko
  // gdy nie ma wybranego adresu ani porównania – inaczej tylko propozycja (D5, FR-006c).
  function naWidok(lon: number, lat: number, zoom: number) {
    ostatniZoom.current = zoom
    if (performance.now() < spokojDo.current) return
    const maWybor = wybrany !== null || porownanie.length > 0
    const decyzja = decyzjaKamery({
      zoom,
      podSrodkiem: przeglad.miastoPunktu(lon, lat),
      biezace: miasto.slug,
      maWybor,
    })
    if (decyzja.akcja === 'nic') return setPropozycja(null)
    if (decyzja.akcja === 'przelacz') return zmienMiasto(decyzja.miasto, { lot: false })
    if (propozycja === decyzja.miasto) return
    setPropozycja(decyzja.miasto)
    setOgloszenieMiasta(
      `Mapa pokazuje teraz ${biernikMiasta(miastoZRejestru(decyzja.miasto).nazwa)}. ${ostrzezenieOPrzelaczeniu({ adres: wybrany !== null, porownanie: porownanie.length > 0 })}`,
    )
  }

  const propozycjaMiasta =
    propozycja !== null && propozycja !== miasto.slug && (wybrany !== null || porownanie.length > 0)
      ? miastoZRejestru(propozycja)
      : null

  return (
    <main className="szukaj">
      <div className="szukaj-lewa">
        <div className="szukaj-wyszukaj" data-sekcja="wyszukiwarka">
          <div className="panel-wstep">
            <h1 tabIndex={-1}>
              {tryb === 'biznes'
                ? `Znajdź miejsce na działalność: ${BIZNESY.find((b) => b.id === biznes)?.nazwa ?? 'biznes'}`
                : naglowekSzukaj(miasto)}
            </h1>
            <p>
              {tryb === 'biznes'
                ? 'Wagi konkurencji i liczby stałych mieszkańców przeliczają kolory na mapie. Wybierz rodzaj działalności poniżej, kliknij heks i porównaj okolice.'
                : 'Profil i wagi poniżej od razu przeliczają kolory na mapie. Kliknij mapę, żeby zobaczyć okolicę i dodać jej heks do porównania.'}
            </p>
          </div>
          <WyborMiasta
            biezace={miasto.slug}
            wczytywane={dane.stan === 'ladowanie' ? miasto.nazwa : null}
            niedostepne={przeglad.miasta
              .filter((m) => m.stan === 'brak')
              .map((m) => miastoZRejestru(m.slug).nazwa)}
            onWybierz={(slug) => zmienMiasto(slug, { lot: true })}
          />
          {dane.stan === 'gotowe' && dane.okolice ? (
            // Pole szuka okolic, nie adresów: na Szukaj oglądamy mapę (decyzja właściciela, commit 80c7aad),
            // a adresy są w Katalogu adresów. Włączenie adresów to prop `adresy` + `onWybierz`.
            <Wyszukiwarka
              okolice={dane.okolice}
              onWybierzOkolice={(w) => void wybierzOkolice(w)}
              onFokus={() => void wczytajGraniceOkolic()}
              etykieta="Nazwa okolicy"
              placeholder="np. Ruczaj, Rakowice, Kurdwanów"
              mierz
            />
          ) : dane.stan === 'ladowanie' ? (
            <p className="etykieta-sekcji">
              {wInnymMiescie ? 'Wczytuję dane…' : 'Wczytuję okolice…'}
            </p>
          ) : dane.stan === 'gotowe' && wInnymMiescie ? (
            // Okolice (jednostki SIM, miejscowości) ma tylko Kraków (D8): zamiast pustego pola komunikat.
            <p className="szukaj-okolica-komunikat">
              Wyszukiwanie okolic na razie tylko w Krakowie. Kliknij mapę, żeby wybrać adres.
            </p>
          ) : null}
          {komunikatOkolicy && <p className="szukaj-okolica-komunikat">{komunikatOkolicy}</p>}
          {okolica && <PasekOkolicy okolica={okolica} onZamknij={wyczyscOkolice} />}
          {/* Stały region: czytnik ogłasza zmianę tekstu, a nie samo pojawienie się paska z treścią. */}
          <span className="sr-only" role="status">
            {ogloszenieOkolicy}
          </span>
        </div>
        <aside aria-label="Filtry" className="szukaj-filtry" data-sekcja="szukaj-filtry">
          <PoleOpiszSiebie />
          <PanelFiltrow />
          <PanelBudzetu />
          <PanelDojazdu />
        </aside>
      </div>

      <div className="szukaj-prawa">
        <section
          aria-label="Mapa miast"
          className="szukaj-mapa"
          data-sekcja="szukaj-mapa"
          data-zwinieta={mapaZwinieta || undefined}
          ref={sekcjaMapy}
        >
          <div role="group" aria-label="Co pokazuje mapa" className="pasek-warstw">
            {/* Wszystkie przyciski warstw mają jeden cel pomiaru: to jedna czynność (zmiana warstwy),
                a nazwa warstwy jest zmienna, więc nie może trafić do klucza. */}
            <button
              type="button"
              className="seg"
              data-cel="zmien-warstwe"
              aria-pressed={warstwa === 'wynik'}
              onClick={() => ustawWarstwe('wynik')}
            >
              Wynik tej okolicy
            </button>
            {/* Wybrana warstwa, której bieżące miasto nie ma (wybrano ją w innym): mapa pokazuje to miasto w
                szrafurze, a pasek nie ma jej przycisku – ten znacznik mówi, co jest włączone i dlaczego szaro. */}
            {brakWarstwy && (
              <span className="pasek-warstw__brak" role="status">
                {podpis}: brak danych {miasto.wMiescie}
              </span>
            )}
            {warstwy
              .filter((w) => warstwyRozwiniete || warstwa === w.meta.id)
              .map((w) => (
                <button
                  key={w.meta.id}
                  type="button"
                  className="seg"
                  data-cel="zmien-warstwe"
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
                data-cel="rozwin-warstwy"
                aria-expanded={warstwyRozwiniete}
                onClick={() => setWarstwyRozwiniete(!warstwyRozwiniete)}
              >
                {warstwyRozwiniete ? 'Zwiń warstwy ▴' : `Inne warstwy (${warstwy.length}) ▾`}
              </button>
            )}
          </div>
          {propozycjaMiasta && (
            <div className="przelacz-miasto" role="group" aria-label="Zmiana miasta">
              <p>
                Mapa pokazuje teraz {biernikMiasta(propozycjaMiasta.nazwa)}.{' '}
                {ostrzezenieOPrzelaczeniu({
                  adres: wybrany !== null,
                  porownanie: porownanie.length > 0,
                })}
              </p>
              <button
                type="button"
                className="seg"
                data-cel="przelacz-miasto"
                onClick={() => zmienMiasto(propozycjaMiasta.slug, { lot: false })}
              >
                Przełącz na {biernikMiasta(propozycjaMiasta.nazwa)}
              </button>
            </div>
          )}
          <div className="slot-mapy" data-slot="mapa" id="slot-mapy">
            <Suspense
              fallback={
                <p className="komunikat" role="status">
                  Wczytuję mapę…
                </p>
              }
            >
              <MapaKrakowa
                heksy={wyniki?.heksy ?? przeglad.biezaceR10 ?? BRAK_HEKSOW}
                podpisWarstwy={podpis}
                // Tło: pozostałe miasta pod mgłą. Obecność propa (także z pustymi mapami, zanim przeglądy
                // dojdą) znaczy „mapa wszystkich miast”: zmienia podpis mgły i legendę.
                tlo={przeglad.tlo}
                miasto={miasto.slug}
                kadrStartowy={kadrStartowy}
                wykluczone={wyniki?.wykluczoneHeksy}
                sasiedzi={sasiedzi}
                okolica={cel?.naMapie ?? null}
                wybrany={adres ? { lon: adres.lon, lat: adres.lat } : null}
                widok3d
                onWidok={naWidok}
                onKlik={(lon, lat) => {
                  // Klik w heks innego miasta (FR-006b): miasto staje się bieżącym, a po wczytaniu jego danych
                  // wybiera się adres z klikniętego heksu. Z bliska kamera już tam stoi, więc nie lecimy.
                  const slug = przeglad.miastoPunktu(lon, lat)
                  if (slug !== null && slug !== miasto.slug) {
                    zmienMiasto(slug, {
                      lot: ostatniZoom.current < ZOOM_ZMIANY_MIASTA,
                      klik: { lon, lat },
                    })
                    return
                  }
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
                  data-cel="przejdz-do-porownania"
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
                        data-cel="usun-z-porownania"
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
            {/* Zmiana miasta (FR-007) i propozycja przełączenia: czytnik ogłasza, co się stało i co wyczyszczono. */}
            <span className="sr-only" role="status">
              {ogloszenieMiasta}
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
                  : `${podpis}: ${Math.round(wynikWybranego)}`}
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
              <button
                type="button"
                className="seg wlaczony"
                data-cel="otworz-karte"
                onClick={() => pokazOkolice(adres.i)}
              >
                Otwórz kartę
              </button>
            </div>
          )}
          <button
            type="button"
            className="szukaj-mapa__zwin"
            data-cel="zwin-mape"
            aria-expanded={!mapaZwinieta}
            aria-controls="slot-mapy"
            onClick={() => setMapaZwinieta(!mapaZwinieta)}
          >
            {mapaZwinieta ? 'Pokaż mapę ▾' : 'Zwiń mapę ▴'}
          </button>
        </section>
        <Ranking nazwaWarstwy={podpis} />
      </div>
    </main>
  )
}
