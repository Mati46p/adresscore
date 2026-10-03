// Warstwa: zagrożenie powodziowe (zadanie #23).
//
// Źródło: mapy zagrożenia powodziowego (MZP), II cykl planistyczny (aktualizacja 2019–2022),
// PGW Wody Polskie / KZGW, publikowane w Hydroportalu ISOK jako publiczne usługi WMS:
//   https://wody.isok.gov.pl/gpservices/KZGW/MZP22_Glebokosc_{Wysokie|Srednie|Niskie}PrawdopodPowodzi/MapServer/WMSServer
// Licencja: informacja publiczna, bez opłat; usługa INSPIRE MZP/MRP tego samego zbioru deklaruje
// „Brak warunków dostępu i użytkowania". Podajemy źródło i datę pobrania.
//
// Co liczy, dla każdego adresu i każdego scenariusza (10% = Q10, 1% = Q100, 0,2% = Q500):
//   - głębokość wody w m – środek klasy z MZP (≤0,5 → 0,25; 0,5–2 → 1,25; 2–4 → 3; >4 → 4,5),
//   - 0, gdy adres leży na arkuszu MZP opracowanym dla scenariusza, ale poza obszarem zalewu,
//   - null, gdy arkusza nie ma albo scenariusz na nim „nie dotyczy" (brak opracowania).
//
// Jak: usługa nie wystawia WFS z głębokościami (REST ArcGIS wymaga tokenu, a INSPIRE WFS ma
// tylko zasięgi bez głębokości). Dlatego:
//   1. Kafle GetMap warstwy głębokości (4 m/px, EPSG:2180) – tylko tam, gdzie są adresy.
//      Adres, przy którym w promieniu 8 m nie ma żadnego piksela warstwy, jest poza zalewem.
//      Gdy otoczenie 3 × 3 px ma jeden czysty kolor klasy, klasa wynika z koloru.
//   2. Pozostałe adresy (krawędzie, nakładające się modele rzek): GetFeatureInfo w punkcie
//      adresu – klasa z atrybutu GLEBOKOSC wielokąta MZP (wektor po stronie serwera).
//   3. Zasięg opracowania: skorowidz arkuszy 1:10 000 (pola akt_mzp_10 / _1 / _02).
// Wszystkie odpowiedzi trafiają do etl/.cache/powodz/, więc drugi bieg nie pyta serwera.
//
// Uruchom: node etl/powodz.mjs   (pierwszy bieg kilka minut – zapytania do WMS; potem sekundy)
// Kontrola: SPRAWDZ=1 node etl/powodz.mjs – pyta GetFeatureInfo także tam, gdzie klasa wynika
// z koloru kafla, i wypisuje liczbę rozbieżności (dla atrapy adresów: 0).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { unzlibSync } from 'fflate'
import proj4 from 'proj4'
import { CACHE, dzis, wczytajAdresy, zapiszWskaznik } from './lib/wspolne.mjs'

const KAT = join(CACHE, 'powodz')
mkdirSync(KAT, { recursive: true })
const BAZA = 'https://wody.isok.gov.pl/gpservices/KZGW'
const SCENARIUSZE = [
  {
    id: 'powodz_10proc',
    q: 'Q10',
    proc: '10%',
    lat: 'raz na 10 lat',
    usluga: 'MZP22_Glebokosc_WysokiePrawdopodPowodzi',
    warstwa: '0',
    pole: 'akt_mzp_10',
  },
  {
    id: 'powodz_1proc',
    q: 'Q100',
    proc: '1%',
    lat: 'raz na 100 lat',
    usluga: 'MZP22_Glebokosc_SredniePrawdopodPowodzi',
    warstwa: '16',
    pole: 'akt_mzp_1',
  },
  {
    id: 'powodz_02proc',
    q: 'Q500',
    proc: '0,2%',
    lat: 'raz na 500 lat',
    usluga: 'MZP22_Glebokosc_NiskiePrawdopodPowodzi',
    warstwa: '16',
    pole: 'akt_mzp_02',
  },
]
// Skorowidz arkuszy jest wspólny dla scenariuszy – bierzemy go z usługi Q100.
const SKOROWIDZ = { usluga: 'MZP22_Glebokosc_SredniePrawdopodPowodzi', warstwa: '25' }

