-- Test pgTAP: zestawienie dzienne, retencja i bieg nocny (specs/001-panel-analityka, zadanie T053).
--
-- Co sprawdza:
--   A. Prawa i konfiguracja trzech funkcji (analityka_zestaw_dzien, analityka_sprzataj, analityka_cron):
--      nikt z ról klienckich (PUBLIC, anon, authenticated, service_role) nie ma EXECUTE, security
--      definer, pusty search_path, lock_timeout; odmowa 42501 na żywo dla anon i authenticated.
--   B. analityka_zestaw_dzien(): liczby KAŻDEGO wymiaru na zestawie o wartościach policzonych ręcznie
--      (arytmetyka w komentarzu przy danych), plus niezmienniki: suma ekranów = odsłony, suma
--      kanałów/krajów/urządzeń = sesje, sesje <= odsłony.
--   C. Idempotencja: dwa wywołania dla tej samej doby dają identyczne wiersze, nic się nie dubluje;
--      po dopisaniu zdarzenia powtórka PRZELICZA dobę (nie dolicza do poprzedniego wyniku).
--   D. Granice doby: 23:59:59 / 00:00:00, doba 25-godzinna (jesień) i 23-godzinna (wiosna).
--   E. Przypadki szczególne: doba bez zdarzeń (zero wierszy), doba z samymi botami, top 100 fraz,
--      strażnik retencji (doba starsza niż 90 dni jest odrzucana i nie rusza zachowanego zestawienia).
--   F. analityka_sprzataj(): zdarzenia > 90 dni znikają (granica ostra), zestawienia zostają, sól
--      starsza niż wczorajsza znika.
--   G. analityka_cron(): wpis w analityka_biegi na każdy krok (sukces: koniec not null, blad null),
--      powtórka bez dubli, wymuszony błąd zestawienia i wymuszony błąd sprzątania (funkcja nie rzuca,
--      kroki są niezależne, nieudany krok nie zostawia po sobie zmian).
--   H. Zadanie pg_cron (warunkowo: tylko gdy rozszerzenie jest w tej bazie).
--
-- DATY SĄ WZGLĘDNE (dzisiaj w Europe/Warsaw ± n dni), nie kalendarzowe: przeliczenie doby starszej
-- niż 90 dni jest odrzucane, więc test z datami z 2026 przestałby chodzić po kilku miesiącach.
-- Doby zmiany czasu szukamy dynamicznie (najbliższa doba 25- i 23-godzinna od dziś) – w roku 2026
-- to 2026-10-25 i 2027-03-28, za rok będą to inne daty, a test mierzy to samo.
--
-- Czas zdarzenia nadaje trigger (now()), więc dane wstawiamy z WYŁĄCZONYM triggerem (jak w teście
-- sesji) i jawnymi znacznikami czasu. Test zaczyna od wyczyszczenia tabel analityki W TRANSAKCJI
-- (ROLLBACK na końcu przywraca wszystko), żeby liczby nie zależały od tego, co już jest w bazie.
-- Test chodzi jako postgres w jednej transakcji, którą kończy ROLLBACK.

begin;

create extension if not exists pgtap with schema extensions;

select plan(81);


-- ===================================================================
-- Pomocnicze
-- ===================================================================

-- dzisiaj (Warsaw) + n dni; stałe w obrębie transakcji, bo now() jest stałe
create function pg_temp.dz(p_przesuniecie integer) returns date
language sql stable
as $f$ select (now() at time zone 'Europe/Warsaw')::date + p_przesuniecie $f$;

-- chwila lokalna (Warsaw) danego dnia
create function pg_temp.lok(p_dzien date, p_godz time) returns timestamptz
language sql stable
as $f$ select (p_dzien + p_godz) at time zone 'Europe/Warsaw' $f$;

-- chwila w dobie testowej T = dzisiaj - 20 dni
create function pg_temp.t(p_godz time) returns timestamptz
language sql stable
as $f$ select pg_temp.lok(pg_temp.dz(-20), p_godz) $f$;

-- zawartość wymiaru jednej doby jako tekst "klucz=wartosc, ..." (porządek bajtowy, niezależny od locale)
create function pg_temp.wymiar(p_dzien date, p_wymiar text) returns text
language sql stable
as $f$
  select string_agg(a.klucz || '=' || a.wartosc, ', ' order by a.klucz collate "C")
    from public.analityka_dzienna a
   where a.dzien = p_dzien and a.wymiar = p_wymiar
$f$;

create function pg_temp.liczba_wierszy(p_dzien date) returns bigint
language sql stable
as $f$ select count(*) from public.analityka_dzienna a where a.dzien = p_dzien $f$;

-- wartość jednego klucza ruch/… dla doby
create function pg_temp.ruch(p_dzien date, p_klucz text) returns bigint
language sql stable
as $f$
  select a.wartosc from public.analityka_dzienna a
   where a.dzien = p_dzien and a.wymiar = 'ruch' and a.klucz = p_klucz
$f$;

-- przeliczenie doby bez wypisywania wyniku (strumień TAP nie zbiera surowego jsona)
create function pg_temp.licz(p_dzien date) returns void
language plpgsql
as $f$ begin perform public.analityka_zestaw_dzien(p_dzien); end $f$;

-- czyste tabele analityki (w transakcji testu)
delete from public.analityka_biegi;
delete from public.analityka_dzienna;
delete from public.analityka_sol;
delete from public.zdarzenia;


-- ===================================================================
-- A. Prawa i konfiguracja
-- ===================================================================

select is((select count(*)
             from (values ('public.analityka_zestaw_dzien(date)'),
                          ('public.analityka_sprzataj()'),
                          ('public.analityka_cron()')) as f(sygnatura)
            cross join (values ('anon'), ('authenticated'), ('service_role')) as r(rola)
            where has_function_privilege(r.rola, f.sygnatura, 'execute')),
          0::bigint,
          'EXECUTE: żadna rola kliencka (anon, authenticated, service_role) nie wywoła funkcji zestawienia');

-- Dowód, że pomiar coś mierzy: właściciel (postgres, rola pg_cron i SQL Editora) EXECUTE zachował.
select is((select count(*)
             from (values ('public.analityka_zestaw_dzien(date)'),
                          ('public.analityka_sprzataj()'),
                          ('public.analityka_cron()')) as f(sygnatura)
            where has_function_privilege('postgres', f.sygnatura, 'execute')),
          3::bigint,
          'EXECUTE: właściciel (postgres) zachował prawo do wszystkich trzech funkcji');

select is((select count(*)
             from pg_proc p,
                  lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) as a
            where p.oid in ('public.analityka_zestaw_dzien(date)'::regprocedure,
                            'public.analityka_sprzataj()'::regprocedure,
                            'public.analityka_cron()'::regprocedure)
              and a.grantee = 0),
          0::bigint,
          'EXECUTE: żadna z trzech funkcji nie jest wykonywalna dla PUBLIC');

select is((select count(*)
             from pg_proc p
            where p.oid in ('public.analityka_zestaw_dzien(date)'::regprocedure,
                            'public.analityka_sprzataj()'::regprocedure,
                            'public.analityka_cron()'::regprocedure)
              and p.prosecdef
              and p.proconfig @> array['search_path=""']),
          3::bigint,
          'wszystkie 3 funkcje: security definer i pusty search_path');

select ok((select p.proconfig @> array['statement_timeout=120s']
             from pg_proc p where p.oid = 'public.analityka_zestaw_dzien(date)'::regprocedure),
          'zestawienie deklaruje statement_timeout = 120s (kontrakt rpc.md)');

