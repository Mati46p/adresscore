// Kolejka zdarzeń na atrapie transportu i zegara (bez DOM). Uruchom: node --test src/pomiar/
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { BEZCZYNNOSC_MS, podzielNaCiala, utworzKolejke, type Zegar } from './kolejka.ts'
import type { Paczka, Zdarzenie } from './kontrakt.ts'
import { LIMIT_CIALA, MAX_PACZKA } from './kontrakt.ts'

function atrapaZegara() {
  let teraz = 0
  let licznik = 0
  const zadania = new Map<number, { kiedy: number; funkcja: () => void }>()
  const zegar: Zegar = {
    ustaw(funkcja, ms) {
      const id = ++licznik
      zadania.set(id, { kiedy: teraz + ms, funkcja })
      return id
    },
    wyczysc(uchwyt) {
      zadania.delete(uchwyt as number)
    },
  }
  return {
    zegar,
    oczekujace: () => zadania.size,
    uplyw(ms: number) {
      const cel = teraz + ms
      for (;;) {
        const nastepne = [...zadania.entries()]
          .filter(([, z]) => z.kiedy <= cel)
          .sort((a, b) => a[1].kiedy - b[1].kiedy)[0]
        if (!nastepne) break
        zadania.delete(nastepne[0])
        teraz = nastepne[1].kiedy
        nastepne[1].funkcja()
      }
      teraz = cel
    },
  }
}

const zdarzenie = (n: number | string, dodatki: Partial<{ s: string }> = {}): Zdarzenie => ({
  t: 'blad',
  e: 'szukaj',
  s: dodatki.s ?? '/',
  u: 'desktop',
  k: `blad-${n}`,
})

function srodowisko(opcje: { wylaczony?: boolean; ukryta?: boolean; rzuca?: boolean } = {}) {
  const stan = { wylaczony: opcje.wylaczony ?? false, ukryta: opcje.ukryta ?? false }
  const wyslane: string[] = []
  const zegar = atrapaZegara()
  const kolejka = utworzKolejke({
    wyslij(cialo) {
      if (opcje.rzuca) throw new Error('siec')
      wyslane.push(cialo)
    },
    wylaczony: () => stan.wylaczony,
    czyUkryta: () => stan.ukryta,
    zegar: zegar.zegar,
  })
  const paczki = () => wyslane.map((c) => (JSON.parse(c) as Paczka).z)
  return { stan, wyslane, zegar, kolejka, paczki }
}

