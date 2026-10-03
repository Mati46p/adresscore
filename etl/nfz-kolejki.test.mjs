import assert from 'node:assert/strict'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { do2180 } from './lib/geo.mjs'
import { CACHE, DANE, wczytajAdresy } from './lib/wspolne.mjs'
import {
  czlonyUlicy,
  etykietyKolejek,
  ID,
  indeksAdresow,
  kontrolaNiezalezna,
  liczebnik,
  mediana,
  parsujAdres,
  policzWartosci,
  SPECJALNOSCI,
  ulicaZgodna,
  wybierzWiersze,
  zbudujPoradnie,
  znajdzAdres,
} from './nfz-kolejki.mjs'

const PAUZA = String.fromCharCode(0x2014)

// ---------- adresy NFZ ----------

test('parsujAdres: numer domu, litera, zakres, lokal i dopiski', () => {
  const nr = (adres) => parsujAdres(adres).nr
  assert.equal(nr('UL. DŁUGA 38/219'), '38')
  assert.equal(nr('UL. GRZEGÓRZECKA 67 C'), '67c')
  assert.equal(nr('UL. STRZELECKA 2 - 2A'), '2')
  assert.equal(nr('UL. WROCŁAWSKA 1-3'), '1')
  assert.equal(nr('UL. PODLESIE 173/A'), '173')
  assert.equal(nr('UL. KOLOROWE 21/BRAK'), '21')
  assert.equal(nr('PARK KINGI 1 BUD. I'), '1')
  assert.equal(nr('UL. OCHOTA 4ZW'), '4zw')
  assert.equal(parsujAdres('UL. OCHOTA 4ZW').nrBazowy, '4')
  // numer w nazwie ulicy nie jest numerem domu
  assert.deepEqual(parsujAdres('UL. 29 LISTOPADA 46'), {
    ulica: 'UL. 29 LISTOPADA',
    nr: '46',
    nrBazowy: '46',
  })
  assert.deepEqual(parsujAdres('OSIEDLE DYWIZJONU 303 2'), {
    ulica: 'OSIEDLE DYWIZJONU 303',
    nr: '2',
    nrBazowy: '2',
  })
  assert.equal(parsujAdres('UL. KOPERNIKA').nr, null)
  assert.equal(parsujAdres(null).nr, null)
})

test('czlonyUlicy i ulicaZgodna: rodzaj ulicy, imię, inicjał i tytuł; sam skrót nie wystarcza', () => {
  assert.deepEqual(czlonyUlicy('UL. AL. F. FOCHA'), ['f', 'focha'])
  assert.deepEqual(czlonyUlicy('UL. UL. BOTANICZNA'), ['botaniczna'])
  const zgodna = (a, b) => ulicaZgodna(czlonyUlicy(a), czlonyUlicy(b))
  assert.ok(zgodna('UL. KOPERNIKA', 'Mikołaja Kopernika'))
  assert.ok(zgodna('UL. AL. F. FOCHA', 'Aleja Marszałka Ferdinanda Focha'))
  assert.ok(zgodna('UL. KS. J. POPIEŁUSZKI', 'Księdza Jerzego Popiełuszki'))
  assert.ok(zgodna('UL. OS. KOLOROWE', 'Osiedle Kolorowe'))
  assert.ok(zgodna('UL. ŚW. ŁAZARZA', 'św. Łazarza'))
  assert.ok(!zgodna('UL. KOPERNIKA', 'Marii Skłodowskiej-Curie'))
  assert.ok(!zgodna('UL. DŁUGA', 'Długosza'))
  // „park” to początek „parkowa”, ale żaden człon nie jest równy w całości
  assert.ok(!zgodna('PARK', 'Parkowa'))
  assert.ok(!ulicaZgodna([], ['kopernika']))
})

// ---------- wybór wierszy ----------

