"""Build the atlas's on-demand Word Trails data from the supplied DiACL exports.

No network or third-party Python packages required. Run from any directory.
"""
import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCHEMA_VERSION = 1


def build(source_dir: Path) -> dict:
    raw = json.loads((source_dir / 'lexical-database.json').read_text())
    tree = json.loads((source_dir / 'language-tree.json').read_text())
    paths = {}

    def walk(branch, path):
        node = branch['Node']
        trail = path + ([node['Label']] if node['Label'] != 'root' else [])
        if 'FkLanguageId' in node:
            paths[str(node['FkLanguageId'])] = trail
        for child in branch.get('Children', []):
            walk(child, trail)

    walk(tree['Root'], [])
    used = {str(word['FkLanguageId']) for word in raw['Lexemes'].values()}
    languages = {}
    for key in sorted(used, key=int):
        value = raw['Languages'][key]
        point = value.get('FocalPointWgs84', {})
        languages[key] = {
            'name': value['Name'], 'iso': value.get('ISO639-3') or '',
            'glottocode': value.get('Glottocode') or '',
            'lat': float(point['Latitude']) if point.get('Latitude') else None,
            'lon': float(point['Longitude']) if point.get('Longitude') else None,
            'status': raw['LanguageReliabilities'][str(value['FkLanguageReliabilityId'])],
            'time': value.get('TimeFrame', {}), 'path': paths.get(key, []),
            'family': paths[key][0] if key in paths else 'Unmapped in tree',
        }

    lexemes = {}
    for key, value in raw['Lexemes'].items():
        lexemes[key] = {
            'l': str(value['FkLanguageId']), 'f': value['FormTranscriptionPlain'],
            'm': value.get('Meaning', ''), 'note': value.get('LexemeNotePlain', ''),
            'meaningNote': value.get('MeaningNote', ''), 'grammar': value.get('GrammaticalData', ''),
            'ipa': value.get('FormIpa', ''), 'script': value.get('FormScript', ''),
            'refs': value['SourceReferences'],
            'stub': any(ref['FkSourceId'] == 999 for ref in value['SourceReferences'])
                    or languages[str(value['FkLanguageId'])]['name'].lower().startswith('stub'),
        }
    edges = [
        {'id': key, 'p': str(value['FkParentId']), 'c': str(value['FkChildId']),
         't': value['FkReliabilityId'], 'refs': value['SourceReferences'],
         'note': value.get('NotePlain', '')}
        for key, value in raw['Etymologies'].items()
    ]
    concepts, lists = {}, []
    for lid, listing in raw['WordLists'].items():
        lists.append({'id': lid, 'name': listing['Name']})
        for category in listing['WordListCategories'].values():
            for cid, item in category['WordListItems'].items():
                entry = concepts.setdefault(
                    cid, {'id': cid, 'name': item['Name'], 'groups': [], 'lexemes': []})
                entry['groups'].append({'list': lid, 'category': category['Name']})
                entry['lexemes'] = list(dict.fromkeys(
                    entry['lexemes'] + [str(i) for i in item.get('ConnectedLexemes', [])]))

    # Fail the build on broken joins rather than quietly drawing partial evidence.
    for edge in edges:
        assert edge['p'] in lexemes and edge['c'] in lexemes, f"Missing endpoint: {edge['id']}"
    for concept in concepts.values():
        assert all(key in lexemes for key in concept['lexemes']), f"Invalid concept: {concept['id']}"
    for record in [*lexemes.values(), *edges]:
        assert all(str(ref['FkSourceId']) in raw['Sources'] for ref in record['refs'])
    return {
        'schemaVersion': SCHEMA_VERSION, 'languages': languages, 'lexemes': lexemes,
        'edges': edges, 'concepts': concepts, 'lists': lists, 'sources': raw['Sources'],
        'types': {key: value['Name'] for key, value in raw['EtymologicalReliabilities'].items()},
        'meta': raw['MetaData'],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-dir', type=Path, default=ROOT / 'etymology/data')
    parser.add_argument('--output-dir', type=Path, default=ROOT / 'app/public/etymology')
    args = parser.parse_args()
    inputs = [args.source_dir / name for name in ('lexical-database.json', 'language-tree.json')]
    output = args.output_dir / 'word-trails.json'
    if output.exists() and output.stat().st_mtime > max(
            Path(__file__).stat().st_mtime, *(path.stat().st_mtime for path in inputs)):
        print('Word Trails data is up to date')
        return
    data = build(args.source_dir)
    args.output_dir.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')) + '\n')
    print(f"Word Trails: {len(data['lexemes']):,} words, {len(data['edges']):,} relationships, "
          f"{len(data['languages'])} languages → {output} ({output.stat().st_size / 1e6:.1f} MB)")


if __name__ == '__main__':
    main()
