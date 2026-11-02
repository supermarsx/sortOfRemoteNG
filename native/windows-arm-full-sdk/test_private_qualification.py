"""Private preparation declarations/denials only; no compiler or Job execution."""
import copy
import ast
import builtins
import hashlib
import json
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import private_qualification as private
import test_engine_qualification as inert_fixtures

RAW = (HERE / 'private-qualification-profile.json').read_bytes()
POLICY = private.parse_profile(RAW)
ROOT = 'D:/a/sortOfRemoteNG/sortOfRemoteNG/.artifacts/windows-arm-full-sdk-01234567-89ab-4cde-8123-456789abcdef'


def context(image='20261030.294.1'):
    # Synthetic declarations, intentionally not live source/graph/tool evidence.
    rows = [{'path': path, 'bytes': 1, 'sha256': 'a' * 64, 'canonicalBytes': 1,
             'canonicalSha256': 'a' * 64, 'encoding': 'exact'} for path in POLICY['sourcePaths']]
    selected = POLICY['images'][image]
    out = ROOT + '/source-checkout/src/out/Release_GN_arm64'
    return {'kind': 'windows-arm-private-input-projection', 'mode': private.MODE,
            'ref': private.REF, 'workflow': private.WORKFLOW, 'repository': private.REPOSITORY,
            'repositoryId': private.REPOSITORY_ID, 'visibility': 'public', 'event': 'workflow_dispatch',
            'head': 'a' * 40, 'workflowSha': 'a' * 40, 'image': image,
            'host': {'platform': 'win32', 'architecture': 'x64', 'runner': 'windows-2025-vs2026'},
            'root': ROOT, 'source': {'target': 'aarch64-pc-windows-msvc',
             'sourceId': selected['sourceId'], 'profileSha256': selected['profileSha256'],
             'chromium': POLICY['chromium'], 'cef': POLICY['cef']},
            'sources': rows, 'sourceDigest': private.digest(private.canonical(rows)),
            'bindings': {'args': {'path': out + '/args.gn', 'bytes': 1, 'sha256': 'a' * 64},
             'graph': {'path': out + '/build.ninja', 'bytes': 1, 'sha256': 'b' * 64},
             'graphInventory': {'files': 1, 'visited': 2, 'bytes': 1, 'sha256': 'c' * 64},
             'tools': {role: {'path': value.get('path') or ROOT + '/' + value['relativePath'],
                       'bytes': value['bytes'], 'sha256': value['sha256']}
                       for role, value in POLICY['tools'].items()}},
            'wallWorkEnd': 1200, 'monotonicWorkEnd': 1200}


def inspect(value):
    return private.inspect_projection(value, RAW, wall_now=200, monotonic_now=200)


BASE_RAW = (HERE / 'engine-qualification-profile.json').read_bytes()
BASE_POLICY = json.loads(BASE_RAW)


def json_bytes(value):
    return json.dumps(value, separators=(',', ':')).encode()


def output_fixture(image='20261030.294.1'):
    """Synthetic candidate bytes only, not actual ARM defaults or GN output."""
    value = context(image)
    args = inert_fixtures.args() + b'v8_enable_sandbox=true\n'
    out = ROOT + '/source-checkout/src/out/Release_GN_arm64/'
    pin = inert_fixtures.pin
    value['bindings']['args'] = pin(out + 'args.gn', args)
    pa_raw = inert_fixtures.pa_header()
    # Derive candidate GN flags from the synthetic header, not an architecture
    # default table. Tests change unconstrained values on BOTH sides below.
    import re
    macros = dict((name.decode(), int(number)) for name, number in re.findall(
        rb'#define PA_BUILDFLAG_INTERNAL_([A-Z0-9_]+)\(\) \(([0-9]+)\)', pa_raw))
    flags = ['--flags'] + [name + '=' + (str(macros[name]) if name == 'USER_SPACE_ZERO_SEGMENT_SIZE_MB'
              else 'true' if macros[name] else 'false') for name in BASE_POLICY['partitionAllocMacros']]
    desc = []
    for row in BASE_POLICY['generatedInputs']:
        action = {'type': 'action', 'toolchain': private.ARM_TOOLCHAIN, 'metadata': {},
                  'visibility': ['*'], 'testonly': False, 'check_includes_strict': False, 'public': '*',
                  'outputs': ['//out/Release_GN_arm64/' + row['relativeOutput']]}
        if row['role'] == 'partitionAlloc':
            prefix = '//base/allocator/partition_allocator/src/partition_alloc'
            action.update(script=prefix + '/write_buildflag_header.py',
                args=['--output', 'base/allocator/partition_allocator/src/partition_alloc/buildflags.h',
                      '--rulename', row['label'], '--gen-dir', 'gen', '--definitions', '{{response_file_name}}'],
                deps=[prefix + ':buildflag_macro'], response_file_contents=flags)
        else:
            action.update(script='//cef/tools/make_config_header.py',
                args=['gen/cef/include/cef_config.h', 'args.gn'], deps=['//cef:args_gn_source'],
                inputs=['//out/Release_GN_arm64/args.gn'])
        desc.append(json_bytes({row['label']: action}))
    evaluated = [{'name': name, 'default': {'value': expected}} for name, expected in
                 {**private.CRITICAL_DECLARED_ARGS, **private.BUILTIN_CPU_ARGS}.items()]
    observed = {'gnDescPartitionAlloc': desc[0], 'gnDescCef': desc[1], 'gnArgs': json_bytes(evaluated),
                'files': {}}
    for role, path, raw in [('args', out + 'args.gn', args),
            ('partitionAlloc', out + BASE_POLICY['generatedInputs'][0]['relativeOutput'], pa_raw),
            ('cefConfig', out + BASE_POLICY['generatedInputs'][1]['relativeOutput'], inert_fixtures.CEF),
            ('coff', ROOT + '/private-qualification/probe.obj', inert_fixtures.coff()),
            ('pe', ROOT + '/private-qualification/probe.exe', inert_fixtures.pe())]:
        observed['files'][role] = {'pin': pin(path, raw), 'raw': raw}
    return value, observed


