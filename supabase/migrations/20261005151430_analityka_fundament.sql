-- 20261005151430_analityka_fundament.sql
-- Nazwa nadana przez: wt.ps1 migracja (timestamp, nie numer sekwencyjny).
-- Dzieki temu rownolegle worktree nie moga wziac tej samej nazwy i nikt nie czeka na lock.
-- Po merge do main aplikuj z glownego repo:  supabase db push --include-all
--   (--include-all jest potrzebne, gdy migracja o wczesniejszym timestampie trafila na main
--    pozniej niz nowsza - CLI inaczej uzna ja za starsza od ostatnio zastosowanej i pominie.)

-- =====================================================================
-- adresscore – analityka (faza 2): FUNDAMENT BAZY
--
-- Tworzy wszystko, na czym stoją panel #/panel i własny pomiar ruchu:
--   1. admini + jest_adminem()  – jedna bramka dostępu (autorytet trzyma baza, nie React),
--   2. zdarzenia                – surowy pomiar (retencja 90 dni, sprząta faza 7),
--   3. analityka_sol            – sól dnia dla odcisku (retencja 2 dni),
--   4. analityka_dzienna/_biegi – zestawienie dzienne i ślad biegów (zapełnia faza 7),
--   5. zdarzenie_zapisz()       – JEDYNA droga zapisu do zdarzeń, tylko service_role,
--   6. analityka_sesje()        – sesja jako encja wyliczana, nie przechowywana.
--
-- Wzorzec: migracje z-dykty 0039, 0040, 0074, 0076, 0077, 20260731162138,
-- 20260804220656, 20260812152339 – tu złożone od razu w docelowym kształcie.
-- Kontrakty: specs/001-panel-analityka/data-model.md oraz contracts/rpc.md.
--
-- ZASADY WSPÓLNE
--   * Doby zawsze w Europe/Warsaw (także przy zmianie czasu: doba 23- i 25-godzinna).
--   * Funkcje security definer mają search_path = '' i w pełni kwalifikowane nazwy.
--     Pusty search_path zamyka klasę ataków „podstaw własną funkcję/tabelę o tej samej
--     nazwie w schemacie, który wywołujący wpisał wcześniej w ścieżkę”.
--   * OBRONA W GŁĄB. Na Supabase nowe tabele i funkcje w public dostają domyślnie prawa
--     dla anon i authenticated. Samo RLS to jedna zapora; druga to jawny REVOKE, trzecia –
--     grant tylko tego, co faktycznie ma działać. Każda z trzech wystarcza, żeby klucz
--     publiczny niczego nie odczytał ani nie zapisał, więc błąd w jednej nie otwiera drzwi.
--   * PostgreSQL daje EXECUTE dla PUBLIC na każdej nowej funkcji, dlatego u każdej funkcji
--     wrażliwej stoi REVOKE … FROM PUBLIC (samo odebranie anon nie wystarcza).
--   * Zmiana schematu zdalnej bazy wyłącznie przez ten plik (nigdy apply_migration ani DDL
--     z execute_sql).
-- =====================================================================


-- ---------- 1. Rola admina ----------

create table public.admini (
  user_id uuid primary key references auth.users (id) on delete cascade,
  dodano timestamptz not null default now()
);

comment on table public.admini is
  'Lista kont uprawnionych do panelu #/panel. RLS włączony i ZERO polityk: czyta ją wyłącznie jest_adminem() (security definer) oraz service_role. Dopisanie admina – SQL w panelu Supabase (quickstart.md, krok 4).';

alter table public.admini enable row level security;
-- Brak polityk = tabela niewidoczna dla anon i authenticated. Zwykły użytkownik nie może
-- sprawdzić, kto jest adminem, ani dopisać siebie. REVOKE to druga zapora (patrz nagłówek).
revoke all on table public.admini from anon, authenticated;

-- Jedyna bramka panelu. Każda admin_* zaczyna od `if not public.jest_adminem() then …`,
-- a polityki RLS na tabelach analityki wołają tę samą funkcję – dołożenie 2FA albo audytu
-- w przyszłości domyka cały panel jedną zmianą w jednym miejscu.
--
-- security definer, bo `admini` nie ma polityk (wywołujący nie widzi tabeli), a bramka musi
-- ją czytać. STABLE: wynik jest stały w obrębie zapytania, więc planista może go zbuforować.
-- Bez auth.uid() (anon, service_role) wynik to false – brak sesji nie jest adminem.
create or replace function public.jest_adminem()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.admini where user_id = auth.uid());
$$;

comment on function public.jest_adminem() is
  'Czy zalogowany użytkownik (auth.uid()) jest na liście admini. Jedyna bramka panelu: wołają ją polityki RLS i każda admin_*.';

revoke all on function public.jest_adminem() from public, anon;
grant execute on function public.jest_adminem() to authenticated, service_role;


-- ---------- 2. Surowy pomiar: zdarzenia ----------

