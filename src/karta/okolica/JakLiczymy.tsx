import { liczba } from '@/karta/adres'
import { KATEGORIE } from '@/kontrakty'
import type { WynikAdresu } from '@/wynik/silnik'
import { liczbaPL, opisWartosci, skladWyniku } from './wyjasnienie'

const PROC = (v: number) => `${liczbaPL(Math.round(v * 10) / 10)}%`
const PKT = (v: number) => liczbaPL(Math.round(v * 10) / 10)

/** Rachunek wyniku: wzór, pasek składu (podstawa 100), tabela kategorii i pominięte warstwy. */
export function JakLiczymy({
  wynik,
  otwarte,
  onZmiana,
}: {
  wynik: WynikAdresu
  otwarte: boolean
  onZmiana: (otwarte: boolean) => void
}) {
  const sklad = skladWyniku(wynik)

  return (
    <section
      id="jak-liczymy"
      aria-labelledby="h-jak-liczymy"
      className="karta okol-jak"
      data-sekcja="jak-liczymy"
    >
      <div className="okol-rozbicie-glowa">
        <h2 id="h-jak-liczymy" className="okol-h2">
          Jak policzyliśmy ten wynik
        </h2>
        <button
          type="button"
          className="seg okol-jak-przelacznik"
          aria-expanded={otwarte}
          aria-controls="jak-liczymy-tresc"
          data-cel="jak-liczymy-przelacznik"
          onClick={() => onZmiana(!otwarte)}
        >
          {otwarte ? 'Zwiń rachunek' : 'Pokaż rachunek'}
        </button>
      </div>
      <p className="okol-podpis">Wynik = suma (udział wagi × ocena 0–100) po warstwach z danymi.</p>

      {sklad.wynik === null ? (
        <p className="okol-podpis">
          Pod tym adresem żadna wybrana warstwa nie ma danych, więc wyniku nie ma. Brak danych nie
          liczy się jako 0.
        </p>
      ) : (
        <>
          <div
            className="okol-jak-pasek"
            role="img"
            aria-label={`Skład wyniku ${liczba(sklad.wynik)} ze 100 punktów`}
          >
            {sklad.kategorie.map((k, n) => (
              <span
                key={k.kategoria}
                className={`okol-jak-seg okol-jak-k${n % 8}`}
                style={{ width: `${k.wklad}%` }}
                title={`${KATEGORIE[k.kategoria]}: ${PKT(k.wklad)} pkt`}
              />
            ))}
            <span
              className="okol-jak-reszta"
              style={{ width: `${sklad.brakDo100}%` }}
              title={`Brakuje do 100: ${PKT(sklad.brakDo100)} pkt`}
            />
          </div>
          <ul className="okol-jak-legenda">
            {sklad.kategorie.map((k, n) => (
              <li key={k.kategoria}>
                <span className={`okol-jak-kropka okol-jak-k${n % 8}`} aria-hidden="true" />
                {KATEGORIE[k.kategoria]} <span className="mono">{PKT(k.wklad)} pkt</span>
              </li>
            ))}
            <li>
              <span className="okol-jak-kropka okol-jak-reszta" aria-hidden="true" />
              punkty, których brakuje do 100{' '}
              <span className="mono">{PKT(sklad.brakDo100)} pkt</span>
            </li>
          </ul>
        </>
      )}

      {otwarte && (
        <div id="jak-liczymy-tresc">
          {sklad.kategorie.length > 0 && (
            <div className="okol-przewijanie" tabIndex={0} role="region" aria-label="Skład wyniku">
              <table className="okol-tabela okol-jak-tabela">
                <thead>
                  <tr>
                    <th scope="col">Kategoria</th>
                    <th scope="col" className="okol-prawo">
                      Udział wagi
                    </th>
                    <th scope="col" className="okol-prawo">
                      Ocena (0–100)
                    </th>
                    <th scope="col" className="okol-prawo">
                      Wkład (pkt)
                    </th>
                  </tr>
                </thead>
                {sklad.kategorie.map((k, n) => (
                  <tbody key={k.kategoria}>
                    <tr>
                      <th scope="row">
                        <span className={`okol-jak-kropka okol-jak-k${n % 8}`} aria-hidden="true" />
                        {KATEGORIE[k.kategoria]}
                      </th>
                      <td className="mono okol-prawo">{PROC(k.udzial)}</td>
                      <td className="mono okol-prawo">{liczba(k.ocena)}</td>
                      <td className="mono okol-prawo">{PKT(k.wklad)}</td>
                    </tr>
                    <tr className="okol-jak-warstwy">
                      <td colSpan={4}>
                        <details>
                          <summary>Warstwy kategorii ({k.warstwy.length})</summary>
                          <ul>
                            {k.warstwy.map((w) => (
                              <li key={w.warstwa.id}>
                                <span className="okol-warstwa-nazwa">{w.warstwa.meta.nazwa}</span>
                                <span className="okol-warstwa-wartosc mono">
                                  {opisWartosci(w.warstwa)}
                                </span>
                                <span className="mono">
                                  udział {PROC(w.udzial)} · ocena {liczba(w.ocena)} · wkład{' '}
                                  {PKT(w.wklad)} pkt
                                </span>
                              </li>
                            ))}
                          </ul>
                        </details>
                      </td>
                    </tr>
                  </tbody>
                ))}
              </table>
            </div>
          )}

          <h3 className="okol-h3">Co nie weszło do wyniku</h3>
          {sklad.pominiete.length === 0 ? (
            <p className="okol-podpis">Wszystkie wybrane warstwy mają dane i weszły do wyniku.</p>
          ) : (
            <ul className="okol-jak-pominiete">
              {sklad.pominiete.map((p) => (
                <li key={p.warstwa.id}>
                  <span className="okol-warstwa-nazwa">{p.warstwa.meta.nazwa}</span>
                  <span className="okol-kat-brak">{p.powod}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="okol-podpis">
            Kompletność danych: {sklad.kompletnosc}%. Brak danych nigdy nie liczy się jako 0 –
            warstwa bez danych wypada z rachunku, a udziały pozostałych liczymy z ich sumy.
          </p>
          <a className="okol-jak-link" href="#h-rozbicie">
            Pełne rozbicie na warstwy ze źródłami
          </a>
        </div>
      )}
    </section>
  )
}
