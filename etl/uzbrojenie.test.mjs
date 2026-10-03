import assert from 'node:assert/strict'
import test from 'node:test'
import { deflateSync } from 'node:zlib'
import {
  BOK_PX,
  bokPx,
  flagiKafla,
  jestWPromieniu,
  KAFEL_M,
  kafleAdresow,
  liczbaPikseli,
  MAKS_PRZEBIEGOW_KIUT,
  MIN_KRYCIE,
  MSIP_GESUT,
  maskaPng,
  PROFIL_KIUT,
  PROFIL_MSIP,
  PRZEBIEGI_KIUT,
  pikselWKaflu,
  plikKafla,
  podzielAdresy,
  polaczPrzebiegi,
  SIECI,
  sprawdzMaske,
  sprawdzRozmiar,
  urlGetMap,
  urlGetMapMsip,
  ZAPAS_M,
  ZASIEG_DANYCH_M,
  zIndeksem,
  zrodlaWskaznika,
} from './uzbrojenie.mjs'

function fragment(typ, dane) {
  const b = Buffer.alloc(12 + dane.length)
  b.writeUInt32BE(dane.length, 0)
  b.write(typ, 4, 'latin1')
  dane.copy(b, 8)
  return b // CRC pomijamy – dekoder go nie sprawdza
}

/** Filtr PNG „w przód”: surowy wiersz → przefiltrowany (typ 0–4); bpp = bajtów na piksel (≥ 1). */
function filtruj(typ, wiersz, poprz, bpp) {
  const wynik = Buffer.alloc(wiersz.length)
  for (let x = 0; x < wiersz.length; x++) {
    const a = x >= bpp ? wiersz[x - bpp] : 0
    const g = poprz[x]
    const c = x >= bpp ? poprz[x - bpp] : 0
    let p = 0
    if (typ === 1) p = a
    else if (typ === 2) p = g
    else if (typ === 3) p = (a + g) >> 1
    else if (typ === 4) {
      const pa = Math.abs(g - c)
      const pb = Math.abs(a - c)
      const pc = Math.abs(a + g - 2 * c)
      p = pa <= pb && pa <= pc ? a : pb <= pc ? g : c
    }
    wynik[x] = (wiersz[x] - p) & 255
  }
  return wynik
}

/** Składa PNG z surowych wierszy (Buffer[]); filtry(y) wybiera typ filtru wiersza. */
function zlozPng({ szer, glebia, typ, wiersze, paleta, trns, filtry }) {
  const wys = wiersze.length
  const bpp = Math.max(1, ((typ === 6 ? 4 : 1) * glebia) >> 3)
  const linia = wiersze[0].length
  const surowe = Buffer.alloc((linia + 1) * wys)
  let poprz = Buffer.alloc(linia)
  wiersze.forEach((w, y) => {
    const f = filtry(y)
    surowe[y * (linia + 1)] = f
    filtruj(f, w, poprz, bpp).copy(surowe, y * (linia + 1) + 1)
    poprz = w
  })
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(szer, 0)
  ihdr.writeUInt32BE(wys, 4)
  ihdr[8] = glebia
  ihdr[9] = typ
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    fragment('IHDR', ihdr),
    ...(paleta ? [fragment('PLTE', Buffer.alloc(paleta * 3))] : []),
    ...(trns ? [fragment('tRNS', Buffer.from(trns))] : []),
    fragment('IDAT', deflateSync(surowe)),
    fragment('IEND', Buffer.alloc(0)),
  ])
}

/** PNG z paletą o zadanej głębi; indeksy: tablica wierszy; filtr: typ 0–4 (albo funkcja wiersza). */
function png(indeksy, glebia, paleta, trns, filtr = 0) {
  const szer = indeksy[0].length
  const linia = Math.ceil((szer * glebia) / 8)
  const wiersze = indeksy.map((wiersz) => {
    const bajty = Buffer.alloc(linia)
    for (let x = 0; x < szer; x++) {
      const bit = x * glebia
      bajty[bit >> 3] |= wiersz[x] << (8 - glebia - (bit & 7))
    }
    return bajty
  })
  return zlozPng({
    szer,
    glebia,
    typ: 3,
    wiersze,
    paleta,
    trns,
    filtry: typeof filtr === 'function' ? filtr : () => filtr,
  })
}

