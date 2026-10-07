// Arytmetyka przeglądu wszystkich miast (#223, faza F3): kolory tła, granice, miasto pod punktem.
// Uruchom: node --test src/wynik/przegladLiczenie.test.ts
//
// Dwa rodzaje sprawdzeń. Syntetyczne: małe podstawy heksów z ręcznie ustawionymi ocenami, żeby znać
// wynik z góry (mapowanie heks → wartość, null zamiast 0, nieobecna warstwa). Na prawdziwych kompaktach
// z public/dane: ten sam kod dekodowania i liczenia co w przeglądarce, na wszystkich 10 miastach.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import {
  cellToBoundary,
  cellToLatLng,
  cellToParent,
  getResolution,
  gridDisk,
  isValidCell,
  latLngToCell,
} from 'h3-js'
import type { WskaznikMeta } from '../kontrakty/index.ts'
import { MIASTA, type Miasto, miasto, type SlugMiasta } from '../kontrakty/miasta.ts'
import {
  BRAK,
  liczoneWarstwy,
  type PodstawaHeksow,
  PROG_UDZIALU,
  type Res,
  type WarstwaHeksow,
  wynikiHeksow,
} from './heksy.ts'
import { type IndeksKompaktu, rozpakuj } from './kompakt.ts'
import { PERSONA_DOMYSLNA, TRYB_DOMYSLNY, ustawieniaPersony } from './persony.ts'
import {
  graniceZHeksow,
  podstawaZPliku,
  polaczProstokaty,
  type WynikiPoziomow,
  warstwaPasuje,
  warstwaZPliku,
  wynikiPrzegladu,
  zbudujMiastoPunktu,
  zlaczTlo,
} from './przegladLiczenie.ts'

// ── Dane syntetyczne ─────────────────────────────────────────────────────────────────────

/** Podstawa z podanych heksów r10; r9 i r8 to ich rodzice (jak w kompakcie: posortowane, bez powtórek). */
function podstawa(r10: readonly string[]): PodstawaHeksow {
  const lista = (res: Res) =>
    res === 10 ? [...r10].sort() : [...new Set(r10.map((h) => cellToParent(h, res)))].sort()
  const poziom = (res: Res) => {
    const heksy = lista(res)
    return { heksy, liczba: new Uint16Array(heksy.length).fill(5) }
  }
  return {
    skalaOceny: 1,
    skalaUdzialu: 200,
    poziomy: { 10: poziom(10), 9: poziom(9), 8: poziom(8) },
    od: new Uint32Array(r10.length),
    ulica: r10.map(() => ''),
    dzielnica: r10.map(() => ''),
  }
}

/** Warstwa, w której komórka `i` poziomu `res` ma ocenę `ocena(res, i)` i pełny udział adresów z danymi. */
function warstwa(
  p: PodstawaHeksow,
  ocena: (res: Res, i: number) => number,
  udzial: (res: Res, i: number) => number = () => 200,
): WarstwaHeksow {
  const wiersz = (res: Res, f: (res: Res, i: number) => number) =>
    Uint8Array.from(p.poziomy[res].heksy, (_, i) => f(res, i))
  return {
    ocena: { 10: wiersz(10, ocena), 9: wiersz(9, ocena), 8: wiersz(8, ocena) },
    udzial: { 10: wiersz(10, udzial), 9: wiersz(9, udzial), 8: wiersz(8, udzial) },
  }
}

const SRODEK_LODZI = miasto('lodz').srodek
const R10_LODZI = gridDisk(latLngToCell(SRODEK_LODZI[1], SRODEK_LODZI[0], 10), 4)

const meta = (id: string, kierunek: WskaznikMeta['kierunek'] = 'wiecej-lepiej') =>
  ({ id, kategoria: 'transport', kierunek }) as WskaznikMeta

const wartosci = (m: ReadonlyMap<string, number | null>) => [...m.values()]
const liczbaZer = (m: ReadonlyMap<string, number | null>) =>
  wartosci(m).filter((v) => v === 0).length