const wiersz = (nad = {}) => ({
  id: 'x',
  swiadczenie: 'ŚWIADCZENIA Z ZAKRESU OKULISTYKI',
  przypadek: 1,
  oddzial: '07',
  swiadczeniodawca_kod: '123',
  swiadczeniodawca: 'PRZYCHODNIA TESTOWA SPÓŁKA Z O.O.',
  miejsce: 'PORADNIA OKULISTYCZNA',
  miejscowosc: 'KRAKÓW',
  adres: 'UL. DŁUGA 38',
  oczekujacych: 10,
  srednio_dni: 30,
  okres: '2026-06',
  ...nad,
})

test('wybierzWiersze: przypadek stabilny, 12 specjalności, dorośli, czas i najnowszy okres', () => {
  const wejscie = [
    wiersz(),
    wiersz({ przypadek: 2 }), // pilny
    wiersz({ swiadczenie: 'ŚWIADCZENIA Z ZAKRESU ONKOLOGII' }), // świadomie pominięte
    wiersz({ swiadczenie: 'TOMOGRAFIA KOMPUTEROWA', miejsce: 'PRACOWNIA TOMOGRAFII' }),
    wiersz({ swiadczenie: 'ŚWIADCZENIA Z ZAKRESU KARDIOLOGII' }), // nieznana grupa
    wiersz({ miejsce: 'ODDZIAŁ OKULISTYCZNY' }), // nie poradnia
    wiersz({ miejsce: 'PORADNIA OKULISTYCZNA DLA DZIECI' }),
    wiersz({ miejsce: 'PORADNIA DIABETOLOGICZNA DLA KOBIET CIĘŻARNYCH' }),
    wiersz({ swiadczeniodawca: 'UNIWERSYTECKI SZPITAL DZIECIĘCY W KRAKOWIE' }), // poradnia nie mówi „dla dzieci”
    wiersz({ srednio_dni: null }),
    wiersz({ srednio_dni: -1 }),
    wiersz({ okres: '2026-05' }),
    wiersz({ srednio_dni: 0, miejsce: 'GABINET OKULISTYCZNY' }), // zero to zmierzona wartość
  ]
  const { wybrane, bilans } = wybierzWiersze(wejscie)
  assert.equal(wybrane.length, 2)
  assert.deepEqual(
    wybrane.map((w) => [w.specjalnosc, w.srednio_dni]),
    [
      ['okulistyka', 30],
      ['okulistyka', 0],
    ],
  )
  assert.equal(bilans.okres, '2026-06')
  assert.equal(bilans.innyPrzypadek, 1)
  assert.equal(bilans.pominieteGrupy, 2)
  assert.deepEqual([...bilans.nieznaneGrupy], [['ŚWIADCZENIA Z ZAKRESU KARDIOLOGII', 1]])
  assert.equal(bilans.nieporadnia, 1)
  assert.equal(bilans.innaPopulacja, 3)
  assert.equal(bilans.bezCzasu, 2)
  assert.equal(bilans.starszyOkres, 1)
})

test('SPECJALNOSCI: 12 specjalności o różnych nazwach, klucze bez ogonków', () => {
  assert.equal(SPECJALNOSCI.size, 12)
  assert.equal(new Set(SPECJALNOSCI.values()).size, 12)
  assert.ok(SPECJALNOSCI.has('swiadczenia z zakresu gruzlicy i chorob pluc'))
})

// ---------- położenie poradni ----------

const adres = (i, miejscowosc, ulica, nr, lon, lat, gmina = miejscowosc) => ({
  i,
  id: `a${i}`,
  miejscowosc,
  ulica,
  nr,
  lon,
  lat,
  gmina,
  teryt: '1261011',
})

