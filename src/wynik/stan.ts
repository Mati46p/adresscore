// Stan aplikacji bez biblioteki: jeden obiekt niemutowalny + subskrybenci, czytany przez
// useSyncExternalStore. Wystarcza na kilka pól, a równoległe okna nie dokładają zależności.
// Kanoniczne ścieżki trzymają adres i katalog; preferencje pozostają w sesji przeglądarki.

import { useSyncExternalStore } from 'react'
import type { Adres, WskaznikMeta } from '@/kontrakty'
// Względnie, nie `@/kontrakty`: ten plik testuje `node --test`, a indeks kontraktów czyta `import.meta.env`.
import { adresWKliknietymHeksie } from '../karta/wyszukiwarka/heks.ts'
import { czySlugMiasta, MIASTO_DOMYSLNE, type SlugMiasta } from '../kontrakty/miasta.ts'
import { BEZ_FILTROW, type FiltryUslug } from './biznesUslugi.ts'
import type { Budzet } from './budzet.ts'
import { type TwardyFiltr, zPodmienionymFiltrem } from './filtry.ts'
import {
  PERSONA_DOMYSLNA,
  type PersonaId,
  RODZAJ_BIZNESU_DOMYSLNY,
  type RodzajBiznesu,
  TRYB_DOMYSLNY,
  type Tryb,
  ustawieniaPersony,
  warstwyBiznesu,
} from './persony.ts'
import {
  odczytajPreferencje,
  odczytajPreferencjeTrybu,
  polaczPreferencje,
  zapiszPreferencje,
} from './sesja.ts'
import type { KierunekOceny, Kierunki } from './silnik.ts'
import { hashAdresu, hashZeSluga, slugAdresu } from './slug.ts'
import { PARAMETRY_EKRANU, polaBiznesuZLinku, zPodmienionymiParametrami } from './stanZLinku.ts'
import { czyDoMieszkanca } from './trybyAplikacji.ts'
import {
  czytajHash,
  type Ekran,
  ID_MIEJSC,
  type IdMiejsca,
  MAKS_POROWNANIE,
  type StanUrl,
  zapiszHash,
} from './url.ts'
import { czyWarstwaWyborow, zmienKomitet } from './wybory.ts'

/** `'wynik'` = wynik łączny; inaczej id wskaźnika pokazywanego na mapie. */
export type WarstwaMapy = 'wynik' | (string & {})
export type TrybMapy = 'suma' | 'ostatnia'

/** Z meta warstwy wagi persony biorą id, kategorię i to, co zmienia wagę domyślną. */
type MetaWag = Pick<WskaznikMeta, 'id' | 'kategoria'> &
  Partial<Pick<WskaznikMeta, 'atrapa' | 'domyslnaWaga'>>

export interface StanAplikacji {
  ekran: Ekran
  tryb: Tryb
  biznes: RodzajBiznesu
  /** `'wlasna'` po ręcznej zmianie którejkolwiek wagi. */
  persona: PersonaId | 'wlasna'
  /** Wagi 0–4 per id wskaźnika. */
  wagi: Readonly<Record<string, number>>
  /** Nadpisane kierunki; brak klucza = kierunek z meta. */
  kierunki: Kierunki
  /** Indeks wybranego adresu w adresy.json albo null. */
  wybrany: number | null
  /** Indeksy adresów do porównania, najwyżej 5. */
  porownanie: readonly number[]
  warstwa: WarstwaMapy
  /** Czy mapa śledzi wynik łączny, czy ostatnio zmienioną warstwę. */
  trybMapy: TrybMapy
  ostatniaWarstwa: string | null
  /** Twarde filtry: adres, który ich nie spełnia, jest wykluczony (nie dostaje kary w wyniku). */
  filtry: readonly TwardyFiltr[]
  /** Budżet zakupu z cen RCN (#77); null = wyłączony. Jak filtry – poza URL. */
  budzet: Budzet | null
  branza: string
  /** Miejsca testowe A–E trybu „Biznes”, zawsze `MAKS_MIEJSC` pozycji. */
  miejsca: readonly ({ lon: number; lat: number } | null)[]
  /**
   * Filtry konkurencji trybu „Biznes” (#108): trzymane tu, a nie w stanie ekranu, żeby żyły w linku
   * (parametr `k`) i przetrwały wyjście z ekranu. Domyślnie wyłączone.
   */
  filtryBiznesu: FiltryUslug
  /** Obiekty symulatora (#98), warianty A i B jako tekst `symulacjaUrl.ts`. */
  symulacja: { a: string; b: string }
  /**
   * Warstwa rankingu i mapy luk trybu „Miasto” (#92, parametr `w` linku). `null` = pierwsza warstwa
   * z progiem luki.
   */
  warstwaLuk: string | null
  /**
   * Bieżące miasto (#223): jedno naraz. Jego pełne dane (adresy, warstwy, okolice) zasilają kartę,
   * porównanie, ranking, katalog i 3D (`useDane`, `dane.ts`); pozostałe miasta widać tylko jako
   * przegląd na mapie. Zmienia je `ustawMiasto` albo link (`mst=`); domyślnie Kraków.
   */
  miasto: SlugMiasta
  /**
   * Link niósł `mst=` ze slugiem spoza rejestru: otwieramy Kraków, a ekran powinien powiedzieć,
   * że miasta z linku nie ma. Zdejmuje to nowy link albo `ustawMiasto`.
   */
  nieznaneMiasto: boolean
}

const PUSTE_MIEJSCA: readonly null[] = ID_MIEJSC.map(() => null)
const PUSTA_SYMULACJA = { a: '', b: '' }

let stan: StanAplikacji = {
  ekran: 'szukaj',
  tryb: TRYB_DOMYSLNY,
  biznes: RODZAJ_BIZNESU_DOMYSLNY,
  persona: PERSONA_DOMYSLNA,
  wagi: {},
  kierunki: {},
  wybrany: null,
  porownanie: [],
  warstwa: 'wynik',
  trybMapy: 'suma',
  ostatniaWarstwa: null,
  filtry: [],
  budzet: null,
  branza: 'sklep',
  miejsca: PUSTE_MIEJSCA,
  filtryBiznesu: BEZ_FILTROW,
  symulacja: PUSTA_SYMULACJA,
  warstwaLuk: null,
  miasto: MIASTO_DOMYSLNE,
  nieznaneMiasto: false,
}

