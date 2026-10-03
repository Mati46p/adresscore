// „Zapytaj o adres” (#17): pytanie po polsku → jedna warstwa z manifestu → jej wartość pod
// tym adresem ze źródłem i rozdzielczością. Czysta logika bez Reacta i bez `import.meta.env`,
// żeby testy szły na gołym `node --test` (z kontraktu bierzemy tylko typy).
//
// JEV NIE GENERUJE ODPOWIEDZI. Wybiera tylko id warstwy z zamkniętej listy (choice). Liczba,
// jednostka, źródło i rozdzielczość zawsze pochodzą z `public/dane` (wartosci[i] + meta).
// Brak klucza, błąd, wybór spoza listy albo niska pewność → reguła słów kluczowych poniżej.
import type { WskaznikMeta, Zrodlo } from '../kontrakty/index.ts'
import { KOLEJNOSC_KATEGORII } from '../wynik/silnik.ts'
import {
  type OdpowiedzJev,
  type OpcjeKlienta,
  takNie,
  wybor,
  type ZapytanieJev,
  zJevem,
} from './jev.ts'

/** Id pytania w zapytaniu do pośrednika. */
export const ID_PYTANIA = 'warstwa'
/** Opcja „żadna warstwa nie pasuje” – zawsze ostatnia na liście. */
export const NIE_WIEM = 'nie_wiem'
/** Poniżej tej pewności (albo bez pewności) wyboru JEV nie bierzemy – decyduje reguła. */
export const PROG_PEWNOSCI = 0.5
/** Limity pośrednika (api/_jev.js): do 128 opcji choice (JEV sprawdzony na żywo na 76), opis opcji do 300 znaków. */
const MAKS_WARSTW = 127
const MAKS_OPISU = 300

// Zdanie o pytaniach złożonych dodane po pomiarze #18: bez niego JEV na „Jak tu z powietrzem,
// hałasem i drzewami?” wybierał nie_wiem zamiast jednej z pasujących warstw.
export const POLECENIE =
  'Użytkownik pyta o jeden adres. Wybierz warstwę danych, która odpowiada na jego pytanie. ' +
  'Jeśli pytanie dotyczy kilku rzeczy naraz, wybierz warstwę dla pierwszej z nich. ' +
  'Jeśli żadna nie pasuje, wybierz nie_wiem.'

/**
 * Dopiski do opisu warstwy dla JEV (przed opisem z danych, żeby nie uciął ich limit 300 znaków).
 * Trzy warstwy powodzi różnią się tylko prawdopodobieństwem, więc JEV rozkładał pewność między
 * nie i na „Czy piwnica może zalać?” spadał pod próg (pomiar #18) – wskazujemy domyślną.
 * #147: potoczne słowa, którymi ludzie pytają (park, skwer, smog, korki…). Opisy z danych są
 * techniczne („odsetek powierzchni oczka 100 m…”), a słowo „park” w nich nie pada (B19 w #18).
 */
const DOPISKI_WARSTW: Readonly<Record<string, string>> = {
  powodz_1proc:
    'Domyślna odpowiedź na pytania, czy tu zalewa, czy zaleje piwnicę, o powódź, wysoką wodę, wylewy rzeki i podtopienia.',
  powodz_10proc: 'Tylko gdy pytanie wprost dotyczy częstych zalań (co kilka lat).',
  powodz_02proc: 'Tylko gdy pytanie wprost dotyczy najgorszego, skrajnie rzadkiego scenariusza.',
  zielen_worldcover_100m:
    'Domyślna odpowiedź na pytania o zieleń: park, skwer, trawnik, czy jest zielono, gdzie wyjść na spacer albo pobiegać, także na spacer z psem.',
  drzewa_100m: 'Odpowiedź na pytania o drzewa przy ulicy i pod oknem.',
  pm25_srednia:
    'Domyślna odpowiedź na pytania o smog, czyste powietrze i czym się tu oddycha (astma, alergia).',
  bap_srednia: 'Odpowiedź na pytania o dym z pieców i palenie węglem.',
  halas_ldwn:
    'Domyślna odpowiedź na pytania, czy jest głośno albo cicho, czy słychać ulicę, tramwaje albo pociągi i czy da się spać przy otwartym oknie.',
  przystanek_odleglosc:
    'Domyślna odpowiedź na pytania o komunikację miejską: tramwaj, autobus, MPK, daleko do przystanku.',
  kursy_szczyt_h: 'Odpowiedź na pytania, jak często coś jeździ i ile się czeka.',
  rynek_czas_min:
    'Odpowiedź na pytania, ile się jedzie do centrum albo na Rynek, także rano w korkach.',
  kolej_odleglosc: 'Odpowiedź na pytania o pociąg, stację i dojazd koleją.',
  sklep_odleglosc: 'Domyślna odpowiedź na pytania o sklep i zakupy (Biedronka, Żabka, Lidl).',
  przychodnia_odleglosc:
    'Domyślna odpowiedź na pytania o lekarza rodzinnego, przychodnię i ośrodek zdrowia.',
  apteka_odleglosc: 'Odpowiedź na pytania o aptekę i leki.',
  szkola_podst_odleglosc: 'Domyślna odpowiedź na pytania o szkołę i podstawówkę.',
  spp_podstrefa: 'Odpowiedź na pytania, czy za parkowanie auta pod domem trzeba płacić.',
  inwestycje_500m: 'Odpowiedź na pytania, czy coś tu wybudują, czy będzie budowa za oknem.',
  oswietlenie_100m: 'Odpowiedź na pytania, czy wieczorem na ulicy jest jasno.',
  siec_cieplownicza_odleglosc: 'Odpowiedź na pytania o miejskie ogrzewanie i ciepło z sieci.',
}

