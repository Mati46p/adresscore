// Bieżące miasto w linku i w stanie (#223, faza F2): parametr `mst=`, `ustawMiasto`, czyszczenie wyboru
// przy zmianie miasta, scalanie wag (D9) i klik w heks innego miasta. Kontrakt:
// specs/002-wszystkie-miasta/contracts/url.md.
//
// Stan aplikacji to moduł z jednym obiektem, więc każdy test bierze własną instancję `stan.ts` (import
// z innym `?query` to osobny moduł), tak jak w `miastoPoBiznesie.test.ts`.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { cellToLatLng, latLngToCell } from 'h3-js'
import type { Adres, KategoriaId } from '../kontrakty/index.ts'
import { MIASTA, MIASTO_DOMYSLNE, type SlugMiasta } from '../kontrakty/miasta.ts'
import { PERSONA_DOMYSLNA, ustawieniaPersony } from './persony.ts'
import { czytajHash, ID_MIEJSC, przeniesMstDoHasha, zapiszHash } from './url.ts'

type Stan = typeof import('./stan.ts')

let numerInstancji = 0
/** Świeży stan, jak po przeładowaniu strony: osobny moduł, bez pamięci poprzedniego testu. */
async function swiezyStan(): Promise<Stan> {
  return (await import(`./stan.ts?miasto=${++numerInstancji}`)) as Stan
}

// ── Dane testowe: dwa miasta z własnymi adresami i warstwami ──────────────────────────────

const adres = (i: number, id: string, lon: number, lat: number): Adres => ({
  i,
  id,
  miejscowosc: 'Testowo',
  ulica: 'Główna',
  nr: String(i + 1),
  kod: null,
  dzielnica: null,
  gmina: 'Testowo',
  teryt: '0000000',
  lon,
  lat,
  h3: latLngToCell(lat, lon, 10),
})

const ADRESY_KRAKOWA = [
  adres(0, 'k-0', 19.94, 50.06),
  adres(1, 'k-1', 19.95, 50.07),
  adres(2, 'k-2', 19.96, 50.08),
]
const IDS_KRAKOWA = ADRESY_KRAKOWA.map((a) => a.id)

// Dwa adresy w jednym heksie r10 (środek heksu i 5 m dalej) – klik ma wybrać NAJBLIŻSZY.
const [LAT_LODZI, LON_LODZI] = cellToLatLng(latLngToCell(51.77, 19.46, 10)) as [number, number]
const ADRESY_LODZI = [
  adres(0, 'l-0', LON_LODZI, LAT_LODZI),
  adres(1, 'l-1', LON_LODZI, LAT_LODZI + 0.00005),
  adres(2, 'l-2', 19.5, 51.8),
]
const IDS_LODZI = ADRESY_LODZI.map((a) => a.id)

const meta = (id: string, kategoria: KategoriaId = 'codziennosc') => ({ id, kategoria })
// Wspólna warstwa (`halas_ldwn`), jedna tylko Krakowa i jedna tylko Łodzi; `ludnosc_1km` to kontekst
// (nigdy nie dostaje wagi). Id z tabeli persony rodziny, więc domyślne wagi są niezerowe.
const META_KRAKOWA = [
  meta('halas_ldwn', 'spokoj'),
  meta('przedszkole_odleglosc'),
  meta('ludnosc_1km', 'kontekst'),
]
const META_LODZI = [meta('halas_ldwn', 'spokoj'), meta('przystanek_odleglosc', 'transport')]
const META_SUMA = [...META_KRAKOWA, meta('przystanek_odleglosc', 'transport')]

async function krakowPodlaczony(): Promise<Stan> {
  const s = await swiezyStan()
  s.podlaczDane(IDS_KRAKOWA, META_KRAKOWA, ADRESY_KRAKOWA)
  return s
}

/** Przejście na miasto z listy i wczytanie jego danych – jak `ustawMiasto` + `dane.ts`. */
function wejdzDoLodzi(s: Stan, opcje?: Parameters<Stan['ustawMiasto']>[1]) {
  s.ustawMiasto('lodz', opcje)
  s.podlaczDane(IDS_LODZI, META_LODZI, ADRESY_LODZI)
}

const PUNKT = { lon: 19.94, lat: 50.06 }