const sluchacze = new Set<() => void>()

// Słownik id ↔ indeks dostajemy dopiero po wczytaniu adresów. Do tego czasu id z URL czekają.
let idAdresow: readonly string[] | null = null
let indeksPoId = new Map<string, number>()
// Hash i slug liczone leniwie: dla ~176 tys. adresów to ~0,7 s procesora przy starcie, a potrzebne
// są tylko przy wejściu z linku /adres/… i przy zapisie ścieżki wybranego adresu.
let indeksPoHash: Map<string, number> | null = null
let adresyStanu: readonly Adres[] = []
/**
 * Miasto, do którego należy słownik powyżej (id ↔ indeks, adresy). Różni się od `stan.miasto` w oknie
 * między `ustawMiasto` a `podlaczDane` nowego miasta (jego dane jeszcze się wczytują): w tym oknie
 * stary słownik nie wolno rozwiązywać id z linku, bo pochodzą już z innego zbioru adresów.
 */
let miastoSlownika: SlugMiasta | null = null
/**
 * Meta warstw używana do liczenia wag persony: SUMA miast (D9), nie tylko bieżące – tych, których dane
 * podpięto (`podlaczDane`), i tych, których warstwy zna przegląd (`dodajMetaMiasta`). Dlaczego suma:
 * `wagi`/`kierunki` w stanie liczą też przegląd pozostałych miast (kolor Krakowa na mapie nie może
 * zależeć od tego, które miasto jest akurat bieżące), a Kraków ma ok. 60 warstw, których inne miasta
 * nie mają. Persona wybrana w Łodzi policzona tylko na warstwach Łodzi zgubiłaby wagi tych 60 i
 * przekłamała kolor Krakowa. Przy tym samym id wygrywa meta ostatnio podpiętego miasta (bieżącego),
 * a kolejność wstawiania daje stałą kolejność kluczy w `wagi`.
 */
const znaneMeta = new Map<string, MetaWag>()

function metaDoWag(): readonly MetaWag[] {
  return [...znaneMeta.values()]
}

/** Klik w heks innego miasta czeka na dane tego miasta (`ustawMiasto`, `podlaczDane`). */
let oczekujacyKlik: { lon: number; lat: number } | null = null
/**
 * Link, którego części zależne od słownika adresów (id adresu, porównanie, ustawienia) czekają na
 * dane: start strony i zmiana hasha przed wczytaniem danych miasta z linku. Zmiana miasta z poziomu
 * aplikacji (`ustawMiasto`) linku nie niesie, więc `podlaczDane` bierze wtedy profil ze stanu.
 */
let oczekujacyUrl: StanUrl | null = null
let odczytujemyHistorie = false
type UstawieniaTrybu = Pick<StanAplikacji, 'persona' | 'wagi' | 'kierunki' | 'filtry'>
/** Tryb mieszkańca to każdy poza `biznes`: kupuje albo wynajmuje. */
type TrybMieszkanca = Exclude<Tryb, 'biznes'>
type UstawieniaMieszkanca = UstawieniaTrybu & { tryb: TrybMieszkanca }
const TRYB_MIESZKANCA_DOMYSLNY: TrybMieszkanca =
  TRYB_DOMYSLNY === 'biznes' ? 'kupuje' : TRYB_DOMYSLNY
// Mieszkaniec zapamiętany w chwili wejścia w tryb biznes (E10, #108): bez niego powrót z Biznesu
// zostawiałby wagi sklepu i ludności. Po przeładowaniu strony zmienna znika, wtedy służy sesja karty.
let mieszkaniePrzedBiznesem: UstawieniaMieszkanca | null = null
let ostatniBiznes: UstawieniaTrybu | null = null

function ustawieniaTrybu(s: StanAplikacji): UstawieniaTrybu {
  return { persona: s.persona, wagi: s.wagi, kierunki: s.kierunki, filtry: s.filtry }
}

/** Ustawienia zapisane w linku (parametry `p`, `u`, `biz`), przeliczone dla `tryb` na żywe warstwy. */
function ustawieniaZUrl(url: StanUrl, tryb: Tryb): UstawieniaTrybu {
  const persona = url.ustawienia ? 'wlasna' : (url.persona ?? PERSONA_DOMYSLNA)
  const meta = metaDoWag()
  const domyslne = ustawieniaPersony(
    persona === 'wlasna' ? PERSONA_DOMYSLNA : persona,
    tryb,
    meta,
    url.biznes ?? stan.biznes,
  )
  const { wagi, kierunki } = url.ustawienia
    ? sprawdzUstawienia(url.ustawienia, meta, domyslne, tryb, url.biznes ?? stan.biznes)
    : domyslne
  return { persona, wagi, kierunki, filtry: [] }
}

function ustawieniaZSesji(rodzaj: 'mieszkanie' | 'biznes', tryb: Tryb): UstawieniaTrybu | null {
  const url = odczytajPreferencjeTrybu(rodzaj)
  return url ? ustawieniaZUrl(url, tryb) : null
}

/** Mieszkaniec z sesji karty: tryb i profil ostatnio zapisane poza trybem biznes. */
function mieszkaniecZSesji(): UstawieniaMieszkanca | null {
  const url = odczytajPreferencjeTrybu('mieszkanie')
  if (!url) return null
  const tryb =
    url.tryb === 'kupuje' || url.tryb === 'wynajmuje' ? url.tryb : TRYB_MIESZKANCA_DOMYSLNY
  return { tryb, ...ustawieniaZUrl(url, tryb) }
}

function zapamietajMieszkanca(s: StanAplikacji) {
  if (s.tryb !== 'biznes') mieszkaniePrzedBiznesem = { tryb: s.tryb, ...ustawieniaTrybu(s) }
}

/**
 * Łatka stanu z powrotem do mieszkańca. Wraca ten, kogo zapamiętało wejście w tryb biznes; po
 * przeładowaniu strony (zmienne znikają) ten z sesji karty; bez żadnego zapisu profil domyślny,
 * a persona z `biezacy`. `trybWybrany` to tryb, który użytkownik wskazał sam (kafel „Kupuję”).
 * Czysta względem stanu: niczego nie zapisuje, więc służy też do składania linków (`hrefDla`).
 */
