// Złożenie widoku przeglądu (#223, faza F3): z migawki menedżera (`przegladMenedzer.ts`) i ustawień
// widoku (bieżące miasto, wagi, kierunki, warstwa mapy) robi `Przeglad` dla `MapaKrakowa` i
// `EkranSzukaj` oraz mówi menedżerowi, jakich warstw potrzebuje. Czysta funkcja z pamięcią w
// domknięciu, bez Reacta – testy na gołym `node --test`. Kontrakt: contracts/przeglad.md.
//
// Pamięć jest tu po to, żeby obiekty, które mapa porównuje przez `===`, zmieniały się tylko wtedy, gdy
// zmieniła się ich zawartość: `tlo` (kilkanaście tysięcy heksów), `biezaceR10`, `miastoPunktu`,
// `miasta` i same `potrzeby`. Zmiana innego wycinka stanu aplikacji (wybrany adres, ekran) nie może
// przebudować tła ani wysłać do MapLibre ponad 20 tys. porównań.
import type { Manifest } from '../kontrakty/index.ts'
import { MIASTA, type SlugMiasta, type TloMapy } from '../kontrakty/miasta.ts'
import { type Liczona, liczoneWarstwy, type PodstawaHeksow } from './heksy.ts'
import {
  type Prostokat,
  polaczProstokaty,
  type WynikiPoziomow,
  wynikiPrzegladu,
  zbudujMiastoPunktu,
  zlaczTlo,
} from './przegladLiczenie.ts'
import {
  brakujaceWarstwy,
  type Migawka,
  type Potrzeby,
  type WpisGotowy,
} from './przegladMenedzer.ts'
import type { Kierunki, Wagi } from './silnik.ts'

export interface StanPrzegladuMiasta {
  slug: SlugMiasta
  stan: 'ladowanie' | 'gotowe' | 'brak'
  /** Prostokąt heksów r8 miasta; null, dopóki przegląd nie jest gotowy. */
  granice: Prostokat | null
}

export interface Przeglad {
  /** Wszystkie miasta rejestru w jego kolejności, także te, które jeszcze się ładują. */
  miasta: readonly StanPrzegladuMiasta[]
  /** Tło do `MapaKrakowa`: wszystkie miasta gotowe poza bieżącym. Nowy obiekt tylko przy zmianie zawartości. */
  tlo: TloMapy
  /**
   * Heksy r10 bieżącego miasta z kompaktu, zanim jego pełne dane będą gotowe (dawna rola
   * `useWstepnaMapa`). `null` = czekaj na pełne dane: przegląd bieżącego miasta jeszcze się nie
   * wczytał, jest niedostępny albo pełne dane już są.
   */
  biezaceR10: ReadonlyMap<string, number | null> | null
  /** Podpis legendy: „Wynik tej okolicy” albo nazwa warstwy. */
  podpis: string
  /**
   * Prostokąt wszystkich GOTOWYCH miast. Rośnie z każdym doczytanym miastem, więc kamera ustawiona
   * po nim skakałaby przy każdym; stały kadr startowy to `WIDOK_MIAST` z `@/mapa/lot` (z rejestru).
   */
  kadrWszystkich: Prostokat | null
  /** Miasto pod punktem (po r8 z kompaktu); null = poza miastami. Obejmuje też bieżące miasto. */
  miastoPunktu: (lon: number, lat: number) => SlugMiasta | null
}

export interface WejscieSkladacza {
  biezace: SlugMiasta
  wagi: Wagi
  kierunki: Kierunki
  /** `'wynik'` albo id warstwy pokazywanej na mapie. */
  warstwa: string
  /** Czy liczyć r10 bieżącego miasta: tak, dopóki jego pełne dane się nie wczytają. */
  r10: boolean
}

export interface Zlozenie {
  przeglad: Przeglad
  /** Warstwy profilu, które ma kompakt każdego gotowego miasta; ta sama mapa, dopóki zestaw się nie zmieni. */
  potrzeby: Potrzeby
}

interface PamiecMiasta {
  // Wejścia, od których zależą `liczone`: zmiana którejkolwiek (tożsamość) liczy je od nowa.
  manifest: Manifest
  wagi: Wagi
  kierunki: Kierunki
  warstwa: string
  liczone: readonly Liczona[]
  /** Skrót `liczone`: nowa tożsamość `wagi` bez zmiany tego miasta (np. waga warstwy, której nie ma) niczego nie przelicza. */
  sygnatura: string
  /** Id warstw z `liczone`, które ma kompakt tego miasta – to je trzeba pobrać. */
  ids: readonly string[]
  // Ostatnie wyniki. Zostają, gdy profil zmienił się szybciej niż pliki warstw: lepsze kilkaset
  // milisekund koloru z poprzedniego profilu niż mrugnięcie całego tła.
  poziomy89: Wynik<WynikiPoziomow> | null
  poziom10: Wynik<ReadonlyMap<string, number | null>> | null
}

