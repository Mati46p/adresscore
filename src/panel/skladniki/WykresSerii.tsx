// Wykres liniowy serii czasowej, wspólny dla wykresu dziennego i godzinowego (Recharts, leniwy
// chunk panelu). Wrappery `WykresDzienny` i `WykresGodzinowy` różnią się tylko osią czasu.
//
// Zasady (skill dataviz + CLAUDE.md „Liczby na ekranie”):
//  - Jedna oś wartości, zawsze od zera; linie 2 px bez znaczników, hairline siatki.
//  - Kolor serii idzie za BYTEM serii (odsłony, unikalni, boty), nie za jej pozycją. Roboty to
//    szare wygaszenie (kontekst), nie kolejna kategoria. Kolory są wypełnieniami: opis serii
//    stoi w kolorach tekstu, a barwę niesie krótki odcinek-klucz obok nazwy.
//  - Legenda jest zawsze przy ≥ 2 seriach (identyfikacja nie może zależeć od samego koloru).
//  - Najechanie albo dotknięcie podaje dokładną wartość każdej serii i datę (FR-039); to samo
//    działa z klawiatury (warstwa dostępności Recharts: strzałki po sfokusowaniu wykresu).
//  - Tooltip nie jest jedyną drogą do wartości: pod wykresem jest tabela-bliźniak (`details`).
//  - Brak danych (`null`) to PRZERWA w linii i „brak danych” w tooltipie, nigdy zero. Pusty wykres
//    pokazuje oś z napisem „brak danych”.
import { useId } from 'react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  type TooltipContentProps,
  XAxis,
  YAxis,
} from 'recharts'
import { czyLiczba, formatLiczby } from '@/panel/arytmetyka'
import { KOLOR_DANYCH, type KolorDanych } from '@/panel/kolory'
import { BrakDanych } from './BrakDanych'
import { type KolumnaTabeli, Tabela } from './Tabela'

export type KluczSerii = 'odslony' | 'unikalni' | 'boty'

export const SERIE: Readonly<Record<KluczSerii, { etykieta: string; kolor: KolorDanych }>> = {
  odslony: { etykieta: 'Odsłony (ludzie)', kolor: 1 },
  unikalni: { etykieta: 'Unikalni (odciski ludzi)', kolor: 2 },
  boty: { etykieta: 'Odsłony botów', kolor: 'szary' },
}

/** Punkt wykresu: `x` to klucz osi (doba `YYYY-MM-DD` albo początek godziny w ISO). */
export interface PunktSerii {
  x: string
  odslony: number | null
  unikalni: number | null
  boty: number | null
}

/** Wspólny opis osi czasu, który dostarczają wrappery. */
export interface OsCzasu {
  /** Podpis osi poziomej, np. „Doba (czas warszawski)”. */
  podpis: string
  /** Etykieta ticka osi. */
  etykietaTicka: (x: string) => string
  /** Jawna lista tików (np. północe na wykresie godzinowym); bez niej Recharts dobiera sam. */
  ticki?: readonly string[]
  /** Nagłówek dymku i pierwsza kolumna tabeli-bliźniaka. */
  naglowekDymku: (x: string) => string
  naglowekKolumnyTabeli: string
}

function DymekSerii({
  active,
  payload,
  serie,
  os,
}: TooltipContentProps & { serie: readonly KluczSerii[]; os: OsCzasu }) {
  const punkt = active ? (payload?.[0]?.payload as PunktSerii | undefined) : undefined
  if (!punkt) return null
  return (
    <div className="panel-dymek">
      <p className="panel-dymek-naglowek">{os.naglowekDymku(punkt.x)}</p>
      {serie.map((k) => (
        <div className="panel-dymek-wiersz" key={k}>
          <span
            className="panel-klucz-linii"
            style={{ background: KOLOR_DANYCH[SERIE[k].kolor] }}
            aria-hidden="true"
          />
          <span className="panel-dymek-nazwa">{SERIE[k].etykieta}</span>
          <span className="panel-dymek-wartosc">{formatLiczby(punkt[k])}</span>
        </div>
      ))}
    </div>
  )
}

