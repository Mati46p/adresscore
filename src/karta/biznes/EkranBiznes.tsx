import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import {
  type BialaPlama,
  czynnikiOceny,
  type OcenaMiejsca,
  type PunktUslugi,
  progSkaliPlam,
  rozbicieZasiegu,
} from '@/wynik/biznes'
import {
  grupujBranze,
  konkurencjaWDopelniaczu,
  opisFiltrow,
  rozwiazBranze,
} from '@/wynik/biznesBranze'
import {
  opisHeksuBiznesu,
  wpisyZrodel,
  wpisyZrodelBranzy,
  type ZrodloDanych,
  zdaniePozycji,
} from '@/wynik/biznesOpis'
import {
  BEZ_FILTROW,
  czytajKatalog,
  type FiltryUslug,
  type KatalogUslug,
  type MetaBranzy,
} from '@/wynik/biznesUslugi'
import { ograniczDoGranic, postawionePunkty } from '@/wynik/biznesZnaczniki'
import { useStan, ustawBranze, ustawPunktBiznesu } from '@/wynik/stan'
import { GRANICE_PUNKTU, wGranicachPunktu } from '@/wynik/url'
import { FiltryKonkurencji } from './FiltryKonkurencji'
import './biznes.css'

const MapaKrakowa = lazy(async () => ({
  default: (await import('@/mapa/MapaKrakowa')).MapaKrakowa,
}))
type Punkt = { lon: number; lat: number }
const PUSTE_HEKSY: ReadonlyMap<string, number | null> = new Map()
const LICZBA = new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 0 })

