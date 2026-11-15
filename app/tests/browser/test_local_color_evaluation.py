"""Check experiment measurements without relying on the optimizer's graph."""

import copy

import pytest

from .local_evaluation import evaluate, prepare


def fixture(cells=([11], [12]), columns=10, rows=10):
    return {
        "reference": {"rootById": [("a", "family"), ("b", "family")]},
        "configuration": {"overrides": {}},
        "view": {
            "columns": columns,
            "rows": rows,
            "footprints": [
                {"id": name, "languageId": name, "cells": list(occupied)}
                for name, occupied in zip(("a", "b"), cells)
            ],
        },
    }, {"colors": {"a": "#009696", "b": "#009696"}}


def test_adjacent_relatives_are_measured_without_shared_cells():
    capture, palette = fixture()
    flat = evaluate(capture, palette)["within"]
    assert flat["contact"]["pairs"] == 0
    assert flat["near"]["pairs"] == 1
    assert flat["all"]["meanShortfall"] == 1
    palette["colors"]["b"] = "#ce5d1e"
    distinct = evaluate(capture, palette)["within"]
    assert distinct["all"]["meanShortfall"] == 0
    assert distinct["languageSevereFraction"] == 0


def test_remote_relatives_do_not_contribute():
    capture, palette = fixture(([0], [99]))
    assert evaluate(capture, palette)["within"]["all"]["pairs"] == 0


def test_larger_territories_have_a_larger_comparison_reach():
    capture, palette = fixture(([0], [3]))
    assert evaluate(capture, palette)["within"]["all"]["pairs"] == 0
    capture["view"]["footprints"][0]["cells"] = list(range(0, 100, 10))
    assert evaluate(capture, palette)["within"]["all"]["pairs"] == 1


def test_grid_rows_do_not_wrap_into_each_other():
    capture, palette = fixture(([9], [10]))
    assert evaluate(capture, palette)["within"]["all"]["pairs"] == 0


def test_small_enclaves_and_different_families_are_measured():
    capture, palette = fixture((list(range(100)), [44]))
    capture["reference"]["rootById"][1] = ("b", "other")
    report = evaluate(capture, palette)
    assert report["between"]["contact"]["pairs"] == 1
    assert report["between"]["languageSevereFraction"] == 1
    assert report["within"]["all"]["pairs"] == 0


def test_duplicates_and_input_order_do_not_invent_area_or_pairs():
    capture, palette = fixture(([11, 12], [12, 13]))
    palette["colors"]["a"] = "#ff00ff"
    expected = evaluate(capture, palette)
    duplicate = copy.deepcopy(capture["view"]["footprints"][0])
    duplicate["id"] += "-other-period"
    capture["view"]["footprints"].append(duplicate)
    capture["view"]["footprints"].reverse()
    assert evaluate(capture, palette) == expected


def test_fixed_colors_participate_in_contrast_but_not_aesthetic_cost():
    capture, palette = fixture()
    capture["view"]["footprints"][0]["fixedColor"] = "#ce5d1e"
    del palette["colors"]["a"]
    report = evaluate(capture, palette)
    assert report["within"]["all"]["meanShortfall"] == 0
    assert report["aesthetics"]["areaWeightedPenalty"] < 1e-10


def test_missing_automatic_colors_fail_explicitly():
    capture, palette = fixture()
    del palette["colors"]["a"]
    with pytest.raises(KeyError):
        evaluate(capture, palette)


def test_geometry_can_be_reused_and_empty_views_are_finite():
    capture, palette = fixture()
    assert evaluate(capture, palette) == evaluate(capture, palette, prepare(capture))
    capture["view"]["footprints"] = []
    report = evaluate(capture, palette)
    assert report["within"]["all"]["pairs"] == 0
    assert report["aesthetics"]["areaWeightedPenalty"] == 0
