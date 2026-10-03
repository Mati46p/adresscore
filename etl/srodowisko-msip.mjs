// Środowisko Krakowa z MSIP (#118): cztery wskaźniki liczone dla adresów w Krakowie.
//
//   paleniska_200m              – potencjalnie czynne paleniska na paliwo stałe w promieniu 200 m
//   przewietrzanie_klasa        – klasa 1–4 z mapy średnich warunków anemologicznych (siatka 100 m)
//   stacje_bazowe_300m          – lokalizacje stacji bazowych telefonii komórkowej w promieniu 300 m
//   siec_cieplownicza_odleglosc – odległość do najbliższego odcinka sieci ciepłowniczej MPEC
//
// Źródło: Gmina Miejska Kraków, Portal MSIP Obserwatorium (https://msip.krakow.pl), usługi ArcGIS
// REST w EPSG:2178. Licencja: Regulamin MSIP, który zabrania ciągłego pośredniczenia w usługach
// miasta – dlatego jedno pobranie do etl/.cache/ i pliki statyczne liczone skryptem.
// Dane obejmują tylko Kraków: adres w gminie obwarzanka dostaje null (brak danych), nie 0.
//
// Decyzje (dlaczego):
//  - Paleniska: wartość liczymy WYŁĄCZNIE z listy „potencjalnie czynne w 2025”. Listy z lat
//    2021–2024 i inwentaryzacja 2012 nie są podzbiorami kolejnych lat (tylko część punktów się
//    pokrywa), więc sumowanie lat podwajałoby paleniska, a stara inwentaryzacja karałaby ulice
//    za piece, których już nie ma. Historia trafia tylko do opisu. Rejestr „zlikwidowane od
//    2011" kończy się na imporcie z 2019-12 – nie zmienia stanu bieżącego, więc go pomijamy.
//  - Przewietrzanie: klasa z jedynej warstwy z jawną, czteroklasową legendą (Atlas_05). Atlas_02
//    (pola gi_wne_av5, ii_rzedu, srvw10m) to inne zmienne modelu na tej samej siatce, bez
//    legendy klasowej, więc nie mieszamy ich do jednej liczby. Atlas_06 (dyspersja) to raster,
//    którego regulamin MSIP (pkt 22) nie pozwala pobierać.
//  - Stacje bazowe: rekord warstwy to pojedyncza antena, nie stacja (5 440 rekordów, ok. 740
//    lokalizacji), więc zliczamy lokalizacje, a radiolinie i anteny satelitarne odrzucamy.
//  - Sieć ciepłownicza: kierunek „neutralny” – wszystkie dotychczasowe warstwy kategorii
//    „przyszłość” są neutralne, a nowa warstwa dostaje wagę domyślną (wagaNowych) w wyniku.
//    Odległość do rury nie mówi, czy budynek da się przyłączyć, więc nie premiujemy jej po
//    cichu; użytkownik włączy ocenę kierunkiem „mniej-lepiej” (jedna linia w meta poniżej).
//  - Bez `etykiety`: sama tablica null dla 176 684 adresów to ok. 0,9 MB, a liczba z jednostką
//    wystarcza karcie.
//
// Uruchom: node etl/srodowisko-msip.mjs [paleniska] [przewietrzanie] [stacje] [siec]
// (bez argumentów – wszystkie cztery; pobrania buforowane w etl/.cache/msip/).
import { fileURLToPath } from 'node:url'
import { dataZMs, LICENCJA_MSIP, MSIP, naMetry, pobierzWarstwe } from './lib/msip.mjs'
import {
  grupujPunkty,
  indeksPunktow,
  najblizszyOdcinek,
  srodekGrupy,
  sumaWPromieniu,
  zbudujIndeksOdcinkow,
} from './lib/przestrzen.mjs'
import { dzis, wczytajAdresy, zapiszWskaznik } from './lib/wspolne.mjs'

