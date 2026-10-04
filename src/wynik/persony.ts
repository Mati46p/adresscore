// Persony i tryby to dane, nie UI: panel filtrów (#36) i JEV (#4x) wybierają z tej listy,
// a silnik dostaje gotowe wagi. Klucze to id wskaźników z manifestu – nieznane id
// (warstwa jeszcze nie istnieje) po prostu nie wpływa na wynik.
import type { WskaznikMeta } from '../kontrakty/index.ts'
import type { Kierunki, Wagi } from './silnik.ts'

export type PersonaId =
  | 'rodzina'
  | 'singiel'
  | 'senior'
  | 'inwestor'
  | 'student'
  | 'psiarz'
  | 'rowerzysta'
  | 'zdalny'
  | 'aktywny'
  | 'kierowca'
  | 'budowa-domu'
  | 'kultura'
  | 'alergik'
  | 'bezpieczenstwo'
  | 'od-zera'
export type Tryb = 'kupuje' | 'wynajmuje' | 'biznes'

export const BIZNESY = [
  { id: 'sklep', nazwa: 'Sklep spożywczy', konkurencja: 'sklep_odleglosc' },
  { id: 'gastronomia', nazwa: 'Gastronomia', konkurencja: 'gastronomia_odleglosc' },
  { id: 'apteka', nazwa: 'Apteka', konkurencja: 'apteka_odleglosc' },
  { id: 'weterynarz', nazwa: 'Gabinet weterynaryjny', konkurencja: 'weterynarz_odleglosc' },
] as const
export type RodzajBiznesu = (typeof BIZNESY)[number]['id']
export const RODZAJ_BIZNESU_DOMYSLNY: RodzajBiznesu = 'sklep'
export const WARSTWY_BIZNESU = [...BIZNESY.map((b) => b.konkurencja), 'ludnosc_1km'] as const
export function warstwyBiznesu(rodzaj: RodzajBiznesu): readonly string[] {
  return [BIZNESY.find((b) => b.id === rodzaj)?.konkurencja ?? 'sklep_odleglosc', 'ludnosc_1km']
}

export interface Persona {
  id: PersonaId
  nazwa: string
  opis: string
  wagi: Wagi
  /** Kierunek dla warstw neutralnych, które persona chce liczyć (np. pozwolenia na budowę). */
  kierunki?: Kierunki
  /** Waga dla nowych warstw, których profil jeszcze nie uwzględnia. */
  wagaNowych: number
}

