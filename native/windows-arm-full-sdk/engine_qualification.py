"""Inert Windows ARM compiler-input prerequisite policy, not execution authority.

Plans and parsers below inspect candidate observations. They create no process,
write no inputs and grant no compiled checkpoint, SDK or native acceptance.
The existing Job supervisor/command admission remains unchanged and closed.
"""
import copy
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import struct

PROFILE_SHA256 = '07a845794b95f11991706813fc3c97bc9a92d9479f8ce30724cb2dbf18b6a34c'
EXECUTION_ADMITTED = False
MAX_FILE = 8 * 1024 * 1024
PA_GUARD = 'BASE_ALLOCATOR_PARTITION_ALLOCATOR_SRC_PARTITION_ALLOC_BUILDFLAGS_H_'
HEX = re.compile(r'[a-f0-9]{64}')


class QualificationError(ValueError):
    pass


def need(value, code):
    if not value:
        raise QualificationError(code)


def shape(value, keys, code):
    need(type(value) is dict and set(value) == set(keys), code)


def integer(value, low, high, code):
    need(type(value) is int and low <= value <= high, code)


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def load_profile():
    """Bounded held read of the one code-pinned repository policy file."""
    file = Path(__file__).absolute().with_name('engine-qualification-profile.json')
    for item in (file, *file.parents):
        info = item.lstat()
        need(not stat.S_ISLNK(info.st_mode) and not getattr(info, 'st_file_attributes', 0) & 0x400,
             'QUAL_PROFILE_ALIAS')
    stamp = lambda info: (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns,
                          info.st_ctime_ns, info.st_mode, info.st_nlink,
                          getattr(info, 'st_birthtime_ns', None))
    # Match acquire.held: Windows path and FD ctime views can differ, while
    # each complete path/FD signature must remain unchanged in its own view.
    shared = lambda info: (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns,
                           info.st_nlink, getattr(info, 'st_birthtime_ns', None))
    before = file.lstat()
    need(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and 0 < before.st_size <= 65536,
         'QUAL_PROFILE_BOUND')
    with file.open('rb') as stream:
        fd_before = os.fstat(stream.fileno())
        need(shared(fd_before) == shared(before), 'QUAL_PROFILE_CHANGED')
        raw = stream.read(65537)
        fd_after, after = os.fstat(stream.fileno()), file.lstat()
        need(stamp(fd_after) == stamp(fd_before) and stamp(after) == stamp(before) and
             shared(fd_after) == shared(after),
             'QUAL_PROFILE_CHANGED')
    need(len(raw) == before.st_size and digest(raw) == PROFILE_SHA256, 'QUAL_PROFILE_PIN')
    value = json.loads(raw)
    need(value['executionAdmitted'] is False and EXECUTION_ADMITTED is False, 'QUAL_PROFILE_CLOSED')
    return value


def relative(value):
    need(type(value) is str and 0 < len(value) <= 1024 and '\\' not in value and
         '\x00' not in value and not value.startswith('/') and
         str(PurePosixPath(value)) == value and
         all(re.fullmatch(r'[A-Za-z0-9._-]+', part) and part not in ('.', '..') and
             not part.endswith('.') and not re.fullmatch(r'(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?', part, re.I)
             for part in value.split('/')),
         'QUAL_RELATIVE_PATH')
    return value


def operation_root(value):
    # Format only; this does not prove live ownership of a hosted workspace.
    need(type(value) is str and re.fullmatch(
        r'[A-Z]:/a/sortOfRemoteNG/sortOfRemoteNG/\.artifacts/windows-arm-full-sdk-'
        r'[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}', value),
        'QUAL_ROOT')
    return value


def file_pin(value, expected_path, expected_hash=None, expected_bytes=None):
    shape(value, ('path', 'bytes', 'sha256'), 'QUAL_FILE_FIELDS')
    need(value['path'] == expected_path, 'QUAL_FILE_PATH')
    integer(value['bytes'], 1, 256 * 1024**2, 'QUAL_FILE_BOUND')
    need(type(value['sha256']) is str and HEX.fullmatch(value['sha256']), 'QUAL_FILE_HASH')
    if expected_hash is not None:
        need(value['sha256'] == expected_hash, 'QUAL_TOOL_PIN')
    if expected_bytes is not None:
        need(value['bytes'] == expected_bytes, 'QUAL_TOOL_SIZE')


