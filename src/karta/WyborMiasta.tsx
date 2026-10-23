// Lista miast ekranu Szukaj (#223, F6): przyciski dla każdego zbioru z rejestru, bieżące miasto wciśnięte
// (akcent należy wyłącznie do stanu wybranego), pod spodem stan wczytywania jego pełnych danych i miasta,
// których przegląd na mapie jest chwilowo niedostępny. Komponent niczego nie zmienia sam: wybór oddaje
// wołającemu (`onWybierz`), który zmienia miasto i leci kamerą (EkranSzukaj).
import { MIASTA, type SlugMiasta } from '@/kontrakty'

interface Props {
  biezace: SlugMiasta
  /** Nazwa miasta, którego pełne dane się wczytują, albo null. */
  wczytywane: string | null
  /** Nazwy miast, których przegląd się nie wczytał (dane chwilowo niedostępne), w kolejności rejestru. */
  niedostepne: readonly string[]
  onWybierz: (slug: SlugMiasta) => void
  /** Przelot do widoku wszystkich miast (decyzja #250: start jest na kadrze bieżącego miasta). */
  onWszystkie: () => void
}

export function WyborMiasta({ biezace, wczytywane, niedostepne, onWybierz, onWszystkie }: Props) {
  const komunikaty = [
    wczytywane ? `Wczytuję dane: ${wczytywane}…` : null,
    niedostepne.length > 0 ? `Dane chwilowo niedostępne: ${niedostepne.join(', ')}.` : null,
  ].filter((k) => k !== null)
  const tekst = komunikaty.join(' ')
  return (
    <section className="wybor-miasta" aria-labelledby="h-wybor-miasta">
      {/* Lista miast zwinięta pod nazwą bieżącego, żeby nie zajmowała panelu. */}
      <details className="panel-rozwijane">
        <summary>
          <h2 id="h-wybor-miasta" className="etykieta-sekcji">
            Miasto: {MIASTA.find((m) => m.slug === biezace)?.nazwa}
          </h2>
        </summary>
        {/* Jeden cel pomiaru dla wszystkich przycisków: to jedna czynność (zmiana miasta), a nazwa miasta nie
          może trafić do klucza. */}
        <div className="wybor-miasta__lista">
          {MIASTA.map((m) => (
            <button
              key={m.slug}
              type="button"
              className="seg"
              data-cel="wybierz-miasto"
              aria-pressed={m.slug === biezace}
              onClick={() => onWybierz(m.slug)}
            >
              {m.nazwa}
            </button>
          ))}
        </div>
      </details>
      <button
        type="button"
        className="seg wybor-miasta__wszystkie"
        data-cel="wszystkie-miasta"
        onClick={onWszystkie}
      >
        Wszystkie miasta
      </button>
      {/* Region stoi zawsze (czytnik ogłasza zmianę tekstu, a nie pojawienie się elementu), a widzący dostaje
          ten sam tekst w zwykłym akapicie tylko wtedy, gdy jest co powiedzieć. */}
      <span className="sr-only" role="status">
        {tekst}
      </span>
      {tekst !== '' && (
        <p className="wybor-miasta__status" aria-hidden="true">
          {tekst}
        </p>
      )}
    </section>
  )
}
