#!/usr/bin/env python3
"""Package a downloaded RESOLVE Ecoregions 2017 GeoJSON as a local biome basemap."""

import argparse
import json
import subprocess
import tempfile
from pathlib import Path

from pipeline.atlas.build import PROJECT_ROOT, find_tippecanoe


def build(source: Path) -> None:
    data = json.loads(source.read_text())
    if data.get("exceededTransferLimit") or not data.get("features"):
        raise ValueError("Expected a complete RESOLVE GeoJSON FeatureCollection")
    biome_ids = {int(feature["properties"]["BIOME_NUM"]) for feature in data["features"]}
    if biome_ids != set(range(1, 15)):
        raise ValueError(f"Expected all 14 biome categories, received {biome_ids}")
    tippecanoe = find_tippecanoe()
    if not tippecanoe:
        raise RuntimeError("Run pipeline/atlas/bootstrap-tippecanoe.sh first")
    output = PROJECT_ROOT / "app/public/basemaps/biomes.pmtiles"
    output.parent.mkdir(parents=True, exist_ok=True)
    # Only the category is needed at runtime. Adjacent ecoregions of the same
    # biome can be coalesced without losing the ecological classification.
    with tempfile.TemporaryDirectory(prefix="atlas-biomes-") as temporary:
        normalized = Path(temporary) / "biomes.geojsonl"
        with normalized.open("w") as stream:
            for feature in data["features"]:
                feature["properties"] = {"biome_id": int(feature["properties"]["BIOME_NUM"])}
                feature.pop("id", None)
                stream.write(json.dumps(feature, separators=(",", ":")) + "\n")
        subprocess.run(
            [
                tippecanoe,
                "--force",
                f"--output={output}",
                "--layer=biomes",
                "--minimum-zoom=0",
                "--maximum-zoom=6",
                "--no-feature-limit",
                "--no-tile-size-limit",
                "--detect-shared-borders",
                "--coalesce",
                "--no-progress-indicator",
                "--attribution=RESOLVE Ecoregions 2017 (CC BY 4.0)",
                str(normalized),
            ],
            check=True,
        )
    print(f"Packaged {len(data['features'])} ecoregions into {output} ({output.stat().st_size:,} bytes)")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path, help="Downloaded RESOLVE GeoJSON with BIOME_NUM")
    build(parser.parse_args().source)
