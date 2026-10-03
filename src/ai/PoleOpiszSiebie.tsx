// „Opisz siebie” (#16): pole tekstowe → JEV albo reguły → wagi w stanie aplikacji → mapa
// przelicza się sama (useWyniki czyta wagi ze stanu). Komponent nie zna mapy.
import { type FormEvent, type KeyboardEvent, useId, useRef, useState } from 'react'
import { useDane } from '@/wynik/dane'
import { pobierzStan, useStan, ustawWagi, wybierzPersone } from '@/wynik/stan'
import type { WynikZZapasem } from './jev'
import {
  nicNieZrozumiano,
  opiszSiebie,
  type PozycjaZrozumienia,
  wagiZeZrozumienia,
  type Zrozumienie,
} from './opiszSiebie'
import './opiszSiebie.css'

function tekstPozycji(p: PozycjaZrozumienia): string {
  if (p.rodzaj === 'kategoria') return `${p.etykieta} – ${(p.opis ?? '').toLowerCase()}`
  const nazwa =
    p.rodzaj === 'profil'
      ? `profil: ${p.etykieta}`
      : p.rodzaj === 'na_nie'
        ? `nie chcę: ${p.etykieta}`
        : p.etykieta
  return p.procent === null ? nazwa : `${nazwa} ${p.procent}%`
}

function opisZrodla(w: WynikZZapasem<Zrozumienie>): string {
  if (w.zrodlo === 'jev')
    return 'Źródło: JEV – wybór z zamkniętej listy, procent to pewność modelu.'
  if (w.powod === 'limit') return 'Źródło: reguły słów kluczowych (bez AI) – JEV chwilowo odmówił.'
  if (w.powod === 'nieczytelne')
    return 'Źródło: reguły słów kluczowych (bez AI) – JEV nie był dość pewny.'
  return 'Źródło: reguły słów kluczowych (bez AI).'
}

export function PoleOpiszSiebie() {
  const dane = useDane()
  const tryb = useStan((s) => s.tryb)
  const [tekst, setTekst] = useState('')
  const [trwa, setTrwa] = useState(false)
  const [wynik, setWynik] = useState<WynikZZapasem<Zrozumienie> | null>(null)
  // Starsza odpowiedź, która przyszła po nowszej, nie może nadpisać wag.
  const numer = useRef(0)
  const idPola = useId()
  const idNaglowka = useId()

  if (tryb === 'biznes') return null
  const gotowe = dane.stan === 'gotowe'

  async function przelicz(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (dane.stan !== 'gotowe' || !tekst.trim()) return
    const nr = ++numer.current
    setTrwa(true)
    const w = await opiszSiebie(tekst)
    if (nr !== numer.current) return
    setTrwa(false)
    setWynik(w)
    const s = pobierzStan()
    if (nicNieZrozumiano(w.wynik) || s.tryb === 'biznes') return
    const nowe = wagiZeZrozumienia(
      w.wynik,
      s.tryb,
      dane.wskazniki.map((x) => x.meta),
      { wagi: s.wagi, kierunki: s.kierunki },
    )
    if (nowe.persona === 'wlasna') ustawWagi(nowe.wagi, nowe.kierunki)
    else wybierzPersone(nowe.persona)
  }

  function enterWysyla(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      e.currentTarget.form?.requestSubmit()
    }
  }

  return (
    <section aria-labelledby={idNaglowka} className="opisz">
      <h2 id={idNaglowka} className="etykieta-sekcji">
        Opisz siebie
      </h2>
      <form className="opisz-forma" onSubmit={przelicz}>
        <label htmlFor={idPola} className="opisz-podpowiedz">
          Napisz jednym zdaniem, czego szukasz – ustawię wagi i przeliczę mapę.
        </label>
        <textarea
          id={idPola}
          className="opisz-pole"
          rows={2}
          maxLength={500}
          value={tekst}
          placeholder="np. Mam dwoje dzieci i psa, nie mam samochodu, pracuję w centrum"
          onChange={(e) => setTekst(e.target.value)}
          onKeyDown={enterWysyla}
        />
        <button
          type="submit"
          className="przycisk-glowny opisz-przycisk"
          disabled={trwa || !gotowe || !tekst.trim()}
        >
          {trwa ? 'Czytam…' : gotowe ? 'Przelicz mapę' : 'Wczytuję warstwy…'}
        </button>
      </form>

      <div role="status" aria-live="polite" className="opisz-wynik">
        {wynik &&
          (nicNieZrozumiano(wynik.wynik) ? (
            <p className="opisz-uwaga">
              Nie rozpoznałem nic konkretnego – wagi bez zmian. Spróbuj np. „dzieci”, „pies”,
              „cisza”, „bez samochodu”, „emeryt”, „praca w centrum”.
            </p>
          ) : (
            <>
              <p className="opisz-glowa">Zrozumiałem:</p>
              <ul className="opisz-chipy">
                {wynik.wynik.zrozumialem.map((p) => (
                  <li key={`${p.rodzaj}-${p.etykieta}`} className={`opisz-chip opisz-${p.rodzaj}`}>
                    {tekstPozycji(p)}
                  </li>
                ))}
              </ul>
            </>
          ))}
        {wynik && <p className="opisz-zrodlo">{opisZrodla(wynik)}</p>}
      </div>
    </section>
  )
}
