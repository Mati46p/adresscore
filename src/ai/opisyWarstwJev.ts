// Opisy warstw dla JEV (#163) – jedno miejsce, z którego „zapytaj o adres” buduje opcje wyboru.
//
// Opis z danych (`meta.opis`) jest dla czytelnika metody: technika, źródło, zastrzeżenia
// („…legendy mapy średnich warunków anemologicznych Atlasu MONIT-AIR…”). JEV dostaje zamiast
// niego zwykłe zdanie: co warstwa znaczy dla mieszkańca i na jakie codzienne pytania odpowiada.
// Bez skrótów (albo skrót z rozwinięciem obok), bez żargonu („oczko siatki”, „H3”), jednostki
// słowami. `public/dane` się nie zmienia.
//
// `nie_dla` i `przyklady` mają TYLKO opcje, które JEV mylił w zapisanych przebiegach (powódź,
// rodzina powietrza, hałas a komunikacja, cena a „nie wiem”). Pozostałe – samo `co`.
// #176: po #171 powódź to jedna warstwa (`powodz_10proc`), a hałas i pozwolenia na budowę
// obejmują Kraków i gminy wokół w jednej warstwie.
// Dopiski z #147 (park, skwer, smog, „słychać tramwaje”…) są wplecione w zdania.
//
// Nowa warstwa bez wpisu tu dostaje w aplikacji opis z danych (`listaWarstw`), ale test
// `opisyWarstwJev.test.ts` się wywraca – opis trzeba dopisać.
import type { OpisStrukturalny } from './jev.ts'

/** Najwyżej tyle znaków ma każde pole opisu (limit pośrednika, `api/_jev.js`). */
export const MAKS_POLA = 300

const M = 'Odległość w metrach (w linii prostej) do najbliższ'
const SEJM = (komitet: string) =>
  `Jaki procent głosów w gminie dostał w wyborach do Sejmu w 2023 roku ${komitet} (wynik całej gminy, nie okolicy). Odpowiada na pytania, jak głosowano tu w wyborach parlamentarnych.`

