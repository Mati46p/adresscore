// Zakładka „Akwizycja” (T056, FR-031): skąd przychodzą wizyty. Kanały (pasek udziałów i głębokość
// wizyt), źródła, kampanie UTM, kraje i urządzenia w jednym okresie 7/30 dni.
//
// Co stoi tu, a co gdzie indziej:
//  - wstęp zakładki, pasek zakładek i „Odśwież” rysuje `EkranPanel`; tu ich nie powtarzamy;
//  - układ danych w wiersze i segmenty (udziały, kolejność, wartości zastępcze) leży w
//    `akwizycja-dane.ts` i ma testy. Komponent nie liczy procentów we własnych pętlach;
//  - każdy udział ma podstawę równą SUMIE całości, której dotyczy: pasek kanałów od wszystkich wizyt
//    okresu, źródła i kraje (listy przycięte) od TEJŻE całości, kampanie od sumy wizyt z UTM. Podstawa
//    jest podpisana pod każdą tabelą;
//  - wizyta = sesja, a jej kanał i źródło bierze się z pierwszej odsłony (definicja w podpowiedzi);
//  - tekst z bazy (host referera, źródła, kampanie) pochodzi od dowolnego klienta: wstawiamy go
//    wyłącznie jako treść React. Odsyłacze NIE są linkami (`linkDoSerwisu` przyjmuje tylko ścieżki
//    w obrębie serwisu, a host z bazy mógłby wskazywać cokolwiek);
//  - kolor kanału ma kropka przy nazwie (wypełnienie, 3:1), nigdy napis (pismo wymaga 4,5:1).
//
// React Compiler: bez useMemo/useCallback, bez domyślnych wartości w destrukturyzacji propsów.
import { useState } from 'react'
import { formatLiczby, formatProcent, JEDNOSTKI } from '@/panel/arytmetyka'
import { polaczStany, useWidok } from '@/panel/dane'
import { KOLOR_DANYCH, type KolorDanych } from '@/panel/kolory'
import { PasekUdzialow } from '@/panel/skladniki/PasekUdzialow'
import { Podpowiedz } from '@/panel/skladniki/Podpowiedz'
import { Segmenty } from '@/panel/skladniki/Segmenty'
import { Sekcja } from '@/panel/skladniki/Sekcja'
import { type KolumnaTabeli, Tabela } from '@/panel/skladniki/Tabela'
import { TabelaTop } from '@/panel/skladniki/TabelaTop'
import {
  czolowkaKrajow,
  OKNA_DNI,
  OKNO_DOMYSLNE,
  type OknoDni,
  opisOkna,
  segmentyKanalow,
  sumaWizyt,
  type WierszKampaniiUI,
  type WierszOdslonKanalu,
  type WierszZrodlaUI,
  wierszeKampanii,
  wierszeOdslonKanalow,
  wierszeUrzadzen,
  wierszeZrodel,
} from '@/panel/zakladki/akwizycja-dane'
import './akwizycja.css'

const OPCJE_OKNA = OKNA_DNI.map((dni) => ({ id: dni, etykieta: `${dni} dni` }))

/** Tyle źródeł prosimy o z bazy; lista jest przycięta, więc udział idzie od całości okresu. */
const LIMIT_ZRODEL = 50
/** Limit zapisany w funkcji bazy `admin_kampanie`: lista o tej długości mogła zostać przycięta. */
const LIMIT_KAMPANII = 200
/** Najliczniejsze kraje w tabeli (reszta idzie do podpisu pod nią, „(nieznany)” zawsze zostaje). */
const KRAJE_W_TABELI = 15
/** Tabela źródeł dłuższa niż to przewija się pionowo, zamiast wydłużać całą zakładkę. */
const WIERSZE_BEZ_PRZEWIJANIA = 12

const liczbaLubNull = (n: number | null) => (n === null ? null : formatLiczby(n))
const procentLubNull = (p: number | null) => (p === null ? null : formatProcent(p))

// ── Komórki ───────────────────────────────────────────────────────────────────────────────

/** Nazwa kanału z kropką jego koloru. Barwa stoi na kropce, a nie na piśmie. */
function NazwaKanalu({ etykieta, kolor }: { etykieta: string; kolor: KolorDanych }) {
  return (
    <span className="akw-kanal">
      <span
        className="panel-kropka"
        style={{ background: KOLOR_DANYCH[kolor] }}
        aria-hidden="true"
      />
      <span>{etykieta}</span>
    </span>
  )
}

