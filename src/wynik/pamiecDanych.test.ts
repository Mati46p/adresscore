// Pamięć danych per miasto (#223, faza F2): jedno ładowanie na miasto, najwyżej dwa miasta w pamięci,
// podpięcie słownika adresów w stanie dla bieżącego miasta, odporność na zmianę miasta w trakcie
// ładowania i ponowienie po błędzie. Ładowanie jest sterowane z testu (zamiast sieci), a stan to
// prawdziwy `stan.ts` w świeżej instancji.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { SlugMiasta } from '../kontrakty/miasta.ts'
import { type Dane, MAKS_MIAST_W_PAMIECI, utworzPamiecDanych } from './pamiecDanych.ts'

type Stan = typeof import('./stan.ts')

let numerInstancji = 0
async function swiezyStan(): Promise<Stan> {
  return (await import(`./stan.ts?pamiec=${++numerInstancji}`)) as Stan
}

/** Dane miasta w pigułce: dwa adresy o id `<slug>-0`, `<slug>-1` i jedna warstwa. */
function daneTestowe(slug: SlugMiasta): Dane {
  const ids = [`${slug}-0`, `${slug}-1`]
  return {
    miasto: slug,
    plikAdresow: { wersja: slug, zrodla: [], kolumny: { id: ids } },
    adresy: ids.map((id, i) => ({ i, id })),
    manifest: { wygenerowano: '', wskazniki: [] },
    wskazniki: [{ meta: { id: 'halas_ldwn', kategoria: 'spokoj' } }],
    pominiete: [],
    grupyHeksow: new Map(),
    okolice: null,
  } as unknown as Dane
}

/** Ładowanie, które kończy test: kolejka oczekujących wywołań na miasto. */
function sterowaneLadowanie() {
  const wywolania: SlugMiasta[] = []
  const oczekujace = new Map<SlugMiasta, { ok: (d: Dane) => void; blad: (e: Error) => void }[]>()
  const wczytaj = (slug: SlugMiasta) => {
    wywolania.push(slug)
    return new Promise<Dane>((ok, blad) => {
      oczekujace.set(slug, [...(oczekujace.get(slug) ?? []), { ok, blad }])
    })
  }
  const nastepne = (slug: SlugMiasta) => {
    const zadanie = oczekujace.get(slug)?.shift()
    assert.ok(zadanie, `ładowanie ${slug} nie czeka`)
    return zadanie
  }
  return {
    wczytaj,
    wywolania,
    dokoncz: (slug: SlugMiasta) => nastepne(slug).ok(daneTestowe(slug)),
    zawal: (slug: SlugMiasta, powod: string) => nastepne(slug).blad(new Error(powod)),
    razy: (slug: SlugMiasta) => wywolania.filter((s) => s === slug).length,
  }
}

async function start() {
  const s = await swiezyStan()
  const ladowanie = sterowaneLadowanie()
  const pamiec = utworzPamiecDanych(ladowanie.wczytaj, s)
  return { s, ladowanie, pamiec }
}

/**
 * Miasto wczytane i bieżące, jak po wejściu na stronę: komponent z `useDane()` subskrybuje (to
 * uruchamia ładowanie i obserwację zmiany miasta w stanie), potem dane przychodzą.
 */
async function krakowGotowy() {
  const t = await start()
  t.pamiec.subskrybuj(() => {})
  t.ladowanie.dokoncz('krakow')
  await t.pamiec.zaladujDane()
  return t
}

