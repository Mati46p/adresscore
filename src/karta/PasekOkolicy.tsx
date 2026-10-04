import { URL_PRAW_OSM } from '@/wynik/miejsceAdresu'
import { type WybranaOkolica, zdanieBezObrysu, zdanieOSM } from './okolicaWybrana'
import { spojnyOpis } from './wyszukiwarka/szukajOkolic'

interface Props {
  okolica: WybranaOkolica
  /** `zKlawiatury`: klik z klawiatury (Enter, spacja) – wołający oddaje fokus polu, bo przycisk znika. */
  onZamknij: (zKlawiatury: boolean) => void
}

/**
 * Okolica wybrana w polu wyszukiwarki (#185), pod polem: nazwa, rodzaj z liczbą adresów jak w rankingach
 * luk i uwagi o tym, co pokazuje mapa. Uwagi o nazwie jednostki (rozjazdy z okolice.json) są zwinięte,
 * żeby na telefonie pasek nie spychał mapy. Wyczyszczenie zdejmuje obrys z mapy, kamera zostaje.
 */
export function PasekOkolicy({ okolica, onZamknij }: Props) {
  const { miejsce, nazwaOsm } = okolica
  const zdanieOsm = zdanieOSM(nazwaOsm)
  const bezObrysu = zdanieBezObrysu(okolica)
  return (
    <section className="wybrana-okolica" aria-label="Wybrana okolica">
      <div className="wybrana-okolica__tekst">
        <p className="wybrana-okolica__glowa">
          <span className="wybrana-okolica__etykieta">Okolica</span>
          <strong className="wybrana-okolica__nazwa">{miejsce.nazwa}</strong>
        </p>
        {miejsce.opis && <span className="wybrana-okolica__opis">{spojnyOpis(miejsce.opis)}</span>}
        {zdanieOsm && (
          <p className="wybrana-okolica__uwaga">
            {zdanieOsm}{' '}
            <a href={URL_PRAW_OSM} target="_blank" rel="noreferrer">
              © OpenStreetMap contributors
            </a>
            , licencja ODbL.
          </p>
        )}
        {bezObrysu && <p className="wybrana-okolica__uwaga">{bezObrysu}</p>}
      </div>
      <button
        type="button"
        className="seg"
        aria-label="Wyczyść wybraną okolicę"
        onClick={(e) => onZamknij(e.detail === 0)}
      >
        Wyczyść
      </button>
      {miejsce.uwagi.length > 0 && (
        <details className="wybrana-okolica__szczegoly">
          <summary>O nazwie tej jednostki</summary>
          {miejsce.uwagi.map((uwaga) => (
            <p className="wybrana-okolica__uwaga" key={uwaga}>
              {uwaga}
            </p>
          ))}
        </details>
      )}
    </section>
  )
}
