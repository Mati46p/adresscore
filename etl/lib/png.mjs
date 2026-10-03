// Minimalny dekoder PNG do odczytu surowych klas rastra z exportImage (jedna próbka na piksel):
// 8-bitowa skala szarości (typ 0) albo indeksy palety (typ 3), bez przeplotu. Inne PNG-i
// odrzuca zamiast zgadywać. Sumy kontrolnej CRC nie sprawdzamy – transport idzie po HTTPS,
// a rozmiar i zawartość weryfikuje wołający.
import { unzlibSync } from 'fflate'

const SYGNATURA = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

/** Dekoduje PNG → { szer, wys, dane } (dane: Uint8Array o długości szer × wys, wiersz po wierszu). */
export function dekodujPngSzary(bufor) {
  const b = Buffer.from(bufor)
  if (b.length < 8 || SYGNATURA.some((v, i) => b[i] !== v)) throw new Error('To nie jest PNG')
  let poz = 8
  let naglowek = null
  const idat = []
  while (poz + 12 <= b.length) {
    const dlugosc = b.readUInt32BE(poz)
    const typ = b.toString('latin1', poz + 4, poz + 8)
    const dane = b.subarray(poz + 8, poz + 8 + dlugosc)
    if (typ === 'IHDR')
      naglowek = {
        szer: dane.readUInt32BE(0),
        wys: dane.readUInt32BE(4),
        glebia: dane[8],
        typ: dane[9],
        przeplot: dane[12],
      }
    else if (typ === 'IDAT') idat.push(dane)
    else if (typ === 'IEND') break
    poz += 12 + dlugosc
  }
  if (!naglowek) throw new Error('PNG bez nagłówka IHDR')
  const { szer, wys, glebia, typ, przeplot } = naglowek
  if (glebia !== 8 || (typ !== 0 && typ !== 3) || przeplot !== 0)
    throw new Error(`Nieobsługiwany PNG: głębia ${glebia}, typ ${typ}, przeplot ${przeplot}`)
  const surowe = unzlibSync(Buffer.concat(idat))
  if (surowe.length !== (szer + 1) * wys) throw new Error('PNG: nieoczekiwana długość danych')
  const dane = new Uint8Array(szer * wys)
  for (let y = 0; y < wys; y++) {
    const filtr = surowe[y * (szer + 1)]
    const wej = y * (szer + 1) + 1
    const wyj = y * szer
    for (let x = 0; x < szer; x++) {
      const a = x > 0 ? dane[wyj + x - 1] : 0
      const gora = y > 0 ? dane[wyj - szer + x] : 0
      const c = x > 0 && y > 0 ? dane[wyj - szer + x - 1] : 0
      let v = surowe[wej + x]
      if (filtr === 1) v += a
      else if (filtr === 2) v += gora
      else if (filtr === 3) v += (a + gora) >> 1
      else if (filtr === 4) {
        const p = a + gora - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - gora)
        const pc = Math.abs(p - c)
        v += pa <= pb && pa <= pc ? a : pb <= pc ? gora : c
      } else if (filtr !== 0) throw new Error(`PNG: nieznany filtr ${filtr}`)
      dane[wyj + x] = v & 255
    }
  }
  return { szer, wys, dane }
}
