import { Fragment } from 'react'
import { KATEGORIE, type WskaznikMeta } from '@/kontrakty'
import { useDane } from '@/wynik/dane'
import { PROGI_LITER, WAGA_MAX, type WskaznikPrzygotowany } from '@/wynik/silnik'
import './metoda.css'

const ATRYBUCJA_MSIP = 'Gmina Miejska Kraków, Portal MSIP Obserwatorium'
const ATRYBUCJA_OSM = '© OpenStreetMap contributors'
const LICENCJA_OSM = 'ODbL'
const URL_OSM = 'https://www.openstreetmap.org/copyright'

const liczbaPL = new Intl.NumberFormat('pl-PL')

/** Źródło z MSIP rozpoznajemy po nazwie, adresie albo licencji – nowa warstwa z ETL łapie się sama. */
function zMsip(meta: WskaznikMeta): boolean {
  return meta.zrodla.some((z) => /msip/i.test(`${z.nazwa} ${z.url} ${z.licencja}`))
}

function zOsm(meta: WskaznikMeta): boolean {
  return meta.zrodla.some((z) => /openstreetmap|\bosm\b/i.test(`${z.nazwa} ${z.url}`))
}

function unikalne(teksty: string[]): string[] {
  return [...new Set(teksty.filter((t) => t.trim() !== ''))]
}

function jestLinkiem(url: string): boolean {
  return /^https?:\/\//.test(url)
}

/** Licencja bywa zdaniem z adresem URL w środku – adres zamieniamy na link. */
function TekstZLinkami({ tekst }: { tekst: string }) {
  const czesci = tekst.split(/(https?:\/\/[^\s)]+)/)
  return (
    <>
      {czesci.map((c, i) =>
        jestLinkiem(c) ? (
          <a key={i} href={c} target="_blank" rel="noopener noreferrer">
            {c}
          </a>
        ) : (
          <Fragment key={i}>{c}</Fragment>
        ),
      )}
    </>
  )
}

function rozdzielczoscOpis(meta: WskaznikMeta): string {
  const nazwy: Record<WskaznikMeta['rozdzielczosc'], string> = {
    adres: 'adres',
    budynek: 'budynek',
    heks: 'heks',
    siatka: 'siatka',
    rejon: 'rejon',
    gmina: 'gmina',
    powiat: 'powiat',
  }
  const baza = nazwy[meta.rozdzielczosc]
  return meta.rozmiar ? `${baza}: ${meta.rozmiar}` : baza
}

interface Pokrycie {
  zDanymi: number
  wszystkich: number
}

function pokrycie(w: WskaznikPrzygotowany): Pokrycie {
  let zDanymi = 0
  for (const v of w.wartosci) if (v !== null && !Number.isNaN(v)) zDanymi++
  return { zDanymi, wszystkich: w.wartosci.length }
}

function procent(p: Pokrycie): string {
  if (p.wszystkich === 0) return '–'
  const u = (100 * p.zDanymi) / p.wszystkich
  // Zaokrąglenie nie może udawać pełnego pokrycia.
  const tekst = u > 99 && u < 100 ? '99' : u > 0 && u < 1 ? '<1' : String(Math.round(u))
  return `${tekst}%`
}

