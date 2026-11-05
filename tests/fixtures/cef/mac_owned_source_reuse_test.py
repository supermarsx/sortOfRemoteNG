"""Digest reuse for the Mac owned-source codec: a hit needs the complete local identity."""
import json,os,sys,tempfile,time,types,unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[3]
RAW=globals().get('HELD_HELPER_RAW')
if RAW is None:RAW=(ROOT/'scripts/lib/cef-checkpoint-archive.py').read_bytes().replace(b'\r\n',b'\n')
M=types.ModuleType('actual_reuse_helper');exec(compile(RAW,'<actual-reuse-helper>','exec'),M.__dict__)
DIGEST_A='a'*64
DIGEST_B='b'*64
BIRTH=('darwin-birthtime-float-hex','0x1.0000000000000p+30')

def row_for(path,name='file',birth=BIRTH):
    info=os.lstat(path)
    return {'path':name,'kind':'file','stamp':M.stamp(info),'ctimeNs':info.st_ctime_ns,'birthIdentity':birth,'uid':info.st_uid,'gid':info.st_gid}

def guards_for(row):
    return (row['stamp'],row['ctimeNs'],row['birthIdentity'],row['uid'],row['gid'])

class SplitReuse(unittest.TestCase):
    def base(self):
        return {'path':'a','kind':'file','stamp':[10,2000,3,4,0o100644,1],'ctimeNs':3000,'birthIdentity':BIRTH,'uid':501,'gid':20}
    def test_exact_identity_keeps_the_digest_and_unlisted_files_are_read(self):
        row=self.base();other=dict(row,path='b')
        kept,fresh=M.source_mac_split_reuse([row,other],{'a':(M.source_mac_reuse_key(row),DIGEST_A)})
        self.assertEqual(kept,{'a':DIGEST_A});self.assertEqual(fresh,[other])
    def test_no_cache_reads_every_file(self):
        row=self.base();kept,fresh=M.source_mac_split_reuse([row],None)
        self.assertEqual(kept,{});self.assertEqual(fresh,[row])
    def test_any_changed_identity_field_forces_a_read(self):
        row=self.base();known={'a':(M.source_mac_reuse_key(row),DIGEST_A)}
        mutations={
            'size':lambda r:r['stamp'].__setitem__(0,r['stamp'][0]+1),
            'mtime':lambda r:r['stamp'].__setitem__(1,r['stamp'][1]+1),
            'dev':lambda r:r['stamp'].__setitem__(2,r['stamp'][2]+1),
            'inode':lambda r:r['stamp'].__setitem__(3,r['stamp'][3]+1),
            'mode':lambda r:r['stamp'].__setitem__(4,0o100755),
            'nlink':lambda r:r['stamp'].__setitem__(5,2),
            'ctime':lambda r:r.__setitem__('ctimeNs',r['ctimeNs']+1),
            'birth':lambda r:r.__setitem__('birthIdentity',('birthtime-ns','1')),
            'uid':lambda r:r.__setitem__('uid',r['uid']+1),
            'gid':lambda r:r.__setitem__('gid',r['gid']+1),
        }
        for name,mutate in mutations.items():
            changed=self.base();mutate(changed)
            kept,fresh=M.source_mac_split_reuse([changed],known)
            self.assertEqual(kept,{},name);self.assertEqual(fresh,[changed],name)
    def test_guard_key_equals_row_key(self):
        row=self.base();self.assertEqual(M.source_mac_guard_key(guards_for(row)),M.source_mac_reuse_key(row))