/** Warstwa z danymi pod adresami – podzbiór `WskaznikPrzygotowany` z src/wynik/silnik.ts. */
export interface WarstwaDanych {
  meta: WskaznikMeta
  wartosci: readonly (number | null)[]
  etykiety?: readonly (string | null)[]
  /** Powód, gdy plik warstwy się nie wczytał. */
  niedostepny?: string
}

export interface PozycjaListy {
  id: string
  nazwa: string
  /** Opis dla klasyfikatora JEV (≤ 300 znaków). */
  opis: string
}

const kolejnoscKategorii = (k: string) => {
  const i = (KOLEJNOSC_KATEGORII as readonly string[]).indexOf(k)
  return i < 0 ? KOLEJNOSC_KATEGORII.length : i
}

function przytnij(tekst: string, maks: number): string {
  const t = tekst.replace(/\s+/g, ' ').trim()
  return t.length <= maks ? t : `${t.slice(0, maks - 1).trimEnd()}…`
}

/** Pierwsze zdanie opisu – wystarczy klasyfikatorowi, a mieści się w limicie. */
function pierwszeZdanie(opis: string): string {
  const m = /^(.+?[.!?])(\s|$)/.exec(opis.trim())
  return m?.[1] ?? opis
}

/**
 * Zamknięta lista warstw dla JEV: bez atrap, w stałej kolejności (kategoria karty, potem id),
 * niezależnej od kolejności manifestu. Kolejność opcji JEV widzi, więc nie może skakać.
 */
export function listaWarstw(metas: readonly WskaznikMeta[]): PozycjaListy[] {
  return metas
    .filter((m) => !m.atrapa)
    .slice()
    .sort(
      (a, b) =>
        kolejnoscKategorii(a.kategoria) - kolejnoscKategorii(b.kategoria) ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    )
    .slice(0, MAKS_WARSTW)
    .map((m) => ({
      id: m.id,
      nazwa: m.nazwa,
      opis: przytnij(
        [`${m.nazwa} (${m.jednostka}).`, DOPISKI_WARSTW[m.id], pierwszeZdanie(m.opis)]
          .filter(Boolean)
          .join(' '),
        MAKS_OPISU,
      ),
    }))
}

/** Kryteria choice: id warstwy → opis, plus `nie_wiem` na końcu. */
export function kryteria(lista: readonly PozycjaListy[]): Record<string, string> {
  const k: Record<string, string> = {}
  for (const p of lista) k[p.id] = p.opis
  k[NIE_WIEM] = 'Pytanie nie dotyczy żadnej z warstw powyżej albo jest niejasne.'
  return k
}

// --- Tematy: pytania złożone (#146) ------------------------------------------------------

/**
 * Temat = grupa warstw odpowiadających na tę samą potrzebę. JEV ocenia twierdzenie tematu
 * (noul 0–1) w tym samym wywołaniu co `choice`; temat z oceną ≥ PROG_TEMATU dokłada jedną
 * warstwę z grupy. Każda warstwa należy najwyżej do jednego tematu.
 */
export interface Temat {
  id: string
  nazwa: string
  /** Twierdzenie dla JEV (≤ 300 znaków), „Pytanie (choćby w części) dotyczy …”. */
  twierdzenie: string
  /** Warstwy tematu (id z public/dane/wskazniki). */
  warstwy: readonly string[]
  /** Warstwa, którą temat dokłada, gdy reguły nie wskażą lepszej z grupy. */
  domyslna: string
  /**
   * #147: warstwa → obiekt, gdy temat to grupa różnych obiektów (przedszkole i żłobek, apteka
   * i przychodnia), a nie kilku miar jednej rzeczy (jak powietrze). Gdy pytanie wprost nazywa
   * drugi obiekt (trafia go reguła słów kluczowych), temat może dołożyć drugą warstwę.
   * Dwie warstwy jednego obiektu (przychodnia i przychodnia bez barier) to nadal jedna rzecz.
   */
  obiekty?: Readonly<Record<string, string>>
}

// #147: twierdzenie mówi, o co użytkownik PYTA, a nie o czym wspomina. Wcześniejsze „Pytanie
// (choćby w części) dotyczy …” łapało samo słowo: „słychać tramwaje” → komunikacja, „apteka”
// → sklepy, „dieslem” → powietrze, „bezpiecznie rowerem” → zagrożenia (pomiar #146).
const O = 'Użytkownik chce się dowiedzieć'
// #150: ostre „Użytkownik chce się dowiedzieć” obniżało też prawdziwe tematy (sklepy 0,96 →
// 0,56 na zbiorze kontrolnym). Siedem tematów wraca do formy obejmującej („choćby w części”),
// ale z zawężonymi wykluczeniami („pytanie wyłącznie o …”) – cztery znane fałszywe dodatki
// zostają pod progiem (0,07 / 0,17 / 0,13 / 0,33), a prawdziwe tematy rosną (hałas 0,77 → 0,94,
// bezpieczeństwo wieczorem 0,47 → 0,91, powietrze 0,71 → 0,91, sklepy 0,69 → 0,91; WYNIKI.md,
// „Druga runda (#150)”). Tematy, których nie sprawdziłem na żywo, mają brzmienie z #147.
const P = 'Pytanie (choćby w części) dotyczy'