function WierszWarstwy({ w }: { w: WskaznikPrzygotowany }) {
  const m = w.meta
  const p = pokrycie(w)
  const licencje = unikalne(m.zrodla.map((z) => z.licencja))
  const daty = unikalne(m.zrodla.map((z) => z.dataDanych))
  const msip = zMsip(m)
  const osm = zOsm(m)
  return (
    <tr>
      <th scope="row">
        {m.nazwa}
        <span className="met-id mono">{m.id}</span>
        {m.atrapa && <span className="atrapa met-atrapa">dane przykładowe</span>}
      </th>
      <td>{KATEGORIE[m.kategoria]}</td>
      <td>
        <ul className="met-lista-prosta">
          {m.zrodla.map((z) => (
            <li key={`${z.nazwa}|${z.url}`}>
              {jestLinkiem(z.url) ? (
                <a href={z.url} target="_blank" rel="noopener noreferrer">
                  {z.nazwa}
                </a>
              ) : (
                z.nazwa
              )}
            </li>
          ))}
        </ul>
      </td>
      <td>
        {licencje.map((l) => (
          <p key={l} className="met-komorka-akapit">
            <TekstZLinkami tekst={l === '-' ? 'brak (dane wymyślone)' : l} />
          </p>
        ))}
        {msip && <p className="met-atrybucja">{ATRYBUCJA_MSIP}</p>}
        {osm && (
          <p className="met-atrybucja">
            <a href={URL_OSM} target="_blank" rel="noopener noreferrer">
              {ATRYBUCJA_OSM}
            </a>{' '}
            ({LICENCJA_OSM})
          </p>
        )}
      </td>
      <td>{daty.join(', ')}</td>
      <td>{rozdzielczoscOpis(m)}</td>
      <td className="met-liczby">
        {w.niedostepny ? (
          <span className="met-niedostepna">warstwa niedostępna</span>
        ) : (
          <>
            <strong>{procent(p)}</strong>
            <span className="met-drobne">
              {liczbaPL.format(p.zDanymi)} z {liczbaPL.format(p.wszystkich)}
            </span>
          </>
        )}
      </td>
    </tr>
  )
}

