// Zakładka „CTA” (T059): które przyciski zamieniają wyświetlenie w kliknięcie, które są martwe i co
// frustruje. Trzy sekcje: klikalność sekcji (widok `cta_sekcje`), martwe przyciski (`cta_martwe`) i
// sygnały UX na 1000 odsłon ekranu (`ux_sygnaly`). Układ liczb liczy `cta-dane.ts` i jest tam objęty
// testem; tu zostaje rysowanie.
//
// Kontrakt zakładki: eksport NAZWANY `Cta`, komponent bez propsów, `EkranPanel` ładuje go leniwie.
//
// Decyzje (dlaczego tak):
//  - Klikalność to kliknięcia ÷ WYŚWIETLENIA przycisku, nie odsłony strony, i jest podpisana
//    kierunkiem „więcej = lepiej”. To stawka, nie udział: kolumna nie sumuje się do 100%, a wartość
//    powyżej 100% jest możliwa (kliknąć można przycisk widoczny krócej niż pół sekundy).
//  - Sekcje z mniej niż 50 wyświetleniami są oznaczone „mała próba” i idą na koniec listy: 100%
//    z dwóch wyświetleń nie jest najlepszą sekcją serwisu. Ten sam próg (50) odcina martwe przyciski.
//  - Wiersz „Razem na ekranie” to Σ kliknięć ÷ Σ wyświetleń, nie średnia z procentów sekcji (średnia
//    dałaby sekcji z trzema wyświetleniami wagę sekcji z tysiącem). Przy jednej sekcji go nie ma:
//    powtarzałby jej liczby.
//  - Wskaźniki UX są na 1000 odsłon danego ekranu (dzielenie tylko przy dodatnim mianowniku). Łącznego
//    wskaźnika dla serwisu nie ma: baza podaje odsłony tylko dla ekranów z sygnałem.
//  - Jedno zapytanie o sekcje wszystkich ekranów, wybór ekranu to filtr w kliencie (przełącznik ma
//    tylko ekrany z danymi). Jeden filtr okresu (7/30 dni) nad wszystkimi sekcjami zakładki.
//  - Kolumna z główną miarą stoi zaraz za nazwą (klikalność przed licznikami), żeby na wąskim ekranie,
//    gdzie tabela przewija się w bok, najważniejsza liczba nie wypadała poza widok.
import { type ReactNode, useState } from 'react'
import { BRAK_DANYCH, formatLiczby, formatProcent } from '@/panel/arytmetyka'
import { useWidok } from '@/panel/dane'
import { NAZWA_EKRANU, NAZWA_SYGNALU_UX, nazwa } from '@/panel/nazwy'
import { Segmenty } from '@/panel/skladniki/Segmenty'
import { Sekcja } from '@/panel/skladniki/Sekcja'
import { type KolumnaTabeli, Tabela } from '@/panel/skladniki/Tabela'
import type { WierszCtaMartwego, WierszCtaSekcji, WierszSygnaluUx } from '@/panel/typy'
import {
  klikalnoscSekcji,
  liczbaZdarzen,
  MIN_WYSWIETLEN,
  martwePrzyciski,
  RODZAJ_FURII,
  RODZAJ_MARTWEGO_KLIKU,
  sygnalyUx,
  type WartoscSygnalu,
  type WierszMartwy,
  type WierszSygnalow,
} from './cta-dane'
import {
  etykietaSekcji,
  OKRES_DOMYSLNY,
  OKRESY,
  type Okres,
  opcjeEkranow,
  wybierzEkran,
} from './zaangazowanie-dane'
import './zaangazowanie-cta-tresc.css'

function nazwaEkranu(ekran: string): string {
  return nazwa(NAZWA_EKRANU, ekran)
}

// ── Klikalność sekcji ─────────────────────────────────────────────────────────────────────

const KLUCZ_RAZEM = '__razem'