/** Tekst z bazy w komórce: skracany wielokropkiem, pełny w dymku. Zawsze jako treść, nie link. */
function TekstZBazy({ tekst }: { tekst: string }) {
  return (
    <span className="akw-tekst" title={tekst}>
      {tekst}
    </span>
  )
}

/**
 * Źródło wizyty i (gdy ją zapisano) ścieżka referera w JEDNEJ linii: nazwa źródła zwykłym pismem,
 * ścieżka przygaszona za nią. Osobna kolumna ścieżki miałaby w większości wierszy „(brak)”, a na
 * telefonie spychałaby liczby poza ekran. Oba teksty pochodzą z bazy, więc idą wyłącznie jako treść.
 */
function ZrodloZeSciezka({ zrodlo, sciezka }: { zrodlo: string; sciezka: string | null }) {
  return (
    <span
      className="panel-tabela-etykieta"
      title={sciezka === null ? zrodlo : `${zrodlo} ${sciezka}`}
    >
      {zrodlo}
      {sciezka === null ? null : <span className="akw-sciezka">{sciezka}</span>}
    </span>
  )
}

const KOLUMNY_ODSLON: KolumnaTabeli<WierszOdslonKanalu>[] = [
  {
    id: 'kanal',
    naglowek: 'Kanał',
    naglowekWiersza: true,
    komorka: (w) => <NazwaKanalu etykieta={w.etykieta} kolor={w.kolor} />,
  },
  {
    id: 'odslony',
    naglowek: 'Odsłony',
    klucz: 'akwizycja.odslonyGlebokosc',
    liczbowa: true,
    komorka: (w) => liczbaLubNull(w.odslony),
  },
  {
    id: 'glebokosc',
    naglowek: 'Odsłon na wizytę',
    liczbowa: true,
    komorka: (w) => (w.odslonNaWizyte === null ? null : formatLiczby(w.odslonNaWizyte, 1)),
  },
]

const KOLUMNY_ZRODEL: KolumnaTabeli<WierszZrodlaUI>[] = [
  {
    id: 'kanal',
    naglowek: 'Kanał',
    komorka: (w) => <NazwaKanalu etykieta={w.etykietaKanalu} kolor={w.kolor} />,
  },
  {
    id: 'zrodlo',
    naglowek: 'Źródło i ścieżka referera',
    naglowekWiersza: true,
    komorka: (w) => <ZrodloZeSciezka zrodlo={w.zrodlo} sciezka={w.sciezka} />,
  },
  {
    id: 'wizyty',
    naglowek: 'Wizyty',
    klucz: 'akwizycja.wizyty',
    liczbowa: true,
    sortowana: 'malejaco',
    komorka: (w) => liczbaLubNull(w.wizyty),
  },
  {
    id: 'udzial',
    naglowek: 'Udział',
    liczbowa: true,
    komorka: (w) => procentLubNull(w.udzial),
  },
]

const KOLUMNY_KAMPANII: KolumnaTabeli<WierszKampaniiUI>[] = [
  {
    id: 'zrodlo',
    naglowek: 'Źródło (utm_source)',
    komorka: (w) => <TekstZBazy tekst={w.zrodlo} />,
  },
  {
    id: 'medium',
    naglowek: 'Medium',
    komorka: (w) => <TekstZBazy tekst={w.medium} />,
  },
  {
    id: 'kampania',
    naglowek: 'Kampania',
    komorka: (w) => <TekstZBazy tekst={w.kampania} />,
  },
  {
    id: 'wizyty',
    naglowek: 'Wizyty',
    klucz: 'akwizycja.wizyty',
    liczbowa: true,
    sortowana: 'malejaco',
    komorka: (w) => liczbaLubNull(w.wizyty),
  },
  {
    id: 'udzial',
    naglowek: 'Udział',
    liczbowa: true,
    komorka: (w) => procentLubNull(w.udzial),
  },
]

// ── Sekcje ────────────────────────────────────────────────────────────────────────────────

