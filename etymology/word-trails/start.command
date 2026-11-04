#!/bin/zsh
cd "${0:A:h}"
echo 'Word Trails is available at http://127.0.0.1:8765'
echo 'Keep this window open during your presentation. Press Control-C to stop.'
python3 -m http.server 8765 --bind 127.0.0.1 --directory dist
