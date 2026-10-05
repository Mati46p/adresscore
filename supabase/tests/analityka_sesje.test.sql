-- Test pgTAP: sesje, zapis zdarzeń i trigger (specs/001-panel-analityka, zadanie T009).
--
-- Co sprawdza:
--   A. analityka_sesje(): luka 29 min = 1 sesja, 31 min = 2, dokładnie 30 min = 1; boty i odsłony
--      bez odcisku pominięte; wyjście dopasowane do WŁAŚCIWEJ odsłony (także gdy ma ten sam czas
--      co kolejna odsłona z tej samej paczki); okno +30 min bez kolejnej odsłony; ostatnia
--      sekcja; doby warszawskie przy zmianie czasu (2026-03-29 ma 23 h, 2026-10-25 ma 25 h),
--   B. zdarzenie_zapisz(): limit 1500/h na odcisk (wiersze tej samej paczki wliczają się),
--      wiersze niepoprawne pomijane pojedynczo, klient nie ustawia id ani czasu,
--   C. trigger zdarzenia_przed_insert: czas = now(), przycięcia i zakresy, komunikat bez długich
--      liczb, normalizacja sekcje/cta/wlasciwosci,
--   D. checki tabeli zdarzenia (to, co baza odrzuca zamiast przycinać).
--
-- Trigger nadpisuje czas na now(), więc dane do testów sesji wstawiamy z WYŁĄCZONYM triggerem
-- (znaczniki czasu wprost), a potem włączamy go z powrotem do reszty testów.
-- Test chodzi jako postgres w jednej transakcji, którą kończy ROLLBACK.

begin;

create extension if not exists pgtap with schema extensions;

select plan(82);


-- ===================================================================
-- Dane do testów sesji (trigger wyłączony na czas wstawiania)
-- ===================================================================

alter table public.zdarzenia disable trigger zdarzenia_przed_insert;

-- Kolejność wierszy w VALUES = kolejność id; ma znaczenie przy równych czasach (grupy c2, c3, c4 i c8).
insert into public.zdarzenia
  (czas, typ, ekran, sciezka, odcisk, urzadzenie, czy_bot, kanal, czas_ms, scroll_pc, sekcje)
