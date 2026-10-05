// Zakładka „Zaangażowanie” (T058): którędy ludzie chodzą po serwisie i gdzie kończą wizytę. Trzy
// sekcje: najczęstsze ścieżki (widok `sciezki`), zasięg i czas w sekcjach ekranu (`sekcje`) oraz punkt
// urwania (`punkt_urwania`). Układ liczb (udziały, zasięgi, kolejność, zwijanie ogona) liczy
// `zaangazowanie-dane.ts` i jest tam objęty testem; tu zostaje rysowanie.
//
// Kontrakt zakładki: eksport NAZWANY `Zaangazowanie`, komponent bez propsów, `EkranPanel` ładuje go
// leniwie. Wstęp, pasek zakładek i „Odśwież” rysuje `EkranPanel`.
//
// Decyzje (dlaczego tak):
//  - Jeden filtr okresu (7 albo 30 dni) w jednym rzędzie nad wszystkimi sekcjami, więc liczby w
//    zakładce zawsze dotyczą tego samego okna. Domyślnie 7 dni: ścieżki i punkt urwania liczą się na
//    sesjach, czyli w najcięższych zapytaniach panelu.
//  - Ścieżki i punkt urwania proszą bazę o największy dozwolony limit (200), żeby lista była
//    KOMPLETNA: udział liczony od sumy listy jest prawdziwy tylko wtedy, gdy niczego nie obcięto.
//    Na ekranie zostaje 15 pozycji, a ogon zwija się do wiersza „pozostałe”, więc udziały nadal
//    dają 100%. Gdyby baza jednak obcięła listę limitem, udziałów nie liczymy i tabela to mówi.
//  - Sekcje: jedno zapytanie o wszystkie ekrany, a wybór ekranu to filtr w kliencie. Przełącznik
//    ma tylko ekrany, które mają dane w tym oknie, więc nie ma w nim pozycji prowadzących donikąd.
//  - Zasięg sekcji NIE jest udziałem: każda sekcja ma własny procent tej samej całości (odsłon
//    ekranu z pomiarem sekcji), więc kolumna nie sumuje się do 100%. Pasek obok liczby ma pełną
//    długość przy 100% tej całości, nie przy największej sekcji.
//  - Czasy w sekcjach to podłoga (liczy się tylko widoczna karta, odsłony zamknięte bez sygnału
//    wyjścia nie mają pomiaru), co mówi opis sekcji.
import { useState } from 'react'
import { formatCzasu, formatLiczby, formatProcent } from '@/panel/arytmetyka'
import { useWidok } from '@/panel/dane'
import { KOLOR_DANYCH } from '@/panel/kolory'
import { NAZWA_EKRANU, nazwa } from '@/panel/nazwy'
import { Segmenty } from '@/panel/skladniki/Segmenty'
import { Sekcja } from '@/panel/skladniki/Sekcja'
import { type KolumnaTabeli, Tabela } from '@/panel/skladniki/Tabela'
import type { WierszPunktuUrwania, WierszSciezki, WierszSekcji } from '@/panel/typy'
import {
  etykietaSciezki,
  etykietaSekcji,
  listaZUdzialami,
  MAKS_LIMIT_ZAPYTANIA,
  MAKS_POZYCJI_LISTY,
  OKRES_DOMYSLNY,
  OKRESY,
  type Okres,
  opcjeEkranow,
  opisPodstawyUdzialu,
  sekcjeEkranu,
  type WierszListy,
  type WierszZasiegu,
  wybierzEkran,
} from './zaangazowanie-dane'
import './zaangazowanie-cta-tresc.css'

function nazwaEkranu(ekran: string): string {
  return nazwa(NAZWA_EKRANU, ekran)
}

// ── Ścieżki ───────────────────────────────────────────────────────────────────────────────

