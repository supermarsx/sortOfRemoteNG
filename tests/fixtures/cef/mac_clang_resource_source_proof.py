"""One real Darwin scratch codec proof. No production, GN or compiler grant."""
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import stat
import sys
import time
import uuid

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('clang_nearby_ledger',HERE/'mac_nearby_source_proof.py')
nearby=importlib.util.module_from_spec(spec);spec.loader.exec_module(nearby)
base=nearby.base
need=base.need
BRANCH='refs/heads/codex/mac-clang-resource-metadata-20261102'
WORKFLOW='supermarsx/sortOfRemoteNG/.github/workflows/cef-mac-clang-resource-proof.yml@'+BRANCH
STAGES=('arguments','authority','python-pin','source-witness','owned-root','arm','intel','cleanup','report')
CURRENT_STAGE='arguments'
NEGATIVES=('missing-link','extra-row','wrong-link-kind','wrong-literal','target-file','target-directory',
 'target-symlink','changed-deps','changed-head','same-length-corruption','changed-provenance','missing-compiler-rows',
 'schema1','schema2','v3-to-v2-writer','linux-kind-spoof','wrong-target','wrong-source','wrong-image','wrong-mode',
 'unknown-dangling','root-replacement','held-fd-rebinding','absence-transition','creator-expiry','close-fault')


