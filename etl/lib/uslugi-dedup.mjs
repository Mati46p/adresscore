// Deduplikacja punktów usług w obrębie branży (#104): ten sam lokal z OSM, Overture, rejestru
// i CEIDG ma być jednym punktem z listą źródeł. Reguła (z zadania): mniej niż 30 m i podobna
// nazwa albo mniej niż 15 m, gdy któraś z nazw nieznana (CEIDG nazwy nie niesie nigdy).

import { odlegloscMetry } from './codziennosc-geo.mjs'
import { DEDUP_PROGI, KOLEJNOSC_POZYCJI } from './uslugi-katalog.mjs'

// --- Nazwy ----------------------------------------------------------------------------------

const bezOgonkow = (s) =>
  String(s ?? '')
    .toLocaleLowerCase('pl')
    .replaceAll('ł', 'l')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')

/**
 * Słowa, które nie odróżniają jednego lokalu od drugiego („Sklep spożywczy", „Salon fryzjerski",
 * formy prawne). Nazwa złożona wyłącznie z nich jest dla dedupu nazwą nieznaną.
 */
const SLOWA_OGOLNE = new Set(
  (
    'sklep sklepy spozywczy spozywcze spozywcza spozywczo przemyslowy przemyslowo przemyslowospozywczy ' +
    'apteka apteki punkt apteczny salon fryzjerski fryzjerska fryzjerskie fryzjer fryzjerstwo ' +
    'barber barbershop shop zaklad studio piekarnia piekarnie cukiernia kawiarnia kawiarenka cafe kafe ' +
    'coffee przychodnia poradnia gabinet lekarski lekarska lekarz ' +
    'nzoz spzoz zoz sp zoo oo sc sj sa spolka jawna cywilna komandytowa ltd gmbh filia oddzial ' +
    'nr i w we z ze o u na do the and'
  ).split(' '),
)

/** Znormalizowane tokeny nazwy bez słów ogólnych; pusta lista = nazwa nieznana. */
export function tokenyNazwy(nazwa) {
  return bezOgonkow(nazwa)
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((t) => t && !SLOWA_OGOLNE.has(t))
}

const bigramy = (s) => {
  const z = s.replaceAll(' ', '')
  const mapa = new Map()
  for (let i = 0; i < z.length - 1; i++) {
    const b = z.slice(i, i + 2)
    mapa.set(b, (mapa.get(b) ?? 0) + 1)
  }
  return mapa
}

/** Współczynnik Dice'a na bigramach znaków (0..1): odporny na literówki i odmiany. */
export function podobienstwoDice(a, b) {
  const ba = bigramy(a)
  const bb = bigramy(b)
  const razemA = [...ba.values()].reduce((x, y) => x + y, 0)
  const razemB = [...bb.values()].reduce((x, y) => x + y, 0)
  if (!razemA || !razemB) return a === b && a ? 1 : 0
  let wspolne = 0
  for (const [k, v] of ba) wspolne += Math.min(v, bb.get(k) ?? 0)
  return (2 * wspolne) / (razemA + razemB)
}

const PROG_DICE = 0.8
const PROG_DICE_TOKEN = 0.75

/** Token pasuje do któregoś z listy: identyczny albo (od 6 znaków) literówka/odmiana wg Dice'a. */
const tokenPasuje = (t, lista) =>
  lista.some(
    (u) => u === t || (t.length >= 6 && u.length >= 6 && podobienstwoDice(t, u) >= PROG_DICE_TOKEN),
  )

/**
 * Czy dwie nazwy wskazują ten sam lokal. true / false, a gdy któraś jest nieznana albo ogólna – null
 * (wtedy decyduje wyłącznie odległość). Podobne to: wszystkie tokeny krótszej nazwy występują w
 * dłuższej („Lewiatan" i „Lewiatan Żory"), z tolerancją literówek w tokenach od 6 znaków („Matt
 * Haircut" i „Matt Haircurt Męski"), albo Dice na bigramach całych nazw co najmniej 0,8.
 */
export function podobneNazwy(a, b) {
  const ta = tokenyNazwy(a)
  const tb = tokenyNazwy(b)
  if (!ta.length || !tb.length) return null
  const [mniej, wiecej] = ta.length <= tb.length ? [ta, tb] : [tb, ta]
  if (mniej.every((t) => tokenPasuje(t, wiecej))) return true
  return podobienstwoDice(ta.join(' '), tb.join(' ')) >= PROG_DICE
}

// --- Klastrowanie ---------------------------------------------------------------------------

const M_NA_STOPIEN = (6_371_000 * Math.PI) / 180
const COS0 = Math.cos((50.06 * Math.PI) / 180)
const plaskiX = (lon) => (lon - 19.9) * COS0 * M_NA_STOPIEN
const plaskiY = (lat) => (lat - 50.06) * M_NA_STOPIEN

/** Czy dwa punkty to ten sam lokal wg progów (a, b: { lat, lon, nazwa }). */
export function tenSamLokal(a, b, progi = DEDUP_PROGI) {
  const d = odlegloscMetry(a.lat, a.lon, b.lat, b.lon)
  const podobne = podobneNazwy(a.nazwa, b.nazwa)
  return podobne === null ? d < progi.metryBezNazwy : d < progi.metryZNazwa && podobne
}

