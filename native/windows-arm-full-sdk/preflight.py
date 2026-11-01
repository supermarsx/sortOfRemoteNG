"""Current-image data preflight and two fixed, owned version commands only.

Executing clang-cl --version is compiler executable invocation. It does not
compile an engine, fetch Chromium, run GN, produce an SDK, or admit publication.
"""
import copy
import json
from pathlib import Path
import re
import threading
import time

import producer as boot
import acquire as data
import extract

PROFILE_SHA = "87afb795b1da433070ce57702156dae2d0a3affaddb9386d2d4270748b71f5ce"
MODE = 'source-preflight'
IMAGE = '20261030.294.1'
ROLES = ('sdk-data','llvm-data','runtime-closure','git-version','clang-version')


def profile(clock):
    _, raw = data.held(boot.HERE/'preflight-profile.json',clock,sha256=PROFILE_SHA,
                       retain=True,maximum=32768)
    p = json.loads(raw)
    data.need(p['kind']=='windows-arm-current-source-preflight' and
              p['image']==IMAGE and p['ref']==boot.PREFLIGHT_REF and p['mode']==MODE and
              p['baseProfileSha256']==boot.PROFILE_SHA and
              p['benignVersionExecutionAllowed'] is True and
              all(p[key] is False for key in ('sourceFetchAllowed','gnAllowed',
                  'engineCompilationAllowed','sdkAllowed','publicationAllowed')),
              'FULL_PREFLIGHT_PROFILE')
    return p


def reviewed_profile(base, selected):
    # The old source-GN profile and authority are never changed in place.
    p = copy.deepcopy(base)
    p['image']=IMAGE
    p['sourceGn']['hostClosure']=copy.deepcopy(selected['hostClosure'])
    p['sourceGn']['hostTools']=copy.deepcopy(selected['hostTools'])
    boot.source_host_closure_rows(p,IMAGE,reviewed_image=IMAGE)
    return p


def authority(c, selected):
    data.need(c['mode']==MODE and c['image']==IMAGE and
              c['ref']==selected['ref']==boot.PREFLIGHT_REF and
              c['workflow']==boot.PREFLIGHT_SOURCES[0], 'FULL_PREFLIGHT_AUTHORITY')


def host_closure(base, selected, clock):
    return boot.verify_source_host_closure(reviewed_profile(base,selected),clock,IMAGE,
                                         reviewed_image=IMAGE)


def clang_closure(root, base, selected, clock):
    # Independently pinned runtime rows, never identities learned from this run.
    # The fresh-image installed runtime can fail these older reviewed pins; a
    # mismatch stops before either version command instead of admitting new DLLs.
    names={Path(row['destination']).name.lower():row for row in base['runtime17']['rows']
           if row['machine']==0x8664}
    for row in names.values():
        pin,raw=extract.held(root/row['destination'],clock,row['bytes'],row['sha256'],
                             retain=True,maximum=8*1024**2)
        pe=extract.pe_metadata(raw)
        data.need(pe['machine']==0x8664 and pe['imports']==row['imports'] and
                  pe['delayImports']==row['delayImports'], 'FULL_PREFLIGHT_RUNTIME_PE')
    pin,raw=extract.held(root/'llvm/bin/clang-cl.exe',clock,selected['clang']['bytes'],
                         base['llvm']['clangSha256'],retain=True,maximum=256*1024**2)
    pe=extract.pe_metadata(raw)
    # Passive inspection of the exact official archive established these seven
    # system imports. No wildcard API-set or unreviewed private DLL admission.
    data.need(pe['machine']==0x8664 and pe['imports']==selected['clang']['imports'] and
              pe['delayImports']==selected['clang']['delayImports'],
              'FULL_PREFLIGHT_CLANG_IMPORT')
    # The SDK/LLVM extraction is hash pinned. Deny DLLs adjacent to the compiler
    # so only the fixed-image system names may resolve. The compiler has a
    # static CRT and does not need the projected runtime on its search PATH.
    with __import__('os').scandir(data.plain(root/'llvm/bin')) as entries:
        for index,entry in enumerate(entries):
            clock.remaining()
            data.need(index<1024 and not entry.name.lower().endswith('.dll'),
                      'FULL_PREFLIGHT_CLANG_SHADOW')
    return {'compilerSha256':pin['sha256'],'runtimeFiles':len(names),
            'systemNameBytesProven':False,'expectedByteSetVerified':True}


def version_argv(role, root, base, selected):
    data.need(role in ('git-version','clang-version'),'FULL_PREFLIGHT_COMMAND')
    executable=(selected['hostTools']['git']['path'] if role=='git-version'
                else str(Path(root)/'llvm/bin/clang-cl.exe'))
    return [executable,'--version']


def closed_command(argv, root, base, c, clock):
    data.need(Path(root)==Path.cwd(),'FULL_PREFLIGHT_CWD')
    selected=profile(clock);authority(c,selected)
    role=next((role for role in ('git-version','clang-version')
               if argv==version_argv(role,root,base,selected)),None)
    data.need(role is not None,'FULL_PREFLIGHT_COMMAND')
    # Admission rechecks bytes immediately before the existing suspended/owned
    # Job launch, in addition to the parent phase boundary and post checks.
    host_closure(base,selected,clock)
    clang_closure(Path(root),base,selected,clock)
    return role


