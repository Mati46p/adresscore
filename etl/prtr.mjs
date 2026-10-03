// Odległość od adresu do najbliższego zakładu z Krajowego Rejestru Uwalniania i Transferu
// Zanieczyszczeń (PRTR, w UE E-PRTR). Źródło: GIOŚ, INSPIRE OGC API Features
// (prtr:ProductionFacility, dane.gov.pl zbiór 425). Rejestr jest krajowy, więc każdy adres ma wynik.
// Uruchom: node etl/prtr.mjs. Surowe pobrania: etl/.cache/ryzyka/.
import { fileURLToPath } from 'node:url'
import { do2180, IndeksPunktow } from './lib/geo.mjs'
import { przytnijNazwe, skrocNazwe } from './lib/nazwy.mjs'
import { pobierzKolekcje } from './lib/pobieranie.mjs'
import { wczytajAdresy, zapiszWskaznik } from './lib/wspolne.mjs'

const URL_OGC =
  'https://inspire.gios.gov.pl/wss/ogc/features/collections/prtr%3AProductionFacility/items?limit=500&f=application%2Fgeo%2Bjson'
const URL_KOLEKCJI =
  'https://inspire.gios.gov.pl/wss/ogc/features/collections/prtr:ProductionFacility'
const ZBIOR =
  'https://dane.gov.pl/pl/dataset/425,krajowy-rejestr-uwalniania-i-transferu-zanieczyszczen'
const ZAKRES_M = 100_000
const ZAOKRAGLENIE_M = 10
/** Etykieta z nazwą zakładu tylko w pobliżu – dalej nazwa nie wpływa na decyzję, a waży w pliku. */
const PROMIEN_ETYKIETY_M = 1_000
const MAKS_DLUGOSC_NAZWY = 60
const POLSKA = { lon: [14, 24.5], lat: [48.9, 55.1] }

// Działy PKD/NACE rev. 2 występujące w rejestrze, w nazwach zrozumiałych bez słownika.
const BRANZE = {
  '05': 'górnictwo węgla',
  '06': 'wydobycie ropy i gazu',
  '07': 'górnictwo rud metali',
  '08': 'kopalnia lub kamieniołom',
  '09': 'usługi dla górnictwa',
  10: 'przetwórstwo spożywcze',
  11: 'produkcja napojów',
  13: 'włókiennictwo',
  16: 'przemysł drzewny',
  17: 'papier i tektura',
  18: 'poligrafia',
  19: 'koksownia lub rafineria',
  20: 'przemysł chemiczny',
  21: 'farmaceutyki',
  22: 'wyroby z gumy i tworzyw',
  23: 'cement, szkło, ceramika',
  24: 'hutnictwo i metalurgia',
  25: 'wyroby metalowe',
  27: 'urządzenia elektryczne',
  28: 'maszyny',
  29: 'motoryzacja',
  30: 'sprzęt transportowy',
  31: 'meble',
  32: 'produkcja różna',
  33: 'naprawa maszyn',
  35: 'energetyka i ciepłownictwo',
  36: 'woda i wodociągi',
  37: 'oczyszczalnia ścieków',
  38: 'gospodarka odpadami',
  39: 'rekultywacja i odpady',
}
const BRANZE_ROLNE = { '01.46': 'chów świń', '01.47': 'chów drobiu', '01.48': 'chów zwierząt' }

/** Branża po kodzie NACE zakładu (np. „35.30”, „01.47”); nieznany dział = „inna działalność”. */
export function branza(nace) {
  const kod = String(nace ?? '').trim()
  if (kod.startsWith('01')) return BRANZE_ROLNE[kod.slice(0, 5)] ?? 'rolnictwo'
  return BRANZE[kod.slice(0, 2)] ?? 'inna działalność przemysłowa'
}

/** Nazwa do etykiety: bez formy prawnej na końcu, skrócona do `MAKS_DLUGOSC_NAZWY` znaków. */
export function nazwaDoEtykiety(nazwa) {
  return przytnijNazwe(skrocNazwe(nazwa), MAKS_DLUGOSC_NAZWY)
}

export function etykietaZakladu(zaklad) {
  return `${zaklad.nazwa} – ${zaklad.branza}`
}