export function EkranBiznes() {
  const branza = useStan((s) => s.branza)
  const punktA = useStan((s) => s.punktA)
  const punktB = useStan((s) => s.punktB)
  const [katalog, setKatalog] = useState<KatalogUslug | null>(null)
  const [meta, setMeta] = useState<MetaBranzy | null>(null)
  // Filtry nie wchodzą do linku (`url.ts` jest poza tym zadaniem), więc żyją tylko w tym oknie.
  const [filtry, setFiltry] = useState<FiltryUslug>(BEZ_FILTROW)
  const [punkty, setPunkty] = useState<{ lon: number; lat: number; nazwa: string }[]>([])
  const [heksy, setHeksy] = useState<ReadonlyMap<string, number | null>>(PUSTE_HEKSY)
  const [opisy, setOpisy] = useState<Map<string, BialaPlama>>(new Map())
  const [zrodlaPopytu, setZrodlaPopytu] = useState<ZrodloDanych[]>([])
  const [skala, setSkala] = useState<readonly [string, string, string]>(['0', '50', '100'])
  const [ocenaA, setOcenaA] = useState<OcenaMiejsca | null>(null)
  const [ocenaB, setOcenaB] = useState<OcenaMiejsca | null>(null)
  const [blad, setBlad] = useState('')
  const [aktywny, setAktywny] = useState<'a' | 'b'>('a')
  const [lonTekst, setLonTekst] = useState('19.940000')
  const [latTekst, setLatTekst] = useState('50.060000')
  // Wersja wczytanej branży (0 = nic nie wczytano). Oceny liczymy dopiero po jej ustawieniu,
  // więc punkty z linku i punkty postawione w trakcie ładowania są oceniane tą samą ścieżką.
  const [gotowa, setGotowa] = useState(0)
  const worker = useRef<Worker | null>(null)
  const wersja = useRef(0)
  const wczytanaBranza = useRef<string | null>(null)

  // Stary link (`b=sklep`) i id spoza katalogu przechodzą przez moduł branż; `url.ts` czyta
  // parametr bez zmian, więc stan może trzymać stare id, a ekran wczytuje już nowy plik.
  const idBranzy = rozwiazBranze(
    branza,
    katalog?.branze.map((b) => b.id),
  )
  const wpisBranzy = katalog?.branze.find((b) => b.id === idBranzy) ?? null

  // Pola współrzędnych podążają za aktywnym punktem, a nie za każdą zmianą drugiego punktu.
  const wybrany = aktywny === 'a' ? punktA : punktB
  useEffect(() => {
    if (wybrany) {
      setLonTekst(wybrany.lon.toFixed(6))
      setLatTekst(wybrany.lat.toFixed(6))
    }
  }, [wybrany])

  useEffect(() => {
    fetch('/dane/uslugi/katalog.json')
      .then((r) => {
        if (!r.ok) throw new Error('HTTP ' + r.status)
        return r.json() as Promise<unknown>
      })
      .then((dane) => setKatalog(czytajKatalog(dane)))
      .catch((e) => setBlad('Brak katalogu branż: ' + (e instanceof Error ? e.message : String(e))))
  }, [])

  useEffect(() => {
    const w = new Worker(new URL('../../wynik/biznes.worker.ts', import.meta.url), {
      type: 'module',
    })
    worker.current = w
    // Popyt (największy plik) zaczyna się pobierać razem z katalogiem, przed wyborem branży.
    w.postMessage({ typ: 'start' })
    w.onmessage = (event: MessageEvent) => {
      const d = event.data
      if (d.typ === 'blad') {
        setBlad(d.blad)
        return
      }
      if (d.typ === 'gotowe') {
        wersja.current = d.wersja
        setMeta(d.meta as MetaBranzy)
        setPunkty((d.punkty as PunktUslugi[]).map(([lon, lat, nazwa]) => ({ lon, lat, nazwa })))
        setZrodlaPopytu(d.zrodla as ZrodloDanych[])
        const plamy = d.plamy as BialaPlama[]
        setHeksy(new Map(plamy.map((p) => [p.h3, p.skala])))
        setOpisy(new Map(plamy.map((p) => [p.h3, p])))
        const prog = progSkaliPlam(plamy)
        setSkala(['0', String(Math.round(prog / 2)), `${Math.round(prog)}+`])
        setGotowa(d.wersja)
      }
      if (d.typ === 'ocena' && d.wersja === wersja.current) {
        if (d.id === 'a') setOcenaA(d.ocena)
        else setOcenaB(d.ocena)
      }
    }
    return () => {
      worker.current = null
      w.terminate()
    }
  }, [])

  // Worker dostaje wybór dopiero po katalogu: id spoza katalogu wraca wtedy do domyślnej branży
  // (`rozwiazBranze`), zamiast kończyć się błędem 404. Zmiana branży czyści meta i oceny, a zmiana
  // samych filtrów zostawia je do czasu nowych (jak przesunięcie punktu), bez migania karty.
  useEffect(() => {
    if (!katalog) return
    if (wczytanaBranza.current !== idBranzy) {
      wczytanaBranza.current = idBranzy
      setMeta(null)
      setOcenaA(null)
      setOcenaB(null)
    }
    wersja.current = 0
    setGotowa(0)
    setBlad('')
    worker.current?.postMessage({ typ: 'init', branza: idBranzy, filtry })
  }, [katalog, idBranzy, filtry])

  // Przesunięcie punktu zostawia poprzednią ocenę do czasu nowej (bez migania karty przy każdym
  // kroku strzałki); wyczyszczenie jej wymaga usunięcia punktu albo zmiany branży.
  useEffect(() => {
    if (!punktA) {
      setOcenaA(null)
      return
    }
    if (gotowa) worker.current?.postMessage({ typ: 'ocen', id: 'a', punkt: punktA, wersja: gotowa })
  }, [punktA, gotowa])
  useEffect(() => {
    if (!punktB) {
      setOcenaB(null)
      return
    }
    if (gotowa) worker.current?.postMessage({ typ: 'ocen', id: 'b', punkt: punktB, wersja: gotowa })
  }, [punktB, gotowa])

  function postaw(lon: number, lat: number) {
    if (!wGranicachPunktu(lon, lat)) return
    ustawPunktBiznesu(aktywny, { lon, lat })
    if (aktywny === 'a') setAktywny('b')
  }

  const postawione = postawionePunkty(punktA, punktB)
  const nazwaBranzy = meta?.nazwa ?? wpisBranzy?.nazwa ?? 'branży'
  const zasiegM = meta?.zasiegM ?? wpisBranzy?.zasiegPieszyM ?? 0
  // Opis konkurencji na karcie bierze filtry, dla których policzono wynik (`meta.filtry`), a nie
  // bieżące przełączniki: po kliknięciu zmieniają się wcześniej niż liczby na karcie.
  const policzone = meta?.filtry ?? BEZ_FILTROW
  const konkurencja = konkurencjaWDopelniaczu(idBranzy, policzone)
  const zFiltrow = opisFiltrow(idBranzy, policzone)
  // Link z id, którego katalog nie zna (literówka, branża usunięta), pokazuje domyślną branżę.
  const nieznana = katalog !== null && rozwiazBranze(branza) !== idBranzy
  const zrodla = [
    ...(katalog && wpisBranzy ? wpisyZrodelBranzy(katalog, wpisBranzy) : []),
    ...wpisyZrodel(zrodlaPopytu),
  ]

  return (
    <main className="biznes">
      <div className="biznes-glowa">
        <div>
          <p className="biznes-etykieta">TRYB BIZNESOWY</p>
          <h1 tabIndex={-1}>Lokalizacja dla branży „{nazwaBranzy}”</h1>
          <p>
            Wybierz branżę, a następnie postaw punkt A lub B na mapie. Kolor pokazuje liczbę adresów
            w zasięgu na jeden istniejący punkt: im ciemniejszy, tym słabiej obsłużony popyt.
            Najmocniejszy kolor zaczyna się przy 95. percentylu heksów, które mają jakikolwiek
            punkt. Heks bez żadnego punktu w zasięgu to osobna kategoria: jego kolor wynika z liczby
            adresów w zasięgu (tak, jakby stał tam jeden punkt), a dymek mówi wprost, że punktu nie
            ma. Dokładne liczby zobaczysz po wskazaniu miejsca na mapie.
          </p>
        </div>
        <div className="biznes-wybor">
          <label className="biznes-branza">
            Branża
            <select
              value={idBranzy}
              disabled={!katalog}
              onChange={(e) => ustawBranze(e.target.value)}
            >
              {katalog ? (
                grupujBranze(katalog.branze).map((g) => (
                  <optgroup label={g.nazwa} key={g.id}>
                    {g.branze.map((b) => (
                      <option value={b.id} key={b.id}>
                        {b.nazwa}
                      </option>
                    ))}
                  </optgroup>
                ))
              ) : (
                <option value={idBranzy}>Wczytuję listę branż…</option>
              )}
            </select>
          </label>
          <FiltryKonkurencji idBranzy={idBranzy} filtry={filtry} meta={meta} onZmien={setFiltry} />
        </div>
      </div>
      {blad && (
        <p role="alert" className="komunikat">
          {blad}
        </p>
      )}
      {nieznana && (
        <p role="status" className="biznes-komunikat">
          Link wskazuje branżę „{branza}”, której nie ma w katalogu. Pokazuję „{nazwaBranzy}”.
        </p>
      )}
      <div className="biznes-uklad">
        <div className="biznes-mapa">
          <div className="biznes-sterowanie">
            <span>Stawiasz miejsce:</span>
            <button type="button" aria-pressed={aktywny === 'a'} onClick={() => setAktywny('a')}>
              A
            </button>
            <button type="button" aria-pressed={aktywny === 'b'} onClick={() => setAktywny('b')}>
              B
            </button>
            <span role="status">{meta ? podpisPunktow(meta) : 'Wczytuję dane…'}</span>
          </div>
          <Suspense fallback={<p role="status">Wczytuję mapę…</p>}>
            <MapaKrakowa
              heksy={heksy}
              podpisWarstwy="Adresy w zasięgu na 1 punkt: więcej = słabiej obsłużone"
              punktyUslug={punkty}
              postawionePunkty={postawione}
              onPrzesunPunkt={(id, lon, lat) => {
                // Przeciągnięcie i strzałki nie wypchną punktu poza obszar, który przyjmuje link.
                const [l, b] = ograniczDoGranic(lon, lat)
                ustawPunktBiznesu(id, { lon: l, lat: b })
              }}
              onUsunPunkt={(id) => ustawPunktBiznesu(id, null)}
              onKlik={postaw}
              opisHeksu={(heksyR10, res) =>
                opisHeksuBiznesu(
                  heksyR10.flatMap((h) => opisy.get(h) ?? []),
                  res,
                  zasiegM,
                )
              }
              etykietySkali={skala}
            />
          </Suspense>
        </div>
        <aside className="biznes-panel">
          <form
            onSubmit={(e) => {
              e.preventDefault()
              postaw(Number(lonTekst), Number(latTekst))
            }}
          >
            <strong>Postaw punkt {aktywny.toUpperCase()} współrzędnymi</strong>
            <label>
              Długość geograficzna{' '}
              <input
                type="number"
                step="0.000001"
                min={GRANICE_PUNKTU.lonMin}
                max={GRANICE_PUNKTU.lonMax}
                value={lonTekst}
                onChange={(e) => setLonTekst(e.target.value)}
              />
            </label>
            <label>
              Szerokość geograficzna{' '}
              <input
                type="number"
                step="0.000001"
                min={GRANICE_PUNKTU.latMin}
                max={GRANICE_PUNKTU.latMax}
                value={latTekst}
                onChange={(e) => setLatTekst(e.target.value)}
              />
            </label>
            <button type="submit">Oceń miejsce {aktywny.toUpperCase()}</button>
          </form>
          <div className="biznes-porownanie">
            <Ocena
              id="A"
              punkt={punktA}
              ocena={ocenaA}
              branza={idBranzy}
              konkurencja={konkurencja}
              zFiltrow={zFiltrow}
              zasiegM={zasiegM}
              onUsun={() => ustawPunktBiznesu('a', null)}
            />
            <Ocena
              id="B"
              punkt={punktB}
              ocena={ocenaB}
              branza={idBranzy}
              konkurencja={konkurencja}
              zFiltrow={zFiltrow}
              zasiegM={zasiegM}
              onUsun={() => ustawPunktBiznesu('b', null)}
            />
          </div>
        </aside>
      </div>
      <footer className="biznes-zrodla">
        <h2>Źródła danych</h2>
        <ul>
          {zrodla.map((z) => (
            <li key={z.nazwa}>
              {z.url ? (
                <a href={z.url} target="_blank" rel="noopener noreferrer">
                  {z.nazwa}
                </a>
              ) : (
                z.nazwa
              )}
              {z.opis && <span className="biznes-zrodlo-opis"> ({z.opis})</span>}
            </li>
          ))}
        </ul>
        <p>
          Wskaźnik popytu: adresy, szacowana ludność z siatki NSP 2021 (1 km) i kursy w porannym
          szczycie. Ludność z każdego oczka rozdzielono równomiernie między adresy; nie jest to
          pomiar mieszkańców w budynkach. Odległości są w linii prostej. Model nie zna czynszu
          lokalu, witryny, marki ani rzeczywistego ruchu pieszych. To wstępna selekcja miejsc, nie
          biznesplan.
        </p>
      </footer>
    </main>
  )
}

