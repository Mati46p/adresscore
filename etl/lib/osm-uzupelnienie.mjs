// Czyste funkcje warstw „OSM – uzupełnienie" (#159): ładowarki EV, życie nocne, targowiska,
// wybiegi dla psów, siłownie plenerowe i urzędy. Bez wejścia/wyjścia, więc da się je testować bez
// pliku PBF i bez sieci (etl/osm-uzupelnienie.test.mjs).
// Biblioteka #124 (etl/lib/osm-uslugi.mjs) zostaje nietknięta: jej klasyfikacja jest związana z jej
// własną listą grup, więc tu są wersje przyjmujące listę grup; geometrię, indeks siatkowy i licznik
// na 1000 mieszkańców skrypt importuje stamtąd.
import { do2180 } from './geo.mjs'
import { grupujPunkty, indeksPunktow, sumaWPromieniu } from './przestrzen.mjs'

// Dostęp publiczny: bez tagu access (w OSM domyślnie otwarte) albo wprost yes / permissive.
// Odpada każda inna wartość: private, no, customers, permit, employees, members, military, delivery.
const dostepPubliczny = (t) =>
  t.access === undefined || t.access === 'yes' || t.access === 'permissive'
// Lokal rozrywkowy dla klientów to zwykły lokal, więc odpadają tylko miejsca zamknięte dla ogółu.
const lokalOtwarty = (t) => !['private', 'no', 'members'].includes(t.access)
const nieczynny = (t) => t.disused === 'yes' || t.abandoned === 'yes'

const NIECZYNNE_NAZWY = /nieczynn|zlikwidowan|likwidowan/iu
// Place szkoleniowe i psie przedszkola mają tag dog_park, ale to nie wybiegi. Wzorzec jest wąski
// celowo: „Wybieg dla psów przy Szkole nr 5" ma zostać.
const SZKOLENIE_PSOW = /tresur|szkoleni[ae]\s+psów|szko[łl]a\s+(dla\s+)?psów|psie\s+przedszkol/iu
// Urząd gminy, miasta, dzielnicy albo ratusz. Gminy obwarzanka mają urzędy głównie jako
// office=government (nie amenity=townhall), a oba tagi łapią też starostwa, inspektoraty, kurie
// i wydziały komunikacji, więc o przyjęciu decyduje nazwa.
const URZAD_SAMORZADU =
  /^(urząd\s+(gminy|miasta|miejski|dzielnicy)|rada\s+i\s+zarząd\s+dzielnicy|ratusz)/iu

/**
 * Czy stacja ładowania obsługuje samochody. W OSM te same tagi mają ładowarki autobusów MPK
 * (motorcar=no, bus=yes), rowerów elektrycznych (bicycle=designated) i hulajnóg. Bez wyraźnego
 * motorcar=yes pojazdy inne niż samochód wykluczają stację.
 */
export function czyLadowarkaSamochodow(t) {
  if (t.motorcar === 'yes') return true
  if (t.motorcar === 'no' || t.vehicle === 'no') return false
  return !(t.bicycle === 'yes' || t.bicycle === 'designated' || t.bus === 'yes')
}

/**
 * Grupy wskaźników. `tagi`: pary [klucz, wartość] – obiekt OSM trafia do grupy, gdy ma którąkolwiek.
 * `akceptuj`: filtr na tagach obiektu. `brzeg`: obiekt jest obszarem, który ma znaczenie jako cały
 * (targowisko, wybieg), więc odległość liczymy do jego obrysu, a nie do środka.
 * `scalM` i `scalWgNazwy`: jak scalamy wpisy do LICZNIKA (nie do odległości, tam liczy się
 * najbliższy wpis): wpisy bliższe niż `scalM` to jedno miejsce, a przy `scalWgNazwy` tylko te
 * o tej samej nazwie (w gęstej zabudowie sąsiednie lokale mają różne nazwy).
 * Ta lista jest jedynym źródłem prawdy: zapytanie do PBF składamy z niej (warunekSql).
 */
