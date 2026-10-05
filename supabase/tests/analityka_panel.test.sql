-- Test pgTAP: funkcje odczytowe panelu (specs/001-panel-analityka, zadania T047 i T048).
--
-- Co sprawdza:
--   A. strukturę: dokładnie 25 funkcji admin_*, klauzule bezpieczeństwa, brak EXECUTE dla ról
--      klienckich na funkcjach wewnętrznych (analityka_panel_*, helpery okna),
--   B. SWIAT T (przeglad, serie, boty, granice okien, doba zmiany czasu 2026-10-25): liczby na znanym
--      zestawie zdarzen z trzech dob 24-26.10.2026 plus tla (19-23.10 i 26-27.09),
--   C. SWIAT S (akwizycja, sesje, zaangazowanie, CTA, tresc, lejek 10 → 6 → 2, witale, bledy):
--      18 sesji z jednego dnia (15.09.2026),
--   D. SWIAT C (martwe CTA: >= 50 wyswietlen i 0 klikniec) i SWIAT D (diagnostyka),
--   E. rownowaznosc admin_*(…) z analityka_panel_*(now(), …): kolejnosc parametrow i brak zgubionego czasu,
--   F. BRAMKE dla KAZDEJ z 25 funkcji: anon i zalogowany nie-admin dostaja 42501, admin dostaje wynik.
--
-- ZASADA TESTU: oczekiwane wartosci sa policzone RECZNIE z opisu zestawu (komentarze przy danych), a nie
-- wynikiem testowanej funkcji. Funkcje wewnetrzne przyjmuja jawny czas (p_teraz), wiec doby, zmiana
-- czasu i granice okien da sie sprawdzic na ustalonym zegarze; publiczne admin_* wolaja je z now().
--
-- Trigger zdarzenia_przed_insert nadpisuje czas na now(), wiec dane wstawiamy przy WYLACZONYM triggerze
-- (czas wprost), tak jak w analityka_sesje.test.sql. Test chodzi jako postgres w jednej transakcji
-- konczonej ROLLBACK – nic nie zostaje w bazie.

begin;

create extension if not exists pgtap with schema extensions;

select plan(234);


-- ===================================================================
-- Pomocnicze (pg_temp, znikaja z transakcja)
-- ===================================================================

-- Odsłona (typ odslona). Domyslnie kolejna odsłona w sesji: kanal wewnetrzny, desktop, PL.
create function pg_temp.pv(
  p_czas timestamptz, p_odcisk text, p_ekran text, p_sciezka text,
  p_kanal text default 'wewnetrzne', p_urz text default 'desktop', p_kraj text default 'PL',
  p_rh text default null, p_rs text default null,
  p_us text default null, p_um text default null, p_uc text default null, p_ci text default null,
  p_bot boolean default false, p_rodzina text default null, p_klasa text default null)
returns void language sql as $f$
  insert into public.zdarzenia
    (czas, typ, ekran, sciezka, odcisk, kraj, urzadzenie, czy_bot, bot_rodzina, bot_klasa,
     kanal, referer_host, referer_sciezka, utm_source, utm_medium, utm_campaign, click_id)
  values
    (p_czas, 'odslona', p_ekran, p_sciezka, p_odcisk, p_kraj, p_urz, p_bot, p_rodzina, p_klasa,
     p_kanal, p_rh, p_rs, p_us, p_um, p_uc, p_ci)
$f$;

-- Odsłona z swiata T: ekran szukaj, kanal bezposrednie, desktop, PL.
create function pg_temp.pvt(p_czas timestamptz, p_odcisk text)
returns void language sql as $f$
  select pg_temp.pv(p_czas, p_odcisk, 'szukaj', '/', 'bezposrednie', 'desktop', 'PL')
$f$;

-- Wyjscie z czasem widocznym, przewinieciem, sekcjami i CTA.
create function pg_temp.ex(
  p_czas timestamptz, p_odcisk text, p_ekran text, p_sciezka text, p_ms integer,
  p_sc smallint default null, p_sekcje jsonb default null, p_cta jsonb default null,
  p_bot boolean default false)
returns void language sql as $f$
  insert into public.zdarzenia
    (czas, typ, ekran, sciezka, odcisk, urzadzenie, czy_bot, czas_ms, scroll_pc, sekcje, cta)
  values
    (p_czas, 'wyjscie', p_ekran, p_sciezka, p_odcisk, 'desktop', p_bot, p_ms, p_sc, p_sekcje, p_cta)
$f$;

create function pg_temp.klik(p_czas timestamptz, p_odcisk text, p_ekran text, p_etykieta text,
                             p_bot boolean default false)
returns void language sql as $f$
  insert into public.zdarzenia (czas, typ, ekran, sciezka, odcisk, urzadzenie, czy_bot, etykieta)
  values (p_czas, 'klik', p_ekran, '/', p_odcisk, 'desktop', p_bot, p_etykieta)
$f$;

create function pg_temp.prod(p_czas timestamptz, p_odcisk text, p_nazwa text, p_wl jsonb default null,
                             p_ekran text default 'szukaj', p_bot boolean default false)
returns void language sql as $f$
  insert into public.zdarzenia (czas, typ, ekran, sciezka, odcisk, urzadzenie, czy_bot, nazwa, wlasciwosci)
  values (p_czas, 'produktowe', p_ekran, '/', p_odcisk, 'desktop', p_bot, p_nazwa, p_wl)
$f$;

create function pg_temp.wital(p_czas timestamptz, p_odcisk text, p_ekran text, p_metryka text,
                              p_wartosc numeric, p_bot boolean default false)
returns void language sql as $f$
  insert into public.zdarzenia (czas, typ, ekran, sciezka, odcisk, urzadzenie, czy_bot, nazwa, wartosc)
  values (p_czas, 'wital', p_ekran, '/', p_odcisk, 'desktop', p_bot, p_metryka, p_wartosc)
$f$;

create function pg_temp.blad(p_czas timestamptz, p_odcisk text, p_ekran text, p_komunikat text,
                             p_bot boolean default false)
returns void language sql as $f$
  insert into public.zdarzenia (czas, typ, ekran, sciezka, odcisk, urzadzenie, czy_bot, komunikat)
  values (p_czas, 'blad', p_ekran, '/', p_odcisk, 'desktop', p_bot, p_komunikat)
$f$;

create function pg_temp.udo(p_czas timestamptz, p_odcisk text, p_ekran text, p_etykieta text,
                            p_kanal text, p_bot boolean default false)
returns void language sql as $f$
  insert into public.zdarzenia
    (czas, typ, ekran, sciezka, odcisk, urzadzenie, czy_bot, etykieta, kanal_udostepnienia)
  values (p_czas, 'udostepnienie', p_ekran, '/', p_odcisk, 'desktop', p_bot, p_etykieta, p_kanal)
$f$;

-- Wynik zapytania jako jsonb: tablica wierszy, kazdy wiersz to tablica wartosci kolumn w kolejnosci
-- select-listy. Kolejnosc wierszy = kolejnosc zwrocona przez funkcje (bez dodatkowego sortowania),
-- wiec test sprawdza tez sortowanie. Liczby porownujemy jako liczby (2425.000 = 2425).
create function pg_temp.a(p_sql text) returns jsonb language plpgsql as $f$
declare
  v jsonb;
begin
  execute format(
    $q$select coalesce(jsonb_agg(
         (select jsonb_agg(e.value::jsonb order by e.ord)
            from json_each(row_to_json(t)) with ordinality as e(key, value, ord))
       ), '[]'::jsonb)
       from (%s) t$q$, p_sql)
    into v;
  return v;
end
$f$;


-- ===================================================================
-- Dane. Trigger wylaczony na czas wstawiania (czas ustawiamy wprost).
-- ===================================================================

-- Test zaklada pusta analityke (tak chodzi na swiezej bazie z migracji). Gdyby w bazie byly dane (lokalny dev),
-- czyscimy je TYLKO w tej transakcji: TRUNCATE jest transakcyjny, wiec ROLLBACK na koncu je przywraca.
truncate table public.zdarzenia, public.analityka_dzienna, public.analityka_biegi;

alter table public.zdarzenia disable trigger zdarzenia_przed_insert;

-- ---------------------------------------------------------------------------------------------
-- SWIAT T: ruch (przeglad, serie, boty, okna). Wszystkie odslony: ekran szukaj, kanal bezposrednie,
-- desktop, PL. teraz = 2026-10-26 13:30:00 UTC (14:30 czasu warszawskiego, CET).
--
-- Doby warszawskie (CEST = UTC+2 do 2026-10-25 03:00, potem CET = UTC+1):
--   26.09 (czw)  22:00Z–25.09  → doba 27.09 zaczyna sie 2026-09-26 22:00:00Z
--   24.10 (sob)  od 2026-10-23 22:00:00Z do 2026-10-24 22:00:00Z
--   25.10 (nd)   od 2026-10-24 22:00:00Z do 2026-10-25 23:00:00Z   – 25 GODZIN (zmiana czasu)
--   26.10 (pn)   od 2026-10-25 23:00:00Z do 2026-10-26 23:00:00Z   – „dzis”
--
-- Odslony ludzi (odcisk → czasy UTC); doby z powyzszej tabeli:
--   tlo daleko:   c…02 26.09 21:59:59 (doba 26.09, POZA oknem 30 dob)
--                 c…03 26.09 22:00:00 (doba 27.09, PIERWSZA chwila okna 30 dob)
--   19.10:        x1 10:00 10:05 | x2 10:10 10:15 | x3 10:20 10:25 | x4 10:30 10:35 | x5 21:59:59
--                 x6 11:00 11:05 11:10 11:15                         → 13 odslon, 6 unikalnych
--                 godzina 10:00Z ma 8 odslon (x1–x4) – szczyt godzinowy, doba 19.10 – szczyt dzienny
--   20.10:        c…04 19.10 22:00:00Z (= 20.10 00:00 CEST, pierwsza chwila okna 7 dob) → 1, 1
--   23.10:        b…01 23.10 21:59:59Z (ostatnia sekunda doby 23.10, poza oknem 3 dob)    → 1, 1
--   24.10 (D1):   b…02 23.10 22:00:00Z (pierwsza chwila doby) | y1 08:00 08:03 | y2 12:00 12:02 12:04
--                 y3 15:00 | b…03 24.10 21:59:59Z (ostatnia sekunda)   → odslon 1+2+3+1+1 = 8, unikalnych 5
--   25.10 (D2):   b…04 24.10 22:00:00Z (pierwsza chwila) | b…05 00:30Z (02:30 CEST) | b…06 01:30Z (02:30 CET,
--                 druga godzina 02:00–03:00) | z1 06:00 06:05 | z2 12:00 | z3 14:00 14:10 14:20 14:25
--                 | b…07 22:59:59Z (ostatnia sekunda)  → odslon 1+1+1+2+1+4+1 = 11, unikalnych 7
--   26.10 (D3):   b…08 25.10 23:00:00Z (pierwsza chwila) | w1 07:00 07:02 | w2 09:00 | t6 10:00
--                 | n1 (BEZ odcisku) 11:00 | t5 13:20 | t4 13:25:00 | t1 13:27 | t2 13:30:00 (= teraz)
--                 → odslon 1+2+1+1+1+1+1+1+1 = 10; do tego zdarzenia nie-odslony tego samego dnia:
--                 t6 klik 13:29:30, t7 wital 13:26:00 (t7 NIE ma odslony: „duch”, liczy sie jako unikalny
--                 i jako obecny, bo unikalny = dowolne zdarzenie czlowieka z odciskiem)
--                 → unikalnych: b…08 w1 w2 t6 t5 t4 t1 t2 t7 = 9 (n1 bez odcisku nie liczy sie)
--
-- Boty (odslony, czy_bot):
--   f…01 gptbot/ai          26.10 05:10, 13:28            f…05 gptbot/ai       19.10 12:00
--   f…02 claudebot/ai       25.10 20:00, 26.10 05:00      f…03 googlebot/wyszukiwarka 26.10 03:00, 03:01
--   f…04 curl/narzedzie     25.10 08:00                   f…07 (bez rodziny i klasy) 26.10 02:00
--   f…08 perplexitybot/ai   20.10 08:00, 08:01            f…06 gptbot/ai       26.09 12:00 (POZA oknem 30 dob)
do $d$
begin
  perform pg_temp.pvt('2026-09-26 21:59:59+00', 'c000000000000002');
  perform pg_temp.pvt('2026-09-26 22:00:00+00', 'c000000000000003');

  perform pg_temp.pvt('2026-10-19 10:00:00+00', 'c100000000000001');
  perform pg_temp.pvt('2026-10-19 10:05:00+00', 'c100000000000001');
  perform pg_temp.pvt('2026-10-19 10:10:00+00', 'c100000000000002');
  perform pg_temp.pvt('2026-10-19 10:15:00+00', 'c100000000000002');
  perform pg_temp.pvt('2026-10-19 10:20:00+00', 'c100000000000003');
  perform pg_temp.pvt('2026-10-19 10:25:00+00', 'c100000000000003');
  perform pg_temp.pvt('2026-10-19 10:30:00+00', 'c100000000000004');
  perform pg_temp.pvt('2026-10-19 10:35:00+00', 'c100000000000004');
  perform pg_temp.pvt('2026-10-19 21:59:59+00', 'c100000000000005');
  perform pg_temp.pvt('2026-10-19 11:00:00+00', 'c100000000000006');
  perform pg_temp.pvt('2026-10-19 11:05:00+00', 'c100000000000006');
  perform pg_temp.pvt('2026-10-19 11:10:00+00', 'c100000000000006');
  perform pg_temp.pvt('2026-10-19 11:15:00+00', 'c100000000000006');

  perform pg_temp.pvt('2026-10-19 22:00:00+00', 'c000000000000004');
  perform pg_temp.pvt('2026-10-23 21:59:59+00', 'b100000000000001');

  -- D1 = 24.10
  perform pg_temp.pvt('2026-10-23 22:00:00+00', 'b100000000000002');
  perform pg_temp.pvt('2026-10-24 08:00:00+00', 'd100000000000001');
  perform pg_temp.pvt('2026-10-24 08:03:00+00', 'd100000000000001');
  perform pg_temp.pvt('2026-10-24 12:00:00+00', 'd100000000000002');
  perform pg_temp.pvt('2026-10-24 12:02:00+00', 'd100000000000002');
  perform pg_temp.pvt('2026-10-24 12:04:00+00', 'd100000000000002');
  perform pg_temp.pvt('2026-10-24 15:00:00+00', 'd100000000000003');
  perform pg_temp.pvt('2026-10-24 21:59:59+00', 'b100000000000003');

  -- D2 = 25.10 (doba 25-godzinna)
  perform pg_temp.pvt('2026-10-24 22:00:00+00', 'b100000000000004');
  perform pg_temp.pvt('2026-10-25 00:30:00+00', 'b100000000000005');
  perform pg_temp.pvt('2026-10-25 01:30:00+00', 'b100000000000006');
  perform pg_temp.pvt('2026-10-25 06:00:00+00', 'd200000000000001');
  perform pg_temp.pvt('2026-10-25 06:05:00+00', 'd200000000000001');
  perform pg_temp.pvt('2026-10-25 12:00:00+00', 'd200000000000002');
  perform pg_temp.pvt('2026-10-25 14:00:00+00', 'd200000000000003');
  perform pg_temp.pvt('2026-10-25 14:10:00+00', 'd200000000000003');
  perform pg_temp.pvt('2026-10-25 14:20:00+00', 'd200000000000003');
  perform pg_temp.pvt('2026-10-25 14:25:00+00', 'd200000000000003');
  perform pg_temp.pvt('2026-10-25 22:59:59+00', 'b100000000000007');

  -- D3 = 26.10
  perform pg_temp.pvt('2026-10-25 23:00:00+00', 'b100000000000008');
  perform pg_temp.pvt('2026-10-26 07:00:00+00', 'd300000000000001');
  perform pg_temp.pvt('2026-10-26 07:02:00+00', 'd300000000000001');
  perform pg_temp.pvt('2026-10-26 09:00:00+00', 'd300000000000002');
  perform pg_temp.pvt('2026-10-26 10:00:00+00', 'd300000000000006');
  perform pg_temp.pv('2026-10-26 11:00:00+00', null, 'szukaj', '/', 'bezposrednie');
  perform pg_temp.pvt('2026-10-26 13:20:00+00', 'd300000000000005');
  perform pg_temp.pvt('2026-10-26 13:25:00+00', 'd300000000000004');
  perform pg_temp.pvt('2026-10-26 13:27:00+00', 'd300000000000011');
  perform pg_temp.pvt('2026-10-26 13:30:00+00', 'd300000000000012');
  perform pg_temp.klik('2026-10-26 13:29:30+00', 'd300000000000006', 'szukaj', 'hero§przycisk§szukaj');
  perform pg_temp.wital('2026-10-26 13:26:00+00', 'd300000000000007', 'szukaj', 'lcp', 1234);

  -- boty
  perform pg_temp.pv('2026-10-26 05:10:00+00', 'f100000000000001', 'szukaj', '/', null, 'inne', null, null, null, null, null, null, null, true, 'gptbot', 'ai');
  perform pg_temp.pv('2026-10-26 13:28:00+00', 'f100000000000001', 'szukaj', '/', null, 'inne', null, null, null, null, null, null, null, true, 'gptbot', 'ai');
  perform pg_temp.pv('2026-10-19 12:00:00+00', 'f100000000000005', 'szukaj', '/', null, 'inne', null, null, null, null, null, null, null, true, 'gptbot', 'ai');
  perform pg_temp.pv('2026-10-25 20:00:00+00', 'f100000000000002', 'szukaj', '/', null, 'inne', null, null, null, null, null, null, null, true, 'claudebot', 'ai');
  perform pg_temp.pv('2026-10-26 05:00:00+00', 'f100000000000002', 'szukaj', '/', null, 'inne', null, null, null, null, null, null, null, true, 'claudebot', 'ai');
  perform pg_temp.pv('2026-10-26 03:00:00+00', 'f100000000000003', 'szukaj', '/', null, 'inne', null, null, null, null, null, null, null, true, 'googlebot', 'wyszukiwarka');
  perform pg_temp.pv('2026-10-26 03:01:00+00', 'f100000000000003', 'szukaj', '/', null, 'inne', null, null, null, null, null, null, null, true, 'googlebot', 'wyszukiwarka');
  perform pg_temp.pv('2026-10-25 08:00:00+00', 'f100000000000004', 'szukaj', '/', null, 'inne', null, null, null, null, null, null, null, true, 'curl', 'narzedzie');
  perform pg_temp.pv('2026-10-26 02:00:00+00', 'f100000000000007', 'szukaj', '/', null, 'inne', null, null, null, null, null, null, null, true, null, null);
  perform pg_temp.pv('2026-10-20 08:00:00+00', 'f100000000000008', 'szukaj', '/', null, 'inne', null, null, null, null, null, null, null, true, 'perplexitybot', 'ai');
  perform pg_temp.pv('2026-10-20 08:01:00+00', 'f100000000000008', 'szukaj', '/', null, 'inne', null, null, null, null, null, null, null, true, 'perplexitybot', 'ai');
  perform pg_temp.pv('2026-09-26 12:00:00+00', 'f100000000000006', 'szukaj', '/', null, 'inne', null, null, null, null, null, null, null, true, 'gptbot', 'ai');
