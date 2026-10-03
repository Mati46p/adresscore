// Pobiera pojedynczy plik z dużego publicznego ZIP przez HTTP Range.
// Centralny katalog ZIP leży na końcu; nie trzeba ściągać całej paczki 614 MB.
import { createWriteStream, statSync } from 'node:fs'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createInflateRaw } from 'node:zlib'

async function zakres(url, od, doByte) {
  const odpowiedz = await fetch(url, { headers: { Range: `bytes=${od}-${doByte}` } })
  if (odpowiedz.status !== 206 || !odpowiedz.body) {
    throw new Error(`Serwer nie obsługuje HTTP Range: ${odpowiedz.status}`)
  }
  const contentRange = odpowiedz.headers.get('content-range')
  if (!contentRange?.startsWith(`bytes ${od}-${doByte}/`)) {
    throw new Error(`Nieprawidłowy Content-Range: ${contentRange}`)
  }
  return odpowiedz
}

export async function katalogZip(url) {
  const head = await fetch(url, { method: 'HEAD' })
  if (!head.ok) throw new Error(`ZIP HTTP ${head.status}`)
  const rozmiar = Number(head.headers.get('content-length'))
  if (!Number.isSafeInteger(rozmiar) || rozmiar < 65_536) throw new Error('Brak rozmiaru ZIP')
  const od = rozmiar - 65_536
  const odpowiedz = await zakres(url, od, rozmiar - 1)
  const koniec = Buffer.from(await odpowiedz.arrayBuffer())
  const eocd = koniec.lastIndexOf(Buffer.from('504b0506', 'hex'))
  if (eocd < 0) throw new Error('Brak końca katalogu ZIP')
  const liczba = koniec.readUInt16LE(eocd + 10)
  const offset = koniec.readUInt32LE(eocd + 16) - od
  if (offset < 0) throw new Error('Katalog ZIP nie mieści się w ostatnich 64 kB')
  const pliki = new Map()
  let pozycja = offset
  for (let i = 0; i < liczba; i++) {
    if (koniec.readUInt32LE(pozycja) !== 0x02014b50) throw new Error('Błędny katalog ZIP')
    const nazwaDlugosc = koniec.readUInt16LE(pozycja + 28)
    const extraDlugosc = koniec.readUInt16LE(pozycja + 30)
    const komentarzDlugosc = koniec.readUInt16LE(pozycja + 32)
    const nazwa = koniec.toString('utf8', pozycja + 46, pozycja + 46 + nazwaDlugosc)
    pliki.set(nazwa, {
      metoda: koniec.readUInt16LE(pozycja + 10),
      skompresowany: koniec.readUInt32LE(pozycja + 20),
      rozpakowany: koniec.readUInt32LE(pozycja + 24),
      lokalnyOffset: koniec.readUInt32LE(pozycja + 42),
    })
    pozycja += 46 + nazwaDlugosc + extraDlugosc + komentarzDlugosc
  }
  return pliki
}

export async function wypakujZdalnie(url, wpis, cel) {
  const lokalny = await zakres(url, wpis.lokalnyOffset, wpis.lokalnyOffset + 255)
  const naglowek = Buffer.from(await lokalny.arrayBuffer())
  if (naglowek.readUInt32LE(0) !== 0x04034b50) throw new Error('Błędny nagłówek pliku ZIP')
  const start = wpis.lokalnyOffset + 30 + naglowek.readUInt16LE(26) + naglowek.readUInt16LE(28)
  const koniec = start + wpis.skompresowany - 1
  const odpowiedz = await zakres(url, start, koniec)
  if (wpis.metoda === 8) {
    await pipeline(Readable.fromWeb(odpowiedz.body), createInflateRaw(), createWriteStream(cel))
  } else if (wpis.metoda === 0) {
    await pipeline(Readable.fromWeb(odpowiedz.body), createWriteStream(cel))
  } else {
    throw new Error(`Nieobsługiwana metoda ZIP: ${wpis.metoda}`)
  }
  if (statSync(cel).size !== wpis.rozpakowany)
    throw new Error('Nieprawidłowy rozmiar rozpakowanego pliku')
}