function TabelaSciezek({ wiersze, okres }: { wiersze: WierszSciezki[]; okres: Okres }) {
  const lista = listaZUdzialami(
    wiersze,
    (w) => w.sesje,
    (w, i) => `${w.krok1}§${w.krok2}§${w.krok3}§${i}`,
    { maks: MAKS_POZYCJI_LISTY, limitZapytania: MAKS_LIMIT_ZAPYTANIA },
  )
  const kolumny: KolumnaTabeli<WierszListy<WierszSciezki>>[] = [
    { id: 'lp', naglowek: 'Poz.', komorka: (w, i) => (w.zbiorczy ? '' : `${i + 1}.`) },
    {
      id: 'sciezka',
      naglowek: 'Ścieżka (trzy pierwsze ekrany wizyty)',
      naglowekWiersza: true,
      komorka: (w) => {
        if (w.pozycja === null) {
          return <span className="ztc-zbiorczy">Pozostałe ścieżki ({formatLiczby(w.pozycji)})</span>
        }
        const podpis = etykietaSciezki(
          [w.pozycja.krok1, w.pozycja.krok2, w.pozycja.krok3],
          nazwaEkranu,
        )
        return <span className="ztc-etykieta">{podpis}</span>
      },
    },
    { id: 'sesje', naglowek: 'Sesje', liczbowa: true, komorka: (w) => formatLiczby(w.wartosc) },
    {
      id: 'udzial',
      naglowek: 'Udział',
      liczbowa: true,
      komorka: (w) => (w.udzial === null ? null : formatProcent(w.udzial)),
    },
  ]
  const nota = opisPodstawyUdzialu(lista, 'sesji')
  return (
    <div className="ztc-bez-lp">
      <Tabela
        podpis={`Najczęstsze ścieżki wizyt od najczęstszej, ostatnie ${okres} dni`}
        kolumny={kolumny}
        wiersze={lista.wiersze}
        kluczWiersza={(w) => w.klucz}
      />
      {nota ? <p className="panel-tabela-uwaga">{nota}</p> : null}
    </div>
  )
}

// ── Sekcje ekranu ─────────────────────────────────────────────────────────────────────────

/** Pasek zasięgu: tor = 100% odsłon ekranu, wypełnienie = zasięg sekcji, liczba obok. */
function Zasieg({ procent }: { procent: number }) {
  const szerokosc = Math.max(0, Math.min(100, procent))
  return (
    <span className="ztc-zasieg">
      <span className="ztc-zasieg-tor" aria-hidden="true">
        <span
          className="ztc-zasieg-wypelnienie"
          style={{ width: `${szerokosc}%`, background: KOLOR_DANYCH[1] }}
        />
      </span>
      <span>{formatProcent(procent)}</span>
    </span>
  )
}

