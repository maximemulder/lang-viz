"""Check that atlas inspections use the optional details pane."""

from .run import APP, browser_session, open_atlas, wait_for
from .sidebar import open_details, search


def main():
    output = APP / "test-results/details-pane"
    with browser_session(output, dev=True) as (browser, origin):
        open_atlas(browser, origin)
        assert not browser.js("return !!document.querySelector('.geography-inspector')")

        search(browser, "stan1293", "stan1293")
        open_details(browser, expand=False)
        assert browser.js("""
            const toggles = [...document.querySelectorAll('.finder-detail .language-summary-section .sidebar-section__toggle')];
            return toggles.map(toggle => [toggle.querySelector('.sidebar-pane__title').textContent.trim(), toggle.getAttribute('aria-expanded')]);
        """) == [["Genealogy", "true"], ["Regions", "false"], ["Map", "false"], ["Features", "false"], ["Etymology", "false"]]
        assert not browser.js("return performance.getEntriesByType('resource').some(entry => entry.name.endsWith('/administrative/observations.json'))")
        browser.js("document.querySelector('.finder-detail .language-summary-section:nth-child(2) .sidebar-section__toggle').click()")
        wait_for(lambda: browser.js("return !!document.querySelector('.finder-detail .administrative-observations')"), 20, "lazy CLDR regions")
        assert browser.js("return document.querySelectorAll('.finder-detail .language-cldr-regions__code').length >= 2")
        browser.screenshot(output / "atlas-language-regions.png")
        browser.js("document.querySelector('.finder-detail .language-summary-section:nth-child(2) .sidebar-section__toggle').click()")
        browser.js("document.querySelector('.finder-detail .language-summary-section:nth-child(4) .sidebar-section__toggle').click()")
        browser.js("document.querySelector('.finder-detail__path button').click()")
        assert browser.js("""
            return document.querySelector('.finder-detail .language-summary-section:nth-child(4) .sidebar-section__toggle').getAttribute('aria-expanded') === 'true' &&
                document.querySelector('.finder-detail .language-summary-section:nth-child(2) .sidebar-section__toggle').getAttribute('aria-expanded') === 'false';
        """), "Language changes retain disclosure preferences"
        open_details(browser, expand=False)
        assert browser.js("""
            const pane = document.querySelector('.geography-inspector');
            const details = document.querySelector('.finder-detail');
            const controls = document.querySelector('.geography-sidebar');
            return pane?.contains(details) && !controls.contains(details) &&
                document.querySelector('.language-list').clientHeight >= 88 &&
                Math.abs(pane.getBoundingClientRect().width - controls.getBoundingClientRect().width) < 1;
        """)
        assert browser.js("return !!document.querySelector('[aria-label=\"Show details over language controls\"]')")
        browser.js("document.querySelector('[aria-label=\"Show details over language controls\"]').click()")
        assert browser.js("""
            const pane = document.querySelector('.geography-inspector').getBoundingClientRect();
            const controls = document.querySelector('.geography-sidebar').getBoundingClientRect();
            return document.querySelector('.geography-sidebar').inert &&
                Math.abs(pane.left - controls.left) < 1 &&
                Math.abs(pane.width - controls.width) < 1;
        """), "Search summary can cover the same-width sidebar"
        browser.js("document.querySelector('[aria-label=\"Show language controls beside details\"]').click()")

        def header_style(selector):
            return browser.js("""
                const header = document.querySelector(arguments[0]);
                const close = header.querySelector('.details-header__icon[title]');
                const style = getComputedStyle(close);
                const title = getComputedStyle(header.querySelector('.details-header__title'));
                return {
                    icon: !!close.querySelector('svg'),
                    label: !!close.getAttribute('aria-label'),
                    width: style.width, height: style.height,
                    padding: style.padding, border: style.border,
                    color: style.color, background: style.backgroundColor,
                    headerPadding: getComputedStyle(header).padding,
                    font: title.fontFamily, fontSize: title.fontSize,
                };
            """, selector)

        language_style = header_style('.finder-detail .details-header')
        assert language_style['icon'] and language_style['label']
        assert browser.js("""
            const header = document.querySelector('.finder-detail .details-header');
            return header.querySelector('.details-header__title').textContent.trim() === 'English' &&
                !header.querySelector('.details-header__eyebrow') &&
                !header.querySelector('.details-header__title button') &&
                !header.querySelector('button[aria-expanded]') &&
                !document.querySelector('.finder-detail .details-map-action') &&
                !document.querySelector('.finder-detail .detail-selection') &&
                !document.querySelector('.finder-detail__context') &&
                !document.querySelector('.finder-detail [aria-label="Change sources and period"]') &&
                !document.querySelector('.finder-detail')?.textContent.includes('Geography for the next Add to map') &&
                !document.querySelector('#focused-language-body').hidden;
        """)

        wait_for(
            lambda: browser.js(
                "return !!document.querySelector('.wals-card .wals-highlight-action')"
            ),
            30,
            "recorded feature",
        )
        browser.js("document.querySelector('.wals-card .wals-highlight-action').click()")
        wait_for(
            lambda: browser.js(
                "return document.querySelector('.geography-inspector')?.contains(document.querySelector('.wals-map-summary'))"
            ),
            20,
            "feature summary in details pane",
        )
        assert header_style('.wals-map-summary .details-header') == language_style
        assert browser.js("return !document.querySelector('.geography-inspector .details-header button[aria-expanded]')")
        browser.screenshot(output / "feature-details.png")
        browser.js("document.querySelector('.finder-detail__close').click()")
        assert browser.js("return !!document.querySelector('.wals-map-summary')")
        browser.js("document.querySelector('.wals-summary-close').click()")
        wait_for(
            lambda: browser.js("return !document.querySelector('.geography-inspector')"),
            10,
            "details pane closes",
        )

        browser.js("document.querySelector('.map-region-controls__inspect button:last-child').click()")
        wait_for(
            lambda: browser.js("return !!document.querySelector('.administrative-results button')"),
            30,
            "administrative results",
        )
        browser.js("document.querySelector('.administrative-results button').click()")
        wait_for(
            lambda: browser.js(
                "return document.querySelector('.geography-inspector')?.contains(document.querySelector('.administrative-detail'))"
            ),
            10,
            "administrative details pane",
        )
        assert header_style('.administrative-inspector-header') == language_style
        assert browser.js("""
            const selected = document.querySelector('.administrative-results button[aria-current=true]');
            const label = selected.cloneNode(true);
            label.querySelector('.administrative-code').remove();
            const header = document.querySelector('.administrative-inspector-header');
            const action = document.querySelector('.administrative-detail-scroll .details-map-action__button');
            return header.querySelector('.details-header__title').textContent === label.textContent.trim() &&
                !header.querySelector('.details-header__eyebrow') &&
                !document.querySelector('.administrative-detail h3') &&
                !header.contains(action) &&
                action.getBoundingClientRect().top >= header.getBoundingClientRect().bottom &&
                action.textContent.trim() === 'Focus on map';
        """)
        browser.screenshot(output / "region-details.png")
        assert browser.js("return document.querySelector('.administrative-results').clientHeight >= 80")

        # CLDR language selection uses the same panel and atlas content.
        browser.js("""
            [...document.querySelectorAll('.administrative-observation__top button')]
                .find(button => button.querySelector('.administrative-code')?.textContent === 'ps').click();
        """)
        wait_for(lambda: browser.js("return !!document.querySelector('.geography-inspector .finder-detail')"), 10, "shared language panel")
        assert browser.js("return !!document.querySelector('[aria-label=\"Show details over region controls\"]')")
        browser.js("document.querySelector('[aria-label=\"Show details over region controls\"]').click()")
        assert browser.js("return document.querySelector('.geography-sidebar').inert"), "CLDR summary can cover the region sidebar"
        browser.js("document.querySelector('[aria-label=\"Show region controls beside details\"]').click()")
        assert browser.js("""
            const sections = [...document.querySelectorAll('.finder-detail .language-summary-section')];
            return sections.length === 5 &&
                sections[1].querySelector('.sidebar-section__toggle').getAttribute('aria-expanded') === 'true' &&
                !!sections[1].querySelector('.administrative-observations') &&
                !!sections[3].querySelector('.wals-panel');
        """), "CLDR language uses atlas language panel with CLDR regions"
        browser.js("document.querySelector('.finder-detail .language-summary-section:nth-child(5) .sidebar-section__toggle').click()")
        assert browser.js("return !!document.querySelector('.finder-detail .language-word-entries')")
        browser.screenshot(output / "administrative-language-details.png")
        browser.js("document.querySelector('.finder-detail .language-summary-section:nth-child(2) .sidebar-section__toggle').click()")
        browser.js("document.querySelectorAll('.map-region-controls__inspect button')[0].click()")
        browser.js("document.querySelectorAll('.map-region-controls__inspect button')[1].click()")
        wait_for(
            lambda: browser.js("return document.querySelector('.finder-detail .language-summary-section:nth-child(2) .sidebar-section__toggle')?.getAttribute('aria-expanded') === 'true'"),
            10,
            "Regions reopens on entering the administrative view",
        )
        browser.js("document.querySelector('#administrative-tab-language').click()")
        browser.js("""
            const input = document.querySelector('.administrative-search-field input');
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'stan1293');
            input.dispatchEvent(new Event('input', {bubbles:true}));
        """)
        wait_for(lambda: browser.js("return [...document.querySelectorAll('.administrative-results button')].some(button => button.querySelector('.administrative-code')?.textContent === 'en')"), 10, "English CLDR result")
        browser.js("[...document.querySelectorAll('.administrative-results button')].find(button => button.querySelector('.administrative-code')?.textContent === 'en').click()")
        wait_for(lambda: browser.js("return document.querySelector('.finder-detail .details-header__title')?.textContent === 'English' && !!document.querySelector('.finder-detail .wals-card')"), 30, "English atlas features from CLDR")
        assert browser.js("return !!document.querySelector('.finder-detail .language-word-entries')")
        browser.js("document.querySelector('#administrative-tab-territory').click()")
        browser.js("document.querySelector('.administrative-results button').click()")
        browser.js("document.querySelector('.administrative-inspector-header button').click()")
        wait_for(
            lambda: browser.js("return !document.querySelector('.geography-inspector')"),
            10,
            "administrative details close",
        )
        assert browser.js(
            "return document.activeElement?.matches('.administrative-results button')"
        )
        assert not browser.snapshot()["errors"]
    print("Details pane browser checks passed.")


if __name__ == "__main__":
    main()
