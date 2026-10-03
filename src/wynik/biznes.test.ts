import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  bezPunktu,
  bilansPopytu,
  czynnikiOceny,
  type KomorkaPopytu,
  kursyZeSlowem,
  type Miejsce,
  type OcenaMiejsca,
  obliczBazowePunkty,
  obliczBialePlamy,
  ocenMiejsce,
  ocenMiejsceWIndeksie,
  PROGI_CZYNNIKOW,
  type PunktUslugi,
  pozycjaPercentyla,
  pozycjaWRozkladzie,
  progNasycenia,
  progSkaliPlam,
  przygotujKomorki,
  rozbicieZasiegu,
  skalaPlamy,
  udzialyHuffa,
  zbudujIndeks,
} from './biznes.ts'
import { ocenaPelna } from './biznesOdniesienie.ts'

// Pauza zapisana kodem: w pliku nie ma literalnego znaku (w polskim tekście obowiązuje półpauza).
const PAUZA = String.fromCodePoint(0x2014)

const komorki: KomorkaPopytu[] = [
  ['h1', 19.999, 50, 100, 200, 0],
  ['h2', 20.001, 50, 100, 200, 0],
  ['h3', 20.03, 50, 10, 20, 0],
]
const apteki: PunktUslugi[] = [
  [20, 50, 'Apteka A'],
  [20.004, 50, 'Apteka B'],
]