select is((select count(*)
             from pg_proc p
            where p.oid in ('public.analityka_zestaw_dzien(date)'::regprocedure,
                            'public.analityka_sprzataj()'::regprocedure,
                            'public.analityka_cron()'::regprocedure)
              and p.proconfig @> array['lock_timeout=30s']),
          3::bigint,
          'wszystkie 3 funkcje mają lock_timeout = 30s (ochrona przed zawieszeniem na blokadzie)');

select is((select string_agg(p.proname::text || ':' || format_type(p.prorettype, null), ',' order by p.proname::text collate "C")
             from pg_proc p
            where p.oid in ('public.analityka_zestaw_dzien(date)'::regprocedure,
                            'public.analityka_sprzataj()'::regprocedure,
                            'public.analityka_cron()'::regprocedure)),
          'analityka_cron:void,analityka_sprzataj:jsonb,analityka_zestaw_dzien:jsonb',
          'typy zwracane: zestawienie i sprzątanie jsonb, bieg nocny void');

set local role anon;
select throws_ok($q$select public.analityka_zestaw_dzien(current_date)$q$, '42501', null,
                 'anon: analityka_zestaw_dzien niewykonywalne');
select throws_ok($q$select public.analityka_sprzataj()$q$, '42501', null,
                 'anon: analityka_sprzataj niewykonywalne');
select throws_ok($q$select public.analityka_cron()$q$, '42501', null,
                 'anon: analityka_cron niewykonywalne');
reset role;

set local role authenticated;
select throws_ok($q$select public.analityka_zestaw_dzien(current_date)$q$, '42501', null,
                 'authenticated: analityka_zestaw_dzien niewykonywalne');
select throws_ok($q$select public.analityka_sprzataj()$q$, '42501', null,
                 'authenticated: analityka_sprzataj niewykonywalne');
select throws_ok($q$select public.analityka_cron()$q$, '42501', null,
                 'authenticated: analityka_cron niewykonywalne');
reset role;


-- ===================================================================
-- Dane doby testowej T = dzisiaj - 20 dni (czasy lokalne Warsaw)
-- ===================================================================

alter table public.zdarzenia disable trigger zdarzenia_przed_insert;

-- Ludzie: odsłony (i wyjścia). Kolejność wierszy = kolejność id (ma znaczenie przy równych czasach).
insert into public.zdarzenia (czas, typ, ekran, sciezka, odcisk, kraj, urzadzenie, kanal, czas_ms)
values
  -- A: dwie sesje. 10:05 -> 12:00 to 115 min > 30 min, więc 12:00 zaczyna nową sesję.
  --    Druga odsłona pierwszej sesji ma INNY kraj, urządzenie i kanał niż pierwsza – wymiary
  --    sesyjne muszą brać pierwszą (PL, mobile, wyszukiwarka), nie ostatnią.
  (pg_temp.t('10:00'), 'odslona', 'szukaj',  '/',          'a100000000000001', 'PL', 'mobile',  'wyszukiwarka', null),
  (pg_temp.t('10:05'), 'odslona', 'okolica', '/okolica/1', 'a100000000000001', 'DE', 'desktop', 'wewnetrzne',   null),
  (pg_temp.t('10:06'), 'wyjscie', 'okolica', '/okolica/1', 'a100000000000001', null, 'mobile',  null,           40000),
  (pg_temp.t('12:00'), 'odslona', 'szukaj',  '/',          'a100000000000001', 'PL', 'mobile',  'bezposrednie', null),
  (pg_temp.t('12:01'), 'wyjscie', 'szukaj',  '/',          'a100000000000001', null, 'mobile',  null,           10000),
  -- B: jedna odsłona, wyjście dokładnie 30 000 ms (próg zaangażowania jest włącznie)
  (pg_temp.t('11:00'), 'odslona', 'szukaj',  '/',          'b100000000000002', 'DE', 'desktop', 'social',       null),
  (pg_temp.t('11:01'), 'wyjscie', 'szukaj',  '/',          'b100000000000002', null, 'desktop', null,           30000),
  -- N: jedna odsłona, wyjście 29 999 ms (tuż pod progiem)
  (pg_temp.t('11:30'), 'odslona', 'szukaj',  '/',          '0a00000000000003', 'PL', 'desktop', 'bezposrednie', null),
  (pg_temp.t('11:31'), 'wyjscie', 'szukaj',  '/',          '0a00000000000003', null, 'desktop', null,           29999),
  -- C: kraj nieznany (null)
  (pg_temp.t('14:00'), 'odslona', 'okolica', '/okolica/2', 'c100000000000004', null, 'tablet',  'ai',           null),
  -- E: kanał nieznany (null) – sesja bez znanego źródła liczy się jako bezpośrednia
  (pg_temp.t('15:00'), 'odslona', 'porownanie', '/porownanie', 'e100000000000005', 'PL', 'inne', null,          null),
  -- bez odcisku: liczy się do odsłon i ekranów, ale nie do unikalnych ani do sesji
  (pg_temp.t('16:00'), 'odslona', 'szukaj',  '/',          null,               'PL', 'desktop', 'bezposrednie', null),
  -- K: dwie odsłony o TYM SAMYM czasie (paczka); pierwsza po id to szukaj/FR/kampania/desktop
  (pg_temp.t('17:00'), 'odslona', 'szukaj',  '/',          'd100000000000006', 'FR', 'desktop', 'kampania',     null),
  (pg_temp.t('17:00'), 'odslona', 'okolica', '/okolica/3', 'd100000000000006', 'DE', 'mobile',  'wewnetrzne',   null),
  -- L: dwa IDENTYCZNE wiersze (ten sam odcisk, czas, ekran, ścieżka) – dopasowanie kraju nie może
  --    podwoić sesji
  (pg_temp.t('18:00'), 'odslona', 'metoda',  '/metoda',    'd200000000000007', 'ES', 'desktop', 'social',       null),
  (pg_temp.t('18:00'), 'odslona', 'metoda',  '/metoda',    'd200000000000007', 'ES', 'desktop', 'social',       null),
  -- granice doby T: początek (00:00:00) i ostatnia sekunda (23:59:59) należą do T; X1 zaczyna sesję
  -- od wejścia „wewnętrznego” (własny referer), czyli bez zewnętrznego źródła = ruch bezpośredni
  (pg_temp.t('00:00'),    'odslona', 'metoda', '/metoda',  'f100000000000008', 'PL', 'desktop', 'wewnetrzne',   null),
  (pg_temp.t('23:59:59'), 'odslona', 'metoda', '/metoda',  'f200000000000009', 'PL', 'desktop', 'bezposrednie', null),
  -- sąsiednie doby: 23:59:59 dnia T-1 i 00:00:00 dnia T+1 NIE należą do T
  (pg_temp.lok(pg_temp.dz(-21), '23:59:59'), 'odslona', 'metoda', '/metoda', 'f300000000000010', 'PL', 'desktop', 'bezposrednie', null),
  (pg_temp.lok(pg_temp.dz(-19), '00:00'),    'odslona', 'metoda', '/metoda', 'f400000000000011', 'PL', 'desktop', 'bezposrednie', null);