function latkaMieszkanca(
  biezacy: StanAplikacji,
  trybWybrany?: TrybMieszkanca,
): Partial<StanAplikacji> {
  const zapis = mieszkaniePrzedBiznesem ?? mieszkaniecZSesji()
  const tryb = trybWybrany ?? zapis?.tryb ?? TRYB_MIESZKANCA_DOMYSLNY
  const persona =
    zapis?.persona ?? (biezacy.persona === 'wlasna' ? PERSONA_DOMYSLNA : biezacy.persona)
  const domyslne = ustawieniaPersony(
    persona === 'wlasna' ? PERSONA_DOMYSLNA : persona,
    tryb,
    metaDoWag(),
  )
  return {
    tryb,
    persona,
    wagi: persona === 'wlasna' && zapis ? zapis.wagi : domyslne.wagi,
    kierunki: persona === 'wlasna' && zapis ? zapis.kierunki : domyslne.kierunki,
    filtry: [],
    warstwa: 'wynik',
    trybMapy: 'suma',
    ostatniaWarstwa: null,
  }
}

/**
 * Stan po zmianie, uzgodniony z regułą „tryb biznes należy do ekranu Biznes” (`czyDoMieszkanca`):
 * po wyjściu z Biznesu i na ekranie Miasto wraca mieszkaniec, a każde wejście w tryb biznes (kafel,
 * `przejdz`, link z nagłówka, start z linku) zapamiętuje mieszkańca, do którego wrócimy.
 */
function zgodnyZTrybem(poprzedni: StanAplikacji, nastepny: StanAplikacji): StanAplikacji {
  if (czyDoMieszkanca(poprzedni.ekran, nastepny)) {
    if (poprzedni.tryb === 'biznes') ostatniBiznes = ustawieniaTrybu(poprzedni)
    return { ...nastepny, ...latkaMieszkanca(nastepny) }
  }
  if (nastepny.tryb === 'biznes' && poprzedni.tryb !== 'biznes') zapamietajMieszkanca(poprzedni)
  return nastepny
}

export function pobierzStan(): StanAplikacji {
  return stan
}

export function subskrybuj(sluchacz: () => void): () => void {
  sluchacze.add(sluchacz)
  return () => sluchacze.delete(sluchacz)
}

function zmien(latka: Partial<StanAplikacji>) {
  const poprzedni = stan
  stan = zgodnyZTrybem(poprzedni, { ...stan, ...latka })
  if (idAdresow) zapiszPreferencje(doUrl(stan))
  zapiszDoUrl(poprzedni)
  for (const s of sluchacze) s()
}

/**
 * Hook ze selektorem. Selektor musi zwracać wartość stabilną (pole stanu albo prymityw),
 * nie nowy obiekt – inaczej React wpadnie w pętlę renderów.
 */
export function useStan<T>(selektor: (s: StanAplikacji) => T): T {
  return useSyncExternalStore(
    subskrybuj,
    () => selektor(stan),
    () => selektor(stan),
  )
}

// ── Akcje ────────────────────────────────────────────────────────────────────────────────

export function wybierzPersone(persona: PersonaId) {
  const { wagi, kierunki } = ustawieniaPersony(persona, stan.tryb, metaDoWag())
  zmien({ persona, wagi, kierunki })
}

export function ustawTryb(tryb: Tryb) {
  if (tryb === stan.tryb) return
  if (tryb === 'biznes') {
    // Mieszkańca zapamiętuje `zmien` (wejście w tryb biznes z każdej drogi, nie tylko z tego kafla).
    const zapis = ostatniBiznes ?? ustawieniaZSesji('biznes', 'biznes')
    const domyslne = ustawieniaPersony(PERSONA_DOMYSLNA, 'biznes', metaDoWag(), stan.biznes)
    // Tryb biznes żyje tylko na ekranie Biznes, więc wejście w niego tam przenosi.
    return zmien({
      ekran: 'biznes',
      tryb,
      persona: zapis?.persona ?? PERSONA_DOMYSLNA,
      wagi: zapis?.wagi ?? domyslne.wagi,
      kierunki: zapis?.kierunki ?? domyslne.kierunki,
      filtry: [],
      warstwa: 'wynik',
      trybMapy: 'suma',
      ostatniaWarstwa: null,
    })
  }
  if (stan.tryb === 'biznes') {
    ostatniBiznes = ustawieniaTrybu(stan)
    return zmien(latkaMieszkanca(stan, tryb))
  }
  if (stan.persona === 'wlasna') return zmien({ tryb })
  const { wagi, kierunki } = ustawieniaPersony(stan.persona, tryb, metaDoWag())
  zmien({ tryb, wagi, kierunki })
}

export function ustawWage(id: string, waga: number) {
  const inneWagi = czyWarstwaWyborow(id)
    ? Object.fromEntries(
        Object.entries(stan.wagi).map(([klucz, wartosc]) => [
          klucz,
          czyWarstwaWyborow(klucz) && klucz !== id ? 0 : wartosc,
        ]),
      )
    : stan.wagi
  zmien({
    wagi: { ...inneWagi, [id]: Math.min(Math.max(Math.round(waga), 0), 4) },
    persona: 'wlasna',
    ostatniaWarstwa: id,
    ...(stan.trybMapy === 'ostatnia' ? { warstwa: id } : {}),
  })
}

export function ustawRodzajBiznesu(biznes: RodzajBiznesu) {
  if (biznes === stan.biznes) return
  const { wagi, kierunki } = ustawieniaPersony(PERSONA_DOMYSLNA, 'biznes', metaDoWag(), biznes)
  zmien({
    biznes,
    wagi,
    kierunki,
    filtry: [],
    persona: PERSONA_DOMYSLNA,
    warstwa: 'wynik',
    trybMapy: 'suma',
  })
}

export function ustawKomitet(id: string) {
  if (!czyWarstwaWyborow(id) || !znaneMeta.has(id)) return
  const ustawienia = zmienKomitet(id, stan.wagi, stan.kierunki, stan.filtry)
  zmien({
    ...ustawienia,
    persona: 'wlasna',
    ostatniaWarstwa: id,
    ...(stan.trybMapy === 'ostatnia' ? { warstwa: id } : {}),
  })
}

