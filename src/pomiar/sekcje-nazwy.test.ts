// Nazwy sekcji ↔ atrybuty `data-sekcja` w ekranach. Uruchom: node --test "src/pomiar/*.test.ts"
//
// Czyta ŹRÓDŁA ekranów (node:fs), nie importuje komponentów: testy chodzą bez DOM i bez aliasu `@/`.
// Pilnuje obu stron mapy `NAZWY_SEKCJI`: sekcja dopisana w ekranie bez nazwy wyświetlałaby się
// w panelu jako surowy klucz, a nazwa bez sekcji zostałaby w mapie po usuniętym bloku.
//
// Skaner musi udowodnić, że coś zmierzył: zero znalezisk z pustego skanu nie jest dowodem, więc test
// sprawdza liczbę przejrzanych plików, obecność kluczy z kontraktu (contracts/pomiar-klient.md)
// i same wzorce skanera na sztucznych źródłach.
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { MAX_CEL, WZORZEC_SEKCJI } from './kontrakt.ts'
import { NAZWY_SEKCJI, nazwaSekcji } from './sekcje-nazwy.ts'

const KORZEN = join(import.meta.dirname, '..')

/** Katalogi, które nie są ekranami: sam pomiar (opisuje atrybuty w komentarzach) i panel admina. */
const POMIJANE_KATALOGI = new Set(['pomiar', 'panel'])

type Atrybut = 'data-sekcja' | 'data-cel'

/* -------------------------------------------------------------------------- */
/* Wzorce skanera (czyste, sprawdzane na sztucznych źródłach)                  */
/* -------------------------------------------------------------------------- */

/**
 * Źródło bez komentarzy: dokumentacja w komentarzach często cytuje atrybut w całości, a to nie jest
 * jego użycie. `//` poprzedzone dwukropkiem (adres URL) albo cudzysłowem zostaje.
 */
function bezKomentarzy(zrodlo: string): string {
  return zrodlo.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\'"`])\/\/.*$/gm, '$1')
}

/** Wartość atrybutu zapisana literałem: `"x"`, `'x'`, `{'x'}` albo `{"x"}`. */
const LITERAL = String.raw`(?:"([^"]*)"|'([^']*)'|\{\s*'([^']*)'\s*\}|\{\s*"([^"]*)"\s*\})`

/** Wartości atrybutu zapisane literałem. */
function literaly(zrodlo: string, atrybut: Atrybut): string[] {
  const wzorzec = new RegExp(`${atrybut}=${LITERAL}`, 'g')
  return [...bezKomentarzy(zrodlo).matchAll(wzorzec)].map(
    (m) => m.slice(1).find((grupa) => grupa !== undefined) ?? '',
  )
}

/**
 * Wyrażenia, których wartości nie da się sprawdzić bez uruchomienia kodu: zmienna, wywołanie, a przy
 * `szablonDozwolony = false` także szablon z backtickami. Literały `{'x'}` nie są dynamiczne.
 */
function wyrazenia(zrodlo: string, atrybut: Atrybut, szablonDozwolony: boolean): string[] {
  const wyjatki = szablonDozwolony ? '[\'"`]' : '[\'"]'
  const wzorzec = new RegExp(`${atrybut}=\\{(?!\\s*${wyjatki})([^}]*)\\}`, 'g')
  return [...bezKomentarzy(zrodlo).matchAll(wzorzec)].map((m) => m[1] ?? '')
}

/** Stały początek szablonu `data-cel={`tryb-${id}`}` (tekst przed pierwszym `${`). */
function poczatkiSzablonow(zrodlo: string): string[] {
  const wzorzec = /data-cel=\{\s*`([^`$]*)\$\{/g
  return [...bezKomentarzy(zrodlo).matchAll(wzorzec)].map((m) => m[1] ?? '')
}