interface Wynik<T> {
  podstawa: PodstawaHeksow
  sygnatura: string
  wynik: T
}

const NAZWA_WYNIKU = 'Wynik tej okolicy'

function skrot(liczone: readonly Liczona[]): string {
  return liczone.map((l) => `${l.id}:${l.kierunek}:${l.waga}`).join('|')
}

/** Te same elementy w tej samej kolejności (`===`)? */
function takieSame<T>(a: readonly T[], b: readonly T[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i])
}

/** Dwie mapy o tych samych kluczach i tych samych wartościach (`===`)? */
function takieSameMapy<K, V>(a: ReadonlyMap<K, V>, b: ReadonlyMap<K, V>): boolean {
  if (a.size !== b.size) return false
  for (const [k, v] of a) if (b.get(k) !== v || !b.has(k)) return false
  return true
}

function podpisWarstwy(migawka: Migawka, biezace: SlugMiasta, warstwa: string): string {
  if (warstwa === 'wynik') return NAZWA_WYNIKU
  // Nazwę podaje bieżące miasto, a gdy nie zna warstwy (albo nie jest jeszcze gotowe) – dowolne, które ją
  // zna: legenda ma nazywać warstwę, także gdy bieżące miasto jest przez nią w szrafurze.
  for (const slug of [biezace, ...MIASTA.map((m) => m.slug)]) {
    const wpis = migawka.wpisy.get(slug)
    const nazwa =
      wpis?.stan === 'gotowe' ? wpis.manifest.wskazniki.find((w) => w.id === warstwa)?.nazwa : null
    if (nazwa) return nazwa
  }
  return warstwa
}

