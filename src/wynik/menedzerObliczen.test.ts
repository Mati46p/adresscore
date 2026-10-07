// Menedżer wspólnego workera obliczeń (#108): jedna instancja na oba tryby, nigdy dwie naraz,
// zwalnianie nieużywanego i obsługa błędu workera. Worker podstawiamy atrapą.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { type PortWorkera, utworzMenedzera } from './menedzerObliczen.ts'
import type { DoWorkera, ZWorkera } from './obliczenia.ts'

class AtrapaPortu implements PortWorkera {
  wyslane: DoWorkera[] = []
  zakonczony = false
  onmessage: PortWorkera['onmessage'] = null
  onerror: PortWorkera['onerror'] = null
  postMessage(w: DoWorkera) {
    this.wyslane.push(w)
  }
  terminate() {
    this.zakonczony = true
  }
  /** Odpowiedź workera dla ekranu. */
  odpowiedz(o: ZWorkera) {
    this.onmessage?.({ data: o })
  }
  /** Zdarzenie `error` workera (nie załadował się, wyjątek poza obsługą). */
  blad(message = 'boom') {
    this.onerror?.({ message })
  }
}

/** Menedżer z licznikiem: ile portów powstało i ile żyje w danej chwili. */
function menedzer() {
  const porty: AtrapaPortu[] = []
  const m = utworzMenedzera(() => {
    const p = new AtrapaPortu()
    porty.push(p)
    return p
  })
  const zywe = () => porty.filter((p) => !p.zakonczony).length
  return { m, porty, zywe }
}

describe('jedna instancja na oba tryby', () => {
  it('oba tryby dostają ten sam worker, a wiadomości niosą pole tryb', () => {
    const { m, porty, zywe } = menedzer()
    const miasto = m.otworz('miasto')
    const biznes = m.otworz('biznes')
    assert.ok(miasto && biznes)
    assert.equal(porty.length, 1)
    assert.equal(zywe(), 1)
    assert.deepEqual(m.stan(), { zywy: true, uchwyty: { miasto: 1, biznes: 1 } })
    assert.equal(biznes.wyslij({ typ: 'start', baza: '/dane' }), true)
    assert.equal(miasto.wyslij({ typ: 'licz', id: 7, warianty: [[]] }), true)
    assert.deepEqual(porty[0]?.wyslane, [
      { tryb: 'biznes', typ: 'start', baza: '/dane' },
      { tryb: 'miasto', typ: 'licz', id: 7, warianty: [[]] },
    ])
  })

  it('odpowiedź trafia tylko do ekranu swojego trybu', () => {
    const { m, porty } = menedzer()
    const miasto = m.otworz('miasto')
    const biznes = m.otworz('biznes')
    const doMiasta: unknown[] = []
    const doBiznesu: unknown[] = []
    miasto?.nasluchuj((o) => doMiasta.push(o))
    biznes?.nasluchuj((o) => doBiznesu.push(o))
    porty[0]?.odpowiedz({ tryb: 'miasto', typ: 'wynik', id: 1, wyniki: [], ms: 0 })
    porty[0]?.odpowiedz({ tryb: 'biznes', typ: 'blad', wersja: 1, blad: 'x' })
    assert.equal(doMiasta.length, 1)
    assert.equal(doBiznesu.length, 1)
    assert.equal((doMiasta[0] as { typ: string }).typ, 'wynik')
    assert.equal((doBiznesu[0] as { typ: string }).typ, 'blad')
  })

  it('zdjęty nasłuch i zwolniony uchwyt nie dostają już odpowiedzi', () => {
    const { m, porty } = menedzer()
    const miasto = m.otworz('miasto')
    const biznes = m.otworz('biznes') // trzyma worker, żeby odpowiedzi nadal szły
    const widziane: unknown[] = []
    const zdejmij = miasto?.nasluchuj((o) => widziane.push(o))
    porty[0]?.odpowiedz({ tryb: 'miasto', typ: 'wynik', id: 1, wyniki: [], ms: 0 })
    zdejmij?.()
    porty[0]?.odpowiedz({ tryb: 'miasto', typ: 'wynik', id: 2, wyniki: [], ms: 0 })
    assert.equal(widziane.length, 1)
    miasto?.nasluchuj((o) => widziane.push(o))
    miasto?.zwolnij()
    porty[0]?.odpowiedz({ tryb: 'miasto', typ: 'wynik', id: 3, wyniki: [], ms: 0 })
    assert.equal(widziane.length, 1)
    biznes?.zwolnij()
  })
})