-- Boty: odsłony (G: gptbot x3, H: googlebot x2, I: claudebot x1, J: bez rodziny x1) – wszystkie na
-- ekranie szukaj/okolica, żeby pomyłka w filtrze ludzi od razu zawyżyła ekrany.
insert into public.zdarzenia (czas, typ, ekran, sciezka, odcisk, urzadzenie, czy_bot, bot_rodzina, bot_klasa)
values
  (pg_temp.t('09:00:00'), 'odslona', 'szukaj',  '/',          'b0b0000000000011', 'inne', true, 'gptbot',    'ai'),
  (pg_temp.t('09:00:10'), 'odslona', 'szukaj',  '/',          'b0b0000000000011', 'inne', true, 'gptbot',    'ai'),
  (pg_temp.t('09:00:20'), 'odslona', 'szukaj',  '/',          'b0b0000000000011', 'inne', true, 'gptbot',    'ai'),
  (pg_temp.t('09:30:00'), 'odslona', 'szukaj',  '/',          'b0b0000000000012', 'inne', true, 'googlebot', 'wyszukiwarka'),
  (pg_temp.t('09:31:00'), 'odslona', 'szukaj',  '/',          'b0b0000000000012', 'inne', true, 'googlebot', 'wyszukiwarka'),
  (pg_temp.t('09:40:00'), 'odslona', 'okolica', '/okolica/1', 'b0b0000000000013', 'inne', true, 'claudebot', 'ai'),
  (pg_temp.t('09:50:00'), 'odslona', 'okolica', '/okolica/2', 'b0b0000000000014', 'inne', true, null,        'ai');

-- Zdarzenia produktowe (ludzie): karta_adresu x3, wyszukanie x2, porownanie_dodaj x1 oraz
-- wyszukanie_bez_wyniku (fraza). Wszystko pod odciskiem a9.. (ani jednej odsłony), więc nie może
-- zwiększyć unikalnych ani sesji.
insert into public.zdarzenia (czas, typ, ekran, sciezka, odcisk, urzadzenie, czy_bot, nazwa, wlasciwosci)
values
  (pg_temp.t('10:07'), 'produktowe', 'okolica', '/okolica/1', 'a9a9a9a9a9a9a9a9', 'mobile',  false, 'karta_adresu',    null),
  (pg_temp.t('11:02'), 'produktowe', 'okolica', '/okolica/1', 'a9a9a9a9a9a9a9a9', 'mobile',  false, 'karta_adresu',    null),
  (pg_temp.t('14:01'), 'produktowe', 'okolica', '/okolica/2', 'a9a9a9a9a9a9a9a9', 'mobile',  false, 'karta_adresu',    null),
  (pg_temp.t('11:03'), 'produktowe', 'szukaj',  '/',          'a9a9a9a9a9a9a9a9', 'mobile',  false, 'wyszukanie',      '{"wynikow":5,"rodzaj":"adres","fraza":"nie ta tabela"}'::jsonb),
  (pg_temp.t('13:59'), 'produktowe', 'szukaj',  '/',          'a9a9a9a9a9a9a9a9', 'mobile',  false, 'wyszukanie',      '{"wynikow":0,"rodzaj":"ulica"}'::jsonb),
  (pg_temp.t('10:09'), 'produktowe', 'okolica', '/okolica/1', 'a9a9a9a9a9a9a9a9', 'mobile',  false, 'porownanie_dodaj', null),
  -- bez wyniku: 3 x 'ul. nieistniejąca 5', 2 x 'xyz', 'Foo Bar' + '  foo bar ' (po normalizacji ta sama fraza)
  (pg_temp.t('13:01'), 'produktowe', 'szukaj',  '/',          'a9a9a9a9a9a9a9a9', 'mobile',  false, 'wyszukanie_bez_wyniku', '{"fraza":"ul. nieistniejąca 5"}'::jsonb),
  (pg_temp.t('13:02'), 'produktowe', 'szukaj',  '/',          'a9a9a9a9a9a9a9a9', 'mobile',  false, 'wyszukanie_bez_wyniku', '{"fraza":"ul. nieistniejąca 5"}'::jsonb),
  (pg_temp.t('13:03'), 'produktowe', 'szukaj',  '/',          'a9a9a9a9a9a9a9a9', 'mobile',  false, 'wyszukanie_bez_wyniku', '{"fraza":"ul. nieistniejąca 5"}'::jsonb),
  (pg_temp.t('13:04'), 'produktowe', 'szukaj',  '/',          'a9a9a9a9a9a9a9a9', 'mobile',  false, 'wyszukanie_bez_wyniku', '{"fraza":"xyz"}'::jsonb),
  (pg_temp.t('13:05'), 'produktowe', 'szukaj',  '/',          'a9a9a9a9a9a9a9a9', 'mobile',  false, 'wyszukanie_bez_wyniku', '{"fraza":"xyz"}'::jsonb),
  (pg_temp.t('13:06'), 'produktowe', 'szukaj',  '/',          'a9a9a9a9a9a9a9a9', 'mobile',  false, 'wyszukanie_bez_wyniku', '{"fraza":"Foo Bar"}'::jsonb),
  (pg_temp.t('13:07'), 'produktowe', 'szukaj',  '/',          'a9a9a9a9a9a9a9a9', 'mobile',  false, 'wyszukanie_bez_wyniku', '{"fraza":"  foo bar "}'::jsonb),
  -- znaczniki odrzucenia (w bez_wyniku jedna pozycja [odrzucono]): { "odrzucono": true } x2 i literalne
  -- [odrzucono]; pusta fraza (pomijana)
  (pg_temp.t('13:08'), 'produktowe', 'szukaj',  '/',          'a9a9a9a9a9a9a9a9', 'mobile',  false, 'wyszukanie_bez_wyniku', '{"odrzucono":true}'::jsonb),
  (pg_temp.t('13:09'), 'produktowe', 'szukaj',  '/',          'a9a9a9a9a9a9a9a9', 'mobile',  false, 'wyszukanie_bez_wyniku', '{"odrzucono":true}'::jsonb),
  (pg_temp.t('13:10'), 'produktowe', 'szukaj',  '/',          'a9a9a9a9a9a9a9a9', 'mobile',  false, 'wyszukanie_bez_wyniku', '{"fraza":"[odrzucono]"}'::jsonb),
  (pg_temp.t('13:11'), 'produktowe', 'szukaj',  '/',          'a9a9a9a9a9a9a9a9', 'mobile',  false, 'wyszukanie_bez_wyniku', '{"fraza":""}'::jsonb);

-- Boty w zdarzeniach, które liczą tylko ludzi: produktowe x5 (klasa ai), fraza bez wyniku, wital.
insert into public.zdarzenia (czas, typ, ekran, sciezka, odcisk, urzadzenie, czy_bot, bot_rodzina, bot_klasa, nazwa, wlasciwosci, wartosc)
select pg_temp.t('09:20'), 'produktowe', 'okolica', '/okolica/1', 'b0b0000000000011', 'inne', true, 'gptbot', 'ai',
       'karta_adresu', null, null
  from generate_series(1, 5);
insert into public.zdarzenia (czas, typ, ekran, sciezka, odcisk, urzadzenie, czy_bot, bot_rodzina, bot_klasa, nazwa, wlasciwosci, wartosc)
values
  (pg_temp.t('09:21'), 'produktowe', 'szukaj',  '/',          'b0b0000000000011', 'inne', true, 'gptbot', 'ai', 'wyszukanie_bez_wyniku', '{"fraza":"fraza bota"}'::jsonb, null),
  (pg_temp.t('09:22'), 'wital',      'okolica', '/okolica/1', 'b0b0000000000011', 'inne', true, 'gptbot', 'ai', 'lcp', null, 99999);