const ADRESY = [
  adres(0, 'Kraków', 'Mikołaja Kopernika', '23', 19.9371, 50.0614),
  adres(1, 'Kraków', 'Aleja Marszałka Ferdinanda Focha', '6', 19.9201, 50.0602),
  adres(2, 'Kraków', 'Osiedle Złotej Jesieni', '1', 20.0301, 50.0801),
  adres(3, 'Kraków', 'Olszańska', '5A', 19.9701, 50.0501),
  adres(4, 'Kraków', 'Olszańska', '5B', 19.97015, 50.05015),
  adres(5, 'Kraków', 'Prądnicka', '35', 19.9301, 50.0801),
  adres(6, 'Kraków', 'Długa', '38', 19.9401, 50.0701),
  adres(7, 'Kraków', 'Długa', '38', 19.9801, 50.0701), // ta sama ulica i numer ok. 2,9 km dalej
  adres(8, 'Zagórze', null, '226', 20.1833, 49.9777, 'Niepołomice'),
  adres(9, 'Mogilany', 'Rynek', '4', 19.9401, 49.9601),
  adres(10, 'Skawina', 'Tyniecka', '15', 19.8201, 49.9701),
]

test('znajdzAdres: ulica z numerem, numer bazowy, dopisek dzielnicy i nazwa skrócona', () => {
  const indeks = indeksAdresow(ADRESY)
  const idDla = (miejscowosc, adresNfz) => znajdzAdres(miejscowosc, adresNfz, indeks)
  const kopernik = idDla('KRAKÓW-ŚRÓDMIEŚCIE', 'UL. KOPERNIKA 23')
  assert.equal(kopernik.adres.id, 'a0')
  assert.equal(kopernik.tryb, 'numer')
  assert.equal(idDla('KRAKÓW', 'UL. AL. F. FOCHA 6').adres.id, 'a1')
  assert.equal(idDla('KRAKÓW-NOWA HUTA', 'OSIEDLE ZŁOTEJ JESIENI 1').adres.id, 'a2')
  assert.equal(idDla('MOGILANY', 'RYNEK 4').adres.id, 'a9')
  assert.equal(idDla('SKAWINA', 'UL. TYNIECKA 15').adres.id, 'a10')
  // „5G” nie istnieje, ale 5A i 5B leżą tuż obok siebie: numer bazowy wystarcza
  const olszanska = idDla('KRAKÓW', 'UL. OLSZAŃSKA 5G')
  assert.equal(olszanska.tryb, 'numer bazowy')
  assert.ok(['a3', 'a4'].includes(olszanska.adres.id))
  // lokal i zakres nie zmieniają budynku
  assert.equal(idDla('KRAKÓW', 'UL. PRĄDNICKA 35/12').adres.id, 'a5')
  assert.equal(idDla('KRAKÓW', 'UL. PRĄDNICKA 35-37').adres.id, 'a5')
})

test('znajdzAdres: brak numeru, nieznany adres, miejscowość poza obszarem i niejednoznaczność', () => {
  const indeks = indeksAdresow(ADRESY)
  assert.deepEqual(znajdzAdres('KRAKÓW', 'UL. KOPERNIKA', indeks), { brak: 'bez numeru' })
  // numer 37 nie istnieje przy Prądnickiej, a inna ulica o tym numerze nie może go zastąpić
  assert.deepEqual(znajdzAdres('KRAKÓW', 'UL. PRĄDNICKA 37', indeks), { brak: 'nie znaleziono' })
  assert.deepEqual(znajdzAdres('KRAKÓW', 'UL. KOPERNIKA 24', indeks), { brak: 'nie znaleziono' })
  assert.deepEqual(znajdzAdres('TARNÓW', 'UL. KRAKOWSKA 32', indeks), { brak: 'poza obszarem' })
  assert.deepEqual(znajdzAdres(null, 'UL. KRAKOWSKA 32', indeks), { brak: 'poza obszarem' })
  // dwa punkty tej samej ulicy i numeru kilka kilometrów od siebie: nie zgadujemy
  assert.deepEqual(znajdzAdres('KRAKÓW', 'UL. DŁUGA 38', indeks), { brak: 'niejednoznaczne' })
})

