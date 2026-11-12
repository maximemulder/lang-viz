#!/usr/bin/env python3
"""Exercise actual WALS cards with controlled fixtures, then the deployed-data app."""

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

from run import APP, browser_session, wait_for
from sidebar import add_selected, open_details, search


@contextmanager
def controlled_server(upstream):
    control = {"mode": "ready", "release": threading.Event()}
    hits = Counter()

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def do_GET(self):
            path = self.path.split("?", 1)[0]
            hits[path] += 1
            if path.endswith("/wals/features.json"):
                if control["mode"] == "delay":
                    control["release"].wait(40)
                if control["mode"] == "fail":
                    self.send_response(503)
                    self.send_header("Cache-Control", "no-store")
                    self.end_headers()
                    self.wfile.write(b"Injected WALS failure")
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
            with response:
                self.send_response(response.status)
                for key, value in response.headers.items():
                    if key.lower() in {
                        "content-type",
                        "content-length",
                        "content-range",
                        "accept-ranges",
                    }:
                        self.send_header(key, value)
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                self.wfile.write(response.read())

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


def click_text(browser, label):
    browser.js(
        """
        const button = [...document.querySelectorAll('button')].find(b => b.textContent === arguments[0]);
        if (!button) throw new Error('Missing button: '+arguments[0]);
        button.click();
    """,
        label,
    )


def select(browser, label, value):
    browser.js(
        """
        const select = document.querySelector('select[aria-label="'+arguments[0]+'"]');
        select.value = arguments[1]; select.dispatchEvent(new Event('change', {bubbles:true}));
    """,
        label,
        value,
    )


def record(browser, source_id):
    return wait_for(
        lambda: browser.js(
            """return !!document.querySelector(`.wals-record[data-source-id="${arguments[0]}"]`)""",
            source_id,
        ),
        15,
        f"recorded variety {source_id}",
    )


def cards(browser):
    return browser.js("""
        return [...document.querySelectorAll('.wals-card')].map(c => ({
          id:c.dataset.featureId, observed:c.dataset.observed, text:c.textContent,
          value:c.querySelector(':scope > strong').textContent
        }));
    """)


def key(browser, value):
    browser.call(
        "POST",
        "/actions",
        {
            "actions": [
                {
                    "type": "key",
                    "id": "wals-keyboard",
                    "actions": [
                        {"type": "keyDown", "value": value},
                        {"type": "keyUp", "value": value},
                    ],
                }
            ]
        },
    )
    browser.call("DELETE", "/actions")


