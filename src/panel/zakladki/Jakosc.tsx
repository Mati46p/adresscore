// Zakładka „Jakość” (T061, US6, FR-036): czy pomiar w ogóle działa, jak szybka jest strona i co psuje się
// u odwiedzających. Wstęp, pasek zakładek i „Odśwież” rysuje `EkranPanel`; tu tylko treść.
//
// WIDOKI RPC: `diagnostyka` (admin_diagnostyka, 24 h), `witale` (admin_witale, okno 7/30 dni) i
// `bledy` (admin_bledy, okno 7/30 dni, do 50 komunikatów). Czysta logika (klasyfikacja biegu, wiek,
// układ tabeli, wiersze błędów) siedzi w `jakosc-dane.ts` z testami; tu zostaje układ.
//
// UKŁAD I KOLEJNOŚĆ. Diagnostyka stoi PIERWSZA: gdy jakakolwiek zakładka świeci pustką, pierwsze
// pytanie brzmi „czy pomiar żyje” (tak mówi wstęp zakładki). Filtr okresu 7/30 dni obejmuje tylko dwie
// sekcje pod nim (Web Vitals i błędy), bo diagnostyka jest migawką z 24 godzin niezależną od okresu;
// dlatego filtr stoi nad nimi, w jednym rzędzie, z podpisem o zasięgu, a nie na samej górze, gdzie
// sugerowałby, że obejmuje wszystko.
//
// STAN NIE JEST KOLOREM. Każdy wskaźnik to `Znacznik`: słowo i znak w kapsułce (OK / opóźniony / błąd /
// brak biegu, dobra / do poprawy / słaba, cisza), a kolor tylko je wzmacnia. Kolor palety danych nie
// trafia na pismo. Wskaźnik biegu zestawienia jest CZERWONY (ton `zla`) dla biegu opóźnionego ponad 26 h
// i dla biegu z błędem; brak biegu jest szary (w pierwszej dobie pomiaru) albo bursztynowy (później).
// Kafle z problemem dostają dodatkowo kolorową obwódkę, żeby wyjątki rzucały się w oczy.
//
// CZAS. Wiek zdarzeń liczy się od chwili POBRANIA danych (`pobrano`), nie od zegara w renderze: render
// nie woła Date.now(), a liczby pasują do znacznika „Dane z godz.” u góry panelu.
//
// DANE Z BAZY SĄ NIEZAUFANE. Komunikaty błędów pochodzą od dowolnej przeglądarki, więc idą wyłącznie
// jako treść Reacta, po oczyszczeniu i skróceniu (`wierszeBledow`); pełny tekst jest w dymku `title`.
//
// Brak w tym pliku: useMemo, useCallback i domyślnych wartości w destrukturyzacji propsów (React
// Compiler pominąłby wtedy komponent); stan okresu to zwykły `useState`.
import type { ReactNode } from 'react'
import { useState } from 'react'
import type { MetrykaWitalu } from '@/panel/arytmetyka'
import { ETYKIETA_OCENY, formatLiczby, formatWitalu, METRYKI_WITALI } from '@/panel/arytmetyka'
import type { StanWidoku } from '@/panel/dane'
import { useWidok } from '@/panel/dane'
import { NAZWA_BIEGU, NAZWA_EKRANU, nazwa } from '@/panel/nazwy'
import { BrakDanych } from '@/panel/skladniki/BrakDanych'
import { KartaStat } from '@/panel/skladniki/KartaStat'
import { Podpowiedz } from '@/panel/skladniki/Podpowiedz'
import { Segmenty } from '@/panel/skladniki/Segmenty'
import { Sekcja } from '@/panel/skladniki/Sekcja'
import type { KolumnaTabeli } from '@/panel/skladniki/Tabela'
import { Tabela } from '@/panel/skladniki/Tabela'
import type { TonZnacznika } from '@/panel/skladniki/Znacznik'
import { Znacznik } from '@/panel/skladniki/Znacznik'
import type { KluczHasla } from '@/panel/slownik'
import type { Diagnostyka, WierszBledu, WierszWitalu } from '@/panel/typy'
import type { KomorkaWitalu, WierszBleduWidok, WierszTypu, WierszWitali } from './jakosc-dane'
import {
  dniWZestawieniu,
  ETYKIETA_BIEGU,
  formatChwili,
  formatDnia,
  formatDniTemu,
  formatTrwania,
  formatUdzialuBezOdcisku,
  formatWieku,
  klasyfikujBieg,
  LIMIT_BLEDOW,
  liczbaProbek,
  MAX_KOMUNIKAT,
  MIN_PROBEK,
  ocenaOstatniegoZdarzenia,
  ocenaRetencji,
  oczyscTekst,
  okolicznoscBrakuBiegu,
  opisCiszy,
  opisProgowWitali,
  PROG_BIEGU_MS,
  RETENCJA_DNI,
  skrocTekst,
  sumaZdarzen24h,
  TON_BIEGU,
  tonOceny,
  udzialBezOdcisku,
  ukladWitali,
  werdyktBledow,
  wierszeBledow,
  wierszeTypow,
} from './jakosc-dane'
import './jakosc.css'

