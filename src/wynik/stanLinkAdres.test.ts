// Link a słownik adresów (#108): to, co potrzebuje słownika (id adresu, lista porównania), czeka na
// wczytanie adresów i dopiero wtedy trafia do stanu. Osobny plik od `stanLinkStartowy.test.ts`:
// stan aplikacji to moduł z jednym obiektem, a każdy plik testowy dostaje własny proces.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { pobierzStan, podlaczDane, wczytajLinkStartowy } from './stan.ts'
import { czytajHash } from './url.ts'

const WSKAZNIKI = [{ id: 'halas_ldwn', kategoria: 'spokoj' as const }]
const IDS = ['id-a', 'id-b', 'id-c']

test('link do karty adresu: ekran od razu, adres i porównanie po wczytaniu słownika', () => {
  wczytajLinkStartowy(czytajHash('#/adres/id-b?cmp=id-a,id-c,nie-ma'))
  assert.equal(pobierzStan().ekran, 'okolica')
  // Przed adresami nie ma słownika, więc nie ma też wybranego adresu ani porównania.
  assert.equal(pobierzStan().wybrany, null)
  assert.deepEqual(pobierzStan().porownanie, [])
  podlaczDane(IDS, WSKAZNIKI, [])
  const s = pobierzStan()
  assert.equal(s.ekran, 'okolica')
  assert.equal(s.wybrany, 1)
  // Id spoza słownika odpada, reszta listy zostaje.
  assert.deepEqual(s.porownanie, [0, 2])
})