def inspect_outputs(value, observed):
    return private.inspect_private_outputs(value, RAW, BASE_RAW, observed, wall_now=200, monotonic_now=200)


def action(observed, role='partitionAlloc'):
    key = 'gnDescPartitionAlloc' if role == 'partitionAlloc' else 'gnDescCef'
    top = json.loads(observed[key])
    return key, top, next(iter(top.values()))


def replace_file(observed, role, raw):
    row = observed['files'][role]
    row.update(raw=raw, pin=inert_fixtures.pin(row['pin']['path'], raw))


def static_loading_fixture(image='20261030.294.1'):
    value = context(image)
    rules = POLICY['staticLoadingPolicy']
    pins = {role: {'path': row.get('path') or ROOT + '/' + row['relativePath'],
                  'bytes': row['bytes'], 'sha256': row['sha256']} for role, row in POLICY['tools'].items()}
    observed = {'kind': 'windows-arm-static-loading-candidate', 'toolPins': pins,
        'llvmArchive': copy.deepcopy(rules['llvmArchive']),
        'llvmTools': {role: {'path': pins[role]['path'], **copy.deepcopy(row)}
                      for role, row in rules['llvmStaticTools'].items()},
        'compilerEnvironment': {'kind': 'closed-fixed-compiler-environment',
            'cwd': ROOT + '/private-qualification', 'cwdEntriesBefore': [],
            'values': {**rules['commandEnvironment']['requiredValues'],
                       'TEMP': ROOT + '/private-qualification-tmp', 'TMP': ROOT + '/private-qualification-tmp'}}}
    return value, observed


class StaticLoadingPolicyTests(unittest.TestCase):
    def test_both_exact_source_images_match_named_static_contract_without_dynamic_claims(self):
        loading = POLICY['staticLoadingPolicy']
        prior_clang = json.loads((HERE / 'preflight-profile.json').read_bytes())['clang']
        for field in ('bytes', 'sha256', 'imports', 'delayImports'):
            self.assertEqual(loading['llvmStaticTools']['clang'][field], prior_clang[field])
        for field in ('bytes', 'sha256', 'machine', 'imports', 'delayImports', 'adjacentBinDlls'):
            self.assertEqual(loading['llvmStaticTools']['lld'][field], POLICY['lldStaticCandidate'][field])
        self.assertEqual(loading['llvmArchive'], POLICY['lldStaticCandidate']['archive'])
        for image in POLICY['images']:
            value, observed = static_loading_fixture(image)
            result = private.inspect_static_loading(value, RAW, observed)
            self.assertTrue(result['staticPolicyProjectionMatches'])
            self.assertTrue(result['systemImageIsTrustedTcb'])
            self.assertEqual(result['reusedSourceToolRoles'], ['python', 'gn', 'siso', 'node', 'git'])
            self.assertEqual(result['additionalStaticToolRoles'], ['clang', 'lld'])
            for field in ('actualLoaderClosureApproved', 'system32ByteSetProven', 'liveOwnershipVerified',
                          'environmentAuthorityTransferred', 'processProvenanceVerified', 'executionAdmitted'):
                self.assertIs(result[field], False)
            self.assertFalse(POLICY['environmentContractApproved'])
            observed['compilerEnvironment']['values']['RUNNER_TRACKING_ID'] = 'owned-fixture-tracking_1'
            self.assertFalse(private.inspect_static_loading(value, RAW, observed)['executionAdmitted'])

    def test_wrong_mode_image_host_source_profile_and_root_deny_before_any_optional_import(self):
        for change in ('mode', 'image', 'host', 'source', 'profile', 'root'):
            value, observed = static_loading_fixture()
            if change == 'mode': value['mode'] = 'source-gn'
            elif change == 'image': value['image'] = '20261101.000.1'
            elif change == 'host': value['host']['architecture'] = 'arm64'
            elif change == 'source': value['source']['sourceId'] = 'b' * 64
            elif change == 'profile': value['source']['profileSha256'] = POLICY['images']['20261021.278.1']['profileSha256']
            else: value['root'] += '/..'
            with self.subTest(change=change), patch('builtins.__import__', side_effect=AssertionError('import')):
                with self.assertRaises(private.Denied): private.inspect_static_loading(value, RAW, observed)

    def test_all_tool_and_official_archive_pin_substitutions_are_rejected(self):
        for role in POLICY['tools']:
            for field, bad in [('path', ROOT + '/arbitrary.exe'), ('bytes', True), ('sha256', 'b' * 64)]:
                value, observed = static_loading_fixture();observed['toolPins'][role][field] = bad
                with self.subTest(role=role, field=field), self.assertRaisesRegex(private.Denied, 'PRIVATE_STATIC_TOOL_PIN'):
                    private.inspect_static_loading(value, RAW, observed)
        for field, bad in [('url', POLICY['staticLoadingPolicy']['llvmArchive']['url'] + '&fallback=1'),
                           ('sha256', 'b' * 64), ('bytes', 1)]:
            value, observed = static_loading_fixture();observed['llvmArchive'][field] = bad
            with self.subTest(field=field), self.assertRaisesRegex(private.Denied, 'PRIVATE_STATIC_ARCHIVE'):
                private.inspect_static_loading(value, RAW, observed)

    def test_static_import_delay_machine_adjacent_and_dynamic_claim_spoofs_deny(self):
        for role in ('clang', 'lld'):
            for field, bad in [('machine', 0xaa64), ('imports', ['unexpected.dll']), ('delayImports', []),
                               ('adjacentBinDlls', ['version.dll']), ('actualLoaderClosureApproved', True)]:
                value, observed = static_loading_fixture();observed['llvmTools'][role][field] = bad
                with self.subTest(role=role, field=field), self.assertRaisesRegex(private.Denied, 'PRIVATE_STATIC_PE'):
                    private.inspect_static_loading(value, RAW, observed)
        value, observed = static_loading_fixture();observed['system32ByteSetProven'] = True
        with self.assertRaisesRegex(private.Denied, 'PRIVATE_STATIC_LOADING_FIELDS'):
            private.inspect_static_loading(value, RAW, observed)

    def test_cl_link_include_path_fallback_and_nonempty_cwd_cannot_match_contract(self):
        for name in ('CL', '_CL_', 'LINK', '_LINK_', 'INCLUDE', 'LIB', 'LIBPATH', 'GITHUB_TOKEN', 'path'):
            value, observed = static_loading_fixture();observed['compilerEnvironment']['values'][name] = 'untrusted'
            with self.subTest(name=name), self.assertRaisesRegex(private.Denied, 'PRIVATE_STATIC_ENV_NAMES'):
                private.inspect_static_loading(value, RAW, observed)
        for field, bad in [('PATH', 'C:/hostile;C:/Windows/System32'), ('SystemRoot', 'C:/other'),
                           ('TEMP', ROOT + '/private-qualification'), ('TMP', ROOT + '/other')]:
            value, observed = static_loading_fixture();observed['compilerEnvironment']['values'][field] = bad
            with self.subTest(field=field), self.assertRaisesRegex(private.Denied, 'PRIVATE_STATIC_ENV_VALUE'):
                private.inspect_static_loading(value, RAW, observed)
        for field, bad in [('cwd', ROOT), ('cwdEntriesBefore', ['version.dll'])]:
            value, observed = static_loading_fixture();observed['compilerEnvironment'][field] = bad
            with self.subTest(field=field), self.assertRaisesRegex(private.Denied, 'PRIVATE_STATIC_CWD'):
                private.inspect_static_loading(value, RAW, observed)
        for tracking in ('', 'fixture\n', 'x' * 129, None):
            value, observed = static_loading_fixture()
            observed['compilerEnvironment']['values']['RUNNER_TRACKING_ID'] = tracking
            with self.subTest(tracking=tracking), self.assertRaisesRegex(private.Denied, 'PRIVATE_STATIC_TRACKING'):
                private.inspect_static_loading(value, RAW, observed)

    def test_matching_static_observations_and_changed_gate_still_cannot_prepare_job(self):
        value, observed = static_loading_fixture()
        self.assertTrue(private.inspect_static_loading(value, RAW, observed)['staticPolicyProjectionMatches'])
        with patch.object(private, 'PRIVATE_QUALIFICATION_ADMITTED', True):
            with self.assertRaisesRegex(private.Denied, 'PRIVATE_EXECUTION_CLOSED'):
                private.prepare_for_job(value, RAW, observed)