/**
 * Wszystkie wagi naraz (np. „opisz siebie”, #16): jedna zmiana stanu = jedno przeliczenie mapy,
 * bez przestawiania ostatniej warstwy, którą robi `ustawWage`.
 */
export function ustawWagi(wagi: Readonly<Record<string, number>>, kierunki: Kierunki) {
  const przyciete: Record<string, number> = {}
  for (const [id, w] of Object.entries(wagi))
    przyciete[id] = Math.min(Math.max(Math.round(w), 0), 4)
  zmien({ wagi: przyciete, kierunki: { ...kierunki }, persona: 'wlasna' })
}

/** null przywraca kierunek z meta wskaźnika. */
export function ustawKierunek(id: string, kierunek: KierunekOceny | null) {
  const kierunki = { ...stan.kierunki }
  if (kierunek) kierunki[id] = kierunek
  else delete kierunki[id]
  zmien({
    kierunki,
    persona: 'wlasna',
    ostatniaWarstwa: id,
    ...(stan.trybMapy === 'ostatnia' ? { warstwa: id } : {}),
  })
}

/** Zaznacza adres bez zmiany ekranu (np. klik w mapę na ekranie Szukaj). */
export function wybierzAdres(i: number | null) {
  zmien({ wybrany: i })
}

/** Zaznacza adres i otwiera kartę okolicy. */
export function pokazOkolice(i: number) {
  zmien({ wybrany: i, ekran: 'okolica' })
}

export function przejdz(ekran: Ekran) {
  if (ekran === 'biznes' && stan.tryb !== 'biznes') return ustawTryb('biznes')
  zmien({ ekran, ...(ekran === 'biznes' ? { tryb: 'biznes' as const } : {}) })
}

export function ustawBranze(branza: string) {
  // Miejsca zostają: te same lokalizacje można porównać dla innej branży.
  zmien({ branza })
}

export function ustawPunktBiznesu(id: IdMiejsca, punkt: { lon: number; lat: number } | null) {
  const i = ID_MIEJSC.indexOf(id)
  if (i < 0 || stan.miejsca[i] === punkt) return
  zmien({ miejsca: stan.miejsca.map((p, j) => (j === i ? punkt : p)) })
}

/** Stawia punkt w pierwszym wolnym miejscu A–E; gdy wszystkie zajęte, nadpisuje ostatnie. */
export function dodajMiejsceBiznesu(punkt: { lon: number; lat: number }) {
  const i = stan.miejsca.findIndex((p) => !p)
  ustawPunktBiznesu(ID_MIEJSC[i < 0 ? ID_MIEJSC.length - 1 : i] ?? 'a', punkt)
}

/** Filtry konkurencji trybu „Biznes” (#108); trafiają do linku jako parametr `k`. */
export function ustawFiltryBiznesu(filtry: FiltryUslug) {
  zmien({ filtryBiznesu: filtry })
}

/** Warstwa rankingu i mapy luk (#92); trafia do linku jako `w=` na ekranie Miasto. */
export function ustawWarstweLuk(warstwa: string | null) {
  if (warstwa === stan.warstwaLuk) return
  zmien({ warstwaLuk: warstwa })
}

/** Warianty symulatora (#98); zapis do URL tylko na ekranie Miasto. */
export function ustawSymulacje(symulacja: { a: string; b: string }) {
  if (symulacja.a === stan.symulacja.a && symulacja.b === stan.symulacja.b) return
  zmien({ symulacja })
}

export function dodajDoPorownania(i: number) {
  if (stan.porownanie.includes(i) || stan.porownanie.length >= MAKS_POROWNANIE) return
  zmien({ porownanie: [...stan.porownanie, i] })
}

export function usunZPorownania(i: number) {
  zmien({ porownanie: stan.porownanie.filter((x) => x !== i) })
}

export function przelaczPorownanie(i: number) {
  if (stan.porownanie.includes(i)) usunZPorownania(i)
  else dodajDoPorownania(i)
}

export function wyczyscPorownanie() {
  zmien({ porownanie: [] })
}

export function ustawWarstwe(warstwa: WarstwaMapy) {
  zmien({
    warstwa,
    trybMapy: warstwa === 'wynik' ? 'suma' : 'ostatnia',
    ...(warstwa === 'wynik' ? {} : { ostatniaWarstwa: warstwa }),
  })
}

export function ustawTrybMapy(trybMapy: TrybMapy) {
  zmien({
    trybMapy,
    warstwa: trybMapy === 'suma' ? 'wynik' : (stan.ostatniaWarstwa ?? 'wynik'),
  })
}

/** Dodaje twardy filtr albo podmienia filtr tej samej warstwy. */
export function ustawFiltr(filtr: TwardyFiltr) {
  zmien({
    filtry: zPodmienionymFiltrem(stan.filtry, filtr),
    ostatniaWarstwa: filtr.id,
    ...(stan.trybMapy === 'ostatnia' ? { warstwa: filtr.id } : {}),
  })
}

export function usunFiltr(id: string) {
  zmien({
    filtry: stan.filtry.filter((f) => f.id !== id),
    ostatniaWarstwa: id,
    ...(stan.trybMapy === 'ostatnia' ? { warstwa: id } : {}),
  })
}

/** Ustawia budżet zakupu (null wyłącza filtr budżetu). */
export function ustawBudzet(budzet: Budzet | null) {
  zmien({ budzet })
}

export function wyczyscFiltry() {
  zmien({ filtry: [] })
}

// ── Bieżące miasto (#223) ────────────────────────────────────────────────────────────────

/**
 * Co traci stan przy zmianie bieżącego miasta (FR-007). Wybrany adres i porównanie to indeksy w
 * adresach JEDNEGO miasta (porównanie między miastami jest poza v1, D6), a obiekty symulatora i miejsca
 * Biznesu to współrzędne w poprzednim mieście. Zostają wybory użytkownika, które nie są danymi miasta:
 * profil (persona, wagi, kierunki), twarde filtry, warstwa mapy, branża i filtry konkurencji. Pola,
 * które już są puste, zachowują tożsamość – worker obliczeń nie liczy drugi raz bez powodu.
 */
