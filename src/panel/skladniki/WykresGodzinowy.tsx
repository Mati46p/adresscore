// Wykres godzinowy: odsłony, unikalni i odsłony botów w każdej godzinie (czas warszawski).
// Przyjmuje GOTOWE wiersze z `admin_seria_godzinowa` (każda godzina jest obecna, godzina bez
// ruchu ma 0); wykres nie woła bazy.
//
// Oś X: podpisy tylko o północy (data doby) i granice dób jako jawna lista tików, żeby przy 48–168
// punktach etykiety nie lądowały w przypadkowych godzinach. Dymek podaje godzinę jako ZAKRES
// (14:00–14:59), żeby nie sugerować punktu w czasie.
import { dzienWarszawy, etykietaDnia, godzinaWarszawy, opisGodziny } from '@/panel/czas'
import { type KluczSerii, type OsCzasu, type PunktSerii, WykresSerii } from './WykresSerii'

export interface PunktGodzinowy {
  /** Początek godziny, ISO 8601 (jak `godzina` w `admin_seria_godzinowa`). */
  godzina: string
  odslony: number | null
  unikalni: number | null
  boty: number | null
}

function etykietaGodziny(iso: string): string {
  const godzina = godzinaWarszawy(iso)
  if (godzina === null) return iso
  if (godzina === 0) return etykietaDnia(dzienWarszawy(iso) ?? iso)
  return `${String(godzina).padStart(2, '0')}:00`
}

const SERIE_DOMYSLNE: readonly KluczSerii[] = ['odslony', 'boty']

interface WykresGodzinowyProps {
  dane: readonly PunktGodzinowy[]
  /** Które serie narysować; domyślnie odsłony ludzi i odsłony botów. */
  serie?: readonly KluczSerii[]
  /** Nazwa wykresu; domyślnie „Ruch w kolejnych godzinach”. */
  tytul?: string
}

// Domyślne wartości propsów są w ciele funkcji (patrz WykresDzienny).
export function WykresGodzinowy(props: WykresGodzinowyProps) {
  const { dane } = props
  const serie = props.serie ?? SERIE_DOMYSLNE
  const tytul = props.tytul ?? 'Ruch w kolejnych godzinach'
  const punkty: PunktSerii[] = dane.map((p) => ({
    x: p.godzina,
    odslony: p.odslony,
    unikalni: p.unikalni,
    boty: p.boty,
  }))
  const polnoce = punkty.filter((p) => godzinaWarszawy(p.x) === 0).map((p) => p.x)
  // Przy krótkim oknie bez północy zostawiamy dobór tików Recharts (podpisy `HH:00`).
  const os: OsCzasu = {
    podpis: 'Godzina (czas warszawski); podpisy dat o północy',
    etykietaTicka: etykietaGodziny,
    ticki: polnoce.length >= 2 ? polnoce : undefined,
    naglowekDymku: opisGodziny,
    naglowekKolumnyTabeli: 'Godzina',
  }
  const pierwszy = dane[0]?.godzina
  const ostatni = dane[dane.length - 1]?.godzina
  return (
    <WykresSerii
      dane={punkty}
      serie={serie}
      tytul={tytul}
      opis={
        pierwszy && ostatni
          ? `${tytul}: ${dane.length} godzin, od ${opisGodziny(pierwszy)} do ${opisGodziny(ostatni)}.`
          : `${tytul}: brak danych.`
      }
      os={os}
      uwaga={
        serie.includes('unikalni')
          ? 'Unikalni to różne odciski w danej godzinie: godzin nie wolno sumować, bo osoba czytająca trzy godziny jest w trzech z nich.'
          : undefined
      }
    />
  )
}
