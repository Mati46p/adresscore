// Kontrola modelu GIOŚ (PM2,5 i PM10) na czujnikach Sensor.Community (zadanie #144).
//
// Co robi: porównuje wartości warstw pm25_srednia i pm10_srednia (etl/powietrze.mjs, w Krakowie
//   z doprecyzowaniem do adresu z #131) ze średnimi rocznymi z czujników obywatelskich Sensor.Community
//   w Krakowie i gminach wokół niego – dla roku modelu GIOŚ. Odrzuca wadliwe odczyty (wilgotność
//   > 80%, skoki, godziny zawieszone i odstające względem innych czujników), reguły: lib/sensor-community.mjs.
// Wynik: public/dane/powietrze_kontrola_sensor_community.json – tabela zgodności do strony metody
//   (wiersz = czujnik: model, czujnik, różnica) plus podsumowanie. To NIE jest wskaźnik: nie zmienia
//   wartości adresów ani wyniku, nie trafia do manifestu.
// Źródło: archiwum Sensor.Community (pliki dobowe per czujnik, nie miesięczne zipy), ODbL 1.0 + DbCL 1.0,
//   bez klucza i konta. Lista czujników: żywe API (data.24h.json) plus spis dwóch dób kontrolnych roku
//   (czujniki, które dziś już nie nadają). Atrybucja: Sensor.Community.
// Uruchom: node etl/sensor-community.mjs. Pierwszy bieg to ok. 50 tys. drobnych żądań (ok. 40 min,
//   6–8 połączeń naraz); agregaty godzinowe są w etl/.cache/sensor-community, więc drugi bieg
//   nie pyta serwera. Opis: etl/sensor-community.md.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import KDBush from 'kdbush'
import { do2180 } from './lib/geo.mjs'
import { bboxAdresow, indeksOczek, pobierzOczka, znajdzRok } from './lib/powietrze.mjs'
import {
  GRUPY,
  modelPrzyPunkcie,
  ocenCzujniki,
  podsumuj,
  REGULY,
  rocznikCzujnika,
  zdaniaWyniku,
} from './lib/sensor-community.mjs'
import {
  granicePrzyAdresach,
  kandydaci,
  pobierzZywe,
  polaczLokalizacje,
  pozycjeDnia,
  spisDnia,
  uzupelnijPartnerow,
} from './lib/sensor-community-lista.mjs'
import { DANE, dzis, wczytajAdresy } from './lib/wspolne.mjs'

const PLIK_WYNIKU = join(DANE, 'powietrze_kontrola_sensor_community.json')
const ZASIEG_ADRESU_M = 250
const LICENCJA_SC =
  'Open Database License (ODbL) 1.0 dla bazy i Database Contents License (DbCL) 1.0 dla zawartości (00disclamer.md archiwum). Tabela agregatów w tym pliku jest bazą pochodną i też jest udostępniana na warunkach ODbL. Atrybucja: Contains information from Sensor.Community, which is made available here under the Open Database License (ODbL).'

const zaokr = (v, miejsca = 2) =>
  v === null || v === undefined ? null : Math.round(v * 10 ** miejsca) / 10 ** miejsca
const dniKontrolne = (rok) => [`${rok}-02-12`, `${rok}-08-13`]

function wczytajWskaznik(id, wersja) {
  const plik = JSON.parse(readFileSync(join(DANE, 'wskazniki', `${id}.json`), 'utf8'))
  if (plik.wersjaAdresow !== wersja)
    throw new Error(`${id}: nieaktualny względem adresów – przelicz najpierw tę warstwę`)
  return plik
}

