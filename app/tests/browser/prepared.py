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


def lod_continuity(browser, output):
    # The old archive leaves this Yulu interior empty at source zooms 0–2,
    # although source zooms 3–8 cover it. Retaining those coarse tiles during
    # zoom-in therefore magnified a real geometry gap, not a loading seam.
    point = [25.88134765625, 7.841615185204698]
    results = []
    select_all(browser, "Asher", point, zoom=0.25)
    for projection in ("globe", "mercator"):
        browser.js(
            "document.querySelector('input[name=map-projection][value='+arguments[0]+']').click()",
            projection,
        )
        # Mercator's viewport constraint raises the minimum camera zoom above
        # 1 at this window size; source zoom 0 is only reachable on the globe.
        for coarse in (0, 1, 2) if projection == "globe" else (1, 2):
            # The exact Yulu probe is only ~0.1 world pixel from a genuine
            # uncovered boundary. Nearest framebuffer sampling can alternate
            # with ocean during globe projection changes. Keep its geographic
            # membership assertion, and sample a stable Congo interior for
            # pixel continuity (over two native pixels from that boundary).
            pixel_point = [25, -4]
            browser.js("window.overlapTest.camera(arguments[0],arguments[1]+0.25)", point, coarse)
            prepared(browser, "asher2007world", "contemporary", coarse)
            ids = browser.js("return window.overlapTest.inspect(arguments[0]).variantIds", point)
            # Shared simplification can move a language boundary across this
            # point. It must remain covered; its coarse contributor may differ.
            assert ids, (projection, coarse, ids)
            browser.js(
                """
                window.overlapTest.watchAreas([arguments[0]]);
                window.overlapTest.setTileDelay('coverage', 1200);
                window.overlapTest.setTileDelay('fallback', 1200);
                """,
                pixel_point,
            )
            browser.call(
                "POST",
                "/execute/async",
                {
                    "script": "const done=arguments[arguments.length-1];window.overlapTest.samplePixels(arguments[0],1).then(done)",
                    "args": [pixel_point],
                },
            )
            assert not browser.snapshot()["areaFrames"][-1]["missing"]
            browser.screenshot(output / f"lod-{projection}-{coarse}-coarse.png")
            browser.js("window.overlapTest.camera(arguments[0],4.25,900)", point)
            prepared(browser, "asher2007world", "contemporary", 4)
            state = browser.snapshot()
            frames = state["areaFrames"]
            assert len(frames) >= 10 and all(f["samples"] == 1 for f in frames), frames
            assert not [f for f in frames if f["missing"]], (projection, coarse, frames)
            assert any(f["zoom"] > coarse + 1 for f in frames)
            results.append(
                {
                    "projection": projection,
                    "coarse": coarse,
                    "pixelPoint": pixel_point,
                    "frames": frames,
                }
            )
            browser.js(
                """
                window.overlapTest.watchAreas(null);
                window.overlapTest.setTileDelay('coverage', 0);
                window.overlapTest.setTileDelay('fallback', 0);
                """
            )
            print(
                f"LOD continuity {projection} {coarse} → 4: {len(frames)} frames, no gap",
                flush=True,
            )
    return results


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
            result["lodContinuity"] = lod_continuity(browser, output)
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
                        ([25, 8], 2),
                        ([25, 8], 3),
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
                # Opening details can focus the camera once bounds metadata is available.
                browser.settled(90, fail_on_error=True)
                browser.js("window.overlapTest.camera([10,10],4.25)")
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
