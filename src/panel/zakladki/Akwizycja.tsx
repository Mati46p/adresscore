// Zakładka „Akwizycja” – ZAŚLEPKA z fazy 5 (fundament panelu). Faza 9 (T056) podmienia WYŁĄCZNIE treść
// tego pliku; reszta panelu (ekran, pasek zakładek, wstęp, odświeżanie) zostaje bez zmian.
//
// Kontrakt zakładki (taki sam dla wszystkich siedmiu):
//  - eksport NAZWANY `Akwizycja` (nazwa pliku) i komponent BEZ propsów: `EkranPanel` ładuje go leniwie
//    (`lazy`) i renderuje tylko wtedy, gdy zakładka jest aktywna;
//  - zakładka sama pobiera dane hookiem `useWidok` z `@/panel/dane` (widoki tej zakładki: kanaly, zrodla, kampanie, kraje, urzadzenia);
//    typy wierszy leżą w `@/panel/typy`, a liczby i procenty liczy `@/panel/arytmetyka`;
//  - wstęp (`WSTEPY`), pasek zakładek i przycisk „Odśwież” rysuje `EkranPanel` – nie powtarzaj ich tu;
//  - układ ze składników `@/panel/skladniki/*` (Sekcja, KartaStat, TabelaTop, Tabela, PasekUdzialow,
//    wykresy, Segmenty, Znacznik) i klas układu z `panel.css` (`panel-stos`, `panel-siatka`, `panel-kolumny`);
//  - brak danych to `null` i szary stan „brak danych”, nigdy 0; filtr okresu (7/30 dni) stoi w jednym
//    rzędzie nad sekcjami zakładki i obejmuje je wszystkie.
//  - pomocnicze moduły: `arytmetyka` (udzialy, procentOd, lejek, zmianaProcentowa, ocenaWitalu, format*),
//    `czas` (dzisWarszawy, ciagDni, etykietaDnia, pelnaDataDnia, opisGodziny), `nazwy` (NAZWA_KANALU,
//    SLOT_KANALU, NAZWA_EKRANU…), `linki` (linkDoSerwisu: tekst z bazy trafia do href WYŁĄCZNIE tędy);
//  - dane z bazy są niezaufane (frazy, ścieżki, komunikaty pochodzą od dowolnego klienta): tylko jako
//    treść React, nigdy dangerouslySetInnerHTML ani surowy href;
//  - React Compiler: żadnych useMemo/useCallback; domyślne propsy przez `??` w ciele funkcji (nie w
//    destrukturyzacji parametrów) i `.finally()` zamiast try/finally, inaczej kompilator pomija komponent
//    (pilnuje tego `konwencje.test.ts`: dla zakładek zgłasza tylko ostrzeżenie).
import { BrakDanych } from '@/panel/skladniki/BrakDanych'

export function Akwizycja() {
  return (
    <BrakDanych
      wariant="blok"
      tekst="w budowie"
      opis="Ta zakładka powstaje w kolejnej fazie panelu."
    />
  )
}
