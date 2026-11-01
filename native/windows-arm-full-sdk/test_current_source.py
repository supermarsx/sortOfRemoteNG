"""Current R5 source identity/authority tests; no Git/LLVM execution."""
import copy
import hashlib
import json
from pathlib import Path
import sys
import time
import unittest
from unittest.mock import patch

HERE=Path(__file__).resolve().parent;sys.path.insert(0,str(HERE))
import acquire as data
import checkpoint
import producer as boot

BASE=json.loads((HERE/'profile.json').read_bytes())
SELECTED=json.loads((HERE/'current-source-profile.json').read_bytes())


def clock():return data.Clock(time.time()+30,time.monotonic()+30)


class CurrentSourceTests(unittest.TestCase):
    def test_profile_and_all_payload_helper_pins_are_exact_before_import(self):
        p=boot.current_profile(copy.deepcopy(BASE),clock())
        self.assertEqual(hashlib.sha256((HERE/'current-source-profile.json').read_bytes()).hexdigest(),boot.CURRENT_PROFILE_SHA)
        self.assertEqual(p['sourceGn']['helpersSourceCommit'],'0fd6ebc70f110ff80909fe996fb4abf5499c9468')
        self.assertEqual(len(p['sourcePaths']),62)
        for row in (*p['sourceGn']['helpers'],*p['sourceGn']['sourceData']):
            raw=(boot.ROOT/row['path']).read_bytes()
            if row['path']==boot.CURRENT_MIRROR+'scripts/lib/browser-custom-runtime.mjs':
                # Only the image-qualified recipe adopts reviewed commit8f0b.
                # This old profile/pin stays immutable; normalize that exact delta.
                self.assertEqual((len(raw),hashlib.sha256(raw).hexdigest()),(70755,'f6772b8785ccf96a721013fa93a79c3ae252d19b986e338f59265f3c62f8827f'))
                start=raw.index(b'// Only this separately creation-owned runtime profile')
                end=raw.index(b'async function sourceGitPhysical(file)',start);raw=raw[:start]+raw[end:]
                start=raw.index(b'  let runtimeProfile;\n');end=raw.index(b'  await sourceGitPhysical(directory);',start);raw=raw[:start]+raw[end:]
                raw=raw.replace(b'    runtimeProfile,\n',b'',1)
                start=raw.index(b'    if (policy.runtimeProfile) {\n');end=raw.index(b'    const hooks = await opendir(',start);raw=raw[:start]+raw[end:]
                raw=raw.replace(b'      USERPROFILE:\n        policy.runtimeProfile?.path ?? path.join(policy.directory, "home"),',b'      USERPROFILE: path.join(policy.directory, "home"),',1)
                self.assertEqual((len(raw),hashlib.sha256(raw).hexdigest()),(69741,'7a2fb8f3ca0ba4404050e37b7382fe53789cdb3b70682d1930205508c72a3217'))
                start=raw.index(b'  const windowsLongPaths = options !== undefined;\n')
                end=raw.index(b'  if (\n    !path.isAbsolute(directory)',start)
                raw=raw[:start]+raw[end:]
                raw=raw.replace(b'prepareSourceGitIsolation(directory, options)',b'prepareSourceGitIsolation(directory)',1)
                raw=raw.replace(b'${windowsLongPaths ? "\\tlongpaths = true\\n" : ""}',b'',1)
            self.assertEqual((len(raw),hashlib.sha256(raw).hexdigest()),(row['bytes'],row['sha256']),row['path'])
        lock=json.loads((boot.ROOT/p['sourceGn']['namespace']/'source-lock.json').read_bytes())
        identity=hashlib.sha256(json.dumps(lock,sort_keys=True,separators=(',',':')).encode()).hexdigest()
        self.assertEqual(identity,p['sourceGn']['sourceId'])
        self.assertEqual(identity,'e94e940297f9e9121def11a29aa1d1f4eff837cfcaa6da4a66fd0341f71d8e90')
        self.assertEqual(len(lock['patches']),23)
        self.assertEqual(lock['bridge']['patchId'],'sorng-tls-v2-682c378-5')
        self.assertEqual(lock['bridge']['header']['sha256'],'1352d790a75c1f48e3d7a7a5bbc4f63b40665d2c233c75f2ea50a10e5246d45e')
        self.assertFalse(any('disk-cache'in row['path']for row in lock['patches']))

    def test_new_phase_cannot_admit_legacy_branch_or_compiler_roles(self):
        c={'kind':'windows-arm-full-sdk-context','mode':boot.CURRENT_MODE,
            'repository':'supermarsx/sortOfRemoteNG','repositoryId':'1010282954','visibility':'public',
            'event':'workflow_dispatch','defaultBranch':'main','ref':boot.CURRENT_REF,
            'inputs':{'mode':boot.CURRENT_MODE},'workflow':boot.CURRENT_WORKFLOW,
            'workflowSha':'a'*40,'head':'a'*40,'image':boot.INVENTORY_IMAGE,'runId':'1','attempt':'1'}
        boot.bootstrap_authority(c,BASE)
        for key,value in [('ref',boot.SOURCE_GN_REF),('ref',boot.PREFLIGHT_REF),
                ('image','20261021.278.1'),('mode','source-gn'),('workflow',BASE['sourcePaths'][0])]:
            with self.assertRaises(data.Denied):boot.bootstrap_authority({**c,key:value},BASE)
        for role in (*boot.ROLES,'operation','source-gn','metrics-fixture'):boot.role_in_mode(role,c)
        for role in ('git-version','clang-version','compile','sdk','preflight'):
            with self.assertRaises(data.Denied):boot.role_in_mode(role,c)
        for mode in ('input-closure','command-inventory','source-gn','source-preflight'):
            with self.assertRaises(data.Denied):boot.role_in_mode('metrics-fixture',{'mode':mode})

    def test_only_mode_sealed_profile_selects_new_driver_and_keeps_limits(self):
        p=boot.current_profile(copy.deepcopy(BASE),clock());root=boot.ROOT/'.artifacts/windows-arm-full-sdk-fixture'
        with patch.object(boot,'CONTEXT_SHA','a'*64),patch('os.getcwd',return_value=str(root)):
            argv=boot.worker_argv('source-gn',root,p)
            self.assertTrue(argv[3].endswith('current-source-driver.mjs'))
            self.assertEqual(boot.closed_worker_command(argv,root,p),'source-gn')
            with self.assertRaises(data.Denied):boot.closed_worker_command(argv,root,BASE)
        self.assertEqual(p['sourceGn']['limits'],BASE['sourceGn']['limits'])
        self.assertEqual(boot.worker_policy('source-gn',{'mode':boot.CURRENT_MODE}),
            {'processes':64,'memoryBytes':8*1024**3,'cpuRate':2500})
        for key in ('compilerAllowed','sdkAllowed','checkpointAllowed','restoreAllowed'):
            self.assertIs(p['sourceGn'][key],False)


if __name__=='__main__':unittest.main()
