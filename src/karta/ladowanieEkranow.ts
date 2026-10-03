import type { Ekran } from '@/wynik/url'

export const ladujOkolice = () => import('./okolica/EkranOkolica')
export const ladujPorownanie = () => import('./porownanie/EkranPorownanie')
export const ladujMetode = () => import('@/strony/Metoda')

export function przygotujEkran(ekran: Ekran) {
  if (ekran === 'okolica') void ladujOkolice()
  if (ekran === 'porownanie') void ladujPorownanie()
  if (ekran === 'metoda') void ladujMetode()
}