def fixture_checks(output):
    artifact = (output / "fixture-dist").resolve()
    subprocess.run(
        [
            "npx",
            "vite",
            "build",
            "--config",
            "tests/browser/wals-profile.config.ts",
            "--outDir",
            str(artifact),
        ],
        cwd=APP,
        check=True,
    )
    shutil.copyfile(artifact / "wals-profile.html", artifact / "index.html")
    (artifact / "wals").mkdir(exist_ok=True)
    fixture = subprocess.check_output(
        [
            "node",
            "--input-type=module",
            "-e",
            "import {profileWalsData} from './tests/fixtures/wals-profile.ts'; console.log(JSON.stringify(profileWalsData()))",
        ],
        cwd=APP,
    )
    (artifact / "wals/features.json").write_bytes(fixture)
    report = {"checks": []}
    with (
        browser_session(output / "fixture", out_dir=artifact) as (browser, upstream),
        controlled_server(upstream) as (origin, control, hits),
    ):
        browser.call("POST", "/url", {"url": origin + "/lang-viz/"})
        wait_for(
            lambda: browser.js(
                "return document.querySelector('.wals-panel button')?.textContent === 'Load WALS features'"
            ),
            15,
            "idle profile",
        )
        assert hits["/lang-viz/wals/features.json"] == 0
        control["mode"] = "fail"
        click_text(browser, "Load WALS features")
        wait_for(
            lambda: browser.js("return !!document.querySelector('.wals-panel [role=alert]')"),
            15,
            "local WALS error",
        )
        assert (
            browser.js("return document.querySelector('#profile-id').textContent") == "atlas:irish"
        )
        control["mode"] = "delay"
        click_text(browser, "Retry WALS features")
        wait_for(lambda: hits["/lang-viz/wals/features.json"] == 2, 10, "delayed retry")
        assert (
            browser.js("return document.querySelector('.wals-panel').getAttribute('aria-busy')")
            == "true"
        )
        click_text(browser, "Close profile")
        click_text(browser, "broa1234")
        control["release"].set()
        record(browser, "broad")
        assert browser.js("return document.querySelector('#profile-id').textContent") == "broa1234"
        assert "Broader catalog association (family)" in browser.js(
            "return document.querySelector('.wals-record').textContent"
        )
        report["checks"].append(
            "lazy request, local error/retry, delayed completion after profile replacement, visible broader scope"
        )

        click_text(browser, "atlas:irish")
        select(browser, "Recorded WALS variety", "iri")
        record(browser, "iri")
        rendered = cards(browser)
        assert [c["id"] for c in rendered] == ["81A", "12A", "13A"], rendered
        assert rendered[1]["observed"] == "false" and "Not recorded" in rendered[1]["value"]
        assert "Sam eats rice" in rendered[0]["text"] and "not a translation" in rendered[0]["text"]
        select(browser, "Inspect a recorded WALS feature", "87A")
        wait_for(lambda: len(cards(browser)) == 4, 10, "revealed fourth card")
        assert cards(browser)[3]["id"] == "87A"
        assert browser.js("return !document.querySelector('img') && !window.walsUnsafe")
        browser.js(
            "document.querySelector('.wals-card[data-feature-id=\"87A\"] details').open=true"
        )
        assert "<img src=x" in browser.js(
            "return document.querySelector('.wals-card[data-feature-id=\"87A\"]').textContent"
        )
        assert browser.js(
            "return !!document.querySelector('.wals-card[data-observed=true] button') && !document.querySelector('.wals-card[data-observed=false] button')"
        )
        report["checks"].append(
            "rendered unknown comparison slot, English illustration, inspected fourth card, safe bibliography text, map action only for recorded observations"
        )

        select(browser, "Recorded WALS variety", "ird")
        record(browser, "ird")
        rendered = cards(browser)
        assert [c["id"] for c in rendered] == ["81A", "12A"]
        assert "observation reference is unavailable" in rendered[1]["text"]
        assert not browser.js("return !!document.querySelector('.wals-illustration')")
        click_text(browser, "Close profile")
        click_text(browser, "atlas:irish")
        record(browser, "ird")
        report["checks"].append(
            "recorded value without reference differs from missing value; variety survives closure/reopening"
        )

        click_text(browser, "empt1234")
        record(browser, "empty")
        assert len(cards(browser)) == 2 and all(c["observed"] == "false" for c in cards(browser))
        click_text(browser, "no-record")
        wait_for(
            lambda: browser.js(
                "return document.querySelector('.wals-panel').textContent.includes('No WALS source record')"
            ),
            10,
            "no associated record",
        )
        assert not cards(browser)
        click_text(browser, "Inspect unmatched")
        record(browser, "orphan")
        assert browser.js("return document.querySelector('#profile-id').textContent") == "no-record"
        assert "Unmatched (orphan)" in browser.js(
            "return document.querySelector('.wals-standalone').textContent"
        )
        click_text(browser, "Close source inspection")
        click_text(browser, "Catalog pending")
        click_text(browser, "Inspect Donegal")
        record(browser, "ird")
        click_text(browser, "Catalog ready")
        assert browser.js("return document.querySelector('#profile-id').textContent") == "no-record"
        assert browser.js(
            "return !!document.querySelector('.wals-standalone .wals-record[data-source-id=ird]')"
        )
        report["checks"].append(
            "unobserved and absent records, standalone unmatched evidence, late association preserves evidence without profile navigation"
        )

        click_text(browser, "Close source inspection")
        click_text(browser, "atlas:irish")
        browser.js("document.querySelector('select[aria-label=\"Recorded WALS variety\"]').focus()")
        key(browser, "\ue010")  # End selects the last variety using the native select.
        record(browser, "iri")
        browser.js("document.querySelector('.wals-card details summary').focus()")
        key(browser, "\ue007")  # Enter toggles a native disclosure.
        assert browser.js("return document.activeElement.parentElement.open")
        key(browser, "\ue004")  # Tab reaches its first citation link.
        assert browser.js("return document.activeElement.tagName") == "A"
        browser.call("POST", "/window/rect", {"width": 390, "height": 844})
        assert browser.js("return document.documentElement.scrollWidth <= innerWidth")
        assert browser.js("""
            return [...document.querySelectorAll('.wals-card, .wals-select select')].every(el => {
                const r=el.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth;
            });
        """)
        browser.screenshot(output / "fixture/narrow.png")
        assert hits["/lang-viz/wals/features.json"] == 2, hits
        report["checks"].append(
            "keyboard variety/disclosure/citation navigation, narrow card/select layout, successful request cache across profiles"
        )
        report["requests"] = dict(hits)
    return report


