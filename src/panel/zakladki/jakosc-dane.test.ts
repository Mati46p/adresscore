// Zakładka „Jakość” (T061): logika bez DOM. Oczekiwania policzone ręcznie, a znaczniki czasu wchodzą
// jako argument (logika nie czyta zegara), więc granice progów (25 h 59 min kontra 26 h 1 min) są
// sprawdzane co do minuty i sekundy.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { BRAK_DANYCH, PROGI_WITALI } from '../arytmetyka.ts'
import type { Diagnostyka, OstatniBieg, WierszBledu, WierszWitalu } from '../typy.ts'
import {
  czasMs,
  dniWZestawieniu,
  ETYKIETA_BIEGU,
  formatChwili,
  formatDni,
  formatDnia,
  formatDniTemu,
  formatTrwania,
  formatUdzialuBezOdcisku,
  formatWieku,
  klasyfikujBieg,
  LIMIT_BLEDOW,
  liczbaProbek,
  MAX_KOMUNIKAT,
  MAX_PELNY,
  MIN_PROBEK,
  MS_DOBY,
  MS_GODZINY,
  MS_MINUTY,
  ocenaOstatniegoZdarzenia,
  ocenaRetencji,
  oczyscTekst,
  okolicznoscBrakuBiegu,
  opisCiszy,
  opisProgowWitali,
  PROG_BIEGU_MS,
  PROG_CISZY_MS,
  pomiarZyje,
  skrocTekst,
  sumaZdarzen24h,
  TON_BIEGU,
  tonOceny,
  udzialBezOdcisku,
  ukladWitali,
  uwagaTypu,
  werdyktBledow,
  wiekMs,
  wierszeBledow,
  wierszeTypow,
} from './jakosc-dane.ts'

/**
 * Znak o podanym kodzie. Znaki niewidoczne (przełączniki kierunku pisma, spacje twarde) zapisujemy
 * liczbą, nie sekwencją ucieczki ani wprost: w źródle testu nie ma wtedy nic, czego nie widać.
 */
const znak = (kod: number) => String.fromCodePoint(kod)

/** Spacje twarde z `Intl` (pl-PL) na zwykłe, żeby asercje nie zależały od wersji ICU. */
const zwykleSpacje = (tekst: string) =>
  tekst.replaceAll(znak(0xa0), ' ').replaceAll(znak(0x202f), ' ')

/** Poniedziałek 2026-10-05, 14:00 w Warszawie (CEST, UTC+2). */
const TERAZ = Date.parse('2026-10-05T12:00:00Z')
/** Chwila `ms` przed `TERAZ`, jako tekst ISO (jak z bazy). */
const przed = (ms: number) => new Date(TERAZ - ms).toISOString()

function diagnostyka(czesc: Partial<Diagnostyka> = {}): Diagnostyka {
  return {
    ostatnie_zdarzenie: przed(5 * MS_MINUTY),
    zdarzenia_24h: {
      odslona: 120,
      wyjscie: 110,
      klik: 0,
      udostepnienie: 0,
      produktowe: 7,
      wital: 95,
      blad: 0,
    },
    bez_odcisku_24h: 3,
    ostatni_bieg: { rodzaj: 'zestaw', koniec: przed(10 * MS_GODZINY), blad: null },
    dni_w_zestawieniu: 12,
    najstarsze_zdarzenie: przed(88 * MS_DOBY),
    ...czesc,
  }
}

/** Diagnostyka ze zmienionymi licznikami typów (reszta jak w `diagnostyka()`). */
function zTypami(typy: Partial<Diagnostyka['zdarzenia_24h']>): Diagnostyka {
  return diagnostyka({ zdarzenia_24h: { ...diagnostyka().zdarzenia_24h, ...typy } })
}

