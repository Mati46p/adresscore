// Kontrola warstwy powietrze (zadanie #7): model GIOŚ w oczku stacji kontra roczna średnia stacji.
//
// Źródło stacji: API GIOŚ (archiwalne wyniki pomiarów), https://api.gios.gov.pl/pjp-api/v1/rest/
//   Licencja i wymagane wskazanie źródła: „Źródło danych: GIOŚ - EKOINFONET". Dane przetworzone:
//   średnia arytmetyczna ważnych wyników za rok, minimum 75% pokrycia.
// Stacje NIE trafiają do wskaźników. Skrypt tylko porównuje i wypisuje tabelę (plus
//   etl/.cache/powietrze_kontrola.json). Wartości adresów liczy etl/powietrze.mjs.
// Uruchom: node etl/powietrze-kontrola.mjs (wolno: limit API to ok. 2 zapytania na minutę
//   dla archiwum, drugi bieg bierze dane z cache). Miasto: pierwszy argument, domyślnie Kraków.
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  bboxAdresow,
  doPuwg,
  indeksOczek,
  jsonZCache,
  pobierzOczka,
  WSKAZNIKI,
  znajdzRok,
} from './lib/powietrze.mjs'
import { CACHE } from './lib/wspolne.mjs'

const API = 'https://api.gios.gov.pl/pjp-api/v1/rest'
const miasto = process.argv[2] ?? 'Kraków'
const czekaj = (ms) => new Promise((r) => setTimeout(r, ms))

async function api(sciezka) {
  for (let p = 1; ; p++) {
    try {
      const r = await fetch(sciezka.startsWith('http') ? sciezka : `${API}/${sciezka}`, {
        signal: AbortSignal.timeout(120_000),
      })
      if (r.status === 429) throw new Error('429')
      if (!r.ok) throw new Error(`${r.status}`)
      return await r.json()
    } catch (e) {
      if (p >= 6) throw new Error(`${sciezka}: ${e.message}`)
      await czekaj(15_000 * p)
    }
  }
}

const KODY = { 'PM2.5': 'PM2.5', PM10: 'PM10', NO2: 'NO2', BaP: 'BaP(PM10)' }
const { rok, warstwy } = await znajdzRok()

const wszystkie = await jsonZCache('gios_stacje.json', () => api('station/findAll?size=500'))
const stacje = wszystkie['Lista stacji pomiarowych'].filter((s) => s['Nazwa miasta'] === miasto)
console.log(`Stacje GIOŚ (${miasto}): ${stacje.length}, rok ${rok}`)

async function sredniaRoczna(idStanowiska) {
  return jsonZCache(`gios_stanowisko_${idStanowiska}_${rok}.json`, async () => {
    const baza = `archivalData/getDataBySensor/${idStanowiska}?size=2000&dateFrom=${rok}-01-01%2001:00&dateTo=${Number(rok) + 1}-01-01%2000:00`
    let n = 0
    let suma = 0
    let wszystkich = 0
    let kod = null
    let stron = 1
    for (let strona = 0; strona < stron; strona++) {
      const d = await api(`${baza}&page=${strona}`)
      stron = d.totalPages ?? 1
      console.error(`stanowisko ${idStanowiska}: strona ${strona + 1}/${stron}`)
      for (const w of d['Lista archiwalnych wyników pomiarów'] ?? []) {
        wszystkich++
        kod ??= w['Kod stanowiska']
        if (typeof w['Wartość'] === 'number') {
          n++
          suma += w['Wartość']
        }
      }
      await czekaj(1500)
    }
    return { kod, n, wszystkich, srednia: n ? suma / n : null }
  })
}

// Model w oczkach stacji: jeden prostokąt obejmujący wszystkie stacje wystarcza.
const pkt = stacje.map((s) => doPuwg(Number(s['WGS84 λ E']), Number(s['WGS84 φ N'])))
const bbox = bboxAdresow(
  stacje.map((s) => ({ lon: Number(s['WGS84 λ E']), lat: Number(s['WGS84 φ N']) })),
  0.02,
)
const model = {}
for (const [w, id] of Object.entries(warstwy))
  model[w] = indeksOczek(await pobierzOczka(rok, w, id, bbox))

const wiersze = []
for (const [i, s] of stacje.entries()) {
  const stanowiska = (await api(`station/sensors/${s['Identyfikator stacji']}`))[
    'Lista stanowisk pomiarowych dla podanej stacji'
  ]
  await czekaj(1500)
  for (const w of Object.keys(WSKAZNIKI)) {
    for (const st of stanowiska.filter((x) => x['Wskaźnik - kod'] === KODY[w])) {
      const dane = await sredniaRoczna(st['Identyfikator stanowiska'])
      const o = model[w](pkt[i][0], pkt[i][1])
      wiersze.push({
        stacja: s['Nazwa stacji'],
        wskaznik: w,
        stanowisko: dane.kod,
        stacjaSrednia: dane.srednia,
        pokrycie: dane.wszystkich ? dane.n / dane.wszystkich : 0,
        n: dane.n,
        model: o?.v ?? null,
        oczko: o ? `${Math.round(o.x1 - o.x0)}×${Math.round(o.y1 - o.y0)} m` : null,
      })
    }
  }
}

const jednostka = (w) => (w === 'BaP' ? 'ng/m³' : 'µg/m³')
for (const w of Object.keys(WSKAZNIKI)) {
  console.log(`\n${w} (${jednostka(w)}), rok ${rok}`)
  console.log('stacja | stanowisko | stacja | model | różnica (model - stacja) | liczba wyników')
  const r = []
  for (const x of wiersze.filter((x) => x.wskaznik === w)) {
    const ok = x.stacjaSrednia !== null && x.model !== null && x.pokrycie >= 0.75
    const roznica = ok ? x.model - x.stacjaSrednia : null
    if (ok) r.push(roznica)
    console.log(
      `${x.stacja} | ${x.stanowisko} | ${x.stacjaSrednia?.toFixed(2) ?? '-'} | ${x.model ?? '-'} | ${roznica?.toFixed(2) ?? '-'}${x.pokrycie < 0.75 ? ' (pokrycie < 75%, pomijam)' : ''} | ${x.n}`,
    )
  }
  if (r.length) {
    const srednia = r.reduce((a, b) => a + b, 0) / r.length
    const mae = r.reduce((a, b) => a + Math.abs(b), 0) / r.length
    console.log(
      `porównań ${r.length}, średnia różnica ${srednia.toFixed(2)}, średni błąd bezwzględny ${mae.toFixed(2)}`,
    )
  }
}
writeFileSync(
  join(CACHE, 'powietrze_kontrola.json'),
  JSON.stringify({ rok, miasto, wiersze }, null, 1),
)
