// Strażnik prywatności i struktury modułu: czyta pliki źródłowe src/pomiar i sprawdza niezmienniki,
// których nie da się sprawdzić zachowaniem pojedynczej funkcji. Uruchom: node --test "src/pomiar/*.test.ts"
//
// Sprawdza TEKST plików (łącznie z komentarzami – lepiej raz przeformułować komentarz, niż uczyć
// się wyjątków). Plików testowych nie skanuje, bo muszą wymieniać szukane nazwy.
//
// Każdy test dowodzi, że coś zmierzył: skaner wypisuje liczbę przejrzanych plików i sprawdza,
// że znajduje szukany wzorzec tam, gdzie on powinien być (zero znalezisk z zerowego skanu
// nie jest dowodem).
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'

const KATALOG = import.meta.dirname

const WSZYSTKIE = readdirSync(KATALOG).filter((nazwa) => /\.(ts|tsx)$/.test(nazwa))
const ZRODLA = WSZYSTKIE.filter((nazwa) => !/\.test\.ts$/.test(nazwa))
const tresc = (nazwa: string) => readFileSync(join(KATALOG, nazwa), 'utf8')

/** Pliki źródłowe zawierające którykolwiek z napisów. */
function gdzie(napisy: readonly string[], pliki: readonly string[] = ZRODLA): string[] {
  return pliki.filter((nazwa) => napisy.some((napis) => tresc(nazwa).includes(napis)))
}

describe('prywatność: skaner', () => {
  it('przegląda moduł i widzi szukane wzorce (dowód, że zero znalezisk coś znaczy)', () => {
    assert.ok(ZRODLA.length >= 15, `przejrzano tylko ${ZRODLA.length} plików źródłowych`)
    assert.ok(ZRODLA.includes('zgoda.ts') && ZRODLA.includes('transport.ts'))
    assert.deepEqual(gdzie(['localStorage']), ['zgoda.ts'], 'skaner nie widzi magazynu w zgoda.ts')
    assert.ok(gdzie(['sendBeacon']).includes('pomiar.ts'), 'skaner nie widzi podpięcia transportu')
  })
})

describe('prywatność: magazyn przeglądarki', () => {
  const MAGAZYNY = [
    'localStorage',
    'sessionStorage',
    'document.cookie',
    'indexedDB',
    'cookieStore',
    'openDatabase',
    'navigator.storage',
  ]

  it('nazwy API magazynów występują WYŁĄCZNIE w zgoda.ts', () => {
    for (const napis of MAGAZYNY) {
      const pliki = gdzie([napis])
      assert.ok(
        pliki.every((nazwa) => nazwa === 'zgoda.ts'),
        `„${napis}” poza zgoda.ts: ${pliki.join(', ')}`,
      )
    }
  })

  it('zgoda.ts dotyka tylko localStorage (ani sesji, ani ciasteczek, ani IndexedDB)', () => {
    const zgoda = tresc('zgoda.ts')
    assert.ok(zgoda.includes('localStorage'))
    for (const napis of ['sessionStorage', 'document.cookie', 'indexedDB', 'cookieStore']) {
      assert.ok(!zgoda.includes(napis), napis)
    }
  })

  it('jedyny klucz magazynu to pomiar-wylaczony, zapisywany tylko przy wyłączeniu', () => {
    const zgoda = tresc('zgoda.ts')
    assert.deepEqual(zgoda.match(/'pomiar-wylaczony'/g)?.length, 1, 'klucz zdefiniowany raz')
    const zapisy = [...zgoda.matchAll(/\.setItem\(([^)]*)\)/g)].map((m) => m[1])
    assert.deepEqual(zapisy, ["KLUCZ_WYLACZENIA, '1'"], 'jedyny zapis: klucz i wartość „1”')
    const odczyty = [...zgoda.matchAll(/\.(?:getItem|removeItem)\(([^)]*)\)/g)].map((m) => m[1])
    assert.ok(odczyty.length >= 2 && odczyty.every((a) => a === 'KLUCZ_WYLACZENIA'))
  })
})