/** Wiersz tabeli klikalności: sekcja albo (przy `sekcja === null`) wiersz „Razem na ekranie”. */
interface WierszTabeliKlikalnosci {
  klucz: string
  sekcja: string | null
  wyswietlenia: number
  klikniecia: number
  klikalnosc: number | null
  malaProba: boolean
}

/** Wiersz „Razem” jest pogrubiony (pismo, nie kolor), zwykłe wiersze zostają bez zmian. */
function pogrub(wiersz: WierszTabeliKlikalnosci, tresc: ReactNode): ReactNode {
  return wiersz.sekcja === null ? <span className="ztc-razem">{tresc}</span> : tresc
}

function KlikalnoscEkranu({
  wiersze,
  ekran,
  okres,
}: {
  wiersze: WierszCtaSekcji[]
  ekran: string | null
  okres: Okres
}) {
  if (ekran === null) return null
  const { wiersze: sekcje, razem } = klikalnoscSekcji(wiersze, ekran)
  const wierszeTabeli: WierszTabeliKlikalnosci[] =
    sekcje.length > 1 ? [...sekcje, { klucz: KLUCZ_RAZEM, sekcja: null, ...razem }] : sekcje
  const kolumny: KolumnaTabeli<WierszTabeliKlikalnosci>[] = [
    {
      id: 'sekcja',
      naglowek: 'Sekcja',
      naglowekWiersza: true,
      komorka: (w) =>
        w.sekcja === null ? (
          <span className="ztc-razem">Razem na ekranie</span>
        ) : (
          <span className="ztc-etykieta" title={w.sekcja}>
            {etykietaSekcji(w.sekcja)}
          </span>
        ),
    },
    {
      id: 'klikalnosc',
      naglowek: 'Klikalność (więcej = lepiej)',
      klucz: 'cta.klikalnosc',
      liczbowa: true,
      komorka: (w) =>
        w.klikalnosc === null
          ? null
          : pogrub(
              w,
              <>
                {formatProcent(w.klikalnosc)}
                {w.malaProba ? (
                  <span className="ztc-mala-proba">
                    <span className="sr-only">, </span>mała próba
                  </span>
                ) : null}
              </>,
            ),
    },
    {
      id: 'klikniecia',
      naglowek: 'Kliknięcia',
      klucz: 'cta.klikniecia',
      liczbowa: true,
      komorka: (w) => pogrub(w, formatLiczby(w.klikniecia)),
    },
    {
      id: 'wyswietlenia',
      naglowek: 'Wyświetlenia',
      klucz: 'cta.wyswietlenia',
      liczbowa: true,
      komorka: (w) => pogrub(w, formatLiczby(w.wyswietlenia)),
    },
  ]
  return (
    <div>
      <Tabela
        podpis={`${nazwaEkranu(ekran)}: klikalność sekcji, ostatnie ${okres} dni`}
        kolumny={kolumny}
        wiersze={wierszeTabeli}
        kluczWiersza={(w) => w.klucz}
      />
      <p className="panel-tabela-uwaga">
        Klikalność = kliknięcia ÷ wyświetlenia przycisku danej sekcji, więcej = lepiej. To stawka
        sekcji, nie jej udział w całości, więc kolumna nie sumuje się do 100%, a wartość powyżej
        100% jest możliwa. Wiersz „Razem” to suma kliknięć podzielona przez sumę wyświetleń, nie
        średnia z procentów. Kolejność: sekcje z co najmniej {MIN_WYSWIETLEN} wyświetleniami od
        najwyższej klikalności, potem „mała próba” (poniżej {MIN_WYSWIETLEN} wyświetleń) wg
        wyświetleń.
      </p>
    </div>
  )
}

// ── Martwe przyciski ──────────────────────────────────────────────────────────────────────

/**
 * Miejsce przycisku: „ekran · sekcja”. Nazwy sekcji karty adresu zaczynają się już od nazwy ekranu
 * („Karta adresu: …”), więc wtedy ekranu nie powtarzamy.
 */