class PrivateOutputVerifierTests(unittest.TestCase):
    def test_both_image_projections_match_but_never_qualify_defaults_job_or_execution(self):
        for image in POLICY['images']:
            value, observed = output_fixture(image)
            with patch.object(inert_fixtures.engine, 'load_profile', side_effect=AssertionError('IO')), \
                 patch('builtins.open', side_effect=AssertionError('IO')):
                result = inspect_outputs(value, observed)
            self.assertEqual(len(result['partitionAllocMacros']), 61)
            for field in ('policyMinimumsMet', 'completeMacroInventoryMatches', 'evaluatedMetadataProjectionMatches'):
                self.assertIs(result[field], True)
            for field in ('executionAdmitted', 'fullArm64DefaultsQualified', 'processProvenanceVerified',
                          'liveJobCapability', 'outputsExecuted', 'generatedSecurityHeadersVerified',
                          'sdkBuilt', 'nativeAcceptance'):
                self.assertIs(result[field], False)
            self.assertTrue(result['coff']['structureOnly'])
            self.assertFalse(result['pe']['outputExecuted'])
            self.assertFalse(result['literalArguments']['evaluatedGnVerified'])

    def test_json_duplicate_utf8_bom_depth_bounds_and_constants_denied(self):
        cases = [b'{"same":1,"same":2}', b'\xff', b'\xef\xbb\xbf[]', b'[NaN]',
                 b'[' * 1200 + b']' * 1200, b'x' * (4 * 1024**2 + 1), b'[]\0']
        for raw in cases:
            with self.subTest(case=raw[:20]), self.assertRaises(private.Denied):
                private.bounded_json(raw)

    def test_evaluated_current_false_is_not_replaced_with_default_true(self):
        _, observed = output_fixture()
        rows = json.loads(observed['gnArgs'])
        rows[0]['current'] = {'value': 'false'}
        with self.assertRaisesRegex(private.Denied, 'PRIVATE_GN_ARG_CRITICAL'):
            private.inspect_evaluated_args(json_bytes(rows))
        rows[0]['default']['value'] = 'false'; rows[0]['current']['value'] = 'true'
        self.assertTrue(private.inspect_evaluated_args(json_bytes(rows))['criticalDeclaredValuesMatch'])
        target = next(row for row in rows if row['name'] == 'target_cpu')
        target.update(default={'value': '""'}, current={'value': '"arm64"'})
        self.assertEqual(private.inspect_evaluated_args(json_bytes(rows))['values']['target_cpu'], '"arm64"')

    def test_gn_arguments_require_exact_short_schema_strings_names_and_critical_set(self):
        _, observed = output_fixture()
        for change in ('missing', 'duplicate', 'extra-field', 'long-schema', 'typed-bool', 'expression', 'cpu'):
            rows = json.loads(observed['gnArgs'])
            if change == 'missing': rows.pop()
            elif change == 'duplicate': rows.append(rows[0])
            elif change == 'extra-field': rows[0]['comment'] = 'not --short'
            elif change == 'long-schema': rows[0]['default']['file'] = '//other'
            elif change == 'typed-bool': rows[0]['default']['value'] = True
            elif change == 'expression': rows[0]['default']['value'] = 'true || false'
            elif change == 'cpu': rows.append({'name': 'target_cpu', 'default': {'value': '"x64"'}})
            with self.subTest(change=change), self.assertRaises(private.Denied):
                private.inspect_evaluated_args(json_bytes(rows))
        rows = json.loads(observed['gnArgs'])
        self.assertEqual(private.inspect_evaluated_args(json_bytes(rows))['values']['host_cpu'], '"x64"')
        rows.pop()
        with self.assertRaisesRegex(private.Denied, 'PRIVATE_GN_ARG_CPU'):
            private.inspect_evaluated_args(json_bytes(rows))

    def test_gn_actions_reject_label_toolchain_type_script_args_output_input_and_deps_changes(self):
        for role in ('partitionAlloc', 'cefConfig'):
            for field, bad in [('toolchain', '//build/toolchain/win:win_clang_x64'),
                    ('type', 'action_foreach'), ('script', '//other.py'), ('args', ['--run']),
                    ('outputs', ['//out/Release_GN_arm64/../else.h']), ('outputs', []),
                    ('deps', []), ('testonly', True), ('metadata', {'hook': ['other']})]:
                _, observed = output_fixture()
                _, top, node = action(observed, role);node[field] = bad
                with self.subTest(role=role, field=field), self.assertRaises(private.Denied):
                    private.inspect_action_desc(json_bytes(top), role, RAW, BASE_RAW)
            _, observed = output_fixture();key, top, node = action(observed, role)
            label = next(iter(top))
            top[label + '(//other:toolchain)'] = top.pop(label)
            with self.assertRaisesRegex(private.Denied, 'PRIVATE_GN_DESC_LABEL'):
                private.inspect_action_desc(json_bytes(top), role, RAW, BASE_RAW)
        for extra in ('depfile', 'sources', 'data', 'configs', 'gen_deps', 'validations'):
            _, observed = output_fixture();_, top, node = action(observed)
            node[extra] = []
            with self.subTest(extra=extra), self.assertRaisesRegex(private.Denied, 'PRIVATE_GN_DESC_FIELDS'):
                private.inspect_action_desc(json_bytes(top), 'partitionAlloc', RAW, BASE_RAW)
        _, observed = output_fixture();_, top, node = action(observed, 'cefConfig')
        node['inputs'] = ['//out/else/args.gn']
        with self.assertRaisesRegex(private.Denied, 'PRIVATE_GN_DESC_COMMAND'):
            private.inspect_action_desc(json_bytes(top), 'cefConfig', RAW, BASE_RAW)

    def test_all_61_evaluated_flags_exact_order_domain_and_count_required(self):
        for change in ('missing', 'extra', 'order', 'numeric-bool', 'negative-size', 'large-size', 'expression'):
            _, observed = output_fixture();_, top, node = action(observed)
            flags = node['response_file_contents']
            if change == 'missing': flags.pop()
            elif change == 'extra': flags.append('UNKNOWN=true')
            elif change == 'order': flags[1], flags[2] = flags[2], flags[1]
            elif change == 'numeric-bool': flags[1] = 'ENABLE_USER_SPACE_ZERO_SEGMENT=1'
            elif change == 'negative-size': flags[2] = 'USER_SPACE_ZERO_SEGMENT_SIZE_MB=-1'
            elif change == 'large-size': flags[2] = 'USER_SPACE_ZERO_SEGMENT_SIZE_MB=2147483648'
            elif change == 'expression': flags[1] += ' || true'
            with self.subTest(change=change), self.assertRaises(private.Denied):
                private.inspect_action_desc(json_bytes(top), 'partitionAlloc', RAW, BASE_RAW)

    def test_actual_inventory_is_compared_not_a_guessed_arm_default_table(self):
        value, observed = output_fixture()
        key, top, node = action(observed)
        node['response_file_contents'][1] = 'ENABLE_USER_SPACE_ZERO_SEGMENT=true'
        observed[key] = json_bytes(top)
        with self.assertRaisesRegex(private.Denied, 'PRIVATE_PA_DESC_HEADER_MISMATCH'):
            inspect_outputs(value, observed)
        raw = observed['files']['partitionAlloc']['raw'].replace(
            b'ENABLE_USER_SPACE_ZERO_SEGMENT() (0)', b'ENABLE_USER_SPACE_ZERO_SEGMENT() (1)')
        replace_file(observed, 'partitionAlloc', raw)
        result = inspect_outputs(value, observed)
        self.assertEqual(result['partitionAllocMacros']['ENABLE_USER_SPACE_ZERO_SEGMENT'], 1)
        self.assertFalse(result['fullArm64DefaultsQualified'])

    def test_matching_gn_header_values_still_must_meet_policy_minimums(self):
        value, observed = output_fixture();key, top, node = action(observed)
        index = BASE_POLICY['partitionAllocMacros'].index('USE_RAW_PTR_BACKUP_REF_IMPL') + 1
        node['response_file_contents'][index] = 'USE_RAW_PTR_BACKUP_REF_IMPL=false'
        observed[key] = json_bytes(top)
        replace_file(observed, 'partitionAlloc', observed['files']['partitionAlloc']['raw'].replace(
            b'USE_RAW_PTR_BACKUP_REF_IMPL() (1)', b'USE_RAW_PTR_BACKUP_REF_IMPL() (0)'))
        with self.assertRaisesRegex(private.Denied, 'PRIVATE_PA_SECURITY_MINIMUM'):
            inspect_outputs(value, observed)

    def test_literal_evaluated_mismatch_and_exact_cef_generator_input_denied(self):
        for literal, evaluated in [('true', 'false'), ('27', '28'), ('"space value"', '"other value"')]:
            value, observed = output_fixture()
            raw = observed['files']['args']['raw'] + ('extra_flag=' + literal + '\n').encode()
            replace_file(observed, 'args', raw);value['bindings']['args'] = observed['files']['args']['pin']
            rows = json.loads(observed['gnArgs'])
            rows.append({'name': 'extra_flag', 'default': {'value': evaluated}})
            observed['gnArgs'] = json_bytes(rows)
            with self.subTest(literal=literal), self.assertRaisesRegex(private.Denied, 'PRIVATE_LITERAL_EVALUATED_MISMATCH'):
                inspect_outputs(value, observed)
        value, observed = output_fixture()
        raw = observed['files']['args']['raw'].replace(b'target_cpu="arm64"', b'target_cpu = "arm64"')
        replace_file(observed, 'args', raw);value['bindings']['args'] = observed['files']['args']['pin']
        with self.assertRaisesRegex(private.Denied, 'PRIVATE_CEF_GENERATOR_CPU_LINE'):
            inspect_outputs(value, observed)

    def test_source_graph_tools_and_policy_denied_before_optional_parser_import(self):
        for field in ('source', 'graph', 'tool', 'policy'):
            value, observed = output_fixture()
            candidate_policy = BASE_RAW
            if field == 'source': value['source']['sourceId'] = 'b' * 64
            elif field == 'graph': value['bindings']['graph']['path'] += '/alias'
            elif field == 'tool': value['bindings']['tools']['clang']['sha256'] = 'b' * 64
            else: candidate_policy += b' '
            with self.subTest(field=field), patch('builtins.__import__', side_effect=AssertionError('import')):
                with self.assertRaises(private.Denied):
                    private.inspect_private_outputs(value, RAW, candidate_policy, observed,
                                                    wall_now=200, monotonic_now=200)

    def test_file_alias_hash_size_and_args_replacement_denied_before_optional_parsers(self):
        for role in ('args', 'partitionAlloc', 'cefConfig', 'coff', 'pe'):
            for field, bad in [('path', ROOT + '/alias'), ('bytes', True), ('sha256', 'b' * 64)]:
                value, observed = output_fixture();observed['files'][role]['pin'][field] = bad
                with self.subTest(role=role, field=field), patch('builtins.__import__',
                        side_effect=AssertionError('import')), self.assertRaises(private.Denied):
                    inspect_outputs(value, observed)
        value, observed = output_fixture();replace_file(observed, 'args', observed['files']['args']['raw'] + b'\n')
        with self.assertRaisesRegex(private.Denied, 'PRIVATE_OUTPUT_ARGS_CHANGED'):
            inspect_outputs(value, observed)

    def test_header_coff_pe_target_import_and_truncation_ambiguities_denied(self):
        for role, raw in [('cefConfig', inert_fixtures.CEF.replace(b'SANDBOX 1', b'SANDBOX 0')),
                ('partitionAlloc', inert_fixtures.pa_header() + b'#include "extra.h"\n'),
                ('coff', b'\x64\x86' + inert_fixtures.coff()[2:]), ('coff', inert_fixtures.coff()[:30]),
                ('pe', inert_fixtures.pe()[:450])]:
            value, observed = output_fixture();replace_file(observed, role, raw)
            with self.subTest(role=role, rawlen=len(raw)), self.assertRaises(private.Denied):
                inspect_outputs(value, observed)
        import struct
        for offset, number in [(132, 0x8664), (152, 0x10b), (272, 0x1000), (152 + 112 + 13 * 8, 0x1000)]:
            value, observed = output_fixture();raw = bytearray(inert_fixtures.pe())
            struct.pack_into('<H' if offset in (132, 152) else '<I', raw, offset, number)
            replace_file(observed, 'pe', bytes(raw))
            with self.subTest(offset=offset), self.assertRaises(private.Denied):
                inspect_outputs(value, observed)


