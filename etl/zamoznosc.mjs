// GUS BDL: dochody gmin z udziału w PIT na mieszkańca i przeciętne wynagrodzenie w powiecie.
// Uruchom po etl/obwarzanek.mjs: node etl/zamoznosc.mjs. Surowe odpowiedzi są w etl/.cache/.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DANE, dzis, pobierzDoCache, wczytajAdresy, zapiszWskaznik } from './lib/wspolne.mjs'

export const ROK = 2025
export const PIT = 149128
export const WYNAGRODZENIE = 64428
const API = 'https://bdl.stat.gov.pl/api/v1/data/by-unit'
const LICENCJA = 'GUS BDL, CC BY 4.0 – https://bdl.stat.gov.pl/bdl/metadane/licencja'

// TERYT adresów → jednostka BDL gminy; trzy cyfry końcowe 000 oznaczają jej powiat.
export const GMINY = {
  1261011: ['011212161011', 'Kraków'],
  1206052: ['011212006052', 'Kocmyrzów-Luborzyca'],
  1206082: ['011212006082', 'Michałowice'],
  1206072: ['011212006072', 'Liszki'],
  1206162: ['011212006162', 'Zabierzów'],
  1206152: ['011212006152', 'Wielka Wieś'],
  1219053: ['011212019053', 'Wieliczka'],
  1219043: ['011212019043', 'Niepołomice'],
  1206113: ['011212006113', 'Skawina'],
  1206172: ['011212006172', 'Zielonki'],
  1206143: ['011212006143', 'Świątniki Górne'],
  1214012: ['011212014012', 'Koniusza'],
  1206092: ['011212006092', 'Mogilany'],
  1206022: ['011212006022', 'Igołomia-Wawrzeńczyce'],
}

export const POWIATY = {
  '011212161000': 'Powiat m. Kraków',
  '011212006000': 'Powiat krakowski',
  '011212019000': 'Powiat wielicki',
  '011212014000': 'Powiat proszowicki',
}

export function wartoscBDL(odpowiedz, id, nazwa, zmienna, rok = ROK) {
  if (
    odpowiedz.unitId !== id ||
    odpowiedz.unitName?.toLocaleLowerCase('pl-PL') !== nazwa.toLocaleLowerCase('pl-PL')
  )
    throw new Error(
      `Niezgodna jednostka BDL: ${id} ${nazwa} / ${odpowiedz.unitId} ${odpowiedz.unitName}`,
    )
  const dane = odpowiedz.results?.find((r) => Number(r.id) === zmienna)?.values
  const rokWartosci = dane?.find((v) => Number(v.year) === rok)
  if (!Number.isFinite(rokWartosci?.val) || rokWartosci.val < 0)
    throw new Error(`Brak poprawnej wartości BDL: ${id}, ${zmienna}, ${rok}`)
  return rokWartosci.val
}

async function pobierz(id, nazwa, zmienna) {
  const url = `${API}/${id}?var-id=${zmienna}&year=${ROK}&format=json`
  const plik = await pobierzDoCache(url, `bdl-${id}-${zmienna}-${ROK}.json`)
  return { wartosc: wartoscBDL(JSON.parse(readFileSync(plik, 'utf8')), id, nazwa, zmienna), url }
}

