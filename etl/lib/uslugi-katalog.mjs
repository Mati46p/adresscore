// Katalog branż usług dla trybu „Biznes" (#104): dane, nie logika. Jedno miejsce, z którego
// ETL (etl/uslugi.mjs) bierze mapowanie kategorii OSM, Overture Places i PKD z CEIDG oraz
// zasięg pieszy. Nowa branża = nowy wpis w BRANZE (plus test), bez zmian w potoku.
// Paczkomat jest poza katalogiem celowo: robi go #124 (InPost + OSM).

/**
 * Bity źródeł w kolumnie `zr` plików punktów. Kolejność jest kontraktem z frontem:
 * nie zmieniaj istniejących, nowe źródło dopisz na końcu.
 * `rejestr` to rejestr urzędowy właściwy dla branży (apteka: Rejestr Aptek, POZ: RPWDL).
 */
export const BITY_ZRODEL = { osm: 1, overture: 2, rejestr: 4, ceidg: 8 }

/** Kolejność źródeł od najpewniejszego położenia punktu: wspólny punkt bierze współrzędne od pierwszego. */
export const KOLEJNOSC_POZYCJI = ['osm', 'overture', 'rejestr', 'ceidg']

/** Progi deduplikacji w obrębie branży: z podobną nazwą 30 m, gdy któraś nazwa nieznana – 15 m. */
export const DEDUP_PROGI = { metryZNazwa: 30, metryBezNazwy: 15 }

/** Minimalna pewność miejsca w Overture Places (średnia w obszarze to 0,66, poniżej 0,7 jest dużo szumu). */
export const OVERTURE_MIN_CONFIDENCE = 0.7

/**
 * Opisy źródeł do `katalog.json`. Daty stanu i pobrania dopisuje ETL w czasie biegu.
 * Licencje: OSM wymaga atrybucji i share-alike dla bazy pochodnej, Overture jest bez share-alike.
 */
export const OPISY_ZRODEL = {
  osm: {
    nazwa: 'OpenStreetMap, ekstrakt Geofabrik – małopolskie',
    url: 'https://download.geofabrik.de/europe/poland/malopolskie.html',
    licencja: 'Open Database License (ODbL) 1.0',
    licencjaUrl: 'https://opendatacommons.org/licenses/odbl/1-0/',
    atrybucja: '© OpenStreetMap contributors, ODbL',
    uwagi:
      'Punkty z OSM tworzą bazę pochodną na warunkach ODbL: zachowaj atrybucję i udostępniaj ją dalej na tej samej licencji.',
  },
  overture: {
    nazwa: 'Overture Maps Foundation – Places',
    url: 'https://docs.overturemaps.org/guides/places/',
    licencja: 'CDLA-Permissive-2.0',
    licencjaUrl: 'https://cdla.dev/permissive-2-0/',
    atrybucja: 'Overture Maps Foundation, Places (CDLA-Permissive-2.0)',
    uwagi: 'Tylko miejsca z pewnością (confidence) co najmniej 0,7 i bez statusu zamknięcia.',
  },
  rejestr_aptek: {
    nazwa: 'Rejestr Aptek Ogólnodostępnych i Punktów Aptecznych (Centrum e-Zdrowia)',
    url: 'https://rejestry.ezdrowie.gov.pl/ra/search/public',
    licencja: 'Dane publiczne rejestru, jawne z mocy ustawy – Prawo farmaceutyczne',
    atrybucja: 'Centrum e-Zdrowia, Rejestr Aptek',
    uwagi: 'Adresy geokodowane usługą GUGiK UUG; prawda dla branży „apteka".',
  },
  rpwdl: {
    nazwa:
      'Rejestr Podmiotów Wykonujących Działalność Leczniczą – poradnie (gabinety) lekarza POZ (Centrum e-Zdrowia)',
    url: 'https://dane.gov.pl/pl/dataset/728,rejestr-podmiotow-wykonujacych-dzialalnosc-lecznicza',
    licencja: 'CC BY 4.0',
    licencjaUrl: 'https://creativecommons.org/licenses/by/4.0/',
    atrybucja: 'Centrum e-Zdrowia, RPWDL (CC BY 4.0)',
    uwagi: 'Adresy geokodowane usługą GUGiK UUG.',
  },
  ceidg: {
    nazwa: 'CEIDG – Centralna Ewidencja i Informacja o Działalności Gospodarczej (API v3)',
    url: 'https://dane.biznes.gov.pl/',
    licencja: 'Dane jawne CEIDG (ustawa o CEIDG); API dane.biznes.gov.pl',
    atrybucja: 'Ministerstwo Rozwoju i Technologii, CEIDG',
    uwagi:
      'Wyłącznie uzupełnienie: adres działalności firmy jednoosobowej z danym PKD, nie potwierdzony lokal. Do plików trafia tylko punkt, branża i źródło – bez nazwy firmy, nazwiska, NIP i REGON.',
  },
}

