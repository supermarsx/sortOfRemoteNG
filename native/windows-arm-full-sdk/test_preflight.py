"""Pure fixed-command tests; never imports the Windows kernel backend."""
import ast
import builtins
import copy
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import time
import types
import unittest
from unittest.mock import patch

HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE))
import acquire as data
import checkpoint
import preflight
import producer as boot

BASE=json.loads((HERE/'profile.json').read_bytes())
SELECTED=json.loads((HERE/'preflight-profile.json').read_bytes())


def clock():return data.Clock(time.time()+30,time.monotonic()+30)


def context():
    return {'kind':'windows-arm-full-sdk-context','mode':'source-preflight',
        'repository':'supermarsx/sortOfRemoteNG','repositoryId':'1010282954',
        'visibility':'public','event':'workflow_dispatch','defaultBranch':'main',
        'ref':boot.PREFLIGHT_REF,'inputs':{'mode':'source-preflight'},
        'workflow':boot.PREFLIGHT_SOURCES[0],'workflowSha':'a'*40,'head':'a'*40,
        'image':preflight.IMAGE,'runId':'1','attempt':'1'}


class PreflightTests(unittest.TestCase):
    def temp(self):
        value=tempfile.TemporaryDirectory();self.addCleanup(value.cleanup)
        return Path(value.name).resolve()

    def test_supplemental_profile_pin_and_exact_seven_file_delta(self):
        self.assertEqual(preflight.profile(clock()),SELECTED)
        self.assertEqual(hashlib.sha256((HERE/'preflight-profile.json').read_bytes()).hexdigest(),preflight.PROFILE_SHA)
        new=preflight.reviewed_profile(BASE,SELECTED)
        self.assertEqual(BASE['image'],'20261021.278.1')
        self.assertEqual(BASE['sourceGn']['hostClosure']['image'],BASE['image'])
        self.assertEqual(len(new['sourceGn']['hostClosure']['rows']),18)
        delta=[(old['path'],old['sha256'],row['sha256']) for old,row in
               zip(BASE['sourceGn']['hostClosure']['rows'],new['sourceGn']['hostClosure']['rows'])
               if old!=row]
        self.assertEqual(len(delta),7)
        self.assertEqual(new['sourceGn']['hostClosure']['edgeCount'],242)
        self.assertEqual(new['sourceGn']['hostClosure']['edgeSha256'],BASE['sourceGn']['hostClosure']['edgeSha256'])
        for key in ('compilerAllowed','sdkAllowed','checkpointAllowed','restoreAllowed'):
            self.assertIs(new['sourceGn'][key],False)
        self.assertIs(SELECTED['benignVersionExecutionAllowed'],True)
        self.assertEqual(SELECTED['inventoryEvidence']['head'],'bcf300cb68f5857420e210535f99a1117b985816')
        with self.assertRaisesRegex(data.Denied,'FULL_HOST_IMAGE'):
            boot.source_host_closure_rows(new,preflight.IMAGE)

    def test_profile_mutation_denies_before_admission(self):
        raw=(HERE/'preflight-profile.json').read_bytes().replace(b'20261030.294.1',b'20261031.294.1')
        # Actual held-file checker, without touching the real reviewed file.
        target=self.temp()/'profile.json';target.write_bytes(raw)
        with self.assertRaisesRegex(data.Denied,'ACQ_HASH'):
            data.held(target,clock(),sha256=preflight.PROFILE_SHA)

    def test_exact_branch_image_workflow_mode_and_original_authorities(self):
        c=context();boot.bootstrap_authority(c,BASE);preflight.authority(c,SELECTED)
        for key,value in [('ref',boot.SOURCE_GN_REF),('ref',boot.INVENTORY_REF),
                          ('image',BASE['image']),('mode','source-gn'),
                          ('workflow',BASE['sourcePaths'][0])]:
            with self.subTest(key=key,value=value):
                bad={**c,key:value}
                with self.assertRaises(data.Denied):preflight.authority(bad,SELECTED)
                with self.assertRaises(data.Denied):boot.bootstrap_authority(bad,BASE)
        for mode,ref in [('command-inventory',boot.INVENTORY_REF),('source-gn',boot.SOURCE_GN_REF),
                         ('input-closure',boot.CARRIER_REF)]:
            old={**c,'mode':mode,'inputs':{'mode':mode} if mode!='input-closure' else {},
                 'ref':ref,'workflow':BASE['sourcePaths'][0],
                 'image':preflight.IMAGE if mode=='command-inventory' else BASE['image']}
            boot.bootstrap_authority(old,BASE)
        for role in ('preflight',*preflight.ROLES):boot.role_in_mode(role,c)
        for role in ('operation','source-gn','rust-archive','gn-archive','siso-archive','materialize'):
            with self.assertRaisesRegex(data.Denied,'FULL_ROLE_MODE'):boot.role_in_mode(role,c)
        for mode in ('source-gn','command-inventory','input-closure'):
            for role in ('preflight','git-version','clang-version'):
                with self.assertRaisesRegex(data.Denied,'FULL_ROLE_MODE'):boot.role_in_mode(role,{'mode':mode})

    def test_fixed_argv_only_and_recheck_precedes_admission(self):
        root=self.temp();seen=[]
        with patch('os.getcwd',return_value=str(root)),patch.object(preflight,'profile',return_value=SELECTED),\
             patch.object(preflight,'host_closure',side_effect=lambda *args:seen.append('host')),\
             patch.object(preflight,'clang_closure',side_effect=lambda *args:seen.append('clang')):
            for role in ('git-version','clang-version'):
                argv=preflight.version_argv(role,root,BASE,SELECTED)
                self.assertEqual(preflight.closed_command(argv,root,BASE,context(),clock()),role)
            self.assertEqual(seen,['host','clang']*2)
            for argv in ([SELECTED['hostTools']['git']['path'],'clone'],
                         [SELECTED['hostTools']['git']['path'],'--version','extra'],
                         ['git','--version'],[str(root/'llvm/bin/clang-cl.exe'),'/c','source.c'],
                         [str(root/'llvm/bin/lld-link.exe'),'--version']):
                with self.assertRaisesRegex(data.Denied,'FULL_PREFLIGHT_COMMAND'):
                    preflight.closed_command(argv,root,BASE,context(),clock())
            self.assertEqual(seen,['host','clang']*2)
        with patch('os.getcwd',return_value=str(root)),patch.object(preflight,'profile',return_value=SELECTED),\
             patch.object(preflight,'host_closure',side_effect=data.Denied('FULL_HOST_CLOSURE_BYTES')):
            with self.assertRaisesRegex(data.Denied,'FULL_HOST_CLOSURE_BYTES'):
                preflight.closed_command(preflight.version_argv('git-version',root,BASE,SELECTED),root,BASE,context(),clock())

    def test_actual_job_approval_requires_new_mode_and_exact_command(self):
        root=self.temp();tree=ast.parse((HERE/'job.py').read_bytes())
        node=next(n for n in tree.body if isinstance(n,ast.FunctionDef)and n.name=='approved_tool_command')
        ns={'Path':Path,'load_profile':lambda:BASE,'environment':lambda:{}}
        exec(compile(ast.Module(body=[node],type_ignores=[]),'actual-job-admission','exec'),ns)
        with patch('os.getcwd',return_value=str(root)),patch.object(boot,'verified_sources',return_value=(context(),BASE,clock())),\
             patch.object(preflight,'profile',return_value=SELECTED),\
             patch.object(preflight,'host_closure'),patch.object(preflight,'clang_closure'):
            for role in ('git-version','clang-version'):
                self.assertEqual(ns['approved_tool_command'](
                    preflight.version_argv(role,root,BASE,SELECTED),str(root)),role)
            with self.assertRaisesRegex(data.Denied,'FULL_PREFLIGHT_COMMAND'):
                ns['approved_tool_command']([SELECTED['hostTools']['git']['path'],'clone'],str(root))
            with patch.object(boot,'verified_sources',return_value=({**context(),'mode':'source-gn'},BASE,clock())):
                with self.assertRaisesRegex(data.Denied,'FULL_ROLE_MODE'):
                    ns['approved_tool_command'](preflight.version_argv('git-version',root,BASE,SELECTED),str(root))
        with self.assertRaisesRegex(data.Denied,'FULL_PREFLIGHT_CWD'):
            preflight.closed_command(preflight.version_argv('git-version',root,BASE,SELECTED),root,BASE,context(),clock())

    def test_legacy_length_two_request_cannot_import_unsealed_preflight_module(self):
        root=self.temp();tree=ast.parse((HERE/'job.py').read_bytes())
        node=next(n for n in tree.body if isinstance(n,ast.FunctionDef)and n.name=='approved_tool_command')
        ns={'Path':Path,'load_profile':lambda:BASE,'environment':lambda:{}}
        exec(compile(ast.Module(body=[node],type_ignores=[]),'actual-job-admission','exec'),ns)
        original_import=builtins.__import__;optional_imports=[]
        def guarded_import(name,*args,**kwargs):
            if name=='preflight':
                optional_imports.append(name)
                raise AssertionError('legacy context attempted unsealed optional import')
            return original_import(name,*args,**kwargs)
        for mode in ('input-closure','command-inventory','source-gn'):
            with self.subTest(mode=mode),patch.object(boot,'verified_sources',
                    return_value=({**context(),'mode':mode},BASE,clock())),\
                 patch('builtins.__import__',side_effect=guarded_import):
                with self.assertRaisesRegex(data.Denied,'FULL_ROLE_MODE'):
                    ns['approved_tool_command'](
                        [SELECTED['hostTools']['git']['path'],'--version'],str(root))
        self.assertEqual(optional_imports,[])

    def test_closed_token_free_environment_and_actual_job_selector(self):
        root=self.temp();original={'PATH':'C:/Windows/System32','SystemRoot':'C:/Windows',
            'WINDIR':'C:/Windows','TEMP':str(root/'tmp'),'TMP':str(root/'tmp'),
            'USERPROFILE':str(root/'home'),'PYTHONDONTWRITEBYTECODE':'1'}
        (root/'home').mkdir();(root/'home/empty-gitconfig').write_bytes(b'')
        git=preflight.version_environment('git-version',root,original)
        self.assertEqual(set(git)-set(original),{'GIT_CONFIG_NOSYSTEM','GIT_CONFIG_GLOBAL',
            'GIT_TERMINAL_PROMPT','GIT_OPTIONAL_LOCKS'})
        self.assertEqual(git['GIT_CONFIG_GLOBAL'],str(root/'home/empty-gitconfig'))
        self.assertEqual(git['GIT_CONFIG_NOSYSTEM'],'1')
        self.assertEqual(preflight.version_environment('clang-version',root,original),original)
        with self.assertRaisesRegex(data.Denied,'FULL_PREFLIGHT_ENVIRONMENT'):
            preflight.version_environment('git-version',root,{**original,'PATH':'caller'})
        with self.assertRaisesRegex(data.Denied,'FULL_PREFLIGHT_ENVIRONMENT'):
            preflight.version_environment('git-version',root,{**original,'GITHUB_TOKEN':'caller'})
        tree=ast.parse((HERE/'job.py').read_bytes())
        node=next(n for n in tree.body if isinstance(n,ast.FunctionDef)and n.name=='launch_environment')
        ns={'environment':lambda:dict(original),'Path':Path}
        exec(compile(ast.Module(body=[node],type_ignores=[]),'actual-job-env','exec'),ns)
        self.assertEqual(ns['launch_environment']('git-version',root),git)
        self.assertEqual(ns['launch_environment']('sdk-data',root),original)

    def test_compiler_closure_reads_pinned_runtime_and_exact_static_imports(self):
        root=self.temp();(root/'llvm/bin').mkdir(parents=True)
        runtime=[r for r in BASE['runtime17']['rows']if r['machine']==0x8664]
        rows={str(root/r['destination']):r for r in runtime}
        def held(path,*args,**kwargs):
            row=rows.get(str(path))
            if row:return ({'sha256':row['sha256']},json.dumps(row).encode())
            self.assertEqual(args[1:3],(103794176,BASE['llvm']['clangSha256']))
            return ({'sha256':BASE['llvm']['clangSha256']},b'clang')
        def metadata(raw):
            if raw==b'clang':return {'machine':34404,'imports':SELECTED['clang']['imports'],
                                    'delayImports':SELECTED['clang']['delayImports']}
            return json.loads(raw)
        with patch.object(preflight.extract,'held',side_effect=held) as reader,\
             patch.object(preflight.extract,'pe_metadata',side_effect=metadata):
            result=preflight.clang_closure(root,BASE,SELECTED,clock())
            self.assertEqual(result['runtimeFiles'],9);self.assertEqual(reader.call_count,10)
            (root/'llvm/bin/VERSION.dll').write_bytes(b'unreviewed')
            with self.assertRaisesRegex(data.Denied,'FULL_PREFLIGHT_CLANG_SHADOW'):
                preflight.clang_closure(root,BASE,SELECTED,clock())
            (root/'llvm/bin/VERSION.dll').unlink()
            with patch.object(preflight.extract,'pe_metadata',side_effect=lambda raw:
                    {'machine':34404,'imports':['attacker.dll'],'delayImports':[]}if raw==b'clang'else json.loads(raw)):
                with self.assertRaisesRegex(data.Denied,'FULL_PREFLIGHT_CLANG_IMPORT'):
                    preflight.clang_closure(root,BASE,SELECTED,clock())

    def test_version_output_is_bounded_fixed_format_and_no_stderr(self):
        root=self.temp()
        for role,out in [('git-version',b'git version 2.56.0.windows.4\n'),
                         ('clang-version',b'clang version 24.0.0\nTarget: x86_64-pc-windows-msvc\n')]:
            path=root/'jobs'/role;path.mkdir(parents=True)
            (path/'stdout.log').write_bytes(out);(path/'stderr.log').write_bytes(b'')
            self.assertTrue(preflight.version_output(root,role,clock())['fixedVersionCommand'])
            (path/'stderr.log').write_bytes(b'failure')
            with self.assertRaisesRegex(data.Denied,'FULL_PREFLIGHT_VERSION_OUTPUT'):
                preflight.version_output(root,role,clock())

    def test_supplemental_source_set_does_not_weaken_original_set(self):
        paths=BASE['sourcePaths']+boot.PREFLIGHT_SOURCES
        rows=[{'path':p,'bytes':1,'sha256':'a'*64,'canonicalBytes':1,
               'canonicalSha256':'a'*64,'encoding':'exact'}for p in paths]
        checkpoint.closed_sources(rows,paths)
        checkpoint.closed_sources(rows[:11],BASE['sourcePaths'])
        for invalid in (rows[:-1],rows+[rows[-1]],list(reversed(rows))):
            with self.assertRaisesRegex(ValueError,'BOOT_SOURCE_SET'):
                checkpoint.closed_sources(invalid,paths)
        rows[12]['encoding']='git-crlf'
        with self.assertRaisesRegex(ValueError,'BOOT_SOURCE_ENCODING'):
            checkpoint.closed_sources(rows,paths)

    def run_fixture(self,fail_role=None,post_failure=False):
        root=self.temp();(root/'home').mkdir();(root/'jobs').mkdir();seen=[];reports=[]
        class Parent:
            def __init__(self,event):pass
            def close(self):seen.append('close')
        def owned(argv,cwd,out,seconds,**kwargs):
            role=out.name;seen.append(role)
            self.assertLessEqual(seconds,15 if role.endswith('version') else 1170)
            self.assertEqual(argv[-1],'--version' if role.endswith('version') else '--execute')
            if role=='clang-version':self.assertEqual(argv,[str(root/'llvm/bin/clang-cl.exe'),'--version'])
            return {'success':role!=fail_role,'cleanupVerified':True,'rootExit':1 if role==fail_role else 0,
                    'activeAtEnd':0,'started':True,'resumed':True}
        def closure(*args):
            seen.append('closure')
            if post_failure and 'git-version'in seen:raise data.Denied('FULL_HOST_CLOSURE_BYTES')
            return {'expectedByteSetVerified':True}
        fake=types.SimpleNamespace(ParentCancel=Parent,run_job=owned)
        with patch.dict(sys.modules,{'job':fake}),patch.object(preflight,'profile',return_value=SELECTED),\
             patch.object(preflight,'host_closure',side_effect=closure),\
             patch.object(preflight,'clang_closure',return_value={}),\
             patch.object(preflight,'version_output',return_value={}),\
             patch.object(boot,'verified_sources'),patch.object(boot,'retain',side_effect=lambda root,name,row:reports.append(copy.deepcopy(row))),\
             patch.object(boot,'CONTEXT_SHA','a'*64),\
             patch('shutil.disk_usage',return_value=types.SimpleNamespace(free=100*1024**3)):
            exit_code=preflight.run(root,context(),BASE,
                data.Clock(time.time()+3600,time.monotonic()+3600))
        return exit_code,reports[0],seen

    def test_owned_phase_order_and_truthful_compiler_invocation(self):
        code,report,seen=self.run_fixture()
        self.assertEqual(code,0)
        self.assertEqual([row['role']for row in report['jobs']],list(preflight.ROLES))
        self.assertLess(seen.index('runtime-closure'),seen.index('git-version'))
        self.assertLess(seen.index('git-version'),seen.index('clang-version'))
        self.assertIs(report['compilerExecutableInvoked'],True)
        self.assertIs(report['engineCompilationAttempted'],False)
        for flag in ('sourceFetched','gnExecuted','sdkBuilt','nativeAcceptance','publicationAllowed'):
            self.assertIs(report[flag],False)
        self.assertTrue(report['parentHandleClosed']);self.assertTrue(report['sourcePostVerified'])

    def test_failed_prerequisite_and_postmutation_stop_later_commands(self):
        for role in ('sdk-data','llvm-data','runtime-closure','git-version','clang-version'):
            with self.subTest(role=role):
                code,report,seen=self.run_fixture(fail_role=role)
                self.assertEqual(code,1)
                self.assertEqual([r['role']for r in report['jobs']],list(preflight.ROLES[:preflight.ROLES.index(role)+1]))
                self.assertEqual(report['compilerExecutableInvoked'],role=='clang-version')
                self.assertTrue(report['parentHandleClosed'])
                if role.endswith('version'):self.assertTrue(report[role+'PostVerified'])
        code,report,seen=self.run_fixture(post_failure=True)
        self.assertEqual(code,1);self.assertNotIn('clang-version',seen)
        self.assertEqual(report['firstFailure'],'FULL_HOST_CLOSURE_BYTES')
        self.assertFalse(report['git-versionPostVerified'])
        code,report,seen=self.run_fixture(fail_role='git-version',post_failure=True)
        self.assertEqual(code,1)
        self.assertEqual(report['firstFailure'],'FULL_PREFLIGHT_JOB')
        self.assertEqual(report['closurePostFailure'],'FULL_HOST_CLOSURE_BYTES')
        self.assertFalse(report['git-versionPostVerified'])


if __name__=='__main__':unittest.main()
