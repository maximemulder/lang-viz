#!/usr/bin/env python3
"""Exercise branch refinement and complete-dataset acceleration in the production browser."""
import json
import subprocess
import urllib.request
from contextlib import ExitStack
from types import SimpleNamespace

from catalog import open_details, search, view
from coverage import select_branches
from run import APP, Browser, check_state, free_port, request, stop, stop_group, wait_for


def main():
    output = APP / "test-results/branches"
    output.mkdir(parents=True, exist_ok=True)
    results = {}
    with ExitStack() as stack:
        preview_port, driver_port = free_port(), free_port()
        while driver_port == preview_port:
            driver_port = free_port()
        preview_log = stack.enter_context((output / "preview.log").open("w"))
        driver_log = stack.enter_context((output / "geckodriver.log").open("w"))
        preview = subprocess.Popen(
            ["npm", "run", "preview", "--", "--host", "127.0.0.1", "--port", str(preview_port), "--strictPort"],
            cwd=APP, stdout=preview_log, stderr=subprocess.STDOUT, start_new_session=True,
        )
        stack.callback(stop_group, preview)
        driver = subprocess.Popen(["geckodriver", "--host", "127.0.0.1", "--port", str(driver_port), "--log", "warn"], stdout=driver_log, stderr=subprocess.STDOUT)
        stack.callback(stop, driver)
        origin, webdriver = f"http://127.0.0.1:{preview_port}", f"http://127.0.0.1:{driver_port}"
        wait_for(lambda: urllib.request.urlopen(origin, timeout=2).status == 200, 20, "preview")
        wait_for(lambda: request(webdriver, "GET", "/status"), 20, "geckodriver")
        browser = Browser(webdriver, SimpleNamespace(headed=False, hardware=False))
        stack.callback(browser.close)
        browser.call("POST", "/url", {"url": origin + "/?overlap-test=1&overlap-basemap=off"})
        wait_for(lambda: browser.js("return !!window.overlapTest"), 45, "application")
        try:
            browser.js("window.overlapTest.configure({languageIds:[],center:[108,47],zoom:4.5})")
            search(browser, "halh1238", "halh1238")
            open_details(browser)
            browser.js("document.querySelector('.finder-detail__branch button').click()")
            state = browser.settled(60)
            check_state(state)
            assert state["reports"][-1]["outcome"] == "ready"
            entries = browser.js("return window.overlapTest.mapEntryState()")
            assert {"halh1238", "dari1250"} <= {entry["languageId"] for entry in entries}
            assert all(entry.get("branchRootId") == "halh1238" for entry in entries)
            probes = browser.js("""
                const probes=[];
                for(let lon=98;lon<118;lon+=0.5) for(let lat=41;lat<53;lat+=0.5)
                  probes.push({point:[lon,lat],ids:window.overlapTest.inspect([lon,lat]).variantIds});
                return probes;
            """)
            child = "asher2007world:contemporary:dari1250"
            parent = "asher2007world:contemporary:halh1238"
            child_probe = next(probe["point"] for probe in probes if probe["ids"] == [child])
            parent_probe = next(probe["point"] for probe in probes if probe["ids"] == [parent])
            assert not any(child in probe["ids"] and parent in probe["ids"] for probe in probes)
            browser.screenshot(output / "halh-branch.png")
            # Both render modes and projections must use the same ancestry policy.
            for projection in ("globe", "mercator"):
                browser.js("document.querySelector('input[name=map-projection][value='+arguments[0]+']').click()", projection)
                for mode in ("Color blending", "Alternating stripes"):
                    browser.js("document.querySelector('input[aria-label='+JSON.stringify(arguments[0])+']').click()", mode)
                    browser.settled(60)
                    assert browser.js("return window.overlapTest.inspect(arguments[0]).variantIds", child_probe) == [child]
                    assert browser.js("return window.overlapTest.inspect(arguments[0]).variantIds", parent_probe) == [parent]
            # A removed descendant exposes the original parent again.
            search(browser, "dari1250", "dari1250")
            open_details(browser)
            browser.js("document.querySelector('.map-entry-card__actions button:last-child').click()")
            wait_for(lambda: len(browser.js("return window.overlapTest.mapEntryState()")) == len(entries) - 1, 10, "remove child")
            wait_for(lambda: parent in browser.js("return window.overlapTest.inspect(arguments[0]).variantIds", child_probe), 20, "parent restoration")
            results["halh"] = {"entries": len(entries), "childProbe": child_probe, "parentProbe": parent_probe, "projectionsAndModes": "passed", "parentRestoration": "passed"}
            print("Halh branch: parent retained, descendant refinement, removal, both modes and projections passed", flush=True)

            # Empty query selects complete source coverage and can use prepared tiles.
            view(browser, "explore")
            browser.js("document.querySelector('input[name=map-projection][value=globe]').click()")
            browser.js("""
                const input=document.querySelector('#language-panel-explore input[type=search]');
                Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'');
                input.dispatchEvent(new Event('input',{bubbles:true}));
            """)
            wait_for(lambda: browser.js("return !document.querySelector('#language-panel-explore input[type=search]').value"), 10, "empty query")
            state = select_branches(browser, "Asher", [12, 18], zoom=1.35)
            check_state(state, require_stripes=True)
            report = state["reports"][-1]
            assert state["selectedCount"] > 5000
            assert report["metrics"]["partitionMs"] == 0, report
            assert report["metrics"].get("precomputedTiles", 0) > 0, report
            browser.screenshot(output / "asher-world.png")
            results["asherWorld"] = {"selectedCount": state["selectedCount"], "report": report}
            print(f"Asher world: {state['selectedCount']} entries, no live Boolean operations", flush=True)
            browser.js("document.querySelector('input[aria-label=\"Color blending\"]').click()")
            state = browser.settled(60)
            check_state(state, require_stripes=True)
            assert state["reports"][-1]["metrics"]["partitionMs"] == 0
            assert state["blendLayerCount"] <= 2, state["blendLayerCount"]
            browser.screenshot(output / "asher-world-blending.png")
            results["asherWorldBlending"] = "passed"
            browser.js("document.querySelector('input[name=map-projection][value=mercator]').click()")
            state = browser.settled(60)
            check_state(state, require_stripes=True)
            assert state["reports"][-1]["metrics"]["partitionMs"] == 0
            results["asherWorldMercator"] = "passed"
        except Exception:
            results["failureSnapshot"] = browser.snapshot()
            browser.screenshot(output / "failure.png")
            raise
        finally:
            (output / "report.json").write_text(json.dumps(results, indent=2) + "\n")
    print(f"Branch checks passed: {output / 'report.json'}")


if __name__ == "__main__":
    main()
