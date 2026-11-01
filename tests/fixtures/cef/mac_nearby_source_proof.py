"""Closed owned Nearby literal proof; no production, compiler or SDK writes."""
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path, PurePosixPath
import platform
import re
import stat
import sys
import time

spec=importlib.util.spec_from_file_location('nearby_proof_base',Path(__file__).with_name('mac_owned_source_proof.py'))
base=importlib.util.module_from_spec(spec);spec.loader.exec_module(base)
spec=importlib.util.spec_from_file_location('nearby_inode_base',Path(__file__).with_name('mac_intel_owned_source_proof.py'))
inode=importlib.util.module_from_spec(spec);spec.loader.exec_module(inode)
need=base.need
BRANCH='refs/heads/codex/mac-nearby-source-qualification-20261101'
CURRENT_STAGE='arguments'
STAGES=('arguments','host','authority','python-pin','output','owned-root','arm','intel','cleanup','report')
NEGATIVES=('populated-gitlink','wrong-target','wrong-head','wrong-gitmodules','wrong-link-kind',
           'missing-gitlink','unknown-missing-link','same-length-corruption','legacy-sidecar',
           'changed-literal-binding','wrong-identity','root-replacement','held-fd-drift','close-fault')


class NearbyTree(base.OwnedTree):
    def __init__(self,module,receipt):
        self.root=module._mac_nearby_owned_proof_path(receipt)
        self.created={self.root:base.owner(self.root.lstat())}
        self.check(self.root)
    def remove(self,path):
        info=self.check(path);self.check(path.parent)
        need(path!=self.root)
        if stat.S_ISDIR(info.st_mode):
            with os.scandir(path)as entries:need(next(entries,None)is None)
            path.rmdir()
        else:path.unlink()
        del self.created[path]
    def relocate(self,path,destination):
        self.check(path);self.check(path.parent)
        need(destination.parent==path.parent and not os.path.lexists(destination))
        moved={p:destination/p.relative_to(path) for p in self.created if p==path or path in p.parents}
        for original in moved:
            info=self.check(original)
            if stat.S_ISDIR(info.st_mode):
                with os.scandir(original)as entries:
                    for item in entries:need(original/item.name in self.created)
        replacement={moved.get(p,p):identity for p,identity in self.created.items()}
        os.rename(path,destination)
        self.created=replacement  # Transfer the genuine receipts before checks.
        for current in moved.values():self.check(current)


def fixture(tree,module,budget,intel):
    prefix=('intel'if intel else'arm')+'/work'
    work=tree.directory(prefix);root=tree.directory(prefix+'/source')
    output=tree.directory(prefix+'/source/src/out/'+('Release_GN_x64'if intel else'Release_GN_arm64'))
    registry=("entries = {'src':'https://public.example/src','"+module.NEARBY_ROOT+"':'https://public.example/nearby'}\n").encode()
    tree.file(prefix+'/source/.gclient_entries',registry)
    for repository in('src','src/cef','depot_tools'):
        tree.file(prefix+'/source/'+repository+'/.git/HEAD',b'a'*40+b'\n')
    tree.file(prefix+'/source/'+module.NEARBY_ROOT+'/.git/HEAD',(module.NEARBY_HEAD+'\n').encode())
    raw=module.source_read_bytes(Path(__file__).with_name('mac_nearby.gitmodules'),budget,1512)
    need(len(raw)==1512 and hashlib.sha256(raw).hexdigest()==module.NEARBY_MODULES_SHA256)
    tree.file(prefix+'/source/'+module.NEARBY_ROOT+'/.gitmodules',raw)
    for origin,target,gitlink,_,_ in module.NEARBY_LITERAL_LINKS:
        tree.directory(prefix+'/source/'+module.NEARBY_ROOT+'/'+gitlink)
        tree.link(prefix+'/source/'+module.NEARBY_ROOT+'/'+origin,target)
    tree.file(prefix+'/source/src/input.cc',b'owned Nearby fixture input\n')
    tree.link(prefix+'/source/src/input-link','input.cc')
    identity={key:hashlib.sha256(('synthetic-owned-nearby-proof-'+key).encode()).hexdigest()
              for key in('producer','tools','graph','siso')}
    identity.update(target='x86_64-apple-darwin'if intel else'aarch64-apple-darwin',
        source=module.MAC_INTEL_SOURCE if intel else module.MAC_SOURCE,
        canonicalRoot=str(work),image=base.IMAGE)
    return work,root,output/module.SOURCE_METADATA_NAME,identity