// ── Link: parametr mst ────────────────────────────────────────────────────────────────────

describe('link: parametr mst', () => {
  it('mst=lodz otwiera Łódź, a zapis linku niesie mst jako pierwszy parametr', () => {
    const s = czytajHash('#/?mst=lodz&p=rodzina')
    assert.equal(s.miasto, 'lodz')
    assert.equal(s.nieznaneMiasto, undefined)
    const zapis = zapiszHash(s)
    assert.equal(zapis, '#/?mst=lodz&p=rodzina')
    assert.deepEqual(czytajHash(zapis), s)
  })

  it('mst w query string (/?mst=gdansk) przenosi się do hasha, a hash z własnym mst wygrywa', () => {
    assert.deepEqual(przeniesMstDoHasha('?mst=gdansk', ''), { search: '', hash: '#/?mst=gdansk' })
    assert.deepEqual(przeniesMstDoHasha('?mst=gdansk', '#/'), { search: '', hash: '#/?mst=gdansk' })
    assert.deepEqual(przeniesMstDoHasha('?mst=gdansk', '#/?p=senior'), {
      search: '',
      hash: '#/?p=senior&mst=gdansk',
    })
    assert.deepEqual(przeniesMstDoHasha('?mst=gdansk', '#/adres/abc'), {
      search: '',
      hash: '#/adres/abc?mst=gdansk',
    })
    assert.equal(
      przeniesMstDoHasha('?mst=gdansk', '#/?mst=lodz')?.hash,
      '#/?mst=lodz',
      'hash wygrywa',
    )
    // Reszta query zostaje (utm, pokaz), a przeniesiony adres czyta się jak zwykły link.
    const wynik = przeniesMstDoHasha('?utm_source=a&mst=gdansk', '')
    assert.equal(wynik?.search, '?utm_source=a')
    assert.equal(czytajHash(wynik?.hash ?? '').miasto, 'gdansk')
    assert.equal(przeniesMstDoHasha('?utm_source=a', '#/'), null, 'bez mst nie ma czego przenosić')
    assert.equal(przeniesMstDoHasha('', ''), null)
  })

  it('mst w query: nieznane miasto i Kraków po przeniesieniu zachowują się jak w hashu', () => {
    assert.equal(
      czytajHash(przeniesMstDoHasha('?mst=atlantyda', '')?.hash ?? '').nieznaneMiasto,
      true,
    )
    assert.equal('miasto' in czytajHash(przeniesMstDoHasha('?mst=krakow', '')?.hash ?? ''), false)
  })

  it('link do karty adresu w innym mieście: #/adres/<id>?mst=<slug>', () => {
    const s = czytajHash('#/adres/l-1?mst=lodz')
    assert.equal(s.ekran, 'okolica')
    assert.equal(s.idAdresu, 'l-1')
    assert.equal(s.miasto, 'lodz')
    assert.ok(zapiszHash(s).startsWith('#/adres/l-1?mst=lodz'), zapiszHash(s))
  })

  it('brak mst i mst=krakow to Kraków: pola miasto nie ma, linki sprzed #223 działają jak dotąd', () => {
    for (const hash of ['#/', '#/?p=senior', '#/adres/k-1', '#/?mst=krakow', '#/?mst=']) {
      const s = czytajHash(hash)
      assert.equal('miasto' in s, false, hash)
      assert.equal('nieznaneMiasto' in s, false, hash)
    }
  })

  it('zapis linku pomija Kraków, nawet podany jawnie, i niczego nie dopisuje do starych linków', () => {
    const baza = czytajHash('#/?p=senior')
    assert.equal(zapiszHash(baza), '#/?p=senior')
    assert.equal(zapiszHash({ ...baza, miasto: 'krakow' }), '#/?p=senior')
    assert.equal(zapiszHash(czytajHash('#/?mst=krakow&p=senior')), '#/?p=senior')
  })

  it('nieznany slug: brak miasta i flaga do komunikatu, także dla nazw z prototypu i wielkich liter', () => {
    for (const mst of ['nigdzie', 'Lodz', 'LODZ', 'constructor', '__proto__', 'toString', 'łódź']) {
      const s = czytajHash(`#/?mst=${encodeURIComponent(mst)}`)
      assert.equal(s.miasto, undefined, mst)
      assert.equal(s.nieznaneMiasto, true, mst)
    }
    // Flaga nie wraca do linku: stan otwiera Kraków i zapis jest czysty.
    assert.equal(zapiszHash(czytajHash('#/?mst=nigdzie')), '#/')
  })

  it('mst należy do każdego ekranu, a nie rusza miejsc Biznesu (m) ani ekranu #/miasto', () => {
    const ekrany: Record<string, string> = {
      '#/?mst=lodz': 'szukaj',
      '#/adres/l-1?mst=lodz': 'okolica',
      '#/porownanie?mst=lodz': 'porownanie',
      '#/katalog?mst=lodz': 'katalog',
      '#/metoda?mst=lodz': 'metoda',
      '#/miasto?mst=lodz': 'miasto',
      '#/biznes?mst=lodz': 'biznes',
    }
    for (const [hash, ekran] of Object.entries(ekrany)) {
      const s = czytajHash(hash)
      assert.equal(s.ekran, ekran, hash)
      assert.equal(s.miasto, 'lodz', hash)
      assert.ok(zapiszHash(s).includes('mst=lodz'), hash)
    }
    const biznes = czytajHash(
      '#/biznes?mst=lodz&b=apteka&m=19.940000,50.060000;;19.950000,50.070000',
    )
    assert.equal(biznes.miasto, 'lodz')
    assert.equal(biznes.branza, 'apteka')
    assert.deepEqual(
      biznes.miejsca,
      ID_MIEJSC.map((_, i) => (i === 0 ? PUNKT : i === 2 ? { lon: 19.95, lat: 50.07 } : null)),
    )
    const miasto = czytajHash('#/miasto?mst=lodz&w=halas_ldwn')
    assert.equal(miasto.warstwaLuk, 'halas_ldwn')
    assert.equal(miasto.ekran, 'miasto')
    // `m` poza ekranem Biznes nic nie znaczy (jak dotąd) i nie robi z linku linku do miasta.
    assert.equal(czytajHash('#/?m=19.94,50.06').miasto, undefined)
  })

  it('panel nie niesie mst (nie ma parametrów w linku)', () => {
    assert.equal(zapiszHash({ ...czytajHash('#/panel'), miasto: 'lodz' }), '#/panel')
  })

  it('każdy slug z rejestru przeżywa zapis i odczyt linku; Kraków bez parametru', () => {
    for (const m of MIASTA) {
      const hash = zapiszHash({ ...czytajHash('#/'), miasto: m.slug })
      assert.equal(hash.includes('mst='), m.slug !== MIASTO_DOMYSLNE, m.slug)
      assert.equal(czytajHash(hash).miasto, m.slug === MIASTO_DOMYSLNE ? undefined : m.slug, m.slug)
    }
  })
})

