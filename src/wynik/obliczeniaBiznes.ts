// Tryb „Biznes” we wspólnym workerze obliczeń (E10, #105, #108). Moduł nie dotyka `self` ani
// `fetch`: pobieranie (`pobierz`) i wysyłanie odpowiedzi (`wyslij`) wstrzykuje router w workerze,
// a test w Node podstawia pliki z dysku, więc cała logika działa tak samo w obu miejscach.
//
// Kontrakt wiadomości (do routera dochodzą z polem `tryb: 'biznes'`):
//   → { typ: 'start', baza }                            popyt (największy plik) pobiera się z góry
//   → { typ: 'init', baza, branza, filtry }             indeks branży i filtrów
//   ← { typ: 'gotowe', wersja, meta, punkty, plamy, zrodla }
//   → { typ: 'ocen', id: 'a'..'e', punkt, wersja }       ocena stawianego miejsca (miejsca A–E)
//   ← { typ: 'ocena', wersja, id, ocena }
//   ← { typ: 'blad', wersja, blad }
//
// `baza` to katalog danych zbioru (`/dane`, `/dane/miasta/lublin`, #223). Worker ma własną kopię modułów
// stanu (zawsze Kraków), więc bieżącego miasta nie zna – katalog przysyła wątek główny (`bazaBiezaca()`).
// Popyt i pliki branż są pamiętane po PEŁNEJ ŚCIEŻCE, więc zmiana zbioru nie poda plików poprzedniego.
// Popyt policzono tylko dla Krakowa (D8): dla katalogu miasta nic się nie pobiera, a `init` odpowiada
// `blad` z `BLAD_BEZ_POPYTU` (ekran i tak pokazuje wtedy „Na razie tylko w Krakowie”, zanim cokolwiek wyśle).
import {
  type BialaPlama,
  bialePlamyZIndeksu,
  type IndeksBiznesu,
  type IndeksKomorek,
  type KomorkaPopytu,
  type OcenaMiejsca,
  ocenMiejsceWIndeksie,
  type PunktUslugi,
  przygotujKomorki,
  zbudujIndeks,
} from './biznes.ts'
import type { ZrodloDanych } from './biznesOpis.ts'
import {
  BEZ_FILTROW,
  type FiltryUslug,
  type MetaBranzy,
  metaBranzy,
  type PlikUslug,
  punktyBranzy,
} from './biznesUslugi.ts'
import { utworzPamiecPlikow } from './pamiecPlikow.ts'
import { czyKatalogDanych, popytDostepny, sciezkaBranzy, sciezkaPopytu } from './sciezkiDanych.ts'
import type { IdMiejsca } from './url.ts'

interface DanePopytu {
  komorki: KomorkaPopytu[]
  zrodla?: ZrodloDanych[]
}

export type WiadomoscBiznesu =
  /** `baza`: katalog danych zbioru, z którego worker bierze popyt (patrz nagłówek pliku). */
  | { typ: 'start'; baza: string }
  /** `filtry` przychodzą z ekranu, ale walidujemy je tu: byle co daje „bez filtrów”, nie wyjątek. */
  | { typ: 'init'; baza: string; branza: string; filtry: FiltryUslug }
  | { typ: 'ocen'; id: IdMiejsca; punkt: { lon: number; lat: number }; wersja: number }

/** Powód odmowy dla zbioru bez popytu (D8): ten sam komunikat trafia na ekran jako `blad`. */
export const BLAD_BEZ_POPYTU =
  'Tryb Biznes jest na razie tylko w Krakowie: popyt policzono tylko dla Krakowa i okolicznych gmin.'

/** Pliki branż trzymane naraz: katalog jednego zbioru ma 26–27 branż, z zapasem na drugi zbiór. */
const MAKS_PLIKOW_BRANZ = 64

export type OdpowiedzBiznesu =
  | {
      typ: 'gotowe'
      wersja: number
      meta: MetaBranzy
      punkty: PunktUslugi[]
      plamy: BialaPlama[]
      zrodla: ZrodloDanych[]
    }
  | { typ: 'ocena'; wersja: number; id: IdMiejsca; ocena: OcenaMiejsca }
  | { typ: 'blad'; wersja: number; blad: string }

export interface WejscieObslugiBiznesu {
  /** JSON spod ścieżki (`/dane/...`); rzuca, gdy odpowiedź nie jest poprawna. */
  pobierz(sciezka: string): Promise<unknown>
  wyslij(odpowiedz: OdpowiedzBiznesu): void
}

export interface ObslugaBiznesu {
  obsluz(w: WiadomoscBiznesu): Promise<void>
  /** Oddaje popyt, pliki branż i indeks, gdy ekran Biznes się zamknął, a worker żyje dla innego trybu. */
  zwolnij(): void
}

/** Filtry z wiadomości ekranu; byle co daje „bez filtrów”, a nie wyjątek w workerze. */
function filtryZWiadomosci(dane: unknown): FiltryUslug {
  const f = dane as Partial<FiltryUslug> | null | undefined
  if (!f || typeof f !== 'object') return BEZ_FILTROW
  return {
    min2Zrodla: f.min2Zrodla === true,
    flagi: f.flagi && typeof f.flagi === 'object' ? f.flagi : {},
  }
}

