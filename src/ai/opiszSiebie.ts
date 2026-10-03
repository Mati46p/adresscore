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
import type { Kierunki } from '../wynik/silnik.ts'
import {
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
export type KategoriaOceniana = Exclude<KategoriaId, 'kontekst'>

export const KATEGORIE_OCENIANE = [
  'codziennosc',
  'transport',
  'spokoj',
  'przyszlosc',
  'bezpieczenstwo',
] as const satisfies readonly KategoriaOceniana[]

// Kopia etykiet z kontraktu (moduł kontraktu czyta import.meta.env, którego w Node nie ma).
// `satisfies` pilnuje, żeby tekst był identyczny z KATEGORIE.
export const ETYKIETY_KATEGORII = {
  codziennosc: 'Codzienność pieszo',
  transport: 'Transport',
  spokoj: 'Spokój i zdrowie',
  przyszlosc: 'Przyszłość okolicy',
  bezpieczenstwo: 'Bezpieczeństwo i ryzyko',
} as const satisfies { [K in KategoriaOceniana]: (typeof KATEGORIE)[K] }

const OPISY_KATEGORII: Record<KategoriaOceniana, string> = {
  codziennosc: 'sklepy, szkoły, przychodnie i usługi w zasięgu spaceru',
  transport: 'przystanki, częste kursy, dojazd do centrum i na lotnisko',
  spokoj: 'cisza, czyste powietrze, zieleń',
  przyszlosc: 'inwestycje i rozwój okolicy',
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
 * środka skali tylko w 2 z 30 opisów, a jeden z nich i tak był inwestorem.
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

/** Poniżej tej pewności JEV nie wierzymy poziomowi kategorii. */
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
/** Od tej oceny twierdzenia (noul) uznajemy potrzebę. */
export const PROG_POTRZEBY = 0.6

/**
 * Bramka „cudza sytuacja” (#147, #153): tekst o kimś spoza domu („Pytam dla koleżanki…”) albo
 * o sytuacji tylko wyobrażonej lub dawnej („Gdybym kiedyś miał psa…”). Gdy bramka jest
 * zamknięta, profil zostaje bez zmian, a z potrzeb zostają tylko bardzo pewne.
 *
 * #153: dwa wąskie twierdzenia zamiast jednego „Osoba opisuje własną obecną sytuację…” (#147)
 * i odwrócona logika – bramka zamyka się tylko na DOWÓD cudzej albo nieaktualnej sytuacji
 * (któreś twierdzenie ≥ PROG_BRAMKI), a nie na brak dowodu własnej. Twierdzenie z #147 dawało
 * „teściowa z nami zamieszka” 0,35 i „mama z nami zamieszka” 0,18 (profil Senior przepadał),
 * a dawnej sytuacji 0,71. Domownik, rodzina i własne plany to własna sytuacja; zakup na
 * wynajem też (inwestor). Dowody: WYNIKI.md, „Trzy błędy (#153)”.
 */
export const BRAMKA = [
  {
    id: 'cudza_osoba',
    twierdzenie:
      'Osoba szuka mieszkania dla kogoś innego, kto z nią nie mieszka i nie zamieszka (np. dla znajomego, klienta, rodzeństwa). Zakup na wynajem albo jako inwestycja to nie to.',
  },
  {
    id: 'sytuacja_nieaktualna',
    twierdzenie:
      'Tekst mówi wyłącznie o sytuacji wyobrażonej („gdyby…”) albo nieaktualnej (tak było kiedyś), a nie o obecnej ani planowanej.',
  },
] as const
/** Od tej oceny któregokolwiek twierdzenia BRAMKA bramka się zamyka. */
export const PROG_BRAMKI = 0.5
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
  /** Wzorce na tekście bez polskich znaków, małymi literami. */
  wzorce: Wzorzec[]
  /** Profil, który potrzeba sugeruje (reguły; JEV wybiera profil sam). */
  persona?: PersonaId
  /** Minimalny poziom ważności kategorii (0–4). */
  kategorie: Partial<Record<KategoriaOceniana, number>>
  /** Minimalna waga wskaźnika (id z manifestu; nieznane id nic nie robi). */
  wskazniki: Record<string, number>
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
    wzorce: [
      {
        re: /\b(dzieci|dzieck|dziecm|cork|coreczk|syn\b|syna\b|synem|synow|synk|przedszkol|szkol|zlob|niemowl|maluch|rodzin)/,
      },
    ],
    persona: 'rodzina',
    kategorie: { codziennosc: 4, spokoj: 3 },
    wskazniki: {
      przedszkole_odleglosc: 4,
      szkola_podst_odleglosc: 4,
      zlobek_odleglosc: 3,
      zielen_udzial: 4,
    },
  },
  {
    id: 'pies',
    etykieta: 'pies',
    twierdzenie: 'Osoba ma psa albo chce go mieć.',
    wzorce: [{ re: /\b(pies|psa|psem|psy|psiak|piesk|psiny)\b/ }],
    kategorie: { spokoj: 3 },
    wskazniki: { zielen_udzial: 4, zielen_worldcover_100m: 4 },
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
    wskazniki: { zielen_udzial: 4, zielen_worldcover_100m: 4 },
  },
  {
    id: 'powietrze',
    etykieta: 'czyste powietrze',
    twierdzenie: 'Dla osoby ważne jest czyste powietrze (smog, astma, alergia).',
    wzorce: [{ re: /\b(smog|powietrz|astm|alergi|zanieczyszcz|pylow|pyly)/ }],
    kategorie: { spokoj: 4 },
    wskazniki: { pm25_srednia: 4, pm10_srednia: 4, no2_srednia: 4, bap_srednia: 4 },
  },
  {
    id: 'rower',
    etykieta: 'rower',
    twierdzenie: 'Osoba jeździ na co dzień rowerem albo hulajnogą.',
    wzorce: [{ re: /\b(rower|hulajnog)/ }],
    // Warstwy dróg rowerowych jeszcze nie ma – rower to krótkie dystanse do usług.
    kategorie: { codziennosc: 3 },
    wskazniki: { uslugi_15min: 4 },
  },
  {
    id: 'bez_samochodu',
    etykieta: 'bez samochodu',
    twierdzenie: 'Osoba nie ma samochodu.',
    wzorce: [
      {
        re: /\b(bez (samochodu|auta|samochod)|nie mam (samochodu|auta|prawa jazdy)|nie jezdze (samochodem|autem))/,
        negowalny: false,
      },
      { re: /\b(komunikacj|tramwaj|autobus|mpk|przystan|metro|pociag)/ },
    ],
    kategorie: { transport: 4, codziennosc: 3 },
    wskazniki: { przystanek_odleglosc: 4, kursy_szczyt_h: 4, uslugi_15min: 3 },
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
    wskazniki: {
      przychodnia_odleglosc: 4,
      apteka_odleglosc: 4,
      lawki_300m: 4,
      obnizone_krawezniki_300m: 3,
    },
  },
  {
    id: 'praca_centrum',
    etykieta: 'praca w centrum',
    twierdzenie: 'Osoba codziennie dojeżdża do pracy albo na uczelnię w centrum miasta.',
    wzorce: [
      {
        re: /\b(prac\w* (w|na) (centrum|rynku|starym miescie|kazimierzu)|w centrum|centrum miasta|do centrum|rynek|rynku|stare miasto|starym miescie|dojazd\w* do pracy|dojezdzam|biuro|biurze|uczelni)/,
      },
    ],
    kategorie: { transport: 4 },
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
    wskazniki: {
      przychodnia_odleglosc: 4,
      apteka_odleglosc: 4,
      przychodnia_bez_barier_odleglosc: 3,
      obnizone_krawezniki_300m: 3,
    },
  },
  {
    id: 'lotnisko',
    etykieta: 'lotnisko',
    twierdzenie: 'Osoba często lata samolotem.',
    wzorce: [{ re: /\b(lotnisk|samolot|latam|balic|delegacj)/ }],
    kategorie: { transport: 3 },
    wskazniki: { lotnisko_czas_min: 4 },
  },
  // Tylko z reguł – po stronie JEV pokrywa je poziom kategorii albo wybór profilu.
  {
    id: 'cisza',
    etykieta: 'cisza',
    wzorce: [{ re: /\b(cisz|cich|spokoj)/ }, { re: /\b(halas|glosn)/, negowalny: false }],
    kategorie: { spokoj: 4 },
    wskazniki: { halas_ldwn: 4 },
  },
  {
    id: 'sklepy',
    etykieta: 'sklepy pod ręką',
    wzorce: [{ re: /\b(sklep|zakup|uslug|wszystko blisko|wszedzie blisko|pieszo|na piechote)/ }],
    kategorie: { codziennosc: 4 },
    wskazniki: { sklep_odleglosc: 4, uslugi_15min: 4 },
  },
  {
    id: 'bezpieczenstwo',
    etykieta: 'bezpieczeństwo',
    wzorce: [{ re: /\b(bezpieczn|powodz|zalan|zalew|wylew|podtopi|ryzyk)/ }],
    kategorie: { bezpieczenstwo: 4 },
    wskazniki: { powodz_1proc: 4, powodz_10proc: 4, powodz_02proc: 3 },
  },
  {
    id: 'inwestycja',
    etykieta: 'inwestycja',
    wzorce: [
      { re: /\b(inwest|na wynajem|pod wynajem|zysk|lokat|zarobi|wzrost cen|wartosc nieruchom)/ },
    ],
    persona: 'inwestor',
    kategorie: { przyszlosc: 4 },
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
    wskazniki: {},
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
  for (const p of POTRZEBY) if (p.twierdzenie) pytania[idPotrzeby(p)] = takNie(p.twierdzenie)
  for (const b of BRAMKA) pytania[b.id] = takNie(b.twierdzenie)
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

/** #153: bramka zamknięta = któreś twierdzenie BRAMKA ma noul ≥ PROG_BRAMKI. */
export function bramkaZamknieta(odpowiedzi: Record<string, OdpowiedzJev | null>): boolean {
  return BRAMKA.some((b) => {
    const o = odpowiedzi[b.id]
    // Brak odpowiedzi = brak dowodu cudzej sytuacji – bramka zostaje otwarta.
    return o?.typ === 'noul' && o.noul >= PROG_BRAMKI
  })
}

/**
 * Odpowiedzi JEV → zrozumienie. null (→ reguły), gdy nic nie przeszło progu pewności.
 * Poziom kategorii liczy się tylko, gdy JEV jest pewny i odszedł od środka skali.
 *
 * #147: gdy tekst opisuje cudzą, wyobrażoną albo dawną sytuację (bramka zamknięta, #153),
 * profil zostaje bez zmian, poziomy kategorii przepadają, a z potrzeb zostają tylko bardzo
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
    if (o?.typ !== 'score' || !pewny(o.pewnosc)) continue
    const poziom = Math.min(Math.max(Math.round(o.ocena), 0), POZIOMY_WAZNOSCI.length - 1)
    if (poziom !== POZIOM_NEUTRALNY) poziomy[k] = poziom
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
  // Przyszłość okolicy nie ma już pytania o poziom – niesie ją profil Inwestor przez potrzebę
  // `inwestycja` (jej kategorie i wskaźniki z tabeli POTRZEBY, bez liczby od JEV).
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
 * Bazą są wagi rozpoznanego profilu (albo bieżące, gdy profilu nie ma). Kategoria na poziomie
 * ≥ 3 podnosi swoje warstwy do tego poziomu, ≤ 1 obniża je do niego; potrzeby podnoszą
 * konkretne warstwy. Kontekst zostaje bez zmian – liczy się tylko po ręcznym włączeniu.
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
  const wagi: Record<string, number> = {}
  let zmiana = false
  for (const { id, kategoria } of wskazniki) {
    const przed = baza.wagi[id] ?? 0
    let w = przed
    if (kategoria !== 'kontekst') {
      const poziom = z.kategorie[kategoria]
      if (poziom !== undefined) w = poziom <= 1 ? Math.min(w, poziom) : Math.max(w, poziom)
      const minimum = z.wskazniki[id]
      if (minimum !== undefined) w = Math.max(w, minimum)
    }
    w = przytnij(w)
    if (w !== przed) zmiana = true
    wagi[id] = w
  }
  return {
    persona: z.persona && !zmiana ? z.persona : 'wlasna',
    wagi,
    kierunki: { ...baza.kierunki },
  }
}
