---
title: Reviewed local CEF SDK import
description: Review, quarantine and independently verify owned CEF SDK bytes before native acceptance.
hide_page_header: true
---

# Reviewed local CEF SDK import

This opt-in producer ingests operator-reviewed local bytes. It does **not** replay the original build, prove a hosted build, grant publication authority, or establish native acceptance. Existing hosted and engineering SDK selectors retain their separate contracts.

## Review before use

A separate reviewed change must register a portable record at `native/cef-owned-sdk-imports/<review-id>/review.json`, preserve its exact bytes, and independently approve its raw SHA256. A review record alone does not establish native runtime readiness.

The closed record binds one target, original source identity, original raw source-lock digest, descriptor, engine, inventory count, exact five asset names/sizes/digests, raw genuine handoff digest, original evidence pins, reviewed Python digest/size and canonical original review digest. It contains no original machine paths, credentials or raw private evidence. Only Windows x64 packages and owned Linux x64 engine results are supported. The supplied original source identity is never rebound to the current six-platform lock.

## Explicit local quarantine

First inspect `plan --reviewed <committed-review> --review-sha256 <raw-sha256>`. The following is an operator action requiring separately authorized upload credentials; preparing this implementation does not authorize it:

```powershell
node scripts/cef-owned-sdk-import.mjs quarantine-upload --reviewed <committed-review> --review-sha256 <raw-sha256> --bundle <five-file-directory> --handoff <pinned-handoff.json> --local-review <original-private-review.json> --inputs <original-inputs> --evidence <original-evidence> --verify-output <new-owned-handoff-output> --commit <exact-checkout-commit> --execute
```

The uploader checks the committed portable raw record and pinned handoff, then runs the unchanged genuine handoff verifier again in a Node child with an explicit token-free environment. Its Python/archive descendants receive no uploader credentials. The fresh deterministic handoff must match the reviewed raw digest. This checks current original inputs, evidence, reviewed Python, extraction, inventory and binary exports before any API write. Output must meet the existing handoff verifier's new UUID child contract under this checkout's `.artifacts`.

Only a new draft/prerelease quarantine and its five exact assets can be appended. No release publication, editing, deletion, overwrite or fallback is exposed. Keep original private inputs and evidence local.

## Independent Actions seal

The default-branch-only public manual `cef-owned-sdk-import.yml` workflow accepts the committed review path, independently approved raw review SHA256 and exact quarantine release ID. Workflow defaults remain `contents: read` and `actions: read`. Only its `import` job requests an ephemeral `contents: write`, `actions: read` token for a controlled draft-visibility experiment after read-capability draft and asset-list GETs returned HTTP 403.

That credential **can write** to the repository and releases at the API capability level; it is not a read-only token. The unchanged seal-mode client remains GET-only and rejects mutation methods before transport. The change neither enables quarantine publication nor introduces a PAT, secret, deployment environment or approval policy. Actual draft visibility must be established by the authenticated run rather than inferred from the permission declaration. Transport credentials remain excluded from verifier subprocesses.

The verifier GETs the exact five draft assets, checks bytes again, extracts in an owned directory with trusted isolated Python, verifies SDK inventory, native binary and exports, rechecks the unchanged draft and source identity, then writes a small completion seal. Uploading that seal is the final step. Failed or partial verification cannot become a successful producer run. This permission experiment applies only to the importer; other draft readers, including engineering SDK downloads, require their own reviewed job scopes. The native planner uses Actions metadata and does not need draft access.

The seal explicitly records `operator-reviewed-local-bytes`, `hostedBuild: false`, `originalBuildReplayed: false`, `nativeAcceptance: false` and `runtimeReady: false`. Original build evidence is a reviewed provenance binding, not independently replayed by this workflow.

## Native acceptance and publication boundary

An owned-import selection has exactly eleven fields: `target`, `runId`, `headSha`, `artifactId`, `artifactSha256`, `descriptorSha256`, `producer`, `runAttempt`, `completionSha256`, `reviewedImport`, and `reviewSha256`. Set producer to `owned-import`.

