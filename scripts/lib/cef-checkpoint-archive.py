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
FRAMEWORK = 'Chromium Embedded Framework.framework'
FRAMEWORK_ROLES = {
    FRAMEWORK + '/Versions/Current': {'role': 'version', 'kind': 'directory', 'target': FRAMEWORK + '/Versions/A', 'raw': 'A'},
    FRAMEWORK + '/Resources': {'role': 'resources', 'kind': 'directory', 'target': FRAMEWORK + '/Versions/A/Resources', 'raw': 'Versions/Current/Resources'},
    FRAMEWORK + '/Libraries': {'role': 'libraries', 'kind': 'directory', 'target': FRAMEWORK + '/Versions/A/Libraries', 'raw': 'Versions/Current/Libraries'},
    FRAMEWORK + '/Chromium Embedded Framework': {'role': 'binary', 'kind': 'file', 'target': FRAMEWORK + '/Versions/A/Chromium Embedded Framework', 'raw': 'Versions/Current/Chromium Embedded Framework'},
}


def link_recipe(value):
    require(isinstance(value, dict) and len(value) in (0, 3, 7), 'link-recipe')
    sdk = {k: v for k, v in value.items() if k not in FRAMEWORK_ROLES}
    require(len(sdk) in (0, 3) and (len(value) != 7 or len(sdk) == 3), 'link-recipe')
    roles = set()
    for name, target in sdk.items():
        relative(name)
        require(isinstance(target, str) and len(target.encode()) <= 4096 and Path(target).is_absolute() and not any(ord(c) < 32 or ord(c) == 127 for c in target), 'link-recipe')
        leaf = name.removeprefix('sdk/xcode_links/')
        role = 'sdk' if re.fullmatch(r'MacOSX(?:[0-9]+(?:\.[0-9]+){0,2})?\.sdk', leaf) else leaf if leaf in ('MacOSX.platform', 'XcodeDefault.xctoolchain') else None
        require(name == 'sdk/xcode_links/' + leaf and role is not None and role not in roles, 'link-recipe')
        require(Path(target).name == leaf or (role == 'sdk' and re.fullmatch(r'MacOSX(?:[0-9]+(?:\.[0-9]+){0,2})?\.sdk', Path(target).name)), 'link-recipe')
        roles.add(role)
    if len(value) == 7:
        require(all(value.get(k) == v for k, v in FRAMEWORK_ROLES.items()), 'link-recipe')
    else:
        require(not any(k in FRAMEWORK_ROLES for k in value), 'link-recipe')
    return value


def generated_state(root, recipe, rows, budget):
    """Logical state is sealed; link identities are compared only within pack."""
    recipe = link_recipe(recipe)
    typed = len(recipe) == 7
    owner = root.lstat().st_uid
    by_name = {row['path']: row for row in rows}
    state, identities = {'framework': 'absent', 'targets': {}}, []
    factory = FRAMEWORK in by_name
    if typed and factory:
        require(by_name[FRAMEWORK]['kind'] == 'directory', 'generated-link-kind')
        state['framework'] = 'factory'
    for name, spec in recipe.items():
        budget.check()
        internal = name in FRAMEWORK_ROLES
        if internal and not factory:
            continue
        p = root / name
        safe(p.parent)
        s = p.lstat()
        require(stat.S_ISLNK(s.st_mode) and s.st_uid == owner and s.st_nlink == 1, 'generated-link-owner')
        raw = os.readlink(p)
        if internal:
            target = root / spec['target']
            require(raw == spec['raw'], 'unreviewed-generated-link')
            row = by_name.get(spec['target'])
            if row is None:
                require(spec['role'] != 'version' and not target.exists() and not target.is_symlink(), 'generated-link-target')
                ancestor = target.parent
                while not ancestor.exists():
                    ancestor = ancestor.parent
                safe(ancestor)
                require(ancestor.lstat().st_uid == owner, 'generated-link-owner')
                state['targets'][spec['role']] = 'pending'
            else:
                safe(target)
                t = target.lstat()
                require(row['kind'] == spec['kind'] and t.st_uid == owner and (spec['kind'] != 'file' or t.st_nlink == 1), 'generated-link-kind')
                state['targets'][spec['role']] = 'present'
        else:
            require(raw == spec and safe(spec).is_dir(), 'unreviewed-generated-link')
        identities.append([name, stamp(s), s.st_uid, raw])
    if typed:
        for row in rows:
            budget.check()
            s = (root / row['path']).lstat()
            require(s.st_uid == owner and (row['kind'] != 'file' or s.st_nlink == 1), 'generated-link-owner')
    return state, identities


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


