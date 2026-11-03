"""EXPERIMENT ONLY. No production source, SDK, readiness or execution grant.

The original helper remains unchanged. Only its per-file path adapter is derived
for this fixed benchmark; all byte reads and row/FD identity checks are retained.
"""
import ast
import concurrent.futures as futures
from contextvars import copy_context
import hashlib
import os
from pathlib import Path
import stat
import threading
import types

WORKERS=4
BATCH=32

def require(ok):
    if not ok:raise RuntimeError('AMORTIZATION_CONTRACT')

def derive_hash(module,raw):
    text=raw.decode('utf8');tree=ast.parse(text)
    nodes=[n for n in tree.body if isinstance(n,ast.FunctionDef)and n.name=='source_hash']
    require(len(nodes)==1);original=ast.get_source_segment(text,nodes[0])
    old="    p = source_io_call('file-path-stat', root / row['path'], lambda: safe(root / row['path']));before = source_io_call('file-path-stat', p, p.stat)"
    require(original.count(old)==1)
    derived=original.replace('def source_hash(root, row, budget, policy=None):','def anchored_hash(root, row, budget, policy, leaf):',1).replace(old,"    p = leaf;before = source_io_call('file-path-stat', p, p.stat)",1)
    catch='    except BaseException as error:\n        primary = error\n        raise'
    require(derived.count(catch)==1)
    derived=derived.replace(catch,'    except BaseException as error:\n        primary = error\n        leaf.scope.record(error)\n        raise',1)
    restored=derived.replace('        leaf.scope.record(error)\n','',1)
    restored=restored.replace('def anchored_hash(root, row, budget, policy, leaf):','def source_hash(root, row, budget, policy=None):',1).replace("    p = leaf;before = source_io_call('file-path-stat', p, p.stat)",old,1)
    require(restored==original)
    namespace=dict(module.__dict__);exec(compile(derived,'<fixed-amortization-prototype>','exec'),namespace)
    return namespace['anchored_hash'],hashlib.sha256(original.encode()).hexdigest()

def snapshot_module(raw):
    """One finite experimental dispatcher substitution; no original file edit."""
    text=raw.decode('utf8');start=text.index('    hashes = {};first = None\n',text.index('def source_snapshot_inventory('))
    end=text.index('    budget.check()\n    if not external:',start);old=text[start:end]
    require(old.count('pool = ThreadPoolExecutor(max_workers=workers)')==1 and old.endswith('    if first is not None:\n        raise first\n'))
    mac=("    if policy.get('mac'):\n"
         "        file_rows = [row for row in rows if row['kind'] == 'file']\n"
         "        progress = SOURCE_PROGRESS if SOURCE_PROGRESS is not None else {}\n"
         "        progress.update(files=len(file_rows), bytes=sum(row['stamp'][0]for row in file_rows), hashedFiles=0, hashedBytes=0, reusedFiles=0)\n"
         "        hashes = _prototype_dispatch(root,file_rows,budget,policy,root_before,local_before,progress)\n"
         "    else:\n")
    replacement=mac+''.join('    '+line if line.strip()else line for line in old.splitlines(keepends=True))
    derived=text[:start]+replacement+text[end:]
    require(derived.count(replacement)==1 and derived.replace(replacement,old,1)==text)
    old_tree=ast.parse(text);new_tree=ast.parse(derived)
    original_hash=ast.get_source_segment(text,next(n for n in old_tree.body if isinstance(n,ast.FunctionDef)and n.name=='source_hash'))
    require(ast.get_source_segment(derived,next(n for n in new_tree.body if isinstance(n,ast.FunctionDef)and n.name=='source_hash'))==original_hash)
    module=types.ModuleType('experimental_unchanged_helpers');exec(compile(derived,'<experimental-snapshot-dispatch>','exec'),module.__dict__)
    hash_file,hash_sha=derive_hash(module,raw);observations=[]
    def invoke(root,rows,budget,policy,root_before,local_before,progress):
        result,observation=dispatch(module,hash_file,root,rows,budget,policy,root_before,local_before,progress)
        observations.append(observation);return result
    module._prototype_dispatch=invoke
    return module,observations,{'originalHashSha256':hash_sha,'dispatcherInverseExact':True,'sourceHashUnchanged':True,'derivedModuleSha256':hashlib.sha256(derived.encode()).hexdigest()}

class Stream:
    def __init__(self,scope,fd,stream):self.scope,self.fd,self.stream=scope,fd,stream
    def read(self,count):return self.stream.read(count)
    def fileno(self):return self.stream.fileno()
    def close(self):self.scope.close(self.fd,self.stream.close)