-- Web Vitals (ludzie): okolica/lcp 100,200,300,400 (p75 = 300 + 0,25 * (400 - 300) = 325),
-- szukaj/cls 0,05; 0,1; 0,2 (p75 = 0,1 + 0,5 * (0,2 - 0,1) = 0,15; liczba zmiennoprzecinkowa daje
-- 0,15000000000000002, a zaokrąglenie do 3 miejsc musi to uprzątnąć do 0,150),
-- okolica/inp 50 (jedna próbka: p75 = 50).
insert into public.zdarzenia (czas, typ, ekran, sciezka, odcisk, urzadzenie, czy_bot, nazwa, wartosc)
values
  (pg_temp.t('13:20'), 'wital', 'okolica', '/okolica/1', 'a9a9a9a9a9a9a9a9', 'mobile', false, 'lcp', 100),
  (pg_temp.t('13:21'), 'wital', 'okolica', '/okolica/1', 'a9a9a9a9a9a9a9a9', 'mobile', false, 'lcp', 200),
  (pg_temp.t('13:22'), 'wital', 'okolica', '/okolica/1', 'a9a9a9a9a9a9a9a9', 'mobile', false, 'lcp', 300),
  (pg_temp.t('13:23'), 'wital', 'okolica', '/okolica/1', 'a9a9a9a9a9a9a9a9', 'mobile', false, 'lcp', 400),
  (pg_temp.t('13:24'), 'wital', 'szukaj',  '/',          'a9a9a9a9a9a9a9a9', 'mobile', false, 'cls', 0.05),
  (pg_temp.t('13:25'), 'wital', 'szukaj',  '/',          'a9a9a9a9a9a9a9a9', 'mobile', false, 'cls', 0.1),
  (pg_temp.t('13:26'), 'wital', 'szukaj',  '/',          'a9a9a9a9a9a9a9a9', 'mobile', false, 'cls', 0.2),
  (pg_temp.t('13:27'), 'wital', 'okolica', '/okolica/1', 'a9a9a9a9a9a9a9a9', 'mobile', false, 'inp', 50);

-- Inne typy: nie wchodzą do żadnego wymiaru (błąd, klik, udostępnienie).
insert into public.zdarzenia (czas, typ, ekran, sciezka, odcisk, urzadzenie, komunikat, etykieta, kanal_udostepnienia)
values
  (pg_temp.t('13:30'), 'blad',          'okolica', '/okolica/1', 'a9a9a9a9a9a9a9a9', 'mobile', 'TypeError', null, null),
  (pg_temp.t('13:31'), 'klik',          'okolica', '/okolica/1', 'a9a9a9a9a9a9a9a9', 'mobile', null, 'hero§przycisk§szukaj', null),
  (pg_temp.t('13:32'), 'udostepnienie', 'okolica', '/okolica/1', 'a9a9a9a9a9a9a9a9', 'mobile', null, 'karta', 'link');

alter table public.zdarzenia enable trigger zdarzenia_przed_insert;

-- ARYTMETYKA doby T (ręcznie, po odsłonach ludzi z tabeli powyżej):
--   odsłony ludzi (czy_bot = false), także bez odcisku:
--     A 3 (10:00, 10:05, 12:00) + B 1 + N 1 + C 1 + E 1 + (bez odcisku) 1 + K 2 + L 2 + X1 1 + X2 1 = 14
--     (odsłony T-1 i T+1 oraz wszystkie zdarzenia nie-odsłony nie wchodzą)
--   per ekran: szukaj = A(10:00) + A(12:00) + B + N + (bez odcisku) + K(17:00) = 6;
--              okolica = A(10:05) + C + K(17:00, druga) = 3; porownanie = E = 1; metoda = L x2 + X1 + X2 = 4;
--              razem 6 + 3 + 1 + 4 = 14
--   unikalni (różne odciski ludzi wśród WSZYSTKICH zdarzeń doby, jak w rpc.md): A, B, N, C, E, K, L, X1, X2 = 9
--     z odsłonami + odcisk a9.. (tylko pomiary i produktowe, bez ani jednej odsłony) = 10;
--     odsłona bez odcisku się nie liczy, boty też nie
--   odsłony botów = 3 + 2 + 1 + 1 = 7
--   sesje = A 2 (luka 115 min) + B + N + C + E + K + L + X1 + X2 = 10   (10 sesji <= 14 odsłon)
--   sesje zaangażowane (>= 2 odsłony albo >= 30 000 ms): A(1. sesja: 2 odsłony), B (30 000 = próg),
--     K (2 odsłony), L (2 odsłony) = 4; poza tym A(2. sesja: 10 000), N (29 999), C, E, X1, X2 nie
--   kanał pierwszej odsłony sesji: wyszukiwarka 1 (A1), bezposrednie 5 (A2, N, X2 wprost; E: kanał null;
--     X1: „wewnetrzne” jako początek sesji), social 2 (B, L), ai 1 (C), kampania 1 (K) = 10 = sesje;
--     klucze (nieznany) i wewnetrzne w tym wymiarze nie występują
--   kraj pierwszej odsłony: PL 6 (A1, A2, N, E, X1, X2), DE 1 (B), FR 1 (K), ES 1 (L),
--     (nieznany) 1 (C) = 10; gdyby brać OSTATNIĄ odsłonę, DE miałoby 2 (A1) a FR 0 (K)
--   urządzenie pierwszej odsłony: mobile 2 (A1, A2), desktop 6 (B, N, K, L, X1, X2), tablet 1 (C),
--     inne 1 (E) = 10
--   bot_ai (odsłony botów klasy ai): gptbot 3, claudebot 1, (nieznana) 1 (J: klasa ai bez rodziny);
--     googlebot (wyszukiwarka) odpada, a produktowe i wital gptbota nie są odsłonami
--   produktowe (ludzie): karta_adresu 3, wyszukanie 2, porownanie_dodaj 1,
--     wyszukanie_bez_wyniku 3 + 2 + 2 + 2 (odrzucono) + 1 ([odrzucono]) + 1 (pusta) = 11 (+1 bota odpada)
--   bez_wyniku: 'ul. nieistniejąca 5' = 3, 'foo bar' = 2 (Foo Bar + "  foo bar "), 'xyz' = 2,
--     '[odrzucono]' = 3 (dwa { "odrzucono": true } + literalne [odrzucono]); pusta fraza i fraza bota
--     pominięte
--   witale: okolica§lcp 4 próbki p75 325, szukaj§cls 3 próbki p75 0,15, okolica§inp 1 próbka p75 50
--     (zaokrąglone do 3 miejsc; lcp bota 99999 pominięte)
--   liczba wierszy: ruch 5 + ekran 4 + kanal 5 + kraj 5 + urzadzenie 4 + bot_ai 3 + produktowe 4
--     + bez_wyniku 4 + witale 3 = 37

create temp table wynik_t as
select public.analityka_zestaw_dzien(pg_temp.dz(-20)) as w;


-- ===================================================================
-- B. Liczby doby T
-- ===================================================================

select is((select w ->> 'wierszy' from wynik_t), '37', 'wynik: 37 wierszy zestawienia doby T');
select is((select w -> 'wymiary' from wynik_t),
          '{"ruch":5,"ekran":4,"kanal":5,"kraj":5,"urzadzenie":4,"bot_ai":3,"produktowe":4,"bez_wyniku":4,"witale":3}'::jsonb,
          'wynik: liczba wierszy na wymiar');