/** Stała kolejność – JEV widzi ją w zapytaniu, a remis noul rozstrzyga pozycja na liście. */
export const TEMATY: readonly Temat[] = [
  {
    id: 'halas',
    nazwa: 'hałas',
    twierdzenie: `${P} hałasu: czy jest głośno albo cicho, słychać ulicę, tramwaje, pociągi, samoloty, spokój w nocy.`,
    warstwy: ['halas_ldwn', 'halas_obwarzanek_lden'],
    domyslna: 'halas_ldwn',
  },
  {
    id: 'powietrze',
    nazwa: 'powietrze',
    twierdzenie: `${P} jakości powietrza: smog, pyły, spaliny, dym z pieców, czym się tu oddycha. Pytanie wyłącznie o przepisy dla aut (wjazd do strefy, mandat) to nie to.`,
    warstwy: [
      'pm25_srednia',
      'pm10_srednia',
      'no2_srednia',
      'bap_srednia',
      'paleniska_200m',
      'przewietrzanie_klasa',
    ],
    domyslna: 'pm25_srednia',
  },
  {
    id: 'zielen',
    nazwa: 'zieleń',
    twierdzenie: `${P} zieleni w okolicy: parki, skwery, drzewa, las, przyroda, gdzie wyjść na spacer. Samo posiadanie psa to nie to.`,
    warstwy: [
      'zielen_worldcover_100m',
      'zielen_udzial',
      'drzewa_100m',
      'przyroda_chroniona_odleglosc',
      'rod_odleglosc',
      'woda_odleglosc',
    ],
    domyslna: 'zielen_worldcover_100m',
  },
  {
    id: 'powodz',
    nazwa: 'powódź',
    twierdzenie: `${O}, czy grozi tu powódź: zalewanie, podtopienia, wysoka woda, wylew rzeki.`,
    warstwy: ['powodz_1proc', 'powodz_10proc', 'powodz_02proc', 'gmina_powodz_powierzchnia_pct'],
    domyslna: 'powodz_1proc',
  },
  {
    id: 'komunikacja',
    nazwa: 'komunikacja',
    twierdzenie: `${P} dojazdu komunikacją publiczną: przystanek, tramwaj, autobus, pociąg, jak często jeździ, ile trwa dojazd. Pytanie wyłącznie o hałas tramwajów to nie to.`,
    warstwy: [
      'przystanek_odleglosc',
      'kursy_szczyt_h',
      'rynek_czas_min',
      'kolej_odleglosc',
      'kolej_kursy_szczyt_h',
      'bus_mld_odleglosc',
      'bus_mld_kursy_szczyt_h',
      'lotnisko_czas_min',
    ],
    domyslna: 'przystanek_odleglosc',
  },
  {
    id: 'szkoly',
    nazwa: 'szkoły i przedszkola',
    twierdzenie: `${O}, czy blisko jest szkoła, przedszkole, żłobek albo plac zabaw dla dzieci.`,
    warstwy: [
      'szkola_podst_odleglosc',
      'przedszkole_odleglosc',
      'zlobek_odleglosc',
      'liceum_odleglosc',
      'szkola_podst_wynik_e8',
      'plac_zabaw_odleglosc',
    ],
    domyslna: 'szkola_podst_odleglosc',
    obiekty: {
      szkola_podst_odleglosc: 'szkola',
      szkola_podst_wynik_e8: 'szkola',
      przedszkole_odleglosc: 'przedszkole',
      zlobek_odleglosc: 'zlobek',
      liceum_odleglosc: 'liceum',
      plac_zabaw_odleglosc: 'plac_zabaw',
    },
  },
  {
    id: 'zdrowie',
    nazwa: 'zdrowie',
    twierdzenie: `${O}, czy blisko jest lekarz, przychodnia, apteka albo inna pomoc medyczna.`,
    warstwy: [
      'przychodnia_odleglosc',
      'przychodnia_bez_barier_odleglosc',
      'apteka_odleglosc',
      'defibrylator_odleglosc',
    ],
    domyslna: 'przychodnia_odleglosc',
    obiekty: {
      przychodnia_odleglosc: 'przychodnia',
      przychodnia_bez_barier_odleglosc: 'przychodnia',
      apteka_odleglosc: 'apteka',
      defibrylator_odleglosc: 'defibrylator',
    },
  },
  {
    id: 'sklepy',
    nazwa: 'sklepy i usługi',
    twierdzenie: `${P} sklepów albo usług w pobliżu: zakupy, spożywczak, poczta, bankomat, paczkomat, weterynarz. Pytanie wyłącznie o aptekę albo lekarza to nie to.`,
    warstwy: [
      'sklep_odleglosc',
      'uslugi_15min',
      'bankomat_poczta_odleglosc',
      'paczkomat_odleglosc',
      'weterynarz_odleglosc',
    ],
    domyslna: 'sklep_odleglosc',
    obiekty: {
      sklep_odleglosc: 'sklep',
      bankomat_poczta_odleglosc: 'bankomat_poczta',
      paczkomat_odleglosc: 'paczkomat',
      weterynarz_odleglosc: 'weterynarz',
    },
  },
  {
    id: 'ceny',
    nazwa: 'ceny mieszkań',
    twierdzenie: `${O}, ile kosztują tu mieszkania: cena metra kwadratowego, czy jest drogo, ile warta jest nieruchomość.`,
    warstwy: ['cena_m2_mediana'],
    domyslna: 'cena_m2_mediana',
  },
  {
    id: 'bezpieczenstwo',
    nazwa: 'bezpieczeństwo',
    twierdzenie: `${P} bezpieczeństwa okolicy: czy jest bezpiecznie albo ciemno wieczorem, oświetlenie ulic, przestępstwa, policja, pożary. Pytanie wyłącznie o bezpieczną jazdę rowerem to nie to.`,
    warstwy: [
      'oswietlenie_100m',
      'policja_odleglosc',
      'miejscowe_zagrozenia_gmina_2025',
      'pozary_gmina_2025',
      'punkt_schronienia_odleglosc',
    ],
    domyslna: 'oswietlenie_100m',
  },
  {
    id: 'parkowanie',
    nazwa: 'parkowanie',
    twierdzenie: `${O} czegoś o samochodzie w okolicy: parkowanie, płatna strefa parkowania, parking P+R, wjazd autem do strefy czystego transportu.`,
    warstwy: ['spp_podstrefa', 'sct_w_strefie', 'pr_odleglosc'],
    domyslna: 'spp_podstrefa',
  },
  {
    id: 'rower',
    nazwa: 'rower',
    twierdzenie: `${P} roweru: drogi i trasy rowerowe, dojazd rowerem, stojaki, gdzie przypiąć rower.`,
    warstwy: ['rower_infrastruktura_odleglosc', 'droga_rowerowa_odleglosc', 'stojaki_300m'],
    domyslna: 'rower_infrastruktura_odleglosc',
    obiekty: {
      rower_infrastruktura_odleglosc: 'trasa',
      droga_rowerowa_odleglosc: 'trasa',
      stojaki_300m: 'stojaki',
    },
  },
  {
    id: 'demografia',
    nazwa: 'demografia',
    twierdzenie: `${O}, kto mieszka w okolicy: ilu jest tu ludzi, czy dużo rodzin z dziećmi albo seniorów.`,
    warstwy: ['ludnosc_1km', 'udzial_0_14', 'udzial_65plus'],
    domyslna: 'ludnosc_1km',
  },
  {
    id: 'plan',
    nazwa: 'plan miejscowy i inwestycje',
    twierdzenie: `${O}, co się zmieni w okolicy: plan miejscowy, nowe budowy i inwestycje, co tu powstanie.`,
    warstwy: [
      'inwestycje_500m',
      'mpzp_status',
      'gmina_mpzp_pokrycie_pct',
      'bo_projekty_1km',
      'przetargi_dzielnica',
      'gmina_inwestycje_pc',
    ],
    domyslna: 'inwestycje_500m',
  },
  {
    id: 'przemysl_grunt',
    nazwa: 'przemysł i grunt',
    twierdzenie: `${O}, czy blisko są zakłady przemysłowe, azbest, osuwiska albo ruchy gruntu.`,
    warstwy: [
      'emitent_odleglosc',
      'seveso_odleglosc',
      'azbest_budynki_100m',
      'osuwisko_odleglosc',
      'teren_osuwiskowy',
      'osiadanie_mm_rok',
    ],
    domyslna: 'emitent_odleglosc',
  },
]