function TabelaSekcji({
  wiersze,
  ekran,
  okres,
}: {
  wiersze: WierszSekcji[]
  ekran: string | null
  okres: Okres
}) {
  if (ekran === null) return null
  const { wiersze: sekcje, odslonyEkranu } = sekcjeEkranu(wiersze, ekran)
  const kolumny: KolumnaTabeli<WierszZasiegu>[] = [
    { id: 'lp', naglowek: 'Poz.', komorka: (w) => `${w.kolejnosc}.` },
    {
      id: 'sekcja',
      naglowek: 'Sekcja',
      klucz: 'zaangazowanie.sekcjaPozycja',
      naglowekWiersza: true,
      komorka: (w) => (
        <span className="ztc-etykieta" title={w.sekcja}>
          {etykietaSekcji(w.sekcja)}
        </span>
      ),
    },
    {
      id: 'zasieg',
      naglowek: 'Zasięg (% odsłon ekranu)',
      klucz: 'zaangazowanie.sekcjaZasieg',
      liczbowa: true,
      komorka: (w) => (w.zasieg === null ? null : <Zasieg procent={w.zasieg} />),
    },
    {
      id: 'odslony',
      naglowek: 'Odsłony z sekcją',
      liczbowa: true,
      komorka: (w) => (w.odslonySekcji === null ? null : formatLiczby(w.odslonySekcji)),
    },
    {
      id: 'czas',
      naglowek: 'Czas widoczny (mediana)',
      klucz: 'zaangazowanie.sekcjaCzas',
      liczbowa: true,
      komorka: (w) => (w.medianaMs === null ? null : formatCzasu(w.medianaMs)),
    },
  ]
  return (
    <div className="ztc-bez-lp">
      <Tabela
        podpis={`${nazwaEkranu(ekran)}: sekcje w kolejności na ekranie, ostatnie ${okres} dni`}
        kolumny={kolumny}
        wiersze={sekcje}
        kluczWiersza={(w) => w.klucz}
      />
      <p className="panel-tabela-uwaga">
        {odslonyEkranu === null
          ? 'Zasięg = odsłony z sekcją ÷ odsłony ekranu z pomiarem sekcji (liczba odsłon ekranu różni się między wierszami).'
          : `Zasięg = odsłony z sekcją ÷ odsłony ekranu z pomiarem sekcji (${formatLiczby(odslonyEkranu)}).`}{' '}
        Kolumna nie sumuje się do 100%: każda sekcja to osobny procent tej samej całości.
      </p>
    </div>
  )
}

// ── Punkt urwania ─────────────────────────────────────────────────────────────────────────

function TabelaUrwan({ wiersze, okres }: { wiersze: WierszPunktuUrwania[]; okres: Okres }) {
  const lista = listaZUdzialami(
    wiersze,
    (w) => w.sesje,
    (w, i) => `${w.ekran}§${w.sekcja}§${i}`,
    { maks: MAKS_POZYCJI_LISTY, limitZapytania: MAKS_LIMIT_ZAPYTANIA },
  )
  const kolumny: KolumnaTabeli<WierszListy<WierszPunktuUrwania>>[] = [
    { id: 'lp', naglowek: 'Poz.', komorka: (w, i) => (w.zbiorczy ? '' : `${i + 1}.`) },
    {
      id: 'ekran',
      naglowek: 'Ostatni ekran wizyty',
      komorka: (w) =>
        w.pozycja === null ? (
          ''
        ) : (
          <span className="ztc-bez-zawijania">{nazwaEkranu(w.pozycja.ekran)}</span>
        ),
    },
    {
      // Nagłówkiem wiersza jest sekcja: to ona ma długie nazwy i dostaje wolną szerokość tabeli.
      // Wiersz zbiorczy nosi swój podpis tutaj, żeby żaden wiersz nie został bez nagłówka.
      id: 'sekcja',
      naglowek: 'Ostatnia widziana sekcja',
      naglowekWiersza: true,
      komorka: (w) =>
        w.pozycja === null ? (
          <span className="ztc-zbiorczy ztc-etykieta">
            Pozostałe pozycje ({formatLiczby(w.pozycji)})
          </span>
        ) : (
          <span className="ztc-etykieta" title={w.pozycja.sekcja}>
            {etykietaSekcji(w.pozycja.sekcja)}
          </span>
        ),
    },
    { id: 'sesje', naglowek: 'Sesje', liczbowa: true, komorka: (w) => formatLiczby(w.wartosc) },
    {
      id: 'udzial',
      naglowek: 'Udział',
      liczbowa: true,
      komorka: (w) => (w.udzial === null ? null : formatProcent(w.udzial)),
    },
  ]
  const nota = opisPodstawyUdzialu(lista, 'sesji')
  return (
    <div className="ztc-bez-lp">
      <Tabela
        podpis={`Gdzie kończą się wizyty od najczęstszego miejsca, ostatnie ${okres} dni`}
        kolumny={kolumny}
        wiersze={lista.wiersze}
        kluczWiersza={(w) => w.klucz}
      />
      {nota ? <p className="panel-tabela-uwaga">{nota}</p> : null}
    </div>
  )
}

