"""Check that independent measurements detect deliberately misleading palettes."""

import copy
import unittest

from color_evaluation import evaluate_colors


def fixture(branches=2):
    ids = [f"b{i}" for i in range(branches)]
    order = ["root"] + [node for b in ids for node in (b, b+"a", b+"b")]
    children = {"root": ids, **{b: [b+"a", b+"b"] for b in ids}}
    parents = {child: parent for parent, values in children.items() for child in values}
    leaves = [b+suffix for b in ids for suffix in ("a", "b")]
    colors = {node: "#886688" for node in order}
    return {
        "topology": {"order": order, "parentById": list(parents.items()),
                     "childrenById": list(children.items())},
        "reference": {"rootById": [[node, "root"] for node in order],
                      "anchors": [["root", "#886688"]], "colors": list(colors.items())},
        "configuration": {"overrides": {}},
        "view": {"columns": 10, "rows": 10, "footprints": [
            {"id": node, "languageId": node, "cells": [i]} for i, node in enumerate(leaves)]},
    }, {"colors": colors, "anchors": {"root": "#886688"}}


class ColorEvaluationTests(unittest.TestCase):
    def test_flat_clades_remain_detectable_despite_leaf_variation(self):
        capture, palette = fixture(8)
        for i in range(8):
            palette["colors"][f"b{i}a"] = "#221122"
            palette["colors"][f"b{i}b"] = "#eebbee"
        family = evaluate_colors(capture, palette)["families"]["root"]
        self.assertGreater(family["spread"], .1)
        for scale in family["branches"][:3]:
            self.assertEqual(scale["branchCount"], 8)
            self.assertAlmostEqual(scale["meanContrast"], 0.)
            self.assertEqual(scale["weakPairMass"], 1.)
        self.assertGreater(family["branches"][-1]["meanContrast"], .1)

    def test_two_four_and_eight_major_branches(self):
        shades = ["#221122", "#443344", "#665566", "#887788",
                  "#aa99aa", "#bbaabb", "#ccbbcc", "#eeccee"]
        for count in (2, 4, 8):
            capture, palette = fixture(count)
            for i in range(count):
                for suffix in ("a", "b"):
                    palette["colors"][f"b{i}{suffix}"] = shades[i]
            scales = evaluate_colors(capture, palette)["families"]["root"]["branches"]
            for scale in scales:
                self.assertGreater(scale["meanContrast"], .025)
                self.assertEqual(scale["coverage"], 1.)

    def test_many_small_siblings_cannot_hide_the_dominant_branch_split(self):
        capture, palette = fixture(8)
        vertices = capture["view"]["footprints"]
        vertices[0]["cells"] = list(range(40))
        vertices[1]["cells"] = list(range(40, 80))
        for i, vertex in enumerate(vertices[2:]):
            vertex["cells"] = [80 + i]
        palette["colors"].update({"b0a": "#221122", "b0b": "#eeccee"})
        family = evaluate_colors(capture, palette)["families"]["root"]
        self.assertEqual(family["area"], 94)
        coarse = family["branches"][0]
        self.assertEqual(coarse["branchCount"], 9)
        self.assertGreater(coarse["meanContrast"], .1)

    def test_unary_wrappers_do_not_create_a_scale(self):
        capture, palette = fixture(4)
        expected = evaluate_colors(capture, palette)
        capture["topology"]["order"].insert(1, "wrapper")
        capture["topology"]["parentById"].append(["wrapper", "root"])
        capture["topology"]["parentById"] = [[c, "wrapper" if p == "root" and c != "wrapper" else p]
                                               for c, p in capture["topology"]["parentById"]]
        capture["topology"]["childrenById"] = [["root", ["wrapper"]], ["wrapper", [f"b{i}" for i in range(4)]]] + capture["topology"]["childrenById"][1:]
        capture["reference"]["rootById"].append(["wrapper", "root"])
        self.assertEqual(evaluate_colors(capture, palette), expected)

    def test_local_contacts_exclude_geographically_remote_extremes(self):
        capture, palette = fixture()
        capture["reference"]["rootById"] = [[node, node[:2]] for node, _ in capture["reference"]["rootById"]]
        palette["anchors"] = {"b0": "#ee2222", "b1": "#2222ee"}
        palette["colors"].update({"b0a": "#ee2222", "b0b": "#2222ee",
                                 "b1a": "#2222ee", "b1b": "#ee2222"})
        for i, vertex in enumerate(capture["view"]["footprints"]):
            vertex["cells"] = [i % 2]
        result = evaluate_colors(capture, palette)["contacts"]
        self.assertEqual(result["familyPairCount"], 1)
        self.assertEqual(result["meanShortfall"], 0.)
        self.assertEqual(result["severePairCount"], 0)
        palette["colors"]["b1a"] = "#ee2222"
        result = evaluate_colors(capture, palette)["contacts"]
        self.assertEqual(result["severePairCount"], 1)
        self.assertAlmostEqual(result["meanShortfall"], .5)

    def test_manual_entry_colors_affect_readability_but_are_exempt_from_coherence(self):
        capture, palette = fixture()
        baseline = evaluate_colors(capture, palette)["families"]["root"]
        capture["view"]["footprints"][0]["fixedColor"] = "#00ff00"
        result = evaluate_colors(capture, palette)["families"]["root"]
        self.assertEqual(result["spread"], baseline["spread"])
        self.assertGreater(result["branches"][0]["meanContrast"], 0.)
        capture["view"]["footprints"][0].pop("fixedColor")
        capture["configuration"]["overrides"]["b0a"] = "#00ff00"
        self.assertEqual(evaluate_colors(capture, palette)["families"]["root"], result)

    def test_duplicate_representations_do_not_invent_area(self):
        capture, palette = fixture()
        expected = evaluate_colors(capture, palette)
        duplicate = copy.deepcopy(capture["view"]["footprints"][0])
        duplicate["id"] += "-other-period"
        capture["view"]["footprints"].append(duplicate)
        self.assertEqual(evaluate_colors(capture, palette), expected)

    def test_displayed_ancestors_keep_their_area_when_clades_are_expanded(self):
        capture, palette = fixture()
        capture["view"]["footprints"].append({"id": "b0", "languageId": "b0", "cells": [40, 41, 42]})
        palette["colors"]["b0"] = "#00ff00"
        family = evaluate_colors(capture, palette)["families"]["root"]
        self.assertEqual(family["area"], 7)
        for scale in family["branches"]:
            self.assertAlmostEqual(scale["coverage"], 1.)
            self.assertGreater(scale["meanContrast"], .1)

    def test_reordering_and_empty_views(self):
        capture, palette = fixture()
        expected = evaluate_colors(capture, palette)
        capture["view"]["footprints"].reverse()
        self.assertEqual(evaluate_colors(capture, palette), expected)
        capture["view"]["footprints"] = []
        result = evaluate_colors(capture, palette)
        self.assertEqual(result["families"], {})
        self.assertEqual(result["contacts"]["meanShortfall"], 0.)

    def test_missing_colors_fail_instead_of_improving_by_omission(self):
        capture, palette = fixture()
        del palette["colors"]["b0a"]
        with self.assertRaises(KeyError):
            evaluate_colors(capture, palette)


if __name__ == "__main__":
    unittest.main()
