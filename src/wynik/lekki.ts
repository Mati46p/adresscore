// Lekki tryb dla telefonu i oszczędzania danych (#34): jury skanuje QR i patrzy przez 4G.
// Czysta funkcja bez Reacta, żeby mapa (#19) mogła z niej wziąć np. rezygnację z 3D.

/** Szerokość, poniżej której układ ekranu Szukaj przechodzi w jedną kolumnę (styles.css). */
export const SZEROKOSC_TELEFONU = 860

/** true na wąskim ekranie albo przy włączonym oszczędzaniu danych (`Save-Data`). */
export function trybLekki(): boolean {
  if (typeof window === 'undefined') return false
  const polaczenie = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection
  if (polaczenie?.saveData) return true
  return window.matchMedia?.(`(max-width: ${SZEROKOSC_TELEFONU}px)`).matches ?? false
}
