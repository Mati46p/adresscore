// Uruchom: node --test src/ai/
import assert from 'node:assert/strict'
import { closeSync, openSync, readdirSync, readFileSync, readSync } from 'node:fs'
import { describe, it } from 'node:test'
import type { WskaznikMeta } from '../kontrakty/index.ts'
import { PERSONY } from '../wynik/persony.ts'
import { kierunekEfektywny } from '../wynik/silnik.ts'
import type { OdpowiedzJev, OpisOpcji } from './jev.ts'
import {
  BRAMKA,
  bramkaZamknieta,
  ETYKIETY_KATEGORII,
  ID_PROFILU,
  KATEGORIE_JEV,
  NA_NIE,
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
  PROG_POTRZEBY,
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
  { id: 'inwestycje_500m', kategoria: 'spolecznosc' },
  { id: 'powodz_10proc', kategoria: 'bezpieczenstwo' },
  { id: 'udzial_0_14', kategoria: 'kontekst' },
] as const

const BIEZACE = { wagi: { halas_ldwn: 1, przystanek_odleglosc: 2 }, kierunki: {} }

const [NIKT, NIEAKTUALNA] = BRAMKA.map((b) => b.id) as [string, string]
/** #183: nowe potrzeby – id ze słownika zbioru nr 8. */
const NOWE_183 = ['auto', 'wozek', 'praca_zdalna', 'zycie_nocne', 'sport', 'student'] as const
const noul = (x: number): OdpowiedzJev => ({ typ: 'noul', noul: x })

