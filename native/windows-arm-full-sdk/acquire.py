"""Fixed SDK acquisition; inert on import. Never executes package contents."""
import base64
import datetime
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import struct
import sys
import time
import urllib.request
import uuid
import zipfile
import tarfile

IDS = ("microsoft.windows.sdk.cpp", "microsoft.windows.sdk.cpp.arm64",
       "microsoft.windows.sdk.cpp.x64", "microsoft.windows.sdk.cpp.x86")
VERSION = "10.0.28000.2270"
SDK = "10.0.28000.0"
TOTAL_COMPRESSED = 370561596
TOTAL_EXPANDED = 1497358201
TOTAL_FILES = 7434
CHUNK = 1024 * 1024


class Denied(Exception):
    pass


def save(path, value):
    with Path(path).open("x", encoding="utf-8", newline="\n") as stream:
        json.dump(value, stream, indent=2)
        stream.write("\n")


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
    path = plain(path)
    before = path.lstat()
    need(stat.S_ISREG(before.st_mode) and before.st_nlink == 1, "ACQ_FILE")
    need(os.name != "nt" or getattr(before, "st_birthtime_ns", None) is not None,
         "ACQ_BIRTH")
    need(before.st_size <= maximum, "ACQ_SIZE")
    if expected_size is not None:
        need(before.st_size == expected_size, "ACQ_SIZE")
    h256, h512, data, count = hashlib.sha256(), hashlib.sha512(), [], 0
    with path.open("rb") as stream:
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
    after = path.lstat()
    need(signature(before) == signature(after) and shared(after) == shared(fd_after),
         "ACQ_CHANGED")
    need(count == before.st_size, "ACQ_CHANGED")
    actual256, actual512 = h256.hexdigest(), base64.b64encode(h512.digest()).decode("ascii")
    need(sha256 is None or actual256 == sha256, "ACQ_HASH")
    need(sha512 is None or actual512 == sha512, "ACQ_HASH")
    return {"bytes": count, "sha256": actual256, "sha512": actual512,
            "identity": list(shared(after))}, b"".join(data) if retain else None


def pinned(row, clock, retain=False, maximum=3 * 1024**2):
    return held(row["path"], clock, row["bytes"], row["sha256"], retain=retain,
                maximum=maximum)


def member_name(name):
    need(type(name) is str and 0 < len(name) <= 160 and name.isascii(), "ACQ_MEMBER_PATH")
    need(name == "[Content_Types].xml" or
         re.fullmatch(r"[A-Za-z0-9_ ./-]+", name) is not None, "ACQ_MEMBER_PATH")
    parts = name.split("/")
    need(all(p and p not in (".", "..") and not p.endswith((".", " "))
             for p in parts), "ACQ_MEMBER_PATH")
    for part in parts:
        stem = part.split(".")[0].casefold()
        need(stem not in {"con", "prn", "aux", "nul"} and
             not re.fullmatch(r"(?:com|lpt)[1-9]", stem), "ACQ_MEMBER_PATH")
    return name


def opc_kind(name):
    # NuGet PackageBuilder release-6.14.x Save/CalcPsmdcpName: GUID ToString("N").
    if name == "_rels/.rels":
        return "relationships"
    if name == "[Content_Types].xml":
        return "content-types"
    if re.fullmatch(r"package/services/metadata/core-properties/[0-9a-fA-F]{32}\.psmdcp", name):
        return "core-properties"
    return None


def destination(package_id, name):
    member_name(name)
    if package_id == IDS[0] and name.startswith("c/"):
        relative = name[2:]
        roots = {"Catalogs", "DesignTime", "Extension SDKs", "Include", "Platforms",
                 "Redist", "References", "SDKManifest.xml", "Source", "UnionMetadata", "bin"}
        need(relative.split("/")[0] in roots, "ACQ_LAYOUT")
        return "Windows Kits/10/" + relative
    if package_id != IDS[0] and name.startswith("c/"):
        arch = package_id.rsplit(".", 1)[1]
        need(arch in ("arm64", "x64", "x86"), "ACQ_LAYOUT")
        parts = name.split("/")
        need(len(parts) >= 4 and parts[1] in ("um", "ucrt", "ucrt_enclave") and
             parts[2] == arch, "ACQ_LAYOUT")
        return "Windows Kits/10/Lib/" + SDK + "/" + name[2:]
    return "metadata/" + package_id + "/" + name


