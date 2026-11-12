# WALS association review

Reviewed 2026-11-12 for WALS-02, using the WALS-01 bundle and the complete local
27,180-entry atlas catalog. This reviews identifier association and evidence scope.
Catalog names and levels below are catalog metadata; observations continue to
describe their original WALS records. No reviewed overrides are needed.

- WALS source: `wals-v2020.6`, commit `81298aa26d01fdc11b769bcc7fa87ad9e43d7ccd`.
- Bundle SHA-256: `5ed6085ae55662cce317a0183fb122fad37caca026b43c6a1b9a57e2a3c0a580`.
- Catalog SHA-256: `e2bdc7756714f39c7c0f85acbc066c80c496c18a902333b85ede84b49bf52a5e`.
- Prototype policy: `scripts/build_wals.py` at
  `3b7078614efcfebc1c471fea2c4ab7fb336745a6` (reproduced in the explicit integration check).
- WALS-01 independently reconciled every cleaned-table field against this source
  snapshot with zero semantic differences. The comparison here isolates join policy.

The new join yields **2,656 associated / 6 unmatched / 0 ambiguous** records:
2,645 by declared Glottocode and 11 by unique primary ISO without a Glottocode.
Catalog levels are 2,572 language, 46 dialect and 38 family. The 38 family links
are marked `broader`; no observation is inherited and no descendant is substituted.

## The 37 prototype family associations

Each row retains the same declared Glottocode and target, now with explicit
`broader` scope and a source-variety explanation. Differences between source and
catalog names do not justify guessing a narrower descendant. The four Bandjalang
records remain separate, as do all other varieties sharing a catalog association.

| WALS ID | Recorded variety | Catalog ID | Catalog name | Decision |
| --- | --- | --- | --- | --- |
| bca | Bandjalang (Casino) | band1339 | Bandjalangic | Keep, broader scope |
| biu | Bisu | bisu1246 | Bisu-Pyen-Laomian | Keep, broader scope |
| blz | Balanta | bala1300 | Balanta | Keep, broader scope |
| bnj | Bandjalang | band1339 | Bandjalangic | Keep, broader scope |
| bwa | Bandjalang (Waalubal) | band1339 | Bandjalangic | Keep, broader scope |
| byu | Bandjalang (Yugumbir) | band1339 | Bandjalangic | Keep, broader scope |
| crt | Chorote | chor1274 | Chorote | Keep, broader scope |
| ctc | Cuicatec | cuic1234 | Cuicatec | Keep, broader scope |
| din | Dinka | dink1262 | Dinka | Keep, broader scope |
| ene | Enets | enet1250 | Enets | Keep, broader scope |
| gue | Guere | guer1244 | Guere-Krahn | Keep, broader scope |
| hai | Haida | haid1248 | Haida | Keep, broader scope |
| jia | Jiarong | jiar1240 | Northern Gyalrong | Keep, broader scope |
| jin | Jino | jino1236 | Jino | Keep, broader scope |
| kew | Kewa | kewa1250 | Kewa | Keep, broader scope |
| kis | Kisi | kiss1245 | Kissi | Keep, broader scope |
| kmb | Kombai | ndei1235 | Ndeiram | Keep, broader scope |
| ktu | Katu | nucl1297 | Nuclear Katu | Keep, broader scope |
| lng | Lengua | leng1262 | Lengua | Keep, broader scope |
| luy | Luyia | luyi1234 | Luyia | Keep, broader scope |
| maz | Mazahua | maza1293 | Mazahua | Keep, broader scope |
| mgg | Mangghuer | tuuu1240 | Monguoric | Keep, broader scope |
| mut | Mutsun | sout2986 | Southern Costanoan | Keep, broader scope |
| nen | Nenets (Forest) | nene1251 | Nenets | Keep, broader scope |
| ngo | Ngoni | ngon1269 | Tanzania-Mozambique Ngoni | Keep, broader scope |
| nhh | Nahuatl (Huasteca) | huas1257 | Huasteca Nahuatl | Keep, broader scope |
| nkn | Nkonya | nkon1245 | Nkonya-Nkami | Keep, broader scope |
| oss | Ossetic | osse1243 | Modern Ossetic | Keep, broader scope |
| pum | Pumi | pumi1242 | Pumi | Keep, broader scope |
| qbo | Quechua (Bolivian) | boli1262 | Bolivian-Argentinian Quechua | Keep, broader scope |
| qia | Qiang | qian1264 | Qiang | Keep, broader scope |
| sla | Slave | slav1253 | Slave | Keep, broader scope |
| srb | Sorbian | sorb1249 | Sorbian | Keep, broader scope |
| sti | Stieng | stie1250 | Stieng | Keep, broader scope |
| tbu | Tubu | tebu1238 | Tebu | Keep, broader scope |
| uzb | Uzbek | uzbe1247 | Uzbek | Keep, broader scope |
| wah | Wahgi | wahg1249 | Wahgic | Keep, broader scope |

