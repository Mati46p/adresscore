// Osuwiska i tereny zagrożone ruchami masowymi (zadanie #117): dwa wskaźniki z bazy SOPO
// (System Osłony Przeciwosuwiskowej, PIG-PIB, mapa osuwisk 1:10 000).
//
// Źródła:
//   Kraków – Gmina Miejska Kraków, Portal MSIP Obserwatorium (https://msip.krakow.pl), usługa
//     WS/RUCHY_MASOWE_SOPO_2024: warstwa 8 (strefy aktywności osuwisk), 9 (tereny zagrożone).
//   Pozostałe 13 gmin – PIG-PIB, usługa geozagrozenia/sopo_obszary: warstwa 14 (osuwiska),
//     13 (strefy aktywności), 12 (tereny zagrożone). Usługa nie wspiera `query`, a MSIP nie oddaje
//     geometrii poligonów w `query`, więc oba źródła czytamy operacją `identify` z kopertą
//     (zwraca pełne wielokąty). PIG ucina odpowiedź na 1000 rekordach, dlatego kafelkujemy
//     adaptacyjnie (podział na cztery, aż kafel się zmieści).
//   Zasięg opracowania i autorzy: PIG-PIB, geozagrozenia/sopo_stan (warstwa 0, tu działa `query`).
//
// Numer osuwiska SOPO jest wspólny dla MSIP i PIG (np. 785). Kraków bierzemy z MSIP, a PIG
// uzupełnia osuwiska, których numeru w MSIP nie ma (inne gminy, osuwiska tuż za granicą miasta
// i nowsze wpisy). Dzięki temu odległość liczona z adresu przy granicy gmin nie ignoruje
// osuwiska po drugiej stronie granicy, a żadne osuwisko nie liczy się dwa razy.
//
// Wskaźniki (każdy adres z adresy.json, null = brak opracowania SOPO, nigdy 0):
//   osuwisko_odleglosc – odległość [m] od punktu adresu do granicy najbliższego osuwiska, 0 = adres
//     leży na osuwisku. Liczą się osuwiska każdej aktywności; etykieta podaje stan najbliższego.
//   teren_osuwiskowy – 1 = adres w granicach osuwiska albo terenu zagrożonego ruchami masowymi,
//     0 = poza nimi w obszarze opracowania.
// Obszar opracowania to suma wielokątów z sopo_stan; adres poza nimi (gmina Koniusza) dostaje null,
// bo „brak osuwisk w bazie” znaczy tam „nie kartowano”, a nie „bezpiecznie”.
//
// Uruchom: node etl/osuwiska.mjs   (pierwszy bieg ok. 50 zapytań do usług; potem tylko cache)
// Odświeżenie źródeł (nowa edycja SOPO, inne adresy): usuń etl/.cache/osuwiska/ i uruchom ponownie.
// Kontrola: SPRAWDZ=1 node etl/osuwiska.mjs – pyta usługi źródłowe o próbkę adresów (wewnątrz,
//   tuż przy granicy, daleko) i porównuje z wynikiem naszej geometrii.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import KDBush from 'kdbush'
import proj4 from 'proj4'
import { CACHE, dzis, wczytajAdresy, zapiszWskaznik } from './lib/wspolne.mjs'

const MSIP = 'https://msip.um.krakow.pl/arcgis/rest/services/WS/RUCHY_MASOWE_SOPO_2024/MapServer'
const MSIP_META =
  'https://msip.um.krakow.pl/geoportal/rest/metadata/item/8114abc898a549fb9be080a221013b54/html'
const PIG = 'https://cbdgmapa.pgi.gov.pl/arcgis/rest/services/geozagrozenia/sopo_obszary/MapServer'
const PIG_STAN =
  'https://cbdgmapa.pgi.gov.pl/arcgis/rest/services/geozagrozenia/sopo_stan/MapServer/0'
const WARUNKI_PIG =
  'https://www.pgi.gov.pl/osuwiska/dokumenty-prawne/9526-warunki-wykorzystania-danych-osuwiskowych-baza-sopo-10k/file.html'
const REGULAMIN_MSIP = 'https://msip.krakow.pl/getHtml?dok_id=228972'
const KAT = join(CACHE, 'osuwiska')

// Etykiety dostają tylko adresy blisko osuwiska; dla reszty liczba mówi wszystko. Tablica etykiet
// ma wpis na każdy adres (sama „null” to ok. 0,9 MB), więc dla progu 300 m plik miał 2,7 MB.
const ETYKIETA_DO_M = 100
// Margines wokół adresów, w którym szukamy osuwisk (odległości większe niż ok. 3 km przy skraju
// obszaru mogą być zawyżone – i tak dają najlepszą ocenę przy zakresie 0–500 m).
const MARGINES_STOPNIE = 0.04
const MAKS_GLEBOKOSC_KAFLI = 8

proj4.defs(
  'EPSG:2178',
  '+proj=tmerc +lat_0=0 +lon_0=21 +k=0.999923 +x_0=7500000 +y_0=0 +ellps=GRS80 +units=m +no_defs',
)
const DO_METROW = proj4('EPSG:4326', 'EPSG:2178')
const rzutujNaMetry = (lon, lat) => DO_METROW.forward([lon, lat])

// ---------- Aktywność osuwiska ----------
export const AKTYWNOSCI = {
  ciagle: { nazwa: 'aktywne ciągle', waga: 3 },
  okresowe: { nazwa: 'aktywne okresowo', waga: 2 },
  nieaktywne: { nazwa: 'nieaktywne', waga: 1 },
}