// ── Stan: bieżące miasto ──────────────────────────────────────────────────────────────────

describe('stan: bieżące miasto', () => {
  it('domyślnie Kraków; link startowy z mst ustawia miasto, zanim wczytają się dane', async () => {
    const s = await swiezyStan()
    assert.equal(s.pobierzStan().miasto, 'krakow')
    assert.equal(s.pobierzStan().nieznaneMiasto, false)
    s.wczytajLinkStartowy(czytajHash('#/?mst=lodz&p=senior'))
    assert.equal(s.pobierzStan().miasto, 'lodz')
    assert.equal(s.pobierzStan().persona, 'senior')
    // Link bez mst to Kraków – także po linku z innym miastem (wejście z zakładki, Wstecz).
    s.wczytajLinkStartowy(czytajHash('#/'))
    assert.equal(s.pobierzStan().miasto, 'krakow')
  })

  it('nieznany slug z linku: Kraków i flaga, którą zdejmuje następny link albo ustawMiasto', async () => {
    const s = await swiezyStan()
    s.wczytajLinkStartowy(czytajHash('#/?mst=nigdzie'))
    assert.equal(s.pobierzStan().miasto, 'krakow')
    assert.equal(s.pobierzStan().nieznaneMiasto, true)
    s.ustawMiasto('lodz')
    assert.equal(s.pobierzStan().nieznaneMiasto, false)

    const drugi = await swiezyStan()
    drugi.wczytajLinkStartowy(czytajHash('#/?mst=nigdzie'))
    drugi.zastosujZmianeUrl(czytajHash('#/porownanie'))
    assert.equal(drugi.pobierzStan().nieznaneMiasto, false)
  })

  it('pola linku (miejsca Biznesu) dostaje już miasto z linku, a nie czyszczenie po nim', async () => {
    const s = await swiezyStan()
    s.wczytajLinkStartowy(czytajHash('#/biznes?mst=lodz&b=apteka&m=19.940000,50.060000'))
    assert.equal(s.pobierzStan().miasto, 'lodz')
    assert.equal(s.pobierzStan().branza, 'apteka')
    assert.deepEqual(s.pobierzStan().miejsca[0], PUNKT)
  })

  it('ustawMiasto czyści wybór, porównanie, symulator i miejsca Biznesu; profil i filtry zostają', async () => {
    const s = await krakowPodlaczony()
    s.wybierzPersone('senior')
    s.ustawFiltr({ id: 'halas_ldwn', warunek: 'max', prog: 55 })
    s.ustawWarstwe('halas_ldwn')
    s.ustawBranze('apteka')
    s.ustawFiltryBiznesu({ min2Zrodla: true, flagi: {} })
    s.wybierzAdres(2)
    s.dodajDoPorownania(0)
    s.dodajDoPorownania(1)
    s.ustawSymulacje({ a: 'abc', b: 'def' })
    s.ustawPunktBiznesu('a', PUNKT)
    const przed = s.pobierzStan()

    s.ustawMiasto('lodz')
    const po = s.pobierzStan()
    assert.equal(po.miasto, 'lodz')
    assert.equal(po.wybrany, null)
    assert.deepEqual(po.porownanie, [])
    assert.deepEqual(po.symulacja, { a: '', b: '' })
    assert.ok(po.miejsca.every((p) => p === null))
    // Wybory użytkownika, które nie są danymi miasta, przechodzą do nowego miasta.
    assert.equal(po.persona, 'senior')
    assert.equal(po.wagi, przed.wagi)
    assert.deepEqual(po.filtry, przed.filtry)
    assert.equal(po.warstwa, 'halas_ldwn')
    assert.equal(po.branza, 'apteka')
    assert.equal(po.filtryBiznesu, przed.filtryBiznesu)
  })

  it('pola, które już są puste, zachowują tożsamość (worker nie liczy drugi raz bez powodu)', async () => {
    const s = await krakowPodlaczony()
    const przed = s.pobierzStan()
    s.ustawMiasto('lodz')
    const po = s.pobierzStan()
    assert.equal(po.porownanie, przed.porownanie)
    assert.equal(po.symulacja, przed.symulacja)
    assert.equal(po.miejsca, przed.miejsca)
  })

  it('karta okolicy bez adresu byłaby pusta: zmiana miasta wraca do wyszukiwania', async () => {
    const s = await krakowPodlaczony()
    s.pokazOkolice(1)
    assert.equal(s.pobierzStan().ekran, 'okolica')
    s.ustawMiasto('lodz')
    assert.equal(s.pobierzStan().ekran, 'szukaj')
    // Pozostałe ekrany zostają: katalog i porównanie pokażą dane nowego miasta (porównanie puste).
    s.przejdz('katalog')
    s.ustawMiasto('krakow')
    assert.equal(s.pobierzStan().ekran, 'katalog')
  })

  it('to samo miasto i slug spoza rejestru niczego nie zmieniają', async () => {
    const s = await krakowPodlaczony()
    s.wybierzAdres(1)
    const przed = s.pobierzStan()
    s.ustawMiasto('krakow')
    s.ustawMiasto('nie-ma-takiego' as SlugMiasta)
    assert.equal(s.pobierzStan(), przed)
    assert.equal(s.pobierzStan().wybrany, 1)
  })

  it('wejście do miasta zostawia dane Biznesu i symulatora z linku tego miasta', async () => {
    const s = await krakowPodlaczony()
    s.ustawPunktBiznesu('b', PUNKT)
    // Link do Biznesu w innym mieście niesie własne miejsca: nakładają się po czyszczeniu.
    s.zastosujZmianeUrl(czytajHash('#/biznes?mst=lodz&m=19.950000,50.070000'))
    assert.equal(s.pobierzStan().miasto, 'lodz')
    assert.deepEqual(s.pobierzStan().miejsca[0], { lon: 19.95, lat: 50.07 })
    assert.equal(s.pobierzStan().miejsca[1], null)
    // Link bez miejsc (zwykły widok innego miasta) po zmianie miasta zostawia je puste.
    s.zastosujZmianeUrl(czytajHash('#/?mst=krakow'))
    assert.ok(s.pobierzStan().miejsca.every((p) => p === null))
  })
})

