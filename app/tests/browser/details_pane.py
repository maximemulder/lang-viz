"""Check that atlas inspections use the optional details pane."""

from .run import APP, browser_session, open_atlas, wait_for
from .sidebar import open_details, search


def main():
    output = APP / "test-results/details-pane"
    with browser_session(output, dev=True) as (browser, origin):
        open_atlas(browser, origin)
        assert not browser.js("return !!document.querySelector('.geography-inspector')")

        search(browser, "stan1293", "stan1293")
        open_details(browser)
        assert browser.js("""
            const pane = document.querySelector('.geography-inspector');
            const details = document.querySelector('.finder-detail');
            const controls = document.querySelector('.geography-sidebar');
            return pane?.contains(details) && !controls.contains(details) &&
                document.querySelector('.language-list').clientHeight >= 88;
        """)

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
                !document.querySelector('.finder-detail__more')?.textContent.includes('Geography for the next Add to map') &&
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

        browser.js("document.querySelector('.map-area-controls__inspect button:last-child').click()")
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
        browser.screenshot(output / "area-details.png")
        assert browser.js("return document.querySelector('.administrative-results').clientHeight >= 80")

        # Follow area -> language -> family and check that the same header updates its identity.
        for label in ('language', 'family'):
            title = browser.js("""
                const button = arguments[0] === 'language'
                    ? [...document.querySelectorAll('.administrative-observation__top button')]
                        .find(button => button.querySelector('.administrative-code')?.textContent === 'ps')
                    : document.querySelector('.administrative-detail .administrative-link');
                const clone = button.cloneNode(true);
                clone.querySelector('.administrative-code')?.remove();
                button.click();
                return clone.textContent.trim();
            """, label)
            wait_for(
                lambda title=title: browser.js("""
                    const header = document.querySelector('.administrative-inspector-header');
                    return header?.querySelector('.details-header__title').textContent.trim() === arguments[0] &&
                        !header.querySelector('.details-header__eyebrow') &&
                        !header.querySelector('button[aria-expanded]');
                """, title),
                10,
                f"{label} identity in shared header",
            )
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
