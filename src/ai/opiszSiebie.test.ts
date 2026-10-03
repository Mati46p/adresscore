// Uruchom: node --test src/ai/
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { PERSONY } from '../wynik/persony.ts'
import type { OdpowiedzJev } from './jev.ts'
import {
  BRAMKA,
  bramkaZamknieta,
  ETYKIETY_KATEGORII,
  ID_PROFILU,
  KATEGORIE_JEV,
  nicNieZrozumiano,
  normalizuj,
  OPIS_PROFILU_NIEZNANEGO,
  OPISY_PROFILI_JEV,
  opiszSiebie,
  PIERWSZENSTWO_PERSON,
  POTRZEBY,
  POZIOMY_WAZNOSCI,
  PROG_BRAMKI,
  PROG_MOCNEJ_POTRZEBY,
  PROG_NIKT_NIE_SZUKA,
  PROG_PEWNOSCI,
  PROG_PROFILU,
  profilZMocnychPotrzeb,
  przetworzOdpowiedzi,
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

const [NIKT, NIEAKTUALNA] = BRAMKA.map((b) => b.id) as [string, string]
const noul = (x: number): OdpowiedzJev => ({ typ: 'noul', noul: x })

describe('zapytanieOpiszSiebie', () => {
  const z = zapytanieOpiszSiebie('Mam psa')
  const ids = Object.keys(z.pytania)

  it('stała kolejność: profil, 3 kategorie, potrzeby z twierdzeniem, dwa twierdzenia bramki', () => {
    const potrzebyJev = POTRZEBY.filter((p) => p.twierdzenie).map((p) => `p_${p.id}`)
    assert.deepEqual(ids, [
      ID_PROFILU,
      ...KATEGORIE_JEV.map((k) => `kat_${k}`),
      ...potrzebyJev,
      NIKT,
      NIEAKTUALNA,
    ])
    assert.equal(z.stan, 'Mam psa')
  })

  it('#147/#153: najwyżej 16 pytań (limit pośrednika) – bez „Przyszłości” i „Codzienności”', async () => {
    // Plik JS pośrednika bez typów – import dynamiczny, jak w pomiar.ts.
    const sciezka = new URL('../../api/_jev.js', import.meta.url).href
    const { LIMITY, sprawdzZapytanie } = (await import(sciezka)) as {
      LIMITY: { pytan: number }
      sprawdzZapytanie: (c: unknown) => { blad?: string }
    }
    assert.ok(ids.length <= LIMITY.pytan, `${ids.length} pytań`)
    assert.equal(LIMITY.pytan, 16)
    assert.equal(ids.length, 16)
    assert.ok(!ids.includes('kat_przyszlosc'))
    assert.ok(!ids.includes('kat_codziennosc'))
    for (const b of BRAMKA)
      assert.deepEqual(z.pytania[b.id], {
        typ: 'noul',
        polecenie: b.twierdzenie,
        kryteria: b.kryteria,
      })
    // Pośrednik przyjmuje to zapytanie bez zmian.
    assert.equal(sprawdzZapytanie(z).blad, undefined)
  })

  it('#163: kryteria prawda/fałsz tylko dla bramki i najsłabszych potrzeb, twierdzenia bez zmian', async () => {
    const sciezka = new URL('../../api/_jev.js', import.meta.url).href
    const { sprawdzZapytanie } = (await import(sciezka)) as {
      sprawdzZapytanie: (c: unknown) => {
        blad?: string
        pytania: Record<string, { criteria?: { true?: unknown; false?: unknown } }>
      }
    }
    const zKryteriami = Object.entries(z.pytania)
      .filter(([, p]) => p.typ === 'noul' && p.kryteria)
      .map(([id]) => id)
    assert.deepEqual(zKryteriami, ['p_dzieci', 'p_bez_samochodu', NIKT, NIEAKTUALNA])
    // Twierdzenia są te same co przed #163 – kryteria tylko dochodzą.
    assert.equal(
      BRAMKA[0].twierdzenie,
      'Tekst to tylko opinia albo ciekawość – nikt nie szuka mieszkania ani dla siebie, ani dla kogoś innego (np. taty, koleżanki), ani pod wynajem.',
    )
    assert.equal(
      POTRZEBY.find((p) => p.id === 'praca_centrum')?.kryteria,
      undefined,
      'praca w centrum: kryteria odrzucone na zbiorze do strojenia',
    )
    // Pośrednik przekłada je na criteria.true / criteria.false.
    const api = sprawdzZapytanie(z)
    assert.equal(api.blad, undefined)
    const nikt = api.pytania[NIKT]?.criteria
    assert.match(JSON.stringify(nikt?.true), /"what":"Nikt nie szuka/)
    assert.match(JSON.stringify(nikt?.false), /bez słowa „szukam”/)
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

  it('#155: opcje profilu mówią, kim jest osoba, a nie, co ceni (≤ 16 pytań bez zmian)', () => {
    const profil = z.pytania[ID_PROFILU]
    assert.equal(profil?.typ, 'choice')
    const kryteria = (profil?.typ === 'choice' ? profil.kryteria : {}) as Record<string, string>
    assert.deepEqual(kryteria, { ...OPISY_PROFILI_JEV, nieznany: OPIS_PROFILU_NIEZNANEGO })
    assert.match(kryteria.senior ?? '', /emerytur/)
    assert.match(kryteria.rodzina ?? '', /dziećmi w domu/)
    assert.match(kryteria.singiel ?? '', /mieszkająca sama/)
    assert.match(kryteria.inwestor ?? '', /pod wynajem/)
    // Opisy z UI („Komunikacja i sklepy pod ręką”) nie trafiają do JEV.
    const opisy = Object.values(kryteria)
    for (const p of PERSONY) for (const o of opisy) assert.ok(!o.includes(p.opis), p.id)
    assert.ok(ids.length <= 16)
    for (const o of opisy) assert.ok(o.length <= 120)
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

  // #162: oceny w testach to odpowiedzi JEV z pomiaru na żywo (WYNIKI.md, „Szukam dla kogoś (#162)”).
  it('#162: szukanie w imieniu taty – profil i potrzeby przyszłego mieszkańca zostają', async () => {
    // „Piszę w imieniu taty. Tata ma 79 lat… Szukamy mu kawalerki blisko przychodni i apteki…”
    const odp: Record<string, OdpowiedzJev | null> = {
      profil: { typ: 'choice', wybor: 'senior', pewnosc: 0.86 },
      p_zielen: noul(0.93),
      p_senior: noul(0.98),
      p_zdrowie: noul(0.96),
      p_dzieci: noul(0.06),
      [NIKT]: noul(0.01),
      [NIEAKTUALNA]: noul(0.03),
    }
    assert.equal(bramkaZamknieta(odp), false)
    const z = przetworzOdpowiedzi(odp)
    assert.equal(z?.persona, 'senior')
    assert.deepEqual(z?.potrzeby, ['zielen', 'senior', 'zdrowie'])
    // Ta sama ścieżka co w aplikacji: JEV, nie reguły, i wagi Seniora.
    const { fetchImpl } = zbudujFetch(200, { odpowiedzi: odp, powod: null })
    const w = await opiszSiebie('Piszę w imieniu taty, szukamy mu mieszkania', { fetch: fetchImpl })
    assert.equal(w.zrodlo, 'jev')
    assert.equal(w.wynik.persona, 'senior')
    assert.ok(w.wynik.potrzeby.includes('zdrowie'))
  })

  it('#162: szukanie dla koleżanki – liczą się jej dzieci, pies i brak auta (wcześniej bramka je odcinała)', () => {
    const odp: Record<string, OdpowiedzJev | null> = {
      profil: { typ: 'choice', wybor: 'rodzina', pewnosc: 0.98 },
      p_dzieci: noul(0.74),
      p_pies: noul(0.95),
      p_bez_samochodu: noul(0.95),
      [NIKT]: noul(0.02),
      [NIEAKTUALNA]: noul(0.04),
    }
    const z = przetworzOdpowiedzi(odp)
    assert.equal(z?.persona, 'rodzina')
    assert.deepEqual(z?.potrzeby, ['dzieci', 'pies', 'bez_samochodu'])
  })

  it('#162: ciekawość bez szukania („kumpel ma dzieci… ciekawe, czy tam głośno”) zamyka bramkę – profil bez zmian, tylko pewne potrzeby', () => {
    // Na żywo: `nikt_nie_szuka` 0,90, a profil Rodzina z pewnością 0,99.
    const odp: Record<string, OdpowiedzJev | null> = {
      profil: { typ: 'choice', wybor: 'rodzina', pewnosc: 0.99 },
      kat_spokoj: { typ: 'score', ocena: 4, pewnosc: 0.95 },
      p_dzieci: noul(0.89),
      p_pies: noul(0.96),
      [NIKT]: noul(0.9),
      [NIEAKTUALNA]: noul(0.05),
    }
    assert.equal(bramkaZamknieta(odp), true)
    const z = przetworzOdpowiedzi(odp)
    assert.ok(z)
    assert.equal(z.persona, null)
    assert.deepEqual(z.potrzeby, ['pies'])
    // Wagi: bez profilu bazą są bieżące, więc persona użytkownika się nie zmienia.
    const u = wagiZeZrozumienia(z, 'kupuje', WSKAZNIKI, BIEZACE)
    assert.equal(u.wagi.przystanek_odleglosc, BIEZACE.wagi.przystanek_odleglosc)
  })

  it('#162: czysta hipoteza bez szukania („Gdybyśmy kiedyś mieli dzieci…”) zamyka bramkę', () => {
    const z = przetworzOdpowiedzi({
      profil: { typ: 'choice', wybor: 'rodzina', pewnosc: 0.9 },
      p_dzieci: noul(0.57),
      p_zielen: noul(0.68),
      [NIKT]: noul(0.92),
      [NIEAKTUALNA]: noul(0.85),
    })
    assert.ok(z && nicNieZrozumiano(z))
  })

  it('#162: sytuacja dawna („Kiedyś mieszkaliśmy z dziećmi… to już nieaktualne”) zamyka bramkę', () => {
    // Sama `sytuacja_nieaktualna` wystarczy – `nikt_nie_szuka` może być pod swoim progiem.
    for (const nikt of [0.75, 0.3]) {
      const z = przetworzOdpowiedzi({
        profil: { typ: 'choice', wybor: 'senior', pewnosc: 0.95 },
        p_senior: noul(0.71),
        [NIKT]: noul(nikt),
        [NIEAKTUALNA]: noul(0.91),
      })
      assert.ok(z && nicNieZrozumiano(z), `nikt_nie_szuka ${nikt}`)
    }
  })

  it('#162: własna sytuacja bez słowa „szukam” – bramka otwarta, choć `nikt_nie_szuka` ma 0,50', () => {
    // „Mam 74 lata, sama już nie prowadzę…” – przy progu 0,5 ten opis tracił profil Senior.
    const odp: Record<string, OdpowiedzJev | null> = {
      profil: { typ: 'choice', wybor: 'senior', pewnosc: 0.99 },
      p_senior: noul(0.97),
      p_zdrowie: noul(0.95),
      p_bez_samochodu: noul(0.8),
      [NIKT]: noul(0.5),
      [NIEAKTUALNA]: noul(0.02),
    }
    assert.equal(bramkaZamknieta(odp), false)
    const z = przetworzOdpowiedzi(odp)
    assert.equal(z?.persona, 'senior')
    assert.deepEqual(z?.potrzeby, ['bez_samochodu', 'senior', 'zdrowie'])
  })

  it('#162: własna rodzina – bez zmian (profil i potrzeby)', () => {
    const z = przetworzOdpowiedzi({
      profil: { typ: 'choice', wybor: 'rodzina', pewnosc: 1 },
      p_dzieci: noul(0.98),
      p_pies: noul(0.98),
      p_bez_samochodu: noul(0.98),
      [NIKT]: noul(0.23),
      [NIEAKTUALNA]: noul(0.03),
    })
    assert.equal(z?.persona, 'rodzina')
    assert.deepEqual(z?.potrzeby, ['dzieci', 'pies', 'bez_samochodu'])
  })

  it('#153/#162: domownik („mama z nami zamieszka”) – bramka otwarta, profil Senior zostaje', () => {
    // Bramka z #147 („własna obecna sytuacja”) dawała tu 0,18–0,35 i profil przepadał.
    const odp: Record<string, OdpowiedzJev | null> = {
      profil: { typ: 'choice', wybor: 'senior', pewnosc: 0.9 },
      p_senior: noul(0.97),
      p_zdrowie: noul(0.95),
      [NIKT]: noul(0.1),
      [NIEAKTUALNA]: noul(0.08),
    }
    assert.equal(bramkaZamknieta(odp), false)
    const z = przetworzOdpowiedzi(odp)
    assert.equal(z?.persona, 'senior')
    assert.deepEqual(z?.potrzeby, ['senior', 'zdrowie'])
  })

  it('#162: inwestor – `nikt_nie_szuka` nie zamyka bramki, gdy JEV wybrał Inwestora', () => {
    // Pierwsza wersja twierdzenia dawała „Kupuję kawalerkę pod wynajem…” 0,54.
    const odp: Record<string, OdpowiedzJev | null> = {
      profil: { typ: 'choice', wybor: 'inwestor', pewnosc: 1 },
      [NIKT]: noul(0.9),
      [NIEAKTUALNA]: noul(0.04),
    }
    assert.equal(bramkaZamknieta(odp), false)
    const z = przetworzOdpowiedzi(odp)
    assert.equal(z?.persona, 'inwestor')
    assert.deepEqual(z?.potrzeby, ['inwestycja'])
    // Hipoteza inwestora („gdybym kiedyś kupił pod wynajem…”) nadal zamyka.
    assert.equal(bramkaZamknieta({ ...odp, [NIEAKTUALNA]: noul(0.8) }), true)
  })

  it('#162: bramka nie pyta już o „cudzą osobę” – szukanie dla kogoś innego to nie powód do zamknięcia', () => {
    const ids = BRAMKA.map((b) => b.id)
    assert.deepEqual(ids, ['nikt_nie_szuka', 'sytuacja_nieaktualna'])
    const nikt = BRAMKA[0].twierdzenie
    assert.match(nikt, /dla kogoś innego/)
    assert.match(nikt, /pod wynajem/)
    assert.equal(BRAMKA[0].prog, PROG_NIKT_NIE_SZUKA)
    assert.equal(BRAMKA[1].prog, PROG_BRAMKI)
    assert.ok(PROG_NIKT_NIE_SZUKA > PROG_BRAMKI)
  })

  it('#147: tekst bez szukania i bez pewnych potrzeb → „nic nie zrozumiano” od JEV, nie reguły', async () => {
    const odp = {
      profil: { typ: 'choice', wybor: 'rodzina', pewnosc: 0.9 },
      p_dzieci: noul(0.85),
      [NIKT]: noul(0.92),
    }
    const z = przetworzOdpowiedzi(odp as Record<string, OdpowiedzJev | null>)
    assert.ok(z && nicNieZrozumiano(z))
    const { fetchImpl } = zbudujFetch(200, { odpowiedzi: odp, powod: null })
    const w = await opiszSiebie('Kumpel ma trójkę dzieci i psa, ciekawe jak mu się mieszka', {
      fetch: fetchImpl,
    })
    assert.equal(w.zrodlo, 'jev')
    assert.ok(nicNieZrozumiano(w.wynik), 'reguły złapałyby dzieci i psa kumpla')
  })

  it('#153/#162: bramka tuż pod progiem albo bez odpowiedzi → otwarta, jak dotąd; na progu – zamknięta', () => {
    const baza: Record<string, OdpowiedzJev | null> = {
      profil: { typ: 'choice', wybor: 'rodzina', pewnosc: 0.95 },
      p_dzieci: noul(0.8),
    }
    for (const b of [
      { [NIKT]: noul(PROG_NIKT_NIE_SZUKA - 0.01) },
      { [NIEAKTUALNA]: noul(PROG_BRAMKI - 0.01) },
      { [NIKT]: null },
      {},
    ]) {
      const z = przetworzOdpowiedzi({ ...baza, ...b })
      assert.equal(z?.persona, 'rodzina')
      assert.deepEqual(z?.potrzeby, ['dzieci'])
    }
    assert.equal(bramkaZamknieta({ ...baza, [NIEAKTUALNA]: noul(PROG_BRAMKI) }), true)
    assert.equal(bramkaZamknieta({ ...baza, [NIKT]: noul(PROG_NIKT_NIE_SZUKA) }), true)
  })

  it('#147: profil Inwestor niesie przyszłość okolicy (potrzeba z tabeli, bez liczby JEV)', () => {
    const z = przetworzOdpowiedzi({ profil: { typ: 'choice', wybor: 'inwestor', pewnosc: 0.9 } })
    assert.deepEqual(z?.potrzeby, ['inwestycja'])
    assert.equal(z?.kategorie.przyszlosc, 4)
  })

  it('bez pewnego profilu persona wynika z mocnych potrzeb (bez procentu)', () => {
    const z = przetworzOdpowiedzi({
      profil: { typ: 'choice', wybor: 'singiel', pewnosc: 0.4 },
      p_senior: { typ: 'noul', noul: 0.9 },
    })
    assert.equal(z?.persona, 'senior')
    assert.deepEqual(z?.zrozumialem[0], { rodzaj: 'profil', etykieta: 'Senior', procent: null })
  })
})

describe('#155: próg profilu i profil z mocnych potrzeb', () => {
  const profil = (wybor: string, pewnosc: number): OdpowiedzJev => ({
    typ: 'choice',
    wybor,
    pewnosc,
  })

  it('próg profilu 0,85 – osobny od progu kategorii (0,6)', () => {
    assert.equal(PROG_PROFILU, 0.85)
    assert.equal(PROG_PEWNOSCI, 0.6)
    assert.equal(PROG_MOCNEJ_POTRZEBY, 0.9)
    const baza = { p_zielen: noul(0.7) }
    // Na progu – profil od JEV, z procentem.
    const na = przetworzOdpowiedzi({ ...baza, profil: profil('singiel', PROG_PROFILU) })
    assert.equal(na?.persona, 'singiel')
    assert.deepEqual(na?.zrozumialem[0], {
      rodzaj: 'profil',
      etykieta: 'Singiel w centrum',
      procent: 85,
    })
    // Tuż pod progiem (dawniej wystarczało 0,6) – profil bez zmian, potrzeby zostają.
    for (const p of [PROG_PROFILU - 0.01, 0.7, 0.6]) {
      const pod = przetworzOdpowiedzi({ ...baza, profil: profil('singiel', p) })
      assert.equal(pod?.persona, null, String(p))
      assert.deepEqual(pod?.potrzeby, ['zielen'])
    }
  })

  it('pod progiem: senior ≥ 0,9 → Senior, dzieci ≥ 0,9 → Rodzina', () => {
    const s = przetworzOdpowiedzi({ profil: profil('singiel', 0.5), p_senior: noul(0.9) })
    assert.equal(s?.persona, 'senior')
    const r = przetworzOdpowiedzi({ profil: profil('nieznany', 0.99), p_dzieci: noul(0.95) })
    assert.equal(r?.persona, 'rodzina')
    // Bez odpowiedzi o profil też.
    assert.equal(przetworzOdpowiedzi({ p_dzieci: noul(0.92) })?.persona, 'rodzina')
    // Wysoka pewność wygrywa z potrzebą: JEV pewny Inwestora, a w tekście dzieci.
    const i = przetworzOdpowiedzi({ profil: profil('inwestor', 0.95), p_dzieci: noul(0.95) })
    assert.equal(i?.persona, 'inwestor')
    assert.deepEqual(i?.potrzeby, ['dzieci', 'inwestycja'])
  })

  it('pod progiem: inwestor i singiel ze słów, ale tylko gdy JEV wskazał ten sam profil', () => {
    const inw = przetworzOdpowiedzi(
      { profil: profil('inwestor', 0.7), p_zielen: noul(0.7) },
      'Kupuję kawalerkę pod wynajem',
    )
    assert.equal(inw?.persona, 'inwestor')
    // Inwestor niesie przyszłość okolicy także z zapasu.
    assert.deepEqual(inw?.potrzeby, ['zielen', 'inwestycja'])
    assert.equal(inw?.kategorie.przyszlosc, 4)

    const sam = przetworzOdpowiedzi(
      { profil: profil('singiel', 0.6), p_rower: noul(0.8) },
      'Mieszkam sama, jeżdżę rowerem',
    )
    assert.equal(sam?.persona, 'singiel')
    assert.equal(sam?.zrozumialem[0]?.procent, null)

    // Te same słowa, ale JEV wskazał inny profil albo „nieznany” – bez zmian.
    for (const wybor of ['rodzina', 'nieznany']) {
      const z = przetworzOdpowiedzi(
        { profil: profil(wybor, 0.7), p_rower: noul(0.8) },
        'Mieszkam sama, jeżdżę rowerem',
      )
      assert.equal(z?.persona, null, wybor)
    }
    // Przeczenie gasi słowo jak w regułach.
    const nie = przetworzOdpowiedzi(
      { profil: profil('singiel', 0.6), p_rower: noul(0.8) },
      'Nie mieszkam sama, jeżdżę rowerem',
    )
    assert.equal(nie?.persona, null)
  })

  it('kolejność przy kilku mocnych potrzebach: inwestor, senior, rodzina, singiel', () => {
    assert.deepEqual(PIERWSZENSTWO_PERSON, ['inwestor', 'senior', 'rodzina', 'singiel'])
    const odp = { p_dzieci: noul(0.95), p_senior: noul(0.95) }
    // Senior przed Rodziną (wnuki, dorosłe dzieci).
    assert.equal(profilZMocnychPotrzeb(odp, ''), 'senior')
    assert.equal(przetworzOdpowiedzi({ ...odp, profil: profil('rodzina', 0.6) })?.persona, 'senior')
    // Inwestor przed wszystkimi: sam nie zamieszka, więc dzieci i wiek nie ustawiają wag.
    assert.equal(
      profilZMocnychPotrzeb(
        { ...odp, profil: profil('inwestor', 0.7) },
        'Kupuję pod wynajem, mam dzieci i jestem na emeryturze',
      ),
      'inwestor',
    )
    // Singiel ostatni.
    assert.equal(
      profilZMocnychPotrzeb(
        { p_dzieci: noul(0.95), profil: profil('singiel', 0.7) },
        'Mieszkam sam',
      ),
      'rodzina',
    )
  })

  it('bez mocnej potrzeby profil zostaje bez zmian (dawniej wystarczało 0,6)', () => {
    // Stary A06: „Kumpel ma trójkę dzieci… szukamy z partnerką” – Rodzina 0,66, dzieci 0,81.
    const odp: Record<string, OdpowiedzJev | null> = {
      profil: profil('rodzina', 0.66),
      p_dzieci: noul(0.81),
      p_zielen: noul(0.9),
      kat_spokoj: { typ: 'score', ocena: 4, pewnosc: 0.9 },
      [NIKT]: noul(0.18),
    }
    assert.equal(profilZMocnychPotrzeb(odp, 'Kumpel ma trójkę dzieci'), null)
    const z = przetworzOdpowiedzi(odp, 'Kumpel ma trójkę dzieci')
    assert.ok(z)
    assert.equal(z.persona, null)
    // Potrzeby nad progiem 0,6 dalej się liczą – zmienia się tylko profil.
    assert.deepEqual(z.potrzeby, ['dzieci', 'zielen'])
    assert.equal(
      z.zrozumialem.some((p) => p.rodzaj === 'profil'),
      false,
    )
    // Bazą wag są bieżące wagi użytkownika, a nie wagi Rodziny.
    const u = wagiZeZrozumienia(z, 'kupuje', WSKAZNIKI, BIEZACE)
    assert.equal(u.persona, 'wlasna')
    assert.equal(u.wagi.przystanek_odleglosc, BIEZACE.wagi.przystanek_odleglosc)
    // Mocna potrzeba tuż pod progiem też nic nie zmienia.
    assert.equal(
      profilZMocnychPotrzeb({ p_senior: noul(PROG_MOCNEJ_POTRZEBY - 0.01) }, 'jestem emerytką'),
      null,
    )
  })

  it('profil pod progiem i nic innego pewnego → null, czyli reguły (jak dotąd)', () => {
    assert.equal(
      przetworzOdpowiedzi({ profil: profil('inwestor', 0.7) }, 'Kupuję pod wynajem'),
      null,
    )
  })

  it('bramka zamknięta wygrywa z zapasem z potrzeb – profil bez zmian', () => {
    const z = przetworzOdpowiedzi(
      { profil: profil('rodzina', 0.6), p_dzieci: noul(0.95), [NIKT]: noul(0.9) },
      'Koleżanka ma dzieci, ciekawe, jak jej się tam mieszka',
    )
    assert.equal(z?.persona, null)
    assert.deepEqual(z?.potrzeby, ['dzieci'])
  })

  it('opiszSiebie podaje tekst do zapasu profilu', async () => {
    const { fetchImpl } = zbudujFetch(200, {
      odpowiedzi: { profil: profil('inwestor', 0.7), p_zielen: noul(0.7) },
      powod: null,
    })
    const w = await opiszSiebie('Kupuję mieszkanie pod wynajem, blisko parku', {
      fetch: fetchImpl,
    })
    assert.equal(w.zrodlo, 'jev')
    assert.equal(w.wynik.persona, 'inwestor')
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
      'kat_transport',
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