describe('wynikiPrzegladu', () => {
  const p = podstawa(R10_LODZI)

  it('przypisuje każdemu heksowi jego własną wartość (klucz → wynik, bez przesunięć)', () => {
    const a = warstwa(p, (_, i) => 10 + (i % 80))
    for (const res of [10, 9, 8] as const) {
      const wynik = wynikiPrzegladu(
        p,
        [{ id: 'a', kierunek: 'wiecej-lepiej', waga: 1 }],
        () => a,
        res,
      )
      p.poziomy[res].heksy.forEach((h, i) => {
        assert.equal(wynik.get(h), 10 + (i % 80), `r${res} ${h}`)
      })
    }
  })

  it('daje ten sam wynik co silnik heksów (średnia ważona, kierunek warstwy)', () => {
    const wiecej = warstwa(p, () => 80)
    const mniej = warstwa(p, () => 40)
    const liczone = [
      { id: 'w', kierunek: 'wiecej-lepiej' as const, waga: 3 },
      { id: 'm', kierunek: 'mniej-lepiej' as const, waga: 1 },
    ]
    const pliki = (id: string) => (id === 'w' ? wiecej : mniej)
    const wynik = wynikiPrzegladu(p, liczone, pliki, 9)
    // (3 × 80 + 1 × (100 − 40)) / 4 = 75
    for (const v of wynik.values()) assert.equal(v, 75)
    const silnik = wynikiHeksow(p, 9, liczone, pliki)
    p.poziomy[9].heksy.forEach((h, i) => {
      assert.equal(wynik.get(h), silnik.wartosc[i])
    })
  })

  it('ma klucz dla KAŻDEGO heksu poziomu, także bez danych (szrafurę trzeba narysować)', () => {
    const rzadka = warstwa(p, (_, i) => (i % 2 ? BRAK : 50))
    for (const res of [10, 9, 8] as const) {
      const wynik = wynikiPrzegladu(
        p,
        [{ id: 'r', kierunek: 'wiecej-lepiej', waga: 1 }],
        () => rzadka,
        res,
      )
      assert.deepEqual([...wynik.keys()], p.poziomy[res].heksy)
    }
  })

  it('heks bez danych to null, nigdy 0 (FR-004)', () => {
    const bezDanych = warstwa(
      p,
      (_, i) => (i === 0 ? BRAK : 50),
      (_, i) => (i === 1 ? 0 : 200),
    )
    const wynik = wynikiPrzegladu(
      p,
      [{ id: 'x', kierunek: 'wiecej-lepiej', waga: 1 }],
      () => bezDanych,
      10,
    )
    const heksy = p.poziomy[10].heksy
    assert.equal(wynik.get(heksy[0] as string), null, 'ocena BRAK')
    assert.equal(wynik.get(heksy[1] as string), null, 'udział adresów z danymi 0%')
    assert.equal(wynik.get(heksy[2] as string), 50)
    assert.equal(liczbaZer(wynik), 0)
  })

  it('liczone = [] daje same null (profil bez żadnej warstwy miasta, wybrana warstwa spoza miasta)', () => {
    for (const res of [10, 9, 8] as const) {
      const wynik = wynikiPrzegladu(p, [], () => null, res)
      assert.equal(wynik.size, p.poziomy[res].heksy.length)
      assert.ok(wartosci(wynik).every((v) => v === null))
    }
  })

  it('warstwa, której miasto nie ma (SC-005): wszystkie heksy null, nigdy kolor zera', () => {
    // Meta miasta nie zna warstwy 'powodz_1proc', więc `liczoneWarstwy` nie zwraca niczego do liczenia.
    const metaMiasta = [meta('halas_ldwn'), meta('zielen_udzial')]
    const liczone = liczoneWarstwy(metaMiasta, { powodz_1proc: 4 }, {}, 'powodz_1proc')
    assert.deepEqual(liczone, [])
    for (const res of [10, 9, 8] as const) {
      const wynik = wynikiPrzegladu(p, liczone, () => warstwa(p, () => 90), res)
      assert.ok(
        wartosci(wynik).every((v) => v === null),
        `r${res}`,
      )
      assert.equal(liczbaZer(wynik), 0)
    }
  })

  it('warstwa liczona, ale bez pliku, nie daje zera: obniża pewność, a heks zostaje albo gaśnie', () => {
    const jest = warstwa(p, () => 80)
    const liczone = (wagaBrakujacej: number) => [
      { id: 'jest', kierunek: 'wiecej-lepiej' as const, waga: 1 },
      { id: 'brak', kierunek: 'wiecej-lepiej' as const, waga: wagaBrakujacej },
    ]
    const pliki = (id: string) => (id === 'jest' ? jest : null)
    // Warstwa z danymi niesie połowę wagi (równo z progiem): heks zostaje, a wynik to jej ocena.
    assert.equal(PROG_UDZIALU, 0.5)
    const polowa = wynikiPrzegladu(p, liczone(1), pliki, 9)
    assert.ok(wartosci(polowa).every((v) => v === 80))
    // Niecała połowa wagi: za mało danych, heks gaśnie (null), a nie spada do 0.
    const mniej = wynikiPrzegladu(p, liczone(2), pliki, 9)
    assert.ok(wartosci(mniej).every((v) => v === null))
  })
})

