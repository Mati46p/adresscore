# Kontrakt tokenów (004, P0)

Źródło prawdy dla wszystkich paczek 004. Wartości wizualne: `docs/makiety/arkusz-mobile.html`.
P0 dopisuje je do `:root` w `src/styles.css`; inne paczki używają nazw, nie wpisują wartości.

## Nowe zmienne

| Grupa | Zmienne |
|---|---|
| Odstępy | `--odstep-1` 4px, `-2` 8px, `-3` 12px, `-4` 16px, `-5` 20px, `-6` 24px, `-7` 32px, `-8` 48px |
| Pismo | `--rozmiar-xs` 12px, `-s` 13px, `-m` 15px, `-l` 17px, `-xl` 20px, `-xxl` 26px; `--interlinia` 1.4 |
| Promienie | `--promien-s` 6px, `--promien` 12px (jest), `--promien-l` 16px, `--promien-pelny` 999px |
| Cienie | `--cien-1` `0 2px 8px rgb(24 32 43 / 0.10)`, `--cien-2` `0 6px 20px rgb(24 32 43 / 0.12)`, `--cien-arkusz` `0 -8px 24px rgb(24 32 43 / 0.14)` |
| Ruch | `--czas-szybki` 120ms, `--czas` 200ms, `--czas-arkusz` 320ms, `--krzywa` `cubic-bezier(.2, .8, .2, 1)` |
| Warstwy (z-index) | `--z-mapa-kontrolki` 2, `--z-mapa-panel` 3, `--z-mapa-pasek` 5, `--z-lepkie` 10, `--z-arkusz` 20, `--z-naglowek` 30, `--z-menu` 40, `--z-toast` 50 |
| Kolory mapy | `--tlo-mapy` #e4e7e2, `--mapa-wykluczony` #2f3438, `--mapa-mgla` #eef0ee, `--mapa-mgla-ramka` #9aa2a8 |
| Kolory | `--akcent-jasny-2` #d6e9dc, `--plakietka-srednia` #5d8f6f, `--plakietka-niska` #9bb79c |

Istniejące kolory zostają (`--akcent`, `--akcent-hover`, `--akcent-jasny`, `--akcent-obrys`,
`--tekst*`, `--ramka*`, `--linia`, `--tlo`, `--powierzchnia*`, `--ostrzezenie*`, `--brak-danych`).
Hex równy istniejącemu tokenowi zamieniasz na token: #fff → `var(--powierzchnia)`,
#18202b → `--tekst`, #3d4652 → `--tekst-2`, #5b6470 → `--tekst-3`, #dde1e4 → `--ramka`,
#1f5c46 / #194d3c → `--akcent`, #163f31 / #174936 / #17493a → `--akcent-hover`,
#e3efe8 / #edf5ef → `--akcent-jasny`, #8bc0a3 / #a4c6b4 → `--akcent-obrys`,
#8a939b / #929da5 → `--ramka-pola`. Gradienty skali wyniku zostają literalne.

Nagłówek (P5): `--wys-paska-serwisow` 28px, `--wys-naglowka` = 56px + pasek.

## Breakpointy – tylko trzy

640 / 1024 / 1440. Układ z arkuszem: `max-width: 1023.98px`. W CSS literalnie z komentarzem
`/* bp-l */` (zmienne nie działają w `@media`). W JS: `src/lib/punktyLamania.ts`:
`PUNKTY = { m: 640, l: 1024, xl: 1440 }`, `MEDIA_ARKUSZA = '(max-width: 1023.98px)'`,
`MEDIA_TELEFONU = '(max-width: 639.98px)'`.
Mapowanie starych progów: 420/430/480/520/600/620 → 640; 650/700/720/860/900/1050 → 1024.

## Reguły dla każdego komponentu

- Cel dotyku ≥ 44×44 (`--cel-dotyku`), także przy `.seg` i przyciskach ikonowych.
- `:hover` tylko w `@media (hover: hover)`.
- Animacja: czasy z tokenów; globalny reset pod `prefers-reduced-motion` robi P0.
- Polski tekst: półpauza ze spacjami, nigdy pauza (hook `straz-pauzy` odrzuci zapis).
