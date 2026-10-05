// Zakładka „Sesje” (T057, FR-032): co dzieje się w obrębie jednej wizyty. Kafle (sesje, strony na
// sesję, czas wizyty, odsetek sesji zaangażowanych i jednostronicowych), przejścia ekran → ekran
// i udostępnienia, w jednym okresie 7/30 dni.
//
// Co stoi tu, a co gdzie indziej:
//  - wstęp zakładki, pasek zakładek i „Odśwież” rysuje `EkranPanel`; tu ich nie powtarzamy;
//  - układ danych (odsetki, grupowanie przejść, odsetek dokończeń udostępnień) leży w
//    `sesje-dane.ts` i ma testy; komponent nie liczy procentów we własnych pętlach;
//  - odsetki sesji zaangażowanych i jednostronicowych są liczone od LICZBY SESJI okresu; nie są
//    dopełnieniem (sesja z jedną odsłoną, która trwała 30 s i dłużej, należy do obu);
//  - przejścia: JEDNA TABELA NA EKRAN ŹRÓDŁOWY. Udział przejścia to jego liczba podzielona przez
//    wszystkie przejścia z tego ekranu, więc udziały w tabeli dają 100%, a podstawa jest podpisana pod
//    każdą z nich. Jedna lista z mieszanymi podstawami wyglądałaby na jedną skalę i nią nie byłaby;
//  - brak sesji to szary „brak danych” (mediany nie istnieją bez sesji), nigdy 0;
//  - czasy są PODŁOGĄ: czas biegnie od otwarcia odsłony do pierwszego ukrycia karty albo opuszczenia
//    ekranu (wyjście wysyła się raz), a o północy odcisk rotuje i wizyta się kończy. Definicja
//    sygnału wyjścia żyje w słowniku (`sesje.sygnalWyjscia`), a pod kaflami stoi tylko skrót z
//    odsyłaczem; tak samo odsetek dokończeń (`sesje.odsetekDokonczen`) i głębokość wizyt
//    (`akwizycja.odslonyGlebokosc`);
//  - tekst z bazy (etykieta elementu udostępnienia, nieznany ekran) jest niezaufany: tylko jako treść.
//
// React Compiler: bez useMemo/useCallback, bez domyślnych wartości w destrukturyzacji propsów.
import { useState } from 'react'
import { formatCzasu, formatLiczby, formatProcent } from '@/panel/arytmetyka'
import { useWidok } from '@/panel/dane'
import { KartaStat } from '@/panel/skladniki/KartaStat'
import { Podpowiedz } from '@/panel/skladniki/Podpowiedz'
import { Segmenty } from '@/panel/skladniki/Segmenty'
import { Sekcja } from '@/panel/skladniki/Sekcja'
import { type KolumnaTabeli, Tabela } from '@/panel/skladniki/Tabela'
import { TabelaTop } from '@/panel/skladniki/TabelaTop'
import { OKNA_DNI, OKNO_DOMYSLNE, type OknoDni, opisOkna } from '@/panel/zakladki/akwizycja-dane'
import {
  grupujPrzejscia,
  kafleSesji,
  lacznieUdostepnien,
  udostepnieniaWgElementu,
  udostepnieniaWgSposobu,
  type WierszElementu,
} from '@/panel/zakladki/sesje-dane'
import './sesje.css'

const OPCJE_OKNA = OKNA_DNI.map((dni) => ({ id: dni, etykieta: `${dni} dni` }))

/** Tyle par ekran → ekran prosimy o z bazy (max funkcji); ekranów mierzonych jest siedem. */
const LIMIT_PRZEJSC = 200
/** Najwięcej tabel przejść na ekranie (ekran źródłowy = jedna tabela). */
const MAKS_EKRANOW = 8

const procentLubNull = (p: number | null) => (p === null ? null : formatProcent(p))

