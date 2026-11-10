"""Independent source/period groups and colors through the actual sidebar controls."""
from run import check_state, wait_for
from sidebar import add_selected, clear_selection, open_details, search, select_control, select_result, sources, view


def check_comparisons(browser, output):
    def state():
        return browser.js('return window.overlapTest.mapEntryState()')

    def period(value):
        view(browser, 'explore')
        select_control(browser, '.finder-filters__period select', value)

    def color(entry_id, value):
        browser.js("""
            const card=[...document.querySelectorAll('.map-entry-card')].find(e=>e.dataset.entryId===arguments[0]);
            const input=card.querySelector('input[type=color]');
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,arguments[1]);
            input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));
        """, entry_id, value)
        wait_for(lambda: any(e['id']==entry_id and e['color']==value for e in state()), 10, 'entry color')

    browser.js('window.overlapTest.configure({languageIds:[],center:[10.5,51],zoom:5})')
    search(browser, 'stan1295', 'stan1295')
    select_result(browser, 'stan1295')
    browser.js("document.querySelector('.finder-bulk__coverage').open=true")
    select_control(browser, '[aria-label="Coverage for selected entries"]', 'own')
    open_details(browser)
    add_selected(browser)
    wait_for(lambda: not browser.snapshot()['moving'], 10, 'profile framing')
    browser.js('window.overlapTest.camera([10.5,51],5)')
    contemporary = state()[0]
    period('all')
    select_control(browser, '.language-row__variant', 'asher2007world:traditional:stan1295')
    assert len(state()) == 1
    add_selected(browser)
    assert len(state()) == 2
    traditional = next(e for e in state() if 'traditional' in e['variantIds'][0])
    sources(browser, 'DiACL')
    period('year-1750')
    add_selected(browser)
    wait_for(lambda: len(state()) == 3, 10, 'three German representations')
    entries_before = state()
    check_state(browser.settled(60), require_stripes=True)
    assert set(browser.js('return window.overlapTest.inspect([10.5,51]).variantIds')) == {e['id'] for e in entries_before}
    assert len({e['group']['id'] for e in entries_before}) == 3
    before_filters = browser.snapshot()
    sources(browser, 'DLAC')
    assert state() == entries_before
    assert browser.js("return document.querySelector('.finder-add').disabled")
    assert browser.snapshot()['coverageUrls'] == before_filters['coverageUrls']
    color(contemporary['id'], '#ff0000')
    color(traditional['id'], '#0000ff')
    assert browser.snapshot()['coverageUrls'] == before_filters['coverageUrls']
    assert len(browser.snapshot()['reports']) == len(before_filters['reports'])
    browser.js("""
        const input=document.querySelector('#language-opacity');
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'100');
        input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));
    """)
    def pixels():
        rgba=browser.call('POST','/execute/async', {'script':'const done=arguments[arguments.length-1];window.overlapTest.samplePixels([10.5,51],10).then(done);','args':[]})
        return {tuple(rgba[i:i+4]) for i in range(0,len(rgba),4)}
    wait_for(lambda: {(255,0,0,255),(0,0,255,255)} <= pixels(), 15, 'comparison stripe colors')
    view(browser, 'map')
    wait_for(lambda: browser.js("return document.querySelectorAll('.on-map-group').length") == 3, 10, 'three source/period groups')
    browser.screenshot(output / 'comparison-german.png')
    browser.js("""
        const input=document.querySelector('#language-panel-map input[type=search]');
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'1750');input.dispatchEvent(new Event('input',{bubbles:true}));
    """)
    wait_for(lambda: browser.js("return document.querySelectorAll('.on-map-group').length") == 1, 10, 'period search')
    browser.js("document.querySelector('.on-map-group__identity').click()")
    wait_for(lambda: browser.js("return !!document.querySelector('.focused-map-entry')"), 10, 'exact pinned inspection')
    focused = browser.js("return document.querySelector('.focused-map-entry').dataset.groupId")
    assert focused == next(e['group']['id'] for e in state() if e['id'] not in {contemporary['id'], traditional['id']})
    browser.js("document.querySelector('.on-map-group .on-map-row__remove').click()")
    wait_for(lambda: len(state()) == 2, 10, 'remove one source/period group')
    assert {e['id'] for e in state()} == {contemporary['id'], traditional['id']}
    browser.js("document.querySelector('.finder-detail__more').open=true;document.querySelector('[aria-label=\"Change sources and period\"]').click()")
    wait_for(lambda: browser.js("return !document.querySelector('#language-panel-explore').hidden && document.querySelector('.finder-options').open"), 10, 'edit geography')
    assert browser.js("return document.activeElement===document.querySelector('.finder-options > summary')")

    # Two complete family groups preserve their own source coverage and styles.
    browser.js('window.overlapTest.configure({languageIds:[],center:[112,28],zoom:6})')
    search(browser, 'sino1245', 'sino1245')
    select_result(browser, 'sino1245')
    sources(browser, 'DLAC')
    add_selected(browser)
    dlac = state()
    assert all(e['variantIds'][0].startswith('dlac1987china:') for e in dlac)
    sources(browser, 'Asher')
    add_selected(browser)
    both = state()
    assert {e['group']['id'] for e in both} != {e['group']['id'] for e in dlac}
    assert len({e['group']['id'] for e in both}) == 2
    # Pinned sources and explicit styles survive; automatic colors can change
    # when a mixed-source selection switches away from a dataset's prepared palette.
    assert [{k: v for k, v in e.items() if k != 'color'} for e in both[:len(dlac)]] == [
        {k: v for k, v in e.items() if k != 'color'} for e in dlac
    ]
    coverage = wait_for(lambda: (s if (s := browser.snapshot())['status'] in ('ready', 'error') and s['mapLoaded'] and s['tilesLoaded'] and not s['moving'] else None), 45, 'terminal mixed-source coverage')
    coverage_outcome = check_state(coverage, require_stripes=coverage['status'] == 'ready')
    # Large mixed-source branches may hit the existing renderer budgets; pinning must survive.
    assert state() == both
    print(f"Full Sino-Tibetan source comparison coverage: {coverage_outcome}", flush=True)
    add_selected(browser)
    assert state() == both
    view(browser, 'map')
    # Clear map acts on all groups even when its search hides them.
    browser.js("document.querySelector('.on-map-actions button').click()")
    wait_for(lambda: not state(), 10, 'clear hidden comparisons')
    view(browser, 'explore')
    clear_selection(browser)
    print('Source/period groups, comparison pixels, exact inspection and pinned coverage passed', flush=True)
    return {'germanGroups':3, 'familySourceGroups':2, 'familyCoverage':coverage_outcome, 'independentColors':'passed'}
