"""Read KG PSP annual ZIP, table 1 (municipality totals), without third-party packages."""

import json
import re
import sys
from io import BytesIO
from xml.etree import ElementTree as ET
from zipfile import ZipFile

NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"


def rows_from_xlsx(content):
    with ZipFile(BytesIO(content)) as workbook:
        shared = []
        if "xl/sharedStrings.xml" in workbook.namelist():
            tree = ET.fromstring(workbook.read("xl/sharedStrings.xml"))
            shared = ["".join(node.itertext()) for node in tree.findall(f"{NS}si")]
        sheet = ET.fromstring(workbook.read("xl/worksheets/sheet1.xml"))
        for row in sheet.findall(f".//{NS}sheetData/{NS}row"):
            values = {}
            for cell in row.findall(f"{NS}c"):
                col = re.match(r"[A-Z]+", cell.attrib["r"]).group()
                raw = cell.findtext(f"{NS}v")
                if cell.attrib.get("t") == "inlineStr":
                    value = "".join(cell.find(f"{NS}is").itertext())
                elif raw is None:
                    value = None
                elif cell.attrib.get("t") == "s":
                    value = shared[int(raw)]
                else:
                    value = raw
                values[col] = value
            yield values


def parse_annual_zip(path, year):
    with ZipFile(path) as annual:
        names = [n for n in annual.namelist() if n.rsplit('/', 1)[-1] in ("1.xlsx", f"1_{year}.xlsx")]
        if len(names) != 1:
            raise ValueError(f"Expected one municipality table in {year} ZIP, got {names}")
        name = names[0]
        rows = iter(rows_from_xlsx(annual.read(name)))
        header = next(rows)
        expected = {
            "A": "TERYT",
            "E": "RAZEM Pożar (P)",
            "J": "RAZEM Miejscowe zagrożenie (MZ)",
            "P": "RAZEM Alarm fałszywy (AF)",
            "T": "OGÓŁEM",
        }
        for column, value in expected.items():
            if header.get(column) != value:
                raise ValueError(f"Unexpected {year} schema at {column}: {header.get(column)!r}")
        result = {}
        for row in rows:
            teryt = row.get("A", "")
            if not re.fullmatch(r"\d{6}", teryt):
                continue
            fires, threats, false_alarms, total = (int(row[c]) for c in ("E", "J", "P", "T"))
            if min(fires, threats, false_alarms) < 0 or total != fires + threats + false_alarms:
                raise ValueError(f"Invalid event counts for {teryt}")
            if teryt in result:
                raise ValueError(f"Repeated TERYT {teryt}")
            result[teryt] = {
                "name": row.get("D"),
                "fires": fires,
                "threats": threats,
                "falseAlarms": false_alarms,
                "total": total,
            }
        return result


if __name__ == "__main__":
    print(json.dumps(parse_annual_zip(sys.argv[1], int(sys.argv[2])), ensure_ascii=False))
