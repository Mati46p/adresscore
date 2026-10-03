// Deterministyczny gzip dla plików, które trafiają do gita (#179): te same bajty na każdym systemie.
//
// Dlaczego: zlib wpisuje do nagłówka gzip kod systemu (bajt 9: macOS 19, Linux 3, Windows 10).
// Nazwy plików kompaktu niosą skrót SHA-256 ich bajtów (etl/kompakt.mjs), więc ten sam kompakt
// policzony na innym systemie dostawał inne nazwy: `node etl/kompakt.mjs --sprawdz` zwracał 1 na
// czystym main, a każde przeliczenie przepisywało wszystkie pliki. Strumień deflate poziomu 9 jest
// u nas taki sam na macOS, Linuksie i Windowsie (sprawdzone na plikach z repo) – różni się wyłącznie
// ten bajt, więc po jego ustaleniu bajty zależą tylko od treści.
//
// MTIME zapisujemy jawnie jako 0 (zlib bez własnego nagłówka i tak go zeruje), bajt systemu jako
// 255 = „nieznany" (RFC 1952, pkt 2.3.1). Poziom 9 zostaje: inny zmieniłby strumień każdego pliku.
// Dekodery (gunzip, DecompressionStream w przeglądarce) nie czytają ani MTIME, ani bajtu systemu.
// Strumień deflate zależy jeszcze od wersji zlib – tego ten moduł nie ukrywa (patrz
// scripts/generuj-katalog.mjs, który przy tej samej treści nie przepisuje pliku).
import { gzipSync } from 'node:zlib'

/** Bajt systemu w nagłówku gzip (offset 9): 255 = nieznany. */
export const GZIP_BAJT_SYSTEMU = 255

/** gzip poziomu 9 z nagłówkiem niezależnym od systemu i czasu. Przyjmuje to samo co `gzipSync`. */
export function gzipDeterministyczny(dane) {
  const gz = gzipSync(dane, { level: 9 })
  gz.writeUInt32LE(0, 4) // MTIME
  gz[9] = GZIP_BAJT_SYSTEMU
  return gz
}

/** Czy plik ma nagłówek ustawiany przez `gzipDeterministyczny` (MTIME 0, bajt systemu 255). */
export function maStalyNaglowek(gz) {
  return gz.length >= 10 && gz.subarray(4, 8).every((b) => b === 0) && gz[9] === GZIP_BAJT_SYSTEMU
}
