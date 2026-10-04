// Szukanie okolic po nazwie (#185). Uruchom: node --test src/karta/wyszukiwarka/
// Część testów jedzie na prawdziwym pliku public/dane/okolice.json – bez niego jest pomijana.
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import type { PlikOkolic } from '../../kontrakty/okolice.ts'
import { liczbaAdresowOkolicy } from '../../wynik/rankingLuk.ts'
import { indeksOkolicDla, spojnyOpis, szukajOkolic, zbudujIndeksOkolic } from './szukajOkolic.ts'

type Wpisy = PlikOkolic['okolice']

const sim = (
  nazwa: string,
  numer: string,
  dzielnica: string,
  potoczne: string[],
  liczbaAdresow: number,
): Wpisy[string] => ({
  nazwa,
  numer,
  rodzaj: 'sim',
  dzielnica,
  gmina: 'Kraków',
  powierzchniaKm2: 1,
  liczbaAdresow,
  potoczne,
})

const miejscowosc = (nazwa: string, gmina: string, liczbaAdresow: number): Wpisy[string] => ({
  nazwa,
  rodzaj: 'miejscowosc',
  dzielnica: null,
  gmina,
  liczbaAdresow,
})

const WPISY: Wpisy = {
  'sim-702': sim('Błonia', 'VII.2', 'VII Zwierzyniec', [], 10),
  'sim-703': sim('Zwierzyniec', 'VII.3', 'VII Zwierzyniec', ['Salwator'], 1009),
  'sim-805': sim(
    'Ruczaj',
    'VIII.5',
    'VIII Dębniki',
    ['Osiedle Ruczaj-Zaborze', 'Osiedle Szuwarowa', 'Zaborze'],
    1241,
  ),
  'sim-302': sim('Rakowice', 'III.2', 'III Prądnik Czerwony', ['Ugorek', 'Wieczysta'], 803),
  'sim-1404': sim('Rakowice Lotnisko', 'XIV.4', 'XIV Czyżyny', ['Osiedle Akademickie'], 54),
  'sim-1103': sim('Kurdwanów', 'XI.3', 'XI Podgórze Duchackie', ['Osiedle "Kurdwanów Nowy"'], 729),
  'sim-106': sim('Wesoła', 'I.6', 'I Stare Miasto', [], 220),
  'sim-203': sim('Wesoła Wschód', 'II.3', 'II Grzegórzki', ['Wesoła'], 354),
  'sim-1801': sim(
    'Nowa Huta',
    'XVIII.1',
    'XVIII Nowa Huta',
    ['Osiedle Zgody', 'Osiedle Wandy'],
    755,
  ),
  'sim-1802': sim('Mogiła', 'XVIII.2', 'XVIII Nowa Huta', [], 876),
  'sim-901': sim('Łagiewniki', 'IX.1', 'IX Łagiewniki-Borek Fałęcki', [], 668),
  'sim-1301': sim('Stare Podgórze', 'XIII.1', 'XIII Podgórze', [], 966),
  'sim-1002': sim('Kliny', 'X.9', 'X Swoszowice', ['Osiedle Dywizjonu 303'], 1313),
  'sim-501': sim('Krowodrza', 'V.1', 'V Krowodrza', ['Nowy Kleparz'], 569),
  'm-1219053-wieliczka': miejscowosc('Wieliczka', 'Wieliczka', 4000),
  'm-1206063-grabie': miejscowosc('Grabie', 'Liszki', 120),
  'm-1219064-grabie': miejscowosc('Grabie', 'Wieliczka', 900),
  'm-1206063-ulica': miejscowosc('Ulica', 'Liszki', 12),
}

const plik = (wpisy: Wpisy): Pick<PlikOkolic, 'okolice' | 'idOkolic'> => ({
  okolice: wpisy,
  idOkolic: Object.keys(wpisy),
})

