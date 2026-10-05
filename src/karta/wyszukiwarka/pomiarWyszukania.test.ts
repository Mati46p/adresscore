// Pomiar wyszukiwarki: reguły zatwierdzenia, rodzaj, fraza, zgodność z rdzeniem pomiaru (T062).
// Uruchom: node --test src/karta/wyszukiwarka/
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Zdarzenie } from '../../pomiar/kontrakt.ts'
import { utworzRdzen } from '../../pomiar/rdzen.ts'
import {
  BEZCZYNNOSC_MS,
  czyBezczynnoscZatwierdza,
  kluczWyszukania,
  MIN_ZNAKOW_BEZCZYNNOSC,
  rodzajWyszukania,
  zdarzenieWyszukania,
} from './pomiarWyszukania.ts'

describe('zatwierdzenie bezczynnością', () => {
  it('wymaga co najmniej trzech znaków i liczy je bez spacji na brzegach', () => {
    assert.equal(BEZCZYNNOSC_MS, 1000)
    assert.equal(MIN_ZNAKOW_BEZCZYNNOSC, 3)
    assert.equal(czyBezczynnoscZatwierdza(''), false)
    assert.equal(czyBezczynnoscZatwierdza('ab'), false)
    assert.equal(czyBezczynnoscZatwierdza('  ab  '), false)
    assert.equal(czyBezczynnoscZatwierdza('abc'), true)
    assert.equal(czyBezczynnoscZatwierdza('  abc '), true)
  })
})

describe('rodzaj wyszukania', () => {
  it('podpowiedź okolicy to zawsze okolica, także gdy zapytanie ma cyfry', () => {
    assert.equal(rodzajWyszukania('okolica', 'Ruczaj'), 'okolica')
    assert.equal(rodzajWyszukania('okolica', 'Osiedle Dywizjonu 303'), 'okolica')
  })

  it('adres z numerem domu w zapytaniu to adres', () => {
    assert.equal(rodzajWyszukania('adres', 'Grodzka 52'), 'adres')
    assert.equal(rodzajWyszukania('adres', 'Wieliczka 17a'), 'adres')
  })

  it('adres bez numeru domu to ulica (pierwszy token nigdy nie jest numerem)', () => {
    assert.equal(rodzajWyszukania('adres', 'Grodzka'), 'ulica')
    assert.equal(rodzajWyszukania('adres', '3 Maja'), 'ulica')
  })
})

describe('zdarzenie zatwierdzonego zapytania', () => {
  it('są podpowiedzi: wyszukanie z ich liczbą i rodzajem', () => {
    assert.deepEqual(zdarzenieWyszukania('Grodzka 52', 3, 'adres'), {
      nazwa: 'wyszukanie',
      wlasciwosci: { wynikow: 3, rodzaj: 'adres' },
    })
    assert.deepEqual(zdarzenieWyszukania('Ruczaj', 5, 'okolica'), {
      nazwa: 'wyszukanie',
      wlasciwosci: { wynikow: 5, rodzaj: 'okolica' },
    })
  })

  it('brak podpowiedzi: wyszukanie bez wyniku ze znormalizowaną frazą', () => {
    assert.deepEqual(zdarzenieWyszukania('  Zzz   KQX ', 0, undefined), {
      nazwa: 'wyszukanie_bez_wyniku',
      wlasciwosci: { fraza: 'zzz kqx' },
    })
  })

  it('fraza z danymi osobowymi nie wychodzi: zostaje znacznik odrzucenia', () => {
    for (const zapytanie of ['jan.kowalski@example.pl', '600 123 456', '44051401359']) {
      const zdarzenie = zdarzenieWyszukania(zapytanie, 0, undefined)
      assert.equal(zdarzenie.nazwa, 'wyszukanie_bez_wyniku')
      assert.deepEqual(zdarzenie.wlasciwosci, { odrzucono: true }, zapytanie)
      assert.ok(!JSON.stringify(zdarzenie).includes('kowalski'))
    }
  })

  it('wyszukanie z wynikami nie niesie frazy w ogóle', () => {
    const zdarzenie = zdarzenieWyszukania('Grodzka 52', 2, 'adres')
    assert.deepEqual(Object.keys(zdarzenie.wlasciwosci).sort(), ['rodzaj', 'wynikow'])
  })
})