/**
 * Obszary zapytań do CEIDG: Kraków oraz 13 gmin obwarzanka (te same co w adresach).
 * `filtr` to parametry API; gminy wiejskie nie mają jednego „miasta", więc idą po `gmina`.
 */
export const OBSZARY_CEIDG = [
  { id: 'krakow', nazwa: 'Kraków', terc: '1261011', filtr: { miasto: 'Kraków' } },
  ...[
    ['wieliczka', 'Wieliczka', '1219053'],
    ['niepolomice', 'Niepołomice', '1219043'],
    ['zabierzow', 'Zabierzów', '1206162'],
    ['skawina', 'Skawina', '1206113'],
    ['zielonki', 'Zielonki', '1206172'],
    ['liszki', 'Liszki', '1206072'],
    ['kocmyrzow_luborzyca', 'Kocmyrzów-Luborzyca', '1206052'],
    ['wielka_wies', 'Wielka Wieś', '1206152'],
    ['mogilany', 'Mogilany', '1206092'],
    ['michalowice', 'Michałowice', '1206082'],
    ['swiatniki_gorne', 'Świątniki Górne', '1206143'],
    ['koniusza', 'Koniusza', '1214012'],
    ['igolomia_wawrzenczyce', 'Igołomia-Wawrzeńczyce', '1206022'],
  ].map(([id, nazwa, terc]) => ({
    id,
    nazwa,
    terc,
    filtr: { gmina: nazwa, wojewodztwo: 'MAŁOPOLSKIE' },
  })),
]

/**
 * Branże v1. Reguły to napisy:
 *   OSM: `klucz=wartość` (alternatywy), z opcjonalnym `?filtr` (nazwany filtr z FILTRY);
 *   Overture: `taxonomy.primary`, też z opcjonalnym `?filtr`;
 *   PKD: kod z kropkami (do API CEIDG bez kropek).
 * `zasiegPieszyM` to założenie robocze (ok. 80 m/min, 6–15 minut), do kalibracji w trybie Biznes.
 * `zrodloPrawdy`: tylko punkty potwierdzone w tym źródle trafiają do pliku (pozostałe służą do kontroli).
 * `minPunktow`: strażnik – poniżej tej liczby punktów w pliku ETL kończy się błędem (źródło zwróciło
 * coś uciętego albo zmieniło format), a nie cicho zapisuje pusty plik. `minZrodel`: to samo per źródło
 * (punkty wejściowe branży), żeby jedno źródło nie zerowało się po cichu za plecami pozostałych.
 * Wartości to ok. 30–60% pomiaru z 2026-10-03.
 */
