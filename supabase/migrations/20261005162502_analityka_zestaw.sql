-- 20261005162502_analityka_zestaw.sql
-- Nazwa nadana przez: wt.ps1 migracja (timestamp, nie numer sekwencyjny).
-- Dzieki temu rownolegle worktree nie moga wziac tej samej nazwy i nikt nie czeka na lock.
-- Po merge do main aplikuj z glownego repo:  supabase db push --include-all
--   (--include-all jest potrzebne, gdy migracja o wczesniejszym timestampie trafila na main
--    pozniej niz nowsza - CLI inaczej uzna ja za starsza od ostatnio zastosowanej i pominie.)

-- =====================================================================
-- adresscore – analityka (faza 7): ZESTAWIENIE DZIENNE, RETENCJA I HARMONOGRAM
--
-- Dopina to, co fundament zostawił pustym (analityka_dzienna, analityka_biegi) i czego nikt
-- nie sprząta (zdarzenia, analityka_sol):
--   1. analityka_zestaw_dzien(date) – zestawienie jednej doby do analityka_dzienna,
--   2. analityka_sprzataj()         – retencja: zdarzenia 90 dni, sól 2 doby,
--   3. analityka_cron()             – bieg nocny: sprzątanie + zestawienie przedwczoraj i wczoraj,
--                                     ślad każdego kroku w analityka_biegi,
--   4. zadanie pg_cron 'analityka-dzienna' o 01:20 UTC.
--
-- Zależy WYŁĄCZNIE od fundamentu (zdarzenia, analityka_sesje, analityka_dzienna, analityka_biegi,
-- analityka_sol). Nie zna żadnej admin_* – RPC panelu (faza 6) idą niezależnie i w dowolnej
-- kolejności względem tego pliku.
--
-- ZASADY WSPÓLNE
--   * Doba to doba warszawska: przedział [p_dzien 00:00, p_dzien+1 00:00) liczony w Europe/Warsaw
--     jako timestamptz. Dzięki temu doba przy zmianie czasu ma 23 albo 25 godzin i żadna godzina
--     nie wypada ani nie liczy się dwa razy (doba „24 h od północy UTC” by się tu pomyliła).
--   * Funkcje security definer, search_path = '' i w pełni kwalifikowane nazwy – jak w fundamencie.
--   * ŻADNEGO EXECUTE dla ról klienckich: ani PUBLIC, ani anon, ani authenticated, ani
--     service_role (domyślne uprawnienia Supabase dają je każdej z tych ról, więc REVOKE jest
--     jawny). Funkcje woła pg_cron jako właściciel i ręcznie admin z SQL Editora (też jako
--     właściciel). Endpoint zapisu działa kluczem service_role, ale potrzebuje tylko
--     zdarzenie_zapisz() i analityka_sol_dzis() – reszty nie.
--   * Zmiana schematu zdalnej bazy wyłącznie przez ten plik.
--
-- DECYZJE WYKONAWCZE (doprecyzowania względem data-model.md; kontrakty rpc.md mają pierwszeństwo)
--   * odslony    = odsłony LUDZI (czy_bot = false), także te bez odcisku: to liczba wyświetleń.
--     unikalni   = różne odciski ludzi (czy_bot = false, odcisk not null) wśród WSZYSTKICH zdarzeń
--                  doby – dokładnie jak w rpc.md (Uzupełnienia) i w żywej serii dziennej fazy 6,
--                  żeby „dziś” (liczone na żywo) i „wczoraj” (z zestawienia) miały tę samą definicję
--                  na szwie. Cena: odcisk, który w tej dobie wysłał tylko wyjście albo pomiar (karta
--                  otwarta przed północą, nowa sól), też jest „unikalnym”; sesji mu to nie dodaje
--                  (sesja wymaga odsłony), więc unikalni może przewyższyć sesje o takie przypadki.
--     sesje      = sesje z analityka_sesje, których POCZĄTEK wypada w tej dobie.
--     kanal / kraj / urzadzenie = wizyty (sesje) wg PIERWSZEJ odsłony sesji; razem dają sesje.
--   * Doba bez ŻADNEGO zdarzenia nie dostaje żadnych wierszy (nawet ruch = 0). Kontrakt panelu:
--     „dni bez wiersza uzupełnia klient; przed pierwszym dniem danych = brak danych, nie zero”.
--     Wiersz z zerem dla doby sprzed startu pomiaru (pierwszy bieg liczy też przedwczoraj)
--     udawałby pomiar, którego nie było. Doba z samym ruchem botów dostaje komplet kluczy ruch.
--   * Przeliczenie doby spoza retencji (starszej niż 90 dni) jest odrzucane, bo surowych
--     zdarzeń już nie ma lub są niepełne, a „delete + insert” zastąpiłby zachowane zestawienie
--     pustką albo ułamkiem. Zestawienia mają przeżyć zdarzenia – po to ta tabela istnieje.
--   * Zdarzenia produktowe, wital i frazy bez wyniku: tylko ludzie (boty nie wchodzą do lejka
--     ani do Web Vitals). Fraza jest normalizowana jeszcze raz (małe litery, bez spacji na
--     brzegach, <= 80 znaków). Znacznik odrzucenia (fraza z danymi osobowymi) ZOSTAJE jedną
--     pozycją '[odrzucono]' – tak robi żywa lista fazy 6 (analityka_panel_bez_wyniku), więc
--     historia i „dziś” zgadzają się co do składu; archiwum nie traci przy tym liczby odrzuceń.
--   * Rotacja soli to nie zadanie crona: nową sól tworzy analityka_sol_dzis() przy pierwszym
--     zdarzeniu doby, a tu kasujemy stare.
--
-- RĘCZNIE (SQL Editor działa jako postgres – właściciel funkcji, czyli jedyna rola z EXECUTE; tak
-- samo biegnie zadanie pg_cron):
--   select public.analityka_zestaw_dzien(date '2026-10-05');      -- przeliczenie jednej doby
--   select public.analityka_cron();                               -- cały bieg nocny
--   select * from public.analityka_biegi order by start desc limit 10;  -- ślad biegów
-- Przeliczenie doby BIEŻĄCEJ daje wynik częściowy (do chwili wywołania); nocny bieg poprawi go,
-- gdy doba się zamknie.
-- =====================================================================