values
  -- A. luka między odsłonami: 29 min (a1), 31 min (a2), dokładnie 30 min (a3), łańcuch luk po 20 min (a4)
  ('2026-10-01 10:00:00+00', 'odslona', 'szukaj',  '/',           'a1a1a1a1a1a1a1a1', 'mobile',  false, 'wyszukiwarka', null, null, null),
  ('2026-10-01 10:29:00+00', 'odslona', 'okolica', '/okolica/1',  'a1a1a1a1a1a1a1a1', 'mobile',  false, 'wewnetrzne',   null, null, null),
  ('2026-10-01 10:00:00+00', 'odslona', 'szukaj',  '/',           'a2a2a2a2a2a2a2a2', 'desktop', false, 'bezposrednie', null, null, null),
  ('2026-10-01 10:31:00+00', 'odslona', 'okolica', '/okolica/1',  'a2a2a2a2a2a2a2a2', 'desktop', false, 'wewnetrzne',   null, null, null),
  ('2026-10-01 10:00:00+00', 'odslona', 'szukaj',  '/',           'a3a3a3a3a3a3a3a3', 'desktop', false, 'social',       null, null, null),
  ('2026-10-01 10:30:00+00', 'odslona', 'okolica', '/okolica/1',  'a3a3a3a3a3a3a3a3', 'desktop', false, 'wewnetrzne',   null, null, null),
  ('2026-10-01 10:00:00+00', 'odslona', 'szukaj',  '/',           'a4a4a4a4a4a4a4a4', 'tablet',  false, 'ai',           null, null, null),
  ('2026-10-01 10:20:00+00', 'odslona', 'okolica', '/okolica/1',  'a4a4a4a4a4a4a4a4', 'tablet',  false, 'wewnetrzne',   null, null, null),
  ('2026-10-01 10:40:00+00', 'odslona', 'porownanie', '/porownanie', 'a4a4a4a4a4a4a4a4', 'tablet', false, 'wewnetrzne',  null, null, null),
  -- B. pomijane: bot z odciskiem, odsłona bez odcisku; kontrola: zwykły człowiek
  ('2026-10-01 10:00:00+00', 'odslona', 'szukaj',  '/',           'b0b0b0b0b0b0b0b0', 'desktop', true,  null,           null, null, null),
  ('2026-10-01 10:00:00+00', 'odslona', 'szukaj',  '/',           null,               'desktop', false, null,           null, null, null),
  ('2026-10-01 10:00:00+00', 'odslona', 'szukaj',  '/',           'b1b1b1b1b1b1b1b1', 'desktop', false, null,           null, null, null),

  -- C1. wyjście dopasowane do właściwej odsłony; zabłąkane wyjście nie przykleja się do późniejszej odsłony
  ('2026-10-02 10:00:00+00', 'odslona', 'okolica',    '/okolica/1',  'c1c1c1c1c1c1c1c1', 'desktop', false, null, null, null, null),
  ('2026-10-02 10:01:00+00', 'wyjscie', 'okolica',    '/okolica/1',  'c1c1c1c1c1c1c1c1', 'desktop', false, null, 12000, 60,
     '[{"k":"naglowek","ms":3000,"p":0},{"k":"zrodla","ms":8000,"p":3},{"k":"stopka","ms":0,"p":5}]'),
  ('2026-10-02 10:02:00+00', 'odslona', 'porownanie', '/porownanie', 'c1c1c1c1c1c1c1c1', 'desktop', false, null, null, null, null),
  ('2026-10-02 10:03:00+00', 'wyjscie', 'porownanie', '/porownanie', 'c1c1c1c1c1c1c1c1', 'desktop', false, null, 5000, 30, null),
  ('2026-10-02 10:04:00+00', 'wyjscie', 'okolica',    '/okolica/1',  'c1c1c1c1c1c1c1c1', 'desktop', false, null, 99999, 100, null),
  ('2026-10-02 10:10:00+00', 'odslona', 'okolica',    '/okolica/1',  'c1c1c1c1c1c1c1c1', 'desktop', false, null, null, null, null),
  -- C2. wyjście poprzedniej odsłony ma TEN SAM czas co następna odsłona (jedna paczka), id rozstrzyga
  ('2026-10-02 10:00:00+00', 'odslona', 'okolica',    '/okolica/2',  'c2c2c2c2c2c2c2c2', 'desktop', false, null, null, null, null),
  ('2026-10-02 10:02:00+00', 'wyjscie', 'okolica',    '/okolica/2',  'c2c2c2c2c2c2c2c2', 'desktop', false, null, 7000, null, null),
  ('2026-10-02 10:02:00+00', 'odslona', 'porownanie', '/porownanie', 'c2c2c2c2c2c2c2c2', 'desktop', false, null, null, null, null),
  ('2026-10-02 10:03:00+00', 'wyjscie', 'porownanie', '/porownanie', 'c2c2c2c2c2c2c2c2', 'desktop', false, null, 8000, null, null),
  -- C3. szybki powrót: odsłona i jej wyjście w jednej paczce (identyczny czas)
  ('2026-10-02 10:00:00+00', 'odslona', 'okolica',    '/okolica/3',  'c3c3c3c3c3c3c3c3', 'desktop', false, null, null, null, null),
  ('2026-10-02 10:00:00+00', 'wyjscie', 'okolica',    '/okolica/3',  'c3c3c3c3c3c3c3c3', 'desktop', false, null, 300, null, null),
  -- C4. dwie odsłony o identycznym czasie: kolejność z paczki (id)
  ('2026-10-02 10:00:00+00', 'odslona', 'szukaj',     '/',           'c4c4c4c4c4c4c4c4', 'desktop', false, null, null, null, null),
  ('2026-10-02 10:00:00+00', 'odslona', 'okolica',    '/okolica/4',  'c4c4c4c4c4c4c4c4', 'desktop', false, null, null, null, null),
  -- C5/C6. bez kolejnej odsłony wyjście musi wypaść w ciągu 30 min: 29 min pasuje, 31 min nie
  ('2026-10-02 10:00:00+00', 'odslona', 'okolica',    '/okolica/5',  'c5c5c5c5c5c5c5c5', 'desktop', false, null, null, null, null),
  ('2026-10-02 10:29:00+00', 'wyjscie', 'okolica',    '/okolica/5',  'c5c5c5c5c5c5c5c5', 'desktop', false, null, 1500000, null, null),
  ('2026-10-02 10:00:00+00', 'odslona', 'okolica',    '/okolica/6',  'c6c6c6c6c6c6c6c6', 'desktop', false, null, null, null, null),
  ('2026-10-02 10:31:00+00', 'wyjscie', 'okolica',    '/okolica/6',  'c6c6c6c6c6c6c6c6', 'desktop', false, null, 1700000, null, null),
  -- C7. ostatnia sekcja przy zepsutych elementach: zły typ ms, element niebędący obiektem,
  --     ujemny czas, brak klucza k – wszystkie pomijane, wygrywa "ok" (p = 2)
  ('2026-10-02 10:00:00+00', 'odslona', 'okolica',    '/okolica/7',  'c7c7c7c7c7c7c7c7', 'desktop', false, null, null, null, null),
  ('2026-10-02 10:01:00+00', 'wyjscie', 'okolica',    '/okolica/7',  'c7c7c7c7c7c7c7c7', 'desktop', false, null, 4000, 40,
     '[{"k":"x","ms":"abc","p":1},{"k":"ok","ms":5,"p":2},"tekst",{"k":"neg","ms":-5,"p":9},{"ms":3,"p":4}]'),
  -- C8. powrót na tę samą ścieżkę: wyjście z tym samym czasem co druga odsłona, ale PO niej w paczce,
  --     należy do drugiej odsłony, nie do pierwszej
  ('2026-10-02 10:00:00+00', 'odslona', 'okolica',    '/okolica/8',  'c8c8c8c8c8c8c8c8', 'desktop', false, null, null, null, null),
  ('2026-10-02 10:05:00+00', 'odslona', 'okolica',    '/okolica/8',  'c8c8c8c8c8c8c8c8', 'desktop', false, null, null, null, null),
  ('2026-10-02 10:05:00+00', 'wyjscie', 'okolica',    '/okolica/8',  'c8c8c8c8c8c8c8c8', 'desktop', false, null, 2000, null, null),
  -- C9. wyjście INNEJ ścieżki w oknie odsłony nie jest jej wyjściem (np. wyjście strony otwartej
  --     przed początkiem okna albo zgubione wyjście własnej odsłony)
  ('2026-10-02 10:00:00+00', 'odslona', 'okolica',    '/okolica/9',  'c9c9c9c9c9c9c9c9', 'desktop', false, null, null, null, null),
  ('2026-10-02 10:01:00+00', 'wyjscie', 'okolica',    '/inna/sciezka', 'c9c9c9c9c9c9c9c9', 'desktop', false, null, 777, null, null),

  -- D. doby warszawskie (wiosna: 23 h, jesień: 25 h) – po jednej odsłonie na odcisk
  ('2026-03-28 23:00:00+00', 'odslona', 'szukaj', '/', 'f1f1f1f1f1f1f1f1', 'desktop', false, null, null, null, null),
  ('2026-03-29 21:59:00+00', 'odslona', 'szukaj', '/', 'f2f2f2f2f2f2f2f2', 'desktop', false, null, null, null, null),
  ('2026-03-29 22:00:00+00', 'odslona', 'szukaj', '/', 'f3f3f3f3f3f3f3f3', 'desktop', false, null, null, null, null),
  ('2026-10-24 21:59:00+00', 'odslona', 'szukaj', '/', 'd4d4d4d4d4d4d4d4', 'desktop', false, null, null, null, null),
  ('2026-10-24 22:00:00+00', 'odslona', 'szukaj', '/', 'd1d1d1d1d1d1d1d1', 'desktop', false, null, null, null, null),
  ('2026-10-25 00:30:00+00', 'odslona', 'szukaj', '/', 'd6d6d6d6d6d6d6d6', 'desktop', false, null, null, null, null),
  ('2026-10-25 01:30:00+00', 'odslona', 'szukaj', '/', 'd7d7d7d7d7d7d7d7', 'desktop', false, null, null, null, null),
  ('2026-10-25 22:55:00+00', 'odslona', 'szukaj', '/', 'd5d5d5d5d5d5d5d5', 'desktop', false, null, null, null, null),
  ('2026-10-25 22:59:00+00', 'odslona', 'szukaj', '/', 'd2d2d2d2d2d2d2d2', 'desktop', false, null, null, null, null),
  ('2026-10-25 23:00:00+00', 'odslona', 'szukaj', '/', 'd3d3d3d3d3d3d3d3', 'desktop', false, null, null, null, null),
  -- sesja przecięta północą: ten sam odcisk, 10 minut przerwy
  ('2026-10-25 23:05:00+00', 'odslona', 'okolica', '/okolica/1', 'd5d5d5d5d5d5d5d5', 'desktop', false, null, null, null, null);

