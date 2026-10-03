// Doprecyzowanie modelu GIOŚ w skali adresu (zadanie #131).
//
// GIOŚ daje jedną wartość na oczko (ok. 360 × 560 m albo 1,8 × 2,8 km). W środku oczka adres przy
// ruchliwej drodze oddycha gorszym powietrzem niż adres w parku. Rozkładamy więc wartość oczka
// między jego adresy według dwóch cech, które już mamy z rejestrów:
//   - hałas drogowy LDWN (mapa akustyczna Krakowa) – przybliżenie natężenia ruchu,
//   - udział zieleni w oczku 100 m (MSIP) – roślinność i brak źródeł emisji.
// Średnia adresów w oczku zostaje równa wartości GIOŚ (z dokładnością do 0,1): zmieniamy rozkład, nie poziom.
// Amplituda jest ograniczona (PM2,5 ±10%, PM10 ±15%, NO2 ±35%) – rząd wielkości różnic
// wewnątrzmiejskich opisywanych dla tych zanieczyszczeń (NO2 najsilniej związany z ruchem).
// Adres bez obu cech (poza Krakowem) dostaje wartość oczka bez zmian.

/** Cecha „ruch i zabudowa minus zieleń" adresu; null = brak danych do doprecyzowania. */
export function cecha(halasDb, zielenPct, wKrakowie) {
  if (!wKrakowie) return null
  // Brak pasma na mapie akustycznej w Krakowie = poniżej najniższego pasma (55 dB).
  const halas = halasDb ?? 50
  if (zielenPct === null || zielenPct === undefined) return null
  return (halas - 55) / 10 - (zielenPct - 50) / 50
}

/**
 * @param {(number|null)[]} wartosci wartość oczka GIOŚ dla każdego adresu
 * @param {(string|number|null)[]} oczka identyfikator oczka dla każdego adresu
 * @param {(number|null)[]} cechy wynik funkcji cecha() dla każdego adresu
 * @param {number} amplituda np. 0.1 = ±10%
 */
export function doprecyzuj(wartosci, oczka, cechy, amplituda) {
  const grupy = new Map()
  for (let i = 0; i < wartosci.length; i++) {
    if (wartosci[i] === null || cechy[i] === null) continue
    const g = grupy.get(oczka[i]) ?? []
    g.push(i)
    grupy.set(oczka[i], g)
  }
  const wynik = wartosci.slice()
  for (const indeksy of grupy.values()) {
    if (indeksy.length < 2) continue
    const srednia = indeksy.reduce((s, i) => s + cechy[i], 0) / indeksy.length
    let mnozniki = indeksy.map((i) => 1 + amplituda * Math.tanh(cechy[i] - srednia))
    // Wyrównanie średniej do 1 i przycięcie do ±amplitudy na zmianę – zbiega w kilku krokach.
    for (let krok = 0; krok < 20; krok++) {
      const sr = mnozniki.reduce((s, m) => s + m, 0) / mnozniki.length
      mnozniki = mnozniki.map((m) => Math.min(1 + amplituda, Math.max(1 - amplituda, m / sr)))
    }
    // Do 0,1 – dokładność samego modelu GIOŚ; więcej cyfr udawałoby precyzję.
    indeksy.forEach((i, k) => {
      wynik[i] = Math.round(wartosci[i] * mnozniki[k] * 10) / 10
    })
  }
  return wynik
}
