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
from contextlib import contextmanager
from contextvars import ContextVar, copy_context

SOURCE_IO_MODES = ('source-record', 'source-verify', 'source-apply')
SOURCE_IO_STAGES = ('unlocated', 'context-read', 'registry-read', 'registry-parse', 'repository-head',
                    'root-stat', 'directory-open', 'directory-next', 'member-stat', 'link-read',
                    'link-target-stat', 'file-open', 'file-read', 'file-fd-stat', 'file-path-stat',
                    'file-close', 'reader-submit', 'reader-join', 'sidecar-encode', 'sidecar-open',
                    'sidecar-write', 'sidecar-flush', 'sidecar-close', 'sidecar-readback',
                    'apply-stat', 'apply-utime', 'post-inventory')
SOURCE_IO_KINDS = ((FileNotFoundError,'FileNotFound'), (NotADirectoryError,'NotADirectory'),
                   (PermissionError,'Permission'), (IsADirectoryError,'IsADirectory'),
                   (FileExistsError,'FileExists'), (OSError,'OS'), (UnicodeDecodeError,'UnicodeDecode'),
                   (UnicodeEncodeError,'UnicodeEncode'), (json.JSONDecodeError,'JSONDecode'),
                   (SyntaxError,'Syntax'), (ValueError,'Value'), (TypeError,'Type'),
                   (MemoryError,'Memory'), (RuntimeError,'Runtime'), (KeyError,'Key'), (OverflowError,'Overflow'))
SOURCE_IO_CONTEXT = ContextVar('owned_source_io', default=None)
CLI_SOURCE_MODE = None


@contextmanager
def source_io_scope(mode):
    token = SOURCE_IO_CONTEXT.set((mode, None))
    try:
        yield
    finally:
        SOURCE_IO_CONTEXT.reset(token)


def source_io_record(error, stage, candidate=None):
    context = SOURCE_IO_CONTEXT.get()
    if context is None or context[0] not in SOURCE_IO_MODES or isinstance(error, CheckpointError):
        return
    try:
        if 'sourceIoFailure' in error.__dict__ or error.__dict__.get('sourceIoFailureInvalid') is True:
            return
        value = {'mode':context[0], 'stage':stage,
                 'kind':next((label for kind,label in SOURCE_IO_KINDS if isinstance(error,kind)), 'Other'),
                 'errno':error.errno if isinstance(error,OSError) and type(error.errno) is int and 0 <= error.errno <= 4095 else None}
        if candidate is not None and context[1] is not None:
            # Lexical projection from an already owned operation, never exception.filename.
            try:
                name = Path(candidate).relative_to(context[1]).as_posix()
            except ValueError:
                name = '.'
            if name != '.' and all(part not in ('', '.', '..') for part in name.split('/')):
                raw = name.encode()
                if 0 < len(raw) <= 4*1024**2:
                    value['candidate'] = {'bytes':len(raw), 'sha256':hashlib.sha256(raw).hexdigest(),
                                          **({'name':name} if source_path_name(name) else {})}
        require(stage in SOURCE_IO_STAGES and len(json.dumps(value).encode()) <= 2048, 'diagnostic')
        error.sourceIoFailure = value
    except Exception:
        try:
            error.sourceIoFailureInvalid = True
        except Exception:
            pass


def source_io_call(stage, candidate, operation):
    try:
        return operation()
    except Exception as error:
        source_io_record(error, stage, candidate)
        raise


def source_io_failure_fields(error, mode):
    if mode not in SOURCE_IO_MODES or isinstance(error, CheckpointError):
        return {}
    try:
        if error.__dict__.get('sourceIoFailureInvalid') is True:
            return {'sourceIoFailureInvalid':True}
        value = error.__dict__.get('sourceIoFailure')
        if value is None:
            # No last-path inference for exceptions outside an instrumented boundary.
            with source_io_scope(mode):
                source_io_record(error, 'unlocated')
            value = error.__dict__.get('sourceIoFailure')
        require(type(value) is dict and set(value) in ({'mode','stage','kind','errno'},
                {'mode','stage','kind','errno','candidate'}) and value['mode'] == mode and
                value['stage'] in SOURCE_IO_STAGES and value['kind'] in
                tuple(label for _,label in SOURCE_IO_KINDS) + ('Other',) and
                (value['errno'] is None or type(value['errno']) is int and 0 <= value['errno'] <= 4095), 'diagnostic')
        if 'candidate' in value:
            item = value['candidate']
            require(type(item) is dict and set(item) in ({'bytes','sha256'},{'bytes','sha256','name'}) and
                    type(item['bytes']) is int and 0 < item['bytes'] <= 4*1024**2 and
                    isinstance(item['sha256'],str) and re.fullmatch(r'[a-f0-9]{64}',item['sha256']) is not None, 'diagnostic')
            require('name' not in item or source_path_name(item['name']) and len(item['name'].encode()) == item['bytes'] and
                    hashlib.sha256(item['name'].encode()).hexdigest() == item['sha256'], 'diagnostic')
        require(len(json.dumps(value).encode()) <= 2048, 'diagnostic')
        return {'sourceIoFailure':value}
    except Exception:
        return {'sourceIoFailureInvalid':True}

def source_bound_value(value, mode):
    require(type(value) is dict and set(value) ==
            {'mode','stage','entries','rawBytes','maximumEntries','maximumRawBytes'} and
            value['mode'] == mode and mode in SOURCE_IO_MODES and value['stage'] == 'inventory-append' and
            type(value['entries']) is int and 1 <= value['entries'] <= SOURCE_MAX_ENTRIES + 1 and
            type(value['rawBytes']) is int and 0 <= value['rawBytes'] <= MAX_RAW + SOURCE_MAX_FILE and
            type(value['maximumEntries']) is int and value['maximumEntries'] == SOURCE_MAX_ENTRIES and
            type(value['maximumRawBytes']) is int and value['maximumRawBytes'] == MAX_RAW and
            (value['entries'] > SOURCE_MAX_ENTRIES or value['rawBytes'] > MAX_RAW) and
            len(json.dumps(value).encode()) <= 512, 'diagnostic')
    return {key:value[key] for key in ('mode','stage','entries','rawBytes','maximumEntries','maximumRawBytes')}


def source_bound_record(error, entries, raw, policy):
    # Only the failing append's already-computed counters; no last-path/global state.
    try:
        context = SOURCE_IO_CONTEXT.get()
        if (type(error) is not CheckpointError or str(error) != 'input-bound' or
                type(policy) is not dict or policy.get('external') is True or
                type(context) is not tuple or len(context) != 2 or context[0] not in SOURCE_IO_MODES or context[1] is None):
            return
        if 'sourceBoundFailure' in error.__dict__ or error.__dict__.get('sourceBoundFailureInvalid') is True:
            return
        error.sourceBoundFailure = source_bound_value({'mode':context[0], 'stage':'inventory-append',
            'entries':entries, 'rawBytes':raw, 'maximumEntries':SOURCE_MAX_ENTRIES, 'maximumRawBytes':MAX_RAW}, context[0])
    except Exception:
        try:
            error.sourceBoundFailureInvalid = True
        except Exception:
            pass


def source_bound_failure_fields(error, mode):
    if mode not in SOURCE_IO_MODES or type(error) is not CheckpointError or str(error) != 'input-bound':
        return {}
    try:
        if error.__dict__.get('sourceBoundFailureInvalid') is True:
            return {'sourceBoundFailureInvalid':True}
        value = error.__dict__.get('sourceBoundFailure')
        if value is None:
            return {}
        return {'sourceBoundFailure':source_bound_value(value, mode)}
    except Exception:
        return {'sourceBoundFailureInvalid':True}


# Diagnostic only: how the freshly hashed namespace differs from the recorded
# one. Counts plus up to eight evenly spread samples; each sample names the
# differing field keys and projects its path like every source candidate.
SOURCE_CONTENT_SAMPLES = 8


def source_content_value(value, mode):
    require(type(value) is dict and set(value) == {'mode','stage','changed','missing','added','reordered','samples'} and
            value['mode'] == mode and mode in SOURCE_IO_MODES and value['stage'] == 'content' and
            all(type(value[key]) is int and 0 <= value[key] <= SOURCE_MAX_ENTRIES for key in ('changed','missing','added')) and
            type(value['reordered']) is bool and type(value['samples']) is list and
            len(value['samples']) <= SOURCE_CONTENT_SAMPLES, 'diagnostic')
    samples = []
    for sample in value['samples']:
        require(type(sample) is dict and set(sample) == {'kind','fields','candidate'} and
                sample['kind'] in ('changed','missing','added') and type(sample['fields']) is list and
                len(sample['fields']) <= 16 and sample['fields'] == sorted(set(sample['fields'])) and
                all(isinstance(x, str) and re.fullmatch(r'[A-Za-z][A-Za-z0-9]{0,31}', x) for x in sample['fields']) and
                (sample['kind'] == 'changed') == bool(sample['fields']), 'diagnostic')
        item = sample['candidate']
        require(type(item) is dict and set(item) in ({'bytes','sha256'},{'bytes','sha256','name'}) and
                type(item['bytes']) is int and 0 < item['bytes'] <= 4*1024**2 and
                isinstance(item['sha256'],str) and re.fullmatch(r'[a-f0-9]{64}',item['sha256']) is not None, 'diagnostic')
        require('name' not in item or source_path_name(item['name']) and len(item['name'].encode()) == item['bytes'] and
                hashlib.sha256(item['name'].encode()).hexdigest() == item['sha256'], 'diagnostic')
        samples.append({'kind':sample['kind'], 'fields':list(sample['fields']), 'candidate':dict(item)})
    require(len(json.dumps(value).encode()) <= 4096, 'diagnostic')
    return {'mode':value['mode'], 'stage':'content', 'changed':value['changed'], 'missing':value['missing'],
            'added':value['added'], 'reordered':value['reordered'], 'samples':samples}