-- ---------- 1. Zestawienie jednej doby ----------

-- Idempotentne: „delete doby + insert wszystkich wymiarów” w jednej transakcji funkcji. Powtórka
-- daje te same wiersze, nigdy dubla, a błąd w trakcie cofa też delete (stare zestawienie zostaje).
--
-- JEDNO POLECENIE LICZĄCE, nie dziewięć: wszystkie wymiary powstają z jednego WITH, więc widzą
-- ten sam stan tabeli (jedna migawka). Przy dobie już zamkniętej to niczego nie zmienia, ale
-- ręczne przeliczenie TRWAJĄCEJ doby nie rozjedzie np. sumy ekranów z liczbą odsłon o wiersze,
-- które wpadły między dwoma zapytaniami.
--
-- Wymiary i klucze (data-model.md):
--   ruch        odslony, unikalni, odslony_boty, sesje, sesje_zaangazowane
--   ekran       klucz = ekran, wartosc = odsłony ludzi
--   kanal       wizyty wg kanału pierwszej odsłony sesji; 'wewnetrzne' i brak kanału liczą się
--               jako 'bezposrednie' (jak w żywych wizytach fazy 6: sesja zaczęta z własnego
--               referera, np. powrót do karty po przerwie, nie ma zewnętrznego źródła)
--   kraj        wizyty wg kraju pierwszej odsłony sesji ('(nieznany)' gdy brak)
--   urzadzenie  wizyty wg urządzenia pierwszej odsłony sesji
--   bot_ai      klucz = rodzina bota ('(nieznana)' gdy brak), wartosc = odsłony botów klasy ai
--   produktowe  klucz = nazwa zdarzenia, wartosc = liczba zdarzeń
--   bez_wyniku  klucz = fraza wyszukiwania bez wyniku, top 100 wg liczby
--   witale      klucz = 'ekran§metryka', wartosc = liczba próbek, wartosc2 = p75 (3 miejsca)
--
-- SESJA ZAANGAŻOWANA (data-model.md): >= 2 odsłony albo suma czas_ms >= 30 000 (próg włącznie).
--
-- KRAJ nie wychodzi z analityka_sesje (zwraca kanał i urządzenie, kraju nie), więc dołączamy
-- go z samego zdarzenia pierwszej odsłony. Dopasowanie po (odcisk, czas, ekran, ścieżka) może
-- trafić w kilka wierszy, bo paczka ma jeden czas wstawienia (kilka odsłon o tym samym czasie,
-- a przy dublu nawet identycznych) – DISTINCT ON z porządkiem po id bierze jedną, najwcześniejszą,
-- i nie mnoży sesji.
--
-- LIMITY CZASU. Zgodnie z kontraktem (rpc.md) funkcja deklaruje statement_timeout = 120 s, ale to
-- ustawienie NIE działa na wywołujące ją polecenie: sprawdzone na PostgreSQL 17 – licznik limitu
-- jest uzbrajany przy starcie polecenia najwyższego poziomu, więc klauzula SET na funkcji ani nie
-- skraca, ani nie wydłuża limitu sesji (z-dykty 0042 zakładało inaczej). Zostaje jako deklaracja
-- zamiaru zgodna z kontraktem. Realną ochronę przed zawieszeniem daje lock_timeout – ten jest
-- sprawdzany przy KAŻDYM oczekiwaniu na blokadę, więc działa także z poziomu funkcji (sprawdzone):
-- przeliczenie z blokującą transakcją obok kończy się błędem po 30 s zamiast wisieć.
--
-- plan_cache_mode = force_custom_plan: granice doby są parametrami zapytania, a plan generyczny
-- ich nie zna (mógłby wybrać skan całej tabeli zdarzeń); tak samo w funkcjach panelu fazy 6.
create or replace function public.analityka_zestaw_dzien(p_dzien date)
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '120s'
set lock_timeout = '30s'
set plan_cache_mode = force_custom_plan
as $$
declare
  -- Ta sama retencja co w analityka_sprzataj(); zmieniać parą.
  c_retencja constant interval := interval '90 days';
  v_start timestamptz := clock_timestamp();
  v_od timestamptz;
  v_do timestamptz;
  v_zastapiono bigint;
  v_wymiary jsonb;
  v_wierszy bigint;
