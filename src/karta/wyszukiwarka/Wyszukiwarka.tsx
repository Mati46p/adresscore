import { useEffect, useId, useState } from 'react'
import type { Adres } from '../../kontrakty/index.ts'
import { indeksDla, szukaj } from './indeks.ts'
import './wyszukiwarka.css'

const MIN_ZNAKOW = 2

interface Props {
  adresy: Adres[]
  onWybierz: (i: number) => void
  wyczyscPoWyborze?: boolean
}

// Combobox wg wzorca WAI-ARIA (list autocomplete): fokus zostaje w polu, opcję wskazuje
// aria-activedescendant.
export function Wyszukiwarka({ adresy, onWybierz, wyczyscPoWyborze = false }: Props) {
  const id = useId()
  const idPola = `${id}-pole`
  const idListy = `${id}-lista`
  const idOpcji = (k: number) => `${id}-opcja-${k}`

  const [tekst, setTekst] = useState('')
  const [otwarta, setOtwarta] = useState(false)
  const [aktywna, setAktywna] = useState(-1)

  const gotowe = tekst.trim().length >= MIN_ZNAKOW
  const wyniki = gotowe ? szukaj(indeksDla(adresy), tekst) : []
  const pokazListe = otwarta && wyniki.length > 0
  const brak = otwarta && gotowe && wyniki.length === 0

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
    onWybierz(w.i)
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
        Adres w Krakowie
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
        placeholder="np. Grodzka 52"
        value={tekst}
        onChange={(e) => {
          setTekst(e.target.value)
          setOtwarta(true)
          setAktywna(-1)
        }}
        onKeyDown={naKlawisz}
        onFocus={() => setOtwarta(true)}
        onBlur={() => {
          setOtwarta(false)
          setAktywna(-1)
        }}
      />
      <ul
        id={idListy}
        className="wysz-lista"
        role="listbox"
        aria-label="Podpowiedzi adresów"
        hidden={!pokazListe}
      >
        {pokazListe &&
          wyniki.map((w, k) => (
            // Opcje obsługuje klawiatura przez pole (aria-activedescendant), mysz i dotyk przez onClick.
            <li
              key={w.i}
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
              <span className="wysz-opis">{w.opis}</span>
            </li>
          ))}
      </ul>
      <p className="wysz-status" role="status" data-ukryty={!brak}>
        {brak
          ? 'Brak adresu w danych – sprawdź pisownię'
          : pokazListe
            ? `Podpowiedzi: ${wyniki.length}`
            : ''}
      </p>
    </div>
  )
}
