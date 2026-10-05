// Warstwa danych panelu bez sieci i bez bazy: rejestr widoków zgodny z contracts/rpc.md oraz
// pamięć podręczna (TTL, współdzielenie pobrań, błędy, zapominanie po zmianie konta).
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  type Magazyn,
  polaczStany,
  type StanWidoku,
  utworzMagazyn,
  type WynikPobrania,
} from './magazyn.ts'
import {
  argumentyRpc,
  klasyfikujBlad,
  kluczWidoku,
  NAZWY_WIDOKOW,
  sprawdzKsztalt,
  WIDOKI,
} from './widoki.ts'

/** Wszystkie funkcje odczytowe panelu z contracts/rpc.md i ich wartości domyślne z SQL. */
const KONTRAKT: Record<string, { rpc: string; domyslne: Record<string, number | null> }> = {
  przeglad: { rpc: 'admin_przeglad', domyslne: {} },
  seria_dzienna: { rpc: 'admin_seria_dzienna', domyslne: { p_dni: 30 } },
  seria_godzinowa: { rpc: 'admin_seria_godzinowa', domyslne: { p_godzin: 48 } },
  boty_ai: { rpc: 'admin_boty_ai', domyslne: { p_dni: 30 } },
  kanaly: { rpc: 'admin_kanaly', domyslne: { p_dni: 7 } },
  zrodla: { rpc: 'admin_zrodla', domyslne: { p_dni: 7, p_limit: 50 } },
  kampanie: { rpc: 'admin_kampanie', domyslne: { p_dni: 30 } },
  kraje: { rpc: 'admin_kraje', domyslne: { p_dni: 7 } },
  urzadzenia: { rpc: 'admin_urzadzenia', domyslne: { p_dni: 7 } },
  sesje_przeglad: { rpc: 'admin_sesje_przeglad', domyslne: { p_dni: 7 } },
  przejscia: { rpc: 'admin_przejscia', domyslne: { p_dni: 7, p_limit: 60 } },
  udostepnienia: { rpc: 'admin_udostepnienia', domyslne: { p_dni: 30 } },
  sciezki: { rpc: 'admin_sciezki', domyslne: { p_dni: 7, p_limit: 30 } },
  sekcje: { rpc: 'admin_sekcje', domyslne: { p_dni: 7, p_ekran: null } },
  punkt_urwania: { rpc: 'admin_punkt_urwania', domyslne: { p_dni: 7, p_limit: 30 } },
  cta_sekcje: { rpc: 'admin_cta_sekcje', domyslne: { p_dni: 7, p_ekran: null } },
  cta_martwe: { rpc: 'admin_cta_martwe', domyslne: { p_dni: 7, p_min: 50 } },
  ux_sygnaly: { rpc: 'admin_ux_sygnaly', domyslne: { p_dni: 7 } },
  top_ekrany: { rpc: 'admin_top_ekrany', domyslne: { p_dni: 7 } },
  top_adresy: { rpc: 'admin_top_adresy', domyslne: { p_dni: 7, p_limit: 50 } },
  bez_wyniku: { rpc: 'admin_bez_wyniku', domyslne: { p_dni: 30, p_limit: 100 } },
  lejek: { rpc: 'admin_lejek', domyslne: { p_dni: 7 } },
  diagnostyka: { rpc: 'admin_diagnostyka', domyslne: {} },
  witale: { rpc: 'admin_witale', domyslne: { p_dni: 7 } },
  bledy: { rpc: 'admin_bledy', domyslne: { p_dni: 7, p_limit: 50 } },
}