select is((select w ->> 'zastapiono' from wynik_t), '0', 'wynik: pierwsze przeliczenie niczego nie zastępuje');
select is(pg_temp.liczba_wierszy(pg_temp.dz(-20)), 37::bigint, 'w tabeli 37 wierszy doby T');
-- Blokada doradcza doby (trzymana do końca transakcji) ustawia równoległe przeliczenia tej samej
-- doby w kolejkę; bez niej drugie delete nie widziałoby wierszy pierwszego i padłoby na kluczu głównym.
select ok(exists (select 1 from pg_locks l
                   where l.locktype = 'advisory' and l.pid = pg_backend_pid() and l.objsubid = 2
                     and l.classid::bigint = (hashtext('adresscore.analityka_zestaw_dzien')::bigint & 4294967295)
                     and l.objid::bigint = (pg_temp.dz(-20) - date '2000-01-01')),
          'zestawienie bierze blokadę doradczą doby (równoległe przeliczenia ustawiają się w kolejkę)');

select is(pg_temp.wymiar(pg_temp.dz(-20), 'ruch'),
          'odslony=14, odslony_boty=7, sesje=10, sesje_zaangazowane=4, unikalni=10',
          'ruch: odsłony 14, boty 7, sesje 10, zaangażowane 4, unikalni 10 (w tym odcisk bez odsłony)');
select is(pg_temp.wymiar(pg_temp.dz(-20), 'ekran'),
          'metoda=4, okolica=3, porownanie=1, szukaj=6',
          'ekran: odsłony ludzi na ekran');
select is(pg_temp.wymiar(pg_temp.dz(-20), 'kanal'),
          'ai=1, bezposrednie=5, kampania=1, social=2, wyszukiwarka=1',
          'kanal: wizyty wg pierwszej odsłony sesji; wewnętrzne i brak kanału = bezpośrednie');
select is(pg_temp.wymiar(pg_temp.dz(-20), 'kraj'),
          '(nieznany)=1, DE=1, ES=1, FR=1, PL=6',
          'kraj: wizyty wg kraju pierwszej odsłony (nieznany osobno)');
select is(pg_temp.wymiar(pg_temp.dz(-20), 'urzadzenie'),
          'desktop=6, inne=1, mobile=2, tablet=1',
          'urzadzenie: wizyty wg urządzenia pierwszej odsłony');
select is(pg_temp.wymiar(pg_temp.dz(-20), 'bot_ai'),
          '(nieznana)=1, claudebot=1, gptbot=3',
          'bot_ai: odsłony botów klasy ai wg rodziny');
select is(pg_temp.wymiar(pg_temp.dz(-20), 'produktowe'),
          'karta_adresu=3, porownanie_dodaj=1, wyszukanie=2, wyszukanie_bez_wyniku=11',
          'produktowe: zdarzenia ludzi wg nazwy');
select is(pg_temp.wymiar(pg_temp.dz(-20), 'bez_wyniku'),
          '[odrzucono]=3, foo bar=2, ul. nieistniejąca 5=3, xyz=2',
          'bez_wyniku: frazy znormalizowane, odrzucone jako jedna pozycja [odrzucono], pusta fraza i bot pominięte');
select is((select string_agg(a.klucz || '=' || a.wartosc || '/' || a.wartosc2, ', ' order by a.klucz collate "C")
             from public.analityka_dzienna a
            where a.dzien = pg_temp.dz(-20) and a.wymiar = 'witale'),
          'okolica§inp=1/50.000, okolica§lcp=4/325.000, szukaj§cls=3/0.150',
          'witale: liczba próbek i p75 (percentile_cont 0,75, 3 miejsca) na ekran§metrykę');

select is((select sum(a.wartosc) from public.analityka_dzienna a
            where a.dzien = pg_temp.dz(-20) and a.wymiar = 'ekran'),
          pg_temp.ruch(pg_temp.dz(-20), 'odslony')::numeric,
          'niezmiennik: suma odsłon po ekranach = odsłony ruchu');
select is((select string_agg(s.suma::text, ',' order by s.wymiar)
             from (select a.wymiar, sum(a.wartosc) as suma
                     from public.analityka_dzienna a
                    where a.dzien = pg_temp.dz(-20) and a.wymiar in ('kanal', 'kraj', 'urzadzenie')
                    group by a.wymiar) s),
          '10,10,10',
          'niezmiennik: suma kanałów, krajów i urządzeń = liczba sesji (10) – 100% to całość');
select ok(pg_temp.ruch(pg_temp.dz(-20), 'sesje') <= pg_temp.ruch(pg_temp.dz(-20), 'odslony'),
          'niezmiennik: sesje <= odsłony (sesja zaczyna się od odsłony)');
select is((select count(*) from public.analityka_dzienna a
            where a.dzien = pg_temp.dz(-20) and a.wymiar <> 'witale' and a.wartosc2 is not null),
          0::bigint,
          'wartosc2 wypełnione wyłącznie dla witali');


-- ===================================================================
-- C. Idempotencja
-- ===================================================================

create temp table snap_t as
select a.dzien, a.wymiar, a.klucz, a.wartosc, a.wartosc2
  from public.analityka_dzienna a where a.dzien = pg_temp.dz(-20);

create temp table wynik_t2 as
select public.analityka_zestaw_dzien(pg_temp.dz(-20)) as w;

select is((select w ->> 'zastapiono' from wynik_t2) || '/' || (select w ->> 'wierszy' from wynik_t2),
          '37/37',
          'powtórka: zastąpiono 37 wierszy i zapisano 37');
select is_empty($q$select a.dzien, a.wymiar, a.klucz, a.wartosc, a.wartosc2
                     from public.analityka_dzienna a where a.dzien = pg_temp.dz(-20)
                   except select dzien, wymiar, klucz, wartosc, wartosc2 from snap_t$q$,
                'powtórka: żaden wiersz nowy ani zmieniony względem pierwszego przeliczenia');
select is_empty($q$select dzien, wymiar, klucz, wartosc, wartosc2 from snap_t
                   except select a.dzien, a.wymiar, a.klucz, a.wartosc, a.wartosc2
                     from public.analityka_dzienna a where a.dzien = pg_temp.dz(-20)$q$,
                'powtórka: żaden wiersz nie zniknął');
select is(pg_temp.liczba_wierszy(pg_temp.dz(-20)), 37::bigint, 'powtórka: nadal 37 wierszy (bez dubli)');

-- Spóźniona odsłona z nowym odciskiem: powtórka PRZELICZA dobę (14 -> 15 odsłon, 10 -> 11 unikalnych,
-- 10 -> 11 sesji), a nie dolicza do poprzedniego wyniku.
alter table public.zdarzenia disable trigger zdarzenia_przed_insert;
insert into public.zdarzenia (czas, typ, ekran, sciezka, odcisk, kraj, urzadzenie, kanal)
values (pg_temp.t('19:00'), 'odslona', 'szukaj', '/', 'ab00000000000012', 'PL', 'desktop', 'bezposrednie');
alter table public.zdarzenia enable trigger zdarzenia_przed_insert;
select pg_temp.licz(pg_temp.dz(-20));
select is(pg_temp.wymiar(pg_temp.dz(-20), 'ruch'),
          'odslony=15, odslony_boty=7, sesje=11, sesje_zaangazowane=4, unikalni=11',
          'powtórka po dopisaniu zdarzenia przelicza dobę (15 odsłon, 11 unikalnych, 11 sesji)');
select is((select count(*) from public.analityka_dzienna a
            where a.dzien = pg_temp.dz(-20) and a.wymiar = 'ruch'),
          5::bigint, 'powtórka po dopisaniu: nadal dokładnie 5 kluczy ruchu');


-- ===================================================================
-- D. Granice doby i zmiana czasu
-- ===================================================================

select pg_temp.licz(pg_temp.dz(-21));
select pg_temp.licz(pg_temp.dz(-19));
select is(pg_temp.wymiar(pg_temp.dz(-21), 'ruch'),
          'odslony=1, odslony_boty=0, sesje=1, sesje_zaangazowane=0, unikalni=1',
          'doba T-1: odsłona z 23:59:59 należy do niej (i tylko do niej)');
