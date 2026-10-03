// Porównanie gmin Krakowa i obwarzanka na podstawie otwartych rankingów z-dykty.pl.
// Uruchom: node etl/obwarzanek.mjs. Pobrania CSV trafiają do etl/.cache/.
// Ranking z-dykty.pl jest wtórnym opracowaniem rejestrów publicznych. Licencja
// opracowań CC BY 4.0: https://z-dykty.pl/dane. Metryki pozostają neutralnym
// kontekstem gminnym i nigdy nie są oceną adresu ani ryzyka konkretnej działki.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DANE, dzis, pobierzDoCache, wczytajAdresy, zapiszWskaznik } from './lib/wspolne.mjs'

export const MIARY = [
  {
    slug: 'dlug_pc',
    id: 'gmina_dlug_pc',
    nazwa: 'Dług gminy na mieszkańca',
    opis: 'Zobowiązania gminy na mieszkańca w rocznym zestawieniu. Miara finansów całej gminy, nie długu gospodarstwa domowego ani ocena miejsca zamieszkania.',
    jednostka: 'zł/os.',
    csvJednostka: 'zl',
    pierwotne: {
      nazwa: 'Ministerstwo Finansów – sprawozdania budżetowe JST',
      url: 'https://dane.gov.pl/pl/dataset/872',
    },
  },
  {
    slug: 'wydatki_inwest_pc',
    id: 'gmina_inwestycje_pc',
    nazwa: 'Wydatki inwestycyjne gminy na mieszkańca',
    opis: 'Roczne wydatki inwestycyjne na mieszkańca według Banku Danych Lokalnych. Wartość budżetowa gminy, bez przypisywania inwestycji do sąsiedztwa adresu.',
    jednostka: 'zł/os.',
    csvJednostka: 'zl',
    pierwotne: {
      nazwa: 'GUS – Bank Danych Lokalnych, wydatki inwestycyjne (licznik miary na mieszkańca)',
      url: 'https://bdl.stat.gov.pl/api/v1/data/by-variable/76450?unit-level=6',
    },
  },
  {
    slug: 'mpzp_pokrycie_pct',
    id: 'gmina_mpzp_pokrycie_pct',
    nazwa: 'Udział powierzchni gminy objęty MPZP',
    opis: 'Opublikowany odsetek powierzchni całej gminy objętej planami miejscowymi według GUS BDL. W źródle niektóre wartości przekraczają 100%; zachowujemy je bez korekty. Miara nie mówi, czy plan obejmuje wybrany adres; dla Krakowa służy do tego osobna warstwa MPZP.',
    jednostka: '%',
    csvJednostka: 'proc',
    pierwotne: {
      nazwa: 'GUS – Bank Danych Lokalnych',
      url: 'https://bdl.stat.gov.pl/api/v1/data/by-variable/396046?unit-level=6',
    },
  },
  {
    slug: 'powodz_pct',
    id: 'gmina_powodz_powierzchnia_pct',
    nazwa: 'Udział powierzchni gminy w strefie zalewowej',
    opis: 'Odsetek powierzchni całej gminy w strefie zalewowej według opracowania z-dykty na podstawie danych Wód Polskich. Nie określa zagrożenia wybranego adresu ani prawdopodobieństwa powodzi.',
    jednostka: '%',
    csvJednostka: 'proc',
    pierwotne: {
      nazwa: 'Wody Polskie – mapy zagrożenia powodziowego ISOK',
      url: 'https://wody.isok.gov.pl/imap_kzgw/',
    },
  },
]

export function parsujRanking(csv, oczekiwanaJednostka) {
  const [naglowek, ...wiersze] = csv
    .replace(/^\uFEFF/, '')
    .trim()
    .split(/\r?\n/)
  const pola = naglowek.split(';')
  const wymagane = ['gmina', 'teryt', 'wartosc', 'jednostka', 'rok', 'url']
  if (wymagane.some((p) => !pola.includes(p))) throw new Error('Nieznany schemat CSV rankingu')
  const wynik = new Map()
  for (const wiersz of wiersze) {
    const wartosci = wiersz.split(';')
    if (wartosci.length !== pola.length) throw new Error(`Niepoprawny wiersz CSV: ${wiersz}`)
    const r = Object.fromEntries(pola.map((p, i) => [p, wartosci[i]]))
    if (!/^\d{7}$/.test(r.teryt)) throw new Error(`Niepoprawny TERYT: ${r.teryt}`)
    if (wynik.has(r.teryt)) throw new Error(`Powtórzony TERYT: ${r.teryt}`)
    if (r.jednostka !== oczekiwanaJednostka)
      throw new Error(`Nieoczekiwana jednostka: ${r.jednostka}`)
    if (!r.wartosc.trim()) throw new Error(`Pusta wartość w CSV: ${wiersz}`)
    const liczba = Number(r.wartosc.replace(',', '.'))
    const rok = Number(r.rok)
    if (!Number.isFinite(liczba) || !Number.isInteger(rok) || rok < 2000 || rok > 2100)
      throw new Error(`Niepoprawna wartość lub rok: ${wiersz}`)
    if (!r.url.startsWith('https://z-dykty.pl/gmina/'))
      throw new Error(`Nieznany adres gminy: ${r.url}`)
    wynik.set(r.teryt, { nazwa: r.gmina, wartosc: liczba, rok, url: r.url })
  }
  return wynik
}