## The ten prototype ISO fallbacks

For every row, the Glottocode is absent, the primary ISO occurs exactly once in
the complete WALS source catalog and exactly once in the complete atlas catalog,
and the resolved language-level target is unchanged. They therefore meet the new
automatic fallback rule. This is an identifier association; names alone neither
establish nor invalidate it. The UI must retain the recorded variety name.

| WALS ID | Recorded variety | Primary ISO | Catalog ID | Catalog name | Decision |
| --- | --- | --- | --- | --- | --- |
| bbf | Bobo Madaré (Northern) | bbo | nort2819 | Northern Bobo Madaré | Keep, unique ISO |
| biq | Bilaan (Koronadal) | bpr | koro1310 | Koronadal Blaan | Keep, unique ISO |
| cln | Cholón | cht | chol1284 | Cholón | Keep, unique ISO |
| dab | Daba | dbq | nucl1683 | Daba | Keep, unique ISO |
| gon | Gondi | gno | nort2702 | Northern Gondi | Keep, unique ISO |
| gwa | Gwari | gbr | gbag1258 | Gbagyi | Keep, unique ISO |
| jak | Jakaltek | jac | popt1235 | Popti' | Keep, unique ISO |
| leg | Lega | lea | lega1249 | Lega-Shabunda | Keep, unique ISO |
| ndi | Ngbandi | ngb | nort2774 | Northern Ngbandi | Keep, unique ISO |
| tam | Tamang (Eastern) | taj | east2347 | Eastern Tamang | Keep, unique ISO |

## The one changed result

**Albanian (`alb`) → `alba1267` (family)** is newly associated by ISO `sqi`.
Its Glottocode is absent and `sqi` is unique in both complete catalogs. The
prototype restricted ISO lookup to language-level entries and omitted this family
node; the new policy checks the full catalog and reports scope separately. Keep
the broader association without choosing Tosk, Gheg or any other descendant.
This adds one family/ISO association and reduces unmatched records from seven to
six. It does not create new observations or assertions for the family.

The remaining six records have neither a Glottocode nor a primary ISO:

| WALS ID | Recorded variety | Result |
| --- | --- | --- |
| arr | Arrernte | Unmatched; retain WALS evidence |
| aze | Azerbaijani | Unmatched; retain WALS evidence |
| lcr | Lesser Antillean French Creole | Unmatched; retain WALS evidence |
| mla | Mambila | Unmatched; retain WALS evidence |
| mrq | Marquesan | Unmatched; retain WALS evidence |
| tsm | Tasmanian | Unmatched; retain WALS evidence |

No source identifiers were edited, no records merged, no explicit unresolved
Glottocodes replaced with ISO, and no names used as fallback keys. Catalog or
source revisions may change uniqueness or levels, so associations are recomputed
against loaded catalogs. The fixture tests exercise conflicts absent from this
particular snapshot; matching this count alone is insufficient validation.

Reproduce from `app/` after explicit dataset restoration:

```sh
node --test --test-isolation=none tests/integration/wals.test.ts
```

The ignored report `test-results/wals-02/associations.json` records every source
result, reason, level, scope, input fingerprint and the prototype comparison.
The check asserts all 37 old family links and ten ISO links retain their targets
and methods, and that Albanian is the only new target. It also exercises the real
Donegal / 12A, Kyuquot / 37A and Eastern Aleut / 12A navigation cases. Those cases
must retain their source record even when the default source variety under the
same atlas profile has no observation for the selected feature.
