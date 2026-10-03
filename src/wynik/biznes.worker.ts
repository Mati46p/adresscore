import {
  bialePlamyZIndeksu,
  type IndeksBiznesu,
  type IndeksKomorek,
  type KomorkaPopytu,
  ocenMiejsceWIndeksie,
  type PunktUslugi,
  przygotujKomorki,
  zbudujIndeks,
} from './biznes.ts'
import type { ZrodloDanych } from './biznesOpis.ts'

interface Meta {
  id: string
  nazwa: string
  zasiegM: number
  liczbaPunktow: number
  dataDanych: string
  zrodlo?: string
  licencja?: string
}
interface DanePopytu {
  komorki: KomorkaPopytu[]
  zrodla?: ZrodloDanych[]
}
interface DanePunktow {
  meta: Meta
  punkty: PunktUslugi[]
}

// Heksy popytu nie zależą od branży: pobieramy je i indeksujemy RAZ na worker. Po wyborze branży
// budujemy tylko indeks jej punktów, a każda ocena miejsca liczy wyłącznie heksy w jego promieniu.
let popyt: Promise<{ komorki: IndeksKomorek; zrodla: ZrodloDanych[] }> | null = null
let indeks: IndeksBiznesu | null = null
let wersja = 0

async function pobierz<T>(sciezka: string): Promise<T> {
  const odp = await fetch('/dane/biznes/' + sciezka)
  if (!odp.ok) throw new Error(sciezka + ': HTTP ' + odp.status)
  return odp.json() as Promise<T>
}

function wczytajPopyt() {
  popyt ??= pobierz<DanePopytu>('popyt.json')
    .then((d) => ({ komorki: przygotujKomorki(d.komorki), zrodla: d.zrodla ?? [] }))
    .catch((e) => {
      popyt = null // kolejna zmiana branży ponowi pobranie
      throw e
    })
  return popyt
}

self.onmessage = async (event: MessageEvent) => {
  const d = event.data
  if (d.typ === 'init') {
    const mojaWersja = ++wersja
    indeks = null // do czasu zbudowania nowego nie oceniamy na indeksie poprzedniej branży
    try {
      const { komorki, zrodla } = await wczytajPopyt()
      const plik = await pobierz<DanePunktow>(d.branza + '.json')
      if (mojaWersja !== wersja) return
      indeks = zbudujIndeks(komorki, plik.punkty, plik.meta.zasiegM)
      const plamy = bialePlamyZIndeksu(indeks)
      self.postMessage({
        typ: 'gotowe',
        wersja,
        meta: plik.meta,
        punkty: plik.punkty,
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
