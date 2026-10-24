"""Bounded engineering checkpoint transport. No arbitrary tar extraction or links."""
import argparse
import gzip
import hashlib
import io
import json
import os
import re
from pathlib import Path
import stat
import tarfile
import time
import unicodedata
import zipfile

MAX_BYTES = 32 * 1024**3
CHUNK_BYTES = 1024**3
MAX_RAW = 256 * 1024**3
MAX_ENTRIES = 300000
MAX_METADATA = 128 * 1024**2


class CheckpointError(ValueError):
    pass


def require(ok, reason):
    if not ok:
        raise CheckpointError(reason)


def relative(value):
    require(isinstance(value, str) and 0 < len(value.encode()) <= 1024, 'member-path')
    require(not value.startswith('/') and '\\' not in value and ':' not in value, 'member-path')
    parts = value.split('/')
    require(all(x not in ('', '.', '..') and not x.endswith((' ', '.')) and not re.match(r'(?i)^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)', x) for x in parts), 'member-path')
    require(not any(ord(c) < 32 or ord(c) == 127 for c in value), 'member-path')
    return value


def safe(path):
    absolute = Path(os.path.abspath(path))
    for p in [absolute, *absolute.parents]:
        s = p.lstat()
        require(not stat.S_ISLNK(s.st_mode) and not getattr(s, 'st_file_attributes', 0) & 0x400, 'input-link')
    require(absolute.resolve() == absolute, 'input-alias')
    return absolute


def stamp(s):
    return [s.st_size, s.st_mtime_ns, s.st_dev, s.st_ino, s.st_mode, s.st_nlink]


def opened_identity_matches(expected, opened):
    actual = stamp(opened)
    expected = list(expected)
    # Only the Windows filename-derived executable hint differs for open fds.
    # Full path mode is still checked before and after the entire snapshot.
    if os.name == 'nt':
        expected[4] &= ~0o111
        actual[4] &= ~0o111
    return expected == actual


class Budget:
    def __init__(self, seconds):
        require(isinstance(seconds, int) and 0 < seconds <= 600, 'deadline-bound')
        self.end = time.monotonic() + seconds
    def check(self):
        require(time.monotonic() < self.end, 'archive-deadline')


def inventory(root, budget, generated_links=None):
    generated_links = generated_links or {}
    seen_links = set()
    rows, pending, aliases, raw = [], [Path('.')], set(), 0
    while pending:
        directory = pending.pop()
        with os.scandir(root / directory) as iterator:
            for item in iterator:
                budget.check()
                name = relative((directory / item.name).as_posix())
                alias = unicodedata.normalize('NFC', name).casefold()
                require(alias not in aliases, 'member-alias')
                aliases.add(alias)
                p = root / name
                s = os.stat(p, follow_symlinks=False)
                if stat.S_ISLNK(s.st_mode):
                    require(name in generated_links and os.readlink(p) == generated_links[name] and safe(generated_links[name]).is_dir(), 'unreviewed-generated-link')
                    seen_links.add(name)
                    continue
                require(not getattr(s, 'st_file_attributes', 0) & 0x400, 'input-link')
                kind = 'directory' if stat.S_ISDIR(s.st_mode) else 'file' if stat.S_ISREG(s.st_mode) else None
                require(kind is not None, 'special-input')
                if kind == 'directory':
                    pending.append(directory / item.name)
                else:
                    raw += s.st_size
                rows.append({'path': name, 'kind': kind, 'stamp': stamp(s)})
                require(len(rows) <= MAX_ENTRIES and raw <= MAX_RAW, 'input-bound')
    require(seen_links == set(generated_links), 'missing-generated-link')
    return sorted(rows, key=lambda r: r['path']), raw


