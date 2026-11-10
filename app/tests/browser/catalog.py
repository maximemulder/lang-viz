#!/usr/bin/env python3
"""Check hierarchy browsing, ranked search, keyboard navigation and map selection."""

import json

from comparisons import check_comparisons
from selection import check_selection
from run import APP, browser_session, check_state, open_atlas, wait_for
from sidebar import open_details, search, view, map_section


def main():
    catalog = json.loads((APP / "public/data/languages.json").read_text())
    root_count = sum(row["parentId"] is None for row in catalog)
    output = APP / "test-results/catalog"
    output.mkdir(parents=True, exist_ok=True)
    results = {}
    with browser_session(output) as (browser, origin):
        open_atlas(browser, origin)
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
            assert f"{root_count} roots" in results["initialBrowse"]["count"]
            assert all(row["level"] == "1" for row in results["initialBrowse"]["rows"])
            assert browser.js("""
                return document.querySelectorAll('.language-tabs [role=tab]').length === 2 &&
                    !document.querySelector('.finder-detail') &&
                    !document.querySelector('.language-finder__header') &&
                    !!document.querySelector('#language-panel-explore .finder-options');
            """), "Two browsing views, with geography filters in Explore and no empty details pane"
            assert browser.js("""
                const labels=[...document.querySelectorAll('.finder-actions button')].map(b=>b.textContent.trim());
                return labels.includes('Select all') && labels.includes('Clear selection') &&
                    !labels.some(s=>s.includes('Select roots') || s.includes('Show branches on map'));
            """), 'Explore uses the restored selection controls'
            assert browser.js("""
                const list=document.querySelector('.language-list').getBoundingClientRect();
                const footer=document.querySelector('.explore-footer').getBoundingClientRect();
                const sources=document.querySelector('.finder-options');
                const search=document.querySelector('#explore-search-content');
                return !sources.open && sources.querySelector('summary').textContent.includes('Data sources') &&
                    search.contains(document.querySelector('.search-field')) &&
                    search.contains(document.querySelector('.finder-scope')) &&
                    document.querySelector('.search-field').getClientRects().length>0 &&
                    footer.top >= list.bottom - 1 &&
                    !document.querySelector('.map-settings__panel .color-controls') &&
                    document.querySelector('#on-map-colors-content').hidden;
            """), 'Data sources and Colors start collapsed, and Search contains the query, area, and results'
            map_section(browser, 'colors')
            assert browser.js("""
                return !document.querySelector('#on-map-entries-content').hidden &&
                    !document.querySelector('#on-map-colors-content').hidden &&
                    document.querySelectorAll('.language-finder [role=tablist]').length===1 &&
                    document.querySelector('#on-map-colors').getBoundingClientRect().bottom <=
                    document.querySelector('#on-map-entries').getBoundingClientRect().top + 1 &&
                    document.querySelector('#on-map-entries-heading').textContent.includes('Entries');
            """), 'Colors precedes Entries and both can stay open together in one vertical section stack'
            map_section(browser, 'entries', False)
            browser.js("document.querySelector('.color-controls__custom').open=true")
            browser.js("""
                const input=document.querySelector('.color-controls__custom input[type=text]');
                Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'stan1293');
                input.dispatchEvent(new Event('input',{bubbles:true}));
            """)
            map_section(browser, 'colors', False)
            map_section(browser, 'colors')
            view(browser, 'explore')
            view(browser, 'map')
            assert browser.js("""
                return document.querySelector('#on-map-colors').dataset.expanded==='true' &&
                    document.querySelector('#on-map-entries').dataset.expanded==='false' &&
                    document.querySelector('.color-controls__custom').open &&
                    document.querySelector('.color-controls__custom input[type=text]').value==='stan1293';
            """), 'Collapsing sections and changing views preserve independent expansion and color drafts'
            browser.screenshot(output / 'stacked-sections.png')
            map_section(browser, 'entries')
            map_section(browser, 'colors', False)
            view(browser, 'explore')
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
            assert len(availability_order) == root_count, "Every classification root must remain discoverable"
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

            browser.js("""
                document.querySelector('.finder-options').open=true;
                window.sourceControlsHeight=document.querySelector('.explore-controls').getBoundingClientRect().height;
                document.querySelector('#explore-search-heading').focus();
            """)
            key("\ue00d")
            assert browser.js("""
                const content=document.querySelector('#explore-search-content');
                return content.hidden && getComputedStyle(content).display==='none' &&
                    document.querySelector('.search-field').getClientRects().length===0 &&
                    document.querySelector('.language-list').getClientRects().length===0 &&
                    document.querySelector('.finder-options').open &&
                    document.querySelector('.finder-filters__period select').getClientRects().length>0 &&
                    document.querySelector('.explore-controls').getBoundingClientRect().height >= window.sourceControlsHeight-1;
            """), 'Collapsing Search removes its rendered content while Data sources stays open at its full height'
            browser.screenshot(output / 'collapsed-search.png')
            key("\ue00d")
            wait_for(lambda: browser.js("return document.querySelectorAll('.language-row[aria-level=\"2\"]').length===3"), 10, 'expanded family survives section collapse')
            browser.js("document.querySelector('.finder-options').open=false")
            assert browser.js("""
                return document.querySelector('.search-field').getClientRects().length>0 &&
                    document.querySelector('#explore-search input[type=search]').value==='abkh1242';
            """), 'Collapsing Data sources preserves the visible query and results in Search'
            browser.js("document.querySelector('.language-row').focus()")
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
            wait_for(lambda: browser.js("return document.querySelector('.language-row input').checked"), 10, "keyboard working selection")
            assert browser.snapshot()["selectedCount"] == 0
            assert browser.js("return document.querySelector('.language-row input').checked")
            key("\ue00d")
            wait_for(
                lambda: not browser.js("return document.querySelector('.language-row input').checked"), 10, "keyboard working deselection"
            )
            results["keyboard"] = "passed"

            # Inspect consecutive tree rows without leaving the list or taking its keyboard focus.
            browser.js("document.querySelector('.language-row__disclosure').click()")
            key("\ue007")  # Enter: inspect the focused parent.
            wait_for(lambda: browser.js("return document.querySelector('.finder-detail__heading small')?.textContent.includes('abkh1242')"), 10, "inspect parent")
            assert browser.js("""
                return document.activeElement.dataset.languageId === 'abkh1242' &&
                    !document.querySelector('#language-panel-explore').hidden &&
                    !document.querySelector('.finder-detail__more').open &&
                    document.querySelector('.language-row[data-language-id=abkh1242]').dataset.inspected === 'true';
            """), "Inspection keeps keyboard focus and starts compact"
            key("\ue015")  # Down: move to the first child while details stays open.
            child_id = browser.js("return document.activeElement.dataset.languageId")
            assert child_id != 'abkh1242'
            key("\ue007")
            wait_for(lambda: browser.js("return document.querySelector('.finder-detail__heading small').textContent.includes(arguments[0])", child_id), 10, "inspect next result")
            assert browser.js("return document.activeElement.dataset.languageId") == child_id
            assert browser.snapshot()["selectedCount"] == 0
            assert browser.js("""
                return document.querySelector('.language-tabs').getBoundingClientRect().bottom <=
                    document.querySelector('.finder-detail').getBoundingClientRect().top + 1;
            """), 'Opening the inspector keeps primary navigation anchored above it'
            browser.js("document.querySelector('.finder-detail__toggle').click()")
            assert browser.js("return document.querySelector('#focused-language-body').hidden")
            view(browser, 'map')
            assert browser.js("""
                return !!document.querySelector('.finder-detail') &&
                    document.querySelector('#focused-language-body').hidden &&
                    document.querySelector('.finder-options').getClientRects().length === 0;
            """), "Collapsed inspection persists across views; filters belong to Explore"
            view(browser, 'explore')
            browser.js("document.querySelector('.finder-detail__close').click()")
            assert browser.js("return !document.querySelector('.finder-detail')")
            assert browser.snapshot()["selectedCount"] == 0
            results["continuousInspection"] = "passed"

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
                    "return Number(document.activeElement?.getAttribute('aria-posinset')) === arguments[0]",
                    root_count,
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
                    status: row.dataset.areaStatus,
                    reason: row.getAttribute('aria-label'),
                    color: getComputedStyle(row).color
                }));
            """)
            assert any(row["unavailable"] for row in grouped_results), grouped_results
            assert any(not row["unavailable"] for row in grouped_results), grouped_results
            assert [row["unavailable"] for row in grouped_results] == sorted(row["unavailable"] for row in grouped_results)
            aggregate = next(row for row in grouped_results if row["id"] == 'abkh1243')
            assert not aggregate["unavailable"] and aggregate["status"] == 'Area available'
            for row in grouped_results:
                if row["unavailable"]:
                    assert row["status"] == 'No areas' and row["reason"]
                    assert row["color"] != aggregate["color"], "The whole unavailable row is muted"
            browser.screenshot(output / "search-area-groups.png")
            results["searchAreaGroups"] = grouped_results

            # Unmapped entries must remain discoverable, including by original-script aliases.
            results["unmappedLanguage"] = search(browser, "ache1244", "ache1244")
            assert results["unmappedLanguage"]["disabled"]
            assert "No area" in results["unmappedLanguage"]["text"]
            results["unmappedDialectAlias"] = search(browser, "上海", "shan1293")
            assert results["unmappedDialectAlias"]["disabled"]
            assert "dialect" in results["unmappedDialectAlias"]["label"]
            results["selectionGroups"] = check_selection(browser, output)
            results["comparisons"] = check_comparisons(browser, output)

            # Expanded details stays bounded and leaves room to browse on narrow screens.

            browser.call("POST", "/window/rect", {"width": 390, "height": 844})
            search(browser, "abkh1242", "abkh1242")
            browser.js("document.querySelector('.finder-options').open = false")
            open_details(browser)
            narrow = browser.js("""
                const panel = document.querySelector('.finder-detail');
                return {height: panel.clientHeight, width: innerWidth,
                    documentWidth: document.documentElement.scrollWidth,
                    listHeight: document.querySelector('.language-list').clientHeight,
                    visiblePanels: [...document.querySelectorAll('.language-panel')].filter(panel => !panel.hidden).length};
                """)
            assert 120 <= narrow["height"] <= 224 and narrow["visiblePanels"] == 1, narrow
            assert narrow["listHeight"] >= 88, narrow
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
