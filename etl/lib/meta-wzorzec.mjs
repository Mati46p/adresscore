// Jedno źródło prawdy dla meta warstw wspólnych dla Krakowa i wszystkich miast (#232).
// Kraków jest wzorcem: kategoria, kierunek oceny, domyślna waga i lista id są takie same w każdym
// katalogu miasta. Zakres, opis, źródła i rozmiar zostają lokalne (zależą od danych miasta).
// Używa tego etl/uprosc-kryteria.mjs (krok integracji po ETL; w trybie miasta: ADRESCORE_MIASTO=<slug>)
// oraz test etl/meta-wzorzec.test.mjs, który porównuje meta każdego miasta z Krakowem.

// Stare fakty bez jednej kategorii otrzymują grupę tematyczną i kierunek domyślny.
// Waga startowa 0 zachowuje decyzję użytkownika: po ustawieniu 1–4 każdy z nich liczy się
// jak zwykła warstwa. Kierunek można odwrócić, szczególnie przy wyborach i demografii.
// Przegląd merytoryczny (#232): żaden kierunek z Krakowa nie jest błędny, więc miasta dostają
// kierunki krakowskie bez zmian. Warstwy 'neutralny'/'kontekst' z surowego ETL (np. ludnosc_1km)
// wypadały z liczenia w miastach, a w Krakowie liczą się po włączeniu wagi.
export const PRZENIESIONE = {
  bo_projekty_1km: ['spolecznosc', 'wiecej-lepiej'],
  cena_m2_mediana: ['spolecznosc', 'mniej-lepiej'],
  drzewa_100m: ['spokoj', 'wiecej-lepiej'],
  frekwencja_samorzad_2024: ['spolecznosc', 'wiecej-lepiej'],
  gestosc_zaludnienia_100m: ['spolecznosc', 'wiecej-lepiej'],
  gmina_czyste_powietrze_wnioski_100_domow: ['spokoj', 'wiecej-lepiej'],
  gmina_dlug_pc: ['spolecznosc', 'mniej-lepiej'],
  gmina_inwestycje_pc: ['spolecznosc', 'wiecej-lepiej'],
  gmina_koszty_stale_rok: ['spolecznosc', 'mniej-lepiej'],
  gmina_mpzp_pokrycie_pct: ['spolecznosc', 'wiecej-lepiej'],
  gmina_pit_na_mieszkanca: ['spolecznosc', 'wiecej-lepiej'],
  imprezy_obiekty_dni_500m_2025_26: ['spokoj', 'mniej-lepiej'],
  imprezy_stale_wpisy_500m_2026: ['spokoj', 'mniej-lepiej'],
  inwestycje_500m: ['spolecznosc', 'wiecej-lepiej'],
  kapielisko_odleglosc: ['spokoj', 'mniej-lepiej'],
  ladowarka_ev_odleglosc: ['transport', 'mniej-lepiej'],
  ludnosc_1km: ['spolecznosc', 'wiecej-lepiej'],
  miejscowe_zagrozenia_gmina_2025: ['bezpieczenstwo', 'mniej-lepiej'],
  mpzp_status: ['spolecznosc', 'wiecej-lepiej'],
  nfz_kolejki_dni: ['codziennosc', 'mniej-lepiej'],
  obszar_rewitalizacji: ['spolecznosc', 'wiecej-lepiej'],
  osiadanie_mm_rok: ['bezpieczenstwo', 'wiecej-lepiej'],
  oswietlenie_100m: ['bezpieczenstwo', 'wiecej-lepiej'],
  powiat_wynagrodzenie_brutto: ['spolecznosc', 'wiecej-lepiej'],
  pozary_gmina_2025: ['bezpieczenstwo', 'mniej-lepiej'],
  przestepstwa_1000_powiat_2025: ['bezpieczenstwo', 'mniej-lepiej'],
  przetargi_dzielnica: ['spolecznosc', 'wiecej-lepiej'],
  punkt_schronienia_odleglosc: ['bezpieczenstwo', 'mniej-lepiej'],
  sejm2023_lista_1: ['spolecznosc', 'wiecej-lepiej'],
  sejm2023_lista_2: ['spolecznosc', 'wiecej-lepiej'],
  sejm2023_lista_3: ['spolecznosc', 'wiecej-lepiej'],
  sejm2023_lista_4: ['spolecznosc', 'wiecej-lepiej'],
  sejm2023_lista_5: ['spolecznosc', 'wiecej-lepiej'],
  sejm2023_lista_6: ['spolecznosc', 'wiecej-lepiej'],
  sejm2023_lista_7: ['spolecznosc', 'wiecej-lepiej'],
  // Lista nr 8 występuje tylko w części miast (Białystok, Lublin, Szczecin); w Krakowie jej nie ma.
  sejm2023_lista_8: ['spolecznosc', 'wiecej-lepiej'],
  siec_cieplownicza_odleglosc: ['codziennosc', 'mniej-lepiej'],
  stacje_bazowe_300m: ['codziennosc', 'wiecej-lepiej'],
  szkola_podst_wynik_e8: ['codziennosc', 'wiecej-lepiej'],
  udzial_0_14: ['spolecznosc', 'wiecej-lepiej'],
  udzial_65plus: ['spolecznosc', 'wiecej-lepiej'],
  woda_odleglosc: ['spokoj', 'mniej-lepiej'],
  wykrywalnosc_powiat_2025: ['bezpieczenstwo', 'wiecej-lepiej'],
  zabytki_300m: ['spolecznosc', 'wiecej-lepiej'],
  zabytki_rejestr_500m: ['spolecznosc', 'wiecej-lepiej'],
}

// Id, których wzorzec (Kraków) nie ma: zastąpione innymi warstwami albo zdublowane.
export const USUWANE = [
  'bankomat_poczta_odleglosc',
  'gmina_powodz_powierzchnia_pct',
  'powodz_1proc',
  'powodz_02proc',
]

// Pola meta, które muszą być identyczne w Krakowie i w każdym mieście dla tego samego id.
export const POLA_WZORCA = ['kategoria', 'kierunek', 'domyslnaWaga', 'jednostka']

/** Nakłada na meta kategorię, kierunek i wagę wzorca (jeśli id jest we wzorcu). */
export function zastosujWzorzec(meta) {
  const w = PRZENIESIONE[meta.id]
  if (!w) return meta
  return { ...meta, kategoria: w[0], kierunek: w[1], domyslnaWaga: 0 }
}

// Warstwy, które mogą istnieć wyłącznie w miastach (lokalne źródło, brak odpowiednika w Krakowie).
// Każdy inny id spoza wzorca to błąd spójności: dodaj go do Krakowa albo zmapuj na id krakowskie.
export const TYLKO_W_MIASTACH = {
  sejm2023_lista_8: 'lista wyborcza nr 8 jest tylko w części okręgów (Białystok, Lublin, Szczecin)',
  boisko_otwarte_odleglosc: 'Warszawa: API dane.um.warszawa.pl (#677a735)',
  defibrylator_um_odleglosc: 'Warszawa: API dane.um.warszawa.pl',
  ekopunkt_odleglosc: 'Warszawa: API dane.um.warszawa.pl',
  toaleta_publiczna_odleglosc: 'Warszawa: API dane.um.warszawa.pl',
}

// Warstwy, których brak nie jest błędem także w Krakowie (nie istnieją tam, tylko w części miast).
export const OPCJONALNE = ['sejm2023_lista_8']