describe('wzorce skanera', () => {
  it('rozpoznaje literały we wszystkich zapisach JSX', () => {
    const zrodlo = `
      <section data-sekcja="a" />
      <section data-sekcja='b' />
      <section data-sekcja={'c'} />
      <section data-sekcja={ "d" } />
    `
    assert.deepEqual(literaly(zrodlo, 'data-sekcja'), ['a', 'b', 'c', 'd'])
    assert.deepEqual(wyrazenia(zrodlo, 'data-sekcja', false), [])
  })

  it('pomija atrybut cytowany w komentarzach (liniowych, blokowych i JSX)', () => {
    const zrodlo = `
      // <div data-sekcja="komentarz-liniowy" />
      /* <div data-sekcja="komentarz-blokowy" /> */
      {/* <div data-sekcja="komentarz-jsx" /> */}
      <a href="https://example.pl/x" data-sekcja="prawdziwa" />
    `
    assert.deepEqual(literaly(zrodlo, 'data-sekcja'), ['prawdziwa'])
  })

  it('zmienna, wywołanie i szablon w data-sekcja to wyrażenia (szablon w data-cel jest dozwolony)', () => {
    const zrodlo = [
      '<a data-sekcja={klucz} />',
      '<a data-sekcja={nazwa(x)} />',
      '<a data-sekcja={`s-${id}`} />',
      '<a data-cel={`tryb-${id}`} />',
      '<a data-cel={cel} />',
    ].join('\n')
    assert.deepEqual(wyrazenia(zrodlo, 'data-sekcja', false), ['klucz', 'nazwa(x)', '`s-${id'])
    assert.deepEqual(wyrazenia(zrodlo, 'data-cel', true), ['cel'])
    assert.deepEqual(poczatkiSzablonow(zrodlo), ['tryb-'])
  })

  it('rozróżnia atrybuty (data-sekcja nie łapie data-cel i odwrotnie)', () => {
    const zrodlo = '<a data-sekcja="a" data-cel="b" />'
    assert.deepEqual(literaly(zrodlo, 'data-sekcja'), ['a'])
    assert.deepEqual(literaly(zrodlo, 'data-cel'), ['b'])
  })
})

/* -------------------------------------------------------------------------- */
/* Źródła ekranów                                                              */
/* -------------------------------------------------------------------------- */

/** Pliki komponentów (`.tsx`) poza testami i poza katalogami, które nie są ekranami. */
function plikiEkranow(): string[] {
  return readdirSync(KORZEN, { recursive: true, encoding: 'utf8' })
    .map((sciezka) => sciezka.replaceAll('\\', '/'))
    .filter((sciezka) => /\.tsx$/.test(sciezka) && !/\.test\.tsx$/.test(sciezka))
    .filter((sciezka) => !POMIJANE_KATALOGI.has(sciezka.split('/')[0] ?? ''))
    .sort()
}

const ZRODLA = new Map(
  plikiEkranow().map((plik) => [plik, readFileSync(join(KORZEN, plik), 'utf8')]),
)

interface Uzycie {
  plik: string
  klucz: string
}

function wszystkie(wyciag: (zrodlo: string) => string[]): Uzycie[] {
  return [...ZRODLA].flatMap(([plik, zrodlo]) => wyciag(zrodlo).map((klucz) => ({ plik, klucz })))
}

const SEKCJE = wszystkie((zrodlo) => literaly(zrodlo, 'data-sekcja'))
const KLUCZE_UZYTE = new Set(SEKCJE.map((u) => u.klucz))

describe('skaner ekranów', () => {
  it('przegląda ekrany i widzi atrybuty (dowód, że zero znalezisk coś znaczy)', (t) => {
    const pliki = [...ZRODLA.keys()]
    t.diagnostic(
      `przejrzano ${pliki.length} plików, ${SEKCJE.length} użyć, ${KLUCZE_UZYTE.size} kluczy`,
    )
    assert.ok(pliki.length >= 30, `przejrzano tylko ${pliki.length} plików .tsx`)
    assert.ok(
      pliki.some((p) => p.startsWith('karta/okolica/')),
      'skaner nie widzi karty adresu',
    )
    assert.ok(!pliki.some((p) => p.startsWith('pomiar/') || p.startsWith('panel/')))
    assert.ok(SEKCJE.length >= 15, `znaleziono tylko ${SEKCJE.length} sekcji`)
    // Klucze z kontraktu (contracts/pomiar-klient.md, „Oznaczenia w ekranach”) muszą być w ekranach.
    for (const klucz of ['etykieta', 'kategorie', 'zrodla', 'mapa', 'co-by-to-zmienilo']) {
      assert.ok(KLUCZE_UZYTE.has(klucz), `brak sekcji karty adresu: ${klucz}`)
    }
    for (const klucz of ['wyszukiwarka', 'porownanie-lista', 'biznes-formularz']) {
      assert.ok(KLUCZE_UZYTE.has(klucz), `brak sekcji ekranu: ${klucz}`)
    }
  })

  it('wartość data-sekcja jest zawsze literałem (zmienna czy szablon wymknęłyby się mapie nazw)', () => {
    assert.deepEqual(
      wszystkie((zrodlo) => wyrazenia(zrodlo, 'data-sekcja', false)),
      [],
    )
  })
})

