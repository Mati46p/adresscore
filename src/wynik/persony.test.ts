// Uruchom: node --test src/wynik/
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import type { WskaznikMeta } from '../kontrakty/index.ts'
import { BIZNESY, PERSONY, TRYBY, ustawieniaPersony } from './persony.ts'
import { kierunekEfektywny } from './silnik.ts'
import { czytajHash, zapiszHash } from './url.ts'

const manifest = [
  { id: 'halas_ldwn', kategoria: 'spokoj' },
  { id: 'inwestycje_500m', kategoria: 'spolecznosc' },
  { id: 'cena_m2_mediana', kategoria: 'kontekst' },
  { id: 'nowa_warstwa', kategoria: 'transport' },
  { id: 'sklep_odleglosc', kategoria: 'codziennosc' },
  { id: 'ludnosc_1km', kategoria: 'kontekst' },
] as const

describe('persony', () => {
  it('wagi w zakresie 0–4 dla każdej persony i trybu', () => {
    for (const p of PERSONY) {
      for (const tryb of TRYBY.map((t) => t.id)) {
        const { wagi } = ustawieniaPersony(p.id, tryb, manifest)
        for (const w of Object.values(wagi)) assert.ok(w >= 0 && w <= 4)
      }
    }
  })

  it('nieznane id z persony pomija, nowa warstwa czeka na świadome włączenie', () => {
    const { wagi } = ustawieniaPersony('rodzina', 'kupuje', manifest)
    assert.deepEqual(Object.keys(wagi).sort(), manifest.map((m) => m.id).sort())
    assert.equal(wagi.nowa_warstwa, 0)
  })

  it('profile włączają różne podzbiory istniejących warstw, bez polityki i atrapy ceny', () => {
    const katalog = readdirSync('public/dane/wskazniki')
      .filter((plik) => plik.endsWith('.json'))
      .map((plik) => JSON.parse(readFileSync(`public/dane/wskazniki/${plik}`, 'utf8')).meta)
    const znane = new Set(katalog.map((m) => m.id))
    for (const p of PERSONY) {
      for (const id of Object.keys(p.wagi)) assert.ok(znane.has(id), `${p.id}: ${id}`)
      const { wagi } = ustawieniaPersony(p.id, 'kupuje', katalog)
      const aktywne = Object.values(wagi).filter((w) => w > 0).length
      if (p.id === 'od-zera') assert.equal(aktywne, 0)
      else assert.ok(aktywne >= 10 && aktywne <= 25, `${p.id}: ${aktywne}`)
      assert.equal(wagi.cena_m2_mediana, 0)
      for (let i = 1; i <= 7; i++) assert.equal(wagi[`sejm2023_lista_${i}`], 0)
    }
    const rodzina = ustawieniaPersony('rodzina', 'kupuje', katalog).wagi
    const singiel = ustawieniaPersony('singiel', 'kupuje', katalog).wagi
    const senior = ustawieniaPersony('senior', 'kupuje', katalog).wagi
    const inwestor = ustawieniaPersony('inwestor', 'kupuje', katalog).wagi
    assert.ok((rodzina.przedszkole_odleglosc ?? 0) > (singiel.przedszkole_odleglosc ?? 0))
    assert.ok((singiel.rynek_czas_min ?? 0) > (rodzina.rynek_czas_min ?? 0))
    assert.ok((senior.przychodnia_odleglosc ?? 0) > (inwestor.przychodnia_odleglosc ?? 0))
    assert.ok((inwestor.inwestycje_500m ?? 0) > (senior.inwestycje_500m ?? 0))
  })

  it('kontekst zawsze 0, od zera wszędzie 0', () => {
    for (const p of PERSONY)
      assert.equal(ustawieniaPersony(p.id, 'kupuje', manifest).wagi.cena_m2_mediana, 0)
    const { wagi } = ustawieniaPersony('od-zera', 'wynajmuje', manifest)
    for (const w of Object.values(wagi)) assert.equal(w, 0)
  })

  it('od zera ignoruje domyślną wagę nowej warstwy, inne persony ją biorą', () => {
    const nowa = [{ id: 'nowa_warstwa', kategoria: 'spokoj' as const, domyslnaWaga: 3 as const }]
    assert.equal(ustawieniaPersony('od-zera', 'kupuje', nowa).wagi.nowa_warstwa, 0)
    assert.equal(ustawieniaPersony('rodzina', 'wynajmuje', nowa).wagi.nowa_warstwa, 3)
  })

  it('tryb nie zmienia automatycznie wagi społeczności', () => {
    const k = ustawieniaPersony('inwestor', 'kupuje', manifest).wagi.inwestycje_500m ?? 0
    const w = ustawieniaPersony('inwestor', 'wynajmuje', manifest).wagi.inwestycje_500m ?? 0
    assert.equal(k, w)
  })

  it('persona podaje kierunek warstwy neutralnej', () => {
    assert.equal(
      ustawieniaPersony('inwestor', 'kupuje', manifest).kierunki.inwestycje_500m,
      'wiecej-lepiej',
    )
  })

  it('tryb sklepu liczy tylko konkurencję i ludność, niezależnie od persony mieszkaniowej', () => {
    for (const p of PERSONY) {
      const { wagi, kierunki } = ustawieniaPersony(p.id, 'biznes', manifest)
      assert.equal(wagi.sklep_odleglosc, 4)
      assert.equal(wagi.ludnosc_1km, 4)
      assert.equal(kierunki.sklep_odleglosc, 'wiecej-lepiej')
      assert.equal(kierunki.ludnosc_1km, 'wiecej-lepiej')
      assert.equal(wagi.halas_ldwn, 0)
      assert.equal(wagi.nowa_warstwa, 0)
    }
    assert.equal(ustawieniaPersony('rodzina', 'kupuje', manifest).wagi.ludnosc_1km, 0)
  })

  it('atrapa sklepu nie dostaje domyślnej wagi biznesowej', () => {
    const warstwy = manifest.map((w) => ({ ...w, atrapa: w.id === 'sklep_odleglosc' }))
    const { wagi } = ustawieniaPersony('rodzina', 'biznes', warstwy)
    assert.equal(wagi.sklep_odleglosc, 0)
    assert.equal(wagi.ludnosc_1km, 4)
  })

  it('każdy rodzaj działalności ma własną miarę konkurencji i wspólną ludność', () => {
    const warstwy = BIZNESY.map((b) => ({ id: b.konkurencja, kategoria: 'codziennosc' as const }))
    const lista = [...warstwy, { id: 'ludnosc_1km', kategoria: 'spolecznosc' as const }]
    for (const biznes of BIZNESY) {
      const { wagi, kierunki } = ustawieniaPersony('rodzina', 'biznes', lista, biznes.id)
      assert.equal(wagi[biznes.konkurencja], 4)
      assert.equal(wagi.ludnosc_1km, 4)
      assert.equal(kierunki[biznes.konkurencja], 'wiecej-lepiej')
      for (const inny of BIZNESY.filter((b) => b.id !== biznes.id))
        assert.equal(wagi[inny.konkurencja], 0)
    }
  })

  it('rodzaj biznesu przechodzi przez link', () => {
    const url = czytajHash('#/?t=biznes&biz=gastronomia')
    assert.equal(url.biznes, 'gastronomia')
    assert.match(zapiszHash(url), /biz=gastronomia/)
  })
})

