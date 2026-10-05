# Panel admina i pomiar ruchu (`#/panel`) – architektura i działanie

Stan na 2026-10-05. Dokument opisuje, jak panel i własny pomiar ruchu są zbudowane i dlaczego tak.
Kod jest źródłem prawdy – ten plik ma pozwolić zrozumieć całość bez otwierania kilkudziesięciu
plików. Szczegółowe uzasadnienia stoją w komentarzach nagłówkowych wymienionych modułów, a
specyfikacja funkcji w `specs/001-panel-analityka/` (spec, plan, model danych, kontrakty).
Wzorcem był panel repozytorium z-dykty (`docs/panel-admina.md` tam), przeniesiony na stack
adresscore: SPA Vite bez serwera Next, hosting Vercel przechodzący na serwer własny (Hetzner, Coolify).

## 1. Czym to jest

Ekran `#/panel` pokazuje właścicielowi, **czy serwis żyje, skąd przychodzą ludzie, co robią po
wejściu i czy sam pomiar działa**. Dane zbiera własny, bezciasteczkowy pomiar (`src/pomiar/`),
zapisuje je endpoint `POST /api/zdarzenie`, a panel czyta je z bazy przez funkcje `admin_*`.

Trzy zasady, które porządkują wszystko poniżej:

1. **Autorytet trzyma baza, nie React.** Każda funkcja `admin_*` jest `security definer` i zaczyna się
   od `jest_adminem()`. Ekran, logowanie i cache to wygoda, nie granica bezpieczeństwa: kto zna
   klucz publiczny bazy i ominie ekran, trafi na tę samą bramkę w Postgresie (kod błędu `42501`).
2. **Nic z zewnątrz nie buduje zapytania.** Panel woła bazę zamkniętym rejestrem widoków
   (`src/panel/widoki.ts`): nazwa funkcji zawsze pochodzi z kodu, z użytkownika tylko liczby
   z ograniczonego zakresu.
3. **Pomiar nie zostawia identyfikatora.** Na urządzeniu nie ma ciasteczka ani wpisu w magazynie
   (jedyny zapis to świadomy wybór „pomiar wyłączony”), w bazie nie ma adresu IP ani przeglądarki,
   a skrót dobowy, który odróżnia odwiedzających, rotuje o północy.

Poza zakresem v1 (świadomie): zakładki Gminy, Czytelnicy, Redakcja i Reklamy z z-dykty, komentarze,
newsletter, PostHog, serwerowy cache panelu, drugi składnik logowania (2FA) i ekran zarządzania adminami.

## 2. Zakładki

| Zakładka | Pytanie, na które odpowiada | Widoki (RPC `admin_*`) |
|---|---|---|
| Przegląd | Czy serwis żyje? Unikalni, odsłony, szczyty, ludzie kontra boty, crawlery AI | `przeglad`, `seria_dzienna`, `seria_godzinowa`, `boty_ai` |
| Akwizycja | Skąd przychodzą wizyty? Kanały, źródła, kampanie UTM, kraje, urządzenia | `kanaly`, `zrodla`, `kampanie`, `kraje`, `urzadzenia` |
| Sesje | Co dzieje się w jednej wizycie? Strony na sesję, czas, przejścia, udostępnienia | `sesje_przeglad`, `przejscia`, `udostepnienia` |
| Zaangażowanie | Którędy ludzie chodzą i gdzie kończą? Ścieżki, czas w sekcjach, punkt urwania | `sciezki`, `sekcje`, `punkt_urwania` |
| CTA | Które przyciski działają, a które są martwe albo frustrują? | `cta_sekcje`, `cta_martwe`, `ux_sygnaly` |
| Treść | Co ludzie oglądają i czego nie znaleźli? Top ekrany i adresy, braki, lejek | `top_ekrany`, `top_adresy`, `bez_wyniku`, `lejek` |
| Jakość | Czy strona jest szybka, nie psuje się i czy sam pomiar działa? | `diagnostyka`, `witale`, `bledy` |

