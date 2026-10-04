// Punkty usług dla trybu „Biznes" (#104, #160): sklep spożywczy, apteka, fryzjer, piekarnia, kawiarnia, POZ,
// dentysta, fizjoterapia, laboratorium, siłownia, weterynarz, restauracja, warsztat, myjnia, salon
// kosmetyczny, kwiaciarnia i optyk oraz (druga partia #160) drogeria, cukiernia, sklep mięsny, warzywniak,
// pralnia, sklep zoologiczny, bar, lodziarnia i paczkomat w Krakowie i obwarzanku. Same punkty (bez
// wskaźników na adres) z pięciu źródeł: OpenStreetMap (Geofabrik), Overture Places, Rejestr Aptek, RPWDL
// (POZ, dentysta, fizjoterapia, laboratorium) i – tylko jako flaga `nfz` dentysty – NFZ Terminy Leczenia.
// CEIDG domyślnie wyłączony: adres działalności to często adres domowy, nie lokal, więc punkty
// wprowadzały szum (decyzja 2026-10-03).
// Uruchom: node etl/uslugi.mjs [--z-ceidg] [--budzet-ceidg=300]. Opis źródeł i licencji: etl/uslugi.md.
// Surowe pobrania trafiają do etl/.cache, drugi bieg ich nie pobiera.
// Wynik: public/dane/uslugi/katalog.json i public/dane/uslugi/<branza>.json.
import { mkdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { geokoduj } from './lib/codziennosc-geo.mjs'
import { apteki, BBOX, przychodniePoz } from './lib/codziennosc-zrodla.mjs'
import {
  budzetZCache,
  paryCeidg,
  pobierzCeidg,
  politykaCeidg,
  punktyZRekordow,
  wczytajToken,
} from './lib/uslugi-ceidg.mjs'
import { BRANZE } from './lib/uslugi-katalog.mjs'
import {
  kontrolaPolozenia,
  miejscaNfz,
  oznaczNfz,
  PROMIEN_NFZ_M,
  ustalPolozenie,
} from './lib/uslugi-nfz.mjs'
import { punktyOsmBranz } from './lib/uslugi-osm.mjs'
import { punktyOverture } from './lib/uslugi-overture.mjs'
import { punktyRpwdlBranz } from './lib/uslugi-rpwdl.mjs'
import { sprawdzWyjscie, zlozWyjscie } from './lib/uslugi-wyjscie.mjs'
import { CACHE, DANE, dzis } from './lib/wspolne.mjs'

const KATALOG_WYJSCIA = join(DANE, 'uslugi')
const LIMIT_CEIDG = 300

const wBbox = (p) =>
  p.lat >= BBOX.minLat && p.lat <= BBOX.maxLat && p.lon >= BBOX.minLon && p.lon <= BBOX.maxLon

const dataPliku = (sciezka) => {
  try {
    return statSync(sciezka).mtime.toISOString().slice(0, 10)
  } catch {
    return dzis()
  }
}

/** Punkty rejestru jako wejście deduplikacji (bit `rejestr`); nazwa idzie do pliku tylko po filtrze. */
const zRejestru = (branza, punkty) =>
  punkty.map((p) => ({
    zrodlo: 'rejestr',
    branza,
    nazwa: p.nazwa ?? null,
    lat: p.lat,
    lon: p.lon,
    flagi: [],
  }))

/** CEIDG: pobranie stron w budżecie, geokodowanie adresów, punkty. Każda awaria = brak uzupełnienia, nie błąd ETL. */
async function punktyCeidg(budzetLaczny) {
  const token = wczytajToken()
  if (!token) {
    console.log('CEIDG: brak CEIDG_TOKEN (env, .env.local) – pomijam uzupełnienie')
    return { punkty: [], meta: { pominiete: 'brak tokenu CEIDG_TOKEN' } }
  }
  const budzet = budzetZCache(budzetLaczny)
  console.log(
    `CEIDG: budżet tego biegu ${budzet.zostalo} zapytań (łącznie ${budzetLaczny}, wcześniej użyto ${budzet.bazowe})`,
  )
  const { rekordy, raport } = await pobierzCeidg({
    pary: paryCeidg(politykaCeidg),
    token,
    budzet,
  })
  const wsp = await geokoduj(
    rekordy.map((r) => ({ miejscowosc: r.miasto, ulica: r.ulica, nr: r.budynek, kod: r.kod })),
  )
  const punkty = punktyZRekordow(rekordy, wsp, BBOX)
  const trafione = wsp.filter(Boolean).length
  console.log(
    `CEIDG: ${rekordy.length} wpisów, adres znaleziono dla ${trafione}, w obszarze ${punkty.length}`,
  )
  return {
    punkty,
    meta: {
      dataDanych: raport.pobranoDo,
      pobrano: raport.pobranoDo,
      wpisow: rekordy.length,
      adresZnaleziony: trafione,
      punktowWObszarze: punkty.length,
      zapytanWTymBiegu: raport.zapytan,
      zapytanLacznie: raport.lacznieZUzytych,
      paryRazem: raport.pary.length,
      paryKompletne: raport.pary.filter((x) => x.kompletne).length,
      budzetWyczerpany: raport.budzetWyczerpany,
      odmowa: raport.odmowa,
      blad: raport.blad,
      pary: raport.pary,
    },
  }
}

/** Czytelna tabela: branża × źródło (wejście, w pliku) – do logu i raportu. */
export function tabelaLiczb(katalog) {
  const zr = ['osm', 'overture', 'rejestr', 'ceidg']
  const wiersze = katalog.branze.map((b) => {
    const surowe = b.liczby.surowe
    const w = b.liczby.wPlikuWgZrodel
    return [
      b.id,
      ...zr.map((z) => `${surowe[z] ?? 0}/${w[z] ?? 0}`),
      b.liczby.poDeduplikacji,
      b.n,
      b.liczby.bezSamegoCeidg,
      b.liczby.potwierdzoneWielomaZrodlami,
    ]
  })
  const naglowek = [
    'branża',
    'osm w/plik',
    'overture',
    'rejestr',
    'ceidg',
    'klastrów',
    'w pliku',
    'bez samego CEIDG',
    '≥2 źródła',
  ]
  const szer = naglowek.map((n, i) =>
    Math.max(n.length, ...wiersze.map((r) => String(r[i]).length)),
  )
  const linia = (r) => r.map((c, i) => String(c).padEnd(szer[i])).join(' | ')
  return [linia(naglowek), szer.map((s) => '-'.repeat(s)).join('-|-'), ...wiersze.map(linia)].join(
    '\n',
  )
}

export async function licz({ ceidg = false, budzetCeidg = LIMIT_CEIDG } = {}) {
  const t0 = Date.now()
  const osm = await punktyOsmBranz()
  console.log(`OSM (stan ${osm.stan}): ${osm.punkty.length} punktów w branżach katalogu`)
  const ov = await punktyOverture()
  console.log(
    `Overture ${ov.wydanie}: ${ov.punkty.length} punktów w branżach katalogu (z ${ov.miejsca} miejsc w obszarze)`,
  )
  const apt = await apteki()
  console.log(
    `Rejestr Aptek: ${apt.punkty.length} aptek w obszarze (z ${apt.razem} aktywnych, adres znaleziono dla ${apt.trafione})`,
  )
  const poz = await przychodniePoz()
  console.log(
    `RPWDL POZ: ${poz.punkty.length} komórek w obszarze (z ${poz.razem}, adres znaleziono dla ${poz.trafione})`,
  )
  // Pliki RPWDL w etl/.cache/rpwdl przygotowuje przychodniePoz(), więc ta kolejność jest wymagana.
  const rp = await punktyRpwdlBranz()
  for (const [id, l] of Object.entries(rp.wgBranz))
    console.log(
      `RPWDL ${id}: ${l.wObszarze} komórek w obszarze (z ${l.komorek}, adres znaleziono dla ${l.trafione})`,
    )
  // NFZ tylko do flagi `nfz` dentysty: miejsca świadczeń stomatologicznych z Informatora o Terminach Leczenia.
  const nfz = await miejscaNfz()
  const miejscaPolozone = await ustalPolozenie(nfz.miejsca)
  const wObszarze = (m) => m.pozycje.some((p) => wBbox(p))
  const miejscaWObszarze = miejscaPolozone.filter(wObszarze)
  console.log(
    `NFZ Terminy Leczenia (dane z ${nfz.meta.dataDanych}): ${nfz.miejsca.length} miejsc stomatologii w Małopolsce, ${miejscaWObszarze.length} w obszarze`,
  )
  const sc = ceidg
    ? await punktyCeidg(budzetCeidg).catch((e) => {
        // Awaria CEIDG albo geokodowania jego adresów nie może zablokować reszty warstwy.
        console.log(`CEIDG: błąd (${e.message}) – pomijam uzupełnienie`)
        return { punkty: [], meta: { blad: String(e.message) } }
      })
    : { punkty: [], meta: { pominiete: 'wyłączone flagą' } }

  const wejscieBezNfz = [
    ...osm.punkty,
    ...ov.punkty,
    ...zRejestru('apteka', apt.punkty),
    ...zRejestru('poz', poz.punkty),
    ...rp.punkty,
    ...sc.punkty,
  ]
  // Flaga nfz trafia na punkty wejściowe dentysty przed deduplikacją, więc przechodzi na cały klaster.
  const oznaczone = oznaczNfz(
    wejscieBezNfz.filter((p) => p.branza === 'dentysta'),
    miejscaWObszarze,
  )
  const wejscie = [...wejscieBezNfz.filter((p) => p.branza !== 'dentysta'), ...oznaczone.punkty]
  console.log(
    `NFZ: ${oznaczone.statystyki.dopasowanych} z ${oznaczone.statystyki.miejsc} miejsc w obszarze dopasowanych do punktu dentysty w ${PROMIEN_NFZ_M} m (z rejestru: ${oznaczone.statystyki.wybranychZRejestru})`,
  )
  const { pliki, katalog } = zlozWyjscie({
    wejscie,
    meta: {
      dataGenerowania: dzis(),
      bbox: BBOX,
      zrodla: {
        osm: { dataDanych: osm.stan, pobrano: osm.pobrano },
        overture: {
          dataDanych: ov.wydanie.slice(0, 10),
          pobrano: ov.pobrano,
          wydanie: ov.wydanie,
          miejscWObszarze: ov.miejsca,
        },
        rejestr_aptek: {
          dataDanych: dataPliku(join(CACHE, 'apteki-malopolskie.json')),
          pobrano: dataPliku(join(CACHE, 'apteki-malopolskie.json')),
          aktywnychWMalopolsce: apt.razem,
          adresZnaleziony: apt.trafione,
          wObszarze: apt.punkty.length,
        },
        rpwdl: {
          dataDanych: poz.stan,
          pobrano: dataPliku(join(CACHE, 'rpwdl-aktywne.zip')),
          komorekWMalopolsce: poz.razem,
          adresZnaleziony: poz.trafione,
          wObszarze: poz.punkty.length,
          // Branże z kodem resortowym (#160): czynne komórki Małopolski, z adresem w UUG i w obszarze.
          wgBranz: rp.wgBranz,
        },
        nfz: {
          dataDanych: nfz.meta.dataDanych,
          pobrano: nfz.meta.pobrano,
          okresSprawozdawczy: { od: nfz.meta.okresOd, do: nfz.meta.okresDo },
          swiadczenia: nfz.meta.swiadczenia,
          miejscWMalopolsce: nfz.miejsca.length,
          miejscWObszarze: miejscaWObszarze.length,
          promienDopasowaniaM: PROMIEN_NFZ_M,
          ...oznaczone.statystyki,
          kontrolaPolozenia: kontrolaPolozenia(miejscaPolozone),
        },
        ceidg: sc.meta,
      },
    },
  })

  const minima = Object.fromEntries(BRANZE.map((b) => [b.id, b.minPunktow]))
  const bledy = sprawdzWyjscie({ pliki, bbox: BBOX, minima, katalog })
  if (bledy.length) throw new Error(`Warstwa usług nie przeszła kontroli:\n- ${bledy.join('\n- ')}`)

  mkdirSync(KATALOG_WYJSCIA, { recursive: true })
  for (const [id, plik] of Object.entries(pliki))
    writeFileSync(join(KATALOG_WYJSCIA, `${id}.json`), JSON.stringify(plik))
  writeFileSync(join(KATALOG_WYJSCIA, 'katalog.json'), `${JSON.stringify(katalog, null, 2)}\n`)

  console.log(`\n${tabelaLiczb(katalog)}\n`)
  console.log(
    `Czas: ${((Date.now() - t0) / 1000).toFixed(1)} s. Zapisano ${Object.keys(pliki).length} plików w ${KATALOG_WYJSCIA}`,
  )
  return katalog
}

function argumenty(argv) {
  const opcje = {}
  for (const a of argv) {
    if (a === '--z-ceidg') opcje.ceidg = true
    else if (a.startsWith('--budzet-ceidg=')) opcje.budzetCeidg = Number(a.split('=')[1])
    else throw new Error(`Nieznany argument: ${a}`)
  }
  return opcje
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await licz(argumenty(process.argv.slice(2)))