alter table public.zdarzenia enable trigger zdarzenia_przed_insert;

-- Opis sesji danego odcisku: poz|ekran|kolejny_ekran|czas_ms|scroll_pc|ostatnia_sekcja po kolei.
create function pg_temp.opis(p_odcisk text, p_od timestamptz default '2026-10-01 00:00:00+00')
returns text
language sql
stable
as $f$
  select string_agg(
           concat_ws('|', s.poz, s.ekran,
                     coalesce(s.kolejny_ekran, 'NULL'),
                     coalesce(s.czas_ms::text, 'NULL'),
                     coalesce(s.scroll_pc::text, 'NULL'),
                     coalesce(s.ostatnia_sekcja, 'NULL')),
           ' ; ' order by s.czas, s.poz)
    from public.analityka_sesje(p_od) s
   where s.sesja like p_odcisk || '-%'
$f$;


-- ===================================================================
-- A. Sesje
-- ===================================================================

select is((select count(distinct sesja) from public.analityka_sesje('2026-10-01 00:00:00+00')
            where sesja like 'a1a1a1a1a1a1a1a1-%'),
          1::bigint, 'luka 29 min: jedna sesja');
select is((select count(*) from public.analityka_sesje('2026-10-01 00:00:00+00')
            where sesja like 'a1a1a1a1a1a1a1a1-%'),
          2::bigint, 'luka 29 min: obie odsłony w sesji');
select is((select count(distinct sesja) from public.analityka_sesje('2026-10-01 00:00:00+00')
            where sesja like 'a2a2a2a2a2a2a2a2-%'),
          2::bigint, 'luka 31 min: dwie sesje');
select is((select count(distinct sesja) from public.analityka_sesje('2026-10-01 00:00:00+00')
            where sesja like 'a3a3a3a3a3a3a3a3-%'),
          1::bigint, 'luka dokładnie 30 min: nadal jedna sesja (nowa dopiero powyżej 30 min)');
select is((select string_agg(poz::text, ',' order by czas) from public.analityka_sesje('2026-10-01 00:00:00+00')
            where sesja like 'a4a4a4a4a4a4a4a4-%'),
          '1,2,3', 'łańcuch luk po 20 min: jedna sesja o długości 40 min, pozycje 1,2,3');
select is((select count(distinct sesja) from public.analityka_sesje('2026-10-01 00:00:00+00')
            where sesja like 'a4a4a4a4a4a4a4a4-%'),
          1::bigint, 'łańcuch luk po 20 min: sesja liczona lukami, nie całkowitym czasem');
select is((select string_agg(coalesce(kolejny_ekran, 'NULL'), ',' order by czas)
             from public.analityka_sesje('2026-10-01 00:00:00+00')
            where sesja like 'a4a4a4a4a4a4a4a4-%'),
          'okolica,porownanie,NULL', 'kolejny_ekran wskazuje następną odsłonę, ostatnia ma NULL');
select is((select string_agg(poz::text, ',' order by czas) from public.analityka_sesje('2026-10-01 00:00:00+00')
            where sesja like 'a2a2a2a2a2a2a2a2-%'),
          '1,1', 'po luce > 30 min numeracja pozycji zaczyna się od nowa');
