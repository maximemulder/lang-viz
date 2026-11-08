#!/usr/bin/env python3
"""Check source-defined entries against the production catalog and vector archive."""

import json

from run import APP, browser_session, open_atlas, wait_for
from sidebar import open_details, search, view


def main():
    output = APP / "test-results/source-languoids"
    output.mkdir(parents=True, exist_ok=True)
    results = {}
    cases = [
        ("tibeto-burman", "Tibeto-Burman Languages", [91, 32], 4.5),
        ("shaozhou-tuhua", "Shaozhou Tuhua", [112.3, 25.8], 6),
        ("danzhou", "Danzhou Dialect (Unclassified)", [109.1, 19.6], 7),
    ]
    with browser_session(output) as (browser, origin):
        open_atlas(browser, origin)
        try:
            wait_for(
                lambda: browser.js("return !!document.querySelector('.source-filter__trigger')"),
                15,
                "catalog controls",
            )
            browser.js("""
                document.querySelector('.finder-options').open = true;
                document.querySelector('.source-filter__trigger').click();
            """)
            browser.js("""
                [...document.querySelectorAll('.source-filter__actions button')]
                    .find(button => button.textContent === 'Clear').click();
            """)
            browser.js("""
                [...document.querySelectorAll('.source-filter__option')]
                    .find(label => label.querySelector('strong').textContent === 'DLAC')
                    .querySelector('input').click();
                document.querySelector('.source-filter__trigger').click();
            """)
            for slug, label, center, zoom in cases:
                language_id = f"dlac1987china:{slug}"
                variant_id = f"dlac1987china:contemporary:{language_id}"
                row = search(browser, label, language_id)
                assert not row["disabled"] and "source-defined" in row["text"], row
                search(browser, language_id.upper(), language_id)
                open_details(browser)
                details = browser.js("return document.querySelector('.finder-detail').textContent")
                assert "Source-defined entry" in details and "No matched Glottocode" in details
                assert "Digital Language Atlas of China" in details and label in details
                ancestors = browser.js(
                    "return [...document.querySelectorAll('.finder-detail__path button')].map(button => button.textContent.replace('›', '').trim())"
                )
                assert ancestors == (
                    ["Sino-Tibetan"] if slug == "tibeto-burman" else ["Sino-Tibetan", "Sinitic"]
                )
                browser.js("document.querySelector('.finder-detail__reveal').click()")
                placement = wait_for(
                    lambda current_id=language_id: browser.js(
                        """
                        const row = [...document.querySelectorAll('.language-row')]
                            .find(row => row.dataset.languageId === arguments[0]);
                        return row && {level: row.getAttribute('aria-level'), key: row.dataset.treeKey};
                    """,
                        current_id,
                    ),
                    10,
                    "source entry in its family",
                )
                path = "sino1245/" if slug == "tibeto-burman" else "sino1245/sini1245/"
                assert placement == {
                    "level": "2" if slug == "tibeto-burman" else "3",
                    "key": path + language_id,
                }
                search(browser, language_id, language_id)
                browser.js("document.querySelector('.language-row input').click()")
                browser.js("window.overlapTest.camera(arguments[0], arguments[1])", center, zoom)
                state = wait_for(
                    lambda: (
                        state
                        if (state := browser.snapshot())["mapLoaded"]
                        and state["tilesLoaded"]
                        and not state["moving"]
                        and state["selectedCount"] == 1
                        else None
                    ),
                    45,
                    "displayed source area",
                )
                assert state["selectedCount"] == 1 and not state["errors"]
                entries = browser.js("return window.overlapTest.mapEntryState()")
                assert entries[0]["languageId"] == language_id
                assert entries[0]["variantIds"] == [variant_id]
                assert entries[0]["colorRootId"] is None
                probe = browser.js(
                    """
                    for (let x = -4; x <= 4; x++) for (let y = -4; y <= 4; y++) {
                        const center = [arguments[0][0] + x * 0.08, arguments[0][1] + y * 0.08];
                        const hit = window.overlapTest.inspect(center);
                        if (hit.variantIds.includes(arguments[1])) return hit;
                    }
                    return null;
                """,
                    center,
                    variant_id,
                )
                assert probe, f"No displayed source area for {language_id}"
                x, y = probe["point"]
                browser.call(
                    "POST",
                    "/actions",
                    {
                        "actions": [
                            {
                                "type": "pointer",
                                "id": "source-mouse",
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
                popup = wait_for(
                    lambda: browser.js(
                        "return document.querySelector('.language-inspector')?.textContent"
                    ),
                    10,
                    "source map inspection",
                )
                assert "Source-defined entry" in popup and "no matched Glottocode" in popup
                browser.call("DELETE", "/actions")
                browser.js("document.querySelector('.language-inspector__details').click()")
                wait_for(
                    lambda: browser.js(
                        "return !!document.querySelector('.finder-detail__classification')"
                    ),
                    10,
                    "source details from map",
                )
                browser.screenshot(output / f"{slug}.png")
                browser.js(
                    "document.querySelector('.map-entry-card__actions button:last-child').click()"
                )
                wait_for(
                    lambda: browser.snapshot()["selectedCount"] == 0, 10, "remove source entry"
                )
                results[slug] = {"row": row, "details": details, "inspection": probe}
                print(
                    f"{label}: search, family placement, selection, map inspection and removal passed",
                    flush=True,
                )

            search(browser, "danzhou", "dlac1987china:danzhou")
            browser.js("""
                document.querySelector('.finder-options').open = true;
                const select = document.querySelector('.finder-filters__period select');
                select.value = 'year-1750';
                select.dispatchEvent(new Event('change', {bubbles:true}));
            """)
            wait_for(
                lambda: browser.js("return document.querySelector('.language-row input').disabled"),
                10,
                "source hidden by period",
            )
            browser.js("""
                const select = document.querySelector('.finder-filters__period select');
                select.value = 'contemporary';
                select.dispatchEvent(new Event('change', {bubbles:true}));
            """)
            wait_for(
                lambda: browser.js(
                    "return !document.querySelector('.language-row input').disabled"
                ),
                10,
                "source period restored",
            )
            browser.js("document.querySelector('.source-filter__trigger').click()")
            browser.js("""
                [...document.querySelectorAll('.source-filter__option')]
                    .find(label => label.querySelector('strong').textContent === 'DLAC')
                    .querySelector('input').click();
            """)
            wait_for(
                lambda: browser.js("return document.querySelector('.language-row input').disabled"),
                10,
                "source hidden by dataset",
            )
            results["filters"] = "period and dataset filters passed"
            view(browser, "explore")
        except Exception:
            results["failureSnapshot"] = browser.snapshot()
            browser.screenshot(output / "failure.png")
            raise
        finally:
            (output / "report.json").write_text(json.dumps(results, indent=2) + "\n")
    print(f"Source-defined browser checks passed: {output / 'report.json'}")


if __name__ == "__main__":
    main()
