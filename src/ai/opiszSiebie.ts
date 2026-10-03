// „Opisz siebie” (#16): zdanie użytkownika → profil + ważność kategorii + potrzeby → wagi mapy.
//
// JEV tylko wybiera z zamkniętych list (profil z PERSONY, poziom ważności kategorii) i ocenia
// twierdzenia („osoba ma dzieci”). Nie podaje żadnej wagi ani liczby wprost – wagi biorą się
// z tabeli POTRZEBY i z poziomów 0–4. Procent przy potrzebie to pewność JEV, nie dane.
// Gdy JEV milczy albo jest niepewny, ten sam wynik daje parser reguł (słowa kluczowe po polsku).
//
// Czysty moduł bez DOM i Reacta – testy idą na gołym `node --test` (fetch wstrzykiwany).
import type { KATEGORIE, KategoriaId, WskaznikMeta } from '../kontrakty/index.ts'
import {
  PERSONY,
  type PersonaId,
  type Tryb,
  ustawieniaPersony,
  znajdzPersone,
} from '../wynik/persony.ts'
import type { KierunekOceny, Kierunki } from '../wynik/silnik.ts'
import {
  type KryteriaTakNie,
  type OdpowiedzJev,
  type OpcjeKlienta,
  ocena,
  takNie,
  type WynikZZapasem,
  wybor,
  type ZapytanieJev,
  zJevem,
} from './jev.ts'

/** Kategorie liczone w wyniku – kontekst nie ma wagi z „opisz siebie”. */
export type KategoriaOceniana = Exclude<KategoriaId, 'kontekst' | 'przyszlosc'>

export const KATEGORIE_OCENIANE = [
  'codziennosc',
  'transport',
  'spokoj',
  'spolecznosc',
  'bezpieczenstwo',
] as const satisfies readonly KategoriaOceniana[]

// Kopia etykiet z kontraktu (moduł kontraktu czyta import.meta.env, którego w Node nie ma).
// `satisfies` pilnuje, żeby tekst był identyczny z KATEGORIE.
export const ETYKIETY_KATEGORII = {
  codziennosc: 'Codzienność pieszo',
  transport: 'Transport',
  spokoj: 'Spokój i zdrowie',
  spolecznosc: 'Społeczność i koszty',
  bezpieczenstwo: 'Bezpieczeństwo i ryzyko',
} as const satisfies { [K in KategoriaOceniana]: (typeof KATEGORIE)[K] }

const OPISY_KATEGORII: Record<KategoriaOceniana, string> = {
  codziennosc: 'sklepy, szkoły, przychodnie i usługi w zasięgu spaceru',
  transport: 'przystanki, częste kursy, dojazd do centrum i na lotnisko',
  spokoj: 'cisza, czyste powietrze, zieleń',
  spolecznosc: 'koszty, szkoły, inwestycje i społeczność',
  bezpieczenstwo: 'ryzyko powodzi i inne zagrożenia',
}

/** Poziom ważności = waga 0–4 (indeks). Kolejność widzi JEV, więc jej nie przestawiaj. */
export const POZIOMY_WAZNOSCI = [
  'Bez znaczenia',
  'Mało ważne',
  'Średnio ważne',
  'Ważne',
  'Bardzo ważne',
] as const

/**
 * Kategorie, o których poziom pytamy JEV (#147: bez „Przyszłości okolicy”). Zwolnione miejsce
 * zajęło twierdzenie o własnej sytuacji – limit pośrednika to 16 pytań. Przyszłość okolicy
 * wynika z profilu Inwestor (potrzeba `inwestycja` z tabeli POTRZEBY); w #18 JEV odszedł od
 * środka skali tylko w 2 z 30 opisów, a jeden z nich i tak był inwestorem. #176: po #171
 * „Przyszłość okolicy” weszła do „Społeczności i kosztów” (`spolecznosc`) – o jej poziom też
 * nie pytamy, a profil Inwestor podnosi ją przez potrzebę `inwestycja`.
 *
 * #153: bez „Codzienności pieszo” – jej miejsce zajęło drugie twierdzenie bramki. Codzienność
 * podnoszą potrzeby (dzieci, senior, lekarz, sklepy, rower, bez samochodu). Przeliczenie
 * zapisanych przebiegów bez tego pytania (bez nowych wywołań): kategorie F1 bez zmian na
 * zbiorze kontrolnym nr 1 i nr 2, −2 pp na wzorcowym; z czterech kategorii najtańsza
 * (WYNIKI.md, „Trzy błędy (#153)”).
 */
export const KATEGORIE_JEV = [
  'transport',
  'spokoj',
  'bezpieczenstwo',
] as const satisfies readonly KategoriaOceniana[]

/** Środek skali = „tekst o tym nie mówi” – nie zmienia wag. */
const POZIOM_NEUTRALNY = 2

/**
 * Poniżej tej pewności JEV nie wierzymy poziomowi kategorii. #180: wraca reguła sprzed #172
 * (zaokrąglona ocena przy pewności ≥ 0,6) – poziom z rozkładu nie poprawił stabilności ponad szum
 * na zbiorze nr 7 (WYNIKI.md, „Pomiar #172 i #173 na zbiorze nr 7 (#174)”).
 */
export const PROG_PEWNOSCI = 0.6
/**
 * #155: poniżej tej pewności JEV nie wierzymy wyborowi profilu (było 0,6 jak dla kategorii).
 * Zły profil przestawia wszystkie wagi, a „bez zmian” zostawia te, które użytkownik już ma.
 * Wtedy profil daje tylko mocna potrzeba (`profilZMocnychPotrzeb`). Dowody: WYNIKI.md, „Profil (#155)”.
 */
export const PROG_PROFILU = 0.85
/**
 * #155: od tej oceny twierdzenia (noul) potrzeba jest mocna i pod progiem profilu go wyznacza.
 * Ten sam poziom co „pewna potrzeba” przy zamkniętej bramce (PROG_POTRZEBY_PEWNEJ). Przy 0,8
 * zapas oddawał Rodzinę za dzieci kumpla (stary A06: dzieci 0,81 przy profilu 0,66).
 */
export const PROG_MOCNEJ_POTRZEBY = 0.9
/**
 * Od tej oceny twierdzenia (noul) uznajemy potrzebę. #172: zostaje 0,6. Przy 0,6 nie ma pustego
 * pasma (noul gęstnieje płynnie od 0,5 do 0,8), a przesunięcie progu zmienia trafność, nie samą
 * stabilność: przy 0,7 „dokładnie” rośnie na zbiorach nr 5–6, a spada na zbiorze do strojenia.
 */
export const PROG_POTRZEBY = 0.6

/**
 * Bramka „nikt tu nie zamieszka” (#147, #153, #162): tekst bez prawdziwego szukania (sama opinia
 * albo ciekawość: „Kumpel ma trójkę dzieci… ciekawe, czy tam głośno”) albo sytuacja tylko
 * wyobrażona lub dawna („Gdybyśmy kiedyś mieli dzieci…”, „kiedyś mieszkaliśmy z dziećmi”). Gdy
 * bramka jest zamknięta, profil zostaje bez zmian, a z potrzeb zostają tylko bardzo pewne.
 *
 * #162 (decyzja Jana): szukanie W CZYIMŚ IMIENIU („piszę w imieniu taty… szukamy mu”, „szukam
 * dla koleżanki, ona…”) to NIE jest cudza sytuacja – mapa liczy profil i potrzeby osoby, która
 * tam zamieszka. Dlatego `cudza_osoba` z #153 („szuka dla kogoś, kto z nią nie zamieszka”)
 * zastąpiło `nikt_nie_szuka`. Pierwsza wersja („W tekście nie ma nikogo, kto zamieszka…”)
 * dalej odcinała szukanie dla taty (0,54 i 0,85 na pozycjach zbioru nr 4) i inwestora (0,54).
 * Twierdzenia potrzeb i pytanie o profil zostały bez zmian: na celowanych zdaniach („w imieniu
 * taty” → Senior, „dla koleżanki” → Rodzina) JEV już opisuje przyszłego mieszkańca.
 *
 * Każde twierdzenie ma własny próg (`prog`). `nikt_nie_szuka` zamyka dopiero od 0,7: opisy
 * własnej sytuacji bez słowa „szukam” („Mam 74 lata, sama już nie prowadzę…”) dostają do 0,50,
 * a teksty bez szukania 0,75–0,92. Dowody: WYNIKI.md, „Szukam dla kogoś (#162)”.
 *
 * #153: wąskie twierdzenia i odwrócona logika – bramka zamyka się tylko na DOWÓD (ocena ≥ progu),
 * a nie na brak dowodu własnej sytuacji. Twierdzenie z #147 („Osoba opisuje własną obecną
 * sytuację…”) dawało „teściowa z nami zamieszka” 0,35 i profil Senior przepadał. Domownik,
 * rodzina i własne plany to własna sytuacja. Dowody: WYNIKI.md, „Trzy błędy (#153)”.
 */
/** Od tej oceny twierdzenia bramki (domyślnie) bramka się zamyka. */
export const PROG_BRAMKI = 0.5
/** #162: wyższy próg dla `nikt_nie_szuka` – własne opisy bez „szukam” dostają do 0,50. */
export const PROG_NIKT_NIE_SZUKA = 0.7
export const BRAMKA = [
  {
    id: 'nikt_nie_szuka',
    twierdzenie:
      'Tekst to tylko opinia albo ciekawość – nikt nie szuka mieszkania ani dla siebie, ani dla kogoś innego (np. taty, koleżanki), ani pod wynajem.',
    // #163: kryteria prawda/fałsz – własny opis potrzeb bez słowa „szukam” to szukanie (#162: 0,50).
    kryteria: {
      prawda: {
        co: 'Nikt nie szuka mieszkania: tekst to tylko opinia, plotka, ciekawość albo sprawdzanie, jak działa aplikacja.',
        przyklady: [
          'Ciekawe, czy na tym osiedlu jest głośno, kolega tam mieszka.',
          'Sprawdzam tylko, jak to działa.',
        ],
      },
      falsz: {
        co: 'Ktoś szuka albo kupuje mieszkanie: dla siebie, z rodziną, dla kogoś bliskiego (taty, córki, koleżanki) albo pod wynajem – także gdy tekst tylko opisuje swoje potrzeby, bez słowa „szukam”.',
        przyklady: [
          'Mam 70 lat, chodzę o lasce, potrzebuję blisko lekarza.',
          'Piszę w imieniu mamy, chcemy jej znaleźć kawalerkę.',
        ],
      },
    },
    prog: PROG_NIKT_NIE_SZUKA,
  },
  {
    id: 'sytuacja_nieaktualna',
    twierdzenie:
      'Tekst mówi wyłącznie o sytuacji wyobrażonej („gdyby…”) albo nieaktualnej (tak było kiedyś), a nie o obecnej ani planowanej.',
    kryteria: {
      prawda: {
        co: 'Cały tekst dotyczy sytuacji wyobrażonej („gdybyśmy kiedyś…”) albo dawnej, która już nie trwa, a obecnych potrzeb w nim nie ma.',
        przyklady: [
          'Gdybym kiedyś miał psa, chciałbym mieć blisko park.',
          'Kiedyś mieszkaliśmy z dziećmi, ale to już nieaktualne.',
        ],
      },
      falsz: {
        co: 'Tekst opisuje obecną sytuację albo prawdziwy plan (dziecko w drodze, mama z nami zamieszka) – także gdy przy okazji wspomina przeszłość.',
        przyklady: [
          'W marcu urodzi nam się dziecko.',
          'Kiedyś jeździłem autem, dziś już nie prowadzę i potrzebuję tramwaju.',
        ],
      },
    },
    prog: PROG_BRAMKI,
  },
] as const
/** Przy zamkniętej bramce zostają tylko potrzeby z noul ≥ PROG_POTRZEBY_PEWNEJ. */
export const PROG_POTRZEBY_PEWNEJ = 0.9

