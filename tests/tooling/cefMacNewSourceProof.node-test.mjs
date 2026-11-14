import assert from 'node:assert/strict';
import test from 'node:test';
import {execFileSync,spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {WITNESSES,parseGitWitness,authority,WORKFLOW,BRANCH} from '../fixtures/cef/mac_clang_resource_carrier.mjs';
import {CANDIDATE,verifyCandidateWitness,verifySelectedRows,originalCandidateBytes,publicSourceScopeCases,validatePublicSourceScopes} from '../fixtures/cef/mac_source_scope_binding.mjs';
import {productionRefusals} from '../fixtures/cef/mac_source_scope_supervisor_carrier.mjs';
const git=(...args)=>execFileSync('git',args,{windowsHide:true,maxBuffer:4*1024**2});
// The exact reviewed private checkout/index is the owning immutable input.
const tree=git('write-tree').toString().trim();
const batch=execFileSync('git',['cat-file','--batch'],{windowsHide:true,maxBuffer:2*1024**2,input:WITNESSES.map(p=>tree+':'+p+'\n').join('')});
const rows=parseGitWitness(batch);
const selected=git('ls-tree','-r',tree,'--','scripts','native/cef-hosted-recipe.json','.node-version','.github/workflows/cef-engineering-checkpoint.yml',...new Set(CANDIDATE.nativeInputFiles.map(r=>r.path.split('/').slice(0,3).join('/'))));

test('actual proof copy is precisely the frozen candidate with closed false gates and one branch inverse',()=>{
  verifyCandidateWitness(rows);
  const result=verifySelectedRows(selected,rows);
  assert.equal(result.rows,132);assert.equal(result.candidateOriginalTreeVerified,true);assert.equal(result.candidateProducer,CANDIDATE.producer);assert.notEqual(result.proofProducer,result.candidateProducer);
});
test('missing duplicate and changed candidate/native witness bodies remain denied',()=>{
  assert.throws(()=>verifyCandidateWitness(rows.filter(r=>r.path!==CANDIDATE.sourceFiles[0].path)));
  assert.throws(()=>verifyCandidateWitness([...rows,rows[0]]));
  for(const path of [CANDIDATE.sourceFiles[2].path,CANDIDATE.nativeInputFiles[0].path]){
    const changed=rows.map(r=>r.path===path?{...r,bytes:Buffer.concat([r.bytes,Buffer.from('\n')])}:r);
    assert.throws(()=>verifyCandidateWitness(changed));
  }
});
test('blanket inverse deletion or promoted production gates cannot masquerade as the proof copy',()=>{
  const file='scripts/lib/cef-checkpoint-archive.py',row=rows.find(r=>r.path===file);
  const promoted=originalCandidateBytes(file,row.bytes);
  assert.throws(()=>originalCandidateBytes(file,promoted),/INVERSE_COUNT/);
  assert.throws(()=>verifyCandidateWitness(rows.map(r=>r.path===file?{...r,bytes:promoted}:r)),/INVERSE_COUNT/);
});
test('complete selected tree/native modes and hashes are checked independently of report labels',()=>{
  const text=selected.toString();
  assert.throws(()=>verifySelectedRows(Buffer.from(text.replace('100644','100755')),rows));
  assert.throws(()=>verifySelectedRows(Buffer.from(text.replace(/blob [a-f0-9]{40}/,'blob '+'0'.repeat(40))),rows));
  assert.throws(()=>verifySelectedRows(Buffer.from(text+'100644 blob '+'0'.repeat(40)+'\tscripts/unknown.mjs\n'),rows));
});
test('all old new and wrong source production factories and JS write scopes are refused',async()=>{
  const denied=await productionRefusals();assert.equal(denied.length,6);
  for(const row of denied){assert.equal(row.productionCensusDenied,true);assert.equal(row.sourceWriteDenied,true);}
});
test('Python production context refusal executes the actual fixed helper without spawning a worker',()=>{
  const python=process.platform==='win32'?'python':'python3';
  const result=spawnSync(python,['-I','-B','-S','tests/fixtures/cef/mac_source_scope_census_denials.py'],{encoding:'utf8',windowsHide:true,timeout:10000,maxBuffer:16384});
  assert.equal(result.status,0,result.stderr);assert.equal(result.stderr,'');const value=JSON.parse(result.stdout);assert.equal(value.productionAdmitted,false);assert.equal(value.rows.length,6);
  for(const row of value.rows)assert.equal(row.code,row.case==='new'?'CENSUS_UNADMITTED':'CENSUS_ROOT');
});
test('metadata source refusal report cannot drop negatives or claim a promoted gate',()=>{
  const cases=publicSourceScopeCases();validatePublicSourceScopes({before:cases,after:cases});
  assert.throws(()=>validatePublicSourceScopes({before:cases.slice(1),after:cases}));
  assert.throws(()=>validatePublicSourceScopes({before:cases,after:cases.map(r=>({...r,productionAdmitted:true}))}));
  assert.throws(()=>validatePublicSourceScopes({before:cases,after:cases,complete:true}));
});
test('private workflow authority is fixed to one branch source and actual host identity',()=>{
  const env={GITHUB_ACTIONS:'true',RUNNER_ENVIRONMENT:'github-hosted',ImageOS:'macos15',ImageVersion:'20260824.0482.1',GITHUB_REF:BRANCH,GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_REPOSITORY:'supermarsx/sortOfRemoteNG',GITHUB_REPOSITORY_ID:'1010282954',GITHUB_REPOSITORY_VISIBILITY:'public',GITHUB_SHA:'a'.repeat(40),GITHUB_WORKFLOW_SHA:'a'.repeat(40),GITHUB_WORKFLOW_REF:WORKFLOW,GITHUB_RUN_ID:'1',GITHUB_RUN_ATTEMPT:'1'};
  authority(env,'darwin','x64');
  for(const change of [{GITHUB_REF:'refs/heads/main'},{GITHUB_WORKFLOW_SHA:'b'.repeat(40)},{ImageVersion:'latest'},{GITHUB_REPOSITORY_VISIBILITY:'private'}])assert.throws(()=>authority({...env,...change},'darwin','x64'));
  assert.throws(()=>authority(env,'linux','x64'));
});
test('workflow uses only exact private scratch jobs with read-only permissions and no compiler pipeline',()=>{
  const body=readFileSync('.github/workflows/cef-mac-clang-resource-proof.yml','utf8');
  assert.equal((body.match(/github.ref == 'refs\/heads\/codex\/mac-source-scope-proof-20261114'/g)||[]).length,2);
  assert(body.includes('contents: read'));assert(!body.includes('contents: write'));assert(!body.includes('restore_run'));assert(!body.includes('cef-engineering-checkpoint.mjs'));
  assert(body.includes('mac_clang_resource_carrier.mjs'));assert(body.includes('mac_source_scope_supervisor_carrier.mjs'));
});
