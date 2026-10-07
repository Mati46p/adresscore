// Service worker trybu offline demo (#100). Po jednym otwarciu online aplikacja, dane, glify
// i kafle PMTiles działają po odcięciu sieci. Rejestracja: src/main.tsx (tylko build produkcyjny).
//
// Strategie:
// - nawigacja, /mapa/fonts/, fonty Google: najpierw sieć, przy braku sieci kopia z cache,
//   więc online zawsze widać świeży deploy;
// - /dane/: kopia z cache od razu, świeża wersja pobiera się w tle na następne otwarcie.
//   Pliki danych ważą kilka MB (adresy.json ~5 MB po kompresji), a sieć-najpierw kazała je
//   pobierać przy każdym wejściu. Wyjątek: indeks kompaktu i manifest (Krakowa i każdego miasta,
//   #223) idą siecią (a offline z kopii). Indeks wskazuje pliki z hashem, które po deployu znikają,
//   a przegląd porównuje go z manifestem (niezgodnoscKompaktu): świeży indeks przy manifeście
//   z cache dawał miastu `brak` do końca sesji. Niezgodność wersji reszty kopii z manifestem jest
//   bezpieczna: warstwa z inną wersją adresów wypada jako niedostępna (wynik/dane.ts), nie psuje
//   wyniku;
// - /assets/ (pliki z hashem w nazwie): najpierw cache, bo treść pod daną nazwą się nie zmienia;
// - *.pmtiles: Cache API nie przechowuje odpowiedzi 206, więc przy pierwszym żądaniu Range
//   pobieramy całe archiwum w tle i potem kroimy zakresy z kopii, także offline;
// - /api/ i inne domeny: bez ingerencji.

