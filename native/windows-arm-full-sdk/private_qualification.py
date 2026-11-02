"""First, inert private compiler-input policy slice.

All APIs below consume bytes/JSON projections only. A validated projection is
not live source ownership, loader evidence, a Job capability, or permission to
spawn. Neither this module nor a policy/report can enable the private job.
"""
import hashlib
import json
import math
import re

PROFILE_SHA256 = 'e767bc771cbf5d1d197c757bf7761f8a9695f12dd683fcb175668e158890d052'
PRIVATE_QUALIFICATION_ADMITTED = False
MODE = 'private-compiler-input-qualification'
REF = 'refs/heads/codex/windows-arm-engine-qualification-20261101'
WORKFLOW = '.github/workflows/windows-arm-compiler-input-qualification.yml'
REPOSITORY = 'supermarsx/sortOfRemoteNG'
REPOSITORY_ID = '1010282954'
ROLES = ('qual-gn-desc-pa', 'qual-gn-desc-cef', 'qual-gn-args',
         'qual-generate-headers', 'qual-clang-probe', 'qual-link-probe')
HEX = re.compile(r'[a-f0-9]{64}')
ROOT = re.compile(r'[A-Z]:/a/sortOfRemoteNG/sortOfRemoteNG/\.artifacts/windows-arm-full-sdk-'
                  r'[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}')


class Denied(ValueError):
    pass


def need(value, code):
    if not value:
        raise Denied(code)


def shape(value, keys, code):
    need(type(value) is dict and set(value) == set(keys), code)


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=True).encode('ascii')


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def parse_profile(raw):
    """No path reader or caller-selected policy; one immutable byte pin only."""
    need(type(raw) is bytes and 0 < len(raw) <= 65536 and digest(raw) == PROFILE_SHA256,
         'PRIVATE_POLICY_PIN')
    policy = json.loads(raw)
    need(policy['mode'] == MODE and policy['ref'] == REF and policy['workflow'] == WORKFLOW and
         policy['repository'] == REPOSITORY and policy['repositoryId'] == REPOSITORY_ID and
         policy['qualificationRoles'] == list(ROLES), 'PRIVATE_POLICY_SCOPE')
    need(all(policy[key] is False for key in ('privateAuthorityAdmitted', 'workflowActivation',
         'publicExecuteAdmitted', 'engineCompilationAllowed', 'sdkAllowed', 'nativeAcceptance',
         'runtimeReady', 'environmentContractApproved')) and
         policy['sourceClosureStatus'] == 'planned-files-incomplete', 'PRIVATE_POLICY_CLOSED')
    return policy


def require_private_mode(context):
    """Must precede optional imports, profile/data reads, or future Job access."""
    need(type(context) is dict and context.get('mode') == MODE and context.get('ref') == REF and
         context.get('workflow') == WORKFLOW and context.get('repository') == REPOSITORY and
         context.get('repositoryId') == REPOSITORY_ID and context.get('visibility') == 'public' and
         context.get('event') == 'workflow_dispatch', 'PRIVATE_MODE_SCOPE')


def prepare_for_job(context, *args, **kwargs):
    require_private_mode(context)
    # Deliberate unconditional denial. A future reviewed executor must establish
    # actual source/GN ownership, environment and loader closure independently.
    raise Denied('PRIVATE_EXECUTION_CLOSED')


def source_driver_argv(root, context_sha, raw_policy):
    """Projection of the sole private Job root, not authority to create it."""
    policy = parse_profile(raw_policy)
    need(type(root) is str and ROOT.fullmatch(root), 'PRIVATE_ROOT')
    need(type(context_sha) is str and HEX.fullmatch(context_sha), 'PRIVATE_CONTEXT_PIN')
    checkout = root.split('/.artifacts/', 1)[0]
    return [policy['driverNode']['path'], '--disable-proto=throw', '--no-addons',
            checkout + '/' + policy['handoffContract']['sourceWorker'],
            '--private-source-gn', root, context_sha, '--execute']


def approve_source_job_command(argv, cwd, context):
    """Job adapter entry: no legacy mode, environment/report or import grants."""
    require_private_mode(context)
    # Incomplete source closure / actual source-GN / environment / loader facts
    # stop before any profile reader, optional helper import, or tool launch.
    raise Denied('PRIVATE_EXECUTION_CLOSED')