export async function main() {
  const { wersja, adresy } = wczytajAdresy()
  const obecne = [...new Set(adresy.map((a) => a.teryt))]
  if (obecne.length !== 14 || obecne.some((t) => !GMINY[t]))
    throw new Error(`Nieoczekiwany zbiór gmin: ${obecne.join(', ')}`)
  const gminy = new Map()
  const powiaty = new Map()
  for (const teryt of obecne) {
    const [id, nazwa] = GMINY[teryt]
    if (adresy.some((a) => a.teryt === teryt && a.gmina !== nazwa))
      throw new Error(`Nazwa gminy w adresach nie odpowiada BDL: ${teryt} ${nazwa}`)
    gminy.set(teryt, await pobierz(id, nazwa, PIT))
    const idPowiatu = `${id.slice(0, -3)}000`
    if (!powiaty.has(idPowiatu))
      powiaty.set(idPowiatu, await pobierz(idPowiatu, POWIATY[idPowiatu], WYNAGRODZENIE))
  }
  if (powiaty.size !== 4) throw new Error(`Oczekiwano 4 powiatów, jest ${powiaty.size}`)

  const pobrano = dzis()
  const zrodlo = (zmienna, nazwa) => ({
    nazwa: `GUS, Bank Danych Lokalnych – ${nazwa}`,
    url: `https://bdl.stat.gov.pl/api/v1/data/by-variable/${zmienna}?year=${ROK}`,
    licencja: LICENCJA,
    dataDanych: String(ROK),
    pobrano,
  })
  zapiszWskaznik(
    {
      id: 'gmina_pit_na_mieszkanca',
      nazwa: 'Dochody gminy z PIT na mieszkańca',
      opis: `Udział gminy w podatku dochodowym od osób fizycznych w przeliczeniu na mieszkańca w ${ROK} r. To miara dochodów budżetu całej gminy, nie dochód mieszkańca ani gospodarstwa domowego. W Krakowie każda dzielnica ma tę samą wartość. Zmiany zasad finansowania JST utrudniają porównania z poprzednimi latami.`,
      jednostka: 'zł/os.',
      kategoria: 'kontekst',
      kierunek: 'neutralny',
      rozdzielczosc: 'gmina',
      zadanie: 70,
      zrodla: [zrodlo(PIT, 'dochody gmin z PIT na mieszkańca')],
    },
    adresy.map((a) => gminy.get(a.teryt)?.wartosc ?? null),
  )
  zapiszWskaznik(
    {
      id: 'powiat_wynagrodzenie_brutto',
      nazwa: 'Przeciętne wynagrodzenie brutto w powiecie',
      opis: `Średnie miesięczne wynagrodzenie brutto w ${ROK} r. według powiatu miejsca pracy; statystyka obejmuje m.in. podmioty zatrudniające co najmniej 10 osób. Nie oznacza zarobków mieszkańców tego adresu. Dla całego Krakowa jest jedna wartość.`,
      jednostka: 'zł/mies.',
      kategoria: 'kontekst',
      kierunek: 'neutralny',
      rozdzielczosc: 'powiat',
      zadanie: 70,
      zrodla: [zrodlo(WYNAGRODZENIE, 'przeciętne wynagrodzenie brutto')],
    },
    adresy.map((a) => powiaty.get(`${GMINY[a.teryt][0].slice(0, -3)}000`)?.wartosc ?? null),
  )

  // #44: te same fakty dostępne w maszynowym zestawieniu gmin, także z prawdziwą skalą pomiaru.
  const sciezka = join(DANE, 'gminy-porownanie.json')
  const porownanie = JSON.parse(readFileSync(sciezka, 'utf8'))
  if (porownanie.wersjaAdresow !== wersja || porownanie.gminy.length !== obecne.length)
    throw new Error('Porównanie gmin nie odpowiada aktualnym adresom')
  const noweMiary = [
    {
      id: 'gmina_pit_na_mieszkanca',
      nazwa: 'Dochody gminy z PIT na mieszkańca',
      jednostka: 'zł/os.',
      rozdzielczosc: 'gmina',
      zrodlo: zrodlo(PIT, 'dochody gmin z PIT na mieszkańca'),
    },
    {
      id: 'powiat_wynagrodzenie_brutto',
      nazwa: 'Przeciętne wynagrodzenie brutto w powiecie',
      jednostka: 'zł/mies.',
      rozdzielczosc: 'powiat',
      zrodlo: zrodlo(WYNAGRODZENIE, 'przeciętne wynagrodzenie brutto'),
    },
  ]
  porownanie.miary = [
    ...porownanie.miary.filter((m) => !noweMiary.some((n) => n.id === m.id)),
    ...noweMiary,
  ]
  for (const g of porownanie.gminy) {
    if (!gminy.has(g.teryt)) throw new Error(`Nieznana gmina w porównaniu: ${g.teryt}`)
    const idPowiatu = `${GMINY[g.teryt][0].slice(0, -3)}000`
    g.miary.gmina_pit_na_mieszkanca = { ...gminy.get(g.teryt), rok: ROK, rozdzielczosc: 'gmina' }
    g.miary.powiat_wynagrodzenie_brutto = {
      ...powiaty.get(idPowiatu),
      rok: ROK,
      rozdzielczosc: 'powiat',
      powiat: POWIATY[idPowiatu],
    }
  }
  writeFileSync(sciezka, JSON.stringify(porownanie))
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href)
  main().catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
