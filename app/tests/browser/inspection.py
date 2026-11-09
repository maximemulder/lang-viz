#!/usr/bin/env python3
"""Check outline lifecycle and measure hover latency with complete Asher coverage."""

import argparse
import json
import pathlib
import subprocess

from prepared import select_all
from run import APP, SCENARIOS, browser_session, check_state, open_atlas, wait_for
from sidebar import open_details, search, view


def highlighted(browser):
    return sorted(browser.js("return window.overlapTest.inspectionHighlight().variantIds"))


def move(browser, center, *, click=False):
    hit = browser.js("return window.overlapTest.inspect(arguments[0])", center)
    x, y = hit["point"]
    actions = [{"type": "pointerMove", "duration": 0, "origin": "viewport", "x": x, "y": y}]
    if click:
        actions += [{"type": "pointerDown", "button": 0}, {"type": "pointerUp", "button": 0}]
    browser.call(
        "POST",
        "/actions",
        {
            "actions": [
                {
                    "type": "pointer",
                    "id": "inspection-mouse",
                    "parameters": {"pointerType": "mouse"},
                    "actions": actions,
                }
            ]
        },
    )
    return sorted(hit["variantIds"])


def expect_highlight(browser, expected):
    wait_for(lambda: highlighted(browser) == sorted(expected), 10, "outline feature state")


def render_frames(browser):
    browser.call(
        "POST",
        "/execute/async",
        {
            "script": "const done=arguments[arguments.length-1];requestAnimationFrame(()=>requestAnimationFrame(done))",
            "args": [],
        },
    )


def lifecycle(browser, output):
    browser.js("window.overlapTest.configure(arguments[0])", SCENARIOS[0])
    browser.settled(60, fail_on_error=True)
    for projection in ("globe", "mercator"):
        browser.js(
            "document.querySelector('input[name=map-projection][value='+arguments[0]+']').click()",
            projection,
        )
        browser.settled(60, fail_on_error=True)
        original_filter = browser.js("return window.overlapTest.inspectionHighlight().filter")
        for center in ([-1.5, 52.5], [-4, 52.3], [2, 52.5]):
            expected = move(browser, center)
            expect_highlight(browser, expected)
        english = move(browser, [-1.5, 52.5])
        expect_highlight(browser, english)
        render_frames(browser)
        browser.screenshot(output / f"hover-{projection}.png")
        move(browser, [-1.5, 52.5], click=True)
        wait_for(
            lambda: browser.js(
                "return !!document.querySelector('.language-inspector--pinned .maplibregl-popup-close-button')"
            ),
            10,
            "pinned popup close button",
        )
        move(browser, [2, 52.5])
        expect_highlight(browser, english)
        browser.js("window.overlapTest.reloadStyle()")
        browser.settled(60, fail_on_error=True)
        expect_highlight(browser, english)
        browser.js("window.overlapTest.camera([-1.5,52.5],5.4)")
        browser.settled(60, fail_on_error=True)
        expect_highlight(browser, english)
        browser.js(
            "document.querySelector('.language-inspector .maplibregl-popup-close-button').click()"
        )
        expect_highlight(browser, [])
        assert (
            browser.js("return window.overlapTest.inspectionHighlight().filter") == original_filter
        )
        browser.js("window.overlapTest.camera([-4.5,54.2],4.4)")
        browser.settled(60, fail_on_error=True)
        # Several moves without a pause must leave only the latest membership.
        for center in ([-1.5, 52.5], [-4, 52.3], [2, 52.5]):
            move(browser, center)
        render_frames(browser)
        expect_highlight(browser, [])
        move(browser, [-1.5, 52.5])
        browser.call(
            "POST",
            "/actions",
            {
                "actions": [
                    {
                        "type": "pointer",
                        "id": "inspection-mouse",
                        "parameters": {"pointerType": "mouse"},
                        "actions": [
                            {"type": "pointerMove", "origin": "viewport", "x": 1250, "y": 300}
                        ],
                    }
                ]
            },
        )
        render_frames(browser)
        expect_highlight(browser, [])
    print(
        "Hover, overlap, empty space, pin/close, style reload, new tiles and leave: passed",
        flush=True,
    )

    # An inspected aggregate must outline all contributing source variants.
    center = [40.8144288679004, 43.27592703258703]
    browser.js("window.overlapTest.configure({languageIds:[],center:arguments[0],zoom:5})", center)
    search(browser, "abkh1242", "abkh1242")
    open_details(browser)
    browser.js(
        "const select=document.querySelector('.finder-detail__mode select');select.value='descendants';select.dispatchEvent(new Event('change',{bubbles:true}))"
    )
    view(browser, "explore")
    browser.js("document.querySelector('.language-row input').click()")
    browser.settled(60, fail_on_error=True)
    ids = move(browser, center)
    assert len(ids) == 1 and ids[0].startswith("descendants:abkh1242:"), ids
    wait_for(lambda: len(highlighted(browser)) == 3, 10, "three aggregate contributor outlines")
    render_frames(browser)
    browser.screenshot(output / "aggregate.png")
    browser.js("window.overlapTest.configure({languageIds:[],center:arguments[0],zoom:5})", center)
    expect_highlight(browser, [])
    print("Aggregate expansion and selection clearing: passed", flush=True)


