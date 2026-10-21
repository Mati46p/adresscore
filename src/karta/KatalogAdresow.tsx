import { useEffect, useState } from 'react'
import { type Adres, MIASTO_DOMYSLNE } from '@/kontrakty'
import { useDane } from '@/wynik/dane'
import { useMiasto } from '@/wynik/miastoDanych'
import { hrefAdresu, slugUlicy } from '@/wynik/slug'
import { hrefDla, useStan } from '@/wynik/stan'
import { przykladAdresu } from './adres'
import { indeksDla, normalizuj, szukaj } from './wyszukiwarka/indeks'
import './katalog.css'

interface Ulica {
  slug: string
  nazwa: string
  miejscowosc: string
  gmina: string
  adresy: Adres[]
}

const cache = new WeakMap<Adres[], Ulica[]>()

function katalog(adresy: Adres[]): Ulica[] {
  const zapisane = cache.get(adresy)
  if (zapisane) return zapisane
  const grupy = new Map<string, Ulica>()
  for (const a of adresy) {
    const slug = slugUlicy(a)
    let g = grupy.get(slug)
    if (!g) {
      g = {
        slug,
        nazwa: a.ulica ?? a.miejscowosc,
        miejscowosc: a.miejscowosc,
        gmina: a.gmina,
        adresy: [],
      }
      grupy.set(slug, g)
    }
    g.adresy.push(a)
  }
  const lista = [...grupy.values()].sort((a, b) =>
    `${a.miejscowosc} ${a.nazwa}`.localeCompare(`${b.miejscowosc} ${b.nazwa}`, 'pl'),
  )
  for (const g of lista) g.adresy.sort((a, b) => a.nr.localeCompare(b.nr, 'pl', { numeric: true }))
  cache.set(adresy, lista)
  return lista
}

type Sortowanie = 'az' | 'za' | 'najwiecej' | 'najmniej'

const SORTOWANIA: { id: Sortowanie; etykieta: string }[] = [
  { id: 'az', etykieta: 'Nazwa A–Z' },
  { id: 'za', etykieta: 'Nazwa Z–A' },
  { id: 'najwiecej', etykieta: 'Najwięcej adresów' },
  { id: 'najmniej', etykieta: 'Najmniej adresów' },
]

const PROGI_ADRESOW = [1, 10, 50, 100]

// Lista z katalog() jest już posortowana A–Z, więc 'az' nie kopiuje tablicy.
function sortuj(lista: Ulica[], s: Sortowanie): Ulica[] {
  if (s === 'az') return lista
  if (s === 'za') return [...lista].reverse()
  const kierunek = s === 'najwiecej' ? -1 : 1
  return [...lista].sort((a, b) => kierunek * (a.adresy.length - b.adresy.length))
}

function LinkAdresu({ adres, href }: { adres: Adres; href: string }) {
  return (
    <a href={href}>
      {adres.ulica ?? adres.miejscowosc} {adres.nr}, {adres.miejscowosc}
    </a>
  )
}