interface Wzorzec {
  re: RegExp
  /** false = wzorzec sam zawiera przeczenie („bez auta”, „hałas”), więc „nie” go nie gasi. */
  negowalny?: boolean
}

export interface Potrzeba {
  id: string
  /** Krótko, do chipa „zrozumiałem: …”. */
  etykieta: string
  /** Twierdzenie dla JEV (noul); brak = potrzeba tylko z reguł (pokrywa ją profil albo kategoria). */
  twierdzenie?: string
  /** #163: kiedy twierdzenie jest prawdziwe, a kiedy fałszywe – tylko najsłabsze potrzeby. */
  kryteria?: KryteriaTakNie
  /** Wzorce na tekście bez polskich znaków, małymi literami. */
  wzorce: Wzorzec[]
  /** Profil, który potrzeba sugeruje (reguły; JEV wybiera profil sam). */
  persona?: PersonaId
  /** Minimalny poziom ważności kategorii (0–4). */
  kategorie: Partial<Record<KategoriaOceniana, number>>
  /**
   * Minimalna waga wskaźnika – id z manifestu. #177: test pilnuje, że każde id istnieje
   * w `public/dane/wskazniki`, więc zmiana warstw daje czerwony test, a nie cichą utratę wagi.
   */
  wskazniki: Record<string, number>
  /**
   * #177: kierunek dla warstw, których domyślny kierunek nie pasuje do potrzeby – głównie
   * neutralnych (weterynarz, życie nocne), które bez kierunku nie wchodzą do wyniku.
   * Kierunek z profilu albo bieżących ustawień wygrywa (`wagiZeZrozumienia`).
   */
  kierunki?: Readonly<Record<string, KierunekOceny>>
}

