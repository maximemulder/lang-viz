# Digital Language Atlas of China: source and reuse notice

Source: Lawrence W. Crissman, **Digital Language Atlas of China**, Harvard
Dataverse V6.0, [DOI 10.7910/DVN/OHYYXH](https://doi.org/10.7910/DVN/OHYYXH).
The source represents approximately **1985–1987**, based on the 1987 atlas.

The supplied data dictionary requests this attribution:

> Digital Language Atlas of China (2002). GIS Editor, L.W. Crissman. ACASIAN,
> Griffith University. Based on maps produced by Theo Bauman for the Language
> atlas of China (1987). Hong Kong: Longman Group - Far East.

The Dataverse metadata specifies [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/),
while the bundled `DLAC.Metadata.doc` specifies
[CC BY-NC-SA 3.0](https://creativecommons.org/licenses/by-nc-sa/3.0/), academic
noncommercial use, and the attribution above. The dictionary also describes an
underlying copyright agreement. The project has not resolved this conflict and
does not represent that all underlying rights have been waived.

For this integration, the project follows the more restrictive CC BY-NC-SA 3.0
terms: retain attribution and notices, restrict use to noncommercial purposes,
and offer adaptations of the DLAC material under CC BY-NC-SA 3.0. This notice
applies to the DLAC contribution and its derived geometry, including its records
in the combined PMTiles archive. Other sources retain their own terms; the
project does not relicense its independent code or other datasets under DLAC's
license. Commercial reuse would require resolving the conflicting statements or
obtaining an appropriate separate grant from the relevant rights holders.

Project changes: read the WGS84 shapefile into GeoJSON without dissolving source
polygons; normalize observed label typos and truncations; attach selected
Glottocodes through an explicit crosswalk; omit ambiguous, inconsistent, and
uninhabited assignments; retain recognized components of shared areas; and
simplify/clip geometry into zoom-dependent vector tiles with Tippecanoe.
Group polygons retain regional coverage and are not assigned to each descendant.
The intermediate GeoJSON and mapping report preserve all 307 source records.

The raw archive and data dictionary are fetched by pinned file IDs and verified
SHA-256 checksums in `pipeline/dlac/fetch.sh`. The conversion and mapping policy
are documented in the project's `DATASETS.md`. The build copies this notice
to `app/public/data/DLAC-NOTICE.md`, beside the distributed catalogs and tiles.
