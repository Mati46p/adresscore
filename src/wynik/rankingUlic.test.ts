import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { describe, it, test } from 'node:test'
import type { Adres, PlikAdresow, PlikOkolic } from '../kontrakty/index.ts'
import { plikOkolic } from './okoliceTestowe.ts'
import { okolicaUlicy, type PozycjaUlicy, rankingUlic } from './rankingUlic.ts'
import { slugUlicy } from './slug.ts'

const adres = (ulica: string, nr: string, miejscowosc = 'Kraków'): Adres =>
  ({
    id: `${miejscowosc}-${ulica}-${nr}`,
    i: 0,
    ulica,
    nr,
    miejscowosc,
    gmina: miejscowosc,
    teryt: miejscowosc === 'Kraków' ? '1261011' : '1219053',
    dzielnica: miejscowosc === 'Kraków' ? 'Stare Miasto' : null,
    h3: 'hex',
  }) as Adres

test('ranking pokazuje ulicę raz i uśrednia wyniki jej adresów', () => {
  const a = [adres('Długa', '1'), adres('Długa', '3'), adres('Grodzka', '2')]
  const wynik = rankingUlic(
    a,
    Float32Array.from([90, 70, 75]),
    new Uint8Array(3),
    new Map([['hex', 80]]),
  )
  assert.equal(wynik.length, 2)
  assert.equal(wynik[0]?.nazwa, 'Długa')
  assert.equal(wynik[0]?.wynik, 80)
  assert.equal(wynik[0]?.liczbaAdresow, 2)
  assert.equal(wynik[0]?.adresDoPorownania, 0)
  assert.equal(wynik[0]?.slug, slugUlicy(a[0] as Adres))
  assert.equal(wynik[1]?.nazwa, 'Grodzka')
})

test('ta sama nazwa w różnych miejscowościach nie jest łączona', () => {
  const a = [adres('Długa', '1'), adres('Długa', '1', 'Wieliczka')]
  const wynik = rankingUlic(
    a,
    Float32Array.from([60, 80]),
    new Uint8Array(2),
    new Map([['hex', 70]]),
  )
  assert.equal(wynik.length, 2)
  assert.notEqual(wynik[0]?.slug, wynik[1]?.slug)
})

test('brak oceny i adresy wykluczone nie zawyżają wyniku ulicy', () => {
  const a = [adres('Długa', '1'), adres('Długa', '3'), adres('Długa', '5')]
  const wynik = rankingUlic(
    a,
    Float32Array.from([40, 90, Number.NaN]),
    Uint8Array.from([0, 1, 0]),
    new Map([['hex', 50]]),
  )
  assert.equal(wynik[0]?.wynik, 40)
  assert.equal(wynik[0]?.liczbaAdresow, 1)
  assert.equal(wynik[0]?.adresDoPorownania, 0)
})

test('do porównania wybiera adres z danymi, który spełnia filtr', () => {
  const a = [adres('Długa', '1'), adres('Długa', '3'), adres('Długa', '5')]
  const wynik = rankingUlic(
    a,
    Float32Array.from([90, 80, 70]),
    Uint8Array.from([1, 0, 0]),
    new Map([['hex', 80]]),
  )
  assert.equal(wynik[0]?.adresDoPorownania, 1)
})

// ── Okolica ulicy (#185) ─────────────────────────────────────────────────────────────────

