#!/usr/bin/env python3
import copy
import json

import pytest

from pipeline.atlas.catalog import SOURCE_LANGUOIDS, read_source_languoids, resolve_source_ancestry

KNOWN = {"sino1245", "sini1245"}


def test_source_entries_keep_identities_and_known_broader_classification():
    entries = read_source_languoids(KNOWN, {"dlac1987china"})
    assert {e["id"] for e in entries} == {
        "dlac1987china:tibeto-burman",
        "dlac1987china:shaozhou-tuhua",
        "dlac1987china:danzhou",
    }
    assert {e["id"]: e["parentId"] for e in entries} == {
        "dlac1987china:tibeto-burman": "sino1245",
        "dlac1987china:shaozhou-tuhua": "sini1245",
        "dlac1987china:danzhou": "sini1245",
    }
    assert all(e["geometryVariantIds"] == [] for e in entries)
    assert all(e["iso6393"] is None and e["latitude"] is None for e in entries)


def test_source_family_metadata_follows_combined_ancestry():
    entries = resolve_source_ancestry(
        read_source_languoids(KNOWN, {"dlac1987china"}),
        {"sini1245": "sino1245"},
        {"sino1245": "Sino-Tibetan", "sini1245": "Sinitic"},
        {"sino1245": "family", "sini1245": "family"},
    )
    assert all(e["familyId"] == "sino1245" and e["familyName"] == "Sino-Tibetan" for e in entries)
    # Danzhou's broad Sinitic affiliation supplies no individual parent language.
    assert all(e["parentLanguageId"] is None for e in entries)


def test_nested_source_dialects_inherit_language_and_family_while_unplaced_entries_remain_roots():
    entries = [
        {"id": "source:group", "name": "Group", "level": "group", "parentId": "lang1234"},
        {"id": "source:dialect", "name": "Dialect", "level": "dialect", "parentId": "source:group"},
        {"id": "source:unplaced", "name": "Unplaced", "level": "group", "parentId": None},
    ]
    resolved = resolve_source_ancestry(
        entries,
        {"lang1234": "fami1234"},
        {"fami1234": "Family"},
        {"fami1234": "family", "lang1234": "language"},
    )
    assert resolved[0]["familyId"] == resolved[1]["familyId"] == "fami1234"
    assert resolved[1]["parentLanguageId"] == "lang1234"
    assert resolved[2]["familyId"] is None and resolved[2]["parentLanguageId"] is None


@pytest.mark.parametrize(
    "change,message",
    [
        ({"id": "fake1234"}, "namespace"),
        ({"id": "dlac1987china:bad/id"}, "namespace"),
        ({"parentId": "missing1"}, "Unknown parentId"),
        ({"parentId": "dlac1987china:tibeto-burman"}, "Cyclic"),
        ({"level": "imaginary"}, "Invalid source languoid"),
        ({"classification": {"kind": "source", "datasetId": "missing"}}, "Unknown source"),
    ],
)
def test_invalid_registry_entries_fail_before_geometry_export(tmp_path, change, message):
    entries = json.loads(SOURCE_LANGUOIDS.read_text())
    entries[0].update(change)
    path = tmp_path / "entries.json"
    path.write_text(json.dumps(entries))
    with pytest.raises(ValueError, match=message):
        read_source_languoids(KNOWN, {"dlac1987china"}, path)


def test_duplicates_claimed_glottocodes_and_cycles_are_rejected(tmp_path):
    original = json.loads(SOURCE_LANGUOIDS.read_text())
    path = tmp_path / "entries.json"
    cases = [
        (original + [original[0]], "Duplicate"),
        (copy.deepcopy(original), "Glottocode"),
        (copy.deepcopy(original), "Cyclic"),
    ]
    cases[1][0][0]["classification"]["glottocode"] = "sino1245"
    cases[2][0][0]["parentId"] = original[1]["id"]
    cases[2][0][1]["parentId"] = original[0]["id"]
    for entries, message in cases:
        path.write_text(json.dumps(entries))
        with pytest.raises(ValueError, match=message):
            read_source_languoids(KNOWN, {"dlac1987china"}, path)