// ── Scalanie wag (D9) ─────────────────────────────────────────────────────────────────────

describe('podlaczDane scala wagi zamiast je zastępować (D9)', () => {
  it('własne wagi i warstwy spoza meta nowego miasta zostają, nowe warstwy dostają wagę persony', async () => {
    const s = await krakowPodlaczony()
    s.ustawWage('przedszkole_odleglosc', 1) // tylko Kraków
    s.ustawWage('halas_ldwn', 2) // wspólna
    assert.equal(s.pobierzStan().persona, 'wlasna')

    wejdzDoLodzi(s)
    const { wagi, persona, tryb } = s.pobierzStan()
    assert.equal(persona, 'wlasna', 'profil użytkownika zostaje')
    assert.equal(wagi.przedszkole_odleglosc, 1, 'warstwa spoza meta Łodzi zostaje')
    assert.equal(wagi.halas_ldwn, 2, 'własna waga na warstwie wspólnej nie wraca do domyślnej')
    const domyslne = ustawieniaPersony(PERSONA_DOMYSLNA, tryb, META_LODZI).wagi
    assert.equal(wagi.przystanek_odleglosc, domyslne.przystanek_odleglosc)
    assert.ok((wagi.przystanek_odleglosc ?? 0) > 0, 'test coś mierzy: domyślna waga nie jest zerem')

    // Powrót do Krakowa: wagi Krakowa nietknięte, a warstwa Łodzi zostaje w mapie (suma miast).
    s.ustawMiasto('krakow')
    s.podlaczDane(IDS_KRAKOWA, META_KRAKOWA, ADRESY_KRAKOWA)
    const po = s.pobierzStan().wagi
    assert.equal(po.przedszkole_odleglosc, 1)
    assert.equal(po.halas_ldwn, 2)
    assert.equal(po.przystanek_odleglosc, domyslne.przystanek_odleglosc)
  })

  it('profil nazwany zostaje, a mapa wag ma klucze warstw obu miast', async () => {
    const s = await krakowPodlaczony()
    s.wybierzPersone('senior')
    wejdzDoLodzi(s)
    const { wagi, persona, tryb } = s.pobierzStan()
    assert.equal(persona, 'senior')
    assert.deepEqual(wagi, ustawieniaPersony('senior', tryb, META_SUMA).wagi)
  })

  it('persona wybrana w drugim mieście liczy się na sumie warstw: wagi Krakowa nie giną', async () => {
    const s = await krakowPodlaczony()
    wejdzDoLodzi(s)
    s.wybierzPersone('senior')
    const { wagi, tryb } = s.pobierzStan()
    // Bez sumy meta mapa miałaby tylko klucze Łodzi, a kolor Krakowa w przeglądzie zgubiłby 60 warstw.
    assert.ok('przedszkole_odleglosc' in wagi)
    assert.deepEqual(wagi, ustawieniaPersony('senior', tryb, META_SUMA).wagi)
    s.ustawTryb('wynajmuje')
    assert.deepEqual(s.pobierzStan().wagi, ustawieniaPersony('senior', 'wynajmuje', META_SUMA).wagi)
  })

  it('link z profilem liczy go od nowa dla wszystkich znanych warstw (link jest źródłem prawdy)', async () => {
    const s = await krakowPodlaczony()
    s.ustawWage('halas_ldwn', 1)
    s.zastosujZmianeUrl(czytajHash('#/?mst=lodz&p=senior'))
    s.podlaczDane(IDS_LODZI, META_LODZI, ADRESY_LODZI)
    const { wagi, persona, tryb } = s.pobierzStan()
    assert.equal(persona, 'senior')
    assert.deepEqual(wagi, ustawieniaPersony('senior', tryb, META_SUMA).wagi)
  })

  it('dodajMetaMiasta: warstwy innego miasta dostają wagę persony, a wagi użytkownika zostają', async () => {
    const s = await krakowPodlaczony()
    s.ustawWage('halas_ldwn', 1)
    const { tryb } = s.pobierzStan()
    s.dodajMetaMiasta(META_LODZI)
    const wagi = s.pobierzStan().wagi
    const domyslne = ustawieniaPersony(PERSONA_DOMYSLNA, tryb, META_SUMA).wagi
    assert.equal(wagi.halas_ldwn, 1, 'warstwa znana: waga użytkownika')
    assert.equal(
      wagi.przystanek_odleglosc,
      domyslne.przystanek_odleglosc,
      'warstwa nowa: waga persony',
    )
    assert.ok((wagi.przystanek_odleglosc ?? 0) > 0)
    assert.equal(s.pobierzStan().persona, 'wlasna')

    // Powtórka niczego nie zmienia i nie budzi nasłuchujących (przegląd woła to przy każdym mieście).
    let powiadomien = 0
    s.subskrybuj(() => powiadomien++)
    const przed = s.pobierzStan()
    s.dodajMetaMiasta(META_LODZI)
    s.dodajMetaMiasta([])
    assert.equal(s.pobierzStan(), przed)
    assert.equal(powiadomien, 0)

    // Wejście do tego miasta nie przestawia wagi, którą przegląd już liczył.
    wejdzDoLodzi(s)
    assert.equal(s.pobierzStan().wagi.przystanek_odleglosc, domyslne.przystanek_odleglosc)
  })

  it('dodajMetaMiasta przed pierwszymi danymi: persona wybrana potem liczy się na wszystkich warstwach', async () => {
    const s = await swiezyStan()
    s.dodajMetaMiasta(META_LODZI) // przegląd zna Łódź, zanim wczytają się dane bieżącego miasta
    s.podlaczDane(IDS_KRAKOWA, META_KRAKOWA, ADRESY_KRAKOWA)
    const tryb = s.pobierzStan().tryb
    assert.deepEqual(
      s.pobierzStan().wagi,
      ustawieniaPersony(PERSONA_DOMYSLNA, tryb, [...META_LODZI, ...META_KRAKOWA]).wagi,
    )
    s.wybierzPersone('senior')
    assert.deepEqual(
      s.pobierzStan().wagi,
      ustawieniaPersony('senior', tryb, [...META_LODZI, ...META_KRAKOWA]).wagi,
    )
  })

  it('pierwsze podlaczDane bez linku daje wagi persony, jak przed #223', async () => {
    const s = await swiezyStan()
    s.podlaczDane(IDS_KRAKOWA, META_KRAKOWA, ADRESY_KRAKOWA)
    const { wagi, kierunki, tryb } = s.pobierzStan()
    const wzorzec = ustawieniaPersony(PERSONA_DOMYSLNA, tryb, META_KRAKOWA)
    assert.deepEqual(wagi, wzorzec.wagi)
    assert.deepEqual(kierunki, wzorzec.kierunki)
  })
})

