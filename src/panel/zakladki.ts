// Zakładki panelu: lista, tytuły i wstępy. Siedem zakładek (spec FR-030–FR-036): Przegląd,
// Akwizycja, Sesje, Zaangażowanie, CTA, Treść i Jakość. Wzorzec z z-dykty bez Gmin, Czytelników,
// Redakcji i Reklam – tych pytań serwis adresscore nie stawia.

export type IdZakladki =
  | 'przeglad'
  | 'akwizycja'
  | 'sesje'
  | 'zaangazowanie'
  | 'cta'
  | 'tresc'
  | 'jakosc'

export interface OpisZakladki {
  id: IdZakladki
  etykieta: string
  /** Doprecyzowanie dla czytników ekranu i podpowiedzi przy najechaniu. */
  tytul: string
}

export const ZAKLADKI: readonly OpisZakladki[] = [
  {
    id: 'przeglad',
    etykieta: 'Przegląd',
    tytul: 'Czy serwis żyje: ruch, godziny szczytu, ludzie i roboty',
  },
  {
    id: 'akwizycja',
    etykieta: 'Akwizycja',
    tytul: 'Skąd przychodzą: kanały, źródła, kraje, urządzenia',
  },
  {
    id: 'sesje',
    etykieta: 'Sesje',
    tytul: 'Co dzieje się w jednej wizycie: strony, czas, przejścia',
  },
  {
    id: 'zaangazowanie',
    etykieta: 'Zaangażowanie',
    tytul: 'Ścieżki, sekcje ekranów, punkt urwania',
  },
  { id: 'cta', etykieta: 'CTA', tytul: 'Co klikają, martwe przyciski, sygnały frustracji' },
  { id: 'tresc', etykieta: 'Treść', tytul: 'Top ekrany i adresy, wyszukiwania bez wyniku, lejek' },
  { id: 'jakosc', etykieta: 'Jakość', tytul: 'Web Vitals, błędy klienta, zdrowie pomiaru' },
]

/** Zakładka otwierana po wejściu na panel. */
export const ZAKLADKA_DOMYSLNA: IdZakladki = 'przeglad'

/**
 * Jedno zdanie na zakładkę (FR-037): na jakie PYTANIE odpowiada i czego tu świadomie NIE MA.
 * Etykieta zakładki mieści jedno słowo, więc mówi tylko, jak sekcja się nazywa; bez wstępu nikt nie
 * wie, czym „Zaangażowanie” różni się od „CTA”, a zgadywanie kończy się wnioskiem z niewłaściwej
 * liczby. Druga połowa zdania uprzedza szukanie danych, których pomiar z założenia nie zbiera.
 */
export const WSTEPY: Readonly<Record<IdZakladki, string>> = {
  przeglad:
    'Czy serwis żyje: ilu ludzi wchodzi, o jakich godzinach i ile z ruchu to roboty – bez rozbicia na źródła i bez zachowania w wizycie, bo to w kolejnych zakładkach.',
  akwizycja:
    'Skąd przychodzą wizyty: kanały, źródła, kampanie, kraje i urządzenia – bez tego, co ludzie robią po wejściu, i bez adresów IP, których nie zbieramy.',
  sesje:
    'Co dzieje się w obrębie jednej wizyty: ile ekranów, jak długo i dokąd dalej – bez powracających osób, bo bez trwałego identyfikatora nie da się ich rozpoznać, a czasy są podłogą.',
  zaangazowanie:
    'Którędy ludzie chodzą po serwisie i gdzie kończą: najczęstsze ścieżki, czas w sekcjach, punkt urwania – bez nagrań sesji i bez tego, co wpisują.',
  cta: 'Które przyciski zamieniają wyświetlenie w kliknięcie, a które są martwe albo frustrują – bez wyniku biznesowego kliknięcia, który zobaczysz dopiero w lejku w zakładce Treść.',
  tresc:
    'Co ludzie oglądają i czego nie znaleźli: top ekrany i adresy, wyszukiwania bez wyniku, lejek od wyszukania do karty – bez fraz z danymi osobowymi, które nigdy się nie zapisują.',
  jakosc:
    'Czy strona jest szybka, czy się nie psuje i czy sam pomiar działa – gdy któraś zakładka świeci pustką, sprawdź najpierw diagnostykę pomiaru tutaj.',
}

export function jestZakladka(id: string): id is IdZakladki {
  return ZAKLADKI.some((z) => z.id === id)
}