function miejsceDzialania(sekcja: string, ekran: string): string {
  const opisSekcji = etykietaSekcji(sekcja)
  const opisEkranu = nazwaEkranu(ekran)
  return opisSekcji.startsWith(opisEkranu) ? opisSekcji : `${opisEkranu} · ${opisSekcji}`
}

function TabelaMartwych({ wiersze, okres }: { wiersze: WierszCtaMartwego[]; okres: Okres }) {
  const martwe = martwePrzyciski(wiersze)
  // Dwie kolumny zamiast czterech: długi podpis przycisku i jego miejsca w jednej komórce (miejsce
  // w drugiej linii), bo tylko jedna kolumna tekstowa dostaje wolną szerokość tabeli, a druga
  // zostałaby ściśnięta do jednego słowa w wierszu.
  const kolumny: KolumnaTabeli<WierszMartwy>[] = [
    {
      id: 'przycisk',
      naglowek: 'Przycisk i jego miejsce',
      naglowekWiersza: true,
      komorka: (w) => (
        <>
          <span className="ztc-etykieta" title={w.cel}>
            {w.cel}
          </span>
          <span className="ztc-podpis-komorki">{miejsceDzialania(w.sekcja, w.ekran)}</span>
        </>
      ),
    },
    {
      id: 'wyswietlenia',
      naglowek: 'Wyświetlenia',
      klucz: 'cta.wyswietlenia',
      liczbowa: true,
      komorka: (w) => formatLiczby(w.wyswietlenia),
    },
  ]
  return (
    <Tabela
      podpis={`Martwe przyciski od najczęściej wyświetlanego, ostatnie ${okres} dni`}
      kolumny={kolumny}
      wiersze={martwe}
      kluczWiersza={(w) => w.klucz}
    />
  )
}

// ── Sygnały UX ────────────────────────────────────────────────────────────────────────────

/**
 * Wskaźnik na 1000 odsłon z liczbą zdarzeń pod spodem. Bez mianownika: „brak danych” i sama liczba
 * zdarzeń. Ukryty przecinek rozdziela obie linie dla czytnika ekranu (bloki w komórce tabeli bywają
 * sklejane w jedno zdanie, a „2,5” i „5 zdarzeń” bez przerwy czytają się jak jedna liczba).
 */
function KomorkaSygnalu({ sygnal }: { sygnal: WartoscSygnalu }) {
  return (
    <>
      {sygnal.na1000 === null ? (
        <span data-brak-komorki="">{BRAK_DANYCH}</span>
      ) : (
        formatLiczby(sygnal.na1000, 1)
      )}
      <span className="sr-only">, </span>
      <span className="ztc-podpis-komorki">{liczbaZdarzen(sygnal.ile)}</span>
    </>
  )
}