// Znaki łączone (akcenty po rozkładzie NFD), z kodów, żeby nie mieć w pliku niewidocznych znaków.
const ZNAKI_LACZONE = new RegExp(
  `[${String.fromCharCode(0x300)}-${String.fromCharCode(0x36f)}]`,
  'g',
)
const bezOgonkow = (t) =>
  t.normalize('NFD').replace(ZNAKI_LACZONE, '').replace(/ł/g, 'l').toLowerCase()

/**
 * Aktywność z tekstu źródła: PIG podaje udziały („aktywne ciągle (A) - 71%, nieaktywne (N) - 29%”,
 * z półpauzą i przecinkiem dziesiętnym w części rekordów), MSIP i strefy PIG – jedną klasę.
 * Przy udziałach bierzemy klasę dominującą (remis: poważniejsza). Nieznany tekst daje null.
 */
export function aktywnoscZTekstu(tekst) {
  if (typeof tekst !== 'string' || !tekst.trim()) return null
  const t = bezOgonkow(tekst)
  const udzialy = { ciagle: 0, okresowe: 0, nieaktywne: 0 }
  const klasy = [
    ['ciagle', 'aktywne ciagle'],
    ['okresowe', 'aktywne okresowo'],
    ['nieaktywne', 'nieaktywne'],
  ]
  let znaleziono = false
  for (const [klucz, fraza] of klasy) {
    let od = 0
    for (;;) {
      const i = t.indexOf(fraza, od)
      if (i < 0) break
      od = i + fraza.length
      // „aktywne ciągle” nie może być końcówką innego słowa; „nieaktywne” zawiera „aktywne”,
      // ale fraza „aktywne ciągle/okresowo” go nie dotyczy.
      const procent = /^[^%\d]*(\d+(?:[.,]\d+)?)\s*%/.exec(t.slice(od))
      if (procent) {
        udzialy[klucz] += Number(procent[1].replace(',', '.'))
        znaleziono = true
      } else if (!znaleziono) udzialy[klucz] += 0.0001
    }
  }
  const suma = udzialy.ciagle + udzialy.okresowe + udzialy.nieaktywne
  if (suma === 0) return null
  return Object.keys(udzialy).sort(
    (a, b) => udzialy[b] - udzialy[a] || AKTYWNOSCI[b].waga - AKTYWNOSCI[a].waga,
  )[0]
}

/** Klasa strefy aktywności PIG (TYP_AKTYWNOSCI_DOM: ciagle / okresowe / nieaktywne). */
export function aktywnoscStrefyPig(typ) {
  const t = typeof typ === 'string' ? bezOgonkow(typ).trim() : ''
  return t in AKTYWNOSCI ? t : null
}

// ---------- Geometria na płaszczyźnie (metry, EPSG:2178) ----------
/** Pole podpisane pierścienia (x,y przeplecione). Zewnętrzne w ESRI mają znak ujemny. */
export function poleZPodpisem(p) {
  let s = 0
  for (let i = 2; i < p.length; i += 2) s += p[i - 2] * p[i + 1] - p[i] * p[i - 1]
  return s / 2
}

function odlegloscDoOdcinka2(px, py, ax, ay, bx, by) {
  const dx = bx - ax
  const dy = by - ay
  const dl2 = dx * dx + dy * dy
  let t = dl2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / dl2
  t = t < 0 ? 0 : t > 1 ? 1 : t
  const qx = ax + t * dx - px
  const qy = ay + t * dy - py
  return qx * qx + qy * qy
}

/**
 * Wielokąt z pierścieniami (zewnętrzne i otwory, reguła parzystości). Duże wielokąty (zasięgi
 * opracowania mają dziesiątki tysięcy wierzchołków) dostają kubełki krawędzi po osi Y, żeby test
 * „punkt w wielokącie” nie przechodził przez wszystkie krawędzie.
 */
export class Wielokat {
  constructor(pierscienie, atrybuty = {}) {
    this.pierscienie = pierscienie.map(zamknij)
    this.atrybuty = atrybuty
    let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity]
    let n = 0
    for (const p of this.pierscienie)
      for (let i = 0; i < p.length; i += 2) {
        if (p[i] < x0) x0 = p[i]
        if (p[i] > x1) x1 = p[i]
        if (p[i + 1] < y0) y0 = p[i + 1]
        if (p[i + 1] > y1) y1 = p[i + 1]
        n++
      }
    this.bbox = [x0, y0, x1, y1]
    this.wierzcholki = n
    this.pole = Math.abs(this.pierscienie.reduce((s, p) => s + poleZPodpisem(p), 0))
    this.kubelki = n > 400 ? budujKubelki(this.pierscienie, y0, y1, n) : null
  }

  /** Czy punkt leży wewnątrz (pierścienie zewnętrzne minus otwory). */
  zawiera(x, y) {
    const [x0, y0, x1, y1] = this.bbox
    if (x < x0 || x > x1 || y < y0 || y > y1) return false
    let w = false
    if (this.kubelki) {
      const { krawedzie, poczatki, liczba, y0: dol, wysokosc } = this.kubelki
      const k = Math.min(liczba - 1, Math.floor((y - dol) / wysokosc))
      for (let e = poczatki[k]; e < poczatki[k + 1]; e++) {
        const ax = krawedzie[e * 4]
        const ay = krawedzie[e * 4 + 1]
        const bx = krawedzie[e * 4 + 2]
        const by = krawedzie[e * 4 + 3]
        if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) w = !w
      }
      return w
    }
    for (const p of this.pierscienie)
      for (let i = 2; i < p.length; i += 2) {
        const ax = p[i - 2]
        const ay = p[i - 1]
        const bx = p[i]
        const by = p[i + 1]
        if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) w = !w
      }
    return w
  }

  /** Kwadrat odległości punktu od najbliższej krawędzi (bez testu wnętrza). */
  odlegloscDoKrawedzi2(x, y) {
    let m = Infinity
    for (const p of this.pierscienie)
      for (let i = 2; i < p.length; i += 2) {
        const d = odlegloscDoOdcinka2(x, y, p[i - 2], p[i - 1], p[i], p[i + 1])
        if (d < m) m = d
      }
    return m
  }

  /** Odległość punktu od najbliższej krawędzi (0, gdy punkt leży na krawędzi); bez testu wnętrza. */
  odlegloscDoKrawedzi(x, y) {
    return Math.sqrt(this.odlegloscDoKrawedzi2(x, y))
  }

  /** Odległość punktu od wielokąta: 0 wewnątrz, inaczej do najbliższej krawędzi. */
  odleglosc(x, y) {
    return this.zawiera(x, y) ? 0 : this.odlegloscDoKrawedzi(x, y)
  }
}