def source_projection(rows, policy, expected_digest):
    """Canonical source declarations only; never a held-byte/source receipt."""
    need(type(rows) is list and len(rows) == len(policy['sourcePaths']), 'PRIVATE_SOURCE_TUPLE')
    for index, (row, path) in enumerate(zip(rows, policy['sourcePaths'])):
        shape(row, ('path', 'bytes', 'sha256', 'canonicalBytes', 'canonicalSha256', 'encoding'),
              'PRIVATE_SOURCE_FIELDS')
        need(row['path'] == path, 'PRIVATE_SOURCE_TUPLE')
        need(all(type(row[key]) is int and 0 < row[key] <= 2 * 1024**2
                 for key in ('bytes', 'canonicalBytes')), 'PRIVATE_SOURCE_BOUND')
        need(all(type(row[key]) is str and HEX.fullmatch(row[key])
                 for key in ('sha256', 'canonicalSha256')), 'PRIVATE_SOURCE_HASH')
        need(row['encoding'] == 'exact' or (row['encoding'] == 'git-crlf' and
             index in policy['crlfPositions']), 'PRIVATE_SOURCE_ENCODING')
        if row['encoding'] == 'exact':
            need(row['bytes'] == row['canonicalBytes'] and row['sha256'] == row['canonicalSha256'],
                 'PRIVATE_SOURCE_ENCODING')
        else:
            need(row['bytes'] >= row['canonicalBytes'] and
                 row['bytes'] - row['canonicalBytes'] <= row['canonicalBytes'],
                 'PRIVATE_SOURCE_ENCODING')
    need(type(expected_digest) is str and HEX.fullmatch(expected_digest) and
         digest(canonical(rows)) == expected_digest, 'PRIVATE_SOURCE_DIGEST')


def phase_budget(wall_end, monotonic_end, wall_now, monotonic_now):
    values = (wall_end, monotonic_end, wall_now, monotonic_now)
    need(all(type(value) in (int, float) and math.isfinite(value) for value in values),
         'PRIVATE_CLOCK')
    remaining = min(wall_end - wall_now, monotonic_end - monotonic_now)
    need(150 < remaining <= 7200, 'PRIVATE_DEADLINE')
    return {'workSeconds': min(900, remaining - 150), 'cleanupSeconds': 30,
            'finalReserveSeconds': 120, 'originalRemainingSeconds': remaining}


def bindings_projection(bindings, policy, root):
    shape(bindings, ('args', 'graph', 'graphInventory', 'tools'), 'PRIVATE_BINDING_FIELDS')
    out = root + '/source-checkout/src/out/Release_GN_arm64'

    def pin(value, path, expected=None):
        shape(value, ('path', 'bytes', 'sha256'), 'PRIVATE_FILE_FIELDS')
        need(value['path'] == path and type(value['bytes']) is int and
             0 < value['bytes'] <= 256 * 1024**2 and type(value['sha256']) is str and
             HEX.fullmatch(value['sha256']), 'PRIVATE_FILE_PIN')
        if expected is not None:
            need(value['bytes'] == expected['bytes'] and value['sha256'] == expected['sha256'],
                 'PRIVATE_TOOL_PIN')

    pin(bindings['args'], out + '/args.gn')
    pin(bindings['graph'], out + '/build.ninja')
    inventory = bindings['graphInventory']
    shape(inventory, ('files', 'visited', 'bytes', 'sha256'), 'PRIVATE_GRAPH_FIELDS')
    need(type(inventory['files']) is int and 1 <= inventory['files'] <= 50000 and
         type(inventory['visited']) is int and inventory['files'] <= inventory['visited'] <= 300000 and
         type(inventory['bytes']) is int and 0 < inventory['bytes'] <= 8 * 1024**3 and
         type(inventory['sha256']) is str and HEX.fullmatch(inventory['sha256']), 'PRIVATE_GRAPH_BOUND')
    shape(bindings['tools'], policy['tools'], 'PRIVATE_TOOL_FIELDS')
    for role, expected in policy['tools'].items():
        pin(bindings['tools'][role], expected.get('path') or root + '/' + expected['relativePath'], expected)


