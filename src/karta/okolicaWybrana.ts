// Okolica wybrana w wyszukiwarce na ekranie Szukaj (#185): co mówi pasek pod polem. Czyste funkcje bez
// DOM i bez Reacta (testy na gołym `node --test`).
//
// Zasady:
// - Nazwa z OSM („Salwator”) to punkt leżący w jednostce SIM, nie granice osiedla (etl/okolice.md). Pasek mówi,
//   że mapa pokazuje całą jednostkę, i nie twierdzi, że osiedle kończy się na jej obrysie.
// - Miejscowość poza Krakowem i jednostka bez wpisu w pliku granic nie mają obrysu: pasek mówi, że mapa
//   pokazuje obszar adresów, żeby brak linii nie wyglądał na usterkę.
// - Uwagi o nazwie jednostki (np. „Nowa Huta” to 6% dzielnicy) to gotowe teksty z okolice.json, jak na karcie.
import type { OkolicaNaMapie } from '../mapa/okolica/granice.ts'
import type { MiejsceAdresu } from '../wynik/miejsceAdresu.ts'

export interface WybranaOkolica {
  naMapie: OkolicaNaMapie
  miejsce: MiejsceAdresu
  /** Nazwa z OSM, po której wybrano okolicę; null, gdy wybrano ją po nazwie okolicy. */
  nazwaOsm: string | null
}

/** Zdanie o nazwie z OSM; null, gdy okolicę wybrano po jej własnej nazwie. */
export function zdanieOSM(nazwaOsm: string | null): string | null {
  return nazwaOsm === null
    ? null
    : `Nazwa „${nazwaOsm}” to punkt z OpenStreetMap leżący w tej jednostce, a nie granice osiedla, więc mapa pokazuje całą jednostkę.`
}

/** Zdanie o tym, czemu na mapie nie ma obrysu; null, gdy obrys jest. */
export function zdanieBezObrysu(w: Pick<WybranaOkolica, 'naMapie' | 'miejsce'>): string | null {
  if (w.naMapie.obrys !== null) return null
  return w.miejsce.rodzaj === 'miejscowosc'
    ? 'Nie mamy granic miejscowości poza Krakowem, więc mapa pokazuje obszar jej adresów.'
    : 'Nie mamy granic tej jednostki, więc mapa pokazuje obszar jej adresów.'
}