export function utworzSkladacz() {
  const pamiec = new Map<SlugMiasta, PamiecMiasta>()
  let ostatnie: { migawka: Migawka; wejscie: WejscieSkladacza; zlozenie: Zlozenie } | null = null

  let miasta: readonly StanPrzegladuMiasta[] = []
  let potrzeby: Potrzeby = new Map()
  let tlo: {
    z: ReadonlyMap<SlugMiasta, WynikiPoziomow>
    biezace: SlugMiasta
    tlo: TloMapy
  } | null = null
  let punkty: {
    z: ReadonlyMap<SlugMiasta, PodstawaHeksow>
    miastoPunktu: Przeglad['miastoPunktu']
    kadr: Prostokat | null
  } | null = null
  let przeglad: Przeglad | null = null

  /** Pamięć miasta z aktualnym `liczone`; przelicza je tylko po zmianie wejść. */
  function pamiecMiasta(
    slug: SlugMiasta,
    wpis: WpisGotowy,
    { wagi, kierunki, warstwa }: WejscieSkladacza,
  ): PamiecMiasta {
    const stara = pamiec.get(slug)
    if (
      stara &&
      stara.manifest === wpis.manifest &&
      stara.wagi === wagi &&
      stara.kierunki === kierunki &&
      stara.warstwa === warstwa
    ) {
      return stara
    }
    const liczone = liczoneWarstwy(wpis.manifest.wskazniki, wagi, kierunki, warstwa)
    const sygnatura = skrot(liczone)
    const bez = stara?.manifest === wpis.manifest && stara.sygnatura === sygnatura
    const nowa: PamiecMiasta = {
      manifest: wpis.manifest,
      wagi,
      kierunki,
      warstwa,
      liczone: stara && bez ? stara.liczone : liczone,
      sygnatura,
      ids:
        stara && bez
          ? stara.ids
          : liczone.map((l) => l.id).filter((id) => wpis.indeks.wskazniki[id] !== undefined),
      poziomy89: stara?.poziomy89 ?? null,
      poziom10: stara?.poziom10 ?? null,
    }
    pamiec.set(slug, nowa)
    return nowa
  }

  /** Wyniki miasta dla jego bieżącej roli (tło albo bieżące), gdy warstwy profilu są na miejscu. */
  function przelicz(
    slug: SlugMiasta,
    wpis: WpisGotowy,
    p: PamiecMiasta,
    wejscie: WejscieSkladacza,
  ) {
    if (brakujaceWarstwy(wpis, p.ids).length > 0) return
    const warstwa = (id: string) => wpis.warstwy.get(id) ?? null
    if (slug !== wejscie.biezace) {
      const o = p.poziomy89
      if (!o || o.podstawa !== wpis.podstawa || o.sygnatura !== p.sygnatura) {
        p.poziomy89 = {
          podstawa: wpis.podstawa,
          sygnatura: p.sygnatura,
          wynik: {
            8: wynikiPrzegladu(wpis.podstawa, p.liczone, warstwa, 8),
            9: wynikiPrzegladu(wpis.podstawa, p.liczone, warstwa, 9),
          },
        }
      }
    } else if (wejscie.r10) {
      const o = p.poziom10
      if (!o || o.podstawa !== wpis.podstawa || o.sygnatura !== p.sygnatura) {
        p.poziom10 = {
          podstawa: wpis.podstawa,
          sygnatura: p.sygnatura,
          wynik: wynikiPrzegladu(wpis.podstawa, p.liczone, warstwa, 10),
        }
      }
    }
  }

  function zloz(migawka: Migawka, wejscie: WejscieSkladacza): Zlozenie {
    if (
      ostatnie &&
      ostatnie.migawka === migawka &&
      ostatnie.wejscie.biezace === wejscie.biezace &&
      ostatnie.wejscie.wagi === wejscie.wagi &&
      ostatnie.wejscie.kierunki === wejscie.kierunki &&
      ostatnie.wejscie.warstwa === wejscie.warstwa &&
      ostatnie.wejscie.r10 === wejscie.r10
    ) {
      return ostatnie.zlozenie
    }

    const nowePotrzeby = new Map<SlugMiasta, readonly string[]>()
    const nowaTloZ = new Map<SlugMiasta, WynikiPoziomow>()
    const gotowe = new Map<SlugMiasta, PodstawaHeksow>()
    const granice: (Prostokat | null)[] = []
    const stany: StanPrzegladuMiasta[] = []
    let biezaceR10: ReadonlyMap<string, number | null> | null = null

    for (const { slug } of MIASTA) {
      const wpis = migawka.wpisy.get(slug)
      const stan = !wpis ? 'ladowanie' : wpis.stan
      const g = wpis?.stan === 'gotowe' ? wpis.granice : null
      const stary = miasta.find((m) => m.slug === slug)
      stany.push(
        stary && stary.stan === stan && stary.granice === g ? stary : { slug, stan, granice: g },
      )
      if (wpis?.stan !== 'gotowe') continue

      gotowe.set(slug, wpis.podstawa)
      granice.push(wpis.granice)
      const p = pamiecMiasta(slug, wpis, wejscie)
      nowePotrzeby.set(slug, p.ids)
      przelicz(slug, wpis, p, wejscie)
      if (slug === wejscie.biezace) {
        if (wejscie.r10) biezaceR10 = p.poziom10?.wynik ?? null
      } else if (p.poziomy89) {
        nowaTloZ.set(slug, p.poziomy89.wynik)
      }
    }

    miasta = takieSame(miasta, stany) ? miasta : stany
    potrzeby = takieSameMapy(potrzeby, nowePotrzeby) ? potrzeby : nowePotrzeby

    if (!tlo || tlo.biezace !== wejscie.biezace || !takieSameMapy(tlo.z, nowaTloZ)) {
      tlo = { z: nowaTloZ, biezace: wejscie.biezace, tlo: zlaczTlo(nowaTloZ, wejscie.biezace) }
    }

    if (!punkty || !takieSameMapy(punkty.z, gotowe)) {
      const r8 = new Map<SlugMiasta, readonly string[]>()
      for (const [slug, podstawa] of gotowe) r8.set(slug, podstawa.poziomy[8].heksy)
      punkty = { z: gotowe, miastoPunktu: zbudujMiastoPunktu(r8), kadr: polaczProstokaty(granice) }
    }

    const podpis = podpisWarstwy(migawka, wejscie.biezace, wejscie.warstwa)
    if (
      !przeglad ||
      przeglad.miasta !== miasta ||
      przeglad.tlo !== tlo.tlo ||
      przeglad.biezaceR10 !== biezaceR10 ||
      przeglad.podpis !== podpis ||
      przeglad.kadrWszystkich !== punkty.kadr ||
      przeglad.miastoPunktu !== punkty.miastoPunktu
    ) {
      przeglad = {
        miasta,
        tlo: tlo.tlo,
        biezaceR10,
        podpis,
        kadrWszystkich: punkty.kadr,
        miastoPunktu: punkty.miastoPunktu,
      }
    }

    const zlozenie = { przeglad, potrzeby }
    ostatnie = { migawka, wejscie, zlozenie }
    return zlozenie
  }

  return zloz
}
