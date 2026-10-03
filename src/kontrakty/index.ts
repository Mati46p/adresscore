// Kontrakt danych E2 (ETL, tor dane) → E3 (wynik, karta, mapa).
// Dlaczego surowe wartości, a nie gotowe oceny: wagi zmienia użytkownik na żywo (persony, JEV),
// więc przeliczenie na 0–100 należy do silnika w src/wynik. ETL dostarcza pomiar + metadane.
// Opis formatu plików i przykłady: docs/etapy/kontrakt-danych.md.

export const KATEGORIE = {
  codziennosc: 'Codzienność pieszo',
  transport: 'Transport',
  spokoj: 'Spokój i zdrowie',
  spolecznosc: 'Społeczność i koszty',
  /** Zachowane wyłącznie dla zgodności starszych ustawień i testowych danych. */
  przyszlosc: 'Przyszłość okolicy',
  bezpieczenstwo: 'Bezpieczeństwo i ryzyko',
  // Fakty na karcie bez wpływu na wynik (demografia, ceny, kontekst gminy).
  kontekst: 'Kontekst',
} as const

export type KategoriaId = keyof typeof KATEGORIE

/** Uczciwa rozdzielczość: czego naprawdę dotyczy liczba przypisana adresowi. */
export type Rozdzielczosc = 'adres' | 'budynek' | 'heks' | 'siatka' | 'rejon' | 'gmina' | 'powiat'

export type Kierunek = 'mniej-lepiej' | 'wiecej-lepiej' | 'neutralny'

export interface Zrodlo {
  nazwa: string
  url: string
  licencja: string
  /** Data stanu danych (ISO, np. „2022" albo „2026-09-30"), nie data pobrania. */
  dataDanych: string
  pobrano: string
}

export interface Norma {
  /** Próg z przepisu albo wytycznej, np. 64 dB LDWN, 5 µg/m³ PM2.5 WHO. */
  wartosc: number
  opis: string
  zrodlo: string
}

export interface WskaznikMeta {
  /** snake_case, unikalny, np. „halas_ldwn". Nazwa pliku: public/dane/wskazniki/<id>.json. */
  id: string
  kategoria: KategoriaId
  nazwa: string
  /** Krótkie wyjaśnienie dla karty: co mierzy i jak liczone. */
  opis: string
  jednostka: string
  kierunek: Kierunek
  rozdzielczosc: Rozdzielczosc
  /** Dla rozdzielczości innej niż adres – rozmiar oczka, np. „100 m", „1 km", „gmina". */
  rozmiar?: string
  zrodla: Zrodlo[]
  norma?: Norma
  /** Zakres sensownych wartości do skali (np. 0–2000 m) – silnik może przyciąć. */
  zakres?: [number, number]
  /** Numer zadania w GitHubie, które wyprodukowało warstwę. */
  zadanie: number
  /** Domyślna waga nowej warstwy w profilu, gdy nie ma jej w ustawieniach persony. */
  domyslnaWaga?: 0 | 1 | 2 | 3 | 4
  /** true = dane wymyślone (atrapa do pracy równoległej). Na karcie oznaczyć wprost. */
  atrapa?: boolean
}

/** Plik public/dane/wskazniki/<id>.json. */
export interface PlikWskaznika {
  meta: WskaznikMeta
  /** Musi się zgadzać z PlikAdresow.wersja – inaczej wartości trafiłyby pod złe adresy. */
  wersjaAdresow: string
  /** Wartość dla i-tego adresu z PlikAdresow (ta sama kolejność). null = brak danych, nigdy 0. */
  wartosci: (number | null)[]
  /** Opcjonalny opis do karty dla i-tego adresu, np. „Rondo Mogilskie, 240 m". */
  etykiety?: (string | null)[]
  /** Słownik dla powtarzalnych etykiet obszarowych; etykiety[] zawiera wtedy klucze. */
  slownikEtykiet?: Record<string, string>
}

/** Manifest generowany przy dev/build z plików wskaźników (bez tablic wartości). */
export interface Manifest {
  wygenerowano: string
  wskazniki: (WskaznikMeta & { wersjaAdresow: string })[]
}

export interface Adres {
  /** Indeks w tablicy – klucz do PlikWskaznika.wartosci. */
  i: number
  id: string
  miejscowosc: string
  ulica: string | null
  nr: string
  kod: string | null
  /** Dzielnica Krakowa (I–XVIII) albo null poza Krakowem. */
  dzielnica: string | null
  gmina: string
  teryt: string
  lon: number
  lat: number
  /** H3 rozdzielczość 10 (~65 m) – heatmapa grupuje po tym polu. */
  h3: string
}

/**
 * Plik public/dane/adresy.json – kolumnowy, bo 70 tys. obiektów z powtarzanymi kluczami
 * ważyłoby trzy razy więcej. Rozwiń przez rozwinAdresy().
 */
export interface PlikAdresow {
  wersja: string
  zrodla: Zrodlo[]
  atrapa?: boolean
  kolumny: {
    id: string[]
    miejscowosc: string[]
    ulica: (string | null)[]
    nr: string[]
    kod: (string | null)[]
    dzielnica: (string | null)[]
    gmina: string[]
    teryt: string[]
    /** Zaokrąglone do 6 miejsc (~10 cm). */
    lon: number[]
    lat: number[]
    h3: string[]
  }
}

export function rozwinAdresy(p: PlikAdresow): Adres[] {
  const k = p.kolumny
  return k.id.map((id, i) => ({
    i,
    id,
    miejscowosc: k.miejscowosc[i] ?? '',
    ulica: k.ulica[i] ?? null,
    nr: k.nr[i] ?? '',
    kod: k.kod[i] ?? null,
    dzielnica: k.dzielnica[i] ?? null,
    gmina: k.gmina[i] ?? '',
    teryt: k.teryt[i] ?? '',
    lon: k.lon[i] ?? 0,
    lat: k.lat[i] ?? 0,
    h3: k.h3[i] ?? '',
  }))
}

const BAZA = `${import.meta.env.BASE_URL}dane`

async function pobierz<T>(sciezka: string): Promise<T> {
  const r = await fetch(`${BAZA}/${sciezka}`)
  if (!r.ok) throw new Error(`Brak pliku danych ${sciezka} (${r.status})`)
  return (await r.json()) as T
}

export const wczytajAdresy = () => pobierz<PlikAdresow>('adresy.json')
export const wczytajManifest = () => pobierz<Manifest>('manifest.json')

/** Zwraca null, gdy wskaźnik policzono dla innej wersji adresów (nieaktualny plik). */
export async function wczytajWskaznik(
  id: string,
  wersjaAdresow: string,
): Promise<PlikWskaznika | null> {
  const p = await pobierz<PlikWskaznika>(`wskazniki/${id}.json`)
  if (p.wersjaAdresow !== wersjaAdresow) {
    console.warn(`Wskaźnik ${id} liczony dla adresów ${p.wersjaAdresow}, mamy ${wersjaAdresow}`)
    return null
  }
  return p
}
