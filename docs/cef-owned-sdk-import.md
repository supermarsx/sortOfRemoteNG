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