describe('okolica ulicy w rankingu', () => {
  const sim = (
    nazwa: string,
    numer: string,
    dzielnica = 'I Stare Miasto',
  ): PlikOkolic['okolice'][string] => ({
    nazwa,
    numer,
    rodzaj: 'sim',
    dzielnica,
    gmina: 'Kraków',
    powierzchniaKm2: 1,
    liczbaAdresow: 10,
    potoczne: [],
  })

  const WPISY: PlikOkolic['okolice'] = {
    'sim-101': sim('Stare Miasto', 'I.1'),
    'sim-108': sim('Kazimierz', 'I.8'),
    'sim-201': sim('Grzegórzki', 'II.1', 'II Grzegórzki'),
    'sim-202': sim('Dąbie', 'II.5', 'II Grzegórzki'),
    'm-1206063-liszki': {
      nazwa: 'Liszki',
      rodzaj: 'miejscowosc',
      dzielnica: null,
      gmina: 'Liszki',
      liczbaAdresow: 10,
    },
  }

  /** Adres w Krakowie na ulicy `ulica`, z dzielnicą Stare Miasto (jak w zapasie bez pliku okolic). */
  const wKrakowie = (ulica: string, nr: string): Adres => adres(ulica, nr)
  const wLiszkach = (ulica: string, nr: string): Adres => ({
    ...adres(ulica, nr, 'Liszki'),
    dzielnica: null,
    gmina: 'Liszki',
  })
  const wszedzie = (n: number) => Float32Array.from({ length: n }, () => 70)
  const rank = (a: Adres[], okolice: PlikOkolic | null, wyniki = wszedzie(a.length)) =>
    rankingUlic(a, wyniki, new Uint8Array(a.length), new Map([['hex', 70]]), okolice)

  it('ulica w jednej jednostce SIM dostaje jej nazwę', () => {
    const a = [wKrakowie('Długa', '1'), wKrakowie('Długa', '3')]
    const okolice = plikOkolic(['sim-108', 'sim-108'], 'test', WPISY)
    assert.equal(rank(a, okolice)[0]?.okolica, 'Kazimierz')
  })

  it('ulica w dwóch jednostkach: obie, od tej z większą liczbą adresów; remis po nazwie', () => {
    const a = [wKrakowie('Długa', '1'), wKrakowie('Długa', '3'), wKrakowie('Długa', '5')]
    const okolice = plikOkolic(['sim-108', 'sim-101', 'sim-101'], 'test', WPISY)
    assert.equal(rank(a, okolice)[0]?.okolica, 'Stare Miasto, Kazimierz')
    const remis = plikOkolic(['sim-108', 'sim-101'], 'test', WPISY)
    assert.equal(rank(a.slice(0, 2), remis)[0]?.okolica, 'Kazimierz, Stare Miasto')
  })

  it('trzy jednostki: wszystkie nazwy (reszta „i jeszcze 1 okolica” zajęłaby tyle samo miejsca)', () => {
    const a = ['1', '3', '5'].map((nr) => wKrakowie('Długa', nr))
    const okolice = plikOkolic(['sim-101', 'sim-108', 'sim-201'], 'test', WPISY)
    assert.equal(rank(a, okolice)[0]?.okolica, 'Grzegórzki, Kazimierz, Stare Miasto')
  })

  it('cztery jednostki i więcej: dwie największe i liczba pozostałych', () => {
    const a = ['1', '3', '5', '7', '9'].map((nr) => wKrakowie('Długa', nr))
    const okolice = plikOkolic(
      ['sim-101', 'sim-101', 'sim-108', 'sim-201', 'sim-202'],
      'test',
      WPISY,
    )
    assert.equal(rank(a, okolice)[0]?.okolica, 'Stare Miasto, Dąbie i jeszcze 2 okolice')
  })

  it('miejscowość poza Krakowem nazywa się tak samo jak przy ulicy: nic do dopisania', () => {
    const a = [wLiszkach('Długa', '1'), wLiszkach('Długa', '2')]
    const okolice = plikOkolic(['m-1206063-liszki', 'm-1206063-liszki'], 'test', WPISY)
    assert.equal(rank(a, okolice)[0]?.okolica, null)
  })

  it('bez pliku okolic zapas jak na karcie: „Dzielnica …” w Krakowie, „Gmina …” poza nim', () => {
    const a = [wKrakowie('Długa', '1'), wKrakowie('Grodzka', '2'), wLiszkach('Polna', '1')]
    const poNazwie = new Map(rank(a, null).map((p) => [p.nazwa, p.okolica]))
    assert.equal(poNazwie.get('Długa'), 'Dzielnica Stare Miasto')
    assert.equal(poNazwie.get('Grodzka'), 'Dzielnica Stare Miasto')
    assert.equal(poNazwie.get('Polna'), 'Gmina Liszki')
  })

  it('null w kolumnie okolic to zapas z adresu, nie pusta okolica', () => {
    const a = [wKrakowie('Długa', '1')]
    const okolice = plikOkolic([null], 'test', WPISY)
    assert.equal(rank(a, okolice)[0]?.okolica, 'Dzielnica Stare Miasto')
  })

  it('do okolicy liczą się tylko adresy, które weszły do oceny ulicy (bez wykluczonych i bez danych)', () => {
    const a = [wKrakowie('Długa', '1'), wKrakowie('Długa', '3'), wKrakowie('Długa', '5')]
    const okolice = plikOkolic(['sim-108', 'sim-101', 'sim-201'], 'test', WPISY)
    const wynik = rankingUlic(
      a,
      Float32Array.from([70, 70, Number.NaN]),
      Uint8Array.from([0, 1, 0]),
      new Map([['hex', 70]]),
      okolice,
    )
    // Adres 1 wykluczony filtrem, adres 2 bez wyniku: zostaje tylko Kazimierz.
    assert.equal(wynik[0]?.okolica, 'Kazimierz')
    assert.equal(wynik[0]?.liczbaAdresow, 1)
  })

  it('okolica nie zmienia kolejności ani liczb: ten sam ranking z plikiem i bez niego', () => {
    const a = [wKrakowie('Długa', '1'), wKrakowie('Długa', '3'), wKrakowie('Grodzka', '2')]
    const wyniki = Float32Array.from([90, 70, 75])
    const okolice = plikOkolic(['sim-108', 'sim-101', 'sim-201'], 'test', WPISY)
    const bezOkolicy = ({ okolica: _okolica, ...reszta }: PozycjaUlicy) => reszta
    assert.deepEqual(
      rank(a, okolice, wyniki).map(bezOkolicy),
      rank(a, null, wyniki).map(bezOkolicy),
    )
  })
})