def inspect_projection(context, raw_policy, *, wall_now, monotonic_now):
    """Check future caller shape without reading a tree or authorizing a Job."""
    require_private_mode(context)
    policy = parse_profile(raw_policy)
    shape(context, ('kind', 'mode', 'ref', 'workflow', 'repository', 'repositoryId', 'visibility',
          'event', 'head', 'workflowSha', 'image', 'host', 'root', 'source', 'sources',
          'sourceDigest', 'bindings', 'wallWorkEnd', 'monotonicWorkEnd'), 'PRIVATE_CONTEXT_FIELDS')
    need(context['kind'] == 'windows-arm-private-input-projection' and
         type(context['head']) is str and re.fullmatch(r'[a-f0-9]{40}', context['head']) and
         context['head'] == context['workflowSha'], 'PRIVATE_CONTEXT_HEAD')
    need(type(context['image']) is str and context['image'] in policy['images'] and
         context['host'] == {'platform': 'win32', 'architecture': 'x64', 'runner': policy['runner']},
         'PRIVATE_HOST_IMAGE')
    need(type(context['root']) is str and ROOT.fullmatch(context['root']), 'PRIVATE_ROOT')
    selected = policy['images'][context['image']]
    need(type(context['source']) is dict and context['source'] == {
         'target': 'aarch64-pc-windows-msvc', 'sourceId': selected['sourceId'],
         'profileSha256': selected['profileSha256'], 'chromium': policy['chromium'],
         'cef': policy['cef']}, 'PRIVATE_SOURCE_SCOPE')
    source_projection(context['sources'], policy, context['sourceDigest'])
    bindings_projection(context['bindings'], policy, context['root'])
    budget = phase_budget(context['wallWorkEnd'], context['monotonicWorkEnd'], wall_now, monotonic_now)
    return {'kind': 'windows-arm-private-input-projection-result', 'projectionMatches': True,
            'sourceBytesVerified': False, 'liveJobCapability': False, 'executionAdmitted': False,
            'budget': budget, 'missing': list(policy['missingBeforePrivateActivation'])}


def command_projection(role, context, raw_policy, *, wall_now, monotonic_now):
    """Fixed argv projection. No executable/path/flags can be supplied by caller."""
    result = inspect_projection(context, raw_policy, wall_now=wall_now, monotonic_now=monotonic_now)
    need(type(role) is str and role in ROLES, 'PRIVATE_ROLE')
    policy = parse_profile(raw_policy)
    root = context['root']
    source = root + '/source-checkout/src'
    out = source + '/out/Release_GN_arm64'
    probe = root + '/private-qualification'
    checkout = root.split('/.artifacts/', 1)[0]
    gn = source + '/buildtools/win/gn.exe'
    if role in ROLES[:2]:
        argv = [gn, 'desc', out, policy['generatedInputs'][ROLES.index(role)]['label'], '--format=json']
    elif role == 'qual-gn-args':
        argv = [gn, 'args', out, '--list', '--json', '--short']
    elif role == 'qual-generate-headers':
        argv = [root + '/siso/siso.exe', 'ninja', '--offline', '-local_jobs=1', '-C', out] + [
            row['relativeOutput'] for row in policy['generatedInputs']]
    elif role == 'qual-clang-probe':
        argv = [root + '/llvm/bin/clang-cl.exe', '--target=aarch64-pc-windows-msvc', '/c',
                '/nologo', '/X', '/GS', '/Zl', '/std:c++20', '/clang:-nostdinc',
                '/I' + source + '/base/allocator/partition_allocator/src',
                '/I' + out + '/gen/base/allocator/partition_allocator/src', '/I' + out + '/gen',
                '/Fo' + probe + '/probe.obj', checkout + '/' + policy['probeSource']]
    else:
        argv = [root + '/llvm/bin/lld-link.exe', '/lldignoreenv', '/nodefaultlib', '/machine:arm64',
                '/subsystem:console', '/entry:' + policy['probeEntry'], '/manifest:no',
                '/out:' + probe + '/probe.exe', probe + '/probe.obj']
    return {**result, 'role': role, 'argv': argv,
            'cwd': source if role in ROLES[:4] else probe,
            'environmentContract': 'unreviewed-source-parity' if role in ROLES[:4] else 'unreviewed-hermetic-tools',
            'outputsExecuted': False, 'actualLoaderClosureApproved': False}