describe('warstwaPasuje', () => {
  const p = podstawa(R10_LODZI)

  it('przyjmuje warstwę o tylu komórkach, ile heksów na każdym poziomie', () => {
    assert.equal(
      warstwaPasuje(
        p,
        warstwa(p, () => 50),
      ),
      true,
    )
  })

  it('odrzuca warstwę z innego kompaktu (inna liczba komórek na którymkolwiek poziomie)', () => {
    const ok = warstwa(p, () => 50)
    for (const res of [10, 9, 8] as const) {
      assert.equal(
        warstwaPasuje(p, { ...ok, ocena: { ...ok.ocena, [res]: ok.ocena[res].slice(1) } }),
        false,
        `ocena r${res}`,
      )
      assert.equal(
        warstwaPasuje(p, { ...ok, udzial: { ...ok.udzial, [res]: new Uint8Array(1) } }),
        false,
        `udział r${res}`,
      )
    }
  })
})

describe('zlaczTlo', () => {
  const miastaPoza = MIASTA.filter((m) => m.slug !== 'krakow')

  /** Wyniki miasta: jego r8 i r9 z centrum w `srodek`, wszystkie z wartością `wartosc`. */
  function wynikiMiasta(m: Miasto, wartosc: number | null): WynikiPoziomow {
    const r10 = gridDisk(latLngToCell(m.srodek[1], m.srodek[0], 10), 3)
    const pod = podstawa(r10)
    const mapa = (res: 8 | 9) => new Map(pod.poziomy[res].heksy.map((h) => [h, wartosc]))
    return { 8: mapa(8), 9: mapa(9) }
  }

  const per = new Map<SlugMiasta, WynikiPoziomow>(
    MIASTA.map((m, i) => [m.slug, wynikiMiasta(m, i * 10)]),
  )

  it('pomija bieżące miasto, a resztę składa w dwie mapy (r8 i r9)', () => {
    const tlo = zlaczTlo(per, 'krakow')
    const wlasne = per.get('krakow') as WynikiPoziomow
    for (const h of wlasne[8].keys()) assert.equal(tlo.heksy[8].has(h), false, `r8 ${h}`)
    for (const h of wlasne[9].keys()) assert.equal(tlo.heksy[9].has(h), false, `r9 ${h}`)
    for (const m of miastaPoza) {
      const wyniki = per.get(m.slug) as WynikiPoziomow
      for (const res of [8, 9] as const) {
        for (const [h, w] of wyniki[res])
          assert.equal(tlo.heksy[res].get(h), w, `${m.slug} r${res}`)
      }
    }
    const suma = (res: 8 | 9) =>
      miastaPoza.reduce((s, m) => s + (per.get(m.slug) as WynikiPoziomow)[res].size, 0)
    assert.equal(tlo.heksy[8].size, suma(8))
    assert.equal(tlo.heksy[9].size, suma(9))
  })

  it('bieżące miasto może być dowolne: wypada z tła, wraca poprzednie', () => {
    const tlo = zlaczTlo(per, 'lodz')
    const lodz = per.get('lodz') as WynikiPoziomow
    const krakow = per.get('krakow') as WynikiPoziomow
    for (const h of lodz[9].keys()) assert.equal(tlo.heksy[9].has(h), false)
    for (const h of krakow[9].keys()) assert.equal(tlo.heksy[9].has(h), true)
  })

  it('miastoHeksu podaje nazwę miasta heksu r8 i r9, a dla obcego heksu null', () => {
    const tlo = zlaczTlo(per, 'krakow')
    for (const m of miastaPoza) {
      const wyniki = per.get(m.slug) as WynikiPoziomow
      for (const res of [8, 9] as const) {
        for (const h of wyniki[res].keys())
          assert.equal(tlo.miastoHeksu(h), m.nazwa, `${m.slug} ${h}`)
      }
    }
    // Heks bieżącego miasta nie należy do tła.
    const krakow = per.get('krakow') as WynikiPoziomow
    assert.equal(tlo.miastoHeksu([...krakow[8].keys()][0] as string), null)
    assert.equal(tlo.miastoHeksu('nie-heks'), null)
    assert.equal(tlo.miastoHeksu(latLngToCell(0, 0, 8)), null)
  })

  it('zachowuje null (brak danych) i zero jako różne wartości', () => {
    const z = new Map<SlugMiasta, WynikiPoziomow>([
      ['warszawa', wynikiMiasta(miasto('warszawa'), null)],
      ['lodz', wynikiMiasta(miasto('lodz'), 0)],
    ])
    const tlo = zlaczTlo(z, 'krakow')
    const wartosciTla = [...tlo.heksy[8].values()]
    assert.ok(wartosciTla.includes(null))
    assert.ok(wartosciTla.includes(0))
  })

  it('heks wspólny dla dwóch miast trafia do tego, które jest wcześniej w rejestrze', () => {
    const wspolny = latLngToCell(52, 20, 8)
    const dla = (wartosc: number): WynikiPoziomow => ({
      8: new Map([[wspolny, wartosc]]),
      9: new Map(),
    })
    // Wstawiamy odwrotnie niż w rejestrze (Łódź przed Warszawą): rozstrzyga rejestr, nie kolejność wstawiania.
    const tlo = zlaczTlo(
      new Map<SlugMiasta, WynikiPoziomow>([
        ['lodz', dla(2)],
        ['warszawa', dla(1)],
      ]),
      'krakow',
    )
    assert.equal(tlo.heksy[8].get(wspolny), 1)
    assert.equal(tlo.miastoHeksu(wspolny), 'Warszawa')
  })

  it('bez miast w tle: puste mapy i miastoHeksu zawsze null', () => {
    const tlo = zlaczTlo(new Map(), 'krakow')
    assert.equal(tlo.heksy[8].size, 0)
    assert.equal(tlo.heksy[9].size, 0)
    assert.equal(tlo.miastoHeksu(latLngToCell(50, 19, 8)), null)
  })
})