test('znajdzAdres: wieś numerowana tylko z adresem bez ulicy, homonim z ulicą odrzucony', () => {
  const indeks = indeksAdresow(ADRESY)
  const wies = znajdzAdres('ZAGÓRZE', 'ZAGÓRZE 226', indeks)
  assert.equal(wies.adres.id, 'a8')
  assert.equal(wies.tryb, 'wieś bez ulic')
  // NFZ podaje ulicę, której Zagórze z punktów adresowych nie ma: to inna wieś o tej nazwie
  assert.deepEqual(znajdzAdres('ZAGÓRZE', 'UL. MARSZ. JÓZEFA PIŁSUDSKIEGO 226', indeks), {
    brak: 'nie znaleziono',
  })
  // miasto z ulicami nie ma „wsi bez ulic”: sam numer nie wystarcza
  assert.deepEqual(znajdzAdres('KRAKÓW', 'KRAKÓW 23', indeks), { brak: 'nie znaleziono' })
})

test('zbudujPoradnie: jedna poradnia na świadczeniodawcę, punkt i specjalność; bilans dopasowania', () => {
  const indeks = indeksAdresow(ADRESY)
  const { wybrane } = wybierzWiersze([
    wiersz({ adres: 'UL. KOPERNIKA 23', srednio_dni: 10 }),
    // ta sama poradnia pod drugą nazwą miejsca: mediana, nie dwie poradnie
    wiersz({ adres: 'UL. KOPERNIKA 23', miejsce: 'PORADNIA OKULISTYCZNA I', srednio_dni: 30 }),
    // inny świadczeniodawca w tym samym budynku to osobna poradnia
    wiersz({ adres: 'UL. KOPERNIKA 23', swiadczeniodawca_kod: '999', srednio_dni: 50 }),
    wiersz({ adres: 'UL. PRĄDNICKA 37' }), // w obszarze, bez położenia
    wiersz({ miejscowosc: 'TARNÓW', adres: 'UL. KRAKOWSKA 32' }), // poza obszarem
  ])
  const { poradnie, bilans } = zbudujPoradnie(wybrane, indeks)
  assert.equal(poradnie.length, 2)
  assert.deepEqual(
    poradnie.map((p) => p.dni).sort((a, b) => a - b),
    [20, 50],
  )
  assert.equal(poradnie[0].specjalnosc, 'okulistyka')
  assert.equal(bilans.miejsc, 3)
  assert.equal(bilans.wObszarze, 2)
  assert.equal(bilans.dopasowane, 1)
  assert.equal(bilans.wierszyWObszarze, 4)
  assert.equal(bilans.wierszyDopasowanych, 3)
  assert.deepEqual(bilans.niedopasowane, ['KRAKÓW, UL. PRĄDNICKA 37 (nie znaleziono)'])
})

// ---------- wartości w promieniu ----------

const BAZA = { lon: 19.94, lat: 50.06 }
/** Poradnia `m` metrów na wschód od bazy (przeliczenie stopni tylko do budowy danych testowych). */
const poradnia = (specjalnosc, dni, m) => {
  const lon = BAZA.lon + m / (111_195 * Math.cos((BAZA.lat * Math.PI) / 180))
  const [x, y] = do2180(lon, BAZA.lat)
  return { specjalnosc, dni, x, y, lon, lat: BAZA.lat }
}
const adresyTestowe = (...przesuniecia) =>
  przesuniecia.map((m, i) => ({
    i,
    lon: BAZA.lon + m / (111_195 * Math.cos((BAZA.lat * Math.PI) / 180)),
    lat: BAZA.lat,
  }))