/** PNG RGBA 8 bit; piksele: tablica wierszy, piksel = [r, g, b, a]. */
function pngRgba(piksele, filtr = 0) {
  const wiersze = piksele.map((wiersz) => Buffer.from(wiersz.flat()))
  return zlozPng({
    szer: piksele[0].length,
    glebia: 8,
    typ: 6,
    wiersze,
    filtry: typeof filtr === 'function' ? filtr : () => filtr,
  })
}

/** Deterministyczny generator liczb (LCG), żeby testy nie zależały od Math.random. */
function generator(ziarno) {
  let s = ziarno
  return () => {
    s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff
    return s >> 8
  }
}

test('maskaPng: pusty kafel KIUT (1 bit, jeden przezroczysty wpis) → pusta maska', () => {
  const m = maskaPng(
    png(
      [
        [0, 0, 0],
        [0, 0, 0],
      ],
      1,
      1,
      [0],
    ),
  )
  assert.equal(m.szer, 3)
  assert.equal(m.wys, 2)
  assert.deepEqual([...m.maska], [0, 0, 0, 0, 0, 0])
})

test('maskaPng: 8 bit z filtrem Sub, krycie z tRNS, wygładzanie odrzucone', () => {
  // 0 – tło, 1 – krawędź wygładzona (krycie 3), 2 – linia (255), 3 – brak w tRNS (kryjący)
  const m = maskaPng(png([[0, 1, 2, 3]], 8, 4, [0, 3, 255], 1))
  assert.deepEqual([...m.maska], [0, 0, 1, 1])
})

test('maskaPng: paleta 8 i 4 bity, każdy z pięciu filtrów PNG w innym wierszu', () => {
  const los = generator(7)
  for (const glebia of [8, 4]) {
    const kolorow = glebia === 8 ? 40 : 16
    const trns = Array.from({ length: kolorow - 1 }, () => los() % 256) // ostatni wpis bez tRNS
    const indeksy = Array.from({ length: 10 }, () =>
      Array.from({ length: 13 }, () => los() % kolorow),
    )
    const m = maskaPng(png(indeksy, glebia, kolorow, trns, (y) => y % 5))
    const oczekiwana = indeksy.flat().map((i) => ((trns[i] ?? 255) >= MIN_KRYCIE ? 1 : 0))
    assert.deepEqual([...m.maska], oczekiwana, `głębia ${glebia}`)
  }
})

test('maskaPng: RGBA 8 bit – krycie z kanału alfa, każdy z pięciu filtrów PNG w innym wierszu', () => {
  // KIUT zwraca RGBA, gdy obraz ma za dużo kolorów na paletę; wcześniej taki kafel był pomijany.
  const los = generator(42)
  const piksele = Array.from({ length: 12 }, () =>
    Array.from({ length: 9 }, () => [los() % 256, los() % 256, los() % 256, los() % 256]),
  )
  const m = maskaPng(pngRgba(piksele, (y) => y % 5))
  assert.equal(m.szer, 9)
  assert.equal(m.wys, 12)
  assert.deepEqual(
    [...m.maska],
    piksele.flat().map(([, , , a]) => (a >= MIN_KRYCIE ? 1 : 0)),
  )
  // te same dane przy jednym filtrze Paeth w każdym wierszu
  assert.deepEqual([...maskaPng(pngRgba(piksele, 4)).maska], [...m.maska])
})