describe('rejestr widoków', () => {
  it('zawiera dokładnie 25 funkcji odczytowych z contracts/rpc.md, każdą z jej domyślnymi parametrami', () => {
    assert.equal(NAZWY_WIDOKOW.length, 25)
    assert.deepEqual([...NAZWY_WIDOKOW].sort(), Object.keys(KONTRAKT).sort())
    for (const [widok, oczekiwany] of Object.entries(KONTRAKT)) {
      const wpis = WIDOKI[widok as keyof typeof WIDOKI]
      assert.equal(wpis.rpc, oczekiwany.rpc, widok)
      assert.deepEqual({ ...wpis.domyslne }, oczekiwany.domyslne, widok)
    }
  })

  it('każda funkcja to admin_* (ma bramkę jest_adminem), bez duplikatów', () => {
    const rpc = NAZWY_WIDOKOW.map((w) => WIDOKI[w].rpc)
    assert.ok(rpc.every((n) => /^admin_[a-z_]+$/.test(n)))
    assert.equal(new Set(rpc).size, rpc.length)
  })

  it('kształt odpowiedzi: funkcje jsonb zwracają obiekt, funkcje tabelowe tablicę', () => {
    const obiekty = NAZWY_WIDOKOW.filter((w) => WIDOKI[w].ksztalt === 'obiekt').sort()
    assert.deepEqual(obiekty, ['diagnostyka', 'przeglad', 'sesje_przeglad'])
  })
})

describe('argumenty RPC i klucz cache', () => {
  it('domyślne z rejestru; null (domyślne w SQL) nie jest wysyłany', () => {
    assert.deepEqual(argumentyRpc('kanaly'), { p_dni: 7 })
    assert.deepEqual(argumentyRpc('zrodla'), { p_dni: 7, p_limit: 50 })
    assert.deepEqual(argumentyRpc('sekcje'), { p_dni: 7 })
    assert.deepEqual(argumentyRpc('przeglad'), {})
  })

  it('przekazane parametry nadpisują domyślne', () => {
    assert.deepEqual(argumentyRpc('kanaly', { p_dni: 30 }), { p_dni: 30 })
    assert.deepEqual(argumentyRpc('sekcje', { p_ekran: 'okolica' }), {
      p_dni: 7,
      p_ekran: 'okolica',
    })
    assert.deepEqual(argumentyRpc('cta_martwe', { p_min: 100 }), { p_dni: 7, p_min: 100 })
  })

  it('zamknięty zbiór: nieznane klucze nie przechodzą do RPC, a liczby nieskończone odpadają', () => {
    assert.deepEqual(argumentyRpc('kanaly', { p_dni: 30, zlosliwe: "'; drop table" } as never), {
      p_dni: 30,
    })
    assert.deepEqual(argumentyRpc('kanaly', { p_dni: Number.NaN }), {})
    assert.deepEqual(argumentyRpc('przeglad', { p_dni: 3 } as never), {})
  })

  it('klucz cache jest stabilny: ten sam widok i te same argumenty dają ten sam klucz', () => {
    assert.equal(kluczWidoku('kanaly'), kluczWidoku('kanaly', { p_dni: 7 }))
    assert.equal(kluczWidoku('sekcje'), kluczWidoku('sekcje', { p_ekran: null }))
    assert.notEqual(kluczWidoku('kanaly'), kluczWidoku('kanaly', { p_dni: 30 }))
    assert.notEqual(kluczWidoku('kanaly'), kluczWidoku('kraje'))
    assert.notEqual(kluczWidoku('sekcje'), kluczWidoku('sekcje', { p_ekran: 'biznes' }))
  })
})