describe('prywatność: sieć i dane urządzenia', () => {
  it('prymitywy sieciowe są tylko w transport.ts (pomiar.ts jedynie je przekazuje)', () => {
    for (const napis of [
      'XMLHttpRequest',
      'WebSocket',
      'EventSource',
      'new Image',
      'importScripts',
    ]) {
      assert.deepEqual(gdzie([napis]), [], napis)
    }
    for (const napis of ['sendBeacon', 'fetch']) {
      const pliki = gdzie([napis])
      assert.ok(
        pliki.every((nazwa) => nazwa === 'transport.ts' || nazwa === 'pomiar.ts'),
        `„${napis}” w: ${pliki.join(', ')}`,
      )
    }
    // pomiar.ts nie WOŁA sieci: tylko wiąże funkcje i oddaje je transportowi.
    const pomiar = tresc('pomiar.ts')
    assert.ok(!/(?:sendBeacon|fetch)\(/.test(pomiar))
  })

  it('user-agent jest czytany tylko w pomiar.ts i tylko po to, by policzyć klasę urządzenia', () => {
    assert.deepEqual(gdzie(['userAgent']), ['pomiar.ts'])
    assert.ok(tresc('pomiar.ts').includes('klasaUrzadzeniaZUa(navigator.userAgent'))
  })

  it('adres strony i referer czytają tylko wskazane pliki, query strony nikt', () => {
    const dozwolone: Record<string, readonly string[]> = {
      // pomiar.ts czyta je RAZ i oddaje zrodlo.ts do przycięcia; cta.ts używa adresu strony
      // wyłącznie jako bazy do rozpoznania linku wewnętrznego (nic z niego nie wychodzi).
      'location.href': ['pomiar.ts', 'cta.ts'],
      'document.referrer': ['pomiar.ts', 'zrodlo.ts'],
      'location.search': [],
    }
    for (const [napis, pliki] of Object.entries(dozwolone)) {
      const znalezione = gdzie([napis])
      assert.ok(
        znalezione.every((nazwa) => pliki.includes(nazwa)),
        `„${napis}” w: ${znalezione.join(', ')}`,
      )
    }
    assert.ok(
      gdzie(['document.referrer']).includes('pomiar.ts'),
      'skaner nie widzi odczytu referera',
    )
  })

  it('moduł nie loguje (console) – dane zdarzeń nie trafiają do konsoli', () => {
    assert.deepEqual(gdzie(['console.']), [])
  })
})

describe('struktura: ładowalność w gołym Node i React Compiler', () => {
  /** Instrukcje `import` z pliku jako [pełny tekst instrukcji, specyfikator]. */
  function importy(nazwa: string): [string, string][] {
    return [...tresc(nazwa).matchAll(/^import\b[\s\S]*?from\s+'([^']+)'/gm)].map((m) => [
      m[0],
      m[1] ?? '',
    ])
  }

  it('alias „@/” wolno importować wyłącznie jako `import type` (poza Pomiar.tsx)', () => {
    let sprawdzone = 0
    for (const nazwa of ZRODLA.filter((n) => n !== 'Pomiar.tsx')) {
      for (const [instrukcja, specyfikator] of importy(nazwa)) {
        if (!specyfikator.startsWith('@/')) continue
        sprawdzone++
        assert.ok(instrukcja.startsWith('import type'), `${nazwa}: ${specyfikator} bez „type”`)
      }
    }
    assert.ok(sprawdzone >= 3, 'skaner nie znalazł żadnego importu z aliasem')
  })

  it('kontrakt.ts nie ma runtime-importów (ładuje się w teście parytetu z api/)', () => {
    const wszystkie = importy('kontrakt.ts')
    assert.ok(wszystkie.length >= 1)
    for (const [instrukcja] of wszystkie) assert.ok(instrukcja.startsWith('import type'))
  })

  it('importy względne mają jawne rozszerzenie .ts/.tsx (Node nie dopisuje go sam)', () => {
    let sprawdzone = 0
    for (const nazwa of ZRODLA) {
      for (const [, specyfikator] of importy(nazwa)) {
        if (!specyfikator.startsWith('./')) continue
        sprawdzone++
        assert.match(specyfikator, /\.tsx?$/, `${nazwa}: ${specyfikator}`)
      }
    }
    assert.ok(sprawdzone >= 20)
  })

  it('żadnej ręcznej memoizacji (React Compiler robi to sam)', () => {
    for (const nazwa of WSZYSTKIE) {
      assert.ok(!/\buse(?:Memo|Callback)\b|\bReact\.memo\b|\bmemo\(/.test(tresc(nazwa)), nazwa)
    }
  })
})

describe('typografia', () => {
  it('żaden plik modułu (łącznie z testami) nie zawiera pauzy – tylko półpauza ze spacjami', () => {
    const pauza = String.fromCodePoint(0x2014)
    for (const nazwa of WSZYSTKIE) {
      assert.ok(!tresc(nazwa).includes(pauza), `pauza w ${nazwa}`)
    }
  })
})
