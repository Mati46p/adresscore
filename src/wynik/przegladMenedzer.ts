// Menedżer przeglądu wszystkich miast (#223, faza F3): ładuje lekką postać danych każdego miasta
// (`kompakt/indeks.json`, `manifest.json`, `heksy.bin`, warstwy heksów z wagą > 0) i trzyma ją w pamięci,
// żeby mapa mogła pokolorować wszystkie miasta naraz. Pełnych danych (adresy, wszystkie warstwy) tu
// nie ma – wczytuje je wyłącznie bieżące miasto (`dane.ts`, FR-005).
//
// Osobny plik bez Reacta i bez `import.meta.env` (jak `pamiecDanych.ts`): sieć i rejestr wchodzą z
// zewnątrz (`ZaleznosciMenedzera`), więc kolejność ładowania, limit pobrań i izolację błędów da się
// sprawdzić na gołym `node --test`. Złożenie widoku z tych danych robi `przegladSklad.ts`, a Reactem
// i prawdziwym `fetch` zajmuje się `przeglad.ts`.
//
// Kolejność (D13), po to żeby Kraków nie zwolnił (SC-003) i żeby miasta dochodziły po kolei:
//   1. bieżące miasto: indeks, manifest, heksy i warstwy profilu, wszystko BEZ limitu – tak jak przed #223;
//   2. pozostałe miasta startują dopiero, gdy bieżące ma pierwszy kolor (wszystkie warstwy profilu na
//      miejscu) albo gdy wiadomo, że go nie będzie (przegląd tego miasta niedostępny);
//   3. pobrania tła idą po najwyżej `LIMIT_POBRAN_TLA` naraz, miasta w kolejności rejestru, a w obrębie
//      miasta w kolejności zgłoszeń.
// Błąd jednego miasta (sieć, niezgodny kompakt) kończy się jego wpisem `brak`; reszta działa (FR-013).
import type { Manifest, WskaznikMeta } from '../kontrakty/index.ts'
import type { SlugMiasta } from '../kontrakty/miasta.ts'
import type { PodstawaHeksow, WarstwaHeksow } from './heksy.ts'
import { type IndeksKompaktu, niezgodnoscKompaktu, rozpakuj } from './kompakt.ts'
import {
  graniceZHeksow,
  type Prostokat,
  podstawaZPliku,
  warstwaPasuje,
  warstwaZPliku,
} from './przegladLiczenie.ts'

/** Ile pobrań naraz dla miast innych niż bieżące (D13). */
export const LIMIT_POBRAN_TLA = 3

/** Przegląd miasta gotowy do liczenia kolorów. */
export interface WpisGotowy {
  stan: 'gotowe'
  indeks: IndeksKompaktu
  manifest: Manifest
  podstawa: PodstawaHeksow
  /** Prostokąt heksów r8 – do kadru wszystkich miast. */
  granice: Prostokat | null
  /** Warstwy, których plik już jest (id → wiersze macierzy). */
  warstwy: ReadonlyMap<string, WarstwaHeksow>
  /** Warstwy, których plik się nie wczytał: liczą się jak brak danych, nie blokują miasta. */
  nieudane: ReadonlySet<string>
}

/** Przegląd miasta, którego nie udało się wczytać albo który nie zgadza się z manifestem. */
export interface WpisBrak {
  stan: 'brak'
  powod: string
}

/** Brak wpisu znaczy „ładuje się albo jeszcze nie ruszyło” – dla widoku to to samo. */
export type WpisPrzegladu = WpisGotowy | WpisBrak

/** Niezmienna migawka stanu menedżera: każda zmiana to nowy obiekt, więc porównuje się ją przez `===`. */
export interface Migawka {
  readonly wpisy: ReadonlyMap<SlugMiasta, WpisPrzegladu>
}

/** Czego potrzebuje widok: dla każdego gotowego miasta id warstw profilu, które ma jego kompakt. */
export type Potrzeby = ReadonlyMap<SlugMiasta, readonly string[]>

/** Warstwy z `ids`, których plik jeszcze nie przyszedł (ani nie zawiódł). */
export function brakujaceWarstwy(wpis: WpisGotowy, ids: readonly string[]): string[] {
  return ids.filter(
    (id) => wpis.indeks.wskazniki[id] && !wpis.warstwy.has(id) && !wpis.nieudane.has(id),
  )
}

// ── Kolejka pobrań ───────────────────────────────────────────────────────────────────────

interface Zadanie {
  slug: SlugMiasta
  numer: number
  praca: () => Promise<unknown>
  ok: (wartosc: unknown) => void
  blad: (powod: unknown) => void
}