def catalog_entries(package, clock):
    _, raw = pinned(package["catalog"], clock, retain=True)
    value = json.loads(raw)
    need(value["id"].casefold() == package["id"] and value["version"] == VERSION and
         value["packageSize"] == package["bytes"] and value["packageHashAlgorithm"] == "SHA512" and
         value["packageHash"] == package["sha512"], "ACQ_CATALOG")
    entries = {}
    folded = set()
    for item in value["packageEntries"]:
        name = member_name(item["fullName"])
        need(name.casefold() not in folded and type(item["length"]) is int and
             0 <= item["length"] <= 128 * 1024**2 and type(item["compressedLength"]) is int and
             item["compressedLength"] >= 0, "ACQ_CATALOG")
        folded.add(name.casefold())
        entries[name] = {"bytes": item["length"], "compressed": item["compressedLength"]}
    need(len(entries) == package["members"] and
         sum(x["bytes"] for x in entries.values()) == package["expandedBytes"], "ACQ_CATALOG")
    return entries


def projection(packages, catalogs):
    mapping, folded = {}, set()
    for package in packages:
        for name in catalogs[package["id"]]:
            target = destination(package["id"], name)
            need(target.casefold() not in folded, "ACQ_OVERLAP")
            folded.add(target.casefold())
            mapping[(package["id"], name)] = target
    return mapping


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise Denied("ACQ_REDIRECT")


def opener():
    # Never use proxy variables, netrc, cookies or an authenticated session.
    return urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())


def download(package, target, clock, limit, open_url=None):
    need(package["id"] in IDS and package["version"] == VERSION, "ACQ_PROFILE")
    expected_url = (f'https://api.nuget.org/v3-flatcontainer/{package["id"]}/{VERSION}/'
                    f'{package["id"]}.{VERSION}.nupkg')
    need(package["url"] == expected_url and package["bytes"] <= limit, "ACQ_PROFILE")
    plain(target, exists=False)
    h512, h256, count = hashlib.sha512(), hashlib.sha256(), 0
    # Open destination first and create-new: an existing file never triggers network access.
    with Path(target).open("xb") as output:
        request = urllib.request.Request(expected_url, headers={"User-Agent": "owned-sdk28000-acquisition/1"})
        with (open_url or opener().open)(request, timeout=min(15, clock.remaining())) as response:
            need(response.status == 200 and response.geturl() == expected_url and
                 response.headers.get("Content-Encoding") in (None, "identity"), "ACQ_RESPONSE")
            need(response.headers.get("Content-Length") == str(package["bytes"]), "ACQ_SIZE")
            while True:
                clock.remaining()
                chunk = response.read(CHUNK)
                if not chunk:
                    break
                count += len(chunk)
                need(count <= package["bytes"] and count <= limit, "ACQ_SIZE")
                output.write(chunk)
                h512.update(chunk)
                h256.update(chunk)
        output.flush()
        os.fsync(output.fileno())
    need(count == package["bytes"] and base64.b64encode(h512.digest()).decode("ascii") ==
         package["sha512"], "ACQ_HASH")
    disk, _ = held(target, clock, count, h256.hexdigest(), package["sha512"], maximum=limit)
    return disk


def zip_inventory(archive, expected, limits, clock, allow_opc=False):
    infos = archive.infolist()
    expected = dict(expected)
    if allow_opc:
        envelopes = set()
        for item in infos:
            if item.filename not in expected:
                kind = opc_kind(item.filename)
                need(kind is not None and kind not in envelopes and
                     0 <= item.file_size <= 65536, "ACQ_OPC_ENVELOPE")
                envelopes.add(kind)
                expected[item.filename] = {"bytes": item.file_size, "compressed": item.compress_size}
        need(envelopes == {"relationships", "content-types", "core-properties"}, "ACQ_OPC_ENVELOPE")
    need(len(infos) == len(expected) and len(infos) <= limits["files"], "ACQ_ZIP_INVENTORY")
    seen, ranges, total = set(), [], 0
    for item in infos:
        clock.remaining()
        name = member_name(item.filename)
        need(not item.is_dir() and name.casefold() not in seen and name in expected,
             "ACQ_ZIP_INVENTORY")
        seen.add(name.casefold())
        mode = item.external_attr >> 16
        need(stat.S_IFMT(mode) in (0, stat.S_IFREG) and not (item.external_attr & 0x10), "ACQ_ZIP_TYPE")
        need(item.compress_type in (0, 8) and not (item.flag_bits & ~0x808), "ACQ_ZIP_TYPE")
        need(item.file_size == expected[name]["bytes"] and
             item.compress_size == expected[name]["compressed"] and
             0 <= item.file_size <= limits["memberBytes"], "ACQ_ZIP_SIZE")
        total += item.file_size
        need(total <= limits["expandedBytes"], "ACQ_ZIP_SIZE")
        start = item.header_offset
        need(0 <= start < archive.start_dir, "ACQ_ZIP_RANGE")
        archive.fp.seek(start)
        header = archive.fp.read(30)
        need(len(header) == 30 and header[:4] == b"PK\x03\x04", "ACQ_ZIP_RANGE")
        _, version, flags, method, _, _, crc, compressed, expanded, name_len, extra_len = struct.unpack("<I5H3I2H", header)
        need(version < 45 and flags == item.flag_bits and method == item.compress_type,
             "ACQ_ZIP_RANGE")
        name_bytes = archive.fp.read(name_len)
        need(name_bytes == name.encode("ascii"), "ACQ_ZIP_RANGE")
        end = start + 30 + name_len + extra_len + item.compress_size
        need(end <= archive.start_dir, "ACQ_ZIP_RANGE")
        if flags & 8:
            archive.fp.seek(end)
            first = archive.fp.read(4)
            need(len(first) == 4, "ACQ_ZIP_RANGE")
            has_signature = first == b"PK\x07\x08"
            data = archive.fp.read(12) if has_signature else first + archive.fp.read(8)
            need(len(data) == 12 and struct.unpack("<III", data) ==
                 (item.CRC, item.compress_size, item.file_size), "ACQ_ZIP_RANGE")
            end += 16 if has_signature else 12
        else:
            need((crc, compressed, expanded) == (item.CRC, item.compress_size, item.file_size),
                 "ACQ_ZIP_RANGE")
        need(end <= archive.start_dir, "ACQ_ZIP_RANGE")
        ranges.append((start, end))
    need({x.filename for x in infos} == set(expected), "ACQ_ZIP_INVENTORY")
    ranges.sort()
    need(not ranges or ranges[0][0] == 0, "ACQ_ZIP_RANGE")
    need(all(a[1] <= b[0] for a, b in zip(ranges, ranges[1:])), "ACQ_ZIP_OVERLAP")
    return infos


