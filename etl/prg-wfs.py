"""Jednorazowy eksport punktów PRG z oficjalnej usługi GUGiK WFS KINA.

Zapisuje znormalizowane pola i współrzędne EPSG:2180 w etl/.cache.
Uruchamiany przez etl/adresy.mjs; biblioteka standardowa Python 3.
"""

import json
import re
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CACHE = ROOT / ".cache"
SERVICE = (
    "https://mapy.geoportal.gov.pl/wss/ext/wfs/KrajowaIntegracjaNumeracjiAdresowej"
)
GMINY = (
    "Igołomia-Wawrzeńczyce",
    "Kocmyrzów-Luborzyca",
    "Koniusza",
    "Liszki",
    "Michałowice",
    "Mogilany",
    "Niepołomice",
    "Skawina",
    "Świątniki Górne",
    "Wieliczka",
    "Wielka Wieś",
    "Zabierzów",
    "Zielonki",
)
NS = {
    "wfs": "http://www.opengis.net/wfs/2.0",
    "gml": "http://www.opengis.net/gml/3.2",
    "a": SERVICE,
}
PAGE = 10000


def get(params, cache_name):
    CACHE.mkdir(exist_ok=True)
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


def fetch_gmina(gmina):
    # Michałowice występują też poza Małopolską; prefiks TERYT 12 zawęża wybór.
    name_filter = (
        "NAZWA_GMINY='" + gmina.replace("'", "''") + "' AND ID_GMINY LIKE '12%'"
    )
    sample = get(
        {"CQL_FILTER": name_filter, "count": 1},
        "prg-code-" + urllib.parse.quote(gmina, safe="") + ".xml",
    )
    feature = sample.find("wfs:member/a:A07_Punkty_adresowe", NS)
    if feature is None:
        raise ValueError(f"PRG: brak gminy {gmina}")
    code = value(feature, "ID_GMINY")
    if not code or not re.fullmatch(r"12\d{5}", code):
        raise ValueError(f"PRG: błędny TERYT gminy {gmina}: {code}")
    filt = "ID_GMINY='" + code + "'"
    hits = get({"CQL_FILTER": filt, "resultType": "hits"}, "prg-hits-" + code + ".xml")
    expected = int(hits.attrib["numberMatched"])
    if expected == 0:
        raise ValueError(f"PRG: brak punktów dla {gmina}")
    local = []
    for start in range(0, expected, PAGE):
        page = get(
            {"CQL_FILTER": filt, "count": PAGE, "startIndex": start},
            "prg-" + code + f"-{start}.xml",
        )
        features = page.findall("wfs:member/a:A07_Punkty_adresowe", NS)
        local.extend(parse_feature(f) for f in features)
        if not features:
            raise ValueError(f"PRG: pusta strona {gmina} od {start}")
    ids = {row["id"] for row in local}
    if len(local) != expected or len(ids) != expected:
        raise ValueError(
            f"PRG: {gmina}: {len(local)} rekordów, {len(ids)} ID, oczekiwano {expected}"
        )
    if any(row["gmina"] != gmina for row in local):
        raise ValueError(f"PRG: filtr gminy nie zadziałał: {gmina}")
    print(f"{gmina}: {len(local)}", flush=True)
    return local


def main():
    with ThreadPoolExecutor(max_workers=3) as pool:
        groups = list(pool.map(fetch_gmina, GMINY))
    rows = [row for group in groups for row in group]
    pages = [
        p
        for p in CACHE.glob("prg-*.xml")
        if re.fullmatch(r"prg-\d{7}-\d+\.xml", p.name)
    ]
    fetched = (
        datetime.fromtimestamp(max(p.stat().st_mtime for p in pages), timezone.utc)
        .date()
        .isoformat()
    )
    (CACHE / "prg-obwarzanek.json").write_text(
        json.dumps({"pobrano": fetched, "wiersze": rows}, ensure_ascii=False)
    )
    print(f"PRG razem: {len(rows)}", flush=True)


if __name__ == "__main__":
    main()
