"""Independent palette measurements, usable with browser captures or saved JSON.

No optimizer graph, objective, subdivision positions, or color library is used.
The screen grid approximates spatial contact; it does not prove polygon overlap.
"""

import argparse
import json
import math
from collections import defaultdict
from functools import cache
from pathlib import Path


@cache
def lab(hex_color):
    rgb = [int(hex_color[i:i+2], 16) / 255 for i in (1, 3, 5)]
    r, g, b = [x / 12.92 if x <= .04045 else ((x + .055) / 1.055) ** 2.4 for x in rgb]
    l = (.4122214708*r + .5363325363*g + .0514459929*b) ** (1/3)
    m = (.2119034982*r + .6806995451*g + .1073969566*b) ** (1/3)
    s = (.0883024619*r + .2817188376*g + .6299787005*b) ** (1/3)
    return (.2104542553*l + .7936177850*m - .0040720468*s,
            1.9779984951*l - 2.4285922050*m + .4505937099*s,
            .0259040371*l + .7827717662*m - .8086757660*s)


def lab_distance(x, y):
    return (((x[0]-y[0])*.65)**2 + (x[1]-y[1])**2 + (x[2]-y[2])**2) ** .5


def distance(a, b):
    return lab_distance(lab(a), lab(b))


def evaluate_colors(capture, palette):
    """Measure actual shades at contacts, multiscale clade contrast, and coherence.
    Exact colors participate in readability, but not coherence.
    Missing palette colors fail explicitly instead of silently dropping entries.
    """
    owners = dict(capture["reference"]["rootById"])
    parents = dict(capture["topology"]["parentById"])
    children = dict(capture["topology"]["childrenById"])
    colors = dict(palette["colors"])
    anchors = dict(palette.get("anchors", capture["reference"]["anchors"]))
    overrides = capture["configuration"].get("overrides", {})
    groups = defaultdict(list)
    grid = defaultdict(lambda: defaultdict(set))
    cell_count = capture["view"]["columns"] * capture["view"]["rows"]
    for footprint in sorted(capture["view"]["footprints"], key=lambda v: v["id"]):
        language_id = footprint["languageId"]
        root = owners.get(language_id)
        cells = sorted({c for c in footprint["cells"] if 0 <= c < cell_count})
        if not root or not cells:
            continue
        fixed = footprint.get("fixedColor", overrides.get(language_id))
        color = fixed or colors[language_id]
        groups[root].append((language_id, color, cells, bool(fixed)))
        for cell in cells:
            grid[cell][root].add(color)

    # Each family pair contributes once after averaging its shared-cell risks.
    # Compare shades co-occurring in a cell, never geographically remote extremes.
    pairs = {}
    for cell in sorted(grid):
        families = sorted(grid[cell].items())
        for i, (a, first) in enumerate(families):
            for b, second in families[i+1:]:
                minimum = min(distance(x, y) for x in sorted(first) for y in sorted(second))
                pair = pairs.setdefault((a, b), {"sum": 0., "count": 0, "minimum": 1.})
                pair["sum"] += max(0., 1 - minimum / .16) ** 2
                pair["count"] += 1
                pair["minimum"] = min(pair["minimum"], minimum)
    contacts = {
        "familyPairCount": len(pairs),
        "meanShortfall": sum(p["sum"] / p["count"] for p in pairs.values()) / (len(pairs) or 1),
        "severePairCount": sum(p["minimum"] < .025 for p in pairs.values()),
        "worstPairs": [
            {"families": list(key), "distance": p["minimum"], "sharedCells": p["count"]}
            for key, p in sorted(pairs.items(), key=lambda item: (item[1]["minimum"], item[0]))[:12]
        ],
    }

    # Area mass is shared among representations in each family cell, so neither
    # classification cardinality nor repeated source/period entries create area.
    mass = defaultdict(float)
    sums = defaultdict(lambda: [0., 0., 0.])
    for vertices in groups.values():
        population = defaultdict(int)
        for _, _, cells, _ in vertices:
            for cell in cells:
                population[cell] += 1
        for language_id, color, cells, _ in vertices:
            weight = sum(1 / population[cell] for cell in cells)
            mass[language_id] += weight
            for axis, value in enumerate(lab(color)):
                sums[language_id][axis] += weight * value
    own_mass = dict(mass)
    own_sums = {node: values[:] for node, values in sums.items()}
    for language_id in reversed(capture["topology"]["order"]):
        parent = parents.get(language_id)
        if parent and owners.get(language_id) == owners.get(parent):
            mass[parent] += mass[language_id]
            for axis in range(3):
                sums[parent][axis] += sums[language_id][axis]

    measurements = {}
    for root, vertices in sorted(groups.items()):
        anchor = lab(anchors[root])
        chroma = math.hypot(anchor[1], anchor[2])
        automatic = [lab(color) for _, color, _, fixed in vertices if not fixed]
        hue_drift = [abs(math.degrees(math.atan2(
            anchor[1]*sample[2] - anchor[2]*sample[1],
            anchor[1]*sample[1] + anchor[2]*sample[2]))) for sample in automatic] if chroma > .02 else []
        # A displayed ancestor's own footprint remains a separate slot when its
        # clade is expanded. Otherwise evaluation silently loses that map area.
        frontier = [(root, False)]
        def slot_mass(slot):
            return own_mass[slot[0]] if slot[1] else mass[slot[0]]
        def slot_mean(slot):
            values = own_sums[slot[0]] if slot[1] else sums[slot[0]]
            return [value / slot_mass(slot) for value in values]
        scales = []
        for divisions in (2, 4, 8, 16):
            # Refine by area, not classification depth or number of tiny leaves.
            # Unary wrappers cost no scale; a large clade keeps being subdivided
            # even if many small siblings already inflate the frontier's count.
            while True:
                choices = [(node, [child for child in children.get(node, [])
                                   if owners.get(child) == root and mass[child] > 0])
                           for node, own in frontier if not own and mass[node] > mass[root] / divisions + 1e-9]
                choices = [(node, clades) for node, clades in choices if clades]
                if not choices:
                    break
                node, clades = min(choices, key=lambda choice: (-mass[choice[0]], choice[0]))
                index = frontier.index((node, False))
                slots = [(child, False) for child in sorted(clades)]
                if own_mass.get(node, 0) > 0:
                    slots.append((node, True))
                frontier[index:index+1] = slots
            total, weights, weak, significant = 0., 0., 0., []
            for i, a in enumerate(frontier):
                for b in frontier[i+1:]:
                    weight = slot_mass(a) * slot_mass(b)
                    d = lab_distance(slot_mean(a), slot_mean(b))
                    total += weight * d
                    weights += weight
                    if d < .02:
                        weak += weight
                    if min(slot_mass(a), slot_mass(b)) >= mass[root] * .025:
                        significant.append(d)
            scales.append({
                "divisions": divisions,
                "branchCount": len(frontier),
                "ancestorSlots": sum(slot[1] for slot in frontier),
                "coverage": sum(slot_mass(slot) for slot in frontier) / (mass[root] or 1),
                "meanContrast": total / weights if weights else None,
                "weakPairMass": weak / weights if weights else None,
                "minimumSignificantContrast": min(significant) if significant else None,
            })
        measurements[root] = {
            "visibleCount": len({v[0] for v in vertices}),
            "area": mass[root],
            "spread": max((lab_distance(anchor, sample) for sample in automatic), default=0.),
            "maxHueDrift": max(hue_drift, default=0.),
            "minimumChromaRatio": min((math.hypot(s[1], s[2]) / chroma for s in automatic),
                                      default=None) if chroma > .02 else None,
            "branches": scales,
        }
    return {"contacts": contacts, "families": measurements}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True, help="Saved optimizer input JSON")
    parser.add_argument("--palette", type=Path, help="JSON with colors and anchors; defaults to reference")
    args = parser.parse_args()
    capture = json.loads(args.input.read_text())
    palette = json.loads(args.palette.read_text()) if args.palette else capture["reference"]
    print(json.dumps(evaluate_colors(capture, palette), indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
