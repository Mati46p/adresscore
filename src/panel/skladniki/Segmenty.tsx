// Przełącznik jednej z kilku opcji (okres 7/30 dni, miara wykresu). `aria-pressed` zamiast
// `role=radiogroup`: to przyciski przełączające widok tej samej sekcji, a nie wybór wartości
// formularza, więc czytnik ma powiedzieć „wciśnięty”, nie „zaznaczony 1 z 2”. Styl: globalna klasa
// `.seg` (pigułka; wciśnięty = akcent, czyli stan wybrany; hover pod `@media (hover: hover)`).
//
// Filtr okresu stoi w JEDNYM rzędzie nad zakładką i obejmuje wszystkie sekcje poniżej (liczby w
// całej zakładce zawsze się zgadzają), a nie przy każdym wykresie osobno.
export function Segmenty<T extends string | number>({
  legenda,
  opcje,
  wartosc,
  naZmiane,
}: {
  /** Nazwa grupy dla czytników ekranu (np. „Okres”). */
  legenda: string
  opcje: readonly { id: T; etykieta: string; tytul?: string }[]
  wartosc: T
  naZmiane: (id: T) => void
}) {
  return (
    <fieldset className="panel-segmenty">
      <legend className="sr-only">{legenda}</legend>
      {opcje.map((o) => (
        <button
          key={String(o.id)}
          type="button"
          className="seg"
          aria-pressed={o.id === wartosc}
          title={o.tytul}
          onClick={() => naZmiane(o.id)}
        >
          {o.etykieta}
        </button>
      ))}
    </fieldset>
  )
}