const KOLUMNY_ELEMENTOW: KolumnaTabeli<WierszElementu>[] = [
  {
    id: 'element',
    naglowek: 'Element',
    naglowekWiersza: true,
    komorka: (w) => (
      <span className="panel-tabela-etykieta" title={w.element}>
        {w.element}
      </span>
    ),
  },
  {
    id: 'proby',
    naglowek: 'Próby',
    liczbowa: true,
    sortowana: 'malejaco',
    komorka: (w) => formatLiczby(w.proby),
  },
  {
    id: 'dokonczone',
    naglowek: 'Dokończone',
    liczbowa: true,
    komorka: (w) => formatLiczby(w.dokonczone),
  },
  {
    id: 'odsetek',
    naglowek: 'Odsetek dokończeń',
    klucz: 'sesje.odsetekDokonczen',
    liczbowa: true,
    komorka: (w) => procentLubNull(w.odsetekDokonczen),
  },
]

// ── Sekcje ────────────────────────────────────────────────────────────────────────────────

function SekcjaWizyt({ okno }: { okno: OknoDni }) {
  const przeglad = useWidok('sesje_przeglad', { p_dni: okno })
  return (
    <Sekcja
      tytul="Wizyty w skrócie"
      opis={
        <>
          Sesja to ciąg odsłon
          <Podpowiedz klucz="akwizycja.odslonyGlebokosc" /> jednego odcisku z przerwami do 30 minut.
          Roboty nie wchodzą do tych liczb. Odsetki idą od liczby sesji okresu.
        </>
      }
      stan={przeglad}
      pusto={(p) => kafleSesji(p) === null}
      pusteInfo="W tym okresie nie było żadnej sesji, więc mediany i odsetki nie istnieją (to nie zera). Pomiar mógł dopiero ruszyć; stan pomiaru sprawdzisz w zakładce Jakość."
    >
      {(p) => {
        const kafle = kafleSesji(p)
        if (kafle === null) return null
        return (
          <div className="ses-blok">
            <div className="panel-siatka">
              <KartaStat
                etykieta="Sesje"
                wartosc={kafle.sesje}
                klucz="sesje.sesje"
                podpis={
                  kafle.odslony === null
                    ? undefined
                    : `odsłony w tych sesjach: ${formatLiczby(kafle.odslony)}`
                }
              />
              <KartaStat
                etykieta="Strony na sesję"
                wartosc={kafle.medianaStron}
                miejsca={1}
                klucz="sesje.stronNaSesje"
                podpis={
                  kafle.sredniaStron === null
                    ? 'mediana'
                    : `mediana; średnia: ${formatLiczby(kafle.sredniaStron, 1)}`
                }
              />
              <KartaStat
                etykieta="Czas wizyty (mediana)"
                wartosc={kafle.medianaCzasMs === null ? null : formatCzasu(kafle.medianaCzasMs)}
                klucz="sesje.czasWizyty"
                podpis={
                  kafle.p75CzasMs === null
                    ? undefined
                    : `75% sesji trwa do ${formatCzasu(kafle.p75CzasMs)}`
                }
              />
              <KartaStat
                etykieta="Sesje zaangażowane"
                wartosc={procentLubNull(kafle.zaangazowanePct)}
                klucz="sesje.zaangazowane"
                podpis={
                  kafle.zaangazowane === null
                    ? undefined
                    : `${formatLiczby(kafle.zaangazowane)} z ${formatLiczby(kafle.sesje)} sesji`
                }
              />
              <KartaStat
                etykieta="Sesje jednostronicowe"
                wartosc={procentLubNull(kafle.jednostronicowePct)}
                klucz="sesje.jednostronicowe"
                podpis={
                  kafle.jednostronicowe === null
                    ? undefined
                    : `${formatLiczby(kafle.jednostronicowe)} z ${formatLiczby(kafle.sesje)} sesji`
                }
              />
            </div>
            <p className="ses-uwaga">
              Czasy są podłogą: wyjście z odsłony wysyłamy raz
              <Podpowiedz klucz="sesje.sygnalWyjscia" />, więc prawdziwe wizyty trwają zwykle
              dłużej.
            </p>
          </div>
        )
      }}
    </Sekcja>
  )
}