def inventory(root, budget, generated_links=None, source_policy=None):
    generated_links = link_recipe(generated_links or {})
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
                if source_policy is not None and source_admin(root, name, source_policy, budget):
                    continue
                s = os.stat(p, follow_symlinks=False)
                if source_policy is not None:
                    require(s.st_uid == os.geteuid(), 'source-owner')
                if stat.S_ISLNK(s.st_mode):
                    if source_policy is not None:
                        target = os.readlink(p)
                        require(isinstance(target,str) and 0 < len(target.encode()) <= 4096 and not any(ord(c)<32 for c in target), 'source-link')
                        source_link_target(root, p, target, budget)
                        rows.append({'path':name,'kind':'symlink','stamp':stamp(s),'target':target,'ctimeNs':s.st_ctime_ns})
                        require(len(rows) <= SOURCE_MAX_ENTRIES, 'source-entry-bound')
                        continue
                    require(name in generated_links, 'unreviewed-generated-link')
                    seen_links.add(name)
                    continue
                require(not getattr(s, 'st_file_attributes', 0) & 0x400, 'input-link')
                kind = 'directory' if stat.S_ISDIR(s.st_mode) else 'file' if stat.S_ISREG(s.st_mode) else None
                require(kind is not None, 'special-input')
                if kind == 'directory':
                    pending.append(directory / item.name)
                else:
                    if source_policy is not None:
                        require(0 <= s.st_size <= SOURCE_MAX_FILE, 'source-file-size')
                    raw += s.st_size
                rows.append({'path': name, 'kind': kind, 'stamp': stamp(s), **({'ctimeNs':s.st_ctime_ns} if source_policy is not None else {})})
                require(len(rows) <= (SOURCE_MAX_ENTRIES if source_policy is not None else MAX_ENTRIES) and raw <= MAX_RAW, 'input-bound')
    expected_links = set(generated_links)
    if len(generated_links) == 7 and not any(r['path'] == FRAMEWORK for r in rows):
        expected_links -= set(FRAMEWORK_ROLES)
    require(seen_links == expected_links, 'missing-generated-link')
    if source_policy is not None:
        require(sum(len(r['path'].encode()) + len(r.get('target','').encode()) + 320 for r in rows) <= MAX_METADATA, 'source-sidecar-bound')
    generated_state(root, generated_links, rows, budget)
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