/** Zakłady z GeoJSON INSPIRE: tylko sprawne, z punktem w Polsce. Zwraca też liczbę odrzuconych. */
export function zakladyPrtr(features) {
  const zaklady = []
  const odrzucone = { niesprawne: 0, bezPunktu: 0, poza: 0, bezNazwy: 0 }
  for (const f of features) {
    const p = f.properties ?? {}
    if (p.status_statusType !== 'sprawny') {
      odrzucone.niesprawne++
      continue
    }
    if (!String(p.name ?? '').trim()) {
      odrzucone.bezNazwy++
      continue
    }
    const [lon, lat] = f.geometry?.type === 'Point' ? f.geometry.coordinates : []
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
      odrzucone.bezPunktu++
      continue
    }
    if (lon < POLSKA.lon[0] || lon > POLSKA.lon[1] || lat < POLSKA.lat[0] || lat > POLSKA.lat[1]) {
      odrzucone.poza++
      continue
    }
    const [x, y] = do2180(lon, lat)
    zaklady.push({
      id: f.id,
      nazwa: nazwaDoEtykiety(p.name),
      branza: branza(p.function_activity),
      nace: String(p.function_activity ?? ''),
      lon,
      lat,
      x,
      y,
    })
  }
  return { zaklady, odrzucone }
}

async function main() {
  const kolekcja = await pobierzKolekcje(URL_OGC, 'prtr')
  const { zaklady, odrzucone } = zakladyPrtr(kolekcja.features)
  console.log(
    `INSPIRE PRTR: ${kolekcja.features.length} obiektów, użyto ${zaklady.length}, odrzucone ${JSON.stringify(odrzucone)}`,
  )
  if (zaklady.length < 3000) throw new Error(`Podejrzanie mało zakładów PRTR: ${zaklady.length}`)

  const { adresy } = wczytajAdresy()
  const indeks = new IndeksPunktow(zaklady)
  const wyniki = adresy.map((a) => {
    const [x, y] = do2180(a.lon, a.lat)
    return indeks.najblizszy(x, y, ZAKRES_M)
  })
  if (wyniki.some((w) => w === null)) throw new Error('Adres bez zakładu PRTR w zasięgu')
  const wartosci = wyniki.map((w) => Math.round(w.odleglosc / ZAOKRAGLENIE_M) * ZAOKRAGLENIE_M)
  const etykiety = wyniki.map((w) =>
    w.odleglosc <= PROMIEN_ETYKIETY_M ? etykietaZakladu(w.punkt) : null,
  )
  const maks = wartosci.reduce((m, v) => Math.max(m, v), 0)
  const p99 = [...wartosci].sort((a, b) => a - b)[Math.floor(0.99 * wartosci.length)]
  console.log(`Maks. odległość ${maks} m, z etykietą ${etykiety.filter(Boolean).length} adresów`)

  zapiszWskaznik(
    {
      id: 'emitent_odleglosc',
      kategoria: 'bezpieczenstwo',
      nazwa: 'Odległość od zakładu z rejestru zanieczyszczeń',
      opis: `Odległość w linii prostej od punktu adresu do najbliższego zakładu z Krajowego Rejestru Uwalniania i Transferu Zanieczyszczeń (PRTR): elektrociepłowni, zakładów przemysłowych, instalacji odpadów i ścieków oraz dużych ferm, które prowadzą działalność z załącznika I rozporządzenia (WE) nr 166/2006. To lista zakładów objętych obowiązkiem rejestracji, a nie pomiar: nie mówi, ile zakład emituje ani czy jest uciążliwy. Rejestr jest krajowy, więc każdy adres ma wynik. Współrzędne z rejestru INSPIRE (ok. 2% podanych z dokładnością do ok. 1 km). Odległość zaokrąglona do ${ZAOKRAGLENIE_M} m. Etykieta z nazwą i branżą najbliższego zakładu jest podana dla adresów w odległości do ${PROMIEN_ETYKIETY_M} m.`,
      jednostka: 'm',
      kierunek: 'wiecej-lepiej',
      rozdzielczosc: 'adres',
      zakres: [0, Math.ceil(p99 / 1000) * 1000],
      zadanie: 116,
      zrodla: [
        {
          nazwa:
            'GIOŚ – Krajowy Rejestr Uwalniania i Transferu Zanieczyszczeń (PRTR), INSPIRE OGC API Features: lokalizacja zakładów',
          url: URL_KOLEKCJI,
          licencja: `CC BY 4.0 (dane.gov.pl, zbiór 425: ${ZBIOR})`,
          dataDanych: kolekcja.dataDanych,
          pobrano: kolekcja.pobrano,
        },
      ],
    },
    wartosci,
    etykiety,
  )
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1])
  main().catch((blad) => {
    console.error(blad)
    process.exitCode = 1
  })
