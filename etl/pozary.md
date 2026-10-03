# Interwencje PSP 2025 – poziom gminy

Uruchom `node etl/pozary.mjs` (Node 24, Python 3). Skrypt pobiera i buforuje roczne
[tabele KG PSP](https://www.gov.pl/web/kgpsp/interwencje-psp), rozpakowuje tabelę
`1_2025.xlsx` bez zewnętrznej biblioteki Pythona i sprawdza TERYT oraz sumę
`pożary + miejscowe zagrożenia + alarmy fałszywe = ogółem` w każdym wierszu.
ZIP pobrany 2026-10-03 ma SHA-256
`c5fd3798d30cc70a9c6d812de5f38e41a2955eca2689cee80da7e01ce2d1ae34`.

Wyniki:

- `wskazniki/pozary_gmina_2025.json` – liczba pożarów w całej gminie,
- `wskazniki/miejscowe_zagrozenia_gmina_2025.json` – liczba miejscowych zagrożeń,
- `pozary_gminy_2025.json` – 14 wierszy gminnych i źródło każdej liczby.

Kategoria wskaźników to `kontekst`, kierunek `neutralny`, rozdzielczość `gmina`.
Powtórzenie wartości przy każdym adresie służy kontraktowi plików, nie oznacza
lokalizacji zdarzenia, indywidualnego ryzyka lub jakości ochrony ppoż. Surowe
liczby nie nadają się do prostego rankingu gmin różnej wielkości. Nie liczymy
rate per capita, bo wymagałby spójnego rocznika liczby mieszkańców i rozstrzygnięcia
dotyczącego ludności faktycznie przebywającej w Krakowie.

## Kontrola Krakowa

Wiersz `126101` tabeli KG PSP 2025 ma 224 pożary i 557 miejscowych zagrożeń.
[Raport o stanie Gminy Kraków 2025, str. 60](https://www.bip.krakow.pl/plik.php?mode=shw&new=t&wer=0&zid=684238)
podaje 2623 pożary w 2025 i 1450 w 2024. Różnica jest zbyt duża, aby scalać
te wartości bez wyjaśnienia definicji lub kompletności danych. Dlatego dla
Krakowa publikujemy 2623 pożary ze źródła BIP, a miejscowe zagrożenia jako
`null`. Trend 1450 → 2623 dotyczy wyłącznie jednego źródła BIP i nie jest
ekstrapolowany na pozostałe gminy. W tabeli KG PSP 2024 Kraków ma 197 pożarów;
to potwierdza trwanie rozbieżności, nie zgodność roczników z BIP. ZIP 2024 ma
te same nagłówki tabeli, ale zawiera co najmniej zdublowany TERYT `060303`
poza naszym obszarem, zatem automatyczne porównanie roczne wymaga dalszego
oczyszczenia danych.

13 gmin podmiejskich ma kompletne wartości z tabeli KG PSP 2025. Dopasowanie
`teryt` adresów (7 cyfr) do `TERYT` PSP (6 cyfr) usuwa wyłącznie siódmą cyfrę
oznaczającą rodzaj gminy; skrypt wymaga zgodności nazwy.

**Atrybucja:** Dane statystyczne KG PSP [źródło: www.gov.pl/kgpsp,
data dostępu: 2026-10-03]. [Licencja CC BY 4.0](https://creativecommons.org/licenses/by/4.0/legalcode.pl).
Przekształcenia: selekcja 14 gmin, walidacja sum, powiązanie TERYT z adresami,
rozdzielenie rodzajów zdarzeń. Dla danych miejskich stosujemy
[warunki BIP Krakowa](https://www.bip.krakow.pl/?dok_id=48482).