// Klasy głębokości z legendy MZP → wartość (środek klasy; dla >4 m przyjmujemy 4,5) i opis.
// Usługi zapisują klasy niejednolicie („h ≤ 0,5 m", „h <= 0,5 m", „0,5 < h < 2,0 m", a nawet
// „2,0 < h  4,0 m" z zgubionym znakiem), więc klasę poznajemy po dolnej granicy.
const KLASY = {
  0: [0.25, 'do 0,5 m'],
  0.5: [1.25, '0,5–2 m'],
  2: [3, '2–4 m'],
  4: [4.5, 'ponad 4 m'],
}
function klasa(t) {
  const liczby = (t.match(/\d+(?:,\d+)?/g) ?? []).map((x) => Number(x.replace(',', '.')))
  const dolna = liczby.length === 2 ? liczby[0] : /h\s*[>≥]/.test(t) ? liczby[0] : 0
  const k = KLASY[dolna]
  if (!k || liczby.length < 1 || liczby.length > 2) throw new Error(`Nieznana klasa: ${t}`)
  return k
}

proj4.defs(
  'EPSG:2180',
  '+proj=tmerc +lat_0=0 +lon_0=19 +k=0.9993 +x_0=500000 +y_0=-5300000 +ellps=GRS80 +units=m +no_defs',
)
const doPUWG = proj4('EPSG:4326', 'EPSG:2180')

// ---------- HTTP z ponowieniami i pulą równoległą ----------
async function pobierz(url, typ = 'text') {
  for (let proba = 1; ; proba++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(90_000) })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return typ === 'bufor' ? Buffer.from(await r.arrayBuffer()) : await r.text()
    } catch (e) {
      if (proba >= 4) throw new Error(`${url} → ${e.message}`)
      await new Promise((ok) => setTimeout(ok, 1000 * proba))
    }
  }
}

async function pula(zadania, n, f) {
  let i = 0
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (i < zadania.length) await f(zadania[i++])
    }),
  )
}

// ---------- PNG (RGBA 8 bit, bez przeplotu) → piksele jako liczby 0xRRGGBBAA ----------
function pikselePNG(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error(`To nie PNG: ${buf.subarray(0, 120)}`)
  let p = 8
  let w = 0
  let h = 0
  const idat = []
  while (p < buf.length) {
    const n = buf.readUInt32BE(p)
    const typ = buf.toString('ascii', p + 4, p + 8)
    const d = buf.subarray(p + 8, p + 8 + n)
    if (typ === 'IHDR') {
      w = d.readUInt32BE(0)
      h = d.readUInt32BE(4)
      if (d[8] !== 8 || d[9] !== 6 || d[12] !== 0) throw new Error('PNG: oczekuję RGBA 8 bit')
    } else if (typ === 'IDAT') idat.push(d)
    p += 12 + n
  }
  const raw = unzlibSync(Buffer.concat(idat))
  const bpp = 4
  const st = w * bpp
  const piks = new Uint32Array(w * h)
  let prev = new Uint8Array(st)
  for (let y = 0; y < h; y++) {
    const f = raw[y * (st + 1)]
    const lin = raw.slice(y * (st + 1) + 1, (y + 1) * (st + 1))
    for (let x = 0; x < st; x++) {
      const a = x >= bpp ? lin[x - bpp] : 0
      const b = prev[x]
      const c = x >= bpp ? prev[x - bpp] : 0
      let pr = 0
      if (f === 1) pr = a
      else if (f === 2) pr = b
      else if (f === 3) pr = (a + b) >> 1
      else if (f === 4) {
        const pa = Math.abs(b - c)
        const pb = Math.abs(a - c)
        const pc = Math.abs(a + b - 2 * c)
        pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      }
      lin[x] = (lin[x] + pr) & 255
    }
    for (let x = 0; x < w; x++)
      piks[y * w + x] =
        ((lin[x * 4] << 24) | (lin[x * 4 + 1] << 16) | (lin[x * 4 + 2] << 8) | lin[x * 4 + 3]) >>> 0
    prev = lin
  }
  return { w, h, piks }
}