end
$d$;

-- Zestawienie dzienne (analityka_dzienna) do admin_seria_dzienna:
--   24.10  pelny komplet kluczy, inne niz surowe (100/50/7) → zestawienie wygrywa ze surowymi
--   22.10  tylko klucz odslony (5), bez surowych zdarzen → wiersz z zestawienia, brakujace klucze = 0
--   26.10  „stare” liczby z poranka (999) → dzisiejsza doba ZAWSZE na zywo, zestawienie ignorowane
--   25.10  tylko inny wymiar (ekran) → doba nie ma zestawienia ruchu, liczona na zywo
insert into public.analityka_dzienna (dzien, wymiar, klucz, wartosc) values
  ('2026-10-24', 'ruch', 'odslony', 100),
  ('2026-10-24', 'ruch', 'unikalni', 50),
  ('2026-10-24', 'ruch', 'odslony_boty', 7),
  ('2026-10-22', 'ruch', 'odslony', 5),
  ('2026-10-26', 'ruch', 'odslony', 999),
  ('2026-10-26', 'ruch', 'unikalni', 999),
  ('2026-10-26', 'ruch', 'odslony_boty', 999),
  ('2026-10-25', 'ekran', 'szukaj', 3);

-- ---------------------------------------------------------------------------------------------
-- SWIAT S: 15.09.2026 (wtorek, CEST = UTC+2), teraz = 20:00:00Z. 18 sesji ludzi + zdarzenia pomocnicze.
-- Odciski e5000000000000XX; XX: a1 A, a2 B, a3 C, a4 D, a5 E, a6 F, a7 G, a8 H, a9 I, aa J, ab K, ac L,
-- ad M, ae N, af P, b1 Q. Czasy UTC (godz. tylko hh:mm:ss tego dnia). Sesja = odsłony jednego odcisku
-- z przerwa <= 30 min; czas sesji = suma czas_ms jej wyjsc.
--
--  sesja kanal         zrodlo (host / utm)        kraj urz     odslony (ekran)                       czas_ms
--  A    wyszukiwarka   google.com                 PL   mobile  08:00 szukaj, 08:01 okolica,
--                                                                08:04 porownanie                    30000+120000+60000 = 210000
--  B    wyszukiwarka   google.com                 PL   desktop 08:30 szukaj                          5000
--  C    social         utm facebook/social/jesien PL   mobile  09:00 szukaj, 09:00:40 okolica        20000+80000 = 100000
--  D    social         facebook.com /groups/…/123 PL   mobile  09:30 okolica                         60000
--  E    wyszukiwarka   bing.com                   PL   desktop 10:00 szukaj, 10:00:30 okolica        10000 (druga bez wyjscia)
--  F    kampania       utm google/cpc/jesien_ads  PL   desktop 10:30 szukaj (gclid)                  8000
--  G    kampania       tylko gclid                PL   mobile  10:40 szukaj                          3000
--  H    kampania       utm newsletter/email/jesien PL  desktop 11:00 szukaj, 11:00:30 okolica h-8,
--                                                                11:03 okolica h-9                   15000+120000+60000 = 195000
--  I    bezposrednie   –                          NULL tablet  11:30 szukaj                          0 (wyjscie bez widzianej sekcji)
--  J1   bezposrednie   –                          PL   desktop 12:00 szukaj, 12:00:40 metoda         20000+60000 = 80000
--  J2   (wewnetrzne→bezposrednie) –               PL   desktop 12:40 katalog, 12:41 okolica          30000+40000 = 70000
--       (przerwa J1→J2 = 39 min 20 s > 30 min → druga sesja tego samego odcisku, zaczeta odslona wewnetrzna)
--  K    odeslanie      blog.example.pl /post/12   PL   desktop 13:00 metoda                          60000
--  L    odeslanie      blog.example.pl /post/12   PL   desktop 13:10 szukaj, 13:10:30 okolica        10000+60000 = 70000
--  M    odeslanie      forum.example.pl /t/7      DE   mobile  13:30 okolica                         20000
--  N    ai             chatgpt.com                DE   desktop 14:00 okolica, 14:01 porownanie       30000+60000 = 90000
--  P    wyszukiwarka   google.com                 US   desktop 14:30 szukaj, 14:59 katalog           0 (przerwa 29 min = jedna sesja)
--  Q1   wyszukiwarka   google.com                 US   desktop 15:00 szukaj                          0
--  Q2   (wewnetrzne→bezposrednie) –               US   desktop 15:31 szukaj                          0 (przerwa 31 min = dwie sesje)
-- Sesji 18, odslon 3+1+2+1+2+1+1+3+1+2+2+1+2+1+2+2+1+1 = 29.
-- Poza sesjami (nie maja odcisku): 3 odslony ludzi (07:00 szukaj, 07:01 szukaj, 07:02 okolica /adres/a-1).
-- Bot gptbot: 1 odslona 08:00.
do $d$
declare
  a1 constant text := 'e5000000000000a1'; a2 constant text := 'e5000000000000a2';
  a3 constant text := 'e5000000000000a3'; a4 constant text := 'e5000000000000a4';
  a5 constant text := 'e5000000000000a5'; a6 constant text := 'e5000000000000a6';
  a7 constant text := 'e5000000000000a7'; a8 constant text := 'e5000000000000a8';
  a9 constant text := 'e5000000000000a9'; aa constant text := 'e5000000000000aa';
  ab constant text := 'e5000000000000ab'; ac constant text := 'e5000000000000ac';
  ad constant text := 'e5000000000000ad'; ae constant text := 'e5000000000000ae';
  af constant text := 'e5000000000000af'; b1 constant text := 'e5000000000000b1';
begin
  -- A
  perform pg_temp.pv('2026-09-15 08:00:00+00', a1, 'szukaj', '/', 'wyszukiwarka', 'mobile', 'PL', 'google.com');
  perform pg_temp.ex('2026-09-15 08:00:30+00', a1, 'szukaj', '/', 30000, 40::smallint,
    '[{"k":"hero","ms":20000,"p":0},{"k":"wyniki","ms":10000,"p":1}]', '[{"k":"hero§szukaj","e":3,"n":1}]');
  perform pg_temp.pv('2026-09-15 08:01:00+00', a1, 'okolica', '/adres/a-1', 'wewnetrzne', 'mobile');
  perform pg_temp.ex('2026-09-15 08:03:00+00', a1, 'okolica', '/adres/a-1', 120000, 80::smallint,
    '[{"k":"etykieta","ms":30000,"p":0},{"k":"kategorie","ms":60000,"p":1},{"k":"zrodla","ms":30000,"p":2},{"k":"mapa","ms":0,"p":3}]',
    '[{"k":"etykieta§porownaj","e":3,"n":0},{"k":"zrodla§pobierz","e":1,"n":0}]');
  perform pg_temp.pv('2026-09-15 08:04:00+00', a1, 'porownanie', '/porownanie', 'wewnetrzne', 'mobile');
  perform pg_temp.ex('2026-09-15 08:05:00+00', a1, 'porownanie', '/porownanie', 60000, 100::smallint,
    '[{"k":"tabela","ms":50000,"p":0},{"k":"podsumowanie","ms":10000,"p":1}]', '[{"k":"tabela§eksport","e":2,"n":1}]');
  -- B
  perform pg_temp.pv('2026-09-15 08:30:00+00', a2, 'szukaj', '/', 'wyszukiwarka', 'desktop', 'PL', 'google.com');
  perform pg_temp.ex('2026-09-15 08:30:05+00', a2, 'szukaj', '/', 5000, 10::smallint,
    '[{"k":"hero","ms":5000,"p":0}]', '[{"k":"hero§szukaj","e":1,"n":0}]');
  -- C
  perform pg_temp.pv('2026-09-15 09:00:00+00', a3, 'szukaj', '/', 'social', 'mobile', 'PL', 'l.facebook.com', null, 'facebook', 'social', 'jesien');
  perform pg_temp.ex('2026-09-15 09:00:20+00', a3, 'szukaj', '/', 20000, 30::smallint,
    '[{"k":"hero","ms":15000,"p":0},{"k":"wyniki","ms":5000,"p":1}]', '[{"k":"hero§szukaj","e":1,"n":1}]');
  perform pg_temp.pv('2026-09-15 09:00:40+00', a3, 'okolica', '/adres/c-3', 'wewnetrzne', 'mobile');
  perform pg_temp.ex('2026-09-15 09:02:00+00', a3, 'okolica', '/adres/c-3', 80000, 60::smallint,
    '[{"k":"etykieta","ms":40000,"p":0},{"k":"kategorie","ms":40000,"p":1}]', '[{"k":"etykieta§porownaj","e":2,"n":0}]');
  -- D
  perform pg_temp.pv('2026-09-15 09:30:00+00', a4, 'okolica', '/adres/d-4', 'social', 'mobile', 'PL', 'facebook.com', '/groups/rodzice/posts/123');
  perform pg_temp.ex('2026-09-15 09:31:00+00', a4, 'okolica', '/adres/d-4', 60000, 70::smallint,
    '[{"k":"etykieta","ms":30000,"p":0},{"k":"kategorie","ms":30000,"p":1}]', '[{"k":"etykieta§porownaj","e":1,"n":0}]');
  -- E (drugie wyjscie zgubione)
  perform pg_temp.pv('2026-09-15 10:00:00+00', a5, 'szukaj', '/', 'wyszukiwarka', 'desktop', 'PL', 'bing.com');
  perform pg_temp.ex('2026-09-15 10:00:10+00', a5, 'szukaj', '/', 10000, 20::smallint, '[{"k":"hero","ms":10000,"p":0}]', null);
  perform pg_temp.pv('2026-09-15 10:00:30+00', a5, 'okolica', '/adres/a-1', 'wewnetrzne', 'desktop');
  -- F
  perform pg_temp.pv('2026-09-15 10:30:00+00', a6, 'szukaj', '/', 'kampania', 'desktop', 'PL', null, null, 'google', 'cpc', 'jesien_ads', 'gclid');
  perform pg_temp.ex('2026-09-15 10:30:08+00', a6, 'szukaj', '/', 8000, 10::smallint,
    '[{"k":"hero","ms":8000,"p":0}]', '[{"k":"hero§szukaj","e":1,"n":0}]');
  -- G
  perform pg_temp.pv('2026-09-15 10:40:00+00', a7, 'szukaj', '/', 'kampania', 'mobile', 'PL', null, null, null, null, null, 'gclid');
  perform pg_temp.ex('2026-09-15 10:40:03+00', a7, 'szukaj', '/', 3000, 5::smallint, '[{"k":"hero","ms":3000,"p":0}]', null);
  -- H
  perform pg_temp.pv('2026-09-15 11:00:00+00', a8, 'szukaj', '/', 'kampania', 'desktop', 'PL', null, null, 'newsletter', 'email', 'jesien');
  perform pg_temp.ex('2026-09-15 11:00:15+00', a8, 'szukaj', '/', 15000, 20::smallint, '[{"k":"hero","ms":15000,"p":0}]', null);
  perform pg_temp.pv('2026-09-15 11:00:30+00', a8, 'okolica', '/adres/h-8', 'wewnetrzne', 'desktop');
  perform pg_temp.ex('2026-09-15 11:02:30+00', a8, 'okolica', '/adres/h-8', 120000, 90::smallint,
    '[{"k":"etykieta","ms":60000,"p":0},{"k":"kategorie","ms":40000,"p":1},{"k":"zrodla","ms":20000,"p":2}]',
    '[{"k":"etykieta§porownaj","e":4,"n":0}]');
  perform pg_temp.pv('2026-09-15 11:03:00+00', a8, 'okolica', '/adres/h-9', 'wewnetrzne', 'desktop');
  perform pg_temp.ex('2026-09-15 11:04:00+00', a8, 'okolica', '/adres/h-9', 60000, 70::smallint,
    '[{"k":"etykieta","ms":30000,"p":0},{"k":"kategorie","ms":30000,"p":1}]', '[{"k":"etykieta§porownaj","e":2,"n":0}]');
  -- I (kraj NULL; wyjscie bez widzianej sekcji: ms 0)
  perform pg_temp.pv('2026-09-15 11:30:00+00', a9, 'szukaj', '/', 'bezposrednie', 'tablet', null);
  perform pg_temp.ex('2026-09-15 11:30:02+00', a9, 'szukaj', '/', 0, 0::smallint, '[{"k":"hero","ms":0,"p":0}]', null);
  -- J1 i J2
  perform pg_temp.pv('2026-09-15 12:00:00+00', aa, 'szukaj', '/', 'bezposrednie', 'desktop', 'PL');
  perform pg_temp.ex('2026-09-15 12:00:20+00', aa, 'szukaj', '/', 20000, 15::smallint,
    '[{"k":"hero","ms":20000,"p":0}]', '[{"k":"hero§szukaj","e":1,"n":0}]');
  perform pg_temp.pv('2026-09-15 12:00:40+00', aa, 'metoda', '/metoda', 'wewnetrzne', 'desktop');
  perform pg_temp.ex('2026-09-15 12:01:40+00', aa, 'metoda', '/metoda', 60000, 100::smallint,
    '[{"k":"intro","ms":30000,"p":0},{"k":"zrodla","ms":30000,"p":1}]', null);
  perform pg_temp.pv('2026-09-15 12:40:00+00', aa, 'katalog', '/katalog', 'wewnetrzne', 'desktop');
  perform pg_temp.ex('2026-09-15 12:40:30+00', aa, 'katalog', '/katalog', 30000, 50::smallint,
    '[{"k":"lista","ms":30000,"p":0}]', '[{"k":"lista§otworz","e":5,"n":0}]');
  perform pg_temp.pv('2026-09-15 12:41:00+00', aa, 'okolica', '/adres/j-10', 'wewnetrzne', 'desktop');
  perform pg_temp.ex('2026-09-15 12:42:00+00', aa, 'okolica', '/adres/j-10', 40000, 60::smallint,
    '[{"k":"etykieta","ms":40000,"p":0}]', null);
  -- K
  perform pg_temp.pv('2026-09-15 13:00:00+00', ab, 'metoda', '/metoda', 'odeslanie', 'desktop', 'PL', 'blog.example.pl', '/post/12');
  perform pg_temp.ex('2026-09-15 13:01:00+00', ab, 'metoda', '/metoda', 60000, 100::smallint, '[{"k":"intro","ms":60000,"p":0}]', null);
  -- L
  perform pg_temp.pv('2026-09-15 13:10:00+00', ac, 'szukaj', '/', 'odeslanie', 'desktop', 'PL', 'blog.example.pl', '/post/12');
  perform pg_temp.ex('2026-09-15 13:10:10+00', ac, 'szukaj', '/', 10000, 10::smallint, '[{"k":"hero","ms":10000,"p":0}]', null);
  perform pg_temp.pv('2026-09-15 13:10:30+00', ac, 'okolica', '/adres/l-12', 'wewnetrzne', 'desktop');
  perform pg_temp.ex('2026-09-15 13:11:30+00', ac, 'okolica', '/adres/l-12', 60000, 80::smallint,
    '[{"k":"etykieta","ms":60000,"p":0}]', '[{"k":"etykieta§porownaj","e":1,"n":1}]');
  -- M
  perform pg_temp.pv('2026-09-15 13:30:00+00', ad, 'okolica', '/adres/a-1', 'odeslanie', 'mobile', 'DE', 'forum.example.pl', '/t/7');
  perform pg_temp.ex('2026-09-15 13:30:20+00', ad, 'okolica', '/adres/a-1', 20000, 40::smallint, '[{"k":"etykieta","ms":20000,"p":0}]', null);
  -- N
  perform pg_temp.pv('2026-09-15 14:00:00+00', ae, 'okolica', '/adres/n-13', 'ai', 'desktop', 'DE', 'chatgpt.com');
  perform pg_temp.ex('2026-09-15 14:00:30+00', ae, 'okolica', '/adres/n-13', 30000, 50::smallint, '[{"k":"etykieta","ms":30000,"p":0}]', null);
  perform pg_temp.pv('2026-09-15 14:01:00+00', ae, 'porownanie', '/porownanie', 'wewnetrzne', 'desktop', 'DE');
  perform pg_temp.ex('2026-09-15 14:02:00+00', ae, 'porownanie', '/porownanie', 60000, 100::smallint, '[{"k":"tabela","ms":60000,"p":0}]', null);
  -- P (przerwa 29 min) i Q (przerwa 31 min)
  perform pg_temp.pv('2026-09-15 14:30:00+00', af, 'szukaj', '/', 'wyszukiwarka', 'desktop', 'US', 'google.com');
  perform pg_temp.pv('2026-09-15 14:59:00+00', af, 'katalog', '/katalog', 'wewnetrzne', 'desktop', 'US');
  perform pg_temp.pv('2026-09-15 15:00:00+00', b1, 'szukaj', '/', 'wyszukiwarka', 'desktop', 'US', 'google.com');
  perform pg_temp.pv('2026-09-15 15:31:00+00', b1, 'szukaj', '/', 'wewnetrzne', 'desktop', 'US');

  -- odslony ludzi bez odcisku (nie tworza sesji, licza sie w top ekranach / adresach)
  perform pg_temp.pv('2026-09-15 07:00:00+00', null, 'szukaj', '/', 'bezposrednie');
  perform pg_temp.pv('2026-09-15 07:01:00+00', null, 'szukaj', '/', 'bezposrednie');
  perform pg_temp.pv('2026-09-15 07:02:00+00', null, 'okolica', '/adres/a-1', 'bezposrednie');
  -- bot (wykluczony wszedzie poza admin_boty_ai)
  perform pg_temp.pv('2026-09-15 08:00:00+00', 'e5000000000000f1', 'szukaj', '/', null, 'inne', null, null, null, null, null, null, null, true, 'gptbot', 'ai');
