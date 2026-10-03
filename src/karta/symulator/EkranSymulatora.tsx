// Symulator inwestycji, tryb „Miasto” (#96–#98): urzędnik stawia obiekt publiczny (przystanek,
// szkołę, przedszkole, POZ, AED, plac zabaw…) i widzi, ile adresów awansuje o literę i ile wychodzi z luki.
// Liczy worker (`useSymulacja`), obiekty żyją w URL (`a=`, `b=`) – link idzie do radnego
// albo do wniosku w budżecie obywatelskim.
import { type JSX, useState } from 'react'
import { LegendaLuk } from '@/mapa/luki/MapaLuk'
import { opisHeksuLuki, sumaLiczb, wartoscMapyLuki } from '@/mapa/luki/skalaLuk'
import { MapaKrakowa } from '@/mapa/MapaKrakowa'
import type { ObiektNaMapie } from '@/mapa/symulator/ZnacznikiObiektow'
import { type Dane, useDane } from '@/wynik/dane'
import { type LiczbyLuki, policzLuki, progLuki } from '@/wynik/luki'
import { PERSONY } from '@/wynik/persony'
import { rozdzielczoscWarstwy, zrodlaWarstwy } from '@/wynik/rankingLuk'
import type { WskaznikPrzygotowany } from '@/wynik/silnik'
import { useStan, ustawSymulacje } from '@/wynik/stan'
import {
  definicjaObiektu,
  GRUPY_OBIEKTOW,
  type Obiekt,
  pustyWynik,
  TYPY_OBIEKTOW,
  type TypObiektu,
  type WynikSymulacji,
} from '@/wynik/symulacja'
import { MAKS_OBIEKTOW, obiektyDoTekstu, obiektyZTekstu } from '@/wynik/symulacjaUrl'
import { useSymulacja } from '@/wynik/useSymulacja'
import { policzWyniki } from '@/wynik/useWyniki'
import { BilansSymulacji } from './BilansSymulacji'
import './symulator.css'

type Wariant = 'a' | 'b'
const WARIANTY: readonly Wariant[] = ['a', 'b']
const NAZWA_WARIANTU: Record<Wariant, string> = { a: 'Wariant A', b: 'Wariant B' }

// Luki bazowe per heks liczymy raz na warstwę (jak MapaLuk) – mapa przemalowuje tylko heksy
// zmienione symulacją.
let ostatnieLuki: { wskaznik: WskaznikPrzygotowany; heksy: Map<string, LiczbyLuki> } | null = null
function lukiBazowe(wskaznik: WskaznikPrzygotowany, dane: Dane): Map<string, LiczbyLuki> {
  if (ostatnieLuki?.wskaznik === wskaznik) return ostatnieLuki.heksy
  const heksy = policzLuki(wskaznik, dane.adresy, dane.grupyHeksow)?.heksy ?? new Map()
  ostatnieLuki = { wskaznik, heksy }
  return heksy
}

const wspolrzedne = (o: Obiekt) =>
  `${o.lat.toFixed(5).replace('.', ',')}° N, ${o.lon.toFixed(5).replace('.', ',')}° E`

