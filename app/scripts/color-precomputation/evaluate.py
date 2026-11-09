"""Independent metrics for training views and held-out Europe/Africa captures."""
import json
import sys
from pathlib import Path
from review import write_review
APP = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(APP / 'scripts/color-refinement'))
from local_evaluation import prepare, evaluate
from color_evaluation import evaluate_colors

out = Path(sys.argv[1]) if len(sys.argv)>1 else APP / 'test-results/color-precomputation'
variants = json.loads((out / 'benchmark.json').read_text())['variants']
report = {}
for scene in ['dlac','asher','asher-world','europe','africa']:
    path = out / f'{scene}-input.json'
    if not path.exists():
        continue
    capture = json.loads(path.read_text())
    geometry = prepare(capture)
    report[scene] = {}
    for name in variants + (['live-local'] if scene in ['europe','africa'] else []):
        palette = json.loads((out / f'{name}-{scene}-palette.json').read_text())
        local = evaluate(capture,palette,geometry)
        report[scene][name] = {'local':local, 'existing':evaluate_colors(capture,palette)}
        print(scene,name, 'within shortfall',round(local['within']['all']['meanShortfall'],3),
              'severe',round(local['within']['all']['severeFraction'],3),
              'dominant chroma',round(local['chroma']['dominantMean'],3),flush=True)
(out / 'evaluation.json').write_text(json.dumps(report,indent=2))

write_review(out)
