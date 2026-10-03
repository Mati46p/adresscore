// Rdzeń pośrednika JEV (#15). Plik z prefiksem `_`, więc Vercel nie robi z niego osobnej
// funkcji – woła go `api/jev.js`, a testy wołają go bez sieci (fetch wstrzykiwany).
//
// JEV NIGDY NIE GENERUJE LICZB ANI MIEJSC. Dostaje tekst użytkownika i wybiera z zamkniętej
// listy (choice), ocenia twierdzenie (noul 0–1) albo poziom na skali (score). Odpowiedź
// spoza listy albo liczba spoza zakresu przepada jako null – wołający spada do reguły zapasowej.
// Rozkład `probabilities` (choice: id opcji, score: numer poziomu) idzie dalej jako
// `prawdopodobienstwa` – tylko znane klucze i wartości 0–1 (#154).
//
// NIGDY NIE RZUCA. Brak klucza, timeout, błąd sieci, 5xx, dziwny kształt odpowiedzi →
// `odpowiedzi: null`. Wyjątek z rozróżnieniem: 401/402/403 (zły klucz, brak kredytu, brak
// dostępu do modelu) to `powod: 'odmowa'`, osobno od błędu przejściowego – właściciel musi
// umieć odróżnić „brama odmówiła” od „chwilowo nie działa”. Wzorzec: z-dykty, pytania/jev.ts.

export const URL_JEV = 'https://api.typesafe.ai/v1/systemone'
/**
 * Model przypięty do wersji (#154). Alias `jev-latest` przesuwa się z każdym wydaniem, a progi
 * pewności strojone są pod konkretną wersję – zmiana modelu ma być świadomą zmianą w kodzie.
 */
export const MODEL_JEV = 'jev-1.13.0'
/** Budżet ścieżki na żywo: mapa przelicza się po zdaniu użytkownika, dłużej nie czekamy. */
export const TIMEOUT_MS = 800

export const LIMITY = {
  stan: 2000,
  pytan: 16,
  idPytania: 40,
  polecenie: 300,
  opcjiChoice: 128,
  opisOpcji: 300,
  poziomowScore: 10,
}

/** Limit żądań w oknie 60 s – na IP i na całą instancję (ochrona kredytu). */
export const LIMIT_ZADAN = { oknoMs: 60_000, naIp: 20, naInstancje: 300 }

const ID = /^[a-z0-9_-]+$/i

function tekst(x, maks) {
  return typeof x === 'string' && x.trim().length > 0 && x.length <= maks
}

/**
 * Sprawdza ciało żądania. Zwraca `{ stan, pytania }` w kształcie gotowym dla JEV albo
 * `{ blad }` z opisem po polsku. Kolejność kryteriów choice zostaje (JEV ją widzi).
 */
