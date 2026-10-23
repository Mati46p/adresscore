// Feedy GTFS miejskiego transportu publicznego dla trybu miasta (ADRESCORE_MIASTO=<slug>).
// Używane przez gtfs-przystanki.mjs i dojazd-gtfs*.mjs zamiast archiwów ZTP Kraków (A/M/T).
// Surowe ZIP-y leżą w etl/.cache/gtfs-miasta/<plik> (pobierane raz, wspólne dla wszystkich skryptów).
// Źródła wybrane z katalogu Mobility Database (files.mobilitydatabase.org/feeds_v2.csv) i stron
// organizatorów; każdy wpis ma URL pobrania. Licencje: tam, gdzie organizator ich nie podaje wprost
// w pliku, zapisujemy to wprost, zamiast zgadywać.
import { createHash } from 'node:crypto'
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
import { strFromU8, unzipSync } from 'fflate'
import { MIASTO_INFO } from './miasto.mjs'
import { CACHE, MIASTO } from './wspolne.mjs'

const KATALOG = join(CACHE, 'gtfs-miasta')
const BRAK_LICENCJI =
  'Dane otwarte organizatora transportu; warunki ponownego wykorzystania według strony źródłowej (nie sprawdzane automatycznie)'

const LICENCJA_CC0 = 'CC0 (https://creativecommons.org/publicdomain/zero/1.0/)'
const UA = { 'User-Agent': 'adresscore-etl/1.0 (https://github.com/Mati46p/adresscore)' }

// Gdynia ma ten sam feed co druga pozycja Gdańska (wspólny plik gdynia.zip w cache).
const FEED_GDYNIA = {
  grupa: 'ZKM',
  plik: 'gdynia.zip',
  url: 'http://api.zdiz.gdynia.pl/pt/gtfs.zip',
  nazwa: 'ZKM Gdynia (ZDiZ Gdynia) – rozkład GTFS',
  licencja: BRAK_LICENCJI,
}

/**
 * GZM (Górnośląsko-Zagłębiowska Metropolia, ZTM) – jeden feed dla Katowic, Sosnowca, Gliwic, Zabrza,
 * Bytomia, Rudy Śląskiej, Tychów i Dąbrowy Górniczej. Zbiór CKAN „wersja rozszerzona" to ok. 12 ZIP-ów,
 * z których każdy ma własny, krótki zakres ważności (w dniu 2026-10-21: pierwsze ZIP-y to pojedyncze dni
 * 21, 22, 23.10, a kolejne tygodnie, np. 04–10.11). Dlatego URL nie jest stały: `zasoby()` czyta listę
 * z API CKAN, a `wczytajFeedMiasta` bierze pierwszy ZIP, którego feed_info (feed_start_date..feed_end_date)
 * obejmuje datę, dla której liczymy rozkład (domyślnie dziś; dojazd-gtfs podaje następny dzień roboczy). Gdy żaden nie obejmuje dziś (np. dzień bez wariantu), bierze najwcześniejszy
 * przyszły (najbliższy tydzień). Cache: gzm-<data>.zip, więc kolejnego dnia pobiera się wariant od nowa.
 * Licencja zbioru wg CKAN: CC BY 4.0 (wymagane wskazanie źródła: GZM ZTM).
 */
const API_GZM =
  'https://otwartedane.metropoliagzm.pl/api/3/action/package_show?id=rozklady-jazdy-i-lokalizacja-przystankow-gtfs-wersja-rozszerzona'
const FEED_GZM = {
  grupa: 'GZM',
  plik: 'gzm.zip',
  url: 'https://otwartedane.metropoliagzm.pl/en/dataset/rozklady-jazdy-i-lokalizacja-przystankow-gtfs-wersja-rozszerzona',
  zasoby: async () => {
    const odp = await fetch(API_GZM, { headers: UA, signal: AbortSignal.timeout(60_000) })
    if (!odp.ok) throw new Error(`CKAN GZM: HTTP ${odp.status}`)
    const { result } = await odp.json()
    return result.resources
      .filter((r) => /zip/i.test(r.format) && r.url)
      .sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }))
      .map((r) => r.url)
  },
  nazwa: 'GZM ZTM (Górnośląsko-Zagłębiowska Metropolia) – rozkład GTFS, wersja rozszerzona',
  licencja:
    'CC BY 4.0 – dane GZM ZTM (https://otwartedane.metropoliagzm.pl/en/dataset/rozklady-jazdy-i-lokalizacja-przystankow-gtfs-wersja-rozszerzona)',
}

