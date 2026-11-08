#!/usr/bin/env python3
"""Check bulk-branch navigation coverage over German (Asher) and Yue (DLAC)."""

import json
import subprocess
import urllib.request
from contextlib import ExitStack
from types import SimpleNamespace

from run import APP, Browser, check_state, free_port, request, stop, stop_group, wait_for


def select_branches(browser, source, center, zoom=4.5):
    browser.js(
        "window.overlapTest.configure({languageIds:[],center:arguments[0],zoom:arguments[1]})",
        center, zoom,
    )
    browser.js("""
        document.querySelector('.finder-options').open = true;
        document.querySelector('.source-filter__trigger').click();
    """)
    browser.js("""
        [...document.querySelectorAll('.source-filter__actions button')]
          .find(button => button.textContent === 'Clear').click();
    """)
    wait_for(
        lambda: browser.js(
            "return document.querySelector('.source-filter__trigger').textContent.includes('No sources')"
        ),
        10,
        "cleared source filter",
    )
    browser.js("""
        [...document.querySelectorAll('.source-filter__option')]
          .find(label => label.querySelector('strong').textContent === arguments[0])
          .querySelector('input').click();
        document.querySelector('.source-filter__trigger').click();
    """, source)
    button = """
        [...document.querySelectorAll('.finder-actions button')]
          .find(button => button.textContent.startsWith('Show branches on map'))
    """
    wait_for(
        lambda: browser.js(f"return !({button}).disabled"), 10, "mapped-branch action"
    )
    browser.js(f"({button}).click()")
    return browser.settled(100)


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
    wait_for(lambda: browser.js("return !!document.querySelector('.on-map-row')"), 10, "selection list")
    assert browser.js("return document.querySelectorAll('.on-map-row').length") < 100
    browser.js("const list=document.querySelector('.on-map-list');list.scrollTop=list.scrollHeight")
    wait_for(lambda: browser.js("return Number(document.querySelector('.on-map-row:last-child')?.getAttribute('aria-posinset')) === arguments[0]", count), 10, "last selected entry")
    before = browser.js("return document.querySelector('.on-map-list').scrollTop")
    browser.js("document.querySelector('.on-map-row:last-child .on-map-row__identity').click()")
    wait_for(lambda: browser.js("return !!document.querySelector('.finder-detail')"), 10, "last entry details")
    browser.js("document.querySelector('.language-back').click()")
    wait_for(lambda: browser.js("return !!document.querySelector('.on-map-row')"), 10, "return to selection list")
    assert browser.js("return document.querySelector('.on-map-list').scrollTop") == before
    assert browser.js("return document.querySelectorAll('.on-map-row').length") < 100
    browser.js("document.querySelector('#language-tab-explore').click()")
    print(f"Selection list: {count} entries, virtualized, scroll preserved", flush=True)


def main():
    output = APP / "test-results/coverage"
    output.mkdir(parents=True, exist_ok=True)
    results = {}
    with ExitStack() as stack:
        preview_port, driver_port = free_port(), free_port()
        while driver_port == preview_port:
            driver_port = free_port()
        preview_log = stack.enter_context((output / "preview.log").open("w"))
        driver_log = stack.enter_context((output / "geckodriver.log").open("w"))
        preview = subprocess.Popen(
            ["npm", "run", "preview", "--", "--host", "127.0.0.1",
             "--port", str(preview_port), "--strictPort"],
            cwd=APP, stdout=preview_log, stderr=subprocess.STDOUT, start_new_session=True,
        )
        stack.callback(stop_group, preview)
        driver = subprocess.Popen(
            ["geckodriver", "--host", "127.0.0.1", "--port", str(driver_port), "--log", "warn"],
            stdout=driver_log, stderr=subprocess.STDOUT,
        )
        stack.callback(stop, driver)
        origin = f"http://127.0.0.1:{preview_port}"
        webdriver = f"http://127.0.0.1:{driver_port}"
        wait_for(lambda: urllib.request.urlopen(origin, timeout=2).status == 200, 20, "preview")
        wait_for(lambda: request(webdriver, "GET", "/status"), 20, "geckodriver")
        browser = Browser(webdriver, SimpleNamespace(headed=False, hardware=False))
        stack.callback(browser.close)
        try:
            for source, center, points, language in [
                ("Asher", [10, 51], [[9, 50], [10, 51], [11, 52], [12, 51]], "stan1295"),
                ("DLAC", [111, 23], [[110, 23], [111, 23], [112, 23], [112, 24]], "yuec1235"),
            ]:
                browser.call("POST", "/url", {"url": origin + "/?overlap-test=1&overlap-basemap=off"})
                wait_for(lambda: browser.js("return !!window.overlapTest"), 45, "application")
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
