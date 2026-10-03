// Warstwy z modelu Metropolii Krakowskiej (SMK) w MSIP: liceum, główne trasy rowerowe i wody.
// Źródło: Gmina Miejska Kraków, Portal MSIP Obserwatorium (https://msip.krakow.pl), zbiór
// „Metropolia Krakowska” (https://msip.krakow.pl/dataset/2241) – model struktury funkcjonalno-
// przestrzennej Strategii Metropolia Krakowska 2030, dane Stowarzyszenia Metropolia Krakowska
// i BDOT. Usługi: folder Metropolia_Krakowska, plansze 06 (edukacja), 03 (mobilność) i 02
// (środowisko, przestrzeń), układ EPSG:2180. Licencja: Regulamin MSIP, dlatego liczymy pliki
// statyczne jednym pobraniem do etl/.cache/msip/, a nie pośredniczymy w usłudze.
// Liczy trzy wskaźniki dla każdego adresu z adresy.json:
//   liceum_odleglosc         – metry do najbliższego liceum ogólnokształcącego dla młodzieży,
//   droga_rowerowa_odleglosc – metry do najbliższej głównej trasy rowerowej metropolii,
//   woda_odleglosc           – metry do najbliższego cieku albo zbiornika wodnego.
// Zasięg to 15 gmin Stowarzyszenia: adres z gminy spoza niego (Koniusza) dostaje null, nie
// odległość do obiektów sąsiadów. Szkół podstawowych nie liczymy: szkola_podst_odleglosc ma
// zadanie #8 (SIO, stan 2025, wszystkie adresy), więc SMK (stan 2021) byłoby dublem.
// Uruchom: node etl/metropolia-smk.mjs (pobrania MSIP zapisuje w etl/.cache/msip/).
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import proj4 from 'proj4'
import { MSIP, pobierzWarstweMsip } from './lib/msip-arcgis.mjs'
import { IndeksOdcinkow, IndeksWielokatow, punktWPierscieniach } from './lib/odleglosc-ksztalty.mjs'
import { dzis, wczytajAdresy, zapiszWskaznik } from './lib/wspolne.mjs'

const SMK = `${MSIP}/Metropolia_Krakowska`
const P02 = `${SMK}/SMK_plansza_02_model_srodowisko_przestrzen_do_SIP/MapServer`
const P03 = `${SMK}/SMK_plansza_03_model_mobilnosc_do_SIP/MapServer`
const P06 = `${SMK}/SMK_plansza_06_model_edukacja_do_SIP/MapServer`
const LICENCJA =
  'Regulamin MSIP: https://msip.krakow.pl/getHtml?dok_id=228972; zbiór „Metropolia Krakowska”: https://msip.krakow.pl/dataset/2241; przetworzono: filtr obiektów i odległość w linii prostej'
const KRAKOW = '1261011'
const MAX_PROMIEN = 60_000 // m; obszar SMK ma ok. 58 × 36 km, więc obiekt zawsze leży bliżej

proj4.defs(
  'EPSG:2180',
  '+proj=tmerc +lat_0=0 +lon_0=19 +k=0.9993 +x_0=500000 +y_0=-5300000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs',
)

// Nie liceum dla młodzieży: dorośli, zaoczne, wieczorowe, specjalne oraz technika i gimnazja,
// które warstwa „Licea_gminy_MK” miesza z liceami. Słowa kluczowe są bez polskich liter, bo
// nazwy szkół gmin mają w źródle zepsute kodowanie (np. „DOROSĹYCH”).
const NIE_LICEUM_DLA_MLODZIEZY = /DOROS|ZAOCZN|WIECZOR|SPECJALN|TECHNIKUM|GIMNAZJUM/i

/** Czy wpis ewidencji szkół to liceum ogólnokształcące dla młodzieży; 0 uczniów = szkoła nieczynna. */
export function czyLiceumDlaMlodziezy(nazwa, uczniowie = null) {
  return (
    /LICEUM|LIC\./i.test(nazwa ?? '') && !NIE_LICEUM_DLA_MLODZIEZY.test(nazwa) && uczniowie !== 0
  )
}

/** Odcinki cieku pod ziemią (polozenie −1: przepusty, kanały) nie są wodą, którą widać z okna. */
export function czyCiekNaPowierzchni(atrybuty) {
  return atrybuty.polozenie !== -1
}

/** Punkty z geometrii Esri JSON: punkt (x, y) albo wielopunkt (points). */
export function punktyGeometrii(geometria) {
  if (!geometria) return []
  if (Array.isArray(geometria.points)) return geometria.points
  return Number.isFinite(geometria.x) && Number.isFinite(geometria.y)
    ? [[geometria.x, geometria.y]]
    : []
}