// Kolejność = kolejność pytań do JEV i chipów „zrozumiałem”. #183: 16 z twierdzeniem, razem
// 22 pytania (1 profil + 3 kategorie + 16 potrzeb + 2 twierdzenia bramki); limit pośrednika
// podniesiony z 16 do 32 (`LIMITY.pytan` w api/_jev.js – nasz limit, JEV ma tylko 64k tokenów).
// #147: każde twierdzenie to jeden warunek – JEV obniża ocenę, gdy tekst spełnia tylko część
// koniunkcji („nie ma samochodu i jeździ komunikacją” → „Nie mam samochodu” 0,58 w #18).
// Pozostałe twierdzenia nie mają „i”. Próba ich zaostrzenia (dzieci, pies, praca w centrum,
// lekarz, opis profilu „nieznany”) pogorszyła zbiór wzorcowy – wróciły do brzmienia z #16
// (WYNIKI.md, „Poprawki trafności (#147)”).
export const POTRZEBY: readonly Potrzeba[] = [
  {
    id: 'dzieci',
    etykieta: 'dzieci',
    twierdzenie: 'Osoba mieszka z dziećmi albo planuje dzieci.',
    // #163: przy szukaniu dla kogoś (#162) „osoba” to przyszły mieszkaniec – dzieci 0,59 pod progiem.
    kryteria: {
      prawda: {
        co: 'W szukanym mieszkaniu zamieszkają dzieci: ma je albo planuje osoba pisząca albo ta, dla której szuka mieszkania (np. córka z wnukami, koleżanka z dziećmi).',
      },
      falsz: {
        co: 'Nikt, kto ma tam zamieszkać, nie ma dzieci ani ich nie planuje; dzieci dorosłe i wyprowadzone albo dzieci znajomych, którzy tam nie zamieszkają.',
      },
    },
    wzorce: [
      {
        re: /\b(dzieci|dzieck|dziecm|cork|coreczk|syn\b|syna\b|synem|synow|synk|przedszkol|szkol|zlob|niemowl|maluch|rodzin)/,
      },
    ],
    persona: 'rodzina',
    kategorie: { codziennosc: 4, spokoj: 3 },
    // #177: plac zabaw to codzienność małych dzieci (4); biblioteka w 1,2 km to tylko 0/1 (2).
    // Bez liceum: potrzeba nie zna wieku dzieci, a w opisach przeważają małe.
    wskazniki: {
      przedszkole_odleglosc: 4,
      szkola_podst_odleglosc: 4,
      zlobek_odleglosc: 3,
      plac_zabaw_odleglosc: 4,
      biblioteka_1200m: 2,
      zielen_udzial: 2,
    },
  },
  {
    id: 'pies',
    etykieta: 'pies',
    twierdzenie: 'Osoba ma psa albo chce go mieć.',
    wzorce: [{ re: /\b(pies|psa|psem|psy|psiak|piesk|psiny)\b/ }],
    kategorie: { spokoj: 3 },
    // #177: wybieg i weterynarz służą wprost psu. Obie warstwy są neutralne (bez kierunku nie
    // liczą się), więc potrzeba nadaje „mniej = lepiej”. OSM ich nie zna wszędzie – waga 3.
    wskazniki: {
      zielen_udzial: 4,
      zielen_worldcover_100m: 4,
      wybieg_psy_odleglosc: 3,
      weterynarz_odleglosc: 3,
    },
    kierunki: { wybieg_psy_odleglosc: 'mniej-lepiej', weterynarz_odleglosc: 'mniej-lepiej' },
  },
  {
    id: 'zielen',
    etykieta: 'zieleń',
    twierdzenie: 'Osoba chce mieć blisko park, las albo zieleń.',
    wzorce: [
      {
        re: /\b(park\b|parku|parkow|parki\b|zielen|zielon|drzew|las\b|lasu|lesie|lasow|lasy|ogrod|spacer|przyrod)/,
      },
    ],
    kategorie: { spokoj: 4 },
    // #177: las, park krajobrazowy, Natura 2000 (2) i drzewa przy ulicy (2; tylko Kraków,
    // ewidencja ZZM niepełna). Ogródki działkowe (ROD) nie – to nie zieleń dla wszystkich.
    wskazniki: {
      zielen_udzial: 4,
      zielen_worldcover_100m: 4,
      przyroda_chroniona_odleglosc: 2,
      drzewa_100m: 2,
    },
  },
  {
    id: 'powietrze',
    etykieta: 'czyste powietrze',
    twierdzenie: 'Dla osoby ważne jest czyste powietrze (smog, astma, alergia).',
    wzorce: [{ re: /\b(smog|powietrz|astm|alergi|zanieczyszcz|pylow|pyly)/ }],
    kategorie: { spokoj: 4 },
    // #177: paleniska węglowe w 200 m (3, tylko Kraków) i przewietrzanie (2, model 2016).
    // Zakład z rejestru PRTR (2): to lista zakładów, nie pomiar emisji. Bez wniosków „Czyste
    // Powietrze” – to liczba dla całej gminy, nie powietrze pod adresem.
    wskazniki: {
      pm25_srednia: 4,
      pm10_srednia: 4,
      no2_srednia: 4,
      bap_srednia: 4,
      paleniska_200m: 3,
      przewietrzanie_klasa: 2,
      emitent_odleglosc: 2,
    },
  },
  {
    id: 'rower',
    etykieta: 'rower',
    twierdzenie: 'Osoba jeździ na co dzień rowerem albo hulajnogą.',
    wzorce: [{ re: /\b(rower|hulajnog)/ }],
    kategorie: { codziennosc: 3 },
    // #177: są już warstwy rowerowe – najbliższa droga dla rowerów (4) i stojaki (3). Główne
    // trasy metropolii (2, neutralna, więc z kierunkiem) to tylko 448 km tras, nie cała sieć.
    // Z dawnego zastępstwa („krótkie dystanse do usług”) zostaje sklep (2); gastronomia
    // i poczta w 1,2 km (0/1, prawie wszędzie 1) odpadają. Bez ruchu z liczników (17 sztuk).
    wskazniki: {
      rower_infrastruktura_odleglosc: 4,
      stojaki_300m: 3,
      droga_rowerowa_odleglosc: 2,
      sklep_odleglosc: 2,
    },
    kierunki: { droga_rowerowa_odleglosc: 'mniej-lepiej' },
  },
  {
    id: 'bez_samochodu',
    etykieta: 'bez samochodu',
    twierdzenie: 'Osoba nie ma samochodu.',
    // #163: najsłabsza potrzeba („No car obviously” 0,39, „auta nie potrzebuję” 0,21 w #18).
    kryteria: {
      prawda: {
        co: 'Tekst mówi, że osoba nie ma samochodu, nie prowadzi albo chce żyć bez auta i jeździć komunikacją.',
        przyklady: ['Auta nie mam i nie planuję.', 'No car, wszędzie jeżdżę tramwajem.'],
      },
      falsz: {
        co: 'Osoba ma samochód i nim jeździ albo tekst w ogóle nie mówi o aucie ani o komunikacji.',
        przyklady: ['Do pracy dojeżdżam autem.'],
      },
    },
    wzorce: [
      {
        re: /\b(bez (samochodu|auta|samochod)|nie mam (samochodu|auta|prawa jazdy)|nie jezdze (samochodem|autem))/,
        negowalny: false,
      },
      { re: /\b(komunikacj|tramwaj|autobus|mpk|przystan|metro|pociag)/ },
    ],
    kategorie: { transport: 4, codziennosc: 3 },
    // #177: czas komunikacją do Rynku (3) to dojazd bez auta. Kolej (2 + 2) i busy MLD (1) to
    // druga sieć, ważna głównie poza Krakowem; kursy z najbliższego przystanku ZTP zostają główne.
    wskazniki: {
      przystanek_odleglosc: 4,
      kursy_szczyt_h: 4,
      rynek_czas_min: 3,
      kolej_odleglosc: 2,
      kolej_kursy_szczyt_h: 2,
      bus_mld_kursy_szczyt_h: 1,
      sklep_odleglosc: 3,
    },
  },
  {
    id: 'senior',
    etykieta: 'senior',
    twierdzenie: 'Osoba jest na emeryturze albo w starszym wieku.',
    wzorce: [
      { re: /\b(emeryt|senior|starsz[ay] (pan|pani|osob|wiek)|w starszym wieku|wnuk|wnucz)/ },
    ],
    persona: 'senior',
    kategorie: { codziennosc: 4, spokoj: 4 },
    // #177: Centrum Aktywności Seniora (3) i przychodnia bez barier (3) służą wprost seniorowi;
    // kolejki do specjalisty NFZ (2). Defibrylator (1, neutralny – z kierunkiem): rejestr OSM
    // jest niepełny, więc tylko lekko.
    wskazniki: {
      przychodnia_odleglosc: 4,
      apteka_odleglosc: 4,
      lawki_300m: 4,
      obnizone_krawezniki_300m: 3,
      przychodnia_bez_barier_odleglosc: 3,
      cas_odleglosc: 3,
      nfz_kolejki_dni: 2,
      defibrylator_odleglosc: 1,
    },
    kierunki: { defibrylator_odleglosc: 'mniej-lepiej' },
  },
  {
    id: 'praca_centrum',
    etykieta: 'praca w centrum',
    twierdzenie: 'Osoba codziennie dojeżdża do pracy albo na uczelnię w centrum miasta.',
    // #163: kryteria prawda/fałsz (z listą miejsc „w centrum”) odrzucone na zbiorze do strojenia:
    // „szybki dojazd na AGH” spadł z 0,67 do 0,47, a żaden opis nie zyskał (WYNIKI.md, #163).
    wzorce: [
      {
        re: /\b(prac\w* (w|na) (centrum|rynku|starym miescie|kazimierzu)|w centrum|centrum miasta|do centrum|rynek|rynku|stare miasto|starym miescie|dojazd\w* do pracy|dojezdzam|biuro|biurze|uczelni)/,
      },
    ],
    kategorie: { transport: 4 },
    // #177: bez zmian – czas do Rynku i kursy w szczycie to już cała ta potrzeba.
    wskazniki: { rynek_czas_min: 4, kursy_szczyt_h: 3 },
  },
  {
    id: 'zdrowie',
    etykieta: 'lekarz blisko',
    twierdzenie: 'Osoba potrzebuje mieć blisko lekarza, przychodnię albo aptekę.',
    wzorce: [
      {
        re: /\b(lekarz|przychodni|aptek|chor(y|a|ob|uj)|niepelnospraw|wozk|wozek|o kulach|balkonik|rehabilit)/,
      },
    ],
    kategorie: { codziennosc: 4 },
    // #177: kolejki do specjalisty NFZ w 3 km (3) – choroba przewlekła to wizyty u specjalisty.
    // Defibrylator (1, neutralny – z kierunkiem) jak u seniora.
    wskazniki: {
      przychodnia_odleglosc: 4,
      apteka_odleglosc: 4,
      przychodnia_bez_barier_odleglosc: 3,
      obnizone_krawezniki_300m: 3,
      nfz_kolejki_dni: 2,
      defibrylator_odleglosc: 1,
    },
    kierunki: { defibrylator_odleglosc: 'mniej-lepiej' },
  },
  {
    id: 'lotnisko',
    etykieta: 'lotnisko',
    twierdzenie: 'Osoba często lata samolotem.',
    wzorce: [{ re: /\b(lotnisk|samolot|latam|balic|delegacj)/ }],
    kategorie: { transport: 3 },
    // #177: bez zmian – czas do Balic komunikacją to jedyna warstwa o lotnisku.
    wskazniki: { lotnisko_czas_min: 4 },
  },
  // Tylko z reguł – po stronie JEV pokrywa je poziom kategorii albo wybór profilu.
  {
    id: 'cisza',
    etykieta: 'cisza',
    wzorce: [{ re: /\b(cisz|cich|spokoj)/ }, { re: /\b(halas|glosn)/, negowalny: false }],
    kategorie: { spokoj: 4 },
    // #177: imprezy w dużych obiektach i stałe imprezy plenerowe w 500 m (3 + 3), bary i kluby
    // w 300 m (3) i miejsca noclegowe w 300 m (2, ruch turystyczny). Dwie ostatnie są neutralne –
    // „cisza” nadaje im „mniej = lepiej”. Nocne światło (VIIRS) to nie hałas – bez niego.
    wskazniki: {
      halas_ldwn: 4,
      imprezy_obiekty_dni_500m_2025_26: 3,
      imprezy_stale_wpisy_500m_2026: 3,
      zycie_nocne_300m: 3,
      noclegi_lozka_300m: 2,
    },
    kierunki: { zycie_nocne_300m: 'mniej-lepiej', noclegi_lozka_300m: 'mniej-lepiej' },
  },
  {
    id: 'sklepy',
    etykieta: 'sklepy pod ręką',
    wzorce: [{ re: /\b(sklep|zakup|uslug|wszystko blisko|wszedzie blisko|pieszo|na piechote)/ }],
    kategorie: { codziennosc: 4 },
    // #177: odległość do gastronomii (2) zamiast samego 0/1 w 1,2 km (prawie wszędzie 1);
    // targowisko i paczkomat (2 + 2) to też zakupy na piechotę. Poczta w 1,2 km zostaje.
    wskazniki: {
      sklep_odleglosc: 4,
      gastronomia_odleglosc: 2,
      targowisko_odleglosc: 2,
      paczkomat_odleglosc: 2,
      poczta_1200m: 2,
    },
  },
  {
    id: 'bezpieczenstwo',
    etykieta: 'bezpieczeństwo',
    wzorce: [{ re: /\b(bezpieczn|powodz|zalan|zalew|wylew|podtopi|ryzyk)/ }],
    kategorie: { bezpieczenstwo: 4 },
    // #177: ryzyka w punkcie adresu – osuwisko (3), zakład Seveso (2). Latarnie z OSM (2): to
    // „bezpiecznie wieczorem”, choć mapa latarni jest niepełna. Policja (1): dostępność, nie
    // przestępczość. Bez przestępstw i wykrywalności na powiat: jedna liczba dla całego
    // Krakowa – opis warstwy mówi wprost, że to informacja, nie ocena adresu.
    wskazniki: {
      powodz_10proc: 4,
      teren_osuwiskowy: 3,
      seveso_odleglosc: 2,
      oswietlenie_100m: 2,
      policja_odleglosc: 1,
    },
  },
  {
    id: 'inwestycja',
    etykieta: 'inwestycja',
    wzorce: [
      { re: /\b(inwest|na wynajem|pod wynajem|zysk|lokat|zarobi|wzrost cen|wartosc nieruchom)/ },
    ],
    persona: 'inwestor',
    kategorie: { spolecznosc: 4 },
    // #177: bez zmian. Kierunku pozwoleń nie nadajemy: Inwestor ma „więcej = lepiej” w profilu,
    // a Rodzina „mniej = lepiej” (budowa obok) – o tym rozstrzyga profil, nie potrzeba.
    wskazniki: { inwestycje_500m: 4, bo_projekty_1km: 3 },
  },
  {
    id: 'singiel',
    etykieta: 'mieszkam sam',
    wzorce: [
      {
        re: /\b(singiel|singielk|student|studentk|studiuj|mieszkam sam|sam mieszkam|sama mieszkam)/,
      },
    ],
    persona: 'singiel',
    kategorie: { transport: 3, codziennosc: 3 },
    // Wagi niesie profil Singiel (#177: bez zmian).
    wskazniki: {},
  },
  {
    id: 'koszty',
    etykieta: 'niskie opłaty',
    wzorce: [
      { re: /\b(tanio|tani[aey]?\b|koszt|oplat|podat|smieci|oszczed|budzet|niski[ce]h? rachunk)/ },
    ],
    kategorie: {},
    wskazniki: { gmina_koszty_stale_rok: 4 },
  },
  {
    id: 'kolej',
    etykieta: 'pociąg',
    wzorce: [{ re: /\b(pociag|kolej|skm|dojezdzam pociagiem|stacj[aiey] kolej)/ }],
    kategorie: { transport: 3 },
    wskazniki: { kolej_punktualnosc: 4 },
  },
  {
    id: 'sasiedzi',
    etykieta: 'aktywni sąsiedzi',
    wzorce: [
      { re: /\b(sasiad|sasiedz|spolecznosc|lokaln[aey] spolecz|aktywn[iy]ch? mieszkanc|obywatel)/ },
    ],
    kategorie: { spolecznosc: 3 },
    wskazniki: { frekwencja_samorzad_2024: 3 },
  },
  // ── #183: sześć nowych potrzeb (id ze słownika zbioru nr 8) ──────────────────────────────
  // Na końcu tabeli: kolejność pytań do JEV dla starych potrzeb się nie zmienia, a przy dwóch
  // potrzebach z przeciwnym kierunkiem tej samej warstwy wygrywa wcześniejsza (`cisza` przed
  // `zycie_nocne`). Każda ma twierdzenie z kryteriami #163 o przyszłym mieszkańcu (#162).
  // Nachodzą na stare i tak zostaje: `auto` / `bez_samochodu` (wykluczają się, w tekście
  // rozstrzyga przeczenie), `wozek` / `zdrowie` (te same słowa w regułach), `student` /
  // `singiel` (to samo słowo „student”).
  {
    id: 'auto',
    etykieta: 'samochód',
    twierdzenie: 'Osoba na co dzień jeździ własnym samochodem.',
    kryteria: {
      prawda: {
        co: 'Ktoś, kto zamieszka w szukanym mieszkaniu, ma samochód i z niego korzysta: dojeżdża autem, wozi nim dzieci albo szuka miejsca do parkowania lub garażu.',
        przyklady: [
          'Do pracy w Skawinie jeżdżę autem, pod blokiem musi się dać zaparkować.',
          'Mamy dwa samochody, garaż albo miejsce postojowe to podstawa.',
        ],
      },
      falsz: {
        co: 'Nikt, kto tam zamieszka, nie ma samochodu albo nim na co dzień nie jeździ (auto stoi, a dojeżdża rowerem lub komunikacją, o parkowaniu nie pisze); auto było kiedyś albo ma je ktoś, kto tam nie zamieszka.',
        przyklady: ['Samochód sprzedałem, przesiadam się na tramwaj.'],
      },
    },
    wzorce: [
      {
        // „parkow” bez dalszej końcówki to też „parków” (park) – stąd pełne formy parkowania.
        // Przeczenie PO słowie („auta nie mam”, „na auto mnie nie stać”) gasi lookahead.
        re: /\b((?<!stac mnie na )(samochod\w*|auto|autem|auta|autko)\b(?! (nie|mnie nie|juz nie|sprzedal))|parking|parkowan|parkowac|zaparkow|miejsc\w* postojow|garaz)/,
      },
    ],
    kategorie: { transport: 3 },
    // Dojazd drogą utwardzoną (3) i mało dróg gruntowych w 300 m (2): auto pod dom bez błota.
    // Poza strefą płatnego parkowania (1, neutralna – z kierunkiem „0 = lepiej”): w SPP postój
    // płatny (abonament mieszkańca) i miejsc mało; tylko Kraków, 14% adresów w strefie.
    // Ładowarka EV (1): dotyczy tylko aut elektrycznych. Bez P+R (opis warstwy: parking dla
    // dojeżdżających spoza miasta) i bez SCT (77% adresów Krakowa w strefie, wjazd zależy od
    // pojazdu, którego nie znamy). Warstwy dojazdu do głównej drogi nie ma.
    wskazniki: {
      dojazd_utwardzony: 3,
      drogi_gruntowe_300m: 2,
      spp_podstrefa: 1,
      ladowarka_ev_odleglosc: 1,
    },
    kierunki: { spp_podstrefa: 'mniej-lepiej' },
  },
  {
    id: 'wozek',
    etykieta: 'wózek, bez barier',
    twierdzenie: 'Osoba porusza się na wózku albo ma ograniczoną sprawność ruchową.',
    kryteria: {
      prawda: {
        co: 'Ktoś, kto zamieszka w szukanym mieszkaniu, jeździ na wózku inwalidzkim, chodzi o kulach, o lasce albo z balkonikiem albo ma trudność z chodzeniem i potrzebuje dróg bez barier.',
        przyklady: [
          'Mąż jeździ na wózku, wysokie krawężniki to dla nas koniec spaceru.',
          'Po operacji biodra chodzę o kulach i daleko nie dojdę.',
        ],
      },
      falsz: {
        co: 'Wózek dziecięcy albo na zakupy; niepełnosprawność kogoś, kto tam nie zamieszka; dawna kontuzja, która już minęła.',
        przyklady: ['Spacerujemy z wózkiem, przyda się park dla małego.'],
      },
    },
    wzorce: [
      {
        // Wózek dziecięcy („z wózkiem”, „wózek z dzieckiem”, „spacerowy”) to nie bariera ruchowa;
        // osoba na wózku pisze „na wózku” albo „wózek inwalidzki”.
        re: /\b((?<!\bz )woz(ek|ka|ku|kiem|ki)\b(?! (dzieciec|spacerow|gleboki|z dzieck|z dziecm|dla dzieck|z malu|z cork|z syn|z wnuk|na zakupy))|inwalidz|niepelnospraw|o kulach|balkonik|chodzik|o lasce|ograniczon\w* (mobilnosc|sprawnosc|ruchow)|trudno\w* (mi |jej |mu )?(chodzi|chodze)|krawezn)/,
      },
      // „bez barier” samo jest przeczeniem – „bez” go nie gasi.
      { re: /\b(bez barier|barier\w* architekton)/, negowalny: false },
    ],
    kategorie: { codziennosc: 4 },
    // Obniżone krawężniki (4) i przychodnia ze zgłoszonym podjazdem lub windą (4) służą wprost
    // osobie na wózku. Przystanek blisko (3), sklep (3) – krótkie dojścia. Dojazd utwardzony (3):
    // po gruncie wózek nie przejedzie. Ławki (2): odpoczynek przy chodzeniu o kulach. Warstwy
    // spadków terenu nie ma; OSM zna krawężniki i ławki nierówno.
    wskazniki: {
      obnizone_krawezniki_300m: 4,
      przychodnia_bez_barier_odleglosc: 4,
      przystanek_odleglosc: 3,
      sklep_odleglosc: 3,
      dojazd_utwardzony: 3,
      lawki_300m: 2,
    },
  },
  {
    id: 'praca_zdalna',
    etykieta: 'praca zdalna',
    twierdzenie: 'Osoba pracuje zdalnie z domu.',
    kryteria: {
      prawda: {
        co: 'Ktoś, kto zamieszka w szukanym mieszkaniu, pracuje z domu na stałe albo przez część tygodnia (praca zdalna, hybrydowa, home office, własna działalność w domu).',
        przyklady: ['Pracuję zdalnie, więc cały dzień siedzę w mieszkaniu.'],
      },
      falsz: {
        co: 'Osoba codziennie dojeżdża do biura, pracowała zdalnie tylko kiedyś albo tekst o pracy w domu nie mówi.',
        przyklady: ['Codziennie na ósmą jeżdżę do biura na Zabłociu.'],
      },
    },
    wzorce: [
      {
        // „hybryd” samo to też auto hybrydowe – tylko praca hybrydowa.
        // „kiedyś pracowałem zdalnie” – czas przeszły to nie praca zdalna.
        re: /\b((?<!pracowal\w* )zdaln|home office|homeoffice|remote|freelanc|prac\w* hybryd|hybrydow\w* (prac|tryb|model)|w hybrydzie|prac\w* z domu|prac\w* w domu|z domu prac\w*)/,
      },
    ],
    kategorie: { spokoj: 3 },
    // Cały dzień w domu: hałas za dnia (3), zieleń na przerwę (2 + 2), słońce w grudniu (2 – światło
    // w pokoju do pracy; tylko część adresów ma dane). Usługi w zasięgu spaceru: sklep (2),
    // gastronomia (2, kawiarnia) i paczkomat (2). „Mniej wagi na dojazd” się tu nie da – potrzeby
    // tylko podnoszą wagi (maksimum, #177).
    wskazniki: {
      halas_ldwn: 3,
      zielen_worldcover_100m: 2,
      zielen_udzial: 2,
      slonce_grudzien_h: 2,
      sklep_odleglosc: 2,
      gastronomia_odleglosc: 2,
      paczkomat_odleglosc: 2,
    },
  },
  {
    id: 'zycie_nocne',
    etykieta: 'życie nocne',
    twierdzenie: 'Osoba chce mieć blisko knajpy, bary albo kluby.',
    kryteria: {
      prawda: {
        co: 'Osoba, która tam zamieszka, lubi wychodzić wieczorem i chce mieć w pobliżu bary, puby, knajpy albo kluby.',
        przyklady: ['Lubię wyskoczyć wieczorem na piwo, fajnie mieć knajpy pod ręką.'],
      },
      falsz: {
        co: 'Osoba nie chce knajp ani nocnego hałasu w pobliżu, życie nocne jej nie interesuje albo było ważne tylko kiedyś; praca w knajpie to nie to samo.',
        przyklady: ['Bary pod oknem to dla mnie koszmar, chcę spokoju.'],
      },
    },
    wzorce: [
      {
        // Praca w knajpie („dorabiam w knajpie”) to nie życie nocne.
        re: /\b((?<!(pracuje|robie|dorabiam|pracowac) w )knajp|pub(y|ow|ach|ie)?\b|bar(y|ow|ach|ze)?\b|klub(y|ow|ach|ie)?\b(?! (sport|fitness|senior|malucha|dzieciec|pilkarsk))|zycie nocne|nocne zycie|zycia nocnego|zyciem nocnym|wyjsc\w* wieczor|na miasto)/,
      },
    ],
    kategorie: { codziennosc: 3 },
    // Bary, puby i kluby w 300 m (4, neutralna – „więcej = lepiej”); `cisza` daje jej kierunek
    // przeciwny i przy obu potrzebach wygrywa (wcześniej w tabeli): lokale nie pod oknem, a reszta
    // poniżej i tak ciągnie w żywą okolicę. Gastronomia (3), kultura (2) i czas do Rynku (3) –
    // tam jest życie nocne Krakowa i stamtąd się wraca.
    wskazniki: {
      zycie_nocne_300m: 4,
      gastronomia_odleglosc: 3,
      kultura_odleglosc: 2,
      rynek_czas_min: 3,
    },
    kierunki: { zycie_nocne_300m: 'wiecej-lepiej' },
  },
  {
    id: 'sport',
    etykieta: 'sport',
    twierdzenie: 'Osoba regularnie uprawia sport.',
    kryteria: {
      prawda: {
        co: 'Osoba, która tam zamieszka, regularnie biega, trenuje, chodzi na siłownię albo basen, gra w piłkę lub tenisa i chce to robić blisko domu.',
        przyklady: ['Biegam trzy razy w tygodniu, przydałyby się trasy w zieleni.'],
      },
      falsz: {
        co: 'Sport uprawia ktoś, kto tam nie zamieszka, osoba ćwiczyła tylko kiedyś albo jeździ rowerem jedynie do pracy (to dojazd, nie sport).',
        przyklady: ['Kiedyś grałem w piłkę, teraz już tylko oglądam.'],
      },
    },
    wzorce: [
      {
        re: /\b(sport|silowni|silownia|biegam|biegan|jogging|trening|trenuj|fitness|basen|plywa|crossfit|joga|jogi|tenis|kort|boisk|pilk\w* nozn|gram w pilke|wspinacz|rolki|rolkach)/,
      },
    ],
    kategorie: { codziennosc: 3 },
    // Obiekty sportowe ZIS (3; tylko Kraków, wykaz 181 obiektów, nie pełny spis), siłownia
    // plenerowa (3), zieleń do biegania (3 + 2), infrastruktura rowerowa (2) i kąpielisko
    // (1; tylko w sezonie, 8 miejsc na cały obszar).
    wskazniki: {
      sport_odleglosc: 3,
      silownia_plenerowa_odleglosc: 3,
      zielen_udzial: 3,
      zielen_worldcover_100m: 2,
      rower_infrastruktura_odleglosc: 2,
      kapielisko_odleglosc: 1,
    },
  },
  {
    id: 'student',
    etykieta: 'student',
    twierdzenie: 'Osoba studiuje.',
    kryteria: {
      prawda: {
        co: 'Osoba, która tam zamieszka, jest teraz studentem albo zaczyna studia (także gdy mieszkania szukają dla niej rodzice).',
        przyklady: ['Syn od października zaczyna studia na Politechnice, szukamy mu kawalerki.'],
      },
      falsz: {
        co: 'Osoba studiowała kiedyś i skończyła, wykłada na uczelni, studiuje ktoś, kto tam nie zamieszka, albo mieszkanie jest pod wynajem dla studentów.',
        przyklady: ['Kupuję kawalerkę pod wynajem dla studentów.'],
      },
    },
    wzorce: [
      {
        // „pod wynajem dla studentów”, „po studiach” – to nie student.
        re: /\b((?<!(dla|wynajmuje|wynajme|wynajac|wynajmowac) )student|studiuj|(?<!po )studiach|(?<!(skonczyl\w*|po) )studia\b|akademik)/,
      },
    ],
    // #183: na zbiorach 1–7 osoba, która sama studiuje, ma w złocie Singla 9 razy na 12
    // (pozostałe 3 – null, współlokatorzy), żadnego innego profilu. Reguły i tak dawały Singla
    // przez słowo „student” w potrzebie `singiel`.
    persona: 'singiel',
    kategorie: { transport: 3 },
    // Akademik (3, neutralny – z kierunkiem): warstwy uczelni nie ma, a domy studenckie stoją
    // przy kampusach (AGH, UJ, UEK, PK). Przystanek i kursy w szczycie (3 + 3) – tani dojazd na
    // zajęcia, czas do Rynku (2) – większość uczelni w centrum. Mediana ceny m² (2): sprzedaż,
    // nie najem, tylko Kraków – przybliżenie kosztu, nic lepszego nie ma.
    wskazniki: {
      akademik_odleglosc: 3,
      przystanek_odleglosc: 3,
      kursy_szczyt_h: 3,
      rynek_czas_min: 2,
      cena_m2_mediana: 2,
    },
    kierunki: { akademik_odleglosc: 'mniej-lepiej' },
  },
]

