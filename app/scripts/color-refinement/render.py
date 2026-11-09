import json
import sys
from pathlib import Path
APP = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(APP / 'tests/browser'))
from run import browser_session, open_atlas
from sidebar import select_branches

out = Path(sys.argv[1]) if len(sys.argv) > 1 else APP / 'test-results/color-refinement'
with browser_session(out) as (browser, origin):
    open_atlas(browser, origin)
    for scene, source, center, zoom, projection in (
        ('dlac', 'DLAC', [108, 32], 3, 'globe'),
        ('asher', 'Asher', [100, 42], 2.6, 'globe'),
        ('asher-world', 'Asher', [20, 15], .4, 'mercator'),
    ):
        browser.js("window.overlapTest.configureColors({strategy:'semantic',rootIds:[],anchors:{},overrides:{}})")
        select_branches(browser, source, center, zoom=zoom)
        browser.js('''
            const toggle = document.querySelector('[aria-label="Map settings"]');
            if (toggle.getAttribute('aria-expanded') !== 'true') toggle.click();
            document.querySelector('input[name=map-projection][value='+arguments[0]+']').click();
            const input = document.querySelector('#language-opacity');
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '100');
            input.dispatchEvent(new Event('input', {bubbles:true}));
            input.dispatchEvent(new Event('change', {bubbles:true}));
            toggle.click();
        ''', projection)
        browser.settled(100)
        for name in ('baseline', 'whole-family', 'spatial'):
            palette = json.loads((out / f'{name}-{scene}-palette.json').read_text())
            before = browser.snapshot()
            browser.js("window.overlapTest.configureColors({strategy:'semantic',rootIds:[],anchors:{},overrides:arguments[0]})", palette['colors'])
            browser.settled(100)
            state = browser.snapshot()
            assert before['coverageUrls'] == state['coverageUrls']
            assert len(before['reports']) == len(state['reports'])
            browser.screenshot(out / f'{name}-{scene}.png')
            print(name, scene, flush=True)
        if scene == 'asher-world':
            for detail, center, zoom in [('europe', [15,50], 3), ('africa', [20,5], 2.4)]:
                browser.js('window.overlapTest.camera(arguments[0],arguments[1])', center, zoom)
                browser.settled(100)
                for name in ('baseline', 'whole-family', 'spatial'):
                    palette = json.loads((out / f'{name}-{scene}-palette.json').read_text())
                    browser.js("window.overlapTest.configureColors({strategy:'semantic',rootIds:[],anchors:{},overrides:arguments[0]})", palette['colors'])
                    browser.settled(100)
                    browser.screenshot(out / f'{name}-{detail}.png')
                    print(name, detail, flush=True)

(out / 'index.html').write_text('''<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Color refinement comparison</title>
<style>
body{font:16px system-ui;margin:24px;background:#f7f5ed;color:#20302d}
h1{font-size:24px}nav{display:flex;gap:18px;flex-wrap:wrap;align-items:center;margin:18px 0}
button,select{font:inherit;padding:8px;border:1px solid #aebbb5;border-radius:5px;background:white}
button[aria-pressed=true]{background:#20302d;color:white}img{width:100%;max-width:1440px;height:auto}
p{max-width:900px;line-height:1.5}#result{font-weight:600}
</style>
<h1>Color refinement comparison</h1>
<p>Matched screenshots use identical family anchors and starting palettes.
Switch variants to compare local detail and overall appearance. The application picker is unchanged.</p>
<nav>
<label>View <select id="scene">
<option value="europe">Europe, world palette</option><option value="africa">Africa, world palette</option>
<option value="asher-world">Whole world</option><option value="asher">Regional Asher</option>
<option value="dlac">DLAC</option></select></label>
<button data-variant="baseline" aria-pressed="true">Current picker</button>
<button data-variant="whole-family" aria-pressed="false">Whole family region</button>
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
variant=(variant+(event.key==='ArrowRight'?1:2))%3;update();event.preventDefault();}};
update();
</script>''')