/** Deterministyczny generator (LCG), żeby zbiory testowe były te same przy każdym uruchomieniu. */
function losowy(ziarno: number) {
  let s = ziarno >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

/** Kilkaset heksów na ok. 6 × 6 km, część punktów poza obszarem popytu, część bez nazwy. */
function zbior(ziarno: number, nKomorek = 320, nPunktow = 45) {
  const r = losowy(ziarno)
  const dane: KomorkaPopytu[] = Array.from({ length: nKomorek }, (_, i) => [
    `h${i}`,
    19.9 + r() * 0.08,
    50.03 + r() * 0.05,
    1 + Math.floor(r() * 30),
    r() < 0.2 ? 0 : Math.round(r() * 300),
    Math.round(r() * 40),
  ])
  const uslugi: PunktUslugi[] = Array.from({ length: nPunktow }, (_, i) => [
    19.87 + r() * 0.14,
    50.01 + r() * 0.09,
    r() < 0.15 ? '' : `Punkt ${i}`,
  ])
  // Kilka punktów daleko od danych o popycie (jak reszta Małopolski w plikach branż).
  for (let i = 0; i < 6; i++) uslugi.push([20.4 + r() * 0.1, 49.7 + r() * 0.05, `Daleki ${i}`])
  return { dane, uslugi }
}

function miejsca(ziarno: number, dane: readonly KomorkaPopytu[], uslugi: readonly PunktUslugi[]) {
  const r = losowy(ziarno)
  const lista: Miejsce[] = []
  for (let i = 0; i < 30; i++) {
    if (i % 4 === 0) {
      // Na istniejącym obiekcie (kilka metrów od punktu): punkt jest ZASTĘPOWANY.
      const p = uslugi[Math.floor(r() * uslugi.length)] as PunktUslugi
      lista.push({ lon: p[0] + (r() - 0.5) * 0.00008, lat: p[1] + (r() - 0.5) * 0.00008 })
    } else if (i % 7 === 0) {
      lista.push({ lon: 20.2 + r() * 0.3, lat: 49.6 + r() * 0.1 }) // poza danymi o popycie
    } else {
      const c = dane[Math.floor(r() * dane.length)] as KomorkaPopytu
      lista.push({ lon: c[1] + (r() - 0.5) * 0.004, lat: c[2] + (r() - 0.5) * 0.004 })
    }
  }
  return lista
}

const bliskie = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * (1 + Math.abs(b))

test('Huff dzieli popyt w każdym heksie do 100%', () => {
  const udzialy = udzialyHuffa([100, 200, 500])
  assert.ok(Math.abs(udzialy.reduce((a, b) => a + b, 0) - 1) < 1e-12)
  assert.ok((udzialy[0] ?? 0) > (udzialy[1] ?? 0))
  const bilans = bilansPopytu(komorki, apteki, 800)
  assert.ok(Math.abs(bilans.przydzielone + bilans.nieobsluzone - 210) < 1e-9)
  assert.equal(bilans.nieobsluzone, 10)
})

test('punkt na istniejącej aptece jest porównywany bez podwójnego liczenia apteki', () => {
  const wynik = ocenMiejsce(komorki, apteki, 800, { lon: 20, lat: 50 })
  assert.equal(wynik.konkurenci, 1)
  assert.equal(wynik.adresyWZasiegu, 200)
  assert.ok(wynik.przydzieloneAdresy > 0)
  const bazowe = obliczBazowePunkty(komorki, apteki, 800)
  assert.ok(Math.abs(wynik.przydzielonyPopyt - (bazowe[0] ?? 0)) < 1e-9)
  assert.ok(wynik.percentyl === null || (wynik.percentyl >= 0 && wynik.percentyl <= 100))
})

test('remisy bez popytu nie są fałszywie pokazywane jako najlepsza lokalizacja', () => {
  const wynik = ocenMiejsce([], apteki, 800, { lon: 20, lat: 50 })
  // Brak popytu u wszystkich = brak rozkładu porównawczego, a nie „100%” ani „50%”.
  assert.equal(wynik.percentyl, null)
  assert.equal(wynik.porownanoZ, 0)
  assert.equal(wynik.udzialProcent, 0)
})

test('remis w rozkładzie liczy się po połowie, więc samo „równo z wszystkimi” to środek', () => {
  assert.deepEqual(pozycjaWRozkladzie(Float64Array.from([1, 2, 2, 2, 3]), 2), [1, 3])
  assert.deepEqual(pozycjaWRozkladzie(Float64Array.from([5, 5, 5, 5]), 5), [0, 4])
  assert.deepEqual(pozycjaWRozkladzie(Float64Array.from([1, 2, 3]), 0), [0, 0])
  assert.deepEqual(pozycjaWRozkladzie(Float64Array.from([1, 2, 3]), 9), [3, 0])
  assert.deepEqual(pozycjaWRozkladzie(new Float64Array(0), 1), [0, 0])
  const [mniejsze, rowne] = pozycjaWRozkladzie(Float64Array.from([5, 5, 5, 5]), 5)
  assert.equal((100 * (mniejsze + rowne / 2)) / 4, 50)
})

test('rozkład porównawczy to tylko punkty z popytem w zasięgu, nie cała Małopolska', () => {
  // Trzy heksy przy punkcie A; B, C i D leżą daleko od danych (jak punkty spoza Krakowa w OSM).
  const dane: KomorkaPopytu[] = [
    ['h1', 20, 50, 100, 200, 0],
    ['h2', 20.002, 50, 100, 200, 0],
    ['h3', 20, 50.002, 100, 200, 0],
  ]
  const uslugi: PunktUslugi[] = [
    [20.001, 50.001, 'A'],
    [21, 50, 'B'],
    [19, 50, 'C'],
    [20.5, 50.2, 'D'],
  ]
  const indeks = zbudujIndeks(przygotujKomorki(dane), uslugi, 800)
  assert.equal(indeks.rozklad.length, 1)
  assert.deepEqual(Array.from(indeks.heksowWZasiegu), [3, 0, 0, 0])
  // Miejsce obok A dzieli z nim popyt, więc ma mniej niż A samo. Wśród punktów z popytem
  // (tylko A) jest ostatnie – nie „lepsze niż 3 z 4”, jak liczyły zera spoza obszaru danych.
  const wynik = ocenMiejsceWIndeksie(indeks, { lon: 20.0005, lat: 50.0005 })
  assert.equal(wynik.porownanoZ, 1)
  assert.equal(wynik.percentyl, 0)
  assert.ok(wynik.przydzielonyPopyt < (indeks.przydzialPopytu[0] as number))
})

test('miejsce bez adresów w zasięgu nie dostaje percentyla', () => {
  const dane: KomorkaPopytu[] = [['h1', 20, 50, 100, 200, 0]]
  const wynik = ocenMiejsce(dane, [[20.001, 50, 'A']], 800, { lon: 21, lat: 50 })
  assert.equal(wynik.adresyWZasiegu, 0)
  assert.equal(wynik.percentyl, null)
  assert.equal(wynik.udzialProcent, 0)
  assert.equal(wynik.konkurenci, 0)
})

test('miejsce na istniejącym punkcie nie porównuje się samo ze sobą', () => {
  const { dane, uslugi } = zbior(3)
  const indeks = zbudujIndeks(przygotujKomorki(dane), uslugi, 800)
  const wszystkie = indeks.rozklad.length
  // Punkt z popytem w zasięgu, położony tak, że żaden inny nie jest bliżej niż 25 m.
  const j = Array.from(indeks.heksowWZasiegu).findIndex((n) => n > 0)
  const p = uslugi[j] as PunktUslugi
  const wynik = ocenMiejsceWIndeksie(indeks, { lon: p[0], lat: p[1] })
  assert.equal(wynik.porownanoZ, wszystkie - 1)
})

test('skala mapy nasyca się na 95. percentylu heksów z punktem, nie na maksimum', () => {
  const wartosci = Array.from({ length: 100 }, (_, i) => i + 1)
  assert.equal(progNasycenia(wartosci), 96)
  const plamy = obliczBialePlamy(komorki, apteki, 800)
  const prog = progSkaliPlam(plamy)
  const zPunktem = plamy.flatMap((p) => (p.adresyNaPunkt === null ? [] : [p.adresyNaPunkt]))
  assert.equal(prog, progNasycenia(zPunktem))
  for (const p of plamy)
    assert.equal(p.skala, Math.min(100, (100 * (p.adresyNaPunkt ?? p.adresyWZasiegu)) / prog))
  assert.equal(skalaPlamy({ adresyNaPunkt: 200, adresyWZasiegu: 999 }, 100), 100)
  assert.equal(skalaPlamy({ adresyNaPunkt: 25, adresyWZasiegu: 999 }, 100), 25)
})

test('heks bez żadnego punktu różni się od heksu z jednym punktem', () => {
  // Dwa identyczne skupiska heksów; w pierwszym stoi jeden punkt, w drugim nie ma żadnego.
  const trzy = (lon: number, nazwa: string): KomorkaPopytu[] => [
    [`${nazwa}1`, lon, 50, 100, 200, 0],
    [`${nazwa}2`, lon + 0.002, 50, 100, 200, 0],
    [`${nazwa}3`, lon, 50.002, 100, 200, 0],
  ]
  const dane = [...trzy(20, 'z'), ...trzy(20.3, 'b')]
  const plamy = obliczBialePlamy(dane, [[20.001, 50, 'Jedyna apteka']], 800)
  const zPunktem = plamy.find((p) => p.h3 === 'z1')
  const bez = plamy.find((p) => p.h3 === 'b1')
  assert.ok(zPunktem && bez)
  // Ten sam popyt w zasięgu…
  assert.equal(zPunktem.adresyWZasiegu, 300)
  assert.equal(bez.adresyWZasiegu, 300)
  // …ale to dwie różne kategorie: iloraz z jednym punktem, a przy zerze – brak ilorazu.
  assert.equal(zPunktem.konkurenci, 1)
  assert.equal(zPunktem.adresyNaPunkt, 300)
  assert.equal(bezPunktu(zPunktem), false)
  assert.equal(bez.konkurenci, 0)
  assert.equal(bez.adresyNaPunkt, null)
  assert.equal(bezPunktu(bez), true)
  assert.equal(bez.najblizszyKonkurent, null)
})

test('konkurent bez nazwy zachowuje odległość i nie jest uznany za brak punktu', () => {
  const wynik = ocenMiejsce(komorki, [[20.002, 50, '']], 800, { lon: 20, lat: 50 })
  assert.equal(wynik.konkurenci, 1)
  assert.equal(wynik.najblizszyKonkurent, null)
  assert.ok((wynik.odlegloscKonkurenta ?? 0) > 0)
})

for (const promien of [800, 1200]) {
  test(`ocena na indeksie = przeliczenie całego miasta od zera (zasięg ${promien} m)`, () => {
    const { dane, uslugi } = zbior(promien)
    const indeks = zbudujIndeks(przygotujKomorki(dane), uslugi, promien)
    const lista = miejsca(promien + 1, dane, uslugi)
    let zastapione = 0
    let bezDanych = 0
    for (const m of lista) {
      const a = ocenMiejsceWIndeksie(indeks, m)
      const b = ocenaPelna(dane, uslugi, promien, m)
      const opis = JSON.stringify(m)
      for (const pole of [
        'adresyWZasiegu',
        'mieszkancyWZasiegu',
        'kursySzczytSrednio',
        'przydzieloneAdresy',
        'przydzielonyPopyt',
      ] as const)
        assert.ok(bliskie(a[pole], b[pole]), `${pole} ${a[pole]} vs ${b[pole]} dla ${opis}`)
      for (const pole of [
        'konkurenci',
        'udzialProcent',
        'percentyl',
        'porownanoZ',
        'najblizszyKonkurent',
        'odlegloscKonkurenta',
      ] as const)
        assert.equal(a[pole], b[pole], `${pole} dla ${opis}`)
      if (b.zastapiony >= 0) zastapione++
      if (a.adresyWZasiegu === 0) bezDanych++
    }
    // Zbiór musi naprawdę obejmować oba przypadki brzegowe, inaczej test niczego nie dowodzi.
    assert.equal(lista.length, 30)
    assert.ok(zastapione >= 5, `miejsc na istniejącym punkcie: ${zastapione}`)
    assert.ok(bezDanych >= 2, `miejsc poza danymi o popycie: ${bezDanych}`)
  })
}

test('przydziały w całym indeksie zgadzają się z przeliczeniem pełnym', () => {
  const { dane, uslugi } = zbior(11)
  const indeks = zbudujIndeks(przygotujKomorki(dane), uslugi, 800)
  const bazowe = obliczBazowePunkty(dane, uslugi, 800)
  assert.equal(bazowe.length, uslugi.length)
  bazowe.forEach((v, j) => assert.ok(bliskie(indeks.przydzialPopytu[j] as number, v)))
  const bilans = bilansPopytu(dane, uslugi, 800)
  const wszystkie = dane.reduce((s, c) => s + c[3], 0)
  assert.ok(bliskie(bilans.przydzielone + bilans.nieobsluzone, wszystkie))
})

test('udziały popytu w zasięgu miejsca sumują się do liczby adresów w zasięgu (#107)', () => {
  for (const ziarno of [5, 6]) {
    const { dane, uslugi } = zbior(ziarno)
    const indeks = zbudujIndeks(przygotujKomorki(dane), uslugi, 800)
    for (const m of miejsca(ziarno, dane, uslugi)) {
      const ocena = ocenMiejsceWIndeksie(indeks, m)
      const pelna = ocenaPelna(dane, uslugi, 800, m)
      // Niezależnie liczone udziały konkurentów + udział miejsca = wszystkie adresy zasięgu.
      assert.ok(
        bliskie(pelna.adresyKonkurentow + ocena.przydzieloneAdresy, ocena.adresyWZasiegu),
        `${pelna.adresyKonkurentow} + ${ocena.przydzieloneAdresy} != ${ocena.adresyWZasiegu}`,
      )
      // I to, co karta pokazuje: dwie liczby całkowite i dwa procenty, bez zgubionej sztuki.
      const rozbicie = rozbicieZasiegu(ocena)
      assert.equal(rozbicie.toMiejsce + rozbicie.konkurenci, rozbicie.adresyWZasiegu)
      assert.equal(rozbicie.adresyWZasiegu, Math.round(ocena.adresyWZasiegu))
      assert.equal(
        rozbicie.procentToMiejsce + rozbicie.procentKonkurenci,
        rozbicie.adresyWZasiegu > 0 ? 100 : 0,
      )
      assert.ok(rozbicie.toMiejsce >= 0 && rozbicie.konkurenci >= 0)
    }
  }
})

test('rozbicie zasięgu bez adresów i przy pełnym przejęciu', () => {
  const pusta = rozbicieZasiegu(ocenaZ({ adresyWZasiegu: 0, przydzieloneAdresy: 0 }))
  assert.deepEqual(pusta, {
    adresyWZasiegu: 0,
    toMiejsce: 0,
    konkurenci: 0,
    procentToMiejsce: 0,
    procentKonkurenci: 0,
  })
  const monopol = rozbicieZasiegu(ocenaZ({ adresyWZasiegu: 42, przydzieloneAdresy: 42 }))
  assert.equal(monopol.konkurenci, 0)
  assert.equal(monopol.procentToMiejsce, 100)
  assert.equal(monopol.procentKonkurenci, 0)
  // Nadmiar z zaokrągleń nie robi ujemnych adresów konkurencji.
  const nadmiar = rozbicieZasiegu(ocenaZ({ adresyWZasiegu: 10, przydzieloneAdresy: 10.4 }))
  assert.equal(nadmiar.konkurenci, 0)
})

// ── Pozycja i czynniki słowami ───────────────────────────────────────────────────────────

function ocenaZ(czesc: Partial<OcenaMiejsca>): OcenaMiejsca {
  return {
    adresyWZasiegu: 1000,
    mieszkancyWZasiegu: 1500,
    kursySzczytSrednio: 3,
    konkurenci: 6,
    przydzieloneAdresy: 150,
    przydzielonyPopyt: 400,
    udzialProcent: 15,
    percentyl: 50,
    porownanoZ: 100,
    najblizszyKonkurent: 'Lewiatan',
    odlegloscKonkurenta: 300,
    ...czesc,
  }
}

test('pasma pozycji: percentyl 0 nie jest „umiarkowany”', () => {
  assert.equal(pozycjaPercentyla(0), 'bardzo-niska')
  assert.equal(pozycjaPercentyla(19), 'bardzo-niska')
  assert.equal(pozycjaPercentyla(20), 'niska')
  assert.equal(pozycjaPercentyla(39), 'niska')
  assert.equal(pozycjaPercentyla(40), 'umiarkowana')
  assert.equal(pozycjaPercentyla(59), 'umiarkowana')
  assert.equal(pozycjaPercentyla(60), 'wysoka')
  assert.equal(pozycjaPercentyla(79), 'wysoka')
  assert.equal(pozycjaPercentyla(80), 'bardzo-wysoka')
  assert.equal(pozycjaPercentyla(100), 'bardzo-wysoka')
})

test('czynniki: percentyl 0 daje „przeciw”, nigdy „umiarkowanie”', () => {
  const czynniki = czynnikiOceny(ocenaZ({ percentyl: 0 }), 800)
  assert.ok(czynniki.some((c) => c.kierunek === 'przeciw' && /każdym istniejącym/.test(c.tekst)))
  assert.ok(!czynniki.some((c) => /umiarkowan|zbliżony/.test(c.tekst)))
  assert.ok(!czynniki.some((c) => c.kierunek === 'za' && /Przydział klientów/.test(c.tekst)))
})

test('czynniki: środek rozkładu jest neutralny, a skraje mają wyraźny znak', () => {
  const srodek = czynnikiOceny(ocenaZ({ percentyl: 50, udzialProcent: 30 }), 800)
  assert.ok(srodek.some((c) => c.kierunek === 'neutralny' && /zbliżony/.test(c.tekst)))
  const wysoki = czynnikiOceny(ocenaZ({ percentyl: 95 }), 800)
  assert.equal(wysoki[0]?.kierunek, 'za')
  const niski = czynnikiOceny(ocenaZ({ percentyl: 5 }), 800)
  assert.equal(niski[0]?.kierunek, 'przeciw')
})

test('czynniki: zawsze 2–3 pozycje, dla każdej kombinacji progów', () => {
  for (const percentyl of [null, 0, 10, 25, 45, 55, 70, 85, 100])
    for (const konkurenci of [0, 1, 4, 30])
      for (const udzialProcent of [0, 5, 20, 60, 100])
        for (const odlegloscKonkurenta of [null, 40, 300, 700])
          for (const kursySzczytSrednio of [0, 0.5, 2, 6, 20]) {
            const ocena = ocenaZ({
              percentyl,
              konkurenci,
              udzialProcent,
              odlegloscKonkurenta: konkurenci === 0 ? null : odlegloscKonkurenta,
              kursySzczytSrednio,
            })
            const czynniki = czynnikiOceny(ocena, 800)
            assert.ok(
              czynniki.length >= 2 && czynniki.length <= 3,
              `${czynniki.length} czynników dla ${JSON.stringify(ocena)}`,
            )
            for (const c of czynniki) {
              assert.ok(c.tekst.length > 10)
              assert.ok(!c.tekst.includes(PAUZA))
            }
          }
})

test('czynniki: brak konkurencji i konkurent tuż obok', () => {
  const brak = czynnikiOceny(
    ocenaZ({ konkurenci: 0, odlegloscKonkurenta: null, percentyl: 60 }),
    1000,
  )
  assert.ok(brak.some((c) => c.kierunek === 'za' && /promieniu 1000 m/.test(c.tekst)))
  const obok = czynnikiOceny(
    ocenaZ({ odlegloscKonkurenta: 60, najblizszyKonkurent: 'Żabka', percentyl: 50 }),
    800,
  )
  assert.ok(obok.some((c) => c.kierunek === 'przeciw' && /Żabka, 60 m/.test(c.tekst)))
  const daleko = czynnikiOceny(ocenaZ({ odlegloscKonkurenta: 700, percentyl: 50 }), 800)
  assert.ok(daleko.some((c) => c.kierunek === 'za' && /dopiero 700 m/.test(c.tekst)))
  assert.ok(PROGI_CZYNNIKOW.konkurentBlisko < PROGI_CZYNNIKOW.konkurentDaleko)
})

test('czynniki: miejsce poza danymi o popycie wprost to mówi', () => {
  const czynniki = czynnikiOceny(
    ocenaZ({ adresyWZasiegu: 0, percentyl: null, konkurenci: 0, odlegloscKonkurenta: null }),
    800,
  )
  assert.equal(czynniki[0]?.kierunek, 'przeciw')
  assert.match(czynniki[0]?.tekst ?? '', /nie ma żadnego adresu/)
})

test('kursy słowami: ułamek w dopełniaczu liczby pojedynczej, całkowite po liczebniku', () => {
  assert.equal(kursyZeSlowem(23.2), '23,2 kursu')
  assert.equal(kursyZeSlowem(0.4), '0,4 kursu')
  assert.equal(kursyZeSlowem(5), '5 kursów')
  assert.equal(kursyZeSlowem(5.04), '5 kursów')
  assert.equal(kursyZeSlowem(1), '1 kurs')
  assert.equal(kursyZeSlowem(2), '2 kursy')
  assert.equal(kursyZeSlowem(12), '12 kursów')
  assert.equal(kursyZeSlowem(22), '22 kursy')
  const czynniki = czynnikiOceny(ocenaZ({ kursySzczytSrednio: 23.2, percentyl: 50 }), 800)
  assert.ok(czynniki.some((c) => c.tekst.includes('średnio 23,2 kursu w porannym szczycie')))
  const slabe = czynnikiOceny(ocenaZ({ kursySzczytSrednio: 0.4, percentyl: 50 }), 800)
  assert.ok(slabe.some((c) => c.kierunek === 'przeciw' && /średnio 0,4 kursu/.test(c.tekst)))
})