type Okres = 7 | 30

/** 30 dni to maksimum dla surowych zdarzeń (baza przycina większe okno), więc dalej nie ma po co sięgać. */
const OKRESY: readonly { id: Okres; etykieta: string; tytul: string }[] = [
  { id: 7, etykieta: '7 dni', tytul: 'Ostatnie 7 dni' },
  { id: 30, etykieta: '30 dni', tytul: 'Ostatnie 30 dni (maksimum dla surowych zdarzeń)' },
]

const OKRES_DOMYSLNY: Okres = 7

const KLUCZ_WITALU: Readonly<Record<MetrykaWitalu, KluczHasla>> = {
  lcp: 'jakosc.lcp',
  inp: 'jakosc.inp',
  cls: 'jakosc.cls',
  fcp: 'jakosc.fcp',
  ttfb: 'jakosc.ttfb',
}

// ── Diagnostyka pomiaru ───────────────────────────────────────────────────────────────────

/**
 * Opakowanie kafla `KartaStat`, które pozwala podświetlić jego obwódkę stanem, tak jak kafel biegu
 * zestawienia. `KartaStat` nie przyjmuje klasy ani atrybutów, więc obwódkę ustawia CSS z opakowania.
 * Sam kolor niczego nie przekazuje: słowo i znak stoją w kapsułce w środku kafla.
 */
function Kafel({ ton, children }: { ton: TonZnacznika | null; children: ReactNode }) {
  return (
    <div className="jakosc-kafel" data-ton={ton ?? undefined}>
      {children}
    </div>
  )
}

function KafelOstatnieZdarzenie({ iso, teraz }: { iso: string | null; teraz: number }) {
  const ocena = ocenaOstatniegoZdarzenia(iso, teraz)
  return (
    <Kafel ton={ocena.stan === 'cisza' ? 'uwaga' : null}>
      <KartaStat
        etykieta="Ostatnie zdarzenie"
        klucz="jakosc.ostatnieZdarzenie"
        wartosc={ocena.stan === 'brak' ? null : formatWieku(ocena.wiekMs)}
        podpis={
          ocena.stan === 'brak' ? (
            <span>Nie zapisano jeszcze żadnego zdarzenia ludzi (roboty nie są liczone).</span>
          ) : (
            <>
              <span>{formatChwili(iso)}</span>
              {ocena.stan === 'cisza' ? (
                <>
                  <Znacznik ton="uwaga">cisza</Znacznik>
                  <span>{opisCiszy(ocena.wiekMs)}</span>
                </>
              ) : (
                <Znacznik ton="dobra">na bieżąco</Znacznik>
              )}
            </>
          )
        }
      />
    </Kafel>
  )
}

/**
 * Kafel biegu zestawienia budujemy z klas `panel-stat*`, a nie przez `KartaStat`: wartością kafla jest
 * wskaźnik (kapsułka ze słowem i znakiem), a `KartaStat.wartosc` przyjmuje tylko liczbę albo napis.
 */
