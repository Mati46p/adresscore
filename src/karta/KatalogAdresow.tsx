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
  const pasujace = q
    ? grupy.filter((g) => normalizuj(`${g.nazwa} ${g.miejscowosc} ${g.gmina}`).includes(q))
    : grupy

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
      <h1 tabIndex={-1}>Katalog adresów</h1>
      <p>
        {dane.adresy.length.toLocaleString('pl-PL')} adresów ·{' '}
        {grupy.length.toLocaleString('pl-PL')} ulic i miejscowości{' '}
        {wKrakowie ? 'w Krakowie oraz sąsiednich gminach' : miasto.wMiescie}.
      </p>
      <label className="katalog-szukaj">
        Szukaj ulicy lub adresu
        <input
          type="search"
          value={zapytanie}
          onChange={(e) => {
            setZapytanie(e.currentTarget.value)
            setWidoczne(80)
          }}
          placeholder={przyklad}
          autoComplete="street-address"
        />
      </label>
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
        <p role="status">{pasujace.length.toLocaleString('pl-PL')} pozycji</p>
        <ul className="katalog-ulice">
          {pasujace.slice(0, widoczne).map((g) => (
            <li key={g.slug}>
              <details>
                <summary>
                  {g.nazwa}, {g.miejscowosc} <span>({g.adresy.length})</span>
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
          <button type="button" className="seg" onClick={() => setWidoczne((n) => n + 80)}>
            Pokaż kolejne ulice
          </button>
        )}
      </section>
    </main>
  )
}