// Skala i dowody wag: docs/metoda-wag.md (klucze w nawiasach kwadratowych). 4 = cecha, bez której
// profil traci sens; 3 = ważna, z mocnym dowodem; 2 = istotna; 1 = tło albo warstwa o słabszych
// danych (OSM niepełny, jedna liczba na powiat). Każdy profil mieszkaniowy waży hałas i PM2,5
// co najmniej 1 [WHO-hałas, WHO-powietrze]. Waga trafia wyłącznie na warstwę, którą silnik liczy:
// warstwa neutralna dostaje kierunek w `kierunki`, kontekst nie dostaje wagi (test-strażnik).
export const PERSONY: readonly Persona[] = [
  {
    id: 'rodzina',
    nazwa: 'Rodzina z dziećmi',
    opis: 'Szkoła, przedszkole i żłobek blisko; zieleń, cisza i bezpieczeństwo',
    wagi: {
      sklep_odleglosc: 3,
      apteka_odleglosc: 2,
      przychodnia_odleglosc: 2,
      zlobek_odleglosc: 3,
      przedszkole_odleglosc: 4,
      szkola_podst_odleglosc: 4,
      // Jakość szkoły jest wyceniana w cenach mieszkań [Szkoła]; E8 najbliższej szkoły z danymi,
      // nie szkoły rejonowej – stąd 2, nie więcej.
      szkola_podst_wynik_e8: 2,
      plac_zabaw_odleglosc: 3,
      biblioteka_1200m: 1,
      obnizone_krawezniki_300m: 1,
      przystanek_odleglosc: 3,
      kursy_szczyt_h: 2,
      // Hałas i powietrze szkodzą dzieciom najbardziej [WHO-hałas]; NO2 to spaliny przy ulicy,
      // główna przyczyna astmy dziecięcej z zanieczyszczeń [Astma].
      halas_ldwn: 4,
      pm25_srednia: 3,
      no2_srednia: 2,
      zielen_worldcover_100m: 4,
      zielen_udzial: 1,
      // Dziecko chodzi pieszo do szkoły: wypadki z pieszymi w heksie to ryzyko pod adresem.
      wypadki_piesi_rowerzysci_heks: 2,
      inwestycje_500m: 1,
      powodz_10proc: 3,
      teren_osuwiskowy: 2,
      emitent_odleglosc: 2,
      nfz_kolejki_dni: 1,
    },
    // Budowa obok to hałas i ruch ciężarówek przez lata.
    kierunki: { inwestycje_500m: 'mniej-lepiej' },
    wagaNowych: 0,
  },
  {
    id: 'singiel',
    nazwa: 'Singiel w centrum',
    opis: 'Częste kursy, szybki dojazd i codzienne usługi blisko',
    // Centrum z wyboru: hałas 1 i PM2,5 2 to świadoma zamiana ciszy na dostępność (minimum WHO
    // zostaje). Gastronomia w 1,2 km (1): Walk Score liczy „głębię wyboru” lokali [WalkScore].
    wagi: {
      sklep_odleglosc: 3,
      gastronomia_odleglosc: 2,
      gastronomia_1200m: 1,
      kultura_odleglosc: 2,
      paczkomat_odleglosc: 2,
      przystanek_odleglosc: 4,
      kursy_szczyt_h: 4,
      rynek_czas_min: 4,
      kolej_odleglosc: 2,
      kolej_punktualnosc: 2,
      rower_infrastruktura_odleglosc: 3,
      stojaki_300m: 2,
      halas_ldwn: 1,
      pm25_srednia: 2,
      zielen_worldcover_100m: 1,
      powodz_10proc: 2,
    },
    wagaNowych: 0,
  },
  {
    id: 'senior',
    nazwa: 'Senior',
    opis: 'Przychodnia i apteka blisko, dostępna droga piesza, cisza i transport',
    // Przewodnik WHO po miastach przyjaznych starszym [WHO-senior]: ławki, obniżone krawężniki,
    // bezpieczne przejścia, transport i opieka zdrowotna blisko. Hałas 4: osoby 60+ najczęściej
    // biorą go pod uwagę (82%) [ARC-2025].
    wagi: {
      sklep_odleglosc: 4,
      apteka_odleglosc: 4,
      przychodnia_odleglosc: 4,
      przychodnia_bez_barier_odleglosc: 2,
      cas_odleglosc: 3,
      lawki_300m: 3,
      obnizone_krawezniki_300m: 3,
      nfz_kolejki_dni: 2,
      // Zawał i udar: liczy się czas do SOR i do defibrylatora [AED]. Rejestr AED w OSM jest
      // niepełny – 1.
      sor_odleglosc: 2,
      defibrylator_odleglosc: 1,
      przystanek_odleglosc: 4,
      kursy_szczyt_h: 3,
      // Bezpieczne przejścia to część przewodnika WHO [WHO-senior]; wypadki z pieszymi w heksie
      // to to ryzyko pod adresem.
      wypadki_piesi_rowerzysci_heks: 2,
      halas_ldwn: 4,
      pm25_srednia: 3,
      zielen_worldcover_100m: 2,
      powodz_10proc: 3,
      teren_osuwiskowy: 2,
      oswietlenie_100m: 1,
    },
    kierunki: { defibrylator_odleglosc: 'mniej-lepiej' },
    wagaNowych: 0,
  },
  {
    id: 'inwestor',
    nazwa: 'Inwestor',
    opis: 'Dostępność transportu, pozwolenia na budowę i podstawowe ryzyka',
    // Wagi z literatury cen hedonicznych: dojazd koleją i komunikacją [Kolej], hałas
    // (ok. 0,4–0,6% ceny na 1 dB) [NDI], zieleń [Zieleń-cena], jakość szkoły [Szkoła], strefa
    // zalewowa (−4,6%) [Powódź].
    wagi: {
      sklep_odleglosc: 2,
      przystanek_odleglosc: 3,
      kursy_szczyt_h: 3,
      rynek_czas_min: 3,
      kolej_odleglosc: 2,
      halas_ldwn: 2,
      pm25_srednia: 1,
      zielen_worldcover_100m: 2,
      szkola_podst_wynik_e8: 2,
      inwestycje_500m: 4,
      gmina_inwestycje_pc: 1,
      mpzp_status: 1,
      gmina_dlug_pc: 1,
      powodz_10proc: 4,
      teren_osuwiskowy: 3,
    },
    // Nowe pozwolenia = okolica rośnie, ceny pójdą w górę.
    kierunki: { inwestycje_500m: 'wiecej-lepiej' },
    wagaNowych: 0,
  },
  {
    id: 'student',
    nazwa: 'Student',
    opis: 'Uczelnia i akademik w zasięgu, tani dojazd, życie po zajęciach',
    // Akademik i bary to warstwy neutralne – bez kierunku wagi były martwe. Akademik dostaje
    // „bliżej = lepiej” i zastępuje warstwę uczelni (domy studenckie stoją przy kampusach), jak
    // w potrzebie `student`. Bary wypadły: kierunek profilu wygrywa z potrzebą na tak (#177),
    // więc „student, szukam ciszy” dostałby bary pod oknem. Życie po zajęciach niesie gastronomia
    // w 1,2 km (głębia wyboru lokali) [WalkScore], a bary – potrzeba `zycie_nocne`.
    wagi: {
      akademik_odleglosc: 4,
      przystanek_odleglosc: 4,
      kursy_szczyt_h: 4,
      rynek_czas_min: 3,
      kolej_odleglosc: 2,
      sklep_odleglosc: 3,
      gastronomia_odleglosc: 2,
      gastronomia_1200m: 2,
      biblioteka_1200m: 2,
      kultura_odleglosc: 2,
      paczkomat_odleglosc: 2,
      rower_infrastruktura_odleglosc: 2,
      sport_odleglosc: 1,
      halas_ldwn: 1,
      pm25_srednia: 1,
    },
    kierunki: { akademik_odleglosc: 'mniej-lepiej' },
    wagaNowych: 0,
  },
  {
    id: 'psiarz',
    nazwa: 'Z psem',
    opis: 'Wybieg i zieleń na spacer, weterynarz blisko, spokojna okolica',
    // Wybieg w zasięgu spaceru wiąże się z częstszym spacerem z psem [Pies]; codzienny spacer
    // to zieleń (4). Wybieg i weterynarz to warstwy neutralne – bez kierunku waga była martwa.
    // Oba z OSM, który poza Krakowem zna mało punktów – 3, jak w potrzebie `pies`. Bez ogródków
    // działkowych: to nie zieleń dla wszystkich (#177), a regulaminy ROD zwykle ograniczają psy.
    wagi: {
      wybieg_psy_odleglosc: 3,
      weterynarz_odleglosc: 3,
      zielen_worldcover_100m: 4,
      zielen_udzial: 3,
      drzewa_100m: 2,
      przyroda_chroniona_odleglosc: 2,
      sklep_odleglosc: 2,
      halas_ldwn: 3,
      pm25_srednia: 2,
      oswietlenie_100m: 2,
      przystanek_odleglosc: 2,
      powodz_10proc: 2,
    },
    kierunki: { wybieg_psy_odleglosc: 'mniej-lepiej', weterynarz_odleglosc: 'mniej-lepiej' },
    wagaNowych: 0,
  },
  {
    id: 'rowerzysta',
    nazwa: 'Rowerzysta',
    opis: 'Drogi rowerowe, stojaki i czyste powietrze, auto niepotrzebne',
    // Na jazdę rowerem najmocniej działa spójna, wydzielona sieć i parkingi rowerowe [Rower];
    // główną barierą jest poczucie zagrożenia – stąd wypadki z rowerzystami (3). Główne trasy
    // metropolii (neutralna, z kierunkiem) to tylko 448 km tras – 2, jak w potrzebie `rower`.
    // Liczniki ruchu: 17 sztuk, dane przy 6% adresów – 1.
    wagi: {
      rower_infrastruktura_odleglosc: 4,
      stojaki_300m: 3,
      droga_rowerowa_odleglosc: 2,
      wypadki_piesi_rowerzysci_heks: 3,
      rower_ruch_dobowy: 1,
      drogi_gruntowe_300m: 1,
      pm25_srednia: 3,
      no2_srednia: 3,
      zielen_worldcover_100m: 2,
      kolej_odleglosc: 2,
      przystanek_odleglosc: 2,
      sklep_odleglosc: 2,
      sport_odleglosc: 2,
      halas_ldwn: 2,
    },
    kierunki: { droga_rowerowa_odleglosc: 'mniej-lepiej' },
    wagaNowych: 0,
  },
  {
    id: 'zdalny',
    nazwa: 'Praca zdalna',
    opis: 'Cisza w dzień, światło i zieleń, wszystko na co dzień w zasięgu spaceru',
    // Cały dzień w domu: cisza (4), światło dzienne w pokoju do pracy [Światło-dzienne], zieleń
    // na przerwę. Piekarnia i poczta (odległość) to warstwy kontekstu – silnik ich nie liczy,
    // więc wagi były martwe; poczta wraca jako punkt w 1,2 km, a zieleń dostaje udział (jak
    // w potrzebie `praca_zdalna`).
    wagi: {
      halas_ldwn: 4,
      slonce_grudzien_h: 3,
      zielen_worldcover_100m: 3,
      zielen_udzial: 2,
      drzewa_100m: 2,
      pm25_srednia: 3,
      sklep_odleglosc: 3,
      gastronomia_odleglosc: 2,
      paczkomat_odleglosc: 3,
      poczta_1200m: 1,
      stacje_bazowe_300m: 2,
      sport_odleglosc: 2,
      kolej_odleglosc: 1,
      przystanek_odleglosc: 1,
    },
    wagaNowych: 0,
  },
  {
    id: 'aktywny',
    nazwa: 'Aktywny',
    opis: 'Obiekty sportowe, siłownie plenerowe, kąpieliska i tereny do biegania',
    // Parki i miejsca do ruchu blisko domu wiążą się z większą aktywnością fizyczną [Aktywność].
    // Główne trasy rowerowe (neutralna) dostają kierunek – bez niego waga była martwa; 2, bo to
    // tylko trasy metropolii, a całą sieć niesie infrastruktura rowerowa (2, jak potrzeba `sport`).
    wagi: {
      sport_odleglosc: 4,
      silownia_plenerowa_odleglosc: 4,
      kapielisko_odleglosc: 3,
      zielen_worldcover_100m: 4,
      przyroda_chroniona_odleglosc: 3,
      droga_rowerowa_odleglosc: 2,
      rower_infrastruktura_odleglosc: 2,
      pitnik_odleglosc: 1,
      pm25_srednia: 3,
      pm10_srednia: 2,
      halas_ldwn: 2,
      sklep_odleglosc: 2,
      przystanek_odleglosc: 2,
    },
    kierunki: { droga_rowerowa_odleglosc: 'mniej-lepiej' },
    wagaNowych: 0,
  },
  {
    id: 'kierowca',
    nazwa: 'Kierowca',
    opis: 'Utwardzony dojazd, ładowarka EV i szybki wyjazd z miasta, bez strefy płatnego parkowania',
    // Parkowanie ceni 70% kupujących [ARC-2025] – strefa płatnego parkowania 3. Ładowarka EV 2:
    // dotyczy tylko aut elektrycznych. SCT 1: wjazd zależy od pojazdu, którego nie znamy
    // (potrzeba `auto` pomija ją z tego powodu).
    wagi: {
      dojazd_utwardzony: 4,
      drogi_gruntowe_300m: 3,
      ladowarka_ev_odleglosc: 2,
      spp_podstrefa: 3,
      sct_w_strefie: 1,
      lotnisko_czas_min: 2,
      sklep_odleglosc: 2,
      halas_ldwn: 2,
      pm25_srednia: 1,
      zielen_worldcover_100m: 2,
      powodz_10proc: 3,
      osuwisko_odleglosc: 1,
    },
    // Strefa płatnego parkowania i strefa czystego transportu utrudniają życie z autem.
    kierunki: { spp_podstrefa: 'mniej-lepiej', sct_w_strefie: 'mniej-lepiej' },
    wagaNowych: 0,
  },
  {
    id: 'budowa-domu',
    nazwa: 'Budowa domu',
    opis: 'Uzbrojenie terenu, plan miejscowy i niskie ryzyka gruntowe',
    // Dom stawia się na dekady: strefa zalewowa obniża wartość [Powódź], a hałas i PM2,5 to
    // minimum WHO dla każdego, kto tam zamieszka.
    wagi: {
      uzbrojenie_prad_50m: 4,
      uzbrojenie_woda_50m: 4,
      uzbrojenie_kanalizacja_50m: 3,
      uzbrojenie_gaz_50m: 2,
      dojazd_utwardzony: 3,
      mpzp_status: 3,
      gmina_mpzp_pokrycie_pct: 1,
      powodz_10proc: 4,
      teren_osuwiskowy: 4,
      osiadanie_mm_rok: 2,
      szkola_podst_odleglosc: 2,
      sklep_odleglosc: 2,
      zielen_worldcover_100m: 2,
      halas_ldwn: 1,
      pm25_srednia: 1,
    },
    wagaNowych: 0,
  },
  {
    id: 'kultura',
    nazwa: 'Miłośnik kultury',
    opis: 'Teatry, muzea, zabytki, biblioteki i dobra kuchnia w zasięgu spaceru',
    wagi: {
      kultura_odleglosc: 4,
      zabytki_300m: 3,
      zabytki_rejestr_500m: 3,
      biblioteka_1200m: 3,
      gastronomia_1200m: 3,
      gastronomia_odleglosc: 2,
      imprezy_stale_wpisy_500m_2026: 2,
      przystanek_odleglosc: 3,
      kursy_szczyt_h: 3,
      rynek_czas_min: 3,
      sklep_odleglosc: 2,
      halas_ldwn: 1,
      pm25_srednia: 1,
    },
    // Dla miłośnika kultury wydarzenia obok to zaleta, nie hałas.
    kierunki: { imprezy_stale_wpisy_500m_2026: 'wiecej-lepiej' },
    wagaNowych: 0,
  },
  {
    id: 'alergik',
    nazwa: 'Alergik i astmatyk',
    opis: 'Czyste powietrze, mało palenisk, dobre przewietrzanie i przychodnia blisko',
    // PM2,5 i PM10 (4), NO2 (3) – normy WHO [WHO-powietrze], NO2 a astma [Astma]. Zieleń tylko 1:
    // pyłki drzew, a badania zieleni przy domu a alergii dróg oddechowych dają wyniki
    // niespójne [Zieleń-alergia]. Hałas 1 – minimum WHO.
    wagi: {
      pm25_srednia: 4,
      pm10_srednia: 4,
      no2_srednia: 3,
      bap_srednia: 3,
      paleniska_200m: 3,
      przewietrzanie_klasa: 3,
      emitent_odleglosc: 3,
      azbest_budynki_100m: 2,
      przychodnia_odleglosc: 3,
      apteka_odleglosc: 3,
      zielen_worldcover_100m: 1,
      sklep_odleglosc: 2,
      halas_ldwn: 1,
    },
    wagaNowych: 0,
  },
  {
    id: 'bezpieczenstwo',
    nazwa: 'Bezpieczeństwo przede wszystkim',
    opis: 'Policja, straż i SOR blisko, oświetlone ulice, mało przestępstw i zagrożeń',
    // Przestępstwa i wykrywalność to jedna liczba na powiat (cały Kraków ma tę samą) – 2 i 1,
    // żeby nie przykrywały ryzyk w punkcie adresu: wypadków w heksie (3), powodzi, osuwiska,
    // Seveso. Latarnie: lepsze oświetlenie ulic zmniejsza przestępczość [Oświetlenie], ale mapa
    // latarni w OSM jest niepełna – 3. Defibrylator (neutralny, z kierunkiem) [AED].
    // Punkt schronienia: czas dojścia pieszo zamiast odległości w linii prostej.
    wagi: {
      przestepstwa_1000_powiat_2025: 2,
      wykrywalnosc_powiat_2025: 1,
      wypadki_heks: 3,
      policja_odleglosc: 3,
      straz_pozarna_odleglosc: 3,
      sor_odleglosc: 3,
      defibrylator_odleglosc: 2,
      oswietlenie_100m: 3,
      seveso_odleglosc: 3,
      powodz_10proc: 4,
      teren_osuwiskowy: 2,
      punkt_schronienia_pieszo_min: 1,
      sklep_odleglosc: 2,
      halas_ldwn: 1,
      pm25_srednia: 1,
    },
    kierunki: { defibrylator_odleglosc: 'mniej-lepiej' },
    wagaNowych: 0,
  },
  {
    id: 'od-zera',
    nazwa: 'Od zera',
    opis: 'Wszystkie wagi na 0 – ustaw sam',
    wagi: {},
    wagaNowych: 0,
  },
]

