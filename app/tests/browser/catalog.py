#!/usr/bin/env python3
"""Check hierarchy browsing, ranked search, keyboard navigation and map selection."""

import json
import subprocess
import urllib.request
from contextlib import ExitStack
from types import SimpleNamespace

from run import APP, Browser, check_state, free_port, request, stop, stop_group, wait_for
from comparisons import check_comparisons


def view(browser, name):
    browser.js("document.querySelector('#language-tab-'+arguments[0]).click()", name)
    wait_for(lambda: browser.js("return !document.querySelector('#language-panel-'+arguments[0]).hidden", name), 10, f"{name} view")
    if name in ("explore", "map"):
        # ResizeObserver repopulates a virtual list after its panel becomes visible.
        selector = ".language-row" if name == "explore" else ".on-map-row"
        wait_for(lambda: browser.js("return !!document.querySelector('#language-panel-'+arguments[0]+' '+arguments[1]+', #language-panel-'+arguments[0]+' .finder-empty')", name, selector), 10, f"{name} list")


def open_details(browser):
    browser.js("document.querySelector('.language-row__identity').click()")
    wait_for(lambda: browser.js("return !!document.querySelector('.finder-detail')"), 10, "entry details")


def search(browser, query, glottocode):
    view(browser, "explore")
    browser.js(
        """
        const input = document.querySelector('#language-panel-explore input[type=search]');
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
    catalog = json.loads((APP / "public/data/languages.json").read_text())
    # Some local catalogs retain an additional broad Sino-Tibetan source area.
    # Both source revisions must preserve it when present, alongside descendants.
    sino_has_own = any(v.startswith("dlac1987china:contemporary:") for row in catalog if row["id"] == "sino1245" for v in row["geometryVariantIds"])
    family_ids = ["ganc1239", "hakk1236", "jiny1235", "huiz1242", "wuch1236", "xian1251", "ping1245", "yuec1235", "minn1248", "mand1415"] + (["sino1245"] if sino_has_own else [])
    family_total = len(family_ids) + 2
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
            # Check every virtualized root, including the boundary between availability groups.
            roots_by_position = {}
            height, step = browser.js("""
                const list = document.querySelector('.language-list');
                return [list.scrollHeight, Math.max(44, Math.floor(list.clientHeight / 44) * 44)];
            """)
            for offset in range(0, height + step, step):
                root_rows = browser.call("POST", "/execute/async", {
                    "script": """
                        const done = arguments[arguments.length - 1];
                        document.querySelector('.language-list').scrollTop = arguments[0];
                        requestAnimationFrame(() => requestAnimationFrame(() => done(
                            [...document.querySelectorAll('.language-row')].map(row => ({
                                position: Number(row.getAttribute('aria-posinset')),
                                unavailable: row.classList.contains('language-row--unavailable')
                            }))
                        )));
                    """,
                    "args": [offset],
                })
                roots_by_position.update((row["position"], row["unavailable"]) for row in root_rows)
            availability_order = [roots_by_position[position] for position in sorted(roots_by_position)]
            assert len(availability_order) == 429, "Every classification root must remain discoverable"
            assert any(availability_order) and not all(availability_order)
            assert availability_order == sorted(availability_order), "Empty search must put roots with areas first"
            results["emptySearchAreaGroups"] = {"withAreas": availability_order.count(False), "withoutAreas": availability_order.count(True)}
            browser.js("document.querySelector('.language-list').scrollTop = 0")
            wait_for(lambda: browser.js("return !!document.querySelector('.language-row[aria-posinset=\"1\"]')"), 10, "first grouped root")
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
            open_details(browser)
            browser.js("document.querySelector('.finder-detail__reveal').click()")
            revealed = wait_for(
                lambda: browser.js("""
                const row = document.activeElement;
                return row?.dataset.languageId === 'shan1293' && Number(row.getAttribute('aria-level')) > 1
                    ? {key: row.dataset.treeKey, level: row.getAttribute('aria-level'), query: document.querySelector('#language-panel-explore input[type=search]').value} : null;
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

            # Area availability groups search matches, including descendant representations.
            search(browser, "abkh", "abkh1244")
            grouped_results = browser.js("""
                return [...document.querySelectorAll('.language-row[aria-level="1"]')].map(row => ({
                    id: row.dataset.languageId,
                    unavailable: row.classList.contains('language-row--unavailable'),
                    status: row.querySelector('.language-row__area-status').textContent,
                    reason: row.querySelector('.language-row__area-status').title,
                    color: getComputedStyle(row).color
                }));
            """)
            assert any(row["unavailable"] for row in grouped_results), grouped_results
            assert any(not row["unavailable"] for row in grouped_results), grouped_results
            assert [row["unavailable"] for row in grouped_results] == sorted(row["unavailable"] for row in grouped_results)
            aggregate = next(row for row in grouped_results if row["id"] == 'abkh1243')
            assert not aggregate["unavailable"] and aggregate["status"] == 'Descendant areas'
            for row in grouped_results:
                if row["unavailable"]:
                    assert row["status"] == 'No area' and row["reason"]
                    assert row["color"] != aggregate["color"], "The whole unavailable row is muted"
            browser.screenshot(output / "search-area-groups.png")
            results["searchAreaGroups"] = grouped_results

            # Unmapped entries must remain discoverable, including by original-script aliases.
            results["unmappedLanguage"] = search(browser, "ache1244", "ache1244")
            assert results["unmappedLanguage"]["disabled"]
            assert "No area" in results["unmappedLanguage"]["text"]
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
                browser.js("document.querySelector('.language-inspector__details').click()")
                wait_for(lambda: browser.js("return !!document.querySelector('.finder-detail')"), 10, "details from map popup")
                assert code in browser.js("return document.querySelector('.finder-detail').textContent")
                assert browser.snapshot()["selectedCount"] == 1
                assert not browser.js("return !!document.querySelector('.language-inspector--pinned')")

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
            open_details(browser)

            def choose_mode(mode):
                view(browser, "explore")
                open_details(browser)
                browser.js(
                    """
                    const select = document.querySelector('.finder-detail__mode select');
                    select.value = arguments[0];
                    select.dispatchEvent(new Event('change', {bubbles:true}));
                """,
                    mode,
                )
                view(browser, "explore")

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
            aggregate_id = inspect_at_center()["variantIds"][0]
            assert aggregate_id.startswith("descendants:abkh1242:"), inspect_at_center()
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
            open_details(browser)
            assert "3 contributing entries" in browser.js(
                "return document.querySelector('.finder-detail').textContent"
            )
            view(browser, "explore")
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
            expected = {aggregate_id, "asher2007world:contemporary:abkh1244"}
            assert set(inspect_at_center()["variantIds"]) == expected, inspect_at_center()
            assert grouped_child["reports"][-1]["sharedPatterns"] > 0
            results["aggregationWithChild"] = inspect_at_center()

            # Exact custom colors update live stripe pixels without replacing geometry.
            browser.js("document.querySelector('[aria-label=\"Map settings\"]').click()")
            element = browser.call(
                "POST", "/element", {"using": "css selector", "value": "#language-opacity"}
            )["element-6066-11e4-a52e-4f735466cecf"]
            browser.call("POST", f"/element/{element}/value", {"text": "\ue010"})
            wait_for(lambda: browser.js("return document.querySelector('#language-opacity').value==='100'"), 10, "opaque custom colors")
            browser.js("document.querySelector('[aria-label=\"Map settings\"]').click()")
            color_before = browser.snapshot()
            browser.js("""
                window.overlapTest.configureColors({strategy:'semantic',rootIds:[],anchors:{},
                    overrides:{abkh1242:'#ff0000', abkh1244:'#0000ff'}});
            """)
            wait_for(lambda: browser.js("return window.overlapTest.colorState(['abkh1242']).colors.abkh1242 === '#ff0000'"), 10, "color configuration")

            def sample_colors():
                pixels = browser.call("POST", "/execute/async", {
                    "script": "const done=arguments[arguments.length-1];window.overlapTest.samplePixels(arguments[0],4).then(done)",
                    # The inspection fixture is near a coast. Move the pixel patch
                    # inward so antialiased polygon edges cannot mix in the ocean.
                    "args": [[center[0], center[1] - 0.1]],
                })
                colors = {tuple(pixels[i:i + 4]) for i in range(0, len(pixels), 4)}
                results["lastCustomColorPixels"] = sorted(colors)
                return colors

            # Stripe interiors retain exact colors; filtered boundaries may mix them.
            wait_for(lambda: {(255, 0, 0, 255), (0, 0, 255, 255)} <= sample_colors(), 10, "custom stripe pixels")
            color_after = browser.snapshot()
            assert color_after["coverageUrls"] == color_before["coverageUrls"]
            assert len(color_after["reports"]) == len(color_before["reports"])
            assert browser.js("return getComputedStyle(document.querySelector('.language-row input')).accentColor") == "rgb(0, 0, 255)"
            # An override can be replaced repeatedly; the existing texture must refresh again.
            browser.js("""
                window.overlapTest.configureColors({strategy:'semantic',rootIds:[],anchors:{},
                    overrides:{abkh1242:'#00ff00', abkh1244:'#0000ff'}});
            """)
            wait_for(lambda: {(0, 255, 0, 255), (0, 0, 255, 255)} <= sample_colors(), 10, "updated custom stripe pixels")
            results["customColors"] = {"geometryReused": True, "stripePixels": "passed"}

            # The visible testing controls exercise the same configuration API.
            browser.js("document.querySelector('[aria-label=\"Map settings\"]').click()")
            browser.js("document.querySelector('.color-controls__custom').open = true")

            def color_text(selector, value):
                browser.js("""
                    const input = document.querySelector(arguments[0]);
                    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value').set.call(input, arguments[1]);
                    input.dispatchEvent(new Event('input', {bubbles:true}));
                """, selector, value)

            def color_button(text):
                browser.js("""
                    [...document.querySelectorAll('.color-controls button')]
                        .find(button => button.textContent === arguments[0]).click();
                """, text)

            def color_strategy(value):
                browser.js("""
                    const select = document.querySelector('.color-controls select');
                    select.value = arguments[0];
                    select.dispatchEvent(new Event('change', {bubbles:true}));
                """, value)

            color_strategy('categorical')
            wait_for(lambda: browser.js("return window.overlapTest.colorState([]).configuration.strategy === 'categorical'"), 10, 'categorical UI strategy')
            color_text('.color-controls input[list]', 'abkh1244')
            color_text('.color-controls input[aria-label="Custom color value"]', 'invalid')
            color_button('Set exact color')
            assert browser.js("return document.querySelector('.color-controls [role=alert]').textContent.includes('opaque color')")
            assert browser.js("return window.overlapTest.colorState([]).configuration.overrides.abkh1244") == '#0000ff'
            color_text('.color-controls input[aria-label="Custom color value"]', '#00ff00')
            color_button('Set exact color')
            wait_for(lambda: browser.js("return window.overlapTest.colorState(['abkh1244']).colors.abkh1244 === '#00ff00'"), 10, 'exact UI color')
            color_button('Remove exact color')
            assert not browser.js("return window.overlapTest.colorState([]).configuration.overrides.abkh1244")
            color_strategy('semantic')
            color_text('.color-controls input[list]', 'abkh1243')
            color_text('.color-controls input[aria-label="Custom color value"]', '#ff0000')
            color_button('Set subtree color')
            wait_for(lambda: browser.js("return window.overlapTest.colorState(['abkh1244']).roots.abkh1244 === 'abkh1243'"), 10, 'subtree UI anchor')
            assert browser.js("return window.overlapTest.colorState(['abkh1244']).colors.abkh1244") == '#ff0000'
            color_button('Remove subtree color')
            assert not browser.js("return window.overlapTest.colorState([]).configuration.anchors.abkh1243")
            color_text('.color-controls textarea', 'abkh1243')
            color_button('Apply comparison roots')
            wait_for(lambda: browser.js("return window.overlapTest.colorState(['abkh1244']).roots.abkh1244 === 'abkh1243'"), 10, 'comparison UI roots')
            color_text('.color-controls textarea', 'unknown-id')
            color_button('Apply comparison roots')
            assert browser.js("return document.querySelector('.color-controls [role=alert]').textContent.includes('Unknown languoid IDs')")
            assert browser.js("return window.overlapTest.colorState([]).configuration.rootIds") == ['abkh1243']
            browser.screenshot(output / 'color-controls.png')
            color_button('Reset color settings')
            configuration = browser.js("return window.overlapTest.colorState([]).configuration")
            assert configuration == {'strategy': 'semantic', 'rootIds': [], 'anchors': {}, 'overrides': {}}
            assert len(browser.snapshot()['reports']) == len(color_before['reports'])
            browser.js("document.querySelector('[aria-label=\"Map settings\"]').click()")
            results['colorControls'] = 'passed'

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
            before = len(browser.snapshot()["reports"])
            choose_mode("own")
            assert set(inspect_at_center()["variantIds"]) == expected
            assert len(browser.snapshot()["reports"]) == before, "Draft changes preserve pinned geometry"
            browser.js("document.querySelector('.language-row input').click()")
            ready_after(before, 3)
            wait_for(
                lambda: "asher2007world:contemporary:abkh1242" in inspect_at_center()["variantIds"],
                20,
                "own representation",
            )
            view(browser, "map")
            browser.js("document.querySelector('.on-map-actions button').click()")

            # An entry with no own polygons can be selected through a single mapped descendant.
            row = search(browser, "abkh1243", "abkh1243")
            assert not row["disabled"] and "Descendant areas" in row["text"]
            before = len(browser.snapshot()["reports"])
            browser.js("document.querySelector('.language-row input').click()")
            ready_after(before, 1)
            assert len(inspect_at_center()["variantIds"]) == 1
            assert inspect_at_center()["variantIds"][0].startswith("descendants:abkh1243:")
            results["previouslyUnmappedAggregate"] = row

            # Filters affect the draft, while pinned geometry remains displayed without recomputation.
            pinned_before = browser.snapshot()
            browser.js("""
                const select = document.querySelector('.finder-filters__period select');
                select.value = 'year-1750'; select.dispatchEvent(new Event('change', {bubbles:true}));
            """)
            wait_for(lambda: browser.js("return document.querySelector('.language-row input').disabled"), 10, "unavailable draft")
            assert browser.snapshot()["selectedCount"] == 1
            assert not browser.js("return document.querySelector('.language-row input').checked")
            assert (
                browser.js("return document.querySelector('.language-row').dataset.areaStatus")
                == "No area"
            )
            assert browser.js("""
                const row = document.querySelector('.language-row');
                return row.classList.contains('language-row--unavailable') &&
                    row.querySelector('.language-row__area-status').title.includes('sources / period');
            """), "Period-constrained results explain why they have no area"
            assert "1 shown" in browser.js(
                "return document.querySelector('.selection-count').textContent"
            )
            before = len(browser.snapshot()["reports"])
            browser.js("""
                const select = document.querySelector('.finder-filters__period select');
                select.value = 'contemporary'; select.dispatchEvent(new Event('change', {bubbles:true}));
            """)
            wait_for(lambda: browser.js("return document.querySelector('.language-row input').checked"), 10, "restore pinned draft")
            assert len(browser.snapshot()["reports"]) == before
            assert browser.snapshot()["coverageUrls"] == pinned_before["coverageUrls"]
            browser.js("""
                const select = document.querySelector('.finder-scope select');
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
                const select = document.querySelector('.finder-scope select');
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
                if (row.getAttribute('aria-expanded') === 'true') {
                    row.querySelector('.language-row__disclosure').click();
                }
            """)
            open_details(browser)
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
                    const button = document.querySelector('.finder-detail__branch button');
                    return button && !button.disabled && button.textContent === arguments[0];
                """, f"Show branch on map ({len(family_ids)})"),
                10,
                "DLAC mapped branch count",
            )
            browser.js("document.querySelector('.source-filter__trigger').click()")
            browser.js("""
                const select = document.querySelector('.finder-detail__mode select');
                select.value = 'descendants';
                select.dispatchEvent(new Event('change', {bubbles:true}));
            """)
            before = len(browser.snapshot()["reports"])
            browser.js("document.querySelector('.finder-detail__branch button').click()")
            branch_state = ready_after(before, family_total)
            assert not branch_state["errors"], branch_state["errors"]
            view(browser, "explore")
            wait_for(lambda: browser.js("return !!document.querySelector('.language-row input')"), 10, "return to family search")
            assert browser.js("return document.querySelector('.language-row input').checked") == sino_has_own
            assert browser.js("return document.querySelectorAll('.language-row').length") == 1
            assert f"{family_total} shown" in browser.js(
                "return document.querySelector('.selection-count').textContent"
            )
            browser.screenshot(output / "dlac-family-branch.png")
            family_colors = browser.js("return window.overlapTest.colorState(['mand1415','jiny1235','yuec1235'])")
            assert family_colors["branchRoots"] == ["sino1245"]
            assert set(family_colors["roots"].values()) == {"sino1245"}

            # Repeating the action is idempotent; filters update the count and disable empty actions.
            open_details(browser)
            browser.js("document.querySelector('.finder-detail__branch button').click()")
            assert f"{family_total} shown" in browser.js(
                "return document.querySelector('.selection-count').textContent"
            )
            browser.js("""
                const select = document.querySelector('.finder-filters__period select');
                select.value = 'year-1750';
                select.dispatchEvent(new Event('change', {bubbles:true}));
            """)
            wait_for(
                lambda: browser.js("""
                    const button = document.querySelector('.finder-detail__branch button');
                    return button.disabled && button.textContent === 'Show branch on map (0)';
                """),
                10,
                "unavailable mapped branches",
            )
            assert f"{family_total} shown" in browser.js(
                "return document.querySelector('.selection-count').textContent"
            )
            browser.js("""
                const select = document.querySelector('.finder-filters__period select');
                select.value = 'contemporary';
                select.dispatchEvent(new Event('change', {bubbles:true}));
            """)
            assert browser.snapshot()["selectedCount"] == family_total
            assert browser.js("return window.overlapTest.colorState(['mand1415','jiny1235','yuec1235']).colors") == family_colors["colors"]
            leaf_ids = family_ids
            for code in leaf_ids:
                search(browser, code, code)
                assert browser.js("""
                    const row = document.querySelector('.language-row');
                    return row.querySelector('input').checked && row.dataset.areaMode === 'own';
                """), code
            # Explore checkboxes describe the DLAC draft; Asher entries stay pinned separately.
            for code, checked in [("beij1235", False), ("abkh1244", False)]:
                search(browser, code, code)
                assert browser.js(
                    "return document.querySelector('.language-row input').checked"
                ) == checked, code
            results["dlacFamilyBranches"] = {"ids": leaf_ids, "selectedCount": family_total}

            # Bulk branches follow the current query across multiple overlapping matches.
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
                  .find(button => button.textContent.startsWith('Show branches on map'))
            """
            wait_for(
                lambda: browser.js(f"""
                    const button = {bulk_button};
                    return !button.disabled && button.textContent === 'Show branches on map (8)';
                """),
                10,
                "query mapped branch count",
            )
            assert browser.js("return document.querySelectorAll('.finder-detail__branch').length") == 0
            before = len(browser.snapshot()["reports"])
            browser.js(f"({bulk_button}).click()")
            ready_after(before, 10)
            assert "10 shown" in browser.js(
                "return document.querySelector('.selection-count').textContent"
            )
            browser.js(f"({bulk_button}).click()")
            assert "10 shown" in browser.js(
                "return document.querySelector('.selection-count').textContent"
            )
            bulk_leaf_ids = [code for code in leaf_ids if code not in {"ping1245", "minn1248", "sino1245"}]
            for code in bulk_leaf_ids:
                search(browser, code, code)
                assert browser.js("""
                    const row = document.querySelector('.language-row');
                    return row.querySelector('input').checked && row.dataset.areaMode === 'own';
                """), code
            for code, checked in [("beij1235", False), ("abkh1244", False), ("ping1245", False)]:
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
                    return button.disabled && button.textContent === 'Show branches on map (0)';
                """),
                10,
                "unavailable query mapped branches",
            )
            browser.js("""
                const select = document.querySelector('.finder-filters__period select');
                select.value = 'contemporary';
                select.dispatchEvent(new Event('change', {bubbles:true}));
            """)
            results["queryMappedLeaves"] = {"ids": bulk_leaf_ids, "selectedCount": 10}

            # The three views share selection and details, while keeping independent searches.
            browser.settled(60)
            search(browser, "Chinese", "mand1415")
            explore_before = browser.js("""
                return {query: document.querySelector('#language-panel-explore input').value,
                    scroll: document.querySelector('.language-list').scrollTop,
                    rows: [...document.querySelectorAll('.language-row')].map(row => row.dataset.treeKey)};
            """)
            reports_before_views = len(browser.snapshot()["reports"])
            view(browser, "map")
            assert browser.js("return document.querySelectorAll('.on-map-row').length") == 10
            assert browser.js("""
                const row = document.querySelector('.on-map-row[data-language-id="abkh1244"]');
                return row.dataset.displayed === 'true' && row.textContent.includes('Asher');
            """), "Pinned Asher selections survive browsing DLAC"
            browser.screenshot(output / "on-map.png")
            browser.js("""
                const input = document.querySelector('#language-panel-map input');
                Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'yuec1235');
                input.dispatchEvent(new Event('input', {bubbles:true}));
            """)
            wait_for(lambda: browser.js("return document.querySelectorAll('.on-map-row').length === 1 && document.querySelector('.on-map-row').dataset.languageId === 'yuec1235'"), 10, "selection search")
            browser.js("document.querySelector('.on-map-row__identity').click()")
            wait_for(lambda: browser.js("return !!document.querySelector('.finder-detail')"), 10, "selection details")
            assert browser.js("""
                return document.querySelector('.finder-detail').textContent.includes('yuec1235') &&
                    document.querySelector('.language-back').textContent.includes('On map') &&
                    document.activeElement.classList.contains('map-entry-card') &&
                    [...document.querySelectorAll('.language-panel')].filter(panel => !panel.hidden).length === 1 &&
                    document.querySelector('#language-panel-explore input').getClientRects().length === 0;
            """), "Details replaces the lists and receives focus"
            browser.screenshot(output / "details.png")
            browser.js("document.querySelector('.language-back').click()")
            view(browser, "map")
            assert browser.js("return document.querySelector('#language-panel-map input').value") == 'yuec1235'
            view(browser, "explore")
            assert browser.js("""
                return {query: document.querySelector('#language-panel-explore input').value,
                    scroll: document.querySelector('.language-list').scrollTop,
                    rows: [...document.querySelectorAll('.language-row')].map(row => row.dataset.treeKey)};
            """) == explore_before, "Explore context survives inspection"
            assert len(browser.snapshot()["reports"]) == reports_before_views, "Navigation must not recompute map geometry"
            # Tabs support arrow navigation; a query on the selection list survives switching.
            browser.js("document.querySelector('#language-tab-explore').focus()")
            key("\ue014")
            assert browser.js("return document.activeElement.id") == 'language-tab-map'
            view(browser, "map")
            browser.js("""
                const select = document.querySelector('.finder-filters__period select');
                select.value = 'year-1750'; select.dispatchEvent(new Event('change', {bubbles:true}));
            """)
            assert browser.js("return document.querySelector('.on-map-row').dataset.displayed === 'true'")
            assert browser.snapshot()["selectedCount"] == 10
            assert "10 selected" in browser.js("return document.querySelector('.on-map-actions').textContent")
            browser.screenshot(output / "on-map-pinned.png")
            browser.js("""
                const select = document.querySelector('.finder-filters__period select');
                select.value = 'contemporary'; select.dispatchEvent(new Event('change', {bubbles:true}));
            """)
            assert browser.snapshot()["selectedCount"] == 10
            browser.js("document.querySelector('.on-map-row__remove').click()")
            wait_for(lambda: browser.snapshot()["selectedCount"] == 9, 10, "remove selected entry")
            assert browser.js("return !!document.querySelector('#language-panel-map .finder-empty')")
            browser.js("document.querySelector('.on-map-actions button').click()")
            wait_for(lambda: browser.snapshot()["selectedCount"] == 0, 10, "clear all selections through filtered list")
            assert browser.js("return document.querySelector('.on-map-actions button').disabled")
            assert browser.js("return window.overlapTest.colorState([]).branchRoots") == []
            results["multiViewControls"] = "passed"

            results["comparisons"] = check_comparisons(browser, output, search, view, open_details)

            # Details uses the full available height on narrow screens.

            browser.call("POST", "/window/rect", {"width": 390, "height": 844})
            search(browser, "abkh1242", "abkh1242")
            open_details(browser)
            narrow = browser.js("""
                const panel = document.querySelector('#language-panel-details');
                return {height: panel.clientHeight, width: innerWidth,
                    documentWidth: document.documentElement.scrollWidth,
                    visiblePanels: [...document.querySelectorAll('.language-panel')].filter(panel => !panel.hidden).length};
                """)
            assert narrow["height"] >= 200 and narrow["visiblePanels"] == 1, narrow
            assert narrow["documentWidth"] <= narrow["width"], narrow
            results["narrowLayout"] = narrow
            browser.js("document.querySelector('.language-finder').scrollIntoView({block:'end'})")
            browser.screenshot(output / "narrow.png")
            browser.js("document.querySelector('[aria-label=\"Map settings\"]').click()")
            color_panel = browser.js("""
                const panel = document.querySelector('.map-settings__panel');
                const bounds = panel.getBoundingClientRect();
                return {right:bounds.right, bottom:bounds.bottom, width:innerWidth, height:innerHeight};
            """)
            assert color_panel['right'] <= color_panel['width'], color_panel
            assert color_panel['bottom'] <= color_panel['height'], color_panel
            results['narrowColorControls'] = color_panel
        except Exception:
            results["failureSnapshot"] = browser.snapshot()
            browser.screenshot(output / "failure.png")
            raise
        finally:
            (output / "report.json").write_text(json.dumps(results, indent=2) + "\n")
    print(f"Catalog browser checks passed: {output / 'report.json'}")


if __name__ == "__main__":
    main()