function TabelaSygnalow({ wiersze, okres }: { wiersze: WierszSygnaluUx[]; okres: Okres }) {
  const sygnaly = sygnalyUx(wiersze)
  const kolumny: KolumnaTabeli<WierszSygnalow>[] = [
    {
      id: 'ekran',
      naglowek: 'Ekran',
      naglowekWiersza: true,
      komorka: (w) => nazwaEkranu(w.ekran),
    },
    {
      id: 'odslony',
      naglowek: 'Odsłony ekranu',
      liczbowa: true,
      komorka: (w) => (w.odslony === null ? null : formatLiczby(w.odslony)),
    },
    {
      id: 'furia',
      naglowek: `${nazwa(NAZWA_SYGNALU_UX, RODZAJ_FURII)} (na 1000 odsłon)`,
      klucz: 'cta.furia',
      liczbowa: true,
      komorka: (w) => <KomorkaSygnalu sygnal={w.furia} />,
    },
    {
      id: 'martwy',
      naglowek: `${nazwa(NAZWA_SYGNALU_UX, RODZAJ_MARTWEGO_KLIKU)} (na 1000 odsłon)`,
      klucz: 'cta.martwyKlik',
      liczbowa: true,
      komorka: (w) => <KomorkaSygnalu sygnal={w.martwy} />,
    },
    {
      id: 'razem',
      naglowek: 'Razem (na 1000 odsłon)',
      liczbowa: true,
      komorka: (w) => <KomorkaSygnalu sygnal={w.razem} />,
    },
  ]
  return (
    <div>
      <Tabela
        podpis={`Sygnały frustracji na 1000 odsłon ekranu, ostatnie ${okres} dni`}
        kolumny={kolumny}
        wiersze={sygnaly}
        kluczWiersza={(w) => w.ekran}
      />
      <p className="panel-tabela-uwaga">
        Wskaźnik = zdarzenia ÷ odsłony ekranu × 1000 (odsłony ludzi, bez botów), mniej = lepiej.
        Ekrany bez żadnego sygnału w okresie nie są na liście, bo baza podaje odsłony tylko dla
        ekranów z sygnałem; dlatego nie liczę wskaźnika dla całego serwisu. Kolejność: od
        największego łącznego wskaźnika.
      </p>
    </div>
  )
}

// ── Zakładka ──────────────────────────────────────────────────────────────────────────────

export function Cta() {
  const [okres, setOkres] = useState<Okres>(OKRES_DOMYSLNY)
  const [wybranyEkran, setWybranyEkran] = useState<string | null>(null)
  const sekcje = useWidok('cta_sekcje', { p_dni: okres })
  const martwe = useWidok('cta_martwe', { p_dni: okres, p_min: MIN_WYSWIETLEN })
  const sygnaly = useWidok('ux_sygnaly', { p_dni: okres })

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
        tytul="Klikalność sekcji"
        klucz="cta.klikalnosc"
        opis="Ile razy przycisk został kliknięty w stosunku do tego, ile razy był wyświetlony (widoczny w co najmniej połowie przez pół sekundy). Więcej = lepiej, ale niska klikalność elementu informacyjnego nie jest zarzutem."
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
        pusteInfo="Żaden przycisk nie przyniósł jeszcze pomiaru wyświetleń. Pomiar CTA obejmuje oznaczone ekrany i zapisuje się przy wyjściu z ekranu."
      >
        {(wiersze) => <KlikalnoscEkranu wiersze={wiersze} ekran={ekran} okres={okres} />}
      </Sekcja>

      <Sekcja
        tytul="Martwe przyciski"
        klucz="cta.martwe"
        opis={`Przyciski wyświetlone co najmniej ${MIN_WYSWIETLEN} razy i ani razu niekliknięte w tym okresie. Zero kliknięć bywa normalne dla elementu, który jest informacją, a nie zachętą.`}
        stan={martwe}
        pusto={(w) => w.length === 0}
        pusteInfo={`Żaden przycisk nie spełnia progu (co najmniej ${MIN_WYSWIETLEN} wyświetleń i ani jednego kliknięcia). Przy małym ruchu może to też znaczyć „za mało danych”.`}
      >
        {(wiersze) => <TabelaMartwych wiersze={wiersze} okres={okres} />}
      </Sekcja>

      <Sekcja
        tytul="Sygnały frustracji"
        opis="Szybkie wielokrotne kliknięcia i kliknięcia w elementy, które nie są przyciskiem ani linkiem, przeliczone na 1000 odsłon ekranu (nie liczby bezwzględne, bo inaczej na czele stałby najpopularniejszy ekran). Mniej = lepiej."
        stan={sygnaly}
        pusto={(w) => w.length === 0}
        pusteInfo="Brak sygnałów w tym okresie. To dobra wiadomość, ale przy małym ruchu może też znaczyć „za mało danych”."
      >
        {(wiersze) => <TabelaSygnalow wiersze={wiersze} okres={okres} />}
      </Sekcja>
    </div>
  )
}
