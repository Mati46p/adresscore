// Okolica adresu na karcie i w porównaniu (#185). Uruchom: node --test src/wynik/
// Część testów jedzie na prawdziwych plikach z public/dane (adresy.json, okolice.json) – bez nich
// jest pomijana, jak testy trybu Biznes.
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import type { PlikAdresow, PlikOkolic, Rozjazd } from '../kontrakty/index.ts'
import {
  krotkaNazwaZrodla,
  MAKS_POTOCZNYCH,
  miejsceAdresu,
  miejsceOkolicy,
  opisZrodelOkolic,
  URL_PRAW_OSM,
  zdaniePotocznych,
  zrodlaOkolic,
} from './miejsceAdresu.ts'
import { plikOkolic } from './okoliceTestowe.ts'
import { liczbaAdresowOkolicy } from './rankingLuk.ts'

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

const WPISY: Wpisy = {
  'sim-101': sim('Stare Miasto', 'I.1', 'I Stare Miasto', [], 683),
  'sim-302': sim('Rakowice', 'III.2', 'III Prądnik Czerwony', ['Ugorek', 'Wieczysta'], 803),
  'sim-1801': sim(
    'Nowa Huta',
    'XVIII.1',
    'XVIII Nowa Huta',
    Array.from({ length: 18 }, (_, k) => `Osiedle ${k + 1}`),
    2000,
  ),
  'm-1206063-liszki': {
    nazwa: 'Liszki',
    rodzaj: 'miejscowosc',
    dzielnica: null,
    gmina: 'Liszki',
    liczbaAdresow: 589,
  },
}

const ROZJAZDY: Rozjazd[] = [
  {
    rodzaj: 'nazwa-jednostki-jak-dzielnica',
    jednostki: ['sim-101'],
    dzielnica: 'I Stare Miasto',
    udzialPowierzchniDzielnicyProc: 17,
    opis: 'Nazwa jednostki SIM „Stare Miasto” (I.1) zawiera nazwę dzielnicy I Stare Miasto, ale jednostka to 17% jej powierzchni.',
  },
  {
    rodzaj: 'nazwa-w-kilku-jednostkach',
    nazwa: 'Gaj',
    jednostki: ['sim-101', 'sim-302'],
    opis: 'Nazwa „Gaj” występuje w OSM w 2 jednostkach SIM – wyszukiwanie po tej nazwie jest niejednoznaczne.',
  },
  {
    rodzaj: 'jednostka-bez-miejsc-osm',
    jednostki: ['sim-101'],
    opis: 'W jednostce SIM „Stare Miasto” (I.1) OSM nie ma żadnego osiedla – okolica ma tylko nazwę SIM.',
  },
  {
    rodzaj: 'nazwa-poza-jednostka-o-tej-nazwie',
    nazwa: 'Ugorek',
    jednostki: ['sim-302', 'sim-101'],
    opis: 'Punkt OSM „Ugorek” leży w jednostce „Rakowice” (III.2), a jednostka SIM o tej nazwie to „Stare Miasto” (I.1).',
  },
  {
    rodzaj: 'okolica-poza-krakowem',
    opis: 'Poza Krakowem nie ma jednostek SIM: okolicą adresu jest miejscowość w gminie.',
  },
]

// Adresy: 0 Stare Miasto, 1 Rakowice, 2 Nowa Huta, 3 Liszki, 4 bez okolicy (null w kolumnie).
const KOLUMNA = ['sim-101', 'sim-302', 'sim-1801', 'm-1206063-liszki', null]
const KRAKOW = { dzielnica: 'I Stare Miasto', gmina: 'Kraków' }
const LISZKI = { dzielnica: null, gmina: 'Liszki' }

const okolice: PlikOkolic = { ...plikOkolic(KOLUMNA, 'test', WPISY), rozjazdy: ROZJAZDY }

