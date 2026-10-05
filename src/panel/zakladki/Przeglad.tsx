// Zakładka „Przegląd” (T054, Historia 3, FR-030): czy serwis żyje. Kafle ludzi i odsłon, wykres dobowy
// (30 dób) i godzinowy (48 godzin), podział ludzie i boty oraz crawlery AI.
//
// Widoki: `przeglad` (kafle i pasek ludzie/boty), `seria_dzienna`, `seria_godzinowa`, `boty_ai`.
// Zakładka niczego nie liczy sama: wiersze wykresów, wartości kafli, podpisy i udziały wyprowadza
// `przeglad-dane.ts` (czyste funkcje z testami), a tu zostaje układ. Wstęp, pasek zakładek i „Odśwież”
// rysuje `EkranPanel`.
//
// Decyzje, które łatwo przeoczyć:
//  - OKNA SĄ STAŁE, bez przełącznika okresu. FR-030 podaje je z góry (24 h / 7 / 30 dni, 30 dób,
//    48 godzin), a szczyty liczą się zawsze z 30 dni (hasło `przeglad.szczytDzien`). Przełącznik
//    działałby na jednym wykresie i rozjeżdżał go z kaflami obok.
//  - BRAK DANYCH TO NIE ZERO (FR-040): zero w ciszy całego okna i doby przed początkiem pomiaru są
//    szarym „brak danych”, a wykresy pokazują wtedy pustą oś z napisem. Reguła w `przeglad-dane.ts`.
//  - ZMIANA TYLKO MIĘDZY PEŁNYMI DOBAMI. Dzisiejsza doba jest niepełna, więc „dziś” nie jest
//    porównywane z „wczoraj” (hasło `przeglad.unikalniDzis` mówi to samo); kafel „wczoraj” podpisuje
//    zmianę wobec przedwczoraj.
//  - TA SAMA LICZBA DWA RAZY: odsłony ludzi z 24 h stoją na kaflu i jako część paska (wg kontraktu
//    `ludzie_24h` jest tą samą liczbą co `odslony_24h`), więc pasek leży pod wykresami, poza kadrem
//    kafli, a podpisy kafli i wykresów nie powtarzają żadnej liczby.
//  - OSTATNI PUNKT WYKRESÓW JEST NIEPEŁNY (trwająca doba i godzina), co mówi opis sekcji, żeby
//    końcowy spadek nie wyglądał na załamanie ruchu.
//  - PIERWSZA DOBA POMIARU: jeden punkt nie tworzy linii (`WykresSerii` rysuje linie bez kropek), więc
//    wykres dobowy wygląda na pusty mimo danych. Opis sekcji mówi wtedy wprost, że to nie awaria.
//  - W TABELI „CRAWLERY AI” są tylko roboty klasy `ai` (hasło `przeglad.crawleryAi` i FR-030);
//    pozostałe roboty z `boty_ai` leżą pod rozwijanym „Pokaż pozostałe roboty”, bo pasek „ludzie i
//    boty” liczy wszystkie.
//  - Rodzina robota pochodzi od dowolnego klienta (nagłówek przeglądarki): tylko jako treść React.
import { formatLiczby } from '@/panel/arytmetyka'
import { dzisWarszawy } from '@/panel/czas'
import { useWidok } from '@/panel/dane'
import { BrakDanych } from '@/panel/skladniki/BrakDanych'
import { KartaStat } from '@/panel/skladniki/KartaStat'
import { PasekUdzialow } from '@/panel/skladniki/PasekUdzialow'
import { Sekcja } from '@/panel/skladniki/Sekcja'
import { type KolumnaTabeli, Tabela } from '@/panel/skladniki/Tabela'
import { WykresDzienny } from '@/panel/skladniki/WykresDzienny'
import { WykresGodzinowy } from '@/panel/skladniki/WykresGodzinowy'
import type { KluczSerii } from '@/panel/skladniki/WykresSerii'
import type { WierszBotaAi } from '@/panel/typy'
import {
  DNI_WYKRESU,
  GODZIN_WYKRESU,
  type KafelRuchu,
  kafleRuchu,
  opisPokrycia,
  pomiarZSerii,
  punktyGodzinowe,
  segmentyLudzieBoty,
  uwagaPierwszejDoby,
  uzupelnijSerieDzienna,
  type WierszRobota,
  wierszeCrawlerowAi,
  wierszePozostalychRobotow,
  zmianaWobecPoprzedniejDoby,
} from '@/panel/zakladki/przeglad-dane'

