-- 20261005160831_analityka_panel.sql
-- Nazwa nadana przez: wt.ps1 migracja (timestamp, nie numer sekwencyjny).
-- Dzieki temu rownolegle worktree nie moga wziac tej samej nazwy i nikt nie czeka na lock.
-- Po merge do main aplikuj z glownego repo:  supabase db push --include-all
--   (--include-all jest potrzebne, gdy migracja o wczesniejszym timestampie trafila na main
--    pozniej niz nowsza - CLI inaczej uzna ja za starsza od ostatnio zastosowanej i pominie.)

-- =====================================================================
-- adresscore – analityka (faza 6): FUNKCJE ODCZYTOWE PANELU (25 × admin_*)
--
-- Dostarcza wszystko, co czyta panel #/panel w siedmiu zakładkach (Przegląd, Akwizycja, Sesje,
-- Zaangażowanie, CTA, Treść, Jakość). Kontrakt: specs/001-panel-analityka/contracts/rpc.md
-- (sekcja „Uzupełnienia wykonawcze” ma pierwszeństwo), definicje: data-model.md.
-- Wzorzec: migracje z-dykty 0080, 0085, 0089, 20260731162138, 20260801093000, 20260804220656,
-- 20260805184650, 20260809102207, 20260809121425, 20260812152339 – złożone w jeden schemat.
--
-- REGUŁY WSPÓLNE DLA KAŻDEJ admin_*
--   * language plpgsql, stable, security definer, search_path = '' (pełne nazwy obiektów),
--     statement_timeout = '30s',
--   * pierwsza instrukcja: bramka `if not public.jest_adminem() then raise exception
--     'brak dostępu' using errcode = '42501'` – autorytet trzyma baza, nie React,
--   * revoke all … from public, anon; grant execute … to authenticated (anon dostaje 42501
--     już od samego braku EXECUTE; zalogowany nie-admin – od bramki w treści),
--   * parametry przycinane (NULL → wartość domyślna): p_dni ≤ 30 dla funkcji czytających surowe
--     zdarzenia (retencja 90 dni, ale okno 30 dni trzyma koszt zapytania w ryzach), ≤ 90 tylko
--     dla admin_seria_dzienna (czyta zestawienie dzienne), p_limit ≤ 200 (PostgREST i tak tnie
--     odpowiedź po cichu na 1000 wierszach), p_godzin ≤ 168,
--   * ruch botów wykluczony (czy_bot = false) wszędzie poza admin_boty_ai oraz polami
--     ludzie_24h / boty_24h w admin_przeglad,
--   * liczby zwracane SUROWE (liczności). Procenty i udziały liczy src/panel/arytmetyka.ts
--     (podstawa = suma całości); baza zwraca poza licznościami tylko mediany, p75 i średnie.
--
-- DWIE WARSTWY: publiczne admin_* (bramka + now()) wołają wewnętrzne analityka_panel_* z JAWNYM
-- parametrem czasu p_teraz. Po co: doba warszawska, zmiana czasu (2026-10-25 ma 25 godzin) i
-- granice okien da się wtedy przetestować na znanym zestawie zdarzeń, a klient nie dostaje
-- żadnego przełącznika „podróży w czasie” (ani parametru, ani GUC-a). Wewnętrzne nie mają
-- żadnych praw dla ról klienckich – woła je wyłącznie definer, który przeszedł bramkę.
--
-- OKNO „p_dni dni” = ostatnie p_dni DÓB WARSZAWSKICH WŁĄCZNIE Z DZISIEJSZĄ: początek to północ
-- warszawska dnia (dziś − (p_dni − 1)), koniec to północ następnej doby (okno półotwarte
-- [od, do)). Nie „teraz − N × 24 h”: pierwszy słupek byłby wtedy ucięty w połowie i wyglądałby
-- na słabszy. Wyjątki: odslony_24h i teraz_5min w admin_przeglad są oknami RUCHOMYMI od
-- „teraz” (pytanie brzmi „ile w ostatniej dobie”, nie „ile od północy”).
--
-- DEFINICJE (te same w całym panelu, żeby dwie zakładki nie podawały dwóch liczb o tym samym)
--   * unikalny      = różny odcisk człowieka (bez botów) z dowolnym zdarzeniem w dobie
--                     warszawskiej, odcisk niepusty (jak „unikalni” w zestawieniu dziennym).
--                     „7 dni” to SUMA dobowych liczb unikalnych, nie osoby: ta sama osoba
--                     z rotującym odciskiem policzy się w każdej dobie osobno,
--   * odsłona       = zdarzenie typu odslona człowieka (wiersze bez odcisku też są odsłonami),
--   * wizyta/sesja  = ciąg odsłon jednego odcisku z przerwą ≤ 30 min – reguły analityka_sesje()
--                     z fundamentu, wykonane szybciej przez analityka_panel_odslony() (parytet
--                     pilnuje test pgTAP); wszystkie funkcje sesyjne liczą z tej jednej definicji,
--   * sesja zaangażowana = ≥ 2 odsłony albo suma czas_ms ≥ 30 000,
--   * punkt urwania = ostatnia odsłona sesji (kolejny_ekran is null) + ostatnia widziana sekcja
--                     z jej wyjścia, '(brak pomiaru)' gdy wyjścia nie ma albo sekcje są puste,
--   * źródło wizyty = pierwsza odsłona sesji. Kanał 'wewnetrzne' NIE jest wejściem: sesja, która
--                     zaczyna się od odsłony wewnętrznej (powrót do karty otwartej dłużej niż
--                     30 min temu, bez nowego wejścia z zewnątrz), liczy się jako 'bezposrednie'
--                     i nie dziedziczy referera ani UTM. Tak robi Plausible/Matomo; dzięki
--                     temu każda sesja ląduje w dokładnie jednym kanale, a suma wizyt po
--                     kanałach, krajach i urządzeniach równa się liczbie sesji.
--
-- WYDAJNOŚĆ (zmierzona lokalnie, PG 17 w Dockerze, na syntetycznym ruchu ≈ 18 tys. odsłon ludzi
-- i ≈ 41 tys. wszystkich zdarzeń na dobę – górna granica z plan.md): okno 7 dób – każda z 25 funkcji
-- poniżej 2 s; okno 30 dób (1,2 mln zdarzeń) – wszystkie poniżej 8 s, większość poniżej 3 s. Co za tym stoi:
--   * własny pipeline sesji (sekcja 1) zamiast analityka_sesje(): ta ma ≈ 60 µs na odsłonę (dopasowuje
--     wyjście i rozpakowuje sekcje dla każdej odsłony), pipeline ≈ 10 µs, a wyjścia dopina tylko tam, gdzie
--     są potrzebne. Funkcje SQL pipeline'u nie mają klauzuli SET, żeby planista mógł je wbudować w zapytanie
--     wołającego (bez materializacji wyniku i z przycinaniem kolumn) – bezpieczeństwo daje search_path
--     wrappera i pełne kwalifikowanie nazw (linter „function_search_path_mutable” może je zgłosić);
--   * unikalni liczeni dwuetapowo (grupowanie hashem zamiast count(distinct)), mediany sekcji z tablic,
--     ostatnia sekcja wyjść zbiorczo, nie funkcją na wiersz;
--   * work_mem = 64MB na wrapperach: sortowania i agregaty w pamięci zamiast na dysku. To zapytania
--     tylko dla adminów (jednostki równoległych), więc koszt pamięci jest ograniczony;
--   * kolejność remisów ORDER BY … collate "C": ta sama niezależnie od collation bazy.
-- UWAGA o limicie: klauzula `set statement_timeout` na funkcji NIE przedłuża już uzbrojonego
-- limitu roli (sprawdzone lokalnie na PG 17: licznik startuje przy wejściu zapytania, zanim
-- funkcja zdąży zmienić ustawienie). Na Supabase Cloud realnym sufitem może więc być limit roli
-- `authenticated` (domyślnie 8 s), nie 30 s z kontraktu – stąd budżet czasu liczony z zapasem.
-- =====================================================================


-- ---------- 0. Pomocnicze (wewnętrzne) ----------

-- Przycięcie parametru: NULL → wartość domyślna, potem [1, max]. Jedno miejsce zamiast
-- dwudziestu pięciu kopii wyrażenia, z których któraś by się rozjechała.
create or replace function public.analityka_przytnij(p_wartosc integer, p_domyslna integer, p_max integer)
returns integer
language sql
immutable
parallel safe
set search_path = ''
as $$
  select least(greatest(coalesce(p_wartosc, p_domyslna), 1), p_max)
$$;

-- Początek okna: północ warszawska dnia (dzień p_teraz − (p_dni − 1)). Północ zawsze istnieje
-- (zmiana czasu w Polsce wypada o 02:00/03:00), więc rzutowanie daty na timestamp jest jednoznaczne.
create or replace function public.analityka_poczatek_okna(p_teraz timestamptz, p_dni integer)
returns timestamptz
language sql
immutable
parallel safe
set search_path = ''
as $$
  select (((p_teraz at time zone 'Europe/Warsaw')::date - (p_dni - 1))::timestamp) at time zone 'Europe/Warsaw'
$$;

-- Koniec okna (wyłączny): północ następnej doby warszawskiej. Górna granica nie zmienia wyniku na
-- produkcji (zdarzeń z przyszłości nie ma), ale czyni okno deterministycznym w testach z p_teraz.
create or replace function public.analityka_koniec_okna(p_teraz timestamptz)
returns timestamptz
language sql
immutable
parallel safe
set search_path = ''
as $$
  select (((p_teraz at time zone 'Europe/Warsaw')::date + 1)::timestamp) at time zone 'Europe/Warsaw'
$$;

