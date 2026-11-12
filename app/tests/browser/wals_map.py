#!/usr/bin/env python3
"""Production WALS overlay acceptance: published evidence plus explicit edge-case fixtures."""

import json
import os
import subprocess
import threading
import time
import urllib.error
import urllib.request
from collections import Counter
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from inspection import render_frames
from run import APP, SCENARIOS, browser_session, wait_for
from sidebar import open_details, search
from wals_profile import click_text, key, record, select


@contextmanager
def controlled_server(upstream):
    control = {"body": None, "wals": "ready", "bounds": "ready", "release": threading.Event()}
    hits = Counter()

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def do_GET(self):
            path = self.path.split("?", 1)[0]
            hits[path] += 1
            wals = path.endswith("/wals/features.json")
            mode = (
                control["wals"]
                if wals
                else control["bounds"]
                if path.endswith("/geometry-bounds.json")
                else "ready"
            )
            if mode == "delay":
                control["release"].wait(40)
            if mode == "fail":
                self.send_response(503)
                self.end_headers()
                self.wfile.write(b"Injected WALS error")
                return
            if wals and control["body"] is not None:
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(control["body"])
                return
            request = urllib.request.Request(
                upstream + self.path,
                headers={
                    k: v
                    for k, v in self.headers.items()
                    if k.lower() in {"range", "if-range", "accept"}
                },
            )
            try:
                response = urllib.request.urlopen(request, timeout=30)
            except urllib.error.HTTPError as error:
                response = error
            try:
                with response:
                    self.send_response(response.status)
                    for key, value in response.headers.items():
                        if key.lower() not in {"connection", "transfer-encoding", "cache-control"}:
                            self.send_header(key, value)
                    self.send_header("Cache-Control", "no-store")
                    self.end_headers()
                    self.wfile.write(response.read())
            except (BrokenPipeError, ConnectionResetError):
                pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}", control, hits
    finally:
        control["release"].set()
        server.shutdown()
        server.server_close()
        thread.join()


def text(browser, selector):
    return browser.js("return document.querySelector(arguments[0])?.textContent ?? ''", selector)


def settled(browser):
    render_frames(browser)
    previous = None
    stable_since = None

    def ready():
        nonlocal previous, stable_since
        state = browser.js("return window.overlapTest?.snapshot()")
        if not state or not state["mapLoaded"] or not state["tilesLoaded"] or state["moving"]:
            stable_since = None
            return False
        if state["camera"] != previous or stable_since is None:
            previous = state["camera"]
            stable_since = time.monotonic()
        return time.monotonic() - stable_since >= 0.3

    wait_for(
        ready,
        60,
        "settled production map",
    )


def open_profile(browser, atlas_id, source_id):
    search(browser, atlas_id, atlas_id)
    open_details(browser)
    if browser.js(
        "return !![...document.querySelectorAll('.wals-panel button')].find(b=>b.textContent==='Load WALS features')"
    ):
        click_text(browser, "Load WALS features")
    wait_for(
        lambda: browser.js("return !!document.querySelector('.wals-record')"),
        20,
        "ready WALS profile",
    )
    if browser.js(
        "return !!document.querySelector('select[aria-label=\"Recorded WALS variety\"]')"
    ):
        select(browser, "Recorded WALS variety", source_id)
    record(browser, source_id)


def show(browser, feature_id):
    select(browser, "Inspect a recorded WALS feature", feature_id)
    wait_for(
        lambda: browser.js(
            "return !!document.querySelector('.wals-card[data-feature-id=\"'+arguments[0]+'\"] button')",
            feature_id,
        ),
        10,
        "recorded feature map action",
    )
    browser.js(
        "document.querySelector('.wals-card[data-feature-id=\"'+arguments[0]+'\"] button').click()",
        feature_id,
    )
    wait_for(
        lambda: browser.js(
            "return document.querySelector('.wals-map-summary')?.dataset.walsFeature === arguments[0]",
            feature_id,
        ),
        15,
        "WALS map summary",
    )
    settled(browser)


def inspect_list(browser, source_id, keyboard=False):
    browser.js("document.querySelector('.wals-map-summary details').open=true")
    selector = f'.wals-map-list button[data-wals-source="{source_id}"]'
    if keyboard:
        browser.js("document.querySelector(arguments[0]).focus()", selector)
        key(browser, "\ue007")
    else:
        browser.js("document.querySelector(arguments[0]).click()", selector)
    record(browser, source_id)