const ind = zbudujIndeksOkolic(plik(WPISY))
const id = (zapytanie: string, limit?: number) =>
  szukajOkolic(ind, zapytanie, limit).map((w) => w.id)

describe('szukajOkolic: dopasowanie nazwy', () => {
  it('pełna nazwa daje okolicę jako pierwszą, z opisem rodzaju, dzielnicy i liczby adresów', () => {
    const [pierwsza] = szukajOkolic(ind, 'Ruczaj')
    assert.equal(pierwsza?.id, 'sim-805')
    assert.equal(pierwsza?.rodzaj, 'sim')
    assert.equal(pierwsza?.nazwa, 'Ruczaj')
    assert.equal(pierwsza?.tytul, 'Ruczaj')
    assert.equal(pierwsza?.nazwaOsm, null)
    assert.equal(
      pierwsza?.opis,
      `jednostka SIM VIII.5, dzielnica VIII Dębniki · ${liczbaAdresowOkolicy(1241)}`,
    )
  })

  it('polskie znaki i wielkość liter: „kurdwanow”, „KURDWANÓW”, „lagiewniki” (ł)', () => {
    assert.equal(id('kurdwanow')[0], 'sim-1103')
    assert.equal(id('KURDWANÓW')[0], 'sim-1103')
    assert.equal(id('lagiewniki')[0], 'sim-901')
    assert.equal(id('mogila')[0], 'sim-1802')
  })

  it('początek nazwy w trakcie pisania: „ruc”, „kurdw”, „nowa h”', () => {
    assert.equal(id('ruc')[0], 'sim-805')
    assert.equal(id('kurdw')[0], 'sim-1103')
    assert.equal(id('nowa h')[0], 'sim-1801')
  })

  it('pełna nazwa przed dłuższą o ten sam początek: „Rakowice” przed „Rakowice Lotnisko”', () => {
    assert.deepEqual(id('rakowice'), ['sim-302', 'sim-1404'])
    assert.deepEqual(id('rak'), ['sim-302', 'sim-1404'])
  })

  it('słowo w środku nazwy też pasuje, ale za nazwą zaczynającą się od niego', () => {
    assert.deepEqual(id('podgorze'), ['sim-1301'])
    assert.deepEqual(id('huta'), ['sim-1801'])
  })

  it('kolejność słów w zapytaniu nie ma znaczenia', () => {
    assert.equal(id('huta nowa')[0], 'sim-1801')
  })

  it('odmiana nazwy: „na Ruczaju”, „Krowodrzy” – końcówki do 2 liter', () => {
    assert.equal(id('Ruczaju')[0], 'sim-805')
    assert.equal(id('na Ruczaju')[0], 'sim-805')
    assert.equal(id('Krowodrzy')[0], 'sim-501')
    assert.equal(id('Wieliczki')[0], 'm-1219053-wieliczka')
    // Ucieczka samogłoski („Zwierzyniec” → „Zwierzyńca”) wykracza poza ciasną regułę: wystarczy początek.
    assert.equal(id('Zwierzyn')[0], 'sim-703')
  })

  it('ulica o podobnej nazwie nie jest okolicą: „Mogilska” to nie „Mogiła”, „Krakowska” to nie „Krowodrza”', () => {
    assert.deepEqual(id('Mogilska'), [])
    assert.deepEqual(id('Krakowska'), [])
  })

  it('literówka od 5 liter: „ruczja”, „kurdwanuw”; krótkie słowa bez literówek', () => {
    assert.equal(id('ruczja')[0], 'sim-805')
    assert.equal(id('kurdwanuw')[0], 'sim-1103')
    assert.deepEqual(id('bloma'), [])
  })

  it('„osiedle”, „dzielnica”, „na” nie niosą nazwy', () => {
    assert.equal(id('osiedle Ruczaj')[0], 'sim-805')
    assert.equal(id('dzielnica Kurdwanów')[0], 'sim-1103')
    assert.deepEqual(id('osiedle'), [])
    assert.deepEqual(id('na w'), [])
    assert.deepEqual(id(''), [])
    assert.deepEqual(id('   '), [])
  })

  it('miejscowość o nazwie z samych wypełniaczy („Ulica”) da się znaleźć, a „osiedle” nadal niczego nie szuka', () => {
    assert.deepEqual(id('Ulica'), ['m-1206063-ulica'])
    assert.deepEqual(id('ulica'), ['m-1206063-ulica'])
    assert.deepEqual(id('osiedle'), [])
  })

  it('brak trafień dla zapytania spoza nazw', () => {
    assert.deepEqual(id('zzzzzz'), [])
    assert.deepEqual(id('Grodzka 52'), [])
  })

  it('limit i kolejność są deterministyczne', () => {
    assert.equal(szukajOkolic(ind, 'r', 2).length, 2)
    assert.ok(szukajOkolic(ind, 'r', 20).length >= 3)
    assert.deepEqual(szukajOkolic(ind, 'r', 20), szukajOkolic(ind, 'r', 20))
  })
})

