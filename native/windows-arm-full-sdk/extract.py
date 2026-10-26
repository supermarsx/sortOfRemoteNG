"""Closed data materialization only. No acquired image is executed."""
import hashlib
import json
import lzma
import os
from pathlib import Path
import re
import stat
import struct
import zipfile
import base64
from contextlib import contextmanager
import acquire as data
need = data.need
Denied = data.Denied
CHUNK = 65536
CAPS = {"compressed":512*1024**2,"expanded":6*1024**3,"member":1024**3,"headers":25000,"metadata":65536,"name":240,"memory":128*1024**2}
FILE_CLOSE_FAILURE = False


@contextmanager
def unchanged_archive(path, spec, clock, maximum):
    """Hash the same held archive before and after parsing; preserve first failure."""
    held(path, clock, spec['bytes'], spec['sha256'], maximum=maximum)
    path=plain(path);before=path.stat();stream=path.open('rb');primary=None
    try:
        fd=os.fstat(stream.fileno());need(shared(before)==shared(fd),'FULL_ARCHIVE_IDENTITY')
        yield stream
        need(signature(fd)==signature(os.fstat(stream.fileno())) and
             signature(before)==signature(path.stat()),'FULL_ARCHIVE_CHANGED')
    except BaseException as error:
        primary=error
        raise
    finally:
        global FILE_CLOSE_FAILURE
        try:stream.close()
        except BaseException:
            FILE_CLOSE_FAILURE=True
            if primary is None:raise
    held(path,clock,spec['bytes'],spec['sha256'],maximum=maximum)


def rust_member_name(name):
    """Rust package paths only; retain the SDK Windows component restrictions."""
    need(type(name) is str and 0 < len(name) <= 240 and name.isascii(), 'FULL_RUST_MEMBER_PATH')
    need(re.fullmatch(r'[A-Za-z0-9_ ./+@\-]+', name) is not None, 'FULL_RUST_MEMBER_PATH')
    parts = name.split('/')
    need(all(p and p not in ('.', '..') and not p.endswith(('.', ' ')) for p in parts), 'FULL_RUST_MEMBER_PATH')
    for part in parts:
        stem = part.split('.')[0].casefold()
        need(stem not in {'con', 'prn', 'aux', 'nul'} and
             not re.fullmatch(r'(?:com|lpt)[1-9]', stem), 'FULL_RUST_MEMBER_PATH')
    return name


def owned_destination(root, name, directory, clock, *, rust=False):
    clock.remaining();root=plain(root);name=rust_member_name(name) if rust else data.member_name(name)
    parts=name.split('/');current=root
    for part in parts if directory else parts[:-1]:
        current=current/part
        try:current.mkdir()
        except FileExistsError:pass
        plain(current);need(current.is_dir(),'FULL_DESTINATION_KIND')
    target=root/name
    if not directory:plain(target,exists=False)
    return target


def write_member(root,name,reader,size,clock,expected_sha=None, *, rust=False):
    target=owned_destination(root,name,False,clock,rust=rust);parent=target.parent
    before=directory_identity(signature(parent.stat()));primary=None;stream=target.open('xb')
    digest=hashlib.sha256();count=0
    try:
        opened=os.fstat(stream.fileno())
        need(stat.S_ISREG(opened.st_mode) and opened.st_nlink==1,'FULL_DESTINATION_FILE')
        # Creating our one leaf is an explicit transition; retain the post-create parent.
        parent_after_create=directory_identity(signature(plain(parent).stat()))
        need(before[:2]==parent_after_create[:2],'FULL_DESTINATION_PARENT')
        while count<size:
            clock.remaining();chunk=reader.read(min(CHUNK,size-count))
            need(chunk and len(chunk)<=size-count,'FULL_MEMBER_TRUNCATED')
            need(stream.write(chunk)==len(chunk),'FULL_MEMBER_WRITE')
            digest.update(chunk);count+=len(chunk)
        stream.flush();os.fsync(stream.fileno())
        need(directory_identity(signature(plain(parent).stat()))==parent_after_create,'FULL_DESTINATION_PARENT')
        need(shared(os.fstat(stream.fileno()))==shared(target.stat()),'FULL_DESTINATION_CHANGED')
    except BaseException as error:
        primary=error
        raise
    finally:
        global FILE_CLOSE_FAILURE
        try:stream.close()
        except BaseException:
            FILE_CLOSE_FAILURE=True
            if primary is None:raise
    sha=digest.hexdigest();need(expected_sha is None or sha==expected_sha,'FULL_MEMBER_HASH')
    row,_=held(target,clock,size,sha,maximum=max(size,1))
    return {'path':name,'bytes':size,'sha256':sha,'independentFile':True,'identity':row['identity']}


