"""Exact inverse of the Mac owned-source changes, newest first.

-2. mac_resume_cost_inverse.json: no second snapshot without writes and no second walk without reads.
-1. mac_cipd_canonical_inverse.json: CIPD pkgs/<N> and sentinel canonicalization on Mac.
0. mac_lean_cache_inverse.json: streamed cache, text keys and the no-copy postcheck view.
1. mac_framework_partial_inverse.json: a framework tree with no alias is a valid time-cut state.
2. mac_source_reuse_inverse.json: digest reuse and the 5400 s budget.
Pairs are (current text, previous text); every current text must occur exactly once. Fixtures load
this file by path because they run isolated (-I) and cannot import siblings.
"""
import json
import hashlib
from pathlib import Path

_HERE = Path(__file__).parent
_BUDGET = json.loads((_HERE / 'resume_budget_inverse.json').read_text(encoding='utf8'))['archive']
_RESUME = json.loads((_HERE / 'mac_resume_cost_inverse.json').read_text(encoding='utf8'))['archive']
_CIPD = json.loads((_HERE / 'mac_cipd_canonical_inverse.json').read_text(encoding='utf8'))['archive']
_LEAN = json.loads((_HERE / 'mac_lean_cache_inverse.json').read_text(encoding='utf8'))['archive']
_FRAMEWORK = json.loads((_HERE / 'mac_framework_partial_inverse.json').read_text(encoding='utf8'))['archive']
_REUSE = json.loads((_HERE / 'mac_source_reuse_inverse.json').read_text(encoding='utf8'))['archive']


def inverse(raw):
    text = raw.decode() if isinstance(raw, bytes) else raw
    # Exact whole-file prefix; retained history never executes in production.
    value = text.encode()
    assert len(value) == 240123 and hashlib.sha256(value).hexdigest() == 'd5e9ac6002b5a36584d5f2a7fa6240a5627983ba16a32657ceaeb7a327d1f2d6'
    current = "        require(current == expected, 'source-metadata-postcheck')\n"
    assert text.count(current) == 1
    text = text.replace(current, "", 1)
    value = text.encode()
    assert len(value) == 240057 and hashlib.sha256(value).hexdigest() == 'ab584206c6d6bd4ad4acedf7ac0de90281a22e85967d28e19e98b6a03957fee4'
    marker = _REUSE['helperStart']
    if marker not in text:
        return raw
    for current, previous in _BUDGET['pairs'] + _RESUME['pairs'] + _CIPD['pairs'] + _LEAN['pairs'] + _FRAMEWORK['pairs']:
        assert text.count(current) == 1, current[:60]
        text = text.replace(current, previous, 1)
    assert text.count(marker) == 1 and text.count(_REUSE['helperEnd']) == 1
    start = text.index(marker)
    end = text.index(_REUSE['helperEnd'], start)
    text = text[:start] + text[end:]
    for current, previous in _REUSE['pairs']:
        assert text.count(current) == 1, current[:60]
        text = text.replace(current, previous, 1)
    return text.encode() if isinstance(raw, bytes) else text