/** Serie obu wykresów: odsłony ludzi, unikalni i odsłony botów (hasła `przeglad.wykres*`). */
const SERIE_RUCHU: readonly KluczSerii[] = ['odslony', 'unikalni', 'boty']

const OPIS_WYKRESU_DOBOWEGO =
  'Odsłony ludzi, unikalni i odsłony botów w kolejnych dobach warszawskich. Ostatni punkt to dzisiejsza, niepełna doba, więc zwykle leży niżej.'

const KOLUMNA_RODZINY: KolumnaTabeli<WierszRobota> = {
  id: 'rodzina',
  naglowek: 'Rodzina',
  naglowekWiersza: true,
  komorka: (w) => (
    <span className="panel-tabela-etykieta" title={w.rodzina}>
      {w.rodzina}
    </span>
  ),
}
const KOLUMNA_KLASY: KolumnaTabeli<WierszRobota> = {
  id: 'klasa',
  naglowek: 'Klasa',
  komorka: (w) => w.klasa,
}
const KOLUMNA_ODSLON: KolumnaTabeli<WierszRobota> = {
  id: 'odslony',
  naglowek: 'Odsłony',
  liczbowa: true,
  sortowana: 'malejaco',
  komorka: (w) => formatLiczby(w.odslony),
}
const KOLUMNA_WIZYTY: KolumnaTabeli<WierszRobota> = {
  id: 'ostatnia',
  naglowek: 'Ostatnia wizyta',
  liczbowa: true,
  komorka: (w) => w.ostatnia,
}
const KOLUMNY_AI: readonly KolumnaTabeli<WierszRobota>[] = [
  KOLUMNA_RODZINY,
  KOLUMNA_ODSLON,
  KOLUMNA_WIZYTY,
]
const KOLUMNY_INNYCH: readonly KolumnaTabeli<WierszRobota>[] = [
  KOLUMNA_RODZINY,
  KOLUMNA_KLASY,
  KOLUMNA_ODSLON,
  KOLUMNA_WIZYTY,
]

function SiatkaKafli({ kafle }: { kafle: readonly KafelRuchu[] }) {
  return (
    <div className="panel-siatka">
      {kafle.map((k) => (
        <KartaStat
          key={k.klucz}
          etykieta={k.etykieta}
          wartosc={k.wartosc}
          miejsca={k.miejsca}
          podpis={k.podpis}
          klucz={k.klucz}
        />
      ))}
    </div>
  )
}

function TabeleRobotow({ wiersze }: { wiersze: readonly WierszBotaAi[] }) {
  const ai = wierszeCrawlerowAi(wiersze)
  const inne = wierszePozostalychRobotow(wiersze)
  return (
    <>
      <Tabela
        podpis={`Roboty modeli językowych, ostatnie ${DNI_WYKRESU} dni`}
        kolumny={KOLUMNY_AI}
        wiersze={ai}
        kluczWiersza={(w) => w.klucz}
        pusto={
          <BrakDanych
            wariant="blok"
            opis={`Żaden crawler AI nie wysłał zdarzeń pomiaru w ostatnich ${DNI_WYKRESU} dniach. To nie znaczy, że go nie było: większość pobiera sam HTML bez skryptów, więc tu go nie widać.`}
          />
        }
      />
      {inne.length > 0 ? (
        <details className="panel-szczegoly">
          <summary>Pokaż pozostałe roboty ({inne.length})</summary>
          <Tabela
            podpis={`Pozostałe roboty (wyszukiwarki, podglądy linków, narzędzia), ostatnie ${DNI_WYKRESU} dni`}
            kolumny={KOLUMNY_INNYCH}
            wiersze={inne}
            kluczWiersza={(w) => w.klucz}
            przewijana
          />
        </details>
      ) : null}
    </>
  )
}

