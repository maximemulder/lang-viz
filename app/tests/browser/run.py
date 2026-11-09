#!/usr/bin/env python3
"""Production-browser overlap checks using installed Firefox and W3C WebDriver.

No Python packages, browser downloads, React internals, or fixed startup sleeps.
"""

import argparse
import base64
import hashlib
import json
import os
import pathlib
import platform
import shutil
import signal
import socket
import subprocess
import time
import urllib.error
import urllib.request
from contextlib import ExitStack, contextmanager
from types import SimpleNamespace

APP = pathlib.Path(__file__).resolve().parents[2]
SCENARIOS = json.loads((pathlib.Path(__file__).parent / "scenarios.json").read_text())
SUPPORTED_LIMITS = {
    "input-vertices",
    "output-vertices",
    "intermediate-regions",
    "tile-deadline",
    "request-deadline",
    "publication-deadline",
    "shared-patterns",
    "pattern-memory",
    "pattern-contributors",
}


def request(base, method, path, payload=None):
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(
        base + path,
        data=data,
        method=method,
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as response:
            return json.load(response).get("value")
    except urllib.error.HTTPError as error:
        raise RuntimeError(error.read().decode()) from error


def wait_for(probe, timeout, description):
    deadline = time.monotonic() + timeout
    last_error = None
    while time.monotonic() < deadline:
        try:
            result = probe()
            if result:
                return result
        except (urllib.error.URLError, ConnectionError) as error:
            last_error = error
        time.sleep(0.1)
    raise TimeoutError(f"Timed out waiting for {description}; last error: {last_error}")


def free_port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def stop(process):
    process.terminate()
    try:
        process.wait(timeout=10)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait()


def stop_group(process):
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        pass
    stop(process)


def sha256(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


class Browser:
    def __init__(self, base, args):
        options = {
            "args": [] if args.headed else ["-headless"],
            "env": {} if args.hardware else {"LIBGL_ALWAYS_SOFTWARE": "true"},
            "prefs": {
                "webgl.force-enabled": True,
                "webgl.disabled": False,
                "webgl.disable-fail-if-major-performance-caveat": True,
                "gfx.webrender.software": not args.hardware,
            },
        }
        result = request(
            base,
            "POST",
            "/session",
            {
                "capabilities": {
                    "alwaysMatch": {
                        "browserName": "firefox",
                        "moz:firefoxOptions": options,
                    }
                },
            },
        )
        self.base = base
        self.session = "/session/" + result["sessionId"]
        self.capabilities = result["capabilities"]
        self.call("POST", "/window/rect", {"width": 1440, "height": 1000})

    def call(self, method, path, payload=None):
        return request(self.base, method, self.session + path, payload)

    def js(self, script, *args):
        return self.call("POST", "/execute/sync", {"script": script, "args": args})

    def snapshot(self):
        return self.js("return window.overlapTest.snapshot()")

    def terminal(self, after, timeout):
        def probe():
            state = self.snapshot()
            reports = state["reports"]
            if len(reports) <= after or state["moving"]:
                return None
            report = reports[-1]
            if report["outcome"] == "error" and state["status"] == "error":
                return state
            if (
                report["outcome"] == "ready"
                and state["status"] == "ready"
                and report.get("firstRenderMs") is not None
                and state["activeBuffers"] == [report["buffer"]]
            ):
                return state
            return None

        return wait_for(probe, timeout, "overlap result and first rendered coverage")

    def settled(self, timeout, *, fail_on_error=False):
        stable_since = None
        previous = None

        def probe():
            nonlocal stable_since, previous
            state = self.snapshot()
            if fail_on_error and state["status"] == "error":
                raise AssertionError(state["reports"][-1])
            stamp = (len(state["reports"]), state["status"])
            ready = (
                state["mapLoaded"]
                and state["tilesLoaded"]
                and not state["moving"]
                and state["status"] == "ready"
            )
            if not ready or stamp != previous or stable_since is None:
                previous = stamp
                stable_since = time.monotonic() if ready else None
            if ready and stable_since is not None and time.monotonic() - stable_since >= 0.3:
                return state
            return None

        return wait_for(probe, timeout, "settled projection, navigation debounce and coverage")

    def screenshot(self, path):
        path.write_bytes(base64.b64decode(self.call("GET", "/screenshot")))

    def close(self):
        self.call("DELETE", "")


def check_state(state, require_stripes=False, expected_errors=()):
    unexpected = [error for error in state["errors"] if error not in expected_errors]
    assert not unexpected, f"Map errors: {unexpected}"
    errors = [
        m
        for m in state["browserMessages"]
        if m["level"] in ("pageerror", "error") and m["message"] not in expected_errors
    ]
    assert not errors, f"Browser errors: {errors}"
    assert state["blankLayerFrames"] == 0, "A rendered frame disabled all language coverage layers"
    report = state["reports"][-1]
    services = state.get("tileServices", {})
    receiver = services.get("receiver", {})
    assert receiver.get("snapshots", 0) <= 2, "Unused coverage snapshots accumulated"
    assert receiver.get("tiles", 0) <= 96, "Snapshot tile retention exceeded two buffers"
    delivery = services.get("delivery", {})
    assert delivery.get("parentBytes", 0) <= 8 * 1024**2
    assert delivery.get("parentEntries", 0) <= 48
    fallback = services.get("fallback", {})
    assert fallback.get("rawBytes", 0) <= 16 * 1024**2
    assert fallback.get("resultBytes", 0) <= 16 * 1024**2
    assert fallback.get("rawEntries", 0) <= 48
    assert fallback.get("resultEntries", 0) <= 96
    cache = report.get("metrics", {}).get("cache", {})
    assert cache.get("decodedEntries", 0) <= 48
    assert cache.get("decodedBytes", 0) <= 16 * 1024**2
    assert cache.get("partitionVertices", 0) <= 150_000
    if report["outcome"] == "error":
        assert not require_stripes, f"Required stripes unavailable: {report}"
        assert report["failure"] in SUPPORTED_LIMITS, f"Unexpected failure: {report}"
        return "unsupported"
    assert state["activeBuffers"] in ([0], [1]), "Expected exactly one active coverage buffer"
    if require_stripes:
        assert report["sharedPatterns"] > 0, "Expected actual shared-area stripes"
    return "stripes" if report.get("sharedPatterns", 0) else "solid-coverage"


def check_pixels(browser):
    """Read actual framebuffer pixels inside English-only coverage, away from edges."""
    browser.js("document.querySelector('[aria-label=\"Map settings\"]').click()")
    element = browser.call(
        "POST", "/element", {"using": "css selector", "value": "#language-opacity"}
    )["element-6066-11e4-a52e-4f735466cecf"]
    browser.call("POST", f"/element/{element}/value", {"text": "\ue010"})
    wait_for(
        lambda: browser.js("return document.querySelector('#language-opacity').value==='100'"),
        10,
        "100% color intensity",
    )
    samples = {}
    language_color = browser.js("return window.overlapTest.colorState(['stan1293']).colors.stan1293")
    expected = tuple(int(language_color[i:i + 2], 16) for i in (1, 3, 5)) + (255,)
    for projection in ("globe", "mercator"):
        browser.js(
            "document.querySelector('input[name=map-projection][value='+arguments[0]+']').click()",
            projection,
        )
        # Sampling happens in a render callback, before the drawing buffer is discarded.
        pixels = browser.call(
            "POST",
            "/execute/async",
            {
                "script": "const done=arguments[arguments.length-1];window.overlapTest.samplePixels([-1.5,52.5],8).then(done)",
                "args": [],
            },
        )
        colors = {tuple(pixels[i : i + 4]) for i in range(0, len(pixels), 4)}
        assert colors == {expected}, (
            f"Solid-fill texture/color artifact in {projection}: {colors}"
        )
        samples[projection] = {"pixels": len(pixels) // 4, "rgba": list(next(iter(colors)))}
    browser.js("document.querySelector('[aria-label=\"Map settings\"]').click()")
    return samples


def check_failure_recovery(browser, origin, args):
    results = []
    for service in ("coverage", "fallback"):
        open_atlas(browser, origin, terrain=args.terrain, timeout=args.timeout)
        browser.js("window.overlapTest.configure(arguments[0])", SCENARIOS[0])
        previous = browser.terminal(0, args.timeout)
        check_state(previous, require_stripes=True)
        browser.js(
            "window.overlapTest.failNextPublication(arguments[0]);window.overlapTest.camera([25,54.2],4.4)",
            service,
        )
        failed = browser.terminal(len(previous["reports"]), args.timeout)
        expected = (f"Error: Injected {service} tile failure",)
        assert failed["status"] == "error" and failed["reports"][-1]["failure"] == "source-error"
        assert failed["activeBuffers"] == previous["activeBuffers"], (
            "Failed staging replaced valid coverage"
        )
        assert failed["coverageUrls"] == previous["coverageUrls"], (
            "Failed staging retained its source"
        )
        assert failed["tileServices"]["receiver"]["snapshots"] == 1
        assert failed["errors"] == list(expected), (
            f"Unexpected injected failure: {failed['errors']}"
        )
        browser.screenshot(args.output / f"{service}-failure.png")
        after = len(failed["reports"])
        browser.js("document.querySelector('.overlap-feedback button').click()")
        recovered = browser.terminal(after, args.timeout)
        check_state(recovered, require_stripes=True, expected_errors=expected)
        missing = (
            recovered["reports"][-1]["tileCount"]
            - previous["reports"][-1]["tileCount"]
            - failed["reports"][-1].get("deliveredTiles", 0)
        )
        assert recovered["reports"][-1].get("deliveredTiles", 0) == missing, (
            "Retry resent completed tiles"
        )
        assert recovered["tileServices"]["receiver"]["snapshots"] == 1
        results.append({"service": service, "failed": failed, "recovered": recovered})
        print(f"{service} failure: previous coverage retained; Retry recovered", flush=True)
    return results


def check_inspection(browser):
    """Real pointer clicks must explain the membership of the displayed MVT face."""
    results = []
    for center, expected in (
        ([-1.5, 52.5], ["stan1293"]),
        ([-4, 52.3], ["stan1293", "wels1247"]),
        ([2, 52.5], []),
    ):
        hit = browser.js("return window.overlapTest.inspect(arguments[0])", center)
        members = sorted(variant.split(":")[-1] for variant in hit["variantIds"])
        assert members == sorted(expected), (
            f"Unexpected displayed membership at {center}: {members}"
        )
        x, y = hit["point"]
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
                            {
                                "type": "pointerMove",
                                "duration": 0,
                                "origin": "viewport",
                                "x": x,
                                "y": y,
                            },
                            {"type": "pointerDown", "button": 0},
                            {"type": "pointerUp", "button": 0},
                        ],
                    }
                ]
            },
        )
        wait_for(
            lambda expected=expected: browser.js(
                "return document.querySelectorAll('.language-inspector__entry').length===arguments[0]",
                len(expected),
            ),
            10,
            "inspection popup membership",
        )
        text = browser.js("return document.querySelector('.language-inspector')?.textContent || ''")
        assert all(language in text for language in expected), (
            f"Popup disagrees with coverage: {text}"
        )
        results.append({"center": center, "variantIds": hit["variantIds"]})
    browser.call("DELETE", "/actions")
    return results