/** Punkty liceów dla młodzieży: Kraków (warstwa 4, nazwa NZ_PL) i gminy (warstwa 3, NAZWA_SZK). */
export function punktyLiceow(liceaKrakow, liceaGminy) {
  const krakow = liceaKrakow.filter((f) => czyLiceumDlaMlodziezy(f.attributes.NZ_PL))
  const gminy = liceaGminy.filter((f) =>
    czyLiceumDlaMlodziezy(f.attributes.NAZWA_SZK, f.attributes.L_UCZNIOW),
  )
  return {
    punkty: [...krakow, ...gminy].flatMap((f) => punktyGeometrii(f.geometry)),
    krakow: krakow.length,
    gminy: gminy.length,
  }
}

/** TERYT (7 cyfr) gmin objętych modelem; adres z innej gminy nie ma w nim żadnych danych. */
export function terytyGmin(featuresGmin) {
  return new Set(featuresGmin.map((f) => String(f.attributes.idTerytTer)))
}

/** Data stanu z pola data_utworzenia (ms od epoki): jedna data albo zakres „od/do”. */
export function dataStanu(features) {
  const dni = new Set(
    features.map((f) => new Date(f.attributes.data_utworzenia).toISOString().slice(0, 10)),
  )
  if (!dni.size) throw new Error('Brak obiektów, nie ustalę daty stanu')
  const posortowane = [...dni].sort()
  return posortowane.length === 1 ? posortowane[0] : `${posortowane[0]}/${posortowane.at(-1)}`
}

/**
 * Odległości (m, zaokrąglone do pełnych) od punktów do obiektów indeksu. Punkt null (adres bez
 * danych) i brak obiektu w zasięgu dają null; punkt wewnątrz wielokąta daje 0.
 */
export function odleglosciDoIndeksu(punkty, indeks, maxPromien, wielokaty = null) {
  return punkty.map((p) => {
    if (!p) return null
    if (wielokaty?.zawiera(p[0], p[1])) return 0
    const d = indeks.najblizszy(p[0], p[1], maxPromien)
    return d === null ? null : Math.round(d)
  })
}

/** Kwantyle wartości niepustych – do wyboru zakresu skali i do raportu. */
export function kwantyle(wartosci) {
  const v = wartosci.filter((x) => x !== null).sort((a, b) => a - b)
  const at = (q) => v[Math.min(v.length - 1, Math.floor(q * v.length))]
  return { n: v.length, p50: at(0.5), p90: at(0.9), p95: at(0.95), p99: at(0.99), max: v.at(-1) }
}

/**
 * Sprawdza układ współrzędnych: adres z gminy X musi w przeważającej części leżeć w wielokącie
 * gminy X z modelu. Zły układ albo zamienione lon/lat dałyby udział bliski zera.
 */
export function zgodnoscAdresowZGranicami(adresy, przelicz, featuresGmin, krok = 25) {
  const wielokaty = new Map(
    featuresGmin.map((f) => [String(f.attributes.idTerytTer), f.geometry.rings]),
  )
  let ocenione = 0
  let wGminie = 0
  for (let i = 0; i < adresy.length; i += krok) {
    const rings = wielokaty.get(adresy[i].teryt)
    if (!rings) continue
    const [x, y] = przelicz.forward([adresy[i].lon, adresy[i].lat])
    ocenione++
    if (punktWPierscieniach(x, y, rings)) wGminie++
  }
  return { ocenione, wGminie, udzial: ocenione ? wGminie / ocenione : 0 }
}

const zrodlo = (pierwotne, opis, url, dataDanych, pobrano) => ({
  nazwa: `Gmina Miejska Kraków, Portal MSIP Obserwatorium (https://msip.krakow.pl) – zbiór „Metropolia Krakowska” (${pierwotne}), ${opis}`,
  url,
  licencja: LICENCJA,
  dataDanych,
  pobrano,
})

