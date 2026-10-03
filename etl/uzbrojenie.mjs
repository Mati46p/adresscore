// Uzbrojenie terenu (#72): czy w promieniu 50 m od adresu przebiega sieć gazowa, wodociągowa,
// elektroenergetyczna i kanalizacyjna – flaga 1 (tak) / 0 (nie) / null (brak danych).
//
// Dwa źródła, bo żadne nie pokrywa całości. Podział idzie po gminie adresu i nigdy się nie miesza:
//   • Kraków – MSIP, usługa WMS „Geodezyjna Sieć Uzbrojenia Terenu” miasta (GESUT). KIUT dla Krakowa
//     zwraca pusty obraz, bo miasto publikuje GESUT wyłącznie w swoim MSIP.
//   • gminy wokół Krakowa – GUGiK, Krajowa Integracja Uzbrojenia Terenu (KIUT): usługa zbiorcza WMS,
//     która kaskaduje GESUT powiatów. Licencja w GetCapabilities: Fees „Brak opłat”,
//     AccessConstraints „NONE”.
//
// MSIP – licencja i sposób użycia. GESUT nie jest w MSIP klasyfikowany jako OPEN DATA, więc regulamin
// (https://msip.krakow.pl/getHtml?dok_id=228972, pkt 22) przewiduje dla niego wyłącznie
// przeglądanie, bez pobierania w postaci wektorowej. Dlatego pytamy tylko usługę przeglądania WMS
// (GetMap, pkt 10: powszechna i nieodpłatna) o OBRAZY – nigdy REST `query` ani WFS o wektory – i z
// obrazu wyciągamy jedną flagę na adres. Pobranie jest jednorazowe (cache w etl/.cache/), bez pętli
// odpytującej: pkt 8–9 zabraniają ciągłego, zorganizowanego pośredniczenia w usługach, więc front nie
// pyta usługi, tylko czyta pliki statyczne. Źródło jest podane w meta każdego wskaźnika (pkt 7).
//
// Jak:
//   1. Siatka kafli 2 km × 2 km w EPSG:2180, tylko tam, gdzie są adresy z zakresu źródła. Każdy
//      kafel GetMap ma 250 m zapasu z każdej strony (ZASIEG_DANYCH_M), więc koło sprawdzania
//      danych wokół adresu zawsze mieści się w jednym obrazku.
//      Skala: KIUT rysuje przewody do ok. 2,9 m/px (przy 4 m/px obraz jest pusty), więc 2 m/px –
//      kompromis między liczbą zapytań a dokładnością (±2 m przy progu 50 m). Warstwy GESUT w MSIP
//      mają MaxScaleDenominator 2362 (rysują się poniżej ok. 0,66 m/px; przy 0,7 m/px obraz jest
//      pusty – sprawdzone), więc 0,625 m/px: 2500 m / 0,625 = 4000 px, pod limitem usługi 4096 px.
//   2. PNG z paletą albo RGBA (KIUT zwraca raz jeden, raz drugi, zależnie od liczby kolorów
//      w obrazie – mniej więcej po połowie kafli): piksel „sieci” to piksel o kryciu (tRNS albo
//      kanał alfa) ≥ 16. Linie GESUT w KIUT mają krycie ok. 50% (alfa ≈ 130), a cienkie, ułożone
//      między pikselami, schodzą poniżej 64, więc dawny próg 64 gubił ich fragmenty (na 106 tys.
//      adresów obwarzanka zmieniał wynik 0 → 1 u 1% adresów dla wody i 0,8% dla kanalizacji).
//      Próg 16 odrzuca tylko ledwo widoczne smugi wygładzania i skalowania (poniżej 12% pokrycia),
//      leżące najwyżej 1–2 piksele od linii. W MSIP (PNG8) każdy wpis palety poza przezroczystym
//      jest kryjący, więc tam próg nie ma znaczenia. Etykiety przewodów (średnice) też są pikselami,
//      ale stoją tuż przy przewodzie, więc prawie nie zmieniają odpowiedzi „czy jest w 50 m”
//      (MSIP, porównanie z obrazem bez etykiet na 218 adresach: zero różnic).
//   3. Adres = 1, gdy w kole 50 m jest piksel danej sieci, inaczej 0.
//      Adres, w którego promieniu 250 m nie ma ŻADNEJ z czterech sieci, uznajemy za brak danych
//      → null dla wszystkich flag, nie 0. Powód: ewidencja bywa niepełna (powiat nie przekazał
//      danych, brak przyłączy na obrzeżach), więc „nic w 250 m” częściej znaczy „nie ma
//      ewidencji” niż „nie ma rur”. Adresy z kafli niepobranych też dostają null.
//
// Zakres: adresy w gminie Kraków liczy MSIP, wszystkie pozostałe (obwarzanek) – KIUT. Sieć leżąca
// tuż za granicą miasta nie jest widoczna w GESUT Krakowa, więc dla adresów przy granicy flaga
// może być niższa niż stan faktyczny (po stronie sąsiedniej gminy liczy się tylko jej ewidencja).
//
// Uwaga sieciowa: KIUT odpowiada przekierowaniem 302 na jeden z serwerów (integracja01/02), który
// kaskaduje usługi powiatów. Kaskada potrafi po cichu oddać PUSTY obraz (HTTP 200, PNG bez piksela
// sieci) zamiast błędu, gdy usługa powiatu chwilowo zawodzi. Sprawdzone ponownym pobraniem: z 28
// obrazów o mniej niż 500 pikselach sieci 15 miało za drugim razem od 0,5 do 60 tys. pikseli (w tym
// wszystkie 12 pustych PNG 1-bitowych), prawie wszystkie w okolicy Koniuszy i Kocmyrzowa. Taki obraz
// daje adresom fałszywe 0 (jeden kafel: 177 adresów bez prądu, który tam jest). Dlatego każdy obraz
// KIUT pobieramy dwa razy – drugi przebieg dopiero po całym pierwszym, żeby awarie nie nakładały
// się w czasie – i sumujemy maski: zły obraz ma zawsze mniej pikseli, nigdy więcej. Wynik jest
// pewny dopiero przy dwóch DOBRYCH przebiegach (co najmniej 90% pikseli najlepszego), więc obraz
// z przebiegiem, który zawiódł, dostaje kolejne (do pięciu); tak samo suma rzadsza niż
// PROG_RZADKIEJ_SIECI pikseli. MSIP tego nie wymaga: te same obrazy pobrane drugi raz są
// identyczne co do piksela (próba 8 obrazów, od najmniejszego po największy).
// Kafel, którego nie udało się pobrać po trzech próbach, dostaje null, a kolejny bieg dopełnia
// cache (pobrane obrazy zostają).
//
// GESUT pokazuje sieć w ulicy, a nie przyłącze budynku: 1 oznacza „sieć w zasięgu przyłącza”,
// nie „budynek podłączony”.
//
// Uruchom: node etl/uzbrojenie.mjs   (pierwszy bieg: ok. 1600 zapytań, 2 równolegle z przerwą,
// w Krakowie pojedynczy kafel liczy serwer MSIP do pół minuty; potem z cache w kilkadziesiąt sekund).
// LIMIT_KAFLI=n – tylko n pierwszych kafli każdego źródła (próba, wskaźników nie zapisuje);
// ZRODLO=kiut|msip – tylko jedno źródło (pobranie do cache i statystyki, wskaźników nie zapisuje);
// TYLKO_CACHE=1 – bez sieci, brakujące kafle → null (przeliczenie po zmianie reguł).
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { unzlibSync } from 'fflate'
import { do2180 } from './lib/geo.mjs'
import { ATRYBUCJA_MSIP, HOST_MSIP, LICENCJA_MSIP } from './lib/msip.mjs'
import { pobierzBajtyMsip } from './lib/msip-obraz.mjs'
import { CACHE, dzis, wczytajAdresy, zapiszWskaznik } from './lib/wspolne.mjs'

