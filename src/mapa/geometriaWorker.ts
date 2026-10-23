// Worker geometrii mapy, jeden na mapę. Dwie ciężkie rzeczy, które zjadały wątek główny telefonu:
// - mgła: `cellsToMultiPolygon` po r8 wszystkich miast to ok. 3,5 s (profil produkcyjny), a przelicza
//   się za każdym razem, gdy dojdzie tło kolejnego miasta,
// - heksy: `cellToBoundary` i składanie GeoJSON dla ok. 35 tys. poligonów (r10/r9/r8 + tło), a potem
//   jego serializacja do workera MapLibre (strukturalne klonowanie ok. 400 tys. obiektów, 3 s).
// Heksy wracają jako Blob z gotowym JSON-em: wątek główny robi z niego URL, a MapLibre pobiera i
// parsuje go u siebie. Cienka powłoka nad czystymi funkcjami z geometria.ts; uruchamia ją wyłącznie
// `DostawcaGeoJson`, który ma też zapas bez workera.
import { kolekcjaZWartosciami, type Otoczka, zbudujOtoczke } from './geometria.ts'

/** Zlecenia: `id` rośnie z każdym zleceniem danego rodzaju, żeby wołający odrzucił wynik starszy niż ostatnie. */
export type DoWorkera =
  | { rodzaj: 'mgla'; id: number; r8: string[] }
  | {
      rodzaj: 'heksy'
      id: number
      zrodlo: string
      klucze: string[]
      /** Stany `w` w kolejności `klucze` (brak = -1, wykluczony = -2). Float64, żeby JSON był taki sam jak dawniej. */
      w: Float64Array
    }

export type ZWorkera =
  | { rodzaj: 'mgla'; id: number; otoczka: Otoczka }
  | { rodzaj: 'heksy'; id: number; zrodlo: string; blob: Blob }

// tsconfig ma lib DOM, nie WebWorker – opisujemy tylko to, czego używamy z zakresu workera.
const zakres = self as unknown as {
  onmessage: ((e: MessageEvent<DoWorkera>) => void) | null
  postMessage(odpowiedz: ZWorkera): void
}

zakres.onmessage = (e) => {
  const z = e.data
  if (z.rodzaj === 'mgla') {
    zakres.postMessage({ rodzaj: 'mgla', id: z.id, otoczka: zbudujOtoczke(z.r8) })
    return
  }
  const json = JSON.stringify(kolekcjaZWartosciami(z.klucze, z.w))
  zakres.postMessage({
    rodzaj: 'heksy',
    id: z.id,
    zrodlo: z.zrodlo,
    blob: new Blob([json], { type: 'application/json' }),
  })
}