export const PERSONA_DOMYSLNA: PersonaId = 'rodzina'
export const TRYB_DOMYSLNY: Tryb = 'kupuje'

export const TRYBY: readonly { id: Tryb; nazwa: string; opis: string }[] = [
  { id: 'kupuje', nazwa: 'Kupuję', opis: 'Na lata: liczy się bezpieczeństwo i ryzyko' },
  { id: 'wynajmuje', nazwa: 'Wynajmuję', opis: 'Na teraz: liczy się dojazd i codzienność' },
  {
    id: 'biznes',
    nazwa: 'Miejsca do założenia biznesu',
    opis: 'Wybierz rodzaj usług: konkurencja i liczba mieszkańców',
  },
]

// Kupujący zostaje na dekady, więc mocniej waży to, co się zmieni i co może zalać mieszkanie.
// Najemca może się wyprowadzić – waży bieżący dojazd. Zmiana działa tylko na wagi > 0,
// żeby „Od zera" zostało puste.
export const MODYFIKATORY_TRYBU: Readonly<
  Record<Tryb, Partial<Record<WskaznikMeta['kategoria'], number>>>
> = {
  kupuje: { bezpieczenstwo: 1 },
  wynajmuje: { transport: 1 },
  biznes: {},
}

export function znajdzPersone(id: string | null | undefined): Persona | undefined {
  return PERSONY.find((p) => p.id === id)
}