end
$d$;

-- Zdarzenia produktowe lejka (sesje liczone po odcisku i przedziale [pierwsza odslona, ostatnia + 30 min]):
--   wyszukanie: A B C E F H J1 L P Q1 = 10 sesji     karta_adresu: A C E H L N = 6 (J: zdarzenie miedzy sesjami
--   12:35:00 jest sierota, nie wchodzi)               porownanie_dodaj: A N = 2
--   warstwa_mapy: C (dwa zdarzenia, jedna sesja) H = 2   tryb_biznes: J2 i Q2 = 2 (zdarzenie Q 16:01:00 = ostatnia
--   odslona 15:31 + 30 min dokladnie → wlicza sie; zdarzenie P 15:29:01 = 1 s po koncu przedzialu → nie)
do $d$
begin
  perform pg_temp.prod('2026-09-15 08:00:05+00', 'e5000000000000a1', 'wyszukanie', '{"wynikow":3,"rodzaj":"adres"}');
  perform pg_temp.prod('2026-09-15 08:01:10+00', 'e5000000000000a1', 'karta_adresu');
  perform pg_temp.prod('2026-09-15 08:04:10+00', 'e5000000000000a1', 'porownanie_dodaj');
  perform pg_temp.prod('2026-09-15 08:05:30+00', 'e5000000000000a1', 'udostepnij');
  perform pg_temp.prod('2026-09-15 08:30:02+00', 'e5000000000000a2', 'wyszukanie');
  perform pg_temp.prod('2026-09-15 09:00:02+00', 'e5000000000000a3', 'wyszukanie');
  perform pg_temp.prod('2026-09-15 09:00:50+00', 'e5000000000000a3', 'karta_adresu');
  perform pg_temp.prod('2026-09-15 09:01:00+00', 'e5000000000000a3', 'warstwa_mapy', '{"warstwa":"halas"}');
  perform pg_temp.prod('2026-09-15 09:01:30+00', 'e5000000000000a3', 'warstwa_mapy', '{"warstwa":"powietrze"}');
  perform pg_temp.prod('2026-09-15 10:00:02+00', 'e5000000000000a5', 'wyszukanie');
  perform pg_temp.prod('2026-09-15 10:00:40+00', 'e5000000000000a5', 'karta_adresu');
  perform pg_temp.prod('2026-09-15 10:30:02+00', 'e5000000000000a6', 'wyszukanie');
  perform pg_temp.prod('2026-09-15 11:00:02+00', 'e5000000000000a8', 'wyszukanie');
  perform pg_temp.prod('2026-09-15 11:00:40+00', 'e5000000000000a8', 'karta_adresu');
  perform pg_temp.prod('2026-09-15 11:03:30+00', 'e5000000000000a8', 'warstwa_mapy', '{"warstwa":"halas"}');
  perform pg_temp.prod('2026-09-15 12:00:02+00', 'e5000000000000aa', 'wyszukanie');
  perform pg_temp.prod('2026-09-15 12:35:00+00', 'e5000000000000aa', 'karta_adresu');
  perform pg_temp.prod('2026-09-15 12:41:30+00', 'e5000000000000aa', 'tryb_biznes');
  perform pg_temp.prod('2026-09-15 13:10:02+00', 'e5000000000000ac', 'wyszukanie');
  perform pg_temp.prod('2026-09-15 13:10:40+00', 'e5000000000000ac', 'karta_adresu');
  perform pg_temp.prod('2026-09-15 14:00:40+00', 'e5000000000000ae', 'karta_adresu');
  perform pg_temp.prod('2026-09-15 14:01:30+00', 'e5000000000000ae', 'porownanie_dodaj');
  perform pg_temp.prod('2026-09-15 14:30:02+00', 'e5000000000000af', 'wyszukanie');
  perform pg_temp.prod('2026-09-15 15:29:01+00', 'e5000000000000af', 'tryb_biznes');
  perform pg_temp.prod('2026-09-15 15:00:02+00', 'e5000000000000b1', 'wyszukanie');
  perform pg_temp.prod('2026-09-15 16:01:00+00', 'e5000000000000b1', 'tryb_biznes');
  -- nie wchodza: bot, odcisk bez odslon
  perform pg_temp.prod('2026-09-15 08:00:10+00', 'e5000000000000f1', 'wyszukanie', null, 'szukaj', true);
  perform pg_temp.prod('2026-09-15 09:00:00+00', 'e5000000000000ee', 'wyszukanie');
  perform pg_temp.prod('2026-09-15 09:00:30+00', 'e5000000000000ee', 'karta_adresu');
end
$d$;

-- Klikniecia (sygnaly UX): furia okolica 3, martwy okolica 2, furia szukaj 1, martwy szukaj 4;
-- poza liczeniem: rodzaj „przycisk” (5), zle etykiety (bez separatora, NULL), boty (2 furie).
do $d$
begin
  perform pg_temp.klik('2026-09-15 08:02:00+00', 'e5000000000000a1', 'okolica', 'etykieta§furia§porownaj');
  perform pg_temp.klik('2026-09-15 08:02:01+00', 'e5000000000000a1', 'okolica', 'etykieta§furia§porownaj');
  perform pg_temp.klik('2026-09-15 08:02:02+00', 'e5000000000000a1', 'okolica', 'etykieta§furia§porownaj');
  perform pg_temp.klik('2026-09-15 09:01:10+00', 'e5000000000000a3', 'okolica', 'etykieta§martwy§tlo');
  perform pg_temp.klik('2026-09-15 09:01:11+00', 'e5000000000000a3', 'okolica', 'etykieta§martwy§tlo');
  perform pg_temp.klik('2026-09-15 08:30:03+00', 'e5000000000000a2', 'szukaj', 'hero§furia§szukaj');
  perform pg_temp.klik('2026-09-15 10:00:05+00', 'e5000000000000a5', 'szukaj', 'hero§martwy§logo');
  perform pg_temp.klik('2026-09-15 10:00:06+00', 'e5000000000000a5', 'szukaj', 'hero§martwy§logo');
  perform pg_temp.klik('2026-09-15 10:00:07+00', 'e5000000000000a5', 'szukaj', 'hero§martwy§logo');
  perform pg_temp.klik('2026-09-15 10:00:08+00', 'e5000000000000a5', 'szukaj', 'hero§martwy§logo');
  perform pg_temp.klik('2026-09-15 11:01:00+00', 'e5000000000000a8', 'okolica', 'etykieta§przycisk§porownaj');
  perform pg_temp.klik('2026-09-15 11:01:01+00', 'e5000000000000a8', 'okolica', 'etykieta§przycisk§porownaj');
  perform pg_temp.klik('2026-09-15 11:01:02+00', 'e5000000000000a8', 'okolica', 'etykieta§przycisk§porownaj');
  perform pg_temp.klik('2026-09-15 11:01:03+00', 'e5000000000000a8', 'okolica', 'etykieta§przycisk§porownaj');
  perform pg_temp.klik('2026-09-15 11:01:04+00', 'e5000000000000a8', 'okolica', 'etykieta§przycisk§porownaj');
  perform pg_temp.klik('2026-09-15 11:05:00+00', 'e5000000000000a8', 'okolica', 'bez-separatora');
  perform pg_temp.klik('2026-09-15 11:05:01+00', 'e5000000000000a8', 'okolica', null);
  perform pg_temp.klik('2026-09-15 08:00:20+00', 'e5000000000000f1', 'szukaj', 'hero§furia§szukaj', true);
  perform pg_temp.klik('2026-09-15 08:00:21+00', 'e5000000000000f1', 'szukaj', 'hero§furia§szukaj', true);
end
$d$;

-- Wyszukiwania bez wyniku (produktowe wyszukanie_bez_wyniku):
--   „ul. długa 5” w trzech zapisach (wielkosc liter i spacje) → jedna pozycja x3, ostatnie 10:00
--   „abc 1” x2 (08:00, 12:00)   „xyz” x1 (11:00)   odrzucone (dane osobowe) x2, ostatnie 13:10
--   pomijane: pusta fraza, wlasciwosci NULL, bot; granica 30 dob (15.09 − 29 = 17.08, 00:00 CEST = 16.08 22:00Z):
--   „na krawedzi” 16.08 22:00:00Z wchodzi, „poza oknem” 16.08 21:59:59Z nie.
do $d$
begin
  perform pg_temp.prod('2026-09-15 09:00:00+00', 'e5000000000000a3', 'wyszukanie_bez_wyniku', '{"fraza":"ul. długa 5"}');
  perform pg_temp.prod('2026-09-15 09:30:00+00', 'e5000000000000a4', 'wyszukanie_bez_wyniku', '{"fraza":"Ul. Długa 5"}');
  perform pg_temp.prod('2026-09-15 10:00:00+00', 'e5000000000000a5', 'wyszukanie_bez_wyniku', '{"fraza":"  ul. długa 5 "}');
  perform pg_temp.prod('2026-09-15 08:00:00+00', 'e5000000000000a1', 'wyszukanie_bez_wyniku', '{"fraza":"abc 1"}');
  perform pg_temp.prod('2026-09-15 12:00:00+00', 'e5000000000000aa', 'wyszukanie_bez_wyniku', '{"fraza":"abc 1"}');
  perform pg_temp.prod('2026-09-15 11:00:00+00', 'e5000000000000a8', 'wyszukanie_bez_wyniku', '{"fraza":"xyz"}');
  perform pg_temp.prod('2026-09-15 13:00:00+00', 'e5000000000000ab', 'wyszukanie_bez_wyniku', '{"odrzucono":true}');
  perform pg_temp.prod('2026-09-15 13:10:00+00', 'e5000000000000ac', 'wyszukanie_bez_wyniku', '{"odrzucono":true}');
  perform pg_temp.prod('2026-09-15 14:00:00+00', 'e5000000000000ad', 'wyszukanie_bez_wyniku', '{"fraza":"   "}');
  perform pg_temp.prod('2026-09-15 14:10:00+00', 'e5000000000000ae', 'wyszukanie_bez_wyniku', null);
  perform pg_temp.prod('2026-09-15 14:20:00+00', 'e5000000000000f1', 'wyszukanie_bez_wyniku', '{"fraza":"fraza bota"}', 'szukaj', true);
  perform pg_temp.prod('2026-08-16 21:59:59+00', 'e5000000000000a1', 'wyszukanie_bez_wyniku', '{"fraza":"poza oknem"}');
  perform pg_temp.prod('2026-08-16 22:00:00+00', 'e5000000000000a1', 'wyszukanie_bez_wyniku', '{"fraza":"na krawedzi"}');
end
$d$;

-- Udostepnienia: karta/link x3, karta/kopia x2, karta/anulowano x1, porownanie/natywne x2,
-- bez etykiety/blad x1, karta/bez kanalu x1; bot (karta/link x5) nie wchodzi.
do $d$
begin
  perform pg_temp.udo('2026-09-15 08:06:00+00', 'e5000000000000a1', 'okolica', 'karta', 'link');
  perform pg_temp.udo('2026-09-15 08:06:01+00', 'e5000000000000a1', 'okolica', 'karta', 'link');
  perform pg_temp.udo('2026-09-15 08:06:02+00', 'e5000000000000a1', 'okolica', 'karta', 'link');
  perform pg_temp.udo('2026-09-15 09:03:00+00', 'e5000000000000a3', 'okolica', 'karta', 'kopia');
  perform pg_temp.udo('2026-09-15 09:03:01+00', 'e5000000000000a3', 'okolica', 'karta', 'kopia');
  perform pg_temp.udo('2026-09-15 09:03:02+00', 'e5000000000000a3', 'okolica', 'karta', 'anulowano');
  perform pg_temp.udo('2026-09-15 14:03:00+00', 'e5000000000000ae', 'porownanie', 'porownanie', 'natywne');
  perform pg_temp.udo('2026-09-15 14:03:01+00', 'e5000000000000ae', 'porownanie', 'porownanie', 'natywne');
  perform pg_temp.udo('2026-09-15 14:03:02+00', 'e5000000000000ae', 'porownanie', null, 'blad');
  perform pg_temp.udo('2026-09-15 14:03:03+00', 'e5000000000000ae', 'porownanie', 'karta', null);
  perform pg_temp.udo('2026-09-15 08:07:00+00', 'e5000000000000f1', 'okolica', 'karta', 'link', true);
  perform pg_temp.udo('2026-09-15 08:07:01+00', 'e5000000000000f1', 'okolica', 'karta', 'link', true);
  perform pg_temp.udo('2026-09-15 08:07:02+00', 'e5000000000000f1', 'okolica', 'karta', 'link', true);
  perform pg_temp.udo('2026-09-15 08:07:03+00', 'e5000000000000f1', 'okolica', 'karta', 'link', true);
  perform pg_temp.udo('2026-09-15 08:07:04+00', 'e5000000000000f1', 'okolica', 'karta', 'link', true);
end
$d$;

-- Web Vitals (ludzie): okolica lcp 1000..2900 co 100 (20 pomiarow), inp 100/200/400, cls 0,01…0,10 (5);
-- szukaj lcp 800/900/1000/3000, fcp 500/700, ttfb 120; bot (lcp 99999 x3) nie wchodzi.
do $d$
declare
  i integer;
begin
  for i in 0..19 loop
    perform pg_temp.wital('2026-09-15 10:00:00+00'::timestamptz + make_interval(secs => i), 'e5000000000000a5', 'okolica', 'lcp', 1000 + 100 * i);
  end loop;
  perform pg_temp.wital('2026-09-15 11:00:00+00', 'e5000000000000a8', 'okolica', 'inp', 100);
  perform pg_temp.wital('2026-09-15 11:00:01+00', 'e5000000000000a8', 'okolica', 'inp', 200);
  perform pg_temp.wital('2026-09-15 11:00:02+00', 'e5000000000000a8', 'okolica', 'inp', 400);
  perform pg_temp.wital('2026-09-15 11:10:00+00', 'e5000000000000a8', 'okolica', 'cls', 0.01);
  perform pg_temp.wital('2026-09-15 11:10:01+00', 'e5000000000000a8', 'okolica', 'cls', 0.02);
  perform pg_temp.wital('2026-09-15 11:10:02+00', 'e5000000000000a8', 'okolica', 'cls', 0.03);
  perform pg_temp.wital('2026-09-15 11:10:03+00', 'e5000000000000a8', 'okolica', 'cls', 0.04);
  perform pg_temp.wital('2026-09-15 11:10:04+00', 'e5000000000000a8', 'okolica', 'cls', 0.10);
  perform pg_temp.wital('2026-09-15 12:00:00+00', 'e5000000000000aa', 'szukaj', 'lcp', 800);
  perform pg_temp.wital('2026-09-15 12:00:01+00', 'e5000000000000aa', 'szukaj', 'lcp', 900);
  perform pg_temp.wital('2026-09-15 12:00:02+00', 'e5000000000000aa', 'szukaj', 'lcp', 1000);
  perform pg_temp.wital('2026-09-15 12:00:03+00', 'e5000000000000aa', 'szukaj', 'lcp', 3000);
  perform pg_temp.wital('2026-09-15 12:10:00+00', 'e5000000000000aa', 'szukaj', 'fcp', 500);
  perform pg_temp.wital('2026-09-15 12:10:01+00', 'e5000000000000aa', 'szukaj', 'fcp', 700);
  perform pg_temp.wital('2026-09-15 12:20:00+00', 'e5000000000000aa', 'szukaj', 'ttfb', 120);
  perform pg_temp.wital('2026-09-15 12:30:00+00', 'e5000000000000f1', 'okolica', 'lcp', 99999, true);
  perform pg_temp.wital('2026-09-15 12:30:01+00', 'e5000000000000f1', 'okolica', 'lcp', 99999, true);
  perform pg_temp.wital('2026-09-15 12:30:02+00', 'e5000000000000f1', 'okolica', 'lcp', 99999, true);
end
$d$;