/** Opis metody generowany z tych samych stałych, których używa kod – opis nie może się rozjechać z regułami. */
export function opisMetody(rok) {
  const r = REGULY
  const [k2, d2] = r.skok.p2
  const [k1, d1] = r.skok.p1
  return [
    `Rok porównania: ${rok}, ten sam co model GIOŚ. Wszystkie godziny w UTC.`,
    `Czujniki: stacje Sensor.Community z czujnikiem pyłu na zewnątrz, nadające dziś (żywe API) albo w jednej z dwóch dób kontrolnych roku (${dniKontrolne(rok).join(', ')}, spis archiwum); do tabeli wchodzą te, które mają adres modelu w promieniu ${ZASIEG_ADRESU_M} m.`,
    `Odczyty: średnie godzinowe z dobowych plików archiwum; godzina jest ważna od ${r.minOdczytowWGodzinie} odczytów (czujnik raportujący rzadziej: od połowy swojej typowej liczby odczytów na godzinę, co najmniej od jednego). Odrzucamy odczyty poza zakresem 0–${r.maxOdczytu} µg/m³ i pojedyncze skoki (ponad ${k2}× mediana godziny + ${d2} µg/m³ dla PM2,5, ponad ${k1}× mediana + ${d1} dla PM10), godziny zawieszone (co najmniej ${r.zawieszenieOdczytow} identycznych odczytów PM2,5), godziny z PM2,5 większym od PM10 o więcej niż ${Math.round(100 * r.niespojnosc.wzgledna)}% + ${r.niespojnosc.bezwzgledna} µg/m³ oraz godziny odstające względem mediany wszystkich czujników (ponad ${r.odstajaca.mnoznik}× mediana + ${r.odstajaca.dodatek} µg/m³, albo poniżej 1/${r.odstajaca.dolny} mediany, gdy mediana przekracza ${r.odstajaca.medianaDlaDolnego} µg/m³).`,
    `Wilgotność: z czujnika wilgotności w tej samej lokalizacji (BME280, SHT3x, DHT22). Powyżej ${r.progWilgotnosci}% czujniki optyczne zawyżają odczyt (rosną krople), więc dla każdego czujnika są dwie średnie: z wszystkich godzin i „suche” (tylko godziny o wilgotności do ${r.progWilgotnosci}%). Czujnik wilgotności zawieszony w danej dobie (rozstęp odczytów poniżej ${String(r.wilgotnoscZawieszona.maxRozstep).replace('.', ',')} p.p.) nie liczy się jako pomiar. Bez czujnika wilgotności jest tylko średnia z wszystkich godzin.`,
    `Średnia roczna to średnia ze średnich miesięcznych (miesiąc wchodzi od ${r.minGodzinWMiesiacu} ważnych godzin, a dla średniej „suchej” od ${r.minGodzinSuchychWMiesiacu}; potrzeba co najmniej ${r.minMiesiecy} miesięcy).`,
    `Czujnik wchodzi do tabeli przy pokryciu co najmniej ${Math.round(100 * r.minPokrycie)}% godzin roku, stałej lokalizacji oraz udziale godzin odstających do ${Math.round(100 * r.maxUdzialOdstajacych)}%, zawieszonych do ${Math.round(100 * r.maxUdzialZawieszonych)}% i niespójnych do ${Math.round(100 * r.maxUdzialNiespojnych)}%. Pozostałe są na liście odrzuconych z powodem.`,
    'Model: średnia warstwy z adresów do 100 m od czujnika (do 250 m, gdy brak) – kolumna „model”, w Krakowie z doprecyzowaniem do adresu (#131) – oraz surowa wartość oczka GIOŚ w punkcie czujnika, bez doprecyzowania – kolumna „modelOczko”. Różnica = model − czujnik (dodatnia: model wyższy).',
  ]
}

const OGRANICZENIA = [
  'Czujniki Sensor.Community (SDS011, SPS30) to tanie czujniki optyczne, nie referencyjne: przy dużej wilgotności zawyżają odczyt, z wiekiem mogą tracić czułość i różnią się między egzemplarzami. Nikt ich tu nie skalibrował względem stacji GIOŚ, więc tabela pokazuje zgodność modelu z czujnikami, a nie błąd modelu.',
  'Średnia „suche” pomija godziny z wilgotnością powyżej 80%, a to częściej noce i dni z mgłą i inwersją, czyli stężenia wyższe od typowych, więc jest z natury niższa od prawdziwej średniej rocznej. Średnia z wszystkich godzin jest za to zawyżona przez wilgoć. Dlatego podajemy obie; przy skalibrowanym czujniku prawdziwa średnia roczna leży najpewniej między nimi. Do porównania z modelem lepiej nadaje się średnia z wszystkich godzin, bo ma pełną próbę i nie ma błędu doboru godzin.',
  'Czujnik wilgotności stoi zwykle w tej samej obudowie co czujnik pyłu, więc mierzy wilgotność w obudowie, nie na zewnątrz (nagrzewa ją wentylator i elektronika). Średnia roczna wilgotność i udział godzin powyżej 80% różnią się między stanowiskami kilkakrotnie, więc ten sam próg 80% odrzuca na jednych stanowiskach prawie żadne godziny, a na innych jedną trzecią.',
  'Próba jest mała i nielosowa (czujniki stoją tam, gdzie mieszkają ich właściciele), więc korelacji ani średnich nie należy uogólniać na całe miasto.',
  'Na liście są czujniki nadające dziś albo w jednej z dwóch dób kontrolnych roku; czujnik, który działał tylko w innych tygodniach roku, mógł nie wejść.',
  'Pozycje czujników podajemy z dokładnością do 3 miejsc po przecinku (ok. 100 m), tak jak publikuje je Sensor.Community; model GIOŚ ma oczko 360 × 560 m (Kraków) i 1,8 × 2,8 km.',
]

