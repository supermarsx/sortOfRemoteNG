"""Hosted-only fixed CRT/DIA/debugger passive metadata; never loads vendor code."""
import base64
import hashlib
import json
import math
import os
from pathlib import Path
import re
import stat
import struct
import sys
import threading
import time
import types

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
PROFILE_SHA = "ed1a92e003c7a312846236e8e3cc41423afe3f873bd637a2b622d8be8b19f1cb"
CONTEXT_SHA = None
FILE_CLOSE_FAILURE = False
CHUNK = 65536
CARRIER_REF = "refs/heads/codex/ci-windows-arm-runtime-closure-20261026"

class Denied(Exception):
    pass


def need(value, code):
    if not value:
        raise Denied(code)


class Clock:
    def __init__(self, wall_end, mono_end, wall=time.time, mono=time.monotonic):
        self.wall_end, self.mono_end = wall_end, mono_end
        self.wall, self.mono = wall, mono

    def remaining(self):
        seconds = min(self.wall_end - self.wall(), self.mono_end - self.mono())
        need(seconds > 0, "ACQ_DEADLINE")
        return seconds


def plain(path, exists=True):
    path = Path(path)
    need(path.is_absolute() and not str(path).startswith(("\\\\", "//")), "ACQ_PATH")
    need(all(p not in (".", "..") for p in path.parts), "ACQ_PATH")
    for part in [*reversed(path.parents), path]:
        try:
            value = part.lstat()
        except FileNotFoundError:
            need(not exists and part == path, "ACQ_PATH")
            continue
        need(not stat.S_ISLNK(value.st_mode) and
             not (getattr(value, "st_file_attributes", 0) & 0x400), "ACQ_LINK")
    if exists:
        resolved = str(path.resolve(strict=True)).replace("\\", "/")
        original = str(path).replace("\\", "/")
        need(resolved.casefold() == original.casefold() if os.name == "nt"
             else resolved == original, "ACQ_ALIAS")
    return path


def signature(s):
    return (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_ctime_ns,
            s.st_mode, s.st_nlink, getattr(s, "st_birthtime_ns", None))


def shared(s):
    return (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_nlink,
            getattr(s, "st_birthtime_ns", None))


def held(path, clock, expected_size=None, sha256=None, sha512=None, retain=False,
         maximum=3 * 1024**2):
    global FILE_CLOSE_FAILURE
    path = plain(path)
    before = path.lstat()
    need(stat.S_ISREG(before.st_mode) and before.st_nlink == 1, "ACQ_FILE")
    need(os.name != "nt" or getattr(before, "st_birthtime_ns", None) is not None,
         "ACQ_BIRTH")
    need(before.st_size <= maximum, "ACQ_SIZE")
    if expected_size is not None:
        need(before.st_size == expected_size, "ACQ_SIZE")
    h256, h512, data, count = hashlib.sha256(), hashlib.sha512(), [], 0
    stream = path.open("rb")
    primary = None
    try:
        fd_before = os.fstat(stream.fileno())
        need(shared(before) == shared(fd_before), "ACQ_IDENTITY")
        while True:
            clock.remaining()
            chunk = stream.read(CHUNK)
            if not chunk:
                break
            count += len(chunk)
            need(count <= maximum, "ACQ_SIZE")
            h256.update(chunk)
            h512.update(chunk)
            if retain:
                data.append(chunk)
        fd_after = os.fstat(stream.fileno())
        need(signature(fd_before) == signature(fd_after), "ACQ_CHANGED")
    except BaseException as error:
        primary = error
        raise
    finally:
        try:
            stream.close()
        except BaseException:
            FILE_CLOSE_FAILURE = True
            if primary is None:
                raise
    after = path.lstat()
    need(signature(before) == signature(after) and shared(after) == shared(fd_after),
         "ACQ_CHANGED")
    need(count == before.st_size, "ACQ_CHANGED")
    actual256, actual512 = h256.hexdigest(), base64.b64encode(h512.digest()).decode("ascii")
    need(sha256 is None or actual256 == sha256, "ACQ_HASH")
    need(sha512 is None or actual512 == sha512, "ACQ_HASH")
    return {"bytes": count, "sha256": actual256, "sha512": actual512,
            "identity": list(shared(after))}, b"".join(data) if retain else None


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("ascii")


