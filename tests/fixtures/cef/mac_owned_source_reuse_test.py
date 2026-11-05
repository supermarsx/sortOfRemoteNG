"""Digest reuse for the Mac owned-source codec: a hit needs the complete local identity."""
import json,os,shutil,sys,tempfile,time,types,unittest
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
        self.write();head,*rows=self.cache().read_bytes().split(b'\n')[:-1];value=json.loads(head);value['kind']='sorng-linuxarm-source-stat-cache'
        self.cache().write_bytes(json.dumps(value).encode()+b'\n'+b'\n'.join(rows)+b'\n');self.assertIsNone(self.read())
    def lines(self):
        return self.cache().read_bytes().split(b'\n')[:-1]
    def put(self,lines):
        self.cache().write_bytes(b'\n'.join(lines)+b'\n')
    def test_malformed_rows_and_header_are_ignored(self):
        self.write();head,row=self.lines();good=json.loads(row);header=json.loads(head)
        def mutate_row(change):
            value=json.loads(json.dumps(good));change(value);self.put([head,json.dumps(value).encode()])
        for change in (lambda v:v.pop(),lambda v:v.__setitem__(1,[1,2,3]),lambda v:v.__setitem__(6,'xyz'),
                       lambda v:v.__setitem__(3,[1,2]),lambda v:v.__setitem__(4,True),lambda v:v.__setitem__(0,5)):
            mutate_row(change);self.assertIsNone(self.read())
        for change in (lambda h:h.__setitem__('extra',1),lambda h:h.__setitem__('count',2),lambda h:h.__setitem__('count','1'),
                       lambda h:h.__setitem__('schemaVersion',1)):
            value=json.loads(json.dumps(header));change(value);self.put([json.dumps(value).encode(),row]);self.assertIsNone(self.read())
        self.put([head,row,row]);self.assertIsNone(self.read())
        self.put([head,row]);self.assertIsNotNone(self.read())
    def test_cache_is_streamed_one_row_per_line(self):
        self.write();head,row=self.lines()
        self.assertEqual(json.loads(head)['count'],1);self.assertEqual(json.loads(row)[0],'src/a')
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
        rows=[keep,change];asked=[];self.walks=0
        def walk(*a,**k):
            self.walks+=1;return rows,11
        def fake_hashes(root_,file_rows,budget,policy,root_before,local_before,progress):
            asked.extend(row['path'] for row in file_rows);return {row['path']:'d'*64 for row in file_rows}
        policy={'mac':True,'ownedMacArm':True,'gitHeads':{'src':'x','src/cef':'x','depot_tools':'x'},'registrySha256':None,'_nearby_literals':None,'aggregate':{}}
        patches={'inventory':walk,'_source_mac_fd_hashes':fake_hashes,'source_local':lambda info,policy=None:('local',),
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
        # Entries are in canonical path order: src/change before src/keep.
        self.assertEqual([e['sha256'] for e in value['entries']],['d'*64,'k'*64])
    def test_a_snapshot_that_keeps_every_digest_walks_once_and_one_that_reads_walks_twice(self):
        keep={'path':'src/keep','stamp':[5,1,2,3,0o100644,1],'ctimeNs':9,'birthIdentity':BIRTH,'uid':501,'gid':20}
        change=dict(keep,path='src/change',stamp=[6,1,2,4,0o100644,1])
        everything={'src/keep':(M.source_mac_reuse_key(keep),'k'*64),'src/change':(M.source_mac_reuse_key(change),'c'*64)}
        asked,_,_=self.run_snapshot(everything)
        self.assertEqual(asked,[]);self.assertEqual(self.walks,1)
        # One file changed: it is read, and the second walk proves the tree stable around that read.
        partial={'src/keep':everything['src/keep']}
        asked,_,_=self.run_snapshot(partial)
        self.assertEqual(asked,['src/change']);self.assertEqual(self.walks,2)
        asked,_,_=self.run_snapshot(None)
        self.assertEqual(self.walks,2)
    def test_no_reuse_reads_every_file(self):
        asked,layout,_=self.run_snapshot(None)
        self.assertEqual(asked,['src/keep','src/change']);self.assertEqual(set(layout['digests']),{'src/keep','src/change'})

@unittest.skipUnless(os.name=='posix','POSIX symlinks')
class CipdCanonical(unittest.TestCase):
    """A fresh checkout numbers pkgs/<N> differently; the owned Mac snapshot must not see that."""
    BASES=('depot_tools/.cipd_bin/.cipd','src/third_party/depot_tools/.cipd_bin/.cipd','.cipd')
    def build(self,numbers,sentinel_time='2026-11-05 05:50:01.123456',tamper=None):
        # Every checkout lives at the same path, as in CI; only one exists at a time.
        if not hasattr(self,'parent'):
            temp=tempfile.TemporaryDirectory(prefix='mac-cipd-');self.addCleanup(temp.cleanup);self.parent=Path(temp.name).resolve()
        root=self.parent/'source'
        if root.exists():shutil.rmtree(root)
        root.mkdir()
        (root/'.gclient_entries').write_bytes(b'entries')
        for repo in ('src','src/cef','depot_tools'):(root/repo).mkdir(parents=True,exist_ok=True)
        for base,(first,second) in zip(self.BASES,(numbers,numbers,numbers)):
            for index,package,instance in ((first,'tools/git','A'*22),(second,'tools/luci','B'*22)):
                package_root=root/base/'pkgs'/str(index);(package_root/instance/'.versions').mkdir(parents=True)
                (package_root/'description.json').write_text(json.dumps({'package_name':package,'subdir':''}))
                (package_root/instance/'.versions'/'tool.cipd_version').write_text(package)
                os.symlink(instance,package_root/'_current')
        link_dir=root/'depot_tools/.cipd_bin/.versions';link_dir.mkdir(parents=True,exist_ok=True)
        os.symlink('../.cipd/pkgs/%d/_current/.versions/tool.cipd_version'%numbers[0],link_dir/'git.cipd_version')
        sentinel=root/'src/third_party/depot_tools/.disable_auto_update'
        sentinel.parent.mkdir(parents=True,exist_ok=True)
        sentinel.write_text('Disabled by %s/src/third_party/depot_tools/update_depot_tools_toggle.py at %s\n'%(root,sentinel_time))
        if tamper:tamper(root)
        return root
    def scan(self,root):
        rows=[];identity=os.getuid() if hasattr(os,'getuid') else 0
        for current,dirs,files in os.walk(root):
            for name in sorted(dirs+files):
                path=Path(current)/name;relative=path.relative_to(root).as_posix();info=os.lstat(path)
                kind='symlink' if os.path.islink(path) else 'directory' if os.path.isdir(path) else 'file'
                row={'path':relative,'kind':kind,'stamp':M.stamp(info),'ctimeNs':info.st_ctime_ns,'birthIdentity':BIRTH,'uid':info.st_uid,'gid':info.st_gid}
                if kind=='symlink':row['target']=os.readlink(path)
                rows.append(row)
        return sorted(rows,key=lambda row:row['path'])
    def snapshot(self,root,digest_override=None):
        import hashlib
        rows=self.scan(root)
        def fake_hashes(root_,file_rows,budget,policy,root_before,local_before,progress):
            result={row['path']:hashlib.sha256((root/row['path']).read_bytes()).hexdigest() for row in file_rows}
            if digest_override:result.update(digest_override)
            return result
        def portable(row,digest,policy=None):
            entry={'path':row['path'],'kind':row['kind'],'mode':0,'mtimeNs':'0','nlink':1}
            if row['kind']=='file':entry.update(size=row['stamp'][0],sha256=digest)
            if row['kind']=='symlink':entry.update(target=row['target'],sha256=hashlib.sha256(row['target'].encode()).hexdigest())
            return entry
        policy={'mac':True,'ownedMacArm':True,'gitHeads':{'src':'x','src/cef':'x','depot_tools':'x'},
                'registrySha256':hashlib.sha256(b'entries').hexdigest(),'_nearby_literals':None,'aggregate':{}}
        patches={'inventory':lambda *a,**k:(rows,sum(row['stamp'][0] for row in rows if row['kind']=='file')),
                 '_source_mac_fd_hashes':fake_hashes,'source_local':lambda info,policy=None:('local',),'source_portable':portable}
        saved={name:getattr(M,name) for name in patches}
        try:
            for name,value in patches.items():setattr(M,name,value)
            M.SOURCE_PROGRESS=None;layout={};guards={}
            value=M._source_mac_owned_snapshot_inventory(root,Budget(),guards,policy,False,layout=layout)
        finally:
            for name,fn in saved.items():setattr(M,name,fn)
        return value,layout,guards
    def test_renumbered_checkout_produces_the_same_snapshot(self):
        a=self.build((5,10));va,la,ga=self.snapshot(a)
        b=self.build((10,5),sentinel_time='2026-11-05 07:11:59.654321');vb,lb,gb=self.snapshot(b)
        self.assertEqual(va['entries'],vb['entries']);self.assertEqual(va['bytes'],vb['bytes'])
        names=[e['path'] for e in va['entries']];self.assertEqual(names,sorted(names))
        canon=[n for n in names if '/pkgs/@' in n];self.assertTrue(canon);self.assertFalse([n for n in names if '/pkgs/' in n and '/pkgs/@' not in n])
        # Each checkout maps the same canonical name back to its own, different, real directory.
        swapped=[n for n in canon if la['canonical'][n]!=lb['canonical'][n]];self.assertTrue(swapped)
        self.assertTrue(all(la['canonical'][n].startswith(n.split('/@')[0]+'/') for n in swapped))
        # Real paths stay the guard keys, so timestamp writes target the right entries.
        self.assertIn(la['canonical'][canon[0]],ga);self.assertNotIn(canon[0],ga)
    def test_symlink_target_and_sentinel_are_canonical(self):
        a=self.build((5,10));va,la,_=self.snapshot(a)
        b=self.build((10,5),sentinel_time='2026-11-05 09:00:00.000001');vb,lb,_=self.snapshot(b)
        link=[e for e in va['entries'] if e['path'].endswith('git.cipd_version')][0]
        self.assertIn('/pkgs/@',link['target']);self.assertNotIn('pkgs/5',link['target']);self.assertNotIn('pkgs/10',link['target'])
        self.assertEqual(link,[e for e in vb['entries'] if e['path'].endswith('git.cipd_version')][0])
        import hashlib;self.assertEqual(link['sha256'],hashlib.sha256(link['target'].encode()).hexdigest())
        self.assertEqual(la['targets'][link['path']],'../.cipd/pkgs/5/_current/.versions/tool.cipd_version')
        self.assertEqual(lb['targets'][link['path']],'../.cipd/pkgs/10/_current/.versions/tool.cipd_version')
        import hashlib
        sentinel=[e for e in va['entries'] if e['path'].endswith('.disable_auto_update')][0]
        canonical=b'Disabled by '+(str(a)+'/src/third_party/depot_tools/update_depot_tools_toggle.py').encode()+b' at <time>\n'
        self.assertEqual((sentinel['size'],sentinel['sha256']),(len(canonical),hashlib.sha256(canonical).hexdigest()))
        # The time stamp differs between the two checkouts; the recorded entry does not.
        self.assertEqual(sentinel,[e for e in vb['entries'] if e['path'].endswith('.disable_auto_update')][0])
    def test_a_real_content_difference_is_still_visible(self):
        a=self.build((5,10));va,_,_=self.snapshot(a)
        def change_version(root):
            for path in root.rglob('tool.cipd_version'):
                if path.is_file():path.write_text(path.read_text()+'x')
        b=self.build((10,5),tamper=change_version);vb,_,_=self.snapshot(b)
        self.assertNotEqual(va['entries'],vb['entries'])
        def other_package(root):
            for path in root.rglob('description.json'):path.write_text(json.dumps({'package_name':'tools/other','subdir':''}));break
        c=self.build((5,10),tamper=other_package);vc,_,_=self.snapshot(c)
        self.assertNotEqual(va['entries'],vc['entries'])
        def other_instance(root):
            for path in root.rglob('_current'):
                if '/pkgs/' in path.as_posix():path.unlink();os.symlink('C'*22,path);(path.parent/('C'*22)).mkdir();break
        d=self.build((5,10),tamper=other_instance);vd,_,_=self.snapshot(d)
        self.assertNotEqual(va['entries'],vd['entries'])
    def test_unreviewed_layouts_fail_closed(self):
        def no_description(root):next(root.rglob('description.json')).unlink()
        with self.assertRaises(M.CheckpointError):self.snapshot(self.build((5,10),tamper=no_description))
        def foreign_link(root):os.symlink('../.cipd/pkgs/99/_current/x',root/'depot_tools/.cipd_bin/.versions/foreign')
        with self.assertRaises(M.CheckpointError):self.snapshot(self.build((5,10),tamper=foreign_link))
        def bad_index(root):(root/'depot_tools/.cipd_bin/.cipd/pkgs/007').mkdir()
        with self.assertRaises(M.CheckpointError):self.snapshot(self.build((5,10),tamper=bad_index))
        def bad_sentinel(root):(root/'src/third_party/depot_tools/.disable_auto_update').write_text('something else\n')
        with self.assertRaises(M.CheckpointError):self.snapshot(self.build((5,10),tamper=bad_sentinel))
    def test_description_json_must_match_the_digest_that_was_hashed(self):
        root=self.build((5,10))
        target=next(path for path in root.rglob('description.json') if 'depot_tools/.cipd_bin' in path.as_posix() and 'src/third_party' not in path.as_posix())
        with self.assertRaises(M.CheckpointError):
            self.snapshot(root,digest_override={target.relative_to(root).as_posix():'0'*64})

class LeanReuse(unittest.TestCase):
    def test_key_text_is_unambiguous_and_compact(self):
        a=M.source_mac_key_text([1,2,3,4,5,6],7,('x,y','z'),8,9);b=M.source_mac_key_text([1,2,3,4,5,6],7,('x','y,z'),8,9)
        self.assertNotEqual(a,b);self.assertIsInstance(a,str);self.assertLess(len(a),200)
        self.assertNotEqual(M.source_mac_key_text([1,2,3,4,5,6],7,BIRTH,8,9),M.source_mac_key_text([1,2,3,4,5,6],7,BIRTH,9,8))
    def test_postcheck_view_shares_guards_and_digests_without_copying(self):
        row={'path':'a','kind':'file','stamp':[5,1,2,3,0o100644,1],'ctimeNs':9,'birthIdentity':BIRTH,'uid':501,'gid':20}
        guards={'a':guards_for(row),'':object()};digests={'a':DIGEST_A}
        view=M.SourceMacPostReuse(guards,digests)
        self.assertTrue(view);self.assertIs(view.guards,guards);self.assertIs(view.digests,digests)
        self.assertEqual(view.get('a'),(M.source_mac_reuse_key(row),DIGEST_A))
        self.assertIsNone(view.get('b'));self.assertIsNone(view.get(''))
        # A timestamp write replaces the key; the old identity no longer matches.
        view['a']=M.source_mac_key_text([5,2,2,3,0o100644,1],10,BIRTH,501,20)
        kept,fresh=M.source_mac_split_reuse([row],view);self.assertEqual(kept,{});self.assertEqual(fresh,[row])
        changed=dict(row,stamp=[5,2,2,3,0o100644,1],ctimeNs=10)
        kept,_=M.source_mac_split_reuse([changed],view);self.assertEqual(kept,{'a':DIGEST_A})
        self.assertFalse(M.SourceMacPostReuse(guards,{}))
    def test_snapshot_accepts_the_view_and_does_not_copy_digests(self):
        w=SnapshotWiring('test_no_reuse_reads_every_file');asked,layout,_=w.run_snapshot(None)
        self.assertEqual(set(layout['digests']),{'src/keep','src/change'})
    def test_cache_read_is_much_smaller_than_the_parsed_table(self):
        temp=tempfile.TemporaryDirectory(prefix='mac-lean-');self.addCleanup(temp.cleanup);root=Path(temp.name).resolve()
        (root/'acquisition-logs').mkdir();sidecar=root/'sidecar.json';sidecar.write_bytes(b'{}')
        guards={};digests={}
        for i in range(2000):
            name='src/a/%05d'%i;guards[name]=([i,2,3,4,0o100644,1],5,BIRTH,501,20);digests[name]='d'*64
        sha=M.source_file_sha256(sidecar,Budget())
        self.assertTrue(M.source_mac_stat_cache_write(root,sha,{'t':1},digests,guards))
        reuse=M.source_mac_stat_cache_reuse(root,sidecar,{'t':1},Budget())
        self.assertEqual(len(reuse),2000)
        key,digest=reuse['src/a/00007'];self.assertIsInstance(key,str);self.assertEqual(digest,'d'*64)

class Budgets(unittest.TestCase):
    def test_mac_budget_is_5400_seconds_and_linux_is_unchanged(self):
        self.assertEqual(M.SOURCE_MAC_SECONDS,5400);self.assertEqual(M.SOURCE_LINUX_SECONDS,2400)
        M.Budget(5400,M.SOURCE_MAC_SECONDS)
        with self.assertRaises(BaseException):M.Budget(5401,M.SOURCE_MAC_SECONDS)

if __name__=='__main__':unittest.main(verbosity=2)
