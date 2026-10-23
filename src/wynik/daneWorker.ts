// Worker danych miasta: pobranie adresów, manifestu, skal i wszystkich warstw, parsowanie JSON,
// skale i grupowanie heksów – to, co wcześniej blokowało kartę na dziesiątki sekund. Cienka
// powłoka jak `obliczenia.worker.ts`: cała logika siedzi w `ladowanieDanych.ts`. Uruchamia go
// wyłącznie `daneWTle.ts`; jedno ładowanie na worker, który po wyniku jest zamykany.
import { ladujDaneMiasta, type Porcja, porcjeWyniku } from './ladowanieDanych.ts'

/** Wiadomość do workera. Baza ma być bezwzględna: worker nie zna adresu strony. */
export interface DoWorkeraDanych {
  slug: Parameters<typeof ladujDaneMiasta>[0]['slug']
  baza: string
}

export type ZWorkeraDanych =
  | { typ: 'porcja'; porcja: Porcja }
  | { typ: 'ostrzezenia'; ostrzezenia: string[] }
  | { typ: 'blad'; blad: string }

// tsconfig ma lib DOM, nie WebWorker – opisujemy tylko to, czego używamy z zakresu workera.
const zakres = self as unknown as {
  onmessage: ((e: MessageEvent<DoWorkeraDanych>) => void) | null
  postMessage(odpowiedz: ZWorkeraDanych, transfer: Transferable[]): void
}

async function pobierzJson(sciezka: string, signal?: AbortSignal): Promise<unknown> {
  // Niski priorytet: ładowanie nie ma zabierać łącza pierwszemu malowaniu strony.
  const odp = await fetch(sciezka, { signal, priority: 'low' })
  if (!odp.ok) throw new Error(`Brak pliku danych ${sciezka} (${odp.status})`)
  return odp.json()
}

zakres.onmessage = async (e) => {
  const ostrzezenia: string[] = []
  try {
    const wynik = await ladujDaneMiasta({
      slug: e.data.slug,
      baza: e.data.baza,
      pobierzJson,
      ostrzez: (t) => ostrzezenia.push(t),
    })
    // Wynik idzie porcjami (każda tania do sklonowania), ostrzeżenia przed ostatnią, żeby wątek
    // główny miał je, zanim złoży całość.
    zakres.postMessage({ typ: 'ostrzezenia', ostrzezenia }, [])
    for (const { porcja, transfer } of porcjeWyniku(wynik)) {
      zakres.postMessage({ typ: 'porcja', porcja }, transfer)
    }
  } catch (blad) {
    zakres.postMessage(
      { typ: 'blad', blad: blad instanceof Error ? blad.message : String(blad) },
      [],
    )
  }
}