class ChunkWriter:
    def __init__(self, root, budget, cap=MAX_BYTES, chunk_size=CHUNK_BYTES):
        require(0 < cap <= MAX_BYTES and 0 < chunk_size <= CHUNK_BYTES, 'output-bound')
        self.root, self.budget, self.cap, self.chunk_size = root, budget, cap, chunk_size
        self.total, self.stream, self.rows = 0, None, []
    def write(self, data):
        self.budget.check()
        require(self.total + len(data) <= self.cap, 'compressed-bound')
        original = len(data)
        while data:
            if self.stream is None:
                name = 'checkpoint-%05d.bin' % len(self.rows)
                self.stream = (self.root / name).open('xb')
                self.rows.append({'name': name, 'bytes': 0, 'sha256': None})
                self.digest = hashlib.sha256()
            row = self.rows[-1]
            part, data = data[:self.chunk_size-row['bytes']], data[self.chunk_size-row['bytes']:]
            require(self.stream.write(part) == len(part), 'short-write')
            self.digest.update(part)
            row['bytes'] += len(part)
            self.total += len(part)
            if row['bytes'] == self.chunk_size:
                self.finish_chunk()
        return original
    def finish_chunk(self):
        if self.stream:
            self.stream.close()
            self.rows[-1]['sha256'] = self.digest.hexdigest()
            self.stream = None
    def flush(self):
        if self.stream:
            self.stream.flush()


class HashedReader:
    def __init__(self, stream, budget):
        self.stream, self.budget, self.digest = stream, budget, hashlib.sha256()
    def read(self, count):
        self.budget.check()
        data = self.stream.read(count)
        self.digest.update(data)
        return data


def metadata(root, name, value):
    data = (json.dumps(value, sort_keys=True, separators=(',', ':'))+'\n').encode()
    require(len(data) <= MAX_METADATA, 'metadata-bound')
    with (root / name).open('xb') as output:
        output.write(data)
    return {'name': name, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}


def pack(source, output, seconds=600, cap=MAX_BYTES, chunk_size=CHUNK_BYTES, generated_links=None):
    generated_links = generated_links or {}
    budget = Budget(seconds)
    source = safe(source)
    output = Path(os.path.abspath(output))
    safe(output.parent)
    require(source not in output.parents and output not in source.parents and source != output, 'overlap')
    before, raw = inventory(source, budget, generated_links)
    root_stamp = stamp(source.stat())
    output.mkdir()
    writer = ChunkWriter(output, budget, cap, chunk_size)
    files = []
    try:
        with gzip.GzipFile(filename='', mode='wb', fileobj=writer, compresslevel=1, mtime=0) as gz:
            with tarfile.open(fileobj=gz, mode='w|', format=tarfile.PAX_FORMAT) as archive:
                for row in before:
                    budget.check()
                    p = safe(source / row['path'])
                    require(stamp(p.stat()) == row['stamp'], 'source-changed')
                    info = tarfile.TarInfo(row['path'])
                    info.mode, info.mtime = row['stamp'][4] & 0o777, row['stamp'][1] // 1000000000
                    if row['kind'] == 'directory':
                        info.type = tarfile.DIRTYPE
                        archive.addfile(info)
                    else:
                        info.type, info.size = tarfile.REGTYPE, row['stamp'][0]
                        with p.open('rb') as stream:
                            require(opened_identity_matches(row['stamp'], os.fstat(stream.fileno())), 'source-changed')
                            reader = HashedReader(stream, budget)
                            archive.addfile(info, reader)
                            require(opened_identity_matches(row['stamp'], os.fstat(stream.fileno())), 'source-changed')
                            files.append({'path': row['path'], 'sha256': reader.digest.hexdigest()})
        writer.finish_chunk()
        after, after_raw = inventory(source, budget, generated_links)
        require(before == after and raw == after_raw and root_stamp == stamp(source.stat()), 'source-changed')
        serialized_rows = [{**row, 'stamp': [str(value) if i in (1,2,3) else value for i,value in enumerate(row['stamp'])]} for row in before]
        inventory_pin = metadata(output, 'inventory.json', {'schemaVersion': 1, 'entries': serialized_rows, 'files': files, 'generatedLinks': generated_links})
        return {'complete': True, 'chunks': writer.rows, 'inventory': inventory_pin, 'rawBytes': raw,
                'compressedBytes': writer.total, 'entries': len(before), 'linksIncluded': False}
    finally:
        writer.finish_chunk()


class Chunks(io.RawIOBase):
    def __init__(self, root, chunks, budget):
        self.root, self.chunks, self.budget, self.index, self.stream = root, chunks, budget, 0, None
    def readable(self):
        return True
    def readinto(self, buffer):
        self.budget.check()
        while self.index < len(self.chunks):
            if self.stream is None:
                self.stream = (self.root / self.chunks[self.index]['name']).open('rb')
            count = self.stream.readinto(buffer)
            if count:
                return count
            self.stream.close()
            self.stream, self.index = None, self.index + 1
        return 0
    def close(self):
        if self.stream:
            self.stream.close()
        super().close()


