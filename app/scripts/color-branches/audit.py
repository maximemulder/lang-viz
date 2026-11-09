"""Check branch preservation using the independent topology-based evaluator."""
import json
import sys
from pathlib import Path


def audit(directory):
    evaluation = json.loads((directory / 'evaluation.json').read_text())
    result = {}
    for scene, variants in evaluation.items():
        baseline = variants['baseline']['existing']['families']
        for variant in ('branches', 'branches-no-aesthetic'):
            measured = variants[variant]['existing']['families']
            checked, regressions = 0, []
            for family, before in baseline.items():
                for old, new in zip(before['branches'], measured[family]['branches']):
                    previous = old['minimumSignificantContrast']
                    if previous is None:
                        continue
                    checked += 1
                    floor = min(.025, previous) * .98
                    if new['minimumSignificantContrast'] < floor - 1e-6:
                        regressions.append({'family': family, 'scale': old['divisions'],
                                            'before': previous, 'after': new['minimumSignificantContrast']})
            result[f'{scene}/{variant}'] = {'familyScales': checked, 'regressions': regressions}
    (directory / 'branch-audit.json').write_text(json.dumps(result, indent=2))
    print(json.dumps(result, indent=2))
    assert not any(item['regressions'] for item in result.values()), 'Independent branch guard regression'


if __name__ == '__main__':
    audit(Path(sys.argv[1]))
