#!/usr/bin/env python3
"""Source dropdowns must remain clickable over the following sidebar section."""

from run import APP, browser_session, open_atlas, wait_for


def click(browser, x, y):
    browser.call("POST", "/actions", {"actions": [{
        "type": "pointer", "id": "dropdown-mouse", "parameters": {"pointerType": "mouse"},
        "actions": [
            {"type": "pointerMove", "duration": 0, "origin": "viewport", "x": x, "y": y},
            {"type": "pointerDown", "button": 0},
            {"type": "pointerUp", "button": 0},
        ],
    }]})
    browser.call("DELETE", "/actions")


def main():
    output = APP / "test-results/dropdowns"
    with browser_session(output) as (browser, origin):
        open_atlas(browser, origin)
        for width, height in ((1440, 1000), (1440, 600), (520, 760)):
            browser.call("POST", "/window/rect", {"width": width, "height": height})
            browser.js("""
                document.querySelector('.finder-options').open=true;
                document.querySelector('.source-filter__trigger').scrollIntoView({block:'center'});
                document.querySelector('.source-filter__trigger').click();
            """)
            wait_for(lambda: browser.js("return document.querySelector('.source-filter__trigger').getAttribute('aria-expanded')==='true'"), 10, "source dropdown")
            point = browser.js("""
                const popover=document.querySelector('.source-filter__popover');
                const box=popover.getBoundingClientRect();
                const section=document.querySelector('.explore-controls').getBoundingClientRect();
                const options=document.querySelector('.source-filter__options').getBoundingClientRect();
                const x=Math.round(options.left+20), y=Math.round(options.bottom-12);
                const hit=document.elementFromPoint(x,y);
                const label=hit?.closest('.source-filter__option');
                return {x,y, clickable:!!label && popover.contains(label),
                    overlapsNext: y>section.bottom,
                    inViewport:box.left>=0 && box.top>=0 && box.right<=innerWidth && box.bottom<=innerHeight,
                    index:label ? [...document.querySelectorAll('.source-filter__option')].indexOf(label) : -1,
                    checked:label?.querySelector('input').checked};
            """)
            assert point["clickable"], f"Dropdown clipped by the next section: {point}"
            assert point["inViewport"], f"Dropdown extends outside viewport: {point}"
            if height == 1000:
                assert point["overlapsNext"], "Regression must test beyond the source section"
            click(browser, point["x"], point["y"])
            wait_for(lambda: browser.js("return document.querySelectorAll('.source-filter__option input')[arguments[0]].checked!==arguments[1]", point["index"], point["checked"]), 10, "pointer selection beyond section")
            browser.screenshot(output / f"sources-{width}-{height}.png")
            browser.call("POST", "/actions", {"actions": [{
                "type": "key", "id": "dropdown-keyboard", "actions": [
                    {"type": "keyDown", "value": "\ue00c"},
                    {"type": "keyUp", "value": "\ue00c"},
                ],
            }]})
            browser.call("DELETE", "/actions")
            wait_for(lambda: browser.js("return document.querySelector('.source-filter__trigger').getAttribute('aria-expanded')==='false'"), 10, "Escape dismisses dropdown")

        browser.js("document.querySelector('.source-filter__trigger').click()")
        wait_for(lambda: browser.js("return document.querySelector('.source-filter__trigger').getAttribute('aria-expanded')==='true'"), 10, "reopen dropdown")
        browser.js("document.querySelector('.finder-options').open=false")
        wait_for(lambda: browser.js("return document.querySelector('.source-filter__trigger').getAttribute('aria-expanded')==='false'"), 10, "collapsed section dismisses dropdown")
    print("Source dropdown overlays, pointer selection, viewport bounds and dismissal pass")


if __name__ == "__main__":
    main()