def check_style_reload(browser, args):
    before = browser.snapshot()
    browser.js("window.overlapTest.reloadStyle()")
    state = wait_for(
        lambda: (
            s
            if (s := browser.snapshot())["tilesLoaded"]
            and not s["styleReloading"]
            and s["patternImages"] > 0
            else None
        ),
        args.timeout,
        "coverage after style replacement",
    )
    check_state(state, require_stripes=True)
    assert state["coverageUrls"] == before["coverageUrls"], "Style reload replaced valid geometry"
    assert len(state["reports"]) == len(before["reports"]), "Style reload recomputed geometry"
    # Image restoration is lazy: only patterns used by visible render tiles need
    # to return immediately; offscreen retained patterns restore when requested.
    assert not state["missingVisiblePatterns"], "Style reload lost visible stripe images"
    assert browser.js("return window.overlapTest.inspect([-4,52.3]).variantIds.length") == 2
    return state


def check_zoom_continuity(browser, args, projection):
    """A stable shared location must remain striped throughout large zoom changes."""
    browser.js("window.overlapTest.watchStripes([-4,52.3])")
    for zoom in (7.4, 3.4, 6.4, 4.4):
        after = len(browser.snapshot()["reports"])
        browser.js("window.overlapTest.camera([-4,52.3],arguments[0],900)", zoom)
        state = browser.terminal(after, args.timeout)
        check_state(state, require_stripes=True)
    after = len(browser.snapshot()["reports"])
    browser.call(
        "POST",
        "/execute/async",
        {
            "script": "const done=arguments[arguments.length-1];"
            "window.overlapTest.camera([-4,52.3],7.4,900);"
            "setTimeout(()=>window.overlapTest.camera([-4,52.3],3.4,900),180);"
            "setTimeout(()=>window.overlapTest.camera([-4,52.3],6.4,900),360);"
            "setTimeout(done,1400)",
            "args": [],
        },
    )
    state = browser.terminal(after, args.timeout)
    check_state(state, require_stripes=True)
    for center in ([-1, 53.5], [-4, 52.3]):
        browser.js("window.overlapTest.camera(arguments[0],6.4,600)", center)
        wait_for(lambda: not browser.snapshot()["moving"], args.timeout, "nearby pan")
        time.sleep(0.2)  # allow the 120 ms navigation debounce to dispatch
        state = wait_for(
            lambda: (
                s if (s := browser.snapshot())["status"] != "loading" and s["tilesLoaded"] else None
            ),
            args.timeout,
            "pan publication",
        )
        check_state(state, require_stripes=True)
    after = len(browser.snapshot()["reports"])
    browser.js("window.overlapTest.camera([-4,52.3],4.4,900)")
    check_state(browser.terminal(after, args.timeout), require_stripes=True)
    state = browser.snapshot()
    browser.js("window.overlapTest.watchStripes(null)")
    frames = state["stripeFrames"]
    lost = [frame for frame in frames if not frame["shared"]]
    flat = [frame for frame in frames if frame["colors"] <= 2]
    print(
        f"Zoom continuity ({projection}): {len(frames)} sampled frames; {len(lost)} lost shared coverage; {len(flat)} flat pixel patches",
        flush=True,
    )
    assert len(frames) >= 20, "Too few zoom frames sampled"
    assert not lost, f"Shared coverage popped out during zoom: {lost[:8]}"
    assert not flat, f"Stripe pixel patch became flat during zoom: {flat[:8]}"
    return frames