function TabelaZrodel() {
  const dane = useDane()
  if (dane.stan === 'ladowanie') return <p className="met-stan">Wczytuję listę źródeł…</p>
  if (dane.stan === 'blad') {
    return (
      <p className="met-stan" role="alert">
        Nie udało się wczytać listy źródeł: {dane.blad}
      </p>
    )
  }
  return (
    <div
      className="met-tabela-ramka"
      tabIndex={0}
      role="region"
      aria-label="Tabela źródeł danych, przewijana poziomo"
    >
      <table className="met-tabela">
        <caption className="sr-only">Źródła danych każdej warstwy</caption>
        <thead>
          <tr>
            <th scope="col">Warstwa</th>
            <th scope="col">Kategoria</th>
            <th scope="col">Źródło</th>
            <th scope="col">Licencja i atrybucja</th>
            <th scope="col">Stan danych</th>
            <th scope="col">Rozdzielczość</th>
            <th scope="col">Adresy z danymi</th>
          </tr>
        </thead>
        <tbody>
          {dane.wskazniki.map((w) => (
            <WierszWarstwy key={w.meta.id} w={w} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Ograniczenia() {
  const dane = useDane()
  if (dane.stan !== 'gotowe') return null
  const atrapy = dane.wskazniki.filter((w) => w.meta.atrapa)
  const luki = dane.wskazniki
    .filter((w) => !w.meta.atrapa && !w.niedostepny)
    .map((w) => ({ w, p: pokrycie(w) }))
    .filter(({ p }) => p.wszystkich > 0 && p.zDanymi < p.wszystkich)
  const niedostepne = dane.wskazniki.filter((w) => w.niedostepny)
  const naKarcie = dane.wskazniki.filter((w) => !w.meta.atrapa)
  return (
    <>
      <ul className="met-punkty">
        {atrapy.length > 0 && (
          <li>
            <strong>Dane przykładowe.</strong> Te warstwy zawierają wymyślone liczby. Służą do
            pokazu i wchodzą do wyniku tak jak prawdziwe, więc wynik jest orientacyjny:{' '}
            {atrapy.map((w) => w.meta.nazwa).join('; ')}.
          </li>
        )}
        {luki.length > 0 && (
          <li>
            <strong>Luki w pokryciu.</strong> Rejestry miejskie obejmują Kraków. Dla gmin obwarzanka
            i dla adresów poza zasięgiem warstwy brakuje danych. Pokazujemy to jako szarą kategorię
            i niższą pewność, nie jako zero. Warstwy z lukami:{' '}
            {luki.map(({ w, p }) => `${w.meta.nazwa} (${procent(p)})`).join('; ')}.
          </li>
        )}
        {niedostepne.length > 0 && (
          <li>
            <strong>Warstwy niedostępne teraz.</strong> Plik się nie wczytał albo jest liczony dla
            innej wersji adresów: {niedostepne.map((w) => w.meta.nazwa).join('; ')}. Obniżają
            pewność wyniku, ale nie jego wartość.
          </li>
        )}
        <li>
          <strong>Odległości to linia prosta.</strong> Nie liczymy długości dojścia ulicami. Rzeka,
          tory albo ogrodzenie mogą wydłużyć drogę. Kierunek „im bliżej, tym lepiej" nie widzi tych
          przeszkód.
        </li>
        <li>
          <strong>Wynik nie jest wyceną ani poradą.</strong> To jedna liczba z rejestrów publicznych
          i Twoich wag. Nie obejmuje tego, co widać tylko na miejscu: sąsiadów, hałasu sąsiedniego
          lokalu, stanu budynku.
        </li>
      </ul>
      <h3 className="met-h3">Zastrzeżenia opisane przy każdej warstwie</h3>
      <p className="met-lead">
        Ta lista pochodzi z opisu warstwy w manifeście. Atrapy pomijamy, bo ich opis nie mówi nic o
        prawdziwych danych.
      </p>
      <dl className="met-zastrzezenia">
        {naKarcie.map((w) => (
          <Fragment key={w.meta.id}>
            <dt>{w.meta.nazwa}</dt>
            <dd>{w.meta.opis}</dd>
          </Fragment>
        ))}
      </dl>
    </>
  )
}

export function Metoda() {
  return (
    <main className="met">
      <header className="met-wstep">
        <p className="etykieta-sekcji">Metoda i źródła</p>
        <h1>Skąd bierze się wynik adresu</h1>
        <p className="met-lead">
          adresscore łączy rejestry publiczne w jedną ocenę od 0 do 100 i literę od A do G. Ta
          strona pokazuje, jak liczymy, skąd mamy dane i czego jeszcze nie wiemy.
        </p>
        <nav aria-label="Spis treści" className="met-spis">
          <a href="#met-jak">Jak liczymy</a>
          <a href="#met-zrodla">Źródła</a>
          <a href="#met-etyka">Etyka</a>
          <a href="#met-ograniczenia">Ograniczenia</a>
        </nav>
      </header>

      <section id="met-jak" aria-labelledby="met-jak-h" className="met-sekcja">
        <h2 id="met-jak-h">Jak liczymy</h2>
        <ol className="met-kroki">
          <li>
            <h3>1. Mierzymy</h3>
            <p>
              Każda warstwa ma surowy pomiar w swojej jednostce: decybele, metry, liczba odjazdów na
              godzinę. Brak pomiaru zapisujemy jako brak danych.
            </p>
          </li>
          <li>
            <h3>2. Zamieniamy pomiar na ocenę 0–100</h3>
            <p>
              Warstwy bez normy oceniamy według miejsca pomiaru w rozkładzie adresów z danymi:
              mediana daje 50 punktów, a wartości na krańcach 0 i 100. Remisy dostają tę samą ocenę.
              W warstwach z normą oraz prostych klasach, takich jak strefy 0/1, używamy skali
              liniowej. Bez podanego zakresu bierzemy przedział od 5. do 95. percentyla.
            </p>
            <p>
              Kierunek mówi, co jest lepsze. „Mniej lepiej" daje 100 przy najniższej wartości,
              „więcej lepiej" przy najwyższej. Każdy kierunek możesz zmienić.
            </p>
            <p>
              Jeśli przepis albo wytyczne podają normę, norma leży w środku skali i daje ocenę 50.
              Przekroczenie normy zawsze daje mniej niż 50.
            </p>
          </li>
          <li>
            <h3>3. Ustawiasz wagi</h3>
            <p>
              Każdej warstwie nadajesz wagę od 0 do {WAGA_MAX}. Waga 0 wyłącza warstwę. Możesz
              wybrać gotowy profil albo ustawić wagi sam. Wagi i kierunki zapisują się w linku, więc
              możesz go komuś wysłać.
            </p>
          </li>
          <li>
            <h3>4. Liczymy średnią ważoną z warstw, które mają dane</h3>
            <p>
              Wynik to suma ocen pomnożonych przez wagi, podzielona przez sumę wag. Do sumy wchodzą
              tylko warstwy z danymi pod tym adresem. Waga warstwy bez danych nie ciągnie wyniku w
              dół.
            </p>
          </li>
          <li>
            <h3>5. Podajemy pewność</h3>
            <p>
              Pewność to udział wag warstw z danymi w wadze wszystkich warstw, które liczysz. Gdy
              dane są pod każdą warstwą, pewność wynosi 100%. Gdy brakuje połowy wag, wynosi 50%.
              Warstwa, której plik się nie wczytał, też obniża pewność.
            </p>
          </li>
          <li>
            <h3>6. Przypisujemy literę</h3>
            <p>Litera zależy od wyniku.</p>
            <table className="met-progi">
              <caption className="sr-only">Progi liter</caption>
              <thead>
                <tr>
                  <th scope="col">Litera</th>
                  <th scope="col">Wynik</th>
                </tr>
              </thead>
              <tbody>
                {PROGI_LITER.map(([litera, prog], i) => {
                  const wyzszy = i === 0 ? null : PROGI_LITER[i - 1]?.[1]
                  return (
                    <tr key={litera}>
                      <th scope="row">{litera}</th>
                      <td>{wyzszy ? `od ${prog} do poniżej ${wyzszy}` : `od ${prog}`}</td>
                    </tr>
                  )
                })}
                <tr>
                  <th scope="row">G</th>
                  <td>poniżej {PROGI_LITER[PROGI_LITER.length - 1]?.[1]}</td>
                </tr>
              </tbody>
            </table>
          </li>
        </ol>
        <div className="met-ramka">
          <h3 className="met-h3">Dwie zasady, które nie mają wyjątków</h3>
          <ul className="met-punkty">
            <li>
              <strong>Brak danych to szary, nigdy zero.</strong> Adres bez danych nie dostaje kary.
              Kategoria bez danych jest szara, a wynik pokazuje niższą pewność.
            </li>
            <li>
              <strong>Kontekst nie wpływa na wynik.</strong> Kategoria „{KATEGORIE.kontekst}"
              pokazuje fakty, na przykład ceny. Nie wchodzi do średniej, nawet jeśli nadasz jej
              wagę.
            </li>
          </ul>
        </div>
        <p className="met-lead">
          Na mapie liczymy średnią wyników adresów w każdym heksie (komórka siatki H3 o boku około
          65 m). Heks, w którym żaden adres nie ma wyniku, jest szary.
        </p>
      </section>

      <section id="met-zrodla" aria-labelledby="met-zrodla-h" className="met-sekcja">
        <h2 id="met-zrodla-h">Źródła</h2>
        <p className="met-lead">
          Tabela powstaje z manifestu danych aplikacji. Nowa warstwa pojawia się tu sama, razem ze
          źródłem, licencją i datą. Kolumna „Adresy z danymi" pokazuje, dla ilu adresów warstwa ma
          wartość.
        </p>
        <TabelaZrodel />
        <div className="met-atrybucje">
          <h3 className="met-h3">Atrybucje</h3>
          <ul className="met-punkty">
            <li>
              Dane z Portalu MSIP: <strong>{ATRYBUCJA_MSIP}</strong>. Korzystamy z nich na zasadach
              regulaminu MSIP. Regulamin zabrania ciągłego pośredniczenia w usługach miasta, więc
              liczymy dane jednorazowo i serwujemy jako pliki.
            </li>
            <li>
              Podkład mapy i dane z OpenStreetMap:{' '}
              <a href={URL_OSM} target="_blank" rel="noopener noreferrer">
                {ATRYBUCJA_OSM}
              </a>
              , licencja {LICENCJA_OSM}.
            </li>
          </ul>
        </div>
      </section>

      <section id="met-etyka" aria-labelledby="met-etyka-h" className="met-sekcja">
        <h2 id="met-etyka-h">Etyka</h2>
        <p className="met-lead">
          Ocena adresu może zaszkodzić. Niska liczba obniża ceny, a wysoka podnosi czynsze i
          przyspiesza gentryfikację. Znamy to ryzyko i odpowiadamy na nie w projekcie.
        </p>
        <dl className="met-etyka">
          <dt>Bez przestępczości per adres</dt>
          <dd>
            Nie oceniamy adresów według przestępczości. Takie liczby piętnują biedniejsze osiedla.
            Jeśli dodamy tę kategorię, to najwyżej na poziomie gminy albo komendy. Kategoria „
            {KATEGORIE.bezpieczenstwo}" dotyczy dziś ryzyk środowiskowych, jak powódź.
          </dd>
          <dt>Inwestycje i koszty obok jakości</dt>
          <dd>
            Pokazujemy nie tylko, jak jest w okolicy, ale też co się w niej buduje. Kategoria „
            {KATEGORIE.spolecznosc}" zawiera na przykład pozwolenia na budowę w promieniu 500 m.
            Okolica ze słabym wynikiem i dużymi inwestycjami wygląda inaczej niż okolica bez zmian.
          </dd>
          <dt>„Co by to zmieniło"</dt>
          <dd>
            Karta adresu pokazuje, jak zmieniłby się wynik, gdyby poprawiła się wybrana warstwa.
            Niska ocena ma wskazać, co naprawić, a nie wystawić wyrok.
          </dd>
          <dt>Uczciwa rozdzielczość</dt>
          <dd>
            Przy każdej warstwie piszemy, czego dotyczy liczba: adresu, heksu, siatki, rejonu czy
            gminy. Wartość z siatki 1 km nie opisuje jednego domu, mimo że widzisz ją przy adresie.
          </dd>
          <dt>Wynik zależy od Ciebie</dt>
          <dd>
            Nie ma jednej „prawdziwej" jakości życia. Rodzina z dzieckiem i senior ważą hałas,
            zieleń i transport inaczej. Dlatego wagi ustawiasz sam, a literę liczymy z Twoich wag.
          </dd>
          <dt>Dane statyczne i brak śledzenia</dt>
          <dd>
            <p className="met-komorka-akapit">
              Dane to pliki liczone raz, bez zapytań o Twój adres do naszego serwera. Wynik liczy
              Twoja przeglądarka. Nie mamy kont, ciasteczek ani analityki i nie zapisujemy
              wyszukiwań. Wagi i wybrany adres są tylko w linku po znaku #, który przeglądarka nie
              wysyła na serwer.
            </p>
            <p className="met-komorka-akapit">
              Jedno zastrzeżenie: przeglądarka pobiera kafelki mapy z serwerów OpenStreetMap i
              czcionki z Google Fonts. Te usługi widzą Twój adres IP i przybliżony obszar mapy, jak
              przy każdej stronie z takim podkładem.
            </p>
          </dd>
        </dl>
      </section>

      <section id="met-ograniczenia" aria-labelledby="met-ograniczenia-h" className="met-sekcja">
        <h2 id="met-ograniczenia-h">Ograniczenia</h2>
        <Ograniczenia />
      </section>

      <footer className="met-stopka">
        <a href="#/">Wróć do wyszukiwania</a>
      </footer>
    </main>
  )
}