def bounded_zip_headers(stream, max_files, clock):
    """Bound central-directory allocation/entry count before constructing ZipFile."""
    clock.remaining()
    stream.seek(0, 2)
    length = stream.tell()
    need(22 <= length <= 192 * 1024**2, "ACQ_ZIP_RANGE")
    amount = min(length, 65557)
    stream.seek(length - amount)
    tail = stream.read(amount)
    at = tail.rfind(b"PK\x05\x06")
    need(at >= 0 and at + 22 <= len(tail), "ACQ_ZIP_RANGE")
    _, disk, cd_disk, disk_count, count, size, offset, comment = struct.unpack(
        "<I4H2IH", tail[at:at + 22])
    need(disk == cd_disk == 0 and disk_count == count and count <= max_files and
         count < 65535 and size <= 8 * 1024**2 and at + 22 + comment == len(tail) and
         offset + size == length - amount + at, "ACQ_ZIP_RANGE")
    current = offset
    for _ in range(count):
        clock.remaining()
        stream.seek(current)
        header = stream.read(46)
        need(len(header) == 46 and header[:4] == b"PK\x01\x02", "ACQ_ZIP_RANGE")
        name_size, extra_size, comment_size, start_disk = struct.unpack("<4H", header[28:36])
        need(0 < name_size <= 160 and start_disk == 0, "ACQ_ZIP_RANGE")
        current += 46 + name_size + extra_size + comment_size
        need(current <= offset + size, "ACQ_ZIP_RANGE")
    need(current == offset + size, "ACQ_ZIP_RANGE")
    stream.seek(0)


def mkdir_owned(root, relative, clock):
    current = plain(root)
    for part in PurePosixPath(relative).parts:
        clock.remaining()
        need(part not in (".", "..", "/"), "ACQ_PATH")
        plain(current)
        current = current / part
        if not current.exists():
            current.mkdir()
        plain(current)
    return current