test('maskaPng: RGBA – tło i ledwo widoczna smuga nie są siecią, cienka linia o kryciu poniżej 64 jest', () => {
  assert.equal(MIN_KRYCIE, 16)
  const m = maskaPng(
    pngRgba([
      [
        [255, 255, 255, 0], // tło
        [200, 200, 0, 15], // smuga wygładzania tuż pod progiem
        [200, 200, 0, 16], // dokładnie na progu
        [200, 200, 0, 58], // cienka linia między pikselami: 0,9 px × krycie symbolu 130
        [200, 200, 0, 130], // linia
      ],
    ]),
  )
  assert.deepEqual([...m.maska], [0, 0, 1, 1, 1])
})

test('maskaPng: odrzuca PNG, którego nie umie czytać', () => {
  const rgb = png([[0]], 8, 1, null)
  rgb[8 + 8 + 9] = 2 // typ koloru w IHDR → RGB bez alfa
  assert.throws(() => maskaPng(rgb), /Nieobsługiwany/)
  const rgba16 = pngRgba([[[0, 0, 0, 0]]])
  rgba16[8 + 8 + 8] = 16 // głębia w IHDR → RGBA 16 bit
  assert.throws(() => maskaPng(rgba16), /Nieobsługiwany/)
  const przeplot = png([[0]], 8, 1, null)
  przeplot[8 + 8 + 12] = 1 // przeplot Adam7
  assert.throws(() => maskaPng(przeplot), /Nieobsługiwany/)
  assert.throws(() => maskaPng(Buffer.from('<html>302</html>')), /To nie PNG/)
})

test('sprawdzMaske: obraz, w którym „sieć” jest większością, to nie mapa przewodów', () => {
  const sieci = (zajete, wszystkie) => {
    const maska = new Uint8Array(wszystkie)
    maska.fill(1, 0, zajete)
    return { szer: wszystkie, wys: 1, maska }
  }
  assert.doesNotThrow(() => sprawdzMaske(sieci(10, 100)))
  assert.doesNotThrow(() => sprawdzMaske(sieci(50, 100)))
  assert.throws(() => sprawdzMaske(sieci(51, 100)), /podejrzany/)
})

test('polaczPrzebiegi: suma masek naprawia przebieg, w którym KIUT oddał pusty obraz', () => {
  const maska = (piksele, bok = 8) => {
    const m = new Uint8Array(bok * bok)
    for (const i of piksele) m[i] = 1
    return { szer: bok, wys: bok, maska: m }
  }
  // przebieg 1: kafel pusty (usługa powiatu zawiodła), przebieg 2: pełna sieć
  const pelna = Array.from({ length: 40 }, (_, i) => i)
  const wynik = polaczPrzebiegi([maska([]), maska(pelna)])
  assert.deepEqual([...wynik.maska.maska], [...maska(pelna).maska])
  assert.equal(wynik.piksele, 40)
  assert.equal(wynik.rozbiezne, false, 'różnica poniżej 200 pikseli to rozrzut, nie awaria')
  // przy większym obrazie ta sama sytuacja jest już awarią
  const duza = (n) =>
    maska(
      Array.from({ length: n }, (_, i) => i),
      100,
    )
  assert.equal(polaczPrzebiegi([duza(0), duza(3000)]).rozbiezne, true)
  assert.equal(polaczPrzebiegi([duza(3000), duza(0)]).rozbiezne, true)
  assert.equal(polaczPrzebiegi([duza(1400), duza(3000)]).rozbiezne, true)
  // dobry przebieg ma co najmniej 90% pikseli najlepszego: 2600 z 3000 to już przebieg częściowy
  assert.equal(polaczPrzebiegi([duza(2600), duza(3000)]).rozbiezne, true)
  // rozrzut renderu (kilka procent pikseli) i dwa puste przebiegi nie są awarią
  assert.equal(polaczPrzebiegi([duza(2900), duza(3000)]).rozbiezne, false)
  assert.equal(polaczPrzebiegi([duza(2700), duza(3000)]).rozbiezne, false)
  assert.equal(polaczPrzebiegi([duza(0), duza(0)]).rozbiezne, false)
  assert.equal(polaczPrzebiegi([duza(0), duza(0)]).piksele, 0)
  // „dobre” liczy przebiegi, które potwierdzają najlepszy: wynik pewny dopiero przy co najmniej dwóch
  assert.equal(polaczPrzebiegi([duza(0), duza(3000)]).dobre, 1)
  assert.equal(polaczPrzebiegi([duza(0), duza(3000), duza(3000)]).dobre, 2)
  assert.equal(polaczPrzebiegi([duza(2950), duza(3000)]).dobre, 2)
  assert.equal(polaczPrzebiegi([duza(0), duza(0)]).dobre, 2)
  assert.equal(polaczPrzebiegi([duza(1200), duza(1500), duza(3000)]).dobre, 1)
  // suma to OR, nie wybór lepszego: obie części sieci zostają
  const lewa = maska([0, 1, 2, 3])
  const prawa = maska([60, 61])
  assert.equal(polaczPrzebiegi([lewa, prawa]).piksele, 6)
  assert.throws(() => polaczPrzebiegi([]), /Brak masek/)
  assert.throws(() => polaczPrzebiegi([maska([], 4), maska([], 8)]), /różny rozmiar/)
})

