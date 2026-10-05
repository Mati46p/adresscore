// Ekran bez sesji: przycisk „Zaloguj przez Google” i nic więcej (żadnej liczby, zakładki ani
// nawigacji – panel nie zdradza przed zalogowaniem, co w nim jest). Komunikat pojawia się tylko
// wtedy, gdy powrót od dostawcy się nie udał albo start logowania zawiódł.
import { useState } from 'react'
import { zaloguj } from './auth'

export function Logowanie({ blad }: { blad?: string | null }) {
  const [wToku, setWToku] = useState(false)
  const [bladStartu, setBladStartu] = useState<string | null>(null)

  async function rozpocznij() {
    setWToku(true)
    setBladStartu(null)
    const komunikat = await zaloguj()
    // Przy powodzeniu przeglądarka odchodzi do Google, więc tu wracamy tylko po błędzie.
    if (komunikat) {
      setBladStartu(komunikat)
      setWToku(false)
    }
  }

  const komunikat = bladStartu ?? blad ?? null
  return (
    <section className="panel-stan" aria-labelledby="panel-logowanie-tytul">
      <h1 id="panel-logowanie-tytul">Panel</h1>
      <button type="button" className="przycisk-glowny" disabled={wToku} onClick={rozpocznij}>
        {wToku ? 'Przekierowuję do Google…' : 'Zaloguj przez Google'}
      </button>
      {komunikat ? (
        <p className="panel-blad" role="alert">
          {komunikat}
        </p>
      ) : null}
    </section>
  )
}
