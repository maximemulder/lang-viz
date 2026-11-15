"""Validated WALS rows and browser output records."""

from __future__ import annotations

from typing import TypedDict

type CsvRow = dict[str, str]


class BibliographyEntry(TypedDict):
    type: str
    fields: dict[str, str]


class WalsReference(TypedDict):
    sourceId: str
    pages: str


class WalsRecord(TypedDict):
    name: str
    macroarea: str
    coordinates: list[float] | None
    glottocode: str | None
    iso6393: str | None
    isoCodes: list[str]
    family: str
    subfamily: str
    genus: str
    references: list[WalsReference]
    url: str


class WalsFeature(TypedDict):
    name: str
    description: str
    chapterId: str
    chapterTitle: str
    chapterCitation: str
    contributors: str
    area: str
    references: list[WalsReference]
    url: str
    chapterUrl: str


class WalsObservation(TypedDict):
    sourceId: str
    featureId: str
    categoryId: str
    references: list[WalsReference]
    comment: str
    exampleIds: list[str]
    url: str
