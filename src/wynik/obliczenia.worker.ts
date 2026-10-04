// Wspólny worker obliczeń trybów Miasto i Biznes (#108). Cienka powłoka: cała logika siedzi
// w `obliczenia.ts` (router) i w obsługach trybów, a tu jest tylko to, czego potrzebuje sam worker
// – `fetch` i `postMessage`. Uruchamia go wyłącznie `menedzerObliczen.ts`.
import { type DoWorkera, utworzRouter, type ZWorkera } from './obliczenia.ts'

// tsconfig ma lib DOM, nie WebWorker – opisujemy tylko to, czego używamy z zakresu workera.
const zakres = self as unknown as {
  onmessage: ((e: MessageEvent<DoWorkera>) => void) | null
  postMessage(odpowiedz: ZWorkera): void
}

async function pobierz(sciezka: string): Promise<unknown> {
  const odp = await fetch(sciezka)
  if (!odp.ok) throw new Error(`${sciezka}: HTTP ${odp.status}`)
  return odp.json()
}

const obsluz = utworzRouter({ wyslij: (o) => zakres.postMessage(o), pobierz })
zakres.onmessage = (e) => {
  void obsluz(e.data)
}
