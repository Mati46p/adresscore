import {
  BUDZET_DOMYSLNY,
  type Budzet,
  opisKwoty,
  ZAKRES_KWOTY,
  ZAKRES_METRAZU,
} from '@/wynik/budzet'
import { useStan, ustawBudzet } from '@/wynik/stan'
import { useWyniki } from '@/wynik/useWyniki'

/**
 * Budżet w lewym panelu (#77): kwota i metraż. Wyłącznie ceny transakcyjne RCN (mediana ceny m²
 * w heksie), bez ogłoszeń. Heksy poza budżetem są wyszarzone, ranking pod mapą liczy się od razu.
 */
export function PanelBudzetu() {
  const budzet = useStan((s) => s.budzet)
  const tryb = useStan((s) => s.tryb)
  const wyniki = useWyniki()
  if (tryb === 'biznes') return null
  const b: Budzet = budzet ?? BUDZET_DOMYSLNY
  const wlaczony = budzet !== null
  const zmienBudzet = (latka: Partial<Budzet>) => ustawBudzet({ ...b, ...latka })

  return (
    <section aria-labelledby="h-budzet" className="panel-sekcja">
      <h2 id="h-budzet" className="etykieta-sekcji">
        Budżet
      </h2>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input
          type="checkbox"
          checked={wlaczony}
          onChange={(e) => ustawBudzet(e.target.checked ? b : null)}
        />
        Pokaż tylko okolice w moim budżecie
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span>
          Kwota: <strong>{opisKwoty(b.kwota)}</strong>
        </span>
        <input
          type="range"
          min={ZAKRES_KWOTY.min}
          max={ZAKRES_KWOTY.max}
          step={ZAKRES_KWOTY.krok}
          value={b.kwota}
          onChange={(e) => zmienBudzet({ kwota: Number(e.target.value) })}
        />
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span>
          Metraż: <strong>{b.metraz} m²</strong>
        </span>
        <input
          type="range"
          min={ZAKRES_METRAZU.min}
          max={ZAKRES_METRAZU.max}
          step={ZAKRES_METRAZU.krok}
          value={b.metraz}
          onChange={(e) => zmienBudzet({ metraz: Number(e.target.value) })}
        />
      </label>
      <p className="panel-uwaga">
        Maks. {Math.round(b.kwota / b.metraz).toLocaleString('pl-PL')} zł/m² – mediana cen
        transakcyjnych z Rejestru Cen Nieruchomości (heks), bez ogłoszeń. Heks bez transakcji
        zostaje na mapie jako „brak danych”.
      </p>
      {wlaczony && wyniki && (
        <p className="panel-uwaga" role="status">
          Poza budżetem: {wyniki.wykluczenia.liczbaWykluczonych.toLocaleString('pl-PL')} adresów ·
          brak ceny: {wyniki.wykluczenia.liczbaNiewiadomych.toLocaleString('pl-PL')}
        </p>
      )}
    </section>
  )
}
