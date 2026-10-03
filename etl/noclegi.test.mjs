import assert from 'node:assert/strict'
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { DANE, wczytajAdresy } from './lib/wspolne.mjs'
import {
  bezPowtorzonychLokali,
  csvSredniki,
  czlonyUlicy,
  dekodujCp1250,
  geokoduj,
  indeksAdresow,
  kontrolaNiezalezna,
  metry,
  norm,
  nrNorm,
  obiektyKoh,
  obiektyKon,
  sumaMiejsc,
  ulicaZgodna,
  wierszeCwoh,
  wierszeGmin,
  wspolneAdresyKonKoh,
  wspolrzedneCwoh,
} from './noclegi.mjs'

const blisko = (a, b, tolerancja) =>
  assert.ok(Math.abs(a - b) <= tolerancja, `${a} oczekiwano ${b} ± ${tolerancja}`)

test('normalizacja: ogonki, interpunkcja i numery z odstępem', () => {
  assert.equal(norm('Łódź, ul. Świętego-Krzyża 3/5'), 'lodz ul swietego krzyza 3 5')
  assert.equal(nrNorm('15 H'), '15h')
  assert.equal(nrNorm(' 2A '), '2a')
  assert.deepEqual(czlonyUlicy('ul. G. Narutowicza'), ['g', 'narutowicza'])
  assert.deepEqual(czlonyUlicy('pl. Kościuszki'), ['plac', 'kosciuszki'])
  assert.deepEqual(czlonyUlicy('ulica Kościuszki'), ['kosciuszki'])
})

test('zgodność ulicy liczona od końca nazwy, z inicjałami, bez pomylenia placu z ulicą', () => {
  assert.ok(ulicaZgodna(['krakowska'], ['krakowska']))
  assert.ok(ulicaZgodna(['kosciuszki'], ['tadeusza', 'kosciuszki']))
  assert.ok(ulicaZgodna(['g', 'narutowicza'], ['gabriela', 'narutowicza']))
  assert.ok(ulicaZgodna(['wierzynka'], ['mikolaja', 'wierzynka']))
  // „Kościuszki" pasuje i do ulicy, i do placu – rozstrzyga odległość, nie nazwa
  assert.ok(ulicaZgodna(['kosciuszki'], ['plac', 'kosciuszki']))
  // jawny „plac" nie jest ulicą Tadeusza Kościuszki
  assert.ok(!ulicaZgodna(['plac', 'kosciuszki'], ['tadeusza', 'kosciuszki']))
  assert.ok(!ulicaZgodna(['zeromskiego'], ['mickiewicza']))
  assert.ok(!ulicaZgodna(['w', 'narutowicza'], ['gabriela', 'narutowicza']))
  assert.ok(!ulicaZgodna([], ['krakowska']))
})

test('odległość na elipsoidzie GRS80 zgadza się z długościami stopnia na 50°N', () => {
  // Podręcznikowe wartości dla GRS80/WGS84: 1° szerokości = 111 229 m, 1° długości = 71 696 m.
  blisko(metry(50, 20, 50.001, 20), 111.229, 0.01)
  blisko(metry(50, 20, 50, 20.001), 71.696, 0.01)
  blisko(metry(50, 20, 50, 20), 0, 1e-9)
})

test('suma miejsc w promieniu 300 m: granica, kierunki i zero zamiast braku danych', () => {
  const adres = { lon: 20, lat: 50 }
  const obiekty = [
    { lon: 20.004, lat: 50, miejsca: 10 }, // 286,8 m na wschód
    { lon: 20.0042, lat: 50, miejsca: 100 }, // 301,1 m – poza promieniem
    { lon: 20, lat: 50.0026, miejsca: 1000 }, // 289,2 m na północ
    { lon: 20, lat: 50.0027, miejsca: 10000 }, // 300,3 m – poza promieniem
    { lon: 20.002, lat: 50.0015, miejsca: 5 }, // 220 m
  ]
  assert.deepEqual(sumaMiejsc([adres, { lon: 21, lat: 51 }], obiekty), [1015, 0])
  assert.deepEqual(sumaMiejsc([adres], []), [0])
  // obiekty w tym samym punkcie sumują się
  const wspolne = [
    { lon: 20, lat: 50, miejsca: 4 },
    { lon: 20, lat: 50, miejsca: 6 },
  ]
  assert.deepEqual(sumaMiejsc([adres], wspolne), [10])
})