describe('szukajOkolic: miejscowości i nazwy z OSM', () => {
  it('miejscowość poza Krakowem z gminą w opisie', () => {
    const [w] = szukajOkolic(ind, 'Wieliczka')
    assert.equal(w?.id, 'm-1219053-wieliczka')
    assert.equal(w?.rodzaj, 'miejscowosc')
    assert.equal(w?.opis, `miejscowość, gmina Wieliczka · ${liczbaAdresowOkolicy(4000)}`)
  })

  it('ta sama nazwa w dwóch gminach: obie okolice, większa pierwsza, gmina rozróżnia', () => {
    const w = szukajOkolic(ind, 'Grabie')
    assert.deepEqual(
      w.map((x) => x.id),
      ['m-1219064-grabie', 'm-1206063-grabie'],
    )
    assert.match(w[0]?.opis ?? '', /gmina Wieliczka/)
    assert.match(w[1]?.opis ?? '', /gmina Liszki/)
  })

  it('nazwa z OSM prowadzi do jednostki, w której leży punkt, i mówi o tym w opisie', () => {
    const [w] = szukajOkolic(ind, 'Salwator')
    assert.equal(w?.id, 'sim-703')
    assert.equal(w?.nazwa, 'Zwierzyniec')
    assert.equal(w?.tytul, 'Salwator')
    assert.equal(w?.nazwaOsm, 'Salwator')
    assert.equal(
      w?.opis,
      'nazwa z OpenStreetMap · Zwierzyniec (jednostka SIM VII.3, dzielnica VII Zwierzyniec)',
    )
  })

  it('nazwa OSM z cyframi i cudzysłowem: „dywizjonu 303”, „kurdwanow nowy”', () => {
    assert.equal(id('Dywizjonu 303')[0], 'sim-1002')
    assert.equal(id('osiedle Dywizjonu 303')[0], 'sim-1002')
    const w = szukajOkolic(ind, 'Nowy Kleparz')[0]
    assert.equal(w?.id, 'sim-501')
    assert.equal(w?.nazwaOsm, 'Nowy Kleparz')
  })

  it('jedna okolica to jedna podpowiedź: nazwa jednostki wygrywa z nazwą OSM z jej wnętrza', () => {
    // „Ruczaj” pasuje do jednostki i do „Osiedle Ruczaj-Zaborze” w niej.
    assert.deepEqual(id('ruczaj'), ['sim-805'])
    assert.equal(szukajOkolic(ind, 'ruczaj')[0]?.nazwaOsm, null)
    // „Zaborze” pasuje tylko do nazw OSM tej samej jednostki: jedna podpowiedź z najlepszą nazwą.
    const zaborze = szukajOkolic(ind, 'zaborze')
    assert.equal(zaborze.length, 1)
    assert.equal(zaborze[0]?.tytul, 'Zaborze')
    assert.equal(zaborze[0]?.nazwaOsm, 'Zaborze')
  })

  it('rozjazd z ETL: „Wesoła” to jednostka o tej nazwie i jednostka, w której leży punkt OSM „Wesoła”', () => {
    const w = szukajOkolic(ind, 'Wesoła')
    assert.deepEqual(
      w.map((x) => [x.id, x.nazwaOsm]),
      [
        ['sim-106', null],
        ['sim-203', 'Wesoła'],
      ],
    )
  })

  it('indeks jest budowany raz na plik', () => {
    const pelny = { ...plik(WPISY) } as PlikOkolic
    assert.equal(indeksOkolicDla(pelny), indeksOkolicDla(pelny))
  })

  it('żaden tekst podpowiedzi nie ma pauzy – w polskim tekście stoi półpauza', () => {
    for (const q of ['a', 'e', 'o', 'wieliczka', 'salwator']) {
      for (const w of szukajOkolic(ind, q, 50)) {
        assert.doesNotMatch(`${w.tytul} ${w.opis}`, /—/)
      }
    }
  })
})

