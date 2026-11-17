"""Check the first Geography view renders the complete Asher Contemporary map."""

from .run import APP, browser_session, check_state, open_atlas, wait_for
from .sidebar import view


def main():
    output = APP / "test-results/default-map"
    output.mkdir(parents=True, exist_ok=True)
    with browser_session(output) as (browser, origin):
        open_atlas(browser, origin, preserve_default=True)
        entries = wait_for(
            lambda: browser.js("return window.overlapTest.mapEntryState()") or None,
            20,
            "default Asher map entries",
        )
        assert len(entries) > 5000
        assert all(
            entry["context"] == {"sources": ["asher2007world"], "period": "contemporary"}
            for entry in entries
        )
        state = browser.settled(60, fail_on_error=True)
        check_state(state, require_stripes=True)
        assert state["reports"][-1]["metrics"].get("precomputedTiles", 0) > 0
        browser.screenshot(output / "asher-contemporary.png")

        view(browser, "map")
        browser.js("document.querySelector('.on-map-actions button').click()")
        wait_for(
            lambda: not browser.js("return window.overlapTest.mapEntryState().length"),
            10,
            "cleared map",
        )
        assert not browser.js("return window.overlapTest.mapEntryState().length")
    print("Default Asher Contemporary map and Clear map passed", flush=True)


if __name__ == "__main__":
    main()