describe('zapytanieOpiszSiebie', () => {
  const z = zapytanieOpiszSiebie('Mam psa')
  const ids = Object.keys(z.pytania)

  it('stała kolejność: profil, 3 kategorie, potrzeby, „nie chcę” (#182), bramka – bez siły (#187)', () => {
    const potrzebyJev = POTRZEBY.filter((p) => p.twierdzenie).map((p) => `p_${p.id}`)
    assert.deepEqual(ids, [
      ID_PROFILU,
      ...KATEGORIE_JEV.map((k) => `kat_${k}`),
      ...potrzebyJev,
      ...NA_NIE.map((n) => `n_${n.id}`),
      NIKT,
      NIEAKTUALNA,
    ])
    assert.equal(z.stan, 'Mam psa')
  })

  it('#147/#153/#183/#182/#187: 29 pytań (limit pośrednika 32) – bez „Przyszłości” i „Codzienności”', async () => {
    // Plik JS pośrednika bez typów – import dynamiczny, jak w pomiar.ts.
    const sciezka = new URL('../../api/_jev.js', import.meta.url).href
    const { LIMITY, sprawdzZapytanie } = (await import(sciezka)) as {
      LIMITY: { pytan: number }
      sprawdzZapytanie: (c: unknown) => { blad?: string }
    }
    assert.ok(ids.length <= LIMITY.pytan, `${ids.length} pytań`)
    // #183: 22 pytania; #182: + 7 „nie chcę” = 29 (#187: 3 pytania o siłę cofnięte). Limit 32.
    assert.equal(LIMITY.pytan, 32)
    assert.equal(ids.length, 29)
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
    assert.deepEqual(zKryteriami, [
      'p_dzieci',
      'p_bez_samochodu',
      // #183: każda nowa potrzeba ma kryteria od początku.
      ...NOWE_183.map((id) => `p_${id}`),
      ...NA_NIE.map((n) => `n_${n.id}`),
      NIKT,
      NIEAKTUALNA,
    ])
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

  it('mieści się w limitach pośrednika (≤ 32 pytań, id i polecenia)', () => {
    assert.ok(ids.length <= 32)
    for (const [id, p] of Object.entries(z.pytania)) {
      assert.match(id, /^[a-z0-9_-]{1,40}$/i)
      assert.ok(p.polecenie.length <= 300, id)
    }
  })

  it('profil wybiera z PERSONY bez „Od zera” plus „nieznany”', () => {
    const profil = z.pytania[ID_PROFILU]
    assert.equal(profil?.typ, 'choice')
    if (profil?.typ !== 'choice') return
    // Wszystkie profile z PERSONY w ich kolejności (cztery stare na początku, jak w #155).
    assert.deepEqual(Object.keys(profil.kryteria), [
      ...PERSONY.filter((p) => p.id !== 'od-zera').map((p) => p.id),
      'nieznany',
    ])
    assert.deepEqual(Object.keys(profil.kryteria).slice(0, 4), [
      'rodzina',
      'singiel',
      'senior',
      'inwestor',
    ])
    // Pełny rekord: każda persona poza „Od zera” ma opis (nowa persona bez opisu = czerwono).
    for (const p of PERSONY) assert.equal(p.id in OPISY_PROFILI_JEV, p.id !== 'od-zera', p.id)
  })

  it('#155: opcje profilu mówią, kim jest osoba, a nie, co ceni (≤ 32 pytań)', () => {
    const profil = z.pytania[ID_PROFILU]
    assert.equal(profil?.typ, 'choice')
    const kryteria: Record<string, OpisOpcji> = profil?.typ === 'choice' ? profil.kryteria : {}
    // Kopia do porównania – `deepEqual` zawęża typ argumentu do typu wzorca.
    assert.deepEqual({ ...kryteria }, { ...OPISY_PROFILI_JEV, nieznany: OPIS_PROFILU_NIEZNANEGO })
    const co = (id: string) => {
      const o = kryteria[id]
      return typeof o === 'string' ? o : (o?.co ?? '')
    }
    // Cztery opisy z #155: trzy bez zmian, Singiel bez „studiująca” (jest profil Student).
    assert.match(co('senior'), /emerytur/)
    assert.match(co('rodzina'), /dziećmi w domu/)
    assert.match(co('singiel'), /mieszkająca sama/)
    assert.doesNotMatch(co('singiel'), /studiuj/)
    assert.match(co('inwestor'), /pod wynajem/)
    assert.match(co('student'), /studiuje/)
    assert.match(co('alergik'), /astm/)
    // Opisy z UI („Komunikacja i sklepy pod ręką”) nie trafiają do JEV.
    const teksty = Object.values(kryteria).flatMap((o) =>
      typeof o === 'string'
        ? [o]
        : [o.co, ...(o.nie_dla ? [o.nie_dla] : []), ...(o.przyklady ?? [])],
    )
    for (const p of PERSONY) for (const t of teksty) assert.ok(!t.includes(p.opis), p.id)
    assert.ok(ids.length <= 32)
    // Limit pośrednika na pole opisu; `co` krótkie, żeby opcje dało się porównać.
    for (const t of teksty) assert.ok(t.length <= 300, t)
    for (const id of Object.keys(kryteria)) assert.ok(co(id).length <= 160, id)
    // Profile „z jednej cechy” mówią, kiedy wygrywa Rodzina, Senior albo Inwestor.
    for (const id of ['psiarz', 'rowerzysta', 'zdalny', 'aktywny', 'kierowca', 'alergik']) {
      const o = kryteria[id]
      assert.ok(typeof o === 'object' && /dzieci/.test(o.nie_dla ?? ''), id)
    }
  })

  it('opcje profilu mieszczą się w limitach pośrednika i całe zapytanie daleko od 60 tys. znaków', async () => {
    const sciezka = new URL('../../api/_jev.js', import.meta.url).href
    const { LIMITY, sprawdzZapytanie } = (await import(sciezka)) as {
      LIMITY: { opcjiChoice: number; pytaniaZnakow: number }
      sprawdzZapytanie: (c: unknown) => { blad?: string; pytania: unknown }
    }
    const profil = z.pytania[ID_PROFILU]
    assert.equal(profil?.typ, 'choice')
    const n = profil?.typ === 'choice' ? Object.keys(profil.kryteria).length : 0
    assert.ok(n >= 2 && n <= LIMITY.opcjiChoice, String(n))
    const api = sprawdzZapytanie(z)
    assert.equal(api.blad, undefined)
    // Dziś ok. 14,3 tys. znaków (było 11,1 tys. przy czterech profilach).
    assert.ok(JSON.stringify(api.pytania).length < LIMITY.pytaniaZnakow / 3)
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
    assert.equal(z?.kategorie.spolecznosc, 4)
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

// #180: wraca reguła sprzed #172 – poziom kategorii to zaokrąglona `ocena` (0–4), liczona tylko
// przy pewności ≥ PROG_PEWNOSCI (0,6) albo bez pewności. Rozkład `prawdopodobienstwa` nie wpływa
// na poziom (#172 liczył go z oczekiwanego poziomu i progów 3,55 / 2,65 / 1,2 / 0,7).
describe('#180: poziom kategorii z oceny i progu pewności (jak przed #172)', () => {
  const kat = (ocena: number, pewnosc: number | null, p?: number[]): OdpowiedzJev => ({
    typ: 'score',
    ocena,
    pewnosc,
    ...(p ? { prawdopodobienstwa: Object.fromEntries(p.map((x, i) => [String(i), x])) } : {}),
  })
  const poziom = (o: OdpowiedzJev) => przetworzOdpowiedzi({ kat_transport: o })?.kategorie.transport

  it('próg pewności kategorii 0,6: na progu poziom jest, tuż pod nim – nie ma', () => {
    assert.equal(PROG_PEWNOSCI, 0.6)
    assert.equal(poziom(kat(3.38, 0.6)), 3)
    assert.equal(poziom(kat(3.38, 0.59)), undefined)
    // Sama kategoria pod progiem to „nic pewnego” → null (reguły).
    assert.equal(przetworzOdpowiedzi({ kat_transport: kat(4, 0.59) }), null)
    // Bez pewności (null) – wierzymy ocenie.
    assert.equal(poziom(kat(0.4, null)), 0)
  })

  it('poziom = zaokrąglona ocena przycięta do 0–4; środek skali (2) nic nie zmienia', () => {
    const przypadki: [number, number | undefined][] = [
      [3.5, 4],
      [3.49, 3],
      [2.5, 3],
      [2.49, undefined],
      [1.5, undefined],
      [1.49, 1],
      [0.5, 1],
      [0.49, 0],
      [4.3, 4],
      [-0.2, 0],
    ]
    for (const [ocena, oczekiwany] of przypadki)
      assert.equal(poziom(kat(ocena, 0.9)), oczekiwany, String(ocena))
  })

  it('rozkład prawdopodobieństw nie zmienia poziomu (liczy się `ocena` i pewność)', () => {
    // Pół na pół „Ważne” i „Bardzo ważne” (ocena 3,5) → „Bardzo ważne”, jak przed #172.
    assert.equal(poziom(kat(3.5, 0.6, [0, 0, 0, 0.5, 0.5])), 4)
    // Ten sam rozkład, a ocena inna – wygrywa ocena.
    assert.equal(poziom(kat(1, 0.9, [0, 0, 0, 0.5, 0.5])), 1)
    // A07 z A/A (#170): pewność 0,59 / 0,64 → raz nic, raz „Ważne” (to, co #172 próbował zmienić).
    assert.equal(poziom(kat(3.38, 0.59, [0, 0, 0.05, 0.52, 0.43])), undefined)
    assert.equal(poziom(kat(3.26, 0.64, [0, 0.01, 0.07, 0.57, 0.35])), 3)
  })
})

describe('#155: próg profilu i profil z mocnych potrzeb', () => {
  const profil = (wybor: string, pewnosc: number): OdpowiedzJev => ({
    typ: 'choice',
    wybor,
    pewnosc,
  })

  it('próg profilu 0,85 – osobny od progu potrzeby (0,6)', () => {
    assert.equal(PROG_PROFILU, 0.85)
    assert.equal(PROG_POTRZEBY, 0.6)
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
    assert.equal(inw?.kategorie.spolecznosc, 4)

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

  it('kolejność przy kilku mocnych potrzebach: inwestor, senior, rodzina, profile z jednej cechy, singiel', () => {
    assert.deepEqual(PIERWSZENSTWO_PERSON.slice(0, 3), ['inwestor', 'senior', 'rodzina'])
    assert.equal(PIERWSZENSTWO_PERSON.at(-1), 'singiel')
    // Każdy profil, który daje jakaś potrzeba, jest na liście – inaczej `personaZPotrzeb` go gubi.
    for (const p of POTRZEBY)
      if (p.persona) assert.ok(PIERWSZENSTWO_PERSON.includes(p.persona), p.id)
    assert.equal(new Set(PIERWSZENSTWO_PERSON).size, PIERWSZENSTWO_PERSON.length)
    // Rodzina z psem albo z autem to Rodzina (`nie_dla` profili z jednej cechy).
    assert.equal(profilZMocnychPotrzeb({ p_dzieci: noul(0.95), p_pies: noul(0.95) }, ''), 'rodzina')
    assert.equal(profilZMocnychPotrzeb({ p_auto: noul(0.95), p_senior: noul(0.95) }, ''), 'senior')
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
    // Profile z pełnych opisów dla JEV: rower na co dzień → Rowerzysta.
    ['Dojeżdżam rowerem do biura na Rynku', ['rower', 'praca_centrum'], 'rowerzysta'],
    ['Nie mam dzieci, liczy się dojazd do pracy', ['praca_centrum'], null],
    ['Córka idzie do przedszkola, chcemy park obok', ['dzieci', 'zielen'], 'rodzina'],
    // Astma to potrzeba `alergia` i profil Alergik; „smog” dalej daje `powietrze`.
    ['Mam astmę, smog to dla mnie problem', ['powietrze', 'alergia'], 'alergik'],
    ['Kupuję mieszkanie pod wynajem jako inwestycję', ['inwestycja'], 'inwestor'],
    [
      'Student, mieszkam sam, lubię mieć sklep pod domem',
      ['sklepy', 'singiel', 'student'],
      'student',
    ],
    ['Boję się powodzi, poprzednie mieszkanie zalało', ['bezpieczenstwo'], null],
    ['Często latam służbowo, lotnisko musi być blisko', ['lotnisko'], null],
    // #183: parking to potrzeba `auto` (przed #183 – nic).
    ['Szukam miejsca z miejscem parkingowym', ['auto'], 'kierowca'],
    ['Babcia z wnukami, spokojna okolica', ['senior', 'cisza'], 'senior'],
    ['Lubię dobrą kawę', [], null],
    // Warstwy z nocy 3/4.10 (#136, #138–#142): tylko reguły, bez nowych pytań do JEV.
    ['Chcę niskie opłaty, liczę każdy koszt', ['koszty'], null],
    ['Do pracy dojeżdżam pociągiem', ['kolej', 'bez_samochodu', 'praca_centrum'], null],
    ['Zależy mi na aktywnych sąsiadach', ['sasiedzi'], null],
    // Profile spoza zbiorów pomiarowych – tylko z reguł (bez nowych pytań do JEV).
    ['Mam alergię na pyłki', ['alergia'], 'alergik'],
    ['Chodzę do teatru i muzeów, kino blisko to podstawa', ['kultura'], 'kultura'],
    ['Szukam w pobliżu galerii handlowej', [], null],
    ['Nie chcę koncertów pod oknem', [], null],
    ['Kupuję działkę budowlaną, chcemy postawić dom', ['budowa_domu'], 'budowa-domu'],
    ['Mam działkę ROD i lubię tam jeździć', [], null],
    [
      'Boję się kradzieży i włamań, okolica musi być bezpieczna',
      ['przestepczosc', 'bezpieczenstwo'],
      'bezpieczenstwo',
    ],
    // Rodzina wygrywa z profilem z jednej cechy (PIERWSZENSTWO_PERSON).
    ['Mamy dzieci, psa i auto', ['dzieci', 'pies', 'auto'], 'rodzina'],
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
    assert.equal(u.wagi.halas_ldwn, 4) // „rodzina” 4, spokój ≥ 3 nie obniża
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

// #177: tabela POTRZEBY a warstwy z manifestu – zmiana warstw ma dać czerwony test, a nie cichą
// utratę wagi (nieznane id w `wagiZeZrozumienia` nic nie robi).
const KATALOG_WARSTW = 'public/dane/wskazniki'
/** Sam `meta` z początku pliku warstwy (pliki mają do kilku MB); w razie kłopotu – cały plik. */
function metaWarstwy(plik: string): WskaznikMeta {
  const sciezka = `${KATALOG_WARSTW}/${plik}`
  const fd = openSync(sciezka, 'r')
  const bufor = Buffer.alloc(64 * 1024)
  const n = readSync(fd, bufor, 0, bufor.length, 0)
  closeSync(fd)
  const poczatek = bufor.toString('utf8', 0, n)
  const koniec = poczatek.indexOf(',"wersjaAdresow"')
  if (poczatek.startsWith('{"meta":') && koniec > 0) {
    try {
      return JSON.parse(poczatek.slice('{"meta":'.length, koniec)) as WskaznikMeta
    } catch {}
  }
  return JSON.parse(readFileSync(sciezka, 'utf8')).meta as WskaznikMeta
}
const MANIFEST = new Map(
  readdirSync(KATALOG_WARSTW)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      const m = metaWarstwy(f)
      return [m.id, m] as const
    }),
)

describe('#177: tabela POTRZEBY a manifest warstw', () => {
  it('manifest jest wczytany (ponad 100 warstw)', () => {
    assert.ok(MANIFEST.size > 100, `${MANIFEST.size}`)
  })

  it('każde id warstwy z POTRZEBY istnieje w public/dane/wskazniki', () => {
    for (const p of POTRZEBY)
      for (const id of [...Object.keys(p.wskazniki), ...Object.keys(p.kierunki ?? {})])
        assert.ok(MANIFEST.has(id), `${p.id}: nieznana warstwa ${id}`)
  })

  it('wagi to liczby całkowite 1–4, kierunki to poprawne wartości i mają wagę w tej potrzebie', () => {
    for (const p of POTRZEBY) {
      for (const [id, w] of Object.entries(p.wskazniki))
        assert.ok(Number.isInteger(w) && w >= 1 && w <= 4, `${p.id}: ${id} = ${w}`)
      for (const [id, k] of Object.entries(p.kierunki ?? {})) {
        assert.ok(k === 'mniej-lepiej' || k === 'wiecej-lepiej', `${p.id}: ${id} = ${k}`)
        assert.ok(p.wskazniki[id] !== undefined, `${p.id}: kierunek ${id} bez wagi`)
      }
    }
  })

  it('każda warstwa potrzeby naprawdę liczy się w silniku (kierunek po nadpisaniu)', () => {
    for (const p of POTRZEBY)
      for (const id of Object.keys(p.wskazniki)) {
        const meta = MANIFEST.get(id)
        assert.ok(meta, id)
        assert.notEqual(
          kierunekEfektywny(meta, p.kierunki),
          null,
          `${p.id}: ${id} (${meta.kategoria}, ${meta.kierunek}) nie wchodzi do wyniku`,
        )
      }
  })

  it('dwie potrzeby nie dają tej samej warstwie sprzecznych kierunków', () => {
    // #183: jedyny wyjątek – bary w 300 m: „cisza” chce mniej, „życie nocne” więcej. Przy obu
    // potrzebach wygrywa wcześniejsza w tabeli (cisza), test niżej to pilnuje.
    const WYJATKI = new Set(['zycie_nocne:zycie_nocne_300m'])
    const kierunki = new Map<string, string>()
    for (const p of POTRZEBY)
      for (const [id, k] of Object.entries(p.kierunki ?? {})) {
        if (WYJATKI.has(`${p.id}:${id}`)) continue
        assert.ok(!kierunki.has(id) || kierunki.get(id) === k, `${p.id}: ${id}`)
        kierunki.set(id, k)
      }
  })
})

describe('#177: wagiZeZrozumienia – składanie z potrzeb', () => {
  const WARSTWY = [
    ...WSKAZNIKI,
    { id: 'weterynarz_odleglosc', kategoria: 'codziennosc' },
    { id: 'zycie_nocne_300m', kategoria: 'spokoj' },
    { id: 'kapielisko_odleglosc', kategoria: 'spokoj' },
    { id: 'teren_osuwiskowy', kategoria: 'bezpieczenstwo' },
  ] as const

  it('potrzeba nadaje kierunek warstwie neutralnej i daje „własne” ustawienia', () => {
    // Bez profilu (reguły dają dziś Z psem) – test dotyczy samej potrzeby na bieżących wagach.
    const pies: Zrozumienie = { ...zRegul('Mamy psa'), persona: null }
    const u = wagiZeZrozumienia(pies, 'kupuje', WARSTWY, BIEZACE)
    assert.equal(u.wagi.weterynarz_odleglosc, 3)
    assert.equal(u.kierunki.weterynarz_odleglosc, 'mniej-lepiej')
    const z: Zrozumienie = { ...zRegul('Mamy psa'), persona: 'rodzina' }
    assert.equal(wagiZeZrozumienia(z, 'kupuje', WARSTWY, BIEZACE).persona, 'wlasna')
  })

  it('kierunek z bieżących ustawień (albo profilu) wygrywa z kierunkiem potrzeby', () => {
    const biezace = { wagi: {}, kierunki: { zycie_nocne_300m: 'wiecej-lepiej' as const } }
    const u = wagiZeZrozumienia(zRegul('Szukam ciszy'), 'kupuje', WARSTWY, biezace)
    assert.equal(u.wagi.zycie_nocne_300m, 3)
    assert.equal(u.kierunki.zycie_nocne_300m, 'wiecej-lepiej')
  })

  it('kierunek tylko dla warstw z manifestu', () => {
    const u = wagiZeZrozumienia(zRegul('Mamy psa'), 'kupuje', WSKAZNIKI, BIEZACE)
    assert.equal(u.kierunki.weterynarz_odleglosc, undefined)
  })

  it('poziom kategorii z samych potrzeb nie zmienia wag profilu (potrzeba ma swoje warstwy)', () => {
    // „zieleń” = spokój 4, ale hałas Singla (1) i PM2,5 (2) zostają; zieleń idzie na 4.
    const z: Zrozumienie = { ...zRegul('Chcę mieć blisko park'), persona: 'singiel' }
    const u = wagiZeZrozumienia(z, 'kupuje', WARSTWY, BIEZACE)
    assert.equal(u.wagi.halas_ldwn, 1)
    assert.equal(u.wagi.pm25_srednia, 2)
    assert.equal(u.wagi.zielen_udzial, 4)
    assert.equal(u.wagi.kapielisko_odleglosc, 0)
  })

  it('poziom od JEV ≥ 3 podnosi tylko warstwy, które profil już liczy', () => {
    const z: Zrozumienie = {
      persona: 'singiel',
      kategorie: { spokoj: 4, bezpieczenstwo: 4 },
      wskazniki: {},
      potrzeby: [],
      zrozumialem: [],
    }
    const u = wagiZeZrozumienia(z, 'kupuje', WARSTWY, BIEZACE)
    assert.equal(u.wagi.halas_ldwn, 4)
    assert.equal(u.wagi.pm25_srednia, 4)
    assert.equal(u.wagi.powodz_10proc, 4)
    assert.equal(u.wagi.kapielisko_odleglosc, 0)
    assert.equal(u.wagi.zielen_udzial, 0)
    assert.equal(u.wagi.teren_osuwiskowy, 0)
  })
})

describe('#183: nowe potrzeby – auto, wózek, praca zdalna, życie nocne, sport, student', () => {
  const potrzeba = (id: string) => {
    const p = POTRZEBY.find((x) => x.id === id)
    assert.ok(p, id)
    return p
  }

  it('są w tabeli na końcu, w tej kolejności, każda z twierdzeniem i kryteriami prawda/fałsz', () => {
    assert.deepEqual(
      POTRZEBY.slice(-NOWE_183.length).map((p) => p.id),
      [...NOWE_183],
    )
    for (const id of NOWE_183) {
      const p = potrzeba(id)
      assert.ok(p.twierdzenie, id)
      assert.ok(p.kryteria?.prawda && p.kryteria.falsz, id)
      assert.doesNotMatch(p.twierdzenie ?? '', /\si\s/, id)
      assert.ok(Object.keys(p.wskazniki).length >= 3, id)
    }
  })

  it('każda warstwa nowej potrzeby jest w manifeście, nie jest atrapą i liczy się w silniku', () => {
    for (const id of NOWE_183) {
      const p = potrzeba(id)
      for (const w of Object.keys(p.wskazniki)) {
        const meta = MANIFEST.get(w)
        assert.ok(meta, `${id}: ${w}`)
        assert.ok(!meta.atrapa, `${id}: ${w} to atrapa`)
        assert.notEqual(meta.kategoria, 'kontekst', `${id}: ${w}`)
        assert.notEqual(kierunekEfektywny(meta, p.kierunki), null, `${id}: ${w}`)
      }
    }
  })

  it('kierunki nadaje tylko warstwom neutralnym', () => {
    for (const id of NOWE_183)
      for (const w of Object.keys(potrzeba(id).kierunki ?? {}))
        assert.equal(MANIFEST.get(w)?.kierunek, 'neutralny', `${id}: ${w}`)
    assert.deepEqual(potrzeba('auto').kierunki, { spp_podstrefa: 'mniej-lepiej' })
    assert.deepEqual(potrzeba('zycie_nocne').kierunki, { zycie_nocne_300m: 'wiecej-lepiej' })
    assert.deepEqual(potrzeba('student').kierunki, { akademik_odleglosc: 'mniej-lepiej' })
  })

  it('zapytanie: 29 pytań, nowe twierdzenia po starych, przed „nie chcę” (#182), z kryteriami w pośredniku', async () => {
    const z = zapytanieOpiszSiebie('Mam auto i psa')
    const ids = Object.keys(z.pytania)
    // 22 z #183 + 7 „nie chcę” (#182); bez 3 pytań o siłę (#187).
    assert.equal(ids.length, 29)
    const pierwszeNie = ids.indexOf(`n_${NA_NIE[0]?.id}`)
    assert.deepEqual(
      ids.slice(pierwszeNie - 6, pierwszeNie),
      NOWE_183.map((id) => `p_${id}`),
    )
    const sciezka = new URL('../../api/_jev.js', import.meta.url).href
    const { sprawdzZapytanie, LIMITY } = (await import(sciezka)) as {
      LIMITY: { pytan: number; pytaniaZnakow: number }
      sprawdzZapytanie: (c: unknown) => {
        blad?: string
        pytania: Record<string, { criteria?: { true?: unknown; false?: unknown } }>
      }
    }
    const api = sprawdzZapytanie(z)
    assert.equal(api.blad, undefined)
    for (const id of NOWE_183) {
      const c = api.pytania[`p_${id}`]?.criteria
      assert.ok(c?.true && c.false, id)
    }
    // Rozmiar: daleko od bezpiecznika znaków (60 tys.).
    assert.ok(JSON.stringify(api.pytania).length < LIMITY.pytaniaZnakow / 3)
  })

  const PRZYPADKI: [string, string[], string | null][] = [
    // auto
    [
      'Dojeżdżam autem do pracy, potrzebuję miejsca parkingowego',
      ['auto', 'praca_centrum'],
      'kierowca',
    ],
    ['Mamy dwa samochody i szukamy domu z garażem', ['auto'], 'kierowca'],
    ['Nie mam samochodu', ['bez_samochodu'], null],
    ['Auta nie mam, wszędzie tramwajem', ['bez_samochodu'], null],
    ['Na auto mnie nie stać', [], null],
    ['Chcę mieszkać blisko parków', ['zielen'], null],
    // wozek
    ['Jeżdżę na wózku, potrzebuję obniżonych krawężników', ['wozek', 'zdrowie'], null],
    ['Tata chodzi o kulach', ['wozek', 'zdrowie'], null],
    // Wózek dziecięcy: bez `wozek`; `zdrowie` łapie „wózek” jak przed #183 (stara reguła).
    [
      'Spacerujemy z wózkiem dziecięcym, przyda się park',
      ['zielen', 'zdrowie', 'dzieci'],
      'rodzina',
    ],
    ['Chodzę z wózkiem z dzieckiem', ['zdrowie', 'dzieci'], 'rodzina'],
    ['Ważne, żeby było bez barier', ['wozek'], null],
    // praca_zdalna
    ['Pracuję zdalnie z domu', ['praca_zdalna'], 'zdalny'],
    ['Mam home office trzy dni w tygodniu', ['praca_zdalna'], 'zdalny'],
    ['Nie pracuję zdalnie', [], null],
    ['Kiedyś pracowałem zdalnie, teraz jeżdżę do biura', [], null],
    ['Spacerujemy z wózkiem, mała ma pół roku', ['zielen', 'zdrowie'], null],
    ['Mama jeździ na wózku inwalidzkim', ['wozek', 'zdrowie'], null],
    // Reguła tego nie odróżni – JEV tak (0,04); profil: Rowerzysta przed Kierowcą.
    ['Mam auto, ale na co dzień jeżdżę rowerem', ['auto', 'rower'], 'rowerzysta'],
    ['Jeżdżę hybrydą', [], null], // auto hybrydowe to nie praca hybrydowa
    // zycie_nocne
    ['Lubię knajpy i kluby w okolicy', ['zycie_nocne'], null],
    ['Nie chcę knajp pod oknem', [], null],
    ['Dorabiam w knajpie', [], null],
    ['Chodzę do klubu fitness', ['sport'], 'aktywny'],
    ['Szukam miejsca bez barów', [], null],
    // sport
    ['Biegam i chodzę na siłownię', ['sport'], 'aktywny'],
    ['Gram w tenisa, basen blisko byłby super', ['sport'], 'aktywny'],
    ['Nie uprawiam sportu', [], null],
    // student
    ['Jestem studentką UJ', ['student'], 'student'],
    ['Syn idzie na studia', ['student', 'dzieci'], 'rodzina'],
    // Bez `student` (lookbehind „dla”) i bez `singiel` (słowa studiów tylko w `student`).
    ['Kupuję pod wynajem dla studentów', ['inwestycja'], 'inwestor'],
    ['Pierwsza praca po studiach', [], null],
    ['Kiedyś studiowałem w Krakowie', [], null],
    ['Nie jestem studentem', [], null],
  ]
  for (const [zdanie, potrzeby, persona] of PRZYPADKI) {
    it(`reguły: ${zdanie}`, () => {
      const z = zRegul(zdanie)
      assert.deepEqual([...z.potrzeby].sort(), [...potrzeby].sort())
      assert.equal(z.persona, persona)
    })
  }

  it('JEV: noul ≥ progu dodaje nową potrzebę i jej warstwy; student pewny → Student pod progiem profilu', () => {
    const odp: Record<string, OdpowiedzJev | null> = {
      profil: { typ: 'choice', wybor: 'singiel', pewnosc: 0.7 },
      p_auto: noul(0.85),
      p_wozek: noul(0.2),
      p_student: noul(0.95),
      [NIKT]: noul(0.05),
      [NIEAKTUALNA]: noul(0.05),
    }
    const z = przetworzOdpowiedzi(odp, 'Studiuję na AGH, dojeżdżam autem')
    assert.ok(z)
    assert.deepEqual(z.potrzeby, ['auto', 'student'])
    // Auto 0,85 pod progiem mocnej potrzeby, student 0,95 – profil Student.
    assert.equal(z.persona, 'student')
    assert.equal(z.wskazniki.dojazd_utwardzony, 3)
    assert.equal(z.wskazniki.akademik_odleglosc, 3)
    assert.equal(z.wskazniki.obnizone_krawezniki_300m, undefined)
  })

  it('składanie: kierunek z nowej potrzeby trafia do warstwy neutralnej; przy „ciszy” wygrywa cisza', () => {
    const WARSTWY_183 = [
      { id: 'zycie_nocne_300m', kategoria: 'spokoj' },
      { id: 'gastronomia_odleglosc', kategoria: 'codziennosc' },
      { id: 'spp_podstrefa', kategoria: 'transport' },
      { id: 'halas_ldwn', kategoria: 'spokoj' },
    ] as const
    const nocne = wagiZeZrozumienia(zRegul('Lubię knajpy'), 'kupuje', WARSTWY_183, BIEZACE)
    assert.equal(nocne.wagi.zycie_nocne_300m, 4)
    assert.equal(nocne.kierunki.zycie_nocne_300m, 'wiecej-lepiej')
    const oba = wagiZeZrozumienia(
      zRegul('Lubię knajpy, ale w mieszkaniu ma być cicho'),
      'kupuje',
      WARSTWY_183,
      BIEZACE,
    )
    assert.equal(oba.kierunki.zycie_nocne_300m, 'mniej-lepiej')
    assert.equal(oba.wagi.gastronomia_odleglosc, 3)
    // Bez profilu Kierowca – jego SPP (3) zasłoniłaby wagę samej potrzeby.
    const auto = wagiZeZrozumienia(
      { ...zRegul('Mam samochód'), persona: null },
      'kupuje',
      WARSTWY_183,
      BIEZACE,
    )
    assert.equal(auto.wagi.spp_podstrefa, 1)
    assert.equal(auto.kierunki.spp_podstrefa, 'mniej-lepiej')
  })
})

// Pokrycie warstw przez „Opisz siebie”: każda warstwa, która liczy się w wyniku, musi dać się
// podnieść opisem siebie – potrzebą (POTRZEBY), „nie chcę” (NA_NIE) albo profilem, który JEV
// może wybrać. Nowa warstwa bez żadnej z tych dróg = czerwony test: dopisz ją do potrzeby
// albo do wyjątków niżej z powodem.
describe('pokrycie warstw: każda warstwa osiągalna z „Opisz siebie”', () => {
  /** Warstwy bez drogi z „Opisz siebie” – świadomie. Klucz: id, wartość: dlaczego. */
  const WYJATKI: Readonly<Record<string, string>> = {
    // Liczby dla całej gminy albo powiatu: ta sama wartość dla każdego adresu w Krakowie, więc
    // nie odróżniają adresów, a opisy warstw mówią wprost „informacja, nie ocena adresu”.
    gmina_czyste_powietrze_wnioski_100_domow:
      'liczba wniosków dla całej gminy, nie powietrze pod adresem (#177)',
    gmina_pit_na_mieszkanca: 'dochód gminy, nie cecha okolicy, o którą prosi mieszkaniec',
    powiat_wynagrodzenie_brutto: 'płace w powiecie – jedna liczba dla całego Krakowa',
    miejscowe_zagrozenia_gmina_2025: 'interwencje straży w gminie – jedna liczba dla Krakowa',
    pozary_gmina_2025: 'pożary w gminie – jedna liczba dla Krakowa',
    przetargi_dzielnica: 'przetargi dzielnicy – wydatki urzędu, nie potrzeba mieszkańca',
    sejm2023_lista_1: 'wynik wyborów w gminie – historyczny, nie preferencja do ważenia',
    sejm2023_lista_2: 'wynik wyborów w gminie – historyczny, nie preferencja do ważenia',
    sejm2023_lista_3: 'wynik wyborów w gminie – historyczny, nie preferencja do ważenia',
    sejm2023_lista_4: 'wynik wyborów w gminie – historyczny, nie preferencja do ważenia',
    sejm2023_lista_5: 'wynik wyborów w gminie – historyczny, nie preferencja do ważenia',
    sejm2023_lista_6: 'wynik wyborów w gminie – historyczny, nie preferencja do ważenia',
    sejm2023_lista_7: 'wynik wyborów w gminie – historyczny, nie preferencja do ważenia',
    // Demografia opisuje, kto tu mieszka – to odpowiedź na „Zapytaj o adres”, nie potrzeba.
    ludnosc_1km: 'liczba mieszkańców – tryb Biznes waży ją sam, mieszkaniec o nią nie prosi',
    gestosc_zaludnienia_100m: 'gęstość zabudowy ludźmi – opis okolicy, nie potrzeba',
    udzial_0_14: 'udział dzieci – rodzina potrzebuje szkoły, nie rówieśników w statystyce',
    udzial_65plus: 'udział seniorów – opis okolicy, nie potrzeba seniora',
    // Warstwy z udokumentowaną decyzją „bez niej” przy potrzebie, której by dotyczyły.
    liceum_odleglosc: 'potrzeba „dzieci” nie zna wieku dzieci, w opisach przeważają małe (#177)',
    pr_odleglosc: 'parking dla dojeżdżających spoza miasta, nie dla mieszkańca z autem (#183)',
    swiatlo_nocne_viirs: 'nocne światło z satelity to nie hałas ani bezpieczeństwo (#177)',
    // Neutralne usługi bez potrzeby, która by je wołała – „nie twórz potrzeb na siłę”.
    recykling_odleglosc: 'odpady zwykle odbiera się sprzed domu, kontener bywa zbędny',
    toaleta_woda_odleglosc: 'toalety publiczne – rzadkie w OSM, bez potrzeby w opisach',
    urzad_odleglosc: 'urząd odwiedza się rzadko – nie kryterium wyboru mieszkania',
    siec_cieplownicza_odleglosc: 'bliskość sieci nie znaczy, że budynek jest podłączony',
    rod_odleglosc:
      'ogródki działkowe to nie zieleń dla wszystkich (#177); profil Z psem waży je bez kierunku, więc się nie liczą',
  }

  /** Warstwy, które podnosi profil możliwy do wyboru przez JEV – tylko te, które liczą się w silniku. */
  const zProfili = new Set(
    PERSONY.filter((p) => p.id in OPISY_PROFILI_JEV).flatMap((p) =>
      Object.entries(p.wagi)
        .filter(([id, w]) => {
          const meta = MANIFEST.get(id)
          return w > 0 && meta !== undefined && kierunekEfektywny(meta, p.kierunki) !== null
        })
        .map(([id]) => id),
    ),
  )
  const zPotrzeb = new Set([
    ...POTRZEBY.flatMap((p) => Object.keys(p.wskazniki)),
    ...NA_NIE.flatMap((n) => Object.keys(n.warstwy)),
  ])
  const liczone = [...MANIFEST.values()].filter((m) => !m.atrapa && m.kategoria !== 'kontekst')

  it('każda liczona warstwa ma potrzebę, „nie chcę” albo profil – albo jest w wyjątkach', () => {
    const bez = liczone
      .map((m) => m.id)
      .filter((id) => !zPotrzeb.has(id) && !zProfili.has(id) && !(id in WYJATKI))
    assert.deepEqual(bez, [], `warstwy bez drogi z „Opisz siebie”: ${bez.join(', ')}`)
  })

  it('wyjątki są aktualne: istnieją w danych i naprawdę nie mają drogi', () => {
    for (const [id, dlaczego] of Object.entries(WYJATKI)) {
      assert.ok(MANIFEST.has(id), `wyjątek ${id} nie istnieje w danych`)
      assert.ok(!zPotrzeb.has(id) && !zProfili.has(id), `${id} ma już drogę – usuń wyjątek`)
      assert.ok(dlaczego.length > 10, id)
    }
  })

  it('nowe warstwy z ostatnich etapów (MLD, CAS, akademiki, usługi biznesu) nie wypadły', () => {
    for (const id of [
      'bus_mld_kursy_szczyt_h',
      'cas_odleglosc',
      'akademik_odleglosc',
      'sklep_odleglosc',
      'gastronomia_odleglosc',
      'apteka_odleglosc',
      'weterynarz_odleglosc',
    ])
      assert.ok(zPotrzeb.has(id) || zProfili.has(id), id)
  })
})