describe('kolejka: kiedy wychodzi paczka', () => {
  it('po 5 s bezczynności, nie wcześniej', () => {
    const s = srodowisko()
    s.kolejka.dodaj(zdarzenie(1))
    s.zegar.uplyw(BEZCZYNNOSC_MS - 1)
    assert.equal(s.wyslane.length, 0)
    s.zegar.uplyw(1)
    assert.equal(s.paczki().length, 1)
    assert.deepEqual(s.paczki()[0], [zdarzenie(1)])
    assert.equal(s.kolejka.rozmiar(), 0)
  })

  it('każde nowe zdarzenie odnawia zegar bezczynności', () => {
    const s = srodowisko()
    s.kolejka.dodaj(zdarzenie(1))
    s.zegar.uplyw(3000)
    s.kolejka.dodaj(zdarzenie(2))
    s.zegar.uplyw(3000)
    assert.equal(s.wyslane.length, 0, 'od ostatniego zdarzenia minęło tylko 3 s')
    s.zegar.uplyw(2000)
    assert.equal(s.paczki().length, 1)
    assert.deepEqual(s.paczki()[0], [zdarzenie(1), zdarzenie(2)])
  })

  it('po zapełnieniu (10 zdarzeń) wychodzi od razu, następne zaczyna nową paczkę', () => {
    const s = srodowisko()
    for (let i = 1; i < MAX_PACZKA; i++) s.kolejka.dodaj(zdarzenie(i))
    assert.equal(s.wyslane.length, 0)
    s.kolejka.dodaj(zdarzenie(MAX_PACZKA))
    assert.equal(s.paczki().length, 1)
    assert.equal(s.paczki()[0]?.length, MAX_PACZKA)
    assert.equal(s.zegar.oczekujace(), 0, 'zegar skasowany po wysyłce')
    s.kolejka.dodaj(zdarzenie(11))
    assert.equal(s.kolejka.rozmiar(), 1)
    assert.equal(s.zegar.oczekujace(), 1)
  })

  it('zamknij() wysyła od razu i kasuje zegar', () => {
    const s = srodowisko()
    s.kolejka.dodaj(zdarzenie(1))
    s.kolejka.dodaj(zdarzenie(2))
    s.kolejka.zamknij()
    assert.equal(s.paczki().length, 1)
    assert.equal(s.zegar.oczekujace(), 0)
    s.zegar.uplyw(BEZCZYNNOSC_MS * 2)
    assert.equal(s.wyslane.length, 1, 'zegar nie wysyła drugi raz')
  })

  it('dubel zamknij() (pagehide po visibilitychange) nie wysyła niczego drugi raz', () => {
    const s = srodowisko()
    s.kolejka.dodaj(zdarzenie(1))
    s.kolejka.zamknij()
    s.kolejka.zamknij()
    s.kolejka.zamknij()
    assert.equal(s.wyslane.length, 1)
  })

  it('zamknij() na pustym buforze nic nie wysyła', () => {
    const s = srodowisko()
    s.kolejka.zamknij()
    assert.equal(s.wyslane.length, 0)
  })

  it('zamknij(dodatkowe) dopisuje na końcu i wysyła jedną paczką', () => {
    const s = srodowisko()
    s.kolejka.dodaj(zdarzenie(1))
    s.kolejka.zamknij([zdarzenie(2), zdarzenie(3)])
    assert.equal(s.paczki().length, 1)
    assert.deepEqual(s.paczki()[0], [zdarzenie(1), zdarzenie(2), zdarzenie(3)])
  })

  it('zamknij() z więcej niż 10 zdarzeniami dzieli na paczki po ≤10, zachowując kolejność', () => {
    const s = srodowisko()
    const wejscie = Array.from({ length: 23 }, (_, i) => zdarzenie(i))
    s.kolejka.zamknij(wejscie)
    const paczki = s.paczki()
    assert.deepEqual(
      paczki.map((p) => p.length),
      [10, 10, 3],
    )
    assert.deepEqual(paczki.flat(), wejscie)
  })

  it('karta ukryta: zdarzenie wychodzi od razu, bez czekania na zegar', () => {
    const s = srodowisko({ ukryta: true })
    s.kolejka.dodaj(zdarzenie(1))
    assert.equal(s.paczki().length, 1)
    assert.equal(s.zegar.oczekujace(), 0)
  })

  it('natychmiast: wychodzi od razu razem z tym, co czekało', () => {
    const s = srodowisko()
    s.kolejka.dodaj(zdarzenie(1))
    s.kolejka.dodaj(zdarzenie(2), { natychmiast: true })
    assert.deepEqual(s.paczki()[0], [zdarzenie(1), zdarzenie(2)])
  })
})

describe('kolejka: sprzeciw (pomiar wyłączony)', () => {
  it('wyłączony pomiar: nic nie wychodzi, ani przez zegar, ani przez zamknij', () => {
    const s = srodowisko({ wylaczony: true })
    s.kolejka.dodaj(zdarzenie(1))
    s.kolejka.dodaj(zdarzenie(2), { natychmiast: true })
    s.kolejka.zamknij([zdarzenie(3)])
    s.zegar.uplyw(BEZCZYNNOSC_MS * 3)
    assert.equal(s.wyslane.length, 0)
    assert.equal(s.kolejka.rozmiar(), 0)
  })

  it('wyłączenie po dodaniu, przed wysyłką: bufor czyszczony, nic nie wychodzi', () => {
    const s = srodowisko()
    s.kolejka.dodaj(zdarzenie(1))
    s.kolejka.dodaj(zdarzenie(2))
    s.stan.wylaczony = true
    s.zegar.uplyw(BEZCZYNNOSC_MS)
    assert.equal(s.wyslane.length, 0)
    assert.equal(s.kolejka.rozmiar(), 0)
  })

  it('wyłączenie czyści bufor także przy kolejnym dodaniu i zamknięciu', () => {
    const s = srodowisko()
    s.kolejka.dodaj(zdarzenie(1))
    s.stan.wylaczony = true
    s.kolejka.dodaj(zdarzenie(2))
    assert.equal(s.kolejka.rozmiar(), 0)
    assert.equal(s.zegar.oczekujace(), 0)
    s.stan.wylaczony = false
    s.kolejka.zamknij()
    assert.equal(s.wyslane.length, 0, 'to, co czekało przed wyłączeniem, przepadło')
  })

  it('po ponownym włączeniu kolejka znów wysyła', () => {
    const s = srodowisko({ wylaczony: true })
    s.kolejka.dodaj(zdarzenie(1))
    s.stan.wylaczony = false
    s.kolejka.dodaj(zdarzenie(2))
    s.kolejka.zamknij()
    assert.deepEqual(s.paczki()[0], [zdarzenie(2)])
  })
})

