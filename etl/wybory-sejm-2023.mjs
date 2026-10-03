// Oficjalne, zagregowane wyniki PKW/KBW do Sejmu 2023, na poziomie gminy.
// node etl/wybory-sejm-2023.mjs
import { readFileSync } from 'node:fs'
import { unzipSync } from 'fflate'
import { dzis, pobierzDoCache, wczytajAdresy, zapiszWskaznik } from './lib/wspolne.mjs'

const BAZA = 'https://danewyborcze.kbw.gov.pl/dane/2023/sejmsenat'
const STRONA = 'https://danewyborcze.kbw.gov.pl/indexc6e4.html?title=Parlament_2023'
const PLIKI = {
  wyniki: 'wyniki_gl_na_listy_po_gminach_sejm_csv.zip',
  listy: 'wykaz_list_sejm_csv.zip',
}

export function csv(tekst) {
  const wiersze = []
  let wiersz = []
  let pole = ''
  let cytat = false
  for (let i = 0; i < tekst.length; i++) {
    const znak = tekst[i]
    if (znak === '"') {
      if (cytat && tekst[i + 1] === '"') {
        pole += '"'
        i++
      } else cytat = !cytat
    } else if (znak === ';' && !cytat) {
      wiersz.push(pole)
      pole = ''
    } else if ((znak === '\n' || znak === '\r') && !cytat) {
      if (znak === '\r' && tekst[i + 1] === '\n') i++
      wiersz.push(pole)
      if (wiersz.some(Boolean)) wiersze.push(wiersz)
      wiersz = []
      pole = ''
    } else pole += znak
  }
  if (cytat) throw new Error('Niezamknięte pole CSV')
  if (pole || wiersz.length) {
    wiersz.push(pole)
    wiersze.push(wiersz)
  }
  return wiersze
}

function liczba(tekst) {
  if (!/^\d+$/.test(tekst)) throw new Error(`Niepoprawna liczba głosów: ${tekst}`)
  return Number(tekst)
}

function czytajZip(sciezka) {
  const pliki = unzipSync(readFileSync(sciezka))
  const csvPlik = Object.entries(pliki).find(([nazwa]) => nazwa.endsWith('.csv'))
  if (!csvPlik) throw new Error(`Brak CSV w ${sciezka}`)
  return csv(new TextDecoder().decode(csvPlik[1]).replace(/^\uFEFF/, ''))
}

export function zbudujDane(wyniki, listy, adresy) {
  const [naglowek, ...wiersze] = wyniki
  const [naglowekList, ...wierszeList] = listy
  const indeks = (nazwa) => {
    const i = naglowek.indexOf(nazwa)
    if (i < 0) throw new Error(`Brak kolumny: ${nazwa}`)
    return i
  }
  if (naglowekList?.[0] !== 'Numer okręgu' || naglowekList?.[1] !== 'Nr listy')
    throw new Error('Nieznany format wykazu list')
  const iTeryt = indeks('TERYT Gminy')
  const iGmina = indeks('Gmina')
  const iOkreg = indeks('Nr okręgu')
  const iWazne = indeks('Liczba głosów ważnych oddanych łącznie na wszystkie listy kandydatów')
  const komitety = naglowek.slice(iWazne + 1).filter(Boolean)
  const numerListy = new Map()
  for (const w of wierszeList) numerListy.set(`${w[0]}|${w[2]}`, Number(w[1]))
  const poGminie = new Map()
  for (const w of wiersze) {
    const teryt = w[iTeryt]
    if (!teryt || !/^\d{6}$/.test(teryt)) continue // zagranica, statki
    const okreg = w[iOkreg]
    const wazne = liczba(w[iWazne])
    const glosy = komitety.map((_, k) => liczba(w[iWazne + 1 + k] || '0'))
    const suma = glosy.reduce((a, b) => a + b, 0)
    if (suma !== wazne) throw new Error(`${teryt}: suma list ${suma} ≠ głosy ważne ${wazne}`)
    if (poGminie.has(teryt)) throw new Error(`Niejednoznaczna gmina ${teryt}`)
    poGminie.set(teryt, { teryt, gmina: w[iGmina], okreg, wazne, glosy })
  }
  const teryty = new Set(adresy.map((a) => a.teryt.slice(0, 6)))
  for (const teryt of teryty) if (!poGminie.has(teryt)) throw new Error(`Brak gminy ${teryt} w PKW`)
  const lokalne = [...teryty].map((t) => poGminie.get(t))
  for (const { okreg } of lokalne)
    for (let k = 0; k < komitety.length; k++) {
      if (
        komitety[k] &&
        !numerListy.has(`${okreg}|${komitety[k]}`) &&
        lokalne.some((r) => r.okreg === okreg && r.glosy[k] > 0)
      )
        throw new Error(`Brak numeru listy dla ${komitety[k]} w okręgu ${okreg}`)
    }
  return { komitety, poGminie, numerListy }
}