Każda zakładka ma jednozdaniowy wstęp („na jakie pytanie odpowiada i czego tu nie ma”,
`src/panel/zakladki.ts`), a każda liczba podpowiedź z definicją i pułapką interpretacji
(`src/panel/slownik.ts`). Brak danych jest szarym stanem „brak danych”, nigdy zerem.

## 3. Warstwy – od przeglądarki do ekranu

```
Przeglądarka odwiedzającego
  src/pomiar/Pomiar.tsx  (montowany w src/App.tsx; ekran panel NIE jest mierzony)
  zdarzenia: odsłona, wyjście, klik, udostępnienie, produktowe, wital, błąd
        │  paczki do 10 zdarzeń, sendBeacon (text/plain) albo fetch keepalive
        ▼
POST /api/zdarzenie            api/zdarzenie.js (adapter) + api/_zdarzenie.js (obsluz)
  origin → rozmiar → walidacja → odcisk dobowy, bot, kraj, kanał
        │  RPC kluczem service_role, timeout 2 s, awaria bazy = 204
        ▼
Postgres (Supabase)
  zdarzenie_zapisz()  → zdarzenia (surowe, 90 dni)
  analityka_cron()    → analityka_dzienna (zestawienie, bezterminowo) + analityka_biegi (ślad)
  admin_* (25 funkcji, jest_adminem())  ◄── sesja admina (logowanie Google)
        ▼
src/panel  (leniwy chunk, tylko na #/panel)
  dane.ts (rejestr widoków + cache TTL 5 min) → zakładki → składniki (Recharts)
```

### 3.1 Pomiar w kliencie (`src/pomiar/`)

- **Zgoda i sprzeciw** (`zgoda.ts`): `pomiarWylaczony()` to klucz `pomiar-wylaczony` w `localStorage`
  albo sygnał przeglądarki Global Privacy Control. Wszystkie dostępy do magazynu w `try/catch`.
  Przełącznik jest na stronie Metody (`src/strony/Metoda.tsx`); przy wyłączeniu zdarzenie
  `pomiar_wylaczony` wychodzi PRZED zapisem wyboru. Test strażnik (`prywatnosc.test.ts`) pilnuje,
  że magazyn przeglądarki dotyka wyłącznie `zgoda.ts`.
- **Rdzeń** (`rdzen.ts`, `pomiar.ts`, `kolejka.ts`, `transport.ts`): cykl odsłony, kolejka (bufor do 10,
  wysyłka po 5 s bezczynności, przy zapełnieniu, przy ukryciu karty i `pagehide`), `sendBeacon` z
  `Blob` `text/plain` (bez preflightu CORS) i `fetch` z `keepalive`. Błędy wysyłki są tłumione,
  bez ponawiania w pętli.
- **Wyjście dokładnie raz na odsłonę**: wysyłane przy pierwszym z trzech zdarzeń – zmiana odsłony,
  ukrycie karty, `pagehide`. Czas liczy się tylko przy widocznej karcie (limit 30 min). Po
  domknięciu odsłony dalszy czas nie jest raportowany, dlatego **czasy w panelu są podłogą**.
- **Obserwatory** ładowane leniwie (`obserwatory.ts`): sekcje (`[data-sekcja]`), CTA (`[data-cel]`,
  furia, martwy klik), Web Vitals (LCP, INP, CLS, FCP, TTFB – natywne `PerformanceObserver`) i błędy.
  Dzięki temu rdzeń w głównej paczce kosztuje ok. 5 KB gzip.
- **Oznaczanie ekranów**: `data-sekcja="<klucz>"` (wzorzec `^[a-z0-9_-]{1,48}$`) na blokach ekranu i
  `data-cel="<cel>"` na przyciskach, których kliknięcia mają liczyć się jako CTA. Nazwy sekcji dla
  panelu w `src/pomiar/sekcje-nazwy.ts`; test pilnuje zgodności z ekranami w obu kierunkach.
