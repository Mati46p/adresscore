# Pitch – pliki

| Plik | Co |
|---|---|
| `zgloszenie.md` | pola formularza HackTribe, opis PL/EN, lista przed wysłaniem |
| `slajdy.html` | 10 slajdów 16:9 (1280×720), źródło PDF |
| `adresscore.pdf` | PDF do wysłania (generowany z `slajdy.html`) |
| `zrzuty/` | zrzuty demo: `mapa.png`, `karta-adresu.png`, `biznes.png` |
| `scenariusz-demo.md` | scenariusz 3 min, plan B offline, lista przed nagraniem MP4 |
| `slajdy-checkpoint.html`, `adresscore-checkpoint.pdf` | draft z checkpointu (sob 20:00) |

## PDF

```sh
chromium --headless --no-pdf-header-footer \
  --print-to-pdf=docs/pitch/adresscore.pdf docs/pitch/slajdy.html
```

Slajdy mają `@page { size: 1280px 720px }`, więc druk z przeglądarki (Ctrl+P → Zapisz jako PDF,
marginesy: brak, grafika tła: włączona) daje to samo.

## Zrzuty

`pnpm build && pnpm exec vite preview --port 4173`, potem w Chromium 1600×900:
`/` (mapa), `/#/adres/msip-2147483701339` (Grodzka 52), `/#/biznes` (tryb Biznes).
Mapa i karta potrzebują kilkunastu sekund na wczytanie danych.

## QR dla jury

Przed przygotowaniem slajdu potwierdź publiczny adres działającego demo na telefonie.
Lokalny adres `127.0.0.1` nie działa na telefonie jury. Nie podmieniaj go na planowaną domenę,
dopóki nie odpowiada publicznie. **Adres demo: do potwierdzenia.**

Generator SVG (wymaga `qrencode`, na macOS: `brew install qrencode`):

```sh
node scripts/generuj-qr-pitch.mjs https://POTWIERDZONY-URL/ docs/pitch/qr-demo.svg
```

Umieść SVG na slajdzie 10 w miejscu ramki „QR” z krótkim tekstem „Zeskanuj i sprawdź własny adres”.
Przed wysłaniem PDF zeskanuj kod telefonem przez sieć komórkową i sprawdź adres, mapę 2D oraz kartę okolicy.
