// Rejestr zbiorów danych aplikacji (#223): Kraków (z obwarzankiem), 9 miast z #223 i 20 miast z #236. To jedyne
// miejsce w kodzie z listą miast: link (`mst=`), lista wyboru, ścieżki danych i tło mapy biorą ją
// stąd, a test `miasta.test.ts` pilnuje zgodności z katalogami w public/dane/miasta. Kontrakt:
// specs/002-wszystkie-miasta/contracts/miasta.md.
//
// Osobny plik bez `import.meta.env` (jak okolice.ts), żeby `node --test` mógł go załadować bez Vite.

/**
 * Slugi w kolejności rejestru, czyli kolejności na liście miast i w ładowaniu tła mapy: Kraków
 * (miasto domyślne), potem malejąco wg liczby adresów (stan 2026-10-07: od 126 566 w Warszawie
 * do 27 192 w Białymstoku); miasta z #236 dalej, malejąco wg adresów (stan 2026-10-22). Slug miasta = nazwa katalogu w `public/dane/miasta/`.
 *
 * Slug to wyłącznie małe litery bez cyfr i myślników: na tym polegają wyjątek service workera
 * (public/sw.js) i middleware manifestu w vite.config.ts, a test to pilnuje.
 */
const SLUGI = [
  'krakow',
  'warszawa',
  'wroclaw',
  'lodz',
  'poznan',
  'gdansk',
  'szczecin',
  'lublin',
  'bydgoszcz',
  'bialystok',
  'czestochowa',
  'rzeszow',
  'radom',
  'bielskobiala',
  'katowice',
  'rybnik',
  'torun',
  'gdynia',
  'zielonagora',
  'gliwice',
  'kielce',
  'opole',
  'sosnowiec',
  'dabrowagornicza',
  'zabrze',
  'tychy',
  'rudaslaska',
  'olsztyn',
  'gorzowwielkopolski',
  'bytom',
] as const

export type SlugMiasta = (typeof SLUGI)[number]

export interface Miasto {
  slug: SlugMiasta
  nazwa: string
  /** „w Krakowie", „we Wrocławiu" – gotowa fraza do tekstów. */
  wMiescie: string
  /** Katalog względem `dane/`: '' dla Krakowa, 'miasta/<slug>' dla reszty. */
  katalog: string
  /** [lon, lat] środka zabudowy – lista miast i kadr zapasowy, zanim wczyta się obrys danych. */
  srodek: [number, number]
}

/** Miasto, które otwiera się bez parametru w linku (zgodność wsteczna: linki sprzed #223). */
export const MIASTO_DOMYSLNE: SlugMiasta = 'krakow'

interface DaneMiasta {
  nazwa: string
  wMiescie: string
  srodek: [number, number]
}

