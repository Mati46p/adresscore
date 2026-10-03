const input = document.querySelector('#szukaj')
const gmina = document.querySelector('#gmina')
const stan = document.querySelector('#stan')
const wyniki = document.querySelector('#wyniki')
const strony = document.querySelector('#strony')
const poprzednia = document.querySelector('#poprzednia')
const nastepna = document.querySelector('#nastepna')
const strona = document.querySelector('#strona')
const rozmiarStrony = 40
let adresy = []
let trafienia = []
let numerStrony = 0
let timer

async function wczytajAdresy() {
  const wersjaOdp = await fetch('/katalog/wersja.json', { cache: 'no-cache' })
  if (!wersjaOdp.ok) throw new Error('Wersja adresów: HTTP ' + wersjaOdp.status)
  const { wersjaAdresow } = await wersjaOdp.json()
  const url = '/dane/adresy.json?v=' + encodeURIComponent(wersjaAdresow)
  if (!('caches' in window)) {
    const odpowiedz = await fetch(url)
    if (!odpowiedz.ok) throw new Error('Adresy: HTTP ' + odpowiedz.status)
    return odpowiedz.json()
  }
  const magazyn = await caches.open('adresscore-katalog-v1')
  const zapis = await magazyn.match(url)
  if (zapis) return zapis.json()
  const odpowiedz = await fetch(url)
  if (!odpowiedz.ok) throw new Error('Adresy: HTTP ' + odpowiedz.status)
  try {
    await magazyn.put(url, odpowiedz.clone())
    for (const klucz of await magazyn.keys()) {
      if (klucz.url !== new URL(url, location.origin).href) await magazyn.delete(klucz)
    }
  } catch {
    // Przeglądarka może odmówić miejsca w Cache Storage; katalog nadal działa z odpowiedzi sieciowej.
  }
  return odpowiedz.json()
}

const normalizuj = (tekst) =>
  String(tekst ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pl')
    .replaceAll('ł', 'l')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')

function pokaz() {
  wyniki.replaceChildren()
  const razem = Math.ceil(trafienia.length / rozmiarStrony)
  const od = numerStrony * rozmiarStrony
  for (const adres of trafienia.slice(od, od + rozmiarStrony)) {
    const li = document.createElement('li')
    const link = document.createElement('a')
    link.textContent = adres.ulica
      ? adres.ulica + ' ' + adres.nr + ', ' + adres.miejscowosc
      : adres.miejscowosc + ' ' + adres.nr
    link.href = '/#/adres/' + encodeURIComponent(adres.id)
    const szczegoly = document.createElement('span')
    szczegoly.textContent = adres.gmina + (adres.kod ? ' · ' + adres.kod : '')
    li.append(link, szczegoly)
    wyniki.append(li)
  }
  stan.textContent =
    trafienia.length.toLocaleString('pl-PL') +
    ' adresów' +
    (trafienia.length
      ? ' · pokazano ' + (od + 1) + '–' + Math.min(od + rozmiarStrony, trafienia.length)
      : '')
  strony.hidden = razem <= 1
  strona.textContent = 'Strona ' + (numerStrony + 1) + ' z ' + razem
  poprzednia.disabled = numerStrony === 0
  nastepna.disabled = numerStrony >= razem - 1
}

function filtruj() {
  const slowa = normalizuj(input.value).trim().split(/\s+/).filter(Boolean)
  const wybranaGmina = gmina.value
  trafienia = adresy.filter(
    (a) =>
      (!wybranaGmina || a.gmina === wybranaGmina) &&
      slowa.every((slowo) => a.szukaj.includes(slowo)),
  )
  numerStrony = 0
  pokaz()
}

document.querySelector('#filtry').addEventListener('submit', (event) => event.preventDefault())
input.addEventListener('input', () => {
  clearTimeout(timer)
  timer = setTimeout(filtruj, 150)
})
gmina.addEventListener('change', filtruj)
poprzednia.addEventListener('click', () => {
  numerStrony--
  pokaz()
})
nastepna.addEventListener('click', () => {
  numerStrony++
  pokaz()
})

try {
  const { kolumny: k } = await wczytajAdresy()
  adresy = k.id.map((id, i) => {
    const a = {
      id,
      miejscowosc: k.miejscowosc[i],
      ulica: k.ulica[i],
      nr: k.nr[i],
      kod: k.kod[i],
      gmina: k.gmina[i],
    }
    a.szukaj = normalizuj([a.ulica, a.nr, a.miejscowosc, a.gmina, a.kod].join(' '))
    return a
  })
  for (const nazwa of [...new Set(adresy.map((a) => a.gmina))].sort((a, b) =>
    a.localeCompare(b, 'pl'),
  )) {
    const opcja = document.createElement('option')
    opcja.value = nazwa
    opcja.textContent = nazwa
    gmina.append(opcja)
  }
  filtruj()
} catch (blad) {
  stan.textContent = 'Nie udało się wczytać katalogu: ' + blad.message
}
