#!/usr/bin/env python3
"""Exercise the shipped explorer with real lexical/atlas data and controlled HTTP failures."""

import argparse
import json
import threading
import urllib.error
import urllib.request
from collections import Counter
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from run import APP, SCENARIOS, browser_session, wait_for


@contextmanager
def controlled_server(upstream):
    """Proxy only for test-owned failures/delays; never modify installed data or app code."""
    control = {
        "lexical": "ready",
        "atlas": "ready",
        "release": threading.Event(),
        "bounds": "ready",
        "lexicalBody": None,
    }
    hits = Counter()

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def do_GET(self):
            path = self.path.split("?", 1)[0]
            hits[path] += 1
            lexical = path.endswith("/etymology/word-trails.json")
            mode = (
                control["lexical"]
                if lexical
                else control["bounds"]
                if path.endswith("/geometry-bounds.json")
                else control["atlas"]
                if "/data/" in path
                else "ready"
            )
            if mode == "delay":
                control["release"].wait(40)
            if mode == "fail":
                self.send_response(503)
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                self.wfile.write(b"Injected dataset failure")
                return
            if mode == "invalid":
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                self.wfile.write(b'{"schemaVersion":999}')
                return
            if lexical and control["lexicalBody"] is not None:
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                self.wfile.write(control["lexicalBody"])
                return
            request = urllib.request.Request(
                upstream + self.path,
                headers={
                    key: value
                    for key, value in self.headers.items()
                    if key.lower() in {"range", "accept", "if-range"}
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
                pass  # Navigation may intentionally abandon a pending request.

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


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=APP / "test-results/etymology-03/browser")
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    report = {
        "passed": False,
        "serving": "production",
        "data": "real pinned snapshots",
        "checks": [],
    }
    with (
        browser_session(args.output) as (browser, upstream),
        controlled_server(upstream) as (origin, faults, hits),
    ):
        report["browser"] = browser.capabilities
        url = origin + "/?overlap-test&overlap-basemap=off"
        lexical_path = "/etymology/word-trails.json"

        def open_page(fragment):
            browser.call("POST", "/url", {"url": "about:blank"})
            browser.call("POST", "/url", {"url": url + fragment})

        def text(selector):
            return browser.js(
                "return document.querySelector(arguments[0])?.textContent || ''", selector
            )

        def ready():
            wait_for(lambda: bool(text(".word-explorer-heading")), 40, "word explorer")

        def click(selector):
            browser.js(
                "const e=document.querySelector(arguments[0]);if(!e)throw Error(arguments[0]);e.dispatchEvent(new MouseEvent('click',{bubbles:true}))",
                selector,
            )

        def button(label, scope="document"):
            browser.js(
                "const e=[..."
                + scope
                + ".querySelectorAll('button')].find(e=>e.textContent.trim().startsWith(arguments[0]));if(!e)throw Error(arguments[0]);e.click()",
                label,
            )

        def select(selector, value):
            browser.js(
                "const e=document.querySelector(arguments[0]);e.value=arguments[1];e.dispatchEvent(new Event('change',{bubbles:true}))",
                selector,
                value,
            )

        def keys(selector, value):
            element = browser.call("POST", "/element", {"using": "css selector", "value": selector})
            browser.call(
                "POST",
                "/element/" + element["element-6066-11e4-a52e-4f735466cecf"] + "/value",
                {"text": value},
            )

        def key(value):
            browser.call(
                "POST",
                "/actions",
                {
                    "actions": [
                        {
                            "type": "key",
                            "id": "keyboard",
                            "actions": [
                                {"type": "keyDown", "value": value},
                                {"type": "keyUp", "value": value},
                            ],
                        }
                    ]
                },
            )

        def check(name):
            report["checks"].append(
                {
                    "name": name,
                    "url": browser.js("return location.href"),
                    "heading": text(".word-explorer-heading h2"),
                }
            )
            print("Passed:", name, flush=True)

        def snapshot():
            return browser.js("""return {
              details: document.querySelector('.word-details')?.textContent,
              inputs: [...document.querySelectorAll('.etymology-workspace input, .etymology-workspace select')].map(e=>[e.type,e.value,e.checked]),
              pressed: [...document.querySelectorAll('.etymology-workspace [aria-pressed=true]')].map(e=>e.getAttribute('aria-label')||e.textContent),
              note: document.querySelector('.word-visual-panel .word-note')?.textContent
            }""")

        try:
            # Atlas unavailable; a direct lexical link must neither load nor depend on it.
            faults["atlas"] = "fail"
            open_page("#word=69562&view=history")
            ready()
            assert "wine" in text(".word-explorer-heading h2")
            assert not any("/data/" in path for path in hits)
            check("lexical direct link works without atlas requests")
            browser.screenshot(args.output / "desktop.png")
            click(".word-edge-hit")
            assert "Relationship evidence" in text(".word-details")
            assert "Selected relationship" in text(".word-details")
            assert "Source record unavailable" not in text(".word-details")
            check("relationship selection and separate cited evidence")
            count = browser.js("return document.querySelectorAll('.word-node').length")
            click('.word-node[aria-label$=" · Latin"]')
            button("Expand connections")
            assert browser.js("return document.querySelectorAll('.word-node').length") > count
            select(".word-controls select", "6")
            click(".word-controls input[type=checkbox]")
            click(".word-controls label:last-of-type input")
            before = snapshot()
            button("Geography", "document.querySelector('nav[aria-label=Workspace]')")
            wait_for(
                lambda: "Unable to open atlas data" in text(".workspace-error"),
                30,
                "atlas failure boundary",
            )
            button("Word histories", "document.querySelector('nav[aria-label=Workspace]')")
            ready()
            assert snapshot() == before
            check("selected word, expansion and trail options survive workspace round trip")
            button("Geography", "document.querySelector('nav[aria-label=Workspace]')")
            faults["atlas"] = "ready"
            button("Retry atlas data")
            wait_for(
                lambda: browser.js("return !!window.overlapTest?.snapshot().mapLoaded"),
                45,
                "atlas retry",
            )
            browser.js("window.overlapTest.configure(arguments[0])", SCENARIOS[0])
            browser.settled(60, fail_on_error=True)
            map_entries = browser.js("return window.overlapTest.mapEntryState()")
            map_camera = browser.js("return window.overlapTest.snapshot().camera")
            assert map_entries
            browser.js("window.savedMapCanvas = document.querySelector('.maplibregl-canvas')")
            button("Word histories", "document.querySelector('nav[aria-label=Workspace]')")
            ready()
            assert snapshot() == before
            check("atlas retries independently and preserves lexical session")
            button("Family comparison")
            select(".word-concept-controls label:first-child select", "1")
            concepts = browser.js(
                "return [...document.querySelectorAll('.word-concept-controls label:last-child option')].map(e=>e.value).filter(Boolean)"
            )
            assert len(concepts) > 1
            select(".word-concept-controls label:last-child select", concepts[1])
            select(".word-visual-panel .word-controls select", "Indo-European")
            rows = browser.js("return document.querySelectorAll('.word-table tbody tr').length")
            click(".word-visual-panel .word-controls:nth-of-type(2) input")
            assert (
                browser.js("return document.querySelectorAll('.word-table tbody tr').length") > rows
            )
            assert "No concept entry recorded" in text(".word-table")
            before = snapshot()
            button("Geography", "document.querySelector('nav[aria-label=Workspace]')")
            assert browser.js(
                "return window.savedMapCanvas === document.querySelector('.maplibregl-canvas')"
            )
            assert browser.js(
                "return document.querySelector('.maplibregl-canvas').getBoundingClientRect().width > 0"
            )
            assert browser.js("return window.overlapTest.mapEntryState()") == map_entries
            assert browser.js("return window.overlapTest.snapshot().camera") == map_camera
            button("Word histories", "document.querySelector('nav[aria-label=Workspace]')")
            ready()
            assert snapshot() == before
            check(
                "comparison collection, concept, family and missing preferences survive; map retained"
            )
            browser.screenshot(args.output / "comparison.png")
            browser.call("POST", "/back", {})
            wait_for(
                lambda: browser.js("return !document.querySelector('.atlas-workspace')?.hidden"),
                10,
                "native Back",
            )
            browser.call("POST", "/forward", {})
            ready()
            assert snapshot() == before
            check("native Back and Forward preserve current comparison")
            # Slash, result navigation, Escape and Enter use native keyboard events.
            click(".word-explorer-heading button")
            key("/")
            assert browser.js(
                "return document.activeElement === document.querySelector('.word-discovery input')"
            )
            keys(".word-discovery input", "VĪNUM")
            wait_for(lambda: bool(text(".word-search-results")), 10, "accent-normalized results")
            key("\ue015")
            assert browser.js("return !!document.activeElement.closest('.word-search-results')")
            key("\ue00c")
            assert browser.js(
                "return document.activeElement === document.querySelector('.word-discovery input')"
            )
            keys(".word-discovery input", "VĪNUM")
            key("\ue007")
            wait_for(
                lambda: "word=69421" in browser.js("return location.hash"), 10, "keyboard trace"
            )
            node = ".word-node"
            browser.js("document.querySelector(arguments[0]).focus()", node)
            key("\ue007")
            assert "Selected word" in text(".word-details")
            browser.js("document.querySelector('.word-edge-hit').focus()")
            key(" ")
            assert "Selected relationship" in text(".word-details")
            check("keyboard search, results, trace, nodes and relationship evidence")
            # Keep selected relationship through another workspace switch.
            before = snapshot()
            button("Geography", "document.querySelector('nav[aria-label=Workspace]')")
            button("Word histories", "document.querySelector('nav[aria-label=Workspace]')")
            ready()
            assert snapshot() == before
            assert hits[lexical_path] == 1
            check("selected edge persists and repeated visits reuse one lexical request")
            browser.call("POST", "/window/rect", {"width": 390, "height": 844})
            wait_for(lambda: browser.js("return innerWidth <= 520"), 10, "narrow viewport")
            assert browser.js("return document.documentElement.scrollWidth <= innerWidth")
            assert browser.js(
                "const e=document.querySelector('.etymology-workspace');return e.scrollHeight > e.clientHeight || document.documentElement.scrollHeight > innerHeight"
            )
            browser.js("document.querySelector('.word-details').scrollIntoView()")
            browser.screenshot(args.output / "narrow-evidence.png")
            report["narrowViewport"] = browser.js("return {width:innerWidth,height:innerHeight}")
            check("narrow layout scrolls to evidence without page overflow")
            browser.call("POST", "/window/rect", {"width": 1440, "height": 1000})
            browser.js(
                "location.hash='#word=999999999&view=family&concept=999999999&collection=999999999'"
            )
            wait_for(lambda: "Unknown word" in text(".word-notice"), 10, "unknown IDs")
            assert "Unknown concept" in text(".word-notice")
            assert not browser.js("return !!document.querySelector('.word-table tbody button')")
            check("unknown URL IDs remain explicit and never fall back to wine")
            browser.js("location.hash='#word=1&word=2&view=family'")
            wait_for(
                lambda: "Repeated URL parameter: word" in text(".word-notice"), 10, "malformed URL"
            )
            check("malformed URL reports a diagnostic")
            # Start fresh, delay lexical delivery, navigate while it is pending.
            faults["lexical"] = "delay"
            faults["release"].clear()
            open_page("#word=69562")
            wait_for(lambda: hits[lexical_path] >= 2, 20, "delayed lexical request")
            wait_for(
                lambda: "Loading word histories" in text(".word-loading"),
                10,
                "lexical loading state",
            )
            browser.js(
                "location.hash='#workspace=geography&word=38213&view=family&concept=1094&collection=1'"
            )
            wait_for(
                lambda: not browser.js("return !!document.querySelector('.lexical-panel')"),
                10,
                "workspace switch during loading",
            )
            faults["release"].set()
            wait_for(
                lambda: browser.js("return !!window.overlapTest?.snapshot().mapLoaded"),
                45,
                "Geography after delayed load",
            )
            assert not browser.js("return !!document.querySelector('.lexical-panel')")
            button("Word histories", "document.querySelector('nav[aria-label=Workspace]')")
            ready()
            assert "word=38213" in browser.js("return location.hash")
            assert "concept=1094" in browser.js("return location.hash")
            assert "water (n)" in text(".word-explorer-heading h2")
            check("loading retains newer word and comparison navigation")
            button("Geography", "document.querySelector('nav[aria-label=Workspace]')")
            browser.call("POST", "/refresh", {})
            wait_for(
                lambda: browser.js("return !!window.overlapTest?.snapshot().mapLoaded"),
                45,
                "Geography refresh",
            )
            assert not browser.js("return !!document.querySelector('.lexical-panel')")
            assert "word=38213" in browser.js("return location.hash")
            button("Word histories", "document.querySelector('nav[aria-label=Workspace]')")
            ready()
            assert "water (n)" in text(".word-explorer-heading h2")
            check("real app refresh retains Geography and explicit comparison")
            # Lexical errors must leave the geographic workspace usable; retry checks both HTTP and schema errors.
            for failure in ("fail", "invalid"):
                faults["lexical"] = failure
                requests = hits[lexical_path]
                open_page("#workspace=geography")
                wait_for(
                    lambda: browser.js("return !!window.overlapTest?.snapshot().mapLoaded"),
                    45,
                    "geographic workspace",
                )
                assert hits[lexical_path] == requests
                button("Word histories", "document.querySelector('nav[aria-label=Workspace]')")
                wait_for(
                    lambda: "Word histories unavailable" in text(".word-loading"),
                    20,
                    "lexical error",
                )
                assert hits[lexical_path] == requests + 1
                error = text(".word-loading")
                assert "HTTP 503" in error if failure == "fail" else "unsupported schema" in error
                button("Geography", "document.querySelector('nav[aria-label=Workspace]')")
                assert browser.js("return window.overlapTest.snapshot().mapLoaded")
                button("Word histories", "document.querySelector('nav[aria-label=Workspace]')")
                wait_for(
                    lambda: "Word histories unavailable" in text(".word-loading"),
                    20,
                    "retryable error",
                )
                faults["lexical"] = "ready"
                button("Retry word histories")
                ready()
                messages = browser.js("return window.overlapTest.snapshot().browserMessages")
                assert not [message for message in messages if message["level"] == "pageerror"], (
                    messages
                )
                check(f"geography independent of lexical {failure}; lexical retry succeeds")
            # Firefox headless clamps outer windows to 500px. Same-origin frames
            # exercise the real shipped app at exact 320/390 CSS pixel widths.
            report["mobileFrames"] = []
            for width in (320, 390):
                browser.js(
                    """const frame=document.createElement('iframe');frame.id='mobile-probe';frame.title='Mobile explorer';
                    frame.style=`position:fixed;left:0;top:0;width:${arguments[0]}px;height:800px;border:0;z-index:1000`;
                    frame.src=arguments[1]+'#word=69562';document.body.append(frame)""",
                    width,
                    url,
                )
                wait_for(
                    lambda: browser.js(
                        "return !!document.querySelector('#mobile-probe').contentDocument?.querySelector('.word-details h2')"
                    ),
                    40,
                    "mobile explorer",
                )
                frame = browser.call(
                    "POST", "/element", {"using": "css selector", "value": "#mobile-probe"}
                )
                browser.call("POST", "/frame", {"id": frame})
                layout = browser.js(
                    "return {width:innerWidth,scrollWidth:document.documentElement.scrollWidth,height:innerHeight}"
                )
                assert layout["width"] == width
                assert layout["scrollWidth"] <= width, layout
                browser.js("document.querySelector('.word-details').scrollIntoView()")
                assert browser.js(
                    "const r=document.querySelector('.word-details h2').getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight"
                )
                report["mobileFrames"].append(layout)
                browser.call("POST", "/frame", {"id": None})
                browser.screenshot(args.output / f"mobile-{width}.png")
                browser.js("document.querySelector('#mobile-probe').remove()")
            check("320px and 390px layouts reach evidence without horizontal overflow")
            report["passed"] = True
        except Exception as error:
            report["error"] = str(error)
            report["failureViewport"] = browser.js(
                "return {width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth}"
            )
            browser.screenshot(args.output / "failure.png")
            (args.output / "failure-dom.txt").write_text(
                browser.js("return document.body.innerText")
            )
            raise
        finally:
            report["requests"] = dict(hits)
            (args.output / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    print(
        f"Passed {len(report['checks'])} explorer checkpoints. Report: {args.output / 'report.json'}"
    )


if __name__ == "__main__":
    main()
