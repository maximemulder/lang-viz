import json
import sys
from pathlib import Path
from review import write_review
APP = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(APP / 'tests/browser'))
from run import browser_session, open_atlas
from sidebar import select_branches
from colors import optimize

out = Path(sys.argv[1]) if len(sys.argv) > 1 else APP / 'test-results/color-precomputation'
variants = json.loads((out / 'benchmark.json').read_text())['variants']
rendered = {}
with browser_session(out) as (browser, origin):
    open_atlas(browser, origin, terrain=True)
    browser.js("""
        const send=Worker.prototype.postMessage;
        Worker.prototype.postMessage=function(message,...args) {
            if(message?.view?.footprints && message?.reference?.colors) window.colorTestInput=message;
            return send.call(this,message,...args);
        };
    """)
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
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '82');
            input.dispatchEvent(new Event('input', {bubbles:true}));
            input.dispatchEvent(new Event('change', {bubbles:true}));
            document.querySelector('input[name=map-background][value=minimal]').click();
            toggle.click();
        ''', projection)
        browser.settled(100)
        capture = json.loads((out / f'{scene}-input.json').read_text())
        entries = browser.js('return window.overlapTest.mapEntryState()')
        entry_ids = {entry['id'] for entry in entries}
        assert all(footprint['id'] in entry_ids for footprint in capture['view']['footprints'])
        rendered[scene] = {'source': source, 'period': 'contemporary', 'center': center,
                           'zoom': zoom, 'projection': projection, 'entryIds': sorted(entry_ids)}
        for name in variants:
            palette = json.loads((out / f'{name}-{scene}-palette.json').read_text())
            before = browser.snapshot()
            browser.js("window.overlapTest.configureColors({strategy:'semantic',rootIds:[],anchors:{},overrides:arguments[0]})", palette['colors'])
            browser.settled(100)
            state = browser.snapshot()
            assert before['coverageUrls'] == state['coverageUrls']
            assert len(before['reports']) == len(state['reports'])
            actual = browser.js('return window.overlapTest.colorState(arguments[0]).colors', list(palette['colors']))
            assert actual == palette['colors']
            assert {entry['id'] for entry in browser.js('return window.overlapTest.mapEntryState()')} == entry_ids
            browser.screenshot(out / f'{name}-{scene}.png')
            print(name, scene, flush=True)
        if scene == 'asher-world':
            for detail, center, zoom in [('europe', [15,50], 3), ('africa', [20,5], 2.4)]:
                browser.js('window.overlapTest.camera(arguments[0],arguments[1])', center, zoom)
                browser.settled(100)
                for name in variants:
                    palette = json.loads((out / f'{name}-{scene}-palette.json').read_text())
                    browser.js("window.overlapTest.configureColors({strategy:'semantic',rootIds:[],anchors:{},overrides:arguments[0]})", palette['colors'])
                    browser.settled(100)
                    browser.screenshot(out / f'{name}-{detail}.png')
                    print(name, detail, flush=True)
                    (out / f'{name}-{detail}-palette.json').write_text(json.dumps(palette))
                # Held-out views: no palette training uses these captures.
                browser.js("window.overlapTest.configureColors({strategy:'semantic',rootIds:[],anchors:{},overrides:{}})")
                ids = list(palette['colors'])
                optimize(browser, ids, out, detail)
                (out / f'{detail}-palette.json').rename(out / f'live-local-{detail}-palette.json')
                browser.screenshot(out / f'live-local-{detail}.png')
                print('held-out capture', detail, flush=True)

(out / 'render-settings.json').write_text(json.dumps({'opacity': .82, 'basemap': 'minimal', 'variants': variants, 'scenes': rendered}, indent=2))
write_review(out)
