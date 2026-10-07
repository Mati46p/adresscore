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
// - *.pmtiles: bez ingerencji. Mapa Polski ma ponad 2 GB, więc nie da się jej trzymać w Cache API;
//   przeglądarka sama cachuje zakresy bajtów (Cache-Control z serwera);
// - /api/ i inne domeny: bez ingerencji.

// v4: mapa Polski (2 GB) idzie siecią, wypadają kopie 40 MB archiwum Krakowa.
// v3 (#223): przy aktywacji wypadają kopie z wcześniejszych wersji, w tym indeksy kompaktów
// i manifesty zapisane, zanim worker zaczął pobierać je zawsze z sieci.
// Test: src/kontrakty/miasta.test.ts.
const CACHE = 'adresscore-v4'
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
  if (swoj && url.pathname.endsWith('.pmtiles')) return
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
