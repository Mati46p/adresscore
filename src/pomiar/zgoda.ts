// Sprzeciw wobec pomiaru (art. 21 RODO) i sygnał Global Privacy Control (FR-004, FR-005).
//
// TO JEDYNY PLIK POMIARU, KTÓRY DOTYKA MAGAZYNU PRZEGLĄDARKI – i robi to wyłącznie dla klucza
// `pomiar-wylaczony`, wyłącznie przy WYŁĄCZENIU pomiaru. Włączenie klucz usuwa, więc po
// domyślnym stanie nie zostaje na urządzeniu nic. Pilnuje tego `prywatnosc.test.ts` (pozostałe
// pliki modułu nie mogą zawierać nazw API magazynów) i `zgoda.test.ts` (jakie klucze padają).
//
// DLACZEGO NIE „zgoda”: pomiar opiera się na prawnie uzasadnionym interesie (statystyki własne,
// bez ciasteczek), więc nie pytamy o zgodę – dajemy sprzeciw. Brak wyboru = pomiar włączony.
// Wybór „wyłączone” nie jest identyfikatorem (jedna wartość, taka sama u wszystkich).
//
// KAŻDY dostęp w try/catch: tryb prywatny, zablokowane dane witryn i iframe z sandboxem rzucają
// już przy samym odczycie składowej `localStorage`. Gdy zapis się nie uda, wybór działa do końca
// życia strony (zmienna modułowa) – sprzeciw nie może zginąć tylko dlatego, że przeglądarka
// nie pozwala nic zapisać.

export const KLUCZ_WYLACZENIA = 'pomiar-wylaczony'

/**
 * Wybór podtrzymany w pamięci strony, gdy zapis do magazynu zawiódł (`true` = pomiar wyłączony).
 * `null` = magazyn jest źródłem prawdy. Nie trzymamy go zawsze, bo druga karta mogła zmienić
 * wybór w międzyczasie i pamięć tej karty byłaby przeterminowana.
 */
let wyborPamieci: boolean | null = null

const sluchacze = new Set<() => void>()
let nasluchujeKarty = false

/** Sygnał „Nie sprzedawaj i nie udostępniaj moich danych” wysyłany przez przeglądarkę. */
export function wylaczonyPrzezGpc(): boolean {
  try {
    const nawigator = globalThis.navigator as
      | (Navigator & { globalPrivacyControl?: boolean })
      | undefined
    return nawigator?.globalPrivacyControl === true
  } catch {
    return false
  }
}

/**
 * Czy pomiar jest wyłączony: sygnał GPC przeglądarki albo wybór użytkownika.
 * Stabilny prymityw, więc nadaje się wprost jako snapshot `useSyncExternalStore`
 * (subskrypcja: `subskrybujZgode`, snapshot serwerowy: `() => false`).
 */
export function pomiarWylaczony(): boolean {
  if (wylaczonyPrzezGpc()) return true
  if (wyborPamieci !== null) return wyborPamieci
  try {
    return globalThis.localStorage.getItem(KLUCZ_WYLACZENIA) === '1'
  } catch {
    return false
  }
}

function powiadom() {
  for (const sluchacz of sluchacze) sluchacz()
}

/** Zmiana wyboru w innej karcie: zdarzenie `storage` dla naszego klucza (albo czyszczenia całości). */
function naZmianieMagazynu(zdarzenie: StorageEvent) {
  if (zdarzenie.key === null || zdarzenie.key === KLUCZ_WYLACZENIA) powiadom()
}

/**
 * Zapisuje wybór. `wlaczony = false` to sprzeciw: klucz trafia do magazynu. `true` klucz USUWA
 * (nie zapisujemy „włączone”, żeby po domyślnym stanie nie zostawało nic na urządzeniu).
 */
export function ustawPomiar(wlaczony: boolean): void {
  let zapisano = false
  try {
    if (wlaczony) globalThis.localStorage.removeItem(KLUCZ_WYLACZENIA)
    else globalThis.localStorage.setItem(KLUCZ_WYLACZENIA, '1')
    zapisano = true
  } catch {
    // Brak magazynu: wybór obowiązuje do końca życia strony.
  }
  wyborPamieci = zapisano ? null : !wlaczony
  powiadom()
}

/**
 * Subskrypcja zmiany wyboru (przełącznik na stronie Metody, inna karta). Zwraca funkcję
 * kończącą subskrypcję. Nasłuch `storage` podpinamy leniwie, przy pierwszym subskrybencie.
 */
export function subskrybujZgode(sluchacz: () => void): () => void {
  sluchacze.add(sluchacz)
  if (!nasluchujeKarty && typeof globalThis.addEventListener === 'function') {
    globalThis.addEventListener('storage', naZmianieMagazynu)
    nasluchujeKarty = true
  }
  return () => {
    sluchacze.delete(sluchacz)
    if (sluchacze.size === 0 && nasluchujeKarty) {
      globalThis.removeEventListener('storage', naZmianieMagazynu)
      nasluchujeKarty = false
    }
  }
}
