// Feedy GTFS miejskiego transportu publicznego dla trybu miasta (ADRESCORE_MIASTO=<slug>).
// Używane przez gtfs-przystanki.mjs i dojazd-gtfs*.mjs zamiast archiwów ZTP Kraków (A/M/T).
// Surowe ZIP-y leżą w etl/.cache/gtfs-miasta/<plik> (pobierane raz, wspólne dla wszystkich skryptów).
// Źródła wybrane z katalogu Mobility Database (files.mobilitydatabase.org/feeds_v2.csv) i stron
// organizatorów; każdy wpis ma URL pobrania. Licencje: tam, gdzie organizator ich nie podaje wprost
// w pliku, zapisujemy to wprost, zamiast zgadywać.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { MIASTO_INFO } from './miasto.mjs'
import { CACHE, MIASTO } from './wspolne.mjs'

const KATALOG = join(CACHE, 'gtfs-miasta')
const BRAK_LICENCJI =
  'Dane otwarte organizatora transportu; warunki ponownego wykorzystania według strony źródłowej (nie sprawdzane automatycznie)'

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
      {
        grupa: 'ZKM',
        plik: 'gdynia.zip',
        url: 'http://api.zdiz.gdynia.pl/pt/gtfs.zip',
        nazwa: 'ZKM Gdynia (ZDiZ Gdynia) – rozkład GTFS',
        licencja: BRAK_LICENCJI,
      },
    ],
  },
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
/** Feedy bieżącego miasta albo null (wtedy skrypty używają ZTP Kraków). */
export const FEEDY_MIASTA = GTFS_MIASTO?.feedy ?? null
/** Wymuszona data rozkładu (feed wygasły) albo null. */
export const DATA_OBSLUGI_MIASTA = GTFS_MIASTO?.dataObslugi ?? null

/** Zawartość ZIP-a feedu z cache (pobiera raz). Zwraca { bufor, meta: { bajty, sha256, dataPobrania } }. */
export async function wczytajFeedMiasta(feed) {
  mkdirSync(KATALOG, { recursive: true })
  const cel = join(KATALOG, feed.plik)
  if (!existsSync(cel)) {
    let ostatni
    for (let proba = 1; proba <= 4; proba++) {
      try {
        const odp = await fetch(feed.url, {
          headers: { 'User-Agent': 'adresscore-etl/1.0 (https://github.com/Mati46p/adresscore)' },
          signal: AbortSignal.timeout(300_000),
        })
        if (!odp.ok) throw new Error(`HTTP ${odp.status}`)
        const bufor = Buffer.from(await odp.arrayBuffer())
        const oczekiwane = Number(odp.headers.get('content-length'))
        if (oczekiwane && bufor.length !== oczekiwane) throw new Error('ucięte pobranie')
        writeFileSync(`${cel}.tmp`, bufor)
        renameSync(`${cel}.tmp`, cel)
        break
      } catch (blad) {
        ostatni = blad
        if (proba === 4) throw new Error(`GTFS ${feed.plik}: ${blad.message}`)
        await new Promise((ok) => setTimeout(ok, 1000 * proba))
      }
    }
    void ostatni
  }
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