describe('czas: znaczniki, wiek i formaty', () => {
  it('czasMs przyjmuje tylko ISO z bazy; śmieci i nie-teksty dają null', () => {
    assert.equal(czasMs('2026-10-05T12:00:00Z'), Date.parse('2026-10-05T12:00:00Z'))
    assert.equal(czasMs('2026-10-05T12:00:00.123+00:00'), Date.parse('2026-10-05T12:00:00.123Z'))
    for (const zle of ['', 'wczoraj', '5', '2026-13-45T99:99:99Z', null, undefined, 123, {}]) {
      assert.equal(czasMs(zle), null, String(zle))
    }
  })

  it('wiekMs: różnica w ms, nigdy ujemna (zegar admina może iść za zegarem bazy)', () => {
    assert.equal(wiekMs('2026-10-05T11:50:00Z', TERAZ), 10 * MS_MINUTY)
    assert.equal(wiekMs('2026-10-05T12:05:00Z', TERAZ), 0)
    assert.equal(wiekMs('nie data', TERAZ), null)
    assert.equal(wiekMs('2026-10-05T11:50:00Z', Number.NaN), null)
  })

  it('formatTrwania: minuty, godziny z minutami do 48 h, potem dni z godzinami', () => {
    assert.equal(formatTrwania(0), 'mniej niż minutę')
    assert.equal(formatTrwania(59_999), 'mniej niż minutę')
    assert.equal(formatTrwania(MS_MINUTY), '1 min')
    assert.equal(formatTrwania(MS_GODZINY - 1), '59 min')
    assert.equal(formatTrwania(MS_GODZINY), '1 h')
    assert.equal(formatTrwania(MS_GODZINY + 5 * MS_MINUTY), '1 h 5 min')
    // Próg biegu to 26 h, więc „26 h 9 min” musi być widoczne dokładnie, a nie jako „1 dzień 2 h”.
    assert.equal(formatTrwania(26 * MS_GODZINY + 9 * MS_MINUTY), '26 h 9 min')
    assert.equal(formatTrwania((47 * 60 + 59) * MS_MINUTY), '47 h 59 min')
    assert.equal(formatTrwania(48 * MS_GODZINY), '2 dni')
    assert.equal(formatTrwania(51 * MS_GODZINY), '2 dni 3 h')
    assert.equal(formatTrwania(49 * MS_GODZINY + 40 * MS_MINUTY), '2 dni 1 h')
    assert.equal(formatTrwania(90 * MS_DOBY), '90 dni')
  })

  it('formatTrwania i formatWieku: brak pomiaru to „brak danych”, nigdy „0 min temu”', () => {
    for (const zle of [null, undefined, Number.NaN, -1, Number.POSITIVE_INFINITY]) {
      assert.equal(formatTrwania(zle), BRAK_DANYCH)
      assert.equal(formatWieku(zle), BRAK_DANYCH)
    }
    assert.equal(formatWieku(10 * MS_MINUTY), '10 min temu')
    assert.equal(formatWieku(0), 'mniej niż minutę temu')
  })

  it('formatDni i formatDniTemu: jedyna liczba pojedyncza to 1', () => {
    assert.equal(formatDni(1), '1 dzień')
    assert.equal(formatDni(2), '2 dni')
    assert.equal(formatDni(5), '5 dni')
    assert.equal(formatDni(22), '22 dni')
    assert.equal(formatDni(0), '0 dni')
    assert.equal(formatDniTemu(0), 'mniej niż dobę temu')
    assert.equal(formatDniTemu(1), '1 dzień temu')
    assert.equal(formatDniTemu(34), '34 dni temu')
  })

  it('formatChwili: czas warszawski z dniem tygodnia, także po przejściu przez północ', () => {
    assert.equal(formatChwili('2026-10-05T12:05:00Z'), 'pon. 05.10, 14:05')
    // Zima (CET, UTC+1).
    assert.equal(formatChwili('2026-01-14T08:09:00Z'), 'śr. 14.01, 09:09')
    // 22:30 UTC latem to 00:30 następnego dnia w Warszawie.
    assert.equal(formatChwili('2026-10-05T22:30:00Z'), 'wt. 06.10, 00:30')
    assert.equal(formatChwili('x'), BRAK_DANYCH)
    assert.equal(formatChwili(null), BRAK_DANYCH)
  })

  it('formatDnia: pełna data doby warszawskiej albo null', () => {
    assert.equal(formatDnia('2026-07-07T12:00:00Z'), 'wt. 07.07.2026')
    assert.equal(formatDnia('nie data'), null)
    assert.equal(formatDnia(null), null)
  })
})