def rust_archive(archive,output,spec,clock,limits=None):
    """Full effective-path inventory; PAX values never become filesystem metadata."""
    limits=dict(CAPS if limits is None else limits);output=plain(output,exists=False);output.mkdir()
    rows=[];seen=set();spellings={};topology={};pending=False;pending_path=None
    headers=payload=offset=report_bytes=0
    with unchanged_archive(archive,spec,clock,limits['compressed']) as source:
        reader=XZReader(source,clock,limits)
        while True:
            clock.remaining();header=reader.exact(512)
            if not any(header):
                need(not any(reader.exact(512)),'IDX_TAR_END')
                while chunk:=reader.read(CHUNK):need(not any(chunk),'IDX_TAR_TRAILING')
                break
            headers+=1;need(headers<=limits['headers'],'IDX_HEADER_CAP')
            need(header[257:263]==b'ustar\0','IDX_TAR_FORMAT')
            need(number(header[148:156])==sum(header[:148])+8*32+sum(header[156:]),'IDX_TAR_CHECKSUM')
            kind=header[156];size=number(header[124:136]);mode=number(header[100:108])
            need(not any(header[157:257]),'IDX_TAR_LINKNAME')
            need(size<=limits['member'] and not mode&0o7000,'IDX_MEMBER_CAP')
            payload+=size;need(payload<=limits['expanded'],'IDX_EXPANDED_CAP')
            raw=public_name(header[:100],limits['name'])
            if any(header[345:500]):raw=public_name(header[345:500],limits['name'])+'/'+raw
            if kind==ord('x'):
                need(not pending and size<=limits['metadata'],'IDX_METADATA_CHAIN')
                metadata=reader.exact(size);pending_path=local_pax(metadata);pending=True
                metadata_sha=hashlib.sha256(metadata).hexdigest()
            else:
                need(kind in (0,ord('0'),ord('5')),'IDX_LOCAL_PAX_TYPE')
                name=effective_name(raw,header,pending_path);safe_member(name)
                name=rust_member_name(name.rstrip('/'));key=name.casefold()
                need(key not in seen,'IDX_TAR_DUPLICATE');seen.add(key)
                parts=name.split('/')
                for i in range(1,len(parts)+1):
                    part='/'.join(parts[:i]);need(spellings.get(part.casefold(),part)==part,'IDX_TAR_CASE');spellings[part.casefold()]=part
                    if i<len(parts):need(topology.get(part.casefold(),True),'IDX_TAR_TOPOLOGY');topology[part.casefold()]=True
                directory=kind==ord('5')
                need(key not in topology or topology[key] and directory,'IDX_TAR_TOPOLOGY');topology[key]=directory
                if directory:
                    need(size==0,'IDX_TAR_TYPE');owned_destination(output,name,True,clock,rust=True)
                    row={'path':name,'directory':True,'bytes':0}
                else:row=write_member(output,name,reader,size,clock,rust=True)
                row.update(rawHeaderName=raw,headerOffset=offset,paxPayloadSha256=metadata_sha if pending else None)
                report_bytes+=len(json.dumps(row).encode())+2;need(report_bytes<=16*1024**2,'FULL_INVENTORY_BOUND');rows.append(row)
                pending=False;pending_path=None
            need(not any(reader.exact((-size)%512)),'IDX_TAR_PADDING');offset+=512+size+(-size)%512
        need(not pending,'IDX_METADATA_CHAIN')
    return {'kind':'windows-arm-full-rust-extraction','files':sorted(rows,key=lambda r:r['path']),
            'headers':headers,'expandedStreamBytes':reader.total,'executed':False,'targetStdProven':False}