export const TERYT_KRAKOW = '1261011'
const PALENISKA = 'JP/JP_PIECE_EWIDENCJA_PS/MapServer'
const ATLAS_ANEMOLOGICZNY = 'MONIT-AIR/WS_MA_Atlas_05_mapa_anemologiczna/MapServer/3'
const STACJE = 'Obserwatorium/WS_GSM/MapServer/0'
const SIEC = 'Obserwatorium/MPEC/MapServer/2'
const KATALOG_MONITAIR = 'https://msip.krakow.pl/dataset/1113'
const PROMIEN_PALENISK = 200
const PROMIEN_STACJI = 300
const SKLEJANIE_ANTEN = 20
/** Górne granice (włącznie, jak classMaxValue w ArcGIS) klas 1–3 mapy anemologicznej; wyżej klasa 4. */
export const PROGI_KLAS = [1, 2, 3]
/** Prostokąt, w którym muszą leżeć stacje bazowe (EPSG:2178) – inaczej to błąd współrzędnych. */
const OKOLICE_KRAKOWA = { x: [7_400_000, 7_460_000], y: [5_520_000, 5_570_000] }

const liczba = new Intl.NumberFormat('pl-PL')
const nazwaMsip = (zbior) => `Gmina Miejska Kraków, Portal MSIP Obserwatorium – ${zbior}`

// ── Funkcje czyste (testowane w srodowisko-msip.test.mjs) ───────────────────────────────

/** Klasa 1–4 wg legendy mapy anemologicznej; null dla braku liczby. */
export function klasaPrzewietrzania(v, progi = PROGI_KLAS) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null
  const k = progi.findIndex((p) => v <= p)
  return k === -1 ? progi.length + 1 : k + 1
}

/**
 * Rzeczownik po liczebniku: 1 palenisko, 2–4 paleniska, 5 i więcej palenisk (12–14 też „palenisk”).
 * Liczby w opisach wskaźników pochodzą z danych, więc odmiana nie może być wpisana na sztywno.
 */
export function formaLiczby(n, jeden, kilka, wiele) {
  if (n === 1) return jeden
  const ostatnie = n % 10
  const dwie = n % 100
  return ostatnie >= 2 && ostatnie <= 4 && !(dwie >= 12 && dwie <= 14) ? kilka : wiele
}

/** „28.02.2025” → „2025-02-28”. */
export function dataZPolskiej(tekst) {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(String(tekst).trim())
  if (!m) throw new Error(`Nieoczekiwany format daty: ${tekst}`)
  return `${m[3]}-${m[2]}-${m[1]}`
}

/**
 * Radiolinie (łącza punkt–punkt) i anteny satelitarne to nie stacje bazowe. Pisownia typu
 * w źródle bywa błędna („radilonia”, „radolinia”), stąd szeroki wzorzec.
 */
export function czyAntenaStacji(typ) {
  return !/radiol|radil|radol|satelit/i.test(typ ?? '')
}

/** Legenda warstwy musi być tą, na której opieramy klasy – inaczej opis wskaźnika by kłamał. */
export function sprawdzLegende(info, progi = PROGI_KLAS) {
  const render = info.drawingInfo?.renderer
  const granice = render?.classBreakInfos?.map((c) => c.classMaxValue) ?? []
  if (
    render?.type !== 'classBreaks' ||
    render.field !== 'wentyl_v4m' ||
    granice.length !== progi.length + 1 ||
    granice.slice(0, -1).join() !== progi.join()
  )
    throw new Error('Legenda mapy anemologicznej się zmieniła – sprawdź klasy przed liczeniem')
}

/**
 * Siatka klas: komórka (x_index, y_index) od 1 zaczyna się w lewym dolnym rogu zasięgu warstwy.
 * Wymagamy kompletnej siatki o boku 100 m i unikalnych komórek – dziura albo duplikat
 * przesunęłyby klasy pod złe adresy.
 */
