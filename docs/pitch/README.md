# QR dla jury

Przed przygotowaniem slajdu potwierdź publiczny adres działającego demo na telefonie.
Lokalny adres `127.0.0.1` nie działa na telefonie jury. Nie podmieniaj go na planowaną domenę,
dopóki nie odpowiada publicznie.

Generator SVG (wymaga `qrencode`, na macOS: `brew install qrencode`):

```sh
node scripts/generuj-qr-pitch.mjs https://POTWIERDZONY-URL/ docs/pitch/qr-demo.svg
```

Umieść SVG na slajdzie z krótkim tekstem „Zeskanuj i sprawdź własny adres”. Przed wysłaniem PDF
zeskanuj kod telefonem przez sieć komórkową i sprawdź adres, mapę 2D oraz kartę okolicy.