/**
 * Gdy kilka potrzeb sugeruje profil, wygrywa pierwszy z tej listy (reguły i #155 – profil
 * z mocnych potrzeb). Uzasadnienie kolejności:
 * - Inwestor pierwszy: kupujący pod wynajem sam nie zamieszka, więc jego dzieci czy wiek nie
 *   ustawiają wag mieszkania („pod wynajem dla studentów” to też nie Singiel).
 * - Senior przed Rodziną: starsza osoba często pisze o wnukach albo dorosłych dzieciach,
 *   a senior z małymi dziećmi w domu to rzadkość. Gdy do rodziny z dziećmi wprowadza się
 *   starszy rodzic, potrzeby seniora (przychodnia, apteka, krawężniki) i tak zostają.
 * - Singiel ostatni: najsłabszy sygnał, wyklucza się z dziećmi i seniorem.
 */
export const PIERWSZENSTWO_PERSON: readonly PersonaId[] = [
  'inwestor',
  'senior',
  'rodzina',
  'singiel',
]

// ── Siła potrzeby i potrzeby „na nie” (#182) ────────────────────────────────────────────────

/** Siła potrzeby – słownik zbioru nr 8: 1 = „byłoby miło”, 2 = „wyraźnie ważne”, 3 = warunek. */
export type Sila = 1 | 2 | 3
export const OPISY_SILY: Readonly<Record<Sila, string>> = {
  1: 'byłoby miło',
  2: 'wyraźnie ważne',
  3: 'bardzo ważne',
}