// ── Zakładka ──────────────────────────────────────────────────────────────────────────────

export function Zaangazowanie() {
  const [okres, setOkres] = useState<Okres>(OKRES_DOMYSLNY)
  const [wybranyEkran, setWybranyEkran] = useState<string | null>(null)
  const sciezki = useWidok('sciezki', { p_dni: okres, p_limit: MAKS_LIMIT_ZAPYTANIA })
  const sekcje = useWidok('sekcje', { p_dni: okres })
  const urwania = useWidok('punkt_urwania', { p_dni: okres, p_limit: MAKS_LIMIT_ZAPYTANIA })

  const ekrany = opcjeEkranow((sekcje.dane ?? []).map((w) => w.ekran))
  const ekran = wybierzEkran(wybranyEkran, ekrany)

  return (
    <div className="panel-stos ztc-tab">
      <div className="ztc-filtry">
        <span className="ztc-filtry-nazwa" aria-hidden="true">
          Okres
        </span>
        <Segmenty legenda="Okres" opcje={OKRESY} wartosc={okres} naZmiane={setOkres} />
        <span className="ztc-filtry-opis">
          Ostatnie {okres} dób warszawskich, razem z trwającą (niepełną) dzisiejszą.
        </span>
      </div>

      <Sekcja
        tytul="Najczęstsze ścieżki"
        klucz="zaangazowanie.sciezki"
        opis="Pierwsze trzy ekrany wizyty w kolejności; „(wyjście)” znaczy, że wizyta skończyła się wcześniej. Dłuższe wizyty są obcięte do trzech kroków, więc ich dalszy ciąg jest niewidoczny."
        stan={sciezki}
        pusto={(w) => w.length === 0}
        pusteInfo="W tym okresie nie było wizyt, z których dałoby się ułożyć ścieżki (potrzebne są odsłony ludzi z odciskiem dobowym)."
      >
        {(wiersze) => <TabelaSciezek wiersze={wiersze} okres={okres} />}
      </Sekcja>

      <Sekcja
        tytul="Zasięg i czas w sekcjach ekranu"
        klucz="zaangazowanie.sekcjaZasieg"
        opis="Jaką część wejść na ekran obejmuje każda sekcja i jak długo bywa widoczna. Czasy są podłogą: liczy się tylko widoczna karta, a odsłony zamknięte bez sygnału wyjścia nie mają pomiaru, więc prawdziwy czas bywa dłuższy."
        akcja={
          ekran !== null && ekrany.length > 1 ? (
            <Segmenty
              legenda="Ekran"
              opcje={ekrany.map((e) => ({ id: e, etykieta: nazwaEkranu(e) }))}
              wartosc={ekran}
              naZmiane={setWybranyEkran}
            />
          ) : undefined
        }
        stan={sekcje}
        pusto={(w) => w.length === 0}
        pusteInfo="Żadna odsłona nie przyniosła jeszcze pomiaru sekcji. Pomiar obejmuje tylko oznaczone ekrany (karta adresu, wyszukiwarka, porównanie, Biznes) i zapisuje się przy wyjściu z ekranu."
      >
        {(wiersze) => <TabelaSekcji wiersze={wiersze} ekran={ekran} okres={okres} />}
      </Sekcja>

      <Sekcja
        tytul="Punkt urwania"
        klucz="zaangazowanie.punktUrwania"
        opis="Na którym ekranie i w której sekcji kończą się wizyty. To miejsce zakończenia, nie przyczyna: wizyta zakończona na karcie adresu po przeczytaniu wyniku jest sukcesem, nie utratą."
        stan={urwania}
        pusto={(w) => w.length === 0}
        pusteInfo="W tym okresie nie było zakończonych wizyt do zestawienia."
      >
        {(wiersze) => <TabelaUrwan wiersze={wiersze} okres={okres} />}
      </Sekcja>
    </div>
  )
}
