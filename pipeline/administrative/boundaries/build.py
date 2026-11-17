"""Build the reviewed Natural Earth country view from the pinned 1:50m shapefile."""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import re
import tempfile
import xml.etree.ElementTree as ET
import zipfile
from collections import Counter, defaultdict
from pathlib import Path

import shapefile
from shapely.geometry import MultiPolygon, Point, Polygon, shape
from shapely.validation import make_valid

ROOT = Path(__file__).resolve().parents[3]
HERE = Path(__file__).resolve().parent
PIN = HERE / "sources.json"
CROSSWALK = HERE / "crosswalk.json"
ARCHIVE = ROOT / "data/administrative/boundaries/ne_50m_admin_0_countries_v5.1.1.zip"
CLDR_SOURCE = ROOT / "data/administrative/cldr/supplementalData-49.xml"
OUTPUT = ROOT / "app/public/administrative/boundaries"


def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def territory_codes(source: Path) -> set[str]:
    root = ET.parse(source).getroot()
    info = root.find("territoryInfo")
    if info is None:
        raise ValueError("CLDR source has no territoryInfo")
    codes = [item.get("type") for item in info]
    if len(codes) != len(set(codes)) or any(
        code is None or not re.fullmatch(r"[A-Z]{2}", code) for code in codes
    ):
        raise ValueError("Invalid CLDR territory inventory")
    return set(codes)


def rounded_geometry(geometry: dict) -> dict:
    def round_coordinates(value: list | tuple) -> list:
        if value and isinstance(value[0], (int, float)):
            return [round(float(value[0]), 5), round(float(value[1]), 5)]
        return [round_coordinates(part) for part in value]

    return {"type": geometry["type"], "coordinates": round_coordinates(geometry["coordinates"])}


def representative_point(geometry: dict) -> list[float]:
    parsed = shape(geometry)
    if not parsed.is_valid:
        parsed = make_valid(parsed)
    candidates = (
        [parsed]
        if isinstance(parsed, Polygon)
        else [part for part in parsed.geoms if isinstance(part, Polygon)]
        if isinstance(parsed, MultiPolygon)
        else []
    )
    candidates = [
        part
        for part in candidates
        if not part.is_empty
        and not (
            part.bounds[2] - part.bounds[0] > 300
            and not any(abs(x) < 150 for x, _ in part.exterior.coords)
        )
    ]
    if not candidates:
        raise ValueError("No usable country polygon for representative point")
    polygon = max(candidates, key=lambda item: item.area)
    point = polygon.representative_point()
    longitude, latitude = round(point.x, 6), round(point.y, 6)
    if not polygon.covers(Point(longitude, latitude)):
        raise ValueError("Representative point lies outside country geometry")
    return [longitude, latitude]


def read_shapes(archive: Path, spec: dict) -> tuple[list[dict], list[dict]]:
    from pipeline.administrative.boundaries.sources import check_file

    check_file(archive, spec)
    stem = "ne_50m_admin_0_countries"
    with zipfile.ZipFile(archive) as package:
        if package.read(f"{stem}.VERSION.txt").strip() != spec["version"].encode():
            raise ValueError("Unexpected Natural Earth file version")
        reader = shapefile.Reader(
            shp=io.BytesIO(package.read(f"{stem}.shp")),
            shx=io.BytesIO(package.read(f"{stem}.shx")),
            dbf=io.BytesIO(package.read(f"{stem}.dbf")),
            encoding="utf-8",
        )
        if len(reader) != spec["featureCount"]:
            raise ValueError("Unexpected Natural Earth feature count")
        features: list[dict] = []
        geometry: list[dict] = []
        for item in reader.iterShapeRecords():
            source = item.record.as_dict()
            key, name = source["ADM0_A3"], source["ADMIN"]
            if not re.fullmatch(r"[A-Z0-9]{3}", key) or not isinstance(name, str):
                raise ValueError("Invalid Natural Earth country identifier")
            feature_id = f"country-{key}"
            source_geometry = rounded_geometry(item.shape.__geo_interface__)
            # Natural Earth's default ISO fields intentionally use -99 for
            # some areas (including France and Norway); the EH field retains
            # their ISO identifiers without changing the polygon viewpoint.
            numeric = source["ISO_N3_EH"]
            feature = {
                "featureId": feature_id,
                "sourceId": key,
                "sourceAlpha2Code": source["ISO_A2_EH"]
                if re.fullmatch(r"[A-Z]{2}", source["ISO_A2_EH"])
                else None,
                "sourceNumericId": numeric if re.fullmatch(r"[0-9]{3}", numeric) else None,
                "sourceName": name,
                "point": representative_point(source_geometry),
            }
            features.append(feature)
            geometry.append(
                {
                    "type": "Feature",
                    "id": feature_id,
                    "properties": {"featureId": feature_id},
                    "geometry": source_geometry,
                }
            )
    if len({item["featureId"] for item in features}) != len(features):
        raise ValueError("Repeated Natural Earth feature identifier")
    return features, geometry