// Strażnik martwych wag (metoda: docs/metoda-wag.md). Waga na warstwie neutralnej bez kierunku
// albo na warstwie kontekstu nie zmienia wyniku – profil „Z psem” ważył tak wybieg, weterynarza
// i ogródki działkowe, a „Student” akademik i bary. Tu każda taka waga daje czerwony test.
describe('persony: każda waga działa w silniku', () => {
  const META = new Map<string, WskaznikMeta>(
    readdirSync('public/dane/wskazniki')
      .filter((plik) => plik.endsWith('.json'))
      .map((plik) => {
        const m = JSON.parse(readFileSync(`public/dane/wskazniki/${plik}`, 'utf8'))
          .meta as WskaznikMeta
        return [m.id, m] as const
      }),
  )
  const mieszkaniowe = PERSONY.filter((p) => p.id !== 'od-zera')

  it('każda waga to liczba całkowita 1–4 na warstwie z public/dane/wskazniki', () => {
    for (const p of PERSONY)
      for (const [id, w] of Object.entries(p.wagi)) {
        assert.ok(META.has(id), `${p.id}: nieznana warstwa ${id}`)
        assert.ok(Number.isInteger(w) && w >= 1 && w <= 4, `${p.id}: ${id} = ${w}`)
      }
  })

  it('każda dodatnia waga trafia na warstwę, którą silnik liczy z kierunkiem persony', () => {
    for (const p of PERSONY)
      for (const [id, w] of Object.entries(p.wagi)) {
        const meta = META.get(id)
        if (!meta || w <= 0) continue
        assert.ok(!meta.atrapa, `${p.id}: ${id} to atrapa`)
        assert.notEqual(
          kierunekEfektywny(meta, p.kierunki),
          null,
          `${p.id}: ${id} (${meta.kategoria}, ${meta.kierunek}) nie wchodzi do wyniku – martwa waga`,
        )
      }
  })

  it('po złożeniu ustawień (oba tryby mieszkaniowe) żadna dodatnia waga nie jest martwa', () => {
    const katalog = [...META.values()]
    for (const p of PERSONY)
      for (const tryb of ['kupuje', 'wynajmuje'] as const) {
        const { wagi, kierunki } = ustawieniaPersony(p.id, tryb, katalog)
        for (const [id, w] of Object.entries(wagi)) {
          const meta = META.get(id)
          if (!meta || w <= 0) continue
          assert.notEqual(kierunekEfektywny(meta, kierunki), null, `${p.id}/${tryb}: ${id}`)
        }
      }
  })

  it('kierunek persony dotyczy warstwy, którą persona waży', () => {
    for (const p of PERSONY)
      for (const [id, k] of Object.entries(p.kierunki ?? {})) {
        assert.ok(META.has(id), `${p.id}: kierunek nieznanej warstwy ${id}`)
        assert.ok((p.wagi[id] ?? 0) > 0, `${p.id}: kierunek ${id} bez wagi`)
        assert.ok(k === 'mniej-lepiej' || k === 'wiecej-lepiej', `${p.id}: ${id} = ${k}`)
      }
  })

  it('każdy profil mieszkaniowy waży hałas i PM2,5 (minimum WHO)', () => {
    for (const p of mieszkaniowe) {
      assert.ok((p.wagi.halas_ldwn ?? 0) >= 1, `${p.id}: hałas`)
      assert.ok((p.wagi.pm25_srednia ?? 0) >= 1, `${p.id}: PM2,5`)
    }
  })

  it('profile różnią się zestawem wag – żadne dwa nie są identyczne', () => {
    const podpisy = mieszkaniowe.map((p) =>
      JSON.stringify(Object.entries(p.wagi).sort(([a], [b]) => a.localeCompare(b))),
    )
    assert.equal(new Set(podpisy).size, podpisy.length)
  })
})