export function dopasujGminy(adresy, ranking) {
  const gminy = new Map()
  for (const a of adresy) {
    const g = gminy.get(a.teryt)
    if (g && g.nazwa !== a.gmina) throw new Error(`Niespójna nazwa TERYT ${a.teryt}`)
    if (!g) gminy.set(a.teryt, { nazwa: a.gmina, adresow: 0 })
    gminy.get(a.teryt).adresow++
  }
  for (const [teryt, g] of gminy) {
    const r = ranking.get(teryt)
    if (r && r.nazwa !== g.nazwa)
      throw new Error(`Nazwa gminy ${teryt}: adresy=${g.nazwa}, ranking=${r.nazwa}`)
  }
  return gminy
}

async function main() {
  const { wersja, adresy } = wczytajAdresy()
  const pobrano = dzis()
  const gminy = dopasujGminy(adresy, new Map())
  if (gminy.size !== 14 || !gminy.has('1261011'))
    throw new Error(`Oczekiwano Krakowa i 13 gmin, jest ${gminy.size}`)
  const porownanie = {
    wersjaAdresow: wersja,
    opis: 'Wartości dotyczą całej gminy. Nie opisują warunków przy konkretnym adresie ani kierunku zmiany okolicy.',
    zrodlo: 'https://z-dykty.pl/dane',
    licencja: 'Opracowania z-dykty.pl: CC BY 4.0 – https://creativecommons.org/licenses/by/4.0/',
    pobrano,
    miary: MIARY.map(({ id, nazwa, jednostka }) => ({ id, nazwa, jednostka })),
    gminy: [...gminy].map(([teryt, g]) => ({
      teryt,
      nazwa: g.nazwa,
      adresow: g.adresow,
      miary: {},
    })),
  }
  const gminaPoTeryt = new Map(porownanie.gminy.map((g) => [g.teryt, g]))

  for (const m of MIARY) {
    const url = `https://z-dykty.pl/dane/rankingi/${m.slug}/csv`
    const sciezka = await pobierzDoCache(url, `z-dykty-${m.slug}.csv`)
    const ranking = parsujRanking(readFileSync(sciezka, 'utf8'), m.csvJednostka)
    dopasujGminy(adresy, ranking)
    const lata = new Set()
    for (const [teryt, g] of gminaPoTeryt) {
      const r = ranking.get(teryt)
      g.miary[m.id] = r
        ? { wartosc: r.wartosc, rok: r.rok, url: r.url, zrodloPierwotne: m.pierwotne.url }
        : null
      if (r) lata.add(r.rok)
    }
    if (!lata.size) throw new Error(`Brak danych dla 14 gmin: ${m.slug}`)
    const roczniki = [...lata].sort((a, b) => a - b)
    const dataDanych = `${roczniki.length === 1 ? 'rocznik' : 'roczniki'} ${roczniki.join(', ')}`
    zapiszWskaznik(
      {
        id: m.id,
        nazwa: m.nazwa,
        opis: `${m.opis} Roczniki występujące w 14 gminach: ${roczniki.join(', ')}. Źródło wtórne: z-dykty.pl; szczegół gminy i metoda: https://z-dykty.pl/metodologia`,
        jednostka: m.jednostka,
        kategoria: 'kontekst',
        kierunek: 'neutralny',
        rozdzielczosc: 'gmina',
        zadanie: 44,
        zrodla: [
          {
            nazwa: `z-dykty.pl – ${m.nazwa}`,
            url,
            licencja:
              'Opracowanie CC BY 4.0 – https://creativecommons.org/licenses/by/4.0/; atrybucja z-dykty.pl',
            dataDanych,
            pobrano,
          },
          {
            nazwa: m.pierwotne.nazwa,
            url: m.pierwotne.url,
            licencja: 'Dane źródłowe instytucji publicznej; warunki u wydawcy',
            dataDanych,
            pobrano,
          },
        ],
      },
      adresy.map((a) => ranking.get(a.teryt)?.wartosc ?? null),
    )
    console.log(
      `${m.slug}: ${ranking.size} gmin w CSV, ${gminaPoTeryt.size - [...gminaPoTeryt.keys()].filter((t) => ranking.has(t)).length} bez danych w naszym obszarze`,
    )
  }
  writeFileSync(join(DANE, 'gminy-porownanie.json'), JSON.stringify(porownanie))
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href)
  main().catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
