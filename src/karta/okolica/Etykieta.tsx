import { KOLORY_ETYKIETY, LITERY, type LiteraEtykiety } from './kolory'

interface Props {
  litera: LiteraEtykiety | null
  wynik: number | null
}

/** Pionowa drabinka A–G jak etykieta energetyczna, ze strzałką przy literze adresu. */
export function Etykieta({ litera, wynik }: Props) {
  const opis =
    litera && wynik !== null
      ? `Klasa ${litera}, wynik ${Math.round(wynik)} na 100`
      : 'Brak wyniku: za mało danych'
  return (
    <div className="okol-etykieta" role="img" aria-label={opis}>
      {LITERY.map((l, i) => {
        const k = KOLORY_ETYKIETY[l]
        const aktywna = l === litera
        return (
          <div key={l} className="okol-etykieta-wiersz" aria-hidden="true">
            <span
              className="okol-etykieta-pasek"
              style={{
                background: k.tlo,
                color: k.tekst,
                width: `${34 + i * 6}%`,
              }}
            >
              {l}
            </span>
            {aktywna && (
              <span className="okol-etykieta-strzalka">
                <span>{l}</span>
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}
