# Spec 003: Szybki start (#247)

## Problem
Pomiar produkcji 2026-10-23: ekran Szukaj pobiera `adresy.json` + 127 plików `wskazniki/*.json`
(~50 MB gzip, 312 MB JSON) i parsuje je na wątku głównym. FCP 17,7 s, karta zamarza 45 s+.
Serwer na Hetznerze nie wysyła ETag, więc `sw.js` pobiera wszystko w tle przy każdym wejściu.

## Historie
- **US1 (P1)** Osoba na telefonie (4G) widzi pokolorowaną mapę Krakowa w ≤ 3 s i może przewijać
  stronę bez zamarzania.
- **US2 (P1)** Powrót na stronę nie pobiera ponownie danych (same 304 / cache).
- **US3 (P2)** Karta adresu i ranking dają te same liczby co dziś (pełne dane).

## Wymagania
- FR-001 Brak long tasków > 200 ms w pierwszych 15 s (CPU ×4); TBT < 600 ms.
- FR-002 Serwer: ETag + 304; pliki z hashem `immutable`; `indeks.json`/`manifest.json` `no-cache`.
- FR-003 Etap B: zimny start bez żądań `adresy.json` i `wskazniki/`; dane ≤ 1,5 MB, całość ≤ 3 MB.
- FR-004 Brak danych = szara kategoria, nigdy 0 (NaN w `Float64Array` = dawny `null`).
- FR-005 Ranking top 5 zgodny z pełnymi danymi w 100% person × trybów × 3 zestawów filtrów.

Plan i podział: [plan.md](plan.md), zadania: [tasks.md](tasks.md).
