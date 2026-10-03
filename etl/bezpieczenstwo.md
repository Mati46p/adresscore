# Latarnie oznaczone w OSM

`node etl/bezpieczenstwo.mjs` liczy węzły `highway=street_lamp` w promieniu
100 m w linii prostej od każdego adresu. Wycinek OSM Małopolski pochodzi z
[Geofabrik](https://download.geofabrik.de/europe/poland/malopolskie.html),
stan 2026-10-02; dane © OpenStreetMap contributors, [ODbL 1.0](https://www.openstreetmap.org/copyright).
Importer próbuje najpierw Overpass, a wynik buforuje w `etl/.cache/`.

W wycinku jest 29 438 oznaczonych latarni. Wartość jest dostępna dla
176 684 adresów; 29 067 ma co najmniej jedną oznaczoną latarnię w 100 m.
Zero oznacza brak oznaczenia w OSM, a nie brak oświetlenia w terenie.
Dlatego wskaźnik jest wyłącznie informacyjny i nie wpływa na wynik
bezpieczeństwa.

Zgłoszeń z Krajowej Mapy Zagrożeń Bezpieczeństwa nie publikujemy: nie ma
udokumentowanego, publicznego eksportu ani API. Jeśli źródło zostanie
udostępnione, wynik należy agregować do rejonu, bez przypisywania zdarzeń
do pojedynczego adresu.