describe('klasyfikujBieg: wskaźnik ostatniego biegu zestawienia', () => {
  const bieg = (koniec: string | null, blad: string | null = null): OstatniBieg => ({
    rodzaj: 'zestaw',
    koniec,
    blad,
  })

  it('próg to 26 godzin', () => {
    assert.equal(PROG_BIEGU_MS, 26 * MS_GODZINY)
  })

  it('25 h 59 min = OK, dokładnie 26 h = OK (starszy NIŻ 26 h to ściśle więcej), 26 h 1 min = opóźniony', () => {
    // 2026-10-04 10:01 UTC → 2026-10-05 12:00 UTC to 24 h + 1 h 59 min.
    const ok = klasyfikujBieg(bieg('2026-10-04T10:01:00Z'), TERAZ)
    assert.equal(ok.stan, 'ok')
    assert.equal(ok.wiekMs, 25 * MS_GODZINY + 59 * MS_MINUTY)

    assert.equal(klasyfikujBieg(bieg('2026-10-04T10:00:00Z'), TERAZ).stan, 'ok')

    const opozniony = klasyfikujBieg(bieg('2026-10-04T09:59:00Z'), TERAZ)
    assert.equal(opozniony.stan, 'opozniony')
    assert.equal(opozniony.wiekMs, 26 * MS_GODZINY + MS_MINUTY)
  })

  it('scenariusz Historii 6: zestawienie wstrzymane na dobę zapala czerwony wskaźnik po 26 h', () => {
    const ostatniBieg = bieg('2026-10-04T01:21:30Z') // ostatni zdrowy bieg nocny
    const stanO = (teraz: string) => klasyfikujBieg(ostatniBieg, Date.parse(teraz)).stan
    // Zdrowy dzień: nowy bieg dopiero nadchodzi (01:20 UTC), stary ma 24 h 8 min.
    assert.equal(stanO('2026-10-05T01:30:00Z'), 'ok')
    // Bieg się nie odbył: 26 h 0 min 0 s po poprzednim jeszcze OK…
    assert.equal(stanO('2026-10-05T03:21:30Z'), 'ok')
    // …a sekundę dalej wskaźnik robi się czerwony (ton `zla`) z etykietą „opóźniony”.
    assert.equal(stanO('2026-10-05T03:21:31Z'), 'opozniony')
    assert.equal(stanO('2026-10-05T12:00:00Z'), 'opozniony')
    assert.equal(TON_BIEGU.opozniony, 'zla')
    assert.equal(ETYKIETA_BIEGU.opozniony, 'opóźniony')
  })

  it('bieg zakończony błędem to błąd – także świeży i także stary (błąd jest pilniejszy niż opóźnienie)', () => {
    const swiezy = klasyfikujBieg(bieg('2026-10-05T11:50:00Z', '23505: duplicate key value'), TERAZ)
    assert.deepEqual(swiezy, { stan: 'blad', wiekMs: 10 * MS_MINUTY })
    assert.equal(klasyfikujBieg(bieg('2026-10-01T01:20:00Z', 'boom'), TERAZ).stan, 'blad')
    // Błąd bez czasu zakończenia nadal jest błędem.
    assert.deepEqual(klasyfikujBieg(bieg(null, 'boom'), TERAZ), { stan: 'blad', wiekMs: null })
    assert.equal(TON_BIEGU.blad, 'zla')
    assert.equal(ETYKIETA_BIEGU.blad, 'błąd')
  })

  it('pusty albo biały tekst w polu błędu nie jest błędem', () => {
    assert.equal(klasyfikujBieg(bieg('2026-10-05T11:50:00Z', ''), TERAZ).stan, 'ok')
    assert.equal(klasyfikujBieg(bieg('2026-10-05T11:50:00Z', '   '), TERAZ).stan, 'ok')
  })

  it('brak biegu w ogóle → „brak biegu”, ton neutralny (nie czerwony)', () => {
    assert.deepEqual(klasyfikujBieg(null, TERAZ), { stan: 'brak', wiekMs: null })
    assert.deepEqual(klasyfikujBieg(undefined, TERAZ), { stan: 'brak', wiekMs: null })
    assert.equal(TON_BIEGU.brak, 'neutralna')
    assert.equal(ETYKIETA_BIEGU.brak, 'brak biegu')
  })

  it('bieg bez poprawnego czasu zakończenia albo przy nieznanym „teraz” jest nieustalony, nie „OK”', () => {
    assert.deepEqual(klasyfikujBieg(bieg(null), TERAZ), { stan: 'nieustalony', wiekMs: null })
    assert.deepEqual(klasyfikujBieg(bieg('wczoraj'), TERAZ), { stan: 'nieustalony', wiekMs: null })
    assert.deepEqual(klasyfikujBieg(bieg('2026-10-05T11:50:00Z'), Number.NaN), {
      stan: 'nieustalony',
      wiekMs: null,
    })
    assert.equal(TON_BIEGU.nieustalony, 'uwaga')
  })

  it('bieg „z przyszłości” (zegar admina za zegarem bazy) to OK z wiekiem 0', () => {
    assert.deepEqual(klasyfikujBieg(bieg('2026-10-05T12:05:00Z'), TERAZ), { stan: 'ok', wiekMs: 0 })
  })

  it('wskaźnik niesie etykietę tekstową w każdym stanie (kolor nie jest jedynym nośnikiem)', () => {
    assert.deepEqual(ETYKIETA_BIEGU, {
      ok: 'OK',
      opozniony: 'opóźniony',
      blad: 'błąd',
      brak: 'brak biegu',
      nieustalony: 'bez zakończenia',
    })
    assert.equal(TON_BIEGU.ok, 'dobra')
  })

  it('okolicznoscBrakuBiegu: pierwsza doba pomiaru to normalny brak, dłuższy pomiar bez biegu jest zaległy', () => {
    assert.equal(okolicznoscBrakuBiegu(przed(25 * MS_GODZINY), TERAZ), 'swiezy')
    assert.equal(okolicznoscBrakuBiegu(przed(26 * MS_GODZINY), TERAZ), 'swiezy')
    assert.equal(okolicznoscBrakuBiegu(przed(26 * MS_GODZINY + MS_MINUTY), TERAZ), 'zalegly')
    assert.equal(okolicznoscBrakuBiegu(przed(40 * MS_DOBY), TERAZ), 'zalegly')
    // Bez zdarzeń nie ma od czego liczyć dobowego biegu.
    assert.equal(okolicznoscBrakuBiegu(null, TERAZ), 'swiezy')
  })
})

describe('ostatnie zdarzenie: świeże, cisza, brak', () => {
  it('próg ciszy to godzina', () => {
    assert.equal(PROG_CISZY_MS, MS_GODZINY)
  })

  it('do godziny włącznie jest świeże, 1 h 1 min to cisza', () => {
    assert.deepEqual(ocenaOstatniegoZdarzenia('2026-10-05T11:30:00Z', TERAZ), {
      stan: 'swieze',
      wiekMs: 30 * MS_MINUTY,
    })
    assert.equal(ocenaOstatniegoZdarzenia('2026-10-05T11:00:00Z', TERAZ).stan, 'swieze')
    assert.deepEqual(ocenaOstatniegoZdarzenia('2026-10-05T10:59:00Z', TERAZ), {
      stan: 'cisza',
      wiekMs: MS_GODZINY + MS_MINUTY,
    })
  })

  it('brak zdarzenia (świeży serwis) to szary „brak”, a nie cisza', () => {
    assert.deepEqual(ocenaOstatniegoZdarzenia(null, TERAZ), { stan: 'brak', wiekMs: null })
    assert.deepEqual(ocenaOstatniegoZdarzenia('nie data', TERAZ), { stan: 'brak', wiekMs: null })
  })

  it('opisCiszy odróżnia przerwę godzinną od doby bez zdarzeń', () => {
    assert.match(opisCiszy(2 * MS_GODZINY), /Nocą to normalne/)
    assert.match(opisCiszy(MS_DOBY), /Ponad dobę/)
    assert.match(opisCiszy(30 * MS_DOBY), /Ponad dobę/)
  })
})