def validate_request(value):
    """Validate a non-authorizing plan request; caller JSON is never a capability."""
    policy = load_profile()
    shape(value, ('kind', 'mode', 'ref', 'repository', 'repositoryId', 'visibility',
                  'event', 'host', 'image', 'root', 'source', 'bindings', 'remainingMs'),
          'QUAL_REQUEST_FIELDS')
    need(value['kind'] == 'windows-arm-compiler-input-request' and
         all(value[key] == policy[key] for key in ('mode', 'ref', 'repository', 'repositoryId')) and
         value['visibility'] == 'public' and value['event'] == 'workflow_dispatch', 'QUAL_AUTHORITY_SCOPE')
    need(type(value['host']) is dict and value['host'] == policy['host'] and type(value['image']) is str and
         value['image'] in policy['images'], 'QUAL_HOST_IMAGE')
    selected = policy['images'][value['image']]
    root = operation_root(value['root'])
    need(type(value['source']) is dict and value['source'] == {'target': policy['target'], 'sourceId': selected['sourceId'],
         'profileSha256': selected['profileSha256'], 'chromium': policy['chromium'], 'cef': policy['cef']},
         'QUAL_SOURCE_SCOPE')
    bindings = value['bindings']
    shape(bindings, ('args', 'graph', 'graphInventory', 'tools'), 'QUAL_BINDING_FIELDS')
    out = root + '/source-checkout/src/out/Release_GN_arm64'
    file_pin(bindings['args'], out + '/args.gn')
    file_pin(bindings['graph'], out + '/build.ninja')
    inventory = bindings['graphInventory']
    shape(inventory, ('files', 'bytes', 'visited', 'sha256'), 'QUAL_GRAPH_FIELDS')
    integer(inventory['files'], 1, 50000, 'QUAL_GRAPH_BOUND')
    integer(inventory['visited'], inventory['files'], 300000, 'QUAL_GRAPH_BOUND')
    integer(inventory['bytes'], 1, 8 * 1024**3, 'QUAL_GRAPH_BOUND')
    need(type(inventory['sha256']) is str and HEX.fullmatch(inventory['sha256']), 'QUAL_GRAPH_HASH')
    shape(bindings['tools'], policy['tools'], 'QUAL_TOOL_FIELDS')
    for role, expected in policy['tools'].items():
        file_pin(bindings['tools'][role], expected.get('path') or root + '/' + relative(expected['relativePath']),
                 expected['sha256'], expected['bytes'])
    integer(value['remainingMs'], 1, policy['jobContract']['wholeSeconds'] * 1000, 'QUAL_WORK_CLOCK')
    return policy


def build_plan(value):
    policy = validate_request(value)
    reserve = 1000 * (policy['jobContract']['cleanupSeconds'] + policy['jobContract']['finalReserveSeconds'])
    need(value['remainingMs'] > reserve, 'QUAL_WORK_RESERVE')
    work = min(policy['jobContract']['compileSeconds'] * 1000, value['remainingMs'] - reserve)
    out = value['root'] + '/source-checkout/src/out/Release_GN_arm64'
    return {'kind': 'windows-arm-compiler-input-plan', 'target': policy['target'],
            'source': copy.deepcopy(value['source']), 'image': value['image'],
            'inputBindings': copy.deepcopy(value['bindings']),
            'generatedTargets': [{'label': row['label'], 'expectedOutput': out + '/' + row['relativeOutput']}
                                 for row in policy['generatedInputs']],
            'maximumWorkMs': work, 'cleanupMs': policy['jobContract']['cleanupSeconds'] * 1000,
            'finalReserveMs': policy['jobContract']['finalReserveSeconds'] * 1000,
            'supervisorRequired': copy.deepcopy(policy['jobContract']),
            'missingExecutionFacts': list(policy['missingExecutionFacts']),
            'executionAdmitted': False, 'compilerExecuted': False, 'engineCompilationRequested': False,
            'sdkBuilt': False, 'nativeAcceptance': False, 'runtimeReady': False}


def bind_readback(request, actual):
    validate_request(request)
    need(type(actual) is dict and actual == request['bindings'], 'QUAL_INPUT_CHANGED')
    # Equality validates a candidate projection, not a live FD or ownership receipt.
    return {'kind': 'windows-arm-candidate-binding-comparison', 'same': True, 'executionAdmitted': False}