describe('spojnyOpis', () => {
  it('separator zostaje przy poprzednim słowie, a liczba przy „adresów” (twarda spacja)', () => {
    assert.equal(
      spojnyOpis('jednostka SIM VIII.5, dzielnica VIII Dębniki · 1241 adresów'),
      'jednostka SIM VIII.5, dzielnica VIII Dębniki\u00a0· 1241\u00a0adresów',
    )
    assert.equal(
      spojnyOpis('miejscowość, gmina Liszki · 1 adres'),
      'miejscowość, gmina Liszki\u00a0· 1\u00a0adres',
    )
    assert.equal(spojnyOpis('x · 22 adresy'), 'x\u00a0· 22\u00a0adresy')
  })

  it('tekst bez separatora i bez liczby adresów zostaje bez zmian (np. opis adresu)', () => {
    assert.equal(spojnyOpis('I Stare Miasto, 31-001'), 'I Stare Miasto, 31-001')
    assert.equal(spojnyOpis(''), '')
  })

  it('tylko końcowa liczba adresów; słowo „adres” w środku nie jest ruszane', () => {
    assert.equal(spojnyOpis('adres 5 adresów dalej'), 'adres 5 adresów dalej')
  })
})

// ── Prawdziwe dane ───────────────────────────────────────────────────────────────────────

const DANE = new URL('../../../public/dane/okolice.json', import.meta.url)