/** „812 z 2 619 punktów” przy filtrach, „2 619 punktów” bez nich. */
function podpisPunktow(meta: MetaBranzy): string {
  return meta.poFiltrach < meta.wPliku
    ? `${LICZBA.format(meta.poFiltrach)} z ${LICZBA.format(meta.wPliku)} punktów`
    : `${LICZBA.format(meta.wPliku)} punktów`
}

const ZNAK_CZYNNIKA = { za: 'Za', przeciw: 'Przeciw', neutralny: 'Neutralnie' } as const

function Ocena({
  id,
  punkt,
  ocena,
  branza,
  konkurencja,
  zFiltrow,
  zasiegM,
  onUsun,
}: {
  id: string
  punkt: Punkt | null
  ocena: OcenaMiejsca | null
  branza: string
  /** Dopełniacz mnogi tego, z czym porównano miejsce (po filtrach flagowych). */
  konkurencja: string
  /** Zdanie o aktywnych filtrach konkurencji albo `null`. */
  zFiltrow: string | null
  zasiegM: number
  onUsun: () => void
}) {
  if (!punkt)
    return (
      <section className="biznes-ocena biznes-pusta">
        <h2>Miejsce {id}</h2>
        <p>Postaw punkt na mapie lub wpisz współrzędne.</p>
      </section>
    )
  const rozbicie = ocena ? rozbicieZasiegu(ocena) : null
  return (
    <section className="biznes-ocena">
      <div className="biznes-ocena-top">
        <h2>Miejsce {id}</h2>
        <button type="button" onClick={onUsun} aria-label={`Usuń miejsce ${id}`}>
          Usuń
        </button>
      </div>
      <p className="biznes-wspolrzedne">
        {punkt.lat.toFixed(5)}, {punkt.lon.toFixed(5)}
      </p>
      {ocena && rozbicie ? (
        <>
          <div className="biznes-glowna">
            <PozycjaMiejsca ocena={ocena} branza={branza} konkurencja={konkurencja} />
            {zFiltrow && <p className="biznes-glowna-filtry">{zFiltrow}</p>}
          </div>
          <dl>
            <div>
              <dt>Adresy w zasięgu{zasiegM ? ` ${zasiegM} m` : ''}</dt>
              <dd>{LICZBA.format(rozbicie.adresyWZasiegu)}</dd>
            </div>
            <div>
              <dt>z tego przypada temu miejscu</dt>
              <dd>
                {LICZBA.format(rozbicie.toMiejsce)} ({rozbicie.procentToMiejsce}%)
              </dd>
            </div>
            <div>
              <dt>z tego przypada konkurentom</dt>
              <dd>
                {LICZBA.format(rozbicie.konkurenci)} ({rozbicie.procentKonkurenci}%)
              </dd>
            </div>
            <div>
              <dt>Konkurenci w zasięgu</dt>
              <dd>{ocena.konkurenci}</dd>
            </div>
            <div>
              <dt>Szacowana ludność w zasięgu (NSP 2021)</dt>
              <dd>{LICZBA.format(ocena.mieszkancyWZasiegu)}</dd>
            </div>
            <div>
              <dt>Kursy w szczycie, średnio</dt>
              <dd>{ocena.kursySzczytSrednio.toFixed(1)}</dd>
            </div>
          </dl>
          <h3 className="biznes-czynniki-naglowek">Co przemawia za i przeciw</h3>
          <ul className="biznes-czynniki">
            {czynnikiOceny(ocena, zasiegM).map((c) => (
              <li key={c.tekst} className={`biznes-czynnik biznes-czynnik--${c.kierunek}`}>
                <strong>{ZNAK_CZYNNIKA[c.kierunek]}:</strong> {c.tekst}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p role="status">Liczenie wyniku…</p>
      )}
    </section>
  )
}

/** Główna liczba karty: pozycja wśród istniejących punktów, z kierunkiem wypisanym słowami. */
function PozycjaMiejsca({
  ocena,
  branza,
  konkurencja,
}: {
  ocena: OcenaMiejsca
  branza: string
  konkurencja: string
}) {
  if (ocena.percentyl === null)
    return (
      <p>
        {ocena.adresyWZasiegu === 0
          ? 'Brak danych o popycie w zasięgu tego miejsca (dane obejmują Kraków i okolice), więc nie da się go porównać z istniejącymi punktami.'
          : 'Brak istniejących punktów tej branży z popytem w zasięgu, więc nie ma z czym porównać tego miejsca.'}
      </p>
    )
  const z = zdaniePozycji(ocena.percentyl, branza, konkurencja)
  return (
    <p>
      {z.przed} <strong>{z.liczba}</strong> {z.po}
    </p>
  )
}