-- Bledy klienta (ludzie): TypeError x4 na okolica (09, 10, 11, 14), TypeError x1 na szukaj (12),
-- Network error x2 na okolica (13:00, 13:30); bot (x3) nie wchodzi.
do $d$
begin
  perform pg_temp.blad('2026-09-15 09:00:00+00', 'e5000000000000a3', 'okolica', 'TypeError: x is undefined');
  perform pg_temp.blad('2026-09-15 10:00:00+00', 'e5000000000000a5', 'okolica', 'TypeError: x is undefined');
  perform pg_temp.blad('2026-09-15 11:00:00+00', 'e5000000000000a8', 'okolica', 'TypeError: x is undefined');
  perform pg_temp.blad('2026-09-15 14:00:00+00', 'e5000000000000ae', 'okolica', 'TypeError: x is undefined');
  perform pg_temp.blad('2026-09-15 12:00:00+00', 'e5000000000000aa', 'szukaj', 'TypeError: x is undefined');
  perform pg_temp.blad('2026-09-15 13:00:00+00', 'e5000000000000ab', 'okolica', 'Network error');
  perform pg_temp.blad('2026-09-15 13:30:00+00', 'e5000000000000ad', 'okolica', 'Network error');
  perform pg_temp.blad('2026-09-15 15:00:00+00', 'e5000000000000f1', 'okolica', 'Network error', true);
  perform pg_temp.blad('2026-09-15 15:00:01+00', 'e5000000000000f1', 'okolica', 'Network error', true);
  perform pg_temp.blad('2026-09-15 15:00:02+00', 'e5000000000000f1', 'okolica', 'Network error', true);
end
$d$;

-- ---------------------------------------------------------------------------------------------
-- SWIAT C: 17.09.2026, teraz = 20:00:00Z. Same wyjscia z CTA (bez odslon), odcisk NULL.
--   szukaj:  baner§zapisz 30+30 = 60 (0 kl.), hero§szukaj 40+40 = 80 (3 kl.), stopka§kontakt 20+29 = 49 (0 kl.),
--            menu§mapa 50 (0 kl.)                        [bot: stopka§kontakt 1000 – nie wchodzi]
--   okolica: baner§zapisz 55 (0), etykieta§porownaj 100 (0)
--   metoda:  „bez-separatora” 70 (0); elementy zepsute (klucz liczba, e tekstowe) pomijane
--   katalog: lista§otworz 5000 obciete do 1000 na element
do $d$
begin
  perform pg_temp.ex('2026-09-17 10:00:00+00', null, 'szukaj', '/', 1000, null, null,
    '[{"k":"baner§zapisz","e":30,"n":0},{"k":"hero§szukaj","e":40,"n":2},{"k":"stopka§kontakt","e":20,"n":0},{"k":"menu§mapa","e":50,"n":0}]');
  perform pg_temp.ex('2026-09-17 10:05:00+00', null, 'szukaj', '/', 1000, null, null,
    '[{"k":"baner§zapisz","e":30,"n":0},{"k":"hero§szukaj","e":40,"n":1},{"k":"stopka§kontakt","e":29,"n":0}]');
  perform pg_temp.ex('2026-09-17 10:10:00+00', null, 'okolica', '/', 1000, null, null,
    '[{"k":"baner§zapisz","e":55,"n":0},{"k":"etykieta§porownaj","e":100,"n":0}]');
  perform pg_temp.ex('2026-09-17 10:15:00+00', null, 'szukaj', '/', 1000, null, null,
    '[{"k":"stopka§kontakt","e":1000,"n":0}]', true);
  perform pg_temp.ex('2026-09-17 10:20:00+00', null, 'metoda', '/', 1000, null, null,
    '[{"k":"bez-separatora","e":70,"n":0},{"k":123,"e":99,"n":0},{"k":"x§y","e":"abc","n":0}]');
  perform pg_temp.ex('2026-09-17 10:25:00+00', null, 'katalog', '/', 1000, null, null,
    '[{"k":"lista§otworz","e":5000,"n":0}]');
end
$d$;

-- ---------------------------------------------------------------------------------------------
-- SWIAT D: diagnostyka, teraz = 20.09.2026 12:00:00Z, okno 24 h = (19.09 12:00:00Z, 20.09 12:00:00Z].
--   ludzie: odslony x3 (09:00 e7..01, 09:05 e7..02, 09:10 BEZ odcisku), wyjscia x2, klik x1, produktowe x2,
--           wital x1 (BEZ odcisku) → bez odcisku 2; udostepnien i bledow 0 (maja byc pokazane jako 0)
--   poza liczeniem: bot 11:59 (nie psuje „ostatniego zdarzenia”), odslona 19.09 11:59:59 i 12:00:00 (poza oknem,
--   dolna granica jest wylaczna), odslona czlowieka 12:30 (po „teraz”)
do $d$
begin
  perform pg_temp.pv('2026-09-20 09:00:00+00', 'e700000000000001', 'szukaj', '/', 'bezposrednie');
  perform pg_temp.pv('2026-09-20 09:05:00+00', 'e700000000000002', 'szukaj', '/', 'bezposrednie');
  perform pg_temp.pv('2026-09-20 09:10:00+00', null, 'szukaj', '/', 'bezposrednie');
  perform pg_temp.ex('2026-09-20 09:01:00+00', 'e700000000000001', 'szukaj', '/', 1000);
  perform pg_temp.ex('2026-09-20 09:06:00+00', 'e700000000000002', 'szukaj', '/', 1000);
  perform pg_temp.klik('2026-09-20 09:02:00+00', 'e700000000000001', 'szukaj', 'hero§przycisk§szukaj');
  perform pg_temp.prod('2026-09-20 09:03:00+00', 'e700000000000001', 'wyszukanie');
  perform pg_temp.prod('2026-09-20 09:04:00+00', 'e700000000000001', 'karta_adresu');
  perform pg_temp.wital('2026-09-20 09:07:00+00', null, 'szukaj', 'lcp', 1500);
  perform pg_temp.pv('2026-09-20 11:59:00+00', 'e7000000000000f1', 'szukaj', '/', null, 'inne', null, null, null, null, null, null, null, true, 'gptbot', 'ai');
  perform pg_temp.pv('2026-09-19 11:59:59+00', 'e700000000000003', 'szukaj', '/', 'bezposrednie');
  perform pg_temp.pv('2026-09-19 12:00:00+00', 'e700000000000004', 'szukaj', '/', 'bezposrednie');
  perform pg_temp.pv('2026-09-20 12:30:00+00', 'e700000000000005', 'szukaj', '/', 'bezposrednie');
end
$d$;
-- ---------------------------------------------------------------------------------------------
-- SWIAT G: granice 30 minut, 18.09.2026, teraz = 20:00:00Z. Cztery odciski e8…:
--   a1  odslony 10:00:00 i 10:30:00 – luka DOKLADNIE 30 min = ta sama sesja (nowa dopiero powyzej 30 min)
--   a2  odslony 10:00:00 i 10:30:01 – luka 30 min 1 s = dwie sesje
--   a3  odslona 11:00:00 i wyjscie 11:30:00 (5000 ms) – wyjscie DOKLADNIE 30 min po ostatniej odslonie
--       (bez nastepnej odslony) nadal nalezy do niej
--   a4  odslona 11:00:00 i wyjscie 11:30:01 (7000 ms) – 1 s po granicy, nie nalezy
-- Sesji 5 (a1, a2 x2, a3, a4), odslon 6; czas sesji: tylko a3 = 5000 ms.
do $d$
begin
  perform pg_temp.pvt('2026-09-18 10:00:00+00', 'e8000000000000a1');
  perform pg_temp.pv('2026-09-18 10:30:00+00', 'e8000000000000a1', 'katalog', '/katalog');
  perform pg_temp.pvt('2026-09-18 10:00:00+00', 'e8000000000000a2');
  perform pg_temp.pv('2026-09-18 10:30:01+00', 'e8000000000000a2', 'szukaj', '/');
  perform pg_temp.pvt('2026-09-18 11:00:00+00', 'e8000000000000a3');
  perform pg_temp.ex('2026-09-18 11:30:00+00', 'e8000000000000a3', 'szukaj', '/', 5000, null,
    '[{"k":"hero","ms":5000,"p":0}]');
  perform pg_temp.pvt('2026-09-18 11:00:00+00', 'e8000000000000a4');
  perform pg_temp.ex('2026-09-18 11:30:01+00', 'e8000000000000a4', 'szukaj', '/', 7000, null,
    '[{"k":"hero","ms":7000,"p":0}]');
end
$d$;


insert into public.analityka_biegi (rodzaj, start, koniec, wynik, blad) values
  ('zestaw', '2026-09-19 01:20:00+00', '2026-09-19 01:20:10+00', '{}'::jsonb, null),
  ('zestaw', '2026-09-20 01:20:00+00', '2026-09-20 01:20:30+00', null, 'błąd testowy');

alter table public.zdarzenia enable trigger zdarzenia_przed_insert;

-- Konta do bramki: admin i zalogowany nie-admin.
insert into auth.users (id, email)
values ('bbbbbbbb-0000-0000-0000-0000000000a1', 'admin-panel@test.invalid'),
       ('bbbbbbbb-0000-0000-0000-0000000000a2', 'inny-panel@test.invalid');
insert into public.admini (user_id) values ('bbbbbbbb-0000-0000-0000-0000000000a1');

-- Do rownowaznosci i testow wewnetrznych dzialamy jako postgres z sesja admina (bramka widzi auth.uid()).
select set_config('request.jwt.claims',
                  '{"sub":"bbbbbbbb-0000-0000-0000-0000000000a1","role":"authenticated"}', true);

-- ===================================================================
-- A. Struktura i prawa
-- ===================================================================

select is((select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname like 'admin\_%'),
          25::bigint, 'jest dokładnie 25 funkcji public.admin_*');

select is((select array_agg(proname::text order by proname::text)
             from pg_proc where pronamespace = 'public'::regnamespace and proname like 'admin\_%'),
          array['admin_bez_wyniku', 'admin_bledy', 'admin_boty_ai', 'admin_cta_martwe', 'admin_cta_sekcje',
                'admin_diagnostyka', 'admin_kampanie', 'admin_kanaly', 'admin_kraje', 'admin_lejek',
                'admin_przeglad', 'admin_przejscia', 'admin_punkt_urwania', 'admin_sciezki', 'admin_sekcje',
                'admin_seria_dzienna', 'admin_seria_godzinowa', 'admin_sesje_przeglad', 'admin_top_adresy',
                'admin_top_ekrany', 'admin_udostepnienia', 'admin_urzadzenia', 'admin_ux_sygnaly',
                'admin_witale', 'admin_zrodla']::text[],
          'lista nazw admin_* zgodna z contracts/rpc.md');

select is((select count(*) from pg_proc
            where pronamespace = 'public'::regnamespace and proname like 'admin\_%'
              and provolatile = 's'
              and proconfig @> array['statement_timeout=30s']),
          25::bigint, 'każda admin_*: STABLE i statement_timeout = 30s');

select is((select count(*) from pg_proc p
            where p.pronamespace = 'public'::regnamespace and p.proname like 'admin\_%'
              and exists (select 1 from unnest(p.proargtypes::oid[]) as t(o)
                           where t.o in ('timestamptz'::regtype::oid, 'timestamp'::regtype::oid, 'date'::regtype::oid))),
          0::bigint, 'żadna admin_* nie przyjmuje czasu (klient nie ma podróży w czasie)');

select is((select count(*) from pg_proc
            where pronamespace = 'public'::regnamespace and proname like 'analityka\_panel\_%'),
          28::bigint, 'jest 28 funkcji wewnętrznych analityka_panel_* (25 rdzeni, wizyty, odsłony z sesjami, wyjścia)');

select is((select count(*) from pg_proc p
            where p.pronamespace = 'public'::regnamespace
              and (p.proname like 'analityka\_panel\_%'
                   or p.proname in ('analityka_przytnij', 'analityka_poczatek_okna', 'analityka_koniec_okna', 'analityka_iso'))
              and (has_function_privilege('anon', p.oid, 'execute')
                   or has_function_privilege('authenticated', p.oid, 'execute')
                   or has_function_privilege('service_role', p.oid, 'execute'))),
          0::bigint, 'funkcje wewnętrzne (rdzenie z jawnym czasem, wizyty, helpery okna): brak EXECUTE dla anon, authenticated i service_role');


-- ===================================================================
-- B. SWIAT T: przeglad, serie, boty, okna (teraz = 2026-10-26 13:30:00Z)
-- ===================================================================

create temp table przeglad_t as select public.analityka_panel_przeglad('2026-10-26 13:30:00+00') as j;

-- Unikalni (dowolne zdarzenie czlowieka z odciskiem, w dobie warszawskiej):
--   26.10: b…08 w1 w2 t6 t5 t4 t1 t2 t7 = 9 (n1 bez odcisku nie liczy sie; t7 to „duch” tylko z witalem)
--   25.10: b…04 b…05 b…06 z1 z2 z3 b…07 = 7        24.10: b…02 y1 y2 y3 b…03 = 5
--   7 dob (20–26.10): 20.10: 1 (c…04 o 19.10 22:00:00Z), 21–22.10: 0, 23.10: 1 (b…01) + 5 + 7 + 9 = 23
select is((select j ->> 'unikalni_dzis' from przeglad_t), '9', 'przegląd: unikalni dziś = 9 (w tym „duch” t7, bez n1 bez odcisku)');
select is((select j ->> 'unikalni_wczoraj' from przeglad_t), '7', 'przegląd: unikalni wczoraj (doba 25-godzinna) = 7');
select is((select j ->> 'unikalni_7d' from przeglad_t), '23', 'przegląd: unikalni 7 dób = suma dobowych = 1 + 0 + 0 + 1 + 5 + 7 + 9 = 23');
select is((select (j ->> 'unikalni_srednia_7d')::numeric from przeglad_t), 3.2857::numeric,
          'przegląd: średnia 7 dób = 23 / 7 = 3,2857 (dzielnik stały)');
-- Odsłony ludzi: 26.10: 1+2+1+1+1+1+1+1+1 = 10 (b…08, w1 x2, w2, t6, n1, t5, t4, t1, t2 – n1 liczy się jako odsłona);
--   25.10: 11; 24.10: 8; 23.10: 1; 20.10: 1  → 7 dób: 1+1+8+11+10 = 31;  19.10: 13; 27.09: 1  → 30 dób: 31+13+1 = 45
--   (c…02 o 26.09 21:59:59Z to doba 26.09, poza oknem; c…03 o 22:00:00Z to pierwsza chwila doby 27.09, w oknie)
--   24 h ruchome (25.10 13:30Z, 26.10 13:30Z]: z3 x4 (14:00–14:25) + b…07 (22:59:59) = 5 oraz 10 z 26.10 = 15
select is((select j ->> 'odslony_24h' from przeglad_t), '15', 'przegląd: odsłony 24 h = 5 z 25.10 + 10 z 26.10 = 15 (t2 o 13:30:00 = teraz wchodzi)');
select is((select j ->> 'odslony_7d' from przeglad_t), '31', 'przegląd: odsłony 7 dób = 1 + 1 + 8 + 11 + 10 = 31 (x5 o 19.10 21:59:59Z poza oknem)');
select is((select j ->> 'odslony_30d' from przeglad_t), '45', 'przegląd: odsłony 30 dób = 31 + 13 (19.10) + 1 (27.09) = 45');
-- Szczyt godzinowy: 19.10 godz. 10:00Z = x1–x4 po 2 odsłony = 8 (żadna inna godzina nie ma więcej niż 4); szczyt dzienny: 19.10 = 13 > 25.10 = 11
select is((select j -> 'szczyt_godzina' ->> 'godzina' from przeglad_t), '2026-10-19T10:00:00Z', 'przegląd: szczyt godzinowy – początek godziny (ISO, UTC)');
select is((select j -> 'szczyt_godzina' ->> 'odslony' from przeglad_t), '8', 'przegląd: szczyt godzinowy – 8 odsłon');
select is((select j -> 'szczyt_dzien' ->> 'dzien' from przeglad_t), '2026-10-19', 'przegląd: szczyt dzienny z 30 dób – doba spoza okna 7 dób');
select is((select j -> 'szczyt_dzien' ->> 'odslony' from przeglad_t), '13', 'przegląd: szczyt dzienny – 13 odsłon');
-- Teraz na stronie: (13:25:00Z, 13:30:00Z] – t1 13:27 (odsłona), t2 13:30:00 (odsłona), t6 13:29:30 (klik), t7 13:26 (wital);
--   poza: t4 13:25:00 (granica wyłączna), t5 13:20, bot f…01 13:28
select is((select j ->> 'teraz_5min' from przeglad_t), '4', 'przegląd: teraz na stronie = 4 (dowolny typ zdarzenia człowieka, granica 5 min wyłączna, bez botów)');
-- Boty w 24 h: f…01 x2, f…02 x2 (25.10 20:00 i 26.10 05:00), f…03 x2, f…07 x1 = 7; poza: f…04 (25.10 08:00), f…05, f…08
select is((select j ->> 'boty_24h' from przeglad_t), '7', 'przegląd: boty 24 h = 2 + 2 + 2 + 1 = 7');
select is((select j ->> 'ludzie_24h' from przeglad_t), '15', 'przegląd: ludzie 24 h = odslony_24h = 15');
select is((select array_agg(k order by k) from przeglad_t, jsonb_object_keys(j) as k),
          array['boty_24h', 'ludzie_24h', 'odslony_24h', 'odslony_30d', 'odslony_7d', 'szczyt_dzien', 'szczyt_godzina',
                'teraz_5min', 'unikalni_7d', 'unikalni_dzis', 'unikalni_srednia_7d', 'unikalni_wczoraj']::text[],
          'przegląd: dokładnie 12 pól z kontraktu');
select is(public.analityka_panel_przeglad('2026-01-01 12:00:00+00'),
          '{"unikalni_dzis":0,"unikalni_wczoraj":0,"unikalni_7d":0,"unikalni_srednia_7d":0,"odslony_24h":0,"odslony_7d":0,"odslony_30d":0,"szczyt_godzina":null,"szczyt_dzien":null,"teraz_5min":0,"ludzie_24h":0,"boty_24h":0}'::jsonb,
          'przegląd bez ruchu w oknie: zera i szczyty null (nie 0 udające pomiar)');