describe('szukajOkolic na prawdziwym okolice.json', { skip: !existsSync(DANE) }, () => {
  const prawdziwe = JSON.parse(readFileSync(DANE, 'utf8')) as PlikOkolic
  const indeks = zbudujIndeksOkolic(prawdziwe)
  const szukaj = (q: string, limit?: number) => szukajOkolic(indeks, q, limit)

  it('przykłady z zadania: „Ruczaj”, „Rakowice”, „Kurdwanów”', () => {
    assert.equal(szukaj('Ruczaj')[0]?.id, 'sim-805')
    assert.deepEqual(
      szukaj('Rakowice').map((w) => w.id),
      ['sim-302', 'sim-1404'],
    )
    assert.equal(szukaj('Kurdwanów')[0]?.id, 'sim-1103')
    assert.equal(szukaj('kurdwanow')[0]?.id, 'sim-1103')
    assert.equal(szukaj('rakowice')[0]?.nazwa, 'Rakowice')
  })

  it('każda jednostka SIM znajduje się po własnej nazwie jako pierwsza z tą nazwą (bez ogonków też)', () => {
    const jednostki = prawdziwe.idOkolic.filter((k) => prawdziwe.okolice[k]?.rodzaj === 'sim')
    assert.equal(jednostki.length, 123)
    for (const k of jednostki) {
      const nazwa = prawdziwe.okolice[k]?.nazwa as string
      const bezOgonkow = nazwa
        .normalize('NFD')
        .replace(/\p{M}/gu, '')
        .replaceAll('ł', 'l')
        .replaceAll('Ł', 'L')
      for (const q of [nazwa, bezOgonkow, nazwa.toUpperCase()]) {
        const wyniki = szukaj(q, 8)
        // Wynik o dokładnie tej nazwie (nie OSM) stoi na początku, także gdy inna jednostka ma
        // w środku punkt OSM o tej samej nazwie (rozjazd „Wesoła”).
        const wlasna = wyniki.findIndex((w) => w.id === k && w.nazwaOsm === null)
        assert.ok(wlasna >= 0 && wlasna <= 1, `${q}: ${wyniki.map((w) => w.id).join(',')}`)
        assert.equal(wyniki[0]?.nazwa === nazwa || wyniki[0]?.tytul === nazwa, true, q)
      }
    }
  })

  it('każda miejscowość znajduje się po własnej nazwie (nazwy powtarzają się między gminami)', () => {
    const miejscowosci = prawdziwe.idOkolic.filter(
      (k) => prawdziwe.okolice[k]?.rodzaj === 'miejscowosc',
    )
    assert.equal(miejscowosci.length, 234)
    for (const k of miejscowosci) {
      const nazwa = prawdziwe.okolice[k]?.nazwa as string
      const ids = szukaj(nazwa, 8).map((w) => w.id)
      assert.ok(ids.includes(k), `${nazwa}: ${ids.join(',')}`)
    }
  })

  it('każda nazwa OSM prowadzi do jednostki, w której leży', () => {
    let sprawdzone = 0
    for (const k of prawdziwe.idOkolic) {
      const o = prawdziwe.okolice[k]
      if (o?.rodzaj !== 'sim') continue
      for (const osm of o.potoczne) {
        const ids = szukaj(osm, 12).map((w) => w.id)
        assert.ok(ids.includes(k), `${osm} (${k}): ${ids.join(',')}`)
        sprawdzone++
      }
    }
    assert.ok(sprawdzone >= 200, `sprawdzono ${sprawdzone} nazw OSM`)
  })

  it('podobne nazwy nie są mylone: „Podgórze” to nie „Podgórki”, „Mogilska” to nie „Mogiła”', () => {
    assert.deepEqual(
      szukaj('podgorze').map((w) => w.id),
      ['sim-1301'],
    )
    assert.deepEqual(szukaj('Mogilska'), [])
  })

  it('nazwy znane z potocznej mowy znajdują jednostkę: Salwator, Ugorek, Nowy Kleparz', () => {
    assert.equal(szukaj('Salwator')[0]?.id, 'sim-703')
    assert.equal(szukaj('Ugorek')[0]?.id, 'sim-302')
    assert.equal(szukaj('Nowy Kleparz')[0]?.id, 'sim-501')
    assert.equal(szukaj('Osiedle Złotej Jesieni')[0]?.id, 'sim-1601')
  })

  it('żaden tekst podpowiedzi nie ma pauzy', () => {
    for (const k of prawdziwe.idOkolic) {
      const nazwa = prawdziwe.okolice[k]?.nazwa as string
      for (const w of szukaj(nazwa, 8)) assert.doesNotMatch(`${w.tytul} ${w.opis}`, /—/)
    }
  })

  it('zapytanie na całym pliku trwa ułamek milisekundy (ok. 560 pozycji)', () => {
    const t = performance.now()
    for (let n = 0; n < 200; n++) for (const q of ['ruc', 'kurdw', 'nowa h', 'wieliczka']) szukaj(q)
    const ms = (performance.now() - t) / 800
    console.log(`szukajOkolic: ${ms.toFixed(3)} ms na zapytanie`)
    assert.ok(ms < 5, `${ms} ms`)
  })
})
