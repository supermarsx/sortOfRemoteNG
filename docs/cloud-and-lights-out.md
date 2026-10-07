---
title: Cloud & Lights-Out Connections
eyebrow: Use the app
description: Configure the twelve cloud and BMC management panels, understand their credential boundaries, and recover safely from failed sessions.
permalink: /cloud-and-lights-out/
---

## Picker and session model

The connection picker exposes four **Lights-Out & BMC** protocols and eight
**Cloud Platforms** protocols. Opening one resolves a dedicated runtime
descriptor and mounts its management panel through `SessionViewer`.

These are management sessions. They do not provide a shell, framebuffer, or
generic remote desktop merely because the panel opens.

| Picker protocol | Required saved fields                                    | Optional non-secret context                                                 | What connect proves                                                                                        |
| --------------- | -------------------------------------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Dell iDRAC      | Host, username, password                                 | Insecure TLS choice, timeout, forced Redfish/WS-Man/IPMI protocol           | The native device connect path must succeed; capabilities still depend on live hardware and firmware.      |
| HPE iLO         | Host, username, password                                 | Auth mode, iLO generation, timeout, Redfish/RIBCL/IPMI choice and IPMI port | The native device connect path must succeed; capabilities still depend on live hardware and firmware.      |
| Lenovo XClarity | Host, username, password                                 | XCC/IMM generation, timeout, Redfish/legacy REST/IPMI choice and IPMI port  | The native device connect path must succeed; capabilities still depend on live hardware and firmware.      |
| Supermicro BMC  | Host, username, password                                 | Platform, TLS verification, auth mode and timeout                           | The native device connect path must succeed; capabilities still depend on live hardware and firmware.      |
| Google Cloud    | Project ID and service-account JSON credential           | Region, zone, OAuth scopes and endpoint override                            | Local service-account parsing and client/session initialization. It does not prove a provider API request. |
| Microsoft Azure | Tenant ID, client ID, subscription ID and client secret  | Default resource group and region                                           | An Azure token request is attempted. Inventory and resource permissions require later live calls.          |
| DigitalOcean    | API token                                                | Region                                                                      | Local backend session creation only.                                                                       |
| IBM Cloud       | API key                                                  | Region and resource group                                                   | Local backend session creation only.                                                                       |
| Heroku          | API key                                                  | App name and region                                                         | Local backend session creation only.                                                                       |
| Scaleway        | API key                                                  | Organization ID, project name and region                                    | Local backend session creation only.                                                                       |
| Linode          | API key                                                  | Region                                                                      | Local backend session creation only.                                                                       |
| OVHcloud        | Application/API key, application secret and consumer key | Service ID, project name and region                                         | Local backend session creation after validating the three-part credential bundle.                          |

<div class="callout">
  <strong>Connected is not universal proof of provider authentication.</strong>
  <p>For Google Cloud, DigitalOcean, IBM Cloud, Heroku, Scaleway, Linode, and OVHcloud, local session creation does not prove live authentication, authorization, account access, or inventory. Confirm those with a real provider operation.</p>
</div>

## Saved settings and protected secrets

The saved `Connection.password` field is the protected credential boundary for
these protocols. At-rest protection follows the active connection database and
vault configuration.

- GCP stores service-account JSON in the protected credential.
- Azure stores the client secret there.
- DigitalOcean, IBM Cloud, Heroku, Scaleway, and Linode store their API token or
  key there.
- OVHcloud stores a JSON credential bundle containing `apiKey`, `appSecret`,
  and `consumerKey` there.
- Provider-specific settings contain non-secret project, region, organization,
  resource-group, service, scope, or endpoint context only.
- Frontend runtime handles contain only backend session identifiers.
- Public cloud status DTOs and Lights-Out safe-config DTOs omit credentials.

Connection exports remain sensitive whenever the export workflow includes
credentials. Do not paste connection JSON, provider config, screenshots, or
diagnostics containing credential material into an issue.

## Legacy cloud records

Older saved records may contain a `cloudProvider` object. The editor and runtime
normalizer read that deprecated shape and map it into the canonical
provider-specific settings plus the protected credential:

| Legacy field                                                                   | Canonical destination                 |
| ------------------------------------------------------------------------------ | ------------------------------------- |
| GCP `projectId`, `region`, `zone`                                              | `gcpSettings`                         |
| GCP `serviceAccountKey`                                                        | protected credential                  |
| Azure tenant, client, subscription, resource-group and region fields           | `azureSettings`                       |
| Azure `clientSecret`                                                           | protected credential                  |
| Provider `apiKey` or `accessToken`                                             | protected credential                  |
| Provider region, app, organization, project, resource-group or service context | the matching provider settings object |
| OVHcloud `apiKey`, `appSecret`, `consumerKey`                                  | protected credential bundle           |