def check_area_continuity(browser, args, projection):
    """Previously filled land interiors must survive delayed tile replacements."""
    points = [
        [-4, 52.3],
        [-3, 52.3],
        [-2, 52.3],
        [-1, 52.3],
        # Keep this continuity probe inside land and away from the exact x=0
        # tile cut. A render-only apron can briefly color that cut before the
        # newly exposed neighboring tile has ever loaded. The fully loaded
        # synthetic seam probe separately checks exact tile boundaries.
        [0.1, 52.3],
        [-0.3, 52.3],
        [-3, 53.3],
        [-2, 53.3],
        [-1, 53.3],
        [-2, 54.3],
        [-3, 54.3],
    ]
    results = {}
    for service in ("coverage", "fallback"):
        browser.js(
            "window.overlapTest.watchAreas(arguments[0]);window.overlapTest.setTileDelay(arguments[1],700)",
            points,
            service,
        )
        for center, zoom in [
            ([-4, 52.3], 7.4),
            ([-4, 52.3], 3.4),
            ([-1, 53.3], 6.4),
            ([-4, 52.3], 6.4),
            ([-4, 52.3], 4.4),
        ]:
            browser.js("window.overlapTest.camera(arguments[0],arguments[1],900)", center, zoom)
            wait_for(lambda: not browser.snapshot()["moving"], args.timeout, "area navigation")
            time.sleep(0.2)  # allow the navigation debounce to dispatch, if needed
            state = wait_for(
                lambda: (
                    s
                    if (s := browser.snapshot())["status"] != "loading" and s["tilesLoaded"]
                    else None
                ),
                args.timeout,
                "area tiles and publication",
            )
            check_state(state, require_stripes=True)
        state = browser.snapshot()
        browser.js(
            "window.overlapTest.watchAreas(null);window.overlapTest.setTileDelay(arguments[0],0)",
            service,
        )
        frames = state["areaFrames"]
        missing = [f for f in frames if f["disappeared"]]
        print(
            f"Area continuity ({projection}, slow {service}): {len(frames)} frames, {len(missing)} with disappearance",
            flush=True,
        )
        (args.output / f"area-{projection}-{service}.json").write_text(json.dumps(frames, indent=2))
        assert len(frames) >= 20 and sum(f["samples"] for f in frames) >= 200
        assert not missing, f"Language area disappeared: {missing[:8]}"
        results[service] = frames
    return results


