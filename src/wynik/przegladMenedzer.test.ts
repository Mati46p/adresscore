// Menedżer przeglądu i jego złożenie z widokiem (#223, faza F3): kolejność ładowania (bieżące miasto
// pierwsze, tło po jego pierwszym kolorze, po 3 naraz), izolacja błędów (FR-013), wagi miast w stanie
// aplikacji (D9), stabilne referencje tła. Sieć udaje test, ale pliki są prawdziwe (public/dane), a stan
// aplikacji to świeża instancja `stan.ts`. Uruchom: node --test src/wynik/przegladMenedzer.test.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import type { Manifest, WskaznikMeta } from '../kontrakty/index.ts'
import { MIASTA, miasto, type SlugMiasta } from '../kontrakty/miasta.ts'
import type { IndeksKompaktu } from './kompakt.ts'
import {
  brakujaceWarstwy,
  type MenedzerPrzegladu,
  utworzKolejkePobran,
  utworzMenedzerPrzegladu,
  type WpisGotowy,
} from './przegladMenedzer.ts'
import { type Przeglad, utworzSkladacz, type Zlozenie } from './przegladSklad.ts'

type Stan = typeof import('./stan.ts')

let numerInstancji = 0
async function swiezyStan(): Promise<Stan> {
  return (await import(`./stan.ts?przeglad=${++numerInstancji}`)) as Stan
}

/** Jeden obieg „sieci”: pozwala innym zadaniom ruszyć, więc współbieżność jest obserwowalna. */
const obieg = () => new Promise<void>((ok) => setImmediate(ok))

async function czekajNa(warunek: () => boolean, opis: string) {
  for (let i = 0; i < 100_000; i++) {
    if (warunek()) return
    await obieg()
  }
  assert.fail(`nie doczekano: ${opis}`)
}

// ── Kolejka pobrań ───────────────────────────────────────────────────────────────────────

