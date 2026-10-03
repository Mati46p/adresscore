// Uzbrojenie terenu (#72): czy w promieniu 50 m od adresu przebiega sieć gazowa, wodociągowa,
// elektroenergetyczna i kanalizacyjna – flaga 1 (tak) / 0 (nie) / null (brak danych).
//
// Źródło: GUGiK, Krajowa Integracja Uzbrojenia Terenu (KIUT) – usługa zbiorcza WMS, która kaskaduje
// usługi GESUT powiatów (Kraków i powiat krakowski są włączone, warstwa „gesut"). Licencja w
// GetCapabilities: Fees „Brak opłat", AccessConstraints „NONE". Jedno pobranie kafli do
// etl/.cache/uzbrojenie/, wynik jako pliki statyczne – front nie pyta usługi.
//
// Jak:
//   1. Siatka kafli 2 km × 2 km w EPSG:2180, tylko tam, gdzie są adresy z zakresu.
//      Każdy kafel GetMap ma 50 m zapasu z każdej strony (2,1 km → 1050 px, 2 m/px), więc
//      promień 50 m wokół adresu zawsze mieści się w jednym obrazku.
//      Skala: warstwy przewodów rysują się do ok. 2,9 m/px (przy 4 m/px obraz jest pusty),
//      dlatego 2 m/px – kompromis między liczbą zapytań a dokładnością (±2 m przy progu 50 m).
//   2. PNG z paletą: piksel „sieci" to indeks palety o kryciu (tRNS) ≥ 64 – odrzuca to
//      półprzezroczyste wygładzanie krawędzi. Etykiety przewodów (średnice) też są pikselami,
//      ale stoją tuż przy przewodzie, więc nie zmieniają odpowiedzi „czy jest w 50 m".
//   3. Adres = 1, gdy w kole 50 m (25 px) jest piksel danej sieci, inaczej 0.
//      Adres, w którego promieniu 250 m nie ma ŻADNEJ z czterech sieci, uznajemy za brak danych
//      → null dla wszystkich flag, nie 0. Powód: KIUT prawie nie pokazuje sieci w Krakowie
//      (miasto publikuje GESUT we własnym MSIP), więc kafle na granicy miasta mają pustą część
//      krakowską – bez tej reguły adresy z obrzeży Krakowa dostałyby fałszywe 0. Zapas kafla
//      to 50 m, więc przy krawędzi kafla sprawdzamy mniejsze otoczenie. Adresy spoza zakresu
//      i z kafli niepobranych też dostają null.
//
// Zakres (jak w zadaniu): obwarzanek (wszystkie adresy poza gminą Kraków) i obrzeża Krakowa –
// adresy w Krakowie, od których najbliższy adres spoza Krakowa jest bliżej niż 1,5 km.
//
// Uwaga sieciowa: dla kafla leżącego w całości w jednym powiecie KIUT nie renderuje obrazu,
// tylko przekierowuje (302) wprost do WMS powiatu – dla powiatu krakowskiego to
// https://wms.powiat.krakow.pl:1518/iip/ows. Z sieci bez dostępu do portu 1518 te kafle się
// nie pobiorą i dostają null; kolejny bieg z innej sieci dopełni cache (pobrane kafle zostają).
//
// Czego brakuje: OSM power=line/substation (uzupełnienie dla napowietrznych linii WN, które
// nie zawsze są w GESUT) – nie dodane; MSIP UZG_wms Krakowa niedostępne z kontenera, KIUT
// pokrywa ten sam zasób miejski kaskadowo. GESUT pokazuje sieć w ulicy, a nie przyłącze
// budynku: 1 oznacza „sieć w zasięgu przyłącza", nie „budynek podłączony".
//
// Uruchom: node etl/uzbrojenie.mjs   (pierwszy bieg: kilkaset zapytań, 2 równolegle z przerwą;
// potem z cache w sekundy). LIMIT_KAFLI=n – tylko n pierwszych kafli (próba);
// TYLKO_CACHE=1 – bez sieci, brakujące kafle → null (przeliczenie po zmianie reguł).
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { unzlibSync } from 'fflate'
import { do2180, IndeksPunktow } from './lib/geo.mjs'
import { CACHE, dzis, wczytajAdresy, zapiszWskaznik } from './lib/wspolne.mjs'

