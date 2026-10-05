// Przełącznik „Pomiar ruchu” na stronie Metody (T064): co i w jakiej kolejności dzieje się po
// kliknięciu. Czysta logika bez Reacta i DOM, bo kolejność ma być pod testem, a w komponencie
// byłaby nietestowalna (testy chodzą bez DOM). Komponent `Metoda.tsx` podaje prawdziwe akcje,
// test – atrapy i prawdziwy rdzeń pomiaru.
//
// WYŁĄCZENIE (sprzeciw): NAJPIERW jedno zdarzenie `pomiar_wylaczony`, DOPIERO POTEM zapis wyboru.
// Odwrotnie zdarzenie przepadłoby, bo po zapisie kolejka pomiaru wyrzuca wszystko, co ma w buforze.
// Samo zdarzenie nie czeka na 5-sekundową bezczynność kolejki: rdzeń wysyła je od razu
// (`natychmiast` w `rdzen.ts`), razem z tym, co leżało w buforze przed sprzeciwem.
//
// WŁĄCZENIE: tylko zapis wyboru. Nic nie wysyłamy – do tej chwili pomiar milczał, a odsłona
// otworzy się przy najbliższej zmianie ekranu.
//
// GLOBAL PRIVACY CONTROL: sygnał przeglądarki wyłącza pomiar niezależnie od wyboru (`zgoda.ts`),
// więc przełącznik nie zmienia wtedy niczego – ani zdarzenia, ani zapisu.

export interface AkcjePomiaru {
  /** Zdarzenie produktowe `pomiar_wylaczony` (wychodzi od razu). */
  produktowe: (nazwa: 'pomiar_wylaczony') => void
  /** Zapis wyboru: `false` = pomiar wyłączony. */
  ustawPomiar: (wlaczony: boolean) => void
}

/**
 * @param wylaczony pomiar jest teraz wyłączony (wybór użytkownika albo sygnał przeglądarki)
 * @param przezGpc  przeglądarka wysyła Global Privacy Control
 */
export function przelaczPomiar(wylaczony: boolean, przezGpc: boolean, akcje: AkcjePomiaru): void {
  if (przezGpc) return
  if (wylaczony) {
    akcje.ustawPomiar(true)
    return
  }
  akcje.produktowe('pomiar_wylaczony')
  akcje.ustawPomiar(false)
}