Canonical values win when both forms exist. Invalid non-string legacy values
are dropped rather than coerced. The next explicit save or autosave removes the
deprecated object. Reopening that record uses only the canonical fields.

An OVHcloud raw value that is not valid JSON stays masked. Enter all three
credentials to replace it. A partial bundle remains invalid and is rejected
before native invocation.

## Concurrency and teardown

- Each Lights-Out provider has one runtime lease. A second tab for the same
  provider is rejected until teardown finishes; different hardware providers
  can coexist.
- Azure is process-wide and permits one active lease.
- The other seven cloud providers use per-session leases and can run in
  parallel.
- Closing or unmounting a panel joins an in-flight connect before disconnect
  and coalesces duplicate teardown requests.
- A connect or disconnect rejection still releases the frontend lease in a
  `finally` path so the connection can be reopened.
- Native iDRAC, iLO, and Lenovo teardown removes their client/config state.
  Supermicro logs out its protocol clients and replaces its credential-bearing
  client with an empty default client.

## Failure, rollback, and recovery

1. Correct validation errors in the editor before retrying. Missing required
   identifiers or credentials never reach native invocation.
2. If connect fails, close the panel and reopen it after correcting network,
   TLS, endpoint, or credential settings.
3. If disconnect reports an error, the local lease is still released. Restart
   the app before retrying if backend state is uncertain.
4. A full application restart clears in-memory session state. Reopening creates
   a new session; it does not reattach an old provider or BMC session.
5. Revoke or rotate a provider token if a failed remote logout could have left
   a provider-side session active.
6. Keep a rollback copy of the connection database before bulk migration, but
   treat that backup as sensitive because it may contain protected credentials.

The app does not currently reconcile arbitrary pre-existing backend sessions
after a process restart. It also cannot prove inventory permissions without a
live provider operation or prove device capability without real supported BMC
hardware.

## Developer contract

The primary implementation and regression seams are:

- `src/types/connection/connection.ts`
- `src/utils/connection/cloudConnectionContract.ts`
- `src/utils/session/builtInCloudRuntimeRegistry.ts`
- `src/utils/session/builtInManagementRuntimeRegistry.ts`
- `src/utils/session/cloudRuntimeAdapters.ts`
- `src/utils/session/bmcRuntimeAdapters.ts`
- `src/components/connectionEditor/CloudProviderOptions.tsx`
- `tests/cloud/cloudEditorRuntimeContract.test.tsx`
- `tests/cloud/cloudRuntimeRecovery.test.ts`
- `tests/cloud/builtInCloudRuntimeRegistry.test.ts`
- `tests/hardware/BmcSessionPanel.test.tsx`
- the `t57_secret_hardening_tests` modules in the four native service crates

Source-level registration and focused tests are not substitutes for live
provider/device validation. Release evidence must state which real providers,
accounts, BMC generations, transports, and firmware versions were exercised.

## Application-data cloud sync

Settings → Cloud Sync synchronizes selected application snapshots through
Nextcloud, WebDAV, SFTP, Google Drive or OneDrive. This is separate from the
providers' file-management and file-sync panels.

**What to Sync** discovers existing databases and app-wide automation libraries,
plus portable appearance preferences from settings storage. Select individual
items or all currently available items. New discoveries are not automatically
selected. Locked, missing or unsupported artifacts retain their selection and
show an explanation; unlock or explicitly deselect them before syncing.

Database Center rows and the sync inventory show the current database file's
actual byte length, including its encryption envelope. Measurement does not
open, decrypt or unlock databases, and does not depend on sync eligibility.
Sizes refresh after saves and can also be refreshed manually. Backups, trust
sidecars and unsaved edits are excluded, so this is not the final cloud archive
size. Browser-only mode labels the stored UTF-8 JSON size instead of claiming a
physical file size. Missing files and failed metadata reads are reported
separately, never as an empty database.

A database is one coherent archive: connections, documents and attachments,
password vault, automation, database settings, recycle bin and trust records.
It must already exist locally as an unlocked managed protected database. The
sync engine does not recreate missing databases or copy device-local private-key
files. Move those keys into the database vault to make them portable. Database
names and descriptions in the local index remain local; they do not create
spurious body-content conflicts between devices.
Global appearance sync excludes device paths, network/security policy and cloud
account credentials. Deselecting an item stops synchronization; it does not
delete its existing cloud copy. Exclusion patterns match whole artifact IDs,
virtual names or labels, not nested database records or arbitrary local files.

Configure each destination separately. Nextcloud accepts the HTTPS instance
address, username, app password and destination folder. WebDAV accepts an HTTPS
DAV endpoint with Basic, Digest or Bearer authentication. SFTP requires a
verified `SHA256:` server host-key fingerprint and password or inline private
key; atomic replacement requires the OpenSSH `posix-rename` extension. Google
Drive and OneDrive use the supplied OAuth tokens and optional refresh-client
configuration. Refreshed tokens are cached in memory, not written back to the
saved account configuration. Configured destination subfolders can be created;
connection tests write, verify and remove a uniquely named probe file.