def inspect_lld_bytes(raw, raw_policy):
    """Read-only PE static projection, never loader/System32 or run authority."""
    policy = parse_profile(raw_policy)
    expected = policy['lldStaticCandidate']
    need(type(raw) is bytes and len(raw) == expected['bytes'] and digest(raw) == expected['sha256'],
         'PRIVATE_LLD_PIN')
    # Optional data parser imported only after the one known byte pin matches.
    from extract import pe_metadata
    observed = pe_metadata(raw)
    need(observed['machine'] == expected['machine'] and observed['imports'] == expected['imports'] and
         observed['delayImports'] == expected['delayImports'], 'PRIVATE_LLD_STATIC_PROJECTION')
    return {'kind': 'windows-arm-lld-static-candidate', 'bytes': len(raw), 'sha256': digest(raw),
            'machine': observed['machine'], 'imports': observed['imports'],
            'delayImports': observed['delayImports'], 'staticProjectionMatches': True,
            'actualLoaderClosureApproved': False, 'system32ByteSetProven': False,
            'toolExecuted': False, 'executionAdmitted': False}


# GN's args JSON schema is from BuildArgJson (--short), GetAllArguments and
# SetSystemVarsLocked. The latter implicitly declares built-in CPU variables
# so they appear in this JSON. This source record is not live GN execution.
GN_ARGUMENT_SOURCE = {
    'url': 'https://gn.googlesource.com/gn/+/150a9d6ba0aa7f407aa4feeabc5f03ce9aa7e04b/src/gn/args.cc?format=TEXT',
    'bytes': 17609,
    'sha256': '2f79a7cf16e873ce7730d3da3e4b8885038ba9b71817fb8be99703814c0e5d29',
}
ARM_TOOLCHAIN = '//build/toolchain/win:win_clang_arm64'
CRITICAL_DECLARED_ARGS = {
    'is_clang': 'true', 'use_lld': 'true', 'use_remoteexec': 'false',
    'use_siso': 'true', 'is_component_build': 'false', 'is_debug': 'false',
    'enable_backup_ref_ptr_instance_tracer': 'false', 'v8_enable_sandbox': 'true',
}
BUILTIN_CPU_ARGS = {'target_cpu': '"arm64"', 'host_cpu': '"x64"'}


def candidate_policy(raw_policy, raw_candidate_policy):
    """Only the existing immutable inert policy supplies macro names/minimums."""
    policy = parse_profile(raw_policy)
    need(type(raw_candidate_policy) is bytes and 0 < len(raw_candidate_policy) <= 65536 and
         digest(raw_candidate_policy) == policy['baseCandidatePolicySha256'], 'PRIVATE_CANDIDATE_POLICY_PIN')
    return json.loads(raw_candidate_policy)


def bounded_json(raw, maximum=4 * 1024**2):
    need(type(raw) is bytes and 0 < len(raw) <= maximum and b'\0' not in raw,
         'PRIVATE_JSON_BOUND')
    # Bound nesting before the decoder allocates recursive containers. Braces
    # inside strings (including escaped quotes/backslashes) are not structure.
    depth, quoted, escaped = 0, False, False
    for byte in raw:
        if quoted:
            if escaped:
                escaped = False
            elif byte == 92:
                escaped = True
            elif byte == 34:
                quoted = False
        elif byte == 34:
            quoted = True
        elif byte in (91, 123):
            depth += 1
            need(depth <= 32, 'PRIVATE_JSON_DEPTH')
        elif byte in (93, 125):
            depth -= 1
            need(depth >= 0, 'PRIVATE_JSON_SYNTAX')

    def unique(pairs):
        result = {}
        for key, value in pairs:
            need(key not in result, 'PRIVATE_JSON_DUPLICATE')
            result[key] = value
        return result

    def invalid_constant(_):
        raise Denied('PRIVATE_JSON_CONSTANT')

    try:
        return json.loads(raw.decode('utf8'), object_pairs_hook=unique,
                          parse_constant=invalid_constant)
    except (UnicodeError, json.JSONDecodeError, RecursionError, ValueError) as error:
        if isinstance(error, Denied):
            raise
        raise Denied('PRIVATE_JSON_SYNTAX') from None


