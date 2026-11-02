"""Portable data/native-interface models only; no Windows Job or tool executes."""
import ast
import copy
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import full_sdk_engine as engine


# Exact finite branch inverse to the complete reviewed closed adapter; no Git
# history, broad normalization, native execution or deserialized authority.
ENGINE_ASSEMBLY_HISTORY = json.loads('{"rows":[{"name":"finite-0","oldRaw":"from pathlib import Path\\nimport re\\nimport stat\\nimport sys\\nimport threading\\nimport time\\n\\nNATIVE_ENGINE_ADMITTED = False\\nEXPENSIVE_ENGINE_ADMITTED = False\\nROLES = (\'probe-clang\', \'probe-link\', \'cef-engine\', \'package\')\\nCAPS = {\'probe-clang\': 900, \'probe-link\': 900, \'cef-engine\': 10800, \'package\': 2400}\\nMETADATA_MAXIMA = (65536, 65536, 1048576, 1048576, 4194304, 1048576, 8388608, 8388608, 131072)\\nSOURCES = {\'20261030.294.1\': \'e94e940297f9e9121def11a29aa1d1f4eff837cfcaa6da4a66fd0341f71d8e90\',\\n           \'20261021.278.1\': \'fae550f13a0ae396ce9bcc3eac6453fc6f8fe1393363be621ec18226541664aa\'}\\nHERE = Path(__file__).resolve().parent\\nREPO = HERE.parents[1]\\n_ACTIVE = {}\\n_BIRTHS = {}\\n","newRaw":"from pathlib import Path\\nimport re\\nimport stat\\nimport sys\\nimport threading\\nimport time\\n\\nNATIVE_ENGINE_ADMITTED = True  # Reviewed fixed execution ATTEMPT; no native qualification claim.\\nEXPENSIVE_ENGINE_ADMITTED = True  # Original6h/3h slice and real checkpoint alternative required.\\nROLES = (\'probe-clang\', \'probe-link\', \'cef-engine\', \'package\', \'checkpoint-seal\')\\nCAPS = {\'probe-clang\': 900, \'probe-link\': 900, \'cef-engine\': 10800, \'package\': 2400, \'checkpoint-seal\': 3600}\\nMETADATA_MAXIMA = (65536, 65536, 1048576, 1048576, 4194304, 1048576, 8388608, 8388608, 131072)\\nSOURCES = {\'20261030.294.1\': \'e94e940297f9e9121def11a29aa1d1f4eff837cfcaa6da4a66fd0341f71d8e90\',\\n           \'20261021.278.1\': \'fae550f13a0ae396ce9bcc3eac6453fc6f8fe1393363be621ec18226541664aa\'}\\nHERE = Path(__file__).resolve().parent\\nREPO = HERE.parents[1]\\n_ACTIVE = {}\\n_BIRTHS = {}\\n","oldSha256":"fb2f2e06904325937bc8640a4f83b1e883cf6ccb0c5575c5e0af8d6c3da07abe","newSha256":"4419eb7d8d9440fc17094fa1d7f5a89d7a69a2e852b23ab78ce359957c061719"},{"name":"finite-1","oldRaw":"    need(type(value[\'sourceContextSha256\']) is str and re.fullmatch(\'[a-f0-9]{64}\', value[\'sourceContextSha256\']), \'SOURCE_PIN\')\\n    for key in (\'wallWholeEnd\', \'monotonicWholeEnd\', \'wallPhaseEnd\', \'monotonicPhaseEnd\'):\\n        need(type(value[key]) in (int, float) and math.isfinite(value[key]), \'CLOCK\')\\n    need(value[\'wallWholeEnd\'] == source[\'wallWholeEnd\'] and\\n         value[\'monotonicWholeEnd\'] == source[\'monotonicWholeEnd\'] and\\n         value[\'wallPhaseEnd\'] <= value[\'wallWholeEnd\'] - 150 and\\n         value[\'monotonicPhaseEnd\'] <= value[\'monotonicWholeEnd\'] - 150, \'ORIGINAL_ENDS\')\\n    need(type(value[\'parentPid\']) is int and 0 < value[\'parentPid\'] <= 0xffffffff and\\n         type(value[\'parentCreationFiletime\']) is str and re.fullmatch(\'[1-9][0-9]{0,19}\', value[\'parentCreationFiletime\']), \'PARENT\')\\n    rows = source[\'sources\']\\n    names = (\'native/windows-arm-full-sdk/private-qualification-profile.json\',\\n             \'native/windows-arm-full-sdk/engine-qualification-profile.json\')\\n    expected = [\'source-inputs/\' + str(next(i for i, row in enumerate(rows) if row[\'path\'] == name)) for name in names]\\n    out = \'source-checkout/src/out/Release_GN_arm64/\'\\n","newRaw":"    need(type(value[\'sourceContextSha256\']) is str and re.fullmatch(\'[a-f0-9]{64}\', value[\'sourceContextSha256\']), \'SOURCE_PIN\')\\n    for key in (\'wallWholeEnd\', \'monotonicWholeEnd\', \'wallPhaseEnd\', \'monotonicPhaseEnd\'):\\n        need(type(value[key]) in (int, float) and math.isfinite(value[key]), \'CLOCK\')\\n    need(value[\'wallWholeEnd\'] == source[\'wallWholeEnd\'] and\\n         value[\'monotonicWholeEnd\'] == source[\'monotonicWholeEnd\'] and\\n         value[\'wallPhaseEnd\'] <= value[\'wallWholeEnd\'] - 150 and\\n         value[\'monotonicPhaseEnd\'] <= value[\'monotonicWholeEnd\'] - 150, \'ORIGINAL_ENDS\')\\n    if role == \'cef-engine\':\\n        need(value[\'wallPhaseEnd\'] <= value[\'wallWholeEnd\'] - 3600 and\\n             value[\'monotonicPhaseEnd\'] <= value[\'monotonicWholeEnd\'] - 3600, \'CEF_POSTCOMPILE_RESERVE\')\\n    need(type(value[\'parentPid\']) is int and 0 < value[\'parentPid\'] <= 0xffffffff and\\n         type(value[\'parentCreationFiletime\']) is str and re.fullmatch(\'[1-9][0-9]{0,19}\', value[\'parentCreationFiletime\']), \'PARENT\')\\n    rows = source[\'sources\']\\n    names = (\'native/windows-arm-full-sdk/private-qualification-profile.json\',\\n             \'native/windows-arm-full-sdk/engine-qualification-profile.json\')\\n    expected = [\'source-inputs/\' + str(next(i for i, row in enumerate(rows) if row[\'path\'] == name)) for name in names]\\n    out = \'source-checkout/src/out/Release_GN_arm64/\'\\n","oldSha256":"a188eaa317413021ed139efeeda264f718349ce53eeabe3526b0db3669722c7c","newSha256":"2d68955803b60ce5c02f12793b036e532921c4e334868352997d9fcb917614de"},{"name":"finite-2","oldRaw":"            _pin({key: row[key] for key in (\'bytes\', \'sha256\')},\\n                 METADATA_MAXIMA[index] if key == \'metadataFiles\' else 65536,\\n                 0 if key == \'gitPolicyFiles\' and index == 1 else 1)\\n            if key == \'gitPolicyFiles\' and index == 1:\\n                need(row[\'bytes\'] == 0 and row[\'sha256\'] == digest(b\'\'), \'GIT_SYSTEM_PIN\')\\n    if role == ROLES[0]:\\n        need(value[\'prior\'] is None, \'PRIOR\')\\n    else:\\n        need(type(value[\'prior\']) is dict and set(value[\'prior\']) == {\'result\', \'receipt\'}, \'PRIOR\')\\n        for row in value[\'prior\'].values():\\n            _pin(row)\\n    return value\\n\\n\\n","newRaw":"            _pin({key: row[key] for key in (\'bytes\', \'sha256\')},\\n                 METADATA_MAXIMA[index] if key == \'metadataFiles\' else 65536,\\n                 0 if key == \'gitPolicyFiles\' and index == 1 else 1)\\n            if key == \'gitPolicyFiles\' and index == 1:\\n                need(row[\'bytes\'] == 0 and row[\'sha256\'] == digest(b\'\'), \'GIT_SYSTEM_PIN\')\\n    if role == ROLES[0]:\\n        need(value[\'prior\'] is None, \'PRIOR\')\\n    elif role == \'checkpoint-seal\':\\n        need(type(value[\'prior\']) is dict and set(value[\'prior\']) == {\'result\', \'receipt\', \'closure\', \'launch\'} and value[\'prior\'][\'result\'] is None, \'PRIOR\')\\n        for key in (\'receipt\', \'closure\', \'launch\'):\\n            _pin(value[\'prior\'][key])\\n    else:\\n        need(type(value[\'prior\']) is dict and set(value[\'prior\']) == {\'result\', \'receipt\'}, \'PRIOR\')\\n        for row in value[\'prior\'].values():\\n            _pin(row)\\n    return value\\n\\n\\n","oldSha256":"b19e84e0892e6e8ac818828f67424a25bdf8924b4f979feef518d0c791391ad0","newSha256":"92f3d0b55493c8dbeabdcf7d8aa0c21a3642419fbb3b2ad681ba7ce70c0255ff"},{"name":"finite-3","oldRaw":"    state = _state(root=cwd)\\n    _verified_active_sources(cwd)\\n    need(Path.cwd() == state[\'root\'] and argv == _worker_argv(state), \'ARGV\')\\n    return state[\'context\'][\'role\']\\n\\n\\ndef _load(root, sha, role):\\n    need(NATIVE_ENGINE_ADMITTED, \'NATIVE_CLOSED\')\\n    need(role in ROLES and (role != \'cef-engine\' or EXPENSIVE_ENGINE_ADMITTED), \'EXPENSIVE_ENGINE_CLOSED\')\\n    need(os.name == \'nt\' and not _ACTIVE and not _BIRTHS, \'ENTRY\')\\n    need(sys.modules.get(\'full_sdk_engine\') in (None, sys.modules[__name__]), \'MODULE_ALIAS\')\\n    sys.modules[\'full_sdk_engine\'] = sys.modules[__name__]\\n    sys.path.insert(0, str(HERE))\\n    import acquire as data\\n","newRaw":"    state = _state(root=cwd)\\n    _verified_active_sources(cwd)\\n    need(Path.cwd() == state[\'root\'] and argv == _worker_argv(state), \'ARGV\')\\n    return state[\'context\'][\'role\']\\n\\n\\ndef _load(root, sha, role):\\n    need(type(root) is str and Path(root).is_absolute() and Path(root).parent == REPO / \'.artifacts\' and\\n         re.fullmatch(\'windows-arm-full-sdk-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\', Path(root).name), \'ENTRY_SCOPE\')\\n    need(NATIVE_ENGINE_ADMITTED, \'NATIVE_CLOSED\')\\n    need(role in ROLES and (role != \'cef-engine\' or EXPENSIVE_ENGINE_ADMITTED), \'EXPENSIVE_ENGINE_CLOSED\')\\n    need(os.name == \'nt\' and not _ACTIVE and not _BIRTHS, \'ENTRY\')\\n    need(sys.modules.get(\'full_sdk_engine\') in (None, sys.modules[__name__]), \'MODULE_ALIAS\')\\n    sys.modules[\'full_sdk_engine\'] = sys.modules[__name__]\\n    sys.path.insert(0, str(HERE))\\n    import acquire as data\\n","oldSha256":"886a4d3ccad51813de5a24996b50527db501f6f0149d536ac13728a38a1942a0","newSha256":"ad662e83e139c550ccbbd27cd75d7b00759b519be3efdf879e212d8c8b8c156e"},{"name":"finite-4","oldRaw":"            try:\\n                close()\\n            except BaseException:\\n                pass\\n        raise\\n\\n\\ndef _run(state):\\n    import job\\n    role, root = state[\'context\'][\'role\'], state[\'root\']\\n    _verified_active_sources(root)\\n    launch = dict(kind=\'windows-arm-full-sdk-engine-launch\', role=role, ownPid=state[\'pid\'],\\n                  ownCreationFiletime=state[\'creation\'], parentPid=state[\'context\'][\'parentPid\'],\\n                  parentCreationFiletime=state[\'context\'][\'parentCreationFiletime\'], contextSha256=state[\'sha\'])\\n    with (root / (\'full-sdk-engine-\' + role + \'-launch.json\')).open(\'xb\') as stream:\\n        stream.write(canonical(launch) + b\'\\\\n\')\\n    _state(root=root)\\n    seconds = math.floor(min(CAPS[role], state[\'clock\'].remaining()))\\n    need(seconds > 0, \'DEADLINE\')\\n    result = job.run_job(_worker_argv(state), str(root), root / \'jobs\' / role, seconds,\\n                         cancel=state[\'parent\'], cap=64 * 1024**2)\\n    _verified_active_sources(root)\\n    need(result.get(\'success\') is True and result.get(\'cleanupVerified\') is True and\\n         result.get(\'activeAtEnd\') == 0 and result.get(\'rootExit\') == 0 and\\n         result.get(\'rootReaped\') is True and result.get(\'logReadersStopped\') is True, \'JOB_FAILED\')\\n    return result\\n\\n\\ndef main(argv=None):\\n    argv = sys.argv[1:] if argv is None else argv\\n    need(type(argv) is list and len(argv) == 5 and argv[0] == \'--full-sdk-engine-launcher\' and\\n         argv[1] in ROLES and re.fullmatch(\'[a-f0-9]{64}\', argv[3]) and argv[4] == \'--execute\', \'ARGV\')\\n    state = _load(argv[2], argv[3], argv[1])\\n    failed, primary = False, None\\n    try:\\n        _run(state)\\n    except BaseException as error:\\n        failed, primary = True, error\\n        state[\'failed\'], state[\'primary\'] = True, error\\n    finally:\\n        state[\'closed\'] = True\\n        _ACTIVE.clear()\\n        _BIRTHS.clear()\\n","newRaw":"            try:\\n                close()\\n            except BaseException:\\n                pass\\n        raise\\n\\n\\n# BEGIN FIXED CEF SUPERVISOR DEADLINE\\nclass OriginalWholeClock:\\n    def __init__(self, packet):\\n        self.ends = (packet[\'wallWholeEnd\'], packet[\'monotonicWholeEnd\'])\\n        self.failed, self.primary = False, None\\n\\n    def remaining(self):\\n        if self.failed:\\n            raise self.primary\\n        try:\\n            whole = min(self.ends[0] - time.time(), self.ends[1] - time.monotonic())\\n            need(150 < whole <= 21600, \'WHOLE_DEADLINE\')\\n            return whole - 150\\n        except BaseException as error:\\n            self.failed, self.primary = True, error\\n            raise\\n\\n\\ndef inspect_native_slice(result, seconds):\\n    need(type(seconds) is int and 0 < seconds <= 10800 and type(result) is dict and\\n         result.get(\'kind\') == \'owned-job-proof\' and result.get(\'outcome\') == \'deadline\' and result.get(\'success\') is False and\\n         result.get(\'rootExit\') is None and result.get(\'finalRootExit\') == 124 and result.get(\'rootReaped\') is True and\\n         type(result.get(\'activeAtEnd\')) is int and result[\'activeAtEnd\'] == 0 and result.get(\'cleanupVerified\') is True and result.get(\'logReadersStopped\') is True and\\n         result.get(\'cleanupBudgetMs\') == 30000 and type(result.get(\'elapsedMs\')) is int and result[\'elapsedMs\'] >= seconds * 1000 and\\n         result.get(\'started\') is True and result.get(\'jobCreated\') is True and result.get(\'assignedBeforeResume\') is True and\\n         result.get(\'resumed\') is True and result.get(\'assignedAtCreationVerified\') is True and result.get(\'assignmentMode\') == \'creation-attribute\' and\\n         result.get(\'handleListOnly\') is True and result.get(\'jobHandleInheritable\') is False and result.get(\'jobHandleInStdioAllowlist\') is False and\\n         type(result.get(\'rootPid\')) is int and result[\'rootPid\'] > 0 and type(result.get(\'rootCreationFiletime\')) is str and\\n         re.fullmatch(\'[1-9][0-9]{0,19}\', result[\'rootCreationFiletime\']) and\\n         (\'observerStopped\' not in result or result[\'observerStopped\'] is True) and\\n         result.get(\'outputCapBytes\') == 64 * 1024**2 and type(result.get(\'capturedBytes\')) is int and\\n         0 <= result[\'capturedBytes\'] <= result[\'outputCapBytes\'], \'SLICE_NATIVE_DEADLINE\')\\n    need(result.get(\'policyReadback\') == dict(flags=8712, activeProcessLimit=64, jobMemoryBytes=str(8 * 1024**3),\\n         cpuFlags=5, cpuRate=2500, inheritedHandles=3, affinityChanged=False), \'SLICE_POLICY\')\\n    return result\\n\\n\\ndef _post_slice_sources(state):\\n    _canonical_module()\\n    need(_ACTIVE.get(str(state[\'root\'])) is state and _BIRTHS.get(state[\'birth\']) is state and\\n         state[\'pid\'] == os.getpid() and not state[\'closed\'] and not state[\'failed\'] and\\n         state[\'context\'][\'role\'] == \'cef-engine\' and state.get(\'directNativeResult\') is state.get(\'nativeSliceResult\'), \'SLICE_OWNER\')\\n    inspect_native_slice(state[\'directNativeResult\'], state[\'assignedSeconds\'])\\n    need(digest(canonical(state[\'context\'])) == state[\'semantic\'] and\\n         digest(canonical(state[\'profile\'])) == state[\'profileSemantic\'] and not state[\'parent\'].is_set(), \'SLICE_IDENTITY\')\\n    clock = state[\'postSliceClock\']\\n    clock.remaining()\\n    _fence(state)\\n    for file, pin in state[\'held\']:\\n        state[\'data\'].held(file, clock, pin[\'bytes\'], pin[\'sha256\'], maximum=max(pin[\'bytes\'], 1))\\n    receipt = state[\'root\'] / \'jobs\' / \'cef-engine\' / \'receipt.json\'\\n    _, raw = state[\'data\'].held(receipt, clock, retain=True, maximum=1048576)\\n    need(canonical(_json(raw)) == canonical(state[\'directNativeResult\']), \'SLICE_ORIGINAL_RECEIPT\')\\n    state[\'nativeReceiptPin\'] = dict(bytes=len(raw), sha256=digest(raw))\\n    clock.remaining()\\n    _fence(state)\\n# END FIXED CEF SUPERVISOR DEADLINE\\n\\n\\ndef _run(state):\\n    import job\\n    role, root = state[\'context\'][\'role\'], state[\'root\']\\n    _verified_active_sources(root)\\n    launch = dict(kind=\'windows-arm-full-sdk-engine-launch\', role=role, ownPid=state[\'pid\'],\\n                  ownCreationFiletime=state[\'creation\'], parentPid=state[\'context\'][\'parentPid\'],\\n                  parentCreationFiletime=state[\'context\'][\'parentCreationFiletime\'], contextSha256=state[\'sha\'])\\n    with (root / (\'full-sdk-engine-\' + role + \'-launch.json\')).open(\'xb\') as stream:\\n        stream.write(canonical(launch) + b\'\\\\n\')\\n    _state(root=root)\\n    seconds = math.floor(min(CAPS[role], state[\'clock\'].remaining()))\\n    need(seconds > 0, \'DEADLINE\')\\n    state[\'assignedSeconds\'] = seconds\\n    result = job.run_job(_worker_argv(state), str(root), root / \'jobs\' / role, seconds,\\n                         cancel=state[\'parent\'], cap=64 * 1024**2)\\n    state[\'directNativeResult\'] = result\\n    if result.get(\'success\') is True:\\n        _verified_active_sources(root)\\n        need(result.get(\'cleanupVerified\') is True and result.get(\'activeAtEnd\') == 0 and result.get(\'rootExit\') == 0 and\\n             result.get(\'rootReaped\') is True and result.get(\'logReadersStopped\') is True, \'JOB_FAILED\')\\n        return result\\n    need(role == \'cef-engine\' and result.get(\'outcome\') == \'deadline\', \'JOB_FAILED\')\\n    inspect_native_slice(result, seconds)\\n    state[\'nativeSliceResult\'] = result\\n    state[\'postSliceClock\'] = OriginalWholeClock(state[\'context\'])\\n    _post_slice_sources(state)\\n    return result\\n\\n\\ndef main(argv=None):\\n    argv = sys.argv[1:] if argv is None else argv\\n    need(type(argv) is list and len(argv) == 5 and all(type(value) is str for value in argv) and argv[0] == \'--full-sdk-engine-launcher\' and\\n         argv[1] in ROLES and re.fullmatch(\'[a-f0-9]{64}\', argv[3]) and argv[4] == \'--execute\', \'ARGV\')\\n    state = _load(argv[2], argv[3], argv[1])\\n    failed, primary = False, None\\n    try:\\n        actual_result = _run(state)\\n        completion = \'native-slice-ended\' if state.get(\'nativeSliceResult\') is actual_result else \'success\'\\n    except BaseException as error:\\n        failed, primary = True, error\\n        state[\'failed\'], state[\'primary\'] = True, error\\n    finally:\\n        state[\'closed\'] = True\\n        _ACTIVE.clear()\\n        _BIRTHS.clear()\\n","oldSha256":"f5b47458a4869bd98cbcd3497673a1058d867decd091ef414e3e9a59e5091e8e","newSha256":"281c6de87593f25b4b01878a0d173b0402d957bb56be01f13242580e7d65c65e"},{"name":"finite-5","oldRaw":"        for close in (state[\'parent\'].close, lambda: job.checked(job.close(state[\'own\']), \'engine-close-own\')):\\n            try:\\n                close()\\n            except BaseException as error:\\n                if not failed:\\n                    failed, primary = True, error\\n        if not failed:\\n            state[\'clock\'].remaining()\\n            _fence(state)\\n            report = dict(kind=\'windows-arm-full-sdk-engine-launcher-close\', role=argv[1],\\n                          success=True, parentHandleClosed=True, ownHandleClosed=True,\\n                          ownPid=state[\'pid\'], ownCreationFiletime=state[\'creation\'],\\n                          parentPid=state[\'context\'][\'parentPid\'], parentCreationFiletime=state[\'context\'][\'parentCreationFiletime\'],\\n                          sourceContextSha256=state[\'context\'][\'sourceContextSha256\'],\\n                          sdkBuilt=False, nativeAcceptance=False)\\n            with (state[\'root\'] / (\'full-sdk-engine-closed-\' + argv[1] + \'.json\')).open(\'xb\') as stream:\\n                stream.write(canonical(report) + b\'\\\\n\')\\n    if failed:\\n        raise primary\\n    return 0\\n\\n\\n","newRaw":"        for close in (state[\'parent\'].close, lambda: job.checked(job.close(state[\'own\']), \'engine-close-own\')):\\n            try:\\n                close()\\n            except BaseException as error:\\n                if not failed:\\n                    failed, primary = True, error\\n        if not failed:\\n            (state.get(\'postSliceClock\') or state[\'clock\']).remaining()\\n            _fence(state)\\n            report = dict(kind=\'windows-arm-full-sdk-engine-launcher-close\', role=argv[1],\\n                          success=True, parentHandleClosed=True, ownHandleClosed=True,\\n                          ownPid=state[\'pid\'], ownCreationFiletime=state[\'creation\'],\\n                          parentPid=state[\'context\'][\'parentPid\'], parentCreationFiletime=state[\'context\'][\'parentCreationFiletime\'],\\n                          sourceContextSha256=state[\'context\'][\'sourceContextSha256\'],\\n                          sdkBuilt=False, nativeAcceptance=False)\\n            if argv[1] == \'cef-engine\':\\n                report.update(completion=completion, jobSeconds=state[\'assignedSeconds\'])\\n                if completion == \'native-slice-ended\':\\n                    report[\'receiptPin\'] = state[\'nativeReceiptPin\']\\n            with (state[\'root\'] / (\'full-sdk-engine-closed-\' + argv[1] + \'.json\')).open(\'xb\') as stream:\\n                stream.write(canonical(report) + b\'\\\\n\')\\n    if failed:\\n        raise primary\\n    return 0\\n\\n\\n","oldSha256":"426c08a48cd090e6071c25892ac8eac24060ac9eb17f6436d0fdc933cdfcd37a","newSha256":"8f52a80ea73005a74edcf0e0d76d24be1ce0a16d1794dbdb654cea72e4a92277"}],"bytes":18390,"sha256":"8371e64fc7308df2b62b308b98035196db4fbb143f0a0d88f06c72634f143a20"}')
def engine_assembly_inverse(raw):
    spec = ENGINE_ASSEMBLY_HISTORY
    for row in reversed(spec['rows']):
        new, old = row['newRaw'].encode(), row['oldRaw'].encode()
        assert hashlib.sha256(new).hexdigest() == row['newSha256']
        assert hashlib.sha256(old).hexdigest() == row['oldSha256']
        assert raw.count(new) == 1
        raw = raw.replace(new, old, 1)
    assert len(raw) == spec['bytes'] and hashlib.sha256(raw).hexdigest() == spec['sha256']
    return raw