describe('kolejka pobrań', { timeout: 5000 }, () => {
  const ranga = (slug: SlugMiasta) => MIASTA.findIndex((m) => m.slug === slug)

  /** Zadanie, które kończy test: `dokoncz()` je domyka. */
  function reczne() {
    const zadania: { slug: SlugMiasta; start: number; dokoncz: () => void }[] = []
    let licznik = 0
    const praca = (slug: SlugMiasta) => () =>
      new Promise<SlugMiasta>((ok) => {
        zadania.push({ slug, start: ++licznik, dokoncz: () => ok(slug) })
      })
    return { zadania, praca, uruchomione: () => zadania.map((z) => z.slug) }
  }

  it('tło idzie po najwyżej `limit` naraz, a skończone zadanie zwalnia miejsce następnemu', async () => {
    const k = utworzKolejkePobran({ limit: 2, biezace: () => 'krakow', ranga })
    const r = reczne()
    const wyniki = ['lodz', 'lodz', 'lodz', 'lodz', 'lodz'].map(() =>
      k.dodaj('lodz', r.praca('lodz')),
    )
    assert.equal(r.zadania.length, 2)
    r.zadania[0]?.dokoncz()
    await czekajNa(() => r.zadania.length === 3, 'trzecie zadanie')
    assert.deepEqual(k.stan(), { oczekujace: 2, wTle: 2 })
    for (let i = 1; i < 5; i++) {
      await czekajNa(() => r.zadania.length > i, `zadanie ${i}`)
      r.zadania[i]?.dokoncz()
    }
    await Promise.all(wyniki)
    assert.deepEqual(k.stan(), { oczekujace: 0, wTle: 0 })
  })

  it('miasta w tle idą w kolejności rejestru, a w obrębie miasta w kolejności zgłoszeń', async () => {
    const k = utworzKolejkePobran({ limit: 1, biezace: () => 'krakow', ranga })
    const r = reczne()
    // Pierwsze zadanie zajmuje jedyne miejsce; reszta czeka i jest wybierana wg rangi.
    void k.dodaj('lodz', r.praca('lodz'))
    void k.dodaj('poznan', r.praca('poznan'))
    void k.dodaj('warszawa', r.praca('warszawa'))
    void k.dodaj('wroclaw', r.praca('wroclaw'))
    void k.dodaj('warszawa', r.praca('warszawa'))
    const kolejnosc: SlugMiasta[] = ['lodz']
    for (let i = 0; i < 4; i++) {
      r.zadania[i]?.dokoncz()
      await czekajNa(() => r.zadania.length === i + 2, `zadanie ${i + 2}`)
      kolejnosc.push(r.zadania[i + 1]?.slug as SlugMiasta)
    }
    assert.deepEqual(kolejnosc, ['lodz', 'warszawa', 'warszawa', 'wroclaw', 'poznan'])
  })

  it('bieżące miasto omija limit: jego zadania startują od razu, także gdy tło zajęło miejsca', () => {
    const k = utworzKolejkePobran({ limit: 1, biezace: () => 'krakow', ranga })
    const r = reczne()
    void k.dodaj('lodz', r.praca('lodz'))
    void k.dodaj('lodz', r.praca('lodz'))
    for (let i = 0; i < 6; i++) void k.dodaj('krakow', r.praca('krakow'))
    assert.deepEqual(
      r.uruchomione(),
      ['lodz', 'krakow', 'krakow', 'krakow', 'krakow', 'krakow', 'krakow'],
      'drugie zadanie Łodzi czeka, Kraków startuje całym stadem',
    )
    assert.deepEqual(k.stan(), { oczekujace: 1, wTle: 1 })
  })

  it('miasto, które staje się bieżące, przejmuje swoje oczekujące zadania po `pompuj()`', () => {
    let biezace: SlugMiasta = 'krakow'
    const k = utworzKolejkePobran({ limit: 1, biezace: () => biezace, ranga })
    const r = reczne()
    void k.dodaj('krakow', r.praca('krakow'))
    void k.dodaj('warszawa', r.praca('warszawa'))
    void k.dodaj('lodz', r.praca('lodz'))
    void k.dodaj('lodz', r.praca('lodz'))
    assert.deepEqual(r.uruchomione(), ['krakow', 'warszawa'])
    biezace = 'lodz'
    k.pompuj()
    assert.deepEqual(r.uruchomione(), ['krakow', 'warszawa', 'lodz', 'lodz'])
  })

  it('zadanie, które rzuca (także zaraz przy starcie), oddaje błąd i zwalnia miejsce', async () => {
    const k = utworzKolejkePobran({ limit: 1, biezace: () => 'krakow', ranga })
    const r = reczne()
    const pierwsze = k.dodaj('lodz', () => {
      throw new Error('od razu')
    })
    const drugie = k.dodaj('lodz', () => Promise.reject(new Error('później')))
    const trzecie = k.dodaj('lodz', r.praca('lodz'))
    await assert.rejects(pierwsze, /od razu/)
    await assert.rejects(drugie, /później/)
    await czekajNa(() => r.zadania.length === 1, 'trzecie zadanie')
    r.zadania[0]?.dokoncz()
    assert.equal(await trzecie, 'lodz')
    assert.deepEqual(k.stan(), { oczekujace: 0, wTle: 0 })
  })
})

// ── Menedżer na prawdziwych plikach ──────────────────────────────────────────────────────

const DANE = new URL('../../public/dane/', import.meta.url)
const SERWER = 'https://test.local/dane'

interface Zdarzenie {
  rodzaj: 'start' | 'koniec'
  url: string
}

interface Opcje {
  /** Błąd, którym kończy się żądanie o ten adres; null = bez awarii. */
  awaria?: (url: string) => Error | null
  /** Zamiast pliku o tym adresie serwer oddaje plik spod innego adresu (np. warstwa z innego kompaktu). */
  podmien?: (url: string) => string | null
  /** Podmienia manifest miasta (np. rozjechany z kompaktem). */
  manifest?: (slug: SlugMiasta, manifest: Manifest) => Manifest
  r10?: boolean
}

const slugZAdresu = (url: string): SlugMiasta =>
  (/\/miasta\/([a-z]+)(?:\/|$)/.exec(url)?.[1] ?? 'krakow') as SlugMiasta

const wTle = (url: string) => url.includes('/miasta/')

function kopia(bufor: Buffer): ArrayBuffer {
  const k = new ArrayBuffer(bufor.byteLength)
  new Uint8Array(k).set(bufor)
  return k
}