select is((select concat_ws('|', ekran, sciezka, kanal, urzadzenie, dzien::text)
             from public.analityka_sesje('2026-10-01 00:00:00+00')
            where sesja like 'a1a1a1a1a1a1a1a1-%' order by czas limit 1),
          'szukaj|/|wyszukiwarka|mobile|2026-10-01',
          'odsłona przenosi ekran, ścieżkę, kanał i urządzenie; dzień = doba warszawska');

-- Pominięte: przesłanka (tabela ma 12 odsłon z tej doby) i wynik (10 ludzi z odciskiem).
select is((select count(*) from public.zdarzenia
            where typ = 'odslona' and czas >= '2026-10-01 00:00:00+00' and czas < '2026-10-02 00:00:00+00'),
          12::bigint, 'przesłanka: w tabeli jest 12 odsłon z 2026-10-01 (w tym bot i wiersz bez odcisku)');
select is((select count(*) from public.analityka_sesje('2026-10-01 00:00:00+00')
            where czas < '2026-10-02 00:00:00+00'),
          10::bigint, 'sesje zawierają tylko 10 odsłon ludzi z odciskiem');
select is((select count(*) from public.analityka_sesje('2026-10-01 00:00:00+00')
            where sesja like 'b0b0b0b0b0b0b0b0-%'),
          0::bigint, 'odsłona bota pominięta mimo odcisku');
select is((select count(*) from public.analityka_sesje('2026-10-01 00:00:00+00')
            where sesja like 'b1b1b1b1b1b1b1b1-%'),
          1::bigint, 'kontrola: zwykły człowiek obecny');


-- ===================================================================
-- A2. Dopasowanie wyjścia do odsłony
-- ===================================================================

select is(pg_temp.opis('c1c1c1c1c1c1c1c1'),
          '1|okolica|porownanie|12000|60|zrodla ; 2|porownanie|okolica|5000|30|NULL ; 3|okolica|NULL|NULL|NULL|NULL',
          'wyjście trafia do właściwej odsłony; zabłąkane wyjście (10:04) nie przykleja się do późniejszej odsłony tej samej ścieżki');
select is(pg_temp.opis('c2c2c2c2c2c2c2c2'),
          '1|okolica|porownanie|7000|NULL|NULL ; 2|porownanie|NULL|8000|NULL|NULL',
          'wyjście o czasie równym kolejnej odsłonie z tej samej paczki trafia do poprzedniej odsłony (rozstrzyga id)');
select is(pg_temp.opis('c3c3c3c3c3c3c3c3'),
          '1|okolica|NULL|300|NULL|NULL',
          'wyjście o czasie równym własnej odsłonie (jedna paczka) jest dopasowane');
select is(pg_temp.opis('c4c4c4c4c4c4c4c4'),
          '1|szukaj|okolica|NULL|NULL|NULL ; 2|okolica|NULL|NULL|NULL|NULL',
          'odsłony o identycznym czasie zachowują kolejność z paczki (id)');
select is(pg_temp.opis('c5c5c5c5c5c5c5c5'),
          '1|okolica|NULL|1500000|NULL|NULL',
          'bez kolejnej odsłony: wyjście po 29 min jest dopasowane');
select is(pg_temp.opis('c8c8c8c8c8c8c8c8'),
          '1|okolica|okolica|NULL|NULL|NULL ; 2|okolica|NULL|2000|NULL|NULL',
          'wyjście o czasie kolejnej odsłony, zapisane PO niej, należy do kolejnej odsłony (nie do poprzedniej tej samej ścieżki)');
select is(pg_temp.opis('c9c9c9c9c9c9c9c9'),
          '1|okolica|NULL|NULL|NULL|NULL',
          'wyjście innej ścieżki w oknie odsłony NIE jest dopasowane');
select is(pg_temp.opis('c6c6c6c6c6c6c6c6'),
          '1|okolica|NULL|NULL|NULL|NULL',
          'bez kolejnej odsłony: wyjście po 31 min NIE jest dopasowane');
select is(pg_temp.opis('c7c7c7c7c7c7c7c7'),
          '1|okolica|NULL|4000|40|ok',
          'ostatnia sekcja: zepsute elementy pomijane, wygrywa sekcja o najwyższej pozycji z czasem > 0');


-- ===================================================================
-- A3. Doby warszawskie i zmiana czasu
-- ===================================================================

select is((select string_agg(left(sesja, 2) || ' ' || dzien::text, ', ' order by czas, sesja)
             from public.analityka_sesje('2026-03-28 00:00:00+00')
            where left(sesja, 1) in ('d', 'f')),
          'f1 2026-03-29, f2 2026-03-29, f3 2026-03-30, d4 2026-10-24, d1 2026-10-25, d6 2026-10-25, '
          || 'd7 2026-10-25, d5 2026-10-25, d2 2026-10-25, d3 2026-10-26, d5 2026-10-25',
          'doba warszawska: granice północy przy zmianie czasu (wiosna 23 h, jesień 25 h)');
select is((select count(*) from public.analityka_sesje('2026-03-28 00:00:00+00')
            where left(sesja, 1) = 'd' and dzien = '2026-10-25'),
          6::bigint, 'doba 25-godzinna: żadna godzina nie wypada (w tym powtórzona 02:00–03:00)');
