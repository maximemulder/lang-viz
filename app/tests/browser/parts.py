#!/usr/bin/env python3
"""Compare live overlay and reusable parts through production workers and rendering."""
import argparse
import json

from run import APP, browser_session, check_state, wait_for
from sidebar import open_details, search, select_branches, view


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--runs", type=int, default=3)
    args = parser.parse_args()
    output = APP / "test-results/coverage-parts"
    output.mkdir(parents=True, exist_ok=True)
    results = {"cases": [], "memberships": {}}

    def record(browser, name, engine, run, probes=None):
        def terminal():
            state = browser.snapshot()
            if state["status"] == "idle" and state["selectedCount"] == 1 and state["mapLoaded"] and state["tilesLoaded"]:
                return state
            if not state["reports"] or state["moving"]:
                return None
            report = state["reports"][-1]
            if state["status"] == "error" and report["outcome"] == "error":
                return state
            if state["status"] == "ready" and report.get("firstRenderMs") is not None:
                return state
            return None
        state = wait_for(terminal, 60, "measured coverage")
        if state["status"] == "ready":
            state = browser.settled(60)
        native = state["status"] == "idle"
        if not native:
            check_state(state)
        report = {"outcome": "native", "workerMs": 0, "firstRenderMs": 0} if native else state["reports"][-1]
        results["cases"].append({"name": name, "engine": engine, "run": run, "report": report})
        if report["outcome"] == "error":
            assert engine == "live", report
            print(f"{name} {engine} {run}: {report['failure']}", flush=True)
            return state
        if engine == "parts" and not native:
            assert report["metrics"].get("partsTiles", 0) > 0, report
            assert report["metrics"]["partitionMs"] == 0, report
            assert report["metrics"]["initializeMs"] == 0, report
            if name in ("DLAC-Sinitic-branch", "DLAC-aggregate", "Asher-world-remove-child"):
                assert report["metrics"].get("partsCacheHits", 0) > 0, report
        if probes:
            samples = browser.js("""
                const entries = new Map(window.overlapTest.mapEntryState().map(e => [e.id, e.languageId+':'+e.mode]));
                return arguments[0].map(point => window.overlapTest.inspect(point).variantIds
                    .map(id=>entries.get(id) ?? id).sort());
            """, probes)
            previous = results["memberships"].setdefault(name, samples)
            assert samples == previous, f"Displayed memberships differ for {name}: {engine} run {run}"
        print(f"{name} {engine} {run}: worker {report['workerMs']} ms, rendered {report['firstRenderMs']} ms", flush=True)
        if run == 0:
            browser.screenshot(output / f"{name}-{engine}.png")
        return state

    with browser_session(output) as (browser, origin):
        try:
            for run in range(args.runs):
                for engine in ("live", "parts"):
                    browser.call("POST", "/url", {"url": origin + f"/?overlap-test=1&overlap-basemap=off&overlap-engine={engine}"})
                    wait_for(lambda: browser.js("return !!window.overlapTest"), 45, "application")
                    select_branches(browser, "Asher", [10.5, 51], zoom=3.5, settle=False)
                    record(browser, "Asher-Europe-full", engine, run, [[x, y] for x in range(7, 15) for y in range(48, 55)])

                    browser.js("window.overlapTest.configure({languageIds:[],center:[108,47],zoom:3.5})")
                    search(browser, "halh1238", "halh1238")
                    open_details(browser)
                    browser.js("document.querySelector('.finder-detail__branch button').click()")
                    state = record(browser, "Halh-branch", engine, run, [[112, 45.5], [98, 43]])
                    assert browser.js("return window.overlapTest.inspect([112,45.5]).variantIds") == ["asher2007world:contemporary:dari1250"]
                    search(browser, "dari1250", "dari1250")
                    open_details(browser)
                    browser.js("document.querySelector('.map-entry-card__actions button:last-child').click()")
                    record(browser, "Halh-remove-child", engine, run, [[112, 45.5], [98, 43]])
                    assert browser.js("return window.overlapTest.inspect([112,45.5]).variantIds") == ["asher2007world:contemporary:halh1238"]

                    browser.js("""
                        const input=document.querySelector('#language-panel-explore input[type=search]');
                        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'');
                        input.dispatchEvent(new Event('input',{bubbles:true}));
                    """)
                    select_branches(browser, "DLAC", [112, 28], zoom=3.5, settle=False)
                    record(browser, "DLAC-region-full", engine, run, [[x, y] for x in range(108, 117) for y in range(24, 33)])
                    view(browser, "map")
                    browser.js("document.querySelector('.on-map-actions button').click()")
                    search(browser, "sini1245", "sini1245")
                    open_details(browser)
                    browser.js("document.querySelector('.finder-detail__branch button').click()")
                    record(browser, "DLAC-Sinitic-branch", engine, run, [[112, 28], [114, 25], [110, 30]])

                    view(browser, "map")
                    browser.js("document.querySelector('.on-map-actions button').click()")
                    search(browser, "sino1245", "sino1245")
                    open_details(browser)
                    browser.js("""
                        const select=document.querySelector('.finder-detail__mode select');
                        select.value='descendants'; select.dispatchEvent(new Event('change',{bubbles:true}));
                    """)
                    browser.js("document.querySelector('.detail-selection button').click()")
                    record(browser, "DLAC-aggregate", engine, run, [[112, 28], [114, 25], [110, 30]])

                    if engine == "parts":
                        view(browser, "explore")
                        browser.js("""
                            const input=document.querySelector('#language-panel-explore input[type=search]');
                            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'');
                            input.dispatchEvent(new Event('input',{bubbles:true}));
                        """)
                        select_branches(browser, "Asher", [12, 18], zoom=1.35, settle=False)
                        record(browser, "Asher-world-full", engine, run)
                        search(browser, "dari1250", "dari1250")
                        open_details(browser)
                        browser.js("document.querySelector('.map-entry-card__actions button:last-child').click()")
                        record(browser, "Asher-world-remove-child", engine, run)
                        for projection in ("mercator", "globe"):
                            browser.js("document.querySelector('input[name=map-projection][value='+arguments[0]+']').click()", projection)
                            browser.settled(60)
                            for mode in ("Color blending", "Alternating stripes"):
                                browser.js("document.querySelector('input[aria-label='+JSON.stringify(arguments[0])+']').click()", mode)
                                check_state(browser.settled(60), require_stripes=True)
        except Exception:
            results["failureSnapshot"] = browser.snapshot()
            browser.screenshot(output / "parts-failure.png")
            raise
        finally:
            (output / "browser.json").write_text(json.dumps(results, indent=2) + "\n")
    print(f"Parts browser comparison passed: {output / 'browser.json'}")


if __name__ == "__main__":
    main()