def benchmark(browser):
    results = []
    for period in ("contemporary", "time-of-contact"):
        for projection in ("globe", "mercator"):
            browser.js(
                "document.querySelector('input[name=map-projection][value='+arguments[0]+']').click()",
                projection,
            )
            for name, center, zoom, points in (
                ("world", [12, 18], 1.35, [[10, 50], [25, 8], [80, 25], [10, 50]]),
                ("africa", [25, 8], 4.25, [[25, 8], [27, 8], [25, 8], [27, 8]]),
                ("asia", [100, 30], 4.25, [[100, 30], [102, 30], [100, 30], [102, 30]]),
            ):
                select_all(browser, "Asher", center, zoom=zoom, period=period, settle=False)
                before = browser.settled(120, fail_on_error=True)
                check_state(before)
                assert before["selectedCount"] > 5000
                samples = []
                for point in points:
                    sample = browser.call(
                        "POST",
                        "/execute/async",
                        {
                            "script": "const done=arguments[arguments.length-1];window.overlapTest.probeInspection(arguments[0]).then(done)",
                            "args": [point],
                        },
                    )
                    assert not sample["timedOut"] and sample["filterUnchanged"], sample
                    assert sample["variantIds"], (period, name, point)
                    samples.append(sample)
                after = browser.snapshot()
                check_state(after)
                assert len(after["reports"]) == len(before["reports"]), "Hover recomputed coverage"
                assert after["coverageUrls"] == before["coverageUrls"], "Hover replaced coverage"
                results.append(
                    {"period": period, "projection": projection, "view": name, "samples": samples}
                )
                print(
                    f"{period} {projection} {name}: {[sample['renderedMs'] for sample in samples]} ms",
                    flush=True,
                )
    return results


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dev", action="store_true")
    parser.add_argument("--skip-build", action="store_true")
    parser.add_argument("--output", type=pathlib.Path, default=APP / "test-results/inspection")
    args = parser.parse_args()
    if not args.dev and not args.skip_build:
        subprocess.run(["npm", "run", "build"], cwd=APP, check=True)
    with browser_session(args.output, dev=args.dev) as (browser, origin):
        open_atlas(browser, origin)
        try:
            lifecycle(browser, args.output)
            results = benchmark(browser)
            (args.output / "report.json").write_text(json.dumps(results, indent=2) + "\n")
        except Exception:
            browser.screenshot(args.output / "failure.png")
            (args.output / "failure.json").write_text(
                json.dumps(browser.snapshot(), indent=2) + "\n"
            )
            raise


if __name__ == "__main__":
    main()