def extract(archive_path, package, entries, mapping, root, limits, clock, allow_opc=False):
    rows = []
    archive_path = plain(archive_path)
    before = archive_path.lstat()
    need(stat.S_ISREG(before.st_mode) and before.st_nlink == 1, "ACQ_FILE")
    with Path(archive_path).open("rb") as held_archive:
        fd_before = os.fstat(held_archive.fileno())
        need(shared(before) == shared(fd_before), "ACQ_IDENTITY")
        bounded_zip_headers(held_archive, limits["files"], clock)
        with zipfile.ZipFile(held_archive) as archive:
            infos = zip_inventory(archive, entries, limits, clock, allow_opc)
            for item in infos:
                clock.remaining()
                if (package["id"], item.filename) in mapping:
                    relative = mapping[(package["id"], item.filename)]
                else:
                    need(allow_opc and opc_kind(item.filename) is not None, "ACQ_OPC_ENVELOPE")
                    relative = "metadata/" + package["id"] + "/" + item.filename
                target = root.joinpath(*PurePosixPath(relative).parts)
                need(target.is_relative_to(root), "ACQ_PATH")
                mkdir_owned(root, PurePosixPath(relative).parent.as_posix(), clock)
                h, count = hashlib.sha256(), 0
                with archive.open(item, "r") as source, target.open("xb") as destination_file:
                    while True:
                        clock.remaining()
                        chunk = source.read(CHUNK)
                        if not chunk:
                            break
                        count += len(chunk)
                        need(count <= item.file_size and count <= limits["memberBytes"], "ACQ_ZIP_SIZE")
                        destination_file.write(chunk)
                        h.update(chunk)
                need(count == item.file_size, "ACQ_ZIP_SIZE")
                rows.append({"path": relative, "package": package["id"], "member": item.filename,
                             "bytes": count, "sha256": h.hexdigest(),
                             "kind": "catalog-payload" if item.filename in entries else "opc-envelope"})
        fd_after = os.fstat(held_archive.fileno())
        need(signature(fd_before) == signature(fd_after), "ACQ_CHANGED")
    after = Path(archive_path).lstat()
    need(signature(before) == signature(after) and shared(after) == shared(fd_after), "ACQ_CHANGED")
    return rows


def verify_outputs(root, rows, clock):
    children = {}
    for row in rows:
        parts = PurePosixPath(row["path"]).parts
        for index in range(1, len(parts)):
            parent = "/".join(parts[:index])
            children.setdefault(parent, set()).add(parts[index])
    # Visit only catalog-derived directories; reject unknown names before opening them.
    for relative, expected in children.items():
        clock.remaining()
        parent = plain(root.joinpath(*PurePosixPath(relative).parts))
        seen = set()
        with os.scandir(parent) as entries:
            for entry in entries:
                clock.remaining()
                need(entry.name in expected and entry.name not in seen, "ACQ_OUTPUT_SET")
                seen.add(entry.name)
                need(len(seen) <= len(expected), "ACQ_OUTPUT_SET")
        need(seen == expected, "ACQ_OUTPUT_SET")
    for item in rows:
        clock.remaining()
        held(root / item["path"], clock, item["bytes"], item["sha256"], maximum=128 * 1024**2)


def fixed_download(spec, target, clock, maximum, allowed_url, open_url=None):
    """One unauthenticated fixed request; no replay, redirect or size inference."""
    need(spec["url"] == allowed_url and type(spec["bytes"]) is int and
         0 < spec["bytes"] <= maximum, "ACQ_FIXED_SPEC")
    plain(target, exists=False)
    count, digest = 0, hashlib.sha256()
    with Path(target).open("xb") as output:
        request = urllib.request.Request(allowed_url, headers={"User-Agent": "owned-arm-toolchain/1"})
        with (open_url or opener().open)(request, timeout=min(15, clock.remaining())) as response:
            need(response.status == 200 and response.geturl() == allowed_url and
                 response.headers.get("Content-Encoding") in (None, "identity") and
                 response.headers.get("Content-Length") == str(spec["bytes"]), "ACQ_RESPONSE")
            while True:
                clock.remaining()
                chunk = response.read(CHUNK)
                if not chunk:
                    break
                count += len(chunk)
                need(count <= spec["bytes"] and count <= maximum, "ACQ_SIZE")
                output.write(chunk)
                digest.update(chunk)
            output.flush()
            os.fsync(output.fileno())
    need(count == spec["bytes"] and digest.hexdigest() == spec["sha256"], "ACQ_HASH")
    return {"path": str(target), **held(target, clock, count, spec["sha256"], maximum=maximum)[0]}


def tar_name(value):
    # Tar directories alone may have one trailing slash; no normalization aliases.
    need(type(value) is str and len(value) <= 240 and not value.startswith(("/", "\\")) and
         "\\" not in value and ":" not in value and
         all(32 <= ord(c) < 127 for c in value), "ACQ_TAR_PATH")
    value = value[:-1] if value.endswith("/") else value
    need(value and all(p not in ("", ".", "..") for p in value.split("/")), "ACQ_TAR_PATH")
    return value