def metadata(root, name, value, source=False):
    data = (json.dumps(value, sort_keys=True, separators=(',', ':'))+'\n').encode()
    require(len(data) <= MAX_METADATA, 'metadata-bound')
    if source:
        output = (root / name).open('xb');primary = None
        try:
            require(output.write(data)==len(data), 'short-write')
            output.flush()
        except BaseException as error:
            primary=error
            raise
        finally:
            source_close(output.close, primary)
    else:
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
    before_state, before_links = generated_state(source, generated_links, before, budget)
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
        require((before_state, before_links) == generated_state(source, generated_links, after, budget), 'source-changed')
        require(before == after and raw == after_raw and root_stamp == stamp(source.stat()), 'source-changed')
        serialized_rows = [{**row, 'stamp': [str(value) if i in (1,2,3) else value for i,value in enumerate(row['stamp'])]} for row in before]
        inventory_pin = metadata(output, 'inventory.json', {'schemaVersion': 1, 'entries': serialized_rows, 'files': files, 'generatedLinks': generated_links, **({'generatedState': before_state} if len(generated_links) == 7 else {})})
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
    generated_links = link_recipe(generated_links or {})
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
    require(set(index) == ({'schemaVersion','entries','files','generatedLinks'} | ({'generatedState'} if len(generated_links) == 7 else set())) and index['schemaVersion'] == 1, 'inventory-shape')
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
    if len(generated_links) == 7:
        for name in expected:
            parent = Path(name).parent
            while parent != Path('.'):
                require(parent.as_posix() in expected and expected[parent.as_posix()]['kind'] == 'directory', 'generated-link-target')
                parent = parent.parent
        logical = {'framework': 'factory' if FRAMEWORK in expected else 'absent', 'targets': {}}
        if FRAMEWORK in expected:
            require(expected[FRAMEWORK]['kind'] == 'directory', 'generated-link-kind')
            for spec in FRAMEWORK_ROLES.values():
                row = expected.get(spec['target'])
                require((row is not None and row['kind'] == spec['kind'] and (spec['kind'] != 'file' or row['stamp'][5] == 1)) or (row is None and spec['role'] != 'version'), 'generated-link-target')
                logical['targets'][spec['role']] = 'present' if row is not None else 'pending'
        require(index['generatedState'] == logical, 'generated-link-state')
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
    restore_links = []
    for name, target in generated_links.items():
        relative(name)
        internal = name in FRAMEWORK_ROLES
        if internal and FRAMEWORK not in expected:
            continue
        require(name not in seen, 'generated-link-recipe')
        parent = destination / name
        safe(parent.parent)
        if internal:
            t = destination / target['target']
            row = expected.get(target['target'])
            require((row is not None and row['kind'] == target['kind']) or (row is None and target['role'] != 'version'), 'generated-link-target')
            target = target['raw']
        else:
            require(safe(target).is_dir(), 'generated-link-recipe')
        restore_links.append((target, parent))
    for target, parent in restore_links:
        os.symlink(target, parent)
    state, _ = generated_state(destination, generated_links, rows, budget)
    if len(generated_links) == 7:
        require(state == index['generatedState'], 'generated-link-state')
    for row in sorted(rows, key=lambda x: x['path'].count('/'), reverse=True):
        p = destination / row['path']
        os.chmod(p, row['stamp'][4] & 0o777)
        os.utime(p, ns=(row['stamp'][1], row['stamp'][1]))
        current = p.stat()
        require(current.st_mtime_ns == row['stamp'][1] and current.st_mode == row['stamp'][4], 'restored-metadata')
    return {'complete': True, 'entries': len(seen), 'linksExtracted': False}


# Fixed Linux ARM source metadata; never a general extraction or timestamp API.
SOURCE_METADATA_NAME = '.siso_sorng_source_metadata.json'
SOURCE_METADATA_POLICY = 'sorng-linuxarm-complete-owned-inputs-v1'
SOURCE_METADATA_DATE_EPOCH = '1790626028'
SOURCE_CLOSE_FAILURE = False
SOURCE_JOIN_FAILURE = False
SOURCE_MAX_ENTRIES = 1000000
SOURCE_MAX_FILE = 8 * 1024**3



def source_close(close, primary):
    global SOURCE_CLOSE_FAILURE
    try:
        close()
    except BaseException:
        SOURCE_CLOSE_FAILURE = True
        if primary is None:
            raise


def source_read_bytes(path, budget, maximum):
    path = safe(path);before = path.stat()
    require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and 0 < before.st_size <= maximum,
            'source-metadata-read-bound')
    stream = path.open('rb');primary = None;parts = [];count = 0
    try:
        fd_before = os.fstat(stream.fileno())
        require(stamp(fd_before)==stamp(before) and fd_before.st_ctime_ns==before.st_ctime_ns,
                'source-metadata-read-changed')
        while True:
            budget.check();chunk=stream.read(65536)
            if not chunk:
                break
            count+=len(chunk);require(count<=before.st_size, 'source-metadata-read-bound');parts.append(chunk)
        after=path.stat();held=os.fstat(stream.fileno())
        require(count==before.st_size and stamp(after)==stamp(before)==stamp(held) and
                after.st_ctime_ns==before.st_ctime_ns==held.st_ctime_ns, 'source-metadata-read-changed')
    except BaseException as error:
        primary=error
        raise
    finally:
        source_close(stream.close, primary)
    return b''.join(parts)


