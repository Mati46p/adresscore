// Rejestr miast (#223) kontra dane na serwerze i reguły, od których zależą inne miejsca.
// Uruchom: node --test src/kontrakty/miasta.test.ts
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import vm from 'node:vm'
import { latLngToCell } from 'h3-js'
import { czySlugMiasta, MIASTA, MIASTO_DOMYSLNE, miasto } from './miasta.ts'

const DANE = new URL('../../public/dane/', import.meta.url)
const czytaj = <T>(sciezka: URL): T => JSON.parse(readFileSync(sciezka, 'utf8'))

/** Katalog zbioru w `public/dane/`: główny dla Krakowa, `miasta/<slug>/` dla reszty. */
const katalogDanych = (katalog: string) => new URL(katalog ? `${katalog}/` : '', DANE)

const slugiPozaKrakowem = MIASTA.filter((m) => m.slug !== 'krakow').map((m) => m.slug)

describe('rejestr miast', () => {
  it('Kraków jest pierwszy i jest miastem domyślnym', () => {
    assert.equal(MIASTO_DOMYSLNE, 'krakow')
    assert.equal(MIASTA[0]?.slug, MIASTO_DOMYSLNE)
  })

  it('slugi i nazwy są unikalne', () => {
    assert.equal(new Set(MIASTA.map((m) => m.slug)).size, MIASTA.length)
    assert.equal(new Set(MIASTA.map((m) => m.nazwa)).size, MIASTA.length)
  })

  it('slug to same małe litery (wymagają tego service worker i middleware manifestu)', () => {
    for (const m of MIASTA) assert.match(m.slug, /^[a-z]+$/, m.slug)
  })

  it('wMiescie zaczyna się od „w " albo „we " i ma coś po przyimku', () => {
    for (const m of MIASTA) assert.match(m.wMiescie, /^(w|we) \S+/, `${m.slug}: „${m.wMiescie}"`)
  })

  it('katalog: pusty dla Krakowa, miasta/<slug> dla reszty', () => {
    for (const m of MIASTA) {
      assert.equal(m.katalog, m.slug === 'krakow' ? '' : `miasta/${m.slug}`, m.slug)
    }
  })

  it('środek leży w kaflu adresów miasta (lon, lat – nie odwrotnie)', () => {
    for (const m of MIASTA) {
      const indeks = czytaj<{ resKafla: number; kafle: { h3: string }[] }>(
        new URL('kompakt/indeks.json', katalogDanych(m.katalog)),
      )
      const [lon, lat] = m.srodek
      const kafel = latLngToCell(lat, lon, indeks.resKafla)
      assert.ok(
        indeks.kafle.some((k) => k.h3 === kafel),
        `${m.slug}: środek [${lon}, ${lat}] poza kaflami adresów miasta`,
      )
    }
  })
})

describe('rejestr miast a katalogi public/dane/miasta', () => {
  // Miasto = katalog z `kompakt/indeks.json`. Katalog bez indeksu to zbiór w przygotowaniu (ETL
  // jeszcze nie zbudował kompaktu): front go nie widzi, więc rejestr też nie ma go znać.
  const naDysku = readdirSync(new URL('miasta/', DANE), { withFileTypes: true })
    .filter((w) => w.isDirectory())
    .map((w) => w.name)
    .filter((nazwa) => existsSync(new URL(`miasta/${nazwa}/kompakt/indeks.json`, DANE)))
    .sort()

  it('każdy katalog miasta z danymi ma wpis w MIASTA', () => {
    const bezWpisu = naDysku.filter((s) => !czySlugMiasta(s))
    assert.deepEqual(
      bezWpisu,
      [],
      `Dane w public/dane/miasta bez wpisu w src/kontrakty/miasta.ts: ${bezWpisu.join(', ')}`,
    )
  })

  it('każdy wpis w MIASTA (poza Krakowem) ma katalog z danymi', () => {
    const bezKatalogu = slugiPozaKrakowem.filter((s) => !naDysku.includes(s))
    assert.deepEqual(
      bezKatalogu,
      [],
      `Wpisy w MIASTA bez public/dane/miasta/<slug>/kompakt/indeks.json: ${bezKatalogu.join(', ')}`,
    )
  })

  it('zbiór slugów poza Krakowem = katalogi z danymi', () => {
    assert.deepEqual([...slugiPozaKrakowem].sort(), naDysku)
  })

  it('Kraków ma dane w katalogu głównym', () => {
    assert.ok(existsSync(new URL('kompakt/indeks.json', DANE)))
  })

  it('każdy zbiór ma adresy i pliki wskaźników (z nich plugin Vite składa manifest)', () => {
    for (const m of MIASTA) {
      const katalog = katalogDanych(m.katalog)
      const wskazniki = readdirSync(new URL('wskazniki/', katalog)).filter((p) =>
        p.endsWith('.json'),
      )
      assert.ok(wskazniki.length > 0, `${m.slug}: brak plików w wskazniki/`)
      assert.ok(existsSync(new URL('adresy.json', katalog)), `${m.slug}: brak adresy.json`)
    }
  })
})

