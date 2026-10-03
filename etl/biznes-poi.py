"""Eksport punktów branżowych z dziennego wyciągu OSM PBF (wymaga pyosmium).

python etl/biznes-poi.py /sciezka/malopolskie-latest.osm.pbf
PBF: https://download.geofabrik.de/europe/poland/malopolskie.html
"""

import json
import sys
from pathlib import Path

import osmium

BRANZE = {
    "sklep": ("Sklep spożywczy", 800),
    "apteka": ("Apteka", 1000),
    "fryzjer": ("Fryzjer lub barber", 800),
    "piekarnia": ("Piekarnia", 800),
    "kawiarnia": ("Kawiarnia", 900),
    "przychodnia": ("Przychodnia lub gabinet", 1200),
    "paczkomat": ("Automat paczkowy", 800),
    "kwiaciarnia": ("Kwiaciarnia", 1000),
    "kosmetyczka": ("Salon kosmetyczny", 900),
    "weterynarz": ("Gabinet weterynaryjny", 1500),
    "silownia": ("Siłownia lub fitness", 1500),
    "restauracja": ("Restauracja lub fast food", 900),
    "dentysta": ("Gabinet stomatologiczny", 1200),
    "optyk": ("Optyk", 1500),
    "drogeria": ("Drogeria", 1000),
    "cukiernia": ("Cukiernia", 1000),
    "mieso": ("Sklep mięsny", 1000),
    "warzywniak": ("Warzywniak", 800),
    "pralnia": ("Pralnia", 1500),
    "zoologiczny": ("Sklep zoologiczny", 1500),
    "bar": ("Bar lub pub", 900),
    "lodziarnia": ("Lodziarnia", 900),
}


def branze(tags):
    shop = tags.get("shop")
    amenity = tags.get("amenity")
    healthcare = tags.get("healthcare")
    leisure = tags.get("leisure")
    return [
        *(['sklep'] if shop in {'supermarket', 'convenience', 'grocery'} else []),
        *(['apteka'] if amenity == 'pharmacy' else []),
        *(['fryzjer'] if shop == 'hairdresser' else []),
        *(['piekarnia'] if shop == 'bakery' else []),
        *(['kawiarnia'] if amenity == 'cafe' or shop == 'coffee' else []),
        *(['przychodnia'] if amenity in {'clinic', 'doctors'} or healthcare in {'clinic', 'doctor'} else []),
        *(['paczkomat'] if amenity == 'parcel_locker' else []),
        *(['kwiaciarnia'] if shop in {'florist', 'garden_centre'} else []),
        *(['kosmetyczka'] if shop in {'beauty', 'cosmetics'} else []),
        *(['weterynarz'] if amenity == 'veterinary' else []),
        *(['silownia'] if leisure in {'fitness_centre', 'sports_centre'} and tags.get('sport') in {None, 'fitness', 'yoga', 'crossfit'} else []),
        *(['restauracja'] if amenity in {'restaurant', 'fast_food'} else []),
        *(['dentysta'] if amenity == 'dentist' or healthcare == 'dentist' else []),
        *(['optyk'] if shop == 'optician' else []),
        *(['drogeria'] if shop == 'chemist' else []),
        *(['cukiernia'] if shop in {'confectionery', 'pastry'} else []),
        *(['mieso'] if shop == 'butcher' else []),
        *(['warzywniak'] if shop == 'greengrocer' else []),
        *(['pralnia'] if shop in {'laundry', 'dry_cleaning'} else []),
        *(['zoologiczny'] if shop == 'pet' else []),
        *(['bar'] if amenity in {'bar', 'pub'} else []),
        *(['lodziarnia'] if amenity == 'ice_cream' or shop == 'ice_cream' else []),
    ]


class Eksport(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.punkty = {id: {} for id in BRANZE}

    def dodaj(self, obj, typ, lat, lon):
        if not 49.7 <= lat <= 50.5 or not 19.3 <= lon <= 20.8:
            return
        for branza in branze(obj.tags):
            self.punkty[branza][typ + '/' + str(obj.id)] = [
                lon, lat, obj.tags.get('name', '')[:100]
            ]

    def node(self, obj):
        if obj.location.valid():
            self.dodaj(obj, 'node', obj.location.lat, obj.location.lon)

    def way(self, obj):
        if not branze(obj.tags):
            return
        punkty = [n.location for n in obj.nodes if n.location.valid()]
        if punkty:
            self.dodaj(
                obj,
                'way',
                sum(n.lat for n in punkty) / len(punkty),
                sum(n.lon for n in punkty) / len(punkty),
            )


if __name__ == '__main__':
    plik = sys.argv[1]
    reader = osmium.io.Reader(plik)
    data = reader.header().get('osmosis_replication_timestamp')
    reader.close()
    if not data:
        raise ValueError('Brak daty stanu OSM w PBF')
    eksport = Eksport()
    eksport.apply_file(plik, locations=True)
    katalog = Path(__file__).resolve().parent.parent / 'public/dane/biznes'
    katalog.mkdir(parents=True, exist_ok=True)
    lista = []
    for id, (nazwa, zasieg) in BRANZE.items():
        punkty = list(eksport.punkty[id].values())
        if len(punkty) < 30:
            raise ValueError(f'Za mało punktów {id}: {len(punkty)}')
        meta = {
            'id': id,
            'nazwa': nazwa,
            'zasiegM': zasieg,
            'liczbaPunktow': len(punkty),
            'dataDanych': data[:10],
            'zrodlo': '© OpenStreetMap contributors, wyciąg Geofabrik Małopolskie',
            'url': 'https://download.geofabrik.de/europe/poland/malopolskie.html',
            'licencja': 'ODbL 1.0',
        }
        (katalog / f'{id}.json').write_text(
            json.dumps({'meta': meta, 'punkty': punkty}, ensure_ascii=False, separators=(',', ':')),
            encoding='utf-8',
        )
        lista.append(meta)
        print(f'{id}: {len(punkty)}')
    (katalog / 'katalog.json').write_text(
        json.dumps(lista, ensure_ascii=False, separators=(',', ':')), encoding='utf-8'
    )