describe('zdarzenia na typ w 24 h', () => {
  it('zawsze siedem typów w ustalonej kolejności, także z zerem; zero to liczba, nie brak', () => {
    const wiersze = wierszeTypow(diagnostyka())
    assert.deepEqual(
      wiersze.map((w) => [w.typ, w.liczba]),
      [
        ['odslona', 120],
        ['wyjscie', 110],
        ['klik', 0],
        ['udostepnienie', 0],
        ['produktowe', 7],
        ['wital', 95],
        ['blad', 0],
      ],
    )
    assert.deepEqual(
      wiersze.map((w) => w.nazwa),
      [
        'Odsłony',
        'Wyjścia',
        'Kliknięcia',
        'Udostępnienia',
        'Zdarzenia produktowe',
        'Pomiary szybkości',
        'Błędy klienta',
      ],
    )
  })

  it('zero zdarzeń to „cisza tego typu”, z wyjątkiem błędów klienta: zero błędów to dobra wiadomość', () => {
    const uwagi = Object.fromEntries(wierszeTypow(diagnostyka()).map((w) => [w.typ, w.uwaga]))
    assert.deepEqual(uwagi, {
      odslona: null,
      wyjscie: null,
      klik: 'cisza',
      udostepnienie: 'cisza',
      produktowe: null,
      wital: null,
      blad: 'brak_bledow',
    })
    assert.equal(uwagaTypu('blad', 4, true), null)
    assert.equal(uwagaTypu('odslona', null, true), null) // brak pomiaru to nie cisza
  })

  it('zero błędów jest dobrą wiadomością TYLKO przy żywym pomiarze; gdy pomiar milczy, to też cisza', () => {
    const uwagaBledu = (d: Diagnostyka) => wierszeTypow(d).find((w) => w.typ === 'blad')?.uwaga
    assert.equal(uwagaBledu(diagnostyka()), 'brak_bledow')
    // Wszystko zero: zero błędów niczego nie dowodzi.
    const wszystkoZero = zTypami({
      odslona: 0,
      wyjscie: 0,
      klik: 0,
      udostepnienie: 0,
      produktowe: 0,
      wital: 0,
      blad: 0,
    })
    assert.equal(uwagaBledu(wszystkoZero), 'cisza')
    // Są odsłony, ale pomiary szybkości (ten sam moduł co zbieranie błędów) milczą.
    assert.equal(uwagaBledu(zTypami({ wital: 0 })), 'cisza')
    // Błąd z liczbą > 0 nie dostaje żadnej uwagi.
    assert.equal(uwagaBledu(zTypami({ blad: 5 })), null)
  })

  it('pomiarZyje: odsłony ORAZ pomiary szybkości w 24 h', () => {
    assert.equal(pomiarZyje(diagnostyka()), true)
    assert.equal(pomiarZyje(zTypami({ odslona: 0 })), false)
    assert.equal(pomiarZyje(zTypami({ wital: 0 })), false)
    assert.equal(pomiarZyje(diagnostyka({ zdarzenia_24h: null as never })), false)
    assert.equal(pomiarZyje(null), false)
    assert.equal(pomiarZyje(undefined), false)
  })

  it('typ, którego odpowiedź nie zawiera, to brak danych (null), a nie zero', () => {
    const bez = diagnostyka()
    const typy: Record<string, number> = { ...bez.zdarzenia_24h }
    delete typy.wital
    const niekompletna = { ...bez, zdarzenia_24h: typy as Diagnostyka['zdarzenia_24h'] }
    const wital = wierszeTypow(niekompletna).find((w) => w.typ === 'wital')
    assert.equal(wital?.liczba, null)
    assert.equal(wital?.uwaga, null)
    assert.equal(sumaZdarzen24h(niekompletna), null)
  })

  it('niepoprawne liczby (ujemna, NaN, tekst) i brak obiektu to null; funkcje nie rzucają', () => {
    const zle = zTypami({ klik: -1, wital: Number.NaN, blad: '3' as never })
    const wiersze = wierszeTypow(zle)
    assert.equal(wiersze.find((w) => w.typ === 'klik')?.liczba, null)
    assert.equal(wiersze.find((w) => w.typ === 'wital')?.liczba, null)
    assert.equal(wiersze.find((w) => w.typ === 'blad')?.liczba, null)
    assert.equal(sumaZdarzen24h(zle), null)

    const pusta = wierszeTypow({ ...diagnostyka(), zdarzenia_24h: null as never })
    assert.equal(pusta.length, 7)
    assert.ok(pusta.every((w) => w.liczba === null))
    assert.equal(wierszeTypow(null).length, 7)
    assert.equal(sumaZdarzen24h(undefined), null)
  })

  it('suma zdarzeń to suma siedmiu typów: 120 + 110 + 0 + 0 + 7 + 95 + 0 = 332', () => {
    assert.equal(sumaZdarzen24h(diagnostyka()), 332)
  })
})

