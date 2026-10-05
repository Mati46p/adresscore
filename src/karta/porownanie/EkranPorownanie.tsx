import { useEffect, useId, useMemo, useState } from 'react'
import { liczba, opisAdresu } from '@/karta/adres'
import { PanelFiltrow } from '@/karta/panel/PanelFiltrow'
import { etykietaKierunku } from '@/karta/panel/preferencje'
import { Wyszukiwarka } from '@/karta/wyszukiwarka/Wyszukiwarka'
import { KATEGORIE } from '@/kontrakty'
import { udostepnienie } from '@/pomiar/pomiar.ts'
import { useDane } from '@/wynik/dane'
import { ocenFiltr, opisFiltru, type TwardyFiltr } from '@/wynik/filtry'
import { miejsceAdresu } from '@/wynik/miejsceAdresu'
import type { RozbicieWarstwy } from '@/wynik/silnik'
import { wynikAdresu } from '@/wynik/silnik'
import { dodajDoPorownania, hrefDla, useStan, usunZPorownania } from '@/wynik/stan'
import { MAKS_POROWNANIE } from '@/wynik/url'
import { useWyniki } from '@/wynik/useWyniki'
import {
  type OkolicaPorownania,
  OSIE,
  priorytety,
  punktyRadaru,
  RADAR_X,
  RADAR_Y,
  ranking,
  warstwyPorownania,
  werdykt,
} from './model'
import './porownanie.css'

const KOLORY = ['#176448', '#bc6b38', '#4b67a1', '#9a5f91', '#697a2e']

const POMIAR = new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 2 })

function opisPomiaru(w: RozbicieWarstwy | undefined): string {
  if (!w || w.wartosc === null) return 'Brak danych'
  return `${POMIAR.format(w.wartosc)}${w.meta.jednostka ? ` ${w.meta.jednostka}` : ''}`
}