def cipd_archive(archive,output,spec,profile,clock):
    need(spec['role'] in ('gn-archive','siso-archive') and
         spec['instance']=={'hashAlgo':'SHA256','hexDigest':spec['archiveSha256']},'FULL_CIPD_INSTANCE')
    expected=spec['members'];actual=data.cipd_zip_inventory(archive,profile,clock)
    need(actual==expected,'FULL_CIPD_INVENTORY')
    output=plain(output,exists=False);output.mkdir();rows=[]
    with unchanged_archive(archive,{'bytes':spec['archiveBytes'],'sha256':spec['archiveSha256']},clock,profile['limits']['cipdArchiveBytes']) as stream:
        with zipfile.ZipFile(stream)as zipped:
            for info,row in zip(zipped.infolist(),expected):
                clock.remaining();need(info.filename.rstrip('/')==row['name'],'FULL_CIPD_ORDER')
                if row['directory']:owned_destination(output,row['name'],True,clock)
                else:
                    with zipped.open(info)as member:rows.append(write_member(output,row['name'],member,row['bytes'],clock,row['sha256']))
    return {'kind':'windows-arm-full-cipd-extraction','role':spec['role'],'files':rows,'executed':False}


def runtime_projection(root,profile,clock):
    root=plain(root);rows=profile['runtime17']['rows']
    need(len(rows)==17 and sum(r['bytes']for r in rows)==21356560 and
         len({r['source'].casefold()for r in rows})==17 and len({r['destination'].casefold()for r in rows})==17,'FULL_RUNTIME_SET')
    projected=[]
    for row in rows:
        clock.remaining();need(row['destination'].startswith('runtime/x64/'if row['machine']==0x8664 else'runtime/arm64/') and row['machine']in(0x8664,0xaa64),'FULL_RUNTIME_ARCH')
        source=plain(row['source']);before=source.stat();parent=source.parent
        parent_before=signature(parent.stat())
        pin,raw=held(source,clock,row['bytes'],row['sha256'],retain=True,maximum=8*1024**2)
        pe=pe_metadata(raw)
        version='.'.join(map(str,pe['version']['fileVersion'])) if pe['version']is not None else None
        need(pe['machine']==row['machine'] and version==row['fileVersion'] and
             pe['imports']==row['imports'] and pe['delayImports']==row['delayImports'],'FULL_RUNTIME_PE')
        import io
        copied=write_member(root,row['destination'],io.BytesIO(raw),len(raw),clock,row['sha256'])
        destination=root/row['destination']
        need((before.st_dev,before.st_ino)!=(destination.stat().st_dev,destination.stat().st_ino),'FULL_RUNTIME_INDEPENDENT')
        held(source,clock,row['bytes'],row['sha256'],maximum=8*1024**2)
        need(signature(source.stat())==signature(before) and directory_identity(signature(parent.stat()))==directory_identity(parent_before),'FULL_RUNTIME_SOURCE_CHANGED')
        projected.append({'role':row['role'],'machine':pe['machine'],'version':version,'sourceFolderVersion':row['sourceFolderVersion'],**copied})
    return {'kind':'windows-arm-full-runtime-projection','files':projected,'executed':False,'sdk28000DebuggerClaim':False}

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

def directory_identity(value, platform=None):
    # Windows directory file-size values are informational, not content identity.
    # Retain the original full signature in observations and all file guards.
    need(len(value) == 8 and stat.S_ISDIR(value[5]), "INV_DIRECTORY_KIND")
    return value[:2] + value[3:] if (os.name if platform is None else platform) == "nt" else value

def shared(s):
    return (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_nlink,
            getattr(s, "st_birthtime_ns", None))

def held(path, clock, expected_size=None, sha256=None, sha512=None, retain=False,
         maximum=3 * 1024**2, progress=None):
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
            if progress is not None:
                progress(count)
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

