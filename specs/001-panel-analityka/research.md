# Research: Panel admina z analityką

Każda pozycja: **Decyzja** – **Dlaczego** – **Odrzucone**. Wzorzec: repo z-dykty (tylko odczyt),
`docs/panel-admina.md` i moduły pomiaru. Różnice wobec z-dykty wynikają z innego stacku
(SPA Vite bez routera i bez serwera Next) i z przeprowadzki z Vercela na Hetzner/Coolify.

## R1. Endpoint zapisu przenośny między Vercelem a Node na Coolify

- **Decyzja**: `api/zdarzenie.js` w stylu `api/jev.js`: `export default async function
  handler(req, res, { env = process.env, fetch } = {})` – czyta ciało (string, obiekt albo
  strumień), woła czystą funkcję `obsluz({ metoda, cialo, naglowki, env, rpc })` z
  `api/_zdarzenie.js` i zapisuje status. Zapis do bazy przez `fetch` na
  `POST {SUPABASE_URL}/rest/v1/rpc/zdarzenie_zapisz` z nagłówkami `apikey` i `Authorization:
  Bearer {SUPABASE_SERVICE_ROLE_KEY}` – bez `@supabase/supabase-js` po stronie serwera.
- **Dlaczego**: podpis `(req, res)` jest wspólny dla funkcji Node na Vercelu i dla zwykłego
  `http.createServer` na Coolify; `fetch` wstrzykiwany pozwala testować bez sieci
  (`node --test api/`), tak samo jak `_jev.test.js`. Brak SDK = brak nowej zależności
  i zimny start bez kosztu.
- **Odrzucone**: Edge Function Supabase (trzecie miejsce wdrożeń, inny runtime, inny log);
  zapis wprost z przeglądarki kluczem anon (nie zna IP – nie da się policzyć unikalnych bez
  identyfikatora na urządzeniu; z-dykty odszedł od tego w 0074); route Next (nie mamy Nexta).

## R2. Odcisk dobowy bez ciasteczek

- **Decyzja**: `sha256(sol_dnia + ip + ua + host)` → pierwsze 16 znaków hex, liczone
  w `api/_odcisk.js` (`node:crypto`). Sól dnia (Europe/Warsaw) czytana z tabeli
  `analityka_sol` przez RPC `analityka_sol_dzis()` (service_role; tworzy sól, gdy brak),
  cache'owana w pamięci modułu jako obietnica na dzień. IP: pierwszy z `x-forwarded-for`,
  potem `x-real-ip`, potem `socket.remoteAddress`. IP i UA istnieją wyłącznie jako argumenty
  funkcji skrótu – zero `console.*` z ich udziałem.
- **Dlaczego**: model Plausible/Fathom użyty w z-dykty; dobowa rotacja = brak łączenia wizyt
  między dniami, więc pomiar mieści się w zwolnieniu z obowiązku zgody (statystyki własne).
- **Odrzucone**: sól w zmiennej środowiskowej (nie rotuje); identyfikator w `localStorage`
  (wymaga zgody); odcisk po stronie klienta (fingerprinting przeglądarki – gorzej prawnie).

## R3. Kraj

- **Decyzja**: `cf-ipcountry` (Cloudflare przed Coolify), potem `x-vercel-ip-country`;
  inaczej `null`. Wartość akceptowana tylko jako `^[A-Z]{2}$`, `XX`/`T1` → `null`.
- **Dlaczego**: decyzja właściciela; bez bazy GeoIP na serwerze.
- **Odrzucone**: MaxMind GeoLite na Coolify (licencja + aktualizacje + plik w obrazie).

## R4. Boty i crawlery AI

- **Decyzja**: `api/_ruch.js` eksportuje `rodzinaBota(ua)` → `null | 'ai' | 'wyszukiwarka' |
  'podglad' | 'narzedzie' | 'monitoring' | 'inny'` oraz nazwę rodziny (`gptbot`, `claudebot`,
  `perplexitybot`, `googlebot`, `bingbot`, `facebookexternalhit`, `curl`…). Wzorzec listy
  z `origin-api.ts#czyBotUa` z-dykty, rozbity na rodziny. Pusty UA = bot `narzedzie`.
  Ruch botów zapisujemy (z oznaczeniem), nie odrzucamy – Przegląd pokazuje ludzie vs boty
  i tabelę crawlerów AI.