function TabelaAtrybutow({
  okolice,
  filtry,
  wykluczone,
}: {
  okolice: readonly OkolicaPorownania[]
  filtry: readonly TwardyFiltr[]
  wykluczone: ReadonlySet<string>
}) {
  const grupy = warstwyPorownania(okolice[0]!.wynik)
  return (
    <section
      className="porownanie-tabela"
      aria-labelledby="porownanie-tabela-h"
      data-sekcja="porownanie-tabela"
    >
      <h2 id="porownanie-tabela-h">Pełna tabela atrybutów</h2>
      <p>
        Wszystkie dostępne warstwy dla porównywanych adresów. Waga 0 i warstwy informacyjne nie
        zmieniają wyniku; brak danych nie jest zerem. Przewiń tabelę w bok, aby zobaczyć kolejne
        adresy.
      </p>
      <div
        className="porownanie-tabela__przewijanie"
        role="region"
        aria-label="Tabela wszystkich atrybutów porównywanych adresów"
        tabIndex={0}
      >
        <table>
          <thead>
            <tr>
              <th scope="col">Atrybut</th>
              {okolice.map((o, i) => (
                <th key={o.id} scope="col">
                  <span
                    className="porownanie-kropka"
                    style={{ background: o.kolor ?? KOLORY[i] }}
                  />{' '}
                  {o.nazwa}
                  {wykluczone.has(o.id) && <small>Wykluczony filtrem · dane informacyjne</small>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="porownanie-tabela__okolica">
              <th scope="row">
                Okolica<small>Jednostka SIM w Krakowie, miejscowość poza nim</small>
              </th>
              {okolice.map((o) => (
                <td key={o.id}>
                  <strong>{o.miejsce?.nazwa ?? 'Brak danych'}</strong>
                  {o.miejsce?.opis && <small>{o.miejsce.opis}</small>}
                </td>
              ))}
            </tr>
            <tr className="porownanie-tabela__wynik">
              <th scope="row">
                Wynik łączny<small>Według obecnych wag</small>
              </th>
              {okolice.map((o) => (
                <td key={o.id}>
                  <strong>
                    {liczba(o.wynik.wynik)}
                    {o.wynik.litera ? ` / ${o.wynik.litera}` : ''}
                  </strong>
                  <small>Dostępność danych: {Math.round(o.wynik.pewnosc * 100)}%</small>
                </td>
              ))}
            </tr>
            {grupy.flatMap(({ kategoria, warstwy: grupa }) => {
              if (grupa.length === 0) return []
              return [
                <tr className="porownanie-tabela__grupa" key={`${kategoria}-grupa`}>
                  <th scope="rowgroup" colSpan={okolice.length + 1}>
                    {KATEGORIE[kategoria]}
                  </th>
                </tr>,
                ...grupa.map((w) => (
                  <tr key={w.id}>
                    <th scope="row">
                      {w.meta.nazwa}
                      <small>
                        {w.meta.zrodla.map((z) => z.nazwa).join(', ') || 'Źródło niepodane'} ·{' '}
                        {w.meta.rozdzielczosc}
                        {w.meta.rozmiar ? ` ${w.meta.rozmiar}` : ''}
                        {w.meta.zrodla[0]?.dataDanych
                          ? ` · stan ${w.meta.zrodla[0].dataDanych}`
                          : ''}
                      </small>
                      <small>
                        Waga {w.wagaUzytkownika}/4 ·{' '}
                        {w.kierunek ? etykietaKierunku(w.meta, w.kierunek) : 'Bez kierunku oceny'}
                        {w.meta.atrapa ? ' · dane przykładowe' : ''}
                      </small>
                    </th>
                    {okolice.map((o) => {
                      const pomiar = o.wynik.warstwy.find((x) => x.id === w.id)
                      return (
                        <td key={o.id}>
                          <strong>{opisPomiaru(pomiar)}</strong>
                          {pomiar?.etykieta && <small>{pomiar.etykieta}</small>}
                          <small>
                            {pomiar?.liczona
                              ? pomiar.ocena === null
                                ? 'Ocena: brak danych'
                                : `Ocena: ${liczba(pomiar.ocena)}/100`
                              : pomiar?.wagaUzytkownika === 0
                                ? 'Pominięte w wyniku (waga 0)'
                                : 'Informacyjnie – bez wpływu na wynik'}
                            {pomiar?.niedostepny ? ' · warstwa niedostępna' : ''}
                          </small>
                        </td>
                      )
                    })}
                  </tr>
                )),
              ]
            })}
            {filtry.length > 0 && (
              <tr className="porownanie-tabela__grupa">
                <th scope="rowgroup" colSpan={okolice.length + 1}>
                  Twarde filtry
                </th>
              </tr>
            )}
            {filtry.map((filtr) => {
              const meta = okolice[0]?.wynik.warstwy.find((w) => w.id === filtr.id)?.meta
              return (
                <tr key={`filtr-${filtr.id}`}>
                  <th scope="row">
                    {opisFiltru(filtr, meta)}
                    <small>Filtr wyklucza adres, nie obniża oceny.</small>
                  </th>
                  {okolice.map((o) => {
                    const pomiar = o.wynik.warstwy.find((w) => w.id === filtr.id)
                    const ocena = ocenFiltr(pomiar?.wartosc, filtr)
                    return (
                      <td key={o.id}>
                        <strong>
                          {ocena === 'spelnia'
                            ? 'Spełnia'
                            : ocena === 'narusza'
                              ? 'Nie spełnia'
                              : 'Nie wiadomo'}
                        </strong>
                        <small>{opisPomiaru(pomiar)}</small>
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function Radar({ okolice }: { okolice: readonly OkolicaPorownania[] }) {
  const wagi = priorytety(okolice)
  const opisId = useId()
  return (
    <div className="porownanie-wykres" data-sekcja="porownanie-wykres">
      <div
        className="porownanie-wykres__przewijanie"
        role="region"
        aria-label="Wykres radarowy"
        tabIndex={0}
      >
        <svg
          viewBox="0 0 600 450"
          role="img"
          aria-label="Radar ocen kategorii i priorytetów"
          aria-describedby={opisId}
        >
          {[25, 50, 75, 100].map((poziom) => (
            <polygon
              key={poziom}
              points={punktyRadaru(OSIE.map(() => poziom)) ?? ''}
              fill="none"
              stroke="#dce3df"
            />
          ))}
          {OSIE.map((id, i) => {
            const kat = -Math.PI / 2 + (i * 2 * Math.PI) / OSIE.length
            const x = RADAR_X + Math.cos(kat) * 140
            const y = RADAR_Y + Math.sin(kat) * 140
            const etykietaX = RADAR_X + Math.cos(kat) * 182
            return (
              <g key={id}>
                <line x1={RADAR_X} y1={RADAR_Y} x2={x} y2={y} stroke="#dce3df" />
                <text
                  x={etykietaX}
                  y={RADAR_Y + Math.sin(kat) * 182}
                  textAnchor={
                    Math.cos(kat) > 0.2 ? 'start' : Math.cos(kat) < -0.2 ? 'end' : 'middle'
                  }
                  dominantBaseline="middle"
                  fontSize="14"
                >
                  {id === 'bezpieczenstwo' ? (
                    <>
                      <tspan x={etykietaX} dy="-0.55em">
                        Bezpieczeństwo
                      </tspan>
                      <tspan x={etykietaX} dy="1.1em">
                        i ryzyko
                      </tspan>
                    </>
                  ) : (
                    KATEGORIE[id]
                  )}
                </text>
              </g>
            )
          })}
          {okolice.map((o, i) => {
            const wartosci = OSIE.map(
              (id) => o.wynik.kategorie.find((k) => k.kategoria === id)?.ocena ?? null,
            )
            const punkty = punktyRadaru(wartosci)
            return (
              punkty && (
                <polygon
                  key={o.id}
                  points={punkty}
                  fill={o.kolor ?? KOLORY[i]}
                  fillOpacity=".12"
                  stroke={o.kolor ?? KOLORY[i]}
                  strokeWidth="2.5"
                />
              )
            )
          })}
          <polygon
            points={punktyRadaru(OSIE.map((id) => wagi[id] * 100)) ?? ''}
            fill="none"
            stroke="#182c22"
            strokeWidth="2"
            strokeDasharray="5 5"
          />
        </svg>
      </div>
      <p id={opisId}>
        Przerywana linia pokazuje Twoje priorytety. Okolica z brakującą kategorią jest pokazana w
        tabeli, bez niepełnego wielokąta.
      </p>
      <details className="porownanie-wykres__tekst">
        <summary>Odczytaj wartości wykresu jako tekst</summary>
        <strong>Twoje priorytety (względem najwyższej wagi)</strong>
        <ul>
          {OSIE.map((id) => (
            <li key={id}>
              {KATEGORIE[id]}: {Math.round(wagi[id] * 100)}%
            </li>
          ))}
        </ul>
        <ul>
          {okolice.map((o) => (
            <li key={o.id}>
              <strong>{o.nazwa}</strong>
              <ul>
                {OSIE.map((id) => (
                  <li key={id}>
                    {KATEGORIE[id]}:{' '}
                    {liczba(o.wynik.kategorie.find((k) => k.kategoria === id)?.ocena)}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </details>
    </div>
  )
}

export function EkranPorownanie() {
  const dane = useDane()
  const stan = useStan((s) => s)
  const wynikiMapy = useWyniki()
  const [status, ustawStatus] = useState('')
  const [szerokiEkran, ustawSzerokiEkran] = useState(() =>
    typeof window === 'undefined' ? true : window.matchMedia('(min-width: 861px)').matches,
  )
  const [panelOtwarty, ustawPanelOtwarty] = useState(false)
  useEffect(() => {
    const media = window.matchMedia('(min-width: 861px)')
    const zmiana = () => ustawSzerokiEkran(media.matches)
    media.addEventListener('change', zmiana)
    return () => media.removeEventListener('change', zmiana)
  }, [])
  const adresyDoDodania = useMemo(() => {
    if (dane.stan !== 'gotowe') return []
    const wybrane = new Set(stan.porownanie)
    return dane.adresy.filter((adres) => !wybrane.has(adres.i))
  }, [dane, stan.porownanie])
  const okolice: (OkolicaPorownania & { i: number })[] =
    dane.stan === 'gotowe'
      ? stan.porownanie.slice(0, MAKS_POROWNANIE).flatMap((i, pozycja) => {
          const adres = dane.adresy[i]
          return adres
            ? [
                {
                  id: adres.id,
                  i,
                  kolor: KOLORY[pozycja],
                  nazwa: opisAdresu(adres),
                  // Okolica z okolice.json (jednostka SIM, miejscowość); bez pliku dzielnica albo gmina.
                  miejsce: miejsceAdresu(adres, i, dane.okolice),
                  wynik: wynikAdresu(i, dane.wskazniki, stan.wagi, stan.kierunki),
                  href: hrefDla(stan, { ekran: 'okolica', wybrany: i }),
                },
              ]
            : []
        })
      : []
  const aktywneOkolice = okolice.filter((o) => !wynikiMapy?.wykluczenia.wykluczony[o.i])
  const wykluczonych = okolice.length - aktywneOkolice.length
  const atrapa =
    dane.stan === 'gotowe' && (dane.plikAdresow.atrapa || dane.wskazniki.some((w) => w.meta.atrapa))
  // Pomiar udostępnień: element to stały id z kodu, kanał – schowek albo błąd (menu systemowego tu nie ma).
  async function kopiuj() {
    try {
      await navigator.clipboard.writeText(
        new URL(hrefDla(stan, { ekran: 'porownanie' }), location.href).href,
      )
      ustawStatus('Skopiowano link do porównania z aktualnymi wagami.')
      udostepnienie('porownanie', 'kopia')
    } catch {
      ustawStatus('Nie udało się skopiować. Skopiuj adres strony z przeglądarki.')
      udostepnienie('porownanie', 'blad')
    }
  }
  return (
    <main className="porownanie-uklad">
      <aside className="porownanie-panel" aria-label="Preferencje i filtry porównania">
        <details
          open={szerokiEkran || panelOtwarty}
          onToggle={(e) => {
            if (szerokiEkran) {
              if (!e.currentTarget.open) e.currentTarget.open = true
              return
            }
            ustawPanelOtwarty(e.currentTarget.open)
          }}
        >
          <summary tabIndex={szerokiEkran ? -1 : 0}>Preferencje i filtry</summary>
          <div className="porownanie-panel__zawartosc">
            <PanelFiltrow />
          </div>
        </details>
      </aside>
      <div className="tresc porownanie">
        <div className="porownanie-gora" data-sekcja="porownanie-naglowek">
          <div>
            <h1>Porównaj okolice pod siebie</h1>
            <p>
              Wyniki dla aktualnych wag. Filtry decydują, które adresy są porównywane. Możesz
              zestawić do {MAKS_POROWNANIE} adresów.
            </p>
          </div>
          {okolice.length > 0 && (
            <button
              className="seg"
              type="button"
              data-cel="kopiuj-link-porownania"
              onClick={kopiuj}
            >
              Kopiuj link
            </button>
          )}
        </div>
        {status && <p role="status">{status}</p>}
        {atrapa && (
          <p className="porownanie-uwaga">Dane przykładowe: część wyników pochodzi z atrapy.</p>
        )}
        {dane.stan === 'ladowanie' && <p className="komunikat">Wczytywanie danych porównania…</p>}
        {dane.stan === 'gotowe' && stan.porownanie.length < MAKS_POROWNANIE && (
          <section
            className="porownanie-dodaj"
            aria-label="Dodaj adres do porównania"
            data-sekcja="porownanie-dodaj"
          >
            <h2>Dodaj adres do porównania</h2>
            <Wyszukiwarka
              adresy={adresyDoDodania}
              mierz
              wyczyscPoWyborze
              onWybierz={(i) => {
                if (stan.porownanie.includes(i)) {
                  ustawStatus('Ten adres jest już w porównaniu.')
                  return
                }
                dodajDoPorownania(i)
                ustawStatus(`Dodano ${opisAdresu(dane.adresy[i]!)} do porównania.`)
              }}
            />
          </section>
        )}
        {stan.porownanie.length === 0 && (
          <p className="komunikat">
            Lista jest pusta. Wyszukaj adres powyżej lub dodaj go z karty okolicy.{' '}
            <a href={hrefDla(stan, { ekran: 'szukaj' })}>Wróć do mapy</a>
          </p>
        )}
        {okolice.length > 0 && (
          <>
            {/* Linki i przyciski listy niosą adresy (tekst i aria-label), więc mają jawne cele pomiaru:
                bez nich nazwa celu wyprowadzałaby się z tekstu i wpuszczała adresy do kluczy CTA. */}
            <div
              className="porownanie-lista"
              aria-label="Wybrane adresy"
              data-sekcja="porownanie-lista"
            >
              {okolice.map((o, i) => (
                <div className="porownanie-adres" key={o.id}>
                  <span className="porownanie-kropka" style={{ background: o.kolor }} />
                  <a href={o.href} data-cel="otworz-karte">
                    {o.nazwa}
                  </a>
                  {wynikiMapy?.wykluczenia.wykluczony[o.i] ? (
                    <span className="porownanie-adres__status">Wykluczony filtrem</span>
                  ) : wynikiMapy?.wykluczenia.niewiadomy[o.i] ? (
                    <span className="porownanie-adres__status">Brak danych dla filtru</span>
                  ) : null}
                  <button
                    type="button"
                    data-cel="usun-z-porownania"
                    onClick={() => usunZPorownania(stan.porownanie[i] as number)}
                    aria-label={`Usuń ${o.nazwa} z porównania`}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
            {wykluczonych > 0 && (
              <p className="porownanie-uwaga" role="status">
                {wykluczonych} {wykluczonych === 1 ? 'adres nie spełnia' : 'adresy nie spełniają'}{' '}
                twardych filtrów i {wykluczonych === 1 ? 'nie jest' : 'nie są'} uwzględniane w
                porównaniu. Możesz je usunąć lub zmienić filtry po lewej.
              </p>
            )}
            {aktywneOkolice.length === 0 && (
              <p className="komunikat">Żaden wybrany adres nie spełnia obecnych filtrów.</p>
            )}
            {aktywneOkolice.length > 0 && <Radar okolice={aktywneOkolice} />}
            <TabelaAtrybutow
              okolice={okolice}
              filtry={stan.filtry}
              wykluczone={
                new Set(
                  okolice.filter((o) => wynikiMapy?.wykluczenia.wykluczony[o.i]).map((o) => o.id),
                )
              }
            />
            {aktywneOkolice.length > 0 && (
              <>
                <section
                  className="porownanie-ranking"
                  aria-label="Ranking dopasowania"
                  data-sekcja="porownanie-ranking"
                >
                  <h2>Dopasowanie do Ciebie</h2>
                  <ol>
                    {ranking(aktywneOkolice).map((o) => {
                      const najlepsza = [...o.wynik.kategorie]
                        .filter((k) => k.kategoria !== 'kontekst' && k.ocena !== null)
                        .sort((a, b) => (b.ocena ?? 0) - (a.ocena ?? 0))[0]
                      return (
                        <li key={o.id}>
                          <a href={o.href} data-cel="otworz-karte">
                            {o.nazwa}
                          </a>
                          <strong>
                            {liczba(o.wynik.wynik)}
                            {o.wynik.litera ? ` / ${o.wynik.litera}` : ''}
                          </strong>
                          <span>
                            {o.wynik.wynik === null
                              ? 'Brak wyniku'
                              : `Dostępność danych: ${Math.round(o.wynik.pewnosc * 100)}%`}
                            {najlepsza && ` · Mocna strona: ${KATEGORIE[najlepsza.kategoria]}`}
                          </span>
                        </li>
                      )
                    })}
                  </ol>
                </section>
                <section className="porownanie-werdykt" data-sekcja="porownanie-werdykt">
                  <h2>Werdykt</h2>
                  <p>{werdykt(aktywneOkolice)}</p>
                  <small>
                    Braki danych nie są oceną zero. Wyniki zależą od aktualnych wag i dostępnych
                    warstw.
                  </small>
                </section>
              </>
            )}
          </>
        )}
      </div>
    </main>
  )
}
