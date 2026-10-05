import { useState } from 'react'
import { opisAdresu } from '@/karta/adres'
import { useDane } from '@/wynik/dane'
import type { LepszySasiad as Kandydat } from '@/wynik/sasiedzi'
import {
  otworzKarteSasiada,
  porownajZSasiadem,
  przelaczSasiadow,
  wybierzSasiada,
} from '@/wynik/sasiedziStan'
import { useLepsiSasiedzi } from '@/wynik/useSasiedzi'
import { KOLORY_ETYKIETY, type LiteraEtykiety } from './kolory'
import { coWyrozniaTekst, odlegloscTekst, opisCeny, PUSTY_STAN } from './sasiadTeksty'
import './lepszy-sasiad.css'

/**
 * Sekcja „Lepszy sąsiad” (#94): do 3 adresów w 500 m z wyższą literą przy podobnej cenie.
 * Stan sekcji i podświetlenie są wspólne z mapą (#95) – patrz src/wynik/sasiedziStan.ts.
 */
export function LepszySasiad({ adres }: { adres: number }) {
  const { otwarta, wynik, wybrany } = useLepsiSasiedzi()
  const [komunikat, setKomunikat] = useState('')

  function przelacz() {
    setKomunikat('')
    przelaczSasiadow(adres)
  }

  return (
    <section aria-labelledby="h-sasiad" className="karta sas" data-sekcja="lepszy-sasiad">
      <div className="sas-glowa">
        <div className="sas-wstep">
          <h2 id="h-sasiad" className="okol-h2">
            Lepszy sąsiad
          </h2>
          <p className="okol-podpis">
            Adresy do 500 m stąd z wyższą literą przy podobnej cenie za m² (±15%), liczone z Twoimi
            wagami i filtrami.
          </p>
        </div>
        <button
          type="button"
          className="seg sas-przelacz"
          data-cel="pokaz-lepszych-sasiadow"
          aria-expanded={otwarta}
          aria-controls="sas-tresc"
          onClick={przelacz}
        >
          {otwarta ? 'Ukryj' : 'Pokaż lepszych sąsiadów'}
        </button>
      </div>

      <div id="sas-tresc" className="sas-tresc" hidden={!otwarta}>
        {otwarta && wynik && wynik.wyjsciowy.litera === null && (
          <p className="sas-brak-wyniku" role="status">
            Ten adres nie ma wyniku – za mało danych, żeby porównać go z sąsiadami.
          </p>
        )}
        {otwarta && wynik && wynik.wyjsciowy.litera !== null && wynik.kandydaci.length === 0 && (
          <div className="sas-pusto" role="status">
            <span className="sas-pusto-znak" aria-hidden="true">
              ✓
            </span>
            <div>
              <p className="sas-pusto-tytul">{PUSTY_STAN}.</p>
              <p className="sas-pusto-opis">
                {wynik.wyjsciowy.litera === 'A'
                  ? 'Twój adres ma już najwyższą literę A.'
                  : `W podobnej cenie Twój adres (litera ${wynik.wyjsciowy.litera}) wypada w okolicy najlepiej albo na równi z sąsiadami.`}{' '}
                Dla kupującego to dobra wiadomość. Zmień wagi albo filtry, a ta lista przeliczy się
                od razu.
              </p>
            </div>
          </div>
        )}
        {otwarta && wynik && wynik.kandydaci.length > 0 && (
          <>
            <p className="sas-podsumowanie" role="status">
              Twój adres ma literę {wynik.wyjsciowy.litera}. Te adresy w promieniu 500 m mają wyższą
              – najpierw lepsza litera, potem bliżej.
            </p>
            <ol className="sas-lista">
              {wynik.kandydaci.map((k, poz) => (
                <Wiersz
                  key={k.i}
                  kandydat={k}
                  pozycja={poz}
                  wybrany={poz === wybrany}
                  zrodlo={adres}
                  onPelne={() =>
                    setKomunikat(
                      'Porównanie ma już 5 adresów. Usuń któryś na ekranie Porównanie, żeby dodać tę parę.',
                    )
                  }
                />
              ))}
            </ol>
            <p className="sas-przypis">
              Odległość w linii prostej – pieszo zwykle wychodzi trochę dalej.
            </p>
          </>
        )}
        <p className="sas-komunikat" role="status">
          {komunikat}
        </p>
      </div>
    </section>
  )
}

function Wiersz({
  kandydat: k,
  pozycja,
  wybrany,
  zrodlo,
  onPelne,
}: {
  kandydat: Kandydat
  pozycja: number
  wybrany: boolean
  zrodlo: number
  onPelne: () => void
}) {
  const dane = useDane()
  const a = dane.stan === 'gotowe' ? dane.adresy[k.i] : undefined
  if (!a) return null
  const nazwa = opisAdresu(a)
  const kolor = KOLORY_ETYKIETY[k.litera as LiteraEtykiety]
  const cena = opisCeny(k.cena)

  function porownaj() {
    if (porownajZSasiadem(zrodlo, k.i) === 'pelne') onPelne()
  }

  return (
    // Fokus i najechanie podświetlają kandydata także na mapie (#95) – wspólny stan.
    <li
      className="sas-wiersz"
      data-wybrany={wybrany || undefined}
      onFocus={() => wybierzSasiada(pozycja)}
      onMouseEnter={() => wybierzSasiada(pozycja)}
    >
      <span className="sas-litera mono" style={{ background: kolor.tlo, color: kolor.tekst }}>
        <span className="sr-only">Litera </span>
        {k.litera}
      </span>
      <div className="sas-tekst">
        <h3 className="sas-adres">{nazwa}</h3>
        <p className="sas-odleglosc">
          <span className="mono">{odlegloscTekst(k.odlegloscM)}</span>{' '}
          <span className="sas-szary">w linii prostej</span>
        </p>
        <p className="sas-wyroznia">
          <span className="sas-etykieta">Co go wyróżnia: </span>
          {coWyrozniaTekst(k)}
        </p>
        <p className={cena.brak ? 'sas-cena sas-szary' : 'sas-cena'}>{cena.tekst}</p>
        {k.nizszaPewnosc && (
          <p className="sas-pewnosc">Mniej danych niż dla Twojego adresu – wynik mniej pewny.</p>
        )}
      </div>
      {/* Etykiety przycisków niosą adres kandydata, więc cel pomiaru jest jawny: bez `data-cel`
          nazwa wyprowadzałaby się z aria-label i wpuszczała adresy do kluczy CTA. */}
      <div className="sas-akcje">
        <button
          type="button"
          className="przycisk-glowny sas-przycisk"
          data-cel="otworz-karte-sasiada"
          aria-label={`Otwórz kartę: ${nazwa}`}
          onClick={() => otworzKarteSasiada(k.i)}
        >
          Otwórz kartę
        </button>
        <button
          type="button"
          className="seg sas-przycisk"
          data-cel="porownaj-z-sasiadem"
          aria-label={`Porównaj ${nazwa} z Twoim adresem`}
          onClick={porownaj}
        >
          Porównaj
        </button>
      </div>
    </li>
  )
}