def source_content_error(expected, current):
    error = CheckpointError('source-content-changed')
    try:
        context = SOURCE_IO_CONTEXT.get()
        require(type(context) is tuple and len(context) == 2 and context[0] in SOURCE_IO_MODES, 'diagnostic')
        old = {row['path']: row for row in expected}
        new = {row['path']: row for row in current}
        differences = []
        for name in sorted(set(old) | set(new)):
            if name not in new:
                differences.append((name, 'missing', []))
            elif name not in old:
                differences.append((name, 'added', []))
            elif old[name] != new[name]:
                differences.append((name, 'changed', sorted({key for key in set(old[name]) | set(new[name])
                                                            if old[name].get(key) != new[name].get(key)})))
        count = lambda kind: sum(1 for item in differences if item[1] == kind)
        step = max(1, -(-len(differences) // SOURCE_CONTENT_SAMPLES))
        samples = []
        for name, kind, fields in differences[::step][:SOURCE_CONTENT_SAMPLES]:
            raw = name.encode()
            samples.append({'kind':kind, 'fields':fields,
                            'candidate':{'bytes':len(raw), 'sha256':hashlib.sha256(raw).hexdigest(),
                                         **({'name':name} if source_path_name(name) else {})}})
        error.sourceContentFailure = source_content_value({'mode':context[0], 'stage':'content',
            'changed':count('changed'), 'missing':count('missing'), 'added':count('added'),
            'reordered':not differences and len(expected) == len(current), 'samples':samples}, context[0])
    except Exception:
        try:
            error.sourceContentFailureInvalid = True
        except Exception:
            pass
    return error


def source_content_failure_fields(error, mode):
    if mode not in SOURCE_IO_MODES or type(error) is not CheckpointError or str(error) != 'source-content-changed':
        return {}
    try:
        if error.__dict__.get('sourceContentFailureInvalid') is True:
            return {'sourceContentFailureInvalid':True}
        value = error.__dict__.get('sourceContentFailure')
        if value is None:
            return {}
        return {'sourceContentFailure':source_content_value(value, mode)}
    except Exception:
        return {'sourceContentFailureInvalid':True}


# Progress of the running owned-source metadata call: the current phase, the
# completed phases with their wall times, and walk/hash counters. Only the
# main thread writes it. A deadline reports it, so it always says where it was;
# a Linux success returns the phase timings.
SOURCE_PHASES = ('start', 'sidecar-read', 'stat-cache-read', 'repositories', 'inventory', 'hash',
                 'post-inventory', 'compare', 'apply-literals', 'apply-utime', 'postcheck',
                 'sidecar-write', 'sidecar-readback', 'record-literals', 'stat-cache-write', 'done')
SOURCE_PROGRESS = None


def source_progress_start(seconds):
    global SOURCE_PROGRESS
    SOURCE_PROGRESS = {'phase':'start', 'since':time.monotonic(), 'began':time.monotonic(), 'phases':[],
                       'walked':0, 'files':None, 'bytes':None, 'hashedFiles':0, 'hashedBytes':0,
                       'reusedFiles':0, 'seconds':seconds, 'totals':[0, 0, 0]}


def source_phase(name):
    progress = SOURCE_PROGRESS
    if progress is None:
        return
    require(name in SOURCE_PHASES, 'source-phase')
    now = time.monotonic()
    if len(progress['phases']) < 64:
        progress['phases'].append([progress['phase'], int((now - progress['since']) * 1000)])
    progress['phase'], progress['since'] = name, now
    if name in ('inventory', 'post-inventory'):
        progress['walked'] = 0


def source_progress_value(mode):
    progress = SOURCE_PROGRESS
    require(type(progress) is dict, 'diagnostic')
    now = time.monotonic()
    return {'mode':mode, 'phase':progress['phase'], 'elapsedMs':int((now - progress['began']) * 1000),
            'phaseMs':int((now - progress['since']) * 1000), 'phases':[list(item) for item in progress['phases']],
            'walked':progress['walked'], 'files':progress['files'], 'bytes':progress['bytes'],
            'hashedFiles':progress['hashedFiles'], 'hashedBytes':progress['hashedBytes'],
            'reusedFiles':progress['reusedFiles'], 'seconds':progress['seconds']}


def source_deadline_value(value, mode):
    keys = {'mode','phase','elapsedMs','phaseMs','phases','walked','files','bytes','hashedFiles','hashedBytes','reusedFiles','seconds'}
    count = lambda x: type(x) is int and 0 <= x <= MAX_RAW + SOURCE_MAX_FILE
    require(type(value) is dict and set(value) == keys and value['mode'] == mode and mode in SOURCE_IO_MODES and
            value['phase'] in SOURCE_PHASES and all(count(value[key]) for key in
            ('elapsedMs','phaseMs','walked','hashedFiles','hashedBytes','reusedFiles')) and
            type(value['seconds']) is int and 0 < value['seconds'] <= SOURCE_LINUX_SECONDS and
            type(value['phases']) is list and len(value['phases']) <= 64 and
            all(type(item) is list and len(item) == 2 and item[0] in SOURCE_PHASES and count(item[1]) for item in value['phases']) and
            (value['files'] is None) == (value['bytes'] is None) and
            (value['files'] is None or (count(value['files']) and count(value['bytes']) and
             value['hashedFiles'] + value['reusedFiles'] <= value['files'] and value['hashedBytes'] <= value['bytes'])),
            'diagnostic')
    require(len(json.dumps(value).encode()) <= 4096, 'diagnostic')
    return {key:(list(map(list, value[key])) if key == 'phases' else value[key]) for key in sorted(keys)}


def source_deadline_failure_fields(error, mode):
    if mode not in SOURCE_IO_MODES or type(error) is not CheckpointError or str(error) != 'archive-deadline':
        return {}
    try:
        if SOURCE_PROGRESS is None:
            return {}
        return {'sourceDeadlineFailure':source_deadline_value(source_progress_value(mode), mode)}
    except Exception:
        return {'sourceDeadlineFailureInvalid':True}


# Diagnostic only: which owned source file failed the identity check and which
# predicate failed. The path is projected like every other source candidate.
SOURCE_FILE_PREDICATES = ('kind', 'nlink', 'size', 'stamp', 'ctime', 'descriptor')


def source_file_value(value, mode):
    require(type(value) is dict and set(value) == {'mode','stage','predicate','candidate'} and
            value['mode'] == mode and mode in SOURCE_IO_MODES and value['stage'] == 'file-identity' and
            value['predicate'] in SOURCE_FILE_PREDICATES, 'diagnostic')
    item = value['candidate']
    require(type(item) is dict and set(item) in ({'bytes','sha256'},{'bytes','sha256','name'}) and
            type(item['bytes']) is int and 0 < item['bytes'] <= 4*1024**2 and
            isinstance(item['sha256'],str) and re.fullmatch(r'[a-f0-9]{64}',item['sha256']) is not None, 'diagnostic')
    require('name' not in item or source_path_name(item['name']) and len(item['name'].encode()) == item['bytes'] and
            hashlib.sha256(item['name'].encode()).hexdigest() == item['sha256'], 'diagnostic')
    require(len(json.dumps(value).encode()) <= 2048, 'diagnostic')
    return {'mode':value['mode'], 'stage':value['stage'], 'predicate':value['predicate'], 'candidate':dict(item)}


def source_file_error(name, predicate):
    error = CheckpointError('source-file-identity')
    try:
        context = SOURCE_IO_CONTEXT.get()
        require(type(context) is tuple and len(context) == 2 and context[0] in SOURCE_IO_MODES and
                isinstance(name, str) and all(part not in ('', '.', '..') for part in name.split('/')), 'diagnostic')
        raw = name.encode()
        error.sourceFileFailure = source_file_value({'mode':context[0], 'stage':'file-identity', 'predicate':predicate,
            'candidate':{'bytes':len(raw), 'sha256':hashlib.sha256(raw).hexdigest(),
                         **({'name':name} if source_path_name(name) else {})}}, context[0])
    except Exception:
        try:
            error.sourceFileFailureInvalid = True
        except Exception:
            pass
    return error


def source_file_failure_fields(error, mode):
    if mode not in SOURCE_IO_MODES or type(error) is not CheckpointError or str(error) != 'source-file-identity':
        return {}
    try:
        if error.__dict__.get('sourceFileFailureInvalid') is True:
            return {'sourceFileFailureInvalid':True}
        value = error.__dict__.get('sourceFileFailure')
        if value is None:
            return {}
        return {'sourceFileFailure':source_file_value(value, mode)}
    except Exception:
        return {'sourceFileFailureInvalid':True}


MAX_BYTES = 32 * 1024**3
CHUNK_BYTES = 1024**3
MAX_RAW = 256 * 1024**3
MAX_ENTRIES = 300000
MAX_METADATA = 128 * 1024**2
SOURCE_METADATA_MAX_BYTES = 1536 * 1024**2
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


def source_path_name(value):
    return (isinstance(value, str) and 0 < len(value.encode()) <= 1024 and
            re.fullmatch(r'[A-Za-z0-9_./ +@=-]+', value) is not None and
            (value in ('src', 'depot_tools', '.gclient', '.gclient_entries') or
             value.startswith(('src/', 'depot_tools/'))) and
            all(part not in ('', '.', '..') for part in value.split('/')))


def source_path_failure(value, phase):
    encoded = value.encode() if isinstance(value, str) else None
    if encoded is None:
        predicate = 'type'
    elif not 0 < len(encoded) <= 1024:
        predicate = 'length'
    elif value.startswith('/'):
        predicate = 'absolute'
    elif '\\' in value:
        predicate = 'separator'
    elif ':' in value:
        predicate = 'colon'
    elif any(x in ('', '.', '..') or x.endswith((' ', '.')) or
             re.match(r'(?i)^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)', x) for x in value.split('/')):
        predicate = 'component'
    elif any(ord(c) < 32 or ord(c) == 127 for c in value):
        predicate = 'control'
    else:
        predicate = 'unclassified'
    return {'mode':SOURCE_PATH_MODE, 'phase':phase, 'predicate':predicate,
            'bytes':len(encoded) if encoded is not None else None,
            'sha256':hashlib.sha256(encoded).hexdigest() if encoded is not None else None,
            **({'name':value} if source_path_name(value) else {})}


# Exact members of the three Debian bullseye sysroots a Linux ARM checkout
# fetches: arm64 (target), amd64 (host) and i386 (fetched by the same DEPS
# condition on an x64 host). Each tarball is SHA-256 pinned by DEPS and
# sysroots.json at the pinned commit, and the source snapshot still hashes and
# binds every entry. Keys are sysroot directory -> multiarch triplet.
SOURCE_SYSROOTS = {
    'src/build/linux/debian_bullseye_arm64-sysroot/': 'aarch64-linux-gnu',
    'src/build/linux/debian_bullseye_amd64-sysroot/': 'x86_64-linux-gnu',
    'src/build/linux/debian_bullseye_i386-sysroot/': 'i386-linux-gnu',
}


# systemd escapes '-' in unit names as a literal "\x2d".
SOURCE_LITERAL_MEMBERS = frozenset(
    root + 'lib/systemd/system/system-systemd\\x2dcryptsetup.slice' for root in SOURCE_SYSROOTS)


def source_literal_member(value):
    return (value in SOURCE_LITERAL_MEMBERS and
            SOURCE_PATH_MODE in ('source-record', 'source-apply', 'source-verify') and
            hasattr(os, 'uname') and os.uname().sysname == 'Linux')


# Case pairs: the Linux uapi netfilter headers and Perl's Sys/ and sys/
# directories differ only by case in each sysroot. An alias group is admitted
# only when every member is listed here; any other case or normalization alias
# is denied.
SOURCE_CASE_MEMBERS = frozenset(root + name for root, triplet in SOURCE_SYSROOTS.items() for name in (
    'usr/include/linux/netfilter/xt_CONNMARK.h', 'usr/include/linux/netfilter/xt_connmark.h',
    'usr/include/linux/netfilter/xt_DSCP.h', 'usr/include/linux/netfilter/xt_dscp.h',
    'usr/include/linux/netfilter/xt_MARK.h', 'usr/include/linux/netfilter/xt_mark.h',
    'usr/include/linux/netfilter/xt_RATEEST.h', 'usr/include/linux/netfilter/xt_rateest.h',
    'usr/include/linux/netfilter/xt_TCPMSS.h', 'usr/include/linux/netfilter/xt_tcpmss.h',
    'usr/include/linux/netfilter_ipv4/ipt_ECN.h', 'usr/include/linux/netfilter_ipv4/ipt_ecn.h',
    'usr/include/linux/netfilter_ipv4/ipt_TTL.h', 'usr/include/linux/netfilter_ipv4/ipt_ttl.h',
    'usr/include/linux/netfilter_ipv6/ip6t_HL.h', 'usr/include/linux/netfilter_ipv6/ip6t_hl.h',
    'usr/lib/' + triplet + '/perl/5.32.1/Sys', 'usr/lib/' + triplet + '/perl/5.32.1/sys',
))


def source_case_member(value):
    return (value in SOURCE_CASE_MEMBERS and
            SOURCE_PATH_MODE in ('source-record', 'source-apply', 'source-verify') and
            hasattr(os, 'uname') and os.uname().sysname == 'Linux')


def member_alias(aliases, name, admitted):
    alias = unicodedata.normalize('NFC', name).casefold()
    require(alias not in aliases or (admitted is True and aliases[alias] is True), 'member-alias')
    aliases[alias] = admitted is True and aliases.get(alias, True) is True


def source_relative(value, phase):
    if SOURCE_PATH_MODE not in ('source-record', 'source-apply', 'source-verify'):
        return relative(value)
    if source_literal_member(value):
        return value
    try:
        return relative(value)
    except CheckpointError as error:
        if type(error) is CheckpointError and error.args == ('member-path',):
            try:
                error.sourcePathFailure = source_path_failure(value, phase)
            except BaseException:
                error.sourcePathFailureInvalid = True
        raise


def source_failure_fields(error):
    if SOURCE_PATH_MODE not in ('source-record', 'source-apply', 'source-verify') or type(error) is not CheckpointError:
        return {}
    try:
        value = error.__dict__.get('sourcePathFailure')
        invalid = error.__dict__.get('sourcePathFailureInvalid') is True
        if invalid:
            return {'sourcePathFailureInvalid':True}
        if value is None:
            return {}
        require(type(value) is dict and set(value) in (
            {'mode','phase','predicate','bytes','sha256'}, {'mode','phase','predicate','bytes','sha256','name'}), 'diagnostic')
        require(value['mode'] == SOURCE_PATH_MODE and value['phase'] in ('registry-key','filesystem-member') and
                value['predicate'] in ('type','length','absolute','separator','colon','component','control','unclassified'), 'diagnostic')
        require((value['predicate']=='type' and value['bytes'] is None and value['sha256'] is None and 'name' not in value) or
                (value['predicate']!='type' and type(value['bytes']) is int and 0 <= value['bytes'] <= 4*1024**2 and
                 isinstance(value['sha256'],str) and re.fullmatch(r'[a-f0-9]{64}',value['sha256']) is not None), 'diagnostic')
        require('name' not in value or (source_path_name(value['name']) and len(value['name'].encode())==value['bytes'] and
                hashlib.sha256(value['name'].encode()).hexdigest()==value['sha256']), 'diagnostic')
        return {'sourcePathFailure':value}
    except BaseException:
        return {'sourcePathFailureInvalid':True}

# In-process capability: never serialized or selected by an input/report field.
_MAC_EXTERNAL_SDK_MEMBERS = object()
_MAC_EXTERNAL_SDK_ROOT = '/Applications/Xcode_26.3.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk'


def mac_external_sdk_relative(value):
    require(isinstance(value, str) and 0 < len(value.encode()) <= 1024, 'member-path')
    require(not value.startswith('/') and '\\' not in value and re.match(r'^[A-Za-z]:', value) is None, 'member-path')
    parts = value.split('/')
    require(all(x not in ('', '.', '..') and not x.endswith((' ', '.')) and not re.match(r'(?i)^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)', x) for x in parts), 'member-path')
    require(not any(ord(c) < 32 or ord(c) == 127 for c in value), 'member-path')
    return value


def source_member_policy(root, policy, member_policy):
    require(member_policy is None or (member_policy is _MAC_EXTERNAL_SDK_MEMBERS and
            policy is not None and policy.get('mac') is True and policy.get('external') is True and
            root == Path(_MAC_EXTERNAL_SDK_ROOT)), 'source-member-policy')
    return mac_external_sdk_relative if member_policy is _MAC_EXTERNAL_SDK_MEMBERS else relative




def external_member_diagnostic(value):
    # Observation only. relative() remains the authority and is never bypassed.
    if not isinstance(value, str):
        return None
    count = len(value)
    encoded = value.encode() if count <= 1024 else None
    predicate = subpredicate = None
    if not count or encoded is None or len(encoded) > 1024:
        predicate = 'type-or-byte-bound'
        subpredicate = 'empty' if not count else 'byte-bound'
    elif value.startswith('/') or '\\' in value or ':' in value:
        predicate = 'absolute-backslash-or-colon'
        subpredicate = 'absolute' if value.startswith('/') else 'backslash' if '\\' in value else 'colon'
    else:
        for part in value.split('/'):
            if part in ('', '.', '..'):
                predicate, subpredicate = 'component-syntax', 'empty-dot-parent'
            elif part.endswith((' ', '.')):
                predicate, subpredicate = 'component-syntax', 'trailing-space-or-dot'
            elif re.match(r'(?i)^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)', part):
                predicate, subpredicate = 'component-syntax', 'dos-reserved-component'
            if predicate is not None:
                break
        if predicate is None and any(ord(c) < 32 or ord(c) == 127 for c in value):
            predicate, subpredicate = 'control-character', 'control'
    if predicate is None:
        return None
    omit = value.startswith(('/', '\\', '~')) or re.match(r'^[A-Za-z]:', value) is not None or '..' in value.split('/')
    result = {'role':'sdk', 'phase':'snapshot', 'site':'inventory-relative',
              'predicate':predicate, 'subpredicate':subpredicate,
              'pathPrefix':None if omit else value[:256],
              'pathTruncated':not omit and count > 256, 'pathOmitted':omit,
              'pathOmittedReason':'ABSOLUTE_OR_UNPROVEN_RELATIVE' if omit else None,
              'characterCount':count if count <= 1024 else None,
              'characterCountAtLeast':1025 if count > 1024 else None,
              'utf8Bytes':len(encoded) if encoded is not None else None}
    require(len(json.dumps(result, ensure_ascii=True).encode()) <= 4096, 'external-member-diagnostic-bound')
    return result


def external_member_fields(error):
    # Do not serialize arbitrary exception attributes or fields from other roles.
    try:
        if (type(error) is not CheckpointError or error.args != ('member-path',) or
                globals().get('MAC_EXTERNAL_ROLE') != 'sdk' or
                globals().get('MAC_EXTERNAL_PHASE') != 'snapshot'):
            return {}
        value = getattr(error, 'external_member_failure', None)
        expected = {'role','phase','site','predicate','subpredicate','pathPrefix',
                    'pathTruncated','pathOmitted','pathOmittedReason',
                    'characterCount','characterCountAtLeast','utf8Bytes'}
        if type(value) is not dict or set(value) != expected:
            return {}
        if (value['role'] != 'sdk' or value['phase'] != 'snapshot' or value['site'] != 'inventory-relative' or
                value['predicate'] not in ('type-or-byte-bound','absolute-backslash-or-colon','component-syntax','control-character') or
                value['subpredicate'] not in ('empty','byte-bound','absolute','backslash','colon','empty-dot-parent','trailing-space-or-dot','dos-reserved-component','control')):
            return {}
        prefix = value['pathPrefix']
        if prefix is not None and (type(prefix) is not str or len(prefix) > 256 or
                prefix.startswith(('/', '\\', '~')) or re.match(r'^[A-Za-z]:', prefix) is not None or '..' in prefix.split('/')):
            return {}
        if (type(value['pathTruncated']) is not bool or type(value['pathOmitted']) is not bool or
                value['pathOmittedReason'] not in (None,'ABSOLUTE_OR_UNPROVEN_RELATIVE')):
            return {}
        for name in ('characterCount','characterCountAtLeast','utf8Bytes'):
            n = value[name]
            if n is not None and (type(n) is not int or not 0 <= n <= 4096):
                return {}
        if len(json.dumps(value, ensure_ascii=True).encode()) > 4096:
            return {}
        return {'externalMemberFailure':value}
    except BaseException:
        return {}


# Disclosure labels only: never input roots, filesystem authority or link policy.
_EXTERNAL_LINK_PUBLIC_PREFIXES = {
    'apple-system-library': '/System/Library/',
    'apple-system-lib': '/usr/lib/',
    'apple-system-share': '/usr/share/',
    'selected-xcode-developer': '/Applications/Xcode_26.3.app/Contents/Developer/',
    'pinned-python-cellar': '/usr/local/Cellar/python@3.14/3.14.7/',
}
_EXTERNAL_LINK_ROLES = ('sdk', 'toolchain', 'metal', 'python')


def external_link_prefix(value):
    prefix = ''
    for char in value[:128]:
        if len(json.dumps(prefix + char, ensure_ascii=True).encode()) > 512:
            break
        prefix += char
    return prefix, len(prefix) < len(value)


def external_link_text(value, roots, role, origin=False):
    result = {'scope':'omitted', 'role':None, 'publicPrefix':None, 'prefix':None,
              'utf8Bytes':None, 'sha256':None, 'truncated':False, 'omitted':True,
              'omittedReason':'UNAVAILABLE'}
    if type(value) is not str or not 0 < len(value) <= 4096:
        return result
    raw = value.encode()
    if len(raw) > 4096:
        return result
    result.update(utf8Bytes=len(raw), sha256=hashlib.sha256(raw).hexdigest(),
                  omittedReason='UNKNOWN_ABSOLUTE' if value.startswith('/') else 'UNSAFE_TARGET')
    if (value.startswith(('\\','~')) or re.match(r'^[A-Za-z]:',value) or '\\' in value or
            any(ord(c)<32 or ord(c)==127 for c in value)):
        return result
    suffix = value
    if value.startswith('/'):
        candidates = [(r,root) for r,root in roots.items() if value==root or value.startswith(root+'/')]
        if candidates:
            candidates.sort(key=lambda item:(-len(item[1]),item[0]!=role))
            selected,root = candidates[0];suffix=value[len(root):].removeprefix('/')
            result.update(scope='declared-role',role=selected)
        else:
            for label,root in _EXTERNAL_LINK_PUBLIC_PREFIXES.items():
                if value.startswith(root):
                    suffix=value[len(root):];result.update(scope='public-prefix',publicPrefix=label);break
            else:
                return result
    else:
        result.update(scope='declared-role' if origin else 'descendant-relative',role=role)
    try:
        if suffix:
            (mac_external_sdk_relative if result['role']=='sdk' else relative)(suffix)
    except BaseException:
        result.update(scope='omitted',role=None,publicPrefix=None)
        return result
    prefix,truncated=external_link_prefix(suffix)
    result.update(prefix=prefix,truncated=truncated,omitted=False,omittedReason=None)
    return result


def external_link_address(parts, roots, role):
    # Capture an existing validator address only; never resolve/stat a new path.
    if type(parts) not in (tuple,list) or len(parts)>1024:
        return external_link_text(None,roots,role)
    size=1
    for part in parts:
        if type(part) is not str or len(part)>4096:
            return external_link_text(None,roots,role)
        size += len(part.encode())+1
        if size>4096:
            return external_link_text(None,roots,role)
    return external_link_text('/'+'/'.join(parts),roots,role)


def external_link_diagnostic(roots, role, row, state):
    # This function is invoked only AFTER the original validator exception exists.
    developer='/Applications/Xcode_26.3.app/Contents/Developer'
    require(type(roots) is dict and set(roots)==set(_EXTERNAL_LINK_ROLES) and
            roots['sdk']==_MAC_EXTERNAL_SDK_ROOT and
            roots['toolchain']==developer+'/Toolchains/XcodeDefault.xctoolchain' and
            roots['python']=='/usr/local/Cellar/python@3.14/3.14.7/Frameworks/Python.framework' and
            (roots['metal']==roots['toolchain'] or re.fullmatch(r'/Users/runner/Library/Developer/DVTDownloads/MetalToolchain/mounts/[a-f0-9]{40}/Metal\.xctoolchain',roots['metal']) is not None),
            'external-link-diagnostic-shape')
    require(role in _EXTERNAL_LINK_ROLES and type(row) is dict and row.get('kind')=='symlink' and
            type(state) is dict and state.get('site') in ('declared-role-entry','declared-root-boundary','absolute-root-underflow'),
            'external-link-diagnostic-shape')
    (mac_external_sdk_relative if role=='sdk' else relative)(row['path'])
    origin=external_link_text(row['path'],roots,role,origin=True)
    require(origin['scope']=='declared-role' and not origin['omitted'], 'external-link-diagnostic-shape')
    target=external_link_text(row['target'],roots,role)
    require(target['sha256']==row.get('sha256') and target['sha256'] is not None,'external-link-diagnostic-shape')
    address=state.get('address');site=state['site'];ancestor=state.get('ancestors')
    require(type(address) in (tuple,list) and type(ancestor) is bool,'external-link-diagnostic-shape')
    prefix_only=any(len(address)<=len(parts) and parts[:len(address)]==tuple(address)
                    for parts in (tuple(root.split('/')[1:]) for root in roots.values()))
    classification=('declared-role-entry-missing' if site=='declared-role-entry' else
                    'absolute-root-underflow' if site=='absolute-root-underflow' else
                    'verified-root-ancestor-not-final' if prefix_only and not ancestor else 'outside-declared-roots')
    value={'originRole':role,'originPath':origin,'site':site,'classification':classification,
           'attemptedDeclaredRole':state.get('attemptedRole'),'ancestorNavigation':ancestor,
           'expansions':state.get('expansions',0),'target':target,
           'lastExpandedRole':state.get('lastRole',role),
           'lastExpandedTarget':external_link_text(state.get('lastTarget',row['target']),roots,state.get('lastRole',role)),
           'attemptedAddress':external_link_address(address,roots,state.get('attemptedRole') or role)}
    require(external_link_projection_valid(value), 'external-link-diagnostic-shape')
    return value


def external_link_projection_valid(value):
    if type(value) is not dict or set(value)!={'originRole','originPath','site','classification','attemptedDeclaredRole',
            'ancestorNavigation','expansions','target','lastExpandedRole','lastExpandedTarget','attemptedAddress'}:
        return False
    if (value['originRole'] not in _EXTERNAL_LINK_ROLES or value['lastExpandedRole'] not in _EXTERNAL_LINK_ROLES or
            value['attemptedDeclaredRole'] not in (None,*_EXTERNAL_LINK_ROLES) or
            type(value['ancestorNavigation']) is not bool or type(value['expansions']) is not int or not 0<=value['expansions']<=64 or
            (value['site'],value['classification']) not in (
                ('declared-role-entry','declared-role-entry-missing'),
                ('declared-root-boundary','outside-declared-roots'),
                ('declared-root-boundary','verified-root-ancestor-not-final'),
                ('absolute-root-underflow','absolute-root-underflow'))):
        return False
    if (value['site']=='declared-role-entry') != (value['attemptedDeclaredRole'] is not None):
        return False
    fields={'scope','role','publicPrefix','prefix','utf8Bytes','sha256','truncated','omitted','omittedReason'}
    for key in ('originPath','target','lastExpandedTarget','attemptedAddress'):
        item=value[key]
        if type(item) is not dict or set(item)!=fields:
            return False
        if (item['scope'] not in ('omitted','declared-role','public-prefix','descendant-relative') or
                item['role'] not in (None,*_EXTERNAL_LINK_ROLES) or
                item['publicPrefix'] not in (None,*_EXTERNAL_LINK_PUBLIC_PREFIXES) or
                type(item['truncated']) is not bool or type(item['omitted']) is not bool or
                item['omittedReason'] not in (None,'UNAVAILABLE','UNKNOWN_ABSOLUTE','UNSAFE_TARGET')):
            return False
        if item['utf8Bytes'] is not None and (type(item['utf8Bytes']) is not int or not 0<item['utf8Bytes']<=4096):
            return False
        if item['sha256'] is not None and (type(item['sha256']) is not str or re.fullmatch('[a-f0-9]{64}',item['sha256']) is None):
            return False
        if (item['utf8Bytes'] is None)!=(item['sha256'] is None):
            return False
        if item['omittedReason']=='UNAVAILABLE' and item['sha256'] is not None:
            return False
        if item['omittedReason'] in ('UNKNOWN_ABSOLUTE','UNSAFE_TARGET') and item['sha256'] is None:
            return False
        if item['omitted']:
            if item['scope']!='omitted' or item['prefix'] is not None or item['role'] is not None or item['publicPrefix'] is not None or item['truncated'] or item['omittedReason'] is None:
                return False
        else:
            prefix=item['prefix']
            if (type(prefix) is not str or len(prefix)>128 or len(json.dumps(prefix,ensure_ascii=True).encode())>512 or
                    item['omittedReason'] is not None or item['sha256'] is None or
                    prefix.startswith(('/','\\','~')) or re.match(r'^[A-Za-z]:',prefix) or '\\' in prefix or
                    any(ord(c)<32 or ord(c)==127 for c in prefix) or
                    any(part in ('.','..') for part in prefix.split('/'))):
                return False
            if item['role']!='sdk' and ':' in prefix:
                return False
            if (item['scope']=='declared-role' or item['scope']=='descendant-relative'):
                if item['role'] is None or item['publicPrefix'] is not None:
                    return False
            elif item['scope']!='public-prefix' or item['publicPrefix'] is None or item['role'] is not None:
                return False
    return (value['originPath']['scope']=='declared-role' and not value['originPath']['omitted'] and
            bool(value['originPath']['prefix']) and value['originPath']['utf8Bytes']<=1024 and
            value['originPath']['role']==value['originRole'] and
            len(json.dumps(value,ensure_ascii=True).encode())<=4096)


def external_link_fields(error):
    try:
        if (type(error) is not CheckpointError or error.args!=('source-external-input-unattested',) or
                globals().get('MAC_EXTERNAL_PHASE')!='links'):
            return {}
        value=getattr(error,'external_link_failure',None)
        if not external_link_projection_valid(value):
            return {}
        return {'externalRole':value['originRole'],'externalLinkFailure':value}
    except BaseException:
        return {}



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


# Linux owned-source metadata walks and hashes the whole fetched tree (Chromium,
# three sysroots, toolchains); it alone may use the longer bound. Pack, restore,
# seal and every Mac mode keep 600 seconds.
SOURCE_LINUX_SECONDS = 2400
SOURCE_HASH_WORKERS = max(1, min(os.cpu_count() or 4, 8))
# Linux owned-source hashing is I/O-bound (1.2M mostly small files), so it
# overlaps reads with twice the CPU count, still capped at eight readers.
SOURCE_LINUX_HASH_WORKERS = max(1, min(2 * (os.cpu_count() or 4), 8))


class Budget:
    def __init__(self, seconds, maximum=600):
        require(maximum in (600, SOURCE_LINUX_SECONDS) and isinstance(seconds, int) and 0 < seconds <= maximum,
                'deadline-bound')
        self.seconds = seconds
        self.end = time.monotonic() + seconds
    def check(self):
        require(time.monotonic() < self.end, 'archive-deadline')


def inventory(root, budget, generated_links=None, source_policy=None, *, member_policy=None):
    member = source_member_policy(root, source_policy, member_policy)
    generated_links = link_recipe(generated_links or {})
    seen_links = set()
    rows, pending, aliases, raw = [], [Path('.')], {}, 0
    while pending:
        directory = pending.pop()
        with source_directory(root, directory, source_policy, budget) as iterator:
            for item in iterator:
                budget.check()
                if SOURCE_PROGRESS is not None:
                    SOURCE_PROGRESS['walked'] += 1
                raw_name = (directory / item.name).as_posix()
                candidate = raw_name
                try:
                    name = (source_relative(raw_name, 'filesystem-member') if source_policy is not None and
                            not source_policy.get('external') else member(raw_name))

                except CheckpointError as error:
                    try:
                        if (error.args == ('member-path',) and source_policy is not None and
                                source_policy.get('mac') is True and source_policy.get('external') is True and
                                globals().get('MAC_EXTERNAL_ROLE') == 'sdk' and
                                globals().get('MAC_EXTERNAL_PHASE') == 'snapshot'):
                            error.external_member_failure = external_member_diagnostic(candidate)
                    except BaseException:
                        pass  # Diagnostic projection must never replace the original denial.
                    raise

                member_alias(aliases, name, source_policy is not None and not source_policy.get('external') and
                             source_case_member(name))
                p = root / name
                external = source_policy is not None and source_policy.get('external') is True
                if source_policy is not None and not external and source_admin(root, name, source_policy, budget):
                    continue
                s = source_io_call('member-stat', p, lambda: item.stat(follow_symlinks=False) if source_policy is not None and source_policy.get('mac') else os.stat(p, follow_symlinks=False))
                if source_policy is not None:
                    require(s.st_uid in (0, os.geteuid()) if external else s.st_uid == os.geteuid(), 'source-owner')
                if stat.S_ISLNK(s.st_mode):
                    if source_policy is not None:
                        target = source_io_call('link-read', p, lambda: os.readlink(p))
                        require(isinstance(target,str) and 0 < len(target.encode()) <= 4096 and not any(ord(c)<32 for c in target), 'source-link')
                        if not external:
                            if not source_nearby_literal(source_policy,name,target,s):
                                source_link_target(root, p, target, budget)
                        row = {'path':name,'kind':'symlink','stamp':stamp(s),'target':target,'ctimeNs':s.st_ctime_ns}
                        source_mac_row(row, s, source_policy)
                        source_aggregate(source_policy, name, 0, target)
                        rows.append(row)
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
                row = {'path': name, 'kind': kind, 'stamp': stamp(s), **({'ctimeNs':s.st_ctime_ns} if source_policy is not None else {})}
                source_mac_row(row, s, source_policy)
                source_aggregate(source_policy, name, s.st_size if kind == 'file' else 0)
                if source_policy is not None and source_policy.get('mac') and kind == 'directory':
                    source_policy['_directories'][name] = source_local(s, source_policy)
                rows.append(row)
                try:
                    require(len(rows) <= (SOURCE_MAX_ENTRIES if source_policy is not None else MAX_ENTRIES) and raw <= MAX_RAW, 'input-bound')
                except CheckpointError as error:
                    source_bound_record(error, len(rows), raw, source_policy)
                    raise
    expected_links = set(generated_links)
    if len(generated_links) == 7 and not any(r['path'] == FRAMEWORK for r in rows):
        expected_links -= set(FRAMEWORK_ROLES)
    require(seen_links == expected_links, 'missing-generated-link')
    if source_policy is not None:
        literal_bytes = len(json.dumps(source_policy['_nearby_literals']['portable'],sort_keys=True,separators=(',',':')).encode()) if source_policy.get('_nearby_literals') is not None else (2 if not source_policy.get('external') and not source_policy.get('mac') else 0)
        source_metadata_precharge(sum(len(r['path'].encode()) + len(r.get('target','').encode()) + 320 for r in rows) + literal_bytes,
                                  owned_source=source_policy.get('external') is not True)
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


def source_metadata_limit(owned_sidecar=False):
    require(type(owned_sidecar) is bool, 'source-sidecar-role')
    return SOURCE_METADATA_MAX_BYTES if owned_sidecar else MAX_METADATA


def source_metadata_precharge(size, owned_source=False):
    require(type(size) is int and 0 <= size <= source_metadata_limit(owned_source), 'source-sidecar-bound')


def metadata(root, name, value, source=False, owned_sidecar=False):
    maximum = source_metadata_limit(owned_sidecar)
    if owned_sidecar:
        require(source is True and name == SOURCE_METADATA_NAME and type(value) is dict and
                set(value) == {'schemaVersion','kind','policy','sourceDateEpoch','identity','snapshot'} and
                type(value['schemaVersion']) is int and value['schemaVersion'] == 1 and
                value['sourceDateEpoch'] == SOURCE_METADATA_DATE_EPOCH and type(value['identity']) is dict and
                isinstance(value['identity'].get('canonicalRoot'), str) and type(value['snapshot']) is dict and
                ((value['kind'] == 'sorng-linuxarm-source-metadata' and value['policy'] == SOURCE_METADATA_POLICY and
                  Path(root) == Path(value['identity']['canonicalRoot']) / 'source/src/out/Release_GN_arm64') or
                 (value['kind'] == 'sorng-macintel-source-metadata' and value['policy'] == MAC_INTEL_SOURCE_METADATA_POLICY and
                  value['identity'].get('target') == 'x86_64-apple-darwin' and value['identity'].get('source') == MAC_INTEL_SOURCE and
                  value['identity']['canonicalRoot'] == '/Users/runner/work/_temp/sorng-cef-engineering/x86_64-apple-darwin/' + MAC_INTEL_SOURCE and
                  Path(root) == Path(value['identity']['canonicalRoot']) / 'source/src/out/Release_GN_x64')), 'source-sidecar-role')
    data = source_io_call('sidecar-encode', root / name, lambda: (json.dumps(value, sort_keys=True, separators=(',', ':'))+'\n').encode())
    require(len(data) <= maximum, 'metadata-bound')
    if source:
        output = source_io_call('sidecar-open', root / name, lambda: (root / name).open('xb'));primary = None
        try:
            require(source_io_call('sidecar-write', root / name, lambda: output.write(data))==len(data), 'short-write')
            source_io_call('sidecar-flush', root / name, output.flush)
        except BaseException as error:
            primary=error
            raise
        finally:
            source_close(lambda: source_io_call('sidecar-close', root / name, output.close), primary)
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
SOURCE_METADATA_POLICY = 'sorng-linuxarm-complete-owned-inputs-v2-nearby-literals'
SOURCE_METADATA_DATE_EPOCH = '1790626028'
SOURCE_CLOSE_FAILURE = False
SOURCE_JOIN_FAILURE = False
SOURCE_PATH_MODE = None
SOURCE_MAX_ENTRIES = 3000000
SOURCE_MAX_FILE = 8 * 1024**3
MAC_SOURCE_METADATA_POLICY = 'sorng-macarm-complete-owned-inputs-v1-unadmitted'
MAC_SOURCE_WRITE_ADMITTED = False
MAC_INTEL_SOURCE = '684efda8d6e0001e871ffdf3ed7df84a80643db84de4e118c8e2d2cb1e3adfef'
MAC_INTEL_SOURCE_METADATA_POLICY = 'sorng-macintel-complete-owned-inputs-v1-unadmitted'
MAC_INTEL_SOURCE_WRITE_ADMITTED = False
MAC_EXTERNAL_ROLE = None
MAC_EXTERNAL_PHASE = None
MAC_REPORT_FAILURE = False

# Exact standalone-submodule link declarations from the pinned Nearby tree.
# These remain literal inputs, never authority to follow an absent target.
NEARBY_ROOT = 'src/third_party/nearby/src'
NEARBY_HEAD = '0bad8b0c9877f92eeeb550654f1ea51a71a085e4'
NEARBY_MODULES_SHA256 = '3914e148331ecf23a42bbe017c0cc8a0efd0f0cf47ccc5b3ad08212ce4a2986f'
NEARBY_LITERAL_LINKS = (
    ('third_party/google-toolbox-for-mac/include/GTMDefines.h', '../google-toolbox-for-mac/GTMDefines.h',
     'third_party/google-toolbox-for-mac/google-toolbox-for-mac', '1b2da5e6e6b5edb1fa1427cc77e23f04069c04ad', 'GTMDefines.h'),
    ('third_party/google-toolbox-for-mac/include/GoogleToolboxForMac/GTMLogger.h', '../../google-toolbox-for-mac/Foundation/GTMLogger.h',
     'third_party/google-toolbox-for-mac/google-toolbox-for-mac', '1b2da5e6e6b5edb1fa1427cc77e23f04069c04ad', 'Foundation/GTMLogger.h'),
    ('third_party/securemessage/include/securemessage', '../securemessage/cpp/include/securemessage',
     'third_party/securemessage/securemessage', '69a02984d4563c6c21132ee882d1d3df1981f5a1', 'cpp/include/securemessage'),
    ('third_party/smhasher/include/src', '../../smhasher/smhasher/src',
     'third_party/smhasher/smhasher', '61a0530f28277f2e850bfc39600ce61d02b518de', 'src'),
    ('third_party/ukey2/include/securegcm', '../ukey2/src/main/cpp/include/securegcm',
     'third_party/ukey2/ukey2', '03290b58d9f93cdd5c9f9f7a7f9e8efc640d0c40', 'src/main/cpp/include/securegcm'),
)


def source_nearby_route(root, origin, target, gitlink, remainder, budget):
    # A fixed declaration still visits every existing ancestor in kernel order.
    # This route ends at a held EMPTY gitlink; it never follows missing/.. .
    pending = list(Path(origin).parent.parts) + target.split('/')
    resolved = []
    while pending:
        budget.check();part = pending.pop(0)
        if part == '..':
            require(resolved, 'source-nearby-binding');resolved.pop();continue
        require(part not in ('', '.'), 'source-nearby-binding')
        resolved.append(part);name = Path(*resolved).as_posix();p = root / name
        info = p.lstat()
        require(stat.S_ISDIR(info.st_mode) and info.st_uid == os.geteuid() and
                not getattr(info,'st_file_attributes',0) & 0x400 and '.git' not in resolved and
                name not in ('src/out','acquisition-logs'), 'source-nearby-binding')
        if name == gitlink:
            require(pending == remainder.split('/'), 'source-nearby-binding')
            return
    raise CheckpointError('source-nearby-binding')


def source_nearby_check(state, budget):
    if state is None:
        return
    for p,expected,identity in state['headers']:
        budget.check();safe(p)
        require((stamp(p.lstat()),p.lstat().st_ctime_ns) == identity and
                source_read_bytes(p,budget,len(expected)) == expected, 'source-nearby-changed')
    for p,target,identity in state['links'].values():
        budget.check();safe(p.parent);info=p.lstat()
        require((stamp(info),info.st_ctime_ns) == identity and os.readlink(p) == target,
                'source-nearby-changed')
    for p,fd,before in state['directories'].values():
        budget.check();safe(p);current=p.lstat();held=os.fstat(fd)
        require(stamp(current)==stamp(before)==stamp(held) and
                current.st_ctime_ns==before.st_ctime_ns==held.st_ctime_ns and
                current.st_uid==before.st_uid==held.st_uid, 'source-nearby-changed')
        entries=os.scandir(fd);primary=None
        try:
            require(next(entries,None) is None, 'source-nearby-absence')
        except BaseException as error:
            primary=error
            raise
        finally:
            source_close(entries.close,primary)
        require(stamp(p.lstat())==stamp(before)==stamp(os.fstat(fd)) and
                p.lstat().st_ctime_ns==before.st_ctime_ns==os.fstat(fd).st_ctime_ns, 'source-nearby-changed')


def source_nearby_literal(policy, name, target, info):
    if policy.get('mac') or name not in {NEARBY_ROOT+'/'+item[0] for item in NEARBY_LITERAL_LINKS}:
        return False
    state=policy.get('_nearby_literals')
    require(state is not None and name in state['links'], 'source-nearby-binding')
    _,expected,identity=state['links'][name]
    require(target==expected and (stamp(info),info.st_ctime_ns)==identity, 'source-nearby-changed')
    return True


@contextmanager
def source_nearby_literals(root, policy, budget):
    if policy.get('external') or policy.get('mac') or NEARBY_ROOT not in policy.get('repositories',set()):
        yield None
        return
    import sys
    require(sys.platform=='linux', 'source-linux-only')
    state={'headers':[],'links':{},'directories':{},'portable':[]};primary=None
    try:
        for name,expected in ((NEARBY_ROOT+'/.git/HEAD',(NEARBY_HEAD+'\n').encode()),
                              (NEARBY_ROOT+'/.gitmodules',None)):
            p=safe(root/name);before=p.lstat()
            require(stat.S_ISREG(before.st_mode) and before.st_uid==os.geteuid() and before.st_nlink==1, 'source-nearby-binding')
            raw=source_read_bytes(p,budget,1512 if expected is None else 41)
            require(raw==expected if expected is not None else len(raw)==1512 and
                    hashlib.sha256(raw).hexdigest()==NEARBY_MODULES_SHA256, 'source-nearby-binding')
            require((stamp(p.lstat()),p.lstat().st_ctime_ns)==(stamp(before),before.st_ctime_ns), 'source-nearby-changed')
            state['headers'].append((p,raw,(stamp(before),before.st_ctime_ns)))
        for origin,target,gitlink,commit,remainder in NEARBY_LITERAL_LINKS:
            budget.check();origin=NEARBY_ROOT+'/'+origin;gitlink=NEARBY_ROOT+'/'+gitlink
            p=root/origin;safe(p.parent);info=p.lstat()
            require(stat.S_ISLNK(info.st_mode) and info.st_uid==os.geteuid() and info.st_nlink==1 and
                    not getattr(info,'st_file_attributes',0)&0x400 and os.readlink(p)==target, 'source-nearby-link')
            state['links'][origin]=(p,target,(stamp(info),info.st_ctime_ns))
            source_nearby_route(root,origin,target,gitlink,remainder,budget)
            if gitlink not in state['directories']:
                directory=safe(root/gitlink);before=directory.lstat()
                require(stat.S_ISDIR(before.st_mode) and before.st_uid==os.geteuid() and before.st_nlink>0 and
                        not before.st_mode&0o7000, 'source-nearby-binding')
                fd=os.open(directory,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
                # Register creation-owned handle before any fallible validation.
                state['directories'][gitlink]=(directory,fd,before)
            state['portable'].append({'kind':'pinned-unpopulated-gitlink-literal','origin':origin,'rawTarget':target,
                'rawTargetSha256':hashlib.sha256(target.encode()).hexdigest(),'nearbyHead':NEARBY_HEAD,
                'gitmodulesSha256':NEARBY_MODULES_SHA256,'gitlink':gitlink,'gitlinkCommit':commit,
                'absentFirstComponent':remainder.split('/')[0],'remainder':remainder,'state':'empty'})
        source_nearby_check(state,budget)
        yield state
        source_nearby_check(state,budget)
    except BaseException as error:
        primary=error
        raise
    finally:
        source_cleanup_all([lambda fd=fd:os.close(fd) for _,fd,_ in state['directories'].values()],primary)


def source_birth(info, policy=None):
    # CPython Darwin exposes float st_birthtime, not exact st_birthtime_ns.
    # Only read-only external observations may explicitly retain unavailable ns.
    if not hasattr(info, 'st_birthtime_ns') and policy is not None and policy.get('mac') and policy.get('external') is True:
        return None
    value = getattr(info, 'st_birthtime_ns', None)
    require(type(value) is int and 0 <= value < 2**63, 'source-mac-birth-unavailable')
    return value


def source_local(info, policy=None):
    base = (stamp(info), info.st_ctime_ns)
    return base + (source_birth(info, policy), info.st_uid, info.st_gid) if policy is not None and policy.get('mac') else base


def source_mac_row(row, info, policy):
    if policy is not None and policy.get('mac'):
        row.update(birthNs=source_birth(info, policy), uid=info.st_uid, gid=info.st_gid)
        require(info.st_nlink > 0, 'source-mac-nlink')


def source_aggregate(policy, name, size, target=''):
    if policy is None or not policy.get('external'):
        return
    shared = policy['aggregate']
    shared['entries'] += 1;shared['bytes'] += size
    shared['metadata'] += len(name.encode()) + len(target.encode()) + 384
    require(shared['entries'] <= SOURCE_MAX_ENTRIES and shared['bytes'] <= MAX_RAW and
            shared['metadata'] <= MAX_METADATA - 65536, 'source-external-aggregate')


def source_cleanup_all(closers, primary):
    global SOURCE_CLOSE_FAILURE
    first = None
    for close in closers:
        try:
            close()
        except BaseException as error:
            SOURCE_CLOSE_FAILURE = True
            if first is None:
                first = error
    if primary is None and first is not None:
        raise first


@contextmanager
def source_directory(root, directory, policy, budget):
    if policy is None or not policy.get('mac'):
        if SOURCE_IO_CONTEXT.get() is None:
            with os.scandir(root / directory) as entries:
                yield entries
            return
        entries = source_io_call('directory-open', root / directory, lambda: os.scandir(root / directory))
        primary = None
        def observed():
            while True:
                try:
                    item = next(entries)
                except StopIteration:
                    return
                except Exception as error:
                    source_io_record(error, 'directory-next', root / directory)
                    raise
                yield item
        try:
            yield observed()
        except BaseException as error:
            primary = error
            raise
        finally:
            source_close(lambda: source_io_call('file-close', root / directory, entries.close), primary)
        return
    budget.check();p = safe(root / directory);before = p.stat()
    require(stat.S_ISDIR(before.st_mode), 'source-mac-directory')
    if directory != Path('.'):
        require(source_local(before, policy) == policy['_directories'].get(directory.as_posix()),
                'source-mac-directory-changed')
    fd = os.open(p, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    entries = None;primary = None
    try:
        require(source_local(os.fstat(fd), policy) == source_local(before, policy), 'source-mac-directory-changed')
        entries = os.scandir(fd)
        yield entries
        budget.check();safe(p)
        require(source_local(p.stat(), policy) == source_local(before, policy) == source_local(os.fstat(fd), policy),
                'source-mac-directory-changed')
    except BaseException as error:
        primary = error
        raise
    finally:
        source_cleanup_all(([entries.close] if entries is not None else []) + [lambda: os.close(fd)], primary)



def source_close(close, primary):
    global SOURCE_CLOSE_FAILURE
    try:
        close()
    except BaseException:
        SOURCE_CLOSE_FAILURE = True
        if primary is None:
            raise


def source_read_bytes(path, budget, maximum):
    path = source_io_call('file-path-stat', path, lambda: safe(path));before = source_io_call('file-path-stat', path, path.stat)
    require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and 0 < before.st_size <= maximum,
            'source-metadata-read-bound')
    stream = source_io_call('file-open', path, lambda: path.open('rb'));primary = None;parts = [];count = 0
    try:
        fd_before = source_io_call('file-fd-stat', path, lambda: os.fstat(stream.fileno()))
        require(stamp(fd_before)==stamp(before) and fd_before.st_ctime_ns==before.st_ctime_ns,
                'source-metadata-read-changed')
        while True:
            budget.check();chunk=source_io_call('file-read', path, lambda: stream.read(65536))
            if not chunk:
                break
            count+=len(chunk);require(count<=before.st_size, 'source-metadata-read-bound');parts.append(chunk)
        after=source_io_call('file-path-stat', path, path.stat);held=source_io_call('file-fd-stat', path, lambda: os.fstat(stream.fileno()))
        require(count==before.st_size and stamp(after)==stamp(before)==stamp(held) and
                after.st_ctime_ns==before.st_ctime_ns==held.st_ctime_ns, 'source-metadata-read-changed')
    except BaseException as error:
        primary=error
        raise
    finally:
        source_close(lambda: source_io_call('file-close', path, stream.close), primary)
    return b''.join(parts)


def source_json(raw):
    def unique(pairs):
        result = {}
        for key,value in pairs:
            require(key not in result, 'source-json-duplicate')
            result[key] = value
        return result
    return json.loads(raw, object_pairs_hook=unique)

def source_registry_repository(name, value):
    # c101 gclient._SaveEntries serializes dependency labels, not just paths.
    # GCS uses path:object and CIPD path:package. Those labels authorize no
    # filesystem path or Git-admin exclusion; the whole registry is hashed.
    from urllib.parse import urlsplit
    require(isinstance(name, str) and 0 < len(name.encode()) <= 1024, 'source-registry-name')
    require(value is None or isinstance(value, str) and len(value) <= 8192, 'source-repository-value')
    if ':' not in name:
        source_relative(name, 'registry-key')
        require(name == 'src' or name.startswith('src/'), 'source-repository-root')
        return name
    require(name.count(':') == 1 and isinstance(value, str), 'source-registry-kind')
    directory, suffix = name.split(':')
    source_relative(directory, 'registry-key')
    require(directory == 'src' or directory.startswith('src/'), 'source-repository-root')
    require(suffix and not suffix.startswith('/') and '\\' not in suffix and
            not any(ord(c) < 32 or ord(c) == 127 for c in suffix) and
            all(part not in ('', '.', '..') for part in suffix.split('/')), 'source-registry-label')
    try:
        parsed = urlsplit(value)
        no_credentials = parsed.username is None and parsed.password is None and parsed.port is None
    except ValueError:
        raise CheckpointError('source-registry-value') from None
    require(no_credentials and not parsed.query and not parsed.fragment, 'source-registry-value')
    if value.startswith('gs://'):
        require(re.fullmatch(r'[a-z0-9][a-z0-9_.-]{1,220}[a-z0-9]', parsed.netloc) is not None and
                '..' not in parsed.netloc and re.fullmatch(r'[A-Za-z0-9_./+@=,-]+', suffix) is not None and
                value == 'gs://' + parsed.netloc + '/' + suffix, 'source-registry-value')
    elif value.startswith('https://chrome-infra-packages.appspot.com/'):
        # The constructor preserves literal package placeholders. Do not guess
        # PinToActualRevision's expanded package or accept another service/URI.
        package = re.sub(r'\$\{(?:platform|os|arch)\}', 'literal', suffix)
        require(re.fullmatch(r'[A-Za-z0-9_./+@=-]+', package) is not None, 'source-registry-label')
        prefix = 'https://chrome-infra-packages.appspot.com/' + suffix + '@'
        require(parsed.netloc == 'chrome-infra-packages.appspot.com' and value.startswith(prefix), 'source-registry-value')
        version = value[len(prefix):]
        require(re.fullmatch(r'[A-Za-z0-9_./:+@=-]+', version) is not None and
                all(part not in ('', '.', '..') for part in version.split('/')), 'source-registry-value')
    else:
        raise CheckpointError('source-registry-kind')
    return None


def source_repositories(root, budget):
    import ast
    names = {'src', 'src/cef', 'depot_tools'}
    entry_file = source_io_call('registry-read', root / '.gclient_entries', lambda: safe(root / '.gclient_entries'))
    require(source_io_call('registry-read', entry_file, entry_file.is_file) and source_io_call('registry-read', entry_file, entry_file.stat).st_size <= 4 * 1024**2, 'source-repositories-bound')
    registry_raw = source_io_call('registry-read', entry_file, lambda: source_read_bytes(entry_file, budget, 4 * 1024**2))
    body = source_io_call('registry-parse', entry_file, lambda: ast.parse(registry_raw))
    require(len(body.body) == 1 and isinstance(body.body[0], ast.Assign) and
            len(body.body[0].targets) == 1 and isinstance(body.body[0].targets[0], ast.Name) and
            body.body[0].targets[0].id == 'entries', 'source-repositories-shape')
    require(isinstance(body.body[0].value, ast.Dict), 'source-repositories-shape')
    entries = source_io_call('registry-parse', entry_file, lambda: ast.literal_eval(body.body[0].value))
    require(len(entries) == len(body.body[0].value.keys), 'source-repositories-shape')
    require(isinstance(entries, dict) and len(entries) <= 10000, 'source-repositories-bound')
    for name, value in entries.items():
        budget.check()
        repository = source_registry_repository(name, value)
        if repository is not None:
            names.add(repository)
    return {'repositories': names, 'gitHeads': {}, 'registrySha256':hashlib.sha256(registry_raw).hexdigest()}



def source_link_target(root, path, target, budget):
    # Resolve in kernel traversal order. Lexical normalization may erase a
    # symlink, missing directory or excluded ancestor before it is checked.
    def parts(raw):
        require(isinstance(raw, str) and 0 < len(raw.encode()) <= 4096 and
                not any(ord(c) < 32 for c in raw), 'source-link')
        values = [part for part in raw.split('/') if part]
        if raw.endswith('/'):
            values.append('.')
        return values
    def absolute(raw):
        values = parts(raw);prefix = list(root.parts)[1:]
        require(values[:len(prefix)] == prefix, 'source-external-link')
        return values[len(prefix):]
    pending = absolute(target) if target.startswith('/') else list(path.parent.relative_to(root).parts) + parts(target)
    resolved = [];kind = 'directory';links = 0
    while pending:
        budget.check();part = pending.pop(0)
        require(kind == 'directory', 'source-link-kind')
        if part == '.':
            continue
        if part == '..':
            require(resolved, 'source-external-link')
            resolved.pop();kind = 'directory'
            continue
        name = Path(*resolved, part)
        require('.git' not in name.parts and name.as_posix() not in ('src/out', 'acquisition-logs'), 'source-excluded-link')
        current = root / name;info = source_io_call('link-target-stat', current, current.lstat)
        if stat.S_ISLNK(info.st_mode):
            links += 1;require(links <= 64, 'source-link-cycle')
            raw = source_io_call('link-read', current, lambda: os.readlink(current))
            if raw.startswith('/'):
                pending = absolute(raw) + pending;resolved = []
            else:
                pending = parts(raw) + pending
            kind = 'directory'
        else:
            require(stat.S_ISDIR(info.st_mode) or stat.S_ISREG(info.st_mode), 'source-link-kind')
            resolved.append(part);kind = 'directory' if stat.S_ISDIR(info.st_mode) else 'file'
    return root.joinpath(*resolved)


def source_admin(root, name, policy, budget):
    if name == 'acquisition-logs':
        info = source_io_call('member-stat', root / name, (root / name).lstat)
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
    admin = source_io_call('repository-head', root / name, lambda: safe(root / name))
    require(admin.is_dir(), 'source-git-admin-kind')
    head = source_io_call('repository-head', admin / 'HEAD', lambda: safe(admin / 'HEAD'))
    require(source_io_call('repository-head', head, head.is_file) and source_io_call('repository-head', head, head.stat).st_size == 41, 'source-detached-head')
    raw = source_io_call('repository-head', head, lambda: source_read_bytes(head, budget, 41));budget.check()
    require(re.fullmatch(rb'[a-f0-9]{40}\n', raw) is not None, 'source-detached-head')
    value = raw.decode('ascii').strip()
    old = policy['gitHeads'].setdefault(repository, value)
    require(old == value, 'source-repository-changed')
    return True


def source_hash(root, row, budget, policy=None):
    p = source_io_call('file-path-stat', root / row['path'], lambda: safe(root / row['path']));before = source_io_call('file-path-stat', p, p.stat)
    for predicate, ok in (('kind', lambda: stat.S_ISREG(before.st_mode)),
                          ('nlink', lambda: before.st_nlink > 0 if policy is not None and policy.get('external') else before.st_nlink == 1),
                          ('size', lambda: before.st_size <= SOURCE_MAX_FILE), ('stamp', lambda: stamp(before) == row['stamp']),
                          ('ctime', lambda: before.st_ctime_ns == row['ctimeNs'])):
        if not ok():
            raise source_file_error(row['path'], predicate)
    if policy is not None and policy.get('mac'):
        require(source_birth(before, policy) == row['birthNs'] and before.st_uid == row['uid'] and before.st_gid == row['gid'], 'source-mac-file-identity')
    stream = source_io_call('file-open', p, lambda: p.open('rb'));primary = None;reader = HashedReader(stream, budget);count = 0
    try:
        if not (opened_identity_matches(row['stamp'], source_io_call('file-fd-stat', p, lambda: os.fstat(stream.fileno()))) and
                source_io_call('file-fd-stat', p, lambda: os.fstat(stream.fileno())).st_ctime_ns == before.st_ctime_ns):
            raise source_file_error(row['path'], 'descriptor')
        if policy is not None and policy.get('mac'):
            require(source_local(os.fstat(stream.fileno()), policy) == source_local(before, policy), 'source-mac-file-identity')
        while True:
            chunk = source_io_call('file-read', p, lambda: reader.read(65536))
            if not chunk:
                break
            count += len(chunk)
            require(count <= before.st_size, 'source-file-changed')
        require(count == before.st_size and stamp(source_io_call('file-fd-stat', p, lambda: os.fstat(stream.fileno()))) == row['stamp'] and
                stamp(source_io_call('file-path-stat', p, p.stat)) == row['stamp'] and source_io_call('file-path-stat', p, p.stat).st_ctime_ns == before.st_ctime_ns and
                source_io_call('file-fd-stat', p, lambda: os.fstat(stream.fileno())).st_ctime_ns == before.st_ctime_ns, 'source-file-changed')
        if policy is not None and policy.get('mac'):
            require(source_local(p.stat(), policy) == source_local(before, policy) == source_local(os.fstat(stream.fileno()), policy),
                    'source-mac-file-changed')
    except BaseException as error:
        primary = error
        raise
    finally:
        source_close(lambda: source_io_call('file-close', p, stream.close), primary)
    return reader.digest.hexdigest()


def source_portable(row, digest=None, policy=None):
    result = {'path': row['path'], 'kind': row['kind'], 'mode': row['stamp'][4],
              'mtimeNs': str(row['stamp'][1])}
    if row['kind'] == 'file':
        result.update(size=row['stamp'][0], sha256=digest)
    elif row['kind'] == 'symlink':
        result.update(target=row['target'], sha256=hashlib.sha256(row['target'].encode()).hexdigest())
    if policy is not None and policy.get('mac'):
        result['nlink'] = row['stamp'][5]
        if policy.get('external'):
            result.update(uid=row['uid'], gid=row['gid'])
    return result


def source_snapshot(root, budget, guards=None, context=None, *, member_policy=None, reuse=None):
    source_member_policy(root, context, member_policy)
    source_phase('repositories')
    external = context is not None and context.get('external') is True
    owner = source_io_call('root-stat', root, root.stat).st_uid
    require(owner in (0, os.geteuid()) if external else owner == os.geteuid(), 'source-owner')
    policy = dict(context) if external else {**source_repositories(root, budget), **(context or {})}
    with source_nearby_literals(root,policy,budget) as literals:
        policy['_nearby_literals']=literals
        return source_snapshot_inventory(root,budget,guards,policy,external,member_policy=member_policy,reuse=reuse)


def source_stat_key(row):
    # size, mtime_ns, st_dev, st_ino, mode, nlink, then ctime_ns.
    return tuple(row['stamp']) + (row['ctimeNs'],)


def source_snapshot_inventory(root, budget, guards, policy, external, *, member_policy=None, reuse=None):
    global SOURCE_JOIN_FAILURE
    from concurrent.futures import ThreadPoolExecutor, wait, FIRST_COMPLETED

    if policy.get('mac'):
        policy['_directories'] = {}
        local_before = source_local(root.stat(), policy)
    root_before = stamp(root.stat())
    linux = not external and not policy.get('mac')
    require(reuse is None or (linux and type(reuse) is dict), 'source-stat-reuse')
    source_phase('inventory')
    rows, total = inventory(root, budget, source_policy=policy, member_policy=member_policy)
    source_phase('hash')
    workers = SOURCE_LINUX_HASH_WORKERS if linux else SOURCE_HASH_WORKERS
    hashes = {};first = None
    pool = ThreadPoolExecutor(max_workers=workers)
    file_rows = [row for row in rows if row['kind'] == 'file']
    files = iter(file_rows)
    sizes = {row['path']: row['stamp'][0] for row in file_rows}
    progress = SOURCE_PROGRESS if SOURCE_PROGRESS is not None else {}
    progress.update(files=len(file_rows), bytes=sum(sizes.values()), hashedFiles=0, hashedBytes=0, reusedFiles=0)
    pending = {}
    def submit():
        while True:
            row = next(files, None)
            if row is None:
                return
            # Stat reuse (Linux only, same filesystem): a file whose full stat
            # tuple -- size, mtime_ns, ctime_ns, inode, device, mode and link
            # count -- equals the one taken when it was last hashed keeps that
            # digest. Any write changes ctime, which userspace cannot set back;
            # a replacement changes the inode. Every other file is rehashed.
            known = reuse.get(row['path']) if reuse is not None else None
            if known is not None and known[0] == source_stat_key(row):
                hashes[row['path']] = known[1]
                progress['reusedFiles'] += 1
                if 'totals' in progress:
                    progress['totals'][2] += 1
                continue
            # ContextVar state is not inherited by executor threads. Each task
            # receives its own copy; exception annotations stay on that exception.
            task = lambda: pool.submit(copy_context().run, source_hash, root, row, budget, policy) if policy.get('mac') else pool.submit(copy_context().run, source_hash, root, row, budget)
            future = source_io_call('reader-submit', root / row['path'], task)
            pending[future] = row['path']
            return
    try:
        for _ in range(workers):
            submit()
        while pending and first is None:
            done, _ = wait(pending, return_when=FIRST_COMPLETED)
            for future in done:
                name = pending.pop(future)
                try:
                    hashes[name] = future.result()
                    progress['hashedFiles'] += 1;progress['hashedBytes'] += sizes[name]
                    if 'totals' in progress:
                        progress['totals'][0] += 1;progress['totals'][1] += sizes[name]
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
            source_io_call('reader-join', None, lambda: pool.shutdown(wait=True, cancel_futures=True))
        except BaseException:
            SOURCE_JOIN_FAILURE = True
            if first is None:
                raise
    if first is not None:
        raise first
    budget.check()
    if not external:
        require(hashes.get('.gclient_entries') == policy['registrySha256'], 'source-repositories-changed')
        require({'src','src/cef','depot_tools'} <= set(policy['gitHeads']), 'source-required-repositories')
        if policy.get('_nearby_literals') is not None:
            require(policy['gitHeads'].get(NEARBY_ROOT)==NEARBY_HEAD, 'source-nearby-binding')
    aggregate = dict(policy['aggregate']) if external else None
    if external:
        # A second namespace read verifies stability, not a second authority budget.
        policy['aggregate'] = {'entries':0,'bytes':0,'metadata':0}
    source_phase('post-inventory')
    after, after_total = source_io_call('post-inventory', root, lambda: inventory(root, budget, source_policy=policy, member_policy=member_policy))

    require(rows == after and total == after_total and stamp(root.stat()) == root_before, 'source-tree-changed')
    if policy.get('mac'):
        require(source_local(root.stat(), policy) == local_before, 'source-mac-root-changed')
    if guards is not None:
        guards.update({row['path']: (row['stamp'],row['ctimeNs']) for row in rows})
        guards[''] = (root_before,root.stat().st_ctime_ns)
    entries = [source_portable(row, hashes.get(row['path']), policy) if policy.get('mac') else source_portable(row, hashes.get(row['path'])) for row in rows]
    if not external and not policy.get('mac'):
        # Linux directory iteration order is not stable across fresh checkouts
        # (ext4 creation order, parallel git checkout), so the Linux snapshot
        # is canonical in path order; Mac snapshots keep their reviewed order.
        entries.sort(key=lambda entry: entry['path'])
    value = {'entries': entries,
             'rootMtimeNs': str(root_before[1]), 'gitHeads': dict(sorted(policy.get('gitHeads', {}).items())),
             'bytes': total}
    if not external and not policy.get('mac'):
        value['literalLinks'] = policy['_nearby_literals']['portable'] if policy['_nearby_literals'] is not None else []
    if external:
        value['root'] = {'mode':root_before[4], 'mtimeNs':str(root_before[1]), 'uid':root.stat().st_uid,
                         'gid':root.stat().st_gid, 'nlink':root_before[5]}
        value['localRoot'] = {'dev':str(root_before[2]), 'ino':str(root_before[3]),
                              'ctimeNs':str(local_before[1]), 'birthtimeNsAvailable':local_before[2] is not None,
                              'birthtimeNs':str(local_before[2]) if local_before[2] is not None else None}
        # The caller's shared object was consumed only by the initial inventory.
        require(aggregate['entries'] >= len(rows), 'source-external-aggregate')
    return value


def source_metadata_identity(identity, platform_policy=None):
    fields = {'target','source','producer','canonicalRoot','image','tools','graph','siso'}
    require(isinstance(identity, dict) and set(identity) == fields and
            identity['target'] == ('aarch64-apple-darwin' if platform_policy == 'mac-arm' else 'x86_64-apple-darwin' if platform_policy == 'mac-intel' else 'aarch64-unknown-linux-gnu'), 'source-identity')
    require(all(isinstance(identity[k], str) and re.fullmatch(r'[a-f0-9]{64}', identity[k])
                for k in ('source','producer','tools','graph','siso')), 'source-identity')
    require(isinstance(identity['image'], str) and re.fullmatch(r'[0-9]{8}\.[0-9]+\.[0-9]+', identity['image']), 'source-image')
    require(isinstance(identity['canonicalRoot'], str), 'source-root')
    if platform_policy == 'mac-arm':
        require(identity['canonicalRoot'] == '/Users/runner/work/_temp/sorng-cef-engineering/aarch64-apple-darwin/' + identity['source'],
                'source-root')
    if platform_policy == 'mac-intel':
        require(identity['source'] == MAC_INTEL_SOURCE and identity['canonicalRoot'] ==
                '/Users/runner/work/_temp/sorng-cef-engineering/x86_64-apple-darwin/' + MAC_INTEL_SOURCE, 'source-root')
    return safe(Path(identity['canonicalRoot']))


def source_metadata(mode, root, sidecar, identity, seconds=600, budget=None, platform_policy=None):
    with source_io_scope(mode):
        return source_io_call('unlocated', None, lambda: source_metadata_owned(mode, root, sidecar, identity,
                              seconds, budget=budget, platform_policy=platform_policy))


# Local-only stat cache for Linux owned-source metadata, written by record and
# apply and read by a later verify in the same workspace. It lives in the
# owned diagnostic root (never inventoried, never archived) and is bound to
# the sidecar bytes and identity; anything unexpected discards it, which only
# means a full rehash.
SOURCE_STAT_CACHE_NAME = '.sorng-source-stat-cache.json'
SOURCE_STAT_CACHE_KIND = 'sorng-linuxarm-source-stat-cache'
SOURCE_STAT_CACHE_MAX = 1024**3


def source_file_sha256(path, budget):
    digest = hashlib.sha256()
    with open(path, 'rb') as stream:
        while True:
            budget.check()
            chunk = stream.read(1 << 20)
            if not chunk:
                return digest.hexdigest()
            digest.update(chunk)


def source_stat_cache_write(root, sidecar_sha, identity, entries, guards):
    logs = root / 'acquisition-logs'
    try:
        info = logs.lstat()
    except FileNotFoundError:
        return False
    require(stat.S_ISDIR(info.st_mode) and info.st_uid == os.geteuid(), 'source-diagnostic-root')
    rows = [[entry['path'], *guards[entry['path']][0], guards[entry['path']][1]] for entry in entries if entry['kind'] == 'file']
    data = json.dumps({'schemaVersion':1, 'kind':SOURCE_STAT_CACHE_KIND, 'sidecarSha256':sidecar_sha,
                       'identity':identity, 'entries':rows}, separators=(',',':')).encode()
    target, temp = logs / SOURCE_STAT_CACHE_NAME, logs / (SOURCE_STAT_CACHE_NAME + '.partial')
    for old in (temp,):
        try:
            require(stat.S_ISREG(old.lstat().st_mode), 'source-diagnostic-root');old.unlink()
        except FileNotFoundError:
            pass
    fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, 'O_NOFOLLOW', 0), 0o600)
    with os.fdopen(fd, 'wb') as stream:
        stream.write(data);stream.flush();os.fsync(stream.fileno())
    os.replace(temp, target)
    return True


def source_stat_cache_reuse(root, sidecar, identity, entries, budget):
    path = root / 'acquisition-logs' / SOURCE_STAT_CACHE_NAME
    try:
        info = path.lstat()
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.geteuid() or info.st_size > SOURCE_STAT_CACHE_MAX:
            return None
        value = json.loads(path.read_bytes())
        if (type(value) is not dict or set(value) != {'schemaVersion','kind','sidecarSha256','identity','entries'} or
                value['schemaVersion'] != 1 or value['kind'] != SOURCE_STAT_CACHE_KIND or value['identity'] != identity or
                value['sidecarSha256'] != source_file_sha256(sidecar, budget) or type(value['entries']) is not list):
            return None
        digests = {entry['path']: entry['sha256'] for entry in entries if entry['kind'] == 'file'}
        reuse = {}
        for row in value['entries']:
            if (type(row) is not list or len(row) != 8 or not isinstance(row[0], str) or
                    not all(type(x) is int for x in row[1:]) or row[0] not in digests):
                return None
            reuse[row[0]] = (tuple(row[1:]), digests[row[0]])
        return reuse
    except FileNotFoundError:
        return None
    except (OSError, ValueError, KeyError, TypeError):
        return None


def source_metadata_owned(mode, root, sidecar, identity, seconds=600, budget=None, platform_policy=None):
    import sys
    global SOURCE_CLOSE_FAILURE, SOURCE_JOIN_FAILURE, SOURCE_PATH_MODE
    SOURCE_CLOSE_FAILURE = SOURCE_JOIN_FAILURE = False
    require(mode in ('source-record','source-verify','source-apply'), 'source-mode')
    SOURCE_PATH_MODE = mode
    require(platform_policy in (None, 'mac-arm', 'mac-intel'), 'source-platform-policy')
    if platform_policy == 'mac-intel':
        # Explicit unadmitted policy: fail before platform, identity or filesystem reads.
        require(MAC_INTEL_SOURCE_WRITE_ADMITTED, 'source-mac-intel-darwin-capability-unreviewed')
    require(sys.platform == ('darwin' if platform_policy in ('mac-arm','mac-intel') else 'linux'),
            'source-mac-only' if platform_policy == 'mac-arm' else 'source-linux-only')
    budget = Budget(seconds, SOURCE_LINUX_SECONDS if platform_policy is None else 600) if budget is None else budget
    source_progress_start(getattr(budget, 'seconds', seconds))
    if platform_policy == 'mac-arm':
        # No JSON, external context or fixture output can authorize timestamp writes.
        require(MAC_SOURCE_WRITE_ADMITTED, 'source-mac-darwin-capability-unreviewed')
    intel = platform_policy == 'mac-intel'
    sidecar_kind = 'sorng-macintel-source-metadata' if intel else 'sorng-linuxarm-source-metadata'
    sidecar_policy = MAC_INTEL_SOURCE_METADATA_POLICY if intel else SOURCE_METADATA_POLICY
    snapshot_context = {'mac':True} if intel else None
    work = source_metadata_identity(identity, platform_policy)
    budget.check()
    root = safe(root);sidecar = Path(sidecar)
    require(root == work / 'source' and sidecar == root / ('src/out/Release_GN_x64' if intel else 'src/out/Release_GN_arm64') / SOURCE_METADATA_NAME,
            'source-fixed-paths')
    require(root.is_dir() and safe(sidecar.parent).is_dir(), 'source-fixed-paths')
    SOURCE_IO_CONTEXT.set((mode, root))
    guards = {}
    linux = platform_policy is None
    def finish(result):
        source_phase('done')
        if linux:
            result['timing'] = {'phases':[list(item) for item in SOURCE_PROGRESS['phases']],
                                'hashedFiles':SOURCE_PROGRESS['totals'][0], 'hashedBytes':SOURCE_PROGRESS['totals'][1],
                                'reusedFiles':SOURCE_PROGRESS['totals'][2]}
        return result
    if mode == 'source-record':
        with source_nearby_literals(root,source_repositories(root,budget),budget) as record_literals:
            current = source_snapshot(root, budget, guards, context=snapshot_context) if intel else source_snapshot(root, budget, guards)
            value = {'schemaVersion': 1, 'kind': sidecar_kind,
                     'policy': sidecar_policy, 'sourceDateEpoch':SOURCE_METADATA_DATE_EPOCH, 'identity': identity, 'snapshot': current}
            source_phase('sidecar-write')
            written = metadata(sidecar.parent, sidecar.name, value, source=True, owned_sidecar=True)
            source_phase('sidecar-readback')
            require(source_io_call('sidecar-readback', sidecar, lambda: source_read_sidecar(sidecar, budget, owned_sidecar=True)) == value, 'source-sidecar-readback')
            source_phase('record-literals')
            with source_nearby_literals(root,source_repositories(root,budget),budget) as literals:
                require(intel or (literals['portable'] if literals is not None else [])==current['literalLinks'], 'source-nearby-binding')
            if linux:
                source_phase('stat-cache-write')
                source_stat_cache_write(root, written['sha256'], identity, current['entries'], guards)
            return finish({'complete': True, 'mode': mode, 'entries': len(current['entries']),
                           'bytes': current['bytes'], 'sidecar': written})
    source_phase('sidecar-read')
    stored = source_read_sidecar(sidecar, budget, owned_sidecar=True)
    require(isinstance(stored, dict) and set(stored) == {'schemaVersion','kind','policy','sourceDateEpoch','identity','snapshot'} and
            type(stored['schemaVersion']) is int and stored['schemaVersion'] == 1 and stored['kind'] == sidecar_kind and
            stored['policy'] == sidecar_policy and stored['sourceDateEpoch'] == SOURCE_METADATA_DATE_EPOCH and stored['identity'] == identity,
            'source-sidecar-binding')
    expected = stored['snapshot']
    require(isinstance(expected, dict) and set(expected) == ({'entries','rootMtimeNs','gitHeads','bytes'} if intel else {'entries','rootMtimeNs','gitHeads','bytes','literalLinks'}) and
            isinstance(expected['entries'], list) and len(expected['entries']) <= SOURCE_MAX_ENTRIES,
            'source-sidecar-shape')
    reuse = None
    if linux and mode == 'source-verify':
        # Verify after a compile in the same workspace: reuse digests only for
        # files whose full stat tuple is unchanged since record/apply hashed them.
        source_phase('stat-cache-read')
        reuse = source_stat_cache_reuse(root, sidecar, identity, expected['entries'], budget)
    current = source_snapshot(root, budget, guards, context=snapshot_context) if intel else source_snapshot(root, budget, guards, reuse=reuse)
    source_phase('compare')
    require(expected['gitHeads'] == current['gitHeads'] and type(expected['bytes']) is int and expected['bytes'] == current['bytes'],
            'source-repository-or-total-changed')
    require(intel or expected['literalLinks'] == current['literalLinks'], 'source-nearby-binding')
    # Compare the entire freshly hashed namespace before the first metadata write.
    without_time = lambda rows: [{k:v for k,v in row.items() if k != 'mtimeNs'} for row in rows]
    if (json.dumps(without_time(expected['entries']),sort_keys=True,separators=(',',':')) !=
            json.dumps(without_time(current['entries']),sort_keys=True,separators=(',',':'))):
        raise source_content_error(without_time(expected['entries']), without_time(current['entries']))
    for row in expected['entries']:
        require(isinstance(row['mtimeNs'], str) and re.fullmatch(r'0|[1-9][0-9]{0,18}', row['mtimeNs']) and
                int(row['mtimeNs']) < 2**63, 'source-mtime')
    require(isinstance(expected['rootMtimeNs'], str) and re.fullmatch(r'0|[1-9][0-9]{0,18}', expected['rootMtimeNs']) and
            int(expected['rootMtimeNs']) < 2**63, 'source-mtime')
    digests = {entry['path']: entry['sha256'] for entry in current['entries'] if entry['kind'] == 'file'}
    # Postcheck reuse: verify writes nothing, so its second pass expects the
    # first pass's own stat tuples; apply records each file's tuple right after
    # its utime (utime cannot change content, and size/inode are checked).
    post = {name: source_stat_key({'stamp':value[0], 'ctimeNs':value[1]}) for name, value in guards.items()
            if name in digests} if linux else None
    if mode == 'source-apply':
        source_phase('apply-literals')
        # Revalidate the fixed absence witnesses immediately before any utime.
        with source_nearby_literals(root,source_repositories(root,budget),budget) as literals:
            require(intel or (literals['portable'] if literals is not None else []) == expected['literalLinks'], 'source-nearby-binding')
        source_phase('apply-utime')
        for row in sorted(expected['entries'], key=lambda r:r['path'].count('/'), reverse=True):
            budget.check();path = root / (row['path'] if source_literal_member(row['path']) else relative(row['path']));before = source_io_call('apply-stat', path, path.lstat)
            require(stamp(root.stat())[2:4] == guards[''][0][2:4], 'source-root-changed')
            require((stamp(before),before.st_ctime_ns) == guards[row['path']], 'source-write-identity')
            if row['kind'] == 'symlink':
                require(stat.S_ISLNK(before.st_mode) and os.readlink(path) == row['target'], 'source-link-changed')
                source_io_call('apply-utime', path, lambda: os.utime(path, ns=(before.st_atime_ns,int(row['mtimeNs'])), follow_symlinks=False))
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
                    source_io_call('apply-utime', path, lambda: os.utime(fd, ns=(info.st_atime_ns,int(row['mtimeNs']))))
                    after = path.lstat();held = os.fstat(fd)
                    require((before.st_dev,before.st_ino,before.st_mode,before.st_size)==
                            (after.st_dev,after.st_ino,after.st_mode,after.st_size) and
                            stamp(after)==stamp(held) and held.st_mtime_ns==int(row['mtimeNs']), 'source-mtime-readback')
                    if post is not None and row['kind'] == 'file':
                        post[row['path']] = tuple(stamp(after)) + (after.st_ctime_ns,)
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
            source_io_call('apply-utime', root, lambda: os.utime(fd, ns=(info.st_atime_ns,int(expected['rootMtimeNs']))))
            require(root.stat().st_mtime_ns==int(expected['rootMtimeNs']) and
                    stamp(root.stat())==stamp(os.fstat(fd)), 'source-root-readback')
        except BaseException as error:
            primary=error
            raise
        finally:
            source_close(lambda: os.close(fd), primary)
    source_phase('postcheck')
    if intel:
        require(source_snapshot(root, budget, context=snapshot_context) == expected, 'source-metadata-postcheck')
    else:
        final_guards = {}
        final = source_snapshot(root, budget, final_guards,
                                reuse={name: (key, digests[name]) for name, key in post.items()})
        require(final == expected, 'source-metadata-postcheck')
        if mode == 'source-apply':
            source_phase('stat-cache-write')
            source_stat_cache_write(root, source_file_sha256(sidecar, budget), identity, final['entries'], final_guards)
    return finish({'complete': True, 'mode': mode, 'entries': len(expected['entries']), 'bytes': expected['bytes']})


def source_read_sidecar(path, budget, owned_sidecar=False):
    maximum = source_metadata_limit(owned_sidecar)
    require(not owned_sidecar or Path(path).name == SOURCE_METADATA_NAME, 'source-sidecar-role')
    return source_json(source_read_bytes(path, budget, maximum))


def mac_external_context(file, output, mode, budget):
    import sys
    require(sys.platform == 'darwin', 'source-mac-only')
    prefix = '/Users/runner/work/_temp/'
    text = str(file)
    require(re.fullmatch(re.escape(prefix) + r'cef-mac-inputs-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}/context\.json', text),
            'source-mac-context-path')
    context = source_json(source_read_bytes(file, budget, 16384))
    intel = type(context) is dict and context.get('kind') == 'sorng-macintel-external-input-context'
    fields = {'schemaVersion','kind','target','roots','runnerTemp','outputRoot','requiredPins','limits','originalMetalFingerprint','historicalMetalResourceClosureVerified'}
    require(type(context) is dict and set(context) == (fields | {'source'} if intel else fields),
            'source-mac-context')
    require(type(context['schemaVersion']) is int and context['schemaVersion'] == 1 and
            ((context['kind'] == 'sorng-macarm-external-input-context' and context['target'] == 'aarch64-apple-darwin') if not intel else
             (context['target'] == 'x86_64-apple-darwin' and context['source'] == MAC_INTEL_SOURCE)) and
            context['runnerTemp'] == prefix[:-1] and context['outputRoot'] == str(file.parent) and
            context['historicalMetalResourceClosureVerified'] is False, 'source-mac-context')
    expected_limits = {'entries':1000000,'fileBytes':8*1024**3,'bytes':256*1024**3,'metadataBytes':128*1024**2,'readers':4,'seconds':600,'capabilitySeconds':5}
    require(context['limits'] == expected_limits and all(type(v) is int for v in context['limits'].values()), 'source-mac-limits')
    roots = context['roots'];developer = '/Applications/Xcode_26.3.app/Contents/Developer'
    require(type(roots) is dict and set(roots) == {'sdk','toolchain','metal','python'} and
            roots['sdk'] == developer + '/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk' and
            roots['toolchain'] == developer + '/Toolchains/XcodeDefault.xctoolchain' and
            roots['python'] == '/usr/local/Cellar/python@3.14/3.14.7/Frameworks/Python.framework' and
            (roots['metal'] == roots['toolchain'] or re.fullmatch(r'/Users/runner/Library/Developer/DVTDownloads/MetalToolchain/mounts/[a-f0-9]{40}/Metal\.xctoolchain', roots['metal']) is not None),
            'source-mac-roots')
    names = {('sdk','usr/include/'+n+'.modulemap') for n in ('DarwinFoundation1','DarwinFoundation2','DarwinFoundation3','libunwind')}
    names |= {('sdk','SDKSettings.json'),('sdk','usr/lib/libSystem.B.tbd'),('toolchain','usr/bin/clang'),('python','Versions/3.14/bin/python3.14'),('metal','usr/bin/metal'),('metal','usr/bin/air-lld')}
    pins = context['requiredPins'];require(type(pins) is list and len(pins) == 10, 'source-mac-pins')
    actual = set()
    for pin in pins:
        require(type(pin) is dict and set(pin) == {'role','path','size','sha256'} and
                (pin['role'],pin['path']) in names and type(pin['size']) is int and 0 < pin['size'] <= SOURCE_MAX_FILE and
                type(pin['sha256']) is str and re.fullmatch('[a-f0-9]{64}',pin['sha256']), 'source-mac-pins')
        actual.add((pin['role'],pin['path']))
    require(actual == names, 'source-mac-pins')
    folder = safe(file.parent);info = folder.stat()
    require(info.st_uid == os.geteuid() and stat.S_ISDIR(info.st_mode), 'source-mac-output-owner')
    leaf = 'external.json' if mode == 'mac-external-observe' else 'capability.json'
    require(output == folder / leaf and not os.path.lexists(output), 'source-mac-output')
    return context


def mac_external_links(roots, snapshots, budget):
    by_role = {role:{row['path']:row for row in value['entries']} for role,value in snapshots.items()}
    root_parts = {role:tuple(p.split('/')[1:]) for role,p in roots.items()}
    observation=None;capture_failed=False
    def observe(**fields):
        nonlocal observation,capture_failed
        try:
            if not capture_failed:
                if observation is None:observation={}
                observation.update(fields)
        except BaseException:
            capture_failed=True
    def parts(raw):
        require(isinstance(raw, str) and 0 < len(raw.encode()) <= 4096 and
                not any(ord(c) < 32 for c in raw), 'source-link')
        values = [part for part in raw.split('/') if part]
        if raw.endswith('/'):
            values.append('.')
        return values
    def locate(role, absolute, ancestors=False):
        candidates = [(r,p) for r,p in root_parts.items() if absolute[:len(p)] == p]
        if candidates:
            length = max(len(p) for _,p in candidates)
            candidates = [(r,p) for r,p in candidates if len(p) == length]
            r,p = next(((r,p) for r,p in candidates if r == role), candidates[0])
            name = '/'.join(absolute[len(p):])
            if not name:
                return r, {'kind':'directory'}
            row = by_role[r].get(name)
            observe(site='declared-role-entry',attemptedRole=r,address=absolute,ancestors=ancestors)
            require(row is not None, 'source-external-input-unattested')
            return r, row
        # These exact canonical ancestors were no-link checked with every root.
        # No files outside the four inventoried domains become input authority.
        observe(site='declared-root-boundary',attemptedRole=None,address=absolute,ancestors=ancestors)
        require(ancestors and any(p[:len(absolute)] == absolute for p in root_parts.values()),
                'source-external-input-unattested')
        return role, {'kind':'directory'}
    def resolve(role, name):
        pending = parts(name);resolved = list(root_parts[role]);kind = 'directory';links = 0
        while pending:
            budget.check();part = pending.pop(0)
            require(kind == 'directory', 'source-external-link-kind')
            if part == '.':
                continue
            if part == '..':
                observe(site='absolute-root-underflow',attemptedRole=None,address=resolved,ancestors=True)
                require(resolved, 'source-external-input-unattested')
                resolved.pop();role,row = locate(role,tuple(resolved),ancestors=True);kind = row['kind']
                continue
            candidate = tuple(resolved + [part]);role,row = locate(role,candidate,ancestors=True)
            if row['kind'] == 'symlink':
                links += 1;require(links <= 64, 'source-external-link-cycle')
                raw = row['target']
                observe(expansions=links,lastTarget=raw,lastRole=role)
                if raw.startswith('/'):
                    resolved = []
                pending = parts(raw) + pending;kind = 'directory'
            else:
                require(row['kind'] in ('file','directory'), 'source-external-link-kind')
                resolved.append(part);kind = row['kind']
        locate(role,tuple(resolved))
        return kind
    for role,value in snapshots.items():
        for row in value['entries']:
            if row['kind'] == 'symlink':
                observation=None;capture_failed=False
                try:
                    resolve(role,row['path'])
                except CheckpointError as error:
                    try:
                        if error.args==('source-external-input-unattested',) and not capture_failed:
                            error.external_link_failure=external_link_diagnostic(roots,role,row,observation)
                    except BaseException:
                        pass  # The original failing require/exception always wins.
                    raise


def mac_external_observe(context, output, budget):
    global MAC_EXTERNAL_ROLE, MAC_EXTERNAL_PHASE, MAC_REPORT_FAILURE
    aggregate = {'entries':0,'bytes':0,'metadata':0};snapshots = {}
    roots = context['roots']
    for role in ('sdk','toolchain','metal','python'):
        MAC_EXTERNAL_ROLE=role;MAC_EXTERNAL_PHASE='snapshot';budget.check()
        root = safe(Path(roots[role]));require(root.is_dir(), 'source-mac-root-kind')
        snapshots[role] = source_snapshot(root,budget,context={'mac':True,'external':True,'aggregate':aggregate},
            member_policy=_MAC_EXTERNAL_SDK_MEMBERS if role == 'sdk' else None)
    MAC_EXTERNAL_PHASE='links';mac_external_links(roots,snapshots,budget)
    for pin in context['requiredPins']:
        MAC_EXTERNAL_ROLE=pin['role'];MAC_EXTERNAL_PHASE='pins';budget.check()
        row = next((r for r in snapshots[pin['role']]['entries'] if r['path']==pin['path']),None)
        require(row is not None and row['kind']=='file' and row['size']==pin['size'] and row['sha256']==pin['sha256'], 'source-mac-required-pin')
    MAC_EXTERNAL_PHASE='readback'
    # Re-read every declared root with the SAME bounded transaction and clock.
    readback_aggregate={'entries':0,'bytes':0,'metadata':0}
    for role in ('sdk','toolchain','metal','python'):
        MAC_EXTERNAL_ROLE=role;budget.check()
        after=source_snapshot(safe(Path(roots[role])),budget,context={'mac':True,'external':True,'aggregate':readback_aggregate},
            member_policy=_MAC_EXTERNAL_SDK_MEMBERS if role == 'sdk' else None)
        require(after==snapshots[role], 'source-external-changed')
    intel = context.get('kind') == 'sorng-macintel-external-input-context'
    value={'schemaVersion':1,'kind':'sorng-macintel-external-input-observation' if intel else 'sorng-macarm-external-input-observation','target':context['target'],
           'policy':'sorng-macintel-readonly-external-inputs-v1' if intel else 'sorng-macarm-readonly-external-inputs-v1','complete':True,'externalSnapshotComplete':True,
           'roles':[{'role':role,'physicalRoot':roots[role],'snapshot':snapshots[role]} for role in ('sdk','toolchain','metal','python')],
           'entries':aggregate['entries'],'bytes':aggregate['bytes'],'runnerUid':os.geteuid(),
           'historicalMetalResourceClosureVerified':False,'sourceWriteAdmitted':False,'nativeAcceptance':False,'runtimeReady':False}
    if intel:value['source']=context['source']
    budget.check();MAC_EXTERNAL_PHASE='report'
    try:
        written=metadata(output.parent,output.name,value,source=True)
        require(source_read_sidecar(output,budget)==value,'source-external-report-readback')
    except BaseException:
        MAC_REPORT_FAILURE=True
        raise
    MAC_EXTERNAL_ROLE=None;MAC_EXTERNAL_PHASE='complete'
    return {'complete':True,'kind':value['kind'],'entries':value['entries'],'bytes':value['bytes'],'snapshot':written,
            'sourceWriteAdmitted':False,'nativeAcceptance':False,'runtimeReady':False}


def mac_capability_stat(info):
    fields={name:str(getattr(info,'st_'+name)) for name in ('dev','ino','mode','nlink','size','uid','gid','atime_ns','mtime_ns','ctime_ns')}
    birth=getattr(info,'st_birthtime_ns',None)
    fields['birthtimeNsAvailable']=type(birth) is int
    fields['birthtimeNs']=str(birth) if type(birth) is int else None
    return fields


def mac_capability_identity(info):
    return (info.st_dev,info.st_ino,info.st_mode,info.st_nlink,info.st_size,info.st_uid,info.st_gid)


def mac_owned_capability_observe(context, output, budget):
    # Exactly four fresh owned objects. Never inventory or change installed data.
    global MAC_REPORT_FAILURE, SOURCE_CLOSE_FAILURE
    SOURCE_CLOSE_FAILURE=False
    budget.check()
    require(budget.end-time.monotonic() <= 5, 'source-mac-capability-deadline')
    root=Path(context['outputRoot'])/'capability-owned';require(not os.path.lexists(root),'source-mac-capability-exists')
    file=root/'file';directory=root/'directory';link=root/'link'
    paths={'file':file,'directory':directory,'root':root,'symlink':link}
    handles={};identities={};owned={};rows=[];primary=None;cleanup=False
    def owner(info):
        # Directory size/nlink and file size can change during our own setup.
        return (info.st_dev,info.st_ino,info.st_mode,info.st_uid,info.st_gid)
    def remember(role, info):
        require(info.st_uid==os.geteuid() and
                (stat.S_ISREG(info.st_mode) and info.st_nlink==1 if role=='file' else
                 stat.S_ISLNK(info.st_mode) if role=='symlink' else stat.S_ISDIR(info.st_mode)),
                'source-mac-capability-identity')
        owned[role]=owner(info)
    try:
        root.mkdir(mode=0o700);remember('root',root.lstat())
        fd=os.open(file,os.O_CREAT|os.O_EXCL|os.O_RDWR|os.O_NOFOLLOW,0o600);handles['file']=fd
        remember('file',os.fstat(fd));require(owner(file.lstat())==owned['file'],'source-mac-capability-identity')
        require(os.write(fd,b'owned-capability-fixture\n')==len(b'owned-capability-fixture\n'),'short-write')
        directory.mkdir(mode=0o700);remember('directory',directory.lstat())
        os.symlink('file',link);remember('symlink',link.lstat());require(os.readlink(link)=='file','source-mac-capability-link')
        handles['directory']=os.open(directory,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
        handles['root']=os.open(root,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
        for role,p in paths.items():
            info=p.lstat();require(owner(info)==owned[role],'source-mac-capability-identity')
            identities[role]=mac_capability_identity(info)
        for role in ('file','directory','root','symlink'):
            p=paths[role]
            for case in ('no-op','past','future'):
                budget.check();before=p.lstat();require(mac_capability_identity(before)==identities[role],'source-mac-capability-identity')
                target=before.st_mtime_ns if case=='no-op' else 1790036443000000000 if case=='past' else time.time_ns()+2000000000
                held_before=os.fstat(handles[role]) if role in handles else None
                if held_before is not None:require(stamp(held_before)==stamp(before),'source-mac-capability-identity')
                if role=='symlink':
                    require(os.readlink(p)=='file','source-mac-capability-link')
                    os.utime(p,ns=(before.st_atime_ns,target),follow_symlinks=False)
                else:os.utime(handles[role],ns=(before.st_atime_ns,target))
                after=p.lstat();held_after=os.fstat(handles[role]) if role in handles else None
                require(mac_capability_identity(after)==identities[role] and
                        (held_after is None or stamp(held_after)==stamp(after)),'source-mac-capability-identity')
                if role=='symlink':require(os.readlink(p)=='file','source-mac-capability-link')
                rows.append({'role':role,'case':case,'requestedMtimeNs':str(target),'before':mac_capability_stat(before),
                             'after':mac_capability_stat(after),'heldBefore':mac_capability_stat(held_before) if held_before is not None else None,
                             'heldAfter':mac_capability_stat(held_after) if held_after is not None else None,
                             'exactMtimeReadback':after.st_mtime_ns==target})
        budget.check()
    except BaseException as error:
        primary=error
    finally:
        try:source_cleanup_all([lambda fd=fd:os.close(fd) for fd in handles.values()],primary)
        except BaseException as error:
            if primary is None:primary=error
        cleanup_errors=[]
        for role in ('symlink','file','directory','root'):
            p=paths[role]
            try:
                if os.path.lexists(p):
                    require('root' in owned and owner(root.lstat())==owned['root'],'source-mac-capability-cleanup')
                    info=p.lstat();require(role in owned and owner(info)==owned[role] and
                        (info.st_nlink==1 if role=='file' else True),'source-mac-capability-cleanup')
                    if role=='symlink':require(os.readlink(p)=='file','source-mac-capability-cleanup')
                    os.rmdir(p) if role in ('directory','root') else os.unlink(p)
                    if role=='root':cleanup=True
            except BaseException as error:
                cleanup_errors.append(error)
        if primary is None and cleanup_errors:primary=cleanup_errors[0]
    intel = context.get('kind') == 'sorng-macintel-external-input-context'
    value={'schemaVersion':1,'kind':'sorng-macintel-owned-capability-observation' if intel else 'sorng-macarm-owned-capability-observation','target':context['target'],
           'complete':primary is None and cleanup and not SOURCE_CLOSE_FAILURE,'rows':rows,
           'cleanupConfirmed':cleanup and not SOURCE_CLOSE_FAILURE,'objectsRemoved':cleanup,
           'handlesClosed':not SOURCE_CLOSE_FAILURE,'sourceWriteAdmitted':False,
           'error':str(primary) if type(primary) is CheckpointError else 'source-mac-capability-io' if primary is not None else None,
           'installedInputsWritten':False,'nativeAcceptance':False,'runtimeReady':False}
    if intel:value['source']=context['source']
    require(len(json.dumps(value).encode())<=65536,'source-mac-capability-output-bound')
    reporting=None;written=None
    try:
        written=metadata(output.parent,output.name,value,source=True)
        require(source_read_sidecar(output,budget)==value,'source-mac-capability-report-readback')
    except BaseException as error:
        MAC_REPORT_FAILURE=True;reporting=error
    if primary is not None:raise primary
    if reporting is not None:raise reporting
    return {'complete':True,'kind':value['kind'],'rows':len(rows),'observation':written,'sourceWriteAdmitted':False,'nativeAcceptance':False,'runtimeReady':False}


def main():
    global CLI_SOURCE_MODE
    CLI_SOURCE_MODE = None
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=['pack', 'restore', 'seal', 'source-record', 'source-verify', 'source-apply', 'mac-external-observe', 'mac-owned-capability-observe'])
    parser.add_argument('--input', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--manifest')
    parser.add_argument('--seconds', type=int, default=600)
    parser.add_argument('--generated-links')
    parser.add_argument('--platform-policy', choices=['mac-arm','mac-intel'])
    args = parser.parse_args()
    CLI_SOURCE_MODE = args.mode if args.mode in SOURCE_IO_MODES else None
    require(args.platform_policy is None or args.mode.startswith('source-'),'source-platform-policy')
    if args.platform_policy == 'mac-intel':
        require(MAC_INTEL_SOURCE_WRITE_ADMITTED, 'source-mac-intel-darwin-capability-unreviewed')
    links = {}
    if args.generated_links:
        data = Path(args.generated_links).read_bytes()
        require(len(data) <= 16384, 'link-recipe-bound')
        links = json.loads(data)
        link_recipe(links)
    if args.mode in ('mac-external-observe','mac-owned-capability-observe'):
        require(args.manifest is None and not links and args.platform_policy is None,'source-mac-context')
        require(args.mode!='mac-owned-capability-observe' or 0 < args.seconds <= 5,'source-mac-capability-deadline')
        budget=Budget(args.seconds);context=mac_external_context(Path(args.input),Path(args.output),args.mode,budget)
        result=(mac_external_observe if args.mode=='mac-external-observe' else mac_owned_capability_observe)(context,Path(args.output),budget)
    elif args.mode.startswith('source-'):
        require(args.manifest is not None and not links, 'source-context-required')
        with source_io_scope(args.mode):
            context_file = source_io_call('context-read', None, lambda: safe(Path(args.manifest)))
            require(source_io_call('context-read', None, context_file.stat).st_size <= 16384, 'source-context-bound')
            source_budget = Budget(args.seconds, SOURCE_LINUX_SECONDS if args.platform_policy is None else 600)
            identity = source_io_call('context-read', None, lambda: source_json(source_read_bytes(context_file, source_budget, 16384)))
        result = source_metadata(args.mode, Path(args.input), Path(args.output), identity, args.seconds, budget=source_budget, platform_policy=args.platform_policy)
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
        print(json.dumps({'complete': False, 'error': str(error) if type(error) is CheckpointError else 'archive-io-error', **({'sourceCloseFailure':True} if SOURCE_CLOSE_FAILURE else {}), **({'sourceJoinFailure':True} if SOURCE_JOIN_FAILURE else {}), **({'externalPhase':MAC_EXTERNAL_PHASE, **({'externalRole':MAC_EXTERNAL_ROLE} if MAC_EXTERNAL_PHASE!='links' else {})} if MAC_EXTERNAL_ROLE is not None else {}), **({'macReportingFailure':True} if MAC_REPORT_FAILURE else {}), **source_failure_fields(error), **source_io_failure_fields(error, CLI_SOURCE_MODE), **source_bound_failure_fields(error, CLI_SOURCE_MODE), **source_file_failure_fields(error, CLI_SOURCE_MODE), **source_deadline_failure_fields(error, CLI_SOURCE_MODE), **source_content_failure_fields(error, CLI_SOURCE_MODE), **external_member_fields(error), **external_link_fields(error)}))

        raise SystemExit(1)