/**
 * Miasta bez żadnego otwartego feedu GTFS (stan 2026-10-21): przystanki i dojazd do centrum nie mają
 * danych, więc skrypty gtfs-przystanki.mjs i dojazd-gtfs.mjs nic nie zapisują (warstwa = szara
 * kategoria „brak danych"). Nigdy nie podstawiamy rozkładu Krakowa.
 */
const BRAK_FEEDU = { feedy: [], brak: true }

/**
 * Definicje feedów. `grupa`: skrót w identyfikatorach i opisie, `nazwa`: organizator,
 * `dataObslugi`: wymuszona data rozkładu (tylko gdy jedyny dostępny feed już wygasł; opis wskaźnika
 * podaje wtedy datę wprost).
 */
export const GTFS_MIASTA = {
  warszawa: {
    feedy: [
      {
        grupa: 'ZTM',
        plik: 'warszawa.zip',
        url: 'https://mkuran.pl/gtfs/warsaw.zip',
        nazwa: 'ZTM Warszawa (rozkład GTFS przetworzony przez M. Kuranowskiego, mkuran.pl)',
        licencja:
          'Dane ZTM Warszawa udostępnione w GTFS przez mkuran.pl (https://mkuran.pl/gtfs/); warunki: strona źródłowa i https://creativecommons.org/publicdomain/zero/1.0/',
      },
    ],
  },
  lodz: {
    feedy: [
      {
        grupa: 'MPK',
        plik: 'lodz.zip',
        url: 'https://otwarte.miasto.lodz.pl/dane/gtfs',
        nazwa: 'MPK Łódź / ZDiT Łódź – rozkład GTFS (otwarte.miasto.lodz.pl)',
        licencja: BRAK_LICENCJI,
      },
    ],
  },
  wroclaw: {
    // Aktualny feed z wroclaw.pl jest niedostępny z tej sieci (HTTP 403); jedyna kopia to archiwum
    // Mobility Database z listopada 2025 (ważne do 2025-12-12), więc rozkład liczymy dla jej środy.
    dataObslugi: '2025-12-10',
    feedy: [
      {
        grupa: 'MPK',
        plik: 'wroclaw-mdb.zip',
        url: 'https://files.mobilitydatabase.org/mdb-980/latest.zip',
        nazwa:
          'MPK Wrocław – rozkład GTFS z otwartych danych Wrocławia (kopia Mobility Database, stan listopad 2025)',
        licencja:
          'CC0 – otwarte dane Wrocławia (https://www.wroclaw.pl/open-data/dataset/rozkladjazdytransportupublicznegoplik_data)',
      },
    ],
  },
  poznan: {
    feedy: [
      {
        grupa: 'ZTM',
        plik: 'poznan.zip',
        url: 'https://www.ztm.poznan.pl/pl/dla-deweloperow/getGTFSFile',
        nazwa: 'ZTM Poznań – rozkład GTFS',
        licencja: BRAK_LICENCJI,
      },
    ],
  },
  gdansk: {
    feedy: [
      {
        grupa: 'ZTM',
        plik: 'gdansk.zip',
        url: 'https://ckan.multimediagdansk.pl/dataset/c24aa637-3619-4dc2-a171-a23eec8f2172/resource/30e783e4-2bec-4a7d-bb22-ee3e3b26ca96/download/gtfsgoogle.zip',
        nazwa: 'ZTM Gdańsk – rozkład GTFS (otwarty portal ckan.multimediagdansk.pl)',
        licencja: BRAK_LICENCJI,
      },
      FEED_GDYNIA,
    ],
  },
  katowice: { feedy: [FEED_GZM] },
  sosnowiec: { feedy: [FEED_GZM] },
  gliwice: { feedy: [FEED_GZM] },
  zabrze: { feedy: [FEED_GZM] },
  bytom: { feedy: [FEED_GZM] },
  rudaslaska: { feedy: [FEED_GZM] },
  tychy: { feedy: [FEED_GZM] },
  dabrowagornicza: { feedy: [FEED_GZM] },
  gdynia: { feedy: [FEED_GDYNIA] },
  rzeszow: {
    feedy: [
      {
        grupa: 'MPK',
        plik: 'rzeszow.zip',
        url: 'https://www.mpkrzeszow.pl/gtfs/latest.zip',
        nazwa: 'MPK Rzeszów – rozkład GTFS',
        licencja: BRAK_LICENCJI,
      },
    ],
  },
  torun: {
    feedy: [
      {
        grupa: 'MZK',
        plik: 'torun.zip',
        url: 'https://mkuran.pl/gtfs/torun.zip',
        nazwa: 'MZK Toruń – rozkład GTFS (przetworzony przez mkuran.pl)',
        licencja: LICENCJA_CC0,
      },
    ],
  },
  kielce: {
    feedy: [
      {
        grupa: 'ZTM',
        plik: 'kielce.zip',
        url: 'https://mkuran.pl/gtfs/kielce.zip',
        nazwa: 'ZTM Kielce – rozkład GTFS (przetworzony przez mkuran.pl)',
        licencja: BRAK_LICENCJI,
      },
    ],
  },
  gorzowwielkopolski: {
    feedy: [
      {
        grupa: 'MZK',
        plik: 'gorzow_wlkp.zip',
        url: 'https://mkuran.pl/gtfs/gorzow_wlkp.zip',
        nazwa: 'MZK Gorzów Wielkopolski – rozkład GTFS (przetworzony przez mkuran.pl)',
        licencja: LICENCJA_CC0,
      },
    ],
  },
  czestochowa: BRAK_FEEDU,
  bielskobiala: BRAK_FEEDU,
  rybnik: BRAK_FEEDU,
  opole: BRAK_FEEDU,
  zielonagora: BRAK_FEEDU,
  radom: BRAK_FEEDU,
  olsztyn: BRAK_FEEDU,
  // Gmina wiejska pod Częstochową: brak otwartego feedu (PKS, MPK Częstochowa bez GTFS); nigdy nie podstawiamy rozkładu innego miasta.
  redziny: BRAK_FEEDU,
  szczecin: {
    feedy: [
      {
        grupa: 'ZDiTM',
        plik: 'szczecin.zip',
        url: 'https://www.zditm.szczecin.pl/storage/gtfs/gtfs.zip',
        nazwa: 'ZDiTM Szczecin – rozkład GTFS',
        licencja: BRAK_LICENCJI,
      },
    ],
  },
  bydgoszcz: {
    feedy: [
      {
        grupa: 'ZDMiKP',
        plik: 'bydgoszcz.zip',
        url: 'https://mkuran.pl/gtfs/bydgoszcz.zip',
        nazwa: 'ZDMiKP Bydgoszcz – rozkład GTFS (przetworzony przez mkuran.pl)',
        licencja: BRAK_LICENCJI,
      },
    ],
  },
  lublin: {
    feedy: [
      {
        grupa: 'ZTM',
        plik: 'lublin.zip',
        url: 'https://mkuran.pl/gtfs/lublin.zip',
        nazwa: 'ZTM Lublin – rozkład GTFS (przetworzony przez mkuran.pl)',
        licencja: BRAK_LICENCJI,
      },
    ],
  },
  bialystok: {
    feedy: [
      {
        grupa: 'BKM',
        plik: 'bialystok.zip',
        url: 'https://komunikacja.bialystok.pl/cms/File/download/gtfs/google_transit.zip',
        nazwa: 'Białostocka Komunikacja Miejska – rozkład GTFS',
        licencja: BRAK_LICENCJI,
      },
    ],
  },
}

