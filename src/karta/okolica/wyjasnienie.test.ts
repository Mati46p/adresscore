import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { WskaznikMeta } from '../../kontrakty/index.ts'
import type { RozbicieWarstwy } from '../../wynik/silnik.ts'
import {
  liczbyWarstw,
  mocneISlabe,
  opisRozdzielczosci,
  opisWartosci,
  zdanieWarstwy,
  znakowanePunkty,
} from './wyjasnienie.ts'

function warstwa(
  id: string,
  ocena: number | null,
  waga: number,
  extra: Partial<RozbicieWarstwy> = {},
) {
  const meta = {
    id,
    nazwa: id,
    jednostka: 'm',
    rozdzielczosc: 'adres',
    kategoria: 'transport',
  } as WskaznikMeta
  return {
    id,
    meta,
    kategoria: 'transport',
    wartosc: 100,
    etykieta: null,
    ocena,
    kierunek: 'mniej-lepiej',
    wagaUzytkownika: 1,
    waga,
    wklad: ocena === null ? null : ocena * waga,
    liczona: true,
    ...extra,
  } as RozbicieWarstwy
}

test('mocne i słabe strony liczą wpływ względem wyniku, nie sam wkład', () => {
  // Wynik = 0,5·90 + 0,3·50 + 0,2·20 = 64. Warstwa C ma mały wkład (4), ale to ona ciągnie w dół.
  const w = [warstwa('a', 90, 0.5), warstwa('b', 50, 0.3), warstwa('c', 20, 0.2)]
  const { mocne, slabe } = mocneISlabe(w, 64)
  assert.deepEqual(
    mocne.map((m) => m.warstwa.id),
    ['a'],
  )
  assert.deepEqual(
    slabe.map((m) => m.warstwa.id),
    ['c', 'b'],
  )
  assert.ok(Math.abs((mocne[0]?.punkty ?? 0) - 13) < 1e-9)
})

test('brak wyniku albo warstwy bez danych nie daje stron', () => {
  assert.deepEqual(mocneISlabe([warstwa('a', 80, 1)], null), { mocne: [], slabe: [] })
  assert.deepEqual(mocneISlabe([warstwa('a', null, 0)], 50), { mocne: [], slabe: [] })
})

test('limit trzech pozycji', () => {
  const w = ['a', 'b', 'c', 'd', 'e'].map((id, i) => warstwa(id, 100 - i * 5, 0.2))
  assert.equal(mocneISlabe(w, 40).mocne.length, 3)
})

test('zdanie z normą i bez', () => {
  const meta = {
    id: 'h',
    nazwa: 'Hałas',
    jednostka: 'dB',
    rozdzielczosc: 'adres',
    kategoria: 'spokoj',
    norma: { wartosc: 64, opis: 'Dopuszczalny LDWN', zrodlo: 'x' },
  } as WskaznikMeta
  const przekroczona = warstwa('h', 20, 0.5, { meta, wartosc: 70 })
  assert.equal(zdanieWarstwy(przekroczona), '70 dB, powyżej progu 64 dB (Dopuszczalny LDWN).')
  const ok = warstwa('h', 80, 0.5, { meta, wartosc: 50 })
  assert.match(zdanieWarstwy(ok), /w granicach progu 64 dB/)
  assert.equal(zdanieWarstwy(warstwa('p', 88, 0.5)), '100 m. Ocena 88 na 100 w skali tej warstwy.')
})

test('wartość z etykietą i rozdzielczość', () => {
  assert.equal(
    opisWartosci(warstwa('p', 1, 1, { wartosc: 240, etykieta: 'Rondo Mogilskie' })),
    '240 m – Rondo Mogilskie',
  )
  assert.equal(opisWartosci(warstwa('p', null, 0, { wartosc: null })), 'brak danych')
  assert.equal(opisRozdzielczosci({ rozdzielczosc: 'siatka', rozmiar: '100 m' }), 'siatka 100 m')
  assert.equal(opisRozdzielczosci({ rozdzielczosc: 'adres' }), 'adres')
  assert.equal(opisRozdzielczosci({ rozdzielczosc: 'gmina', rozmiar: 'gmina' }), 'gmina')
})

test('punkty z prawdziwym minusem, liczba warstw', () => {
  assert.equal(znakowanePunkty(13.6), '+14')
  assert.equal(znakowanePunkty(-6.7), '−7')
  assert.equal(znakowanePunkty(0.2), '0')
  const w = [warstwa('a', 50, 1), warstwa('b', null, 0), warstwa('c', 1, 0, { liczona: false })]
  assert.deepEqual(liczbyWarstw(w), { zDanymi: 1, razem: 2 })
})
