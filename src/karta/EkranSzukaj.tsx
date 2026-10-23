import { type CSSProperties, lazy, Suspense, useRef, useState, useSyncExternalStore } from 'react'
import { PoleOpiszSiebie } from '@/ai/PoleOpiszSiebie'
import {
  type Adres,
  bazaDanych,
  miasto as miastoZRejestru,
  type SlugMiasta,
  type WskaznikMeta,
} from '@/kontrakty'
import { MEDIA_ARKUSZA } from '@/lib/punktyLamania'
import { kadrZapasowyMiasta, WIDOK_MIAST } from '@/mapa/lot'
import { type OkolicaNaMapie, okolicaNaMapie } from '@/mapa/okolica/granice'
import { wczytajGraniceOkolic } from '@/mapa/okolica/wczytajGranice'
import { ZOOM_PODPISU_MIASTA } from '@/mapa/tlo'
import { pozwolNaPelneDane, useDane } from '@/wynik/dane'
import {
  adresZPunktu,
  kafelPunktu,
  useAdresKompakt,
  useAdresyKompakt,
  wczytajKafel,
} from '@/wynik/kafle'
import { useMiasto, useTylkoKrakow } from '@/wynik/miastoDanych'
import { miejsceAdresu, miejsceOkolicy } from '@/wynik/miejsceAdresu'
import { BIZNESY, PERSONY, TRYBY, warstwyBiznesu } from '@/wynik/persony'
import { otworzTloPrzegladu, usePrzeglad } from '@/wynik/przeglad'
import { rankingUlic } from '@/wynik/rankingUlic'
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
import {
  metaWarstw,
  okolicaNaMapieKompaktu,
  useOkoliceKompaktu,
  useStartKompakt,
  wczytajSkaleKafli,
} from '@/wynik/startKompakt'
import { MAKS_POROWNANIE } from '@/wynik/url'
import { useRankingWstepny } from '@/wynik/useRankingKompakt'
import { usePropsSasiadowMapy } from '@/wynik/useSasiedzi'
import { useWykluczenieAdresuKompakt, useWynikAdresu, useWyniki } from '@/wynik/useWyniki'
import { useWynikiMapy } from '@/wynik/useWynikiMapy'
import { opisAdresu } from './adres'
import { ArkuszDolny, type StanArkusza } from './arkusz/ArkuszDolny'
import { Zakladki } from './arkusz/Zakladki'
import { MiniKarta } from './MiniKarta'
import {
  biernikMiasta,
  decyzjaKamery,
  naglowekSzukaj,
  ogloszenieZmianyMiasta,
  ostrzezenieOPrzelaczeniu,
  ZOOM_ZMIANY_MIASTA,
} from './miastoTeksty'
import type { WybranaOkolica } from './okolicaWybrana'
import { PasekOkolicy } from './PasekOkolicy'
import { StopkaPrawna } from './PasekSerwisow'
import { PanelBudzetu } from './panel/PanelBudzetu'
import { PanelDojazdu } from './panel/PanelDojazdu'
import { PanelFiltrow } from './panel/PanelFiltrow'
import { Ranking } from './Ranking'
import { WyborMiasta } from './WyborMiasta'
import { adresWKliknietymHeksie } from './wyszukiwarka/heks'
import type { WynikOkolicy } from './wyszukiwarka/szukajOkolic'
import { Wyszukiwarka } from './wyszukiwarka/Wyszukiwarka'
import './szukaj.css'

// Prefetch chunka mapy już przy wczytaniu modułu (A4): pobieranie rusza, zanim ekran się wyrenderuje.
const chunkMapy = import('@/mapa/MapaKrakowa')
const MapaKrakowa = lazy(async () => ({ default: (await chunkMapy).MapaKrakowa }))

/**
 * Pierwszy kolor mapy otwiera bramkę tła (#250): pozostałe miasta ruszają dopiero teraz. Pełnych danych
 * (adresy.json, wskazniki/*.json) to NIE otwiera (#247): Szukaj liczy mapę, filtry, kartę adresu i
 * wstępny ranking z kompaktu i kafli; pełne dane otwiera zakładka Ranking, wybór celu dojazdu, ekran
 * spoza Szukaj albo awaria mapy.
 */
