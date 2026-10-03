// Luki w usługach – rdzeń trybu „Dla miasta” (#89). Pytanie miasta, nie kupującego:
// ile adresów nie ma usługi w zasięgu progu. Dlatego luka NIE zależy od wag, persony ani
// kierunku użytkownika – liczy się z surowego pomiaru i jawnego progu z PROGI_LUK.
//
// Czyste funkcje bez DOM i bez Reacta (testy na gołym `node --test`), z kontraktu tylko typy.
//
// Zasady:
// - Adres bez danych idzie do osobnej szarej grupy `brakDanych`, nigdy do „bez luki”.
// - Podstawa udziału = wszystkie adresy jednostki (w luce + bez luki + brak danych).
// - Warstwa z `meta.atrapa` nie daje wyniku: luka na wymyślonych danych to fałszywy wniosek.
// - Liczymy adresy, nie mieszkańców – podpis „adresy”, dopóki nie wejdzie #74 albo #40.
import type { Adres, WskaznikMeta } from '../kontrakty/index.ts'
import type { GrupyHeksow, WskaznikPrzygotowany } from './silnik.ts'

/** Podpis jednostki liczenia. Zmienić na „mieszkańcy” dopiero z #74 (zameldowania) albo #40 (GUS). */
export const JEDNOSTKA_LUKI = 'adresy'

export interface ProgLuki {
  /** Id wskaźnika z manifestu. */
  id: string
  /** Próg w jednostkach warstwy. Adres jest w luce, gdy wartość > prog (ostro). */
  prog: number
  jednostka: string
  /** Co znaczy „w luce” dla adresu, np. „dalej niż 800 m do sklepu spożywczego”. */
  opis: string
  /** Nagłówek rankingu (#91), np. „adresy bez sklepu spożywczego w 800 m”. */
  naglowek: string
  /** Skąd próg: przepis, wskaźnik albo jawnie „próg roboczy”. */
  zrodlo: string
}

/**
 * Jedyne miejsce progów luk. Odległości w warstwach to linia prosta, nie trasa pieszo,
 * więc rzeczywista luka jest raczej większa niż policzona.
 */
export const PROGI_LUK: Readonly<Record<string, ProgLuki>> = {
  sklep_odleglosc: {
    id: 'sklep_odleglosc',
    prog: 800,
    jednostka: 'm',
    opis: 'dalej niż 800 m (w linii prostej) do sklepu spożywczego',
    naglowek: 'adresy bez sklepu spożywczego w 800 m',
    zrodlo:
      'Ok. 10 minut pieszo. LEED v4 for Neighborhood Development, kredyt „Mixed-Use Neighborhoods” – usługi codzienne w ½ mili (ok. 805 m) dojścia.',
  },
  przystanek_odleglosc: {
    id: 'przystanek_odleglosc',
    prog: 500,
    jednostka: 'm',
    opis: 'dalej niż 500 m (w linii prostej) do przystanku z kursami',
    naglowek: 'adresy bez przystanku w 500 m',
    zrodlo:
      'Wskaźnik ONZ SDG 11.2.1 (UN-Habitat): wygodny dostęp do transportu publicznego = przystanek autobusu albo tramwaju w 500 m.',
  },
  punkt_schronienia_odleglosc: {
    id: 'punkt_schronienia_odleglosc',
    prog: 1000,
    jednostka: 'm',
    opis: 'dalej niż 1 km (w linii prostej) do Punktu Schronienia KG PSP',
    naglowek: 'adresy bez punktu schronienia w 1 km',
    zrodlo:
      'Próg roboczy z zadania #89 – przepisy nie podają dopuszczalnej odległości do punktu schronienia. Punkty to kategoria informacyjna KG PSP, nie potwierdzone schrony.',
  },
  przedszkole_odleglosc: {
    id: 'przedszkole_odleglosc',
    prog: 3000,
    jednostka: 'm',
    opis: 'dalej niż 3 km (w linii prostej) do przedszkola',
    naglowek: 'adresy bez przedszkola w 3 km',
    zrodlo:
      'Ustawa Prawo oświatowe (t.j. Dz.U. 2024 poz. 737), art. 32 ust. 3: gdy droga 5-latka do przedszkola przekracza 3 km, gmina zapewnia dowóz. Linia prosta jest krótsza niż droga, więc luka raczej niedoszacowana.',
  },
  zlobek_odleglosc: {
    id: 'zlobek_odleglosc',
    prog: 1500,
    jednostka: 'm',
    opis: 'dalej niż 1,5 km (w linii prostej) do żłobka lub klubu dziecięcego',
    naglowek: 'adresy bez żłobka w 1,5 km',
    zrodlo:
      'Próg roboczy – ustawa o opiece nad dziećmi do lat 3 nie podaje odległości. Ok. 20 minut pieszo z wózkiem.',
  },
  szkola_podst_odleglosc: {
    id: 'szkola_podst_odleglosc',
    prog: 3000,
    jednostka: 'm',
    opis: 'dalej niż 3 km (w linii prostej) do publicznej szkoły podstawowej',
    naglowek: 'adresy bez szkoły podstawowej w 3 km',
    zrodlo:
      'Ustawa Prawo oświatowe (t.j. Dz.U. 2024 poz. 737), art. 39 ust. 2: droga ucznia klas I–IV do szkoły nie może przekraczać 3 km, powyżej gmina zapewnia dowóz.',
  },
  plac_zabaw_odleglosc: {
    id: 'plac_zabaw_odleglosc',
    prog: 500,
    jednostka: 'm',
    opis: 'dalej niż 500 m (w linii prostej) do publicznego placu zabaw',
    naglowek: 'adresy bez placu zabaw w 500 m',
    zrodlo:
      'Próg roboczy: ok. 6 minut pieszo z małym dzieckiem. Rząd wielkości jak w zaleceniu WHO Europa (2016) – teren rekreacyjny w 300 m od domu.',
  },
  defibrylator_odleglosc: {
    id: 'defibrylator_odleglosc',
    prog: 500,
    jednostka: 'm',
    opis: 'dalej niż 500 m (w linii prostej) do ogólnodostępnego defibrylatora AED',
    naglowek: 'adresy bez defibrylatora AED w 500 m',
    zrodlo:
      'Próg roboczy: przy zatrzymaniu krążenia każda minuta bez defibrylacji obniża szansę przeżycia (wytyczne ERC 2021); 500 m to ok. 3 minuty marszu w jedną stronę, czyli ok. 6 minut po AED i z powrotem.',
  },
  halas_ldwn: {
    id: 'halas_ldwn',
    prog: 64,
    jednostka: 'dB',
    opis: 'hałas powyżej normy 64 dB LDWN',
    naglowek: 'adresy z hałasem powyżej normy',
    zrodlo:
      'Rozporządzenie Ministra Środowiska z 14 czerwca 2007 r. w sprawie dopuszczalnych poziomów hałasu w środowisku (t.j. Dz.U. 2014 poz. 112), tab. 1: drogi i linie kolejowe, zabudowa wielorodzinna – 64 dB LDWN. Warstwa podaje pasma (62,5 = pasmo 60–65 dB), więc w luce są tylko pasma w całości powyżej normy.',
  },
}