export const BRANZE = [
  {
    id: 'sklep_spozywczy',
    minPunktow: 800,
    minZrodel: { osm: 1000, overture: 600 },
    nazwa: 'Sklep spożywczy',
    zasiegPieszyM: 500,
    osm: ['shop=supermarket', 'shop=convenience', 'shop=greengrocer'],
    overture: ['convenience_store', 'grocery_store'],
    pkd: ['47.11.Z'],
    uwagi:
      'Supermarkety, sklepy osiedlowe i warzywniaki. Bez rzeźni, delikatesów specjalistycznych, kiosków i drogerii.',
  },
  {
    id: 'apteka',
    minPunktow: 250,
    minZrodel: { osm: 200, overture: 100, rejestr: 250 },
    nazwa: 'Apteka',
    zasiegPieszyM: 800,
    osm: ['amenity=pharmacy'],
    osmWyklucz: ['dispensing=no'],
    overture: ['pharmacy'],
    pkd: [],
    rejestr: 'rejestr_aptek',
    zrodloPrawdy: 'rejestr',
    uwagi:
      'Prawdą jest Rejestr Aptek (aktywne apteki ogólnodostępne i punkty apteczne). OSM i Overture służą do kontroli pokrycia i zaznaczają, że punkt widać także tam.',
  },
  {
    id: 'fryzjer',
    minPunktow: 400,
    minZrodel: { osm: 300, overture: 250 },
    nazwa: 'Fryzjer i barber',
    zasiegPieszyM: 800,
    osm: ['shop=hairdresser', 'shop=barber'],
    overture: ['hair_salon', 'barber', 'hair_stylist'],
    // PKD 2025 (obowiązuje od 2025-01-01) rozdzieliło 96.02.Z na 96.21.Z (fryzjerstwo i barber) i 96.22.Z
    // (kosmetyka, poza branżą). Nowe wpisy w CEIDG mają już tylko 96.21.Z, starsze często jeszcze 96.02.Z
    // (fryzjerstwo razem z kosmetyką, więc mniej precyzyjne). Sprawdzone: 96.21.Z ma w CEIDG 842
    // aktywnych wpisów w Krakowie, a wpisów z 2025 i 2026 pod 96.02.Z prawie nie ma.
    pkd: ['96.21.Z', '96.02.Z'],
    flagi: {
      barber: { osm: ['hairdresser=barber', 'shop=barber'], overture: ['barber'] },
    },
    uwagi:
      'Flaga barber: salon męski (OSM hairdresser=barber, Overture barber). CEIDG: PKD 96.21.Z (od 2025) i dawne 96.02.Z.',
  },
  {
    id: 'piekarnia',
    minPunktow: 200,
    minZrodel: { osm: 200, overture: 120 },
    nazwa: 'Piekarnia i cukiernia',
    zasiegPieszyM: 500,
    // Overture (bakery) i PKD 10.71.Z obejmują piekarnie razem z cukierniami, więc w OSM też shop=pastry.
    osm: ['shop=bakery', 'shop=pastry'],
    overture: ['bakery'],
    pkd: ['10.71.Z'],
    uwagi:
      'Piekarnie i cukiernie (OSM shop=bakery i pastry, Overture bakery, PKD 10.71.Z). Sklepy ze słodyczami (shop=confectionery) są poza branżą.',
  },
  {
    id: 'kawiarnia',
    minPunktow: 300,
    minZrodel: { osm: 250, overture: 250 },
    nazwa: 'Kawiarnia',
    zasiegPieszyM: 500,
    osm: ['amenity=cafe'],
    overture: ['coffee_shop', 'cafe'],
    pkd: ['56.30.Z'],
    uwagi: 'Kawiarnie i kawiarnie specjalistyczne. Bez barów, restauracji i kafejek internetowych.',
  },
  {
    id: 'poz',
    minPunktow: 150,
    minZrodel: { osm: 60, overture: 8, rejestr: 150 },
    nazwa: 'Przychodnia POZ',
    zasiegPieszyM: 1200,
    osm: ['amenity=doctors?poz', 'amenity=clinic?poz'],
    overture: ['family_practice', 'doctors_office?poz', 'health_care?poz'],
    pkd: [],
    rejestr: 'rpwdl',
    uwagi:
      'RPWDL (poradnie i gabinety lekarza POZ) plus punkty z OSM i Overture rozpoznane jako POZ: po specjalizacji (general, family, primary_care, paediatrics, internal) albo po nazwie (przychodnia, ośrodek zdrowia, NZOZ, lekarz rodzinny). Gabinety specjalistyczne, stomatologia i rehabilitacja odpadają.',
  },
]

export const BRANZE_PO_ID = Object.fromEntries(BRANZE.map((b) => [b.id, b]))

// --- Reguły napisowe -------------------------------------------------------------------------