export function Przeglad() {
  const przeglad = useWidok('przeglad')
  const dzienna = useWidok('seria_dzienna', { p_dni: DNI_WYKRESU })
  const godzinowa = useWidok('seria_godzinowa', { p_godzin: GODZIN_WYKRESU })
  const boty = useWidok('boty_ai', { p_dni: DNI_WYKRESU })

  // „Dziś” liczymy z chwili pobrania danych, nie z zegara w chwili rysowania: kafle i seria opisują
  // dobę, w której baza je policzyła. Po północy, a przed odświeżeniem, dane nadal są z wczorajszej
  // doby, więc „dziś” ma pozostać tamtą dobą, a nie zacząć się rozjeżdżać z liczbami.
  const dzisKafli = przeglad.pobrano === null ? null : dzisWarszawy(przeglad.pobrano)
  const dzisSerii = dzienna.pobrano === null ? '' : dzisWarszawy(dzienna.pobrano)

  const pomiar = pomiarZSerii(dzienna.dane)
  const seriaDzienna =
    dzienna.dane === null ? null : uzupelnijSerieDzienna(dzienna.dane, DNI_WYKRESU, dzisSerii)
  const zmianaWczoraj = seriaDzienna === null ? null : zmianaWobecPoprzedniejDoby(seriaDzienna)
  const kafle =
    przeglad.dane === null
      ? null
      : kafleRuchu({ przeglad: przeglad.dane, pomiar, dzis: dzisKafli, zmianaWczoraj })
  const pokrycie = opisPokrycia(pomiar, dzisKafli, kafle)
  const uwagaDoby = uwagaPierwszejDoby(seriaDzienna)

  return (
    <div className="panel-stos">
      {pokrycie ? (
        <p className="panel-sekcja-opis" role="note">
          {pokrycie}
        </p>
      ) : null}

      <Sekcja
        tytul="Ludzie"
        opis="Przybliżenie liczby osób w dobie warszawskiej, bez botów. Doby nie sumują się do osób, bo odcisk zmienia się o północy."
        stan={przeglad}
      >
        {() => <SiatkaKafli kafle={kafle?.ludzie ?? []} />}
      </Sekcja>

      <Sekcja
        tytul="Odsłony"
        opis="Ile razy ludzie otworzyli ekran serwisu, bez botów. Odsłony wolno sumować między dobami; szczyty liczą się zawsze z 30 dni."
        stan={przeglad}
      >
        {() => <SiatkaKafli kafle={kafle?.odslony ?? []} />}
      </Sekcja>

      <div className="panel-kolumny">
        <Sekcja
          tytul={`Ruch w ostatnich ${DNI_WYKRESU} dobach`}
          klucz="przeglad.wykresDzienny"
          opis={`${OPIS_WYKRESU_DOBOWEGO}${uwagaDoby ? ` ${uwagaDoby}` : ''}`}
          stan={dzienna}
        >
          {() => (
            <WykresDzienny
              dane={seriaDzienna ?? []}
              serie={SERIE_RUCHU}
              tytul="Odsłony, unikalni i boty na dobę"
            />
          )}
        </Sekcja>

        <Sekcja
          tytul={`Ruch w ostatnich ${GODZIN_WYKRESU} godzinach`}
          klucz="przeglad.wykresGodzinowy"
          opis="Odsłony ludzi, unikalni i odsłony botów w kolejnych godzinach (czas warszawski). Ostatni punkt to trwająca godzina, więc zwykle leży niżej."
          stan={godzinowa}
        >
          {(wiersze) => (
            <WykresGodzinowy
              dane={punktyGodzinowe(wiersze, pomiar)}
              serie={SERIE_RUCHU}
              tytul="Odsłony, unikalni i boty na godzinę"
            />
          )}
        </Sekcja>
      </div>

      <div className="panel-kolumny">
        <Sekcja
          tytul="Ludzie i boty (24 h)"
          klucz="przeglad.ludzieBoty"
          opis="Odsłony z ostatnich 24 godzin według tego, kto je wysłał. Udział botów to dolna granica: robot udający przeglądarkę jest policzony jako człowiek."
          stan={przeglad}
        >
          {(p) => (
            <PasekUdzialow
              segmenty={segmentyLudzieBoty(p)}
              jednostka="odsłon"
              opis="Ludzie i boty, ostatnie 24 godziny"
            />
          )}
        </Sekcja>

        <Sekcja
          tytul="Crawlery AI"
          klucz="przeglad.crawleryAi"
          opis="Roboty modeli językowych rozpoznane po przeglądarce. Widać tylko te, które uruchomiły skrypty strony."
          stan={boty}
        >
          {(wiersze) => <TabeleRobotow wiersze={wiersze} />}
        </Sekcja>
      </div>
    </div>
  )
}
