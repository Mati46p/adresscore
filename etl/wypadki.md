# Wypadki drogowe – wszystkie oraz piesi i rowerzyści (SEWIK 2018–2024, #69)

`node etl/wypadki.mjs <zrzut SEWIK XML: plik albo katalog z plikami .xml>` zapisuje dwa wskaźniki:

| Wskaźnik | Co mierzy | Rozdzielczość | Kierunek |
|---|---|---|---|
| `wypadki_heks` | średnia roczna suma wag wszystkich zdarzeń w heksie | heks H3 r8 | mniej = lepiej |
| `wypadki_piesi_rowerzysci_heks` | to samo, tylko zdarzenia z pieszym lub rowerem | heks H3 r8 | mniej = lepiej |

Kategoria `bezpieczenstwo`. Adres dostaje wartość heksu r8 (rodzic swojego heksu r10). Heks z adresami
bez żadnego zdarzenia ma 0 – SEWIK obejmuje cały kraj, więc to pomiar, nie brak danych. Bez zrzutu skrypt
nie zapisuje nic (warstwa pozostaje nieobecna = szara).

## Źródło

Zrzut SEWIK (Komenda Główna Policji) ze strony [sewik.pl](https://sewik.pl): XML 2018–2025
(`fixed-sewik-xml-(2018-25).tar.xz`, 480 MB spakowany) lub zrzut SQL. Rozpakuj do `etl/.cache/sewik/`,
uruchom skrypt i usuń surowe pliki – nie commitujemy ich. Parser czyta plik strumieniowo
(bloki `<ZDARZENIE>`), więc pamięć nie zależy od rozmiaru zrzutu.

**Atrybucja (obowiązkowa):** „Źródło: Polskie Obserwatorium Bezpieczeństwa Ruchu Drogowego, Instytut
Transportu Samochodowego (ITS), na podstawie SEWIK KGP”. Jest w `zrodla[]` obu wskaźników; karta musi ją
pokazywać.

## Jak liczymy

- Lata 2018–2024 (data zdarzenia), średnia roczna = suma / 7.
- Obszar: heksy r8, w których są adresy projektu (Kraków + obwarzanek). Filtr przestrzenny zamiast
  pola `POWIAT`, bo jest odporny na pisownię i obejmuje obwarzanek bez listy powiatów.
- Waga zdarzenia: 1 + 10 × zabici (na miejscu i do 30 dni) + 4 × ciężko ranni + 1 × lekko ranni.
- Piesi i rowerzyści: uczestnik rodzaju „pieszy” albo pojazd „rower”.
- Zdarzenia bez GPS są pomijane i liczone w logu (`bezGps`). Geokodowanie po ulicy – nie zrobione
  (opcjonalne w zadaniu).

## Założenia do sprawdzenia na pełnym zrzucie

Pobranie zrzutu z kontenera agenta zostało zablokowane, więc importer jest sprawdzony tylko na fixture
(`etl/wypadki.test.mjs`). Nazwy pól przyjęte za zrzutem SEWIK, z wariantami: `DATA_ZDARZ`,
`WSP_GPS_X`/`WSP_GPS_Y` (przecinek lub kropka; zamienione osie są prostowane), `ULICA_ADRES`,
bloki `POJAZD` (`RODZAJ_POJAZDU`/`SRPO_KOD`) i `UCZESTNIK` (`SRUZ_KOD`: `P`/`I` = pieszy;
`STUC_KOD`/`SSRU_KOD`: `Z`, `ZM` zabity, `RC` ciężko, `RL` lekko). Jeżeli zrzut ma inne nazwy,
popraw je w `zdarzenie()` – log `SEWIK: {…}` pokazuje ile zdarzeń trafiło do obszaru, a przy zerze skrypt
kończy się błędem.