export const GRUPY = [
  {
    id: 'ladowarka_ev',
    tagi: [['amenity', 'charging_station']],
    akceptuj: (t) => dostepPubliczny(t) && !nieczynny(t) && czyLadowarkaSamochodow(t),
    scalM: 50, // punkty ładowania jednej stacji bywają osobnymi węzłami
  },
  {
    id: 'zycie_nocne',
    tagi: [
      ['amenity', 'bar'],
      ['amenity', 'pub'],
      ['amenity', 'nightclub'],
    ],
    akceptuj: (t) => lokalOtwarty(t) && !nieczynny(t),
    scalM: 25, // ten sam lokal jako węzeł i budynek leży do kilkunastu metrów od siebie
    scalWgNazwy: true,
  },
  {
    id: 'targowisko',
    tagi: [['amenity', 'marketplace']],
    akceptuj: (t) => dostepPubliczny(t) && !nieczynny(t) && !NIECZYNNE_NAZWY.test(t.name ?? ''),
    brzeg: true,
    scalM: 50,
  },
  {
    id: 'wybieg_psy',
    tagi: [['leisure', 'dog_park']],
    akceptuj: (t) =>
      dostepPubliczny(t) && !nieczynny(t) && t.fee !== 'yes' && !SZKOLENIE_PSOW.test(t.name ?? ''),
    brzeg: true,
    scalM: 50,
  },
  {
    id: 'silownia_plenerowa',
    tagi: [['leisure', 'fitness_station']],
    // Każdy przyrząd siłowni bywa osobnym węzłem – do licznika scalamy je w jedno miejsce.
    akceptuj: (t) => dostepPubliczny(t) && !nieczynny(t) && t.fee !== 'yes' && t.indoor !== 'yes',
    scalM: 50,
  },
  {
    id: 'urzad',
    tagi: [
      ['amenity', 'townhall'],
      ['office', 'government'],
    ],
    // amenity inne niż townhall (np. archive) oznacza obiekt, który nie przyjmuje interesantów.
    akceptuj: (t) =>
      (t.amenity === undefined || t.amenity === 'townhall') &&
      dostepPubliczny(t) &&
      !nieczynny(t) &&
      URZAD_SAMORZADU.test(t.name ?? ''),
    scalM: 50,
  },
]

/** Klucze tagów czytane z PBF: te z grup oraz pomocnicze dla filtrów. */
export function kluczeTagow(grupy = GRUPY) {
  return [
    ...new Set([
      ...grupy.flatMap((g) => g.tagi.map(([k]) => k)),
      'name',
      'type',
      'access',
      'indoor',
      'fee',
      'disused',
      'abandoned',
      'motorcar',
      'vehicle',
      'bicycle',
      'bus',
    ]),
  ]
}

/** Warunek SQL (DuckDB, kolumna `tags` z ST_ReadOSM) wybierający obiekty z którymkolwiek tagiem grupy. */
export function warunekSql(grupy = GRUPY) {
  const poKluczu = new Map()
  for (const g of grupy)
    for (const [k, v] of g.tagi) poKluczu.set(k, [...(poKluczu.get(k) ?? []), v])
  return [...poKluczu]
    .map(
      ([k, wartosci]) =>
        `map_extract_value(tags, '${k}') in (${[...new Set(wartosci)].map((v) => `'${v}'`).join(', ')})`,
    )
    .join(' or ')
}

/** Identyfikatory grup, do których należy obiekt o danych tagach (obiekt może być w kilku). */
export function klasyfikuj(tagi, grupy = GRUPY) {
  return grupy
    .filter((g) => g.tagi.some(([k, v]) => tagi[k] === v) && (!g.akceptuj || g.akceptuj(tagi)))
    .map((g) => g.id)
}

