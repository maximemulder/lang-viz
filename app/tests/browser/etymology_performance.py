#!/usr/bin/env python3
"""Measure the production lexical workspace, including actual gzip transfer and UI latency."""

import argparse
import gzip
import json
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

BOOTSTRAP = b"""<script>
window.lexicalProbe={gaps:[],searches:[],longTasks:[],errors:[],usable:null};
addEventListener('error',e=>lexicalProbe.errors.push(e.message));
addEventListener('unhandledrejection',e=>lexicalProbe.errors.push(String(e.reason)));
let previous=performance.now();setInterval(()=>{const now=performance.now();
if(now-previous>50)lexicalProbe.gaps.push({start:previous,duration:now-previous});previous=now},10);
if(PerformanceObserver.supportedEntryTypes.includes('longtask'))
new PerformanceObserver(l=>lexicalProbe.longTasks.push(...l.getEntries().map(e=>e.toJSON()))).observe({type:'longtask',buffered:true});
let pending=null;
addEventListener('input',e=>{if(e.target.matches('.word-discovery input'))
pending={query:e.target.value,start:performance.now(),old:document.querySelector('.word-search-results')?.textContent}},true);
new MutationObserver(()=>{
if(!lexicalProbe.usable&&document.querySelector('.word-explorer-heading')&&document.querySelector('.word-graph svg'))
requestAnimationFrame(()=>requestAnimationFrame(()=>{lexicalProbe.usable??=performance.now()}));
const text=document.querySelector('.word-search-results')?.textContent;
if(pending&&text&&text!==pending.old){const p=pending;pending=null;
requestAnimationFrame(()=>requestAnimationFrame(()=>lexicalProbe.searches.push({query:p.query,duration:performance.now()-p.start})))}})
.observe(document.documentElement,{childList:true,subtree:true,characterData:true});
</script>"""