/** `amenity=doctors?poz` → { klucz: 'amenity', wartosc: 'doctors', filtr: 'poz' }. */
export function rozbierzRegule(regula) {
  const [selektor, filtr = null] = regula.split('?')
  const i = selektor.indexOf('=')
  return i < 0
    ? { klucz: null, wartosc: selektor, filtr }
    : { klucz: selektor.slice(0, i), wartosc: selektor.slice(i + 1), filtr }
}

// --- Filtr POZ -------------------------------------------------------------------------------
// OSM i Overture nie odróżniają gabinetu POZ od poradni specjalistycznej, więc dla tych dwóch
// źródeł POZ rozpoznajemy po specjalizacji (OSM) i po nazwie. Rejestr (RPWDL) jest prawdą,
// OSM i Overture tylko uzupełniają, dlatego filtr jest ostrożny: woli pominąć niż dopisać.

const bezOgonkow = (s) =>
  String(s ?? '')
    .toLocaleLowerCase('pl')
    .replaceAll('ł', 'l')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')

const SPECJALIZACJE_POZ = new Set([
  'general',
  'general_practice',
  'family_medicine',
  'family',
  'primary_care',
  'paediatrics',
  'pediatrics',
  'internal',
])
const NAZWA_POZ =
  /przychodni|osrod\w* zdrowia|lekarz\w* rodzinn|medycyn\w* rodzinn|\bpoz\b|podstawow\w* opiek|\bnzoz\b|\bspzoz\b|zaklad\w* opieki zdrowotnej|gabinet\w* lekarsk|praktyk\w* lekarsk|poradnia zdrowia/
const NAZWA_NIE_POZ =
  /specjalistyczn|indywidualn|chorob|pluc|stomat|dentys|dental|ortodon|ginekolog|poloz|dermatolog|okulist|optyk|ortoped|laryngolog|kardiolog|psychiatr|psycholog|neurolog|onkolog|urolog|rehabilit|fizjoterap|diagnostyk|laborator|kosmetolog|estetyczn|chirurg|alergolog|endokryn|diabet|gastro|reumatolog|logoped|weteryn|szpital|izba przyj|\bsor\b|ratunk|pogotowie|nocna|swiateczn|medycyn\w* pracy|sanatori|hospicj|zdrowia psychicznego/
const HEALTHCARE_NIE_POZ = new Set([
  'physiotherapist',
  'rehabilitation',
  'sample_collection',
  'emergency_ward',
  'dentist',
  'psychotherapist',
  'laboratory',
  'blood_donation',
  'alternative',
  'optometrist',
  'audiologist',
  'midwife',
])

/** Czy nazwa wygląda na przychodnię POZ (bez specjalistów). */
export function nazwaPozPodobna(nazwa) {
  const n = bezOgonkow(nazwa)
  return Boolean(n) && NAZWA_POZ.test(n) && !NAZWA_NIE_POZ.test(n)
}

/**
 * Czy obiekt OSM (amenity=doctors|clinic) jest POZ. Nazwa zdradzająca specjalistę, oddział albo izbę
 * przyjęć wyklucza zawsze; potem specjalizacja rozstrzyga, a nazwa tylko wtedy, gdy specjalizacji brak.
 */
export function czyPozOsm(tagi) {
  if (HEALTHCARE_NIE_POZ.has(tagi.healthcare)) return false
  if (tagi.name && NAZWA_NIE_POZ.test(bezOgonkow(tagi.name))) return false
  const specjalizacje = String(tagi['healthcare:speciality'] ?? '')
    .split(';')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
  if (specjalizacje.length) return specjalizacje.some((s) => SPECJALIZACJE_POZ.has(s))
  return nazwaPozPodobna(tagi.name)
}

/** Filtry nazwane z napisowych reguł katalogu (`?poz`). */
export const FILTRY = {
  poz: {
    osm: czyPozOsm,
    overture: (punkt) => nazwaPozPodobna(punkt.nazwa),
  },
}

// --- Klasyfikacja ----------------------------------------------------------------------------

/** Obiekty z prefiksem cyklu życia (disused:shop, abandoned:amenity) są nieczynne. */
const maPrefiksNieczynny = (tagi) =>
  Object.keys(tagi).some((k) => /^(disused|abandoned|was|razed|demolished):/.test(k))

