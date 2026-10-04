import { useEffect, useState } from 'react'
import { KATEGORIE, type KategoriaId, type WskaznikMeta } from '@/kontrakty'
import { useDane } from '@/wynik/dane'
import { BIZNESY, PERSONY, type PersonaId, TRYBY, type Tryb, warstwyBiznesu } from '@/wynik/persony'
import {
  type KierunekOceny,
  KOLEJNOSC_KATEGORII,
  kierunekEfektywny,
  WAGA_MAX,
  type WskaznikPrzygotowany,
  wagaUzytkownika,
} from '@/wynik/silnik'
import {
  useStan,
  ustawKierunek,
  ustawKomitet,
  ustawRodzajBiznesu,
  ustawTryb,
  ustawTrybMapy,
  ustawWage,
  wybierzPersone,
} from '@/wynik/stan'
import './panel.css'
import { czyWarstwaWyborow } from '@/wynik/wybory'
import { etykietaKierunku, kierunkiWarstwy } from './preferencje'
import { WybierakKomitetu } from './WybierakKomitetu'

const SEGMENTY_WAGI = Array.from({ length: WAGA_MAX + 1 }, (_, n) => n)

const KIERUNKI: readonly { id: KierunekOceny; znak: string }[] = [
  { id: 'wiecej-lepiej', znak: '↑' },
  { id: 'mniej-lepiej', znak: '↓' },
]

const OPIS_TRYBU: Record<Tryb, string> = {
  kupuje:
    'Mocniej liczy się bezpieczeństwo i ryzyko (waga +1). Cena m² jest przykładowa i nie wpływa na wynik, dopóki nie podłączymy danych RCN.',
  wynajmuje:
    'Mocniej liczy się dojazd (waga +1). Szacunek czynszu: wkrótce – nie mamy jeszcze danych o najmie.',
  biznes:
    'Dalej od podobnej usługi i więcej stałych mieszkańców w polu 1 km² daje wyższy wynik. To wstępna ocena lokalizacji: nie mierzy ruchu pieszych, popytu ani sprzedaży.',
}

// Panel pamięta ostatni wybrany profil, żeby „Przywróć wagi profilu" działało po ręcznej
// zmianie (stan wtedy trzyma tylko 'wlasna'). Zmienna modułu przeżywa zmianę ekranu.
let ostatniaPersona: PersonaId = 'rodzina'

function opisDomyslny(meta: WskaznikMeta): string {
  return etykietaKierunku(
    meta,
    meta.kierunek === 'neutralny' ? 'wiecej-lepiej' : meta.kierunek,
  ).toLowerCase()
}

function opisZrodla(w: WskaznikPrzygotowany): string {
  const { meta } = w
  const zrodlo = meta.zrodla[0]?.nazwa ?? 'brak źródła'
  const rozmiar = meta.rozmiar ? ` ${meta.rozmiar}` : ''
  return `${zrodlo} · ${meta.rozdzielczosc}${rozmiar}`
}

/**
 * Panel filtrów wg docs/makieta/Main.dc.html: tryb, profil, warstwy z wagami 0–4 i kierunkami.
 * Warstwy bierzemy z manifestu, więc nowa warstwa z ETL pojawia się tu bez zmian w kodzie.
 */
