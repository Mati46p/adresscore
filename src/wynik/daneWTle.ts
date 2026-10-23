// Wątek główny strony ładowania danych: zleca `ladujDaneMiasta` workerowi (`daneWorker.ts`) i
// odbiera gotowy wynik z wartościami warstw przekazanymi bez kopiowania. Bez `Worker` (stare
// przeglądarki, błąd ładowania modułu workera) to samo robi wątek główny – wolniej, ale działa.

import type { DoWorkeraDanych, ZWorkeraDanych } from './daneWorker.ts'
import {
  ladujDaneMiasta,
  type PobierzJson,
  type WejscieLadowania,
  type WynikLadowania,
} from './ladowanieDanych.ts'

const przerwanie = (signal: AbortSignal) =>
  signal.reason instanceof Error ? signal.reason : new DOMException('Przerwano', 'AbortError')

/** Pobranie na wątku głównym (zapas). Rzuca przy HTTP innym niż 200. */
export const pobierzJsonNaGlownym: PobierzJson = async (sciezka, signal) => {
  const odp = await fetch(sciezka, { signal })
  if (!odp.ok) throw new Error(`Brak pliku danych ${sciezka} (${odp.status})`)
  return odp.json()
}

function wGlownym(wej: Pick<WejscieLadowania, 'slug' | 'baza'>, signal?: AbortSignal) {
  return ladujDaneMiasta(
    {
      ...wej,
      pobierzJson: pobierzJsonNaGlownym,
      ostrzez: (t) => console.warn(t),
    },
    signal,
  )
}

/**
 * Ładuje dane miasta w workerze. Przerwanie (`signal`) zamyka worker, więc odrzuca się błędem
 * przerwania, tak jak `fetch`. Błąd samego workera (nie załadował się) wraca do ładowania na
 * wątku głównym; błąd danych (brak adresów) jest zwykłym odrzuceniem.
 */
export function ladujDaneWTle(
  wej: Pick<WejscieLadowania, 'slug' | 'baza'>,
  signal?: AbortSignal,
): Promise<WynikLadowania> {
  if (typeof Worker === 'undefined') return wGlownym(wej, signal)
  let worker: Worker
  try {
    worker = new Worker(new URL('./daneWorker.ts', import.meta.url), { type: 'module' })
  } catch {
    return wGlownym(wej, signal)
  }
  return new Promise<WynikLadowania>((resolve, reject) => {
    const koniec = () => {
      signal?.removeEventListener('abort', przy)
      worker.onmessage = null
      worker.onerror = null
      worker.terminate()
    }
    const przy = () => {
      koniec()
      reject(przerwanie(signal as AbortSignal))
    }
    if (signal?.aborted) {
      koniec()
      reject(przerwanie(signal))
      return
    }
    signal?.addEventListener('abort', przy, { once: true })
    worker.onmessage = (e: MessageEvent<ZWorkeraDanych>) => {
      const odp = e.data
      koniec()
      if (odp.typ === 'blad') return reject(new Error(odp.blad))
      for (const t of odp.ostrzezenia) console.warn(t)
      resolve(odp.wynik)
    }
    worker.onerror = () => {
      // Worker nie wstał (np. moduł się nie załadował): zapas na wątku głównym.
      koniec()
      wGlownym(wej, signal).then(resolve, reject)
    }
    const wiadomosc: DoWorkeraDanych = { slug: wej.slug, baza: wej.baza }
    worker.postMessage(wiadomosc)
  })
}
