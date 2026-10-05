// Wykres lejka produktowego: poziome słupki liczby sesji na kroku, z procentem od PIERWSZEGO kroku
// przy końcu słupka i procentem od poprzedniego w dymku i w tabeli-bliźniaku. Przyjmuje gotowe
// kroki w kolejności lejka (zakładka mapuje wiersze `admin_lejek`); procenty liczy `lejek()`.
//
// Podstawa jest podpisana pod wykresem: 100% to sesje pierwszego kroku. Kroki liczone są niezależnie,
// więc późniejszy może przekroczyć 100% (kartę da się otworzyć bez wyszukiwania) i wykres to
// pokazuje, a nie przycina. Kroki po karcie to alternatywy, nie kolejne etapy, więc wszystkie
// słupki mają ten sam kolor (rampa „kolejności” sugerowałaby progresję, której nie ma); kolejność
// niesie pozycja w pionie, liczność długość słupka. Słupki zaczynają się od zera na wspólnej skali.
import { useId } from 'react'
import {
  Bar,
  BarChart,
  type BarShapeProps,
  CartesianGrid,
  LabelList,
  Rectangle,
  ResponsiveContainer,
  Tooltip,
  type TooltipContentProps,
  XAxis,
  YAxis,
} from 'recharts'
import {
  BRAK_DANYCH,
  czyLiczba,
  formatLiczby,
  formatProcent,
  lejek,
  type WynikKrokuLejka,
} from '@/panel/arytmetyka'
import { KOLOR_DANYCH } from '@/panel/kolory'
import { BrakDanych } from './BrakDanych'
import { type KolumnaTabeli, Tabela } from './Tabela'

export interface KrokWykresuLejka {
  klucz: string
  /** Krótka nazwa kroku (oś wykresu ma ~120 px na etykiety). */
  etykieta: string
  /** Sesje z tym krokiem. `null` = brak pomiaru. */
  wartosc: number | null
}

interface WierszWykresu {
  klucz: string
  etykieta: string
  /** Wartość do narysowania (brak pomiaru = 0 szerokości, ale z napisem „brak danych”). */
  slupek: number
  wartosc: number | null
  odPierwszego: number | null
  odPoprzedniego: number | null
  podpis: string
}

function podpisKonca(w: { wartosc: number | null; odPierwszego: number | null }): string {
  if (!czyLiczba(w.wartosc)) return BRAK_DANYCH
  return w.odPierwszego === null
    ? formatLiczby(w.wartosc)
    : `${formatLiczby(w.wartosc)} · ${formatProcent(w.odPierwszego)}`
}

function DymekLejka({
  active,
  payload,
  jednostka,
  podstawa,
}: TooltipContentProps & { jednostka: string; podstawa: string }) {
  const wiersz = active ? (payload?.[0]?.payload as WierszWykresu | undefined) : undefined
  if (!wiersz) return null
  return (
    <div className="panel-dymek">
      <p className="panel-dymek-naglowek">{wiersz.etykieta}</p>
      <div className="panel-dymek-wiersz">
        <span className="panel-dymek-nazwa">Liczba {jednostka}</span>
        <span className="panel-dymek-wartosc">{formatLiczby(wiersz.wartosc)}</span>
      </div>
      <div className="panel-dymek-wiersz">
        <span className="panel-dymek-nazwa">Od pierwszego kroku</span>
        <span className="panel-dymek-wartosc">{formatProcent(wiersz.odPierwszego)}</span>
      </div>
      <div className="panel-dymek-wiersz">
        <span className="panel-dymek-nazwa">Od poprzedniego kroku</span>
        <span className="panel-dymek-wartosc">{formatProcent(wiersz.odPoprzedniego)}</span>
      </div>
      <p className="panel-dymek-dopisek">{podstawa}</p>
    </div>
  )
}

/**
 * Własny kształt słupka. Recharts pomija słupki o zerowej szerokości razem z ich etykietami, chyba
 * że słupek ma własny kształt. Krok z zerem albo bez pomiaru ma więc zostać w wykresie z podpisem
 * („0 · 0,0%”, „brak danych”), a nie zniknąć bez śladu; sam słupek takiego kroku nie rysuje nic.
 */
function SlupekLejka({ x, y, width, height, fill, radius }: BarShapeProps) {
  if (!(width > 0)) return <g />
  return <Rectangle x={x} y={y} width={width} height={height} fill={fill} radius={radius} />
}

const WYSOKOSC_KROKU = 44
const MARGINES_OSI = 12

interface WykresLejkaProps {
  /** Kroki w kolejności lejka; pierwszy to podstawa (100%). */
  kroki: readonly KrokWykresuLejka[]
  /** Czego dotyczą liczby, w dopełniaczu: „sesji” (domyślnie). */
  jednostka?: string
  /** Nazwa wykresu; domyślnie „Lejek produktowy”. */
  tytul?: string
}