export const KIUT = 'https://integracja.gugik.gov.pl/cgi-bin/KrajowaIntegracjaUzbrojeniaTerenu'
export const MSIP_GESUT = `https://${HOST_MSIP}/arcgis/services/WMS/GESUT/MapServer/WMSServer`
export const MIASTO_MSIP = 'Kraków'
export const KAFEL_M = 2000
export const PROMIEN_M = 50
/** Promień, w którym musi być jakakolwiek sieć, by uznać, że źródło ma tu dane (patrz flagiKafla). */
export const ZASIEG_DANYCH_M = 250
/** Zapas kafla = zasięg sprawdzania danych, żeby przy krawędzi kafla nie obcinać koła. */
export const ZAPAS_M = ZASIEG_DANYCH_M
/** Najmniejsze krycie piksela (0–255) liczone jako „sieć” – uzasadnienie w nagłówku, pkt 2. */
export const MIN_KRYCIE = 16
/** Obraz, w którym „sieć” zajmuje więcej pikseli, nie jest mapą sieci (np. brak przezroczystego tła). */
export const MAX_UDZIAL_PIKSELI = 0.5
/** Tyle razy pobieramy każdy obraz KIUT (przebiegi idą kolejno po wszystkich obrazach); maski sumujemy. */
export const PRZEBIEGI_KIUT = 2
/** Ostatni numer przebiegu: dokładki dla obrazów, których wynik jest niepewny (patrz maskaKiut). */
export const MAKS_PRZEBIEGOW_KIUT = 5
/** Suma masek KIUT o mniejszej liczbie pikseli sieci dostaje jeszcze jeden, dodatkowy przebieg. */
export const PROG_RZADKIEJ_SIECI = 500

/**
 * Geometria kafli źródła: kafel `kafel` × `kafel` m w siatce EPSG:2180 od zera układu, obraz
 * z zapasem `zapas` m z każdej strony, piksel `piksel` m. Obraz musi mieć całkowitą liczbę pikseli.
 */