/** Środowisko: menedżer, złożenie i stan jak w aplikacji, tylko sieć jest atrapą nad plikami z repo. */
async function srodowisko(opcje: Opcje = {}) {
  const s = await swiezyStan()
  const zdarzenia: Zdarzenie[] = []
  const dziennik = {
    wToku: 0,
    wTokuTla: 0,
    maxTla: 0,
    maxBiezace: 0,
    ostrzezenia: [] as string[],
    ustabilizowano: 0,
    metaPrzedOgloszeniem: [] as boolean[],
    metaMiasta: new Map<SlugMiasta, number>(),
  }
  const brama = { regula: null as null | ((url: string) => boolean), czeka: [] as (() => void)[] }
  const zwolnij = () => {
    brama.regula = null
    for (const ok of brama.czeka.splice(0)) ok()
  }
  const manifesty = new Map<SlugMiasta, Manifest>()
  const nasz = { opcje, r10: opcje.r10 ?? true }

  const sciezka = (url: string) => new URL(url.slice(`${SERWER}/`.length), DANE)

  async function zadanie<T>(url: string, czytaj: () => T): Promise<T> {
    zdarzenia.push({ rodzaj: 'start', url })
    dziennik.wToku++
    if (wTle(url)) dziennik.maxTla = Math.max(dziennik.maxTla, ++dziennik.wTokuTla)
    else dziennik.maxBiezace = Math.max(dziennik.maxBiezace, dziennik.wToku - dziennik.wTokuTla)
    try {
      await obieg()
      if (brama.regula?.(url)) await new Promise<void>((ok) => brama.czeka.push(ok))
      const blad = nasz.opcje.awaria?.(url)
      if (blad) throw blad
      return czytaj()
    } finally {
      dziennik.wToku--
      if (wTle(url)) dziennik.wTokuTla--
      zdarzenia.push({ rodzaj: 'koniec', url })
    }
  }

  const manifestMiasta = (baza: string, slug: SlugMiasta): Manifest => {
    const indeks = JSON.parse(
      readFileSync(sciezka(`${baza}/kompakt/indeks.json`), 'utf8'),
    ) as IndeksKompaktu
    const manifest: Manifest = {
      wygenerowano: '',
      wskazniki: Object.values(indeks.wskazniki).map((w) => ({
        ...w.meta,
        wersjaAdresow: w.wersjaAdresow,
      })),
    }
    const wynik = nasz.opcje.manifest?.(slug, manifest) ?? manifest
    manifesty.set(slug, wynik)
    return wynik
  }

  const menedzer: MenedzerPrzegladu = utworzMenedzerPrzegladu({
    miasta: MIASTA.map((m) => m.slug),
    baza: (slug) => `${SERWER}${miasto(slug).katalog ? `/${miasto(slug).katalog}` : ''}`,
    manifest: (baza) =>
      zadanie(`${baza}/manifest.json`, () => manifestMiasta(baza, slugZAdresu(baza))),
    json: <T>(url: string) =>
      zadanie(url, () => JSON.parse(readFileSync(sciezka(url), 'utf8')) as T),
    bajty: (url) =>
      zadanie(url, () => kopia(readFileSync(sciezka(nasz.opcje.podmien?.(url) ?? url)))),
    dodajMetaMiasta: (meta: readonly WskaznikMeta[]) => {
      const slug = [...manifesty].find(([, m]) => m.wskazniki === meta)?.[0]
      assert.ok(slug, 'meta nie pochodzi z manifestu żadnego miasta')
      // Miasto jeszcze nie jest ogłoszone: wagi stanu mają jego warstwy, zanim ktokolwiek je zobaczy.
      dziennik.metaPrzedOgloszeniem.push(menedzer.migawka().wpisy.get(slug) === undefined)
      dziennik.metaMiasta.set(slug, (dziennik.metaMiasta.get(slug) ?? 0) + 1)
      s.dodajMetaMiasta(meta)
    },
    ostrzez: (komunikat) => dziennik.ostrzezenia.push(komunikat),
    poUstabilizowaniu: () => dziennik.ustabilizowano++,
  })

  const zloz = utworzSkladacz()
  let ostatnie: Zlozenie | null = null
  /** To, co robi `usePrzeglad()` przy każdym renderze i efekcie. */
  const odswiez = (): Zlozenie => {
    const st = s.pobierzStan()
    const z = zloz(menedzer.migawka(), {
      biezace: st.miasto,
      wagi: st.wagi,
      kierunki: st.kierunki,
      warstwa: st.warstwa,
      r10: nasz.r10,
    })
    ostatnie = z
    menedzer.zazadaj(st.miasto, z.potrzeby)
    return z
  }
  menedzer.subskrybuj(() => odswiez())
  s.subskrybuj(() => odswiez())

  return {
    s,
    menedzer,
    zdarzenia,
    dziennik,
    brama,
    zwolnij,
    nasz,
    odswiez,
    przeglad: (): Przeglad => (ostatnie ?? odswiez()).przeglad,
    zloz,
    wpis: (slug: SlugMiasta) => menedzer.migawka().wpisy.get(slug),
    gotowy: (slug: SlugMiasta) => {
      const w = menedzer.migawka().wpisy.get(slug)
      assert.equal(w?.stan, 'gotowe', slug)
      return w as WpisGotowy
    },
    /** Czeka, aż każde miasto ma komplet warstw (albo wiadomo, że przeglądu nie będzie). */
    doSpokoju: () => czekajNa(() => dziennik.ustabilizowano > 0, 'wszystkie miasta gotowe'),
  }
}