class MtimeTarInfo(tarfile.TarInfo):
    """Only the fixed LLVM archive's bounded, local numeric-mtime envelope.

    Read the next raw header directly: no PAX overrides, globals, chained
    metadata, GNU long names, or sparse records can alter its identity/range.
    The timestamp is validated, not restored to extracted files.
    """
    def _proc_pax(self, stream):
        need(self.type == tarfile.XHDTYPE and self.name == "././@PaxHeader" and
             not self.linkname and not (self.mode & (stat.S_ISUID | stat.S_ISGID)) and
             0 < self.size <= 64 and not stream.pax_headers, "ACQ_TAR_PAX")
        payload = stream.fileobj.read(512)
        need(len(payload) == 512 and not any(payload[self.size:]), "ACQ_TAR_PAX")
        record = payload[:self.size]
        match = re.fullmatch(rb"([1-9][0-9]?) mtime=([0-9]{1,12}(?:\.[0-9]{1,9})?)\n", record)
        need(match is not None and int(match[1]) == self.size, "ACQ_TAR_PAX")
        header_offset = self.offset + 1024
        need(stream.fileobj.tell() == header_offset, "ACQ_TAR_OFFSET")
        header = stream.fileobj.read(512)
        need(len(header) == 512, "ACQ_TAR_OFFSET")
        following = self.frombuf(header, stream.encoding, stream.errors)
        need(following.type in (tarfile.REGTYPE, tarfile.AREGTYPE, tarfile.CONTTYPE, tarfile.DIRTYPE) and
             not following.linkname and
             not following.pax_headers, "ACQ_TAR_TYPE")
        following.offset = header_offset
        following._proc_builtin(stream)
        need(following.offset_data == header_offset + 512, "ACQ_TAR_OFFSET")
        following.offset = self.offset
        following.pax_headers = {"mtime": match[2].decode("ascii")}
        following.mtime_envelope_bytes = 1024
        return following


def tar_metadata_valid(item):
    envelope = getattr(item, "mtime_envelope_bytes", 0)
    return ((envelope == 0 and not item.pax_headers) or
            (envelope == 1024 and set(item.pax_headers) == {"mtime"})) and \
        item.offset_data == item.offset + 512 + envelope


def extract_tar(archive, output, limits, clock):
    """Strict streaming regular-file/directory projection. Unknown formats deny."""
    plain(output, exists=False)
    Path(output).mkdir()
    before = plain(archive).stat()
    rows, seen, spellings, total, entries = [], set(), {}, 0, 0
    with Path(archive).open("rb") as source:
        f0 = os.fstat(source.fileno())
        need(shared(before) == shared(f0), "ACQ_IDENTITY")
        with tarfile.open(fileobj=source, mode="r|xz", tarinfo=MtimeTarInfo) as stream:
            for item in stream:
                clock.remaining()
                entries += 1
                need(entries <= limits["tarFiles"], "ACQ_TAR_COUNT")
                name = tar_name(item.name)
                need(name.casefold() not in seen and tar_metadata_valid(item) and
                     (item.isfile() or item.isdir()) and not item.linkname and
                     not (item.mode & (stat.S_ISUID | stat.S_ISGID)), "ACQ_TAR_TYPE")
                parts = name.split("/")
                for length in range(1, len(parts) + 1):
                    spelling = "/".join(parts[:length])
                    need(spellings.get(spelling.casefold(), spelling) == spelling, "ACQ_TAR_CASE")
                    spellings[spelling.casefold()] = spelling
                seen.add(name.casefold())
                need(0 <= item.size <= limits["tarMemberBytes"] and
                     (item.isfile() or item.size == 0), "ACQ_TAR_SIZE")
                total += item.size
                need(total <= limits["tarExpandedBytes"], "ACQ_TAR_SIZE")
                target = Path(output).joinpath(*name.split("/"))
                if item.isdir():
                    mkdir_owned(output, name, clock)
                    continue
                mkdir_owned(output, str(PurePosixPath(name).parent), clock)
                count, digest = 0, hashlib.sha256()
                with stream.extractfile(item) as member, target.open("xb") as dest:
                    while True:
                        clock.remaining()
                        data = member.read(CHUNK)
                        if not data:
                            break
                        count += len(data)
                        need(count <= item.size, "ACQ_TAR_SIZE")
                        dest.write(data)
                        digest.update(data)
                need(count == item.size, "ACQ_TAR_SIZE")
                rows.append({"path": name, "bytes": count, "sha256": digest.hexdigest()})
                held(target, clock, count, digest.hexdigest(), maximum=limits["tarMemberBytes"])
        need(signature(f0) == signature(os.fstat(source.fileno())), "ACQ_CHANGED")
    need(signature(before) == signature(Path(archive).stat()), "ACQ_CHANGED")
    return rows


