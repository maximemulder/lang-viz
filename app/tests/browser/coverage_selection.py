#!/usr/bin/env python3
"""Coverage continuity observes the selected revision across period replacements."""

import argparse
import json
from pathlib import Path

from run import APP, SCENARIOS, browser_session, check_state, open_atlas


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output", type=Path, default=APP / "test-results/etymology-04/coverage-selection"
    )
    args = parser.parse_args()
    report = {"passed": False, "periods": []}
    with browser_session(args.output) as (browser, origin):
        open_atlas(browser, origin)
        try:
            for period in ["contemporary", "time-of-contact"] * 4:
                browser.js(
                    "window.overlapTest.configure(arguments[0])", {**SCENARIOS[0], "period": period}
                )
                state = browser.settled(60, fail_on_error=True)
                check_state(state)
                report["periods"].append(
                    {"period": period, "blankFrames": state["blankLayerFrames"]}
                )
            before = len(browser.snapshot()["reports"])
            browser.js("window.overlapTest.recompute()")
            state = browser.terminal(before, 60)
            check_state(state)
            report["recomputationBlankFrames"] = state["blankLayerFrames"]
            report["passed"] = True
        except Exception as error:
            report["error"] = str(error)
            report["failure"] = browser.snapshot()
            raise
        finally:
            (args.output / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    print(
        "Eight selection/period transitions and unchanged-selection recomputation passed",
        flush=True,
    )


if __name__ == "__main__":
    main()