- **Dlaczego**: crawlery AI to sygnał widoczności w odpowiedziach modeli; z-dykty mierzy to
  od `boty_ai_pomiar`. Odrzucanie zostawiłoby tylko szacunek.
- **Odrzucone**: osobna tabela botów (dwa miejsca zapisu, dwie retencje).

## R5. Kanał wejścia

- **Decyzja**: klasyfikacja wyłącznie na serwerze (`api/_ruch.js#kanal`), na podstawie:
  znaczników UTM (`utm_medium` cpc/paid → `kampania`, `utm_source` social → `social`),
  rodzaju click-id (`fbclid` → social, `gclid`/`msclkid` → `kampania`), hosta referera
  (lista hostów wyszukiwarek, social, AI: chatgpt.com, perplexity.ai, claude.ai, gemini…),
  braku referera → `bezposrednie`, referer z własnego hosta → wejście wewnętrzne (nie liczy
  się jako wejście). Kanały: `bezposrednie | wyszukiwarka | social | ai | kampania |
  odeslanie | wewnetrzne`. Klient tylko przycina: host referera, ścieżka referera tylko dla
  hostów publicznych, bez query; z URL-a strony wyłącznie `utm_source|medium|campaign`
  (do 60 znaków) i NAZWA parametru click-id, nigdy jego wartość.
- **Dlaczego**: endpoint jest publiczny, więc klient nie jest dowodem; jedno źródło
  klasyfikacji = zmiana listy hostów bez deployu klienta. Przycięcie u klienta = do sieci
  nie wychodzi nic, czego nie wolno zapisać.
- **Odrzucone**: klasyfikacja w SQL (lista hostów w bazie – zmiana wymaga migracji).

## R6. Kontrakt zdarzeń dzielony między klientem (TS) a endpointem (JS)

- **Decyzja**: źródłem prawdy po stronie serwera jest `api/_zdarzenie-kontrakt.js` (stałe:
  typy, nazwy produktowe, metryki witali, limity). Klient ma `src/pomiar/kontrakt.ts` z tymi
  samymi stałymi `as const` (typy TS potrzebne kompilatorowi). Parytet pilnuje test
  `api/_zdarzenie-kontrakt.test.js`, który IMPORTUJE oba pliki (Node 24 zdejmuje typy z `.ts`)
  i porównuje zbiory.
- **Dlaczego**: `tsconfig` obejmuje tylko `src` bez `allowJs`; import `.ts` w funkcji
  hostingu to ryzyko builda na Vercelu. Test importujący oba = brak cichego rozjazdu kopii.
- **Odrzucone**: kontrakt w `src/kontrakty` (tor integracji – zablokowałby fazy równoległe
  do końca); `allowJs` w tsconfig (plik integracji, zmiana dla całego repo).

## R7. Sesje, ścieżki, punkt urwania – w SQL

- **Decyzja**: sesje sklejane w zapytaniu: okno `lag(czas) over (partition by odcisk order
  by czas)`, nowa sesja przy luce > 30 min; zdarzenia botów wykluczone. Funkcje
  `admin_sesje(p_dni)`, `admin_przejscia(p_dni)`, `admin_sciezki(p_dni)`,
  `admin_punkt_urwania(p_dni)` liczą na surowej tabeli w oknie do 30 dni. Brak
  identyfikatora sesji w kliencie i w tabeli.
- **Dlaczego**: wzorzec `20260731162138_analityka_sesje` z-dykty; identyfikator sesji
  w kliencie wymagałby `sessionStorage` (identyfikator na urządzeniu).
- **Odrzucone**: materializacja sesji w rollupie (v1 – ruch hackathonowy, zapytanie na
  żywo wystarcza; rollup trzyma tylko liczbę sesji na dzień).

## R8. Zestawienie dzienne i retencja – pg_cron

- **Decyzja**: `analityka_zestaw_dzien(p_dzien date)` (idempotentne: `delete` dnia +
  `insert`), `analityka_sprzataj()` (zdarzenia > 90 dni, sól > 2 dni). Harmonogram:
  `cron.schedule('analityka-dzienna', '20 1 * * *', ...)` – 01:20 UTC = po północy
  warszawskiej w obu porach roku. Wynik biegu w `analityka_biegi` (dla Jakości).
- **Dlaczego**: decyzja właściciela – odchodzimy z Vercela, więc cron Vercela odpada;
  pg_cron działa w Supabase Cloud niezależnie od hostingu aplikacji.