test('mediana i liczebnik', () => {
  assert.equal(mediana([5]), 5)
  assert.equal(mediana([3, 1, 2]), 2)
  assert.equal(mediana([1, 2, 3, 4]), 2.5)
  assert.equal(mediana([]), null)
  assert.deepEqual(
    [1, 2, 5, 12, 22, 112].map((n) => liczebnik(n, 'a', 'b', 'c')),
    ['a', 'b', 'c', 'c', 'b', 'c'],
  )
})

test('policzWartosci: mediana po specjalnościach, zero zostaje zerem, 3 km i minimum 3 specjalności', () => {
  const poradnie = [
    poradnia('okulistyka', 100, 500),
    poradnia('okulistyka', 200, 1000), // mediana okulistyki 150
    poradnia('neurologia', 60, 2000),
    poradnia('urologia', 0, 2900), // zmierzone zero, nie brak
    poradnia('laryngologia', 20, 3100), // poza promieniem
  ]
  const adresy = adresyTestowe(0, 10_000, 3000)
  const { wartosci, k, n } = policzWartosci(adresy, poradnie)
  // mediana z [150, 60, 0] = 60; laryngologia (3,1 km) nie wchodzi
  assert.equal(wartosci[0], 60)
  assert.equal(k[0], 3)
  assert.equal(n[0], 4)
  // daleko od wszystkiego: brak danych, nie zero
  assert.equal(wartosci[1], null)
  assert.equal(k[1], 0)
  // 3 km na wschód: okulistyka (2,5 km), neurologia (1 km), laryngologia (0,1 km), urologia (0,1 km
  // od zachodniej strony) – cztery specjalności, mediana z [150, 60, 20, 0] = 40
  assert.equal(wartosci[2], 40)
  assert.equal(k[2], 4)
})

test('policzWartosci: poniżej 3 specjalności wartości nie ma, a zaokrąglenie idzie do pełnego dnia', () => {
  const dwie = [poradnia('okulistyka', 10, 100), poradnia('neurologia', 20, 200)]
  const wynik = policzWartosci(adresyTestowe(0), dwie)
  assert.equal(wynik.wartosci[0], null)
  assert.equal(wynik.k[0], 2)
  const cztery = [
    poradnia('okulistyka', 10, 100),
    poradnia('neurologia', 15, 200),
    poradnia('urologia', 20, 300),
    poradnia('laryngologia', 25, 400),
  ]
  // mediana z [10, 15, 20, 25] = 17,5 → 18
  assert.equal(policzWartosci(adresyTestowe(0), cztery).wartosci[0], 18)
  assert.throws(() => policzWartosci(adresyTestowe(0), []), /Brak poradni/)
})

test('etykietyKolejek: słownik zamyka się, klucze są krótkie i stałe, odmiana polska', () => {
  const wynik = {
    wartosci: [60, 60, null, null, 80],
    k: [3, 3, 0, 2, 12],
    n: [4, 4, 0, 5, 22],
  }
  const { etykiety, slownik } = etykietyKolejek(wynik)
  assert.equal(etykiety.length, 5)
  assert.equal(etykiety[0], etykiety[1])
  for (const e of etykiety) assert.ok(slownik[e], `brak wpisu ${e}`)
  assert.ok(Object.keys(slownik).every((klucz) => klucz.length <= 2))
  assert.equal(slownik[etykiety[0]], '3 specjalności, 4 poradnie w promieniu 3 km')
  assert.equal(slownik[etykiety[4]], '12 specjalności, 22 poradnie w promieniu 3 km')
  assert.equal(slownik[etykiety[2]], 'Brak poradni z danymi NFZ w promieniu 3 km')
  assert.match(slownik[etykiety[3]], /tylko 2 specjalności \(potrzeba co najmniej 3\)/)
  // te same dane dają te same klucze
  assert.deepEqual(etykietyKolejek(wynik), { etykiety, slownik })
  const jedna = etykietyKolejek({ wartosci: [null], k: [1], n: [1] })
  assert.match(jedna.slownik[jedna.etykiety[0]], /tylko 1 specjalność /)
  const pojedyncza = etykietyKolejek({ wartosci: [70], k: [5], n: [1] })
  assert.equal(
    pojedyncza.slownik[pojedyncza.etykiety[0]],
    '5 specjalności, 1 poradnia w promieniu 3 km',
  )
})