export function sprawdzZapytanie(cialo) {
  if (!cialo || typeof cialo !== 'object') return { blad: 'Ciało żądania musi być obiektem JSON' }
  if (typeof cialo.stan !== 'string' || cialo.stan.trim() === '')
    return { blad: 'Brak pola „stan” (tekst użytkownika)' }
  const wejscie = cialo.pytania
  if (!wejscie || typeof wejscie !== 'object' || Array.isArray(wejscie))
    return { blad: 'Pole „pytania” musi być obiektem' }
  const wpisy = Object.entries(wejscie)
  if (wpisy.length === 0 || wpisy.length > LIMITY.pytan)
    return { blad: `Od 1 do ${LIMITY.pytan} pytań` }

  const pytania = {}
  for (const [id, p] of wpisy) {
    if (id.length > LIMITY.idPytania || !ID.test(id)) return { blad: `Złe id pytania: ${id}` }
    if (!p || typeof p !== 'object') return { blad: `Pytanie ${id} musi być obiektem` }
    if (!tekst(p.polecenie, LIMITY.polecenie))
      return { blad: `Pytanie ${id}: „polecenie” od 1 do ${LIMITY.polecenie} znaków` }

    if (p.typ === 'noul') {
      pytania[id] = { type: 'noul', instructions: p.polecenie }
    } else if (p.typ === 'choice') {
      const k = p.kryteria
      const opcje = k && typeof k === 'object' && !Array.isArray(k) ? Object.entries(k) : []
      if (opcje.length < 2 || opcje.length > LIMITY.opcjiChoice)
        return { blad: `Pytanie ${id}: choice wymaga od 2 do ${LIMITY.opcjiChoice} opcji` }
      for (const [opcja, opis] of opcje) {
        if (opcja.length > LIMITY.idPytania || !ID.test(opcja))
          return { blad: `Pytanie ${id}: złe id opcji ${opcja}` }
        if (!tekst(opis, LIMITY.opisOpcji)) return { blad: `Pytanie ${id}: pusty opis opcji` }
      }
      pytania[id] = {
        type: 'choice',
        instructions: p.polecenie,
        criteria: Object.fromEntries(opcje),
      }
    } else if (p.typ === 'score') {
      const poziomy = p.kryteria
      if (
        !Array.isArray(poziomy) ||
        poziomy.length < 2 ||
        poziomy.length > LIMITY.poziomowScore ||
        !poziomy.every((x) => tekst(x, LIMITY.opisOpcji))
      )
        return { blad: `Pytanie ${id}: score wymaga od 2 do ${LIMITY.poziomowScore} poziomów` }
      pytania[id] = { type: 'score', instructions: p.polecenie, criteria: [...poziomy] }
    } else {
      return { blad: `Pytanie ${id}: typ musi być choice, noul albo score` }
    }
  }
  return { stan: cialo.stan.slice(0, LIMITY.stan), pytania }
}

function liczba(x, od, do_) {
  return typeof x === 'number' && Number.isFinite(x) && x >= od && x <= do_
}

/**
 * Rozkład prawdopodobieństw z JEV (#154) przycięty do dozwolonych kluczy: tylko klucze z
 * żądania, tylko liczby skończone w 0–1. Bez sumowania i normalizacji – przekazujemy, co JEV
 * dał. `undefined`, gdy JEV nic nie przysłał albo nic nie przeszło filtra (pole wtedy znika).
 */
function przytnijPrawdopodobienstwa(p, dozwolone) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return undefined
  const wynik = {}
  for (const klucz of dozwolone) {
    if (Object.hasOwn(p, klucz) && liczba(p[klucz], 0, 1)) wynik[klucz] = p[klucz]
  }
  return Object.keys(wynik).length > 0 ? wynik : undefined
}

/**
 * Jedna odpowiedź JEV → kształt kontraktu albo null. Tu pilnujemy zamkniętej listy:
 * choice musi być kluczem z kryteriów, noul w 0–1, score w 0…(poziomy − 1).
 */
function przelozOdpowiedz(pytanie, a) {
  if (!a || typeof a !== 'object') return null
  const pewnosc = liczba(a.confidence, 0, 1) ? a.confidence : null
  if (pytanie.type === 'choice') {
    if (typeof a.choice !== 'string' || !Object.hasOwn(pytanie.criteria, a.choice)) return null
    const odp = { typ: 'choice', wybor: a.choice, pewnosc }
    const prawdopodobienstwa = przytnijPrawdopodobienstwa(
      a.probabilities,
      Object.keys(pytanie.criteria),
    )
    if (prawdopodobienstwa) odp.prawdopodobienstwa = prawdopodobienstwa
    return odp
  }
  if (pytanie.type === 'noul') {
    return liczba(a.noul, 0, 1) ? { typ: 'noul', noul: a.noul } : null
  }
  if (!liczba(a.score, 0, pytanie.criteria.length - 1)) return null
  const odp = { typ: 'score', ocena: a.score, pewnosc }
  // Score: klucze to numery poziomów jako tekst – „0”…„(poziomy − 1)”.
  const prawdopodobienstwa = przytnijPrawdopodobienstwa(
    a.probabilities,
    pytanie.criteria.map((_, i) => String(i)),
  )
  if (prawdopodobienstwa) odp.prawdopodobienstwa = prawdopodobienstwa
  return odp
}