-- Seria dzienna (teraz 26.10, 6 dób = 21–26.10):
--   21.10 brak zestawienia i brak zdarzeń → BRAK wiersza;  22.10 tylko zestawienie, klucze nieobecne = 0 → (5,0,0)
--   23.10 brak zestawienia → na żywo: 1 odsłona (b…01), 1 unikalny, 0 botów
--   24.10 zestawienie (100/50/7) wygrywa z surowymi (8/5/0);  25.10 ma w zestawieniu tylko wymiar „ekran” → na żywo:
--   11 odsłon, 7 unikalnych, boty f…04 i f…02 = 2;  26.10 DZIŚ: zawsze na żywo mimo „starego” zestawienia 999 → 10, 9, 6
--   (boty 26.10: f…01 x2, f…02, f…03 x2, f…07 = 6)
select is(pg_temp.a($q$select * from public.analityka_panel_seria_dzienna('2026-10-26 13:30:00+00', 6)$q$),
          '[["2026-10-22",5,0,0],["2026-10-23",1,1,0],["2026-10-24",100,50,7],["2026-10-25",11,7,2],["2026-10-26",10,9,6]]'::jsonb,
          'seria dzienna: zestawienie dla przeszłości, na żywo dla dziś i dób bez zestawienia, brak wiersza dla dób bez danych');
select is(pg_temp.a($q$select * from public.analityka_panel_seria_dzienna('2026-10-26 13:30:00+00', 1)$q$),
          '[["2026-10-26",10,9,6]]'::jsonb, 'seria dzienna 1 doba: tylko dziś, na żywo (zestawienie 999 ignorowane)');
select is(pg_temp.a($q$select * from public.analityka_panel_seria_dzienna('2026-10-26 13:30:00+00', 1000)$q$),
          pg_temp.a($q$select * from public.analityka_panel_seria_dzienna('2026-10-26 13:30:00+00', 90)$q$),
          'seria dzienna: p_dni ponad 90 przycinane do 90');
select is(pg_temp.a($q$select * from public.analityka_panel_seria_dzienna('2026-10-26 13:30:00+00', null)$q$),
          pg_temp.a($q$select * from public.analityka_panel_seria_dzienna('2026-10-26 13:30:00+00', 30)$q$),
          'seria dzienna: NULL → domyślne 30 dób');
select is(pg_temp.a($q$select * from public.analityka_panel_seria_dzienna('2026-10-26 13:30:00+00', 0)$q$),
          pg_temp.a($q$select * from public.analityka_panel_seria_dzienna('2026-10-26 13:30:00+00', 1)$q$),
          'seria dzienna: p_dni = 0 przycinane do 1');

-- Seria godzinowa (48 h, ostatnia godzina 13:00Z → pierwsza 24.10 14:00Z)
select is((select count(*) from public.analityka_panel_seria_godzinowa('2026-10-26 13:30:00+00', 48)),
          48::bigint, 'seria godzinowa: 48 godzin, każda obecna (także bez ruchu)');
select is((select public.analityka_iso(min(godzina)) || ' .. ' || public.analityka_iso(max(godzina))
             from public.analityka_panel_seria_godzinowa('2026-10-26 13:30:00+00', 48)),
          '2026-10-24T14:00:00Z .. 2026-10-26T13:00:00Z', 'seria godzinowa: od 24.10 14:00Z do bieżącej godziny 26.10 13:00Z');
select is((select count(*) from (
             select godzina - lag(godzina) over (order by godzina) as roznica
               from public.analityka_panel_seria_godzinowa('2026-10-26 13:30:00+00', 48)) x
            where x.roznica is distinct from interval '1 hour' and x.roznica is not null),
          0::bigint, 'seria godzinowa: ciągłość w czasie bezwzględnym (każdy krok dokładnie 1 h, także przez zmianę czasu)');
-- Odsłony ludzi w tych 48 godzinach: 24.10 od 14:00Z y3 + b…03 = 2; 25.10 = 11; 26.10 = 10 → 23.
-- Odsłony botów: f…04 + f…02 (25.10) = 2 oraz 26.10: f…01 x2, f…02, f…03 x2, f…07 = 6 → 8.
select is((select sum(odslony)::text || '/' || sum(odslony_boty)::text
             from public.analityka_panel_seria_godzinowa('2026-10-26 13:30:00+00', 48)),
          '23/8', 'seria godzinowa: suma odsłon ludzi 23 i botów 8 (nic nie zgubione ani zdublowane)');
-- Zmiana czasu 25.10: 00:00Z (02:00 CEST) i 01:00Z (02:00 CET) to DWA kubełki, każdy z jedną odsłoną (b…05 o 00:30Z, b…06 o 01:30Z)
select is(pg_temp.a($q$select public.analityka_iso(godzina), odslony, unikalni, odslony_boty
                         from public.analityka_panel_seria_godzinowa('2026-10-26 13:30:00+00', 48)
                        where godzina in ('2026-10-25 00:00:00+00', '2026-10-25 01:00:00+00') order by godzina$q$),
          '[["2026-10-25T00:00:00Z",1,1,0],["2026-10-25T01:00:00Z",1,1,0]]'::jsonb,
          'seria godzinowa: powtórzona godzina 02:00–03:00 doby zmiany czasu to dwa osobne kubełki');
-- 13:00Z 26.10: odsłony t5 t4 t1 t2 = 4; unikalni t5 t4 t1 t2 + t6 (klik) + t7 (wital) = 6; bot f…01 13:28 = 1
-- 11:00Z: n1 bez odcisku = 1 odsłona, 0 unikalnych;  05:00Z: tylko boty f…01 i f…02 = 2;  25.10 03:00Z: cisza = 0
select is(pg_temp.a($q$select public.analityka_iso(godzina), odslony, unikalni, odslony_boty
                         from public.analityka_panel_seria_godzinowa('2026-10-26 13:30:00+00', 48)
                        where godzina in ('2026-10-26 13:00:00+00', '2026-10-26 11:00:00+00',
                                          '2026-10-26 05:00:00+00', '2026-10-25 03:00:00+00') order by godzina$q$),
          '[["2026-10-25T03:00:00Z",0,0,0],["2026-10-26T05:00:00Z",0,0,2],["2026-10-26T11:00:00Z",1,0,0],["2026-10-26T13:00:00Z",4,6,1]]'::jsonb,
          'seria godzinowa: godzina bez ruchu = 0, odsłona bez odcisku nie jest unikalna, unikalni liczą dowolne zdarzenie, boty osobno');
select is((select count(*) from public.analityka_panel_seria_godzinowa('2026-10-26 13:30:00+00', 1000)),
          168::bigint, 'seria godzinowa: p_godzin ponad 168 przycinane do 168');
select is((select count(*) from public.analityka_panel_seria_godzinowa('2026-10-26 13:30:00+00', 0)),
          1::bigint, 'seria godzinowa: p_godzin = 0 przycinane do 1');
select is((select count(*) from public.analityka_panel_seria_godzinowa('2026-10-26 13:30:00+00', null)),
          48::bigint, 'seria godzinowa: NULL → domyślne 48');

-- Boty (30 dób): gptbot = f…01 x2 + f…05 (19.10) = 3;  claudebot 2;  perplexitybot 2 (20.10);  googlebot 2;
-- bot bez rodziny i klasy → (nieznana)/inny 1;  curl 1;  f…06 z 26.09 poza oknem.  Klasa ai pierwsza; remisy po nazwie (bajtowo).
select is(pg_temp.a($q$select rodzina, klasa, odslony, public.analityka_iso(ostatnio)
                         from public.analityka_panel_boty_ai('2026-10-26 13:30:00+00', 30)$q$),
          '[["gptbot","ai",3,"2026-10-26T13:28:00Z"],["claudebot","ai",2,"2026-10-26T05:00:00Z"],["perplexitybot","ai",2,"2026-10-20T08:01:00Z"],["googlebot","wyszukiwarka",2,"2026-10-26T03:01:00Z"],["(nieznana)","inny",1,"2026-10-26T02:00:00Z"],["curl","narzedzie",1,"2026-10-25T08:00:00Z"]]'::jsonb,
          'boty: crawlery AI na górze, potem po odsłonach; bot bez rodziny jako (nieznana)/inny; spoza okna pominięty');
select is(pg_temp.a($q$select rodzina, klasa, odslony from public.analityka_panel_boty_ai('2026-10-26 13:30:00+00', 7)$q$),
          '[["claudebot","ai",2],["gptbot","ai",2],["perplexitybot","ai",2],["googlebot","wyszukiwarka",2],["(nieznana)","inny",1],["curl","narzedzie",1]]'::jsonb,
          'boty 7 dób: f…05 z 19.10 odpada (gptbot 3 → 2), remis crawlerów AI rozstrzyga nazwa');
select is(pg_temp.a($q$select * from public.analityka_panel_boty_ai('2026-10-26 13:30:00+00', 1000)$q$),
          pg_temp.a($q$select * from public.analityka_panel_boty_ai('2026-10-26 13:30:00+00', 30)$q$),
          'boty: p_dni ponad 30 przycinane do 30');

-- Sesje na swiecie T (p_dni = 3 → 24–26.10; okno zaczyna sie 23.10 22:00:00Z i obejmuje b…02 dokladnie o poczatku okna):
--   sesji: 24.10: b…02 y1 y2 y3 b…03 = 5 (odslon 1+2+3+1+1 = 8);  25.10: 7 (11);  26.10: b…08 w1 w2 t6 t5 t4 t1 t2 = 8 (9; n1 bez odcisku
--   nie tworzy sesji) → 20 sesji, 28 odslon.  Wielostronicowe: y1 (2) y2 (3) z1 (2) z3 (4) w1 (2) = 5, jednostronicowe 15.
--   mediana stron: 15 jedynek, mediana z pozycji 9,5 → 1; średnia 28/20 = 1,4; brak wyjść → czasy 0; zaangażowane = 5 (żadne nie ma 30 s)
select is(public.analityka_panel_sesje_przeglad('2026-10-26 13:30:00+00', 3),
          '{"sesje":20,"odslony":28,"mediana_stron":1,"srednia_stron":1.4,"mediana_czas_s":0,"p75_czas_s":0,"zaangazowane":5,"jednostronicowe":15}'::jsonb,
          'sesje 3 doby (z dobą zmiany czasu): 20 sesji, 28 odsłon, mediana 1, średnia 1,4, 5 zaangażowanych, 15 jednostronicowych');
select is((public.analityka_panel_sesje_przeglad('2026-10-26 13:30:00+00', 2) ->> 'sesje') || '/' ||
          (public.analityka_panel_sesje_przeglad('2026-10-26 13:30:00+00', 2) ->> 'odslony'),
          '15/20', 'sesje 2 doby: 7 + 8 = 15 sesji, 11 + 9 = 20 odsłon (b…04 o 24.10 22:00:00Z = początek okna wchodzi)');
select is((public.analityka_panel_sesje_przeglad('2026-10-26 13:30:00+00', 1) ->> 'sesje') || '/' ||
          (public.analityka_panel_sesje_przeglad('2026-10-26 13:30:00+00', 1) ->> 'odslony'),
          '8/9', 'sesje 1 doba (dziś): 8 sesji, 9 odsłon (b…08 o 25.10 23:00:00Z = początek doby wchodzi)');
select is(pg_temp.a($q$select * from public.analityka_panel_kanaly('2026-10-26 13:30:00+00', 3)$q$),
          '[["bezposrednie",20,28]]'::jsonb, 'kanały 3 doby: 20 wizyt i 28 odsłon, wszystkie bezposrednie');
select is(pg_temp.a($q$select * from public.analityka_panel_kraje('2026-10-26 13:30:00+00', 3)$q$),
          '[["PL",20]]'::jsonb, 'kraje 3 doby: 20 wizyt z PL');
select is(pg_temp.a($q$select * from public.analityka_panel_urzadzenia('2026-10-26 13:30:00+00', 3)$q$),
          '[["desktop",20]]'::jsonb, 'urządzenia 3 doby: 20 wizyt z desktopu');
-- Górna granica okna: teraz = 25.10 12:00Z, 1 doba = 25.10 (do 25.10 23:00:00Z wyłącznie); b…08 o 23:00:00Z (pierwsza chwila 26.10) NIE wchodzi
select is(pg_temp.a($q$select * from public.analityka_panel_kanaly('2026-10-25 12:00:00+00', 1)$q$),
          '[["bezposrednie",7,11]]'::jsonb, 'okno kończy się o północy: doba 25.10 ma 7 wizyt i 11 odsłon, nic z 26.10');
select is(pg_temp.a($q$select * from public.analityka_panel_top_ekrany('2026-10-25 12:00:00+00', 1)$q$),
          '[["szukaj",11,7]]'::jsonb, 'okno kończy się o północy także dla zdarzeń surowych: 11 odsłon, 7 unikalnych');

-- Niezależność od strefy sesji: wyniki muszą być identyczne w skrajnych strefach (UTC+14 i UTC-12)
set local timezone = 'Pacific/Kiritimati';
select is(public.analityka_panel_przeglad('2026-10-26 13:30:00+00'), (select j from przeglad_t),
          'przegląd nie zależy od strefy sesji (UTC+14)');
select is(pg_temp.a($q$select public.analityka_iso(godzina), odslony, unikalni, odslony_boty
                         from public.analityka_panel_seria_godzinowa('2026-10-26 13:30:00+00', 48)
                        where godzina in ('2026-10-25 00:00:00+00', '2026-10-25 01:00:00+00', '2026-10-26 13:00:00+00') order by godzina$q$),
          '[["2026-10-25T00:00:00Z",1,1,0],["2026-10-25T01:00:00Z",1,1,0],["2026-10-26T13:00:00Z",4,6,1]]'::jsonb,
          'seria godzinowa nie zależy od strefy sesji (UTC+14)');
set local timezone = 'Etc/GMT+12';
select is(public.analityka_panel_przeglad('2026-10-26 13:30:00+00'), (select j from przeglad_t),
          'przegląd nie zależy od strefy sesji (UTC-12)');
select is(pg_temp.a($q$select * from public.analityka_panel_seria_dzienna('2026-10-26 13:30:00+00', 6)$q$),
          '[["2026-10-22",5,0,0],["2026-10-23",1,1,0],["2026-10-24",100,50,7],["2026-10-25",11,7,2],["2026-10-26",10,9,6]]'::jsonb,
          'seria dzienna nie zależy od strefy sesji (UTC-12)');
reset timezone;

-- ===================================================================
-- C. SWIAT S: 18 sesji z 15.09.2026 (teraz = 20:00:00Z, okno 1 doba = od 14.09 22:00Z do 15.09 22:00Z)
-- ===================================================================

-- Kanaly (wizyty = sesje, odslony = wszystkie odslony tych sesji), zob. tabela sesji przy danych:
--   wyszukiwarka: A(3) B(1) E(2) P(2) Q1(1) = 5 wizyt, 9 odslon        bezposrednie: I(1) J1(2) J2(2) Q2(1) = 4, 6
--   kampania: F(1) G(1) H(3) = 3, 5      odeslanie: K(1) L(2) M(1) = 3, 4      social: C(2) D(1) = 2, 3      ai: N(2) = 1, 2
--   J2 i Q2 zaczynaja sie odslona WEWNETRZNA (powrot po > 30 min) → liczą się jako bezposrednie, nie jako wejście.
--   Kolejnosc: wizyty malejaco, remis (kampania/odeslanie po 3) po nazwie.
select is(pg_temp.a($q$select * from public.analityka_panel_kanaly('2026-09-15 20:00:00+00', 1)$q$),
          '[["wyszukiwarka",5,9],["bezposrednie",4,6],["kampania",3,5],["odeslanie",3,4],["social",2,3],["ai",1,2]]'::jsonb,
          'kanały: 18 wizyt i 29 odsłon wg kanału z pierwszej odsłony; sesja zaczęta odsłoną wewnętrzną = bezposrednie');
select is(pg_temp.a($q$select * from public.analityka_panel_kanaly('2026-09-15 20:00:00+00', null)$q$),
          pg_temp.a($q$select * from public.analityka_panel_kanaly('2026-09-15 20:00:00+00', 1)$q$),
          'kanały: NULL → domyślne 7 dób (to samo, bo wcześniej nie było ruchu)');
select is(pg_temp.a($q$select * from public.analityka_panel_kanaly('2026-09-15 20:00:00+00', 1000)$q$),
          pg_temp.a($q$select * from public.analityka_panel_kanaly('2026-09-15 20:00:00+00', 1)$q$),
          'kanały: p_dni ponad 30 przycinane do 30');

-- Zrodla: zrodlo = utm_source, gdy go brak host referera, gdy i go brak nazwa click-id, inaczej (bezpośrednie);
--   sciezka = sciezka referera lub (brak). Kolejnosc: wizyty malejaco, potem kanal, zrodlo, sciezka (bajtowo).
select is(pg_temp.a($q$select * from public.analityka_panel_zrodla('2026-09-15 20:00:00+00', 1, 50)$q$),
          '[["bezposrednie","(bezpośrednie)","(brak)",4],["wyszukiwarka","google.com","(brak)",4],["odeslanie","blog.example.pl","/post/12",2],["ai","chatgpt.com","(brak)",1],["kampania","gclid","(brak)",1],["kampania","google","(brak)",1],["kampania","newsletter","(brak)",1],["odeslanie","forum.example.pl","/t/7",1],["social","facebook","(brak)",1],["social","facebook.com","/groups/rodzice/posts/123",1],["wyszukiwarka","bing.com","(brak)",1]]'::jsonb,
          'źródła: utm_source przed hostem, host przed click-id, ścieżka posta tylko gdy jest; suma 4+4+2+8 = 18');
select is(pg_temp.a($q$select * from public.analityka_panel_zrodla('2026-09-15 20:00:00+00', 1, 3)$q$),
          '[["bezposrednie","(bezpośrednie)","(brak)",4],["wyszukiwarka","google.com","(brak)",4],["odeslanie","blog.example.pl","/post/12",2]]'::jsonb,
          'źródła: p_limit = 3 → trzy pierwsze pozycje');