describe('graniceZHeksow i polaczProstokaty', () => {
  it('granice z r8 obejmują wszystkie wierzchołki wszystkich heksów', () => {
    const r8 = podstawa(R10_LODZI).poziomy[8].heksy
    const granice = graniceZHeksow(r8)
    assert.ok(granice)
    const [[zachod, poludnie], [wschod, polnoc]] = granice
    for (const h of r8) {
      for (const [lon, lat] of cellToBoundary(h, true)) {
        assert.ok(lon >= zachod && lon <= wschod && lat >= poludnie && lat <= polnoc, h)
      }
    }
    // I jest ciasne: każdy bok dotyka jakiegoś wierzchołka.
    const wierzcholki = r8.flatMap((h) => cellToBoundary(h, true))
    assert.equal(Math.min(...wierzcholki.map(([lon]) => lon)), zachod)
    assert.equal(Math.max(...wierzcholki.map(([lon]) => lon)), wschod)
    assert.equal(Math.min(...wierzcholki.map(([, lat]) => lat)), poludnie)
    assert.equal(Math.max(...wierzcholki.map(([, lat]) => lat)), polnoc)
  })

  it('bez heksów null, nie odwrócony prostokąt', () => {
    assert.equal(graniceZHeksow([]), null)
  })

  it('polaczProstokaty bierze najmniejszy prostokąt obejmujący wszystkie, pomijając null', () => {
    assert.equal(polaczProstokaty([]), null)
    assert.equal(polaczProstokaty([null, null]), null)
    assert.deepEqual(
      polaczProstokaty([
        [
          [10, 50],
          [12, 52],
        ],
        null,
        [
          [11, 49],
          [15, 51],
        ],
      ]),
      [
        [10, 49],
        [15, 52],
      ],
    )
  })
})

