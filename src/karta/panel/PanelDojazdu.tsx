// Dojazd komunikacją do celu wybranego przez użytkownika (#85). Liczy w workerze tylko dla
// adresu wybranego na mapie i heksów w porównaniu – nigdy dla wszystkich adresów naraz.
import { useEffect, useState } from 'react'
import type { Adres } from '@/kontrakty'
import { useDane } from '@/wynik/dane'
import {
  BUFOR_PRZESIADKI_MIN,
  MAX_DOJSCIE_M,
  MAX_PODROZ_MIN,
  MAX_PRZESIADKA_M,
  PREDKOSC_PIESZO_MS,
} from '@/wynik/dojazdCel'
import type { InfoDojazdu, OdpowiedzWorkera, WiadomoscDoWorkera } from '@/wynik/dojazdCel.worker'
import { bazaBiezaca } from '@/wynik/miastoDanych'
import { sciezkaGrafu } from '@/wynik/sciezkiDanych'
import { useStan } from '@/wynik/stan'
import { opisAdresu } from '../adres'
import { Wyszukiwarka } from '../wyszukiwarka/Wyszukiwarka'
import { opisZrodelRozkladu } from './zrodlaRozkladu'

const DOMYSLNY_ODJAZD = 7 * 60
let worker: Worker | null = null
let licznik = 0

function zapytaj(w: Omit<WiadomoscDoWorkera, 'id' | 'typ' | 'graf'>): Promise<OdpowiedzWorkera> {
  worker ??= new Worker(new URL('../../wynik/dojazdCel.worker.ts', import.meta.url), {
    type: 'module',
  })
  const id = ++licznik
  const cel = worker
  return new Promise((ok) => {
    const odbierz = (e: MessageEvent<OdpowiedzWorkera>) => {
      if (e.data.id !== id) return
      cel.removeEventListener('message', odbierz)
      ok(e.data)
    }
    cel.addEventListener('message', odbierz)
    // Worker ma własną kopię stanu (zawsze Kraków), więc graf bieżącego miasta wskazujemy mu stąd (#223).
    const graf = sciezkaGrafu(bazaBiezaca())
    cel.postMessage({ typ: 'licz', id, graf, ...w } satisfies WiadomoscDoWorkera)
  })
}

const gg = (min: number) =>
  `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`
const dzienTygodnia = (data: string) =>
  new Intl.DateTimeFormat('pl-PL', { weekday: 'long', timeZone: 'UTC' }).format(
    new Date(`${data}T12:00:00Z`),
  )
const liczbaPL = (x: number) => x.toLocaleString('pl-PL', { maximumFractionDigits: 2 })

type Wynik =
  | { stan: 'brak' }
  | { stan: 'licze' }
  | { stan: 'blad'; komunikat: string }
  | { stan: 'gotowe'; klucz: string; czasy: (number | null)[]; info: InfoDojazdu }