function pozwolPoCichu() {
  otworzTloPrzegladu()
}

/** Ocena adresu na aktywnej warstwie mapy z rozbicia kafla (NaN = brak danych, nigdy 0). */
function ocenaNaWarstwie(
  rozbicie: ReturnType<typeof useWynikAdresu>,
  warstwa: string,
): number | undefined {
  if (!rozbicie) return undefined
  const ocena =
    warstwa === 'wynik' ? rozbicie.wynik : rozbicie.warstwy.find((w) => w.id === warstwa)?.ocena
  return ocena ?? Number.NaN
}

// Stała, bo nowa pusta mapa przy każdym renderze wymuszałaby przemalowanie warstwy heksów.
const BRAK_HEKSOW: ReadonlyMap<string, number | null> = new Map()

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

function subskrybujUklad(zmiana: () => void) {
  const mq = window.matchMedia(MEDIA_ARKUSZA)
  mq.addEventListener('change', zmiana)
  return () => mq.removeEventListener('change', zmiana)
}
const czyUkladArkusza = () => window.matchMedia(MEDIA_ARKUSZA).matches

/** „1 filtr”, „2 filtry”, „5 filtrów”, „22 filtry” – do podsumowania w nagłówku arkusza. */
function liczbaFiltrow(n: number): string {
  const j = n % 10
  const d = n % 100
  const slowo = n === 1 ? 'filtr' : j >= 2 && j <= 4 && (d < 12 || d > 14) ? 'filtry' : 'filtrów'
  return `${n} ${slowo}`
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
  // Poniżej bp-l zamiast lewego panelu jest dolny arkusz nad mapą na cały ekran. Jedno drzewo na oba układy:
  // mapa ma stały klucz, więc zmiana szerokości okna jej nie montuje od nowa.
  const jestArkusz = useSyncExternalStore(subskrybujUklad, czyUkladArkusza, () => false)
  const [stanArkusza, setStanArkusza] = useState<StanArkusza>('zwiniety')
  const [odstepArkusza, setOdstepArkusza] = useState(0)
  const [zakladka, setZakladka] = useState('filtry')
  const persona = useStan((s) => s.persona)
  const filtry = useStan((s) => s.filtry)
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
  const ostatniZoom = useRef(0)
  const spokojDo = useRef(0)
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
  const pelne = dane.stan === 'gotowe'
  // Bez pełnych danych ekran stoi na kompakcie (#247): meta warstw i słownik podpina `useStartKompakt`,
  // heksy i wyniki mapy dają `useWynikiMapy`, adresy przychodzą z kafli na żądanie.
  const hk = useStartKompakt(pelne)
  const wynikiMapy = useWynikiMapy()
  const wstepneUlice = useRankingWstepny(5)
  const [okolicaAktywna, setOkolicaAktywna] = useState(false)
  const okoliceKompakt = useOkoliceKompaktu(hk, okolicaAktywna || wybrany !== null)
  const okolice = dane.stan === 'gotowe' ? dane.okolice : okoliceKompakt
  const adresKompakt = useAdresKompakt(wybrany)
  const adresyKompakt = useAdresyKompakt(porownanie)
  const rozbicieKompakt = useWynikAdresu(pelne ? null : wybrany)
  const wykluczenieKompakt = useWykluczenieAdresuKompakt(pelne ? null : wybrany)
  const numerKliku = useRef(0)
  const sasiedzi = usePropsSasiadowMapy()
  // Legenda i nagłówek ranking nazywają warstwę: miasto, które jej nie ma, nie zna jej nazwy, więc bierzemy
  // ją z przeglądu (zna ją każde miasto, które warstwę ma).
  const wynikiWidoku: { brakWarstwy: boolean; podpis: string } | null = wyniki ?? wynikiMapy
  const brakWarstwy = wynikiWidoku?.brakWarstwy === true
  const podpis = wynikiWidoku && !brakWarstwy ? wynikiWidoku.podpis : przeglad.podpis
  const adres: Adres | undefined =
    dane.stan === 'gotowe'
      ? wybrany !== null
        ? dane.adresy[wybrany]
        : undefined
      : (adresKompakt ?? undefined)
  const wybraneAdresy: Adres[] =
    dane.stan === 'gotowe'
      ? porownanie.flatMap((i) => {
          const wybranyAdres = dane.adresy[i]
          return wybranyAdres ? [wybranyAdres] : []
        })
      : adresyKompakt
  const wynikWybranego =
    pelne && adres && wyniki
      ? wyniki.naAdres[adres.i]
      : pelne
        ? undefined
        : ocenaNaWarstwie(rozbicieKompakt, warstwa)
  const wykluczony = pelne
    ? Boolean(adres && wyniki?.wykluczenia.wykluczony[adres.i])
    : wykluczenieKompakt.wykluczony
  const niewiadomy = pelne
    ? Boolean(adres && wyniki?.wykluczenia.niewiadomy[adres.i])
    : wykluczenieKompakt.niewiadomy
  const wczytujeMiasto = dane.stan === 'ladowanie' && hk.stan !== 'gotowe'
  const ogloszenieOkolicy = okolica
    ? `Wybrano okolicę ${okolica.miejsce.nazwa}. ${okolica.miejsce.opis ?? ''}`.trim()
    : komunikatOkolicy
  // Okolica wybranego adresu: jednostka SIM albo miejscowość z okolice.json, bez pliku dzielnica albo gmina.
  const miejsceWybranego = adres ? miejsceAdresu(adres, adres.i, okolice) : null
  // Przełącznik pokazuje tylko warstwy, które coś oceniają. Liczy się kierunek efektywny:
  // warstwa neutralna z kierunkiem nadanym przez personę wchodzi do wyniku, więc ma przycisk.
  // Lista warstw jest z pełnych danych, a bez nich z manifestu kompaktu (ta sama kolejność i meta).
  const wskaznikiPaska: readonly { meta: WskaznikMeta }[] =
    dane.stan === 'gotowe'
      ? dane.wskazniki
      : hk.stan === 'gotowe'
        ? metaWarstw(hk.manifest).map((meta) => ({ meta }))
        : []
  const warstwy = wskaznikiPaska.filter(
    (w) =>
      kierunekEfektywny(w.meta, kierunki) !== null &&
      (tryb !== 'biznes' ||
        warstwyBiznesu(biznes).some((id) => id === w.meta.id && !w.meta.atrapa)),
  )

  // Wybór okolicy z podpowiedzi. Granice jednostek SIM ładują się przy pierwszym fokusie w polu (albo tu,
  // gdy ktoś wybrał szybciej); miejscowość granic nie potrzebuje. Nowszy wybór wyprzedza starszy, który
  // jeszcze czeka na plik.
  async function wybierzOkolice(wynik: WynikOkolicy) {
    if (!okolice) return
    const numer = ++wyborOkolicy.current
    setKomunikatOkolicy('Wczytuję granice okolicy…')
    const granice = wynik.rodzaj === 'sim' ? await wczytajGraniceOkolic() : null
    // Miasto mogło się zmienić, zanim przyszedł plik granic: okolica z poprzedniego miasta nie wróci na ekran.
    if (numer !== wyborOkolicy.current || pobierzStan().miasto !== miasto.slug) return
    // Bez adresów w pamięci ramkę miejscowości daje kompakt (`okolice.<skrót>.json`), nie adresy.
    const naMapie =
      dane.stan === 'gotowe'
        ? okolicaNaMapie(wynik.id, granice, dane.adresy, okolice)
        : hk.stan === 'gotowe'
          ? await okolicaNaMapieKompaktu(hk.miasto, hk.indeks, wynik.id, granice, okolice).catch(
              () => null,
            )
          : null
    if (numer !== wyborOkolicy.current || pobierzStan().miasto !== miasto.slug) return
    const miejsce = miejsceOkolicy(okolice, wynik.id)
    if (!naMapie || !miejsce) {
      setOkolica(null)
      setCel(null)
      setKomunikatOkolicy('Nie mamy położenia tej okolicy na mapie.')
      return
    }
    setKomunikatOkolicy('')
    setOkolica({ naMapie, miejsce, nazwaOsm: wynik.nazwaOsm })
    setCel({ miasto: miasto.slug, naMapie })
    // Pole siedzi w arkuszu, który przy fokusie rośnie na cały ekran: po wyborze oddajemy mapę.
    if (jestArkusz) setStanArkusza('polowa')
  }

  // „Wszystkie miasta”: przelot do kadru wszystkich miast (bez animacji przy prefers-reduced-motion – dba o to
  // `lec`) i otwarcie bramki tła. Nowy obiekt celu = nowy przelot także przy drugim kliku.
  function pokazWszystkieMiasta() {
    otworzTloPrzegladu()
    setPropozycja(null)
    setCel({
      miasto: miasto.slug,
      naMapie: { id: 'wszystkie-miasta', granice: WIDOK_MIAST, obrys: null },
    })
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
      // Klik w heks innego miasta wybiera po wczytaniu jego danych adres z tego heksu (`oczekujacyKlik` w stanie),
      // a ten wybór potrzebuje wszystkich adresów miasta: tylko wtedy otwieramy bramkę pełnych danych.
      if (opcje.klik) pozwolNaPelneDane()
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

  /** Skutek kliku w heks bieżącego miasta, gdy znamy już adres z tego heksu (z pełnych danych albo z kafla). */
  function zastosujKlik(kandydat: { h3: string; adres: Adres | null }) {
    if (!kandydat.adres) {
      setKomunikatHeksow('W tym heksie nie ma adresu. Wybierz inny heks.')
      return
    }
    const juzWybrany = wybraneAdresy.find((a) => a.h3 === kandydat.h3)
    wybierzAdres(juzWybrany?.i ?? kandydat.adres.i)
    // Arkusz pokazuje adres od razu; fokus zostaje, ogłoszenie idzie przez regiony status.
    if (jestArkusz) setStanArkusza('polowa')
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
  }

  /**
   * Klik w heks bez pełnych danych (#247): kafel punktu z kompaktu, z niego adres z klikniętego heksu.
   * Kafel ma ~70 KB, więc klik odpowiada po jego pobraniu; nowszy klik wyprzedza starszy, który czeka.
   */
  async function klikBezPelnychDanych(lon: number, lat: number) {
    if (hk.stan !== 'gotowe') return
    const numer = ++numerKliku.current
    const wpis = kafelPunktu(hk.indeks, lon, lat)
    if (!wpis) {
      setKomunikatHeksow('W tym heksie nie ma adresu. Wybierz inny heks.')
      return
    }
    try {
      const skale = await wczytajSkaleKafli(hk.miasto, hk.indeks)
      const kafel = await wczytajKafel(bazaDanych(hk.miasto), wpis, skale)
      if (numer !== numerKliku.current || pobierzStan().miasto !== hk.miasto) return
      zastosujKlik(adresZPunktu(kafel, lon, lat))
    } catch (e) {
      console.warn('Kafel adresów niedostępny', e)
      if (numer === numerKliku.current) {
        setKomunikatHeksow('Nie udało się wczytać adresów tego heksu. Spróbuj jeszcze raz.')
      }
    }
  }

  // Kamera stanęła (moveend): nad innym miastem przy zbliżeniu ulicznym miasto zmienia się samo, ale tylko
  // gdy nie ma wybranego adresu ani porównania – inaczej tylko propozycja (D5, FR-006c).
  function naWidok(lon: number, lat: number, zoom: number) {
    ostatniZoom.current = zoom
    // Oddalenie do zoomu, przy którym widać inne miasta, otwiera bramkę tła (#250): ich dane są już potrzebne.
    if (zoom < ZOOM_PODPISU_MIASTA) otworzTloPrzegladu()
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

  const profilNazwa =
    tryb === 'biznes'
      ? (BIZNESY.find((b) => b.id === biznes)?.nazwa ?? 'Biznes')
      : (PERSONY.find((p) => p.id === persona)?.nazwa ?? 'Własne ustawienia')
  const trybNazwa = tryb === 'biznes' ? 'Dla biznesu' : TRYBY.find((t) => t.id === tryb)?.nazwa
  const liczbaUlic =
    dane.stan === 'gotowe' && wyniki && !brakWarstwy
      ? rankingUlic(
          dane.adresy,
          wyniki.naAdres,
          wyniki.wykluczenia.wykluczony,
          wyniki.heksy,
          dane.okolice,
        ).length
      : // Do dojścia pełnych danych licznik zakładki idzie ze wstępnego rankingu z heksów (bez kafli).
        !pelne && !brakWarstwy
        ? (wstepneUlice?.length ?? 0)
        : 0
  const tytul =
    tryb === 'biznes'
      ? `Znajdź miejsce na działalność: ${BIZNESY.find((b) => b.id === biznes)?.nazwa ?? 'biznes'}`
      : naglowekSzukaj(miasto)
  const wPorownaniu = adres ? porownanie.includes(adres.i) : false
  const ogloszenieAdresu = adres
    ? [
        `${adres.ulica ?? adres.miejscowosc} ${adres.nr}`,
        wynikWybranego === undefined || Number.isNaN(wynikWybranego)
          ? 'brak danych'
          : `${podpis}: ${Math.round(wynikWybranego)}`,
        wykluczony ? 'wykluczony filtrem' : null,
        niewiadomy ? 'nie wiemy, czy spełnia filtr (brak danych)' : null,
      ]
        .filter((c) => c !== null)
        .join(' · ')
    : ''

  // Pole nazwy okolicy z komunikatami: w arkuszu stoi w nagłówku (widoczne także po zwinięciu), na desktopie nad zakładkami.
  const poleOkolicy = (
    <div className="szukaj-wyszukaj" data-sekcja="wyszukiwarka">
      {(dane.stan === 'gotowe' && dane.okolice) ||
      (dane.stan !== 'gotowe' && hk.stan === 'gotowe' && !wInnymMiescie) ? (
        // Pole szuka okolic, nie adresów: na Szukaj oglądamy mapę (decyzja właściciela, commit 80c7aad),
        // a adresy są w Katalogu adresów. Włączenie adresów to prop `adresy` + `onWybierz`.
        // Bez pełnych danych `okolice.json` (nazwy okolic) pobiera dopiero fokus w polu, jak granice.
        <Wyszukiwarka
          okolice={okolice}
          onWybierzOkolice={(w) => void wybierzOkolice(w)}
          onFokus={() => {
            setOkolicaAktywna(true)
            void wczytajGraniceOkolic()
          }}
          etykieta="Nazwa okolicy"
          placeholder="np. Ruczaj, Rakowice, Kurdwanów"
          mierz
        />
      ) : dane.stan !== 'gotowe' && hk.stan === 'gotowe' && wInnymMiescie ? (
        <p className="szukaj-okolica-komunikat">
          Wyszukiwanie okolic na razie tylko w Krakowie. Kliknij mapę, żeby wybrać adres.
        </p>
      ) : dane.stan === 'ladowanie' ? (
        <p className="etykieta-sekcji">{wInnymMiescie ? 'Wczytuję dane…' : 'Wczytuję okolice…'}</p>
      ) : dane.stan === 'gotowe' && wInnymMiescie ? (
        // Okolice (jednostki SIM, miejscowości) ma tylko Kraków (D8): zamiast pustego pola komunikat.
        <p className="szukaj-okolica-komunikat">
          Wyszukiwanie okolic na razie tylko w Krakowie. Kliknij mapę, żeby wybrać adres.
        </p>
      ) : null}
      {okolicaAktywna && !okolice && dane.stan !== 'gotowe' && hk.stan === 'gotowe' && (
        <p className="szukaj-okolica-komunikat">Wczytuję okolice…</p>
      )}
      {komunikatOkolicy && <p className="szukaj-okolica-komunikat">{komunikatOkolicy}</p>}
      {okolica && <PasekOkolicy okolica={okolica} onZamknij={wyczyscOkolice} />}
      {/* Stały region: czytnik ogłasza zmianę tekstu, a nie samo pojawienie się paska z treścią. */}
      <span className="sr-only" role="status">
        {ogloszenieOkolicy}
      </span>
    </div>
  )

  const filtryPanel = (
    <div className="szukaj-filtry" role="group" aria-label="Filtry" data-sekcja="szukaj-filtry">
      <PoleOpiszSiebie />
      <PanelFiltrow />
      <PanelBudzetu />
      <PanelDojazdu />
      <WyborMiasta
        biezace={miasto.slug}
        wczytywane={wczytujeMiasto ? miasto.nazwa : null}
        niedostepne={przeglad.miasta
          .filter((m) => m.stan === 'brak')
          .map((m) => miastoZRejestru(m.slug).nazwa)}
        onWybierz={(slug) => zmienMiasto(slug, { lot: true })}
        onWszystkie={pokazWszystkieMiasta}
      />
    </div>
  )

  // Wybrane heksy jako lista chipów z × (cel 44 px): w arkuszu i w panelu, nie w pływającej pigułce.
  const listaPorownania =
    wybraneAdresy.length > 0 ? (
      <section className="porownanie-lista" aria-label="Wybrane heksy do porównania">
        {wybraneAdresy.map((a) => (
          <span className="heksy-pasek__chip" data-aktywny={a.i === wybrany || undefined} key={a.i}>
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
      </section>
    ) : null

  // Stopka prawna na dole panelu i arkusza: na Szukaj mapa ma pełną wysokość, więc nie ma jej pod ekranem.
  const zakladki = (
    <>
      <Zakladki
        id="szukaj"
        etykieta="Panel wyników"
        zakladki={[
          { id: 'filtry', etykieta: 'Filtry' },
          { id: 'ranking', etykieta: liczbaUlic > 0 ? `Ranking (${liczbaUlic})` : 'Ranking' },
        ]}
        wybrana={zakladka}
        onWybierz={setZakladka}
        panel={(id) => (id === 'filtry' ? filtryPanel : <Ranking nazwaWarstwy={podpis} />)}
      />
      <StopkaPrawna wariant="panel" />
    </>
  )

  const paskiWarstw = (
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
  )

  const miniKarta = adres ? (
    <MiniKarta
      indeks={adres.i}
      nazwa={`${adres.ulica ?? adres.miejscowosc} ${adres.nr}`}
      wariant={jestArkusz ? 'arkusz' : 'mapa'}
      miejsce={miejsceWybranego}
      wykluczony={wykluczony}
      niewiadomy={niewiadomy}
      wPorownaniu={wPorownaniu}
      limitPorownania={porownanie.length >= MAKS_POROWNANIE}
      onPorownanie={() => (wPorownaniu ? usunZPorownania(adres.i) : dodajDoPorownania(adres.i))}
      ogloszenie={ogloszenieAdresu}
      onOtworz={() => pokazOkolice(adres.i)}
    />
  ) : null

  return (
    <main className="szukaj">
      {jestArkusz && (
        // Arkusz jest w stanie zwiniętym nieaktywny (inert), więc nagłówek strony stoi poza nim.
        <h1 className="sr-only" tabIndex={-1}>
          {tytul}
        </h1>
      )}
      {!jestArkusz && (
        <div key="panel" className="szukaj-panel">
          <div className="panel-wstep">
            <h1 tabIndex={-1}>{tytul}</h1>
            <p>
              {tryb === 'biznes'
                ? 'Wagi konkurencji i liczby stałych mieszkańców przeliczają kolory na mapie. Wybierz rodzaj działalności poniżej, kliknij heks i porównaj okolice.'
                : 'Profil i wagi poniżej od razu przeliczają kolory na mapie. Kliknij mapę, żeby zobaczyć okolicę i dodać jej heks do porównania.'}
            </p>
          </div>
          {poleOkolicy}
          {listaPorownania}
          {zakladki}
        </div>
      )}

      <section key="mapa" aria-label="Mapa miast" className="szukaj-mapa" data-sekcja="szukaj-mapa">
        {paskiWarstw}
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
        <div
          className="slot-mapy"
          data-slot="mapa"
          id="slot-mapy"
          style={{ '--arkusz-odstep': `${jestArkusz ? odstepArkusza : 0}px` } as CSSProperties}
        >
          <Suspense
            fallback={
              <p className="komunikat" role="status">
                Wczytuję mapę…
              </p>
            }
          >
            <MapaKrakowa
              onPierwszyKolor={pozwolPoCichu}
              // Awaria mapy (WebGL, styl) jest jedynym zapasem czasowym: wtedy otwieramy pełne dane (#247).
              onAwaria={pozwolNaPelneDane}
              heksy={wyniki?.heksy ?? wynikiMapy?.heksy ?? przeglad.biezaceR10 ?? BRAK_HEKSOW}
              podpisWarstwy={podpis}
              // Tło: pozostałe miasta pod mgłą. Obecność propa (także z pustymi mapami, zanim przeglądy
              // dojdą) znaczy „mapa wszystkich miast”: zmienia podpis mgły i legendę.
              tlo={przeglad.tlo}
              miasto={miasto.slug}
              wykluczone={wyniki?.wykluczoneHeksy ?? wynikiMapy?.wykluczoneHeksy}
              sasiedzi={sasiedzi}
              okolica={cel?.naMapie ?? null}
              wybrany={adres ? { lon: adres.lon, lat: adres.lat } : null}
              widok3d
              odstepDolny={jestArkusz ? odstepArkusza : 0}
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
                if (dane.stan === 'gotowe') {
                  zastosujKlik(adresWKliknietymHeksie(dane.adresy, lon, lat))
                  return
                }
                void klikBezPelnychDanych(lon, lat)
              }}
            />
          </Suspense>
          {wybraneAdresy.length > 0 ? (
            <div
              className="heksy-pasek"
              role="group"
              aria-label="Porównanie heksów"
              data-liczba={wybraneAdresy.length}
            >
              <span className="heksy-pasek__tekst">
                Porównanie{' '}
                <b>
                  {wybraneAdresy.length}/{MAKS_POROWNANIE}
                </b>
              </span>
              <button
                type="button"
                className="heksy-pasek__akcja"
                data-cel="przejdz-do-porownania"
                onClick={() => przejdz('porownanie')}
              >
                Porównaj
              </button>
            </div>
          ) : (
            <span className="heksy-podpowiedz">Kliknij heks, aby porównać</span>
          )}
          {!jestArkusz && miniKarta}
          <span className="sr-only" role="status">
            {komunikatHeksow}
          </span>
          {/* Zmiana miasta (FR-007) i propozycja przełączenia: czytnik ogłasza, co się stało i co wyczyszczono. */}
          <span className="sr-only" role="status">
            {ogloszenieMiasta}
          </span>
        </div>
      </section>

      {jestArkusz && (
        <ArkuszDolny
          key="arkusz"
          stan={stanArkusza}
          onStan={setStanArkusza}
          etykieta="Panel wyników"
          onOdstep={setOdstepArkusza}
          naglowek={
            <>
              <p className="arkusz-podsumowanie">
                <b>{profilNazwa}</b>
                {trybNazwa && (
                  <>
                    <span className="arkusz-podsumowanie__kropka" aria-hidden="true" />
                    {trybNazwa}
                  </>
                )}
                {tryb !== 'biznes' && filtry.length > 0 && (
                  <>
                    <span className="arkusz-podsumowanie__kropka" aria-hidden="true" />
                    {liczbaFiltrow(filtry.length)}
                  </>
                )}
              </p>
              {poleOkolicy}
            </>
          }
        >
          {miniKarta}
          {listaPorownania}
          {zakladki}
        </ArkuszDolny>
      )}
    </main>
  )
}
