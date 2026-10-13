// Zapis wskaźnika „odległość do najbliższego obiektu" dla Warszawy z punktów API dane.um.warszawa.pl.
// Osobno od warszawa-api.mjs, żeby klient (sieć, klucz) nie ciągnął za sobą ETL-owych zależności.
import { odleglosci } from './osm-uslugi.mjs'
import { LICENCJA, mediana, PORTAL_DANYCH } from './warszawa-api.mjs'
import { wczytajAdresy, zapiszWskaznik } from './wspolne.mjs'

const MAX_M = 10_000

/**
 * Liczy odległość (m, zaokrąglona) od każdego adresu do najbliższego punktu i zapisuje wskaźnik.
 * `zrodlo`: { nazwa, action, dataDanych, pobrano }. Zwraca { liczbaAdresow, mediana, pokrycie, ... }.
 */
export function zapiszOdleglosc({ id, kategoria, nazwa, opis, zakres, zadanie, zrodlo, punkty }) {
  if (!punkty.length) throw new Error(`${id}: brak punktów, nie zapisuję pustej warstwy`)
  const { adresy } = wczytajAdresy()
  const wartosci = odleglosci(adresy, punkty, MAX_M)
  zapiszWskaznik(
    {
      id,
      kategoria,
      nazwa,
      opis: `${opis} Skala: mniej metrów = lepiej. Odległość w linii prostej, nie trasa piesza. Brak obiektu w promieniu ${MAX_M / 1000} km to brak danych, nie zero.`,
      jednostka: 'm',
      kierunek: 'mniej-lepiej',
      rozdzielczosc: 'adres',
      zakres,
      zadanie,
      zrodla: [
        {
          nazwa: `${zrodlo.nazwa} (dane.um.warszawa.pl, ${zrodlo.action})`,
          url: PORTAL_DANYCH,
          licencja: LICENCJA,
          dataDanych: zrodlo.dataDanych,
          pobrano: zrodlo.pobrano,
        },
      ],
    },
    wartosci,
  )
  const m = mediana(wartosci)
  console.log(`${id}: obiektów ${punkty.length}, mediana odległości ${m} m`)
  return { wartosci, mediana: m, liczbaObiektow: punkty.length }
}
