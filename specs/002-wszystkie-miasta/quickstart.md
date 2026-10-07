# Quickstart: walidacja „wszystkie miasta na mapie"

## Wymagania

- worktree `feat/wszystkie-miasta`, `pnpm install`, dane w `public/dane` (są w repo).

## Automatycznie

```powershell
pnpm verify                                     # Biome + tsc + build (manifesty miast w dist/dane/miasta/*/manifest.json)
node --test src/kontrakty/miasta.test.ts        # rejestr = katalogi public/dane/miasta
node --test src/wynik/przegladLiczenie.test.ts  # brak warstwy = null, nigdy 0; granice; złączenie tła
node --test src/wynik/stanMiasto.test.ts        # link mst=, reset wyboru, scalanie wag
```

Po buildzie: `ls dist/dane/miasta/*/manifest.json` → 9 plików.

## Ręcznie (`pnpm dev`, port 5180)

| # | Krok | Oczekiwane |
|---|---|---|
| 1 | Otwórz `/` | kadr Polski, 10 miast pokolorowanych, mgła poza nimi z podpisem „poza obsługiwanymi miastami" |
| 2 | Najedź heks w Łodzi | dymek „Łódź · wynik N (średnia okolicy)" |
| 3 | Zmień profil | kolory zmieniają się we wszystkich miastach |
| 4 | Wybierz warstwę „Powódź" (tylko miasta) / warstwę tylko krakowską | miasta bez warstwy w szrafurze, legenda „brak danych" |
| 5 | Lista miast → Wrocław | lot, komunikat ładowania, potem r10 i nagłówek „Znajdź okolicę we Wrocławiu" |
| 6 | Klik heksu we Wrocławiu → Otwórz kartę | karta adresu wrocławskiego, źródła, pewność |
| 7 | Skopiuj link, otwórz w nowej karcie | Wrocław i ten sam adres |
| 8 | Z porównaniem w Krakowie przesuń kamerę nad Warszawę (zoom ≥ 11) | miasto się NIE zmienia; przycisk „Przełącz na Warszawę" |
| 9 | Bez porównania przybliż Gdańsk | bieżące miasto = Gdańsk po zatrzymaniu kamery |
| 10 | W Lublinie wejdź w Biznes | „Na razie tylko w Krakowie" |
| 11 | DevTools → Network, „Fast 4G", twarde odświeżenie | pierwsze kolory Krakowa ≤ main + 10%; reszta miast ≤ 4 s; dodatkowo ≤ 2,5 MB |
| 12 | Telefon 360 px | lista miast mieści się, brak poziomego przewijania |
| 13 | Kontrast nowych napisów (lista miast, komunikaty, wiersz legendy) – pomiar w obu motywach | ≥ 4,5:1; wypisać liczbę zmierzonych elementów |
| 14 | `prefers-reduced-motion` | zmiana miasta skokiem |
| 15 | Build + `pnpm preview`, offline po pierwszym wejściu | mapa działa; indeksy kompaktów miast pobierane z sieci online |