function KafelBiegu({ diagnostyka, teraz }: { diagnostyka: Diagnostyka; teraz: number }) {
  const bieg = diagnostyka.ostatni_bieg
  const ocena = klasyfikujBieg(bieg, teraz)
  const zalegly =
    ocena.stan === 'brak' &&
    okolicznoscBrakuBiegu(diagnostyka.najstarsze_zdarzenie, teraz) === 'zalegly'
  // Brak biegu jest szary, dopóki to pierwsza doba pomiaru; po niej to już zaległość i ton ostrzega.
  const ton: TonZnacznika = zalegly ? 'uwaga' : TON_BIEGU[ocena.stan]
  const rodzaj = bieg ? nazwa(NAZWA_BIEGU, oczyscTekst(bieg.rodzaj)) : null
  const blad = bieg ? oczyscTekst(bieg.blad) : ''

  return (
    <div className="panel-stat jakosc-bieg" data-ton={ton}>
      <div className="panel-stat-etykieta">
        Ostatni bieg zestawienia
        <Podpowiedz klucz="jakosc.ostatniBieg" />
      </div>
      <div className="panel-stat-wartosc">
        <Znacznik ton={ton}>{ETYKIETA_BIEGU[ocena.stan]}</Znacznik>
      </div>
      <div className="panel-stat-podpis">
        {ocena.stan === 'brak' ? (
          <span>
            {zalegly
              ? 'Pomiar działa dłużej niż dobę, a zestawienie nie biegło ani razu. Sprawdź harmonogram w bazie: historia dzienna się nie zapisuje.'
              : 'Zestawienie jeszcze nie biegło. W pierwszej dobie pomiaru to normalne: bieg startuje po północy.'}
          </span>
        ) : (
          <>
            <span>
              {rodzaj}
              {bieg?.koniec ? `, koniec ${formatChwili(bieg.koniec)}` : ''}
            </span>
            {ocena.stan === 'ok' ? (
              <span>
                {formatWieku(ocena.wiekMs)} (próg opóźnienia: {formatTrwania(PROG_BIEGU_MS)}).
              </span>
            ) : null}
            {ocena.stan === 'opozniony' ? (
              <>
                <span>
                  {formatWieku(ocena.wiekMs)}, a zestawienie powinno biegać co dobę (próg:{' '}
                  {formatTrwania(PROG_BIEGU_MS)}).
                </span>
                <span>
                  Historia dzienna przestała się zapisywać. Surowe zdarzenia znikają po{' '}
                  {RETENCJA_DNI} dniach, więc luka z czasem stanie się nieodwracalna.
                </span>
              </>
            ) : null}
            {ocena.stan === 'blad' ? (
              <span title={blad}>Bieg zakończył się błędem: {skrocTekst(blad, MAX_KOMUNIKAT)}</span>
            ) : null}
            {ocena.stan === 'nieustalony' ? (
              <span>Bieg nie ma zapisanego czasu zakończenia: trwa albo został przerwany.</span>
            ) : null}
          </>
        )}
      </div>
    </div>
  )
}

function KafelBezOdcisku({ diagnostyka }: { diagnostyka: Diagnostyka }) {
  const udzial = udzialBezOdcisku(diagnostyka)
  let podpis: ReactNode
  if (udzial.procent === null) {
    podpis = (
      <span>
        {udzial.suma === 0
          ? 'Brak zdarzeń z ostatnich 24 godzin, więc nie ma z czego liczyć udziału.'
          : 'Z tej odpowiedzi bazy nie da się policzyć udziału.'}
      </span>
    )
  } else {
    podpis = (
      <>
        <span>
          {formatLiczby(udzial.bez)} z {formatLiczby(udzial.suma)} zdarzeń z 24 godzin
        </span>
        {udzial.bez === 0 ? (
          <Znacznik ton="dobra">komplet</Znacznik>
        ) : (
          <Znacznik ton="uwaga">braki</Znacznik>
        )}
        <span>
          Niezerowy udział to znak awarii soli dobowej: takie zdarzenia liczą się do odsłon, ale nie
          do unikalnych ani do sesji.
        </span>
      </>
    )
  }
  return (
    <Kafel ton={udzial.bez !== null && udzial.bez > 0 ? 'uwaga' : null}>
      <KartaStat
        etykieta="Zdarzenia bez odcisku (24 h)"
        klucz="jakosc.bezOdcisku"
        wartosc={formatUdzialuBezOdcisku(udzial)}
        podpis={podpis}
      />
    </Kafel>
  )
}

