"""Exercise prepared defaults, provenance selection, overrides and fallback in the app."""
import json
from pathlib import Path
from run import APP, browser_session, open_atlas, wait_for
from sidebar import select_branches, add_selected
from colors import color_state, color_controls, button, optimize

out=APP/'test-results/prepared-colors'
manifest=json.loads((APP/'public/data/manifest.json').read_text())
profiles={p['id']:p for p in manifest['preparedColors']['profiles']}
def palette(profile):
    return json.loads((APP/'public/data'/profiles[profile]['file']).read_text())['colors']
def ready(browser, profile):
    wait_for(lambda: color_state(browser,[])['preparedProfile']==profile,15,'prepared palette '+profile)
def configure(browser, overrides=None, anchors=None, roots=None):
    browser.js("window.overlapTest.configureColors(arguments[0])",{'strategy':'semantic','rootIds':roots or [],'anchors':anchors or {},'overrides':overrides or {}})

with browser_session(out) as (browser,origin):
    open_atlas(browser,origin)
    select_branches(browser,'DLAC',[108,32],zoom=3)
    ready(browser,'dlac1987china/contemporary')
    ids=[entry['languageId'] for entry in browser.js('return window.overlapTest.mapEntryState()')]+['sino1245','tibe1272']
    expected={id:palette('dlac1987china/contemporary')[id] for id in ids}
    assert color_state(browser,ids)['colors']==expected
    assert all(entry['color']==expected[entry['languageId']] for entry in browser.js('return window.overlapTest.mapEntryState()'))
    baseline=browser.snapshot()
    browser.screenshot(out/'dlac-prepared.png')
    configure(browser,overrides={'mand1415':'#123456'})
    assert color_state(browser,['mand1415'])['colors']['mand1415']=='#123456'
    configure(browser)
    ready(browser,'dlac1987china/contemporary')
    assert color_state(browser,ids)['colors']==expected
    optimize(browser,ids)
    optimized=color_state(browser,ids)['colors']
    assert all(entry['color']==optimized[entry['languageId']] for entry in browser.js('return window.overlapTest.mapEntryState()'))
    color_controls(browser)
    button(browser,'Use default palette')
    assert color_state(browser,ids)['colors']==expected
    button(browser,'Undo colors')
    assert color_state(browser,[])['optimization']
    button(browser,'Use default palette')
    assert color_state(browser,ids)['colors']==expected
    assert browser.snapshot()['coverageUrls']==baseline['coverageUrls']
    configure(browser,anchors={'sino1245':'#287cb8'})
    wait_for(lambda: color_state(browser,[])['preparedProfile'] is None,10,'custom anchor fallback')
    assert color_state(browser,['sino1245'])['colors']['sino1245']=='#287cb8'
    configure(browser)
    ready(browser,'dlac1987china/contemporary')
    browser.js('window.overlapTest.camera([100,30],4)')
    browser.settled(100)
    assert color_state(browser,ids)['colors']==expected
    # Browse another source without removing pinned DLAC entries.
    browser.js("document.querySelector('.source-filter__trigger').click()")
    browser.js("[...document.querySelectorAll('.source-filter__actions button')].find(b=>b.textContent==='Clear').click()")
    browser.js("[...document.querySelectorAll('.source-filter__option')].find(l=>l.querySelector('strong').textContent==='Asher').querySelector('input').click();document.querySelector('.source-filter__trigger').click()")
    assert color_state(browser,ids)['colors']==expected
    # Pin the new source as well: mixed-source comparisons cannot use one dataset table.
    add_selected(browser)
    wait_for(lambda: color_state(browser,[])['preparedProfile'] is None,15,'mixed-source fallback')
    assert len({e['context']['sources'][0] for e in browser.js('return window.overlapTest.mapEntryState()')})>=2
    select_branches(browser,'Asher',[100,42],zoom=2.6)
    ready(browser,'asher2007world/contemporary')
    ids=['stan1293','mand1415','sino1245','indo1319']
    assert color_state(browser,ids)['colors']=={id:palette('asher2007world/contemporary')[id] for id in ids}
    browser.screenshot(out/'asher-prepared.png')
    # Fresh page clears successful-load cache. A missing optional asset must not break rendering.
    open_atlas(browser,origin)
    browser.js("""
        const original=window.fetch;
        window.paletteFailures=0;
        window.fetch=(input,...args)=>{
          if(String(input).includes('/palettes/')){window.paletteFailures++;return Promise.resolve(new Response('',{status:404}))}
          return original(input,...args);
        };
    """)
    select_branches(browser,'DLAC',[108,32],zoom=3)
    wait_for(lambda: browser.js('return window.paletteFailures>0'),10,'missing palette request')
    browser.settled(100)
    state=color_state(browser,['mand1415'])
    assert state['preparedProfile'] is None
    assert state['colors']['mand1415'].startswith('#')
    assert not browser.js("return document.querySelector('.color-controls [role=alert]')?.textContent")
    (out/'report.json').write_text(json.dumps({'preparedProfiles':list(profiles),'defaultUndoOverridesNavigationAndFallback':'passed'},indent=2))
