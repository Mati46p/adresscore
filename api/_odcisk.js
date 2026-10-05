// Odcisk dobowy urządzenia: pomiar ruchu bez identyfikatora osoby.
//
//   sha256(sól_dnia + ip + user_agent + host)  →  pierwsze 16 znaków hex
//
// Sól rotuje co dobę warszawską (tabela `analityka_sol`, RPC `analityka_sol_dzis`), więc odcisk
// jest nieodwracalny i NIE łączy wizyt między dniami. Dokładnie o to chodzi: dzięki temu pomiar
// jest statystyką własną i nie wymaga zgody na ciasteczka (research.md R2).
//
// GWARANCJA PRYWATNOŚCI – nie wolno jej naruszyć przy żadnej zmianie tego pliku:
// adres IP i User-Agent istnieją WYŁĄCZNIE jako argumenty `policzOdcisk`, w pamięci procesu.
// Nie trafiają do żadnej kolumny, nie są logowane (zero `console.*` z ich udziałem) i nie
// wychodzą w odpowiedzi. Funkcja przyjmuje je i oddaje wyłącznie skrót. Test
// `_zdarzenie.test.js` sprawdza to na wartościach-znacznikach.
//
// Moduł trzyma też `wolajRpc` – jedyne miejsce, które składa żądanie do PostgREST kluczem
// service_role (sól i zapis zdarzeń). Leży tu, bo `_zdarzenie.js` już importuje ten plik,
// a dwie kopie nagłówków i limitu czasu rozjechałyby się przy pierwszej zmianie.

import { createHash } from 'node:crypto'

/** Budżet na jedno wywołanie bazy. Analityka nie może zatrzymać nikomu nawigacji. */
export const TIMEOUT_MS = 2000
/** Sól to wywołanie przed zapisem, więc dostaje krótszy budżet niż sam zapis. */
export const TIMEOUT_SOLI_MS = 1500

const MIN_SOL = 16
const MAX_SOL = 256

/**
 * Separator pól w skrócie. Bez niego `("ab","c")` i `("a","bc")` dawałyby ten sam odcisk,
 * czyli dwie różne pary adres/przeglądarka mogłyby zlać się w jedno urządzenie.
 * NUL nie występuje w nagłówkach HTTP ani w adresach IP.
 */
const SEPARATOR_POL = '\u0000'

/* -------------------------------------------------------------------------- */
/* Doba warszawska                                                             */
/* -------------------------------------------------------------------------- */

// Format złożony z części, nie z tekstu zwróconego przez lokalizację: układ „2026-10-05”
// zależy od ICU, a części (`year`, `month`, `day`) nie.
const FORMAT_DNIA = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Warsaw',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/**
 * Doba warszawska jako `YYYY-MM-DD` (literał `date` w Postgresie). Intl uwzględnia czas letni,
 * więc doba 23- i 25-godzinna (ostatnie niedziele marca i października) nie gubi godzin.
 */
export function dzienWarszawy(teraz = new Date()) {
  const czesci = {}
  for (const { type, value } of FORMAT_DNIA.formatToParts(new Date(teraz))) czesci[type] = value
  return `${czesci.year}-${czesci.month}-${czesci.day}`
}

/* -------------------------------------------------------------------------- */
/* Odcisk                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Skrót identyfikujący urządzenie w obrębie doby: 16 znaków hex.
 *
 * `host` ma być hostem KANONICZNYM z konfiguracji, nie z nagłówka żądania – inaczej zmiana
 * nagłówka `Host` dawałaby świeży odcisk, a z nim świeży limit godzinowy w bazie.
 */
export function policzOdcisk(sol, ip, ua, host) {
  const wejscie = [sol, ip, ua, host].map((x) => String(x ?? '')).join(SEPARATOR_POL)
  return createHash('sha256').update(wejscie).digest('hex').slice(0, 16)
}

/* -------------------------------------------------------------------------- */
/* Wywołanie RPC (PostgREST, klucz service_role)                               */
/* -------------------------------------------------------------------------- */

const LIMIT_CZASU = new Error('limit czasu')

/**
 * Wykonuje `praca(signal)` z twardym limitem. Sam `AbortSignal` nie wystarcza: atrapa
 * albo biblioteka, która go ignoruje, zawiesiłaby żądanie na zawsze, więc wyścig z timerem.
 * Timer jest czyszczony, żeby nie trzymać procesu przy życiu.
 */
async function zLimitem(ms, praca) {
  const kontroler = new AbortController()
  let zegar
  const limit = new Promise((_ok, odrzuc) => {
    zegar = setTimeout(() => {
      kontroler.abort()
      odrzuc(LIMIT_CZASU)
    }, ms)
  })
  try {
    return await Promise.race([praca(kontroler.signal), limit])
  } finally {
    clearTimeout(zegar)
  }
}

/** Oddaje połączenie, gdy ciało odpowiedzi nie jest potrzebne (atrapa fetch może nie mieć `body`). */
async function zwolnij(res) {
  try {
    await res.body?.cancel()
  } catch {
    /* ciało i tak niepotrzebne */
  }
}