function zamknij(p) {
  const n = p.length
  if (n >= 4 && (p[0] !== p[n - 2] || p[1] !== p[n - 1])) {
    const q = new Float64Array(n + 2)
    q.set(p)
    q[n] = p[0]
    q[n + 1] = p[1]
    return q
  }
  return p
}

function budujKubelki(pierscienie, y0, y1, n) {
  const liczba = Math.max(1, Math.min(2048, Math.ceil(n / 16)))
  const wysokosc = (y1 - y0) / liczba || 1
  const kubelek = (y) => Math.min(liczba - 1, Math.max(0, Math.floor((y - y0) / wysokosc)))
  const wKubelkach = Array.from({ length: liczba }, () => [])
  const wszystkie = []
  for (const p of pierscienie)
    for (let i = 2; i < p.length; i += 2) {
      const e = wszystkie.length / 4
      wszystkie.push(p[i - 2], p[i - 1], p[i], p[i + 1])
      const [a, b] = [kubelek(p[i - 1]), kubelek(p[i + 1])]
      for (let k = Math.min(a, b); k <= Math.max(a, b); k++) wKubelkach[k].push(e)
    }
  const poczatki = new Int32Array(liczba + 1)
  const wTabeli = []
  for (let k = 0; k < liczba; k++) {
    poczatki[k] = wTabeli.length
    for (const e of wKubelkach[k])
      wTabeli.push(
        wszystkie[e * 4],
        wszystkie[e * 4 + 1],
        wszystkie[e * 4 + 2],
        wszystkie[e * 4 + 3],
      )
  }
  poczatki[liczba] = wTabeli.length
  // poczatki liczone w krawędziach, nie w liczbach
  for (let k = 0; k <= liczba; k++) poczatki[k] /= 4
  return { krawedzie: Float64Array.from(wTabeli), poczatki, liczba, y0, wysokosc }
}

/**
 * Indeks wielu wielokątów: siatka kafli po bbox (test „który wielokąt zawiera punkt”) i KDBush po
 * wierzchołkach (górne ograniczenie odległości do najbliższego). Odległość jest dokładna:
 * liczymy ją do krawędzi wszystkich wielokątów, których bbox leży bliżej niż najbliższy wierzchołek.
 */
export class IndeksWielokatow {
  constructor(wielokaty, kafel = 1000) {
    this.wielokaty = wielokaty
    this.kafel = kafel
    this.siatka = new Map()
    this.bbox = new Float64Array(wielokaty.length * 4)
    let wierzcholki = 0
    wielokaty.forEach((w, k) => {
      this.bbox.set(w.bbox, k * 4)
      wierzcholki += w.wierzcholki
      const [x0, y0, x1, y1] = w.bbox
      for (let cx = Math.floor(x0 / kafel); cx <= Math.floor(x1 / kafel); cx++)
        for (let cy = Math.floor(y0 / kafel); cy <= Math.floor(y1 / kafel); cy++) {
          const klucz = `${cx}|${cy}`
          const lista = this.siatka.get(klucz)
          if (lista) lista.push(k)
          else this.siatka.set(klucz, [k])
        }
    })
    // KDBush po zbudowaniu przestawia współrzędne wewnętrznie, więc własne tablice wierzchołków
    // (indeks zwracany przez within() to kolejność dodania).
    const n = Math.max(1, wierzcholki)
    this.kd = new KDBush(n)
    this.vx = new Float64Array(n)
    this.vy = new Float64Array(n)
    let i = 0
    for (const w of wielokaty)
      for (const p of w.pierscienie)
        for (let j = 0; j < p.length; j += 2) {
          this.vx[i] = p[j]
          this.vy[i] = p[j + 1]
          this.kd.add(p[j], p[j + 1])
          i++
        }
    if (i === 0) this.kd.add(0, 0)
    this.kd.finish()
  }

  /** Wielokąty zawierające punkt. */
  zawierajace(x, y) {
    const wynik = []
    for (const k of this.siatka.get(
      `${Math.floor(x / this.kafel)}|${Math.floor(y / this.kafel)}`,
    ) ?? []) {
      const w = this.wielokaty[k]
      if (w.zawiera(x, y)) wynik.push(w)
    }
    return wynik
  }