- **Ścieżka odsłony** (`sciezka.ts`): `location.pathname` poza `/`, inaczej część hasha przed `?`.
  Nigdy query ani fragment z parametrami. Z URL-a wychodzą wyłącznie `utm_source`, `utm_medium`,
  `utm_campaign` i NAZWA parametru identyfikatora kliknięcia (nigdy jego wartość).
- Import komponentu: `@/pomiar/Pomiar.tsx` z rozszerzeniem – na Windows i macOS `@/pomiar/Pomiar`
  myli się z plikiem `pomiar.ts`.

### 3.2 Endpoint (`api/zdarzenie.js`, `api/_zdarzenie*.js`, `api/_odcisk.js`, `api/_ruch.js`)

Przenośny między funkcją Vercela a serwerem Node na Coolify: `handler(req, res, { env, fetch })`
używa wyłącznie wspólnego podzbioru `req` i `res`. Na serwerze własnym wystarczy
`http.createServer((req, res) => handler(req, res))` pod ścieżką `/api/zdarzenie`; za proxy musi
dochodzić prawdziwy adres klienta w `x-forwarded-for`. W `pnpm dev` ten sam handler podpina plugin
w `vite.config.ts`.

Kolejność kroków w `obsluz()` (każdy może zakończyć żądanie): metoda (405) → origin z
`ADRESSCORE_HOSTY` (403; `localhost:5180` tylko poza produkcją) → rozmiar do 16 KB (413) →
parsowanie (400) → walidacja każdego zdarzenia wg zamkniętych list (niepoprawne pomijane, zero
poprawnych = 400) → odcisk, bot, kraj, kanał → RPC `zdarzenie_zapisz`. Po przejściu walidacji każda
awaria (baza, sieć, brak zmiennych `SUPABASE_*`) kończy się 204: analityka nie psuje nawigacji.

- **Odcisk dobowy**: `sha256(sól dnia + IP + User-Agent + host)`, pierwsze 16 znaków. Sól tworzy baza
  (`analityka_sol_dzis()`), rotuje o północy warszawskiej i jest kasowana po 2 dobach. Bez soli odcisk
  jest `null` (nie ma wartości zapasowej, bo byłaby trwałym identyfikatorem).
- **IP i User-Agent istnieją wyłącznie jako argumenty funkcji skrótu i klasyfikatora botów.** Nie
  trafiają do wierszy, logów ani odpowiedzi; test sprawdza to na wartościach-znacznikach.
- **Boty** (`rodzinaBota`): zapisywane z oznaczeniem rodziny i klasy (`ai`, `wyszukiwarka`, `podglad`,
  `narzedzie`, `monitoring`, `inny`), nie odrzucane; nie wchodzą do liczb o ludziach.
- **Kanał** (`kanal`): UTM i identyfikator kliknięcia przed refererem; wejście z własnego hosta to
  `wewnetrzne` (nie jest wejściem). **Kraj** z nagłówka `cf-ipcountry` albo `x-vercel-ip-country`.
- Stałe kontraktu (typy, nazwy produktowe, limity) w `api/_zdarzenie-kontrakt.js`; klient ma kopię
  w `src/pomiar/kontrakt.ts`, a parytet pilnuje `api/_zdarzenie-kontrakt.test.js`.

### 3.3 Baza (`supabase/migrations/`, trzy pliki z `wt.ps1 migracja`)

| Migracja | Zawartość |
|---|---|
| `analityka_fundament` | `admini`, `jest_adminem()`, `zdarzenia` + trigger normalizujący + RLS, `analityka_sol`, `analityka_dzienna`, `analityka_biegi`, `zdarzenie_zapisz()` (limit 1500/h na odcisk), `analityka_sesje()` |
| `analityka_panel` | 25 funkcji `admin_*` (+ warstwa wewnętrzna `analityka_panel_*` z jawnym parametrem czasu) |
| `analityka_zestaw` | `analityka_zestaw_dzien()`, `analityka_sprzataj()`, `analityka_cron()`, zadanie pg_cron `analityka-dzienna` |