describe('udział zdarzeń bez odcisku', () => {
  const wszystkoZero = zTypami({
    odslona: 0,
    wyjscie: 0,
    klik: 0,
    udostepnienie: 0,
    produktowe: 0,
    wital: 0,
    blad: 0,
  })

  it('procent od SUMY zdarzeń z 24 h: 3 z 332 to 0,9%', () => {
    const u = udzialBezOdcisku(diagnostyka())
    assert.deepEqual(u, { bez: 3, suma: 332, procent: 0.9 })
    assert.equal(formatUdzialuBezOdcisku(u), '0,9%')
  })

  it('zero bez odcisku to 0,0% (prawdziwe zero przy niezerowej sumie)', () => {
    const u = udzialBezOdcisku(diagnostyka({ bez_odcisku_24h: 0 }))
    assert.equal(u.procent, 0)
    assert.equal(formatUdzialuBezOdcisku(u), '0,0%')
  })

  it('niezerowa liczba zaokrąglona do 0,0% jest pokazana jako „< 0,1%” (nie sprzeczność z ostrzeżeniem)', () => {
    // 1 z 5000 = 0,02%.
    const duzyRuch = {
      ...wszystkoZero,
      zdarzenia_24h: { ...wszystkoZero.zdarzenia_24h, odslona: 5000 },
    }
    const u = udzialBezOdcisku({ ...duzyRuch, bez_odcisku_24h: 1 })
    assert.equal(u.suma, 5000)
    assert.equal(u.procent, 0)
    assert.equal(formatUdzialuBezOdcisku(u), '< 0,1%')
  })

  it('suma zero → brak danych (null), nigdy dzielenie przez zero ani 0%', () => {
    const u = udzialBezOdcisku({ ...wszystkoZero, bez_odcisku_24h: 0 })
    assert.deepEqual(u, { bez: 0, suma: 0, procent: null })
    assert.equal(formatUdzialuBezOdcisku(u), null)
  })

  it('dane niespójne (więcej zdarzeń bez odcisku niż wszystkich) i braki dają brak danych', () => {
    assert.equal(udzialBezOdcisku(diagnostyka({ bez_odcisku_24h: 400 })).procent, null)
    assert.equal(
      udzialBezOdcisku(diagnostyka({ bez_odcisku_24h: undefined as never })).procent,
      null,
    )
    assert.equal(udzialBezOdcisku(diagnostyka({ bez_odcisku_24h: -2 })).procent, null)
    assert.equal(udzialBezOdcisku(null).procent, null)
  })

  it('wszystkie zdarzenia bez odcisku to 100% sumy (część równa całości jest dozwolona)', () => {
    const tylkoOdslony = {
      ...wszystkoZero,
      zdarzenia_24h: { ...wszystkoZero.zdarzenia_24h, odslona: 40 },
    }
    assert.equal(udzialBezOdcisku({ ...tylkoOdslony, bez_odcisku_24h: 40 }).procent, 100)
  })
})

describe('dni w zestawieniu', () => {
  it('liczba nieujemna zostaje liczbą (zero to prawdziwe zero), reszta to brak danych', () => {
    assert.equal(dniWZestawieniu(diagnostyka({ dni_w_zestawieniu: 12 })), 12)
    assert.equal(dniWZestawieniu(diagnostyka({ dni_w_zestawieniu: 0 })), 0)
    for (const zle of ['tak', -1, Number.NaN, null, undefined]) {
      assert.equal(dniWZestawieniu(diagnostyka({ dni_w_zestawieniu: zle as never })), null)
    }
    assert.equal(dniWZestawieniu(null), null)
  })
})

describe('retencja: najstarsze zdarzenie', () => {
  const dniTemu = (d: number, godzin = 0) => przed(d * MS_DOBY + godzin * MS_GODZINY)

  it('do 92 pełnych dób (90 + tolerancja jednego opuszczonego biegu) jest w normie', () => {
    assert.deepEqual(ocenaRetencji(dniTemu(91), TERAZ), { dni: 91, przekroczona: false })
    assert.deepEqual(ocenaRetencji(dniTemu(92), TERAZ), { dni: 92, przekroczona: false })
    assert.deepEqual(ocenaRetencji(dniTemu(92, 23), TERAZ), { dni: 92, przekroczona: false })
  })

  it('93 pełne doby oznaczają, że sprzątanie nie działa', () => {
    assert.deepEqual(ocenaRetencji(dniTemu(93), TERAZ), { dni: 93, przekroczona: true })
  })

  it('brak zdarzeń: dni null, bez alarmu; świeże zdarzenie to 0 dni', () => {
    assert.deepEqual(ocenaRetencji(null, TERAZ), { dni: null, przekroczona: false })
    assert.deepEqual(ocenaRetencji('nie data', TERAZ), { dni: null, przekroczona: false })
    assert.deepEqual(ocenaRetencji(przed(3 * MS_GODZINY), TERAZ), { dni: 0, przekroczona: false })
  })
})