export function PanelFiltrow() {
  const dane = useDane()
  const tryb = useStan((s) => s.tryb)
  const biznes = useStan((s) => s.biznes)
  const persona = useStan((s) => s.persona)
  const wagi = useStan((s) => s.wagi)
  const kierunki = useStan((s) => s.kierunki)
  const trybMapy = useStan((s) => s.trybMapy)
  const ostatniaWarstwa = useStan((s) => s.ostatniaWarstwa)

  useEffect(() => {
    if (persona !== 'wlasna') ostatniaPersona = persona
  }, [persona])

  const wskazniki = dane.stan === 'gotowe' ? dane.wskazniki : []
  const warstwyPanelu =
    tryb === 'biznes'
      ? wskazniki.filter((w) =>
          warstwyBiznesu(biznes).some((id) => id === w.meta.id && !w.meta.atrapa),
        )
      : wskazniki
  const wyborcze = warstwyPanelu.filter((w) => czyWarstwaWyborow(w.meta.id))
  const wybranyKomitet =
    wyborcze.find((w) => wagaUzytkownika(wagi, w.meta.id) > 0) ??
    wyborcze.find((w) => kierunki[w.meta.id]) ??
    wyborcze[0]
  const liczone = warstwyPanelu.filter((w) => w.meta.kategoria !== 'kontekst')
  const aktywne = liczone.filter(
    (w) => wagaUzytkownika(wagi, w.meta.id) > 0 && kierunekEfektywny(w.meta, kierunki) !== null,
  ).length
  const opisPersony = PERSONY.find((p) => p.id === persona)?.opis

  return (
    <>
      <section aria-labelledby="h-tryb" className="panel-sekcja">
        <h2 id="h-tryb" className="etykieta-sekcji">
          Czego szukasz
        </h2>
        <div className="panel-kafle">
          {TRYBY.map((t) => (
            <button
              key={t.id}
              type="button"
              className="opt panel-kafel"
              aria-pressed={tryb === t.id}
              onClick={() => ustawTryb(t.id)}
            >
              <span className="panel-kafel-tytul">{t.nazwa}</span>
              <span className="panel-kafel-opis">{t.opis}</span>
            </button>
          ))}
        </div>
        <p className="panel-uwaga" aria-live="polite">
          {OPIS_TRYBU[tryb]}
        </p>
      </section>

      {tryb === 'biznes' && (
        <section aria-labelledby="h-rodzaj-biznesu" className="panel-sekcja">
          <h2 id="h-rodzaj-biznesu" className="etykieta-sekcji">
            Rodzaj działalności
          </h2>
          <div className="panel-chipy" role="group" aria-label="Rodzaj działalności">
            {BIZNESY.map((b) => (
              <button
                key={b.id}
                type="button"
                className="seg panel-chip"
                aria-pressed={biznes === b.id}
                onClick={() => ustawRodzajBiznesu(b.id)}
              >
                {b.nazwa}
              </button>
            ))}
          </div>
          <p className="panel-uwaga">
            Konkurencję przybliża odległość do najbliższego podobnego punktu. Możesz zmienić wagę
            lub kierunek każdej warstwy poniżej.
          </p>
        </section>
      )}

      {tryb === 'biznes' &&
        dane.stan === 'gotowe' &&
        warstwyBiznesu(biznes).some(
          (id) => !wskazniki.some((w) => w.meta.id === id && !w.meta.atrapa),
        ) && (
          <p className="panel-uwaga" role="status">
            Dostępne rzeczywiste warstwy biznesowe: {warstwyPanelu.length} z{' '}
            {warstwyBiznesu(biznes).length}. Brakująca warstwa nie wpływa na wynik.
          </p>
        )}

      {tryb !== 'biznes' && (
        <section aria-labelledby="h-persona" className="panel-sekcja">
          <h2 id="h-persona" className="etykieta-sekcji">
            Profil (ustawia wagi poniżej)
          </h2>
          <div className="panel-chipy">
            {PERSONY.map((p) => (
              <button
                key={p.id}
                type="button"
                className="seg panel-chip"
                title={p.opis}
                aria-pressed={persona === p.id}
                onClick={() => wybierzPersone(p.id)}
              >
                {p.nazwa}
              </button>
            ))}
          </div>
          <p className="panel-uwaga" aria-live="polite">
            {persona === 'wlasna'
              ? 'Własne ustawienia – wagi lub kierunki zmienione ręcznie.'
              : opisPersony}
          </p>
        </section>
      )}

      <section aria-labelledby="h-wagi" className="panel-sekcja">
        <div className="panel-wagi-glowa">
          <h2 id="h-wagi" className="etykieta-sekcji">
            Warstwy i wagi
          </h2>
          <span className="panel-licznik" aria-live="polite">
            {aktywne} {aktywne === 1 ? 'warstwa aktywna' : 'warstw aktywnych'} z {liczone.length}
          </span>
        </div>
        <p className="panel-uwaga">
          Waga 0–4 mówi, jak ważna jest dla Ciebie warstwa: 0 – pomijam, 4 – bardzo ważne. Kierunek
          wskazuje, które miejsca wolisz.
          {tryb !== 'biznes' && ' Warstwy kontekstu liczą się dopiero po włączeniu.'}
        </p>
        {tryb !== 'biznes' && (
          <div className="panel-akcje">
            <button
              type="button"
              className="seg panel-akcja"
              disabled={persona !== 'wlasna'}
              onClick={() => wybierzPersone(ostatniaPersona)}
            >
              Przywróć wagi profilu
            </button>
          </div>
        )}

        {dane.stan === 'ladowanie' && <p className="panel-uwaga">Wczytuję warstwy…</p>}
        {dane.stan === 'blad' && <p className="panel-uwaga">Nie udało się wczytać warstw.</p>}
        {KOLEJNOSC_KATEGORII.map((kat, i) => {
          const warstwy = warstwyPanelu.filter(
            (w) => w.meta.kategoria === kat && !czyWarstwaWyborow(w.meta.id),
          )
          if (kat === 'bezpieczenstwo') {
            const najwazniejsze = ['powodz_10proc', 'straz_pozarna_odleglosc', 'policja_odleglosc']
            warstwy.sort((a, b) => {
              const pozycjaA = najwazniejsze.indexOf(a.meta.id)
              const pozycjaB = najwazniejsze.indexOf(b.meta.id)
              return (pozycjaA < 0 ? 99 : pozycjaA) - (pozycjaB < 0 ? 99 : pozycjaB)
            })
          }
          // Wybory to jedna warstwa w „Społeczności” z wyborem komitetu, nie osobna grupa.
          const wybory =
            tryb !== 'biznes' && kat === 'spolecznosc' && wybranyKomitet
              ? { komitet: wybranyKomitet, komitety: wyborcze }
              : undefined
          if (warstwy.length === 0 && !wybory) return null
          return (
            <GrupaWarstw
              key={`${tryb}-${kat}`}
              kategoria={kat}
              warstwy={warstwy}
              wybory={wybory}
              wagi={wagi}
              kierunki={kierunki}
              poczatkowoOtwarta={tryb === 'biznes' || i === 0}
            />
          )
        })}
        <div className="panel-tryb-mapy" role="group" aria-label="Widok mapy">
          <span className="panel-tryb-mapy-etykieta">Mapa pokazuje</span>
          <div className="panel-tryb-mapy-opcje">
            <button
              type="button"
              className="seg"
              aria-pressed={trybMapy === 'suma'}
              onClick={() => ustawTrybMapy('suma')}
            >
              Sumę wybranych opcji
            </button>
            <button
              type="button"
              className="seg"
              aria-pressed={trybMapy === 'ostatnia'}
              onClick={() => ustawTrybMapy('ostatnia')}
            >
              Ostatnio zmienioną opcję
            </button>
          </div>
          {trybMapy === 'ostatnia' && !ostatniaWarstwa && (
            <span className="panel-tryb-mapy-podpowiedz">
              Zmień wagę lub kierunek wybranej warstwy.
            </span>
          )}
        </div>
      </section>
    </>
  )
}

