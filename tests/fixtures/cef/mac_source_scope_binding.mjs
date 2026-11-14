// Fixed reviewed proof data; no report or caller input can admit production.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {CANDIDATE} from './mac_source_scope_candidate.mjs';
import {codeTreeDigest} from '../../../scripts/lib/cef-engineering-checkpoint.mjs';
export {CANDIDATE};
export const OLD_SOURCES = Object.freeze({
  'aarch64-apple-darwin':'65ec154279f1ed2e697da5c1823e7cf0af7c30cebc33b027206c5219329aae54',
  'x86_64-apple-darwin':'684efda8d6e0001e871ffdf3ed7df84a80643db84de4e118c8e2d2cb1e3adfef',
});
export const INVERSE = Object.freeze({
  'scripts/lib/cef-checkpoint-archive.py':[
    ['MAC_SOURCE_WRITE_ADMITTED = False','MAC_SOURCE_WRITE_ADMITTED = True',1],
    ['MAC_INTEL_SOURCE_WRITE_ADMITTED = False','MAC_INTEL_SOURCE_WRITE_ADMITTED = True',1],
    ['MAC_CLANG_LITERAL_PRODUCTION_ADMITTED = False','MAC_CLANG_LITERAL_PRODUCTION_ADMITTED = True',1],
    ["branch='refs/heads/codex/mac-source-scope-proof-20261114'","branch='refs/heads/codex/mac-clang-resource-metadata-20261102'",1],
  ],
  'scripts/lib/cef-engineering-checkpoint.mjs':[
    ['export const MAC_NATIVE_CENSUS_ADMITTED = false;','export const MAC_NATIVE_CENSUS_ADMITTED = true;',1],
  ],
  'scripts/lib/cef-mac-process-census.py':[
    ['PRODUCTION_CENSUS_ADMITTED = False','PRODUCTION_CENSUS_ADMITTED = True',1],
  ],
  'scripts/lib/cef-mac-source-metadata.mjs':[
    ['darwinWriteAdmitted: false,','darwinWriteAdmitted: true,',2],
  ],
});
const sha=b=>createHash('sha256').update(b).digest('hex');
const blob=b=>createHash('sha1').update(Buffer.from(`blob ${b.length}\0`)).update(b).digest('hex');
export function originalCandidateBytes(path,raw) {
  assert(Buffer.isBuffer(raw),'SCOPE_PROOF_RAW');
  let text=raw.toString('utf8');
  for(const [from,to,count] of INVERSE[path]??[]){
    assert.equal(text.split(from).length-1,count,'SCOPE_PROOF_INVERSE_COUNT');
    text=text.split(from).join(to);
  }
  return INVERSE[path]?Buffer.from(text):raw;
}
export function verifyCandidateWitness(rows) {
  assert.equal(CANDIDATE.kind,'held-unqualified-mac-source-scope-candidate');
  assert.equal(CANDIDATE.originalFreezeSha256,'fcaa57ca06d5f28e1c6ed62ab01d292249c1fdab1a94949e39cc7d21e90ebb33');
  assert.equal(CANDIDATE.producer,'119f2ff904c4ba95fe7b9fcd88ce49a465645c555f85f16d725d48ee2f8ddd10');
  assert.equal(CANDIDATE.sourceFiles.length,7);assert.equal(CANDIDATE.nativeInputFiles.length,60);
  assert.equal(new Set(rows.map(row=>row.path)).size,rows.length,'SCOPE_PROOF_DUPLICATE_WITNESS');
  const byPath=new Map(rows.map(row=>[row.path,row.bytes]));
  for(const expected of [...CANDIDATE.sourceFiles,...CANDIDATE.nativeInputFiles]){
    const raw=byPath.get(expected.path);assert(raw,'SCOPE_PROOF_MISSING_CANDIDATE');
    const original=originalCandidateBytes(expected.path,raw);
    assert.equal(original.length,expected.bytes,'SCOPE_PROOF_ORIGINAL_BYTES');
    assert.equal(sha(original),expected.sha256,'SCOPE_PROOF_ORIGINAL_SHA');
    assert.equal(blob(original),expected.blob,'SCOPE_PROOF_ORIGINAL_GIT_BLOB');
    assert.equal(expected.mode,'100644');
  }
}
export function verifySelectedRows(raw,rows){
  verifyCandidateWitness(rows);
  assert(Buffer.isBuffer(raw)&&raw.length<128*1024,'SCOPE_PROOF_TREE_BOUND');
  const tree=raw.toString('utf8').trim().split('\n').map(line=>{
    const match=/^(100644) (blob) ([a-f0-9]{40})\t([^\r\n]+)$/.exec(line);assert(match,'SCOPE_PROOF_TREE_ROW');
    return{mode:match[1],type:match[2],sha:match[3],path:match[4]};
  });
  assert.equal(tree.length,192);assert.equal(CANDIDATE.selectedRows.length,132);
  const selectedPaths=new Set(CANDIDATE.selectedRows.map(row=>row.path));
  const actual=tree.filter(row=>selectedPaths.has(row.path));assert.equal(actual.length,132);
  const native=tree.filter(row=>!selectedPaths.has(row.path));assert.equal(native.length,60);
  const expectedNative=new Map(CANDIDATE.nativeInputFiles.map(row=>[row.path,row]));
  for(const row of native){const expected=expectedNative.get(row.path);assert(expected,'SCOPE_PROOF_EXTRA_NATIVE_INPUT');assert.deepEqual(row,{mode:expected.mode,type:'blob',sha:expected.blob,path:expected.path});}
  assert.equal(codeTreeDigest(CANDIDATE.selectedRows),CANDIDATE.producer);
  const witness=new Map(rows.map(row=>[row.path,row.bytes]));
  const proofRows=CANDIDATE.selectedRows.map(row=>Object.hasOwn(INVERSE,row.path)?{...row,sha:blob(witness.get(row.path))}:row);
  assert.deepEqual(actual,proofRows,'SCOPE_PROOF_SELECTED_TREE_DRIFT');
  return{rows:132,candidateProducer:CANDIDATE.producer,proofProducer:codeTreeDigest(actual),candidateOriginalTreeVerified:true};
}
export function publicSourceScopeCases(){
  return ['aarch64-apple-darwin','x86_64-apple-darwin'].flatMap(target=>[
    ['old',OLD_SOURCES[target]],['new',CANDIDATE.sources[target]],['wrong','0'.repeat(64)],
  ].map(([label,source])=>({target,source,case:label,modesDenied:3,productionAdmitted:false})));
}
export function validatePublicSourceScopes(value){
  assert(value&&Object.keys(value).sort().join(',')==='after,before','SCOPE_PROOF_PUBLIC_SCOPES');
  assert.deepEqual(value.before,publicSourceScopeCases());assert.deepEqual(value.after,publicSourceScopeCases());
  return value;
}
