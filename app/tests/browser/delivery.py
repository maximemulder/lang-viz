#!/usr/bin/env python3
"""Verify lazy geometry routing, fine prepared detail and on-demand source records."""

import json
from urllib.parse import parse_qs, urlsplit

from run import APP, browser_session, check_state, open_atlas, wait_for
from sidebar import open_details, search, select_branches


def archives(tile_url):
    base = parse_qs(urlsplit(tile_url).query)["archive"][0]
    return json.loads(parse_qs(urlsplit(base).query)["atlasArchives"][0])


def main():
    output = APP / "test-results/delivery"
    output.mkdir(parents=True, exist_ok=True)
    result = {}
    with browser_session(output) as (browser, origin):
        open_atlas(browser, origin)
        try:
            wait_for(
                lambda: browser.js("return !!document.querySelector('.source-filter__trigger')"),
                20,
                "catalog",
            )
            resources = browser.js(
                "return performance.getEntriesByType('resource').map(r=>new URL(r.name).pathname)"
            )
            assert any(p.endswith("/geometry-index.json") for p in resources), resources
            assert not any(
                p.endswith("/geometry-variants.json") or "/provenance/" in p for p in resources
            ), resources
            result["startupMetadata"] = resources
            state = select_branches(browser, "DLAC", [112, 28], zoom=5.2)
            check_state(state, True)
            report = state["reports"][-1]
            assert report["metrics"].get("partsTiles", 0) > 0, report
            assert report["metrics"]["partitionMs"] == 0, report
            assert report["metrics"]["initializeMs"] == 0, report
            assert state["coverageZooms"] and all(z == 5 for z in state["coverageZooms"]), state[
                "coverageZooms"
            ]
            loaded = archives(state["geometryTiles"][0])
            assert len(loaded) == 1 and "/dlac1987china/contemporary.pmtiles" in loaded[0], loaded
            for url in state["coverageUrls"]:
                assert archives(url) == loaded, url
            result["dlacZoom5"] = {
                "report": report,
                "archives": loaded,
                "zooms": state["coverageZooms"],
            }
            assert browser.js("return window.overlapTest.inspect([112,28]).variantIds"), (
                "No fine-detail coverage"
            )
            browser.screenshot(output / "dlac-zoom5.png")
            browser.js("window.overlapTest.camera([119,32],5.2)")
            state = browser.settled(60)
            check_state(state, True)
            assert state["reports"][-1]["metrics"]["partitionMs"] == 0
            browser.js("window.overlapTest.camera([112,28],5.2)")
            state = browser.settled(60)
            check_state(state, True)
            result["returnReport"] = state["reports"][-1]

            search(browser, "dlac1987china:shaozhou-tuhua", "dlac1987china:shaozhou-tuhua")
            open_details(browser)
            browser.js("""
                [...document.querySelectorAll('.finder-detail details')]
                    .find(d=>d.querySelector('summary')?.textContent==='Original source records').open=true;
            """)
            text = wait_for(
                lambda: browser.js("""
                const d=[...document.querySelectorAll('.finder-detail details')]
                    .find(d=>d.querySelector('summary')?.textContent==='Original source records');
                return d && d.textContent.includes('source features:') ? d.textContent : null;
            """),
                20,
                "lazy source records",
            )
            resources = browser.js(
                "return performance.getEntriesByType('resource').map(r=>new URL(r.name).pathname).filter(p=>p.includes('/provenance/'))"
            )
            assert len(resources) == 1 and resources[0].endswith(
                "/dlac1987china/contemporary.json"
            ), resources
            result["sourceRecords"] = {"text": text, "requests": resources}
            browser.screenshot(output / "source-records.png")
            print("Lazy DLAC routing, zoom-5 parts, navigation and source records pass", flush=True)
        except Exception:
            result["failureState"] = browser.snapshot()
            browser.screenshot(output / "failure.png")
            raise
        finally:
            (output / "report.json").write_text(json.dumps(result, indent=2) + "\n")


if __name__ == "__main__":
    main()
