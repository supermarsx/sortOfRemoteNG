"""Candidate parser/planner denials only. No compiler, linker, GN or Job runs."""
import copy
import hashlib
import json
from pathlib import Path
import struct
import sys
import tempfile
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import engine_qualification as engine

POLICY = engine.load_profile()
ROOT = 'D:/a/sortOfRemoteNG/sortOfRemoteNG/.artifacts/windows-arm-full-sdk-01234567-89ab-4cde-8123-456789abcdef'


def pin(path, raw):
    return {'path':path, 'bytes':len(raw), 'sha256':hashlib.sha256(raw).hexdigest()}


def args():
    return b'''target_cpu="arm64"
host_cpu="x64"
is_clang=true
use_lld=true
use_remoteexec=false
use_siso=true
is_component_build=false
is_debug=false
enable_backup_ref_ptr_instance_tracer=false
'''


def request(image='20261030.294.1'):
    selected = POLICY['images'][image]
    tools = {}
    for role, expected in POLICY['tools'].items():
        tools[role] = {'path':expected.get('path') or ROOT + '/' + expected['relativePath'],
                       # LLD size here is synthetic metadata; it remains an
                       # explicit missing execution fact, never a reviewed pin.
                       'bytes':expected['bytes'] or 100000, 'sha256':expected['sha256']}
    out = ROOT + '/source-checkout/src/out/Release_GN_arm64'
    return {'kind':'windows-arm-compiler-input-request', 'mode':POLICY['mode'], 'ref':POLICY['ref'],
            'repository':POLICY['repository'], 'repositoryId':POLICY['repositoryId'],
            'visibility':'public', 'event':'workflow_dispatch', 'host':copy.deepcopy(POLICY['host']),
            'image':image, 'root':ROOT, 'source':{'target':POLICY['target'], 'sourceId':selected['sourceId'],
                'profileSha256':selected['profileSha256'], 'chromium':POLICY['chromium'], 'cef':POLICY['cef']},
            'bindings':{'args':pin(out + '/args.gn',args()), 'graph':pin(out + '/build.ninja',b'synthetic graph\n'),
                'graphInventory':{'files':2,'bytes':100,'visited':2,'sha256':'a'*64}, 'tools':tools},
            'remainingMs':600000}


def pa_header():
    macros = {name:0 for name in POLICY['partitionAllocMacros']}
    macros.update(POLICY['explicitArgumentInvariants'])
    macros.update(POLICY['securityPolicyMinimums'])
    lines = ['// Synthetic parser fixture, not an observed ARM64 generated header',
             '#ifndef ' + engine.PA_GUARD, '#define ' + engine.PA_GUARD,
             '#include "partition_alloc/buildflag.h"']
    lines += ['#define PA_BUILDFLAG_INTERNAL_%s() (%d)' % row for row in macros.items()]
    return ('\n'.join(lines) + '\n#endif\n').encode()


CEF = b'''/* Synthetic fixture only. */
#ifndef CEF_INCLUDE_CEF_CONFIG_H_
#define CEF_INCLUDE_CEF_CONFIG_H_
#define CEF_V8_ENABLE_SANDBOX 1
#endif
'''


def candidates(value):
    out = value['root'] + '/source-checkout/src/out/Release_GN_arm64'
    files = {'args':{'raw':args(), 'pin':copy.deepcopy(value['bindings']['args'])}}
    for row in POLICY['generatedInputs']:
        raw = pa_header() if row['role'] == 'partitionAlloc' else CEF
        files[row['role']] = {'raw':raw, 'pin':pin(out + '/' + row['relativeOutput'],raw)}
    return files


def coff():
    raw = bytearray(76)
    struct.pack_into('<HHIIIHH', raw, 0, 0xaa64,1,0,0,0,0,0)
    raw[20:28] = b'.text\0\0\0'
    struct.pack_into('<II', raw, 36,16,60)
    struct.pack_into('<I', raw, 56,0x60000020)
    return bytes(raw)


def pe():
    raw = bytearray(1024)
    raw[:2] = b'MZ';struct.pack_into('<I',raw,0x3c,128)
    raw[128:132] = b'PE\0\0'
    struct.pack_into('<HHIIIHH',raw,132,0xaa64,1,0,0,0,240,0x22)
    struct.pack_into('<H',raw,152,0x20b)
    struct.pack_into('<I',raw,168,0x1000)
    struct.pack_into('<H',raw,220,3)
    struct.pack_into('<I',raw,260,16)
    raw[392:400]=b'.text\0\0\0'
    struct.pack_into('<IIII',raw,400,16,0x1000,16,512)
    struct.pack_into('<I',raw,428,0x60000020)
    return bytes(raw)


