#!/usr/bin/env python3
"""Verify lexical data and its worker on a production project-site base path."""

import argparse
import json
from pathlib import Path

from etymology import controlled_server
from run import APP, browser_session, wait_for


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out-dir", type=Path, default=APP / "dist")
    parser.add_argument("--base", default="/lang-viz/")
    parser.add_argument("--output", type=Path, default=APP / "test-results/etymology-05/delivery")
    args = parser.parse_args()
    report = {"passed": False, "base": args.base, "checks": []}
    args.output.mkdir(parents=True, exist_ok=True)
    with (
        browser_session(args.output, out_dir=args.out_dir) as (browser, upstream),
        controlled_server(upstream) as (origin, faults, hits),
    ):
        url = origin + args.base + "#workspace=etymology&word=69562"

        def ready():
            wait_for(
                lambda: browser.js("return !!document.querySelector('.word-graph svg')"),
                40,
                "lexical graph",
            )

        try:
            browser.call("POST", "/url", {"url": url})
            ready()
            assert hits[args.base + "etymology/word-trails.json"] == 1
            assert any(path.startswith(args.base + "assets/etymology.worker-") for path in hits)
            assert not any("/data/" in path for path in hits), dict(hits)
            report["checks"].append(
                "project-path lexical payload and preparation worker; geography remains lazy"
            )
            browser.js(
                "[...document.querySelectorAll('button')].find(e=>e.textContent==='About the data').click()"
            )
            notice = browser.js(
                "return document.querySelector('.word-about a').getAttribute('href')"
            )
            assert notice == args.base + "licenses/DIACL-LEXICAL-NOTICE.md", notice
            browser.js(
                "Promise.all(arguments[0].map(p=>fetch(p).then(async r=>({status:r.status,body:await r.text()})))).then(v=>window.deliveryFiles=v)",
                [notice, args.base + "etymology/manifest.json"],
            )
            files = wait_for(
                lambda: browser.js("return window.deliveryFiles"), 10, "notice and manifest"
            )
            assert all(f["status"] == 200 for f in files)
            assert "ShareAlike 4.0" in files[0]["body"]
            assert json.loads(files[1]["body"])["counts"]["words"] == 74635
            report["checks"].append(
                "source/license notice and checksum/provenance manifest are served at project paths"
            )
            faults["lexical"] = "invalid"
            browser.call("POST", "/url", {"url": "about:blank"})
            browser.call("POST", "/url", {"url": url})
            wait_for(
                lambda: browser.js(
                    "return document.querySelector('.word-loading h2')?.textContent==='Word histories unavailable'"
                ),
                30,
                "worker validation failure",
            )
            assert "unsupported schema" in browser.js(
                "return document.querySelector('.word-loading').textContent"
            )
            faults["lexical"] = "ready"
            browser.js("document.querySelector('.word-loading button').click()")
            ready()
            report["checks"].append(
                "worker rejects incompatible data and retry succeeds on project path"
            )
            assert not any(path.startswith(("/assets/", "/etymology/", "/data/")) for path in hits)
            browser.screenshot(args.output / "project-path.png")
            report["passed"] = True
        finally:
            report["browser"] = browser.capabilities
            report["requests"] = dict(hits)
            (args.output / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({"passed": True, "checks": report["checks"]}))


if __name__ == "__main__":
    main()
