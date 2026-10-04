import { useState } from 'react'
import { useDane } from '@/wynik/dane'
import { policzLuki, progLuki } from '@/wynik/luki'
import { opisZrodelOkolic } from '@/wynik/miejsceAdresu'
import {
  liczbaPelna,
  rankingLuk,
  rozdzielczoscWarstwy,
  type SortowanieLuk,
  zrodlaWarstwy,
} from '@/wynik/rankingLuk'
import './luki.css'

export interface PanelLukProps {
  /** Id warstwy z progiem luki (np. „przystanek_odleglosc”). Null albo nieznane id = pierwsza dostępna. */
  warstwa: string | null
  /** Użytkownik wybrał inną warstwę – zapisz ją w stanie (np. w URL `?w=`). */
  onZmienWarstwe: (id: string) => void
  /**
   * Klik w okolicę: `okolicaAdresu(...).id` („sim-803”, „m-1219064-grabowki”; bez `okolice.json`
   * „dzielnica:<nazwa>” | „gmina:<nazwa>”) – mapa (#90) przelatuje do niej.
   */
  onWybierzOkolice: (id: string) => void
  /** Okolica pokazana teraz na mapie – wiersz dostaje `aria-current`. */
  wybranaOkolica?: string | null
}

/**
 * Panel „Gdzie miasto ma luki” (#91): ranking okolic wg liczby adresów w luce dla jednej
 * warstwy. Bez numerów miejsc – kierunek stoi słowami nad listą. Liczy sam z `useDane()`.
 */
export function PanelLuk({
  warstwa,
  onZmienWarstwe,
  onWybierzOkolice,
  wybranaOkolica = null,
}: PanelLukProps) {
  const dane = useDane()
  const [sortowanie, setSortowanie] = useState<SortowanieLuk>('liczba')

  if (dane.stan === 'ladowanie') return <p className="komunikat">Wczytuję dane…</p>
  if (dane.stan === 'blad') return <p className="komunikat">Nie udało się wczytać danych.</p>

  // Tylko warstwy z progiem luki i bez atrapy – luka na wymyślonych danych to fałszywy wniosek.
  const dostepne = dane.wskazniki.filter((w) => progLuki(w.meta) !== null)
  const aktywna = dostepne.find((w) => w.meta.id === warstwa) ?? dostepne[0]

  if (!aktywna) {
    return (
      <section className="luki" aria-labelledby="h-luki">
        <h2 id="h-luki" className="etykieta-sekcji">
          Gdzie miasto ma luki
        </h2>
        <p className="luki-uwaga">Żadna warstwa nie ma jeszcze progu luki.</p>
      </section>
    )
  }

  const wynik = policzLuki(aktywna, dane.adresy, dane.grupyHeksow, dane.okolice)
  if (!wynik) return null
  const ranking = rankingLuk(wynik, sortowanie)
  const n = ranking.naglowek
  const meta = aktywna.meta

  return (
    <section className="luki" aria-labelledby="h-luki">
      <div className="luki-gora">
        <h2 id="h-luki" className="etykieta-sekcji">
          Gdzie miasto ma luki
        </h2>
        {dostepne.length > 1 && (
          <fieldset className="luki-warstwy">
            <legend className="sr-only">Usługa</legend>
            {dostepne.map((w) => (
              <button
                key={w.meta.id}
                type="button"
                className="seg"
                aria-pressed={w.meta.id === meta.id}
                onClick={() => onZmienWarstwe(w.meta.id)}
              >
                {w.meta.nazwa}
              </button>
            ))}
          </fieldset>
        )}
        <p className="luki-suma">
          <strong className="luki-liczba">{liczbaPelna(n.wLuce)}</strong> {n.podpis}
        </p>
        <p className="luki-podstawa">
          {n.procent ?? 'brak danych'} {n.podstawa}
          {n.brakDanych > 0 && (
            <>
              {' · '}
              <span className="luki-szary">{liczbaPelna(n.brakDanych)} bez danych</span>
            </>
          )}
        </p>
        {wynik.niedostepny && (
          <p className="luki-uwaga">
            Warstwa się nie wczytała, więc każdy adres liczy się jako brak danych.
          </p>
        )}
        {dane.okolice === null && (
          <p className="luki-uwaga">
            Plik okolic się nie wczytał, więc okolicą jest dzielnica Krakowa albo cała gmina.
          </p>
        )}
      </div>

      <div className="luki-sterowanie">
        <p id="luki-kierunek" className="luki-kierunek">
          {ranking.kierunek}
        </p>
        <fieldset className="luki-sortowanie">
          <legend className="sr-only">Kolejność</legend>
          <button
            type="button"
            className="seg"
            aria-pressed={sortowanie === 'liczba'}
            onClick={() => setSortowanie('liczba')}
          >
            Liczba adresów
          </button>
          <button
            type="button"
            className="seg"
            aria-pressed={sortowanie === 'udzial'}
            onClick={() => setSortowanie('udzial')}
          >
            Udział
          </button>
        </fieldset>
      </div>

      <div className="luki-tabela">
        <div className="luki-kolumny" aria-hidden="true">
          <span>Okolica</span>
          <span className="luki-num">W luce</span>
          <span>Udział</span>
          <span className="luki-num">Brak danych</span>
        </div>
        <ul className="luki-lista" aria-describedby="luki-kierunek">
          {ranking.wiersze.map((o) => (
            <li key={o.id}>
              <button
                type="button"
                className="luki-wiersz"
                data-szary={o.udzial === null ? '' : undefined}
                aria-current={o.id === wybranaOkolica ? 'true' : undefined}
                onClick={() => onWybierzOkolice(o.id)}
              >
                <span className="luki-nazwa">
                  {o.nazwa}
                  <span className="luki-typ">{o.opis}</span>
                  <span className="sr-only">,</span>
                </span>
                <span className="luki-wluce luki-num">
                  {liczbaPelna(o.wLuce)}
                  <span className="luki-dopisek"> w luce</span>
                  <span className="sr-only">,</span>
                </span>
                <span className="luki-udzial">
                  <span className="luki-pasek" aria-hidden="true">
                    <span className="luki-pasek-luka" style={{ width: `${o.pasek.wLuce}%` }} />
                    <span className="luki-pasek-brak" style={{ width: `${o.pasek.brakDanych}%` }} />
                  </span>
                  <span className="luki-procent">
                    {o.procent === null ? (
                      <span className="luki-szary">brak danych</span>
                    ) : (
                      // Liczba adresów stoi przy nazwie (`o.opis`) – tu podstawa tylko słowami.
                      <>
                        <strong>{o.procent}</strong>
                        <span className="luki-dopisek"> adresów okolicy</span>
                      </>
                    )}
                    <span className="sr-only">,</span>
                  </span>
                </span>
                <span className="luki-brak luki-num">
                  {liczbaPelna(o.brakDanych)}
                  <span className="luki-dopisek"> bez danych</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="luki-zrodlo">
        <p>
          <span className="luki-legenda luki-legenda-luka" aria-hidden="true" /> w luce:{' '}
          {wynik.prog.opis}. <span className="luki-legenda luki-legenda-brak" aria-hidden="true" />{' '}
          adresy bez danych – nie liczą się jako „bez luki”.
        </p>
        <p>Próg: {wynik.prog.zrodlo}</p>
        <p>
          Dane: {zrodlaWarstwy(meta)}. Rozdzielczość: {rozdzielczoscWarstwy(meta)}. Liczymy{' '}
          {wynik.jednostka}, nie mieszkańców.
        </p>
        <p>{opisZrodelOkolic(dane.okolice)}</p>
      </div>
    </section>
  )
}