def checked_file(root, pin, maximum, budget):
    require(set(pin) == {'name', 'bytes', 'sha256'}, 'pin-shape')
    require(relative(pin['name']) == Path(pin['name']).name and 0 < pin['bytes'] <= maximum, 'pin-bound')
    p = safe(root / pin['name'])
    require(p.is_file() and p.stat().st_size == pin['bytes'], 'asset-size')
    digest = hashlib.sha256()
    with p.open('rb') as stream:
        while data := stream.read(1024*1024):
            budget.check()
            digest.update(data)
    require(digest.hexdigest() == pin['sha256'], 'asset-hash')
    return p


class BoundedTarInfo(tarfile.TarInfo):
    def _proc_member(self, archive):
        # Reject extensions before stdlib can allocate their declared payload.
        require(self.type in (tarfile.REGTYPE, tarfile.DIRTYPE, tarfile.XHDTYPE), 'member-type')
        if self.type == tarfile.XHDTYPE:
            require(self.size <= 16384, 'member-pax-bound')
        return super()._proc_member(archive)


class BoundedDecoded:
    def __init__(self, stream, maximum, budget):
        self.stream, self.maximum, self.budget, self.bytes = stream, maximum, budget, 0
    def read(self, count):
        self.budget.check()
        require(0 <= count <= 16*1024**2, 'decoded-read-bound')
        data = self.stream.read(count)
        self.bytes += len(data)
        require(self.bytes <= self.maximum, 'decoded-byte-bound')
        return data