def inspect_evaluated_args(raw):
    """Check GN --list --json --short candidate bytes, never run/evaluate GN."""
    rows = bounded_json(raw)
    need(type(rows) is list and 1 <= len(rows) <= 8192, 'PRIVATE_GN_ARGS_ROWS')
    values = {}
    for row in rows:
        need(type(row) is dict and set(row) in ({'name', 'default'}, {'name', 'default', 'current'}),
             'PRIVATE_GN_ARG_FIELDS')
        name = row['name']
        need(type(name) is str and re.fullmatch(r'[a-z][a-z0-9_]{0,127}', name) and
             name not in values, 'PRIVATE_GN_ARG_NAME')
        for key in ('default', 'current'):
            if key in row:
                shape(row[key], ('value',), 'PRIVATE_GN_ARG_VALUE_FIELDS')
                text = row[key]['value']
                need(type(text) is str and len(text) <= 65536 and '\0' not in text,
                     'PRIVATE_GN_ARG_VALUE')
        # An override of false must never fall back to the default true value.
        values[name] = row['current' if 'current' in row else 'default']['value']
    for name, expected in CRITICAL_DECLARED_ARGS.items():
        need(values.get(name) == expected, 'PRIVATE_GN_ARG_CRITICAL')
    for name, expected in BUILTIN_CPU_ARGS.items():
        need(values.get(name) == expected, 'PRIVATE_GN_ARG_CPU')
    return {'kind': 'windows-arm-candidate-evaluated-args', 'sha256': digest(raw), 'bytes': len(raw),
            'values': values, 'criticalDeclaredValuesMatch': True,
            'builtinCpuRowsRequired': True, 'processProvenanceVerified': False,
            'executionAdmitted': False}


def inspect_action_desc(raw, role, raw_policy, raw_candidate_policy):
    """Strict fixed-action projection of GN desc; returned data is never argv."""
    policy = candidate_policy(raw_policy, raw_candidate_policy)
    need(role in ('partitionAlloc', 'cefConfig'), 'PRIVATE_GN_DESC_ROLE')
    expected = next(row for row in policy['generatedInputs'] if row['role'] == role)
    label = expected['label']
    top = bounded_json(raw, 1024**2)
    shape(top, (label,), 'PRIVATE_GN_DESC_LABEL')
    action = top[label]
    common = ('type', 'toolchain', 'metadata', 'visibility', 'testonly', 'check_includes_strict',
              'public', 'script', 'args', 'outputs', 'deps')
    shape(action, common + (('response_file_contents',) if role == 'partitionAlloc' else ('inputs',)),
          'PRIVATE_GN_DESC_FIELDS')
    need(action['type'] == 'action' and action['toolchain'] == ARM_TOOLCHAIN and
         action['metadata'] == {} and action['testonly'] is False and
         type(action['check_includes_strict']) is bool and action['public'] == '*',
         'PRIVATE_GN_DESC_ACTION')
    visibility = action['visibility']
    need(type(visibility) is list and 1 <= len(visibility) <= 128 and
         all(type(value) is str and 0 < len(value) <= 1024 and
             all(32 <= ord(char) < 127 for char in value) for value in visibility),
         'PRIVATE_GN_DESC_VISIBILITY')
    out = '//out/Release_GN_arm64/'
    need(action['outputs'] == [out + expected['relativeOutput']], 'PRIVATE_GN_DESC_OUTPUT')
    macros = None
    if role == 'partitionAlloc':
        prefix = '//base/allocator/partition_allocator/src/partition_alloc'
        header = 'base/allocator/partition_allocator/src/partition_alloc/buildflags.h'
        need(action['script'] == prefix + '/write_buildflag_header.py' and
             action['args'] == ['--output', header, '--rulename', label,
                                '--gen-dir', 'gen', '--definitions', '{{response_file_name}}'] and
             action['deps'] == [prefix + ':buildflag_macro'], 'PRIVATE_GN_DESC_COMMAND')
        flags = action['response_file_contents']
        names = policy['partitionAllocMacros']
        need(type(flags) is list and len(flags) == len(names) + 1 and flags[0] == '--flags',
             'PRIVATE_GN_DESC_FLAGS')
        macros = {}
        for name, flag in zip(names, flags[1:]):
            need(type(flag) is str and flag.startswith(name + '='), 'PRIVATE_GN_DESC_FLAG_ORDER')
            value = flag[len(name) + 1:]
            if name == 'USER_SPACE_ZERO_SEGMENT_SIZE_MB':
                need(re.fullmatch(r'0|[1-9][0-9]{0,9}', value) is not None and
                     int(value) <= 2**31 - 1, 'PRIVATE_GN_DESC_FLAG_VALUE')
                macros[name] = int(value)
            else:
                need(value in ('true', 'false'), 'PRIVATE_GN_DESC_FLAG_VALUE')
                macros[name] = int(value == 'true')
    else:
        need(action['script'] == '//cef/tools/make_config_header.py' and
             action['args'] == ['gen/cef/include/cef_config.h', 'args.gn'] and
             action['inputs'] == [out + 'args.gn'] and
             action['deps'] == ['//cef:args_gn_source'], 'PRIVATE_GN_DESC_COMMAND')
    return {'kind': 'windows-arm-candidate-action-desc', 'role': role, 'label': label,
            'bytes': len(raw), 'sha256': digest(raw), 'toolchain': ARM_TOOLCHAIN,
            'outputs': list(action['outputs']), 'evaluatedMacroValues': macros,
            'actionProjectionMatches': True, 'processProvenanceVerified': False,
            'fullArm64DefaultsQualified': False, 'executionAdmitted': False}