class Leaf:
    def __init__(self,scope,parent,name,path):self.scope,self.parent,self.name,self.path=scope,parent,name,path
    def __fspath__(self):return str(self.path)
    def stat(self):return os.stat(self.name,dir_fd=self.parent,follow_symlinks=False)
    def open(self,mode):
        require(mode=='rb');self.scope.check()
        fd=self.scope.open(self.name,os.O_RDONLY|os.O_NOFOLLOW,dir_fd=self.parent)
        try:stream=os.fdopen(fd,'rb')
        except BaseException as primary:
            self.scope.record(primary)
            try:self.scope.close(fd,lambda:os.close(fd))
            except BaseException:pass
            raise primary
        return Stream(self.scope,fd,stream)

class Scope:
    def __init__(self,module,root,budget,policy,root_before,local_before,hash_file):
        self.m,self.root,self.budget,self.policy=module,root,budget,policy
        self.before,self.local,self.hash_file=root_before,local_before,hash_file
        self.lock=threading.RLock();self.stop=threading.Event();self.ledger={};self.first=None;self.failed=False
        self.active=0;self.peak=0;self.opened=0;self.closed=0;self.close_attempts=0;self.unknown=0
        module.safe(root);require(module.stamp(root.stat())==root_before and module.source_local(root.stat(),policy)==local_before)
        self.rootfd=self.open(root,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
        try:self.root_check()
        except BaseException as primary:
            self.record(primary);self.finish();raise primary
    def record(self,error):
        with self.lock:
            if not self.failed:self.failed=True;self.first=error
            self.stop.set()
    def check(self):
        self.budget.check()
        if self.stop.is_set():raise RuntimeError('AMORTIZATION_REVOKED')
    def open(self,name,flags,**kwargs):
        with self.lock:
            self.check();fd=os.open(name,flags,**kwargs)
            require(fd not in self.ledger);self.ledger[fd]=False;self.opened+=1
            self.peak=max(self.peak,sum(not attempted for attempted in self.ledger.values()))
            if self.peak>1+2*WORKERS:
                self.close(fd,lambda:os.close(fd));raise RuntimeError('AMORTIZATION_FD_BOUND')
        return fd
    def close(self,fd,operation):
        with self.lock:
            require(fd in self.ledger and self.ledger[fd] is False)
            self.ledger[fd]=True;self.close_attempts+=1
            try:operation()
            except BaseException as error:
                self.unknown+=1;self.m.SOURCE_CLOSE_FAILURE=True;self.record(error);raise
            else:
                self.closed+=1;del self.ledger[fd]
    def root_check(self):
        self.check();named=self.root.lstat();held=os.fstat(self.rootfd)
        require(self.m.source_local(named,self.policy)==self.local==self.m.source_local(held,self.policy))
    def directory_check(self,name,fd):
        self.root_check();expected=self.local if name=='' else self.policy['_directories'][name]
        path=self.root/name if name else self.root
        require(self.m.source_local(path.lstat(),self.policy)==expected==self.m.source_local(os.fstat(fd),self.policy))
    def parent(self,name):
        self.m.safe(self.root/(name or '.'));self.root_check()
        if not name:return self.rootfd,False
        current=self.rootfd;owned=False;prefix=[]
        try:
            for component in Path(name).parts:
                self.check();prefix.append(component);relative='/'.join(prefix)
                expected=self.policy['_directories'][relative]
                nxt=self.open(component,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=current)
                try:
                    require(self.m.source_local(os.fstat(nxt),self.policy)==expected)
                    self.directory_check(relative,nxt)
                except BaseException as primary:
                    self.record(primary)
                    try:self.close(nxt,lambda:os.close(nxt))
                    except BaseException:pass
                    raise primary
                previous,previous_owned=current,owned;current=nxt;owned=True
                if previous_owned:self.close(previous,lambda:os.close(previous))
            return current,owned
        except BaseException as primary:
            self.record(primary)
            if owned and self.ledger.get(current) is False:
                try:self.close(current,lambda:os.close(current))
                except BaseException:pass
            raise
    def ancestry_check(self,name):
        self.m.safe(self.root/(name or '.'));self.root_check();prefix=[]
        for component in Path(name).parts:
            prefix.append(component);relative='/'.join(prefix)
            require(self.m.source_local((self.root/relative).lstat(),self.policy)==self.policy['_directories'][relative])
    def batch(self,rows):
        parent=Path(rows[0]['path']).parent.as_posix();parent=''if parent=='.'else parent
        fd=None;owned=False;primary=None;cleanup=None;result=[]
        with self.lock:self.active+=1
        try:
            fd,owned=self.parent(parent)
            for row in rows:
                self.check();require(Path(row['path']).parent.as_posix()in(parent,'.'if parent==''else parent))
                self.directory_check(parent,fd)
                leaf=Leaf(self,fd,Path(row['path']).name,self.root/row['path'])
                digest=self.hash_file(self.root,row,self,self.policy,leaf)
                self.directory_check(parent,fd);self.budget.check()
                result.append((row['path'],digest))
            # The batch remains private until fresh absolute ancestry passes.
            self.ancestry_check(parent);self.directory_check(parent,fd)
        except BaseException as error:primary=error;self.record(error);raise
        finally:
            if owned:
                try:self.close(fd,lambda:os.close(fd))
                except BaseException as error:cleanup=error
            with self.lock:self.active-=1
            if primary is None and cleanup is not None:raise cleanup
        self.check();return result
    def finish(self,joined=True):
        # Never close a root descriptor while any worker might still use it.
        if self.active or not joined:
            self.m.SOURCE_JOIN_FAILURE=True;self.record(RuntimeError('AMORTIZATION_UNJOINED'));return False
        primary=self.first if self.failed else None
        try:
            self.m.safe(self.root);self.directory_check('',self.rootfd)
        except BaseException as error:
            if primary is None:self.record(error)
        try:
            if self.ledger.get(self.rootfd)is False:self.close(self.rootfd,lambda:os.close(self.rootfd))
        except BaseException:pass
        if any(not attempted for attempted in self.ledger.values()):
            self.record(RuntimeError('AMORTIZATION_UNCLOSED'))
        if self.opened!=self.closed:self.record(RuntimeError('AMORTIZATION_UNCONFIRMED_CLOSE'))
        return not self.failed

def dispatch(module,hash_file,root,rows,budget,policy,root_before,local_before,progress):
    require(policy.get('mac')is True and isinstance(rows,list))
    def batches():
        group=[];previous=None
        for row in rows:
            name=row['path'];require(module.source_relative(name,'filesystem-member')==name and row['kind']=='file')
            parent=Path(name).parent
            if group and(len(group)==BATCH or parent!=previous):
                yield group;group=[]
            group.append(row);previous=parent
        if group:yield group
    scope=Scope(module,root,budget,policy,root_before,local_before,hash_file)
    try:pool=futures.ThreadPoolExecutor(max_workers=WORKERS)
    except BaseException as primary:
        scope.record(primary);scope.finish();raise primary
    pending={};inflight=set();iterator=iter(batches());hashes={};submitted=0;retired=0
    try:
        def submit():
            nonlocal submitted
            scope.check();group=next(iterator,None)
            if group is not None:
                future=pool.submit(copy_context().run,scope.batch,group);inflight.add(future);pending[future]=group;submitted+=1
        for _ in range(WORKERS):submit()
        while pending and not scope.failed:
            scope.check();done,_=futures.wait(pending,timeout=0.25,return_when=futures.FIRST_COMPLETED)
            for future in done:
                group=pending.pop(future)
                try:
                    result=future.result();hashes.update(result)
                    progress['hashedFiles']+=len(result);progress['hashedBytes']+=sum(r['stamp'][0]for r in group)
                    if 'totals'in progress:
                        progress['totals'][0]+=len(result);progress['totals'][1]+=sum(r['stamp'][0]for r in group)
                except BaseException as error:scope.record(error)
                finally:
                    if future.done():inflight.discard(future);retired+=1
            if not scope.failed:
                for _ in done:submit()
    except BaseException as error:scope.record(error)
    finally:
        if scope.failed:
            for future in pending:future.cancel()
        try:pool.shutdown(wait=True,cancel_futures=scope.failed)
        except BaseException as error:module.SOURCE_JOIN_FAILURE=True;scope.record(error)
        scope.finish(joined=all(future.done()for future in inflight))
    if scope.failed:raise scope.first
    budget.check();require(len(hashes)==len(rows)and not module.SOURCE_CLOSE_FAILURE and not module.SOURCE_JOIN_FAILURE)
    return hashes,{'opened':scope.opened,'closed':scope.closed,'closeAttempts':scope.close_attempts,'peakFDs':scope.peak,'unknownCloses':scope.unknown,'workers':WORKERS,'batchCap':BATCH,'pendingCap':WORKERS,'submittedBatches':submitted,'retiredBatches':retired}
