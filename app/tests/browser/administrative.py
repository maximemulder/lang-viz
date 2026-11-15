"""Check the administrative header view against the real local supplement in Firefox."""

import argparse
import json
from pathlib import Path

from .run import APP, browser_session, wait_for


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=APP / "test-results/administrative")
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    boundary_assets = APP / "public/administrative/boundaries"
    crosswalk = json.loads((boundary_assets / "crosswalk.json").read_text())
    feature_index = json.loads((boundary_assets / "feature-index.json").read_text())
    nl_feature = next(item for item in crosswalk["territories"] if item["code"] == "NL")["featureIds"][0]
    nl_point = next(item for item in feature_index["features"] if item["featureId"] == nl_feature)["point"]
    report = {"passed": False, "checks": []}
    with browser_session(args.output, dev=True) as (browser, origin):
        browser.call("POST", "/url", {"url": origin + "/?overlap-test"})

        def js(script, *args):
            return browser.js(script, *args)

        def button(label, scope):
            js(
                "const e=[...document.querySelector(arguments[1]).querySelectorAll('button')]"
                ".find(e=>e.textContent.trim().startsWith(arguments[0]));"
                "if(!e)throw Error(arguments[0]);e.click()",
                label,
                scope,
            )

        def select_code(code):
            js(
                "const e=[...document.querySelectorAll('.administrative-results button')]"
                ".find(e=>e.querySelector('.administrative-code')?.textContent===arguments[0]);"
                "if(!e)throw Error(arguments[0]);e.focus()",
                code,
            )
            element = browser.call("GET", "/element/active")["element-6066-11e4-a52e-4f735466cecf"]
            browser.call("POST", f"/element/{element}/value", {"text": "\ue007"})

        def type_query(value):
            js("document.querySelector('.administrative-search-field input').focus()")
            element = browser.call(
                "POST",
                "/element",
                {"using": "css selector", "value": ".administrative-search-field input"},
            )["element-6066-11e4-a52e-4f735466cecf"]
            browser.call("POST", f"/element/{element}/value", {"text": value})

        def click_geo(coordinates):
            x, y = js("return window.overlapTest.inspect(arguments[0]).point", coordinates)
            browser.call("POST", "/actions", {"actions": [{"type": "pointer", "id": "administrative-map-pointer", "parameters": {"pointerType": "mouse"}, "actions": [{"type": "pointerMove", "duration": 0, "origin": "viewport", "x": x, "y": y}, {"type": "pointerDown", "button": 0}, {"type": "pointerUp", "button": 0}]}]})

        try:
            wait_for(lambda: js("return !!document.querySelector('.maplibregl-canvas')"), 45, "map")
            wait_for(lambda: js("return !!window.overlapTest"), 30, "map test bridge")
            assert js("return document.querySelector('.map-area-controls__borders').getAttribute('aria-pressed')") == "false"
            assert js("return document.querySelector('.map-area-controls__inspect button:first-of-type').getAttribute('aria-pressed')") == "true"
            assert js("return document.querySelector('.map-area-controls__inspect button:last-child').getAttribute('aria-pressed')") == "false"
            assert not js("return performance.getEntriesByType('resource').some(e=>e.name.endsWith('/geometry.topojson'))")
            report["checks"].append("default borders off and language hover")
            button("On map", ".language-tabs")
            js("window.savedAdministrativeMap = document.querySelector('.maplibregl-canvas')")
            button("Administrative", ".workspace-nav")
            wait_for(
                lambda: js("return !!document.querySelector('.administrative-results button')"),
                30,
                "administrative data",
            )
            assert "workspace=administrative" in js("return location.hash")
            assert js("return document.querySelector('.geography-sidebar__language').hidden")
            assert js("return window.savedAdministrativeMap === document.querySelector('.maplibregl-canvas')")
            report["checks"].append("header and persistent map")
            wait_for(lambda: js("return document.querySelector('.administrative-map-legend')?.textContent.includes('Points identify source geometries')"), 20, "administrative point view")
            assert not js("return performance.getEntriesByType('resource').some(e=>e.name.endsWith('/geometry.topojson'))")
            js("document.querySelector('.map-area-controls__inspect button:last-child').click()")
            wait_for(lambda: js("return document.querySelector('.map-area-controls__inspect button:last-child').getAttribute('aria-pressed')==='true'"), 10, "area inspection setting")
            js("window.overlapTest.camera([5.3,52.1],5)")
            wait_for(lambda: js("return !window.overlapTest.snapshot().moving"), 15, "Netherlands camera")
            click_geo([6.2, 53.1])
            assert not js("return !!document.querySelector('.administrative-detail')")
            report["checks"].append("border-off area picker ignores polygon interiors")
            js("document.querySelector('.map-area-controls__borders').click()")
            wait_for(lambda: js("return performance.getEntriesByType('resource').some(e=>e.name.endsWith('/geometry.topojson'))"), 30, "boundary topology")
            wait_for(lambda: js("return !document.querySelector('.administrative-map-legend')?.textContent.includes('Loading boundary geometry')"), 30, "boundary rendering")
            assert "Natural Earth 4.1.0" in js("return document.querySelector('.administrative-map-legend').textContent")
            hits = wait_for(lambda: js("return window.overlapTest.queryLayers([6.2,53.1],['administrative-polygon-hits'])") or None, 20, "rendered polygon hit")
            assert any(hit["properties"].get("territoryCode") == "NL" for hit in hits), hits
            click_geo([6.2, 53.1])
            wait_for(lambda: js("return document.querySelector('.administrative-detail .administrative-code')?.textContent==='NL'"), 15, "polygon area selection")
            report["checks"].append("border-on polygon picker selects the CLDR area")
            js("[...document.querySelectorAll('input[name=administrative-metric]')][1].click()")
            assert js("return [...document.querySelectorAll('input[name=administrative-metric]')][1].checked")
            wait_for(lambda: js("return window.overlapTest.queryLayers([6.2,53.1],['administrative-metric-fill']).some(h=>h.properties.territoryCode==='NL'&&h.properties.metricValue>0)"), 15, "matched metric fill")
            report["checks"].append("opt-in boundaries and metric control")

            type_query("NL")
            wait_for(
                lambda: js(
                    "return [...document.querySelectorAll('.administrative-results .administrative-code')]"
                    ".some(e=>e.textContent==='NL')"
                ),
                10,
                "NL search",
            )
            select_code("NL")
            assert "more than 100%" in js("return document.querySelector('.administrative-detail').textContent")
            assert "independent of any displayed polygon" in js(
                "return document.querySelector('.administrative-detail').textContent"
            )
            assert not js("return document.querySelector('.administrative-focus').disabled")
            report["checks"].append("territory search, selection, and overlap caveat")

            button("Languages", ".administrative-search-kind")
            type_query("ku_Cyrl")
            wait_for(
                lambda: js(
                    "return [...document.querySelectorAll('.administrative-results .administrative-code')]"
                    ".some(e=>e.textContent==='ku_Cyrl')"
                ),
                10,
                "language search",
            )
            select_code("ku_Cyrl")
            assert "Sum of estimates" in js("return document.querySelector('.administrative-detail').textContent")
            button("Indo-European", ".administrative-detail")
            assert "Family details" == js("return document.querySelector('.administrative-detail').getAttribute('aria-label')")
            report["checks"].append("language and family details")

            button("Geography", ".workspace-nav")
            assert js("return document.querySelector('#language-tab-map').getAttribute('aria-selected')") == "true"
            button("Administrative", ".workspace-nav")
            assert js("return document.querySelector('.administrative-detail').getAttribute('aria-label')") == "Family details"
            assert js("return document.querySelector('.administrative-search-field input').value") == "ku_Cyrl"
            assert js("return window.savedAdministrativeMap === document.querySelector('.maplibregl-canvas')")
            assert js("return document.querySelector('.map-area-controls__borders').getAttribute('aria-pressed')") == "true"
            js("document.querySelector('.map-area-controls__borders').click()")
            assert js("return document.querySelector('.map-area-controls__borders').getAttribute('aria-pressed')") == "false"
            assert "Borders are off" in js("return document.querySelector('.administrative-map-legend').textContent")
            wait_for(lambda: js("return window.overlapTest.queryLayers([6.2,53.1],['administrative-polygon-hits']).length===0"), 10, "polygon layer removal")
            click_geo(nl_point)
            wait_for(lambda: js("return document.querySelector('.administrative-detail .administrative-code')?.textContent==='NL'"), 10, "visible marker selection")
            report["checks"].append("border-off marker remains selectable without a polygon hit layer")
            js("document.querySelector('.map-area-controls__inspect button:first-of-type').click()")
            assert js("return document.querySelector('.map-area-controls__inspect button:first-of-type').getAttribute('aria-pressed')") == "true"
            assert js("return document.querySelector('.map-area-controls__inspect button:last-child').getAttribute('aria-pressed')") == "false"
            report["checks"].append("segmented control switches back to language inspection")
            report["checks"].append("both sidebars and map survive view round trip")
            browser.screenshot(args.output / "administrative.png")

            js("document.querySelector('.map-area-controls__borders').click()")
            js("document.querySelector('.map-area-controls__inspect button:last-child').click()")
            js("window.overlapTest.camera([100,60],2.5)")
            wait_for(lambda: js("return !window.overlapTest.snapshot().moving"), 15, "Russia camera")
            wait_for(
                lambda: js("return window.overlapTest.queryLayers([100,60],['administrative-polygon-hits']).some(h=>h.properties.territoryCode==='RU')"),
                20,
                "Russia polygon in Mercator",
            )
            js("document.querySelector('.map-settings__toggle').click()")
            js("document.querySelector('input[name=map-projection][value=globe]').click()")
            wait_for(
                lambda: js("return window.overlapTest.snapshot().projection.type==='vertical-perspective'"),
                15,
                "globe projection",
            )
            wait_for(
                lambda: js("return window.overlapTest.queryLayers([100,60],['administrative-polygon-hits']).some(h=>h.properties.territoryCode==='RU')"),
                20,
                "Russia polygon on globe",
            )
            report["checks"].append("date-line boundary renders in Mercator and globe")
            report["passed"] = True
        except Exception as error:
            report["error"] = str(error)
            browser.screenshot(args.output / "failure.png")
            raise
        finally:
            (args.output / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    print(f"Passed {len(report['checks'])} administrative browser checks.")


if __name__ == "__main__":
    main()