def source_json(raw):
    def unique(pairs):
        result = {}
        for key,value in pairs:
            require(key not in result, 'source-json-duplicate')
            result[key] = value
        return result
    return json.loads(raw, object_pairs_hook=unique)

def source_repositories(root, budget):
    import ast
    names = {'src', 'src/cef', 'depot_tools'}
    entry_file = safe(root / '.gclient_entries')
    require(entry_file.is_file() and entry_file.stat().st_size <= 4 * 1024**2, 'source-repositories-bound')
    registry_raw = source_read_bytes(entry_file, budget, 4 * 1024**2)
    body = ast.parse(registry_raw)
    require(len(body.body) == 1 and isinstance(body.body[0], ast.Assign) and
            len(body.body[0].targets) == 1 and isinstance(body.body[0].targets[0], ast.Name) and
            body.body[0].targets[0].id == 'entries', 'source-repositories-shape')
    require(isinstance(body.body[0].value, ast.Dict), 'source-repositories-shape')
    entries = ast.literal_eval(body.body[0].value)
    require(len(entries) == len(body.body[0].value.keys), 'source-repositories-shape')
    require(isinstance(entries, dict) and len(entries) <= 10000, 'source-repositories-bound')
    for name, value in entries.items():
        budget.check();relative(name)
        require(name == 'src' or name.startswith('src/'), 'source-repository-root')
        require(value is None or isinstance(value, str) and len(value) <= 8192, 'source-repository-value')
        names.add(name)
    return {'repositories': names, 'gitHeads': {}, 'registrySha256':hashlib.sha256(registry_raw).hexdigest()}



def source_link_target(root, path, target, budget):
    candidate = Path(os.path.abspath(path.parent / target))
    require(candidate == root or root in candidate.parents, 'source-external-link')
    pending = list(candidate.relative_to(root).parts);current = root;links = 0
    while pending:
        budget.check();current = current / pending.pop(0)
        name = current.relative_to(root)
        require('.git' not in name.parts and name.as_posix() not in ('src/out', 'acquisition-logs'), 'source-excluded-link')
        info = current.lstat()
        if stat.S_ISLNK(info.st_mode):
            links += 1;require(links <= 64, 'source-link-cycle')
            raw = os.readlink(current)
            require(0 < len(raw.encode()) <= 4096 and not any(ord(c)<32 for c in raw), 'source-link')
            candidate = Path(os.path.abspath(current.parent / raw))
            require(candidate == root or root in candidate.parents, 'source-external-link')
            pending = list(candidate.relative_to(root).parts) + pending;current = root
        else:
            require(stat.S_ISDIR(info.st_mode) if pending else stat.S_ISDIR(info.st_mode) or stat.S_ISREG(info.st_mode),
                    'source-link-kind')
    return current

def source_admin(root, name, policy, budget):
    if name == 'acquisition-logs':
        info = (root / name).lstat()
        require(stat.S_ISDIR(info.st_mode) and info.st_uid == os.geteuid() and
                not getattr(info, 'st_file_attributes', 0) & 0x400, 'source-diagnostic-root')
        return True
    if name == 'src/out':
        require((root / name).is_dir() and not (root / name).is_symlink(), 'source-output-root')
        return True
    if Path(name).name != '.git':
        return False
    repository = Path(name).parent.as_posix()
    require(repository in policy['repositories'], 'source-unknown-git-root')
    admin = safe(root / name)
    require(admin.is_dir(), 'source-git-admin-kind')
    head = safe(admin / 'HEAD')
    require(head.is_file() and head.stat().st_size == 41, 'source-detached-head')
    raw = source_read_bytes(head, budget, 41);budget.check()
    require(re.fullmatch(rb'[a-f0-9]{40}\n', raw) is not None, 'source-detached-head')
    value = raw.decode('ascii').strip()
    old = policy['gitHeads'].setdefault(repository, value)
    require(old == value, 'source-repository-changed')
    return True