export const OPISY_WARSTW_DLA_JEV: Readonly<Record<string, OpisStrukturalny>> = {
  akademik_odleglosc: {
    co: `${M}ego akademika, czyli domu studenckiego. Odpowiada na pytania studentów, czy blisko jest akademik.`,
  },
  apteka_odleglosc: {
    co: `${M}ej apteki. Odpowiada na pytania o aptekę, leki i wykupienie recepty.`,
  },
  azbest_budynki_100m: {
    co: 'Liczba budynków z azbestem (np. stary eternit na dachu) w promieniu 100 metrów, według rządowej Bazy Azbestowej. Odpowiada na pytania, czy w okolicy jest azbest.',
  },
  bap_srednia: {
    co: 'Średnie roczne stężenie benzo(a)pirenu – rakotwórczego składnika dymu z pieców, gdzie pali się węglem albo drewnem. Odpowiada na pytania o dym z kominów, palenie w piecach i zapach dymu zimą.',
    nie_dla:
      'Ogólne pytanie o smog i jakość powietrza (to pył zawieszony PM2,5) i pytanie, ile domów w okolicy ma piece (to paleniska).',
    przyklady: ['Czuć tu zimą dym z kominów?'],
  },
  biblioteka_1200m: {
    co: 'Czy w promieniu 1,2 kilometra (w linii prostej) jest biblioteka zaznaczona na otwartej mapie OpenStreetMap – tak albo nie. Odpowiada na pytania, czy blisko jest biblioteka i gdzie wypożyczyć książki.',
  },
  bo_projekty_1km: {
    co: 'Liczba zakończonych projektów budżetu obywatelskiego Krakowa (pomysłów mieszkańców sfinansowanych przez miasto) w promieniu 1 kilometra. Odpowiada na pytania, co mieszkańcy tu zbudowali i ulepszyli.',
  },
  bus_mld_kursy_szczyt_h: {
    co: 'Ile razy na godzinę w porannym szczycie (7–9) odjeżdżają busy Małopolskich Linii Dowozowych (autobusy Kolei Małopolskich) z ich najbliższego przystanku. Odpowiada na pytania, jak często jeździ bus do Krakowa albo do pociągu.',
  },
  bus_mld_odleglosc: {
    co: `${M}ego przystanku busów Małopolskich Linii Dowozowych (autobusy Kolei Małopolskich, głównie w gminach wokół Krakowa). Odpowiada na pytania o bus podmiejski i dojazd z gminy do Krakowa.`,
  },
  cas_odleglosc: {
    co: `${M}ego Centrum Aktywności Seniora – miejskiego klubu z zajęciami dla starszych osób w Krakowie. Odpowiada na pytania, co tu jest dla seniora i gdzie są zajęcia dla emerytów.`,
  },
  cena_m2_mediana: {
    co: 'Typowa (mediana) cena metra kwadratowego mieszkania w okolicy, z aktów notarialnych z ostatnich dwóch lat, tylko Kraków. Odpowiada na pytania, ile kosztuje tu mieszkanie, czy jest drogo i czy opłaca się kupić.',
    przyklady: ['Ile kosztuje tu metr mieszkania?', 'Opłaca się tu kupić mieszkanie?'],
  },
  defibrylator_odleglosc: {
    co: `${M}ego ogólnodostępnego defibrylatora AED (automatycznego urządzenia do ratowania osoby z zatrzymaniem serca). Odpowiada na pytania o defibrylator i pierwszą pomoc.`,
  },
  dojazd_utwardzony: {
    co: 'Czy najbliższa ulica albo droga dojazdowa ma utwardzoną nawierzchnię (asfalt, kostka, beton), czy jest gruntowa. Odpowiada na pytania, czy dojazd do domu jest asfaltowy, czy błotnisty po deszczu.',
  },
  droga_rowerowa_odleglosc: {
    co: `${M}ej głównej trasy rowerowej metropolii (np. Wiślana Trasa Rowerowa, trasy Velo). Odpowiada na pytania o dłuższe wycieczki i dojazdy rowerem główną trasą.`,
  },
  drogi_gruntowe_300m: {
    co: 'Jaki procent dróg w promieniu 300 metrów to drogi gruntowe (polne, nieutwardzone). Odpowiada na pytania, czy w okolicy są drogi szutrowe i polne, czy wszystko jest wyasfaltowane.',
  },
  drzewa_100m: {
    co: 'Liczba drzew miejskich w promieniu 100 metrów (ewidencja Zarządu Zieleni Miejskiej w Krakowie). Odpowiada na pytania o drzewa przy ulicy i pod oknem, cień i aleje.',
  },
  emitent_odleglosc: {
    co: `${M}ego zakładu z krajowego rejestru zanieczyszczeń (elektrociepłownia, fabryka, spalarnia, oczyszczalnia ścieków, duża ferma). Odpowiada na pytania, czy blisko jest fabryka albo komin przemysłowy.`,
  },
  frekwencja_samorzad_2024: {
    co: 'Jaki procent mieszkańców gminy głosował w wyborach samorządowych w 2024 roku (wynik całej gminy, nie okolicy). Odpowiada na pytania o frekwencję i udział mieszkańców w wyborach.',
  },
  gastronomia_1200m: {
    co: 'Czy w promieniu 1,2 kilometra (w linii prostej) jest restauracja, kawiarnia albo bar szybkiej obsługi zaznaczony na otwartej mapie OpenStreetMap – tak albo nie. Odpowiada na pytania, czy pieszo da się wyjść coś zjeść na mieście.',
  },
  gastronomia_odleglosc: {
    co: `${M}ej restauracji, kawiarni albo baru szybkiej obsługi (według otwartej mapy OpenStreetMap). Odpowiada na pytania, gdzie zjeść albo wypić kawę na mieście i ile lokali z jedzeniem jest w pobliżu, np. przy otwieraniu własnego.`,
  },
  gestosc_zaludnienia_100m: {
    co: 'Ile osób zameldowanych na stałe przypada na hektar w najbliższej okolicy (obszar ok. 200 metrów wokół adresu, tylko Kraków). Odpowiada na pytania, czy jest tłoczno i gęsto zabudowane.',
  },
  gmina_czyste_powietrze_wnioski_100_domow: {
    co: 'Ile wniosków o dopłatę z programu „Czyste Powietrze” (wymiana pieca, ocieplenie domu) złożono w 2025 roku na 100 domów jednorodzinnych w gminie. Odpowiada na pytania, czy w gminie ludzie wymieniają stare piece.',
  },
  gmina_dlug_pc: {
    co: 'Dług budżetu gminy w złotych na jednego mieszkańca. Odpowiada na pytania, czy gmina jest zadłużona i jak stoi z finansami.',
  },
  gmina_inwestycje_pc: {
    co: 'Ile gmina wydaje rocznie na inwestycje (drogi, szkoły, kanalizacja) w złotych na mieszkańca. Odpowiada na pytania, czy gmina inwestuje i się rozwija.',
  },
  gmina_koszty_stale_rok: {
    co: 'Szacunek rocznych opłat stałych za mieszkanie w gminie: wywóz śmieci i podatek od nieruchomości (dla 3 osób w 60 metrach kwadratowych). Odpowiada na pytania o lokalne opłaty, śmieci i podatek od mieszkania.',
  },
  gmina_mpzp_pokrycie_pct: {
    co: 'Jaka część powierzchni całej gminy ma miejscowy plan zagospodarowania przestrzennego (MPZP, plan, który ustala, co wolno budować). Odpowiada na pytania, czy gmina ma plany miejscowe – nie o konkretny adres.',
  },
  gmina_pit_na_mieszkanca: {
    co: 'Dochody budżetu gminy z podatku dochodowego od osób fizycznych (PIT) na mieszkańca – zamożność budżetu gminy, nie zarobki sąsiadów. Odpowiada na pytania, czy gmina jest bogata.',
  },
  halas_ldwn: {
    co: 'Hałas pod adresem w Krakowie i w gminach wokół: najwyższe pasmo wskaźnika hałasu dzienno-wieczorno-nocnego (LDWN, w decybelach) od ulic, tramwajów, kolei, przemysłu i lotniska. Odpowiada na pytania, czy jest głośno albo cicho, czy słychać ulicę lub tramwaje i czy da się spać przy otwartym oknie.',
    nie_dla:
      'Pytanie, jak daleko jest przystanek albo jak często jeździ tramwaj lub autobus (to przystanek i kursy).',
    przyklady: ['Nie hałasują tu tramwaje w nocy?', 'Da się spać przy otwartym oknie?'],
  },
  imprezy_obiekty_dni_500m_2025_26: {
    co: 'Przez ile dni w sezonie 2025/26 było wydarzenie (koncert, mecz, targi) w dużym obiekcie do 500 metrów: TAURON Arena, EXPO, ICE Kraków, stadiony Cracovii i Wisły. Odpowiada na pytania o tłumy, korki i hałas po meczach i koncertach.',
  },
  imprezy_stale_wpisy_500m_2026: {
    co: 'Liczba stałych imprez plenerowych z miejskiego wykazu na 2026 rok (koncerty, festyny, jarmarki) w promieniu 500 metrów, tylko Kraków. Odpowiada na pytania, czy w okolicy często są imprezy, koncerty i tłumy.',
  },
  inwestycje_500m: {
    co: 'Liczba pozwoleń na budowę wydanych w latach 2025–2026 w promieniu 500 metrów, w Krakowie i w gminach wokół. Odpowiada na pytania, czy coś tu wybudują, czy będzie budowa za oknem i czy okolica się zabuduje.',
  },
  kapielisko_odleglosc: {
    co: `${M}ego oficjalnego kąpieliska (np. Bagry, Zakrzówek, Kryspinów). Odpowiada na pytania, gdzie można się latem wykąpać i iść na plażę.`,
  },
  kolej_kursy_szczyt_h: {
    co: 'Ile pociągów Kolei Małopolskich na godzinę odjeżdża w porannym szczycie (7–9) z najbliższej stacji. Odpowiada na pytania, jak często jeździ pociąg.',
  },
  kolej_odleglosc: {
    co: `${M}ej stacji albo przystanku kolejowego z pociągami Kolei Małopolskich. Odpowiada na pytania o pociąg, stację i dojazd koleją, np. do pracy w innym mieście.`,
  },
  kolej_punktualnosc: {
    co: 'Jaki procent pociągów na najbliższej stacji (do 3 kilometrów) nie spóźnia się o 6 minut lub więcej, według Urzędu Transportu Kolejowego. Odpowiada na pytania, czy pociągi się tu spóźniają.',
  },
  kultura_odleglosc: {
    co: `${M}ego teatru, kina, biblioteki, domu kultury, muzeum albo galerii. Odpowiada na pytania, gdzie wyjść do kina, teatru albo biblioteki.`,
  },
  kursy_szczyt_h: {
    co: 'Ile razy na godzinę w porannym szczycie (7–9) odjeżdża tramwaj albo autobus miejski z najbliższego przystanku. Odpowiada na pytania, jak często coś jeździ i ile się czeka na tramwaj albo autobus.',
  },
  ladowarka_ev_odleglosc: {
    co: `${M}ej publicznej ładowarki samochodów elektrycznych. Odpowiada na pytania, gdzie naładować auto elektryczne.`,
  },
  lawki_300m: {
    co: 'Liczba ławek w promieniu 300 metrów (według otwartej mapy OpenStreetMap). Odpowiada na pytania, czy jest gdzie usiąść i odpocząć na spacerze, ważne dla seniorów.',
  },
  liceum_odleglosc: {
    co: `${M}ego liceum ogólnokształcącego. Odpowiada na pytania o szkołę średnią i liceum dla nastolatka.`,
  },
  lotnisko_czas_min: {
    co: 'Ile minut trwa rano dojazd komunikacją publiczną na lotnisko Kraków-Balice, razem z dojściem i czekaniem. Odpowiada na pytania, jak dojechać na lotnisko i ile to trwa.',
  },
  ludnosc_1km: {
    co: 'Ile osób mieszka na kilometrze kwadratowym wokół adresu (Narodowy Spis Powszechny 2021). Odpowiada na pytania, ilu ludzi tu mieszka i czy okolica jest gęsto zaludniona.',
  },
  miejscowe_zagrozenia_gmina_2025: {
    co: 'Liczba interwencji straży pożarnej innych niż pożary (wypadki, wichury, podtopienia, wycieki) w całej gminie w 2025 roku. Odpowiada na pytania, jak często w gminie dzieje się coś groźnego.',
  },
  mpzp_status: {
    co: 'Czy adres leży na terenie obowiązującego miejscowego planu zagospodarowania przestrzennego (MPZP, planu, który ustala, co wolno tu budować), tylko Kraków. Odpowiada na pytania, czy jest plan miejscowy i co może tu powstać.',
  },
  nfz_kolejki_dni: {
    co: 'Ile dni czeka się na pierwszą wizytę u lekarza specjalisty w ramach Narodowego Funduszu Zdrowia (NFZ, bezpłatnie) w poradniach do 3 kilometrów. Odpowiada na pytania o kolejki do specjalisty.',
  },
  no2_srednia: {
    co: 'Średnie roczne stężenie dwutlenku azotu (NO2) – zanieczyszczenia ze spalin samochodów. Odpowiada na pytania o spaliny od ruchliwej ulicy i powietrze przy drodze.',
    nie_dla:
      'Ogólne pytanie o smog (to pył zawieszony PM2,5) i pytanie o wjazd autem do strefy (to Strefa Czystego Transportu).',
    przyklady: ['Dużo tu spalin od ruchliwej ulicy?'],
  },
  noclegi_lozka_300m: {
    co: 'Liczba miejsc noclegowych dla turystów (hotele, hostele, apartamenty na doby) w promieniu 300 metrów. Odpowiada na pytania, czy jest tu dużo turystów i najmu krótkoterminowego.',
  },
  obnizone_krawezniki_300m: {
    co: 'Liczba obniżonych krawężników w promieniu 300 metrów (według otwartej mapy OpenStreetMap). Odpowiada na pytania, czy da się tu przejechać wózkiem dziecięcym albo inwalidzkim bez barier.',
  },
  obszar_rewitalizacji: {
    co: 'Czy adres leży w obszarze rewitalizacji Krakowa (stara Nowa Huta, Grzegórzki i Wesoła, Kazimierz i Stradom), gdzie miasto prowadzi programy odnowy. Odpowiada na pytania, czy miasto planuje tu odnowę dzielnicy.',
  },
  osiadanie_mm_rok: {
    co: 'O ile milimetrów rocznie teren pod budynkami i drogami osiada albo się podnosi, według pomiarów satelity radarowego. Odpowiada na pytania, czy grunt osiada i czy grozi pękanie ścian.',
  },
  osuwisko_odleglosc: {
    co: `${M}ego osuwiska z bazy Państwowego Instytutu Geologicznego; 0 = adres leży na osuwisku. Odpowiada na pytania, czy blisko jest osuwisko i czy zbocze może się obsunąć.`,
  },
  oswietlenie_100m: {
    co: 'Liczba latarni ulicznych w promieniu 100 metrów (według otwartej mapy OpenStreetMap, może być niepełna). Odpowiada na pytania, czy wieczorem na ulicy jest jasno.',
  },
  paczkomat_odleglosc: {
    co: `${M}ego paczkomatu InPost. Odpowiada na pytania o paczkomat i odbiór paczek.`,
  },
  paleniska_200m: {
    co: 'Liczba miejsc, w których według ewidencji miasta mogą jeszcze działać piece na węgiel albo drewno, w promieniu 200 metrów, tylko Kraków. Odpowiada na pytania, czy ktoś w okolicy pali w piecu.',
    nie_dla: 'Pytanie, jak bardzo dym z pieców zanieczyszcza powietrze (to benzo(a)piren).',
    przyklady: ['Czy sąsiedzi palą jeszcze węglem?'],
  },
  pitnik_odleglosc: {
    co: `${M}ego miejskiego pitnika (kranika z wodą pitną w parku albo na placu), tylko Kraków. Odpowiada na pytania, gdzie napić się wody na zewnątrz.`,
  },
  plac_zabaw_odleglosc: {
    co: `${M}ego publicznego placu zabaw dla dzieci. Odpowiada na pytania, gdzie dziecko może się pobawić.`,
  },
  pm10_srednia: {
    co: 'Średnie roczne stężenie pyłu zawieszonego PM10 (grubszy pył ze smogu, z pieców i ruchu ulicznego). Odpowiada na pytania, w których ktoś wprost pyta o pył PM10.',
    nie_dla: 'Ogólne pytanie o smog i jakość powietrza (to pył zawieszony PM2,5).',
  },
  pm25_srednia: {
    co: 'Średnie roczne stężenie pyłu zawieszonego PM2,5 (drobny pył ze smogu, wnika głęboko do płuc). Domyślna odpowiedź na pytania o smog, czyste powietrze i czym się tu oddycha (astma, alergia).',
    nie_dla:
      'Pytania wprost o pył PM10, o spaliny (dwutlenek azotu), o dym z pieców (benzo(a)piren), o liczbę pieców w okolicy (paleniska) albo o wiatr (przewietrzanie).',
    przyklady: ['Jak tu z jakością powietrza?', 'Jest tu smog zimą?'],
  },
  policja_odleglosc: {
    co: `${M}ego komisariatu policji w Krakowie – to dostępność policji, nie poziom przestępczości. Odpowiada na pytania, gdzie jest najbliższy komisariat.`,
  },
  poczta_1200m: {
    co: 'Czy w promieniu 1,2 kilometra (w linii prostej) jest poczta albo punkt pocztowy zaznaczony na otwartej mapie OpenStreetMap – tak albo nie. Odpowiada na pytania, czy blisko jest poczta, gdzie nadać list albo odebrać przesyłkę.',
  },
  powiat_wynagrodzenie_brutto: {
    co: 'Przeciętne miesięczne wynagrodzenie brutto w powiecie (w firmach zatrudniających co najmniej 10 osób), nie zarobki sąsiadów. Odpowiada na pytania, ile się tu zarabia.',
  },
  powodz_10proc: {
    co: 'Głębokość wody pod adresem przy powodzi, która zdarza się raz na 10 lat (prawdopodobieństwo 10%), według rządowych map zagrożenia powodziowego. Jedyna warstwa powodzi: odpowiada na pytania, czy tu zalewa, czy zaleje piwnicę, o powódź, wylewy rzeki i podtopienia.',
    nie_dla:
      'Pytanie, jak blisko jest rzeka, potok albo staw (to odległość do wody) – sama bliskość wody to nie zagrożenie powodzią.',
    przyklady: ['Czy ta okolica jest zagrożona powodzią?', 'Rzeka tu wylewa?'],
  },
  pozary_gmina_2025: {
    co: 'Liczba pożarów w całej gminie w 2025 roku (dane straży pożarnej i miasta), nie ryzyko pod adresem. Odpowiada na pytania, czy w gminie często się pali.',
  },
  pr_odleglosc: {
    co: `${M}ego parkingu Parkuj i Jedź (P+R) w Krakowie, gdzie zostawia się auto i przesiada do tramwaju albo autobusu. Odpowiada na pytania, gdzie zostawić samochód i przesiąść się do komunikacji.`,
  },
  przedszkole_odleglosc: {
    co: `${M}ego przedszkola, także oddziału przedszkolnego przy szkole. Odpowiada na pytania o przedszkole dla dziecka.`,
  },
  przestepstwa_1000_powiat_2025: {
    co: 'Liczba przestępstw stwierdzonych przez policję w 2025 roku na 1000 mieszkańców w całym powiecie (cały Kraków ma jedną wartość), nie na ulicy. Odpowiada na pytania o przestępczość w mieście albo powiecie.',
  },
  przetargi_dzielnica: {
    co: 'Liczba rozstrzygniętych przetargów miejskich (zamówień publicznych miasta) w dzielnicy z ostatnich dwóch lat. Odpowiada na pytania, ile miasto zleca i wydaje w tej dzielnicy.',
  },
  przewietrzanie_klasa: {
    co: 'Klasa przewietrzania okolicy od 1 (słaby wiatr) do 4 (dobrze przewiewa), z miejskiego atlasu wiatru, tylko Kraków. Odpowiada na pytania, czy okolica jest przewietrzana i czy smog albo upał tu zalegają.',
    nie_dla: 'Pytanie, ile jest smogu i pyłu w powietrzu (to pył zawieszony PM2,5).',
    przyklady: ['Czy wiatr tu przewiewa, czy powietrze stoi?'],
  },
  przychodnia_bez_barier_odleglosc: {
    co: `${M}ej przychodni lekarza rodzinnego (podstawowa opieka zdrowotna, POZ) z podjazdem, windą albo toaletą dla niepełnosprawnych. Odpowiada na pytania, czy osoba na wózku albo o kulach dostanie się do lekarza.`,
  },
  przychodnia_odleglosc: {
    co: `${M}ej przychodni lekarza rodzinnego (podstawowa opieka zdrowotna, POZ). Domyślna odpowiedź na pytania o lekarza rodzinnego, przychodnię i ośrodek zdrowia.`,
  },
  przyroda_chroniona_odleglosc: {
    co: 'Odległość w metrach do najbliższego obszaru chronionej przyrody (rezerwat, park krajobrazowy albo narodowy, obszar Natura 2000); 0 = adres leży w takim obszarze. Odpowiada na pytania o dziką przyrodę i rezerwaty w pobliżu.',
  },
  przystanek_odleglosc: {
    co: `${M}ego przystanku tramwaju albo autobusu miejskiego. Domyślna odpowiedź na pytania o komunikację miejską: tramwaj, autobus, MPK (Miejskie Przedsiębiorstwo Komunikacyjne), czy daleko do przystanku.`,
    nie_dla:
      'Pytanie, czy tramwaje albo autobusy hałasują i czy słychać je w mieszkaniu (to hałas).',
    przyklady: ['Daleko stąd do tramwaju?'],
  },
  punkt_schronienia_odleglosc: {
    co: `${M}ego punktu schronienia wyznaczonego przez Państwową Straż Pożarną (miejsce do ukrycia się w razie zagrożenia), tylko Kraków. Odpowiada na pytania o schron.`,
  },
  recykling_odleglosc: {
    co: `${M}ego kontenera albo punktu segregacji odpadów (szkło, plastik, papier). Odpowiada na pytania, gdzie wyrzucić posegregowane śmieci.`,
  },
  rod_odleglosc: {
    co: `${M}ego rodzinnego ogrodu działkowego. Odpowiada na pytania o działkę, ogródek i ogrody działkowe.`,
  },
  rower_infrastruktura_odleglosc: {
    co: `${M}ej drogi dla rowerów, ścieżki pieszo-rowerowej albo pasa rowerowego. Domyślna odpowiedź na pytania, czy da się tu jeździć rowerem po ścieżkach.`,
  },
  rower_ruch_dobowy: {
    co: 'Ile rowerów dziennie przejeżdża obok najbliższego automatycznego licznika rowerów w Krakowie (do 1 kilometra). Odpowiada na pytania, czy dużo ludzi jeździ tu rowerem.',
  },
  rynek_czas_min: {
    co: 'Ile minut trwa rano dojazd komunikacją publiczną do Rynku Głównego w Krakowie, razem z dojściem, czekaniem i przesiadkami. Odpowiada na pytania, ile się jedzie do centrum albo na Rynek, także rano w korkach do pracy.',
  },
  sct_w_strefie: {
    co: 'Czy adres leży w Strefie Czystego Transportu (SCT) w Krakowie – strefie, do której starym autem (np. starszym dieslem) nie wolno wjechać bez ryzyka mandatu. Odpowiada na pytania o wjazd samochodem, diesla i mandat za strefę.',
  },
  sejm2023_lista_1: { co: SEJM('Komitet Wyborczy Bezpartyjni Samorządowcy') },
  sejm2023_lista_2: {
    co: SEJM('komitet Trzecia Droga (Polska 2050 Szymona Hołowni i Polskie Stronnictwo Ludowe)'),
  },
  sejm2023_lista_3: { co: SEJM('Komitet Wyborczy Nowa Lewica') },
  sejm2023_lista_4: { co: SEJM('Komitet Wyborczy Prawo i Sprawiedliwość') },
  sejm2023_lista_5: { co: SEJM('Komitet Wyborczy Konfederacja Wolność i Niepodległość') },
  sejm2023_lista_6: {
    co: SEJM(
      'komitet Koalicja Obywatelska (Platforma Obywatelska, Nowoczesna, Inicjatywa Polska, Zieloni)',
    ),
  },
  sejm2023_lista_7: { co: SEJM('Komitet Wyborczy Polska Jest Jedna') },
  seveso_odleglosc: {
    co: `${M}ego zakładu o dużym albo zwiększonym ryzyku poważnej awarii przemysłowej (tak zwany zakład Seveso, np. skład chemikaliów albo paliw). Odpowiada na pytania, czy blisko jest niebezpieczna fabryka.`,
  },
  siec_cieplownicza_odleglosc: {
    co: `${M}ej rury miejskiej sieci ciepłowniczej (Miejskie Przedsiębiorstwo Energetyki Cieplnej w Krakowie). Odpowiada na pytania o miejskie ogrzewanie i ciepło z sieci zamiast pieca.`,
  },
  silownia_plenerowa_odleglosc: {
    co: `${M}ej siłowni plenerowej (darmowe przyrządy do ćwiczeń na świeżym powietrzu). Odpowiada na pytania, gdzie poćwiczyć na dworze.`,
  },
  sklep_odleglosc: {
    co: `${M}ego sklepu spożywczego (supermarket, sklep osiedlowy, piekarnia, warzywniak). Domyślna odpowiedź na pytania o sklep i codzienne zakupy (Biedronka, Żabka, Lidl).`,
  },
  slonce_grudzien_h: {
    co: 'Ile godzin słońce świeci na ścianę budynku z oknami w najkrótszy dzień roku, 21 grudnia (zasłaniają je inne budynki), tylko Kraków. Odpowiada na pytania, czy mieszkanie jest słoneczne i czy zimą jest w nim słońce.',
  },
  sport_odleglosc: {
    co: `${M}ego miejskiego obiektu sportowego w Krakowie (boisko, hala, stadion, kort, lodowisko). Odpowiada na pytania, gdzie uprawiać sport.`,
  },
  spp_podstrefa: {
    co: 'Czy adres leży w strefie płatnego parkowania w Krakowie. Odpowiada na pytania, czy za parkowanie auta pod domem trzeba płacić i gdzie zaparkować.',
  },
  stacje_bazowe_300m: {
    co: 'Liczba miejsc z antenami telefonii komórkowej (stacje bazowe) w promieniu 300 metrów, tylko Kraków. Odpowiada na pytania o maszty, anteny na dachach i promieniowanie elektromagnetyczne.',
  },
  stojaki_300m: {
    co: 'Liczba miejskich stojaków rowerowych w promieniu 300 metrów, tylko Kraków. Odpowiada na pytania, gdzie przypiąć rower.',
  },
  straz_pozarna_odleglosc: {
    co: `${M}ej jednostki straży pożarnej, zawodowej albo ochotniczej (według otwartej mapy OpenStreetMap). To położenie remizy, nie czas dojazdu. Odpowiada na pytania, jak daleko jest straż pożarna.`,
  },
  swiatlo_nocne_viirs: {
    co: 'Jak jasno jest nocą w okolicy, widziane z satelity – ilość sztucznego światła (łuna miasta, zanieczyszczenie światłem). Odpowiada na pytania, czy nocą jest ciemno i widać gwiazdy, czy wszędzie świeci miasto.',
  },
  szkola_podst_odleglosc: {
    co: `${M}ej publicznej szkoły podstawowej. Domyślna odpowiedź na pytania o szkołę i podstawówkę dla dziecka.`,
  },
  szkola_podst_wynik_e8: {
    co: 'Średni wynik egzaminu ósmoklasisty (polski, matematyka, angielski) w najbliższej szkole podstawowej z opublikowanymi wynikami, do 1,5 kilometra. Odpowiada na pytania, czy szkoła jest dobra i jakie ma wyniki.',
  },
  targowisko_odleglosc: {
    co: `${M}ego targowiska, placu targowego albo bazaru. Odpowiada na pytania o targ, warzywa od rolnika i bazar.`,
  },
  teren_osuwiskowy: {
    co: 'Czy adres leży na osuwisku albo na terenie zagrożonym ruchami ziemi, według bazy Państwowego Instytutu Geologicznego. Odpowiada na pytania, czy dom stoi na osuwisku i czy grunt się zsuwa.',
  },
  toaleta_woda_odleglosc: {
    co: `${M}ej toalety publicznej albo punktu z wodą pitną. Odpowiada na pytania, gdzie jest publiczna toaleta.`,
  },
  udzial_0_14: {
    co: 'Jaki procent mieszkańców okolicy (kilometr kwadratowy, spis powszechny 2021) to dzieci do 14 lat. Odpowiada na pytania, czy mieszka tu dużo rodzin z dziećmi.',
  },
  udzial_65plus: {
    co: 'Jaki procent mieszkańców okolicy (kilometr kwadratowy, spis powszechny 2021) ma 65 lat lub więcej. Odpowiada na pytania, czy mieszka tu dużo seniorów i starszych osób.',
  },
  urzad_odleglosc: {
    co: `${M}ego urzędu gminy, miasta albo dzielnicy. Odpowiada na pytania, gdzie załatwić sprawę w urzędzie.`,
  },
  uzbrojenie_gaz_50m: {
    co: 'Czy w promieniu 50 metrów od adresu jest sieć gazowa (według ewidencji uzbrojenia terenu), tylko gminy wokół Krakowa i obrzeża miasta. Odpowiada na pytania, czy działka ma dostęp do gazu.',
  },
  uzbrojenie_kanalizacja_50m: {
    co: 'Czy w promieniu 50 metrów od adresu jest kanalizacja (według ewidencji uzbrojenia terenu), tylko gminy wokół Krakowa i obrzeża miasta. Odpowiada na pytania, czy jest kanalizacja, czy szambo.',
  },
  uzbrojenie_prad_50m: {
    co: 'Czy w promieniu 50 metrów od adresu jest sieć elektryczna (według ewidencji uzbrojenia terenu), tylko gminy wokół Krakowa i obrzeża miasta. Odpowiada na pytania, czy działka ma dostęp do prądu.',
  },
  uzbrojenie_woda_50m: {
    co: 'Czy w promieniu 50 metrów od adresu jest wodociąg (według ewidencji uzbrojenia terenu), tylko gminy wokół Krakowa i obrzeża miasta. Odpowiada na pytania, czy jest woda z wodociągu, czy trzeba mieć studnię.',
  },
  weterynarz_odleglosc: {
    co: `${M}ej lecznicy albo gabinetu weterynaryjnego. Odpowiada na pytania o weterynarza dla psa albo kota.`,
  },
  woda_odleglosc: {
    co: `${M}ej rzeki, potoku albo stawu – to nie jest zagrożenie powodzią. Odpowiada na pytania, czy blisko jest rzeka, woda albo staw.`,
  },
  wybieg_psy_odleglosc: {
    co: `${M}ego ogólnodostępnego wybiegu dla psów. Odpowiada na pytania, gdzie pies może pobiegać bez smyczy.`,
  },
  wykrywalnosc_powiat_2025: {
    co: 'Jaki procent sprawców przestępstw policja wykryła w 2025 roku w całym powiecie (cały Kraków ma jedną wartość). Odpowiada na pytania, jak skutecznie działa tu policja.',
  },
  zabytki_300m: {
    co: 'Liczba zabytków (budynków i miejsc z rejestru i ewidencji zabytków) w promieniu 300 metrów. Odpowiada na pytania, czy okolica jest zabytkowa i historyczna.',
  },
  zabytki_rejestr_500m: {
    co: 'Liczba zabytków wpisanych do państwowego rejestru zabytków (najcenniejsze budynki, parki, cmentarze, układy ulic) w promieniu 500 metrów. Odpowiada na pytania, czy w okolicy są ważne, chronione zabytki.',
  },
  zielen_udzial: {
    co: 'Jaki procent powierzchni najbliższej okolicy (kwadrat ok. 100 na 100 metrów, tylko Kraków) pokrywa roślinność – drzewa, krzewy, trawa. Odpowiada na pytania, ile jest zieleni wokół domu.',
  },
  zielen_worldcover_100m: {
    co: 'Jaki procent powierzchni w promieniu 100 metrów zajmują drzewa i trawa (satelitarna mapa Europejskiej Agencji Kosmicznej). Domyślna odpowiedź na pytania o zieleń: park, skwer, trawnik, czy jest zielono, gdzie wyjść na spacer albo z psem.',
  },
  zlobek_odleglosc: {
    co: `${M}ego żłobka albo klubu dziecięcego. Odpowiada na pytania o żłobek i opiekę nad małym dzieckiem do 3 lat.`,
  },
  zycie_nocne_300m: {
    co: 'Liczba barów, pubów i klubów nocnych w promieniu 300 metrów. Odpowiada na pytania o życie nocne, knajpy i nocny hałas z lokali.',
  },
}

