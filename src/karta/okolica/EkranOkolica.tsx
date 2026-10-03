import { lazy, Suspense, useState } from 'react'
import { PoleZapytajOAdres } from '@/ai/PoleZapytajOAdres'
import { liczba, opisAdresu } from '@/karta/adres'
import { KATEGORIE, type KategoriaId } from '@/kontrakty'
import { Sekcja3D } from '@/miasto3d/Sekcja3D'
import { useDane } from '@/wynik/dane'
import type { RozbicieWarstwy, WynikAdresu } from '@/wynik/silnik'
import { dodajDoPorownania, hrefDla, przejdz, useStan } from '@/wynik/stan'
import { useWynikAdresu } from '@/wynik/useWyniki'
import { Etykieta } from './Etykieta'
import type { LiteraEtykiety } from './kolory'
import { LepszySasiad } from './LepszySasiad'
import { SzczegolySzkoly } from './SzczegolySzkoly'
import {
  liczbaPL,
  liczbyWarstw,
  mocneISlabe,
  opisRozdzielczosci,
  opisWartosci,
  type Wplyw,
  zdanieWarstwy,
  znakowanePunkty,
} from './wyjasnienie'
import './okolica.css'

const KATEGORIE_WYNIKU = (Object.keys(KATEGORIE) as KategoriaId[]).filter((k) => k !== 'kontekst')
const CoByToZmienilo = lazy(async () => ({
  default: (await import('../CoByToZmienilo')).CoByToZmienilo,
}))

/** Slot #12 – karta okolicy wg docs/makieta/Okolica.dc.html (bez sekcji „Mieszkania"). */
export function EkranOkolica() {
  const dane = useDane()
  const stan = useStan((s) => s)
  const wynik = useWynikAdresu(stan.wybrany)
  const adres = dane.stan === 'gotowe' && stan.wybrany !== null ? dane.adresy[stan.wybrany] : null
  const linkMapa = hrefDla(stan, { ekran: 'szukaj' })

  if (dane.stan === 'ladowanie') {
    return (
      <main className="tresc okol">
        <p className="komunikat">Wczytuję dane…</p>
      </main>
    )
  }
  if (dane.stan !== 'gotowe' || stan.wybrany === null || !adres || !wynik) {
    return (
      <main className="tresc okol">
        <section className="karta okol-pusta">
          <h1 className="okol-h1" tabIndex={-1}>
            Nie ma takiego adresu
          </h1>
          <p>Wybierz adres na mapie albo w wyszukiwarce, żeby zobaczyć jego kartę.</p>
          <a href={linkMapa} className="przycisk-glowny">
            Wróć do mapy
          </a>
        </section>
      </main>
    )
  }

  const warstwyWyniku = wynik.warstwy.filter((w) => w.kategoria !== 'kontekst')
  const kontekst = wynik.warstwy.filter((w) => w.kategoria === 'kontekst')
  const { mocne, slabe } = mocneISlabe(wynik.warstwy, wynik.wynik)
  const atrapa = wynik.warstwy.some((w) => w.meta.atrapa)

  return (
    <main className="tresc okol">
      <a href={linkMapa} className="okol-wroc">
        Wróć do mapy
      </a>

      <Naglowek
        wynik={wynik}
        nazwa={opisAdresu(adres)}
        miejsce={adres.dzielnica ? `Dzielnica ${adres.dzielnica}` : `Gmina ${adres.gmina}`}
        atrapa={atrapa}
      />

      <PoleZapytajOAdres indeks={stan.wybrany} />

      <section aria-labelledby="h-kategorie" className="karta">
        <h2 id="h-kategorie" className="okol-h2">
          Oceny kategorii
        </h2>
        <ul className="okol-lista">
          {KATEGORIE_WYNIKU.map((id) => (
            <PasekKategorii
              key={id}
              nazwa={KATEGORIE[id]}
              ocena={wynik.kategorie.find((k) => k.kategoria === id)?.ocena ?? null}
            />
          ))}
        </ul>
      </section>

      <section aria-labelledby="h-dlaczego" className="okol-sekcja">
        <h2 id="h-dlaczego" className="okol-h2">
          Dlaczego taki wynik
        </h2>
        <div className="okol-dwie">
          <Strony tytul="Najmocniejsze strony" pozycje={mocne} wariant="plus" />
          <Strony tytul="Co obniża wynik" pozycje={slabe} wariant="minus" />
        </div>
        <Suspense
          fallback={
            <p className="komunikat" role="status">
              Wczytuję scenariusze…
            </p>
          }
        >
          <CoByToZmienilo warstwy={wynik.warstwy} />
        </Suspense>
      </section>

      <LepszySasiad adres={stan.wybrany} />

      <Sekcja3D />

      <Rozbicie warstwy={warstwyWyniku} wynik={wynik.wynik} />

      {kontekst.length > 0 && (
        <NaCoDzien warstwy={kontekst} indeks={stan.wybrany} wersja={dane.plikAdresow.wersja} />
      )}

      <p className="okol-przypis">
        Źródło, licencję, rozdzielczość i datę danych podajemy przy każdej warstwie w tabeli.
        Kategoria bez danych jest szara i nigdy nie liczy się jako zero.
      </p>
    </main>
  )
}

