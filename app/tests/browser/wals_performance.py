#!/usr/bin/env python3
"""Measure the production WALS loader and painted UI with actual gzip responses."""

import argparse
import gzip
import hashlib
import json
import os
import platform
import threading
import time
import urllib.error
import urllib.request
from collections import Counter
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from run import APP, browser_session, wait_for
from sidebar import open_details, search
from wals_map import open_profile, settled

BOOTSTRAP = b"""<script>
window.walsProbe={gaps:[],errors:[]};
addEventListener('error',e=>walsProbe.errors.push(e.message));
addEventListener('unhandledrejection',e=>walsProbe.errors.push(String(e.reason)));
let previous=performance.now();setInterval(()=>{const now=performance.now();
if(now-previous>50)walsProbe.gaps.push({start:previous,duration:now-previous});previous=now},10);
</script>"""


@contextmanager
def measured_server(upstream, slow):
    hits = Counter()
    raw = (APP / "dist/wals/features.json").read_bytes()
    compressed = gzip.compress(raw, mtime=0)

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def do_GET(self):
            path = self.path.split("?", 1)[0]
            hits[path] += 1
            wals = path.endswith("/wals/features.json")
            if wals:
                body, content_type, status = compressed, "application/json", 200
                headers = {}
                if slow:
                    time.sleep(0.15)
            else:
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
                with response:
                    body, content_type, status = (
                        response.read(),
                        response.headers.get("Content-Type", ""),
                        response.status,
                    )
                    headers = {
                        k: v
                        for k, v in response.headers.items()
                        if k.lower() in {"content-range", "accept-ranges"}
                    }
                if "text/html" in content_type:
                    body = body.replace(b"<head>", b"<head>" + BOOTSTRAP, 1)
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            for key, value in headers.items():
                self.send_header(key, value)
            if wals:
                self.send_header("Content-Encoding", "gzip")
            self.end_headers()
            try:
                for offset in range(0, len(body), 32768):
                    if wals and slow:
                        time.sleep(len(body[offset : offset + 32768]) / 1_250_000)
                    self.wfile.write(body[offset : offset + 32768])
                    self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError):
                pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield (
            f"http://127.0.0.1:{server.server_port}",
            hits,
            {
                "decodedBytes": len(raw),
                "gzipBytes": len(compressed),
                "sha256": hashlib.sha256(raw).hexdigest(),
            },
        )
    finally:
        server.shutdown()
        server.server_close()
        thread.join()