// Limit na test: gdy logika się zepsuje, ładowanie, na które czeka test, nie przyjdzie nigdy – test ma
// wtedy zawieść, a nie wisieć.
describe('pamięć danych per miasto', { timeout: 5000 }, () => {
  it('ładuje bieżące miasto raz, podpina jego słownik w stanie i oddaje dane', async () => {
    const { s, ladowanie, pamiec } = await start()
    assert.equal(pamiec.stanBiezacego().stan, 'ladowanie')
    const pierwsza = pamiec.zaladujDane()
    assert.equal(pamiec.zaladujDane(), pierwsza, 'to samo ładowanie dla każdego pytającego')
    assert.deepEqual(ladowanie.wywolania, ['krakow'])
    assert.equal(s.indeksAdresu('krakow-1'), null, 'przed wczytaniem słownika nie ma')

    ladowanie.dokoncz('krakow')
    await pierwsza
    const stan = pamiec.stanBiezacego()
    assert.equal(stan.stan, 'gotowe')
    assert.equal(pamiec.daneJesliGotowe()?.miasto, 'krakow')
    assert.equal(s.indeksAdresu('krakow-1'), 1, 'słownik podpięty przed ogłoszeniem danych')
  })

  it('zmiana miasta: do czasu wczytania `ladowanie`, potem dane nowego miasta i jego słownik', async () => {
    const { s, ladowanie, pamiec } = await krakowGotowy()
    s.ustawMiasto('lodz')
    assert.equal(pamiec.stanBiezacego().stan, 'ladowanie')
    assert.equal(pamiec.daneJesliGotowe(), null)
    assert.equal(ladowanie.razy('lodz'), 1, 'zmiana miasta w stanie uruchamia ładowanie')

    ladowanie.dokoncz('lodz')
    await pamiec.zaladujDane('lodz')
    assert.equal(pamiec.daneJesliGotowe()?.miasto, 'lodz')
    assert.equal(s.indeksAdresu('lodz-1'), 1)
    assert.equal(s.indeksAdresu('krakow-1'), null, 'słownik Krakowa zastąpiony')
  })

  it('powrót do miasta z pamięci: bez ponownego ładowania, słownik podpięty od razu', async () => {
    const { s, ladowanie, pamiec } = await krakowGotowy()
    s.ustawMiasto('lodz')
    ladowanie.dokoncz('lodz')
    await pamiec.zaladujDane('lodz')

    s.ustawMiasto('krakow')
    assert.equal(ladowanie.razy('krakow'), 1)
    assert.equal(pamiec.daneJesliGotowe()?.miasto, 'krakow', 'dane od razu, bez `ladowanie`')
    assert.equal(s.indeksAdresu('krakow-1'), 1, 'słownik wrócił w tej samej chwili co miasto')
    assert.equal(s.indeksAdresu('lodz-1'), null)
  })

  it('trzymamy najwyżej dwa miasta: trzecie wypiera to, którego nie używano najdłużej', async () => {
    assert.equal(MAKS_MIAST_W_PAMIECI, 2)
    const { s, ladowanie, pamiec } = await krakowGotowy()
    for (const slug of ['lodz', 'gdansk'] as const) {
      s.ustawMiasto(slug)
      ladowanie.dokoncz(slug)
      await pamiec.zaladujDane(slug)
    }
    // W pamięci: Łódź i Gdańsk. Kraków wypadł, więc powrót ładuje go od nowa.
    s.ustawMiasto('lodz')
    assert.equal(ladowanie.razy('lodz'), 1, 'poprzednie miasto zostało w pamięci')
    assert.equal(pamiec.daneJesliGotowe()?.miasto, 'lodz')
    s.ustawMiasto('krakow')
    assert.equal(ladowanie.razy('krakow'), 2, 'najdawniejsze miasto wypadło')
    assert.equal(pamiec.stanBiezacego().stan, 'ladowanie')
    ladowanie.dokoncz('krakow')
    await pamiec.zaladujDane('krakow')
    assert.equal(s.indeksAdresu('krakow-0'), 0)
  })

  it('bieżące miasto nigdy nie wypada z pamięci, nawet gdy jest najstarsze w kolejce', async () => {
    const { s, ladowanie, pamiec } = await krakowGotowy()
    s.ustawMiasto('lodz')
    ladowanie.dokoncz('lodz')
    await pamiec.zaladujDane('lodz')
    // Kraków (dawniej używany) jest teraz najstarszy; wybór Krakowa przesuwa go na koniec kolejki.
    s.ustawMiasto('krakow')
    s.ustawMiasto('gdansk')
    ladowanie.dokoncz('gdansk')
    await pamiec.zaladujDane('gdansk')
    s.ustawMiasto('krakow')
    assert.equal(ladowanie.razy('krakow'), 1, 'Kraków był używany później niż Łódź: został')
    assert.equal(pamiec.daneJesliGotowe()?.miasto, 'krakow')
  })

  it('miasto przełączone w trakcie ładowania nie podpina słownika; podepnie go powrót do niego', async () => {
    const { s, ladowanie, pamiec } = await krakowGotowy()
    s.ustawMiasto('lodz')
    const lodz = pamiec.zaladujDane('lodz')
    s.ustawMiasto('gdansk')
    ladowanie.dokoncz('lodz')
    await lodz
    assert.equal(s.indeksAdresu('lodz-0'), null, 'Łódź nie jest już bieżąca: bez słownika')
    assert.equal(s.indeksAdresu('krakow-0'), 0, 'stary słownik czeka na dane Gdańska')

    ladowanie.dokoncz('gdansk')
    await pamiec.zaladujDane('gdansk')
    assert.equal(s.indeksAdresu('gdansk-1'), 1)

    // Łódź jest w pamięci (wczytała się w tle): powrót podpina ją bez ładowania.
    s.ustawMiasto('lodz')
    assert.equal(ladowanie.razy('lodz'), 1)
    assert.equal(s.indeksAdresu('lodz-1'), 1)
  })

  it('ładowanie wypartego wpisu nie podpina słownika: miasto, do którego wrócono, ładuje się od nowa', async () => {
    const { s, ladowanie, pamiec } = await krakowGotowy()
    s.ustawMiasto('lodz') // w pamięci: Kraków, Łódź (ładuje się)
    const stare = pamiec.zaladujDane('lodz')
    s.ustawMiasto('gdansk') // Kraków wypada
    s.ustawMiasto('krakow') // wypada Łódź – wciąż w trakcie ładowania
    s.ustawMiasto('lodz') // Łódź od nowa, wypada Gdańsk
    assert.equal(
      ladowanie.razy('lodz'),
      2,
      'wpis wyparty w trakcie ładowania nie jest już czekającym',
    )

    ladowanie.dokoncz('lodz') // wynik PIERWSZEGO ładowania, którego wpis już nie istnieje
    await stare
    assert.equal(s.indeksAdresu('lodz-0'), null, 'wynik wypartego wpisu nie podpina słownika')
    assert.equal(
      pamiec.stanBiezacego().stan,
      'ladowanie',
      'bieżące miasto czeka na własne ładowanie',
    )

    ladowanie.dokoncz('lodz')
    await pamiec.zaladujDane('lodz')
    assert.equal(pamiec.daneJesliGotowe()?.miasto, 'lodz')
    assert.equal(s.indeksAdresu('lodz-1'), 1)
  })

  it('błąd ładowania: komunikat dla tego miasta, a ponowny wybór miasta ładuje je od nowa', async () => {
    const { s, ladowanie, pamiec } = await krakowGotowy()
    s.ustawMiasto('lodz')
    const proba = pamiec.zaladujDane('lodz')
    ladowanie.zawal('lodz', 'brak sieci')
    await proba
    const blad = pamiec.stanBiezacego()
    assert.equal(blad.stan === 'blad' && blad.blad, 'brak sieci')

    s.ustawMiasto('krakow')
    assert.equal(pamiec.daneJesliGotowe()?.miasto, 'krakow', 'inne miasto działa mimo błędu')
    s.ustawMiasto('lodz')
    assert.equal(ladowanie.razy('lodz'), 2, 'powrót do miasta z błędem próbuje ponownie')
    ladowanie.dokoncz('lodz')
    await pamiec.zaladujDane('lodz')
    assert.equal(pamiec.daneJesliGotowe()?.miasto, 'lodz')
  })

  it('błąd przy podpinaniu słownika kończy się komunikatem, a nie wiecznym ładowaniem', async () => {
    const s = await swiezyStan()
    const ladowanie = sterowaneLadowanie()
    const zepsuty = {
      pobierzStan: s.pobierzStan,
      subskrybuj: s.subskrybuj,
      podlaczDane: () => {
        throw new Error('słownik odrzucony')
      },
    }
    const pamiec = utworzPamiecDanych(ladowanie.wczytaj, zepsuty)
    const obietnica = pamiec.zaladujDane()
    ladowanie.dokoncz('krakow')
    await obietnica
    const stan = pamiec.stanBiezacego()
    assert.equal(stan.stan === 'blad' && stan.blad, 'słownik odrzucony')
  })

  it('komponenty dostają powiadomienie o zmianie miasta i o wczytaniu danych', async () => {
    const { s, ladowanie, pamiec } = await krakowGotowy()
    let powiadomien = 0
    const wypisz = pamiec.subskrybuj(() => {
      powiadomien++
    })
    const przed = powiadomien
    s.ustawMiasto('lodz')
    assert.ok(powiadomien > przed, 'zmiana miasta odświeża komponenty (nowy stan: ładowanie)')
    const poZmianie = powiadomien
    ladowanie.dokoncz('lodz')
    await pamiec.zaladujDane('lodz')
    assert.ok(powiadomien > poZmianie, 'wczytanie danych odświeża komponenty')
    // Odczyt stanu jest czysty: ta sama tożsamość między powiadomieniami (wymóg useSyncExternalStore).
    assert.equal(pamiec.stanBiezacego(), pamiec.stanBiezacego())

    wypisz()
    const poWypisaniu = powiadomien
    s.ustawMiasto('krakow')
    assert.equal(powiadomien, poWypisaniu, 'wypisany komponent nie dostaje powiadomień')
  })

  it('subskrypcja uruchamia ładowanie bieżącego miasta (pierwszy komponent z useDane)', async () => {
    const { ladowanie, pamiec } = await start()
    pamiec.subskrybuj(() => {})
    assert.deepEqual(ladowanie.wywolania, ['krakow'])
  })

  it('miasto z linku jest ładowane jako pierwsze: bieżące miasto to stan, nie Kraków z góry', async () => {
    const s = await swiezyStan()
    s.wczytajLinkStartowy({
      ekran: 'szukaj',
      idAdresu: null,
      persona: null,
      tryb: null,
      porownanie: [],
      ustawienia: null,
      filtry: [],
      miasto: 'gdansk',
    })
    const ladowanie = sterowaneLadowanie()
    const pamiec = utworzPamiecDanych(ladowanie.wczytaj, s)
    void pamiec.zaladujDane()
    assert.deepEqual(ladowanie.wywolania, ['gdansk'])
  })
})
