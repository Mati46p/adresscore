// Pole „Zapytaj o ten adres” (#17) dla karty okolicy. JEV (albo reguła zapasowa) wybiera tylko
// warstwy; liczbę, źródło i rozdzielczość bierzemy z danych tego adresu. Montaż: tor `karta`.
// Pytanie o kilka rzeczy naraz (#146) → do 3 odpowiedzi; pytanie o jedną wygląda jak dawniej.
// #156: przy średniej pewności JEV dwa przyciski „Chodziło Ci o…?”; klik pokazuje odpowiedź z danych.
import { useId, useRef, useState } from 'react'
import { useDane } from '@/wynik/dane'
import {
  listaWarstw,
  type Odpowiedz,
  type PropozycjaOdpowiedzi,
  podpowiedzi as podpowiedziListy,
  zapytajOAdresZPropozycjami,
} from './zapytajOAdres.ts'
import './zapytaj.css'

type Stan =
  | { stan: 'pusty' }
  | { stan: 'pytam'; pytanie: string }
  | {
      stan: 'gotowe'
      pytanie: string
      /** Numer pytania – nowe pytanie zaczyna propozycje bez wyboru. */
      numer: number
      odpowiedzi: Odpowiedz[]
      propozycje: PropozycjaOdpowiedzi[] | null
    }

/** `indeks` – indeks adresu w danych (ten sam co `stan.wybrany` w src/wynik/stan.ts). */
export function PoleZapytajOAdres({ indeks }: { indeks: number }) {
  const dane = useDane()
  const [tekst, setTekst] = useState('')
  const [stan, setStan] = useState<Stan>({ stan: 'pusty' })
  const licznik = useRef(0)
  const idPola = useId()
  const idNaglowka = useId()

  if (dane.stan !== 'gotowe') return null
  const wskazniki = dane.wskazniki
  const przyklady = podpowiedziListy(listaWarstw(wskazniki.map((w) => w.meta)))

  async function zapytaj(pytanie: string) {
    const p = pytanie.trim()
    if (!p) return
    const numer = ++licznik.current
    setStan({ stan: 'pytam', pytanie: p })
    const { odpowiedzi, propozycje } = await zapytajOAdresZPropozycjami(p, wskazniki, indeks)
    // Starsze pytanie, które wróciło po nowszym, nie nadpisuje odpowiedzi.
    if (numer === licznik.current)
      setStan({ stan: 'gotowe', pytanie: p, numer, odpowiedzi, propozycje })
  }

  function przyklad(p: string) {
    setTekst(p)
    void zapytaj(p)
  }

  return (
    <section className="karta zap" aria-labelledby={idNaglowka}>
      <h2 id={idNaglowka} className="zap-h2">
        Zapytaj o ten adres
      </h2>
      <form
        className="zap-forma"
        role="search"
        onSubmit={(e) => {
          e.preventDefault()
          void zapytaj(tekst)
        }}
      >
        <label htmlFor={idPola} className="zap-ukryte">
          Twoje pytanie o ten adres
        </label>
        <input
          id={idPola}
          className="pole zap-pole"
          type="text"
          enterKeyHint="send"
          autoComplete="off"
          maxLength={300}
          placeholder="np. Jak głośno tu jest?"
          value={tekst}
          onChange={(e) => setTekst(e.target.value)}
        />
        <button type="submit" className="przycisk-glowny zap-przycisk" disabled={!tekst.trim()}>
          Zapytaj
        </button>
      </form>

      <div className="zap-przyklady">
        {przyklady.map((p) => (
          <button key={p} type="button" className="seg zap-przyklad" onClick={() => przyklad(p)}>
            {p}
          </button>
        ))}
      </div>

      <div aria-live="polite" className="zap-wynik">
        {stan.stan === 'pytam' && <p className="zap-czekam">Szukam w danych…</p>}
        {stan.stan === 'gotowe' &&
          (stan.propozycje ? (
            <Propozycje key={stan.numer} propozycje={stan.propozycje} />
          ) : (
            <Odpowiedzi odpowiedzi={stan.odpowiedzi} />
          ))}
      </div>

      <p className="zap-przypis">
        Model wybiera tylko warstwę z listy. Liczba zawsze pochodzi z danych tego adresu, nigdy nie
        jest generowana.
      </p>
    </section>
  )
}

