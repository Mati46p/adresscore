// Filtry konkurencji trybu „Biznes” w linku (#108): parametr `k`, round-trip i stare linki.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { FILTRY_FLAG } from './biznesBranze.ts'
import { filtryDoTekstuLinku, filtryZTekstuLinku, TOKEN_MIN_2_ZRODLA } from './biznesFiltryUrl.ts'
import { BEZ_FILTROW, type FiltryUslug } from './biznesUslugi.ts'
import { czytajHash, zapiszHash } from './url.ts'

const PUNKT_A = '19.940000,50.060000'

/** Wszystkie podzbiory definicji filtrów flagowych branży × włączony/wyłączony filtr źródeł. */
function wszystkieUstawienia(idBranzy: string): FiltryUslug[] {
  const defs = FILTRY_FLAG[idBranzy] ?? []
  const wynik: FiltryUslug[] = []
  for (const min2Zrodla of [false, true]) {
    for (let maska = 0; maska < 1 << defs.length; maska++) {
      const flagi: Record<string, 'tylko' | 'bez'> = {}
      defs.forEach((def, i) => {
        if (maska & (1 << i)) flagi[def.flaga] = def.tryb
      })
      wynik.push({ min2Zrodla, flagi })
    }
  }
  return wynik
}

describe('parametr k: zapis i odczyt', () => {
  it('każde ustawienie każdej branży z filtrami wraca bez zmian (round-trip)', () => {
    for (const idBranzy of [...Object.keys(FILTRY_FLAG), 'apteka']) {
      for (const filtry of wszystkieUstawienia(idBranzy)) {
        const tekst = filtryDoTekstuLinku(filtry, idBranzy)
        const wraca = filtryZTekstuLinku(tekst, idBranzy)
        assert.deepEqual(wraca, filtry, `${idBranzy}: „${tekst}”`)
        // Drugi obieg jest stały: ten sam stan = ten sam link.
        assert.equal(filtryDoTekstuLinku(wraca, idBranzy), tekst)
      }
    }
  })

  it('format jest krótki i czytelny: źródła, potem flagi w kolejności definicji', () => {
    const bezFastFoodu: FiltryUslug = { min2Zrodla: true, flagi: { fast_food: 'bez' } }
    assert.equal(filtryDoTekstuLinku(bezFastFoodu, 'restauracja'), '2z,-fast_food')
    assert.equal(
      filtryDoTekstuLinku({ min2Zrodla: false, flagi: { nfz: 'tylko' } }, 'dentysta'),
      'nfz',
    )
    assert.equal(filtryDoTekstuLinku({ min2Zrodla: true, flagi: {} }, 'apteka'), TOKEN_MIN_2_ZRODLA)
    assert.equal(filtryDoTekstuLinku(BEZ_FILTROW, 'fryzjer'), '')
  })

  it('link niesie tylko filtry widoczne dla branży linku', () => {
    // Flaga innej branży zostaje w stanie, ale nie wchodzi do linku, którego nikt nie wyłączy.
    const zZalegla: FiltryUslug = { min2Zrodla: false, flagi: { barber: 'tylko', nfz: 'tylko' } }
    assert.equal(filtryDoTekstuLinku(zZalegla, 'dentysta'), 'nfz')
    assert.equal(filtryDoTekstuLinku(zZalegla, 'apteka'), '')
  })

  it('token spoza definicji odpada: zła nazwa, zły tryb, flaga innej branży, śmieci', () => {
    assert.deepEqual(filtryZTekstuLinku('barber', 'apteka'), BEZ_FILTROW)
    assert.deepEqual(filtryZTekstuLinku('-barber', 'fryzjer'), BEZ_FILTROW)
    assert.deepEqual(filtryZTekstuLinku('fast_food', 'restauracja'), BEZ_FILTROW)
    assert.deepEqual(filtryZTekstuLinku('nieznana,-inna,,--,-,2Z,z2', 'dentysta'), BEZ_FILTROW)
    // Nazwy z prototypu obiektu nie są flagami.
    assert.deepEqual(
      filtryZTekstuLinku('constructor,__proto__,-toString', 'restauracja'),
      BEZ_FILTROW,
    )
    // Poprawny token obok śmieci działa.
    assert.deepEqual(filtryZTekstuLinku('x,nfz,y', 'dentysta'), {
      min2Zrodla: false,
      flagi: { nfz: 'tylko' },
    })
  })

  it('brak parametru, pusty i za długi dają filtry wyłączone (ta sama stała)', () => {
    assert.equal(filtryZTekstuLinku(null, 'fryzjer'), BEZ_FILTROW)
    assert.equal(filtryZTekstuLinku(undefined, 'fryzjer'), BEZ_FILTROW)
    assert.equal(filtryZTekstuLinku('', 'fryzjer'), BEZ_FILTROW)
    assert.equal(filtryZTekstuLinku(`2z,${'barber,'.repeat(40)}`, 'fryzjer'), BEZ_FILTROW)
  })

  it('powtórzony token nie mnoży filtrów', () => {
    assert.deepEqual(filtryZTekstuLinku('2z,2z,barber,barber', 'fryzjer'), {
      min2Zrodla: true,
      flagi: { barber: 'tylko' },
    })
  })
})