begin
  if p_dzien is null then
    raise exception 'analityka_zestaw_dzien: podaj dobę (p_dzien)' using errcode = '22004';
  end if;

  v_od := p_dzien::timestamp at time zone 'Europe/Warsaw';
  v_do := (p_dzien + 1)::timestamp at time zone 'Europe/Warsaw';

  -- Strażnik retencji (patrz „Decyzje wykonawcze”). Bieg nocny liczy tylko wczoraj i przedwczoraj,
  -- więc tu trafia wyłącznie ręczne wywołanie z datą z głębokiej przeszłości.
  if v_od < now() - c_retencja then
    raise exception 'analityka_zestaw_dzien: doba % wypada poza retencją surowych zdarzeń (90 dni) – przeliczenie zastąpiłoby zachowane zestawienie niepełnymi danymi', p_dzien
      using errcode = '22023';
  end if;

  -- Dwa równoległe przeliczenia tej samej doby (np. ręczne w trakcie nocnego) rozminęłyby się na
  -- kluczu głównym: drugie delete nie widzi wierszy wstawionych przez pierwsze. Blokada doradcza
  -- ustawia je w kolejkę (drugie czeka do końca pierwszego i dopiero wtedy liczy).
  perform pg_advisory_xact_lock(hashtext('adresscore.analityka_zestaw_dzien'), p_dzien - date '2000-01-01');

  delete from public.analityka_dzienna d
   where d.dzien = p_dzien;
  get diagnostics v_zastapiono = row_count;

  with
  -- Wszystkie zdarzenia doby. Zakres po czasie (indeks zdarzenia_czas_idx), a nie po
  -- „(czas at time zone …)::date”, żeby doba 23- i 25-godzinna wyszła sama z granic przedziału.
  zd as materialized (
    select z.id, z.czas, z.typ, z.ekran, z.sciezka, z.odcisk, z.kraj, z.czy_bot,
           z.bot_rodzina, z.bot_klasa, z.nazwa, z.wlasciwosci, z.wartosc
      from public.zdarzenia z
     where z.czas >= v_od
       and z.czas < v_do
  ),
  -- Odsłony sesji, które ZACZĘŁY się w tej dobie. analityka_sesje nie ma górnej granicy okna,
  -- więc oddaje też sesje z kolejnych dób – odsiewamy je po `dzien`. Okno zaczynamy o północy
  -- warszawskiej, jak zaleca komentarz fundamentu (sesja nie przekracza północy, więc żadna nie
  -- zostanie ucięta).
  sesje as materialized (
    select s.sesja, s.czas, s.ekran, s.sciezka, s.poz, s.czas_ms, s.kanal, s.urzadzenie
      from public.analityka_sesje(v_od) s
     where s.dzien = p_dzien
  ),
  sesje_suma as (
    select s.sesja,
           count(*) as odslon,
           coalesce(sum(s.czas_ms), 0) as czas_ms
      from sesje s
     group by s.sesja
  ),
  -- Pierwsza odsłona każdej sesji (poz = 1): kanał i urządzenie z analityka_sesje, kraj ze zdarzenia.
  -- Odcisk to część klucza sesji przed numerem („odcisk-nr”, odcisk to 16 znaków hex bez myślnika).
  sesje_start as (
    select distinct on (s.sesja)
           s.sesja, s.kanal, s.urzadzenie, z.kraj
      from sesje s
      left join zd z
        on z.typ = 'odslona'
       and not z.czy_bot
       and z.odcisk = split_part(s.sesja, '-', 1)
       and z.czas = s.czas
       and z.ekran = s.ekran
       and z.sciezka = s.sciezka
     where s.poz = 1
     order by s.sesja, z.id
  ),
  wiersze as (
    -- ruch: jeden wiersz agregatów rozwijany do pięciu kluczy; pomijany, gdy doba nie ma zdarzeń
    select 'ruch'::text as wymiar,
           r.klucz::text as klucz,
           r.wartosc::bigint as wartosc,
           null::numeric as wartosc2
      from (
        select count(*) filter (where z.typ = 'odslona' and not z.czy_bot) as odslony,
               count(distinct z.odcisk) filter (where not z.czy_bot and z.odcisk is not null) as unikalni,
               count(*) filter (where z.typ = 'odslona' and z.czy_bot) as odslony_boty
          from zd z
      ) a
     cross join lateral (values
        ('odslony', a.odslony),
        ('unikalni', a.unikalni),
        ('odslony_boty', a.odslony_boty),
        ('sesje', (select count(*) from sesje_suma)),
        ('sesje_zaangazowane',
           (select count(*) from sesje_suma ss where ss.odslon >= 2 or ss.czas_ms >= 30000))
     ) as r(klucz, wartosc)
     where exists (select 1 from zd)

    union all

    select 'ekran', z.ekran, count(*), null::numeric
      from zd z
     where z.typ = 'odslona' and not z.czy_bot
     group by z.ekran

    union all

    select 'kanal', coalesce(nullif(s.kanal, 'wewnetrzne'), 'bezposrednie'), count(*), null::numeric
      from sesje_start s
     group by coalesce(nullif(s.kanal, 'wewnetrzne'), 'bezposrednie')

    union all

    select 'kraj', coalesce(s.kraj, '(nieznany)'), count(*), null::numeric
      from sesje_start s
     group by coalesce(s.kraj, '(nieznany)')

    union all

    select 'urzadzenie', s.urzadzenie, count(*), null::numeric
      from sesje_start s
     group by s.urzadzenie

    union all

    select 'bot_ai', coalesce(z.bot_rodzina, '(nieznana)'), count(*), null::numeric
      from zd z
     where z.typ = 'odslona' and z.czy_bot and z.bot_klasa = 'ai'
     group by coalesce(z.bot_rodzina, '(nieznana)')

    union all

    select 'produktowe', z.nazwa, count(*), null::numeric
      from zd z
     where z.typ = 'produktowe' and not z.czy_bot
     group by z.nazwa

    union all

    -- Top 100 fraz. Znacznik odrzucenia (fraza z danymi osobowymi: { "odrzucono": true } albo
    -- literalne „[odrzucono]”) zostaje JEDNĄ pozycją '[odrzucono]', tak jak w żywej liście fazy 6
    -- (analityka_panel_bez_wyniku): zliczenie odrzuconych szukań jest informacją, a po wygaśnięciu
    -- surowych zdarzeń nie dałoby się go odtworzyć; konsument, który go nie chce, odfiltruje klucz.
    -- Pusta fraza odpada. Remis rozstrzyga alfabet w kolejności bajtowej (collate "C"), żeby
    -- odcięcie listy nie zależało od ustawień regionalnych bazy.
    select 'bez_wyniku', f.fraza, f.ile, null::numeric
      from (
        select n.fraza, count(*) as ile
          from (
            select case
                     when z.wlasciwosci ->> 'odrzucono' = 'true'
                       or z.wlasciwosci ->> 'fraza' = '[odrzucono]'
                       then '[odrzucono]'
                     else nullif(left(lower(btrim(z.wlasciwosci ->> 'fraza')), 80), '')
                   end as fraza
              from zd z
             where z.typ = 'produktowe'
               and z.nazwa = 'wyszukanie_bez_wyniku'
               and not z.czy_bot
          ) n
         where n.fraza is not null
         group by n.fraza
         order by count(*) desc, n.fraza collate "C"
         limit 100
      ) f

    union all

    -- Web Vitals: wartosc = liczba próbek (mianownik – bez niego p75 z trzech pomiarów wygląda
    -- tak samo jak z trzech tysięcy), wartosc2 = p75 metryki (ms; CLS jako ułamek), zaokrąglone do
    -- 3 miejsc jak w żywym admin_witale fazy 6 – historia i dziś pokazują tę samą liczbę.
    -- percentile_cont liczy na liczbach zmiennoprzecinkowych, więc zaokrąglenie usuwa też szum
    -- zapisu dziesiętnego (0,15000000000000002 -> 0,150).
    select 'witale', z.ekran || '§' || z.nazwa, count(*),
           round((percentile_cont(0.75) within group (order by z.wartosc))::numeric, 3)
      from zd z
     where z.typ = 'wital' and not z.czy_bot and z.wartosc is not null
     group by z.ekran, z.nazwa
  ),
  ins as (
    insert into public.analityka_dzienna (dzien, wymiar, klucz, wartosc, wartosc2)
    select p_dzien, w.wymiar, w.klucz, w.wartosc, w.wartosc2
      from wiersze w
    returning wymiar
  )
  select coalesce(jsonb_object_agg(t.wymiar, t.n), '{}'::jsonb),
         coalesce(sum(t.n), 0)::bigint
    into v_wymiary, v_wierszy
    from (select i.wymiar, count(*) as n from ins i group by i.wymiar) t;

  return jsonb_build_object(
    'dzien', p_dzien,
    'wierszy', v_wierszy,
    'wymiary', v_wymiary,
    'zastapiono', v_zastapiono,
    'czas_ms', (extract(epoch from clock_timestamp() - v_start) * 1000)::bigint
  );
