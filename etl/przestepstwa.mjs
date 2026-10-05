// Przestępstwa stwierdzone przez Policję – rejon (powiat Policji), nigdy adres.
// Uruchom: node etl/przestepstwa.mjs. Odpowiedzi BDL trafiają do etl/.cache/.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { bdlPowiaty, MIASTA } from './lib/miasta.mjs'
import {
  DANE,
  dzis,
  MIASTO,
  pobierzDoCache,
  wczytajAdresy,
  zapiszWskaznik,
} from './lib/wspolne.mjs'
import { PRZENIESIONE } from './uprosc-kryteria.mjs'

export const ROK = 2025
const BDL_API = 'https://bdl.stat.gov.pl/api/v1/data/by-variable'
const BDL_STRONA = 'https://bdl.stat.gov.pl/bdl/dane/podgrup/temat'
// P4601 „Przestępstwa stwierdzone … wg powiatów (dane kwartalne) od 2025”, P4633 „Przestępstwa – wskaźniki”.
export const ZMIENNE = {
  na1000: 1752907, // przestępstwa stwierdzone przez Policję na 1000 mieszkańców (rok)
  liczba: 1749155, // rok | przestępstwa stwierdzone | ogółem
  wykrywalnosc: 1749170, // rok | wskaźnik wykrywalności sprawców | ogółem (%)
}
// TERYT powiatu (4 cyfry) → jednostka BDL poziomu 5 i jej nazwa w BDL.
export const POWIATY = {
  1261: { bdl: '011212161000', nazwa: 'Powiat m. Kraków', jednostka: 'KMP w Krakowie' },
  1206: { bdl: '011212006000', nazwa: 'Powiat krakowski', jednostka: 'KMP w Krakowie' },
  1219: { bdl: '011212019000', nazwa: 'Powiat wielicki', jednostka: 'KPP w Wieliczce' },
  1214: { bdl: '011212014000', nazwa: 'Powiat proszowicki', jednostka: 'KPP w Proszowicach' },
}

// Dla ADRESCORE_MIASTO: powiat miasta na prawach powiatu (jedna jednostka BDL, jedno zapytanie unit-id).
export const POWIATY_MIAST = Object.fromEntries(
  Object.values(MIASTA).map((m) => [
    m.teryt4,
    { bdl: m.bdl, nazwa: m.bdlNazwa, jednostka: `KMP/KPP ${m.nazwa}` },
  ]),
)
const AKTYWNE = MIASTO ? POWIATY_MIAST : POWIATY

// Rejony komisariatów KMP Kraków wg stron „Obsługiwana dzielnica” (stan 2026-10-03).
const KP = (n, id) =>
  `https://krakow.policja.gov.pl/kr1/wolnytekst/${id},Komisariat-Policji-${n}-w-Krakowie.html`
export const KOMISARIATY = [
  { id: 'KP I', dzielnice: ['I'], url: KP('I', 1310) },
  { id: 'KP II', dzielnice: ['II'], url: KP('II', 1311) },
  { id: 'KP III', dzielnice: ['III', 'IV'], url: KP('III', 1312) },
  { id: 'KP IV', dzielnice: ['V', 'VI', 'VII'], url: KP('IV', 1313) },
  { id: 'KP V', dzielnice: ['VIII', 'IX', 'XIII'], url: KP('V', 1314) },
  { id: 'KP VI', dzielnice: ['X', 'XI', 'XII'], url: KP('VI', 1315) },
  { id: 'KP VII', dzielnice: ['XV', 'XVI', 'XVII'], url: KP('VII', 1316) },
  { id: 'KP VIII', dzielnice: ['XIV', 'XVIII'], url: KP('VIII', 1317) },
]

/** Komisariat dla nazwy dzielnicy z adresów („XIII Podgórze”) albo null. */
export function komisariatDzielnicy(dzielnica) {
  const rzymska = /^([IVXL]+)\s/.exec(dzielnica ?? '')?.[1]
  if (!rzymska) return null
  return KOMISARIATY.find((k) => k.dzielnice.includes(rzymska))?.id ?? null
}