function SekcjaKanalow({ okno }: { okno: OknoDni }) {
  const kanaly = useWidok('kanaly', { p_dni: okno })
  return (
    <Sekcja
      tytul="Kanały wejścia"
      klucz="akwizycja.kanaly"
      opis={
        <>
          Skąd przyszły wizyty
          <Podpowiedz klucz="akwizycja.wizyty" />: kanał wyznacza pierwsza odsłona wizyty. Pasek
          dzieli wizyty, a tabela pokazuje, ile odsłon przypada na wizytę z danego kanału.
        </>
      }
      stan={kanaly}
      pusto={(wiersze) => sumaWizyt(wiersze) <= 0}
      pusteInfo="W tym okresie nie było żadnej wizyty do podziału na kanały. Pomiar mógł dopiero ruszyć albo serwis nie miał ruchu; stan pomiaru sprawdzisz w zakładce Jakość."
    >
      {(wiersze) => (
        <div className="akw-blok">
          <PasekUdzialow
            segmenty={segmentyKanalow(wiersze)}
            jednostka={JEDNOSTKI.wizyty}
            opis={`Kanały wejścia, ostatnie ${okno} dni`}
          />
          <Tabela
            podpis="Odsłony wizyt według kanału"
            wiersze={wierszeOdslonKanalow(wiersze)}
            kluczWiersza={(w) => w.klucz}
            kolumny={KOLUMNY_ODSLON}
          />
          <p className="akw-uwaga">
            Odsłon na wizytę = odsłony ÷ wizyty kanału (wizyty i ich udział są w legendzie paska);
            więcej znaczy głębsze wizyty, a nie lepsze. „Wewnętrzne” nie jest wejściem
            <Podpowiedz klucz="akwizycja.wewnetrzne" />: taka wizyta liczy się jako bezpośrednia.
          </p>
        </div>
      )}
    </Sekcja>
  )
}

function SekcjaZrodel({ okno }: { okno: OknoDni }) {
  const zrodla = useWidok('zrodla', { p_dni: okno, p_limit: LIMIT_ZRODEL })
  // Całość okresu (podstawa udziału) to suma wizyt wszystkich kanałów: ten sam widok co w sekcji
  // kanałów, więc pobranie jest współdzielone, a liczby obu sekcji muszą się zgadzać.
  const kanaly = useWidok('kanaly', { p_dni: okno })
  return (
    <Sekcja
      tytul="Źródła wizyt"
      klucz="akwizycja.zrodla"
      opis="Konkretny serwis albo znacznik, z którego przyszła wizyta: najpierw utm_source, bez niego host referera, a bez obu nazwa identyfikatora kliknięcia (np. gclid)."
      stan={polaczStany(zrodla, kanaly)}
      pusto={([surowe]) => surowe.length === 0}
      pusteInfo="W tym okresie nie było wizyt, więc nie ma czego rozbić na źródła."
    >
      {([surowe, kanalyOkresu]) => {
        const lacznie = sumaWizyt(kanalyOkresu)
        const wiersze = wierszeZrodel(surowe, lacznie)
        const przyciete = surowe.length >= LIMIT_ZRODEL
        return (
          <div className="akw-blok">
            <Tabela
              podpis="Źródła wizyt"
              wiersze={wiersze}
              kluczWiersza={(w) => w.klucz}
              kolumny={KOLUMNY_ZRODEL}
              przewijana={wiersze.length > WIERSZE_BEZ_PRZEWIJANIA}
            />
            <p className="akw-uwaga">
              Udział liczony od {formatLiczby(lacznie)} wizyt łącznie (wszystkie kanały okresu), a
              nie od sumy tej listy. Pozycji na liście: {formatLiczby(surowe.length)}
              {przyciete ? ' (przycięta do najliczniejszych źródeł)' : ' (lista kompletna)'}.
              Przygaszony tekst za nazwą źródła to ścieżka referera; zapisujemy ją tylko dla hostów
              publicznych, przy pozostałych zostaje sam host.
            </p>
          </div>
        )
      }}
    </Sekcja>
  )
}

