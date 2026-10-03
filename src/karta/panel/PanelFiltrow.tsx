import { useEffect, useId, useState } from 'react'
import { KATEGORIE, type KategoriaId, type WskaznikMeta } from '@/kontrakty'
import { useDane } from '@/wynik/dane'
import { opisFiltru, type TwardyFiltr, type Warunek } from '@/wynik/filtry'
import { PERSONY, type PersonaId, TRYBY, type Tryb, WARSTWY_BIZNESU } from '@/wynik/persony'
import {
  type KierunekOceny,
  KOLEJNOSC_KATEGORII,
  KONTEKST_DO_WYNIKU,
  kierunekEfektywny,
  WAGA_MAX,
  type WskaznikPrzygotowany,
  wagaUzytkownika,
} from '@/wynik/silnik'
import {
  useStan,
  ustawFiltr,
  ustawKierunek,
  ustawTryb,
  ustawTrybMapy,
  ustawWage,
  usunFiltr,
  wybierzPersone,
  wyczyscFiltry,
} from '@/wynik/stan'
import { useWyniki } from '@/wynik/useWyniki'
import './panel.css'
import { etykietaKierunku, kierunkiWarstwy } from './preferencje'

const SEGMENTY_WAGI = Array.from({ length: WAGA_MAX + 1 }, (_, n) => n)

const KIERUNKI: readonly { id: KierunekOceny; znak: string }[] = [
  { id: 'wiecej-lepiej', znak: '↑' },
  { id: 'mniej-lepiej', znak: '↓' },
  { id: 'optimum', znak: '≈' },
]

const OPIS_TRYBU: Record<Tryb, string> = {
  kupuje:
    'Mocniej liczy się przyszłość okolicy i ryzyko (waga +1). Cena m² jest informacyjna, dopóki samodzielnie nie włączysz jej w sekcji Kontekst po podłączeniu danych RCN.',
  wynajmuje:
    'Mocniej liczy się dojazd (waga +1), słabiej przyszłość okolicy (waga −1). Szacunek czynszu: wkrótce – nie mamy jeszcze danych o najmie.',
  biznes:
    'Sklep spożywczy: dalej od istniejącego sklepu i więcej stałych mieszkańców w polu 1 km² z NSP 2021 to wyższy wynik. Liczba mieszkańców nie mierzy ruchu pieszych ani sprzedaży.',
}

// Panel pamięta ostatni wybrany profil, żeby „Przywróć wagi profilu" działało po ręcznej
// zmianie (stan wtedy trzyma tylko 'wlasna'). Zmienna modułu przeżywa zmianę ekranu.
let ostatniaPersona: PersonaId = 'rodzina'