class XZReader:
    def __init__(self, source, clock, limits):
        self.source, self.clock, self.limits = source, clock, limits
        self.decoder = lzma.LZMADecompressor(format=lzma.FORMAT_XZ, memlimit=limits["memory"])
        self.buffer, self.total, self.finished = b"", 0, False

    def read(self, count):
        need(0 < count <= CHUNK, "IDX_READ_BOUND")
        while not self.buffer and not self.finished:
            self.clock.remaining()
            if self.decoder.eof:
                trailing, extra = len(self.decoder.unused_data), self.decoder.unused_data
                need(not any(extra), "IDX_XZ_TRAILING")
                while True:
                    self.clock.remaining()
                    extra = self.source.read(CHUNK)
                    if not extra:
                        break
                    trailing += len(extra)
                    need(trailing <= self.limits["compressed"] and not any(extra), "IDX_XZ_TRAILING")
                need(trailing % 4 == 0, "IDX_XZ_TRAILING")
                self.finished = True
                break
            data = self.source.read(CHUNK) if self.decoder.needs_input else b""
            need(data or not self.decoder.needs_input, "IDX_XZ_TRUNCATED")
            try:
                self.buffer = self.decoder.decompress(data, max_length=CHUNK)
            except lzma.LZMAError:
                raise Denied("IDX_XZ_FORMAT") from None
            self.total += len(self.buffer)
            need(self.total <= self.limits["expanded"], "IDX_EXPANDED_CAP")
        result, self.buffer = self.buffer[:count], self.buffer[count:]
        return result

    def exact(self, count):
        need(0 <= count <= self.limits["metadata"], "IDX_METADATA_CAP")
        parts, left = [], count
        while left:
            data = self.read(min(CHUNK, left))
            need(data, "IDX_TAR_TRUNCATED")
            parts.append(data)
            left -= len(data)
        return b"".join(parts)

    def skip(self, count):
        while count:
            data = self.read(min(CHUNK, count))
            need(data, "IDX_TAR_TRUNCATED")
            count -= len(data)

def number(raw):
    value = raw.strip(b"\0 ")
    need(not value or re.fullmatch(rb"[0-7]{1,22}", value), "IDX_TAR_NUMBER")
    return int(value, 8) if value else 0

def public_name(raw, maximum):
    end = raw.find(b"\0")
    if end >= 0:
        need(not any(raw[end:]), "IDX_TAR_NAME")
        raw = raw[:end]
    need(0 < len(raw) <= maximum and all(32 <= x < 127 for x in raw), "IDX_TAR_NAME")
    return raw.decode("ascii")

def safe_member(name):
    value = name[:-1] if name.endswith("/") else name
    need(value and not value.startswith(("/", "\\")) and "\\" not in value and ":" not in value and
         all(x not in ("", ".", "..") for x in value.split("/")), "IDX_TAR_PATH")

def pax_keys(raw):
    keys, position = [], 0
    while position < len(raw):
        space = raw.find(b" ", position, min(len(raw), position + 9))
        need(space > position and re.fullmatch(rb"[1-9][0-9]{0,6}", raw[position:space]), "IDX_PAX_RECORD")
        length = int(raw[position:space])
        end = position + length
        need(space + 2 < end <= len(raw) and raw[end - 1:end] == b"\n", "IDX_PAX_RECORD")
        record = raw[space + 1:end - 1]
        need(b"=" in record and b"\0" not in record, "IDX_PAX_RECORD")
        try:
            record.decode("utf-8", "strict")
        except UnicodeDecodeError:
            raise Denied("IDX_PAX_UTF8") from None
        key, value = record.split(b"=", 1)
        need(re.fullmatch(rb"[A-Za-z_][A-Za-z0-9_.-]{0,63}", key), "IDX_PAX_KEY")
        key = key.decode("ascii")
        if key in ("path", "linkpath"):
            safe_member(public_name(value, CAPS["name"]))
        # No metadata values are applied or retained; names describe public syntax only.
        need(key not in keys and len(keys) < 64, "IDX_PAX_KEY")
        keys.append(key)
        position = end
    return keys

def local_pax(raw):
    keys = pax_keys(raw)
    need(set(keys) in ({"mtime"}, {"mtime", "path"}), "IDX_LOCAL_PAX_KEYS")
    values, position = {}, 0
    while position < len(raw):
        space = raw.index(b" ", position)
        end = position + int(raw[position:space])
        key, value = raw[space + 1:end - 1].split(b"=", 1)
        values[key.decode("ascii")] = value
        position = end
    need(re.fullmatch(rb"[0-9]{1,12}(?:\.[0-9]{1,9})?", values["mtime"]), "IDX_LOCAL_PAX_MTIME")
    path = None
    if "path" in values:
        path = public_name(values["path"], CAPS["name"])
        safe_member(path)
    return path

def effective_name(raw_name, header, path):
    if path is None:
        return raw_name
    need(path == raw_name or (not any(header[345:500]) and len(raw_name) == 100 and
         len(path) > 100 and path.startswith(raw_name)), "IDX_LOCAL_PAX_HEADER")
    return path

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
