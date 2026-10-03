import { useDane } from '@/wynik/dane'
import { useStan, ustawKierunek, ustawKomitet, ustawWage } from '@/wynik/stan'
import { czyWarstwaWyborow } from '@/wynik/wybory'
import './filtrWyborczy.css'

const NAZWY: Record<string, string> = {
  sejm2023_lista_1: 'Bezpartyjni Samorządowcy',
  sejm2023_lista_2: 'Trzecia Droga',
  sejm2023_lista_3: 'Nowa Lewica',
  sejm2023_lista_4: 'Prawo i Sprawiedliwość',
  sejm2023_lista_5: 'Konfederacja',
  sejm2023_lista_6: 'Koalicja Obywatelska',
  sejm2023_lista_7: 'Polska Jest Jedna',
}

export function FiltrWyborczy() {
  const dane = useDane()
  const stan = useStan((s) => s)
  if (dane.stan !== 'gotowe' || stan.tryb === 'biznes') return null
  const warstwy = dane.wskazniki.filter((w) => czyWarstwaWyborow(w.meta.id))
  if (!warstwy.length) return null
  const wybrany =
    warstwy.find((w) => (stan.wagi[w.meta.id] ?? 0) > 0) ??
    warstwy.find((w) => stan.kierunki[w.meta.id]) ??
    warstwy[0]!
  const id = wybrany.meta.id
  const waga = stan.wagi[id] ?? 0
  const wlaczony = waga > 0
  const wartosc = stan.wybrany === null ? null : wybrany.wartosci[stan.wybrany]

  return (
    <section className="wybory-filtr" aria-labelledby="wybory-filtr-h">
      <div className="wybory-filtr__glowa">
        <div>
          <h2 id="wybory-filtr-h">Wynik wyborów w gminie</h2>
          <p>Sejm 2023 · historyczny wynik gminy adresu</p>
        </div>
        {wartosc !== null && wartosc !== undefined && (
          <strong className="wybory-filtr__wartosc">
            {wartosc.toLocaleString('pl-PL', { maximumFractionDigits: 1 })}%
          </strong>
        )}
      </div>
      <label className="wybory-filtr__wybor">
        Komitet
        <select value={id} onChange={(event) => ustawKomitet(event.currentTarget.value)}>
          {warstwy.map((w) => (
            <option key={w.meta.id} value={w.meta.id}>
              {NAZWY[w.meta.id] ?? w.meta.nazwa}
            </option>
          ))}
        </select>
      </label>
      <label className="wybory-filtr__wlacz">
        <input
          type="checkbox"
          checked={wlaczony}
          onChange={(event) => {
            if (event.currentTarget.checked && !stan.kierunki[id])
              ustawKierunek(id, 'wiecej-lepiej')
            ustawWage(id, event.currentTarget.checked ? 2 : 0)
          }}
        />
        Uwzględnij udział głosów w mojej ocenie
      </label>
      {wlaczony && (
        <div className="wybory-filtr__ustawienia">
          <fieldset>
            <legend>Co wolisz?</legend>
            <label>
              <input
                type="radio"
                name="wybory-kierunek"
                checked={stan.kierunki[id] !== 'mniej-lepiej'}
                onChange={() => ustawKierunek(id, 'wiecej-lepiej')}
              />
              Większy udział
            </label>
            <label>
              <input
                type="radio"
                name="wybory-kierunek"
                checked={stan.kierunki[id] === 'mniej-lepiej'}
                onChange={() => ustawKierunek(id, 'mniej-lepiej')}
              />
              Mniejszy udział
            </label>
          </fieldset>
          <label>
            Ważność
            <select
              value={waga}
              onChange={(event) => ustawWage(id, Number(event.currentTarget.value))}
            >
              {[1, 2, 3, 4].map((n) => (
                <option key={n} value={n}>
                  {n} z 4
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      <details>
        <summary>O danych wyborczych</summary>
        <p>
          Wynik z 15 października 2023 r. dotyczy całej gminy. Nie opisuje poglądów mieszkańców
          budynku. Źródło: PKW. Pełna nazwa: {wybrany.meta.nazwa.replace('Sejm 2023 · ', '')}.
        </p>
      </details>
    </section>
  )
}
