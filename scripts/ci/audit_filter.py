#!/usr/bin/env python3
"""Filter cargo-audit --json output, failing only on high+ CVSS v3 severity.

Used by `.github/workflows/audit.yml` (t3-e31). Accepts path to audit JSON.
Exit code 1 iff any advisory with a CVSS v3 base score >= 7.0 is present.
Informational advisories (unmaintained/unsound) and those without a CVSS v3
vector are reported but do not fail the job.
"""
from __future__ import annotations

import json
import math
import sys
from typing import Optional

# CVSS v3 base-score metric weights per FIRST.org specification.
_W = {
    "AV": {"N": 0.85, "A": 0.62, "L": 0.55, "P": 0.2},
    "AC": {"L": 0.77, "H": 0.44},
    "PR_U": {"N": 0.85, "L": 0.62, "H": 0.27},
    "PR_C": {"N": 0.85, "L": 0.68, "H": 0.5},
    "UI": {"N": 0.85, "R": 0.62},
    "CIA": {"H": 0.56, "L": 0.22, "N": 0.0},
}


def cvss3_score(vector: str) -> Optional[float]:
    """Compute the CVSS v3 base score from a vector string, or None if
    the vector is not v3 or is malformed."""
    if not vector or not vector.startswith("CVSS:3"):
        return None
    parts = dict(p.split(":", 1) for p in vector.split("/") if ":" in p)
    try:
        av = _W["AV"][parts["AV"]]
        ac = _W["AC"][parts["AC"]]
        ui = _W["UI"][parts["UI"]]
        scope = parts["S"]
        pr = _W["PR_C"][parts["PR"]] if scope == "C" else _W["PR_U"][parts["PR"]]
        c = _W["CIA"][parts["C"]]
        i = _W["CIA"][parts["I"]]
        a = _W["CIA"][parts["A"]]
    except KeyError:
        return None
    iss = 1 - (1 - c) * (1 - i) * (1 - a)
    if scope == "U":
        impact = 6.42 * iss
    else:
        impact = 7.52 * (iss - 0.029) - 3.25 * ((iss - 0.02) ** 15)
    expl = 8.22 * av * ac * pr * ui
    if impact <= 0:
        return 0.0
    raw = (impact + expl) if scope == "U" else 1.08 * (impact + expl)
    return min(10.0, math.ceil(min(10.0, raw) * 10) / 10)


def main(argv: list[str]) -> int:
    path = argv[1] if len(argv) > 1 else "audit.json"
    with open(path, "r", encoding="utf-8") as fh:
        data = json.load(fh)
    vulns = (data.get("vulnerabilities") or {}).get("list") or []
    high: list[tuple] = []
    other: list[tuple] = []
    for v in vulns:
        adv = v.get("advisory") or {}
        pkg = (v.get("package") or {}).get("name")
        ident = adv.get("id")
        if adv.get("informational") is not None:
            other.append((ident, pkg, f"informational={adv['informational']}", adv.get("title")))
            continue
        vec = adv.get("cvss") or ""
        score = cvss3_score(vec)
        label = f"cvss={score}" if score is not None else f"cvss=?({vec!r})"
        entry = (ident, pkg, label, adv.get("title"))
        if score is not None and score >= 7.0:
            high.append(entry)
        else:
            other.append(entry)

    print(f"high/critical advisories: {len(high)}")
    for e in high:
        print(f"  HIGH  {e}")
    print(f"other advisories (informational/low/medium/unscored): {len(other)}")
    for e in other:
        print(f"  other {e}")

    if high:
        print(f"::error::cargo audit found {len(high)} high/critical advisories")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