const KOLUMNY = {
  model:
    'Wartość warstwy (pm25_srednia albo pm10_srednia) w adresach do 100 m od czujnika, µg/m³; w Krakowie z doprecyzowaniem do adresu (#131).',
  modelOczko:
    'Surowa wartość oczka GIOŚ w punkcie czujnika, µg/m³, bez doprecyzowania. Różnica model − modelOczko pokazuje wpływ doprecyzowania.',
  'czujnik.suche':
    'Średnia roczna z godzin o wilgotności do 80%, µg/m³. null: brak czujnika wilgotności albo za mało suchych godzin.',
  'czujnik.wszystkie':
    'Średnia roczna ze wszystkich ważnych godzin, µg/m³ (bez filtra wilgotności).',
  roznica:
    'model − czujnik, µg/m³ (dodatnia: model wyższy od czujnika), osobno dla średniej „suche” i „wszystkie”.',
  roznicaProc: 'Różnica w procentach wartości czujnika.',
  'wilgotnosc.srednia':
    'Średnia roczna wilgotność (%) zmierzona przy czujniku pyłu w godzinach z ważnym odczytem pyłu; to wilgotność w obudowie czujnika, nie na zewnątrz.',
}

async function main() {
  const { adresy, wersja } = wczytajAdresy()
  const pm25 = wczytajWskaznik('pm25_srednia', wersja)
  const pm10 = wczytajWskaznik('pm10_srednia', wersja)
  const rok = Number(pm25.meta.zrodla[0].dataDanych)
  if (!Number.isInteger(rok)) throw new Error('pm25_srednia: brak roku modelu w źródle')
  const gios = await znajdzRok()
  if (Number(gios.rok) !== rok)
    throw new Error(`Rok modelu GIOŚ ${gios.rok} ≠ rok warstwy ${rok} – przelicz etl/powietrze.mjs`)
  console.log(`Rok modelu: ${rok}, adresów: ${adresy.length}`)

  const bbox = bboxAdresow(adresy)
  const oczka = {}
  for (const w of ['PM2.5', 'PM10'])
    oczka[w] = indeksOczek(await pobierzOczka(gios.rok, w, gios.warstwy[w], bbox))

  const adresyXY = adresy.map((a) => do2180(a.lon, a.lat))
  const indeks = new KDBush(adresy.length)
  for (const [x, y] of adresyXY) indeks.add(x, y)
  indeks.finish()

  // --- lista czujników
  const granice = granicePrzyAdresach(adresy)
  const zywe = await pobierzZywe(granice)
  const pozycje = []
  const dniSpisow = []
  for (const dzien of dniKontrolne(rok)) {
    pozycje.push(await pozycjeDnia(dzien))
    dniSpisow.push({ dzien, spis: await spisDnia(dzien) })
  }
  const wszystkie = kandydaci(polaczLokalizacje(zywe.lokalizacje, pozycje, granice))
  const wDobachKontrolnych = (s) =>
    dniSpisow.some(({ spis }) => (spis[s.typ.toLowerCase()] ?? []).includes(s.id))
  const odrzucone = []
  let pozaAdresami = 0
  const lista = []
  for (const k of wszystkie) {
    const [x, y] = do2180(k.lon, k.lat)
    if (!modelPrzyPunkcie(x, y, adresyXY, indeks, pm25.wartosci, [ZASIEG_ADRESU_M])) {
      pozaAdresami++
      continue
    }
    const pyl = k.pyl.filter(wDobachKontrolnych)
    for (const s of k.pyl.filter((p) => !wDobachKontrolnych(p)))
      odrzucone.push({
        id: s.id,
        typ: s.typ,
        powod: `brak pliku w archiwum w obu dobach kontrolnych (${dniKontrolne(rok).join(', ')})`,
      })
    if (pyl.length) lista.push({ ...k, pyl })
  }
  console.log(
    `Czujniki: ${wszystkie.length} lokalizacji w prostokącie adresów, ${pozaAdresami} poza adresami modelu, do pobrania ${lista.length} lokalizacji`,
  )
  await uzupelnijPartnerow(lista, dniSpisow, rok)

  // --- pobranie roczników (cache) i ocena
  const wejscie = []
  let nr = 0
  for (const k of lista)
    for (const s of k.pyl) {
      nr++
      const pyl = await rocznikCzujnika({ rodzaj: 'pyl', typ: s.typ, id: s.id, rok })
      const wilgotnosc = []
      for (const w of k.wilgotnosc)
        wilgotnosc.push(await rocznikCzujnika({ rodzaj: 'wilgotnosc', typ: w.typ, id: w.id, rok }))
      console.log(
        `[${nr}] ${s.typ}#${s.id} (lokalizacja ${k.location}): ${pyl.dniZPlikiem} dób z plikiem, wilgotność: ${wilgotnosc.map((w) => `${w.typ}#${w.id} ${w.dniZPlikiem} dób`).join(', ') || 'brak'}`,
      )
      wejscie.push({ id: s.id, typ: s.typ, location: k.location, k, pyl, wilgotnosc })
    }
  const oceny = ocenCzujniki(wejscie, rok)
  const pobrano = [...wejscie.flatMap((w) => [w.pyl, ...w.wilgotnosc])]
    .map((r) => r.pobrano)
    .sort()
    .at(-1)

  // --- model przy czujnikach
  const wiersze = []
  for (const [i, o] of oceny.entries()) {
    const k = wejscie[i].k
    if (!o.przyjety) {
      odrzucone.push({ id: o.id, typ: o.typ, powod: o.powody.join('; ') })
      continue
    }
    const poz = o.pozycja ?? { lat: k.lat, lon: k.lon }
    const [x, y] = do2180(poz.lon, poz.lat)
    const m25 = modelPrzyPunkcie(x, y, adresyXY, indeks, pm25.wartosci)
    const m10 = modelPrzyPunkcie(x, y, adresyXY, indeks, pm10.wartosci)
    if (!m25 || !m10) {
      odrzucone.push({ id: o.id, typ: o.typ, powod: 'brak adresu modelu w promieniu 250 m' })
      continue
    }
    const adres = adresy[m25.najblizszy]
    const blok = (pole, m, wskaznik) => {
      const c = o[pole]
      const oczko = oczka[wskaznik](x, y)?.v ?? null
      const roznica = (cz) => (cz === null ? null : zaokr(m.wartosc - cz))
      const proc = (cz) => (cz === null ? null : zaokr((100 * (m.wartosc - cz)) / cz, 1))
      return {
        model: zaokr(m.wartosc),
        modelOczko: zaokr(oczko),
        adresowWPromieniu: m.adresow,
        czujnik: { suche: zaokr(c.suche), wszystkie: zaokr(c.wszystkie) },
        roznica: { suche: roznica(c.suche), wszystkie: roznica(c.wszystkie) },
        roznicaProc: { suche: proc(c.suche), wszystkie: proc(c.wszystkie) },
        godzinSuchych: c.godzinSuchych,
        miesiaceSuche: c.miesiaceSuche,
        odstajace: c.odstajace,
      }
    }
    wiersze.push({
      id: o.id,
      typ: o.typ,
      lokalizacja: o.location,
      grupa: adres.gmina === 'Kraków' ? 'Kraków' : 'obwarzanek',
      gmina: adres.gmina,
      dzielnica: adres.dzielnica ?? null,
      lon: zaokr(poz.lon, 3),
      lat: zaokr(poz.lat, 3),
      wilgotnosc: k.wilgotnosc.length
        ? {
            czujniki: k.wilgotnosc.map((w) => `${w.typ}#${w.id}`),
            godzinSuchych: o.wilgotnosc?.godzinSuchych ?? 0,
            godzinWilgotnych: o.wilgotnosc?.godzinWilgotnych ?? 0,
            godzinBezPomiaru: o.wilgotnosc?.godzinBezPomiaru ?? 0,
            srednia: o.wilgotnosc?.srednia == null ? null : Math.round(o.wilgotnosc.srednia),
          }
        : null,
      jakosc: {
        pokrycie: zaokr(o.pokrycie),
        godzinWaznych: o.godzinWaznych,
        miesiace: o.pm25.miesiace,
        usuniete: o.usuniete,
      },
      pm25: blok('pm25', m25, 'PM2.5'),
      pm10: blok('pm10', m10, 'PM10'),
    })
  }
  wiersze.sort(
    (a, b) =>
      GRUPY.indexOf(a.grupa) - GRUPY.indexOf(b.grupa) ||
      (a.dzielnica ?? '').localeCompare(b.dzielnica ?? '', 'pl') ||
      a.id - b.id,
  )

  const podsumowanie = podsumuj(wiersze)
  const wynik = {
    meta: {
      zadanie: 144,
      nazwa: 'Kontrola modelu PM2,5 i PM10 na czujnikach Sensor.Community',
      opis: `Porównanie rocznych średnich PM2,5 i PM10 z modelu GIOŚ (warstwy pm25_srednia i pm10_srednia za ${rok}) ze średnimi ${rok} z czujników obywatelskich Sensor.Community w Krakowie i gminach wokół niego. Tabela służy stronie metody; to nie jest wskaźnik i nie zmienia wartości adresów ani wyniku.`,
      rok,
      jednostka: 'µg/m³',
      wersjaAdresow: wersja,
      wygenerowano: dzis(),
      grupy: {
        Kraków: 'gmina Kraków',
        obwarzanek: 'pozostałe gminy z warstwy adresów (obwarzanek)',
      },
      atrybucja:
        'Contains information from Sensor.Community, which is made available here under the Open Database License (ODbL).',
      zrodla: [
        {
          nazwa: `Sensor.Community – archiwum odczytów czujników, pliki dobowe CSV, ${rok}`,
          url: 'https://archive.sensor.community/',
          licencja: LICENCJA_SC,
          dataDanych: String(rok),
          pobrano,
        },
        {
          nazwa: 'Sensor.Community – żywe API (lista czujników wokół Krakowa)',
          url: 'https://data.sensor.community/static/v2/data.24h.json',
          licencja:
            'Te same dane co w archiwum (ODbL 1.0, DbCL 1.0); z żywego API użyto wyłącznie listy lokalizacji i typów czujników.',
          dataDanych: zywe.pobrano,
          pobrano: zywe.pobrano,
        },
        {
          nazwa: `GIOŚ – Modelowanie na potrzeby ocen, ${rok}, PM2.5 i PM10, średnia roczna (Źródło danych: GIOŚ - EKOINFONET)`,
          url: 'https://powietrze.gios.gov.pl/pjp/maps/modeling',
          licencja:
            'Ponowne wykorzystanie informacji sektora publicznego; wymagane wskazanie źródła GIOŚ - EKOINFONET i informacja o przetworzeniu',
          dataDanych: String(rok),
          pobrano: pm25.meta.zrodla[0].pobrano,
        },
      ],
      liczby: {
        lokalizacjiWProstokacie: wszystkie.length,
        pozaAdresamiModelu: pozaAdresami,
        czujnikowOcenionych: oceny.length,
        czujnikowWTabeli: wiersze.length,
        czujnikowOdrzuconych: odrzucone.length,
      },
      wynik: zdaniaWyniku(podsumowanie, wiersze),
      metoda: opisMetody(rok),
      ograniczenia: OGRANICZENIA,
      kolumny: KOLUMNY,
    },
    podsumowanie,
    czujniki: wiersze,
    odrzucone: odrzucone.sort((a, b) => a.id - b.id),
  }
  writeFileSync(PLIK_WYNIKU, `${JSON.stringify(wynik, null, 1)}\n`)
  console.log(
    `Zapisano ${PLIK_WYNIKU}: ${wiersze.length} czujników w tabeli, ${odrzucone.length} odrzuconych`,
  )
  wypiszTabele(wiersze, podsumowanie)
  console.log(`\n${wynik.meta.wynik.join('\n')}`)
}

function wypiszTabele(wiersze, podsumowanie) {
  for (const [klucz, pole] of [
    ['PM2.5', 'pm25'],
    ['PM10', 'pm10'],
  ]) {
    console.log(
      `\n${klucz} (µg/m³): czujnik | grupa | dzielnica | model | oczko | suche | wszystkie | różnica(suche)`,
    )
    for (const w of wiersze) {
      const b = w[pole]
      console.log(
        `${w.typ}#${w.id} | ${w.grupa} | ${w.dzielnica ?? w.gmina} | ${b.model} | ${b.modelOczko} | ${b.czujnik.suche ?? '-'} | ${b.czujnik.wszystkie} | ${b.roznica.suche ?? '-'}`,
      )
    }
    console.log(JSON.stringify(podsumowanie[klucz], null, 1))
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1])
  main().catch((blad) => {
    console.error(blad)
    process.exitCode = 1
  })