def acquire_sdk(root, profile, clock):
    """Called only by the fixed diagnostic controller; contents never executed here."""
    root = plain(root)
    metadata, archives = root / "metadata-inputs", root / "archives"
    metadata.mkdir()
    archives.mkdir()
    packages, catalogs, archive_rows, outputs = [], {}, [], []
    sdk_end = min(clock.wall_end, time.time() + profile["limits"]["sdkSeconds"])
    sdk_clock = Clock(sdk_end, min(clock.mono_end, time.monotonic() + profile["limits"]["sdkSeconds"]))
    for original in profile["sdk"]["packages"]:
        package = json.loads(json.dumps(original))
        spec = package["catalog"]
        need(re.fullmatch(r"https://api\.nuget\.org/v3/catalog0/data/[0-9.TZ:-]+/"
                          r"microsoft\.windows\.sdk\.cpp(?:\.(?:arm64|x64|x86))?\.10\.0\.28000\.2270\.json", spec["url"]), "ACQ_CATALOG_URL")
        file = metadata / (package["id"] + ".json")
        fixed_download(spec, file, sdk_clock, 4 * 1024**2, spec["url"])
        spec["path"] = str(file)
        catalogs[package["id"]] = catalog_entries(package, sdk_clock)
        packages.append(package)
    need(tuple(p["id"] for p in packages) == IDS and sum(p["bytes"] for p in packages) == TOTAL_COMPRESSED and
         sum(p["members"] for p in packages) == TOTAL_FILES and
         sum(p["expandedBytes"] for p in packages) == TOTAL_EXPANDED, "ACQ_PROFILE")
    mapping = projection(packages, catalogs)
    for package in packages:
        target = archives / (package["id"] + ".nupkg")
        record = download(package, target, sdk_clock, profile["sdk"]["limits"]["fileCompressedBytes"])
        need(record["sha256"] == package["sha256"], "ACQ_HASH")
        archive_rows.append({"role": package["id"], "path": str(target), **record})
        outputs += extract(target, package, catalogs[package["id"]], mapping, root,
                           profile["sdk"]["limits"], sdk_clock, allow_opc=True)
    need(len(outputs) == TOTAL_FILES + 12 and sum(x["bytes"] for x in outputs) <=
         profile["sdk"]["limits"]["expandedBytes"], "ACQ_OUTPUT_SET")
    verify_outputs(root, outputs, sdk_clock)
    sdk_clock.remaining()
    result = {"archives": archive_rows, "sdkFiles": outputs, "compilerExecuted": False, "outputExecuted": False}
    save(root / "sdk-acquisition.json", result)
    return result


def acquire_llvm(root, profile, clock):
    root = plain(root)
    _, raw_sdk = held(root / "sdk-acquisition.json", clock, retain=True, maximum=8 * 1024**2)
    sdk = json.loads(raw_sdk)
    archive_rows, outputs = sdk["archives"], sdk["sdkFiles"]
    archives = root / "archives"
    llvm = dict(profile["llvm"])
    llvm["url"] = "https://commondatastorage.googleapis.com/chromium-browser-clang/" + llvm["object"] + "?generation=" + llvm["generation"]
    target = archives / "clang.tar.xz"
    archive_rows.append({"role": "clang24", **fixed_download(llvm, target, clock, 192 * 1024**2, llvm["url"])})
    llvm_rows = extract_tar(target, root / "llvm", profile["limits"], clock)
    held(root / "llvm/bin/clang-cl.exe", clock, sha256=llvm["clangSha256"], maximum=256 * 1024**2)
    held(root / "llvm/bin/lld-link.exe", clock, sha256=llvm["lldSha256"], maximum=256 * 1024**2)
    # Targeted upstream setup reader and its actual two stdlib-only imports.
    for original in profile["upstreamSources"]:
        file = root / "chromium" / original["path"]
        mkdir_owned(root, str(PurePosixPath("chromium/" + original["path"]).parent), clock)
        need(original["url"] == "https://chromium.googlesource.com/chromium/src/+/" +
             profile["sourceChromium"] + "/" + original["path"] + "?format=TEXT", "ACQ_SOURCE_URL")
        with opener().open(urllib.request.Request(original["url"]), timeout=min(15, clock.remaining())) as response:
            need(response.status == 200 and response.geturl() == original["url"], "ACQ_RESPONSE")
            encoded = response.read(4 * 1024**2 + 1)
            need(len(encoded) <= 4 * 1024**2, "ACQ_SOURCE_SIZE")
        raw = base64.b64decode(encoded, validate=True)
        need(len(raw) == original["bytes"] and hashlib.sha256(raw).hexdigest() == original["sha256"], "ACQ_SOURCE_PIN")
        with file.open("xb") as stream:
            stream.write(raw)
        held(file, clock, len(raw), original["sha256"], maximum=4 * 1024**2)
    result = {"archives": archive_rows, "sdkFiles": outputs, "llvmFiles": llvm_rows,
              "rustAcquired": False, "extraRuntimeSelected": False, "signatureVerified": False,
              "sdkBuilt": False, "outputExecuted": False}
    save(root / "acquisition.json", result)
    return result