/**
 * Od tej oceny twierdzenia temat dokłada warstwę. 0,6 jak PROG_POTRZEBY w „opisz siebie”:
 * w pomiarze #18 noul dla potrzeb, o które tekst pyta, miał średnio 0,82, a dla pozostałych
 * 0,21 – próg tuż nad środkiem skali odcina szum, a nie gubi tematów wyraźnie nazwanych.
 */
export const PROG_TEMATU = 0.6
/** Karta pokazuje najwyżej tyle odpowiedzi naraz. */
export const MAKS_ODPOWIEDZI = 3

/** Id pytania noul tematu w zapytaniu do pośrednika. */
export const idTematu = (t: Pick<Temat, 'id'>) => `temat_${t.id}`

const TEMAT_WARSTWY = new Map(TEMATY.flatMap((t) => t.warstwy.map((w) => [w, t.id] as const)))
/** Temat warstwy; warstwa spoza tematów jest sama dla siebie tematem. */
export const tematWarstwy = (warstwa: string) => TEMAT_WARSTWY.get(warstwa) ?? `warstwa:${warstwa}`

export function zapytanieJev(pytanie: string, lista: readonly PozycjaListy[]): ZapytanieJev {
  const ids = new Set(lista.map((p) => p.id))
  const pytania: ZapytanieJev['pytania'] = { [ID_PYTANIA]: wybor(POLECENIE, kryteria(lista)) }
  // Temat bez żadnej warstwy na liście nic by nie dołożył – nie pytamy o niego.
  for (const t of TEMATY)
    if (t.warstwy.some((w) => ids.has(w))) pytania[idTematu(t)] = takNie(t.twierdzenie)
  return { stan: pytanie.slice(0, 2000), pytania }
}

/** Wybór warstwy: id z listy albo null = „nie wiem”. */
export interface WyborWarstwy {
  warstwa: string | null
}

/**
 * Odpowiedź JEV → wybór. null (= reguła zapasowa), gdy brak odpowiedzi, wybór spoza listy,
 * brak pewności albo pewność poniżej progu. `nie_wiem` z pewnością to uczciwe „nie wiem”.
 */
export function przetworz(
  odpowiedzi: Record<string, OdpowiedzJev | null>,
  lista: readonly PozycjaListy[],
): WyborWarstwy | null {
  const o = odpowiedzi[ID_PYTANIA]
  if (!o || o.typ !== 'choice') return null
  if (o.pewnosc === null || !(o.pewnosc >= PROG_PEWNOSCI)) return null
  if (o.wybor === NIE_WIEM) return { warstwa: null }
  return lista.some((p) => p.id === o.wybor) ? { warstwa: o.wybor } : null
}

/** Wybór kilku warstw (#146): id z listy w kolejności pokazywania; [] = „nie wiem”. */
export interface WyborWarstw {
  warstwy: string[]
}

/**
 * Odpowiedź JEV → do 3 warstw. Pierwsza to `choice` (warstwa główna, te same zasady co
 * `przetworz`), potem tematy z noul ≥ progu malejąco. Temat, w który trafiła już wybrana
 * warstwa, nic nie dokłada; inaczej dokłada warstwę z grupy, którą wskazują reguły słów
 * kluczowych, a bez nich – domyślną. Pewne `nie_wiem` → „nie wiem” bez dodatków.
 */
