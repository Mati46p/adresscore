// #176: warstwy i kategorie wycofane w #171 („uprość kryteria”, c810b48) – jawna mapa aliasów.
//
// Zbiory wzorcowe i kontrolne (zbior-*.json, kontrolny*.json) są ZAMROŻONE: pisano je przed
// #171 i zostają bajt w bajt. Stare id liczą się jak ich następcy WYŁĄCZNIE tutaj: w liczeniu
// wyniku (pomiar.ts) i w teście zbiorów (zbiory.test.ts). Aplikacja tej mapy nie zna.
//
// Co zrobił #171 (etl/uprosc-kryteria.mjs):
// - połączył pary Kraków / obwarzanek w jedną warstwę: `halas_obwarzanek_lden` → `halas_ldwn`,
//   `inwestycje_500m_obwarzanek` → `inwestycje_500m` (rozłączne obszary, te same jednostki);
// - rozbił agregat `uslugi_15min` (10 rodzajów usług w 1,2 km) na trzy nowe warstwy:
//   `gastronomia_1200m`, `poczta_1200m`, `biblioteka_1200m` (pozostałe rodzaje – sklep, apteka,
//   szkoła, przedszkole, żłobek, lekarz – miały już własne warstwy);
// - usunął `powodz_1proc`, `powodz_02proc`, `gmina_powodz_powierzchnia_pct` i
//   `bankomat_poczta_odleglosc`;
// - zastąpił kategorię `przyszlosc` kategorią `spolecznosc` (PRZENIESIONE: inwestycje, plan
//   miejscowy, budżet obywatelski).

/** Warstwa usunięta w #171 bez warstwy, która mierzy to samo. */
export const WYCOFANA_BEZ_NASTEPCY = 'wycofana bez następcy' as const

/**
 * Stary id warstwy → następcy (#171). Grupa tematu ze zbioru: stary id zastępujemy wszystkimi
 * następcami (trafienie w którykolwiek się liczy).
 *
 * - `powodz_1proc`, `powodz_02proc` → `powodz_10proc`: ta sama miara (głębokość wody pod
 *   adresem z map zagrożenia powodziowego), inny scenariusz. Po #171 to jedyna warstwa powodzi
 *   pod adresem, a #171 sam przepiął na nią temat, reguły i podpowiedź „Czy tu zalewa?”.
 * - `uslugi_15min` → trzy warstwy wyodrębnione z agregatu (jak reguła „usługi / wszystko
 *   blisko” w REGULY po #171).
 * - `gmina_powodz_powierzchnia_pct` – bez następcy: miara dla całej gminy, a `powodz_10proc`
 *   to adres; pytanie „jaka część gminy leży na terenach zalewowych” nie ma już warstwy.
 * - `bankomat_poczta_odleglosc` – bez następcy: bankomatu nie ma w żadnej warstwie, a
 *   `poczta_1200m` to inna miara (tak/nie w 1,2 km, z paczkomatem) – pytanie „jest blisko
 *   bankomat?” liczone po starym id byłoby trafione przez warstwę, która o nim nic nie mówi.
 */
export const WARSTWY_WYCOFANE: Readonly<
  Record<string, readonly string[] | typeof WYCOFANA_BEZ_NASTEPCY>
> = {
  halas_obwarzanek_lden: ['halas_ldwn'],
  inwestycje_500m_obwarzanek: ['inwestycje_500m'],
  powodz_1proc: ['powodz_10proc'],
  powodz_02proc: ['powodz_10proc'],
  uslugi_15min: ['gastronomia_1200m', 'poczta_1200m', 'biblioteka_1200m'],
  gmina_powodz_powierzchnia_pct: WYCOFANA_BEZ_NASTEPCY,
  bankomat_poczta_odleglosc: WYCOFANA_BEZ_NASTEPCY,
}

/** Stara kategoria → następca (#171: „Przyszłość okolicy” weszła do „Społeczność i koszty”). */
export const KATEGORIE_WYCOFANE: Readonly<Record<string, string>> = {
  przyszlosc: 'spolecznosc',
}

/** Id warstwy po #171: następcy, sam id (bez zmian) albo [] (wycofana bez następcy). */
export function nastepcyWarstwy(id: string): readonly string[] {
  const n = WARSTWY_WYCOFANE[id]
  if (n === undefined) return [id]
  return n === WYCOFANA_BEZ_NASTEPCY ? [] : n
}

/**
 * Odpowiedź systemu ze starego przebiegu (--z-pliku) po #171: pierwszy następca, sam id albo
 * id bez zmian, gdy następcy nie ma (nie trafi wtedy w żadną grupę – i słusznie).
 */
export function warstwaPoWycofaniu(id: string): string
export function warstwaPoWycofaniu(id: string | null): string | null
export function warstwaPoWycofaniu(id: string | null): string | null {
  if (id === null) return null
  return nastepcyWarstwy(id)[0] ?? id
}

export const kategoriaPoWycofaniu = (k: string) => KATEGORIE_WYCOFANE[k] ?? k

export interface TematyPoWycofaniu {
  /** Grupy po zamianie na następców, bez powtórzeń; puste grupy (bez następcy) pominięte. */
  tematy: string[][]
  /** Ile grup tej pozycji zawierało stary id (zamienione albo pominięte). */
  zmienione: number
  /** Ile grup pominięto, bo miały wyłącznie warstwy wycofane bez następcy. */
  pominiete: number
}

/**
 * Grupy tematów ze zbioru → grupy po #171. Pozycja, której WSZYSTKIE grupy przepadły
 * (`tematy` puste, a `pominiete` > 0), nie jest „spoza zakresu” – liczenie musi ją pominąć.
 * Grupa `[nie_wiem]` przechodzi bez zmian.
 */
export function tematyPoWycofaniu(tematy: readonly (readonly string[])[]): TematyPoWycofaniu {
  const wynik: string[][] = []
  const klucze = new Set<string>()
  let zmienione = 0
  let pominiete = 0
  for (const t of tematy) {
    if (t.some((id) => id in WARSTWY_WYCOFANE)) zmienione++
    const g = [...new Set(t.flatMap(nastepcyWarstwy))]
    if (g.length === 0) {
      pominiete++
      continue
    }
    // Dwie grupy, które po zamianie są tym samym tematem (np. powódź 1% i 10%), liczą się raz.
    const klucz = [...g].sort().join('|')
    if (klucze.has(klucz)) continue
    klucze.add(klucz)
    wynik.push(g)
  }
  return { tematy: wynik, zmienione, pominiete }
}