// v3 (#223): przy aktywacji wypadają kopie z wcześniejszych wersji, w tym indeksy kompaktów
// i manifesty zapisane, zanim worker zaczął pobierać je zawsze z sieci.
// Test: src/kontrakty/miasta.test.ts.
const CACHE = 'adresscore-v3'
const SKORUPA = ['/', '/index.html']
// Pliki, które muszą pochodzić z jednego wdrożenia: indeks kompaktu (kompakt/indeks.json) i manifest
// (manifest.json) Krakowa w /dane/ oraz miast w /dane/miasta/<slug>/. Slug to małe litery – pilnuje
// tego test rejestru miast.
const ZAWSZE_Z_SIECI = /^\/dane\/(miasta\/[a-z]+\/)?(kompakt\/indeks|manifest)\.json$/

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(SKORUPA))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((klucze) => Promise.all(klucze.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (e) => {
  const zad = e.request
  if (zad.method !== 'GET') return
  const url = new URL(zad.url)
  const swoj = url.origin === self.location.origin

  if (swoj && url.pathname.startsWith('/api/')) return
  if (swoj && url.pathname.endsWith('.pmtiles')) {
    e.respondWith(archiwum(e, url))
    return
  }
  if (zad.mode === 'navigate') {
    e.respondWith(siecPotemCache(zad, '/index.html'))
    return
  }
  if (
    swoj &&
    url.pathname.startsWith('/dane/') &&
    !ZAWSZE_Z_SIECI.test(url.pathname) &&
    !zad.headers.has('range')
  ) {
    e.respondWith(cacheIOdswiez(e, zad))
    return
  }
  if (swoj && url.pathname.startsWith('/assets/')) {
    e.respondWith(cachePotemSiec(zad))
    return
  }
  if (
    (swoj && !zad.headers.has('range')) ||
    url.hostname === 'fonts.googleapis.com' ||
    url.hostname === 'fonts.gstatic.com'
  ) {
    e.respondWith(siecPotemCache(zad))
  }
})

async function siecPotemCache(zad, zapasowy) {
  const cache = await caches.open(CACHE)
  try {
    const odp = await fetch(zad)
    if (odp.ok || odp.type === 'opaque') await cache.put(zad, odp.clone())
    return odp
  } catch (blad) {
    const kopia = (await cache.match(zad)) ?? (zapasowy && (await cache.match(zapasowy)))
    if (kopia) return kopia
    throw blad
  }
}

async function cachePotemSiec(zad) {
  const cache = await caches.open(CACHE)
  const kopia = await cache.match(zad)
  if (kopia) return kopia
  const odp = await fetch(zad)
  if (odp.ok) await cache.put(zad, odp.clone())
  return odp
}

// Odświeżanie w tle pyta serwer o ETag kopii: niezmieniony plik to 304 bez treści. Bez tego
// każde wejście pobierało i zapisywało od nowa ~25 MB danych, a zajęty tym worker opóźniał
// następne otwarcie strony o kilka sekund (pomiar 2026-10-04).
const odswiezane = new Set()

async function cacheIOdswiez(e, zad) {
  const cache = await caches.open(CACHE)
  const kopia = await cache.match(zad)
  if (!kopia) {
    const odp = await fetch(zad)
    if (odp.ok) await cache.put(zad, odp.clone())
    return odp
  }
  const etag = kopia.headers.get('etag')
  if (!odswiezane.has(zad.url)) {
    odswiezane.add(zad.url)
    const naglowki = etag ? { 'If-None-Match': etag } : {}
    e.waitUntil(
      fetch(zad.url, { headers: naglowki, cache: 'no-store' })
        .then((odp) => (odp.status === 200 ? cache.put(zad, odp) : undefined))
        .catch(() => {})
        .finally(() => odswiezane.delete(zad.url)),
    )
  }
  return kopia
}

const pobieraneArchiwa = new Map()
// Blob kroi się leniwie, bez kopiowania całych dziesiątek MB przy każdym kaflu.
const blobyArchiwow = new Map()

function pobierzArchiwum(klucz) {
  if (!pobieraneArchiwa.has(klucz)) {
    const zadanie = (async () => {
      const odp = await fetch(klucz, { cache: 'no-store' })
      if (!odp.ok) throw new Error(`PMTiles ${klucz}: HTTP ${odp.status}`)
      await (await caches.open(CACHE)).put(klucz, odp)
    })()
      .catch((b) => console.warn('Offline bez kopii archiwum:', b))
      .finally(() => pobieraneArchiwa.delete(klucz))
    pobieraneArchiwa.set(klucz, zadanie)
  }
  return pobieraneArchiwa.get(klucz)
}

async function archiwum(e, url) {
  const klucz = `${url.origin}${url.pathname}`
  const cache = await caches.open(CACHE)
  let blob = blobyArchiwow.get(klucz)
  if (!blob) {
    const kopia = await cache.match(klucz)
    if (kopia) {
      blob = await kopia.blob()
      blobyArchiwow.set(klucz, blob)
    }
  }
  if (blob) return wytnij(blob, e.request.headers.get('range'))
  // Pierwsze otwarcie: zakresy z sieci, całe archiwum dociąga się w tle na potrzeby offline.
  e.waitUntil(pobierzArchiwum(klucz))
  return fetch(e.request)
}

function wytnij(bajty, naglowek) {
  const rozmiar = bajty.size
  const typ = 'application/octet-stream'
  const m = naglowek && /^bytes=(\d*)-(\d*)$/.exec(naglowek.trim())
  if (!m) {
    return new Response(bajty, {
      status: 200,
      headers: { 'Content-Type': typ, 'Content-Length': String(rozmiar) },
    })
  }
  let od
  let doBajtu
  if (m[1] === '') {
    // bytes=-N: ostatnie N bajtów.
    od = Math.max(0, rozmiar - Number(m[2]))
    doBajtu = rozmiar - 1
  } else {
    od = Number(m[1])
    doBajtu = m[2] === '' ? rozmiar - 1 : Math.min(Number(m[2]), rozmiar - 1)
  }
  if (od >= rozmiar || od > doBajtu) {
    return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${rozmiar}` } })
  }
  return new Response(bajty.slice(od, doBajtu + 1), {
    status: 206,
    headers: {
      'Content-Type': typ,
      'Content-Length': String(doBajtu - od + 1),
      'Content-Range': `bytes ${od}-${doBajtu}/${rozmiar}`,
      'Accept-Ranges': 'bytes',
    },
  })
}