def version_environment(role, root, original):
    data.need(role in ('git-version','clang-version'),'FULL_PREFLIGHT_COMMAND')
    root=data.plain(root)
    env=dict(original)
    data.need(set(env)=={'PATH','SystemRoot','WINDIR','TEMP','TMP','USERPROFILE',
                        'PYTHONDONTWRITEBYTECODE'} and
              env['PATH']=='C:/Windows/System32','FULL_PREFLIGHT_ENVIRONMENT')
    if role=='git-version':
        # No inherited token, caller HOME, Git config, hook, or network options.
        extract.held(root/'home/empty-gitconfig',
                     data.Clock(time.time()+5,time.monotonic()+5),0,boot.digest(b''),maximum=1)
        env.update(GIT_CONFIG_NOSYSTEM='1',GIT_CONFIG_GLOBAL=str(root/'home/empty-gitconfig'),
                   GIT_TERMINAL_PROMPT='0',GIT_OPTIONAL_LOCKS='0')
    return env


def version_output(root,role,clock):
    _,out=data.held(root/'jobs'/role/'stdout.log',clock,retain=True,maximum=32768)
    _,err=data.held(root/'jobs'/role/'stderr.log',clock,retain=True,maximum=32768)
    text=out.decode('utf-8','strict')
    data.need(not err and len(text)<=32768 and '\x00' not in text and
              re.match(r'git version [0-9][^\r\n]{0,128}(?:\r?\n)?\Z' if role=='git-version'
                       else r'(?:clang|clang-cl) version [0-9]',text),
              'FULL_PREFLIGHT_VERSION_OUTPUT')
    return {'stdoutBytes':len(out),'stdoutSha256':boot.digest(out),
            'stderrBytes':len(err),'fixedVersionCommand':True}


def run(root,c,base,clock):
    import job
    result={'kind':'windows-arm-current-source-preflight','success':False,
            'firstFailure':None,'jobs':[], 'compilerExecutableInvoked':False,
            'engineCompilationAttempted':False,'sourceFetched':False,'gnExecuted':False,
            'pinnedSetupSourcesAcquired':False,
            'sdkBuilt':False,'nativeAcceptance':False,'publicationAllowed':False}
    parent=None
    try:
        selected=profile(clock);authority(c,selected)
        result['hostClosureBeforeAcquisition']=host_closure(base,selected,clock)
        data.need(__import__('shutil').disk_usage(root).free>=base['limits']['freeBytes'],
                  'BOOT_CAPACITY')
        # Git version is config-free. The owned empty file is never installed.
        with (root/'home/empty-gitconfig').open('xb') as empty:empty.write(b'')
        parent=job.ParentCancel(threading.Event())
        for role in ROLES:
            boot.verified_sources(root)
            version=role in ('git-version','clang-version')
            if version:
                host_closure(base,selected,clock);clang_closure(root,base,selected,clock)
            argv=(version_argv(role,root,base,selected) if version
                  else boot.worker_argv(role,root,base))
            allotted={'sdk-data':1170,'llvm-data':300,'runtime-closure':720,
                      'git-version':15,'clang-version':15}[role]
            seconds=min(allotted,clock.remaining()-base['limits']['finalReserveSeconds']-3)
            data.need(seconds>0,'BOOT_ADMISSION')
            # Invoking clang --version is a compiler executable invocation,
            # even when its Job later fails. Never infer nonexecution from exit.
            if role=='clang-version':result['compilerExecutableInvoked']=None
            primary=None
            try:
                observed=job.run_job(argv,str(root),root/'jobs'/role,seconds,cancel=parent,cap=32768 if version else 131072)
                result['jobs'].append({'role':role,'originalJob':observed})
                if role=='clang-version':
                    result['compilerExecutableInvoked']=(True if observed.get('resumed') is True
                        else None if observed.get('started') else False)
                data.need(observed.get('success') is True and observed.get('cleanupVerified') is True and
                          observed.get('rootExit')==0 and observed.get('activeAtEnd')==0,
                          'FULL_PREFLIGHT_JOB')
                if role=='llvm-data':result['pinnedSetupSourcesAcquired']=True
            except BaseException as error:
                primary=error
            finally:
                if version:
                    try:
                        host_closure(base,selected,clock);clang_closure(root,base,selected,clock)
                        result[role+'PostVerified']=True
                    except BaseException as error:
                        result[role+'PostVerified']=False
                        result['closurePostFailure']=boot.failure(error)
                        if primary is None:primary=error
            if primary is not None:raise primary
            if version:
                result[role]=version_output(root,role,clock)
        result['success']=True
    except BaseException as error:
        result['firstFailure']=boot.failure(error)
    finally:
        if parent is not None:
            try:parent.close();result['parentHandleClosed']=True
            except BaseException:
                result['parentHandleClosed']=False;result['success']=False
                result['firstFailure']=result['firstFailure'] or 'BOOT_PARENT_CLOSE'
        try:
            boot.verified_sources(root);clock.remaining();result['sourcePostVerified']=True
        except BaseException:
            result['sourcePostVerified']=False;result['success']=False
            result['firstFailure']=result['firstFailure'] or 'BOOT_POSTCHECK'
        boot.retain(root,'preflight-result.json',result)
    return 0 if result['success'] else 1