  /** { odleglosc, wielokat, zawierajace } – 0 i wielokąt zawierający albo najbliższa krawędź. */
  najblizszy(x, y) {
    const zaw = this.zawierajace(x, y)
    if (zaw.length) return { odleglosc: 0, wielokat: zaw[0], zawierajace: zaw }
    if (!this.wielokaty.length) return null
    // Górne ograniczenie: najbliższy wierzchołek (krawędź jest co najwyżej tak daleko).
    let r = 64
    let ids = this.kd.within(x, y, r)
    while (!ids.length && r < 1_000_000) {
      r *= 2
      ids = this.kd.within(x, y, r)
    }
    if (!ids.length) return null
    let dv2 = Infinity
    for (const id of ids) {
      const dx = this.vx[id] - x
      const dy = this.vy[id] - y
      const d2 = dx * dx + dy * dy
      if (d2 < dv2) dv2 = d2
    }
    // Zapas na błąd zaokrąglenia: wielokąt z najbliższym wierzchołkiem ma być zawsze kandydatem.
    let naj2 = dv2 * (1 + 1e-9) + 1e-9
    let najW = null
    const b = this.bbox
    for (let k = 0; k < this.wielokaty.length; k++) {
      const dx = Math.max(b[k * 4] - x, 0, x - b[k * 4 + 2])
      const dy = Math.max(b[k * 4 + 1] - y, 0, y - b[k * 4 + 3])
      if (dx * dx + dy * dy > naj2) continue
      const d2 = this.wielokaty[k].odlegloscDoKrawedzi2(x, y)
      if (d2 <= naj2) {
        naj2 = d2
        najW = this.wielokaty[k]
      }
    }
    return { odleglosc: Math.sqrt(naj2), wielokat: najW, zawierajace: [] }
  }
}

// ---------- Składanie zbiorów wielokątów z dwóch źródeł ----------
const grupuj = (lista, pole) => {
  const m = new Map()
  for (const o of lista) {
    const k = o.atrybuty[pole]
    if (!m.has(k)) m.set(k, [])
    m.get(k).push(o)
  }
  return m
}

/** Pierścienie ze współrzędnych geograficznych [[lon, lat], …] na metry. */
export function naMetry(pierscienie, rzut) {
  return pierscienie.map((r) => {
    const t = new Float64Array(r.length * 2)
    r.forEach(([lon, lat], i) => {
      const [x, y] = rzut(lon, lat)
      t[i * 2] = x
      t[i * 2 + 1] = y
    })
    return t
  })
}

/**
 * Osuwiska: strefy aktywności MSIP (Kraków) + osuwiska PIG, których numeru MSIP nie ma. PIG ma
 * strefy aktywności w osobnej warstwie; gdy ich suma pokrywa osuwisko (±5%), używamy stref
 * (aktywność dokładnie w miejscu adresu), inaczej całego wielokąta z aktywnością z opisu.
 */
export function zlozOsuwiska({ msip8, pig14, pig13 }, rzut) {
  const wielokaty = []
  const stat = { msip: 0, pigStrefy: 0, pigCale: 0, osuwiskMsip: 0, osuwiskPig: 0 }
  const idMsip = new Set()
  for (const o of msip8) {
    const id = o.atrybuty.OSUW_ID
    idMsip.add(id)
    wielokaty.push(
      new Wielokat(naMetry(o.pierscienie, rzut), {
        id,
        zrodlo: 'msip',
        aktywnosc: aktywnoscZTekstu(o.atrybuty.d_AKTYW_ID),
      }),
    )
    stat.msip++
  }
  stat.osuwiskMsip = idMsip.size
  const strefy = grupuj(pig13, 'OSUWISKO_NUMER_IDENTYFIKACYJNY')
  for (const o of pig14) {
    const id = o.atrybuty.NUMER_IDENTYFIKACYJNY
    if (idMsip.has(id)) continue
    stat.osuwiskPig++
    const caly = new Wielokat(naMetry(o.pierscienie, rzut), {
      id,
      zrodlo: 'pig',
      aktywnosc: aktywnoscZTekstu(o.atrybuty.STOPIEN_AKTYWNOSCI),
    })
    const z = (strefy.get(id) ?? []).map(
      (s) =>
        new Wielokat(naMetry(s.pierscienie, rzut), {
          id,
          zrodlo: 'pig',
          aktywnosc: aktywnoscStrefyPig(s.atrybuty.TYP_AKTYWNOSCI_DOM),
        }),
    )
    const suma = z.reduce((s, w) => s + w.pole, 0)
    if (z.length && caly.pole > 0 && Math.abs(suma / caly.pole - 1) <= 0.05) {
      wielokaty.push(...z)
      stat.pigStrefy += z.length
    } else {
      wielokaty.push(caly)
      stat.pigCale++
    }
  }
  return { wielokaty, stat }
}

/** Tereny zagrożone: MSIP (KRTZ_ID) + PIG o numerach, których MSIP nie ma. */
export function zlozZagrozone({ msip9, pig12 }, rzut) {
  const wielokaty = []
  const idMsip = new Set()
  for (const o of msip9) {
    idMsip.add(o.atrybuty.KRTZ_ID)
    wielokaty.push(
      new Wielokat(naMetry(o.pierscienie, rzut), { id: o.atrybuty.KRTZ_ID, zrodlo: 'msip' }),
    )
  }
  for (const o of pig12) {
    const id = o.atrybuty.NUMER_IDENTYFIKACYJNY
    if (idMsip.has(id)) continue
    wielokaty.push(new Wielokat(naMetry(o.pierscienie, rzut), { id, zrodlo: 'pig' }))
  }
  return { wielokaty, stat: { msip: idMsip.size, pig: wielokaty.length - idMsip.size } }
}

// ---------- Klasyfikacja adresu ----------
const najpowazniejsza = (lista) =>
  lista.reduce(
    (a, w) =>
      (AKTYWNOSCI[w.atrybuty.aktywnosc]?.waga ?? 0) > (AKTYWNOSCI[a.atrybuty.aktywnosc]?.waga ?? 0)
        ? w
        : a,
    lista[0],
  )