- **Odrzucone**: cron Coolify (druga konfiguracja na serwerze, nie przenosi się z bazą);
  GitHub Actions (sekret service_role w CI bez potrzeby).

## R9. Logowanie Google w SPA z routerem na hashu

- **Decyzja**: `supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo:
  `${origin}/?panel#/panel` } })` z klientem w trybie `flowType: 'pkce'`
  (`src/lib/supabase.ts`, dziś nieużywany nigdzie indziej). PKCE oddaje `?code=` w query,
  nie tokeny w hashu, więc router na hashu nie gubi stanu. `src/wynik/url.ts` traktuje
  obecność parametru `panel` w query jako ekran `panel` niezależnie od hasha (bezpiecznik
  na wypadek, gdy dostawca utnie fragment). Po wymianie kodu panel czyści query
  `history.replaceState(…, '/#/panel')`.
- **Dlaczego**: domyślny tryb implicit zapisuje `#access_token=…` w hashu – kolizja z routerem
  (`#/okolica/...`). PKCE jest zalecany dla SPA.
- **Odrzucone**: osobna ścieżka `/panel` (wymaga rewrite w `vercel.json` i w Coolify – dwa
  pliki infrastruktury), logowanie hasłem (decyzja właściciela: Google).
- **Do weryfikacji w implementacji** (zadanie w fazie UI): kształt adresu powrotu na
  lokalnym Supabase z dostawcą Google; jeśli `?code` ląduje za hashem, bezpiecznik w `url.ts`
  i tak otwiera panel.

## R10. Bramka admina w bazie

- **Decyzja**: tabela `admini(user_id uuid pk references auth.users, dodano timestamptz)`
  z RLS włączonym i BEZ polityk (czyta tylko `security definer` i service_role).
  `jest_adminem()` `security definer stable set search_path = ''` → `exists(select 1 from
  public.admini where user_id = auth.uid())`. Każda `admin_*` zaczyna od `if not
  public.jest_adminem() then raise exception 'brak dostępu' using errcode = '42501'`.
  `revoke all on function … from public, anon` + `grant execute … to authenticated`.
  `zdarzenia`: RLS on, jedna polityka `select using (public.jest_adminem())`, brak
  insert/update/delete dla anon/authenticated; zapis tylko `zdarzenie_zapisz` z grantem
  dla `service_role`.
- **Dlaczego**: zasada z-dykty „autorytet trzyma baza, nie React"; jedna funkcja-bramka =
  dołożenie 2FA w przyszłości domyka cały panel jedną zmianą.
- **Odrzucone**: claim w JWT (`app_metadata.rola`) – wymaga service_role do nadania i nie
  odwołuje się natychmiast.

## R11. Web Vitals bez nowej zależności

- **Decyzja**: `src/pomiar/witale.ts` na `PerformanceObserver` (`largest-contentful-paint`,
  `layout-shift` z oknami sesji CLS, `paint` dla FCP, `navigation` dla TTFB, `event`
  z `interactionId` dla INP = najdłuższa interakcja), `buffered: true`; wysyłka raz na
  metrykę przy ukryciu strony. Pojedyncze pomiary, p75 liczy baza (`percentile_cont(0.75)`).
  Progi oceny (dobra / do poprawy / słaba) wg Google: LCP 2500/4000 ms, INP 200/500,
  CLS 0,1/0,25, FCP 1800/3000, TTFB 800/1800 – w czystej funkcji `ocenaWitalu` z testem.
- **Dlaczego**: `web-vitals` to nowa zależność (plik integracji `package.json`); obserwatory
  są natywne we wszystkich silnikach, które mierzymy. INP jako najdłuższa interakcja
  zawyża p98-owe INP biblioteki o niewiele przy krótkich wizytach – akceptowalne dla v1.
- **Odrzucone**: biblioteka `web-vitals` (zależność + plik integracji w fazie równoległej).

## R12. Wykresy – Recharts w leniwym chunku

- **Decyzja**: `recharts` jako zależność, importowany wyłącznie z `src/panel/**`; panel
  ładowany przez `ladujPanel = () => import('@/panel/EkranPanel')` w
  `src/karta/ladowanieEkranow.ts`. Kontrola: `pnpm build` + sprawdzenie, że nazwa
  `recharts` nie występuje w chunku wejściowym (skrypt w quickstart).