/**
 * Jedyne miejsce z I/O. Zwraca `{ odpowiedzi, powod, kod? }`, nigdy nie rzuca.
 * `AbortSignal.timeout` to timeout twardy – fetch przestaje czekać sam.
 */
export async function wolajJev(
  zapytanie,
  { klucz, fetch: fetchImpl = fetch, timeoutMs = TIMEOUT_MS },
) {
  if (!klucz) return { odpowiedzi: null, powod: 'brak-klucza' }
  let res
  try {
    res = await fetchImpl(URL_JEV, {
      method: 'POST',
      headers: { authorization: `Bearer ${klucz}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL_JEV,
        state: zapytanie.stan,
        questions: zapytanie.pytania,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch {
    return { odpowiedzi: null, powod: 'blad' } // timeout albo sieć – przejściowe
  }
  if (res.status === 401 || res.status === 402 || res.status === 403)
    return { odpowiedzi: null, powod: 'odmowa', kod: res.status }
  if (!res.ok) return { odpowiedzi: null, powod: 'blad' }
  let json
  try {
    json = await res.json()
  } catch {
    return { odpowiedzi: null, powod: 'blad' }
  }
  const answers = json?.answers
  if (!answers || typeof answers !== 'object') return { odpowiedzi: null, powod: 'blad' }
  const odpowiedzi = {}
  for (const [id, pytanie] of Object.entries(zapytanie.pytania)) {
    odpowiedzi[id] = przelozOdpowiedz(pytanie, answers[id])
  }
  return { odpowiedzi, powod: null }
}

/**
 * Limit żądań w pamięci instancji – okno przesuwne. Na Vercelu każda ciepła instancja ma
 * własny licznik, więc to bezpiecznik od pętli i nadużyć, nie dokładny limit globalny.
 */
export function utworzLimiter({ oknoMs, naIp, naInstancje } = LIMIT_ZADAN) {
  const poIp = new Map()
  let wszystkie = []
  return function przepusc(ip, teraz = Date.now()) {
    const granica = teraz - oknoMs
    wszystkie = wszystkie.filter((t) => t > granica)
    const moje = (poIp.get(ip) ?? []).filter((t) => t > granica)
    if (moje.length >= naIp || wszystkie.length >= naInstancje) {
      poIp.set(ip, moje)
      const najstarszy = Math.min(moje[0] ?? teraz, wszystkie[0] ?? teraz)
      return { ok: false, ponowZaS: Math.max(1, Math.ceil((najstarszy + oknoMs - teraz) / 1000)) }
    }
    moje.push(teraz)
    wszystkie.push(teraz)
    poIp.set(ip, moje)
    // Sprzątanie, żeby mapa nie rosła bez końca na długo żyjącej instancji.
    if (poIp.size > 5000) {
      for (const [k, v] of poIp) if (!v.some((t) => t > granica)) poIp.delete(k)
    }
    return { ok: true }
  }
}

/**
 * Całe żądanie bez obiektów HTTP: `{ status, json, naglowki? }`. Brak klucza to nie błąd
 * serwera – 200 z `odpowiedzi: null`, klient bierze regułę zapasową.
 */
export async function obsluz({ metoda, cialo, ip, env, fetch: fetchImpl, limiter, teraz }) {
  if (metoda !== 'POST')
    return { status: 405, json: { blad: 'Tylko POST' }, naglowki: { Allow: 'POST' } }
  const limit = limiter(ip || 'nieznany', teraz)
  if (!limit.ok)
    return {
      status: 429,
      json: { odpowiedzi: null, powod: 'limit' },
      naglowki: { 'Retry-After': String(limit.ponowZaS) },
    }
  const zapytanie = sprawdzZapytanie(cialo)
  if (zapytanie.blad) return { status: 400, json: { blad: zapytanie.blad } }
  const wynik = await wolajJev(zapytanie, { klucz: env.JEV_API_KEY, fetch: fetchImpl })
  if (wynik.powod === 'odmowa') console.warn(`JEV odmówił obsługi (HTTP ${wynik.kod})`)
  return { status: 200, json: wynik }
}
