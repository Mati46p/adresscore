// Regresja E10 (#108): wynik symulatora Miasta nie zależy od tego, czy użytkownik był w Biznesie.
//
// Wejście na ekran Biznes ustawia w stanie tryb „biznes” (wagi sklepu i ludności zamiast profilu
// mieszkańca), a symulator liczy litery na `stan.wagi`. Tryb zostawał po powrocie do Miasta, więc ten
// sam obiekt, który wcześniej awansował adresy, po wizycie w Biznesie nie awansował żadnego.
//
// Każdy test dostaje własną instancję `stan.ts` (import z innym `?query` to osobny moduł), bo stan
// aplikacji jest jednym obiektem modułu. Bilans liczy prawdziwy silnik symulatora na prawdziwych
// wagach ze stanu – tak jak ekran Miasta (`useStan(wagi)` → `przygotujBaze` → `symuluj`).
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { WskaznikMeta } from '../kontrakty/index.ts'
import { BEZ_FILTROW } from './biznesUslugi.ts'
import { ustawieniaPersony } from './persony.ts'
import { grupujHeksy, przygotujWskaznik, type WskaznikPrzygotowany } from './silnik.ts'
import { przygotujBaze, symuluj, type WynikSymulacji } from './symulacja.ts'
import { obiektyDoTekstu, obiektyZTekstu } from './symulacjaUrl.ts'
import { czyDoMieszkanca } from './trybyAplikacji.ts'
import { czytajHash, type Ekran, ID_MIEJSC } from './url.ts'

type Stan = typeof import('./stan.ts')

let numerInstancji = 0
/** Świeży stan, jak po przeładowaniu strony (F5): osobny moduł, bez pamięci poprzedniego. */
async function swiezyStan(): Promise<Stan> {
  return (await import(`./stan.ts?instancja=${++numerInstancji}`)) as Stan
}

// ── Małe miasto: 24 × 24 adresy co 70 m wokół Rynku ──────────────────────────────────────

const RYNEK = { lon: 19.9372, lat: 50.0614 }
const M_LAT = 1 / 111_320
const M_LON = 1 / (111_320 * Math.cos((RYNEK.lat * Math.PI) / 180))
const BOK = 24
const KROK_M = 70

const punkt = (dxM: number, dyM: number) => ({
  lon: RYNEK.lon + dxM * M_LON,
  lat: RYNEK.lat + dyM * M_LAT,
})

const ADRESY = Array.from({ length: BOK * BOK }, (_, i) => {
  const x = i % BOK
  const y = Math.floor(i / BOK)
  return {
    ...punkt((x - BOK / 2) * KROK_M, (y - BOK / 2) * KROK_M),
    dzielnica: 'I Stare Miasto',
    gmina: 'Kraków',
    h3: `h${Math.floor(x / 3)}_${Math.floor(y / 3)}`,
  }
})
const GRUPY = grupujHeksy(ADRESY.map((a) => a.h3))

function meta(id: string, dodatki: Partial<WskaznikMeta> = {}): WskaznikMeta {
  return {
    id,
    kategoria: 'codziennosc',
    nazwa: id,
    opis: '',
    jednostka: 'm',
    kierunek: 'mniej-lepiej',
    rozdzielczosc: 'adres',
    zrodla: [],
    zadanie: 0,
    ...dodatki,
  }
}

/** Odległość do najbliższego z punktów (w metrach, płaska siatka wystarcza na 1,7 km). */
function doNajblizszego(punkty: readonly { lon: number; lat: number }[], a: (typeof ADRESY)[0]) {
  return Math.min(
    ...punkty.map((p) => Math.hypot((p.lon - a.lon) / M_LON, (p.lat - a.lat) / M_LAT)),
  )
}

const ISTNIEJACE = {
  przystanki: [punkt(-700, 700), punkt(0, 0)],
  przedszkola: [punkt(-700, -700), punkt(700, 700)],
  sklepy: [punkt(-500, 0), punkt(500, 100), punkt(0, -600)],
}