type Srodowisko = Awaited<ReturnType<typeof srodowisko>>

/** Strona się otwiera: widok zgłasza bieżące miasto (domyślnie Kraków). */
async function otworz(opcje?: Opcje): Promise<Srodowisko> {
  const t = await srodowisko(opcje)
  t.odswiez()
  return t
}

const startyTla = (t: Srodowisko) =>
  t.zdarzenia.flatMap((z, i) => (z.rodzaj === 'start' && wTle(z.url) ? [i] : []))
const konceKrakowa = (t: Srodowisko) =>
  t.zdarzenia.flatMap((z, i) => (z.rodzaj === 'koniec' && !wTle(z.url) ? [i] : []))

describe('menedżer przeglądu: kolejność i limit pobrań', { timeout: 60_000 }, () => {
  it('przed pierwszym kolorem bieżącego miasta nie rusza żadne inne miasto', async () => {
    const t = await otworz()
    await czekajNa(() => t.wpis('krakow')?.stan === 'gotowe', 'Kraków gotowy')
    // Miasto jest ogłoszone, ale warstwy profilu dopiero idą (widok zgłosił je po ogłoszeniu).
    assert.deepEqual(startyTla(t), [], 'żadne pobranie spoza Krakowa przed jego pierwszym kolorem')
    await t.doSpokoju()
  })

  it('tło startuje dopiero po ostatniej warstwie profilu Krakowa i idzie po najwyżej 3 naraz', async () => {
    const t = await otworz()
    await t.doSpokoju()
    const pierwszeTlo = startyTla(t)[0] as number
    assert.ok(pierwszeTlo !== undefined, 'tło w ogóle ruszyło')
    const ostatniKoniecKrakowa = Math.max(...konceKrakowa(t))
    assert.ok(
      ostatniKoniecKrakowa < pierwszeTlo,
      `Kraków skończył w ${ostatniKoniecKrakowa}, tło ruszyło w ${pierwszeTlo}`,
    )
    assert.equal(t.dziennik.maxTla, 3, 'limit wykorzystany, ale nie przekroczony')
    // Wszystkie 9 miast dotarło, każde z kompletem warstw profilu.
    for (const m of MIASTA) assert.equal(t.wpis(m.slug)?.stan, 'gotowe', m.slug)
  })

  it('bieżące miasto pobiera warstwy bez limitu (jak przed #223), nie po 3', async () => {
    const t = await otworz()
    await t.doSpokoju()
    assert.ok(
      t.dziennik.maxBiezace > 10,
      `Kraków pobierał co najwyżej ${t.dziennik.maxBiezace} plików naraz`,
    )
  })

  it('każdy plik pobiera się raz: ponowne zgłoszenie tego samego niczego nie dubluje', async () => {
    const t = await otworz()
    await t.doSpokoju()
    const przed = t.zdarzenia.length
    t.odswiez()
    t.odswiez()
    await obieg()
    assert.equal(t.zdarzenia.length, przed)
    const startowe = t.zdarzenia.filter((z) => z.rodzaj === 'start').map((z) => z.url)
    assert.equal(new Set(startowe).size, startowe.length, 'powtórzone żądanie')
  })

  it('wszystkie miasta przechodzą przez menedżer: heksy r8/r9 i granice są na miejscu', async () => {
    const t = await otworz()
    await t.doSpokoju()
    const p = t.przeglad()
    assert.deepEqual(
      p.miasta.map((m) => [m.slug, m.stan]),
      MIASTA.map((m) => [m.slug, 'gotowe']),
    )
    assert.ok(p.miasta.every((m) => m.granice !== null))
    assert.equal(p.tlo.heksy[8].size, 3269)
    assert.equal(p.tlo.heksy[9].size, 16538)
    assert.ok(p.kadrWszystkich)
    for (const m of MIASTA) assert.equal(p.miastoPunktu(...m.srodek), m.slug, m.slug)
  })
})

