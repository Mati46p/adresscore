// Przejścia stanu → zdarzenia pomiaru. Uruchom: node --test src/pomiar/
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { type Akcja, type Migawka, migawka, przejscia } from './przejscia.ts'

const baza: Migawka = {
  ekran: 'szukaj',
  wybrany: null,
  porownanie: 0,
  warstwa: 'wynik',
  tryb: 'kupuje',
}
const z = (zmiany: Partial<Migawka>): Migawka => ({ ...baza, ...zmiany })

const odslona = (ekran: string): Akcja => ({ rodzaj: 'odslona', ekran })
const produktowe = (nazwa: Extract<Akcja, { rodzaj: 'produktowe' }>['nazwa']): Akcja => ({
  rodzaj: 'produktowe',
  nazwa,
})

describe('przejscia: odsłony', () => {
  it('start pomiaru otwiera odsłonę bieżącego ekranu', () => {
    assert.deepEqual(przejscia(null, baza), [odslona('szukaj')])
  })

  it('zmiana ekranu = nowa odsłona', () => {
    assert.deepEqual(przejscia(baza, z({ ekran: 'porownanie' })), [odslona('porownanie')])
    assert.deepEqual(przejscia(z({ ekran: 'porownanie' }), z({ ekran: 'metoda' })), [
      odslona('metoda'),
    ])
  })

  it('ten sam ekran i ten sam stan: nic', () => {
    assert.deepEqual(przejscia(baza, baza), [])
    assert.deepEqual(przejscia(baza, z({ wybrany: 4 })), [], 'klik w mapę na wyszukiwarce')
  })

  it('karta adresu: przejście z innego ekranu = odsłona + karta_adresu', () => {
    assert.deepEqual(przejscia(baza, z({ ekran: 'okolica', wybrany: 7 })), [
      odslona('okolica'),
      produktowe('karta_adresu'),
    ])
  })

  it('inny adres na karcie = nowa odsłona i nowa karta_adresu', () => {
    const a = z({ ekran: 'okolica', wybrany: 7 })
    assert.deepEqual(przejscia(a, z({ ekran: 'okolica', wybrany: 9 })), [
      odslona('okolica'),
      produktowe('karta_adresu'),
    ])
  })

  it('start z linku /adres/<slug>: okolica z wybrany = null, po wczytaniu danych tylko karta_adresu', () => {
    const wLinku = z({ ekran: 'okolica', wybrany: null })
    assert.deepEqual(przejscia(null, wLinku), [odslona('okolica')])
    assert.deepEqual(
      przejscia(wLinku, z({ ekran: 'okolica', wybrany: 12 })),
      [produktowe('karta_adresu')],
      'adres w pasku ten sam – to NIE jest nowa odsłona',
    )
  })

  it('start na karcie, gdy dane są już wczytane: odsłona + karta_adresu', () => {
    assert.deepEqual(przejscia(null, z({ ekran: 'okolica', wybrany: 3 })), [
      odslona('okolica'),
      produktowe('karta_adresu'),
    ])
  })

  it('karta bez zmian (np. suwak wag na karcie): nic', () => {
    const k = z({ ekran: 'okolica', wybrany: 7 })
    assert.deepEqual(przejscia(k, { ...k }), [])
  })

  it('odsłona zawsze przed zdarzeniami produktowymi', () => {
    const akcje = przejscia(baza, z({ ekran: 'okolica', wybrany: 1, porownanie: 1 }))
    assert.equal(akcje[0]?.rodzaj, 'odslona')
  })
})