The acceptance adapter verifies repository/default branch/manual workflow/run attempt/current successful status and immutable source digest before GET-only transport. It binds the small Actions seal, portable review and unchanged five draft assets, then revalidates the actual bundle. Transport tokens do not enter native fixture processes. Real TLS and HTTP/2 admission, revocation, isolation, sandbox, privacy and cleanup gates remain required on the actual native target. A static seal is not native acceptance.

After a successful direct native acceptance run, register a separately reviewed `native/cef-owned-sdk-imports/<review-id>/publication.json` record. It binds the original import selection and the exact acceptance run, attempt, source code, artifact, seal and report digests.

The manual `cef-owned-sdk-publish.yml` workflow verifies that record using an ephemeral job-scoped, write-capable credential because verification downloads the private Draft; its verifier performs GET requests only. Native acceptance likewise reserves that capability for the `owned-import` and `engineering-sdk` Draft download jobs; ordinary hosted-artifact jobs and the planner keep read-only permissions. The reusable caller supplies the required permission ceiling while those read-only jobs explicitly downscope it. Publication repeats verification in the `cef-runtime-publish` environment before immutable engineering publication; this workflow reference does not establish that repository approval rules have been configured. Its publication queue does not cancel an active publisher. Successful verification preserves the original local-build provenance and never claims hosted compilation or production readiness.

Actual review records, successful native runs, immutable catalog pins and all required platform acceptance remain necessary before an application release. These opt-in workflows do not change runtime defaults or the all-platform release gate.

### Owned Windows capsule lifetime engine (source22)

`owned-windows-capsule-lifetime-engine` is a separate x64-only local provenance
class, closed to source identity
`bdc724576452178e82a6d9732aaaf1a770e277ddf5ce5cad5a4d65ac242a9629`
and its 22 patches. It requires the exact 36 owned transport/lifetime tests,
three BRP/DPD tests and three sandbox tests; nine original native Job records;
the nine reviewed source files, eight tools and all 61 generated security
macros. The older 17-patch/12-test Windows path and Linux/R4 paths retain their
existing contracts.

The eighteen evidence roles distinguish original raw records from explicitly
derived binding records. Derived public provenance carries original record
digests, profile counts and fixed security facts, without local Python paths.
An envelope containing an original record retains its exact UTF-8 text and SHA;
its own digest is separately identified. Do not sanitize a record and present
its old hash as the new record's identity. Large DLL/PDB beforeimages remain
local; metadata carries their original digests, not multi-gigabyte JSON data.

Only this origin's complete `engineOutput` may be up to 64 MiB. Other evidence
items keep the existing metadata limit; total evidence is bounded at 96 MiB.
Original text must be valid UTF-8, complete and hash-matched. Oversized output
fails; truncation is not a valid replacement for a genuine build log.

Synthetic schema fixtures do not establish an actual engine or SDK. A genuine
handoff still needs a successful owned full engine Job, original deadline and
cleanup/postchecks, matching new DLL/PDB identities, maintained distribution,
archive roundtrip and fresh prepared-SDK verification. Import remains an
operator-reviewed local byte ingestion, never hosted compilation. The existing
five-asset, source/seal/API/attempt, fresh token-free verifier and redirect
checks remain mandatory. Native platform and browser acceptance are still
required before any runtime publication or release eligibility.

Public `reviewedEvidenceDigests` names hashes of the seventeen reviewed evidence
roles, including any explicitly derived envelopes. It does not call envelope
hashes the hashes of their nested originals. The separate
`nestedOriginalRecordDigests` records the exact original native manifest,
nine stage receipts, four observations, native receipt, generated flags and
engine-record hashes. The pinned envelopes retain those original bytes for
verification; public provenance exposes their hashes rather than raw bodies.

### Distinct source22 operation2 evidence

