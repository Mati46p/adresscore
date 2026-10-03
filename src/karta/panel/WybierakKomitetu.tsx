import { krotkaNazwaKomitetu } from './komitety'
import './komitety.css'

export interface OpcjaKomitetu {
  id: string
  nazwa: string
}

export function WybierakKomitetu({
  komitety,
  wybranyId,
  onChange,
}: {
  komitety: readonly OpcjaKomitetu[]
  wybranyId: string | null
  onChange: (id: string) => void
}) {
  if (komitety.length === 0) return null
  const wybrany = komitety.find((k) => k.id === wybranyId)
  return (
    <fieldset className="komitety-wybor">
      <legend>Komitet wyborczy – {komitety.length} do wyboru</legend>
      <div className="komitety-opcje">
        {komitety.map((k) => (
          <label key={k.id} className="komitety-opcja">
            <input
              type="radio"
              name="komitet-sejm-2023"
              value={k.id}
              checked={k.id === wybranyId}
              onChange={() => onChange(k.id)}
            />
            <span>{krotkaNazwaKomitetu(k.nazwa)}</span>
          </label>
        ))}
      </div>
      {wybrany ? (
        <p className="komitety-pelna-nazwa">
          Pełna nazwa PKW: {wybrany.nazwa.replace(/^Sejm 2023\s*·\s*/, '')}
        </p>
      ) : (
        <p className="komitety-pelna-nazwa">Wybierz komitet, aby ustawić kierunek i wagę.</p>
      )}
    </fieldset>
  )
}