def compile_view(archive: Path, cldr_source: Path, pin: dict, crosswalk: dict) -> tuple[dict, dict]:
    from pipeline.administrative.boundaries.sources import check_file

    check_file(cldr_source, pin["cldr"])
    features, geometries = read_shapes(archive, pin["naturalEarth"])
    if crosswalk.get("schemaVersion") != 2 or crosswalk.get("viewId") != pin["viewId"]:
        raise ValueError("Crosswalk schema or view mismatch")
    entries = crosswalk.get("territories")
    codes = territory_codes(cldr_source)
    if not isinstance(entries, list) or len(entries) != len(codes):
        raise ValueError("Crosswalk must cover every CLDR territory")
    if [row["code"] for row in entries] != sorted(codes):
        raise ValueError("Crosswalk entries must be sorted by CLDR code")
    feature_by_id = {item["featureId"]: item for item in features}
    by_numeric: dict[str, list[str]] = defaultdict(list)
    for feature in features:
        if feature["sourceNumericId"]:
            by_numeric[feature["sourceNumericId"]].append(feature["featureId"])
    used: set[str] = set()
    statuses: Counter[str] = Counter()
    for row in entries:
        code, status, ids = row["code"], row["status"], row["featureIds"]
        if status not in {"matched", "ambiguous", "unmatched"} or not isinstance(ids, list):
            raise ValueError(f"Invalid crosswalk entry for {code}")
        if len(ids) != len(set(ids)) or any(fid not in feature_by_id for fid in ids):
            raise ValueError(f"Unknown or repeated boundary feature for {code}")
        if status == "matched":
            excluded = row.get("excludedFeatureIds", [])
            if not isinstance(excluded, list) or (excluded and not row.get("note")):
                raise ValueError(f"Excluded source features need a note: {code}")
            if (
                not ids
                or len(set(ids + excluded)) != len(ids) + len(excluded)
                or set(ids + excluded) != set(by_numeric.get(row.get("sourceNumericCode"), []))
            ):
                raise ValueError(
                    f"Matched territory must cover its numeric source features: {code}"
                )
            if any(feature_by_id[fid]["sourceAlpha2Code"] != code for fid in ids + excluded):
                raise ValueError(f"Matched territory disagrees with source ISO alpha-2: {code}")
            if used.intersection(ids):
                raise ValueError(f"Boundary feature assigned to multiple territories: {code}")
            used.update(ids)
        elif status == "unmatched" and ids:
            raise ValueError(f"Unmatched territory has polygon candidates: {code}")
        elif status == "ambiguous" and (not ids or not row.get("reason")):
            raise ValueError(f"Ambiguous territory lacks documented candidates: {code}")
        statuses[status] += 1
    unassigned = [item["featureId"] for item in features if item["featureId"] not in used]
    if crosswalk.get("unassignedFeatureIds") != unassigned:
        raise ValueError("Crosswalk must inventory every unassigned source geometry")
    index = {
        "schemaVersion": 2,
        "viewId": pin["viewId"],
        "manifest": {
            "worldview": pin["worldview"],
            "naturalEarth": pin["naturalEarth"],
            "cldr": pin["cldr"],
            "crosswalkSha256": sha256(CROSSWALK.read_bytes()),
            "producerRevision": f"sha256:{sha256(Path(__file__).read_bytes())}",
            "coverage": {
                "featureCount": len(features),
                "matchedTerritories": statuses["matched"],
                "ambiguousTerritories": statuses["ambiguous"],
                "unmatchedTerritories": statuses["unmatched"],
                "unassignedFeatures": len(unassigned),
            },
        },
        "features": features,
    }
    return index, {"type": "FeatureCollection", "features": geometries}


def expected_files(archive: Path = ARCHIVE, cldr_source: Path = CLDR_SOURCE) -> dict[str, bytes]:
    index, geometry = compile_view(archive, cldr_source, read_json(PIN), read_json(CROSSWALK))
    encode = lambda value: (
        json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n"
    ).encode()
    return {
        "geometry.geojson": encode(geometry),
        "crosswalk.json": CROSSWALK.read_bytes(),
        "feature-index.json": encode(index),
    }


def build(output: Path, files: dict[str, bytes]) -> None:
    output.mkdir(parents=True, exist_ok=True)
    for name, data in files.items():
        target = output / name
        if target.exists() and target.read_bytes() == data:
            continue
        with tempfile.NamedTemporaryFile(dir=output, prefix=".boundary-", delete=False) as handle:
            staged = Path(handle.name)
            try:
                handle.write(data)
                handle.flush()
                staged.replace(target)
            finally:
                staged.unlink(missing_ok=True)
    (output / "geometry.topojson").unlink(missing_ok=True)


def verify(output: Path, files: dict[str, bytes]) -> None:
    for name, data in files.items():
        target = output / name
        if not target.is_file() or target.is_symlink() or target.read_bytes() != data:
            raise ValueError(f"Missing or stale boundary asset: {target}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("build", "verify"))
    args = parser.parse_args()
    try:
        files = expected_files()
        if args.command == "build":
            build(OUTPUT, files)
        verify(OUTPUT, files)
    except (OSError, ValueError, KeyError, zipfile.BadZipFile) as error:
        parser.exit(1, f"Boundary {args.command} failed: {error}\n")
    print(f"Verified {len(files)} boundary assets in {OUTPUT}")


if __name__ == "__main__":
    main()
