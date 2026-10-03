// Uruchom: node --test 'src/ai/pomiar/*.test.ts' – sprawdza zbiory wzorcowe #18, bez sieci.
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import type { PlikWskaznika } from '../../kontrakty/index.ts'
import { PERSONY } from '../../wynik/persony.ts'
import { KATEGORIE_OCENIANE, POTRZEBY } from '../opiszSiebie.ts'
import { listaWarstw, NIE_WIEM } from '../zapytajOAdres.ts'

const URL_ZBIOROW = new URL('./', import.meta.url)
const czytaj = (plik: string) => JSON.parse(readFileSync(new URL(plik, URL_ZBIOROW), 'utf8'))

interface PozycjaOpisz {
  id: string
  tekst: string
  persona: string | null
  persona_tez?: string[]
  nic?: boolean
  potrzeby: string[]
  kategorie_wazne?: string[]
  kategorie_niewazne?: string[]
}
interface PozycjaZapytaj {
  id: string
  pytanie: string
  tematy: string[][]
}

const opisz: PozycjaOpisz[] = czytaj('zbior-opisz.json').pozycje
const zapytaj: PozycjaZapytaj[] = czytaj('zbior-zapytaj.json').pozycje

const bezPowtorzen = (xs: readonly string[], co: string) =>
  assert.equal(new Set(xs).size, xs.length, `powtórzenie: ${co}`)

describe('zbiór wzorcowy „opisz siebie”', () => {
  const potrzeby = new Set(POTRZEBY.map((p) => p.id))
  const persony = new Set(PERSONY.map((p) => p.id as string))
  const kategorie = new Set<string>(KATEGORIE_OCENIANE)

  it('30–50 pozycji, unikalne id i teksty', () => {
    assert.ok(opisz.length >= 30 && opisz.length <= 50)
    bezPowtorzen(
      opisz.map((p) => p.id),
      'id',
    )
    bezPowtorzen(
      opisz.map((p) => p.tekst),
      'tekst',
    )
  })

  it('id potrzeb, profili i kategorii istnieją, bez powtórzeń', () => {
    for (const p of opisz) {
      for (const id of p.potrzeby) assert.ok(potrzeby.has(id), `${p.id}: nieznana potrzeba ${id}`)
      bezPowtorzen(p.potrzeby, `${p.id} potrzeby`)
      for (const id of [p.persona, ...(p.persona_tez ?? [])])
        if (id !== null) assert.ok(persony.has(id), `${p.id}: nieznany profil ${id}`)
      for (const k of [...(p.kategorie_wazne ?? []), ...(p.kategorie_niewazne ?? [])])
        assert.ok(kategorie.has(k), `${p.id}: nieznana kategoria ${k}`)
    }
  })

  it('„nic” = bez profilu i bez potrzeb', () => {
    for (const p of opisz.filter((x) => x.nic)) {
      assert.equal(p.persona, null, p.id)
      assert.deepEqual(p.potrzeby, [], p.id)
    }
  })
})

describe('zbiór wzorcowy „zapytaj o adres”', () => {
  const katalog = 'public/dane/wskazniki'
  const metas = readdirSync(katalog)
    .filter((f) => f.endsWith('.json'))
    .map((f) => (JSON.parse(readFileSync(`${katalog}/${f}`, 'utf8')) as PlikWskaznika).meta)
  const warstwy = new Set(listaWarstw(metas).map((p) => p.id))

  it('unikalne id i pytania', () => {
    bezPowtorzen(
      zapytaj.map((p) => p.id),
      'id',
    )
    bezPowtorzen(
      zapytaj.map((p) => p.pytanie),
      'pytanie',
    )
  })

  it('każda warstwa jest na liście dla JEV, tematy niepuste i bez powtórzeń', () => {
    for (const p of zapytaj) {
      for (const t of p.tematy) {
        assert.ok(t.length > 0, `${p.id}: pusty temat`)
        bezPowtorzen(t, `${p.id} temat`)
        for (const id of t) assert.ok(warstwy.has(id), `${p.id}: warstwy ${id} nie ma na liście`)
      }
    }
  })
})

// Zbiory kontrolne: nr 1 (#147), nr 2 (#152), nr 3 (#153) i nr 4 (#157), napisane na ślepo przez osobnego agenta,
// bez dostępu do kodu. Etykiet nie poprawiamy – test pilnuje tylko, że id są znane, a pomiar
// je zrozumie, i że teksty nie powtarzają się między zbiorami.
const katalogWskaznikow = 'public/dane/wskazniki'
const warstwyJev = () =>
  new Set(
    listaWarstw(
      readdirSync(katalogWskaznikow)
        .filter((f) => f.endsWith('.json'))
        .map(
          (f) =>
            (JSON.parse(readFileSync(`${katalogWskaznikow}/${f}`, 'utf8')) as PlikWskaznika).meta,
        ),
    ).map((p) => p.id),
  )