def inspect_args(raw):
    need(type(raw) is bytes and 0 < len(raw) <= 1024**2 and b'\0' not in raw, 'QUAL_ARGS_BOUND')
    try:
        text = raw.decode('utf8')
    except UnicodeError:
        raise QualificationError('QUAL_ARGS_ENCODING') from None
    expected = {'target_cpu':'"arm64"', 'host_cpu':'"x64"', 'is_clang':'true', 'use_lld':'true',
                'use_remoteexec':'false', 'use_siso':'true', 'is_component_build':'false',
                'is_debug':'false', 'enable_backup_ref_ptr_instance_tracer':'false'}
    seen = set()
    for line in text.splitlines():
        if not line.strip() or line.lstrip().startswith('#'):
            continue
        # Deliberately a closed literal subset, never a GN interpreter. Reject
        # control flow/imports/+=/expressions/interpolation rather than ignoring
        # a later override. Real evaluated GN metadata is still a missing fact.
        match = re.fullmatch(
            r'\s*([a-z][a-z0-9_]*)\s*=\s*'
            r'(true|false|-?(?:0|[1-9][0-9]{0,9})|"(?:[^"\\$\x00-\x1f]|\\["\\])*")'
            r'\s*(?:#.*)?', line)
        need(match is not None, 'QUAL_ARGS_SYNTAX')
        name, value = match.groups()
        need(name not in seen and name not in ('if','else','foreach','true','false','import','template'),
             'QUAL_ARGS_DUPLICATE_OR_KEYWORD')
        seen.add(name)
        if name in expected:
            need(value == expected[name], 'QUAL_ARGS_CRITICAL')
        if 'sandbox' in name:
            need(value == 'true', 'QUAL_ARGS_SANDBOX')
    need(set(expected).issubset(seen), 'QUAL_ARGS_CRITICAL')
    return {'kind':'windows-arm-candidate-args', 'bytes':len(raw), 'sha256':digest(raw),
            'criticalLiteralDeclarationsVerified':True, 'evaluatedGnVerified':False,
            'generatedSecurityHeadersVerified':False,
            'executionAdmitted':False}


def inspect_generated_inputs(request, candidates):
    policy = validate_request(request)
    shape(candidates, ('partitionAlloc', 'cefConfig', 'args'), 'QUAL_GENERATED_FIELDS')
    out = request['root'] + '/source-checkout/src/out/Release_GN_arm64'
    expected = {row['role']:out + '/' + row['relativeOutput'] for row in policy['generatedInputs']}
    expected['args'] = out + '/args.gn'
    readers = {'partitionAlloc':inspect_partition_alloc_header,
               'cefConfig':inspect_cef_config_header, 'args':inspect_args}
    result = {}
    for role, path in expected.items():
        candidate = candidates[role]
        shape(candidate, ('pin', 'raw'), 'QUAL_GENERATED_CANDIDATE')
        file_pin(candidate['pin'], path)
        need(type(candidate['raw']) is bytes and len(candidate['raw']) == candidate['pin']['bytes'] and
             digest(candidate['raw']) == candidate['pin']['sha256'], 'QUAL_GENERATED_PIN')
        if role == 'args':
            need(candidate['pin'] == request['bindings']['args'], 'QUAL_ARGS_CHANGED')
        result[role] = readers[role](candidate['raw'])
    return {'kind':'windows-arm-candidate-generated-inputs', 'source':copy.deepcopy(request['source']),
            'image':request['image'], 'files':result, 'generatedSecurityHeadersVerified':False,
            'fullArm64DefaultsQualified':False, 'executionAdmitted':False}


def header_text(raw):
    need(type(raw) is bytes and 0 < len(raw) <= 65536 and b'\0' not in raw and b'\\' not in raw,
         'QUAL_HEADER_BOUND')
    try:
        text = raw.decode('ascii').replace('\r\n', '\n')
    except UnicodeError:
        raise QualificationError('QUAL_HEADER_ENCODING') from None
    need('\r' not in text, 'QUAL_HEADER_ENCODING')
    # The pinned generators emit comments and flat directives only.
    text = re.sub(r'/\*[^*]*\*+(?:[^/*][^*]*\*+)*/', '', text)
    text = re.sub(r'//[^\n]*', '', text)
    need('/*' not in text and '*/' not in text, 'QUAL_HEADER_COMMENT')
    return [line.strip() for line in text.splitlines() if line.strip()]


def inspect_partition_alloc_header(raw):
    policy = load_profile()
    lines = header_text(raw)
    # Comments (including the closing guard label) have been removed above.
    need(lines[:3] == ['#ifndef ' + PA_GUARD, '#define ' + PA_GUARD,
                       '#include "partition_alloc/buildflag.h"'] and lines[-1:] == ['#endif'], 'QUAL_PA_HEADER')
    macros = {}
    for line in lines[3:-1]:
        match = re.fullmatch(r'#define PA_BUILDFLAG_INTERNAL_([A-Z][A-Z0-9_]*)\(\) \((0|[1-9][0-9]{0,9})\)', line)
        need(match is not None and match[1] not in macros, 'QUAL_PA_MACRO')
        number = int(match[2])
        integer(number, 0, 2**31 - 1 if match[1] == 'USER_SPACE_ZERO_SEGMENT_SIZE_MB' else 1,
                'QUAL_PA_MACRO_VALUE')
        macros[match[1]] = number
    need(list(macros) == policy['partitionAllocMacros'], 'QUAL_PA_MACRO_SET')
    for name, expected in {**policy['explicitArgumentInvariants'], **policy['securityPolicyMinimums']}.items():
        need(macros[name] == expected, 'QUAL_PA_SECURITY_MINIMUM')
    return {'kind': 'windows-arm-candidate-partition-alloc-header', 'bytes': len(raw),
            'sha256': digest(raw), 'macros': macros, 'policyMinimumsMet': True,
            'fullArm64DefaultsQualified': False, 'executionAdmitted': False}