interface GrupaProps {
  kategoria: KategoriaId
  warstwy: readonly WskaznikPrzygotowany[]
  wagi: Readonly<Record<string, number>>
  kierunki: Readonly<Record<string, KierunekOceny>>
  poczatkowoOtwarta: boolean
  /** Warstwa wyborów: liczona razem z grupą (waga i suma), komitet wybierany w miejscu. */
  wybory?: {
    komitet: WskaznikPrzygotowany
    komitety: readonly WskaznikPrzygotowany[]
  }
}

function GrupaWarstw({
  kategoria,
  warstwy: warstwyBez,
  wybory,
  wagi,
  kierunki,
  poczatkowoOtwarta,
}: GrupaProps) {
  const [otwarta, setOtwarta] = useState(poczatkowoOtwarta)
  const informacyjna = kategoria === 'kontekst'
  const warstwy = wybory ? [...warstwyBez, wybory.komitet] : warstwyBez
  const aktywne = warstwy.filter(
    (w) => wagaUzytkownika(wagi, w.meta.id) > 0 && kierunekEfektywny(w.meta, kierunki) !== null,
  ).length
  const suma = warstwy.reduce(
    (s, w) => s + (kierunekEfektywny(w.meta, kierunki) ? wagaUzytkownika(wagi, w.meta.id) : 0),
    0,
  )
  const podsumowanie = informacyjna
    ? `${warstwy.length} informacyjne · ${aktywne} w wyniku`
    : `${aktywne} z ${warstwy.length} · suma wag ${suma}`
  const idListy = `panel-grupa-${kategoria}`

  return (
    <div className="panel-grupa">
      <button
        type="button"
        className="panel-grupa-glowa"
        aria-expanded={otwarta}
        aria-controls={idListy}
        onClick={() => setOtwarta(!otwarta)}
      >
        <span className="panel-grupa-tytul">{KATEGORIE[kategoria]}</span>
        <span className="panel-grupa-podsumowanie">
          <span>{podsumowanie}</span>
          <span aria-hidden="true">{otwarta ? '▴' : '▾'}</span>
        </span>
      </button>
      {otwarta && (
        <ul id={idListy} className="panel-warstwy">
          {warstwyBez.map((w) => (
            <Warstwa key={w.meta.id} w={w} wagi={wagi} kierunki={kierunki} />
          ))}
          {wybory && (
            <li className="panel-wybory">
              <WybierakKomitetu
                komitety={wybory.komitety.map((w) => ({ id: w.meta.id, nazwa: w.meta.nazwa }))}
                wybranyId={wybory.komitet.meta.id}
                onChange={ustawKomitet}
              />
              <p className="panel-uwaga">
                Udział głosów ważnych w gminie adresu w wyborach do Sejmu 15 października 2023 r.,
                nie poglądy mieszkańców budynku.
              </p>
              <ul>
                <Warstwa w={wybory.komitet} wagi={wagi} kierunki={kierunki} />
              </ul>
            </li>
          )}
        </ul>
      )}
    </div>
  )
}

