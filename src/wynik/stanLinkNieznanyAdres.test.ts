// Link do adresu, którego nie ma w danych (#108): po wczytaniu adresów wraca do wyszukiwania zamiast
// pustej karty. Osobny plik, bo stan aplikacji to moduł z jednym obiektem (każdy plik testowy ma
// własny proces), a `podlaczDane` woła się raz na aplikację.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { pobierzStan, podlaczDane, wczytajLinkStartowy } from './stan.ts'
import { czytajHash } from './url.ts'

test('nieznany adres z linku wraca do wyszukiwania po wczytaniu słownika', () => {
  wczytajLinkStartowy(czytajHash('#/adres/nie-ma-takiego'))
  assert.equal(pobierzStan().ekran, 'okolica')
  podlaczDane(['id-a', 'id-b'], [{ id: 'halas_ldwn', kategoria: 'spokoj' }], [])
  assert.equal(pobierzStan().ekran, 'szukaj')
  assert.equal(pobierzStan().wybrany, null)
})