describe('przejscia: zdarzenia produktowe', () => {
  it('porownanie_dodaj tylko gdy lista ROŚNIE', () => {
    assert.deepEqual(przejscia(baza, z({ porownanie: 1 })), [produktowe('porownanie_dodaj')])
    assert.deepEqual(przejscia(z({ porownanie: 2 }), z({ porownanie: 3 })), [
      produktowe('porownanie_dodaj'),
    ])
    assert.deepEqual(przejscia(z({ porownanie: 3 }), z({ porownanie: 2 })), [], 'usunięcie')
    assert.deepEqual(przejscia(z({ porownanie: 2 }), z({ porownanie: 2 })), [])
  })

  it('lista porównania z linku na starcie nie jest „dodaniem”', () => {
    assert.deepEqual(przejscia(null, z({ porownanie: 3 })), [odslona('szukaj')])
  })

  it('warstwa_mapy z id warstwy, gdy zmienia się na inną niż „wynik”', () => {
    assert.deepEqual(przejscia(baza, z({ warstwa: 'halas_ldwn' })), [
      { rodzaj: 'produktowe', nazwa: 'warstwa_mapy', wlasciwosci: { warstwa: 'halas_ldwn' } },
    ])
    assert.deepEqual(przejscia(z({ warstwa: 'halas_ldwn' }), z({ warstwa: 'powietrze_pm25' })), [
      { rodzaj: 'produktowe', nazwa: 'warstwa_mapy', wlasciwosci: { warstwa: 'powietrze_pm25' } },
    ])
  })

  it('powrót na „wynik” i ta sama warstwa: nic', () => {
    assert.deepEqual(przejscia(z({ warstwa: 'halas_ldwn' }), z({ warstwa: 'wynik' })), [])
    assert.deepEqual(przejscia(z({ warstwa: 'halas_ldwn' }), z({ warstwa: 'halas_ldwn' })), [])
  })

  it('tryb_biznes po przejściu w tryb biznes (razem z odsłoną ekranu Biznes)', () => {
    assert.deepEqual(przejscia(baza, z({ ekran: 'biznes', tryb: 'biznes' })), [
      odslona('biznes'),
      produktowe('tryb_biznes'),
    ])
  })

  it('zmiana parametrów na ekranie Biznes (tryb już biznes) nie liczy się drugi raz', () => {
    const b = z({ ekran: 'biznes', tryb: 'biznes' })
    assert.deepEqual(przejscia(b, { ...b, porownanie: 0 }), [])
  })

  it('wyjście z Biznesu do mieszkańca: odsłona nowego ekranu, bez tryb_biznes', () => {
    assert.deepEqual(przejscia(z({ ekran: 'biznes', tryb: 'biznes' }), z({ ekran: 'szukaj' })), [
      odslona('szukaj'),
    ])
  })

  it('start na #/biznes liczy się jako użycie trybu', () => {
    assert.deepEqual(przejscia(null, z({ ekran: 'biznes', tryb: 'biznes' })), [
      odslona('biznes'),
      produktowe('tryb_biznes'),
    ])
  })

  it('tryb_miasto po wejściu na ekran Miasto, raz', () => {
    assert.deepEqual(przejscia(baza, z({ ekran: 'miasto' })), [
      odslona('miasto'),
      produktowe('tryb_miasto'),
    ])
    const m = z({ ekran: 'miasto' })
    assert.deepEqual(przejscia(m, { ...m }), [])
  })

  it('kilka zmian naraz: wszystkie zdarzenia, w stałej kolejności', () => {
    const akcje = przejscia(
      baza,
      z({ ekran: 'okolica', wybrany: 2, porownanie: 1, warstwa: 'zielen_pokrycie' }),
    )
    assert.deepEqual(
      akcje.map((a) => (a.rodzaj === 'odslona' ? 'odslona' : a.nazwa)),
      ['odslona', 'karta_adresu', 'porownanie_dodaj', 'warstwa_mapy'],
    )
  })
})

describe('migawka', () => {
  it('wyciąga z pełnego stanu tylko to, co czyta pomiar', () => {
    const m = migawka({
      ekran: 'okolica',
      wybrany: 5,
      porownanie: [1, 2, 3],
      warstwa: 'wynik',
      tryb: 'kupuje',
    })
    assert.deepEqual(m, {
      ekran: 'okolica',
      wybrany: 5,
      porownanie: 3,
      warstwa: 'wynik',
      tryb: 'kupuje',
    })
  })
})
