// Menedżer wspólnego workera obliczeń (#108), strona wątku głównego. Ekran trybu Miasto albo Biznes
// bierze z niego UCHWYT (`otworz`), a gdy się zamyka, go zwalnia (`zwolnij`). Menedżer pilnuje
// trzech rzeczy:
//   1. jedna instancja workera na oba tryby – powstaje przy pierwszym uchwycie, kolejne dostają tę samą;
//   2. nigdy dwóch naraz – po zwolnieniu ostatniego uchwytu worker jest zamykany (`terminate`),
//      więc po wyjściu z Miasta i Biznesu nie zostaje po nim ani wątek, ani baza w pamięci;
//   3. stan trybu, który się zamknął, a worker żyje dla drugiego, oddaje wiadomość `zwolnij`.
// Dlaczego tak, a nie dwa osobne workery albo jeden wieczny: patrz komentarz w `obliczenia.ts`.
//
// Worker, który się nie załadował albo wyrzucił wyjątek poza obsługą wiadomości, jest zamykany,
// a uchwyty dostają `naBledzie`; Miasto liczy wtedy synchronicznie (ta sama czysta funkcja),
// Biznes pokazuje komunikat. Nowy uchwyt po zwolnieniu wszystkich próbuje od nowa.
import type {
  DoWorkera,
  OdpowiedzTrybu,
  TrybObliczen,
  WiadomoscTrybu,
  ZWorkera,
} from './obliczenia.ts'

/** Najmniejszy kształt workera, jakiego używa menedżer: prawdziwy `Worker` go spełnia, test podstawia atrapę. */
export interface PortWorkera {
  postMessage(wiadomosc: DoWorkera): void
  terminate(): void
  onmessage: ((e: { data: ZWorkera }) => void) | null
  onerror: ((e: { message?: string }) => void) | null
}

export interface Uchwyt<T extends TrybObliczen> {
  readonly tryb: T
  /** `false` = worker niedostępny albo uchwyt zwolniony: wiadomość nie poszła, licz sam. */
  wyslij(wiadomosc: WiadomoscTrybu<T>): boolean
  /** Odpowiedzi tego trybu (pole `tryb` zostaje w obiekcie, ale typ go nie wymaga). Zwraca funkcję zdejmującą nasłuch. */
  nasluchuj(f: (odpowiedz: OdpowiedzTrybu<T>) => void): () => void
  /** Worker przestał działać (nie załadował się, wyjątek poza obsługą). Po tym `wyslij` zwraca `false`. */
  naBledzie(f: (blad: string) => void): () => void
  /** Zdejmuje nasłuchy uchwytu i oddaje worker (albo stan trybu). Kolejne wywołania nic nie robią. */
  zwolnij(): void
}

export interface StanMenedzera {
  /** Czy instancja workera żyje (0 albo 1 – nigdy dwie). */
  zywy: boolean
  /** Ile uchwytów trzyma każdy tryb. */
  uchwyty: Readonly<Record<TrybObliczen, number>>
}

export interface MenedzerObliczen {
  /** Uchwyt do wspólnego workera albo `null`, gdy Workera nie da się uruchomić (liczy wołający). */
  otworz<T extends TrybObliczen>(tryb: T): Uchwyt<T> | null
  stan(): StanMenedzera
}

interface Sluchacz {
  tryb: TrybObliczen
  f: (odpowiedz: ZWorkera) => void
}

export function utworzMenedzera(fabryka: () => PortWorkera): MenedzerObliczen {
  let port: PortWorkera | null = null
  let niedostepny = false
  const uchwyty: Record<TrybObliczen, number> = { miasto: 0, biznes: 0 }
  const odpowiedzi = new Set<Sluchacz>()
  const bledy = new Set<(blad: string) => void>()

  const wszystkieUchwyty = () => uchwyty.miasto + uchwyty.biznes

  function zamknij() {
    const stary = port
    port = null
    if (stary) {
      stary.onmessage = null
      stary.onerror = null
      stary.terminate()
    }
  }

  function uruchom(): PortWorkera | null {
    if (port) return port
    if (niedostepny) return null
    let nowy: PortWorkera
    try {
      nowy = fabryka()
    } catch {
      // Przeglądarka bez modułowych workerów: wołający liczy sam. Bez stanu „niedostępny”, bo nie ma
      // uchwytu, który by go później zwolnił – następny ekran po prostu spróbuje jeszcze raz.
      return null
    }
    nowy.onmessage = (e) => {
      const odp = e.data
      for (const s of [...odpowiedzi]) if (s.tryb === odp.tryb) s.f(odp)
    }
    nowy.onerror = (e) => {
      // Worker, który się nie załadował albo padł, nie wróci: zamykamy go i mówimy uchwytom.
      niedostepny = true
      zamknij()
      const blad = e.message ?? 'Obliczenia w tle przestały działać'
      for (const f of [...bledy]) f(blad)
    }
    port = nowy
    return nowy
  }

  return {
    otworz<T extends TrybObliczen>(tryb: T): Uchwyt<T> | null {
      if (!uruchom()) return null
      uchwyty[tryb]++
      let aktywny = true
      const moje: Sluchacz[] = []
      const mojeBledy: ((blad: string) => void)[] = []
      return {
        tryb,
        wyslij(wiadomosc) {
          if (!aktywny || !port) return false
          port.postMessage({ tryb, ...wiadomosc } as DoWorkera)
          return true
        },
        nasluchuj(f) {
          const s: Sluchacz = { tryb, f: f as unknown as (odpowiedz: ZWorkera) => void }
          moje.push(s)
          odpowiedzi.add(s)
          return () => odpowiedzi.delete(s)
        },
        naBledzie(f) {
          mojeBledy.push(f)
          bledy.add(f)
          return () => bledy.delete(f)
        },
        zwolnij() {
          if (!aktywny) return
          aktywny = false
          for (const s of moje) odpowiedzi.delete(s)
          for (const f of mojeBledy) bledy.delete(f)
          uchwyty[tryb]--
          if (wszystkieUchwyty() === 0) {
            zamknij()
            // Po zwolnieniu wszystkiego następny ekran próbuje od nowa (np. po chwilowym błędzie sieci).
            niedostepny = false
          } else if (uchwyty[tryb] === 0 && port) port.postMessage({ tryb, typ: 'zwolnij' })
        },
      }
    },
    stan: () => ({ zywy: port !== null, uchwyty: { ...uchwyty } }),
  }
}

/** Jedyny menedżer w aplikacji: ekrany Miasto i Biznes biorą z niego ten sam worker. */
export const menedzerObliczen: MenedzerObliczen = utworzMenedzera(
  () =>
    new Worker(new URL('./obliczenia.worker.ts', import.meta.url), {
      type: 'module',
    }) as unknown as PortWorkera,
)
