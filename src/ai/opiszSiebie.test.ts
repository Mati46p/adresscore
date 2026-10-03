// Uruchom: node --test src/ai/
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { OdpowiedzJev } from './jev.ts'
import {
  ETYKIETY_KATEGORII,
  ID_PROFILU,
  ID_WLASNEJ_SYTUACJI,
  KATEGORIE_JEV,
  nicNieZrozumiano,
  normalizuj,
  opiszSiebie,
  POTRZEBY,
  POZIOMY_WAZNOSCI,
  PROG_WLASNEJ_SYTUACJI,
  przetworzOdpowiedzi,
  TWIERDZENIE_WLASNEJ_SYTUACJI,
  wagiZeZrozumienia,
  type Zrozumienie,
  zapytanieOpiszSiebie,
  zRegul,
} from './opiszSiebie.ts'

function zbudujFetch(status: number, json: unknown) {
  const ciala: unknown[] = []
  const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
    ciala.push(JSON.parse(String(init?.body)))
    return { ok: status >= 200 && status < 300, status, json: async () => json } as Response
  }) as typeof fetch
  return { fetchImpl, ciala }
}

const WSKAZNIKI = [
  { id: 'sklep_odleglosc', kategoria: 'codziennosc' },
  { id: 'przedszkole_odleglosc', kategoria: 'codziennosc' },
  { id: 'szkola_podst_odleglosc', kategoria: 'codziennosc' },
  { id: 'przystanek_odleglosc', kategoria: 'transport' },
  { id: 'kursy_szczyt_h', kategoria: 'transport' },
  { id: 'rynek_czas_min', kategoria: 'transport' },
  { id: 'halas_ldwn', kategoria: 'spokoj' },
  { id: 'pm25_srednia', kategoria: 'spokoj' },
  { id: 'zielen_udzial', kategoria: 'spokoj' },
  { id: 'inwestycje_500m', kategoria: 'przyszlosc' },
  { id: 'powodz_1proc', kategoria: 'bezpieczenstwo' },
  { id: 'udzial_0_14', kategoria: 'kontekst' },
] as const

const BIEZACE = { wagi: { halas_ldwn: 1, przystanek_odleglosc: 2 }, kierunki: {} }

describe('zapytanieOpiszSiebie', () => {
  const z = zapytanieOpiszSiebie('Mam psa')
  const ids = Object.keys(z.pytania)

  it('stała kolejność: profil, 4 kategorie, potrzeby z twierdzeniem, własna sytuacja', () => {
    const potrzebyJev = POTRZEBY.filter((p) => p.twierdzenie).map((p) => `p_${p.id}`)
    assert.deepEqual(ids, [
      ID_PROFILU,
      ...KATEGORIE_JEV.map((k) => `kat_${k}`),
      ...potrzebyJev,
      ID_WLASNEJ_SYTUACJI,
    ])
    assert.equal(z.stan, 'Mam psa')
  })

  it('#147: najwyżej 16 pytań (limit pośrednika) – wolne miejsce to „Przyszłość okolicy”', async () => {
    // Plik JS pośrednika bez typów – import dynamiczny, jak w pomiar.ts.
    const sciezka = new URL('../../api/_jev.js', import.meta.url).href
    const { LIMITY, sprawdzZapytanie } = (await import(sciezka)) as {
      LIMITY: { pytan: number }
      sprawdzZapytanie: (c: unknown) => { blad?: string }
    }
    assert.ok(ids.length <= LIMITY.pytan, `${ids.length} pytań`)
    assert.equal(LIMITY.pytan, 16)
    assert.ok(!ids.includes('kat_przyszlosc'))
    assert.equal(z.pytania[ID_WLASNEJ_SYTUACJI]?.typ, 'noul')
    // Pośrednik przyjmuje to zapytanie bez zmian.
    assert.equal(sprawdzZapytanie(z).blad, undefined)
  })

  it('#147: twierdzenie „bez samochodu” to jeden warunek, bez „i”', () => {
    const t = POTRZEBY.find((p) => p.id === 'bez_samochodu')?.twierdzenie ?? ''
    assert.match(t, /nie ma samochodu/)
    assert.doesNotMatch(t, /\si\s/)
    assert.doesNotMatch(t, /komunikac/)
    // Żadne twierdzenie potrzeby nie łączy dwóch warunków przez „ i ”.
    for (const p of POTRZEBY)
      if (p.twierdzenie) assert.doesNotMatch(p.twierdzenie, /\si\s/, `${p.id}: ${p.twierdzenie}`)
  })

  it('mieści się w limitach pośrednika (≤ 16 pytań, id i polecenia)', () => {
    assert.ok(ids.length <= 16)
    for (const [id, p] of Object.entries(z.pytania)) {
      assert.match(id, /^[a-z0-9_-]{1,40}$/i)
      assert.ok(p.polecenie.length <= 300, id)
    }
  })

  it('profil wybiera z PERSONY bez „Od zera” plus „nieznany”', () => {
    const profil = z.pytania[ID_PROFILU]
    assert.equal(profil?.typ, 'choice')
    if (profil?.typ !== 'choice') return
    assert.deepEqual(Object.keys(profil.kryteria), [
      'rodzina',
      'singiel',
      'senior',
      'inwestor',
      'nieznany',
    ])
  })

  it('kategorie to score na 5 poziomach 0–4, potrzeby to noul', () => {
    const kat = z.pytania.kat_spokoj
    assert.equal(kat?.typ, 'score')
    if (kat?.typ === 'score') assert.deepEqual(kat.kryteria, POZIOMY_WAZNOSCI)
    assert.ok(kat?.polecenie.includes('Spokój i zdrowie'))
    assert.equal(z.pytania.p_dzieci?.typ, 'noul')
  })
})

