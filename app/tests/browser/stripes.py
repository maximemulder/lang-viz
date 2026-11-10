#!/usr/bin/env python3
"""Check stripe density, zoom adaptation, reset and geometry preservation."""

import json

from run import APP, browser_session, check_state, open_atlas, wait_for


def thickness(browser, value):
    browser.js("""
        const input=document.querySelector('#stripe-thickness');
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,arguments[0]);
        input.dispatchEvent(new Event('input',{bubbles:true}));
    """, str(value))
    wait_for(lambda: browser.js("return Number(document.querySelector('#stripe-thickness').value)===arguments[0] && !window.overlapTest.snapshot().stripeTextures.pending", value), 20, str(value) + '% stripes')


def pixels(browser, radius=32):
    return browser.call('POST', '/execute/async', {
        'script': "const done=arguments[arguments.length-1];window.overlapTest.samplePixels([-4,52.3],arguments[0]).then(done)",
        'args': [radius],
    })


def edges(patch):
    # Count strong color changes along an interior row, including antialiased edges.
    row = patch[64 * 32 * 4:64 * 33 * 4]
    return sum(sum(abs(row[i+c]-row[i-4+c]) for c in range(3)) > 70 for i in range(4, len(row), 4))


def main():
    output = APP / 'test-results/stripes'
    results = {}
    with browser_session(output) as (browser, origin):
        open_atlas(browser, origin)
        browser.js("window.overlapTest.configure({languageIds:['stan1293','wels1247'],center:[-4,52.3],zoom:6.4})")
        browser.js("window.overlapTest.configureColors({strategy:'semantic',rootIds:[],anchors:{},overrides:{stan1293:'#d1495b',wels1247:'#3066be'}})")
        baseline = browser.settled(100)
        check_state(baseline, require_stripes=True)
        browser.js("document.querySelector('[aria-label=\"Map settings\"]').click()")
        browser.js("""
            const input=document.querySelector('#language-opacity');
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'100');
            input.dispatchEvent(new Event('input',{bubbles:true}));
        """)
        patches = {}
        for value, label in ((50, 'finer'), (65, 'intermediate'), (100, 'default'), (200, 'thicker')):
            thickness(browser, value)
            wait_for(lambda: browser.snapshot()['tilesLoaded'], 20, 'stripe images')
            patches[label] = pixels(browser)
            results[label] = edges(patches[label])
            browser.screenshot(output / f'high-{label}.png')
            state = browser.snapshot()
            assert state['coverageUrls'] == baseline['coverageUrls']
            assert len(state['reports']) == len(baseline['reports']), 'Thickness recomputed geometry'
            assert not state['errors'], state['errors']
        assert results['finer'] > results['intermediate'] > results['default'] > results['thicker'] > 0, results
        browser.js("document.querySelector('[aria-label=\"Reset stripe thickness\"]').click()")
        wait_for(lambda: browser.js("return document.querySelector('#stripe-thickness').value==='100'"), 10, 'default reset')
        wait_for(lambda: not browser.snapshot()['stripeTextures']['pending'], 20, 'reset textures')
        assert pixels(browser) == patches['default'], 'Reset must restore the original stripe pixels'

        thickness(browser, 200)
        browser.js("document.querySelector('input[name=map-overlap][value=blending]').click()")
        assert not browser.js("return !!document.querySelector('#stripe-thickness')")
        browser.js("document.querySelector('input[name=map-overlap][value=hatching]').click()")
        wait_for(lambda: browser.js("return document.querySelector('#stripe-thickness')?.value==='200'"), 10, 'retained thickness')
        thickness(browser, 100)
        browser.settled(100)
        browser.js("document.querySelector('[aria-label=\"Map settings\"]').click()")

        # Compare automatic low-zoom density against the former full-width pattern.
        browser.js("window.overlapTest.camera([-4,52.3],3.4)")
        check_state(browser.settled(100), require_stripes=True)
        low_default = pixels(browser, 4)
        browser.screenshot(output / 'low-default.png')
        browser.js("document.querySelector('[aria-label=\"Map settings\"]').click()")
        thickness(browser, 200)
        wait_for(lambda: browser.snapshot()['tilesLoaded'], 20, 'wide low-zoom stripes')
        assert pixels(browser, 4) != low_default, 'Low-zoom default must differ from full-width stripes'
        browser.screenshot(output / 'low-thicker.png')
        thickness(browser, 100)
        browser.js("document.querySelector('[aria-label=\"Map settings\"]').click()")
        browser.js("window.overlapTest.watchStripes([-4,52.3]);window.overlapTest.camera([-4,52.3],5.4,1600)")
        browser.settled(100)
        frames = browser.snapshot()['stripeFrames']
        assert frames and all(frame['shared'] for frame in frames), 'Overlap disappeared across a density step'
        results['zoomFrames'] = len(frames)
        browser.js('window.overlapTest.watchStripes(null)')

        browser.js('window.overlapTest.reloadStyle()')
        wait_for(lambda: not browser.snapshot()['styleReloading'] and browser.snapshot()['tilesLoaded'], 30, 'style restoration')
        check_state(browser.settled(100), require_stripes=True)
        browser.call('POST', '/window/rect', {'width': 520, 'height': 760})
        browser.js("document.querySelector('[aria-label=\"Map settings\"]').click()")
        browser.js("document.querySelector('#stripe-thickness').scrollIntoView({block:'nearest'})")
        assert browser.js("const r=document.querySelector('#stripe-thickness').getBoundingClientRect();const p=document.querySelector('.map-settings__panel').getBoundingClientRect();return r.width>0 && r.top>=p.top && r.bottom<=p.bottom")
        browser.screenshot(output / 'narrow-settings.png')

        browser.js("window.overlapTest.configure({languageIds:'all',center:[12,18],zoom:1.35})")
        world = browser.settled(100)
        check_state(world, require_stripes=True)
        results['worldPatterns'] = world['patternImages']
        thickness(browser, 200)
        wait_for(lambda: browser.snapshot()['tilesLoaded'], 20, 'dense world stripe update')
        after = browser.snapshot()
        assert after['coverageUrls'] == world['coverageUrls']
        assert after['patternImages'] == world['patternImages'], 'Thickness allocated extra sprites'
        assert len(after['reports']) == len(world['reports'])
        assert not after['errors'], after['errors']
        browser.screenshot(output / 'world-thicker.png')
        # Interrupt real generation in a dense view, then exercise repeated input.
        thickness(browser, 100)
        before = browser.snapshot()['stripeTextures']
        browser.js("""
            const input=document.querySelector('#stripe-thickness');
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'25');
            input.dispatchEvent(new Event('input',{bubbles:true}));
        """)
        wait_for(lambda: browser.snapshot()['stripeTextures']['generating'], 10, 'active texture computation')
        browser.js("""
            const values=[40,55,65,85,110,145,175,200,65];
            const input=document.querySelector('#stripe-thickness');
            const next=()=>{
                const value=values.shift();
                if(value===undefined) return;
                Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,String(value));
                input.dispatchEvent(new Event('input',{bubbles:true}));
                setTimeout(next,12);
            };
            next();
        """)
        wait_for(lambda: browser.js("return document.querySelector('#stripe-thickness').value==='65' && !window.overlapTest.snapshot().stripeTextures.pending"), 30, 'final slider input')
        final = browser.snapshot()
        jobs = final['stripeTextures']
        assert jobs['cancelled'] > before['cancelled'], 'Obsolete generation was not cancelled'
        assert jobs['lastCancelled']['generated'] < jobs['lastCancelled']['total'], jobs
        assert final['coverageUrls'] == world['coverageUrls']
        assert len(final['reports']) == len(world['reports'])
        assert not final['errors'], final['errors']
        results['cancellation'] = jobs
        (output / 'report.json').write_text(json.dumps(results, indent=2) + '\n')
    print('Stripe density, zoom steps, reset, mode switching and style restoration pass:', results)


if __name__ == '__main__':
    main()