export const PROFIL_KIUT = { nazwa: 'kiut', kafel: KAFEL_M, zapas: ZAPAS_M, piksel: 2 }
export const PROFIL_MSIP = { nazwa: 'msip', kafel: KAFEL_M, zapas: ZAPAS_M, piksel: 0.625 }
export const PIKSEL_M = PROFIL_KIUT.piksel

/** Bok obrazu GetMap kafla w pikselach. */
export const bokPx = (profil) => Math.round((profil.kafel + 2 * profil.zapas) / profil.piksel)
export const BOK_PX = bokPx(PROFIL_KIUT)

// Cache osobno dla każdej geometrii kafli: obraz o innym zapasie czy pikselu to inne zapytanie,
// więc stary cache nie może być czytany po zmianie profilu.
const katalogCache = (profil) =>
  join(
    CACHE,
    'uzbrojenie',
    `${profil.nazwa}_${profil.kafel}_${profil.zapas}_${Math.round(profil.piksel * 1000)}`,
  )

export const SIECI = [
  {
    klucz: 'gaz',
    warstwa: 'przewod_gazowy',
    warstwaMsip: 'siec_gazowa',
    id: 'uzbrojenie_gaz_50m',
    nazwa: 'Sieć gazowa w 50 m',
    tytul: 'Sieć gazowa',
  },
  {
    klucz: 'woda',
    warstwa: 'przewod_wodociagowy',
    warstwaMsip: 'siec_wodociagowa',
    id: 'uzbrojenie_woda_50m',
    nazwa: 'Wodociąg w 50 m',
    tytul: 'Sieć wodociągowa',
  },
  {
    klucz: 'prad',
    warstwa: 'przewod_elektroenergetyczny',
    warstwaMsip: 'siec_elektroenergetyczna',
    id: 'uzbrojenie_prad_50m',
    nazwa: 'Sieć elektroenergetyczna w 50 m',
    tytul: 'Sieć elektroenergetyczna',
  },
  {
    klucz: 'kanalizacja',
    warstwa: 'przewod_kanalizacyjny',
    warstwaMsip: 'siec_kanalizacyjna',
    id: 'uzbrojenie_kanalizacja_50m',
    nazwa: 'Kanalizacja w 50 m',
    tytul: 'Sieć kanalizacyjna',
  },
]

// ---------- PNG (paleta albo RGBA, bez przeplotu) → maska krycia ----------

/**
 * Dekoduje PNG → { szer, wys, maska } (maska[i] = 1, gdy krycie piksela ≥ minKrycie).
 * Obsługa: typ 3 (paleta, głębia 1/2/4/8, krycie z tRNS) i typ 6 (RGBA 8 bit, krycie z kanału
 * alfa). KIUT zwraca raz jedno, raz drugie; inne PNG-i odrzucamy zamiast zgadywać.
 */
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
  const rgba = typ === 6 && glebia === 8
  if (pl !== 0 || !(rgba || (typ === 3 && [1, 2, 4, 8].includes(glebia))))
    throw new Error(`Nieobsługiwany PNG: typ ${typ}, głębia ${glebia}, przeplot ${pl}`)
  // Krycie każdego wpisu palety; wpis bez tRNS jest w pełni kryjący (specyfikacja PNG).
  const krycie = new Uint8Array(Math.max(paleta, 1)).fill(255)
  if (trns) for (let i = 0; i < trns.length && i < krycie.length; i++) krycie[i] = trns[i]
  // Filtry PNG patrzą na bajt sprzed jednego PIKSELA, a przy głębi < 8 bit – sprzed jednego bajtu.
  const bpp = rgba ? 4 : 1
  const linia = rgba ? szer * 4 : Math.ceil((szer * glebia) / 8)
  const surowe = unzlibSync(Buffer.concat(idat))
  if (surowe.length !== (linia + 1) * wys) throw new Error('PNG: nieoczekiwana długość danych')
  const maska = new Uint8Array(szer * wys)
  let poprz = new Uint8Array(linia)
  const maskaBit = (1 << glebia) - 1
  for (let y = 0; y < wys; y++) {
    const start = y * (linia + 1)
    const f = surowe[start]
    // Odfiltrowanie w miejscu: wiersz nad nim jest już surowy, więc służy za `poprz`.
    const lin = surowe.subarray(start + 1, start + 1 + linia)
    if (f > 4) throw new Error(`PNG: nieznany filtr ${f}`)
    if (f !== 0)
      for (let x = 0; x < linia; x++) {
        const a = x >= bpp ? lin[x - bpp] : 0
        const g = poprz[x]
        const c = x >= bpp ? poprz[x - bpp] : 0
        let p = 0
        if (f === 1) p = a
        else if (f === 2) p = g
        else if (f === 3) p = (a + g) >> 1
        else {
          const pa = Math.abs(g - c)
          const pb = Math.abs(a - c)
          const pc = Math.abs(a + g - 2 * c)
          p = pa <= pb && pa <= pc ? a : pb <= pc ? g : c
        }
        lin[x] = (lin[x] + p) & 255
      }
    if (rgba)
      for (let x = 0; x < szer; x++) maska[y * szer + x] = lin[4 * x + 3] >= minKrycie ? 1 : 0
    else
      for (let x = 0; x < szer; x++) {
        const bit = x * glebia
        const idx = (lin[bit >> 3] >> (8 - glebia - (bit & 7))) & maskaBit
        maska[y * szer + x] = (krycie[idx] ?? 255) >= minKrycie ? 1 : 0
      }
    poprz = lin
  }
  return { szer, wys, maska }
}

