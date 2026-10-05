-- Test pgTAP: bramka dostępu do analityki (specs/001-panel-analityka, zadanie T008).
--
-- Co sprawdza:
--   A. RLS włączony wszędzie, dokładnie te polityki, które mają być (zero na admini i analityka_sol),
--   B. prawa do tabel dla anon i authenticated (druga zapora obok RLS),
--   C. prawa do funkcji: kto może je wywołać, brak EXECUTE dla PUBLIC, security definer + pusty
--      search_path,
--   D. zachowanie na żywo: anon, konto spoza admini, admin i service_role (symulacja sesji przez
--      request.jwt.claims),
--   E. sól dnia (analityka_sol_dzis) – tworzenie, stabilność w dobie, rotacja,
--   F. DETEKTOR bramki dla KAŻDEJ public.admin_*: security definer, wywołanie jest_adminem(), brak
--      EXECUTE dla anon, EXECUTE dla authenticated, pusty search_path. Faza 6 doda te funkcje;
--      do tego czasu detektor mierzy zero funkcji, więc udowadniamy, że łapie zepsute (funkcje
--      próbne tworzone i wycofywane w transakcji testu), i wypisujemy liczbę sprawdzonych.
--
-- Test chodzi jako postgres w jednej transakcji, którą kończy ROLLBACK – nic nie zostaje w bazie.

begin;

create extension if not exists pgtap with schema extensions;

select plan(64);


-- ===================================================================
-- A. RLS i polityki
-- ===================================================================

select ok((select relrowsecurity from pg_class where oid = 'public.admini'::regclass),
          'admini: RLS włączony');
select ok((select relrowsecurity from pg_class where oid = 'public.zdarzenia'::regclass),
          'zdarzenia: RLS włączony');
select ok((select relrowsecurity from pg_class where oid = 'public.analityka_sol'::regclass),
          'analityka_sol: RLS włączony');
select ok((select relrowsecurity from pg_class where oid = 'public.analityka_dzienna'::regclass),
          'analityka_dzienna: RLS włączony');
select ok((select relrowsecurity from pg_class where oid = 'public.analityka_biegi'::regclass),
          'analityka_biegi: RLS włączony');

select is((select count(*) from pg_policies
            where schemaname = 'public' and tablename in ('admini', 'analityka_sol')),
          0::bigint,
          'admini i analityka_sol: zero polityk (czyta tylko security definer i service_role)');

select policies_are('public', 'zdarzenia', array['zdarzenia_select_admin'],
                    'zdarzenia: jedna polityka (select dla admina), brak insert/update/delete');
select policies_are('public', 'analityka_dzienna', array['analityka_dzienna_select_admin'],
                    'analityka_dzienna: jedna polityka (select dla admina)');
select policies_are('public', 'analityka_biegi', array['analityka_biegi_select_admin'],
                    'analityka_biegi: jedna polityka (select dla admina)');

select is((select count(*) from pg_policies
            where schemaname = 'public'
              and tablename in ('zdarzenia', 'analityka_dzienna', 'analityka_biegi')
              and cmd = 'SELECT'
              and roles = '{authenticated}'
              and qual ilike '%jest_adminem()%'),
          3::bigint,
          'trzy polityki: SELECT dla authenticated, warunek przez jest_adminem()');


-- ===================================================================
-- B. Prawa do tabel (obrona w głąb: REVOKE obok RLS)
-- ===================================================================

