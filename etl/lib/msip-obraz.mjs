// Pobranie obrazu (bajtów) z usługi przeglądania MSIP Krakowa (WMS GetMap).
// Jak w msip.mjs: certyfikat hosta MSIP bywa odrzucany przez Node (brakujący pośredni w łańcuchu),
// więc dopiero po prawdziwym błędzie certyfikatu ponawiamy żądanie z wyłączoną weryfikacją, i to
// wyłącznie dla tego jednego hosta. Różnica: tu zwracamy bajty (PNG), a nie tekst.
// Jedno żądanie na wywołanie – ponawianie, pauzy i cache są po stronie wołającego.
import https from 'node:https'
import { HOST_MSIP } from './msip.mjs'

const NAGLOWKI = { 'User-Agent': 'adresscore-etl/1.0 (HackYeah 2026; https://adresscore.pl)' }
const BLEDY_CERTYFIKATU = /CERT|SSL|SELF[_-]SIGNED|UNABLE_TO_VERIFY|ISSUER/i
const agentBezWeryfikacji = new https.Agent({ rejectUnauthorized: false })

/**
 * Czy błąd z `fetch` to odrzucony certyfikat (a nie np. zerwane połączenie albo HTTP 5xx). Powód
 * siedzi w `cause`; `message` pomijamy, bo bywa w nim cały URL, a ten mógłby przypadkiem pasować.
 */
export const czyBladCertyfikatu = (blad) =>
  BLEDY_CERTYFIKATU.test(`${blad?.cause?.code ?? blad?.code ?? ''} ${blad?.cause?.message ?? ''}`)

function pobierzBezWeryfikacji(url, limitMs) {
  return new Promise((resolve, reject) => {
    const zadanie = https.get(url, { agent: agentBezWeryfikacji, headers: NAGLOWKI }, (odp) => {
      const kawalki = []
      odp.on('data', (k) => kawalki.push(k))
      odp.on('end', () =>
        odp.statusCode === 200
          ? resolve(Buffer.concat(kawalki))
          : reject(new Error(`${url} → ${odp.statusCode}`)),
      )
      odp.on('error', reject)
    })
    zadanie.setTimeout(limitMs, () => zadanie.destroy(new Error(`${url} → przekroczono czas`)))
    zadanie.on('error', reject)
  })
}

/** Bajty odpowiedzi GET z hosta MSIP. Inny host to błąd programisty, nie sieci. */
export async function pobierzBajtyMsip(url, limitMs = 180_000) {
  if (new URL(url).hostname !== HOST_MSIP)
    throw new Error(`Pobieranie dozwolone tylko z ${HOST_MSIP}: ${url}`)
  let odp
  try {
    odp = await fetch(url, { headers: NAGLOWKI, signal: AbortSignal.timeout(limitMs) })
  } catch (blad) {
    if (!czyBladCertyfikatu(blad)) throw blad
    return pobierzBezWeryfikacji(url, limitMs)
  }
  if (!odp.ok) throw new Error(`${url} → ${odp.status}`)
  return Buffer.from(await odp.arrayBuffer())
}