describe('przetworzOdpowiedzi (JEV → zrozumienie)', () => {
  it('profil, kategorie poza środkiem skali i potrzeby nad progiem', () => {
    const odp: Record<string, OdpowiedzJev | null> = {
      profil: { typ: 'choice', wybor: 'rodzina', pewnosc: 0.88 },
      kat_codziennosc: { typ: 'score', ocena: 2.1, pewnosc: 0.9 }, // środek = bez zmian
      kat_transport: { typ: 'score', ocena: 0.8, pewnosc: 0.9 }, // mało ważne
      kat_spokoj: { typ: 'score', ocena: 3.7, pewnosc: 0.95 }, // bardzo ważne
      kat_przyszlosc: { typ: 'score', ocena: 4, pewnosc: 0.3 }, // za niska pewność
      kat_bezpieczenstwo: null,
      p_dzieci: { typ: 'noul', noul: 0.93 },
      p_pies: { typ: 'noul', noul: 0.4 },
      p_rower: { typ: 'noul', noul: 0.71 },
    }
    const z = przetworzOdpowiedzi(odp)
    assert.ok(z)
    assert.equal(z.persona, 'rodzina')
    assert.deepEqual(z.potrzeby, ['dzieci', 'rower'])
    // dzieci podnoszą codzienność do 4; JEV jawnie: transport 1, spokój 4.
    assert.deepEqual(z.kategorie, { codziennosc: 4, spokoj: 4, transport: 1 })
    assert.deepEqual(z.zrozumialem.slice(0, 3), [
      { rodzaj: 'profil', etykieta: 'Rodzina z dziećmi', procent: 88 },
      { rodzaj: 'potrzeba', etykieta: 'dzieci', procent: 93 },
      { rodzaj: 'potrzeba', etykieta: 'rower', procent: 71 },
    ])
    assert.deepEqual(z.zrozumialem[3], {
      rodzaj: 'kategoria',
      etykieta: ETYKIETY_KATEGORII.codziennosc,
      procent: 100,
      opis: 'Bardzo ważne',
    })
    assert.deepEqual(
      z.zrozumialem.filter((p) => p.rodzaj === 'kategoria').map((p) => p.etykieta),
      ['Codzienność pieszo', 'Transport', 'Spokój i zdrowie'],
    )
  })

  it('niska pewność wszędzie → null (wołający spada do reguł)', () => {
    const z = przetworzOdpowiedzi({
      profil: { typ: 'choice', wybor: 'senior', pewnosc: 0.35 },
      kat_spokoj: { typ: 'score', ocena: 4, pewnosc: 0.2 },
      p_dzieci: { typ: 'noul', noul: 0.55 },
    })
    assert.equal(z, null)
  })

  it('„nieznany” profil i obce id opcji nie ustawiają persony', () => {
    assert.equal(
      przetworzOdpowiedzi({ profil: { typ: 'choice', wybor: 'nieznany', pewnosc: 0.99 } }),
      null,
    )
    assert.equal(
      przetworzOdpowiedzi({ profil: { typ: 'choice', wybor: 'od-zera', pewnosc: 0.99 } }),
      null,
    )
  })

  it('#147: cudza sytuacja (noul własnej sytuacji niski) → profil bez zmian, tylko pewne potrzeby', () => {
    const odp: Record<string, OdpowiedzJev | null> = {
      profil: { typ: 'choice', wybor: 'rodzina', pewnosc: 0.95 },
      kat_spokoj: { typ: 'score', ocena: 4, pewnosc: 0.95 },
      p_dzieci: { typ: 'noul', noul: 0.8 },
      p_pies: { typ: 'noul', noul: 0.95 },
      [ID_WLASNEJ_SYTUACJI]: { typ: 'noul', noul: PROG_WLASNEJ_SYTUACJI - 0.01 },
    }
    const z = przetworzOdpowiedzi(odp)
    assert.ok(z)
    assert.equal(z.persona, null)
    assert.deepEqual(z.potrzeby, ['pies'])
    assert.equal(z.potrzeby.includes('dzieci'), false)
    // Wagi: bez profilu bazą są bieżące, więc persona użytkownika się nie zmienia.
    const u = wagiZeZrozumienia(z, 'kupuje', WSKAZNIKI, BIEZACE)
    assert.equal(u.wagi.przystanek_odleglosc, BIEZACE.wagi.przystanek_odleglosc)
  })

  it('#147: cudza sytuacja bez pewnych potrzeb → „nic nie zrozumiano” od JEV, nie reguły', async () => {
    const odp = {
      profil: { typ: 'choice', wybor: 'rodzina', pewnosc: 0.9 },
      p_dzieci: { typ: 'noul', noul: 0.85 },
      [ID_WLASNEJ_SYTUACJI]: { typ: 'noul', noul: 0.1 },
    }
    const z = przetworzOdpowiedzi(odp as Record<string, OdpowiedzJev | null>)
    assert.ok(z && nicNieZrozumiano(z))
    const { fetchImpl } = zbudujFetch(200, { odpowiedzi: odp, powod: null })
    const w = await opiszSiebie('Kumpel ma trójkę dzieci i psa', { fetch: fetchImpl })
    assert.equal(w.zrodlo, 'jev')
    assert.ok(nicNieZrozumiano(w.wynik), 'reguły złapałyby dzieci i psa kumpla')
  })

  it('#147: własna sytuacja na progu albo bez odpowiedzi → jak dotąd', () => {
    const baza: Record<string, OdpowiedzJev | null> = {
      profil: { typ: 'choice', wybor: 'rodzina', pewnosc: 0.95 },
      p_dzieci: { typ: 'noul', noul: 0.8 },
    }
    for (const wlasna of [{ typ: 'noul', noul: PROG_WLASNEJ_SYTUACJI } as const, null]) {
      const z = przetworzOdpowiedzi({ ...baza, [ID_WLASNEJ_SYTUACJI]: wlasna })
      assert.equal(z?.persona, 'rodzina')
      assert.deepEqual(z?.potrzeby, ['dzieci'])
    }
  })

  it('#150: domownik, który się wprowadza („mama z nami zamieszka”) to własna sytuacja – profil zostaje', () => {
    // noul jak na żywo dla nowego brzmienia: domownicy i własne plany 0,92–0,95.
    const z = przetworzOdpowiedzi({
      profil: { typ: 'choice', wybor: 'senior', pewnosc: 0.9 },
      p_senior: { typ: 'noul', noul: 0.97 },
      p_zdrowie: { typ: 'noul', noul: 0.94 },
      p_dzieci: { typ: 'noul', noul: 0.2 },
      [ID_WLASNEJ_SYTUACJI]: { typ: 'noul', noul: 0.93 },
    })
    assert.equal(z?.persona, 'senior')
    assert.deepEqual(z?.potrzeby, ['senior', 'zdrowie'])
    // Twierdzenie obejmuje rodzinę i inwestora, a wyklucza znajomego, hipotezę i przeszłość.
    for (const slowo of ['rodziny', 'inwestor', 'znajomy', 'wyobrażona', 'dawna'])
      assert.ok(TWIERDZENIE_WLASNEJ_SYTUACJI.includes(slowo), slowo)
    assert.ok(
      !TWIERDZENIE_WLASNEJ_SYTUACJI.includes('obecną'),
      'plany domowników to nie przeszłość',
    )
    // Nadal ≤ 16 pytań i twierdzenie w zapytaniu.
    const q = zapytanieOpiszSiebie('Mama z nami zamieszka, ma 80 lat.')
    assert.ok(Object.keys(q.pytania).length <= 16)
    assert.deepEqual(q.pytania[ID_WLASNEJ_SYTUACJI], {
      typ: 'noul',
      polecenie: TWIERDZENIE_WLASNEJ_SYTUACJI,
    })
  })

  it('#150: wysoka pewność profilu nie otwiera bramki – cudza sytuacja dalej bez profilu', () => {
    // „Pytam dla koleżanki: ona ma dwójkę dzieci i psa” – na żywo Rodzina 1,00, bramka 0,04.
    const z = przetworzOdpowiedzi({
      profil: { typ: 'choice', wybor: 'rodzina', pewnosc: 1 },
      p_dzieci: { typ: 'noul', noul: 0.85 },
      [ID_WLASNEJ_SYTUACJI]: { typ: 'noul', noul: 0.04 },
    })
    assert.ok(z && nicNieZrozumiano(z))
  })

  it('#147: profil Inwestor niesie przyszłość okolicy (potrzeba z tabeli, bez liczby JEV)', () => {
    const z = przetworzOdpowiedzi({ profil: { typ: 'choice', wybor: 'inwestor', pewnosc: 0.9 } })
    assert.deepEqual(z?.potrzeby, ['inwestycja'])
    assert.equal(z?.kategorie.przyszlosc, 4)
  })

  it('bez pewnego profilu persona wynika z potrzeb (bez procentu)', () => {
    const z = przetworzOdpowiedzi({
      profil: { typ: 'choice', wybor: 'singiel', pewnosc: 0.4 },
      p_senior: { typ: 'noul', noul: 0.9 },
    })
    assert.equal(z?.persona, 'senior')
    assert.deepEqual(z?.zrozumialem[0], { rodzaj: 'profil', etykieta: 'Senior', procent: null })
  })
})