// ── Klik w heks innego miasta ─────────────────────────────────────────────────────────────

describe('klik w heks innego miasta wybiera adres po wczytaniu jego danych', () => {
  it('adres najbliższy kliknięciu w klikniętym heksie, dopiero po podlaczDane nowego miasta', async () => {
    const s = await krakowPodlaczony()
    const bliski = ADRESY_LODZI[1] as Adres
    s.ustawMiasto('lodz', { klik: { lon: bliski.lon, lat: bliski.lat } })
    assert.equal(s.pobierzStan().miasto, 'lodz')
    assert.equal(s.pobierzStan().wybrany, null, 'dane Łodzi jeszcze się wczytują')
    s.podlaczDane(IDS_LODZI, META_LODZI, ADRESY_LODZI)
    assert.equal(s.pobierzStan().wybrany, 1)
    assert.equal(s.pobierzStan().ekran, 'szukaj', 'klik wybiera adres, nie otwiera karty')
  })

  it('heks bez adresów nic nie wybiera, a klik zostaje zużyty (drugie podlaczDane go nie powtarza)', async () => {
    const s = await krakowPodlaczony()
    s.ustawMiasto('lodz', { klik: { lon: 19.9, lat: 51.9 } })
    s.podlaczDane(IDS_LODZI, META_LODZI, ADRESY_LODZI)
    assert.equal(s.pobierzStan().wybrany, null)

    const drugi = await krakowPodlaczony()
    const a = ADRESY_LODZI[2] as Adres
    drugi.ustawMiasto('lodz', { klik: { lon: a.lon, lat: a.lat } })
    drugi.podlaczDane(IDS_LODZI, META_LODZI, ADRESY_LODZI)
    assert.equal(drugi.pobierzStan().wybrany, 2)
    drugi.wybierzAdres(null)
    drugi.podlaczDane(IDS_LODZI, META_LODZI, ADRESY_LODZI)
    assert.equal(drugi.pobierzStan().wybrany, null)
  })

  it('kolejna zmiana miasta albo link z innym miastem unieważnia czekający klik', async () => {
    const a = ADRESY_LODZI[1] as Adres
    const klik = { klik: { lon: a.lon, lat: a.lat } }

    const poInnymMiescie = await krakowPodlaczony()
    poInnymMiescie.ustawMiasto('lodz', klik)
    poInnymMiescie.ustawMiasto('gdansk')
    poInnymMiescie.podlaczDane(IDS_LODZI, META_LODZI, ADRESY_LODZI)
    assert.equal(poInnymMiescie.pobierzStan().wybrany, null)

    const poLinku = await krakowPodlaczony()
    poLinku.ustawMiasto('lodz', klik)
    poLinku.zastosujZmianeUrl(czytajHash('#/'))
    assert.equal(poLinku.pobierzStan().miasto, 'krakow')
    poLinku.podlaczDane(IDS_KRAKOWA, META_KRAKOWA, ADRESY_KRAKOWA)
    assert.equal(poLinku.pobierzStan().wybrany, null)
  })

  it('klik w bieżącym mieście to nie zmiana miasta: nic nie czeka', async () => {
    const s = await krakowPodlaczony()
    s.ustawMiasto('krakow', { klik: { lon: 19.94, lat: 50.06 } })
    s.podlaczDane(IDS_KRAKOWA, META_KRAKOWA, ADRESY_KRAKOWA)
    assert.equal(s.pobierzStan().wybrany, null)
  })
})