def painted_action(browser, action, target, expected):
    # The clock starts inside the same browser task as the input, avoiding WebDriver
    # polling/transport overhead. Two frames after the matching commit include paint.
    browser.js(
        """
      const [action,target,expected]=arguments;
      walsProbe.action=null;
      const start=performance.now(); let queued=false;
      const matches=()=>expected==='overlay'
        ? document.querySelector('.wals-map-summary')?.dataset.walsFeature===target &&
          [...document.querySelectorAll('.wals-map-marker')].some(e=>e.dataset.walsFeature===target)
        : !!document.querySelector('.wals-record[data-source-id="'+expected+'"] .wals-card');
      const observer=new MutationObserver(()=>{
        if(queued||!matches())return; queued=true;observer.disconnect();
        requestAnimationFrame(()=>requestAnimationFrame(()=>walsProbe.action={action,target,start,duration:performance.now()-start}));
      }); observer.observe(document.documentElement,{childList:true,subtree:true,attributes:true});
      if(action==='load') [...document.querySelectorAll('.wals-panel button')].find(e=>e.textContent==='Load WALS features').click();
      else if(action==='profile') document.querySelector('.language-row[data-language-id="'+target+'"] .language-row__identity').click();
      else if(action==='variety') {
        const e=document.querySelector('select[aria-label="Recorded WALS variety"]');e.value=target;e.dispatchEvent(new Event('change',{bubbles:true}));
      } else document.querySelector('.wals-card[data-feature-id="'+target+'"] button').click();
    """,
        action,
        target,
        expected,
    )
    return wait_for(lambda: browser.js("return walsProbe.action"), 30, f"painted {action} {target}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--runs", type=int, default=3)
    parser.add_argument("--output", type=Path, default=APP / "test-results/wals-07/performance")
    args = parser.parse_args()
    if args.runs < 1:
        parser.error("--runs must be positive")
    os.environ["GITHUB_PAGES"] = "true"
    args.output.mkdir(parents=True, exist_ok=True)
    report = {
        "passed": False,
        "platform": platform.platform(),
        "cpu": next(
            (
                line.split(":", 1)[1].strip()
                for line in Path("/proc/cpuinfo").read_text().splitlines()
                if line.startswith("model name")
            ),
            platform.processor(),
        ),
        "cpuThrottling": "none; native desktop CPU; software WebGL",
        "frameGapCaveat": "10ms timer gaps >50ms include map rendering, scheduling and GC; not Long Tasks API measurements",
        "samples": [],
    }
    try:
        for slow in (False, True):
            with browser_session(args.output / ("slow" if slow else "local")) as (
                browser,
                upstream,
            ):
                report["browser"] = browser.capabilities
                for run in range(args.runs):
                    # A fresh origin per run guarantees cold HTTP and module caches.
                    with measured_server(upstream, slow) as (origin, hits, payload):
                        browser.call(
                            "POST",
                            "/url",
                            {"url": origin + "/lang-viz/?overlap-test=1&overlap-basemap=off"},
                        )
                        wait_for(
                            lambda: browser.js(
                                "return !!window.overlapTest && !!document.querySelector('.language-tabs')"
                            ),
                            60,
                            "atlas",
                        )
                        settled(browser)
                        for atlas in ("iris1253", "stan1293"):
                            search(browser, atlas, atlas)
                            open_details(browser)
                        assert hits["/lang-viz/wals/features.json"] == 0
                        cold = painted_action(browser, "load", "eng", "eng")
                        phases = browser.js(
                            "return performance.getEntriesByType('measure').filter(e=>e.name.startsWith('wals:')).map(e=>e.toJSON())"
                        )
                        warm = []
                        open_profile(browser, "iris1253", "iri")
                        for source in ("ird", "iri", "ird", "iri"):
                            warm.append(painted_action(browser, "variety", source, source))
                        profiles = []
                        for atlas, source in (
                            ("stan1293", "eng"),
                            ("iris1253", "iri"),
                            ("stan1293", "eng"),
                        ):
                            search(browser, atlas, atlas)
                            profiles.append(painted_action(browser, "profile", atlas, source))
                        overlays = []
                        for feature in ("81A", "12A", "13A"):
                            # Reveal the inspected card before timing its map action.
                            browser.js(
                                "const e=document.querySelector('select[aria-label=\"Inspect a recorded WALS feature\"]');e.value=arguments[0];e.dispatchEvent(new Event('change',{bubbles:true}))",
                                feature,
                            )
                            wait_for(
                                lambda feature=feature: browser.js(
                                    "return !!document.querySelector('.wals-card[data-feature-id=\"'+arguments[0]+'\"] button')",
                                    feature,
                                ),
                                10,
                                "feature card",
                            )
                            overlays.append(painted_action(browser, "show", feature, "overlay"))
                            settled(browser)
                        sample = browser.js("""return {errors:walsProbe.errors,gaps:walsProbe.gaps,
                          resource:performance.getEntriesByType('resource').find(e=>e.name.endsWith('/wals/features.json'))?.toJSON(),
                          prepareCount:performance.getEntriesByName('wals:prepared').length,
                          hardwareConcurrency:navigator.hardwareConcurrency,
                          longTasksSupported:PerformanceObserver.supportedEntryTypes.includes('longtask')}""")
                        sample.update(
                            {
                                "run": run,
                                "network": "WALS-only 10Mbit/s +150ms TTFB"
                                if slow
                                else "loopback gzip, no throttle",
                                "payload": payload,
                                "coldCards": cold,
                                "phases": phases,
                                "varietySwitches": warm,
                                "profileSwitches": profiles,
                                "overlays": overlays,
                                "walsHttpRequests": hits["/lang-viz/wals/features.json"],
                            }
                        )
                        report["samples"].append(sample)
                        assert not sample["errors"], sample["errors"]
                        assert sample["walsHttpRequests"] == sample["prepareCount"] == 1
                        assert {p["name"] for p in phases} == {
                            "wals:receive",
                            "wals:parse",
                            "wals:validate",
                            "wals:index",
                        }
                        print(
                            json.dumps(
                                {
                                    "run": run,
                                    "network": sample["network"],
                                    "coldMs": cold["duration"],
                                    "switchMaxMs": max(s["duration"] for s in warm),
                                    "overlayMaxMs": max(s["duration"] for s in overlays),
                                }
                            ),
                            flush=True,
                        )
        report["passed"] = True
    finally:
        (args.output / "report.json").write_text(json.dumps(report, indent=2) + "\n")


if __name__ == "__main__":
    main()
