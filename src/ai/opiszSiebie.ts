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
 * #172: poziom kategorii z oczekiwanego poziomu Σ poziom·p (rozkład `prawdopodobienstwa`, #154),
 * a nie z zaokrąglonej oceny i progu pewności 0,6. Pewność kategorii w zbiorach do strojenia
 * leżała przy samym progu (`kat_transport` 0,55–0,62) i w teście A/A (#170) przestawiała poziom
 * w 3 z 30 opisów. Oczekiwany poziom waha się między przebiegami średnio o 0,03 (p95 0,08).
 *
 * Progi leżą tam, gdzie w zapisanych przebiegach (zbiory nr 2–6, 900 ocen) prawie nie ma ocen,
 * i są ostrożne: niepewność między dwoma sąsiednimi poziomami daje ten bliższy środka.
 * Np. pół na pół „Ważne” i „Bardzo ważne” (3,5) to „Ważne”. Dowody: WYNIKI.md, „Stabilne progi (#172)”.
 */
export interface ProgiKategorii {
  /** Od tego oczekiwanego poziomu – „Bardzo ważne” (4). */
  bardzoWazne: number
  /** Od tego – „Ważne” (3). */
  wazne: number
  /** Do tego – „Mało ważne” (1). */
  maloWazne: number
  /** Do tego – „Bez znaczenia” (0). */
  bezZnaczenia: number
}
export const PROGI_KATEGORII: ProgiKategorii = {
  bardzoWazne: 3.55,
  wazne: 2.65,
  maloWazne: 1.2,
  bezZnaczenia: 0.7,
}

/**
 * Oczekiwany poziom ze rozkładu po poziomach („0”…„4”), a bez rozkładu – `ocena` (pośrednik
 * liczy ją tak samo; na 270 ocenach z A/A różnica ≤ 0,02, tyle co zaokrąglenie p).
 */
export function oczekiwanyPoziom(o: Extract<OdpowiedzJev, { typ: 'score' }>): number | null {
  const p = o.prawdopodobienstwa
  if (p && typeof p === 'object') {
    let suma = 0
    let wazona = 0
    for (const [klucz, v] of Object.entries(p)) {
      const poziom = Number(klucz)
      if (!Number.isInteger(poziom) || poziom < 0 || poziom >= POZIOMY_WAZNOSCI.length) continue
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) continue
      suma += v
      wazona += poziom * v
    }
    if (suma > 0) return wazona / suma
  }
  return Number.isFinite(o.ocena) ? o.ocena : null
}

/** Poziom kategorii 0–4 albo null = środek skali (bez zmian wag). */
export function poziomKategorii(
  o: Extract<OdpowiedzJev, { typ: 'score' }>,
  progi: ProgiKategorii = PROGI_KATEGORII,
): number | null {
  const e = oczekiwanyPoziom(o)
  if (e === null) return null
  if (e >= progi.bardzoWazne) return 4
  if (e >= progi.wazne) return 3
  if (e <= progi.bezZnaczenia) return 0
  if (e <= progi.maloWazne) return 1
  return null
}
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

// Kolejność = kolejność pytań do JEV i chipów „zrozumiałem”. Najwyżej 10 z twierdzeniem
// (limit 16 pytań: 1 profil + 3 kategorie + 10 potrzeb + 2 twierdzenia bramki, #153).
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

/** Profile do wyboru przez JEV – bez „Od zera”, plus jawne „nie wiadomo”. */
const PROFILE_JEV = PERSONY.filter((p) => p.id !== 'od-zera')
const PROFIL_NIEZNANY = 'nieznany'

/**
 * #155: opisy opcji profilu dla JEV mówią, KIM jest osoba, a nie, co ceni. Opisy z UI
 * („Komunikacja i sklepy pod ręką”) pasowały do każdego, kto chce mieć blisko tramwaj, więc
 * JEV wybierał Singla dla par i rodzin. Nazwy i opisy w UI (`persony.ts`) się nie zmieniają.
 */
export const OPISY_PROFILI_JEV: Readonly<Record<Exclude<PersonaId, 'od-zera'>, string>> = {
  rodzina: 'Rodzic z dziećmi w domu (także gdy dziecko jest w drodze)',
  singiel: 'Osoba mieszkająca sama, zwykle młoda, pracująca albo studiująca',
  senior: 'Osoba na emeryturze albo w starszym wieku',
  inwestor: 'Kupujący pod wynajem albo jako lokatę, sam tam nie zamieszka',
}
export const OPIS_PROFILU_NIEZNANEGO = 'Nie da się tego określić z tekstu'

export interface PozycjaZrozumienia {
  rodzaj: 'profil' | 'potrzeba' | 'kategoria'
  etykieta: string
  /**
   * Profil i potrzeba: pewność JEV w % (null = z reguł, bez liczby).
   * Kategoria: ważność 0–100 % (waga 0–4 × 25).
   */
  procent: number | null
  /** Kategoria: słowny poziom ważności, np. „Bardzo ważne”. */
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
}

export const PUSTE_ZROZUMIENIE: Zrozumienie = {
  persona: null,
  kategorie: {},
  wskazniki: {},
  potrzeby: [],
  zrozumialem: [],
}

export function nicNieZrozumiano(z: Zrozumienie): boolean {
  return z.persona === null && z.potrzeby.length === 0 && Object.keys(z.kategorie).length === 0
}

// ── Zapytanie do JEV ──────────────────────────────────────────────────────────────────────

export const ID_PROFILU = 'profil'
export const idKategorii = (k: KategoriaOceniana) => `kat_${k}`
export const idPotrzeby = (p: Potrzeba) => `p_${p.id}`

/** Zapytanie w stałej kolejności: profil, 3 kategorie, potrzeby z twierdzeniem, bramka. */
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
  potrzeby: readonly { id: string; procent: number | null }[],
  poziomyJev: Partial<Record<KategoriaOceniana, number>>,
): Zrozumienie {
  const kategorie: Partial<Record<KategoriaOceniana, number>> = {}
  const wskazniki: Record<string, number> = {}
  for (const { id } of potrzeby) {
    const p = POTRZEBY.find((x) => x.id === id)
    if (!p) continue
    for (const [k, w] of Object.entries(p.kategorie) as [KategoriaOceniana, number][])
      kategorie[k] = Math.max(kategorie[k] ?? 0, w)
    for (const [id, w] of Object.entries(p.wskazniki))
      wskazniki[id] = Math.max(wskazniki[id] ?? 0, w)
  }
  // Jawny poziom od JEV wygrywa z tym, co wynika z potrzeb – także „mało ważne”.
  Object.assign(kategorie, poziomyJev)

  const zrozumialem: PozycjaZrozumienia[] = []
  const p = znajdzPersone(persona)
  if (p) zrozumialem.push({ rodzaj: 'profil', etykieta: p.nazwa, procent: pewnoscPersony })
  for (const { id, procent } of potrzeby) {
    const potrzeba = POTRZEBY.find((x) => x.id === id)
    if (potrzeba) zrozumialem.push({ rodzaj: 'potrzeba', etykieta: potrzeba.etykieta, procent })
  }
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
  return { persona, kategorie, wskazniki, potrzeby: potrzeby.map((x) => x.id), zrozumialem }
}