export function WykresSerii({
  dane,
  serie,
  tytul,
  opis,
  os,
  uwaga,
}: {
  dane: readonly PunktSerii[]
  serie: readonly KluczSerii[]
  /** Nazwa wykresu: widoczny podpis, `<title>` w SVG i etykieta tabeli-bliźniaka. */
  tytul: string
  /** Streszczenie dla czytników ekranu (`<desc>` w SVG). */
  opis: string
  os: OsCzasu
  /** Jedna linia pod wykresem (np. ostrzeżenie o sumowaniu unikalnych). */
  uwaga?: string
}) {
  const idTytulu = useId()
  const maDane = dane.some((p) => serie.some((k) => czyLiczba(p[k])))

  const kolumny: KolumnaTabeli<PunktSerii>[] = [
    { id: 'x', naglowek: os.naglowekKolumnyTabeli, komorka: (p) => os.naglowekDymku(p.x) },
    ...serie.map(
      (k): KolumnaTabeli<PunktSerii> => ({
        id: k,
        naglowek: SERIE[k].etykieta,
        liczbowa: true,
        komorka: (p) => (czyLiczba(p[k]) ? formatLiczby(p[k]) : null),
      }),
    ),
  ]

  return (
    <figure className="panel-wykres" aria-labelledby={idTytulu}>
      <figcaption className="panel-wykres-podpis" id={idTytulu}>
        {tytul}
      </figcaption>
      {serie.length >= 2 ? (
        <ul className="panel-legenda panel-legenda--linie" aria-label="Legenda wykresu">
          {serie.map((k) => (
            <li key={k}>
              <span
                className="panel-klucz-linii"
                style={{ background: KOLOR_DANYCH[SERIE[k].kolor] }}
                aria-hidden="true"
              />
              <span className="panel-legenda-nazwa">{SERIE[k].etykieta}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="panel-wykres-pole">
        {dane.length > 0 ? (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={dane as PunktSerii[]}
              margin={{ top: 8, right: 12, bottom: 0, left: 0 }}
              title={tytul}
              desc={opis}
            >
              <CartesianGrid vertical={false} stroke="var(--panel-siatka)" />
              <XAxis
                dataKey="x"
                ticks={os.ticki ? [...os.ticki] : undefined}
                interval={os.ticki ? 0 : 'preserveStartEnd'}
                minTickGap={16}
                tickFormatter={(x) => os.etykietaTicka(String(x))}
                tick={{ fill: 'var(--tekst-3)', fontSize: 12 }}
                tickLine={false}
                axisLine={{ stroke: 'var(--panel-os)' }}
                height={44}
                label={{
                  value: os.podpis,
                  position: 'insideBottom',
                  offset: 0,
                  fill: 'var(--tekst-3)',
                  fontSize: 12,
                }}
              />
              <YAxis
                width={52}
                domain={[0, 'auto']}
                allowDecimals={false}
                tickFormatter={(v) => formatLiczby(Number(v))}
                tick={{ fill: 'var(--tekst-3)', fontSize: 12 }}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip
                content={(props) => <DymekSerii {...props} serie={serie} os={os} />}
                cursor={{ stroke: 'var(--panel-os)', strokeWidth: 1 }}
                isAnimationActive={false}
              />
              {serie.map((k) => (
                <Line
                  key={k}
                  type="linear"
                  dataKey={k}
                  stroke={KOLOR_DANYCH[SERIE[k].kolor]}
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  dot={false}
                  // Pierścień w kolorze powierzchni: aktywny punkt nie ginie na przecięciu linii.
                  activeDot={{
                    r: 4,
                    stroke: 'var(--powierzchnia)',
                    strokeWidth: 2,
                    fill: KOLOR_DANYCH[SERIE[k].kolor],
                  }}
                  connectNulls={false}
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        ) : null}
        {!maDane ? (
          <div className="panel-wykres-pusty">
            <BrakDanych />
          </div>
        ) : null}
      </div>
      {uwaga ? <p className="panel-wykres-uwaga">{uwaga}</p> : null}
      {dane.length > 0 ? (
        <details className="panel-szczegoly">
          <summary>Pokaż dane w tabeli</summary>
          <Tabela
            kolumny={kolumny}
            wiersze={dane}
            kluczWiersza={(p) => p.x}
            podpis={`${tytul} – tabela`}
            przewijana
          />
        </details>
      ) : null}
    </figure>
  )
}