select is(pg_temp.wymiar(pg_temp.dz(-19), 'ruch'),
          'odslony=1, odslony_boty=0, sesje=1, sesje_zaangazowane=0, unikalni=1',
          'doba T+1: odsłona z 00:00:00 należy do niej (i tylko do niej)');

-- Najbliższa doba 25-godzinna (jesień) i 23-godzinna (wiosna), licząc od dziś + 5 dni. Dystans 5 dni
-- trzyma zdarzenia próbne (sekunda przed początkiem doby) z dala od doby wczorajszej, którą liczy
-- test biegu nocnego, także w dniu samej zmiany czasu.
create temp table t_dst as
select min(x.d) filter (where x.dl = 90000) as d25,
       min(x.d) filter (where x.dl = 82800) as d23
  from (select pg_temp.dz(n) as d,
               extract(epoch from (pg_temp.lok(pg_temp.dz(n) + 1, '00:00') - pg_temp.lok(pg_temp.dz(n), '00:00'))) as dl
          from generate_series(5, 400) n) x;

select is((select extract(epoch from (pg_temp.lok(d25 + 1, '00:00') - pg_temp.lok(d25, '00:00')))::integer / 3600
             from t_dst),
          25,
          'przesłanka: znaleziona doba jesienna ma 25 godzin');
select is((select extract(epoch from (pg_temp.lok(d23 + 1, '00:00') - pg_temp.lok(d23, '00:00')))::integer / 3600
             from t_dst),
          23,
          'przesłanka: znaleziona doba wiosenna ma 23 godziny');

-- Po jednej odsłonie (osobny odcisk) w KAŻDEJ godzinie doby, o pół godziny po jej początku:
-- 25 odsłon w dobie 25-godzinnej (w tym obie powtórzone 02:30) i 23 w 23-godzinnej, plus po jednej
-- sekundę przed początkiem (poprzednia doba) i dokładnie na początku następnej doby.
alter table public.zdarzenia disable trigger zdarzenia_przed_insert;
insert into public.zdarzenia (czas, typ, ekran, sciezka, odcisk, urzadzenie, kanal)
select pg_temp.lok(d.d25, '00:00') + k * interval '1 hour' + interval '30 minutes',
       'odslona', 'szukaj', '/', 'e2' || lpad(to_hex(k), 14, '0'), 'desktop', 'bezposrednie'
  from t_dst d cross join generate_series(0, 24) k;
insert into public.zdarzenia (czas, typ, ekran, sciezka, odcisk, urzadzenie, kanal)
select pg_temp.lok(d.d25, '00:00') - interval '1 second', 'odslona', 'szukaj', '/', 'e300000000000001', 'desktop', 'bezposrednie' from t_dst d
union all
select pg_temp.lok(d.d25, '00:00') + interval '25 hours', 'odslona', 'szukaj', '/', 'e300000000000002', 'desktop', 'bezposrednie' from t_dst d;
insert into public.zdarzenia (czas, typ, ekran, sciezka, odcisk, urzadzenie, kanal)
select pg_temp.lok(d.d23, '00:00') + k * interval '1 hour' + interval '30 minutes',
       'odslona', 'szukaj', '/', 'e4' || lpad(to_hex(k), 14, '0'), 'desktop', 'bezposrednie'
  from t_dst d cross join generate_series(0, 22) k;
insert into public.zdarzenia (czas, typ, ekran, sciezka, odcisk, urzadzenie, kanal)
select pg_temp.lok(d.d23, '00:00') - interval '1 second', 'odslona', 'szukaj', '/', 'e500000000000001', 'desktop', 'bezposrednie' from t_dst d
union all
select pg_temp.lok(d.d23, '00:00') + interval '23 hours', 'odslona', 'szukaj', '/', 'e500000000000002', 'desktop', 'bezposrednie' from t_dst d;
alter table public.zdarzenia enable trigger zdarzenia_przed_insert;

select pg_temp.licz(d.d25 + n) from t_dst d cross join generate_series(-1, 1) n;
select pg_temp.licz(d.d23 + n) from t_dst d cross join generate_series(-1, 1) n;

select is((select string_agg(pg_temp.ruch(d.d25 + n, 'odslony')::text, ',' order by n)
             from t_dst d cross join generate_series(-1, 1) n),
          '1,25,1',
          'doba 25-godzinna: 25 odsłon (żadna godzina nie wypada), sekunda przed i początek następnej poza nią');
select is((select string_agg(pg_temp.ruch(d.d25 + n, 'unikalni')::text || '/' || pg_temp.ruch(d.d25 + n, 'sesje')::text, ',' order by n)
             from t_dst d cross join generate_series(-1, 1) n),
          '1/1,25/25,1/1',
          'doba 25-godzinna: unikalni i sesje po 25');
select is((select string_agg(pg_temp.ruch(d.d23 + n, 'odslony')::text, ',' order by n)
             from t_dst d cross join generate_series(-1, 1) n),
          '1,23,1',
          'doba 23-godzinna: 23 odsłony (00:30 i 23:30 w swojej dobie), sekunda przed i początek następnej poza nią');
select is((select string_agg(pg_temp.ruch(d.d23 + n, 'unikalni')::text || '/' || pg_temp.ruch(d.d23 + n, 'sesje')::text, ',' order by n)
             from t_dst d cross join generate_series(-1, 1) n),
          '1/1,23/23,1/1',
          'doba 23-godzinna: unikalni i sesje po 23');


-- ===================================================================
-- E. Przypadki szczególne i strażnik retencji
-- ===================================================================

-- Doba bez żadnego zdarzenia: stare wiersze znikają, nowych nie ma (brak danych, nie zero).
insert into public.analityka_dzienna (dzien, wymiar, klucz, wartosc)
values (pg_temp.dz(-15), 'ruch', 'odslony', 99), (pg_temp.dz(-15), 'kraj', 'PL', 99);
create temp table wynik_pusta as select public.analityka_zestaw_dzien(pg_temp.dz(-15)) as w;
select is(pg_temp.liczba_wierszy(pg_temp.dz(-15)), 0::bigint,
          'doba bez zdarzeń: brak wierszy (stare zestawienie zastąpione niczym, bez „zera udającego pomiar”)');
select is((select (w ->> 'zastapiono') || '/' || (w ->> 'wierszy') from wynik_pusta), '2/0',
          'doba bez zdarzeń: wynik mówi 2 zastąpione, 0 zapisanych');

-- Doba z samymi botami: komplet kluczy ruch (z zerami ludzi) i bot_ai.
alter table public.zdarzenia disable trigger zdarzenia_przed_insert;
insert into public.zdarzenia (czas, typ, ekran, sciezka, odcisk, urzadzenie, czy_bot, bot_rodzina, bot_klasa)
values (pg_temp.lok(pg_temp.dz(-18), '04:00'), 'odslona', 'szukaj', '/', 'b0b0000000000021', 'inne', true, 'claudebot', 'ai');
alter table public.zdarzenia enable trigger zdarzenia_przed_insert;
select pg_temp.licz(pg_temp.dz(-18));
select is(pg_temp.wymiar(pg_temp.dz(-18), 'ruch'),
          'odslony=0, odslony_boty=1, sesje=0, sesje_zaangazowane=0, unikalni=0',
          'doba z samym botem: komplet kluczy ruch, ludzie = 0, boty = 1');
