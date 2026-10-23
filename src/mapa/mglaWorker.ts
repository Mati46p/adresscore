// Worker mgły: `cellsToMultiPolygon` po r8 wszystkich miast to ok. 3,5 s na wątku głównym (profil
// produkcyjny), a przelicza się za każdym razem, gdy dojdzie tło kolejnego miasta. Cienka powłoka
// nad czystą `zbudujOtoczke`; uruchamia go wyłącznie MapaKrakowa, która ma też zapas bez workera.
import { type Otoczka, zbudujOtoczke } from './geometria.ts'

/** Zlecenie: `id` rośnie z każdym zleceniem, żeby wołający odrzucił wynik starszy niż ostatnie. */
export interface DoWorkeraMgly {
  id: number
  r8: string[]
}

export interface ZWorkeraMgly {
  id: number
  otoczka: Otoczka
}

// tsconfig ma lib DOM, nie WebWorker – opisujemy tylko to, czego używamy z zakresu workera.
const zakres = self as unknown as {
  onmessage: ((e: MessageEvent<DoWorkeraMgly>) => void) | null
  postMessage(odpowiedz: ZWorkeraMgly): void
}

zakres.onmessage = (e) => {
  zakres.postMessage({ id: e.data.id, otoczka: zbudujOtoczke(e.data.r8) })
}
