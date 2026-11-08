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

            # Expanding another branch still leaves map selection unchanged.
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
            results["unmappedLanguage"] = search(browser, "ache1244", "ache1244")
            assert results["unmappedLanguage"]["disabled"]
            assert "No areas" in results["unmappedLanguage"]["text"]
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

            # Own and descendant representations remain distinct, with grouped rendering.
            # An interior point of the source polygon; the Glottolog point is outside it.
            center = [40.8144288679004, 43.27592703258703]
            browser.js(
                "window.overlapTest.configure(arguments[0])",
                {"languageIds": [], "center": center, "zoom": 5},
            )
            search(browser, "abkh1242", "abkh1242")
            browser.js("document.querySelector('.language-row').click()")

            def choose_mode(mode):
                browser.js(
                    """
                    const select = document.querySelector('.language-row__area-mode');
                    select.value = arguments[0];
                    select.dispatchEvent(new Event('change', {bubbles:true}));
                """,
                    mode,
                )

            def ready_after(before, count):
                return wait_for(
                    lambda: (
                        state
                        if len((state := browser.snapshot())["reports"]) > before
                        and state["reports"][-1]["outcome"] == "ready"
                        and state["selectedCount"] == count
                        and state["tilesLoaded"]
                        and not state["moving"]
                        else None
                    ),
                    45,
                    "grouped map coverage",
                )

            def inspect_at_center():
                return browser.js("return window.overlapTest.inspect(arguments[0])", center)

            choose_mode("descendants")
            before = len(browser.snapshot()["reports"])
            browser.js("document.querySelector('.language-row input').click()")
            grouped = ready_after(before, 1)
            assert not grouped["errors"], grouped["errors"]
            assert grouped["reports"][-1]["sharedPatterns"] == 0
            assert inspect_at_center()["variantIds"] == ["descendants:abkh1242"], (
                inspect_at_center()
            )
            x, y = inspect_at_center()["point"]
            browser.call(
                "POST",
                "/actions",
                {
                    "actions": [
                        {
                            "type": "pointer",
                            "id": "aggregate-mouse",
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
            browser.call("DELETE", "/actions")
            popup = wait_for(
                lambda: browser.js(
                    "return document.querySelector('.language-inspector')?.textContent"
                ),
                10,
                "aggregate inspection popup",
            )
            assert "Abkhaz-Adyge" in popup and "abkh1242" in popup
            assert "Descendant areas" in popup and "3 contributing entries" in popup
            assert "3 contributing entries" in browser.js(
                "return document.querySelector('.finder-detail').textContent"
            )
            browser.js("document.querySelector('.language-row__disclosure').click()")
            assert browser.js(
                "return [...document.querySelectorAll('.language-row[aria-level=\"2\"] input')].every(input => !input.checked)"
            )
            browser.screenshot(output / "aggregated-family.png")

            # The same geometry can contribute to the family and an independent child selection.
            search(browser, "abkh1244", "abkh1244")
            before = len(browser.snapshot()["reports"])
            browser.js("document.querySelector('.language-row input').click()")
            grouped_child = ready_after(before, 2)
            assert not browser.js(
                "return !!document.querySelector('.language-inspector--pinned')"
            ), "Selection changes close stale inspection"
            expected = {"descendants:abkh1242", "asher2007world:contemporary:abkh1244"}
            assert set(inspect_at_center()["variantIds"]) == expected, inspect_at_center()
            assert grouped_child["reports"][-1]["sharedPatterns"] > 0
            results["aggregationWithChild"] = inspect_at_center()

            # Blending uses the same unioned coverage, so contributor overlap isn't applied twice.
            before = len(browser.snapshot()["reports"])
            browser.js("document.querySelector('input[aria-label=\"Color blending\"]').click()")
            blended = ready_after(before, 2)
            assert not blended["errors"], blended["errors"]
            assert set(inspect_at_center()["variantIds"]) == expected, inspect_at_center()
            browser.screenshot(output / "aggregated-blending.png")
            before = len(browser.snapshot()["reports"])
            browser.js(
                "document.querySelector('input[aria-label=\"Alternating stripes\"]').click()"
            )
            ready_after(before, 2)

            search(browser, "abkh1242", "abkh1242")
            choose_mode("own")
            wait_for(
                lambda: "asher2007world:contemporary:abkh1242" in inspect_at_center()["variantIds"],
                20,
                "own representation",
            )
            browser.js(
                "[...document.querySelectorAll('.finder-actions button')].find(button => button.textContent === 'Clear map').click()"
            )

            # An entry with no own polygons can be selected through a single mapped descendant.
            row = search(browser, "abkh1243", "abkh1243")
            assert not row["disabled"] and "Descendant areas" in row["text"]
            before = len(browser.snapshot()["reports"])
            browser.js("document.querySelector('.language-row input').click()")
            ready_after(before, 1)
            assert inspect_at_center()["variantIds"] == ["descendants:abkh1243"], (
                inspect_at_center()
            )
            results["previouslyUnmappedAggregate"] = row

            # Filters hide the selected representation without unchecking it; restoration recovers it.
            browser.js("""
                const select = document.querySelector('.finder-filters__period select');
                select.value = 'year-1750'; select.dispatchEvent(new Event('change', {bubbles:true}));
            """)
            wait_for(lambda: browser.snapshot()["selectedCount"] == 0, 10, "filtered aggregation")
            assert browser.js("return document.querySelector('.language-row input').checked")
            assert (
                browser.js("return document.querySelector('.language-row').dataset.areaStatus")
                == "Filtered out"
            )
            assert "0 of 1 shown" in browser.js(
                "return document.querySelector('.selection-count').textContent"
            )
            before = len(browser.snapshot()["reports"])
            browser.js("""
                const select = document.querySelector('.finder-filters__period select');
                select.value = 'contemporary'; select.dispatchEvent(new Event('change', {bubbles:true}));
            """)
            ready_after(before, 1)
            browser.js("""
                const select = document.querySelector('.finder-filters select:not(.finder-filters__period select)');
                select.value = 'viewport'; select.dispatchEvent(new Event('change', {bubbles:true}));
            """)
            wait_for(
                lambda: browser.js(
                    "return !!document.querySelector('.language-row[data-language-id=\"abkh1243\"]')"
                ),
                15,
                "aggregate in viewport search",
            )
            browser.js("""
                const select = document.querySelector('.finder-filters select:not(.finder-filters__period select)');
                select.value = 'world'; select.dispatchEvent(new Event('change', {bubbles:true}));
            """)
            browser.screenshot(output / "aggregate-only.png")
            results["aggregationFiltersAndViewport"] = "passed"

            # Show a complete family as individual deepest mapped entries, without unfolding it.
            browser.js(
                "window.overlapTest.configure(arguments[0])",
                {
                    "languageIds": ["sino1245", "beij1235", "jiny1235", "abkh1244"],
                    "center": [112, 28],
                    "zoom": 4,
                },
            )
            search(browser, "sino1245", "sino1245")
            browser.js("""
                const row = document.querySelector('.language-row');
                row.click();
                if (row.getAttribute('aria-expanded') === 'true') {
                    row.querySelector('.language-row__disclosure').click();
                }
            """)
            browser.js("""
                const filters = document.querySelector('.finder-options');
                filters.open = true;
                document.querySelector('.source-filter__trigger').click();
            """)
            browser.js("""
                [...document.querySelectorAll('.source-filter__actions button')]
                  .find(button => button.textContent === 'Clear').click();
            """)
            wait_for(
                lambda: browser.js(
                    "return document.querySelector('.source-filter__trigger').textContent.includes('No sources')"
                ),
                10,
                "cleared geographic sources",
            )
            browser.js("""
                [...document.querySelectorAll('.source-filter__option')]
                  .find(label => label.querySelector('strong').textContent === 'DLAC')
                  .querySelector('input').click();
            """)
            wait_for(
                lambda: browser.js("""
                    const button = document.querySelector('.finder-detail__mapped-leaves button');
                    return button && !button.disabled && button.textContent === 'Show mapped leaves (10)';
                """),
                10,
                "DLAC mapped leaf count",
            )
            browser.js("document.querySelector('.source-filter__trigger').click()")
            browser.js("""
                const select = document.querySelector('.finder-detail__mode select');
                select.value = 'descendants';
                select.dispatchEvent(new Event('change', {bubbles:true}));
            """)
            before = len(browser.snapshot()["reports"])
            browser.js("document.querySelector('.finder-detail__mapped-leaves button').click()")
            leaves_state = ready_after(before, 10)
            assert not leaves_state["errors"], leaves_state["errors"]
            assert not browser.js("return document.querySelector('.language-row input').checked")
            assert browser.js("return document.querySelectorAll('.language-row').length") == 1
            assert "10 of 11 shown" in browser.js(
                "return document.querySelector('.selection-count').textContent"
            )
            browser.screenshot(output / "dlac-family-leaves.png")

            # Repeating the action is idempotent; filters update the count and disable empty actions.
            browser.js("document.querySelector('.finder-detail__mapped-leaves button').click()")
            assert "10 of 11 shown" in browser.js(
                "return document.querySelector('.selection-count').textContent"
            )
            browser.js("""
                const select = document.querySelector('.finder-filters__period select');
                select.value = 'year-1750';
                select.dispatchEvent(new Event('change', {bubbles:true}));
            """)
            wait_for(
                lambda: browser.js("""
                    const button = document.querySelector('.finder-detail__mapped-leaves button');
                    return button.disabled && button.textContent === 'Show mapped leaves (0)';
                """),
                10,
                "unavailable mapped leaves",
            )
            assert "0 of 11 shown" in browser.js(
                "return document.querySelector('.selection-count').textContent"
            )
            browser.js("""
                const select = document.querySelector('.finder-filters__period select');
                select.value = 'contemporary';
                select.dispatchEvent(new Event('change', {bubbles:true}));
            """)
            wait_for(lambda: browser.snapshot()["selectedCount"] == 10, 10, "mapped leaf recovery")
            leaf_ids = [
                "ganc1239", "hakk1236", "jiny1235", "huiz1242", "wuch1236",
                "xian1251", "ping1245", "yuec1235", "minn1248", "mand1415",
            ]
            for code in leaf_ids:
                search(browser, code, code)
                assert browser.js("""
                    const row = document.querySelector('.language-row');
                    return row.querySelector('input').checked && row.dataset.areaMode === 'own';
                """), code
            # Replace all selections in the subtree, including previously selected unavailable nodes.
            for code, checked in [("beij1235", False), ("sino1245", False), ("abkh1244", True)]:
                search(browser, code, code)
                assert browser.js(
                    "return document.querySelector('.language-row input').checked"
                ) == checked, code
            results["dlacFamilyLeaves"] = {"ids": leaf_ids, "selectedCount": 10}

            # Bulk leaves follow the current query across multiple, overlapping branches.
            browser.js(
                "window.overlapTest.configure(arguments[0])",
                {
                    "languageIds": ["mand1415", "beij1235", "jiny1235", "abkh1244"],
                    "center": [112, 28],
                    "zoom": 4,
                },
            )
            search(browser, "Chinese", "mand1415")
            browser.js("document.querySelector('.source-filter__trigger').click()")
            browser.js("""
                [...document.querySelectorAll('.source-filter__actions button')]
                  .find(button => button.textContent === 'Clear').click();
            """)
            wait_for(
                lambda: browser.js(
                    "return document.querySelector('.source-filter__trigger').textContent.includes('No sources')"
                ),
                10,
                "cleared bulk fixture sources",
            )
            browser.js("""
                [...document.querySelectorAll('.source-filter__option')]
                  .find(label => label.querySelector('strong').textContent === 'DLAC')
                  .querySelector('input').click();
            """)
            browser.js("document.querySelector('.source-filter__trigger').click()")
            bulk_button = """
                [...document.querySelectorAll('.finder-actions button')]
                  .find(button => button.textContent.startsWith('Show mapped leaves'))
            """
            wait_for(
                lambda: browser.js(f"""
                    const button = {bulk_button};
                    return !button.disabled && button.textContent === 'Show mapped leaves (8)';
                """),
                10,
                "query mapped leaf count",
            )
            assert browser.js("return document.querySelectorAll('.finder-detail__mapped-leaves').length") == 0
            before = len(browser.snapshot()["reports"])
            browser.js(f"({bulk_button}).click()")
            ready_after(before, 8)
            assert "8 of 9 shown" in browser.js(
                "return document.querySelector('.selection-count').textContent"
            )
            browser.js(f"({bulk_button}).click()")
            assert "8 of 9 shown" in browser.js(
                "return document.querySelector('.selection-count').textContent"
            )
            bulk_leaf_ids = [code for code in leaf_ids if code not in {"ping1245", "minn1248"}]
            for code in bulk_leaf_ids:
                search(browser, code, code)
                assert browser.js("""
                    const row = document.querySelector('.language-row');
                    return row.querySelector('input').checked && row.dataset.areaMode === 'own';
                """), code
            for code, checked in [("beij1235", False), ("abkh1244", True), ("ping1245", False)]:
                search(browser, code, code)
                assert browser.js(
                    "return document.querySelector('.language-row input').checked"
                ) == checked, code
            search(browser, "Chinese", "mand1415")
            browser.js("""
                const select = document.querySelector('.finder-filters__period select');
                select.value = 'year-1750';
                select.dispatchEvent(new Event('change', {bubbles:true}));
            """)
            wait_for(
                lambda: browser.js(f"""
                    const button = {bulk_button};
                    return button.disabled && button.textContent === 'Show mapped leaves (0)';
                """),
                10,
                "unavailable query mapped leaves",
            )
            browser.js("""
                const select = document.querySelector('.finder-filters__period select');
                select.value = 'contemporary';
                select.dispatchEvent(new Event('change', {bubbles:true}));
            """)
            results["queryMappedLeaves"] = {"ids": bulk_leaf_ids, "selectedCount": 8}

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
