import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { bazaDanych } from '@/kontrakty'
import {
  type BialaPlama,
  czynnikiOceny,
  type OcenaMiejsca,
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
  type KatalogUslug,
  type MetaBranzy,
} from '@/wynik/biznesUslugi'
import { nastepneWolne, ograniczDoGranic, postawionePunkty } from '@/wynik/biznesZnaczniki'
import { menedzerObliczen, type Uchwyt } from '@/wynik/menedzerObliczen'
import { useMiasto, useTylkoKrakow } from '@/wynik/miastoDanych'
import { sciezkaKataloguUslug } from '@/wynik/sciezkiDanych'
import {
  useStan,
  ustawBranze,
  ustawFiltryBiznesu,
  ustawMiasto,
  ustawPunktBiznesu,
} from '@/wynik/stan'
import { GRANICE_PUNKTU, ID_MIEJSC, type IdMiejsca, wGranicachPunktu } from '@/wynik/url'
import { FiltryKonkurencji } from './FiltryKonkurencji'
import './biznes.css'

const MapaKrakowa = lazy(async () => ({
  default: (await import('@/mapa/MapaKrakowa')).MapaKrakowa,
}))
type Punkt = { lon: number; lat: number }
const PUSTE_HEKSY: ReadonlyMap<string, number | null> = new Map()
const LICZBA = new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 0 })

/**
 * Tryb Biznes ocenia miejsce popytem (szacowana ludność z NSP 2021 i kursy w szczycie), który policzono
 * tylko dla Krakowa i okolicznych gmin (D8, #223). W innym mieście ekran mówi to wprost i pozwala wrócić,
 * zamiast pytać worker o plik, którego nie ma, i pokazywać puste albo zerowe wyniki. Rozgałęzienie jest
 * tu, a nie w środku ekranu, żeby nie ruszać kolejności jego hooków.
 */
export function EkranBiznes() {
  return useTylkoKrakow() ? <BiznesTylkoKrakow /> : <BiznesZPopytem />
}

function BiznesTylkoKrakow() {
  const miasto = useMiasto()
  return (
    <main className="biznes">
      <div className="biznes-glowa">
        <div>
          <p className="biznes-etykieta">TRYB BIZNESOWY</p>
          <h1 tabIndex={-1}>Tryb Biznes na razie tylko w Krakowie</h1>
          <p>
            Ocena miejsca opiera się na popycie: szacowanej ludności z siatki NSP 2021 i kursach w
            porannym szczycie. Policzyliśmy go na razie tylko dla Krakowa i okolicznych gmin, więc{' '}
            {miasto.wMiescie} tryb Biznes jeszcze nie działa. Nie pokazujemy tu pustych ani zerowych
            wyników.
          </p>
          <p>
            <button type="button" className="seg" onClick={() => ustawMiasto('krakow')}>
              Pokaż Kraków
            </button>
          </p>
        </div>
      </div>
    </main>
  )
}

