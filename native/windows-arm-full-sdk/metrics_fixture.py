"""Fixed benign CPU/owned-file fixture. Never invokes an acquired executable."""
import hashlib
from pathlib import Path
import re
import sys
import time

sys.path.insert(0,str(Path(__file__).resolve().parent))
import acquire as data


def run(root,c,_profile,clock):
    data.need(c['mode']=='current-source-gn','FULL_METRICS_FIXTURE_MODE')
    root=data.plain(root);before=time.process_time();count=0
    while time.process_time()-before<0.125:
        count=(count*33+17)%1000003
        if count%4096==0:clock.remaining()
    payload=(b'owned-source-metrics-proof\n'*50000)[:1024*1024]
    path=root/'metrics-fixture.dat';data.plain(path,exists=False)
    with path.open('xb')as stream:stream.write(payload);stream.flush()
    with path.open('rb')as stream:observed=stream.read(len(payload)+1)
    data.need(observed==payload,'FULL_METRICS_FIXTURE_DATA')
    data.save(root/'metrics-fixture-observation.json',{'kind':'windows-arm-owned-metrics-fixture',
        'success':True,'writtenBytes':len(payload),'readBytes':len(observed),
        'sha256':hashlib.sha256(payload).hexdigest(),'cpuNanoseconds':int((time.process_time()-before)*1e9),
        'candidateToolExecuted':False})
    return 0


if __name__=='__main__':
    data.need(len(sys.argv)==4 and sys.argv[1]=='--fixture' and sys.argv[3]=='--execute',
              'FULL_METRICS_FIXTURE_ARGV')
    root=Path(sys.argv[2]);data.need(root==Path.cwd()and
        re.fullmatch('windows-arm-metrics-proof-[a-f0-9-]{36}',root.name),'FULL_METRICS_FIXTURE_ROOT')
    raise SystemExit(run(root,{'mode':'current-source-gn'},None,
        data.Clock(time.time()+10,time.monotonic()+10)))
