# Raport końcowy – stan na 2026-10-04 (#35)

Gałąź `ccr-c28c4b7c-j09epx` = `main` + domknięcie E2, E3, E8. `pnpm verify` przechodzi,
`node etl/kompakt.mjs --sprawdz` – kompakt aktualny.

## Działa (zielone)

| Etap | Zadanie | Co |
|---|---|---|
| E2 | #65 | Punkt Schronienia: czas dojścia pieszo po sieci OSM (70 215 adresów, bariery: Wisła, tory, S7) |
| E2 | #66 | MPZP w karcie: symbol i przeznaczenie terenu w punkcie, tereny w promieniu 100 m, link do planu |
| E3 | #77 | Budżet z cen RCN w lewym panelu – heksy poza budżetem wyszarzone, brak ceny = brak danych |
| E3 | #85 | Dojazd komunikacją do własnego celu – liczony w przeglądarce z rozkładu GTFS (2026-10-07) |
| E3 | #100 | Offline: service worker z cache aplikacji, danych i PMTiles |
| E8 | #33 #47 | `docs/pitch/adresscore.pdf` (10 slajdów), `zgloszenie.md`, zrzuty |
| E8 | #79 | `docs/pitch/scenariusz-demo.md` – 3 min, plan B offline |
| E8 | #78 #34 | Walidacja na znanych okolicach (test), tryb mobilny, generator QR |
| E10 | #105–#108 | Tryb Biznes i przełącznik Miasto / Biznes |

## Czerwone / niepełne

- **#43 z-dykty** – brak klucza API z-dykty w środowisku; nie zaczęte.
- **#66 MPZP** – MSIP i BIP Krakowa niedostępne z sieci budującej: brak numeru i daty uchwały
  oraz paragrafów (karta mówi to wprost); sąsiedztwo z punktów adresowych, nie z poligonów.
- **#85** – wynik tylko w panelu (bez warstwy na mapie); jeden dzień rozkładu.
- **#65** – plik wskaźnika 2,02 MB (próg kontraktu 2 MB); nowa warstwa do dopisania w
  `PRZENIESIONE` w `etl/uprosc-kryteria.mjs` (plik integratora).

## Dla ludzi przed oddaniem

1. Nazwa zespołu i skład – slajd 1 i `docs/pitch/zgloszenie.md`.
2. Publiczny adres demo sprawdzony na telefonie → QR (`node scripts/generuj-qr-pitch.mjs …`) na slajd 10.
3. Commit i data szablonu repo sprzed 11:00 na slajdzie 10; link do repo dla jury.
4. Nagranie MP4 wg scenariusza.
5. Scalenie gałęzi na `main` i finalny commit z `[wdroz]` (integrator).