describe('zbudujMiastoPunktu', () => {
  const lodz = podstawa(R10_LODZI).poziomy[8].heksy
  const [lon, lat] = SRODEK_LODZI
  const punkt = zbudujMiastoPunktu(new Map([['lodz', lodz]]))

  it('punkt w heksie r8 miasta daje to miasto', () => {
    assert.equal(punkt(lon, lat), 'lodz')
  })

  it('punkt poza miastami to null (daleko od heksów, nad morzem, bez współrzędnych)', () => {
    assert.equal(punkt(14.0, 49.0), null)
    assert.equal(punkt(lon + 1, lat), null)
    assert.equal(punkt(Number.NaN, lat), null)
    assert.equal(punkt(lon, Number.POSITIVE_INFINITY), null)
  })

  it('rozpoznaje tylko heksy z listy r8: sąsiad spoza listy to null, heks z listy to miasto', () => {
    const srodkowy = latLngToCell(lat, lon, 8)
    const sasiad = gridDisk(srodkowy, 1).find((h) => h !== srodkowy) as string
    const tylkoSasiad = zbudujMiastoPunktu(new Map([['lodz', [sasiad]]]))
    assert.equal(tylkoSasiad(lon, lat), null)
    const [szerokosc, dlugosc] = cellToLatLng(sasiad)
    assert.equal(tylkoSasiad(dlugosc, szerokosc), 'lodz')
  })

  it('bez miast zawsze null', () => {
    assert.equal(zbudujMiastoPunktu(new Map())(lon, lat), null)
  })

  it('heks wspólny dla dwóch miast należy do wcześniejszego w rejestrze', () => {
    const wspolny = latLngToCell(lat, lon, 8)
    const rozstrzygniecie = zbudujMiastoPunktu(
      new Map<SlugMiasta, readonly string[]>([
        ['lodz', [wspolny]],
        ['krakow', [wspolny]],
      ]),
    )
    assert.equal(rozstrzygniecie(lon, lat), 'krakow')
  })
})

// ── Prawdziwe kompakty ───────────────────────────────────────────────────────────────────

const DANE = new URL('../../public/dane/', import.meta.url)
const katalogMiasta = (m: Miasto) => new URL(m.katalog ? `${m.katalog}/` : '', DANE)

interface Realne {
  miasto: Miasto
  indeks: IndeksKompaktu
  podstawa: PodstawaHeksow
  meta: WskaznikMeta[]
}

const realne = new Map<SlugMiasta, Promise<Realne>>()
function wczytajRealne(m: Miasto): Promise<Realne> {
  let obietnica = realne.get(m.slug)
  if (!obietnica) {
    obietnica = (async () => {
      const kat = katalogMiasta(m)
      const indeks = JSON.parse(
        readFileSync(new URL('kompakt/indeks.json', kat), 'utf8'),
      ) as IndeksKompaktu
      const podstawa = podstawaZPliku(
        await rozpakuj(readFileSync(new URL(`kompakt/${indeks.heksy.plik}`, kat))),
      )
      return {
        miasto: m,
        indeks,
        podstawa,
        meta: Object.values(indeks.wskazniki).map((w) => w.meta),
      }
    })()
    realne.set(m.slug, obietnica)
  }
  return obietnica
}

async function warstwaRealna(r: Realne, id: string): Promise<WarstwaHeksow> {
  const wpis = r.indeks.wskazniki[id]
  assert.ok(wpis, `${r.miasto.slug}: brak warstwy ${id}`)
  const plik = new URL(`kompakt/${wpis.heksy.plik}`, katalogMiasta(r.miasto))
  return warstwaZPliku(await rozpakuj(readFileSync(plik)))
}