function KafelNajstarsze({ iso, teraz }: { iso: string | null; teraz: number }) {
  const retencja = ocenaRetencji(iso, teraz)
  return (
    <Kafel ton={retencja.przekroczona ? 'uwaga' : null}>
      <KartaStat
        etykieta="Najstarsze zdarzenie"
        klucz="jakosc.najstarszeZdarzenie"
        wartosc={formatDnia(iso)}
        podpis={
          retencja.dni === null ? (
            <span>W bazie nie ma jeszcze żadnych zdarzeń ludzi.</span>
          ) : (
            <>
              <span>
                {formatDniTemu(retencja.dni)} (surowe zdarzenia żyją {RETENCJA_DNI} dni)
              </span>
              {retencja.przekroczona ? (
                <>
                  <Znacznik ton="uwaga">starsze niż retencja</Znacznik>
                  <span>
                    Sprzątanie nie usuwa starych zdarzeń. Sprawdź w bazie ślad biegów sprzątania.
                  </span>
                </>
              ) : null}
            </>
          )
        }
      />
    </Kafel>
  )
}

function TabelaTypow({ diagnostyka }: { diagnostyka: Diagnostyka }) {
  const wiersze = wierszeTypow(diagnostyka)
  const kolumny: KolumnaTabeli<WierszTypu>[] = [
    { id: 'typ', naglowek: 'Typ zdarzenia', naglowekWiersza: true, komorka: (w) => w.nazwa },
    {
      id: 'liczba',
      naglowek: 'Zdarzenia (24 h)',
      liczbowa: true,
      // Zero to prawdziwe zero (formatLiczby(0) = „0”); brak typu w odpowiedzi to null = „brak danych”.
      komorka: (w) => (w.liczba === null ? null : formatLiczby(w.liczba)),
    },
    {
      id: 'uwaga',
      naglowek: 'Uwaga',
      // Pusty napis, nie null: null w tej tabeli znaczy „brak danych”, a brak uwagi nim nie jest.
      komorka: (w) =>
        w.uwaga === 'cisza' ? (
          <Znacznik ton="uwaga">cisza tego typu</Znacznik>
        ) : w.uwaga === 'brak_bledow' ? (
          <Znacznik ton="dobra">brak błędów</Znacznik>
        ) : (
          ''
        ),
    },
  ]
  return (
    <div>
      <Tabela
        podpis="Liczba zdarzeń każdego typu w ostatnich 24 godzinach"
        kolumny={kolumny}
        wiersze={wiersze}
        kluczWiersza={(w) => w.typ}
      />
      <p className="panel-tabela-uwaga">
        Cisza jednego typu przy ruchu w pozostałych wskazuje, który kawałek pomiaru nie działa. Przy
        małym ruchu rzadkie typy (kliknięcia, udostępnienia, zdarzenia produktowe) mogą być zerem
        naturalnie.
      </p>
    </div>
  )
}