const nazwaAktywnosci = (w) => AKTYWNOSCI[w.atrybuty.aktywnosc]?.nazwa ?? 'aktywność nieustalona'
const opisOsuwiska = (w) => `osuwisko ${nazwaAktywnosci(w)}, nr ${w.atrybuty.id}`
// Przy odległości etykieta stoi obok liczby „od osuwiska”, więc słowo „osuwisko” jest zbędne.
const stanOsuwiska = (w) => `${nazwaAktywnosci(w)}, nr ${w.atrybuty.id}`

/**
 * Metry do pełnych. Zero znaczy „adres na osuwisku”, więc punkt tuż za granicą (< 0,5 m) dostaje 1,
 * a nie 0 – inaczej wartość 0 i `teren_osuwiskowy` = 0 byłyby sprzeczne.
 */
export function zaokraglOdleglosc(d) {
  if (d === null) return null
  return d === 0 ? 0 : Math.max(1, Math.round(d))
}

/**
 * Wynik dla punktu w metrach. `wZasiegu` = punkt leży w zasięgu opracowania SOPO; poza nim oba
 * wskaźniki są null (brak opracowania, nie brak osuwisk).
 */
export function klasyfikuj(x, y, { osuwiska, zagrozone }, wZasiegu = true) {
  if (!wZasiegu) return null
  const naj = osuwiska.najblizszy(x, y)
  const wZagrozonym = zagrozone.zawierajace(x, y).length > 0
  const naOsuwisku = naj ? naj.odleglosc === 0 : false
  const etykietyTeren = []
  if (naOsuwisku) etykietyTeren.push(opisOsuwiska(najpowazniejsza(naj.zawierajace)))
  if (wZagrozonym) etykietyTeren.push('teren zagrożony ruchami masowymi')
  return {
    odleglosc: naj ? naj.odleglosc : null,
    teren: naOsuwisku || wZagrozonym ? 1 : 0,
    etykietaTeren: etykietyTeren.length ? etykietyTeren.join('; ') : null,
    etykietaOdleglosc:
      naj && zaokraglOdleglosc(naj.odleglosc) <= ETYKIETA_DO_M
        ? stanOsuwiska(naOsuwisku ? najpowazniejsza(naj.zawierajace) : naj.wielokat)
        : null,
  }
}

// ---------- Pobieranie ----------
async function pobierzJson(url) {
  for (let proba = 1; ; proba++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(180_000) })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const d = await r.json()
      if (d.error) throw new Error(JSON.stringify(d.error))
      return d
    } catch (e) {
      if (proba >= 3) throw new Error(`${url.slice(0, 200)} → ${e.message}`)
      await new Promise((ok) => setTimeout(ok, 1500 * proba))
    }
  }
}

/** identify dla koperty [x0, y0, x1, y1] albo punktu [lon, lat] (współrzędne geograficzne). */
function urlIdentify(baza, warstwa, { koperta, punkt }) {
  const [x0, y0, x1, y1] = koperta ?? []
  const srodek = punkt ?? [(x0 + x1) / 2, (y0 + y1) / 2]
  // mapExtent/imageDisplay ustalają skalę: identify pomija warstwy niewidoczne w tej skali
  // (PIG: 1:4 900–1:250 100), więc skala ma być stała i „środkowa”, niezależna od koperty.
  const q = new URLSearchParams({
    geometry: punkt
      ? JSON.stringify({ x: punkt[0], y: punkt[1], spatialReference: { wkid: 4326 } })
      : JSON.stringify({
          xmin: x0,
          ymin: y0,
          xmax: x1,
          ymax: y1,
          spatialReference: { wkid: 4326 },
        }),
    geometryType: punkt ? 'esriGeometryPoint' : 'esriGeometryEnvelope',
    sr: '4326',
    layers: `all:${warstwa}`,
    tolerance: '0',
    mapExtent: `${srodek[0] - 0.02},${srodek[1] - 0.02},${srodek[0] + 0.02},${srodek[1] + 0.02}`,
    imageDisplay: '1000,1000,96',
    returnGeometry: 'true',
    returnUnformattedValues: 'true',
    returnFieldName: 'true',
    f: 'json',
  })
  return `${baza}/identify?${q}`
}

/**
 * Wszystkie obiekty warstwy w kopercie, z adaptacyjnym kafelkowaniem (kafel, który wypełnił limit
 * rekordów, dzielimy na cztery). Wynik w etl/.cache/osuwiska/<nazwa>.json razem z datą pobrania.
 */
async function identifyWarstwa({ nazwa, baza, warstwa, idPole, limit, bbox }) {
  const plik = join(KAT, `${nazwa}.json`)
  if (existsSync(plik)) return JSON.parse(readFileSync(plik, 'utf8'))
  mkdirSync(KAT, { recursive: true })
  const obiekty = new Map()
  let zapytan = 0
  async function kafel(k, glebokosc) {
    zapytan++
    const d = await pobierzJson(urlIdentify(baza, warstwa, { koperta: k }))
    if (d.exceededTransferLimit || d.results.length >= limit) {
      if (glebokosc >= MAKS_GLEBOKOSC_KAFLI)
        throw new Error(`${nazwa}: kafel ${k} nadal przepełniony na głębokości ${glebokosc}`)
      const [x0, y0, x1, y1] = k
      const mx = (x0 + x1) / 2
      const my = (y0 + y1) / 2
      for (const sub of [
        [x0, y0, mx, my],
        [mx, y0, x1, my],
        [x0, my, mx, y1],
        [mx, my, x1, y1],
      ])
        await kafel(sub, glebokosc + 1)
      return
    }
    for (const x of d.results) {
      if (!x.geometry?.rings?.length) continue
      obiekty.set(String(x.attributes[idPole]), {
        atrybuty: x.attributes,
        pierscienie: x.geometry.rings,
      })
    }
  }
  await kafel(bbox, 0)
  const wynik = { pobrano: dzis(), zapytan, obiekty: [...obiekty.values()] }
  writeFileSync(plik, JSON.stringify(wynik))
  console.log(`${nazwa}: ${wynik.obiekty.length} obiektów w ${zapytan} zapytaniach`)
  return wynik
}