`owned-windows-capsule-lifetime-operation2` is a separate, explicit operator-local origin. It preserves the failed original engine deadline/exit124 and binds a genuinely successful new four-hour operation; it never converts the original report into legacy success. Existing LinuxR4, Windows17/native12 and first-source22/native42 origins retain their schemas.

The exact twenty-role review adds `previousEngineAttempt` (at most1MiB) and raw `engineAccounting` (at most2MiB) to the eighteen source22 roles. Engine output is limited to64MiB, each other role to1MiB, and the complete evidence set to96MiB. The bounded hashed bytes are the returned bytes. Original records retain raw digests; `reviewedEvidenceDigests` describes reviewed envelopes, and `nestedOriginalRecordDigests` separately names original nested records. Public provenance contains fixed facts/digests and no private paths or credential data.

The new operation requires the unchanged source22 identity, source9/tool8/security61/graph and genuine36+3+3 native results, plus separately observed Clang SHA84ce79856a871a28a062fc9e4586c527a897903caf58bbf37fe9391ec2dd78c7/103794176bytes. Clang is not retrospectively part of the earlier native42 tool8. Engine policy is exactly j12/CPU3000/32GiB/128 processes/three inherited handles/30-second cleanup. Original failed and new operation clocks remain distinct. The reviewed build envelope binds original launch/phase capacity and writer records, and final postchecks require actual compiler identity and successful deadline admission.

Accounting retains decimal strings for64-bit counters, at most2048 rows/2MiB, initial/final samples, bounded periodic observations and exact raw SHA. Processor groups are not collected, CPU denominator is unknown and utilization percentage is null; these records do not establish global CPU utilization or speedup. A missing result, unknown schema, stale launch observation, wrong compiler/policy, nonzero engine, cleanup failure, invalid accounting, mismatched DLL/PDB or expired final budget denies handoff. Synthetic test fixtures do not assert a successful build.

An actual handoff is unavailable until genuine successful operation2 output, matched DLL/PDB and a separately authorized fresh SDK distribution/preparation are reviewed. Import retains existing same-repo/default-manual review, seal/asset/source authority, fresh verifier, credential-safe redirects and mandatory native architecture/security acceptance. Local ingestion never proves hosted compilation or grants publication.

The review/evidence boundary is explicit: coherent JSON, matching hashes and a self-declared controller digest are **not independent execution attestation**. Before any committed review, import or API action, the operator must independently review actual source and the genuine prior attempt manifest782c4521a099a7f3a79beecda15f9ca42c5cfe2aa743e134d139613779806def / receipt0c5fc37f54887576b45d474374137e6b935b282224dc9e0e84fffd04fc6309ea, the new Job and raw accounting. The reviewed controller hard-pins the actual original attempt; the portable evidence validator checks the original-envelope digest chain. Re-pinned synthetic fixtures exercise validation only and do not establish genuine execution. No import authority follows from schema success alone.

### Distinct owned Linux incremental engine evidence

`owned-linux-incremental-engine` is a separate Linux x64 provenance origin,
closed to the original `49f23608a686da56a32a2c825b51fa2577bcbba6353d5f9587a0c68dec9df68e`
predecessor and the reviewed default-colormap candidate
`9d0bc5722d719eff8a20d39ef06fb6f222b239ea44d78dd42e7c40a2f42def2e`.
It does not change the original `owned-linux-engine` fresh-acquisition contract,
Windows origins, runtime defaults, or the six-platform/native acceptance gates.

The twelve exact review roles are `predecessor`, `readiness`, `apply`, `started`,
`container`, `compile`, `compileOutput`, `finished`, `postchecks`, `package`,
`distribution`, and `preparation`. Nontext records use the closed version-one
`schemaVersion/kind/operation/controllerCommit/sourceLockIdentity/target/facts`
envelope. Complete compiler output is bounded to 64 MiB, each other role to
1 MiB, and all evidence to 80 MiB. Bounded hashed bytes are the bytes parsed;
invalid UTF-8, excess output and stream growth fail rather than being truncated.