def restore(bundle, destination, manifest, seconds=600, generated_links=None):
    generated_links = generated_links or {}
    budget = Budget(seconds)
    bundle = safe(bundle)
    destination = Path(os.path.abspath(destination))
    safe(destination.parent)
    require(not destination.exists() and bundle not in destination.parents and destination not in bundle.parents, 'restore-output')
    chunks = manifest['chunks']
    require(0 < len(chunks) <= 32 and sum(x['bytes'] for x in chunks) <= MAX_BYTES, 'chunk-bound')
    for i, row in enumerate(chunks):
        require(row['name'] == 'checkpoint-%05d.bin' % i, 'chunk-name')
        checked_file(bundle, row, CHUNK_BYTES, budget)
    index = json.loads(checked_file(bundle, manifest['inventory'], MAX_METADATA, budget).read_bytes())
    require(index.get('generatedLinks', {}) == generated_links, 'generated-link-recipe-mismatch')
    require(set(index) == {'schemaVersion','entries','files','generatedLinks'} and index['schemaVersion'] == 1, 'inventory-shape')
    rows = index['entries']
    for row in rows:
        require(set(row) == {'path','kind','stamp'} and row['kind'] in ('file','directory'), 'inventory-row')
        values = row['stamp']
        require(isinstance(values,list) and len(values)==6, 'inventory-stamp')
        for i in (1,2,3):
            require(isinstance(values[i],str) and re.fullmatch(r'0|[1-9][0-9]{0,19}',values[i]) is not None, 'lossless-inventory-stamp')
            values[i] = int(values[i])
        require(all(type(v) is int and 0 <= v < 2**64 for v in values), 'inventory-stamp')
        require(values[1] < 2**63 and values[4] <= 0xffff and values[5] >= 1, 'inventory-stamp')
        require(stat.S_ISREG(values[4]) if row['kind']=='file' else stat.S_ISDIR(values[4]), 'inventory-mode')
    require(len(rows) <= MAX_ENTRIES and sum(r['stamp'][0] for r in rows if r['kind']=='file') <= MAX_RAW, 'input-bound')
    expected = {relative(r['path']): r for r in rows}
    require(len(expected) == len(rows) and len({unicodedata.normalize('NFC', p).casefold() for p in expected}) == len(rows), 'member-alias')
    require(all(set(r)=={'path','sha256'} and isinstance(r['sha256'],str) and re.fullmatch(r'[a-f0-9]{64}',r['sha256']) for r in index['files']), 'inventory-file-pin')
    hashes = {r['path']: r['sha256'] for r in index['files']}
    require(len(hashes)==len(index['files']), 'inventory-file-alias')
    require(set(hashes) == {p for p,r in expected.items() if r['kind']=='file'}, 'inventory-files')
    destination.mkdir()
    seen = set()
    with Chunks(bundle, chunks, budget) as raw:
        with gzip.GzipFile(fileobj=io.BufferedReader(raw)) as gz:
            with tarfile.open(fileobj=BoundedDecoded(gz, sum(r['stamp'][0] for r in rows if r['kind']=='file')+len(rows)*4096+10240, budget), mode='r|', tarinfo=BoundedTarInfo) as archive:
                for member in archive:
                    budget.check()
                    name = relative(member.name)
                    require(name in expected and name not in seen, 'unexpected-member')
                    row = expected[name]
                    require((member.type == tarfile.REGTYPE and row['kind']=='file') or (member.isdir() and row['kind']=='directory'), 'member-type')
                    require(not member.pax_headers or set(member.pax_headers) <= {'path'}, 'member-pax')
                    target = destination / name
                    target.parent.mkdir(parents=True, exist_ok=True)
                    safe(target.parent)
                    if member.isdir():
                        target.mkdir(exist_ok=True)
                    else:
                        require(member.size == row['stamp'][0], 'member-size')
                        digest = hashlib.sha256()
                        with archive.extractfile(member) as src, target.open('xb') as out:
                            remaining = member.size
                            while remaining:
                                budget.check()
                                data = src.read(min(1024*1024, remaining))
                                require(bool(data), 'short-member')
                                out.write(data)
                                digest.update(data)
                                remaining -= len(data)
                        require(digest.hexdigest() == hashes[name], 'member-hash')
                    seen.add(name)
    require(seen == set(expected), 'missing-member')
    for name, target in generated_links.items():
        relative(name)
        require(name not in seen and safe(target).is_dir(), 'generated-link-recipe')
        parent = destination / name
        safe(parent.parent)
        os.symlink(target, parent)
    for row in sorted(rows, key=lambda x: x['path'].count('/'), reverse=True):
        p = destination / row['path']
        os.chmod(p, row['stamp'][4] & 0o777)
        os.utime(p, ns=(row['stamp'][1], row['stamp'][1]))
        current = p.stat()
        require(current.st_mtime_ns == row['stamp'][1] and current.st_mode == row['stamp'][4], 'restored-metadata')
    return {'complete': True, 'entries': len(seen), 'linksExtracted': False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=['pack', 'restore', 'seal'])
    parser.add_argument('--input', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--manifest')
    parser.add_argument('--seconds', type=int, default=600)
    parser.add_argument('--generated-links')
    args = parser.parse_args()
    links = {}
    if args.generated_links:
        data = Path(args.generated_links).read_bytes()
        require(len(data) <= 16384, 'link-recipe-bound')
        links = json.loads(data)
        require(isinstance(links, dict) and len(links) <= 3 and all(relative(k) and Path(v).is_absolute() for k,v in links.items()), 'link-recipe')
    if args.mode == 'seal':
        require(Path(args.input).stat().st_size < 1024**2, 'seal-zip-bound')
        with zipfile.ZipFile(args.input) as zipped:
            require(zipped.namelist() == ['seal.json'], 'seal-zip-members')
            entry = zipped.getinfo('seal.json')
            require(0 < entry.file_size < 1024**2 and not entry.flag_bits & 1, 'seal-bound')
            result = json.loads(zipped.read(entry))
    elif args.mode == 'pack':
        result = pack(Path(args.input), Path(args.output), args.seconds, generated_links=links)
    else:
        require(args.manifest is not None, 'manifest-required')
        raw = Path(args.manifest).read_bytes()
        require(len(raw) <= 1024**2, 'manifest-bound')
        envelope = json.loads(raw)
        require(isinstance(envelope,dict) and set(envelope)=={'schemaVersion','kind','identity','identitySha256','producer','archive','compile','nativeAcceptance','runtimeReady'} and envelope['schemaVersion']==1 and envelope['kind']=='sorng-cef-engineering-checkpoint' and envelope['nativeAcceptance'] is False and envelope['runtimeReady'] is False and isinstance(envelope['archive'],dict), 'checkpoint-envelope')
        result = restore(Path(args.input), Path(args.output), envelope['archive'], args.seconds, generated_links=links)
    print(json.dumps(result, separators=(',', ':')))

if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # Fixed error labels only; never print raw OS paths or untrusted tar text.
        print(json.dumps({'complete': False, 'error': str(error) if type(error) is CheckpointError else 'archive-io-error'}))
        raise SystemExit(1)