export function zbudujSiatkeKlas(rekordy, zasieg, progi = PROGI_KLAS, bok = 100) {
  let nx = 0
  let ny = 0
  for (const r of rekordy) {
    nx = Math.max(nx, r.x_index)
    ny = Math.max(ny, r.y_index)
  }
  const bokX = (zasieg.xmax - zasieg.xmin) / nx
  const bokY = (zasieg.ymax - zasieg.ymin) / ny
  if (Math.abs(bokX - bok) > 1e-6 || Math.abs(bokY - bok) > 1e-6)
    throw new Error(`Siatka ma bok ${bokX} × ${bokY} m, oczekiwano ${bok} m`)
  if (rekordy.length !== nx * ny)
    throw new Error(`Siatka niekompletna: ${rekordy.length} komórek z ${nx * ny}`)
  const klasy = new Int8Array(nx * ny)
  for (const r of rekordy) {
    const k = klasaPrzewietrzania(r.wentyl_v4m, progi)
    const miejsce = (r.y_index - 1) * nx + (r.x_index - 1)
    if (k === null || klasy[miejsce] !== 0)
      throw new Error(`Komórka ${r.x_index}|${r.y_index}: brak wartości albo duplikat`)
    klasy[miejsce] = k
  }
  return { x0: zasieg.xmin, y0: zasieg.ymin, bok, nx, ny, klasy }
}

/** Klasa komórki zawierającej punkt (metry EPSG:2178); null poza siatką. */
export function klasaWPunkcie(siatka, x, y) {
  const i = Math.floor((x - siatka.x0) / siatka.bok)
  const j = Math.floor((y - siatka.y0) / siatka.bok)
  if (i < 0 || j < 0 || i >= siatka.nx || j >= siatka.ny) return null
  return siatka.klasy[j * siatka.nx + i] || null
}

/** Lokalizacje stacji: anteny stacji bazowych sklejone łańcuchowo w promieniu `eps` metrów. */
export function lokalizacjeStacji(obiekty, eps = SKLEJANIE_ANTEN) {
  const punkty = []
  let zlych = 0
  for (const o of obiekty) {
    if (!czyAntenaStacji(o.attributes.typ_emit)) continue
    for (const [x, y] of o.geometry?.points ?? []) {
      const wOkolicy =
        x >= OKOLICE_KRAKOWA.x[0] &&
        x <= OKOLICE_KRAKOWA.x[1] &&
        y >= OKOLICE_KRAKOWA.y[0] &&
        y <= OKOLICE_KRAKOWA.y[1]
      if (wOkolicy) punkty.push([x, y])
      else zlych++
    }
  }
  const grupy = grupujPunkty(punkty, eps)
  return { lokalizacje: grupy.map((g) => srodekGrupy(punkty, g)), anten: punkty.length, zlych }
}

/** Odcinki proste [ax, ay, bx, by] ze wszystkich linii (polilinii) warstwy. */
export function odcinkiZLinii(obiekty) {
  const odcinki = []
  for (const o of obiekty)
    for (const sciezka of o.geometry?.paths ?? [])
      for (let i = 1; i < sciezka.length; i++)
        odcinki.push([sciezka[i - 1][0], sciezka[i - 1][1], sciezka[i][0], sciezka[i][1]])
  return odcinki
}

// ── Wskaźniki ────────────────────────────────────────────────────────────────────────────

/** Wartość dla adresów w Krakowie, null dla reszty (xy[i] === null poza Krakowem). */
const dlaKrakowa = (xy, licz) => xy.map((p) => (p ? licz(p[0], p[1]) : null))

function wymagajKompletnosci(nazwa, xy, wartosci, dopuszczalneBraki = 0) {
  const braki = wartosci.filter((v, i) => xy[i] && v === null).length
  const krakow = xy.filter(Boolean).length
  console.log(`${nazwa}: adresów w Krakowie ${krakow}, bez wartości ${braki}`)
  if (braki > krakow * dopuszczalneBraki)
    throw new Error(
      `${nazwa}: ${braki} adresów w Krakowie bez wartości (limit ${dopuszczalneBraki})`,
    )
}

