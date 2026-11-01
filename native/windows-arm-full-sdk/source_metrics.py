"""Bounded accounting for the actual assigned Job, never host process discovery.

Accounting and phase metadata are observations, not authority or network proof.
Their failures remain secondary to the command's original outcome.
"""
import ctypes as C
import json
from pathlib import Path
import threading
import time

import acquire as data
import extract

PHASES=frozenset(('source-admission','repository-fetch','gclient-sync','hook-plan',
    'runhooks','patch-apply','setup-x86','setup-x64','setup-arm64','cef-hook',
    'cef-gn','graph-inventory','complete'))
CADENCE=15
MAXIMUM_SAMPLES=512
MAXIMUM_BYTES=1024*1024


def accounting_reader(job_module,handle):
    # Windows JOBOBJECT_BASIC_AND_IO_ACCOUNTING_INFORMATION (class 8).
    # Includes current and terminated members of this exact Job only.
    class BasicAndIo(C.Structure):
        _fields_=[('basic',job_module.Accounting),('io',job_module.IoCounters)]
    if C.sizeof(BasicAndIo)!=96 or C.alignment(BasicAndIo)!=8:
        raise ValueError('METRICS_LAYOUT')
    def read():
        value=BasicAndIo()
        job_module.checked(job_module.query_job(handle,8,C.byref(value),C.sizeof(value),None),
                           'owned-job-accounting')
        return {'cpuUser100ns':int(value.basic.user),'cpuKernel100ns':int(value.basic.kernel),
            'activeProcesses':int(value.basic.active),'totalProcesses':int(value.basic.total),
            **{name:int(getattr(value.io,field))for name,field in (
                ('ioReads','reads'),('ioWrites','writes'),('ioOther','other'),
                ('ioReadBytes','read_bytes'),('ioWriteBytes','write_bytes'),('ioOtherBytes','other_bytes'))}}
    return read


class Collector:
    """Pure finite numeric collector; no raw path, command, URL or error text."""
    def __init__(self,mono=time.monotonic):
        self.mono=mono;self.begin=mono();self.rows=[];self.failure=None;self.truncated=False

    def append(self,counters,phase=None):
        try:
            elapsed=int((self.mono()-self.begin)*1000)
            if not 0<=elapsed<=7230000:raise ValueError()
            expected={'cpuUser100ns','cpuKernel100ns','activeProcesses','totalProcesses',
                'ioReads','ioWrites','ioOther','ioReadBytes','ioWriteBytes','ioOtherBytes'}
            if set(counters)!=expected or any(type(v)is not int or not 0<=v<2**64
                    for v in counters.values())or counters['activeProcesses']>64:
                raise ValueError()
            if self.rows:
                previous=self.rows[-1]
                if elapsed<previous['elapsedMs']or any(counters[k]<int(previous[k])
                        for k in expected-{'activeProcesses'}):raise ValueError()
            if len(self.rows)>=MAXIMUM_SAMPLES:self.truncated=True;return
            row={'elapsedMs':elapsed,**{k:str(v)for k,v in counters.items()}}
            if phase is not None:row.update(phase)
            if len(json.dumps(row,separators=(',',':')).encode())>1024:raise ValueError()
            self.rows.append(row)
        except BaseException:
            self.failure=self.failure or 'METRICS_COUNTER_METADATA'


def phase_metadata(root,clock,context_sha):
    target=root/'source-phase-result.json'
    if not target.exists():return None
    _,raw=extract.held(target,clock,retain=True,maximum=2048,bounded_reads=True)
    value=json.loads(raw)
    fields={'kind','contextSha256','phase','sequence','elapsedMs','stdoutBytes',
            'stderrBytes','lastOutputAgeMs','syncCompleted','syncTotal'}
    if set(value)!=fields or value['kind']!='windows-arm-source-phase' or\
            value['contextSha256']!=context_sha or value['phase']not in PHASES:
        raise ValueError('METRICS_PHASE_METADATA')
    for key in fields-{'kind','contextSha256','phase'}:
        if type(value[key])is not int or not 0<=value[key]<=64*1024**2:
            raise ValueError('METRICS_PHASE_METADATA')
    if value['sequence']>32 or value['syncCompleted']>value['syncTotal']or value['syncTotal']>10000:
        raise ValueError('METRICS_PHASE_METADATA')
    return {key:value[key]for key in ('phase','sequence','stdoutBytes','stderrBytes',
        'lastOutputAgeMs','syncCompleted','syncTotal')}


class Observer:
    def __init__(self,root,role,clock,*,reader=None,mono=time.monotonic):
        if role not in ('metrics-fixture','source-gn'):raise ValueError('METRICS_ROLE')
        self.root=Path(root);self.role=role;self.clock=clock;self.reader=reader
        self.collector=Collector(mono);self.stop=threading.Event();self.thread=None
        self.started=False;self.phase_failure=False;self.report_failure=False

    def __call__(self,handle,_process,_pid,_creation):
        try:
            if self.reader is None:
                import job
                self.reader=accounting_reader(job,handle)
            self.started=True
            self.sample()
            self.thread=threading.Thread(target=self.loop,name='owned-source-accounting',daemon=True)
            self.thread.start()
        except BaseException:
            self.collector.failure=self.collector.failure or 'METRICS_UNAVAILABLE'

    def sample(self):
        try:
            phase=None
            if self.role=='source-gn':
                try:
                    import producer
                    phase=phase_metadata(self.root,self.clock,producer.CONTEXT_SHA)
                except BaseException:self.phase_failure=True
            self.collector.append(self.reader(),phase)
        except BaseException:
            self.collector.failure=self.collector.failure or 'METRICS_QUERY_METADATA'

    def loop(self):
        while not self.stop.wait(CADENCE):self.sample()

    def before_cleanup(self,deadline):
        self.stop.set()
        if self.thread is not None:self.thread.join(max(0,min(5,deadline-time.monotonic())))
        stopped=self.thread is None or not self.thread.is_alive()
        if stopped and self.started:self.sample()
        report={'kind':'windows-arm-owned-source-accounting','role':self.role,
            'ownedJobHandleOnly':True,'samplerStopped':stopped,'cadenceSeconds':CADENCE,
            'maximumSamples':MAXIMUM_SAMPLES,'truncated':self.collector.truncated,
            'metadataFailure':self.collector.failure,'phaseMetadataUnavailable':self.phase_failure,
            'networkCauseEstablished':False,'sourceOutcomeNotInferred':True,
            'samples':self.collector.rows}
        try:
            raw=(json.dumps(report,separators=(',',':'))+'\n').encode('ascii')
            if len(raw)>MAXIMUM_BYTES:raise ValueError('METRICS_REPORT_BOUND')
            target=self.root/'jobs'/self.role/'metrics.json'
            data.plain(target,exists=False)
            with target.open('xb')as stream:
                if stream.write(raw)!=len(raw):raise ValueError('METRICS_REPORT_WRITE')
        except BaseException:self.report_failure=True
        # Reporting/query errors never replace the command's primary. A live
        # reader at handle close is a distinct ownership/cleanup failure.
        if not stopped:raise OSError('OWNED_OBSERVER_NOT_CLOSED')