/**
 * Waga warstwy potrzeby przy danej sile: 3 = waga z tabeli POTRZEBY, 2 = o 1 mniej, 1 = o 2
 * mniej, najmniej 1 (potrzeba rozpoznana zawsze coś waży). Brak siły (reguły bez słów
 * siły, JEV bez odpowiedzi) = waga z tabeli, czyli dokładnie jak przed #182 – tabela była
 * strojona w #177 na potrzebach bez siły.
 */
export function wagaZSily(wagaTabeli: number, sila: Sila | undefined): number {
  if (sila === undefined || wagaTabeli <= 0) return wagaTabeli
  return Math.max(1, wagaTabeli - (3 - sila))
}

export interface PotrzebaNaNie {
  /** Id ze słownika zbioru nr 8 – nie zmieniaj (etykiety złota). */
  id: string
  /** Do chipa „nie chcę: …”. */
  etykieta: string
  /** Twierdzenie noul dla JEV z kryteriami prawda/fałsz (jak #163). */
  twierdzenie: string
  kryteria: KryteriaTakNie
  /** Słowa rzeczy niechcianej (ASCII); liczą się tylko po słowie odmowy (`ODMOWA`). */
  slowa: RegExp
  /**
   * Warstwy, które „nie chcę” przejmuje: waga i kierunek. Test pilnuje, że każda istnieje
   * w `public/dane/wskazniki` i liczy się w silniku (nie kontekst, kierunek nie neutralny).
   */
  warstwy: Readonly<Record<string, { waga: number; kierunek: KierunekOceny }>>
}

/**
 * Potrzeby „na nie”: jawne „nie chcę X w pobliżu”. Bez nowych warstw – każda przejmuje
 * istniejące warstwy i ustawia im kierunek, który silnik już zna (`kierunki`, jak suwak
 * kierunku w panelu wag). Brak warstwy „duża ulica”: mapa hałasu (LDWN) to głównie hałas
 * drogowy i tramwajowy, a NO2 to spaliny. „Szkoła obok” dostaje „dalej = lepiej”, bo silnik
 * nie ma kierunku „optimum” – waga 2, żeby szkoła 2 km dalej nie wygrywała z resztą.
 */
export const NA_NIE: readonly PotrzebaNaNie[] = [
  {
    id: 'zycie_nocne_obok',
    etykieta: 'knajpy i kluby pod oknem',
    twierdzenie: 'Osoba nie chce mieszkać blisko barów, pubów, klubów ani nocnego hałasu z lokali.',
    kryteria: {
      prawda: {
        co: 'Tekst mówi, że osoba nie chce knajp, barów, klubów albo imprezowego hałasu nocą pod oknem – także jako „byle nie nad pubem”.',
        przyklady: ['Tylko nie nad pubem, chcę spać w nocy.', 'Żadnych klubów pod oknem.'],
      },
      falsz: {
        co: 'Osoba lubi życie nocne i chce mieć knajpy blisko albo tekst w ogóle nie mówi o lokalach.',
        przyklady: ['Lubię wyjść wieczorem do baru blisko domu.'],
      },
    },
    slowa:
      /\b(knajp|bar\b|barow|barami|pub\b|puby|pubow|pubem|klub|dyskotek|imprezowni|lokal\w* nocn|nocn\w* (zycie|halas))/,
    warstwy: {
      zycie_nocne_300m: { waga: 4, kierunek: 'mniej-lepiej' },
      gastronomia_odleglosc: { waga: 1, kierunek: 'wiecej-lepiej' },
    },
  },
  {
    id: 'turysci',
    etykieta: 'turyści i najem na doby',
    twierdzenie: 'Osobie przeszkadzają turyści albo mieszkania wynajmowane turystom na doby.',
    kryteria: {
      prawda: {
        co: 'Tekst mówi, że przeszkadzają turyści, walizki, hostele, hotele albo najem krótkoterminowy (Airbnb) w okolicy lub w bloku.',
        przyklady: ['Byle nie Stare Miasto, mam dość turystów z walizkami.'],
      },
      falsz: {
        co: 'Tekst nie mówi o turystach ani o najmie na doby. Sam zakup mieszkania pod wynajem to nie to.',
      },
    },
    slowa: /\b(turyst|airbnb|hostel|walizk|najem krotkoterminow|najm\w* krotkoterminow|na doby)/,
    warstwy: { noclegi_lozka_300m: { waga: 4, kierunek: 'mniej-lepiej' } },
  },
  {
    id: 'szkola_obok',
    etykieta: 'szkoła tuż obok',
    twierdzenie:
      'Osoba nie chce mieszkać tuż obok szkoły albo placu zabaw, bo przeszkadza hałas dzieci.',
    kryteria: {
      prawda: {
        co: 'Tekst mówi, że osoba nie chce szkoły, boiska szkolnego albo placu zabaw tuż pod oknem – także gdy chce mieć szkołę w zasięgu spaceru, ale nie za ścianą.',
        przyklady: ['Szkoła może być w okolicy, ale nie pod samym oknem.'],
      },
      falsz: {
        co: 'Osoba chce mieć szkołę albo plac zabaw blisko i nic nie mówi o hałasie dzieci, albo tekst w ogóle nie mówi o szkole.',
        przyklady: ['Szukamy blisko dobrej podstawówki.'],
      },
    },
    slowa: /\b(szkol|boisk|plac\w* zabaw|halas\w* dzieci|krzyk\w* dzieci)/,
    warstwy: {
      szkola_odleglosc: { waga: 2, kierunek: 'wiecej-lepiej' },
      plac_zabaw_odleglosc: { waga: 1, kierunek: 'wiecej-lepiej' },
    },
  },
  {
    id: 'duza_droga',
    etykieta: 'ruchliwa ulica',
    twierdzenie: 'Osoba nie chce mieszkać przy ruchliwej ulicy, trasie ani dużej drodze.',
    kryteria: {
      prawda: {
        co: 'Tekst mówi, że osoba nie chce ruchliwej ulicy, trasy, obwodnicy, korków albo hałasu samochodów i tramwajów pod oknem.',
        przyklady: ['Byle nie przy głównej ulicy, nie zniosę ruchu pod oknem.'],
      },
      falsz: {
        co: 'Tekst nie wspomina ulic, ruchu ani samochodów pod oknem; sama ogólna chęć ciszy to za mało.',
      },
    },
    slowa:
      /\b(ruchliw|ulic|tras[aeyi]?\b|obwodnic|aleji|alei|autostrad|droga\b|drogi\b|droga szybk|korki|korkow|samochod\w* pod oknem)/,
    warstwy: {
      halas_ldwn: { waga: 4, kierunek: 'mniej-lepiej' },
      no2_srednia: { waga: 2, kierunek: 'mniej-lepiej' },
    },
  },
  {
    id: 'przemysl',
    etykieta: 'przemysł i kominy',
    twierdzenie: 'Osoba nie chce mieszkać blisko zakładów przemysłowych, fabryk ani kominów.',
    kryteria: {
      prawda: {
        co: 'Tekst mówi, że osoba nie chce w pobliżu fabryki, huty, elektrociepłowni, spalarni, zakładu chemicznego albo terenów przemysłowych.',
        przyklady: ['Z dala od huty i kominów, proszę.'],
      },
      falsz: {
        co: 'Tekst nie mówi o zakładach ani przemyśle; sam smog z pieców domowych to nie to.',
      },
    },
    slowa: /\b(przemysl|fabryk|zaklad|hut[aeyi]?\b|kombinat|spalarni|elektrocieplowni|komin|chemi)/,
    warstwy: {
      emitent_odleglosc: { waga: 4, kierunek: 'wiecej-lepiej' },
      seveso_odleglosc: { waga: 3, kierunek: 'wiecej-lepiej' },
    },
  },
  {
    id: 'imprezy',
    etykieta: 'stadiony i imprezy masowe',
    twierdzenie:
      'Osoba nie chce mieszkać blisko stadionu, hali widowiskowej ani miejsc imprez masowych.',
    kryteria: {
      prawda: {
        co: 'Tekst mówi, że osoba nie chce w pobliżu stadionu, areny, hali koncertowej, kibiców albo koncertów i imprez masowych.',
        przyklady: ['Nie przy stadionie, nie chcę kibiców co weekend.'],
      },
      falsz: {
        co: 'Tekst nie mówi o stadionach, koncertach ani imprezach masowych; zwykłe knajpy to nie to.',
      },
    },
    slowa:
      /\b(stadion|aren[aey]?\b|hal[aiy] (widowisk|koncert|sportow)|kibic|koncert|impre[zs]\w* masow|mecz)/,
    warstwy: {
      imprezy_obiekty_dni_500m_2025_26: { waga: 4, kierunek: 'mniej-lepiej' },
      imprezy_stale_wpisy_500m_2026: { waga: 3, kierunek: 'mniej-lepiej' },
    },
  },
  {
    id: 'budowy',
    etykieta: 'budowy wokół',
    twierdzenie: 'Osoba nie chce mieszkać tam, gdzie wokół dużo się buduje.',
    kryteria: {
      prawda: {
        co: 'Tekst mówi, że osoba nie chce budów, dźwigów, nowych bloków stawianych za oknem albo placu budowy w okolicy.',
        przyklady: ['Mam dość budowy za oknem, chcę gotowe osiedle.'],
      },
      falsz: {
        co: 'Tekst nie mówi o budowach albo cieszy się z nowych inwestycji w okolicy (np. kupuje pod wynajem).',
      },
    },
    slowa: /\b(budow|buduj|dzwig|plac\w* budowy|nowe bloki|deweloper)/,
    warstwy: { inwestycje_500m: { waga: 4, kierunek: 'mniej-lepiej' } },
  },
]

