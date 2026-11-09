"""Check experiment measurements without relying on the optimizer's graph."""
import copy
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'scripts/color-refinement'))
from local_evaluation import evaluate, prepare


def fixture(cells=([11], [12]), columns=10, rows=10):
    return {
        'reference': {'rootById': [('a', 'family'), ('b', 'family')]},
        'configuration': {'overrides': {}},
        'view': {'columns': columns, 'rows': rows, 'footprints': [
            {'id': name, 'languageId': name, 'cells': list(occupied)}
            for name, occupied in zip(('a', 'b'), cells)]},
    }, {'colors': {'a': '#009696', 'b': '#009696'}}


class LocalColorEvaluationTests(unittest.TestCase):
    def test_adjacent_relatives_are_measured_without_shared_cells(self):
        capture, palette = fixture()
        flat = evaluate(capture, palette)['within']
        self.assertEqual(flat['contact']['pairs'], 0)
        self.assertEqual(flat['near']['pairs'], 1)
        self.assertEqual(flat['all']['meanShortfall'], 1)
        palette['colors']['b'] = '#ce5d1e'
        distinct = evaluate(capture, palette)['within']
        self.assertEqual(distinct['all']['meanShortfall'], 0)
        self.assertEqual(distinct['languageSevereFraction'], 0)

    def test_remote_relatives_do_not_contribute(self):
        capture, palette = fixture(([0], [99]))
        self.assertEqual(evaluate(capture, palette)['within']['all']['pairs'], 0)

    def test_larger_territories_have_a_larger_comparison_reach(self):
        capture, palette = fixture(([0], [3]))
        self.assertEqual(evaluate(capture, palette)['within']['all']['pairs'], 0)
        capture['view']['footprints'][0]['cells'] = list(range(0, 100, 10))
        self.assertEqual(evaluate(capture, palette)['within']['all']['pairs'], 1)

    def test_grid_rows_do_not_wrap_into_each_other(self):
        capture, palette = fixture(([9], [10]))
        self.assertEqual(evaluate(capture, palette)['within']['all']['pairs'], 0)

    def test_small_enclaves_and_different_families_are_measured(self):
        capture, palette = fixture((list(range(100)), [44]))
        capture['reference']['rootById'][1] = ('b', 'other')
        report = evaluate(capture, palette)
        self.assertEqual(report['between']['contact']['pairs'], 1)
        self.assertEqual(report['between']['languageSevereFraction'], 1)
        self.assertEqual(report['within']['all']['pairs'], 0)

    def test_duplicates_and_input_order_do_not_invent_area_or_pairs(self):
        capture, palette = fixture(([11, 12], [12, 13]))
        palette['colors']['a'] = '#ff00ff'
        expected = evaluate(capture, palette)
        duplicate = copy.deepcopy(capture['view']['footprints'][0])
        duplicate['id'] += '-other-period'
        capture['view']['footprints'].append(duplicate)
        capture['view']['footprints'].reverse()
        self.assertEqual(evaluate(capture, palette), expected)

    def test_fixed_colors_participate_in_contrast_but_not_aesthetic_cost(self):
        capture, palette = fixture()
        capture['view']['footprints'][0]['fixedColor'] = '#ce5d1e'
        del palette['colors']['a']
        report = evaluate(capture, palette)
        self.assertEqual(report['within']['all']['meanShortfall'], 0)
        self.assertLess(report['aesthetics']['areaWeightedPenalty'], 1e-10)

    def test_missing_automatic_colors_fail_explicitly(self):
        capture, palette = fixture()
        del palette['colors']['a']
        with self.assertRaises(KeyError):
            evaluate(capture, palette)

    def test_geometry_can_be_reused_and_empty_views_are_finite(self):
        capture, palette = fixture()
        self.assertEqual(evaluate(capture, palette), evaluate(capture, palette, prepare(capture)))
        capture['view']['footprints'] = []
        report = evaluate(capture, palette)
        self.assertEqual(report['within']['all']['pairs'], 0)
        self.assertEqual(report['aesthetics']['areaWeightedPenalty'], 0)


if __name__ == '__main__':
    unittest.main()