describe('hash URL', () => {
  it('zapisuje i odczytuje tryb biznesowy', () => {
    const url = czytajHash('#/?t=biznes')
    assert.equal(url.tryb, 'biznes')
    assert.match(zapiszHash(url), /t=biznes/)
  })
  it('zapis i odczyt są odwracalne', () => {
    const s = {
      ekran: 'okolica' as const,
      idAdresu: 'PL.1/2 a',
      persona: 'senior' as const,
      tryb: 'wynajmuje' as const,
      porownanie: ['a', 'b'],
      ustawienia: null,
      filtry: [],
    }
    assert.deepEqual(czytajHash(zapiszHash(s)), s)
  })

  it('pusty i nieznany hash to Szukaj', () => {
    assert.equal(czytajHash('').ekran, 'szukaj')
    assert.equal(czytajHash('#/cos').ekran, 'szukaj')
    assert.equal(czytajHash('#/adres/').ekran, 'szukaj')
    assert.equal(czytajHash('#/?p=hacker').persona, null)
  })

  it('uszkodzony hash to Szukaj, nie wyjątek', () => {
    for (const h of ['#/adres/%', '#/adres/%E0%A4%A', '#/adres/%zz?p=senior']) {
      const s = czytajHash(h)
      assert.equal(s.ekran, 'szukaj', h)
      assert.equal(s.idAdresu, null, h)
    }
    assert.equal(czytajHash('#/adres/%zz?p=senior').persona, 'senior')
  })

  it('porównanie najwyżej 5', () => {
    assert.equal(czytajHash('#/porownanie?cmp=1,2,3,4,5,6,7').porownanie.length, 5)
  })

  it('zapisuje własne wagi i kierunki do linku', () => {
    const s = {
      ekran: 'porownanie' as const,
      idAdresu: null,
      persona: null,
      tryb: 'kupuje' as const,
      porownanie: ['a', 'b'],
      ustawienia: {
        wagi: { halas_ldwn: 4, zielen_udzial: 0 },
        kierunki: { halas_ldwn: 'mniej-lepiej' as const },
      },
      filtry: [{ id: 'halas_ldwn', warunek: 'max' as const, prog: 55 }],
    }
    assert.deepEqual(czytajHash(zapiszHash(s)), s)
  })

  it('odrzuca niepoprawne własne ustawienia', () => {
    for (const u of [
      '{',
      JSON.stringify({ v: 2, w: {}, k: {} }),
      JSON.stringify({ v: 1, w: { halas_ldwn: 9 }, k: {} }),
      JSON.stringify({ v: 1, w: {}, k: { halas_ldwn: 'nieznany' } }),
    ]) {
      assert.equal(czytajHash(`#/porownanie?u=${encodeURIComponent(u)}`).ustawienia, null)
    }
  })
})