@unittest.skipUnless(os.name=='posix','POSIX ownership and ctime semantics')
class RealFiles(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='mac-reuse-');self.base=Path(self.temp.name).resolve()
    def tearDown(self):self.temp.cleanup()
    def reuse_for(self,row,digest=DIGEST_A):return {row['path']:(M.source_mac_reuse_key(row),digest)}
    def test_untouched_file_is_reused(self):
        path=self.base/'f';path.write_bytes(b'content-1');row=row_for(path);time.sleep(0.05) # Kernel timestamps tick coarsely; a real file is hashed long before any change.
        kept,fresh=M.source_mac_split_reuse([row_for(path)],self.reuse_for(row))
        self.assertEqual(kept,{'file':DIGEST_A});self.assertEqual(fresh,[])
    def test_same_size_rewrite_with_restored_mtime_is_not_reused(self):
        path=self.base/'f';path.write_bytes(b'content-1');before=os.lstat(path);row=row_for(path);time.sleep(0.05) # Kernel timestamps tick coarsely; a real file is hashed long before any change.
        # Content changes, size is identical and the old mtime is put back: ctime still moves.
        with open(path,'r+b') as stream:stream.write(b'content-2')
        os.utime(path,ns=(before.st_atime_ns,before.st_mtime_ns))
        after=os.lstat(path);self.assertEqual((after.st_size,after.st_mtime_ns),(before.st_size,before.st_mtime_ns))
        kept,fresh=M.source_mac_split_reuse([row_for(path)],self.reuse_for(row))
        self.assertEqual(kept,{});self.assertEqual(len(fresh),1)
    def test_replacement_with_same_size_and_mtime_is_not_reused(self):
        path=self.base/'f';path.write_bytes(b'content-1');before=os.lstat(path);row=row_for(path);time.sleep(0.05) # Kernel timestamps tick coarsely; a real file is hashed long before any change.
        other=self.base/'g';other.write_bytes(b'content-2');os.utime(other,ns=(before.st_atime_ns,before.st_mtime_ns))
        os.replace(other,path)
        kept,fresh=M.source_mac_split_reuse([row_for(path)],self.reuse_for(row))
        self.assertEqual(kept,{});self.assertEqual(len(fresh),1)
    def test_hardlink_added_is_not_reused(self):
        path=self.base/'f';path.write_bytes(b'content-1');row=row_for(path);time.sleep(0.05) # Kernel timestamps tick coarsely; a real file is hashed long before any change.
        os.link(path,self.base/'link')
        kept,fresh=M.source_mac_split_reuse([row_for(path)],self.reuse_for(row))
        self.assertEqual(kept,{});self.assertEqual(len(fresh),1)
    def test_utime_alone_changes_the_key(self):
        path=self.base/'f';path.write_bytes(b'content-1');before=os.lstat(path);row=row_for(path);time.sleep(0.05) # Kernel timestamps tick coarsely; a real file is hashed long before any change.
        os.utime(path,ns=(before.st_atime_ns,before.st_mtime_ns+1000))
        kept,fresh=M.source_mac_split_reuse([row_for(path)],self.reuse_for(row))
        self.assertEqual(kept,{});self.assertEqual(len(fresh),1)

class Budget:
    seconds=600
    def check(self):pass