end;
$$;

comment on function public.analityka_zestaw_dzien(date) is
  'Zestawienie doby warszawskiej do analityka_dzienna: delete + insert wszystkich wymiarów (idempotentne). Zwraca jsonb: dzien, wierszy, wymiary (liczba wierszy na wymiar), zastapiono, czas_ms. Doba spoza retencji 90 dni jest odrzucana. Brak EXECUTE dla ról klienckich – woła pg_cron i admin z SQL Editora.';

revoke all on function public.analityka_zestaw_dzien(date) from public, anon, authenticated, service_role;


-- ---------- 2. Retencja ----------

-- Zdarzenia: kasujemy starsze niż 90 dni (czas < now() - 90 dni, granica ostra). Sól dnia: kasujemy
-- sole z dób starszych niż wczorajsza, czyli zostają wczorajsza i dzisiejsza – sól żyje najwyżej
-- dwie doby, a po jej skasowaniu odcisk jest nieodwracalny (na tym stoi pomiar bez zgody).
-- Zestawienia (analityka_dzienna) i ślad biegów (analityka_biegi) NIE są ruszane.
--
-- BEZ PORCJOWANIA. Jedna doba retencji to dziesiątki tysięcy wierszy, czyli sekundy; nocny bieg
-- nigdy nie zbiera zaległości. Zaległość po wielodniowej awarii crona też zniknie jednym delete.
-- Dzielenie na porcje dałoby tu tylko kod, którego nic nie wymusza; gdyby zdarzeń przybywało o
-- rząd wielkości, pierwszy kandydat to limit wierszy na bieg (najstarsze najpierw).
--
-- Granica 90 dni jest policzona w strefie sesji (interval '90 days' to dni kalendarzowe); na
-- Supabase to UTC, więc dokładnie 90 × 24 h. Przy innej strefie granica może przesunąć się o
-- godzinę, co dla retencji nie ma znaczenia.
create or replace function public.analityka_sprzataj()
returns jsonb
language plpgsql
security definer
set search_path = ''
set lock_timeout = '30s'
set plan_cache_mode = force_custom_plan
as $$
declare
  -- Ta sama retencja co w analityka_zestaw_dzien() (strażnik); zmieniać parą.
  c_retencja constant interval := interval '90 days';
  v_granica timestamptz := now() - c_retencja;
  v_granica_soli date := (now() at time zone 'Europe/Warsaw')::date - 1;
  v_zdarzenia bigint;
  v_sol bigint;
