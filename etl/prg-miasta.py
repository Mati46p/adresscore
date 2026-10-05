"""Punkty adresowe PRG (GUGiK WFS KINA) dla 10 największych miast Polski.

Zapisuje etl/.cache/prg-miasta/<teryt>.json ({pobrano, miasto, wiersze}) w tym samym formacie
wierszy co prg-wfs.py (współrzędne EPSG:2180). Nie rusza public/dane/adresy.json – kontrakt
danych jest na razie Kraków + obwarzanek. Uruchom: python3 etl/prg-miasta.py [teryt ...]
Kolejne biegi wznawiają z cache (strony XML w etl/.cache/prg-miasta/).
"""

import json
import re
import sys
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CACHE = ROOT / ".cache" / "prg-miasta"
SERVICE = (
    "https://mapy.geoportal.gov.pl/wss/ext/wfs/KrajowaIntegracjaNumeracjiAdresowej"
)
# Wg liczby ludności (GUS 2024); Kraków ma własny import w etl/adresy.mjs.
MIASTA = {
    "1465011": "Warszawa",
    "1261011": "Kraków",
    "1061011": "Łódź",
    "0264011": "Wrocław",
    "3064011": "Poznań",
    "2261011": "Gdańsk",
    "3262011": "Szczecin",
    "0461011": "Bydgoszcz",
    "0663011": "Lublin",
    "2061011": "Białystok",
}
NS = {
    "wfs": "http://www.opengis.net/wfs/2.0",
    "gml": "http://www.opengis.net/gml/3.2",
    "a": SERVICE,
}
PAGE = 10000


def get(params, cache_name):
    CACHE.mkdir(parents=True, exist_ok=True)
    target = CACHE / cache_name
    if not target.exists():
        query = urllib.parse.urlencode(
            {
                "service": "WFS",
                "version": "2.0.0",
                "request": "GetFeature",
                "typeNames": "adresyUlice:A07_Punkty_adresowe",
                **params,
            }
        )
        req = urllib.request.Request(
            SERVICE + "?" + query, headers={"User-Agent": "adresscore-etl/1.0"}
        )
        with urllib.request.urlopen(req, timeout=180) as response:
            body = response.read()
        root = ET.fromstring(body)
        if root.tag != "{http://www.opengis.net/wfs/2.0}FeatureCollection":
            raise ValueError(f"WFS response error: {body[:500]!r}")
        target.write_bytes(body)
    return ET.parse(target).getroot()


def value(feature, field):
    elem = feature.find("a:" + field, NS)
    return elem.text.strip() if elem is not None and elem.text else None


def parse_feature(feature):
    raw_id = value(feature, "ID_IIP")
    match = re.search(r"PRG_([0-9a-fA-F-]{36})", raw_id or "")
    if not match:
        raise ValueError(f"PRG: niezrozumiały identyfikator: {raw_id}")
    pos = feature.find("a:GEOMETRIA/gml:Point/gml:pos", NS)
    if pos is None or not pos.text:
        raise ValueError(f"PRG: brak punktu: {raw_id}")
    # WFS 2.0/GML dla EPSG:2180 zapisuje osie jako northing,easting.
    northing, easting = [float(s) for s in pos.text.split()]
    return {
        "id": match.group(1).lower(),
        "gmina": value(feature, "NAZWA_GMINY"),
        "teryt": value(feature, "ID_GMINY"),
        "miejscowosc": value(feature, "NAZWA_MIEJSCOWOSCI"),
        "ulica": value(feature, "NAZWA_ULICY"),
        "nr": value(feature, "NUMER_PORZADKOWY"),
        "kod": value(feature, "KOD_POCZTOWY"),
        "x": easting,
        "y": northing,
    }


def fetch_miasto(teryt):
    nazwa = MIASTA[teryt]
    filt = "ID_GMINY='" + teryt + "'"
    hits = get({"CQL_FILTER": filt, "resultType": "hits"}, f"hits-{teryt}.xml")
    expected = int(hits.attrib["numberMatched"])
    if expected == 0:
        raise ValueError(f"PRG: brak punktów dla {nazwa}")
    rows = []
    for start in range(0, expected, PAGE):
        page = get(
            {
                "CQL_FILTER": filt,
                "count": PAGE,
                "startIndex": start,
                "sortBy": "ID_IIP",
            },
            f"{teryt}-{start}.xml",
        )
        features = page.findall("wfs:member/a:A07_Punkty_adresowe", NS)
        rows.extend(parse_feature(f) for f in features)
        if not features:
            raise ValueError(f"PRG: pusta strona {nazwa} od {start}")
    ids = {row["id"] for row in rows}
    if len(rows) != expected or len(ids) != expected:
        raise ValueError(
            f"PRG: {nazwa}: {len(rows)} rekordów, {len(ids)} ID, oczekiwano {expected}"
        )
    pages = list(CACHE.glob(f"{teryt}-*.xml"))
    fetched = (
        datetime.fromtimestamp(max(p.stat().st_mtime for p in pages), timezone.utc)
        .date()
        .isoformat()
    )
    (CACHE / f"{teryt}.json").write_text(
        json.dumps(
            {"pobrano": fetched, "miasto": nazwa, "teryt": teryt, "wiersze": rows},
            ensure_ascii=False,
        )
    )
    print(f"{nazwa} ({teryt}): {len(rows)}", flush=True)
    return len(rows)


def main():
    kody = sys.argv[1:] or list(MIASTA)
    nieznane = [k for k in kody if k not in MIASTA]
    if nieznane:
        raise SystemExit(f"Nieznany TERYT: {nieznane}")
    with ThreadPoolExecutor(max_workers=3) as pool:
        razem = sum(pool.map(fetch_miasto, kody))
    print(f"PRG razem: {razem}", flush=True)


if __name__ == "__main__":
    main()