# Bootstrap additions below do not execute any acquired file. The prefix above
# is the reviewed 8872 SDK/LLVM data acquisition implementation.
CIPD_FIXED = {
    "gn-archive": ("gn/gn/windows-amd64", "git_revision:150a9d6ba0aa7f407aa4feeabc5f03ce9aa7e04b"),
    "siso-archive": ("build/siso/windows-amd64", "git_revision:efbbe7f1892211b5e9512576843a3c247b6a6d7c"),
}
CIPD_RPC = "https://chrome-infra-packages.appspot.com/prpc/cipd.Repository/"


def cipd_reply(raw):
    need(type(raw) is bytes and len(raw) <= 65536 and raw.startswith(b")]}'\n"), "BOOT_CIPD_JSON")
    def pairs(items):
        output = {}
        for key, value in items:
            need(key not in output, "BOOT_CIPD_DUPLICATE_KEY")
            output[key] = value
        return output
    return json.loads(raw[5:].decode("utf-8", errors="strict"), object_pairs_hook=pairs)


def cipd_ref(reply, package):
    need(type(reply) is dict and reply.get("package") == package, "BOOT_CIPD_PACKAGE")
    ref = reply.get("instance")
    need(type(ref) is dict and set(ref) == {"hashAlgo", "hexDigest"} and
         ref["hashAlgo"] == "SHA256" and type(ref["hexDigest"]) is str and
         re.fullmatch("[a-f0-9]{64}", ref["hexDigest"]), "BOOT_CIPD_REF")
    # LUCI repo.proto: SHA256 instance ID = URL-safe unpadded(digest || algo2).
    return {"hashAlgo": "SHA256", "hexDigest": ref["hexDigest"]}


def cipd_rpc(method, body, clock, open_url=None):
    need(method in ("ResolveVersion", "GetInstanceURL"), "BOOT_CIPD_METHOD")
    url = CIPD_RPC + method
    raw = json.dumps(body, separators=(",", ":")).encode("ascii")
    need(len(raw) <= 1024, "BOOT_CIPD_REQUEST_BOUND")
    request = urllib.request.Request(url, data=raw, method="POST", headers={
        "Content-Type": "application/json", "Accept": "application/json"})
    with (open_url or opener().open)(request, timeout=min(15, clock.remaining())) as response:
        need(response.status == 200 and response.geturl() == url and
             response.headers.get("X-Prpc-Grpc-Code") == "0" and
             response.headers.get("Content-Encoding") in (None, "identity"), "BOOT_CIPD_RESPONSE")
        data = response.read(65537)
        need(len(data) <= 65536, "BOOT_CIPD_METADATA_BOUND")
    clock.remaining()
    return cipd_reply(data)


def cipd_url(reply):
    from urllib.parse import urlsplit
    need(type(reply) is dict and set(reply) == {"signedUrl"} and
         type(reply["signedUrl"]) is str and len(reply["signedUrl"]) <= 16384,
         "BOOT_CIPD_URL")
    url = reply["signedUrl"]
    need(not any(ord(c) < 33 or ord(c) > 126 for c in url), "BOOT_CIPD_URL")
    parsed = urlsplit(url)
    need(parsed.scheme == "https" and parsed.hostname is not None and
         (parsed.hostname == "storage.googleapis.com" or
          parsed.hostname.endswith(".storage.googleapis.com")) and
         parsed.port in (None, 443) and parsed.username is None and
         parsed.password is None and not parsed.fragment, "BOOT_CIPD_URL")
    return url


