import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { type BialaPlama, type OcenaMiejsca, type PunktUslugi, progNasycenia } from '@/wynik/biznes'
import { useStan, ustawBranze, ustawPunktBiznesu } from '@/wynik/stan'
import './biznes.css'

const MapaKrakowa = lazy(async () => ({
  default: (await import('@/mapa/MapaKrakowa')).MapaKrakowa,
}))
type Punkt = { lon: number; lat: number }
type Meta = {
  id: string
  nazwa: string
  zasiegM: number
  liczbaPunktow: number
  dataDanych: string
}
const PUSTE_HEKSY: ReadonlyMap<string, number | null> = new Map()

export function EkranBiznes() {
  const branza = useStan((s) => s.branza)
  const punktA = useStan((s) => s.punktA)
  const punktB = useStan((s) => s.punktB)
  const [katalog, setKatalog] = useState<Meta[]>([])
  const [meta, setMeta] = useState<Meta | null>(null)
  const [punkty, setPunkty] = useState<{ lon: number; lat: number; nazwa: string }[]>([])
  const [heksy, setHeksy] = useState<ReadonlyMap<string, number | null>>(PUSTE_HEKSY)
  const [opisy, setOpisy] = useState<Map<string, BialaPlama>>(new Map())
  const [skala, setSkala] = useState<readonly [string, string, string]>(['0', '50', '100'])
  const [ocenaA, setOcenaA] = useState<OcenaMiejsca | null>(null)
  const [ocenaB, setOcenaB] = useState<OcenaMiejsca | null>(null)
  const [blad, setBlad] = useState('')
  const [aktywny, setAktywny] = useState<'a' | 'b'>('a')
  const [lonTekst, setLonTekst] = useState('19.940000')
  const [latTekst, setLatTekst] = useState('50.060000')
  const worker = useRef<Worker | null>(null)
  const wersja = useRef(0)
  const punktyRef = useRef({ punktA, punktB })
  punktyRef.current = { punktA, punktB }

  useEffect(() => {
    const wybrany = aktywny === 'a' ? punktA : punktB
    if (wybrany) {
      setLonTekst(wybrany.lon.toFixed(6))
      setLatTekst(wybrany.lat.toFixed(6))
    }
  }, [aktywny, punktA, punktB])

  useEffect(() => {
    fetch('/dane/biznes/katalog.json')
      .then((r) => {
        if (!r.ok) throw new Error('HTTP ' + r.status)
        return r.json() as Promise<Meta[]>
      })
      .then(setKatalog)
      .catch((e) => setBlad('Brak katalogu branż: ' + String(e)))
  }, [])

  useEffect(() => {
    const w = new Worker(new URL('../../wynik/biznes.worker.ts', import.meta.url), {
      type: 'module',
    })
    worker.current = w
    w.onmessage = (event: MessageEvent) => {
      const d = event.data
      if (d.typ === 'blad') {
        setBlad(d.blad)
        return
      }
      if (d.typ === 'gotowe') {
        wersja.current = d.wersja
        setMeta(d.meta)
        setPunkty((d.punkty as PunktUslugi[]).map(([lon, lat, nazwa]) => ({ lon, lat, nazwa })))
        const plamy = d.plamy as BialaPlama[]
        setHeksy(new Map(plamy.map((p) => [p.h3, p.skala])))
        setOpisy(new Map(plamy.map((p) => [p.h3, p])))
        const prog = progNasycenia(plamy.map((p) => p.adresyNaPunkt))
        setSkala(['0', String(Math.round(prog / 2)), `${Math.round(prog)}+`])
        const { punktA: a, punktB: b } = punktyRef.current
        if (a) w.postMessage({ typ: 'ocen', id: 'a', punkt: a, wersja: d.wersja })
        if (b) w.postMessage({ typ: 'ocen', id: 'b', punkt: b, wersja: d.wersja })
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

  useEffect(() => {
    wersja.current = 0
    setBlad('')
    setMeta(null)
    setOcenaA(null)
    setOcenaB(null)
    worker.current?.postMessage({ typ: 'init', branza })
  }, [branza])

  useEffect(() => {
    setOcenaA(null)
    if (punktA && wersja.current)
      worker.current?.postMessage({ typ: 'ocen', id: 'a', punkt: punktA, wersja: wersja.current })
  }, [punktA])
  useEffect(() => {
    setOcenaB(null)
    if (punktB && wersja.current)
      worker.current?.postMessage({ typ: 'ocen', id: 'b', punkt: punktB, wersja: wersja.current })
  }, [punktB])

  function postaw(lon: number, lat: number) {
    if (
      !Number.isFinite(lon) ||
      !Number.isFinite(lat) ||
      lon < 19.3 ||
      lon > 20.8 ||
      lat < 49.7 ||
      lat > 50.5
    )
      return
    ustawPunktBiznesu(aktywny, { lon, lat })
    if (aktywny === 'a') setAktywny('b')
  }

  const postawione = [
    ...(punktA ? [{ id: 'a' as const, ...punktA }] : []),
    ...(punktB ? [{ id: 'b' as const, ...punktB }] : []),
  ]
  const nazwaBranzy = meta?.nazwa ?? katalog.find((m) => m.id === branza)?.nazwa ?? 'branży'

  return (
    <main className="biznes">
      <div className="biznes-glowa">
        <div>
          <p className="biznes-etykieta">TRYB BIZNESOWY</p>
          <h1 tabIndex={-1}>Lokalizacja dla branży „{nazwaBranzy}”</h1>
          <p>
            Wybierz branżę, a następnie postaw punkt A lub B na mapie. Kolor pokazuje liczbę adresów
            w zasięgu na jeden istniejący punkt. Najmocniejszy kolor zaczyna się przy 95.
            percentylu; dokładną liczbę zobaczysz po wskazaniu miejsca na mapie.
          </p>
        </div>
        <label className="biznes-branza">
          Branża
          <select value={branza} onChange={(e) => ustawBranze(e.target.value)}>
            {katalog.map((m) => (
              <option value={m.id} key={m.id}>
                {m.nazwa}
              </option>
            ))}
          </select>
        </label>
      </div>
      {blad && (
        <p role="alert" className="komunikat">
          {blad}
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
            <span>
              {meta
                ? meta.liczbaPunktow.toLocaleString('pl-PL') + ' punktów OSM'
                : 'Wczytuję dane…'}
            </span>
          </div>
          <Suspense fallback={<p role="status">Wczytuję mapę…</p>}>
            <MapaKrakowa
              heksy={heksy}
              podpisWarstwy="Adresy na istniejący punkt (95. percentyl)"
              punktyUslug={punkty}
              postawionePunkty={postawione}
              onPrzesunPunkt={(id, lon, lat) => ustawPunktBiznesu(id, { lon, lat })}
              onKlik={postaw}
              opisHeksu={(heksyR10, res) => {
                const p = res === 10 ? opisy.get(heksyR10[0] ?? '') : undefined
                const wartosci = heksyR10
                  .map((h) => heksy.get(h))
                  .filter((w): w is number => w != null)
                const wartosc = wartosci.length
                  ? wartosci.reduce((a, b) => a + b, 0) / wartosci.length
                  : null
                if (!p && wartosc === null) return 'Brak danych'
                return p
                  ? Math.round(p.adresyNaPunkt) +
                      ' adresów na punkt · ' +
                      p.konkurenci +
                      ' punktów · najbliżej: ' +
                      (p.konkurenci === 0
                        ? 'brak punktu w zasięgu'
                        : (p.najblizszyKonkurent ?? 'punkt bez nazwy'))
                  : 'Indeks luki: ' + Math.round(wartosc ?? 0) + '/100'
              }}
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
                min="19.3"
                max="20.8"
                value={lonTekst}
                onChange={(e) => setLonTekst(e.target.value)}
              />
            </label>
            <label>
              Szerokość geograficzna{' '}
              <input
                type="number"
                step="0.000001"
                min="49.7"
                max="50.5"
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
              onUsun={() => ustawPunktBiznesu('a', null)}
            />
            <Ocena
              id="B"
              punkt={punktB}
              ocena={ocenaB}
              onUsun={() => ustawPunktBiznesu('b', null)}
            />
          </div>
        </aside>
      </div>
      <p className="biznes-zrodlo">
        Punkty: © OpenStreetMap contributors, wyciąg Geofabrik z {meta?.dataDanych ?? '—'} (ODbL).
        Wskaźnik popytu: adresy, szacowana ludność z siatki NSP 2021 (1 km) i kursy w porannym
        szczycie. Ludność z każdego oczka rozdzielono równomiernie między adresy; nie jest to pomiar
        mieszkańców w budynkach. Odległości są w linii prostej. Model nie zna czynszu lokalu,
        witryny, marki ani rzeczywistego ruchu pieszych. To wstępna selekcja miejsc, nie biznesplan.
      </p>
    </main>
  )
}

function Ocena({
  id,
  punkt,
  ocena,
  onUsun,
}: {
  id: string
  punkt: Punkt | null
  ocena: OcenaMiejsca | null
  onUsun: () => void
}) {
  if (!punkt)
    return (
      <section className="biznes-ocena biznes-pusta">
        <h2>Miejsce {id}</h2>
        <p>Postaw punkt na mapie lub wpisz współrzędne.</p>
      </section>
    )
  return (
    <section className="biznes-ocena">
      <div className="biznes-ocena-top">
        <h2>Miejsce {id}</h2>
        <button type="button" onClick={onUsun}>
          Usuń
        </button>
      </div>
      <p className="biznes-wspolrzedne">
        {punkt.lat.toFixed(5)}, {punkt.lon.toFixed(5)}
      </p>
      {ocena ? (
        <>
          <div className="biznes-glowna">
            <strong>{ocena.percentyl}%</strong>
            <span>percentyl indeksu popytu na tle istniejących punktów tej branży</span>
          </div>
          <dl>
            <div>
              <dt>Adresy w zasięgu</dt>
              <dd>{Math.round(ocena.adresyWZasiegu).toLocaleString('pl-PL')}</dd>
            </div>
            <div>
              <dt>Szacowana ludność w zasięgu (NSP 2021)</dt>
              <dd>{Math.round(ocena.mieszkancyWZasiegu).toLocaleString('pl-PL')}</dd>
            </div>
            <div>
              <dt>Kursy w szczycie, średnio</dt>
              <dd>{ocena.kursySzczytSrednio.toFixed(1)}</dd>
            </div>
            <div>
              <dt>Konkurenci w zasięgu</dt>
              <dd>{ocena.konkurenci}</dd>
            </div>
            <div>
              <dt>Szacowany udział adresów</dt>
              <dd>{ocena.udzialProcent}%</dd>
            </div>
            <div>
              <dt>Przydzielone adresy</dt>
              <dd>{Math.round(ocena.przydzieloneAdresy).toLocaleString('pl-PL')}</dd>
            </div>
          </dl>
          <p className="biznes-czynniki">
            {ocena.percentyl >= 70
              ? 'Za: wysoka pozycja na tle istniejących punktów.'
              : 'Przeciw: umiarkowana pozycja na tle istniejących punktów.'}{' '}
            {ocena.odlegloscKonkurenta !== null
              ? 'Najbliższy konkurent: ' +
                (ocena.najblizszyKonkurent ?? 'punkt bez nazwy') +
                ' (' +
                ocena.odlegloscKonkurenta +
                ' m).'
              : 'Brak konkurenta w zasięgu.'}
          </p>
        </>
      ) : (
        <p role="status">Liczenie wyniku…</p>
      )}
    </section>
  )
}
