#!/usr/bin/env python3
"""Working selection and pinned group interaction checks."""
import json

from run import APP, browser_session, check_state, open_atlas, wait_for
from sidebar import add_selected, clear_selection, open_details, search, select_control, select_result, sources, view


def check_selection(browser, output):
    def state():
        return browser.js('return window.overlapTest.mapEntryState()')

    def group_ids(entries):
        return {entry['group']['id'] for entry in entries}

    browser.js('window.overlapTest.configure({languageIds:[],center:[108,47],zoom:4.5})')
    search(browser, 'halh1238', 'halh1238')
    browser.js("[...document.querySelectorAll('.finder-actions button')].find(b=>b.textContent==='Select all').click()")
    assert not state(), 'Checking a result only selects it for an action'
    open_details(browser, expand=False)
    search(browser, 'dari1250', 'dari1250')
    assert not browser.js("return document.querySelector('.language-row input').checked"), 'Parents do not check descendants'
    assert '0 in these results' in browser.js("return document.querySelector('.finder-bulk').textContent")
    select_result(browser, 'dari1250')
    search(browser, 'abkh1242', 'abkh1242')
    select_result(browser, 'abkh1242')
    view(browser, 'map')
    assert not state()
    view(browser, 'explore')
    assert '3 selected' in browser.js("return document.querySelector('.finder-bulk').textContent")
    add_selected(browser)
    entries = state()
    assert len(group_ids(entries)) == 2, 'Overlapping selected roots form one branch group'
    assert {'halh1238', 'dari1250', 'abkh1242'} <= {e['languageId'] for e in entries}
    assert all(e['group']['coverage'] == 'branch' for e in entries)
    wait_for(lambda: not browser.snapshot()['moving'], 10, 'profile framing')
    browser.js('window.overlapTest.camera([108,47],4.5)')
    check_state(browser.settled(60))
    count = len(entries)
    browser.screenshot(output / 'working-selection.png')
    # Optional dataset colors load asynchronously after the first add. Compare
    # repeated actions against the settled presentation, not the loading default.
    entries = state()
    add_selected(browser)
    assert state() == entries, 'Repeated adds preserve identity and style'
    sources(browser, 'DLAC')
    assert state() == entries, 'Filters do not change pinned groups'
    assert browser.js("return document.querySelector('.finder-add').disabled")
    assert '3 selected' in browser.js("return document.querySelector('.finder-bulk').textContent")
    sources(browser, 'Asher')
    browser.js("document.querySelector('.finder-options').open=false")
    view(browser, 'map')
    wait_for(lambda: browser.js("return document.querySelectorAll('.on-map-group').length") == 2, 10, 'two groups')
    assert not browser.js("return !!document.querySelector('.on-map-row')"), 'Groups start collapsed'
    halh_group = next(e['group']['id'] for e in entries if e['languageId'] == 'halh1238')
    before_style = browser.snapshot()
    browser.js("""
        const group=[...document.querySelectorAll('.on-map-group')].find(e=>e.dataset.groupId===arguments[0]);
        group.querySelector('.on-map-group__style-options > summary').click();
        const select=group.querySelector('select');select.value='uniform';select.dispatchEvent(new Event('change',{bubbles:true}));
    """, halh_group)
    wait_for(lambda: all(e['group']['coloring'] == 'uniform' for e in state() if e['group']['id'] == halh_group), 10, 'uniform group')
    assert len({e['color'] for e in state() if e['group']['id'] == halh_group}) == 1
    browser.js("""
        const input=[...document.querySelectorAll('.on-map-group')].find(e=>e.dataset.groupId===arguments[0]).querySelector('input[type=color]');
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'#123456');
        input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));
    """, halh_group)
    wait_for(lambda: all(e['color'] == '#123456' for e in state() if e['group']['id'] == halh_group), 10, 'custom group color')
    browser.js("""
        const input=document.querySelector('#language-opacity');
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'100');
        input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));
    """)
    def group_pixels():
        rgba=browser.call('POST','/execute/async', {'script':'const done=arguments[arguments.length-1];window.overlapTest.samplePixels([108,47],3).then(done);','args':[]})
        return {tuple(rgba[i:i+4]) for i in range(0,len(rgba),4)}
    wait_for(lambda: (18,52,86,255) in group_pixels(), 15, 'group color in rendered map pixels')
    assert browser.snapshot()['coverageUrls'] == before_style['coverageUrls']
    assert len(browser.snapshot()['reports']) == len(before_style['reports']), 'Colors do not compute geometry'
    assert [e for e in state() if e['group']['id'] != halh_group] == [e for e in entries if e['group']['id'] != halh_group]
    browser.screenshot(output / 'groups.png')
    browser.js("""
        const input=document.querySelector('#language-panel-map input[type=search]');
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'dari1250');
        input.dispatchEvent(new Event('input',{bubbles:true}));
    """)
    wait_for(lambda: browser.js("return !!document.querySelector('.on-map-row[data-language-id=dari1250]')"), 10, 'search descendant in collapsed group')
    browser.js("document.querySelector('.on-map-row .on-map-row__identity').focus();document.querySelector('.on-map-row .on-map-row__identity').click()")
    wait_for(lambda: browser.js("return !!document.querySelector('.focused-map-entry')"), 10, 'exact descendant inspection')
    assert browser.js("return document.querySelector('.focused-map-entry').dataset.entryId===document.querySelector('.on-map-row').dataset.entryId")
    browser.js("document.querySelector('.finder-detail__close').click()")
    assert browser.js("return document.activeElement.classList.contains('on-map-row__identity')")
    browser.js("document.querySelector('.on-map-row .on-map-row__remove').click()")
    wait_for(lambda: len(state()) == count - 1, 10, 'remove one group member')
    view(browser, 'explore')
    add_selected(browser)
    restored = state()
    assert len(restored) == count and group_ids(restored) == group_ids(entries)
    assert all(e['group']['color'] == '#123456' for e in restored if e['group']['id'] == halh_group)
    clear_selection(browser)
    assert len(state()) == count, 'Clearing working selection leaves the map intact'
    search(browser, 'halh1238', 'halh1238')
    select_result(browser, 'halh1238')
    browser.js("document.querySelector('.finder-bulk__coverage').open=true")
    select_control(browser, '[aria-label="Coverage for selected entries"]', 'own')
    add_selected(browser)
    assert len(state()) == count + 1 and len(group_ids(state())) == 3
    own = next(e for e in state() if e['group']['coverage'] == 'own')
    assert own['languageId'] == 'halh1238' and own['variantIds'] == ['asher2007world:contemporary:halh1238']
    assert len({e['id'] for e in state()}) == len(state())
    check_state(browser.settled(60))
    view(browser, 'map')
    browser.js("""
        const input=document.querySelector('#language-panel-map input[type=search]');
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'');input.dispatchEvent(new Event('input',{bubbles:true}));
    """)
    wait_for(lambda: browser.js("return !![...document.querySelectorAll('.on-map-group')].find(e=>e.dataset.groupId===arguments[0])", own['group']['id']), 10, 'own-area group')
    browser.js("[...document.querySelectorAll('.on-map-group')].find(e=>e.dataset.groupId===arguments[0]).querySelector('.on-map-row__remove').click()", own['group']['id'])
    wait_for(lambda: len(state()) == count, 10, 'remove own-area group independently')
    browser.js("document.querySelector('.on-map-actions button').click()")
    assert not state()
    view(browser, 'explore')
    assert browser.js("return document.querySelector('.language-row input').checked"), 'Clear map does not clear working selection'
    print('Working selection, group coverage, colors, own-area comparisons and removal passed', flush=True)
    return {'groups': 2, 'areas': count, 'workingSelection': 'passed', 'independentStyling': 'passed', 'ownAreaComparison': 'passed'}


def main():
    output = APP / 'test-results/selection'
    output.mkdir(parents=True, exist_ok=True)
    with browser_session(output) as (browser, origin):
        open_atlas(browser, origin)
        try:
            result = check_selection(browser, output)
            (output / 'report.json').write_text(json.dumps(result, indent=2)+'\n')
        except Exception:
            browser.screenshot(output / 'failure.png')
            raise


if __name__ == '__main__':
    main()
