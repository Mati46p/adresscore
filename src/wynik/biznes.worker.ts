import {
  type KomorkaPopytu,
  obliczBazowePunkty,
  obliczBialePlamy,
  ocenMiejsce,
  type PunktUslugi,
} from './biznes.ts'

interface Meta {
  id: string
  nazwa: string
  zasiegM: number
  liczbaPunktow: number
  dataDanych: string
}
interface DanePopytu {
  komorki: KomorkaPopytu[]
}
interface DanePunktow {
  meta: Meta
  punkty: PunktUslugi[]
}

let komorki: KomorkaPopytu[] | null = null
let punkty: PunktUslugi[] = []
let meta: Meta | null = null
let baza: number[] = []
let wersja = 0

async function pobierz<T>(sciezka: string): Promise<T> {
  const odp = await fetch('/dane/biznes/' + sciezka)
  if (!odp.ok) throw new Error(sciezka + ': HTTP ' + odp.status)
  return odp.json() as Promise<T>
}

self.onmessage = async (event: MessageEvent) => {
  const d = event.data
  if (d.typ === 'init') {
    const mojaWersja = ++wersja
    try {
      komorki ??= (await pobierz<DanePopytu>('popyt.json')).komorki
      const plik = await pobierz<DanePunktow>(d.branza + '.json')
      if (mojaWersja !== wersja) return
      punkty = plik.punkty
      meta = plik.meta
      baza = obliczBazowePunkty(komorki, punkty, meta.zasiegM)
      const plamy = obliczBialePlamy(komorki, punkty, meta.zasiegM)
      self.postMessage({ typ: 'gotowe', wersja, meta, punkty, plamy })
    } catch (e) {
      if (mojaWersja === wersja)
        self.postMessage({ typ: 'blad', wersja, blad: e instanceof Error ? e.message : String(e) })
    }
  }
  if (d.typ === 'ocen' && komorki && meta && d.wersja === wersja) {
    const ocena = ocenMiejsce(komorki, punkty, meta.zasiegM, d.punkt, baza)
    self.postMessage({ typ: 'ocena', wersja, id: d.id, ocena })
  }
}
