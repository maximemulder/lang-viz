"""Check the administrative header view against the real local supplement in Firefox."""

import argparse
import json
from pathlib import Path
from typing import NotRequired, TypedDict

from .run import APP, browser_session, wait_for


class BrowserReport(TypedDict):
    passed: bool
    checks: list[str]
    error: NotRequired[str]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=APP / "test-results/administrative")
    parser.add_argument("--production", action="store_true", help="Use the built Pages app")
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    boundary_assets = APP / "public/administrative/boundaries"
    crosswalk = json.loads((boundary_assets / "crosswalk.json").read_text())
    feature_index = json.loads((boundary_assets / "feature-index.json").read_text())
    nl_feature = next(item for item in crosswalk["territories"] if item["code"] == "NL")["featureIds"][0]
    nl_point = next(item for item in feature_index["features"] if item["featureId"] == nl_feature)["point"]
    ly_point = next(item for item in feature_index["features"] if item["featureId"] == "country-LBY")["point"]
    somaliland_point = next(item for item in feature_index["features"] if item["featureId"] == "country-SOL")["point"]
    report: BrowserReport = {"passed": False, "checks": []}
    with browser_session(args.output, dev=not args.production) as (browser, origin):
        path = "/lang-viz/" if args.production else "/"
        browser.call("POST", "/url", {"url": origin + path + "?overlap-test"})

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

        def hover_geo(coordinates):
            x, y = js("return window.overlapTest.inspect(arguments[0]).point", coordinates)
            browser.call("POST", "/actions", {"actions": [{"type": "pointer", "id": "administrative-map-pointer", "parameters": {"pointerType": "mouse"}, "actions": [{"type": "pointerMove", "duration": 0, "origin": "viewport", "x": x + 20, "y": y + 20}, {"type": "pointerMove", "duration": 0, "origin": "viewport", "x": x, "y": y}]}]})

        try:
            wait_for(lambda: js("return !!document.querySelector('.maplibregl-canvas')"), 45, "map")
            wait_for(lambda: js("return !!window.overlapTest"), 30, "map test bridge")
            assert js("return document.querySelector('.map-area-controls__borders').getAttribute('aria-pressed')") == "false"
            assert js("return document.querySelector('.map-area-controls__inspect button:first-of-type').getAttribute('aria-pressed')") == "true"
            assert js("return document.querySelector('.map-area-controls__inspect button:last-child').getAttribute('aria-pressed')") == "false"
            assert not js("return performance.getEntriesByType('resource').some(e=>e.name.endsWith('/geometry.geojson'))")
            wait_for(lambda: js("return document.querySelector('.administrative-attribution')?.textContent.includes('Natural Earth 5.1.1')"), 20, "map information with borders off")
            js("window.adminAttributionText = document.querySelector('.administrative-attribution').textContent.replace(/\\s+/g, ' ').trim()")
            wait_for(lambda: js("return !document.querySelector('.maplibregl-ctrl-attrib').classList.contains('maplibregl-compact-show')"), 10, "folded map information")
            assert js("return document.querySelector('.maplibregl-ctrl-attrib-button').getBoundingClientRect().width > 0")
            report["checks"].append("default borders off and language hover")
            button("On map", ".language-tabs")
            js("window.savedAdministrativeMap = document.querySelector('.maplibregl-canvas')")
            js("""window.administrativeFetch = window.fetch;
window.fetch = (...args) => {
  if (String(args[0]).endsWith('/administrative/observations.json')) {
    window.fetch = window.administrativeFetch;
    return Promise.resolve(new Response('', {status: 503}));
  }
  return window.administrativeFetch(...args);
}""")
            button("Administrative", ".workspace-nav")
            wait_for(lambda: js("return !!document.querySelector('.administrative-panel__status[role=alert]')"), 30, "failed CLDR load")
            assert js("return window.savedAdministrativeMap === document.querySelector('.maplibregl-canvas')")
            button("Retry data load", ".administrative-panel__status")
            wait_for(
                lambda: js("return !!document.querySelector('.administrative-results button')"),
                30,
                "administrative data",
            )
            assert "workspace=administrative" in js("return location.hash")
            assert js("return document.querySelector('.geography-sidebar__language').hidden")
            assert js("return window.savedAdministrativeMap === document.querySelector('.maplibregl-canvas')")
            report["checks"].append("header and persistent map")
            wait_for(lambda: js("return document.querySelector('.administrative-attribution')?.textContent.includes('Points identify source geometries')"), 20, "administrative map information")
            assert js("return document.querySelector('.administrative-attribution').textContent.replace(/\\s+/g, ' ').trim() === window.adminAttributionText")
            assert not js("return !!document.querySelector('.administrative-map-legend')")
            assert js("return !!document.querySelector('.maplibregl-ctrl-attrib-button')")
            wait_for(lambda: js("return !document.querySelector('.maplibregl-ctrl-attrib').classList.contains('maplibregl-compact-show')"), 10, "collapsed map information")
            js("document.querySelector('.maplibregl-ctrl-attrib-button').click()")
            assert js("return document.querySelector('.maplibregl-ctrl-attrib').classList.contains('maplibregl-compact-show')")
            assert js("return document.querySelector('.maplibregl-ctrl-attrib').getBoundingClientRect().width <= 360")
            assert js("return document.querySelector('.administrative-attribution').getBoundingClientRect().height > 60")
            browser.screenshot(args.output / "map-information.png")
            js("document.querySelector('.maplibregl-ctrl-attrib-button').click()")
            assert not js("return document.querySelector('.maplibregl-ctrl-attrib').classList.contains('maplibregl-compact-show')")
            assert not js("return performance.getEntriesByType('resource').some(e=>e.name.endsWith('/geometry.geojson'))")
            js("""window.administrativeFetch = window.fetch;
window.fetch = (...args) => {
  if (String(args[0]).endsWith('/geometry.geojson')) {
    window.fetch = window.administrativeFetch;
    return Promise.resolve(new Response('', {status: 503}));
  }
  return window.administrativeFetch(...args);
}""")
            js("document.querySelector('.map-area-controls__inspect button:last-child').click()")
            wait_for(lambda: js("return document.querySelector('.map-area-controls__inspect button:last-child').getAttribute('aria-pressed')==='true'"), 10, "area inspection setting")
            wait_for(lambda: js("return !!document.querySelector('.administrative-map-status[role=alert]')"), 30, "failed boundary load")
            assert not js("return window.overlapTest.queryLayers([6.2,53.1],['administrative-polygon-hits']).length")
            button("Retry", ".administrative-map-status")
            wait_for(lambda: js("return performance.getEntriesByType('resource').some(e=>e.name.endsWith('/geometry.geojson'))"), 30, "boundary geometry")
            js("window.overlapTest.camera([5.3,52.1],5)")
            wait_for(lambda: js("return !window.overlapTest.snapshot().moving"), 15, "Netherlands camera")
            hits = wait_for(lambda: js("return window.overlapTest.queryLayers([6.2,53.1],['administrative-polygon-hits'])") or None, 20, "rendered polygon hit")
            assert any(hit["properties"].get("territoryCode") == "NL" for hit in hits), hits
            assert not js("return window.overlapTest.layerState('administrative-boundary-lines')")
            hover_geo([6.2, 53.1])
            wait_for(lambda: (s if (s := js("return window.overlapTest.layerState('administrative-hover-outline')")) and s['filter'][-1] == nl_feature and s['sourceLoaded'] else None), 20, "hovered area outline")
            outline = js("return window.overlapTest.layerState('administrative-hover-outline')")
            assert (outline["color"], outline["width"], outline["opacity"]) == ("#111111", 3, 0.95)
            assert not js("return window.overlapTest.layerState('administrative-hover-halo')")
            assert "Netherlands" in js("return document.querySelector('.maplibregl-popup')?.textContent")
            browser.screenshot(args.output / "area-hover.png")
            report["checks"].append("Area mode outlines hovered polygon with Borders off")
            click_geo([6.2, 53.1])
            wait_for(lambda: js("return document.querySelector('.administrative-inspector-header .administrative-code')?.textContent==='NL'"), 15, "polygon area selection")
            assert js("""
                const details = document.querySelector('.geography-inspector');
                const controls = document.querySelector('.administrative-panel');
                return details?.contains(document.querySelector('.administrative-detail')) &&
                    !controls.contains(document.querySelector('.administrative-detail')) &&
                    document.querySelector('.administrative-results').clientHeight >= 80;
            """)
            report["checks"].append("border-off polygon picker selects the CLDR area")
            js("document.querySelector('.map-area-controls__borders').click()")
            wait_for(lambda: js("return !!window.overlapTest.layerState('administrative-boundary-lines')"), 15, "visible boundary lines")
            assert "Natural Earth 5.1.1" in js("return document.querySelector('.administrative-attribution').textContent")
            assert js("return document.querySelector('.administrative-attribution').textContent.replace(/\\s+/g, ' ').trim() === window.adminAttributionText")
            js("[...document.querySelectorAll('input[name=administrative-metric]')][1].click()")
            assert js("return [...document.querySelectorAll('input[name=administrative-metric]')][1].checked")
            wait_for(lambda: js("return window.overlapTest.queryLayers([6.2,53.1],['administrative-metric-fill']).some(h=>h.properties.territoryCode==='NL'&&h.properties.metricValue>0)"), 15, "matched metric fill")
            report["checks"].append("opt-in boundaries and metric control")

            js("window.overlapTest.camera(arguments[0],4)", ly_point)
            wait_for(lambda: js("return !window.overlapTest.snapshot().moving"), 15, "Libya camera")
            wait_for(lambda: js("return window.overlapTest.queryLayers(arguments[0],['administrative-polygon-hits']).some(h=>h.properties.territoryCode==='LY')", ly_point), 20, "Libya polygon")
            wait_for(lambda: js("return window.overlapTest.queryLayers(arguments[0],['administrative-metric-fill']).some(h=>h.properties.territoryCode==='LY'&&h.properties.metricValue>0)", ly_point), 15, "Libya CLDR 49 fill")
            click_geo(ly_point)
            wait_for(lambda: js("return document.querySelector('.administrative-inspector-header .administrative-code')?.textContent==='LY'"), 15, "Libya selection")
            assert "Arabic" in js("return document.querySelector('.administrative-detail').textContent")
            report["checks"].append("Libya has a polygon and CLDR 49 observations")

            js("window.overlapTest.camera(arguments[0],4)", somaliland_point)
            wait_for(lambda: js("return !window.overlapTest.snapshot().moving"), 15, "Somaliland camera")
            wait_for(lambda: js("return window.overlapTest.queryLayers(arguments[0],['administrative-polygon-hits']).some(h=>h.properties.featureId==='country-SOL')", somaliland_point), 20, "Somaliland polygon")
            assert not js("return window.overlapTest.queryLayers(arguments[0],['administrative-metric-fill']).some(h=>h.properties.featureId==='country-SOL')", somaliland_point)
            hover_geo(somaliland_point)
            wait_for(lambda: js("return document.querySelector('.maplibregl-popup')?.textContent.includes('Somaliland')"), 10, "Somaliland popup")
            assert "No reviewed CLDR match for this shape" in js("return document.querySelector('.maplibregl-popup').textContent")
            click_geo(somaliland_point)
            assert js("return document.querySelector('.administrative-inspector-header .administrative-code')?.textContent==='LY'")
            report["checks"].append("Somaliland remains visible and inspectable without invented data")
            js("window.overlapTest.camera([5.3,52.1],5)")
            wait_for(lambda: js("return !window.overlapTest.snapshot().moving"), 15, "Netherlands camera restored")

            type_query("XK")
            wait_for(lambda: js("return [...document.querySelectorAll('.administrative-results .administrative-code')].some(e=>e.textContent==='XK')"), 10, "unmatched area search")
            select_code("XK")
            assert js("return document.querySelector('.administrative-detail-scroll .details-map-action__button').disabled")
            assert "No matched polygon" in js("return document.querySelector('.administrative-detail-scroll').textContent")
            report["checks"].append("ambiguous territory remains searchable without a polygon")
            button("Areas", ".administrative-search-kind")

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
            assert not js("return document.querySelector('.administrative-detail-scroll .details-map-action__button').disabled")
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
            assert not js("return !!document.querySelector('.administrative-map-status')")
            assert js("return document.querySelector('.administrative-attribution').textContent.replace(/\\s+/g, ' ').trim() === window.adminAttributionText")
            wait_for(lambda: js("return !window.overlapTest.layerState('administrative-boundary-lines')"), 10, "boundary line removal")
            assert js("return window.overlapTest.queryLayers([6.2,53.1],['administrative-polygon-hits']).length>0")
            click_geo(nl_point)
            wait_for(lambda: js("return document.querySelector('.administrative-inspector-header .administrative-code')?.textContent==='NL'"), 10, "visible marker selection")
            report["checks"].append("border-off marker and polygon remain selectable in Area mode")
            js("document.querySelector('.map-area-controls__inspect button:first-of-type').click()")
            assert js("return document.querySelector('.map-area-controls__inspect button:first-of-type').getAttribute('aria-pressed')") == "true"
            assert js("return document.querySelector('.map-area-controls__inspect button:last-child').getAttribute('aria-pressed')") == "false"
            wait_for(lambda: js("return !window.overlapTest.layerState('administrative-polygon-hits') && !window.overlapTest.layerState('administrative-hover-outline')"), 10, "area layers removed in Language mode")
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
            browser.call("POST", "/window/rect", {"width": 500, "height": 850})
            wait_for(lambda: js("return window.innerWidth <= 600"), 10, "narrow viewport")
            assert js("return [...document.querySelectorAll('.map-settings__toolbar button')].every(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.left>=0&&r.right<=innerWidth})")
            assert js("return !!document.querySelector('.administrative-results button')")
            border = browser.call("POST", "/element", {"using": "css selector", "value": ".map-area-controls__borders"})["element-6066-11e4-a52e-4f735466cecf"]
            browser.call("POST", f"/element/{border}/value", {"text": "\ue007"})
            assert js("return document.querySelector('.map-area-controls__borders').getAttribute('aria-pressed')") == "false"
            assert not js("return window.overlapTest.layerState('administrative-boundary-lines')")
            assert js("return !!window.overlapTest.layerState('administrative-polygon-hits')")
            language = browser.call("POST", "/element", {"using": "css selector", "value": ".map-area-controls__inspect button:first-of-type"})["element-6066-11e4-a52e-4f735466cecf"]
            browser.call("POST", f"/element/{language}/value", {"text": "\ue007"})
            assert js("return document.querySelector('.map-area-controls__inspect button:first-of-type').getAttribute('aria-pressed')") == "true"
            wait_for(lambda: js("return !window.overlapTest.layerState('administrative-polygon-hits')"), 10, "language mode polygon removal")
            area = browser.call("POST", "/element", {"using": "css selector", "value": ".map-area-controls__inspect button:last-child"})["element-6066-11e4-a52e-4f735466cecf"]
            browser.call("POST", f"/element/{area}/value", {"text": "\ue007"})
            assert js("return document.querySelector('.map-area-controls__inspect button:last-child').getAttribute('aria-pressed')") == "true"
            report["checks"].append("narrow layout and keyboard map controls")
            for background in ("minimal", "biomes", "terrain", "satellite"):
                js("document.querySelector('input[name=map-background][value='+arguments[0]+']').click()", background)
                assert js("return document.querySelector('input[name=map-background][value='+arguments[0]+']').checked", background)
                assert js("return !!window.overlapTest.layerState('administrative-polygon-hits')")
                assert not js("return window.overlapTest.layerState('administrative-boundary-lines')")
            report["checks"].append("all backgrounds keep Area picking with Borders off")
            button("Geography", ".workspace-nav")
            js("document.querySelector('.map-area-controls__inspect button:first-of-type').click()")
            wait_for(lambda: js("return !window.overlapTest.layerState('administrative-polygon-hits')"), 10, "hidden administrative source")
            assert js("return document.querySelector('.administrative-attribution').textContent.replace(/\\s+/g, ' ').trim() === window.adminAttributionText")
            assert js("return document.querySelector('.maplibregl-ctrl-attrib-button').getBoundingClientRect().width > 0")
            js("document.querySelector('.map-area-controls__borders').click()")
            wait_for(lambda: js("return !!window.overlapTest.layerState('administrative-boundary-lines')"), 15, "Geography borders on")
            assert js("return document.querySelector('.administrative-attribution').textContent.replace(/\\s+/g, ' ').trim() === window.adminAttributionText")
            js("document.querySelector('.map-area-controls__borders').click()")
            wait_for(lambda: js("return !window.overlapTest.layerState('administrative-boundary-lines')"), 10, "Geography borders off")
            assert js("return document.querySelector('.administrative-attribution').textContent.replace(/\\s+/g, ' ').trim() === window.adminAttributionText")
            report["checks"].append("map information stays folded and unchanged across Geography border states")
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
