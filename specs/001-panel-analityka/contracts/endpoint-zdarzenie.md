# Kontrakt: `POST /api/zdarzenie`

Pliki: `api/zdarzenie.js` (adapter `handler(req, res, { env, fetch })`, wzór `api/jev.js`),
`api/_zdarzenie.js` (czysta logika `obsluz`), `api/_zdarzenie-kontrakt.js` (stałe),
`api/_odcisk.js`, `api/_ruch.js` (boty, kanał), testy `api/_*.test.js` (`node --test api/`).

## Żądanie

- Metoda: `POST` (inne → 405, bez ciała).
- `Origin`: host z `ADRESSCORE_HOSTY` (lista po przecinku, np. `adresscore.pl,www.adresscore.pl`)
  albo `localhost:5180`/`127.0.0.1:5180` poza produkcją (`NODE_ENV !== 'production'`
  i `VERCEL_ENV !== 'production'`); inaczej 403.
- Ciało: tekst (beacon wysyła `text/plain`) albo JSON, ≤ 16 384 bajtów (większe → 413).
- Kształt: `{ "z": Zdarzenie[] }`, 1..10 elementów (`MAX_PACZKA`).

```ts
// Pole wspólne
{ t: Typ, e: Ekran, s: string /* ścieżka bez query, ≤512 */, u: 'mobile'|'tablet'|'desktop'|'inne' }
// t = 'odslona'
+ { rh?: string /* host referera */, rs?: string /* ścieżka referera */,
    us?: string, um?: string, uc?: string /* utm_source|medium|campaign */, ci?: ClickId }
// t = 'wyjscie'
+ { ms: number, sc: number, sk?: [klucz: string, ms: number, poz: number][] /* ≤24 */,
    ct?: [klucz: string, ekspozycje: number, kliki: number][] /* ≤12 */ }
// t = 'klik'
+ { et: string /* 'sekcja§rodzaj§cel', rodzaj ∈ przycisk|link-wewn|link-zewn|zakladka|martwy|furia */ }
// t = 'udostepnienie'
+ { et: string, ku: 'link'|'kopia'|'natywne'|'anulowano'|'blad' }
// t = 'produktowe'
+ { n: NazwaProduktowa, w?: Record<string, string|number|boolean> /* ≤12 kluczy */ }
// t = 'wital'
+ { n: 'lcp'|'inp'|'cls'|'fcp'|'ttfb', v: number /* ≥0; ms, CLS ułamek ≤10 */ }
// t = 'blad'
+ { k: string /* komunikat ≤200 */ }
```

Zdarzenie niezgodne z kontraktem jest pomijane (reszta paczki przechodzi). Cała paczka
bez ani jednego poprawnego zdarzenia → 400.

## Przetwarzanie

1. `ua = headers['user-agent']`, `ip` jak w `api/jev.js#ip`.
2. `odcisk = sha256(sol + ip + ua + host).slice(0,16)`; sól z `rpc/analityka_sol_dzis`
   (cache na dzień w pamięci modułu; błąd → `odcisk = null`, zapis idzie dalej).
3. `rodzinaBota(ua)` → `czy_bot`, `bot_rodzina`, `bot_klasa`.
4. `kraj`: `cf-ipcountry` → `x-vercel-ip-country` → `null` (tylko `^[A-Z]{2}$`, bez `XX`, `T1`).
5. Dla `odslona`: `kanal = kanal({ rh, us, um, ci, wlasnyHost })`.
6. `fetch(POST {SUPABASE_URL}/rest/v1/rpc/zdarzenie_zapisz, { p_paczka: wiersze[] })`,
   nagłówki `apikey` i `Authorization: Bearer {SUPABASE_SERVICE_ROLE_KEY}`, timeout 2 s.

**IP i UA nie trafiają do wierszy, logów ani odpowiedzi** – test sprawdza, że żadna wartość
wejściowa IP/UA nie występuje w `JSON.stringify` wywołania RPC ani w odpowiedzi.

## Odpowiedź

| Sytuacja | Status |
|---|---|
| zapisano (także częściowo) | 204 |
| błąd bazy / brak zmiennych `SUPABASE_*` / timeout | 204 (analityka nie psuje nawigacji) |
| zły origin | 403 |
| złe ciało / zero poprawnych zdarzeń | 400 |
| za duże ciało | 413 |
| metoda ≠ POST | 405 |

Zawsze `Cache-Control: no-store`, bez ciała.

## Zmienne środowiskowe (serwerowe, nigdy `VITE_*`)

`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ADRESSCORE_HOSTY`. Na Vercelu – zmienne
projektu; na Coolify – zmienne usługi. W repo wyłącznie nazwy (quickstart).

## Przenośność

`handler(req, res, opcje)` korzysta tylko z `req.method`, `req.headers`, `req.body`
(opcjonalnie), strumienia `req`, `req.socket`, `res.statusCode`, `res.setHeader`, `res.end`
– wspólny podzbiór Vercel Node i `node:http`. Test `api/_zdarzenie.test.js` woła `handler`
na atrapach obu kształtów żądania (z `req.body` i ze strumieniem).
