#!/usr/bin/env python3
"""Check bulk-branch navigation coverage over German (Asher) and Yue (DLAC)."""

import json

from run import APP, browser_session, check_state, open_atlas, wait_for
from sidebar import select_branches


def check_navigation(browser, output, source, projection, center, points, language):
    moves = []
    for i, zoom in enumerate([4.5, 5.5, 6.5, 4, 3, 5, 6, 4.5]):
        target = [center[0] + (i % 2) * 0.8, center[1]]
        browser.js("""
            window.overlapTest.watchAreas(arguments[0]);
            window.overlapTest.camera(arguments[1], arguments[2], 900);
        """, points, target, zoom)
        browser.settled(100)
        # Force a final render as well: a stationary gap must fail even when it
        # never filled during this step and therefore has no disappearance yet.
        pixels = browser.call("POST", "/execute/async", {
            "script": """
                const done = arguments[arguments.length - 1];
                window.overlapTest.samplePixels(arguments[0], 2).then(done);
            """,
            "args": [center],
        })
        state = browser.snapshot()
        frames = state["areaFrames"]
        lost = [frame for frame in frames if frame["disappeared"]]
        moves.append({"center": target, "zoom": zoom, "frames": frames, "pixels": pixels})
        (output / f"{source}-{projection}-frames.json").write_text(json.dumps(moves, indent=2))
        check_state(state, require_stripes=True)
        assert frames and not frames[-1]["missing"], f"Stationary coverage gap: {frames[-1:]}"
        assert frames[-1]["samples"] == len(points), "Coverage probes must remain in view"
        assert not lost, f"Coverage disappeared while navigating: {lost[:4]}"
        assert f"{language}" in " ".join(browser.js(
            "return window.overlapTest.inspect(arguments[0]).variantIds", center
        )), f"Missing {language} membership"
        if i == 0:
            browser.screenshot(output / f"{source}-{projection}-initial.png")
    browser.js("window.overlapTest.watchAreas(null)")
    browser.screenshot(output / f"{source}-{projection}-final.png")
    result = {"frames": sum(len(move["frames"]) for move in moves), "moves": len(moves)}
    print(f"{source} {projection}: {result['frames']} frames, no missing coverage", flush=True)
    return result


def check_selection_list(browser, count):
    browser.js("document.querySelector('#language-tab-map').click()")
    wait_for(lambda: browser.js("return !!document.querySelector('.on-map-group')"), 10, 'group list')
    assert browser.js("return document.querySelectorAll('.on-map-group,.on-map-row').length") < 100
    browser.js("const list=document.querySelector('.on-map-list');list.scrollTop=list.scrollHeight")
    wait_for(lambda: browser.js("return document.querySelector('.on-map-list').scrollTop > 0"), 10, 'last groups')
    browser.call('POST', '/execute/async', {
        'script': 'const done=arguments[arguments.length-1];requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(done)))',
        'args': [],
    })
    before = browser.js("return document.querySelector('.on-map-list').scrollTop")
    browser.js("document.querySelector('.on-map-group:last-child .on-map-row__identity').click()")
    wait_for(lambda: browser.js("return !!document.querySelector('.finder-detail')"), 10, 'group details')
    assert browser.js("return !document.querySelector('#language-panel-map').hidden")
    browser.js("document.querySelector('.finder-detail__close').click()")
    wait_for(lambda: browser.js("return document.querySelector('.on-map-list').scrollTop === arguments[0]", before), 10, 'restored group list scroll')
    assert browser.js("return document.querySelectorAll('.on-map-group,.on-map-row').length") < 100
    assert browser.snapshot()['selectedCount'] == count
    browser.js("document.querySelector('#language-tab-explore').click()")
    print(f'Grouped list: {count} areas, virtualized, scroll preserved', flush=True)


def main():
    output = APP / "test-results/coverage"
    output.mkdir(parents=True, exist_ok=True)
    results = {}
    with browser_session(output) as (browser, origin):
        try:
            for source, center, points, language in [
                ("Asher", [10, 51], [[9, 50], [10, 51], [11, 52], [12, 51]], "stan1295"),
                ("DLAC", [111, 23], [[110, 23], [111, 23], [112, 23], [112, 24]], "yuec1235"),
            ]:
                open_atlas(browser, origin)
                state = select_branches(browser, source, center)
                check_state(state, require_stripes=True)
                results[source] = {"selectedCount": state["selectedCount"]}
                check_selection_list(browser, state["selectedCount"])
                for projection in ("globe", "mercator"):
                    browser.js("""
                        document.querySelector('input[name=map-projection][value='+arguments[0]+']').click();
                    """, projection)
                    browser.settled(100)
                    results[source][projection] = check_navigation(
                        browser, output, source, projection, center, points, language
                    )
                results[source]["snapshot"] = browser.snapshot()
        except Exception:
            results["failureSnapshot"] = browser.snapshot()
            browser.screenshot(output / "failure.png")
            raise
        finally:
            (output / "report.json").write_text(json.dumps(results, indent=2) + "\n")
    print(f"Bulk-branch coverage checks passed: {output / 'report.json'}")


if __name__ == "__main__":
    main()