def pointer_click(browser, selector):
    point = browser.js(
        "const r=document.querySelector(arguments[0]).getBoundingClientRect();return [Math.round(r.x+r.width/2),Math.round(r.y+r.height/2)]",
        selector,
    )
    browser.call(
        "POST",
        "/actions",
        {
            "actions": [
                {
                    "type": "pointer",
                    "id": "wals-click",
                    "parameters": {"pointerType": "mouse"},
                    "actions": [
                        {
                            "type": "pointerMove",
                            "duration": 0,
                            "origin": "viewport",
                            "x": point[0],
                            "y": point[1],
                        },
                        {"type": "pointerDown", "button": 0},
                        {"type": "pointerUp", "button": 0},
                    ],
                }
            ]
        },
    )


def run_case(output, *, fixture):
    report = {"checks": [], "fixture": fixture}
    with (
        browser_session(output) as (browser, upstream),
        controlled_server(upstream) as (origin, control, hits),
    ):
        print(f"Started {'fixture' if fixture else 'published'} production browser", flush=True)
        if fixture:
            control["body"] = (output.parent / "fixture.json").read_bytes()
        url = origin + "/lang-viz/?overlap-test=1&overlap-basemap=off"

        def check(name):
            state = browser.snapshot()
            assert not state["errors"], state["errors"]
            errors = [m for m in state["browserMessages"] if m["level"] in ("error", "pageerror")]
            assert not errors, errors
            report["checks"].append(name)
            print("Passed:", name, flush=True)

        try:
            browser.call("POST", "/url", {"url": url})
            wait_for(
                lambda: browser.js(
                    "return !!window.overlapTest && !!document.querySelector('.language-tabs')"
                ),
                60,
                "production atlas",
            )
            settled(browser)
            assert hits["/lang-viz/wals/features.json"] == 0
            assert hits["/lang-viz/etymology/word-trails.json"] == 0
            assert not browser.js(
                r"return performance.getEntriesByType('resource').some(r=>/\/(?:WalsLayer|WalsMapSummary|WordTrailLayer)-/.test(r.name))"
            )
            check(
                "Geography stays lazy before feature use; neither overlay implementation nor dataset fetched"
            )

            if fixture:
                control["wals"] = "delay"
                search(browser, "stan1293", "stan1293")
                open_details(browser)
                click_text(browser, "Load WALS features")
                wait_for(lambda: hits["/lang-viz/wals/features.json"] == 1, 10, "delayed WALS load")
                browser.js(
                    "document.querySelector('.finder-detail__close').click();window.overlapTest.camera([40,20],3)"
                )
                settled(browser)
                camera = browser.snapshot()["camera"]
                control["release"].set()
                control["wals"] = "ready"
                wait_for(
                    lambda: browser.js(
                        "return performance.getEntriesByType('resource').some(r=>r.name.endsWith('/wals/features.json'))"
                    ),
                    20,
                    "late WALS response",
                )
                render_frames(browser)
                assert browser.snapshot()["camera"] == camera
                assert not browser.js(
                    "return !!document.querySelector('.wals-map-summary') || !!document.querySelector('.finder-detail')"
                )
                check(
                    "late WALS loading after profile closure neither establishes an overlay nor changes camera/navigation"
                )

            # Establish actual pinned polygon comparisons before using WALS.
            browser.js("window.overlapTest.configure(arguments[0])", SCENARIOS[0])
            browser.settled(100, fail_on_error=True)
            pinned = browser.js("return window.overlapTest.mapEntryState()")
            assert pinned
            open_profile(browser, "stan1293", "eng")
            show(browser, "12A")
            assert browser.js("return document.querySelectorAll('.wals-map-marker').length") > 0
            assert browser.js("return window.overlapTest.mapEntryState()") == pinned
            original = browser.js(
                "return document.querySelector('.wals-map-summary').dataset.walsOrigin"
            )
            camera = browser.snapshot()["camera"]
            check(
                "explicit show renders static WALS points and source counts while preserving pinned comparisons"
            )

            # Every displayed observation is keyboard accessible independently of globe occlusion.
            count = browser.js(
                "document.querySelector('.wals-map-summary details').open=true;return document.querySelectorAll('.wals-map-list button').length"
            )
            assert 1 <= count <= 13
            target = (
                "ird"
                if fixture
                else browser.js(
                    "return document.querySelectorAll('.wals-map-list button')[1].dataset.walsSource"
                )
            )
            inspect_list(browser, target, keyboard=True)
            assert browser.snapshot()["camera"] == camera
            assert (
                browser.js("return document.querySelector('.wals-map-summary').dataset.walsOrigin")
                == original
            )
            assert (
                browser.js(
                    "return document.querySelector('select[aria-label=\"Inspect a recorded WALS feature\"]').value"
                )
                == "12A"
            )
            check(
                "keyboard inspection preserves exact source/feature, origin specification and camera"
            )

            if fixture:
                # A shared point must offer every source; clicking it cannot pick a default.
                browser.js(
                    "document.querySelector('input[name=map-projection][value=mercator]').click()"
                )
                settled(browser)
                shared_selector = '.wals-map-marker[data-wals-sources="colocated ird"]'
                wait_for(
                    lambda: browser.js(
                        "return !!document.querySelector(arguments[0])", shared_selector
                    ),
                    10,
                    "colocated marker",
                )
                before = browser.js(
                    "return document.querySelector('.wals-record').dataset.sourceId"
                )
                pointer_click(browser, shared_selector)
                wait_for(
                    lambda: browser.js("return !!document.querySelector('.wals-map-popup')"),
                    10,
                    "shared-location chooser",
                )
                assert (
                    browser.js("return document.querySelector('.wals-record').dataset.sourceId")
                    == before
                )
                assert "2 displayed observations" in text(browser, ".wals-map-popup")
                browser.js(
                    "[...document.querySelectorAll('.wals-map-popup button')].find(b=>b.textContent.includes('(ird)')).click()"
                )
                record(browser, "ird")
                inspect_list(browser, "orphan", keyboard=True)
                assert "Unmatched fixture" in text(browser, ".wals-standalone")
                assert "unmatched" in text(browser, ".wals-map-list").lower()
                inspect_list(browser, "broad")
                assert "Broader catalog association (family)" in text(browser, ".wals-record")
                check(
                    "colocated marker offers explicit variety choice; unmatched and broader records retain source evidence"
                )

                # Put a WALS marker directly over a selected polygon and use a physical click.
                browser.js("window.overlapTest.camera([-0.1,51.5],5.4)")
                settled(browser)
                pointer_click(browser, '.wals-map-marker[data-wals-sources="eng"]')
                record(browser, "eng")
                assert not browser.js(
                    "return !!document.querySelector('.language-inspector--pinned')"
                )
                assert browser.js("return window.overlapTest.mapEntryState()") == pinned
                check(
                    "physical WALS marker click takes priority over underlying pinned polygon inspection"
                )

                open_profile(browser, "stan1293", "eng")
                show(browser, "37A")
                assert "No other located records" in text(browser, ".wals-map-summary")
                assert (
                    browser.js("return document.querySelectorAll('.wals-map-marker').length") == 1
                )
                open_profile(browser, "iris1253", "unlocated")
                show(browser, "81A")
                assert "origin has no usable WALS location" in text(browser, ".wals-map-summary")
                open_profile(browser, "stan1293", "east")
                show(browser, "12A")
                assert browser.snapshot()["projection"]["type"] == "mercator"
                longitude = browser.snapshot()["camera"]["center"][0]
                assert abs(longitude) < 1, longitude
                assert browser.js(
                    """return [...document.querySelectorAll('.wals-map-marker')].every(el=>{const r=el.getBoundingClientRect(), m=document.querySelector('.maplibregl-canvas').getBoundingClientRect();return r.x>=m.x && r.right<=m.right})"""
                )
                inspect_list(browser, "west")
                assert "West dateline fixture" in text(browser, ".wals-standalone")
                check(
                    "empty results, missing origin location and dateline-aware focus remain explicit without projection switching"
                )

            else:
                # Real Donegal must be clicked from another actual origin's selected markers.
                data = json.loads((APP / "public/wals/features.json").read_text())
                for source_id, feature_id, target_id, profile_id in [
                    ("abk", "12A", "ird", "iris1253"),
                    ("ady", "37A", "kyq", "nuuc1236"),
                    ("aeg", "12A", "aea", "aleu1260"),
                ]:
                    open_profile(browser, data["records"][source_id]["glottocode"], source_id)
                    show(browser, feature_id)
                    browser.js(
                        "document.querySelector('.wals-map-marker[data-wals-sources=\"'+arguments[0]+'\"]').click()",
                        target_id,
                    )
                    record(browser, target_id)
                    assert (
                        browser.js(
                            "return document.querySelector('select[aria-label=\"Inspect a recorded WALS feature\"]').value"
                        )
                        == feature_id
                    )
                    assert (
                        profile_id in text(browser, ".finder-detail")
                        or browser.js(
                            "return document.querySelector('.wals-record').dataset.sourceId"
                        )
                        == target_id
                    )
                    assert (
                        browser.js(
                            "return document.querySelector('.wals-map-summary').dataset.walsOrigin"
                        )
                        == source_id
                    )
                check(
                    "published Donegal, Kyuquot and Eastern Aleut marker inspections preserve the exact observation"
                )

            # Keep the lexical trail and WALS exploration simultaneously, with independent controls.
            click_text(browser, "Word histories")
            wait_for(
                lambda: browser.js("return !!document.querySelector('.word-explorer-heading')"),
                40,
                "lexical workspace",
            )
            click_text(browser, "wine ↗")
            click_text(browser, "Show current word trail")
            settled(browser)
            wait_for(
                lambda: browser.js(
                    "return !!document.querySelector('.word-map-summary') && !!document.querySelector('.word-map-marker')"
                ),
                20,
                "simultaneous overlays",
            )
            assert browser.js(
                "return !!document.querySelector('.wals-map-summary') && !!document.querySelector('.wals-map-marker')"
            )
            camera = browser.snapshot()["camera"]
            click_text(browser, "Hide WALS overlay")
            wait_for(
                lambda: browser.js("return !document.querySelector('.wals-map-marker')"),
                10,
                "WALS hidden",
            )
            assert browser.js("return !!document.querySelector('.word-map-marker')")
            click_text(browser, "Show WALS overlay")
            wait_for(
                lambda: browser.js("return !!document.querySelector('.wals-map-marker')"),
                10,
                "WALS visible",
            )
            click_text(browser, "Hide word overlay")
            wait_for(
                lambda: browser.js("return !document.querySelector('.word-map-marker')"),
                10,
                "lexical hidden",
            )
            assert browser.js("return !!document.querySelector('.wals-map-marker')")
            click_text(browser, "Show word overlay")
            wait_for(
                lambda: browser.js("return !!document.querySelector('.word-map-marker')"),
                10,
                "lexical visible",
            )
            assert browser.snapshot()["camera"] == camera
            assert browser.js("return window.overlapTest.mapEntryState()") == pinned
            check(
                "simultaneous overlays retain independent visibility and pins; unhide does not replay camera intent"
            )

            # Emulate the preference at the browser media-query boundary, retaining native objects.
            browser.js("""window.walsMatchMedia=window.matchMedia.bind(window);window.matchMedia=q=>{
                const result=window.walsMatchMedia(q);if(q==='(prefers-reduced-motion: reduce)')Object.defineProperty(result,'matches',{value:true});return result;
            };window.overlapTest.camera([0,0],4)""")
            settled(browser)
            click_text(browser, "Focus WALS examples")
            render_frames(browser)
            assert not browser.snapshot()["moving"]
            browser.js("window.matchMedia=window.walsMatchMedia;delete window.walsMatchMedia")
            check(
                "emulated reduced-motion preference focuses without an animated camera transition"
            )

            # Physically interrupt a running explicit focus, then test that no idle/style replay occurs.
            browser.js("window.overlapTest.camera([0,0],5)")
            settled(browser)
            click_text(browser, "Focus WALS examples")
            rectangle = browser.js(
                "const r=document.querySelector('.maplibregl-canvas').getBoundingClientRect();return [Math.round(r.x+r.width/2),Math.round(r.y+r.height/2)]"
            )
            browser.call(
                "POST",
                "/actions",
                {
                    "actions": [
                        {
                            "type": "pointer",
                            "id": "wals-drag",
                            "parameters": {"pointerType": "mouse"},
                            "actions": [
                                {
                                    "type": "pointerMove",
                                    "duration": 0,
                                    "origin": "viewport",
                                    "x": rectangle[0],
                                    "y": rectangle[1],
                                },
                                {"type": "pointerDown", "button": 0},
                                {
                                    "type": "pointerMove",
                                    "duration": 100,
                                    "origin": "viewport",
                                    "x": rectangle[0] + 60,
                                    "y": rectangle[1] + 25,
                                },
                                {"type": "pointerUp", "button": 0},
                            ],
                        }
                    ]
                },
            )
            settled(browser)
            camera = browser.snapshot()["camera"]
            browser.js("window.overlapTest.reloadStyle()")
            settled(browser)
            assert browser.snapshot()["camera"] == camera
            check(
                "physical map drag interrupts WALS focus and style restoration does not replay it"
            )

            for projection in ("mercator", "globe"):
                browser.js(
                    "document.querySelector('input[name=map-projection][value='+arguments[0]+']').click()",
                    projection,
                )
                settled(browser)
                camera = browser.snapshot()["camera"]
                browser.js("window.overlapTest.reloadStyle()")
                settled(browser)
                assert browser.snapshot()["camera"] == camera
                assert browser.js(
                    "return !!document.querySelector('.word-map-marker') && !!document.querySelector('.wals-map-marker')"
                )
                assert browser.snapshot()["projection"]["type"] == (
                    "mercator" if projection == "mercator" else "vertical-perspective"
                )
                browser.screenshot(output / f"{projection}.png")
            check(
                "style restoration and both projections retain both overlays without camera replay"
            )

            camera = browser.snapshot()["camera"]
            click_text(browser, "Word histories")
            wait_for(
                lambda: browser.js("return !!document.querySelector('.word-explorer-heading')"),
                20,
                "workspace round trip",
            )
            click_text(browser, "Geography")
            settled(browser)
            assert browser.snapshot()["camera"] == camera
            click_text(browser, "Clear WALS overlay")
            wait_for(
                lambda: browser.js(
                    "return !document.querySelector('.wals-map-summary') && !document.querySelector('.wals-map-marker')"
                ),
                10,
                "WALS cleared",
            )
            assert browser.js("return !!document.querySelector('.word-map-marker')")
            assert browser.js("return window.overlapTest.mapEntryState()") == pinned
            check(
                "workspace round trip does not refocus; clearing WALS preserves lexical overlay and pinned areas"
            )

            if fixture:
                # A profile geometry response arriving after WALS focus cannot reclaim the camera.
                control["bounds"] = "delay"
                control["release"].clear()
                bounds_requests = hits["/lang-viz/data/geometry-bounds.json"]
                browser.call("POST", "/url", {"url": "about:blank"})
                browser.call("POST", "/url", {"url": url})
                wait_for(
                    lambda: browser.js(
                        "return !!window.overlapTest && !!document.querySelector('.language-tabs')"
                    ),
                    60,
                    "fresh delayed-bounds atlas",
                )
                open_profile(browser, "stan1293", "eng")
                wait_for(
                    lambda: hits["/lang-viz/data/geometry-bounds.json"] > bounds_requests,
                    15,
                    "pending profile geometry bounds",
                )
                show(browser, "12A")
                camera = browser.snapshot()["camera"]
                control["release"].set()
                control["bounds"] = "ready"
                wait_for(
                    lambda: browser.js(
                        "return performance.getEntriesByType('resource').some(r=>r.name.endsWith('/geometry-bounds.json'))"
                    ),
                    20,
                    "late geometry bounds response",
                )
                render_frames(browser)
                assert browser.snapshot()["camera"] == camera
                check("late profile geometry bounds cannot override a newer WALS focus")
            report["passed"] = True
        except Exception as error:
            report["error"] = str(error)
            report["failureSnapshot"] = browser.js("return window.overlapTest?.snapshot() ?? null")
            browser.screenshot(output / "failure.png")
            (output / "failure-dom.txt").write_text(browser.js("return document.body.innerText"))
            raise
        finally:
            report["requests"] = dict(hits)
            (output / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    return report


def main():
    os.environ["GITHUB_PAGES"] = "true"
    output = APP / "test-results/wals-06"
    output.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        [
            "node",
            "--input-type=module",
            "-e",
            "import {mapWalsData} from './tests/fixtures/wals-map.ts'; import {writeFileSync} from 'node:fs'; writeFileSync('test-results/wals-06/fixture.json',JSON.stringify(mapWalsData()))",
        ],
        cwd=APP,
        check=True,
    )
    if not os.environ.get("WALS_SKIP_BUILD"):
        subprocess.run(["npm", "run", "build"], cwd=APP, check=True)
    report = {"passed": False, "base": "/lang-viz/"}
    case = os.environ.get("WALS_CASE")
    if case not in (None, "fixture", "published"):
        raise ValueError("WALS_CASE must be fixture or published when set")
    report["scope"] = case or "fixture and published"
    try:
        if case in (None, "fixture"):
            report["fixture"] = run_case(output / "fixture", fixture=True)
        if case in (None, "published"):
            report["published"] = run_case(output / "published", fixture=False)
        report["passed"] = True
    finally:
        (output / "report.json").write_text(json.dumps(report, indent=2) + "\n")


if __name__ == "__main__":
    main()