select results_eq(
  $q$
    select r.rola, t.tabela,
           coalesce((select string_agg(p, ',' order by p)
                       from unnest(array['select', 'insert', 'update', 'delete',
                                         'truncate', 'references', 'trigger']) as p
                      where has_table_privilege(r.rola, format('public.%I', t.tabela), p)), '') as prawa
      from (values ('anon'), ('authenticated')) as r(rola)
     cross join (values ('admini'), ('analityka_biegi'), ('analityka_dzienna'),
                        ('analityka_sol'), ('zdarzenia')) as t(tabela)
     order by 1, 2
  $q$,
  $q$
    values ('anon', 'admini', ''),
           ('anon', 'analityka_biegi', ''),
           ('anon', 'analityka_dzienna', ''),
           ('anon', 'analityka_sol', ''),
           ('anon', 'zdarzenia', ''),
           ('authenticated', 'admini', ''),
           ('authenticated', 'analityka_biegi', 'select'),
           ('authenticated', 'analityka_dzienna', 'select'),
           ('authenticated', 'analityka_sol', ''),
           ('authenticated', 'zdarzenia', 'select')
  $q$,
  'prawa do tabel: anon nie ma nic, authenticated tylko select na zdarzenia/dzienna/biegi'
);


-- ===================================================================
-- C. Prawa do funkcji
-- ===================================================================

select results_eq(
  $q$
    select f.sygnatura, r.rola, has_function_privilege(r.rola, f.sygnatura, 'execute')
      from (values ('public.jest_adminem()'),
                   ('public.zdarzenie_zapisz(jsonb)'),
                   ('public.analityka_sol_dzis()'),
                   ('public.analityka_sesje(timestamptz)'),
                   ('public.zdarzenia_przed_insert()')) as f(sygnatura)
     cross join (values ('anon'), ('authenticated'), ('service_role')) as r(rola)
     -- service_role dla helpera sesji i funkcji wyzwalacza nie jest ustalony kontraktem
     where not (f.sygnatura in ('public.analityka_sesje(timestamptz)', 'public.zdarzenia_przed_insert()')
                and r.rola = 'service_role')
     order by 1, 2
  $q$,
  $q$
    values ('public.analityka_sesje(timestamptz)', 'anon', false),
           ('public.analityka_sesje(timestamptz)', 'authenticated', false),
           ('public.analityka_sol_dzis()', 'anon', false),
           ('public.analityka_sol_dzis()', 'authenticated', false),
           ('public.analityka_sol_dzis()', 'service_role', true),
           ('public.jest_adminem()', 'anon', false),
           ('public.jest_adminem()', 'authenticated', true),
           ('public.jest_adminem()', 'service_role', true),
           ('public.zdarzenia_przed_insert()', 'anon', false),
           ('public.zdarzenia_przed_insert()', 'authenticated', false),
           ('public.zdarzenie_zapisz(jsonb)', 'anon', false),
           ('public.zdarzenie_zapisz(jsonb)', 'authenticated', false),
           ('public.zdarzenie_zapisz(jsonb)', 'service_role', true)
  $q$,
  'EXECUTE: zapis i sól tylko service_role, jest_adminem dla authenticated i service_role, helper sesji nikt z klientów'
);

select is((select count(*)
             from pg_proc p,
                  lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) as a
            where p.oid in ('public.jest_adminem()'::regprocedure,
                            'public.zdarzenie_zapisz(jsonb)'::regprocedure,
                            'public.analityka_sol_dzis()'::regprocedure,
                            'public.analityka_sesje(timestamptz)'::regprocedure,
                            'public.zdarzenia_przed_insert()'::regprocedure)
              and a.grantee = 0),
          0::bigint,
          'żadna funkcja fundamentu nie jest wykonywalna dla PUBLIC');

select is((select count(*)
             from pg_proc p
            where p.oid in ('public.jest_adminem()'::regprocedure,
                            'public.zdarzenie_zapisz(jsonb)'::regprocedure,
                            'public.analityka_sol_dzis()'::regprocedure,
                            'public.analityka_sesje(timestamptz)'::regprocedure,
                            'public.zdarzenia_przed_insert()'::regprocedure)
              and p.prosecdef
              and p.proconfig @> array['search_path=""']),
          5::bigint,
          'wszystkie 5 funkcji fundamentu: security definer i pusty search_path');


-- ===================================================================
-- D. Zachowanie na żywo
-- ===================================================================

