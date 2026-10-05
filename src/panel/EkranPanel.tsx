// Ekran `#/panel`: bramka (konfiguracja → sesja → uprawnienia) i panel z siedmioma zakładkami.
//
// Ten moduł jest JEDYNYM punktem wejścia panelu z głównego kodu (`ladujPanel` w
// `src/karta/ladowanieEkranow.ts`): razem z nim ładują się klient Supabase, pamięć podręczna i
// biblioteka wykresów, a zwiedzający serwis nie dostają żadnego z nich (FR-023).
//
// Co widzi kto (spec, Historia 2):
//  - brak konfiguracji bazy  → komunikat, bez wyjątku,
//  - bez sesji                → TYLKO przycisk „Zaloguj przez Google”,
//  - sesja bez uprawnień      → „Brak dostępu” i wylogowanie (odmowa zapada w bazie: kod 42501 z
//                               `admin_przeglad`, a ekran tylko ją pokazuje),
//  - admin                    → zakładki, wstęp, odświeżanie, znacznik wieku danych.
// Sondą uprawnień jest widok `przeglad`: ten sam wynik zasila potem zakładkę Przegląd z pamięci.
import {
  type ComponentType,
  type LazyExoticComponent,
  lazy,
  type ReactNode,
  Suspense,
  useEffect,
  useState,
} from 'react'
import {
  BAZA_SKONFIGUROWANA,
  bladLogowania,
  useSesja,
  wyczyscAdresPoLogowaniu,
  wyloguj,
} from './auth'
import { formatGodziny } from './czas'
import { odswiezWszystko, useNajstarszyPobrano, useWidok } from './dane'
import { Logowanie } from './Logowanie'
import { idPanelu, idPrzyciskuZakladki, PasekZakladek } from './skladniki/PasekZakladek'
import { type IdZakladki, WSTEPY, ZAKLADKA_DOMYSLNA, ZAKLADKI } from './zakladki'
import './panel.css'

// Każda zakładka to osobny chunk ładowany po pierwszym wejściu; faza zakładki podmienia tylko
// treść swojego pliku, nazwany eksport (nazwa pliku) zostaje.
const KOMPONENTY_ZAKLADEK: Record<IdZakladki, LazyExoticComponent<ComponentType>> = {
  przeglad: lazy(async () => ({ default: (await import('./zakladki/Przeglad')).Przeglad })),
  akwizycja: lazy(async () => ({ default: (await import('./zakladki/Akwizycja')).Akwizycja })),
  sesje: lazy(async () => ({ default: (await import('./zakladki/Sesje')).Sesje })),
  zaangazowanie: lazy(async () => ({
    default: (await import('./zakladki/Zaangazowanie')).Zaangazowanie,
  })),
  cta: lazy(async () => ({ default: (await import('./zakladki/Cta')).Cta })),
  tresc: lazy(async () => ({ default: (await import('./zakladki/Tresc')).Tresc })),
  jakosc: lazy(async () => ({ default: (await import('./zakladki/Jakosc')).Jakosc })),
}

const PREFIKS_ZAKLADEK = 'panel'
const TYTUL_DOKUMENTU = 'Panel – adresscore'

/**
 * Tytuł karty i `noindex` na czas bycia na ekranie panelu (panel jest wewnętrzny, nie ma być w
 * wyszukiwarce). Strona ma już znacznik robots z `index.html`, więc zmieniamy jego treść i
 * przywracamy przy odmontowaniu; gdyby go nie było, tworzymy własny i usuwamy.
 */
function useOznaczeniaDokumentu() {
  useEffect(() => {
    const poprzedniTytul = document.title
    document.title = TYTUL_DOKUMENTU
    let meta = document.querySelector<HTMLMetaElement>('meta[name="robots"]')
    const stworzona = meta === null
    const poprzedniaTresc = meta?.content ?? ''
    if (!meta) {
      meta = document.createElement('meta')
      meta.name = 'robots'
      document.head.append(meta)
    }
    meta.content = 'noindex'
    return () => {
      document.title = poprzedniTytul
      if (stworzona) meta.remove()
      else meta.content = poprzedniaTresc
    }
  }, [])
}

function KartaStanu({ tytul, children }: { tytul: string; children?: ReactNode }) {
  return (
    <section className="panel-stan" aria-labelledby="panel-stan-tytul">
      <h1 id="panel-stan-tytul">{tytul}</h1>
      {children}
    </section>
  )
}

function PrzyciskWyloguj() {
  return (
    <button type="button" className="panel-przycisk" onClick={() => void wyloguj()}>
      Wyloguj
    </button>
  )
}

function BrakDostepu({ email }: { email: string | null }) {
  return (
    <KartaStanu tytul="Brak dostępu">
      <p>
        {email ? `Konto ${email} nie ` : 'To konto nie '}
        ma uprawnień do panelu. Zaloguj się kontem administratora.
      </p>
      <div className="panel-stan-akcje">
        <PrzyciskWyloguj />
        <a className="panel-przycisk" href="/">
          Wróć do serwisu
        </a>
      </div>
    </KartaStanu>
  )
}

/**
 * Sprawdza uprawnienia zapytaniem o `przeglad` i odpina się, gdy admin jest potwierdzony (żeby
 * znacznik „Dane z godz.” liczył wiek tego, co jest na ekranie, a nie wiek sondy). Wynik
 * zostaje w pamięci podręcznej i zasila zakładkę Przegląd bez drugiego pytania.
 */