describe('okolicaUlicy: podpis przy wielu okolicach', () => {
  // 24 jednostki, każda ze swoim adresem na jednej ulicy.
  const wpisy = Object.fromEntries(
    Array.from({ length: 24 }, (_, k) => [
      `sim-${100 + k}`,
      {
        nazwa: `Okolica ${String.fromCharCode(65 + k)}`,
        numer: `I.${k + 1}`,
        rodzaj: 'sim',
        dzielnica: 'I Stare Miasto',
        gmina: 'Kraków',
        powierzchniaKm2: 1,
        liczbaAdresow: 1,
        potoczne: [],
      },
    ]),
  ) as PlikOkolic['okolice']
  const kolumna = Object.keys(wpisy)
  const okolice = plikOkolic(kolumna, 'test', wpisy)
  const adresy = kolumna.map(() => ({ dzielnica: 'I Stare Miasto', gmina: 'Kraków' }))
  const podpis = (ile: number) =>
    okolicaUlicy(
      Array.from({ length: ile }, (_, i) => i),
      adresy,
      okolice,
      'Kraków',
    )

  it('odmiana liczby pozostałych: 2 okolice, 5 okolic, 12 okolic, 22 okolice', () => {
    assert.equal(podpis(4), 'Okolica A, Okolica B i jeszcze 2 okolice')
    assert.equal(podpis(7), 'Okolica A, Okolica B i jeszcze 5 okolic')
    assert.equal(podpis(14), 'Okolica A, Okolica B i jeszcze 12 okolic')
    assert.equal(podpis(24), 'Okolica A, Okolica B i jeszcze 22 okolice')
  })

  it('pusta lista adresów i adres poza listą nie dają podpisu', () => {
    assert.equal(okolicaUlicy([], adresy, okolice, 'Kraków'), null)
    assert.equal(okolicaUlicy([999], adresy, okolice, 'Kraków'), null)
  })
})

// ── Prawdziwe dane ───────────────────────────────────────────────────────────────────────

/** Jak `rozwinAdresy` z kontraktu, który czyta `import.meta.env` i nie ładuje się pod gołym node. */
function rozwin(p: PlikAdresow): Adres[] {
  const k = p.kolumny
  return k.id.map((id, i) => ({
    i,
    id,
    miejscowosc: k.miejscowosc[i] ?? '',
    ulica: k.ulica[i] ?? null,
    nr: k.nr[i] ?? '',
    kod: k.kod[i] ?? null,
    dzielnica: k.dzielnica[i] ?? null,
    gmina: k.gmina[i] ?? '',
    teryt: k.teryt[i] ?? '',
    lon: k.lon[i] ?? 0,
    lat: k.lat[i] ?? 0,
    h3: k.h3[i] ?? '',
  }))
}

