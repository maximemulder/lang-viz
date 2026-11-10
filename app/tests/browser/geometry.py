#!/usr/bin/env python3
"""Assert that inspected boundaries use the rendered fill source through LOD swaps."""
import json
from run import APP, browser_session, open_atlas, wait_for, SCENARIOS
from inspection import move


def main():
    output = APP / 'test-results/geometry'
    output.mkdir(parents=True, exist_ok=True)
    reports = []
    with browser_session(output) as (browser, origin):
        open_atlas(browser, origin)
        for name, config, center in [
            ('direct', SCENARIOS[0], [-1.5, 52.5]),
            ('aggregate', {'languageIds': ['abkh1242'],
                           'areaModes': {'abkh1242': 'descendants'},
                           'center': [40.8144, 43.2759], 'zoom': 4.4}, [40.8144, 43.2759]),
        ]:
            browser.js('window.overlapTest.configure(arguments[0])', config)
            browser.settled(60, fail_on_error=True)
            move(browser, center, click=True)
            wait_for(lambda: browser.js('return window.overlapTest.inspectionHighlight().variantIds.length > 0'), 20, 'outline')
            initial = browser.js('return window.overlapTest.inspectionHighlight()')
            assert initial['boundaryFeatures'] > 0, initial
            browser.js('window.overlapTest.watchGeometry(true)')
            for zoom in [7.4, 3.4]:
                browser.js('window.overlapTest.camera(arguments[0], arguments[1], 350)', center, zoom)
                browser.settled(60, fail_on_error=True)
                outline = browser.js('return window.overlapTest.inspectionHighlight()')
                assert outline['variantIds'] == initial['variantIds'], outline
                assert outline['boundaryFeatures'] > 0, outline
            state = browser.snapshot()
            frames = state['geometryFrames']
            assert any(f.get('outline') and f.get('source') for f in frames), frames
            assert any(f['boundaryFeatures'] > 0 for f in frames), frames
            assert not any(f['mismatch'] for f in frames), frames
            assert not state['errors'], state['errors']
            reports.append({'case': name, 'frames': frames})
            browser.js("document.querySelector('.language-inspector .maplibregl-popup-close-button')?.click()")
        (output / 'report.json').write_text(json.dumps(reports, indent=2) + '\n')
        print('Direct and aggregate outlines share the displayed fill source through fast zooms', flush=True)


if __name__ == '__main__':
    main()