/** Warstwy z normą w `meta.norma`: próg luki = norma (przekroczenie przepisu). */
const PROG_Z_NORMY: ReadonlySet<string> = new Set(['halas_ldwn'])

/**
 * Próg luki dla warstwy albo null: warstwa-atrapa albo warstwa bez progu luki.
 * Gdy warstwa hałasu ma `meta.norma`, próg i źródło biorą się z niej.
 * Ekran wyboru warstwy (#90) pokazuje tylko warstwy, dla których to nie jest null.
 */
export function progLuki(meta: WskaznikMeta): ProgLuki | null {
  if (meta.atrapa) return null
  const p = PROGI_LUK[meta.id]
  if (!p) return null
  if (PROG_Z_NORMY.has(meta.id) && meta.norma && Number.isFinite(meta.norma.wartosc)) {
    const n = meta.norma.wartosc
    return {
      ...p,
      prog: n,
      opis: `hałas powyżej normy ${String(n).replace('.', ',')} ${p.jednostka} LDWN`,
      zrodlo: `${meta.norma.opis} (${meta.norma.zrodlo})`,
    }
  }
  return p
}

// ── Okolice ──────────────────────────────────────────────────────────────────────────────

export interface Okolica {
  /** Klucz jednostki, np. „dzielnica:VI Bronowice” albo „gmina:Zabierzów”. */
  id: string
  nazwa: string
  typ: 'dzielnica' | 'gmina'
}

/**
 * Okolica adresu. Docelowo jednostka SIM z #75; do tego czasu dzielnica Krakowa,
 * a poza Krakowem cała gmina obwarzanka.
 */
export function okolicaAdresu(a: Pick<Adres, 'dzielnica' | 'gmina'>): Okolica {
  if (a.dzielnica) return { id: `dzielnica:${a.dzielnica}`, nazwa: a.dzielnica, typ: 'dzielnica' }
  return { id: `gmina:${a.gmina}`, nazwa: a.gmina, typ: 'gmina' }
}

// ── Liczenie ─────────────────────────────────────────────────────────────────────────────

export type StanLuki = 'w-luce' | 'bez-luki' | 'brak-danych'

/** Stan jednego adresu. null, undefined i NaN to brak danych, nigdy „bez luki”. */
export function stanLuki(wartosc: number | null | undefined, prog: ProgLuki): StanLuki {
  if (wartosc === null || wartosc === undefined || Number.isNaN(wartosc)) return 'brak-danych'
  return wartosc > prog.prog ? 'w-luce' : 'bez-luki'
}

