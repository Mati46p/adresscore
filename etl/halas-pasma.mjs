/** Mapa MSIP publikuje przedziały LDWN, nie pomiary dla pojedynczego punktu. */
export function pasmoLdwn(dolna, gorna) {
  if (!Number.isInteger(dolna) || dolna < 50) return null
  if (dolna >= 80) return { wartosc: 80, etykieta: '≥80 dB LDWN (pasmo mapy)' }
  if (!Number.isInteger(gorna) || ![1, 5].includes(gorna - dolna)) return null
  return {
    // Reprezentant przedziału wyłącznie dla istniejącego silnika liczbowego.
    wartosc: (dolna + gorna) / 2,
    etykieta: `${dolna}–${(gorna - 0.1).toFixed(1).replace('.', ',')} dB LDWN (pasmo mapy)`,
  }
}

/** Wspólna krawędź dwóch pasm może dać dwa trafienia; bierzemy wyższe pasmo. */
export function najwyzszePasmo(trafienia) {
  let wynik = null
  for (const trafienie of trafienia) {
    const pasmo = pasmoLdwn(trafienie.isov1, trafienie.isov2)
    if (pasmo && (!wynik || pasmo.wartosc > wynik.wartosc)) wynik = pasmo
  }
  return wynik
}