def inspect_private_outputs(context, raw_policy, raw_candidate_policy, observations,
                            *, wall_now, monotonic_now):
    """Pure bounded observations tied to one candidate source/graph/tool tuple.

    A caller can construct these bytes. Matching projections are not evidence
    of process origin, live handles, inherited Job ownership, or admission.
    """
    projection = inspect_projection(context, raw_policy, wall_now=wall_now, monotonic_now=monotonic_now)
    policy = candidate_policy(raw_policy, raw_candidate_policy)
    shape(observations, ('gnDescPartitionAlloc', 'gnDescCef', 'gnArgs', 'files'),
          'PRIVATE_OUTPUT_FIELDS')
    desc_pa = inspect_action_desc(observations['gnDescPartitionAlloc'], 'partitionAlloc',
                                  raw_policy, raw_candidate_policy)
    desc_cef = inspect_action_desc(observations['gnDescCef'], 'cefConfig', raw_policy, raw_candidate_policy)
    evaluated = inspect_evaluated_args(observations['gnArgs'])
    root = context['root']
    out = root + '/source-checkout/src/out/Release_GN_arm64/'
    paths = {'args': out + 'args.gn', 'partitionAlloc': out + policy['generatedInputs'][0]['relativeOutput'],
             'cefConfig': out + policy['generatedInputs'][1]['relativeOutput'],
             'coff': root + '/private-qualification/probe.obj', 'pe': root + '/private-qualification/probe.exe'}
    files = observations['files']
    shape(files, paths, 'PRIVATE_OUTPUT_FILE_FIELDS')
    # All bytes and their exact paths/pins are checked before optional parsers.
    for role, path in paths.items():
        row = files[role]
        shape(row, ('pin', 'raw'), 'PRIVATE_OUTPUT_CANDIDATE')
        shape(row['pin'], ('path', 'bytes', 'sha256'), 'PRIVATE_OUTPUT_PIN_FIELDS')
        raw = row['raw']
        need(type(raw) is bytes and 0 < len(raw) <= 8 * 1024**2 and
             type(row['pin']['bytes']) is int and row['pin']['path'] == path and
             row['pin']['bytes'] == len(raw) and row['pin']['sha256'] == digest(raw), 'PRIVATE_OUTPUT_PIN')
    need(files['args']['pin'] == context['bindings']['args'], 'PRIVATE_OUTPUT_ARGS_CHANGED')
    # These existing inert parsers perform no reads/spawns. Do not call their
    # load_profile/validate_request helpers, which are unnecessary for bytes.
    import engine_qualification as engine
    try:
        literal = engine.inspect_args(files['args']['raw'])
        need('target_cpu="arm64"' in files['args']['raw'].decode('utf8').splitlines(),
             'PRIVATE_CEF_GENERATOR_CPU_LINE')
        cef_header = engine.inspect_cef_config_header(files['cefConfig']['raw'])
        coff = engine.inspect_coff(files['coff']['raw'])
        pe = engine.inspect_pe(files['pe']['raw'])
        lines = engine.header_text(files['partitionAlloc']['raw'])
    except engine.QualificationError as error:
        raise Denied(str(error)) from None
    need(lines[:3] == ['#ifndef ' + engine.PA_GUARD, '#define ' + engine.PA_GUARD,
                       '#include "partition_alloc/buildflag.h"'] and lines[-1:] == ['#endif'],
         'PRIVATE_PA_HEADER')
    macros = {}
    for line in lines[3:-1]:
        match = re.fullmatch(r'#define PA_BUILDFLAG_INTERNAL_([A-Z][A-Z0-9_]*)\(\) \((0|[1-9][0-9]{0,9})\)', line)
        need(match is not None and match[1] not in macros, 'PRIVATE_PA_MACRO')
        macros[match[1]] = int(match[2])
    need(list(macros) == policy['partitionAllocMacros'] and macros == desc_pa['evaluatedMacroValues'],
         'PRIVATE_PA_DESC_HEADER_MISMATCH')
    for name, expected in {**policy['explicitArgumentInvariants'], **policy['securityPolicyMinimums']}.items():
        need(macros[name] == expected, 'PRIVATE_PA_SECURITY_MINIMUM')
    # Literal source args and evaluated values must agree where GN declares
    # the name, including its implicitly declared built-in CPU variables.
    literal_values = {}
    for line in files['args']['raw'].decode('utf8').splitlines():
        match = re.fullmatch(r'\s*([a-z][a-z0-9_]*)\s*=\s*'
            r'(true|false|-?(?:0|[1-9][0-9]{0,9})|"(?:[^"\\$\x00-\x1f]|\\["\\])*")'
            r'\s*(?:#.*)?', line)
        if match:
            literal_values[match[1]] = match[2]
    for name, value in literal_values.items():
        if name in evaluated['values']:
            need(value == evaluated['values'][name], 'PRIVATE_LITERAL_EVALUATED_MISMATCH')
    return {'kind': 'windows-arm-private-output-candidate', 'source': dict(context['source']),
            'image': context['image'], 'inputBindings': context['bindings'],
            'privatePolicySha256': digest(raw_policy), 'inertPolicySha256': digest(raw_candidate_policy),
            'argumentSchemaSource': dict(GN_ARGUMENT_SOURCE),
            'metadata': {'partitionAlloc': desc_pa, 'cefConfig': desc_cef, 'arguments': evaluated},
            'literalArguments': literal, 'partitionAllocMacros': macros, 'cefHeader': cef_header,
            'coff': coff, 'pe': pe, 'filePins': {role: dict(row['pin']) for role, row in files.items()},
            'policyMinimumsMet': True, 'evaluatedMetadataProjectionMatches': True,
            'completeMacroInventoryMatches': True, 'fullArm64DefaultsQualified': False,
            'processProvenanceVerified': False, 'liveJobCapability': False,
            'generatedSecurityHeadersVerified': False, 'executionAdmitted': False,
            'outputsExecuted': False, 'sdkBuilt': False, 'nativeAcceptance': False,
            'missing': projection['missing']}


