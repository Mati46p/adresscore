-- Test pgTAP: prywatność schematu analityki (specs/001-panel-analityka, SC-006).
--
-- SC-006: „Zero kolumn z adresem IP lub pełną przeglądarką w bazie”. Gwarancja stoi na tym, że
-- endpoint nigdy nie przekazuje IP ani User-Agenta do wierszy, ale to schemat jest ostatnią
-- zaporą: kolumna, której nie ma, nie zostanie przez pomyłkę wypełniona. Ten test pilnuje
-- schematu z dwóch stron:
--   A. dokładny zbiór kolumn `zdarzenia` (lista z data-model.md): dołożenie kolumny wymaga
--      świadomej zmiany tego testu, czyli oceny, czy nie niesie danych osobowych,
--   B. żadna tabela analityki nie ma kolumny o nazwie wskazującej na IP, agenta użytkownika,
--      przeglądarkę ani wprost identyfikator osoby/urządzenia/sesji,
--   C. brak kolumny identyfikatora sesji (sesja jest wyliczana, nie przechowywana).
--
-- Test chodzi jako postgres w jednej transakcji, którą kończy ROLLBACK.

begin;

create extension if not exists pgtap with schema extensions;

select plan(8);

-- ===================================================================
-- A. Dokładny zbiór kolumn tabeli zdarzenia
-- ===================================================================

select columns_are(
  'public', 'zdarzenia',
  array[
    'id', 'czas', 'typ', 'ekran', 'sciezka', 'odcisk', 'kraj', 'urzadzenie',
    'czy_bot', 'bot_rodzina', 'bot_klasa', 'kanal',
    'referer_host', 'referer_sciezka', 'utm_source', 'utm_medium', 'utm_campaign', 'click_id',
    'czas_ms', 'scroll_pc', 'sekcje', 'cta', 'etykieta', 'kanal_udostepnienia',
    'nazwa', 'wlasciwosci', 'wartosc', 'komunikat'
  ],
  'zdarzenia: dokładnie kolumny z data-model.md (zmiana wymaga przeglądu prywatności)'
);

-- ===================================================================
-- B. Nazwy kolumn wskazujące na dane osobowe
-- ===================================================================

-- Wzorzec trafia w człony nazwy rozdzielone podkreślnikiem: `ip`, `user_agent`, `ua`, `browser`,
-- `przegladarka`, `agent`, `client_ip`, `ip_address`, `fingerprint`, `visitor_id`… `odcisk`
-- (skrót dobowy) i `referer_host` do niego nie pasują, bo nie zawierają tych członów.
select is(
  (select count(*)::int
     from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name in ('zdarzenia', 'analityka_sol', 'analityka_dzienna', 'analityka_biegi', 'admini')
      and c.column_name ~* '(^|_)(ip|ips|ipv4|ipv6|ua|agent|useragent|browser|przegladarka|przegladarki|fingerprint|visitor|device|urzadzenie_id)($|_)'),
  0,
  'żadna tabela analityki nie ma kolumny o nazwie wskazującej na IP, agenta ani przeglądarkę'
);

select is(
  (select count(*)::int
     from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name in ('zdarzenia', 'analityka_sol', 'analityka_dzienna', 'analityka_biegi', 'admini')
      and c.column_name ~* '(email|mail|telefon|phone|imie|nazwisko|pesel|login|haslo|password|token)'),
  0,
  'żadna tabela analityki nie ma kolumny z danymi kontaktowymi ani uwierzytelniającymi'
);

-- Detektor musi umieć coś złapać: na zmyślonej tabeli próbnej wzorzec widzi kolumny `ip` i
-- `user_agent` (narzędzie, które nic nie zmierzyło, niczego nie dowodzi).
create temp table pg_temp.probna_prywatnosc (id int, ip text, user_agent text, odcisk text, referer_host text);

select is(
  (select count(*)::int
     from information_schema.columns c
    where c.table_schema like 'pg\_temp\_%'
      and c.table_name = 'probna_prywatnosc'
      and c.column_name ~* '(^|_)(ip|ips|ipv4|ipv6|ua|agent|useragent|browser|przegladarka|przegladarki|fingerprint|visitor|device|urzadzenie_id)($|_)'),
  2,
  'detektor nazw łapie kolumny ip i user_agent na tabeli próbnej (i omija odcisk oraz referer_host)'
);

-- ===================================================================
-- C. Sesja nie jest przechowywana
-- ===================================================================

select is(
  (select count(*)::int
     from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name in ('zdarzenia', 'analityka_sol', 'analityka_dzienna', 'analityka_biegi', 'admini')
      and c.column_name ~* '(^|_)(sesja|session|sid|uid|user)($|_)'
      and not (c.table_name = 'admini' and c.column_name = 'user_id')),
  0,
  'brak kolumny z identyfikatorem sesji lub użytkownika (poza admini.user_id)'
);

-- Kolumna `odcisk` istnieje, ma 16 znaków hex i nie da się w niej zapisać dłuższego skrótu ani surowej
-- wartości (check), więc IP wpisany przez pomyłkę w to pole odbije się od schematu.
select ok(
  exists (
    select 1
      from pg_constraint k
     where k.conrelid = 'public.zdarzenia'::regclass
       and k.contype = 'c'
       and pg_get_constraintdef(k.oid) ilike '%odcisk%'
       and pg_get_constraintdef(k.oid) like '%[0-9a-f]{16}%'
  ),
  'odcisk: check wymusza dokładnie 16 znaków hex (surowy IP się nie zapisze)'
);

select throws_ok(
  $$insert into public.zdarzenia (typ, ekran, sciezka, odcisk, urzadzenie)
    values ('odslona', 'szukaj', '/', '192.168.0.1', 'desktop')$$,
  '23514',
  null,
  'odcisk: próba zapisu adresu IP odbija się od checku'
);

select throws_ok(
  $$insert into public.zdarzenia (typ, ekran, sciezka, odcisk, urzadzenie)
    values ('odslona', 'szukaj', '/', 'Mozilla/5.0 (Windows NT 10.0', 'desktop')$$,
  '23514',
  null,
  'odcisk: próba zapisu User-Agenta odbija się od checku'
);

select * from finish();

rollback;