select is((select count(distinct sesja) from public.analityka_sesje('2026-03-28 00:00:00+00')
            where sesja like 'd5d5d5d5d5d5d5d5-%'),
          1::bigint, 'sesja przecięta północą: nadal jedna sesja (10 min przerwy)');
select is((select string_agg(left(sesja, 2), ',' order by czas)
             from public.analityka_sesje('2026-10-24 22:00:00+00')
            where left(sesja, 1) = 'd'),
          'd1,d6,d7,d5,d2,d3,d5',
          'p_od jest włączne (22:00:00 wchodzi), wcześniejsza odsłona (21:59) odpada');


-- ===================================================================
-- B. zdarzenie_zapisz(): limit, odporność, brak wpływu klienta na id i czas
-- ===================================================================

-- Limit 1500/h: 1495 wierszy już jest, paczka ma 10 tego samego odcisku – wchodzi 5 (wiersze
-- paczki wliczają się do limitu, bo kolejne zapytania widzą wcześniejsze wstawienia).
insert into public.zdarzenia (typ, ekran, sciezka, odcisk, urzadzenie)
select 'odslona', 'okolica', '/l/' || g, 'e1e1e1e1e1e1e1e1', 'desktop'
  from generate_series(1, 1495) g;

select is(public.zdarzenie_zapisz(
            (select jsonb_agg(jsonb_build_object('typ', 'odslona', 'ekran', 'okolica',
                                                 'sciezka', '/p/' || g, 'odcisk', 'e1e1e1e1e1e1e1e1',
                                                 'urzadzenie', 'desktop'))
               from generate_series(1, 10) g)),
          5, 'limit 1500/h: przy 1495 istniejących z paczki 10 wierszy zapisuje się 5');
select is((select count(*) from public.zdarzenia where odcisk = 'e1e1e1e1e1e1e1e1'),
          1500::bigint, 'limit 1500/h: odcisk ma dokładnie 1500 wierszy');
select is(public.zdarzenie_zapisz(
            (select jsonb_agg(jsonb_build_object('typ', 'odslona', 'ekran', 'okolica',
                                                 'sciezka', '/p/' || g, 'odcisk', 'e1e1e1e1e1e1e1e1',
                                                 'urzadzenie', 'desktop'))
               from generate_series(1, 3) g)),
          0, 'limit 1500/h: odcisk na limicie nie zapisuje nic');
select is(public.zdarzenie_zapisz(
            (select jsonb_agg(jsonb_build_object('typ', 'odslona', 'ekran', 'okolica',
                                                 'sciezka', '/p/' || g, 'odcisk', 'e2e2e2e2e2e2e2e2',
                                                 'urzadzenie', 'desktop'))
               from generate_series(1, 3) g)),
          3, 'limit dotyczy odcisku: inny odcisk zapisuje się normalnie');

update public.zdarzenia set czas = now() - interval '61 minutes' where odcisk = 'e1e1e1e1e1e1e1e1';
select is(public.zdarzenie_zapisz(
            (select jsonb_agg(jsonb_build_object('typ', 'odslona', 'ekran', 'okolica',
                                                 'sciezka', '/p/' || g, 'odcisk', 'e1e1e1e1e1e1e1e1',
                                                 'urzadzenie', 'desktop'))
               from generate_series(1, 10) g)),
          10, 'limit liczy tylko ostatnią godzinę: starsze wiersze nie blokują');

-- Boty też mają limit (User-Agent da się sfałszować na bota).
insert into public.zdarzenia (typ, ekran, sciezka, odcisk, urzadzenie, czy_bot)
select 'odslona', 'okolica', '/b/' || g, 'e3e3e3e3e3e3e3e3', 'desktop', true
  from generate_series(1, 1500) g;
select is(public.zdarzenie_zapisz(
            '[{"typ":"odslona","ekran":"okolica","sciezka":"/b/x","odcisk":"e3e3e3e3e3e3e3e3","urzadzenie":"desktop","czy_bot":true}]'::jsonb),
          0, 'limit 1500/h obejmuje też boty');

select has_index('public', 'zdarzenia', 'zdarzenia_odcisk_czas_idx',
                 'indeks po odcisku dla ludzi (limit i sesje)');
select has_index('public', 'zdarzenia', 'zdarzenia_odcisk_bot_czas_idx',
                 'indeks po odcisku dla botów (limit nie skanuje całej godziny)');

-- Górny limit paczki: 60 wierszy bez odcisku → zapisane pierwsze 50.
select is(public.zdarzenie_zapisz(
            (select jsonb_agg(jsonb_build_object('typ', 'odslona', 'ekran', 'okolica',
                                                 'sciezka', '/g/' || g, 'urzadzenie', 'desktop'))
               from generate_series(1, 60) g)),
          50, 'paczka ponad 50 wierszy: zapisane pierwsze 50');
select is((select max((regexp_replace(sciezka, '^/g/', ''))::int) from public.zdarzenia where sciezka like '/g/%'),
          50, 'górny limit paczki obcina od końca (zostają pierwsze 50)');