async function paleniska(xy, pobrano) {
  const wczytaj = (nr, katalog) =>
    pobierzWarstwe(`${PALENISKA}/${nr}`, { katalog: `msip/${katalog}` })
  const l25 = await wczytaj(1, 'paleniska_2025')
  const l24 = await wczytaj(2, 'paleniska_2024')
  const l22 = await wczytaj(3, 'paleniska_2022')
  const l21 = await wczytaj(4, 'paleniska_2021')
  const l12 = await wczytaj(5, 'paleniska_2012')
  const suma = (l, pole) => l.obiekty.reduce((s, f) => s + (f.attributes[pole] ?? 0), 0)

  const wagi = l25.obiekty.map((f) => f.attributes.ps_2025)
  if (wagi.some((w) => !Number.isInteger(w) || w < 0) || l25.obiekty.some((f) => !f.geometry))
    throw new Error('Paleniska 2025: brak geometrii albo liczba palenisk nie jest liczbą całkowitą')
  const stan25 = [...new Set(l25.obiekty.map((f) => dataZPolskiej(f.attributes.stan_na)))].sort()
  const dataStanu = stan25.at(-1)
  const indeks = indeksPunktow(l25.obiekty.map((f) => [f.geometry.x, f.geometry.y]))
  const wartosci = dlaKrakowa(xy, (x, y) => sumaWPromieniu(indeks, x, y, PROMIEN_PALENISK, wagi))
  wymagajKompletnosci('paleniska_200m', xy, wartosci)

  const stanyHistorii = [l21, l22, l24, l12]
    .flatMap((l) => l.obiekty.map((f) => dataZMs(f.attributes.stan_na)))
    .filter((d, i, t) => t.indexOf(d) === i)
    .sort()
  const dataPL = dataStanu.split('-').reverse().join('.')
  const palenisk = (n) =>
    `${liczba.format(n)} ${formaLiczby(n, 'palenisko', 'paleniska', 'palenisk')}`
  const lokalizacji = formaLiczby(
    l25.obiekty.length,
    'lokalizacji',
    'lokalizacjach',
    'lokalizacjach',
  )
  zapiszWskaznik(
    {
      id: 'paleniska_200m',
      kategoria: 'spokoj',
      nazwa: 'Paleniska na paliwo stałe w 200 m',
      opis: `Liczba potencjalnie czynnych palenisk na paliwo stałe (np. pieców i kotłów węglowych) z ewidencji miasta w promieniu 200 m od adresu. Stan na ${dataPL}: ${palenisk(suma(l25, 'ps_2025'))} w ${l25.obiekty.length} ${lokalizacji} w całym Krakowie. Dla porównania ewidencja „Liczba palenisk w 2012” wykazuje ${palenisk(suma(l12, 'f2012suma'))}, a lista potencjalnie czynnych liczyła ${liczba.format(suma(l21, 'f2021suma'))} w styczniu 2021 r., ${liczba.format(suma(l22, 'ps_2022'))} w 2022 r. i ${liczba.format(suma(l24, 'ps_2024'))} w 2024 r. Zero oznacza brak wpisu w ewidencji, a nie pewność, że w okolicy nikt nie pali: kominki, instalacje spoza ewidencji i paleniska w sąsiednich gminach nie są liczone, a instalacje w gastronomii to osobna warstwa miasta. Ewidencja obejmuje tylko Kraków – dla gmin obwarzanka brak danych (null, nie zero).`,
      jednostka: 'szt.',
      kierunek: 'mniej-lepiej',
      rozdzielczosc: 'adres',
      // Najwięcej w całym mieście: 4 paleniska w 200 m (2025). Zakres do 5, żeby skala nie
      // spłaszczała się do zera przy pojedynczych wpisach.
      zakres: [0, 5],
      zadanie: 118,
      zrodla: [
        {
          nazwa: nazwaMsip(
            'Ewidencja palenisk na paliwo stałe, warstwa „Potencjalnie czynne paleniska w 2025”',
          ),
          url: `${MSIP}/${PALENISKA}/1`,
          licencja: LICENCJA_MSIP,
          dataDanych: dataStanu,
          pobrano,
        },
        {
          nazwa: nazwaMsip(
            'Ewidencja palenisk na paliwo stałe, warstwy z lat 2012–2024 (dane porównawcze w opisie)',
          ),
          url: `${MSIP}/${PALENISKA}`,
          licencja: LICENCJA_MSIP,
          dataDanych: stanyHistorii.join(', '),
          pobrano,
        },
      ],
    },
    wartosci,
  )
  const rozklad = new Map()
  for (const v of wartosci) if (v !== null) rozklad.set(v, (rozklad.get(v) ?? 0) + 1)
  console.log(
    `  rozkład w 200 m (liczba palenisk: adresów): ${[...rozklad.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([k, n]) => `${k}: ${n}`)
      .join(', ')}`,
  )
  return wartosci
}