const KLUCZ = (cx, cy) => cx * 200_003 + cy

/**
 * Łączy punkty jednej branży. Wejście: { zrodlo, nazwa, lat, lon, flagi[] }. Wynik: klastry
 * { lat, lon, nazwy: [{ nazwa, zrodlo }], zrodla: Set, flagi: Set, rekordy: { zrodlo: liczba } }.
 * Kolejność wejścia nie ma znaczenia: punkty są sortowane wg źródła (KOLEJNOSC_POZYCJI), a w obrębie
 * źródła wg współrzędnych i nazwy, więc ten sam zbiór zawsze daje ten sam wynik. Współrzędne
 * klastra pochodzą od pierwszego punktu, czyli od najbardziej wiarygodnego położeniem źródła.
 */
export function polaczPunkty(punkty, progi = DEDUP_PROGI) {
  const wagaZrodla = (z) => {
    const i = KOLEJNOSC_POZYCJI.indexOf(z)
    return i < 0 ? KOLEJNOSC_POZYCJI.length : i
  }
  const kolejne = [...punkty].sort(
    (a, b) =>
      wagaZrodla(a.zrodlo) - wagaZrodla(b.zrodlo) ||
      a.lat - b.lat ||
      a.lon - b.lon ||
      String(a.nazwa ?? '').localeCompare(String(b.nazwa ?? ''), 'pl'),
  )
  const komorka = Math.max(progi.metryZNazwa, progi.metryBezNazwy)
  const siatka = new Map()
  const klastry = []
  const zasieg = Math.max(progi.metryZNazwa, progi.metryBezNazwy)

  for (const p of kolejne) {
    const x = plaskiX(p.lon)
    const y = plaskiY(p.lat)
    const cx = Math.floor(x / komorka)
    const cy = Math.floor(y / komorka)
    let najlepszy = null
    let najlepszaOdleglosc = Number.POSITIVE_INFINITY
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const k of siatka.get(KLUCZ(cx + dx, cy + dy)) ?? []) {
          if (Math.abs(k.x - x) > zasieg || Math.abs(k.y - y) > zasieg) continue
          const d = odlegloscMetry(p.lat, p.lon, k.lat, k.lon)
          if (d >= najlepszaOdleglosc) continue
          // Znane nazwy klastra: podobna do którejkolwiek wystarcza; żadna znana = nazwa klastra nieznana.
          const znane = k.nazwy.filter((n) => tokenyNazwy(n.nazwa).length)
          const podobne = znane.length
            ? tokenyNazwy(p.nazwa).length
              ? znane.some((n) => podobneNazwy(p.nazwa, n.nazwa))
              : null
            : null
          const ten = podobne === null ? d < progi.metryBezNazwy : d < progi.metryZNazwa && podobne
          if (ten) {
            najlepszy = k
            najlepszaOdleglosc = d
          }
        }
      }
    }
    if (najlepszy) {
      dolacz(najlepszy, p)
    } else {
      const k = {
        lat: p.lat,
        lon: p.lon,
        x,
        y,
        nazwy: [],
        zrodla: new Set(),
        flagi: new Set(),
        rekordy: {},
      }
      dolacz(k, p)
      klastry.push(k)
      const klucz = KLUCZ(cx, cy)
      if (siatka.has(klucz)) siatka.get(klucz).push(k)
      else siatka.set(klucz, [k])
    }
  }
  return klastry
}

function dolacz(klaster, p) {
  klaster.zrodla.add(p.zrodlo)
  klaster.rekordy[p.zrodlo] = (klaster.rekordy[p.zrodlo] ?? 0) + 1
  for (const f of p.flagi ?? []) klaster.flagi.add(f)
  if (p.nazwa && !klaster.nazwy.some((n) => n.nazwa === p.nazwa && n.zrodlo === p.zrodlo))
    klaster.nazwy.push({ nazwa: p.nazwa, zrodlo: p.zrodlo })
}

/** Pokrycie: ile punktów `a` ma punkt `b` w promieniu `metry` (niezależnie od nazwy). */
export function ilePokrytych(a, b, metry) {
  const komorka = metry
  const siatka = new Map()
  for (const p of b) {
    const klucz = KLUCZ(Math.floor(plaskiX(p.lon) / komorka), Math.floor(plaskiY(p.lat) / komorka))
    if (siatka.has(klucz)) siatka.get(klucz).push(p)
    else siatka.set(klucz, [p])
  }
  let ile = 0
  for (const p of a) {
    const cx = Math.floor(plaskiX(p.lon) / komorka)
    const cy = Math.floor(plaskiY(p.lat) / komorka)
    let jest = false
    for (let dx = -1; dx <= 1 && !jest; dx++)
      for (let dy = -1; dy <= 1 && !jest; dy++)
        for (const q of siatka.get(KLUCZ(cx + dx, cy + dy)) ?? [])
          if (odlegloscMetry(p.lat, p.lon, q.lat, q.lon) <= metry) {
            jest = true
            break
          }
    if (jest) ile++
  }
  return ile
}
