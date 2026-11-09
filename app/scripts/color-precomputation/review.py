"""Create a self-contained index of the app screenshots and measured tradeoffs."""
import json
import sys
from pathlib import Path

def write_review(out):
    variants = json.loads((out / 'benchmark.json').read_text())['variants']
    evaluation = json.loads((out / 'evaluation.json').read_text()) if (out / 'evaluation.json').exists() else {}
    html = '''<!doctype html><meta charset="utf-8"><title>Precomputed color comparison</title>
<style>body{font:16px system-ui;margin:24px;background:#f7f5ed;color:#20302d}button,select{font:inherit;padding:8px;margin:5px}img{width:100%}button[aria-pressed=true]{background:#20302d;color:white}p{max-width:1000px;line-height:1.5}td,th{padding:8px;text-align:left;border-bottom:1px solid #ccc}table{border-collapse:collapse}</style>
<h1>Precomputed color comparison</h1>
<p>Identical geometry and 82% opacity within each camera. Live is optimized for the captured view. Captured world reuses a single overview palette (DLAC reuses its regional capture). Geometry palettes use the complete dataset at two grid resolutions. Multi-view patches regional Asia into geometry-64 with fixed family anchors.</p>
<p>Europe and Africa are held-out views. There, Live reuses the world palette; Live local shows a fresh solve for that camera. Palette colors are frozen across cameras. Shortfall and severe-pair weight measure local within-family contrast; lower is better. These are engineering proxies, not human readability scores.</p>
<select id="scene"><option>asher</option><option>asher-world</option><option>dlac</option><option>europe</option><option>africa</option></select><nav></nav><p id="metrics"></p><img id="comparison" alt="Map palette comparison">
<p><a href="benchmark.json">Preparation and parsing measurements</a> · <a href="evaluation.json">Independent quality measurements</a></p>
<script>const variants=VARIANTS, evaluation=EVALUATION;let current='geometry-64';const nav=document.querySelector('nav');
function update(){const scene=document.querySelector('select').value;const held=['europe','africa'].includes(scene);if(!held&&current==='live-local')current='geometry-64';
document.querySelector('#comparison').src=current+'-'+scene+'.png';
for(const b of nav.children){b.hidden=b.dataset.variant==='live-local'&&!held;b.setAttribute('aria-pressed',b.dataset.variant===current)}
const m=evaluation[scene]?.[current]?.local;document.querySelector('#metrics').textContent=m?'Within-family shortfall: '+m.within.all.meanShortfall.toFixed(3)+' · Severe pair weight: '+(100*m.within.all.severeFraction).toFixed(1)+'% · Dominant-language chroma: '+m.chroma.dominantMean.toFixed(3):'';}
for(const name of [...variants,'live-local']){const b=document.createElement('button');b.dataset.variant=name;b.textContent=name;b.onclick=()=>{current=name;update()};nav.append(b)}document.querySelector('select').onchange=update;update();</script>'''
    (out / 'review.html').write_text(html.replace('VARIANTS',json.dumps(variants)).replace('EVALUATION',json.dumps(evaluation)))

if __name__ == '__main__':
    write_review(Path(sys.argv[1]))
