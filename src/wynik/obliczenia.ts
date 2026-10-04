// Wspólny worker obliczeń trybów Miasto i Biznes (#108): protokół wiadomości i router po stronie
// workera. Jedna instancja obsługuje oba tryby; każda wiadomość niesie pole `tryb`, a router
// przekazuje ją do obsługi właściwego trybu (`obliczeniaMiasto.ts`, `obliczeniaBiznes.ts`).
// Moduł jest czysty (bez `self`, `fetch`, `Worker`), więc działa tak samo w workerze
// (`obliczenia.worker.ts`) i w teście na gołym Node. Strona wątku głównego: `menedzerObliczen.ts`.
//
// DLACZEGO JEDEN WORKER, ale z osobnymi stanami i zwalnianiem (decyzja #108):
// - Jedna instancja zamiast dwóch: jeden wątek, jedna sterta, jeden plik kodu do pobrania (offline
//   też: service worker cache'uje go razem z aplikacją, a nie osobno dla każdego trybu).
// - Tryby mają jednak RÓŻNE dane i RÓŻNY cykl życia: Miasto dostaje od wątku głównego bazę (kopia
//   danych ~176 tys. adresów, wysyłana po zmianie wag), Biznes sam pobiera popyt i pliki branż.
//   Dlatego stany obu trybów są rozłączne, `zwolnij` oddaje stan JEDNEGO trybu (gdy worker żyje
//   dla drugiego), a menedżer zamyka worker, gdy nie używa go żaden tryb – nigdy nie trzyma dwóch
//   instancji naraz i nie trzyma pamięci po ekranie, którego już nie ma.
// - Wyjątek w jednym trybie nie może zepsuć drugiego: router łapie go i odsyła `blad` z polem
//   `tryb`, zamiast pozwolić, by zdarzenie `error` zabiło worker obu trybów.
import {
  type ObslugaBiznesu,
  type OdpowiedzBiznesu,
  utworzObslugeBiznesu,
  type WiadomoscBiznesu,
} from './obliczeniaBiznes.ts'
import {
  type ObslugaMiasta,
  type OdpowiedzMiasta,
  utworzObslugeMiasta,
  type WiadomoscMiasta,
} from './obliczeniaMiasto.ts'

export type TrybObliczen = 'miasto' | 'biznes'

/** Wyjątek w obsłudze trybu Miasto; `id` żądania (`licz`, `sugeruj`) albo `null` (np. przy `baza`). */
export interface BladMiasta {
  typ: 'blad'
  id: number | null
  blad: string
}

/** Wiadomości danego trybu (bez pola `tryb` – dopisuje je uchwyt menedżera). */
export type WiadomoscTrybu<T extends TrybObliczen> = T extends 'miasto'
  ? WiadomoscMiasta
  : WiadomoscBiznesu
/** Odpowiedzi danego trybu (bez pola `tryb`). */
export type OdpowiedzTrybu<T extends TrybObliczen> = T extends 'miasto'
  ? OdpowiedzMiasta | BladMiasta
  : OdpowiedzBiznesu

/** Wątek główny → worker. `zwolnij` oddaje stan jednego trybu, gdy worker żyje dla drugiego. */
export type DoWorkera =
  | ({ tryb: 'miasto' } & WiadomoscMiasta)
  | ({ tryb: 'biznes' } & WiadomoscBiznesu)
  | { tryb: TrybObliczen; typ: 'zwolnij' }

/** Worker → wątek główny. */
export type ZWorkera =
  | ({ tryb: 'miasto' } & (OdpowiedzMiasta | BladMiasta))
  | ({ tryb: 'biznes' } & OdpowiedzBiznesu)

export interface WejscieRoutera {
  wyslij(odpowiedz: ZWorkera): void
  /** JSON spod ścieżki (`/dane/...`); rzuca, gdy odpowiedź nie jest poprawna. */
  pobierz(sciezka: string): Promise<unknown>
}

export interface Router {
  (wiadomosc: DoWorkera): Promise<void>
  /** Stany trybów do oglądania w teście (np. czy `zwolnij` rzeczywiście je oddało). */
  readonly obslugi: { miasto: ObslugaMiasta; biznes: ObslugaBiznesu }
}

/**
 * Router wiadomości jednego workera. Nigdy nie rzuca: wyjątek w obsłudze trybu wraca do ekranu
 * jako `blad` tego trybu, a wiadomość z nieznanym `tryb` (np. z nowszej wersji aplikacji) jest
 * pomijana.
 */
export function utworzRouter({ wyslij, pobierz }: WejscieRoutera): Router {
  const miasto = utworzObslugeMiasta((o) => wyslij({ tryb: 'miasto', ...o }))
  const biznes = utworzObslugeBiznesu({ pobierz, wyslij: (o) => wyslij({ tryb: 'biznes', ...o }) })
  const router = async (w: DoWorkera): Promise<void> => {
    try {
      if (w.tryb === 'miasto') {
        if (w.typ === 'zwolnij') miasto.zwolnij()
        else miasto.obsluz(w)
      } else if (w.tryb === 'biznes') {
        if (w.typ === 'zwolnij') biznes.zwolnij()
        else await biznes.obsluz(w)
      }
    } catch (e) {
      const blad = e instanceof Error ? e.message : String(e)
      if (w.tryb === 'miasto')
        wyslij({ tryb: 'miasto', typ: 'blad', id: 'id' in w ? w.id : null, blad })
      else if (w.tryb === 'biznes') wyslij({ tryb: 'biznes', typ: 'blad', wersja: 0, blad })
    }
  }
  return Object.assign(router, { obslugi: { miasto, biznes } })
}