function latkaZmianyMiasta(cel: SlugMiasta): Partial<StanAplikacji> {
  if (cel === stan.miasto) return {}
  return {
    miasto: cel,
    wybrany: null,
    porownanie: stan.porownanie.length === 0 ? stan.porownanie : [],
    symulacja:
      stan.symulacja.a === '' && stan.symulacja.b === '' ? stan.symulacja : PUSTA_SYMULACJA,
    miejsca: stan.miejsca.every((p) => p === null) ? stan.miejsca : PUSTE_MIEJSCA,
  }
}

/**
 * Zmienia bieżące miasto (lista miast, klik w heks innego miasta, kamera nad innym miastem). Dane
 * nowego miasta wczytuje `dane.ts` – ten stan tylko zapisuje wybór, czyści to, co należało do
 * poprzedniego miasta, i trafia do linku (`mst=`).
 *
 * `klik` to współrzędne kliknięcia w heks tego miasta: po wczytaniu jego danych `podlaczDane` wybiera
 * adres z klikniętego heksu (ta sama reguła co klik w bieżącym mieście, `adresWKliknietymHeksie`).
 * Ten sam slug co bieżące miasto = nic (klik w bieżącym mieście obsługuje wołający, jak dotąd).
 */
export function ustawMiasto(slug: SlugMiasta, opcje?: { klik?: { lon: number; lat: number } }) {
  if (!czySlugMiasta(slug) || slug === stan.miasto) return
  oczekujacyKlik = opcje?.klik ?? null
  zmien({
    ...latkaZmianyMiasta(slug),
    nieznaneMiasto: false,
    // Karta bez wybranego adresu byłaby pusta: wracamy do wyszukiwania (jak przy nieznanym adresie
    // w linku). Porównanie po wyczyszczeniu pokazuje własny pusty stan, więc zostaje na miejscu.
    ...(stan.ekran === 'okolica' ? { ekran: 'szukaj' as const } : {}),
  })
}

/**
 * Warstwy miasta, którego pełne dane nie są podpięte (przegląd mapy zna je z kompaktu, `przeglad.ts`):
 * wchodzą do mapy wag, więc kolor tego miasta w przeglądzie liczy się tym samym profilem co bieżące
 * miasto (FR-003) i nie skacze, gdy użytkownik w nie wejdzie (D9: mapa po sumie warstw WSZYSTKICH
 * miast, a nie tylko odwiedzonych). Warstwy już znane zostają bez zmian – ich wagę ustawił użytkownik
 * albo persona; nowe dostają wagę persony. Powtórne dodanie tych samych warstw niczego nie zmienia
 * i nie budzi nasłuchujących.
 */
export function dodajMetaMiasta(wskazniki: readonly MetaWag[]) {
  const przed = znaneMeta.size
  for (const m of wskazniki) if (!znaneMeta.has(m.id)) znaneMeta.set(m.id, m)
  if (znaneMeta.size === przed) return
  const persona = stan.persona === 'wlasna' ? PERSONA_DOMYSLNA : stan.persona
  const domyslne = ustawieniaPersony(persona, stan.tryb, metaDoWag(), stan.biznes)
  zmien({
    wagi: { ...domyslne.wagi, ...stan.wagi },
    kierunki: { ...domyslne.kierunki, ...stan.kierunki },
  })
}

/**
 * Miasto z linku (start, hashchange) jako łatka stanu. Link jest źródłem prawdy, więc miasto z linku
 * wygrywa z bieżącym; klik czekający na dane poprzedniego miasta traci sens i odpada. Pola z linku
 * (obiekty symulatora, miejsca Biznesu) nakładają się PO tej łatce, więc czyszczenie ich nie ruszy.
 */
function miastoZLinku(url: StanUrl): Partial<StanAplikacji> {
  const cel = url.miasto ?? MIASTO_DOMYSLNE
  if (cel !== stan.miasto) oczekujacyKlik = null
  return latkaZmianyMiasta(cel)
}

/** Id adresu pod indeksem – do linków `#/adres/<id>`. */
export function idAdresu(i: number | null): string | null {
  return i === null ? null : (idAdresow?.[i] ?? null)
}

export function indeksAdresu(id: string | null): number | null {
  return id === null ? null : (indeksPoId.get(id) ?? null)
}

/**
 * Woła `dane.ts` po wczytaniu danych bieżącego miasta (i przy powrocie do miasta, którego dane już
 * są w pamięci): podpina słownik id ↔ indeks, liczy wagi persony dla warstw i rozwiązuje to, co
 * czekało na adresy – id z linku i klik w heks (`ustawMiasto`).
 *
 * Tylko dla BIEŻĄCEGO miasta (pilnuje tego `dane.ts`): słownik innego miasta pod `stan.miasto` dałby
 * id rozwiązane na cudzych adresach.
 *
 * Wagi i kierunki to mapa po SUMIE warstw wszystkich podpiętych miast (D9), nie po warstwach
 * bieżącego: `znaneMeta` zachowuje id spoza meta bieżącego miasta. Bez tego kolor Krakowa w
 * przeglądzie zależałby od tego, które miasto jest bieżące, a powrót do Krakowa gubiłby wagi jego
 * warstw (Kraków ma ok. 60 warstw, których inne miasta nie mają).
 */
