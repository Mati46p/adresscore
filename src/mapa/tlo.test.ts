// Teksty i drobna logika tła mapy (#223). Uruchom: node --test src/mapa/tlo.test.ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { MIASTA } from '../kontrakty/miasta.ts'
import {
  kotwicaPodpisu,
  podpisHeksuTla,
  podpisMgly,
  podpisPrzyciskuIntro,
  ramkaPodpisuMgly,
  TEKST_POZA_MIASTAMI,
  TEKST_POZA_MIASTEM,
  TEKST_SKALI_MIAST,
  tekstIntro,
  ZOOM_PODPISU_MIASTA,
} from './tlo.ts'

describe('dymek heksu tła', () => {
  it('wynik: „<Miasto> · wynik N (średnia okolicy)", zaokrąglony do całości', () => {
    assert.equal(podpisHeksuTla('Łódź', 62.4), 'Łódź · wynik 62 (średnia okolicy)')
    assert.equal(podpisHeksuTla('Białystok', 62.5), 'Białystok · wynik 63 (średnia okolicy)')
    assert.equal(podpisHeksuTla('Warszawa', 100), 'Warszawa · wynik 100 (średnia okolicy)')
  })

  it('brak danych (null, undefined, NaN, stan -1): „<Miasto> · brak danych", bez „średnia okolicy"', () => {
    for (const w of [null, undefined, Number.NaN, -1]) {
      assert.equal(podpisHeksuTla('Gdańsk', w), 'Gdańsk · brak danych')
    }
  })

  it('zero jest wynikiem, nie brakiem danych', () => {
    assert.equal(podpisHeksuTla('Poznań', 0), 'Poznań · wynik 0 (średnia okolicy)')
  })
})

// Pauzy nie zapisujemy literalnie: sam test miałby wtedy znak, którego pilnuje.
const PAUZA = String.fromCodePoint(0x2014)

describe('podpis mgły i legenda', () => {
  it('mapa wszystkich miast: „poza obsługiwanymi miastami – brak danych" (FR-011)', () => {
    assert.equal(TEKST_POZA_MIASTAMI, 'poza obsługiwanymi miastami – brak danych')
    assert.equal(podpisMgly(true), TEKST_POZA_MIASTAMI)
  })

  it('ekran jednego miasta nie twierdzi, że inne miasta nie są obsługiwane', () => {
    assert.equal(podpisMgly(false), TEKST_POZA_MIASTEM)
    assert.ok(!TEKST_POZA_MIASTEM.includes('obsługiwan'))
    assert.ok(!TEKST_POZA_MIASTEM.includes('Krakow'), 'tekst nie zakłada miasta')
  })

  it('legenda przy tle: skala liczona osobno w każdym mieście (D10)', () => {
    assert.equal(TEKST_SKALI_MIAST, 'Skala liczona osobno w każdym mieście')
  })

  it('żaden tekst nie zawiera pauzy, a myślnik to półpauza ze spacjami', () => {
    const teksty = [
      TEKST_POZA_MIASTAMI,
      TEKST_POZA_MIASTEM,
      TEKST_SKALI_MIAST,
      tekstIntro(),
      podpisPrzyciskuIntro('Łódź'),
      podpisHeksuTla('Łódź', 50),
      podpisHeksuTla('Łódź', null),
    ]
    for (const t of teksty) {
      assert.ok(!t.includes(PAUZA), `pauza w „${t}"`)
      assert.ok(!t.includes(' - '), `dywiz ze spacjami zamiast półpauzy w „${t}"`)
    }
    assert.ok(TEKST_POZA_MIASTAMI.includes(' – '))
    assert.ok(TEKST_POZA_MIASTEM.includes(' – '))
  })
})

describe('intro (?pokaz)', () => {
  it('podpis liczy miasta z rejestru: Kraków i 9 największych miast', () => {
    assert.equal(MIASTA.length, 10, 'rejestr się zmienił: sprawdź odmianę w tekstIntro()')
    assert.equal(tekstIntro(), 'Dane: Kraków i 9 największych miast')
  })

  it('przycisk wiedzie do bieżącego miasta, nie zawsze do Krakowa', () => {
    assert.equal(podpisPrzyciskuIntro('Kraków'), 'Pokaż Kraków')
    assert.equal(podpisPrzyciskuIntro('Wrocław'), 'Pokaż Wrocław')
  })
})

describe('kotwica podpisu mgły', () => {
  const miasto = [
    [19.6, 49.9],
    [20.4, 50.3],
  ] as [[number, number], [number, number]]
  const wszystkie = [
    [14, 49.6],
    [23.8, 54.8],
  ] as [[number, number], [number, number]]

  it('widok kraju: nad całością (nie zasłania sąsiednich miast); zbliżenie: przy bieżącym mieście', () => {
    assert.equal(ramkaPodpisuMgly(5, miasto, wszystkie), wszystkie)
    assert.equal(ramkaPodpisuMgly(ZOOM_PODPISU_MIASTA - 0.01, miasto, wszystkie), wszystkie)
    assert.equal(ramkaPodpisuMgly(ZOOM_PODPISU_MIASTA, miasto, wszystkie), miasto)
    assert.equal(ramkaPodpisuMgly(12, miasto, wszystkie), miasto)
  })

  it('bez bieżącego miasta (jeszcze się nie wczytało) podpis stoi nad całością także przy zbliżeniu', () => {
    assert.equal(ramkaPodpisuMgly(12, null, wszystkie), wszystkie)
  })

  it('bez żadnego obszaru z danymi nie ma czego podpisywać', () => {
    assert.equal(ramkaPodpisuMgly(5, null, null), null)
    assert.equal(ramkaPodpisuMgly(12, null, null), null)
  })

  it('bez ramki całości, a z miastem: podpis przy mieście', () => {
    assert.equal(ramkaPodpisuMgly(5, miasto, null), miasto)
  })

  it('kotwica: środek północnej krawędzi, [lon, lat]', () => {
    assert.deepEqual(kotwicaPodpisu(miasto), [20, 50.3])
    assert.deepEqual(kotwicaPodpisu(wszystkie), [18.9, 54.8])
  })
})
