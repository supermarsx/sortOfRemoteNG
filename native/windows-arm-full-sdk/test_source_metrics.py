"""Numeric bounds plus a real, tiny, exclusively owned Windows Job fixture."""
import ctypes as C
import hashlib
import json
import os
from pathlib import Path
import sys
import time
import types
import unittest
from unittest.mock import patch
import uuid

HERE=Path(__file__).resolve().parent;sys.path.insert(0,str(HERE))
import acquire as data
import producer
import source_metrics as metrics


def counters(value=0,active=1):
    return {'cpuUser100ns':value,'cpuKernel100ns':value,'activeProcesses':active,
        'totalProcesses':1,'ioReads':value,'ioWrites':value,'ioOther':value,
        'ioReadBytes':value,'ioWriteBytes':value,'ioOtherBytes':value}


class MetricsTests(unittest.TestCase):
    def test_numeric_counter_monotonicity_and_exact_bounded_retention(self):
        timer=[0.0];collector=metrics.Collector(lambda:timer[0])
        for i in range(513):timer[0]+=15;collector.append(counters(i))
        # Test full storage bound under the same two-hour elapsed limit.
        self.assertLessEqual(len(collector.rows),512)
        valid=metrics.Collector(lambda:1.0)
        for i in range(513):valid.append(counters(i))
        self.assertEqual(len(valid.rows),512);self.assertTrue(valid.truncated)
        self.assertLess(len(json.dumps(valid.rows).encode()),metrics.MAXIMUM_BYTES)
        valid.append(counters(-1));self.assertEqual(valid.failure,'METRICS_COUNTER_METADATA')
        other=metrics.Collector(lambda:1.0);other.append(counters(2));other.append(counters(1))
        self.assertEqual(other.failure,'METRICS_COUNTER_METADATA')

    def test_metadata_query_failure_remains_secondary_and_reader_stops(self):
        import tempfile
        with tempfile.TemporaryDirectory()as folder:
            root=Path(folder).resolve();(root/'jobs/metrics-fixture').mkdir(parents=True)
            observer=metrics.Observer(root,'metrics-fixture',data.Clock(time.time()+10,time.monotonic()+10),
                reader=lambda:(_ for _ in ()).throw(OSError('secret raw text')))
            observer(None,None,None,None);observer.before_cleanup(time.monotonic()+5)
            report=json.loads((root/'jobs/metrics-fixture/metrics.json').read_bytes())
            self.assertTrue(report['samplerStopped']);self.assertFalse(observer.thread.is_alive())
            self.assertEqual(report['metadataFailure'],'METRICS_QUERY_METADATA')
            self.assertNotIn('secret',json.dumps(report))

    def test_report_write_failure_does_not_replace_command_result(self):
        observer=metrics.Observer(Path.cwd(),'metrics-fixture',None,reader=lambda:counters())
        observer(None,None,None,None)
        with patch.object(Path,'open',side_effect=OSError('private path')):
            observer.before_cleanup(time.monotonic()+5)
        self.assertTrue(observer.report_failure);self.assertFalse(observer.thread.is_alive())

    def test_real_phase_file_is_context_bound_and_malformed_metadata_stays_secondary(self):
        import tempfile
        with tempfile.TemporaryDirectory()as folder:
            root=Path(folder).resolve();(root/'jobs/source-gn').mkdir(parents=True)
            target=root/'source-phase-result.json';context='a'*64
            value={'kind':'windows-arm-source-phase','contextSha256':context,
                'phase':'gclient-sync','sequence':2,'elapsedMs':15000,
                'stdoutBytes':1024,'stderrBytes':0,'lastOutputAgeMs':500,
                'syncCompleted':42,'syncTotal':100}
            target.write_text(json.dumps(value))
            short=lambda:data.Clock(time.time()+10,time.monotonic()+10)
            observed=metrics.phase_metadata(root,short(),context)
            self.assertEqual(observed['phase'],'gclient-sync')
            self.assertEqual(observed['syncCompleted'],42)
            self.assertNotIn('contextSha256',observed)
            with self.assertRaisesRegex(ValueError,'METRICS_PHASE_METADATA'):
                metrics.phase_metadata(root,short(),'b'*64)
            for invalid in ({**value,'phase':'https://private.invalid/secret'},
                            {**value,'syncCompleted':101},{**value,'extra':'private'}):
                target.write_text(json.dumps(invalid))
                with self.assertRaisesRegex(ValueError,'METRICS_PHASE_METADATA'):
                    metrics.phase_metadata(root,short(),context)
            target.write_text('{malformed private metadata')
            observer=metrics.Observer(root,'source-gn',short(),reader=lambda:counters())
            with patch.object(producer,'CONTEXT_SHA',context):
                observer(None,None,None,None);observer.before_cleanup(time.monotonic()+5)
            report=json.loads((root/'jobs/source-gn/metrics.json').read_bytes())
            self.assertTrue(report['phaseMetadataUnavailable'])
            self.assertTrue(report['samplerStopped'])
            self.assertIsNone(report['metadataFailure'])
            self.assertNotIn('private',json.dumps(report))

    @unittest.skipUnless(os.name=='nt','actual Windows assigned Job accounting')
    def test_actual_exclusively_owned_cpu_io_fixture_and_cleanup(self):
        import job
        root=HERE.parents[1]/'.artifacts'/('windows-arm-metrics-proof-'+str(uuid.uuid4()))
        root.mkdir(parents=True);(root/'jobs').mkdir();(root/'tmp').mkdir();(root/'home').mkdir()
        argv=[sys.executable,'-I','-B',str(HERE/'metrics_fixture.py'),'--fixture',str(root),'--execute']
        def approved(actual,cwd):
            if actual!=argv or Path(cwd)!=root:raise ValueError('FIXTURE_COMMAND')
            return 'metrics-fixture'
        env={'SystemRoot':'C:/Windows','WINDIR':'C:/Windows','PATH':'C:/Windows/System32',
            'TEMP':str(root/'tmp'),'TMP':str(root/'tmp'),'USERPROFILE':str(root/'home'),
            'PYTHONDONTWRITEBYTECODE':'1'}
        observer=metrics.Observer(root,'metrics-fixture',data.Clock(time.time()+15,time.monotonic()+15))
        # Only this test process substitutes a fixed local Python/fixture argv
        # and scratch environment. On-disk production admission is untouched.
        with patch.object(job,'approved_tool_command',side_effect=approved),\
             patch.object(job,'environment',return_value=env),\
             patch.object(producer,'verified_sources',return_value=({'mode':producer.REVIEWED_MODE},None,None)):
            receipt=job.run_job(argv,str(root),root/'jobs/metrics-fixture',10,cap=32768,_test_observe=observer)
        report=json.loads((root/'jobs/metrics-fixture/metrics.json').read_bytes())
        self.assertTrue(receipt['success'],receipt)
        proof=json.loads((root/'metrics-fixture-observation.json').read_bytes())
        for key in ('assignedBeforeResume','assignedAtCreationVerified','cleanupVerified','rootReaped','logReadersStopped','observerStopped'):
            self.assertTrue(receipt[key],key)
        self.assertEqual(receipt['activeAtEnd'],0);self.assertEqual(receipt['rootExit'],0)
        self.assertTrue(report['samplerStopped']);self.assertIsNone(report['metadataFailure'])
        self.assertGreaterEqual(len(report['samples']),2)
        first,last=report['samples'][0],report['samples'][-1]
        self.assertGreater(int(last['cpuUser100ns'])+int(last['cpuKernel100ns']),
                           int(first['cpuUser100ns'])+int(first['cpuKernel100ns']))
        self.assertGreaterEqual(int(last['ioWriteBytes'])-int(first['ioWriteBytes']),proof['writtenBytes'])
        self.assertFalse(proof['candidateToolExecuted'])
        evidence={'kind':'windows-arm-owned-metrics-fixture-proof','fixtureOnly':True,
            'productionAdmissionNotModified':True,'sourceAdmissionNotProven':True,'fixtureJobResourceMode':producer.REVIEWED_MODE,
            'testOnlySubstitutions':['exact local fixture argv','closed owned scratch environment',
                                    'fixture context for Job resource policy'],
            'sourceHashes':{name:hashlib.sha256((HERE/name).read_bytes()).hexdigest()
                            for name in ('job.py','source_metrics.py','metrics_fixture.py')},
            'pythonExecutableSha256':hashlib.sha256(Path(sys.executable).read_bytes()).hexdigest(),
            'root':str(root),'receipt':receipt,'metrics':report,'fixture':proof}
        output=HERE.parents[1]/'.artifacts/ci-release-20261101/windows-arm-owned-metrics-proof.json'
        output.parent.mkdir(parents=True,exist_ok=True);output.write_text(json.dumps(evidence,indent=2)+'\n')
        print('OWNED_METRICS_PROOF:'+str(output))


if __name__=='__main__':unittest.main()