select is(pg_temp.liczba_wierszy(pg_temp.dz(-18)), 6::bigint,
          'doba z samym botem: 5 kluczy ruch + bot_ai (żadnych ekranów ani sesji)');

-- Top 100 fraz: 105 różnych fraz, pierwsze pięć po dwa razy, reszta po razie. Do listy wchodzi
-- 5 + 95 fraz; remis rozstrzyga alfabet, więc odpadają 'fraza 101'..'fraza 105'.
alter table public.zdarzenia disable trigger zdarzenia_przed_insert;
insert into public.zdarzenia (czas, typ, ekran, sciezka, odcisk, urzadzenie, czy_bot, nazwa, wlasciwosci)
select pg_temp.lok(pg_temp.dz(-17), '12:00'),
       'produktowe', 'szukaj', '/', 'a9a9a9a9a9a9a9a9', 'mobile', false, 'wyszukanie_bez_wyniku',
       jsonb_build_object('fraza', 'fraza ' || lpad(x.p::text, 3, '0'))
  from (select p from generate_series(1, 105) p
        union all
        select p from generate_series(1, 5) p) x;
alter table public.zdarzenia enable trigger zdarzenia_przed_insert;
select pg_temp.licz(pg_temp.dz(-17));
select is((select count(*) from public.analityka_dzienna a
            where a.dzien = pg_temp.dz(-17) and a.wymiar = 'bez_wyniku'),
          100::bigint, 'bez_wyniku: lista obcięta do 100 fraz');
select is((select string_agg(a.klucz || '=' || a.wartosc, ',' order by a.klucz collate "C")
             from public.analityka_dzienna a
            where a.dzien = pg_temp.dz(-17) and a.wymiar = 'bez_wyniku'
              and a.klucz in ('fraza 001', 'fraza 005', 'fraza 006', 'fraza 100', 'fraza 101', 'fraza 105')),
          'fraza 001=2,fraza 005=2,fraza 006=1,fraza 100=1',
          'bez_wyniku: najpierw najczęstsze, potem alfabetycznie; fraza 101..105 odcięte');

-- Strażnik retencji: doba starsza niż 90 dni jest odrzucana i NIE kasuje zachowanego zestawienia.
insert into public.analityka_dzienna (dzien, wymiar, klucz, wartosc)
values (pg_temp.dz(-100), 'ruch', 'odslony', 777);
select throws_ok($q$select public.analityka_zestaw_dzien(pg_temp.dz(-100))$q$, '22023', null,
                 'strażnik retencji: doba sprzed 100 dni odrzucona (surowych zdarzeń już nie ma)');
select is(pg_temp.ruch(pg_temp.dz(-100), 'odslony'), 777::bigint,
          'strażnik retencji: zachowane zestawienie starej doby nietknięte');
select lives_ok($q$select public.analityka_zestaw_dzien(pg_temp.dz(-80))$q$,
                'strażnik retencji: doba sprzed 80 dni (w retencji) przelicza się normalnie');
select throws_ok($q$select public.analityka_zestaw_dzien(null)$q$, '22004', null,
                 'brak daty: czytelny błąd zamiast cichego zera');


-- ===================================================================
-- F. Retencja (analityka_sprzataj)
-- ===================================================================

-- Zdarzenia (wiek względem now(); wiersz rozpoznajemy po ścieżce /r/<wiek>):
--   91 dni (znika), 90 dni + 1 s (znika), dokładnie 90 dni (zostaje – granica ostra: czas < now() - 90 dni),
--   90 dni - 1 s (zostaje), 89 dni (zostaje).
-- Sól: -3 i -2 doby (znikają), -1 i 0 (zostają).
alter table public.zdarzenia disable trigger zdarzenia_przed_insert;
insert into public.zdarzenia (czas, typ, ekran, sciezka, odcisk, urzadzenie)
values (now() - interval '91 days',                       'odslona', 'metoda', '/r/91d',      'ab00000000000091', 'desktop'),
       (now() - interval '90 days' - interval '1 second', 'odslona', 'metoda', '/r/90d+1s',   'ab00000000000090', 'desktop'),
       (now() - interval '90 days',                       'odslona', 'metoda', '/r/90d',      'ab00000000000089', 'desktop'),
       (now() - interval '90 days' + interval '1 second', 'odslona', 'metoda', '/r/90d-1s',   'ab00000000000088', 'desktop'),
       (now() - interval '89 days',                       'odslona', 'metoda', '/r/89d',      'ab00000000000087', 'desktop');
alter table public.zdarzenia enable trigger zdarzenia_przed_insert;
insert into public.analityka_sol (dzien, sol)
values (pg_temp.dz(-3), repeat('a', 64)), (pg_temp.dz(-2), repeat('b', 64)),
       (pg_temp.dz(-1), repeat('c', 64)), (pg_temp.dz(0),  repeat('d', 64));
-- zachowane zestawienie bardzo starej doby (jak po wygaśnięciu surowych zdarzeń)
insert into public.analityka_dzienna (dzien, wymiar, klucz, wartosc)
values (pg_temp.dz(-300), 'ruch', 'odslony', 5);

create temp table przed_sprzataniem as
select (select count(*) from public.zdarzenia) as zdarzenia,
       (select count(*) from public.analityka_dzienna) as dzienna;
create temp table wynik_sprzatania as select public.analityka_sprzataj() as w;

select is((select w ->> 'zdarzenia_usunieto' from wynik_sprzatania), '2',
          'sprzątanie: usunięto 2 zdarzenia (91 dni i 90 dni + 1 s)');
select is((select string_agg(z.sciezka, ',' order by z.sciezka collate "C") from public.zdarzenia z where z.sciezka like '/r/%'),
          '/r/89d,/r/90d,/r/90d-1s',
          'sprzątanie: zostają zdarzenia z 89 dni, z granicy 90 dni (ostra) i tuż przed nią');
select is((select count(*) from public.zdarzenia), (select zdarzenia - 2 from przed_sprzataniem),
          'sprzątanie: pozostałe zdarzenia (doby testowe) nietknięte');
select is((select count(*) from public.analityka_dzienna), (select dzienna from przed_sprzataniem),
          'sprzątanie: zestawienia (analityka_dzienna) nietknięte');
select is(pg_temp.ruch(pg_temp.dz(-300), 'odslony'), 5::bigint,
          'sprzątanie: zestawienie sprzed 300 dni zostaje (przeżywa retencję surowych zdarzeń)');
select is((select w ->> 'sol_usunieto' from wynik_sprzatania), '2',
          'sprzątanie: usunięto sól sprzed 3 i 2 dób');
select is((select string_agg(s.dzien::text, ',' order by s.dzien) from public.analityka_sol s),
          pg_temp.dz(-1)::text || ',' || pg_temp.dz(0)::text,
          'sprzątanie: zostaje sól wczorajsza i dzisiejsza (najwyżej dwie doby)');


-- ===================================================================
-- G. Bieg nocny (analityka_cron) i ślad w analityka_biegi
-- ===================================================================

alter table public.zdarzenia disable trigger zdarzenia_przed_insert;
insert into public.zdarzenia (czas, typ, ekran, sciezka, odcisk, kraj, urzadzenie, kanal)
values (pg_temp.lok(pg_temp.dz(-1), '10:00'), 'odslona', 'szukaj', '/', 'c000000000000001', 'PL', 'desktop', 'bezposrednie'),
       (pg_temp.lok(pg_temp.dz(-2), '11:00'), 'odslona', 'szukaj', '/', 'c000000000000002', 'PL', 'desktop', 'bezposrednie');