export function PanelDojazdu() {
  const dane = useDane()
  const wybrany = useStan((s) => s.wybrany)
  const porownanie = useStan((s) => s.porownanie)
  const miasto = useStan((s) => s.miasto)
  const [cel, setCel] = useState<number | null>(null)
  const [odjazd, setOdjazd] = useState(DOMYSLNY_ODJAZD)
  const [info, setInfo] = useState<InfoDojazdu | null>(null)
  const [wynik, setWynik] = useState<Wynik>({ stan: 'brak' })
  // Cel to indeks w adresach JEDNEGO miasta, a godziny i źródła rozkładu (info) należą do jego grafu: po
  // zmianie miasta cel wskazywałby cudzy adres, a wynik i opis rozkładu byłyby z poprzedniego miasta (#223).
  const [miastoPanelu, setMiastoPanelu] = useState(miasto)
  if (miastoPanelu !== miasto) {
    setMiastoPanelu(miasto)
    setCel(null)
    setInfo(null)
    setOdjazd(DOMYSLNY_ODJAZD)
    setWynik({ stan: 'brak' })
  }

  const adresy = dane.stan === 'gotowe' ? dane.adresy : null
  const adresCelu = adresy && cel !== null ? adresy[cel] : undefined
  const skad: Adres[] = adresy
    ? [...new Set([wybrany, ...porownanie])].flatMap((i) => {
        const a = i === null ? undefined : adresy[i]
        return a ? [a] : []
      })
    : []
  const klucz = adresCelu ? `${adresCelu.i}|${odjazd}|${skad.map((a) => a.i).join(',')}` : ''

  // Zależność tylko od klucza: zawiera cel, godzinę i listę adresów.
  useEffect(() => {
    if (!adresCelu || !skad.length) return
    let aktualne = true
    setWynik({ stan: 'licze' })
    zapytaj({
      cel: { lat: adresCelu.lat, lon: adresCelu.lon },
      odjazd,
      punkty: skad.map((a) => ({ lat: a.lat, lon: a.lon })),
    }).then((odp) => {
      if (!aktualne) return
      if (odp.typ === 'blad') setWynik({ stan: 'blad', komunikat: odp.komunikat })
      else {
        setInfo(odp.info)
        setWynik({ stan: 'gotowe', klucz, czasy: odp.czasy, info: odp.info })
      }
    })
    return () => {
      aktualne = false
    }
  }, [klucz])

  if (!adresy) return null
  const godziny = info?.godziny ?? [DOMYSLNY_ODJAZD]

  return (
    <section aria-labelledby="h-dojazd-cel" className="panel-sekcja dojazd-cel">
      <h2 id="h-dojazd-cel" className="etykieta-sekcji">
        Dojazd do Twojego celu
      </h2>
      <p className="panel-uwaga">
        Wpisz adres celu (praca, szkoła). Policzymy planowy czas komunikacją miejską z adresu
        wybranego na mapie i z heksów w porównaniu.
      </p>
      {adresCelu ? (
        <p className="dojazd-cel__cel">
          Cel: <strong>{opisAdresu(adresCelu)}</strong>{' '}
          <button type="button" className="seg" onClick={() => setCel(null)}>
            Zmień
          </button>
        </p>
      ) : (
        <Wyszukiwarka adresy={adresy} onWybierz={setCel} wyczyscPoWyborze />
      )}
      <label className="dojazd-cel__godzina">
        Wyjście o{' '}
        <select value={odjazd} onChange={(e) => setOdjazd(Number(e.target.value))}>
          {godziny.map((g) => (
            <option key={g} value={g}>
              {gg(g)}
            </option>
          ))}
        </select>
      </label>
      {adresCelu && !skad.length && (
        <p className="panel-uwaga">Kliknij heks na mapie, żeby zobaczyć czas z tego miejsca.</p>
      )}
      {adresCelu && skad.length > 0 && (
        <ul className="dojazd-cel__lista" aria-live="polite">
          {skad.map((a, k) => {
            const czas =
              wynik.stan === 'gotowe' && wynik.klucz === klucz ? wynik.czasy[k] : undefined
            return (
              <li key={a.i} data-brak={czas === null || undefined}>
                <span>{opisAdresu(a)}</span>
                <strong>
                  {wynik.stan === 'blad'
                    ? 'błąd obliczeń'
                    : czas === undefined
                      ? 'liczę…'
                      : czas === null
                        ? `brak trasy w ${MAX_PODROZ_MIN / 60} h`
                        : `${czas} min`}
                </strong>
              </li>
            )
          })}
        </ul>
      )}
      {wynik.stan === 'blad' && (
        <p className="panel-uwaga" role="alert">
          Nie udało się policzyć dojazdu: {wynik.komunikat}
        </p>
      )}
      {info && (
        <p className="panel-uwaga dojazd-cel__zalozenia">
          Rozkład GTFS: {opisZrodelRozkladu(info.zrodla)}, na dzień {info.dataRozkladu} (
          {dzienTygodnia(info.dataRozkladu)}), wyjście o {gg(odjazd)}; inne dni mogą mieć inny
          rozkład. Dane: {[...new Set(info.zrodla.map((z) => z.dataDanych))].join(', ')}. Czas
          planowy, bez opóźnień. Dojście do przystanku i od przystanku do celu do{' '}
          {liczbaPL(MAX_DOJSCIE_M / 1000)} km, przesiadki do {MAX_PRZESIADKA_M} m i min.{' '}
          {BUFOR_PRZESIADKI_MIN} min – liczone po linii prostej przy {liczbaPL(PREDKOSC_PIESZO_MS)}{' '}
          m/s, nie po chodnikach. Cel zaokrąglony do ok. 100 m. Brak trasy w {MAX_PODROZ_MIN / 60} h
          = brak danych, nie zero. To osobne obliczenie – nie warstwa „Czas do lotniska Balice”.
        </p>
      )}
    </section>
  )
}