def roundtrip(tree,module,budget,intel):
    work,root,sidecar,identity=fixture(tree,module,budget,intel)
    platform_policy='mac-intel'if intel else'mac-arm'
    def codec(mode):
        budget.check()
        with module.source_io_scope(mode):
            result=module._source_metadata_owned_codec(mode,root,sidecar,identity,work,budget,platform_policy)
        need(result['complete'] and not module.SOURCE_CLOSE_FAILURE and not module.SOURCE_JOIN_FAILURE)
        return result
    def context():
        return {**module.source_repositories(root,budget),'mac':True,'ownedMacIntel'if intel else'ownedMacArm':True,
            'nearbyLiteralPolicy':module.MAC_NEARBY_LITERAL_POLICY,'_macNearbyReceipt':module._MAC_NEARBY_PROOF_WRITER.get(),
            '_macNearbyIdentity':dict(identity),'_macNearbyRoot':root,'_macNearbyPlatform':platform_policy}
    recorded=codec('source-record');tree.adopt_file(sidecar,128*1024)
    original=module.source_read_bytes(sidecar,budget,128*1024);stored=json.loads(original)
    need(stored['schemaVersion']==2 and stored['snapshot']['literalLinks']==module._mac_nearby_portable_declarations())
    need(len(stored['snapshot']['literalLinks'])==5 and all('birthIdentity'not in row and 'birthNs'not in row for row in stored['snapshot']['entries']))
    need(codec('source-verify')['complete'])
    old={path.relative_to(root):tree.check(path) for path in tree.created if path==root or root in path.parents}
    retired=root.with_name('source-retired');tree.relocate(root,retired)
    work,root,sidecar,identity=fixture(tree,module,budget,intel)
    for relative,before in old.items():
        if relative==sidecar.relative_to(root):continue
        after=tree.check(root/relative)
        need((before.st_dev,before.st_ino)!=(after.st_dev,after.st_ino))
    tree.file(str(sidecar.relative_to(tree.root)),original,maximum=128*1024)
    file=root/'src/input.cc';info=tree.check(file)
    fd=os.open(file,os.O_RDONLY|os.O_NOFOLLOW)
    try:
        need(base.owner(os.fstat(fd))==base.owner(info))
        os.utime(fd,ns=(info.st_atime_ns,info.st_mtime_ns+2_000_000_000))
    finally:os.close(fd)
    try:codec('source-verify')
    except module.CheckpointError as error:need(str(error)=='source-metadata-postcheck')
    else:need(False)
    need(codec('source-apply')['complete'] and codec('source-verify')['complete'])
    facts={}
    def denied(action):
        before={path:tree.check(path).st_mtime_ns for path in tree.created}
        utime=module.os.utime;calls=0
        def observe(*args,**kwargs):
            nonlocal calls
            calls+=1
            return utime(*args,**kwargs)
        module.os.utime=observe
        try:
            try:action()
            except(module.CheckpointError,OSError):pass
            else:need(False)
        finally:module.os.utime=utime
        need(calls==0 and before=={path:tree.check(path).st_mtime_ns for path in tree.created})
    first=module.NEARBY_LITERAL_LINKS[0]
    link=root/module.NEARBY_ROOT/first[0];gitlink=root/module.NEARBY_ROOT/first[2]
    injected=tree.file(str((gitlink/'must-deny').relative_to(tree.root)),b'not empty')
    try:denied(lambda:codec('source-apply'));facts['populated-gitlink']=True
    finally:tree.remove(injected)
    content=module.source_read_bytes(file,budget,4096)
    for name,path,changed in(
        ('wrong-head',root/module.NEARBY_ROOT/'.git/HEAD',b'b'*40+b'\n'),
        ('wrong-gitmodules',root/module.NEARBY_ROOT/'.gitmodules',b'not the pinned modules\n'),
        ('same-length-corruption',file,bytes([content[0]^1])+content[1:])):
        raw=module.source_read_bytes(path,budget,4096);inode.replace_input(tree,path,changed)
        try:denied(lambda:codec('source-apply'));facts[name]=True
        finally:inode.replace_input(tree,path,raw)
    raw_target=os.readlink(link);relative=str(link.relative_to(tree.root))
    tree.remove(link);tree.link(relative,'../../foreign-target')
    try:denied(lambda:codec('source-apply'));facts['wrong-target']=True
    finally:tree.remove(link);tree.link(relative,raw_target)
    tree.remove(link);tree.file(relative,b'not a symlink')
    try:denied(lambda:codec('source-apply'));facts['wrong-link-kind']=True
    finally:tree.remove(link);tree.link(relative,raw_target)
    target_relative=str(gitlink.relative_to(tree.root));tree.remove(gitlink)
    try:denied(lambda:codec('source-apply'));facts['missing-gitlink']=True
    finally:tree.directory(target_relative)
    extra=tree.link(str((root/'src/unknown-missing-link').relative_to(tree.root)),'unknown-missing-target')
    try:denied(lambda:codec('source-apply'));facts['unknown-missing-link']=True
    finally:tree.remove(extra)
    for name,changed in(
        ('legacy-sidecar',{**stored,'schemaVersion':1,'policy':module.MAC_INTEL_SOURCE_METADATA_POLICY if intel else module.MAC_SOURCE_METADATA_POLICY}),
        ('wrong-identity',{**stored,'identity':{**identity,'source':'0'*64}})):
        sidecar.write_bytes((json.dumps(changed)+'\n').encode())
        try:denied(lambda:codec('source-apply'));facts[name]=True
        finally:sidecar.write_bytes(original)
    changed=copy.deepcopy(stored);changed['snapshot']['literalLinks'][0]['gitlinkCommit']='0'*40
    sidecar.write_bytes((json.dumps(changed)+'\n').encode())
    try:denied(lambda:codec('source-apply'));facts['changed-literal-binding']=True
    finally:sidecar.write_bytes(original)
    # Replacing the root DURING an observation must fail despite the still-live
    # held root descriptor; an independent restored tree was allowed above.
    root_denied=False
    try:
        with module.source_nearby_literals(root,context(),budget)as state:
            moved=root.with_name('source-during-observation');tree.relocate(root,moved)
            tree.directory(str(root.relative_to(tree.root)))
            try:
                # Capture times after the deliberate rename. The actual guard
                # check itself must perform no timestamp writes.
                denied(lambda:module.source_nearby_check(state,budget));root_denied=True
            finally:tree.remove(root);tree.relocate(moved,root)
    except(module.CheckpointError,OSError):need(root_denied)
    need(root_denied);facts['root-replacement']=True
    # Inject a changed observation for this one held descriptor, never a
    # successful fake close or suppression of a real timestamp write.
    def drift_fd():
        with module.source_nearby_literals(root,context(),budget)as state:
            fd=next(iter(state['directories'].values()))[1];fstat=module.os.fstat
            def drift(current):
                info=fstat(current)
                if current!=fd:return info
                fields={key:getattr(info,key)for key in('st_dev','st_ino','st_mode','st_size','st_nlink','st_mtime_ns','st_ctime_ns','st_uid','st_gid')}
                for key in('st_birthtime_ns','st_birthtime'):
                    if hasattr(info,key):fields[key]=getattr(info,key)
                fields['st_uid']+=1
                return type('ChangedHeldObservation',(),fields)()
            module.os.fstat=drift
            try:module.source_nearby_check(state,budget)
            finally:module.os.fstat=fstat
    denied(drift_fd);facts['held-fd-drift']=True
    # A real close followed by a reported fault must deny and retire all owned
    # witness FDs. The next genuine codec operation reinitializes its own flags.
    witness_fds=[];closed_once=set();close=module.os.close
    def fault_close(fd):
        close(fd)
        if fd in witness_fds and not closed_once:
            closed_once.add(fd);raise OSError('controlled close report')
    module.os.close=fault_close
    try:
        try:
            with module.source_nearby_literals(root,context(),budget)as state:
                witness_fds=[row[1]for row in state['directories'].values()]+[state['macRoot'][1]]
        except OSError:need(module.SOURCE_CLOSE_FAILURE and len(closed_once)==1)
        else:need(False)
    finally:module.os.close=close
    for fd in witness_fds:
        try:os.fstat(fd)
        except OSError as error:need(error.errno==9)
        else:need(False)
    facts['close-fault']=True
    need(set(facts)==set(NEGATIVES) and all(facts.values()))
    need(codec('source-apply')['complete'] and codec('source-verify')['complete'])
    need(module.source_read_bytes(sidecar,budget,128*1024)==original and not(root/'acquisition-logs'/module.SOURCE_STAT_CACHE_NAME).exists())
    return {'target':identity['target'],'source':identity['source'],'policy':stored['policy'],'schemaVersion':2,
        'recorded':recorded['complete'],'recreatedDistinctInodes':True,'applied':True,'verified':True,
        'literalRows':5,'portableLiteralBindingVerified':True,'sidecarUnchanged':True,'noLinuxStatCache':True,
        'birthIdentityPortable':False,'negativeCases':facts,'complete':True}


