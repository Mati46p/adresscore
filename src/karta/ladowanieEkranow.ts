import type { Ekran } from '@/wynik/url'

export const ladujOkolice = () => import('./okolica/EkranOkolica')
export const ladujPorownanie = () => import('./porownanie/EkranPorownanie')
export const ladujMetode = () => import('@/strony/Metoda')
export const ladujBiznes = () => import('./biznes/EkranBiznes')
export const ladujMiasto = () => import('./miasto/EkranMiasto')
// Symulator to widok trybu Miasto: ładuje go `EkranMiasto` (od razu albo po kliknięciu w pasek widoków).
export const ladujSymulator = () => import('./symulator/EkranSymulatora')
// Panel admina z analityką (`#/panel`) to jedyna furtka z głównego kodu do `src/panel/**`; razem
// z panelem ładują się klient Supabase i biblioteka wykresów, których zwiedzający nie dostają.
export const ladujPanel = () => import('@/panel/EkranPanel')

export function przygotujEkran(ekran: Ekran) {
  if (ekran === 'okolica') void ladujOkolice()
  if (ekran === 'porownanie') void ladujPorownanie()
  if (ekran === 'metoda') void ladujMetode()
  if (ekran === 'biznes') void ladujBiznes()
  if (ekran === 'miasto') void ladujMiasto()
  // Panel NIE jest częścią ścieżki zwiedzającego, więc `Powloka` nie ładuje go „z bezczynności”
  // (jej prefetch dotyczy tylko następnego kroku szukaj → okolica → porównanie). Ta gałąź działa
  // wyłącznie na jawne wywołanie `przygotujEkran('panel')`.
  if (ekran === 'panel') void ladujPanel()
}
