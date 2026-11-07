#!/usr/bin/env python3
"""Check hierarchy browsing, ranked search, keyboard navigation and map selection."""

import json
import subprocess
import urllib.request
from contextlib import ExitStack
from types import SimpleNamespace

from run import APP, Browser, check_state, free_port, request, stop, stop_group, wait_for


def search(browser, query, glottocode):
    browser.js(
        """
        const input = document.querySelector('input[type=search]');
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, arguments[0]);
        input.dispatchEvent(new Event('input', {bubbles:true}));
        """,
        query,
    )
    return wait_for(
        lambda: browser.js(
            """
            const row = [...document.querySelectorAll('.language-row')]
              .find(row => row.dataset.languageId === arguments[0]);
            return row ? {text: row.textContent, disabled: row.querySelector('input').disabled, level: row.getAttribute('aria-level')} : null;
            """,
            glottocode,
        ),
        20,
        f"search result {glottocode}",
    )


def main():
    output = APP / "test-results/catalog"
    output.mkdir(parents=True, exist_ok=True)
    results = {}
    with ExitStack() as stack:
        preview_port, driver_port = free_port(), free_port()
        while driver_port == preview_port:
            driver_port = free_port()
        preview_log = stack.enter_context((output / "preview.log").open("w"))
        driver_log = stack.enter_context((output / "geckodriver.log").open("w"))
        preview = subprocess.Popen(
            [
                "npm",
                "run",
                "preview",
                "--",
                "--host",
                "127.0.0.1",
                "--port",
                str(preview_port),
                "--strictPort",
            ],
            cwd=APP,
            stdout=preview_log,
            stderr=subprocess.STDOUT,
            start_new_session=True,
        )
        stack.callback(stop_group, preview)
        driver = subprocess.Popen(
            ["geckodriver", "--host", "127.0.0.1", "--port", str(driver_port), "--log", "warn"],
            stdout=driver_log,
            stderr=subprocess.STDOUT,
        )
        stack.callback(stop, driver)
        origin = f"http://127.0.0.1:{preview_port}"
        webdriver = f"http://127.0.0.1:{driver_port}"
        wait_for(lambda: urllib.request.urlopen(origin, timeout=2).status == 200, 20, "preview")
        wait_for(lambda: request(webdriver, "GET", "/status"), 20, "geckodriver")
        browser = Browser(webdriver, SimpleNamespace(headed=False, hardware=False))
        stack.callback(browser.close)
        browser.call("POST", "/url", {"url": origin + "/?overlap-test=1&overlap-basemap=off"})
        wait_for(lambda: browser.js("return !!window.overlapTest"), 45, "application")
        try:
            wait_for(
                lambda: browser.js("return document.querySelectorAll('.language-row').length"),
                20,
                "tree roots",
            )
            results["initialBrowse"] = browser.js("""
                return {count: document.querySelector('.finder-actions p').textContent,
                    rows: [...document.querySelectorAll('.language-row')].map(row => ({name: row.textContent, level: row.getAttribute('aria-level')}))};
                """)
            assert "429 roots" in results["initialBrowse"]["count"]
            assert all(row["level"] == "1" for row in results["initialBrowse"]["rows"])
            browser.screenshot(output / "browse.png")

            # Expanding a family is independent of drawing it, and shows immediate groups.
            search(browser, "abkh1242", "abkh1242")
            browser.js("document.querySelector('.language-row__disclosure').click()")
            children = wait_for(
                lambda: browser.js("""
                const children = [...document.querySelectorAll('.language-row[aria-level="2"]')];
                return children.length === 3 ? children.map(row => row.dataset.languageId) : null;
                """),
                10,
                "family children",
            )
            assert set(children) == {"abkh1243", "circ1239", "ubyk1235"}
            assert browser.snapshot()["selectedCount"] == 0
            browser.screenshot(output / "expanded-family.png")

            # Arrow navigation moves focus, enters children and returns to/collapses the parent.
            browser.js("document.querySelector('.language-row').focus()")

            def key(value):
                browser.call(
                    "POST",
                    "/actions",
                    {
                        "actions": [
                            {
                                "type": "key",
                                "id": "tree-keyboard",
                                "actions": [
                                    {"type": "keyDown", "value": value},
                                    {"type": "keyUp", "value": value},
                                ],
                            }
                        ]
                    },
                )
                browser.call("DELETE", "/actions")

            key("\ue014")  # Right: already expanded, enter first child.
            wait_for(
                lambda: browser.js(
                    "return document.activeElement?.getAttribute('aria-level') === '2'"
                ),
                10,
                "keyboard child focus",
            )
            key("\ue012")  # Left: return to parent.
            wait_for(
                lambda: browser.js(
                    "return document.activeElement?.dataset.languageId === 'abkh1242'"
                ),
                10,
                "keyboard parent focus",
            )
            key("\ue012")  # Left: collapse.
            assert (
                browser.js(
                    "return document.querySelector('.language-row').getAttribute('aria-expanded')"
                )
                == "false"
            )
            key("\ue015")  # Down: end of this one-root result stays on the parent.
            assert browser.js("return document.activeElement?.dataset.languageId") == "abkh1242"
            key("\ue00d")  # Space: select just this family area.
            wait_for(lambda: browser.snapshot()["selectedCount"] == 1, 10, "keyboard map selection")
            assert browser.js("return document.querySelector('.language-row input').checked")
            key("\ue00d")
            wait_for(
                lambda: browser.snapshot()["selectedCount"] == 0, 10, "keyboard map deselection"
            )
            results["keyboard"] = "passed"

            # No polygon is required to explore a branch.
            search(browser, "jiny1235", "jiny1235")
            browser.js("document.querySelector('.language-row__disclosure').click()")
            assert wait_for(
                lambda: browser.js(
                    "return document.querySelectorAll('.language-row[aria-level=\"2\"]').length === 3"
                ),
                10,
                "unmapped children",
            )
            assert browser.snapshot()["selectedCount"] == 0

            # A search hit can be revealed in its complete classification, including deep ancestors.
            search(browser, "上海", "shan1293")
            browser.js("document.querySelector('.language-row').click();")
            browser.js("document.querySelector('.finder-detail__reveal').click()")
            revealed = wait_for(
                lambda: browser.js("""
                const row = document.activeElement;
                return row?.dataset.languageId === 'shan1293' && Number(row.getAttribute('aria-level')) > 1
                    ? {key: row.dataset.treeKey, level: row.getAttribute('aria-level'), query: document.querySelector('input[type=search]').value} : null;
                """),
                15,
                "reveal in classification",
            )
            assert revealed["query"] == "" and revealed["key"].startswith("sino1245/")
            results["revealedDialect"] = revealed
            browser.screenshot(output / "revealed-dialect.png")
            key("\ue010")  # End: focus reaches a virtualized, initially unmounted root.
            wait_for(
                lambda: browser.js(
                    "return document.activeElement?.getAttribute('aria-posinset') === '429'"
                ),
                10,
                "virtualized end navigation",
            )
            key("\ue011")  # Home.
            wait_for(
                lambda: browser.js(
                    "return document.activeElement?.getAttribute('aria-posinset') === '1'"
                ),
                10,
                "virtualized home navigation",
            )

            # An exact name should lead, without treating ancestor names as matches for descendants.
            search(browser, "Mandarin Chinese", "mand1415")
            assert (
                browser.js("return document.querySelector('.language-row').dataset.languageId")
                == "mand1415"
            )
            results["rankedSearch"] = "passed"

            # Unmapped entries must remain discoverable, including by original-script aliases.
            results["unmappedLanguage"] = search(browser, "jiny1235", "jiny1235")
            assert results["unmappedLanguage"]["disabled"]
            assert "No polygon available" in results["unmappedLanguage"]["text"]
            results["unmappedDialectAlias"] = search(browser, "上海", "shan1293")
            assert results["unmappedDialectAlias"]["disabled"]
            assert "dialect" in results["unmappedDialectAlias"]["text"]
            for code, level, center in [
                ("lahn1241", "family", [74, 31]),
                ("hara1256", "dialect", [76.2, 25.1]),
            ]:
                row = search(browser, code, code)
                assert not row["disabled"] and level in row["text"]
                browser.js("document.querySelector('.language-row input').click()")
                assert browser.js("return document.querySelector('.language-row input').checked")
                browser.js(
                    "window.overlapTest.configure(arguments[0])",
                    {
                        "languageIds": [code],
                        "center": center,
                        "zoom": 5,
                    },
                )
                state = wait_for(
                    lambda: (
                        state
                        if (state := browser.snapshot())["mapLoaded"]
                        and state["tilesLoaded"]
                        and not state["moving"]
                        and state["selectedCount"] == 1
                        else None
                    ),
                    30,
                    f"mapped {level}",
                )
                assert not state["errors"]
                inspection = browser.js("return window.overlapTest.inspect(arguments[0])", center)
                assert f"asher2007world:contemporary:{code}" in inspection["variantIds"]
                x, y = inspection["point"]
                browser.call(
                    "POST",
                    "/actions",
                    {
                        "actions": [
                            {
                                "type": "pointer",
                                "id": "catalog-mouse",
                                "parameters": {"pointerType": "mouse"},
                                "actions": [
                                    {"type": "pointerMove", "origin": "viewport", "x": x, "y": y},
                                    {"type": "pointerDown", "button": 0},
                                    {"type": "pointerUp", "button": 0},
                                ],
                            }
                        ]
                    },
                )
                wait_for(
                    lambda: browser.js("return !!document.querySelector('.language-inspector')"),
                    10,
                    "inspection",
                )
                assert level in browser.js(
                    "return document.querySelector('.language-inspector').textContent"
                )
                results[level] = {"row": row, "inspection": inspection}
                browser.call("DELETE", "/actions")
                browser.screenshot(output / f"{level}.png")

            before = len(browser.snapshot()["reports"])
            browser.js(
                "window.overlapTest.configure(arguments[0])",
                {
                    "languageIds": ["indo1319", "hado1235", "hara1256"],
                    "center": [76.2, 25.1],
                    "zoom": 6,
                },
            )
            state = wait_for(
                lambda: (
                    state
                    if len((state := browser.snapshot())["reports"]) > before
                    and state["reports"][-1]["outcome"] in ("ready", "error")
                    and state["tilesLoaded"]
                    and not state["moving"]
                    else None
                ),
                60,
                "mixed family, language and dialect rendering",
            )
            check_state(state, require_stripes=True)
            inspection = browser.js("return window.overlapTest.inspect([76.2,25.1])")
            assert set(inspection["variantIds"]) == {
                f"asher2007world:contemporary:{code}"
                for code in ["indo1319", "hado1235", "hara1256"]
            }
            results["mixedLevels"] = inspection
            browser.screenshot(output / "mixed-levels.png")

            # The tree keeps useful space on narrow screens, including with entry details open.
            browser.call("POST", "/window/rect", {"width": 390, "height": 844})
            search(browser, "abkh1242", "abkh1242")
            browser.js("document.querySelector('.language-row').click()")
            narrow = browser.js("""
                const list = document.querySelector('.language-list');
                return {height: list.clientHeight, width: innerWidth,
                    documentWidth: document.documentElement.scrollWidth};
                """)
            assert narrow["height"] >= 88, narrow
            assert narrow["documentWidth"] <= narrow["width"], narrow
            results["narrowLayout"] = narrow
            browser.js("document.querySelector('.language-finder').scrollIntoView({block:'end'})")
            browser.screenshot(output / "narrow.png")
        except Exception:
            results["failureSnapshot"] = browser.snapshot()
            browser.screenshot(output / "failure.png")
            raise
        finally:
            (output / "report.json").write_text(json.dumps(results, indent=2) + "\n")
    print(f"Catalog browser checks passed: {output / 'report.json'}")


if __name__ == "__main__":
    main()
