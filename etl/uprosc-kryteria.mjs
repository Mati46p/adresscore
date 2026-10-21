// Integracja po ETL źródłowym: jeden atrybut dla jednego zjawiska, bez podwójnego ważenia.
// Uruchom po odświeżeniu etl/codziennosc, inwestycje/obwarzanek, halas/obwarzanek i powodz.
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { OPCJONALNE, PRZENIESIONE, USUWANE } from './lib/meta-wzorzec.mjs'
import { DANE, MIASTO, zapiszWskaznik } from './lib/wspolne.mjs'

export { PRZENIESIONE }

const katalog = join(DANE, 'wskazniki')
const sciezka = (id) => join(katalog, `${id}.json`)
const wczytaj = (id) => JSON.parse(readFileSync(sciezka(id), 'utf8'))
const usun = (id) => {
  if (existsSync(sciezka(id))) unlinkSync(sciezka(id))
}

export function polaczRozlaczne(a, b) {
  if (a.wersjaAdresow !== b.wersjaAdresow || a.wartosci.length !== b.wartosci.length)
    throw new Error(`Różne wersje adresów: ${a.meta.id} / ${b.meta.id}`)
  const wartosci = []
  const etykiety = []
  for (let i = 0; i < a.wartosci.length; i++) {
    if (a.wartosci[i] !== null && b.wartosci[i] !== null)
      throw new Error(`Dwa pomiary pod adresem ${i}: ${a.meta.id} / ${b.meta.id}`)
    const pierwsza = a.wartosci[i] !== null
    wartosci.push(pierwsza ? a.wartosci[i] : b.wartosci[i])
    etykiety.push(pierwsza ? (a.etykiety?.[i] ?? null) : (b.etykiety?.[i] ?? null))
  }
  return { wartosci, etykiety }
}

export function maUsluge(etykieta, nazwa) {
  if (etykieta === 'Wszystkie rodzaje usług w 1200 m') return true
  if (!etykieta?.startsWith('Brak w 1200 m: '))
    throw new Error(`Nieznana etykieta agregatu usług: ${etykieta}`)
  return !etykieta.slice('Brak w 1200 m: '.length).split(', ').includes(nazwa)
}

function polacz(id, drugieId, nazwa, opis) {
  if (!existsSync(sciezka(drugieId))) return // ponowny bieg po już zintegrowanym zbiorze
  const a = wczytaj(id)
  const b = wczytaj(drugieId)
  const { wartosci, etykiety } = polaczRozlaczne(a, b)
  zapiszWskaznik(
    {
      ...a.meta,
      nazwa,
      opis,
      ...(PRZENIESIONE[id]
        ? { kategoria: PRZENIESIONE[id][0], kierunek: PRZENIESIONE[id][1], domyslnaWaga: 0 }
        : {}),
      zrodla: [...a.meta.zrodla, ...b.meta.zrodla],
      zadanie: 171,
    },
    wartosci,
    etykiety,
  )
  usun(drugieId)
}

function rozdzielUslugi() {
  if (!existsSync(sciezka('uslugi_15min'))) return
  const agregat = wczytaj('uslugi_15min')
  const rodzaje = [
    ['gastronomia_1200m', 'gastronomia', 'Gastronomia w 1,2 km'],
    ['poczta_1200m', 'poczta lub paczkomat', 'Poczta lub punkt pocztowy w 1,2 km'],
    ['biblioteka_1200m', 'biblioteka', 'Biblioteka w 1,2 km'],
  ]
  for (const [id, nazwaRodzaju, nazwa] of rodzaje) {
    zapiszWskaznik(
      {
        id,
        nazwa,
        opis: `Czy w promieniu 1200 m w linii prostej od adresu jest ${nazwaRodzaju} oznaczona w OpenStreetMap? 1 = jest, 0 = brak wpisu OSM w promieniu; nie oznacza rzeczywistego czasu dojścia ani godzin otwarcia. Wyodrębnione z wcześniejszego agregatu typów usług.`,
        jednostka: 'status',
        kategoria: 'codziennosc',
        kierunek: 'wiecej-lepiej',
        rozdzielczosc: 'adres',
        zakres: [0, 1],
        zadanie: 171,
        zrodla: [agregat.meta.zrodla[0]],
      },
      agregat.etykiety.map((e) => (maUsluge(e, nazwaRodzaju) ? 1 : 0)),
    )
  }
  usun('uslugi_15min')
}

// W miastach hałas z EEA ma id halas_obwarzanek_lden; w Krakowie ta sama miara to halas_ldwn.
function przeniesHalasMiasta() {
  if (!existsSync(sciezka('halas_obwarzanek_lden')) || existsSync(sciezka('halas_ldwn'))) return
  const a = wczytaj('halas_obwarzanek_lden')
  zapiszWskaznik(
    { ...a.meta, id: 'halas_ldwn', nazwa: 'Najwyższe pasmo hałasu (LDWN/Lden)', zadanie: 171 },
    a.wartosci,
    a.etykiety,
    a.slownikEtykiet,
  )
  usun('halas_obwarzanek_lden')
}

function przypiszGrupy() {
  for (const [id, [kategoria, kierunek]] of Object.entries(PRZENIESIONE)) {
    if (!existsSync(sciezka(id))) {
      // Kraków ma komplet; miasto może nie mieć części warstw (brak źródła), co nie jest błędem.
      if (MIASTO || OPCJONALNE.includes(id)) continue
      throw new Error(`Brakuje warstwy do przeniesienia: ${id}`)
    }
    const p = wczytaj(id)
    p.meta.kategoria = kategoria
    p.meta.kierunek = kierunek
    p.meta.domyslnaWaga = 0
    writeFileSync(sciezka(id), JSON.stringify(p))
  }
}

export function main() {
  przeniesHalasMiasta()
  polacz(
    'inwestycje_500m',
    'inwestycje_500m_obwarzanek',
    'Pozwolenia na budowę w 500 m (2025–2026)',
    'Liczba pozwoleń na budowę, rozbudowę lub nadbudowę budynków w promieniu 500 m. Kraków: decyzje MSIP; gminy wokół: RWDZ GUNB z działkami ULDK. Źródła obejmują rozłączne obszary, a brak danych pozostaje null. Pozwolenie nie oznacza rozpoczęcia budowy ani oceny wpływu inwestycji.',
  )
  polacz(
    'halas_ldwn',
    'halas_obwarzanek_lden',
    'Najwyższe pasmo hałasu (LDWN/Lden)',
    'Najwyższe opublikowane pasmo hałasu dzień–wieczór–noc. Kraków: mapa MSIP 2022 (drogi, tory, przemysł); poza Krakowem: mapy strategiczne EEA, rok referencyjny 2021 (drogi, kolej, przemysł, lotniska). To reprezentacja pasma z różnych źródeł, nie dokładny pomiar pod adresem ani sumaryczny hałas. Brak opublikowanego pasma = brak danych.',
  )
  rozdzielUslugi()
  for (const id of USUWANE) usun(id)
  przypiszGrupy()
  const p = join(DANE, 'gminy-porownanie.json')
  if (!existsSync(p)) return // katalog miasta nie ma porównania gmin
  const g = JSON.parse(readFileSync(p, 'utf8'))
  g.miary = g.miary.filter((m) => m.id !== 'gmina_powodz_powierzchnia_pct')
  for (const x of g.gminy) delete x.miary.gmina_powodz_powierzchnia_pct
  writeFileSync(p, JSON.stringify(g))
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) main()