@unittest.skipUnless(os.name=='posix','POSIX ownership semantics')
class StatCache(unittest.TestCase):
    IDENTITY={'canonicalRoot':'/work','target':'t'}
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='mac-cache-');self.root=Path(self.temp.name).resolve()
        (self.root/'acquisition-logs').mkdir();self.sidecar=self.root/'sidecar.json';self.sidecar.write_bytes(b'{"sidecar":1}')
        self.sha=M.source_file_sha256(self.sidecar,Budget())
        row={'path':'src/a','kind':'file','stamp':[5,1,2,3,0o100644,1],'ctimeNs':9,'birthIdentity':BIRTH,'uid':os.geteuid(),'gid':20}
        self.row=row;self.guards={'src/a':guards_for(row),'':object()}
    def tearDown(self):self.temp.cleanup()
    def write(self,sha=None,identity=None):
        return M.source_mac_stat_cache_write(self.root,sha or self.sha,identity or self.IDENTITY,{'src/a':DIGEST_A},self.guards)
    def read(self):return M.source_mac_stat_cache_reuse(self.root,self.sidecar,self.IDENTITY,Budget())
    def cache(self):return self.root/'acquisition-logs'/M.SOURCE_MAC_STAT_CACHE_NAME
    def test_round_trip_reuses_only_the_exact_row(self):
        self.assertTrue(self.write());reuse=self.read()
        self.assertEqual(reuse,{'src/a':(M.source_mac_reuse_key(self.row),DIGEST_A)})
        kept,_=M.source_mac_split_reuse([self.row],reuse);self.assertEqual(kept,{'src/a':DIGEST_A})
    def test_cache_member_is_the_excluded_administrative_directory(self):
        self.assertTrue(self.write());self.assertEqual(self.cache().parent.name,'acquisition-logs')
        self.assertEqual(M.SOURCE_MAC_STAT_CACHE_NAME[0],'.')
    def test_missing_logs_directory_writes_nothing(self):
        (self.root/'acquisition-logs').rmdir();self.assertFalse(self.write());self.assertIsNone(self.read())
    def test_wrong_sidecar_or_identity_or_kind_is_ignored(self):
        self.assertIsNone(self.read())
        self.write(sha='c'*64);self.assertIsNone(self.read())
        self.write(identity={'canonicalRoot':'/other','target':'t'});self.assertIsNone(self.read())
        self.write();value=json.loads(self.cache().read_bytes());value['kind']='sorng-linuxarm-source-stat-cache';self.cache().write_text(json.dumps(value));self.assertIsNone(self.read())
    def test_malformed_rows_and_extra_keys_are_ignored(self):
        self.write();good=json.loads(self.cache().read_bytes())
        for mutate in (lambda v:v['entries'][0].pop(),lambda v:v['entries'][0].__setitem__(1,[1,2,3]),
                       lambda v:v['entries'][0].__setitem__(6,'xyz'),lambda v:v['entries'][0].__setitem__(3,[1,2]),
                       lambda v:v.__setitem__('extra',1),lambda v:v.__setitem__('entries','x'),lambda v:v['entries'][0].__setitem__(4,True)):
            value=json.loads(json.dumps(good));mutate(value);self.cache().write_text(json.dumps(value))
            self.assertIsNone(self.read())
    def test_truncated_json_and_symlinked_cache_are_ignored(self):
        self.write();raw=self.cache().read_bytes();self.cache().write_bytes(raw[:len(raw)//2]);self.assertIsNone(self.read())
        self.cache().unlink();target=self.root/'elsewhere.json';target.write_bytes(raw);os.symlink(target,self.cache());self.assertIsNone(self.read())
    def test_stale_row_after_a_content_change_is_not_a_hit(self):
        self.write();reuse=self.read()
        changed=dict(self.row,stamp=list(self.row['stamp']));changed['ctimeNs']+=1
        kept,fresh=M.source_mac_split_reuse([changed],reuse);self.assertEqual(kept,{});self.assertEqual(fresh,[changed])

@unittest.skipUnless(os.name=='posix','POSIX ownership semantics')
class SnapshotWiring(unittest.TestCase):
    """The owned snapshot hands only non-matching files to the FD hasher and keeps the rest."""
    def run_snapshot(self,reuse):
        temp=tempfile.TemporaryDirectory(prefix='mac-wire-');self.addCleanup(temp.cleanup);root=Path(temp.name).resolve()
        keep={'path':'src/keep','kind':'file','stamp':[5,1,2,3,0o100644,1],'ctimeNs':9,'birthIdentity':BIRTH,'uid':501,'gid':20}
        change=dict(keep,path='src/change',stamp=[6,1,2,4,0o100644,1])
        rows=[keep,change];asked=[]
        def fake_hashes(root_,file_rows,budget,policy,root_before,local_before,progress):
            asked.extend(row['path'] for row in file_rows);return {row['path']:'d'*64 for row in file_rows}
        policy={'mac':True,'ownedMacArm':True,'gitHeads':{'src':'x','src/cef':'x','depot_tools':'x'},'registrySha256':None,'_nearby_literals':None,'aggregate':{}}
        patches={'inventory':lambda *a,**k:(rows,11),'_source_mac_fd_hashes':fake_hashes,'source_local':lambda info,policy=None:('local',),
                 'source_portable':lambda row,digest,policy=None:{'path':row['path'],'sha256':digest}}
        saved={name:getattr(M,name) for name in patches}
        try:
            for name,value in patches.items():setattr(M,name,value)
            M.SOURCE_PROGRESS=None;layout={};guards={}
            policy['registrySha256']=reuse.get('.gclient_entries',(None,None))[1] if reuse else None
            value=M._source_mac_owned_snapshot_inventory(root,Budget(),guards,policy,False,reuse=reuse,layout=layout)
        finally:
            for name,value_ in saved.items():setattr(M,name,value_)
        return asked,layout,value
    def test_matching_file_is_not_read_and_changed_file_is(self):
        key=M.source_mac_reuse_key({'path':'src/keep','stamp':[5,1,2,3,0o100644,1],'ctimeNs':9,'birthIdentity':BIRTH,'uid':501,'gid':20})
        asked,layout,value=self.run_snapshot({'src/keep':(key,'k'*64),'src/change':(key,'c'*64)})
        self.assertEqual(asked,['src/change'])
        self.assertEqual(layout['digests'],{'src/keep':'k'*64,'src/change':'d'*64})
        self.assertEqual([e['sha256'] for e in value['entries']],['k'*64,'d'*64])
    def test_no_reuse_reads_every_file(self):
        asked,layout,_=self.run_snapshot(None)
        self.assertEqual(asked,['src/keep','src/change']);self.assertEqual(set(layout['digests']),{'src/keep','src/change'})

class Budgets(unittest.TestCase):
    def test_mac_budget_is_5400_seconds_and_linux_is_unchanged(self):
        self.assertEqual(M.SOURCE_MAC_SECONDS,5400);self.assertEqual(M.SOURCE_LINUX_SECONDS,2400)
        M.Budget(5400,M.SOURCE_MAC_SECONDS)
        with self.assertRaises(BaseException):M.Budget(5401,M.SOURCE_MAC_SECONDS)

if __name__=='__main__':unittest.main(verbosity=2)