The predecessor retains the exact original local review, six original producer
records, input source lock and handoff bytes with their separate raw digests.
Those records establish historical bindings only. A new incremental controller
must not mint `freshCheck`, a fresh-acquisition `producer`, or an `executed`
record from the old operation. A new operation binds its own controller, actual
parent container inspection, image, private HOME/kernel/resource observations,
source reconstruction, original eight file pins and separately observed
Clang/GN/Siso/dependency specifications. The latter observations are not
retrospectively members of the original eight-file set. The Siso specification
is an actual pinned specification; an unobserved CIPD stamp must not be invented.

Only patch23's exact source before/after change is admitted. Upstream heads,
all inherited patch/source pins, GN args and every captured security macro/header
must remain unchanged, including the compiled-out instance tracer. The fixed
8-job build has a 60-minute admission deadline and at most 30 seconds of cleanup.
Nonzero compile, deadline, incomplete logs, remaining processes or readers deny
handoff. Fresh distribution and preparation are separately bounded to 15 minutes;
old SDK outputs cannot be overlaid or relabelled. The new engine and sandbox
pins, full file count and all five package assets must agree with the maintained
bundle verifier, strict archive roundtrip, complete SDK inventory, ELF x64 and
four bridge-export checks. The original input source-lock raw digest and the
canonical bundle source-lock raw digest retain separate names.

Portable provenance exposes fixed facts and digests, not private paths, raw
records or inherited native-test results. `reviewedEvidenceDigests` describes
the twelve reviewed records; `nestedOriginalRecordDigests` separately identifies
the retained predecessor originals. `incrementalBuild:true`,
`pristineSourceBuild:false` and `originalBuildReplayed:false` describe the actual
provenance class. `hostedBuild:false`, `nativeAcceptance:not-tested` and
`productionReady:false` remain mandatory. The selected X11 child visual and a
successful physical native run are not established by this schema.

Matching JSON and hashes are not independent proof that a compiler ran. Before
a committed import review or any API action, the operator must independently
review the genuine predecessor and new controller/operation/output records.
Synthetic test fixtures exercise validation and archive transport only; they
are not evidence of a successful incremental SDK. A genuine new build,
independently reviewed handoff, native Linux acceptance and existing publication
protections are still required.

## Isolated Linux incremental workspace

`owned-linux-isolated-incremental-engine` is a separate Linux x64-only origin
for the exact `49f23608…` predecessor to `f4c94e74…` R5 source transition.
The new source has all23 ordered patches, bridge revision5/ABI2/nine
capabilities including `owned-http3`, and the derived POSIX LF bridge header
`1352d790…` (8,886 bytes). Historical `9d0bc572…` R4 records cannot substitute. It keeps
the original cache/SDK volume read-only and records a newly created operation
volume with independent CEF and OUT files. It does not widen the existing
`owned-linux-incremental-engine` or fresh-acquisition origins. In particular,
the source-locked patch23 beforeimage is `0ccac4e8…` (18,399 bytes), and its
real Git-derived postimage is `b9fd179f…` (18,719 bytes); a stale derived pin
from an older controller cannot substitute for that postimage.

The seventeen exact roles are the original twelve incremental roles plus
`workspace`, `copyManifest`, `generation`, `gn` and `gnOutput`. JSON roles have
the closed `sorng-owned-linux-isolated-ROLE` envelope. `compileOutput` and
`gnOutput` contain original UTF-8 output, separately pinned. The full copy
manifest is bounded to 128 MiB; generation records to 48 MiB; compiler output
to 64 MiB; GN output to 16 MiB; other individual records to 1 MiB and all
evidence to 272 MiB. Streamed, bounded, hashed bytes are the bytes parsed.
Overbounds deny; they are not truncated or silently widened.