describe('filtry Biznesu w hashu', () => {
  it('link z filtrami przeżywa parsuj → serializuj → parsuj', () => {
    const hash = `#/biznes?b=restauracja&a=${PUNKT_A}&k=2z,-fast_food`
    const stan = czytajHash(hash)
    assert.deepEqual(stan.filtryBiznesu, { min2Zrodla: true, flagi: { fast_food: 'bez' } })
    const zapis = zapiszHash(stan)
    assert.ok(zapis.includes('k=2z,-fast_food'), zapis)
    assert.ok(zapis.includes('b=restauracja'), zapis)
    assert.deepEqual(czytajHash(zapis), stan)
  })

  it('każdy filtr z definicji wchodzi do linku i wraca z niego', () => {
    for (const [idBranzy, defs] of Object.entries(FILTRY_FLAG)) {
      for (const def of defs) {
        const stan = czytajHash(`#/biznes?b=${idBranzy}`)
        const z = {
          ...stan,
          filtryBiznesu: { min2Zrodla: false, flagi: { [def.flaga]: def.tryb } },
        }
        const zapis = zapiszHash(z)
        assert.ok(zapis.includes(`k=${def.tryb === 'bez' ? '-' : ''}${def.flaga}`), zapis)
        assert.deepEqual(czytajHash(zapis).filtryBiznesu, z.filtryBiznesu, idBranzy)
      }
    }
  })

  it('stary link bez parametru k otwiera się z filtrami wyłączonymi i ich nie dopisuje', () => {
    for (const hash of ['#/biznes', '#/biznes?b=apteka', `#/biznes?b=dentysta&a=${PUNKT_A}`]) {
      const stan = czytajHash(hash)
      assert.deepEqual(stan.filtryBiznesu, BEZ_FILTROW, hash)
      assert.ok(!/[?&]k=/.test(zapiszHash(stan)), hash)
    }
  })

  it('filtry przeżywają zmianę kolejności parametrów i kodowanie przecinka', () => {
    const a = czytajHash('#/biznes?k=2z%2C-fast_food&b=restauracja')
    const b = czytajHash('#/biznes?b=restauracja&k=2z,-fast_food')
    assert.deepEqual(a.filtryBiznesu, b.filtryBiznesu)
    assert.deepEqual(a.filtryBiznesu, { min2Zrodla: true, flagi: { fast_food: 'bez' } })
  })

  it('poza ekranem Biznes parametr k nic nie znaczy i nie jest zapisywany', () => {
    const szukaj = czytajHash('#/?k=2z,nfz&b=dentysta')
    assert.equal(szukaj.filtryBiznesu, undefined)
    const zBiznesu = czytajHash('#/biznes?b=dentysta&k=nfz')
    const zapis = zapiszHash({ ...zBiznesu, ekran: 'szukaj' })
    assert.ok(!/[?&]k=/.test(zapis), zapis)
    // Miasto ma własne `a=`/`b=`/`w=`, więc `k` też go nie dotyczy.
    assert.ok(!/[?&]k=/.test(zapiszHash({ ...zBiznesu, ekran: 'miasto' })))
  })

  it('zmiana branży w linku odrzuca filtry flagowe poprzedniej branży', () => {
    // Ten sam parametr k, inna branża: `nfz` jest filtrem dentysty, a nie fryzjera.
    assert.deepEqual(czytajHash('#/biznes?b=fryzjer&k=nfz').filtryBiznesu, BEZ_FILTROW)
    assert.deepEqual(czytajHash('#/biznes?b=dentysta&k=nfz').filtryBiznesu, {
      min2Zrodla: false,
      flagi: { nfz: 'tylko' },
    })
  })
})