Database and library snapshots require password-based client-side encryption.
Use the same sync password on participating devices. Optional compression runs
before encryption. The complete envelope and decoded snapshot must each fit the
configured limit (at most 100 MiB). Existing encrypted snapshots cannot silently
be downgraded to plaintext.

Manual, startup, save-triggered and interval sync use the same engine. Custom
intervals accept whole minutes, hours or days, from one minute to seven days;
changing the interval reschedules the background timer. Writes
verify their uploaded content and use provider revisions; competing writers,
ambiguous duplicate cloud files and same-item divergent edits become conflicts.
Independent items can merge; same-item conflicts require the configured policy
or an explicit Keep local / Keep remote action in target status. Local edits
made during a transfer are checked again before restore. Database body and trust
restore are separate transactions: an incomplete restore is reported, never
advertised as atomic or silently rolled back. Opt-in shutdown sync keeps the
window open if synchronization does not complete successfully.

Realtime sync uses **Adaptive smart sync** by default, including for existing
configurations that have no saved preference. This does not enable cloud sync,
select new artifacts, change the chosen frequency or enable automatic conflict
resolution. Isolated changes wait 3 seconds after the last saved edit. Five
relevant writes within a rolling 3-minute window switch the pending batch to a
90-second quiet period. Continued editing restarts that quiet period; a
10-minute maximum wait prevents indefinite postponement while the transport is
idle. The Settings frequency section exposes the adaptive toggle, baseline and
busy quiet periods, maximum wait and minimum pause between automatic runs.
Turning adaptive off keeps fixed trailing debouncing. On-save retains its
separate half-second debounce and 15-second maximum wait by default.

Only selected database/library saves and selected portable appearance changes
count as activity; sync status updates do not trigger another run. Pending edits
during an active transfer coalesce into one follow-up after it finishes, never
an overlapping automatic run. Remote data application can cause a single
verification follow-up; unchanged data is not applied or uploaded again.
Manual sync remains available immediately. Debouncing reduces avoidable
collisions but does not replace provider revisions, local compare-and-swap
guards or conflict review.

Automated checks exercise local provider fixtures, snapshot encryption, artifact
selection, conflicts and storage coordination. They do not establish that a real
account's credentials, quotas or permissions are valid; use **Test connection**
for the configured destination before the first real synchronization.

### Record dates and migration

Database bodies carry a versioned `recordMetadata` ledger inside their existing
storage envelope. It indexes connections (including folders), tab groups,
documents and their ID-bearing blocks, attachments, people, tickets, vault
entries, automation items, recycle-bin entries, settings and tag definitions.
Nested objects without an independent stable ID belong to their containing
record; they are not assigned array-index identities. The root record tracks
changes to the complete body, including ordering and anonymous nested content.

Each entry has creation/modification dates, their provenance, a content digest
and a revision. The journal records revision ancestry and operation kind, not
passwords or before/after content. Deletions leave tombstones even after recycle
bin cleanup. Restoring an ID preserves its creation history. History limits
fail explicitly instead of silently dropping deletion or ancestry information.

Migration is lazy and local: opening a database prepares its ledger and saves
with the exact previously loaded representation as the compare-and-swap guard.
Subsequent writes maintain it, including writers that rebuild their payload
without carrying the ledger. Full archives preserve this metadata. Migration
does not convert the encryption format or enroll new unlock methods. A locked
database remains unchanged until it is opened with local unlock authority.

Existing valid dates are preserved. Dates that cannot be recovered are marked
inferred, using an available enclosing timestamp or the epoch as an explicitly
unknown-history sentinel. Migration time is not presented as the original edit
time. Reopening unchanged data does not generate new edits. Later observed
updates preserve creation dates and use monotonic per-record dates even if the
local clock moves backwards. Those dates are audit information, not proof of
causal order across devices.

Cloud Sync's review shows a **Version history** summary of this existing ledger:
shared revisions and revisions present only locally or remotely. It identifies
when one history contains the other, when both have new branches, and when their
origins or metadata cannot be compared safely. This is not a second history
store or a last-writer-wins rule: a higher count or later timestamp never selects
a whole-copy winner. Body validation, shared-baseline checks, dependency checks
and explicit merge blockers remain authoritative. No private record IDs, hashes,
paths or contents appear in the summary. Display comparison is capped at 5,000
events and 512 KiB of metadata per copy; reaching either cap does not truncate
the underlying ledger or change the normal merge limits.