- **Bramka**: tabela `admini` ma RLS i zero polityk (czyta ją tylko `jest_adminem()` i `service_role`).
  Tabela `zdarzenia` jest dostępna do odczytu wyłącznie dla admina (polityka + jawny `revoke`), do zapisu
  dla nikogo poza `zdarzenie_zapisz()` (tylko `service_role`). Test pgTAP `analityka_bramka.test.sql`
  sprawdza KAŻDĄ funkcję `public.admin_%` (security definer, bramka w treści, brak EXECUTE dla `anon`)
  i wypisuje, ile ich sprawdził.
- **Doby** liczone w `Europe/Warsaw`, także przy zmianie czasu (doba 23- i 25-godzinna). Okno „N dni”
  to ostatnie N dób warszawskich razem z dzisiejszą.
- **Sesja** nie jest przechowywana: ciąg odsłon jednego odcisku z przerwą do 30 minut. Sesja
  zaangażowana = co najmniej 2 odsłony albo 30 s widoczności. Ponieważ odcisk rotuje o północy,
  sesje nie przekraczają północy.
- **Zestawienie dzienne** (`analityka_dzienna`): `analityka_cron()` o 01:20 UTC (po północy
  warszawskiej w obu porach roku) zapisuje wczoraj i przedwczoraj (poprawka spóźnionych beaconów)
  i sprząta: surowe zdarzenia po 90 dniach, sól po 2 dobach. Zestawienia zostają. Ślad każdego kroku
  w `analityka_biegi`; panel Jakość świeci na czerwono, gdy bieg jest starszy niż 26 h albo zakończył
  się błędem. Ręczne przeliczenie doby: `select public.analityka_zestaw_dzien(date '2026-10-05');`
  (z SQL Editora, jako właściciel).
- **Limit czasu**: klauzula `set statement_timeout` na funkcji NIE przedłuża limitu roli, bo licznik
  startuje przy wejściu zapytania. Na Supabase Cloud realnym sufitem jest limit roli `authenticated`
  (domyślnie 8 s). Zmierzone lokalnie przy ok. 18 tys. odsłon na dobę: okno 7 dób poniżej 2 s,
  okno 30 dób poniżej 8 s (najcięższe: punkt urwania, przegląd sesji). Gdy ruch urośnie, skracaj okno
  albo podnieś limit roli osobną decyzją (`alter role authenticated set statement_timeout`).

### 3.4 Panel (`src/panel/`)

- **Ładowanie**: jedyna furtka z głównego kodu to `ladujPanel` w `src/karta/ladowanieEkranow.ts`
  (`import('@/panel/EkranPanel')`). Recharts, klient Supabase i cały panel są w leniwych chunkach, które
  odwiedzający serwis nigdy nie pobierają. Panel renderuje się w `Aplikacja` poza powłoką (bez
  pobierania adresów).
- **Logowanie** (`auth.ts`, `Logowanie.tsx`, `src/lib/supabase.ts`): Google OAuth w trybie PKCE.
  Domyślny przepływ „implicit” oddaje tokeny w hashu adresu i kolidowałby z routerem na hashu; PKCE oddaje
  krótkotrwały `?code=` w query. Adres powrotu to `/?panel#/panel`; parametr `panel` w query wymusza
  ekran panelu nawet gdy dostawca utnie fragment (`czytajHash(hash, search)` w `src/wynik/url.ts`).
  Synchronizacja URL w `stan.ts` nie dotyka adresu na ekranie panelu, żeby nie skasować kodu przed
  wymianą na sesję.
- **Stany ekranu**: bez konfiguracji bazy komunikat; bez sesji tylko przycisk „Zaloguj przez Google”;
  sesja bez uprawnień (błąd `42501`) – „Brak dostępu” i wylogowanie; admin – zakładki. Odmowa zapada w
  bazie, ekran ją tylko pokazuje.