function opisDomyslny(meta: WskaznikMeta): string {
  return etykietaKierunku(
    meta,
    meta.kierunek === 'neutralny' ? 'optimum' : meta.kierunek,
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
  const persona = useStan((s) => s.persona)
  const wagi = useStan((s) => s.wagi)
  const kierunki = useStan((s) => s.kierunki)
  const filtry = useStan((s) => s.filtry)
  const trybMapy = useStan((s) => s.trybMapy)
  const ostatniaWarstwa = useStan((s) => s.ostatniaWarstwa)
  const wyniki = useWyniki()

  useEffect(() => {
    if (persona !== 'wlasna') ostatniaPersona = persona
  }, [persona])

  const wskazniki = dane.stan === 'gotowe' ? dane.wskazniki : []
  const warstwyPanelu =
    tryb === 'biznes'
      ? wskazniki.filter((w) => WARSTWY_BIZNESU.some((id) => id === w.meta.id))
      : wskazniki
  const liczone = warstwyPanelu.filter(
    (w) => w.meta.kategoria !== 'kontekst' || KONTEKST_DO_WYNIKU[w.meta.id],
  )
  const aktywne = liczone.filter(
    (w) => wagaUzytkownika(wagi, w.meta.id) > 0 && kierunekEfektywny(w.meta, kierunki) !== null,
  ).length
  const opisPersony = PERSONY.find((p) => p.id === persona)?.opis

  return (
    <>
      {filtry.length > 0 && (
        <section aria-labelledby="h-filtry" className="panel-sekcja">
          <h2 id="h-filtry" className="etykieta-sekcji">
            Twarde filtry
          </h2>
          <ul className="panel-filtry">
            {filtry.map((f) => {
              const meta = wskazniki.find((w) => w.meta.id === f.id)?.meta
              return (
                <li key={f.id} className="panel-filtr">
                  <span>
                    {opisFiltru(f, meta)}
                    {!meta && dane.stan === 'gotowe' && (
                      <span className="panel-filtr-brak"> (brak warstwy – filtr czeka)</span>
                    )}
                  </span>
                  <button
                    type="button"
                    className="seg panel-filtr-usun"
                    aria-label={`Usuń filtr: ${opisFiltru(f, meta)}`}
                    onClick={() => usunFiltr(f.id)}
                  >
                    Usuń
                  </button>
                </li>
              )
            })}
          </ul>
          {wyniki && (
            <p className="panel-uwaga" role="status">
              Wykluczono {wyniki.wykluczenia.liczbaWykluczonych.toLocaleString('pl-PL')} z{' '}
              {wyniki.wykluczenia.liczbaAdresow.toLocaleString('pl-PL')} adresów. Wykluczone adresy
              znikają z rankingu, a heksy bez żadnego adresu są ciemne na mapie.
              {wyniki.wykluczenia.liczbaNiewiadomych > 0 &&
                ` Dla ${wyniki.wykluczenia.liczbaNiewiadomych.toLocaleString('pl-PL')} adresów nie wiemy, czy spełniają filtr (brak danych) – zostają na mapie.`}
            </p>
          )}
          <div className="panel-akcje">
            <button type="button" className="seg panel-akcja" onClick={wyczyscFiltry}>
              Usuń wszystkie filtry
            </button>
          </div>
        </section>
      )}

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

      {tryb === 'biznes' &&
        dane.stan === 'gotowe' &&
        WARSTWY_BIZNESU.some((id) => !wskazniki.some((w) => w.meta.id === id)) && (
          <p className="panel-uwaga" role="status">
            Dostępne warstwy biznesowe: {warstwyPanelu.length} z {WARSTWY_BIZNESU.length}. Brakująca
            warstwa nie wpływa na wynik.
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
          const warstwy = warstwyPanelu.filter((w) => w.meta.kategoria === kat)
          if (warstwy.length === 0) return null
          return (
            <GrupaWarstw
              key={`${tryb}-${kat}`}
              kategoria={kat}
              warstwy={warstwy}
              wagi={wagi}
              kierunki={kierunki}
              filtry={filtry}
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
  filtry: readonly TwardyFiltr[]
  poczatkowoOtwarta: boolean
}

function GrupaWarstw({
  kategoria,
  warstwy,
  wagi,
  kierunki,
  filtry,
  poczatkowoOtwarta,
}: GrupaProps) {
  const [otwarta, setOtwarta] = useState(poczatkowoOtwarta)
  const informacyjna = kategoria === 'kontekst'
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
          {warstwy.map((w) => (
            <Warstwa
              key={w.meta.id}
              w={w}
              wagi={wagi}
              kierunki={kierunki}
              filtr={filtry.find((f) => f.id === w.meta.id)}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

function Warstwa({
  w,
  wagi,
  kierunki,
  filtr,
}: {
  w: WskaznikPrzygotowany
  wagi: Readonly<Record<string, number>>
  kierunki: Readonly<Record<string, KierunekOceny>>
  filtr: TwardyFiltr | undefined
}) {
  const { meta } = w
  const waga = wagaUzytkownika(wagi, meta.id)
  const informacyjna = meta.kategoria === 'kontekst'
  const neutralna = meta.kierunek === 'neutralny'
  const kierunek = kierunekEfektywny(meta, kierunki)
  const dobrowolna = Boolean(KONTEKST_DO_WYNIKU[meta.id])
  const niedostepnaCena = meta.id === 'cena_m2_mediana' && Boolean(meta.atrapa)
  const wlaczona = dobrowolna && !niedostepnaCena && waga > 0 && kierunek !== null

  return (
    <li className="panel-warstwa" title={meta.opis}>
      <div className="panel-warstwa-glowa">
        <span className="panel-warstwa-nazwa">{meta.nazwa}</span>
        <span className="panel-warstwa-zrodlo mono">{opisZrodla(w)}</span>
      </div>
      {meta.atrapa && <span className="atrapa panel-atrapa">dane przykładowe</span>}

      {informacyjna ? (
        dobrowolna ? (
          <div className="panel-kontekst-sterowanie">
            {meta.id === 'drzewa_100m' && (
              <p className="panel-uwaga">
                Ewidencja ZZM jest niepełna: obejmuje tylko część drzew w Krakowie. Włącz ją
                świadomie, jeśli mimo tego chcesz uwzględnić tę liczbę w wyniku.
              </p>
            )}
            {niedostepnaCena && (
              <p className="panel-nota">
                Cena m² ma teraz dane przykładowe. Ocena zostanie udostępniona po podłączeniu danych
                RCN; atrapa nie wpływa na wynik.
              </p>
            )}
            <button
              type="button"
              className="seg panel-prog-przycisk"
              aria-pressed={wlaczona}
              disabled={niedostepnaCena}
              onClick={() => {
                if (wlaczona) ustawWage(meta.id, 0)
                else {
                  if (meta.kierunek === 'neutralny' && !kierunki[meta.id])
                    ustawKierunek(meta.id, 'mniej-lepiej')
                  ustawWage(meta.id, 2)
                }
              }}
            >
              {wlaczona ? 'Uwzględniane w wyniku – wyłącz' : 'Uwzględnij w wyniku'}
            </button>
            {!wlaczona && !niedostepnaCena && (
              <p className="panel-info">Tylko informacyjnie – bez wpływu na wynik.</p>
            )}
            <>
              <div
                role="group"
                aria-label={`Preferencja: ${meta.nazwa}`}
                className="panel-seg-grupa panel-prog-warunki"
              >
                {kierunkiWarstwy(meta).map((k) => (
                  <button
                    key={k}
                    type="button"
                    className="seg panel-kier"
                    aria-pressed={wlaczona && kierunek === k}
                    disabled={!wlaczona || niedostepnaCena}
                    onClick={() => ustawKierunek(meta.id, k)}
                  >
                    {etykietaKierunku(meta, k)}
                  </button>
                ))}
              </div>
              {wlaczona && (
                <div role="group" aria-label={`Waga: ${meta.nazwa}`} className="panel-seg-grupa">
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
              )}
            </>
          </div>
        ) : (
          <p className="panel-info">Tylko warstwa informacyjna, bez wpływu na wynik</p>
        )
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
      {!dobrowolna && <TwardyProg meta={meta} filtr={filtr} />}
    </li>
  )
}

// Warstwy, w których 0 znaczy „poza strefą”: tylko tu ma sens warunek „równe zero”.
const WARSTWY_STREFOWE: Readonly<Record<string, string>> = {
  powodz_1proc: 'Wyklucz strefę Q100 (zalew raz na 100 lat)',
}

function domyslnyProg(meta: WskaznikMeta): number {
  if (meta.norma) return meta.norma.wartosc
  if (meta.zakres) return Math.round((meta.zakres[0] + meta.zakres[1]) / 2)
  return 0
}

/**
 * „Twardy próg” przy warstwie: adres, który go nie spełnia, jest wykluczony (a nie tylko
 * gorzej oceniony). Dotyczy też warstw informacyjnych, np. maksymalnej ceny m².
 */
function TwardyProg({ meta, filtr }: { meta: WskaznikMeta; filtr: TwardyFiltr | undefined }) {
  const id = useId()
  const strefa = WARSTWY_STREFOWE[meta.id]
  const [otwarty, setOtwarty] = useState(false)
  const [warunek, setWarunek] = useState<Warunek>(filtr?.warunek ?? (strefa ? 'rowne-zero' : 'max'))
  const [prog, setProg] = useState(String(filtr?.prog ?? domyslnyProg(meta)))
  const [blad, setBlad] = useState(false)
  const opcje: { id: Warunek; nazwa: string }[] = [
    ...(strefa ? [{ id: 'rowne-zero' as const, nazwa: strefa }] : []),
    { id: 'max', nazwa: 'Maksymalnie' },
    { id: 'min', nazwa: 'Minimalnie' },
  ]
  const idPola = `${id}-prog`
  const jednostka = meta.jednostka ? ` ${meta.jednostka}` : ''

  function zastosuj() {
    if (warunek === 'rowne-zero') {
      ustawFiltr({ id: meta.id, warunek, prog: 0 })
      return setBlad(false)
    }
    const liczba = prog.trim() === '' ? Number.NaN : Number(prog.replace(',', '.'))
    if (!Number.isFinite(liczba)) return setBlad(true)
    setBlad(false)
    ustawFiltr({ id: meta.id, warunek, prog: liczba })
  }

  return (
    <div className="panel-prog">
      <button
        type="button"
        className="seg panel-prog-przycisk"
        aria-expanded={otwarty}
        aria-controls={`${id}-wiersz`}
        aria-pressed={filtr !== undefined}
        onClick={() => setOtwarty(!otwarty)}
      >
        {filtr ? 'Twardy próg: włączony' : 'Twardy próg'}
      </button>
      {otwarty && (
        <div id={`${id}-wiersz`} className="panel-prog-wiersz">
          <div
            role="group"
            aria-label={`Warunek twardego progu: ${meta.nazwa}`}
            className="panel-seg-grupa panel-prog-warunki"
          >
            {opcje.map((o) => (
              <button
                key={o.id}
                type="button"
                className="seg panel-kier"
                aria-pressed={warunek === o.id}
                onClick={() => setWarunek(o.id)}
              >
                {o.nazwa}
              </button>
            ))}
          </div>
          {warunek !== 'rowne-zero' && (
            <div className="panel-prog-pole">
              <label htmlFor={idPola}>Próg{jednostka ? ` (${meta.jednostka})` : ''}</label>
              <input
                id={idPola}
                type="text"
                inputMode="decimal"
                value={prog}
                aria-invalid={blad}
                onChange={(e) => setProg(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') zastosuj()
                }}
              />
            </div>
          )}
          {blad && <p className="panel-nota">Wpisz liczbę, np. 55.</p>}
          <p className="panel-uwaga">
            {meta.zakres && `Zakres warstwy: ${meta.zakres[0]}–${meta.zakres[1]}${jednostka}. `}
            {meta.norma && `Norma: ${meta.norma.wartosc}${jednostka} (${meta.norma.opis}). `}
            Adres poza progiem znika z rankingu. Adres bez danych zostaje i dostaje znacznik „nie
            wiemy".
          </p>
          <div className="panel-akcje">
            <button type="button" className="seg wlaczony panel-akcja" onClick={zastosuj}>
              Zastosuj
            </button>
            {filtr && (
              <button type="button" className="seg panel-akcja" onClick={() => usunFiltr(meta.id)}>
                Usuń próg
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