-- Znacznik czasu jako tekst ISO 8601 w UTC. Pola jsonb nie mogą zależeć od strefy sesji
-- (to_jsonb(timestamptz) drukuje ją w TimeZone sesji), a klient i tak parsuje `new Date(…)`.
create or replace function public.analityka_iso(p_czas timestamptz)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select to_char(p_czas at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
$$;

revoke all on function public.analityka_przytnij(integer, integer, integer) from public, anon, authenticated, service_role;
revoke all on function public.analityka_poczatek_okna(timestamptz, integer) from public, anon, authenticated, service_role;
revoke all on function public.analityka_koniec_okna(timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.analityka_iso(timestamptz) from public, anon, authenticated, service_role;


-- ---------- 1. Odsłony z numerem sesji, wyjścia i wizyty (wewnętrzne) ----------

-- Dlaczego własny pipeline sesji zamiast analityka_sesje() z fundamentu: ta funkcja dla KAŻDEJ
-- odsłony dopasowuje wyjście (lateral join z indeksem) i rozpakowuje jsonpathem sekcje – to ≈ 60 µs
-- na odsłonę, a wizyty, ścieżki, przejścia i lejek potrzebują tylko samego sklejenia sesji.
-- Zmierzone na 7 dobach po ≈ 20 tys. odsłon: analityka_sesje() 8,7 s, a pięć funkcji Akwizycji liczyło
-- po 10–16 s (limit roli w Supabase to 8 s). Tu: odsłony z kluczem sesji w jednym przebiegu
-- sortowania, wyjścia dopinane tylko tam, gdzie wynik ich potrzebuje (czas sesji: wszystkie odsłony,
-- ostatnia sekcja: tylko ostatnie odsłony sesji), i to jednym złączeniem zbiorów, a nie
-- osobnym zapytaniem na odsłonę.
--
-- REGUŁY SĄ TE SAME CO W FUNDAMENCIE (jedna definicja sesji, dwa wykonania): odsłony ludzi z niepustym
-- odciskiem; nowa sesja przy pierwszej odsłonie odcisku albo po luce DŁUŻSZEJ niż 30 minut (luka równa
-- 30 minutom to jeszcze ta sama sesja); kolejność odsłon po parze (czas, id), bo paczka z jednego żądania
-- ma identyczny czas; klucz sesji odcisk-numer; wyjście należy do odsłony, jeśli ma ten sam odcisk
-- i ścieżkę, wypada po niej (para czas, id) i przed następną odsłoną tego odcisku, a gdy następnej nie ma
-- – w ciągu 30 minut; wybieramy PIERWSZE takie. Zgodność z analityka_sesje() pilnuje test pgTAP
-- (analityka_panel.test.sql, sekcja „parytet”): zmiana progu albo kolejności w jednym miejscu
-- bez drugiego wywali test, zamiast po cichu rozjechać liczby zakładek.
--
-- collate "C" w partycjach okien: odcisk to 16 znaków hex, więc porównanie bajtowe daje to samo
-- grupowanie, a sortowanie jest kilkukrotnie szybsze niż w collation bazy (ICU/libc).

-- Odsłony ludzi z okna [p_od, p_do) z kluczem sesji, pozycją w sesji, ekranem następnej odsłony
-- TEJ SAMEJ sesji (NULL = ostatnia), długością sesji i atrybutami wejścia (kanał, referer, UTM,
-- identyfikator kliknięcia, kraj, urządzenie) z własnego wiersza – bez dodatkowych dopasowań.
-- nastepna_czas / nastepna_id to następna odsłona tego odcisku w ogóle (także z kolejnej sesji): to ona
-- zamyka okno szukania wyjścia. Sesja nie przekracza północy (odcisk rotuje), więc p_od warto
-- ustawiać na początek doby.
--
-- Dwa poziomy okien nad JEDNYM sortowaniem (odcisk, czas, id): poziom 1 – sąsiedzi (lag/lead) i numer
-- wiersza, poziom 2 – bieżące sumy i maksima (numer sesji, początek sesji) oraz minimum „w przód”
-- (koniec sesji). Pozycja i długość sesji wychodzą z różnic numerów wierszy, więc nie ma osobnego
-- partycjonowania po sesji (ono kosztowało drugie sortowanie i dwa przebiegi).
create or replace function public.analityka_panel_odslony(p_od timestamptz, p_do timestamptz)
returns table (
  id bigint,
  odcisk text,
  sesja text,
  dzien date,
  czas timestamptz,
  ekran text,
  sciezka text,
  poz integer,
  kolejny_ekran text,
  strony integer,
  nastepna_czas timestamptz,
  nastepna_id bigint,
  kanal text,
  urzadzenie text,
  kraj text,
  referer_host text,
  referer_sciezka text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  click_id text
)
language sql
stable
as $$
  with sasiedzi as (
    select z.id, z.odcisk, z.czas, z.ekran, z.sciezka, z.kanal, z.urzadzenie, z.kraj,
           z.referer_host, z.referer_sciezka, z.utm_source, z.utm_medium, z.utm_campaign, z.click_id,
           row_number() over w as rn,
           lag(z.czas) over w as poprzednia_czas,
           lead(z.czas) over w as nastepna_czas,
           lead(z.id) over w as nastepna_id,
           lead(z.ekran) over w as nastepny_ekran
      from public.zdarzenia z
     where z.typ = 'odslona'
       and z.odcisk is not null
       and not z.czy_bot
       and z.czas >= p_od
       and z.czas < p_do
    window w as (partition by z.odcisk collate "C" order by z.czas, z.id)
  ),
  granice as (
    select s.*,
           (s.poprzednia_czas is null or s.czas - s.poprzednia_czas > interval '30 minutes') as nowa,
           (s.nastepna_czas is null or s.nastepna_czas - s.czas > interval '30 minutes') as ostatnia
      from sasiedzi s
  ),
  numerowane as (
    select g.*,
           sum(case when g.nowa then 1 else 0 end)
             over (partition by g.odcisk collate "C" order by g.czas, g.id rows unbounded preceding) as nr,
           max(case when g.nowa then g.rn end)
             over (partition by g.odcisk collate "C" order by g.czas, g.id rows unbounded preceding) as start_rn,
           max(case when g.nowa then g.czas end)
             over (partition by g.odcisk collate "C" order by g.czas, g.id rows unbounded preceding) as start_czas,
           min(case when g.ostatnia then g.rn end)
             over (partition by g.odcisk collate "C" order by g.czas, g.id rows between current row and unbounded following) as koniec_rn
      from granice g
  )
  select n.id,
         n.odcisk,
         n.odcisk || '-' || n.nr::text,
         (n.start_czas at time zone 'Europe/Warsaw')::date,
         n.czas,
         n.ekran,
         n.sciezka,
         (n.rn - n.start_rn + 1)::integer,
         case when not n.ostatnia then n.nastepny_ekran end,
         (n.koniec_rn - n.start_rn + 1)::integer,
         n.nastepna_czas,
         n.nastepna_id,
         n.kanal,
         n.urzadzenie,
         n.kraj,
         n.referer_host,
         n.referer_sciezka,
         n.utm_source,
         n.utm_medium,
         n.utm_campaign,
         n.click_id
    from numerowane n
$$;

-- Odsłony z dopiętym wyjściem (czas widoczny, przewinięcie, ostatnia sekcja). Dwa przełączniki
-- ograniczają koszt do tego, czego potrzebuje konsument:
--   p_tylko_ostatnie – tylko ostatnie odsłony sesji (punkt urwania; sesji jest kilka razy mniej niż odsłon),
--   p_sekcje         – wyznacz ostatnią widzianą sekcję; bez tego kolumna jest NULL
-- (czas sesji potrzebuje czas_ms wszystkich odsłon, ale nie sekcji).
-- Dopasowanie to JEDNO złączenie odsłon z wyjściami po (odcisk, ścieżka) z warunkami czasu z nagłówka
-- sekcji 1 i wybór pierwszego pasującego wyjścia. Zamiast jednego zapytania indeksowego na odsłonę
-- (≈ 40 µs każde, razem 5 s na 7 dób) – jeden przebieg po obu zbiorach: złączenie haszujące, potem
-- agregacja haszująca po odsłonie (id pierwszego pasującego wyjścia) bez sortowania szerokich wierszy.
-- Wyjścia czytamy do p_do + 30 min: ostatnia odsłona okna może mieć wyjście tuż za jego końcem.
-- Ostatnia widziana sekcja: o najwyższej pozycji spośród tych z czasem > 0 (remis: dłuższy czas, potem
-- nazwa) – „punkt urwania”, ta sama reguła co w analityka_sesje(). Liczona ZBIOROWO (rozpakowanie sekcji
-- wszystkich dopasowanych wyjść i jeden DISTINCT ON), nie funkcją skalarną na wiersz: wołanie funkcji
-- z podzapytaniem kosztowało ≈ 60 µs za wywołanie. Elementy o złym kształcie (nie obiekt, brak k,
-- ms lub p nie jest liczbą) są pomijane – rzutowanie stoi w CASE za sprawdzeniem typu.
-- enable_nestloop / enable_mergejoin = off: planista widzi wynik funkcji jako ~100 tys. wierszy, a przy
-- małych oknach wybierałby pętlę zagnieżdżoną po indeksie albo sortowanie do merge joina – tu właściwą
-- ścieżką jest złączenie haszujące. (Przez te ustawienia funkcja nie jest wbudowywana w zapytanie
-- wołającego; jej wynik – dziewięć wąskich kolumn – trafia do tymczasowego magazynu.)
create or replace function public.analityka_panel_wyjscia(
  p_od timestamptz,
  p_do timestamptz,
  p_tylko_ostatnie boolean,
  p_sekcje boolean
)
returns table (
  id bigint,
  sesja text,
  ekran text,
  poz integer,
  kolejny_ekran text,
  strony integer,
  czas_ms integer,
  scroll_pc smallint,
  ostatnia_sekcja text
)
language sql
stable
rows 100000
set search_path = ''
set enable_nestloop = off
set enable_mergejoin = off
as $$
  with wy as materialized (
    select x.id, x.odcisk, x.sciezka, x.czas, x.czas_ms, x.scroll_pc
      from public.zdarzenia x
     where x.typ = 'wyjscie'
       and not x.czy_bot
       and x.odcisk is not null
       and x.czas >= p_od
       and x.czas < p_do + interval '30 minutes'
  ),
  dopasowane as (
    select o.id, o.sesja, o.ekran, o.poz, o.kolejny_ekran, o.strony,
           (array_agg(w.id order by w.czas, w.id) filter (where w.id is not null))[1] as wyjscie_id
      from public.analityka_panel_odslony(p_od, p_do) o
      left join wy w
        on w.odcisk = o.odcisk
       and w.sciezka = o.sciezka
       and w.czas >= o.czas
       and w.czas <= coalesce(o.nastepna_czas, o.czas + interval '30 minutes')
       and (w.czas, w.id) > (o.czas, o.id)
       and (o.nastepna_id is null or (w.czas, w.id) < (o.nastepna_czas, o.nastepna_id))
     where (not p_tylko_ostatnie) or o.kolejny_ekran is null
     group by o.id, o.sesja, o.ekran, o.poz, o.kolejny_ekran, o.strony
  ),
  ostatnie as (
    select distinct on (e.odslona_id) e.odslona_id, e.k as sekcja
      from (
        select d.id as odslona_id,
               case when jsonb_typeof(x.value -> 'k') = 'string' then x.value ->> 'k' end as k,
               case when jsonb_typeof(x.value -> 'ms') = 'number' then (x.value ->> 'ms')::float8 end as ms,
               case when jsonb_typeof(x.value -> 'p') = 'number' then (x.value ->> 'p')::float8 end as pozycja
          from dopasowane d
          join public.zdarzenia w on w.id = d.wyjscie_id
         cross join lateral jsonb_array_elements(w.sekcje) as x(value)
         where p_sekcje
           and w.sekcje is not null
      ) e
     where e.k is not null and e.ms > 0 and e.pozycja >= 0
     order by e.odslona_id, e.pozycja desc, e.ms desc, e.k collate "C"
  )
  select d.id, d.sesja, d.ekran, d.poz, d.kolejny_ekran, d.strony,
         w.czas_ms,
         w.scroll_pc,
         s.sekcja
    from dopasowane d
    left join wy w on w.id = d.wyjscie_id
    left join ostatnie s on s.odslona_id = d.id
$$;

-- Wizyty: jeden wiersz na sesję (pierwsza odsłona sesji niesie źródło). Wołają ją wszystkie funkcje
-- Akwizycji, więc „wizyta” znaczy wszędzie to samo.
--
-- Wartości zastępcze zamiast NULL-i: '(bezpośrednie)' dla braku źródła, '(brak)' dla braku
-- ścieżki referera, '(nieznany)' dla braku kraju – klient pokazuje je jak każdą inną pozycję.
-- Źródło = utm_source, a gdy go brak – host referera, a gdy i jego brak – nazwa parametru
-- identyfikatora kliknięcia (gclid itd.): wizyta z reklamy bez UTM nie może wylądować pod
-- „(bezpośrednie)” w kanale kampania. Kanał 'wewnetrzne' (lub brak) w pierwszej odsłonie
-- = powrót do karty otwartej dłużej niż 30 min temu, nie nowe wejście: wizyta liczy się
-- jako 'bezposrednie' i nie dziedziczy referera ani UTM.
create or replace function public.analityka_panel_wizyty(p_od timestamptz, p_do timestamptz)
returns table (
  sesja text,
  dzien date,
  czas timestamptz,
  odslon bigint,
  kanal text,
  zrodlo text,
  sciezka_zrodla text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  kraj text,
  urzadzenie text
)
language sql
stable
as $$
  select
    st.sesja,
    st.dzien,
    st.czas,
    st.strony::bigint,
    st.kanal_wizyty,
    coalesce(case when st.zewnetrzne then coalesce(st.utm_source, st.referer_host, st.click_id) end,
             '(bezpośrednie)'),
    coalesce(case when st.zewnetrzne then st.referer_sciezka end, '(brak)'),
    case when st.zewnetrzne then st.utm_source end,
    case when st.zewnetrzne then st.utm_medium end,
    case when st.zewnetrzne then st.utm_campaign end,
    coalesce(st.kraj, '(nieznany)'),
    st.urzadzenie
  from (
    select o.*,
           (o.kanal is not null and o.kanal <> 'wewnetrzne') as zewnetrzne,
           coalesce(nullif(o.kanal, 'wewnetrzne'), 'bezposrednie') as kanal_wizyty
      from public.analityka_panel_odslony(p_od, p_do) o
     where o.poz = 1
  ) st
$$;

revoke all on function public.analityka_panel_odslony(timestamptz, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.analityka_panel_wyjscia(timestamptz, timestamptz, boolean, boolean) from public, anon, authenticated, service_role;
revoke all on function public.analityka_panel_wizyty(timestamptz, timestamptz) from public, anon, authenticated, service_role;


-- ---------- 2. Przegląd ----------

-- admin_przeglad: wszystkie kafle pierwszego ekranu w jednym obiekcie jsonb (jedno zapytanie
-- sieciowe zamiast dziesięciu). Pola:
--   unikalni_dzis / _wczoraj   unikalni ludzie w dobie warszawskiej,
--   unikalni_7d                SUMA dobowych unikalnych z 7 ostatnich dób (dziś + 6 poprzednich),
--   unikalni_srednia_7d        unikalni_7d / 7 (ułamek; dzielnik stały, doby bez ruchu liczą się jak 0),
--   odslony_24h                odsłony ludzi w ruchomym oknie 24 h (= ludzie_24h),
--   odslony_7d, odslony_30d    odsłony ludzi w 7 i 30 dobach (dziś włącznie),
--   szczyt_godzina / _dzien    najruchliwsza godzina i doba w 30 dobach – {godzina|dzien, odslony}
--                              albo null, gdy w oknie nie było ruchu; remis rozstrzyga NOWSZA pozycja,
--   teraz_5min                 różne odciski ludzi z dowolnym zdarzeniem w ostatnich 5 minutach,
--   ludzie_24h / boty_24h      podział odsłon z 24 h na ludzi i boty (jedyne pola z botami).
-- ludzie_24h powtarza odslony_24h celowo: pasek „ludzie vs boty” ma mieć obie części i podstawę
-- (sumę) w jednym miejscu, a kafel odsłon – własne pole.
create or replace function public.analityka_panel_przeglad(p_teraz timestamptz)
returns jsonb
language plpgsql
stable
set search_path = ''
set plan_cache_mode = 'force_custom_plan'
as $$
declare
  v_dzis date := (p_teraz at time zone 'Europe/Warsaw')::date;
  v_od7 timestamptz := public.analityka_poczatek_okna(p_teraz, 7);
  v_od30 timestamptz := public.analityka_poczatek_okna(p_teraz, 30);
  v_do timestamptz := public.analityka_koniec_okna(p_teraz);
  v_unikalni_dzis bigint;
  v_unikalni_wczoraj bigint;
  v_unikalni_7d bigint;
  v_odslony_24h bigint;
  v_boty_24h bigint;
  v_teraz_5min bigint;
  v_odslony_7d bigint;
  v_odslony_30d bigint;
  v_szczyt_godzina jsonb;
  v_szczyt_dzien jsonb;
begin
  -- Unikalni: osobno w każdej dobie, potem suma (odcisków nie wolno sumować między dobami –
  -- patrz definicja w nagłówku). Dowolny typ zdarzenia: „osoba obecna w dobie”.
  select coalesce(max(u.n) filter (where u.dzien = v_dzis), 0),
         coalesce(max(u.n) filter (where u.dzien = v_dzis - 1), 0),
         coalesce(sum(u.n), 0)
    into v_unikalni_dzis, v_unikalni_wczoraj, v_unikalni_7d
    from (
      -- Dwa kroki zamiast count(distinct): grupowanie (doba, odcisk) hashem jest kilka razy szybsze
      -- niż sortowanie wewnątrz agregatu (zmierzone: 1,3 s → 0,5 s na 120 tys. wierszy).
      select g.dzien, count(*) as n
        from (
          select (z.czas at time zone 'Europe/Warsaw')::date as dzien, z.odcisk
            from public.zdarzenia z
           where z.czas >= v_od7 and z.czas < v_do
             and not z.czy_bot
             and z.odcisk is not null
           group by 1, 2
        ) g
       group by g.dzien
    ) u;

  -- Ruchome okna od „teraz”. Górna granica p_teraz odcina zdarzenia „z przyszłości” (na produkcji
  -- ich nie ma, w teście z jawnym czasem – owszem).
  select count(*) filter (where not z.czy_bot),
         count(*) filter (where z.czy_bot)
    into v_odslony_24h, v_boty_24h
    from public.zdarzenia z
   where z.typ = 'odslona'
     and z.czas > p_teraz - interval '24 hours'
     and z.czas <= p_teraz;

  select count(distinct z.odcisk)
    into v_teraz_5min
    from public.zdarzenia z
   where z.czas > p_teraz - interval '5 minutes'
     and z.czas <= p_teraz
     and not z.czy_bot
     and z.odcisk is not null;

  -- Odsłony ludzi z 30 dób w kubełkach godzinowych (jedno skanowanie); doby, 7 dób i 30 dób
  -- składają się z tych samych kubełków, więc kafle i wykresy nie mogą się rozjechać.
  -- date_trunc z jawną strefą: kubełek zależy od Warszawy, nie od strefy sesji.
  with godz as (
    select date_trunc('hour', z.czas, 'Europe/Warsaw') as godzina, count(*) as n
      from public.zdarzenia z
     where z.typ = 'odslona'
       and not z.czy_bot
       and z.czas >= v_od30 and z.czas < v_do
     group by 1
  ),
  dni as (
    select (g.godzina at time zone 'Europe/Warsaw')::date as dzien, sum(g.n)::bigint as n
      from godz g
     group by 1
  )
  select coalesce((select sum(g.n) from godz g), 0),
         coalesce((select sum(g.n) from godz g where g.godzina >= v_od7), 0),
         (select jsonb_build_object('godzina', public.analityka_iso(g.godzina), 'odslony', g.n)
            from godz g order by g.n desc, g.godzina desc limit 1),
         (select jsonb_build_object('dzien', d.dzien, 'odslony', d.n)
            from dni d order by d.n desc, d.dzien desc limit 1)
    into v_odslony_30d, v_odslony_7d, v_szczyt_godzina, v_szczyt_dzien;

  return jsonb_build_object(
    'unikalni_dzis', v_unikalni_dzis,
    'unikalni_wczoraj', v_unikalni_wczoraj,
    'unikalni_7d', v_unikalni_7d,
    'unikalni_srednia_7d', round(v_unikalni_7d::numeric / 7, 4),
    'odslony_24h', v_odslony_24h,
    'odslony_7d', v_odslony_7d,
    'odslony_30d', v_odslony_30d,
    'szczyt_godzina', v_szczyt_godzina,
    'szczyt_dzien', v_szczyt_dzien,
    'teraz_5min', v_teraz_5min,
    'ludzie_24h', v_odslony_24h,
    'boty_24h', v_boty_24h
  );
end;
$$;

-- admin_seria_dzienna: jedna pozycja na dobę okna (do 90 dób). Doba z wierszem w zestawieniu
-- dziennym (wymiar 'ruch') bierze liczby z zestawienia – bieg policzył ją raz i zamroził, a surowe
-- zdarzenia po 90 dniach znikną. DZISIEJSZA doba jest zawsze liczona na żywo (zestawienie
-- ma o niej co najwyżej poranną migawkę), a doba przeszła bez wiersza w zestawieniu, ale z surowymi
-- zdarzeniami (zestawienie jeszcze nie biegło) – też na żywo. Doba bez jednego i drugiego nie ma
-- wiersza: klient uzupełnia ją jako „brak danych”, nie zerem.
create or replace function public.analityka_panel_seria_dzienna(p_teraz timestamptz, p_dni integer)
returns table (dzien date, odslony bigint, unikalni bigint, odslony_boty bigint)
language plpgsql
stable
set search_path = ''
set plan_cache_mode = 'force_custom_plan'
as $$
#variable_conflict use_column
declare
  v_dni integer := public.analityka_przytnij(p_dni, 30, 90);
  v_dzis date := (p_teraz at time zone 'Europe/Warsaw')::date;
  v_pierwszy date := v_dzis - (v_dni - 1);
  v_do timestamptz := public.analityka_koniec_okna(p_teraz);
begin
  return query
  with dni as (
    select v_pierwszy + g.i as dzien
      from generate_series(0, v_dni - 1) as g(i)
  ),
  zestawienie as (
    select d.dzien,
           coalesce(max(d.wartosc) filter (where d.klucz = 'odslony'), 0)::bigint as odslony,
           coalesce(max(d.wartosc) filter (where d.klucz = 'unikalni'), 0)::bigint as unikalni,
           coalesce(max(d.wartosc) filter (where d.klucz = 'odslony_boty'), 0)::bigint as odslony_boty
      from public.analityka_dzienna d
     where d.wymiar = 'ruch'
       and d.dzien >= v_pierwszy and d.dzien < v_dzis
     group by d.dzien
  ),
  do_policzenia as (
    select n.dzien
      from dni n
     where n.dzien = v_dzis
        or not exists (select 1 from zestawienie z where z.dzien = n.dzien)
  ),
  -- Surowe zdarzenia tylko dla dób do policzenia na żywo. Unikalni dwuetapowo (doba, odcisk, bot) →
  -- (doba): hash zamiast sortowania wewnątrz count(distinct).
  surowe as (
    select g.dzien,
           sum(g.odslony)::bigint as odslony,
           (count(*) filter (where not g.czy_bot and g.odcisk is not null))::bigint as unikalni,
           sum(g.odslony_boty)::bigint as odslony_boty
      from (
        select (z.czas at time zone 'Europe/Warsaw')::date as dzien,
               z.odcisk,
               z.czy_bot,
               count(*) filter (where z.typ = 'odslona' and not z.czy_bot) as odslony,
               count(*) filter (where z.typ = 'odslona' and z.czy_bot) as odslony_boty
          from public.zdarzenia z
         where z.czas >= (select (min(p.dzien)::timestamp) at time zone 'Europe/Warsaw' from do_policzenia p)
           and z.czas < v_do
           and (z.czas at time zone 'Europe/Warsaw')::date in (select p.dzien from do_policzenia p)
         group by 1, 2, 3
      ) g
     group by g.dzien
  )
  select n.dzien,
         coalesce(z.odslony, s.odslony),
         coalesce(z.unikalni, s.unikalni),
         coalesce(z.odslony_boty, s.odslony_boty)
    from dni n
    left join zestawienie z on z.dzien = n.dzien
    left join surowe s on s.dzien = n.dzien and z.dzien is null
   where z.dzien is not null or s.dzien is not null
   order by n.dzien;
end;
$$;

-- admin_seria_godzinowa: każda godzina z generate_series, więc godzina bez ruchu to 0, a nie
-- brakujący słupek. Ciągłość w czasie BEZWZGLĘDNYM (krok interval '1 hour' na timestamptz), więc
-- doba 23- i 25-godzinna nie gubi ani nie dubluje godzin: 2026-10-25 ma dwie godziny 02:00–03:00
-- czasu lokalnego i obie są osobnymi kubełkami. Seria kończy się na bieżącej godzinie (niepełnej).
-- unikalni = różne odciski w TEJ godzinie; godzin nie wolno sumować do unikalnych doby.
create or replace function public.analityka_panel_seria_godzinowa(p_teraz timestamptz, p_godzin integer)
returns table (godzina timestamptz, odslony bigint, unikalni bigint, odslony_boty bigint)
language plpgsql
stable
set search_path = ''
set plan_cache_mode = 'force_custom_plan'
as $$
#variable_conflict use_column
declare
  v_godzin integer := public.analityka_przytnij(p_godzin, 48, 168);
  v_ostatnia timestamptz := date_trunc('hour', p_teraz, 'Europe/Warsaw');
  v_pierwsza timestamptz := v_ostatnia - make_interval(hours => v_godzin - 1);
begin
  return query
  with surowe as (
    select g.godzina,
           sum(g.odslony)::bigint as odslony,
           (count(*) filter (where not g.czy_bot and g.odcisk is not null))::bigint as unikalni,
           sum(g.odslony_boty)::bigint as odslony_boty
      from (
        select date_trunc('hour', z.czas, 'Europe/Warsaw') as godzina,
               z.odcisk,
               z.czy_bot,
               count(*) filter (where z.typ = 'odslona' and not z.czy_bot) as odslony,
               count(*) filter (where z.typ = 'odslona' and z.czy_bot) as odslony_boty
          from public.zdarzenia z
         where z.czas >= v_pierwsza
           and z.czas < v_ostatnia + interval '1 hour'
         group by 1, 2, 3
      ) g
     group by g.godzina
  )
  select g.godzina,
         coalesce(s.odslony, 0),
         coalesce(s.unikalni, 0),
         coalesce(s.odslony_boty, 0)
    from generate_series(v_pierwsza, v_ostatnia, interval '1 hour') as g(godzina)
    left join surowe s on s.godzina = g.godzina
   order by g.godzina;
end;
$$;

-- admin_boty_ai: wszystkie rodziny botów z odsłon w oknie; klasa 'ai' (crawlery modeli) na górze
-- – to one są powodem tej tabeli (widoczność w odpowiedziach modeli), reszta (wyszukiwarki,
-- podglądy linków, narzędzia) idzie za nimi malejąco po odsłonach.
create or replace function public.analityka_panel_boty_ai(p_teraz timestamptz, p_dni integer)
returns table (rodzina text, klasa text, odslony bigint, ostatnio timestamptz)
language plpgsql
stable
set search_path = ''
set plan_cache_mode = 'force_custom_plan'
as $$
#variable_conflict use_column
declare
  v_dni integer := public.analityka_przytnij(p_dni, 30, 30);
  v_od timestamptz := public.analityka_poczatek_okna(p_teraz, v_dni);
  v_do timestamptz := public.analityka_koniec_okna(p_teraz);
begin
  return query
  select b.rodzina, b.klasa, b.odslony, b.ostatnio
    from (
      select coalesce(z.bot_rodzina, '(nieznana)') as rodzina,
             coalesce(z.bot_klasa, 'inny') as klasa,
             count(*) as odslony,
             max(z.czas) as ostatnio
        from public.zdarzenia z
       where z.typ = 'odslona'
         and z.czy_bot
         and z.czas >= v_od and z.czas < v_do
       group by 1, 2
    ) b
   order by (b.klasa = 'ai') desc, b.odslony desc, b.rodzina collate "C", b.klasa collate "C";
end;
$$;


-- ---------- 3. Akwizycja (wizyta = sesja, źródło z pierwszej odsłony) ----------

-- admin_kanaly: wizyty i odsłony w sesjach wg kanału wejścia. `odslony` to wszystkie odsłony
-- sesji przypisanych do kanału (nie tylko pierwsze), więc stosunek odsłon do wizyt mówi o głębokości.
create or replace function public.analityka_panel_kanaly(p_teraz timestamptz, p_dni integer)
returns table (kanal text, wizyty bigint, odslony bigint)
language plpgsql
stable
set search_path = ''
set plan_cache_mode = 'force_custom_plan'
as $$
#variable_conflict use_column
declare
  v_dni integer := public.analityka_przytnij(p_dni, 7, 30);
  v_od timestamptz := public.analityka_poczatek_okna(p_teraz, v_dni);
  v_do timestamptz := public.analityka_koniec_okna(p_teraz);
begin
  return query
  select k.kanal, k.wizyty, k.odslony
    from (
      select w.kanal, count(*) as wizyty, sum(w.odslon)::bigint as odslony
        from public.analityka_panel_wizyty(v_od, v_do) w
       group by w.kanal
    ) k
   order by k.wizyty desc, k.kanal collate "C";
end;
$$;

-- admin_zrodla: kanał × źródło × ścieżka referera (np. konkretny post). Ścieżka referera istnieje
-- tylko dla hostów publicznych (decyzja prywatności z klienta); reszta to '(brak)'.
create or replace function public.analityka_panel_zrodla(p_teraz timestamptz, p_dni integer, p_limit integer)
returns table (kanal text, zrodlo text, sciezka text, wizyty bigint)
language plpgsql
stable
set search_path = ''
set plan_cache_mode = 'force_custom_plan'
as $$
#variable_conflict use_column
declare
  v_dni integer := public.analityka_przytnij(p_dni, 7, 30);
  v_limit integer := public.analityka_przytnij(p_limit, 50, 200);
  v_od timestamptz := public.analityka_poczatek_okna(p_teraz, v_dni);
  v_do timestamptz := public.analityka_koniec_okna(p_teraz);
begin
  return query
  select z.kanal, z.zrodlo, z.sciezka, z.wizyty
    from (
      select w.kanal, w.zrodlo, w.sciezka_zrodla as sciezka, count(*) as wizyty
        from public.analityka_panel_wizyty(v_od, v_do) w
       group by w.kanal, w.zrodlo, w.sciezka_zrodla
    ) z
   order by z.wizyty desc, z.kanal collate "C", z.zrodlo collate "C", z.sciezka collate "C"
   limit v_limit;
end;
$$;

-- admin_kampanie: wizyty ze znacznikiem UTM (dowolnym z trzech) wg trójki source/medium/campaign.
-- Brak jednego z członów to '(brak)' – link z samym utm_source jest nadal kampanią do rozliczenia.
create or replace function public.analityka_panel_kampanie(p_teraz timestamptz, p_dni integer)
returns table (utm_source text, utm_medium text, utm_campaign text, wizyty bigint)
language plpgsql
stable
set search_path = ''
set plan_cache_mode = 'force_custom_plan'
as $$
#variable_conflict use_column
declare
  v_dni integer := public.analityka_przytnij(p_dni, 30, 30);
  v_od timestamptz := public.analityka_poczatek_okna(p_teraz, v_dni);
  v_do timestamptz := public.analityka_koniec_okna(p_teraz);
begin
  return query
  select k.utm_source, k.utm_medium, k.utm_campaign, k.wizyty
    from (
      select coalesce(w.utm_source, '(brak)') as utm_source,
             coalesce(w.utm_medium, '(brak)') as utm_medium,
             coalesce(w.utm_campaign, '(brak)') as utm_campaign,
             count(*) as wizyty
        from public.analityka_panel_wizyty(v_od, v_do) w
       where w.utm_source is not null or w.utm_medium is not null or w.utm_campaign is not null
       group by 1, 2, 3
    ) k
   order by k.wizyty desc, k.utm_source collate "C", k.utm_medium collate "C", k.utm_campaign collate "C"
   limit 200;
end;
$$;

-- admin_kraje: wizyty wg kraju pierwszej odsłony; brak kraju (host bez nagłówka kraju) to osobna
-- pozycja '(nieznany)', nie zero i nie wyrzucenie z sumy.
create or replace function public.analityka_panel_kraje(p_teraz timestamptz, p_dni integer)
returns table (kraj text, wizyty bigint)
language plpgsql
stable
set search_path = ''
set plan_cache_mode = 'force_custom_plan'
as $$
#variable_conflict use_column
declare
  v_dni integer := public.analityka_przytnij(p_dni, 7, 30);
  v_od timestamptz := public.analityka_poczatek_okna(p_teraz, v_dni);
  v_do timestamptz := public.analityka_koniec_okna(p_teraz);
begin
  return query
  select k.kraj, k.wizyty
    from (
      select w.kraj, count(*) as wizyty
        from public.analityka_panel_wizyty(v_od, v_do) w
       group by w.kraj
    ) k
   order by k.wizyty desc, k.kraj collate "C"
   limit 250;
end;
$$;

-- admin_urzadzenia: wizyty wg klasy urządzenia pierwszej odsłony (mobile/tablet/desktop/inne).
create or replace function public.analityka_panel_urzadzenia(p_teraz timestamptz, p_dni integer)
returns table (urzadzenie text, wizyty bigint)
language plpgsql
stable
set search_path = ''
set plan_cache_mode = 'force_custom_plan'
as $$
#variable_conflict use_column
declare
  v_dni integer := public.analityka_przytnij(p_dni, 7, 30);
  v_od timestamptz := public.analityka_poczatek_okna(p_teraz, v_dni);
  v_do timestamptz := public.analityka_koniec_okna(p_teraz);
begin
  return query
  select k.urzadzenie, k.wizyty
    from (
      select w.urzadzenie, count(*) as wizyty
        from public.analityka_panel_wizyty(v_od, v_do) w
       group by w.urzadzenie
    ) k
   order by k.wizyty desc, k.urzadzenie collate "C";
end;
$$;


-- ---------- 4. Sesje ----------

-- admin_sesje_przeglad: kafle sesji w jednym obiekcie. Czas sesji to SUMA czas_ms jej odsłon (czas
-- widoczny, nie różnica znaczników); odsłona bez dopasowanego wyjścia dokłada 0, więc czasy są
-- PODŁOGĄ (zgubiony beacon zaniża, nigdy nie zawyża) – panel mówi to w podpowiedzi. Mediany i
-- p75 liczone na sesjach, nie na odsłonach; p75 nie jest „czasem 75% ludzi”, tylko progiem, poniżej
-- którego kończy się 75% sesji. Przy zerze sesji mediana/średnia/p75 są null (nie 0).
create or replace function public.analityka_panel_sesje_przeglad(p_teraz timestamptz, p_dni integer)
returns jsonb
language plpgsql
stable
set search_path = ''
set plan_cache_mode = 'force_custom_plan'
as $$
declare
  v_dni integer := public.analityka_przytnij(p_dni, 7, 30);
  v_od timestamptz := public.analityka_poczatek_okna(p_teraz, v_dni);
  v_do timestamptz := public.analityka_koniec_okna(p_teraz);
  v_wynik jsonb;
begin
  -- Czas wszystkich odsłon (dopasowanie wyjścia po odsłonie), ale bez rozpakowywania sekcji.
  with s as (
    select x.sesja, max(x.strony) as stron, coalesce(sum(x.czas_ms), 0) as czas_ms
      from public.analityka_panel_wyjscia(v_od, v_do, false, false) x
     group by x.sesja
  )
  select jsonb_build_object(
           'sesje', count(*),
           'odslony', coalesce(sum(s.stron), 0)::bigint,
           'mediana_stron', round((percentile_cont(0.5) within group (order by s.stron))::numeric, 2),
           'srednia_stron', round(avg(s.stron), 2),
           'mediana_czas_s', round((percentile_cont(0.5) within group (order by s.czas_ms) / 1000.0)::numeric, 1),
           'p75_czas_s', round((percentile_cont(0.75) within group (order by s.czas_ms) / 1000.0)::numeric, 1),
           'zaangazowane', count(*) filter (where s.stron >= 2 or s.czas_ms >= 30000),
           'jednostronicowe', count(*) filter (where s.stron = 1)
         )
    into v_wynik
    from s;

  return v_wynik;
end;
$$;

-- admin_przejscia: pary ekran → następny ekran w obrębie sesji; wyjście z serwisu jest pełnoprawnym
-- celem '(wyjście)' (bez niego diagram pokazuje same ruchy w środku i nie widać, gdzie kończy się
-- droga). Liczone na ekranach, nie na ścieżkach: 50 kart adresów to jeden ekran „okolica”.
create or replace function public.analityka_panel_przejscia(p_teraz timestamptz, p_dni integer, p_limit integer)
returns table (skad text, dokad text, ile bigint)
language plpgsql
stable
set search_path = ''
set plan_cache_mode = 'force_custom_plan'
as $$
#variable_conflict use_column
declare
  v_dni integer := public.analityka_przytnij(p_dni, 7, 30);
  v_limit integer := public.analityka_przytnij(p_limit, 60, 200);
  v_od timestamptz := public.analityka_poczatek_okna(p_teraz, v_dni);
  v_do timestamptz := public.analityka_koniec_okna(p_teraz);
begin
  return query
  select p.skad, p.dokad, p.ile
    from (
      select s.ekran as skad, coalesce(s.kolejny_ekran, '(wyjście)') as dokad, count(*) as ile
        from public.analityka_panel_odslony(v_od, v_do) s
       group by s.ekran, coalesce(s.kolejny_ekran, '(wyjście)')
    ) p
   order by p.ile desc, p.skad collate "C", p.dokad collate "C"
   limit v_limit;
end;
$$;

-- admin_udostepnienia: zdarzenia typu udostepnienie (element = etykieta, kanał = kanal_udostepnienia).
-- 'anulowano' jest zapisywane celowo: różnica między „otworzył” a „dokończył” jest najcenniejszą
-- liczbą tego zbioru, a klient liczy z niej odsetek dokończeń (podstawa = suma pozycji elementu).
create or replace function public.analityka_panel_udostepnienia(p_teraz timestamptz, p_dni integer)
returns table (element text, kanal text, ile bigint)
language plpgsql
stable
set search_path = ''
set plan_cache_mode = 'force_custom_plan'
as $$
#variable_conflict use_column
declare
  v_dni integer := public.analityka_przytnij(p_dni, 30, 30);
  v_od timestamptz := public.analityka_poczatek_okna(p_teraz, v_dni);
  v_do timestamptz := public.analityka_koniec_okna(p_teraz);
begin
  return query
  select u.element, u.kanal, u.ile
    from (
      select coalesce(z.etykieta, '(bez znacznika)') as element,
             coalesce(z.kanal_udostepnienia, '(nieznany)') as kanal,
             count(*) as ile
        from public.zdarzenia z
       where z.typ = 'udostepnienie'
         and not z.czy_bot
         and z.czas >= v_od and z.czas < v_do
       group by 1, 2
    ) u
   order by u.ile desc, u.element collate "C", u.kanal collate "C"
   limit 200;
end;
$$;


-- ---------- 5. Zaangażowanie ----------

-- admin_sciezki: pierwsze trzy ekrany sesji. Krótsza sesja dopełniana '(wyjście)' – ścieżka
-- „szukaj → okolica → (wyjście)” to wizyta dwustronicowa, nie brak danych.
create or replace function public.analityka_panel_sciezki(p_teraz timestamptz, p_dni integer, p_limit integer)
returns table (krok1 text, krok2 text, krok3 text, sesje bigint)
language plpgsql
stable
set search_path = ''
set plan_cache_mode = 'force_custom_plan'
as $$
#variable_conflict use_column
declare
  v_dni integer := public.analityka_przytnij(p_dni, 7, 30);
  v_limit integer := public.analityka_przytnij(p_limit, 30, 200);
  v_od timestamptz := public.analityka_poczatek_okna(p_teraz, v_dni);
  v_do timestamptz := public.analityka_koniec_okna(p_teraz);
begin
  return query
  select k.krok1, k.krok2, k.krok3, count(*)
    from (
      select max(s.ekran) filter (where s.poz = 1) as krok1,
             coalesce(max(s.ekran) filter (where s.poz = 2), '(wyjście)') as krok2,
             coalesce(max(s.ekran) filter (where s.poz = 3), '(wyjście)') as krok3
        from public.analityka_panel_odslony(v_od, v_do) s
       where s.poz <= 3
       group by s.sesja
    ) k
   group by k.krok1, k.krok2, k.krok3
   order by count(*) desc, k.krok1 collate "C", k.krok2 collate "C", k.krok3 collate "C"
   limit v_limit;
end;
$$;

-- admin_sekcje: czas widoczny i zasięg sekcji ekranów, z kolumny `sekcje` wyjść ([{k, ms, p}]).
-- „Zasięg” sekcji = odsłony, w których była WIDZIANA (ms > 0) – ta sama konwencja co „ostatnia
-- sekcja” w analityka_sesje(): pomiar może zapisywać także sekcje nigdy niewidziane i bez tego
-- warunku zasięg każdej z nich wynosiłby 100%. MIANOWNIK (odslony_ekranu) to wyjścia ekranu Z
-- POMIAREM SEKCJI, nie wszystkie odsłony: odsłona bez wyjścia (zgubiony beacon, brak
-- IntersectionObserver) nie ma jak potwierdzić sekcji i zaniżałaby zasięg każdej z nich.
-- Mediana ms i pozycji liczona tylko po odsłonach, w których sekcja była widziana.
-- Elementy o złym kształcie (nie obiekt, brak k, ms/p nie jest liczbą) są pomijane: rzutowanie na
-- numeric stoi w CASE za sprawdzeniem typu, więc jedna zepsuta sekcja nie wywraca funkcji.
-- jsonb_array_elements zamiast jsonpath: na 540 tys. elementów (7 dób po 20 tys. odsłon) jsonpath
-- liczył 9 s, a to samo przez jsonb_array_elements – ułamek tego.
create or replace function public.analityka_panel_sekcje(p_teraz timestamptz, p_dni integer, p_ekran text)
returns table (
  ekran text,
  sekcja text,
  odslony_z_sekcja bigint,
  odslony_ekranu bigint,
  mediana_ms integer,
  pozycja_med integer
)
language plpgsql
stable
set search_path = ''
set plan_cache_mode = 'force_custom_plan'
as $$
#variable_conflict use_column
declare
  v_dni integer := public.analityka_przytnij(p_dni, 7, 30);
  v_od timestamptz := public.analityka_poczatek_okna(p_teraz, v_dni);
  v_do timestamptz := public.analityka_koniec_okna(p_teraz);
begin
  return query
  with mianownik as (
    select z.ekran, count(*) as n
      from public.zdarzenia z
     where z.typ = 'wyjscie'
       and not z.czy_bot
       and z.sekcje is not null
       and z.czas >= v_od and z.czas < v_do
       and (p_ekran is null or z.ekran = p_ekran)
     group by z.ekran
  ),
  elementy as (
    select w.id, w.ekran,
           case when jsonb_typeof(e.value -> 'k') = 'string' then left(e.value ->> 'k', 48) end as sekcja,
           case when jsonb_typeof(e.value -> 'ms') = 'number' then (e.value ->> 'ms')::float8 end as ms,
           case when jsonb_typeof(e.value -> 'p') = 'number' then (e.value ->> 'p')::float8 end as poz
      from public.zdarzenia w
     cross join lateral jsonb_array_elements(w.sekcje) as e(value)
     where w.typ = 'wyjscie'
       and not w.czy_bot
       and w.sekcje is not null
       and w.czas >= v_od and w.czas < v_do
       and (p_ekran is null or w.ekran = p_ekran)
  ),
  -- Hash po (ekran, sekcja) składa tylko tablice liczb; mediany i liczba RÓŻNYCH wyjść liczą się potem
  -- na samych liczbach w obrębie grupy. Wcześniejsze warianty – percentile_cont po tekstowych kluczach
  -- albo dedukcja (wyjście, sekcja) przez GROUP BY – sortowały albo haszowały ≈ 500 tys. tekstowych kluczy
  -- i kosztowały 5–8 s na 7 dób po 20 tys. odsłon. count(distinct id) zabezpiecza zasięg przed
  -- powtórzonym kluczem sekcji w jednym wyjściu (zasięg nie przekroczy liczby wyjść ekranu).
  agregaty as (
    select x.ekran, x.sekcja,
           array_agg(x.id) as wyjscia,
           array_agg(x.ms) as czasy,
           array_agg(x.poz) as pozycje
      from elementy x
     where x.sekcja is not null and x.ms > 0 and x.poz >= 0
     group by x.ekran, x.sekcja
  )
  select r.ekran, r.sekcja, r.odslony_z_sekcja, r.odslony_ekranu, r.mediana_ms, r.pozycja_med
    from (
      select a.ekran,
             a.sekcja,
             (select count(distinct v) from unnest(a.wyjscia) as v) as odslony_z_sekcja,
             m.n as odslony_ekranu,
             (select round(percentile_cont(0.5) within group (order by v))::integer from unnest(a.czasy) as v) as mediana_ms,
             (select round(percentile_cont(0.5) within group (order by v))::integer from unnest(a.pozycje) as v) as pozycja_med
        from agregaty a
        join mianownik m on m.ekran = a.ekran
    ) r
   order by r.ekran collate "C", r.pozycja_med, r.sekcja collate "C"
   limit 500;
end;
$$;
-- admin_punkt_urwania: gdzie kończą się wizyty – (ekran, ostatnia widziana sekcja) ostatniej
-- odsłony sesji. Każda sesja ma dokładnie jedną ostatnią odsłonę, więc suma `sesje` po wszystkich
-- pozycjach równa się liczbie sesji (podstawa udziałów). '(brak pomiaru)' = brak wyjścia
-- (zgubiony beacon) albo wyjście bez widzianej sekcji; to osobna pozycja, nie wyrzucona z sumy.
create or replace function public.analityka_panel_punkt_urwania(p_teraz timestamptz, p_dni integer, p_limit integer)
returns table (ekran text, sekcja text, sesje bigint)
language plpgsql
stable
set search_path = ''
set plan_cache_mode = 'force_custom_plan'
as $$
#variable_conflict use_column
declare
  v_dni integer := public.analityka_przytnij(p_dni, 7, 30);
  v_limit integer := public.analityka_przytnij(p_limit, 30, 200);
  v_od timestamptz := public.analityka_poczatek_okna(p_teraz, v_dni);
  v_do timestamptz := public.analityka_koniec_okna(p_teraz);
begin
  return query
  select u.ekran, u.sekcja, u.sesje
    from (
      select s.ekran, coalesce(s.ostatnia_sekcja, '(brak pomiaru)') as sekcja, count(*) as sesje
        from public.analityka_panel_wyjscia(v_od, v_do, true, true) s
       group by s.ekran, coalesce(s.ostatnia_sekcja, '(brak pomiaru)')
    ) u
   order by u.sesje desc, u.ekran collate "C", u.sekcja collate "C"
   limit v_limit;
end;
$$;


-- ---------- 6. CTA ----------

-- Wspólne dla trzech funkcji CTA: kolumna `cta` wyjść ([{"k": "sekcja§cel", "e": ekspozycje,
-- "n": kliki}]). Jeden element = jeden przycisk jednej odsłony. Ekspozycje i kliki obcinane do
-- 0..1000 na element (jak w z-dykty): zatruty wiersz nie przesunie sumy o miliony, a realna
-- odsłona nie pokazuje przycisku tysiąc razy. Klucz bez separatora § jest sekcją bez celu.
-- Mianownikiem klikalności są EKSPOZYCJE przycisku, nie odsłony ekranu: przycisk w stopce widać
-- rzadziej niż ten w nagłówku i dzielenie obu przez odsłony kazałoby stopce wyglądać na martwą.

-- admin_cta_sekcje: wyświetlenia i kliknięcia CTA zsumowane po sekcji ekranu.
create or replace function public.analityka_panel_cta_sekcje(p_teraz timestamptz, p_dni integer, p_ekran text)
returns table (ekran text, sekcja text, wyswietlenia bigint, klikniecia bigint)
language plpgsql
stable
set search_path = ''
set plan_cache_mode = 'force_custom_plan'
as $$
#variable_conflict use_column
declare
  v_dni integer := public.analityka_przytnij(p_dni, 7, 30);
  v_od timestamptz := public.analityka_poczatek_okna(p_teraz, v_dni);
  v_do timestamptz := public.analityka_koniec_okna(p_teraz);
begin
  return query
  select r.ekran, r.sekcja, r.wyswietlenia, r.klikniecia
    from (
      select z.ekran,
             split_part(c.value ->> 'k', '§', 1) as sekcja,
             sum(least(greatest((c.value ->> 'e')::numeric, 0), 1000))::bigint as wyswietlenia,
             sum(least(greatest((c.value ->> 'n')::numeric, 0), 1000))::bigint as klikniecia
        from public.zdarzenia z
       cross join lateral jsonb_path_query(
               z.cta,
               '$[*] ? (@.k.type() == "string" && @.e.type() == "number" && @.n.type() == "number")'
             ) as c(value)
       where z.typ = 'wyjscie'
         and not z.czy_bot
         and z.cta is not null
         and z.czas >= v_od and z.czas < v_do
         and (p_ekran is null or z.ekran = p_ekran)
       group by z.ekran, split_part(c.value ->> 'k', '§', 1)
    ) r
   order by r.wyswietlenia desc, r.klikniecia desc, r.ekran collate "C", r.sekcja collate "C"
   limit 500;
end;
$$;

-- admin_cta_martwe: przyciski wyświetlone co najmniej p_min razy i ANI RAZU nieklikane w oknie.
-- Próg bezwzględny (nie „CTR poniżej mediany”): 50 wyświetleń bez kliknięcia to fakt, który
-- właściciel rozumie bez statystyki. Uwaga: przycisk bez kliknięć bywa informacją (etykietą), nie
-- akcją, więc lista to wskazówka do przejrzenia, a nie wyrok.
create or replace function public.analityka_panel_cta_martwe(p_teraz timestamptz, p_dni integer, p_min integer)
returns table (ekran text, sekcja text, cel text, wyswietlenia bigint)
language plpgsql
stable
set search_path = ''
set plan_cache_mode = 'force_custom_plan'
as $$
#variable_conflict use_column
declare
  v_dni integer := public.analityka_przytnij(p_dni, 7, 30);
  v_min integer := public.analityka_przytnij(p_min, 50, 1000000);
  v_od timestamptz := public.analityka_poczatek_okna(p_teraz, v_dni);
  v_do timestamptz := public.analityka_koniec_okna(p_teraz);
begin
  return query
  select r.ekran, r.sekcja, r.cel, r.wyswietlenia
    from (
      select z.ekran,
             split_part(c.value ->> 'k', '§', 1) as sekcja,
             coalesce(nullif(split_part(c.value ->> 'k', '§', 2), ''), '(brak)') as cel,
             sum(least(greatest((c.value ->> 'e')::numeric, 0), 1000))::bigint as wyswietlenia,
             sum(least(greatest((c.value ->> 'n')::numeric, 0), 1000))::bigint as klikniecia
        from public.zdarzenia z
       cross join lateral jsonb_path_query(
               z.cta,
               '$[*] ? (@.k.type() == "string" && @.e.type() == "number" && @.n.type() == "number")'
             ) as c(value)
       where z.typ = 'wyjscie'
         and not z.czy_bot
         and z.cta is not null
         and z.czas >= v_od and z.czas < v_do
       group by z.ekran,
                split_part(c.value ->> 'k', '§', 1),
                coalesce(nullif(split_part(c.value ->> 'k', '§', 2), ''), '(brak)')
    ) r
   where r.klikniecia = 0
     and r.wyswietlenia >= v_min
   order by r.wyswietlenia desc, r.ekran collate "C", r.sekcja collate "C", r.cel collate "C"
   limit 500;
end;
$$;

-- admin_ux_sygnaly: sygnały frustracji z kliknięć (zdarzenia typu klik, etykieta
-- sekcja§rodzaj§cel): 'furia' = seria szybkich kliknięć w jedno miejsce, 'martwy' = klik w element,
-- który niczym klikalnym nie jest. Zwracamy `ile` i `odslony_ekranu` OSOBNO – klient liczy
-- „na 1000 odsłon”; liczba bezwzględna stawiałaby na czele listy po prostu najpopularniejszy ekran.
create or replace function public.analityka_panel_ux_sygnaly(p_teraz timestamptz, p_dni integer)
returns table (ekran text, rodzaj text, ile bigint, odslony_ekranu bigint)
language plpgsql
stable
set search_path = ''
set plan_cache_mode = 'force_custom_plan'
as $$
#variable_conflict use_column
declare
  v_dni integer := public.analityka_przytnij(p_dni, 7, 30);
  v_od timestamptz := public.analityka_poczatek_okna(p_teraz, v_dni);
  v_do timestamptz := public.analityka_koniec_okna(p_teraz);
begin
  return query
  with sygnaly as (
    select z.ekran, split_part(z.etykieta, '§', 2) as rodzaj, count(*) as ile
      from public.zdarzenia z
     where z.typ = 'klik'
       and not z.czy_bot
       and z.czas >= v_od and z.czas < v_do
       and split_part(z.etykieta, '§', 2) in ('furia', 'martwy')
     group by z.ekran, split_part(z.etykieta, '§', 2)
  ),
  odslony as (
    select z.ekran, count(*) as n
      from public.zdarzenia z
     where z.typ = 'odslona'
       and not z.czy_bot
       and z.czas >= v_od and z.czas < v_do
     group by z.ekran
  )
  select s.ekran, s.rodzaj, s.ile, coalesce(o.n, 0)
    from sygnaly s
    left join odslony o on o.ekran = s.ekran
   order by s.ile desc, s.ekran collate "C", s.rodzaj collate "C"
   limit 500;
end;
$$;


-- ---------- 7. Treść ----------

-- admin_top_ekrany: odsłony i unikalni ekranów. Unikalni liczeni w obrębie każdego ekranu osobno,
-- więc ich NIE wolno sumować między wierszami (ta sama osoba odwiedza kilka ekranów).
create or replace function public.analityka_panel_top_ekrany(p_teraz timestamptz, p_dni integer)
returns table (ekran text, odslony bigint, unikalni bigint)
language plpgsql
stable
set search_path = ''
set plan_cache_mode = 'force_custom_plan'
as $$
#variable_conflict use_column
declare
  v_dni integer := public.analityka_przytnij(p_dni, 7, 30);
  v_od timestamptz := public.analityka_poczatek_okna(p_teraz, v_dni);
  v_do timestamptz := public.analityka_koniec_okna(p_teraz);
begin
  return query
  select e.ekran, e.odslony, e.unikalni
    from (
      -- dwa kroki (ekran, odcisk) → (ekran) zamiast count(distinct): hash zamiast sortowania
      select g.ekran, sum(g.n)::bigint as odslony, (count(g.odcisk))::bigint as unikalni
        from (
          select z.ekran, z.odcisk, count(*) as n
            from public.zdarzenia z
           where z.typ = 'odslona'
             and not z.czy_bot
             and z.czas >= v_od and z.czas < v_do
           group by z.ekran, z.odcisk
        ) g
       group by g.ekran
    ) e
   order by e.odslony desc, e.ekran collate "C"
   limit 500;
end;
$$;

-- admin_top_adresy: karty adresów (ekran 'okolica') wg ścieżki serwisu zapisanej przez pomiar
-- (np. /adres/<slug>), bez hosta. Unikalni jak w top_ekrany: w obrębie wiersza.
create or replace function public.analityka_panel_top_adresy(p_teraz timestamptz, p_dni integer, p_limit integer)
returns table (sciezka text, odslony bigint, unikalni bigint)
language plpgsql
stable
set search_path = ''
set plan_cache_mode = 'force_custom_plan'
as $$
#variable_conflict use_column
declare
  v_dni integer := public.analityka_przytnij(p_dni, 7, 30);
  v_limit integer := public.analityka_przytnij(p_limit, 50, 200);
  v_od timestamptz := public.analityka_poczatek_okna(p_teraz, v_dni);
  v_do timestamptz := public.analityka_koniec_okna(p_teraz);
begin
  return query
  select a.sciezka, a.odslony, a.unikalni
    from (
      select g.sciezka, sum(g.n)::bigint as odslony, (count(g.odcisk))::bigint as unikalni
        from (
          select z.sciezka, z.odcisk, count(*) as n
            from public.zdarzenia z
           where z.typ = 'odslona'
             and z.ekran = 'okolica'
             and not z.czy_bot
             and z.czas >= v_od and z.czas < v_do
           group by z.sciezka, z.odcisk
        ) g
       group by g.sciezka
    ) a
   order by a.odslony desc, a.sciezka collate "C"
   limit v_limit;
end;
$$;

-- admin_bez_wyniku: wyszukiwania bez wyniku (zdarzenie produktowe wyszukanie_bez_wyniku,
-- właściwość `fraza`) – gotowa lista braków w danych. Fraza jest już znormalizowana przez klienta;
-- tu jeszcze małe litery i przycięcie, żeby „Ul. Długa” i „ul. długa” nie rozbiły jednej pozycji.
-- FRAZY ODRZUCONE (klient wykrył e-mail, telefon, PESEL i zamiast frazy zapisał {"odrzucono": true})
-- pokazujemy jako OSOBNĄ POZYCJĘ '[odrzucono]', nie pomijamy: suma pozycji ma się równać liczbie
-- wyszukiwań bez wyniku, a wysoka liczba odrzuconych sama jest informacją (ludzie wpisują dane osobowe).
-- Zdarzenie bez frazy i bez znacznika odrzucenia (zepsuty klient) jest pomijane.
create or replace function public.analityka_panel_bez_wyniku(p_teraz timestamptz, p_dni integer, p_limit integer)
returns table (fraza text, ile bigint, ostatnio timestamptz)
language plpgsql
stable
set search_path = ''
set plan_cache_mode = 'force_custom_plan'
as $$
#variable_conflict use_column
declare
  v_dni integer := public.analityka_przytnij(p_dni, 30, 30);
  v_limit integer := public.analityka_przytnij(p_limit, 100, 200);
  v_od timestamptz := public.analityka_poczatek_okna(p_teraz, v_dni);
  v_do timestamptz := public.analityka_koniec_okna(p_teraz);
begin
  return query
  select f.fraza, f.ile, f.ostatnio
    from (
      select b.fraza, count(*) as ile, max(b.czas) as ostatnio
        from (
          select case
                   when z.wlasciwosci ->> 'odrzucono' = 'true'
                     or z.wlasciwosci ->> 'fraza' = '[odrzucono]'
                   then '[odrzucono]'
                   else nullif(left(lower(btrim(z.wlasciwosci ->> 'fraza')), 80), '')
                 end as fraza,
                 z.czas
            from public.zdarzenia z
           where z.typ = 'produktowe'
             and z.nazwa = 'wyszukanie_bez_wyniku'
             and not z.czy_bot
             and z.czas >= v_od and z.czas < v_do
        ) b
       where b.fraza is not null
       group by b.fraza
    ) f
   order by f.ile desc, f.ostatnio desc, f.fraza collate "C"
   limit v_limit;
end;
$$;

-- admin_lejek: sesje, które zrobiły dany krok. Kroki są NIEZALEŻNE (sesja z kartą adresu bez
-- wyszukania też liczy się do karty), więc kolejne liczby mogą w skrajnym przypadku rosnąć;
-- procent od pierwszego kroku liczy klient. Zdarzenie produktowe należy do sesji, jeśli ma ten sam
-- odcisk i czas z przedziału [pierwsza odsłona sesji, ostatnia odsłona + 30 min]. Przedziały
-- kolejnych sesji jednego odcisku się nie nakładają (przerwa między sesjami jest dłuższa niż 30
-- min), więc zdarzenie trafia najwyżej do jednej. Zawsze pięć wierszy, także z zerem.
create or replace function public.analityka_panel_lejek(p_teraz timestamptz, p_dni integer)
returns table (krok text, kolejnosc integer, sesje bigint)
language plpgsql
stable
set search_path = ''
set plan_cache_mode = 'force_custom_plan'
as $$
#variable_conflict use_column
declare
  v_dni integer := public.analityka_przytnij(p_dni, 7, 30);
  v_od timestamptz := public.analityka_poczatek_okna(p_teraz, v_dni);
  v_do timestamptz := public.analityka_koniec_okna(p_teraz);
begin
  return query
  with okna as (
    select s.sesja,
           s.odcisk,
           min(s.czas) as od,
           max(s.czas) + interval '30 minutes' as do_
      from public.analityka_panel_odslony(v_od, v_do) s
     group by s.sesja, s.odcisk
  ),
  kroki(krok, kolejnosc) as (
    values ('wyszukanie', 1), ('karta_adresu', 2), ('porownanie_dodaj', 3),
           ('warstwa_mapy', 4), ('tryb_biznes', 5)
  ),
  trafienia as (
    select z.nazwa as krok, count(distinct o.sesja) as sesje
      from okna o
      join public.zdarzenia z
        on z.odcisk = o.odcisk
       and z.czas >= o.od
       and z.czas <= o.do_
     where z.typ = 'produktowe'
       and not z.czy_bot
       and z.nazwa in (select k.krok from kroki k)
     group by z.nazwa
  )
  select k.krok, k.kolejnosc, coalesce(t.sesje, 0)
    from kroki k
    left join trafienia t on t.krok = k.krok
   order by k.kolejnosc;
end;
$$;


-- ---------- 8. Jakość ----------

-- admin_diagnostyka: czy pomiar w ogóle działa. Liczone na ruchu LUDZI, spójnie z resztą panelu
-- (ta sama liczba odsłon w Przeglądzie i tutaj); boty nie wchodzą ani do liczników, ani do
-- „ostatniego zdarzenia”. Zawsze wszystkie siedem typów (zero = cisza danego typu, i właśnie to ma
-- wykryć diagnostyka); `bez_odcisku_24h` ma tę samą populację co suma typów, więc klient policzy
-- odsetek wprost. dni_w_zestawieniu = liczba różnych dób w zestawieniu dziennym.
-- ostatni_bieg (null, gdy zestawienie jeszcze nie biegło): najnowszy wiersz analityka_biegi Z BŁĘDEM
-- (blad is not null) z ostatnich 26 godzin, a gdy takiego nie ma – po prostu najnowszy wiersz.
-- Powód: nocny bieg zapisuje trzy wiersze (sprzątanie, zestaw za przedwczoraj, zestaw za wczoraj), więc
-- „najnowszy wiersz” to zawsze ostatni krok, a błąd wcześniejszego kroku – sprzątania albo zestawienia
-- sprzed dwóch dni – nie zapaliłby w Jakości czerwonego wskaźnika. 26 godzin = doba biegu plus zapas
-- na spóźnienie (ta sama granica, od której Jakość uznaje bieg za zaległy). Granica jest wyłączna.
create or replace function public.analityka_panel_diagnostyka(p_teraz timestamptz)
returns jsonb
language plpgsql
stable
set search_path = ''
set plan_cache_mode = 'force_custom_plan'
as $$
declare
  v_ostatnie timestamptz;
  v_najstarsze timestamptz;
  v_typy jsonb;
  v_bez_odcisku bigint;
  v_bieg jsonb;
  v_dni_zestawienia bigint;
begin
  select max(z.czas), min(z.czas)
    into v_ostatnie, v_najstarsze
    from public.zdarzenia z
   where not z.czy_bot
     and z.czas <= p_teraz;

  select jsonb_build_object(
           'odslona', count(*) filter (where z.typ = 'odslona'),
           'wyjscie', count(*) filter (where z.typ = 'wyjscie'),
           'klik', count(*) filter (where z.typ = 'klik'),
           'udostepnienie', count(*) filter (where z.typ = 'udostepnienie'),
           'produktowe', count(*) filter (where z.typ = 'produktowe'),
           'wital', count(*) filter (where z.typ = 'wital'),
           'blad', count(*) filter (where z.typ = 'blad')
         ),
         count(*) filter (where z.odcisk is null)
    into v_typy, v_bez_odcisku
    from public.zdarzenia z
   where not z.czy_bot
     and z.czas > p_teraz - interval '24 hours'
     and z.czas <= p_teraz;

  select jsonb_build_object('rodzaj', b.rodzaj, 'koniec', public.analityka_iso(b.koniec), 'blad', b.blad)
    into v_bieg
    from public.analityka_biegi b
   order by (b.blad is not null
             and b.start > p_teraz - interval '26 hours'
             and b.start <= p_teraz) desc,
            b.start desc,
            b.id desc
   limit 1;

  select count(distinct d.dzien) into v_dni_zestawienia from public.analityka_dzienna d;

  return jsonb_build_object(
    'ostatnie_zdarzenie', public.analityka_iso(v_ostatnie),
    'zdarzenia_24h', v_typy,
    'bez_odcisku_24h', v_bez_odcisku,
    'ostatni_bieg', v_bieg,
    'dni_w_zestawieniu', v_dni_zestawienia,
    'najstarsze_zdarzenie', public.analityka_iso(v_najstarsze)
  );
end;
$$;

-- admin_witale: p75 na ekran i metrykę (percentile_cont(0.75) na wartosc). p75, nie średnia: tak
-- liczy Core Web Vitals Google, a średnia z LCP jest bezużyteczna (jeden telefon w tunelu przesuwa
-- ją bardziej niż setka szybkich wejść). Jednostka: ms; CLS jako ułamek. `probki` to liczba
-- pomiarów, nie osób – p75 z trzech pomiarów i z trzech tysięcy wygląda tak samo, dlatego próbki
-- idą obok. Kolejność metryk stała (lcp, inp, cls, fcp, ttfb), żeby tabela nie skakała.
create or replace function public.analityka_panel_witale(p_teraz timestamptz, p_dni integer)
returns table (ekran text, metryka text, p75 numeric, probki bigint)
language plpgsql
stable
set search_path = ''
set plan_cache_mode = 'force_custom_plan'
as $$
#variable_conflict use_column
declare
  v_dni integer := public.analityka_przytnij(p_dni, 7, 30);
  v_od timestamptz := public.analityka_poczatek_okna(p_teraz, v_dni);
  v_do timestamptz := public.analityka_koniec_okna(p_teraz);
begin
  return query
  select z.ekran,
         z.nazwa,
         round((percentile_cont(0.75) within group (order by z.wartosc))::numeric, 3),
         count(*)
    from public.zdarzenia z
   where z.typ = 'wital'
     and not z.czy_bot
     and z.wartosc is not null
     and z.czas >= v_od and z.czas < v_do
   group by z.ekran, z.nazwa
   order by z.ekran collate "C",
            array_position(array['lcp', 'inp', 'cls', 'fcp', 'ttfb'], z.nazwa),
            z.nazwa collate "C"
   limit 500;
end;
$$;

-- admin_bledy: błędy klienta zgrupowane po (komunikat, ekran). Komunikat jest już przycięty i
-- pozbawiony długich liczb przez trigger; grupowanie po obu kolumnach, bo ten sam wyjątek na dwóch
-- ekranach to dwa różne miejsca do naprawy.
create or replace function public.analityka_panel_bledy(p_teraz timestamptz, p_dni integer, p_limit integer)
returns table (komunikat text, ekran text, ile bigint, ostatnio timestamptz)
language plpgsql
stable
set search_path = ''
set plan_cache_mode = 'force_custom_plan'
as $$
#variable_conflict use_column
declare
  v_dni integer := public.analityka_przytnij(p_dni, 7, 30);
  v_limit integer := public.analityka_przytnij(p_limit, 50, 200);
  v_od timestamptz := public.analityka_poczatek_okna(p_teraz, v_dni);
  v_do timestamptz := public.analityka_koniec_okna(p_teraz);
begin
  return query
  select e.komunikat, e.ekran, e.ile, e.ostatnio
    from (
      select z.komunikat, z.ekran, count(*) as ile, max(z.czas) as ostatnio
        from public.zdarzenia z
       where z.typ = 'blad'
         and not z.czy_bot
         and z.czas >= v_od and z.czas < v_do
       group by z.komunikat, z.ekran
    ) e
   order by e.ile desc, e.ostatnio desc, e.komunikat collate "C", e.ekran collate "C"
   limit v_limit;
end;
$$;

-- Wewnętrzne: żadnych praw dla ról klienckich (woła je wyłącznie definer po bramce).
revoke all on function public.analityka_panel_przeglad(timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.analityka_panel_seria_dzienna(timestamptz, integer) from public, anon, authenticated, service_role;
revoke all on function public.analityka_panel_seria_godzinowa(timestamptz, integer) from public, anon, authenticated, service_role;
revoke all on function public.analityka_panel_boty_ai(timestamptz, integer) from public, anon, authenticated, service_role;
revoke all on function public.analityka_panel_kanaly(timestamptz, integer) from public, anon, authenticated, service_role;
revoke all on function public.analityka_panel_zrodla(timestamptz, integer, integer) from public, anon, authenticated, service_role;
revoke all on function public.analityka_panel_kampanie(timestamptz, integer) from public, anon, authenticated, service_role;
revoke all on function public.analityka_panel_kraje(timestamptz, integer) from public, anon, authenticated, service_role;
revoke all on function public.analityka_panel_urzadzenia(timestamptz, integer) from public, anon, authenticated, service_role;
revoke all on function public.analityka_panel_sesje_przeglad(timestamptz, integer) from public, anon, authenticated, service_role;
revoke all on function public.analityka_panel_przejscia(timestamptz, integer, integer) from public, anon, authenticated, service_role;
revoke all on function public.analityka_panel_udostepnienia(timestamptz, integer) from public, anon, authenticated, service_role;
revoke all on function public.analityka_panel_sciezki(timestamptz, integer, integer) from public, anon, authenticated, service_role;
revoke all on function public.analityka_panel_sekcje(timestamptz, integer, text) from public, anon, authenticated, service_role;
revoke all on function public.analityka_panel_punkt_urwania(timestamptz, integer, integer) from public, anon, authenticated, service_role;
revoke all on function public.analityka_panel_cta_sekcje(timestamptz, integer, text) from public, anon, authenticated, service_role;
revoke all on function public.analityka_panel_cta_martwe(timestamptz, integer, integer) from public, anon, authenticated, service_role;
revoke all on function public.analityka_panel_ux_sygnaly(timestamptz, integer) from public, anon, authenticated, service_role;
revoke all on function public.analityka_panel_top_ekrany(timestamptz, integer) from public, anon, authenticated, service_role;
revoke all on function public.analityka_panel_top_adresy(timestamptz, integer, integer) from public, anon, authenticated, service_role;
revoke all on function public.analityka_panel_bez_wyniku(timestamptz, integer, integer) from public, anon, authenticated, service_role;
revoke all on function public.analityka_panel_lejek(timestamptz, integer) from public, anon, authenticated, service_role;
revoke all on function public.analityka_panel_diagnostyka(timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.analityka_panel_witale(timestamptz, integer) from public, anon, authenticated, service_role;
revoke all on function public.analityka_panel_bledy(timestamptz, integer, integer) from public, anon, authenticated, service_role;


-- =====================================================================
-- PUBLICZNE admin_*: bramka + now() + wewnętrzna funkcja z jawnym czasem
-- =====================================================================

-- ---------- Przegląd ----------

create or replace function public.admin_przeglad()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout = '30s'
set work_mem = '64MB'
as $$
begin
  if not public.jest_adminem() then
    raise exception 'brak dostępu' using errcode = '42501';
  end if;
  return public.analityka_panel_przeglad(now());
end;
$$;

comment on function public.admin_przeglad() is
  'Przegląd ruchu: unikalni (dziś, wczoraj, 7 dób jako suma dobowych, średnia), odsłony 24 h / 7 / 30 dób, szczyt godzinowy i dzienny, teraz na stronie (5 min), podział ludzie/boty z 24 h. Jeden obiekt jsonb, liczby surowe. Bramka: jest_adminem().';

revoke all on function public.admin_przeglad() from public, anon;
grant execute on function public.admin_przeglad() to authenticated;

create or replace function public.admin_seria_dzienna(p_dni integer default 30)
returns table (dzien date, odslony bigint, unikalni bigint, odslony_boty bigint)
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout = '30s'
set work_mem = '64MB'
as $$
begin
  if not public.jest_adminem() then
    raise exception 'brak dostępu' using errcode = '42501';
  end if;
  return query select * from public.analityka_panel_seria_dzienna(now(), p_dni);
end;
$$;

comment on function public.admin_seria_dzienna(integer) is
  'Seria dzienna (do 90 dób): historia z zestawienia dziennego, dzisiejsza doba i doby bez zestawienia na żywo; doby bez danych bez wiersza. Odsłony i unikalni ludzi, boty osobno.';

revoke all on function public.admin_seria_dzienna(integer) from public, anon;
grant execute on function public.admin_seria_dzienna(integer) to authenticated;

create or replace function public.admin_seria_godzinowa(p_godzin integer default 48)
returns table (godzina timestamptz, odslony bigint, unikalni bigint, odslony_boty bigint)
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout = '30s'
set work_mem = '64MB'
as $$
begin
  if not public.jest_adminem() then
    raise exception 'brak dostępu' using errcode = '42501';
  end if;
  return query select * from public.analityka_panel_seria_godzinowa(now(), p_godzin);
end;
$$;

comment on function public.admin_seria_godzinowa(integer) is
  'Seria godzinowa (do 168 godzin) ciągła w czasie bezwzględnym: godzina bez ruchu to 0, doba 23/25-godzinna nie gubi godzin. unikalni są per godzina (nie sumować).';

revoke all on function public.admin_seria_godzinowa(integer) from public, anon;
grant execute on function public.admin_seria_godzinowa(integer) to authenticated;

create or replace function public.admin_boty_ai(p_dni integer default 30)
returns table (rodzina text, klasa text, odslony bigint, ostatnio timestamptz)
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout = '30s'
set work_mem = '64MB'
as $$
begin
  if not public.jest_adminem() then
    raise exception 'brak dostępu' using errcode = '42501';
  end if;
  return query select * from public.analityka_panel_boty_ai(now(), p_dni);
end;
$$;

comment on function public.admin_boty_ai(integer) is
  'Wszystkie rodziny botów z odsłon w oknie (do 30 dób), klasa ai najpierw, potem malejąco po odsłonach. Jedyna funkcja z botami poza podziałem w admin_przeglad.';

revoke all on function public.admin_boty_ai(integer) from public, anon;
grant execute on function public.admin_boty_ai(integer) to authenticated;


-- ---------- Akwizycja ----------

create or replace function public.admin_kanaly(p_dni integer default 7)
returns table (kanal text, wizyty bigint, odslony bigint)
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout = '30s'
set work_mem = '64MB'
as $$
begin
  if not public.jest_adminem() then
    raise exception 'brak dostępu' using errcode = '42501';
  end if;
  return query select * from public.analityka_panel_kanaly(now(), p_dni);
end;
$$;

comment on function public.admin_kanaly(integer) is
  'Wizyty (= sesje) i odsłony tych sesji wg kanału wejścia z pierwszej odsłony; sesja zaczęta odsłoną wewnętrzną liczy się jako bezposrednie. Okno do 30 dób.';

revoke all on function public.admin_kanaly(integer) from public, anon;
grant execute on function public.admin_kanaly(integer) to authenticated;

create or replace function public.admin_zrodla(p_dni integer default 7, p_limit integer default 50)
returns table (kanal text, zrodlo text, sciezka text, wizyty bigint)
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout = '30s'
set work_mem = '64MB'
as $$
begin
  if not public.jest_adminem() then
    raise exception 'brak dostępu' using errcode = '42501';
  end if;
  return query select * from public.analityka_panel_zrodla(now(), p_dni, p_limit);
end;
$$;

comment on function public.admin_zrodla(integer, integer) is
  'Wizyty wg kanału, źródła (utm_source, a bez niego host referera, a bez niego nazwa click-id) i ścieżki referera. Brak źródła to (bezpośrednie), brak ścieżki to (brak). p_limit ≤ 200.';

revoke all on function public.admin_zrodla(integer, integer) from public, anon;
grant execute on function public.admin_zrodla(integer, integer) to authenticated;

create or replace function public.admin_kampanie(p_dni integer default 30)
returns table (utm_source text, utm_medium text, utm_campaign text, wizyty bigint)
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout = '30s'
set work_mem = '64MB'
as $$
begin
  if not public.jest_adminem() then
    raise exception 'brak dostępu' using errcode = '42501';
  end if;
  return query select * from public.analityka_panel_kampanie(now(), p_dni);
end;
$$;

comment on function public.admin_kampanie(integer) is
  'Wizyty ze znacznikiem UTM wg utm_source/medium/campaign (brak członu to (brak)). Okno do 30 dób.';

revoke all on function public.admin_kampanie(integer) from public, anon;
grant execute on function public.admin_kampanie(integer) to authenticated;

create or replace function public.admin_kraje(p_dni integer default 7)
returns table (kraj text, wizyty bigint)
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout = '30s'
set work_mem = '64MB'
as $$
begin
  if not public.jest_adminem() then
    raise exception 'brak dostępu' using errcode = '42501';
  end if;
  return query select * from public.analityka_panel_kraje(now(), p_dni);
end;
$$;

comment on function public.admin_kraje(integer) is
  'Wizyty wg kraju pierwszej odsłony; brak kraju to osobna pozycja (nieznany). Okno do 30 dób.';

revoke all on function public.admin_kraje(integer) from public, anon;
grant execute on function public.admin_kraje(integer) to authenticated;

create or replace function public.admin_urzadzenia(p_dni integer default 7)
returns table (urzadzenie text, wizyty bigint)
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout = '30s'
set work_mem = '64MB'
as $$
begin
  if not public.jest_adminem() then
    raise exception 'brak dostępu' using errcode = '42501';
  end if;
  return query select * from public.analityka_panel_urzadzenia(now(), p_dni);
end;
$$;

comment on function public.admin_urzadzenia(integer) is
  'Wizyty wg klasy urządzenia pierwszej odsłony (mobile, tablet, desktop, inne). Okno do 30 dób.';

revoke all on function public.admin_urzadzenia(integer) from public, anon;
grant execute on function public.admin_urzadzenia(integer) to authenticated;


-- ---------- Sesje ----------

create or replace function public.admin_sesje_przeglad(p_dni integer default 7)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout = '30s'
set work_mem = '64MB'
as $$
begin
  if not public.jest_adminem() then
    raise exception 'brak dostępu' using errcode = '42501';
  end if;
  return public.analityka_panel_sesje_przeglad(now(), p_dni);
end;
$$;

comment on function public.admin_sesje_przeglad(integer) is
  'Kafle sesji: sesje, odsłony, mediana i średnia stron na sesję, mediana i p75 czasu sesji (s, podłoga), sesje zaangażowane (≥ 2 odsłony albo ≥ 30 s widoczności) i jednostronicowe. Przy zerze sesji statystyki są null.';

revoke all on function public.admin_sesje_przeglad(integer) from public, anon;
grant execute on function public.admin_sesje_przeglad(integer) to authenticated;

create or replace function public.admin_przejscia(p_dni integer default 7, p_limit integer default 60)
returns table (skad text, dokad text, ile bigint)
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout = '30s'
set work_mem = '64MB'
as $$
begin
  if not public.jest_adminem() then
    raise exception 'brak dostępu' using errcode = '42501';
  end if;
  return query select * from public.analityka_panel_przejscia(now(), p_dni, p_limit);
end;
$$;

comment on function public.admin_przejscia(integer, integer) is
  'Przejścia ekran → następny ekran w sesji; wyjście z serwisu to cel (wyjście). p_limit ≤ 200.';

revoke all on function public.admin_przejscia(integer, integer) from public, anon;
grant execute on function public.admin_przejscia(integer, integer) to authenticated;

create or replace function public.admin_udostepnienia(p_dni integer default 30)
returns table (element text, kanal text, ile bigint)
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout = '30s'
set work_mem = '64MB'
as $$
begin
  if not public.jest_adminem() then
    raise exception 'brak dostępu' using errcode = '42501';
  end if;
  return query select * from public.analityka_panel_udostepnienia(now(), p_dni);
end;
$$;

comment on function public.admin_udostepnienia(integer) is
  'Udostępnienia: element (etykieta) × kanał (link, kopia, natywne, anulowano, blad). Okno do 30 dób.';

revoke all on function public.admin_udostepnienia(integer) from public, anon;
grant execute on function public.admin_udostepnienia(integer) to authenticated;


-- ---------- Zaangażowanie ----------

create or replace function public.admin_sciezki(p_dni integer default 7, p_limit integer default 30)
returns table (krok1 text, krok2 text, krok3 text, sesje bigint)
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout = '30s'
set work_mem = '64MB'
as $$
begin
  if not public.jest_adminem() then
    raise exception 'brak dostępu' using errcode = '42501';
  end if;
  return query select * from public.analityka_panel_sciezki(now(), p_dni, p_limit);
end;
$$;

comment on function public.admin_sciezki(integer, integer) is
  'Najczęstsze ścieżki: pierwsze trzy ekrany sesji, brak kroku to (wyjście). p_limit ≤ 200.';

revoke all on function public.admin_sciezki(integer, integer) from public, anon;
grant execute on function public.admin_sciezki(integer, integer) to authenticated;

create or replace function public.admin_sekcje(p_dni integer default 7, p_ekran text default null)
returns table (
  ekran text,
  sekcja text,
  odslony_z_sekcja bigint,
  odslony_ekranu bigint,
  mediana_ms integer,
  pozycja_med integer
)
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout = '30s'
set work_mem = '64MB'
as $$
begin
  if not public.jest_adminem() then
    raise exception 'brak dostępu' using errcode = '42501';
  end if;
  return query select * from public.analityka_panel_sekcje(now(), p_dni, p_ekran);
end;
$$;

comment on function public.admin_sekcje(integer, text) is
  'Sekcje ekranów: odsłony, w których sekcja była widziana (ms > 0), odsłony ekranu z pomiarem sekcji (mianownik), mediana czasu widocznego (ms) i mediana pozycji. p_ekran = null: wszystkie ekrany.';

revoke all on function public.admin_sekcje(integer, text) from public, anon;
grant execute on function public.admin_sekcje(integer, text) to authenticated;

create or replace function public.admin_punkt_urwania(p_dni integer default 7, p_limit integer default 30)
returns table (ekran text, sekcja text, sesje bigint)
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout = '30s'
set work_mem = '64MB'
as $$
begin
  if not public.jest_adminem() then
    raise exception 'brak dostępu' using errcode = '42501';
  end if;
  return query select * from public.analityka_panel_punkt_urwania(now(), p_dni, p_limit);
end;
$$;

comment on function public.admin_punkt_urwania(integer, integer) is
  'Gdzie kończą się wizyty: (ekran, ostatnia widziana sekcja) ostatniej odsłony sesji; (brak pomiaru) gdy wyjścia brak. Suma po wszystkich pozycjach = liczba sesji. p_limit ≤ 200.';

revoke all on function public.admin_punkt_urwania(integer, integer) from public, anon;
grant execute on function public.admin_punkt_urwania(integer, integer) to authenticated;


-- ---------- CTA ----------

create or replace function public.admin_cta_sekcje(p_dni integer default 7, p_ekran text default null)
returns table (ekran text, sekcja text, wyswietlenia bigint, klikniecia bigint)
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout = '30s'
set work_mem = '64MB'
as $$
begin
  if not public.jest_adminem() then
    raise exception 'brak dostępu' using errcode = '42501';
  end if;
  return query select * from public.analityka_panel_cta_sekcje(now(), p_dni, p_ekran);
end;
$$;

comment on function public.admin_cta_sekcje(integer, text) is
  'CTA po sekcji ekranu: wyświetlenia (suma ekspozycji) i kliknięcia z kolumny cta wyjść. Mianownikiem klikalności są wyświetlenia przycisku. p_ekran = null: wszystkie ekrany.';

revoke all on function public.admin_cta_sekcje(integer, text) from public, anon;
grant execute on function public.admin_cta_sekcje(integer, text) to authenticated;

create or replace function public.admin_cta_martwe(p_dni integer default 7, p_min integer default 50)
returns table (ekran text, sekcja text, cel text, wyswietlenia bigint)
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout = '30s'
set work_mem = '64MB'
as $$
begin
  if not public.jest_adminem() then
    raise exception 'brak dostępu' using errcode = '42501';
  end if;
  return query select * from public.analityka_panel_cta_martwe(now(), p_dni, p_min);
end;
$$;

comment on function public.admin_cta_martwe(integer, integer) is
  'Martwe CTA: przyciski wyświetlone co najmniej p_min razy (domyślnie 50) i nigdy nieklikane w oknie.';

revoke all on function public.admin_cta_martwe(integer, integer) from public, anon;
grant execute on function public.admin_cta_martwe(integer, integer) to authenticated;

create or replace function public.admin_ux_sygnaly(p_dni integer default 7)
returns table (ekran text, rodzaj text, ile bigint, odslony_ekranu bigint)
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout = '30s'
set work_mem = '64MB'
as $$
begin
  if not public.jest_adminem() then
    raise exception 'brak dostępu' using errcode = '42501';
  end if;
  return query select * from public.analityka_panel_ux_sygnaly(now(), p_dni);
end;
$$;

comment on function public.admin_ux_sygnaly(integer) is
  'Sygnały frustracji z kliknięć (furia, martwy) na ekran, z odsłonami ekranu jako mianownikiem (klient liczy na 1000 odsłon).';

revoke all on function public.admin_ux_sygnaly(integer) from public, anon;
grant execute on function public.admin_ux_sygnaly(integer) to authenticated;


-- ---------- Treść ----------

create or replace function public.admin_top_ekrany(p_dni integer default 7)
returns table (ekran text, odslony bigint, unikalni bigint)
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout = '30s'
set work_mem = '64MB'
as $$
begin
  if not public.jest_adminem() then
    raise exception 'brak dostępu' using errcode = '42501';
  end if;
  return query select * from public.analityka_panel_top_ekrany(now(), p_dni);
end;
$$;

comment on function public.admin_top_ekrany(integer) is
  'Ekrany wg odsłon ludzi z unikalnymi w obrębie ekranu (nie sumować między wierszami).';

revoke all on function public.admin_top_ekrany(integer) from public, anon;
grant execute on function public.admin_top_ekrany(integer) to authenticated;

create or replace function public.admin_top_adresy(p_dni integer default 7, p_limit integer default 50)
returns table (sciezka text, odslony bigint, unikalni bigint)
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout = '30s'
set work_mem = '64MB'
as $$
begin
  if not public.jest_adminem() then
    raise exception 'brak dostępu' using errcode = '42501';
  end if;
  return query select * from public.analityka_panel_top_adresy(now(), p_dni, p_limit);
end;
$$;

comment on function public.admin_top_adresy(integer, integer) is
  'Karty adresów (ekran okolica) wg ścieżki serwisu bez hosta: odsłony i unikalni w obrębie wiersza. p_limit ≤ 200.';

revoke all on function public.admin_top_adresy(integer, integer) from public, anon;
grant execute on function public.admin_top_adresy(integer, integer) to authenticated;

create or replace function public.admin_bez_wyniku(p_dni integer default 30, p_limit integer default 100)
returns table (fraza text, ile bigint, ostatnio timestamptz)
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout = '30s'
set work_mem = '64MB'
as $$
begin
  if not public.jest_adminem() then
    raise exception 'brak dostępu' using errcode = '42501';
  end if;
  return query select * from public.analityka_panel_bez_wyniku(now(), p_dni, p_limit);
end;
$$;

comment on function public.admin_bez_wyniku(integer, integer) is
  'Wyszukiwania bez wyniku: fraza (małe litery), liczba i ostatnie wystąpienie. Frazy odrzucone przez klienta (dane osobowe) to osobna pozycja [odrzucono]. Okno do 30 dób, p_limit ≤ 200.';

revoke all on function public.admin_bez_wyniku(integer, integer) from public, anon;
grant execute on function public.admin_bez_wyniku(integer, integer) to authenticated;

create or replace function public.admin_lejek(p_dni integer default 7)
returns table (krok text, kolejnosc integer, sesje bigint)
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout = '30s'
set work_mem = '64MB'
as $$
begin
  if not public.jest_adminem() then
    raise exception 'brak dostępu' using errcode = '42501';
  end if;
  return query select * from public.analityka_panel_lejek(now(), p_dni);
end;
$$;

comment on function public.admin_lejek(integer) is
  'Lejek produktowy na sesjach: wyszukanie, karta_adresu, porownanie_dodaj, warstwa_mapy, tryb_biznes. Kroki niezależne (sesja liczy się do kroku, gdy ma jego zdarzenie), zawsze pięć wierszy.';

revoke all on function public.admin_lejek(integer) from public, anon;
grant execute on function public.admin_lejek(integer) to authenticated;


-- ---------- Jakość ----------

create or replace function public.admin_diagnostyka()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout = '30s'
set work_mem = '64MB'
as $$
begin
  if not public.jest_adminem() then
    raise exception 'brak dostępu' using errcode = '42501';
  end if;
  return public.analityka_panel_diagnostyka(now());
end;
$$;

comment on function public.admin_diagnostyka() is
  'Czy pomiar działa: ostatnie zdarzenie, zdarzenia z 24 h wg wszystkich siedmiu typów (także zera), zdarzenia bez odcisku, ostatni bieg zestawienia (najnowszy wiersz z błędem z ostatnich 26 h, a bez błędu – najnowszy wiersz), liczba dób w zestawieniu, najstarsze zdarzenie. Tylko ruch ludzi.';

revoke all on function public.admin_diagnostyka() from public, anon;
grant execute on function public.admin_diagnostyka() to authenticated;

create or replace function public.admin_witale(p_dni integer default 7)
returns table (ekran text, metryka text, p75 numeric, probki bigint)
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout = '30s'
set work_mem = '64MB'
as $$
begin
  if not public.jest_adminem() then
    raise exception 'brak dostępu' using errcode = '42501';
  end if;
  return query select * from public.analityka_panel_witale(now(), p_dni);
end;
$$;

comment on function public.admin_witale(integer) is
  'Web Vitals: p75 (ms; CLS jako ułamek) na ekran i metrykę, probki = liczba pomiarów (nie osób). Okno do 30 dób.';

revoke all on function public.admin_witale(integer) from public, anon;
grant execute on function public.admin_witale(integer) to authenticated;

create or replace function public.admin_bledy(p_dni integer default 7, p_limit integer default 50)
returns table (komunikat text, ekran text, ile bigint, ostatnio timestamptz)
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout = '30s'
set work_mem = '64MB'
as $$
begin
  if not public.jest_adminem() then
    raise exception 'brak dostępu' using errcode = '42501';
  end if;
  return query select * from public.analityka_panel_bledy(now(), p_dni, p_limit);
end;
$$;

comment on function public.admin_bledy(integer, integer) is
  'Błędy klienta zgrupowane po (komunikat, ekran): liczba i ostatnie wystąpienie. p_limit ≤ 200.';

revoke all on function public.admin_bledy(integer, integer) from public, anon;
grant execute on function public.admin_bledy(integer, integer) to authenticated;