/** Liczba pikseli „sieci” w masce. */
export function liczbaPikseli(m) {
  let n = 0
  for (let i = 0; i < m.maska.length; i++) n += m.maska[i]
  return n
}

/** Odrzuca maskę, w której „sieć” zajmuje większość obrazu – to nie mapa przewodów. */
export function sprawdzMaske(m) {
  const zajete = liczbaPikseli(m)
  if (zajete > MAX_UDZIAL_PIKSELI * m.maska.length)
    throw new Error(
      `Obraz podejrzany: ${Math.round((100 * zajete) / m.maska.length)}% pikseli to „sieć” (brak przezroczystego tła?)`,
    )
  return m
}

/**
 * Suma (OR) masek tego samego rozmiaru: przebiegi pobrania jednego obrazu. KIUT bywa po cichu pusty,
 * ale nigdy nie dorysowuje sieci, której nie ma, więc suma jest bliżej prawdy niż każdy przebieg.
 * Przebieg jest DOBRY, gdy ma co najmniej 90% pikseli najlepszego przebiegu albo różni się od niego
 * o najwyżej 200 pikseli (rozrzut renderu, rzadka sieć). `dobre` to liczba dobrych przebiegów,
 * `rozbiezne` – czy któryś przebieg dobry nie jest (czyli prawdopodobnie zawiódł).
 */
export function polaczPrzebiegi(maski) {
  const [pierwsza] = maski
  if (!pierwsza) throw new Error('Brak masek do połączenia')
  const { szer, wys } = pierwsza
  if (maski.some((m) => m.szer !== szer || m.wys !== wys))
    throw new Error('Maski przebiegów mają różny rozmiar')
  const maska = new Uint8Array(szer * wys)
  for (const m of maski) for (let i = 0; i < maska.length; i++) maska[i] |= m.maska[i]
  const piksele = maski.map(liczbaPikseli)
  const najlepszy = Math.max(...piksele)
  const dobre = piksele.filter((p) => p >= 0.9 * najlepszy || najlepszy - p <= 200).length
  return {
    maska: { szer, wys, maska },
    piksele: liczbaPikseli({ maska }),
    dobre,
    rozbiezne: dobre < piksele.length,
  }
}

/**
 * Obraz ma mieć dokładnie tyle pikseli, ile zapytano. Inny rozmiar (usługa przeskalowała albo
 * przycięła obraz) przesunąłby wszystkie współrzędne względem adresów, więc go odrzucamy.
 */
export function sprawdzRozmiar(m, profil) {
  const bok = bokPx(profil)
  if (m.szer !== bok || m.wys !== bok)
    throw new Error(`Obraz ${m.szer}×${m.wys} px zamiast ${bok}×${bok}`)
  return m
}

/**
 * Dokłada do maski sumy wierszy: pref[y · (szer + 1) + x] = liczba pikseli maski w wierszu y na lewo
 * od x. Z nimi test „czy w kole jest piksel” kosztuje 2r + 1 odczytów zamiast (2r + 1)² – przy kole
 * 250 m na obrazie 0,625 m/px to 801 zamiast 640 tys. na adres.
 */
export function zIndeksem(m) {
  const { szer, wys, maska } = m
  if (szer >= 65_535) throw new Error('Maska za szeroka dla sum wierszy (Uint16)')
  const pref = new Uint16Array((szer + 1) * wys)
  for (let y = 0; y < wys; y++) {
    const o = y * (szer + 1)
    let s = 0
    for (let x = 0; x < szer; x++) {
      s += maska[y * szer + x]
      pref[o + x + 1] = s
    }
  }
  return { ...m, pref }
}

const polowyKola = new Map()
/** Dla każdego wiersza koła o promieniu r: największy |dx| z dx² + dy² ≤ r². */
function szerokosciKola(r) {
  let t = polowyKola.get(r)
  if (!t) {
    t = new Int32Array(2 * r + 1)
    for (let dy = -r; dy <= r; dy++) t[dy + r] = Math.floor(Math.sqrt(r * r - dy * dy))
    polowyKola.set(r, t)
  }
  return t
}

/** Czy w kole o promieniu r px wokół (px, py) jest piksel maski. Używa sum wierszy, gdy są (zIndeksem). */
export function jestWPromieniu(m, px, py, r) {
  const { szer, wys, maska, pref } = m
  const pol = szerokosciKola(r)
  for (let dy = -r; dy <= r; dy++) {
    const y = py + dy
    if (y < 0 || y >= wys) continue
    const w = pol[dy + r]
    const x0 = Math.max(0, px - w)
    const x1 = Math.min(szer - 1, px + w)
    if (x0 > x1) continue
    if (pref) {
      const o = y * (szer + 1)
      if (pref[o + x1 + 1] - pref[o + x0] > 0) return true
    } else {
      const o = y * szer
      for (let x = x0; x <= x1; x++) if (maska[o + x]) return true
    }
  }
  return false
}