App-wide automation libraries migrate under their existing storage CAS. Native
settings and Trust Center records maintain their own timestamp metadata at their
locked persistence boundaries. Portable appearance sync still sends only its
five allowed preferences, not the complete application-settings history or
account configuration. Runtime sessions, caches, diagnostics and third-party
API response objects are not promoted into synchronized application records.
Cloud-sync status ticks are persisted without adding history entries; edits to
the actual sync configuration still do. Incoming snapshots with existing ledgers
must match their recorded content. Only snapshots without a ledger receive the
legacy upgrade; inconsistent remote history is rejected before apply.

Large-collection performance remains a limitation. A local Windows/Node stress
test with 100,000 synthetic connections took about 29 seconds for initial ledger
migration and validation, and about 19 seconds for a one-record update; peak RSS
was about 637 MiB. These are not webview timings or typical-collection estimates.
Worker offloading and incremental hashing are still needed before claiming
interactive performance at that scale.

### Decision: three-way record merge, not last-writer-wins

The sync engine compares whole artifacts first, then uses a bounded salted-hash
content baseline for three-way smart merge. Non-overlapping record changes can
combine; concurrent edits to the same record, deletion versus modification,
ambiguous ordering, invalid dependencies and incompatible histories need review.
`Keep newer` asks for review when both copies changed: snapshot upload time and
locally observed change time cannot reliably rank offline edits.

#### Repairing separately initialized histories

“Separate starting histories” means the same record identity has different
initial revisions, often after independent migration or import. It does not mean
the record is missing an ID or timezone. A content baseline alone cannot establish
shared ancestry, and updating the app does not rewrite an existing ledger.

In **Settings → Cloud Sync → Conflict Resolution**, refresh the target's review.
When both histories validate and the shared baseline proves the current contents
can merge without conflicts, **Reconcile histories and merge** becomes available
for that artifact. Choose it and **Apply reviewed choices**. No repair is selected
automatically, and the global conflict strategy is unchanged. If the option is
absent, resolve the other reported content, history or dependency blockers first;
do not delete metadata to force a sync.

The reviewed operation retains every original history event and each root's
creation provenance, adding explicit multi-parent reconciliation revisions in
ledger version 3. It does not fabricate a common past, choose content by date,
or preserve historical payload copies. Future ordinary writes and smart merges
retain the joined history, including when a known pre-repair branch returns.
All participating devices must use a build supporting ledger version 3; older
builds reject it instead of discarding unfamiliar metadata. Review and apply
recheck both copies, the baseline, dependencies and provider revisions; editing
either copy after review requires a fresh review.

Further conflict-resolution work beyond this reviewed repair includes:

1. Persist an **encrypted common-base snapshot** per database/target and a
   revision DAG. Stable IDs and parent revisions determine whether a change
   descends from the base; UTC dates explain it to a person.
2. Compare base/local/remote by record ID. Automatically combine one-sided edits
   and additions to different IDs. Within a record, combine disjoint field edits
   only with schema-specific rules; arrays need explicit ordering semantics.
3. Preserve both branches for same-field edits, delete-versus-edit, moves that
   produce invalid folder graphs, and incompatible schema changes. Present a
   per-record review showing local/remote/base, operation dates and inferred-date
   badges. Never expose passwords in the general activity log.
4. Treat credentials, trust approval/revocation, security policy and their
   references as protected conflict units. Never resurrect a forgotten or
   revoked identity through an automatic merge. Validate all links, IDs and
   domain invariants before committing an entire reviewed database generation.
5. Keep tombstones until all participating replicas have acknowledged them, or
   require a deliberate baseline reset for an expired replica. A short recycle
   bin retention window is not a safe tombstone retention policy.
6. Publish with remote revision preconditions and apply with local exact-base
   CAS. Recovery must distinguish upload success, body success and trust success;
   pending staged generations must survive a crash. Do not describe the existing
   separate body/trust writes as one transaction.

All comparison/decryption/merging happens locally after unlocking the relevant
database and cloud envelope. The cloud stores encrypted snapshots; it receives
neither the database unlock password nor plaintext conflict payloads. Opaque
backup of a locked file is conceptually possible, but is a different workflow
from record merge and is not enabled by this migration.

This choice follows the revision-tree/common-ancestor approach described in
[CouchDB's conflict model](https://docs.couchdb.org/en/stable/replication/conflicts.html),
while retaining application-specific review. A wholesale CRDT conversion is not
recommended for credentials and trust: even
[Automerge's conflict model](https://automerge.org/docs/reference/documents/conflicts/)
retains concurrent property assignments for application handling. CRDTs can be
considered later for collaborative text editing. Remote conditional writes use
the lost-update protection represented by
[HTTP If-Match](https://www.rfc-editor.org/rfc/rfc9110.html#name-if-match);
that protects the commit, but does not decide the semantic winner.