describe('klucz zapytania (jedno zdarzenie na zatwierdzenie)', () => {
  it('wielkość liter i odstępy nie robią różnicy', () => {
    assert.equal(kluczWyszukania('Grodzka  52'), kluczWyszukania(' grodzka 52 '))
    assert.notEqual(kluczWyszukania('Grodzka 52'), kluczWyszukania('Grodzka 53'))
  })

  it('zapytania z danymi osobowymi dzielą jeden klucz i nie ujawniają treści', () => {
    const a = kluczWyszukania('jan@example.pl')
    assert.equal(a, kluczWyszukania('anna@example.pl'))
    assert.ok(!a.includes('@'))
  })
})

describe('zgodność z rdzeniem pomiaru', () => {
  /** Rdzeń z atrapą kolejki: widać dokładnie to, co poszłoby do sieci. */
  function rdzenZAtrapa() {
    const wyslane: Zdarzenie[] = []
    let t = 0
    const rdzen = utworzRdzen({
      kolejka: { dodaj: (zdarzenie) => void wyslane.push(zdarzenie), zamknij: () => {} },
      // Zegar rośnie, żeby okno powtórek rdzenia nie zlewało kolejnych zdarzeń w jedno.
      teraz: () => (t += 1000),
      widoczna: () => true,
      okno: () => ({ dno: 800, wysokoscDokumentu: 800, wysokoscOkna: 800 }),
      dno: () => 800,
      wylaczony: () => false,
      urzadzenie: 'desktop',
      wejscie: {},
      wlasnyHost: 'adresscore.pl',
    })
    rdzen.odslona('szukaj', '/')
    wyslane.length = 0
    return { rdzen, wyslane }
  }

  it('wyszukanie dochodzi z liczbą i rodzajem', () => {
    const { rdzen, wyslane } = rdzenZAtrapa()
    const z = zdarzenieWyszukania('Ruczaj', 4, 'okolica')
    rdzen.produktowe(z.nazwa, z.wlasciwosci)
    assert.deepEqual(wyslane, [
      {
        t: 'produktowe',
        e: 'szukaj',
        s: '/',
        u: 'desktop',
        n: 'wyszukanie',
        w: { wynikow: 4, rodzaj: 'okolica' },
      },
    ])
  })

  it('wyszukanie bez wyniku dochodzi z frazą dokładnie raz znormalizowaną', () => {
    const { rdzen, wyslane } = rdzenZAtrapa()
    const z = zdarzenieWyszukania('  Zzz   KQX ', 0, undefined)
    rdzen.produktowe(z.nazwa, z.wlasciwosci)
    assert.deepEqual(
      wyslane.map((zdarzenie) => zdarzenie.t === 'produktowe' && [zdarzenie.n, zdarzenie.w]),
      [['wyszukanie_bez_wyniku', { fraza: 'zzz kqx' }]],
    )
  })

  it('e-mail i telefon w zapytaniu nie opuszczają przeglądarki', () => {
    const { rdzen, wyslane } = rdzenZAtrapa()
    for (const zapytanie of ['jan.kowalski@example.pl', '600 123 456']) {
      const z = zdarzenieWyszukania(zapytanie, 0, undefined)
      rdzen.produktowe(z.nazwa, z.wlasciwosci)
    }
    assert.equal(wyslane.length, 2)
    for (const zdarzenie of wyslane) {
      assert.deepEqual(zdarzenie.t === 'produktowe' && zdarzenie.w, {
        fraza: '[odrzucono]',
        odrzucono: true,
      })
    }
    const druk = JSON.stringify(wyslane)
    assert.ok(!druk.includes('kowalski') && !druk.includes('600'))
  })
})