describe('kształt odpowiedzi i klasyfikacja błędów', () => {
  it('tablica: wiersze przechodzą, null to pusta lista, obiekt i tekst są odrzucane', () => {
    assert.deepEqual(sprawdzKsztalt('tablica', [{ a: 1 }]), { ok: true, dane: [{ a: 1 }] })
    assert.deepEqual(sprawdzKsztalt('tablica', null), { ok: true, dane: [] })
    assert.deepEqual(sprawdzKsztalt('tablica', {}), { ok: false })
    assert.deepEqual(sprawdzKsztalt('tablica', 'x'), { ok: false })
  })

  it('obiekt: zwykły obiekt przechodzi, tablica, null i liczba są odrzucane', () => {
    assert.deepEqual(sprawdzKsztalt('obiekt', { a: 1 }), { ok: true, dane: { a: 1 } })
    assert.deepEqual(sprawdzKsztalt('obiekt', []), { ok: false })
    assert.deepEqual(sprawdzKsztalt('obiekt', null), { ok: false })
    assert.deepEqual(sprawdzKsztalt('obiekt', 5), { ok: false })
  })

  it('42501 to brak dostępu (odmowa bramki), nie awaria', () => {
    assert.deepEqual(klasyfikujBlad({ code: '42501', message: 'brak dostępu' }), {
      rodzaj: 'brak_dostepu',
    })
    assert.deepEqual(klasyfikujBlad({ code: '42501', message: 'permission denied for function' }), {
      rodzaj: 'brak_dostepu',
    })
  })

  it('pozostałe błędy dostają polski komunikat zależny od przyczyny', () => {
    const komunikat = (blad: { code?: string; message?: string } | null) => {
      const k = klasyfikujBlad(blad)
      assert.equal(k.rodzaj, 'blad')
      return k.rodzaj === 'blad' ? k.komunikat : ''
    }
    assert.match(komunikat({ code: '57014' }), /zbyt długo/)
    assert.match(komunikat({ code: 'PGRST202' }), /migracje/)
    assert.match(komunikat({ code: '42883' }), /migracje/)
    assert.match(komunikat({ code: 'PGRST301', message: 'JWT expired' }), /Sesja wygasła/)
    assert.match(komunikat({ message: 'JWT expired' }), /Sesja wygasła/)
    assert.match(komunikat({ message: 'TypeError: Failed to fetch' }), /Brak połączenia/)
    assert.match(
      komunikat({ code: 'XX000', message: 'coś się stało' }),
      /^Nie udało się pobrać danych: coś się stało/,
    )
    assert.equal(komunikat(null), 'Nie udało się pobrać danych.')
  })

  it('bardzo długi komunikat bazy jest przycinany', () => {
    const k = klasyfikujBlad({ code: 'XX000', message: 'x'.repeat(500) })
    assert.equal(k.rodzaj, 'blad')
    assert.ok(k.rodzaj === 'blad' && k.komunikat.length < 260)
  })
})

// ── Pamięć podręczna ──────────────────────────────────────────────────────────────────────

const TTL = 5 * 60_000

/** Pobranie, które kończy test (`rozwiaz`), a nie zegar. */
function sterowalne<T>() {
  let rozwiaz: (w: WynikPobrania<T>) => void = () => {}
  const obietnica = new Promise<WynikPobrania<T>>((r) => {
    rozwiaz = r
  })
  return { obietnica, rozwiaz }
}

function swiat() {
  let teraz = 1_000_000
  const magazyn: Magazyn = utworzMagazyn({ ttlMs: TTL, zegar: () => teraz })
  let wywolania = 0
  const dane = (wartosc: unknown) => async (): Promise<WynikPobrania<unknown>> => {
    wywolania++
    return { rodzaj: 'dane', dane: wartosc }
  }
  return {
    magazyn,
    dane,
    liczbaWywolan: () => wywolania,
    uplyw: (ms: number) => {
      teraz += ms
    },
    teraz: () => teraz,
  }
}