export function EkranSymulatora(): JSX.Element {
  const stanDanych = useDane()
  const dane = stanDanych.stan === 'gotowe' ? stanDanych : null
  const wagi = useStan((s) => s.wagi)
  const kierunki = useStan((s) => s.kierunki)
  const persona = useStan((s) => s.persona)
  const symulacja = useStan((s) => s.symulacja)
  const [typ, setTyp] = useState<TypObiektu>('przystanek')
  const [edytowany, setEdytowany] = useState<Wariant>('a')
  const [srodek, setSrodek] = useState<[number, number] | null>(null)
  const [skopiowano, setSkopiowano] = useState(false)

  const obiekty: Record<Wariant, Obiekt[]> = {
    a: obiektyZTekstu(symulacja.a),
    b: obiektyZTekstu(symulacja.b),
  }
  const porownanie = obiekty.b.length > 0 || edytowany === 'b'
  const { baza, wyniki, ms, liczy } = useSymulacja(dane, wagi, kierunki, [obiekty.a, obiekty.b])
  const wynikA = wyniki?.[0] ?? pustyWynik()
  const wynikB = wyniki?.[1] ?? pustyWynik()
  const wynikEdytowany: WynikSymulacji = edytowany === 'a' ? wynikA : wynikB

  const zapisz = (wariant: Wariant, lista: Obiekt[]) => {
    const nowe = { ...obiekty, [wariant]: lista.slice(0, MAKS_OBIEKTOW) }
    ustawSymulacje({ a: obiektyDoTekstu(nowe.a), b: obiektyDoTekstu(nowe.b) })
  }
  const wylaczone = baza?.wylaczone ?? {}
  const postaw = (lon: number, lat: number) => {
    if (wylaczone[typ]) return
    const lista = obiekty[edytowany]
    if (lista.length >= MAKS_OBIEKTOW) return
    zapisz(edytowany, [...lista, { typ, lon, lat }])
  }
  const klucz = (w: Wariant, i: number) => `${w}-${i}`
  const zKlucza = (k: string): [Wariant, number] => [k[0] as Wariant, Number(k.slice(2))]

  // Mapa: luka warstwy wybranego typu (gdy ma próg) albo wynik łączny (punkt zdrowia – bez progu).
  const definicja = definicjaObiektu(typ)
  const wskaznik = dane?.wskazniki.find((w) => w.meta.id === definicja.warstwa) ?? null
  const prog = wskaznik && !wskaznik.niedostepny ? progLuki(wskaznik.meta) : null
  const lukiPrzed = dane && wskaznik && prog ? lukiBazowe(wskaznik, dane) : null
  const lukiPo = new Map(lukiPrzed ?? [])
  const heksy = new Map<string, number | null>()
  if (dane && lukiPrzed && wskaznik) {
    for (const [h, l] of lukiPrzed) heksy.set(h, wartoscMapyLuki(l.udzial))
    for (const [h, hp] of wynikEdytowany.heksy) {
      const l = hp.luki[wskaznik.meta.id]
      if (!l) continue
      lukiPo.set(h, l)
      heksy.set(h, wartoscMapyLuki(l.udzial))
    }
  } else if (dane) {
    for (const [h, w] of policzWyniki(dane, wagi, kierunki, 'wynik').heksy) heksy.set(h, w)
    for (const [h, hp] of wynikEdytowany.heksy) heksy.set(h, hp.wynik)
  }
  const wyroznione = new Set(
    [...wynikEdytowany.heksy].filter(([, h]) => h.zmiana).map(([h3]) => h3),
  )
  const podpisMapy = prog ? `Adresy ${prog.naglowek.replace(/^adresy /, '')}` : 'Wynik okolicy'

  const naMapie: ObiektNaMapie[] = WARIANTY.flatMap((w) =>
    obiekty[w].map((o, i) => ({
      klucz: klucz(w, i),
      lon: o.lon,
      lat: o.lat,
      znak: definicjaObiektu(o.typ).znak,
      opis: `Hipotetyczny obiekt: ${definicjaObiektu(o.typ).nazwa.toLowerCase()}, ${NAZWA_WARIANTU[w].toLowerCase()}`,
      wariant: w,
    })),
  )

  const nazwaPersony =
    persona === 'wlasna'
      ? 'własne ustawienia'
      : (PERSONY.find((p) => p.id === persona)?.nazwa ?? persona)

  const kopiujLink = async () => {
    try {
      await navigator.clipboard.writeText(location.href)
      setSkopiowano(true)
      window.setTimeout(() => setSkopiowano(false), 2000)
    } catch {
      setSkopiowano(false)
    }
  }

  return (
    <main className="symulator">
      <div className="symulator-panel">
        <div className="symulator-wstep">
          <h1>Symulator inwestycji dla miasta</h1>
          <p>
            Postaw na mapie obiekt publiczny – przystanek, szkołę, przedszkole, punkt zdrowia, AED
            czy plac zabaw – i zobacz, ile adresów awansuje o literę i ile wychodzi z luki w
            usługach. Lokalizację sklepu sprawdzisz w trybie „Biznes”.
          </p>
        </div>

        <fieldset className="symulator-grupa">
          <legend>Co stawiasz</legend>
          {GRUPY_OBIEKTOW.map((g) => (
            <div key={g.id} className="symulator-typy-grupa">
              <p className="symulator-typy-tytul" id={`typy-${g.id}`}>
                {g.nazwa}
              </p>
              <div className="symulator-typy" role="group" aria-labelledby={`typy-${g.id}`}>
                {TYPY_OBIEKTOW.filter((d) => d.grupa === g.id).map((d) => (
                  <button
                    key={d.typ}
                    type="button"
                    className="seg symulator-typ"
                    aria-pressed={typ === d.typ}
                    disabled={Boolean(wylaczone[d.typ])}
                    title={wylaczone[d.typ]}
                    onClick={() => setTyp(d.typ)}
                  >
                    <span className="symulator-typ__znak" aria-hidden="true">
                      {d.znak}
                    </span>
                    {d.nazwa}
                  </button>
                ))}
              </div>
            </div>
          ))}
          <p className="symulator-podpowiedz">
            Kliknij mapę, żeby postawić: {definicja.nazwa.toLowerCase()}. Znacznik przeciągnij albo
            przesuń strzałkami, Delete usuwa.
          </p>
          <button
            type="button"
            className="seg"
            disabled={!srodek || obiekty[edytowany].length >= MAKS_OBIEKTOW}
            onClick={() => srodek && postaw(srodek[0], srodek[1])}
          >
            Postaw w środku widoku
          </button>
        </fieldset>

        <fieldset className="symulator-grupa">
          <legend>Tu czy tam?</legend>
          <div className="symulator-warianty">
            {WARIANTY.map((w) => (
              <button
                key={w}
                type="button"
                className={`seg symulator-wariant symulator-wariant--${w}`}
                aria-pressed={edytowany === w}
                onClick={() => setEdytowany(w)}
              >
                {w === 'b' && obiekty.b.length === 0 ? 'Porównaj z wariantem B' : NAZWA_WARIANTU[w]}
              </button>
            ))}
          </div>
          {obiekty[edytowany].length > 0 && (
            <ul className="symulator-obiekty">
              {obiekty[edytowany].map((o, i) => (
                <li key={klucz(edytowany, i)}>
                  <span>
                    {definicjaObiektu(o.typ).nazwa}
                    <span className="symulator-wsp"> {wspolrzedne(o)}</span>
                  </span>
                  <button
                    type="button"
                    className="symulator-usun"
                    onClick={() =>
                      zapisz(
                        edytowany,
                        obiekty[edytowany].filter((_, j) => j !== i),
                      )
                    }
                  >
                    Usuń
                    <span className="sr-only"> {definicjaObiektu(o.typ).nazwa.toLowerCase()}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="symulator-akcje">
            {obiekty[edytowany].length > 0 && (
              <button type="button" className="seg" onClick={() => zapisz(edytowany, [])}>
                Wyczyść wariant {edytowany.toUpperCase()}
              </button>
            )}
            {(obiekty.a.length > 0 || obiekty.b.length > 0) && (
              <button type="button" className="seg" onClick={() => void kopiujLink()}>
                {skopiowano ? 'Link skopiowany' : 'Kopiuj link'}
              </button>
            )}
          </div>
        </fieldset>

        <section className="symulator-bilans" aria-labelledby="h-bilans">
          <h2 id="h-bilans" className="etykieta-sekcji">
            Bilans
          </h2>
          {!dane ? (
            <p className="komunikat" role="status">
              {stanDanych.stan === 'blad' ? 'Nie udało się wczytać danych.' : 'Wczytuję dane…'}
            </p>
          ) : (
            <div
              className={
                porownanie ? 'symulator-bilanse symulator-bilanse--dwa' : 'symulator-bilanse'
              }
              aria-live="polite"
              aria-busy={liczy}
            >
              <BilansSymulacji tytul="Wariant A" wynik={wynikA} aktywny={edytowany === 'a'} />
              {porownanie && (
                <BilansSymulacji tytul="Wariant B" wynik={wynikB} aktywny={edytowany === 'b'} />
              )}
            </div>
          )}
          {ms !== null && (wynikA.obiekty > 0 || wynikB.obiekty > 0) && (
            <p className="symulator-czas">
              Przeliczenie: {ms < 1 ? '<1' : Math.round(ms)} ms, w tle (Web Worker).
            </p>
          )}
        </section>

        <div className="symulator-zrodla">
          <p>
            Odległość w linii prostej, jak w warstwach źródłowych – nie trasa pieszo. Obiekt skraca
            odległość tylko adresom z danymi; adres bez danych zostaje szary.
          </p>
          <p>
            Litery według profilu: {nazwaPersony}. Skala warstw się nie zmienia – jeden obiekt nie
            przesuwa wszystkim percentyli.
          </p>
          <p>
            Liczymy adresy, nie mieszkańców: ludność mamy tylko w siatkach (GUS NSP 2021 – 1 km,
            zameldowania MSIP – 100 m), więc przypisanie mieszkańców do adresu byłoby zgadywaniem.
          </p>
          {wskaznik && (
            <p>
              Warstwa „{wskaznik.meta.nazwa}”: {zrodlaWarstwy(wskaznik.meta)}. Rozdzielczość:{' '}
              {rozdzielczoscWarstwy(wskaznik.meta)}.{prog && ` Próg luki: ${prog.zrodlo}`}
            </p>
          )}
          <p>Park i zieleń poza symulatorem: warstwa zieleni to siatka 100 m, nie odległość.</p>
        </div>
      </div>

      <section className="symulator-mapa" aria-label="Mapa symulatora">
        <MapaKrakowa
          heksy={heksy}
          podpisWarstwy={podpisMapy}
          onKlik={postaw}
          onWidok={(lon, lat) => setSrodek([lon, lat])}
          obiekty={{
            lista: naMapie,
            onPrzesun: (k, lon, lat) => {
              const [w, i] = zKlucza(k)
              zapisz(
                w,
                obiekty[w].map((o, j) => (j === i ? { ...o, lon, lat } : o)),
              )
            },
            onUsun: (k) => {
              const [w, i] = zKlucza(k)
              zapisz(
                w,
                obiekty[w].filter((_, j) => j !== i),
              )
            },
          }}
          wyroznione={wyroznione}
          {...(prog
            ? {
                legenda: <LegendaLuk tytul={podpisMapy} />,
                wartoscRodzica: (dzieci: readonly string[]) =>
                  wartoscMapyLuki(sumaLiczb(dzieci, lukiPo).udzial),
                opisHeksu: (dzieci: readonly string[], res: 8 | 9 | 10) =>
                  opisHeksuLuki(
                    res === 10 ? lukiPo.get(dzieci[0] ?? '') : sumaLiczb(dzieci, lukiPo),
                    res !== 10,
                  ),
              }
            : {})}
        />
      </section>
    </main>
  )
}
