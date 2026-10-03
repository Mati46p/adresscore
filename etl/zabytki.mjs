// Zabytki w promieniu 300 m od adresu (#125). Kategoria „kontekst": fakt na karcie, bez wpływu na
// wynik (sąsiedztwo zabytku bywa atutem okolicy i ograniczeniem, więc kierunek jest neutralny).
//
// Kraków: dwa wykazy punktowe MSIP z usługi Obserwatorium/zabytki_do_pobrania, warstwa 0 (obiekty
// w rejestrze zabytków) i warstwa 1 (obiekty w gminnej ewidencji zabytków). Wykazy obejmują całe
// miasto, więc 0 oznacza „brak pozycji w wykazach", czyli zmierzone zero. Pomijamy pozycje bez
// geometrii oraz te z adnotacją „nie istnieje"; adnotacje o wyłączeniu części zespołu zostawiamy,
// bo zespół nadal figuruje w wykazie.
//
// Gminy obwarzanka: Ewidencja zabytków nieruchomych NID (dane.gov.pl, zbiór 2627, CC BY 4.0).
// CSV NID NIE ma współrzędnych, tylko adresy, a w samym Krakowie zawiera ok. 30% pozycji z wykazu
// MSIP. Pozycję lokalizujemy wyłącznie przy dokładnej zgodności miejscowości, ulicy i numeru
// z punktem adresowym PRG (adresy.json). Reszta (brak numeru, stary adres wiejski bez ulicy tam,
// gdzie PRG ma już ulice) nie ma uczciwego położenia i nie jest liczona. Dlatego poza Krakowem
// wartość jest dolnym oszacowaniem: podajemy ją, gdy w 300 m jest co najmniej jedna zlokalizowana
// pozycja, a w pozostałych miejscach zostaje null (brak danych), nigdy 0.
//
// Uruchom: node etl/zabytki.mjs. Surowe pobrania w etl/.cache/ (MSIP: zabytki-*.geojson, NID:
// nid-zasoby.json i nid-zen-<data>.csv, ok. 70 MB); żeby pobrać ponownie, usuń pliki. MSIP idzie
// przez etl/lib/msip.mjs (powtórzenia, a przy odrzuconym certyfikacie obejście tylko dla hosta MSIP).
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { odlegloscMetry } from './lib/codziennosc-geo.mjs'
import { ATRYBUCJA_MSIP, LICENCJA_MSIP, MSIP, naMetry, pobierzJsonDoCache } from './lib/msip.mjs'
import { indeksPunktow, sumaWPromieniu } from './lib/przestrzen.mjs'
import { dzis, pobierzDoCache, wczytajAdresy, zapiszWskaznik } from './lib/wspolne.mjs'

export const PROMIEN_M = 300
export const TERYT_KRAKOW = '1261011'
const USLUGA = `${MSIP}/Obserwatorium/zabytki_do_pobrania/MapServer`
const NID_ZBIOR = 'https://dane.gov.pl/pl/dataset/2627,ewidencja-zabytkow-nieruchomych'
const NID_ZASOBY = 'https://api.dane.gov.pl/1.4/datasets/2627/resources'
const LICENCJA_ZABYTKI = `${LICENCJA_MSIP}; dane orientacyjne, nie przesądzają o ochronie konserwatorskiej (opis zbioru MSIP 2741)`
const NAGLOWKI = { 'User-Agent': 'adresscore-etl/1.0 (HackYeah 2026)' }

// ── CSV NID ──────────────────────────────────────────────────────────────────────────────────

/** CSV z cudzysłowami (podwojone w polu), CRLF i średnikiem; pola mogą zawierać nowe linie. */
export function csv(tekst, separator = ';') {
  const wiersze = []
  let wiersz = []
  let pole = ''
  let cytat = false
  for (let i = 0; i < tekst.length; i++) {
    const znak = tekst[i]
    if (cytat) {
      if (znak === '"' && tekst[i + 1] === '"') {
        pole += '"'
        i++
      } else if (znak === '"') cytat = false
      else pole += znak
    } else if (znak === '"') cytat = true
    else if (znak === separator) {
      wiersz.push(pole)
      pole = ''
    } else if (znak === '\n') {
      wiersz.push(pole.replace(/\r$/, ''))
      if (wiersz.some(Boolean)) wiersze.push(wiersz)
      wiersz = []
      pole = ''
    } else pole += znak
  }
  if (cytat) throw new Error('Niekompletny CSV: niedomknięty cudzysłów')
  if (pole || wiersz.length) wiersze.push([...wiersz, pole.replace(/\r$/, '')])
  return wiersze
}

