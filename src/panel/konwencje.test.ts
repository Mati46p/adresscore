// Konwencje kodu panelu pilnowane maszynowo (CLAUDE.md projektu i globalny, spec FR-023):
//  - polski tekst bez pauzy (U+2014): myślnik to półpauza „–” ze spacjami,
//  - React Compiler jest włączony: żadnych useMemo, useCallback ani React.memo,
//  - biblioteka wykresów (recharts) wyłącznie w src/panel/** (leniwy chunk),
//  - z głównego kodu do panelu prowadzi jedna furtka: `ladujPanel` w ladowanieEkranow.ts,
//  - React Compiler faktycznie kompiluje komponenty panelu (nie pomija ich po cichu).
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, relative, sep } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const KATALOG_SRC = fileURLToPath(new URL('..', import.meta.url))
const KATALOG_PANELU = fileURLToPath(new URL('.', import.meta.url))

function pliki(katalog: string, rozszerzenia: readonly string[]): string[] {
  const wynik: string[] = []
  for (const nazwa of readdirSync(katalog)) {
    const sciezka = join(katalog, nazwa)
    if (statSync(sciezka).isDirectory()) wynik.push(...pliki(sciezka, rozszerzenia))
    else if (rozszerzenia.some((r) => nazwa.endsWith(r))) wynik.push(sciezka)
  }
  return wynik
}

const wzgledna = (sciezka: string) => relative(KATALOG_SRC, sciezka).split(sep).join('/')
const wPanelu = pliki(KATALOG_PANELU, ['.ts', '.tsx', '.css'])
/** Pauza (U+2014) zbudowana z kodu znaku: literał w źródle zostałby znormalizowany przez formatter. */
const PAUZA = String.fromCharCode(0x2014)