begin
  delete from public.zdarzenia z
   where z.czas < v_granica;
  get diagnostics v_zdarzenia = row_count;

  delete from public.analityka_sol s
   where s.dzien < v_granica_soli;
  get diagnostics v_sol = row_count;

  return jsonb_build_object(
    'zdarzenia_usunieto', v_zdarzenia,
    'sol_usunieto', v_sol,
    'granica_zdarzen', v_granica,
    'granica_soli', v_granica_soli
  );
end;
$$;

comment on function public.analityka_sprzataj() is
  'Retencja analityki: kasuje zdarzenia starsze niż 90 dni i sole dób starszych niż wczorajsza. Nie rusza analityka_dzienna ani analityka_biegi. Zwraca jsonb z liczbami usuniętych wierszy. Brak EXECUTE dla ról klienckich.';

revoke all on function public.analityka_sprzataj() from public, anon, authenticated, service_role;


-- ---------- 3. Bieg nocny ----------

-- Trzy kroki, każdy osobno: sprzątanie, zestawienie PRZEDWCZORAJ, zestawienie WCZORAJ. Każdy krok
-- ma własny wpis w analityka_biegi (start, koniec, wynik albo błąd) i własny blok z wyjątkiem:
-- błąd jednego kroku cofa tylko ten krok (podtransakcja – zestawienie z poprzedniego biegu
-- zostaje nietknięte), zapisuje się w kolumnie `blad`, a bieg idzie dalej i NIE przekazuje
-- wyjątku do crona. Ślad bez tego znikałby razem z całą transakcją crona.
--
-- Łapiemy też query_canceled (limit czasu polecenia, ręczne anulowanie): „when others” go nie
-- obejmuje, a przekroczenie czasu to najbardziej prawdopodobna awaria przy rosnących danych.
--
-- KOLEJNOŚĆ. Zestawienie wczoraj idzie OSTATNIE, bo diagnostyka (admin_diagnostyka.ostatni_bieg)
-- czyta najnowszy wiersz, a ma pokazywać stan zestawienia dziennego (FR-036), nie sprzątania.
-- Gdyby sprzątanie szło ostatnie, zepsute zestawienie przy działającym sprzątaniu świeciłoby
-- na zielono. Kroki są niezależne (retencja dotyczy zdarzeń sprzed 90 dni, zestawienie dób
-- sprzed 1–2 dni), więc kolejność nie zmienia wyniku. Odwrotne ryzyko – nieudane sprzątanie
-- przykryte udanym zestawieniem – zostaje widoczne w kolumnie `blad` swojego wiersza; panel
-- pokazuje tylko najnowszy wiersz, więc do wiersza sprzątania trzeba zajrzeć w tabeli.
--
-- DLACZEGO DWIE DOBY. Doba po zamknięciu jest kompletna już o 01:20 UTC (czas zdarzenia nadaje
-- baza przy zapisie, więc spóźniony beacon trafia do doby swojego DOTARCIA, nie zdarzenia).
-- Przedwczorajsza doba jest powtórką z innego powodu: samonaprawa. Gdy wczorajszy bieg nie wyszedł
-- (awaria bazy, błąd, wyłączony cron), następna noc nadrabia to bez ręki człowieka; bieg jest
-- idempotentny, więc powtórka niczego nie psuje.
--
-- „WCZORAJ” to doba warszawska względem now() w chwili biegu. 01:20 UTC to 02:20 (zima) albo 03:20
-- (lato) czasu warszawskiego, czyli w obu porach roku PO północy – wczoraj jest już zamknięte.
create or replace function public.analityka_cron()
returns void
language plpgsql
security definer
set search_path = ''
set lock_timeout = '30s'
as $$
declare
  v_dzis date := (now() at time zone 'Europe/Warsaw')::date;
  v_krok record;
  v_id bigint;
  v_start timestamptz;
  v_wynik jsonb;