def source_hash(root, row, budget):
    p = safe(root / row['path']);before = p.stat()
    require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and
            before.st_size <= SOURCE_MAX_FILE and stamp(before) == row['stamp'] and before.st_ctime_ns == row['ctimeNs'], 'source-file-identity')
    stream = p.open('rb');primary = None;reader = HashedReader(stream, budget);count = 0
    try:
        require(opened_identity_matches(row['stamp'], os.fstat(stream.fileno())) and
                os.fstat(stream.fileno()).st_ctime_ns == before.st_ctime_ns, 'source-file-identity')
        while True:
            chunk = reader.read(65536)
            if not chunk:
                break
            count += len(chunk)
            require(count <= before.st_size, 'source-file-changed')
        require(count == before.st_size and stamp(os.fstat(stream.fileno())) == row['stamp'] and
                stamp(p.stat()) == row['stamp'] and p.stat().st_ctime_ns == before.st_ctime_ns and
                os.fstat(stream.fileno()).st_ctime_ns == before.st_ctime_ns, 'source-file-changed')
    except BaseException as error:
        primary = error
        raise
    finally:
        source_close(stream.close, primary)
    return reader.digest.hexdigest()


def source_portable(row, digest=None):
    result = {'path': row['path'], 'kind': row['kind'], 'mode': row['stamp'][4],
              'mtimeNs': str(row['stamp'][1])}
    if row['kind'] == 'file':
        result.update(size=row['stamp'][0], sha256=digest)
    elif row['kind'] == 'symlink':
        result.update(target=row['target'], sha256=hashlib.sha256(row['target'].encode()).hexdigest())
    return result


def source_snapshot(root, budget, guards=None):
    global SOURCE_JOIN_FAILURE
    from concurrent.futures import ThreadPoolExecutor, wait, FIRST_COMPLETED
    require(root.stat().st_uid == os.geteuid(), 'source-owner')
    policy = source_repositories(root, budget)
    root_before = stamp(root.stat())
    rows, total = inventory(root, budget, source_policy=policy)
    hashes = {};first = None
    pool = ThreadPoolExecutor(max_workers=4)
    files = iter(row for row in rows if row['kind'] == 'file')
    pending = {}
    def submit():
        row = next(files, None)
        if row is not None:
            pending[pool.submit(source_hash, root, row, budget)] = row['path']
    try:
        for _ in range(4):
            submit()
        while pending and first is None:
            done, _ = wait(pending, return_when=FIRST_COMPLETED)
            for future in done:
                name = pending.pop(future)
                try:
                    hashes[name] = future.result()
                except BaseException as error:
                    if first is None:
                        first = error
            if first is None:
                for _ in done:
                    submit()
        if first is not None:
            for future in pending:
                future.cancel()
    finally:
        try:
            pool.shutdown(wait=True, cancel_futures=True)
        except BaseException:
            SOURCE_JOIN_FAILURE = True
            if first is None:
                raise
    if first is not None:
        raise first
    budget.check()
    require(hashes.get('.gclient_entries') == policy['registrySha256'], 'source-repositories-changed')
    require({'src','src/cef','depot_tools'} <= set(policy['gitHeads']), 'source-required-repositories')
    after, after_total = inventory(root, budget, source_policy=policy)
    require(rows == after and total == after_total and stamp(root.stat()) == root_before, 'source-tree-changed')
    if guards is not None:
        guards.update({row['path']: (row['stamp'],row['ctimeNs']) for row in rows})
        guards[''] = (root_before,root.stat().st_ctime_ns)
    return {'entries': [source_portable(row, hashes.get(row['path'])) for row in rows],
            'rootMtimeNs': str(root_before[1]), 'gitHeads': dict(sorted(policy['gitHeads'].items())),
            'bytes': total}


