# WALS language interaction revision

## Preview

From this worktree's `app/` directory, run `npm run dev` and open the printed URL.
Dependencies and the existing generated atlas and word-history data were copied
locally. The geographic build was not rerun. WALS was restored from the repository's
pinned upstream archive and built with the existing WALS adapter. Generated public
data is ignored by Git and is not included in a normal source commit.

## Behaviour

- Language profiles load WALS on opening and display at most three recorded features.
  Sentence order is preferred; missing values are replaced with available features.
- Plain labels and compact examples appear first; definitions and references expand.
- Find languages like this highlights existing language areas with the same category.
- Hover previews; click opens information; double-click isolates. Show all again or
  Escape restores the view. Pinned map selections are preserved.
- Geography, Word histories and the existing CLDR demographics remain available.

Matching is language/dialect based, never a country fill or family-wide inference.
Only original geometry for the current geographic source and period is eligible.
An absent polygon is not manufactured. Conflicting recorded varieties are excluded
from whole-area highlights, with coverage limitations in the expanded summary.

The WALS source does not describe every atlas language. Missing recorded data remains
explicit; it is never inferred from neighbours or relatives. Shared features do not
establish ancestry.

See app/src/features/wals/README.md for implementation contracts. Legacy point-marker
browser acceptance scripts need revised expectations for the new interaction model.

## Validation

GitHub Pages production build, TypeScript and frontend lint checks pass.
All 311 unit tests, all three lexical snapshot checks and all four full WALS
snapshot integration tests pass, including release file checksums. Browser checks
covered automatic profile loading, three-card presentation, global area matching,
hover versus pinned details, click, double-click isolation, keyboard isolation,
restoration without losing pinned entries, and Word histories loading.

An existing ColorControls/Source React render warning is also present in the
original app; this revision does not resolve that separate renderer issue.