describe('opiszSiebie (JEV z regułą zapasową, fetch wstrzykiwany)', () => {
  it('pewna odpowiedź JEV → źródło jev', async () => {
    const { fetchImpl, ciala } = zbudujFetch(200, {
      odpowiedzi: { profil: { typ: 'choice', wybor: 'inwestor', pewnosc: 0.9 } },
      powod: null,
    })
    const w = await opiszSiebie('Kupuję pod wynajem', { fetch: fetchImpl })
    assert.equal(w.zrodlo, 'jev')
    assert.equal(w.wynik.persona, 'inwestor')
    assert.equal(ciala.length, 1)
    assert.deepEqual(Object.keys((ciala[0] as { pytania: object }).pytania).slice(0, 2), [
      'profil',
      'kat_codziennosc',
    ])
  })

  it('niska pewność JEV → reguły, powód „nieczytelne”', async () => {
    const { fetchImpl } = zbudujFetch(200, {
      odpowiedzi: { profil: { typ: 'choice', wybor: 'senior', pewnosc: 0.2 } },
      powod: null,
    })
    const w = await opiszSiebie('Mam dwoje dzieci i psa', { fetch: fetchImpl })
    assert.equal(w.zrodlo, 'zapas')
    assert.equal(w.powod, 'nieczytelne')
    assert.equal(w.wynik.persona, 'rodzina')
    assert.deepEqual(w.wynik.potrzeby, ['dzieci', 'pies'])
  })

  it('brak klucza → reguły', async () => {
    const { fetchImpl } = zbudujFetch(200, { odpowiedzi: null, powod: 'brak-klucza' })
    const w = await opiszSiebie('Jestem emerytem', { fetch: fetchImpl })
    assert.equal(w.zrodlo, 'zapas')
    assert.equal(w.powod, 'brak-klucza')
    assert.equal(w.wynik.persona, 'senior')
  })

  it('pusty tekst → nic nie pyta', async () => {
    const { fetchImpl, ciala } = zbudujFetch(200, {})
    const w = await opiszSiebie('   ', { fetch: fetchImpl })
    assert.equal(ciala.length, 0)
    assert.ok(nicNieZrozumiano(w.wynik))
  })
})