/** Zasięg opracowania SOPO: wielokąty „stanu prac” przecinające obszar (query działa w sopo_stan). */
async function pobierzStanPrac(bbox) {
  const plik = join(KAT, 'stan-prac.json')
  if (existsSync(plik)) return JSON.parse(readFileSync(plik, 'utf8'))
  mkdirSync(KAT, { recursive: true })
  const [x0, y0, x1, y1] = bbox
  const q = new URLSearchParams({
    where: '1=1',
    geometry: JSON.stringify({
      xmin: x0,
      ymin: y0,
      xmax: x1,
      ymax: y1,
      spatialReference: { wkid: 4326 },
    }),
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: '*',
    returnGeometry: 'true',
    outSR: '4326',
    f: 'json',
  })
  const d = await pobierzJson(`${PIG_STAN}/query?${q}`)
  if (d.exceededTransferLimit) throw new Error('sopo_stan: odpowiedź ucięta limitem rekordów')
  const wynik = {
    pobrano: dzis(),
    obiekty: d.features
      .filter((f) => f.geometry?.rings?.length)
      .map((f) => ({ atrybuty: f.attributes, pierscienie: f.geometry.rings })),
  }
  writeFileSync(plik, JSON.stringify(wynik))
  console.log(`stan-prac: ${wynik.obiekty.length} wielokątów zasięgu`)
  return wynik
}

// ---------- Źródła i metadane ----------
const nazwaZasiegu = (a) => {
  const gmina = String(a.GMINA ?? '').trim()
  if (gmina && gmina !== 'n.d.') return `gmina ${gmina}`
  return /^m\./.test(a.POWIAT) ? a.POWIAT : `powiat ${a.POWIAT}`
}

/** Autorzy opracowań z sopo_stan (PIG żąda ich cytowania) tylko dla zasięgów, które pokrywają adresy. */
export function autorzyZasiegow(zasiegi) {
  return zasiegi
    .map(
      (z) =>
        `${nazwaZasiegu(z)} (${z.ROK_ZAKONCZENIA}): ${String(z.AUTOR ?? 'brak danych')
          .replace(/\s+/g, ' ')
          .trim()}`,
    )
    .sort((a, b) => a.localeCompare(b, 'pl'))
    .join('; ')
}

const dataDanychPig = (zasiegi) => {
  const lata = zasiegi
    .map((z) => Number(String(z.AKTUALNOSC_TERENOWA ?? '').slice(0, 4)))
    .filter(Number.isFinite)
  return `${Math.min(...lata)}–${Math.max(...lata)} (aktualność terenowa kartowania wg gmin i powiatów)`
}

function zrodla({ pobranoMsip, pobranoPig, zasiegi }) {
  return [
    {
      nazwa:
        'Gmina Miejska Kraków, Portal MSIP Obserwatorium (https://msip.krakow.pl) – Mapa osuwisk i terenów zagrożonych ruchami masowymi, SOPO 2024 (Kraków)',
      url: MSIP,
      licencja: `Regulamin MSIP: ${REGULAMIN_MSIP}; warunki wykorzystania danych SOPO 10k PIG-PIB: ${WARUNKI_PIG}; metadane zbioru: ${MSIP_META}; dane przetworzone (przynależność punktu do osuwiska, odległość), pozyskano ${pobranoMsip}`,
      dataDanych: '2024 (metadane MSIP: rewizja 2025-04-28)',
      pobrano: pobranoMsip,
    },
    {
      nazwa:
        'Państwowy Instytut Geologiczny – PIB, System Osłony Przeciwosuwiskowej (SOPO) – osuwiska, strefy aktywności i tereny zagrożone (poza Krakowem i uzupełnienie wpisów nowszych niż MSIP)',
      url: PIG,
      licencja: `Warunki wykorzystania danych osuwiskowych (baza SOPO 10k), PIG-PIB, wersja 2024-11-15: ${WARUNKI_PIG}; wymagane podanie źródła, autorów, aktualności i czasu pozyskania oraz informacji o przetworzeniu; dane poglądowe, nie stanowią rejestru starosty (art. 110a Prawa ochrony środowiska); dane przetworzone przez adresscore, pozyskano ${pobranoPig}`,
      dataDanych: dataDanychPig(zasiegi),
      pobrano: pobranoPig,
    },
    {
      nazwa: 'PIG-PIB – SOPO, stan prac: zasięg opracowania i autorzy map osuwisk',
      url: PIG_STAN,
      licencja: `Autorzy opracowań SOPO (wymóg cytowania PIG-PIB): ${autorzyZasiegow(zasiegi)}`,
      dataDanych: dataDanychPig(zasiegi),
      pobrano: pobranoPig,
    },
  ]
}

const OGRANICZENIA =
  'Granice osuwisk są poglądowe (mapa 1:10 000, dokładność ok. 10–15 m), a punkt adresu nie reprezentuje działki ani budynku. Baza SOPO nie jest rejestrem starosty i nie zastępuje dokumentacji geologiczno-inżynierskiej; brak osuwiska w bazie nie oznacza braku zagrożenia.'