class Policy(unittest.TestCase):
    def test_fixed_policy_has_primary_pins_and_no_execution_or_runtime_permission(self):
        self.assertFalse(engine.EXECUTION_ADMITTED)
        self.assertFalse(POLICY['executionAdmitted'])
        self.assertEqual(len(POLICY['partitionAllocMacros']),61)
        self.assertEqual(len(POLICY['primarySources']),8)
        for row in POLICY['primarySources']:
            self.assertRegex(row['url'],r'^https://raw\.githubusercontent\.com/(?:chromium/chromium/a654841425914cbb703a2931e07b70a83aedbafd|chromiumembedded/cef/682c378d70d5780061e96644dca16ddd8fd157a9)/')
            self.assertRegex(row['sha256'],r'^[a-f0-9]{64}$')
        self.assertIsNone(POLICY['tools']['lld']['bytes'])
        self.assertIn('reviewed-lld-size-loader-import-closure',POLICY['missingExecutionFacts'])
        self.assertIn('complete-reviewed-arm64-generated-security-profile',POLICY['missingExecutionFacts'])

    def test_modified_policy_json_cannot_enable_the_library(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder).resolve();changed=copy.deepcopy(POLICY);changed['executionAdmitted']=True
            (root/'engine-qualification-profile.json').write_text(json.dumps(changed))
            with patch.object(engine,'__file__',str(root/'engine_qualification.py')):
                with self.assertRaisesRegex(engine.QualificationError,'QUAL_PROFILE_PIN'):engine.load_profile()

    def test_both_exact_image_tuples_make_inert_bounded_plans_only(self):
        for image in POLICY['images']:
            value=request(image);plan=engine.build_plan(value)
            self.assertEqual(plan['maximumWorkMs'],450000)
            self.assertEqual(plan['cleanupMs'],30000)
            self.assertEqual(plan['finalReserveMs'],120000)
            self.assertEqual(sum(plan[k] for k in ('maximumWorkMs','cleanupMs','finalReserveMs')),value['remainingMs'])
            for key in ('executionAdmitted','compilerExecuted','engineCompilationRequested','sdkBuilt','nativeAcceptance','runtimeReady'):
                self.assertIs(plan[key],False)
            self.assertEqual(plan['source']['sourceId'],POLICY['images'][image]['sourceId'])
            self.assertEqual(len(plan['generatedTargets']),2)
            plan['inputBindings']['args']['sha256']='0'*64
            self.assertNotEqual(plan['inputBindings'],value['bindings'])

    def test_foreign_mode_ref_host_source_image_and_extra_claims_never_plan(self):
        for changes in ({'mode':'image-qualified-source-gn'},{'ref':'refs/heads/main'},
                        {'repositoryId':'1'},{'repository':'other/repo'},{'visibility':'private'},
                        {'event':'push'},{'image':'latest'},{'sdkBuilt':True}):
            with self.subTest(changes=changes),self.assertRaises(engine.QualificationError):
                engine.build_plan({**request(),**changes})
        for field in POLICY['host']:
            value=request();value['host'][field]='foreign'
            with self.assertRaisesRegex(engine.QualificationError,'QUAL_HOST_IMAGE'):engine.build_plan(value)
        for field in request()['source']:
            value=request();value['source'][field]='foreign'
            with self.assertRaisesRegex(engine.QualificationError,'QUAL_SOURCE_SCOPE'):engine.build_plan(value)

    def test_opposite_profile_and_unknown_tool_or_argv_cannot_cross_recipe_scope(self):
        value=request();value['source']=request('20261021.278.1')['source']
        with self.assertRaisesRegex(engine.QualificationError,'QUAL_SOURCE_SCOPE'):engine.build_plan(value)
        for role in POLICY['tools']:
            for field in ('path','sha256'):
                value=request();value['bindings']['tools'][role][field]='foreign'
                with self.assertRaises(engine.QualificationError):engine.build_plan(value)
        for changed in ({'argv':['--ignore-certificate-errors']},{'otherTool':{}},{'executionAdmitted':True}):
            value=request();value['bindings']['tools'].update(changed)
            with self.assertRaises(engine.QualificationError):engine.build_plan(value)

    def test_root_aliases_traversal_wrong_target_and_wrong_output_paths_are_rejected(self):
        for root in (ROOT.lower(),ROOT+'/',ROOT+'/..',ROOT.replace('/a/','/b/'),ROOT.replace('/','\\'),'//server/share',ROOT+'\0'):
            value=request();value['root']=root
            with self.assertRaises(engine.QualificationError):engine.build_plan(value)
        for role in ('args','graph'):
            value=request();value['bindings'][role]['path']=value['bindings'][role]['path'].replace('arm64','x64')
            with self.assertRaisesRegex(engine.QualificationError,'QUAL_FILE_PATH'):engine.build_plan(value)
        for name in ('../file','a/../file','a//file','a/./file','/absolute','C:/file','a\\file','CON','file.','a:stream'):
            with self.assertRaises(engine.QualificationError):engine.relative(name)

    def test_graph_args_tools_identity_drift_is_not_readback(self):
        value=request();self.assertTrue(engine.bind_readback(value,copy.deepcopy(value['bindings']))['same'])
        for kind, field in (('args','sha256'),('graph','sha256'),('graphInventory','sha256')):
            changed=copy.deepcopy(value['bindings']);changed[kind][field]='0'*64
            with self.assertRaisesRegex(engine.QualificationError,'QUAL_INPUT_CHANGED'):engine.bind_readback(value,changed)
        changed=copy.deepcopy(value['bindings']);changed['tools']['lld']['bytes']+=1
        with self.assertRaisesRegex(engine.QualificationError,'QUAL_INPUT_CHANGED'):engine.bind_readback(value,changed)

    def test_count_bounds_booleans_and_original_reserve_never_open_new_time(self):
        for remaining in (0,True,150000,7200001):
            value=request();value['remainingMs']=remaining
            with self.assertRaises(engine.QualificationError):engine.build_plan(value)
        for field,bad in (('files',50001),('visited',300001),('bytes',8*1024**3+1),('files',True)):
            value=request();value['bindings']['graphInventory'][field]=bad
            with self.assertRaises(engine.QualificationError):engine.build_plan(value)

    def test_execute_remains_closed_for_every_plan_or_success_json_before_any_process(self):
        import subprocess
        with patch.object(subprocess,'Popen',side_effect=AssertionError('no process')):
            for payload in (None,request(),engine.build_plan(request()),{'complete':True,'executionAdmitted':True,'nativeAcceptance':True}):
                with self.assertRaisesRegex(engine.QualificationError,'^ENGINE_QUALIFICATION_EXECUTION_CLOSED$'):
                    engine.execute(payload)

    def test_actual_existing_producer_rejects_new_mode_and_compile_role_without_optional_import(self):
        import producer
        with self.assertRaisesRegex(Exception,'FULL_MODE'):
            producer.source_mode({'mode':POLICY['mode']})
        for role in ('engine-compile','engine-link','compiler-input-qualification'):
            with self.assertRaisesRegex(Exception,'FULL_ROLE_MODE'):
                producer.role_in_mode(role,{'mode':producer.IMAGE_MODE})


