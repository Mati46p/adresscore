import type { WskaznikMeta } from '../../kontrakty/index.ts'
import type { KierunekOceny } from '../../wynik/silnik.ts'

export function kierunkiWarstwy(meta: WskaznikMeta): readonly KierunekOceny[] {
  if (meta.id === 'sct_w_strefie' || meta.id === 'spp_podstrefa')
    return ['wiecej-lepiej', 'mniej-lepiej']
  if (meta.kategoria === 'kontekst') return ['wiecej-lepiej', 'mniej-lepiej']
  return meta.kierunek === 'neutralny'
    ? ['wiecej-lepiej', 'mniej-lepiej', 'optimum']
    : ['wiecej-lepiej', 'mniej-lepiej']
}

export function etykietaKierunku(meta: WskaznikMeta, kierunek: KierunekOceny): string {
  if (meta.id === 'sct_w_strefie' || meta.id === 'spp_podstrefa')
    return kierunek === 'wiecej-lepiej' ? 'W strefie lepiej' : 'Poza strefą lepiej'
  if (meta.id === 'cena_m2_mediana')
    return kierunek === 'wiecej-lepiej' ? 'Drożej lepiej' : 'Taniej lepiej'
  if (meta.id === 'drzewa_100m')
    return kierunek === 'wiecej-lepiej' ? 'Więcej drzew lepiej' : 'Mniej drzew lepiej'
  if (kierunek === 'optimum') return 'Umiarkowanie = lepiej'
  const mniej = kierunek === 'mniej-lepiej'
  if (meta.id.endsWith('_odleglosc')) return mniej ? 'Bliżej lepiej' : 'Dalej lepiej'
  if (meta.id === 'powodz_1proc') return mniej ? 'Płycej lepiej' : 'Głębiej lepiej'
  if (meta.jednostka === 'min' || meta.jednostka === 'h')
    return mniej ? 'Krócej lepiej' : 'Dłużej lepiej'
  return mniej ? 'Mniej = lepiej' : 'Więcej = lepiej'
}