// ---------- Kontrola względem usług źródłowych ----------
async function kontrolaZUslugami({ adresy, wyniki }) {
  // Deterministyczny generator, żeby kolejny bieg pytał o tę samą próbkę.
  let ziarno = 117
  const losowy = () => {
    ziarno = (ziarno * 1664525 + 1013904223) % 4294967296
    return ziarno / 4294967296
  }
  const wybierz = (pred, n) => {
    const kandydaci = []
    for (let i = 0; i < adresy.length; i++)
      if (wyniki[i] && pred(wyniki[i], adresy[i])) kandydaci.push(i)
    const wybrane = []
    while (wybrane.length < n && kandydaci.length)
      wybrane.push(kandydaci.splice(Math.floor(losowy() * kandydaci.length), 1)[0])
    return wybrane
  }
  const wKrakowie = (a) => a.gmina === 'Kraków'
  const probki = [
    ['Kraków, na osuwisku', wybierz((w, a) => w.odleglosc === 0 && wKrakowie(a), 15)],
    [
      'Kraków, 10–60 m od osuwiska',
      wybierz((w, a) => w.odleglosc >= 10 && w.odleglosc <= 60 && wKrakowie(a), 15),
    ],
    ['Kraków, ponad 500 m', wybierz((w, a) => w.odleglosc > 500 && wKrakowie(a), 10)],
    ['obwarzanek, na osuwisku', wybierz((w, a) => w.odleglosc === 0 && !wKrakowie(a), 25)],
    [
      'obwarzanek, 10–60 m od osuwiska',
      wybierz((w, a) => w.odleglosc >= 10 && w.odleglosc <= 60 && !wKrakowie(a), 25),
    ],
    ['obwarzanek, ponad 500 m', wybierz((w, a) => w.odleglosc > 500 && !wKrakowie(a), 15)],
  ]
  let sprawdzone = 0
  let niezgodne = 0
  for (const [nazwa, ids] of probki) {
    let niezgodnychWProbce = 0
    for (const i of ids) {
      const a = adresy[i]
      // PIG zna osuwiska całego obszaru, MSIP tylko Kraków; „wewnątrz” po stronie serwera = trafienie
      // w którymkolwiek (nasz zbiór to ich suma, bez dublowania numerów).
      const punkt = [a.lon, a.lat]
      const trafienia = [(await pobierzJson(urlIdentify(PIG, 14, { punkt }))).results.length]
      if (wKrakowie(a))
        trafienia.push((await pobierzJson(urlIdentify(MSIP, 8, { punkt }))).results.length)
      const serwer = trafienia.some((n) => n > 0)
      const nasze = wyniki[i].odleglosc === 0
      sprawdzone++
      if (serwer !== nasze) {
        niezgodnychWProbce++
        console.log(
          `  NIEZGODNE: adres ${a.id} (${a.lon}, ${a.lat}) – my: ${nasze ? 'na osuwisku' : `${wyniki[i].odleglosc.toFixed(1)} m`}, usługa: ${serwer ? 'na osuwisku' : 'poza'}`,
        )
      }
    }
    niezgodne += niezgodnychWProbce
    console.log(`Kontrola „${nazwa}”: ${ids.length} adresów, niezgodnych ${niezgodnychWProbce}`)
  }
  console.log(`Kontrola z usługami źródłowymi: ${sprawdzone} adresów, niezgodnych ${niezgodne}`)
}