describe('Web Vitals: układ macierzy ekran × metryka', () => {
  const wiersze: WierszWitalu[] = [
    { ekran: 'okolica', metryka: 'lcp', p75: 2300, probki: 20 },
    { ekran: 'okolica', metryka: 'inp', p75: 350, probki: 12 },
    { ekran: 'okolica', metryka: 'cls', p75: 0.31, probki: 4 },
    { ekran: 'szukaj', metryka: 'lcp', p75: 4100, probki: 6 },
    { ekran: 'szukaj', metryka: 'ttfb', p75: 780, probki: 3 },
    { ekran: 'zzz', metryka: 'fcp', p75: 1700, probki: 9 },
    { ekran: 'okolica', metryka: 'foo', p75: 10, probki: 5 },
  ]

  it('wiersze idą w kolejności ekranów serwisu (potem nieznane alfabetycznie), nie w kolejności z bazy', () => {
    const uklad = ukladWitali(wiersze)
    assert.deepEqual(
      uklad.wiersze.map((w) => w.ekran),
      ['szukaj', 'okolica', 'zzz'],
    )
  })

  it('komórka niesie p75, liczbę próbek, ocenę i flagę „mało próbek”; brak pomiaru to null', () => {
    const uklad = ukladWitali(wiersze)
    const szukaj = uklad.wiersze[0]
    const okolica = uklad.wiersze[1]
    assert.deepEqual(szukaj?.komorki.lcp, {
      metryka: 'lcp',
      p75: 4100,
      probki: 6,
      ocena: 'slaba',
      maloProbek: false,
    })
    assert.deepEqual(szukaj?.komorki.ttfb, {
      metryka: 'ttfb',
      p75: 780,
      probki: 3,
      ocena: 'dobra',
      maloProbek: true,
    })
    assert.deepEqual(okolica?.komorki.lcp, {
      metryka: 'lcp',
      p75: 2300,
      probki: 20,
      ocena: 'dobra',
      maloProbek: false,
    })
    assert.deepEqual(okolica?.komorki.inp, {
      metryka: 'inp',
      p75: 350,
      probki: 12,
      ocena: 'do-poprawy',
      maloProbek: false,
    })
    assert.deepEqual(okolica?.komorki.cls, {
      metryka: 'cls',
      p75: 0.31,
      probki: 4,
      ocena: 'slaba',
      maloProbek: true,
    })
    // Metryki bez pomiaru na danym ekranie: null (brak danych), nie komórka z zerem.
    assert.equal(szukaj?.komorki.inp, null)
    assert.equal(szukaj?.komorki.cls, null)
    assert.equal(szukaj?.komorki.fcp, null)
    assert.equal(okolica?.komorki.fcp, null)
    assert.equal(okolica?.komorki.ttfb, null)
  })

  it('ekrany bez żadnego pomiaru trafiają do przypisu w kolejności serwisu', () => {
    assert.deepEqual(ukladWitali(wiersze).bezPomiarow, [
      'porownanie',
      'metoda',
      'katalog',
      'miasto',
      'biznes',
    ])
    assert.deepEqual(ukladWitali([]).wiersze, [])
    assert.equal(ukladWitali(null).bezPomiarow.length, 7)
  })

  it('metryka spoza tabeli nie ginie: ląduje w `nieznane`', () => {
    assert.deepEqual(ukladWitali(wiersze).nieznane, [
      { ekran: 'okolica', metryka: 'foo', probki: 5 },
    ])
  })

  it('progi oceny: granice włącznie po stronie „lepszej” (LCP 2500, CLS 0,1 i 0,25)', () => {
    const ocena = (metryka: 'lcp' | 'cls' | 'inp', p75: number) =>
      ukladWitali([{ ekran: 'szukaj', metryka, p75, probki: 50 }]).wiersze[0]?.komorki[metryka]
        ?.ocena
    assert.equal(ocena('lcp', 2500), 'dobra')
    assert.equal(ocena('lcp', 2501), 'do-poprawy')
    assert.equal(ocena('lcp', 4000), 'do-poprawy')
    assert.equal(ocena('lcp', 4001), 'slaba')
    assert.equal(ocena('cls', 0.1), 'dobra')
    assert.equal(ocena('cls', 0.25), 'do-poprawy')
    assert.equal(ocena('cls', 0.2501), 'slaba')
    assert.equal(ocena('inp', 200), 'dobra')
    assert.equal(ocena('inp', 500), 'do-poprawy')
  })

  it(`„mało próbek” to mniej niż ${MIN_PROBEK}: 4 tak, 5 nie`, () => {
    const malo = (probki: number) =>
      ukladWitali([{ ekran: 'szukaj', metryka: 'lcp', p75: 1000, probki }]).wiersze[0]?.komorki.lcp
        ?.maloProbek
    assert.equal(MIN_PROBEK, 5)
    assert.equal(malo(4), true)
    assert.equal(malo(5), false)
    assert.equal(malo(0), true)
  })

  it('dubel (ekran, metryka) zostaje z większą liczbą próbek, niezależnie od kolejności', () => {
    const slaby: WierszWitalu = { ekran: 'okolica', metryka: 'lcp', p75: 9000, probki: 3 }
    const mocny: WierszWitalu = { ekran: 'okolica', metryka: 'lcp', p75: 2300, probki: 30 }
    for (const kolejnosc of [
      [slaby, mocny],
      [mocny, slaby],
    ]) {
      const komorka = ukladWitali(kolejnosc).wiersze[0]?.komorki.lcp
      assert.equal(komorka?.p75, 2300)
      assert.equal(komorka?.probki, 30)
    }
  })

  it('nazwa metryki bywa wielkimi literami; wiersze niepoprawne są pomijane, a p75 null daje brak oceny', () => {
    const uklad = ukladWitali([
      { ekran: 'okolica', metryka: 'LCP', p75: 1200, probki: 10 },
      null as never,
      { ekran: '', metryka: 'lcp', p75: 1, probki: 1 },
      { ekran: 'szukaj', metryka: 'lcp', p75: Number.NaN, probki: 'x' as never },
      { ekran: 'szukaj', metryka: 'fcp', p75: -5, probki: 4 },
    ])
    assert.equal(uklad.wiersze.length, 2)
    assert.equal(uklad.wiersze[1]?.komorki.lcp?.ocena, 'dobra')
    const szukaj = uklad.wiersze[0]
    assert.deepEqual(szukaj?.komorki.lcp, {
      metryka: 'lcp',
      p75: null,
      probki: 0,
      ocena: null,
      maloProbek: true,
    })
    assert.equal(szukaj?.komorki.fcp?.p75, null)
  })

  it('ton oceny: kolor alarmowy gaśnie przy małej liczbie próbek (słowo oceny zostaje)', () => {
    assert.equal(tonOceny('dobra', false), 'dobra')
    assert.equal(tonOceny('do-poprawy', false), 'uwaga')
    assert.equal(tonOceny('slaba', false), 'zla')
    for (const ocena of ['dobra', 'do-poprawy', 'slaba'] as const) {
      assert.equal(tonOceny(ocena, true), 'neutralna')
    }
  })

  it('liczbaProbek: polska odmiana (1 próbka, 3 próbki, 5 próbek, 22 próbki, 112 próbek)', () => {
    const ocz = (n: number) => zwykleSpacje(liczbaProbek(n))
    assert.equal(ocz(0), '0 próbek')
    assert.equal(ocz(1), '1 próbka')
    for (const n of [2, 3, 4]) assert.equal(ocz(n), `${n} próbki`)
    for (const n of [5, 11, 12, 13, 14, 15, 21]) assert.equal(ocz(n), `${n} próbek`)
    assert.equal(ocz(22), '22 próbki')
    assert.equal(ocz(24), '24 próbki')
    assert.equal(ocz(25), '25 próbek')
    assert.equal(ocz(100), '100 próbek')
    assert.equal(ocz(102), '102 próbki')
    assert.equal(ocz(112), '112 próbek')
    assert.equal(ocz(1003), '1 003 próbki')
    assert.equal(ocz(Number.NaN), '0 próbek')
  })

  it('opisProgowWitali powstaje z progów Google (jedno źródło prawdy)', () => {
    assert.equal(
      zwykleSpacje(opisProgowWitali()),
      'LCP 2 500 / 4 000 ms, INP 200 / 500 ms, CLS 0,1 / 0,25, FCP 1 800 / 3 000 ms, TTFB 800 / 1 800 ms',
    )
    assert.equal(PROGI_WITALI.lcp.dobra, 2500)
  })
})