export const pustaMaska = (m) => m.maska.indexOf(1) === -1

// ---------- Kafle ----------

/** Zasięg obrazu kafla z zapasem w EPSG:2180: [xmin, ymin, xmax, ymax] (x = wschód, y = północ). */
export function zasiegKafla(tx, ty, profil = PROFIL_KIUT) {
  const { kafel, zapas } = profil
  return [
    tx * kafel - zapas,
    ty * kafel - zapas,
    (tx + 1) * kafel + zapas,
    (ty + 1) * kafel + zapas,
  ]
}

/** URL GetMap KIUT – WMS 1.3.0 z EPSG:2180 ma oś północ-wschód, więc BBOX = ymin,xmin,ymax,xmax. */
export function urlGetMap(warstwa, tx, ty) {
  const [xmin, ymin, xmax, ymax] = zasiegKafla(tx, ty, PROFIL_KIUT)
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

/**
 * URL GetMap GESUT Krakowa (MSIP). WMS 1.1.1, bo tam BBOX jest zawsze x,y (wschód, północ) – w 1.3.0
 * oś EPSG:2180 to północ-wschód i łatwo ją pomylić. PNG8 z jednym przezroczystym wpisem palety.
 */
export function urlGetMapMsip(warstwa, tx, ty) {
  const bok = String(bokPx(PROFIL_MSIP))
  const p = new URLSearchParams({
    SERVICE: 'WMS',
    VERSION: '1.1.1',
    REQUEST: 'GetMap',
    LAYERS: warstwa,
    STYLES: '',
    SRS: 'EPSG:2180',
    BBOX: zasiegKafla(tx, ty, PROFIL_MSIP).join(','),
    WIDTH: bok,
    HEIGHT: bok,
    FORMAT: 'image/png8',
    TRANSPARENT: 'TRUE',
  })
  return `${MSIP_GESUT}?${p}`
}

/** Punkt (x, y) EPSG:2180 → piksel kafla (wiersz 0 = północ). */
export function pikselWKaflu(x, y, tx, ty, profil = PROFIL_KIUT) {
  const [xmin, , , ymax] = zasiegKafla(tx, ty, profil)
  return [Math.floor((x - xmin) / profil.piksel), Math.floor((ymax - y) / profil.piksel)]
}

/** Adresy z gminy Kraków liczy MSIP, wszystkie pozostałe KIUT. Zwraca indeksy adresów. */
export function podzielAdresy(adresy) {
  const krakow = []
  const obwarzanek = []
  for (const a of adresy) (a.gmina === MIASTO_MSIP ? krakow : obwarzanek).push(a.i)
  return { krakow, obwarzanek }
}

/** Indeksy adresów pogrupowane w kafle: klucz „tx_ty” → indeksy (kolejność kafli jak napotkane). */
export function kafleAdresow(indeksy, xy, kafel = KAFEL_M) {
  const kafle = new Map()
  for (const i of indeksy) {
    const [x, y] = xy[i]
    const k = `${Math.floor(x / kafel)}_${Math.floor(y / kafel)}`
    const lista = kafle.get(k)
    if (lista) lista.push(i)
    else kafle.set(k, [i])
  }
  return kafle
}

/**
 * Flagi dla adresów jednego kafla. maski: { klucz → maska }. Zwraca { klucz → (0|1|null)[] }
 * w kolejności punktów. null (brak danych), gdy w promieniu ZASIEG_DANYCH_M od adresu nie ma
 * żadnego piksela żadnej z sieci – w zabudowie to znak, że ewidencja nie obejmuje tego miejsca,
 * a nie że nie ma rur. Kafel bez pikseli – null wszędzie.
 */
export function flagiKafla(maski, punkty, tx, ty, profil = PROFIL_KIUT) {
  const lista = Object.values(maski)
  const bezDanych = lista.every(pustaMaska)
  const r = Math.round(PROMIEN_M / profil.piksel)
  const rDanych = Math.round(ZASIEG_DANYCH_M / profil.piksel)
  const piksele = punkty.map(([x, y]) => pikselWKaflu(x, y, tx, ty, profil))
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

// ---------- Pobieranie ----------

const czekaj = (ms) => new Promise((ok) => setTimeout(ok, ms))

async function pobierzKiut(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(120_000) })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return Buffer.from(await r.arrayBuffer())
}

/**
 * Zapewnia obraz w cache: true, gdy plik jest (był albo został pobrany), false, gdy się nie udało.
 * Nie zapisujemy do cache odpowiedzi, która nie jest poprawnym obrazem sieci (komunikat błędu
 * usługi, obcięty PNG), a zapis idzie przez plik tymczasowy, żeby przerwany bieg nie zostawił
 * połowy pliku: kolejny bieg spróbuje znowu.
 */