def inspect_cef_config_header(raw):
    lines = header_text(raw)
    need(lines == ['#ifndef CEF_INCLUDE_CEF_CONFIG_H_', '#define CEF_INCLUDE_CEF_CONFIG_H_',
                   '#define CEF_V8_ENABLE_SANDBOX 1', '#endif'], 'QUAL_CEF_CONFIG')
    return {'kind': 'windows-arm-candidate-cef-config-header', 'bytes': len(raw), 'sha256': digest(raw),
            'v8SandboxDeclared': True, 'executionAdmitted': False}


def inspect_coff(raw):
    need(type(raw) is bytes and 20 <= len(raw) <= MAX_FILE, 'QUAL_COFF_BOUND')
    machine, sections, _, symbols_at, symbols, optional, flags = struct.unpack_from('<HHIIIHH', raw)
    need(machine == 0xAA64 and optional == 0 and 1 <= sections <= 96 and
         not flags & 0x2000 and 20 + sections * 40 <= len(raw), 'QUAL_COFF_HEADER')
    for index in range(sections):
        size, offset = struct.unpack_from('<II', raw, 20 + index * 40 + 16)
        need(size == 0 or offset >= 20 + sections * 40 and offset + size <= len(raw), 'QUAL_COFF_SECTION')
    if symbols_at or symbols:
        integer(symbols, 0, 100000, 'QUAL_COFF_SYMBOLS')
        end = symbols_at + symbols * 18
        need(symbols_at >= 20 + sections * 40 and end + 4 <= len(raw), 'QUAL_COFF_SYMBOLS')
        strings = struct.unpack_from('<I', raw, end)[0]
        need(strings >= 4 and end + strings <= len(raw), 'QUAL_COFF_SYMBOLS')
    return {'kind': 'windows-arm-candidate-coff', 'machine': machine, 'sections': sections,
            'bytes': len(raw), 'sha256': digest(raw), 'structureOnly': True, 'executionAdmitted': False}


def inspect_pe(raw):
    need(type(raw) is bytes and 64 <= len(raw) <= MAX_FILE and raw[:2] == b'MZ', 'QUAL_PE_BOUND')
    offset = struct.unpack_from('<I', raw, 0x3c)[0]
    need(64 <= offset <= len(raw) - 264 and raw[offset:offset + 4] == b'PE\0\0', 'QUAL_PE_OFFSET')
    machine, sections, _, _, _, optional, flags = struct.unpack_from('<HHIIIHH', raw, offset + 4)
    need(machine == 0xAA64 and 1 <= sections <= 96 and optional == 240 and
         flags & 2 and not flags & (0x100 | 0x2000), 'QUAL_PE_HEADER')
    header = offset + 24
    need(struct.unpack_from('<H', raw, header)[0] == 0x20b and
         struct.unpack_from('<H', raw, header + 68)[0] == 3 and
         struct.unpack_from('<I', raw, header + 108)[0] == 16, 'QUAL_PE_OPTIONAL')
    # A no-CRT prerequisite probe must not acquire an unreviewed loader closure.
    for directory in (1, 12, 13, 14):
        need(struct.unpack_from('<II', raw, header + 112 + directory * 8) == (0, 0), 'QUAL_PE_IMPORTS')
    table = header + optional
    need(table + sections * 40 <= len(raw), 'QUAL_PE_SECTIONS')
    entry = struct.unpack_from('<I', raw, header + 16)[0]
    executable = 0
    for index in range(sections):
        at = table + index * 40
        virtual_size, address, size, file_at = struct.unpack_from('<IIII', raw, at + 8)
        section_flags = struct.unpack_from('<I', raw, at + 36)[0]
        need(size == 0 or file_at >= table + sections * 40 and file_at + size <= len(raw), 'QUAL_PE_SECTION')
        if size > 0 and address <= entry < address + min(virtual_size, size) and section_flags & 0x20000000:
            executable += 1
    need(entry > 0 and executable == 1, 'QUAL_PE_ENTRY')
    return {'kind': 'windows-arm-candidate-pe', 'machine': machine, 'sections': sections,
            'bytes': len(raw), 'sha256': digest(raw), 'structureOnly': True,
            'outputExecuted': False, 'executionAdmitted': False}


def execute(*_args, **_kwargs):
    # This cannot be promoted by caller JSON, a success report, a plan, or tests.
    raise QualificationError('ENGINE_QUALIFICATION_EXECUTION_CLOSED')