select is((select count(*) from public.analityka_panel_zrodla('2026-09-15 20:00:00+00', 1, 0)),
          1::bigint, 'źródła: p_limit = 0 przycinane do 1');
select is((select count(*) from public.analityka_panel_zrodla('2026-09-15 20:00:00+00', 1, null)),
          11::bigint, 'źródła: p_limit NULL → domyślne 50 (wszystkie 11 pozycji)');

-- Kampanie: sesje ze znacznikiem UTM: C (facebook/social/jesien), F (google/cpc/jesien_ads), H (newsletter/email/jesien);
--   G ma tylko click-id (bez UTM), D przyszla z hosta – nie sa kampaniami UTM. Okno domyslne 30 dob.
select is(pg_temp.a($q$select * from public.analityka_panel_kampanie('2026-09-15 20:00:00+00', null)$q$),
          '[["facebook","social","jesien",1],["google","cpc","jesien_ads",1],["newsletter","email","jesien",1]]'::jsonb,
          'kampanie: trzy trójki UTM po jednej wizycie; click-id bez UTM nie jest kampanią UTM');

-- Kraje (kraj pierwszej odslony): PL 12 (A B C D E F G H J1 J2 K L), US 3 (P Q1 Q2), DE 2 (M N), brak kraju (I) = 1
select is(pg_temp.a($q$select * from public.analityka_panel_kraje('2026-09-15 20:00:00+00', 1)$q$),
          '[["PL",12],["US",3],["DE",2],["(nieznany)",1]]'::jsonb, 'kraje: brak kraju to osobna pozycja (nieznany); suma 18');
-- Urzadzenia: mobile 5 (A C D G M), tablet 1 (I), desktop 12
select is(pg_temp.a($q$select * from public.analityka_panel_urzadzenia('2026-09-15 20:00:00+00', 1)$q$),
          '[["desktop",12],["mobile",5],["tablet",1]]'::jsonb, 'urządzenia: desktop 12, mobile 5, tablet 1; suma 18');

-- Sesje: 18 sesji, 29 odslon.  Stron: 9 jedynek, 7 dwojek, 2 trojki → mediana z pozycji 8,5 = (1+2)/2 = 1,5; srednia 29/18 = 1,61.
--   Czas sesji (s): 0,0,0,0, 3, 5, 8, 10, 20, 60, 60, 70, 70, 80, 90, 100, 195, 210 → mediana (20+60)/2 = 40;
--   p75: pozycja 0,75 × 17 = 12,75 → 70 + 0,75 × (80 − 70) = 77,5.
--   Zaangazowane (>= 2 odslony albo >= 30 s): A C D(60 s) E H J1 J2 K(60 s) L N P = 11;  jednostronicowe: B D F G I K M Q1 Q2 = 9.
select is(public.analityka_panel_sesje_przeglad('2026-09-15 20:00:00+00', 1),
          '{"sesje":18,"odslony":29,"mediana_stron":1.5,"srednia_stron":1.61,"mediana_czas_s":40.0,"p75_czas_s":77.5,"zaangazowane":11,"jednostronicowe":9}'::jsonb,
          'sesje: 18 sesji, mediana stron 1,5, średnia 1,61, mediana czasu 40 s, p75 77,5 s, 11 zaangażowanych, 9 jednostronicowych');
select is(public.analityka_panel_sesje_przeglad('2026-09-15 20:00:00+00', 1000),
          public.analityka_panel_sesje_przeglad('2026-09-15 20:00:00+00', 1), 'sesje: p_dni ponad 30 przycinane do 30');
select is(public.analityka_panel_sesje_przeglad('2026-09-15 20:00:00+00', 0),
          public.analityka_panel_sesje_przeglad('2026-09-15 20:00:00+00', 1), 'sesje: p_dni = 0 przycinane do 1');
select is(public.analityka_panel_sesje_przeglad('2026-01-01 12:00:00+00', 1),
          '{"sesje":0,"odslony":0,"mediana_stron":null,"srednia_stron":null,"mediana_czas_s":null,"p75_czas_s":null,"zaangazowane":0,"jednostronicowe":0}'::jsonb,
          'sesje bez ruchu: statystyki null (nie 0), liczności 0');

-- Przejscia: pary ekran → nastepny ekran (po jednej na odslone, wyjscie = (wyjście)); suma 29.
select is(pg_temp.a($q$select * from public.analityka_panel_przejscia('2026-09-15 20:00:00+00', 1, 60)$q$),
          '[["okolica","(wyjście)",7],["szukaj","(wyjście)",6],["szukaj","okolica",5],["metoda","(wyjście)",2],["okolica","porownanie",2],["porownanie","(wyjście)",2],["katalog","(wyjście)",1],["katalog","okolica",1],["okolica","okolica",1],["szukaj","katalog",1],["szukaj","metoda",1]]'::jsonb,
          'przejścia: 11 par, wyjście jako cel, remisy po nazwach (bajtowo: nawias przed literą)');
select is(pg_temp.a($q$select * from public.analityka_panel_przejscia('2026-09-15 20:00:00+00', 1, 3)$q$),
          '[["okolica","(wyjście)",7],["szukaj","(wyjście)",6],["szukaj","okolica",5]]'::jsonb, 'przejścia: p_limit = 3');

-- Sciezki (pierwsze trzy ekrany sesji, brak = (wyjście)): suma 18
select is(pg_temp.a($q$select * from public.analityka_panel_sciezki('2026-09-15 20:00:00+00', 1, 30)$q$),
          '[["szukaj","(wyjście)","(wyjście)",6],["szukaj","okolica","(wyjście)",3],["okolica","(wyjście)","(wyjście)",2],["katalog","okolica","(wyjście)",1],["metoda","(wyjście)","(wyjście)",1],["okolica","porownanie","(wyjście)",1],["szukaj","katalog","(wyjście)",1],["szukaj","metoda","(wyjście)",1],["szukaj","okolica","okolica",1],["szukaj","okolica","porownanie",1]]'::jsonb,
          'ścieżki: 10 trójek, krótsza sesja dopełniona (wyjście)');

-- Punkt urwania: ostatnia odslona sesji + ostatnia widziana sekcja (najwyzsza pozycja z ms > 0); suma 18.
--   A porownanie/podsumowanie, B F G szukaj/hero, C D H okolica/kategorie, E okolica/(brak pomiaru) – brak wyjscia,
--   I szukaj/(brak pomiaru) – wyjscie bez widzianej sekcji, J1 metoda/zrodla, J2 L M okolica/etykieta, K metoda/intro,
--   N porownanie/tabela, P katalog/(brak pomiaru), Q1 Q2 szukaj/(brak pomiaru)
select is(pg_temp.a($q$select * from public.analityka_panel_punkt_urwania('2026-09-15 20:00:00+00', 1, 30)$q$),
          '[["okolica","etykieta",3],["okolica","kategorie",3],["szukaj","(brak pomiaru)",3],["szukaj","hero",3],["katalog","(brak pomiaru)",1],["metoda","intro",1],["metoda","zrodla",1],["okolica","(brak pomiaru)",1],["porownanie","podsumowanie",1],["porownanie","tabela",1]]'::jsonb,
          'punkt urwania: (ekran, ostatnia widziana sekcja), brak pomiaru jako osobna pozycja, suma 18');

-- Sekcje: odslony_z_sekcja = wyjscia, w ktorych sekcja miala ms > 0; odslony_ekranu = wyjscia ekranu z pomiarem sekcji
--   (szukaj: 10 – razem z wyjsciem I, ktore ma tylko hero z 0 ms); mediany po wyjsciach, w ktorych sekcja byla widziana.
--   okolica etykieta: 30,40,30,60,30,40,60,20,30 tys. → posortowane 20,30,30,30,30,40,40,60,60 → mediana (5.) 30000
--   okolica kategorie: 60,40,30,40,30 → 30,30,40,40,60 → 40000;  zrodla: 30 i 20 tys. → 25000;  mapa (0 ms) – nie ma wiersza
--   szukaj hero (9 z 10): 3,5,8,10,10,15,15,20,20 tys. → 10000;  wyniki: 10 i 5 tys. → 7500
select is(pg_temp.a($q$select * from public.analityka_panel_sekcje('2026-09-15 20:00:00+00', 1, null)$q$),
          '[["katalog","lista",1,1,30000,0],["metoda","intro",2,2,45000,0],["metoda","zrodla",1,2,30000,1],["okolica","etykieta",9,9,30000,0],["okolica","kategorie",5,9,40000,1],["okolica","zrodla",2,9,25000,2],["porownanie","tabela",2,2,55000,0],["porownanie","podsumowanie",1,2,10000,1],["szukaj","hero",9,10,10000,0],["szukaj","wyniki",2,10,7500,1]]'::jsonb,
          'sekcje: zasięg liczony wobec wyjść z pomiarem sekcji, sekcje z 0 ms bez wiersza, mediany po wyjściach z widzianą sekcją');
select is(pg_temp.a($q$select * from public.analityka_panel_sekcje('2026-09-15 20:00:00+00', 1, 'okolica')$q$),
          '[["okolica","etykieta",9,9,30000,0],["okolica","kategorie",5,9,40000,1],["okolica","zrodla",2,9,25000,2]]'::jsonb,
          'sekcje: filtr ekranu zostawia tylko jego sekcje (mianownik bez zmian)');

-- CTA po sekcji (suma ekspozycji i klikniec z kolumny cta wyjsc):
--   okolica etykieta: e 3+2+1+4+2+1 = 13, n 1;  szukaj hero: e 3+1+1+1+1 = 7, n 1+1 = 2;  katalog lista: 5/0;
--   porownanie tabela: 2/1;  okolica zrodla: 1/0
select is(pg_temp.a($q$select * from public.analityka_panel_cta_sekcje('2026-09-15 20:00:00+00', 1, null)$q$),
          '[["okolica","etykieta",13,1],["szukaj","hero",7,2],["katalog","lista",5,0],["porownanie","tabela",2,1],["okolica","zrodla",1,0]]'::jsonb,
          'CTA po sekcjach: wyświetlenia i kliknięcia z wyjść, wyświetlenia malejąco');
select is(pg_temp.a($q$select * from public.analityka_panel_cta_sekcje('2026-09-15 20:00:00+00', 1, 'szukaj')$q$),
          '[["szukaj","hero",7,2]]'::jsonb, 'CTA po sekcjach: filtr ekranu');

-- Sygnaly UX: klik typu furia / martwy, na ekran; mianownik = odslony ekranu (szukaj 15 = 13 z sesji + 2 bez odcisku,
--   okolica 11 = 10 z sesji + 1 bez odcisku); rodzaj „przycisk”, zle etykiety i boty pominiete
select is(pg_temp.a($q$select * from public.analityka_panel_ux_sygnaly('2026-09-15 20:00:00+00', 1)$q$),
          '[["szukaj","martwy",4,15],["okolica","furia",3,11],["okolica","martwy",2,11],["szukaj","furia",1,15]]'::jsonb,
          'sygnały UX: furia i martwy na ekran z odsłonami ekranu jako mianownikiem');

-- Top ekrany (odslony ludzi, tez bez odcisku; unikalni = rozne odciski w obrebie ekranu)
--   szukaj 13 + 2 = 15 odslon, 12 odciskow;  okolica 10 + 1 = 11, 9;  katalog 2/2, metoda 2/2, porownanie 2/2
select is(pg_temp.a($q$select * from public.analityka_panel_top_ekrany('2026-09-15 20:00:00+00', 1)$q$),
          '[["szukaj",15,12],["okolica",11,9],["katalog",2,2],["metoda",2,2],["porownanie",2,2]]'::jsonb,
          'top ekrany: odsłony (z bez-odciskowymi) i unikalni w obrębie ekranu');
-- Top adresy: /adres/a-1 = A2, E2, M, N3 (bez odcisku) = 4 odslony, 3 unikalni; pozostale po 1
select is(pg_temp.a($q$select * from public.analityka_panel_top_adresy('2026-09-15 20:00:00+00', 1, 50)$q$),
          '[["/adres/a-1",4,3],["/adres/c-3",1,1],["/adres/d-4",1,1],["/adres/h-8",1,1],["/adres/h-9",1,1],["/adres/j-10",1,1],["/adres/l-12",1,1],["/adres/n-13",1,1]]'::jsonb,
          'top adresy: karty adresów wg ścieżki, unikalni w obrębie wiersza');
select is(pg_temp.a($q$select * from public.analityka_panel_top_adresy('2026-09-15 20:00:00+00', 1, 3)$q$),
          '[["/adres/a-1",4,3],["/adres/c-3",1,1],["/adres/d-4",1,1]]'::jsonb, 'top adresy: p_limit = 3');

-- Lejek 10 → 6 → 2 (+ warstwa mapy 2, tryb Biznes 2); kroki niezalezne: N ma karte bez wyszukania;
--   zdarzenie sierota J (12:35:00, miedzy sesjami), zdarzenie P 1 s po koncu przedzialu, bot i odcisk bez odslon – poza
select is(pg_temp.a($q$select * from public.analityka_panel_lejek('2026-09-15 20:00:00+00', 1)$q$),
          '[["wyszukanie",1,10],["karta_adresu",2,6],["porownanie_dodaj",3,2],["warstwa_mapy",4,2],["tryb_biznes",5,2]]'::jsonb,
          'lejek: 10 wyszukań → 6 kart → 2 porównania, kroki niezależne, granica przedziału sesji włączna');
select is((select count(*) from public.analityka_panel_lejek('2026-01-01 12:00:00+00', 1)),
          5::bigint, 'lejek bez ruchu: nadal pięć wierszy (z zerami)');

-- Udostepnienia (element × kanal), brak etykiety = (bez znacznika), brak kanalu = (nieznany); boty pominiete
select is(pg_temp.a($q$select * from public.analityka_panel_udostepnienia('2026-09-15 20:00:00+00', 30)$q$),
          '[["karta","link",3],["karta","kopia",2],["porownanie","natywne",2],["(bez znacznika)","blad",1],["karta","(nieznany)",1],["karta","anulowano",1]]'::jsonb,
          'udostępnienia: element × kanał, anulowano zachowane, braki jako osobne pozycje');

-- Wyszukiwania bez wyniku: „ul. długa 5” (3 zapisy po normalizacji, ostatni 10:00), [odrzucono] x2 (ostatni 13:10),
--   „abc 1” x2 (ostatni 12:00), „xyz” x1 (11:00), „na krawedzi” (16.08 22:00:00Z = pierwsza chwila okna 30 dob);
--   pomijane: pusta fraza, wlasciwosci NULL, bot, „poza oknem” (16.08 21:59:59Z)
select is(pg_temp.a($q$select fraza, ile, public.analityka_iso(ostatnio) from public.analityka_panel_bez_wyniku('2026-09-15 20:00:00+00', 30, 100)$q$),
          '[["ul. długa 5",3,"2026-09-15T10:00:00Z"],["[odrzucono]",2,"2026-09-15T13:10:00Z"],["abc 1",2,"2026-09-15T12:00:00Z"],["xyz",1,"2026-09-15T11:00:00Z"],["na krawedzi",1,"2026-08-16T22:00:00Z"]]'::jsonb,
          'bez wyniku: normalizacja frazy, odrzucone jako osobna pozycja, granica okna 30 dób włączna od dołu');
select is((select count(*) from public.analityka_panel_bez_wyniku('2026-09-15 20:00:00+00', 1, 100)),
          4::bigint, 'bez wyniku 1 doba: bez pozycji sprzed doby');
select is(pg_temp.a($q$select fraza, ile from public.analityka_panel_bez_wyniku('2026-09-15 20:00:00+00', 30, 2)$q$),
          '[["ul. długa 5",3],["[odrzucono]",2]]'::jsonb, 'bez wyniku: p_limit = 2');

-- Web Vitals p75 (ms; CLS ulamek): okolica lcp 20 pomiarow 1000..2900 co 100 → pozycja 0,75 × 19 = 14,25 → 2400 + 0,25 × 100 = 2425;
--   inp 100/200/400 → pozycja 1,5 → 300;  cls 0,01 0,02 0,03 0,04 0,10 → pozycja 3 → 0,04;
--   szukaj lcp 800 900 1000 3000 → pozycja 2,25 → 1000 + 0,25 × 2000 = 1500;  fcp 500/700 → 650;  ttfb 120
select is(pg_temp.a($q$select * from public.analityka_panel_witale('2026-09-15 20:00:00+00', 7)$q$),
          '[["okolica","lcp",2425.000,20],["okolica","inp",300.000,3],["okolica","cls",0.040,5],["szukaj","lcp",1500.000,4],["szukaj","fcp",650.000,2],["szukaj","ttfb",120.000,1]]'::jsonb,
          'witale: p75 na ekran i metrykę z liczbą próbek, stała kolejność metryk, bot pominięty');

-- Bledy: TypeError (okolica) x4 ostatni 14:00, Network error (okolica) x2 ostatni 13:30, TypeError (szukaj) x1 12:00
select is(pg_temp.a($q$select komunikat, ekran, ile, public.analityka_iso(ostatnio) from public.analityka_panel_bledy('2026-09-15 20:00:00+00', 7, 50)$q$),
          '[["TypeError: x is undefined","okolica",4,"2026-09-15T14:00:00Z"],["Network error","okolica",2,"2026-09-15T13:30:00Z"],["TypeError: x is undefined","szukaj",1,"2026-09-15T12:00:00Z"]]'::jsonb,
          'błędy: grupowanie po komunikacie i ekranie, bot pominięty');
select is(pg_temp.a($q$select komunikat, ekran from public.analityka_panel_bledy('2026-09-15 20:00:00+00', 7, 2)$q$),
          '[["TypeError: x is undefined","okolica"],["Network error","okolica"]]'::jsonb, 'błędy: p_limit = 2');

