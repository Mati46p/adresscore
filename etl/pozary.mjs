// Roczne zdarzenia jednostek ochrony przeciwpożarowej według gminy, nie ocena adresu.
// Uruchom: node etl/pozary.mjs. ZIP KG PSP trafia do etl/.cache/.
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { CACHE, DANE, dzis, pobierzDoCache, wczytajAdresy, zapiszWskaznik } from './lib/wspolne.mjs'

const ROK = 2025
const KG_URL = 'https://www.gov.pl/attachment/d31f40d0-8f3e-44ca-ba34-2970fd4742b0'
const KG_PAGE = 'https://www.gov.pl/web/kgpsp/interwencje-psp'
const BIP_URL = 'https://www.bip.krakow.pl/plik.php?mode=shw&new=t&wer=0&zid=684238'
const BIP_KRAKOW = { fires: 2623, previousFires: 1450 }

export function dopasujZdarzenia(adresy, tabela) {
  const gminy = new Map()
  for (const a of adresy) {
    if (!/^\d{7}$/.test(a.teryt)) throw new Error(`Niepoprawny TERYT adresu: ${a.teryt}`)
    const rekord = tabela[a.teryt.slice(0, 6)]
    if (rekord && rekord.name !== a.gmina)
      throw new Error(`Niezgodna nazwa gminy ${a.teryt}: ${a.gmina} vs ${rekord.name}`)
    if (!gminy.has(a.teryt))
      gminy.set(a.teryt, { nazwa: a.gmina, pspTeryt: a.teryt.slice(0, 6), adresow: 0 })
    gminy.get(a.teryt).adresow++
  }
  return gminy
}

export function wartoscDlaGminy(teryt, tabela, rodzaj) {
  const rekord = tabela[teryt.slice(0, 6)]
  if (!rekord) return null
  if (teryt === '1261011') return rodzaj === 'fires' ? BIP_KRAKOW.fires : null
  return rekord[rodzaj]
}

async function main() {
  const { wersja, adresy } = wczytajAdresy()
  const sciezka = await pobierzDoCache(KG_URL, 'kgpsp-tabele-2025.zip')
  const tabela = JSON.parse(
    execFileSync(
      'python3',
      [new URL('./pozary-swd.py', import.meta.url).pathname, sciezka, String(ROK)],
      {
        maxBuffer: 2_000_000,
        encoding: 'utf8',
      },
    ),
  )
  const gminy = dopasujZdarzenia(adresy, tabela)
  if (gminy.size !== 14 || !gminy.has('1261011'))
    throw new Error(`Oczekiwano Krakowa i 13 gmin, jest ${gminy.size}`)
  if (tabela['126101']?.fires !== 224 || tabela['126101']?.threats !== 557)
    throw new Error('Zmieniono dane KG PSP dla Krakowa – ponów kontrolę z raportem BIP')
  const pobrano = dzis()
  const zrodloKg = {
    nazwa: 'Dane statystyczne KG PSP [źródło: www.gov.pl/kgpsp, data dostępu: ' + pobrano + ']',
    url: KG_PAGE,
    licencja: 'CC BY 4.0 – https://creativecommons.org/licenses/by/4.0/legalcode.pl',
    dataDanych: '2025',
    pobrano,
  }
  const zrodloBip = {
    nazwa: 'Raport o stanie Gminy Kraków 2025, str. 60',
    url: BIP_URL,
    licencja:
      'Warunki ponownego wykorzystywania informacji BIP Krakowa – https://www.bip.krakow.pl/?dok_id=48482',
    dataDanych: '2025',
    pobrano,
  }
  const wspolnyOpis =
    'Liczba zdarzeń w całej gminie w 2025 r.; przypisana do adresów tylko jako kontekst gminny. Nie określa zagrożenia w miejscu zamieszkania ani skuteczności służb. Nie jest normalizowana względem ludności lub powierzchni. '
  const rozbieznosc =
    'KG PSP w tabeli 1 pokazuje dla Krakowa 224 pożary i 557 miejscowych zagrożeń; raport BIP miasta podaje 2623 pożary. Źródła nie uzgadniają się: dla pożarów w Krakowie używamy BIP, a miejscowe zagrożenia Krakowa oznaczamy jako brak danych. '
  const miary = [
    {
      id: 'pozary_gmina_2025',
      nazwa: 'Pożary w gminie w 2025 r.',
      rodzaj: 'fires',
      opis: `${wspolnyOpis}${rozbieznosc}Raport BIP podaje dla Krakowa 1450 pożarów w 2024 i 2623 w 2025 r.; trend dotyczy wyłącznie Krakowa i jednego źródła.`,
      zrodla: [zrodloKg, zrodloBip],
    },
    {
      id: 'miejscowe_zagrozenia_gmina_2025',
      nazwa: 'Miejscowe zagrożenia w gminie w 2025 r.',
      rodzaj: 'threats',
      opis: `${wspolnyOpis}„Miejscowe zagrożenia” to kategoria zdarzeń PSP, nie liczba przestępstw lub indywidualny poziom ryzyka. ${rozbieznosc}`,
      zrodla: [zrodloKg],
    },
  ]
  for (const m of miary) {
    const wartosciGmin = new Map(
      [...gminy.keys()].map((t) => [t, wartoscDlaGminy(t, tabela, m.rodzaj)]),
    )
    zapiszWskaznik(
      {
        id: m.id,
        nazwa: m.nazwa,
        opis: m.opis,
        jednostka: 'zdarzeń',
        kategoria: 'kontekst',
        kierunek: 'neutralny',
        rozdzielczosc: 'gmina',
        zadanie: 67,
        zrodla: m.zrodla,
      },
      adresy.map((a) => wartosciGmin.get(a.teryt) ?? null),
    )
  }
  writeFileSync(
    join(DANE, 'pozary_gminy_2025.json'),
    JSON.stringify({
      wersjaAdresow: wersja,
      rok: ROK,
      rozdzielczosc: 'gmina',
      zrodlo: KG_PAGE,
      zrodloKrakow: BIP_URL,
      pobrano,
      uwaga: rozbieznosc,
      trendKrakow: { 2024: BIP_KRAKOW.previousFires, 2025: BIP_KRAKOW.fires },
      gminy: [...gminy].map(([teryt, g]) => ({
        teryt,
        nazwa: g.nazwa,
        adresow: g.adresow,
        pozary: wartoscDlaGminy(teryt, tabela, 'fires'),
        miejscoweZagrozenia: wartoscDlaGminy(teryt, tabela, 'threats'),
        zrodloPozary: teryt === '1261011' ? BIP_URL : KG_PAGE,
      })),
    }),
  )
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href)
  main().catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