// #157: zbiór nr 4 jest większy (40 opisów, 35 pytań) – liczność sprawdzamy dla każdego zbioru.
const ZBIORY_KONTROLNE = [
  {
    nazwa: 'kontrolny',
    opisz: 'kontrolny-opisz.json',
    zapytaj: 'kontrolny-zapytaj.json',
    nA: 30,
    nB: 25,
  },
  {
    nazwa: 'kontrolny nr 2',
    opisz: 'kontrolny2-opisz.json',
    zapytaj: 'kontrolny2-zapytaj.json',
    nA: 30,
    nB: 25,
  },
  {
    nazwa: 'kontrolny nr 3',
    opisz: 'kontrolny3-opisz.json',
    zapytaj: 'kontrolny3-zapytaj.json',
    nA: 30,
    nB: 25,
  },
  {
    nazwa: 'kontrolny nr 4',
    opisz: 'kontrolny4-opisz.json',
    zapytaj: 'kontrolny4-zapytaj.json',
    nA: 40,
    nB: 35,
  },
] as const
const kontrolne = ZBIORY_KONTROLNE.map((z) => ({
  nazwa: z.nazwa,
  nA: z.nA,
  nB: z.nB,
  opisz: czytaj(z.opisz).pozycje as PozycjaOpisz[],
  zapytaj: czytaj(z.zapytaj).pozycje as PozycjaZapytaj[],
}))
const wszystkieOpisy = [...opisz, ...kontrolne.flatMap((k) => k.opisz)]
/**
 * #153: pytanie K3-B05 (17 znaków) jest dosłownie takie samo jak K2-B09 – autor zbioru nr 3
 * pisał na ślepo, bez dostępu do zbioru nr 2, i trafił na to samo krótkie pytanie. Etykiet ani
 * tekstów zbioru nie zmieniamy, więc ta jedna pozycja jest zwolniona z wymogu „inne niż
 * w pozostałych zbiorach” (w swoim zbiorze nadal musi być unikalna).
 * #157: tak samo K4-B25 (50 znaków) – dosłownie to samo pytanie co K3-B21. Zbiór nr 4 wszedł
 * bajt w bajt, więc i tej pozycji nie zmieniamy; w WYNIKI.md jest zaznaczona jako powtórka.
 */
const ZNANE_POWTORZENIA = new Set(['K3-B05', 'K4-B25'])
const wszystkiePytania = [...zapytaj, ...kontrolne.flatMap((k) => k.zapytaj)].filter(
  (p) => !ZNANE_POWTORZENIA.has(p.id),
)

for (const k of kontrolne) {
  describe(`zbiór ${k.nazwa} „opisz siebie” (na ślepo)`, () => {
    const potrzeby = new Set(POTRZEBY.map((p) => p.id))
    const persony = new Set(PERSONY.map((p) => p.id as string))

    it(`${k.nA} pozycji, unikalne id i teksty, inne niż w pozostałych zbiorach`, () => {
      assert.equal(k.opisz.length, k.nA)
      bezPowtorzen(
        k.opisz.map((p) => p.id),
        'id',
      )
      bezPowtorzen(
        wszystkieOpisy.map((p) => p.tekst),
        'tekst (także względem pozostałych zbiorów)',
      )
    })

    it('id potrzeb i profili istnieją, bez powtórzeń', () => {
      for (const p of k.opisz) {
        for (const id of p.potrzeby) assert.ok(potrzeby.has(id), `${p.id}: nieznana potrzeba ${id}`)
        bezPowtorzen(p.potrzeby, `${p.id} potrzeby`)
        if (p.persona !== null)
          assert.ok(persony.has(p.persona), `${p.id}: nieznany profil ${p.persona}`)
      }
    })
  })

  describe(`zbiór ${k.nazwa} „zapytaj o adres” (na ślepo)`, () => {
    const warstwy = warstwyJev()

    it(`${k.nB} pozycji, unikalne id i pytania, inne niż w pozostałych zbiorach`, () => {
      assert.equal(k.zapytaj.length, k.nB)
      bezPowtorzen(
        k.zapytaj.map((p) => p.id),
        'id',
      )
      bezPowtorzen(
        k.zapytaj.map((p) => p.pytanie),
        'pytanie (w tym zbiorze)',
      )
      bezPowtorzen(
        wszystkiePytania.map((p) => p.pytanie),
        'pytanie (także względem pozostałych zbiorów)',
      )
    })

    it('każda warstwa jest na liście dla JEV; „spoza zakresu” to jedyna grupa [nie_wiem]', () => {
      for (const p of k.zapytaj) {
        assert.ok(p.tematy.length > 0, `${p.id}: brak tematów`)
        const spoza = p.tematy.some((t) => t.includes(NIE_WIEM))
        if (spoza) assert.deepEqual(p.tematy, [[NIE_WIEM]], `${p.id}: nie_wiem tylko samodzielnie`)
        for (const t of spoza ? [] : p.tematy) {
          assert.ok(t.length > 0, `${p.id}: pusty temat`)
          bezPowtorzen(t, `${p.id} temat`)
          for (const id of t) assert.ok(warstwy.has(id), `${p.id}: warstwy ${id} nie ma na liście`)
        }
      }
    })
  })
}
