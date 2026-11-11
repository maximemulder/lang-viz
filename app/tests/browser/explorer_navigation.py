#!/usr/bin/env python3
"""Exercise the real session/URL adapter in Firefox with synthetic lexical data."""

import argparse
import json
from pathlib import Path

from run import APP, browser_session, wait_for


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=APP / "test-results/explorer-navigation")
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    report = {"passed": False, "serving": "development", "data": "synthetic", "checks": []}
    with browser_session(args.output, dev=True) as (browser, origin):
        report["browser"] = browser.capabilities
        url = origin + "/tests/browser/explorer-navigation.html?probe=1"

        def snapshot():
            return browser.js("return window.explorerNavigationTest.snapshot()")

        def ready():
            wait_for(lambda: browser.js("return !!window.explorerNavigationTest"), 20, "fixture")

        def send(action):
            browser.js("window.explorerNavigationTest.dispatch(arguments[0])", action)

        def check(name):
            state = snapshot()
            assert "?probe=1" in state["href"], "Adapter replaced the host query string"
            report["checks"].append({"name": name, "snapshot": state})
            return state

        try:
            browser.call("POST", "/url", {"url": url + "#word=69562&view=history"})
            ready()
            state = check("legacy direct link")
            assert state["route"]["word"] == "69562"
            assert state["route"]["workspace"] == "etymology"
            assert "workspace=etymology" in state["href"]

            for action in [
                {"type": "trail-options", "depth": 6, "branches": False, "placeholders": True},
                {"type": "expand", "id": "69421"},
                {"type": "select", "selection": {"kind": "edge", "id": "1"}},
                {"type": "comparison", "conceptId": "1001", "collectionId": "1"},
                {"type": "comparison-filter", "family": "Family", "includeMissing": True},
                {"type": "search", "query": "saved", "languageId": "41500"},
            ]:
                send(action)
            before = snapshot()
            send({"type": "workspace", "workspace": "geography"})
            geography = check("Geography URL")
            assert "workspace=geography" in geography["href"]
            send({"type": "workspace", "workspace": "etymology"})
            after = check("customized workspace round trip")
            for field in ("trail", "selection", "comparison", "search"):
                assert after["session"][field] == before["session"][field], field
            assert after["resolved"]["conceptId"] == "1001"
            browser.screenshot(args.output / "customized-session.png")

            browser.call("POST", "/back", {})
            wait_for(lambda: snapshot()["route"]["workspace"] == "geography", 10, "Back")
            check("native Back")
            browser.call("POST", "/forward", {})
            wait_for(lambda: snapshot()["route"]["workspace"] == "etymology", 10, "Forward")
            assert check("native Forward")["resolved"]["conceptId"] == "1001"

            send({"type": "show-trail"})
            state = check("shared graph and map trail")
            assert state["graphIds"] == state["overlayIds"]
            send({"type": "trace", "id": "38213"})
            state = check("overlay follows new trace")
            assert state["graphIds"] == state["overlayIds"] == ["38213"]
            assert state["session"]["overlay"]["focusRequest"] is None

            browser.js(
                "window.location.hash = '#word=69562&view=family&concept=1001&collection=1';"
                "window.explorerNavigationTest.dispatch({type:'search',query:'edit before hash event'});"
            )
            wait_for(lambda: snapshot()["route"]["word"] == "69562", 10, "hash change")
            state = check("live legacy hash change")
            assert state["resolved"]["conceptId"] == "1001"
            send({"type": "workspace", "workspace": "geography"})
            browser.call("POST", "/refresh", {})
            ready()
            state = check("refresh preserves Geography and comparison URL")
            assert state["route"]["workspace"] == "geography"
            assert state["route"]["word"] == "69562"
            assert state["resolved"]["conceptId"] == "1001"
            assert not state["session"]["overlay"]["enabled"]
            assert state["session"]["trail"]["depth"] == 4  # unencoded session defaults on reload

            browser.js("window.location.hash = '#word=1&word=2&view=family'")
            wait_for(lambda: bool(snapshot()["routeIssues"]), 10, "invalid hash diagnostic")
            state = check("malformed link")
            assert state["route"]["word"] is None
            assert "Repeated URL parameter: word" in state["routeIssues"]

            browser.js(
                "window.location.hash = '#word=9999&concept=8888&collection=7777&view=family'"
            )
            wait_for(lambda: snapshot()["route"]["word"] == "9999", 10, "unknown word")
            state = check("unknown IDs are retained")
            assert "Unknown word: 9999" in state["resolved"]["issues"]
            assert state["resolved"]["conceptId"] == "8888"
            browser.screenshot(args.output / "unknown-ids.png")
            report["passed"] = True
        except Exception as error:
            report["error"] = str(error)
            browser.screenshot(args.output / "failure.png")
            raise
        finally:
            (args.output / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    print(
        f"Passed {len(report['checks'])} navigation checkpoints. Report: {args.output / 'report.json'}"
    )


if __name__ == "__main__":
    main()