/**
 * Identyfikatory zewnętrznych linii (role=outer) relacji wielokąta. Wnętrza (inner) pomijamy:
 * targowisko mierzymy do zewnętrznej granicy placu, a budynek w jego środku (Okrąglak na Placu
 * Nowym) nie jest jego brzegiem. Każda zewnętrzna linia jest osobnym obrysem; pierścień złożony
 * z kilku otwartych linii nie jest składany, więc jego odległość do obrysu bywa zawyżona.
 * Argumenty to równoległe tablice z ST_ReadOSM (refs, ref_types, ref_roles).
 */
export function zewnetrzneLinie(refs, refTypes, refRoles) {
  return refs.filter((_, i) => refTypes?.[i] === 'way' && refRoles?.[i] === 'outer')
}

// --- Scalanie wpisów do licznika ------------------------------------------------------------

const porownaj = (a, b) =>
  a.lat - b.lat || a.lon - b.lon || (a.nazwa ?? '').localeCompare(b.nazwa ?? '')

/** Nazwa do porównań: małe litery, pojedyncze spacje. Pusta nazwa to brak nazwy. */
export function normalizujNazwe(nazwa) {
  return (nazwa ?? '').toLocaleLowerCase('pl').replace(/\s+/g, ' ').trim()
}

/**
 * Scala punkty { lat, lon, nazwa } bliższe niż `promienM` w jedno miejsce (łańcuchowo: A–B i B–C
 * dają jedno miejsce, nawet gdy A–C jest dalej). Przy `wgNazwy` scalamy tylko wpisy o tej samej
 * niepustej nazwie: dwa różne lokale w jednej kamienicy zostają dwoma, a wpis bez nazwy nie ma jak
 * wykazać, że jest duplikatem. Zwraca środki grup; wynik nie zależy od kolejności wejścia.
 */
export function scalPunkty(punkty, promienM, wgNazwy = false) {
  const wynik = []
  const wedlugNazwy = new Map()
  for (const p of [...punkty].sort(porownaj)) {
    const klucz = wgNazwy ? normalizujNazwe(p.nazwa) : ''
    if (wgNazwy && klucz === '') {
      wynik.push(p)
      continue
    }
    const lista = wedlugNazwy.get(klucz)
    if (lista) lista.push(p)
    else wedlugNazwy.set(klucz, [p])
  }
  for (const lista of wedlugNazwy.values()) {
    const xy = lista.map((p) => do2180(p.lon, p.lat))
    for (const grupa of grupujPunkty(xy, promienM)) {
      const czlonkowie = grupa.map((i) => lista[i])
      wynik.push({
        lat: czlonkowie.reduce((s, p) => s + p.lat, 0) / czlonkowie.length,
        lon: czlonkowie.reduce((s, p) => s + p.lon, 0) / czlonkowie.length,
        nazwa: czlonkowie[0].nazwa,
      })
    }
  }
  return wynik.sort(porownaj)
}

// --- Liczenie w promieniu -------------------------------------------------------------------

/**
 * Liczba punktów { lat, lon } w promieniu `promienM` (włącznie z brzegiem) od każdego adresu.
 * Odległości w metrach układu 1992 (EPSG:2180) jak w warstwie ławek (#46): skala różni się od
 * prawdziwej o ok. 0,06%, czyli o 0,2 m na 300 m. Brak punktów daje zera (zmierzone zero).
 */
export function policzWPromieniu(adresy, punkty, promienM) {
  if (!punkty.length) return adresy.map(() => 0)
  const indeks = indeksPunktow(punkty.map((p) => do2180(p.lon, p.lat)))
  return adresy.map((a) => {
    const [x, y] = do2180(a.lon, a.lat)
    return sumaWPromieniu(indeks, x, y, promienM)
  })
}

/** Zaokrągla w górę do wielokrotności `krok` (górna granica skali: p90 w Krakowie, w górę do 500 m). */
export const zaokraglijWGore = (x, krok) => Math.ceil(x / krok) * krok
