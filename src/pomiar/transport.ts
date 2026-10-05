// Transport do endpointu zapisu: beacon z awaryjnym fetch. Jedyne miejsce modułu, z którego dane
// wychodzą do sieci (pilnuje tego prywatnosc.test.ts), więc to tu widać wszystko, co opuszcza
// przeglądarkę: ciało `{"z":[…]}` z kolejki, nic więcej, bez ciasteczek i bez nagłówków własnych.
//
// DLACZEGO BEACON: przeżywa zamknięcie karty tam, gdzie zwykłe żądanie bywa ubijane razem
// z dokumentem – a właśnie wtedy wysyłamy najcenniejsze zdarzenie (`wyjscie` z czasem czytania).
// Typ `text/plain` jest celowy: `application/json` wymusiłby preflight CORS, a endpoint i tak
// parsuje tekst (contracts/endpoint-zdarzenie.md).
//
// BŁĘDY SĄ TŁUMIONE I NIE MA PONOWIEŃ: analityka nie psuje nawigacji, a pętla ponowień przy
// niedostępnym endpoincie (deploy, awaria) mnożyłaby ruch wtedy, gdy serwer go nie potrzebuje.

export const ADRES_ENDPOINTU = '/api/zdarzenie'

const TYP_CIALA = 'text/plain;charset=UTF-8'

export interface Srodowisko {
  /** `navigator.sendBeacon` związane z `navigator`; `undefined`, gdy przeglądarka go nie ma. */
  beacon?: (adres: string, dane: Blob) => boolean
  /** `fetch` związane z oknem; `undefined`, gdy go nie ma. */
  zadanie?: (adres: string, opcje: RequestInit) => Promise<unknown>
}

/**
 * Funkcja wysyłająca ciało żądania: najpierw beacon, a gdy go brak, odmówi (kolejka beaconów
 * pełna) albo rzuci – `fetch` z `keepalive`. Zawsze zwraca, nigdy nie rzuca i nie zostawia
 * nieobsłużonego odrzucenia obietnicy.
 */
export function utworzTransport(srodowisko: Srodowisko): (cialo: string) => void {
  return (cialo) => {
    const { beacon, zadanie } = srodowisko
    if (beacon) {
      try {
        if (beacon(ADRES_ENDPOINTU, new Blob([cialo], { type: TYP_CIALA }))) return
      } catch {
        // Beacon odmówił – próbujemy fetchem niżej.
      }
    }
    if (!zadanie) return
    try {
      // `keepalive`: odsłonę zgłaszamy tuż przed nawigacją, a bez niego przeglądarka
      // anulowałaby żądanie razem z bieżącym dokumentem. `omit`: ani jednego ciasteczka.
      zadanie(ADRES_ENDPOINTU, {
        method: 'POST',
        body: cialo,
        keepalive: true,
        credentials: 'omit',
        cache: 'no-store',
        headers: { 'content-type': TYP_CIALA },
      }).catch(() => {})
    } catch {
      // Synchroniczny wyjątek (np. nieprawidłowe opcje) też nie wychodzi na zewnątrz.
    }
  }
}