export async function uruchom() {
  const [plikWynikow, plikList] = await Promise.all(
    Object.values(PLIKI).map((nazwa) => pobierzDoCache(`${BAZA}/${nazwa}`, nazwa)),
  )
  const { adresy } = wczytajAdresy()
  const { komitety, poGminie, numerListy } = zbudujDane(
    czytajZip(plikWynikow),
    czytajZip(plikList),
    adresy,
  )
  const uzyte = new Set(adresy.map((a) => a.teryt.slice(0, 6)))
  console.log(`PKW: ${uzyte.size} gmin, ${adresy.length} adresów, ${komitety.length} komitetów`)
  for (let k = 0; k < komitety.length; k++) {
    if (
      ![...uzyte].some((t) => {
        const r = poGminie.get(t)
        return numerListy.has(`${r.okreg}|${komitety[k]}`)
      })
    )
      continue
    const nazwa = komitety[k]
    const id = `sejm2023_lista_${k + 1}`
    const wartosci = []
    const etykiety = []
    const slownikEtykiet = {}
    for (const a of adresy) {
      const r = poGminie.get(a.teryt.slice(0, 6))
      const numer = numerListy.get(`${r.okreg}|${nazwa}`)
      const glosy = r.glosy[k]
      const dostepny = Number.isInteger(numer) && r.wazne > 0
      wartosci.push(dostepny ? (100 * glosy) / r.wazne : null)
      const max = Math.max(...r.glosy)
      const zwyciezcy = r.glosy.flatMap((v, i) => (v === max ? [komitety[i]] : []))
      if (dostepny && !slownikEtykiet[r.teryt])
        slownikEtykiet[r.teryt] =
          `Gmina ${r.gmina} (TERYT ${r.teryt}), okręg sejmowy nr ${r.okreg}; lista nr ${numer}: ${glosy.toLocaleString('pl-PL')} z ${r.wazne.toLocaleString('pl-PL')} głosów ważnych. Najwięcej głosów: ${zwyciezcy.join(' / ')}. Wynik gminy, nie adresu.`
      etykiety.push(dostepny ? r.teryt : null)
    }
    zapiszWskaznik(
      {
        id,
        kategoria: 'kontekst',
        nazwa: `Sejm 2023 · ${nazwa}`,
        jednostka: '%',
        opis: `Udział głosów ważnych na ${nazwa} w wyborach do Sejmu 15.10.2023, w gminie adresu. To historyczny wynik gminy, nie preferencje mieszkańców adresu.`,
        kierunek: 'neutralny',
        rozdzielczosc: 'gmina',
        rozmiar: 'gmina',
        zakres: [0, 100],
        zadanie: 134,
        zrodla: [
          {
            nazwa: 'PKW / Krajowe Biuro Wyborcze',
            url: STRONA,
            licencja: 'Dane urzędowe; na stronie zbioru nie wskazano odrębnej licencji',
            dataDanych: '2023-10-15',
            pobrano: dzis(),
          },
        ],
      },
      wartosci,
      etykiety,
      slownikEtykiet,
    )
  }
}

if (process.argv[1]?.endsWith('wybory-sejm-2023.mjs')) await uruchom()
