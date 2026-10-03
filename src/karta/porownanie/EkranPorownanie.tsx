import { useId, useMemo, useState } from 'react'
import { liczba, opisAdresu } from '@/karta/adres'
import { Wyszukiwarka } from '@/karta/wyszukiwarka/Wyszukiwarka'
import { KATEGORIE } from '@/kontrakty'
import { useDane } from '@/wynik/dane'
import { wynikAdresu } from '@/wynik/silnik'
import { dodajDoPorownania, hrefDla, useStan, usunZPorownania } from '@/wynik/stan'
import { MAKS_POROWNANIE } from '@/wynik/url'
import {
  type OkolicaPorownania,
  OSIE,
  priorytety,
  punktyRadaru,
  RADAR_X,
  RADAR_Y,
  ranking,
  werdykt,
} from './model'
import './porownanie.css'

const KOLORY = ['#176448', '#bc6b38', '#4b67a1', '#9a5f91', '#697a2e']

function Radar({ okolice }: { okolice: readonly OkolicaPorownania[] }) {
  const wagi = priorytety(okolice)
  const opisId = useId()
  return (
    <div className="porownanie-wykres">
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
                  fill={KOLORY[i]}
                  fillOpacity=".12"
                  stroke={KOLORY[i]}
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
  const [widok, ustawWidok] = useState<'radar' | 'tabela'>('radar')
  const [status, ustawStatus] = useState('')
  const adresyDoDodania = useMemo(() => {
    if (dane.stan !== 'gotowe') return []
    const wybrane = new Set(stan.porownanie)
    return dane.adresy.filter((adres) => !wybrane.has(adres.i))
  }, [dane, stan.porownanie])
  const okolice: OkolicaPorownania[] =
    dane.stan === 'gotowe'
      ? stan.porownanie.slice(0, MAKS_POROWNANIE).flatMap((i) => {
          const adres = dane.adresy[i]
          return adres
            ? [
                {
                  id: adres.id,
                  nazwa: opisAdresu(adres),
                  wynik: wynikAdresu(i, dane.wskazniki, stan.wagi, stan.kierunki),
                  href: hrefDla(stan, { ekran: 'okolica', wybrany: i }),
                },
              ]
            : []
        })
      : []
  const atrapa =
    dane.stan === 'gotowe' && (dane.plikAdresow.atrapa || dane.wskazniki.some((w) => w.meta.atrapa))
  async function kopiuj() {
    try {
      await navigator.clipboard.writeText(
        new URL(hrefDla(stan, { ekran: 'porownanie' }), location.href).href,
      )
      ustawStatus(
        stan.persona === 'wlasna'
          ? 'Skopiowano link do adresów. Ręczne wagi nie są zapisywane w linku.'
          : 'Skopiowano link do porównania.',
      )
    } catch {
      ustawStatus('Nie udało się skopiować. Skopiuj adres strony z przeglądarki.')
    }
  }
  return (
    <main className="tresc porownanie">
      <div className="porownanie-gora">
        <div>
          <h1>Porównaj okolice pod siebie</h1>
          <p>Wyniki dla aktualnych wag. Możesz zestawić do {MAKS_POROWNANIE} adresów.</p>
        </div>
        {okolice.length > 0 && (
          <button className="seg" type="button" onClick={kopiuj}>
            Kopiuj link
          </button>
        )}
      </div>
      {stan.persona === 'wlasna' && okolice.length > 0 && (
        <p className="porownanie-uwaga">
          Link udostępnia wybrane adresy. Ręcznie ustawione wagi nie są zapisywane w linku.
        </p>
      )}
      {status && <p role="status">{status}</p>}
      {atrapa && (
        <p className="porownanie-uwaga">Dane przykładowe: część wyników pochodzi z atrapy.</p>
      )}
      {dane.stan === 'ladowanie' && <p className="komunikat">Wczytywanie danych porównania…</p>}
      {dane.stan === 'gotowe' && stan.porownanie.length < MAKS_POROWNANIE && (
        <section className="porownanie-dodaj" aria-label="Dodaj adres do porównania">
          <h2>Dodaj adres do porównania</h2>
          <Wyszukiwarka
            adresy={adresyDoDodania}
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
          <div className="porownanie-lista" aria-label="Wybrane adresy">
            {okolice.map((o, i) => (
              <div className="porownanie-adres" key={o.id}>
                <span className="porownanie-kropka" style={{ background: KOLORY[i] }} />
                <a href={o.href}>{o.nazwa}</a>
                <button
                  type="button"
                  onClick={() => usunZPorownania(stan.porownanie[i] as number)}
                  aria-label={`Usuń ${o.nazwa} z porównania`}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          <div className="porownanie-przelacznik" role="group" aria-label="Widok porównania">
            <button
              className="seg"
              type="button"
              aria-pressed={widok === 'radar'}
              onClick={() => ustawWidok('radar')}
            >
              Wykres radarowy
            </button>
            <button
              className="seg"
              type="button"
              aria-pressed={widok === 'tabela'}
              onClick={() => ustawWidok('tabela')}
            >
              Tabela
            </button>
          </div>
          {widok === 'radar' ? (
            <Radar okolice={okolice} />
          ) : (
            <div
              className="porownanie-tabela"
              role="region"
              aria-label="Tabela porównania"
              tabIndex={0}
            >
              <table>
                <thead>
                  <tr>
                    <th scope="col">Kategoria</th>
                    {okolice.map((o) => (
                      <th key={o.id} scope="col">
                        {o.nazwa}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {OSIE.map((id) => (
                    <tr key={id}>
                      <th scope="row">{KATEGORIE[id]}</th>
                      {okolice.map((o) => {
                        const k = o.wynik.kategorie.find((x) => x.kategoria === id)
                        return (
                          <td key={o.id}>
                            {liczba(k?.ocena)}
                            <small>
                              {k?.ocena === null || !k
                                ? 'Brak danych'
                                : `${Math.round(k.pewnosc * 100)}% danych`}
                            </small>
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <section className="porownanie-ranking" aria-label="Ranking dopasowania">
            <h2>Dopasowanie do Ciebie</h2>
            <ol>
              {ranking(okolice).map((o) => {
                const najlepsza = [...o.wynik.kategorie]
                  .filter((k) => k.kategoria !== 'kontekst' && k.ocena !== null)
                  .sort((a, b) => (b.ocena ?? 0) - (a.ocena ?? 0))[0]
                return (
                  <li key={o.id}>
                    <a href={o.href}>{o.nazwa}</a>
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
          <section className="porownanie-werdykt">
            <h2>Werdykt</h2>
            <p>{werdykt(okolice)}</p>
            <small>
              Braki danych nie są oceną zero. Wyniki zależą od aktualnych wag i dostępnych warstw.
            </small>
          </section>
        </>
      )}
    </main>
  )
}