class FixedProbeSourceTests(unittest.TestCase):
    def test_fixed_source_pin_and_planned_closure_match_but_source_is_uncompiled(self):
        raw = (HERE / 'compiler_input_probe.cc').read_bytes()
        result = private.inspect_probe_source(raw, RAW)
        self.assertEqual(POLICY['sourcePaths'].count(result['path']), 1)
        self.assertEqual(result['path'], 'native/windows-arm-full-sdk/compiler_input_probe.cc')
        argv = private.command_projection('qual-clang-probe', context(), RAW, wall_now=200, monotonic_now=200)['argv']
        self.assertEqual(argv[-1], ROOT.split('/.artifacts/')[0] + '/' + result['path'])
        self.assertEqual(result['entry'], 'sorng_arm64_qualification_entry')
        for field in ('sourceBytesVerifiedInOwnedTree', 'compiled', 'linked', 'outputsExecuted',
                      'fullArm64DefaultsQualified', 'executionAdmitted'):
            self.assertIs(result[field], False)
        self.assertFalse((HERE.parents[1] / POLICY['workflow']).exists())
        self.assertEqual(POLICY['sourceClosureStatus'], 'planned-files-incomplete')

    def test_probe_consumes_exact_existing_minimums_and_no_new_arm_default_table(self):
        import re
        text = (HERE / 'compiler_input_probe.cc').read_text(encoding='utf8')
        observed = re.findall(r'static_assert\(PA_BUILDFLAG\(([A-Z0-9_]+)\) == ([01]),', text)
        expected = {**BASE_POLICY['explicitArgumentInvariants'], **BASE_POLICY['securityPolicyMinimums']}
        self.assertEqual(len(observed), len(expected))
        self.assertEqual(dict((name, int(value)) for name, value in observed), expected)
        self.assertEqual(re.findall(r'^#include (.+)$', text, re.M),
                         ['"partition_alloc/buildflags.h"', '"cef/include/cef_config.h"'])
        self.assertIn('static_assert(CEF_V8_ENABLE_SANDBOX == 1,', text)
        self.assertIn('static_assert(sizeof(void*) == 8,', text)
        self.assertIn('sizeof(int) == 4 && sizeof(long) == 4 && sizeof(long long) == 8', text)
        for macro in ('__clang__', '_MSC_VER', '_WIN32', '_WIN64', '_M_ARM64', '__aarch64__'):
            self.assertIn('!defined(' + macro + ')', text)
        for macro in ('_M_ARM64EC', '__arm64ec__', '_M_X64', '_M_AMD64', '_M_IX86', '__x86_64__', '__i386__'):
            self.assertIn('defined(' + macro + ')', text)
        self.assertRegex(text, r'extern "C" int ' + POLICY['probeEntry'] + r'\(\) noexcept \{\s*return 0;\s*\}\s*\Z')
        # No input can supply an alternate include, entry, CRT directive or
        # runtime helper: the whole fixed source pin below rejects mutations.
        self.assertNotRegex(text, r'(?m)^\s*#(?:define|undef|pragma)\b')

    def test_changed_target_minimum_include_entry_or_trailing_code_cannot_match_source_pin(self):
        raw = (HERE / 'compiler_input_probe.cc').read_bytes()
        candidates = [raw + b'\n', bytearray(raw), b'',
            raw.replace(b'!defined(_M_ARM64)', b'!defined(_M_X64)'),
            raw.replace(b'PA_BUILDFLAG(USE_RAW_PTR_BACKUP_REF_IMPL) == 1',
                        b'PA_BUILDFLAG(USE_RAW_PTR_BACKUP_REF_IMPL) == 0'),
            raw.replace(b'"cef/include/cef_config.h"', b'<windows.h>'),
            raw.replace(b'sorng_arm64_qualification_entry', b'main'),
            raw + b'\n#pragma comment(lib, "msvcrt")\n']
        for candidate in candidates:
            with self.subTest(size=len(candidate)), self.assertRaisesRegex(private.Denied, 'PRIVATE_PROBE_SOURCE_PIN'):
                private.inspect_probe_source(candidate, RAW)