export const GTFS_MIASTO = MIASTO_INFO ? GTFS_MIASTA[MIASTO] : null
/** Feedy bieżącego miasta albo null (poza trybem miasta: ZTP Kraków; BRAK_GTFS_MIASTA: skrypty pomijają warstwę). */
export const BRAK_GTFS_MIASTA = Boolean(GTFS_MIASTO?.brak)
export const FEEDY_MIASTA = GTFS_MIASTO?.brak ? null : (GTFS_MIASTO?.feedy ?? null)
/** Wymuszona data rozkładu (feed wygasły) albo null. */
export const DATA_OBSLUGI_MIASTA = GTFS_MIASTO?.dataObslugi ?? null

/** Pobiera url do pliku `cel` (4 próby, kontrola długości, zapis przez .tmp). Zwraca bufor. */
async function pobierzZip(url, cel) {
  for (let proba = 1; ; proba++) {
    try {
      const odp = await fetch(url, { headers: UA, signal: AbortSignal.timeout(300_000) })
      if (!odp.ok) throw new Error(`HTTP ${odp.status}`)
      const bufor = Buffer.from(await odp.arrayBuffer())
      const oczekiwane = Number(odp.headers.get('content-length'))
      if (oczekiwane && bufor.length !== oczekiwane) throw new Error('ucięte pobranie')
      writeFileSync(`${cel}.tmp`, bufor)
      renameSync(`${cel}.tmp`, cel)
      return bufor
    } catch (blad) {
      if (proba === 4) throw new Error(`GTFS ${url}: ${blad.message}`)
      await new Promise((ok) => setTimeout(ok, 1000 * proba))
    }
  }
}