def source_metadata_identity(identity):
    fields = {'target','source','producer','canonicalRoot','image','tools','graph','siso'}
    require(isinstance(identity, dict) and set(identity) == fields and
            identity['target'] == 'aarch64-unknown-linux-gnu', 'source-identity')
    require(all(isinstance(identity[k], str) and re.fullmatch(r'[a-f0-9]{64}', identity[k])
                for k in ('source','producer','tools','graph','siso')), 'source-identity')
    require(isinstance(identity['image'], str) and re.fullmatch(r'[0-9]{8}\.[0-9]+\.[0-9]+', identity['image']), 'source-image')
    require(isinstance(identity['canonicalRoot'], str), 'source-root')
    return safe(Path(identity['canonicalRoot']))


def source_metadata(mode, root, sidecar, identity, seconds=600, budget=None):
    import sys
    global SOURCE_CLOSE_FAILURE, SOURCE_JOIN_FAILURE
    SOURCE_CLOSE_FAILURE = SOURCE_JOIN_FAILURE = False
    require(mode in ('source-record','source-verify','source-apply'), 'source-mode')
    require(sys.platform == 'linux', 'source-linux-only')
    budget = Budget(seconds) if budget is None else budget;work = source_metadata_identity(identity)
    budget.check()
    root = safe(root);sidecar = Path(sidecar)
    require(root == work / 'source' and sidecar == root / 'src/out/Release_GN_arm64' / SOURCE_METADATA_NAME,
            'source-fixed-paths')
    require(root.is_dir() and safe(sidecar.parent).is_dir(), 'source-fixed-paths')
    guards = {}
    if mode == 'source-record':
        current = source_snapshot(root, budget, guards)
        value = {'schemaVersion': 1, 'kind': 'sorng-linuxarm-source-metadata',
                 'policy': SOURCE_METADATA_POLICY, 'sourceDateEpoch':SOURCE_METADATA_DATE_EPOCH, 'identity': identity, 'snapshot': current}
        written = metadata(sidecar.parent, sidecar.name, value, source=True)
        require(source_read_sidecar(sidecar, budget) == value, 'source-sidecar-readback')
        return {'complete': True, 'mode': mode, 'entries': len(current['entries']),
                'bytes': current['bytes'], 'sidecar': written}
    stored = source_read_sidecar(sidecar, budget)
    require(isinstance(stored, dict) and set(stored) == {'schemaVersion','kind','policy','sourceDateEpoch','identity','snapshot'} and
            type(stored['schemaVersion']) is int and stored['schemaVersion'] == 1 and stored['kind'] == 'sorng-linuxarm-source-metadata' and
            stored['policy'] == SOURCE_METADATA_POLICY and stored['sourceDateEpoch'] == SOURCE_METADATA_DATE_EPOCH and stored['identity'] == identity,
            'source-sidecar-binding')
    expected = stored['snapshot']
    require(isinstance(expected, dict) and set(expected) == {'entries','rootMtimeNs','gitHeads','bytes'} and
            isinstance(expected['entries'], list) and len(expected['entries']) <= SOURCE_MAX_ENTRIES,
            'source-sidecar-shape')
    current = source_snapshot(root, budget, guards)
    require(expected['gitHeads'] == current['gitHeads'] and type(expected['bytes']) is int and expected['bytes'] == current['bytes'],
            'source-repository-or-total-changed')
    # Compare the entire freshly hashed namespace before the first metadata write.
    without_time = lambda rows: [{k:v for k,v in row.items() if k != 'mtimeNs'} for row in rows]
    require(json.dumps(without_time(expected['entries']),sort_keys=True,separators=(',',':')) ==
            json.dumps(without_time(current['entries']),sort_keys=True,separators=(',',':')), 'source-content-changed')
    for row in expected['entries']:
        require(isinstance(row['mtimeNs'], str) and re.fullmatch(r'0|[1-9][0-9]{0,18}', row['mtimeNs']) and
                int(row['mtimeNs']) < 2**63, 'source-mtime')
    require(isinstance(expected['rootMtimeNs'], str) and re.fullmatch(r'0|[1-9][0-9]{0,18}', expected['rootMtimeNs']) and
            int(expected['rootMtimeNs']) < 2**63, 'source-mtime')
    if mode == 'source-apply':
        for row in sorted(expected['entries'], key=lambda r:r['path'].count('/'), reverse=True):
            budget.check();path = root / relative(row['path']);before = path.lstat()
            require(stamp(root.stat())[2:4] == guards[''][0][2:4], 'source-root-changed')
            require((stamp(before),before.st_ctime_ns) == guards[row['path']], 'source-write-identity')
            if row['kind'] == 'symlink':
                require(stat.S_ISLNK(before.st_mode) and os.readlink(path) == row['target'], 'source-link-changed')
                os.utime(path, ns=(before.st_atime_ns,int(row['mtimeNs'])), follow_symlinks=False)
                after = path.lstat()
                require((before.st_dev,before.st_ino,before.st_mode)==(after.st_dev,after.st_ino,after.st_mode) and
                        os.readlink(path)==row['target'] and after.st_mtime_ns==int(row['mtimeNs']), 'source-mtime-readback')
            else:
                safe(path)
                fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
                primary = None
                try:
                    info = os.fstat(fd)
                    require(stamp(info) == stamp(before), 'source-write-identity')
                    os.utime(fd, ns=(info.st_atime_ns,int(row['mtimeNs'])))
                    after = path.lstat();held = os.fstat(fd)
                    require((before.st_dev,before.st_ino,before.st_mode,before.st_size)==
                            (after.st_dev,after.st_ino,after.st_mode,after.st_size) and
                            stamp(after)==stamp(held) and held.st_mtime_ns==int(row['mtimeNs']), 'source-mtime-readback')
                except BaseException as error:
                    primary = error
                    raise
                finally:
                    source_close(lambda: os.close(fd), primary)
        budget.check();safe(root);info = root.stat()
        require((stamp(info),info.st_ctime_ns)==guards[''], 'source-root-changed')
        fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        primary = None
        try:
            require(stamp(os.fstat(fd))==stamp(info), 'source-root-changed')
            os.utime(fd, ns=(info.st_atime_ns,int(expected['rootMtimeNs'])))
            require(root.stat().st_mtime_ns==int(expected['rootMtimeNs']) and
                    stamp(root.stat())==stamp(os.fstat(fd)), 'source-root-readback')
        except BaseException as error:
            primary=error
            raise
        finally:
            source_close(lambda: os.close(fd), primary)
    require(source_snapshot(root, budget) == expected, 'source-metadata-postcheck')
    return {'complete': True, 'mode': mode, 'entries': len(expected['entries']), 'bytes': expected['bytes']}


def source_read_sidecar(path, budget):
    return source_json(source_read_bytes(path, budget, MAX_METADATA))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=['pack', 'restore', 'seal', 'source-record', 'source-verify', 'source-apply'])
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
        link_recipe(links)
    if args.mode.startswith('source-'):
        require(args.manifest is not None and not links, 'source-context-required')
        context_file = safe(Path(args.manifest))
        require(context_file.stat().st_size <= 16384, 'source-context-bound')
        source_budget = Budget(args.seconds)
        identity = source_json(source_read_bytes(context_file, source_budget, 16384))
        result = source_metadata(args.mode, Path(args.input), Path(args.output), identity, args.seconds, budget=source_budget)
    elif args.mode == 'seal':
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
        print(json.dumps({'complete': False, 'error': str(error) if type(error) is CheckpointError else 'archive-io-error', **({'sourceCloseFailure':True} if SOURCE_CLOSE_FAILURE else {}), **({'sourceJoinFailure':True} if SOURCE_JOIN_FAILURE else {})}))
        raise SystemExit(1)