describe('magazyn: TTL i współdzielenie pobrań', () => {
  it('pierwsze pytanie pobiera dane i zapisuje moment pobrania', async () => {
    const s = swiat()
    await s.magazyn.zazadaj('k', s.dane({ a: 1 }))
    const stan = s.magazyn.odczytaj('k')
    assert.deepEqual(stan.dane, { a: 1 })
    assert.equal(stan.pobrano, s.teraz())
    assert.equal(stan.ladowanie, false)
    assert.equal(stan.blad, null)
  })

  it('w obrębie TTL (5 min) kolejne pytanie bierze z pamięci, po TTL pobiera ponownie', async () => {
    const s = swiat()
    await s.magazyn.zazadaj('k', s.dane(1))
    s.uplyw(TTL - 1)
    await s.magazyn.zazadaj('k', s.dane(2))
    assert.equal(s.liczbaWywolan(), 1)
    assert.equal(s.magazyn.odczytaj('k').dane, 1)
    s.uplyw(2) // dokładnie na granicy TTL wpis jest już stary
    await s.magazyn.zazadaj('k', s.dane(3))
    assert.equal(s.liczbaWywolan(), 2)
    assert.equal(s.magazyn.odczytaj('k').dane, 3)
  })

  it('dwa pytania naraz o ten sam klucz to jedno pobranie', async () => {
    const s = swiat()
    const { obietnica, rozwiaz } = sterowalne<unknown>()
    let wywolania = 0
    const pobierz = () => {
      wywolania++
      return obietnica
    }
    const a = s.magazyn.zazadaj('k', pobierz)
    const b = s.magazyn.zazadaj('k', pobierz)
    assert.equal(s.magazyn.odczytaj('k').ladowanie, true)
    rozwiaz({ rodzaj: 'dane', dane: 'ok' })
    await Promise.all([a, b])
    assert.equal(wywolania, 1)
    assert.equal(s.magazyn.odczytaj('k').dane, 'ok')
  })

  it('różne klucze mają osobne wpisy', async () => {
    const s = swiat()
    await s.magazyn.zazadaj('a', s.dane(1))
    await s.magazyn.zazadaj('b', s.dane(2))
    assert.equal(s.magazyn.odczytaj('a').dane, 1)
    assert.equal(s.magazyn.odczytaj('b').dane, 2)
    assert.equal(s.magazyn.odczytaj('nieznany').dane, null)
  })

  it('migawka wpisu jest stabilna do zmiany (wymóg useSyncExternalStore)', async () => {
    const s = swiat()
    assert.equal(s.magazyn.odczytaj('k'), s.magazyn.odczytaj('k'))
    await s.magazyn.zazadaj('k', s.dane(1))
    assert.equal(s.magazyn.odczytaj('k'), s.magazyn.odczytaj('k'))
  })

  it('subskrybent dostaje powiadomienie przy starcie i końcu pobrania; po odpięciu już nie', async () => {
    const s = swiat()
    let razy = 0
    const odepnij = s.magazyn.subskrybuj('k', () => {
      razy++
    })
    await s.magazyn.zazadaj('k', s.dane(1))
    assert.equal(razy, 2) // ladowanie: true, potem dane
    odepnij()
    s.uplyw(TTL + 1)
    await s.magazyn.zazadaj('k', s.dane(2))
    assert.equal(razy, 2)
  })
})

describe('magazyn: błędy', () => {
  it('błąd przy pierwszym pobraniu: brak danych, komunikat, a kolejne pytanie próbuje znowu', async () => {
    const s = swiat()
    await s.magazyn.zazadaj('k', async () => ({ rodzaj: 'blad', komunikat: 'awaria' }))
    let stan = s.magazyn.odczytaj('k')
    assert.equal(stan.dane, null)
    assert.deepEqual(stan.blad, { rodzaj: 'blad', komunikat: 'awaria' })
    assert.equal(stan.ladowanie, false)
    await s.magazyn.zazadaj('k', s.dane('ok'))
    stan = s.magazyn.odczytaj('k')
    assert.equal(stan.dane, 'ok')
    assert.equal(stan.blad, null)
  })

  it('nieudane odświeżenie zostawia stare dane na ekranie i pokazuje błąd; następne pytanie ponawia', async () => {
    const s = swiat()
    await s.magazyn.zazadaj('k', s.dane('stare'))
    await s.magazyn.zazadaj('k', async () => ({ rodzaj: 'blad', komunikat: 'awaria' }), true)
    let stan = s.magazyn.odczytaj('k')
    assert.equal(stan.dane, 'stare')
    assert.deepEqual(stan.blad, { rodzaj: 'blad', komunikat: 'awaria' })
    // Wpis z błędem nie jest „świeży”, więc zwykłe pytanie (bez wymuszenia) nie bierze go z pamięci.
    await s.magazyn.zazadaj('k', s.dane('nowe'))
    stan = s.magazyn.odczytaj('k')
    assert.equal(stan.dane, 'nowe')
    assert.equal(stan.blad, null)
  })

  it('odmowa bramki (brak dostępu) usuwa dane z ekranu', async () => {
    const s = swiat()
    await s.magazyn.zazadaj('k', s.dane('tajne'))
    await s.magazyn.zazadaj('k', async () => ({ rodzaj: 'brak_dostepu' }), true)
    const stan = s.magazyn.odczytaj('k')
    assert.equal(stan.dane, null)
    assert.equal(stan.pobrano, null)
    assert.deepEqual(stan.blad, { rodzaj: 'brak_dostepu' })
  })

  it('wyjątek w funkcji pobierającej nie wychodzi na zewnątrz, tylko staje się błędem wpisu', async () => {
    const s = swiat()
    await s.magazyn.zazadaj('k', async () => {
      throw new Error('sieć padła')
    })
    assert.deepEqual(s.magazyn.odczytaj('k').blad, { rodzaj: 'blad', komunikat: 'sieć padła' })
  })
})