function TrescDiagnostyki({ diagnostyka, teraz }: { diagnostyka: Diagnostyka; teraz: number }) {
  const bezRuchu = sumaZdarzen24h(diagnostyka) === 0
  return (
    <div className="jakosc-diagnoza">
      {bezRuchu ? (
        <p className="panel-blad" role="status">
          Przez ostatnie 24 godziny pomiar nie zapisał żadnego zdarzenia. Albo nikt nie odwiedził
          serwisu, albo zapis nie działa – zanim uwierzysz w zerowy ruch, sprawdź endpoint zapisu.
        </p>
      ) : null}
      <div className="jakosc-kafle">
        <KafelOstatnieZdarzenie iso={diagnostyka.ostatnie_zdarzenie} teraz={teraz} />
        <KafelBiegu diagnostyka={diagnostyka} teraz={teraz} />
        <KafelBezOdcisku diagnostyka={diagnostyka} />
        <KartaStat
          etykieta="Dni w zestawieniu"
          klucz="jakosc.dniWZestawieniu"
          wartosc={dniWZestawieniu(diagnostyka)}
          podpis="Historia dzienna zostaje po usunięciu surowych zdarzeń."
        />
        <KafelNajstarsze iso={diagnostyka.najstarsze_zdarzenie} teraz={teraz} />
      </div>
      <h3 className="jakosc-podtytul">
        Zdarzenia według typu, ostatnie 24 godziny
        <Podpowiedz klucz="jakosc.zdarzenia24h" />
      </h3>
      <TabelaTypow diagnostyka={diagnostyka} />
    </div>
  )
}

function SekcjaDiagnostyki({ stan }: { stan: StanWidoku<Diagnostyka> }) {
  // Chwila pobrania danych jako „teraz”. Brak (niemożliwy przy danych) to NaN: funkcje wieku zwrócą
  // wtedy „brak danych”, a nie zgadną.
  const teraz = stan.pobrano ?? Number.NaN
  return (
    <Sekcja
      tytul="Diagnostyka pomiaru"
      opis="Czy pomiar w ogóle działa. Liczby z ostatnich 24 godzin, tylko ruch ludzi (roboty nie wchodzą), niezależne od okresu wybranego niżej. Wiek zdarzeń liczy się od godziny pobrania danych."
      stan={stan}
    >
      {(diagnostyka) => <TrescDiagnostyki diagnostyka={diagnostyka} teraz={teraz} />}
    </Sekcja>
  )
}

// ── Web Vitals ────────────────────────────────────────────────────────────────────────────

/**
 * Jedna komórka macierzy: wartość i liczba próbek OBOK siebie, pod nimi ocena jako kapsułka ze
 * słowem. Przy małej liczbie próbek dopisek mówi „mało próbek”, a ocena gaśnie do szarości (słowo
 * zostaje): wynik z kilku pomiarów nie ma krzyczeć na czerwono.
 */
function PomiarWitalu({ komorka }: { komorka: KomorkaWitalu }) {
  const { metryka, p75, probki, ocena, maloProbek } = komorka
  return (
    <div className="jakosc-witalu">
      <div className="jakosc-witalu-glowa">
        <span className="jakosc-witalu-wartosc">{formatWitalu(metryka, p75)}</span>
        <span className="jakosc-witalu-probki" data-malo={maloProbek ? '' : undefined}>
          {maloProbek ? `mało próbek: ${formatLiczby(probki)}` : liczbaProbek(probki)}
        </span>
      </div>
      {ocena ? (
        <Znacznik ton={tonOceny(ocena, maloProbek)}>{ETYKIETA_OCENY[ocena]}</Znacznik>
      ) : null}
    </div>
  )
}