async function przewietrzanie(xy, pobrano) {
  const { obiekty, info } = await pobierzWarstwe(ATLAS_ANEMOLOGICZNY, {
    katalog: 'msip/przewietrzanie_atlas05',
    geometria: false,
  })
  sprawdzLegende(info)
  const siatka = zbudujSiatkeKlas(
    obiekty.map((o) => o.attributes),
    info.extent,
  )
  const wartosci = dlaKrakowa(xy, (x, y) => klasaWPunkcie(siatka, x, y))
  // Zasięg siatki (prostokąt 31 × 18 km) nie domyka północno-wschodniego rogu granicy miasta.
  wymagajKompletnosci('przewietrzanie_klasa', xy, wartosci, 0.001)
  zapiszWskaznik(
    {
      id: 'przewietrzanie_klasa',
      kategoria: 'spokoj',
      nazwa: 'Przewietrzanie okolicy',
      opis: 'Klasa przewietrzania (od 1 do 4) komórki siatki 100 × 100 m, w której leży adres, według legendy mapy średnich warunków anemologicznych Atlasu MONIT-AIR (Atlas pokrycia terenu i przewietrzania Krakowa, 2016): 1 – poniżej 1,0; 2 – 1,0–2,0; 3 – 2,0–3,0; 4 – powyżej 3,0 (klasy prędkości wiatru w m/s). Im wyższa klasa, tym lepiej wiatr wywiewa zanieczyszczenia i nadmiar ciepła. To model uśredniony na siatce, nie pomiar przy budynku: zabudowa, drzewa i ukształtowanie terenu zmieniają wiatr lokalnie. Siatka obejmuje Kraków – dla gmin obwarzanka brak danych (null, nie zero).',
      jednostka: 'klasa (1–4)',
      kierunek: 'wiecej-lepiej',
      rozdzielczosc: 'siatka',
      rozmiar: '100 m',
      zakres: [1, 4],
      zadanie: 118,
      zrodla: [
        {
          nazwa: nazwaMsip('MONIT-AIR Atlas 2016, mapa średnich warunków anemologicznych'),
          url: `${MSIP}/${ATLAS_ANEMOLOGICZNY}`,
          licencja: `${LICENCJA_MSIP}; zbiór „Projekt Monit-Air – dane wektorowe”: ${KATALOG_MONITAIR}`,
          dataDanych: '2016',
          pobrano,
        },
      ],
    },
    wartosci,
  )
  const rozklad = [0, 0, 0, 0, 0]
  for (const v of wartosci) if (v !== null) rozklad[v]++
  console.log(`  klasy 1/2/3/4 (adresów): ${rozklad.slice(1).join(' / ')}`)
  return wartosci
}