describe('nigdy dwóch naraz, nieużywany jest zwalniany', () => {
  it('zwolnienie jednego trybu oddaje jego stan, a worker żyje dla drugiego', () => {
    const { m, porty, zywe } = menedzer()
    const miasto = m.otworz('miasto')
    const biznes = m.otworz('biznes')
    biznes?.zwolnij()
    assert.equal(zywe(), 1)
    assert.deepEqual(porty[0]?.wyslane.at(-1), { tryb: 'biznes', typ: 'zwolnij' })
    assert.deepEqual(m.stan(), { zywy: true, uchwyty: { miasto: 1, biznes: 0 } })
    // Miasto dalej działa na tej samej instancji.
    assert.equal(miasto?.wyslij({ typ: 'licz', id: 1, warianty: [[]] }), true)
    miasto?.zwolnij()
  })

  it('zwolnienie ostatniego uchwytu zamyka worker (bez wiadomości zwolnij – i tak ginie z workerem)', () => {
    const { m, porty, zywe } = menedzer()
    const miasto = m.otworz('miasto')
    miasto?.zwolnij()
    assert.equal(zywe(), 0)
    assert.equal(porty[0]?.zakonczony, true)
    assert.deepEqual(porty[0]?.wyslane, [])
    assert.deepEqual(m.stan(), { zywy: false, uchwyty: { miasto: 0, biznes: 0 } })
  })

  it('wielokrotne przełączanie Miasto ↔ Biznes: w każdej chwili najwyżej jeden worker', () => {
    const { m, porty, zywe } = menedzer()
    let najwiecej = 0
    for (let i = 0; i < 6; i++) {
      const miasto = m.otworz('miasto')
      najwiecej = Math.max(najwiecej, zywe())
      miasto?.zwolnij()
      const biznes = m.otworz('biznes')
      najwiecej = Math.max(najwiecej, zywe())
      biznes?.zwolnij()
      assert.equal(zywe(), 0, `po obrocie ${i}`)
    }
    assert.equal(najwiecej, 1)
    // Każde wejście na ekran po zwolnieniu wszystkiego to nowy worker; żaden nie wycieka.
    assert.equal(porty.length, 12)
    assert.ok(porty.every((p) => p.zakonczony))
  })

  it('nakładanie się ekranów (nowy zanim stary zwolniony) też nie tworzy drugiego workera', () => {
    const { m, porty, zywe } = menedzer()
    const miasto = m.otworz('miasto')
    const biznes = m.otworz('biznes') // nowy ekran mounduje się przed cleanupem starego
    miasto?.zwolnij()
    assert.equal(porty.length, 1)
    assert.equal(zywe(), 1)
    biznes?.zwolnij()
    assert.equal(zywe(), 0)
  })

  it('podwójne zwolnienie tego samego uchwytu nie psuje liczników', () => {
    const { m, zywe } = menedzer()
    const a = m.otworz('miasto')
    const b = m.otworz('miasto')
    a?.zwolnij()
    a?.zwolnij()
    assert.deepEqual(m.stan().uchwyty, { miasto: 1, biznes: 0 })
    assert.equal(zywe(), 1)
    b?.zwolnij()
    assert.equal(zywe(), 0)
  })

  it('zwolniony uchwyt nie wysyła wiadomości', () => {
    const { m, porty } = menedzer()
    const miasto = m.otworz('miasto')
    const biznes = m.otworz('biznes')
    miasto?.zwolnij()
    const przed = porty[0]?.wyslane.length ?? 0
    assert.equal(miasto?.wyslij({ typ: 'licz', id: 1, warianty: [] }), false)
    assert.equal(porty[0]?.wyslane.length, przed)
    biznes?.zwolnij()
  })
})

describe('worker, który nie działa', () => {
  it('konstruktor rzuca: otworz zwraca null (wołający liczy sam), a następne wejście próbuje jeszcze raz', () => {
    let proby = 0
    const m = utworzMenedzera(() => {
      proby++
      if (proby === 1) throw new Error('brak modułowych workerów')
      return new AtrapaPortu()
    })
    assert.equal(m.otworz('miasto'), null)
    assert.deepEqual(m.stan(), { zywy: false, uchwyty: { miasto: 0, biznes: 0 } })
    const drugi = m.otworz('miasto')
    assert.ok(drugi)
    drugi.zwolnij()
  })

  it('zdarzenie error zamyka worker i mówi o tym wszystkim uchwytom; po zwolnieniu można zacząć od nowa', () => {
    const { m, porty, zywe } = menedzer()
    const miasto = m.otworz('miasto')
    const biznes = m.otworz('biznes')
    const bledy: string[] = []
    miasto?.naBledzie((b) => bledy.push(`miasto: ${b}`))
    biznes?.naBledzie((b) => bledy.push(`biznes: ${b}`))
    porty[0]?.blad('nie załadował się')
    assert.deepEqual(bledy, ['miasto: nie załadował się', 'biznes: nie załadował się'])
    assert.equal(zywe(), 0)
    assert.equal(miasto?.wyslij({ typ: 'licz', id: 1, warianty: [] }), false)
    // Dopóki ktoś trzyma uchwyt po błędzie, nowy ekran nie dostaje worker-zombie.
    assert.equal(m.otworz('miasto'), null)
    miasto?.zwolnij()
    biznes?.zwolnij()
    const nowy = m.otworz('biznes')
    assert.ok(nowy, 'po zwolnieniu wszystkiego następne wejście próbuje od nowa')
    assert.equal(porty.length, 2)
    nowy.zwolnij()
    assert.equal(zywe(), 0)
  })

  it('błąd bez treści dostaje komunikat zastępczy', () => {
    const { m, porty } = menedzer()
    const u = m.otworz('biznes')
    const bledy: string[] = []
    u?.naBledzie((b) => bledy.push(b))
    porty[0]?.onerror?.({})
    assert.equal(bledy.length, 1)
    assert.ok((bledy[0] as string).length > 0)
    u?.zwolnij()
  })
})