-- Dane: dwa konta, jedno na liście adminów, po jednym wierszu w tabelach czytanych przez panel.
insert into auth.users (id, email)
values ('aaaaaaaa-0000-0000-0000-000000000001', 'admin@test.invalid'),
       ('aaaaaaaa-0000-0000-0000-000000000002', 'inny@test.invalid');
insert into public.admini (user_id) values ('aaaaaaaa-0000-0000-0000-000000000001');
insert into public.zdarzenia (typ, ekran, sciezka, urzadzenie)
values ('odslona', 'okolica', '/okolica/1', 'desktop');
insert into public.analityka_dzienna (dzien, wymiar, klucz, wartosc)
values ('2026-10-01', 'ruch', 'odslony', 5);
insert into public.analityka_biegi (rodzaj) values ('zestaw');

-- --- anon: klucz publiczny bez sesji ---
set local role anon;

select throws_ok($q$select count(*) from public.zdarzenia$q$, '42501', null,
                 'anon: odczyt zdarzenia odrzucony');
select throws_ok($q$select count(*) from public.analityka_dzienna$q$, '42501', null,
                 'anon: odczyt analityka_dzienna odrzucony');
select throws_ok($q$select count(*) from public.analityka_biegi$q$, '42501', null,
                 'anon: odczyt analityka_biegi odrzucony');
select throws_ok($q$select count(*) from public.admini$q$, '42501', null,
                 'anon: odczyt admini odrzucony');
select throws_ok($q$select count(*) from public.analityka_sol$q$, '42501', null,
                 'anon: odczyt analityka_sol odrzucony');
select throws_ok($q$insert into public.zdarzenia (typ, ekran, sciezka, urzadzenie)
                     values ('odslona', 'okolica', '/x', 'desktop')$q$,
                 '42501', null, 'anon: zapis do zdarzenia odrzucony');
select throws_ok($q$update public.zdarzenia set ekran = 'szukaj'$q$, '42501', null,
                 'anon: update zdarzenia odrzucony');
select throws_ok($q$delete from public.zdarzenia$q$, '42501', null,
                 'anon: delete zdarzenia odrzucony');
select throws_ok($q$select public.zdarzenie_zapisz('[]'::jsonb)$q$, '42501', null,
                 'anon: zdarzenie_zapisz niewykonywalne');
select throws_ok($q$select public.analityka_sol_dzis()$q$, '42501', null,
                 'anon: analityka_sol_dzis niewykonywalne');
select throws_ok($q$select * from public.analityka_sesje(now())$q$, '42501', null,
                 'anon: analityka_sesje niewykonywalne');

reset role;

-- --- authenticated, konto spoza admini ---
select set_config('request.jwt.claims',
                  '{"sub":"aaaaaaaa-0000-0000-0000-000000000002","role":"authenticated"}', true);
set local role authenticated;

select is((select count(*) from public.zdarzenia), 0::bigint,
          'konto spoza admini: zdarzenia – zero wierszy mimo istniejącego wiersza (RLS)');
select is((select count(*) from public.analityka_dzienna), 0::bigint,
          'konto spoza admini: analityka_dzienna – zero wierszy');
select is((select count(*) from public.analityka_biegi), 0::bigint,
          'konto spoza admini: analityka_biegi – zero wierszy');
select throws_ok($q$select count(*) from public.admini$q$, '42501', null,
                 'konto spoza admini: nie czyta listy adminów');
select throws_ok($q$select count(*) from public.analityka_sol$q$, '42501', null,
                 'konto spoza admini: nie czyta soli');
select throws_ok($q$insert into public.zdarzenia (typ, ekran, sciezka, urzadzenie)
                     values ('odslona', 'okolica', '/x', 'desktop')$q$,
                 '42501', null, 'konto spoza admini: zapis do zdarzenia odrzucony');
select throws_ok($q$insert into public.admini (user_id)
                     values ('aaaaaaaa-0000-0000-0000-000000000002')$q$,
                 '42501', null, 'konto spoza admini: nie dopisze się do listy adminów');