async function zapewnijPng(profil, pobierz, url, plik, { prob = 3, pauzaMs = 250 } = {}) {
  if (existsSync(plik)) return true
  if (process.env.TYLKO_CACHE) return false
  for (let proba = 1; ; proba++) {
    try {
      const buf = await pobierz(url)
      sprawdzRozmiar(sprawdzMaske(maskaPng(buf)), profil)
      writeFileSync(`${plik}.tmp`, buf)
      renameSync(`${plik}.tmp`, plik)
      await czekaj(pauzaMs)
      return true
    } catch (e) {
      // Usługa bywa niedostępna (HTTP 503): po kilku próbach zwracamy false, nie przerywamy biegu
      // i nie zapisujemy do cache.
      if (proba >= prob) {
        console.warn(`  pominięty kafel: ${url} → ${e.message}`)
        return false
      }
      await czekaj(2000 * proba)
    }
  }
}

/** Maska z pliku cache albo null (uszkodzony plik usuwamy: następny bieg pobierze go od nowa). */
function wczytajMaske(profil, plik) {
  try {
    return sprawdzRozmiar(maskaPng(readFileSync(plik)), profil)
  } catch (e) {
    console.warn(`  uszkodzony plik cache ${plik}: ${e.message}`)
    rmSync(plik, { force: true })
    return null
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

/** Data pobrania = data najstarszego pliku z cache (pobranie jednorazowe, potem z cache). */
function dataPobrania(pliki) {
  let najstarszy = Number.POSITIVE_INFINITY
  for (const p of pliki) if (existsSync(p)) najstarszy = Math.min(najstarszy, statSync(p).mtimeMs)
  return Number.isFinite(najstarszy) ? new Date(najstarszy).toISOString().slice(0, 10) : dzis()
}

/**
 * Plik obrazu w cache. Przebieg 1 ma nazwę bez przyrostka, więc cache sprzed przebiegów zostaje
 * ważny; kolejne to `.p2` … `.p5`.
 */
export const plikKafla = (profil, s, k, przebieg = 1) =>
  join(katalogCache(profil), `${s.klucz}_${k}${przebieg > 1 ? `.p${przebieg}` : ''}.png`)
const rozbierzKlucz = (k) => k.split('_').map(Number)

// ---------- Źródło 1: KIUT (obwarzanek) ----------

/**
 * Maska obrazu KIUT: suma masek przebiegów (null, gdy żaden nie jest czytelny). Wynik jest
 * NIEPEWNY, dopóki nie ma dwóch dobrych przebiegów (jeden dobry może być tylko częścią sieci, a drugi
 * zawiódł) albo gdy suma jest rzadka (PROG_RZADKIEJ_SIECI) i przebiegów jest tylko tyle co
 * PRZEBIEGI_KIUT: pusty obraz bywa fałszywy, a prawdziwie rzadka sieć wyjdzie rzadka za każdym razem.
 * Niepewny wynik dostaje kolejne przebiegi, najwyżej do MAKS_PRZEBIEGOW_KIUT. `stat` zlicza obrazy
 * z przebiegiem, który zawiódł, z dokładkami i z mniejszą niż zaplanowana liczbą przebiegów.
 */
async function maskaKiut(s, k, stat) {
  const [tx, ty] = rozbierzKlucz(k)
  const maski = []
  const wczytaj = (przebieg) => {
    const plik = plikKafla(PROFIL_KIUT, s, k, przebieg)
    const m = existsSync(plik) ? wczytajMaske(PROFIL_KIUT, plik) : null
    if (m) maski.push(m)
  }
  for (let p = 1; p <= PRZEBIEGI_KIUT; p++) wczytaj(p)
  let wynik = maski.length ? polaczPrzebiegi(maski) : null
  const niepewny = () =>
    !wynik ||
    wynik.dobre < 2 ||
    (wynik.piksele < PROG_RZADKIEJ_SIECI && maski.length <= PRZEBIEGI_KIUT)
  let dokladki = 0
  for (let p = PRZEBIEGI_KIUT + 1; p <= MAKS_PRZEBIEGOW_KIUT && niepewny(); p++) {
    const plik = plikKafla(PROFIL_KIUT, s, k, p)
    if (!(await zapewnijPng(PROFIL_KIUT, pobierzKiut, urlGetMap(s.warstwa, tx, ty), plik))) continue
    const przed = maski.length
    wczytaj(p)
    if (maski.length > przed) {
      wynik = polaczPrzebiegi(maski)
      dokladki++
    }
  }
  if (!wynik) return null
  if (dokladki) stat.dodatkowe++
  if (maski.length < PRZEBIEGI_KIUT) stat.jedenPrzebieg++
  if (wynik.rozbiezne) stat.rozbiezne++
  if (wynik.dobre < 2 && wynik.piksele >= PROG_RZADKIEJ_SIECI) stat.niepewne++
  return wynik.maska
}

async function fazaKiut(indeksy, xy, wartosci, limit) {
  mkdirSync(katalogCache(PROFIL_KIUT), { recursive: true })
  let lista = [...kafleAdresow(indeksy, xy).entries()]
  if (limit > 0) lista = lista.slice(0, limit)
  const obrazy = lista.flatMap(([k]) => SIECI.map((s) => ({ k, s })))
  console.log(
    `KIUT: ${lista.length} kafli × ${SIECI.length} warstwy, ${PRZEBIEGI_KIUT} przebiegi pobrania`,
  )
  // 1. Pobranie: przebieg 1 wszystkich obrazów, potem przebieg 2 (patrz „Uwaga sieciowa”).
  for (let przebieg = 1; przebieg <= PRZEBIEGI_KIUT; przebieg++) {
    let gotowe = 0
    await pula(obrazy, 2, async ({ k, s }) => {
      const [tx, ty] = rozbierzKlucz(k)
      const plik = plikKafla(PROFIL_KIUT, s, k, przebieg)
      await zapewnijPng(PROFIL_KIUT, pobierzKiut, urlGetMap(s.warstwa, tx, ty), plik)
      if (++gotowe % 200 === 0)
        console.log(`  KIUT, przebieg ${przebieg}: ${gotowe}/${obrazy.length}`)
    })
  }
  // 2. Liczenie po jednym kaflu: maska każdej warstwy to suma przebiegów.
  const stat = { rozbiezne: 0, dodatkowe: 0, jedenPrzebieg: 0, niepewne: 0 }
  let pusteKafle = 0
  let nieudane = 0
  for (const [k, idx] of lista) {
    const [tx, ty] = rozbierzKlucz(k)
    const maski = {}
    for (const s of SIECI) {
      const maska = await maskaKiut(s, k, stat)
      if (!maska) break
      maski[s.klucz] = zIndeksem(maska)
    }
    if (Object.keys(maski).length < SIECI.length) {
      nieudane++ // brak choć jednej warstwy → cały kafel null (pustego kafla nie odróżnimy od braku)
      continue
    }
    if (Object.values(maski).every(pustaMaska)) pusteKafle++
    const f = flagiKafla(
      maski,
      idx.map((i) => xy[i]),
      tx,
      ty,
      PROFIL_KIUT,
    )
    for (const s of SIECI) idx.forEach((i, j) => (wartosci[s.klucz][i] = f[s.klucz][j]))
  }
  console.log(`KIUT: kafle bez żadnej sieci (null): ${pusteKafle}, niepobrane (null): ${nieudane}`)
  console.log(
    `KIUT: obrazy z przebiegiem, który zawiódł (ubogi o ponad 10%): ${stat.rozbiezne}; ` +
      `z dokładkami (do ${MAKS_PRZEBIEGOW_KIUT} przebiegów): ${stat.dodatkowe}; ` +
      `tylko z jednym przebiegiem: ${stat.jedenPrzebieg}; ` +
      `bez dwóch dobrych przebiegów mimo dokładek: ${stat.niepewne}`,
  )
  const przebiegi = Array.from({ length: MAKS_PRZEBIEGOW_KIUT }, (_, i) => i + 1)
  return {
    pobrano: dataPobrania(
      lista.flatMap(([k]) =>
        SIECI.flatMap((s) => przebiegi.map((p) => plikKafla(PROFIL_KIUT, s, k, p))),
      ),
    ),
  }
}

// ---------- Źródło 2: MSIP (Kraków) ----------

async function fazaMsip(indeksy, xy, wartosci, limit) {
  mkdirSync(katalogCache(PROFIL_MSIP), { recursive: true })
  let lista = [...kafleAdresow(indeksy, xy).entries()]
  if (limit > 0) lista = lista.slice(0, limit)
  console.log(
    `MSIP: ${lista.length} kafli × ${SIECI.length} warstwy (obraz ${bokPx(PROFIL_MSIP)} px)`,
  )
  // 1. Pobranie. Dwa kafle równolegle, warstwy jednego kafla po kolei, przerwa po każdym obrazie.
  let pobrane = 0
  await pula(lista, 2, async ([k]) => {
    const [tx, ty] = rozbierzKlucz(k)
    for (const s of SIECI)
      await zapewnijPng(
        PROFIL_MSIP,
        pobierzBajtyMsip,
        urlGetMapMsip(s.warstwaMsip, tx, ty),
        plikKafla(PROFIL_MSIP, s, k),
        { pauzaMs: 500 },
      )
    if (++pobrane % 5 === 0) console.log(`  kafle MSIP pobrane: ${pobrane}/${lista.length}`)
  })
  // 2. Liczenie po jednym kaflu: cztery maski 16 Mpx z sumami wierszy to ok. 200 MB.
  let pusteKafle = 0
  let nieudane = 0
  for (const [k, idx] of lista) {
    const [tx, ty] = rozbierzKlucz(k)
    const pliki = SIECI.map((s) => plikKafla(PROFIL_MSIP, s, k))
    const maski = {}
    for (const [j, s] of SIECI.entries()) {
      const plik = pliki[j]
      const maska = existsSync(plik) ? wczytajMaske(PROFIL_MSIP, plik) : null
      if (!maska) break
      maski[s.klucz] = zIndeksem(maska)
    }
    if (Object.keys(maski).length < SIECI.length) {
      nieudane++
      continue
    }
    if (Object.values(maski).every(pustaMaska)) pusteKafle++
    const f = flagiKafla(
      maski,
      idx.map((i) => xy[i]),
      tx,
      ty,
      PROFIL_MSIP,
    )
    for (const s of SIECI) idx.forEach((i, j) => (wartosci[s.klucz][i] = f[s.klucz][j]))
  }
  console.log(`MSIP: kafle bez żadnej sieci (null): ${pusteKafle}, niepobrane (null): ${nieudane}`)
  return {
    pobrano: dataPobrania(lista.flatMap(([k]) => SIECI.map((s) => plikKafla(PROFIL_MSIP, s, k)))),
  }
}

// ---------- Wskaźniki ----------

const opis = (s) =>
  `${s.tytul} w promieniu ${PROMIEN_M} m od punktu adresu według geodezyjnej ewidencji sieci ` +
  'uzbrojenia terenu (GESUT): 1 – sieć jest w ewidencji, 0 – ewidencja jej tu nie pokazuje. ' +
  'Kraków: GESUT miasta z MSIP; gminy wokół Krakowa: GESUT powiatów z Krajowej Integracji ' +
  'Uzbrojenia Terenu (GUGiK). Sieć w zasięgu nie znaczy, że budynek jest podłączony, a ' +
  'ewidencja bywa niepełna. Brak danych, gdy w promieniu 250 m nie ma żadnej z czterech sieci – ' +
  'nie wiadomo wtedy, czy rur nie ma, czy ewidencji.'

export function zrodlaWskaznika(s, pobranoMsip, pobranoKiut) {
  return [
    {
      nazwa: `${ATRYBUCJA_MSIP} – Geodezyjna Sieć Uzbrojenia Terenu miasta Krakowa (WMS, warstwa ${s.warstwaMsip})`,
      url: MSIP_GESUT,
      licencja:
        `${LICENCJA_MSIP}; usługa przeglądania WMS jest nieodpłatna (pkt 10), GESUT nie jest ` +
        'OPEN DATA (pkt 22): z obrazów liczymy jednorazowo tylko flagę „sieć w 50 m”, wektorów ' +
        'nie pobieramy ani nie udostępniamy',
      dataDanych: pobranoMsip,
      pobrano: pobranoMsip,
    },
    {
      nazwa: `GUGiK – Krajowa Integracja Uzbrojenia Terenu (WMS, warstwa ${s.warstwa}, dane GESUT powiatów)`,
      url: KIUT,
      licencja: 'Usługa publiczna GUGiK: brak opłat, brak ograniczeń dostępu (GetCapabilities)',
      dataDanych: pobranoKiut,
      pobrano: pobranoKiut,
    },
  ]
}

async function main() {
  const { adresy } = wczytajAdresy()
  const xy = adresy.map((a) => do2180(a.lon, a.lat))
  const { krakow, obwarzanek } = podzielAdresy(adresy)
  const limit = Number(process.env.LIMIT_KAFLI) || 0
  const wartosci = Object.fromEntries(
    SIECI.map((s) => [s.klucz, new Array(adresy.length).fill(null)]),
  )
  console.log(`Adresy: ${krakow.length} w Krakowie (MSIP), ${obwarzanek.length} poza (KIUT)`)
  // ZRODLO=kiut|msip – tylko jedno źródło (pobranie do cache i statystyki, bez zapisu wskaźników);
  // dzięki temu oba pobrania mogą iść w osobnych procesach.
  const zrodlo = process.env.ZRODLO ?? 'oba'
  const kiut = zrodlo === 'msip' ? null : await fazaKiut(obwarzanek, xy, wartosci, limit)
  const msip = zrodlo === 'kiut' ? null : await fazaMsip(krakow, xy, wartosci, limit)

  const zDanymi = (idx, klucz) => idx.filter((i) => wartosci[klucz][i] !== null).length
  for (const s of SIECI)
    console.log(
      `${s.id}: Kraków ${zDanymi(krakow, s.klucz)}/${krakow.length}, ` +
        `obwarzanek ${zDanymi(obwarzanek, s.klucz)}/${obwarzanek.length}`,
    )
  if (limit > 0 || !kiut || !msip) {
    console.log('Próba (LIMIT_KAFLI albo ZRODLO): wskaźników nie zapisuję.')
    return
  }
  for (const s of SIECI)
    zapiszWskaznik(
      {
        id: s.id,
        kategoria: 'codziennosc',
        nazwa: s.nazwa,
        opis: opis(s),
        jednostka: 'tak/nie',
        kierunek: 'wiecej-lepiej',
        rozdzielczosc: 'adres',
        zakres: [0, 1],
        zadanie: 72,
        zrodla: zrodlaWskaznika(s, msip.pobrano, kiut.pobrano),
      },
      wartosci[s.klucz],
    )
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main()