function BiznesZPopytem() {
  // Katalog danych zbioru, z którego ekran bierze katalog branż, a worker popyt i pliki branż (worker nie
  // zna bieżącego miasta, więc dostaje katalog w wiadomości). Ten ekran żyje tylko w mieście z popytem.
  const baza = bazaDanych(useMiasto().slug)
  const branza = useStan((s) => s.branza)
  const miejsca = useStan((s) => s.miejsca)
  // Filtry konkurencji żyją w stanie aplikacji i w linku (`k=`, #108): odświeżenie strony i skopiowany
  // link zachowują wybór, a wyjście z ekranu go nie kasuje.
  const filtry = useStan((s) => s.filtryBiznesu)
  const [katalog, setKatalog] = useState<KatalogUslug | null>(null)
  const [meta, setMeta] = useState<MetaBranzy | null>(null)
  const [punkty, setPunkty] = useState<{ lon: number; lat: number; nazwa: string }[]>([])
  const [heksy, setHeksy] = useState<ReadonlyMap<string, number | null>>(PUSTE_HEKSY)
  const [opisy, setOpisy] = useState<Map<string, BialaPlama>>(new Map())
  const [zrodlaPopytu, setZrodlaPopytu] = useState<ZrodloDanych[]>([])
  const [skala, setSkala] = useState<readonly [string, string, string]>(['0', '50', '100'])
  const [oceny, setOceny] = useState<Partial<Record<IdMiejsca, OcenaMiejsca>>>({})
  const [blad, setBlad] = useState('')
  const [aktywny, setAktywny] = useState<IdMiejsca>(
    () => ID_MIEJSC.find((_, i) => !miejsca[i]) ?? 'a',
  )
  const [lonTekst, setLonTekst] = useState('19.940000')
  const [latTekst, setLatTekst] = useState('50.060000')
  // Wersja wczytanej branży (0 = nic nie wczytano). Oceny liczymy dopiero po jej ustawieniu,
  // więc punkty z linku i punkty postawione w trakcie ładowania są oceniane tą samą ścieżką.
  const [gotowa, setGotowa] = useState(0)
  // Uchwyt do wspólnego workera obliczeń (Miasto i Biznes, #108); żyje tyle, ile ten ekran.
  const worker = useRef<Uchwyt<'biznes'> | null>(null)
  const wersja = useRef(0)
  const wczytanaBranza = useRef<string | null>(null)

  // Stary link (`b=sklep`) i id spoza katalogu przechodzą przez moduł branż; `url.ts` czyta
  // parametr bez zmian, więc stan może trzymać stare id, a ekran wczytuje już nowy plik.
  const idBranzy = rozwiazBranze(
    branza,
    katalog?.branze.map((b) => b.id),
  )
  const wpisBranzy = katalog?.branze.find((b) => b.id === idBranzy) ?? null

  // Pola współrzędnych podążają za aktywnym punktem, a nie za każdą zmianą pozostałych.
  const wybrany = miejsca[ID_MIEJSC.indexOf(aktywny)] ?? null
  useEffect(() => {
    if (wybrany) {
      setLonTekst(wybrany.lon.toFixed(6))
      setLatTekst(wybrany.lat.toFixed(6))
    }
  }, [wybrany])

  useEffect(() => {
    fetch(sciezkaKataloguUslug(baza))
      .then((r) => {
        if (!r.ok) throw new Error('HTTP ' + r.status)
        return r.json() as Promise<unknown>
      })
      .then((dane) => setKatalog(czytajKatalog(dane)))
      .catch((e) => setBlad('Brak katalogu branż: ' + (e instanceof Error ? e.message : String(e))))
  }, [baza])

  useEffect(() => {
    const w = menedzerObliczen.otworz('biznes')
    worker.current = w
    if (!w) {
      setBlad('Obliczenia w tle są niedostępne w tej przeglądarce, więc nie da się ocenić miejsca.')
      return
    }
    const zdejmijOdpowiedzi = w.nasluchuj((d) => {
      if (d.typ === 'blad') {
        setBlad(d.blad)
        return
      }
      if (d.typ === 'gotowe') {
        wersja.current = d.wersja
        setMeta(d.meta)
        setPunkty(d.punkty.map(([lon, lat, nazwa]) => ({ lon, lat, nazwa })))
        setZrodlaPopytu(d.zrodla)
        const plamy: BialaPlama[] = d.plamy
        setHeksy(new Map(plamy.map((p) => [p.h3, p.skala])))
        setOpisy(new Map(plamy.map((p) => [p.h3, p])))
        const prog = progSkaliPlam(plamy)
        setSkala(['0', String(Math.round(prog / 2)), `${Math.round(prog)}+`])
        setGotowa(d.wersja)
      }
      if (d.typ === 'ocena' && d.wersja === wersja.current) {
        const id = d.id as IdMiejsca
        setOceny((o) => ({ ...o, [id]: d.ocena as OcenaMiejsca }))
      }
    })
    // Worker, który się nie załadował albo padł, nie wróci w tym oknie – mówimy to wprost.
    const zdejmijBlad = w.naBledzie((blad) =>
      setBlad(`Obliczenia w tle przestały działać: ${blad}`),
    )
    // Popyt (największy plik) zaczyna się pobierać razem z katalogiem, przed wyborem branży.
    w.wyslij({ typ: 'start', baza })
    return () => {
      zdejmijOdpowiedzi()
      zdejmijBlad()
      worker.current = null
      w.zwolnij()
    }
  }, [baza])

  // Worker dostaje wybór dopiero po katalogu: id spoza katalogu wraca wtedy do domyślnej branży
  // (`rozwiazBranze`), zamiast kończyć się błędem 404. Zmiana branży czyści meta i oceny, a zmiana
  // samych filtrów zostawia je do czasu nowych (jak przesunięcie punktu), bez migania karty.
  useEffect(() => {
    // Bez workera komunikat o jego braku stoi od otwarcia uchwytu i nie ma kogo pytać o branżę.
    if (!katalog || !worker.current) return
    if (wczytanaBranza.current !== idBranzy) {
      wczytanaBranza.current = idBranzy
      setMeta(null)
      setOceny({})
    }
    wersja.current = 0
    setGotowa(0)
    setBlad('')
    worker.current?.wyslij({ typ: 'init', baza, branza: idBranzy, filtry })
  }, [katalog, idBranzy, filtry, baza])

  // Przesunięcie punktu zostawia poprzednią ocenę do czasu nowej (bez migania karty przy każdym
  // kroku strzałki); wyczyszczenie jej wymaga usunięcia punktu albo zmiany branży. Wysyłamy tylko
  // miejsca, które zmieniły się od ostatniej wysyłki (albo wszystkie po wczytaniu nowej branży).
  const wyslane = useRef<{ wersja: number; miejsca: readonly (Punkt | null)[] }>({
    wersja: 0,
    miejsca: [],
  })
  useEffect(() => {
    const poprzednie = wyslane.current
    const usuniete = ID_MIEJSC.filter((_, i) => !miejsca[i])
    if (usuniete.length)
      setOceny((o) =>
        usuniete.some((id) => o[id])
          ? Object.fromEntries(
              Object.entries(o).filter(([id]) => !usuniete.includes(id as IdMiejsca)),
            )
          : o,
      )
    if (!gotowa) return
    ID_MIEJSC.forEach((id, i) => {
      const punkt = miejsca[i]
      if (!punkt) return
      if (poprzednie.wersja === gotowa && poprzednie.miejsca[i] === punkt) return
      worker.current?.wyslij({ typ: 'ocen', id, punkt, wersja: gotowa })
    })
    wyslane.current = { wersja: gotowa, miejsca }
  }, [miejsca, gotowa])

  const wszystkieZajete = miejsca.every(Boolean)

  function postaw(lon: number, lat: number) {
    if (!wGranicachPunktu(lon, lat)) return
    ustawPunktBiznesu(aktywny, { lon, lat })
    // Następny klik stawia kolejne wolne miejsce; gdy wszystkie zajęte, przesuwa aktywne.
    const nastepne = nastepneWolne(
      miejsca.map((p, i) => (ID_MIEJSC[i] === aktywny ? { lon, lat } : p)),
      aktywny,
    )
    if (nastepne) setAktywny(nastepne)
  }

  const postawione = postawionePunkty(miejsca)
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
            Wybierz branżę, a następnie postaw na mapie do {ID_MIEJSC.length} miejsc testowych (A–E)
            i porównaj je ze sobą. Kolor pokazuje liczbę adresów w zasięgu na jeden istniejący
            punkt: im ciemniejszy, tym słabiej obsłużony popyt. Najmocniejszy kolor zaczyna się przy
            95. percentylu heksów, które mają jakikolwiek punkt. Heks bez żadnego punktu w zasięgu
            to osobna kategoria: jego kolor wynika z liczby adresów w zasięgu (tak, jakby stał tam
            jeden punkt), a dymek mówi wprost, że punktu nie ma. Dokładne liczby zobaczysz po
            wskazaniu miejsca na mapie.
          </p>
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
        <div className="biznes-kolumna-mapy" data-sekcja="biznes-mapa">
          <div className="biznes-sterowanie">
            <span>Stawiasz miejsce:</span>
            {ID_MIEJSC.map((id, i) => (
              <button
                key={id}
                type="button"
                data-cel="wybierz-miejsce"
                aria-pressed={aktywny === id}
                aria-label={`Miejsce ${id.toUpperCase()}${miejsca[i] ? ' (postawione)' : ''}`}
                data-postawione={miejsca[i] ? '' : undefined}
                onClick={() => setAktywny(id)}
              >
                {id.toUpperCase()}
              </button>
            ))}
            {wszystkieZajete && (
              <span className="biznes-limit">
                Wszystkie {ID_MIEJSC.length} miejsca zajęte – klik przesuwa {aktywny.toUpperCase()}.
              </span>
            )}
            <span role="status">{meta ? podpisPunktow(meta) : 'Wczytuję dane…'}</span>
          </div>
          <div className="biznes-mapa">
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
        </div>
        <aside className="biznes-panel" data-sekcja="biznes-formularz">
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
            <FiltryKonkurencji
              idBranzy={idBranzy}
              filtry={filtry}
              meta={meta}
              onZmien={ustawFiltryBiznesu}
            />
          </div>
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
            <button type="submit" data-cel="ocen-miejsce">
              Oceń miejsce {aktywny.toUpperCase()}
            </button>
          </form>
        </aside>
      </div>
      <div className="biznes-porownanie" data-sekcja="biznes-oceny">
        {ID_MIEJSC.map((id, i) => {
          const punkt = miejsca[i] ?? null
          // Puste karty pokazujemy tylko dla A, B i aktywnego miejsca – pięć pustych kart
          // spychałoby oceny poza ekran.
          if (!punkt && i > 1 && id !== aktywny) return null
          return (
            <Ocena
              key={id}
              id={id.toUpperCase()}
              punkt={punkt}
              ocena={oceny[id] ?? null}
              branza={idBranzy}
              konkurencja={konkurencja}
              zFiltrow={zFiltrow}
              zasiegM={zasiegM}
              onUsun={() => {
                ustawPunktBiznesu(id, null)
                setAktywny(id)
              }}
            />
          )
        })}
      </div>
      <footer className="biznes-zrodla" data-sekcja="biznes-zrodla">
        <h2>Źródła danych</h2>
        <ul>
          {zrodla.map((z) => (
            <li key={z.nazwa}>
              {z.url ? (
                <a href={z.url} target="_blank" rel="noopener noreferrer" data-cel="otworz-zrodlo">
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
        <button
          type="button"
          data-cel="usun-miejsce"
          onClick={onUsun}
          aria-label={`Usuń miejsce ${id}`}
        >
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