const KOLUMNY_NID = [
  'INSPIRE_ID',
  'NAZWA',
  'WOJEWODZTWO',
  'POWIAT',
  'GMINA',
  'MIEJSCOWOSC',
  'ULICA',
  'NR_ADRESOWY',
]

/** Plik NID jest w windows-1250; zły dobór kodowania wychodzi na nazwie województwa. */
export const dekodujNid = (bufor) => new TextDecoder('windows-1250').decode(bufor)

/** Rekordy NID jako obiekty kolumna → wartość; błąd przy zmienionym schemacie albo kodowaniu. */
export function rekordyNid(tekst) {
  const [naglowek, ...wiersze] = csv(tekst.replace(/^﻿/, ''))
  if (!naglowek) throw new Error('Pusty CSV NID')
  const brak = KOLUMNY_NID.filter((k) => !naglowek.includes(k))
  if (brak.length) throw new Error(`Nieoczekiwany schemat CSV NID, brak kolumn: ${brak.join(', ')}`)
  if (wiersze.some((w) => w.length !== naglowek.length))
    throw new Error('Niekompletny CSV NID: niespójna liczba kolumn')
  const rekordy = wiersze.map((w) => Object.fromEntries(naglowek.map((n, i) => [n, w[i]])))
  if (!rekordy.some((r) => r.WOJEWODZTWO === 'małopolskie'))
    throw new Error('CSV NID: brak województwa „małopolskie" (zmiana kodowania pliku?)')
  return rekordy
}

/** „Wieliczka - miasto", „Skawina - obszar wiejski", „Kraków (gm. miejska)" → nazwa gminy. */
export function gminaNid(nazwa) {
  return String(nazwa ?? '')
    .replace(/\s+-\s+(miasto|obszar wiejski)$/i, '')
    .replace(/\s*\(gm\.[^)]*\)$/i, '')
    .trim()
}

/** Zasób CSV z najnowszą datą danych z odpowiedzi API dane.gov.pl dla zbioru 2627. */
export function wybierzCsvNid(zasoby) {
  const csvy = (zasoby ?? [])
    .map((z) => z.attributes)
    .filter((a) => a?.format === 'csv' && a.download_url)
  if (!csvy.length) throw new Error('NID: w zbiorze 2627 nie ma zasobu CSV')
  csvy.sort((a, b) => String(b.data_date).localeCompare(String(a.data_date)))
  const { download_url: url, data_date: dataDanych } = csvy[0]
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dataDanych ?? '')) throw new Error('NID: brak daty danych zasobu')
  return { url, dataDanych }
}

// ── Lokalizacja rekordów NID po adresie ──────────────────────────────────────────────────────

/** Mała litera, bez znaków diakrytycznych, bez interpunkcji: „Św. Jana" = „sw jana". */
export const norm = (s) =>
  String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ł/g, 'l')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

const nrNorm = (s) =>
  String(s ?? '')
    .toLowerCase()
    .replace(/\s+/g, '')
const klucz = (gmina, miejscowosc, ulica, nr) =>
  `${norm(gmina)}|${norm(miejscowosc)}|${norm(ulica)}|${nrNorm(nr)}`

/** Najwyższy rozrzut punktów jednego adresu PRG, przy którym uśredniamy; powyżej adres jest niejednoznaczny. */
const ROZRZUT_M = 200

/**
 * Zamienia rekordy NID z gmin spoza Krakowa na punkty z położeniem punktu adresowego PRG.
 * Warunek: województwo małopolskie, gmina z adresy.json, niepusty numer oraz dokładna zgodność
 * miejscowości, ulicy i numeru. Pusta ulica też się liczy, ale tylko wobec punktu PRG bez ulicy
 * (wieś bez nazw ulic): rekord „Kaszów 105" nie trafi w „Kaszów, Śląska 105". Zwraca punkty
 * i statystykę do opisu wskaźnika.
 */