describe('teksty z sieci: oczyszczanie i skracanie', () => {
  it('oczyscTekst zbija białe znaki i usuwa znaki sterujące', () => {
    assert.equal(oczyscTekst('a\nb\tc'), 'a b c')
    assert.equal(oczyscTekst('  a    b  '), 'a b')
    assert.equal(oczyscTekst(`x${znak(0)}y${znak(7)}z`), 'x y z')
    // Separator wiersza (U+2028) nie skleja słów.
    assert.equal(oczyscTekst(`linia${znak(0x2028)}druga`), 'linia druga')
    assert.equal(oczyscTekst('Błąd: żółć'), 'Błąd: żółć')
  })

  it('oczyscTekst usuwa znaki niewidoczne i przełączniki kierunku pisma (tekst nie może wyglądać inaczej, niż brzmi)', () => {
    // U+202E to nadpisanie kierunku „od prawej do lewej”: potrafi wizualnie odwrócić resztę wiersza.
    assert.equal(oczyscTekst(`abc${znak(0x202e)}def`), 'abcdef')
    // Zerowej szerokości (U+200B), izolat kierunku (U+2066), BOM (U+FEFF), miękki łącznik (U+00AD).
    const zasmiecony = `a${znak(0x200b)}b${znak(0x2066)}c${znak(0xfeff)}d${znak(0xad)}e`
    assert.equal(oczyscTekst(zasmiecony), 'abcde')
  })

  it('oczyscTekst: nie-tekst to pusty napis', () => {
    for (const x of [null, undefined, 42, {}, ['a']]) assert.equal(oczyscTekst(x), '')
  })

  it('skrocTekst liczy punkty kodowe, nie tnie par zastępczych i obcina spację przed wielokropkiem', () => {
    const emoji = String.fromCodePoint(0x1f600)
    assert.equal(skrocTekst('abc', 5), 'abc')
    assert.equal(skrocTekst('abcde', 5), 'abcde')
    assert.equal(skrocTekst('abcdef', 5), 'abcd…')
    assert.equal(skrocTekst('abc def', 5), 'abc…')
    assert.equal(skrocTekst(emoji.repeat(3), 2), `${emoji}…`)
    assert.equal(skrocTekst(emoji.repeat(2), 2), emoji.repeat(2))
  })
})

