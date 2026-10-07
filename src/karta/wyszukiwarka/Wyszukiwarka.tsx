import { useEffect, useId, useRef, useState } from 'react'
import { produktowe } from '@/pomiar/pomiar.ts'
import { useMiasto } from '@/wynik/miastoDanych'
import type { Adres } from '../../kontrakty/index.ts'
import { MIASTO_DOMYSLNE } from '../../kontrakty/miasta.ts'
import type { PlikOkolic } from '../../kontrakty/okolice.ts'
import { przykladAdresu } from '../adres.ts'
import { indeksDla, maNumerDomu } from './indeks.ts'
import { type Podpowiedz, podpowiedzi } from './podpowiedzi.ts'
import {
  BEZCZYNNOSC_MS,
  czyBezczynnoscZatwierdza,
  kluczWyszukania,
  zdarzenieWyszukania,
} from './pomiarWyszukania.ts'
import { indeksOkolicDla, spojnyOpis, type WynikOkolicy } from './szukajOkolic.ts'
import './wyszukiwarka.css'

const MIN_ZNAKOW = 2

interface Props {
  /** Adresy do przeszukania (z `onWybierz`). Bez nich pole szuka tylko okolic. */
  adresy?: Adres[]
  onWybierz?: (i: number) => void
  wyczyscPoWyborze?: boolean
  /**
   * Okolice z `okolice.json` (z `onWybierzOkolice`, #185): nazwa jednostki SIM, osiedla z OSM albo
   * miejscowości podpowiada okolicę. Wpis z numerem domu zostaje adresem – adresy mają pierwszeństwo.
   */
  okolice?: PlikOkolic | null
  onWybierzOkolice?: (okolica: WynikOkolicy) => void
  etykieta?: string
  placeholder?: string
  /** Fokus w polu: miejsce na doładowanie danych, których będzie potrzebował wybór (granice okolic). */
  onFokus?: () => void
  /**
   * Czy zatwierdzone wyszukania wchodzą do pomiaru ruchu (`pomiarWyszukania.ts`, T062). Domyślnie NIE:
   * to samo pole bywa celem dojazdu w panelu filtrów (`PanelDojazdu`), a to nie jest wyszukanie
   * adresu do karty – zaniżałoby lejek „wyszukanie → karta adresu” i zapisywałoby miejsca pracy.
   * Włączają je ekrany, na których pole jest głównym wyszukiwaniem (Szukaj, Porównanie).
   */
  mierz?: boolean
}

