"""Awaryjny eksport POI z wyciągu Geofabrik, gdy Overpass jest niedostępny.

Użycie: python -m pip install osmium; python etl/uslugi-osm-pbf.py PLIK.osm.pbf PLIK.json
Zapisuje format odpowiedzi Overpass czytany przez uslugi-osm.mjs.
"""

import json
import sys
import osmium


SHOPS = {"supermarket", "convenience", "grocery", "bakery", "hairdresser"}
AMENITIES = {
    "school", "kindergarten", "pharmacy", "clinic", "doctors", "childcare",
    "post_office", "parcel_locker", "atm",
}
HEALTHCARE = {"clinic", "doctor"}


def relevant(tags):
    return (
        tags.get("shop") in SHOPS
        or tags.get("amenity") in AMENITIES
        or tags.get("healthcare") in HEALTHCARE
    )


class Exporter(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.elements = []

    def node(self, obj):
        if relevant(obj.tags) and obj.location.valid():
            self.elements.append({
                "type": "node", "id": obj.id,
                "lat": obj.location.lat, "lon": obj.location.lon,
                "tags": dict(obj.tags),
            })

    def way(self, obj):
        if not relevant(obj.tags):
            return
        locations = [n.location for n in obj.nodes if n.location.valid()]
        if locations:
            self.elements.append({
                "type": "way", "id": obj.id,
                "center": {
                    "lat": sum(loc.lat for loc in locations) / len(locations),
                    "lon": sum(loc.lon for loc in locations) / len(locations),
                },
                "tags": dict(obj.tags),
            })


if __name__ == "__main__":
    reader = osmium.io.Reader(sys.argv[1])
    osm_timestamp = reader.header().get("osmosis_replication_timestamp")
    reader.close()
    if not osm_timestamp:
        raise ValueError("Wyciąg PBF nie zawiera daty stanu OSM")
    exporter = Exporter()
    exporter.apply_file(sys.argv[1], locations=True)
    with open(sys.argv[2], "w", encoding="utf-8") as output:
        json.dump({
            "osm3s": {"timestamp_osm_base": osm_timestamp},
            "elements": exporter.elements,
            "extract_source": "https://download.geofabrik.de/europe/poland/malopolskie.html",
        }, output, ensure_ascii=False)
    print(f"Zapisano {len(exporter.elements)} punktów i obrysów OSM")
