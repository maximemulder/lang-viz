#!/usr/bin/env python3
"""Verify published WALS assets and the actual lazy loader on the production base path."""

import argparse
import json
import os
import shutil
import subprocess
import threading
import urllib.error
import urllib.request
from collections import Counter
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from run import APP, browser_session, wait_for


@contextmanager
def controlled_server(upstream):
    control, hits = {"mode": "ready"}, Counter()

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def do_GET(self):
            path = self.path.split("?", 1)[0]
            hits[path] += 1
            if path.endswith("/wals/features.json") and control["mode"] != "ready":
                mode = control["mode"]
                body = (
                    b'{"schemaVersion":999}' if mode == "invalid" else b"<html>Missing JSON</html>"
                )
                self.send_response(404 if mode == "missing" else 200)
                self.send_header("Content-Type", "application/json")
            else:
                try:
                    with urllib.request.urlopen(upstream + self.path, timeout=30) as response:
                        body, content_type, status = (
                            response.read(),
                            response.headers.get("Content-Type", ""),
                            response.status,
                        )
                except urllib.error.HTTPError as error:
                    body, content_type, status = error.read(), "text/plain", error.code
                self.send_response(status)
                self.send_header("Content-Type", content_type)
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}", control, hits
    finally:
        server.shutdown()
        server.server_close()
        thread.join()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=APP / "test-results/wals-03/browser")
    parser.add_argument("--pin", type=Path, default=APP.parent / "wals-release.json")
    parser.add_argument("--data", type=Path, default=APP / "public/wals")
    args = parser.parse_args()
    os.environ["GITHUB_PAGES"] = "true"  # Preview must use the same base as this build.
    args.output.mkdir(parents=True, exist_ok=True)
    artifact = (args.output / "dist").resolve()
    subprocess.run(
        [
            "python3",
            "-m",
            "pipeline.wals.data_release",
            "verify",
            "--pin",
            str(args.pin.resolve()),
            "--output",
            str(args.data.resolve()),
        ],
        cwd=APP.parent,
        check=True,
    )
    subprocess.run(
        [
            "npx",
            "vite",
            "build",
            "--config",
            "tests/browser/wals-delivery.config.ts",
            "--outDir",
            str(artifact),
        ],
        cwd=APP,
        check=True,
    )
    shutil.copyfile(artifact / "wals-delivery.html", artifact / "index.html")
    shutil.copytree(args.data, artifact / "wals", dirs_exist_ok=True)
    report = {"passed": False, "base": "/lang-viz/", "checks": []}
    with (
        browser_session(args.output, out_dir=artifact) as (browser, upstream),
        controlled_server(upstream) as (origin, control, hits),
    ):
        url = origin + "/lang-viz/"

        def fresh():
            browser.call("POST", "/url", {"url": "about:blank"})
            browser.call("POST", "/url", {"url": url})
            wait_for(
                lambda: browser.js(
                    "return !!document.querySelector('#load:not(:disabled)') && document.querySelector('#status')?.textContent==='idle'"
                ),
                15,
                "WALS delivery fixture",
            )

        def load():
            browser.js("document.querySelector('#load').click()")

        def ready():
            text = wait_for(
                lambda: browser.js(
                    "const t=document.querySelector('#status').textContent;return t.startsWith('{')?t:null"
                ),
                20,
                "WALS repository",
            )
            assert json.loads(text) == {
                "status": "ready",
                "records": 2662,
                "features": 7,
                "snapshot": "wals-v2020.6",
            }

        try:
            fresh()
            assert hits["/lang-viz/wals/features.json"] == 0
            load()
            ready()
            assert hits["/lang-viz/wals/features.json"] == 1
            load()
            ready()
            assert hits["/lang-viz/wals/features.json"] == 1
            report["checks"].append(
                "production base path, lazy request, concurrent consumers and successful cache"
            )
            browser.js(
                "Promise.all(['manifest.json','NOTICE.md','LICENSE','ERRATA.md','sources.json'].map(p=>fetch('/lang-viz/wals/'+p).then(async r=>({status:r.status,body:await r.text()})))).then(v=>window.deliveryFiles=v)"
            )
            files = wait_for(
                lambda: browser.js("return window.deliveryFiles"),
                10,
                "WALS release notices/manifest",
            )
            assert all(f["status"] == 200 for f in files)
            assert json.loads(files[0]["body"])["counts"]["observations"] == 5517
            assert "Creative Commons" in files[2]["body"] and "Orok" in files[3]["body"]
            report["checks"].append(
                "release manifest, source pin, attribution, full license and errata served"
            )
            for mode, message in (
                ("missing", "HTTP 404"),
                ("json", "JSON"),
                ("invalid", "unsupported schema"),
            ):
                control["mode"] = mode
                fresh()
                load()
                error = wait_for(
                    lambda: browser.js(
                        "const t=document.querySelector('#status').textContent;return t.startsWith('error:')?t:null"
                    ),
                    20,
                    mode,
                )
                assert message.lower() in error.lower(), error
                control["mode"] = "ready"
                load()
                ready()
                report["checks"].append(f"{mode} failure stays local and retry succeeds")
            assert not any(
                path.startswith(("/wals/", "/assets/", "/data/", "/etymology/")) for path in hits
            ), dict(hits)
            assert not any(".tar.gz" in path or "/cldf/" in path for path in hits)
            browser.screenshot(args.output / "project-path.png")
            report["passed"] = True
        finally:
            report["browser"] = browser.capabilities
            report["requests"] = dict(hits)
            (args.output / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({"passed": True, "checks": report["checks"]}))


if __name__ == "__main__":
    main()
