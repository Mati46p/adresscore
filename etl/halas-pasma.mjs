// Mapa MSIP publikuje przedziały LDWN, nie pomiary dla pojedynczego punktu.
//
// Dlaczego „poniżej 55 dB” jest wartością, a nie brakiem danych (issue #115): warstwy LDWN dróg
// i torów mają na całym obszarze Krakowa poligony przedziałów, a najniższy z nich to cała reszta
// miasta: ISOV2 = 55, ISOV1 = ujemne minimum obliczeń (np. -24,14). Poligony dróg dają razem
// 326,8 km², czyli powierzchnię Krakowa, a każdy z 70 217 adresów miasta leży w dokładnie jednym
// z nich (sprawdzone 2026-10-03). Adres w najniższym poligonie leży więc w obszarze obliczeń
// i ma poziom poniżej progu mapowania. Wcześniej ETL odrzucał ten poligon (dolna granica < 50),
// więc 39 tys. z 70 tys. adresów miasta dostawało null i szarą kategorię zamiast najlepszej oceny.
//
// Próg to 55, nie 50: 50 dB to próg nocnego LN (warstwy LN mają najniższy poligon z ISOV2 = 50).

/** Dolna granica najniższego opublikowanego pasma LDWN (dB). */
export const PROG_LDWN = 55

/**
 * Największy dopuszczalny udział adresów Krakowa bez żadnego poligonu (luka obliczeń). Mapa
 * pokrywa całe miasto, więc więcej oznacza błąd ETL albo zmianę klasyfikacji w źródle,
 * a nie prawdziwe luki: bieg ETL przerywamy zamiast publikować dziurawy plik.
 */
export const MAX_UDZIAL_LUK = 0.001

/** Skala punktacji warstwy (`meta.zakres`): 50 dB to najlepsza ocena, 80 dB najgorsza. */
export const ZAKRES_LDWN = [50, 80]

/**
 * Wartość dla adresu poniżej progu mapy: dolny kraniec `meta.zakres` warstwy, czyli najlepsza
 * ocena w skali. To reprezentant przedziału „poniżej 55 dB” dla silnika liczbowego, nie pomiar.
 */
export const WARTOSC_PONIZEJ_PROGU = ZAKRES_LDWN[0]

/** Opis wspólny dla etykiety adresu i dla meta warstwy. */
export const ETYKIETA_PONIZEJ_PROGU = `poniżej ${PROG_LDWN} dB LDWN (poza pasmami mapy)`

export function pasmoLdwn(dolna, gorna) {
  if (!Number.isFinite(dolna) || !Number.isFinite(gorna)) return null
  // Najniższy poligon warstwy: górna granica = próg mapy, dolna to minimum obliczeń (nie liczba
  // całkowita). Poligon z inną górną granicą (np. 49–50) nie jest pasmem tej mapy.
  if (gorna === PROG_LDWN && dolna < PROG_LDWN) {
    return { wartosc: WARTOSC_PONIZEJ_PROGU, etykieta: ETYKIETA_PONIZEJ_PROGU, cisza: true }
  }
  if (!Number.isInteger(dolna) || dolna < PROG_LDWN) return null
  if (dolna >= 80) return { wartosc: 80, etykieta: '≥80 dB LDWN (pasmo mapy)' }
  if (!Number.isInteger(gorna) || ![1, 5].includes(gorna - dolna)) return null
  return {
    // Reprezentant przedziału wyłącznie dla istniejącego silnika liczbowego.
    wartosc: (dolna + gorna) / 2,
    etykieta: `${dolna}–${(gorna - 0.1).toFixed(1).replace('.', ',')} dB LDWN (pasmo mapy)`,
  }
}

/**
 * Wiersz złączenia adresu z poligonem → trafienie dla `najwyzszePasmo`. Rzuca, gdy brakuje
 * liczbowych ISOV1/ISOV2 (np. kolumna pod inną nazwą): bez tego warstwa po cichu nic nie wnosi,
 * a wynik wygląda poprawnie, tylko ubogo (tak przepadł przemysł w pierwszym biegu #115).
 */
export function trafienieZWiersza(rekord, zrodlo) {
  const kolumny = Object.keys(rekord).join(', ')
  if (rekord.isov1 == null || rekord.isov2 == null) {
    throw new Error(`Warstwa ${zrodlo}: poligon bez isov1/isov2 (kolumny wiersza: ${kolumny})`)
  }
  const isov1 = Number(rekord.isov1)
  const isov2 = Number(rekord.isov2)
  if (!Number.isFinite(isov1) || !Number.isFinite(isov2)) {
    throw new Error(`Warstwa ${zrodlo}: nieliczbowe isov1/isov2 (kolumny wiersza: ${kolumny})`)
  }
  return { isov1, isov2, zrodlo }
}

/**
 * Wspólna krawędź dwóch pasm i kilka warstw dają kilka trafień; bierzemy wyższe pasmo, przy remisie
 * pierwsze. „Poniżej progu” przegrywa z każdym pasmem od 55 dB. Brak pasma w ogóle (wynik null)
 * znaczy, że żadna warstwa nie pokrywa adresu, czyli faktyczną lukę obliczeń mapy.
 * Opcjonalne `zrodlo` trafienia (np. „drogowy”) wraca w wyniku wygranego pasma.
 */
export function najwyzszePasmo(trafienia) {
  let wynik = null
  for (const trafienie of trafienia) {
    const pasmo = pasmoLdwn(trafienie.isov1, trafienie.isov2)
    if (pasmo && (!wynik || pasmo.wartosc > wynik.wartosc)) {
      wynik = trafienie.zrodlo === undefined ? pasmo : { ...pasmo, zrodlo: trafienie.zrodlo }
    }
  }
  return wynik
}

/** Etykieta adresu na karcie; cisza nie ma źródła hałasu, więc nazwy warstwy nie podajemy. */
export function etykietaAdresu(pasmo) {
  const zrodlo = pasmo.cisza || !pasmo.zrodlo ? '' : `; hałas ${pasmo.zrodlo}`
  return `${pasmo.etykieta}${zrodlo}; 4 m nad terenem`
}