@contextmanager
def measured_server(upstream, slow):
    hits = Counter()
    compressed = gzip.compress((APP / "dist/etymology/word-trails.json").read_bytes(), mtime=0)

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def do_GET(self):
            path = self.path.split("?", 1)[0]
            hits[path] += 1
            lexical = path.endswith("/etymology/word-trails.json")
            if lexical:
                body, content_type = compressed, "application/json"
                if slow:
                    time.sleep(0.15)
            else:
                try:
                    with urllib.request.urlopen(upstream + self.path, timeout=30) as response:
                        body, content_type = (
                            response.read(),
                            response.headers.get("Content-Type", ""),
                        )
                except urllib.error.HTTPError as error:
                    self.send_error(error.code)
                    return
                if "text/html" in content_type:
                    body = body.replace(b"<head>", b"<head>" + BOOTSTRAP, 1)
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "public,max-age=3600" if lexical else "no-store")
            if lexical:
                self.send_header("Content-Encoding", "gzip")
            self.end_headers()
            try:
                for offset in range(0, len(body), 32768):
                    if lexical and slow:
                        time.sleep(32768 / 1_250_000)  # 10 Mbit/s, lexical response only.
                    self.wfile.write(body[offset : offset + 32768])
                    self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError):
                pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}", hits
    finally:
        server.shutdown()
        server.server_close()
        thread.join()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output", type=Path, default=APP / "test-results/etymology-05/performance"
    )
    parser.add_argument("--base", default="/")
    parser.add_argument("--runs", type=int, default=3)
    args = parser.parse_args()
    report = {
        "passed": False,
        "browser": None,
        "device": platform.platform(),
        "cpu": next(
            (
                line.split(":", 1)[1].strip()
                for line in Path("/proc/cpuinfo").read_text().splitlines()
                if line.startswith("model name")
            ),
            platform.processor(),
        )
        if Path("/proc/cpuinfo").exists()
        else platform.processor(),
        "cpuThrottling": "none; native desktop CPU",
        "longTaskFallback": "10ms timer gaps >50ms; includes scheduling/GC, not Long Tasks API",
        "samples": [],
    }
    args.output.mkdir(parents=True, exist_ok=True)
    try:
        for slow in (False, True):
            with browser_session(args.output / ("slow" if slow else "local")) as (
                browser,
                upstream,
            ):
                report["browser"] = browser.capabilities
                for run in range(args.runs):
                    # Each pair uses a new origin: cold fetch followed by cached reload.
                    with measured_server(upstream, slow) as (origin, hits):
                        url = origin + args.base + f"?sample={run}#workspace=etymology&word=69562"
                        for cache in ("cold", "http-cache"):
                            browser.call("POST", "/url", {"url": "about:blank"})
                            before = sum(
                                v
                                for k, v in hits.items()
                                if k.endswith("/etymology/word-trails.json")
                            )
                            browser.call("POST", "/url", {"url": url})
                            wait_for(
                                lambda: browser.js("return window.lexicalProbe?.usable"),
                                60,
                                "first usable lexical render",
                            )
                            for query in ("wine", "english", "a", "water", "wine"):
                                count = browser.js("return lexicalProbe.searches.length")
                                browser.js(
                                    "const e=document.querySelector('.word-discovery input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,arguments[0]);e.dispatchEvent(new Event('input',{bubbles:true}))",
                                    query,
                                )
                                wait_for(
                                    lambda count=count: (
                                        browser.js("return lexicalProbe.searches.length") > count
                                    ),
                                    20,
                                    f"search {query}",
                                )
                            sample = browser.js("""return {probe:lexicalProbe,marks:performance.getEntriesByType('mark').map(e=>e.toJSON()),
    measures:performance.getEntriesByType('measure').map(e=>e.toJSON()),
    resource:performance.getEntriesByType('resource').find(e=>e.name.endsWith('/etymology/word-trails.json'))?.toJSON(),
    longTasksSupported:PerformanceObserver.supportedEntryTypes.includes('longtask'),hardwareConcurrency:navigator.hardwareConcurrency}""")
                            sample.update(
                                {
                                    "cache": cache,
                                    "network": "lexical-only 10Mbit/s +150ms TTFB"
                                    if slow
                                    else "loopback gzip, no throttle",
                                    "lexicalHttpRequests": sum(
                                        v
                                        for k, v in hits.items()
                                        if k.endswith("/etymology/word-trails.json")
                                    )
                                    - before,
                                }
                            )
                            report["samples"].append(sample)
                            assert not sample["probe"]["errors"], sample["probe"]["errors"]
                            assert sample["lexicalHttpRequests"] == (1 if cache == "cold" else 0)
                            assert (
                                max(
                                    (
                                        gap["duration"]
                                        for gap in sample["probe"]["gaps"]
                                        if gap["start"] < sample["probe"]["usable"]
                                    ),
                                    default=0,
                                )
                                < 250
                            )
                            assert sample["probe"]["usable"] < (7000 if slow else 5000), sample
                            assert max(s["duration"] for s in sample["probe"]["searches"]) < 250, (
                                sample
                            )
                        # In-session visits reuse the already prepared repository without another
                        # fetch or worker; geography is independently loaded on this round trip.
                        before = sum(
                            v for k, v in hits.items() if k.endswith("/etymology/word-trails.json")
                        )
                        browser.js(
                            "[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='Geography').click()"
                        )
                        browser.js(
                            "[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='Word histories').click()"
                        )
                        wait_for(
                            lambda: browser.js(
                                "return !!document.querySelector('.word-explorer-heading')"
                            ),
                            10,
                            "cached workspace",
                        )
                        report.setdefault("inSession", []).append(
                            browser.js(
                                "return {marks:performance.getEntriesByName('lexical:prepared').length,ready:!!document.querySelector('.word-explorer-heading')}"
                            )
                        )
                        assert before == sum(
                            v for k, v in hits.items() if k.endswith("/etymology/word-trails.json")
                        )
                        assert report["inSession"][-1]["marks"] == 1
        report["passed"] = True
    finally:
        (args.output / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({"passed": report["passed"], "samples": len(report["samples"])}))


if __name__ == "__main__":
    main()