/**
 * Siła z JEV: jedno pytanie score na grupę potrzeb (3 pytania zamiast osobnego na każdą
 * potrzebę). Siła potrzeby = zaokrąglona ocena jej grupy (1–3); ocena 0 („tekst o tym nie
 * mówi”) przy rozpoznanej potrzebie = brak siły (waga z tabeli). Bez progu pewności – próg
 * 0,5 pogorszył trafność. Wybór z próby na żywo przy pełnym żądaniu (31 pytań, 2 przebiegi,
 * 24 zdania celowane): grupy 73% trafnych siły (śr. błąd 0,31), jedno pytanie o całość 62%,
 * pasma noul twierdzeń potrzeb 58%, stała 2 38% (WYNIKI.md, „Siła i «nie chcę» (#182)”).
 * Potrzeba spoza grup nie ma siły z JEV (waga z tabeli): reguły-tylko i z #183 praca zdalna,
 * życie nocne, sport – żadne z 3 pytań ich nie obejmuje (wózek, auto, student – tak).
 */
export const SKALA_SILY = [
  'Tekst nie mówi o takich potrzebach',
  'Byłoby miło – wspomniane lekko, bez nacisku',
  'Wyraźnie ważne',
  'Bardzo ważne – warunek konieczny',
] as const
export const GRUPY_SILY: readonly { id: string; polecenie: string; potrzeby: readonly string[] }[] =
  [
    {
      id: 's_dom',
      polecenie:
        'Jak ważne są dla osoby dzieci, zdrowie, lekarz, pies i sprawy załatwiane pieszo blisko domu?',
      potrzeby: ['dzieci', 'pies', 'senior', 'zdrowie', 'sklepy', 'wozek'],
    },
    {
      id: 's_otoczenie',
      polecenie:
        'Jak ważne są dla osoby zieleń, park, czyste powietrze, cisza i bezpieczeństwo okolicy?',
      potrzeby: ['zielen', 'powietrze', 'cisza', 'bezpieczenstwo'],
    },
    {
      id: 's_dojazd',
      polecenie:
        'Jak ważne są dla osoby dojazdy: komunikacja, rower, praca w centrum, pociąg, lotnisko?',
      potrzeby: ['rower', 'bez_samochodu', 'praca_centrum', 'lotnisko', 'kolej', 'auto', 'student'],
    },
  ]

/** Od tej oceny twierdzenia „nie chcę” (noul) JEV uznaje potrzebę „na nie”. */
export const PROG_NA_NIE = 0.6

/**
 * Słowo odmowy przed rzeczą niechcianą (reguły zapasowe): najwyżej 5 słów przed nią.
 * „Nie chcę baru pod oknem”, „byle nie przy stadionie”, „z dala od huty”, „mam dość turystów”.
 */
const ODMOWA =
  /\b(nie chce\w*|nie chcial\w*|byle nie|byleby nie|tylko nie|nie moze byc|bez|z dala od|daleko od|unik\w*|przeszkadza\w*|mam dosc|dosc mam|nie znosz\w*|nie lubi\w*|zadn\w*|nie przy|nie obok|nie nad|nie pod)\b(\s+\S+){0,5}\s*$/

/** „Nie chcę mieć daleko do szkoły” to potrzeba na tak, nie odmowa. */
const NIE_ODMOWA = /\b(daleko|dlugo|dojazd\w*|dojezdz\w*|brak\w*|brakowa\w*)\b/

/** Fragmenty „odmowa … rzecz niechciana” w tekście: [początek odmowy, koniec rzeczy). */
function odmowy(tekst: string, slowa: RegExp): [number, number][] {
  const wynik: [number, number][] = []
  for (const m of tekst.matchAll(new RegExp(slowa.source, 'g'))) {
    const o = ODMOWA.exec(tekst.slice(0, m.index))
    if (o && !NIE_ODMOWA.test(o[0].slice((o[1] ?? '').length)))
      wynik.push([o.index, (m.index ?? 0) + m[0].length])
  }
  return wynik
}
const odmowaPrzed = (tekst: string, slowa: RegExp) => odmowy(tekst, slowa).length > 0
/** Tekst z wyciętymi fragmentami odmowy (spacje zamiast nich). */
function bezOdmowy(tekst: string, slowa: RegExp): string {
  let t = tekst
  for (const [a, b] of odmowy(tekst, slowa)) t = t.slice(0, a) + ' '.repeat(b - a) + t.slice(b)
  return t
}

/** Reguły: siła z jawnych słów w całym tekście (jedna dla wszystkich potrzeb); brak = undefined. */
const SILA_3 =
  /\b(koniecznie|musi\w*|warunek|bardzo wazn\w*|najwazniejsz\w*|absolutnie|niezbedn\w*|kluczow\w*)/
const SILA_1 =
  /\b(byloby milo|byloby fajnie|fajnie by\w*|mile widzian\w*|opcjonaln\w*|niekoniecznie|przydal\w* by|nie musi|ewentualnie)/
export function silaZRegul(tekst: string): Sila | undefined {
  const t = normalizuj(tekst)
  if (SILA_3.test(t)) return 3
  if (SILA_1.test(t)) return 1
  return undefined
}

/**
 * #155: opisy opcji profilu dla JEV mówią, KIM jest osoba, a nie, co ceni. Opisy z UI
 * („Komunikacja i sklepy pod ręką”) pasowały do każdego, kto chce mieć blisko tramwaj, więc
 * JEV wybierał Singla dla par i rodzin. Nazwy i opisy w UI (`persony.ts`) się nie zmieniają.
 */
export const OPISY_PROFILI_JEV: Readonly<Partial<Record<Exclude<PersonaId, 'od-zera'>, string>>> = {
  rodzina: 'Rodzic z dziećmi w domu (także gdy dziecko jest w drodze)',
  singiel: 'Osoba mieszkająca sama, zwykle młoda, pracująca albo studiująca',
  senior: 'Osoba na emeryturze albo w starszym wieku',
  inwestor: 'Kupujący pod wynajem albo jako lokatę, sam tam nie zamieszka',
}
/**
 * Profile do wyboru przez JEV – te z opisem powyżej (bez „Od zera” i nowszych person,
 * których nie ma w zbiorach pomiarowych), plus jawne „nie wiadomo”.
 */
const PROFILE_JEV = PERSONY.filter((p) => p.id in OPISY_PROFILI_JEV)
const PROFIL_NIEZNANY = 'nieznany'
export const OPIS_PROFILU_NIEZNANEGO = 'Nie da się tego określić z tekstu'

export interface PozycjaZrozumienia {
  /** #182: `na_nie` = potrzeba „nie chcę X w pobliżu”. */
  rodzaj: 'profil' | 'potrzeba' | 'kategoria' | 'na_nie'
  etykieta: string
  /**
   * Profil i potrzeba: pewność JEV w % (null = z reguł, bez liczby).
   * Kategoria: ważność 0–100 % (waga 0–4 × 25).
   */
  procent: number | null
  /** Kategoria: słowny poziom ważności, np. „Bardzo ważne”. Potrzeba: siła (#182). */
  opis?: string
}

export interface Zrozumienie {
  /** null = profil nierozpoznany, zostaje bieżący. */
  persona: PersonaId | null
  /** Poziom 0–4 dla kategorii, o których coś wiemy (≥ 3 podnosi wagi, ≤ 1 obniża). */
  kategorie: Partial<Record<KategoriaOceniana, number>>
  /** Minimalne wagi wskaźników z rozpoznanych potrzeb. */
  wskazniki: Record<string, number>
  /** Id rozpoznanych potrzeb w kolejności POTRZEBY. */
  potrzeby: string[]
  zrozumialem: PozycjaZrozumienia[]
  /** #182: siła rozpoznanych potrzeb (id → 1–3); brak klucza = waga z tabeli, jak przed #182. */
  sily?: Readonly<Record<string, Sila>>
  /** #182: id rozpoznanych potrzeb „na nie” (NA_NIE), w kolejności tabeli. */
  nieChce?: readonly string[]
}

export const PUSTE_ZROZUMIENIE: Zrozumienie = {
  persona: null,
  kategorie: {},
  wskazniki: {},
  potrzeby: [],
  zrozumialem: [],
}

export function nicNieZrozumiano(z: Zrozumienie): boolean {
  return (
    z.persona === null &&
    z.potrzeby.length === 0 &&
    Object.keys(z.kategorie).length === 0 &&
    (z.nieChce ?? []).length === 0
  )
}

// ── Zapytanie do JEV ──────────────────────────────────────────────────────────────────────

export const ID_PROFILU = 'profil'
export const idKategorii = (k: KategoriaOceniana) => `kat_${k}`
export const idPotrzeby = (p: Potrzeba) => `p_${p.id}`
/** #182: pytanie noul o potrzebę „na nie”. */
export const idNaNie = (n: PotrzebaNaNie) => `n_${n.id}`

/**
 * Zapytanie w stałej kolejności: profil, 3 kategorie, potrzeby z twierdzeniem, potrzeby
 * „na nie” i 3 pytania o siłę (#182), bramka.
 */
export function zapytanieOpiszSiebie(tekst: string): ZapytanieJev {
  const pytania: ZapytanieJev['pytania'] = {}
  pytania[ID_PROFILU] = wybor('Który profil najlepiej pasuje do osoby szukającej mieszkania?', {
    ...Object.fromEntries(
      PROFILE_JEV.map((p) => [p.id, OPISY_PROFILI_JEV[p.id as keyof typeof OPISY_PROFILI_JEV]]),
    ),
    [PROFIL_NIEZNANY]: OPIS_PROFILU_NIEZNANEGO,
  })
  for (const k of KATEGORIE_JEV) {
    pytania[idKategorii(k)] = ocena(
      `Jak ważna jest dla tej osoby kategoria „${ETYKIETY_KATEGORII[k]}” (${OPISY_KATEGORII[k]})? Jeśli tekst o tym nie mówi, wybierz „${POZIOMY_WAZNOSCI[POZIOM_NEUTRALNY]}”.`,
      POZIOMY_WAZNOSCI,
    )
  }
  for (const p of POTRZEBY)
    if (p.twierdzenie) pytania[idPotrzeby(p)] = takNie(p.twierdzenie, p.kryteria)
  for (const n of NA_NIE) pytania[idNaNie(n)] = takNie(n.twierdzenie, n.kryteria)
  for (const g of GRUPY_SILY) pytania[g.id] = ocena(g.polecenie, SKALA_SILY)
  for (const b of BRAMKA) pytania[b.id] = takNie(b.twierdzenie, b.kryteria)
  return { stan: tekst, pytania }
}

// ── Wspólne składanie wyniku ──────────────────────────────────────────────────────────────

function personaZPotrzeb(ids: readonly string[]): PersonaId | null {
  const sugerowane = new Set(
    POTRZEBY.filter((p) => ids.includes(p.id) && p.persona).map((p) => p.persona),
  )
  return PIERWSZENSTWO_PERSON.find((id) => sugerowane.has(id)) ?? null
}

