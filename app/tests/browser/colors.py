#!/usr/bin/env python3
"""Exercise explicit view palettes through production controls and rendered geography."""

import json
import math
import time

from color_evaluation import distance, evaluate_colors, lab
from run import APP, browser_session, check_state, open_atlas, wait_for
from sidebar import open_details, search, select_branches


def settings(browser):
    browser.js("""
        const toggle=document.querySelector('[aria-label="Map settings"]');
        if(toggle.getAttribute('aria-expanded')!=='true') toggle.click();
    """)


def button(browser, text):
    browser.js("""
        const button=[...document.querySelectorAll('.color-controls button')]
            .find(button=>button.textContent.trim()===arguments[0]);
        if(!button || button.disabled) throw new Error('Unavailable color action: '+arguments[0]);
        button.click();
    """, text)


def color_state(browser, ids):
    return browser.js("return window.overlapTest.colorState(arguments[0])", ids)


def pixels(browser, point, radius=2):
    return browser.call("POST", "/execute/async", {
        "script": "const done=arguments[arguments.length-1];window.overlapTest.samplePixels(arguments[0],arguments[1]).then(done);",
        "args": [point, radius],
    })


def coherent(result, state):
    for language_id, color in state["colors"].items():
        root = state["roots"][language_id]
        region = result["metrics"]["regions"].get(root)
        if region:
            assert distance(color, region["anchor"]) <= region["radius"] + .002, (language_id, root)
            anchor, sample = lab(region["anchor"]), lab(color)
            chroma = math.hypot(anchor[1], anchor[2])
            if chroma > .02:
                angle = math.degrees(math.atan2(anchor[1]*sample[2] - anchor[2]*sample[1],
                                               anchor[1]*sample[1] + anchor[2]*sample[2]))
                assert abs(angle) <= 22, (language_id, root, angle)
                assert math.hypot(sample[1], sample[2]) >= chroma * .5, (language_id, root)


def captured_input(browser):
    return browser.js("""
        const {topology,reference,configuration,view}=window.colorTestInput;
        return {topology:{...topology,parentById:[...topology.parentById],
            childrenById:[...topology.childrenById],mappedLeafCount:[...topology.mappedLeafCount]},
            reference:{colors:[...reference.colors],anchors:[...reference.anchors],
            rootById:[...reference.rootById]},configuration,view};
    """)


def optimize(browser, ids, output=None, name=None):
    browser.settled(100)
    settings(browser)
    wait_for(lambda: browser.js("""
        return ![...document.querySelectorAll('.color-controls button')]
            .find(button=>button.textContent.trim()==='Optimize colors for this view').disabled;
    """), 15, "map ready for color optimization")
    before = browser.snapshot()
    started = time.monotonic()
    button(browser, "Optimize colors for this view")

    def done():
        error = browser.js("return document.querySelector('.color-controls [role=alert]')?.textContent")
        assert not error, error
        return browser.js("""
            const button=[...document.querySelectorAll('.color-controls button')]
                .find(button=>button.textContent.trim()==='Optimize colors for this view');
            return !button.disabled && window.overlapTest.colorState([]).optimization;
        """)

    result = wait_for(done, 60, "view palette")
    elapsed = time.monotonic() - started
    # State delivery precedes MapLibre's next paint; wait for an actual render.
    pixels(browser, before["camera"]["center"])
    browser.settled(100)
    after = browser.snapshot()
    assert before["coverageUrls"] == after["coverageUrls"], "Recoloring replaced coverage"
    assert len(before["reports"]) == len(after["reports"]), "Recoloring requested geometry"
    colors = color_state(browser, ids)["colors"]
    report = {"metrics": result, "seconds": elapsed, "colors": colors}
    if output is not None:
        capture = captured_input(browser)
        palette = {"colors": colors, "anchors": {root: region["anchor"]
                   for root, region in result["regions"].items()}}
        report["evaluation"] = {
            "before": evaluate_colors(capture, capture["reference"]),
            "after": evaluate_colors(capture, palette),
        }
        (output / (name + "-input.json")).write_text(json.dumps(capture))
        (output / (name + "-palette.json")).write_text(json.dumps(palette))
    return report