export function KatalogAdresow() {
  const dane = useDane()
  const miasto = useMiasto()
  const stan = useStan((s) => s)
  const [zapytanie, setZapytanie] = useState('')
  const [widoczne, setWidoczne] = useState(80)
  const [sortowanie, setSortowanie] = useState<Sortowanie>('az')
  const [filtrMiejscowosci, setFiltrMiejscowosci] = useState('')
  const [minAdresow, setMinAdresow] = useState(1)
  const grupy = dane.stan === 'gotowe' ? katalog(dane.adresy) : []
  const slug = location.pathname.startsWith('/katalog/')
    ? location.pathname.slice('/katalog/'.length)
    : null
  const wybrana = slug ? grupy.find((g) => g.slug === slug) : null
  useEffect(() => {
    if (wybrana) document.title = `${wybrana.nazwa}, ${wybrana.miejscowosc} – adresy – adresscore`
  }, [wybrana])
  if (dane.stan !== 'gotowe') {
    return (
      <main className="tresc katalog">
        <h1>Katalog adresów</h1>
        <p>Wczytuję adresy…</p>
      </main>
    )
  }
  // Strony SEO (/adres/<slug>, /katalog/<ulica>) istnieją tylko dla Krakowa (FR-015). Adres z innego miasta
  // otwiera kartę w aplikacji (#/adres/<id>?mst=…), a nie nieistniejącą stronę; ulica nie ma osobnej strony.
  const wKrakowie = miasto.slug === MIASTO_DOMYSLNE
  const hrefKarty = (a: Adres) =>
    wKrakowie ? hrefAdresu(a) : hrefDla(stan, { ekran: 'okolica', wybrany: a.i })
  // Przykład z danych bieżącego miasta, nie z Krakowa: „Np. Zofii Nałkowskiej 6C, Gdańsk”.
  const zDanych = wKrakowie ? null : przykladAdresu(dane.adresy, true)
  const przyklad = wKrakowie
    ? 'Np. Grodzka 12, Kraków'
    : zDanych
      ? `Np. ${zDanych}`
      : 'Np. nazwa ulicy i numer domu'
  const q = normalizuj(zapytanie)
  const wynikiAdresow = q && /\d/.test(q) ? szukaj(indeksDla(dane.adresy), zapytanie, 100) : []
  const miejscowosci = [...new Set(grupy.map((g) => g.miejscowosc))].sort((a, b) =>
    a.localeCompare(b, 'pl'),
  )
  const filtrowane = grupy.filter(
    (g) =>
      (!filtrMiejscowosci || g.miejscowosc === filtrMiejscowosci) &&
      g.adresy.length >= minAdresow &&
      (!q || normalizuj(`${g.nazwa} ${g.miejscowosc} ${g.gmina}`).includes(q)),
  )
  const pasujace = sortuj(filtrowane, sortowanie)
  const najwiecej = Math.max(1, ...grupy.map((g) => g.adresy.length))
  const resetujListe = () => setWidoczne(80)

  if (slug) {
    return (
      <main className="tresc katalog">
        <a href="/katalog">← Katalog adresów</a>
        {wybrana ? (
          <>
            <h1>
              {wybrana.nazwa}, {wybrana.miejscowosc}
            </h1>
            <p>
              Gmina {wybrana.gmina} · {wybrana.adresy.length} adresów
            </p>
            <ul className="katalog-adresy">
              {wybrana.adresy.map((a) => (
                <li key={a.id}>
                  <LinkAdresu adres={a} href={hrefKarty(a)} />
                </li>
              ))}
            </ul>
          </>
        ) : (
          <h1>Nie znaleziono ulicy</h1>
        )}
      </main>
    )
  }

  return (
    <main className="tresc katalog">
      <header className="katalog-naglowek">
        <h1 tabIndex={-1}>Katalog adresów</h1>
        <p>
          Każdy adres {wKrakowie ? 'w Krakowie oraz sąsiednich gminach' : miasto.wMiescie} z
          wynikiem jakości życia.
        </p>
        <dl className="katalog-liczby">
          <div>
            <dt>adresów</dt>
            <dd>{dane.adresy.length.toLocaleString('pl-PL')}</dd>
          </div>
          <div>
            <dt>ulic i miejscowości</dt>
            <dd>{grupy.length.toLocaleString('pl-PL')}</dd>
          </div>
          <div>
            <dt>miejscowości</dt>
            <dd>{miejscowosci.length.toLocaleString('pl-PL')}</dd>
          </div>
        </dl>
      </header>
      <div className="katalog-narzedzia">
        <label className="katalog-szukaj">
          Szukaj ulicy lub adresu
          <input
            type="search"
            value={zapytanie}
            onChange={(e) => {
              setZapytanie(e.currentTarget.value)
              resetujListe()
            }}
            placeholder={przyklad}
            autoComplete="street-address"
          />
        </label>
        <label className="katalog-pole">
          Sortuj
          <select
            value={sortowanie}
            onChange={(e) => {
              setSortowanie(e.currentTarget.value as Sortowanie)
              resetujListe()
            }}
          >
            {SORTOWANIA.map((s) => (
              <option key={s.id} value={s.id}>
                {s.etykieta}
              </option>
            ))}
          </select>
        </label>
        {miejscowosci.length > 1 && (
          <label className="katalog-pole">
            Miejscowość
            <select
              value={filtrMiejscowosci}
              onChange={(e) => {
                setFiltrMiejscowosci(e.currentTarget.value)
                resetujListe()
              }}
            >
              <option value="">Wszystkie</option>
              {miejscowosci.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
        )}
        <fieldset className="katalog-progi">
          <legend>Liczba adresów</legend>
          {PROGI_ADRESOW.map((p) => (
            <button
              key={p}
              type="button"
              aria-pressed={minAdresow === p}
              onClick={() => {
                setMinAdresow(p)
                resetujListe()
              }}
            >
              {p === 1 ? 'Wszystkie' : `${p}+`}
            </button>
          ))}
        </fieldset>
      </div>
      {wynikiAdresow.length > 0 && (
        <section aria-label="Pasujące adresy">
          <h2>Adresy</h2>
          <ul className="katalog-adresy">
            {wynikiAdresow.map((w) => {
              const a = dane.adresy[w.i]
              return a ? (
                <li key={a.id}>
                  <LinkAdresu adres={a} href={hrefKarty(a)} />
                </li>
              ) : null
            })}
          </ul>
        </section>
      )}
      <section aria-label="Ulice i miejscowości">
        <h2>Ulice i miejscowości</h2>
        <p role="status" className="katalog-status">
          {pasujace.length.toLocaleString('pl-PL')} pozycji
          {pasujace.length === 0 && ' – zmień wyszukiwanie albo filtry.'}
        </p>
        <ul className="katalog-ulice">
          {pasujace.slice(0, widoczne).map((g) => (
            <li key={g.slug}>
              <details>
                <summary>
                  <span className="katalog-nazwa">
                    <strong>{g.nazwa}</strong>
                    <small>
                      {g.miejscowosc === g.nazwa
                        ? `gmina ${g.gmina}`
                        : `${g.miejscowosc} · gmina ${g.gmina}`}
                    </small>
                  </span>
                  <span className="katalog-licznik" title={`${g.adresy.length} adresów`}>
                    <span
                      className="katalog-pasek"
                      style={{ width: `${Math.max(4, (g.adresy.length / najwiecej) * 100)}%` }}
                    />
                    <span>{g.adresy.length.toLocaleString('pl-PL')}</span>
                  </span>
                </summary>
                {wKrakowie && <a href={`/katalog/${g.slug}`}>Otwórz stronę ulicy</a>}
                <ul className="katalog-adresy">
                  {g.adresy.map((a) => (
                    <li key={a.id}>
                      <LinkAdresu adres={a} href={hrefKarty(a)} />
                    </li>
                  ))}
                </ul>
              </details>
            </li>
          ))}
        </ul>
        {pasujace.length > widoczne && (
          <button
            type="button"
            className="katalog-wiecej"
            onClick={() => setWidoczne((n) => n + 80)}
          >
            Pokaż kolejne ulice ({(pasujace.length - widoczne).toLocaleString('pl-PL')} zostało)
          </button>
        )}
      </section>
    </main>
  )
}