test('liczbaPikseli i plikKafla: przebieg 1 zachowuje nazwę z cache sprzed przebiegów', () => {
  assert.equal(liczbaPikseli({ maska: Uint8Array.from([1, 0, 1, 1, 0]) }), 3)
  const nazwa = (p) => plikKafla(PROFIL_KIUT, { klucz: 'gaz' }, '281_122', p).split(/[\\/]/).at(-1)
  assert.equal(nazwa(), 'gaz_281_122.png')
  assert.equal(nazwa(1), 'gaz_281_122.png')
  assert.equal(nazwa(2), 'gaz_281_122.p2.png')
  assert.equal(nazwa(3), 'gaz_281_122.p3.png')
  assert.equal(nazwa(MAKS_PRZEBIEGOW_KIUT), 'gaz_281_122.p5.png')
  // cache KIUT i MSIP w osobnych katalogach, z geometrią w nazwie
  assert.match(plikKafla(PROFIL_KIUT, { klucz: 'gaz' }, '1_2'), /kiut_2000_250_2000/)
  assert.match(plikKafla(PROFIL_MSIP, { klucz: 'gaz' }, '1_2'), /msip_2000_250_625/)
  assert.ok(PRZEBIEGI_KIUT >= 2, 'jeden przebieg nie wychwyci pustego obrazu')
  assert.ok(MAKS_PRZEBIEGOW_KIUT > PRZEBIEGI_KIUT, 'musi zostać miejsce na dokładki')
})

test('sprawdzRozmiar: obraz inny niż zapytany przesunąłby współrzędne, więc jest odrzucany', () => {
  const obraz = (bok) => ({ szer: bok, wys: bok, maska: new Uint8Array(0) })
  assert.doesNotThrow(() => sprawdzRozmiar(obraz(1250), PROFIL_KIUT))
  assert.doesNotThrow(() => sprawdzRozmiar(obraz(4000), PROFIL_MSIP))
  assert.throws(() => sprawdzRozmiar(obraz(4096), PROFIL_MSIP), /4096×4096 px zamiast 4000×4000/)
  assert.throws(() => sprawdzRozmiar({ szer: 4000, wys: 3999 }, PROFIL_MSIP), /zamiast/)
  // obraz kafla KIUT w cache MSIP (i odwrotnie) to nie ten sam kafel
  assert.throws(() => sprawdzRozmiar(obraz(1250), PROFIL_MSIP), /zamiast/)
})

test('jestWPromieniu: koło, nie kwadrat', () => {
  const szer = 11
  const maska = new Uint8Array(szer * szer)
  maska[0] = 1 // róg (0,0), środek (5,5): odległość ≈ 7,07 px
  const m = { szer, wys: szer, maska }
  assert.equal(jestWPromieniu(m, 5, 5, 7), false)
  assert.equal(jestWPromieniu(m, 5, 5, 8), true)
})

