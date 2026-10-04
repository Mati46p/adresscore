import type { Ekran } from '@/wynik/url'

export const ladujOkolice = () => import('./okolica/EkranOkolica')
export const ladujPorownanie = () => import('./porownanie/EkranPorownanie')
export const ladujMetode = () => import('@/strony/Metoda')
export const ladujBiznes = () => import('./biznes/EkranBiznes')
export const ladujMiasto = () => import('./miasto/EkranMiasto')
// Symulator to widok trybu Miasto: ładuje go `EkranMiasto` (od razu albo po kliknięciu w pasek widoków).
export const ladujSymulator = () => import('./symulator/EkranSymulatora')

export function przygotujEkran(ekran: Ekran) {
  if (ekran === 'okolica') void ladujOkolice()
  if (ekran === 'porownanie') void ladujPorownanie()
  if (ekran === 'metoda') void ladujMetode()
  if (ekran === 'biznes') void ladujBiznes()
  if (ekran === 'miasto') void ladujMiasto()
}