begin
  for v_krok in
    select k.nr, k.rodzaj, k.dzien
      from (values (1, 'sprzatanie', null::date),
                   (2, 'zestaw', v_dzis - 2),
                   (3, 'zestaw', v_dzis - 1)) as k(nr, rodzaj, dzien)
     order by k.nr
  loop
    -- clock_timestamp(), nie now(): now() to początek transakcji crona i wszystkie trzy kroki
    -- miałyby ten sam start.
    v_start := clock_timestamp();
    insert into public.analityka_biegi (rodzaj, start)
    values (v_krok.rodzaj, v_start)
    returning id into v_id;

    begin
      if v_krok.rodzaj = 'zestaw' then
        v_wynik := public.analityka_zestaw_dzien(v_krok.dzien);
      else
        v_wynik := public.analityka_sprzataj();
      end if;

      -- greatest(): check tabeli wymaga koniec >= start, a zegar ścienny potrafi się cofnąć.
      update public.analityka_biegi b
         set koniec = greatest(clock_timestamp(), v_start),
             wynik = v_wynik
       where b.id = v_id;
    exception
      when others or query_canceled then
        update public.analityka_biegi b
           set koniec = greatest(clock_timestamp(), v_start),
               blad = left(sqlstate || ': ' || sqlerrm, 500),
               wynik = jsonb_strip_nulls(jsonb_build_object('dzien', v_krok.dzien, 'sqlstate', sqlstate))
         where b.id = v_id;
    end;
  end loop;