// ---------- Główny przebieg ----------
async function main() {
  const t0 = performance.now()
  const { adresy } = wczytajAdresy()
  const zakres = adresy.reduce(
    (b, a) => [
      Math.min(b[0], a.lon),
      Math.min(b[1], a.lat),
      Math.max(b[2], a.lon),
      Math.max(b[3], a.lat),
    ],
    [Infinity, Infinity, -Infinity, -Infinity],
  )
  const bbox = [
    zakres[0] - MARGINES_STOPNIE,
    zakres[1] - MARGINES_STOPNIE,
    zakres[2] + MARGINES_STOPNIE,
    zakres[3] + MARGINES_STOPNIE,
  ]
  const msip8 = await identifyWarstwa({
    nazwa: 'msip-warstwa8',
    baza: MSIP,
    warstwa: 8,
    idPole: 'FID',
    limit: 2000,
    bbox,
  })
  const msip9 = await identifyWarstwa({
    nazwa: 'msip-warstwa9',
    baza: MSIP,
    warstwa: 9,
    idPole: 'FID',
    limit: 2000,
    bbox,
  })
  const pig14 = await identifyWarstwa({
    nazwa: 'pig-warstwa14',
    baza: PIG,
    warstwa: 14,
    idPole: 'OBJECTID',
    limit: 1000,
    bbox,
  })
  const pig13 = await identifyWarstwa({
    nazwa: 'pig-warstwa13',
    baza: PIG,
    warstwa: 13,
    idPole: 'OBJECTID',
    limit: 1000,
    bbox,
  })
  const pig12 = await identifyWarstwa({
    nazwa: 'pig-warstwa12',
    baza: PIG,
    warstwa: 12,
    idPole: 'OBJECTID',
    limit: 1000,
    bbox,
  })
  const stanPrac = await pobierzStanPrac(bbox)
  if (msip8.obiekty.length < 300 || msip9.obiekty.length < 50 || pig14.obiekty.length < 3000)
    throw new Error(
      'Podejrzanie mało obiektów w źródłach SOPO – usuń etl/.cache/osuwiska i spróbuj ponownie',
    )

  const osuw = zlozOsuwiska(
    { msip8: msip8.obiekty, pig14: pig14.obiekty, pig13: pig13.obiekty },
    rzutujNaMetry,
  )
  const zagr = zlozZagrozone({ msip9: msip9.obiekty, pig12: pig12.obiekty }, rzutujNaMetry)
  const pokrycie = stanPrac.obiekty.map(
    (o) => new Wielokat(naMetry(o.pierscienie, rzutujNaMetry), o.atrybuty),
  )
  console.log(
    `Osuwiska: ${osuw.wielokaty.length} wielokątów (MSIP ${osuw.stat.msip} stref w ${osuw.stat.osuwiskMsip} osuwiskach; PIG ${osuw.stat.osuwiskPig} osuwisk: ${osuw.stat.pigStrefy} stref + ${osuw.stat.pigCale} całych). Tereny zagrożone: ${zagr.wielokaty.length} (MSIP ${zagr.stat.msip}, PIG ${zagr.stat.pig}). Zasięgi opracowania: ${pokrycie.length}.`,
  )
  const kontekst = {
    osuwiska: new IndeksWielokatow(osuw.wielokaty),
    zagrozone: new IndeksWielokatow(zagr.wielokaty),
  }

  const wyniki = []
  const zasiegiUzyte = new Set()
  for (const a of adresy) {
    const [x, y] = rzutujNaMetry(a.lon, a.lat)
    const zasiegi = pokrycie.filter((z) => z.zawiera(x, y))
    for (const z of zasiegi) zasiegiUzyte.add(z)
    wyniki.push(klasyfikuj(x, y, kontekst, zasiegi.length > 0))
  }
  const zasiegi = [...zasiegiUzyte].map((z) => z.atrybuty)
  if (!zasiegi.length) throw new Error('Żaden adres nie leży w zasięgu opracowania SOPO')

  const pobranoMsip = msip8.pobrano
  const pobranoPig = [pig14, pig13, pig12, stanPrac]
    .map((p) => p.pobrano)
    .sort()
    .at(-1)
  const meta = zrodla({ pobranoMsip, pobranoPig, zasiegi })

  // Gminy bez opracowania SOPO wynikają z danych (dziś Koniusza), nie z wpisanej listy.
  const zDanymi = new Map()
  adresy.forEach((a, i) => zDanymi.set(a.gmina, (zDanymi.get(a.gmina) ?? 0) + (wyniki[i] ? 1 : 0)))
  const bezOpracowania = [...zDanymi]
    .filter(([, n]) => n === 0)
    .map(([gmina]) => gmina)
    .sort((a, b) => a.localeCompare(b, 'pl'))
  const poza = bezOpracowania.length
    ? `poza obszarem opracowania SOPO (${bezOpracowania.length === 1 ? 'gmina' : 'gminy'} ${bezOpracowania.join(', ')})`
    : 'poza obszarem opracowania SOPO'

  zapiszWskaznik(
    {
      id: 'osuwisko_odleglosc',
      kategoria: 'bezpieczenstwo',
      nazwa: 'Odległość od osuwiska',
      opis: `Odległość w linii prostej od punktu adresu do granicy najbliższego osuwiska z bazy SOPO (PIG-PIB); 0 = adres leży na osuwisku. Liczą się osuwiska każdej aktywności, a etykieta (do ${ETYKIETA_DO_M} m) podaje stan najbliższego i jego numer SOPO. ${OGRANICZENIA} Brak danych: ${poza}.`,
      jednostka: 'm',
      kierunek: 'wiecej-lepiej',
      rozdzielczosc: 'adres',
      zakres: [0, 500],
      zadanie: 117,
      zrodla: meta,
    },
    wyniki.map((w) => (w ? zaokraglOdleglosc(w.odleglosc) : null)),
    wyniki.map((w) => w?.etykietaOdleglosc ?? null),
  )
  zapiszWskaznik(
    {
      id: 'teren_osuwiskowy',
      kategoria: 'bezpieczenstwo',
      nazwa: 'Teren osuwiskowy lub zagrożony ruchami masowymi',
      opis: `1 = punkt adresu leży w granicach osuwiska albo terenu zagrożonego ruchami masowymi z bazy SOPO, 0 = poza nimi w obszarze opracowania, null = ${poza}. Etykieta podaje rodzaj, aktywność i numer SOPO osuwiska. ${OGRANICZENIA}`,
      jednostka: '0/1',
      kierunek: 'mniej-lepiej',
      rozdzielczosc: 'adres',
      zakres: [0, 1],
      zadanie: 117,
      zrodla: meta,
    },
    wyniki.map((w) => (w ? w.teren : null)),
    wyniki.map((w) => w?.etykietaTeren ?? null),
  )

  // Podsumowanie po gminach.
  const poGminie = new Map()
  adresy.forEach((a, i) => {
    const e = poGminie.get(a.gmina) ?? {
      n: 0,
      pokryte: 0,
      naOsuwisku: 0,
      wTerenie: 0,
      do100: 0,
      do500: 0,
    }
    e.n++
    const w = wyniki[i]
    if (w) {
      e.pokryte++
      if (w.odleglosc === 0) e.naOsuwisku++
      if (w.teren) e.wTerenie++
      if (w.odleglosc <= 100) e.do100++
      if (w.odleglosc <= 500) e.do500++
    }
    poGminie.set(a.gmina, e)
  })
  console.log('gmina | adresów | z danymi | na osuwisku | teren (osuw.+zagr.) | ≤100 m | ≤500 m')
  for (const [g, e] of [...poGminie].sort())
    console.log(
      `${g} | ${e.n} | ${e.pokryte} | ${e.naOsuwisku} | ${e.wTerenie} | ${e.do100} | ${e.do500}`,
    )
  console.log(`Czas: ${((performance.now() - t0) / 1000).toFixed(1)} s`)

  if (process.env.SPRAWDZ === '1') await kontrolaZUslugami({ adresy, wyniki })
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1])
  main().catch((blad) => {
    console.error(blad)
    process.exitCode = 1
  })