function SekcjaPrzejsc({ okno }: { okno: OknoDni }) {
  const przejscia = useWidok('przejscia', { p_dni: okno, p_limit: LIMIT_PRZEJSC })
  return (
    <Sekcja
      tytul="Dokąd prowadzą ekrany"
      klucz="sesje.przejscia"
      opis="Każda tabela to jeden ekran źródłowy: dokąd poszła wizyta po jego odsłonie. „(wyjście)” oznacza koniec wizyty. Udziały w tabeli dają 100% przejść z tego ekranu."
      stan={przejscia}
      pusto={(wiersze) => grupujPrzejscia(wiersze).grupy.length === 0}
      pusteInfo="Brak przejść w tym okresie. Przejście powstaje dopiero po odsłonie ekranu, więc potrzeba wizyt z co najmniej jedną odsłoną."
    >
      {(wiersze) => {
        const wynik = grupujPrzejscia(wiersze, MAKS_EKRANOW)
        const przycieteEkrany = wynik.ekranow > wynik.grupy.length
        const przycieteWiersze = wiersze.length >= LIMIT_PRZEJSC
        return (
          <div className="ses-blok">
            <div className="panel-kolumny">
              {wynik.grupy.map((grupa) => (
                <TabelaTop
                  key={grupa.skad}
                  podpis={`Z ekranu: ${grupa.etykieta}`}
                  wiersze={grupa.cele}
                  naglowekEtykiety="Dokąd"
                  naglowekWartosci="Przejścia"
                  udzial
                  jednostka="przejść"
                  pozycje={false}
                />
              ))}
            </div>
            {przycieteEkrany || przycieteWiersze ? (
              <p className="ses-uwaga">
                {przycieteEkrany
                  ? `Pokazano ${formatLiczby(wynik.grupy.length)} z ${formatLiczby(wynik.ekranow)} ekranów źródłowych, tych z największą liczbą przejść. `
                  : ''}
                {przycieteWiersze
                  ? `Lista z bazy jest przycięta do ${formatLiczby(LIMIT_PRZEJSC)} najczęstszych par, więc rzadkich przejść może brakować, a udziały liczą się od sumy widocznych przejść ekranu.`
                  : ''}
              </p>
            ) : null}
          </div>
        )
      }}
    </Sekcja>
  )
}

function SekcjaUdostepnien({ okno }: { okno: OknoDni }) {
  const udostepnienia = useWidok('udostepnienia', { p_dni: okno })
  return (
    <Sekcja
      tytul="Udostępnienia"
      klucz="sesje.udostepnienia"
      opis="Użycie przycisków udostępniania: według sposobu i według elementu, który udostępniono."
      stan={udostepnienia}
      pusto={(wiersze) => lacznieUdostepnien(wiersze) <= 0}
      pusteInfo="W tym okresie nikt nie użył przycisku udostępniania. Jeśli to się nie zgadza z ruchem, sprawdź w zakładce Jakość, czy zdarzenia udostępnień w ogóle dochodzą."
    >
      {(wiersze) => (
        <div className="panel-kolumny">
          <TabelaTop
            podpis="Według sposobu"
            wiersze={udostepnieniaWgSposobu(wiersze)}
            naglowekEtykiety="Sposób"
            naglowekWartosci="Udostępnienia"
            udzial
            jednostka="udostępnień"
            pozycje={false}
          />
          <div className="ses-grupa">
            <Tabela
              podpis="Według elementu"
              wiersze={udostepnieniaWgElementu(wiersze)}
              kluczWiersza={(w) => w.klucz}
              kolumny={KOLUMNY_ELEMENTOW}
            />
            <p className="ses-uwaga">
              Odsetek dokończeń = dokończone ÷ wszystkie próby tego elementu; więcej znaczy lepiej.
            </p>
          </div>
        </div>
      )}
    </Sekcja>
  )
}

// ── Zakładka ──────────────────────────────────────────────────────────────────────────────

export function Sesje() {
  const [okno, setOkno] = useState<OknoDni>(OKNO_DOMYSLNE)
  return (
    <div className="panel-stos">
      {/* Jeden filtr okresu nad wszystkimi sekcjami: liczby w całej zakładce dotyczą tych samych dób. */}
      <div className="ses-filtr">
        <span className="ses-filtr-nazwa" aria-hidden="true">
          Okres
        </span>
        <Segmenty legenda="Okres" opcje={OPCJE_OKNA} wartosc={okno} naZmiane={setOkno} />
        <span className="ses-filtr-opis">{opisOkna(okno)}</span>
      </div>
      <SekcjaWizyt okno={okno} />
      <SekcjaPrzejsc okno={okno} />
      <SekcjaUdostepnien okno={okno} />
    </div>
  )
}