The workspace record binds actual original-RO and new-volume mount identities,
new-volume initialization, private HOME, copy count/bytes, capacity and the
one operation clock. Initialization can create/chown only the six new empty
subdirectories `base`, `net`, `network`, `cef`, `out` and `operation`, with its exact fixed code and sole new-volume mount;
it has no original-volume or host-user-data mount. Copies must be independent
regular files, not hardlinks or a write-through overlay. Every copied file's
hash, size, mode, mtime and distinct source/destination identity is recorded;
the complete copied tree is re-attested before the manifest is emitted.
`copyManifest` distinguishes four fixed direct-copy trees: complete Chromium
`base`, `net`, `services/network` and the selected OUT. Each has its own
source/target roots, full file/directory inventory and digest. All nine new-file
parents are inside these new copies. Unchanged Git/dependency/source paths
outside the fixed roots remain read-only; unknown GN writes must fail.

CEF is separately projected from canonical inputs and the reviewed old12
reconstruction, with its own refs/config/index and a read-only original object
alternates reference. It is explicitly **not a byte-identical cache copy**.
The workspace binds old12/new23 CEF inventories, complete projected directory
membership, separately owned Git metadata and actual seven-query equivalence.
Original Git indexes/refs/config remain read-only. No arbitrary writable bind
or tmpfs can open another source path.

The aggregate ceilings are 256 GiB, 500,000 files, 100,000 directories and 8 GiB per copied
file, shared across all direct copies, projected CEF and private Git metadata.
Git metadata additionally has a 256-file/16 MiB bound. Projected CEF limits and
seven retained metadata envelopes are not widened.
Unknown link/type, changed identity, shared inode, excess tree or missing disk
headroom denies. At least 100 GiB must remain after copying; existing configured
compiler/security settings cannot be relaxed to fit.

Current private-generation facts must independently reproduce the old12
baseline, apply the exact eleven-patch suffix13–23, then reproduce source23
outputs and all three header actions. The closed transition records all 69
touched paths: 60 existing and 9 absent preimages, then 69 present postimages.
These maps are derived by real private Git application from pinned public
blobs and are checked against all raw patch pins, readiness and postchecks.
The old one-file X11 transition cannot qualify an H3/lifetime build. These generation records are not borrowed from an earlier temporary diagnostic. All seven
metadata files and six command logs are pinned; the new-stage names are
`new23-hook` and `new23-output.json`. Output membership is derived from actual
bound input inventories and the complete source23 CEF overlay. Earlier
source13 generation counts, output digests and successful exits are not new23
execution evidence. Only the two source-defined
API JSON date comments and their exactly inherited API-header comment lines
may have declared equivalence: original raw bytes remain retained, the actual
hook-local date window is bound, and literal substitutions must reproduce the
entire actual raw file. API/platform/sandbox hashes, other bytes, other headers,
source inputs, GN args and security macros remain strict. A schema fixture is
not genuine execution evidence.

Actual GN output/graph and a uniquely identified source-to-object edge bind
the changed `window_x11.cc`, with GN additionally binding the complete source
postimage inventory; the copied object must change, local compile work
must finish naturally with exit zero, and the final linked engine must have a
new identity. Fresh distribution, strict archive roundtrip, complete SDK/ELF
and five-export checks remain mandatory (including configure_datagrams). No old SDK or native result transfers.

The finite work budget is 7,800 seconds plus one shared 30-second cleanup bound:
admission/copy 1,800; generation 600; GN 900; compile/link 3,600; fresh packaging 900. Capacity, actual OUT types and admitted GN pin/stamp bindings can deny
before any compiler. They are observed prerequisites, not assertions that the
machine will fit or that warm objects guarantee a fast build. No automatic
retry, deadline reset, stock runtime or sandbox bypass is authorized.

Portable provenance adds only qualified copy/isolation facts and raw digests,
including the copy manifest, generation/GN records and new object identity.
It omits private paths and raw machine records. `hostedBuild:false`,
`nativeAcceptance:not-tested`, `productionReady:false` and publication/upload
denials remain unchanged. Genuine operator review, the existing all-nine native
acceptance chain and all-six release/catalog protections are still required.