test('jestWPromieniu: sumy wierszy dają ten sam wynik co pętla po pikselach i definicja koła', () => {
  const los = generator(2026)
  const szer = 37
  const wys = 29
  const maska = new Uint8Array(szer * wys)
  for (let i = 0; i < maska.length; i++) maska[i] = los() % 40 === 0 ? 1 : 0
  const prosta = { szer, wys, maska }
  const sumy = zIndeksem(prosta)
  const wprost = (px, py, r) => {
    for (let y = 0; y < wys; y++)
      for (let x = 0; x < szer; x++)
        if (maska[y * szer + x] && (x - px) ** 2 + (y - py) ** 2 <= r * r) return true
    return false
  }
  let trafien = 0
  for (let i = 0; i < 600; i++) {
    // punkty także poza obrazem: koło przy krawędzi jest obcinane
    const px = (los() % (szer + 12)) - 6
    const py = (los() % (wys + 12)) - 6
    const r = 1 + (los() % 14)
    const oczekiwane = wprost(px, py, r)
    if (oczekiwane) trafien++
    assert.equal(jestWPromieniu(prosta, px, py, r), oczekiwane, `pętla (${px}, ${py}, ${r})`)
    assert.equal(jestWPromieniu(sumy, px, py, r), oczekiwane, `sumy (${px}, ${py}, ${r})`)
  }
  assert.ok(trafien > 50 && trafien < 550, `test musi sprawdzać oba wyniki, trafień: ${trafien}`)
})

test('zIndeksem: suma wiersza do x to liczba pikseli maski na lewo od x', () => {
  const m = zIndeksem({ szer: 4, wys: 2, maska: Uint8Array.from([1, 0, 1, 1, 0, 0, 0, 1]) })
  assert.deepEqual([...m.pref], [0, 1, 1, 2, 3, 0, 0, 0, 0, 1])
})

test('kafel KIUT: zapas 250 m = zasięg danych, oś północ-wschód w BBOX, piksel liczony od północy', () => {
  assert.equal(ZAPAS_M, ZASIEG_DANYCH_M)
  assert.equal(BOK_PX, 1250)
  const u = new URL(urlGetMap('przewod_gazowy', 283, 124))
  const [ymin, xmin, ymax, xmax] = u.searchParams.get('BBOX').split(',').map(Number)
  assert.deepEqual([xmin, ymin], [283 * KAFEL_M - ZAPAS_M, 124 * KAFEL_M - ZAPAS_M])
  assert.equal(xmax - xmin, KAFEL_M + 2 * ZAPAS_M)
  assert.equal(ymax - ymin, KAFEL_M + 2 * ZAPAS_M)
  assert.equal(u.searchParams.get('WIDTH'), String(BOK_PX))
  assert.deepEqual(pikselWKaflu(283 * KAFEL_M, 125 * KAFEL_M, 283, 124), [125, 125])
})

test('kafel MSIP: obraz 4000 px mieści się w limicie usługi, piksel poniżej progu rysowania GESUT', () => {
  assert.equal(bokPx(PROFIL_MSIP), 4000)
  assert.ok(bokPx(PROFIL_MSIP) <= 4096, 'MaxWidth/MaxHeight usługi WMS to 4096')
  // MaxScaleDenominator warstw GESUT = 2362; skala WMS = rozdzielczość / 0,28 mm
  assert.ok(PROFIL_MSIP.piksel / 0.00028 < 2362)
  for (const p of [PROFIL_KIUT, PROFIL_MSIP]) {
    assert.ok(
      Number.isInteger((p.kafel + 2 * p.zapas) / p.piksel),
      `${p.nazwa}: całkowita liczba pikseli`,
    )
    assert.ok(p.zapas >= ZASIEG_DANYCH_M, `${p.nazwa}: zapas nie mniejszy niż zasięg danych`)
    assert.ok(Number.isInteger(ZASIEG_DANYCH_M / p.piksel), `${p.nazwa}: koło danych w pikselach`)
  }
})