describe('błędy klienta: wiersze do tabeli', () => {
  const wiersz = (czesc: Partial<WierszBledu>): WierszBledu => ({
    komunikat: 'TypeError: x is undefined',
    ekran: 'okolica',
    ile: 1,
    ostatnio: '2026-10-05T10:00:00Z',
    ...czesc,
  })

  it('od najczęstszych; remis rozstrzyga nowsze wystąpienie, potem alfabet', () => {
    const wynik = wierszeBledow([
      wiersz({ komunikat: 'C', ile: 3, ostatnio: '2026-10-05T10:00:00Z' }),
      wiersz({ komunikat: 'A', ile: 7, ostatnio: '2026-10-04T10:00:00Z' }),
      wiersz({ komunikat: 'B', ile: 3, ostatnio: '2026-10-05T11:00:00Z' }),
      wiersz({ komunikat: 'D', ile: 3, ostatnio: '2026-10-05T10:00:00Z' }),
    ])
    assert.deepEqual(
      wynik.map((w) => w.komunikat),
      ['A', 'B', 'C', 'D'],
    )
  })

  it('komunikat jest oczyszczony; skrócony tylko gdy za długi, a wtedy pełny tekst idzie do dymka', () => {
    const [krotki] = wierszeBledow([wiersz({ komunikat: `Zły\nkomunikat${znak(0x202e)}z` })])
    assert.equal(krotki?.komunikat, 'Zły komunikatz')
    assert.equal(krotki?.pelny, null)

    const [dlugi] = wierszeBledow([wiersz({ komunikat: 'a'.repeat(300) })])
    assert.equal(Array.from(dlugi?.komunikat ?? '').length, MAX_KOMUNIKAT)
    assert.ok(dlugi?.komunikat.endsWith('…'))
    assert.equal(dlugi?.pelny, 'a'.repeat(300))

    const [ogromny] = wierszeBledow([wiersz({ komunikat: 'b'.repeat(5000) })])
    assert.equal(Array.from(ogromny?.pelny ?? '').length, MAX_PELNY)
  })

  it('pusty komunikat dostaje czytelny zamiennik; niepoprawne pola to null; nie-obiekty są pomijane', () => {
    const wynik = wierszeBledow([
      wiersz({ komunikat: '   ', ile: 'x' as never, ostatnio: 'wczoraj' }),
      null as never,
      'tekst' as never,
    ])
    assert.equal(wynik.length, 1)
    assert.equal(wynik[0]?.komunikat, '(pusty komunikat)')
    assert.equal(wynik[0]?.ile, null)
    assert.equal(wynik[0]?.ostatnio, null)
    assert.deepEqual(wierszeBledow(null), [])
  })

  it('wiersze bez liczby lądują na końcu, a klucze są unikalne także przy identycznych wierszach', () => {
    const wynik = wierszeBledow([
      wiersz({ komunikat: 'bez liczby', ile: null as never }),
      wiersz({ komunikat: 'X', ile: 2 }),
      wiersz({ komunikat: 'X', ile: 2 }),
    ])
    assert.equal(wynik.at(-1)?.komunikat, 'bez liczby')
    assert.equal(new Set(wynik.map((w) => w.klucz)).size, wynik.length)
  })

  it('limit listy to 50 (domyślny p_limit funkcji bazy)', () => {
    assert.equal(LIMIT_BLEDOW, 50)
  })
})

describe('werdyktBledow: pusta lista błędów kontra niedziałający pomiar', () => {
  it('są wiersze → „sa”, niezależnie od diagnostyki', () => {
    assert.equal(werdyktBledow(3, null), 'sa')
    assert.equal(werdyktBledow(1, diagnostyka()), 'sa')
  })

  it('pusta lista i pomiar żyje (odsłony ORAZ pomiary szybkości w 24 h) → „czysto”', () => {
    assert.equal(werdyktBledow(0, diagnostyka()), 'czysto')
  })

  it('pusta lista, ale brak dowodu, że pomiar działa → „niepewne” (szary stan, nie zielone uspokojenie)', () => {
    assert.equal(werdyktBledow(0, null), 'niepewne')
    assert.equal(werdyktBledow(0, undefined), 'niepewne')
    assert.equal(werdyktBledow(0, zTypami({ odslona: 0 })), 'niepewne')
    // Są odsłony, ale cisza w pomiarach szybkości: moduł, w którym siedzi też zbieranie błędów, może nie działać.
    assert.equal(werdyktBledow(0, zTypami({ wital: 0 })), 'niepewne')
    assert.equal(werdyktBledow(0, diagnostyka({ zdarzenia_24h: null as never })), 'niepewne')
  })
})
