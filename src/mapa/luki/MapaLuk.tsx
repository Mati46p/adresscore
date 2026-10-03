// Mapa luk w trybie „Dla miasta” (#90): ta sama MapaKrakowa, heksy w kolorze udziału adresów
// w luce dla wybranej warstwy. Liczy silnik z #89 (`policzLuki`), tu tylko kolor, dymek, legenda,
// wybór warstwy i przelot do okolicy z rankingu (#91).
import type { JSX } from 'react'
import type { Adres } from '@/kontrakty'
import {
  type Granice,
  gradientLukCss,
  graniceOkolicy,
  opisHeksuLuki,
  sumaLiczb,
  wartoscMapyLuki,
} from '@/mapa/luki/skalaLuk'
import { MapaKrakowa } from '@/mapa/MapaKrakowa'
import { KRYCIE_DANYCH, szrafuraCss } from '@/mapa/skala'
import { useDane } from '@/wynik/dane'
import { policzLuki, progLuki, type WynikLuk } from '@/wynik/luki'
import type { GrupyHeksow, WskaznikPrzygotowany } from '@/wynik/silnik'
import './mapaLuk.css'

export interface MapaLukProps {
  /** Id wskaźnika z progiem luki (np. `przystanek_odleglosc`). null albo nieznane = pierwsza warstwa z listy. */
  warstwa: string | null
  /** Wybór warstwy w pasku nad mapą. */
  onZmienWarstwe: (id: string) => void
  /**
   * Okolica do pokazania: `okolicaAdresu(...).id`, czyli `dzielnica:<nazwa>` albo `gmina:<nazwa>`.
   * Zmiana = przelot kamery do ramki adresów tej okolicy.
   */
  okolicaDoPokazania?: string | null
}

const BRAK_HEKSOW: ReadonlyMap<string, number | null> = new Map()

// Pamięć ostatniego wyniku w module (jak useWyniki): 70–180 tys. adresów liczymy raz na warstwę,
// a rerender rodzica (np. najechanie na wiersz rankingu) nie przemalowuje mapy.
let ostatnieLuki: {
  wskaznik: WskaznikPrzygotowany
  adresy: readonly Adres[]
  wynik: WynikLuk | null
  heksy: ReadonlyMap<string, number | null>
} | null = null

function lukiWarstwy(
  wskaznik: WskaznikPrzygotowany,
  adresy: readonly Adres[],
  grupy: GrupyHeksow,
): { wynik: WynikLuk | null; heksy: ReadonlyMap<string, number | null> } {
  if (ostatnieLuki && ostatnieLuki.wskaznik === wskaznik && ostatnieLuki.adresy === adresy) {
    return ostatnieLuki
  }
  const wynik = policzLuki(wskaznik, adresy, grupy)
  const heksy = new Map<string, number | null>()
  if (wynik) for (const [h, l] of wynik.heksy) heksy.set(h, wartoscMapyLuki(l.udzial))
  ostatnieLuki = { wskaznik, adresy, wynik, heksy }
  return ostatnieLuki
}

let ostatnieGranice: { adresy: readonly Adres[]; id: string; granice: Granice | null } | null = null

function graniceZPamieci(adresy: readonly Adres[], id: string): Granice | null {
  if (ostatnieGranice && ostatnieGranice.adresy === adresy && ostatnieGranice.id === id) {
    return ostatnieGranice.granice
  }
  ostatnieGranice = { adresy, id, granice: graniceOkolicy(adresy, id) }
  return ostatnieGranice.granice
}

const zWielkiej = (t: string) => t.charAt(0).toLocaleUpperCase('pl-PL') + t.slice(1)

export function MapaLuk({
  warstwa,
  onZmienWarstwe,
  okolicaDoPokazania = null,
}: MapaLukProps): JSX.Element {
  const dane = useDane()
  const gotowe = dane.stan === 'gotowe' ? dane : null
  // Tylko warstwy z progiem luki i bez atrapy – `progLuki` daje null dla obu przypadków.
  const warstwy = gotowe ? gotowe.wskazniki.filter((w) => progLuki(w.meta) !== null) : []
  const wybrana = warstwy.find((w) => w.meta.id === warstwa) ?? warstwy[0] ?? null
  const luki = gotowe && wybrana ? lukiWarstwy(wybrana, gotowe.adresy, gotowe.grupyHeksow) : null
  const wynik = luki?.wynik ?? null
  const granice =
    gotowe && okolicaDoPokazania ? graniceZPamieci(gotowe.adresy, okolicaDoPokazania) : null
  const tytul = wynik ? zWielkiej(wynik.prog.naglowek) : 'Luki w usługach'

  return (
    <div className="mapa-luk">
      <div className="mapa-luk__pasek">
        {gotowe ? (
          warstwy.length > 0 ? (
            <div role="group" aria-label="Luka w usłudze" className="mapa-luk__warstwy">
              {warstwy.map((w) => (
                <button
                  key={w.meta.id}
                  type="button"
                  className="seg mapa-luk__warstwa"
                  aria-pressed={w === wybrana}
                  onClick={() => onZmienWarstwe(w.meta.id)}
                >
                  {w.meta.nazwa}
                </button>
              ))}
            </div>
          ) : (
            <p className="mapa-luk__opis">Brak warstw z progiem luki.</p>
          )
        ) : (
          <p className="mapa-luk__opis" role="status">
            {dane.stan === 'blad' ? 'Nie udało się wczytać danych.' : 'Wczytuję warstwy…'}
          </p>
        )}
        {wynik && (
          <p className="mapa-luk__opis">
            W luce: {wynik.prog.opis}.
            {wynik.niedostepny && ' Warstwa niedostępna – cała mapa bez danych.'}
          </p>
        )}
      </div>
      <div className="mapa-luk__mapa">
        <MapaKrakowa
          heksy={luki?.heksy ?? BRAK_HEKSOW}
          podpisWarstwy={tytul}
          granice={granice}
          wartoscRodzica={
            wynik ? (dzieci) => wartoscMapyLuki(sumaLiczb(dzieci, wynik.heksy).udzial) : undefined
          }
          opisHeksu={(dzieci, res) =>
            wynik
              ? opisHeksuLuki(
                  res === 10 ? wynik.heksy.get(dzieci[0] ?? '') : sumaLiczb(dzieci, wynik.heksy),
                  res !== 10,
                )
              : 'brak danych'
          }
          legenda={<LegendaLuk tytul={tytul} />}
        />
      </div>
    </div>
  )
}

/** Legenda: kierunek skali i podstawa procentu wypisane słowami; paleta tylko jako wypełnienie. */
export function LegendaLuk({ tytul }: { tytul: string }): JSX.Element {
  return (
    <>
      <div className="mapa-legenda__tytul">{tytul}</div>
      <div className="mapa-luk-legenda__podstawa">% adresów w heksie</div>
      <div
        className="mapa-legenda__pasek"
        style={{ background: gradientLukCss(), opacity: KRYCIE_DANYCH }}
      />
      <div className="mapa-legenda__skala" aria-hidden="true">
        <span>0%</span>
        <span>50%</span>
        <span>100%</span>
      </div>
      <div className="mapa-luk-legenda__kierunek">więcej = gorzej obsłużone</div>
      <div className="mapa-legenda__wiersz">
        <span
          className="mapa-legenda__probka mapa-legenda__probka--brak"
          style={{ background: szrafuraCss() }}
        />
        brak danych
      </div>
      <div className="mapa-legenda__wiersz">
        <span className="mapa-legenda__probka mapa-legenda__probka--mgla" />
        poza Krakowem – brak danych
      </div>
    </>
  )
}