describe('miejsceAdresu: jednostka SIM', () => {
  const m = miejsceAdresu(KRAKOW, 1, okolice)

  it('nazwa, id, podpis z numerem i dzielnicą oraz liczba adresów jak w rankingach luk', () => {
    assert.equal(m.rodzaj, 'sim')
    assert.equal(m.id, 'sim-302')
    assert.equal(m.nazwa, 'Rakowice')
    assert.equal(m.podpis, 'jednostka SIM III.2, dzielnica III Prądnik Czerwony')
    assert.equal(m.liczbaAdresow, 803)
    assert.equal(m.opis, 'jednostka SIM III.2, dzielnica III Prądnik Czerwony · 803 adresy')
  })

  it('nazwy potoczne z pliku, w kolejności pliku', () => {
    assert.deepEqual(m.potoczne, ['Ugorek', 'Wieczysta'])
  })

  it('uwagi: tylko rozjazdy tłumaczące nazwę jednostki, dla tej jednostki', () => {
    // „Gaj” (wyszukiwanie) i okolica poza Krakowem nie mówią nic o adresie – na kartę nie idą.
    assert.deepEqual(m.uwagi, [ROZJAZDY[3]?.opis])
  })

  it('jednostka o nazwie jak dzielnica niesie uwagę o udziale w dzielnicy i o nazwie spoza jednostki', () => {
    const stare = miejsceAdresu(KRAKOW, 0, okolice)
    assert.equal(stare.nazwa, 'Stare Miasto')
    assert.deepEqual(stare.uwagi, [ROZJAZDY[0]?.opis, ROZJAZDY[3]?.opis])
    assert.deepEqual(stare.potoczne, [])
  })

  it('ten sam rozjazd nie powtarza się na liście uwag', () => {
    const podwojony: PlikOkolic = {
      ...okolice,
      rozjazdy: [...ROZJAZDY, ...ROZJAZDY],
    }
    assert.equal(miejsceAdresu(KRAKOW, 0, podwojony).uwagi.length, 2)
  })
})

describe('miejsceAdresu: miejscowość poza Krakowem', () => {
  it('nazwa, gmina w podpisie i liczba adresów; bez nazw potocznych i uwag', () => {
    const m = miejsceAdresu(LISZKI, 3, okolice)
    assert.equal(m.rodzaj, 'miejscowosc')
    assert.equal(m.id, 'm-1206063-liszki')
    assert.equal(m.nazwa, 'Liszki')
    assert.equal(m.podpis, 'miejscowość, gmina Liszki')
    assert.equal(m.opis, 'miejscowość, gmina Liszki · 589 adresów')
    assert.deepEqual(m.potoczne, [])
    assert.deepEqual(m.uwagi, [])
  })
})

describe('miejsceAdresu: zapas na dzielnicę i gminę', () => {
  it('bez pliku okolic: dzielnica Krakowa albo gmina, bez podpisu i bez liczby adresów', () => {
    for (const plik of [null, undefined]) {
      assert.deepEqual(miejsceAdresu(KRAKOW, 0, plik), {
        rodzaj: 'zapas',
        id: null,
        nazwa: 'Dzielnica I Stare Miasto',
        podpis: null,
        opis: null,
        liczbaAdresow: null,
        potoczne: [],
        uwagi: [],
      })
    }
    assert.equal(miejsceAdresu(LISZKI, 3, null).nazwa, 'Gmina Liszki')
  })

  it('null w kolumnie okolic: zapas z adresu, nie pusta okolica i nie zero', () => {
    const m = miejsceAdresu(KRAKOW, 4, okolice)
    assert.equal(m.rodzaj, 'zapas')
    assert.equal(m.nazwa, 'Dzielnica I Stare Miasto')
    assert.equal(m.id, null)
    assert.equal(m.liczbaAdresow, null)
  })

  it('indeks poza kolumną (plik krótszy niż lista adresów) nie dostaje cudzej okolicy', () => {
    assert.equal(miejsceAdresu(KRAKOW, KOLUMNA.length, okolice).rodzaj, 'zapas')
    assert.equal(miejsceAdresu(KRAKOW, -1, okolice).rodzaj, 'zapas')
  })

  it('adres bez dzielnicy i gminy: brak danych, nie „Gmina ”', () => {
    assert.equal(
      miejsceAdresu({ dzielnica: null, gmina: '' }, 4, okolice).nazwa,
      'Brak danych o okolicy',
    )
  })
})

