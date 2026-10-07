// Teksty i drobna logika tła mapy (#223): czyste funkcje bez DOM, MapLibre i Reacta – testy na
// gołym `node --test` (tlo.test.ts). Komponent `MapaKrakowa` tylko je woła.
import { MIASTA } from '../kontrakty/miasta.ts'
import type { Ramka } from './geometria.ts'

/**
 * Podpis mgły i wiersz legendy na mapie wszystkich miast (jest `tlo`), FR-011. Brak danych to brak
 * danych, nie brak obsługi: miasta z danymi są pokolorowane, mgła przykrywa resztę kraju.
 */
export const TEKST_POZA_MIASTAMI = 'poza obsługiwanymi miastami – brak danych'

/**
 * To samo na ekranach jednego miasta (luki, symulator, biznes), które nie dostają tła: pod mgłą
 * leżą wtedy też inne miasta z danymi, więc „poza obsługiwanymi miastami" byłoby nieprawdą.
 */
export const TEKST_POZA_MIASTEM = 'poza tym miastem – brak danych'

/** Wiersz legendy przy tle (D10): ocena warstwy to pozycja w rozkładzie adresów danego miasta. */
export const TEKST_SKALI_MIAST = 'Skala liczona osobno w każdym mieście'

export function podpisMgly(zTlem: boolean): string {
  return zTlem ? TEKST_POZA_MIASTAMI : TEKST_POZA_MIASTEM
}

/**
 * Dymek heksu tła: „<Miasto> · wynik N (średnia okolicy)" albo „<Miasto> · brak danych".
 * `w` to wartość z feature-state (-1 = brak). Zero jest wynikiem, nie brakiem.
 */
export function podpisHeksuTla(nazwaMiasta: string, w: number | null | undefined): string {
  if (w === null || w === undefined || Number.isNaN(w) || w < 0)
    return `${nazwaMiasta} · brak danych`
  return `${nazwaMiasta} · wynik ${Math.round(w)} (średnia okolicy)`
}

/** Podpis winiety lotu startowego (`?pokaz`): liczba z rejestru, bo lista miast rośnie razem z nim. */
export function tekstIntro(): string {
  return `Dane: Kraków i ${MIASTA.length - 1} największych miast`
}

export function podpisPrzyciskuIntro(nazwaMiasta: string): string {
  return `Pokaż ${nazwaMiasta}`
}

/**
 * Od tego zoomu podpis mgły stoi przy bieżącym mieście. Niżej (widok kraju) siedzi nad całym
 * obszarem z danymi: długi podpis przy jednym z dziesięciu miast zasłaniałby sąsiednie, a przy
 * zoomie 8 odległości między miastami (kilkaset pikseli) już go mieszczą.
 */
export const ZOOM_PODPISU_MIASTA = 8

/**
 * Obszar, nad którego północną krawędzią stoi podpis mgły: bieżące miasto przy zbliżeniu, całość
 * (miasto i tło) przy widoku kraju. Bez żadnego obszaru null (nie ma czego podpisywać).
 */
export function ramkaPodpisuMgly(
  zoom: number,
  biezace: Ramka | null,
  wszystkie: Ramka | null,
): Ramka | null {
  if (zoom >= ZOOM_PODPISU_MIASTA && biezace) return biezace
  return wszystkie ?? biezace
}

/** Punkt [lon, lat] nad północną krawędzią ramki, pośrodku: tam kotwiczymy podpis. */
export function kotwicaPodpisu([[zachod], [wschod, polnoc]]: Ramka): [number, number] {
  return [(zachod + wschod) / 2, polnoc]
}
