"""Build an offline comparison page from completed renders and evaluations."""
import json
import sys
from pathlib import Path

def write_review(out):
    evaluation = json.loads((out / 'evaluation.json').read_text())
    variants = json.loads((out / 'benchmark.json').read_text())['variants']
    chroma = any('chroma' in name for name in variants)
    rows = []
    for scene, label in [('dlac', 'DLAC'), ('asher', 'Regional Asher'), ('asher-world', 'World Asher')]:
        baseline, proposal = (evaluation[scene][variant]['local'] for variant in ('baseline', 'branches'))
        cells = [label]
        for key, percentage in [('meanShortfall', False), ('severeFraction', True)]:
            values = [item['within']['all'][key] for item in (baseline, proposal)]
            cells.append(' → '.join(f'{value * 100:.1f}%' if percentage else f'{value:.3f}' for value in values))
        cells.append(' → '.join(f"{item['aesthetics']['areaWeightedPenalty']:.3f}" for item in (baseline, proposal)))
        rows.append('<tr>' + ''.join('<td>' + cell + '</td>' for cell in cells) + '</tr>')
    summary = '<table><tr><th>View</th><th>Within-family shortfall ↓</th><th>Severe pair weight ↓</th><th>Aesthetic penalty ↓</th></tr>' + ''.join(rows) + '</table>'
    html = '''<!doctype html>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Branch color proof of concept</title>
    <style>
    body{font:16px system-ui;margin:24px;background:#f7f5ed;color:#20302d}
    h1{font-size:24px}nav{display:flex;gap:18px;flex-wrap:wrap;align-items:center;margin:18px 0}
    button,select{font:inherit;padding:8px;border:1px solid #aebbb5;border-radius:5px;background:white}
    button[aria-pressed=true]{background:#20302d;color:white}img{width:100%;max-width:1440px;height:auto}
    table{border-collapse:collapse;margin:16px 0}td,th{padding:8px 16px;text-align:left;border-bottom:1px solid #ccd4cf}p{max-width:900px;line-height:1.5}#result{font-weight:600}
    </style>
    <h1>Branch color proof of concept</h1>
    <p>Matched screenshots use identical family anchors, 82% opacity, and the light basemap.
    Switch variants to compare local detail and overall appearance. The application picker is unchanged.</p>
    <p>The proposal starts from the current picker and protects substantial branch averages while adjusting individual shades.
    The table shows current picker → proposal. These coarse-grid metrics are proxies, not human readability scores.</p>
    <!-- summary -->
    <nav>
    <label>View <select id="scene">
    <option value="europe">Europe, world palette</option><option value="africa">Africa, world palette</option>
    <option value="asher-world">Whole world</option><option value="asher">Regional Asher</option>
    <option value="dlac">DLAC</option></select></label>
    <button data-variant="baseline" aria-pressed="true">Current picker</button>
    <button data-variant="branches" aria-pressed="false">Branch references + aesthetics</button>
    <button data-variant="branches-no-aesthetic" aria-pressed="false">Branch references, no aesthetic cost</button>
    <button data-variant="spatial" aria-pressed="false">Whole region + spatial graph</button>
    </nav>
    <p id="result"></p><img id="comparison" alt="Matched map palette comparison">
    <p>Use arrow keys to switch variants. <a href="benchmark.json">Runtime measurements</a> ·
    <a href="evaluation.json">Independent evaluation</a>. Grid-based measurements approximate locality;
    they do not establish polygon adjacency or human perceptual thresholds.</p>
    <script>
    let variant=0;
    const buttons=[...document.querySelectorAll('button')];
    function update(){
    buttons.forEach((button,index)=>button.setAttribute('aria-pressed',index===variant));
    document.querySelector('#comparison').src=buttons[variant].dataset.variant+'-'+document.querySelector('select').value+'.png';
    document.querySelector('#result').textContent=buttons[variant].textContent;
    }
    buttons.forEach((button,index)=>button.onclick=()=>{variant=index;update()});
    document.querySelector('select').onchange=update;
    document.onkeydown=event=>{if(event.target.tagName==='SELECT')return;if(event.key==='ArrowRight'||event.key==='ArrowLeft'){
    variant=(variant+(event.key==='ArrowRight'?1:buttons.length-1))%buttons.length;update();event.preventDefault();}};
    update();
    </script>'''.replace('<!-- summary -->', summary)
    if chroma:
        html = html.replace('Branch color proof of concept', 'Prominence and chroma experiment')
        anchors = 'branches-chroma-anchors' in variants
        start = html.index('    <button data-variant=')
        end = html.index('    </nav>', start)
        labels = ['Current picker', 'Previous branch result', 'Chroma restraint', 'Stronger chroma restraint']
        if anchors:
            labels = ['Current picker', 'Previous branch result', 'Softer anchors only', 'Softer anchors + branch refinement']
        html = html[:start] + ''.join(f'<button data-variant="{name}" aria-pressed="false">{label}</button>' for name, label in zip(variants, labels)) + html[end:]
        start = html.index('    <p>The proposal')
        end = html.index('    <nav>', start)
        rows = []
        for scene, measurements in evaluation.items():
            for name in variants:
                m = measurements[name]['local']
                rows.append(f"<tr><td>{scene}</td><td>{name}</td><td>{m['chroma']['dominantMean']:.3f}</td><td>{m['chroma']['areaAbove018']:.1%}</td><td>{m['within']['all']['meanShortfall']:.3f}</td><td>{m['within']['all']['severeFraction']:.1%}</td></tr>")
        html = html[:start] + '<p>Chroma variants replace the old palette preference with a soft penalty on excessive chroma, stronger for large regions. Family anchors and bounds remain fixed. Metrics use underlying fill colors and coarse occupied-area estimates, not composited pixels or human judgments.</p><details><summary>Measurements</summary><table><tr><th>Scene</th><th>Variant</th><th>Dominant-region chroma</th><th>Area above 0.18</th><th>Local shortfall</th><th>Severe pairs</th></tr>' + ''.join(rows) + '</table></details>' + html[end:]
        if anchors:
            html = html.replace('identical family anchors, 82%', '82%')
            html = html.replace('Family anchors and bounds remain fixed.', 'This experiment recomputes family anchors and bounds; hidden family shades also follow the new anchors. Hue assignments can change.')
    (out / 'index.html').write_text(html)

if __name__ == '__main__':
    write_review(Path(sys.argv[1]))
