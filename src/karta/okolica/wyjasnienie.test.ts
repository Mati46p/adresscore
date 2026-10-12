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

test('status MPZP pokazuje opis zamiast kodu 0/1', () => {
  const meta = { ...warstwa('mpzp_status', null, 0).meta, jednostka: 'status' }
  assert.equal(
    opisWartosci(
      warstwa('mpzp_status', null, 0, {
        meta,
        wartosc: 1,
        etykieta: 'Plan obowiązuje: Bronowice',
      }),
    ),
    'Plan obowiązuje: Bronowice',
  )
  assert.equal(
    opisWartosci(
      warstwa('mpzp_status', null, 0, {
        meta,
        wartosc: 0,
        etykieta: 'Brak obowiązującego planu w punkcie adresu',
      }),
    ),
    'Brak obowiązującego planu w punkcie adresu',
  )
  assert.equal(opisWartosci(warstwa('mpzp_status', null, 0, { meta, wartosc: 0 })), 'Nie')
  assert.equal(opisWartosci(warstwa('mpzp_status', null, 0, { meta, wartosc: 1 })), 'Tak')
})

test('punkty z prawdziwym minusem, liczba warstw', () => {
  assert.equal(znakowanePunkty(13.6), '+14')
  assert.equal(znakowanePunkty(-6.7), '−7')
  assert.equal(znakowanePunkty(0.2), '0')
  const w = [warstwa('a', 50, 1), warstwa('b', null, 0), warstwa('c', 1, 0, { liczona: false })]
  assert.deepEqual(liczbyWarstw(w), { zDanymi: 1, razem: 2 })
})

import type { RozbicieKategorii, WynikAdresu } from '../../wynik/silnik.ts'
import { powodPominiecia, skladWyniku } from './wyjasnienie.ts'

function kat(kategoria: string, warstwy: RozbicieWarstwy[]): RozbicieKategorii {
  const z = warstwy.filter((w) => w.ocena !== null)
  const waga = z.reduce((a, w) => a + w.waga, 0)
  const wklad = z.reduce((a, w) => a + (w.wklad ?? 0), 0)
  return {
    kategoria,
    ocena: waga > 0 ? wklad / waga : null,
    waga,
    wklad: z.length ? wklad : null,
    pewnosc: 1,
    warstwy,
  } as RozbicieKategorii
}

function wynikZ(warstwy: RozbicieWarstwy[]): WynikAdresu {
  const wklad = warstwy.reduce((a, w) => a + (w.wklad ?? 0), 0)
  const byKat = new Map<string, RozbicieWarstwy[]>()
  for (const w of warstwy) byKat.set(w.kategoria, [...(byKat.get(w.kategoria) ?? []), w])
  return {
    i: 0,
    wynik: warstwy.some((w) => w.ocena !== null) ? wklad : null,
    litera: null,
    pewnosc: 0.8,
    kategorie: [...byKat].map(([k, w]) => kat(k, w)),
    warstwy,
  } as WynikAdresu
}

test('skladWyniku: wkłady sumują się do wyniku, udziały do 100', () => {
  const s = skladWyniku(
    wynikZ([
      warstwa('a', 80, 0.5),
      warstwa('b', 40, 0.25, { kategoria: 'spokoj' }),
      warstwa('c', 60, 0.25, { kategoria: 'spokoj' }),
    ]),
  )
  assert.equal(s.wynik, 65)
  const wklady = s.kategorie.reduce((a, k) => a + k.wklad, 0)
  assert.ok(Math.abs(wklady - 65) <= 0.05)
  const udzialy = s.kategorie.reduce((a, k) => a + k.udzial, 0)
  assert.ok(Math.abs(udzialy - 100) <= 0.05)
  assert.ok(Math.abs(s.brakDo100 - 35) <= 0.05)
})

test('skladWyniku: wynik null daje pusty skład bez dzielenia przez 0', () => {
  const s = skladWyniku(wynikZ([warstwa('a', null, 0, { wartosc: null })]))
  assert.equal(s.wynik, null)
  assert.deepEqual(s.kategorie, [])
  assert.equal(s.brakDo100, 0)
})

test('skladWyniku: warstwa bez danych trafia do pominiętych, nie do zera', () => {
  const s = skladWyniku(
    wynikZ([warstwa('a', 70, 1), warstwa('b', null, 0, { wartosc: null, wagaUzytkownika: 2 })]),
  )
  assert.equal(s.pominiete.length, 1)
  assert.equal(s.pominiete[0]?.warstwa.id, 'b')
  assert.equal(s.pominiete[0]?.powod, 'brak danych')
  assert.equal(s.kategorie.flatMap((k) => k.warstwy).length, 1)
})

test('powodPominiecia: kolejność powodów', () => {
  const baza = {
    ocena: null,
    wartosc: 1,
    kierunek: 'mniej-lepiej',
    niedostepny: undefined,
  } as const
  assert.equal(powodPominiecia({ ...baza, ocena: 5 }), null)
  assert.equal(powodPominiecia({ ...baza, niedostepny: 'x' }), 'plik warstwy się nie wczytał')
  assert.equal(powodPominiecia({ ...baza, wartosc: null }), 'brak danych')
  assert.equal(powodPominiecia({ ...baza, kierunek: null }), 'bez kierunku, nie liczona')
  assert.equal(powodPominiecia(baza), 'nie liczona')
})