end;
$$;

comment on function public.analityka_cron() is
  'Bieg nocny analityki: sprzątanie, zestawienie przedwczoraj i wczoraj (doby warszawskie). Każdy krok ma wpis w analityka_biegi; błąd kroku trafia do kolumny blad i nie przerywa kolejnych kroków ani crona. Brak EXECUTE dla ról klienckich.';

revoke all on function public.analityka_cron() from public, anon, authenticated, service_role;


-- ---------- 4. Harmonogram (pg_cron) ----------

-- Rozszerzenie można utworzyć tylko w bazie wskazanej w cron.database_name (na Supabase to
-- `postgres`, lokalnie tak samo) – migracja na innej bazie wywróci się TUTAJ, głośno. Cichy skip
-- zostawiłby produkcję bez zestawień i bez sprzątania soli, a dowiedzielibyśmy się o tym dopiero
-- z czerwonego wskaźnika w panelu Jakość.
create extension if not exists pg_cron with schema pg_catalog;

-- 01:20 UTC = po północy warszawskiej w obu porach roku (02:20 zimą, 03:20 latem). pg_cron liczy
-- w UTC, więc godzina w harmonogramie nie przesuwa się ze zmianą czasu – a funkcja i tak wylicza
-- „wczoraj” sama, w Europe/Warsaw. Zadanie biegnie w tej bazie, jako rola uruchamiająca migrację
-- (postgres), czyli właściciel funkcji.
--
-- Idempotencja: nazwane zadanie odpinamy, zanim je zapiszemy ponownie, żeby powtórne uruchomienie
-- migracji (db reset, naprawa ręczna) nie zostawiło dwóch zadań ani starego harmonogramu.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'analityka-dzienna') then
    perform cron.unschedule('analityka-dzienna');
  end if;

  perform cron.schedule('analityka-dzienna', '20 1 * * *', 'select public.analityka_cron()');
end;
$$;
