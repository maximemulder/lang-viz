"""Check dataset view browsing and full coverage through the sidebar."""

import json

from .run import APP, browser_session, open_atlas, wait_for
from .sidebar import add_selected, open_details, search, select_control, select_result, sources


def click(browser, selector):
    x, y = browser.js("""
        const control = document.querySelector(arguments[0]);
        control.scrollIntoView({block: 'center'});
        const box = control.getBoundingClientRect();
        const x = Math.round(box.left + box.width / 2);
        const y = Math.round(box.top + box.height / 2);
        if (document.elementFromPoint(x, y) !== control) {
            throw new Error('Dataset action is clipped: ' + arguments[0]);
        }
        return [x, y];
    """, selector)
    browser.call("POST", "/actions", {"actions": [{
        "type": "pointer", "id": "dataset-mouse", "parameters": {"pointerType": "mouse"},
        "actions": [
            {"type": "pointerMove", "duration": 0, "origin": "viewport", "x": x, "y": y},
            {"type": "pointerDown", "button": 0},
            {"type": "pointerUp", "button": 0},
        ],
    }]})
    browser.call("DELETE", "/actions")


def main():
    output = APP / "test-results/geography-sources"
    variants = json.loads((APP / "public/data/geometry-index.json").read_text())
    expected: dict[tuple[str, str], set[str]] = {}
    for variant in variants:
        key = (variant["datasetId"], variant["temporalCoverage"]["viewId"])
        expected.setdefault(key, set()).add(variant["id"])

    with browser_session(output) as (browser, origin):
        open_atlas(browser, origin)
        browser.js('window.overlapTest.configure({languageIds:[],center:[108,32],zoom:3})')
        search(browser, "stan1295", "stan1295")
        select_result(browser, "stan1295")
        for label, value in (("Coverage", "own"), ("Coloring", "uniform")):
            select_control(browser, f'[aria-label="{label} for selected entries"]', value)
        add_selected(browser)

        def entries():
            return browser.js("return window.overlapTest.mapEntryState()")

        previous = entries()
        assert len(previous) == 1 and previous[0]["group"]["coloring"] == "uniform"
        browser.js("document.querySelector('.finder-options').open=true")
        rows = browser.js("""
            return [...document.querySelectorAll('.geography-sources__row')].map(row =>
                [row.dataset.datasetId, row.dataset.viewId, row.querySelector('button').textContent.trim()]
            );
        """)
        assert len(rows) == len(expected)
        assert {(dataset, period) for dataset, period, show in rows if show == "Show"} == set(expected)

        def action(dataset, period, name):
            return f'[data-dataset-id="{dataset}"][data-view-id="{period}"] .geography-sources__{name}'

        def checked_views():
            return browser.js("""
                return [...document.querySelectorAll('.geography-sources input:checked')].map(input => {
                    const row = input.closest('.geography-sources__row');
                    return [row.dataset.datasetId, row.dataset.viewId];
                });
            """)

        asher_browse = action("asher2007world", "contemporary", "browse")
        dlac_browse = action("dlac1987china", "contemporary", "browse")
        assert checked_views() == [["asher2007world", "contemporary"]]
        for width, height in ((1440, 1000), (1440, 600), (520, 760)):
            browser.call("POST", "/window/rect", {"width": width, "height": height})
            if height == 1000:
                assert browser.js("""
                    const controls = document.querySelector('.explore-controls');
                    return controls.scrollHeight <= controls.clientHeight + 1;
                """), "All dataset rows should fit at desktop height"
            click(browser, dlac_browse)
            assert checked_views() == [["dlac1987china", "contemporary"]]
            assert entries() == previous
            click(browser, dlac_browse)
            assert not checked_views()
            assert browser.js("return document.querySelector('.finder-options summary').textContent.includes('Browsing any dataset')")
            click(browser, asher_browse)
            assert checked_views() == [["asher2007world", "contemporary"]]
            assert entries() == previous
            browser.screenshot(output / f"sources-{width}-{height}.png")

        def show(dataset, period):
            click(browser, action(dataset, period, "show"))
            shown = entries()
            assert {variant_id for entry in shown for variant_id in entry["variantIds"]} == expected[(dataset, period)]
            assert all(entry["context"] == {"sources": [dataset], "period": period} for entry in shown)
            assert all(entry["group"]["coverage"] == "branch" and entry["group"]["coloring"] == "hierarchy" for entry in shown)
            assert checked_views() == [[dataset, period]]

        show("dlac1987china", "contemporary")
        show("dlac1987china", "contemporary")
        browser.settled(60, fail_on_error=True)
        assert browser.js("return window.overlapTest.inspect([108,32]).variantIds.length > 0")
        assert browser.js("""
            return document.querySelector('#explore-search input').value === 'stan1295' &&
                document.querySelector('.finder-bulk').textContent.includes('1 selected') &&
                document.querySelector('[aria-label="Coverage for selected entries"]').value === 'own' &&
                document.querySelector('[aria-label="Coloring for selected entries"]').value === 'uniform';
        """)
        browser.call("POST", "/window/rect", {"width": 1440, "height": 1000})
        sources(browser, "Asher")
        open_details(browser, expand=False)
        browser.js("document.querySelector('.details-map-action__button').click()")
        wait_for(lambda: browser.js("return !!document.querySelector('.map-isolation')"), 10, "language isolation")
        show("asher2007world", "time-of-contact")
        assert not browser.js("return !!document.querySelector('.map-isolation')")
    print("Geographic dataset rows, full coverage, and browsing passed", flush=True)


if __name__ == "__main__":
    main()