function TabelaWitali({ wiersze }: { wiersze: readonly WierszWitalu[] }) {
  const uklad = ukladWitali(wiersze)
  const kolumny: KolumnaTabeli<WierszWitali>[] = [
    {
      id: 'ekran',
      naglowek: 'Ekran wejścia',
      naglowekWiersza: true,
      komorka: (w) => nazwa(NAZWA_EKRANU, w.ekran),
    },
    ...METRYKI_WITALI.map(
      (metryka): KolumnaTabeli<WierszWitali> => ({
        id: metryka,
        naglowek: metryka.toUpperCase(),
        klucz: KLUCZ_WITALU[metryka],
        komorka: (w) => {
          const komorka = w.komorki[metryka]
          // Brak pomiaru tej metryki na tym ekranie: null = szare „brak danych”, nigdy zero.
          return komorka === null ? null : <PomiarWitalu komorka={komorka} />
        },
      }),
    ),
  ]
  const bezPomiarow = uklad.bezPomiarow.map((ekran) => nazwa(NAZWA_EKRANU, ekran))
  const nieznane = uklad.nieznane.map(
    (m) => `${m.metryka} na ekranie „${nazwa(NAZWA_EKRANU, m.ekran)}” (${liczbaProbek(m.probki)})`,
  )

  return (
    <div>
      <Tabela
        podpis="p75 według ekranu wejścia i metryki; mniej znaczy lepiej w każdej kolumnie"
        kolumny={kolumny}
        wiersze={uklad.wiersze}
        kluczWiersza={(w) => w.ekran}
        pusto={
          <BrakDanych
            wariant="blok"
            opis="Odpowiedź bazy nie zawierała czytelnych pomiarów szybkości."
          />
        }
      />
      <p className="panel-tabela-uwaga">
        Liczba obok wartości to próbki
        <Podpowiedz klucz="jakosc.probki" />: pomiary, nie osoby. Szara ocena i dopisek „mało
        próbek” oznaczają mniej niż {MIN_PROBEK} pomiarów, czyli wynik orientacyjny.
      </p>
      <p className="panel-tabela-uwaga">
        Pomiary są przypisane do ekranu wejścia (jak w CrUX, raporcie Google z prawdziwych
        użytkowników): wszystko, co zmierzono w trakcie wizyty, trafia do ekranu, na którym ta
        wizyta się zaczęła. Ekran, na który rzadko wchodzi się z zewnątrz, ma więc mało próbek albo
        wcale. INP jest uproszczone (najdłuższa interakcja wizyty, a nie 98. percentyl), a CLS
        mierzą tylko przeglądarki, które udostępniają przesunięcia układu (głównie Chromium).
      </p>
      {bezPomiarow.length > 0 ? (
        <p className="panel-tabela-uwaga">
          Ekrany bez pomiarów w tym okresie: {bezPomiarow.join(', ')}.
        </p>
      ) : null}
      {nieznane.length > 0 ? (
        <p className="panel-tabela-uwaga">
          Baza zwróciła też metryki spoza tabeli: {nieznane.join('; ')}.
        </p>
      ) : null}
    </div>
  )
}

function SekcjaWitali({ okres }: { okres: Okres }) {
  const witale = useWidok('witale', { p_dni: okres })
  return (
    <Sekcja
      tytul="Web Vitals (p75 na ekran)"
      klucz="jakosc.witaleP75"
      opis={`Ostatnie ${okres} dni. Mniej znaczy lepiej w każdej kolumnie. Progi Google: dobra do pierwszej liczby włącznie, słaba powyżej drugiej, pomiędzy nimi do poprawy. ${opisProgowWitali()}.`}
      stan={witale}
      pusto={(wiersze) => wiersze.length === 0}
      pusteInfo="W tym okresie nie zapisano żadnego pomiaru szybkości. Przeglądarka wysyła go przy opuszczeniu strony, więc pomiary pojawiają się po pierwszych zakończonych wizytach. Jeśli ruch jest, a tu pusto, sprawdź wiersz „Pomiary szybkości” w diagnostyce wyżej."
    >
      {(wiersze) => <TabelaWitali wiersze={wiersze} />}
    </Sekcja>
  )
}

// ── Błędy klienta ─────────────────────────────────────────────────────────────────────────