// ---------- Maska z kafli GetMap ----------
const KAFEL_PX = 2000
const PIKSEL_M = 4 // 1:14 300 – warstwa głębokości rysuje się poniżej 1:47 248
const KAFEL_M = KAFEL_PX * PIKSEL_M
const PROMIEN_PX = 2 // 8 m zapasu na krawędzie i wygładzanie

async function kafel(s, tx, ty) {
  const plik = join(KAT, `kafel-${s.id}-${tx}-${ty}.png`)
  if (!existsSync(plik)) {
    const [x0, y0] = [tx * KAFEL_M, ty * KAFEL_M]
    const url =
      `${BAZA}/${s.usluga}/MapServer/WMSServer?service=WMS&version=1.1.1&request=GetMap` +
      `&layers=${s.warstwa}&styles=&srs=EPSG:2180&bbox=${x0},${y0},${x0 + KAFEL_M},${y0 + KAFEL_M}` +
      `&width=${KAFEL_PX}&height=${KAFEL_PX}&format=image/png32&transparent=true`
    const buf = await pobierz(url, 'bufor')
    pikselePNG(buf) // walidacja: błąd serwera (XML) nie trafi do cache
    writeFileSync(plik, buf)
  }
  return pikselePNG(readFileSync(plik))
}

// Kolory wnętrza wielokątów MZP na kaflu (styl usługi, krycie 50%) → dolna granica klasy.
// Sprawdzone z GetFeatureInfo (SPRAWDZ=1): zgodność 100% dla jednolitego otoczenia 3 × 3 px.
const KOLORY = new Map([
  [0x9fd1f580, 0], // h ≤ 0,5 m
  [0x5095ef80, 0.5], // 0,5–2 m
  [0x005ac780, 2], // 2–4 m
  [0x00327480, 4], // > 4 m
])

/**
 * Stan piksela adresu: 'poza' – w promieniu 8 m brak warstwy; liczba – dolna granica klasy,
 * gdy otoczenie 3 × 3 px ma jeden czysty kolor klasy; 'pytaj' – krawędź, nakładanie się
 * wielokątów albo wygładzanie, więc klasę rozstrzyga GetFeatureInfo.
 */
function stanPiksela({ w, piks }, px, py) {
  const kol = (x, y) => (x >= 0 && y >= 0 && x < w && y < w ? piks[y * w + x] : 0)
  let cos = false
  for (let dy = -PROMIEN_PX; dy <= PROMIEN_PX && !cos; dy++)
    for (let dx = -PROMIEN_PX; dx <= PROMIEN_PX; dx++)
      if (kol(px + dx, py + dy) & 0xff) {
        cos = true
        break
      }
  if (!cos) return 'poza'
  const srodek = kol(px, py)
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) if (kol(px + dx, py + dy) !== srodek) return 'pytaj'
  if ((srodek & 0xff) === 0) return 'poza'
  return KOLORY.has(srodek) ? KOLORY.get(srodek) : 'pytaj'
}

// ---------- GetFeatureInfo w punkcie ----------
function urlGFI(usluga, warstwa, lon, lat) {
  const d = 0.00001
  return (
    `${BAZA}/${usluga}/MapServer/WMSServer?service=WMS&version=1.1.1&request=GetFeatureInfo` +
    `&layers=${warstwa}&query_layers=${warstwa}&styles=&srs=EPSG:4326` +
    `&bbox=${lon - d},${lat - d},${lon + d},${lat + d}&width=3&height=3&x=1&y=1` +
    '&info_format=application/geojson&feature_count=10'
  )
}

async function cechy(usluga, warstwa, lon, lat) {
  const t = await pobierz(urlGFI(usluga, warstwa, lon, lat))
  return JSON.parse(t).features.map((f) => f.properties)
}

function wczytajJSON(plik) {
  return existsSync(plik) ? JSON.parse(readFileSync(plik, 'utf8')) : {}
}

