"""Bootstrap data identity only; engine checkpoint/restore is deliberately absent."""
import hashlib
import json
import math


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("ascii")


def identity(value):
    return hashlib.sha256(canonical(value)).hexdigest()


def closed_sources(rows, paths):
    if not isinstance(rows, list) or len(rows) != 10 or [r.get("path") for r in rows] != paths:
        raise ValueError("BOOT_SOURCE_SET")
    for row in rows:
        if (set(row) != {"path", "bytes", "sha256", "canonicalBytes", "canonicalSha256", "encoding"} or
                type(row["bytes"]) is not int or not 0 < row["bytes"] <= 2 * 1024**2 or
                type(row["canonicalBytes"]) is not int or not 0 < row["canonicalBytes"] <= 2 * 1024**2 or
                any(type(row[k]) is not str or len(row[k]) != 64 or
                    set(row[k]) - set("0123456789abcdef") for k in ("sha256", "canonicalSha256")) or
                row["encoding"] not in ("exact", "git-crlf")):
            raise ValueError("BOOT_SOURCE_ROW")
        if row["encoding"] == "git-crlf" and row["path"] not in (paths[0], paths[-1]):
            raise ValueError("BOOT_SOURCE_ENCODING")
    return identity(rows)


def remaining_deadlines(context, wall, mono):
    for key in ("wallWorkEnd", "monotonicWorkEnd"):
        if type(context.get(key)) not in (int, float) or not math.isfinite(context[key]):
            raise ValueError("BOOT_CLOCK")
    value = min(context["wallWorkEnd"] - wall, context["monotonicWorkEnd"] - mono)
    if value <= 0:
        raise ValueError("BOOT_DEADLINE")
    return value


def source_bytes(row, raw):
    if len(raw) != row["bytes"] or hashlib.sha256(raw).hexdigest() != row["sha256"]:
        raise ValueError("BOOT_SOURCE_BYTES")
    canonical_raw = raw
    if row["encoding"] == "git-crlf":
        text = raw.decode("utf-8", errors="strict")
        canonical_text = text.replace("\r\n", "\n")
        if "\r" in canonical_text or canonical_text.replace("\n", "\r\n") != text:
            raise ValueError("BOOT_SOURCE_ENCODING")
        canonical_raw = canonical_text.encode("utf-8")
    if (len(canonical_raw) != row["canonicalBytes"] or
            hashlib.sha256(canonical_raw).hexdigest() != row["canonicalSha256"]):
        raise ValueError("BOOT_SOURCE_CANONICAL")
    return canonical_raw


def bootstrap_seal(context, archives):
    # This kind cannot be used as a compiled object checkpoint or SDK/native seal.
    return {"kind": "sorng-windows-arm-cross-bootstrap-data", "sourceDigest": context["sourceDigest"],
            "sourceHead": context["head"], "archives": archives, "buildAdmission": False,
            "engineCheckpointImplemented": False, "sdkBuilt": False,
            "nativeAcceptance": False, "outputExecuted": False}


def compiled_checkpoint(*_args, **_kwargs):
    raise ValueError('FULL_ENGINE_CHECKPOINT_UNAVAILABLE')


def compiled_restore(*_args, **_kwargs):
    raise ValueError('FULL_ENGINE_RESTORE_UNAVAILABLE')
