import { useId } from 'react'
import {
  ETYKIETA_MIN_2_ZRODLA,
  filtrFlagiWlaczony,
  filtryFlagBranzy,
  zFiltremFlagi,
  zFiltremZrodel,
} from '@/wynik/biznesBranze'
import type { FiltryUslug, MetaBranzy } from '@/wynik/biznesUslugi'

/**
 * Przełączniki zawężające konkurencję (#105–#107): „≥ 2 źródła” dla każdej branży oraz filtry
 * flagowe, które ma dana branża (dentysta z umową NFZ, restauracja bez fast foodu, fryzjer tylko
 * barber). Domyślnie wszystko wyłączone: konkurencja to wszystkie punkty z katalogu.
 */
export function FiltryKonkurencji({
  idBranzy,
  filtry,
  meta,
  onZmien,
}: {
  idBranzy: string
  filtry: FiltryUslug
  /** Wczytana branża; `null` w trakcie ładowania. */
  meta: MetaBranzy | null
  onZmien: (filtry: FiltryUslug) => void
}) {
  const idOpisu = useId()
  const flagi = filtryFlagBranzy(idBranzy)
  const pusto = meta !== null && meta.poFiltrach === 0
  return (
    <fieldset className="biznes-filtry">
      <legend>Kogo liczyć jako konkurencję</legend>
      <label className="biznes-filtr">
        <input
          type="checkbox"
          checked={filtry.min2Zrodla}
          aria-describedby={`${idOpisu}-zrodla`}
          onChange={(e) => onZmien(zFiltremZrodel(filtry, e.target.checked))}
        />
        <span>
          <strong>{ETYKIETA_MIN_2_ZRODLA}</strong>
          <small id={`${idOpisu}-zrodla`}>
            Pomija punkty widoczne tylko w jednym zbiorze danych, np. tylko w OpenStreetMap. Zostaje
            mniej punktów, za to lepiej potwierdzonych.
          </small>
        </span>
      </label>
      {flagi.map((def) => (
        <label className="biznes-filtr" key={def.flaga}>
          <input
            type="checkbox"
            checked={filtrFlagiWlaczony(filtry, def)}
            aria-describedby={`${idOpisu}-${def.flaga}`}
            onChange={(e) => onZmien(zFiltremFlagi(filtry, def, e.target.checked))}
          />
          <span>
            <strong>{def.etykieta}</strong>
            <small id={`${idOpisu}-${def.flaga}`}>{def.opis}</small>
          </span>
        </label>
      ))}
      {pusto && (
        <p role="status" className="biznes-filtry-pusto">
          Żaden punkt nie spełnia wybranych filtrów, więc konkurencji nie ma, a wynik opiera się
          tylko na liczbie adresów w zasięgu.
        </p>
      )}
    </fieldset>
  )
}