export function lokalizujNid(rekordy, adresy, wojewodztwo = 'małopolskie') {
  const gminy = new Set()
  const indeks = new Map()
  for (const a of adresy) {
    if (a.teryt === TERYT_KRAKOW) continue
    gminy.add(a.gmina)
    const k = klucz(a.gmina, a.miejscowosc, a.ulica, a.nr)
    const lista = indeks.get(k)
    if (lista) lista.push(a)
    else indeks.set(k, [a])
  }
  const stat = { rekordy: 0, bezNumeru: 0, bezUlicy: 0, bezAdresuPrg: 0, niejednoznaczne: 0 }
  const punkty = []
  for (const r of rekordy) {
    if (r.WOJEWODZTWO !== wojewodztwo) continue
    const gmina = gminaNid(r.GMINA)
    if (!gminy.has(gmina)) continue
    stat.rekordy++
    if (!norm(r.ULICA)) stat.bezUlicy++
    if (!nrNorm(r.NR_ADRESOWY)) {
      stat.bezNumeru++
      continue
    }
    const trafienia = indeks.get(klucz(gmina, r.MIEJSCOWOSC, r.ULICA, r.NR_ADRESOWY))
    if (!trafienia) {
      stat.bezAdresuPrg++
      continue
    }
    const lat = trafienia.reduce((s, a) => s + a.lat, 0) / trafienia.length
    const lon = trafienia.reduce((s, a) => s + a.lon, 0) / trafienia.length
    if (trafienia.some((a) => odlegloscMetry(lat, lon, a.lat, a.lon) > ROZRZUT_M)) {
      stat.niejednoznaczne++
      continue
    }
    punkty.push({ lon, lat, rodzaj: 'nid', gmina, id: r.INSPIRE_ID, nazwa: r.NAZWA })
  }
  return { punkty, ...stat, zlokalizowane: punkty.length }
}

// ── Wykazy MSIP (Kraków) ─────────────────────────────────────────────────────────────────────

