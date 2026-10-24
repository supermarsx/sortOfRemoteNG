---
title: Reviewed local CEF SDK import
description: Review, quarantine and independently verify owned CEF SDK bytes before native acceptance.
hide_page_header: true
---

# Reviewed local CEF SDK import

This opt-in producer ingests operator-reviewed local bytes. It does **not** replay the original build, prove a hosted build, grant publication authority, or establish native acceptance. Existing hosted and engineering SDK selectors retain their separate contracts.

## Review before use

A separate reviewed change must register a portable record at `native/cef-owned-sdk-imports/<review-id>/review.json`, preserve its exact bytes, and independently approve its raw SHA256. No real review records are included with this implementation.

The closed record binds one target, original source identity, original raw source-lock digest, descriptor, engine, inventory count, exact five asset names/sizes/digests, raw genuine handoff digest, original evidence pins, reviewed Python digest/size and canonical original review digest. It contains no original machine paths, credentials or raw private evidence. Only Windows x64 packages and owned Linux x64 engine results are supported. The supplied original source identity is never rebound to the current six-platform lock.

## Explicit local quarantine

First inspect `plan --reviewed <committed-review> --review-sha256 <raw-sha256>`. The following is an operator action requiring separately authorized upload credentials; preparing this implementation does not authorize it:

```powershell
node scripts/cef-owned-sdk-import.mjs quarantine-upload --reviewed <committed-review> --review-sha256 <raw-sha256> --bundle <five-file-directory> --handoff <pinned-handoff.json> --local-review <original-private-review.json> --inputs <original-inputs> --evidence <original-evidence> --verify-output <new-owned-handoff-output> --commit <exact-checkout-commit> --execute
```

The uploader checks the committed portable raw record and pinned handoff, then runs the unchanged genuine handoff verifier again in a Node child with an explicit token-free environment. Its Python/archive descendants receive no uploader credentials. The fresh deterministic handoff must match the reviewed raw digest. This checks current original inputs, evidence, reviewed Python, extraction, inventory and binary exports before any API write. Output must meet the existing handoff verifier's new UUID child contract under this checkout's `.artifacts`.

Only a new draft/prerelease quarantine and its five exact assets can be appended. No release publication, editing, deletion, overwrite or fallback is exposed. Keep original private inputs and evidence local.

## Independent Actions seal

The default-branch-only public manual `cef-owned-sdk-import.yml` workflow accepts the committed review path, independently approved raw review SHA256 and exact quarantine release ID. Its token is read-only. It GETs the exact five draft assets, checks bytes again, extracts in an owned directory with trusted isolated Python, verifies SDK inventory, native binary and exports, rechecks the unchanged draft and source identity, then writes a small completion seal. Uploading that seal is the final step. Failed or partial verification cannot become a successful producer run.

The seal explicitly records `operator-reviewed-local-bytes`, `hostedBuild: false`, `originalBuildReplayed: false`, `nativeAcceptance: false` and `runtimeReady: false`. Original build evidence is a reviewed provenance binding, not independently replayed by this workflow.

## Native acceptance and publication boundary

An owned-import selection has exactly eleven fields: `target`, `runId`, `headSha`, `artifactId`, `artifactSha256`, `descriptorSha256`, `producer`, `runAttempt`, `completionSha256`, `reviewedImport`, and `reviewSha256`. Set producer to `owned-import`.

The acceptance adapter verifies repository/default branch/manual workflow/run attempt/current successful status and immutable source digest before GET-only transport. It binds the small Actions seal, portable review and unchanged five draft assets, then revalidates the actual bundle. Transport tokens do not enter native fixture processes. Real TLS and HTTP/2 admission, revocation, isolation, sandbox, privacy and cleanup gates remain required on the actual native target. A static seal is not native acceptance.

The existing publisher derives identities per bundle, but its protected workflow still expects reviewed hosted inputs. Publication authorization/adapter wiring, actual review records, immutable catalog pins, and all required platform acceptance are separate pending work. This importer neither changes defaults nor publishes a runtime.