describe('miejsceOkolicy: okolica o id, bez adresu (wyszukiwarka)', () => {
  it('daje to samo, co miejsceAdresu dla adresu leżącego w tej okolicy', () => {
    assert.deepEqual(miejsceOkolicy(okolice, 'sim-302'), miejsceAdresu(KRAKOW, 1, okolice))
    assert.deepEqual(miejsceOkolicy(okolice, 'sim-101'), miejsceAdresu(KRAKOW, 0, okolice))
    assert.deepEqual(miejsceOkolicy(okolice, 'sim-1801'), miejsceAdresu(KRAKOW, 2, okolice))
    assert.deepEqual(miejsceOkolicy(okolice, 'm-1206063-liszki'), miejsceAdresu(LISZKI, 3, okolice))
  })

  it('jednostka SIM: podpis, potoczne i uwagi; miejscowość: gmina w podpisie, bez potocznych', () => {
    const rakowice = miejsceOkolicy(okolice, 'sim-302')
    assert.equal(rakowice?.rodzaj, 'sim')
    assert.equal(rakowice?.podpis, 'jednostka SIM III.2, dzielnica III Prądnik Czerwony')
    assert.deepEqual(rakowice?.potoczne, ['Ugorek', 'Wieczysta'])
    assert.deepEqual(rakowice?.uwagi, [ROZJAZDY[3]?.opis])
    const liszki = miejsceOkolicy(okolice, 'm-1206063-liszki')
    assert.equal(liszki?.rodzaj, 'miejscowosc')
    assert.equal(liszki?.podpis, 'miejscowość, gmina Liszki')
    assert.deepEqual(liszki?.potoczne, [])
    assert.deepEqual(liszki?.uwagi, [])
  })

  it('nieznane id, id zapasu („dzielnica:…”, „brak”) i brak pliku dają null – wołający ma zapas', () => {
    assert.equal(miejsceOkolicy(okolice, 'sim-999'), null)
    assert.equal(miejsceOkolicy(okolice, 'dzielnica:I Stare Miasto'), null)
    assert.equal(miejsceOkolicy(okolice, 'brak'), null)
    assert.equal(miejsceOkolicy(null, 'sim-302'), null)
    assert.equal(miejsceOkolicy(undefined, 'sim-302'), null)
  })
})

describe('zdaniePotocznych', () => {
  const nazwy = (n: number) => Array.from({ length: n }, (_, k) => `N${k + 1}`)

  it('brak nazw potocznych (OSM nie ma w jednostce osiedla) daje null, nie puste zdanie', () => {
    assert.equal(zdaniePotocznych([]), null)
  })

  it('wylicza nazwy po przecinku i mówi, że leżą w jednostce (nie, że adres leży w osiedlu)', () => {
    assert.equal(
      zdaniePotocznych(['Ugorek', 'Wieczysta']),
      'W tej jednostce leżą też osiedla i części miasta z OpenStreetMap: Ugorek, Wieczysta.',
    )
  })

  it('do limitu wylicza wszystko, także jedną nazwę ponad limit (zamiast „i jeszcze 1 nazwa”)', () => {
    for (const ile of [MAKS_POTOCZNYCH, MAKS_POTOCZNYCH + 1]) {
      const zdanie = zdaniePotocznych(nazwy(ile)) ?? ''
      assert.ok(zdanie.endsWith(`, N${ile}.`), zdanie)
      assert.doesNotMatch(zdanie, /jeszcze/)
    }
  })

  it('powyżej limitu skraca listę i podaje resztę liczbą z odmianą', () => {
    const z = (n: number) => zdaniePotocznych(nazwy(n), 2) ?? ''
    assert.match(z(4), /: N1, N2 i jeszcze 2 nazwy\.$/)
    assert.match(z(7), /: N1, N2 i jeszcze 5 nazw\.$/)
    assert.match(z(14), /: N1, N2 i jeszcze 12 nazw\.$/)
    assert.match(z(24), /: N1, N2 i jeszcze 22 nazwy\.$/)
  })

  it('Nowa Huta z 18 nazwami: sześć nazw i „i jeszcze 12 nazw”', () => {
    const m = miejsceAdresu(KRAKOW, 2, okolice)
    const zdanie = zdaniePotocznych(m.potoczne) ?? ''
    assert.match(
      zdanie,
      /: Osiedle 1, Osiedle 2, Osiedle 3, Osiedle 4, Osiedle 5, Osiedle 6 i jeszcze 12 nazw\.$/,
    )
  })
})