// Domyślne wartości propsów są w ciele funkcji (patrz WykresDzienny).
export function WykresLejka(props: WykresLejkaProps) {
  const { kroki } = props
  const jednostka = props.jednostka ?? 'sesji'
  const tytul = props.tytul ?? 'Lejek produktowy'
  const idTytulu = useId()
  const wyniki: WynikKrokuLejka<KrokWykresuLejka>[] = lejek(kroki)
  const maDane = wyniki.some((w) => w.wartosc !== null)
  if (kroki.length === 0 || !maDane) {
    return <BrakDanych wariant="blok" opis={`${tytul}: w tym okresie nie było danych o krokach.`} />
  }

  const pierwszy = wyniki[0]
  const nazwaPierwszego = pierwszy?.krok.etykieta ?? ''
  const podstawa =
    pierwszy && czyLiczba(pierwszy.wartosc) && pierwszy.wartosc > 0
      ? `100% = ${formatLiczby(pierwszy.wartosc)} ${jednostka} w kroku „${nazwaPierwszego}”.`
      : pierwszy && czyLiczba(pierwszy.wartosc)
        ? `W pierwszym kroku („${nazwaPierwszego}”) nie było żadnych ${jednostka}, więc procenty są puste: nie ma czego dzielić.`
        : `Pierwszy krok („${nazwaPierwszego}”) nie ma pomiaru, więc procenty są puste.`

  const dane: WierszWykresu[] = wyniki.map((w) => ({
    klucz: w.krok.klucz,
    etykieta: w.krok.etykieta,
    slupek: w.wartosc ?? 0,
    wartosc: w.wartosc,
    odPierwszego: w.odPierwszego,
    odPoprzedniego: w.odPoprzedniego,
    podpis: podpisKonca(w),
  }))

  const kolumny: KolumnaTabeli<WierszWykresu>[] = [
    { id: 'krok', naglowek: 'Krok', komorka: (w) => w.etykieta },
    {
      id: 'liczba',
      naglowek: `Liczba ${jednostka}`,
      liczbowa: true,
      komorka: (w) => (czyLiczba(w.wartosc) ? formatLiczby(w.wartosc) : null),
    },
    {
      id: 'od-pierwszego',
      naglowek: '% od pierwszego kroku',
      klucz: 'tresc.lejekOdPierwszego',
      liczbowa: true,
      komorka: (w) => (w.odPierwszego === null ? null : formatProcent(w.odPierwszego)),
    },
    {
      id: 'od-poprzedniego',
      naglowek: '% od poprzedniego kroku',
      klucz: 'tresc.lejekOdPoprzedniego',
      liczbowa: true,
      komorka: (w) => (w.odPoprzedniego === null ? null : formatProcent(w.odPoprzedniego)),
    },
  ]

  return (
    <figure className="panel-wykres" aria-labelledby={idTytulu}>
      <figcaption className="panel-wykres-podpis" id={idTytulu}>
        {tytul}
      </figcaption>
      <div
        className="panel-wykres-pole"
        data-lejek=""
        style={{ height: dane.length * WYSOKOSC_KROKU + 2 * MARGINES_OSI }}
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={dane}
            layout="vertical"
            margin={{ top: MARGINES_OSI, right: 96, bottom: MARGINES_OSI, left: 4 }}
            barCategoryGap={10}
            title={tytul}
            desc={`${tytul}: ${dane.map((w) => `${w.etykieta} ${w.podpis}`).join('; ')}. ${podstawa}`}
          >
            <CartesianGrid horizontal={false} stroke="var(--panel-siatka)" />
            {/* Wartości są podpisane przy słupkach, więc oś liczbowa jest zbędna; skala zaczyna się od zera. */}
            <XAxis type="number" hide domain={[0, 'dataMax']} />
            <YAxis
              type="category"
              dataKey="etykieta"
              width={116}
              tick={{ fill: 'var(--tekst-2)', fontSize: 12 }}
              tickLine={false}
              axisLine={{ stroke: 'var(--panel-os)' }}
            />
            <Tooltip
              content={(props) => (
                <DymekLejka {...props} jednostka={jednostka} podstawa={podstawa} />
              )}
              cursor={{ fill: 'var(--powierzchnia-2)' }}
              isAnimationActive={false}
            />
            <Bar
              dataKey="slupek"
              fill={KOLOR_DANYCH[1]}
              barSize={22}
              radius={[0, 4, 4, 0]}
              shape={SlupekLejka}
              isAnimationActive={false}
            >
              <LabelList dataKey="podpis" position="right" fill="var(--tekst)" fontSize={12} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className="panel-wykres-uwaga">
        {podstawa} Słupek pokazuje liczbę {jednostka}, procent obok to udział w pierwszym kroku.
        Kroki liczone niezależnie, więc późniejszy może przekroczyć 100%.
      </p>
      <details className="panel-szczegoly">
        <summary>Pokaż dane w tabeli</summary>
        <Tabela
          kolumny={kolumny}
          wiersze={dane}
          kluczWiersza={(w) => w.klucz}
          podpis={`${tytul} – tabela`}
        />
      </details>
    </figure>
  )
}