class Headers(unittest.TestCase):
    def test_synthetic_full_macro_inventory_and_cef_config_are_non_authorizing(self):
        pa=engine.inspect_partition_alloc_header(pa_header())
        self.assertEqual(len(pa['macros']),61)
        self.assertFalse(pa['fullArm64DefaultsQualified']);self.assertFalse(pa['executionAdmitted'])
        self.assertTrue(engine.inspect_cef_config_header(CEF)['v8SandboxDeclared'])
        observed=engine.inspect_generated_inputs(request(),candidates(request()))
        self.assertFalse(observed['generatedSecurityHeadersVerified'])
        self.assertFalse(observed['executionAdmitted'])

    def test_args_reject_remoteexec_wrong_cpu_duplicate_missing_and_disabled_sandbox(self):
        inspected=engine.inspect_args(args()+b'# comment\nadditional_literal="value # literal"\nadditional_integer=-1\n')
        self.assertTrue(inspected['criticalLiteralDeclarationsVerified'])
        self.assertFalse(inspected['evaluatedGnVerified'])
        for raw in (args().replace(b'arm64',b'x64'),args().replace(b'use_remoteexec=false',b'use_remoteexec=true'),
                    args()+b'host_cpu="x64"\n',args().replace(b'is_debug=false\n',b''),
                    args()+b'v8_enable_sandbox=false\n',args()+b'cef_enable_sandbox=0\n',b'\xff'):
            with self.assertRaises(engine.QualificationError):engine.inspect_args(raw)

    def test_unmatched_gn_overrides_imports_control_flow_and_expressions_are_never_ignored(self):
        for extra in (b'target_cpu += "x64"',b'if (true) { target_cpu = "x64" }',
                      b'if (true) { v8_enable_sandbox=false }',b'import("//foreign.gni")',
                      b'extra = exec_script("foreign.py")',b'extra = "$target_cpu"',
                      b'extra = 1\nextra = 2',b'extra = [ "x64" ]',
                      b'extra = true; host_cpu="arm64"',b'if = 1'):
            with self.subTest(extra=extra),self.assertRaises(engine.QualificationError):
                engine.inspect_args(args()+extra+b'\n')

    def test_header_duplicates_conditionals_missing_unknown_negative_and_expressions_deny(self):
        raw=pa_header();line=b'#define PA_BUILDFLAG_INTERNAL_IS_DEBUG() (0)'
        for changed in (raw.replace(line,line+b'\n'+line),raw.replace(line,b''),
                        raw.replace(line,b'#if defined(OS_WIN)\n'+line+b'\n#endif'),
                        raw.replace(line,line+b'\n#define PRIVATE_UNKNOWN() (1)'),
                        raw.replace(line,line.replace(b'(0)',b'(false)')),
                        raw.replace(line,line.replace(b'(0)',b'(-1)')),
                        raw.replace(line,line.replace(b'(0)',b'(0+0)')),
                        raw+b'\0',raw.replace(b'IS_DEBUG() (0)',b'IS_DEBUG() (2)')):
            with self.assertRaises(engine.QualificationError):engine.inspect_partition_alloc_header(changed)

    def test_each_explicit_or_minimum_security_constraint_denies_even_synthetic_weakening(self):
        for key,expected in {**POLICY['explicitArgumentInvariants'],**POLICY['securityPolicyMinimums']}.items():
            row=('#define PA_BUILDFLAG_INTERNAL_%s() (%d)'%(key,expected)).encode()
            changed=pa_header().replace(row,row.replace(('(%d)'%expected).encode(),('(%d)'%(1-expected)).encode()))
            with self.assertRaisesRegex(engine.QualificationError,'QUAL_PA_SECURITY_MINIMUM'):engine.inspect_partition_alloc_header(changed)
        for changed in (CEF.replace(b'CEF_V8_ENABLE_SANDBOX 1',b'CEF_V8_ENABLE_SANDBOX 0'),
                        CEF.replace(b'#define CEF_V8_ENABLE_SANDBOX 1',b'#if defined(OS_WIN)\n#define CEF_V8_ENABLE_SANDBOX 1\n#endif'),
                        CEF.replace(b'#endif',b'#define CEF_X11 1\n#endif')):
            with self.assertRaises(engine.QualificationError):engine.inspect_cef_config_header(changed)

    def test_header_path_role_hash_args_and_source_bindings_cannot_be_swapped(self):
        for mutate in ('path','hash','bytes','args','role'):
            value=request();files=candidates(value)
            if mutate=='path':files['partitionAlloc']['pin']['path']=files['cefConfig']['pin']['path']
            if mutate=='hash':files['partitionAlloc']['pin']['sha256']='0'*64
            if mutate=='bytes':files['partitionAlloc']['pin']['bytes']+=1
            if mutate=='args':
                files['args']['raw']+=b'# changed\n';files['args']['pin']=pin(files['args']['pin']['path'],files['args']['raw'])
            if mutate=='role':files['partitionAlloc'],files['cefConfig']=files['cefConfig'],files['partitionAlloc']
            with self.assertRaises(engine.QualificationError):engine.inspect_generated_inputs(value,files)