insert into public.zdarzenia (czas, typ, ekran, sciezka, odcisk, urzadzenie)
values (now() - interval '95 days', 'odslona', 'metoda', '/r/95d', 'ab00000000000095', 'desktop');
alter table public.zdarzenia enable trigger zdarzenia_przed_insert;
insert into public.analityka_sol (dzien, sol) values (pg_temp.dz(-6), repeat('e', 64));

create temp table g0 as select coalesce(max(id), 0) as id from public.analityka_biegi;

select lives_ok($q$select public.analityka_cron()$q$, 'bieg nocny: pierwsze wywołanie nie rzuca');
select is((select count(*) from public.analityka_biegi b where b.id > (select id from g0)), 3::bigint,
          'bieg nocny: trzy wpisy w analityka_biegi (sprzątanie, zestawienie przedwczoraj, zestawienie wczoraj)');
select is((select string_agg(b.rodzaj, ',' order by b.id) from public.analityka_biegi b where b.id > (select id from g0)),
          'sprzatanie,zestaw,zestaw',
          'bieg nocny: zestawienie wczoraj idzie ostatnie (diagnostyka czyta najnowszy wiersz)');
select is((select count(*) from public.analityka_biegi b
            where b.id > (select id from g0) and b.koniec is not null and b.blad is null and b.start <= b.koniec),
          3::bigint, 'bieg nocny: każdy krok zakończony (koniec not null), bez błędu');
select is((select string_agg(b.wynik ->> 'dzien', ',' order by b.id) from public.analityka_biegi b
            where b.id > (select id from g0) and b.rodzaj = 'zestaw'),
          pg_temp.dz(-2)::text || ',' || pg_temp.dz(-1)::text,
          'bieg nocny: zestawienie przedwczoraj i wczoraj (doby warszawskie względem dzisiaj)');
select is(pg_temp.ruch(pg_temp.dz(-1), 'odslony') + pg_temp.ruch(pg_temp.dz(-2), 'odslony'), 2::bigint,
          'bieg nocny: zestawienia wczoraj i przedwczoraj zapisane (po jednej odsłonie)');
select ok(not exists (select 1 from public.zdarzenia where sciezka = '/r/95d')
          and not exists (select 1 from public.analityka_sol where dzien = pg_temp.dz(-6)),
          'bieg nocny: sprzątanie usunęło stare zdarzenie (95 dni) i starą sól');

create temp table po_pierwszym as
select (select count(*) from public.analityka_dzienna) as dzienna;
select lives_ok($q$select public.analityka_cron()$q$, 'bieg nocny: powtórka nie rzuca');
select is((select count(*) from public.analityka_biegi b where b.id > (select id from g0)), 6::bigint,
          'bieg nocny: powtórka dopisuje kolejne trzy wpisy');
select is((select count(*) from public.analityka_dzienna), (select dzienna from po_pierwszym),
          'bieg nocny: powtórka niczego nie dubluje w zestawieniu');

-- Wymuszony błąd ZESTAWIENIA: tripwire na analityka_dzienna odrzuca zapis kluczy ruch.
alter table public.analityka_dzienna add constraint t_blokada_ruch check (wymiar <> 'ruch') not valid;
create temp table g1 as select coalesce(max(id), 0) as id from public.analityka_biegi;
select lives_ok($q$select public.analityka_cron()$q$,
                'wymuszony błąd zestawienia: funkcja nie rzuca (cron nie widzi wyjątku)');
select is((select string_agg(coalesce(left(b.blad, 6), '-'), ',' order by b.id) from public.analityka_biegi b where b.id > (select id from g1)),
          '-,23514:,23514:',
          'wymuszony błąd zestawienia: oba zestawienia mają blad (SQLSTATE 23514), sprzątanie bez błędu');
select is((select count(*) from public.analityka_biegi b
            where b.id > (select id from g1) and b.koniec is not null and b.start <= b.koniec),
          3::bigint, 'wymuszony błąd zestawienia: koniec ustawiony także przy błędzie');
select is((select count(*) from public.analityka_dzienna), (select dzienna from po_pierwszym),
          'wymuszony błąd zestawienia: nieudany krok cofnięty w całości (stare zestawienia zostają)');
select is((select string_agg(b.wynik ->> 'sqlstate', ',' order by b.id) from public.analityka_biegi b
            where b.id > (select id from g1) and b.blad is not null),
          '23514,23514', 'wymuszony błąd zestawienia: kod błędu w wyniku kroku');
alter table public.analityka_dzienna drop constraint t_blokada_ruch;

-- Wymuszony błąd SPRZĄTANIA (kod 57014 jak przy przekroczeniu limitu czasu): zestawienia niezależne.
alter table public.zdarzenia disable trigger zdarzenia_przed_insert;
insert into public.zdarzenia (czas, typ, ekran, sciezka, odcisk, urzadzenie)
values (now() - interval '120 days', 'odslona', 'metoda', '/r/120d', 'ab00000000000120', 'desktop');
alter table public.zdarzenia enable trigger zdarzenia_przed_insert;
create function public.t_blokada_usuwania() returns trigger language plpgsql
as $f$ begin raise exception 'wymuszony blad sprzatania' using errcode = '57014'; end $f$;
create trigger t_blokada_usuwania before delete on public.zdarzenia
  for each row execute function public.t_blokada_usuwania();
create temp table g2 as select coalesce(max(id), 0) as id from public.analityka_biegi;
select lives_ok($q$select public.analityka_cron()$q$,
                'wymuszony błąd sprzątania: funkcja nie rzuca');
select is((select string_agg(coalesce(left(b.blad, 6), '-'), ',' order by b.id) from public.analityka_biegi b where b.id > (select id from g2)),
          '57014:,-,-',
          'wymuszony błąd sprzątania (57014, jak limit czasu): zapisany w blad, oba zestawienia przeszły');
select ok(exists (select 1 from public.zdarzenia where sciezka = '/r/120d'),
          'wymuszony błąd sprzątania: nieudane kasowanie cofnięte, zdarzenie zostało');
drop trigger t_blokada_usuwania on public.zdarzenia;
drop function public.t_blokada_usuwania();


-- ===================================================================
-- H. Harmonogram pg_cron (warunkowo)
-- ===================================================================

-- cron.job istnieje tylko tam, gdzie jest rozszerzenie (wolno je utworzyć wyłącznie w bazie
-- z cron.database_name), więc zapytanie idzie dynamicznie – bez tego test nie przeszedłby parsowania.
create function pg_temp.opis_zadania() returns text
language plpgsql
as $f$
declare
  v_opis text;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    return null;
  end if;
  execute $q$
    select count(*) || '|' || coalesce(min(schedule), '-') || '|' || coalesce(min(command), '-') || '|'
           || coalesce(bool_and(active)::text, '-')
      from cron.job where jobname = 'analityka-dzienna'
  $q$ into v_opis;
  return v_opis;
end
$f$;

select diag(case when pg_temp.opis_zadania() is null
                 then 'pg_cron NIE jest zainstalowany w bazie ' || current_database()
                      || ' – harmonogram niezmierzony (test pominięty, nie zaliczony)'
                 else 'pg_cron obecny w bazie ' || current_database() || ': ' || pg_temp.opis_zadania() end);
select case
         when pg_temp.opis_zadania() is null
           then skip('pg_cron niedostępny w tej bazie – harmonogram niesprawdzony', 1)
         else is(pg_temp.opis_zadania(), '1|20 1 * * *|select public.analityka_cron()|true',
                 'pg_cron: dokładnie jedno aktywne zadanie analityka-dzienna, 01:20 UTC, woła analityka_cron()')
       end;

select * from finish();

rollback;