/** Data „d.mm.rrrr" z adnotacji → ISO; zwraca najpóźniejszą z podanych albo null. */
export function najnowszaData(teksty) {
  let max = null
  for (const t of teksty)
    for (const [, d, m, r] of String(t ?? '').matchAll(/\b(\d{1,2})\.(\d{1,2})\.(\d{4})\b/g)) {
      const iso = `${r}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
      if (!max || iso > max) max = iso
    }
  return max
}

/**
 * Punkty z jednej warstwy MSIP. Pole user_nie_istnieje to wolna adnotacja: odrzucamy tylko wpisy
 * „NIE ISTNIEJE" i „BUDYNEK NIE ISTNIEJE", czyli cały rekord zniknął. Adnotacje o wyłączeniu
 * jednego budynku z zespołu dotyczą części obiektu, który nadal jest w wykazie.
 */
export function punktyMsip(geojson, rodzaj) {
  if (geojson?.type !== 'FeatureCollection' || !Array.isArray(geojson.features))
    throw new Error(`MSIP ${rodzaj}: oczekiwano FeatureCollection`)
  if (geojson.exceededTransferLimit) throw new Error(`MSIP ${rodzaj}: warstwa ucięta limitem`)
  const punkty = []
  let bezGeometrii = 0
  let nieIstnieje = 0
  for (const f of geojson.features) {
    if (/^(budynek\s+)?nie istnieje$/i.test(String(f.properties?.user_nie_istnieje ?? '').trim())) {
      nieIstnieje++
      continue
    }
    const [lon, lat] = f.geometry?.type === 'Point' ? f.geometry.coordinates : []
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
      bezGeometrii++
      continue
    }
    punkty.push({ lon, lat, rodzaj, adres: norm(f.properties?.user_adres) })
  }
  return {
    punkty,
    bezGeometrii,
    nieIstnieje,
    liczbaWszystkich: geojson.features.length,
    najnowszaAdnotacja: najnowszaData(geojson.features.map((f) => f.properties?.user_nie_istnieje)),
  }
}

/** Ewidencja i rejestr to rozłączne wykazy; pozycję o tym samym adresie i położeniu liczymy raz. */
export function scalMsip(rejestr, ewidencja) {
  const k = (p) => `${p.adres}|${p.lon.toFixed(5)}|${p.lat.toFixed(5)}`
  const wRejestrze = new Set(rejestr.map(k))
  const unikalne = ewidencja.filter((p) => !wRejestrze.has(k(p)))
  return { punkty: [...rejestr, ...unikalne], duplikaty: ewidencja.length - unikalne.length }
}

// ── Liczenie w promieniu ─────────────────────────────────────────────────────────────────────

// Liczymy płasko, w metrach EPSG:2178 (naMetry): w okolicy Krakowa skala tego układu odbiega od 1
// o kilka ppm, czyli o ułamek milimetra na 300 m. To dokładniejsze niż haversine na kuli, która
// na tej szerokości zaniża odległości wschód-zachód o ok. 0,3% (1 m na 300 m).

/** Indeksy punktów MSIP w metrach: rejestr i ewidencja osobno, żeby etykieta mogła je rozdzielić. */
export function indeksyMsip(punkty) {
  const dla = (rodzaj) =>
    indeksPunktow(punkty.filter((p) => p.rodzaj === rodzaj).map((p) => naMetry(p.lon, p.lat)))
  return { rejestr: dla('rejestr'), ewidencja: dla('ewidencja') }
}

export const indeksPunktowNid = (punkty) => indeksPunktow(punkty.map((p) => naMetry(p.lon, p.lat)))

/**
 * Wartość dla adresu. Kraków: liczba pozycji MSIP (0 to zmierzone zero). Poza Krakowem: liczba
 * zlokalizowanych pozycji NID, a przy braku trafienia null, bo brak pozycji w niepełnej ewidencji
 * nie dowodzi braku zabytków.
 */
export function wartoscAdresu(adres, msip, nid, promien = PROMIEN_M) {
  const [x, y] = naMetry(adres.lon, adres.lat)
  if (adres.teryt === TERYT_KRAKOW) {
    const rejestr = sumaWPromieniu(msip.rejestr, x, y, promien)
    const ewidencja = sumaWPromieniu(msip.ewidencja, x, y, promien)
    const razem = rejestr + ewidencja
    return {
      wartosc: razem,
      etykieta: razem ? `${rejestr} w rejestrze, ${ewidencja} w ewidencji` : null,
    }
  }
  const n = sumaWPromieniu(nid, x, y, promien)
  return n
    ? { wartosc: n, etykieta: 'co najmniej (niepełna ewidencja NID)' }
    : { wartosc: null, etykieta: null }
}

const proc = (a, b) => Math.round((100 * a) / b)
const spacje = (n) => n.toLocaleString('pl-PL')

export function opisWskaznika({ nidKrakow, msipWszystkich, nidGminy, nidZlokalizowane }) {
  return `Liczba zabytków nieruchomych (pozycji wykazów) w promieniu ${PROMIEN_M} m w linii prostej. W Krakowie to pozycje wykazów MSIP: rejestru zabytków i gminnej ewidencji zabytków (bez obiektów oznaczonych jako nieistniejące). Wykazy obejmują całe miasto, więc 0 znaczy brak pozycji w wykazach. Poza Krakowem źródłem jest ewidencja zabytków NID, która nie ma współrzędnych: lokalizujemy tylko pozycje o miejscowości, ulicy i numerze zgodnych z punktem adresowym PRG (${spacje(nidZlokalizowane)} z ${spacje(nidGminy)} w gminach obwarzanka, ${proc(nidZlokalizowane, nidGminy)}%). NID ma w samym Krakowie ${spacje(nidKrakow)} pozycji wobec ${spacje(msipWszystkich)} w MSIP (${proc(nidKrakow, msipWszystkich)}%), więc poza Krakowem wartość jest dolnym oszacowaniem, a brak pozycji w ${PROMIEN_M} m to brak danych, nie zero. Dane orientacyjne: nie przesądzają o ochronie konserwatorskiej, której zakres potwierdza konserwator zabytków. Sąsiedztwo zabytku bywa atutem okolicy i ograniczeniem (prace przy obiekcie z rejestru wymagają pozwolenia konserwatora). Nie wpływa na wynik.`
}

// ── Pobranie i zapis ─────────────────────────────────────────────────────────────────────────

const warstwaMsip = (warstwa, plik) =>
  pobierzJsonDoCache(
    `${USLUGA}/${warstwa}/query?where=1%3D1&outFields=*&returnGeometry=true&outSR=4326&f=geojson`,
    plik,
  )

async function pobierzNid() {
  const zasoby = JSON.parse(
    readFileSync(
      await pobierzDoCache(NID_ZASOBY, 'nid-zasoby.json', { headers: NAGLOWKI }),
      'utf8',
    ),
  )
  const { url, dataDanych } = wybierzCsvNid(zasoby.data)
  const plik = await pobierzDoCache(url, `nid-zen-${dataDanych}.csv`, { headers: NAGLOWKI })
  const bufor = readFileSync(plik)
  return {
    rekordy: rekordyNid(dekodujNid(bufor)),
    dataDanych,
    sha256: createHash('sha256').update(bufor).digest('hex'),
  }
}

async function main() {
  const { adresy } = wczytajAdresy()
  const rejestr = punktyMsip(await warstwaMsip(0, 'zabytki-rejestr.geojson'), 'rejestr')
  const ewidencja = punktyMsip(await warstwaMsip(1, 'zabytki-ewidencja.geojson'), 'ewidencja')
  if (rejestr.liczbaWszystkich < 1_000 || ewidencja.liczbaWszystkich < 4_000)
    throw new Error(
      `Podejrzanie krótkie wykazy MSIP: rejestr ${rejestr.liczbaWszystkich}, ewidencja ${ewidencja.liczbaWszystkich}`,
    )
  const msip = scalMsip(rejestr.punkty, ewidencja.punkty)
  const nid = await pobierzNid()
  const nidGminy = lokalizujNid(nid.rekordy, adresy)
  const nidKrakow = nid.rekordy.filter(
    (r) => r.WOJEWODZTWO === 'małopolskie' && gminaNid(r.GMINA) === 'Kraków',
  ).length
  const msipWszystkich = rejestr.liczbaWszystkich + ewidencja.liczbaWszystkich
  console.log(
    `MSIP: rejestr ${rejestr.punkty.length}/${rejestr.liczbaWszystkich} (bez geometrii ${rejestr.bezGeometrii}, nie istnieje ${rejestr.nieIstnieje}), ` +
      `ewidencja ${ewidencja.punkty.length}/${ewidencja.liczbaWszystkich} (bez geometrii ${ewidencja.bezGeometrii}, nie istnieje ${ewidencja.nieIstnieje}), duplikatów ${msip.duplikaty}`,
  )
  console.log(
    `NID ${nid.dataDanych} (sha256 ${nid.sha256.slice(0, 12)}): w Krakowie ${nidKrakow} pozycji; w gminach obwarzanka ${nidGminy.rekordy}, ` +
      `zlokalizowane ${nidGminy.zlokalizowane}, bez numeru ${nidGminy.bezNumeru}, z pustą ulicą ${nidGminy.bezUlicy}, bez zgodnego adresu w PRG ${nidGminy.bezAdresuPrg}, niejednoznaczne ${nidGminy.niejednoznaczne}`,
  )

  const indeksMsip = indeksyMsip(msip.punkty)
  const indeksNid = indeksPunktowNid(nidGminy.punkty)
  const wyniki = adresy.map((a) => wartoscAdresu(a, indeksMsip, indeksNid))
  const wartosci = wyniki.map((w) => w.wartosc)

  const krakow = wartosci
    .filter((w, i) => adresy[i].teryt === TERYT_KRAKOW && w !== null)
    .sort((a, b) => a - b)
  const kwantyl = (p) => krakow[Math.min(krakow.length - 1, Math.floor(p * krakow.length))]
  const maksKrakow = krakow[krakow.length - 1]
  console.log(
    `Kraków: ${krakow.length} adresów, z ≥1 pozycją ${krakow.filter((w) => w > 0).length}; mediana ${kwantyl(0.5)}, p90 ${kwantyl(0.9)}, p99 ${kwantyl(0.99)}, maks ${maksKrakow}`,
  )
  const poza = adresy
    .map((a, i) => (a.teryt !== TERYT_KRAKOW && wartosci[i] !== null ? a.gmina : null))
    .filter(Boolean)
  const wGminach = new Map()
  for (const g of poza) wGminach.set(g, (wGminach.get(g) ?? 0) + 1)
  console.log(
    `Poza Krakowem: ${poza.length} adresów z wartością (${[...wGminach.entries()].map(([g, n]) => `${g} ${n}`).join(', ')})`,
  )

  const pobrano = dzis()
  const stanMsip = (w) => w.najnowszaAdnotacja ?? String(new Date().getFullYear())
  zapiszWskaznik(
    {
      id: 'zabytki_300m',
      kategoria: 'kontekst',
      nazwa: 'Zabytki w promieniu 300 m',
      opis: opisWskaznika({
        nidKrakow,
        msipWszystkich,
        nidGminy: nidGminy.rekordy,
        nidZlokalizowane: nidGminy.zlokalizowane,
      }),
      jednostka: 'szt.',
      kierunek: 'neutralny',
      rozdzielczosc: 'adres',
      rozmiar: `promień ${PROMIEN_M} m`,
      zakres: [0, Math.ceil(kwantyl(0.999) / 10) * 10],
      zadanie: 125,
      zrodla: [
        {
          nazwa: `${ATRYBUCJA_MSIP} – Obiekty w Rejestrze Zabytków (stan wg najnowszej adnotacji w danych)`,
          url: `${USLUGA}/0`,
          licencja: LICENCJA_ZABYTKI,
          dataDanych: stanMsip(rejestr),
          pobrano,
        },
        {
          nazwa: `${ATRYBUCJA_MSIP} – Obiekty w Gminnej Ewidencji Zabytków (stan wg najnowszej adnotacji w danych)`,
          url: 'https://msip.krakow.pl/dataset/2741',
          licencja: LICENCJA_ZABYTKI,
          dataDanych: stanMsip(ewidencja),
          pobrano,
        },
        {
          nazwa:
            'Narodowy Instytut Dziedzictwa – Ewidencja zabytków nieruchomych (dane.gov.pl, zbiór 2627), przetworzono: dopasowanie adresów do PRG',
          url: NID_ZBIOR,
          licencja: 'CC BY 4.0',
          dataDanych: nid.dataDanych,
          pobrano,
        },
      ],
    },
    wartosci,
    wyniki.map((w) => w.etykieta),
  )

  // Kontrola na znanych miejscach: Stare Miasto i Kazimierz gęsto, peryferie rzadko.
  const kontrola = [
    ['Kraków', 'Rynek Główny'],
    ['Kraków', 'Floriańska'],
    ['Kraków', 'Szeroka'],
    ['Kraków', 'Osiedle Teatralne'],
    ['Wieliczka', 'Rynek Górny'],
    ['Niepołomice', 'Rynek'],
  ]
  for (const [miejscowosc, ulica] of kontrola) {
    const i = adresy.findIndex((a) => a.miejscowosc === miejscowosc && a.ulica === ulica)
    console.log(
      `Kontrola ${miejscowosc}, ${ulica} ${i < 0 ? '(brak adresu w PRG)' : `${adresy[i].nr}: ${wartosci[i]}${wyniki[i].etykieta ? ` – ${wyniki[i].etykieta}` : ''}`}`,
    )
  }
  const zero = adresy.findIndex((a, i) => a.teryt === TERYT_KRAKOW && wartosci[i] === 0)
  if (zero >= 0)
    console.log(
      `Kontrola adres z zerem: ${adresy[zero].miejscowosc}, ${adresy[zero].ulica ?? ''} ${adresy[zero].nr} (${adresy[zero].dzielnica})`,
    )
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1])
  main().catch((blad) => {
    console.error(blad)
    process.exitCode = 1
  })