const flagiOsm = (branza, tagi) =>
  Object.entries(branza.flagi ?? {})
    .filter(([, def]) =>
      def.osm?.some((r) => {
        const { klucz, wartosc } = rozbierzRegule(r)
        return tagi[klucz] === wartosc
      }),
    )
    .map(([flaga]) => flaga)

/** Branże, do których należy obiekt OSM (tagi jako obiekt), z flagami. Pusta lista = poza katalogiem. */
export function klasyfikujOsm(tagi) {
  if (maPrefiksNieczynny(tagi)) return []
  const wynik = []
  for (const b of BRANZE) {
    if (!b.osm?.length) continue
    if (
      b.osmWyklucz?.some((r) => {
        const { klucz, wartosc } = rozbierzRegule(r)
        return tagi[klucz] === wartosc
      })
    )
      continue
    const trafia = b.osm.some((r) => {
      const { klucz, wartosc, filtr } = rozbierzRegule(r)
      return tagi[klucz] === wartosc && (!filtr || FILTRY[filtr].osm(tagi))
    })
    if (trafia) wynik.push({ branza: b.id, flagi: flagiOsm(b, tagi) })
  }
  return wynik
}

/** To samo dla miejsca Overture { kat (taxonomy.primary), nazwa }. */
export function klasyfikujOverture(miejsce) {
  const wynik = []
  for (const b of BRANZE) {
    const trafia = b.overture?.some((r) => {
      const { wartosc, filtr } = rozbierzRegule(r)
      return miejsce.kat === wartosc && (!filtr || FILTRY[filtr].overture(miejsce))
    })
    if (!trafia) continue
    const flagi = Object.entries(b.flagi ?? {})
      .filter(([, def]) => def.overture?.includes(miejsce.kat))
      .map(([flaga]) => flaga)
    wynik.push({ branza: b.id, flagi })
  }
  return wynik
}

/** Pary klucz → wartości OSM do wstępnego filtra SQL (bez nazwanych filtrów: te działają w JS). */
export function selektoryOsm() {
  const mapa = new Map()
  for (const b of BRANZE)
    for (const r of b.osm ?? []) {
      const { klucz, wartosc } = rozbierzRegule(r)
      if (!mapa.has(klucz)) mapa.set(klucz, new Set())
      mapa.get(klucz).add(wartosc)
    }
  return mapa
}

/** Wszystkie klucze OSM, które trzeba pobrać razem z obiektem, żeby klasyfikacja miała komplet tagów. */
export function kluczeOsm() {
  const klucze = new Set(['name', 'brand', 'healthcare', 'healthcare:speciality'])
  for (const b of BRANZE) {
    for (const r of [
      ...(b.osm ?? []),
      ...(b.osmWyklucz ?? []),
      ...Object.values(b.flagi ?? {}).flatMap((f) => f.osm ?? []),
    ])
      klucze.add(rozbierzRegule(r).klucz)
  }
  // Prefiksy nieczynności dla kluczy głównych.
  for (const k of [...selektoryOsm().keys()])
    for (const p of ['disused', 'abandoned', 'was']) klucze.add(`${p}:${k}`)
  return [...klucze]
}

/** Kategorie Overture potrzebne do wstępnego filtra (bez sufiksów `?filtr`). */
export function kategorieOverture() {
  return [
    ...new Set(BRANZE.flatMap((b) => (b.overture ?? []).map((r) => rozbierzRegule(r).wartosc))),
  ]
}

/** PKD → parametr API CEIDG („96.02.Z" → „9602Z"). */
export const pkdDoParametru = (pkd) => pkd.replaceAll('.', '')

/** Widok katalogu do `katalog.json`: tylko dane opisowe, bez funkcji. */
export function opisBranzy(b) {
  return {
    id: b.id,
    nazwa: b.nazwa,
    zasiegPieszyM: b.zasiegPieszyM,
    mapowanie: {
      osm: b.osm ?? [],
      osmWyklucz: b.osmWyklucz ?? [],
      overture: b.overture ?? [],
      pkd: b.pkd ?? [],
      flagi: b.flagi ?? {},
      rejestr: b.rejestr ?? null,
      zrodloPrawdy: b.zrodloPrawdy ?? null,
    },
    uwagi: b.uwagi,
  }
}