-- Jeden wiersz = jedno zdarzenie z przeglądarki, po walidacji i wzbogaceniu na serwerze
-- (odcisk, bot, kraj, kanał). IP i pełny User-Agent NIE istnieją w żadnej kolumnie – endpoint
-- trzyma je tylko w pamięci na czas liczenia skrótu (SC-006).
--
-- Kolumny zależne od typu są nullable; które typy je wypełniają, mówi data-model.md. Checki
-- pilnują tego, co baza może sprawdzić tanio i deklaratywnie, a to, czego sprawdzić się nie
-- da (kształt elementów sekcje/cta), waliduje endpoint.
create table public.zdarzenia (
  id bigint generated always as identity primary key,
  -- Czas wstawienia. Klient go nie ustawia: trigger nadpisuje now() (patrz niżej).
  czas timestamptz not null default now(),
  typ text not null
    constraint zdarzenia_typ_check
    check (typ in ('odslona', 'wyjscie', 'klik', 'udostepnienie', 'produktowe', 'wital', 'blad')),
  -- Wartość typu Ekran z src/wynik/url.ts (szukaj, okolica, porownanie, …). Ekran `panel`
  -- nie jest mierzony, ale baza nie zna listy ekranów (rośnie z aplikacją) – pilnuje kształtu.
  ekran text not null
    constraint zdarzenia_ekran_check check (ekran ~ '^[a-z_]{1,24}$'),
  -- Ścieżka z hasha albo pathname, bez query i fragmentu (np. /okolica/<id>).
  sciezka text not null
    constraint zdarzenia_sciezka_check check (char_length(sciezka) between 1 and 512),
  -- 16 znaków hex = pierwsze 64 bity SHA-256(sól dnia + ip + ua + host). NULL, gdy sól
  -- była niedostępna; wtedy zdarzenie nie liczy się do unikalnych ani do sesji.
  odcisk text
    constraint zdarzenia_odcisk_check check (odcisk ~ '^[0-9a-f]{16}$'),
  kraj text
    constraint zdarzenia_kraj_check check (kraj ~ '^[A-Z]{2}$'),
  urzadzenie text not null
    constraint zdarzenia_urzadzenie_check check (urzadzenie in ('mobile', 'tablet', 'desktop', 'inne')),
  czy_bot boolean not null default false,
  bot_rodzina text
    constraint zdarzenia_bot_rodzina_check check (char_length(bot_rodzina) <= 40),
  bot_klasa text
    constraint zdarzenia_bot_klasa_check
    check (bot_klasa in ('ai', 'wyszukiwarka', 'podglad', 'narzedzie', 'monitoring', 'inny')),
  -- Tylko odsłona: kanał wejścia policzony na serwerze (api/_ruch.js).
  kanal text
    constraint zdarzenia_kanal_check
    check (kanal in ('bezposrednie', 'wyszukiwarka', 'social', 'ai', 'kampania', 'odeslanie', 'wewnetrzne')),
  referer_host text
    constraint zdarzenia_referer_host_check check (char_length(referer_host) <= 255),
  referer_sciezka text
    constraint zdarzenia_referer_sciezka_check check (char_length(referer_sciezka) <= 200),
  utm_source text
    constraint zdarzenia_utm_source_check check (char_length(utm_source) <= 60),
  utm_medium text
    constraint zdarzenia_utm_medium_check check (char_length(utm_medium) <= 60),
  utm_campaign text
    constraint zdarzenia_utm_campaign_check check (char_length(utm_campaign) <= 60),
  -- Sama NAZWA parametru identyfikatora kliknięcia, nigdy jego wartość (wartość identyfikuje
  -- konkretne kliknięcie w reklamę, czyli osobę).
  click_id text
    constraint zdarzenia_click_id_check check (click_id in ('gclid', 'fbclid', 'msclkid', 'ttclid', 'li_fat_id')),
  -- Tylko wyjście. Trigger przycina do zakresu, check jest siatką, gdyby trigger ominięto.
  czas_ms integer
    constraint zdarzenia_czas_ms_check check (czas_ms between 0 and 1800000),
  scroll_pc smallint
    constraint zdarzenia_scroll_pc_check check (scroll_pc between 0 and 100),
  -- Tylko wyjście: [{"k": sekcja, "ms": int, "p": pozycja}], najwyżej 24 elementy.
  sekcje jsonb
    constraint zdarzenia_sekcje_check
    check (sekcje is null or case when jsonb_typeof(sekcje) = 'array'
                                  then jsonb_array_length(sekcje) between 1 and 24
                                  else false end),
  -- Tylko wyjście: [{"k": "sekcja§cel", "e": ekspozycje, "n": kliki}], najwyżej 12 elementów.
  cta jsonb
    constraint zdarzenia_cta_check
    check (cta is null or case when jsonb_typeof(cta) = 'array'
                               then jsonb_array_length(cta) between 1 and 12
                               else false end),
  -- klik: sekcja§rodzaj§cel; udostepnienie: element.
  etykieta text
    constraint zdarzenia_etykieta_check check (char_length(etykieta) <= 120),
  kanal_udostepnienia text
    constraint zdarzenia_kanal_udostepnienia_check
    check (kanal_udostepnienia in ('link', 'kopia', 'natywne', 'anulowano', 'blad')),
  -- produktowe: nazwa ze zdefiniowanego słownika; wital: metryka (lcp, inp, cls, fcp, ttfb).
  -- Baza pilnuje KSZTAŁTU nazwy (snake_case ASCII), a nie listy produktowych: lista żyje w
  -- api/_zdarzenie-kontrakt.js (parytet z klientem pilnuje test), więc nowe zdarzenie nie
  -- wymaga migracji i nie znika po cichu przy rozjeździe list. Zamknięta jest tylko lista
  -- metryk wital – ma pięć stałych pozycji i od niej zależy wymiar `witale` w zestawieniu.
  nazwa text
    constraint zdarzenia_nazwa_check check (nazwa ~ '^[a-z][a-z0-9_]{1,47}$'),
  -- Tylko obiekt, ≤ 12 kluczy, wartości skalarne ≤ 200 znaków (trigger doprowadza do tego kształtu).
  wlasciwosci jsonb
    constraint zdarzenia_wlasciwosci_check check (jsonb_typeof(wlasciwosci) = 'object'),
  -- wital: wartość metryki (ms; CLS jako ułamek). Zakres odcina też NaN i Infinity, które
  -- numeric potrafi przechować, a które zatruwają percentile_cont w p75.
  wartosc numeric
    constraint zdarzenia_wartosc_check check (wartosc between 0 and 1000000000),
  -- blad: komunikat ≤ 200 znaków, bez długich liczb (trigger zamienia je na #).
  komunikat text
    constraint zdarzenia_komunikat_check check (char_length(komunikat) <= 200),

  -- Wymagane pola zależne od typu. Zdarzenie nazwane bez nazwy albo pomiar bez wartości nie
  -- da się zagregować, a wiersz z NULL-em tam, gdzie zestawienie zakłada liczbę, psuje
  -- percentile_cont i grupowania w panelu – lepiej, żeby zapis go odrzucił od razu.
  constraint zdarzenia_nazwa_wymagana_check
    check (typ not in ('produktowe', 'wital') or nazwa is not null),
  constraint zdarzenia_wital_check
    check (typ <> 'wital'
           or (coalesce(nazwa in ('lcp', 'inp', 'cls', 'fcp', 'ttfb'), false) and wartosc is not null)),
  constraint zdarzenia_blad_check
    check (typ <> 'blad' or komunikat is not null)
);

comment on table public.zdarzenia is
  'Surowy pomiar ruchu (retencja 90 dni). Zapis wyłącznie przez zdarzenie_zapisz() (service_role); odczyt: admin (RLS) i funkcje security definer. Bez IP i User-Agenta.';
comment on column public.zdarzenia.odcisk is
  '16 znaków hex: SHA-256(sól dnia + ip + ua + host), liczony na serwerze. Sól wygasa po 2 dobach, więc odcisk nie łączy wizyt między dniami.';
comment on column public.zdarzenia.czas is
  'Czas wstawienia = now() nadpisywany triggerem; klient nie ma wpływu. Uwaga: w obrębie jednej transakcji (paczki) wszystkie wiersze mają ten sam czas – kolejność zdarzeń z paczki wyznacza id.';

-- Indeksy z data-model.md. Częściowy indeks po odcisku obsługuje liczenie unikalnych ludzi
-- i sesje (oba odfiltrowują boty i wiersze bez odcisku).
create index zdarzenia_czas_idx on public.zdarzenia (czas desc);
create index zdarzenia_typ_czas_idx on public.zdarzenia (typ, czas desc);
create index zdarzenia_odcisk_czas_idx on public.zdarzenia (odcisk, czas)
  where odcisk is not null and not czy_bot;
create index zdarzenia_nazwa_czas_idx on public.zdarzenia (nazwa, czas desc)
  where nazwa is not null;
create index zdarzenia_wyjscie_ekran_czas_idx on public.zdarzenia (ekran, czas desc)
  where typ = 'wyjscie';

-- UZUPEŁNIENIE względem data-model.md (decyzja wykonawcy): komplement indeksu po odcisku, dla
-- botów. Limit godzinowy w zdarzenie_zapisz() liczy wiersze danego odcisku BEZ względu na
-- czy_bot – nagłówek User-Agent można sfałszować na „GPTBot” i zalewać tabelę jako bot.
-- Bez tego indeksu liczenie dla botów skanowałoby wszystkie wiersze z ostatniej godziny przy
-- KAŻDYM wstawieniu, czyli zalew rotującymi User-Agentami zamieniłby się w zalew zapytań
-- (koszt rosnący kwadratowo). Koszt zapisu bez zmian: każdy wiersz trafia do jednego z dwóch
-- indeksów częściowych, nigdy do obu.
create index zdarzenia_odcisk_bot_czas_idx on public.zdarzenia (odcisk, czas)
  where odcisk is not null and czy_bot;

-- Trigger BEFORE INSERT: jedyne miejsce, przez które przechodzi każdy zapis niezależnie od roli
-- (także service_role, który omija RLS), więc to tu leży autorytatywna normalizacja.
-- ZASADA: przycinamy i normalizujemy, nie odrzucamy. Odrzucony INSERT to bezpowrotnie utracony
-- pomiar, a wartość tuż za zakresem jest dla statystyki i tak równie dobra po przycięciu.
-- Odrzucają dopiero checki – dla tego, czego przyciąć się nie da (zły typ, zły kształt).
create or replace function public.zdarzenia_przed_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Czas jest autorytatywny po stronie bazy.
  new.czas := now();

  -- Kody: tylko wielkość liter (check odrzuci resztę). Obcinania identyfikatorów nie ma
  -- celowo – odcisk dłuższy niż 16 znaków to błąd endpointu, który ma być widoczny.
  new.odcisk := lower(new.odcisk);
  new.kraj := upper(new.kraj);

  -- Teksty swobodne: przycięcie do limitu z data-model.md, pusty ciąg = brak wartości
  -- (inaczej w grupowaniach pojawiałby się pusty tekst obok NULL-a).
  new.sciezka := left(new.sciezka, 512);
  new.bot_rodzina := nullif(left(new.bot_rodzina, 40), '');
  new.referer_host := nullif(regexp_replace(lower(left(new.referer_host, 255)), '^www\.', ''), '');
  new.referer_sciezka := nullif(left(new.referer_sciezka, 200), '');
  new.utm_source := nullif(lower(left(new.utm_source, 60)), '');
  new.utm_medium := nullif(lower(left(new.utm_medium, 60)), '');
  new.utm_campaign := nullif(lower(left(new.utm_campaign, 60)), '');
  new.etykieta := nullif(left(new.etykieta, 120), '');

  -- Zakresy: przycinamy do zakresu, nie odrzucamy (patrz zasada wyżej). 1 800 000 ms = 30 min
  -- jest zgodne z progiem sesji: dłuższy odczyt i tak byłby już inną sesją.
  if new.czas_ms is not null then
    new.czas_ms := least(greatest(new.czas_ms, 0), 1800000);
  end if;
  if new.scroll_pc is not null then
    new.scroll_pc := least(greatest(new.scroll_pc, 0), 100);
  end if;

  -- Komunikat błędu: ciągi 7 i więcej cyfr (PESEL, telefon, numer konta, identyfikatory)
  -- zamieniamy na #, a dopiero potem tniemy do 200 znaków – w odwrotnej kolejności cięcie
  -- mogłoby zostawić 6 cyfr z końcówki długiej liczby. Klient i tak nie wysyła stosu ani URL-i
  -- z query, to jest ostatnia linia obrony.
  if new.komunikat is not null then
    new.komunikat := nullif(left(regexp_replace(new.komunikat, '[0-9]{7,}', '#', 'g'), 200), '');
  end if;

  -- sekcje i cta: nie-tablica = brak pomiaru, pusta tablica = brak pomiaru, nadmiar ponad
  -- limit odcinamy od końca (zostają pierwsze elementy), żeby czas na stronie z wyjścia nie
  -- przepadał razem z zepsutym polem pomocniczym.
  if new.sekcje is not null then
    if jsonb_typeof(new.sekcje) <> 'array' or jsonb_array_length(new.sekcje) = 0 then
      new.sekcje := null;
    elsif jsonb_array_length(new.sekcje) > 24 then
      select jsonb_agg(e.wartosc order by e.nr)
        into new.sekcje
        from jsonb_array_elements(new.sekcje) with ordinality as e(wartosc, nr)
       where e.nr <= 24;
    end if;
  end if;
  if new.cta is not null then
    if jsonb_typeof(new.cta) <> 'array' or jsonb_array_length(new.cta) = 0 then
      new.cta := null;
    elsif jsonb_array_length(new.cta) > 12 then
      select jsonb_agg(e.wartosc order by e.nr)
        into new.cta
        from jsonb_array_elements(new.cta) with ordinality as e(wartosc, nr)
       where e.nr <= 12;
    end if;
  end if;

  -- wlasciwosci: tylko obiekt; zostają klucze o wartościach skalarnych (tekst, liczba, boolean),
  -- najwyżej 12 (alfabetycznie – deterministycznie), teksty do 200 znaków. Zagnieżdżone obiekty
  -- i tablice wypadają: kolumna ma być płaskim słownikiem, który agregaty czytają operatorem ->>.
  if new.wlasciwosci is not null then
    if jsonb_typeof(new.wlasciwosci) <> 'object' then
      new.wlasciwosci := null;
    else
      select coalesce(
               jsonb_object_agg(
                 w.klucz,
                 case when jsonb_typeof(w.wartosc) = 'string'
                      then to_jsonb(left(w.wartosc #>> '{}', 200))
                      else w.wartosc
                 end
               ),
               '{}'::jsonb)
        into new.wlasciwosci
        from (
          select e.key as klucz, e.value as wartosc
            from jsonb_each(new.wlasciwosci) as e
           where jsonb_typeof(e.value) in ('string', 'number', 'boolean')
           order by e.key
           limit 12
        ) w;
    end if;
  end if;

  return new;
end;
$$;

comment on function public.zdarzenia_przed_insert() is
  'Trigger BEFORE INSERT na zdarzenia: czas = now(), przycięcia długości, czas_ms 0..1 800 000, scroll_pc 0..100, komunikat bez liczb ≥ 7 cyfr (→ #), normalizacja sekcje/cta/wlasciwosci.';

-- Funkcja wyzwalacza nie ma być wołana przez nikogo z klientów. EXECUTE nie jest sprawdzane
-- przy odpalaniu wyzwalacza (tylko przy CREATE TRIGGER), więc odebranie nic nie psuje.
revoke all on function public.zdarzenia_przed_insert() from public, anon, authenticated;

create trigger zdarzenia_przed_insert
  before insert on public.zdarzenia
  for each row execute function public.zdarzenia_przed_insert();

-- RLS: odczyt tylko dla admina; ŻADNEJ polityki insert/update/delete. Zapis idzie wyłącznie
-- przez zdarzenie_zapisz() (security definer, grant dla service_role) – wtedy odcisk i bot
-- są liczone na serwerze, a nie podawane przez klienta.
alter table public.zdarzenia enable row level security;
revoke all on table public.zdarzenia from anon, authenticated;
grant select on table public.zdarzenia to authenticated;
-- Sekwencja kolumny identity ma OSOBNE prawa: domyślne uprawnienia Supabase dają anon
-- i authenticated USAGE, SELECT i UPDATE (czyli nextval/setval), a REVOKE na tabeli ich nie
-- rusza. Klient nie wstawia wierszy, więc te prawa są zbędne – setval do maksimum sekwencji
-- zablokowałby każdy następny zapis zdarzeń. (Bramka pgTAP: analityka_bramka, sekcja B.)
revoke all on sequence public.zdarzenia_id_seq from anon, authenticated;

-- (select …) zamiast gołego wywołania: planista liczy bramkę raz na zapytanie (InitPlan),
-- a nie raz na wiersz. Dla admina czytającego tabelę wprost to różnica między 1 a N wywołaniami.
create policy zdarzenia_select_admin on public.zdarzenia
  for select to authenticated
  using ((select public.jest_adminem()));


-- ---------- 3. Sól dnia ----------

-- Sól rotuje o północy warszawskiej i jest kasowana po 2 dobach (sprząta faza 7). Po jej
-- skasowaniu odcisk jest nieodwracalny: nie da się już sprawdzić, czy dane IP + UA do niego
-- pasują. To na tym stoi pomiar bez zgody – w bazie nie zostaje żaden trwały identyfikator.
create table public.analityka_sol (
  dzien date primary key,
  -- 32 bajty losowe zapisane szesnastkowo = 64 znaki.
  sol text not null
    constraint analityka_sol_sol_check check (sol ~ '^[0-9a-f]{64}$'),
  utworzono timestamptz not null default now()
);

comment on table public.analityka_sol is
  'Sól dnia warszawskiego do liczenia odcisków. Sekret: RLS bez polityk i brak jakichkolwiek praw dla anon/authenticated; czyta i pisze tylko analityka_sol_dzis() (service_role). Retencja 2 doby.';

alter table public.analityka_sol enable row level security;
-- ZERO polityk – celowo. Wyciek soli pozwoliłby komuś z dostępem do logów IP odtworzyć odciski
-- z bieżącej doby.
revoke all on table public.analityka_sol from anon, authenticated;

-- Zwraca sól dzisiejszej doby warszawskiej, tworząc ją przy pierwszym wywołaniu.
-- INSERT … ON CONFLICT DO NOTHING + SELECT zamiast „najpierw sprawdź, potem wstaw”: dwie
-- równoległe instancje endpointu o północy dostaną tę samą sól (przegrywający INSERT czeka na
-- zwycięzcę, a następny SELECT już ją widzi), więc odciski z jednej doby zgadzają się między
-- instancjami.
--
-- Losowość: dwa gen_random_uuid() (wbudowane od PostgreSQL 13, kryptograficznie silne źródło)
-- sklejone bez myślników = 64 znaki hex. Zamiast gen_random_bytes z pgcrypto: nie wprowadza
-- zależności od rozszerzenia w schemacie `extensions` (działa identycznie na Supabase Cloud,
-- lokalnie i na gołym Postgresie). Bity wersji i wariantu UUID obniżają entropię z 256 do 244
-- bitów, co dla soli, która żyje dobę, nie ma znaczenia.
create or replace function public.analityka_sol_dzis()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_dzien date := (now() at time zone 'Europe/Warsaw')::date;
  v_sol text;
begin
  insert into public.analityka_sol (dzien, sol)
  values (
    v_dzien,
    replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
  )
  on conflict (dzien) do nothing;

  select s.sol into v_sol from public.analityka_sol s where s.dzien = v_dzien;
  return v_sol;
end;
$$;

comment on function public.analityka_sol_dzis() is
  'Sól dzisiejszej doby warszawskiej (64 znaki hex); tworzy ją przy pierwszym wywołaniu doby. Tylko service_role (endpoint /api/zdarzenie).';

revoke all on function public.analityka_sol_dzis() from public, anon, authenticated;
grant execute on function public.analityka_sol_dzis() to service_role;


-- ---------- 4. Zestawienie dzienne ----------

-- Tabela „tall”: wiersz na (dzień, wymiar, klucz) – dokładanie wymiaru nie wymaga migracji.
-- Zapełnia ją analityka_zestaw_dzien() (faza 7), nie ma retencji: to ona trzyma historię
-- dłuższą niż 90 dni surowych zdarzeń.
create table public.analityka_dzienna (
  dzien date not null,
  wymiar text not null
    constraint analityka_dzienna_wymiar_check check (char_length(wymiar) between 1 and 64),
  klucz text not null
    constraint analityka_dzienna_klucz_check check (char_length(klucz) between 1 and 512),
  wartosc bigint not null default 0,
  -- Druga miara tego samego klucza, gdy sama liczba nie wystarcza (witale: p75).
  wartosc2 numeric,
  zaktualizowano timestamptz not null default now(),
  primary key (dzien, wymiar, klucz)
);

create index analityka_dzienna_wymiar_dzien_idx on public.analityka_dzienna (wymiar, dzien desc);

comment on table public.analityka_dzienna is
  'Zestawienie dzienne w formacie tall (dzien, wymiar, klucz). Bez retencji. Odczyt: admin (RLS); zapis: tylko funkcje security definer fazy 7.';

alter table public.analityka_dzienna enable row level security;
revoke all on table public.analityka_dzienna from anon, authenticated;
grant select on table public.analityka_dzienna to authenticated;

create policy analityka_dzienna_select_admin on public.analityka_dzienna
  for select to authenticated
  using ((select public.jest_adminem()));


-- ---------- 5. Ślad biegów zestawienia ----------

-- Jeden wiersz na bieg analityka_cron(): panel Jakość czyta stąd, czy zestawienie w ogóle
-- chodzi (czerwony wskaźnik, gdy ostatni bieg jest starszy niż 26 h albo zakończył się błędem).
create table public.analityka_biegi (
  id bigint generated always as identity primary key,
  rodzaj text not null
    constraint analityka_biegi_rodzaj_check check (rodzaj in ('zestaw', 'sprzatanie')),
  start timestamptz not null default now(),
  -- NULL = bieg trwa albo przerwany bez zapisu końca.
  koniec timestamptz,
  wynik jsonb,
  blad text,
  constraint analityka_biegi_koniec_check check (koniec is null or koniec >= start)
);

create index analityka_biegi_start_idx on public.analityka_biegi (start desc);

comment on table public.analityka_biegi is
  'Ślad biegów analityka_cron() (zestaw, sprzątanie) dla panelu Jakość. Odczyt: admin (RLS); zapis: tylko analityka_cron() (faza 7).';

alter table public.analityka_biegi enable row level security;
revoke all on table public.analityka_biegi from anon, authenticated;
grant select on table public.analityka_biegi to authenticated;
-- Jak przy zdarzeniach: prawa do sekwencji identity odbieramy osobno.
revoke all on sequence public.analityka_biegi_id_seq from anon, authenticated;

create policy analityka_biegi_select_admin on public.analityka_biegi
  for select to authenticated
  using ((select public.jest_adminem()));


-- ---------- 6. Zapis zdarzeń ----------

-- JEDYNA droga zapisu do zdarzeń: wołana przez api/zdarzenie.js rolą service_role.
-- Wejście: tablica obiektów o kluczach równych kolumnom zdarzenia (bez id i czas).
-- Zwraca liczbę faktycznie zapisanych wierszy (pominięte nie liczą się).
--
-- JAWNA LISTA KOLUMN, nie populate z typem tabeli: klient nie może podrzucić id ani czas
-- (a przez błąd endpointu także żadnej kolumny spoza listy), bo nieznane klucze są po prostu
-- ignorowane przez jsonb_to_record.
--
-- LIMIT: 1500 zdarzeń na godzinę na odcisk (jedna przeczytana strona to dwa zdarzenia –
-- odsłona i wyjście – więc 600 z pierwszej wersji dusiłoby realny ruch zza jednego NAT-a).
-- Ponad limit wiersz jest pomijany. Do limitu wliczają się wiersze tej samej paczki wstawione
-- wcześniej (są widoczne dla kolejnych zapytań w tej samej transakcji), czyli „istniejące w
-- ostatniej godzinie + numer wiersza w paczce w obrębie odcisku”. To limit miękki: dwie
-- równoległe paczki jednego odcisku mogą razem przekroczyć go o kilka wierszy; do powstrzymania
-- zalewu to wystarcza, a pełne wykluczanie wymagałoby blokady na odcisk. Zalew rotującym
-- User-Agentem daje nowy odcisk, a więc nowy limit – to ograniczenie modelu bez IP w bazie;
-- zamyka je dopiero reguła na brzegu sieci (Cloudflare/Coolify), nie baza.
--
-- WIERSZE NIEPOPRAWNE. Każdy wiersz idzie w osobnym bloku BEGIN … EXCEPTION (podtransakcja):
-- naruszenie checku, NOT NULL albo błąd rzutowania (klasy błędów 22 i 23) pomija TEN wiersz, a
-- reszta paczki zostaje zapisana. Źródłem prawdy o poprawności są checki tabeli – funkcja nie
-- trzyma własnej kopii list wartości, więc nie ma jak się z nimi rozjechać. Endpoint i tak
-- odrzuca niezgodne zdarzenia wcześniej, to jest ostatnia linia obrony, nie główna. Pola
-- liczbowe i boolean czytamy jako tekst i rzutujemy dopiero w bloku: gdyby rzutowała sama
-- jsonb_to_record, jeden zły wiersz wywróciłby całe wywołanie poza zasięgiem obsługi błędu.
--
-- GÓRNY LIMIT PACZKI: 50 wierszy (endpoint wysyła ≤ 10). Zapas na przyszłość, a przy tym
-- pod progiem 64 podtransakcji, po którym Postgres traci pamięć podręczną podtransakcji i
-- zwalnia każde zapytanie w systemie.
create or replace function public.zdarzenie_zapisz(p_paczka jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_limit_godzinowy constant integer := 1500;
  c_max_paczka constant integer := 50;
  v_wiersz record;
  v_odcisk text;
  v_bot boolean;
  v_ile integer;
  v_zapisano integer := 0;
begin
  if p_paczka is null then
    return 0;
  end if;

  for v_wiersz in
    select x.*
      -- Tylko elementy będące obiektami; reszta (liczby, teksty, null) jest ignorowana, a
      -- pojedynczy obiekt zamiast tablicy daje paczkę jednoelementową (tryb lax w jsonpath).
      from jsonb_path_query(p_paczka, '$[*] ? (@.type() == "object")') with ordinality as e(wiersz, nr)
     cross join lateral jsonb_to_record(e.wiersz) as x(
       typ text, ekran text, sciezka text, odcisk text, kraj text, urzadzenie text,
       czy_bot text, bot_rodzina text, bot_klasa text, kanal text,
       referer_host text, referer_sciezka text,
       utm_source text, utm_medium text, utm_campaign text, click_id text,
       czas_ms text, scroll_pc text, sekcje jsonb, cta jsonb,
       etykieta text, kanal_udostepnienia text,
       nazwa text, wlasciwosci jsonb, wartosc text, komunikat text
     )
     -- Kolejność z paczki wyznacza id wierszy; na niej stoi dopasowanie wyjścia do odsłony
     -- w analityka_sesje() (wszystkie wiersze paczki mają ten sam czas).
     order by e.nr
     limit c_max_paczka
  loop
    begin
      v_bot := coalesce(v_wiersz.czy_bot::boolean, false);
      v_odcisk := lower(v_wiersz.odcisk);

      if v_odcisk is not null then
        -- Dwie gałęzie zamiast jednego warunku, żeby każda trafiała dokładnie w swój indeks
        -- częściowy (ludzie: zdarzenia_odcisk_czas_idx, boty: zdarzenia_odcisk_bot_czas_idx).
        if v_bot then
          select count(*) into v_ile
            from public.zdarzenia z
           where z.odcisk = v_odcisk and z.czy_bot and z.czas > now() - interval '1 hour';
        else
          select count(*) into v_ile
            from public.zdarzenia z
           where z.odcisk = v_odcisk and not z.czy_bot and z.czas > now() - interval '1 hour';
        end if;
        if v_ile >= c_limit_godzinowy then
          continue;
        end if;
      end if;

      insert into public.zdarzenia (
        typ, ekran, sciezka, odcisk, kraj, urzadzenie, czy_bot, bot_rodzina, bot_klasa, kanal,
        referer_host, referer_sciezka, utm_source, utm_medium, utm_campaign, click_id,
        czas_ms, scroll_pc, sekcje, cta, etykieta, kanal_udostepnienia,
        nazwa, wlasciwosci, wartosc, komunikat
      )
      values (
        v_wiersz.typ, v_wiersz.ekran, v_wiersz.sciezka, v_wiersz.odcisk, v_wiersz.kraj,
        v_wiersz.urzadzenie, v_bot, v_wiersz.bot_rodzina, v_wiersz.bot_klasa, v_wiersz.kanal,
        v_wiersz.referer_host, v_wiersz.referer_sciezka,
        v_wiersz.utm_source, v_wiersz.utm_medium, v_wiersz.utm_campaign, v_wiersz.click_id,
        round(v_wiersz.czas_ms::numeric)::integer, round(v_wiersz.scroll_pc::numeric)::smallint,
        v_wiersz.sekcje, v_wiersz.cta, v_wiersz.etykieta, v_wiersz.kanal_udostepnienia,
        v_wiersz.nazwa, v_wiersz.wlasciwosci, v_wiersz.wartosc::numeric, v_wiersz.komunikat
      );
      v_zapisano := v_zapisano + 1;
    exception
      when data_exception or integrity_constraint_violation then
        -- Wiersz niezgodny z kontraktem: pomijamy, reszta paczki idzie dalej.
        null;
    end;
  end loop;

  return v_zapisano;
end;
$$;

comment on function public.zdarzenie_zapisz(jsonb) is
  'Jedyna droga zapisu do zdarzenia. Wejście: tablica obiektów o kluczach = kolumny (bez id i czas). Limit 1500/h na odcisk, wiersze niepoprawne pomijane pojedynczo. Zwraca liczbę zapisanych. Tylko service_role.';

revoke all on function public.zdarzenie_zapisz(jsonb) from public, anon, authenticated;
grant execute on function public.zdarzenie_zapisz(jsonb) to service_role;


-- ---------- 7. Sesje (encja wyliczana, nie przechowywana) ----------

-- Sesji nie zapisujemy: nie ma kolumny sesja_id ani niczego, co przetrwałoby w bazie jako
-- spinacz wizyty. Sesja powstaje dopiero w zapytaniu, przez okno czasowe nad odciskiem – a
-- odcisk rotuje o północy warszawskiej. Skasowanie soli kasuje więc także zdolność sklejania.
--
-- Funkcja zwraca ODSŁONY ludzi (czy_bot = false, odcisk is not null) od p_od z kluczem sesji.
-- Nowa sesja zaczyna się przy pierwszej odsłonie odcisku w oknie albo po luce DŁUŻSZEJ niż
-- 30 minut od poprzedniej odsłony (luka równa 30 minut to jeszcze ta sama sesja; próg
-- branżowy GA4/Plausible/Matomo, trzymany dla porównywalności). Klucz sesji: odcisk-numer.
--
-- Kolumny:
--   sesja            klucz sesji (odcisk-numer); unikalny tylko w obrębie jednego wywołania,
--                    bo numer liczy się od początku okna p_od. Okno warto zaczynać o północy
--                    warszawskiej (początek doby): sesje nie przekraczają północy, więc żadna nie
--                    zostanie ucięta, a okno zaczęte w środku doby potraktuje pierwszą odsłonę
--                    odcisku w oknie jako początek sesji
--   dzien            doba warszawska POCZĄTKU sesji (sesja przecięta północą liczy się raz)
--   czas, ekran, sciezka, kanal, urzadzenie   z odsłony
--   poz              numer odsłony w sesji (od 1)
--   kolejny_ekran    ekran następnej odsłony w tej sesji; NULL = ostatnia odsłona sesji
--   czas_ms, scroll_pc, ostatnia_sekcja       z dopasowanego wyjścia; NULL = brak pomiaru
--
-- DOPASOWANIE WYJŚCIA do odsłony: pierwsze wyjście tego samego odcisku i tej samej ścieżki,
-- które wypada PO tej odsłonie i PRZED następną odsłoną tego odcisku (a gdy następnej nie ma
-- – w ciągu 30 minut). Kolejność porównujemy parą (czas, id), nie samym czasem: klient wysyła
-- „wyjście poprzedniej odsłony + odsłona następnej” w jednej paczce, a wszystkie wiersze
-- paczki mają identyczny czas wstawienia. Porównanie po samym czasie gubiłoby wyjście przy
-- każdej szybkiej nawigacji.
--
-- OSTATNIA SEKCJA = sekcja o najwyższej pozycji (pole p) spośród tych z czasem > 0 w wyjściu;
-- to „punkt urwania”. Elementy o złym kształcie (brak klucza k, ms albo p o złym typie, element
-- niebędący obiektem) pomija filtr jsonpath: porównanie z innym typem daje „nieznane”, nie błąd,
-- więc jeden zepsuty element nie wywraca całej funkcji, a kolejne rzutowania są bezpieczne.
--
-- CZEGO FUNKCJA Z ZAŁOŻENIA NIE POTRAFI: sesja nie przekracza północy (rotacja soli); wspólny
-- IP + UA (biuro, NAT) skleja kilka osób w jedną sesję; gdy karta zginie bez zdarzenia wyjścia,
-- ostatnia odsłona nie ma czasu (NULL). To cena pomiaru bez trwałego identyfikatora.
--
-- Zdarzenia produktowe przypisujemy do sesji tym samym kluczem: ten sam odcisk i czas między
-- pierwszą odsłoną sesji a jej ostatnią odsłoną + 30 minut (robi to konsument, np. lejek).
--
-- security definer i brak grantu dla ról klienckich: wołają ją wyłącznie admin_* i zestawienie,
-- a bramkę roli mają dopiero one.
create or replace function public.analityka_sesje(p_od timestamptz)
returns table (
  sesja text,
  dzien date,
  czas timestamptz,
  ekran text,
  sciezka text,
  poz integer,
  kolejny_ekran text,
  czas_ms integer,
  scroll_pc smallint,
  ostatnia_sekcja text,
  kanal text,
  urzadzenie text
)
language sql
stable
security definer
set search_path = ''
as $$
  with odslony as (
    select z.id, z.odcisk, z.czas, z.ekran, z.sciezka, z.kanal, z.urzadzenie
      from public.zdarzenia z
     where z.typ = 'odslona'
       and z.odcisk is not null
       and not z.czy_bot
       and z.czas >= p_od
  ),
  sasiedzi as (
    select o.*,
           lag(o.czas) over w as poprzednia_czas,
           lead(o.czas) over w as nastepna_czas,
           lead(o.id) over w as nastepna_id
      from odslony o
    window w as (partition by o.odcisk order by o.czas, o.id)
  ),
  numerowane as (
    select s.*,
           sum(case
                 when s.poprzednia_czas is null
                   or s.czas - s.poprzednia_czas > interval '30 minutes'
                 then 1 else 0
               end)
             over (partition by s.odcisk order by s.czas, s.id rows unbounded preceding) as nr
      from sasiedzi s
  ),
  w_sesji as (
    select n.*,
           n.odcisk || '-' || n.nr::text as klucz,
           row_number() over (partition by n.odcisk, n.nr order by n.czas, n.id) as numer,
           lead(n.ekran) over (partition by n.odcisk, n.nr order by n.czas, n.id) as nastepny_ekran,
           min(n.czas) over (partition by n.odcisk, n.nr) as start_sesji
      from numerowane n
  )
  select
    s.klucz,
    (s.start_sesji at time zone 'Europe/Warsaw')::date,
    s.czas,
    s.ekran,
    s.sciezka,
    s.numer::integer,
    s.nastepny_ekran,
    wy.czas_ms,
    wy.scroll_pc,
    wy.ostatnia_sekcja,
    s.kanal,
    s.urzadzenie
  from w_sesji s
  left join lateral (
    select w.czas_ms,
           w.scroll_pc,
           (select e.value ->> 'k'
              from jsonb_path_query(
                     w.sekcje,
                     '$[*] ? (@.ms > 0 && @.p >= 0 && @.k.type() == "string")'
                   ) as e(value)
             order by (e.value ->> 'p')::numeric desc,
                      (e.value ->> 'ms')::numeric desc,
                      e.value ->> 'k'
             limit 1) as ostatnia_sekcja
      from public.zdarzenia w
     where w.typ = 'wyjscie'
       and not w.czy_bot
       and w.odcisk = s.odcisk
       and w.sciezka = s.sciezka
       and w.czas >= s.czas
       and w.czas <= coalesce(s.nastepna_czas, s.czas + interval '30 minutes')
       and (w.czas, w.id) > (s.czas, s.id)
       and (s.nastepna_id is null or (w.czas, w.id) < (s.nastepna_czas, s.nastepna_id))
     order by w.czas, w.id
     limit 1
  ) wy on true
$$;

comment on function public.analityka_sesje(timestamptz) is
  'Odsłony ludzi od p_od z kluczem sesji (luka > 30 min = nowa sesja, 30 min dokładnie = ta sama), pozycją, ekranem następnej odsłony i dopasowanym wyjściem (czas_ms, scroll_pc, ostatnia_sekcja). Sesja nie jest nigdzie zapisywana. Element wewnętrzny: brak EXECUTE dla ról klienckich.';

revoke all on function public.analityka_sesje(timestamptz) from public, anon, authenticated;