-- Odporność: jeden zły wiersz nie wywraca paczki.
select is(public.zdarzenie_zapisz($j$[
            {"typ":"odslona","ekran":"okolica","sciezka":"/o/dobry1","urzadzenie":"desktop"},
            {"typ":"zly","ekran":"okolica","sciezka":"/o/zly-typ","urzadzenie":"desktop"},
            {"typ":"odslona","ekran":"okolica","sciezka":"/o/zly-czas","urzadzenie":"desktop","czas_ms":"abc"},
            {"typ":"wital","ekran":"okolica","sciezka":"/o/zly-nan","urzadzenie":"desktop","nazwa":"lcp","wartosc":"NaN"},
            {"typ":"odslona","ekran":"Okolica","sciezka":"/o/zly-ekran","urzadzenie":"desktop"},
            5, "tekst", null,
            {"typ":"odslona","ekran":"okolica","sciezka":"/o/dobry2","urzadzenie":"desktop"}
          ]$j$::jsonb),
          2, 'paczka z błędnymi wierszami (zły typ, zła liczba, NaN, zły ekran, nie-obiekty): zapisują się 2 poprawne');
select is((select string_agg(sciezka, ',' order by id) from public.zdarzenia where sciezka like '/o/%'),
          '/o/dobry1,/o/dobry2',
          'zapisane dokładnie poprawne wiersze, w kolejności paczki');

select is(public.zdarzenie_zapisz(null), 0, 'null zamiast paczki → 0');
select is(public.zdarzenie_zapisz('"tekst"'::jsonb), 0, 'skalar zamiast paczki → 0');
select is(public.zdarzenie_zapisz('{"typ":"nieistotne"}'::jsonb), 0, 'obiekt bez wymaganych pól → 0');

-- Klient nie ustawia id ani czasu, a pola liczbowe i boolean przychodzą także jako liczby i teksty.
select is(public.zdarzenie_zapisz($j$[
            {"id":424242,"czas":"2000-01-01T00:00:00Z","typ":"wyjscie","ekran":"okolica",
             "sciezka":"/w/pelne","urzadzenie":"mobile","odcisk":"abcdef0123456789","kraj":"pl",
             "czy_bot":false,"czas_ms":5000000,"scroll_pc":250.4,
             "sekcje":[{"k":"a","ms":10,"p":1}],"cta":[{"k":"s§c","e":3,"n":1}],
             "wlasciwosci":{"x":1}}
          ]$j$::jsonb),
          1, 'pełne wyjście przez zdarzenie_zapisz zapisane');
select is((select concat_ws('|', (id = 424242)::text, (czas = now())::text, czas_ms, scroll_pc, kraj,
                            jsonb_array_length(sekcje), jsonb_array_length(cta))
             from public.zdarzenia where sciezka = '/w/pelne'),
          'false|true|1800000|100|PL|1|1',
          'klient nie ustawia id ani czasu; zakresy przycięte, kraj wielkimi, sekcje i cta zachowane');
select is(public.zdarzenie_zapisz($j$[
            {"typ":"odslona","ekran":"szukaj","sciezka":"/bot/1","urzadzenie":"inne",
             "czy_bot":true,"bot_rodzina":"gptbot","bot_klasa":"ai","odcisk":"0123456789abcdef"}
          ]$j$::jsonb),
          1, 'bot zapisany z oznaczeniem rodziny i klasy');
select is((select concat_ws('|', czy_bot::text, bot_rodzina, bot_klasa)
             from public.zdarzenia where sciezka = '/bot/1'),
          'true|gptbot|ai', 'bot: czy_bot, rodzina i klasa zapisane');


-- ===================================================================
-- C. Trigger zdarzenia_przed_insert
-- ===================================================================

insert into public.zdarzenia (czas, typ, ekran, sciezka, urzadzenie, czas_ms, scroll_pc)
values ('2000-01-01 00:00:00+00', 'wyjscie', 'okolica', '/t/zakres-1', 'desktop', 5000000, 250),
       (now(),                    'wyjscie', 'okolica', '/t/zakres-2', 'desktop', -5, -3),
       (now(),                    'wyjscie', 'okolica', '/t/zakres-3', 'desktop', 1800000, 100);

select is((select czas_ms from public.zdarzenia where sciezka = '/t/zakres-1'), 1800000,
          'trigger: czas_ms > 1 800 000 przycięty do 1 800 000');
select is((select czas_ms from public.zdarzenia where sciezka = '/t/zakres-2'), 0,
          'trigger: ujemny czas_ms przycięty do 0');
select is((select czas_ms from public.zdarzenia where sciezka = '/t/zakres-3'), 1800000,
          'trigger: wartość graniczna 1 800 000 bez zmian');
select is((select scroll_pc from public.zdarzenia where sciezka = '/t/zakres-1'), 100::smallint,
          'trigger: scroll_pc > 100 przycięty do 100');
select is((select scroll_pc from public.zdarzenia where sciezka = '/t/zakres-2'), 0::smallint,
          'trigger: ujemny scroll_pc przycięty do 0');
select ok((select czas = now() from public.zdarzenia where sciezka = '/t/zakres-1'),
          'trigger: czas nadpisany na now() (klient podał rok 2000)');

insert into public.zdarzenia (typ, ekran, sciezka, urzadzenie, komunikat)
values ('blad', 'okolica', '/t/kom-1', 'desktop', 'Błąd 1234567 i 12345 oraz 98765432101234'),
       ('blad', 'okolica', '/t/kom-2', 'desktop', repeat('x', 500)),
       ('blad', 'okolica', '/t/kom-3', 'desktop', repeat('x', 195) || '12345678901'),
       ('blad', 'okolica', '/t/kom-4', 'desktop', 'sześć 123456 siedem 1234567');

select is((select komunikat from public.zdarzenia where sciezka = '/t/kom-1'),
          'Błąd # i 12345 oraz #', 'trigger: liczby ≥ 7 cyfr zamienione na #, krótsze zostają');
