import { useEffect, useId, useState } from 'react'
import type { Adres } from '../../kontrakty/index.ts'
import type { PlikOkolic } from '../../kontrakty/okolice.ts'
import { indeksDla, maNumerDomu } from './indeks.ts'
import { podpowiedzi } from './podpowiedzi.ts'
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
}

// Combobox wg wzorca WAI-ARIA (list autocomplete): fokus zostaje w polu, opcję wskazuje
// aria-activedescendant.
export function Wyszukiwarka({
  adresy,
  onWybierz,
  wyczyscPoWyborze = false,
  okolice,
  onWybierzOkolice,
  etykieta = 'Adres w Krakowie',
  placeholder = 'np. Grodzka 52',
  onFokus,
}: Props) {
  const id = useId()
  const idPola = `${id}-pole`
  const idListy = `${id}-lista`
  const idOpcji = (k: number) => `${id}-opcja-${k}`

  const [tekst, setTekst] = useState('')
  const [otwarta, setOtwarta] = useState(false)
  const [aktywna, setAktywna] = useState(-1)

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

  function wybierz(k: number) {
    const w = wyniki[k]
    if (!w) return
    setTekst(wyczyscPoWyborze ? '' : w.tytul)
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
    } else if (e.key === 'Escape') {
      if (otwarta) {
        e.preventDefault()
        setOtwarta(false)
        setAktywna(-1)
      } else if (tekst) {
        setTekst('')
      }
    }
  }

  return (
    <div className="wysz">
      <label className="wysz-etykieta" htmlFor={idPola}>
        {etykieta}
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
        placeholder={placeholder}
        value={tekst}
        onChange={(e) => {
          setTekst(e.target.value)
          setOtwarta(true)
          setAktywna(-1)
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
