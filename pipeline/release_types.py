#!/usr/bin/env python3
"""Validated shapes shared by the independent data-release adapters."""

from __future__ import annotations

from typing import NotRequired, TypedDict


class FileDigest(TypedDict):
    bytes: int
    sha256: str


class ReleaseAsset(FileDigest):
    name: str
    files: dict[str, FileDigest]


class MultiAssetReleasePin(TypedDict):
    repository: str
    tag: str
    pipelineCommit: str
    assets: dict[str, ReleaseAsset]


class WalsReleasePin(MultiAssetReleasePin):
    schemaVersion: int
    walsSchemaVersion: int
    adapterVersion: int
    snapshot: str
    sourceCommit: str


class EtymologyReleasePin(MultiAssetReleasePin):
    schemaVersion: int
    lexicalSchemaVersion: int
    adapterVersion: int
    snapshot: str


class AtlasReleasePin(TypedDict):
    repository: str
    tag: str
    asset: str
    sha256: str
    pipelineCommit: str | None
    packagedFromCommit: NotRequired[str]
