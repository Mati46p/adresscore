// Uruchom: node --test 'src/ai/pomiar/*.test.ts' – sprawdza zbiory wzorcowe #18, bez sieci.
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import type { PlikWskaznika } from '../../kontrakty/index.ts'
import { PERSONY } from '../../wynik/persony.ts'
import { KATEGORIE_OCENIANE, POTRZEBY } from '../opiszSiebie.ts'
import { listaWarstw } from '../zapytajOAdres.ts'

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
