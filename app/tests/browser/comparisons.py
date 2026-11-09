"""Exercise independent source/period entries through the actual sidebar controls."""

from run import check_state, wait_for
from sidebar import open_details, search, view


def check_comparisons(browser, output):
    def state():
        return browser.js("return window.overlapTest.mapEntryState()")

    def select(selector, value):
        browser.js("""
            const input = document.querySelector(arguments[0]);
            input.value = arguments[1];
            input.dispatchEvent(new Event('change', {bubbles:true}));
        """, selector, value)

    def period(value):
        view(browser, 'explore')
        select('.finder-filters__period select', value)

    def source(short_name):
        view(browser, 'explore')
        browser.js("document.querySelector('.finder-options').open = true")
        browser.js("document.querySelector('.source-filter__trigger').click()")
        browser.js("[...document.querySelectorAll('.source-filter__actions button')].find(b=>b.textContent==='Clear').click()")
        browser.js("""
            [...document.querySelectorAll('.source-filter__option')]
              .find(label=>label.querySelector('strong').textContent===arguments[0]).querySelector('input').click();
        """, short_name)
        browser.js("document.querySelector('.source-filter__trigger').click()")

    def add():
        browser.js("document.querySelector('.detail-selection button').click()")

    def color(entry_id, value):
        browser.js("""
            const card = [...document.querySelectorAll('.map-entry-card')].find(e=>e.dataset.entryId===arguments[0]);
            const input = card.querySelector('input[type=color]');
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input, arguments[1]);
            input.dispatchEvent(new Event('input',{bubbles:true}));
            input.dispatchEvent(new Event('change',{bubbles:true}));
        """, entry_id, value)
        wait_for(lambda: any(e['id'] == entry_id and e['color'] == value for e in state()), 10, 'entry color')

    browser.js("window.overlapTest.configure({languageIds:[],center:[10.5,51],zoom:5})")
    search(browser, 'stan1295', 'stan1295')
    open_details(browser)
    add()
    contemporary = state()[0]
    # With both Asher periods browsable, the source picker adds another pinned representation.
    period('all')
    select('.language-row__variant', 'asher2007world:traditional:stan1295')
    assert len(state()) == 1 and state()[0]['variantIds'] == contemporary['variantIds']
    add()
    assert len(state()) == 2
    traditional = next(e for e in state() if 'traditional' in e['variantIds'][0])
    assert contemporary['languageId'] == traditional['languageId']
    assert contemporary['id'] != traditional['id']
    # Different dataset and period, without touching either Asher entry.
    source('DiACL')
    period('year-1750')
    add()
    wait_for(lambda: len(state()) == 3, 10, 'three German representations')
    entries_before = state()
    settled = browser.settled(60)
    check_state(settled, require_stripes=True)
    expected_ids = {entry['id'] for entry in entries_before}
    assert set(browser.js('return window.overlapTest.inspect([10.5,51]).variantIds')) == expected_ids
    assert len(browser.js('return [...document.querySelectorAll(".map-entry-card")]')) == 3

    # All source filters can be empty while existing map geometry remains unchanged.
    before_filters = browser.snapshot()
    source('DLAC')
    assert state() == entries_before
    assert browser.snapshot()['selectedCount'] == 3
    assert browser.snapshot()['coverageUrls'] == before_filters['coverageUrls']
    assert len(browser.snapshot()['reports']) == len(before_filters['reports'])
    assert browser.js("return document.querySelector('.detail-selection button').disabled")

    color(contemporary['id'], '#ff0000')
    color(traditional['id'], '#0000ff')
    assert browser.snapshot()['coverageUrls'] == before_filters['coverageUrls']
    assert len(browser.snapshot()['reports']) == len(before_filters['reports'])
    browser.js("""
        const input=document.querySelector('#language-opacity');
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'100');
        input.dispatchEvent(new Event('input',{bubbles:true}));
        input.dispatchEvent(new Event('change',{bubbles:true}));
    """)
    def pixels():
        rgba = browser.call('POST','/execute/async', {
            'script': 'const done=arguments[arguments.length-1];window.overlapTest.samplePixels([10.5,51],10).then(done);',
            'args': [],
        })
        return {tuple(rgba[i:i+4]) for i in range(0,len(rgba),4)}
    wait_for(lambda: {(255,0,0,255),(0,0,255,255)} <= pixels(), 15, 'same-language comparison stripe colors')

    # On map exposes separate rows, independently searchable by source and period.
    view(browser, 'map')
    browser.js("""
        const input=document.querySelector('#language-panel-map input');
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'');
        input.dispatchEvent(new Event('input',{bubbles:true}));
    """)
    wait_for(lambda: browser.js("return document.querySelectorAll('.on-map-row').length") == 3, 10, 'three comparison rows')
    browser.screenshot(output / 'comparison-german.png')
    browser.js("""
        const input=document.querySelector('#language-panel-map input');
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'1750');
        input.dispatchEvent(new Event('input',{bubbles:true}));
    """)
    wait_for(lambda: browser.js("return document.querySelectorAll('.on-map-row').length") == 1, 10, 'period search')
    assert '1750' in browser.js("return document.querySelector('.on-map-row').textContent")
    browser.js("document.querySelector('.on-map-row__identity').click()")
    wait_for(lambda: browser.js("return !!document.querySelector('.focused-map-entry')"), 10, 'inspect pinned entry')
    focused_id = browser.js("return document.querySelector('.focused-map-entry').dataset.entryId")
    assert focused_id not in {contemporary['id'], traditional['id']}
    assert browser.js("return !document.querySelector('#language-panel-map').hidden && document.querySelector('#language-panel-map input').value === '1750'")
    browser.js("document.querySelector('.finder-detail__more').open = true")
    assert browser.js("return document.querySelector('.map-entry-card[data-focused=true]').dataset.entryId") == focused_id
    browser.screenshot(output / 'comparison-details.png')
    view(browser, 'map')
    browser.js("document.querySelector('.on-map-row__remove').click()")
    wait_for(lambda: len(state()) == 2, 10, 'remove just one representation')
    assert {e['id'] for e in state()} == {contemporary['id'], traditional['id']}
    assert {e['color'] for e in state()} == {'#ff0000', '#0000ff'}

    # The details context links to the now Explore-only geography filters.
    browser.js("document.querySelector('[aria-label=\"Change sources and period\"]').click()")
    wait_for(lambda: browser.js("return !document.querySelector('#language-panel-explore').hidden && document.querySelector('.finder-options').open"), 10, 'edit geography from details')
    assert browser.js("return document.activeElement === document.querySelector('.finder-options > summary')")

    # Same period, two different datasets, plus independent aggregate snapshots.
    browser.js("window.overlapTest.configure({languageIds:[],center:[112,28],zoom:6})")
    search(browser, 'mand1415', 'mand1415')
    open_details(browser)
    add()
    source('DLAC')
    add()
    assert len(state()) == 2 and len({e['variantIds'][0] for e in state()}) == 2
    assert {e['context']['period'] for e in state()} == {'contemporary'}
    search(browser, 'sino1245', 'sino1245')
    open_details(browser)
    select('.finder-detail__mode select', 'descendants')
    add()
    dlac_aggregate = next(e for e in state() if e['mode']=='descendants')
    source('Asher')
    add()
    asher_aggregate = next(e for e in state() if e['mode']=='descendants' and e['id']!=dlac_aggregate['id'])
    assert set(dlac_aggregate['variantIds']) != set(asher_aggregate['variantIds'])
    assert all(v.startswith('dlac1987china:') for v in dlac_aggregate['variantIds'])
    assert all(v.startswith('asher2007world:') for v in asher_aggregate['variantIds'])
    aggregates_ready = browser.settled(90)
    check_state(aggregates_ready, require_stripes=True)
    probes = browser.js('''
        const probes=[];
        for (let lon=110;lon<=114;lon+=0.5) for (let lat=26;lat<=30;lat+=0.5)
            probes.push({point:[lon,lat],ids:window.overlapTest.inspect([lon,lat]).variantIds});
        return probes;
    ''')
    assert any({dlac_aggregate['id'], asher_aggregate['id']} <= set(p['ids']) for p in probes), probes
    color(dlac_aggregate['id'], '#ff0000')
    color(asher_aggregate['id'], '#0000ff')
    assert browser.snapshot()['coverageUrls'] == aggregates_ready['coverageUrls']
    assert len(browser.snapshot()['reports']) == len(aggregates_ready['reports'])
    asher_aggregate = next(e for e in state() if e['id'] == asher_aggregate['id'])
    # Replacing DLAC's aggregate with branch entries retains the complete Asher comparison.
    source('DLAC')
    browser.js("document.querySelector('.finder-detail__branch button').click()")
    after_branch = state()
    assert dlac_aggregate['id'] not in {e['id'] for e in after_branch}
    assert asher_aggregate in after_branch
    assert any(e['languageId']=='mand1415' and e['variantIds'][0].startswith('asher2007world:') for e in after_branch)
    browser.js("document.querySelector('.finder-detail__branch button').click()")
    assert state() == after_branch, 'Repeating branch selection preserves identities and styles'
    assert browser.js("return window.overlapTest.colorState([]).branchRoots") == ['sino1245']
    view(browser, 'map')
    browser.js("document.querySelector('.on-map-actions button').click()")
    wait_for(lambda: not state(), 10, 'clear all comparison entries')
    assert browser.js("return window.overlapTest.colorState([]).branchRoots") == []
    return {'germanEntries': 3, 'samePeriodSources': 2, 'pinnedAggregates': 2, 'independentColors': 'passed', 'contextReplacement': 'passed'}