export const KIUT = 'https://integracja.gugik.gov.pl/cgi-bin/KrajowaIntegracjaUzbrojeniaTerenu'
export const KAFEL_M = 2000
export const ZAPAS_M = 50
export const PIKSEL_M = 2
export const PROMIEN_M = 50
/** Promień, w którym musi być jakakolwiek sieć, by uznać, że powiat ma tu dane (patrz flagiKafla). */
export const ZASIEG_DANYCH_M = 250
export const MIN_KRYCIE = 64
const OBRZEZA_M = 1500
const KAT = join(CACHE, 'uzbrojenie')

export const SIECI = [
  {
    klucz: 'gaz',
    warstwa: 'przewod_gazowy',
    id: 'uzbrojenie_gaz_50m',
    nazwa: 'Sieć gazowa w 50 m',
    tytul: 'Sieć gazowa',
  },
  {
    klucz: 'woda',
    warstwa: 'przewod_wodociagowy',
    id: 'uzbrojenie_woda_50m',
    nazwa: 'Wodociąg w 50 m',
    tytul: 'Sieć wodociągowa',
  },
  {
    klucz: 'prad',
    warstwa: 'przewod_elektroenergetyczny',
    id: 'uzbrojenie_prad_50m',
    nazwa: 'Sieć elektroenergetyczna w 50 m',
    tytul: 'Sieć elektroenergetyczna',
  },
  {
    klucz: 'kanalizacja',
    warstwa: 'przewod_kanalizacyjny',
    id: 'uzbrojenie_kanalizacja_50m',
    nazwa: 'Kanalizacja w 50 m',
    tytul: 'Sieć kanalizacyjna',
  },
]

// ---------- PNG z paletą (głębia 1/2/4/8, bez przeplotu) → maska krycia ----------

