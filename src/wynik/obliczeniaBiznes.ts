// Tryb „Biznes” we wspólnym workerze obliczeń (E10, #105, #108). Moduł nie dotyka `self` ani
// `fetch`: pobieranie (`pobierz`) i wysyłanie odpowiedzi (`wyslij`) wstrzykuje router w workerze,
// a test w Node podstawia pliki z dysku, więc cała logika działa tak samo w obu miejscach.
//
// Kontrakt wiadomości (do routera dochodzą z polem `tryb: 'biznes'`):
//   → { typ: 'start' }                                  popyt (największy plik) pobiera się z góry
//   → { typ: 'init', branza, filtry }                   indeks branży i filtrów
//   ← { typ: 'gotowe', wersja, meta, punkty, plamy, zrodla }
//   → { typ: 'ocen', id: 'a'..'e', punkt, wersja }       ocena stawianego miejsca (miejsca A–E)
//   ← { typ: 'ocena', wersja, id, ocena }
//   ← { typ: 'blad', wersja, blad }
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
import type { IdMiejsca } from './url.ts'

interface DanePopytu {
  komorki: KomorkaPopytu[]
  zrodla?: ZrodloDanych[]
}

export type WiadomoscBiznesu =
  | { typ: 'start' }
  /** `filtry` przychodzą z ekranu, ale walidujemy je tu: byle co daje „bez filtrów”, nie wyjątek. */
  | { typ: 'init'; branza: string; filtry: FiltryUslug }
  | { typ: 'ocen'; id: IdMiejsca; punkt: { lon: number; lat: number }; wersja: number }

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
  let popyt: Promise<{ komorki: IndeksKomorek; zrodla: ZrodloDanych[] }> | null = null
  let indeks: IndeksBiznesu | null = null
  let wersja = 0
  // Pliki branż zostają w pamięci: przełączenie filtra nie pobiera ich ponownie.
  const pliki = new Map<string, Promise<PlikUslug>>()

  function wczytajPopyt() {
    popyt ??= (pobierz('/dane/biznes/popyt.json') as Promise<DanePopytu>)
      .then((d) => ({ komorki: przygotujKomorki(d.komorki), zrodla: d.zrodla ?? [] }))
      .catch((e) => {
        popyt = null // kolejna zmiana branży ponowi pobranie
        throw e
      })
    return popyt
  }

  function wczytajPlik(id: string): Promise<PlikUslug> {
    // Id trafia do ścieżki, więc przechodzą tylko nazwy z katalogu (małe litery i podkreślenia).
    if (typeof id !== 'string' || !/^[a-z_]+$/.test(id))
      return Promise.reject(new Error('Nieprawidłowa nazwa branży'))
    let plik = pliki.get(id)
    if (!plik) {
      plik = (pobierz(`/dane/uslugi/${id}.json`) as Promise<PlikUslug>).catch((e) => {
        pliki.delete(id) // kolejny wybór tej branży ponowi pobranie
        throw e
      })
      pliki.set(id, plik)
    }
    return plik
  }

  return {
    async obsluz(d) {
      if (d.typ === 'start') {
        // Popyt pobiera się równolegle z katalogiem branż, zanim padnie wybór branży.
        wczytajPopyt().catch(() => undefined)
        return
      }
      if (d.typ === 'init') {
        const mojaWersja = ++wersja
        indeks = null // do czasu zbudowania nowego nie oceniamy na indeksie poprzedniej branży
        try {
          const [{ komorki, zrodla }, plik] = await Promise.all([
            wczytajPopyt(),
            wczytajPlik(d.branza),
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
      popyt = null
      pliki.clear()
    },
  }
}