- **Dane** (`dane.ts`, `widoki.ts`, `magazyn.ts`): rejestr widoków z typami odpowiedzi (`typy.ts`),
  cache w pamięci na czas wizyty (TTL 5 min), przycisk „Odśwież” unieważnia wszystko, znacznik „Dane z
  godz.” pokazuje najstarszy wynik na ekranie. Dane z bazy traktowane są jak niezaufane (frazy,
  ścieżki, komunikaty pochodzą od dowolnego klienta): tylko jako treść React, link wyłącznie przez
  `linkDoSerwisu`.
- **Arytmetyka prezentacji** (`arytmetyka.ts`, czysta, z testem inwariantów): udziały liczone od SUMY
  całości metodą największej reszty (segmenty dają dokładnie 100,0), `procentOd` zwraca `null` przy
  całości ≤ 0, zmiana procentowa tylko przy dodatnim odniesieniu, oceny Web Vitals wg progów Google.
- **Wykresy**: Recharts, po najechaniu i dotknięciu dokładna wartość i data; pod wykresem „Pokaż dane
  w tabeli”. Kolor palety danych tylko na wypełnieniu, etykieta tekstowa obok.

## 4. Prywatność – co jest gwarantowane i czym

| Gwarancja | Mechanizm | Test |
|---|---|---|
| Zero identyfikatorów w magazynach przeglądarki | pomiar używa tylko klucza `pomiar-wylaczony` (przy wyłączeniu) | `src/pomiar/prywatnosc.test.ts` |
| IP i User-Agent nie trafiają do bazy, logów ani odpowiedzi | tylko argumenty skrótu i klasyfikatora botów | `api/_zdarzenie.test.js` |
| Brak kolumn z IP lub pełną przeglądarką | schemat `zdarzenia` | `supabase/tests` + przegląd schematu |
| Wizyt z różnych dób nie da się połączyć | sól dnia rotuje o północy, kasowana po 2 dobach | `analityka_zestaw.test.sql` (retencja) |
| Fraza z danymi osobowymi nie jest zapisywana | filtr e-mail, `@`, 9+ cyfr w kliencie i na serwerze, znacznik `[odrzucono]` | testy frazy (klient i endpoint, test parytetu) |
| Prawo sprzeciwu | przełącznik na stronie Metody, GPC | `src/strony/przelacznikPomiaru.test.ts` |

Treść informacji o pomiarze na stronie Metody jest treścią publiczną i wymaga akceptacji właściciela
przed wdrożeniem.

## 5. Jak dołożyć nowy widok

1. Funkcja SQL `admin_<nazwa>` w NOWEJ migracji (`powershell -File ~/.claude/bin/wt.ps1 migracja <nazwa>`):
   `security definer`, `set search_path = ''`, bramka `if not public.jest_adminem() then raise exception
   'brak dostępu' using errcode = '42501'` jako pierwsza instrukcja, `revoke all … from public, anon`,
   `grant execute … to authenticated`. Test bramki wykryje brak któregokolwiek z tych elementów.
2. Typ odpowiedzi w `src/panel/typy.ts` i wpis w rejestrze `src/panel/widoki.ts` (nazwa widoku → nazwa
   RPC + domyślne parametry).
3. Hasło w `src/panel/slownik.ts` (co liczy, okno, pułapka) dla każdej nowej liczby.
4. Komponent w zakładce (`src/panel/zakladki/`): dane przez `useWidok`, liczby i udziały przez
   `arytmetyka.ts`, układ ze składników z `src/panel/skladniki/`. Logikę wyprowadzania danych wynieś do
   czystego pliku `*-dane.ts` z testem.
5. Nowe zdarzenie pomiaru: stałe w `api/_zdarzenie-kontrakt.js` i `src/pomiar/kontrakt.ts` (parytet
   pilnuje test), walidacja w `api/_zdarzenie.js`, wywołanie w kliencie.

## 6. Dopisanie admina (v1 bez ekranu zarządzania)

Po pierwszym zalogowaniu kontem Google (konto pojawia się w `auth.users`), w SQL Editorze Supabase:

```sql
insert into public.admini (user_id)
select id from auth.users where email = '<e-mail właściciela>';
```

