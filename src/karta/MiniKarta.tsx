// Okienko na mapie po wyborze adresu: wynik i główne czynniki bez opisów. Pełny rachunek jest na karcie.
import { useState } from 'react'
import { useWynikAdresu } from '@/wynik/useWyniki'
import { liczbyWarstw, mocneISlabe, type Wplyw, znakowanePunkty } from './okolica/wyjasnienie'

interface Props {
  indeks: number
  nazwa: string
  onOtworz: () => void
}

export function MiniKarta({ indeks, nazwa, onOtworz }: Props) {
  const wynik = useWynikAdresu(indeks)
  // Zamknięcie dotyczy tylko tego adresu: kolejny wybór na mapie pokazuje okienko znowu.
  const [zamkniety, setZamkniety] = useState<number | null>(null)
  if (!wynik || zamkniety === indeks) return null

  const { mocne, slabe } = mocneISlabe(wynik.warstwy, wynik.wynik, 3)
  const { zDanymi, razem } = liczbyWarstw(wynik.warstwy)

  return (
    <aside className="mini-karta" aria-label={`Wynik: ${nazwa}`} data-cel="mini-karta">
      <div className="mini-karta__gora">
        <strong className="mini-karta__nazwa">{nazwa}</strong>
        <button
          type="button"
          className="mini-karta__zamknij"
          aria-label="Zamknij podgląd wyniku"
          onClick={() => setZamkniety(indeks)}
        >
          ×
        </button>
      </div>
      <div className="mini-karta__wynik">
        <span className="mini-karta__liczba mono">
          {wynik.wynik === null ? '–' : Math.round(wynik.wynik)}
        </span>
        <span className="mini-karta__podpis">
          {wynik.wynik === null ? 'brak danych' : 'na 100'}
          <small>
            dane dla {zDanymi} z {razem} warstw
          </small>
        </span>
      </div>
      <Lista tytul="Podnosi" pozycje={mocne} wariant="plus" />
      <Lista tytul="Obniża" pozycje={slabe} wariant="minus" />
      <button
        type="button"
        className="seg wlaczony mini-karta__akcja"
        data-cel="otworz-karte-mini"
        onClick={onOtworz}
      >
        Pełna karta
      </button>
    </aside>
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
  if (pozycje.length === 0) return null
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