function Naglowek({
  wynik,
  nazwa,
  miejsce,
  atrapa,
}: {
  wynik: WynikAdresu
  nazwa: string
  miejsce: string
  atrapa: boolean
}) {
  const stan = useStan((s) => s)
  const [komunikat, setKomunikat] = useState('')
  const litera = wynik.litera as LiteraEtykiety | null
  const { zDanymi, razem } = liczbyWarstw(wynik.warstwy)
  const procent = wynik.wynik === null ? 0 : Math.round(wynik.wynik)
  const pewnosc = Math.round(wynik.pewnosc * 100)
  const wPorownaniu = stan.porownanie.includes(wynik.i)

  async function udostepnij() {
    const url = location.href
    try {
      if (navigator.share) {
        await navigator.share({ title: `adresscore: ${nazwa}`, url })
        return
      }
      await navigator.clipboard.writeText(url)
      setKomunikat('Skopiowano link.')
    } catch (e) {
      // Zamknięcie okna udostępniania to nie błąd.
      if (e instanceof DOMException && e.name === 'AbortError') return
      setKomunikat('Nie udało się skopiować. Skopiuj adres z paska przeglądarki.')
    }
  }

  function porownaj() {
    dodajDoPorownania(wynik.i)
    przejdz('porownanie')
  }

  return (
    <section className="karta okol-naglowek" aria-labelledby="h-adres">
      <div className="okol-glowa">
        <div className="okol-tytul">
          <div
            className="okol-pierscien"
            style={{
              background: `conic-gradient(var(--akcent) 0 ${procent}%, #e3e7e9 ${procent}% 100%)`,
            }}
          >
            <div className="okol-pierscien-srodek">
              <span className="okol-pierscien-wartosc mono">{liczba(wynik.wynik)}</span>
              <span className="okol-pierscien-podpis">na 100</span>
            </div>
          </div>
          <div className="okol-nazwa">
            {/* tabIndex=-1: Aplikacja przenosi tu fokus po zmianie ekranu. */}
            <h1 id="h-adres" className="okol-h1" tabIndex={-1}>
              {nazwa}
            </h1>
            <p className="okol-miejsce">
              {miejsce}
              {atrapa && <span className="atrapa">dane przykładowe</span>}
            </p>
          </div>
        </div>

        <div className="okol-przyciski">
          <button type="button" className="przycisk-glowny okol-przycisk" onClick={porownaj}>
            {wPorownaniu ? 'Przejdź do porównania' : 'Porównaj'}
          </button>
          <button type="button" className="seg okol-przycisk" onClick={udostepnij}>
            Udostępnij
          </button>
          <span role="status" className="okol-status">
            {komunikat}
          </span>
        </div>
      </div>

      <div className="okol-wynik">
        <Etykieta litera={litera} wynik={wynik.wynik} />
        <div className="okol-pewnosc">
          <span>
            Dane dla {zDanymi} z {razem} warstw
          </span>
          <span
            className="okol-pewnosc-pasek"
            role="meter"
            aria-label="Pewność wyniku"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pewnosc}
          >
            <span
              style={{
                width: `${pewnosc}%`,
                background: wynik.pewnosc < 0.6 ? 'var(--ostrzezenie)' : 'var(--akcent)',
              }}
            />
          </span>
          <span className="mono okol-pewnosc-proc">pewność {pewnosc}%</span>
        </div>
      </div>
    </section>
  )
}

function PasekKategorii({ nazwa, ocena }: { nazwa: string; ocena: number | null }) {
  return (
    <li className="okol-kat">
      <span>{nazwa}</span>
      {ocena === null ? (
        <>
          <span className="okol-pasek okol-pasek-brak" />
          <span className="okol-kat-brak">brak danych</span>
        </>
      ) : (
        <>
          <span className="okol-pasek">
            <span
              className={ocena >= 60 ? 'okol-wyp-dobry' : 'okol-wyp-slaby'}
              style={{ width: `${Math.round(ocena)}%` }}
            />
          </span>
          <span className="mono okol-kat-liczba">{liczba(ocena)}</span>
        </>
      )}
    </li>
  )
}

function Strony({
  tytul,
  pozycje,
  wariant,
}: {
  tytul: string
  pozycje: Wplyw[]
  wariant: 'plus' | 'minus'
}) {
  return (
    <div className="karta okol-strony">
      <h3 className={`okol-h3 okol-h3-${wariant}`}>{tytul}</h3>
      {pozycje.length === 0 && (
        <p className="okol-podpis">Żadna warstwa nie odbiega tu istotnie od średniej.</p>
      )}
      {pozycje.map((p) => (
        <div key={p.warstwa.id} className="okol-strona">
          <span className={`okol-punkty okol-punkty-${wariant} mono`}>
            {znakowanePunkty(p.punkty)}
          </span>
          <div className="okol-strona-tekst">
            <span className="okol-strona-nazwa">{p.warstwa.meta.nazwa}</span>
            <span className="okol-strona-opis">{zdanieWarstwy(p.warstwa)}</span>
          </div>
        </div>
      ))}
    </div>
  )
}

