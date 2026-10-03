/** Czytelny podpis przycisku. Pełna oficjalna nazwa PKW pozostaje w metadanych warstwy. */
export function krotkaNazwaKomitetu(oficjalnaNazwa: string): string {
  const nazwa = oficjalnaNazwa.replace(/^Sejm 2023\s*·\s*/, '').trim()
  const skroty: readonly [RegExp, string][] = [
    [/BEZPARTYJNI SAMORZĄDOWCY/i, 'Bezpartyjni Samorządowcy'],
    [/TRZECIA DROGA/i, 'Trzecia Droga'],
    [/NOWA LEWICA/i, 'Nowa Lewica'],
    [/PRAWO I SPRAWIEDLIWOŚĆ/i, 'Prawo i Sprawiedliwość'],
    [/KONFEDERACJA WOLNOŚĆ I NIEPODLEGŁOŚĆ/i, 'Konfederacja'],
    [/KOALICJA OBYWATELSKA/i, 'Koalicja Obywatelska'],
    [/POLSKA JEST JEDNA/i, 'Polska Jest Jedna'],
  ]
  return skroty.find(([wzor]) => wzor.test(nazwa))?.[1] ?? nazwa
}
