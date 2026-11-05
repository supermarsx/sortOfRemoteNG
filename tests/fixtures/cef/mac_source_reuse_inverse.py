"""Exact inverse of the Mac owned-source digest reuse and 5400 s budget change.

The pairs live in mac_source_reuse_inverse.json as (current text, previous
text); every current text must occur exactly once. Fixtures load this file by
path because they run isolated (-I) and cannot import siblings.
"""
import json
from pathlib import Path

_DATA = json.loads((Path(__file__).with_name('mac_source_reuse_inverse.json')).read_text(encoding='utf8'))['archive']


def inverse(raw):
    text = raw.decode() if isinstance(raw, bytes) else raw
    start_marker, end_marker = _DATA['helperStart'], _DATA['helperEnd']
    if start_marker not in text:
        return raw
    assert text.count(start_marker) == 1 and text.count(end_marker) == 1
    start = text.index(start_marker)
    end = text.index(end_marker, start)
    text = text[:start] + text[end:]
    for current, previous in _DATA['pairs']:
        assert text.count(current) == 1, current[:60]
        text = text.replace(current, previous, 1)
    return text.encode() if isinstance(raw, bytes) else text