test('indeks przestrzenny zgadza się z pełnym przeglądem, a kontrola wykrywa fałszywe sumy', () => {
  let ziarno = 7
  const los = () => {
    ziarno = (ziarno * 1103515245 + 12345) % 2147483648
    return ziarno / 2147483648
  }
  const wPudelku = () => ({ lon: 19.9 + los() * 0.08, lat: 50.03 + los() * 0.06 })
  const obiekty = Array.from({ length: 150 }, () => ({
    ...wPudelku(),
    miejsca: 1 + Math.floor(los() * 50),
  }))
  const adresy = Array.from({ length: 400 }, wPudelku)
  const wartosci = sumaMiejsc(adresy, obiekty)
  assert.ok(
    wartosci.filter((v) => v > 0).length > 100,
    'próba musi mieć wiele adresów z obiektem w zasięgu',
  )
  assert.ok(wartosci.includes(0), 'i wiele bez obiektu')
  assert.equal(kontrolaNiezalezna(adresy, obiekty, wartosci, 400).niezgodne, 0)
  const zepsute = wartosci.map((v) => v + 1)
  assert.ok(kontrolaNiezalezna(adresy, obiekty, zepsute, 400).niezgodne > 0)
})

test('KON: odrzuca wpisy bez geometrii i bez liczby miejsc, liczba jako tekst jest liczbą', () => {
  const f = (properties, coordinates = [19.94, 50.06]) => ({
    type: 'Feature',
    geometry: coordinates ? { type: 'Point', coordinates } : null,
    properties,
  })
  const { obiekty, bilans } = obiektyKon([
    f({ total_beds: 4, kind: 'apartament', name: 'A', street: 'Józefa', building: '30' }),
    f({ total_beds: null }),
    f({ total_beds: 0 }),
    f({ total_beds: 6 }, null),
    f({ total_beds: '12' }),
  ])
  assert.deepEqual(bilans, { wpisow: 5, bezGeometrii: 1, bezMiejsc: 2 })
  assert.deepEqual(
    obiekty.map((o) => o.miejsca),
    [4, 12],
  )
  assert.equal(obiekty[0].zrodlo, 'KON')
  assert.deepEqual([obiekty[0].lon, obiekty[0].lat], [19.94, 50.06])
})

const wpis = (fid, ulica, nr, lokal, miejsca, aktualizacja) => ({
  fid,
  ulica,
  nr,
  lokal,
  miejsca,
  aktualizacja,
  lon: 19.94,
  lat: 50.06,
})

test('KON: ten sam lokal liczony raz (najnowszy wpis), zakresy, listy i brak lokalu zostają', () => {
  const wynik = bezPowtorzonychLokali([
    wpis(1, 'Grodzka', '50', '5', 6, 1000), // stary operator tego samego lokalu
    wpis(2, 'GRODZKA', '50', '5', 4, 2000), // nowy: zostaje, choć ma mniej miejsc
    wpis(3, 'Grodzka', '50', '6', 5, 1000), // inny lokal w tym budynku
    wpis(4, 'Zamkowa', '1', '9-13', 10, 1000), // zakres opisuje grupę apartamentów
    wpis(5, 'Zamkowa', '1', '9-13', 10, 1000),
    wpis(6, 'Szlak', '77', '1, 2, 3', 20, 1000), // lista lokali
    wpis(7, 'Szlak', '77', '1, 2, 3', 20, 2000),
    wpis(8, 'Józefa', '30', null, 25, 1000), // cały budynek, bez numeru lokalu
    wpis(9, 'Józefa', '30', '', 29, 2000),
    wpis(10, 'Dąbska', '20', '67', 2, 3000), // ta sama data: wygrywa wyższy identyfikator
    wpis(11, 'Dąbska', '20', '67', 4, 3000),
    wpis(12, 'Dąbska', '21', '67', 3, 3000), // inny budynek, ten sam numer lokalu
  ])
  assert.deepEqual(
    wynik.obiekty.map((o) => o.fid),
    [2, 3, 4, 5, 6, 7, 8, 9, 11, 12],
  )
  assert.equal(wynik.usunieto, 2)
  assert.equal(wynik.usunietoMiejsc, 6 + 2)
})