@contextmanager
def browser_session(output, *, dev=False, options=None):
    """Own the application server, WebDriver, browser, and their cleanup."""
    output.mkdir(parents=True, exist_ok=True)
    with ExitStack() as stack:
        preview_port, driver_port = free_port(), free_port()
        while driver_port == preview_port:
            driver_port = free_port()
        preview_log = stack.enter_context((output / "preview.log").open("w"))
        driver_log = stack.enter_context((output / "geckodriver.log").open("w"))
        preview = subprocess.Popen(
            [
                "npm",
                "run",
                "dev" if dev else "preview",
                "--",
                "--host",
                "127.0.0.1",
                "--port",
                str(preview_port),
                "--strictPort",
            ],
            cwd=APP,
            stdout=preview_log,
            stderr=subprocess.STDOUT,
            start_new_session=True,
        )
        stack.callback(stop_group, preview)
        driver = subprocess.Popen(
            ["geckodriver", "--host", "127.0.0.1", "--port", str(driver_port), "--log", "warn"],
            stdout=driver_log,
            stderr=subprocess.STDOUT,
        )
        stack.callback(stop, driver)
        origin = f"http://127.0.0.1:{preview_port}"
        webdriver = f"http://127.0.0.1:{driver_port}"
        wait_for(
            lambda: urllib.request.urlopen(origin, timeout=2).status == 200,
            20,
            "application server",
        )
        wait_for(lambda: request(webdriver, "GET", "/status"), 20, "geckodriver")
        browser = Browser(webdriver, options or SimpleNamespace(headed=False, hardware=False))
        stack.callback(browser.close)
        yield browser, origin


