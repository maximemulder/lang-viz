#!/usr/bin/env python3
"""Read the normalized literal BibTeX emitted by this pinned CLDF dataset.

This is deliberately not a general BibTeX interpreter. Nested/escaped braces,
quoted strings and numeric literals are supported. Macros, concatenation and
crossrefs fail explicitly rather than silently yielding incomplete citations.
Field contents (including LaTeX) are retained as text, never rendered as HTML.
"""

import re


def parse_bibtex(source: str) -> dict:
    pos = 0
    result = {}
    keys = set()

    def fail(message):
        raise ValueError(f"sources.bib offset {pos}: {message}")

    def space():
        nonlocal pos
        while pos < len(source) and source[pos].isspace():
            pos += 1

    def token(pattern):
        nonlocal pos
        space()
        match = re.compile(pattern).match(source, pos)
        if not match:
            fail("unexpected syntax")
        pos += len(match[0])
        return match[0]

    def literal():
        nonlocal pos
        space()
        if pos == len(source):
            fail("missing field value")
        opening = source[pos]
        if opening not in '{"':
            return token(r"[0-9]+")
        pos += 1
        start, depth = pos, 1 if opening == "{" else 0
        while pos < len(source):
            char = source[pos]
            if char == "\\":
                pos += 2
                continue
            if char == "{":
                depth += 1
            elif char == "}":
                depth -= 1
                if depth < 0:
                    fail("unbalanced braces")
                if opening == "{" and depth == 0:
                    value = source[start:pos]
                    pos += 1
                    return value
            elif char == '"' and opening == '"' and depth == 0:
                value = source[start:pos]
                pos += 1
                return value
            pos += 1
        fail("unterminated literal")

    while True:
        space()
        if pos == len(source):
            return result
        kind = token(r"@[A-Za-z]+")[1:].lower()
        if kind in {"string", "preamble", "comment"}:
            fail(f"unsupported BibTeX directive {kind}")
        token(r"\{")
        key = token(r"[^\s,{}]+")
        if key.casefold() in keys:
            fail(f"duplicate bibliography key {key}")
        keys.add(key.casefold())
        token(",")
        fields = {}
        while True:
            space()
            if pos < len(source) and source[pos] == "}":
                pos += 1
                break
            field = token(r"[A-Za-z_][A-Za-z_0-9-]*").lower()
            if field in fields or field in {"crossref", "xdata"}:
                fail(f"duplicate or unsupported field {field}")
            token("=")
            fields[field] = literal()
            space()
            if pos < len(source) and source[pos] == ",":
                pos += 1
            elif pos == len(source) or source[pos] != "}":
                fail("expected comma or closing brace (macros/concatenation unsupported)")
        if not any(fields.values()):
            fail(f"empty bibliography entry {key}")
        result[key] = {"type": kind, "fields": fields}