test('KOH: liczba miejsc z MN_LICZBA, pominięte wpisy bez geometrii i miejsc', () => {
  const f = (properties, coordinates = [19.937, 50.0699]) => ({
    geometry: coordinates ? { type: 'Point', coordinates } : null,
    properties,
  })
  const { obiekty, bilans } = obiektyKoh([
    f({ OB_NAZWA: 'YARDEN', MN_LICZBA: 25, OB_RODZAJ: 'hotel', ULICA: 'Długa', NR_AD_XY: '35' }),
    f({ OB_NAZWA: 'BEZ MIEJSC', MN_LICZBA: null }),
    f({ OB_NAZWA: 'BEZ GEOMETRII', MN_LICZBA: 10 }, null),
  ])
  assert.deepEqual(bilans, { wpisow: 3, bezGeometrii: 1, bezMiejsc: 1 })
  assert.equal(obiekty.length, 1)
  assert.equal(obiekty[0].zrodlo, 'KOH')
  assert.equal(obiekty[0].miejsca, 25)
})

test('wspólny adres w KON i KOH rozpoznawany po ulicy i numerze, bez wrażliwości na wielkość liter', () => {
  const kon = [wpis(1, 'Długa', '35', '', 77, 1), wpis(2, 'Miodowa', '19', '5', 4, 1)]
  const koh = [wpis(1, 'DŁUGA', '35', '', 25, 1), wpis(2, 'Floriańska', '1', '', 10, 1)]
  assert.deepEqual(
    wspolneAdresyKonKoh(kon, koh).map((o) => o.miejsca),
    [25],
  )
})

test('CWOH: cp1250, cudzysłowy ze średnikiem w środku, CRLF i BOM', () => {
  // Bajty cp1250: ó = 0xF3, Ł = 0xA3, ź = 0x9F
  assert.equal(dekodujCp1250(Uint8Array.from([0x4b, 0x72, 0x61, 0x6b, 0xf3, 0x77])), 'Kraków')
  assert.equal(dekodujCp1250(Uint8Array.from([0xa3, 0xf3, 0x64, 0x9f])), 'Łódź')
  const bom = String.fromCharCode(0xfeff)
  const tekst =
    `${bom}ID;Nazwa;Rodzaj;Województwo;Powiat;Gmina;Miasto;Ulica;Numer;Lokalizacja na mapie;Liczba miejsc noclegowych\r\n` +
    'CWOH/1219044/2021/05/977;"ZAMEK ""KRÓLEWSKI""; NIEPOŁOMICE";hotel;Małopolskie;wielicki;Niepołomice;Niepołomice;Zamkowa ;2;"50.03430745, 20.2174773740667";54\r\n' +
    'CWOH/1219054/2021/05/1160;DWOREK EMILII;hotel;Małopolskie;wielicki;Wieliczka;Wieliczka;Tomaszkowice ;440;;\r\n'
  const wiersze = wierszeCwoh(tekst)
  assert.equal(wiersze.length, 2)
  assert.equal(wiersze[0].nazwa, 'ZAMEK "KRÓLEWSKI"; NIEPOŁOMICE')
  assert.equal(wiersze[0].teryt6, '121904')
  assert.equal(wiersze[0].ulica, 'Zamkowa')
  assert.equal(wiersze[0].miejsca, 54)
  assert.deepEqual(wiersze[0].xy, { lat: 50.03430745, lon: 20.2174773740667 })
  assert.equal(wiersze[1].xy, null)
  assert.equal(wiersze[1].miejsca, null)
})

test('CWOH: ucięty albo zmieniony plik jest odrzucany', () => {
  assert.throws(() => csvSredniki('a;b\r\n1;"niezamknięty'), /cudzysłów/)
  assert.throws(() => csvSredniki('a;b\r\n1;2;3\r\n'), /kolumn/)
  assert.throws(() => wierszeCwoh('id;nazwa\r\n1;2\r\n'), /schemat/)
})

test('współrzędne CWOH: szerokość, długość, tylko w Polsce', () => {
  assert.deepEqual(wspolrzedneCwoh('50.06, 19.94'), { lat: 50.06, lon: 19.94 })
  assert.deepEqual(wspolrzedneCwoh(' 50.06 ,19.94 '), { lat: 50.06, lon: 19.94 })
  assert.equal(wspolrzedneCwoh(''), null)
  assert.equal(wspolrzedneCwoh('brak'), null)
  assert.equal(wspolrzedneCwoh('0, 0'), null)
  assert.equal(wspolrzedneCwoh('19.94, 50.06'), null) // odwrócona kolejność leży poza Polską
})