test('urlGetMapMsip: WMS 1.1.1 z BBOX x,y, PNG8 z przezroczystym tłem, tylko host MSIP', () => {
  const u = new URL(urlGetMapMsip('siec_gazowa', 281, 122))
  assert.equal(`${u.origin}${u.pathname}`, MSIP_GESUT)
  assert.equal(u.hostname, 'msip.um.krakow.pl')
  const p = u.searchParams
  assert.equal(p.get('VERSION'), '1.1.1')
  assert.equal(p.get('REQUEST'), 'GetMap')
  assert.equal(p.get('SRS'), 'EPSG:2180')
  assert.equal(p.get('LAYERS'), 'siec_gazowa')
  assert.equal(p.get('FORMAT'), 'image/png8')
  assert.equal(p.get('TRANSPARENT'), 'TRUE')
  assert.equal(p.get('WIDTH'), '4000')
  assert.equal(p.get('HEIGHT'), '4000')
  // x = wschód, y = północ, w tej kolejności (w WMS 1.3.0 oś EPSG:2180 byłaby odwrócona)
  assert.deepEqual(p.get('BBOX').split(',').map(Number), [
    281 * KAFEL_M - 250,
    122 * KAFEL_M - 250,
    282 * KAFEL_M + 250,
    123 * KAFEL_M + 250,
  ])
})

test('pikselWKaflu: lewy górny róg kafla MSIP leży 250 m od krawędzi obrazu', () => {
  assert.deepEqual(pikselWKaflu(281 * KAFEL_M, 123 * KAFEL_M, 281, 122, PROFIL_MSIP), [400, 400])
  // 100 m na wschód i 100 m na południe = 160 px dalej przy 0,625 m/px
  assert.deepEqual(
    pikselWKaflu(281 * KAFEL_M + 100, 123 * KAFEL_M - 100, 281, 122, PROFIL_MSIP),
    [560, 560],
  )
})

test('flagiKafla: 1 w 50 m, 0 dalej, null gdy kafel nie ma żadnej sieci', () => {
  const pusta = () => ({ szer: BOK_PX, wys: BOK_PX, maska: new Uint8Array(BOK_PX * BOK_PX) })
  const gaz = pusta()
  const woda = pusta()
  // przewód gazowy w pikselu (200, 200) kafla 0_0
  gaz.maska[200 * BOK_PX + 200] = 1
  const x0 = -ZAPAS_M + 200 * 2 + 1
  const y0 = KAFEL_M + ZAPAS_M - 200 * 2 - 1
  const punkty = [
    [x0 + 40, y0], // 40 m – w zasięgu
    [x0 + 70, y0], // 70 m – poza
  ]
  assert.deepEqual(flagiKafla({ gaz, woda }, punkty, 0, 0), { gaz: [1, 0], woda: [0, 0] })
  assert.deepEqual(flagiKafla({ gaz: pusta(), woda: pusta() }, punkty, 0, 0), {
    gaz: [null, null],
    woda: [null, null],
  })
})

test('flagiKafla: adres bez żadnej sieci w 250 m → null, nie 0', () => {
  const m = () => ({ szer: BOK_PX, wys: BOK_PX, maska: new Uint8Array(BOK_PX * BOK_PX) })
  const gaz = m()
  gaz.maska[10 * BOK_PX + 10] = 1 // róg kafla
  const daleko = [[KAFEL_M / 2, KAFEL_M / 2]] // ok. 1 km od jedynego piksela
  assert.deepEqual(flagiKafla({ gaz, woda: m() }, daleko, 0, 0), { gaz: [null], woda: [null] })
})

