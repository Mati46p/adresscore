import { useEffect, useState } from 'react'
import { KATEGORIE, type KategoriaId } from '@/kontrakty'
import { useDane } from '@/wynik/dane'
import { PERSONY, type PersonaId, TRYBY } from '@/wynik/persony'
import {
  type KierunekOceny,
  KOLEJNOSC_KATEGORII,
  kierunekEfektywny,
  WAGA_MAX,
  type WskaznikPrzygotowany,
  wagaUzytkownika,
} from '@/wynik/silnik'
import { useStan, ustawKierunek, ustawTryb, ustawWage, wybierzPersone } from '@/wynik/stan'
import './panel.css'

const SEGMENTY_WAGI = Array.from({ length: WAGA_MAX + 1 }, (_, n) => n)

const KIERUNKI: readonly { id: KierunekOceny; znak: string; opis: string; tekst: string }[] = [
  { id: 'wiecej-lepiej', znak: '↑', opis: 'Więcej lepiej', tekst: 'więcej to lepiej' },
  { id: 'mniej-lepiej', znak: '↓', opis: 'Mniej lepiej', tekst: 'mniej to lepiej' },
  { id: 'optimum', znak: '≈', opis: 'Optimum, środek skali', tekst: 'najlepszy środek skali' },
]

const OPIS_TRYBU: Record<string, string> = {
  kupuje:
    'Mocniej liczy się przyszłość okolicy i ryzyko (waga +1). Cena m² z RCN jest na razie tylko kontekstem na karcie i nie wchodzi do wyniku.',
  wynajmuje:
    'Mocniej liczy się dojazd (waga +1), słabiej przyszłość okolicy (waga −1). Szacunek czynszu: wkrótce – nie mamy jeszcze danych o najmie.',
}

// Panel pamięta ostatni wybrany profil, żeby „Przywróć wagi profilu" działało po ręcznej
// zmianie (stan wtedy trzyma tylko 'wlasna'). Zmienna modułu przeżywa zmianę ekranu.
let ostatniaPersona: PersonaId = 'rodzina'

function opisZrodla(w: WskaznikPrzygotowany): string {
  const { meta } = w
  const zrodlo = meta.zrodla[0]?.nazwa ?? 'brak źródła'
  const rozmiar = meta.rozmiar ? ` ${meta.rozmiar}` : ''
  return `${zrodlo} · ${meta.rozdzielczosc}${rozmiar}`
}

/**
 * Panel filtrów wg docs/makieta/Main.dc.html: tryb, profil, warstwy z wagami 0–4 i kierunkami.
 * Warstwy bierzemy z manifestu, więc nowa warstwa z ETL pojawia się tu bez zmian w kodzie.
 */
export function PanelFiltrow() {
  const dane = useDane()
  const tryb = useStan((s) => s.tryb)
  const persona = useStan((s) => s.persona)
  const wagi = useStan((s) => s.wagi)
  const kierunki = useStan((s) => s.kierunki)

  useEffect(() => {
    if (persona !== 'wlasna') ostatniaPersona = persona
  }, [persona])

  const wskazniki = dane.stan === 'gotowe' ? dane.wskazniki : []
  const liczone = wskazniki.filter((w) => w.meta.kategoria !== 'kontekst')
  const aktywne = liczone.filter(
    (w) => wagaUzytkownika(wagi, w.meta.id) > 0 && kierunekEfektywny(w.meta, kierunki) !== null,
  ).length
  const opisPersony = PERSONY.find((p) => p.id === persona)?.opis

  return (
    <>
      <div className="panel-wstep">
        <h1>Znajdź okolicę w Krakowie</h1>
        <p>Każda zmiana po lewej od razu przelicza kolory na mapie.</p>
      </div>

      <section aria-labelledby="h-tryb" className="panel-sekcja">
        <h2 id="h-tryb" className="etykieta-sekcji">
          Czego szukasz
        </h2>
        <div className="panel-kafle">
          {TRYBY.map((t) => (
            <button
              key={t.id}
              type="button"
              className="opt panel-kafel"
              aria-pressed={tryb === t.id}
              onClick={() => ustawTryb(t.id)}
            >
              <span className="panel-kafel-tytul">{t.nazwa}</span>
              <span className="panel-kafel-opis">{t.opis}</span>
            </button>
          ))}
        </div>
        <p className="panel-uwaga" aria-live="polite">
          {OPIS_TRYBU[tryb]}
        </p>
      </section>

      <section aria-labelledby="h-persona" className="panel-sekcja">
        <h2 id="h-persona" className="etykieta-sekcji">
          Profil (ustawia wagi poniżej)
        </h2>
        <div className="panel-chipy">
          {PERSONY.map((p) => (
            <button
              key={p.id}
              type="button"
              className="seg panel-chip"
              title={p.opis}
              aria-pressed={persona === p.id}
              onClick={() => wybierzPersone(p.id)}
            >
              {p.nazwa}
            </button>
          ))}
        </div>
        <p className="panel-uwaga" aria-live="polite">
          {persona === 'wlasna'
            ? 'Własne ustawienia – zmieniłeś wagi albo kierunki ręcznie.'
            : opisPersony}
        </p>
      </section>

      <section aria-labelledby="h-wagi" className="panel-sekcja">
        <div className="panel-wagi-glowa">
          <h2 id="h-wagi" className="etykieta-sekcji">
            Warstwy i wagi
          </h2>
          <span className="panel-licznik" aria-live="polite">
            {aktywne} {aktywne === 1 ? 'warstwa aktywna' : 'warstw aktywnych'} z {liczone.length}
          </span>
        </div>
        <p className="panel-uwaga">
          Waga 0–4. Strzałka: czy więcej to lepiej (↑), mniej lepiej (↓), czy szukasz środka (≈).
        </p>
        <div className="panel-akcje">
          <button
            type="button"
            className="seg panel-akcja"
            disabled={persona !== 'wlasna'}
            onClick={() => wybierzPersone(ostatniaPersona)}
          >
            Przywróć wagi profilu
          </button>
        </div>

        {dane.stan === 'ladowanie' && <p className="panel-uwaga">Wczytuję warstwy…</p>}
        {dane.stan === 'blad' && <p className="panel-uwaga">Nie udało się wczytać warstw.</p>}
        {KOLEJNOSC_KATEGORII.map((kat, i) => {
          const warstwy = wskazniki.filter((w) => w.meta.kategoria === kat)
          if (warstwy.length === 0) return null
          return (
            <GrupaWarstw
              key={kat}
              kategoria={kat}
              warstwy={warstwy}
              wagi={wagi}
              kierunki={kierunki}
              poczatkowoOtwarta={i === 0}
            />
          )
        })}
      </section>
    </>
  )
}