describe('źródła okolic', () => {
  const zrodla: PlikOkolic['zrodla'] = [
    {
      nazwa:
        'Jednostki SIM Krakowa – granice (MSIP, warstwa Obserwatorium/ZTP_SIM/MapServer/0; wydawca: Zarząd Transportu Publicznego w Krakowie)',
      url: 'https://otwartedane.um.krakow.pl/zbiory-danych/system-informacji-miejskiej-w-krakowie-sim',
      licencja: 'Ponowne wykorzystanie informacji sektora publicznego',
      dataDanych: '2026-09-26',
      pobrano: '2026-10-03',
    },
    {
      nazwa: 'Punkty adresowe projektu (adresy.json): współrzędne, gmina, miejscowość, dzielnica',
      url: 'https://msip.krakow.pl/dataset/1492',
      licencja: 'Regulamin MSIP',
      dataDanych: '2026-09-21',
      pobrano: '2026-10-03',
    },
    {
      nazwa:
        'OpenStreetMap przez Overpass API – potoczne nazwy osiedli i części miasta (place=neighbourhood, place=quarter)',
      url: 'https://overpass-api.de/api/interpreter',
      licencja: 'ODbL 1.0, © współtwórcy OpenStreetMap',
      dataDanych: '2026-10-03',
      pobrano: '2026-10-03',
    },
  ]

  it('krótka nazwa: to, co stoi przed „ – ”, „ (” albo „:”; bez takiego miejsca całość', () => {
    assert.equal(krotkaNazwaZrodla(zrodla[0]?.nazwa ?? ''), 'Jednostki SIM Krakowa')
    assert.equal(krotkaNazwaZrodla(zrodla[1]?.nazwa ?? ''), 'Punkty adresowe projektu')
    assert.equal(krotkaNazwaZrodla(zrodla[2]?.nazwa ?? ''), 'OpenStreetMap przez Overpass API')
    assert.equal(krotkaNazwaZrodla('Rejestr PRG'), 'Rejestr PRG')
    // Nazwa zaczynająca się od separatora nie może zamienić się w pusty napis.
    assert.equal(krotkaNazwaZrodla(' – bez nazwy'), '– bez nazwy')
  })

  it('OSM jest oznaczony (atrybucja ODbL), reszta nie', () => {
    assert.deepEqual(
      zrodlaOkolic({ zrodla }).map((z) => [z.nazwa, z.osm]),
      [
        ['Jednostki SIM Krakowa', false],
        ['Punkty adresowe projektu', false],
        ['OpenStreetMap przez Overpass API', true],
      ],
    )
    assert.match(URL_PRAW_OSM, /openstreetmap\.org\/copyright/)
  })

  it('zdanie pod rankingiem: krótkie nazwy ze stanem danych, bez OSM (ranking nie pokazuje nazw potocznych)', () => {
    assert.equal(
      opisZrodelOkolic({ zrodla }),
      'Okolice: Jednostki SIM Krakowa (stan 2026-09-26) · Punkty adresowe projektu (stan 2026-09-21).',
    )
  })

  it('plik bez opisu źródeł nie daje zdania z pustą listą', () => {
    assert.equal(opisZrodelOkolic({ zrodla: [] }), 'Okolice: brak opisu źródła.')
    assert.equal(
      opisZrodelOkolic({ zrodla: [zrodla[2] as (typeof zrodla)[number]] }),
      'Okolice: brak opisu źródła.',
    )
  })

  it('bez pliku zdanie mówi, że okolicą jest dzielnica albo gmina', () => {
    assert.match(opisZrodelOkolic(null), /dzielnice Krakowa i gminy/)
    assert.match(opisZrodelOkolic(undefined), /dzielnice Krakowa i gminy/)
  })

  it('inne miasto bez pliku okolic: gminy z rejestru adresów, bez słowa o Krakowie (#223)', () => {
    assert.equal(opisZrodelOkolic(null, false), 'Okolice: gminy z rejestru adresów.')
    assert.equal(opisZrodelOkolic(undefined, false), 'Okolice: gminy z rejestru adresów.')
    // Z plikiem flaga niczego nie zmienia: źródła są opisane w pliku.
    assert.equal(opisZrodelOkolic({ zrodla }, false), opisZrodelOkolic({ zrodla }))
  })
})