describe('zRegul – parser po polsku', () => {
  const PRZYPADKI: [string, string[], string | null][] = [
    ['Mam dwoje dzieci i psa', ['dzieci', 'pies'], 'rodzina'],
    ['Szukam cichego mieszkania, nie znoszę hałasu', ['cisza'], null],
    ['Nie mam samochodu, jeżdżę tramwajem', ['bez_samochodu'], null],
    ['Żyję bez auta i pracuję w centrum', ['bez_samochodu', 'praca_centrum'], null],
    ['Jestem emerytką, potrzebuję przychodni i apteki blisko', ['senior', 'zdrowie'], 'senior'],
    ['Dojeżdżam rowerem do biura na Rynku', ['rower', 'praca_centrum'], null],
    ['Nie mam dzieci, liczy się dojazd do pracy', ['praca_centrum'], null],
    ['Córka idzie do przedszkola, chcemy park obok', ['dzieci', 'zielen'], 'rodzina'],
    ['Mam astmę, smog to dla mnie problem', ['powietrze'], null],
    ['Kupuję mieszkanie pod wynajem jako inwestycję', ['inwestycja'], 'inwestor'],
    ['Student, mieszkam sam, lubię mieć sklep pod domem', ['sklepy', 'singiel'], 'singiel'],
    ['Boję się powodzi, poprzednie mieszkanie zalało', ['bezpieczenstwo'], null],
    ['Często latam służbowo, lotnisko musi być blisko', ['lotnisko'], null],
    ['Szukam miejsca z miejscem parkingowym', [], null],
    ['Babcia z wnukami, spokojna okolica', ['senior', 'cisza'], 'senior'],
    ['Lubię dobrą kawę', [], null],
  ]
  for (const [zdanie, potrzeby, persona] of PRZYPADKI) {
    it(zdanie, () => {
      const z = zRegul(zdanie)
      assert.deepEqual([...z.potrzeby].sort(), [...potrzeby].sort())
      assert.equal(z.persona, persona)
    })
  }

  it('deterministyczny i bez procentów (reguła nie zna pewności)', () => {
    const a = zRegul('Mam dzieci i psa')
    assert.deepEqual(a, zRegul('Mam dzieci i psa'))
    for (const p of a.zrozumialem) if (p.rodzaj !== 'kategoria') assert.equal(p.procent, null)
  })

  it('lista „zrozumiałem”: profil, potrzeby, kategorie w kolejności karty', () => {
    const z = zRegul('Mam dzieci i psa')
    assert.deepEqual(
      z.zrozumialem.map((p) => [p.rodzaj, p.etykieta, p.procent]),
      [
        ['profil', 'Rodzina z dziećmi', null],
        ['potrzeba', 'dzieci', null],
        ['potrzeba', 'pies', null],
        ['kategoria', 'Codzienność pieszo', 100],
        ['kategoria', 'Spokój i zdrowie', 75],
      ],
    )
  })

  it('normalizuj zdejmuje polskie znaki', () => {
    assert.equal(normalizuj('Żółć, Łódź – HAŁAS!'), 'zolc lodz halas')
  })
})