/** Kod bez komentarzy liniowych i blokowych (komentarz może wspominać o zakazanych rzeczach). */
function bezKomentarzy(zrodlo: string): string {
  return zrodlo.replaceAll(/\/\*[\s\S]*?\*\//g, '').replaceAll(/^\s*\/\/.*$/gm, '')
}

describe('konwencje panelu', () => {
  it('test widzi pliki panelu (kontrola, że skan cokolwiek zmierzył)', () => {
    assert.ok(wPanelu.length >= 10, `znaleziono tylko ${wPanelu.length} plików`)
  })

  it('brak pauzy (U+2014) w jakimkolwiek tekście panelu i w jego wpięciach', () => {
    const wpiecia = [
      'wynik/url.ts',
      'wynik/stan.ts',
      'wynik/urlPanel.test.ts',
      'lib/supabase.ts',
      'karta/ladowanieEkranow.ts',
      'karta/Aplikacja.tsx',
    ].map((p) => join(KATALOG_SRC, p))
    for (const plik of [...wPanelu, ...wpiecia]) {
      const tresc = readFileSync(plik, 'utf8')
      const indeks = tresc.indexOf(PAUZA)
      assert.equal(
        indeks,
        -1,
        `${wzgledna(plik)}: pauza (U+2014) w pozycji ${indeks}, użyj półpauzy „–”`,
      )
    }
  })

  it('React Compiler: żadnych useMemo, useCallback ani memo() w panelu', () => {
    for (const plik of wPanelu.filter((p) => /\.tsx?$/.test(p))) {
      if (plik === fileURLToPath(import.meta.url)) continue
      const kod = bezKomentarzy(readFileSync(plik, 'utf8'))
      assert.doesNotMatch(kod, /\buse(Memo|Callback)\s*\(/, `${wzgledna(plik)}: ręczna memoizacja`)
      assert.doesNotMatch(kod, /\b(React\.)?memo\s*\(/, `${wzgledna(plik)}: React.memo`)
    }
  })

  it('recharts tylko w src/panel/** (FR-023: kod wykresów nie trafia do głównej paczki)', () => {
    for (const plik of pliki(KATALOG_SRC, ['.ts', '.tsx'])) {
      if (plik.startsWith(KATALOG_PANELU)) continue
      const kod = bezKomentarzy(readFileSync(plik, 'utf8'))
      assert.doesNotMatch(kod, /from\s+['"]recharts['"]/, `${wzgledna(plik)} importuje recharts`)
    }
  })

  it('z głównego kodu do panelu prowadzi tylko ladujPanel w ladowanieEkranow.ts', () => {
    const dozwolone = new Set(['karta/ladowanieEkranow.ts'])
    for (const plik of pliki(KATALOG_SRC, ['.ts', '.tsx'])) {
      if (plik.startsWith(KATALOG_PANELU)) continue
      const wz = wzgledna(plik)
      const kod = bezKomentarzy(readFileSync(plik, 'utf8'))
      if (/['"]@\/panel[/'"]/.test(kod)) {
        assert.ok(dozwolone.has(wz), `${wz} importuje panel; wolno tylko przez ladujPanel`)
      }
    }
    const furtka = readFileSync(join(KATALOG_SRC, 'karta/ladowanieEkranow.ts'), 'utf8')
    assert.match(furtka, /export const ladujPanel = \(\) => import\('@\/panel\/EkranPanel'\)/)
  })
})

// React Compiler po cichu POMIJA komponenty, których nie rozumie (komponent działa, tylko bez
// automatycznej memoizacji). Dwa wzorce, które wyłączają kompilację w tej wersji toolchainu
// (babel-plugin-react-compiler 1.0 + Babel 8), a łatwo je napisać nieświadomie:
//  - wartość domyślna w destrukturyzacji parametrów komponentu: `function K({ a = 1 }: P)`,
//  - blok `try { … } finally { … }` bez `catch` w ciele komponentu.
// Rozwiązanie: domyślne wartości przez `??` w ciele funkcji, `try/finally` przez `.finally()`.
describe('React Compiler kompiluje komponenty panelu', () => {
  const require = createRequire(import.meta.url)
  const kompilowane = wPanelu.filter((p) => p.endsWith('.tsx') && !p.endsWith('.test.tsx'))

  /** Skompilowane funkcje i problemy (błędy, pominięcia) jednego pliku. */
  function kompiluj(plik: string): { sukcesy: number; problemy: string[] } {
    const babel = require('@babel/core')
    const kompilator = require('babel-plugin-react-compiler')
    const zdarzenia: { kind: string; fnName?: string; detail?: { reason?: string } }[] = []
    babel.transformSync(readFileSync(plik, 'utf8'), {
      filename: plik,
      babelrc: false,
      configFile: false,
      parserOpts: { plugins: ['typescript', 'jsx'] },
      plugins: [
        [
          kompilator.default ?? kompilator,
          { logger: { logEvent: (_f: string, e: never) => zdarzenia.push(e) } },
        ],
      ],
    })
    return {
      sukcesy: zdarzenia.filter((e) => e.kind === 'CompileSuccess').length,
      problemy: zdarzenia
        .filter(
          (e) =>
            e.kind === 'CompileError' || e.kind === 'CompileSkip' || e.kind === 'PipelineError',
        )
        .map(
          (e) => `${e.kind}${e.fnName ? ` w ${e.fnName}` : ''}: ${e.detail?.reason ?? 'bez opisu'}`,
        ),
    }
  }

  it('fundament (ekran, logowanie, składniki) kompiluje się bez błędów i pominięć', () => {
    const fundament = kompilowane.filter((p) => !p.includes(`${sep}zakladki${sep}`))
    assert.ok(fundament.length >= 10, `znaleziono tylko ${fundament.length} plików .tsx`)
    let sukcesy = 0
    for (const plik of fundament) {
      const wynik = kompiluj(plik)
      sukcesy += wynik.sukcesy
      assert.deepEqual(
        wynik.problemy,
        [],
        `${wzgledna(plik)}: kompilator pominął komponent (patrz komentarz nad tym testem)`,
      )
    }
    // Kontrola, że logger kompilatora w ogóle coś zgłasza: inaczej brak problemów byłby pozorny.
    assert.ok(sukcesy >= 15, `kompilator zgłosił tylko ${sukcesy} skompilowanych funkcji`)
  })

  it('zakładki: ewentualne pominięcia kompilatora są tylko zgłaszane (nie blokują)', (t) => {
    for (const plik of kompilowane.filter((p) => p.includes(`${sep}zakladki${sep}`))) {
      for (const problem of kompiluj(plik).problemy) {
        t.diagnostic(`${wzgledna(plik)}: ${problem}`)
      }
    }
  })
})