// ── Odpowiedzi JEV → zrozumienie ──────────────────────────────────────────────────────────

const procent = (x: number) => Math.round(Math.min(Math.max(x, 0), 1) * 100)

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
 * Poziom kategorii liczy się tylko, gdy oczekiwany poziom wyraźnie odszedł od środka skali
 * (#172: `poziomKategorii`, dawniej zaokrąglona ocena przy pewności ≥ 0,6).
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
  if (bramkaZamknieta(odpowiedzi)) {
    const potrzeby: { id: string; procent: number }[] = []
    for (const p of POTRZEBY) {
      const o = p.twierdzenie ? odpowiedzi[idPotrzeby(p)] : null
      if (o?.typ === 'noul' && o.noul >= PROG_POTRZEBY_PEWNEJ)
        potrzeby.push({ id: p.id, procent: procent(o.noul) })
    }
    return potrzeby.length ? zloz(null, null, potrzeby, {}) : PUSTE_ZROZUMIENIE
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
    if (o?.typ !== 'score') continue
    // #172: z oczekiwanego poziomu, bez progu pewności (PROGI_KATEGORII).
    const poziom = poziomKategorii(o)
    if (poziom !== null && poziom !== POZIOM_NEUTRALNY) poziomy[k] = poziom
  }

  const potrzeby: { id: string; procent: number | null }[] = []
  for (const p of POTRZEBY) {
    if (!p.twierdzenie) continue
    const o = odpowiedzi[idPotrzeby(p)]
    if (o?.typ === 'noul' && o.noul >= PROG_POTRZEBY)
      potrzeby.push({ id: p.id, procent: procent(o.noul) })
  }
  // Nic pewnego od JEV → reguły (one i tak czytają te same słowa, co zapas profilu niżej).
  if (persona === null && potrzeby.length === 0 && Object.keys(poziomy).length === 0) return null
  // #155: pod progiem (albo „nieznany”) profil tylko z mocnych potrzeb; bez nich – bez zmian.
  if (persona === null) persona = profilZMocnychPotrzeb(odpowiedzi, tekst, progi)
  // Społeczność i koszty (po #171 także dawna „Przyszłość okolicy”) nie ma pytania o poziom –
  // niesie ją profil Inwestor przez potrzebę `inwestycja` (jej kategorie i wskaźniki z tabeli
  // POTRZEBY, bez liczby od JEV).
  if (persona === 'inwestor') potrzeby.push({ id: 'inwestycja', procent: null })
  return zloz(persona, pewnoscPersony, potrzeby, poziomy)
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
  const ids = POTRZEBY.filter((p) => p.wzorce.some((w) => wystepuje(t, w))).map((p) => p.id)
  return zloz(
    personaZPotrzeb(ids),
    null,
    ids.map((id) => ({ id, procent: null })),
    {},
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
 */
export function wagiZeZrozumienia(
  z: Zrozumienie,
  tryb: Tryb,
  wskazniki: readonly (Pick<WskaznikMeta, 'id' | 'kategoria'> &
    Partial<Pick<WskaznikMeta, 'atrapa'>>)[],
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
      if (minimum !== undefined) w = Math.max(w, minimum)
    }
    w = przytnij(w)
    if (w !== przed) zmiana = true
    wagi[id] = w
  }
  // Kierunek z potrzeby tylko tam, gdzie baza nie ma własnego (profil albo wybór użytkownika).
  const kierunki: Record<string, KierunekOceny> = { ...baza.kierunki }
  const zywe = new Set(wskazniki.map((w) => w.id))
  for (const p of potrzeby) {
    for (const [warstwa, k] of Object.entries(p.kierunki ?? {})) {
      if (!zywe.has(warstwa) || kierunki[warstwa] !== undefined) continue
      kierunki[warstwa] = k
      zmiana = true
    }
  }
  return {
    persona: z.persona && !zmiana ? z.persona : 'wlasna',
    wagi,
    kierunki,
  }
}