-- Boty na swiecie S: jedna odslona gptbot
select is(pg_temp.a($q$select rodzina, klasa, odslony, public.analityka_iso(ostatnio) from public.analityka_panel_boty_ai('2026-09-15 20:00:00+00', 1)$q$),
          '[["gptbot","ai",1,"2026-09-15T08:00:00Z"]]'::jsonb, 'boty (świat S): jedna odsłona gptbot');

-- Inwarianty: kazda sesja w dokladnie jednym kanale / kraju / urzadzeniu / punkcie urwania; odslony zgodne ze sciezkami i przejsciami
select is((select sum(wizyty) from public.analityka_panel_kanaly('2026-09-15 20:00:00+00', 1)),
          (public.analityka_panel_sesje_przeglad('2026-09-15 20:00:00+00', 1) ->> 'sesje')::numeric, 'inwariant: suma wizyt po kanałach = liczba sesji');
select is((select sum(wizyty) from public.analityka_panel_kraje('2026-09-15 20:00:00+00', 1)),
          (public.analityka_panel_sesje_przeglad('2026-09-15 20:00:00+00', 1) ->> 'sesje')::numeric, 'inwariant: suma wizyt po krajach = liczba sesji');
select is((select sum(wizyty) from public.analityka_panel_urzadzenia('2026-09-15 20:00:00+00', 1)),
          (public.analityka_panel_sesje_przeglad('2026-09-15 20:00:00+00', 1) ->> 'sesje')::numeric, 'inwariant: suma wizyt po urządzeniach = liczba sesji');
select is((select sum(wizyty) from public.analityka_panel_zrodla('2026-09-15 20:00:00+00', 1, 200)),
          (public.analityka_panel_sesje_przeglad('2026-09-15 20:00:00+00', 1) ->> 'sesje')::numeric, 'inwariant: suma wizyt po źródłach = liczba sesji');
select is((select sum(odslony) from public.analityka_panel_kanaly('2026-09-15 20:00:00+00', 1)),
          (public.analityka_panel_sesje_przeglad('2026-09-15 20:00:00+00', 1) ->> 'odslony')::numeric, 'inwariant: suma odsłon po kanałach = odsłony w sesjach');
select is((select sum(sesje) from public.analityka_panel_punkt_urwania('2026-09-15 20:00:00+00', 1, 200)),
          (public.analityka_panel_sesje_przeglad('2026-09-15 20:00:00+00', 1) ->> 'sesje')::numeric, 'inwariant: suma po punktach urwania = liczba sesji');
select is((select sum(sesje) from public.analityka_panel_sciezki('2026-09-15 20:00:00+00', 1, 200)),
          (public.analityka_panel_sesje_przeglad('2026-09-15 20:00:00+00', 1) ->> 'sesje')::numeric, 'inwariant: suma po ścieżkach = liczba sesji');
select is((select sum(ile) from public.analityka_panel_przejscia('2026-09-15 20:00:00+00', 1, 200)),
          (public.analityka_panel_sesje_przeglad('2026-09-15 20:00:00+00', 1) ->> 'odslony')::numeric, 'inwariant: suma przejść = odsłony w sesjach');


-- ===================================================================
-- D. SWIAT C (martwe CTA, 17.09) i SWIAT D (diagnostyka, 20.09)
-- ===================================================================

-- Martwe CTA (>= 50 wyswietlen i 0 klikniec): katalog lista/otworz 5000 → obciete do 1000; okolica etykieta/porownaj 100;
--   metoda „bez-separatora” 70 (cel = (brak)); szukaj baner/zapisz 30+30 = 60; okolica baner/zapisz 55; szukaj menu/mapa 50 (granica
--   włączna).  Poza: stopka/kontakt 20+29 = 49 (bot z 1000 nie liczy sie), hero/szukaj 80 ale z 3 kliknieciami; elementy zepsute pominiete.
select is(pg_temp.a($q$select * from public.analityka_panel_cta_martwe('2026-09-17 20:00:00+00', 1, 50)$q$),
          '[["katalog","lista","otworz",1000],["okolica","etykieta","porownaj",100],["metoda","bez-separatora","(brak)",70],["szukaj","baner","zapisz",60],["okolica","baner","zapisz",55],["szukaj","menu","mapa",50]]'::jsonb,
          'martwe CTA: próg 50 włączny, element z kliknięciami i z 49 wyświetleniami poza listą, bot i elementy zepsute pominięte');
select is(pg_temp.a($q$select * from public.analityka_panel_cta_martwe('2026-09-17 20:00:00+00', 1, null)$q$),
          pg_temp.a($q$select * from public.analityka_panel_cta_martwe('2026-09-17 20:00:00+00', 1, 50)$q$),
          'martwe CTA: p_min NULL → domyślne 50');
select is(pg_temp.a($q$select * from public.analityka_panel_cta_martwe('2026-09-17 20:00:00+00', 1, 100)$q$),
          '[["katalog","lista","otworz",1000],["okolica","etykieta","porownaj",100]]'::jsonb, 'martwe CTA: p_min = 100');
select is(pg_temp.a($q$select * from public.analityka_panel_cta_sekcje('2026-09-17 20:00:00+00', 1, null)$q$),
          '[["katalog","lista",1000,0],["okolica","etykieta",100,0],["szukaj","hero",80,3],["metoda","bez-separatora",70,0],["szukaj","baner",60,0],["okolica","baner",55,0],["szukaj","menu",50,0],["szukaj","stopka",49,0]]'::jsonb,
          'CTA po sekcjach (świat C): wyświetlenia obcięte do 1000 na element, hero z 3 kliknięciami');
select is(pg_temp.a($q$select * from public.analityka_panel_cta_sekcje('2026-09-17 20:00:00+00', 1, 'szukaj')$q$),
          '[["szukaj","hero",80,3],["szukaj","baner",60,0],["szukaj","menu",50,0],["szukaj","stopka",49,0]]'::jsonb,
          'CTA po sekcjach: filtr ekranu szukaj');

-- Diagnostyka (teraz 20.09 12:00Z; okno 24 h = (19.09 12:00Z, 20.09 12:00Z]): odslony 3, wyjscia 2, klik 1, produktowe 2, wital 1,
--   udostepnien i bledow 0 (maja byc widoczne jako zera); bez odcisku: odslona 09:10 i wital 09:07 = 2;
--   ostatnie zdarzenie czlowieka ≤ teraz: 09:10 (bot 11:59 i odslona 12:30 po „teraz” nie licza sie);
--   najstarsze zdarzenie czlowieka w tabeli: 16.08 21:59:59Z (swiat S); dni w zestawieniu: 22, 24, 25, 26.10 = 4
select is(public.analityka_panel_diagnostyka('2026-09-20 12:00:00+00') -> 'zdarzenia_24h',
          '{"odslona":3,"wyjscie":2,"klik":1,"udostepnienie":0,"produktowe":2,"wital":1,"blad":0}'::jsonb,
          'diagnostyka: zawsze wszystkie siedem typów, zero = cisza danego typu');
select is(public.analityka_panel_diagnostyka('2026-09-20 12:00:00+00') ->> 'bez_odcisku_24h', '2',
          'diagnostyka: zdarzenia bez odcisku w 24 h (ta sama populacja co suma typów)');
select is(public.analityka_panel_diagnostyka('2026-09-20 12:00:00+00') ->> 'ostatnie_zdarzenie', '2026-09-20T09:10:00Z',
          'diagnostyka: ostatnie zdarzenie człowieka nie przekracza „teraz” i nie uwzględnia botów');
select is(public.analityka_panel_diagnostyka('2026-09-20 12:00:00+00') ->> 'najstarsze_zdarzenie', '2026-08-16T21:59:59Z',
          'diagnostyka: najstarsze zdarzenie człowieka w tabeli');
select is(public.analityka_panel_diagnostyka('2026-09-20 12:00:00+00') -> 'ostatni_bieg',
          '{"rodzaj":"zestaw","koniec":"2026-09-20T01:20:30Z","blad":"błąd testowy"}'::jsonb,
          'diagnostyka: ostatni bieg = najnowszy po starcie, z błędem');
select is(public.analityka_panel_diagnostyka('2026-09-20 12:00:00+00') ->> 'dni_w_zestawieniu', '4',
          'diagnostyka: liczba różnych dób w zestawieniu dziennym');
select is(public.analityka_panel_diagnostyka('2026-01-01 12:00:00+00') - 'ostatni_bieg' - 'dni_w_zestawieniu',
          '{"ostatnie_zdarzenie":null,"zdarzenia_24h":{"odslona":0,"wyjscie":0,"klik":0,"udostepnienie":0,"produktowe":0,"wital":0,"blad":0},"bez_odcisku_24h":0,"najstarsze_zdarzenie":null}'::jsonb,
          'diagnostyka bez zdarzeń: wszystkie typy 0, daty null');
-- ostatni_bieg: najnowszy wiersz Z BLEDEM z ostatnich 26 h, a gdy takiego nie ma – najnowszy wiersz.
-- Nocny bieg zapisuje trzy wiersze (sprzatanie, zestaw przedwczoraj, zestaw wczoraj), wiec bez tej reguly
-- blad wczesniejszego kroku znikalby pod poprawnym ostatnim. „Teraz” = 20.09 12:00Z, 26 h wstecz = 19.09 10:00:00Z.
-- (a) blad sprzatania 3 h temu + dwa poprawne kroki pozniej → pokazany blad
delete from public.analityka_biegi;
insert into public.analityka_biegi (rodzaj, start, koniec, wynik, blad) values
  ('sprzatanie', '2026-09-20 09:00:00+00', '2026-09-20 09:00:10+00', null, 'sprzątanie: błąd zapisu'),
  ('zestaw', '2026-09-20 09:01:00+00', '2026-09-20 09:01:30+00', '{}'::jsonb, null),
  ('zestaw', '2026-09-20 09:02:00+00', '2026-09-20 09:02:30+00', '{}'::jsonb, null);
select is(public.analityka_panel_diagnostyka('2026-09-20 12:00:00+00') -> 'ostatni_bieg',
          '{"rodzaj":"sprzatanie","koniec":"2026-09-20T09:00:10Z","blad":"sprzątanie: błąd zapisu"}'::jsonb,
          'ostatni_bieg: błąd wcześniejszego kroku z ostatnich 26 h nie ginie pod poprawnym, nowszym biegiem');
-- (b) blad starszy niz 26 h (30 h temu) nie przeslania nowszego poprawnego biegu
delete from public.analityka_biegi;
insert into public.analityka_biegi (rodzaj, start, koniec, wynik, blad) values
  ('zestaw', '2026-09-19 06:00:00+00', '2026-09-19 06:00:20+00', null, 'stary błąd'),
  ('zestaw', '2026-09-20 10:00:00+00', '2026-09-20 10:00:30+00', '{}'::jsonb, null);
select is(public.analityka_panel_diagnostyka('2026-09-20 12:00:00+00') -> 'ostatni_bieg',
          '{"rodzaj":"zestaw","koniec":"2026-09-20T10:00:30Z","blad":null}'::jsonb,
          'ostatni_bieg: błąd sprzed ponad 26 h nie przesłania nowszego poprawnego biegu');
-- (b2) granica 26 h jest wylaczna: blad dokladnie 26 h temu odpada, blad o sekunde mlodszy wchodzi
delete from public.analityka_biegi;
insert into public.analityka_biegi (rodzaj, start, koniec, wynik, blad) values
  ('zestaw', '2026-09-19 10:00:00+00', '2026-09-19 10:00:20+00', null, 'dokładnie 26 h temu'),
  ('zestaw', '2026-09-20 10:00:00+00', '2026-09-20 10:00:30+00', '{}'::jsonb, null);
select is(public.analityka_panel_diagnostyka('2026-09-20 12:00:00+00') -> 'ostatni_bieg' ->> 'blad', null::text,
          'ostatni_bieg: błąd dokładnie 26 h temu jest już poza oknem (granica wyłączna)');
update public.analityka_biegi set start = '2026-09-19 10:00:01+00', koniec = '2026-09-19 10:00:21+00' where blad is not null;
select is(public.analityka_panel_diagnostyka('2026-09-20 12:00:00+00') -> 'ostatni_bieg' ->> 'blad', 'dokładnie 26 h temu',
          'ostatni_bieg: błąd młodszy o sekundę niż 26 h jest w oknie');
-- (d) kilka bledow w oknie → najnowszy z nich, a nie najstarszy ani poprawny
delete from public.analityka_biegi;
insert into public.analityka_biegi (rodzaj, start, koniec, wynik, blad) values
  ('zestaw', '2026-09-20 02:00:00+00', '2026-09-20 02:00:20+00', null, 'błąd A'),
  ('zestaw', '2026-09-20 07:00:00+00', '2026-09-20 07:00:20+00', null, 'błąd B'),
  ('zestaw', '2026-09-20 11:00:00+00', '2026-09-20 11:00:20+00', '{}'::jsonb, null);
select is(public.analityka_panel_diagnostyka('2026-09-20 12:00:00+00') -> 'ostatni_bieg' ->> 'blad', 'błąd B',
          'ostatni_bieg: przy kilku błędach w oknie wygrywa najnowszy z błędem');
-- (c) brak biegow → null
delete from public.analityka_biegi;
select is(public.analityka_panel_diagnostyka('2026-09-20 12:00:00+00') -> 'ostatni_bieg', 'null'::jsonb,
          'diagnostyka bez żadnego biegu zestawienia: ostatni_bieg = null');


-- ===================================================================
-- G. SWIAT G: granice 30 minut (sklejanie sesji i dopasowanie wyjscia)
-- ===================================================================
-- a1: odslony 10:00:00 i 10:30:00 (luka dokladnie 30 min = jedna sesja), a2: 10:00:00 i 10:30:01 (dwie sesje),
-- a3: odslona 11:00:00 + wyjscie 11:30:00 (5000 ms), a4: odslona 11:00:00 + wyjscie 11:30:01 (7000 ms, poza granica).
-- Sesji 5 (a1, a2 x2, a3, a4), odslon 6; stron: 2,1,1,1,1 → mediana 1, srednia 6/5 = 1,2; czas sesji: tylko a3 = 5 s →
-- mediana i p75 = 0; zaangazowana tylko a1 (2 odslony), jednostronicowych 4.
select is(public.analityka_panel_sesje_przeglad('2026-09-18 20:00:00+00', 1),
          '{"sesje":5,"odslony":6,"mediana_stron":1,"srednia_stron":1.2,"mediana_czas_s":0,"p75_czas_s":0,"zaangazowane":1,"jednostronicowe":4}'::jsonb,
          'granice: luka dokładnie 30 min to jedna sesja, 30 min 1 s – dwie (5 sesji, 6 odsłon)');
select is((select w.czas_ms from public.analityka_panel_wyjscia('2026-09-17 22:00:00+00', '2026-09-18 22:00:00+00', false, false) w
            where w.sesja like 'e8000000000000a3-%'),
          5000, 'granice: wyjście dokładnie 30 min po ostatniej odsłonie nadal do niej należy');
select is((select w.czas_ms from public.analityka_panel_wyjscia('2026-09-17 22:00:00+00', '2026-09-18 22:00:00+00', false, false) w
            where w.sesja like 'e8000000000000a4-%'),
          null::integer, 'granice: wyjście 30 min 1 s po ostatniej odsłonie do niej nie należy');
-- ===================================================================
-- E. Rownowaznosc admin_*(…) z analityka_panel_*(now(), …)
-- ===================================================================
-- Dotad testowalismy rdzenie z jawnym czasem. Publiczne funkcje maja tylko dolozyc bramke i now(); zeby to
-- sprawdzic (w tym KOLEJNOSC parametrow p_dni / p_limit / p_min / p_ekran, ktora latwo pomylic), potrzebny jest
-- ruch w oknie liczonym od PRAWDZIWEGO now(). Swiat W: trzy sesje sprzed 16–50 minut + zdarzenia pomocnicze,
-- wstawiane DOPIERO TERAZ, zeby nie zmienic liczb swiatow stalych (ktorych okna 30 dob moglyby objac "dzis").
-- Wrappery wolamy z oknem >= 2 dob, wiec test nie psuje sie tuz po polnocy.
alter table public.zdarzenia disable trigger zdarzenia_przed_insert;

do $d$
declare
  w1 constant text := 'e9000000000000a1';
  w2 constant text := 'e9000000000000a2';
  w3 constant text := 'e9000000000000a3';
