import assert from 'node:assert/strict'
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { DANE } from './lib/wspolne.mjs'
import { dekodujBsq, indeksKomorki, wycinekSiatki } from './osiadanie.mjs'

test('bsq: bajty Int8 i maska ważności od najstarszego bitu', () => {
  // 3 × 3 = 9 pikseli, maska zajmuje ⌈9/8⌉ = 2 bajty
  const wartosci = [-128, 0, -1, 5, -128, -13, 0, 127, -128]
  const maska = [0b01110110, 0b10000000] // piksele 1,2,3,5,6 ważne, 8 ważny, reszta nie
  const bufor = Buffer.from([...wartosci.map((v) => v & 0xff), ...maska])
  const { wartosci: w, wazne } = dekodujBsq(bufor, 3, 3)
  assert.deepEqual([...w], wartosci)
  assert.deepEqual([...wazne], [0, 1, 1, 1, 0, 1, 1, 0, 1])
  // zmierzone 0 (piksel 1) i brak pomiaru (piksel 0, wartość -128) to różne rzeczy
  assert.equal(wazne[1], 1)
  assert.equal(w[1], 0)
  assert.equal(wazne[0], 0)
})

test('bsq: odpowiedź o złej długości (np. błąd usługi) jest odrzucana', () => {
  assert.throws(() => dekodujBsq(Buffer.from('{"error":{"code":400}}'), 3, 3), /bsq/)
  assert.throws(() => dekodujBsq(Buffer.alloc(9), 3, 3), /bsq/, 'brak maski')
  assert.doesNotThrow(() => dekodujBsq(Buffer.alloc(11), 3, 3))
})

test('siatka: wycinek przyciągnięty do komórek źródła i indeks komórki punktu', () => {
  const zrodlo = { x0: 100, y1: 1000, piksel: 10 }
  const s = wycinekSiatki(zrodlo, [125, 905, 155, 940], 0)
  assert.equal(s.kol0, 2)
  assert.equal(s.wiersz0, 6)
  assert.equal(s.w, 4)
  assert.equal(s.h, 4)
  // bbox obejmuje całe komórki: x 120–160, y 900–940
  assert.deepEqual(s.bbox, [120, 900, 160, 940])
  assert.equal(indeksKomorki(125, 935, s), 0, 'lewy górny róg wycinka')
  assert.equal(indeksKomorki(155, 905, s), 15, 'prawy dolny róg wycinka')
  assert.equal(indeksKomorki(131, 925, s), 1 * 4 + 1, 'kolumna 1, wiersz 1 wycinka')
  assert.equal(indeksKomorki(50, 935, s), null, 'poza wycinkiem')
  assert.equal(indeksKomorki(125, 990, s), null, 'nad wycinkiem')
  // z marginesem wycinek rośnie o komórkę z każdej strony
  const z = wycinekSiatki(zrodlo, [125, 905, 155, 940], 1)
  assert.equal(z.w, 6)
  assert.equal(z.h, 6)
  assert.equal(indeksKomorki(125, 935, z), 1 * 6 + 1)
})

// ---------- Wygenerowany plik (po `node etl/osiadanie.mjs`) ----------
test('plik wskaźnika osiadanie_mm_rok: kontrakt, zakres i zgodność z adresami', () => {
  const adresy = JSON.parse(readFileSync(join(DANE, 'adresy.json'), 'utf8'))
  const k = adresy.kolumny
  const p = JSON.parse(readFileSync(join(DANE, 'wskazniki/osiadanie_mm_rok.json'), 'utf8'))
  assert.equal(p.wersjaAdresow, adresy.wersja)
  assert.equal(p.wartosci.length, k.id.length)
  assert.equal(p.etykiety, undefined)
  assert.equal(p.meta.id, 'osiadanie_mm_rok')
  assert.equal(p.meta.zadanie, 117)
  assert.equal(p.meta.kategoria, 'kontekst', 'fakt na karcie, bez wpływu na wynik')
  assert.equal(p.meta.kierunek, 'neutralny')
  assert.equal(p.meta.jednostka, 'mm/rok')
  assert.equal(p.meta.rozdzielczosc, 'siatka')
  assert.equal(p.meta.rozmiar, '123 m')
  assert.ok(p.meta.zrodla.length >= 2)
  for (const z of p.meta.zrodla)
    for (const pole of ['nazwa', 'url', 'licencja', 'dataDanych', 'pobrano'])
      assert.ok(z[pole], `źródło bez pola ${pole}`)
  assert.ok(
    !JSON.stringify(p).includes(String.fromCharCode(0x2014)),
    'w polskim tekście półpauza, nigdy pauza',
  )
  assert.ok(statSync(join(DANE, 'wskazniki/osiadanie_mm_rok.json')).size < 2 * 1024 * 1024)

  let zPomiarem = 0
  const poGminie = new Map()
  p.wartosci.forEach((v, i) => {
    if (v === null) return
    zPomiarem++
    assert.ok(Number.isInteger(v) && v >= -128 && v <= 127, `wartość ${v}`)
    const g = poGminie.get(k.gmina[i]) ?? { n: 0, osiadanie: 0 }
    g.n++
    if (v <= -5) g.osiadanie++
    poGminie.set(k.gmina[i], g)
  })
  const pokrycie = zPomiarem / k.id.length
  assert.ok(pokrycie > 0.8 && pokrycie < 1, `pokrycie ${pokrycie}`)
  // Znany sygnał: osiadanie nad wyrobiskami kopalni soli w Wieliczce.
  assert.ok(poGminie.get('Wieliczka').osiadanie > 500, 'Wieliczka: osiadanie ≥ 5 mm/rok')
  // Płaskie tereny po drugiej stronie Wisły prawie nie osiadają.
  assert.ok(poGminie.get('Igołomia-Wawrzeńczyce').osiadanie === 0)
})