export function przetworzWiele(
  odpowiedzi: Record<string, OdpowiedzJev | null>,
  lista: readonly PozycjaListy[],
  pytanie: string,
  prog: number = PROG_TEMATU,
): WyborWarstw | null {
  const glowny = przetworz(odpowiedzi, lista)
  if (!glowny) return null
  if (glowny.warstwa === null) return { warstwy: [] }
  const ids = new Set(lista.map((p) => p.id))
  const trafienia = trafieniaRegul(pytanie, lista)
  const wskazane = trafienia.map((t) => t.warstwa)
  const tematy = TEMATY.map((t) => {
    const o = odpowiedzi[idTematu(t)]
    return { t, noul: o?.typ === 'noul' ? o.noul : null }
  })
    .filter((x): x is { t: Temat; noul: number } => x.noul !== null && x.noul >= prog)
    .sort((a, b) => b.noul - a.noul) // sort stabilny: remis = kolejność TEMATY
  return {
    warstwy: drugieZTematu(
      dobierz(
        [glowny.warstwa],
        tematy.map((x) => x.t),
        wskazane,
        ids,
      ),
      nazwane(trafienia),
    ),
  }
}

/**
 * #147: dwa różne obiekty z jednego tematu („przedszkole i żłobek”, „apteka i przychodnia”).
 * Temat z `obiekty`, który ma już dokładnie jedną warstwę, dokłada drugą: pierwszą warstwę
 * tego tematu wskazaną przez reguły słów kluczowych, która jest INNYM obiektem niż ta, którą
 * już ma – bez dodatkowego wywołania JEV. #150: `wskazane` to tylko warstwy, których obiekt
 * pytanie nazywa wprost (bez słów samego tematu, `ogolne` w REGULY). Najpierw liczą się różne tematy (dobierz), drugie
 * warstwy idą tylko w wolne miejsca do MAKS_ODPOWIEDZI, zaraz po pierwszej z tematu.
 */
export function drugieZTematu(warstwy: readonly string[], wskazane: readonly string[]): string[] {
  const wynik = [...warstwy]
  for (const t of TEMATY) {
    if (wynik.length >= MAKS_ODPOWIEDZI) break
    const obiekty = t.obiekty
    if (!obiekty) continue
    const wTemacie = wynik.filter((w) => tematWarstwy(w) === t.id)
    const pierwsza = wTemacie[0]
    if (wTemacie.length !== 1 || pierwsza === undefined) continue
    const obiekt = obiekty[pierwsza]
    if (obiekt === undefined) continue
    const druga = wskazane.find(
      (w) => obiekty[w] !== undefined && obiekty[w] !== obiekt && !wynik.includes(w),
    )
    if (druga) wynik.splice(wynik.indexOf(pierwsza) + 1, 0, druga)
  }
  return wynik
}

/** Dokłada po jednej warstwie z kolejnych tematów, aż do MAKS_ODPOWIEDZI. */
function dobierz(
  start: readonly string[],
  tematy: readonly Temat[],
  wskazane: readonly string[],
  ids: ReadonlySet<string>,
): string[] {
  const wynik = [...start]
  const zajete = new Set(wynik.map(tematWarstwy))
  for (const t of tematy) {
    if (wynik.length >= MAKS_ODPOWIEDZI) break
    if (zajete.has(t.id)) continue
    const warstwa =
      wskazane.find((w) => tematWarstwy(w) === t.id && ids.has(w)) ??
      (ids.has(t.domyslna) ? t.domyslna : t.warstwy.find((w) => ids.has(w)))
    if (!warstwa) continue
    wynik.push(warstwa)
    zajete.add(t.id)
  }
  return wynik
}

// --- Reguła zapasowa: słowa kluczowe po polsku -------------------------------------------