// ── Link z innym miastem niż bieżące ──────────────────────────────────────────────────────

describe('link z innym miastem czeka na dane tego miasta', () => {
  it('adres i porównanie z linku rozwiązują się na słowniku miasta z linku', async () => {
    const s = await krakowPodlaczony()
    s.zastosujZmianeUrl(czytajHash('#/adres/l-1?mst=lodz&cmp=l-0,l-2,k-1'))
    let st = s.pobierzStan()
    assert.equal(st.miasto, 'lodz')
    assert.equal(st.ekran, 'okolica', 'ekran z linku od razu')
    assert.equal(st.wybrany, null, 'adres czeka na dane Łodzi')
    assert.deepEqual(st.porownanie, [])

    s.podlaczDane(IDS_LODZI, META_LODZI, ADRESY_LODZI)
    st = s.pobierzStan()
    assert.equal(st.ekran, 'okolica')
    assert.equal(st.wybrany, 1)
    assert.deepEqual(st.porownanie, [0, 2], 'id z Krakowa odpada, nie trafia na cudzy adres')
  })

  it('id z Krakowa w linku do Łodzi nie otwiera cudzego adresu: karta wraca do wyszukiwania', async () => {
    const s = await krakowPodlaczony()
    s.zastosujZmianeUrl(czytajHash('#/adres/k-1?mst=lodz'))
    s.podlaczDane(IDS_LODZI, META_LODZI, ADRESY_LODZI)
    assert.equal(s.pobierzStan().wybrany, null)
    assert.equal(s.pobierzStan().ekran, 'szukaj')
  })

  it('w oknie po ustawMiasto stary słownik nie rozwiązuje id z linku (link czeka na dane miasta)', async () => {
    const s = await krakowPodlaczony()
    s.ustawMiasto('lodz') // dane Łodzi się wczytują, słownik wciąż Krakowa
    s.zastosujZmianeUrl(czytajHash('#/adres/l-1?mst=lodz'))
    assert.equal(
      s.pobierzStan().ekran,
      'okolica',
      'rozwiązany na słowniku Krakowa wróciłby do Szukaj',
    )
    s.podlaczDane(IDS_LODZI, META_LODZI, ADRESY_LODZI)
    assert.equal(s.pobierzStan().wybrany, 1)
    assert.equal(s.pobierzStan().ekran, 'okolica')
  })

  it('Wstecz do linku Krakowa po przejściu do Łodzi: miasto wraca, adres czeka na dane Krakowa', async () => {
    const s = await krakowPodlaczony()
    wejdzDoLodzi(s)
    s.zastosujZmianeUrl(czytajHash('#/adres/k-1'))
    let st = s.pobierzStan()
    assert.equal(st.miasto, 'krakow')
    assert.equal(st.wybrany, null)
    s.podlaczDane(IDS_KRAKOWA, META_KRAKOWA, ADRESY_KRAKOWA)
    st = s.pobierzStan()
    assert.equal(st.wybrany, 1)
    assert.equal(st.ekran, 'okolica')
  })

  it('link z tym samym miastem po wczytaniu danych czyta się jak dotąd (bez czekania)', async () => {
    const s = await krakowPodlaczony()
    s.zastosujZmianeUrl(czytajHash('#/adres/k-2?cmp=k-0'))
    assert.equal(s.pobierzStan().wybrany, 2)
    assert.deepEqual(s.pobierzStan().porownanie, [0])
    wejdzDoLodzi(s)
    s.zastosujZmianeUrl(czytajHash('#/adres/l-1?mst=lodz'))
    assert.equal(s.pobierzStan().wybrany, 1)
  })
})