def cipd_zip_inventory(file, profile, clock):
    """Observe all archived bytes; no extraction and no executable invocation."""
    limits = profile["limits"]
    archive_before = plain(file).stat()
    need(stat.S_ISREG(archive_before.st_mode) and archive_before.st_nlink == 1 and
         archive_before.st_size <= limits["cipdArchiveBytes"], "BOOT_CIPD_ARCHIVE_FILE")
    names, output, expanded = set(), [], 0
    with Path(file).open("rb") as stream:
        fd_before = os.fstat(stream.fileno())
        need(shared(fd_before) == shared(archive_before), "ACQ_IDENTITY")
        bounded_zip_headers(stream, limits["cipdFiles"], clock)
        with zipfile.ZipFile(stream) as archive:
            infos = archive.infolist()
            need(0 < len(infos) <= limits["cipdFiles"], "BOOT_CIPD_FILES")
            for info in infos:
                clock.remaining()
                need(info.orig_filename == info.filename, "ACQ_MEMBER_PATH")
                name = member_name(info.filename[:-1] if info.is_dir() else info.filename)
                need(name.casefold() not in names, "BOOT_CIPD_ALIAS")
                names.add(name.casefold())
                mode = info.external_attr >> 16
                need(not mode & 0o7000 and stat.S_IFMT(mode) in
                     (0, stat.S_IFDIR if info.is_dir() else stat.S_IFREG) and
                     not info.flag_bits & 1 and info.compress_type in
                     (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED), "BOOT_CIPD_TYPE")
                need(0 <= info.file_size <= limits["cipdExpandedBytes"], "BOOT_CIPD_MEMBER_BOUND")
                expanded += info.file_size
                need(expanded <= limits["cipdExpandedBytes"], "BOOT_CIPD_EXPANDED_BOUND")
                digest, count = hashlib.sha256(), 0
                with archive.open(info) as member:
                    while data := member.read(CHUNK):
                        clock.remaining();count += len(data)
                        need(count <= info.file_size, "BOOT_CIPD_MEMBER_BOUND")
                        digest.update(data)
                need(count == info.file_size and (not info.is_dir() or count == 0), "BOOT_CIPD_SIZE")
                output.append({"name": name, "directory": info.is_dir(), "bytes": count,
                               "sha256": digest.hexdigest()})
        need(signature(os.fstat(stream.fileno())) == signature(fd_before), "ACQ_CHANGED")
    need(signature(Path(file).stat()) == signature(archive_before), "ACQ_CHANGED")
    return output


def acquire_cipd(root, role, profile, clock, rpc=cipd_rpc, open_url=None):
    need(role in CIPD_FIXED, "BOOT_CIPD_ROLE")
    package, version = CIPD_FIXED[role]
    spec = next(row for row in profile["cipd"] if row["role"] == role)
    need((spec["package"], spec["version"]) == (package, version) and
         spec["maximumBytes"] == 128 * 1024**2, "BOOT_CIPD_PROFILE")
    body = {"package": package, "version": version}
    ref = cipd_ref(rpc("ResolveVersion", body, clock), package)
    need(ref == spec['instance'] and spec['archiveSha256'] == ref['hexDigest'], 'FULL_CIPD_IMMUTABLE')
    url = cipd_url(rpc("GetInstanceURL", {"package": package, "instance": ref}, clock))
    file = plain(root) / "archives" / (role + ".zip")
    plain(file, exists=False)
    count, digest = 0, hashlib.sha256()
    with file.open("xb") as output:
        with (open_url or opener().open)(urllib.request.Request(url),
                                        timeout=min(15, clock.remaining())) as response:
            size = response.headers.get("Content-Length", "")
            need(response.status == 200 and response.geturl() == url and
                 response.headers.get("Content-Encoding") in (None, "identity") and
                 re.fullmatch("[1-9][0-9]{0,8}", size) and
                 int(size) <= spec["maximumBytes"], "BOOT_CIPD_PAYLOAD_RESPONSE")
            while data := response.read(CHUNK):
                clock.remaining();count += len(data)
                need(count <= int(size) and count <= spec["maximumBytes"], "BOOT_CIPD_ARCHIVE_BOUND")
                output.write(data);digest.update(data)
            output.flush();os.fsync(output.fileno())
    need(count == int(size) and digest.hexdigest() == ref["hexDigest"], "BOOT_CIPD_HASH")
    row, _ = held(file, clock, count, ref["hexDigest"], maximum=spec["maximumBytes"])
    members = cipd_zip_inventory(file, profile, clock)
    need(cipd_ref(rpc("ResolveVersion", body, clock), package) == ref, "BOOT_CIPD_TAG_CHANGED")
    result = {"role": role, "package": package, "version": version,
              "instance": ref, "instanceId": base64.urlsafe_b64encode(
                  bytes.fromhex(ref["hexDigest"]) + bytes([2])).decode().rstrip("="),
              "archive": row, "members": members, "extracted": False, "executed": False}
    save(Path(root) / (role + ".json"), result)
    return result


def acquire_rust_archive(root, profile, clock):
    spec = dict(profile["rust"])
    need(spec["bytes"] == 414479372 and spec["sha256"] ==
         "14bc9cea5e00cb191f58204ef44d68a6794f856a76f885c50298a12d052035bc" and
         spec["generation"] == "1786821099612317" and spec["maximumBytes"] == 512 * 1024**2,
         "BOOT_RUST_PROFILE")
    spec["url"] = "https://commondatastorage.googleapis.com/chromium-browser-clang/" + spec["object"] + "?generation=" + spec["generation"]
    row = fixed_download(spec, Path(root) / "archives/rust.tar.xz", clock,
                         512 * 1024**2, spec["url"])
    result = {"archive": row, "extracted": False, "formatObserved": False,
              "rustExecuted": False, "targetStdProven": False}
    save(Path(root) / "rust-archive.json", result)
    return result