/** Małe litery bez polskich znaków – „Głośno” i „glosno” to to samo. */
export function normalizuj(tekst: string): string {
  return tekst
    .toLowerCase()
    .replace(/ł/g, 'l')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Reguły w kolejności pierwszeństwa (bardziej szczegółowe wyżej). Każda ma kandydatów –
 * pierwsza warstwa z listy, która istnieje. Wzorce działają na tekście po `normalizuj`.
 * Wygrywa reguła z największą liczbą trafionych wzorców; remis – wyższa na liście.
 */
export const REGULY: readonly {
  warstwy: readonly string[]
  wzorce: readonly RegExp[]
  /**
   * #150: słowa samego tematu („rower”). Liczą się do wyboru warstwy jak `wzorce`, ale nie
   * nazywają osobnego obiektu – nie dokładają drugiej warstwy z tematu (`drugieZTematu`).
   * Inaczej „gdzie przypiąć rower” dostawało obok stojaków trasę rowerową.
   */
  ogolne?: readonly RegExp[]
}[] = [
  { warstwy: ['szkola_podst_wynik_e8'], wzorce: [/\be8\b/, /egzamin/, /(dobr|najlepsz)\w* szkol/] },
  {
    warstwy: ['przychodnia_bez_barier_odleglosc'],
    wzorce: [/bez barier/, /dostepn\w* (przychodn|lekarz)/],
  },
  { warstwy: ['kursy_szczyt_h'], wzorce: [/jak czesto/, /\bkurs/, /czestotliw/, /szczyt/] },
  { warstwy: ['lotnisko_czas_min'], wzorce: [/lotnisk/, /balic/, /samolot/] },
  { warstwy: ['rynek_czas_min'], wzorce: [/\brynek/, /\brynku/, /centrum/, /do miasta/] },
  {
    warstwy: ['przystanek_odleglosc'],
    wzorce: [/przystan/, /autobus/, /tramwaj/, /komunikacj/, /\bmpk\b/],
  },
  {
    warstwy: ['halas_ldwn'],
    wzorce: [/glos/, /halas/, /\bcich/, /\bcisz/, /spokojn/, /\bhuk/, /decybel/, /\bdb\b/],
  },
  { warstwy: ['pm10_srednia'], wzorce: [/pm ?10/] },
  { warstwy: ['no2_srednia'], wzorce: [/\bno2\b/, /azot/, /spalin/] },
  { warstwy: ['bap_srednia'], wzorce: [/benzo/, /\bbap\b/, /piec(e|ow|uch)/, /wegl/] },
  {
    warstwy: ['pm25_srednia', 'pm10_srednia'],
    wzorce: [/powietrz/, /smog/, /\bpyl/, /pm ?2/, /oddych/, /zanieczyszcz/],
  },
  { warstwy: ['drzewa_100m'], wzorce: [/drzew/] },
  {
    warstwy: ['zielen_worldcover_100m', 'zielen_udzial', 'drzewa_100m'],
    wzorce: [/ziel/, /\bpark(u|i|ow|iem)?\b/, /traw/, /przyrod/, /natur/],
  },
  {
    warstwy: ['powodz_1proc', 'powodz_10proc', 'powodz_02proc', 'gmina_powodz_powierzchnia_pct'],
    wzorce: [/zalew/, /zalan/, /powodz/, /podtop/, /wylew/],
  },
  {
    warstwy: ['cena_m2_mediana'],
    wzorce: [
      /kosztuj/,
      /\bcen(a|y|e|ie|ach)\b/,
      /\bdrog(o|ie)\b/,
      /\bmetr/,
      /\bm2\b/,
      /\bzl\b/,
      /tanio/,
    ],
  },
  { warstwy: ['apteka_odleglosc'], wzorce: [/aptek/, /\bleki\b/, /\blekow\b/, /lekarstw/] },
  { warstwy: ['przedszkole_odleglosc'], wzorce: [/przedszkol/] },
  { warstwy: ['zlobek_odleglosc'], wzorce: [/zlob/] },
  // #147: \b – inaczej „przedszkola” trafiało też szkołę (fałszywa druga warstwa z tematu).
  { warstwy: ['szkola_podst_odleglosc'], wzorce: [/\bszkol/, /podstawowk/] },
  { warstwy: ['przychodnia_odleglosc'], wzorce: [/przychodn/, /lekarz/, /\bpoz\b/, /doktor/] },
  {
    warstwy: ['sklep_odleglosc'],
    wzorce: [/sklep/, /zakup/, /spozyw/, /biedronk/, /zabk/, /\blidl/],
  },
  { warstwy: ['uslugi_15min'], wzorce: [/uslug/, /15 minut/, /wszystko blisko/, /pod reka/] },
  { warstwy: ['lawki_300m'], wzorce: [/lawk/, /usiasc/] },
  { warstwy: ['obnizone_krawezniki_300m'], wzorce: [/kraweznik/, /wozk/, /niepelnospraw/] },
  { warstwy: ['oswietlenie_100m'], wzorce: [/latarn/, /oswietl/, /ciemno/] },
  // #146: tematy rower, bezpieczeństwo i przemysł/grunt nie miały reguł – bez nich zapas
  // nie umiał dołożyć ich warstwy.
  { warstwy: ['policja_odleglosc'], wzorce: [/policj/, /komisariat/] },
  { warstwy: ['stojaki_300m'], wzorce: [/stojak/, /przypi/] },
  {
    warstwy: ['rower_infrastruktura_odleglosc', 'droga_rowerowa_odleglosc'],
    // Trasę nazywa jazda („rowerem”, „na rowerze”) albo droga; samo „rower” to słowo tematu.
    wzorce: [/sciezk/, /\btras/, /rowerem/, /na rowerze/],
    ogolne: [/rower/],
  },
  { warstwy: ['teren_osuwiskowy', 'osuwisko_odleglosc'], wzorce: [/osuw/, /osiada/] },
  { warstwy: ['azbest_budynki_100m'], wzorce: [/azbest/, /eternit/] },
  { warstwy: ['sct_w_strefie'], wzorce: [/\bsct\b/, /czystego transportu/, /diesl/] },
  { warstwy: ['spp_podstrefa'], wzorce: [/parkow/, /parkuj/, /parking/, /strefa platn/] },
  { warstwy: ['bo_projekty_1km'], wzorce: [/budzet\w* obywatel/, /projekt\w* (bo|obywatel)/] },
  { warstwy: ['inwestycje_500m'], wzorce: [/budow/, /buduj/, /inwestycj/, /dzwig/, /pozwoleni/] },
  { warstwy: ['mpzp_status'], wzorce: [/plan\w* miejscow/, /\bmpzp\b/, /zabudow/] },
  { warstwy: ['punkt_schronienia_odleglosc'], wzorce: [/schron/, /ukryc/] },
  { warstwy: ['przetargi_dzielnica'], wzorce: [/przetarg/, /zamowien/] },
  { warstwy: ['gmina_dlug_pc'], wzorce: [/dlug/, /zadluz/] },
  { warstwy: ['pozary_gmina_2025'], wzorce: [/pozar/, /ogien/, /strazak/] },
  { warstwy: ['miejscowe_zagrozenia_gmina_2025'], wzorce: [/zagrozen/, /wypadk/, /bezpieczn/] },
  { warstwy: ['udzial_65plus'], wzorce: [/senior/, /emeryt/, /starsz/] },
  { warstwy: ['udzial_0_14'], wzorce: [/dzieci/, /dziecm/, /mlodych rodzin/] },
  { warstwy: ['ludnosc_1km'], wzorce: [/ludn/, /zaludn/, /gest/, /tlum/, /ile osob/, /ilu ludzi/] },
]

/** Przykładowe pytania na „nie wiem” – pokazujemy tylko te, których warstwa jest na liście. */
export const PODPOWIEDZI: readonly { pytanie: string; warstwa: string }[] = [
  { pytanie: 'Jak głośno tu jest?', warstwa: 'halas_ldwn' },
  { pytanie: 'Daleko do przystanku?', warstwa: 'przystanek_odleglosc' },
  { pytanie: 'Czy jest tu zielono?', warstwa: 'zielen_worldcover_100m' },
  { pytanie: 'Jakie jest powietrze?', warstwa: 'pm25_srednia' },
  { pytanie: 'Czy tu zalewa?', warstwa: 'powodz_1proc' },
  { pytanie: 'Ile kosztuje metr?', warstwa: 'cena_m2_mediana' },
]

export function podpowiedzi(lista: readonly PozycjaListy[]): string[] {
  const ids = new Set(lista.map((p) => p.id))
  return PODPOWIEDZI.filter((p) => ids.has(p.warstwa)).map((p) => p.pytanie)
}

/** Reguła bez AI: pytanie → id warstwy z listy albo null („nie wiem”). Deterministyczna. */
export function regula(pytanie: string, lista: readonly PozycjaListy[]): WyborWarstwy {
  let najlepsza: string | null = null
  let trafien = 0
  for (const t of trafieniaRegul(pytanie, lista)) {
    if (t.n > trafien) {
      trafien = t.n
      najlepsza = t.warstwa
    }
  }
  return { warstwa: najlepsza }
}

interface TrafienieReguly {
  warstwa: string
  /** Liczba trafionych wzorców (z `ogolne`). */
  n: number
  /** Pozycja pierwszego trafienia w znormalizowanym pytaniu. */
  poz: number
  /** #150: pytanie nazywa obiekt warstwy (trafił wzorzec spoza `ogolne`). */
  nazwany: boolean
}

/** #150: warstwy, których obiekt pytanie nazywa wprost – kandydaci na drugą warstwę z tematu. */
const nazwane = (t: readonly TrafienieReguly[]) => t.filter((x) => x.nazwany).map((x) => x.warstwa)

/** Wszystkie reguły, które coś trafiły, w kolejności REGULY (pierwszeństwa). */
function trafieniaRegul(pytanie: string, lista: readonly PozycjaListy[]): TrafienieReguly[] {
  const tekst = normalizuj(pytanie)
  const ids = new Set(lista.map((p) => p.id))
  const wynik: TrafienieReguly[] = []
  for (const r of REGULY) {
    const warstwa = r.warstwy.find((w) => ids.has(w))
    if (!warstwa) continue
    let n = 0
    let poz = Number.POSITIVE_INFINITY
    let nazwany = false
    for (const [w, ogolny] of [
      ...r.wzorce.map((w) => [w, false] as const),
      ...(r.ogolne ?? []).map((w) => [w, true] as const),
    ]) {
      const m = w.exec(tekst)
      if (!m) continue
      n++
      poz = Math.min(poz, m.index)
      if (!ogolny) nazwany = true
    }
    if (n > 0) wynik.push({ warstwa, n, poz, nazwany })
  }
  return wynik
}

/**
 * Reguła zapasowa dla pytań złożonych (#146): wszystkie pasujące grupy reguł, po jednej na
 * temat, w kolejności, w jakiej temat pada w pytaniu – do MAKS_ODPOWIEDZI. W obrębie tematu
 * wygrywa reguła jak w `regula` (więcej trafionych wzorców, remis – wyżej na liście).
 */
export function regulaWiele(pytanie: string, lista: readonly PozycjaListy[]): WyborWarstw {
  const tematy = new Map<string, TrafienieReguly & { pozTematu: number }>()
  const trafienia = trafieniaRegul(pytanie, lista)
  for (const t of trafienia) {
    const id = tematWarstwy(t.warstwa)
    const byla = tematy.get(id)
    if (!byla) tematy.set(id, { ...t, pozTematu: t.poz })
    else {
      const pozTematu = Math.min(byla.pozTematu, t.poz)
      tematy.set(id, t.n > byla.n ? { ...t, pozTematu } : { ...byla, pozTematu })
    }
  }
  const warstwy = [...tematy.values()]
    .sort((a, b) => a.pozTematu - b.pozTematu)
    .slice(0, MAKS_ODPOWIEDZI)
    .map((t) => t.warstwa)
  // #147: wolne miejsca – druga warstwa z tematu, w którym pytanie nazywa dwa różne obiekty.
  return {
    warstwy: drugieZTematu(warstwy, nazwane(trafienia)),
  }
}

// --- Odpowiedź z danych ------------------------------------------------------------------

export type ZrodloOdpowiedzi = 'jev' | 'reguly'

export interface OdpowiedzWarstwy {
  rodzaj: 'warstwa'
  warstwa: string
  /** Nazwa warstwy z metadanych. */
  etykieta: string
  /** Surowa wartość pod adresem z public/dane; null = brak danych (nigdy 0). */
  wartosc: number | null
  /** Do wyświetlenia: „240 m – Rondo Mogilskie”, „tak”, „brak danych”. */
  tekst: string
  /** Sama wartość z jednostką („240 m”, „tak”, „brak danych”) – bez opisu miejsca. */
  tekstWartosci: string
  /** Opis z danych dla tego adresu (etykiety[i]), np. „Rondo Mogilskie”; null = brak. */
  opisMiejsca: string | null
  jednostka: string
  /** Nazwy źródeł z metadanych, rozdzielone „; ”. */
  zrodlo: string
  zrodla: Zrodlo[]
  /** „adres”, „siatka 100 m”, „gmina”… – czego naprawdę dotyczy liczba. */
  rozdzielczosc: string
  dataDanych: string | null
  atrapa: boolean
  /** Plik warstwy się nie wczytał – brak danych z powodu warstwy, nie adresu. */
  niedostepny: boolean
  zrodloOdpowiedzi: ZrodloOdpowiedzi
}

export interface OdpowiedzNieWiem {
  rodzaj: 'nie-wiem'
  podpowiedzi: string[]
  zrodloOdpowiedzi: ZrodloOdpowiedzi
}

export type Odpowiedz = OdpowiedzWarstwy | OdpowiedzNieWiem

const FORMAT = new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 1 })
export const BRAK_DANYCH = 'brak danych'

