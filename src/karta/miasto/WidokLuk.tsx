// Widok „Luki w usługach” trybu Dla miasta (#90–#92): ranking okolic obok mapy luk. Panel i mapa liczą
// z `useDane()` same, a tu jest tylko to, co je łączy: wybrana warstwa (parametr `w` linku, stan
// aplikacji) i okolica, do której mapa ma przelecieć po kliknięciu w ranking. Warstwę wybiera się
// jednym paskiem nad mapą (`MapaLuk`); panel go nie powtarza (`bezWyboruWarstwy`), żeby ranking
// był od razu widoczny.
import { useState } from 'react'
import { PanelLuk } from '@/karta/luki/PanelLuk'
import { MapaLuk } from '@/mapa/luki/MapaLuk'
import { useStan, ustawWarstweLuk } from '@/wynik/stan'

export function WidokLuk() {
  const warstwa = useStan((s) => s.warstwaLuk)
  const [okolica, setOkolica] = useState<string | null>(null)

  return (
    <main className="miasto-luki">
      <div className="miasto-luki-panel">
        <div className="miasto-luki-wstep">
          <h1 tabIndex={-1}>Dla miasta: luki w usługach</h1>
          <p>
            Wybierz usługę nad mapą, a ranking pokaże okolice, w których najwięcej adresów jej nie
            ma w zasięgu. Kliknij okolicę, żeby mapa przeleciała do niej. Co zmieni postawienie
            przystanku, szkoły czy punktu zdrowia, policzysz w symulatorze inwestycji.
          </p>
        </div>
        <PanelLuk
          warstwa={warstwa}
          onZmienWarstwe={ustawWarstweLuk}
          onWybierzOkolice={setOkolica}
          wybranaOkolica={okolica}
          bezWyboruWarstwy
        />
      </div>
      <section className="miasto-luki-mapa" aria-label="Mapa luk w usługach">
        <MapaLuk warstwa={warstwa} onZmienWarstwe={ustawWarstweLuk} okolicaDoPokazania={okolica} />
      </section>
    </main>
  )
}
