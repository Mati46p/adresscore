// Odczyt danych panelu: rejestr widoków (`widoki.ts`) + pamięć podręczna z TTL 5 minut
// (`magazyn.ts`) + klient bazy. Zakładka woła WYŁĄCZNIE `useWidok`; nazwa funkcji bazy pochodzi
// zawsze z rejestru, nigdy z danych ani z adresu.
//
// Autorytet trzyma baza: każda `admin_*` zaczyna się od `jest_adminem()` i odmawia kodem 42501.
// Ten plik niczego nie ukrywa przed użytkownikiem bez uprawnień (robi to RLS i bramka w SQL);
// tylko rozróżnia odmowę („brak dostępu”) od zwykłej awarii.
//
// Jak użyć w zakładce:
//   const kanaly = useWidok('kanaly', { p_dni: 30 })
//   kanaly.dane       // WierszKanalu[] | null  (null = jeszcze nie ma albo błąd)
//   kanaly.ladowanie  // true przy pierwszym ładowaniu i przy odświeżaniu (stare dane zostają)
//   kanaly.blad       // { rodzaj: 'brak_dostepu' } | { rodzaj: 'blad', komunikat } | null
//   kanaly.pobrano    // moment ostatniego udanego pobrania (ms), do znacznika wieku danych
// Typy wierszy: `@/panel/typy`. Do gotowego szkieletu stanów (ładowanie/błąd/pusto) służy `Sekcja`.
import { useEffect, useSyncExternalStore } from 'react'
import { supabase } from '@/lib/supabase'
import {
  type BladWidoku,
  polaczStany,
  type StanWidoku,
  type StanWpisu,
  utworzMagazyn,
  type WynikPobrania,
} from './magazyn.ts'
import {
  argumentyRpc,
  klasyfikujBlad,
  kluczWidoku,
  type NazwaWidoku,
  type OdpowiedzWidoku,
  type ParametryWidoku,
  sprawdzKsztalt,
  WIDOKI,
} from './widoki.ts'

export type { BladWidoku, NazwaWidoku, OdpowiedzWidoku, ParametryWidoku, StanWidoku, WynikPobrania }
export { polaczStany }

/** Jak długo wynik jest świeży bez ponownego pytania bazy (research.md R14). */
export const TTL_DANYCH_MS = 5 * 60_000

const magazyn = utworzMagazyn({ ttlMs: TTL_DANYCH_MS })

async function pobierzZBazy(
  widok: NazwaWidoku,
  parametry: unknown,
): Promise<WynikPobrania<unknown>> {
  if (!supabase) {
    return {
      rodzaj: 'blad',
      komunikat: 'Brak konfiguracji bazy (VITE_SUPABASE_URL i VITE_SUPABASE_ANON_KEY).',
    }
  }
  const definicja = WIDOKI[widok]
  const { data, error } = await supabase.rpc(
    definicja.rpc,
    argumentyRpc(widok, parametry as ParametryWidoku<typeof widok>),
  )
  if (error) return klasyfikujBlad(error)
  const ksztalt = sprawdzKsztalt(definicja.ksztalt, data)
  if (!ksztalt.ok) {
    return { rodzaj: 'blad', komunikat: 'Baza zwróciła odpowiedź w nieoczekiwanym kształcie.' }
  }
  return { rodzaj: 'dane', dane: ksztalt.dane }
}

/**
 * Dane widoku. Pobiera przy zamontowaniu (świeży wpis z pamięci nie powoduje pytania do bazy),
 * współdzieli pobranie między komponentami i odświeża się po `odswiezWszystko()`.
 */
export function useWidok<W extends NazwaWidoku>(
  widok: W,
  parametry?: ParametryWidoku<W>,
): StanWidoku<OdpowiedzWidoku<W>> {
  const klucz = kluczWidoku(widok, parametry)
  const wpis = useSyncExternalStore(
    (naZmiane) => magazyn.subskrybuj(klucz, naZmiane),
    () => magazyn.odczytaj(klucz),
    () => magazyn.odczytaj(klucz),
  ) as StanWpisu<OdpowiedzWidoku<W>>

  // Efekt zależy od klucza, który powstaje z widoku i parametrów, więc zmiana któregokolwiek
  // z nich uruchamia nowe pytanie.
  useEffect(() => {
    void magazyn.zazadaj(klucz, () => pobierzZBazy(widok, parametry))
  }, [klucz])

  return {
    dane: wpis.dane,
    blad: wpis.blad,
    // Pierwsze renderowanie jest przed efektem, który zaczyna pobieranie: bez dopisku wpis
    // „jeszcze nic” wyglądałby przez ułamek sekundy jak „brak danych”.
    ladowanie: wpis.ladowanie || (wpis.dane === null && wpis.blad === null),
    pobrano: wpis.pobrano,
  }
}

/**
 * Jednorazowe pobranie poza Reactem (np. eksport do pliku): przez tę samą pamięć podręczną co
 * `useWidok`, więc świeży wpis nie powoduje drugiego pytania. Wynik: `dane`, `brak_dostepu` (odmowa
 * bramki, kod 42501) albo `blad` z komunikatem po polsku. Nie rzuca.
 */
export async function pobierz<W extends NazwaWidoku>(
  widok: W,
  parametry?: ParametryWidoku<W>,
): Promise<WynikPobrania<OdpowiedzWidoku<W>>> {
  const klucz = kluczWidoku(widok, parametry)
  await magazyn.zazadaj(klucz, () => pobierzZBazy(widok, parametry))
  const wpis = magazyn.odczytaj(klucz) as StanWpisu<OdpowiedzWidoku<W>>
  if (wpis.blad) return wpis.blad
  if (wpis.dane !== null) return { rodzaj: 'dane', dane: wpis.dane }
  return { rodzaj: 'blad', komunikat: 'Nie udało się pobrać danych.' }
}

/** „Odśwież”: ponawia pytania o wszystko, co jest na ekranie, i zapomina resztę. */
export function odswiezWszystko(): Promise<void> {
  return magazyn.odswiezWszystko()
}

/**
 * Zapomina wszystkie dane od razu. Wołane przy zmianie konta i wylogowaniu: dane poprzedniego
 * admina nie mogą zostać pokazane następnemu użytkownikowi tej samej karty przeglądarki.
 * `ponow` (domyślnie tak): ponownie zapytaj o to, co jest na ekranie; przy wylogowaniu nie.
 */
export function wyczyscDane(ponow = true): Promise<void> {
  return magazyn.zapomnij(ponow)
}

/** Najstarszy moment pobrania wśród danych na ekranie (znacznik „Dane z godz. …”), `null` bez danych. */
export function useNajstarszyPobrano(): number | null {
  return useSyncExternalStore(
    magazyn.subskrybujOgolne,
    magazyn.najstarszePobranie,
    magazyn.najstarszePobranie,
  )
}