/** Dekoduje PNG z paletą → { szer, wys, maska } (maska[i] = 1, gdy krycie piksela ≥ minKrycie). */
export function maskaPng(bufor, minKrycie = MIN_KRYCIE) {
  const b = Buffer.from(bufor)
  if (b.length < 8 || b.readUInt32BE(0) !== 0x89504e47)
    throw new Error(`To nie PNG: ${b.subarray(0, 120).toString('latin1')}`)
  let poz = 8
  let n = null
  let paleta = 0
  let trns = null
  const idat = []
  while (poz + 12 <= b.length) {
    const dl = b.readUInt32BE(poz)
    const typ = b.toString('latin1', poz + 4, poz + 8)
    const d = b.subarray(poz + 8, poz + 8 + dl)
    if (typ === 'IHDR')
      n = { szer: d.readUInt32BE(0), wys: d.readUInt32BE(4), glebia: d[8], typ: d[9], pl: d[12] }
    else if (typ === 'PLTE') paleta = dl / 3
    else if (typ === 'tRNS') trns = d
    else if (typ === 'IDAT') idat.push(d)
    else if (typ === 'IEND') break
    poz += 12 + dl
  }
  if (!n) throw new Error('PNG bez IHDR')
  const { szer, wys, glebia, typ, pl } = n
  if (typ !== 3 || pl !== 0 || ![1, 2, 4, 8].includes(glebia))
    throw new Error(`Nieobsługiwany PNG: typ ${typ}, głębia ${glebia}, przeplot ${pl}`)
  // Krycie każdego wpisu palety; wpis bez tRNS jest w pełni kryjący (specyfikacja PNG).
  const krycie = new Uint8Array(Math.max(paleta, 1)).fill(255)
  if (trns) for (let i = 0; i < trns.length && i < krycie.length; i++) krycie[i] = trns[i]
  const linia = Math.ceil((szer * glebia) / 8)
  const surowe = unzlibSync(Buffer.concat(idat))
  if (surowe.length !== (linia + 1) * wys) throw new Error('PNG: nieoczekiwana długość danych')
  const maska = new Uint8Array(szer * wys)
  let poprz = new Uint8Array(linia)
  const maskaBit = (1 << glebia) - 1
  for (let y = 0; y < wys; y++) {
    const f = surowe[y * (linia + 1)]
    const lin = surowe.slice(y * (linia + 1) + 1, (y + 1) * (linia + 1))
    for (let x = 0; x < linia; x++) {
      const a = x > 0 ? lin[x - 1] : 0
      const g = poprz[x]
      const c = x > 0 ? poprz[x - 1] : 0
      let p = 0
      if (f === 1) p = a
      else if (f === 2) p = g
      else if (f === 3) p = (a + g) >> 1
      else if (f === 4) {
        const pa = Math.abs(g - c)
        const pb = Math.abs(a - c)
        const pc = Math.abs(a + g - 2 * c)
        p = pa <= pb && pa <= pc ? a : pb <= pc ? g : c
      } else if (f !== 0) throw new Error(`PNG: nieznany filtr ${f}`)
      lin[x] = (lin[x] + p) & 255
    }
    for (let x = 0; x < szer; x++) {
      const bit = x * glebia
      const idx = (lin[bit >> 3] >> (8 - glebia - (bit & 7))) & maskaBit
      maska[y * szer + x] = (krycie[idx] ?? 255) >= minKrycie ? 1 : 0
    }
    poprz = lin
  }
  return { szer, wys, maska }
}

/** Czy w kole o promieniu r px wokół (px, py) jest piksel maski. */
export function jestWPromieniu({ szer, wys, maska }, px, py, r) {
  const r2 = r * r
  for (let dy = -r; dy <= r; dy++) {
    const y = py + dy
    if (y < 0 || y >= wys) continue
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r2) continue
      const x = px + dx
      if (x >= 0 && x < szer && maska[y * szer + x]) return true
    }
  }
  return false
}

export const pustaMaska = (m) => !m.maska.some((v) => v)

// ---------- Kafle ----------

/** Zasięg kafla z zapasem w EPSG:2180: [xmin, ymin, xmax, ymax] (x = wschód, y = północ). */
export function zasiegKafla(tx, ty) {
  return [
    tx * KAFEL_M - ZAPAS_M,
    ty * KAFEL_M - ZAPAS_M,
    (tx + 1) * KAFEL_M + ZAPAS_M,
    (ty + 1) * KAFEL_M + ZAPAS_M,
  ]
}

export const BOK_PX = (KAFEL_M + 2 * ZAPAS_M) / PIKSEL_M

/** URL GetMap – WMS 1.3.0 z EPSG:2180 ma oś północ-wschód, więc BBOX = ymin,xmin,ymax,xmax. */
export function urlGetMap(warstwa, tx, ty) {
  const [xmin, ymin, xmax, ymax] = zasiegKafla(tx, ty)
  const p = new URLSearchParams({
    SERVICE: 'WMS',
    VERSION: '1.3.0',
    REQUEST: 'GetMap',
    LAYERS: warstwa,
    STYLES: '',
    CRS: 'EPSG:2180',
    BBOX: [ymin, xmin, ymax, xmax].join(','),
    WIDTH: String(BOK_PX),
    HEIGHT: String(BOK_PX),
    FORMAT: 'image/png',
    TRANSPARENT: 'TRUE',
  })
  return `${KIUT}?${p}`
}