function zloz(
  persona: PersonaId | null,
  pewnoscPersony: number | null,
  potrzeby: readonly { id: string; procent: number | null; sila?: Sila }[],
  poziomyJev: Partial<Record<KategoriaOceniana, number>>,
  nieChce: readonly { id: string; procent: number | null }[] = [],
): Zrozumienie {
  const kategorie: Partial<Record<KategoriaOceniana, number>> = {}
  const wskazniki: Record<string, number> = {}
  const sily: Record<string, Sila> = {}
  for (const { id, sila } of potrzeby) {
    const p = POTRZEBY.find((x) => x.id === id)
    if (!p) continue
    if (sila !== undefined) sily[id] = sila
    for (const [k, w] of Object.entries(p.kategorie) as [KategoriaOceniana, number][])
      kategorie[k] = Math.max(kategorie[k] ?? 0, w)
    // #182: waga warstwy potrzeby zależy od jej siły (3 = tabela, 2 = −1, 1 = −2, min. 1).
    for (const [id, w] of Object.entries(p.wskazniki))
      wskazniki[id] = Math.max(wskazniki[id] ?? 0, wagaZSily(w, sila))
  }
  // Jawny poziom od JEV wygrywa z tym, co wynika z potrzeb – także „mało ważne”.
  Object.assign(kategorie, poziomyJev)

  const zrozumialem: PozycjaZrozumienia[] = []
  const p = znajdzPersone(persona)
  if (p) zrozumialem.push({ rodzaj: 'profil', etykieta: p.nazwa, procent: pewnoscPersony })
  for (const { id, procent, sila } of potrzeby) {
    const potrzeba = POTRZEBY.find((x) => x.id === id)
    if (potrzeba)
      zrozumialem.push({
        rodzaj: 'potrzeba',
        etykieta: potrzeba.etykieta,
        procent,
        ...(sila === undefined ? {} : { opis: OPISY_SILY[sila] }),
      })
  }
  const naNie = NA_NIE.filter((n) => nieChce.some((x) => x.id === n.id))
  for (const n of naNie)
    zrozumialem.push({
      rodzaj: 'na_nie',
      etykieta: n.etykieta,
      procent: nieChce.find((x) => x.id === n.id)?.procent ?? null,
    })
  for (const k of KATEGORIE_OCENIANE) {
    const poziom = kategorie[k]
    if (poziom === undefined) continue
    zrozumialem.push({
      rodzaj: 'kategoria',
      etykieta: ETYKIETY_KATEGORII[k],
      procent: poziom * 25,
      opis: POZIOMY_WAZNOSCI[poziom],
    })
  }
  return {
    persona,
    kategorie,
    wskazniki,
    potrzeby: potrzeby.map((x) => x.id),
    zrozumialem,
    ...(Object.keys(sily).length ? { sily } : {}),
    ...(naNie.length ? { nieChce: naNie.map((n) => n.id) } : {}),
  }
}

// ── Odpowiedzi JEV → zrozumienie ──────────────────────────────────────────────────────────

const procent = (x: number) => Math.round(Math.min(Math.max(x, 0), 1) * 100)
const pewny = (pewnosc: number | null) => pewnosc === null || pewnosc >= PROG_PEWNOSCI

/** Progi profilu – parametr tylko dla testów i przeliczeń zapisanych przebiegów (WYNIKI.md). */
export interface ProgiProfilu {
  profil: number
  mocnaPotrzeba: number
}
export const PROGI_PROFILU: ProgiProfilu = {
  profil: PROG_PROFILU,
  mocnaPotrzeba: PROG_MOCNEJ_POTRZEBY,
}

/**
 * #155: profil pod progiem pewności – deterministycznie, tylko z MOCNYCH potrzeb:
 * - `senior` z noul ≥ PROG_MOCNEJ_POTRZEBY → Senior, `dzieci` z noul ≥ PROG_MOCNEJ_POTRZEBY → Rodzina;
 * - `inwestycja` i `singiel` nie mają twierdzenia dla JEV (pokrywa je wybór profilu), więc mocny
 *   sygnał to jawne słowa z reguł („pod wynajem”, „inwestycja”, „mieszkam sama”, „studiuję”),
 *   z tą samą obsługą przeczeń co w `zRegul` – i to tylko wtedy, gdy JEV (pod progiem) wskazał
 *   ten sam profil. Same słowa to słabość reguł (przeczenia, cudza sytuacja, #18).
 * Przy kilku naraz rozstrzyga PIERWSZENSTWO_PERSON. Bez mocnej potrzeby – null (profil bez
 * zmian). Słabsze potrzeby (0,6–0,9) już profilu nie ustawiają – przed #155 ustawiały od 0,6.
 */
export function profilZMocnychPotrzeb(
  odpowiedzi: Record<string, OdpowiedzJev | null>,
  tekst: string,
  progi: ProgiProfilu = PROGI_PROFILU,
): PersonaId | null {
  const t = normalizuj(tekst)
  const profil = odpowiedzi[ID_PROFILU]
  const wyborJev = profil?.typ === 'choice' ? profil.wybor : null
  const mocne: string[] = []
  for (const p of POTRZEBY) {
    if (!p.persona) continue
    if (p.twierdzenie) {
      const o = odpowiedzi[idPotrzeby(p)]
      if (o?.typ === 'noul' && o.noul >= progi.mocnaPotrzeba) mocne.push(p.id)
    } else if (t && wyborJev === p.persona && p.wzorce.some((w) => wystepuje(t, w)))
      mocne.push(p.id)
  }
  return personaZPotrzeb(mocne)
}

/**
 * #153: bramka zamknięta = któreś twierdzenie BRAMKA ma noul ≥ swojego progu (#162: `prog`).
 * #162: `nikt_nie_szuka` nie zamyka bramki, gdy JEV wybrał profil Inwestor. Kupujący pod
 * wynajem nie ma mieszkańca, a to prawdziwe szukanie: pierwsza wersja twierdzenia dała mu 0,54
 * mimo wykluczenia (obecna 0,04 – to tylko zabezpieczenie, bez kosztu wywołań).
 */
export function bramkaZamknieta(odpowiedzi: Record<string, OdpowiedzJev | null>): boolean {
  const profil = odpowiedzi[ID_PROFILU]
  const inwestor = profil?.typ === 'choice' && profil.wybor === 'inwestor'
  return BRAMKA.some((b) => {
    if (inwestor && b.id === 'nikt_nie_szuka') return false
    const o = odpowiedzi[b.id]
    // Brak odpowiedzi = brak dowodu cudzej sytuacji – bramka zostaje otwarta.
    return o?.typ === 'noul' && o.noul >= b.prog
  })
}

/**
 * Odpowiedzi JEV → zrozumienie. null (→ reguły), gdy nic nie przeszło progu pewności.
 * Poziom kategorii liczy się tylko, gdy JEV jest pewny i odszedł od środka skali.
 *
 * #147: gdy tekst nie opisuje prawdziwego szukania – sama opinia albo ciekawość, sytuacja
 * wyobrażona albo dawna (bramka zamknięta, #153, #162) – profil zostaje bez zmian, poziomy kategorii przepadają, a z potrzeb zostają tylko bardzo
 * pewne. Wtedy pusty wynik to „nic nie zrozumiano” od JEV, a nie powód do reguł – reguły
 * złapałyby słowa z cudzej sytuacji („kumpel ma psa” → pies).
 */
export function przetworzOdpowiedzi(
  odpowiedzi: Record<string, OdpowiedzJev | null>,
  /** Tekst użytkownika – #155: słowa „pod wynajem”, „mieszkam sama” dla profilu pod progiem. */
  tekst = '',
  progi: ProgiProfilu = PROGI_PROFILU,
): Zrozumienie | null {
  const sila = silyZJev(odpowiedzi)
  if (bramkaZamknieta(odpowiedzi)) {
    const potrzeby: { id: string; procent: number; sila?: Sila }[] = []
    for (const p of POTRZEBY) {
      const o = p.twierdzenie ? odpowiedzi[idPotrzeby(p)] : null
      if (o?.typ === 'noul' && o.noul >= PROG_POTRZEBY_PEWNEJ)
        potrzeby.push({ id: p.id, procent: procent(o.noul), ...sila(p.id) })
    }
    const nie = nieChceZJev(odpowiedzi, PROG_POTRZEBY_PEWNEJ)
    return potrzeby.length || nie.length ? zloz(null, null, potrzeby, {}, nie) : PUSTE_ZROZUMIENIE
  }

  let persona: PersonaId | null = null
  let pewnoscPersony: number | null = null
  const profil = odpowiedzi[ID_PROFILU]
  if (profil?.typ === 'choice' && (profil.pewnosc === null || profil.pewnosc >= progi.profil)) {
    const p = PROFILE_JEV.find((x) => x.id === profil.wybor)
    if (p) {
      persona = p.id
      pewnoscPersony = profil.pewnosc === null ? null : procent(profil.pewnosc)
    }
  }

  const poziomy: Partial<Record<KategoriaOceniana, number>> = {}
  for (const k of KATEGORIE_JEV) {
    const o = odpowiedzi[idKategorii(k)]
    if (o?.typ !== 'score' || !pewny(o.pewnosc)) continue
    const poziom = Math.min(Math.max(Math.round(o.ocena), 0), POZIOMY_WAZNOSCI.length - 1)
    if (poziom !== POZIOM_NEUTRALNY) poziomy[k] = poziom
  }

  const potrzeby: { id: string; procent: number | null; sila?: Sila }[] = []
  for (const p of POTRZEBY) {
    if (!p.twierdzenie) continue
    const o = odpowiedzi[idPotrzeby(p)]
    if (o?.typ === 'noul' && o.noul >= PROG_POTRZEBY)
      potrzeby.push({ id: p.id, procent: procent(o.noul), ...sila(p.id) })
  }
  const nie = nieChceZJev(odpowiedzi, PROG_NA_NIE)
  // Nic pewnego od JEV → reguły (one i tak czytają te same słowa, co zapas profilu niżej).
  if (
    persona === null &&
    potrzeby.length === 0 &&
    nie.length === 0 &&
    Object.keys(poziomy).length === 0
  )
    return null
  // #155: pod progiem (albo „nieznany”) profil tylko z mocnych potrzeb; bez nich – bez zmian.
  if (persona === null) persona = profilZMocnychPotrzeb(odpowiedzi, tekst, progi)
  // Społeczność i koszty (po #171 także dawna „Przyszłość okolicy”) nie ma pytania o poziom –
  // niesie ją profil Inwestor przez potrzebę `inwestycja` (jej kategorie i wskaźniki z tabeli
  // POTRZEBY, bez liczby od JEV).
  if (persona === 'inwestor') potrzeby.push({ id: 'inwestycja', procent: null })
  return zloz(persona, pewnoscPersony, potrzeby, poziomy, nie)
}

/** #182: siła potrzeby z oceny jej grupy (GRUPY_SILY); `{}` = brak siły (waga z tabeli). */
function silyZJev(odpowiedzi: Record<string, OdpowiedzJev | null>) {
  return (id: string): { sila?: Sila } => {
    const g = GRUPY_SILY.find((x) => x.potrzeby.includes(id))
    const o = g ? odpowiedzi[g.id] : null
    if (o?.typ !== 'score') return {}
    const s = Math.min(Math.round(o.ocena), 3)
    return s >= 1 ? { sila: s as Sila } : {}
  }
}

/** #182: potrzeby „na nie” z noul ≥ progu, w kolejności NA_NIE. */
function nieChceZJev(odpowiedzi: Record<string, OdpowiedzJev | null>, prog: number) {
  const wynik: { id: string; procent: number }[] = []
  for (const n of NA_NIE) {
    const o = odpowiedzi[idNaNie(n)]
    if (o?.typ === 'noul' && o.noul >= prog) wynik.push({ id: n.id, procent: procent(o.noul) })
  }
  return wynik
}

