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
    report = {"passed": False, "checks": []}
    with browser_session(args.output, dev=True) as (browser, origin):
        browser.call("POST", "/url", {"url": origin + "/"})

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

        try:
            wait_for(lambda: js("return !!document.querySelector('.maplibregl-canvas')"), 45, "map")
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
            report["checks"].append("both sidebars and map survive view round trip")
            browser.screenshot(args.output / "administrative.png")
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