interface GrupaProps {
  kategoria: KategoriaId
  warstwy: readonly WskaznikPrzygotowany[]
  wagi: Readonly<Record<string, number>>
  kierunki: Readonly<Record<string, KierunekOceny>>
  poczatkowoOtwarta: boolean
}

function GrupaWarstw({ kategoria, warstwy, wagi, kierunki, poczatkowoOtwarta }: GrupaProps) {
  const [otwarta, setOtwarta] = useState(poczatkowoOtwarta)
  const informacyjna = kategoria === 'kontekst'
  const aktywne = warstwy.filter((w) => wagaUzytkownika(wagi, w.meta.id) > 0).length
  const suma = warstwy.reduce((s, w) => s + wagaUzytkownika(wagi, w.meta.id), 0)
  const podsumowanie = informacyjna
    ? `${warstwy.length} informacyjn${warstwy.length === 1 ? 'a' : 'e'}`
    : `${aktywne} z ${warstwy.length} · suma wag ${suma}`
  const idListy = `panel-grupa-${kategoria}`

  return (
    <div className="panel-grupa">
      <button
        type="button"
        className="panel-grupa-glowa"
        aria-expanded={otwarta}
        aria-controls={idListy}
        onClick={() => setOtwarta(!otwarta)}
      >
        <span className="panel-grupa-tytul">{KATEGORIE[kategoria]}</span>
        <span className="panel-grupa-podsumowanie">
          <span>{podsumowanie}</span>
          <span aria-hidden="true">{otwarta ? '▴' : '▾'}</span>
        </span>
      </button>
      {otwarta && (
        <ul id={idListy} className="panel-warstwy">
          {warstwy.map((w) => (
            <Warstwa key={w.meta.id} w={w} wagi={wagi} kierunki={kierunki} />
          ))}
        </ul>
      )}
    </div>
  )
}

function Warstwa({
  w,
  wagi,
  kierunki,
}: {
  w: WskaznikPrzygotowany
  wagi: Readonly<Record<string, number>>
  kierunki: Readonly<Record<string, KierunekOceny>>
}) {
  const { meta } = w
  const waga = wagaUzytkownika(wagi, meta.id)
  const informacyjna = meta.kategoria === 'kontekst'
  const neutralna = meta.kierunek === 'neutralny'
  const kierunek = kierunekEfektywny(meta, kierunki)
  const opisKierunku = KIERUNKI.find((k) => k.id === kierunek)

  return (
    <li className="panel-warstwa" title={meta.opis}>
      <div className="panel-warstwa-glowa">
        <span className="panel-warstwa-nazwa">{meta.nazwa}</span>
        <span className="panel-warstwa-zrodlo mono">{opisZrodla(w)}</span>
      </div>
      {meta.atrapa && <span className="atrapa panel-atrapa">dane przykładowe</span>}

      {informacyjna ? (
        <p className="panel-info">Tylko warstwa informacyjna, bez wpływu na wynik</p>
      ) : (
        <>
          <div className="panel-sterowanie">
            <div role="group" aria-label={`Waga: ${meta.nazwa}`} className="panel-seg-grupa">
              {SEGMENTY_WAGI.map((n) => (
                <button
                  key={n}
                  type="button"
                  className="seg panel-seg"
                  aria-pressed={waga === n}
                  aria-label={`Waga ${n}: ${meta.nazwa}`}
                  onClick={() => ustawWage(meta.id, n)}
                >
                  {n}
                </button>
              ))}
            </div>
            {neutralna && (
              <div role="group" aria-label={`Kierunek: ${meta.nazwa}`} className="panel-seg-grupa">
                {KIERUNKI.map((k) => (
                  <button
                    key={k.id}
                    type="button"
                    className="seg panel-seg"
                    title={k.opis}
                    aria-pressed={kierunek === k.id}
                    aria-label={`${k.opis}: ${meta.nazwa}`}
                    onClick={() => ustawKierunek(meta.id, kierunek === k.id ? null : k.id)}
                  >
                    {k.znak}
                  </button>
                ))}
              </div>
            )}
          </div>
          {neutralna && !kierunek && (
            <p className="panel-nota">
              Wybierz kierunek – bez niego warstwa nie liczy się do wyniku.
            </p>
          )}
          {!neutralna && opisKierunku && (
            <p className="panel-kierunek">
              <span aria-hidden="true">{opisKierunku.znak}</span> {opisKierunku.tekst}
            </p>
          )}
        </>
      )}
    </li>
  )
}