export function tekstWartosci(
  wartosc: number | null,
  jednostka: string,
  etykieta: string | null,
): string {
  if (wartosc === null || !Number.isFinite(wartosc)) return BRAK_DANYCH
  if (jednostka === 'status' && etykieta) return etykieta
  const baza =
    jednostka === '0/1' && (wartosc === 0 || wartosc === 1)
      ? wartosc === 1
        ? 'tak'
        : 'nie'
      : `${FORMAT.format(wartosc)} ${jednostka === 'status' ? '' : jednostka}`.trim()
  return etykieta ? `${baza} – ${etykieta}` : baza
}

export function opisRozdzielczosci(meta: Pick<WskaznikMeta, 'rozdzielczosc' | 'rozmiar'>) {
  return meta.rozmiar && meta.rozmiar !== meta.rozdzielczosc
    ? `${meta.rozdzielczosc} ${meta.rozmiar}`
    : meta.rozdzielczosc
}

/**
 * Buduje odpowiedź z danych dla adresu `i`. Jedyne wejście z JEV albo reguły to `wybor.warstwa`
 * (id) – wartość, jednostkę, źródło i rozdzielczość czytamy z warstwy w `wskazniki`.
 */
export function odpowiedz(
  wybor: WyborWarstwy,
  wskazniki: readonly WarstwaDanych[],
  i: number,
  zrodloOdpowiedzi: ZrodloOdpowiedzi,
): Odpowiedz {
  const w = wybor.warstwa ? wskazniki.find((x) => x.meta.id === wybor.warstwa) : undefined
  if (!w || w.meta.atrapa) {
    return {
      rodzaj: 'nie-wiem',
      podpowiedzi: podpowiedzi(listaWarstw(wskazniki.map((x) => x.meta))),
      zrodloOdpowiedzi,
    }
  }
  const surowa = w.niedostepny ? null : (w.wartosci[i] ?? null)
  const wartosc = typeof surowa === 'number' && Number.isFinite(surowa) ? surowa : null
  const etykieta = wartosc === null ? null : (w.etykiety?.[i] ?? null)
  const m = w.meta
  return {
    rodzaj: 'warstwa',
    warstwa: m.id,
    etykieta: m.nazwa,
    wartosc,
    tekst: tekstWartosci(wartosc, m.jednostka, etykieta),
    tekstWartosci:
      m.jednostka === 'status' && etykieta ? etykieta : tekstWartosci(wartosc, m.jednostka, null),
    opisMiejsca: m.jednostka === 'status' ? null : etykieta,
    jednostka: m.jednostka,
    zrodlo: m.zrodla.map((z) => z.nazwa).join('; '),
    zrodla: m.zrodla,
    rozdzielczosc: opisRozdzielczosci(m),
    dataDanych: m.zrodla[0]?.dataDanych ?? null,
    atrapa: Boolean(m.atrapa),
    niedostepny: Boolean(w.niedostepny),
    zrodloOdpowiedzi,
  }
}