/**
 * POST `{SUPABASE_URL}/rest/v1/rpc/{nazwa}` z kluczem service_role. NIGDY NIE RZUCA.
 * Zwraca `{ ok: true, dane? }` albo `{ ok: false, powod }`, gdzie `powod` to stały tekst
 * (`brak-konfiguracji`, `brak-fetch`, `timeout`, `siec`, `http-<kod>`) bezpieczny do logu.
 * Brak zmiennych serwerowych kończy się bez wywołania `fetch`.
 */
export async function wolajRpc({
  env,
  fetch: fetchImpl,
  nazwa,
  cialo,
  timeoutMs = TIMEOUT_MS,
  odczyt = false,
}) {
  const adres =
    typeof env?.SUPABASE_URL === 'string' ? env.SUPABASE_URL.trim().replace(/\/+$/, '') : ''
  const klucz =
    typeof env?.SUPABASE_SERVICE_ROLE_KEY === 'string' ? env.SUPABASE_SERVICE_ROLE_KEY.trim() : ''
  if (!adres || !klucz) return { ok: false, powod: 'brak-konfiguracji' }
  if (typeof fetchImpl !== 'function') return { ok: false, powod: 'brak-fetch' }
  try {
    return await zLimitem(timeoutMs, async (signal) => {
      const res = await fetchImpl(`${adres}/rest/v1/rpc/${nazwa}`, {
        method: 'POST',
        headers: {
          apikey: klucz,
          authorization: `Bearer ${klucz}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(cialo),
        signal,
      })
      if (!res.ok) {
        await zwolnij(res)
        return { ok: false, powod: `http-${res.status}` }
      }
      if (!odczyt) {
        await zwolnij(res)
        return { ok: true }
      }
      return { ok: true, dane: await res.json() }
    })
  } catch (blad) {
    return { ok: false, powod: blad === LIMIT_CZASU ? 'timeout' : 'siec' }
  }
}

/* -------------------------------------------------------------------------- */
/* Sól dnia                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Cache soli w pamięci modułu: doba → OBIETNICA soli. Obietnica, nie wartość, żeby równoległe
 * żądania ciepłej instancji nie odpytywały bazy N razy przy pierwszym zdarzeniu doby.
 */
const cacheSoli = new Map()

/** Czyści cache – wyłącznie dla testów, w produkcji sól żyje do końca doby. */
export function resetujCacheSoli() {
  cacheSoli.clear()
}

async function pobierzSol({ env, fetch: fetchImpl, timeoutMs }) {
  const wynik = await wolajRpc({
    env,
    fetch: fetchImpl,
    nazwa: 'analityka_sol_dzis',
    cialo: {},
    timeoutMs,
    odczyt: true,
  })
  if (!wynik.ok) return null
  // PostgREST oddaje wynik funkcji skalarnej jako tekst JSON. Za krótka sól (np. pusty tekst)
  // dałaby odcisk stały w czasie, czyli trwały identyfikator – wolimy null niż taki skrót.
  const sol = wynik.dane
  return typeof sol === 'string' && sol.length >= MIN_SOL && sol.length <= MAX_SOL ? sol : null
}

/**
 * Sól bieżącej doby warszawskiej albo `null`, gdy bazy nie da się odpytać. NIGDY NIE RZUCA.
 *
 * Porażki NIE cache'ujemy: obietnica z `null` znika z mapy, więc następne żądanie próbuje od
 * nowa (chwilowa awaria bazy nie wyłącza odcisku do końca doby). `null` to także sygnał dla
 * wołającego, że odcisku NIE wolno zastępować wartością zapasową – bez soli skrót byłby stały
 * w czasie, czyli trwałym identyfikatorem urządzenia; zapisujemy wtedy `odcisk = null`.
 *
 * Nie ma tu zabezpieczenia przed wyścigiem „dwie instancje losują dwie sole”: sól tworzy
 * baza (`analityka_sol_dzis`, `insert … on conflict do nothing` + `select`), więc wszystkie
 * instancje dostają tę samą.
 */
export function solDnia({
  env,
  fetch: fetchImpl,
  teraz = new Date(),
  timeoutMs = TIMEOUT_SOLI_MS,
} = {}) {
  let dzien
  try {
    dzien = dzienWarszawy(teraz)
  } catch {
    return Promise.resolve(null)
  }
  const wCache = cacheSoli.get(dzien)
  if (wCache) return wCache

  const obietnica = pobierzSol({ env, fetch: fetchImpl, timeoutMs }).then((sol) => {
    if (sol === null && cacheSoli.get(dzien) === obietnica) cacheSoli.delete(dzien)
    return sol
  })
  cacheSoli.set(dzien, obietnica)
  // Sole z poprzednich dób są martwe, a mapa nie ma rosnąć na długo żyjącej instancji.
  for (const klucz of cacheSoli.keys()) {
    if (klucz !== dzien) cacheSoli.delete(klucz)
  }
  return obietnica
}
