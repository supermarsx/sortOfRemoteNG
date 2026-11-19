"""Closed proof of production refusal only. Never launches a native worker."""
import importlib.util
import json
from pathlib import Path
import sys
import time

ROOT=Path(__file__).resolve().parents[3]
spec=importlib.util.spec_from_file_location('scope_census',ROOT/'scripts/lib/cef-mac-process-census.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
SOURCES={
 'aarch64-apple-darwin':('3dfd71cfafb56a4168917ec681252fdce1ce57cb224d277d159255a210062212','cb334e9c4146dfe82c9be3f5a4ec043ea56986c66d69c5a84486ac8db43d5fd5'),
 'x86_64-apple-darwin':('c3ea924815d18c5e702a2231883b896f3439604b620a8b2c96983b0794a4ba0f','15af3ea9142658464a5227f365bbcc92e4ab52675d5ed6f81cbb4faa3afc91b4'),
}

def main():
    assert len(sys.argv)==1 and module.PRODUCTION_CENSUS_ADMITTED is False
    rows=[]
    for target,(old,new)in SOURCES.items():
        assert module.NATIVE_SOURCES[target]==new
        for label,source in [('old',old),('new',new),('wrong','0'*64)]:
            value={'kind':'mac-census-session','mode':'production','target':target,'source':source,
              'canonicalRoot':'/Users/runner/work/_temp/sorng-cef-engineering/'+target+'/'+source,
              'image':module.IMAGE,'phase':'compile','workMilliseconds':1000,'leaseMilliseconds':2000,
              'wallEndMilliseconds':int(time.time()*1000)+2000,'requestBudget':132,
              'evidence':module.NATIVE_EVIDENCE,'supervisorEvidence':module.MAC_SOURCE_SCOPE_QUALIFICATION[18]}
            try:module.native_context(Path('/never-created-by-source-scope-proof'),json.dumps(value))
            except module.CensusError as error:
                expected='CENSUS_UNADMITTED'if label=='new'else'CENSUS_ROOT'
                assert str(error)==expected
            else:raise AssertionError('PRODUCTION_CONTEXT_ACCEPTED')
            rows.append({'target':target,'source':source,'case':label,'code':expected,'productionAdmitted':False})
    print(json.dumps({'kind':'closed-production-census-refusal','rows':rows,'productionAdmitted':False},separators=(',',':')))

if __name__=='__main__':main()