def identity(value):
    return hashlib.sha256(canonical(value)).hexdigest()


def closed_sources(rows, paths):
    if not isinstance(rows, list) or len(rows) != 6 or [r.get("path") for r in rows] != paths:
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



def fixed_path(raw):
    text = str(raw).replace("\\", "/")
    need(not text.startswith("//") and not any(x in (".", "..") for x in text.split("/")), "INV_PATH")
    path = Path(raw)
    need(path.is_absolute(), "INV_PATH")
    for part in (*reversed(path.parents), path):
        try:
            info = part.lstat()
        except FileNotFoundError:
            return None
        need(not stat.S_ISLNK(info.st_mode) and not getattr(info, "st_file_attributes", 0) & 0x400, "INV_LINK")
    return plain(path)


def pe_metadata(raw):
    def span(offset, count):
        need(type(offset) is int and type(count) is int and 0 <= offset <= len(raw) and
             0 <= count <= len(raw) - offset, "INV_PE_BOUND")
        return raw[offset:offset + count]
    def u16(offset):
        return struct.unpack("<H", span(offset, 2))[0]
    def u32(offset):
        return struct.unpack("<I", span(offset, 4))[0]
    need(span(0, 2) == b"MZ", "INV_PE_DOS")
    pe = u32(60)
    need(pe >= 64 and span(pe, 4) == b"PE\0\0", "INV_PE_SIGNATURE")
    machine, sections, opt_size = u16(pe + 4), u16(pe + 6), u16(pe + 20)
    need(1 <= sections <= 96, "INV_PE_SECTIONS")
    opt = pe + 24;magic = u16(opt)
    need(magic in (0x10b, 0x20b), "INV_PE_OPTIONAL")
    base = 96 if magic == 0x10b else 112
    need(base <= opt_size <= 4096, "INV_PE_OPTIONAL")
    span(opt, opt_size);count = u32(opt + base - 4)
    need(0 <= count <= 16 and opt_size >= base + 8 * count, "INV_PE_DIRECTORIES")
    headers = u32(opt + 60)
    need(opt + opt_size + sections * 40 <= headers <= len(raw), "INV_PE_HEADERS")
    ranges = []
    for i in range(sections):
        row = opt + opt_size + i * 40
        va, size, address = u32(row + 12), u32(row + 16), u32(row + 20)
        span(address, size)
        if size:
            need(address >= headers and va >= headers and va + size <= 0x100000000, "INV_PE_SECTIONS")
            ranges.append((va, va + size, address))
    need(all(a[1] <= b[0] for a, b in zip(sorted(ranges), sorted(ranges)[1:])), "INV_PE_SECTIONS")
    raw_ranges = sorted((address, address + end - start) for start, end, address in ranges)
    need(all(a[1] <= b[0] for a, b in zip(raw_ranges, raw_ranges[1:])), "INV_PE_SECTIONS")
    def rva(value, length):
        need(length >= 0, "INV_PE_RVA")
        if value < headers and length <= headers - value:
            return value
        candidates = [address + value - start for start, end, address in ranges
                      if start <= value <= end and length <= end - value]
        need(len(candidates) == 1, "INV_PE_RVA")
        span(candidates[0], length)
        return candidates[0]
    def directory(index):
        if index >= count:
            return 0, 0
        value, length = u32(opt + base + index * 8), u32(opt + base + index * 8 + 4)
        need(bool(value) == bool(length), "INV_PE_DIRECTORY")
        return value, length
    def import_name(value):
        data = bytearray()
        for i in range(129):
            byte = span(rva(value + i, 1), 1)[0]
            if byte == 0:
                break
            data.append(byte)
        else:
            raise Denied("INV_PE_IMPORT_NAME")
        need(re.fullmatch(rb"[A-Za-z0-9_.-]{1,124}\.dll", bytes(data), re.IGNORECASE), "INV_PE_IMPORT_NAME")
        return data.decode("ascii")
    def imports(index, stride):
        value, length = directory(index)
        if not value:
            return []
        need(stride <= length <= 65536, "INV_PE_IMPORT_BOUND")
        start = rva(value, length);result = []
        for i in range(min(length // stride, 257)):
            row = span(start + i * stride, stride)
            if not any(row):
                return result
            need(i < 256, "INV_PE_IMPORT_BOUND")
            if index == 13:
                need(struct.unpack_from("<I", row, 0)[0] == 1, "INV_PE_DELAY_FORMAT")
                name_rva = struct.unpack_from("<I", row, 4)[0]
            else:
                name_rva = struct.unpack_from("<I", row, 12)[0]
            result.append(import_name(name_rva))
        raise Denied("INV_PE_IMPORT_TERMINATOR")
    regular, delayed = imports(1, 20), imports(13, 32)
    resource, resource_size = directory(2)
    versions = []
    if resource:
        need(16 <= resource_size <= 1024**2, "INV_PE_VERSION_BOUND")
        resource_start = rva(resource, resource_size);visits = [0];visited = set()
        def resource_span(offset, length):
            need(0 <= offset <= resource_size and 0 <= length <= resource_size - offset, "INV_PE_VERSION_BOUND")
            return resource_start + offset
        def version_data(offset):
            at = resource_span(offset, 16);data_rva, length = u32(at), u32(at + 4)
            need(6 <= length <= 1024**2, "INV_PE_VERSION_BOUND")
            data = span(rva(data_rva, length), length)
            total, value_length, kind = struct.unpack_from("<HHH", data)
            need(6 <= total <= len(data) and value_length == 52 and kind == 0, "INV_PE_VERSION")
            position = 6;key = bytearray()
            while position + 2 <= total and len(key) <= 64:
                unit = data[position:position + 2];position += 2
                if unit == b"\0\0":
                    break
                key.extend(unit)
            need(key.decode("utf-16-le", "strict") == "VS_VERSION_INFO", "INV_PE_VERSION")
            position = (position + 3) & ~3
            need(position + 52 <= total, "INV_PE_VERSION")
            fixed = struct.unpack_from("<13I", data, position)
            need(fixed[0] == 0xfeef04bd and fixed[1] == 0x10000, "INV_PE_VERSION")
            def split(a, b):
                return [a >> 16, a & 65535, b >> 16, b & 65535]
            return {"fileVersion": split(fixed[2], fixed[3]), "productVersion": split(fixed[4], fixed[5])}
        def walk(offset, depth, ids):
            need(depth <= 2 and offset not in visited, "INV_PE_VERSION_TREE")
            visited.add(offset);at = resource_span(offset, 16)
            named, numbered = u16(at + 12), u16(at + 14)
            need(named + numbered <= 256, "INV_PE_VERSION_TREE")
            resource_span(offset + 16, (named + numbered) * 8)
            for i in range(named + numbered):
                visits[0] += 1;need(visits[0] <= 256, "INV_PE_VERSION_TREE")
                key, child = u32(at + 16 + 8 * i), u32(at + 20 + 8 * i)
                if depth == 0 and key != 16:
                    continue
                need(not key & 0x80000000, "INV_PE_VERSION_TREE")
                path = ids + [key]
                if child & 0x80000000:
                    need(depth < 2, "INV_PE_VERSION_TREE")
                    walk(child & 0x7fffffff, depth + 1, path)
                else:
                    need(depth == 2 and len(path) == 3 and len(versions) < 8, "INV_PE_VERSION_TREE")
                    versions.append(version_data(child))
        walk(0, 0, [])
    need(not versions or all(value == versions[0] for value in versions), "INV_PE_VERSION_AMBIGUOUS")
    return {"machine": machine, "machineKind": {0x8664: "x64", 0xaa64: "arm64", 0xa641: "arm64ec", 0xa64e: "arm64x"}.get(machine, "other"),
            "imports": regular, "delayImports": delayed, "version": versions[0] if versions else None,
            "versionStatus": "observed" if versions else "absent", "imageLoaded": False}


def inventory(p, clock, report=None):
    rows, total, roots = [], 0, []
    report = {} if report is None else report
    report.update({"rows": rows, "roots": roots, "observationComplete": False, "totalReadBytes": 0})
    def root(raw):
        clock.remaining();path = fixed_path(raw)
        if path is None:
            roots.append({"role": raw, "status": "missing"})
            return None
        info = path.stat();need(stat.S_ISDIR(info.st_mode), "INV_ROOT")
        roots.append({"role": raw, "status": "observed", "identity": signature(info)})
        return path
    vs, sdk, redist = root(p["vsRoot"]), root(p["sdkRoot"]), root(p["redistRoot"])
    versions = []
    facts = {"available": redist is not None, "entriesSeen": 0, "entryLimit": 16,
             "entryCountExact": False, "entryCountWithinLimit": None,
             "matchingNumericNames": [], "numericNameCount": 0, "numericNameCountExact": False,
             "validatedVersionCount": 0, "versionLimit": 4, "versionCountWithinLimit": None,
             "directoryIdentityAvailable": False, "directoryIdentityEqual": None,
             "directoryIdentityFailure": None, "directoryBefore": None, "directoryAfter": None,
             "directoryChangedFields": None, "failedPredicate": None}
    report["redistEnumeration"] = facts
    if redist is not None:
        before = signature(redist.stat());entries = [];primary = None
        signature_fields = ("dev", "ino", "size", "mtimeNs", "ctimeNs", "mode", "nlink", "birthtimeNs")
        facts["directoryBefore"] = dict(zip(signature_fields, before))
        try:
            with os.scandir(redist) as scan:
                for entry in scan:
                    clock.remaining();facts["entriesSeen"] += 1
                    facts["entryCountWithinLimit"] = facts["entriesSeen"] <= 16
                    if not facts["entryCountWithinLimit"]:
                        facts["failedPredicate"] = "entry-count"
                    need(facts["entryCountWithinLimit"], "INV_VERSION_ENTRY_BOUND")
                    entries.append(redist / entry.name)
                    if re.fullmatch(r"14\.[0-9]{1,3}\.[0-9]{1,6}(?:\.[0-9]{1,6})?", entry.name):
                        facts["matchingNumericNames"].append(entry.name)
                        facts["numericNameCount"] += 1
            facts["entryCountExact"] = True
            facts["entryCountWithinLimit"] = True
            facts["numericNameCountExact"] = True
            facts["matchingNumericNames"].sort()
            for entry in entries:
                clock.remaining()
                if re.fullmatch(r"14\.[0-9]{1,3}\.[0-9]{1,6}(?:\.[0-9]{1,6})?", entry.name):
                    facts["failedPredicate"] = "numeric-directory"
                    need(fixed_path(entry) is not None and entry.is_dir(), "INV_VERSION_DIRECTORY")
                    facts["failedPredicate"] = None
                    versions.append(entry.name)
                    facts["validatedVersionCount"] = len(versions)
            facts["versionCountWithinLimit"] = len(versions) <= 4
            if not facts["versionCountWithinLimit"]:
                facts["failedPredicate"] = "version-count"
            need(facts["versionCountWithinLimit"], "INV_VERSION_COUNT_BOUND")
        except BaseException as error:
            primary = error
            raise
        finally:
            facts["matchingNumericNames"].sort()
            try:
                clock.remaining()
                after = signature(redist.stat())
                facts["directoryAfter"] = dict(zip(signature_fields, after))
                facts["directoryChangedFields"] = [name for name, left, right in zip(signature_fields, before, after) if left != right]
                facts["directoryIdentityEqual"] = after == before
                facts["directoryIdentityAvailable"] = True
            except BaseException:
                facts["directoryIdentityFailure"] = "INV_VERSION_IDENTITY_UNAVAILABLE"
                if primary is None:
                    facts["failedPredicate"] = "directory-identity-unavailable"
                    raise
        if not facts["directoryIdentityEqual"]:
            facts["failedPredicate"] = "directory-identity"
        need(facts["directoryIdentityEqual"], "INV_VERSION_DIRECTORY_CHANGED")
    versions.sort()
    requests = []
    for role in p["roles"]:
        if "pathTemplate" in role:
            if not versions:
                rows.append({"role": role["role"], "version": None, "status": "missing-redist-version"})
            for version in versions:
                requests.append((role, version, role["pathTemplate"].format(observedVersion=version)))
        else:
            requests.append((role, None, role["path"]))
    need(len(requests) + len(rows) <= p["limits"]["fileCount"], "INV_FILE_COUNT")
    for role, version, raw_path in requests:
        clock.remaining();row = {"role": role["role"], "version": version, "status": "missing", "expectedArchitecture": role["expectedArchitecture"]}
        rows.append(row)
        try:
            path = fixed_path(raw_path)
            if path is None:
                continue
            size = path.lstat().st_size
            need(size <= p["limits"]["perFileBytes"] and total + size <= p["limits"]["totalFileBytes"], "INV_TOTAL_BOUND")
            source_root = Path(p["vsRoot"] if str(raw_path).startswith(p["vsRoot"] + "/") else p["sdkRoot"])
            source_parents = []
            for part in path.parents:
                source_parents.append(part)
                if part == source_root:
                    break
            need(source_parents and source_parents[-1] == source_root, "INV_SOURCE_ROOT")
            chain = [(part, signature(part.stat())) for part in source_parents]
            observed, raw = held(path, clock, retain=True, maximum=p["limits"]["perFileBytes"])
            need(fixed_path(path) is not None and all(signature(part.stat()) == before for part, before in chain), "INV_SOURCE_CHANGED")
            total += observed["bytes"]
            report["totalReadBytes"] = total
            row.update({"bytes": observed["bytes"], "sha256": observed["sha256"], "nlink": observed["identity"][4],
                        "sourceRole": role["role"], "sourceRoot": "VS" if str(raw_path).startswith(p["vsRoot"] + "/") else "SDK",
                        "pe": pe_metadata(raw), "status": "observed", "executionAdmitted": False})
            row["architectureMatch"] = row["pe"]["machineKind"] == role["expectedArchitecture"]
        except Exception as error:
            row["status"], row["failure"] = "denied", failure(error)
            # Bounds/deadline/identity or parsing failures stop the inventory. Never hide a primary.
            raise
    for entry in roots:
        if entry["status"] == "observed":
            path = fixed_path(entry["role"])
            need(path is not None and signature(path.stat()) == tuple(entry["identity"]), "INV_ROOT_CHANGED")
    return {"roots": roots, "redistVersions": versions, "redistEnumeration": facts, "rows": rows, "totalReadBytes": total,
            "observationComplete": True, "closureSatisfied": False, "closureRequiresIndependentReview": True,
            "sdkDebuggerVersionProven": False, "vendorExecuted": False, "filesCopied": False}


def failure(error):
    text = str(error)
    return text if isinstance(error, (Denied, ValueError)) and re.fullmatch(r"(?:INV|BOOT|ACQ)_[A-Z_]{1,56}", text) else "INV_UNAVAILABLE"


def profile(clock):
    _, raw = held(HERE / "profile.json", clock, sha256=PROFILE_SHA, retain=True, maximum=32768)
    p = json.loads(raw)
    need(p["kind"] == "windows-arm-runtime-closure-passive" and p["buildAdmission"] is False and
         p["noVendorExecution"] is True and len(p["sourcePaths"]) == 6, "INV_PROFILE")
    return p


def bootstrap_authority(c, p):
    need(c["kind"] == "windows-arm-runtime-closure-context" and c["mode"] == "passive-runtime-closure" and
         c["repository"] == "supermarsx/sortOfRemoteNG" and c["repositoryId"] == "1010282954" and
         c["visibility"] == "public" and c["event"] == "workflow_dispatch" and c["defaultBranch"] == "main" and
         c["ref"] == CARRIER_REF and (c["inputs"] is None or type(c["inputs"]) is dict and not c["inputs"]) and
         c["workflow"] == p["sourcePaths"][0] == ".github/workflows/windows-x64-arm-toolchain.yml" and
         c["workflowSha"] == c["head"] and re.fullmatch(r"[a-f0-9]{40}", c["head"]) and
         c["image"] == p["image"] and re.fullmatch(r"[1-9][0-9]*", c["runId"]) and
         re.fullmatch(r"[1-9][0-9]*", c["attempt"]), "INV_AUTHORITY")


def verified_sources(root, expected=None, bind=False):
    global CONTEXT_SHA
    root = plain(root)
    need(root.parent == ROOT / ".artifacts" and re.fullmatch(r"windows-arm-runtime-closure-[a-f0-9-]{36}", root.name), "INV_ROOT")
    _, raw = held(root / "context.json", Clock(time.time() + 5, time.monotonic() + 5), retain=True, maximum=131072)
    need(hashlib.sha256(raw).hexdigest() == (expected if expected is not None else CONTEXT_SHA), "INV_CONTEXT_PIN")
    c = json.loads(raw);remaining_deadlines(c, time.time(), time.monotonic())
    need(0 < c["wallWorkEnd"] - time.time() <= 120 and
         0 < c["monotonicWorkEnd"] - time.monotonic() <= 120, "INV_CLOCK_BOUND")
    clock = Clock(c["wallWorkEnd"], c["monotonicWorkEnd"]);p = profile(clock)
    bootstrap_authority(c, p)
    need(closed_sources(c["sources"], p["sourcePaths"]) == c["sourceDigest"], "INV_SOURCE_DIGEST")
    for i, row in enumerate(c["sources"]):
        _, snapshot = held(root / "source-inputs" / str(i), clock, row["bytes"], row["sha256"], retain=True, maximum=2 * 1024**2)
        _, live = held(ROOT / row["path"], clock, row["bytes"], row["sha256"], retain=True, maximum=2 * 1024**2)
        need(snapshot == live, "INV_SOURCE_CHANGED");source_bytes(row, live)
    held(p["python"]["path"], clock, p["python"]["bytes"], p["python"]["sha256"])
    if bind:
        CONTEXT_SHA = hashlib.sha256(raw).hexdigest()
    return c, p, clock


def worker_argv(role, root, p):
    need(role == "observation" and CONTEXT_SHA is not None, "INV_ROLE")
    return [p["python"]["path"], "-I", "-B", str(HERE / "observe.py"), "--worker", role, str(root), CONTEXT_SHA, "--execute"]


def closed_worker_command(argv, root, p):
    need(type(argv) is list and argv == worker_argv("observation", Path(root), p) and Path(root) == Path.cwd(), "INV_COMMAND")
    return "observation"


def no_execution(event, _args):
    if event in ("subprocess.Popen", "os.system", "os.exec", "os.posix_spawn", "os.spawn", "socket.connect", "socket.getaddrinfo"):
        raise Denied("INV_NO_EXECUTION_OR_NETWORK")


def retain(root, name, result):
    try:
        raw = (json.dumps(result, indent=2) + "\n").encode()
        need(len(raw) <= 262144, "INV_REPORT_BOUND")
        with (root / name).open("xb") as stream:
            stream.write(raw)
    except BaseException:
        result["reportingFailure"] = "INV_REPORT_WRITE"
        result["firstFailure"] = result.get("firstFailure") or "INV_REPORT_WRITE"
        result["success"] = False
        try:
            print(json.dumps({"success": False, "firstFailure": result["firstFailure"], "reportingFailure": "INV_REPORT_WRITE",
                              "fileCloseFailure": "INV_FILE_CLOSE" if FILE_CLOSE_FAILURE else None}))
        except BaseException:
            pass


def worker(root, c, p, clock):
    sys.addaudithook(no_execution)
    result = {"kind": "windows-arm-runtime-closure-observation", "success": False, "firstFailure": None,
              "observationComplete": False, "closureSatisfied": False, "vendorExecuted": False}
    try:
        result.update(inventory(p, clock, report=result));result["success"] = True
    except BaseException as error:
        result["firstFailure"] = failure(error)
    finally:
        try:
            verified_sources(root);clock.remaining();result["sourcePostVerified"] = True
        except BaseException as error:
            result["sourcePostVerified"] = False;result["success"] = False
            result["firstFailure"] = result["firstFailure"] or failure(error)
        result["fileCloseFailure"] = "INV_FILE_CLOSE" if FILE_CLOSE_FAILURE else None
        if FILE_CLOSE_FAILURE:
            result["success"] = False
            result["firstFailure"] = result["firstFailure"] or "INV_FILE_CLOSE"
        retain(root, "inventory.json", result)
    return 0 if result["success"] else 1


def load_job(c, p, clock):
    row = next(row for row in c["sources"] if row["path"] == p["sourcePaths"][3])
    _, raw = held(HERE / "job.py", clock, row["bytes"], row["sha256"], retain=True, maximum=2 * 1024**2)
    source_bytes(row, raw)
    module = types.ModuleType("closed_runtime_job")
    module.__file__ = str(HERE / "job.py")
    exec(compile(raw, module.__file__, "exec"), module.__dict__)
    return module


def supervise(root, c, p, clock):
    parent, result, primary = None, None, None
    try:
        job = load_job(c, p, clock)
        (root / "jobs").mkdir();parent = job.ParentCancel(threading.Event())
        seconds = clock.remaining() - 3;need(seconds > 0, "INV_ADMISSION")
        result = job.run_job(worker_argv("observation", root, p), str(root), root / "jobs/observation", seconds, cancel=parent, cap=131072)
        need(result.get("success") is True and result.get("cleanupVerified") is True and result.get("rootExit") == 0 and result.get("activeAtEnd") == 0, "INV_JOB_FAILED")
    except BaseException as error:
        primary = failure(error)
    finally:
        closed = parent is None
        if parent is not None:
            try:
                parent.close();closed = True
            except BaseException:
                closed = False;primary = primary or "INV_PARENT_CLOSE"
        report = {"kind": "windows-arm-runtime-closure-supervisor", "success": bool(result and result.get("success") and closed and not primary),
                  "firstFailure": primary, "originalJob": result, "parentHandleClosed": closed, "vendorExecuted": False}
        try:
            verified_sources(root);clock.remaining();report["sourcePostVerified"] = True
        except BaseException as error:
            report["sourcePostVerified"] = False;report["success"] = False
            report["firstFailure"] = report["firstFailure"] or failure(error)
        report["fileCloseFailure"] = "INV_FILE_CLOSE" if FILE_CLOSE_FAILURE else None
        if FILE_CLOSE_FAILURE:
            report["success"] = False
            report["firstFailure"] = report["firstFailure"] or "INV_FILE_CLOSE"
        retain(root, "supervisor-result.json", report)
    return 0 if report["success"] else 1


def main(argv):
    need(os.name == "nt", "INV_PLATFORM")
    if len(argv) == 4 and argv[0] == "--supervise" and argv[3] == "--execute":
        root = Path(argv[1]);c, p, clock = verified_sources(root, argv[2], bind=True)
        need(Path(sys.executable).resolve() == Path(p["python"]["path"]).resolve(), "INV_PYTHON")
        return supervise(root, c, p, clock)
    need(len(argv) == 5 and argv[0:2] == ["--worker", "observation"] and argv[4] == "--execute", "INV_ARGV")
    root = Path(argv[2]);c, p, clock = verified_sources(root, argv[3], bind=True)
    need(Path(sys.executable).resolve() == Path(p["python"]["path"]).resolve(), "INV_PYTHON")
    return worker(root, c, p, clock)


if __name__ == "__main__":
    sys.modules["observe"] = sys.modules[__name__]
    try:
        raise SystemExit(main(sys.argv[1:]))
    except BaseException as error:
        if isinstance(error, SystemExit):
            raise
        print(json.dumps({"success": False, "firstFailure": failure(error), "fileCloseFailure": "INV_FILE_CLOSE" if FILE_CLOSE_FAILURE else None, "vendorExecuted": False}))
        raise SystemExit(1)