export function utworzObslugeBiznesu({ pobierz, wyslij }: WejscieObslugiBiznesu): ObslugaBiznesu {
  // Heksy popytu nie zależą od branży: pobieramy je i indeksujemy RAZ na życie trybu. Po wyborze
  // branży albo zmianie filtrów budujemy tylko indeks jej punktów, a każda ocena miejsca liczy
  // wyłącznie heksy w jego promieniu. Punkty pochodzą z katalogu usług (`public/dane/uslugi`,
  // #104 i #160).
  // Pamięć po pełnej ścieżce (patrz nagłówek): popyt jeden naraz, bo to największy plik trybu, pliki
  // branż zostają, więc przełączenie filtra ich nie pobiera ponownie. Błąd pobrania nie zostaje w
  // pamięci – kolejna zmiana branży ponowi pobranie.
  const popyty = utworzPamiecPlikow<{ komorki: IndeksKomorek; zrodla: ZrodloDanych[] }>(1)
  const pliki = utworzPamiecPlikow<PlikUslug>(MAKS_PLIKOW_BRANZ)
  let indeks: IndeksBiznesu | null = null
  let wersja = 0

  /**
   * Katalog danych z wiadomości ekranu, gdy wolno z niego brać popyt. Wyjątek zamiast cichego Krakowa:
   * `init` zamienia go w `blad`, a ekran pokaże powód. Zbiór bez popytu nie pobiera niczego.
   */
  function katalogZPopytem(baza: unknown): string {
    if (!czyKatalogDanych(baza)) throw new Error('Nieprawidłowy katalog danych')
    if (!popytDostepny(baza)) throw new Error(BLAD_BEZ_POPYTU)
    return baza
  }

  function wczytajPopyt(baza: string) {
    const sciezka = sciezkaPopytu(baza)
    return popyty.pobierz(sciezka, () =>
      (pobierz(sciezka) as Promise<DanePopytu>).then((d) => ({
        komorki: przygotujKomorki(d.komorki),
        zrodla: d.zrodla ?? [],
      })),
    )
  }

  function wczytajPlik(baza: string, id: string): Promise<PlikUslug> {
    // Id trafia do ścieżki, więc przechodzą tylko nazwy z katalogu (małe litery i podkreślenia).
    if (typeof id !== 'string' || !/^[a-z_]+$/.test(id))
      return Promise.reject(new Error('Nieprawidłowa nazwa branży'))
    const sciezka = sciezkaBranzy(baza, id)
    return pliki.pobierz(sciezka, () => pobierz(sciezka) as Promise<PlikUslug>)
  }

  return {
    async obsluz(d) {
      if (d.typ === 'start') {
        // Popyt pobiera się równolegle z katalogiem branż, zanim padnie wybór branży. Zły katalog albo
        // zbiór bez popytu: nic nie pobieramy, a powód dostanie ekran w odpowiedzi na `init`.
        if (czyKatalogDanych(d.baza) && popytDostepny(d.baza))
          wczytajPopyt(d.baza).catch(() => undefined)
        return
      }
      if (d.typ === 'init') {
        const mojaWersja = ++wersja
        indeks = null // do czasu zbudowania nowego nie oceniamy na indeksie poprzedniej branży
        try {
          const baza = katalogZPopytem(d.baza)
          const [{ komorki, zrodla }, plik] = await Promise.all([
            wczytajPopyt(baza),
            wczytajPlik(baza, d.branza),
          ])
          if (mojaWersja !== wersja) return
          const filtry = filtryZWiadomosci(d.filtry)
          const branza = punktyBranzy(plik, filtry)
          indeks = zbudujIndeks(komorki, branza.punkty, branza.zasiegM)
          const plamy = bialePlamyZIndeksu(indeks)
          wyslij({
            typ: 'gotowe',
            wersja,
            meta: metaBranzy(branza, filtry),
            punkty: branza.punkty,
            plamy,
            zrodla,
          })
        } catch (e) {
          if (mojaWersja === wersja)
            wyslij({ typ: 'blad', wersja, blad: e instanceof Error ? e.message : String(e) })
        }
        return
      }
      if (d.typ === 'ocen' && indeks && d.wersja === wersja) {
        // Punkt przychodzi z ekranu, ale sprawdzamy go tu: byle co jest pomijane, a nie wyjątkiem.
        const punkt = d.punkt as Partial<{ lon: number; lat: number }> | null | undefined
        const lon = punkt?.lon
        const lat = punkt?.lat
        if (typeof lon !== 'number' || typeof lat !== 'number') return
        if (!Number.isFinite(lon) || !Number.isFinite(lat)) return
        const ocena = ocenMiejsceWIndeksie(indeks, { lon, lat })
        wyslij({ typ: 'ocena', wersja, id: d.id, ocena })
      }
    },
    zwolnij() {
      // Nowa wersja unieważnia też `init`, który w tej chwili czeka na pobranie: nie odeśle wyniku
      // do ekranu, którego już nie ma.
      wersja++
      indeks = null
      popyty.wyczysc()
      pliki.wyczysc()
    },
  }
}
