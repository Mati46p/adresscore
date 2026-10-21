"""Wypakowuje z archiwum SEWIK (fixed-sewik-xml-(2018-25).tar.xz) pliki jednego województwa, wszystkie lata.

  python -I etl/sewik-rozpakuj.py <województwo wg REGION_PBF, np. slaskie> [archiwum] [katalog docelowy]

Domyślnie: etl/.cache/sewik/sewik-xml-2018-24.tar.xz -> etl/.cache/sewik/raw/<województwo>/<rok>/*.xml.
Pułapka: nazwy plików w archiwum mają zepsute polskie litery (np. „ŚLĄSKIE" jako cyrylica + „L" + „SKIE"),
więc województwo rozpoznajemy po samych znakach ASCII nazwy. Pliki *_a.xml (poprawki) też trafiają do wyniku.
"""

import re
import sys
import tarfile
from pathlib import Path

# Rozpoznanie po ASCII-owym rdzeniu nazwy (litery spoza ASCII usunięte).
ROZPOZNANIE = {
    "slaskie": lambda s: s in ("LSKIE", "SLASKIE"),
    "swietokrzyskie": lambda s: "TOKRZYSKIE" in s,
    "warminsko_mazurskie": lambda s: s.startswith("WARMI") and s.endswith("MAZURSKIE"),
    "lodzkie": lambda s: s.endswith("DZKIE"),
    "malopolskie": lambda s: s.startswith("MA") and s.endswith("OPOLSKIE"),
    "dolnoslaskie": lambda s: s.startswith("DOLNO"),
    "kujawsko_pomorskie": lambda s: s == "KUJAWSKO-POMORSKIE",
    "mazowieckie": lambda s: s == "MAZOWIECKIE",
    "lubuskie": lambda s: s == "LUBUSKIE",
    "opolskie": lambda s: s == "OPOLSKIE",
    "podkarpackie": lambda s: s == "PODKARPACKIE",
    "podlaskie": lambda s: s == "PODLASKIE",
    "pomorskie": lambda s: s == "POMORSKIE",
    "wielkopolskie": lambda s: s == "WIELKOPOLSKIE",
    "zachodniopomorskie": lambda s: s == "ZACHODNIOPOMORSKIE",
    "lubelskie": lambda s: s == "LUBELSKIE",
}


def rdzen(nazwa):
    m = re.search(r"WOJ__(.*?)_(\d{4})(_a)?\.xml$", nazwa)
    if not m:
        return None
    return re.sub(r"[^\x00-\x7f]", "", m.group(1)), m.group(2)


def main():
    woj = sys.argv[1]
    if woj not in ROZPOZNANIE:
        raise SystemExit(f"Nieznane województwo: {woj} ({', '.join(ROZPOZNANIE)})")
    korzen = Path(__file__).parent / ".cache" / "sewik"
    archiwum = Path(sys.argv[2]) if len(sys.argv) > 2 else korzen / "sewik-xml-2018-24.tar.xz"
    cel = Path(sys.argv[3]) if len(sys.argv) > 3 else korzen / "raw" / woj
    cel.mkdir(parents=True, exist_ok=True)
    wypakowane = 0
    with tarfile.open(archiwum, "r|xz") as tar:
        for wpis in tar:
            r = rdzen(wpis.name) if wpis.isfile() else None
            if not r or not ROZPOZNANIE[woj](r[0]):
                continue
            nazwa = Path(wpis.name).name
            nazwa = re.sub(r"[^\x00-\x7f]", "", nazwa)
            (cel / r[1]).mkdir(exist_ok=True)
            plik = cel / r[1] / nazwa
            tmp = plik.with_suffix(".tmp")
            with tar.extractfile(wpis) as zrodlo, open(tmp, "wb") as wyj:
                while blok := zrodlo.read(1 << 22):
                    wyj.write(blok)
            tmp.replace(plik)
            wypakowane += 1
            print(f"{plik.relative_to(korzen)} {wpis.size}", flush=True)
    if wypakowane == 0:
        raise SystemExit(f"Brak plików województwa {woj} w archiwum")
    print(f"Wypakowano {wypakowane} plików do {cel}")


main()
