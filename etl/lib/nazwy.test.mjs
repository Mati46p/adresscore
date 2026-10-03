import assert from 'node:assert/strict'
import test from 'node:test'
import { bezOgonkow, przytnijNazwe, skrocNazwe, slowaNazwy, tenSamZaklad } from './nazwy.mjs'

test('skrocNazwe: zdejmuje formę prawną tylko z końca i zbija spacje', () => {
  assert.equal(skrocNazwe('Synthos Dwory 7 Sp. z o. o. '), 'Synthos Dwory 7')
  assert.equal(
    skrocNazwe('TAMEH Polska Sp. z o. o.\nZakład Wytwarzania'),
    'TAMEH Polska Sp. z o. o. Zakład Wytwarzania',
  )
  assert.equal(skrocNazwe('PGE Energia Ciepła S.A.'), 'PGE Energia Ciepła')
  assert.equal(
    skrocNazwe('Ekoplon spółka z ograniczoną odpowiedzialnością spółka komandytowa'),
    'Ekoplon spółka z ograniczoną odpowiedzialnością',
  )
  assert.equal(skrocNazwe('STACO POLSKA Spółka z Ograniconą Odpowiedzialnością'), 'STACO POLSKA')
  assert.equal(skrocNazwe('Kopalnia Soli "Wieliczka"'), 'Kopalnia Soli "Wieliczka"')
  // „SA” w środku słowa i skrót w środku nazwy zostają
  assert.equal(skrocNazwe('SAICA PAPER POLSKA'), 'SAICA PAPER POLSKA')
  assert.equal(
    skrocNazwe('ArcelorMittal Poland S.A. - Oddział w Krakowie'),
    'ArcelorMittal Poland S.A. - Oddział w Krakowie',
  )
})

test('przytnijNazwe: krótka bez zmian, długa ucięta na granicy słowa z wielokropkiem', () => {
  assert.equal(przytnijNazwe('Krótka nazwa', 60), 'Krótka nazwa')
  const dluga = 'Miejskie Przedsiębiorstwo Oczyszczania Składowisko Odpadów Komunalnych'
  const wynik = przytnijNazwe(dluga, 40)
  assert.ok(wynik.length <= 40)
  assert.ok(wynik.endsWith('…'))
  assert.ok(!wynik.includes('Składowis…'), 'nie tnie w środku słowa')
  assert.equal(wynik, 'Miejskie Przedsiębiorstwo Oczyszczania…')
})

test('bezOgonkow i słowa nazwy: ł, polskie znaki i słowa prawne znikają', () => {
  assert.equal(
    bezOgonkow('Zakłady Górniczo-Hutnicze “Bolesław”'),
    'zaklady gorniczo-hutnicze “boleslaw”',
  )
  assert.deepEqual([...slowaNazwy('PGE Energia Ciepła S.A. Oddział nr 1 w Krakowie')].sort(), [
    'ciepla',
    'energia',
    'krakowie',
    'pge',
  ])
})

test('tenSamZaklad: ten sam zakład zapisany inaczej w dwóch rejestrach', () => {
  assert.equal(
    tenSamZaklad(
      'ORLEN S. A. Terminal Paliw w Olszanicy BP 81',
      'Terminal Paliw w Olszanicy BP 81 - ORLEN S.A.',
    ),
    true,
  )
  assert.equal(
    tenSamZaklad(
      'PGE Energia Ciepła S. A. Oddział nr 1 w Krakowie',
      'PGE Energia Ciepła S.A. Oddział w Krakowie',
    ),
    true,
  )
  assert.equal(
    tenSamZaklad(
      'ORLEN S. A. Oddział PGNiG w Sanoku Podziemny Magazyn Gazu Swarzów',
      'ORLEN S. A. ODDZIAŁ UPSTREAM POLSKA W SANOKU Podziemny Magazyn Gazu Swarzów',
    ),
    true,
  )
  assert.equal(
    tenSamZaklad(
      'ALKAT Sp. z o.o. Zakład w Krakowie',
      'ArcelorMittal Poland S.A. - Oddział w Krakowie',
    ),
    false,
  )
  assert.equal(tenSamZaklad('', 'cokolwiek'), false)
})
