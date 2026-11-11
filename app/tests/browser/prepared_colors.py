"""Exercise prepared defaults, provenance selection, overrides and fallback in the app."""
import json
from contextlib import contextmanager
from tempfile import TemporaryDirectory
from pathlib import Path
from run import APP, browser_session, open_atlas, wait_for
from sidebar import select_branches, add_selected
from colors import color_state, color_controls, button, optimize

out=APP/'test-results/prepared-colors'
manifest=json.loads((APP/'public/data/manifest.json').read_text())
metadata=json.loads((APP/'public/data'/manifest['datasetMetadata']).read_text())
language_ids=[language['id'] for language in json.loads((APP/'public/data/languages.json').read_text())]
profiles={f"{dataset['id']}/{profile['viewId']}":dict(zip(language_ids,profile['colors']))
          for dataset in metadata['datasets'] for profile in dataset['profiles']}
def palette(profile):
    return profiles[profile]
def ready(browser, profile):
    wait_for(lambda: color_state(browser,[])['preparedProfile']==profile,15,'prepared palette '+profile)
def configure(browser, overrides=None, anchors=None, roots=None):
    browser.js("window.overlapTest.configureColors(arguments[0])",{'strategy':'semantic','rootIds':roots or [],'anchors':anchors or {},'overrides':overrides or {}})

def global_optimize(browser, profile, move=False, overrides=None):
    color_controls(browser)
    button(browser, 'Optimize full dataset')
    if move:
        browser.js('window.overlapTest.camera([105,35],4)')
        browser.call('POST', '/window/rect', {'width': 1280, 'height': 900})
    def done():
        error=browser.js("return document.querySelector('.color-controls [role=alert]')?.textContent")
        assert not error, error
        state=color_state(browser,[])['optimization']
        busy=browser.js("return [...document.querySelectorAll('.color-controls button')].some(b=>b.textContent.trim()==='Cancel')")
        return not busy and state and state.get('datasetProfile')==profile
    wait_for(done,60,'canonical full-dataset optimization')
    expected={**palette(profile), **(overrides or {})}
    assert color_state(browser,list(expected))['colors']==expected, 'Global worker differs from offline defaults'
    browser.settled(100)

@contextmanager
def metadata_session():
    # Instrument initial requests before the app starts, without changing production assets.
    with TemporaryDirectory(prefix='atlas-metadata-') as temporary:
        site=Path(temporary)
        for child in (APP/'dist').iterdir():
            if child.name!='index.html': (site/child.name).symlink_to(child)
        instrumentation="""<script>
            const fetchOriginal=window.fetch;
            const mode=new URLSearchParams(location.search).get('metadata-test');
            window.metadataRequests=0;
            window.paletteRequests=0;
            window.fetch=(input,...args)=>{
              const url=String(input);
              if(url.includes('/palettes/')) {
                window.paletteRequests++;
                throw new Error('Retired palette endpoint requested');
              }
              if(!url.includes('/dataset-metadata/')) return fetchOriginal(input,...args);
              window.metadataRequests++;
              if(mode==='hold') return new Promise(resolve=>{
                window.releaseMetadata=()=>resolve(fetchOriginal(input,...args));
              });
              if(mode==='missing') return Promise.resolve(new Response('',{status:404}));
              if(mode==='corrupt') return fetchOriginal(input,...args).then(async response=>{
                const metadata=await response.json();
                metadata.datasets[0].profiles[0].colors.pop();
                return new Response(JSON.stringify(metadata));
              });
              return fetchOriginal(input,...args);
            };
        </script>"""
        (site/'index.html').write_text((APP/'dist/index.html').read_text().replace('<head>','<head>'+instrumentation))
        with browser_session(out,out_dir=site) as session:
            yield session