export function podlaczDane(
  ids: readonly string[],
  wskazniki: readonly MetaWag[],
  adresy: readonly Adres[],
) {
  idAdresow = ids
  indeksPoId = new Map(ids.map((id, i) => [id, i]))
  indeksPoHash = null
  adresyStanu = adresy
  miastoSlownika = stan.miasto
  for (const m of wskazniki) znaneMeta.set(m.id, m)
  // Link czeka na dane tylko po starcie i po zmianie hasha przed wczytaniem (`oczekujacyUrl`): niesie
  // profil (persona, ustawienia) i id adresów. Zmiana miasta z aplikacji (`ustawMiasto`) linku nie
  // niesie, a adres w pasku jest wtedy odbiciem stanu – stan ma pełniejszy profil niż `u=` (link
  // przyjmuje do 100 wag, a Kraków ma 127 warstw). Bierzemy go więc ze stanu: zmiana miasta nie
  // może cofnąć wag, które użytkownik ustawił.
  const url =
    typeof window === 'undefined' ? oczekujacyUrl : oczekujacyUrl ? czytajBiezacyUrl() : null
  oczekujacyUrl = null
  const persona: PersonaId | 'wlasna' = url
    ? url.ustawienia
      ? 'wlasna'
      : (url.persona ?? (stan.persona === 'wlasna' ? PERSONA_DOMYSLNA : stan.persona))
    : stan.persona
  const tryb = url?.tryb ?? stan.tryb
  const biznes = url?.biznes ?? stan.biznes
  const domyslne = ustawieniaPersony(
    persona === 'wlasna' ? PERSONA_DOMYSLNA : persona,
    tryb,
    metaDoWag(),
    biznes,
  )
  const policzone = url?.ustawienia
    ? sprawdzUstawienia(url.ustawienia, metaDoWag(), domyslne, tryb, biznes)
    : domyslne
  // Profil z linku liczy się od nowa dla wszystkich znanych warstw (link jest źródłem prawdy), a profil
  // ze stanu wygrywa z wagami domyślnymi: wagi, które użytkownik już ma, zostają, a warstwy nowego
  // miasta dostają wagę z persony.
  const wagi = url ? policzone.wagi : { ...policzone.wagi, ...stan.wagi }
  const kierunki = url ? policzone.kierunki : { ...policzone.kierunki, ...stan.kierunki }
  const klik = oczekujacyKlik
  oczekujacyKlik = null
  const zKlikniecia = klik
    ? (adresWKliknietymHeksie(adresy, klik.lon, klik.lat).adres?.i ?? null)
    : null
  // Z linku bierzemy tu TYLKO to, co potrzebuje słownika (id adresu, lista porównania). Branża, punkty
  // i filtry Biznesu, obiekty symulatora i ekran stan dostał przy starcie albo od zmiany użytkownika
  // w trakcie ładowania – ponowne czytanie linku cofnęłoby tę zmianę (#108), bo przed wczytaniem
  // adresów `zapiszDoUrl` nie zdążył jej tam zapisać.
  zmien({
    persona,
    tryb,
    biznes,
    wagi,
    kierunki,
    ...(url ? zUrlPoWczytaniuAdresow(url) : {}),
    // Klik w heks innego miasta wybiera adres po wczytaniu jego danych (nowszy niż adres z linku).
    ...(zKlikniecia === null ? {} : { wybrany: zKlikniecia }),
  })
}

// ── Synchronizacja z URL ─────────────────────────────────────────────────────────────────

/** Pola linku, które potrzebują słownika adresów (id → indeks). Bez słownika czekają w `oczekujacyUrl`. */
function zUrlZeSlownikiem(url: StanUrl): Partial<StanAplikacji> {
  const wybrany = indeksAdresu(url.idAdresu)
  return {
    // Nieznany adres w linku → wracamy do wyszukiwania zamiast pustej karty.
    ekran: url.ekran === 'okolica' && wybrany === null ? 'szukaj' : url.ekran,
    wybrany: url.ekran === 'okolica' ? wybrany : stan.wybrany,
    porownanie: url.porownanie.map((id) => indeksPoId.get(id)).filter((i) => i !== undefined),
  }
}

/**
 * Pola linku niezależne od słownika adresów: stan dostaje je od razu (start, zmiana hasha przed
 * wczytaniem adresów), nie czeka na dane. Biznes tylko z linku Biznesu (`polaBiznesuZLinku`),
 * symulator i warstwa luk tylko z linku Miasta – inne ekrany nie kasują wyboru z tych trybów.
 */
function zUrlBezSlownika(url: StanUrl): Partial<StanAplikacji> {
  return {
    filtry: [],
    nieznaneMiasto: url.nieznaneMiasto === true,
    biznes: url.biznes ?? stan.biznes,
    ...(url.symulacja ? { symulacja: url.symulacja } : {}),
    ...(url.warstwaLuk !== undefined ? { warstwaLuk: url.warstwaLuk } : {}),
    ...polaBiznesuZLinku(url),
  }
}

/** Pełny odczyt linku po wczytaniu adresów (zmiana hasha, Wstecz/Dalej). */
function zUrl(url: StanUrl): Partial<StanAplikacji> {
  return { ...zUrlZeSlownikiem(url), ...zUrlBezSlownika(url) }
}

/**
 * Odczyt linku w chwili, gdy adresy właśnie się wczytały: słownik-zależne pola z linku, a ekran zostaje
 * taki, jak stan ma teraz (mógł się zmienić w trakcie ładowania). Poprawiamy tylko kartę adresu,
 * którego nie ma w danych: wraca do wyszukiwania, zamiast pokazywać pustą kartę.
 */
function zUrlPoWczytaniuAdresow(url: StanUrl): Partial<StanAplikacji> {
  const { ekran, ...reszta } = zUrlZeSlownikiem(url)
  return {
    ...reszta,
    filtry: [],
    ...(stan.ekran === 'okolica' && ekran === 'szukaj' ? { ekran } : {}),
  }
}

function sprawdzUstawienia(
  ustawienia: NonNullable<StanUrl['ustawienia']>,
  wskazniki: readonly MetaWag[],
  domyslne: { wagi: Record<string, number>; kierunki: Kierunki },
  tryb: Tryb,
  biznes: RodzajBiznesu = RODZAJ_BIZNESU_DOMYSLNY,
) {
  const znane = new Set(
    wskazniki
      .filter((w) =>
        tryb === 'biznes' ? !w.atrapa && warstwyBiznesu(biznes).includes(w.id) : true,
      )
      .map((w) => w.id),
  )
  const wagi = { ...domyslne.wagi }
  const kierunki = { ...domyslne.kierunki }
  for (const [id, waga] of Object.entries(ustawienia.wagi)) if (znane.has(id)) wagi[id] = waga
  for (const [id, kierunek] of Object.entries(ustawienia.kierunki))
    if (znane.has(id)) kierunki[id] = kierunek
  return { wagi, kierunki }
}

function doUrl(s: StanAplikacji): StanUrl {
  return {
    ekran: s.ekran,
    idAdresu: s.ekran === 'okolica' ? idAdresu(s.wybrany) : null,
    persona: s.persona === 'wlasna' ? null : s.persona,
    tryb: s.tryb,
    biznes: s.biznes,
    porownanie: s.porownanie.map((i) => idAdresu(i)).filter((id) => id !== null),
    ustawienia:
      s.persona === 'wlasna' ? { wagi: { ...s.wagi }, kierunki: { ...s.kierunki } } : null,
    filtry: [],
    // Kraków `zapiszHash` pomija (miasto domyślne), więc to pole nie psuje linków sprzed #223.
    miasto: s.miasto,
    ...(s.ekran === 'miasto' ? { symulacja: s.symulacja, warstwaLuk: s.warstwaLuk } : {}),
    branza: s.branza,
    miejsca: s.miejsca,
    filtryBiznesu: s.filtryBiznesu,
  }
}