function KtoWybral({ zrodlo }: { zrodlo: Odpowiedz['zrodloOdpowiedzi'] }) {
  return (
    <span className="zap-kto">
      {zrodlo === 'jev'
        ? 'pytanie rozpoznał JEV'
        : zrodlo === 'reguly-i-jev'
          ? 'pytanie rozpoznała reguła słów kluczowych, tematy dołożył JEV'
          : 'pytanie rozpoznała reguła słów kluczowych (bez AI)'}
    </span>
  )
}

/**
 * #156: JEV waha się między dwiema warstwami – pytamy, zamiast zgadywać. Dwa zwykłe przyciski
 * (aria-pressed), wybór można zmienić; odpowiedź z danych pojawia się pod nimi.
 */
function Propozycje({ propozycje }: { propozycje: PropozycjaOdpowiedzi[] }) {
  const [wybrana, setWybrana] = useState<number | null>(null)
  const idPytania = useId()
  const odp = wybrana === null ? null : propozycje[wybrana]
  return (
    <div className="zap-wiele">
      <div className="zap-propozycje" role="group" aria-labelledby={idPytania}>
        <p id={idPytania} className="zap-pyt-prop">
          Chodziło Ci o…?
        </p>
        <div className="zap-prop-przyciski">
          {propozycje.map((p, i) => (
            <button
              key={p.warstwa}
              type="button"
              className="seg zap-prop"
              aria-pressed={wybrana === i}
              onClick={() => setWybrana(i)}
            >
              {p.nazwa}
            </button>
          ))}
        </div>
        {!odp && <KtoWybral zrodlo={propozycje[0]?.odpowiedzi[0]?.zrodloOdpowiedzi ?? 'jev'} />}
      </div>
      {odp && <Odpowiedzi odpowiedzi={odp.odpowiedzi} />}
    </div>
  )
}

/** Jedna odpowiedź – dokładnie jak przed #146; kilka – lista kart i jeden podpis „kto wybrał”. */
function Odpowiedzi({ odpowiedzi }: { odpowiedzi: Odpowiedz[] }) {
  const [pierwsza] = odpowiedzi
  if (!pierwsza) return null
  if (odpowiedzi.length === 1) return <Linia odpowiedz={pierwsza} />
  return (
    <div className="zap-wiele">
      <ol className="zap-lista" aria-label={`${odpowiedzi.length} odpowiedzi z danych`}>
        {odpowiedzi.map((o) => (
          <li key={o.rodzaj === 'warstwa' ? o.warstwa : o.rodzaj}>
            <Linia odpowiedz={o} bezKto />
          </li>
        ))}
      </ol>
      <KtoWybral zrodlo={pierwsza.zrodloOdpowiedzi} />
    </div>
  )
}

function Linia({ odpowiedz: o, bezKto = false }: { odpowiedz: Odpowiedz; bezKto?: boolean }) {
  if (o.rodzaj === 'nie-wiem') {
    return (
      <div className="zap-odp">
        <p className="zap-nie-wiem">
          Nie wiem, której warstwy dotyczy to pytanie.
          {o.podpowiedzi.length > 0 && ` Spróbuj na przykład: ${o.podpowiedzi.join(' · ')}`}
        </p>
        <KtoWybral zrodlo={o.zrodloOdpowiedzi} />
      </div>
    )
  }
  return (
    <div className="zap-odp">
      <p className="zap-linia">
        <span className="zap-warstwa">{o.etykieta}:</span>{' '}
        <strong className={o.wartosc === null ? 'zap-wartosc zap-brak' : 'zap-wartosc mono'}>
          {o.niedostepny ? 'warstwa niedostępna' : o.tekstWartosci}
        </strong>
        {o.atrapa && <span className="atrapa">dane przykładowe</span>}
      </p>
      {o.opisMiejsca && <p className="zap-opis">{o.opisMiejsca}</p>}
      {o.zamiana && <p className="zap-opis">{o.zamiana.notka}</p>}
      <p className="zap-zrodlo">
        <span>
          Źródło:{' '}
          {o.zrodla.map((z, i) => (
            <span key={z.url}>
              {i > 0 && '; '}
              <a href={z.url} target="_blank" rel="noreferrer">
                {z.nazwa}
              </a>
            </span>
          ))}
        </span>
        <span>
          Rozdzielczość: {o.rozdzielczosc}
          {o.dataDanych && ` – stan danych ${o.dataDanych}`}
        </span>
        {!bezKto && <KtoWybral zrodlo={o.zrodloOdpowiedzi} />}
      </p>
    </div>
  )
}
