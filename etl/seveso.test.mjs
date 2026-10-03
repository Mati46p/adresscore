import assert from 'node:assert/strict'
import test from 'node:test'
import { strToU8, zipSync } from 'fflate'
import {
  etykietaZakladu,
  porownajZWykazem,
  wpisyZApi,
  wykazZXlsx,
  zakladyZGeojson,
} from './seveso.mjs'

const punkt = (id, lon, lat, wlasciwosci) => ({
  type: 'Feature',
  id,
  geometry: { type: 'Point', coordinates: [lon, lat] },
  properties: {
    status_statusType: 'sprawny',
    sevesoType: 'ZZR',
    name: 'Zakład Testowy Sp. z o.o.',
    ...wlasciwosci,
  },
})

test('zakladyZGeojson: odrzuca niesprawne, bez punktu, spoza Polski i o nieznanej klasie', () => {
  const { zaklady, odrzucone } = zakladyZGeojson([
    punkt('PF-1', 20.0925, 50.0789, { name: 'ArcelorMittal Poland S.A.  Oddział w Krakowie ' }),
    punkt('PF-2', 20, 50, { status_statusType: 'wycofany' }),
    punkt('PF-3', 20, 50, { sevesoType: 'inna' }),
    punkt('PF-4', 0, 0),
    {
      type: 'Feature',
      id: 'PF-5',
      geometry: null,
      properties: { status_statusType: 'sprawny', sevesoType: 'ZDR' },
    },
  ])
  assert.deepEqual(odrzucone, { niesprawne: 1, bezPunktu: 1, poza: 1, nieznanaKlasa: 1 })
  assert.equal(zaklady.length, 1)
  assert.equal(zaklady[0].nazwa, 'ArcelorMittal Poland S.A. Oddział w Krakowie')
  assert.equal(zaklady[0].typ, 'ZZR')
  assert.ok(zaklady[0].x > 560_000 && zaklady[0].y > 230_000, 'współrzędne w EPSG:2180')
})

test('etykietaZakladu: nazwa i klasa w nawiasie', () => {
  assert.equal(
    etykietaZakladu({ nazwa: 'ALKAT Sp. z o.o. Zakład w Krakowie', typ: 'ZZR' }),
    'ALKAT Sp. z o.o. Zakład w Krakowie (ZZR)',
  )
})

function arkusz(wiersze) {
  const kolumny = 'ABCDEF'
  const xml = wiersze
    .map(
      (w, r) =>
        `<row r="${r + 1}">${w
          .map((v, c) =>
            typeof v === 'number'
              ? `<c r="${kolumny[c]}${r + 1}"><v>${v}</v></c>`
              : `<c r="${kolumny[c]}${r + 1}" t="inlineStr"><is><t>${v}</t></is></c>`,
          )
          .join('')}</row>`,
    )
    .join('')
  return strToU8(`<?xml version="1.0"?><worksheet><sheetData>${xml}</sheetData></worksheet>`)
}

test('wykazZXlsx: klasa z tytułu arkusza, województwo małymi literami, nazwa bez łamań wiersza', () => {
  const xlsx = zipSync({
    'xl/worksheets/sheet1.xml': arkusz([
      [
        'Zakłady o dużym ryzyku wystąpienia poważnej awarii przemysłowej (ZDR) wg stanu na dzień 31 grudnia 2025 r.',
      ],
      ['LICZBA ZDR', 'WOJEWÓDZTWO', 'NAZWA ZAKŁADU', 'ADRES'],
      [1, 'MAŁOPOLSKIE', 'Synthos Agro Sp. z o.o.\n Oświęcim', '32-600 Oświęcim ul. Chemików 1'],
    ]),
    'xl/worksheets/sheet2.xml': arkusz([
      [
        'Zakłady o zwiększonym ryzyku wystąpienia poważnej awarii przemysłowej (ZZR) wg stanu na dzień 31 grudnia 2025 r.',
      ],
      ['LICZBA ZZR', 'WOJEWÓDZTWO', 'NAZWA ZAKŁADU', 'ADRES'],
      [1, 'ŚLĄSKIE', 'Rytm-L &amp; Spółka', '43-100 Tychy'],
    ]),
    'xl/worksheets/sheet3.xml': arkusz([['Inny arkusz'], [1, 'X', 'Y', 'Z']]),
  })
  const wykaz = wykazZXlsx(xlsx)
  assert.deepEqual(wykaz, [
    {
      klasa: 'ZDR',
      wojewodztwo: 'małopolskie',
      nazwa: 'Synthos Agro Sp. z o.o. Oświęcim',
      adres: '32-600 Oświęcim ul. Chemików 1',
    },
    { klasa: 'ZZR', wojewodztwo: 'śląskie', nazwa: 'Rytm-L & Spółka', adres: '43-100 Tychy' },
  ])
})

test('wpisyZApi: wpisy w kształcie wykazu, błąd API zatrzymuje ETL', () => {
  const wpisy = wpisyZApi({
    wynik: { status: 'SUKCES' },
    dane: {
      strona: [
        {
          klasyfikacjaZakladu: 'ZDR',
          nazwaZakladu: ' "Alventa" S.A. ',
          wojewodztwo: 'małopolskie',
          kodPocztowy: '32-566',
          miejscowosc: 'Alwernia',
          ulica: 'ul. Karola Olszewskiego 25',
        },
      ],
    },
  })
  assert.deepEqual(wpisy, [
    {
      klasa: 'ZDR',
      wojewodztwo: 'małopolskie',
      nazwa: '"Alventa" S.A.',
      adres: '32-566 Alwernia ul. Karola Olszewskiego 25',
    },
  ])
  assert.throws(
    () => wpisyZApi({ wynik: { status: 'BLAD', blad: { kod: '400', opis: 'zły parametr' } } }),
    /zły parametr/,
  )
})

test('porownajZWykazem: zgodne mimo innej kolejności słów, brak zgłasza wpis z wykazu', () => {
  const { zaklady } = zakladyZGeojson([
    punkt('PF-1', 19.8203, 50.0703, { name: 'Terminal Paliw w Olszanicy BP 81 -  ORLEN S.A.' }),
    punkt('PF-2', 20.0653, 50.0753, { name: 'ALKAT Sp. z o.o. Zakład w Krakowie' }),
  ])
  const wykaz = [
    {
      klasa: 'ZZR',
      wojewodztwo: 'małopolskie',
      nazwa: 'ORLEN S. A. Terminal Paliw w Olszanicy BP 81',
      adres: '',
    },
    {
      klasa: 'ZZR',
      wojewodztwo: 'małopolskie',
      nazwa: 'POLYNT S Zakład Tworzyw Sztucznych Polynt Sp. z o.o.',
      adres: '',
    },
    {
      klasa: 'ZDR',
      wojewodztwo: 'małopolskie',
      nazwa: 'ALKAT Sp. z o.o. Zakład w Krakowie',
      adres: '',
    }, // inna klasa
    { klasa: 'ZZR', wojewodztwo: 'pomorskie', nazwa: 'Nieistotny', adres: '' }, // inne województwo
  ]
  const wynik = porownajZWykazem(wykaz, zaklady, ['małopolskie'])
  assert.equal(wynik.razem, 3)
  assert.equal(wynik.zgodne, 1)
  assert.deepEqual(
    wynik.brak.map((w) => w.nazwa),
    ['POLYNT S Zakład Tworzyw Sztucznych Polynt Sp. z o.o.', 'ALKAT Sp. z o.o. Zakład w Krakowie'],
  )
})