function SondaUprawnien({
  email,
  naPotwierdzenie,
}: {
  email: string | null
  naPotwierdzenie: () => void
}) {
  const sonda = useWidok('przeglad')
  const potwierdzony = sonda.dane !== null
  useEffect(() => {
    if (potwierdzony) naPotwierdzenie()
  }, [potwierdzony, naPotwierdzenie])

  if (sonda.blad?.rodzaj === 'brak_dostepu') return <BrakDostepu email={email} />
  if (!potwierdzony && sonda.blad) {
    return (
      <KartaStanu tytul="Nie udało się sprawdzić uprawnień">
        <p className="panel-blad" role="alert">
          {sonda.blad.rodzaj === 'blad' ? sonda.blad.komunikat : 'Brak dostępu.'}
        </p>
        <div className="panel-stan-akcje">
          <button type="button" className="panel-przycisk" onClick={() => void odswiezWszystko()}>
            Spróbuj ponownie
          </button>
          <PrzyciskWyloguj />
        </div>
      </KartaStanu>
    )
  }
  return (
    <KartaStanu tytul="Panel">
      <p role="status">Sprawdzam uprawnienia…</p>
    </KartaStanu>
  )
}

function PanelAdmina({ email }: { email: string | null }) {
  const [aktywna, setAktywna] = useState<IdZakladki>(ZAKLADKA_DOMYSLNA)
  const [odswiezanie, setOdswiezanie] = useState(false)
  const najstarszy = useNajstarszyPobrano()
  const Zakladka = KOMPONENTY_ZAKLADEK[aktywna]

  // Łańcuch obietnic zamiast try/finally: React Compiler 1.0 nie kompiluje komponentu z blokiem
  // try bez catch. `odswiezWszystko` nie odrzuca obietnicy, więc `finally` zawsze zdejmie stan.
  function odswiez() {
    setOdswiezanie(true)
    odswiezWszystko().finally(() => setOdswiezanie(false))
  }

  return (
    <>
      <header className="panel-pasek">
        <h1 className="panel-tytul">{TYTUL_DOKUMENTU}</h1>
        <div className="panel-narzedzia">
          {najstarszy !== null ? (
            <span
              className="panel-wiek"
              title={`Najstarsza liczba na ekranie pobrana ${new Date(najstarszy).toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw' })}`}
            >
              Dane z godz. {formatGodziny(najstarszy)}
            </span>
          ) : null}
          <button
            type="button"
            className="panel-przycisk"
            disabled={odswiezanie}
            aria-busy={odswiezanie}
            onClick={odswiez}
          >
            {odswiezanie ? 'Odświeżam…' : 'Odśwież'}
          </button>
          <a className="panel-przycisk" href="/">
            Wróć do serwisu
          </a>
          {email ? (
            <span className="panel-konto" title={email}>
              {email}
            </span>
          ) : null}
          <PrzyciskWyloguj />
        </div>
      </header>
      <PasekZakladek
        zakladki={ZAKLADKI}
        aktywna={aktywna}
        naZmiane={setAktywna}
        prefiks={PREFIKS_ZAKLADEK}
        etykieta="Zakładki panelu analityki"
      />
      <div
        role="tabpanel"
        id={idPanelu(PREFIKS_ZAKLADEK, aktywna)}
        aria-labelledby={idPrzyciskuZakladki(PREFIKS_ZAKLADEK, aktywna)}
        tabIndex={0}
        className="panel-widok"
      >
        <p className="panel-wstep">{WSTEPY[aktywna]}</p>
        <Suspense
          fallback={<div className="panel-szkielet" role="status" aria-label="Wczytuję zakładkę" />}
        >
          <Zakladka />
        </Suspense>
      </div>
    </>
  )
}

function BramkaAdmina({ email }: { email: string | null }) {
  const [potwierdzony, setPotwierdzony] = useState(false)
  if (potwierdzony) return <PanelAdmina email={email} />
  return <SondaUprawnien email={email} naPotwierdzenie={() => setPotwierdzony(true)} />
}

function Bramka() {
  const sesja = useSesja()
  const ustalona = sesja.rodzaj !== 'ladowanie'
  // Adres sprzątamy dopiero po ustaleniu sesji: wcześniejsze usunięcie `code` przerwałoby wymianę.
  useEffect(() => {
    if (ustalona) wyczyscAdresPoLogowaniu()
  }, [ustalona])

  if (sesja.rodzaj === 'ladowanie') {
    return (
      <KartaStanu tytul="Panel">
        <p role="status">Sprawdzam logowanie…</p>
      </KartaStanu>
    )
  }
  if (sesja.rodzaj === 'brak') return <Logowanie blad={bladLogowania()} />
  return <BramkaAdmina email={sesja.sesja.user.email ?? null} />
}

export function EkranPanel() {
  useOznaczeniaDokumentu()
  return (
    <main className="panel">
      {BAZA_SKONFIGUROWANA ? (
        <Bramka />
      ) : (
        <KartaStanu tytul="Panel jest niedostępny">
          <p className="panel-blad" role="alert">
            Brak konfiguracji bazy: ustaw VITE_SUPABASE_URL i VITE_SUPABASE_ANON_KEY w pliku
            .env.local (lokalnie) albo w zmiennych środowiska hostingu.
          </p>
          <div className="panel-stan-akcje">
            <a className="panel-przycisk" href="/">
              Wróć do serwisu
            </a>
          </div>
        </KartaStanu>
      )}
    </main>
  )
}