class Binaries(unittest.TestCase):
    def test_standard_arm64_candidate_structures_are_not_executed_or_native_acceptance(self):
        self.assertEqual(engine.inspect_coff(coff())['machine'],0xaa64)
        value=engine.inspect_pe(pe());self.assertEqual(value['machine'],0xaa64)
        self.assertTrue(value['structureOnly']);self.assertFalse(value['outputExecuted'])
        self.assertFalse(value['executionAdmitted'])

    def test_coff_machine_optional_header_sections_symbols_and_truncation_deny(self):
        for offset,fmt,value in ((0,'H',0x8664),(2,'H',0),(16,'H',2),(36,'I',999999),(40,'I',999999),(8,'I',999999)):
            changed=bytearray(coff());struct.pack_into('<'+fmt,changed,offset,value)
            with self.assertRaises(engine.QualificationError):engine.inspect_coff(bytes(changed))
        for raw in (b'',coff()[:19],coff()[:60],bytearray(coff())):
            with self.assertRaises(engine.QualificationError):engine.inspect_coff(raw)

    def test_pe_wrong_machine_dll_pe32_imports_entry_ranges_and_truncation_deny(self):
        for offset,fmt,value in ((132,'H',0x8664),(150,'H',0x2022),(152,'H',0x10b),(220,'H',2),
                                (260,'I',17),(168,'I',0),(408,'I',0xffffffff),(412,'I',1000000),
                                (272,'I',1),(0x3c,'I',1000000)):
            changed=bytearray(pe());struct.pack_into('<'+fmt,changed,offset,value)
            with self.assertRaises(engine.QualificationError):engine.inspect_pe(bytes(changed))
        changed=bytearray(pe());struct.pack_into('<H',changed,134,2);changed[432:472]=changed[392:432]
        with self.assertRaisesRegex(engine.QualificationError,'QUAL_PE_ENTRY'):engine.inspect_pe(bytes(changed))
        for raw in (b'MZ',pe()[:512],bytearray(pe())):
            with self.assertRaises(engine.QualificationError):engine.inspect_pe(raw)


if __name__ == '__main__':
    unittest.main(verbosity=2)