/** Punkt (x, y) EPSG:2180 → piksel kafla (wiersz 0 = północ). */
export function pikselWKaflu(x, y, tx, ty) {
  const [xmin, , , ymax] = zasiegKafla(tx, ty)
  return [Math.floor((x - xmin) / PIKSEL_M), Math.floor((ymax - y) / PIKSEL_M)]
}

const czekaj = (ms) => new Promise((ok) => setTimeout(ok, ms))

async function pobierzPng(url, plik, prob = 3) {
  if (existsSync(plik)) return readFileSync(plik)
  if (process.env.TYLKO_CACHE) return null
  for (let proba = 1; ; proba++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(120_000) })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const buf = Buffer.from(await r.arrayBuffer())
      maskaPng(buf) // nie zapisujemy do cache odpowiedzi, która nie jest poprawnym PNG
      writeFileSync(plik, buf)
      await czekaj(250)
      return buf
    } catch (e) {
      // Kaskada powiatu bywa niedostępna (HTTP 503): po kilku próbach zwracamy null,
      // nie przerywamy biegu i nie zapisujemy do cache – kolejny bieg spróbuje znowu.
      if (proba >= prob) {
        console.warn(`  pominięty kafel: ${url} → ${e.message}`)
        return null
      }
      await czekaj(2000 * proba)
    }
  }
}

/**
 * Maska warstwy dla kafla albo null. KIUT dla kafla w całości w jednym powiecie odpowiada
 * przekierowaniem HTTP 302 wprost do usługi powiatu (dla powiatu krakowskiego:
 * wms.powiat.krakow.pl:1518); gdy ten host jest nieosiągalny, kafel zostaje bez danych.
 */
async function maskaKafla(s, k, tx, ty) {
  const buf = await pobierzPng(urlGetMap(s.warstwa, tx, ty), join(KAT, `${s.klucz}_${k}.png`))
  return buf ? maskaPng(buf) : null
}

async function pula(zadania, n, f) {
  let i = 0
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (i < zadania.length) await f(zadania[i++])
    }),
  )
}

/** Indeksy adresów z zakresu: obwarzanek + Kraków bliżej niż 1,5 km od adresu spoza Krakowa. */
export function wybierzZakres(adresy, xy) {
  const spoza = []
  for (const a of adresy) if (a.gmina !== 'Kraków') spoza.push({ x: xy[a.i][0], y: xy[a.i][1] })
  const indeks = new IndeksPunktow(spoza)
  return adresy
    .filter(
      (a) => a.gmina !== 'Kraków' || indeks.najblizszy(xy[a.i][0], xy[a.i][1], OBRZEZA_M) !== null,
    )
    .map((a) => a.i)
}

/**
 * Flagi dla adresów jednego kafla. maski: { klucz → maska }. Zwraca { klucz → (0|1|null)[] }
 * w kolejności punktów. null (brak danych), gdy w promieniu ZASIEG_DANYCH_M od adresu nie ma
 * żadnego piksela żadnej z sieci – w zabudowie to znak, że powiat nie publikuje tam danych
 * (np. Kraków w KIUT jest prawie pusty), a nie że nie ma rur. Kafel bez pikseli – null wszędzie.
 */
export function flagiKafla(maski, punkty, tx, ty) {
  const lista = Object.values(maski)
  const bezDanych = lista.every(pustaMaska)
  const r = Math.round(PROMIEN_M / PIKSEL_M)
  const rDanych = Math.round(ZASIEG_DANYCH_M / PIKSEL_M)
  const piksele = punkty.map(([x, y]) => pikselWKaflu(x, y, tx, ty))
  const sa = piksele.map(
    ([px, py]) => !bezDanych && lista.some((m) => jestWPromieniu(m, px, py, rDanych)),
  )
  const wynik = {}
  for (const [klucz, m] of Object.entries(maski))
    wynik[klucz] = piksele.map(([px, py], j) => {
      if (!sa[j]) return null
      return jestWPromieniu(m, px, py, r) ? 1 : 0
    })
  return wynik
}