// ── Reguły zapasowe ───────────────────────────────────────────────────────────────────────

/** Małe litery, bez polskich znaków i interpunkcji – wzorce piszemy w ASCII. */
export function normalizuj(tekst: string): string {
  return tekst
    .toLowerCase()
    .replaceAll('ł', 'l')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

const PRZECZENIE = /\b(nie|bez|zadnych|zadnego|zadnej)\s+(\S+\s+)?$/

function wystepuje(tekst: string, w: Wzorzec): boolean {
  const re = new RegExp(w.re.source, 'g')
  for (const m of tekst.matchAll(re)) {
    if (w.negowalny === false) return true
    // „nie mam dzieci”, „bez psa” – przeczenie najwyżej dwa słowa przed trafieniem.
    if (!PRZECZENIE.test(tekst.slice(0, m.index))) return true
  }
  return false
}

/** Parser reguł: słowa kluczowe → potrzeby → profil i wagi. Deterministyczny, bez sieci. */
export function zRegul(tekst: string): Zrozumienie {
  const t = normalizuj(tekst)
  if (!t) return PUSTE_ZROZUMIENIE
  // #182: „nie chcę mieszkać obok szkoły” to potrzeba „na nie”, a nie „dzieci” – potrzeby na tak
  // czytamy z tekstu bez fragmentów odmowy.
  const nie = NA_NIE.filter((n) => odmowaPrzed(t, n.slowa))
  const naTak = nie.reduce((s, n) => bezOdmowy(s, n.slowa), t)
  const ids = POTRZEBY.filter((p) => p.wzorce.some((w) => wystepuje(naTak, w))).map((p) => p.id)
  const sila = silaZRegul(tekst)
  return zloz(
    personaZPotrzeb(ids),
    null,
    ids.map((id) => ({ id, procent: null, ...(sila === undefined ? {} : { sila }) })),
    {},
    nie.map((n) => ({ id: n.id, procent: null })),
  )
}

/** Pełna ścieżka: JEV z progiem pewności, przy każdym kłopocie reguły. Nigdy nie rzuca. */
export async function opiszSiebie(
  tekst: string,
  opcje: OpcjeKlienta = {},
): Promise<WynikZZapasem<Zrozumienie>> {
  if (!tekst.trim()) return { wynik: PUSTE_ZROZUMIENIE, zrodlo: 'zapas', powod: null }
  return zJevem(
    zapytanieOpiszSiebie(tekst),
    (odpowiedzi) => przetworzOdpowiedzi(odpowiedzi, tekst),
    () => zRegul(tekst),
    opcje,
  )
}

// ── Zrozumienie → wagi wskaźników ─────────────────────────────────────────────────────────

export interface NoweUstawienia {
  /** Persona, gdy wagi są dokładnie jej wagami; inaczej „własna”. */
  persona: PersonaId | 'wlasna'
  wagi: Record<string, number>
  kierunki: Kierunki
}

const przytnij = (w: number) => Math.min(Math.max(Math.round(w), 0), 4)

/**
 * #182: reguła sprzecznych kierunków – deterministyczna, bez JEV:
 * 1. Jawne „nie chcę” wygrywa kierunek swojej warstwy: z profilem, z bieżącymi ustawieniami
 *    i z potrzebą na tak („mamy dzieci, ale nie pod samą szkołą” → szkoła dalej = lepiej).
 *    Użytkownik powiedział to wprost o tej jednej rzeczy, a potrzeba na tak mówi o całej grupie
 *    warstw. Dwa „nie chcę” nie mają sprzecznych kierunków (pilnuje test tabeli NA_NIE).
 * 2. Dwie potrzeby na tak z przeciwnymi kierunkami na tej samej warstwie: wygrywa silniejsza
 *    (brak siły = 3, jak waga z tabeli), przy remisie wcześniejsza w POTRZEBY.
 * 3. Kierunek z profilu albo bieżących ustawień wygrywa z potrzebą na tak (#177, bez zmian).
 */
export function kierunkiPotrzeb(
  z: Pick<Zrozumienie, 'potrzeby' | 'sily' | 'nieChce'>,
  /** Tabela potrzeb – parametr tylko dla testów reguły (dziś żadne dwie nie są sprzeczne). */
  tabela: readonly Potrzeba[] = POTRZEBY,
): {
  naTak: Record<string, KierunekOceny>
  naNie: Record<string, { waga: number; kierunek: KierunekOceny }>
} {
  const naTak: Record<string, KierunekOceny> = {}
  const silaKierunku: Record<string, number> = {}
  for (const p of tabela) {
    if (!z.potrzeby.includes(p.id)) continue
    const s = z.sily?.[p.id] ?? 3
    for (const [warstwa, k] of Object.entries(p.kierunki ?? {})) {
      if ((silaKierunku[warstwa] ?? 0) >= s) continue
      naTak[warstwa] = k
      silaKierunku[warstwa] = s
    }
  }
  const naNie: Record<string, { waga: number; kierunek: KierunekOceny }> = {}
  for (const n of NA_NIE) {
    if (!z.nieChce?.includes(n.id)) continue
    for (const [warstwa, w] of Object.entries(n.warstwy)) {
      const byla = naNie[warstwa]
      naNie[warstwa] = byla ? { ...byla, waga: Math.max(byla.waga, w.waga) } : { ...w }
    }
  }
  return { naTak, naNie }
}

/**
 * Bazą są wagi rozpoznanego profilu (albo bieżące, gdy profilu nie ma). Potrzeby podnoszą
 * swoje warstwy z tabeli POTRZEBY (także te z wagą 0) i nadają kierunek warstwom neutralnym.
 * Poziom kategorii od JEV ≥ 3 podnosi do tego poziomu te warstwy kategorii, które baza już
 * liczy (waga > 0); ≤ 1 obniża je do niego. Kontekst zostaje bez zmian – liczy się tylko po
 * ręcznym włączeniu.
 *
 * #177 – dwie zmiany składania, obie z pomiaru „czy mapa spełnia potrzebę” (WYNIKI.md,
 * „Tabela potrzeb a silnik (#177)”):
 * - Poziom ≥ 3 nie włącza już warstw z wagą 0. Wcześniej „pies” (spokój 3) dawał wagę 3
 *   wszystkim 20 warstwom spokoju, od kąpieliska po słońce w grudniu: z 22 liczonych warstw
 *   profilu robiło się 52, a w top 100 adresów „pies” miał mniej zieleni niż sam profil.
 * - Poziom, który wynika TYLKO z potrzeb (`kategorie` w POTRZEBY, równy maksimum z potrzeb),
 *   nie zmienia wag – potrzeba ma własne warstwy. Inaczej „dzieci” (codzienność 4) podnosiły
 *   warstwy profilu z wagą 1 (wynik E8, kolejki NFZ) do 4 i przedszkole ginęło wśród nich.
 *   Poziom od JEV wyższy (albo niższy) niż z potrzeb działa jak dotąd. Poziomy w zrozumieniu
 *   (chipy, pomiar kategorii) się nie zmieniają.
 *
 * #182: minimalne wagi potrzeb są już przeliczone przez siłę (`wagaZSily` w `zloz`), a „nie
 * chcę” przejmuje swoje warstwy – kierunek i waga według `kierunkiPotrzeb`.
 */
export function wagiZeZrozumienia(
  z: Zrozumienie,
  tryb: Tryb,
  wskazniki: readonly (Pick<WskaznikMeta, 'id' | 'kategoria'> &
    Partial<Pick<WskaznikMeta, 'atrapa' | 'kierunek'>>)[],
  biezace: { wagi: Readonly<Record<string, number>>; kierunki: Kierunki },
): NoweUstawienia {
  const baza = z.persona
    ? ustawieniaPersony(z.persona, tryb, wskazniki)
    : { wagi: { ...biezace.wagi }, kierunki: { ...biezace.kierunki } }
  const potrzeby = z.potrzeby.flatMap((id) => POTRZEBY.filter((p) => p.id === id))
  const zPotrzeb: Partial<Record<KategoriaOceniana, number>> = {}
  for (const p of potrzeby)
    for (const [k, w] of Object.entries(p.kategorie) as [KategoriaOceniana, number][])
      zPotrzeb[k] = Math.max(zPotrzeb[k] ?? 0, w)
  const zKierunkiem = kierunkiPotrzeb(z)
  const meta = new Map(wskazniki.map((w) => [w.id, w]))
  /** Kierunek, który warstwa ma bez „nie chcę”: ustawiony w bazie albo z meta. */
  const kierunekBazy = (id: string) => baza.kierunki[id] ?? meta.get(id)?.kierunek
  const wagi: Record<string, number> = {}
  let zmiana = false
  for (const { id, kategoria } of wskazniki) {
    const przed = baza.wagi[id] ?? 0
    let w = przed
    // `przyszlosc` zostaje w kontrakcie tylko dla starych ustawień (#171) – nie ma wagi z JEV.
    if (kategoria !== 'kontekst' && kategoria !== 'przyszlosc') {
      const poziom = z.kategorie[kategoria]
      if (poziom !== undefined && poziom !== zPotrzeb[kategoria])
        w = poziom <= 1 ? Math.min(w, poziom) : w > 0 ? Math.max(w, poziom) : 0
      const minimum = z.wskazniki[id]
      const nie = zKierunkiem.naNie[id]
      if (nie) {
        // #182: „nie chcę” przejmuje warstwę. Liczą się tylko wagi zgodne z jego kierunkiem –
        // waga profilu „plac zabaw blisko” nie może wzmacniać „plac zabaw daleko”.
        const kierunekPotrzeby = zKierunkiem.naTak[id] ?? meta.get(id)?.kierunek
        w = Math.max(
          kierunekBazy(id) === nie.kierunek ? w : 0,
          minimum !== undefined && kierunekPotrzeby === nie.kierunek ? minimum : 0,
          nie.waga,
        )
      } else if (minimum !== undefined) w = Math.max(w, minimum)
    }
    w = przytnij(w)
    if (w !== przed) zmiana = true
    wagi[id] = w
  }
  // Kierunek z potrzeby na tak tylko tam, gdzie baza nie ma własnego (profil albo wybór
  // użytkownika). #182: „nie chcę” nadpisuje każdy kierunek swojej warstwy.
  const kierunki: Record<string, KierunekOceny> = { ...baza.kierunki }
  for (const [warstwa, k] of Object.entries(zKierunkiem.naTak)) {
    if (!meta.has(warstwa) || kierunki[warstwa] !== undefined) continue
    kierunki[warstwa] = k
    zmiana = true
  }
  for (const [warstwa, { kierunek }] of Object.entries(zKierunkiem.naNie)) {
    if (!meta.has(warstwa) || (kierunki[warstwa] ?? meta.get(warstwa)?.kierunek) === kierunek)
      continue
    kierunki[warstwa] = kierunek
    zmiana = true
  }
  return {
    persona: z.persona && !zmiana ? z.persona : 'wlasna',
    wagi,
    kierunki,
  }
}