# This is a source pin only. The probe is intentionally uncompiled; successful
# byte inspection cannot authorize compiler execution or validate ARM defaults.
PROBE_SOURCE_BYTES = 2651
PROBE_SOURCE_SHA256 = '0e291acd6f1fdcbd7f79d2874e760927e92bc13eeab241016bb87878867f9220'


def inspect_probe_source(raw, raw_policy):
    policy = parse_profile(raw_policy)
    need(type(raw) is bytes and len(raw) == PROBE_SOURCE_BYTES and
         digest(raw) == PROBE_SOURCE_SHA256, 'PRIVATE_PROBE_SOURCE_PIN')
    return {'kind': 'windows-arm-fixed-probe-source-candidate', 'path': policy['probeSource'],
            'bytes': len(raw), 'sha256': digest(raw), 'entry': policy['probeEntry'],
            'sourceProjectionMatches': True, 'sourceBytesVerifiedInOwnedTree': False,
            'compiled': False, 'linked': False, 'outputsExecuted': False,
            'fullArm64DefaultsQualified': False, 'executionAdmitted': False}


def static_projection_equal(value, expected):
    """Strict types and exact fields; recursion follows the bounded policy."""
    if type(value) is not type(expected):
        return False
    if type(expected) is dict:
        return set(value) == set(expected) and all(
            static_projection_equal(value[key], item) for key, item in expected.items())
    if type(expected) is list:
        return len(value) == len(expected) and all(
            static_projection_equal(a, b) for a, b in zip(value, expected))
    return value == expected