describe('klucze sekcji ↔ nazwy', () => {
  it('każdy użyty klucz pasuje do wzorca z kontraktu', () => {
    for (const { plik, klucz } of SEKCJE) {
      assert.match(klucz, WZORZEC_SEKCJI, `${plik}: „${klucz}” nie pasuje do ${WZORZEC_SEKCJI}`)
    }
  })

  it('każdy użyty klucz ma nazwę', () => {
    const bezNazwy = SEKCJE.filter(({ klucz }) => !Object.hasOwn(NAZWY_SEKCJI, klucz))
    assert.deepEqual(
      bezNazwy,
      [],
      'dopisz nazwę w src/pomiar/sekcje-nazwy.ts dla: ' +
        bezNazwy.map((u) => `${u.klucz} (${u.plik})`).join(', '),
    )
  })

  it('każda nazwa ma klucz użyty w ekranie', () => {
    const sieroty = Object.keys(NAZWY_SEKCJI).filter((klucz) => !KLUCZE_UZYTE.has(klucz))
    assert.deepEqual(sieroty, [], `nazwy bez sekcji w ekranach: ${sieroty.join(', ')}`)
  })

  it('klucz występuje najwyżej raz w pliku i najwyżej w jednym pliku', () => {
    const pliki = new Map<string, string[]>()
    for (const { plik, klucz } of SEKCJE) pliki.set(klucz, [...(pliki.get(klucz) ?? []), plik])
    const powtorzone = [...pliki].filter(([, lista]) => lista.length > 1)
    assert.deepEqual(
      powtorzone,
      [],
      'powtórzone klucze (zmień jeden z nich): ' +
        powtorzone.map(([klucz, lista]) => `${klucz}: ${lista.join(', ')}`).join('; '),
    )
  })

  it('nazwy są niepuste, w postaci „Ekran: sekcja” i nie powtarzają się', () => {
    const nazwy = Object.values(NAZWY_SEKCJI)
    assert.ok(nazwy.length >= 15)
    for (const [klucz, nazwa] of Object.entries(NAZWY_SEKCJI)) {
      assert.equal(nazwa, nazwa.trim(), klucz)
      assert.match(nazwa, /^[^:]+: .+$/, `${klucz}: „${nazwa}” nie ma postaci „Ekran: sekcja”`)
    }
    assert.equal(new Set(nazwy).size, nazwy.length, 'dwie sekcje o tej samej nazwie')
  })
})

describe('nazwaSekcji', () => {
  it('zna nazwę kluczy z mapy', () => {
    assert.equal(nazwaSekcji('etykieta'), 'Karta adresu: wynik i etykieta')
  })

  it('nieznany klucz wraca sam, także gdy nazywa się jak pole prototypu', () => {
    assert.equal(nazwaSekcji('nowa-sekcja'), 'nowa-sekcja')
    assert.equal(nazwaSekcji('constructor'), 'constructor')
    assert.equal(nazwaSekcji('__proto__'), '__proto__')
  })
})

describe('data-cel w ekranach', () => {
  const CELE = wszystkie((zrodlo) => literaly(zrodlo, 'data-cel'))
  const SZABLONY = wszystkie(poczatkiSzablonow)

  it('skaner widzi cele przycisków', (t) => {
    t.diagnostic(`celów: ${CELE.length}, w szablonach: ${SZABLONY.length}`)
    assert.ok(CELE.length >= 20, `znaleziono tylko ${CELE.length} celów`)
    for (const cel of ['dodaj-do-porownania', 'udostepnij', 'zmien-warstwe']) {
      assert.ok(
        CELE.some((u) => u.klucz === cel),
        `brak celu ${cel}`,
      )
    }
  })

  it('cel jest krótki i stabilny: małe litery, cyfry i myślniki, do limitu z kontraktu', () => {
    for (const { plik, klucz } of CELE) {
      assert.match(klucz, /^[a-z0-9-]+$/, `${plik}: cel „${klucz}”`)
      assert.ok(klucz.length <= MAX_CEL, `${plik}: cel „${klucz}” dłuższy niż ${MAX_CEL}`)
    }
  })

  it('cel z szablonu ma stały początek, a wartość ze zmiennej jest zabroniona', () => {
    for (const { plik, klucz } of SZABLONY) {
      assert.match(klucz, /^[a-z0-9-]{2,}$/, `${plik}: szablon celu zaczyna się od „${klucz}”`)
      assert.ok(klucz.length < MAX_CEL, `${plik}: początek celu „${klucz}” zajmuje cały limit`)
    }
    assert.deepEqual(
      wszystkie((zrodlo) => wyrazenia(zrodlo, 'data-cel', true)),
      [],
      'cel zbudowany ze zmiennej może nieść adres albo nazwę',
    )
  })
})