test('kontrolaNiezalezna: zgadza się z indeksem przestrzennym i wykrywa podmienioną wartość', () => {
  const poradnie = [
    poradnia('okulistyka', 100, 500),
    poradnia('neurologia', 60, 2000),
    poradnia('urologia', 0, 2500),
    poradnia('laryngologia', 20, 6000),
  ]
  const adresy = adresyTestowe(0, 800, 1600, 4000, 9000, 20_000)
  const wynik = policzWartosci(adresy, poradnie)
  const ok = kontrolaNiezalezna(adresy, poradnie, wynik, { liczba: adresy.length })
  assert.equal(ok.sprawdzone, adresy.length)
  assert.deepEqual(ok.rozbieznosci, [])
  const zepsute = { ...wynik, wartosci: wynik.wartosci.map((v) => (v === null ? null : v + 7)) }
  const zle = kontrolaNiezalezna(adresy, poradnie, zepsute, { liczba: adresy.length })
  assert.ok(zle.rozbieznosci.length >= 1)
})

// ---------- opublikowany wskaźnik ----------

const SCIEZKA = join(DANE, 'wskazniki', `${ID}.json`)

test('opublikowany wskaźnik: kontrakt, rozmiar, atrybucja NFZ i z-dykty, typografia PL', () => {
  const { wersja, adresy } = wczytajAdresy()
  const p = JSON.parse(readFileSync(SCIEZKA, 'utf8'))
  assert.equal(p.wersjaAdresow, wersja)
  assert.equal(p.wartosci.length, adresy.length)
  assert.ok(statSync(SCIEZKA).size < 2_000_000, 'plik wskaźnika poniżej 2 MB')
  // całe dni, nigdy ujemne; brak danych to null
  assert.ok(p.wartosci.every((v) => v === null || (Number.isInteger(v) && v >= 0)))
  const zDanymi = p.wartosci.filter((v) => v !== null).length
  assert.ok(zDanymi > 0.3 * adresy.length && zDanymi < 0.7 * adresy.length, `pokrycie ${zDanymi}`)

  const m = p.meta
  assert.equal(m.id, 'nfz_kolejki_dni')
  assert.equal(m.kategoria, 'kontekst')
  assert.equal(m.kierunek, 'mniej-lepiej')
  assert.equal(m.rozdzielczosc, 'adres')
  assert.equal(m.jednostka, 'dni')
  assert.equal(m.zadanie, 138)
  assert.equal(m.atrapa, undefined)
  assert.deepEqual(m.zakres, [0, 200])
  assert.match(m.opis, /3 km/)
  assert.match(m.opis, /przypadek stabilny/)
  assert.match(m.opis, /brak wartości/i)

  assert.equal(m.zrodla.length, 3)
  const nfz = m.zrodla[0]
  assert.equal(nfz.url, 'https://api.nfz.gov.pl/app-itl-api/')
  assert.match(nfz.nazwa, /Narodowy Fundusz Zdrowia/)
  assert.match(nfz.nazwa, /przetworzone przez z-dykty\.pl \(CC BY 4\.0\)/)
  assert.match(nfz.licencja, /CC BY 4\.0/)
  assert.match(nfz.dataDanych, /^\d{4}-\d{2}$/)
  assert.match(nfz.pobrano, /^\d{4}-\d{2}-\d{2}$/)
  assert.equal(m.zrodla.filter((z) => /msip/i.test(z.url)).length, 1)
  assert.equal(m.zrodla.filter((z) => /geoportal/i.test(z.url)).length, 1)
  for (const z of m.zrodla.slice(1)) assert.match(z.nazwa, /^Położenie poradni: /)
  // typografia PL: półpauza ze spacjami, nigdy pauza
  assert.ok(!JSON.stringify(p.meta).includes(PAUZA))
  assert.ok(!JSON.stringify(p.slownikEtykiet).includes(PAUZA))
})