def open_atlas(browser, origin, *, terrain=False, timeout=45):
    url = origin + "/?overlap-test=1" + ("" if terrain else "&overlap-basemap=off")
    browser.call("POST", "/url", {"url": url})
    wait_for(lambda: browser.js("return !!window.overlapTest"), timeout, "application")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dev",
        action="store_true",
        help="Check Vite development serving instead of the production build",
    )
    parser.add_argument("--headed", action="store_true", help="Show the Firefox window")
    parser.add_argument("--hardware", action="store_true", help="Do not force software rendering")
    parser.add_argument(
        "--terrain", action="store_true", help="Include the external terrain basemap"
    )
    parser.add_argument(
        "--skip-build", action="store_true", help="Use the existing production dist"
    )
    parser.add_argument("--scenario", choices=[s["name"] for s in SCENARIOS], action="append")
    parser.add_argument("--runs", type=int, default=1)
    parser.add_argument("--timeout", type=float, default=90)
    parser.add_argument("--output", type=pathlib.Path, default=APP / "test-results" / "overlap")
    args = parser.parse_args()
    if args.runs < 1:
        parser.error("--runs must be positive")
    if not shutil.which("geckodriver") or not shutil.which("firefox"):
        parser.error("Install Firefox and geckodriver on PATH; this runner downloads nothing")
    if not (APP / "public/data/language-areas.pmtiles").is_file():
        parser.error("Generate the local atlas data first; see the repository README")
    args.output.mkdir(parents=True, exist_ok=True)
    if shutil.disk_usage(args.output).free < 1024**3:
        parser.error("Keep at least 1 GiB free before building/running browser checks")
    if not args.skip_build and not args.dev:
        subprocess.run(["npm", "run", "build"], cwd=APP, check=True)

    archive = APP / "public/data/language-areas.pmtiles"
    result = {
        "schemaVersion": 1,
        "environment": {
            "serving": "development" if args.dev else "production",
            "platform": platform.platform(),
            "cpuCount": os.cpu_count(),
            "headed": args.headed,
            "softwareRequested": not args.hardware,
            "terrain": args.terrain,
            "window": [1440, 1000],
            "archiveSha256": sha256(archive),
            "buildSha256": {
                str(p.relative_to(APP / "dist")): sha256(p)
                for p in sorted((APP / "dist/assets").glob("*.js"))
            },
            "gitRevision": subprocess.check_output(
                ["git", "rev-parse", "HEAD"], cwd=APP, text=True
            ).strip(),
            "gitStatus": subprocess.check_output(["git", "status", "--short"], cwd=APP, text=True),
            "coldDefinition": "fresh page/overlap worker; HTTP/browser/OS caches may be warm",
            "warmDefinition": "same camera/selection, force republish using persistent worker caches",
        },
        "cases": [],
    }

    def save():
        (args.output / "report.json").write_text(json.dumps(result, indent=2) + "\n")

    failed = False
    with browser_session(args.output, dev=args.dev, options=args) as (browser, origin):
        result["environment"]["browser"] = browser.capabilities
        for run in range(args.runs):
            for scenario in SCENARIOS:
                if args.scenario and scenario["name"] not in args.scenario:
                    continue
                case = {"name": scenario["name"], "run": run + 1, "scenario": scenario}
                result["cases"].append(case)
                try:
                    open_atlas(browser, origin, terrain=args.terrain, timeout=args.timeout)
                    browser.js("window.overlapTest.configure(arguments[0])", scenario)
                    for phase in ("cold", "warm"):
                        after = 0 if phase == "cold" else len(browser.snapshot()["reports"])
                        if phase == "warm":
                            browser.js("window.overlapTest.recompute()")
                        state = browser.terminal(after, args.timeout)
                        outcome = check_state(state, scenario.get("requireStripes", False))
                        case[phase] = {"outcome": outcome, "snapshot": state}
                        browser.screenshot(
                            args.output / f"{scenario['name']}-{run + 1}-{phase}.png"
                        )
                        report = state["reports"][-1]
                        print(
                            f"{scenario['name']} {phase}: {outcome}; worker={report.get('workerMs')} ms; reason={report.get('failure', '-')}",
                            flush=True,
                        )

                    if scenario["name"] == "britain-small":
                        case["tileSeams"] = browser.js("return window.overlapTest.probeTileSeams()")
                        assert any(
                            r["gaps"]
                            for r in case["tileSeams"]
                            if not r["buffered"] and r["projection"] == "globe"
                        ), "Unbuffered control did not reproduce globe cracks"
                        assert all(r["gaps"] == 0 for r in case["tileSeams"] if r["buffered"]), (
                            f"Buffered tile cracks: {case['tileSeams']}"
                        )
                        case["inspection"] = check_inspection(browser)
                        case["styleReload"] = check_style_reload(browser, args)
                        case["solidPixels"] = check_pixels(browser)
                        # Restore globe before the existing navigation checks.
                        browser.js(
                            "document.querySelector('input[name=map-projection][value=globe]').click()"
                        )

                    if scenario["name"] in ("britain-small", "britain-all"):
                        case["zoomContinuity"] = {}
                        case["areaContinuity"] = {}
                        for projection in ("globe", "mercator"):
                            browser.js(
                                "document.querySelector('input[name=map-projection][value='+arguments[0]+']').click()",
                                projection,
                            )
                            case["areaContinuity"][projection] = check_area_continuity(
                                browser, args, projection
                            )
                            case["zoomContinuity"][projection] = check_zoom_continuity(
                                browser, args, projection
                            )
                        browser.js(
                            "document.querySelector('input[name=map-projection][value=globe]').click()"
                        )

                    if scenario["name"] in ("britain-small", "britain-all"):
                        # At the same detail level, only newly exposed computation
                        # tiles cross the overlap worker boundary. Returning inside
                        # retained coverage must not dispatch another request.
                        # Projection changes can expose additional tiles at the same
                        # camera. Finish that update before asserting cache reuse.
                        previous_view = browser.settled(args.timeout)
                        return_center = previous_view["camera"]["center"]
                        after = len(previous_view["reports"])
                        browser.js("window.overlapTest.camera([25,54.2], 4.4, 400)")
                        state = browser.terminal(after, args.timeout)
                        check_state(state)
                        pan_report = state["reports"][-1]
                        assert 0 < pan_report["deliveredTiles"] < pan_report["tileCount"], (
                            "Pan resent retained computation tiles"
                        )
                        assert state["coverageSourceTypes"] and all(
                            kind == "vector" for kind in state["coverageSourceTypes"]
                        ), "Coverage regressed to whole-collection GeoJSON delivery"
                        case["pan"] = {"snapshot": state}
                        count = len(state["reports"])
                        browser.js(
                            "window.overlapTest.camera(arguments[0], 4.4, 400)", return_center
                        )
                        wait_for(
                            lambda: not browser.snapshot()["moving"], args.timeout, "return pan"
                        )
                        # Give the 120 ms navigation debounce time to run.
                        time.sleep(0.3)
                        state = browser.snapshot()
                        assert len(state["reports"]) == count, (
                            "Return pan recomputed retained coverage"
                        )
                        check_state(state)
                        case["returnPan"] = {"snapshot": state}
                        # Retain coverage through an animated zoom-out, then clear
                        # selection and ensure late results cannot restore it.
                        after = len(browser.snapshot()["reports"])
                        browser.js("window.overlapTest.camera([12,18], 1.35, 600)")
                        state = browser.terminal(after, args.timeout)
                        outcome = check_state(state)
                        if outcome == "unsupported":
                            state = wait_for(
                                lambda: (
                                    s
                                    if (s := browser.snapshot())["fallbackFeatures"] > 0
                                    and s["tilesLoaded"]
                                    else None
                                ),
                                args.timeout,
                                "solid fallback outside retained stripes",
                            )
                            assert len(state["activeBuffers"]) == 1, (
                                "Failed zoom-out lost retained stripes"
                            )
                            check_state(state)
                        case["zoomOut"] = {"outcome": outcome, "snapshot": state}
                        browser.screenshot(
                            args.output / f"{scenario['name']}-{run + 1}-zoom-out.png"
                        )
                        browser.js(
                            "window.overlapTest.configure({languageIds:[],center:[12,18],zoom:1.35})"
                        )
                        wait_for(
                            lambda: (
                                browser.snapshot()["selectedCount"] == 0
                                and not browser.snapshot()["activeBuffers"]
                            ),
                            args.timeout,
                            "selection clearing",
                        )
                        case["cleared"] = browser.snapshot()
                        assert case["cleared"]["tileServices"]["receiver"]["snapshots"] == 0
                        if scenario["name"] == "britain-all":
                            # Supersede real cold dense work while it is running,
                            # then ensure late tiles cannot restore its memberships.
                            after = len(browser.snapshot()["reports"])
                            browser.js(
                                "window.overlapTest.configure({languageIds:'all',center:[12,18],zoom:1.35})"
                            )
                            wait_for(
                                lambda after=after: len(browser.snapshot()["reports"]) > after,
                                args.timeout,
                                "dense request dispatch",
                            )
                            after = len(browser.snapshot()["reports"])
                            browser.js(
                                "window.overlapTest.configure({languageIds:['stan1293','wels1247','scot1245','iris1253'],center:[-4.5,54.2],zoom:4.4})"
                            )
                            state = browser.terminal(after, args.timeout)
                            check_state(state, require_stripes=True)
                            assert state["selectedCount"] == 4
                            assert state["reports"][-1]["selectedCount"] == 4
                            assert not browser.js(
                                "return window.overlapTest.unexpectedMemberships()"
                            ), "Superseded selection memberships became visible"
                            case["superseded"] = {"snapshot": state}
                    case["passed"] = True
                except Exception as error:  # noqa: BLE001 -- persist any scenario failure before continuing
                    failed = True
                    case["passed"] = False
                    case["error"] = str(error)
                    try:
                        case["failureSnapshot"] = browser.snapshot()
                        browser.screenshot(
                            args.output / f"{scenario['name']}-{run + 1}-failure.png"
                        )
                    except Exception as capture_error:  # noqa: BLE001 -- preserve the original failure
                        case["captureError"] = str(capture_error)
                    print(f"FAIL {scenario['name']}: {error}", flush=True)
                finally:
                    save()
        try:
            result["failureRecovery"] = check_failure_recovery(browser, origin, args)
        except Exception as error:  # noqa: BLE001 -- persist failure diagnostics before browser cleanup
            failed = True
            result["failureRecoveryError"] = str(error)
            result["failureRecoverySnapshot"] = browser.snapshot()
            browser.screenshot(args.output / "failure-recovery-error.png")
            print(f"FAIL failure recovery: {error}", flush=True)
        # Test controls must not be exposed in ordinary production visits.
        browser.call("POST", "/url", {"url": origin})
        assert not browser.js("return !!window.overlapTest"), (
            "Test interface exposed without opt-in"
        )
        save()
    print(f"Report: {args.output / 'report.json'}", flush=True)
    raise SystemExit(1 if failed else 0)


if __name__ == "__main__":
    main()