select is((select char_length(komunikat) from public.zdarzenia where sciezka = '/t/kom-2'), 200,
          'trigger: komunikat przycięty do 200 znaków');
select is((select komunikat from public.zdarzenia where sciezka = '/t/kom-3'), repeat('x', 195) || '#',
          'trigger: liczby zamieniane PRZED przycięciem (końcówka długiej liczby nie wycieka)');
select is((select komunikat from public.zdarzenia where sciezka = '/t/kom-4'), 'sześć 123456 siedem #',
          'trigger: 6 cyfr zostaje, 7 cyfr → #');

-- Normalizacja kodów i tekstów swobodnych.
insert into public.zdarzenia
  (typ, ekran, sciezka, urzadzenie, odcisk, kraj, referer_host, referer_sciezka, utm_source, utm_medium, utm_campaign, etykieta, bot_rodzina)
values ('odslona', 'okolica', '/t/norm', 'desktop', 'ABCDEF0123456789', 'pl', 'WWW.Google.COM',
        repeat('r', 300), 'Facebook', '', repeat('K', 100), '', repeat('b', 60));
select is((select concat_ws('|', odcisk, kraj, referer_host, char_length(referer_sciezka), utm_source,
                            coalesce(utm_medium, 'NULL'), char_length(utm_campaign), (utm_campaign = lower(utm_campaign))::text,
                            coalesce(etykieta, 'NULL'), char_length(bot_rodzina))
             from public.zdarzenia where sciezka = '/t/norm'),
          'abcdef0123456789|PL|google.com|200|facebook|NULL|60|true|NULL|40',
          'trigger: odcisk małymi, kraj wielkimi, referer bez www i małymi, przycięcia, puste teksty → NULL');

insert into public.zdarzenia (typ, ekran, sciezka, urzadzenie)
values ('odslona', 'okolica', repeat('s', 600), 'desktop');
select is((select char_length(sciezka) from public.zdarzenia where sciezka like 'sss%' and typ = 'odslona' limit 1),
          512, 'trigger: ścieżka przycięta do 512 znaków');

-- wlasciwosci: ≤ 12 kluczy, tylko skalary, teksty ≤ 200 znaków, nie-obiekt → NULL.
insert into public.zdarzenia (typ, ekran, sciezka, urzadzenie, nazwa, wlasciwosci)
values ('produktowe', 'okolica', '/t/wl-1', 'desktop', 'wyszukanie',
        (select jsonb_object_agg('k' || lpad(g::text, 2, '0'), g) from generate_series(1, 15) g)),
       ('produktowe', 'okolica', '/t/wl-2', 'desktop', 'wyszukanie',
        jsonb_build_object('dlugi', repeat('x', 500), 'zagniezdzony', jsonb_build_object('a', 1),
                           'tablica', jsonb_build_array(1), 'pusty', null, 'liczba', 7, 'tak', true)),
       ('produktowe', 'okolica', '/t/wl-3', 'desktop', 'wyszukanie', jsonb_build_array(1, 2)),
       ('produktowe', 'okolica', '/t/wl-4', 'desktop', 'wyszukanie', null);

select is((select count(*) from jsonb_object_keys((select wlasciwosci from public.zdarzenia where sciezka = '/t/wl-1'))),
          12::bigint, 'trigger: wlasciwosci przycięte do 12 kluczy');
select ok((select jsonb_exists(wlasciwosci, 'k12') and not jsonb_exists(wlasciwosci, 'k13')
             from public.zdarzenia where sciezka = '/t/wl-1'),
          'trigger: zostają pierwsze 12 kluczy alfabetycznie (deterministycznie)');
select is((select (select string_agg(k, ',' order by k) from jsonb_object_keys(wlasciwosci) k)
             from public.zdarzenia where sciezka = '/t/wl-2'),
          'dlugi,liczba,tak', 'trigger: zagnieżdżone obiekty, tablice i null wypadają, skalary zostają');
select is((select char_length(wlasciwosci ->> 'dlugi') from public.zdarzenia where sciezka = '/t/wl-2'),
          200, 'trigger: tekstowa wartość właściwości przycięta do 200 znaków');
select is((select wlasciwosci from public.zdarzenia where sciezka = '/t/wl-3'), null::jsonb,
          'trigger: wlasciwosci niebędące obiektem → NULL');
select is((select wlasciwosci from public.zdarzenia where sciezka = '/t/wl-4'), null::jsonb,
          'trigger: brak wlasciwosci zostaje NULL');

-- sekcje i cta: nadmiar odcięty od końca, puste i nie-tablice → NULL.
insert into public.zdarzenia (typ, ekran, sciezka, urzadzenie, sekcje, cta)
values ('wyjscie', 'okolica', '/t/sk-1', 'desktop',
        (select jsonb_agg(jsonb_build_object('k', 's' || g, 'ms', 100, 'p', g)) from generate_series(1, 30) g),
        (select jsonb_agg(jsonb_build_object('k', 'c' || g, 'e', 1, 'n', 0)) from generate_series(1, 20) g)),
       ('wyjscie', 'okolica', '/t/sk-2', 'desktop', '[]'::jsonb, '"tekst"'::jsonb),
       ('wyjscie', 'okolica', '/t/sk-3', 'desktop', '{"k":"a"}'::jsonb, '[]'::jsonb);