// ---------- Arkusze 1:10 000 (układ 1992, podział międzynarodowy) ----------
// Np. M-34-64-D-d-2: strefa M-34 (4° × 6°), 144 arkusze 1:100 000, ćwiartki 50k, 25k, 10k.
function arkusz(lon, lat) {
  const litera = String.fromCharCode(65 + Math.floor(lat / 4))
  const strefa = Math.floor(lon / 6) + 31
  const lat0 = Math.floor(lat / 4) * 4
  const lon0 = (strefa - 31) * 6
  const wiersz = Math.floor((lat0 + 4 - lat) / (1 / 3))
  const kol = Math.floor((lon - lon0) / 0.5)
  let gora = lat0 + 4 - wiersz / 3
  let lewo = lon0 + kol * 0.5
  let dLat = 1 / 3
  let dLon = 0.5
  const czesci = [`${litera}-${strefa}-${wiersz * 12 + kol + 1}`]
  for (const znaki of ['ABCD', 'abcd', '1234']) {
    dLat /= 2
    dLon /= 2
    const r = lat < gora - dLat ? 1 : 0
    const k = lon >= lewo + dLon ? 1 : 0
    czesci.push(znaki[r * 2 + k])
    gora -= r * dLat
    lewo += k * dLon
  }
  return { godlo: czesci.join('-'), lon: lewo + dLon / 2, lat: gora - dLat / 2 }
}

// ---------- Przebieg ----------
const t0 = Date.now()
const { adresy } = wczytajAdresy()
console.log(`Adresów: ${adresy.length}`)

// 1. Skorowidz arkuszy: jedno zapytanie na arkusz, w jego środku.
const plikArk = join(KAT, 'arkusze.json')
const arkusze = wczytajJSON(plikArk)
const arkAdresu = adresy.map((a) => arkusz(a.lon, a.lat))
const brakArk = [...new Map(arkAdresu.map((a) => [a.godlo, a])).values()].filter(
  (a) => !(a.godlo in arkusze),
)
await pula(brakArk, 6, async (a) => {
  const c = await cechy(SKOROWIDZ.usluga, SKOROWIDZ.warstwa, a.lon, a.lat)
  const f = c[0] ?? null
  if (f && f.numer !== a.godlo) throw new Error(`Arkusz ${a.godlo}: serwer zwraca ${f.numer}`)
  arkusze[a.godlo] = f
})
writeFileSync(plikArk, JSON.stringify(arkusze, null, 1))
console.log(`Arkusze: ${Object.keys(arkusze).length} (nowych zapytań ${brakArk.length})`)

const opracowany = (s, i) => {
  const f = arkusze[arkAdresu[i].godlo]
  return Boolean(f?.[s.pole] && f[s.pole] !== 'ND')
}

