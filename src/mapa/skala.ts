import type { ExpressionSpecification } from 'maplibre-gl'

// Pomarańcz → jasny środek → zieleń akcentu. Końce różnią się i barwą, i jasnością (L* ok. 49
// i 35, środek ok. 89): przy deuteranopii pomarańcz przechodzi w żółtawy, zieleń w niebieskoszary,
// więc skala zostaje czytelna także bez rozróżniania czerwieni i zieleni. Strona zielona jest
// celowo ciemniejsza: 25 i 75 mają L* ok. 74 i 58 (na podkładzie przy kryciu 0,72: 79 i 67),
// bo w symetrycznej skali rozbieżnej różniłyby się tylko barwą.
export const STOPNIE_SKALI: readonly (readonly [number, string])[] = [
  [0, '#B25E12'],
  [25, '#E4AD68'],
  [50, '#E9DEBC'],
  [75, '#4E9A78'],
  [100, '#1F5C46'],
]

/** Krycie heksów z danymi – wspólne dla mapy i paska legendy. */
export const KRYCIE_DANYCH = 0.72

/** Brak danych – nigdy kolor zera. Pod szrafurą, więc nie myli się z jasnym środkiem skali. */
export const KOLOR_BRAKU = '#8A9097'
export const KRYCIE_BRAKU = 0.5
/** Kreski szrafury i obrys heksu bez danych. */
export const KOLOR_SZRAFURY = '#3F454C'

/** Ukośne kreski co 8 px CSS, rysowane w kodzie – bez pliku obrazka i bez sprite'a. */
export function obrazSzrafury(): { width: number; height: number; data: Uint8Array } {
  // 16 px przy pixelRatio 2: ostre kreski na ekranach o wysokiej gęstości.
  const bok = 16
  const data = new Uint8Array(bok * bok * 4)
  const [r, g, b] = naRgb(KOLOR_SZRAFURY)
  for (let y = 0; y < bok; y++) {
    for (let x = 0; x < bok; x++) {
      // (x + y) mod okres daje ukos, który łączy się na brzegach kafla bez szwu.
      if ((x + y) % bok >= 3) continue
      const i = (y * bok + x) * 4
      data[i] = r
      data[i + 1] = g
      data[i + 2] = b
      data[i + 3] = 230
    }
  }
  return { width: bok, height: bok, data }
}

/** Ta sama szrafura w CSS – próbka „brak danych" w legendzie. */
export function szrafuraCss(): string {
  return `repeating-linear-gradient(-45deg, ${KOLOR_SZRAFURY} 0 1.1px, transparent 1.1px 5.66px), ${KOLOR_BRAKU}80`
}

function naRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** Kolor wyniku 0–100 (ta sama skala co heksy na mapie); null → szary „brak danych". */
export function kolorWyniku(v: number | null): string {
  if (v === null || Number.isNaN(v)) return KOLOR_BRAKU
  const x = Math.min(100, Math.max(0, v))
  for (let i = 1; i < STOPNIE_SKALI.length; i++) {
    const [p1, k1] = STOPNIE_SKALI[i] as [number, string]
    if (x > p1) continue
    const [p0, k0] = STOPNIE_SKALI[i - 1] as [number, string]
    const t = (x - p0) / (p1 - p0)
    const a = naRgb(k0)
    const b = naRgb(k1)
    const rgb = a.map((c, j) => Math.round(c + ((b[j] ?? 0) - c) * t))
    return `#${rgb.map((c) => c.toString(16).padStart(2, '0')).join('')}`
  }
  return STOPNIE_SKALI[STOPNIE_SKALI.length - 1]?.[1] ?? KOLOR_BRAKU
}

/** Wyrażenie MapLibre dla wartości 0–100; ujemna (umowny brak danych) → szary. */
export function wyrazenieKoloru(wartosc: ExpressionSpecification): ExpressionSpecification {
  return [
    'case',
    ['<', wartosc, 0],
    KOLOR_BRAKU,
    ['interpolate', ['linear'], wartosc, ...STOPNIE_SKALI.flat()],
  ] as ExpressionSpecification
}

export function gradientCss(): string {
  return `linear-gradient(to right, ${STOPNIE_SKALI.map(([p, k]) => `${k} ${p}%`).join(', ')})`
}