/** Wartość roku z odpowiedzi BDL by-variable; sprawdza nazwę jednostki. Brak = null. */
export function wartoscBdl(odpowiedz, jednostka, nazwa, rok = ROK) {
  const r = odpowiedz.results?.find((x) => x.id === jednostka)
  if (!r) return null
  if (r.name !== nazwa) throw new Error(`BDL ${jednostka}: oczekiwano „${nazwa}”, jest „${r.name}”`)
  const v = r.values?.find((x) => String(x.year) === String(rok))?.val
  return Number.isFinite(v) ? v : null
}

export function powiatAdresu(teryt) {
  if (!/^\d{7}$/.test(teryt ?? '')) throw new Error(`Niepoprawny TERYT adresu: ${teryt}`)
  return AKTYWNE[teryt.slice(0, 4)] ? teryt.slice(0, 4) : null
}

const urlZmiennej = (id) =>
  `${BDL_API}/${id}?unit-parent-id=011200000000&unit-level=5&year=${ROK}&format=json&lang=pl&page-size=100`

/**
 * Grupa i kierunek warstwy z PRZENIESIONE (etl/uprosc-kryteria.mjs, #171). Importujemy, a nie
 * kopiujemy: inaczej ponowny bieg tego ETL cofałby integrację (warstwa wracałaby do „kontekstu”),
 * a test z przestepstwa.test.mjs wykrywałby to dopiero po fakcie.
 */
export function grupa(id) {
  const g = PRZENIESIONE[id]
  if (!g) throw new Error(`Brak ${id} w PRZENIESIONE (etl/uprosc-kryteria.mjs) – dopisz grupę`)
  return { kategoria: g[0], kierunek: g[1] }
}