describe('menedżer przeglądu: wagi miast w stanie aplikacji (D9)', { timeout: 60_000 }, () => {
  it('warstwy miasta trafiają do wag przed ogłoszeniem miasta, raz na miasto', async () => {
    const t = await otworz()
    await t.doSpokoju()
    assert.deepEqual([...t.dziennik.metaMiasta.keys()].sort(), MIASTA.map((m) => m.slug).sort())
    assert.ok([...t.dziennik.metaMiasta.values()].every((n) => n === 1))
    assert.ok(t.dziennik.metaPrzedOgloszeniem.every(Boolean))
    // Wagi znają warstwy z sumy miast, także te, których Kraków nie ma.
    const wagi = t.s.pobierzStan().wagi
    const krakow = t.gotowy('krakow').manifest.wskazniki.map((w) => w.id)
    const obce = MIASTA.flatMap((m) => t.gotowy(m.slug).manifest.wskazniki.map((w) => w.id)).filter(
      (id) => !krakow.includes(id),
    )
    assert.ok(obce.length > 0)
    for (const id of obce) assert.ok(id in wagi, `brak wagi warstwy ${id}`)
  })
})

describe('menedżer przeglądu: błędy jednego miasta (FR-013)', { timeout: 60_000 }, () => {
  it('miasto, którego heksy się nie wczytały, jest `brak`, a reszta działa i melduje komplet', async () => {
    const t = await otworz({
      awaria: (url) => (url.includes('/miasta/lodz/kompakt/heksy.') ? new Error('HTTP 503') : null),
    })
    await t.doSpokoju()
    const lodz = t.wpis('lodz')
    assert.equal(lodz?.stan, 'brak')
    assert.match(lodz?.stan === 'brak' ? lodz.powod : '', /503/)
    for (const m of MIASTA.filter((m) => m.slug !== 'lodz')) {
      assert.equal(t.wpis(m.slug)?.stan, 'gotowe', m.slug)
    }
    assert.ok(t.dziennik.ostrzezenia.some((o) => o.includes('lodz')))
    // Tło ma resztę miast, bez Łodzi: widok pokazuje `brak` w liście miast.
    const p = t.przeglad()
    assert.equal(p.miasta.find((m) => m.slug === 'lodz')?.stan, 'brak')
    assert.equal(
      p.tlo.miastoHeksu(t.gotowy('warszawa').podstawa.poziomy[8].heksy[0] as string),
      'Warszawa',
    )
  })

  it('kompakt niezgodny z manifestem to `brak` z powodem, bez wpływu na inne miasta', async () => {
    const t = await otworz({
      manifest: (slug, manifest) =>
        slug === 'gdansk' ? { ...manifest, wskazniki: manifest.wskazniki.slice(0, -1) } : manifest,
    })
    await t.doSpokoju()
    const gdansk = t.wpis('gdansk')
    assert.equal(gdansk?.stan, 'brak')
    assert.match(
      gdansk?.stan === 'brak' ? gdansk.powod : '',
      /nieaktualny kompakt: .*nadmiarowa warstwa/,
    )
    assert.equal(t.wpis('szczecin')?.stan, 'gotowe')
    // Nie pobieramy dla niego niczego poza indeksem i manifestem: heksy.bin nie ruszył.
    assert.ok(!t.zdarzenia.some((z) => z.url.includes('/miasta/gdansk/kompakt/heksy.')))
  })

  it('miasto `brak` dostaje drugą szansę, gdy użytkownik w nie wejdzie', async () => {
    const t = await otworz({
      awaria: (url) =>
        url.includes('/miasta/poznan/kompakt/heksy.') ? new Error('HTTP 503') : null,
    })
    await t.doSpokoju()
    assert.equal(t.wpis('poznan')?.stan, 'brak')
    t.nasz.opcje = {} // sieć wróciła
    const zadanPrzed = t.zdarzenia.length
    t.s.ustawMiasto('poznan')
    await czekajNa(() => t.wpis('poznan')?.stan === 'gotowe', 'Poznań po ponowieniu')
    assert.ok(t.zdarzenia.length > zadanPrzed)
  })

  it('miasto `brak` nie męczy sieci: bez wejścia w nie nie ma ponowień', async () => {
    const t = await otworz({
      awaria: (url) =>
        url.includes('/miasta/poznan/kompakt/heksy.') ? new Error('HTTP 503') : null,
    })
    await t.doSpokoju()
    const zadaniaPoznania = () =>
      t.zdarzenia.filter((z) => z.rodzaj === 'start' && z.url.includes('/miasta/poznan/')).length
    const przed = zadaniaPoznania()
    assert.ok(przed > 0)
    t.odswiez()
    t.s.ustawWage('halas_ldwn', 1)
    t.s.wybierzPersone('singiel')
    await obieg()
    assert.equal(zadaniaPoznania(), przed)
  })

  it('warstwa, której plik się nie wczytał, nie blokuje miasta: liczy się jak brak danych', async () => {
    let zepsuta = ''
    const t = await otworz({
      awaria: (url) => {
        if (!url.includes('/miasta/poznan/kompakt/warstwy/')) return null
        zepsuta ||= url
        return url === zepsuta ? new Error('HTTP 500') : null
      },
    })
    await t.doSpokoju()
    const poznan = t.gotowy('poznan')
    assert.equal(poznan.nieudane.size, 1)
    assert.ok(t.dziennik.ostrzezenia.some((o) => o.includes('poznan')))
    // Miasto jest w tle z kolorami policzonymi bez tej warstwy.
    const tlo = t.przeglad().tlo
    const heks = poznan.podstawa.poziomy[9].heksy[0] as string
    assert.equal(tlo.miastoHeksu(heks), 'Poznań')
    assert.ok(tlo.heksy[9].has(heks))
  })

  it('plik warstwy z innego kompaktu (inna liczba komórek) jest odrzucany jak zepsuty', async () => {
    const indeksLodzi = JSON.parse(
      readFileSync(new URL('miasta/lodz/kompakt/indeks.json', DANE), 'utf8'),
    ) as IndeksKompaktu
    const warstwaLodzi = `${SERWER}/miasta/lodz/kompakt/${Object.values(indeksLodzi.wskazniki)[0]?.heksy.plik}`
    let podmieniona = ''
    const t = await otworz({
      podmien: (url) => {
        if (!url.includes('/miasta/poznan/kompakt/warstwy/')) return null
        podmieniona ||= url
        return url === podmieniona ? warstwaLodzi : null
      },
    })
    await t.doSpokoju()
    const poznan = t.gotowy('poznan')
    assert.equal(poznan.nieudane.size, 1, 'komórki Łodzi nie pasują do heksów Poznania')
    assert.ok(t.dziennik.ostrzezenia.some((o) => o.includes('poznan')))
    // Poznań ma pozostałe warstwy i kolory.
    assert.equal(
      t.przeglad().tlo.miastoHeksu(poznan.podstawa.poziomy[8].heksy[0] as string),
      'Poznań',
    )
  })

  it('bieżące miasto bez przeglądu nie wstrzymuje reszty: tło rusza mimo braku jego pierwszego koloru', async () => {
    const t = await otworz({
      awaria: (url) => (url === `${SERWER}/manifest.json` ? new Error('HTTP 500') : null),
    })
    await t.doSpokoju()
    assert.equal(t.wpis('krakow')?.stan, 'brak')
    assert.equal(t.przeglad().biezaceR10, null, 'czekaj na pełne dane')
    for (const m of MIASTA.filter((m) => m.slug !== 'krakow')) {
      assert.equal(t.wpis(m.slug)?.stan, 'gotowe', m.slug)
    }
  })
})