// `Record` po `SlugMiasta` wymusza wpis dla każdego sluga i odrzuca obcy klucz – lista slugów
// i tabela nie rozjadą się bez czerwonego `tsc`.
//
// `srodek` to mediana współrzędnych adresów z adresy.json miasta (0,001° = 70–110 m), a nie środek
// prostokąta obrysu: obrzeża z rzadką zabudową (obwarzanek Krakowa) przesuwają ten drugi z centrum.
const DANE: Record<SlugMiasta, DaneMiasta> = {
  krakow: { nazwa: 'Kraków', wMiescie: 'w Krakowie', srodek: [19.95, 50.046] },
  warszawa: { nazwa: 'Warszawa', wMiescie: 'w Warszawie', srodek: [21.055, 52.221] },
  wroclaw: { nazwa: 'Wrocław', wMiescie: 'we Wrocławiu', srodek: [17.02, 51.114] },
  lodz: { nazwa: 'Łódź', wMiescie: 'w Łodzi', srodek: [19.461, 51.771] },
  poznan: { nazwa: 'Poznań', wMiescie: 'w Poznaniu', srodek: [16.901, 52.407] },
  gdansk: { nazwa: 'Gdańsk', wMiescie: 'w Gdańsku', srodek: [18.596, 54.358] },
  szczecin: { nazwa: 'Szczecin', wMiescie: 'w Szczecinie', srodek: [14.547, 53.434] },
  lublin: { nazwa: 'Lublin', wMiescie: 'w Lublinie', srodek: [22.552, 51.24] },
  bydgoszcz: { nazwa: 'Bydgoszcz', wMiescie: 'w Bydgoszczy', srodek: [17.981, 53.133] },
  bialystok: { nazwa: 'Białystok', wMiescie: 'w Białymstoku', srodek: [23.179, 53.134] },
  czestochowa: { nazwa: 'Częstochowa', wMiescie: 'w Częstochowie', srodek: [19.106, 50.81] },
  rzeszow: { nazwa: 'Rzeszów', wMiescie: 'w Rzeszowie', srodek: [22.003, 50.027] },
  radom: { nazwa: 'Radom', wMiescie: 'w Radomiu', srodek: [21.152, 51.392] },
  bielskobiala: { nazwa: 'Bielsko-Biała', wMiescie: 'w Bielsku-Białej', srodek: [19.05, 49.816] },
  katowice: { nazwa: 'Katowice', wMiescie: 'w Katowicach', srodek: [18.99, 50.229] },
  rybnik: { nazwa: 'Rybnik', wMiescie: 'w Rybniku', srodek: [18.539, 50.09] },
  torun: { nazwa: 'Toruń', wMiescie: 'w Toruniu', srodek: [18.612, 53.024] },
  gdynia: { nazwa: 'Gdynia', wMiescie: 'w Gdyni', srodek: [18.505, 54.5] },
  zielonagora: { nazwa: 'Zielona Góra', wMiescie: 'w Zielonej Górze', srodek: [15.51, 51.934] },
  gliwice: { nazwa: 'Gliwice', wMiescie: 'w Gliwicach', srodek: [18.664, 50.299] },
  kielce: { nazwa: 'Kielce', wMiescie: 'w Kielcach', srodek: [20.623, 50.866] },
  opole: { nazwa: 'Opole', wMiescie: 'w Opolu', srodek: [17.932, 50.668] },
  sosnowiec: { nazwa: 'Sosnowiec', wMiescie: 'w Sosnowcu', srodek: [19.167, 50.282] },
  dabrowagornicza: {
    nazwa: 'Dąbrowa Górnicza',
    wMiescie: 'w Dąbrowie Górniczej',
    srodek: [19.253, 50.338],
  },
  zabrze: { nazwa: 'Zabrze', wMiescie: 'w Zabrzu', srodek: [18.783, 50.307] },
  tychy: { nazwa: 'Tychy', wMiescie: 'w Tychach', srodek: [18.99, 50.121] },
  rudaslaska: { nazwa: 'Ruda Śląska', wMiescie: 'w Rudzie Śląskiej', srodek: [18.863, 50.266] },
  olsztyn: { nazwa: 'Olsztyn', wMiescie: 'w Olsztynie', srodek: [20.479, 53.769] },
  gorzowwielkopolski: {
    nazwa: 'Gorzów Wielkopolski',
    wMiescie: 'w Gorzowie Wielkopolskim',
    srodek: [15.239, 52.736],
  },
  bytom: { nazwa: 'Bytom', wMiescie: 'w Bytomiu', srodek: [18.884, 50.356] },
}

/** Wszystkie zbiory danych, Kraków pierwszy. */
export const MIASTA: readonly Miasto[] = SLUGI.map((slug) => ({
  slug,
  ...DANE[slug],
  katalog: slug === 'krakow' ? '' : `miasta/${slug}`,
}))

// `Map`, nie obiekt: slug przychodzi z linku (`mst=`), a `{}['constructor']` zwróciłby funkcję.
const PO_SLUGU: ReadonlyMap<string, Miasto> = new Map(MIASTA.map((m) => [m.slug, m]))

/** Miasto o danym slugu; dla `SlugMiasta` zawsze jest, dla dowolnego napisu (link) może być `null`. */
export function miasto(slug: SlugMiasta): Miasto
export function miasto(slug: string): Miasto | null
export function miasto(slug: string): Miasto | null {
  return PO_SLUGU.get(slug) ?? null
}

export function czySlugMiasta(s: string): s is SlugMiasta {
  return PO_SLUGU.has(s)
}

/**
 * Tło mapy: przegląd miast innych niż bieżące, rysowany pod heksami bieżącego miasta. Typ leży tu,
 * a nie przy `Przeglad` (src/wynik), żeby tor karta (liczy tło) i tor mapa (rysuje je) importowały
 * go z jednego miejsca i żadna faza nie czekała na drugą. Kontrakt: contracts/przeglad.md.
 */
export interface TloMapy {
  /** Heksy r8 i r9 miast innych niż bieżące; null = brak danych (szrafura), nigdy 0. */
  heksy: { 8: ReadonlyMap<string, number | null>; 9: ReadonlyMap<string, number | null> }
  /** Nazwa miasta heksu tła (r8 albo r9) – do dymku; null = heks nie należy do tła. */
  miastoHeksu: (h3: string) => string | null
}
