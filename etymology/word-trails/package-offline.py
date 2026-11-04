"""Create a self-contained HTML copy for opening directly in a browser."""
import re
from pathlib import Path

root = Path(__file__).resolve().parent
dist = root / 'dist'
html = (dist / 'index.html').read_text()
css = (dist / 'styles.css').read_text()
# No network is needed in the presentation copy; local/system font fallbacks apply.
css = re.sub(r"^@import[^\n]+\n", '', css, count=1, flags=re.MULTILINE)
html = html.replace('<link rel="stylesheet" href="styles.css">', '<style>\n' + css + '\n</style>')
data = (dist / 'data.js').read_text().replace('<', r'\u003c')
map_data = 'window.DIACL_MAP=' + (dist / 'world-110m.json').read_text() + ';'
code = (dist / 'app.js').read_text()
html = html.replace('<script src="data.js"></script><script src="app.js"></script>',
                    '<script>\n' + data + '\n' + map_data + '\n</script>\n<script>\n' + code + '\n</script>')
html = html.replace('<title>Word Trails — An Etymology Explorer</title>', '<title>Word Trails — Offline Prototype</title>')
dest = root / 'OPEN-ME.html'
dest.write_text(html)
print(f'Created {dest.name}: {dest.stat().st_size/1e6:.1f} MB, no external files or network needed.')