/**
 * Kilka warstw → kilka odpowiedzi z danych, w tej samej kolejności. Warstwa, której nie da się
 * pokazać (nie ma jej w danych albo to atrapa), przepada; gdy nie zostanie żadna – „nie wiem”.
 */
export function odpowiedzi(
  wybor: WyborWarstw,
  wskazniki: readonly WarstwaDanych[],
  i: number,
  zrodloOdpowiedzi: ZrodloOdpowiedzi,
): Odpowiedz[] {
  const warstwy = [...new Set(wybor.warstwy)]
    .slice(0, MAKS_ODPOWIEDZI)
    .map((warstwa) => odpowiedz({ warstwa }, wskazniki, i, zrodloOdpowiedzi))
    .filter((o) => o.rodzaj === 'warstwa')
  return warstwy.length > 0
    ? warstwy
    : [odpowiedz({ warstwa: null }, wskazniki, i, zrodloOdpowiedzi)]
}

/**
 * Całość (#146): jedno wywołanie JEV wybiera warstwę główną i ocenia tematy, a gdy nie może –
 * reguła z kilkoma tematami. Zwraca 1–3 odpowiedzi (albo jedno „nie wiem”), nigdy nie rzuca.
 * `zrodloOdpowiedzi` mówi, kto wybrał warstwy; liczby zawsze z danych.
 */
export async function zapytajOAdresWiele(
  pytanie: string,
  wskazniki: readonly WarstwaDanych[],
  i: number,
  opcje: OpcjeKlienta = {},
): Promise<Odpowiedz[]> {
  const lista = listaWarstw(wskazniki.map((w) => w.meta))
  const { wynik, zrodlo } = await zJevem(
    zapytanieJev(pytanie, lista),
    (odp) => przetworzWiele(odp, lista, pytanie),
    () => regulaWiele(pytanie, lista),
    opcje,
  )
  return odpowiedzi(wynik, wskazniki, i, zrodlo === 'jev' ? 'jev' : 'reguly')
}

/** Zgodność wstecz (#17): tylko pierwsza odpowiedź z `zapytajOAdresWiele`. */
export async function zapytajOAdres(
  pytanie: string,
  wskazniki: readonly WarstwaDanych[],
  i: number,
  opcje: OpcjeKlienta = {},
): Promise<Odpowiedz> {
  const [pierwsza] = await zapytajOAdresWiele(pytanie, wskazniki, i, opcje)
  return pierwsza ?? odpowiedz({ warstwa: null }, wskazniki, i, 'reguly')
}