def production_checks(output):
    if not os.environ.get("WALS_SKIP_BUILD"):
        subprocess.run(["npm", "run", "build"], cwd=APP, check=True)
    report = {"checks": []}
    with (
        browser_session(output / "production") as (browser, upstream),
        controlled_server(upstream) as (origin, _control, hits),
    ):
        browser.call(
            "POST", "/url", {"url": origin + "/lang-viz/?overlap-test=1&overlap-basemap=off"}
        )
        wait_for(
            lambda: browser.js(
                "return !!window.overlapTest && !!document.querySelector('.language-tabs')"
            ),
            45,
            "production atlas",
        )
        search(browser, "iris1253", "iris1253")
        open_details(browser)
        assert hits["/lang-viz/wals/features.json"] == 0
        click_text(browser, "Load WALS features")
        wait_for(
            lambda: browser.js(
                "return !!document.querySelector('select[aria-label=\"Recorded WALS variety\"]')"
            ),
            20,
            "published WALS varieties",
        )
        select(browser, "Recorded WALS variety", "ird")
        record(browser, "ird")
        assert "Irish (Donegal)" in browser.js(
            "return document.querySelector('.wals-identity').textContent"
        )
        select(browser, "Inspect a recorded WALS feature", "12A")
        wait_for(
            lambda: browser.js(
                "return document.querySelector('.wals-card[data-feature-id=\"12A\"] .wals-context')?.textContent === 'Inspected observation'"
            ),
            10,
            "Donegal exact inspection",
        )
        browser.js("document.querySelector('.finder-detail__close').click()")
        search(browser, "iris1253", "iris1253")
        open_details(browser)
        record(browser, "ird")
        click_text(browser, "Word histories")
        wait_for(
            lambda: browser.js("return !!document.querySelector('.lexical-panel')"),
            15,
            "word workspace",
        )
        click_text(browser, "Geography")
        record(browser, "ird")
        assert (
            browser.js(
                "return document.querySelector('select[aria-label=\"Inspect a recorded WALS feature\"]').value"
            )
            == "12A"
        )
        assert hits["/lang-viz/wals/features.json"] == 1
        report["checks"].append(
            "published data on production base, exact Donegal inspection, closure/reopening and workspace round trip preserve choices"
        )

        search(browser, "alba1267", "alba1267")
        open_details(browser)
        record(browser, "alb")
        assert "Broader catalog association (family)" in browser.js(
            "return document.querySelector('.wals-record').textContent"
        )
        search(browser, "orok1265", "orok1265")
        open_details(browser)
        record(browser, "ork")
        select(browser, "Inspect a recorded WALS feature", "87A")
        wait_for(
            lambda: browser.js(
                "return document.querySelector('.wals-card[data-feature-id=\"87A\"] .wals-caveat')?.textContent.includes('Source erratum')"
            ),
            10,
            "Orok source caveat",
        )
        assert next(c for c in cards(browser) if c["id"] == "87A")["value"] == "Noun-Adjective"
        report["checks"].append(
            "real Albanian broader association and Orok 87A published value with explicit erratum"
        )

        # Existing profile and lexical controls remain present and usable.
        assert browser.js(
            "return !!document.querySelector('.finder-detail__path') && !!document.querySelector('.finder-detail__more') && !!document.querySelector('.finder-detail__reveal')"
        )
        browser.call("POST", "/window/rect", {"width": 390, "height": 844})
        browser.js("document.querySelector('.wals-card[data-feature-id=\"87A\"]').scrollIntoView()")
        assert browser.js("return document.documentElement.scrollWidth <= innerWidth")
        assert browser.js(
            "return document.querySelector('.finder-detail__body').scrollHeight > document.querySelector('.finder-detail__body').clientHeight"
        )
        browser.screenshot(output / "production/narrow-orok.png")
        assert not browser.js("return !!document.querySelector('.wals-panel button[aria-pressed]')")
        assert not browser.snapshot()["errors"]
        assert not any(path.startswith("/wals/") or path.endswith(".tar.gz") for path in hits)
        report["checks"].append(
            "scrollable narrow production profile retains existing controls; no raw archive fetch or map error"
        )

        search(browser, "stan1293", "stan1293")
        open_details(browser)
        record(browser, "eng")
        browser.js("document.querySelector('.language-row input').click()")
        add_selected(browser)
        wait_for(
            lambda: browser.js("return window.overlapTest.mapEntryState().length > 0"),
            20,
            "pinned English areas",
        )
        pinned = browser.js("return window.overlapTest.mapEntryState()")
        browser.js("window.overlapTest.camera([0,0],2)")
        wait_for(lambda: not browser.snapshot()["moving"], 10, "settled camera")
        camera = browser.snapshot()["camera"]
        select(browser, "Inspect a recorded WALS feature", "92A")
        wait_for(
            lambda: browser.js(
                "return document.querySelector('select[aria-label=\"Inspect a recorded WALS feature\"]').value === '92A'"
            ),
            10,
            "English observation",
        )
        assert browser.snapshot()["camera"] == camera
        assert browser.js("return window.overlapTest.mapEntryState()") == pinned
        click_text(browser, "Browse word entries")
        wait_for(
            lambda: browser.js(
                "return document.querySelector('.word-notice')?.textContent.includes('Browsing entries for English')"
            ),
            30,
            "profile word navigation",
        )
        click_text(browser, "Geography")
        record(browser, "eng")
        assert browser.js("return window.overlapTest.mapEntryState()") == pinned
        report["checks"].append(
            "existing Add to map and profile-to-word navigation work; WALS inspection preserves pinned areas and camera"
        )

        # Firefox clamps outer windows to 500px; frames verify exact CSS widths.
        report["mobileFrames"] = []
        for width in (320, 390):
            browser.js(
                """
                const frame=document.createElement('iframe'); frame.id='wals-mobile';frame.title='Mobile WALS profile';
                frame.style=`position:fixed;left:0;top:0;width:${arguments[0]}px;height:800px;border:0;z-index:10000`;
                frame.src=arguments[1];document.body.append(frame);
            """,
                width,
                origin + "/lang-viz/?overlap-test=1&overlap-basemap=off",
            )
            wait_for(
                lambda: browser.js(
                    "return !!document.querySelector('#wals-mobile').contentDocument?.querySelector('.language-tabs')"
                ),
                40,
                "mobile atlas",
            )
            frame = browser.call(
                "POST", "/element", {"using": "css selector", "value": "#wals-mobile"}
            )
            browser.call("POST", "/frame", {"id": frame})
            search(browser, "iris1253", "iris1253")
            open_details(browser)
            click_text(browser, "Load WALS features")
            wait_for(
                lambda: browser.js(
                    "return !!document.querySelector('select[aria-label=\"Recorded WALS variety\"]')"
                ),
                20,
                "mobile WALS",
            )
            select(browser, "Recorded WALS variety", "ird")
            record(browser, "ird")
            select(browser, "Inspect a recorded WALS feature", "12A")
            wait_for(
                lambda: any(c["id"] == "12A" for c in cards(browser)), 10, "mobile inspected card"
            )
            browser.js(
                "document.querySelector('.wals-card[data-feature-id=\"12A\"] details').open=true;document.querySelector('.wals-card[data-feature-id=\"12A\"]').scrollIntoView()"
            )
            layout = browser.js(
                "return {width:innerWidth,scrollWidth:document.documentElement.scrollWidth}"
            )
            assert layout["width"] == width and layout["scrollWidth"] <= width, layout
            assert browser.js("""return [...document.querySelectorAll('.wals-card, .wals-select select')].every(el => {
                const r=el.getBoundingClientRect();return r.left>=0 && r.right<=innerWidth;
            })""")
            assert any(c["id"] == "81A" and c["observed"] == "false" for c in cards(browser))
            report["mobileFrames"].append(layout)
            browser.call("POST", "/frame", {"id": None})
            browser.screenshot(output / f"production/mobile-{width}.png")
            browser.js("document.querySelector('#wals-mobile').remove()")
        assert hits["/lang-viz/wals/features.json"] == 3
        report["checks"].append(
            "exact 320px and 390px production frames reach cards and evidence without horizontal overflow"
        )
        report["requests"] = {path: count for path, count in hits.items() if "/wals/" in path}
    return report


def main():
    os.environ["GITHUB_PAGES"] = "true"
    output = APP / "test-results/wals-04"
    output.mkdir(parents=True, exist_ok=True)
    report = {"passed": False, "base": "/lang-viz/"}
    try:
        report["fixture"] = fixture_checks(output)
        report["production"] = production_checks(output)
        report["passed"] = True
    finally:
        (output / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
