// Sesja admina: logowanie Google (PKCE), wylogowanie i stan sesji dla Reacta.
//
// Ten moduł (razem z `@/lib/supabase`) trafia WYŁĄCZNIE do chunka panelu, więc klient Supabase
// powstaje dopiero po wejściu na `#/panel`. Moduł niczego nie decyduje o uprawnieniach: sesja to
// tylko „kto pyta”, a o dostępie rozstrzyga `jest_adminem()` w bazie (kod 42501 → „brak dostępu”).
import type { Session } from '@supabase/supabase-js'
import { useSyncExternalStore } from 'react'
import { supabase } from '@/lib/supabase'
import {
  adresPoSprzataniu,
  adresPowrotu,
  analizujPowrot,
  komunikatLogowania,
} from './adresLogowania.ts'
import { wyczyscDane } from './dane.ts'

export type StanSesji =
  | { rodzaj: 'ladowanie' }
  | { rodzaj: 'brak' }
  | { rodzaj: 'zalogowany'; sesja: Session }

const LADOWANIE: StanSesji = { rodzaj: 'ladowanie' }
const BRAK: StanSesji = { rodzaj: 'brak' }

// Ślady powrotu z logowania zapisujemy W CHWILI IMPORTU, zanim klient Supabase wymieni kod i
// zmieni adres: potem już nie wiadomo, czy wejście było powrotem z dostawcy i czy zwrócił błąd.
const POWROT =
  typeof location === 'undefined'
    ? { bylKod: false, blad: null }
    : analizujPowrot(location.search, location.hash)

// Komunikat o powrocie z logowania (błąd dostawcy, nieudana wymiana kodu) dotyczy WEJŚCIA na stronę.
// Gdy tylko pojawi się sesja albo użytkownik sam zaloguje się lub wyloguje, przestaje być aktualny:
// po wylogowaniu nie wolno straszyć błędem sprzed minut.
let powrotAktualny = true

// Stan jako jedna migawka z subskrybentami (`useSyncExternalStore` wymaga STABILNEJ referencji:
// nowy obiekt tylko wtedy, gdy stan naprawdę się zmienił).
let migawka: StanSesji = LADOWANIE
let idKonta: string | null = null
let wystartowano = false
const sluchacze = new Set<() => void>()

function ustawSesje(sesja: Session | null): void {
  const noweId = sesja?.user.id ?? null
  if (sesja) powrotAktualny = false
  if (noweId !== idKonta) {
    // Zmiana konta albo wylogowanie: dane poprzedniego admina nie mogą zostać na ekranie. Po
    // wylogowaniu (`noweId === null`) nie pytamy ponownie o dane: poszłyby bez sesji.
    idKonta = noweId
    void wyczyscDane(noweId !== null)
  }
  const poprzednia = migawka
  if (
    sesja &&
    poprzednia.rodzaj === 'zalogowany' &&
    poprzednia.sesja.access_token === sesja.access_token
  ) {
    return // ta sama sesja (np. powtórzone zdarzenie): bez zbędnego renderu
  }
  migawka = sesja ? { rodzaj: 'zalogowany', sesja } : BRAK
  if (migawka === poprzednia) return
  for (const s of [...sluchacze]) s()
}

function start(): void {
  if (wystartowano) return
  wystartowano = true
  if (!supabase) {
    migawka = BRAK
    return
  }
  // Callback nie woła innych metod klienta: dokumentacja ostrzega przed zakleszczeniem blokady.
  supabase.auth.onAuthStateChange((_zdarzenie, sesja) => ustawSesje(sesja))
  // Pewnik: stan wychodzi z „ładowania” także wtedy, gdy zdarzenie początkowe nie nadejdzie.
  supabase.auth
    .getSession()
    .then(({ data }) => {
      if (migawka.rodzaj === 'ladowanie') ustawSesje(data.session)
    })
    .catch(() => {
      if (migawka.rodzaj === 'ladowanie') ustawSesje(null)
    })
}

function subskrybuj(naZmiane: () => void): () => void {
  sluchacze.add(naZmiane)
  start()
  return () => {
    sluchacze.delete(naZmiane)
  }
}

/** Stan sesji: `ladowanie` (klient jeszcze sprawdza storage i ewentualny powrót z logowania), `brak`, `zalogowany`. */
export function useSesja(): StanSesji {
  return useSyncExternalStore(
    subskrybuj,
    () => migawka,
    () => migawka,
  )
}

/** Czy baza jest skonfigurowana (zmienne `VITE_SUPABASE_*`). Bez niej panel pokazuje komunikat. */
export const BAZA_SKONFIGUROWANA = supabase !== null

/**
 * Przekierowuje do Google. Przy powodzeniu strona odchodzi, więc wartość zwracana dotyczy tylko
 * błędu startu (do pokazania pod przyciskiem).
 */
export async function zaloguj(): Promise<string | null> {
  if (!supabase) return 'Brak konfiguracji bazy.'
  powrotAktualny = false
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: adresPowrotu(location.origin) },
  })
  return error ? 'Nie udało się rozpocząć logowania. Spróbuj jeszcze raz.' : null
}

/** Wylogowuje tylko tę przeglądarkę (`local`); domyślny zakres `global` wylogowałby admina z każdego urządzenia. */
export async function wyloguj(): Promise<void> {
  if (!supabase) return
  powrotAktualny = false
  await supabase.auth.signOut({ scope: 'local' })
}

/**
 * Sprząta pasek adresu po powrocie z logowania: zostaje czysty `/#/panel`. Klient sam usuwa z adresu
 * tylko `code` (po udanej wymianie), więc `?panel=` i ślady błędów dostawcy czyścimy my. Wołane po
 * ustaleniu sesji, bo wcześniej usunięcie `code` mogłoby przerwać wymianę. Stan routera nie
 * dostaje żadnego zdarzenia (`replaceState` nie wywołuje `hashchange`), a hash `#/panel` zostaje.
 */
export function wyczyscAdresPoLogowaniu(): void {
  const cel = adresPoSprzataniu(location.search)
  if (cel !== null) history.replaceState(null, '', cel)
}

/**
 * Komunikat pod przyciskiem logowania po nieudanym powrocie od dostawcy; `null`, gdy nie ma czego
 * pokazać albo gdy od wejścia na stronę zdarzyło się już logowanie lub wylogowanie.
 */
export function bladLogowania(): string | null {
  return powrotAktualny ? komunikatLogowania(POWROT, false) : null
}
