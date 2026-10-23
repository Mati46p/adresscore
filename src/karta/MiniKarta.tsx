// Podsumowanie wybranego adresu: wynik, okolica i główne czynniki bez opisów. Pełny rachunek jest na karcie.
// Dwa warianty: karta w rogu mapy (desktop, z ×) i sekcja na górze arkusza (telefon, bez ×).
import { useState } from 'react'
import type { MiejsceAdresu } from '@/wynik/miejsceAdresu'
import { useWynikAdresu } from '@/wynik/useWyniki'
import { liczbyWarstw, mocneISlabe, type Wplyw, znakowanePunkty } from './okolica/wyjasnienie'

interface Props {
  indeks: number
  nazwa: string
  onOtworz: () => void
  /** `mapa` – karta w rogu mapy z ×; `arkusz` – sekcja w arkuszu, bez ×. */
  wariant?: 'mapa' | 'arkusz'
  /** Okolica wybranego adresu (jednostka SIM, miejscowość albo zapas); brak = bez podpisu. */
  miejsce?: MiejsceAdresu | null
  /** Filtry wykluczają adres / nie da się ich sprawdzić z powodu braku danych. */
  wykluczony?: boolean
  niewiadomy?: boolean
  wPorownaniu: boolean
  /** Limit porównania wyczerpany: dodanie jest zablokowane (usunięcie zawsze działa). */
  limitPorownania: boolean
  onPorownanie: () => void
  /** Tekst ogłoszenia dla czytnika (adres, warstwa, wynik, uwagi o filtrach). */
  ogloszenie: string
}

export function MiniKarta({
  indeks,
  nazwa,
  onOtworz,
  wariant = 'mapa',
  miejsce = null,
  wykluczony = false,
  niewiadomy = false,
  wPorownaniu,
  limitPorownania,
  onPorownanie,
  ogloszenie,
}: Props) {
  const wynik = useWynikAdresu(indeks)
  // Zamknięcie dotyczy tylko tego adresu: kolejny wybór na mapie pokazuje okienko znowu.
  const [zamkniety, setZamkniety] = useState<number | null>(null)
  if (!wynik || (wariant === 'mapa' && zamkniety === indeks)) return null

  const { mocne, slabe } = mocneISlabe(wynik.warstwy, wynik.wynik, 3)
  const { zDanymi, razem } = liczbyWarstw(wynik.warstwy)
  const Znacznik = wariant === 'mapa' ? 'aside' : 'section'

  return (
    <Znacznik
      className={`mini-karta mini-karta--${wariant}`}
      aria-label={`Wynik: ${nazwa}`}
      data-cel="mini-karta"
    >
      {wariant === 'mapa' && (
        <button
          type="button"
          className="mini-karta__zamknij"
          aria-label="Zamknij podgląd wyniku"
          onClick={() => setZamkniety(indeks)}
        >
          ×
        </button>
      )}
      <span className="sr-only" role="status">
        {ogloszenie}
      </span>
      <div className="mini-karta__gora">
        <span className="mini-karta__plakietka mono" data-brak={wynik.wynik === null || undefined}>
          {wynik.wynik === null ? '–' : Math.round(wynik.wynik)}
        </span>
        <div className="mini-karta__opis">
          <strong className="mini-karta__nazwa">{nazwa}</strong>
          {miejsce && (
            <span className="mini-karta__okolica">
              {miejsce.rodzaj === 'zapas' ? (
                miejsce.nazwa
              ) : (
                <>
                  Okolica: <strong>{miejsce.nazwa}</strong>
                  {miejsce.podpis && `, ${miejsce.podpis}`}
                </>
              )}
            </span>
          )}
          <span className="mini-karta__okolica">
            {wynik.wynik === null ? 'brak danych' : 'na 100'} · dane dla {zDanymi} z {razem} warstw
          </span>
          {wykluczony && <span className="mini-karta__uwaga">wykluczony filtrem</span>}
          {niewiadomy && (
            <span className="mini-karta__uwaga">nie wiemy, czy spełnia filtr (brak danych)</span>
          )}
        </div>
      </div>
      {(mocne.length > 0 || slabe.length > 0) && (
        <div className="mini-karta__czynniki">
          <Lista tytul="Mocne" pozycje={mocne} wariant="plus" />
          <Lista tytul="Słabe" pozycje={slabe} wariant="minus" />
        </div>
      )}
      <div className="mini-karta__akcje">
        <button
          type="button"
          className="mini-karta__cta"
          data-cel="otworz-karte"
          onClick={onOtworz}
        >
          Otwórz kartę
        </button>
        <button
          type="button"
          className="mini-karta__drugi"
          data-cel={wPorownaniu ? 'usun-z-porownania' : 'dodaj-do-porownania'}
          disabled={!wPorownaniu && limitPorownania}
          onClick={onPorownanie}
        >
          {wPorownaniu ? 'Usuń z porównania' : 'Dodaj do porównania'}
        </button>
      </div>
    </Znacznik>
  )
}

function Lista({
  tytul,
  pozycje,
  wariant,
}: {
  tytul: string
  pozycje: Wplyw[]
  wariant: 'plus' | 'minus'
}) {
  if (pozycje.length === 0) return <div />
  return (
    <div className="mini-karta__lista">
      <span className="mini-karta__tytul">{tytul}</span>
      <ul>
        {pozycje.map((p) => (
          <li key={p.warstwa.id}>
            <span className={`mini-karta__pkt mini-karta__pkt--${wariant} mono`}>
              {znakowanePunkty(p.punkty)}
            </span>
            <span className="mini-karta__czynnik">{p.warstwa.meta.nazwa}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