def inspect_static_loading(context, raw_policy, observations):
    """Named OS-TCB/static-tool candidate check; never actual module proof.

    The existing source/GN policy supplies Python/GN/Siso/Node/Git contracts.
    Only the additional LLVM pair has new exact static import projections.
    Serialized observations do not mint live ownership/environment authority.
    """
    require_private_mode(context)
    policy = parse_profile(raw_policy)
    loading = policy['staticLoadingPolicy']
    need(loading['kind'] == 'reviewed-system-image-static-tools-v1' and
         loading['systemImageIsTrustedTcb'] is True and
         loading['actualLoaderClosureApproved'] is False and
         loading['system32ByteSetProven'] is False, 'PRIVATE_STATIC_POLICY')
    need(type(context.get('root')) is str and ROOT.fullmatch(context['root']) and
         type(context.get('image')) is str and context['image'] in loading['images'] and
         static_projection_equal(context.get('host'), {'platform': loading['platform'],
          'architecture': loading['architecture'], 'runner': loading['runner']}), 'PRIVATE_STATIC_HOST')
    selected = policy['images'][context['image']]
    need(static_projection_equal(context.get('source'), {'target': policy['target'],
         'sourceId': selected['sourceId'], 'profileSha256': selected['profileSha256'],
         'chromium': policy['chromium'], 'cef': policy['cef']}), 'PRIVATE_STATIC_SOURCE')
    shape(observations, ('kind', 'toolPins', 'llvmArchive', 'llvmTools', 'compilerEnvironment'),
          'PRIVATE_STATIC_LOADING_FIELDS')
    need(observations['kind'] == 'windows-arm-static-loading-candidate', 'PRIVATE_STATIC_LOADING_KIND')
    root = context['root']
    pins = {role: {'path': row.get('path') or root + '/' + row['relativePath'],
                  'bytes': row['bytes'], 'sha256': row['sha256']} for role, row in policy['tools'].items()}
    need(static_projection_equal(observations['toolPins'], pins), 'PRIVATE_STATIC_TOOL_PIN')
    need(static_projection_equal(observations['llvmArchive'], loading['llvmArchive']), 'PRIVATE_STATIC_ARCHIVE')
    llvm = {role: {'path': pins[role]['path'], **row} for role, row in loading['llvmStaticTools'].items()}
    need(static_projection_equal(observations['llvmTools'], llvm), 'PRIVATE_STATIC_PE')
    environment = observations['compilerEnvironment']
    shape(environment, ('kind', 'cwd', 'cwdEntriesBefore', 'values'), 'PRIVATE_STATIC_ENV_FIELDS')
    rules = loading['commandEnvironment']
    need(environment['kind'] == 'closed-fixed-compiler-environment' and
         environment['cwd'] == root + '/' + rules['compilerCwdRelative'] and
         static_projection_equal(environment['cwdEntriesBefore'], rules['initialCwdEntries']),
         'PRIVATE_STATIC_CWD')
    values = environment['values']
    expected_values = {**rules['requiredValues'], 'TEMP': root + '/' + rules['temporaryRelative'],
                       'TMP': root + '/' + rules['temporaryRelative']}
    need(type(values) is dict and set(values) in (set(expected_values),
         set(expected_values) | {rules['optionalTrackingVariable']}), 'PRIVATE_STATIC_ENV_NAMES')
    for name, expected in expected_values.items():
        need(type(values.get(name)) is str and values[name] == expected, 'PRIVATE_STATIC_ENV_VALUE')
    if rules['optionalTrackingVariable'] in values:
        tracking = values[rules['optionalTrackingVariable']]
        need(type(tracking) is str and re.fullmatch(r'[A-Za-z0-9_-]{1,128}', tracking),
             'PRIVATE_STATIC_TRACKING')
    return {'kind': 'windows-arm-static-loading-projection', 'policyKind': loading['kind'],
            'image': context['image'], 'source': dict(context['source']),
            'selectedSourceProfileSha256': selected['profileSha256'],
            'staticPolicyProjectionMatches': True, 'systemImageIsTrustedTcb': True,
            'reusedSourceToolRoles': list(loading['reusedSourceToolRoles']),
            'additionalStaticToolRoles': list(loading['llvmStaticTools']),
            'actualLoaderClosureApproved': False, 'system32ByteSetProven': False,
            'liveOwnershipVerified': False, 'environmentAuthorityTransferred': False,
            'processProvenanceVerified': False, 'executionAdmitted': False}