class PrivatePreparationTests(unittest.TestCase):
    def test_profile_is_exact_immutable_pin_and_incomplete(self):
        self.assertEqual(hashlib.sha256(RAW).hexdigest(), private.PROFILE_SHA256)
        self.assertEqual(len(POLICY['sourcePaths']), 105)
        self.assertEqual(len(set(POLICY['sourcePaths'])), 105)
        self.assertEqual(POLICY['crlfPositions'], [0, 10, 11, 20, 104])
        self.assertFalse(POLICY['privateAuthorityAdmitted'])
        self.assertFalse(POLICY['workflowActivation'])
        self.assertEqual(POLICY['sourceClosureStatus'], 'planned-files-incomplete')
        for raw in (RAW + b' ', bytearray(RAW), b'{}', b'x' * 65537):
            with self.subTest(raw_type=type(raw).__name__), self.assertRaises(private.Denied):
                private.parse_profile(raw)

    def test_old_mode_and_wrong_scope_denied_before_policy_parse_or_optional_import(self):
        fields = {'mode': ('source-gn', 'image-qualified-source-gn'),
                  'ref': ('refs/heads/main',), 'workflow': ('.github/workflows/ci.yml',),
                  'repository': ('private/repo',), 'repositoryId': ('1',),
                  'visibility': ('private', 'internal'), 'event': ('push',)}
        for key, values in fields.items():
            for value in values:
                candidate = context();candidate[key] = value
                with self.subTest(key=key, value=value), patch.object(private, 'parse_profile',
                        side_effect=AssertionError('profile touched')), patch('builtins.__import__',
                        side_effect=AssertionError('optional import touched')):
                    with self.assertRaisesRegex(private.Denied, 'PRIVATE_MODE_SCOPE'):
                        private.prepare_for_job(candidate, object())

    def test_correct_projection_or_report_cannot_grant_execution_even_if_flag_changes(self):
        good = context()
        self.assertTrue(inspect(good)['projectionMatches'])
        with patch.object(private, 'PRIVATE_QUALIFICATION_ADMITTED', True), patch.object(private,
                'parse_profile', side_effect=AssertionError('profile touched')):
            for args in ((good,), (good, RAW, {'sourceGnSucceeded': True, 'approval': True})):
                with self.assertRaisesRegex(private.Denied, 'PRIVATE_EXECUTION_CLOSED'):
                    private.prepare_for_job(*args)

    def test_both_exact_images_have_non_authorizing_projection(self):
        for image in POLICY['images']:
            result = inspect(context(image))
            self.assertFalse(result['executionAdmitted'])
            self.assertFalse(result['liveJobCapability'])
            self.assertFalse(result['sourceBytesVerified'])
            self.assertIn('matching-reviewed-system-image-and-static-tool-projections', result['missing'])

    def test_wrong_host_image_head_source_root_and_extra_fields_denied(self):
        cases = [('image', '20261031.000.0'), ('host', {'platform': 'win32', 'architecture': 'arm64',
                    'runner': 'windows-2025-vs2026'}), ('head', 'b' * 40),
                 ('root', ROOT + '/..'), ('root', ROOT.replace('4cde', '1cde')),
                 ('source', {**context()['source'], 'sourceId': 'a' * 64}),
                 ('source', {**context()['source'], 'cef': 'b' * 40}), ('permission', True)]
        for key, value in cases:
            candidate = context();candidate[key] = value
            with self.subTest(key=key), self.assertRaises(private.Denied):
                inspect(candidate)

    def test_source_tuple_order_cardinality_hash_and_encoding_bound(self):
        for change in ('reverse', 'drop', 'extra', 'hash', 'encoding', 'bool-size', 'canonical', 'digest'):
            candidate = context();rows = candidate['sources']
            if change == 'reverse': rows.reverse()
            elif change == 'drop': rows.pop()
            elif change == 'extra': rows.append(copy.deepcopy(rows[-1]))
            elif change == 'hash': rows[5]['sha256'] = 'z' * 64
            elif change == 'encoding': rows[5]['encoding'] = 'git-crlf'
            elif change == 'bool-size': rows[5]['bytes'] = True
            elif change == 'canonical': rows[5]['canonicalSha256'] = 'b' * 64
            candidate['sourceDigest'] = private.digest(private.canonical(rows))
            if change == 'digest': candidate['sourceDigest'] = 'f' * 64
            with self.subTest(change=change), self.assertRaises(private.Denied):
                inspect(candidate)

    def test_only_exact_yaml_and_node_crlf_positions_are_projectable_not_byte_verified(self):
        candidate = context()
        for index in POLICY['crlfPositions']:
            row = candidate['sources'][index]
            row.update(bytes=2, sha256='b' * 64, encoding='git-crlf')
        candidate['sourceDigest'] = private.digest(private.canonical(candidate['sources']))
        self.assertFalse(inspect(candidate)['sourceBytesVerified'])

    def test_graph_args_and_every_tool_pin_cannot_be_substituted(self):
        changes = [('args', 'path', 'C:/outside/args.gn'), ('graph', 'path', ROOT + '/other.ninja'),
                   ('graphInventory', 'files', 50001), ('graphInventory', 'visited', 0),
                   ('graphInventory', 'sha256', 'z' * 64)]
        for role, key, value in changes:
            candidate = context();candidate['bindings'][role][key] = value
            with self.subTest(role=role, key=key), self.assertRaises(private.Denied): inspect(candidate)
        for role in POLICY['tools']:
            candidate = context();candidate['bindings']['tools'][role]['sha256'] = 'f' * 64
            with self.subTest(role=role), self.assertRaisesRegex(private.Denied, 'PRIVATE_TOOL_PIN'):
                inspect(candidate)

    def test_both_original_clocks_clamp_work_reserves_without_extension(self):
        self.assertEqual(inspect(context())['budget'], {'workSeconds': 850, 'cleanupSeconds': 30,
            'finalReserveSeconds': 120, 'originalRemainingSeconds': 1000})
        self.assertEqual(private.phase_budget(7200, 7200, 0, 0)['workSeconds'], 900)
        self.assertEqual(private.phase_budget(1000, 300, 0, 100)['workSeconds'], 50)
        for ends in ((150, 150, 0, 0), (7201, 7201, 0, 0), (1000, 1, 0, 1),
                     (float('inf'), 10, 0, 0), (True, 1000, 0, 0), (1000, float('nan'), 0, 0)):
            with self.subTest(ends=ends), self.assertRaises(private.Denied): private.phase_budget(*ends)

    def test_fixed_six_commands_use_pinned_labels_and_json_flags(self):
        plans = [private.command_projection(role, context(), RAW, wall_now=200, monotonic_now=200)
                 for role in private.ROLES]
        for index in (0, 1):
            self.assertEqual(plans[index]['argv'][1:], ['desc', ROOT +
                '/source-checkout/src/out/Release_GN_arm64', POLICY['generatedInputs'][index]['label'],
                '--format=json'])
        self.assertEqual(plans[2]['argv'][1:], ['args', ROOT +
            '/source-checkout/src/out/Release_GN_arm64', '--list', '--json', '--short'])

    def test_fixed_siso_headers_not_all_or_unsupported_ninja_j_or_remote(self):
        plan = private.command_projection('qual-generate-headers', context(), RAW, wall_now=200, monotonic_now=200)
        self.assertEqual(plan['argv'][1:5], ['ninja', '--offline', '-local_jobs=1', '-C'])
        self.assertEqual(plan['argv'][-2:], [row['relativeOutput'] for row in POLICY['generatedInputs']])
        self.assertNotIn('-j1', plan['argv'])
        self.assertFalse(plan['executionAdmitted'])

    def test_fixed_probe_has_no_crt_no_default_search_and_no_arm_execution(self):
        compile_plan = private.command_projection('qual-clang-probe', context(), RAW, wall_now=200, monotonic_now=200)
        link_plan = private.command_projection('qual-link-probe', context(), RAW, wall_now=200, monotonic_now=200)
        for arg in ('--target=aarch64-pc-windows-msvc', '/c', '/X', '/GS', '/Zl', '/clang:-nostdinc'):
            self.assertIn(arg, compile_plan['argv'])
        for arg in ('/lldignoreenv', '/nodefaultlib', '/machine:arm64', '/manifest:no'):
            self.assertIn(arg, link_plan['argv'])
        self.assertEqual(link_plan['argv'][-1], ROOT + '/private-qualification/probe.obj')
        self.assertTrue(link_plan['argv'][0].endswith('/lld-link.exe'))
        self.assertFalse(link_plan['outputsExecuted'])
        self.assertFalse(link_plan['actualLoaderClosureApproved'])
        for role in ('source-gn', 'compile', 'siso-all', '--help', None):
            with self.assertRaises(private.Denied):
                private.command_projection(role, context(), RAW, wall_now=200, monotonic_now=200)

    def test_unknown_lld_bytes_deny_before_optional_pe_parser_import(self):
        with patch('builtins.__import__', side_effect=AssertionError('parser import touched')):
            for raw in (b'MZ', b'', bytearray(b'MZ'), object()):
                with self.assertRaisesRegex(private.Denied, 'PRIVATE_LLD_PIN'):
                    private.inspect_lld_bytes(raw, RAW)

    def test_static_lld_evidence_is_explicitly_unreviewed_and_not_loader_proof(self):
        expected = POLICY['lldStaticCandidate']
        self.assertEqual(expected['bytes'], 74617856)
        self.assertEqual(expected['imports'], ['KERNEL32.dll', 'ADVAPI32.dll', 'ntdll.dll', 'OLEAUT32.dll'])
        self.assertEqual(expected['delayImports'], ['ole32.dll', 'SHELL32.dll'])
        self.assertFalse(expected['staticProjectionReviewed'])
        self.assertFalse(expected['actualLoaderClosureApproved'])
        self.assertFalse(expected['system32ByteSetProven'])
        self.assertFalse(POLICY['environmentContractApproved'])

    def test_planned_closure_preserves_existing_94_and_kernel_not_authorized(self):
        import checkpoint
        self.assertEqual(tuple(POLICY['sourcePaths'][:94]), checkpoint.IMAGE_QUALIFIED_PATHS)
        # Existing checkpoint/Job command guard does not accept this new tuple.
        import inspect as python_inspect
        source = python_inspect.getsource(checkpoint.closed_sources)
        self.assertIn('(11,16,62,94)', source)
        self.assertEqual(POLICY['jobContract']['foundationSha256'],
                         '92a16bb6c4308552bccf0cacf107261a910d218e0bf595a5d3afac31d5d14d80')

    def test_source_driver_single_job_argv_is_fixed_and_new_adapter_always_denies(self):
        expected = [POLICY['driverNode']['path'], '--disable-proto=throw', '--no-addons',
                    ROOT.split('/.artifacts/')[0] + '/native/windows-arm-full-sdk/private-source-driver.mjs',
                    '--private-source-gn', ROOT, 'a' * 64, '--execute']
        self.assertEqual(private.source_driver_argv(ROOT, 'a' * 64, RAW), expected)
        for value in ('a' * 63, 'A' * 64, None, '../context.json'):
            with self.assertRaises(private.Denied): private.source_driver_argv(ROOT, value, RAW)
        with patch.object(private, 'parse_profile', side_effect=AssertionError('policy touched')):
            with self.assertRaisesRegex(private.Denied, 'PRIVATE_EXECUTION_CLOSED'):
                private.approve_source_job_command(expected, ROOT, context())
            with self.assertRaisesRegex(private.Denied, 'PRIVATE_MODE_SCOPE'):
                private.approve_source_job_command(expected, ROOT, {'mode': 'source-gn'})

    def test_actual_job_admission_denies_all_old_modes_before_new_optional_import(self):
        import producer
        tree = ast.parse((HERE / 'job.py').read_bytes())
        function = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and
                        node.name == 'approved_tool_command')
        real_import = builtins.__import__
        for mode in ('input-closure', 'command-inventory', 'source-gn', producer.PREFLIGHT_MODE,
                     producer.CURRENT_MODE, producer.REVIEWED_MODE, producer.IMAGE_MODE, private.MODE):
            seen = []
            def import_checked(name, *args, **kwargs):
                if name == 'private_qualification':
                    seen.append(name)
                    raise AssertionError('private module imported under unadmitted mode')
                return real_import(name, *args, **kwargs)
            def unreachable(*args, **kwargs):
                raise AssertionError('tool/environment boundary reached')
            fake = types.ModuleType('producer')
            fake.verified_sources = lambda root: ({'mode': mode}, {}, None)
            fake.role_in_mode = producer.role_in_mode
            fake.closed_worker_command = unreachable
            namespace = {'Path': Path, 'load_profile': unreachable, 'environment': unreachable}
            exec(compile(ast.Module(body=[function], type_ignores=[]), '<actual-job-admission>', 'exec'), namespace)
            with self.subTest(mode=mode), patch.dict(sys.modules, {'producer': fake}), \
                    patch('builtins.__import__', side_effect=import_checked):
                with self.assertRaisesRegex(producer.data.Denied, 'FULL_(?:ROLE_MODE|MODE)'):
                    namespace['approved_tool_command'](private.source_driver_argv(ROOT, 'a' * 64, RAW), ROOT)
                self.assertEqual(seen, [])

    def test_job_kernel_and_old_admission_are_exact_after_removing_one_closed_branch(self):
        tree = ast.parse((HERE / 'job.py').read_bytes())
        functions = {node.name: node for node in tree.body if isinstance(node, ast.FunctionDef)}
        for name, expected in {
            'run_job': 'f27430844c58da35e566d19f2a1da15a8fc15ea62cad62b61cbe4d4a5c58977f',
            'launch_environment': '57a3c32658aa4fb08da11dd646d3fde1f9f6e94806f56637f82630ccd3fa6a4b',
        }.items():
            self.assertEqual(private.digest(ast.dump(functions[name]).encode()), expected)
        old = functions['approved_tool_command']
        first = old.body[1]
        self.assertIsInstance(first, ast.If)
        branch = first.orelse[0]
        self.assertIn("argv[4] == '--private-source-gn'", ast.unparse(branch.test))
        self.assertEqual([ast.unparse(node) for node in branch.body], [
            'c, p, _ = verified_sources(Path(cwd))', "role_in_mode('private-source-gn', c)",
            'import private_qualification',
            'role = private_qualification.approve_source_job_command(argv, cwd, c)'])
        first.orelse = branch.orelse
        self.assertEqual(private.digest(ast.dump(old).encode()),
                         '0b11cf7cd85d1e6f6ab33aeca5fa0ab1bb1f237ba9321a6e5fb6dafb3f521fb3')


