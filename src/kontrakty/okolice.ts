// Kontrakt okolic adresów (#75, #185): public/dane/okolice.json. Okolica adresu w Krakowie to
// jednostka SIM (123 jednostki z MSIP), poza Krakowem – miejscowość w gminie. Format, kontrola
// jakości i rozjazdy: etl/okolice.md. To NIE jest wskaźnik: nie wchodzi do manifestu ani do kompaktu.
//
// Osobny plik, bo `index.ts` czyta `import.meta.env` (Vite) i nie da się go załadować pod gołym
// `node --test`. Tu zostają typy i czysta kontrola wersji, którą testy mogą wywołać bez Vite.
import type { Zrodlo } from './index.ts'

/** Jednostka SIM Krakowa (`rodzaj: 'sim'`). */
export interface Okolica {
  /** „Ludwinów”. */
  nazwa: string
  /** Numer jednostki, np. „VIII.3”. */
  numer: string
  rodzaj: 'sim'
  /** Dzielnica jak w `PlikAdresow.kolumny.dzielnica`, np. „VIII Dębniki”. */
  dzielnica: string
  gmina: 'Kraków'
  powierzchniaKm2: number
  liczbaAdresow: number
  /** Nazwy OSM leżące w jednostce, bez nazwy samej jednostki. */
  potoczne: string[]
}

/**
 * Miejscowość poza Krakowem (`rodzaj: 'miejscowosc'`), np. id „m-1219064-grabowki”. Nazwy się
 * powtarzają między gminami („Grabie” w dwóch), więc o miejscowości decyduje para nazwa + gmina.
 */
export interface OkolicaMiejscowosc {
  nazwa: string
  rodzaj: 'miejscowosc'
  dzielnica: null
  gmina: string
  liczbaAdresow: number
}

/** Wpis słownika potocznych nazw osiedli (OSM); pomijamy wpisy powtarzające nazwę jednostki. */
export interface WpisSlownika {
  /** Nazwa z OSM, bez zmian. */
  nazwa: string
  place: 'neighbourhood' | 'quarter'
  /** [0] = jednostka, w której leży punkt OSM; dalej jednostki, do których nazwa pasuje. */
  jednostki: string[]
  /** „node/123”, „way/456”. */
  osm: string[]
}

export type RodzajRozjazdu =
  | 'nazwa-szersza-niz-jednostka'
  | 'nazwa-poza-jednostka-o-tej-nazwie'
  | 'nazwa-w-kilku-jednostkach'
  | 'jednostka-bez-miejsc-osm'
  | 'nazwa-jednostki-jak-dzielnica'
  | 'nazwa-jednostki-z-innej-dzielnicy'
  | 'okolica-poza-krakowem'
  | 'osiedle-w-kilku-jednostkach'

/** Miejsce, w którym podział SIM i potoczne nazwy się rozjeżdżają. `opis` nadaje się do pokazania wprost. */
export interface Rozjazd {
  rodzaj: RodzajRozjazdu
  opis: string
  /** Id jednostek SIM; brak przy `okolica-poza-krakowem`. */
  jednostki?: string[]
  nazwa?: string
  dzielnica?: string
  udzialPowierzchniDzielnicyProc?: number
  /** Tylko `osiedle-w-kilku-jednostkach`: % obrysu osiedla w każdej jednostce i liczba adresów. */
  udzialyProc?: Record<string, number>
  adresy?: Record<string, number>
}

/** Plik public/dane/okolice.json. */
export interface PlikOkolic {
  /** Musi się zgadzać z PlikAdresow.wersja – inaczej okolice trafiłyby pod złe adresy. */
  wersjaAdresow: string
  metoda: 'sim-msip'
  opis: string
  rozdzielczosc: 'adres'
  zrodla: Zrodlo[]
  /** Liczby z kontroli jakości (etl/okolice.md). */
  kontrola: Record<string, unknown>
  /** Klucz = id okolicy: „sim-803” albo „m-<teryt gminy>-<slug miejscowości>”. */
  okolice: Record<string, Okolica | OkolicaMiejscowosc>
  /** Kolejność okolic: jednostki SIM po numerze, potem miejscowości po id. */
  idOkolic: string[]
  slownikNazw: WpisSlownika[]
  rozjazdy: Rozjazd[]
  kolumny: {
    /** Dla i-tego adresu z PlikAdresow: indeks w `idOkolic`. null = brak danych, nigdy 0. */
    okolica: (number | null)[]
  }
}

/**
 * Powód, dla którego plik okolic nie pasuje do adresów, albo null, gdy pasuje. Sprawdza wersję
 * adresów (kontrakt) i długość kolumny (zabezpieczenie: kolumna krótsza od listy adresów
 * przesunęłaby okolice o jeden adres).
 */
export function niezgodnoscOkolic(
  plik: Pick<PlikOkolic, 'wersjaAdresow' | 'kolumny'>,
  wersjaAdresow: string,
  liczbaAdresow?: number,
): string | null {
  if (plik.wersjaAdresow !== wersjaAdresow) {
    return `liczone dla adresów ${plik.wersjaAdresow}, mamy ${wersjaAdresow}`
  }
  const wpisow = plik.kolumny.okolica.length
  if (liczbaAdresow !== undefined && wpisow !== liczbaAdresow) {
    return `kolumna okolic ma ${wpisow} wpisów, adresów jest ${liczbaAdresow}`
  }
  return null
}