/**
 * Skróty, które mogą paść w opisie, i rozwinięcie, które musi stać obok (test). Lista z #163:
 * skróty z opisów danych i nazw źródeł. Nowy skrót w opisie bez rozwinięcia = czerwony test.
 */
export const SKROTY: Readonly<Record<string, RegExp>> = {
  LDWN: /dzienno-wieczorno-nocn/,
  Lden: /dzienno-wieczorno-nocn/,
  SCT: /Strefa Czystego Transportu|Strefie Czystego Transportu/,
  'P+R': /Parkuj i Jedź/,
  POZ: /podstawowa opieka zdrowotna/,
  MPZP: /miejscow\w+ plan\w* zagospodarowania przestrzennego/,
  BaP: /benzo\(a\)piren/,
  'PM2,5': /pył\w* zawieszon/,
  PM10: /pył\w* zawieszon|pył/,
  NO2: /dwutlenek azotu|dwutlenku azotu/,
  NFZ: /Narodowego Funduszu Zdrowia|Narodowy Fundusz Zdrowia/,
  MPK: /Miejskie Przedsiębiorstwo Komunikacyjne/,
  PIT: /podatku dochodowego od osób fizycznych/,
  AED: /automatycznego urządzenia|automatyczn/,
  // Skróty, które w opisach dla JEV w ogóle nie powinny paść (rozwinięcie zamiast skrótu).
  RCN: /rejestr\w* cen nieruchomości/,
  MLD: /Małopolskich Linii Dowozowych/,
  InSAR: /satelit/,
  GUGiK: /Główn\w+ Urzęd\w+ Geodezji i Kartografii/,
  MSIP: /Miejsk\w+ System\w+ Informacji Przestrzennej/,
  GIOŚ: /Główn\w+ Inspektorat\w* Ochrony Środowiska/,
  OSM: /OpenStreetMap/,
  BDOT: /Baz\w+ Danych Obiektów Topograficznych/,
  SEWIK: /System\w* Ewidencji Wypadków i Kolizji/,
  KMP: /Komend\w+ Miejsk\w+ Policji/,
  ZTP: /Zarząd\w* Transportu Publicznego/,
  PSP: /Państwow\w+ Straż\w* Pożarn/,
  ROD: /rodzinn\w+ ogrod\w* działkow/,
  SOPO: /System\w* Osłony Przeciwosuwiskowej/,
  PRTR: /rejestr\w* (uwalniania|zanieczyszczeń)/,
  NSP: /Narodow\w+ Spis\w* Powszechn/,
  ZZM: /Zarząd\w* Zieleni Miejskiej/,
  GTFS: /rozkład/,
  GUS: /Główn\w+ Urzęd\w+ Statystyczn/,
  BDL: /Bank\w* Danych Lokalnych/,
  UTK: /Urzęd\w* Transportu Kolejowego/,
  MPEC: /Miejskie Przedsiębiorstwo Energetyki Cieplnej/,
  SIO: /System\w* Informacji Oświatowej/,
  NID: /Narodow\w+ Instytut\w* Dziedzictwa/,
  PRG: /Państwow\w+ Rejestr\w* Granic/,
  ESA: /Europejsk\w+ Agencj\w+ Kosmiczn/,
  WSA: /Wojewódzk\w+ Sąd\w* Administracyjn/,
  JST: /jednost\w+ samorządu terytorialnego/,
  KON: /ewidencj\w+ obiektów noclegowych/,
  CAS: /Centrum Aktywności Seniora/,
  BO: /budżet\w* obywatelsk/,
  E8: /egzamin\w* ósmoklasisty/,
  EV: /samochodów elektrycznych/,
  SKA: /Szybk\w+ Kolei Aglomeracyjn/,
  END: /dyrektyw\w+ hałasow/,
  ZDR: /dużym .*ryzyku/,
  ZZR: /zwiększonym ryzyku/,
}

/** Żargon techniczny, który w opisach dla JEV nie ma prawa paść. */
export const ZARGON: readonly RegExp[] = [
  /oczk\w* siatki/i,
  /komórk\w* siatki/i,
  /\bheks/i,
  /\bH3\b/,
  /interferometri/i,
  /anemologiczn/i,
  /geodezyjn/i,
  /\bszt\.\s*$|\bszt\.\)/,
]