export interface LiczbyLuki {
  /** Wszystkie adresy jednostki = wLuce + bezLuki + brakDanych. */
  wszystkie: number
  wLuce: number
  bezLuki: number
  /** Szara grupa: adresy bez pomiaru. */
  brakDanych: number
  /** wLuce / wszystkie (podstawa = wszystkie adresy). null = żaden adres nie ma danych (szary). */
  udzial: number | null
}

export interface LukaOkolicy extends LiczbyLuki, Okolica {}

export interface WynikLuk {
  prog: ProgLuki
  meta: WskaznikMeta
  /** Zawsze „adresy” – patrz JEDNOSTKA_LUKI. */
  jednostka: typeof JEDNOSTKA_LUKI
  razem: LiczbyLuki
  /** Okolice malejąco po liczbie adresów w luce, przy remisie po nazwie. */
  okolice: LukaOkolicy[]
  /** H3 r10 → liczby; kolejność jak w `grupy.heksy` albo pierwszego wystąpienia. */
  heksy: Map<string, LiczbyLuki>
  /** Powód, gdy plik warstwy się nie wczytał (wtedy wszystko w `brakDanych`). */
  niedostepny?: string
}

interface Licznik {
  wLuce: number
  bezLuki: number
  brakDanych: number
}

const nowyLicznik = (): Licznik => ({ wLuce: 0, bezLuki: 0, brakDanych: 0 })

function dolicz(l: Licznik, s: StanLuki) {
  if (s === 'w-luce') l.wLuce++
  else if (s === 'bez-luki') l.bezLuki++
  else l.brakDanych++
}

function zamknij(l: Licznik): LiczbyLuki {
  const wszystkie = l.wLuce + l.bezLuki + l.brakDanych
  return {
    wszystkie,
    wLuce: l.wLuce,
    bezLuki: l.bezLuki,
    brakDanych: l.brakDanych,
    udzial: l.wLuce + l.bezLuki > 0 ? l.wLuce / wszystkie : null,
  }
}

/**
 * Luki jednej warstwy w podziale na okolice i heksy. Null, gdy warstwa jest atrapą albo
 * nie ma progu luki (`progLuki`). Adresy poza długością `wartosci` liczą się jako brak danych.
 * `grupy` (z `useDane`) tylko przyspiesza grupowanie heksów; bez nich grupujemy po `adres.h3`.
 */
export function policzLuki(
  wskaznik: Pick<WskaznikPrzygotowany, 'meta' | 'wartosci' | 'niedostepny'>,
  adresy: readonly Pick<Adres, 'dzielnica' | 'gmina' | 'h3'>[],
  grupy?: GrupyHeksow,
): WynikLuk | null {
  const prog = progLuki(wskaznik.meta)
  if (!prog) return null

  const razem = nowyLicznik()
  const okolice = new Map<string, { okolica: Okolica; licznik: Licznik }>()
  const zGrup = grupy !== undefined && grupy.indeksHeksu.length === adresy.length
  const heksyLicznik: Licznik[] = zGrup ? grupy.heksy.map(nowyLicznik) : []
  const heksyMapa = new Map<string, Licznik>()

  for (let i = 0; i < adresy.length; i++) {
    const a = adresy[i] as Pick<Adres, 'dzielnica' | 'gmina' | 'h3'>
    const s = stanLuki(wskaznik.wartosci[i], prog)
    dolicz(razem, s)

    const o = okolicaAdresu(a)
    let wpis = okolice.get(o.id)
    if (!wpis) {
      wpis = { okolica: o, licznik: nowyLicznik() }
      okolice.set(o.id, wpis)
    }
    dolicz(wpis.licznik, s)

    if (zGrup) {
      dolicz(heksyLicznik[grupy.indeksHeksu[i] as number] as Licznik, s)
    } else {
      let h = heksyMapa.get(a.h3)
      if (!h) {
        h = nowyLicznik()
        heksyMapa.set(a.h3, h)
      }
      dolicz(h, s)
    }
  }

  const heksy = new Map<string, LiczbyLuki>()
  if (zGrup) {
    for (let h = 0; h < grupy.heksy.length; h++) {
      const l = heksyLicznik[h] as Licznik
      if (l.wLuce + l.bezLuki + l.brakDanych > 0) heksy.set(grupy.heksy[h] as string, zamknij(l))
    }
  } else {
    for (const [h3, l] of heksyMapa) heksy.set(h3, zamknij(l))
  }

  const listaOkolic = [...okolice.values()]
    .map(({ okolica, licznik }): LukaOkolicy => ({ ...okolica, ...zamknij(licznik) }))
    .sort((a, b) => b.wLuce - a.wLuce || a.nazwa.localeCompare(b.nazwa, 'pl'))

  return {
    prog,
    meta: wskaznik.meta,
    jednostka: JEDNOSTKA_LUKI,
    razem: zamknij(razem),
    okolice: listaOkolic,
    heksy,
    ...(wskaznik.niedostepny === undefined ? {} : { niedostepny: wskaznik.niedostepny }),
  }
}