function Zrodla({ w }: { w: RozbicieWarstwy }) {
  const m = w.meta
  return (
    <span className="okol-zrodlo">
      {m.zrodla.map((z) => {
        const warunkiUrl = z.licencja.match(/https:\/\/[^\s)]+/)?.[0]
        const warunkiOpis = warunkiUrl ? z.licencja.replace(warunkiUrl, '').trim() : z.licencja
        return (
          <span className="okol-zrodlo-pozycja" key={z.url}>
            źródło:{' '}
            <a href={z.url} target="_blank" rel="noreferrer">
              {z.nazwa}
            </a>
            ; stan danych: {z.dataDanych}; pobrano: {z.pobrano}
            {warunkiOpis && warunkiOpis !== '-' && <>; warunki: {warunkiOpis}</>}
            {warunkiUrl && (
              <>
                {' '}
                <a href={warunkiUrl} target="_blank" rel="noreferrer">
                  pełne warunki ponownego wykorzystania
                </a>
              </>
            )}
          </span>
        )
      })}
      <span className="okol-rozdz">rozdzielczość: {opisRozdzielczosci(m)}</span>
      <span className="okol-metoda">przetworzenie przez adresscore: {m.opis}</span>
      {m.atrapa && <span className="atrapa">dane przykładowe</span>}
    </span>
  )
}

function Rozbicie({ warstwy, wynik }: { warstwy: RozbicieWarstwy[]; wynik: number | null }) {
  return (
    <section aria-labelledby="h-rozbicie" className="karta">
      <div className="okol-rozbicie-glowa">
        <h2 id="h-rozbicie" className="okol-h2">
          Rozbicie na warstwy
        </h2>
        <span className="okol-podpis">
          Waga × ocena = wkład. Wkłady sumują się do wyniku
          {wynik === null ? '' : ` (${liczba(wynik)})`}.
        </span>
      </div>
      <div className="okol-przewijanie" tabIndex={0} role="region" aria-label="Tabela warstw">
        <table className="okol-tabela">
          <thead>
            <tr>
              <th scope="col">Warstwa</th>
              <th scope="col">Waga</th>
              <th scope="col">Ocena (0–100)</th>
              <th scope="col" className="okol-prawo">
                Wkład
              </th>
            </tr>
          </thead>
          <tbody>
            {warstwy.map((w) => (
              <tr key={w.id}>
                <td>
                  <span className="okol-warstwa-nazwa">{w.meta.nazwa}</span>
                  <span className="okol-warstwa-wartosc mono">{opisWartosci(w)}</span>
                  <Zrodla w={w} />
                </td>
                <td className="mono">{w.wagaUzytkownika}/4</td>
                <td>
                  <KomorkaOceny w={w} />
                </td>
                <td className="mono okol-prawo">
                  {w.wklad === null ? '–' : liczbaPL(Math.round(w.wklad * 10) / 10)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function KomorkaOceny({ w }: { w: RozbicieWarstwy }) {
  if (w.ocena === null) {
    // Brak oceny ma trzy powody, a żaden nie jest zerem.
    const powod =
      w.wartosc === null
        ? 'brak danych'
        : w.kierunek === null
          ? 'bez kierunku, nie liczona'
          : 'nie liczona'
    return (
      <span className="okol-ocena">
        <span className="okol-pasek okol-pasek-brak" />
        <span className="okol-kat-brak">{powod}</span>
      </span>
    )
  }
  return (
    <span className="okol-ocena">
      <span className="okol-pasek">
        <span
          className={w.ocena >= 60 ? 'okol-wyp-dobry' : 'okol-wyp-slaby'}
          style={{ width: `${Math.round(w.ocena)}%` }}
        />
      </span>
      <span className="mono">{liczba(w.ocena)}</span>
    </span>
  )
}

function NaCoDzien({
  warstwy,
  indeks,
  wersja,
}: {
  warstwy: RozbicieWarstwy[]
  indeks: number
  wersja: string
}) {
  return (
    <section aria-labelledby="h-codzien" className="karta okol-codzien">
      <h2 id="h-codzien" className="okol-h2">
        Na co dzień
      </h2>
      <p className="okol-podpis">Fakty o okolicy. Nie wpływają na wynik.</p>
      <dl className="okol-fakty">
        {warstwy.map((w) => (
          <div key={w.id} className="okol-fakt">
            <dt>
              {w.meta.nazwa}
              <Zrodla w={w} />
            </dt>
            <dd>
              {opisWartosci(w)}
              {w.id === 'szkola_podst_wynik_e8' && w.wartosc !== null && (
                <SzczegolySzkoly indeks={indeks} wersja={wersja} />
              )}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