describe('magazyn: odświeżanie, zapominanie i wiek danych', () => {
  it('odswiezWszystko pobiera ponownie wpisy na ekranie, a pozostałe zapomina', async () => {
    const s = swiat()
    const odepnij = s.magazyn.subskrybuj('widoczny', () => {})
    await s.magazyn.zazadaj('widoczny', s.dane('v1'))
    await s.magazyn.zazadaj('ukryty', s.dane('u1'))
    assert.equal(s.liczbaWywolan(), 2)

    let wersja = 1
    await s.magazyn.zazadaj('widoczny', async () => ({ rodzaj: 'dane', dane: `v${++wersja}` }))
    assert.equal(s.liczbaWywolan(), 2) // jeszcze świeży (TTL), pobranie pominięte
    await s.magazyn.odswiezWszystko()
    // Pobranie ponowione funkcją zapamiętaną przy ostatnim `zazadaj` widocznego wpisu.
    assert.equal(s.magazyn.odczytaj('widoczny').dane, 'v2')
    // Wpis, którego nikt nie ogląda, został zapomniany: kolejne wejście pobiera od zera mimo TTL.
    assert.equal(s.magazyn.odczytaj('ukryty').dane, null)
    await s.magazyn.zazadaj('ukryty', s.dane('u2'))
    assert.equal(s.magazyn.odczytaj('ukryty').dane, 'u2')
    odepnij()
  })

  it('podczas odświeżania stare dane zostają widoczne (bez migotania szkieletem)', async () => {
    const s = swiat()
    s.magazyn.subskrybuj('k', () => {})
    await s.magazyn.zazadaj('k', s.dane('stare'))
    const { obietnica, rozwiaz } = sterowalne<unknown>()
    const odswiezanie = s.magazyn.zazadaj('k', () => obietnica, true)
    const w_trakcie = s.magazyn.odczytaj('k')
    assert.equal(w_trakcie.ladowanie, true)
    assert.equal(w_trakcie.dane, 'stare')
    rozwiaz({ rodzaj: 'dane', dane: 'nowe' })
    await odswiezanie
    assert.equal(s.magazyn.odczytaj('k').dane, 'nowe')
    assert.equal(s.magazyn.odczytaj('k').ladowanie, false)
  })

  it('zapomnij: dane znikają od razu, a odpowiedź na pytanie sprzed zapomnienia jest ignorowana', async () => {
    const s = swiat()
    s.magazyn.subskrybuj('k', () => {})
    await s.magazyn.zazadaj('k', s.dane('admin-A'))
    const { obietnica, rozwiaz } = sterowalne<unknown>()
    let wywolania = 0
    // Pierwsze pytanie wisi (konto A), ponowione po zapomnieniu dostaje dane konta B.
    const pobierz = (): Promise<WynikPobrania<unknown>> =>
      ++wywolania === 1 ? obietnica : Promise.resolve({ rodzaj: 'dane', dane: 'admin-B' })
    const wLocie = s.magazyn.zazadaj('k', pobierz, true)
    const po = s.magazyn.zapomnij()
    // Natychmiast po zapomnieniu na ekranie nie ma danych poprzedniego konta.
    assert.equal(s.magazyn.odczytaj('k').dane, null)
    // Spóźniona odpowiedź należy do poprzedniej epoki i nie może wylądować w magazynie.
    rozwiaz({ rodzaj: 'dane', dane: 'admin-A-spozniona' })
    await Promise.all([wLocie, po])
    assert.equal(wywolania, 2)
    assert.equal(s.magazyn.odczytaj('k').dane, 'admin-B')
  })

  it('zapomnij ponawia pytania o wpisy na ekranie funkcją zapamiętaną przy ostatnim zazadaj', async () => {
    const s = swiat()
    s.magazyn.subskrybuj('k', () => {})
    let konto = 'A'
    await s.magazyn.zazadaj('k', async () => ({ rodzaj: 'dane', dane: `dane-${konto}` }))
    assert.equal(s.magazyn.odczytaj('k').dane, 'dane-A')
    konto = 'B'
    await s.magazyn.zapomnij()
    assert.equal(s.magazyn.odczytaj('k').dane, 'dane-B')
  })

  it('zapomnij(false) nie ponawia pytań (wylogowanie: poszłyby bez sesji)', async () => {
    const s = swiat()
    s.magazyn.subskrybuj('k', () => {})
    await s.magazyn.zazadaj('k', s.dane('admin-A'))
    assert.equal(s.liczbaWywolan(), 1)
    await s.magazyn.zapomnij(false)
    assert.equal(s.magazyn.odczytaj('k').dane, null)
    assert.equal(s.liczbaWywolan(), 1)
  })

  it('najstarszePobranie: minimum po wpisach na ekranie z danymi, null gdy nic nie ma', async () => {
    const s = swiat()
    assert.equal(s.magazyn.najstarszePobranie(), null)
    const odA = s.magazyn.subskrybuj('a', () => {})
    const odB = s.magazyn.subskrybuj('b', () => {})
    await s.magazyn.zazadaj('a', s.dane(1))
    const wiekA = s.teraz()
    s.uplyw(90_000)
    await s.magazyn.zazadaj('b', s.dane(2))
    assert.equal(s.magazyn.najstarszePobranie(), wiekA)
    // Wpis, którego nikt już nie ogląda (zakładka zamknięta), nie postarza znacznika.
    odA()
    assert.equal(s.magazyn.najstarszePobranie(), s.teraz())
    odB()
    assert.equal(s.magazyn.najstarszePobranie(), null)
  })

  it('subskrypcja ogólna dostaje zmiany wpisów i zmianę zbioru wpisów na ekranie', async () => {
    const s = swiat()
    let razy = 0
    const odepnij = s.magazyn.subskrybujOgolne(() => {
      razy++
    })
    const odK = s.magazyn.subskrybuj('k', () => {})
    assert.equal(razy, 1)
    await s.magazyn.zazadaj('k', s.dane(1))
    assert.equal(razy, 3)
    odK()
    assert.equal(razy, 4)
    odepnij()
  })
})