/** Zakres ważności feedu z feed_info.txt (feed_start_date, feed_end_date jako RRRR-MM-DD) albo null. */
function zakresFeedu(bufor) {
  const pliki = unzipSync(bufor, { filter: (f) => f.name === 'feed_info.txt' })
  if (!pliki['feed_info.txt']) return null
  const [naglowek, wiersz] = strFromU8(pliki['feed_info.txt']).replace(/^﻿/, '').split(/\r?\n/)
  const rozbij = (linia) =>
    [...linia.matchAll(/"([^"]*)"|([^,]+)|(?<=,)(?=,|$)/g)].map((m) => m[1] ?? m[2] ?? '')
  const kolumny = rozbij(naglowek)
  const wartosci = rozbij(wiersz)
  const pole = (n) => wartosci[kolumny.indexOf(n)]?.replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3')
  return { od: pole('feed_start_date'), do: pole('feed_end_date') }
}

/**
 * Feed z dynamicznym URL-em (`zasoby()`): pierwszy ZIP obejmujący dzisiejszą datę, a gdy żaden –
 * najwcześniejszy przyszły. Wybrany ZIP ląduje w cache jako <plik>-<data>.zip.
 */
async function wybierzWariant(feed, dzis) {
  const cel = join(KATALOG, feed.plik.replace(/\.zip$/, `-${dzis}.zip`))
  if (existsSync(cel)) return cel
  let przyszly = null
  for (const url of await feed.zasoby()) {
    const tmp = join(KATALOG, `${feed.plik}.${process.pid}.kandydat`)
    const bufor = await pobierzZip(url, tmp)
    const z = zakresFeedu(bufor)
    if (z?.od && z.od <= dzis && dzis <= z.do) {
      renameSync(tmp, cel)
      console.log(`GTFS ${feed.grupa}: wariant ${url} (ważny ${z.od}..${z.do})`)
      return cel
    }
    if (z?.od > dzis && (!przyszly || z.od < przyszly.od)) {
      if (przyszly) rmSync(przyszly.tmp, { force: true })
      const zachowany = `${tmp}.przyszly`
      renameSync(tmp, zachowany)
      przyszly = { od: z.od, do: z.do, url, tmp: zachowany }
    } else rmSync(tmp, { force: true })
  }
  if (!przyszly) throw new Error(`GTFS ${feed.grupa}: brak wariantu ważnego od ${dzis}`)
  renameSync(przyszly.tmp, cel)
  console.log(
    `GTFS ${feed.grupa}: brak wariantu na dziś, najbliższy ${przyszly.url} (${przyszly.od}..${przyszly.do})`,
  )
  return cel
}

/** Zawartość ZIP-a feedu z cache (pobiera raz). Zwraca { bufor, meta: { bajty, sha256, dataPobrania } }. */
export async function wczytajFeedMiasta(feed, dzien = new Date().toLocaleDateString('sv-SE')) {
  mkdirSync(KATALOG, { recursive: true })
  let cel = join(KATALOG, feed.plik)
  if (feed.zasoby) cel = await wybierzWariant(feed, dzien)
  else if (!existsSync(cel)) await pobierzZip(feed.url, cel)
  const bufor = readFileSync(cel)
  return {
    bufor,
    meta: {
      bajty: bufor.length,
      sha256: createHash('sha256').update(bufor).digest('hex'),
      dataPobrania: statSync(cel).mtime.toISOString().slice(0, 10),
    },
  }
}

/** Data stanu danych feedu: feed_start_date / początek wersji z feed_info, a bez nich dzień pobrania. */
export function dataDanychFeedu(info, dataPobrania) {
  const d = (info?.feed_start_date || info?.feed_version || '').match(/^(\d{4})-?(\d{2})-?(\d{2})/)
  return d ? `${d[1]}-${d[2]}-${d[3]}` : dataPobrania
}