async function stacje(xy, pobrano) {
  const { obiekty } = await pobierzWarstwe(STACJE, { katalog: 'msip/stacje_bazowe' })
  const { lokalizacje, anten, zlych } = lokalizacjeStacji(obiekty)
  console.log(
    `stacje_bazowe_300m: ${obiekty.length} rekordów, ${anten} anten stacji bazowych → ${lokalizacje.length} lokalizacji (poza Krakowem odrzucono ${zlych} punktów)`,
  )
  if (zlych > 0) throw new Error(`Stacje: ${zlych} punktów poza okolicami Krakowa`)
  const indeks = indeksPunktow(lokalizacje)
  const wartosci = dlaKrakowa(xy, (x, y) => sumaWPromieniu(indeks, x, y, PROMIEN_STACJI))
  wymagajKompletnosci('stacje_bazowe_300m', xy, wartosci)
  // Znacznik odświeżenia warstwy w MSIP (nocny import), jedyna data w źródle.
  const dataDanych = dataZMs(Math.max(...obiekty.map((o) => o.attributes.aktualnosc)))
  zapiszWskaznik(
    {
      id: 'stacje_bazowe_300m',
      kategoria: 'kontekst',
      nazwa: 'Stacje bazowe telefonii w 300 m',
      opis: 'Liczba lokalizacji stacji bazowych telefonii komórkowej, czyli źródeł pola elektromagnetycznego, w promieniu 300 m od adresu. To informacja o otoczeniu, nie ocena: sama liczba nie mówi, jakie pole występuje w mieszkaniu – zależy ono od mocy, kierunku i wysokości anten oraz od odległości. Anteny oddalone o najwyżej 20 m liczymy jako jedną lokalizację (maszt albo dach z kilkoma operatorami); radiolinie i anteny satelitarne pomijamy. Liczymy tylko to, co jest w warstwie miasta, więc lista może nie obejmować wszystkich instalacji. Tylko Kraków – dla gmin obwarzanka brak danych (null, nie zero).',
      jednostka: 'szt.',
      kierunek: 'neutralny',
      rozdzielczosc: 'adres',
      zakres: [0, 10],
      zadanie: 118,
      zrodla: [
        {
          nazwa: nazwaMsip('Stacje bazowe telefonii komórkowej (WS_GSM)'),
          url: `${MSIP}/${STACJE}`,
          licencja: LICENCJA_MSIP,
          dataDanych,
          pobrano,
        },
      ],
    },
    wartosci,
  )
  const rozklad = new Map()
  for (const v of wartosci) if (v !== null) rozklad.set(v, (rozklad.get(v) ?? 0) + 1)
  console.log(
    `  rozkład w 300 m (lokalizacji: adresów): ${[...rozklad.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([k, n]) => `${k}: ${n}`)
      .join(', ')}`,
  )
  return wartosci
}

