"""Creation-owned native diagnostic holder. Never source/SDK authority."""
import json,os,select,signal,sys,time

def need(value):
    if not value:raise RuntimeError('HOLDER_CONTRACT')

def emit(value):print(json.dumps(value,separators=(',',':')),flush=True)

def main():
    need(len(sys.argv)==2 and sys.argv[1]in('delay','held','foreign','expired'))
    mode=sys.argv[1];end=time.monotonic()+50;owned=set();peer=None
    if not all(hasattr(os,key)for key in('waitid','WNOWAIT','WEXITED','P_PID','CLD_EXITED')):
        emit({'kind':'unsupported','waitidSupported':False});return 77
    if mode=='foreign':os.setsid()
    ready_read,ready_write=os.pipe();exit_read,exit_write=os.pipe()
    try:
        target=os.fork()
        if target==0:
            os.close(ready_read);os.close(exit_write)
            if mode=='foreign':os.setpgid(0,0)
            else:os.setsid()
            os.write(ready_write,b'R');os.close(ready_write)
            os.read(exit_read,1);os.close(exit_read);os._exit(0)
        owned.add(target);os.close(ready_write);os.close(exit_read)
        need(os.read(ready_read,1)==b'R');os.close(ready_read)
        need(os.getpgid(target)==target)
        if mode=='foreign':
            peer_read,peer_write=os.pipe();peer=os.fork()
            if peer==0:
                os.close(peer_read);os.close(exit_write);os.setpgid(0,target)
                os.write(peer_write,b'R');os.close(peer_write)
                for fd in(0,1,2):os.close(fd)
                time.sleep(45);os._exit(0)
            owned.add(peer);os.close(peer_write);need(os.read(peer_read,1)==b'R');os.close(peer_read)
            need(os.getpgid(peer)==target)
        os.write(exit_write,b'X');os.close(exit_write)
        observed=os.waitid(os.P_PID,target,os.WEXITED|os.WNOWAIT)
        need(observed.si_pid==target and observed.si_code==os.CLD_EXITED and observed.si_status==0)
        emit({'kind':'ready','target':target,'parent':os.getpid(),'group':target,'peer':peer,
              'waitidSupported':True,'exitedWithoutReaping':True,'exitStatus':0,'mode':mode})
        need(sys.stdin.buffer.readline(65)==b'begin\n')
        began=time.monotonic();hold=35 if mode=='held'else 8
        while time.monotonic()<began+hold:
            need(time.monotonic()<end)
            readable,_,_=select.select([sys.stdin],[],[],max(0,min(.1,began+hold-time.monotonic())))
            if readable:
                line=sys.stdin.buffer.readline(65)
                need(line in(b'reap-now\n',b''));break
        pid,status=os.waitpid(target,0);need(pid==target and status==0);owned.remove(target)
        emit({'kind':'reaped','target':target,'status':0,'elapsedMs':int((time.monotonic()-began)*1000)})
        if peer is not None:
            while time.monotonic()<end:
                readable,_,_=select.select([sys.stdin],[],[],.1)
                if readable:
                    need(sys.stdin.buffer.readline(65)in(b'close\n',b''));break
            else:raise RuntimeError('HOLDER_DEADLINE')
    finally:
        # Only unreaped children of THIS holder remain in this ownership set.
        # Removing waitpid-completed PIDs before any further kill prevents reuse.
        for pid in tuple(owned):
            try:os.kill(pid,signal.SIGKILL)
            except ProcessLookupError:pass
            result,_=os.waitpid(pid,0);need(result==pid);owned.remove(pid)
        need(not owned)
    return 0

if __name__=='__main__':
    def stop(_signal,_frame):raise SystemExit(124)
    signal.signal(signal.SIGTERM,stop)
    try:raise SystemExit(main())
    except (RuntimeError,OSError,ValueError):
        emit({'kind':'failure','code':'HOLDER_FAILED'});raise SystemExit(1)