def preflight(args):
    global CURRENT_STAGE
    need(len(args)==2 and args[0]=='--output')
    CURRENT_STAGE='host'
    need(sys.platform=='darwin' and platform.machine()=='x86_64' and os.environ.get('ImageOS')=='macos15' and os.environ.get('ImageVersion')==base.IMAGE)
    CURRENT_STAGE='authority'
    need(os.environ.get('GITHUB_ACTIONS')=='true' and os.environ.get('RUNNER_ENVIRONMENT')=='github-hosted' and os.environ.get('GITHUB_REPOSITORY_VISIBILITY')=='public' and
        os.environ.get('GITHUB_REPOSITORY')=='supermarsx/sortOfRemoteNG' and os.environ.get('GITHUB_REPOSITORY_ID')=='1010282954' and
        os.environ.get('GITHUB_EVENT_NAME')=='workflow_dispatch' and os.environ.get('GITHUB_REF')==BRANCH and
        re.fullmatch('[a-f0-9]{40}',os.environ.get('GITHUB_SHA','')) and os.environ.get('GITHUB_WORKFLOW_SHA')==os.environ['GITHUB_SHA'] and
        os.environ.get('GITHUB_WORKFLOW_REF')=='supermarsx/sortOfRemoteNG/.github/workflows/cef-mac-nearby-source-proof.yml@'+BRANCH)
    CURRENT_STAGE='python-pin'
    executable=PurePosixPath(sys.executable)
    need(executable.is_absolute() and executable.anchor=='/' and str(executable)==sys.executable and '..'not in executable.parts and '\\'not in sys.executable and
        executable.name==PurePosixPath(base.PYTHON).name and base.interpreter_relation()['canonicalMatch']is True)
    base.verify_python()
    CURRENT_STAGE='output'
    output=Path(args[1]);temp=Path(os.environ['RUNNER_TEMP'])
    need(str(temp)=='/Users/runner/work/_temp' and temp.resolve(strict=True)==temp and output.parent==temp and
        re.fullmatch('cef-mac-nearby-owned-proof-'+base.UUID,output.name) and not os.path.lexists(output))
    started=int(os.environ['CEF_MAC_NEARBY_JOB_STARTED_MS']);now=time.time_ns()//1_000_000
    child_end=int(os.environ['CEF_MAC_NEARBY_CHILD_DEADLINE_MS'])
    seconds=min(95,(started+300000-now-30000)//1000,(child_end-now)//1000)
    need(started>0 and now>=started and child_end<=started+300000-30000 and seconds>=15)
    module=base.helper();need(type(module.MAC_NEARBY_LITERAL_PRODUCTION_ADMITTED)is bool)
    return output,module,module.Budget(seconds-2)


def main(args):
    global CURRENT_STAGE
    output,module,budget=preflight(args);tree=None;receipt=None;clean=False;closed=False;retired=False
    report={'schemaVersion':2,'kind':'sorng-mac-nearby-owned-source-proof','complete':False,'hostPlatform':'darwin',
        'hostArchitecture':'x86_64','image':base.IMAGE,'productionLiteralAdmission':False,'productionInputWrites':False,
        'scopedLiteralPolicyAvailable':module.MAC_NEARBY_LITERAL_PRODUCTION_ADMITTED,
        'compilerExecuted':False,'sdkBuilt':False,'nativeAcceptance':False,'runtimeReady':False,
        'publicDeniedBefore':False,'publicDeniedAfter':False,'cases':[],'failureStage':None,'failureCode':None}
    def public_denied():
        # Availability of a canonical policy is independent of this proof's
        # creation-only scope. No production capability is minted here.
        need(type(module.MAC_NEARBY_LITERAL_PRODUCTION_ADMITTED)is bool)
        for policy in('mac-arm','mac-intel'):
            for mode in module.SOURCE_IO_MODES:
                try:module.source_metadata(mode,output/'must-not-read',output/'must-not-write',{},platform_policy=policy)
                except module.CheckpointError:pass
                else:need(False)
    CURRENT_STAGE='owned-root'
    try:
        with module._mac_nearby_owned_proof_tree(output,budget)as receipt:
            tree=NearbyTree(module,receipt)
            primary=None
            try:
                public_denied();report['publicDeniedBefore']=True
                for intel in(False,True):
                    CURRENT_STAGE='intel'if intel else'arm'
                    report['cases'].append(roundtrip(tree,module,budget,intel))
                public_denied();report['publicDeniedAfter']=True
            except BaseException as error:
                primary=error;report['failureStage']=CURRENT_STAGE
                raise
            finally:
                CURRENT_STAGE='cleanup'
                try:clean=tree.cleanup()
                except BaseException:
                    if primary is None:raise
        closed=True
        try:module._mac_nearby_owned_proof_path(receipt)
        except module.CheckpointError:retired=True
        else:need(False)
    except BaseException as error:
        if report['failureStage']is None:report['failureStage']=CURRENT_STAGE
        allowed={'source-sidecar-role','source-sidecar-binding','source-content-changed','source-nearby-binding','source-nearby-changed',
                 'source-nearby-absence','source-nearby-link','source-mac-nearby-proof-scope','source-metadata-postcheck','archive-deadline'}
        report['failureCode']=str(error)if type(error)is module.CheckpointError and str(error)in allowed else'NEARBY_PROOF_FAILED'
    report.update(cleanupConfirmed=clean and closed and retired and not module.SOURCE_CLOSE_FAILURE and not module.SOURCE_JOIN_FAILURE,
                  proofWriterClosed=closed,proofWriterRetired=retired)
    report['complete']=report['failureCode']is None and report['cleanupConfirmed']and len(report['cases'])==2
    CURRENT_STAGE='report';need(tree is not None)
    raw=(json.dumps(report,sort_keys=True,separators=(',',':'))+'\n').encode();need(len(raw)<=128*1024)
    tree.file('proof.json',raw,maximum=128*1024)
    need(report['complete'])


if __name__=='__main__':
    try:main(sys.argv[1:])
    except BaseException:
        print(json.dumps({'kind':'sorng-mac-nearby-proof-failure','complete':False,'stage':CURRENT_STAGE,'productionLiteralAdmission':False}))
        raise SystemExit(1)