- **Dlaczego**: wzorzec z-dykty (Wykres*.tsx na Recharts); hover z wartością i datą
  wbudowany (`Tooltip`).
- **Uwaga o kolejności**: `package.json` to plik integracji. Dodanie `recharts` jest
  jedynym wyjątkiem od zasady „pliki integracji na końcu" – bez niego faza UI nie przejdzie
  `tsc`. Zadanie T001 robi to na starcie; integrator przegląda zmianę w fazie końcowej
  razem z resztą plików integracji.
- **Odrzucone**: własne wykresy SVG (czwarty własny prymityw – anty-wzorzec z CLAUDE.md).

## R13. Arytmetyka prezentacji

- **Decyzja**: `src/panel/arytmetyka.ts` – czyste funkcje: `udzialy(wiersze)` (podstawa =
  suma, zaokrąglenie metodą największej reszty, żeby segmenty dawały dokładnie 100,0),
  `procentOd(czesc, calosc)` (`null` przy całości 0), `lejek(kroki)` (procent od pierwszego
  kroku i od poprzedniego), `zmianaProcentowa(teraz, wtedy)` (tylko przy dodatnim
  odniesieniu), `ocenaWitalu`, `formatLiczby`, `formatCzasu`. Testy `node --test` z
  inwariantem „suma udziałów = 100".
- **Dlaczego**: reguła z CLAUDE.md – logika prezentacji w komponencie jest nietestowalna;
  „100% to całość, nie największa pozycja" (dwa wcześniejsze wpadki w portfelu).

## R14. Odczyt panelu – bez cache serwerowego

- **Decyzja**: komponenty panelu wołają `supabase.rpc('admin_…', params)` przez rejestr
  `src/panel/dane.ts` (zamknięta mapa: widok → nazwa RPC + parametry), z prostym cache'em
  w pamięci na czas wizyty (Map, TTL 5 min) i przyciskiem „odśwież". Zakładki ładują dane
  leniwie (tylko aktywna).
- **Dlaczego**: z-dykty dołożył Runtime Cache i IndexedDB przy ~61 zapytaniach na wejście
  i kilku adminach; tu jeden admin i ruch hackathonowy. Rejestr zachowuje zasadę „nazwa RPC
  zawsze z kodu".
- **Odrzucone**: TanStack Query (nowa zależność), proxy przez `api/` (drugi endpoint
  z service_role bez potrzeby – sesja admina wystarcza).

## R15. Opt-out i GPC

- **Decyzja**: `src/pomiar/zgoda.ts`: `pomiarWylaczony()` = `localStorage['pomiar-wylaczony']
  === '1'` albo `navigator.globalPrivacyControl === true`; każdy dostęp w try/catch (tryb
  prywatny). Przełącznik na stronie Metody (`src/strony/Metoda.tsx`, sekcja „Pomiar ruchu").
- **Dlaczego**: art. 21 RODO – prawo sprzeciwu przy prawnie uzasadnionym interesie; wybór
  „wyłączone" nie jest identyfikatorem.
- **Treść publiczna**: tekst sekcji „Pomiar ruchu" na stronie Metody wymaga akceptacji
  właściciela przed wdrożeniem (punkt decyzyjny przy merge'u, nie blokuje implementacji).

## R16. Zdarzenia produktowe adresscore

- **Decyzja**: zamknięta lista nazw: `wyszukanie` (wł.: `wynikow` – liczba, `rodzaj` –
  adres/ulica/okolica), `wyszukanie_bez_wyniku` (wł.: `fraza` – znormalizowana, ≤ 80 znaków,
  odrzucana przy wzorcu e-maila/telefonu/PESEL), `karta_adresu`, `porownanie_dodaj`,
  `warstwa_mapy` (wł.: `warstwa` – id z zamkniętej listy wskaźników), `tryb_biznes`,
  `tryb_miasto`, `udostepnij`, `pomiar_wylaczony`. Karta, porównanie, warstwa i tryby
  wyprowadzane z przejść stanu (`subskrybuj` z `src/wynik/stan.ts`) w `src/pomiar/Pomiar.tsx`,
  bez wpinania w ekrany; jedynie wyszukiwarka wymaga wywołania w `Wyszukiwarka.tsx`
  (zna frazę i liczbę wyników).
- **Dlaczego**: minimum zmian w cudzych torach (karta/mapa); lejek liczony na sesjach w SQL.