Usunięcie wpisu odbiera dostęp przy następnym zapytaniu.

## 7. Konfiguracja i wdrożenie (kroki właściciela – nieodwracalne)

- Zmienne serwerowe (Vercel i Coolify): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
  `ADRESSCORE_HOSTY` (np. `adresscore.pl,www.adresscore.pl`). Nigdy z prefiksem `VITE_`. Front używa
  `VITE_SUPABASE_URL` i `VITE_SUPABASE_ANON_KEY`.
- Supabase: Authentication → Providers → Google (Client ID i Secret); Redirect URLs
  `https://adresscore.pl/**` i `http://localhost:5180/**`; w Google Cloud Console adres zwrotny
  `https://<projekt>.supabase.co/auth/v1/callback`.
- Baza: `pnpm db:push` wyłącznie z katalogu integracyjnego i z `main` (trzy migracje, rozszerzenie
  `pg_cron` włącza się w migracji; na Supabase Cloud sprawdź, że rozszerzenie jest dostępne w projekcie).
- Po dobie: `select * from analityka_biegi order by id desc limit 3;` – bieg `zestaw` bez `blad`.

## 8. Testy i weryfikacja

`node --test <katalog>` nie działa na Node 24 (traktuje argument jak plik) – używaj globów w cudzysłowie:

```bash
node --test "api/**/*.test.js" "src/pomiar/*.test.ts" "src/panel/**/*.test.ts" "src/wynik/*.test.ts"
pnpm exec supabase test db     # pgTAP: bramka, sesje, panel, zestawienie
pnpm verify                    # Biome + tsc + build
```

Lokalna baza: `pnpm db:start` używa portów 54321–54327; gdy zajmuje je inny projekt, uruchom odizolowany
stos z kopią `supabase/config.toml` o przesuniętych portach i innym `project_id` (opcja `--workdir`).

## 9. Znane ograniczenia

- Czasy wizyt i sekcji są podłogą (wyjście raz, sesje przecinane o północy).
- Web Vitals przypisane do ekranu wejścia wizyty, INP uproszczone (najdłuższa interakcja).
- Odcisk to przybliżenie osób: wspólny IP i przeglądarka (biuro) zlewają się, a kolejnej doby ta sama
  osoba liczy się od nowa. „Unikalni (7 dób)” to suma dobowych, nie liczba osób.
- Rozmiar okien: patrz limit czasu w 3.3.
- Logowanie Google zweryfikowano na atrapie serwera i na lokalnym GoTrue (sesja hasłowa); prawdziwy przepływ
  OAuth z Google wymaga konfiguracji z punktu 7.

## 10. Pliki kluczowe

| Plik | Rola |
|---|---|
| `src/pomiar/pomiar.ts`, `rdzen.ts`, `kolejka.ts`, `zgoda.ts`, `Pomiar.tsx` | pomiar w kliencie |
| `src/pomiar/kontrakt.ts` ↔ `api/_zdarzenie-kontrakt.js` | wspólne stałe zdarzeń (parytet testem) |
| `api/zdarzenie.js`, `api/_zdarzenie.js`, `api/_odcisk.js`, `api/_ruch.js` | endpoint, odcisk, boty, kanały |
| `supabase/migrations/*_analityka_*.sql` | schemat, bramka, RPC, zestawienie, harmonogram |
| `supabase/tests/analityka_*.test.sql` | pgTAP: bramka, sesje, panel, zestawienie |
| `src/panel/EkranPanel.tsx`, `auth.ts`, `dane.ts`, `widoki.ts`, `typy.ts` | ekran, logowanie, dane |
| `src/panel/arytmetyka.ts`, `slownik.ts`, `nazwy.ts`, `czas.ts` | liczby, definicje, nazwy, doby |
| `src/panel/skladniki/`, `src/panel/zakladki/` | składniki i siedem zakładek |
| `vite.config.ts` | plugin dev: `/api/zdarzenie` w `pnpm dev` |