const adres = (teryt, gmina, miejscowosc, ulica, nr, lon, lat) => ({
  teryt,
  gmina,
  miejscowosc,
  ulica,
  nr,
  lon,
  lat,
})

test('wiersze CWOH tylko z gmin obwarzanka; homonim z innego województwa odrzucony po TERYT', () => {
  const indeks = indeksAdresow([
    adres('1261011', 'Kraków', 'Kraków', 'Rynek Główny', '1', 19.937, 50.0617),
    adres('1206082', 'Michałowice', 'Michałowice', 'Parkurowa', '1', 19.9788, 50.1513),
  ])
  const w = (gmina, teryt6) => ({ gmina, teryt6, nazwa: gmina })
  const wynik = wierszeGmin(
    [
      w('Michałowice', '120608'),
      w('Michałowice', '142104'), // Michałowice pod Warszawą
      w('Kraków', '126101'), // Kraków pochodzi z KOH
      w('Gdańsk', '226101'),
    ],
    indeks,
  )
  assert.deepEqual(
    wynik.wiersze.map((x) => [x.gmina, x.teryt]),
    [['Michałowice', '1206082']],
  )
  assert.deepEqual(wynik.bilans, { poza: 2, homonim: 1 })
})

test('geokodowanie CWOH: adres, skrócona ulica, inicjał, wieś bez ulic i powrót do współrzędnych pliku', () => {
  const W = ['1219053', 'Wieliczka']
  const N = ['1219043', 'Niepołomice']
  const indeks = indeksAdresow([
    adres(...W, 'Wieliczka', 'Tadeusza Kościuszki', '5', 20.0474, 49.98353),
    adres(...W, 'Wieliczka', 'Plac Kościuszki', '5', 20.0617, 49.98335),
    adres(...W, 'Wieliczka', 'Gabriela Narutowicza', '1', 20.0497, 49.98984),
    adres(...W, 'Wieliczka', 'Daleka', '9', 20.2, 50.1),
    adres(...N, 'Zakrzów', null, '343', 20.1375, 50.0138),
    adres(...N, 'Zakrzów', 'Wesoła', '343', 20.14, 50.011),
    adres(...N, 'Modlnica', 'Jurajska', '2A', 19.8712, 50.128),
  ])
  const wiersz = (teryt, miasto, ulica, numer, xy) => ({ teryt, miasto, ulica, numer, xy })

  // skrócona ulica z dwoma kandydatami: wygrywa ten bliższy współrzędnym pliku
  const salin = geokoduj(
    wiersz(W[0], 'Wieliczka', 'Kościuszki', '5', { lat: 49.9835, lon: 20.0475 }),
    indeks,
  )
  assert.equal(salin.metoda, 'adres')
  assert.equal(salin.kandydatow, 2)
  assert.deepEqual([salin.lon, salin.lat], [20.0474, 49.98353])

  // inicjał zamiast imienia
  const lenart = geokoduj(
    wiersz(W[0], 'Wieliczka', 'G. Narutowicza', '1', { lat: 49.9898, lon: 20.0496 }),
    indeks,
  )
  assert.equal(lenart.metoda, 'adres')
  assert.deepEqual([lenart.lon, lenart.lat], [20.0497, 49.98984])

  // wieś bez ulic: nazwa wsi w polu ulicy, adres bez ulicy, a nie ten z ulicą „Wesoła"
  const celtycki = geokoduj(
    wiersz(N[0], 'Zakrzów', 'Zakrzów', '343', { lat: 50.0097, lon: 20.146 }),
    indeks,
  )
  assert.equal(celtycki.metoda, 'adres')
  assert.deepEqual([celtycki.lon, celtycki.lat], [20.1375, 50.0138])

  // brak adresu: współrzędne z pliku
  const brak = geokoduj(
    wiersz(W[0], 'Wieliczka', 'Tomaszkowice', '440', { lat: 49.9761, lon: 20.1009 }),
    indeks,
  )
  assert.equal(brak.metoda, 'plik')
  assert.deepEqual([brak.lon, brak.lat], [20.1009, 49.9761])

  // adres dalej niż 1 km od współrzędnych pliku nie jest wiarygodny
  const daleko = geokoduj(
    wiersz(W[0], 'Wieliczka', 'Daleka', '9', { lat: 49.98, lon: 20.05 }),
    indeks,
  )
  assert.equal(daleko.metoda, 'plik')

  // miejscowość z CWOH inna niż w adresach: ulica i numer wystarczą tylko tuż przy współrzędnych
  const blisko = geokoduj(
    wiersz(N[0], 'Czajowice', 'Jurajska', '2a', { lat: 50.1281, lon: 19.8713 }),
    indeks,
  )
  assert.equal(blisko.metoda, 'adres')
  const dalekoOdPliku = geokoduj(
    wiersz(N[0], 'Czajowice', 'Jurajska', '2a', { lat: 50.1272, lon: 19.8754 }),
    indeks,
  )
  assert.equal(dalekoOdPliku.metoda, 'plik')

  // bez adresu i bez współrzędnych nie ma lokalizacji
  assert.equal(geokoduj(wiersz(W[0], 'Wieliczka', 'Nieznana', '1', null), indeks), null)
})