describe('polaczStany: sekcja zależna od dwóch widoków', () => {
  const ok = <T>(dane: T, pobrano: number): StanWidoku<T> => ({
    dane,
    blad: null,
    ladowanie: false,
    pobrano,
  })
  const ladowanie = <T>(): StanWidoku<T> => ({
    dane: null,
    blad: null,
    ladowanie: true,
    pobrano: null,
  })

  it('dane dopiero, gdy są oba; wiek to starszy z dwóch', () => {
    const wynik = polaczStany(ok('a', 200), ok(5, 100))
    assert.deepEqual(wynik.dane, ['a', 5])
    assert.equal(wynik.pobrano, 100)
    assert.equal(wynik.ladowanie, false)
    assert.equal(wynik.blad, null)
  })

  it('jeden widok się ładuje: brak danych i ładowanie', () => {
    const wynik = polaczStany(ok('a', 200), ladowanie<number>())
    assert.equal(wynik.dane, null)
    assert.equal(wynik.ladowanie, true)
    assert.equal(wynik.pobrano, 200)
  })

  it('błąd któregokolwiek widoku jest widoczny, a odmowa bramki nie ginie', () => {
    const odmowa: StanWidoku<number> = {
      dane: null,
      blad: { rodzaj: 'brak_dostepu' },
      ladowanie: false,
      pobrano: null,
    }
    assert.deepEqual(polaczStany(ok('a', 1), odmowa).blad, { rodzaj: 'brak_dostepu' })
    assert.deepEqual(polaczStany(odmowa, ok('a', 1)).blad, { rodzaj: 'brak_dostepu' })
    assert.equal(polaczStany(ok('a', 1), ok('b', 2)).blad, null)
  })
})