async function main() {
  mkdirSync(KAT, { recursive: true })
  const { adresy } = wczytajAdresy()
  const xy = adresy.map((a) => do2180(a.lon, a.lat))
  const zakres = wybierzZakres(adresy, xy)
  const kafle = new Map()
  for (const i of zakres) {
    const k = `${Math.floor(xy[i][0] / KAFEL_M)}_${Math.floor(xy[i][1] / KAFEL_M)}`
    if (!kafle.has(k)) kafle.set(k, [])
    kafle.get(k).push(i)
  }
  let lista = [...kafle.entries()]
  const limit = Number(process.env.LIMIT_KAFLI)
  if (limit > 0) lista = lista.slice(0, limit)
  console.log(`Zakres: ${zakres.length} adresów, ${lista.length} kafli × ${SIECI.length} warstwy`)

  const wartosci = Object.fromEntries(
    SIECI.map((s) => [s.klucz, new Array(adresy.length).fill(null)]),
  )
  let gotowe = 0
  let pusteKafle = 0
  let nieudane = 0
  await pula(lista, 2, async ([k, idx]) => {
    const [tx, ty] = k.split('_').map(Number)
    const maski = {}
    for (const s of SIECI) {
      const m = await maskaKafla(s, k, tx, ty)
      if (!m) {
        nieudane++
        return // brak choć jednej warstwy → cały kafel null (pustego kafla nie odróżnimy od braku)
      }
      maski[s.klucz] = m
    }
    const f = flagiKafla(
      maski,
      idx.map((i) => xy[i]),
      tx,
      ty,
    )
    if (f[SIECI[0].klucz][0] === null) pusteKafle++
    for (const s of SIECI) idx.forEach((i, j) => (wartosci[s.klucz][i] = f[s.klucz][j]))
    if (++gotowe % 25 === 0) console.log(`  kafle: ${gotowe}/${lista.length}`)
  })
  console.log(`Kafle bez żadnej sieci (null): ${pusteKafle}, niepobrane (null): ${nieudane}`)

  // Data pobrania = data najstarszego kafla w cache (pobranie jednorazowe, potem z cache).
  let najstarszy = Infinity
  for (const [k] of lista)
    for (const s of SIECI) {
      const p = join(KAT, `${s.klucz}_${k}.png`)
      if (existsSync(p)) najstarszy = Math.min(najstarszy, statSync(p).mtimeMs)
    }
  const pobrano = Number.isFinite(najstarszy)
    ? new Date(najstarszy).toISOString().slice(0, 10)
    : dzis()

  for (const s of SIECI)
    zapiszWskaznik(
      {
        id: s.id,
        kategoria: 'codziennosc',
        nazwa: s.nazwa,
        opis:
          `${s.tytul} w promieniu ${PROMIEN_M} m od punktu adresu według GESUT powiatów ` +
          '(Krajowa Integracja Uzbrojenia Terenu, GUGiK): 1 – jest, 0 – brak w ewidencji. ' +
          'Sieć w zasięgu nie znaczy, że budynek jest podłączony. Liczone tylko dla obwarzanka ' +
          'i obrzeży Krakowa (do 1,5 km od granicy); gdzie usługa nie zwróciła żadnej sieci ' +
          'w kaflu 2 × 2 km – brak danych.',
        jednostka: 'tak/nie',
        kierunek: 'wiecej-lepiej',
        rozdzielczosc: 'adres',
        zakres: [0, 1],
        zadanie: 72,
        zrodla: [
          {
            nazwa: `GUGiK – Krajowa Integracja Uzbrojenia Terenu (WMS, warstwa ${s.warstwa}, dane GESUT powiatów)`,
            url: KIUT,
            licencja:
              'Usługa publiczna GUGiK: brak opłat, brak ograniczeń dostępu (GetCapabilities)',
            dataDanych: pobrano,
            pobrano,
          },
        ],
      },
      wartosci[s.klucz],
    )
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main()