with metadata_session() as (browser,origin):
    browser.call('POST','/url',{'url':origin+'/?overlap-test=1&overlap-basemap=off&metadata-test=hold'})
    wait_for(lambda: browser.js('return !!window.releaseMetadata'),15,'initial dataset metadata')
    assert browser.js("return !!document.querySelector('.language-finder--loading')")
    assert not browser.js('return !!window.overlapTest'), 'Geometry became ready before dataset metadata'
    assert not browser.js("return performance.getEntriesByType('resource').some(r=>r.name.includes('.pmtiles'))")
    browser.js('window.releaseMetadata()')
    wait_for(lambda: browser.js('return !!window.overlapTest'),30,'complete atlas metadata')
    # Selection publishes geometry and colors in the same synchronous state update.
    for dataset,language in [('asher2007world','stan1293'),('dlac1987china','mand1415'),('asher2007world','stan1293')]:
        state=browser.js("""
            window.overlapTest.configure({languageIds:[arguments[1]],sources:[arguments[0]],center:[100,32],zoom:3});
            return {colors:window.overlapTest.colorState([arguments[1]]),entries:window.overlapTest.mapEntryState()};
        """,dataset,language)
        profile=dataset+'/contemporary'
        assert state['colors']['preparedProfile']==profile, state
        assert state['colors']['colors']=={language:palette(profile)[language]}, state
        assert state['entries'] and all(e['color']==palette(profile)[e['languageId']] for e in state['entries']), state
    assert browser.js('return window.metadataRequests')==1
    assert browser.js('return window.paletteRequests')==0
    # Exercise the normal selection UI and optimization on a fresh catalog load.
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
    # Cancel stops the worker without publishing a partial palette.
    color_controls(browser)
    button(browser,'Optimize full dataset')
    button(browser,'Cancel')
    wait_for(lambda: not browser.js("return [...document.querySelectorAll('.color-controls button')].some(b=>b.textContent.trim()==='Cancel')"),10,'global cancellation')
    assert color_state(browser,[])['optimization'] is None
    assert color_state(browser,ids)['colors']==expected
    # Rebuilding globally is exactly equal for every catalog color, despite camera/size changes.
    global_optimize(browser,'dlac1987china/contemporary',move=True)
    button(browser,'Use default palette')
    # Exact overrides survive a canonical solve, which still uses the default recipe.
    configure(browser,overrides={'mand1415':'#123456'})
    global_optimize(browser,'dlac1987china/contemporary',overrides={'mand1415':'#123456'})
    button(browser,'Use default palette')
    configure(browser)
    baseline=browser.snapshot()
    optimize(browser,ids)
    optimized=color_state(browser,ids)['colors']
    assert all(entry['color']==optimized[entry['languageId']] for entry in browser.js('return window.overlapTest.mapEntryState()'))
    color_controls(browser)
    button(browser,'Use default palette')
    assert color_state(browser,ids)['colors']==expected
    button(browser,'Undo colors')
    assert color_state(browser,[])['optimization']
    # A global solve replaces the regional result; undo restores that regional result.
    global_optimize(browser,'dlac1987china/contemporary')
    button(browser,'Undo colors')
    assert color_state(browser,ids)['colors']==optimized
    button(browser,'Use default palette')
    assert color_state(browser,ids)['colors']==expected
    assert browser.snapshot()['coverageUrls']==baseline['coverageUrls']
    configure(browser,anchors={'sino1245':'#287cb8'})
    wait_for(lambda: color_state(browser,[])['preparedProfile'] is None,10,'custom anchor fallback')
    assert color_state(browser,['sino1245'])['colors']['sino1245']=='#287cb8'
    assert browser.js("return [...document.querySelectorAll('.color-controls button')].find(b=>b.textContent.trim()==='Optimize full dataset').disabled")
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
    global_optimize(browser,'asher2007world/contemporary')
    button(browser,'Use default palette')
    browser.screenshot(out/'asher-prepared.png')
    assert browser.js('return window.metadataRequests')==1
    assert browser.js('return window.paletteRequests')==0
    # Required metadata fails the catalog as a whole instead of substituting another palette.
    for mode in ['missing','corrupt']:
        browser.call('POST','/url',{'url':origin+'/?overlap-test=1&overlap-basemap=off&metadata-test='+mode})
        wait_for(lambda: browser.js("return document.querySelector('.workspace-error[role=alert] h2')?.textContent === 'Unable to open atlas data'"),20,'invalid metadata error')
        error = browser.js("return document.querySelector('.workspace-error p').textContent")
        assert '404' in error if mode == 'missing' else 'Invalid dataset metadata' in error, error
        assert browser.js("return [...document.querySelectorAll('.workspace-error button')].some(button => button.textContent === 'Retry atlas data')")
        assert browser.js("return document.querySelectorAll('.workspace-nav button').length === 2")
        assert not browser.js('return !!window.overlapTest')
        assert not browser.js("return performance.getEntriesByType('resource').some(r=>r.name.includes('.pmtiles'))")
    (out/'report.json').write_text(json.dumps({'preparedProfiles':list(profiles),'defaultUndoOverridesNavigation':'passed','globalEqualsPrecomputedAllCatalogColors':'passed','metadataBeforeGeometryAndSynchronousSelection':'passed','invalidMetadataRejectsCatalog':'passed'},indent=2))