test('opublikowany wskaźnik: etykiety ze słownika opisują dokładnie to, co jest w wartości', () => {
  const { adresy } = wczytajAdresy()
  const p = JSON.parse(readFileSync(SCIEZKA, 'utf8'))
  assert.equal(p.etykiety.length, adresy.length)
  for (let i = 0; i < adresy.length; i++) {
    const opis = p.slownikEtykiet[p.etykiety[i]]
    assert.ok(opis, `adres ${i}: etykieta bez wpisu w słowniku`)
    if (p.wartosci[i] === null) assert.match(opis, /^(Brak poradni|W promieniu 3 km tylko)/)
    else {
      const k = Number(/^(\d+) specjalno/.exec(opis)?.[1])
      const n = Number(/, (\d+) poradni/.exec(opis)?.[1])
      assert.ok(k >= 3 && k <= SPECJALNOSCI.size, `adres ${i}: ${opis}`)
      assert.ok(n >= k, `adres ${i}: poradni mniej niż specjalności (${opis})`)
    }
  }
})

test('opublikowany wskaźnik: centrum Krakowa ma pełny zestaw specjalności, odległa wieś brak danych', () => {
  const { adresy } = wczytajAdresy()
  const p = JSON.parse(readFileSync(SCIEZKA, 'utf8'))
  const znajdz = (gmina, miejscowosc, ulica) => {
    const a = adresy.find(
      (x) =>
        x.gmina === gmina && x.miejscowosc === miejscowosc && (ulica ? x.ulica === ulica : true),
    )
    assert.ok(a, `brak adresu ${gmina}, ${miejscowosc}, ${ulica}`)
    return a
  }
  const rynek = znajdz('Kraków', 'Kraków', 'Rynek Główny')
  assert.ok(p.wartosci[rynek.i] > 0)
  assert.match(p.slownikEtykiet[p.etykiety[rynek.i]], /^12 specjalności/)
  // gmina bez żadnej poradni z położeniem w promieniu 3 km: brak danych, a nie zero
  const wies = adresy.filter((a) => a.gmina === 'Igołomia-Wawrzeńczyce')
  assert.ok(wies.length > 1000 && wies.every((a) => p.wartosci[a.i] === null))
  assert.equal(
    p.slownikEtykiet[p.etykiety[wies[0].i]],
    'Brak poradni z danymi NFZ w promieniu 3 km',
  )
})

const CACHE_NFZ = join(CACHE, 'nfz-kolejki', 'nfz_kolejki_woj12.json')
test('opublikowany wskaźnik zgadza się z przeliczeniem surowych danych (gdy są w etl/.cache)', {
  skip: !existsSync(CACHE_NFZ) && 'brak etl/.cache/nfz-kolejki (uruchom node etl/nfz-kolejki.mjs)',
}, () => {
  const { adresy } = wczytajAdresy()
  const p = JSON.parse(readFileSync(SCIEZKA, 'utf8'))
  const { wiersze } = JSON.parse(readFileSync(CACHE_NFZ, 'utf8'))
  const { wybrane } = wybierzWiersze(wiersze)
  const { poradnie } = zbudujPoradnie(wybrane, indeksAdresow(adresy))
  const wynik = policzWartosci(adresy, poradnie)
  assert.deepEqual(wynik.wartosci, p.wartosci)
  const kontrola = kontrolaNiezalezna(adresy, poradnie, wynik, { liczba: 1500 })
  assert.deepEqual(kontrola.rozbieznosci, [])
  assert.ok(kontrola.sprawdzone >= 1000)
})