/**
 * Wagi i kierunki persony dopasowane do żywych warstw z manifestu.
 * Profile mieszkaniowe dają kontekstowi 0; biznes jawnie ocenia ludność NSP 2021.
 */
export function ustawieniaPersony(
  personaId: PersonaId,
  tryb: Tryb,
  wskazniki: readonly (Pick<WskaznikMeta, 'id' | 'kategoria'> &
    Partial<Pick<WskaznikMeta, 'atrapa' | 'domyslnaWaga'>>)[],
  rodzajBiznesu: RodzajBiznesu = RODZAJ_BIZNESU_DOMYSLNY,
): { wagi: Record<string, number>; kierunki: Kierunki } {
  if (tryb === 'biznes') {
    const rzeczywiste = new Set(wskazniki.filter((w) => !w.atrapa).map((w) => w.id))
    const wagi = Object.fromEntries(wskazniki.map((w) => [w.id, 0]))
    const kierunki: Record<string, Kierunki[string]> = {}
    for (const id of warstwyBiznesu(rodzajBiznesu)) {
      if (!rzeczywiste.has(id)) continue
      wagi[id] = 4
      kierunki[id] = 'wiecej-lepiej'
    }
    return { wagi, kierunki }
  }
  const persona = znajdzPersone(personaId) ?? (PERSONY[0] as Persona)
  const wagi: Record<string, number> = {}
  const kierunki: Record<string, Kierunki[string]> = {}
  for (const { id, kategoria, domyslnaWaga } of wskazniki) {
    if (kategoria === 'kontekst') {
      wagi[id] = 0
      continue
    }
    // „Od zera” obiecuje same zera, więc domyślna waga nowej warstwy jej nie dotyczy.
    const domyslna = persona.id === 'od-zera' ? undefined : domyslnaWaga
    let w = persona.wagi[id] ?? domyslna ?? persona.wagaNowych
    if (w > 0) w = Math.min(Math.max(w + (MODYFIKATORY_TRYBU[tryb][kategoria] ?? 0), 1), 4)
    wagi[id] = w
    const k = persona.kierunki?.[id]
    if (k) kierunki[id] = k
  }
  return { wagi, kierunki }
}