function czytajBiezacyUrl(): StanUrl {
  const parametry = new URLSearchParams(location.hash.split('?')[1] ?? '')
  const trybLinku = parametry.get('t')
  const zapis = trybLinku
    ? odczytajPreferencjeTrybu(trybLinku === 'biznes' ? 'biznes' : 'mieszkanie')
    : odczytajPreferencje()
  // `location.search` tylko dla bezpiecznika panelu (`?panel` po powrocie z logowania Google).
  const url = polaczPreferencje(czytajHash(location.hash, location.search), location.hash, zapis)
  const sciezka = location.pathname
  if (sciezka === '/katalog' || sciezka.startsWith('/katalog/')) {
    return { ...url, ekran: 'katalog', idAdresu: null }
  }
  // Strona metody ma indeksowalną ścieżkę (/metoda, HTML z api/seo.js); w aplikacji to ekran #/metoda.
  // Kotwice spisu treści (#met-jak) zostają na metodzie, a link do innego ekranu (#/…) wygrywa.
  const innyEkran = location.hash.startsWith('#/') && !location.hash.startsWith('#/metoda')
  if (sciezka === '/metoda' && !innyEkran) return { ...url, ekran: 'metoda', idAdresu: null }
  if (sciezka.startsWith('/adres/')) {
    const slug = sciezka.slice('/adres/'.length)
    const hash = hashZeSluga(slug)
    // Ścieżka /adres/<slug> to strona SEO, a te powstają z adresów Krakowa (FR-015): rozwiązujemy ją
    // wyłącznie na słowniku Krakowa. Słownik innego miasta nie zna tego adresu, a gdyby znał z
    // przypadku skrótu, otworzyłby cudzy adres.
    if (hash && !indeksPoHash && idAdresow && miastoSlownika === MIASTO_DOMYSLNE)
      indeksPoHash = new Map(idAdresow.map((id, i) => [hashAdresu(id), i]))
    const indeks = hash ? indeksPoHash?.get(hash) : undefined
    return {
      ...url,
      ekran: 'okolica',
      idAdresu: indeks === undefined ? null : (idAdresow?.[indeks] ?? null),
    }
  }
  return url
}

function sciezkaStanu(s: StanAplikacji): string {
  // Ładne ścieżki (/adres/<slug>, /katalog) to adresy stron SEO, które istnieją tylko dla Krakowa
  // (FR-015) i nie niosą `mst=`: link do innego miasta musi iść hashem (`#/adres/<id>?mst=lodz`),
  // inaczej po odświeżeniu otworzyłby Kraków albo nieistniejącą stronę.
  if (s.miasto === MIASTO_DOMYSLNE) {
    if (s.ekran === 'okolica' && s.wybrany !== null) {
      const adres = adresyStanu[s.wybrany]
      const slug = adres && slugAdresu(adres)
      if (slug) return `/adres/${slug}`
    }
    if (s.ekran === 'katalog') return '/katalog'
  }
  if (s.ekran === 'biznes') return '/' + zapiszHash(doUrl(s))
  return `/${zapiszHash(doUrl(s))}`
}

/**
 * Stan z łatką jako hash – do `<a href>`. Stan podaj z `useStan((s) => s)`, żeby React
 * Compiler widział zależność i odświeżał link. Link, po którym stan wróciłby do mieszkańca
 * (wyjście z Biznesu, ekran Miasto), niesie od razu profil mieszkańca, a nie `t=biznes`: pasek adresu
 * i skopiowany link mówią to samo, co ekran (`czyDoMieszkanca`).
 */
export function hrefDla(s: StanAplikacji, latka: Partial<StanAplikacji>): string {
  const cel = { ...s, ...latka }
  return sciezkaStanu(czyDoMieszkanca(s.ekran, cel) ? { ...cel, ...latkaMieszkanca(cel) } : cel)
}

/**
 * Przed wczytaniem adresów nie składamy hasha od zera (zgubiłby `u=`, `cmp=`, `p=`, które stan
 * dostaje dopiero po adresach), ale ekrany Biznes i Miasto mają własne parametry niezależne od
 * słownika. Podmieniamy w bieżącym linku tylko je, bez nowego wpisu w historii: zmiana branży,
 * punktu albo filtra w pierwszych sekundach przeżywa odświeżenie strony i trafia do skopiowanego linku.
 */
function zapiszParametryEkranuPrzedDanymi(poprzedni: StanAplikacji) {
  // Zmiana ekranu to hashchange (adres już się zmienił).
  if (poprzedni.ekran !== stan.ekran) return
  // `mst` należy do każdego ekranu, nie tylko do Biznesu i Miasta: miasto wybrane w oknie ładowania
  // (lista miast działa, zanim wczytają się adresy) trafia do linku od razu, a nie dopiero z danymi.
  const klucze = ['mst', ...(PARAMETRY_EKRANU[stan.ekran] ?? [])]
  // Strona bez hasha (`/`) to to samo co `#/`; z pustym hashem podmiana dopisałaby `?mst=…` do ścieżki
  // zamiast do hasha, a `mst` czytamy tylko z hasha.
  const obecny = location.hash || '#/'
  const cel = zPodmienionymiParametrami(obecny, zapiszHash(doUrl(stan)), klucze)
  if (cel !== obecny) history.replaceState(null, '', cel)
}