select is((select concat_ws('|', jsonb_array_length(sekcje), sekcje -> 0 ->> 'k', sekcje -> 23 ->> 'k',
                            jsonb_array_length(cta), cta -> 11 ->> 'k')
             from public.zdarzenia where sciezka = '/t/sk-1'),
          '24|s1|s24|12|c12', 'trigger: sekcje przycięte do 24, cta do 12 (zostają pierwsze elementy)');
select is((select concat_ws('|', coalesce(sekcje::text, 'NULL'), coalesce(cta::text, 'NULL'))
             from public.zdarzenia where sciezka = '/t/sk-2'),
          'NULL|NULL', 'trigger: pusta tablica sekcji i nie-tablica cta → NULL');
select is((select concat_ws('|', coalesce(sekcje::text, 'NULL'), coalesce(cta::text, 'NULL'))
             from public.zdarzenia where sciezka = '/t/sk-3'),
          'NULL|NULL', 'trigger: obiekt zamiast tablicy sekcji i pusta tablica cta → NULL');


-- ===================================================================
-- D. Checki tabeli zdarzenia (odrzucenie zamiast przycięcia)
-- ===================================================================

select throws_ok($q$insert into public.zdarzenia (typ, ekran, sciezka, urzadzenie)
                     values ('nieznany', 'okolica', '/c', 'desktop')$q$, '23514', null,
                 'check: nieznany typ odrzucony');
select throws_ok($q$insert into public.zdarzenia (typ, ekran, sciezka, urzadzenie)
                     values ('odslona', 'Okolica', '/c', 'desktop')$q$, '23514', null,
                 'check: ekran spoza ^[a-z_]{1,24}$ odrzucony');
select throws_ok($q$insert into public.zdarzenia (typ, ekran, sciezka, urzadzenie)
                     values ('odslona', 'okolica', '', 'desktop')$q$, '23514', null,
                 'check: pusta ścieżka odrzucona');
select throws_ok($q$insert into public.zdarzenia (typ, ekran, sciezka, urzadzenie)
                     values ('odslona', 'okolica', '/c', 'telewizor')$q$, '23514', null,
                 'check: nieznana klasa urządzenia odrzucona');
select throws_ok($q$insert into public.zdarzenia (typ, ekran, sciezka, urzadzenie, odcisk)
                     values ('odslona', 'okolica', '/c', 'desktop', 'xyz')$q$, '23514', null,
                 'check: odcisk inny niż 16 znaków hex odrzucony (bez obcinania)');
select throws_ok($q$insert into public.zdarzenia (typ, ekran, sciezka, urzadzenie, kraj)
                     values ('odslona', 'okolica', '/c', 'desktop', 'POL')$q$, '23514', null,
                 'check: kraj inny niż dwie litery odrzucony');
select throws_ok($q$insert into public.zdarzenia (typ, ekran, sciezka, urzadzenie, kanal)
                     values ('odslona', 'okolica', '/c', 'desktop', 'telepatia')$q$, '23514', null,
                 'check: nieznany kanał wejścia odrzucony');
select throws_ok($q$insert into public.zdarzenia (typ, ekran, sciezka, urzadzenie, click_id)
                     values ('odslona', 'okolica', '/c', 'desktop', 'ZXCV123456')$q$, '23514', null,
                 'check: click_id tylko z listy nazw parametrów (nigdy wartość)');
select throws_ok($q$insert into public.zdarzenia (typ, ekran, sciezka, urzadzenie, nazwa)
                     values ('produktowe', 'okolica', '/c', 'desktop', 'Zła nazwa')$q$, '23514', null,
                 'check: nazwa zdarzenia musi być snake_case ASCII');
select throws_ok($q$insert into public.zdarzenia (typ, ekran, sciezka, urzadzenie)
                     values ('produktowe', 'okolica', '/c', 'desktop')$q$, '23514', null,
                 'check: zdarzenie produktowe wymaga nazwy');
select throws_ok($q$insert into public.zdarzenia (typ, ekran, sciezka, urzadzenie, nazwa)
                     values ('wital', 'okolica', '/c', 'desktop', 'lcp')$q$, '23514', null,
                 'check: wital wymaga wartości');
select throws_ok($q$insert into public.zdarzenia (typ, ekran, sciezka, urzadzenie, nazwa, wartosc)
                     values ('wital', 'okolica', '/c', 'desktop', 'fid', 10)$q$, '23514', null,
                 'check: wital tylko z metryk lcp, inp, cls, fcp, ttfb');
select throws_ok($q$insert into public.zdarzenia (typ, ekran, sciezka, urzadzenie, nazwa, wartosc)
                     values ('wital', 'okolica', '/c', 'desktop', 'lcp', 'NaN')$q$, '23514', null,
                 'check: NaN w wartosc odrzucony (zatruwałby p75)');
select throws_ok($q$insert into public.zdarzenia (typ, ekran, sciezka, urzadzenie, nazwa, wartosc)
                     values ('wital', 'okolica', '/c', 'desktop', 'lcp', -1)$q$, '23514', null,
                 'check: ujemna wartosc odrzucona');
select throws_ok($q$insert into public.zdarzenia (typ, ekran, sciezka, urzadzenie)
                     values ('blad', 'okolica', '/c', 'desktop')$q$, '23514', null,
                 'check: błąd klienta wymaga komunikatu');
select lives_ok($q$insert into public.zdarzenia (typ, ekran, sciezka, urzadzenie, nazwa, wartosc)
                   values ('wital', 'okolica', '/c', 'desktop', 'cls', 0.05)$q$,
                'check: poprawny wital (CLS jako ułamek) wchodzi');

select * from finish();

rollback;