def static_import_fixture():
    """Bounded synthetic PE; no image is loaded, linked or executed."""
    import struct
    raw = bytearray(2048)
    raw[:2] = b'MZ'
    struct.pack_into('<I', raw, 60, 128)
    raw[128:132] = b'PE\0\0'
    struct.pack_into('<HH', raw, 132, 0x8664, 1)
    struct.pack_into('<H', raw, 148, 240)
    struct.pack_into('<H', raw, 152, 0x20b)
    struct.pack_into('<I', raw, 212, 512)
    struct.pack_into('<I', raw, 260, 16)
    struct.pack_into('<II', raw, 272, 0x1000, 40)
    struct.pack_into('<II', raw, 368, 0x1040, 64)
    struct.pack_into('<III', raw, 404, 0x1000, 1536, 512)
    struct.pack_into('<I', raw, 524, 0x1100)
    struct.pack_into('<II', raw, 576, 1, 0x1140)
    raw[768:781] = b'KERNEL32.dll\0'
    raw[832:844] = b'SHELL32.dll\0'
    return bytes(raw)


class JoinedStaticReferenceTests(unittest.TestCase):
    def test_reference_pe_imports_and_delay_format(self):
        import extract
        actual = extract.pe_metadata(static_import_fixture())
        self.assertEqual(actual['machine'], 0x8664)
        self.assertEqual(actual['imports'], ['KERNEL32.dll'])
        self.assertEqual(actual['delayImports'], ['SHELL32.dll'])
        changed = bytearray(static_import_fixture())
        changed[576:580] = b'\0\0\0\0'
        with self.assertRaisesRegex(extract.Denied, 'INV_PE_DELAY_FORMAT'):
            extract.pe_metadata(changed)

    def test_new_readers_joiners_have_no_entry_or_source_run_issuer(self):
        text = (HERE / 'private-source-driver.mjs').read_text(encoding='utf-8')
        self.assertEqual(text.count('qualificationSourceRuns.set('), 0)
        self.assertIn('export const PRIVATE_DRIVER_ADMITTED = false;', text)
        self.assertIn('throw new Error("PRIVATE_QUALIFICATION_EXECUTOR_CLOSED")', text)
        for name in ('createQualificationSession', 'issueActualObservation', 'runFixedJoined'):
            self.assertNotIn('export function ' + name, text)
            self.assertNotIn('export async function ' + name, text)
        # Expected BUILD bytes are from the separately audited patched tree.
        self.assertIn('2999ed43e4bddb47d841c6b0587cfdacf9a9b331a06384f27ef896a0ef24fae0', text)
        self.assertIn('e69e4d0dbd0484dda0f8cd2a69bda78be262e8050bfc6c486e831a6bf1b4eb15', text)


if __name__ == '__main__':
    unittest.main()