function Warstwa({
  w,
  wagi,
  kierunki,
}: {
  w: WskaznikPrzygotowany
  wagi: Readonly<Record<string, number>>
  kierunki: Readonly<Record<string, KierunekOceny>>
}) {
  const { meta } = w
  const waga = wagaUzytkownika(wagi, meta.id)
  const informacyjna = meta.kategoria === 'kontekst'
  const neutralna = meta.kierunek === 'neutralny'
  const kierunek = kierunekEfektywny(meta, kierunki)

  return (
    <li className="panel-warstwa" title={meta.opis}>
      <div className="panel-warstwa-glowa">
        <span className="panel-warstwa-nazwa">{meta.nazwa}</span>
        <span className="panel-warstwa-zrodlo mono">{opisZrodla(w)}</span>
      </div>
      {meta.atrapa && <span className="atrapa panel-atrapa">dane przykładowe</span>}

      {informacyjna ? (
        <p className="panel-info">Tylko warstwa informacyjna, bez wpływu na wynik</p>
      ) : (
        <>
          <div className="panel-sterowanie">
            <span id={`waga-${meta.id}`} className="panel-pytanie">
              Jak ważne dla Ciebie?
            </span>
            <div role="group" aria-labelledby={`waga-${meta.id}`} className="panel-seg-grupa">
              {SEGMENTY_WAGI.map((n) => (
                <button
                  key={n}
                  type="button"
                  className="seg panel-seg"
                  aria-pressed={waga === n}
                  aria-label={`Waga ${n} z 4: ${meta.nazwa}`}
                  onClick={() => ustawWage(meta.id, n)}
                >
                  {n}
                </button>
              ))}
            </div>
            <span className="panel-skala" aria-hidden="true">
              0 – pomijam · 4 – bardzo ważne
            </span>
          </div>
          <div className="panel-sterowanie">
            <span id={`kier-${meta.id}`} className="panel-pytanie">
              Co jest lepsze?
            </span>
            <div role="group" aria-labelledby={`kier-${meta.id}`} className="panel-seg-grupa">
              {KIERUNKI.filter((k) => kierunkiWarstwy(meta).includes(k.id)).map((k) => (
                <button
                  key={k.id}
                  type="button"
                  className="seg panel-kier"
                  aria-pressed={kierunek === k.id}
                  aria-label={`${etykietaKierunku(meta, k.id)}: ${meta.nazwa}`}
                  // Kierunek z kontraktu nie trafia do stanu – nadpisanie zostaje tylko, gdy różni się
                  // od domyślnego, więc „Przywróć wagi profilu" i link w URL zostają czyste.
                  onClick={() =>
                    ustawKierunek(
                      meta.id,
                      k.id === meta.kierunek || (neutralna && kierunek === k.id) ? null : k.id,
                    )
                  }
                >
                  <span aria-hidden="true">{k.znak}</span> {etykietaKierunku(meta, k.id)}
                </button>
              ))}
            </div>
          </div>
          {neutralna && !kierunek && (
            <p className="panel-nota">
              Wybierz kierunek – bez niego warstwa nie liczy się do wyniku.
            </p>
          )}
          {!neutralna && kierunek !== meta.kierunek && (
            <p className="panel-kierunek">Zmieniony kierunek – domyślnie {opisDomyslny(meta)}.</p>
          )}
        </>
      )}
    </li>
  )
}