describe('menedżer przeglądu: widok i stabilne referencje', { timeout: 60_000 }, () => {
  it('ten sam stan aplikacji i ta sama migawka dają ten sam obiekt przeglądu i te same potrzeby', async () => {
    const t = await otworz()
    await t.doSpokoju()
    const a = t.odswiez()
    const b = t.odswiez()
    assert.equal(a.przeglad, b.przeglad)
    assert.equal(a.potrzeby, b.potrzeby)
  })

  it('zmiana niezwiązana z kolorami (wybrany adres) nie zmienia tła ani przeglądu', async () => {
    const t = await otworz()
    await t.doSpokoju()
    const przed = t.odswiez()
    t.s.wybierzAdres(7)
    const po = t.odswiez()
    assert.equal(po.przeglad, przed.przeglad)
    assert.equal(po.przeglad.tlo, przed.przeglad.tlo)
    assert.equal(po.potrzeby, przed.potrzeby)
  })

  it('waga warstwy, której nie ma w tle, przelicza tylko bieżące miasto: tło zostaje tym samym obiektem', async () => {
    const t = await otworz()
    await t.doSpokoju()
    const idTla = new Set(
      MIASTA.filter((m) => m.slug !== 'krakow').flatMap((m) =>
        t.gotowy(m.slug).manifest.wskazniki.map((w) => w.id),
      ),
    )
    const tylkoKrakow = t
      .gotowy('krakow')
      .manifest.wskazniki.find((w) => !idTla.has(w.id) && w.kierunek !== 'neutralny')
    assert.ok(tylkoKrakow, 'Kraków ma warstwę, której nie ma żadne inne miasto')
    const przed = t.odswiez()
    t.s.ustawWage(tylkoKrakow.id, 4)
    await czekajNa(
      () => t.gotowy('krakow').warstwy.has(tylkoKrakow.id),
      `warstwa ${tylkoKrakow.id}`,
    )
    const po = t.odswiez()
    assert.equal(po.przeglad.tlo, przed.przeglad.tlo, 'tło nie ma powodu się zmieniać')
    assert.notEqual(po.przeglad.biezaceR10, przed.przeglad.biezaceR10, 'r10 Krakowa się zmienia')
    assert.notEqual(po.potrzeby, przed.potrzeby)
    // Miasta, których ta zmiana nie dotyczy, zgłaszają dokładnie to samo zapotrzebowanie (ta sama tablica).
    for (const m of MIASTA.filter((m) => m.slug !== 'krakow')) {
      assert.equal(po.potrzeby.get(m.slug), przed.potrzeby.get(m.slug), m.slug)
    }
  })

  it('zmiana profilu: stare kolory zostają, dopóki nie dojdą nowe warstwy, potem tło się zmienia', async () => {
    const t = await otworz()
    await t.doSpokoju()
    const przed = t.odswiez().przeglad
    const wartosciPrzed = [...przed.tlo.heksy[9].values()]
    const startowPrzed = t.zdarzenia.length

    t.brama.regula = (url) => url.includes('/warstwy/')
    t.s.wybierzPersone('singiel')
    await czekajNa(() => t.zdarzenia.length > startowPrzed, 'nowe warstwy zamówione')
    await obieg()
    const w_trakcie = t.odswiez()
    // Miasta, którym brakuje warstw nowego profilu, zachowują kolory poprzedniego, a nie gasną.
    const czekajace = MIASTA.filter(
      (m) =>
        m.slug !== 'krakow' &&
        brakujaceWarstwy(t.gotowy(m.slug), w_trakcie.potrzeby.get(m.slug) ?? []).length > 0,
    )
    assert.ok(czekajace.length > 0, 'nowy profil wymaga warstw, które jeszcze nie przyszły')
    for (const m of czekajace) {
      for (const h of t.gotowy(m.slug).podstawa.poziomy[9].heksy) {
        assert.equal(
          w_trakcie.przeglad.tlo.heksy[9].get(h),
          przed.tlo.heksy[9].get(h),
          `${m.slug} ${h}`,
        )
      }
    }
    assert.equal(
      t.zdarzenia
        .slice(startowPrzed)
        .filter((z) => z.rodzaj === 'start' && !z.url.includes('/warstwy/')).length,
      0,
      'poza warstwami nic nie trzeba było pobierać',
    )

    t.zwolnij()
    await czekajNa(() => t.odswiez().przeglad.tlo !== przed.tlo, 'nowe tło')
    await czekajNa(
      () =>
        MIASTA.every(
          (m) =>
            brakujaceWarstwy(t.gotowy(m.slug), t.odswiez().potrzeby.get(m.slug) ?? []).length === 0,
        ),
      'komplet warstw nowego profilu',
    )
    const wartosciPo = [...t.odswiez().przeglad.tlo.heksy[9].values()]
    assert.equal(wartosciPo.length, wartosciPrzed.length)
    assert.ok(
      wartosciPo.some((v, i) => v !== wartosciPrzed[i]),
      'inny profil, inne kolory',
    )
    // Nikt po drodze nie dostał zera zamiast braku danych.
    assert.ok(wartosciPo.every((v) => v === null || v > 0))
  })

  it('zmiana bieżącego miasta: bez nowych pobrań, Kraków wchodzi do tła, Łódź z tła do r10', async () => {
    const t = await otworz()
    await t.doSpokoju()
    const lodz = t.gotowy('lodz')
    const krakowR8 = t.gotowy('krakow').podstawa.poziomy[8].heksy[0] as string
    const lodzR8 = lodz.podstawa.poziomy[8].heksy[0] as string
    const przed = t.odswiez().przeglad
    assert.equal(przed.tlo.miastoHeksu(lodzR8), 'Łódź')
    assert.equal(przed.tlo.miastoHeksu(krakowR8), null)
    const zdarzenPrzed = t.zdarzenia.length

    t.s.ustawMiasto('lodz')
    const po = t.odswiez().przeglad
    assert.equal(po.tlo.miastoHeksu(lodzR8), null, 'bieżące miasto wypada z tła')
    assert.equal(po.tlo.miastoHeksu(krakowR8), 'Kraków', 'dotychczasowe bieżące wchodzi do tła')
    assert.equal(po.biezaceR10?.size, lodz.podstawa.poziomy[10].heksy.length)
    assert.ok([...(po.biezaceR10 ?? []).values()].some((v) => v !== null))
    await obieg()
    assert.equal(t.zdarzenia.length, zdarzenPrzed, 'wszystko było w pamięci')
  })

  it('pełne dane bieżącego miasta gotowe (r10 = false): przegląd nie liczy r10 i oddaje null', async () => {
    const t = await otworz()
    await t.doSpokoju()
    const r10 = t.odswiez().przeglad.biezaceR10
    assert.ok(r10)
    t.nasz.r10 = false
    assert.equal(t.odswiez().przeglad.biezaceR10, null)
    t.nasz.r10 = true
    assert.equal(t.odswiez().przeglad.biezaceR10, r10, 'wraca z pamięci, bez nowego liczenia')
  })

  it('warstwa wybrana na mapie, której miasto nie ma, daje to miasto w szrafurze, a podpis nazywa warstwę', async () => {
    const t = await otworz()
    await t.doSpokoju()
    const idLodzi = new Set(t.gotowy('lodz').manifest.wskazniki.map((w) => w.id))
    const obca = t
      .gotowy('krakow')
      .manifest.wskazniki.find((w) => !idLodzi.has(w.id) && w.kierunek !== 'neutralny')
    assert.ok(obca)
    t.s.ustawWarstwe(obca.id)
    await t.doSpokoju()
    await czekajNa(() => t.gotowy('krakow').warstwy.has(obca.id), 'warstwa Krakowa')
    const p = t.odswiez().przeglad
    assert.equal(p.podpis, obca.nazwa)
    const lodzR9 = t.gotowy('lodz').podstawa.poziomy[9].heksy
    assert.ok(
      lodzR9.every((h) => p.tlo.heksy[9].get(h) === null),
      'Łódź: same null',
    )
    assert.equal(
      [...p.tlo.heksy[9].values()].filter((v) => v === 0).length,
      0,
      'nigdzie zero zamiast braku danych',
    )
    // Miasta, które warstwę mają, są w kolorze: tło nie zgasło całe.
    assert.ok(
      [...p.tlo.heksy[9].values()].some((v) => v !== null) ||
        !MIASTA.some(
          (m) =>
            m.slug !== 'krakow' &&
            t.gotowy(m.slug).manifest.wskazniki.some((w) => w.id === obca.id),
        ),
    )
  })
})