def packet(role='probe-clang'):
    image = '20261030.294.1'
    source = dict(kind='windows-arm-full-sdk-context', mode='full-sdk-source-gn',
                  workflow='.github/workflows/windows-arm-full-sdk.yml', ref='refs/heads/main',
                  event='workflow_dispatch', visibility='public', repositoryId='1010282954',
                  head='a' * 40, workflowSha='a' * 40, image=image, sourceId=engine.SOURCES[image],
                  target='aarch64-pc-windows-msvc', wallWholeEnd=21600, monotonicWholeEnd=21600,
                  sources=[{'path': 'native/windows-arm-full-sdk/' + name} for name in
                           ('private-qualification-profile.json', 'engine-qualification-profile.json')])
    out = 'source-checkout/src/out/Release_GN_arm64/'
    paths = ['source-inputs/0', 'source-inputs/1'] + ['private-qualification-logs/' + name for name in
        ('qual-gn-desc-pa.stdout.log', 'qual-gn-desc-cef.stdout.log', 'qual-gn-args.stdout.log')]
    paths += [out + 'args.gn', out + 'gen/base/allocator/partition_allocator/src/partition_alloc/buildflags.h',
              out + 'gen/cef/include/cef_config.h', 'full-metadata-result.json']
    pin = {'bytes': 1, 'sha256': 'b' * 64}
    value = dict(schemaVersion=1, kind='windows-arm-full-sdk-engine-context', mode='full-sdk-engine', role=role,
                 sourceContextSha256='c' * 64, image=image, sourceId=source['sourceId'], target=source['target'],
                 wallWholeEnd=21600, monotonicWholeEnd=21600, wallPhaseEnd=15000, monotonicPhaseEnd=15000,
                 parentPid=1234, parentCreationFiletime='123456789',
                 metadataFiles=[dict(relative=name, **pin) for name in paths],
                 gitPolicyFiles=[dict(relative='full-sdk-control/cef-source-git-policy/' + name, **pin)
                                 for name in ('global.gitconfig', 'system.gitconfig')],
                 prior=None if role == 'probe-clang' else dict(result=None, receipt=pin, closure=pin, launch=pin) if role == 'checkpoint-seal' else dict(result=pin, receipt=pin))
    value['gitPolicyFiles'][1].update(bytes=0, sha256=engine.digest(b''))
    return value, source