// ── Prawdziwe dane ───────────────────────────────────────────────────────────────────────

const DANE = new URL('../../public/dane/', import.meta.url)
const MA_PLIKI =
  existsSync(new URL('adresy.json', DANE)) && existsSync(new URL('okolice.json', DANE))

describe('miejsceAdresu na prawdziwych danych', {
  skip: MA_PLIKI ? false : 'brak plików danych',
}, () => {
  const czytaj = <T>(plik: string): T => JSON.parse(readFileSync(new URL(plik, DANE), 'utf8'))
  const adresy = czytaj<PlikAdresow>('adresy.json')
  const prawdziwe = czytaj<PlikOkolic>('okolice.json')
  const k = adresy.kolumny
  const n = k.id.length
  const adres = (i: number) => ({ dzielnica: k.dzielnica[i] ?? null, gmina: k.gmina[i] ?? '' })
  const zgodne = prawdziwe.wersjaAdresow === adresy.wersja

  it('plik okolic jest z tej samej wersji adresów (inaczej karta i tak pokazałaby zapas)', () => {
    assert.ok(zgodne, `okolice ${prawdziwe.wersjaAdresow}, adresy ${adresy.wersja}`)
  })

  it('każdy adres ma okolicę z pliku: Kraków to jednostka SIM, reszta miejscowość, zapas nie występuje', () => {
    if (!zgodne) return
    let sim = 0
    let miejscowosci = 0
    for (let i = 0; i < n; i++) {
      const m = miejsceAdresu(adres(i), i, prawdziwe)
      const wKrakowie = k.dzielnica[i] !== null
      assert.equal(m.rodzaj, wKrakowie ? 'sim' : 'miejscowosc', `adres ${i}`)
      assert.ok(m.nazwa.length > 0 && m.podpis !== null && m.opis !== null, `adres ${i}`)
      if (wKrakowie) {
        sim++
        // Dzielnica adresu = dzielnica jednostki (kontrola ETL: 100%) – podpis ją niesie.
        assert.ok(m.podpis?.includes(`dzielnica ${k.dzielnica[i]}`), `adres ${i}: ${m.podpis}`)
      } else {
        miejscowosci++
        assert.ok(m.podpis?.includes(`gmina ${k.gmina[i]}`), `adres ${i}: ${m.podpis}`)
      }
    }
    assert.equal(sim + miejscowosci, n)
    assert.ok(sim > 0 && miejscowosci > 0)
  })

  it('opis okolicy podaje liczbę adresów zgodną z kolumną okolic', () => {
    if (!zgodne) return
    const wKolumnie = new Map<number, number>()
    for (const p of prawdziwe.kolumny.okolica) {
      if (p !== null) wKolumnie.set(p, (wKolumnie.get(p) ?? 0) + 1)
    }
    for (const [p, ile] of wKolumnie) {
      const id = prawdziwe.idOkolic[p] as string
      const i = prawdziwe.kolumny.okolica.indexOf(p)
      const m = miejsceAdresu(adres(i), i, prawdziwe)
      assert.equal(m.id, id)
      assert.equal(m.liczbaAdresow, ile, id)
      assert.ok(m.opis?.endsWith(liczbaAdresowOkolicy(ile)), `${id}: ${m.opis}`)
    }
  })

  it('miejsceOkolicy daje to samo, co miejsceAdresu, dla każdej z 357 okolic', () => {
    if (!zgodne) return
    const kolumna = prawdziwe.kolumny.okolica
    for (const [p, id] of prawdziwe.idOkolic.entries()) {
      const i = kolumna.indexOf(p)
      assert.ok(i >= 0, `okolica ${id} nie ma adresu`)
      assert.deepEqual(miejsceOkolicy(prawdziwe, id), miejsceAdresu(adres(i), i, prawdziwe), id)
    }
  })

  it('każda jednostka: potoczne z pliku, najwyżej dwie uwagi, zdanie o nazwach tylko gdy są nazwy', () => {
    if (!zgodne) return
    const jednostki = prawdziwe.idOkolic.filter((id) => prawdziwe.okolice[id]?.rodzaj === 'sim')
    assert.equal(jednostki.length, 123)
    for (const id of jednostki) {
      const i = prawdziwe.kolumny.okolica.indexOf(prawdziwe.idOkolic.indexOf(id))
      const m = miejsceAdresu(adres(i), i, prawdziwe)
      const wpis = prawdziwe.okolice[id]
      assert.ok(wpis?.rodzaj === 'sim')
      assert.deepEqual(m.potoczne, wpis.potoczne, id)
      // Gęstość karty: nagłówek, jedno zdanie o nazwach i co najwyżej dwie uwagi.
      assert.ok(m.uwagi.length <= 2, `${id}: ${m.uwagi.length} uwag`)
      const zdanie = zdaniePotocznych(m.potoczne)
      assert.equal(zdanie === null, m.potoczne.length === 0, id)
      if (zdanie) {
        assert.ok(zdanie.includes(m.potoczne[0] as string), id)
        assert.ok(zdanie.length < 400, `${id}: zdanie ma ${zdanie.length} znaków`)
      }
    }
  })

  it('uwaga o nazwie jak dzielnica trafia do jednostki, której dotyczy, słowo w słowo z pliku', () => {
    if (!zgodne) return
    const rozjazd = prawdziwe.rozjazdy.find(
      (r) => r.rodzaj === 'nazwa-jednostki-jak-dzielnica' && r.jednostki?.includes('sim-101'),
    )
    assert.ok(rozjazd, 'plik okolic ma rozjazd dla jednostki Stare Miasto (I.1)')
    const i = prawdziwe.kolumny.okolica.indexOf(prawdziwe.idOkolic.indexOf('sim-101'))
    assert.ok(miejsceAdresu(adres(i), i, prawdziwe).uwagi.includes(rozjazd.opis))
  })

  it('żaden tekst okolicy nie ma pauzy; w polskim tekście stoi półpauza (–)', () => {
    if (!zgodne) return
    const wszystkie: string[] = [opisZrodelOkolic(prawdziwe)]
    for (let p = 0; p < prawdziwe.idOkolic.length; p++) {
      const i = prawdziwe.kolumny.okolica.indexOf(p)
      if (i < 0) continue
      const m = miejsceAdresu(adres(i), i, prawdziwe)
      wszystkie.push(m.nazwa, m.podpis ?? '', m.opis ?? '', ...m.uwagi)
      wszystkie.push(zdaniePotocznych(m.potoczne) ?? '')
    }
    assert.ok(wszystkie.length > 357, 'sprawdzono teksty wszystkich okolic')
    for (const t of wszystkie) assert.doesNotMatch(t, /—/, t)
  })

  it('źródła okolic z pliku: trzy wpisy z krótką nazwą, datą i oznaczonym OSM', () => {
    const z = zrodlaOkolic(prawdziwe)
    assert.equal(z.length, prawdziwe.zrodla.length)
    assert.equal(z.filter((x) => x.osm).length, 1)
    for (const x of z) {
      assert.ok(x.nazwa.length > 0 && x.nazwa.length < 60, x.nazwa)
      assert.match(x.dataDanych, /^\d{4}-\d{2}-\d{2}$/)
    }
  })
})
