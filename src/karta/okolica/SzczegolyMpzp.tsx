import { useEffect, useState } from 'react'
import { useTylkoKrakow } from '@/wynik/miastoDanych'

type Pozycja =
  | { typ: 'plan'; nazwa: string | null; www: string | null }
  | {
      typ: 'teren'
      plan: string | null
      oznaczenie: string | null
      opis: string | null
      www: string | null
    }

interface KatalogMpzp {
  wersjaAdresow: string
  dataDanych: string
  slownik: Pozycja[]
  adresy: (number[] | null)[]
}

interface SasiedztwoMpzp {
  wersjaAdresow: string
  promienM: number
  adresy: (number[] | null)[]
}

const LICENCJA = 'https://msip.krakow.pl/getPdf?dok_id=228972'
const MAKS_SASIADOW = 12

// Pliki (2,9 MB + 1,6 MB) są potrzebne tylko na karcie adresu w Krakowie: plany miejscowe z MSIP
// obejmują wyłącznie Kraków (D8, #223), więc poza nim komponent niczego nie pobiera (patrz niżej).
let pobieranie: Promise<[KatalogMpzp, SasiedztwoMpzp | null]> | null = null
function wczytaj() {
  const json = <T,>(u: string) =>
    fetch(u).then((r) => {
      if (!r.ok) throw new Error(`${u}: ${r.status}`)
      return r.json() as Promise<T>
    })
  pobieranie ??= Promise.all([
    json<KatalogMpzp>('/dane/mpzp_adresy.json'),
    json<SasiedztwoMpzp>('/dane/mpzp_sasiedztwo.json').catch(() => null),
  ])
  return pobieranie
}

function Teren({ t }: { t: Extract<Pozycja, { typ: 'teren' }> }) {
  return (
    <>
      <strong>{t.oznaczenie ?? 'symbol niedostępny'}</strong> – {t.opis ?? 'opis niedostępny'}
      {t.plan && <> (plan „{t.plan}”)</>}
    </>
  )
}

export function SzczegolyMpzp({
  indeks,
  wersja,
  wartosc,
}: {
  indeks: number
  wersja: string
  wartosc: number | null
}) {
  const tylkoKrakow = useTylkoKrakow()
  const [dane, ustawDane] = useState<[KatalogMpzp, SasiedztwoMpzp | null] | null>(null)
  useEffect(() => {
    // Poza Krakowem nie ma czego pobierać: pliki krakowskie nie pasują do adresów innego miasta.
    if (tylkoKrakow) return
    let aktywny = true
    void wczytaj().then(
      (w) => {
        if (aktywny) ustawDane(w)
      },
      () => {},
    )
    return () => {
      aktywny = false
    }
  }, [tylkoKrakow])

  // Komunikat zamiast pustych wartości: brak planu miejscowego w mieście to brak danych o nim, a nie
  // „brak obowiązującego planu” (to zdanie dotyczy tylko punktu, który Kraków ma w rejestrze).
  if (tylkoKrakow) {
    return <p className="okol-podpis">Szczegóły planu miejscowego: na razie tylko w Krakowie.</p>
  }
  if (wartosc === null || !dane) return null
  const [katalog, sasiedztwo] = dane
  if (katalog.wersjaAdresow !== wersja) return null
  const wlasne = (katalog.adresy[indeks] ?? []).map((k) => katalog.slownik[k])
  const plany = wlasne.filter((p): p is Extract<Pozycja, { typ: 'plan' }> => p?.typ === 'plan')
  const tereny = wlasne.filter((p): p is Extract<Pozycja, { typ: 'teren' }> => p?.typ === 'teren')
  const sasiedzi =
    sasiedztwo && sasiedztwo.wersjaAdresow === wersja ? sasiedztwo.adresy[indeks] : null
  const terenySasiadow = (sasiedzi ?? [])
    .map((k) => katalog.slownik[k])
    .filter((p): p is Extract<Pozycja, { typ: 'teren' }> => p?.typ === 'teren')

  return (
    <div className="okol-mpzp">
      {wartosc === 0 ? (
        <p>Brak obowiązującego planu miejscowego w punkcie adresu.</p>
      ) : (
        <>
          <p>
            Teren w punkcie adresu:{' '}
            {tereny.length === 0
              ? 'punkt leży w granicy planu, ale poza wydzielonym terenem z symbolem'
              : tereny.map((t, n) => (
                  <span key={`${t.oznaczenie}-${n}`}>
                    {n > 0 && '; '}
                    <Teren t={t} />
                  </span>
                ))}
            .
          </p>
          <ul>
            {plany.map((p, n) => (
              <li key={`${p.nazwa}-${n}`}>
                Plan „{p.nazwa ?? 'nazwa niedostępna'}”:{' '}
                {p.www ? (
                  <a href={p.www} target="_blank" rel="noreferrer">
                    uchwała i rysunek planu (BIP Krakowa)
                  </a>
                ) : (
                  'brak linku do uchwały w danych źródłowych'
                )}
                . Numer uchwały i data wejścia w życie – w uchwale (brak w danych MSIP). Ustalenia
                dla symbolu terenu – paragrafy w uchwale; nie streszczamy ich automatycznie.
              </li>
            ))}
          </ul>
        </>
      )}
      <p>
        Tereny planu w promieniu {sasiedztwo?.promienM ?? 100} m:{' '}
        {sasiedzi === null
          ? 'brak danych'
          : terenySasiadow.length === 0
            ? 'żaden sąsiedni punkt adresowy nie leży w terenie planu'
            : terenySasiadow.slice(0, MAKS_SASIADOW).map((t, n) => (
                <span key={`${t.plan}-${t.oznaczenie}-${n}`}>
                  {n > 0 && '; '}
                  <Teren t={t} />
                </span>
              ))}
        {terenySasiadow.length > MAKS_SASIADOW &&
          ` i ${terenySasiadow.length - MAKS_SASIADOW} kolejnych`}
        .
      </p>
      <p className="okol-podpis">
        Źródło: Gmina Miejska Kraków, MSIP – plany obowiązujące i przeznaczenia MPZP, stan na{' '}
        {katalog.dataDanych} (
        <a href={LICENCJA} target="_blank" rel="noreferrer">
          regulamin MSIP
        </a>
        ). Rozdzielczość: punkt adresowy; sąsiedztwo to tereny trafione przez inne punkty adresowe w
        promieniu, bez terenów bez adresów i bez granic działek. Symbol nie mówi sam, co wolno
        zbudować – decyduje uchwała z rysunkiem.
      </p>
    </div>
  )
}