function SekcjaKampanii({ okno }: { okno: OknoDni }) {
  const kampanie = useWidok('kampanie', { p_dni: okno })
  return (
    <Sekcja
      tytul="Kampanie UTM"
      klucz="akwizycja.kampanie"
      opis="Wizyty ze znacznikami UTM w adresie. Każda kombinacja źródła, medium i kampanii to osobny wiersz."
      stan={kampanie}
      pusto={(wiersze) => wiersze.length === 0}
      pusteInfo="W tym okresie nie było wizyt ze znacznikami UTM. Oznacz linki w kampaniach parametrami utm_source, utm_medium i utm_campaign."
    >
      {(wiersze) => (
        <div className="akw-blok">
          <Tabela
            podpis="Kampanie UTM"
            wiersze={wierszeKampanii(wiersze)}
            kluczWiersza={(w) => w.klucz}
            kolumny={KOLUMNY_KAMPANII}
            przewijana={wiersze.length > WIERSZE_BEZ_PRZEWIJANIA}
          />
          <p className="akw-uwaga">
            Udział liczony od {formatLiczby(sumaWizyt(wiersze))} wizyt ze znacznikami UTM (suma tej
            listy). Wizyty bez znaczników UTM nie wchodzą na listę.
            {wiersze.length >= LIMIT_KAMPANII
              ? ` Lista jest przycięta do ${formatLiczby(LIMIT_KAMPANII)} najliczniejszych kampanii, więc suma może być niższa od prawdziwej.`
              : ''}
          </p>
        </div>
      )}
    </Sekcja>
  )
}

function SekcjaKrajow({ okno }: { okno: OknoDni }) {
  const kraje = useWidok('kraje', { p_dni: okno })
  return (
    <Sekcja
      tytul="Kraje"
      klucz="akwizycja.kraje"
      opis="Kraj z nagłówka hostingu. „(nieznany)” to osobna pozycja, nie zero."
      stan={kraje}
      pusto={(wiersze) => sumaWizyt(wiersze) <= 0}
      pusteInfo="W tym okresie nie było wizyt do podziału na kraje."
    >
      {(wiersze) => {
        const czolowka = czolowkaKrajow(wiersze, KRAJE_W_TABELI)
        const czesc = czolowka.pominietych > 0
        return (
          <div className="akw-blok">
            <TabelaTop
              wiersze={czolowka.wiersze}
              naglowekEtykiety="Kraj"
              naglowekWartosci="Wizyty"
              klucz="akwizycja.wizyty"
              udzial
              // Lista przycięta liczy udział od całości okresu; kompletna od własnej sumy.
              podstawa={czesc ? czolowka.lacznie : undefined}
              jednostka="wizyt"
            />
            {czesc ? (
              <p className="akw-uwaga">
                Pokazano {formatLiczby(czolowka.wiersze.length)} z {formatLiczby(czolowka.pozycji)}{' '}
                pozycji. Wizyty z pominiętych pozycji: {formatLiczby(czolowka.wizytyPominietych)}.
              </p>
            ) : null}
          </div>
        )
      }}
    </Sekcja>
  )
}

function SekcjaUrzadzen({ okno }: { okno: OknoDni }) {
  const urzadzenia = useWidok('urzadzenia', { p_dni: okno })
  return (
    <Sekcja
      tytul="Urządzenia"
      klucz="akwizycja.urzadzenia"
      opis="Klasa urządzenia z przeglądarki pierwszej odsłony wizyty."
      stan={urzadzenia}
      pusto={(wiersze) => sumaWizyt(wiersze) <= 0}
      pusteInfo="W tym okresie nie było wizyt do podziału na urządzenia."
    >
      {(wiersze) => (
        <TabelaTop
          wiersze={wierszeUrzadzen(wiersze)}
          naglowekEtykiety="Urządzenie"
          naglowekWartosci="Wizyty"
          klucz="akwizycja.wizyty"
          udzial
          jednostka="wizyt"
          pozycje={false}
        />
      )}
    </Sekcja>
  )
}

// ── Zakładka ──────────────────────────────────────────────────────────────────────────────

export function Akwizycja() {
  const [okno, setOkno] = useState<OknoDni>(OKNO_DOMYSLNE)
  return (
    <div className="panel-stos">
      {/* Jeden filtr okresu nad wszystkimi sekcjami: liczby w całej zakładce dotyczą tych samych dób. */}
      <div className="akw-filtr">
        <span className="akw-filtr-nazwa" aria-hidden="true">
          Okres
        </span>
        <Segmenty legenda="Okres" opcje={OPCJE_OKNA} wartosc={okno} naZmiane={setOkno} />
        <span className="akw-filtr-opis">{opisOkna(okno)}</span>
      </div>
      <SekcjaKanalow okno={okno} />
      <SekcjaZrodel okno={okno} />
      <SekcjaKampanii okno={okno} />
      <div className="panel-kolumny">
        <SekcjaKrajow okno={okno} />
        <SekcjaUrzadzen okno={okno} />
      </div>
    </div>
  )
}
