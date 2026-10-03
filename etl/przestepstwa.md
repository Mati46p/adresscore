# Przestępstwa stwierdzone – rejon Policji (powiat), 2025

`node etl/przestepstwa.mjs` pobiera z API
[Banku Danych Lokalnych GUS](https://bdl.stat.gov.pl/bdl/start) dane Policji za 2025 r.
dla powiatów Małopolski (poziom 5) i buforuje odpowiedzi w `etl/.cache/`:

| Zmienna BDL | Treść |
| --- | --- |
| [1752907](https://bdl.stat.gov.pl/api/v1/data/by-variable/1752907?unit-parent-id=011200000000&unit-level=5&format=json&lang=pl) | przestępstwa stwierdzone przez Policję na 1000 mieszkańców (P4633) |
| [1749155](https://bdl.stat.gov.pl/api/v1/data/by-variable/1749155?unit-parent-id=011200000000&unit-level=5&format=json&lang=pl) | rok – przestępstwa stwierdzone ogółem (P4601) |
| [1749170](https://bdl.stat.gov.pl/api/v1/data/by-variable/1749170?unit-parent-id=011200000000&unit-level=5&format=json&lang=pl) | rok – wskaźnik wykrywalności sprawców ogółem, % (P4601) |

Stan pobrania 2026-10-03:

| Powiat (jednostka Policji) | Stwierdzone | Na 1000 mieszk. | Wykrywalność | Adresów |
| --- | ---: | ---: | ---: | ---: |
| m. Kraków (KMP) | 18 603 | 22,95 | 60,9% | 70 217 |
| krakowski (KMP) | 2 891 | 9,48 | 65,4% | 69 927 |
| wielicki (KPP Wieliczka) | 1 985 | 13,57 | 75,7% | 33 595 |
| proszowicki (KPP Proszowice) | 307 | 7,34 | 77,6% | 2 945 |

Wyniki:

- `wskazniki/przestepstwa_1000_powiat_2025.json` – kategoria `bezpieczenstwo`, `mniej-lepiej`,
- `wskazniki/wykrywalnosc_powiat_2025.json` – kategoria `kontekst`, `neutralny`,
- `przestepstwa_rejony_2025.json` – wiersze powiatów z URL zmiennych oraz rejony komisariatów Krakowa.

Rozdzielczość `rejon`, **nigdy adres**: ta sama wartość stoi przy każdym adresie powiatu.
Licznik liczy przestępstwa w miejscu popełnienia (także wobec turystów i dojeżdżających),
mianownik to stali mieszkańcy – Kraków jako centrum wypada gorzej niż gminy obwarzanka.
Brak wartości w BDL daje `null`, nie zero.

## Rejony komisariatów KMP Kraków – brak liczb

Przypisanie dzielnic do ośmiu komisariatów pochodzi ze stron KMP Kraków
(„Obsługiwana dzielnica”, np. [KP V](https://krakow.policja.gov.pl/kr1/wolnytekst/1314,Komisariat-Policji-V-w-Krakowie.html)):
KP I – I; KP II – II; KP III – III, IV; KP IV – V, VI, VII; KP V – VIII, IX, XIII;
KP VI – X, XI, XII; KP VII – XV, XVI, XVII; KP VIII – XIV, XVIII. Skrypt sprawdza,
że każdy adres Krakowa trafia do dokładnie jednego komisariatu.

Liczb per komisariat (KMP Kraków, „Informacja o stanie bezpieczeństwa”, 9 kategorii, BIP RMK)
**nie ma**: `bip.krakow.pl` i `bip.malopolska.policja.gov.pl` są niedostępne z ETL, a
statystyka.policja.pl publikuje tylko województwa (do 2021). W pliku rejonów wartości
komisariatów są `null`. Gdy dokument będzie dostępny, wystarczy uzupełnić liczby per
`KP …` i podzielić przez ludność dzielnic danego rejonu (rok i URL dokumentu w pliku).
