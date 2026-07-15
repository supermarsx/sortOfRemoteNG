---
title: Import, Export & Clone
eyebrow: Use the app
description: Move connection data through previews, explicit conflict policies, controlled secret handling, and database-aware cloning.
permalink: /import-export-clone/
---

Portability workflows are designed around review before mutation. Import parses into a preview model, export makes inclusion choices explicit, and clone remaps database-owned sidecars instead of copying identifiers blindly.

## Format coverage

| Family               | Recognized formats                           |
| -------------------- | -------------------------------------------- |
| Native / interchange | JSON, XML, CSV                               |
| Connection managers  | mRemoteNG, RDCMan, Royal TS / TSX, MobaXterm |
| Terminal clients     | Termius, PuTTY, SecureCRT                    |

Compatibility means the importer recognizes the source format. It does not mean every source-specific field has a native equivalent or that every imported protocol has a complete session client. Review [Protocols]({{ '/protocols/' | relative_url }}) before applying a large migration.

## Import safely

<ol class="steps">
  <li><strong>Select the source and format.</strong> Use automatic detection only when the preview clearly identifies the input.</li>
  <li><strong>Inspect parsed items.</strong> Check names, endpoints, ports, protocols, folders, and warnings before apply.</li>
  <li><strong>Resolve conflicts.</strong> The preview classifies no conflict, same ID, same name, or same endpoint.</li>
  <li><strong>Choose a policy.</strong> Duplicate, skip, or rename intentionally; do not assume the importer will overwrite an existing connection.</li>
  <li><strong>Apply to the intended database.</strong> Confirm the selected destination and unlock it if required.</li>
  <li><strong>Reopen a sample.</strong> Verify protocol settings, credentials policy, and folder placement before trusting the full batch.</li>
</ol>

<div class="callout callout--danger">
  <strong>Imported protocol names are not capability proof.</strong>
  <p>Vendor RAW or PowerShell-like entries may be converted to the nearest saved model. That mapping preserves data as far as practical; it does not create a native RAW socket client or a complete PowerShell Remoting session.</p>
</div>

## Export deliberately

Before exporting, decide whether the artifact needs secrets and whether the destination is within the same trust boundary. Prefer the smallest useful selection and keep generated files out of source control.

- Verify the selected connections and folder scope.
- Exclude credentials unless the receiving workflow truly needs them.
- Protect encrypted artifacts with a strong, separately shared password.
- Treat plaintext JSON, XML, CSV, and diagnostic exports as sensitive until inspected.
- Test restoration from important backups; a file existing is not proof that it is usable.

The detailed at-rest and backup threat model lives in [Encryption at rest]({{ '/security/encryption-at-rest/' | relative_url }}).

## Clone connections and databases

Connection clone creates a new identity and can omit secrets unless inclusion is selected. Database clone is broader: it targets a destination database, preserves folder relationships, remaps database-owned sidecars, and can add tags during the operation.

Credentials are included by default in the database clone workflow because it is intended for movement inside the same trust boundary. Turn that off when the destination has different operators, storage guarantees, or retention rules.

After cloning, verify:

- the destination database and collection name;
- connection and folder counts;
- tags and parent relationships;
- behavior rules and saved network-path references;
- credential inclusion; and
- a small sample of real session opens.

See [Security]({{ '/security-overview/' | relative_url }}) before moving secrets and [Connections & Editor]({{ '/connections-editor/' | relative_url }}) for the saved connection model.