// ── Linki do stanu: hrefDla ───────────────────────────────────────────────────────────────

describe('hrefDla niesie miasto', () => {
  it('Kraków: ładne ścieżki SEO bez mst; inne miasto: hash z mst (SEO istnieje tylko dla Krakowa)', async () => {
    const s = await krakowPodlaczony()
    const karta = s.hrefDla(s.pobierzStan(), { ekran: 'okolica', wybrany: 1 })
    assert.match(karta, /^\/adres\/glowna-2-testowo-[0-9a-f]{16}$/)
    assert.equal(s.hrefDla(s.pobierzStan(), { ekran: 'katalog' }), '/katalog')

    wejdzDoLodzi(s)
    const kartaLodzi = s.hrefDla(s.pobierzStan(), { ekran: 'okolica', wybrany: 1 })
    assert.ok(kartaLodzi.startsWith('/#/adres/l-1?mst=lodz'), kartaLodzi)
    const wrocil = czytajHash(kartaLodzi.slice(kartaLodzi.indexOf('#')))
    assert.equal(wrocil.ekran, 'okolica')
    assert.equal(wrocil.idAdresu, 'l-1')
    assert.equal(wrocil.miasto, 'lodz')
    const katalog = s.hrefDla(s.pobierzStan(), { ekran: 'katalog' })
    assert.ok(katalog.startsWith('/#/katalog?mst=lodz'), katalog)
    assert.ok(s.hrefDla(s.pobierzStan(), { ekran: 'metoda' }).includes('mst=lodz'))
  })

  it('link z nagłówka zmienia ekran, nie miasto: mst zostaje', async () => {
    const s = await krakowPodlaczony()
    wejdzDoLodzi(s)
    const href = s.hrefDla(s.pobierzStan(), { ekran: 'porownanie' })
    assert.ok(href.startsWith('/#/porownanie?mst=lodz'), href)
    s.zastosujZmianeUrl(czytajHash(href.slice(href.indexOf('#'))))
    assert.equal(s.pobierzStan().miasto, 'lodz')
    assert.equal(s.pobierzStan().ekran, 'porownanie')
  })

  it('powrót do Krakowa zdejmuje mst z linku', async () => {
    const s = await krakowPodlaczony()
    wejdzDoLodzi(s)
    s.ustawMiasto('krakow')
    const href = s.hrefDla(s.pobierzStan(), { ekran: 'porownanie' })
    assert.ok(!href.includes('mst='), href)
  })
})
