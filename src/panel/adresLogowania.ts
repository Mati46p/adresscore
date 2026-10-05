// Adres panelu wokół logowania Google (PKCE): adres powrotu, rozpoznanie śladów logowania w pasku
// adresu i komunikat po nieudanym powrocie. Czyste funkcje (test w Node); `auth.ts` dokłada do nich
// `location`, `history` i klienta Supabase.
//
// Jak wygląda powrót (sprawdzone w kodzie `@supabase/auth-js` 2.117, `GoTrueClient#_initialize`):
//  - `signInWithOAuth` odsyła na `redirectTo`, a serwer autoryzacji dopisuje do query `code`
//    (stąd `/?code=…&panel=#/panel`: przy tym przepisuje query, więc `?panel` wraca jako `panel=`).
//  - Klient (`detectSessionInUrl: true`, `flowType: 'pkce'`) sam wymienia kod na sesję, gdy w
//    pasku jest `code` ORAZ w storage leży weryfikator PKCE. Po udanej wymianie usuwa z adresu
//    TYLKO `code` (i `sb_flow_id`) przez `history.replaceState`; reszta adresu zostaje.
//  - Po nieudanej wymianie (kod zużyty, brak weryfikatora) albo gdy dostawca zwrócił `error*`,
//    klient nie rusza adresu: `code` i `error*` zostają w pasku.
// Dlatego panel po ustaleniu sesji sam sprząta adres (`adresPoSprzataniu`): zostaje czysty
// `/#/panel`, bez `code`, `panel=` i błędów dostawcy.

/** Docelowy, czysty adres panelu. Hash zostaje, żeby router na hashu dalej trzymał ekran `panel`. */
export const ADRES_PANELU = '/#/panel'

/**
 * Adres powrotu z logowania. `?panel` to bezpiecznik routera (`czytajHash`): gdy dostawca obetnie
 * fragment, po powrocie zostaje `/?code=…&panel=`, a panel i tak się otworzy.
 */
export function adresPowrotu(origin: string): string {
  return `${origin}/?panel#/panel`
}

/** Parametry query, które zostawia po sobie powrót z logowania. */
const SLADY_LOGOWANIA = ['code', 'panel', 'error', 'error_code', 'error_description', 'sb_flow_id']

/** Docelowy adres po posprzątaniu albo `null`, gdy w query nie ma śladów logowania. */
export function adresPoSprzataniu(search: string): string | null {
  if (search === '') return null
  const parametry = new URLSearchParams(search)
  return SLADY_LOGOWANIA.some((k) => parametry.has(k)) ? ADRES_PANELU : null
}

export interface PowrotZLogowania {
  /** W query był `code`, czyli wejście wygląda na powrót z dostawcy. */
  bylKod: boolean
  /** Komunikat o błędzie zwróconym przez dostawcę (`error`, `error_description`), jeśli był. */
  blad: string | null
}

const MAKS_OPIS_BLEDU = 200

/**
 * Odczytuje ślady powrotu z logowania. Błąd dostawcy bywa w query (przepływ PKCE) albo we
 * fragmencie (`#error=…`), więc czytamy oba. Fragment routera (`#/panel`) nie jest zapytaniem.
 */
export function analizujPowrot(search: string, hash: string): PowrotZLogowania {
  const zQuery = new URLSearchParams(search)
  const fragment = hash.replace(/^#/, '')
  const zFragmentu = new URLSearchParams(fragment.startsWith('/') ? '' : fragment)
  const pole = (nazwa: string) => zQuery.get(nazwa) ?? zFragmentu.get(nazwa)

  const blad = pole('error')
  const opis = pole('error_description')
  let komunikat: string | null = null
  if (blad || opis) {
    komunikat =
      blad === 'access_denied'
        ? 'Logowanie zostało anulowane.'
        : opis
          ? `Logowanie nie powiodło się: ${opis.slice(0, MAKS_OPIS_BLEDU)}`
          : 'Logowanie nie powiodło się.'
  }
  return { bylKod: zQuery.has('code'), blad: komunikat }
}

/**
 * Co pokazać pod przyciskiem logowania. Błąd dostawcy wygrywa; sam `code` w adresie bez sesji po
 * inicjalizacji znaczy, że wymiana kodu się nie udała (zużyty, wygasły albo cudzy kod).
 */
export function komunikatLogowania(powrot: PowrotZLogowania, jestSesja: boolean): string | null {
  if (powrot.blad) return powrot.blad
  if (powrot.bylKod && !jestSesja) {
    return 'Nie udało się dokończyć logowania. Spróbuj jeszcze raz.'
  }
  return null
}