test('opublikowany wskaźnik: kontrakt, pełne pokrycie zerem lub liczbą, atrybucja i data stanu CWOH', () => {
  const { wersja, adresy } = wczytajAdresy()
  const sciezka = join(DANE, 'wskazniki', 'noclegi_lozka_300m.json')
  const p = JSON.parse(readFileSync(sciezka, 'utf8'))
  assert.equal(p.wersjaAdresow, wersja)
  assert.equal(p.wartosci.length, adresy.length)
  assert.ok(statSync(sciezka).size < 2_000_000, 'plik wskaźnika poniżej 2 MB')
  // rejestry obejmują cały obszar, więc zero jest zmierzonym zerem, a null się nie pojawia
  assert.ok(p.wartosci.every((v) => Number.isInteger(v) && v >= 0))
  assert.equal(p.etykiety, undefined)

  const m = p.meta
  assert.equal(m.id, 'noclegi_lozka_300m')
  assert.equal(m.kategoria, 'spokoj')
  assert.equal(m.kierunek, 'neutralny')
  assert.equal(m.rozdzielczosc, 'adres')
  assert.equal(m.zadanie, 121)
  assert.equal(m.atrapa, undefined)
  assert.ok(m.zakres[1] >= 1000)
  assert.ok(m.opis.includes('2021-09-02'), 'data stanu CWOH w opisie')
  assert.ok(m.opis.includes('niepełna'), 'ograniczenie CWOH w opisie')
  assert.equal(m.zrodla.length, 3)
  const msip = m.zrodla.filter((z) => /msip/i.test(z.url))
  assert.equal(msip.length, 2)
  for (const z of msip)
    assert.ok(
      z.licencja.includes(
        'Gmina Miejska Kraków, Portal MSIP Obserwatorium (https://msip.krakow.pl)',
      ),
    )
  const cwoh = m.zrodla.find((z) => z.url.includes('dane.gov.pl'))
  assert.equal(cwoh.dataDanych, '2021-09-02')
  assert.match(cwoh.licencja, /CC0/)
  // typografia PL: półpauza ze spacjami, nigdy pauza
  assert.ok(!JSON.stringify(m).includes(String.fromCharCode(0x2014)))
})

test('opublikowany wskaźnik: znane miejsca i obszary bez obiektów', () => {
  const { adresy } = wczytajAdresy()
  const p = JSON.parse(readFileSync(join(DANE, 'wskazniki', 'noclegi_lozka_300m.json'), 'utf8'))
  const wartosc = (miejscowosc, ulica, nr) => {
    const a = adresy.find((x) => x.miejscowosc === miejscowosc && x.ulica === ulica && x.nr === nr)
    assert.ok(a, `brak adresu ${miejscowosc}, ${ulica} ${nr}`)
    return p.wartosci[a.i]
  }
  // ścisłe centrum Krakowa: setki wpisów KON i hotele KOH w promieniu 300 m
  assert.ok(wartosc('Kraków', 'Rynek Główny', '1') > 2000)
  assert.ok(wartosc('Kraków', 'Józefa', '30') > 2000)
  // gmina obwarzanka: hotel z CWOH liczy się do adresu pod nim (Grand Sal, 78 miejsc)
  assert.ok(wartosc('Wieliczka', 'Park Kingi', '7') >= 78)
  assert.equal(wartosc('Balice', 'kpt. Mieczysława Medweckiego', '3') >= 223, true)
  // gminy bez żadnego obiektu CWOH: zmierzone zero, nie brak danych
  const zerowe = adresy.filter((a) => a.gmina === 'Koniusza').map((a) => p.wartosci[a.i])
  assert.ok(zerowe.length > 1000 && zerowe.every((v) => v === 0))
})