class ClangTree(nearby.NearbyTree):
    def __init__(self,module,receipt,budget):
        self.root=module._mac_clang_owned_proof_path(receipt)
        self.created={self.root:base.owner(self.root.lstat())}
        self.budget=budget
        self.check(self.root)
    def file(self,relative,raw,maximum=4096):
        self.budget.check()
        need(maximum in (4096,128*1024,197649,26191)and type(raw)is bytes and len(raw)<=maximum)
        file=self.root/relative;self.directory(str(Path(relative).parent))
        fd=os.open(file,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
        try:
            info=os.fstat(fd);self.created[file]=base.owner(info)
            need(stat.S_ISREG(info.st_mode)and info.st_nlink==1)
            at=0
            while at<len(raw):
                self.budget.check();count=os.write(fd,raw[at:]);need(count>0);at+=count
            need(base.owner(file.lstat())==base.owner(os.fstat(fd))==self.created[file])
        finally:os.close(fd)
        return file
    def replace(self,file,raw):
        self.budget.check();need(type(raw)is bytes and len(raw)<=197649)
        before=self.check(file);need(stat.S_ISREG(before.st_mode)and before.st_nlink==1)
        fd=os.open(file,os.O_RDWR|os.O_NOFOLLOW)
        try:
            need(base.owner(os.fstat(fd))==base.owner(before))
            at=0
            while at<len(raw):
                self.budget.check();count=os.write(fd,raw[at:]);need(count>0);at+=count
            os.ftruncate(fd,len(raw))
            need(base.owner(os.fstat(fd))==base.owner(file.lstat())==self.created[file])
        finally:os.close(fd)


def fixture(tree,module,budget,intel):
    prefix=('intel'if intel else'arm')+'/work'
    work=tree.directory(prefix);root=tree.directory(prefix+'/source')
    out=tree.directory(prefix+'/source/src/out/'+('Release_GN_x64'if intel else'Release_GN_arm64'))
    tree.directory(prefix+'/source/acquisition-logs')
    repositories=('src','src/cef','depot_tools',module.NEARBY_ROOT,module.MAC_CLANG_SOURCE_ROWS[1][1])
    entries={name:'https://public.example/'+str(index)for index,name in enumerate(repositories)if name!='depot_tools'}
    tree.file(prefix+'/source/.gclient_entries',('entries = '+repr(entries)+'\n').encode())
    for repository in repositories:tree.file(prefix+'/source/'+repository+'/.git/HEAD',b'a'*40+b'\n')
    def replace(name,raw):tree.replace(root/name,raw)
    for row,witness in zip(module.MAC_CLANG_SOURCE_ROWS,('mac_clang_chromium.DEPS','mac_clang_openscreen.DEPS')):
        directory,repository,head,deps,size,sha,*_=row
        replace(repository+'/.git/HEAD',(head+'\n').encode())
        raw=module.source_read_bytes(HERE/witness,budget,size)
        need(len(raw)==size and hashlib.sha256(raw).hexdigest()==sha)
        tree.file(prefix+'/source/'+deps,raw,maximum=size)
        for origin,target in module.MAC_CLANG_RUNTIME_ALIASES:
            tree.link(prefix+'/source/'+directory+'/lib/clang/24/lib/'+origin,target)
    replace(module.NEARBY_ROOT+'/.git/HEAD',(module.NEARBY_HEAD+'\n').encode())
    raw=module.source_read_bytes(HERE/'mac_nearby.gitmodules',budget,1512)
    need(len(raw)==1512 and hashlib.sha256(raw).hexdigest()==module.NEARBY_MODULES_SHA256)
    tree.file(prefix+'/source/'+module.NEARBY_ROOT+'/.gitmodules',raw)
    for origin,target,gitlink,_,_ in module.NEARBY_LITERAL_LINKS:
        tree.directory(prefix+'/source/'+module.NEARBY_ROOT+'/'+gitlink)
        tree.link(prefix+'/source/'+module.NEARBY_ROOT+'/'+origin,target)
    tree.file(prefix+'/source/src/input.cc',b'owned clang-resource fixture input\n')
    tree.link(prefix+'/source/src/input-link','input.cc')
    identity={key:hashlib.sha256(('synthetic-owned-clang-proof-'+key).encode()).hexdigest()for key in('producer','tools','graph','siso')}
    identity.update(target='x86_64-apple-darwin'if intel else'aarch64-apple-darwin',
        source=module.MAC_INTEL_SOURCE if intel else module.MAC_SOURCE,canonicalRoot=str(work),image=base.IMAGE)
    return work,root,out/module.SOURCE_METADATA_NAME,identity


def transient_creator_negative(module,budget,close_fault):
    """A shorter subordinate negative never extends the original leaf budget."""
    budget.check();root=Path(os.environ['RUNNER_TEMP'])/('cef-mac-clang-owned-proof-'+str(uuid.uuid4()))
    receipt=None;held=None;identity=None;closed_fd=None;denied=False;close=os.close
    def fault(fd):
        nonlocal closed_fd
        # The creator must revoke the opaque receipt before closing its FD.
        try:module._mac_clang_owned_proof_path(receipt)
        except module.CheckpointError:pass
        else:need(False)
        close(fd);closed_fd=fd;raise OSError('owned-close-fault')
    try:
        try:
            with module._mac_clang_owned_proof_tree(root,module.Budget(1 if not close_fault else 5))as receipt:
                identity=base.owner(root.lstat());held=os.open(root,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
                if close_fault:module.os.close=fault
                else:
                    until=time.monotonic()+1.01
                    while True:
                        budget.check();left=until-time.monotonic()
                        if left<=0:break
                        time.sleep(min(.01,left))
                    # A new operation budget must not extend creator authority.
                    module.Budget(5).check()
                    try:module._mac_clang_owned_proof_path(receipt)
                    except module.CheckpointError as error:need(str(error)=='archive-deadline');denied=True
                    else:need(False)
        except (module.CheckpointError,OSError)as error:
            if close_fault:
                need(type(error)is OSError and closed_fd is not None and module.SOURCE_CLOSE_FAILURE);denied=True
            else:need(type(error)is module.CheckpointError and str(error)=='archive-deadline'and denied)
        finally:module.os.close=close
        need(denied)
        try:module._mac_clang_owned_proof_path(receipt)
        except module.CheckpointError:pass
        else:need(False)
        if closed_fd is not None:
            try:os.fstat(closed_fd)
            except OSError:pass
            else:need(False)
    finally:
        if held is not None:
            try:
                need(base.owner(root.lstat())==identity==base.owner(os.fstat(held)))
                with os.scandir(held)as entries:need(next(entries,None)is None)
                budget.check();need(base.owner(root.lstat())==identity==base.owner(os.fstat(held)))
                root.rmdir() # Exact owned root only; no recursive cleanup/CAS claim.
            finally:close(held)
    budget.check();return denied


def roundtrip(tree,module,budget,intel):
    work,root,sidecar,identity=fixture(tree,module,budget,intel)
    selected='mac-intel'if intel else'mac-arm'
    def codec(mode):
        budget.check()
        cache_writer=module.source_mac_stat_cache_write;cache_written=False
        def observed_cache_write(cache_root,sidecar_sha,cache_identity,digests,guards):
            nonlocal cache_written
            result=cache_writer(cache_root,sidecar_sha,cache_identity,digests,guards)
            if result:
                need(mode in ('source-record','source-apply')and cache_root==root and cache_identity==identity)
                cache_written=True
            return result
        module.source_mac_stat_cache_write=observed_cache_write
        try:
            with module.source_io_scope(mode):
                value=module._source_metadata_owned_codec(mode,root,sidecar,identity,work,budget,selected)
        finally:module.source_mac_stat_cache_write=cache_writer
        need(value['complete']and not module.SOURCE_CLOSE_FAILURE and not module.SOURCE_JOIN_FAILURE)
        if cache_written:
            # Receipt comes from the actual completed writer, never an existing
            # filename. Failed/verify calls cannot adopt an unrelated member.
            tree.adopt_file(root/'acquisition-logs'/module.SOURCE_MAC_STAT_CACHE_NAME,128*1024)
        return value
    def context():
        receipt=module._MAC_CLANG_PROOF_SCOPE.get()
        return {**module.source_repositories(root,budget),'mac':True,'ownedMacIntel'if intel else'ownedMacArm':True,
            'clangLiteralPolicy':module.MAC_CLANG_LITERAL_POLICY,'_macClangReceipt':receipt,
            '_macClangIdentity':dict(identity),'_macClangRoot':root,'_macClangPlatform':selected}
    def bytes_verified(stored):
        for row in stored['snapshot']['entries']:
            budget.check();file=root/row['path'];tree.check(file)
            if row['kind']=='file':
                raw=module.source_read_bytes(file,budget,197649)
                need(len(raw)==row['size']and hashlib.sha256(raw).hexdigest()==row['sha256'])
            elif row['kind']=='symlink':need(os.readlink(file)==row['target'])
    codec('source-record');tree.adopt_file(sidecar,128*1024)
    raw=module.source_read_bytes(sidecar,budget,128*1024);stored=json.loads(raw)
    need(stored['schemaVersion']==3 and stored['snapshot']['literalLinks']==module._mac_nearby_portable_declarations()and
         stored['snapshot']['compilerLiteralLinks']==module._mac_clang_portable_declarations())
    bytes_verified(stored);need(codec('source-verify')['complete'])
    old={p.relative_to(root):tree.check(p)for p in tree.created if p==root or root in p.parents}
    old_fd=os.open(root,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    try:
        tree.relocate(root,root.with_name('source-retired'))
        work,root,sidecar,identity=fixture(tree,module,budget,intel)
        for relative,info in old.items():
            if relative in (sidecar.relative_to(root),Path('acquisition-logs')/module.SOURCE_MAC_STAT_CACHE_NAME):continue
            current=tree.check(root/relative);need((info.st_dev,info.st_ino)!=(current.st_dev,current.st_ino))
        need(base.owner(os.fstat(old_fd))==base.owner(old[Path('.')]))
        tree.file(str(sidecar.relative_to(tree.root)),raw,maximum=128*1024)
        file=root/'src/input.cc';info=tree.check(file);os.utime(file,ns=(info.st_atime_ns,info.st_mtime_ns+2000000000))
        try:codec('source-verify')
        except module.CheckpointError as error:need(str(error)=='source-metadata-postcheck')
        else:need(False)
        codec('source-apply');codec('source-verify');bytes_verified(stored)
        recorded_mtime=int(next(row['mtimeNs']for row in stored['snapshot']['entries']if row['path']=='src/input.cc'))
        need(file.lstat().st_mtime_ns==recorded_mtime and sidecar.read_bytes()==raw)
        facts={}
        def denied(action):
            before={p:tree.check(p).st_mtime_ns for p in tree.created};utime=module.os.utime;calls=0
            def observe(*args,**kwargs):
                nonlocal calls
                calls+=1;return utime(*args,**kwargs)
            module.os.utime=observe
            try:
                try:action()
                except (module.CheckpointError,OSError):pass
                else:need(False)
            finally:module.os.utime=utime
            need(calls==0 and before=={p:tree.check(p).st_mtime_ns for p in tree.created})
        parent=root/module.MAC_CLANG_SOURCE_ROWS[1][0]/'lib/clang/24/lib'
        origin,target=module.MAC_CLANG_RUNTIME_ALIASES[1];link=parent/origin;relative=str(link.relative_to(tree.root))
        tree.remove(link)
        try:denied(lambda:codec('source-apply'));facts['missing-link']=True
        finally:tree.link(relative,target)
        for name,value in (('wrong-literal','wrong-target'),('wrong-link-kind',None)):
            tree.remove(link)
            if value is None:tree.file(relative,b'not a link')
            else:tree.link(relative,value)
            try:denied(lambda:codec('source-apply'));facts[name]=True
            finally:tree.remove(link);tree.link(relative,target)
        for kind in('file','directory','symlink'):
            relative_target=str((parent/target).relative_to(tree.root))
            if kind=='file':materialized=tree.file(relative_target,b'present')
            elif kind=='directory':materialized=tree.directory(relative_target)
            else:materialized=tree.link(relative_target,'also-missing')
            try:denied(lambda:codec('source-apply'));facts['target-'+kind]=True
            finally:tree.remove(materialized)
        for name,path in(('changed-deps',root/module.MAC_CLANG_SOURCE_ROWS[1][3]),
                          ('changed-head',root/module.MAC_CLANG_SOURCE_ROWS[1][1]/'.git/HEAD'),
                          ('same-length-corruption',file)):
            content=module.source_read_bytes(path,budget,197649)
            tree.replace(path,bytes([content[0]^1])+content[1:])
            try:denied(lambda:codec('source-apply'));facts[name]=True
            finally:tree.replace(path,content)
        variants={}
        for name,version in(('schema1',1),('schema2',2)):variants[name]={**stored,'schemaVersion':version}
        changed=copy.deepcopy(stored);changed['snapshot']['compilerLiteralLinks'][0]['packageSha256']='0'*64;variants['changed-provenance']=changed
        changed=copy.deepcopy(stored);changed['snapshot']['compilerLiteralLinks'].append(changed['snapshot']['compilerLiteralLinks'][0]);variants['extra-row']=changed
        changed=copy.deepcopy(stored);del changed['snapshot']['compilerLiteralLinks'];variants['missing-compiler-rows']=changed
        for name,value in variants.items():
            tree.replace(sidecar,(json.dumps(value)+'\n').encode())
            try:denied(lambda:codec('source-apply'));facts[name]=True
            finally:tree.replace(sidecar,raw)
        for name,key in(('wrong-target','target'),('wrong-source','source'),('wrong-image','image')):
            original=identity[key];identity[key]='foreign'
            try:denied(lambda:codec('source-apply'));facts[name]=True
            finally:identity[key]=original
        denied(lambda:codec('foreign-mode'));facts['wrong-mode']=True
        extra=tree.link(str((root/'src/unknown-missing-link').relative_to(tree.root)),'missing-target')
        try:denied(lambda:codec('source-apply'));facts['unknown-dangling']=True
        finally:tree.remove(extra)
        for name,value in(('v3-to-v2-writer',{**stored,'schemaVersion':2,'policy':module.MAC_INTEL_NEARBY_METADATA_POLICY if intel else module.MAC_ARM_NEARBY_METADATA_POLICY}),
                          ('linux-kind-spoof',{**stored,'schemaVersion':1,'kind':'sorng-linuxarm-source-metadata','policy':module.SOURCE_METADATA_POLICY})):
            def write():
                with module.source_io_scope('source-record'):
                    module.SOURCE_IO_CONTEXT.set(('source-record',root))
                    module.metadata(sidecar.parent,sidecar.name,value,source=True,owned_sidecar=True)
            denied(write);facts[name]=True
        try:
            with module.source_clang_literals(root,context(),budget)as state:
                transition=tree.file(str((parent/target).relative_to(tree.root)),b'now present')
                try:denied(lambda:module.source_clang_check(state,budget));facts['absence-transition']=True
                finally:tree.remove(transition)
        except (module.CheckpointError,OSError):need(facts.get('absence-transition')is True)
        try:
            with module.source_clang_literals(root,context(),budget)as state:
                fd=state['directories'][0][1];replacement=os.open(root/'src',os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
                try:os.dup2(replacement,fd)
                finally:os.close(replacement)
                denied(lambda:module.source_clang_check(state,budget));facts['held-fd-rebinding']=True
        except (module.CheckpointError,OSError):need(facts.get('held-fd-rebinding')is True)
        try:
            with module.source_clang_literals(root,context(),budget)as state:
                moved=root.with_name('source-during-observation');tree.relocate(root,moved)
                tree.directory(str(root.relative_to(tree.root)))
                try:denied(lambda:module.source_clang_check(state,budget));facts['root-replacement']=True
                finally:tree.remove(root);tree.relocate(moved,root)
        except (module.CheckpointError,OSError):need(facts.get('root-replacement')is True)
        facts['creator-expiry']=transient_creator_negative(module,budget,False)
        facts['close-fault']=transient_creator_negative(module,budget,True)
        codec('source-apply');codec('source-verify');bytes_verified(stored)
        need(set(facts)==set(NEGATIVES)and all(facts.values())and sidecar.read_bytes()==raw and
             not (root/'acquisition-logs'/module.SOURCE_STAT_CACHE_NAME).exists())
        return {'target':identity['target'],'source':identity['source'],'policy':stored['policy'],'schemaVersion':3,
            'recorded':True,'recreatedDistinctInodes':True,'applied':True,'verified':True,'nearbyLiteralRows':5,
            'compilerLiteralRows':6,'fullByteReadbackVerified':True,'timestampReadbackVerified':True,
            'sidecarUnchanged':True,'macStatCacheCreated':False,'syntheticGitInputs':True,
            'negativeCases':facts,'complete':True}
    finally:os.close(old_fd)


def preflight(args):
    global CURRENT_STAGE
    need(len(args)==2 and args[0]=='--output');CURRENT_STAGE='authority'
    need(sys.platform=='darwin'and base.platform.machine()=='x86_64'and os.environ.get('ImageOS')=='macos15'and
         os.environ.get('ImageVersion')==base.IMAGE and os.environ.get('GITHUB_ACTIONS')=='true'and
         os.environ.get('RUNNER_ENVIRONMENT')=='github-hosted'and os.environ.get('GITHUB_REPOSITORY_VISIBILITY')=='public'and
         os.environ.get('GITHUB_REPOSITORY')=='supermarsx/sortOfRemoteNG'and os.environ.get('GITHUB_REPOSITORY_ID')=='1010282954'and
         os.environ.get('GITHUB_EVENT_NAME')=='workflow_dispatch'and os.environ.get('GITHUB_REF')==BRANCH and
         re.fullmatch('[a-f0-9]{40}',os.environ.get('GITHUB_SHA',''))and
         os.environ.get('GITHUB_WORKFLOW_SHA')==os.environ['GITHUB_SHA']and os.environ.get('GITHUB_WORKFLOW_REF')==WORKFLOW)
    for key in('GITHUB_RUN_ID','GITHUB_RUN_ATTEMPT'):need(re.fullmatch('[1-9][0-9]{0,19}',os.environ.get(key,'')))
    need(re.fullmatch('[a-f0-9]{64}',os.environ.get('CEF_MAC_CLANG_SOURCE_WITNESS_SHA256','')))
    need(re.fullmatch(base.UUID,os.environ.get('CEF_MAC_CLANG_ATTEMPT_ID','')))
    CURRENT_STAGE='python-pin';need(base.interpreter_relation()['canonicalMatch']is True);base.verify_python()
    output=Path(args[1]);temp=Path(os.environ['RUNNER_TEMP'])
    need(str(temp)=='/Users/runner/work/_temp'and output.parent==temp and
         output.name=='cef-mac-clang-owned-proof-'+os.environ['CEF_MAC_CLANG_ATTEMPT_ID']and not os.path.lexists(output))
    started=int(os.environ['CEF_MAC_CLANG_JOB_STARTED_MS']);now=time.time_ns()//1000000
    child_end=int(os.environ['CEF_MAC_CLANG_CHILD_DEADLINE_MS'])
    seconds=min(95,(started+300000-now-30000)//1000,(child_end-now)//1000)
    need(started>0 and now>=started and child_end<=started+270000 and seconds>=10)
    CURRENT_STAGE='source-witness';module=base.helper();need(module.MAC_CLANG_LITERAL_PRODUCTION_ADMITTED is False)
    observed={'source':'process-and-runner-environment','platform':sys.platform,'architecture':base.platform.machine(),
              'imageOS':os.environ['ImageOS'],'imageVersion':os.environ['ImageVersion'],
              'runnerEnvironment':os.environ['RUNNER_ENVIRONMENT'],'githubActions':os.environ['GITHUB_ACTIONS']=='true'}
    return output,module,module.Budget(seconds-2),observed


def main(args):
    global CURRENT_STAGE
    output,module,budget,observed=preflight(args);tree=None;receipt=None;clean=False;closed=False;retired=False
    cases=[];primary=None;owned_root_fd=None
    def public_denied():
        need(module.MAC_CLANG_LITERAL_PRODUCTION_ADMITTED is False)
        for intel in(False,True):
            work=output/('intel'if intel else'arm')/'work'
            identity={key:'a'*64 for key in('producer','tools','graph','siso')}
            identity.update(target='x86_64-apple-darwin'if intel else'aarch64-apple-darwin',
                source=module.MAC_INTEL_SOURCE if intel else module.MAC_SOURCE,
                canonicalRoot=str(work),image=base.IMAGE)
            for mode in module.SOURCE_IO_MODES:
                try:module.source_metadata(mode,work/'source',work/'must-not-write',identity,
                                           platform_policy='mac-intel'if intel else'mac-arm')
                except module.CheckpointError:pass
                else:need(False)
    public_denied()
    try:
        CURRENT_STAGE='owned-root'
        with module._mac_clang_owned_proof_tree(output,budget)as receipt:
            tree=ClangTree(module,receipt,budget)
            owned_root_fd=os.open(output,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
            need(base.owner(os.fstat(owned_root_fd))==tree.created[output])
            try:
                for intel in(False,True):
                    CURRENT_STAGE='intel'if intel else'arm';cases.append(roundtrip(tree,module,budget,intel))
            except BaseException as error:primary=error;raise
            finally:
                CURRENT_STAGE='cleanup'
                try:clean=tree.cleanup()
                except BaseException:
                    if primary is None:raise
        closed=True
        try:module._mac_clang_owned_proof_path(receipt)
        except module.CheckpointError:retired=True
        else:need(False)
        need(clean and closed and retired and not module.SOURCE_CLOSE_FAILURE and not module.SOURCE_JOIN_FAILURE)
        need(base.owner(tree.check(output))==tree.created[output]==base.owner(os.fstat(owned_root_fd)))
        with os.scandir(owned_root_fd)as entries:need(next(entries,None)is None)
        budget.check()
        need(base.owner(tree.check(output))==tree.created[output]==base.owner(os.fstat(owned_root_fd)))
        output.rmdir() # Checked owned root, not an atomic path/inode CAS.
        need(not os.path.lexists(output)and module.MAC_CLANG_LITERAL_PRODUCTION_ADMITTED is False)
    except BaseException as error:
        primary=error
        raise
    finally:
        if owned_root_fd is not None:
            try:os.close(owned_root_fd)
            except BaseException:
                if primary is None:raise
    public_denied();CURRENT_STAGE='report';budget.check()
    report={'schemaVersion':3,'kind':'sorng-mac-clang-resource-owned-proof','complete':True,
        'head':os.environ['GITHUB_SHA'],'runId':os.environ['GITHUB_RUN_ID'],'runAttempt':os.environ['GITHUB_RUN_ATTEMPT'],
        'attemptId':os.environ['CEF_MAC_CLANG_ATTEMPT_ID'],
        'sourceWitnessSha256':os.environ['CEF_MAC_CLANG_SOURCE_WITNESS_SHA256'],
        'hostPlatform':observed['platform'],'hostArchitecture':observed['architecture'],'image':observed['imageVersion'],
        'observedHost':observed,'cases':cases,
        'cleanupConfirmed':True,'proofWriterClosed':closed,'proofWriterRetired':retired,
        'publicV3DeniedBefore':True,'publicV3DeniedAfter':True,
        'productionClangAdmission':False,'productionInputWrites':False,'sourceAcquisition':False,'GNExecuted':False,
        'compilerExecuted':False,'sdkBuilt':False,'nativeAcceptance':False,'runtimeReady':False}
    raw=(json.dumps(report,sort_keys=True,separators=(',',':'))+'\n').encode();need(len(raw)<=128*1024)
    return raw


if __name__=='__main__':
    try:result=main(sys.argv[1:])
    except BaseException:
        print(json.dumps({'kind':'sorng-mac-clang-resource-proof-failure','complete':False,
              'stage':CURRENT_STAGE if CURRENT_STAGE in STAGES else'arguments','productionClangAdmission':False}))
        raise SystemExit(1)
    sys.stdout.buffer.write(result)