const DANE = new URL('../../public/dane/', import.meta.url)
const MA_PLIKI =
  existsSync(new URL('adresy.json', DANE)) && existsSync(new URL('okolice.json', DANE))

describe('rankingUlic na prawdziwych danych', {
  skip: MA_PLIKI ? false : 'brak plików danych',
}, () => {
  const czytaj = <T>(plik: string): T => JSON.parse(readFileSync(new URL(plik, DANE), 'utf8'))
  const plikAdresow = czytaj<PlikAdresow>('adresy.json')
  const prawdziwe = czytaj<PlikOkolic>('okolice.json')
  const adresy = rozwin(plikAdresow)
  const zgodne = prawdziwe.wersjaAdresow === plikAdresow.wersja
  // Wyniki deterministyczne (liniowy generator), każdy heks obecny na mapie, nic nie wykluczone.
  let ziarno = 12345
  const wyniki = Float32Array.from({ length: adresy.length }, () => {
    ziarno = (ziarno * 1103515245 + 12345) % 2147483648
    return 20 + (ziarno % 7000) / 100
  })
  const heksy = new Map(adresy.map((a) => [a.h3, 50] as const))
  const brakWykluczen = new Uint8Array(adresy.length)

  it('pięć ulic: w Krakowie okolica z pliku (nazwa jednostki), poza Krakowem nic lub gmina', () => {
    if (!zgodne) return
    const nazwyJednostek = new Set(
      Object.values(prawdziwe.okolice)
        .filter((o) => o.rodzaj === 'sim')
        .map((o) => o.nazwa),
    )
    const t = performance.now()
    const wynik = rankingUlic(adresy, wyniki, brakWykluczen, heksy, prawdziwe, 200)
    const ms = performance.now() - t
    console.log(
      `rankingUlic: ${ms.toFixed(0)} ms dla ${adresy.length} adresów (200 pozycji z okolicą)`,
    )
    assert.equal(wynik.length, 200)
    let wKrakowie = 0
    for (const p of wynik) {
      if (p.miejscowosc === 'Kraków') {
        wKrakowie++
        assert.ok(p.okolica !== null, `${p.nazwa}: ulica w Krakowie bez okolicy`)
        // Pierwsza nazwa w podpisie jest nazwą jednostki SIM.
        const pierwsza = (p.okolica ?? '').split(/, | i jeszcze /)[0] as string
        assert.ok(nazwyJednostek.has(pierwsza), `${p.nazwa}: „${p.okolica}”`)
        assert.doesNotMatch(p.okolica ?? '', /Dzielnica /)
      } else {
        // Miejscowość z pliku nazywa się tak samo jak przy ulicy, więc nic do dopisania.
        assert.equal(p.okolica, null, `${p.nazwa}, ${p.miejscowosc}`)
      }
    }
    assert.ok(wKrakowie > 0, 'wśród 200 ulic są ulice w Krakowie')
    assert.ok(ms < 2000, `${ms} ms`)
  })

  it('ranking z plikiem okolic i bez niego ma tę samą kolejność i te same liczby', () => {
    const z = rankingUlic(adresy, wyniki, brakWykluczen, heksy, prawdziwe, 50)
    const bez = rankingUlic(adresy, wyniki, brakWykluczen, heksy, null, 50)
    const bezOkolicy = ({ okolica: _okolica, ...reszta }: PozycjaUlicy) => reszta
    assert.deepEqual(z.map(bezOkolicy), bez.map(bezOkolicy))
    // Zapas to dzielnica z adresu: „Dzielnica …” dla Krakowa i „Gmina …” poza nim.
    for (const p of bez) assert.match(p.okolica ?? '', /^(Dzielnica |Gmina )/)
  })

  it('żaden podpis okolicy nie ma pauzy', () => {
    const wynik = rankingUlic(adresy, wyniki, brakWykluczen, heksy, prawdziwe, 500)
    for (const p of wynik) assert.doesNotMatch(p.okolica ?? '', /—/)
  })
})
