import {
  bialePlamyZIndeksu,
  type IndeksBiznesu,
  type IndeksKomorek,
  type KomorkaPopytu,
  ocenMiejsceWIndeksie,
  przygotujKomorki,
  zbudujIndeks,
} from './biznes.ts'
import type { ZrodloDanych } from './biznesOpis.ts'
import {
  BEZ_FILTROW,
  type FiltryUslug,
  metaBranzy,
  type PlikUslug,
  punktyBranzy,
} from './biznesUslugi.ts'

interface DanePopytu {
  komorki: KomorkaPopytu[]
  zrodla?: ZrodloDanych[]
}

// Heksy popytu nie zależą od branży: pobieramy je i indeksujemy RAZ na worker. Po wyborze branży
// albo zmianie filtrów budujemy tylko indeks jej punktów, a każda ocena miejsca liczy wyłącznie
// heksy w jego promieniu. Punkty pochodzą z katalogu usług (`public/dane/uslugi`, #104 i #160).
let popyt: Promise<{ komorki: IndeksKomorek; zrodla: ZrodloDanych[] }> | null = null
let indeks: IndeksBiznesu | null = null
let wersja = 0
// Pliki branż zostają w pamięci workera: przełączenie filtra nie pobiera ich ponownie.
const pliki = new Map<string, Promise<PlikUslug>>()

async function pobierz<T>(sciezka: string): Promise<T> {
  const odp = await fetch(sciezka)
  if (!odp.ok) throw new Error(sciezka + ': HTTP ' + odp.status)
  return odp.json() as Promise<T>
}

function wczytajPopyt() {
  popyt ??= pobierz<DanePopytu>('/dane/biznes/popyt.json')
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
    plik = pobierz<PlikUslug>(`/dane/uslugi/${id}.json`).catch((e) => {
      pliki.delete(id) // kolejny wybór tej branży ponowi pobranie
      throw e
    })
    pliki.set(id, plik)
  }
  return plik
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

self.onmessage = async (event: MessageEvent) => {
  const d = event.data
  if (d.typ === 'start') {
    // Popyt (największy plik) pobiera się równolegle z katalogiem branż, zanim padnie wybór branży.
    wczytajPopyt().catch(() => undefined)
  }
  if (d.typ === 'init') {
    const mojaWersja = ++wersja
    indeks = null // do czasu zbudowania nowego nie oceniamy na indeksie poprzedniej branży
    try {
      const [{ komorki, zrodla }, plik] = await Promise.all([wczytajPopyt(), wczytajPlik(d.branza)])
      if (mojaWersja !== wersja) return
      const filtry = filtryZWiadomosci(d.filtry)
      const branza = punktyBranzy(plik, filtry)
      indeks = zbudujIndeks(komorki, branza.punkty, branza.zasiegM)
      const plamy = bialePlamyZIndeksu(indeks)
      self.postMessage({
        typ: 'gotowe',
        wersja,
        meta: metaBranzy(branza, filtry),
        punkty: branza.punkty,
        plamy,
        zrodla,
      })
    } catch (e) {
      if (mojaWersja === wersja)
        self.postMessage({ typ: 'blad', wersja, blad: e instanceof Error ? e.message : String(e) })
    }
  }
  if (d.typ === 'ocen' && indeks && d.wersja === wersja) {
    const { lon, lat } = d.punkt ?? {}
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return
    const ocena = ocenMiejsceWIndeksie(indeks, { lon, lat })
    self.postMessage({ typ: 'ocena', wersja, id: d.id, ocena })
  }
}
