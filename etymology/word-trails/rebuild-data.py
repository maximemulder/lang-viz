"""Rebuild the prototype's browser data from the supplied DiACL exports."""
import json
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent
EXTRAS = ROOT.parent / 'data'
LEXICAL = EXTRAS / 'lexical-database.json'
raw = json.loads(LEXICAL.read_text())
tree = json.loads((EXTRAS / 'language-tree.json').read_text())
paths = {}

def walk(branch, path):
    node = branch['Node']
    label = node['Label']
    trail = path + ([label] if label != 'root' else [])
    if 'FkLanguageId' in node:
        paths[str(node['FkLanguageId'])] = trail
    for child in branch.get('Children', []):
        walk(child, trail)

walk(tree['Root'], [])
used = {str(v['FkLanguageId']) for v in raw['Lexemes'].values()}
languages = {}
for key in sorted(used, key=int):
    v = raw['Languages'][key]
    point = v.get('FocalPointWgs84', {})
    languages[key] = {
        'name': v['Name'], 'iso': v.get('ISO639-3', ''),
        'glottocode': v.get('Glottocode', ''),
        'lat': float(point['Latitude']) if point.get('Latitude') else None,
        'lon': float(point['Longitude']) if point.get('Longitude') else None,
        'status': raw['LanguageReliabilities'][str(v['FkLanguageReliabilityId'])],
        'time': v.get('TimeFrame', {}), 'path': paths.get(key, []),
        'family': paths[key][0] if key in paths else 'Unmapped in tree',
    }

lexemes = {}
for key, v in raw['Lexemes'].items():
    lexemes[key] = {
        'l': str(v['FkLanguageId']), 'f': v['FormTranscriptionPlain'],
        'm': v.get('Meaning', ''), 'note': v.get('LexemeNotePlain', ''),
        'meaningNote': v.get('MeaningNote', ''), 'grammar': v.get('GrammaticalData', ''),
        'ipa': v.get('FormIpa', ''), 'script': v.get('FormScript', ''),
        'refs': v['SourceReferences'],
        'stub': any(r['FkSourceId'] == 999 for r in v['SourceReferences'])
               or languages[str(v['FkLanguageId'])]['name'].lower().startswith('stub'),
    }

edges = [{'id': k, 'p': str(v['FkParentId']), 'c': str(v['FkChildId']),
          't': v['FkReliabilityId'], 'refs': v['SourceReferences'],
          'note': v.get('NotePlain', '')} for k, v in raw['Etymologies'].items()]
concepts = {}
lists = []
for lid, listing in raw['WordLists'].items():
    lists.append({'id': lid, 'name': listing['Name']})
    for category in listing['WordListCategories'].values():
        for cid, item in category['WordListItems'].items():
            entry = concepts.setdefault(cid, {'id': cid, 'name': item['Name'], 'groups': [], 'lexemes': []})
            entry['groups'].append({'list': lid, 'category': category['Name']})
            entry['lexemes'] = list(dict.fromkeys(entry['lexemes'] + [str(i) for i in item.get('ConnectedLexemes', [])]))

data = {'languages': languages, 'lexemes': lexemes, 'edges': edges,
        'concepts': concepts, 'lists': lists, 'sources': raw['Sources'],
        'types': {k: v['Name'] for k, v in raw['EtymologicalReliabilities'].items()},
        'meta': raw['MetaData'], 'counts': dict(Counter(e['t'] for e in edges))}
dest = ROOT / 'dist' / 'data.js'
dest.write_text('window.DIACL_DATA=' + json.dumps(data, ensure_ascii=False, separators=(',', ':')) + ';\n')
print(f'{len(lexemes):,} lexemes, {len(edges):,} links, {len(languages)} language records; {dest.stat().st_size/1e6:.1f} MB')
