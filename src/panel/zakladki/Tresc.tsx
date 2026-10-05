// Zakładka „Treść” (T060): co ludzie oglądają i czego nie znaleźli. Cztery sekcje: top ekrany
// (widok `top_ekrany`), top adresy (`top_adresy`), wyszukiwania bez wyniku (`bez_wyniku`) i lejek
// produktowy (`lejek`). Układ liczb liczy `tresc-dane.ts` i jest tam objęty testem; tu zostaje
// rysowanie.
//
// Kontrakt zakładki: eksport NAZWANY `Tresc`, komponent bez propsów, `EkranPanel` ładuje go leniwie.
//
// Decyzje (dlaczego tak):
//  - Jeden filtr okresu (7/30 dni) nad wszystkimi sekcjami. Domyślnie 7 dni (lejek liczy się na
//    sesjach, w najcięższym zapytaniu zakładki); frazy bez wyniku bywają rzadkie, więc 30 dni jest
//    pod ręką.
//  - Udział ekranu liczony jest od SUMY odsłon wszystkich ekranów (lista pełna). „Unikalni” to
//    odciski dobowe w obrębie wiersza: stoją obok, bez sumy i bez udziału. Top adresy to fragment
//    całości (limit listy), więc nie mają udziału.
//  - Link do adresu idzie wyłącznie przez `linkDoSerwisu` (ścieżki pochodzą od dowolnego klienta),
//    otwiera się w nowej karcie z `rel="noopener"`; ścieżka niezgodna z regułą jest samym tekstem.
//  - Fraza `[odrzucono]` (wyszukiwania z danymi osobowymi, których nie zapisano) to osobny wiersz z
//    podpisem na końcu tabeli, nie pozycja rankingu fraz.
//  - Lejek: procent od kroku „Wyszukanie” (na wykresie) i od poprzedniego (w dymku i w tabeli) są
//    podpisane. Kroki są niezależne, więc krok późniejszy MOŻE przewyższyć wcześniejszy; panel nie
//    udaje wtedy spadku ani nie przycina słupka, tylko opisuje regułę nad wykresem.
import { useState } from 'react'
import { czyLiczba, formatLiczby, formatProcent } from '@/panel/arytmetyka'
import { useWidok } from '@/panel/dane'
import { NAZWA_EKRANU, nazwa } from '@/panel/nazwy'
import { Segmenty } from '@/panel/skladniki/Segmenty'
import { Sekcja } from '@/panel/skladniki/Sekcja'
import { type KolumnaTabeli, Tabela } from '@/panel/skladniki/Tabela'
import { WykresLejka } from '@/panel/skladniki/WykresLejka'
import type { WierszBezWyniku, WierszLejka, WierszTopAdresu, WierszTopEkranu } from '@/panel/typy'
import {
  bezWyniku,
  formatOstatnio,
  krokiLejka,
  LIMIT_ADRESOW,
  LIMIT_FRAZ,
  topAdresy,
  topEkrany,
  uwagiLejka,
  type WierszAdresu,
  ZNACZNIK_ODRZUCONO,
} from './tresc-dane'
import {
  OKRES_DOMYSLNY,
  OKRESY,
  type Okres,
  opisPodstawyUdzialu,
  type WierszListy,
} from './zaangazowanie-dane'
import './zaangazowanie-cta-tresc.css'

function nazwaEkranu(ekran: string): string {
  return nazwa(NAZWA_EKRANU, ekran)
}

// ── Top ekrany ────────────────────────────────────────────────────────────────────────────

function TabelaEkranow({ wiersze, okres }: { wiersze: WierszTopEkranu[]; okres: Okres }) {
  const lista = topEkrany(wiersze)
  const kolumny: KolumnaTabeli<WierszListy<WierszTopEkranu>>[] = [
    { id: 'lp', naglowek: 'Poz.', komorka: (_w, i) => `${i + 1}.` },
    {
      id: 'ekran',
      naglowek: 'Ekran',
      naglowekWiersza: true,
      komorka: (w) => nazwaEkranu(w.pozycja?.ekran ?? ''),
    },
    { id: 'odslony', naglowek: 'Odsłony', liczbowa: true, komorka: (w) => formatLiczby(w.wartosc) },
    {
      id: 'udzial',
      naglowek: 'Udział w odsłonach',
      liczbowa: true,
      komorka: (w) => (w.udzial === null ? null : formatProcent(w.udzial)),
    },
    {
      id: 'unikalni',
      naglowek: 'Unikalni (odciski)',
      liczbowa: true,
      komorka: (w) =>
        w.pozycja !== null && czyLiczba(w.pozycja.unikalni)
          ? formatLiczby(w.pozycja.unikalni)
          : null,
    },
  ]
  const nota = opisPodstawyUdzialu(lista, 'odsłon')
  return (
    <div className="ztc-bez-lp">
      <Tabela
        podpis={`Ekrany według odsłon, ostatnie ${okres} dni`}
        kolumny={kolumny}
        wiersze={lista.wiersze}
        kluczWiersza={(w) => w.klucz}
      />
      <p className="panel-tabela-uwaga">
        Unikalni to odciski dobowe liczone w obrębie ekranu, nie osoby; nie sumuj ich między
        wierszami, bo ta sama osoba odwiedza kilka ekranów. {nota}
      </p>
    </div>
  )
}