begin
  -- W1: google, mobile, PL: szukaj → okolica (/adres/w-1)
  perform pg_temp.pv(now() - interval '50 minutes', w1, 'szukaj', '/', 'wyszukiwarka', 'mobile', 'PL', 'google.com');
  perform pg_temp.ex(now() - interval '49 minutes', w1, 'szukaj', '/', 10000, 20::smallint,
    '[{"k":"hero","ms":10000,"p":0}]', '[{"k":"baner§zapisz","e":4,"n":0},{"k":"stopka§kontakt","e":3,"n":0}]');
  perform pg_temp.pv(now() - interval '48 minutes', w1, 'okolica', '/adres/w-1', 'wewnetrzne', 'mobile');
  perform pg_temp.ex(now() - interval '47 minutes', w1, 'okolica', '/adres/w-1', 20000, 40::smallint,
    '[{"k":"etykieta","ms":20000,"p":0}]', null);
  -- W2: facebook (UTM), desktop, DE: szukaj → porownanie
  perform pg_temp.pv(now() - interval '40 minutes', w2, 'szukaj', '/', 'social', 'desktop', 'DE',
    'facebook.com', '/groups/x/posts/1', 'facebook', 'social', 'w1');
  perform pg_temp.pv(now() - interval '39 minutes', w2, 'porownanie', '/porownanie', 'wewnetrzne', 'desktop', 'DE');
  perform pg_temp.ex(now() - interval '38 minutes', w2, 'porownanie', '/porownanie', 30000, 60::smallint,
    '[{"k":"tabela","ms":30000,"p":0}]', '[{"k":"baner§zapisz","e":2,"n":0}]');
  -- W3: blog (odesłanie), desktop, US: okolica → okolica
  perform pg_temp.pv(now() - interval '30 minutes', w3, 'okolica', '/adres/w-2', 'odeslanie', 'desktop', 'US',
    'blog.example.pl', '/post/1');
  perform pg_temp.pv(now() - interval '29 minutes', w3, 'okolica', '/adres/w-3', 'wewnetrzne', 'desktop', 'US');
  perform pg_temp.ex(now() - interval '28 minutes', w3, 'okolica', '/adres/w-3', 15000, 30::smallint,
    '[{"k":"kategorie","ms":15000,"p":1}]', null);
  -- zdarzenia pomocnicze
  perform pg_temp.klik(now() - interval '47 minutes 30 seconds', w1, 'okolica', 'etykieta§furia§porownaj');
  perform pg_temp.prod(now() - interval '49 minutes 30 seconds', w1, 'wyszukanie');
  perform pg_temp.prod(now() - interval '48 minutes 30 seconds', w1, 'karta_adresu');
  perform pg_temp.prod(now() - interval '20 minutes', w1, 'wyszukanie_bez_wyniku', '{"fraza":"w-fraza-1"}');
  perform pg_temp.prod(now() - interval '20 minutes 1 second', w2, 'wyszukanie_bez_wyniku', '{"fraza":"w-fraza-2"}');
  perform pg_temp.prod(now() - interval '20 minutes 2 seconds', w3, 'wyszukanie_bez_wyniku', '{"fraza":"w-fraza-3"}');
  perform pg_temp.blad(now() - interval '19 minutes', w1, 'okolica', 'W blad 1');
  perform pg_temp.blad(now() - interval '19 minutes 1 second', w2, 'okolica', 'W blad 2');
  perform pg_temp.blad(now() - interval '19 minutes 2 seconds', w3, 'szukaj', 'W blad 3');
  perform pg_temp.wital(now() - interval '18 minutes', w1, 'okolica', 'lcp', 1500);
  perform pg_temp.udo(now() - interval '17 minutes', w1, 'okolica', 'karta', 'link');
  perform pg_temp.udo(now() - interval '17 minutes 1 second', w2, 'okolica', 'karta', 'kopia');
  perform pg_temp.udo(now() - interval '17 minutes 2 seconds', w3, 'porownanie', 'porownanie', 'natywne');
  perform pg_temp.pv(now() - interval '16 minutes', 'e9000000000000f1', 'szukaj', '/', null, 'inne', null,
    null, null, null, null, null, null, true, 'gptbot', 'ai');
end
$d$;

alter table public.zdarzenia enable trigger zdarzenia_przed_insert;

-- ===================================================================
-- PARYTET: wlasny pipeline sesji (analityka_panel_odslony / _wyjscia) = analityka_sesje() z fundamentu
-- ===================================================================
-- Panel nie woła analityka_sesje() (60 µs na odsłonę, 8,7 s na 7 dób po 20 tys. odsłon), tylko własnego,
-- szybszego wykonania TEJ SAMEJ definicji sesji. Ten test jest jedyną siatką: zmiana progu 30 min, kolejności
-- (czas, id) albo reguły dopasowania wyjścia w jednym miejscu bez drugiego ma tu wywalić asercję, a nie
-- po cichu rozjechać liczby zakładek. Porównanie na WSZYSTKICH światach testowych naraz (T, S, D, W),
-- czyli także na sesji przeciętej północą, wyjściach z identycznym czasem co kolejna odsłona i luce 29/30/31 min.
select is((select count(*) from public.analityka_sesje('2026-01-01')), 91::bigint,
          'parytet: 91 odsłon ludzi z odciskiem we wszystkich światach testowych (świat T 45, S 29, D 5, G 6, W 6)');
select is_empty($q$
  select sesja, dzien, czas, ekran, sciezka, poz, kolejny_ekran, kanal, urzadzenie from public.analityka_sesje('2026-01-01')
  except
  select sesja, dzien, czas, ekran, sciezka, poz, kolejny_ekran, kanal, urzadzenie from public.analityka_panel_odslony('2026-01-01', 'infinity')
$q$, 'parytet odsłon: wszystko z analityka_sesje() jest w pipeline panelu (klucz sesji, doba, pozycja, następny ekran)');
select is_empty($q$
  select sesja, dzien, czas, ekran, sciezka, poz, kolejny_ekran, kanal, urzadzenie from public.analityka_panel_odslony('2026-01-01', 'infinity')
  except
  select sesja, dzien, czas, ekran, sciezka, poz, kolejny_ekran, kanal, urzadzenie from public.analityka_sesje('2026-01-01')
$q$, 'parytet odsłon: w pipeline panelu nie ma nic ponad analityka_sesje()');
select is_empty($q$
  select sesja, poz, czas_ms, scroll_pc, ostatnia_sekcja from public.analityka_sesje('2026-01-01')
  except
  select sesja, poz, czas_ms, scroll_pc, ostatnia_sekcja from public.analityka_panel_wyjscia('2026-01-01', 'infinity', false, true)
$q$, 'parytet wyjść: czas widoczny, przewinięcie i ostatnia sekcja dopasowane tak samo jak w analityka_sesje()');
select is_empty($q$
  select sesja, poz, czas_ms, scroll_pc, ostatnia_sekcja from public.analityka_panel_wyjscia('2026-01-01', 'infinity', false, true)
  except
  select sesja, poz, czas_ms, scroll_pc, ostatnia_sekcja from public.analityka_sesje('2026-01-01')
$q$, 'parytet wyjść: pipeline panelu nie dopasowuje wyjść ponad analityka_sesje()');
select is_empty($q$
  select m.sesja from public.analityka_panel_odslony('2026-01-01', 'infinity') m
    join (select sesja, count(*) as n from public.analityka_sesje('2026-01-01') group by sesja) f on f.sesja = m.sesja
   where m.strony <> f.n
$q$, 'parytet: długość sesji (strony) zgadza się z liczbą odsłon sesji w analityka_sesje()');
select is((select count(*) from public.analityka_panel_wyjscia('2026-01-01', 'infinity', true, true)),
          (select count(distinct sesja) from public.analityka_sesje('2026-01-01')),
          'parytet: tryb „tylko ostatnie odsłony” zwraca dokładnie jedną odsłonę na sesję');
select is_empty($q$
  select sesja, czas_ms, scroll_pc, ostatnia_sekcja from public.analityka_panel_wyjscia('2026-01-01', 'infinity', true, true)
  except
  select sesja, czas_ms, scroll_pc, ostatnia_sekcja from public.analityka_sesje('2026-01-01') where kolejny_ekran is null
$q$, 'parytet: ostatnie odsłony sesji niosą to samo wyjście i ostatnią sekcję co w analityka_sesje()');

-- Parametry specjalnie rozne i nietrywialne: pomylone p_dni z p_limit dalyby inna liczbe wierszy.
select is((select count(*) from public.admin_zrodla(2, 3))::text || '/' ||
          (select count(*) from public.admin_zrodla(3, 2))::text || '/' ||
          (select count(*) from public.admin_przejscia(2, 2))::text || '/' ||
          (select count(*) from public.admin_sciezki(2, 2))::text || '/' ||
          (select count(*) from public.admin_punkt_urwania(2, 2))::text || '/' ||
          (select count(*) from public.admin_top_adresy(2, 2))::text || '/' ||
          (select count(*) from public.admin_bez_wyniku(3, 2))::text || '/' ||
          (select count(*) from public.admin_bledy(2, 2))::text,
          '3/2/2/2/2/2/2/2', 'admin_*: p_limit trafia na właściwe miejsce (dane świata W dają więcej wierszy niż limit)');

select is(public.admin_przeglad(), public.analityka_panel_przeglad(now()), 'admin_przeglad = rdzeń(now())');
select is(pg_temp.a($q$select * from public.admin_seria_dzienna(5)$q$),
          pg_temp.a($q$select * from public.analityka_panel_seria_dzienna(now(), 5)$q$), 'admin_seria_dzienna(5) = rdzeń(now(), 5)');
select is(pg_temp.a($q$select * from public.admin_seria_godzinowa(12)$q$),
          pg_temp.a($q$select * from public.analityka_panel_seria_godzinowa(now(), 12)$q$), 'admin_seria_godzinowa(12) = rdzeń(now(), 12)');
select is(pg_temp.a($q$select * from public.admin_boty_ai(3)$q$),
          pg_temp.a($q$select * from public.analityka_panel_boty_ai(now(), 3)$q$), 'admin_boty_ai(3) = rdzeń(now(), 3)');
select is(pg_temp.a($q$select * from public.admin_kanaly(2)$q$),
          pg_temp.a($q$select * from public.analityka_panel_kanaly(now(), 2)$q$), 'admin_kanaly(2) = rdzeń(now(), 2)');
select is(pg_temp.a($q$select * from public.admin_zrodla(2, 3)$q$),
          pg_temp.a($q$select * from public.analityka_panel_zrodla(now(), 2, 3)$q$), 'admin_zrodla(2, 3) = rdzeń(now(), 2, 3)');
select is(pg_temp.a($q$select * from public.admin_kampanie(3)$q$),
          pg_temp.a($q$select * from public.analityka_panel_kampanie(now(), 3)$q$), 'admin_kampanie(3) = rdzeń(now(), 3)');
select is(pg_temp.a($q$select * from public.admin_kraje(2)$q$),
          pg_temp.a($q$select * from public.analityka_panel_kraje(now(), 2)$q$), 'admin_kraje(2) = rdzeń(now(), 2)');
select is(pg_temp.a($q$select * from public.admin_urzadzenia(2)$q$),
          pg_temp.a($q$select * from public.analityka_panel_urzadzenia(now(), 2)$q$), 'admin_urzadzenia(2) = rdzeń(now(), 2)');
select is(public.admin_sesje_przeglad(2), public.analityka_panel_sesje_przeglad(now(), 2), 'admin_sesje_przeglad(2) = rdzeń(now(), 2)');
select is(pg_temp.a($q$select * from public.admin_przejscia(2, 3)$q$),
          pg_temp.a($q$select * from public.analityka_panel_przejscia(now(), 2, 3)$q$), 'admin_przejscia(2, 3) = rdzeń(now(), 2, 3)');
select is(pg_temp.a($q$select * from public.admin_udostepnienia(2)$q$),
          pg_temp.a($q$select * from public.analityka_panel_udostepnienia(now(), 2)$q$), 'admin_udostepnienia(2) = rdzeń(now(), 2)');
select is(pg_temp.a($q$select * from public.admin_sciezki(2, 3)$q$),
          pg_temp.a($q$select * from public.analityka_panel_sciezki(now(), 2, 3)$q$), 'admin_sciezki(2, 3) = rdzeń(now(), 2, 3)');
select is(pg_temp.a($q$select * from public.admin_sekcje(2, 'okolica')$q$),
          pg_temp.a($q$select * from public.analityka_panel_sekcje(now(), 2, 'okolica')$q$), 'admin_sekcje(2, okolica) = rdzeń(now(), 2, okolica)');
select is(pg_temp.a($q$select * from public.admin_punkt_urwania(2, 3)$q$),
          pg_temp.a($q$select * from public.analityka_panel_punkt_urwania(now(), 2, 3)$q$), 'admin_punkt_urwania(2, 3) = rdzeń(now(), 2, 3)');
select is(pg_temp.a($q$select * from public.admin_cta_sekcje(2, 'szukaj')$q$),
          pg_temp.a($q$select * from public.analityka_panel_cta_sekcje(now(), 2, 'szukaj')$q$), 'admin_cta_sekcje(2, szukaj) = rdzeń(now(), 2, szukaj)');
select is(pg_temp.a($q$select * from public.admin_cta_martwe(2, 3)$q$),
          pg_temp.a($q$select * from public.analityka_panel_cta_martwe(now(), 2, 3)$q$), 'admin_cta_martwe(2, 3) = rdzeń(now(), 2, 3)');
select is(pg_temp.a($q$select * from public.admin_ux_sygnaly(2)$q$),
          pg_temp.a($q$select * from public.analityka_panel_ux_sygnaly(now(), 2)$q$), 'admin_ux_sygnaly(2) = rdzeń(now(), 2)');
select is(pg_temp.a($q$select * from public.admin_top_ekrany(2)$q$),
          pg_temp.a($q$select * from public.analityka_panel_top_ekrany(now(), 2)$q$), 'admin_top_ekrany(2) = rdzeń(now(), 2)');
select is(pg_temp.a($q$select * from public.admin_top_adresy(2, 3)$q$),
          pg_temp.a($q$select * from public.analityka_panel_top_adresy(now(), 2, 3)$q$), 'admin_top_adresy(2, 3) = rdzeń(now(), 2, 3)');
select is(pg_temp.a($q$select fraza, ile from public.admin_bez_wyniku(3, 2)$q$),
          pg_temp.a($q$select fraza, ile from public.analityka_panel_bez_wyniku(now(), 3, 2)$q$), 'admin_bez_wyniku(3, 2) = rdzeń(now(), 3, 2)');
select is(pg_temp.a($q$select * from public.admin_lejek(2)$q$),
          pg_temp.a($q$select * from public.analityka_panel_lejek(now(), 2)$q$), 'admin_lejek(2) = rdzeń(now(), 2)');
select is(public.admin_diagnostyka(), public.analityka_panel_diagnostyka(now()), 'admin_diagnostyka = rdzeń(now())');
select is(pg_temp.a($q$select * from public.admin_witale(2)$q$),
          pg_temp.a($q$select * from public.analityka_panel_witale(now(), 2)$q$), 'admin_witale(2) = rdzeń(now(), 2)');
select is(pg_temp.a($q$select komunikat, ekran, ile from public.admin_bledy(2, 2)$q$),
          pg_temp.a($q$select komunikat, ekran, ile from public.analityka_panel_bledy(now(), 2, 2)$q$), 'admin_bledy(2, 2) = rdzeń(now(), 2, 2)');

-- Parametry puste i skrajne przechodza przez wrapper tak samo jak przez rdzen (przycinanie dziala dla klienta)
select is((select count(*) from public.admin_seria_godzinowa(1000)), 168::bigint, 'admin_seria_godzinowa(1000): przycięte do 168 godzin');
select is((select count(*) from public.admin_seria_godzinowa(null)), 48::bigint, 'admin_seria_godzinowa(NULL): domyślne 48 godzin');
select is((select count(*) from public.admin_lejek(null)), 5::bigint, 'admin_lejek(NULL): domyślne okno, pięć kroków');
select is(public.admin_przeglad() ->> 'unikalni_7d' is not null, true, 'admin_przeglad zwraca obiekt z polami kontraktu');


-- ===================================================================
-- F. BRAMKA dla KAZDEJ z 25 funkcji: anon i nie-admin → 42501, admin → wynik
-- ===================================================================

-- Lista wywolan w jednej funkcji (tylko na czas testu – wycofana razem z transakcja), dostepna dla rol klienckich.
create function public.zz_wywolania() returns text[] language sql immutable as $f$
  select array[
    'select public.admin_przeglad()',
    'select * from public.admin_seria_dzienna()',
    'select * from public.admin_seria_godzinowa()',
    'select * from public.admin_boty_ai()',
    'select * from public.admin_kanaly()',
    'select * from public.admin_zrodla()',
    'select * from public.admin_kampanie()',
    'select * from public.admin_kraje()',
    'select * from public.admin_urzadzenia()',
    'select public.admin_sesje_przeglad()',
    'select * from public.admin_przejscia()',
    'select * from public.admin_udostepnienia()',
    'select * from public.admin_sciezki()',
    'select * from public.admin_sekcje()',
    'select * from public.admin_punkt_urwania()',
    'select * from public.admin_cta_sekcje()',
    'select * from public.admin_cta_martwe()',
    'select * from public.admin_ux_sygnaly()',
    'select * from public.admin_top_ekrany()',
    'select * from public.admin_top_adresy()',
    'select * from public.admin_bez_wyniku()',
    'select * from public.admin_lejek()',
    'select public.admin_diagnostyka()',
    'select * from public.admin_witale()',
    'select * from public.admin_bledy()'
  ]
$f$;
grant execute on function public.zz_wywolania() to anon, authenticated;

select is(array_length(public.zz_wywolania(), 1), 25, 'lista wywołań bramki ma 25 pozycji');

-- --- anon: klucz publiczny bez sesji ---
set local role anon;
select throws_ok(c, '42501', null, 'anon: ' || c) from unnest(public.zz_wywolania()) as c;
select throws_ok($q$select public.analityka_panel_przeglad(now())$q$, '42501', null, 'anon: rdzeń z jawnym czasem niewykonywalny');
reset role;

-- --- zalogowany, ale spoza listy adminow ---
select set_config('request.jwt.claims',
                  '{"sub":"bbbbbbbb-0000-0000-0000-0000000000a2","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(c, '42501', 'brak dostępu', 'nie-admin: ' || c) from unnest(public.zz_wywolania()) as c;
reset role;

-- --- admin ---
select set_config('request.jwt.claims',
                  '{"sub":"bbbbbbbb-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select lives_ok(c, 'admin: ' || c) from unnest(public.zz_wywolania()) as c;
select throws_ok($q$select public.analityka_panel_przeglad(now())$q$, '42501', null,
                 'admin nie wywoła rdzenia z własnym czasem (brak podróży w czasie)');
select throws_ok($q$select * from public.analityka_panel_wizyty('2020-01-01', now())$q$, '42501', null,
                 'admin nie wywoła wewnętrznej funkcji wizyt');
reset role;

-- --- admin usuniety z listy w trakcie sesji: ten sam token traci dostep od razu ---
delete from public.admini where user_id = 'bbbbbbbb-0000-0000-0000-0000000000a1';
set local role authenticated;
select throws_ok($q$select public.admin_przeglad()$q$, '42501', 'brak dostępu',
                 'admin usunięty z listy w trakcie sesji: kolejne zapytanie dostaje odmowę');
reset role;

select * from finish();

rollback;