describe('prawdziwe kompakty wszystkich miast', { timeout: 120_000 }, () => {
  it('heksy.bin: r8, r9 i r10 to poprawne indeksy H3 swojej rozdzielczości, bez powtórek', async () => {
    for (const m of MIASTA) {
      const r = await wczytajRealne(m)
      for (const res of [8, 9, 10] as const) {
        const heksy = r.podstawa.poziomy[res].heksy
        assert.ok(heksy.length > 0, `${m.slug} r${res}`)
        assert.equal(new Set(heksy).size, heksy.length, `${m.slug} r${res}: powtórzone heksy`)
        for (const h of heksy) {
          assert.ok(isValidCell(h) && getResolution(h) === res, `${m.slug} r${res}: ${h}`)
        }
        assert.equal(
          r.podstawa.poziomy[res].liczba.length,
          heksy.length,
          `${m.slug} r${res} liczba`,
        )
      }
    }
  })

  it('środek miasta z rejestru leży w jego r8, a granice obejmują środek (klik w miasto je rozpoznaje)', async () => {
    const r8PoMiescie = new Map<SlugMiasta, readonly string[]>()
    for (const m of MIASTA)
      r8PoMiescie.set(m.slug, (await wczytajRealne(m)).podstawa.poziomy[8].heksy)
    const miastoPunktu = zbudujMiastoPunktu(r8PoMiescie)
    for (const m of MIASTA) {
      const [lon, lat] = m.srodek
      assert.equal(miastoPunktu(lon, lat), m.slug, `środek ${m.slug}`)
      const granice = graniceZHeksow(r8PoMiescie.get(m.slug) as string[])
      assert.ok(granice, m.slug)
      assert.ok(
        lon > granice[0][0] && lon < granice[1][0] && lat > granice[0][1] && lat < granice[1][1],
        `${m.slug}: środek poza granicami`,
      )
    }
    // Pusty punkt między miastami (Opole, ok. 60 km od najbliższego) nie należy do żadnego.
    assert.equal(miastoPunktu(17.92, 50.67), null)
  })

  it('żadne dwa miasta nie dzielą heksu r8 ani r9 (tło nie ma konfliktów)', async () => {
    for (const res of [8, 9] as const) {
      const widziane = new Map<string, SlugMiasta>()
      for (const m of MIASTA) {
        for (const h of (await wczytajRealne(m)).podstawa.poziomy[res].heksy) {
          assert.equal(widziane.get(h), undefined, `r${res} ${h}: ${widziane.get(h)} i ${m.slug}`)
          widziane.set(h, m.slug)
        }
      }
    }
  })

  it('profil domyślny koloruje każde miasto (r8, r9, r10), wartości 0–100 albo null', async () => {
    const wszystkie = await Promise.all(MIASTA.map(wczytajRealne))
    // Wagi po sumie warstw wszystkich miast (D9), jak `znaneMeta` w stanie aplikacji.
    const suma = new Map<string, WskaznikMeta>()
    for (const r of wszystkie) for (const w of r.meta) if (!suma.has(w.id)) suma.set(w.id, w)
    const profil = ustawieniaPersony(PERSONA_DOMYSLNA, TRYB_DOMYSLNY, [...suma.values()])

    for (const r of wszystkie) {
      const liczone = liczoneWarstwy(r.meta, profil.wagi, profil.kierunki, 'wynik')
      assert.ok(liczone.length > 0, `${r.miasto.slug}: profil nie liczy żadnej warstwy`)
      const pliki = new Map<string, WarstwaHeksow>()
      for (const { id } of liczone) {
        if (!r.indeks.wskazniki[id]) continue
        const w = await warstwaRealna(r, id)
        assert.ok(
          warstwaPasuje(r.podstawa, w),
          `${r.miasto.slug}: warstwa ${id} nie pasuje do heksów`,
        )
        pliki.set(id, w)
      }
      for (const res of [8, 9, 10] as const) {
        const wynik = wynikiPrzegladu(r.podstawa, liczone, (id) => pliki.get(id) ?? null, res)
        assert.equal(wynik.size, r.podstawa.poziomy[res].heksy.length, `${r.miasto.slug} r${res}`)
        const znane = wartosci(wynik).filter((v): v is number => v !== null)
        assert.ok(znane.length > 0, `${r.miasto.slug} r${res}: żaden heks nie ma koloru`)
        assert.ok(
          znane.every((v) => v >= 0 && v <= 100),
          `${r.miasto.slug} r${res}: poza 0–100`,
        )
      }
    }
  })

  it('warstwa, której miasto nie ma, daje w tym mieście same null na każdym poziomie (SC-005)', async () => {
    const krakow = await wczytajRealne(miasto('krakow'))
    let sprawdzone = 0
    for (const m of MIASTA) {
      if (m.slug === 'krakow') continue
      const r = await wczytajRealne(m)
      const idMiasta = new Set(r.meta.map((w) => w.id))
      // Warstwa z kierunkiem w Krakowie, której miasto nie ma: gdyby jej brak liczył się jak 0, miasto
      // pokolorowałoby się na najgorszy kolor.
      const obca = krakow.meta.find((w) => !idMiasta.has(w.id) && w.kierunek !== 'neutralny')
      assert.ok(obca, `${m.slug}: Kraków nie ma warstwy, której nie ma to miasto`)
      const liczone = liczoneWarstwy(r.meta, { [obca.id]: 4 }, {}, obca.id)
      assert.deepEqual(liczone, [], `${m.slug}: ${obca.id}`)
      for (const res of [8, 9, 10] as const) {
        const wynik = wynikiPrzegladu(r.podstawa, liczone, () => null, res)
        assert.ok(
          wartosci(wynik).every((v) => v === null),
          `${m.slug} r${res}`,
        )
        sprawdzone += wynik.size
      }
    }
    assert.ok(sprawdzone > 0, 'test niczego nie zmierzył')
  })

  it('wybrana warstwa, którą miasto ma, koloruje jego heksy; wartość jest oceną warstwy, nie sumą', async () => {
    for (const m of MIASTA) {
      const r = await wczytajRealne(m)
      const wybrana = r.meta.find((w) => w.kierunek !== 'neutralny' && w.kategoria !== 'kontekst')
      assert.ok(wybrana, m.slug)
      const liczone = liczoneWarstwy(r.meta, {}, {}, wybrana.id)
      assert.equal(liczone.length, 1, `${m.slug}: ${wybrana.id}`)
      const w = await warstwaRealna(r, wybrana.id)
      const wynik = wynikiPrzegladu(r.podstawa, liczone, () => w, 9)
      const znane = wartosci(wynik).filter((v): v is number => v !== null)
      assert.ok(znane.length > 0, `${m.slug}: ${wybrana.id}`)
      // Jedna warstwa o wadze 1: wynik heksu to jej ocena (dla "mniej = lepiej" 100 − ocena).
      const heksy = r.podstawa.poziomy[9].heksy
      const i = heksy.findIndex((h) => wynik.get(h) !== null)
      const ocena = (w.ocena[9][i] as number) / r.podstawa.skalaOceny
      const oczekiwana = liczone[0]?.kierunek === 'mniej-lepiej' ? 100 - ocena : ocena
      assert.equal(
        wynik.get(heksy[i] as string),
        oczekiwana,
        `${m.slug}: ${wybrana.id} ${heksy[i]}`,
      )
    }
  })

  it('tło ze wszystkich miast poza bieżącym ma tyle heksów, ile miasta razem, i podaje nazwę każdego', async () => {
    const wszystkie = await Promise.all(MIASTA.map(wczytajRealne))
    const per = new Map<SlugMiasta, WynikiPoziomow>()
    for (const r of wszystkie) {
      per.set(r.miasto.slug, {
        8: wynikiPrzegladu(r.podstawa, [], () => null, 8),
        9: wynikiPrzegladu(r.podstawa, [], () => null, 9),
      })
    }
    const tlo = zlaczTlo(per, 'krakow')
    const poza = wszystkie.filter((r) => r.miasto.slug !== 'krakow')
    for (const res of [8, 9] as const) {
      assert.equal(
        tlo.heksy[res].size,
        poza.reduce((s, r) => s + r.podstawa.poziomy[res].heksy.length, 0),
        `r${res}`,
      )
      for (const r of poza) {
        for (const h of r.podstawa.poziomy[res].heksy) {
          assert.equal(tlo.miastoHeksu(h), r.miasto.nazwa)
        }
      }
    }
    // Same null (nic nie liczymy): szrafura w całym tle, ani jednego koloru.
    assert.ok(wartosci(tlo.heksy[9]).every((v) => v === null))
  })
})