test('flagiKafla MSIP: piksel 0,625 m, a koło danych przy krawędzi kafla nie jest obcięte', () => {
  // maska mniejsza niż obraz kafla wystarcza: sprawdzamy tylko okolice lewego górnego rogu
  const bok = 1000
  const pusta = () => ({ szer: bok, wys: bok, maska: new Uint8Array(bok * bok) })
  const gaz = pusta()
  const woda = pusta()
  // adres w rogu rdzenia kafla 0_0: piksel (400, 400). Przewód 156 m na zachód, w zapasie poza
  // kaflem (piksel 150): dalej niż 50 m, bliżej niż 250 m
  gaz.maska[400 * bok + 150] = 1
  // drugi przewód 40 m na południe od adresu (64 px) – tylko woda
  woda.maska[464 * bok + 400] = 1
  const adres = [[0, KAFEL_M]]
  const flagi = (maski) => flagiKafla(maski, adres, 0, 0, PROFIL_MSIP)
  assert.deepEqual(flagi({ gaz: zIndeksem(gaz), woda: zIndeksem(woda) }), { gaz: [0], woda: [1] })
  // sam przewód gazowy w zapasie (bez wody w okolicy) też dowodzi, że ewidencja tu sięga: 0, nie null
  assert.deepEqual(flagi({ gaz: zIndeksem(gaz), woda: zIndeksem(pusta()) }), {
    gaz: [0],
    woda: [0],
  })
  // granica koła danych: dokładnie 250 m (400 px) jeszcze się liczy, 400 px i 1 wiersz dalej już nie
  const naGranicy = pusta()
  naGranicy.maska[400 * bok + 0] = 1
  assert.deepEqual(flagi({ gaz: zIndeksem(naGranicy) }), { gaz: [0] })
  const zaGranica = pusta()
  zaGranica.maska[401 * bok + 0] = 1
  assert.deepEqual(flagi({ gaz: zIndeksem(zaGranica) }), { gaz: [null] })
})

test('podzielAdresy: Kraków liczy MSIP, reszta KIUT, każdy adres dokładnie raz', () => {
  const adresy = [
    { i: 0, gmina: 'Zielonki' },
    { i: 1, gmina: 'Kraków' },
    { i: 2, gmina: 'Wieliczka' },
    { i: 3, gmina: 'Kraków' },
  ]
  const { krakow, obwarzanek } = podzielAdresy(adresy)
  assert.deepEqual(krakow, [1, 3])
  assert.deepEqual(obwarzanek, [0, 2])
  assert.deepEqual([...krakow, ...obwarzanek].sort(), [0, 1, 2, 3])
})

test('kafleAdresow: adresy z jednego kafla 2 × 2 km w jednej grupie', () => {
  const xy = [
    [100, 100],
    [1999, 1999],
    [2000, 100],
    [-1, 100],
  ]
  const kafle = kafleAdresow([0, 1, 2, 3], xy)
  assert.deepEqual(
    [...kafle.entries()],
    [
      ['0_0', [0, 1]],
      ['1_0', [2]],
      ['-1_0', [3]],
    ],
  )
})

test('zrodlaWskaznika: MSIP z regulaminem i atrybucją, KIUT z licencją, daty osobno', () => {
  for (const s of SIECI) {
    const [msip, kiut] = zrodlaWskaznika(s, '2026-10-04', '2026-10-03')
    assert.match(msip.nazwa, /Gmina Miejska Kraków, Portal MSIP Obserwatorium/)
    assert.match(msip.nazwa, new RegExp(s.warstwaMsip))
    assert.match(msip.licencja, /Regulamin MSIP/)
    assert.match(msip.licencja, /pkt 22/)
    assert.equal(msip.pobrano, '2026-10-04')
    assert.match(kiut.nazwa, new RegExp(s.warstwa))
    assert.equal(kiut.pobrano, '2026-10-03')
    // pola wymagane przez zapiszWskaznik
    for (const z of [msip, kiut])
      for (const k of ['nazwa', 'url', 'licencja', 'dataDanych', 'pobrano']) assert.ok(z[k], k)
  }
})