def main():
    output = APP / "test-results/colors"
    output.mkdir(parents=True, exist_ok=True)
    results = {}
    with browser_session(output) as (browser, origin):
        try:
            open_atlas(browser, origin)
            # Observe the real bounded capture sent to the color worker; do not
            # reconstruct view occupancy from catalog coordinates in this check.
            browser.js("""
                const send=Worker.prototype.postMessage;
                Worker.prototype.postMessage=function(message,...args) {
                    if(message?.view?.footprints && message?.reference?.colors)
                        window.colorTestInput=message;
                    return send.call(this,message,...args);
                };
            """)
            state = select_branches(browser, "DLAC", [108, 32], zoom=3)
            check_state(state, True)
            settings(browser)
            browser.js("""
                const input=document.querySelector('#language-opacity');
                Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'100');
                input.dispatchEvent(new Event('input',{bubbles:true}));
                input.dispatchEvent(new Event('change',{bubbles:true}));
            """)
            browser.settled(100)
            probe = browser.js("""
                const entries=window.overlapTest.mapEntryState();
                for(const p of [[116,38],[117,36],[114,35],[110,35]]) {
                    const ids=window.overlapTest.inspect(p).variantIds;
                    if(ids.length===1 && entries.some(e=>e.id===ids[0] && e.languageId==='mand1415')) return p;
                }
                return null;
            """)
            assert probe, "No solid Mandarin probe in the DLAC view"
            ids = sorted({entry["languageId"] for entry in browser.js("return window.overlapTest.mapEntryState()")})
            assert "sino1245" not in ids and "tibe1272" not in ids
            # Frozen palettes include unselected/offscreen relatives and the
            # family root, keeping their identity consistent during navigation.
            ids = sorted(set(ids) | {"sino1245", "tibe1272"})
            before = color_state(browser, ids)["colors"]
            browser.screenshot(output / "dlac-before.png")
            first = optimize(browser, ids, output, "dlac")
            assert first["metrics"]["after"]["localFamilyConflict"] < .01
            default_sinitic = first["evaluation"]["before"]["families"]["sino1245"]
            for scale in default_sinitic["branches"]:
                assert scale["meanContrast"] > .015, scale
            assert first["colors"] != before
            assert first["colors"]["sino1245"] == first["metrics"]["regions"]["sino1245"]["anchor"]
            coherent(first, color_state(browser, ids))
            assert first["metrics"]["after"]["internalContrast"] > first["metrics"]["before"]["internalContrast"] * 3
            rgb = tuple(int(first["colors"]["mand1415"][i:i+2], 16) for i in (1, 3, 5)) + (255,)
            def painted():
                rgba = pixels(browser, probe)
                return rgb in {tuple(rgba[i:i+4]) for i in range(0, len(rgba), 4)}
            wait_for(painted, 15, "optimized color in actual rendered Mandarin pixels")
            results["dlac"] = first
            browser.screenshot(output / "dlac-after.png")
            # Keep the exact framebuffer proof and its before/after pair at 100%,
            # then review all other views at the application's normal intensity.
            browser.js("""
                const input=document.querySelector('#language-opacity');
                Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'82');
                input.dispatchEvent(new Event('input',{bubbles:true}));
                input.dispatchEvent(new Event('change',{bubbles:true}));
            """)
            pixels(browser, probe)
            browser.screenshot(output / "dlac-preview.png")

            button(browser, "Undo colors")
            wait_for(lambda: color_state(browser, ids)["optimization"] is None, 10, "undo palette")
            assert color_state(browser, ids)["colors"] == before
            second = optimize(browser, ids)
            assert second["colors"] == first["colors"], "Re-running the same view changed the result"
            third = optimize(browser, ids)
            assert third["colors"] == first["colors"], "Repeated refresh drifted"
            button(browser, "Use default palette")
            wait_for(lambda: color_state(browser, ids)["optimization"] is None, 10, "default palette")
            assert color_state(browser, ids)["colors"] == before
            button(browser, "Undo colors")
            wait_for(lambda: color_state(browser, ids)["optimization"] is not None, 10, "restore focused palette")
            assert color_state(browser, ids)["colors"] == first["colors"]

            browser.js("window.overlapTest.camera([115,27],4.5)")
            browser.settled(100)
            assert color_state(browser, ids)["colors"] == first["colors"], "Navigation recolored entries"
            browser.js("""
                const period=document.querySelector('.finder-filters__period select');
                period.value='time-of-contact'; period.dispatchEvent(new Event('change',{bubbles:true}));
            """)
            assert color_state(browser, ids)["colors"] == first["colors"], "A period filter changed pinned colors"
            browser.js("""
                const period=document.querySelector('.finder-filters__period select');
                period.value='contemporary'; period.dispatchEvent(new Event('change',{bubbles:true}));
                window.overlapTest.camera([108,32],3);
            """)
            browser.settled(100)

            # Both levels of exact custom colors survive a view optimization.
            browser.js("window.overlapTest.configureColors({strategy:'semantic',rootIds:[],anchors:{},overrides:{ganc1239:'#00ff00'}})")
            search(browser, "mand1415", "mand1415")
            open_details(browser)
            browser.js("""
                const input=document.querySelector('.map-entry-card input[type=color]');
                Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'#123456');
                input.dispatchEvent(new Event('input',{bubbles:true}));
                input.dispatchEvent(new Event('change',{bubbles:true}));
            """)
            wait_for(lambda: any(entry["languageId"] == "mand1415" and entry["color"] == "#123456"
                                for entry in browser.js("return window.overlapTest.mapEntryState()")), 10, "per-entry manual color")
            browser.settled(100)
            results["manual"] = optimize(browser, ids)
            assert color_state(browser, ["ganc1239"])["colors"]["ganc1239"] == "#00ff00"
            assert any(entry["languageId"] == "mand1415" and entry["color"] == "#123456"
                       for entry in browser.js("return window.overlapTest.mapEntryState()"))
            button(browser, "Use default palette")
            assert color_state(browser, ["ganc1239"])["colors"]["ganc1239"] == "#00ff00"

            # A complete Asher selection exercises many families and actual large
            # territories; the sampled view is Central/East Asia, not catalog points.
            button(browser, "Reset color settings")
            browser.js("document.querySelector('.language-back').click()")
            browser.js("""
                const input=document.querySelector('#language-panel-explore input[type=search]');
                Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'');
                input.dispatchEvent(new Event('input',{bubbles:true}));
            """)
            state = select_branches(browser, "Asher", [100, 42], zoom=2.6)
            check_state(state, True)
            ids = sorted({entry["languageId"] for entry in browser.js("return window.overlapTest.mapEntryState()")})
            results["asherSelected"] = len(ids)
            browser.screenshot(output / "asher-before.png")
            results["asher"] = optimize(browser, ids, output, "asher")
            assert results["asher"]["metrics"]["rootCount"] > 2
            assert results["asher"]["metrics"]["languageCount"] < len(ids), "Offscreen entries consumed the view palette"
            browser.screenshot(output / "asher-after.png")
            coherent(results["asher"], color_state(browser, ids))

            # Optimizing immediately after selection must work without a camera
            # round trip. Returning to that same view must reproduce its colors.
            browser.js("window.overlapTest.camera([100,42],2.8)")
            browser.settled(100, fail_on_error=True)
            browser.js("window.overlapTest.camera([100,42],2.6)")
            browser.settled(100, fail_on_error=True)
            returned = optimize(browser, ids)
            assert returned["colors"] == results["asher"]["colors"], "A zoom round trip changed the same-view palette"

            # Entire world, rather than only one regional/globe viewport.
            button(browser, "Use default palette")
            browser.js("""
                document.querySelector('input[name=map-projection][value=mercator]').click();
                window.overlapTest.camera([20,15],.4);
            """)
            browser.settled(100)
            browser.screenshot(output / "asher-world-before.png")
            results["asherWorld"] = world = optimize(browser, ids, output, "asher-world")
            assert world["metrics"]["rootCount"] > 200
            # A flat default can score better on palette-wide minimum distances.
            # Bound ambiguity while independently requiring major-branch detail.
            assert world["metrics"]["after"]["prominentFamilyConflict"] < .06
            assert world["metrics"]["after"]["maxFamilySpread"] < .12
            assert world["metrics"]["after"]["internalContrast"] > .018
            state = color_state(browser, ids)
            coherent(world, state)
            colors = state["colors"]
            # Evaluate both palettes at several area scales, including families
            # with many principal branches and uneven classifications. Defaults
            # must already have useful detail before any explicit optimization.
            evaluations = world["evaluation"]
            for stage, minimum_contrast in [("before", .005), ("after", .01)]:
                families = evaluations[stage]["families"]
                major = {root: family for root, family in families.items() if family["visibleCount"] >= 200}
                assert len(major) >= 4, major
                for root, family in major.items():
                    for scale in family["branches"]:
                        assert scale["meanContrast"] > minimum_contrast, (stage, root, scale)
                        assert abs(scale["coverage"] - 1) < 1e-8, (stage, root, scale)
                for root, family in families.items():
                    assert family["spread"] < .222, (stage, root, family)
                    assert family["maxHueDrift"] <= 22, (stage, root, family)
                    ratio = family["minimumChromaRatio"]
                    assert ratio is None or ratio >= .5, (stage, root, family)
                contacts = evaluations[stage]["contacts"]
                assert contacts["familyPairCount"] > 1000, contacts
                assert contacts["meanShortfall"] < .05, contacts
                assert contacts["severePairCount"] / contacts["familyPairCount"] < .01, contacts
            for a,b in [("kore1280","stan1293"), ("kore1280","russ1263"),
                        ("afro1255","sino1245"), ("mong1349","atla1278")]:
                assert distance(colors[a], colors[b]) > .12, (a,b)
            browser.screenshot(output / "asher-world-after.png")
            # Review broad branch shading at closer scales without refreshing
            # the world palette, and verify that navigation retains all colors.
            for name, center, zoom in [("europe", [15, 50], 3), ("africa", [20, 5], 2.4)]:
                browser.js("window.overlapTest.camera(arguments[0],arguments[1])", center, zoom)
                browser.settled(100)
                assert color_state(browser, ids)["colors"] == colors
                browser.screenshot(output / ("asher-world-" + name + ".png"))
            browser.js("window.overlapTest.camera([20,15],.4)")
            browser.settled(100)

            # Settings remain usable on a narrow layout.
            browser.call("POST", "/window/rect", {"width": 420, "height": 850})
            settings(browser)
            bounds = browser.js("""
                const r=document.querySelector('.map-settings__panel').getBoundingClientRect();
                return {left:r.left,right:r.right,width:innerWidth,bottom:r.bottom,height:innerHeight};
            """)
            assert bounds["left"] >= 0 and bounds["right"] <= bounds["width"], bounds
            assert bounds["bottom"] <= bounds["height"], bounds
            visible = browser.js("""
                const button=[...document.querySelectorAll('.color-controls button')]
                    .find(button=>button.textContent.trim()==='Use default palette');
                button.scrollIntoView({block:'center',inline:'nearest'});
                const panel=document.querySelector('.map-settings__panel').getBoundingClientRect();
                const r=button.getBoundingClientRect();
                return r.top>=panel.top && r.bottom<=panel.bottom && r.right<=innerWidth;
            """)
            assert visible, "Color actions cannot be reached in the narrow scroll panel"
            browser.screenshot(output / "narrow-controls.png")
            button(browser, "Use default palette")
            wait_for(lambda: color_state(browser, [])["optimization"] is None, 10, "narrow default action")
            results["navigationUndoManualAndLayout"] = "passed"
            print("View palettes, deterministic refresh, navigation stability, undo, manual colors and geometry reuse pass", flush=True)
        except Exception:
            results["failureState"] = browser.snapshot()
            browser.screenshot(output / "failure.png")
            raise
        finally:
            (output / "report.json").write_text(json.dumps(results, indent=2) + "\n")


if __name__ == "__main__":
    main()