export interface OpcjeKolejki {
  /** Ile pobrań naraz dla miast innych niż bieżące. */
  limit: number
  /** Bieżące miasto (jego pobrania idą bez limitu) albo null, zanim widok je zgłosi. */
  biezace: () => SlugMiasta | null
  /** Pierwszeństwo miasta w tle: mniejsza liczba = wcześniej (kolejność rejestru). */
  ranga: (slug: SlugMiasta) => number
}

/**
 * Kolejka pobrań z jednym pasem bez limitu (bieżące miasto) i jednym z limitem (reszta). Bieżące miasto
 * pobiera tyle naraz, ile da przeglądarka, bo jego kolory to pierwsza rzecz, którą widać; tło nie ma
 * przeszkadzać ani jemu, ani pełnym danym ładowanym obok. Miasto, które staje się bieżące, przejmuje
 * swoje oczekujące zadania na pas bez limitu przy następnym `pompuj()`.
 */
export function utworzKolejkePobran({ limit, biezace, ranga }: OpcjeKolejki) {
  const oczekujace: Zadanie[] = []
  let wTle = 0
  let numer = 0

  /** Miasto wcześniejsze w rejestrze idzie przed późniejszym, a w obrębie miasta kolejność zgłoszeń. */
  function wczesniej(a: Zadanie, b: Zadanie): boolean {
    const roznica = ranga(a.slug) - ranga(b.slug)
    return roznica !== 0 ? roznica < 0 : a.numer < b.numer
  }

  function uruchom(z: Zadanie, zLimitem: boolean) {
    let p: Promise<unknown>
    try {
      p = z.praca()
    } catch (e) {
      p = Promise.reject(e)
    }
    // Miejsce wraca do kolejki, zanim wołający dostanie wynik: jego następne pobranie (np. heksy po
    // manifeście) widzi już wolny pas, a nie gonitwę o miejsce, które zaraz się zwolni.
    const zwolnij = () => {
      if (!zLimitem) return
      wTle--
      pompuj()
    }
    p.then(
      (wartosc) => {
        zwolnij()
        z.ok(wartosc)
      },
      (powod: unknown) => {
        zwolnij()
        z.blad(powod)
      },
    )
  }

  /** Uruchamia, co wolno uruchomić teraz. Wołać po zmianie bieżącego miasta. */
  function pompuj() {
    // Wybór przed startem: `praca` może (w teście) wołać kolejkę z powrotem, a start w pętli
    // przestawiłby tablicę pod nogami.
    const bezLimitu: Zadanie[] = []
    const zLimitem: Zadanie[] = []
    const teraz = biezace()
    for (let i = 0; i < oczekujace.length; ) {
      const z = oczekujace[i] as Zadanie
      if (z.slug === teraz) {
        oczekujace.splice(i, 1)
        bezLimitu.push(z)
      } else i++
    }
    while (wTle < limit && oczekujace.length > 0) {
      let najlepsze = 0
      for (let i = 1; i < oczekujace.length; i++) {
        if (wczesniej(oczekujace[i] as Zadanie, oczekujace[najlepsze] as Zadanie)) najlepsze = i
      }
      zLimitem.push(oczekujace.splice(najlepsze, 1)[0] as Zadanie)
      wTle++
    }
    for (const z of bezLimitu) uruchom(z, false)
    for (const z of zLimitem) uruchom(z, true)
  }

  /** Dodaje pobranie miasta `slug`; wynik to wynik `praca`, uruchomionej, gdy kolej dojdzie do zadania. */
  function dodaj<T>(slug: SlugMiasta, praca: () => Promise<T>): Promise<T> {
    return new Promise<T>((ok, blad) => {
      oczekujace.push({ slug, numer: ++numer, praca, ok: ok as (w: unknown) => void, blad })
      pompuj()
    })
  }

  return { dodaj, pompuj, stan: () => ({ oczekujace: oczekujace.length, wTle }) }
}

// ── Menedżer ─────────────────────────────────────────────────────────────────────────────

export interface ZaleznosciMenedzera {
  /** Miasta w kolejności rejestru (Kraków pierwszy): od niej zależy kolejność ładowania tła. */
  miasta: readonly SlugMiasta[]
  /** Katalog danych miasta (`bazaDanych`). */
  baza: (slug: SlugMiasta) => string
  /** `manifest.json` zbioru o danej bazie. */
  manifest: (baza: string) => Promise<Manifest>
  /** Pobiera i parsuje JSON (`kompakt/indeks.json`); rzuca przy HTTP innym niż 200. */
  json: <T>(url: string) => Promise<T>
  /** Pobiera plik binarny (`.bin`); rzuca przy HTTP innym niż 200. */
  bajty: (url: string) => Promise<ArrayBuffer>
  /**
   * Warstwy miasta wchodzą do mapy wag stanu (`dodajMetaMiasta`, D9), zanim miasto zostanie ogłoszone
   * jako gotowe: kolor miasta w przeglądzie liczy się wagami, w których te warstwy już są.
   */
  dodajMetaMiasta: (wskazniki: readonly WskaznikMeta[]) => void
  ostrzez: (komunikat: string, powod?: unknown) => void
  /** Domyślnie `LIMIT_POBRAN_TLA`. */
  limitTla?: number
  /** Raz, gdy każde miasto jest w stanie końcowym i ma komplet warstw profilu – do logu SC-002. */
  poUstabilizowaniu?: () => void
}