async function main() {
  const start = performance.now()
  const pobrano = dzis()
  const gminy = await pobierzWarstweMsip(`${P06}/14`, 'p06_14')
  const liceaKrakow = await pobierzWarstweMsip(`${P06}/4`, 'p06_4')
  const liceaGminy = await pobierzWarstweMsip(`${P06}/3`, 'p06_3')
  const rowery = await pobierzWarstweMsip(`${P03}/9`, 'p03_9')
  const rzeki = await pobierzWarstweMsip(`${P02}/6`, 'p02_6')
  const wody = await pobierzWarstweMsip(`${P02}/7`, 'p02_7')
  console.log(
    `Pobrano: gminy ${gminy.liczba}, licea Kraków ${liceaKrakow.liczba}, licea gminy ${liceaGminy.liczba}, trasy rowerowe ${rowery.liczba}, cieki ${rzeki.liczba}, zbiorniki ${wody.liczba}`,
  )

  const licea = punktyLiceow(liceaKrakow.features, liceaGminy.features)
  const indeksLiceow = new IndeksOdcinkow(2000)
  for (const [x, y] of licea.punkty) indeksLiceow.dodajPunkt(x, y)

  const indeksRowerow = new IndeksOdcinkow(1000)
  let kmRowerowych = 0
  for (const f of rowery.features) {
    kmRowerowych += f.attributes.Shape_Length / 1000
    for (const sciezka of f.geometry.paths) indeksRowerow.dodajLamana(sciezka)
  }

  const cieki = rzeki.features.filter((f) => czyCiekNaPowierzchni(f.attributes))
  const indeksWod = new IndeksOdcinkow(500)
  for (const f of cieki) for (const sciezka of f.geometry.paths) indeksWod.dodajLamana(sciezka)
  const zbiorniki = new IndeksWielokatow(500)
  for (const f of wody.features) {
    for (const pierscien of f.geometry.rings) indeksWod.dodajLamana(pierscien)
    zbiorniki.dodaj(f.geometry.rings)
  }
  console.log(
    `Licea dla młodzieży: ${licea.krakow} w Krakowie (z ${liceaKrakow.liczba} wpisów) + ${licea.gminy} w gminach (z ${liceaGminy.liczba}); cieki na powierzchni ${cieki.length}/${rzeki.liczba}; trasy rowerowe ${rowery.liczba} (${kmRowerowych.toFixed(0)} km)`,
  )

  const { adresy } = wczytajAdresy()
  const przelicz = proj4('EPSG:4326', 'EPSG:2180')
  const zgodnosc = zgodnoscAdresowZGranicami(adresy, przelicz, gminy.features)
  console.log(
    `Układ współrzędnych: ${zgodnosc.wGminie}/${zgodnosc.ocenione} próbkowanych adresów leży w granicy własnej gminy (${(100 * zgodnosc.udzial).toFixed(1)}%)`,
  )
  if (zgodnosc.ocenione < 1000 || zgodnosc.udzial < 0.95)
    throw new Error('Adresy nie pokrywają się z granicami gmin – sprawdź układ EPSG:2180')

  const pokryte = terytyGmin(gminy.features)
  if (!pokryte.has(KRAKOW)) throw new Error('Model nie zawiera Krakowa')
  const bezDanych = [...new Set(adresy.filter((a) => !pokryte.has(a.teryt)).map((a) => a.gmina))]
  const punkty = adresy.map((a) => (pokryte.has(a.teryt) ? przelicz.forward([a.lon, a.lat]) : null))
  const wyniki = {
    liceum: odleglosciDoIndeksu(punkty, indeksLiceow, MAX_PROMIEN),
    rower: odleglosciDoIndeksu(punkty, indeksRowerow, MAX_PROMIEN),
    woda: odleglosciDoIndeksu(punkty, indeksWod, MAX_PROMIEN, zbiorniki),
  }
  for (const [nazwa, v] of Object.entries(wyniki))
    if (v.some((x, i) => punkty[i] && x === null))
      throw new Error(`${nazwa}: adres z obszaru modelu bez wyniku`)
  console.log(
    `Adresy z danymi: ${punkty.filter(Boolean).length}/${adresy.length}; gminy poza SMK (null): ${bezDanych.join(', ') || 'brak'}`,
  )
  for (const [nazwa, v] of Object.entries(wyniki)) console.log(nazwa, JSON.stringify(kwantyle(v)))

  const opisBraku = bezDanych.length
    ? ` Brak danych dla gmin spoza Stowarzyszenia Metropolia Krakowska: ${bezDanych.join(', ')}.`
    : ''
  const wspolne = { rozdzielczosc: 'adres', jednostka: 'm', kierunek: 'neutralny', zadanie: 113 }
  const smk = 'dane Stowarzyszenia Metropolia Krakowska'
  const stanLiceow = dataStanu([...liceaKrakow.features, ...liceaGminy.features])
  const stanRowerow = dataStanu(rowery.features)
  const stanWod = dataStanu([...rzeki.features, ...wody.features])

  zapiszWskaznik(
    {
      id: 'liceum_odleglosc',
      kategoria: 'codziennosc',
      ...wspolne,
      nazwa: 'Najbliższe liceum ogólnokształcące',
      opis: `Odległość w linii prostej od adresu do najbliższego liceum ogólnokształcącego dla młodzieży (publicznego lub niepublicznego). Liczba liceów w zbiorze: ${licea.krakow + licea.gminy} (${licea.krakow} w Krakowie, ${licea.gminy} w pozostałych gminach metropolii). Pominięto licea dla dorosłych, zaoczne, wieczorowe i specjalne, technika, gimnazja oraz szkoły bez uczniów. Ewidencja Metropolii Krakowskiej (stan z ${stanLiceow}) mogła się zdezaktualizować, a przy granicy obszaru najbliższe liceum bywa poza zbiorem – wtedy odległość jest zawyżona. To nie jest trasa ani czas dojazdu.${opisBraku}`,
      zakres: [0, 10000],
      zrodla: [
        zrodlo(
          smk,
          'plansza 06 „edukacja”, warstwa „licea ogólnokształcące” (Kraków)',
          `${P06}/4`,
          dataStanu(liceaKrakow.features),
          pobrano,
        ),
        zrodlo(
          smk,
          'plansza 06 „edukacja”, warstwa „Licea_gminy_MK” (pozostałe gminy)',
          `${P06}/3`,
          dataStanu(liceaGminy.features),
          pobrano,
        ),
      ],
    },
    wyniki.liceum,
  )

  zapiszWskaznik(
    {
      id: 'droga_rowerowa_odleglosc',
      kategoria: 'transport',
      ...wspolne,
      nazwa: 'Najbliższa główna trasa rowerowa',
      opis: `Odległość w linii prostej od adresu do najbliższej głównej trasy rowerowej Metropolii Krakowskiej (m.in. Wiślana Trasa Rowerowa, Velo Metropolis, Velo Rudawa, Velo Natura, Velo Prądnik). Warstwa to ok. ${Math.round(kmRowerowych)} km tras w ${rowery.liczba} odcinkach (stan z ${stanRowerow}), a nie pełna sieć dróg rowerowych: lokalnych ścieżek i pasów w niej nie ma, więc duża odległość nie oznacza braku infrastruktury rowerowej. To nie jest długość dojazdu rowerem.${opisBraku}`,
      zakres: [0, 6000],
      zrodla: [
        zrodlo(
          `${smk} uzupełnione o inne źródła`,
          'plansza 03 „mobilność”, warstwa „drogi_rowerowe_metropolia” (główne trasy rowerowe)',
          `${P03}/9`,
          dataStanu(rowery.features),
          pobrano,
        ),
      ],
    },
    wyniki.rower,
  )

  zapiszWskaznik(
    {
      id: 'woda_odleglosc',
      kategoria: 'kontekst',
      ...wspolne,
      nazwa: 'Najbliższa woda powierzchniowa',
      opis: `Odległość w linii prostej od adresu do najbliższej wody powierzchniowej: osi cieku (rzeka lub potok, bez odcinków pod ziemią) albo brzegu zbiornika wodnego, także małego stawu; 0 dla adresu wewnątrz zbiornika. Dane BDOT w opracowaniu Metropolii Krakowskiej (stan z ${stanWod}): odcinków cieków ${cieki.length}, zbiorników ${wody.liczba}. Cieki liczone są od osi koryta, więc przy szerokiej rzece (Wisła ma w danych ok. 100 m) do brzegu jest bliżej. To kontekst, nie ocena: bliskość wody nie mówi o zagrożeniu powodziowym, to pokazują osobne warstwy. Przy granicy obszaru najbliższa woda może leżeć poza zbiorem.${opisBraku}`,
      zakres: [0, 1500],
      zrodla: [
        zrodlo(
          'BDOT',
          'plansza 02 „środowisko, przestrzeń”, warstwa „rzeki” (cieki powierzchniowe)',
          `${P02}/6`,
          dataStanu(rzeki.features),
          pobrano,
        ),
        zrodlo(
          'BDOT',
          'plansza 02 „środowisko, przestrzeń”, warstwa „wody powierzchniowe” (zbiorniki wodne)',
          `${P02}/7`,
          dataStanu(wody.features),
          pobrano,
        ),
      ],
    },
    wyniki.woda,
  )

  const pokrycie = (v, wybor) =>
    `${v.filter((x, i) => wybor(adresy[i]) && x !== null).length}/${adresy.filter(wybor).length}`
  for (const [nazwa, v] of Object.entries(wyniki))
    console.log(
      `${nazwa}: pokrycie Kraków ${pokrycie(v, (a) => a.teryt === KRAKOW)}, obwarzanek ${pokrycie(v, (a) => a.teryt !== KRAKOW)}`,
    )
  console.log(`Czas: ${((performance.now() - start) / 1000).toFixed(1)} s`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]))
  main().catch((blad) => {
    console.error(blad)
    process.exitCode = 1
  })
