// Okolice do testów (#185): plik w formacie okolice.json zbudowany z kolumny id okolic, bez
// czytania dużego pliku z public/dane. Tylko dla testów – aplikacja go nie importuje.
import type { PlikOkolic } from '../kontrakty/index.ts'

type Wpisy = PlikOkolic['okolice']

/** Kilka jednostek SIM i miejscowości z prawdziwymi numerami, nazwami i dzielnicami. */
export const OKOLICE_TESTOWE: Wpisy = {
  'sim-101': {
    nazwa: 'Stare Miasto',
    numer: 'I.1',
    rodzaj: 'sim',
    dzielnica: 'I Stare Miasto',
    gmina: 'Kraków',
    powierzchniaKm2: 0.933,
    liczbaAdresow: 0,
    potoczne: [],
  },
  'sim-102': {
    nazwa: 'Kazimierz',
    numer: 'I.2',
    rodzaj: 'sim',
    dzielnica: 'I Stare Miasto',
    gmina: 'Kraków',
    powierzchniaKm2: 1.1,
    liczbaAdresow: 0,
    potoczne: [],
  },
  'sim-1002': {
    nazwa: 'Swoszowice',
    numer: 'X.2',
    rodzaj: 'sim',
    dzielnica: 'X Swoszowice',
    gmina: 'Kraków',
    powierzchniaKm2: 2.4,
    liczbaAdresow: 0,
    potoczne: [],
  },
  'm-1206063-liszki': {
    nazwa: 'Liszki',
    rodzaj: 'miejscowosc',
    dzielnica: null,
    gmina: 'Liszki',
    liczbaAdresow: 0,
  },
  'm-1206063-kaszow': {
    nazwa: 'Kaszów',
    rodzaj: 'miejscowosc',
    dzielnica: null,
    gmina: 'Liszki',
    liczbaAdresow: 0,
  },
  'm-1219053-wieliczka': {
    nazwa: 'Wieliczka',
    rodzaj: 'miejscowosc',
    dzielnica: null,
    gmina: 'Wieliczka',
    liczbaAdresow: 0,
  },
}

/**
 * Plik okolic dla adresów o podanych id okolic (kolejność jak w adresy.json); null = adres bez
 * okolicy. Nieznane id rzuca, żeby literówka w teście nie zamieniła się w cichy brak okolicy.
 */
export function plikOkolic(
  kolumna: readonly (string | null)[],
  wersjaAdresow = 'test',
  okolice: Wpisy = OKOLICE_TESTOWE,
): PlikOkolic {
  const idOkolic = Object.keys(okolice)
  return {
    wersjaAdresow,
    metoda: 'sim-msip',
    opis: 'okolice testowe',
    rozdzielczosc: 'adres',
    zrodla: [],
    kontrola: {},
    okolice,
    idOkolic,
    slownikNazw: [],
    rozjazdy: [],
    kolumny: {
      okolica: kolumna.map((id) => {
        if (id === null) return null
        const p = idOkolic.indexOf(id)
        if (p < 0) throw new Error(`okoliceTestowe: nieznana okolica ${id}`)
        return p
      }),
    },
  }
}