const WSKAZNIKI: WskaznikPrzygotowany[] = [
  {
    meta: meta('przystanek_odleglosc', { kategoria: 'transport', zakres: [0, 1500] }),
    wartosci: ADRESY.map((a) => doNajblizszego(ISTNIEJACE.przystanki, a)),
  },
  {
    meta: meta('przedszkole_odleglosc', { zakres: [0, 1500] }),
    wartosci: ADRESY.map((a) => doNajblizszego(ISTNIEJACE.przedszkola, a)),
  },
  {
    meta: meta('sklep_odleglosc', { zakres: [0, 1500] }),
    wartosci: ADRESY.map((a) => doNajblizszego(ISTNIEJACE.sklepy, a)),
  },
  {
    meta: meta('ludnosc_1km', {
      kategoria: 'kontekst',
      kierunek: 'neutralny',
      jednostka: 'osób',
      zakres: [0, 8000],
    }),
    wartosci: ADRESY.map((_, i) => 500 + ((i * 7919) % 5000)),
  },
].map((p) => przygotujWskaznik({ ...p, wersjaAdresow: 'test' }))
const META = WSKAZNIKI.map((w) => w.meta)

// Przedszkole i przystanek w narożniku bez żadnego z nich: awansują okoliczne adresy profilu
// mieszkańca (rodzina, senior), a przy wagach Biznesu (sklep i ludność) nie zmieniają żadnej litery.
const OBIEKTY_A = obiektyDoTekstu([
  { typ: 'przedszkole', ...punkt(700, -700) },
  { typ: 'przystanek', ...punkt(700, -650) },
])
const OBIEKTY_B = obiektyDoTekstu([{ typ: 'przystanek', ...punkt(-400, -400) }])

/** To, co robi ekran Miasta: wagi i kierunki ze stanu → baza → symulacja obiektów z linku. */
function bilans(s: Stan, wariant: 'a' | 'b' = 'a'): WynikSymulacji {
  const { wagi, kierunki, symulacja } = s.pobierzStan()
  const baza = przygotujBaze({ adresy: ADRESY, grupy: GRUPY, wskazniki: WSKAZNIKI, wagi, kierunki })
  return symuluj(baza, obiektyZTekstu(symulacja[wariant]))
}

/** Bilans wzorcowy: wagi wprost z persony, bez stanu aplikacji. */
function bilansWzorcowy(
  persona: Parameters<typeof ustawieniaPersony>[0],
  tryb: 'kupuje' | 'wynajmuje',
) {
  const { wagi, kierunki } = ustawieniaPersony(persona, tryb, META)
  const baza = przygotujBaze({ adresy: ADRESY, grupy: GRUPY, wskazniki: WSKAZNIKI, wagi, kierunki })
  return symuluj(baza, obiektyZTekstu(OBIEKTY_A))
}

/** Kliknięcie linku z nagłówka: ten sam `hrefDla`, który wyrenderował `<a>`, potem hashchange. */
function przejdzLinkiem(s: Stan, latka: Parameters<Stan['hrefDla']>[1]): string {
  const href = s.hrefDla(s.pobierzStan(), latka)
  s.zastosujZmianeUrl(czytajHash(href.slice(href.indexOf('#'))))
  return href
}

const DO_MIASTA = { ekran: 'miasto' } as const
const DO_BIZNESU = { ekran: 'biznes', tryb: 'biznes' } as const

async function miastoZObiektem(): Promise<Stan> {
  const s = await swiezyStan()
  s.podlaczDane([], META, [])
  przejdzLinkiem(s, DO_MIASTA)
  s.ustawSymulacje({ a: OBIEKTY_A, b: OBIEKTY_B })
  return s
}