export function utworzMenedzerPrzegladu(d: ZaleznosciMenedzera) {
  // Stan roboczy; do widoku trafia jego migawka. Wpisy są niemutowalne: zmiana to nowy obiekt.
  const wpisy = new Map<SlugMiasta, WpisPrzegladu>()
  let migawka: Migawka = { wpisy: new Map(wpisy) }
  const sluchacze = new Set<() => void>()

  let biezace: SlugMiasta | null = null
  let potrzeby: Potrzeby = new Map()
  let tloOtwarte = false
  let zameldowano = false
  const ladowanie = new Map<SlugMiasta, Promise<void>>()
  const wTrakcie = new Set<string>()

  const kolejka = utworzKolejkePobran({
    limit: d.limitTla ?? LIMIT_POBRAN_TLA,
    biezace: () => biezace,
    ranga: (slug) => d.miasta.indexOf(slug),
  })

  function publikuj() {
    migawka = { wpisy: new Map(wpisy) }
    for (const f of [...sluchacze]) f()
  }

  function ustaw(slug: SlugMiasta, wpis: WpisPrzegladu) {
    wpisy.set(slug, wpis)
    publikuj()
  }

  /**
   * Miasto ma „pierwszy kolor”, gdy widok może je pokolorować: ma wszystkie warstwy profilu na miejscu
   * (albo wiadomo, że któraś nie przyjdzie) albo nie ma co na nie czekać, bo przegląd jest niedostępny.
   * Zanim widok zgłosi zapotrzebowanie na gotowe miasto, nie wiadomo, czego mu brakuje – czekamy.
   */
  function ustabilizowane(slug: SlugMiasta): boolean {
    const wpis = wpisy.get(slug)
    if (!wpis) return false
    if (wpis.stan === 'brak') return true
    const ids = potrzeby.get(slug)
    return ids !== undefined && brakujaceWarstwy(wpis, ids).length === 0
  }

  /** Otwiera tło po pierwszym kolorze bieżącego miasta i raz melduje, że wszystko jest na miejscu. */
  function sprawdz() {
    if (!tloOtwarte && biezace !== null && ustabilizowane(biezace)) {
      tloOtwarte = true
      for (const slug of d.miasta) zapewnijMiasto(slug)
    }
    if (!zameldowano && tloOtwarte && d.miasta.every(ustabilizowane)) {
      zameldowano = true
      d.poUstabilizowaniu?.()
    }
  }

  async function wczytajMiasto(slug: SlugMiasta): Promise<void> {
    try {
      const baza = d.baza(slug)
      const [manifest, indeks] = await Promise.all([
        kolejka.dodaj(slug, () => d.manifest(baza)),
        kolejka.dodaj(slug, () => d.json<IndeksKompaktu>(`${baza}/kompakt/indeks.json`)),
      ])
      // Każde miasto sprawdza swój kompakt względem swojego manifestu (R4): niezgodne miasto zostaje
      // pod mgłą, reszta mapy działa.
      const powod = niezgodnoscKompaktu(indeks, manifest)
      if (powod !== null) throw new Error(`nieaktualny kompakt: ${powod}`)
      // Po sprawdzeniu zgodności, przed ogłoszeniem miasta: wagi stanu mają już jego warstwy.
      d.dodajMetaMiasta(manifest.wskazniki)
      const bufor = await kolejka.dodaj(slug, () => d.bajty(`${baza}/kompakt/${indeks.heksy.plik}`))
      const podstawa = podstawaZPliku(await rozpakuj(bufor))
      ustaw(slug, {
        stan: 'gotowe',
        indeks,
        manifest,
        podstawa,
        granice: graniceZHeksow(podstawa.poziomy[8].heksy),
        warstwy: new Map(),
        nieudane: new Set(),
      })
    } catch (e) {
      d.ostrzez(`Przegląd miasta ${slug} niedostępny`, e)
      ustaw(slug, { stan: 'brak', powod: e instanceof Error ? e.message : String(e) })
    }
    sprawdz()
  }

  /**
   * Startuje ładowanie przeglądu miasta, jeśli jeszcze nie trwa i nie ma go w pamięci. Miasto, które
   * się nie wczytało, ma drugą szansę, gdy użytkownik w nie wejdzie (`ponow`): przejściowy błąd sieci
   * nie zostaje na całą sesję, a miasto, do którego użytkownik nie zagląda, nie męczy sieci.
   */
  function zapewnijMiasto(slug: SlugMiasta, ponow = false) {
    if (ladowanie.has(slug)) return
    const wpis = wpisy.get(slug)
    if (wpis?.stan === 'gotowe') return
    if (wpis?.stan === 'brak' && !ponow) return
    // Rezerwacja przed `publikuj()`: nasłuchujący może w odpowiedzi zgłosić zapotrzebowanie, a wtedy
    // miasto nie ruszyłoby drugi raz.
    ladowanie.set(slug, Promise.resolve())
    if (wpis?.stan === 'brak') {
      wpisy.delete(slug)
      publikuj()
    }
    ladowanie.set(
      slug,
      wczytajMiasto(slug).finally(() => ladowanie.delete(slug)),
    )
  }

  /** Dopisuje wynik pobrania warstwy; `null` = plik się nie wczytał. */
  function zapiszWarstwe(slug: SlugMiasta, stary: WpisGotowy, id: string, w: WarstwaHeksow | null) {
    const wpis = wpisy.get(slug)
    // Miasto mogło zostać wczytane od nowa (po błędzie) – warstwa ze starego indeksu nie pasuje do nowego.
    if (wpis?.stan !== 'gotowe' || wpis.indeks !== stary.indeks) return
    ustaw(
      slug,
      w
        ? { ...wpis, warstwy: new Map(wpis.warstwy).set(id, w) }
        : { ...wpis, nieudane: new Set(wpis.nieudane).add(id) },
    )
    sprawdz()
  }

  function zamowWarstwe(slug: SlugMiasta, id: string) {
    const wpis = wpisy.get(slug)
    if (wpis?.stan !== 'gotowe' || wpis.warstwy.has(id) || wpis.nieudane.has(id)) return
    const plik = wpis.indeks.wskazniki[id]?.heksy.plik
    const klucz = `${slug}/${id}`
    if (!plik || wTrakcie.has(klucz)) return
    wTrakcie.add(klucz)
    const adres = `${d.baza(slug)}/kompakt/${plik}`
    void kolejka
      .dodaj(slug, () => d.bajty(adres))
      .then(rozpakuj)
      .then((r) => {
        const warstwa = warstwaZPliku(r)
        if (!warstwaPasuje(wpis.podstawa, warstwa)) {
          throw new Error('wiersze warstwy nie pasują do heksów miasta')
        }
        return warstwa
      })
      .then(
        (warstwa) => zapiszWarstwe(slug, wpis, id, warstwa),
        (e: unknown) => {
          // Jedna zepsuta warstwa nie blokuje miasta (jak w dane.ts): liczy się jak brak danych.
          d.ostrzez(`Warstwa ${id} (${slug}) poza przeglądem`, e)
          zapiszWarstwe(slug, wpis, id, null)
        },
      )
      .finally(() => wTrakcie.delete(klucz))
  }

  return {
    /** Aktualna migawka; ta sama, dopóki nic się nie zmieni (dla `useSyncExternalStore`). */
    migawka: () => migawka,

    subskrybuj(sluchacz: () => void): () => void {
      sluchacze.add(sluchacz)
      return () => {
        sluchacze.delete(sluchacz)
      }
    },

    /**
     * Widok zgłasza bieżące miasto i warstwy, których potrzebuje do kolorów. Idempotentne: ponowne
     * zgłoszenie tego samego niczego nie pobiera drugi raz. Woła się po każdej zmianie profilu, warstwy
     * mapy, miasta i po dojściu nowego miasta (wtedy dopiero wiadomo, jakie ma warstwy).
     */
    zazadaj(nowe: SlugMiasta, nowePotrzeby: Potrzeby) {
      const zmianaMiasta = biezace !== nowe
      biezace = nowe
      potrzeby = nowePotrzeby
      zapewnijMiasto(nowe, zmianaMiasta)
      if (zmianaMiasta) kolejka.pompuj()
      for (const [slug, ids] of nowePotrzeby) for (const id of ids) zamowWarstwe(slug, id)
      sprawdz()
    },

    /** Stan kolejki pobrań – do testów i logu. */
    stanKolejki: kolejka.stan,
  }
}

export type MenedzerPrzegladu = ReturnType<typeof utworzMenedzerPrzegladu>
