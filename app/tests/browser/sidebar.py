"""Shared sidebar actions; scenario assertions belong in the browser suites."""

from run import wait_for


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


def select_branches(browser, source, center, zoom=4.5, *, settle=True):
    browser.js(
        "window.overlapTest.configure({languageIds:[],center:arguments[0],zoom:arguments[1]})",
        center, zoom,
    )
    browser.js("""
        document.querySelector('.finder-options').open = true;
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
        "cleared source filter",
    )
    browser.js("""
        [...document.querySelectorAll('.source-filter__option')]
          .find(label => label.querySelector('strong').textContent === arguments[0])
          .querySelector('input').click();
        document.querySelector('.source-filter__trigger').click();
    """, source)
    button = """
        [...document.querySelectorAll('.finder-actions button')]
          .find(button => button.textContent.startsWith('Show branches on map'))
    """
    wait_for(
        lambda: browser.js(f"return !({button}).disabled"), 10, "mapped-branch action"
    )
    browser.js(f"({button}).click()")
    return browser.settled(100) if settle else None
