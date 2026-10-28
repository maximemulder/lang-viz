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
from contextlib import ExitStack

APP = pathlib.Path(__file__).resolve().parents[2]
SCENARIOS = json.loads((pathlib.Path(__file__).parent / "scenarios.json").read_text())
SUPPORTED_LIMITS = {
    "input-vertices",
    "output-vertices",
    "intermediate-regions",
    "tile-deadline",
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

    def screenshot(self, path):
        path.write_bytes(base64.b64decode(self.call("GET", "/screenshot")))

    def close(self):
        self.call("DELETE", "")


def check_state(state, require_stripes=False):
    assert not state["errors"], f"Map errors: {state['errors']}"
    errors = [m for m in state["browserMessages"] if m["level"] in ("pageerror", "error")]
    assert not errors, f"Browser errors: {errors}"
    assert state["blankLayerFrames"] == 0, "A rendered frame disabled all language coverage layers"
    report = state["reports"][-1]
    if report["outcome"] == "error":
        assert not require_stripes, f"Required stripes unavailable: {report}"
        assert report["failure"] in SUPPORTED_LIMITS, f"Unexpected failure: {report}"
        return "unsupported"
    assert state["activeBuffers"] in ([0], [1]), "Expected exactly one active coverage buffer"
    if require_stripes:
        assert report["sharedPatterns"] > 0, "Expected actual shared-area stripes"
    return "stripes" if report.get("sharedPatterns", 0) else "solid-coverage"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
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
    if not args.skip_build:
        subprocess.run(["npm", "run", "build"], cwd=APP, check=True)

    archive = APP / "public/data/language-areas.pmtiles"
    result = {
        "schemaVersion": 1,
        "environment": {
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
    with ExitStack() as stack:
        preview_port, driver_port = free_port(), free_port()
        while driver_port == preview_port:
            driver_port = free_port()
        preview_log = stack.enter_context((args.output / "preview.log").open("w"))
        driver_log = stack.enter_context((args.output / "geckodriver.log").open("w"))
        preview = subprocess.Popen(
            [
                "npm",
                "run",
                "preview",
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
            "production preview",
        )
        wait_for(lambda: request(webdriver, "GET", "/status"), 20, "geckodriver")
        browser = Browser(webdriver, args)
        stack.callback(browser.close)
        result["environment"]["browser"] = browser.capabilities
        url = origin + "/?overlap-test=1" + ("" if args.terrain else "&overlap-basemap=off")
        for run in range(args.runs):
            for scenario in SCENARIOS:
                if args.scenario and scenario["name"] not in args.scenario:
                    continue
                case = {"name": scenario["name"], "run": run + 1, "scenario": scenario}
                result["cases"].append(case)
                try:
                    browser.call("POST", "/url", {"url": url})
                    wait_for(
                        lambda: browser.js("return !!window.overlapTest"),
                        args.timeout,
                        "test interface",
                    )
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

                    if scenario["name"] in ("britain-small", "britain-all"):
                        # At the same detail level, only newly exposed computation
                        # tiles cross the overlap worker boundary. Returning inside
                        # retained coverage must not dispatch another request.
                        after = len(browser.snapshot()["reports"])
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
                        browser.js("window.overlapTest.camera([-4.5,54.2], 4.4, 400)")
                        wait_for(
                            lambda: not browser.snapshot()["moving"], args.timeout, "return pan"
                        )
                        # Give the 120 ms navigation debounce time to run.
                        time.sleep(0.3)
                        state = browser.snapshot()
                        assert len(state["reports"]) == count, "Return pan recomputed retained coverage"
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
