// Exact private-branch scratch evidence. Never a source owner or admission API.
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import {constants} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {authority,verifyCheckout} from './mac_clang_resource_carrier.mjs';
import {CANDIDATE,publicSourceScopeCases} from './mac_source_scope_binding.mjs';
import {held,executeJoined} from './mac_process_census_proof.mjs';
import {runSupervisorProof} from './mac_census_supervisor_proof.mjs';
import {validateSupervisorReport} from './mac_process_census_carrier.mjs';
import {MAC_NATIVE_CENSUS_ADMITTED,createMacProcessCensusFactory} from '../../../scripts/lib/cef-engineering-checkpoint.mjs';
import {MAC_SOURCE_POLICY,MAC_INTEL_SOURCE_POLICY,validateMacSourceWriteScope,validateMacIntelSourceWriteScope} from '../../../scripts/lib/cef-mac-source-metadata.mjs';
const PYTHON='/usr/local/Cellar/python@3.14/3.14.7/Frameworks/Python.framework/Versions/3.14/bin/python3.14';
const sha=b=>createHash('sha256').update(b).digest('hex');
const stamp=s=>[s.dev,s.ino,s.mode,s.uid,s.gid].map(String).join(':');
export async function productionRefusals(){
  assert.equal(MAC_NATIVE_CENSUS_ADMITTED,false);assert.equal(MAC_SOURCE_POLICY.darwinWriteAdmitted,false);assert.equal(MAC_INTEL_SOURCE_POLICY.darwinWriteAdmitted,false);
  const host={platform:process.platform,architecture:process.arch,imageOS:process.env.ImageOS,image:process.env.ImageVersion,githubActions:process.env.GITHUB_ACTIONS,runnerEnvironment:process.env.RUNNER_ENVIRONMENT,repositoryVisibility:process.env.GITHUB_REPOSITORY_VISIBILITY};
  const rows=[];
  for(const value of publicSourceScopeCases()){
    const identity={target:value.target,source:value.source,image:'20260824.0482.1',canonicalRoot:`/Users/runner/work/_temp/sorng-cef-engineering/${value.target}/${value.source}`};
    const gate=value.target==='aarch64-apple-darwin'?validateMacSourceWriteScope:validateMacIntelSourceWriteScope;
    assert.throws(()=>gate(identity,host),/HOST_SCOPE/);
    await assert.rejects(createMacProcessCensusFactory({...identity,scratch:'/never-created-by-source-scope-proof',python:PYTHON,deadline:performance.now()+1000}),{message:'CENSUS_UNADMITTED'});
    rows.push({target:value.target,source:value.source,case:value.case,sourceWriteDenied:true,productionCensusDenied:true});
  }
  return rows;
}
function validatePythonRefusals(value){
  assert.deepEqual(Object.keys(value).sort(),['kind','rows','productionAdmitted'].sort());assert.equal(value.kind,'closed-production-census-refusal');assert.equal(value.productionAdmitted,false);
  assert.deepEqual(value.rows,publicSourceScopeCases().map(v=>({target:v.target,source:v.source,case:v.case,code:v.case==='new'?'CENSUS_UNADMITTED':'CENSUS_ROOT',productionAdmitted:false})));
  return value;
}
async function pythonRefusals(env,end){
  const childEnv={PATH:'/usr/bin:/bin'};
  for(const key of ['RUNNER_TEMP','ImageOS','ImageVersion','GITHUB_ACTIONS','RUNNER_ENVIRONMENT','GITHUB_REPOSITORY_VISIBILITY'])childEnv[key]=env[key];
  const result=await executeJoined(PYTHON,['-I','-B','-S','tests/fixtures/cef/mac_source_scope_census_denials.py'],{cwd:env.GITHUB_WORKSPACE,env:childEnv,timeout:Math.max(1,Math.min(5000,end-performance.now()-1000)),joinDeadline:end,maxBuffer:16384,killSignal:'SIGKILL',windowsHide:true});
  assert.equal(result.stderr,'');assert(Buffer.byteLength(result.stdout)<16384);return validatePythonRefusals(JSON.parse(result.stdout));
}
export async function main(){
  assert.equal(process.argv.length,2);authority(process.env,process.platform,process.arch);
  const env=process.env,started=Number(env.CEF_MAC_CLANG_JOB_STARTED_MS),now=Date.now();assert(Number.isSafeInteger(started)&&started>0&&now>=started);
  const remaining=Math.min(220000,started+300000-now-30000);assert(remaining>=190000,'SCOPE_SUPERVISOR_ORIGINAL_LEASE');const end=performance.now()+remaining;
  const witness=await verifyCheckout(env,end),witnessSha256=sha(Buffer.from(JSON.stringify(witness)));
  assert.equal(sha(await held(PYTHON,13592)),'b08b055365df6dcd3fff0b805b688428f0f6a01839303f22c0716780155c480d');
  const before=await productionRefusals(),pythonBefore=await pythonRefusals(env,end);
  const temp=await fs.realpath(env.RUNNER_TEMP);assert.equal(temp,'/Users/runner/work/_temp');
  const output=path.join(temp,'cef-mac-census-supervisor-proof-'+randomUUID());await fs.mkdir(output,{mode:0o700});
  const owned=await fs.lstat(output,{bigint:true});assert(owned.isDirectory()&&!owned.isSymbolicLink()&&owned.uid===BigInt(process.getuid())&&(owned.mode&0o777n)===0o700n);
  const supervisor=validateSupervisorReport(await runSupervisorProof(output));
  assert(performance.now()<end,'SCOPE_SUPERVISOR_DEADLINE');
  const after=await productionRefusals(),pythonAfter=await pythonRefusals(env,end);assert.deepEqual(after,before);assert.deepEqual(pythonAfter,pythonBefore);
  assert.deepEqual(await verifyCheckout(env,end),witness,'SCOPE_SUPERVISOR_SOURCE_DRIFT');
  assert.equal(stamp(await fs.lstat(output,{bigint:true})),stamp(owned));
  const report={kind:'fixed-new-source-supervisor-scope-proof',schemaVersion:1,head:env.GITHUB_SHA,runId:env.GITHUB_RUN_ID,runAttempt:env.GITHUB_RUN_ATTEMPT,candidateProducer:CANDIDATE.producer,candidateOriginalFreezeSha256:CANDIDATE.originalFreezeSha256,sources:CANDIDATE.sources,sourceWitnessSha256:witnessSha256,witness,supervisor,productionRefusals:{before,after,pythonBefore,pythonAfter},complete:true,productionAdmitted:false,productionInputWrites:false,sourceAcquisition:false,GNExecuted:false,sdkBuilt:false,nativeAcceptance:false,runtimeReady:false};
  const raw=Buffer.from(JSON.stringify(report)+'\n');assert(raw.length<128*1024,'SCOPE_SUPERVISOR_REPORT_BOUND');
  const fd=await fs.open(path.join(output,'scope-carrier.json'),constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
  try{await fd.writeFile(raw);const opened=await fd.stat({bigint:true});assert(opened.isFile()&&opened.nlink===1n&&opened.size===BigInt(raw.length));}finally{await fd.close();}
  assert.equal(stamp(await fs.lstat(output,{bigint:true})),stamp(owned));assert((await held(path.join(output,'scope-carrier.json'),128*1024)).equals(raw));
  assert(performance.now()<end,'SCOPE_SUPERVISOR_DEADLINE');await fs.appendFile(env.GITHUB_OUTPUT,`root=${output}\n`);
  console.log(JSON.stringify({kind:report.kind,complete:true,productionAdmitted:false,nativeAcceptance:false,runtimeReady:false}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(()=>{console.error('SOURCE_SCOPE_SUPERVISOR_PROOF_FAILED');process.exitCode=1;});
