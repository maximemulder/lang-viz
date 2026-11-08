#!/usr/bin/env python3
"""Require prepared coverage across datasets and Asher's dense intermediate zooms."""

import json

from delivery import archives
from run import APP, browser_session, check_state, open_atlas, wait_for
from sidebar import open_details, search, select_branches, view


def select_all(browser, source, center, **options):
    view(browser, "explore")
    browser.js("""
        const input = document.querySelector('#language-panel-explore input[type=search]');
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '');
        input.dispatchEvent(new Event('input', {bubbles:true}));
    """)
    return select_branches(browser, source, center, **options)


def prepared(browser, dataset, period, zoom):
    state = browser.settled(90, fail_on_error=True)
    check_state(state)
    assert state["status"] == "ready", state
    report = state["reports"][-1]
    metrics = report["metrics"]
    assert metrics.get("partsTiles", 0) + metrics.get("precomputedTiles", 0) > 0, report
    assert metrics["partitionMs"] == 0 and metrics["initializeMs"] == 0, report
    assert metrics["inputVertices"] == 0, "Prepared coverage must not decode live input geometry"
    assert state["coverageZooms"] and all(z == zoom for z in state["coverageZooms"]), state[
        "coverageZooms"
    ]
    sources = archives(state["geometryTiles"][0])
    assert len(sources) == 1 and sources[0].endswith(f"/{dataset}/{period}.pmtiles"), sources
    assert browser.js("return window.overlapTest.unexpectedMemberships()") == []
    print(f"{dataset}/{period} zoom {zoom}: {report['workerMs']} ms, zero live overlay", flush=True)
    return {"report": report, "archives": sources, "zoom": zoom}


def main():
    output = APP / "test-results/prepared"
    output.mkdir(parents=True, exist_ok=True)
    result = {"asher": {}, "otherProfiles": {}}
    with browser_session(output) as (browser, origin):
        open_atlas(browser, origin)
        try:
            wait_for(
                lambda: browser.js("return !!document.querySelector('.source-filter__trigger')"),
                20,
                "catalog",
            )
            for period in ("contemporary", "time-of-contact"):
                select_all(browser, "Asher", [100, 30], zoom=4.25, period=period, settle=False)
                cold = prepared(browser, "asher2007world", period, 4)
                select_all(browser, "Asher", [12, 18], zoom=1.35, period=period)
                result["asher"][period] = {
                    "coldRegion": cold,
                    "world": prepared(browser, "asher2007world", period, 1),
                    "moves": [],
                }
                for projection in ("globe", "mercator"):
                    browser.js(
                        "document.querySelector('input[name=map-projection][value='+arguments[0]+']').click()",
                        projection,
                    )
                    for center, zoom in [
                        ([10, 10], 4),
                        ([100, 30], 4),
                        ([100, 30], 5),
                        ([10, 10], 5),
                        ([10, 51], 6),
                        ([10, 51], 7),
                        ([10, 51], 8),
                        ([10, 10], 4),
                    ]:
                        browser.js(
                            "window.overlapTest.camera(arguments[0],arguments[1]+0.25)",
                            center,
                            zoom,
                        )
                        entry = prepared(browser, "asher2007world", period, zoom)
                        entry.update({"center": center, "projection": projection})
                        result["asher"][period]["moves"].append(entry)
                    browser.screenshot(output / f"asher-{period}-{projection}.png")
                # A subset cannot match the exact full-branch assets; it must use reusable parts.
                search(browser, "dari1250", "dari1250")
                open_details(browser)
                browser.js(
                    "document.querySelector('.map-entry-card__actions button:last-child').click()"
                )
                state = prepared(browser, "asher2007world", period, 4)
                assert state["report"]["metrics"].get("partsTiles", 0) > 0
                result["asher"][period]["subset"] = state
                browser.js("window.overlapTest.camera([100,30],5.25)")
                result["asher"][period]["subsetPan"] = prepared(
                    browser, "asher2007world", period, 5
                )
                browser.js("window.overlapTest.camera([10,10],4.25)")
                result["asher"][period]["subsetReturn"] = prepared(
                    browser, "asher2007world", period, 4
                )

            for source, dataset, period, center in [
                ("DiACL", "carling2025diacl", "year-1750", [20, 50]),
                ("Bouckaert", "bouckaert2012indoeuropean", "mixed-periods", [25, 50]),
                ("Wurm–Hattori", "wurm1981pacific", "contemporary", [145, -6]),
                ("Matsumae", "matsumae2021exploring", "contemporary", [140, 40]),
                ("DLAC", "dlac1987china", "contemporary", [112, 28]),
            ]:
                select_all(browser, source, center, zoom=4.25, period=period)
                result["otherProfiles"][dataset] = [prepared(browser, dataset, period, 4)]
                for zoom in (6, 8):
                    browser.js(
                        "window.overlapTest.camera(arguments[0],arguments[1]+0.25)", center, zoom
                    )
                    result["otherProfiles"][dataset].append(
                        prepared(browser, dataset, period, zoom)
                    )
            print(
                "Prepared coverage passes for every dataset/period, including dense Asher navigation and subsets",
                flush=True,
            )
        except Exception:
            result["failureState"] = browser.snapshot()
            browser.screenshot(output / "failure.png")
            raise
        finally:
            (output / "report.json").write_text(json.dumps(result, indent=2) + "\n")


if __name__ == "__main__":
    main()