async function main() {
  const { wersja, adresy } = wczytajAdresy()
  const odp = {}
  for (const [k, id] of Object.entries(ZMIENNE)) {
    if (MIASTO) {
      odp[k] = await bdlPowiaty(id, ROK, pobierzDoCache)
      continue
    }
    const p = await pobierzDoCache(urlZmiennej(id), `bdl-${id}-${ROK}.json`)
    odp[k] = JSON.parse(readFileSync(p, 'utf8'))
  }
  const powiaty = Object.fromEntries(
    Object.entries(AKTYWNE).map(([t, p]) => [
      t,
      {
        ...p,
        teryt: t,
        liczba: wartoscBdl(odp.liczba, p.bdl, p.nazwa),
        na1000: wartoscBdl(odp.na1000, p.bdl, p.nazwa),
        wykrywalnosc: wartoscBdl(odp.wykrywalnosc, p.bdl, p.nazwa),
        adresow: 0,
      },
    ]),
  )
  const komisariaty = Object.fromEntries(KOMISARIATY.map((k) => [k.id, { ...k, adresow: 0 }]))
  const bezKp = new Set()
  for (const a of adresy) {
    const t = powiatAdresu(a.teryt)
    if (t) powiaty[t].adresow++
    if (a.teryt === '1261011') {
      const kp = komisariatDzielnicy(a.dzielnica)
      if (kp) komisariaty[kp].adresow++
      else bezKp.add(a.dzielnica)
    }
  }
  if (bezKp.size) throw new Error(`Dzielnice bez komisariatu: ${[...bezKp].join(', ')}`)

  const pobrano = dzis()
  const zrodlo = (opis, id) => ({
    nazwa: `GUS, Bank Danych Lokalnych (dane Policji) – ${opis}, ${ROK} r., zmienna ${id}`,
    url: urlZmiennej(id).replace(`&year=${ROK}`, ''),
    licencja: 'Dane publiczne GUS; wskazanie źródła, warunki u wydawcy',
    dataDanych: String(ROK),
    pobrano,
  })
  const zastrzezenie =
    'Wartość dotyczy całego powiatu (rejonu KMP/KPP) i jest powtórzona przy każdym adresie powiatu – nie opisuje ulicy ani osiedla. Licznik obejmuje przestępstwa stwierdzone w miejscu popełnienia, także wobec przyjezdnych, a mianownikiem są stali mieszkańcy, więc miasto centralne wypada gorzej niż gminy podmiejskie. '
  const wartosci = (pole) =>
    adresy.map((a) => {
      const t = powiatAdresu(a.teryt)
      return t ? powiaty[t][pole] : null
    })
  const idPrzestepstw = `przestepstwa_1000_powiat_${ROK}`
  const idWykrywalnosci = `wykrywalnosc_powiat_${ROK}`
  // Opisy poniżej mają dwa nieaktualne zdania: „BIP Krakowa niedostępny z ETL” (BIP jest osiągalny,
  // liczb per komisariat po prostu nie publikuje – patrz uwaga niżej i przestepstwa.md) oraz
  // „nie wpływa na wynik” (od #171 waga startowa 0, więc użytkownik może ją podnieść). Zostają
  // celowo: zmiana meta.opis unieważnia kompakt (niezgodnoscKompaktu: „inna meta”), a ten
  // przebudowuje się osobno. Popraw je przy najbliższym przebudowaniu kompaktu.
  zapiszWskaznik(
    {
      id: idPrzestepstw,
      nazwa: `Przestępstwa stwierdzone na 1000 mieszkańców (powiat, ${ROK})`,
      opis: MIASTO
        ? `${zastrzezenie}Dane per komisariat nie są publikowane w BDL, dlatego całe miasto ma jedną wartość. Wskaźnik informacyjny.`
        : `${zastrzezenie}Dane per rejon komisariatu KMP Kraków nie są jeszcze dostępne (BIP Krakowa niedostępny z ETL), dlatego cały Kraków ma jedną wartość. Wskaźnik informacyjny – nie wpływa na wynik adresu.`,
      jednostka: 'na 1000 mieszkańców',
      ...grupa(idPrzestepstw),
      rozdzielczosc: 'rejon',
      zadanie: 68,
      zrodla: [
        zrodlo('przestępstwa stwierdzone przez Policję na 1000 mieszkańców', ZMIENNE.na1000),
      ],
      domyslnaWaga: 0,
    },
    wartosci('na1000'),
  )
  zapiszWskaznik(
    {
      id: idWykrywalnosci,
      nazwa: `Wykrywalność sprawców przestępstw (powiat, ${ROK})`,
      opis: `${zastrzezenie}Wskaźnik wykrywalności sprawców przestępstw stwierdzonych ogółem; opisuje pracę Policji w powiecie, nie ryzyko przy adresie.`,
      jednostka: '%',
      ...grupa(idWykrywalnosci),
      rozdzielczosc: 'rejon',
      zadanie: 68,
      zrodla: [
        zrodlo(
          'wskaźnik wykrywalności sprawców przestępstw stwierdzonych – ogółem',
          ZMIENNE.wykrywalnosc,
        ),
      ],
      domyslnaWaga: 0,
    },
    wartosci('wykrywalnosc'),
  )
  writeFileSync(
    join(DANE, `przestepstwa_rejony_${ROK}.json`),
    JSON.stringify({
      wersjaAdresow: wersja,
      rok: ROK,
      rozdzielczosc: 'rejon',
      pobrano,
      zrodlo: BDL_STRONA,
      powiaty: Object.values(powiaty).map(({ bdl, ...p }) => ({
        ...p,
        jednostkaBdl: bdl,
        zrodla: Object.fromEntries(Object.entries(ZMIENNE).map(([k, id]) => [k, urlZmiennej(id)])),
      })),
      komisariatyKrakow: {
        uwaga:
          'Przypisanie dzielnic do komisariatów pochodzi ze stron KMP Kraków. Liczb przestępstw per komisariat nie znaleziono w otwartych źródłach (stan 2026-10-03): Raporty o stanie Gminy 2018–2025 podają tylko sumę dla miasta, Informacja Policji dla Komisji Praworządności RMK jest w BIP wyłącznie jako protokół bez podziału na komisariaty, a BDL publikuje przestępstwa najniżej na poziomie powiatu. Wartości = null (brak danych, nie zero).',
        rejony: Object.values(komisariaty).map((k) => ({
          id: k.id,
          dzielnice: k.dzielnice,
          adresow: k.adresow,
          zrodloRejonu: k.url,
          przestepstwa: null,
          na1000: null,
        })),
      },
    }),
  )
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href)
  main().catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
