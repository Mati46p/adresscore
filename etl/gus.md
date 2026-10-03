# NSP 2021 – siatka ludności 1 km²

Importer `node etl/gus.mjs` pobiera oficjalny pakiet Polski
[`PL_PD_3035_CSV.zip`](https://gisco-services.ec.europa.eu/census/2021/INSPIRE/Data/PL_PD_3035_CSV.zip)
z siatki spisowej 2021 Eurostatu (dane przekazane przez GUS). Pakiet pobrany
2026-10-03 ma SHA-256
`c1c76e2f3ddb66bdabaa43b281546dca21bd4b5ba79c657c77b01a79804b2801`;
wewnętrzny CSV pochodzi z lipca 2024 r. Metadane pakietu wskazują Statistics
Poland jako wytwórcę. [GISCO](https://ec.europa.eu/eurostat/web/gisco/geodata/population-distribution/population-grids)
opisuje siatkę EPSG:3035 oraz pola ludności i wieku. [Warunki Eurostatu](https://ec.europa.eu/eurostat/en/web/gisco/geodata/population-distribution)
dla siatki spisowej 2021 wskazują CC BY 4.0. Przekształcenia: przypisanie oczka
do punktu adresowego oraz obliczenie udziałów grup wieku. W karcie źródło i
licencja powinny pozostać widoczne.

Pole `T` jest **liczbą osób według miejsca zwykłego pobytu w całym oczku**, nie
liczbą osób przy adresie. Ponieważ oczko ma 1 km², ta sama liczba ma wartość
liczbową równą gęstości w osobach/km². Nie należy jej czytać jako aktualnego
ruchu pieszych, liczby klientów ani prognozy popytu. W trybie biznesowym może
opisywać potencjalne otoczenie mieszkaniowe, wraz z datą spisu 2021 i
rozdzielczością 1 km². Warstwa pozostaje neutralna w zwykłym wyniku adresu.

`Y_LT15` i `Y_GE65` są licznikami osób odpowiednio poniżej 15 lat i od 65 lat.
Importer dzieli je przez `T` i zapisuje procent. `SPECIAL_VALUE=confidential`,
pusty licznik lub zerowy mianownik daje `null`; rzeczywiste zero zachowuje jako
zero. Skrypt kontroluje, że grupy wieku nie przekraczają liczby wszystkich
mieszkańców oczka.

Pokrycie dla wersji adresów `a7d233814059`:

| Warstwa | Adresy z wartością | Uwagi |
| --- | ---: | --- |
| `ludnosc_1km` | 176 684 / 176 684 | 97 adresów w oczkach z opublikowanym zerem |
| `udzial_0_14` | 175 869 / 176 684 | 815 `null` |
| `udzial_65plus` | 175 869 / 176 684 | 815 `null` |

Trzy miary opisują siatkę z 2021 r.; nie da się z nich wywieść liczby mieszkańców
konkretnego budynku. Udziały wieku nie wskazują preferencji ani potrzeb osób.
Pakiet nie zawiera liczby budynków ani mieszkań, więc takich pól nie generujemy.
Publikacja GUS o „ludności według definicji krajowej”
([opis](https://portal.geo.stat.gov.pl/aktualnosci/dane-o-ludnosci-krajowej-w-siatce-kilometrowej-nsp-2021/))
ma odrębną definicję od pola `populationAtResidencePlace` w tym pakiecie;
wartości nie należy mieszać w jednym trendzie bez uzgodnienia definicji.