// Combobox wg wzorca WAI-ARIA (list autocomplete): fokus zostaje w polu, opcję wskazuje
// aria-activedescendant.
export function Wyszukiwarka({
  adresy,
  onWybierz,
  wyczyscPoWyborze = false,
  okolice,
  onWybierzOkolice,
  etykieta,
  placeholder,
  onFokus,
  mierz = false,
}: Props) {
  const miasto = useMiasto()
  // Domyślny podpis i przykład mówią o bieżącym mieście (#223): „Adres we Wrocławiu”, a przykład z jego danych.
  const etykietaPola = etykieta ?? `Adres ${miasto.wMiescie}`
  const przyklad = adresy && miasto.slug !== MIASTO_DOMYSLNE ? przykladAdresu(adresy) : null
  const podpowiedzPola =
    placeholder ??
    (miasto.slug === MIASTO_DOMYSLNE
      ? 'np. Grodzka 52'
      : przyklad
        ? `np. ${przyklad}`
        : 'np. nazwa ulicy i numer domu')
  const id = useId()
  const idPola = `${id}-pole`
  const idListy = `${id}-lista`
  const idOpcji = (k: number) => `${id}-opcja-${k}`

  const [tekst, setTekst] = useState('')
  const [otwarta, setOtwarta] = useState(false)
  const [aktywna, setAktywna] = useState(-1)
  // Klucz zapytania zatwierdzonego od ostatniej edycji tekstu: bezczynność, a potem Enter albo klik
  // na tym samym tekście to jedno wyszukanie, nie dwa. Ref, bo zmiana nie ma przerysowywać pola.
  const zatwierdzone = useRef<string | null>(null)

  // Źródło, którego pole nie szuka, nie buduje indeksu (indeks adresów to ok. sekundy przy pierwszym zapytaniu).
  const szukaAdresow = Boolean(adresy && onWybierz)
  const szukaOkolic = Boolean(okolice && onWybierzOkolice)
  const gotowe = tekst.trim().length >= MIN_ZNAKOW
  const wyniki = gotowe
    ? podpowiedzi(tekst, {
        adresy: adresy && onWybierz ? indeksDla(adresy) : null,
        okolice: okolice && onWybierzOkolice ? indeksOkolicDla(okolice) : null,
      })
    : []
  const pokazListe = otwarta && wyniki.length > 0
  const brak = otwarta && gotowe && wyniki.length === 0
  const opisListy = szukaAdresow
    ? szukaOkolic
      ? 'Podpowiedzi adresów i okolic'
      : 'Podpowiedzi adresów'
    : 'Podpowiedzi okolic'
  const komunikatBraku = szukaAdresow
    ? szukaOkolic
      ? 'Brak adresu ani okolicy w danych – sprawdź pisownię'
      : 'Brak adresu w danych – sprawdź pisownię'
    : maNumerDomu(tekst)
      ? 'To wygląda na adres, a tu szukamy okolic: nazwy osiedla, jednostki SIM albo miejscowości'
      : 'Brak okolicy o tej nazwie – sprawdź pisownię'

  // Opcja wybrana strzałką musi być widoczna na przewijanej liście.
  useEffect(() => {
    if (aktywna >= 0) {
      document.getElementById(`${id}-opcja-${aktywna}`)?.scrollIntoView?.({ block: 'nearest' })
    }
  }, [aktywna, id])

  // Pomiar (T062): zdarzenie powstaje po ZATWIERDZENIU zapytania, nie przy każdym znaku. Liczba i
  // rodzaj podpowiedzi przychodzą z wywołania, a nie z domknięcia: timer bezczynności ma zgłosić
  // to, co człowiek widział przy swoim tekście, nie listę z późniejszego renderu.
  function zglosWyszukanie(
    zapytanie: string,
    wynikow: number,
    rodzajPodpowiedzi: Podpowiedz['rodzaj'] | undefined,
  ) {
    if (!mierz) return
    const klucz = kluczWyszukania(zapytanie)
    if (zatwierdzone.current === klucz) return
    zatwierdzone.current = klucz
    const zdarzenie = zdarzenieWyszukania(zapytanie, wynikow, rodzajPodpowiedzi)
    produktowe(zdarzenie.nazwa, zdarzenie.wlasciwosci)
  }

  // Bezczynność: sekunda po ostatniej zmianie tekstu (najmniej 3 znaki) zatwierdza zapytanie. Każda
  // zmiana tekstu czyści timer w sprzątaniu efektu, więc pisanie ciągłe niczego nie zgłasza.
  const liczbaWynikow = wyniki.length
  const rodzajPierwszej = wyniki[0]?.rodzaj
  useEffect(() => {
    if (!mierz || !czyBezczynnoscZatwierdza(tekst)) return
    const uchwyt = window.setTimeout(
      () => zglosWyszukanie(tekst, liczbaWynikow, rodzajPierwszej),
      BEZCZYNNOSC_MS,
    )
    return () => window.clearTimeout(uchwyt)
  }, [mierz, tekst, liczbaWynikow, rodzajPierwszej])

  function wybierz(k: number) {
    const w = wyniki[k]
    if (!w) return
    zglosWyszukanie(tekst, wyniki.length, w.rodzaj)
    const nowyTekst = wyczyscPoWyborze ? '' : w.tytul
    // Tekst wstawiony wyborem nie jest kolejnym wyszukaniem: bezczynność po nim niczego nie zgłosi.
    zatwierdzone.current = mierz && nowyTekst ? kluczWyszukania(nowyTekst) : null
    setTekst(nowyTekst)
    setOtwarta(false)
    setAktywna(-1)
    if (w.rodzaj === 'adres') onWybierz?.(w.i)
    else onWybierzOkolice?.(w.okolica)
  }

  function naKlawisz(e: React.KeyboardEvent<HTMLInputElement>) {
    const n = wyniki.length
    if (e.key === 'ArrowDown' && n > 0) {
      e.preventDefault()
      setOtwarta(true)
      setAktywna((aktywna + 1) % n)
    } else if (e.key === 'ArrowUp' && n > 0) {
      e.preventDefault()
      setOtwarta(true)
      setAktywna(aktywna <= 0 ? n - 1 : aktywna - 1)
    } else if (e.key === 'Enter' && pokazListe) {
      e.preventDefault()
      wybierz(aktywna >= 0 ? aktywna : 0)
    } else if (e.key === 'Enter' && gotowe) {
      // Enter bez widocznej listy (brak wyników albo lista zamknięta Escape) też zatwierdza zapytanie.
      zglosWyszukanie(tekst, wyniki.length, wyniki[0]?.rodzaj)
    } else if (e.key === 'Escape') {
      if (otwarta) {
        e.preventDefault()
        setOtwarta(false)
        setAktywna(-1)
      } else if (tekst) {
        setTekst('')
        zatwierdzone.current = null
      }
    }
  }

  return (
    <div className="wysz">
      <label className="wysz-etykieta" htmlFor={idPola}>
        {etykietaPola}
      </label>
      <input
        id={idPola}
        className="wysz-pole"
        type="text"
        role="combobox"
        aria-expanded={pokazListe}
        aria-controls={idListy}
        aria-autocomplete="list"
        aria-activedescendant={pokazListe && aktywna >= 0 ? idOpcji(aktywna) : undefined}
        autoComplete="off"
        spellCheck={false}
        placeholder={podpowiedzPola}
        value={tekst}
        onChange={(e) => {
          setTekst(e.target.value)
          setOtwarta(true)
          setAktywna(-1)
          // Edycja otwiera nowe zapytanie: kolejna bezczynność albo Enter znów coś zgłosi.
          zatwierdzone.current = null
        }}
        onKeyDown={naKlawisz}
        onFocus={() => {
          setOtwarta(true)
          onFokus?.()
        }}
        onBlur={() => {
          setOtwarta(false)
          setAktywna(-1)
        }}
      />
      <ul
        id={idListy}
        className="wysz-lista"
        role="listbox"
        aria-label={opisListy}
        hidden={!pokazListe}
      >
        {pokazListe &&
          wyniki.map((w, k) => (
            // Opcje obsługuje klawiatura przez pole (aria-activedescendant), mysz i dotyk przez onClick.
            <li
              key={w.klucz}
              id={idOpcji(k)}
              className="wysz-opcja"
              role="option"
              aria-selected={k === aktywna}
              // Bez tego pole traci fokus (blur) przed kliknięciem i lista znika.
              onMouseDown={(e) => e.preventDefault()}
              onMouseMove={() => aktywna !== k && setAktywna(k)}
              onClick={() => wybierz(k)}
            >
              <span className="wysz-tytul">{w.tytul}</span>
              <span className="wysz-opis">{spojnyOpis(w.opis)}</span>
            </li>
          ))}
      </ul>
      <p className="wysz-status" role="status" data-ukryty={!brak}>
        {brak ? komunikatBraku : pokazListe ? `Podpowiedzi: ${wyniki.length}` : ''}
      </p>
    </div>
  )
}
