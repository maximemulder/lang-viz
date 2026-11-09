"""Independent, exhaustive local language comparisons on captured grid evidence.

Unlike the optimizer's sampled graph and averaged footprint contact, this uses
the shortest grid distance and every pair within 1.5 comparison reaches.
Distances and thresholds are engineering proxies, not perceptual guarantees.
"""
import math
import json
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'tests/browser'))
from color_evaluation import distance

PREFERRED = (
    '#d15264', '#ce5d1e', '#af7600', '#8f8600', '#559724', '#009b70',
    '#009696', '#0091b7', '#3683e0', '#7c71de', '#a661c4', '#c35599',
    '#fb7887', '#f8834a', '#df9700', '#b7ac00', '#7abd4f', '#00c58f',
    '#00bfc0', '#00b9e9', '#67aaff', '#9f99ff', '#cd86ec', '#ec7abf',
)


def prepare(capture):
    columns, rows = capture['view']['columns'], capture['view']['rows']
    owners = dict(capture['reference']['rootById'])
    overrides = capture['configuration'].get('overrides', {})
    occupied = defaultdict(set)
    for footprint in capture['view']['footprints']:
        language = footprint['languageId']
        if language not in owners:
            continue
        fixed = footprint.get('fixedColor', overrides.get(language))
        occupied[(language, fixed)].update(c for c in footprint['cells'] if 0 <= c < columns * rows)
    vertices = [(language, fixed, sorted(cells)) for (language, fixed), cells in sorted(
        occupied.items(), key=lambda pair: (pair[0][0], pair[0][1] or '')) if cells]
    population = defaultdict(int)
    for language, _, cells in vertices:
        for cell in cells:
            population[(owners[language], cell)] += 1
    areas = [sum(1 / population[(owners[language], cell)] for cell in cells)
             for language, _, cells in vertices]
    masks = [sum(1 << cell for cell in cells) for _, _, cells in vertices]
    scales = [.15 * math.sqrt(len(cells)) for _, _, cells in vertices]
    limit = (1 << (columns * rows)) - 1
    left = sum(1 << (y * columns) for y in range(rows))
    right = left << (columns - 1)
    def dilate(mask):
        horizontal = mask | ((mask & ~left) >> 1) | ((mask & ~right) << 1)
        return (horizontal | (horizontal >> columns) | (horizontal << columns)) & limit
    maximum = math.floor(1 + 1.5 * (.75 + 2 * max(scales, default=0)))
    dilations = []
    for mask in masks:
        levels = [mask]
        for _ in range(maximum):
            levels.append(dilate(levels[-1]))
        dilations.append(levels)
    pairs = []
    for i, (a, _, _) in enumerate(vertices):
        levels = dilations[i]
        for j in range(i + 1, len(vertices)):
            b = vertices[j][0]
            if a == b:
                continue
            scale = .75 + scales[i] + scales[j]
            reach = math.floor(1 + 1.5 * scale)
            if not levels[reach] & masks[j]:
                continue
            separation = next(k for k in range(reach + 1) if levels[k] & masks[j])
            weight = math.exp(-(max(0, separation - 1) / scale) ** 2)
            pairs.append((i, j, separation == 0, owners[a] == owners[b], weight))
    return vertices, areas, pairs


def evaluate(capture, palette, geometry=None):
    vertices, areas, pairs = geometry if geometry is not None else prepare(capture)
    colors = dict(palette['colors'])
    samples = [fixed or colors[language] for language, fixed, _ in vertices]
    categories = defaultdict(list)
    per_language = defaultdict(dict)
    for i, j, contact, within, weight in pairs:
        d = distance(samples[i], samples[j])
        kind = 'within' if within else 'between'
        target = .06 if within else .16
        value = (weight, d, max(0., 1 - d / target) ** 2)
        categories[(kind, 'contact' if contact else 'near')].append(value)
        categories[(kind, 'all')].append(value)
        for index, other in ((i, j), (j, i)):
            language = vertices[index][0]
            previous = per_language[kind].get(language, 1.)
            per_language[kind][language] = min(previous, d)
    report = {}
    for kind in ('within', 'between'):
        report[kind] = {}
        for band in ('contact', 'near', 'all'):
            values = categories[(kind, band)]
            total = sum(v[0] for v in values)
            report[kind][band] = {
                'pairs': len(values),
                'meanContrast': sum(w*d for w, d, _ in values) / total if total else None,
                'meanShortfall': sum(w*s for w, _, s in values) / total if total else None,
                'severeFraction': sum(w for w, d, _ in values if d < .025) / total if total else None,
            }
        worst = sorted(per_language[kind].values())
        report[kind]['languagesWithNeighbors'] = len(worst)
        report[kind]['languageSevereFraction'] = sum(d < .025 for d in worst) / len(worst) if worst else None
        report[kind]['p10WorstNeighbor'] = worst[math.floor(.1 * (len(worst)-1))] if worst else None
    automatic = [(sample, area) for sample, area, (_, fixed, _) in zip(samples, areas, vertices) if not fixed]
    penalties = [(min(distance(sample, color) for color in PREFERRED) / .08) ** 2 for sample, _ in automatic]
    total = sum(area for _, area in automatic)
    report['aesthetics'] = {
        'areaWeightedPenalty': sum(p * area for p, (_, area) in zip(penalties, automatic)) / total if total else 0.,
        'areaAboveOne': sum(area for p, (_, area) in zip(penalties, automatic) if p > 1) / total if total else 0.,
    }
    return report


def main():
    from color_evaluation import evaluate_colors
    output = Path(sys.argv[1])
    report = {}
    for scene in ('dlac', 'asher', 'asher-world'):
        capture = json.loads((output / f'{scene}-input.json').read_text())
        geometry = prepare(capture)
        report[scene] = {}
        for name in ('baseline', 'whole-family', 'spatial'):
            palette = json.loads((output / f'{name}-{scene}-palette.json').read_text())
            local = evaluate(capture, palette, geometry)
            existing = evaluate_colors(capture, palette)
            report[scene][name] = {'local': local, 'existing': existing}
            print(json.dumps({'scene': scene, 'variant': name,
                              'withinShortfall': local['within']['all']['meanShortfall'],
                              'withinSevereFraction': local['within']['all']['severeFraction'],
                              'contactShortfall': existing['contacts']['meanShortfall'],
                              'aestheticPenalty': local['aesthetics']['areaWeightedPenalty']}), flush=True)
    (output / 'evaluation.json').write_text(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
