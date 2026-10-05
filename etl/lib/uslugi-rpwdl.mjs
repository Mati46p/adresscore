// RPWDL dla branż z kodem resortowym (#160): dentysta, fizjoterapia i laboratorium. Źródłem jest ten sam
// zrzut rejestru co przy POZ (#8): przychodniePoz() z etl/lib/codziennosc-zrodla.mjs pobiera zip i
// rozpakowuje komorki.csv, zaklady.csv i Info.txt do etl/.cache/rpwdl, a ten moduł tylko je czyta
// (nie zmieniamy codziennosc-*.mjs, więc POZ i nowe branże dzielą cache, nie kod).
// Punkt rejestru to czynna komórka organizacyjna z kodem VIII części resortowej (`kodResortVIII`) i
// numerem budynku; adres geokodujemy usługą UUG jak w #8 (geokoduj, wspólny cache wyników).
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DuckDBInstance } from '@duckdb/node-api'
import { geokoduj } from './codziennosc-geo.mjs'
import { BBOX } from './codziennosc-zrodla.mjs'
import { TERYT_WOJ, wMiescieMiasta } from './miasto.mjs'
import { BRANZE } from './uslugi-katalog.mjs'
import { CACHE, dzis } from './wspolne.mjs'

const KATALOG = join(CACHE, 'rpwdl')
const sq = (s) => s.replaceAll("'", "''")

const wBbox = (p) =>
  p.lat >= BBOX.minLat && p.lat <= BBOX.maxLat && p.lon >= BBOX.minLon && p.lon <= BBOX.maxLon

/**
 * Kod resortowy VIII części → id branży z katalogu (`kodyRpwdl`). Ten sam kod w dwóch branżach to
 * błąd katalogu (komórka trafiłaby do obu), więc funkcja rzuca zamiast wybierać po cichu.
 */
export function branzePoKodzieRpwdl(branze = BRANZE) {
  const mapa = new Map()
  for (const b of branze)
    for (const kod of b.kodyRpwdl ?? []) {
      if (mapa.has(kod))
        throw new Error(`Kod RPWDL ${kod} jest w dwóch branżach: ${mapa.get(kod)} i ${b.id}`)
      mapa.set(kod, b.id)
    }
  return mapa
}

/**
 * Zapytanie o komórki Małopolski (TERYT 12…) z danymi kodami: czynne w dniu `dzien` (bez końca
 * działalności, już rozpoczęte, nie zawieszone) i z numerem budynku. Nazwa to nazwa zakładu, a bez niej
 * nazwa komórki, jak przy POZ. Daty w RPWDL są w formacie ISO, więc porównanie napisów jest porównaniem dat.
 */
export function zapytanieKomorek(kody, dzien, katalog = KATALOG) {
  const csv = (p) =>
    `read_csv('${sq(join(katalog, p))}', delim=';', quote='"', header=true, all_varchar=true, nullstr='NULL', ignore_errors=true)`
  return `select coalesce(z.Nazwa, k."Nazwa komórki") as nazwa, k.Miejscowość as miejscowosc,
            k.Ulica as ulica, k.Budynek as nr, k."Kod pocztowy" as kod, k.kodResortVIII as kod8
     from ${csv('komorki.csv')} k
     left join (select "ID ZOZ" as id, min(Nazwa) as Nazwa from ${csv('zaklady.csv')} group by "ID ZOZ") z on z.id = k."ID ZOZ"
     where k.kodResortVIII in (${kody.map((x) => `'${sq(x)}'`).join(',')})
       and k.Teryt like '${TERYT_WOJ}%'
       and k."Data zakończenia działalności komórki" is null
       and k."Budynek" is not null
       and (k."Data rozpoczęcia działalności komórki" is null or k."Data rozpoczęcia działalności komórki" <= '${dzien}')
       and not (k."Początek okresu zawieszenia" is not null and k."Początek okresu zawieszenia" <= '${dzien}'
                and (k."Koniec okresu zawieszenia" is null or k."Koniec okresu zawieszenia" >= '${dzien}'))
     order by miejscowosc, ulica, nr, nazwa, kod8`
}

/** Komórki z danymi kodami jako wiersze { nazwa, miejscowosc, ulica, nr, kod, kod8 }. */
export async function wierszeKomorek(kody, { dzien = dzis(), katalog = KATALOG } = {}) {
  const wymagane = ['komorki.csv', 'zaklady.csv']
  const brak = wymagane.filter((p) => !existsSync(join(katalog, p)))
  if (brak.length)
    throw new Error(
      `Brak ${brak.join(', ')} w ${katalog}: uruchom najpierw przychodniePoz() (#8), które pobiera i rozpakowuje RPWDL`,
    )
  const db = await DuckDBInstance.create(':memory:')
  const c = await db.connect()
  return (await c.runAndReadAll(zapytanieKomorek(kody, dzien, katalog))).getRowObjectsJson()
}

/**
 * Punkty rejestru dla branż z `kodyRpwdl`: { stan, razem, trafione, punkty, wgBranz }.
 * `punkty` mają `zrodlo: 'rejestr'` i `branza`, jak punkty rejestru w etl/uslugi.mjs; `razem` to czynne
 * komórki Małopolski, `trafione` – z adresem znalezionym w UUG; `wgBranz[id]` rozbija to na branże
 * (komórek, trafionych i leżących w obszarze BBOX). Wymaga plików z etl/.cache/rpwdl, które
 * przygotowuje przychodniePoz().
 */
export async function punktyRpwdlBranz({
  dzien = dzis(),
  katalog = KATALOG,
  geokoduj: geo = geokoduj,
} = {}) {
  const poKodzie = branzePoKodzieRpwdl()
  // Tryb miasta: geokodujemy tylko komórki z miejscowości miasta (UUG jest wolny).
  const wiersze = (await wierszeKomorek([...poKodzie.keys()], { dzien, katalog })).filter((w) =>
    wMiescieMiasta(w.miejscowosc),
  )
  const wsp = await geo(
    wiersze.map((w) => ({ miejscowosc: w.miejscowosc, ulica: w.ulica, nr: w.nr, kod: w.kod })),
  )
  const wgBranz = Object.fromEntries(
    [...new Set(poKodzie.values())].map((id) => [id, { komorek: 0, trafione: 0, wObszarze: 0 }]),
  )
  const punkty = []
  wiersze.forEach((w, i) => {
    const branza = poKodzie.get(w.kod8)
    const licznik = wgBranz[branza]
    licznik.komorek++
    if (!wsp[i]) return
    licznik.trafione++
    const p = {
      zrodlo: 'rejestr',
      branza,
      nazwa: w.nazwa ?? null,
      lat: wsp[i].lat,
      lon: wsp[i].lon,
      flagi: [],
    }
    if (!wBbox(p)) return
    licznik.wObszarze++
    punkty.push(p)
  })
  // Info.txt: „Raport wygenerowany na podstawie danych w systemie RPWDL z dnia 2026-10-02 00:00:00".
  const info = join(katalog, 'Info.txt')
  const stan = existsSync(info)
    ? (/(\d{4}-\d{2}-\d{2})/.exec(readFileSync(info, 'utf8'))?.[1] ?? null)
    : null
  return { stan, razem: wiersze.length, trafione: wsp.filter(Boolean).length, punkty, wgBranz }
}
