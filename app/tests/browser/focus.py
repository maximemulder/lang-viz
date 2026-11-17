"""Sidebar previews and deliberate profile navigation against real source tiles."""


import json

from .run import APP, browser_session, open_atlas, wait_for
from .sidebar import add_selected, open_details, search, select_result, view


def check_focus(browser, output):
    german = 'asher2007world:contemporary:stan1295'
    dutch = 'asher2007world:contemporary:dutc1256'

    def highlight(selected=False):
        method = 'selectionHighlight' if selected else 'sidebarHighlight'
        return browser.js(f'return window.overlapTest.{method}()')

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

    def outlined(expected, selected=False):
        field = 'variantIds'
        state = wait_for(lambda: highlight(selected) if sorted(highlight(selected)[field]) == sorted(expected) else None, 20, 'selected outline ' if selected else 'sidebar outline '+str(expected))
        if expected:
            assert state['boundaryFeatures'] > 0, state
        return state

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

    # Keyboard focus previews; Enter inspects and frames the chosen language.
    browser.js("document.querySelector('#language-panel-explore input[type=search]').focus()")
    for _ in range(6):
        key('\ue004')
        if browser.js("return document.activeElement.classList.contains('language-row')"):
            break
    wait_for(lambda: browser.js("return document.activeElement.classList.contains('language-row')"), 10, 'keyboard tree focus')
    outlined([german])
    assert browser.snapshot()['camera'] == before['camera']
    key('\ue007')
    outlined([german], selected=True)
    wait_for(lambda: browser.snapshot()['camera'] != before['camera'], 15, 'keyboard language focus')
    focused = ready()
    assert focused['selectedCount'] == 0
    assert browser.js("return document.activeElement.classList.contains('language-row')"), 'Inspection does not steal keyboard focus'
    assert browser.js("return performance.getEntriesByType('resource').some(e=>e.name.includes('geometry-bounds.json'))")
    browser.js("document.querySelector('#language-panel-explore input[type=search]').focus()")
    search(browser, 'dutc1256', 'dutc1256')
    move('.language-row__identity')
    outlined([dutch])
    outlined([german], selected=True)
    assert browser.snapshot()['camera'] == focused['camera']
    move('#language-tab-explore')
    outlined([], selected=False)
    outlined([german], selected=True)
    assert browser.snapshot()['camera'] == focused['camera']
    browser.screenshot(output/'profile-focus.png')
    browser.js("document.querySelector('.language-row__identity').click()")
    outlined([dutch], selected=True)
    wait_for(lambda: browser.snapshot()['camera'] != focused['camera'], 15, 'sidebar language focus')
    ready()
    assert not browser.js("return !!document.querySelector('.finder-detail .details-map-action')")

    # Reopening the same sidebar identity refocuses it after a pan.
    browser.js('window.overlapTest.camera([80,20],3)')
    far = ready()['camera']
    browser.js("document.querySelector('.language-row__identity').click()")
    wait_for(lambda: browser.snapshot()['camera'] != far, 15, 'sidebar language refocus')
    ready()
    outlined([dutch], selected=True)
    # A new selection cancels an in-flight focus request.
    browser.js('window.overlapTest.camera([80,20],3)')
    ready()
    browser.js("document.querySelector('.language-row__identity').click()")
    search(browser, 'stan1295', 'stan1295')
    browser.js("document.querySelector('.language-row__identity').click()")
    outlined([german], selected=True)
    ready()
    assert browser.snapshot()['camera']['center'][0] < 20
    search(browser, 'shan1293', 'shan1293')
    old_camera = browser.snapshot()['camera']
    open_details(browser, expand=False)
    assert not browser.js("return !!document.querySelector('.finder-detail .details-map-action')")
    browser.js("document.querySelector('.finder-detail .language-summary-section:nth-child(3) .sidebar-section__toggle').click()")
    assert 'No mapped area' in browser.js("return document.querySelector('.finder-detail').textContent")
    outlined([], selected=True)
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
    browser.js('window.overlapTest.camera([80,20],3)')
    far = ready()['camera']
    browser.js("document.querySelector('.on-map-row__identity').click()")
    wait_for(lambda: browser.js("return !!document.querySelector('.focused-map-entry')"), 10, 'exact pinned profile')
    wait_for(lambda: browser.snapshot()['camera'] != far, 15, 'pinned entry focus')
    ready()
    move('#language-tab-map')
    outlined([german], selected=True)
    browser.js('window.overlapTest.reloadStyle()')
    ready()
    outlined([german], selected=True)
    browser.screenshot(output/'pinned-focus.png')
    view(browser, 'explore')
    browser.js("""
        const select=document.querySelector('.finder-filters__period select');select.value='contemporary';select.dispatchEvent(new Event('change',{bubbles:true}));
    """)
    view(browser, 'map')
    before_remove = ready()['camera']
    browser.js("document.querySelector('.focused-map-entry button').click()")
    wait_for(lambda: browser.snapshot()['selectedCount'] == 0, 10, 'remove focused entry')
    assert 'This map entry has been removed.' in browser.js("return document.querySelector('.finder-detail').textContent")
    outlined([], selected=True)
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
    outlined(expected, selected=True)
    browser.screenshot(output/'family-focus.png')
    # A group's profile uses pinned members even when the search year has no areas.
    browser.js("document.querySelector('.finder-options').open=true")
    browser.js("""
        const select=document.querySelector('.finder-filters__period select');select.value='year-1750';select.dispatchEvent(new Event('change',{bubbles:true}));
    """)
    view(browser, 'map')
    move('.on-map-group__identity')
    outlined(expected)
    ready()
    browser.js('window.overlapTest.camera([80,20],3)')
    ready()
    browser.js("document.querySelector('.on-map-group__identity').click()")
    wait_for(lambda: not browser.snapshot()['moving'] and browser.snapshot()['camera']['center'][0] < 50, 20, 'pinned group framing')
    ready()
    browser.js('window.overlapTest.camera([80,20],3)')
    ready()
    browser.js("document.querySelector('.on-map-group__identity').click()")
    wait_for(lambda: not browser.snapshot()['moving'] and browser.snapshot()['camera']['center'][0] < 50, 20, 'pinned group framing')
    ready()
    move('#language-tab-map')
    # The source loaded before this profile outline was added. Its overzoomed
    # tiles must retain real boundaries, not just the visible fill layer.
    outlined(expected, selected=True)
    assert browser.js("return !!document.querySelector('.focused-map-entry[data-group-id]')")
    assert not aggregate['errors']
    # Pointer activation follows the same inspect/then-focus sequence as Areas mode.
    browser.js('window.overlapTest.configure({languageIds:["stan1295","dutc1256"],center:[10,51],zoom:3})')
    ready()
    hit = browser.js('return window.overlapTest.inspect([10,51])')
    assert german in hit['variantIds'], hit
    def map_action(double=False):
        x, y = browser.js('return window.overlapTest.inspect([10,51]).point')
        actions = [{'type':'pointerMove','origin':'viewport','x':x,'y':y}]
        actions += [{'type':'pointerDown','button':0},{'type':'pointerUp','button':0}]
        if double:
            actions += [{'type':'pointerDown','button':0},{'type':'pointerUp','button':0}]
        browser.call('POST','/actions',{'actions':[{'type':'pointer','id':'map-pointer','parameters':{'pointerType':'mouse'},'actions':actions}]})
    map_action()
    wait_for(lambda: browser.js("return document.querySelector('#focused-language-name')?.textContent.includes('German')"), 10, 'map click language details')
    assert browser.js("""
        const map = document.querySelector('.map-shell').getBoundingClientRect();
        const details = document.querySelector('.geography-inspector').getBoundingClientRect();
        const controls = document.querySelector('.geography-sidebar').getBoundingClientRect();
        return map.right <= details.left + 1 &&
            Math.abs(details.left - controls.left) < 1 &&
            Math.abs(details.right - controls.right) < 1 &&
            Math.abs(details.top - controls.top) < 1 &&
            Math.abs(details.bottom - controls.bottom) < 1 &&
            document.querySelector('.geography-sidebar').inert &&
            document.querySelector('#language-panel-explore input[type=search]').value === 'abkh1242';
    """), 'Map inspection covers the retained sidebar without narrowing the map further'
    assert browser.js("""
        const search = document.querySelector('#language-panel-map input[type=search]');
        search.focus();
        return document.activeElement !== search;
    """), 'Covered controls cannot receive keyboard focus'
    browser.js("document.querySelector('[aria-label=\"Show language controls beside details\"]').click()")
    assert browser.js("""
        const details = document.querySelector('.geography-inspector').getBoundingClientRect();
        const controls = document.querySelector('.geography-sidebar').getBoundingClientRect();
        return details.right <= controls.left + 1 && !document.querySelector('.geography-sidebar').inert &&
            document.querySelector('.on-map-list').clientHeight >= 88;
    """), 'Placement control shows the full main sidebar beside details'
    ready()
    map_action()
    assert browser.js("return !!document.querySelector('[aria-label=\"Show details over language controls\"]')"), 'Manual placement survives another map inspection'
    browser.js("document.querySelector('[aria-label=\"Show details over language controls\"]').click()")
    assert browser.js("return document.querySelector('.geography-sidebar').inert"), 'Placement control covers the main sidebar again'
    outlined([german], selected=True)
    assert ready()['camera']['zoom'] == 3
    x, y = browser.js('return window.overlapTest.inspect([5,52]).point')
    browser.call('POST','/actions',{'actions':[{'type':'pointer','id':'map-pointer','parameters':{'pointerType':'mouse'},'actions':[{'type':'pointerMove','origin':'viewport','x':x,'y':y}]}]})
    wait_for(lambda: dutch in browser.js('return window.overlapTest.inspectionHighlight().variantIds'), 10, 'hovered Dutch outline')
    outlined([german], selected=True)
    browser.screenshot(output/'selection-and-hover.png')
    map_action(double=True)
    wait_for(lambda: browser.snapshot()['camera']['zoom'] > 3.5, 15, 'map double-click language focus')
    assert browser.js("return document.querySelector('#focused-language-name')?.textContent.includes('German')")
    assert not browser.js("return !!document.querySelector('.map-isolation-control')")
    browser.js('document.querySelector(".finder-detail button[aria-label=\\"Close language details\\"]").click()')
    assert browser.js("return document.activeElement?.matches('.map-shell .maplibregl-canvas')"), 'Closing map inspection restores map focus'
    browser.js('window.overlapTest.camera([10,51],3)')
    ready()
    map_action(double=True)
    wait_for(lambda: browser.js("return document.querySelector('#focused-language-name')?.textContent.includes('German')") and browser.snapshot()['camera']['zoom'] > 3.5, 15, 'first double-click target retained')
    browser.call('POST', '/window/rect', {'width': 390, 'height': 844})
    assert browser.js("""
        const map = document.querySelector('.map-shell').getBoundingClientRect();
        const details = document.querySelector('.geography-inspector').getBoundingClientRect();
        const controls = document.querySelector('.geography-sidebar').getBoundingClientRect();
        return map.bottom <= details.top + 1 &&
            Math.abs(details.top - controls.top) < 1 &&
            Math.abs(details.bottom - controls.bottom) < 1 &&
            document.documentElement.scrollWidth <= innerWidth;
    """), 'Map inspection covers the sidebar on narrow screens'
    browser.js("document.querySelector('[aria-label=\"Show language controls beside details\"]').click()")
    assert browser.js("""
        const details = document.querySelector('.geography-inspector').getBoundingClientRect();
        const controls = document.querySelector('.geography-sidebar').getBoundingClientRect();
        return details.height >= 500 && details.bottom <= controls.top + 1 &&
            !document.querySelector('.geography-sidebar').inert &&
            document.documentElement.scrollWidth <= innerWidth;
    """), 'Narrow docked view gives each panel its own full-height section'
    browser.call('POST', '/window/rect', {'width': 1440, 'height': 900})
    browser.js("document.querySelector('.finder-detail__reveal').click()")
    assert browser.js("""
        const map = document.querySelector('.map-shell').getBoundingClientRect();
        const details = document.querySelector('.geography-inspector').getBoundingClientRect();
        const controls = document.querySelector('.geography-sidebar').getBoundingClientRect();
        return map.right <= details.left + 1 && details.right <= controls.left + 1 &&
            !document.querySelector('#language-panel-explore').hidden;
    """), 'Showing the language in classification restores side-by-side browsing'
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
