// Czytelne nazwy sekcji ekranów (wartości atrybutu `data-sekcja`) dla panelu admina.
//
// Klucze nadaje się w plikach ekranów (`data-sekcja="…"`, wzorzec `^[a-z0-9_-]{1,48}$`), a TUTAJ
// dopisuje się ich nazwy. Test `sekcje-nazwy.test.ts` pilnuje obu kierunków: każdy klucz użyty
// w ekranie ma nazwę, a każda nazwa ma klucz użyty w ekranie – lista nie rozjeżdża się po cichu.
//
// Moduł bez DOM i bez importów: czyta go wyłącznie panel (leniwy chunk) i test, więc nie wchodzi
// do głównej paczki. Nieznany klucz (np. sekcja dodana w ekranie, zanim ktoś dopisał nazwę) wraca
// sam, zamiast zniknąć: sekcja, której panel nie zna, musi być w nim widoczna.

/**
 * Klucz sekcji → nazwa po polsku, w postaci „Ekran: sekcja”. Nazwy ekranów jak w panelu
 * (`NAZWA_EKRANU` w `src/panel/nazwy.ts`): Szukaj, Karta adresu, Porównanie, Dla biznesu.
 * Klucze są unikalne w całej aplikacji (nie tylko w obrębie ekranu), więc nazwa jednoznacznie
 * wskazuje blok, także w zestawieniu, które miesza ekrany. Dopisujesz tu klucz razem z atrybutem
 * w ekranie; test pilnuje obu stron.
 */
export const NAZWY_SEKCJI: Readonly<Record<string, string>> = {
  // Karta adresu (src/karta/okolica, src/karta/CoByToZmienilo.tsx)
  etykieta: 'Karta adresu: wynik i etykieta',
  'wybor-trybu': 'Karta adresu: wybór trybu oceny',
  kategorie: 'Karta adresu: oceny kategorii',
  dlaczego: 'Karta adresu: dlaczego taki wynik',
  'co-by-to-zmienilo': 'Karta adresu: co by to zmieniło',
  'lepszy-sasiad': 'Karta adresu: lepszy sąsiad',
  mapa: 'Karta adresu: okolica w 3D',
  zrodla: 'Karta adresu: rozbicie na warstwy i źródła',
  'dodatkowe-dane': 'Karta adresu: dodatkowe dane o okolicy',

  // Szukaj (src/karta/EkranSzukaj.tsx)
  wyszukiwarka: 'Szukaj: wyszukiwarka okolic',
  'szukaj-mapa': 'Szukaj: mapa i warstwy',
  'szukaj-filtry': 'Szukaj: profil i filtry',

  // Porównanie (src/karta/porownanie/EkranPorownanie.tsx)
  'porownanie-naglowek': 'Porównanie: nagłówek i kopiowanie linku',
  'porownanie-dodaj': 'Porównanie: dodawanie adresu',
  'porownanie-lista': 'Porównanie: wybrane adresy',
  'porownanie-wykres': 'Porównanie: wykres radarowy',
  'porownanie-tabela': 'Porównanie: tabela atrybutów',
  'porownanie-ranking': 'Porównanie: dopasowanie do Ciebie',
  'porownanie-werdykt': 'Porównanie: werdykt',

  // Dla biznesu (src/karta/biznes/EkranBiznes.tsx)
  'biznes-mapa': 'Dla biznesu: mapa i miejsca testowe',
  'biznes-formularz': 'Dla biznesu: branża, filtry i współrzędne',
  'biznes-oceny': 'Dla biznesu: oceny miejsc',
  'biznes-zrodla': 'Dla biznesu: źródła danych',
}

/** Nazwa sekcji z mapy albo sam klucz, gdy mapa go nie zna. */
export function nazwaSekcji(klucz: string): string {
  return Object.hasOwn(NAZWY_SEKCJI, klucz) ? (NAZWY_SEKCJI[klucz] ?? klucz) : klucz
}