// SPRAWDZ=1: pytaj GetFeatureInfo o każdy adres przy warstwie i porównaj z klasą z koloru.
const SPRAWDZ = process.env.SPRAWDZ === '1'
const xy = adresy.map((a) => doPUWG.forward([a.lon, a.lat]))
const wyniki = {}
for (const s of SCENARIUSZE) {
  // 2. Kafle tylko tam, gdzie są adresy na opracowanych arkuszach.
  const kafle = new Map()
  adresy.forEach((_, i) => {
    if (!opracowany(s, i)) return
    const k = `${Math.floor(xy[i][0] / KAFEL_M)},${Math.floor(xy[i][1] / KAFEL_M)}`
    if (!kafle.has(k)) kafle.set(k, [])
    kafle.get(k).push(i)
  })
  const stan = new Map() // i → 'poza' | dolna granica klasy | 'pytaj'
  await pula([...kafle.keys()], 4, async (k) => {
    const [tx, ty] = k.split(',').map(Number)
    const m = await kafel(s, tx, ty)
    for (const i of kafle.get(k)) {
      const px = Math.floor((xy[i][0] - tx * KAFEL_M) / PIKSEL_M)
      const py = KAFEL_PX - 1 - Math.floor((xy[i][1] - ty * KAFEL_M) / PIKSEL_M)
      stan.set(i, stanPiksela(m, px, py))
    }
  })

  // 3. Niejednoznaczne piksele: klasa z GetFeatureInfo w punkcie adresu.
  const plikGFI = join(KAT, `gfi-${s.id}.json`)
  const gfi = wczytajJSON(plikGFI)
  const klucz = (i) => `${adresy[i].lon},${adresy[i].lat}`
  const doSprawdzenia = (i) => stan.get(i) === 'pytaj' || (SPRAWDZ && stan.get(i) !== 'poza')
  const nowe = [...stan.keys()].filter((i) => doSprawdzenia(i) && !(klucz(i) in gfi))
  let zrobione = 0
  await pula(nowe, 8, async (i) => {
    const c = await cechy(s.usluga, s.warstwa, adresy[i].lon, adresy[i].lat)
    gfi[klucz(i)] = c.map((f) => (f.GLEBOKOSC ?? f.glebokosc).trim())
    if (++zrobione % 200 === 0) {
      writeFileSync(plikGFI, JSON.stringify(gfi))
      console.log(`  ${s.q}: ${zrobione}/${nowe.length} zapytań`)
    }
  })
  writeFileSync(plikGFI, JSON.stringify(gfi))

  // Kilka wielokątów w punkcie (styk modeli dwóch rzek) – bierzemy najgłębszą klasę.
  const zGFI = (i) => {
    let naj = null
    for (const t of gfi[klucz(i)]) {
      const k = klasa(t)
      if (!naj || k[0] > naj[0]) naj = k
    }
    return naj
  }
  const wartosci = []
  const etykiety = []
  let zKoloru = 0
  let rozbieznosci = 0
  adresy.forEach((_, i) => {
    if (!opracowany(s, i)) {
      wartosci.push(null)
      etykiety.push(null)
      return
    }
    const st = stan.get(i)
    let naj = null
    if (st === 'pytaj') naj = zGFI(i)
    else if (st !== 'poza') {
      naj = KLASY[st]
      zKoloru++
      if (SPRAWDZ && zGFI(i) !== naj) rozbieznosci++
    }
    wartosci.push(naj ? naj[0] : 0)
    // Etykieta tylko w strefie – „poza strefą” dla 70 tys. adresów rozdęłoby plik ponad 2 MB.
    etykiety.push(naj ? `strefa ${s.q}, głębokość ${naj[1]}` : null)
  })
  wyniki[s.id] = wartosci
  const pytaj = [...stan.values()].filter((v) => v === 'pytaj').length
  console.log(
    `${s.q}: kafli ${kafle.size}, klasa z koloru ${zKoloru}, z GetFeatureInfo ${pytaj} ` +
      `(nowych zapytań ${nowe.length})${SPRAWDZ ? `, rozbieżności kolor/GFI ${rozbieznosci}` : ''}`,
  )

  zapiszWskaznik(
    {
      id: s.id,
      kategoria: 'bezpieczenstwo',
      nazwa: `Zagrożenie powodzią (${s.proc})`,
      opis:
        `Głębokość wody w punkcie adresu przy powodzi o prawdopodobieństwie ${s.proc} ` +
        `(${s.lat}, ${s.q}) wg map zagrożenia powodziowego. Wartość to środek klasy MZP ` +
        '(do 0,5 m → 0,25; 0,5–2 m → 1,25; 2–4 m → 3; ponad 4 m → 4,5). 0 = poza obszarem ' +
        'zalewu; brak danych = rzeka nie była modelowana na tym arkuszu.',
      jednostka: 'm',
      kierunek: 'mniej-lepiej',
      rozdzielczosc: 'adres',
      zakres: [0, 4],
      zadanie: 23,
      zrodla: [
        {
          nazwa: `Mapy zagrożenia powodziowego – głębokość wody, scenariusz ${s.proc} (PGW Wody Polskie, Hydroportal ISOK)`,
          url: `${BAZA}/${s.usluga}/MapServer/WMSServer?service=WMS&request=GetCapabilities`,
          licencja: 'Informacja publiczna bez warunków dostępu i użytkowania (podać źródło)',
          dataDanych: '2019–2022',
          pobrano: dzis(),
        },
      ],
    },
    wartosci,
    etykiety,
  )
}

// Spójność: płytszy scenariusz nie może zalewać mocniej niż rzadszy (Q10 ≤ Q100 ≤ Q500).
let niespojne = 0
adresy.forEach((_, i) => {
  const [a, b, c] = SCENARIUSZE.map((s) => wyniki[s.id][i] ?? 0)
  if (a > b || b > c) niespojne++
})
console.log(`Adresy z Q10 > Q100 albo Q100 > Q500: ${niespojne}`)
console.log(`Czas: ${((Date.now() - t0) / 1000).toFixed(1)} s`)