describe('Miasto po wizycie w Biznesie (E10, #108)', () => {
  it('scenariusz coś mierzy: obiekty awansują adresy profilu mieszkańca, wagi Biznesu nie', () => {
    const wzorzec = bilansWzorcowy('rodzina', 'kupuje')
    assert.ok(wzorzec.awans > 0, `profil rodziny: awans ${wzorzec.awans}`)
    assert.ok(wzorzec.zasieg > 0)
    // Te same obiekty na wagach Biznesu: litery stoją w miejscu (luki liczą się bez wag).
    const { wagi, kierunki } = ustawieniaPersony('rodzina', 'biznes', META)
    const baza = przygotujBaze({
      adresy: ADRESY,
      grupy: GRUPY,
      wskazniki: WSKAZNIKI,
      wagi,
      kierunki,
    })
    const naBiznesie = symuluj(baza, obiektyZTekstu(OBIEKTY_A))
    assert.equal(naBiznesie.awans, 0)
    assert.equal(naBiznesie.spadek, 0)
  })

  it('Miasto → Biznes → Miasto linkami z nagłówka daje ten sam bilans co Miasto od razu', async () => {
    const s = await miastoZObiektem()
    const odRazu = bilans(s)
    assert.ok(odRazu.awans > 0)
    assert.deepEqual(odRazu, bilansWzorcowy('rodzina', 'kupuje'))

    przejdzLinkiem(s, DO_BIZNESU)
    assert.equal(s.pobierzStan().ekran, 'biznes')
    assert.equal(s.pobierzStan().tryb, 'biznes')

    przejdzLinkiem(s, DO_MIASTA)
    assert.equal(s.pobierzStan().ekran, 'miasto')
    assert.notEqual(s.pobierzStan().tryb, 'biznes')
    assert.deepEqual(bilans(s), odRazu)
    assert.deepEqual(bilans(s, 'b'), bilans(await miastoZObiektem(), 'b'))
    // Obiekty z linku przeżyły podróż.
    assert.deepEqual(s.pobierzStan().symulacja, { a: OBIEKTY_A, b: OBIEKTY_B })
  })

  it('kilka obrotów Miasto ↔ Biznes nie zmienia bilansu', async () => {
    const s = await miastoZObiektem()
    const odRazu = bilans(s)
    for (let i = 0; i < 3; i++) {
      przejdzLinkiem(s, DO_BIZNESU)
      przejdzLinkiem(s, DO_MIASTA)
      assert.deepEqual(bilans(s), odRazu, `obrót ${i + 1}`)
    }
  })

  it('wejście i wyjście przez przejdz (karta okolicy: kafel Biznes) też wraca do mieszkańca', async () => {
    const s = await swiezyStan()
    s.podlaczDane([], META, [])
    s.ustawSymulacje({ a: OBIEKTY_A, b: '' })
    const odRazu = bilans(s)
    assert.ok(odRazu.awans > 0)

    s.ustawTryb('biznes')
    s.przejdz('biznes')
    assert.equal(s.pobierzStan().tryb, 'biznes')
    s.przejdz('miasto')
    assert.equal(s.pobierzStan().tryb, 'kupuje')
    assert.deepEqual(bilans(s), odRazu)

    // Samo przejdz('biznes'), bez kafla trybu: wyjście też przywraca mieszkańca.
    s.przejdz('biznes')
    assert.equal(s.pobierzStan().tryb, 'biznes')
    s.przejdz('szukaj')
    assert.equal(s.pobierzStan().tryb, 'kupuje')
    s.przejdz('miasto')
    assert.deepEqual(bilans(s), odRazu)
  })

  it('wraca dokładnie profil sprzed Biznesu: tryb, persona i wagi', async () => {
    const s = await swiezyStan()
    s.podlaczDane([], META, [])
    s.wybierzPersone('senior')
    s.ustawTryb('wynajmuje')
    s.ustawSymulacje({ a: OBIEKTY_A, b: '' })
    const przed = s.pobierzStan()
    const wzorzec = ustawieniaPersony('senior', 'wynajmuje', META)
    assert.deepEqual(przed.wagi, wzorzec.wagi)
    const bilansPrzed = bilans(s)

    przejdzLinkiem(s, DO_BIZNESU)
    przejdzLinkiem(s, DO_MIASTA)
    const po = s.pobierzStan()
    assert.equal(po.tryb, 'wynajmuje')
    assert.equal(po.persona, 'senior')
    assert.deepEqual(po.wagi, wzorzec.wagi)
    assert.deepEqual(po.kierunki, wzorzec.kierunki)
    assert.deepEqual(bilans(s), bilansPrzed)
  })

  it('własne wagi mieszkańca też wracają po Biznesie', async () => {
    const s = await swiezyStan()
    s.podlaczDane([], META, [])
    s.ustawWage('przedszkole_odleglosc', 1)
    s.ustawWage('sklep_odleglosc', 0)
    s.ustawSymulacje({ a: OBIEKTY_A, b: '' })
    const przed = s.pobierzStan()
    assert.equal(przed.persona, 'wlasna')
    const bilansPrzed = bilans(s)

    przejdzLinkiem(s, DO_BIZNESU)
    przejdzLinkiem(s, DO_MIASTA)
    const po = s.pobierzStan()
    assert.equal(po.persona, 'wlasna')
    assert.deepEqual(po.wagi, przed.wagi)
    assert.deepEqual(po.kierunki, przed.kierunki)
    assert.deepEqual(bilans(s), bilansPrzed)
  })

  it('link z t=biznes na ekran Miasto nie przełącza go na wagi biznesowe (start i hashchange)', async () => {
    const wzorzec = bilansWzorcowy('rodzina', 'kupuje')
    const link = `#/miasto?p=rodzina&t=biznes&a=${OBIEKTY_A}`

    const poStarcie = await swiezyStan()
    poStarcie.wczytajLinkStartowy(czytajHash(link))
    assert.equal(poStarcie.pobierzStan().ekran, 'miasto')
    assert.notEqual(poStarcie.pobierzStan().tryb, 'biznes')
    poStarcie.podlaczDane([], META, [])
    assert.equal(poStarcie.pobierzStan().tryb, 'kupuje')
    assert.deepEqual(bilans(poStarcie), wzorzec)

    const poZmianie = await swiezyStan()
    poZmianie.podlaczDane([], META, [])
    poZmianie.zastosujZmianeUrl(czytajHash(link))
    assert.equal(poZmianie.pobierzStan().ekran, 'miasto')
    assert.equal(poZmianie.pobierzStan().tryb, 'kupuje')
    assert.deepEqual(bilans(poZmianie), wzorzec)

    // Własne ustawienia z takiego linku (`u=`) należą do trybu biznes, więc Miasto ich nie przejmuje.
    const zUstawieniami = await swiezyStan()
    zUstawieniami.podlaczDane([], META, [])
    const ustawieniaBiznesu = encodeURIComponent(
      JSON.stringify({ v: 1, w: { sklep_odleglosc: 4 }, k: { sklep_odleglosc: 'wiecej-lepiej' } }),
    )
    zUstawieniami.zastosujZmianeUrl(
      czytajHash(`#/miasto?t=biznes&u=${ustawieniaBiznesu}&a=${OBIEKTY_A}`),
    )
    assert.equal(zUstawieniami.pobierzStan().tryb, 'kupuje')
    assert.deepEqual(bilans(zUstawieniami), wzorzec)
  })

  it('linki z Biznesu nie niosą t=biznes, a link do Biznesu dalej tak', async () => {
    const s = await miastoZObiektem()
    const doBiznesu = s.hrefDla(s.pobierzStan(), DO_BIZNESU)
    assert.match(doBiznesu, /^\/#\/biznes\?/)
    assert.match(doBiznesu, /[?&]t=biznes(&|$)/)

    przejdzLinkiem(s, DO_BIZNESU)
    const stan = s.pobierzStan()
    for (const ekran of ['miasto', 'szukaj', 'porownanie', 'metoda'] as const) {
      const href = s.hrefDla(stan, { ekran })
      assert.ok(!/[?&]t=biznes(&|$)/.test(href), `${ekran}: ${href}`)
      assert.match(href, /[?&]t=kupuje(&|$)/, ekran)
    }
    // Katalog ma własną ścieżkę bez parametrów, więc niczego z Biznesu nie niesie.
    assert.equal(s.hrefDla(stan, { ekran: 'katalog' }), '/katalog')
    // Link do Miasta z Biznesu niesie obiekty symulatora, nic więcej z Biznesu.
    const doMiasta = s.hrefDla(stan, DO_MIASTA)
    assert.ok(doMiasta.includes(`a=${OBIEKTY_A}`), doMiasta)
    assert.ok(!/[?&](b=sklep|m=|k=)/.test(doMiasta.replace(`&b=${OBIEKTY_B}`, '')), doMiasta)
  })

  it('ekran Biznes zachowuje tryb biznes, wagi sklepu, branżę, miejsca i filtry', async () => {
    const A = '19.940000,50.060000'
    const C = '19.950000,50.070000'
    const s = await swiezyStan()
    s.wczytajLinkStartowy(czytajHash(`#/biznes?b=apteka&m=${A};;${C}&k=2z`))
    s.podlaczDane([], META, [])
    let st = s.pobierzStan()
    assert.equal(st.ekran, 'biznes')
    assert.equal(st.tryb, 'biznes')
    assert.equal(st.wagi.sklep_odleglosc, 4)
    assert.equal(st.wagi.przystanek_odleglosc, 0)
    assert.equal(st.branza, 'apteka')
    assert.deepEqual(
      st.miejsca,
      ID_MIEJSC.map(
        (_, i) => [{ lon: 19.94, lat: 50.06 }, null, { lon: 19.95, lat: 50.07 }][i] ?? null,
      ),
    )
    assert.deepEqual(st.filtryBiznesu, { min2Zrodla: true, flagi: {} })

    // Wyjście i powrót: Biznes dostaje z powrotem swój wybór, Miasto nic z niego nie bierze.
    przejdzLinkiem(s, DO_MIASTA)
    assert.equal(s.pobierzStan().tryb, 'kupuje')
    przejdzLinkiem(s, DO_BIZNESU)
    st = s.pobierzStan()
    assert.equal(st.tryb, 'biznes')
    assert.equal(st.branza, 'apteka')
    assert.equal(st.miejsca[2]?.lon, 19.95)
    assert.deepEqual(st.filtryBiznesu, { min2Zrodla: true, flagi: {} })
    assert.notEqual(st.filtryBiznesu, BEZ_FILTROW)
  })
})

// ── F5: pamięć mieszkańca przeżywa tylko w sesji karty ───────────────────────────────────

function podstawSesje(): () => void {
  const zawartosc = new Map<string, string>()
  const poprzednia = globalThis.sessionStorage
  globalThis.sessionStorage = {
    get length() {
      return zawartosc.size
    },
    getItem: (klucz) => zawartosc.get(klucz) ?? null,
    setItem: (klucz, wartosc) => {
      zawartosc.set(klucz, wartosc)
    },
    removeItem: (klucz) => {
      zawartosc.delete(klucz)
    },
    clear: () => zawartosc.clear(),
    key: (indeks) => [...zawartosc.keys()][indeks] ?? null,
  }
  return () => {
    globalThis.sessionStorage = poprzednia
  }
}

describe('F5 na Biznesie: profil mieszkańca z sesji karty', () => {
  it('po przeładowaniu na ekranie Biznes powrót do Miasta bierze profil z sesji, nie tryb biznes', async () => {
    const przywroc = podstawSesje()
    try {
      // Karta przed F5: mieszkaniec „senior, wynajmuje” wchodzi do Biznesu.
      const przed = await swiezyStan()
      przed.podlaczDane([], META, [])
      przed.wybierzPersone('senior')
      przed.ustawTryb('wynajmuje')
      const hashBiznesu = (() => {
        const href = przed.hrefDla(przed.pobierzStan(), DO_BIZNESU)
        return href.slice(href.indexOf('#'))
      })()
      przed.zastosujZmianeUrl(czytajHash(hashBiznesu))
      assert.equal(przed.pobierzStan().tryb, 'biznes')

      // F5: nowy moduł, pamięć w zmiennych znika, zostaje sessionStorage i link z paska adresu.
      const po = await swiezyStan()
      po.wczytajLinkStartowy(czytajHash(hashBiznesu))
      po.podlaczDane([], META, [])
      assert.equal(po.pobierzStan().ekran, 'biznes')
      assert.equal(po.pobierzStan().tryb, 'biznes')

      const doMiasta = po.hrefDla(po.pobierzStan(), DO_MIASTA)
      assert.ok(!/[?&]t=biznes(&|$)/.test(doMiasta), doMiasta)
      przejdzLinkiem(po, DO_MIASTA)
      const s = po.pobierzStan()
      assert.equal(s.ekran, 'miasto')
      assert.equal(s.tryb, 'wynajmuje')
      assert.equal(s.persona, 'senior')
      assert.deepEqual(s.wagi, ustawieniaPersony('senior', 'wynajmuje', META).wagi)
    } finally {
      przywroc()
    }
  })

  it('bez zapisu w sesji (nowa karta od razu na Biznesie) Miasto dostaje profil domyślny', async () => {
    const przywroc = podstawSesje()
    try {
      const s = await swiezyStan()
      s.wczytajLinkStartowy(czytajHash('#/biznes?b=apteka'))
      s.podlaczDane([], META, [])
      assert.equal(s.pobierzStan().tryb, 'biznes')
      przejdzLinkiem(s, DO_MIASTA)
      s.ustawSymulacje({ a: OBIEKTY_A, b: '' })
      assert.equal(s.pobierzStan().tryb, 'kupuje')
      assert.equal(s.pobierzStan().persona, 'rodzina')
      assert.deepEqual(bilans(s), bilansWzorcowy('rodzina', 'kupuje'))
    } finally {
      przywroc()
    }
  })
})

// ── Reguła: tryb biznes należy do ekranu Biznes ──────────────────────────────────────────

describe('czyDoMieszkanca: kiedy stan wraca do profilu mieszkańca', () => {
  const EKRANY: readonly Ekran[] = [
    'szukaj',
    'okolica',
    'porownanie',
    'metoda',
    'katalog',
    'miasto',
    'biznes',
  ]

  it('bez trybu biznes nie ma do czego wracać, na żadnym ekranie', () => {
    for (const poprzedni of EKRANY) {
      for (const ekran of EKRANY) {
        for (const tryb of ['kupuje', 'wynajmuje'] as const) {
          assert.equal(
            czyDoMieszkanca(poprzedni, { ekran, tryb }),
            false,
            `${poprzedni} → ${ekran}`,
          )
        }
      }
    }
  })

  it('na ekranie Biznes tryb biznes zostaje, skąd by się tam nie weszło', () => {
    for (const poprzedni of EKRANY) {
      assert.equal(
        czyDoMieszkanca(poprzedni, { ekran: 'biznes', tryb: 'biznes' }),
        false,
        poprzedni,
      )
    }
  })

  it('Miasto zawsze liczy na mieszkańcu', () => {
    for (const poprzedni of EKRANY) {
      assert.equal(czyDoMieszkanca(poprzedni, { ekran: 'miasto', tryb: 'biznes' }), true, poprzedni)
    }
  })

  it('tryb biznes poza ekranem Biznes zawsze wraca do mieszkańca', () => {
    for (const poprzedni of EKRANY) {
      for (const ekran of EKRANY.filter((e) => e !== 'biznes')) {
        assert.equal(
          czyDoMieszkanca(poprzedni, { ekran, tryb: 'biznes' }),
          true,
          `${poprzedni} → ${ekran}`,
        )
      }
    }
  })
})
