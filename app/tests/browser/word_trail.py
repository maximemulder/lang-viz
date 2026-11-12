#!/usr/bin/env python3
"""Production word-trail/map integration with real catalogs and explicit coordinate fixtures."""

import argparse
import json
import os
import time
from itertools import pairwise
from pathlib import Path

from etymology import controlled_server
from inspection import move, render_frames
from run import APP, SCENARIOS, browser_session, wait_for
from sidebar import search, select_control


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=APP / "test-results/etymology-04/browser")
    parser.add_argument("--base", default="/", help="Production asset base, e.g. /lang-viz/")
    args = parser.parse_args()
    if args.base.strip("/") == "lang-viz":
        os.environ["GITHUB_PAGES"] = "true"
    args.output.mkdir(parents=True, exist_ok=True)
    report = {
        "passed": False,
        "data": "real lexical/atlas snapshots, plus labeled coordinate fixtures",
        "checks": [],
    }
    with (
        browser_session(args.output) as (browser, upstream),
        controlled_server(upstream) as (origin, control, hits),
    ):
        report["browser"] = browser.capabilities
        base = "/" + args.base.strip("/") + "/" if args.base.strip("/") else "/"
        url = origin + base + "?overlap-test&overlap-basemap=off"

        def text(selector):
            return browser.js(
                "return document.querySelector(arguments[0])?.textContent||''", selector
            )

        def button(label, scope="document"):
            browser.js(
                "const e=[..."
                + scope
                + ".querySelectorAll('button')].find(e=>e.textContent.trim()===arguments[0]);if(!e)throw Error(arguments[0]);e.click()",
                label,
            )

        def workspace(label):
            button(label, "document.querySelector('nav[aria-label=Workspace]')")

        def ready():
            wait_for(lambda: bool(text(".word-explorer-heading")), 40, "lexical workspace")

        def map_ready():
            wait_for(
                lambda: browser.js("return !!window.overlapTest?.snapshot().mapLoaded"),
                60,
                "map readiness",
            )
            render_frames(browser)
            previous = None
            stable_since = None

            def stationary():
                nonlocal previous, stable_since
                state = browser.snapshot()
                if state["moving"] or not state["tilesLoaded"]:
                    stable_since = None
                    return False
                if state["camera"] != previous or stable_since is None:
                    previous = state["camera"]
                    stable_since = time.monotonic()
                return time.monotonic() - stable_since >= 0.3

            wait_for(stationary, 45, "deferred focus and stationary map")
            if browser.snapshot()["selectedCount"]:
                browser.settled(60, fail_on_error=True)
            else:
                wait_for(
                    lambda: browser.js(
                        "const s=window.overlapTest.snapshot();return s.tilesLoaded && !s.moving"
                    ),
                    30,
                    "empty-map tiles/camera",
                )

        def check(name):
            state = browser.snapshot()
            assert not state["errors"], state["errors"]
            errors = [
                message
                for message in state["browserMessages"]
                if message["level"] in ("pageerror", "error")
            ]
            assert not errors, errors
            report["checks"].append({"name": name, "url": browser.js("return location.href")})
            print("Passed:", name, flush=True)

        def open_page(fragment):
            browser.call("POST", "/url", {"url": "about:blank"})
            browser.call("POST", "/url", {"url": url + fragment})

        def graph_ids():
            return browser.js(
                "return [...document.querySelectorAll('.word-node')].map(e=>e.getAttribute('aria-label')).sort()"
            )

        def select_result_details(query, identity):
            search(browser, query, identity)
            browser.js(
                "document.querySelector('.language-row[data-language-id='+CSS.escape(arguments[0])+'] .language-row__identity').click()",
                identity,
            )
            wait_for(lambda: bool(text(".finder-detail")), 10, "language profile")

        try:
            open_page("#workspace=geography")
            map_ready()
            assert hits[base + "etymology/word-trails.json"] == 0
            assert browser.js(r"""
                const sidebar = document.querySelector('.geography-sidebar');
                const finder = sidebar.querySelector('.language-finder');
                const style = getComputedStyle(sidebar);
                return style.display === 'flex' && style.flexDirection === 'column' &&
                    style.overflow === 'hidden' && getComputedStyle(finder).flexGrow === '1' &&
                    !document.querySelector('.word-map-summary') &&
                    !performance.getEntriesByType('resource').some(entry =>
                        /\/assets\/(?:EtymologyExplorer|WordTrailLayer|WordTrailMapSummary)-/.test(entry.name));
            """), "Geography owns its sidebar layout before lexical code or overlay styles load"
            check("geography layout is ready before lexical feature or trail overlay loads")
            browser.js("window.overlapTest.configure(arguments[0])", SCENARIOS[0])
            browser.settled(60, fail_on_error=True)
            initial_entries = browser.js("return window.overlapTest.mapEntryState()")
            workspace("Word histories")
            ready()
            button("wine ↗")
            select_control(browser, ".word-controls select", "6")
            browser.js("document.querySelector('.word-controls label:last-of-type input').click()")
            ids = graph_ids()
            count = len(ids)
            button("Show current word trail")
            map_ready()
            wait_for(lambda: bool(text(".word-map-summary")), 10, "trail summary")
            state = browser.snapshot()
            assert state["camera"]["zoom"] <= 3.21, "Explicit show must actually focus the map"
            assert state["wordTrail"]["layers"] == ["word-trail-casing", "word-trail-lines"]
            assert len(state["wordTrail"]["links"]["features"]) > 0
            assert f"{count} forms" in text(".word-map-summary h2")
            assert browser.js("return window.overlapTest.mapEntryState()") == initial_entries
            check(
                "explicit current trail renders independent links/points without changing pinned comparisons"
            )
            browser.screenshot(args.output / "trail.png")
            # No camera replay or geometry work when returning through workspace navigation.
            settled = browser.snapshot()
            workspace("Word histories")
            ready()
            assert graph_ids() == ids
            workspace("Geography")
            map_ready()
            after = browser.snapshot()
            assert after["camera"] == settled["camera"]
            assert after["coverageUrls"] == settled["coverageUrls"]
            assert len(after["reports"]) == len(settled["reports"])
            check(
                "workspace round trip preserves canonical trail, camera and geometry/cache identity"
            )
            # Markers inspect one form in the same trail, rather than replacing its root.
            browser.js("document.querySelector('.word-map-marker').click()")
            ready()
            assert "word=69562" in browser.js("return location.hash")
            assert graph_ids() == ids
            assert "Selected word" in text(".word-details")
            workspace("Geography")
            map_ready()
            browser.js("document.querySelector('.word-map-summary details').open=true")
            assert (
                browser.js("return document.querySelectorAll('.word-location-list button').length")
                == count
            )
            browser.js(
                "document.querySelector('.word-location-list button[data-word-id=\"69563\"]').click()"
            )
            ready()
            assert "Middle English" in text(".word-details")
            assert "word=69562" in browser.js("return location.hash")
            check(
                "overlapping historical stages inspect evidence without resetting root or trail options"
            )
            workspace("Geography")
            map_ready()
            before = browser.js("return window.overlapTest.mapEntryState()")
            browser.js("""[...document.querySelectorAll('.word-map-summary button')].find(e=>e.textContent==='Add matched language areas').click();
                [...document.querySelectorAll('nav[aria-label=Workspace] button')].find(e=>e.textContent==='Word histories').click()""")
            ready()
            assert browser.js("return window.overlapTest.mapEntryState()") == before
            workspace("Geography")
            map_ready()
            check("navigation cancels an in-flight area addition without changing comparisons")
            button("Add matched language areas")
            wait_for(
                lambda: "map entries added" in text(".word-map-summary [role=status]"),
                15,
                "area result",
            )
            after_entries = browser.js("return window.overlapTest.mapEntryState()")
            assert after_entries[: len(before)] == before
            assert text(".word-map-summary [role=status]").startswith(
                f"{len(after_entries) - len(before)} map entries added"
            )
            assert "already present" in text(".word-map-summary [role=status]")
            browser.settled(60, fail_on_error=True)
            before_repeat = browser.snapshot()
            button("Add matched language areas")
            wait_for(
                lambda: text(".word-map-summary [role=status]").startswith("0 map entries added"),
                10,
                "repeat addition",
            )
            assert browser.js("return window.overlapTest.mapEntryState()") == after_entries
            assert len(browser.snapshot()["reports"]) == len(before_repeat["reports"])
            check(
                "normal area pinning preserves existing entries, reports actual additions and deduplicates repeats"
            )
            # Unsupported source/period must not remove pinned comparisons or invent matches.
            browser.js("document.querySelector('.finder-options').open=true")
            select_control(browser, ".finder-filters__period select", "year-1750")
            button("Add matched language areas")
            wait_for(
                lambda: "currently unavailable" in text(".word-map-summary [role=status]"),
                10,
                "filtered additions",
            )
            assert text(".word-map-summary [role=status]").startswith("0 map entries added")
            assert browser.js("return window.overlapTest.mapEntryState()") == after_entries
            check(
                "current source/period availability is respected while earlier comparisons stay pinned"
            )
            select_control(browser, ".finder-filters__period select", "contemporary")
            browser.settled(60, fail_on_error=True)
            before_clear = browser.snapshot()
            button("Clear word overlay")
            wait_for(
                lambda: not browser.js("return !!document.querySelector('.word-map-summary')"),
                10,
                "cleared overlay",
            )
            after_clear = browser.snapshot()
            assert after_clear["wordTrail"]["links"] is None
            assert after_clear["wordTrail"]["layers"] == []
            assert after_clear["camera"] == before_clear["camera"]
            assert after_clear["coverageUrls"] == before_clear["coverageUrls"]
            assert len(after_clear["reports"]) == len(before_clear["reports"])
            assert browser.js("return window.overlapTest.mapEntryState()") == after_entries
            check(
                "clearing only removes lexical layers; polygon selection and geometry identity stay intact"
            )
            # Reverse navigation from actual atlas profiles (including ambiguous/source/aggregate entries).
            for query, identity, expected in [
                ("stan1293", "stan1293", "Browsing entries for English"),
                ("anci1242", "anci1242", "Several lexical records match"),
                ("indo1319", "indo1319", "Browsing entries for Indo-European"),
                ("danzhou", "dlac1987china:danzhou", "No exact lexical match"),
            ]:
                select_result_details(query, identity)
                button("Browse word entries", "document.querySelector('.finder-detail')")
                ready()
                assert expected in text(".word-notice"), text(".word-notice")
                assert "word=69562" in browser.js("return location.hash")
                assert graph_ids() == ids
                workspace("Geography")
                map_ready()
                check(
                    f"represented atlas entry {identity} opens lexical scope or explicit search fallback"
                )
            browser.js("window.overlapTest.configure(arguments[0])", SCENARIOS[0])
            browser.settled(60, fail_on_error=True)
            move(browser, [-0.1, 51.5], click=True)
            wait_for(
                lambda: bool(text(".language-inspector--pinned")), 10, "pinned polygon inspector"
            )
            browser.js(
                "document.querySelector('.language-inspector--pinned [aria-label=\"Browse word entries for English\"]').click()"
            )
            ready()
            assert "Browsing entries for English" in text(".word-notice")
            assert "word=69562" in browser.js("return location.hash")
            check("pinned polygon inspector adds lexical navigation alongside existing details")
            # A pending older profile camera must not override a newer show-trail request.
            control["bounds"] = "delay"
            control["release"].clear()
            open_page("#workspace=geography&word=69562")
            map_ready()
            requests = hits[base + "data/geometry-bounds.json"]
            select_result_details("stan1293", "stan1293")
            wait_for(
                lambda: hits[base + "data/geometry-bounds.json"] > requests,
                10,
                "delayed profile bounds",
            )
            workspace("Word histories")
            ready()
            button("Show current word trail")
            map_ready()
            camera = browser.snapshot()["camera"]
            control["release"].set()
            wait_for(
                lambda: browser.js(
                    "return performance.getEntriesByType('resource').some(e=>e.name.endsWith('/geometry-bounds.json'))"
                ),
                15,
                "released bounds",
            )
            assert browser.snapshot()["camera"] == camera
            check("late profile bounds cannot override a newer explicit trail focus")
            # Change the traced word while overlay remains enabled; ordinary workspace return does not fit.
            workspace("Word histories")
            ready()
            button("water ↗")
            water_count = len(graph_ids())
            workspace("Geography")
            map_ready()
            assert "water" in text(".word-map-summary h2")
            assert f"{water_count} forms" in text(".word-map-summary h2")
            assert browser.snapshot()["camera"] == camera
            button("Focus current trail")
            map_ready()
            assert browser.snapshot()["camera"] != camera
            check("overlay follows newer root; camera changes only on an explicit focus")
            # Coordinate edge cases use an explicitly modified snapshot, never alter installed files.
            fixture = json.loads((APP / "public/etymology/word-trails.json").read_text())
            fixture["provenance"]["snapshot"] = None
            fixture["languages"]["41500"].update(lat=0, lon=170)
            fixture["languages"]["42000"].update(lat=0, lon=-170)
            fixture["languages"]["42400"].update(lat=None, lon=None)
            control["lexicalBody"] = json.dumps(fixture).encode()
            control["bounds"] = "ready"
            open_page("#word=69562")
            ready()
            fixture_count = len(graph_ids())
            button("Show current word trail")
            map_ready()
            browser.js("document.querySelector('.word-map-summary details').open=true")
            assert "No focal point" in text(".word-location-list")
            assert (
                browser.js("return document.querySelectorAll('.word-location-list button').length")
                == fixture_count
            )
            links = browser.snapshot()["wordTrail"]["links"]["features"]
            assert any(len(feature["geometry"]["coordinates"]) == 2 for feature in links)
            assert all(
                abs(b[0] - a[0]) <= 180
                for feature in links
                for segment in feature["geometry"]["coordinates"]
                for a, b in pairwise(segment)
            )
            check(
                "coordinate fixture: missing points retain all forms; antimeridian links split into bounded segments"
            )
            # Both projections restore lexical sources after replacing a style, without selection loss.
            for projection in ("mercator", "globe"):
                browser.js(
                    "document.querySelector('input[name=map-projection][value='+arguments[0]+']').click()",
                    projection,
                )
                map_ready()
                before_style = browser.snapshot()["camera"]
                browser.js("window.overlapTest.reloadStyle()")
                map_ready()
                assert browser.snapshot()["camera"] == before_style
                assert len(browser.snapshot()["wordTrail"]["layers"]) == 2
                assert browser.js("return document.querySelectorAll('.word-map-marker').length") > 0
                browser.screenshot(args.output / f"{projection}.png")
            check("lexical overlay survives style restoration in both projections")
            browser.call("POST", "/window/rect", {"width": 520, "height": 850})
            browser.js("document.querySelector('.word-map-summary').scrollIntoView()")
            assert browser.js("return document.documentElement.scrollWidth<=innerWidth")
            button("Return to exploration")
            ready()
            assert len(graph_ids()) == fixture_count
            browser.screenshot(args.output / "narrow-round-trip.png")
            check("narrow summary controls remain reachable and return preserves graph")
            report["passed"] = True
        except Exception as error:
            report["error"] = str(error)
            report["failureSnapshot"] = browser.js("return window.overlapTest?.snapshot() ?? null")
            browser.screenshot(args.output / "failure.png")
            (args.output / "failure-dom.txt").write_text(
                browser.js("return document.body.innerText")
            )
            raise
        finally:
            report["requests"] = dict(hits)
            (args.output / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    print(
        f"Passed {len(report['checks'])} map integration checkpoints: {args.output / 'report.json'}"
    )


if __name__ == "__main__":
    main()