describe('miasto() i czySlugMiasta()', () => {
  it('znany slug daje miasto, a typ SlugMiasta – zawsze miasto (bez null)', () => {
    for (const m of MIASTA) {
      assert.equal(miasto(m.slug), m)
      assert.equal(czySlugMiasta(m.slug), true)
    }
    assert.equal(miasto('lodz').wMiescie, 'w Łodzi')
  })

  it('obcy napis z linku to null, także nazwy z prototypu obiektu', () => {
    for (const obcy of [
      '',
      'berlin',
      'Krakow',
      'krakow ',
      'constructor',
      '__proto__',
      'toString',
    ]) {
      assert.equal(miasto(obcy), null, JSON.stringify(obcy))
      assert.equal(czySlugMiasta(obcy), false, JSON.stringify(obcy))
    }
  })
})

describe('service worker (public/sw.js)', () => {
  const zrodlo = readFileSync(new URL('../../public/sw.js', import.meta.url), 'utf8')

  /** Wyjątek „zawsze z sieci" wyjęty z kodu workera: sw.js to zwykły skrypt, nie da się go zaimportować. */
  function wyjatekZSieci(): RegExp {
    const literal = /^const ZAWSZE_Z_SIECI = (\/.+\/[a-z]*)$/m.exec(zrodlo)?.[1]
    assert.ok(literal, 'brak stałej ZAWSZE_Z_SIECI w public/sw.js')
    const koniec = literal.lastIndexOf('/')
    return new RegExp(literal.slice(1, koniec), literal.slice(koniec + 1))
  }

  it('wyjątek jest używany w gałęzi /dane/', () => {
    assert.match(zrodlo, /ZAWSZE_Z_SIECI\.test\(/)
  })

  it('wyjątek obejmuje indeks kompaktu i manifest Krakowa oraz każdego miasta, a nic poza nimi', () => {
    const wyjatek = wyjatekZSieci()
    for (const m of MIASTA) {
      const katalog = `/dane/${m.katalog ? `${m.katalog}/` : ''}`
      for (const plik of ['kompakt/indeks.json', 'manifest.json']) {
        assert.ok(wyjatek.test(`${katalog}${plik}`), `${m.slug}: ${katalog}${plik}`)
      }
    }
    for (const inny of [
      '/dane/miasta/lodz/kompakt/heksy.75f6074230.bin',
      '/dane/miasta/lodz/adresy.json',
      '/dane/miasta/lodz/wskazniki/halas_ldwn.json',
      '/dane/adresy.json',
      '/dane/kompakt/skale.639eb9818b.json',
      '/dane/miasta/lodz/kompakt/skale.639eb9818b.json',
      // Te same nazwy w głębszym katalogu albo z dopiskiem to nie manifest ani indeks zbioru.
      '/dane/miasta/lodz/budynki/manifest.json',
      '/dane/wskazniki/manifest.json',
      '/dane/stare/dane/manifest.json',
      '/dane/miasta/lodz/manifest.json.map',
      '/dane/miasta/lodz/kompakt/indeks.json.map',
    ]) {
      assert.equal(wyjatek.test(inny), false, inny)
    }
  })

  // Wzorzec wyżej to tylko napis w kodzie. Tu działa prawdziwy kod workera na atrapach API
  // przeglądarki (Cache API, fetch, zdarzenie `fetch`) i liczy się to, co widzi użytkownik: skąd
  // przyszedł plik. Wzorzec niepodpięty do obsługi `/dane/` przejdzie test wyżej, a tu zawiedzie.
  // Dlaczego manifest razem z indeksem: przegląd miasta porównuje je ze sobą (`niezgodnoscKompaktu`),
  // a jedno z cache i drugie z sieci po wdrożeniu danych daje miastu `brak` do końca sesji.
  describe('trasa pliku w workerze', () => {
    const ORIGIN = 'https://adresscore.test'
    type Obsluga = (zdarzenie: {
      request: Request
      respondWith: (odpowiedz: Promise<Response>) => void
      waitUntil: (zadanie: Promise<unknown>) => void
    }) => void

    /**
     * GET `sciezka` w workerze, który ma w cache `kopia`, a z sieci dostaje `siec` (null = brak sieci).
     * Zwraca treść odpowiedzi: „z sieci" albo „z kopii".
     */
    async function odpowiedzWorkera(
      sciezka: string,
      { siec, kopia }: { siec: string | null; kopia: string },
    ): Promise<string> {
      const kopie = new Map<string, Response>([[`${ORIGIN}${sciezka}`, new Response(kopia)]])
      const klucz = (zad: Request | string) => (typeof zad === 'string' ? zad : zad.url)
      const cache = {
        match: async (zad: Request | string) => kopie.get(klucz(zad))?.clone(),
        put: async (zad: Request | string, odp: Response) => {
          kopie.set(klucz(zad), odp)
        },
        addAll: async () => {},
      }
      const nasluchy = new Map<string, Obsluga>()
      vm.runInNewContext(zrodlo, {
        self: {
          location: { origin: ORIGIN },
          addEventListener: (typ: string, f: Obsluga) => {
            nasluchy.set(typ, f)
          },
          skipWaiting: async () => {},
          clients: { claim: async () => {} },
        },
        caches: { open: async () => cache, keys: async () => [], delete: async () => true },
        fetch: async () => {
          if (siec === null) throw new TypeError('Failed to fetch')
          return new Response(siec)
        },
        Headers,
        Request,
        Response,
        URL,
        console,
      })
      const odpowiedzi: Promise<Response>[] = []
      const zadania: Promise<unknown>[] = []
      nasluchy.get('fetch')?.({
        request: new Request(`${ORIGIN}${sciezka}`),
        respondWith: (odpowiedz) => odpowiedzi.push(odpowiedz),
        waitUntil: (zadanie) => zadania.push(zadanie),
      })
      const [odpowiedz] = odpowiedzi
      assert.ok(odpowiedz, `${sciezka}: worker nie obsłużył żądania`)
      const tresc = await (await odpowiedz).text()
      await Promise.all(zadania) // odświeżanie w tle kończy się przed końcem testu
      return tresc
    }

    const SCIEZKI_Z_SIECI = MIASTA.flatMap((m) => {
      const katalog = `/dane/${m.katalog ? `${m.katalog}/` : ''}`
      return [`${katalog}kompakt/indeks.json`, `${katalog}manifest.json`]
    })

    it('indeks kompaktu i manifest: sieć najpierw, więc po wdrożeniu danych oba są świeże', async () => {
      for (const sciezka of SCIEZKI_Z_SIECI) {
        const tresc = await odpowiedzWorkera(sciezka, { siec: 'z sieci', kopia: 'z kopii' })
        assert.equal(tresc, 'z sieci', sciezka)
      }
    })

    it('indeks kompaktu i manifest bez sieci: kopia z cache, więc tryb offline działa', async () => {
      for (const sciezka of SCIEZKI_Z_SIECI) {
        const tresc = await odpowiedzWorkera(sciezka, { siec: null, kopia: 'z kopii' })
        assert.equal(tresc, 'z kopii', sciezka)
      }
    })

    it('reszta danych: kopia z cache od razu, bez czekania na sieć', async () => {
      for (const sciezka of ['/dane/miasta/lodz/adresy.json', '/dane/wskazniki/halas_ldwn.json']) {
        const tresc = await odpowiedzWorkera(sciezka, { siec: 'z sieci', kopia: 'z kopii' })
        assert.equal(tresc, 'z kopii', sciezka)
      }
    })
  })
})