describe('wagiZeZrozumienia', () => {
  const zRegulDla = (t: string): Zrozumienie => zRegul(t)

  it('profil bez dodatkowych zmian → zostaje personą (nie „własna”)', () => {
    const z: Zrozumienie = { ...zRegulDla(''), persona: 'singiel' }
    const u = wagiZeZrozumienia(z, 'kupuje', WSKAZNIKI, BIEZACE)
    assert.equal(u.persona, 'singiel')
  })

  it('potrzeby podnoszą warstwy, kontekst zostaje 0', () => {
    const u = wagiZeZrozumienia(zRegulDla('Mam dzieci i psa'), 'kupuje', WSKAZNIKI, BIEZACE)
    assert.equal(u.persona, 'wlasna')
    assert.equal(u.wagi.przedszkole_odleglosc, 4)
    assert.equal(u.wagi.zielen_udzial, 4)
    assert.equal(u.wagi.halas_ldwn, 3) // „rodzina” 3, spokój ≥ 3 nie obniża
    assert.equal(u.wagi.udzial_0_14, 0)
    // Kierunki persony przechodzą dalej.
    assert.equal(u.kierunki.inwestycje_500m, 'mniej-lepiej')
  })

  it('bez profilu bazą są bieżące wagi', () => {
    const u = wagiZeZrozumienia(zRegulDla('Nie mam samochodu'), 'wynajmuje', WSKAZNIKI, BIEZACE)
    assert.equal(u.wagi.przystanek_odleglosc, 4)
    assert.equal(u.wagi.halas_ldwn, 1)
    assert.equal(u.wagi.sklep_odleglosc, 3) // codzienność ≥ 3
  })

  it('kategoria „mało ważne” od JEV obniża warstwy', () => {
    const z: Zrozumienie = {
      persona: 'senior',
      kategorie: { transport: 1 },
      wskazniki: {},
      potrzeby: [],
      zrozumialem: [],
    }
    const u = wagiZeZrozumienia(z, 'kupuje', WSKAZNIKI, BIEZACE)
    assert.equal(u.wagi.przystanek_odleglosc, 1)
    assert.equal(u.wagi.kursy_szczyt_h, 1)
    for (const w of Object.values(u.wagi)) assert.ok(w >= 0 && w <= 4)
  })
})