// ── Top adresy ────────────────────────────────────────────────────────────────────────────

/** Ścieżka adresu jako link w nowej karcie (tylko gdy `linkDoSerwisu` ją przepuścił), inaczej sam tekst. */
function Adres({ adres }: { adres: WierszAdresu }) {
  if (adres.href === null) {
    return (
      <span className="panel-tabela-etykieta" title={adres.sciezka}>
        {adres.sciezka}
      </span>
    )
  }
  return (
    <a
      className="ztc-link panel-tabela-etykieta"
      href={adres.href}
      target="_blank"
      rel="noopener"
      title={adres.sciezka}
    >
      {adres.sciezka}
      <span aria-hidden="true"> ↗</span>
      <span className="sr-only"> (otwiera się w nowej karcie)</span>
    </a>
  )
}

function TabelaAdresow({ wiersze, okres }: { wiersze: WierszTopAdresu[]; okres: Okres }) {
  const adresy = topAdresy(wiersze)
  const kolumny: KolumnaTabeli<WierszAdresu>[] = [
    { id: 'lp', naglowek: 'Poz.', komorka: (_w, i) => `${i + 1}.` },
    {
      id: 'adres',
      naglowek: 'Adres (ścieżka strony)',
      naglowekWiersza: true,
      komorka: (w) => <Adres adres={w} />,
    },
    { id: 'odslony', naglowek: 'Odsłony', liczbowa: true, komorka: (w) => formatLiczby(w.odslony) },
    {
      id: 'unikalni',
      naglowek: 'Unikalni (odciski)',
      liczbowa: true,
      komorka: (w) => (w.unikalni === null ? null : formatLiczby(w.unikalni)),
    },
  ]
  return (
    <div className="ztc-bez-lp">
      <Tabela
        podpis={`Najczęściej oglądane karty adresów, ostatnie ${okres} dni`}
        kolumny={kolumny}
        wiersze={adresy}
        kluczWiersza={(w) => w.klucz}
      />
      <p className="panel-tabela-uwaga">
        Unikalni to odciski dobowe liczone w obrębie adresu, nie osoby.
        {wiersze.length >= LIMIT_ADRESOW
          ? ` Lista pokazuje ${LIMIT_ADRESOW} najczęściej oglądanych adresów, dalsze są pominięte.`
          : ''}
      </p>
    </div>
  )
}

// ── Wyszukiwania bez wyniku ───────────────────────────────────────────────────────────────

/** Wiersz tabeli fraz: fraza albo (przy `fraza === null`) zbiorcza pozycja danych osobowych. */
interface WierszTabeliFraz {
  klucz: string
  fraza: string | null
  ile: number
  ostatnio: string | null
}

function TabelaFraz({ wiersze, okres }: { wiersze: WierszBezWyniku[]; okres: Okres }) {
  const { frazy, odrzucone } = bezWyniku(wiersze)
  const wierszeTabeli: WierszTabeliFraz[] = frazy.map((f) => ({
    klucz: f.klucz,
    fraza: f.fraza,
    ile: f.ile,
    ostatnio: f.ostatnio,
  }))
  if (odrzucone !== null) {
    wierszeTabeli.push({
      klucz: ZNACZNIK_ODRZUCONO,
      fraza: null,
      ile: odrzucone.ile,
      ostatnio: odrzucone.ostatnio,
    })
  }
  const kolumny: KolumnaTabeli<WierszTabeliFraz>[] = [
    { id: 'lp', naglowek: 'Poz.', komorka: (w, i) => (w.fraza === null ? '' : `${i + 1}.`) },
    {
      id: 'fraza',
      naglowek: 'Fraza',
      naglowekWiersza: true,
      komorka: (w) =>
        w.fraza === null ? (
          <span className="ztc-zbiorczy">Dane osobowe (frazy nie zapisano)</span>
        ) : (
          <span className="ztc-etykieta">{w.fraza}</span>
        ),
    },
    { id: 'ile', naglowek: 'Ile razy', liczbowa: true, komorka: (w) => formatLiczby(w.ile) },
    {
      id: 'ostatnio',
      naglowek: 'Ostatnio',
      liczbowa: true,
      komorka: (w) => formatOstatnio(w.ostatnio),
    },
  ]
  return (
    <div className="ztc-bez-lp">
      <Tabela
        podpis={`Wyszukiwania bez wyniku od najczęstszego, ostatnie ${okres} dni`}
        kolumny={kolumny}
        wiersze={wierszeTabeli}
        kluczWiersza={(w) => w.klucz}
      />
      <p className="panel-tabela-uwaga">
        Frazy są znormalizowane (małe litery, do 80 znaków).
        {odrzucone !== null
          ? ' Wiersz „Dane osobowe” zlicza wyszukiwania, których frazy nie zapisano, bo wyglądały na e-mail, telefon lub długi ciąg cyfr.'
          : ''}
        {wiersze.length >= LIMIT_FRAZ
          ? ` Lista pokazuje ${LIMIT_FRAZ} najczęstszych pozycji, dalsze są pominięte.`
          : ''}
      </p>
    </div>
  )
}