select is(public.jest_adminem(), false, 'konto spoza admini: jest_adminem() = false');
select throws_ok($q$select public.zdarzenie_zapisz('[]'::jsonb)$q$, '42501', null,
                 'konto spoza admini: zdarzenie_zapisz niewykonywalne');
select throws_ok($q$select public.analityka_sol_dzis()$q$, '42501', null,
                 'konto spoza admini: analityka_sol_dzis niewykonywalne');
select throws_ok($q$select * from public.analityka_sesje(now())$q$, '42501', null,
                 'konto spoza admini: analityka_sesje niewykonywalne');

reset role;

-- --- authenticated, admin ---
select set_config('request.jwt.claims',
                  '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;

select is(public.jest_adminem(), true, 'admin: jest_adminem() = true');
select is((select count(*) from public.zdarzenia), 1::bigint, 'admin: widzi zdarzenia');
select is((select count(*) from public.analityka_dzienna), 1::bigint, 'admin: widzi analityka_dzienna');
select is((select count(*) from public.analityka_biegi), 1::bigint, 'admin: widzi analityka_biegi');
select throws_ok($q$insert into public.zdarzenia (typ, ekran, sciezka, urzadzenie)
                     values ('odslona', 'okolica', '/x', 'desktop')$q$,
                 '42501', null, 'admin: zapis wprost do zdarzenia odrzucony (tylko zdarzenie_zapisz)');
select throws_ok($q$delete from public.zdarzenia$q$, '42501', null,
                 'admin: delete zdarzenia odrzucony');
select throws_ok($q$select count(*) from public.admini$q$, '42501', null,
                 'admin: lista adminów niewidoczna nawet dla admina (tylko przez bramkę)');
select throws_ok($q$select public.zdarzenie_zapisz('[]'::jsonb)$q$, '42501', null,
                 'admin: zdarzenie_zapisz niewykonywalne (zapis tylko serwerem)');

reset role;

-- --- service_role: endpoint zapisu ---
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;

select is(public.jest_adminem(), false, 'service_role bez sesji użytkownika: jest_adminem() = false');
select is(public.zdarzenie_zapisz('[]'::jsonb), 0, 'service_role: zdarzenie_zapisz wykonalne (pusta paczka → 0)');
select matches(public.analityka_sol_dzis(), '^[0-9a-f]{64}$',
               'service_role: sól dnia to 64 znaki hex');
select is(public.analityka_sol_dzis(), public.analityka_sol_dzis(),
          'sól jest stała w obrębie doby (kolejne wywołania zwracają tę samą)');

reset role;

-- --- admin usunięty z listy w trakcie sesji (przypadek brzegowy ze specyfikacji) ---
delete from public.admini where user_id = 'aaaaaaaa-0000-0000-0000-000000000001';

select set_config('request.jwt.claims',
                  '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;

select is(public.jest_adminem(), false,
          'admin usunięty z listy: ten sam token od razu traci dostęp');
select is((select count(*) from public.zdarzenia), 0::bigint,
          'admin usunięty z listy: zdarzenia znów niewidoczne');

reset role;

-- --- kaskada: usunięcie konta usuwa wpis admina ---
insert into public.admini (user_id) values ('aaaaaaaa-0000-0000-0000-000000000002');
delete from auth.users where id = 'aaaaaaaa-0000-0000-0000-000000000002';
select is((select count(*) from public.admini where user_id = 'aaaaaaaa-0000-0000-0000-000000000002'),
          0::bigint, 'usunięcie konta kasuje wpis w admini (on delete cascade)');


-- ===================================================================
-- E. Sól dnia
-- ===================================================================

select is((select count(*) from public.analityka_sol
            where dzien = (now() at time zone 'Europe/Warsaw')::date),
          1::bigint,
          'sól: dokładnie jeden wiersz na dobę warszawską po kilku wywołaniach');

-- Rotacja: na nowej dobie funkcja tworzy NOWĄ sól, a wczorajsza zostaje do sprzątania (faza 7).
delete from public.analityka_sol;
insert into public.analityka_sol (dzien, sol)
values ((now() at time zone 'Europe/Warsaw')::date - 1, repeat('a', 64));

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select isnt(public.analityka_sol_dzis(), repeat('a', 64),
            'rotacja: nowa doba dostaje nową sól, nie wczorajszą');
reset role;

select is((select count(*) from public.analityka_sol), 2::bigint,
          'rotacja: wczorajsza sól zostaje (kasuje ją dopiero sprzątanie)');

select throws_ok($q$insert into public.analityka_sol (dzien, sol) values ('2000-01-01', 'zbyt-krotka')$q$,
                 '23514', null, 'sól: check odrzuca wartość inną niż 64 znaki hex');

-- Sól jest tworzona o północy czasu warszawskiego, nie UTC ani strefy sesji: dzień soli = dzień
-- warszawski. Dwie skrajne strefy sesji (UTC+14 i UTC-12) przesuwają datę względem Warszawy o każdej
-- porze doby przynajmniej w jednej z nich, więc usterka typu current_date nie ukryje się o żadnej godzinie.
select is((select dzien from public.analityka_sol where sol <> repeat('a', 64)),
          (now() at time zone 'Europe/Warsaw')::date,
          'sól: dzień soli to doba warszawska');

delete from public.analityka_sol;
set local timezone = 'Pacific/Kiritimati';
select lives_ok($q$select public.analityka_sol_dzis()$q$, 'sól: wywołanie w strefie sesji UTC+14');
select is((select dzien from public.analityka_sol), (now() at time zone 'Europe/Warsaw')::date,
          'sól: doba warszawska niezależnie od strefy sesji (UTC+14)');

delete from public.analityka_sol;
set local timezone = 'Etc/GMT+12';
select lives_ok($q$select public.analityka_sol_dzis()$q$, 'sól: wywołanie w strefie sesji UTC-12');
select is((select dzien from public.analityka_sol), (now() at time zone 'Europe/Warsaw')::date,
          'sól: doba warszawska niezależnie od strefy sesji (UTC-12)');
reset timezone;

-- Losowość: dwa kolejne losowania soli (po skasowaniu poprzedniej) muszą się różnić.
create temp table sole_probne (nr integer, sol text);
delete from public.analityka_sol;
insert into sole_probne select 1, public.analityka_sol_dzis();
delete from public.analityka_sol;
insert into sole_probne select 2, public.analityka_sol_dzis();
select isnt((select sol from sole_probne where nr = 1), (select sol from sole_probne where nr = 2),
            'sól: kolejne losowania różnią się (źródło losowe, nie stała)');


-- ===================================================================
-- F. Detektor bramki dla public.admin_*
-- ===================================================================

-- Reguły wspólne z contracts/rpc.md: security definer, wywołanie jest_adminem() w treści,
-- brak EXECUTE dla anon, EXECUTE dla authenticated, pusty search_path.
create function pg_temp.naruszenia_bramki(p_wzorzec text default 'admin\_%')
returns table (funkcja text, powod text)
language sql
stable
as $f$
  select w.funkcja, w.powod
    from (
      select p.proname::text collate "default" as funkcja,
             concat_ws('; ',
               case when not p.prosecdef then 'nie jest security definer' end,
               case when p.prosrc not ilike '%jest_adminem()%' then 'brak wywołania jest_adminem()' end,
               case when has_function_privilege('anon', p.oid, 'execute') then 'anon ma EXECUTE' end,
               case when not has_function_privilege('authenticated', p.oid, 'execute')
                    then 'authenticated nie ma EXECUTE' end,
               case when p.proconfig is null or not (p.proconfig @> array['search_path=""'])
                    then 'search_path nie jest pusty' end
             ) as powod
        from pg_proc p
       where p.pronamespace = 'public'::regnamespace
         and p.proname like p_wzorzec
    ) w
   where w.powod <> ''
$f$;

-- Prawdziwy test: wszystkie istniejące public.admin_*.
select is_empty($q$select * from pg_temp.naruszenia_bramki()$q$,
                'każda public.admin_* ma bramkę: security definer, jest_adminem(), brak EXECUTE dla anon, pusty search_path');

-- Narzędzie, które nic nie zmierzyło, musi to powiedzieć (zero funkcji ≠ „jest dobrze”).
select diag(format('Sprawdzone funkcje public.admin_*: %s%s',
                   c.ile,
                   case when c.ile = 0
                        then ' – UWAGA: brak funkcji do sprawdzenia, bramka niezmierzona (faza 6 jeszcze nie wdrożona)'
                        else '' end))
  from (select count(*) as ile
          from pg_proc
         where pronamespace = 'public'::regnamespace and proname like 'admin\_%') c;

-- Dowód, że detektor działa: funkcje próbne (wycofywane razem z transakcją).
create function public.admin_probna_dobra() returns integer
language plpgsql security definer set search_path = ''
as $p$ begin
  if not public.jest_adminem() then raise exception 'brak dostępu' using errcode = '42501'; end if;
  return 1;
end $p$;
revoke all on function public.admin_probna_dobra() from public, anon;
grant execute on function public.admin_probna_dobra() to authenticated;

-- bez bramki w treści (i z domyślnym EXECUTE dla anon)
create function public.admin_probna_zla() returns integer
language sql security definer set search_path = ''
as $p$ select 1 $p$;

-- bramka w treści, ale funkcja nie jest security definer
create function public.admin_probna_invoker() returns integer
language plpgsql set search_path = ''
as $p$ begin
  if not public.jest_adminem() then raise exception 'brak dostępu' using errcode = '42501'; end if;
  return 1;
end $p$;
revoke all on function public.admin_probna_invoker() from public, anon;
grant execute on function public.admin_probna_invoker() to authenticated;

-- wszystko poprawne, ale anon zachował domyślny EXECUTE
create function public.admin_probna_anon() returns integer
language plpgsql security definer set search_path = ''
as $p$ begin
  if not public.jest_adminem() then raise exception 'brak dostępu' using errcode = '42501'; end if;
  return 1;
end $p$;
grant execute on function public.admin_probna_anon() to authenticated;

-- wszystko poprawne, ale bez ustalonego search_path
create function public.admin_probna_bez_sciezki() returns integer
language plpgsql security definer
as $p$ begin
  if not public.jest_adminem() then raise exception 'brak dostępu' using errcode = '42501'; end if;
  return 1;
end $p$;
revoke all on function public.admin_probna_bez_sciezki() from public, anon;
grant execute on function public.admin_probna_bez_sciezki() to authenticated;

-- wszystko poprawne, ale authenticated nie ma EXECUTE (panel dostałby odmowę mimo członkostwa)
create function public.admin_probna_bez_authenticated() returns integer
language plpgsql security definer set search_path = ''
as $p$ begin
  if not public.jest_adminem() then raise exception 'brak dostępu' using errcode = '42501'; end if;
  return 1;
end $p$;
revoke all on function public.admin_probna_bez_authenticated() from public, anon, authenticated;

select results_eq(
  $q$select funkcja from pg_temp.naruszenia_bramki('admin\_probna\_%') order by 1$q$,
  $q$values ('admin_probna_anon'), ('admin_probna_bez_authenticated'),
            ('admin_probna_bez_sciezki'), ('admin_probna_invoker'), ('admin_probna_zla')$q$,
  'detektor łapie 5 zepsutych funkcji próbnych i przepuszcza poprawną'
);

select is((select powod from pg_temp.naruszenia_bramki('admin\_probna\_zla')),
          'brak wywołania jest_adminem(); anon ma EXECUTE',
          'detektor podaje powód: brak bramki w treści i EXECUTE dla anon');

select * from finish();

rollback;
