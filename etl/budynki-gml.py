"""Strumieniowo wyciąga przyziemia LoD1 GUGiK z powiatowego ZIP CityGML."""

import json
import sys
import xml.etree.ElementTree as ET
import zipfile

CITY = "{http://www.opengis.net/citygml/2.0}"
BLDG = "{http://www.opengis.net/citygml/building/2.0}"
GML = "{http://www.opengis.net/gml}"
GEN = "{http://www.opengis.net/citygml/generics/2.0}"


def obrys(building):
    """Wybiera najniższy poziomy wielokąt bryły, czyli jej przyziemie."""
    kandydaci = []
    for polygon in building.iter(GML + "Polygon"):
        exterior = polygon.find(GML + "exterior")
        if exterior is None:
            continue
        pos = exterior.find(".//" + GML + "posList")
        if pos is None or not pos.text:
            continue
        nums = [float(x) for x in pos.text.split()]
        if len(nums) < 12 or len(nums) % 3:
            continue
        coords = [nums[i:i + 3] for i in range(0, len(nums), 3)]
        zs = [p[2] for p in coords]
        if max(zs) - min(zs) > 0.02:
            continue
        holes = []
        for interior in polygon.findall(GML + "interior"):
            hole_pos = interior.find(".//" + GML + "posList")
            if hole_pos is None or not hole_pos.text:
                continue
            hole_nums = [float(x) for x in hole_pos.text.split()]
            if len(hole_nums) >= 12 and len(hole_nums) % 3 == 0:
                holes.append([hole_nums[i:i + 3] for i in range(0, len(hole_nums), 3)])
        kandydaci.append((min(zs), -len(coords), [coords, *holes]))
    if not kandydaci:
        return None
    _, _, rings = min(kandydaci)
    result = []
    for coords in rings:
        if coords[0][:2] != coords[-1][:2]:
            coords.append(coords[0])
        result.append([[p[0], p[1]] for p in coords])
    return result


def atrybut(building, nazwa):
    for node in building.findall(GEN + "stringAttribute"):
        if node.attrib.get("name") == nazwa:
            return node.findtext(GEN + "value")
    return None


def przetworz(zip_path, out_path):
    liczba = 0
    with zipfile.ZipFile(zip_path) as archive, open(out_path, "w", encoding="utf8") as output:
        for name in archive.namelist():
            if not name.lower().endswith(".gml"):
                continue
            with archive.open(name) as source:
                context = ET.iterparse(source, events=("start", "end"))
                _, root = next(context)
                for event, member in context:
                    if event != "end" or member.tag != CITY + "cityObjectMember":
                        continue
                    building = member.find(BLDG + "Building")
                    if building is not None:
                        height = building.findtext(BLDG + "measuredHeight")
                        row = {
                            "id": atrybut(building, "buildingId"),
                            "height": float(height) if height else None,
                            "alsYear": atrybut(building, "aktZrodla"),
                            "footprint": obrys(building),
                        }
                        output.write(json.dumps(row, separators=(",", ":")) + "\n")
                        liczba += 1
                    root.remove(member)
    print(f"CityGML: {liczba} budynków", file=sys.stderr)


if __name__ == "__main__":
    przetworz(sys.argv[1], sys.argv[2])