// ── Lejek produktowy ──────────────────────────────────────────────────────────────────────

function LejekProduktowy({ wiersze, okres }: { wiersze: WierszLejka[]; okres: Okres }) {
  const kroki = krokiLejka(wiersze)
  const uwagi = uwagiLejka(kroki)
  return (
    <div className="ztc-blok">
      {/* Uwagi nad wykresem, nie pod nim: wyjaśniają słupek, który wygląda na błąd, więc czytelnik ma
          je przeczytać, zanim zacznie czytać liczby. */}
      {uwagi.length > 0 ? (
        <ul className="ztc-uwagi">
          {uwagi.map((uwaga) => (
            <li key={uwaga}>{uwaga}</li>
          ))}
        </ul>
      ) : null}
      <WykresLejka kroki={kroki} tytul={`Lejek produktowy, ostatnie ${okres} dni`} />
    </div>
  )
}

// ── Zakładka ──────────────────────────────────────────────────────────────────────────────

export function Tresc() {
  const [okres, setOkres] = useState<Okres>(OKRES_DOMYSLNY)
  const ekrany = useWidok('top_ekrany', { p_dni: okres })
  const adresy = useWidok('top_adresy', { p_dni: okres, p_limit: LIMIT_ADRESOW })
  const frazy = useWidok('bez_wyniku', { p_dni: okres, p_limit: LIMIT_FRAZ })
  const lejek = useWidok('lejek', { p_dni: okres })

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
        tytul="Najczęściej oglądane ekrany"
        klucz="tresc.topEkrany"
        opis="Ekrany według liczby odsłon ludzi (bez botów). „Karta adresu” obejmuje wszystkie adresy razem; poszczególne karty są w zestawieniu niżej."
        stan={ekrany}
        pusto={(w) => w.length === 0}
        pusteInfo="W tym okresie nie było odsłon ludzi."
      >
        {(wiersze) => <TabelaEkranow wiersze={wiersze} okres={okres} />}
      </Sekcja>

      <Sekcja
        tytul="Najczęściej oglądane adresy"
        klucz="tresc.topAdresy"
        opis="Karty adresów według ścieżki strony. Link otwiera kartę w nowej karcie przeglądarki."
        stan={adresy}
        pusto={(w) => w.length === 0}
        pusteInfo="W tym okresie nikt nie otworzył karty adresu."
      >
        {(wiersze) => <TabelaAdresow wiersze={wiersze} okres={okres} />}
      </Sekcja>

      <Sekcja
        tytul="Wyszukiwania bez wyniku"
        klucz="tresc.bezWyniku"
        opis="Frazy wpisane w wyszukiwarce serwisu, na które nie było wyniku: gotowa lista braków w danych (a przy okazji literówek i pytań spoza zakresu serwisu)."
        stan={frazy}
        pusto={(w) => w.length === 0}
        pusteInfo="W tym okresie nie było wyszukiwań bez wyniku. Albo nikt niczego nie chybił, albo pomiar wyszukiwań jeszcze nie zebrał danych."
      >
        {(wiersze) => <TabelaFraz wiersze={wiersze} okres={okres} />}
      </Sekcja>

      <Sekcja
        tytul="Lejek produktowy"
        klucz="tresc.lejek"
        opis="Ile sesji wykonało każdy krok. Na wykresie procent liczymy od kroku „Wyszukanie” (100%), a od kroku poprzedniego podaje go dymek i tabela pod wykresem. Kroki są niezależne: sesja liczy się do kroku, gdy ma jego zdarzenie, więc krok późniejszy może mieć więcej sesji niż wcześniejszy. Trzy kroki po karcie adresu to alternatywy, nie kolejne etapy."
        stan={lejek}
        pusto={(w) => w.length === 0}
        pusteInfo="W tym okresie nie było kroków lejka do policzenia."
      >
        {(wiersze) => <LejekProduktowy wiersze={wiersze} okres={okres} />}
      </Sekcja>
    </div>
  )
}
