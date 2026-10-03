import type { WskaznikMeta } from '../kontrakty/index.ts'

/** Strukturalny podzbiór RozbicieWarstwy z silnika E3. */
export interface WarstwaDoDzialania {
  id: string
  meta: WskaznikMeta
  wartosc: number | null
  ocena: number | null
}

export interface ZalozeniaDzialania {
  /** Tempo marszu podane przez użytkownika. */
  kmNaGodzine: number
  /** Subiektywna wartość godziny, a nie wydatek pieniężny. */
  zlZaGodzine: number
  /** Podróże w obie strony na tydzień, osobno dla każdego celu. */
  wyjsciaTygodniowo: Readonly<Record<string, number>>
}

export const DOMYSLNE_ZALOZENIA: ZalozeniaDzialania = {
  kmNaGodzine: 4.8,
  zlZaGodzine: 25,
  wyjsciaTygodniowo: { przystanek_odleglosc: 10, sklep_odleglosc: 3 },
}

interface SzablonDzialania {
  id: string
  celMetry: number
  tytul: string
  dzialanie: string
}

const SZABLONY: readonly SzablonDzialania[] = [
  {
    id: 'przystanek_odleglosc',
    celMetry: 300,
    tytul: 'Przystanek bliżej domu',
    dzialanie: 'Nowy przystanek lub wejście na linię w odległości 300 m',
  },
  {
    id: 'sklep_odleglosc',
    celMetry: 300,
    tytul: 'Sklep bliżej domu',
    dzialanie: 'Sklep spożywczy w odległości 300 m',
  },
]

export interface ScenariuszDzialania {
  id: string
  tytul: string
  dzialanie: string
  obecnieMetry: number
  celMetry: number
  roznicaMetry: number
  ocena: number | null
  /** Dolne oszacowanie czasu według odległości w linii prostej. */
  godzinyRocznie: number
  /** Wartość czasu; nie oznacza oszczędności gotówkowej. */
  wartoscCzasuRocznie: number
  atrapa: boolean
  meta: WskaznikMeta
  wyjsciaTygodniowo: number
}

function bezpiecznyZakres(wartosc: number, minimum: number, maksimum: number): number {
  return Number.isFinite(wartosc) ? Math.min(Math.max(wartosc, minimum), maksimum) : minimum
}

/** Wartości założeń ograniczamy, żeby błędny input nie dał Infinity albo absurdalnych liczb. */
export function normalizujZalozenia(zalozenia: ZalozeniaDzialania): ZalozeniaDzialania {
  return {
    kmNaGodzine: bezpiecznyZakres(zalozenia.kmNaGodzine, 1, 10),
    zlZaGodzine: bezpiecznyZakres(zalozenia.zlZaGodzine, 0, 1000),
    wyjsciaTygodniowo: Object.fromEntries(
      Object.entries(zalozenia.wyjsciaTygodniowo).map(([id, liczba]) => [
        id,
        bezpiecznyZakres(liczba, 0, 50),
      ]),
    ),
  }
}

/**
 * Scenariusze tylko dla mierzalnych, słabszych warstw. Nie zgadujemy kosztu inwestycji
 * ani przyszłego wyniku – pokazujemy czas przemieszczania wynikający z jawnych założeń.
 * Brak danych lub niezgodna jednostka = brak scenariusza.
 */
export function policzScenariusze(
  warstwy: readonly WarstwaDoDzialania[],
  zalozenia: ZalozeniaDzialania = DOMYSLNE_ZALOZENIA,
): ScenariuszDzialania[] {
  const z = normalizujZalozenia(zalozenia)
  return SZABLONY.flatMap((szablon) => {
    const warstwa = warstwy.find((w) => w.id === szablon.id)
    if (
      !warstwa ||
      warstwa.wartosc === null ||
      !Number.isFinite(warstwa.wartosc) ||
      warstwa.wartosc <= szablon.celMetry ||
      warstwa.meta.jednostka !== 'm' ||
      warstwa.ocena === null ||
      warstwa.ocena >= 70
    )
      return []

    const wyjsciaTygodniowo = z.wyjsciaTygodniowo[szablon.id] ?? 0
    const roznicaMetry = warstwa.wartosc - szablon.celMetry
    // 2 odcinki na podróż w obie strony, 52 tygodnie; metry → kilometry → godziny.
    const godzinyRocznie = (roznicaMetry / 1000 / z.kmNaGodzine) * 2 * wyjsciaTygodniowo * 52
    return [
      {
        id: szablon.id,
        tytul: szablon.tytul,
        dzialanie: szablon.dzialanie,
        obecnieMetry: warstwa.wartosc,
        celMetry: szablon.celMetry,
        roznicaMetry,
        ocena: warstwa.ocena,
        godzinyRocznie,
        wartoscCzasuRocznie: godzinyRocznie * z.zlZaGodzine,
        atrapa: warstwa.meta.atrapa === true,
        meta: warstwa.meta,
        wyjsciaTygodniowo,
      },
    ]
  }).sort((a, b) => (a.ocena ?? 100) - (b.ocena ?? 100))
}