class EngineTests(unittest.TestCase):
    def tearDown(self):
        engine._ACTIVE.clear()
        engine._BIRTHS.clear()

    def test_attempt_entries_require_fixed_scope_before_files_or_native_imports(self):
        self.assertTrue(engine.NATIVE_ENGINE_ADMITTED)
        self.assertTrue(engine.EXPENSIVE_ENGINE_ADMITTED)
        for role in engine.ROLES:
            with patch.object(Path, 'open', side_effect=AssertionError('unexpected IO')):
                with self.assertRaisesRegex(ValueError, 'ENTRY_SCOPE'):
                    engine.main(['--full-sdk-engine-launcher', role, 'missing', 'a' * 64, '--execute'])

    def test_fixed_scope_paths_and_no_user_command_or_grant(self):
        for role in engine.ROLES:
            value, source = packet(role)
            self.assertIs(engine.validate_packet(value, role, source), value)
            for key, wrong in [('role', 'shell'), ('mode', 'input-closure'), ('target', 'x86_64-pc-windows-msvc'),
                               ('sourceId', 'f' * 64), ('image', '20261021.278.1'), ('parentPid', True)]:
                changed = copy.deepcopy(value)
                changed[key] = wrong
                with self.assertRaises(ValueError):
                    engine.validate_packet(changed, role, source)
            for key in ('argv', 'environment', 'root', 'qualified', 'checkpointReady'):
                changed = copy.deepcopy(value)
                changed[key] = True
                with self.assertRaisesRegex(ValueError, 'CONTEXT'):
                    engine.validate_packet(changed, role, source)
            for key in ('metadataFiles', 'gitPolicyFiles'):
                changed = copy.deepcopy(value)
                changed[key][0]['relative'] = '../escape'
                with self.assertRaisesRegex(ValueError, 'RECORD_PATHS'):
                    engine.validate_packet(changed, role, source)
                changed = copy.deepcopy(value)
                changed[key][1] = changed[key][0]
                with self.assertRaisesRegex(ValueError, 'RECORD_PATHS'):
                    engine.validate_packet(changed, role, source)
            changed = copy.deepcopy(value)
            changed['gitPolicyFiles'][1]['bytes'] = 1
            with self.assertRaisesRegex(ValueError, 'GIT_SYSTEM_PIN'):
                engine.validate_packet(changed, role, source)
            changed = copy.deepcopy(value)
            changed['metadataFiles'][4]['bytes'] = 4194304
            changed['metadataFiles'][6]['bytes'] = 8388608
            engine.validate_packet(changed, role, source)
            changed['metadataFiles'][6]['bytes'] += 1
            with self.assertRaisesRegex(ValueError, 'PIN'):
                engine.validate_packet(changed, role, source)

    def test_original_whole_ends_allow_engine_after_source_end_and_never_renew(self):
        value, source = packet()
        source['wallWorkEnd'] = source['monotonicWorkEnd'] = 7200
        engine.validate_packet(value, value['role'], source)
        clock = engine.OriginalClock(value)
        with patch.object(engine.time, 'time', return_value=10000), patch.object(engine.time, 'monotonic', return_value=10000):
            self.assertEqual(clock.remaining(), 5000)
        with patch.object(engine.time, 'time', return_value=14999), patch.object(engine.time, 'monotonic', return_value=15000):
            with self.assertRaisesRegex(ValueError, 'DEADLINE') as caught:
                clock.remaining()
        with patch.object(engine.time, 'time', return_value=0), patch.object(engine.time, 'monotonic', return_value=0):
            with self.assertRaises(ValueError) as again:
                clock.remaining()
        self.assertIs(again.exception, caught.exception)
        for key in ('wallWholeEnd', 'monotonicWholeEnd', 'wallPhaseEnd', 'monotonicPhaseEnd'):
            changed = copy.deepcopy(value)
            changed[key] = float('inf')
            with self.assertRaisesRegex(ValueError, 'CLOCK'):
                engine.validate_packet(changed, changed['role'], source)
        changed = copy.deepcopy(value)
        changed['wallPhaseEnd'] = source['wallWholeEnd']
        with self.assertRaisesRegex(ValueError, 'ORIGINAL_ENDS'):
            engine.validate_packet(changed, changed['role'], source)

    def test_canonical_root_matches_frozen_golden_names(self):
        self.assertEqual(engine.canonical_root_name('20261030.294.1', engine.SOURCES['20261030.294.1']),
                         'windows-arm-full-sdk-bb3bd4a8-e93c-44e5-81f2-3ddc15a01d19')
        self.assertEqual(engine.canonical_root_name('20261021.278.1', engine.SOURCES['20261021.278.1']),
                         'windows-arm-full-sdk-adaa4b45-ea3f-4a01-b88f-10a988c6b0ac')

    def test_json_duplicate_equivalent_key_is_denied(self):
        with self.assertRaisesRegex(ValueError, 'JSON_DUPLICATE'):
            engine._json(b'{"role":1,"r\\u006fle":2}')
        with self.assertRaises(ValueError):
            engine._json(b'{"clock":NaN}')

    def model(self, root, role='probe-clang'):
        value, _ = packet(role)
        class Clock:
            def remaining(self):
                return 899.875
        class Parent:
            def is_set(self):
                return False
        info = root.lstat()
        state = dict(root=root, context=value, profile={}, node={'path': str(root / 'node.exe')},
                     sha='d' * 64, clock=Clock(), data=None, held=[],
                     fence=[(root, (info.st_dev, info.st_ino, info.st_mode & 0o170000, getattr(info, 'st_birthtime_ns', None)))],
                     parent=Parent(), pid=engine.os.getpid(), birth=object(), closed=False, failed=False,
                     primary=None, semantic=engine.digest(engine.canonical(value)), profileSemantic=engine.digest(engine.canonical({})),
                     creation='123456')
        engine._ACTIVE[str(root)] = state
        engine._BIRTHS[state['birth']] = state
        return state

    def test_actual_run_body_forwards_fixed_argv_limits_original_budget_to_modeled_job(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            state = self.model(root)
            observed = []
            result = dict(success=True, cleanupVerified=True, activeAtEnd=0, rootExit=0, rootReaped=True, logReadersStopped=True)
            def run(*args, **kwargs):
                observed.append((args, kwargs))
                return result
            with patch.dict(sys.modules, job=types.SimpleNamespace(run_job=run)):
                self.assertIs(engine._run(state), result)
            args, kwargs = observed[0]
            self.assertEqual(args[0], engine._worker_argv(state))
            self.assertEqual(args[1:4], (str(root), root / 'jobs/probe-clang', 899))
            self.assertEqual(kwargs['cap'], 64 * 1024**2)
            self.assertIs(kwargs['cancel'], state['parent'])
            self.assertEqual(engine._worker_policy('probe-clang', state['context']),
                             dict(processes=64, memoryBytes=8 * 1024**3, cpuRate=2500))
            self.assertTrue((root / 'full-sdk-engine-probe-clang-launch.json').is_file())
            with self.assertRaisesRegex(ValueError, 'ROLE'):
                engine._worker_policy('package', state['context'])
            state['context']['role'] = 'package'
            with self.assertRaisesRegex(ValueError, 'CONTEXT_CHANGED'):
                engine._state(root=root)

    def test_actual_main_writer_closes_handles_and_emits_only_real_supervisor_deadline_shape(self):
        import acquire as data
        for outcome in ('deadline', 'compiler-failure', 'cancelled', 'output-cap'):
            with self.subTest(outcome=outcome), tempfile.TemporaryDirectory() as directory:
                root = Path(directory).resolve(strict=True)
                state = self.model(root, 'cef-engine')
                state['own'] = object()
                state['data'] = data
                closed = []
                state['parent'].close = lambda: closed.append('parent')
                result = dict(kind='owned-job-proof', outcome=outcome, success=False, rootExit=None,
                    finalRootExit=124, rootReaped=True, activeAtEnd=0, cleanupVerified=True, logReadersStopped=True,
                    cleanupBudgetMs=30000, elapsedMs=899000, started=True, jobCreated=True, assignedBeforeResume=True,
                    resumed=True, assignedAtCreationVerified=True, assignmentMode='creation-attribute', handleListOnly=True,
                    jobHandleInheritable=False, jobHandleInStdioAllowlist=False, rootPid=9999, rootCreationFiletime='999999',
                    outputCapBytes=64*1024**2, capturedBytes=0,
                    policyReadback=dict(flags=8712,activeProcessLimit=64,jobMemoryBytes='8589934592',cpuFlags=5,cpuRate=2500,inheritedHandles=3,affinityChanged=False))
                def run(*args, **kwargs):
                    output = args[2]
                    output.mkdir(parents=True)
                    (output / 'receipt.json').write_text(json.dumps(result,indent=2)+'\n')
                    return result
                def close(_):
                    closed.append('own')
                    return True
                job = types.SimpleNamespace(run_job=run, close=close, checked=lambda ok,*_: self.assertTrue(ok))
                with patch.dict(sys.modules,job=job), patch.object(engine,'_load',return_value=state), patch.object(engine,'time',types.SimpleNamespace(time=lambda:0,monotonic=lambda:0)):
                    argv=['--full-sdk-engine-launcher','cef-engine',str(root),'d'*64,'--execute']
                    if outcome == 'deadline':
                        self.assertEqual(engine.main(argv),0)
                        report=json.loads((root/'full-sdk-engine-closed-cef-engine.json').read_text())
                        raw=(root/'jobs/cef-engine/receipt.json').read_bytes()
                        self.assertEqual(report['completion'],'native-slice-ended')
                        self.assertEqual(report['jobSeconds'],899)
                        self.assertEqual(report['receiptPin'],dict(bytes=len(raw),sha256=engine.digest(raw)))
                        self.assertEqual(report['sourceContextSha256'],state['context']['sourceContextSha256'])
                        self.assertTrue(report['parentHandleClosed'] and report['ownHandleClosed'])
                        self.assertFalse(report['sdkBuilt'] or report['nativeAcceptance'])
                        self.assertFalse((root/'full-sdk-engine-cef-engine-result.json').exists())
                    else:
                        with self.assertRaisesRegex(ValueError,'JOB_FAILED'):
                            engine.main(argv)
                        self.assertFalse((root/'full-sdk-engine-closed-cef-engine.json').exists())
                self.assertEqual(closed,['parent','own'])
                self.assertTrue(state['closed'])
                self.assertFalse(engine._ACTIVE)
                self.assertFalse(engine._BIRTHS)

    def test_native_deadline_reader_rejects_near_misses_and_original_whole_clock_never_renews(self):
        # Only data validation here; no injected model can mint a production issuer.
        result=dict(kind='owned-job-proof',outcome='deadline',success=False,rootExit=None,finalRootExit=124,rootReaped=True,activeAtEnd=0,
            cleanupVerified=True,logReadersStopped=True,cleanupBudgetMs=30000,elapsedMs=1000,started=True,jobCreated=True,assignedBeforeResume=True,
            resumed=True,assignedAtCreationVerified=True,assignmentMode='creation-attribute',handleListOnly=True,jobHandleInheritable=False,
            jobHandleInStdioAllowlist=False,rootPid=1,rootCreationFiletime='1',outputCapBytes=67108864,capturedBytes=0,
            policyReadback=dict(flags=8712,activeProcessLimit=64,jobMemoryBytes='8589934592',cpuFlags=5,cpuRate=2500,inheritedHandles=3,affinityChanged=False))
        self.assertIs(engine.inspect_native_slice(result,1),result)
        for key,value in [('outcome','compiler-failure'),('success',True),('rootExit',0),('finalRootExit',0),('activeAtEnd',False),('elapsedMs',999),('logReadersStopped',False),('capturedBytes',67108865)]:
            with self.subTest(key=key),self.assertRaises(ValueError):
                engine.inspect_native_slice(dict(result,**{key:value}),1)
        value,_=packet('cef-engine')
        clock=engine.OriginalWholeClock(value)
        with patch.object(engine,'time',types.SimpleNamespace(time=lambda:100,monotonic=lambda:200)):
            self.assertEqual(clock.remaining(),21250)
        self.assertEqual(clock.ends,(21600,21600))
        with patch.object(engine,'time',types.SimpleNamespace(time=lambda:0,monotonic=lambda:21500)):
            with self.assertRaisesRegex(ValueError,'WHOLE_DEADLINE'):
                clock.remaining()
        with patch.object(engine,'time',types.SimpleNamespace(time=lambda:0,monotonic=lambda:0)):
            with self.assertRaisesRegex(ValueError,'WHOLE_DEADLINE'):
                clock.remaining()

    def test_native_kernel_body_and_legacy_whole_files_are_exact_after_only_finite_bridges(self):
        for name, count, expected_bytes, expected_sha in (
            ('job.py', 1, 24297, 'cab8f77ef0ac1cf6ff0553b85f5eee4dad4d93338f67d96d2235db9483bc1371'),
            ('producer.py', 3, 58551, 'f5779fdafe12b42a62ebbda5680c8d2521f9a908a8791d71d54a635ec099c693')):
            import re
            raw = (engine.HERE / name).read_text().replace('\r\n', '\n')
            pattern = r'(?m)^[ ]*# BEGIN CLOSED FULL SDK ENGINE [^\n]+\n[\s\S]*?^[ ]*# END CLOSED FULL SDK ENGINE [^\n]+\n'
            self.assertEqual(len(re.findall(pattern, raw)), count)
            restored = re.sub(pattern, '', raw)
            if name == 'producer.py':
                restored = restored.replace('# END INACTIVE FULL SDK SOURCE BRIDGE\n\n\n', '# END INACTIVE FULL SDK SOURCE BRIDGE\n\n', 1)
            self.assertEqual(len(restored.encode()), expected_bytes)
            self.assertEqual(hashlib.sha256(restored.encode()).hexdigest(), expected_sha)
        tree = ast.parse((engine.HERE / 'job.py').read_text())
        call = next(n for n in ast.walk(tree) if isinstance(n, ast.FunctionDef) and n.name == 'run_job')
        self.assertNotIn('full_sdk_engine', ast.unparse(call))


class AssemblyInverse(unittest.TestCase):
    def test_exact_adapter_branch_inverse_and_tamper_denial(self):
        raw = Path(engine.__file__).read_bytes()
        engine_assembly_inverse(raw)
        for row in ENGINE_ASSEMBLY_HISTORY['rows']:
            new = row['newRaw'].encode()
            for candidate in (raw.replace(new, new + b'#tamper', 1), raw + new):
                with self.assertRaises(AssertionError):
                    engine_assembly_inverse(candidate)


if __name__ == '__main__':
    unittest.main()
