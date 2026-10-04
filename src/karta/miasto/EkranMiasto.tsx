// Tryb „Dla miasta” (#91, #92, #96–#98, #108): jeden adres `#/miasto`, dwa widoki pod paskiem –
// luki w usługach (ranking okolic i mapa luk) oraz symulator inwestycji. Pasek stoi nad widokiem,
// a nie w nim, więc przełączenie nie gubi fokusu klawiatury (ten sam element przed i po).
import { lazy, Suspense, useState } from 'react'
import { useStan } from '@/wynik/stan'
import { WIDOKI_MIASTA, type WidokMiasta, widokPoczatkowy } from '@/wynik/widokMiasta'
import { ladujSymulator } from '../ladowanieEkranow'
import { WidokLuk } from './WidokLuk'
import './miasto.css'

const EkranSymulatora = lazy(async () => ({
  default: (await ladujSymulator()).EkranSymulatora,
}))

export function EkranMiasto() {
  const symulacja = useStan((s) => s.symulacja)
  // Widok wybiera link (obiekty w linku = symulator, inaczej luki), potem już tylko użytkownik.
  const [widok, setWidok] = useState<WidokMiasta>(() => widokPoczatkowy(symulacja))

  return (
    <div className="miasto">
      <div className="miasto-widoki" role="group" aria-label="Widok trybu Dla miasta">
        {WIDOKI_MIASTA.map((w) => (
          <button
            key={w.id}
            type="button"
            className="seg"
            aria-pressed={widok === w.id}
            onClick={() => setWidok(w.id)}
            onMouseEnter={() => w.id === 'symulator' && void ladujSymulator()}
            onFocus={() => w.id === 'symulator' && void ladujSymulator()}
          >
            {w.etykieta}
          </button>
        ))}
      </div>
      {widok === 'luki' ? (
        <WidokLuk />
      ) : (
        <Suspense
          fallback={
            <main className="miasto-ladowanie">
              <p className="komunikat" role="status">
                Wczytuję symulator…
              </p>
            </main>
          }
        >
          <EkranSymulatora />
        </Suspense>
      )}
    </div>
  )
}