function TrescBledow({
  wiersze,
  okres,
  diagnostyka,
}: {
  wiersze: readonly WierszBledu[]
  okres: Okres
  diagnostyka: Diagnostyka | null
}) {
  const widok = wierszeBledow(wiersze)
  // Pusta lista to dobra wiadomość TYLKO przy dowodzie, że pomiar żyje (patrz `werdyktBledow`);
  // bez dowodu jest szarym „nie wiadomo”, nie zielonym uspokojeniem.
  const werdykt = werdyktBledow(widok.length, diagnostyka)

  if (werdykt === 'czysto') {
    return (
      <p className="jakosc-bez-bledow">
        <Znacznik ton="dobra">brak błędów</Znacznik>
        <span>
          Przeglądarki nie zgłosiły żadnego błędu w ostatnich {okres} dniach, a pomiar działa (w
          ostatnich 24 godzinach są odsłony i pomiary szybkości).
        </span>
      </p>
    )
  }
  if (werdykt === 'niepewne') {
    return (
      <BrakDanych
        wariant="blok"
        tekst="brak danych o błędach"
        opis="Lista jest pusta, ale w ostatnich 24 godzinach brakuje odsłon albo pomiarów szybkości, więc nie da się odróżnić braku błędów od niedziałającego zbierania. Sprawdź diagnostykę wyżej."
      />
    )
  }

  const kolumny: KolumnaTabeli<WierszBleduWidok>[] = [
    {
      id: 'komunikat',
      naglowek: 'Komunikat',
      naglowekWiersza: true,
      komorka: (w) => (
        <span className="jakosc-komunikat" title={w.pelny ?? undefined}>
          {w.komunikat}
        </span>
      ),
    },
    {
      id: 'ekran',
      naglowek: 'Ekran',
      komorka: (w) => <span className="jakosc-krotkie">{nazwa(NAZWA_EKRANU, w.ekran)}</span>,
    },
    {
      id: 'ile',
      naglowek: 'Wystąpienia',
      liczbowa: true,
      sortowana: 'malejaco',
      komorka: (w) => (w.ile === null ? null : formatLiczby(w.ile)),
    },
    {
      id: 'ostatnio',
      naglowek: 'Ostatnio',
      komorka: (w) =>
        w.ostatnio === null ? null : (
          <time className="jakosc-krotkie" dateTime={w.ostatnio}>
            {formatChwili(w.ostatnio)}
          </time>
        ),
    },
  ]
  return (
    <div>
      <Tabela
        podpis="Błędy klienta od najczęstszych (malejąco wg liczby wystąpień)"
        kolumny={kolumny}
        wiersze={widok}
        kluczWiersza={(w) => w.klucz}
        przewijana={widok.length > 10}
      />
      {widok.length >= LIMIT_BLEDOW ? (
        <p className="panel-tabela-uwaga">
          Pokazano {LIMIT_BLEDOW} najczęstszych komunikatów; rzadsze są pominięte.
        </p>
      ) : null}
    </div>
  )
}

function SekcjaBledow({ okres, diagnostyka }: { okres: Okres; diagnostyka: Diagnostyka | null }) {
  const bledy = useWidok('bledy', { p_dni: okres, p_limit: LIMIT_BLEDOW })
  return (
    <Sekcja
      tytul="Błędy klienta"
      klucz="jakosc.bledy"
      opis={`Ostatnie ${okres} dni. Nieprzechwycone wyjątki i odrzucone obietnice z przeglądarek odwiedzających, od najczęstszych. Mniej znaczy lepiej. Treść pochodzi od klientów, więc jest pokazywana jako zwykły, skrócony tekst.`}
      stan={bledy}
    >
      {(wiersze) => <TrescBledow wiersze={wiersze} okres={okres} diagnostyka={diagnostyka} />}
    </Sekcja>
  )
}

// ── Zakładka ──────────────────────────────────────────────────────────────────────────────

export function Jakosc() {
  const [okres, setOkres] = useState<Okres>(OKRES_DOMYSLNY)
  // Diagnostyka służy dwóm sekcjom (kafle i wyjaśnienie pustej listy błędów); jeden widok, jedno pytanie.
  const diagnostyka = useWidok('diagnostyka')

  return (
    <div className="panel-stos">
      <SekcjaDiagnostyki stan={diagnostyka} />
      <div className="jakosc-okres">
        <span className="jakosc-okres-etykieta">Okres dla Web Vitals i błędów klienta</span>
        <Segmenty legenda="Okres" opcje={OKRESY} wartosc={okres} naZmiane={setOkres} />
        <p className="jakosc-okres-opis">
          Diagnostyka pomiaru powyżej zawsze pokazuje ostatnie 24 godziny, niezależnie od okresu.
        </p>
      </div>
      <SekcjaWitali okres={okres} />
      <SekcjaBledow okres={okres} diagnostyka={diagnostyka.dane} />
    </div>
  )
}
