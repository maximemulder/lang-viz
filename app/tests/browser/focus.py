#!/usr/bin/env python3
"""Sidebar previews and deliberate profile navigation against real source tiles."""
import json

from run import APP, browser_session, open_atlas, wait_for
from sidebar import add_selected, open_details, search, select_result, view


def check_focus(browser, output):
    german = 'asher2007world:contemporary:stan1295'
    dutch = 'asher2007world:contemporary:dutc1256'

    def highlight():
        return browser.js('return window.overlapTest.sidebarHighlight()')

    def ready():
        return wait_for(lambda: (s if (s := browser.snapshot())['mapLoaded'] and s['tilesLoaded'] and not s['moving'] else None), 35, 'stationary map')

    def move(selector):
        point = browser.js("""
            const e=document.querySelector(arguments[0]);e.scrollIntoView({block:'nearest'});
            const b=e.getBoundingClientRect();return [Math.round(b.x+b.width/2),Math.round(b.y+b.height/2)];
        """, selector)
        browser.call('POST','/actions',{'actions':[{'type':'pointer','id':'sidebar-pointer','parameters':{'pointerType':'mouse'},'actions':[{'type':'pointerMove','origin':'viewport','x':point[0],'y':point[1]}]}]})

    def key(value):
        browser.call('POST','/actions',{'actions':[{'type':'key','id':'sidebar-key','actions':[{'type':'keyDown','value':value},{'type':'keyUp','value':value}]}]})
        browser.call('DELETE','/actions')

    def outlined(expected):
        field = 'variantIds'
        return wait_for(lambda: highlight() if sorted(highlight()[field]) == sorted(expected) else None, 20, 'sidebar outline '+str(expected))

    browser.js('window.overlapTest.configure({languageIds:[],center:[8,50],zoom:3})')
    search(browser, 'stan1295', 'stan1295')
    before = ready()
    move('.language-row__identity')
    outlined([german])
    after = ready()
    assert after['camera'] == before['camera'] and after['selectedCount'] == 0
    assert len(after['reports']) == len(before['reports']) and after['coverageUrls'] == before['coverageUrls']
    assert not browser.js("return performance.getEntriesByType('resource').some(e=>e.name.includes('geometry-bounds.json'))"), 'Hover never downloads camera metadata'
    browser.screenshot(output/'search-hover.png')
    move('#language-tab-explore')
    outlined([])

    # Keyboard focus previews too, with no camera movement until Enter.
    browser.js("document.querySelector('#language-panel-explore input[type=search]').focus()")
    for _ in range(6):
        key('\ue004')
        if browser.js("return document.activeElement.classList.contains('language-row')"):
            break
    wait_for(lambda: browser.js("return document.activeElement.classList.contains('language-row')"), 10, 'keyboard tree focus')
    outlined([german])
    assert browser.snapshot()['camera'] == before['camera']
    key('\ue007')
    wait_for(lambda: browser.snapshot()['camera'] != before['camera'], 15, 'profile camera movement')
    focused = ready()
    assert 5 < focused['camera']['center'][0] < 16 and 45 < focused['camera']['center'][1] < 57
    assert focused['camera']['zoom'] <= 6 and focused['selectedCount'] == 0
    outlined([german])
    assert browser.js("return document.activeElement.classList.contains('language-row')"), 'Camera movement does not steal keyboard focus'
    assert browser.js("return performance.getEntriesByType('resource').some(e=>e.name.includes('geometry-bounds.json'))")
    browser.js("document.querySelector('#language-panel-explore input[type=search]').focus()")
    search(browser, 'dutc1256', 'dutc1256')
    move('.language-row__identity')
    outlined([dutch])
    assert browser.snapshot()['camera'] == focused['camera']
    move('#language-tab-explore')
    outlined([german])
    assert browser.snapshot()['camera'] == focused['camera']
    browser.screenshot(output/'profile-focus.png')
    browser.js("document.querySelector('.language-row__identity').click()")
    wait_for(lambda: browser.snapshot()['camera'] != focused['camera'], 15, 'next profile camera movement')
    ready()
    outlined([dutch])

    # The existing profile name can refocus; no extra Locate button is needed.
    browser.js('window.overlapTest.camera([80,20],3)')
    far = ready()['camera']
    browser.js("document.querySelector('.finder-detail__name').click()")
    wait_for(lambda: browser.snapshot()['camera'] != far, 15, 'profile name refocus')
    ready()
    outlined([dutch])
    # A second profile click interrupts an in-flight move to the previous profile.
    browser.js('window.overlapTest.camera([80,20],3)')
    ready()
    browser.js("document.querySelector('.finder-detail__name').click()")
    search(browser, 'stan1295', 'stan1295')
    browser.js("document.querySelector('.language-row__identity').click()")
    wait_for(lambda: browser.snapshot()['camera']['center'][0] < 20 and not browser.snapshot()['moving'], 20, 'latest profile wins')
    ready()
    outlined([german])
    search(browser, 'shan1293', 'shan1293')
    old_camera = browser.snapshot()['camera']
    open_details(browser, expand=False)
    assert browser.js("return document.querySelector('.finder-detail__name').disabled")
    assert 'No mapped area' in browser.js("return document.querySelector('.finder-detail').textContent")
    outlined([])
    assert ready()['camera'] == old_camera

    # Pinned comparisons preview their exact geography even when Explore has no areas.
    browser.js('window.overlapTest.configure({languageIds:["stan1295"],center:[8,50],zoom:3})')
    search(browser, 'stan1295', 'stan1295')
    browser.js("""
        document.querySelector('.finder-options').open=true;
        const select=document.querySelector('.finder-filters__period select');select.value='year-1750';select.dispatchEvent(new Event('change',{bubbles:true}));
    """)
    view(browser, 'map')
    original = ready()
    move('.on-map-row__identity')
    outlined([german])
    assert ready()['camera'] == original['camera']
    assert browser.snapshot()['selectedCount'] == 1
    browser.js("document.querySelector('.on-map-row__identity').click()")
    wait_for(lambda: browser.js("return !!document.querySelector('.focused-map-entry')"), 10, 'exact pinned profile')
    ready()
    move('#language-tab-map')
    outlined([german])
    browser.js('window.overlapTest.reloadStyle()')
    ready()
    outlined([german])
    browser.screenshot(output/'pinned-focus.png')
    view(browser, 'explore')
    browser.js("""
        const select=document.querySelector('.finder-filters__period select');select.value='contemporary';select.dispatchEvent(new Event('change',{bubbles:true}));
    """)
    view(browser, 'map')
    before_remove = ready()['camera']
    browser.js("document.querySelector('.focused-map-entry button').click()")
    wait_for(lambda: browser.snapshot()['selectedCount'] == 0, 10, 'remove focused entry')
    assert browser.js("return document.querySelector('.finder-detail__name').disabled")
    outlined([])
    assert ready()['camera'] == before_remove

    # Whole branches preview and frame parent coverage plus every mapped descendant.
    browser.js('window.overlapTest.configure({languageIds:[],center:[40,43],zoom:4})')
    search(browser, 'abkh1242', 'abkh1242')
    open_details(browser, expand=True)
    select_result(browser, 'abkh1242')
    assert not browser.js('return window.overlapTest.mapEntryState().length')
    add_selected(browser)
    entries = wait_for(lambda: browser.js('return window.overlapTest.mapEntryState()'), 10, 'branch group')
    assert len(entries) > 1 and all(e['mode'] == 'own' for e in entries)
    assert len({e['group']['id'] for e in entries}) == 1
    aggregate = ready()
    expected = [variant for entry in entries for variant in entry['variantIds']]
    outlined(expected)
    browser.screenshot(output/'family-focus.png')
    # A group's profile uses pinned members even when the search year has no areas.
    browser.js("document.querySelector('.finder-options').open=true")
    browser.js("""
        const select=document.querySelector('.finder-filters__period select');select.value='year-1750';select.dispatchEvent(new Event('change',{bubbles:true}));
    """)
    view(browser, 'map')
    move('.on-map-group__identity')
    outlined(expected)
    before_group = ready()['camera']
    browser.js('window.overlapTest.camera([80,20],3)')
    ready()
    browser.js("document.querySelector('.on-map-group__identity').click()")
    wait_for(lambda: not browser.snapshot()['moving'] and browser.snapshot()['camera']['center'][0] < 50, 20, 'pinned group framing')
    ready()
    move('#language-tab-map')
    outlined(expected)
    assert browser.js("return !!document.querySelector('.focused-map-entry[data-group-id]')")
    assert not aggregate['errors']
    print('Sidebar pointer/keyboard previews, profile navigation, pinned context, style recovery, and aggregate framing passed', flush=True)
    return {'searchHover':'passed','keyboard':'passed','profileNavigation':'passed','pinnedContext':'passed','aggregateContributors':len(expected)}


def main():
    output=APP/'test-results/sidebar-focus'
    output.mkdir(parents=True, exist_ok=True)
    with browser_session(output) as (browser, origin):
        open_atlas(browser, origin)
        try:
            result=check_focus(browser,output)
            (output/'report.json').write_text(json.dumps(result,indent=2)+'\n')
        except Exception:
            browser.screenshot(output/'failure.png')
            (output/'failure.json').write_text(json.dumps(browser.snapshot(),indent=2)+'\n')
            raise


if __name__ == '__main__':
    main()