async function siec(xy, pobrano) {
  const { obiekty } = await pobierzWarstwe(SIEC, { katalog: 'msip/siec_mpec' })
  const odcinki = odcinkiZLinii(obiekty)
  console.log(
    `siec_cieplownicza_odleglosc: ${obiekty.length} linii, ${odcinki.length} odcinków prostych`,
  )
  const indeks = zbudujIndeksOdcinkow(odcinki)
  const wartosci = dlaKrakowa(xy, (x, y) => {
    const najblizszy = najblizszyOdcinek(indeks, x, y)
    // Pełne metry: dokładność punktu adresowego i tak jest rzędu metrów.
    return najblizszy ? Math.round(najblizszy.metry) : null
  })
  wymagajKompletnosci('siec_cieplownicza_odleglosc', xy, wartosci)
  zapiszWskaznik(
    {
      id: 'siec_cieplownicza_odleglosc',
      kategoria: 'przyszlosc',
      nazwa: 'Odległość do sieci ciepłowniczej',
      opis: 'Odległość w linii prostej od adresu do najbliższego odcinka sieci ciepłowniczej MPEC z mapy MSIP (magistrale, sieć rozdzielcza, przyłącza i sieć niskoparametrowa). Mała odległość nie oznacza, że budynek jest podłączony, a duża – że nie da się go przyłączyć: o przyłączeniu decyduje operator. Ciepło z innych sieci niż MPEC nie jest uwzględnione. MSIP nie podaje daty stanu sieci, dlatego w źródle widnieje data pobrania. Mapa obejmuje tylko Kraków – dla gmin obwarzanka brak danych (null, nie zero).',
      jednostka: 'm',
      // Neutralny celowo (patrz nagłówek): ocenę włącza użytkownik kierunkiem „mniej-lepiej”.
      kierunek: 'neutralny',
      rozdzielczosc: 'adres',
      zakres: [0, 500],
      zadanie: 118,
      zrodla: [
        {
          nazwa: nazwaMsip('Sieć ciepłownicza MPEC'),
          url: `${MSIP}/${SIEC}`,
          licencja: LICENCJA_MSIP,
          dataDanych: pobrano,
          pobrano,
        },
      ],
    },
    wartosci,
  )
  const posortowane = wartosci.filter((v) => v !== null).sort((a, b) => a - b)
  const q = (p) => posortowane[Math.min(posortowane.length - 1, Math.floor(p * posortowane.length))]
  console.log(
    `  odległość [m]: p10 ${q(0.1)}, mediana ${q(0.5)}, p90 ${q(0.9)}, maks. ${q(1)}; do 50 m: ${((100 * posortowane.filter((v) => v <= 50).length) / posortowane.length).toFixed(1)}%`,
  )
  return wartosci
}

const WSKAZNIKI = { paleniska, przewietrzanie, stacje, siec }

/** Znane miejsca: wypisujemy, żeby kontrola była widoczna w logu każdego biegu. */
const KONTROLE = [
  ['Rynek Główny', '1'],
  ['Szeroka', '1'],
  ['Brzeska', '2'], // ok. 76 m od stacji P4 i Towerlink z warstwy WS_GSM (Wyciąże)
  ['Ludwika Idzikowskiego', '9'],
  ['Białoprądnicka', '33'],
]

function wypiszKontrole(adresy, wyniki) {
  const kolumny = Object.keys(wyniki)
  console.log(`Kontrola na znanych adresach (${kolumny.join(' | ')}):`)
  for (const [ulica, nr] of KONTROLE) {
    const i = adresy.findIndex((a) => a.teryt === TERYT_KRAKOW && a.ulica === ulica && a.nr === nr)
    if (i < 0) console.log(`  ${ulica} ${nr}: brak w adresach`)
    else console.log(`  ${ulica} ${nr}: ${kolumny.map((k) => wyniki[k][i]).join(' | ')}`)
  }
}

export async function main(wybrane = []) {
  const nazwy = wybrane.length ? wybrane : Object.keys(WSKAZNIKI)
  const nieznane = nazwy.filter((n) => !WSKAZNIKI[n])
  if (nieznane.length)
    throw new Error(
      `Nieznany wskaźnik: ${nieznane.join(', ')} (dostępne: ${Object.keys(WSKAZNIKI)})`,
    )
  const start = performance.now()
  const { adresy } = wczytajAdresy()
  const xy = adresy.map((a) => (a.teryt === TERYT_KRAKOW ? naMetry(a.lon, a.lat) : null))
  console.log(`Adresów: ${adresy.length}, w Krakowie: ${xy.filter(Boolean).length}`)
  const pobrano = dzis()
  const wyniki = {}
  const bledy = []
  for (const nazwa of nazwy) {
    try {
      wyniki[nazwa] = await WSKAZNIKI[nazwa](xy, pobrano)
    } catch (blad) {
      bledy.push(nazwa)
      console.error(`BŁĄD ${nazwa}: ${blad.message}`)
    }
  }
  if (Object.keys(wyniki).length) wypiszKontrole(adresy, wyniki)
  console.log(`Czas: ${((performance.now() - start) / 1000).toFixed(1)} s`)
  if (bledy.length) process.exitCode = 1
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1])
  await main(process.argv.slice(2))