describe('kolejka: ciało żądania', () => {
  it('kształt {"z":[…]}, poprawny JSON', () => {
    const s = srodowisko()
    s.kolejka.zamknij([zdarzenie(1)])
    const obiekt = JSON.parse(s.wyslane[0] ?? '') as Record<string, unknown>
    assert.deepEqual(Object.keys(obiekt), ['z'])
    assert.ok(Array.isArray(obiekt.z))
  })

  it('duże zdarzenia dzielą się tak, by każde ciało mieściło się w limicie bajtów', () => {
    const duze = Array.from({ length: 10 }, (_, i) => zdarzenie(i, { s: `/${'a'.repeat(5000)}` }))
    const ciala = podzielNaCiala(duze)
    assert.ok(ciala.length > 1)
    for (const c of ciala) assert.ok(new TextEncoder().encode(c).length <= LIMIT_CIALA)
    const odtworzone = ciala.flatMap((c) => (JSON.parse(c) as Paczka).z)
    assert.deepEqual(odtworzone, duze, 'żadne zdarzenie nie zginęło i kolejność jest ta sama')
  })

  it('limit liczony w bajtach UTF-8, nie w znakach', () => {
    // 9000 × „ł” = 9000 znaków, ale 18 000 bajtów > 16 384.
    const polskie = zdarzenie(1, { s: `/${'ł'.repeat(9000)}` })
    assert.equal(podzielNaCiala([polskie]).length, 0)
    const ktoreMiesciSie = zdarzenie(2, { s: `/${'ł'.repeat(7000)}` })
    assert.equal(podzielNaCiala([ktoreMiesciSie]).length, 1)
  })

  it('pojedyncze zdarzenie ponad limit jest odrzucane, reszta paczki wychodzi', () => {
    const s = srodowisko()
    s.kolejka.zamknij([zdarzenie(1), zdarzenie(2, { s: `/${'x'.repeat(20_000)}` }), zdarzenie(3)])
    assert.deepEqual(s.paczki().flat(), [zdarzenie(1), zdarzenie(3)])
  })
})

describe('kolejka: odporność', () => {
  it('wyjątek transportu jest tłumiony i nie psuje kolejnych wysyłek', () => {
    const s = srodowisko({ rzuca: true })
    assert.doesNotThrow(() => {
      s.kolejka.dodaj(zdarzenie(1), { natychmiast: true })
      s.kolejka.zamknij([zdarzenie(2)])
    })
    assert.equal(s.kolejka.rozmiar(), 0, 'bez ponawiania: nieudana paczka przepada')
  })

  it('bezpiecznik na kartę: nadmiar zdarzeń jest ignorowany', () => {
    const wyslane: string[] = []
    const kolejka = utworzKolejke({
      wyslij: (c) => void wyslane.push(c),
      wylaczony: () => false,
      zegar: atrapaZegara().zegar,
      limitNaKarte: 25,
    })
    for (let i = 0; i < 100; i++) kolejka.dodaj(zdarzenie(i))
    kolejka.zamknij()
    const wszystkie = wyslane.flatMap((c) => (JSON.parse(c) as Paczka).z)
    assert.equal(wszystkie.length, 25)
  })
})