function zapiszDoUrl(poprzedni: StanAplikacji) {
  if (typeof window === 'undefined' || odczytujemyHistorie) return
  // Adresu panelu nie dotyka synchronizacja stanu: zmienia go wyłącznie sam panel
  // (`wyczyscAdresPoLogowaniu`). Po powrocie z logowania Google pasek niesie `?code=…` (PKCE), a klient
  // Supabase wymienia ten kod dopiero, gdy załaduje się chunk panelu. Zapis stanu zrobiłby
  // `replaceState` na `/#/panel` (bez query), skasował kod przed wymianą i logowanie kończyłoby się
  // cichą porażką, szczególnie gdy dostawca obetnie fragment adresu powrotu.
  if (stan.ekran === 'panel') return
  if (!idAdresow) return zapiszParametryEkranuPrzedDanymi(poprzedni)
  // Indeksowalne ścieżki (/katalog/<ulica>, /metoda) to strony Krakowa i nie niosą `mst=`: zostają
  // tylko, gdy miasto było i jest Krakowem. Zmiana miasta przepisuje adres na hash z `mst=`.
  const wKrakowie = stan.miasto === MIASTO_DOMYSLNE && poprzedni.miasto === MIASTO_DOMYSLNE
  // Strona konkretnej ulicy ma własną ścieżkę, chociaż w aplikacji używa ekranu katalogu.
  if (
    wKrakowie &&
    stan.ekran === 'katalog' &&
    poprzedni.ekran === 'katalog' &&
    location.pathname.startsWith('/katalog/')
  )
    return
  // Wejście z wyszukiwarki na /metoda: zostawiamy indeksowalną ścieżkę, dopóki ekran się nie zmieni.
  if (
    wKrakowie &&
    stan.ekran === 'metoda' &&
    poprzedni.ekran === 'metoda' &&
    location.pathname === '/metoda'
  )
    return
  const cel = sciezkaStanu(stan)
  const obecny = `${location.pathname}${location.hash}`
  if (cel === obecny || (cel === '/#/' && obecny === '/')) return
  // Zmiana ekranu albo adresu to krok w historii (działa „Wstecz"), reszta tylko podmienia URL.
  const krok = poprzedni.ekran !== stan.ekran || poprzedni.wybrany !== stan.wybrany
  // Stare linki #/adres/<id> otwierają kartę i dostają kanoniczną ścieżkę bez drugiego wpisu.
  if (krok && !location.hash.startsWith('#/adres/')) history.pushState(null, '', cel)
  else history.replaceState(null, '', cel)
}

/**
 * Stan z linku, z którym użytkownik wchodzi do aplikacji (wołane raz, przy starcie w przeglądarce).
 * Link jest źródłem prawdy od pierwszej klatki: ekran Biznes startuje od branży, punktów i filtrów
 * z linku, a nie od domyślnej branży, którą po kilku sekundach przestawiałoby wczytanie adresów (#108).
 * Wyeksportowane dla testu na gołym Node – w przeglądarce woła je tylko ten plik.
 */
export function wczytajLinkStartowy(startowy: StanUrl) {
  oczekujacyUrl = startowy
  stan = { ...stan, ekran: startowy.ekran }
  if (startowy.persona) stan = { ...stan, persona: startowy.persona }
  // Tryb biznes należy tylko do ekranu Biznes: `t=biznes` w innym linku (stary link, zapis sesji) nie
  // ustawia trybu, a po wczytaniu adresów `zgodnyZTrybem` dopilnuje reszty (`czyDoMieszkanca`).
  if (startowy.tryb && !(startowy.ekran !== 'biznes' && startowy.tryb === 'biznes'))
    stan = { ...stan, tryb: startowy.tryb }
  // Miasto z linku (#223) przed polami linku: dane Biznesu i symulatora z linku należą już do tego miasta.
  stan = { ...stan, ...miastoZLinku(startowy), ...zUrlBezSlownika(startowy) }
  if (startowy.ekran === 'biznes') stan = { ...stan, tryb: 'biznes' }
}

/**
 * Zmiana hasha (wklejony link, Wstecz/Dalej) przed wczytaniem adresów. Pola bez słownika od razu
 * do stanu; id adresu i porównanie czekają w `oczekujacyUrl` na `podlaczDane`. Adres w pasku już
 * jest właściwy, więc niczego nie zapisujemy z powrotem do historii.
 *
 * Tą drogą idzie też link z INNYM miastem niż bieżące, nawet po wczytaniu danych: id adresów z tego
 * linku nie istnieją w słowniku bieżącego miasta, więc czekają na dane miasta z linku (`dane.ts`
 * wywoła `podlaczDane` od razu, jeśli ma je w pamięci).
 */
export function zastosujUrlPrzedDanymi(url: StanUrl) {
  oczekujacyUrl = url
  odczytujemyHistorie = true
  try {
    zmien({ ...miastoZLinku(url), ekran: url.ekran, ...zUrlBezSlownika(url) })
  } finally {
    odczytujemyHistorie = false
  }
}

/** Zmiana hasha: przed adresami tylko pola bez słownika, po adresach pełny odczyt (ekran, wybór, tryb, ustawienia). */
export function zastosujZmianeUrl(url: StanUrl) {
  // Pełny odczyt wymaga słownika adresów miasta Z LINKU i tego miasta jako bieżącego. Inaczej (inne
  // miasto w linku albo dane bieżącego miasta jeszcze się wczytują po `ustawMiasto`) link czeka na
  // dane jak przed pierwszym wczytaniem: stary słownik rozwiązałby id na adresach innego miasta.
  if (
    !idAdresow ||
    miastoSlownika !== stan.miasto ||
    (url.miasto ?? MIASTO_DOMYSLNE) !== stan.miasto
  )
    return zastosujUrlPrzedDanymi(url)
  const latka: Partial<StanAplikacji> = zUrl(url)
  const persona = url.ustawienia ? 'wlasna' : (url.persona ?? PERSONA_DOMYSLNA)
  const tryb = url.tryb ?? stan.tryb
  const meta = metaDoWag()
  const domyslne = ustawieniaPersony(
    persona === 'wlasna' ? PERSONA_DOMYSLNA : persona,
    tryb,
    meta,
    url.biznes ?? stan.biznes,
  )
  Object.assign(latka, {
    persona,
    tryb,
    ...(url.ustawienia
      ? sprawdzUstawienia(url.ustawienia, meta, domyslne, tryb, url.biznes ?? stan.biznes)
      : domyslne),
  })
  odczytujemyHistorie = true
  try {
    zmien(latka)
  } finally {
    odczytujemyHistorie = false
  }
}

if (typeof window !== 'undefined') {
  wczytajLinkStartowy(czytajBiezacyUrl())
  const odczytajZmianeUrl = () => zastosujZmianeUrl(czytajBiezacyUrl())
  window.addEventListener('hashchange', odczytajZmianeUrl)
  window.addEventListener('popstate', odczytajZmianeUrl)
}
