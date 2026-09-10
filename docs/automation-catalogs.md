---
title: Public automation catalogs
permalink: /scripts/catalogs/
---

# Public automation catalogs

Browse scripts and Browse macros can read public Git-hosted JSON indexes or locally selected JSON packages. They do not clone repositories, install dependencies, run hooks, execute source, or enable connection automation permissions.

## Publish without writing JSON

1. Choose the app or database library and the automation kind in the manager.
2. Under **Export selected destination entries**, load the destination and select saved scripts or macros.
3. Choose **Export package** and save the JSON file. Review its contents before sharing; source can contain sensitive information even when automated secret checks pass.
4. Commit or upload that file to a public Git repository. Copy its **raw HTTPS JSON** URL, not the repository's HTML page.
5. Paste it into **Catalog link (raw HTTPS JSON)** and select **Refresh source**.

The exported package is already a valid catalog index; no hand-authored manifest or separate publishing service is needed. No default external feed is configured. Ref paths may use a branch, tag, or pinned commit as supported by the publisher's raw-file endpoint. Pinned commits provide a stable reference; branches can change between manual refreshes.

## Review and import

Refresh changes only the displayed source. Inspect the source text or native macro steps, description, platform labels, and provenance, then select entries and review the destination. Each entry requires an explicit choice:

- **Import independent copy:** allocate a new ID without replacing existing entries or favorites.
- **Skip:** do not import that entry.
- **Replace reviewed existing entry:** preserve the matching custom entry's ID and favorite references. The destination must still match the reviewed snapshot. Shipped `default-*` entries require their separate built-in restore flow instead.

Imports use one automation kind and one explicit destination at a time. There is no cross-library atomic import or silent fallback to the app library. Locking, changing the owner/access generation, or a conflicting destination write requires a fresh review. Save dialogs also recheck the selected destination before exporting.

The four manifest kinds preserve their existing native formats: `terminal-script`, `terminal-macro`, `website-script`, and `website-macro`. Terminal macro commands/delays remain steps; website macros remain value-free interaction steps. They are never converted into shell or JavaScript source. Importing does not grant execution permission or run a script/macro.

## Source identity and limits

External publishers and repository metadata are **claims, not verified official status**. SHA-256 records the exact bytes reviewed; it proves neither publisher identity nor that the source is safe. Only locally bundled catalogs are labeled app-shipped.

Remote reads require the desktop app and public HTTPS URLs, at most 2,048 characters. Credentials, query strings, fragments, custom ports, redirects, private/reserved IP destinations, compressed responses, and invalid TLS certificates are refused. DNS answers are checked and pinned for that request. Existing connection credentials, proxy settings, and certificate exceptions are not used. Private/authenticated Git repositories are not supported; use a reviewed local package instead. No source is refreshed or imported automatically.

Each manifest is bounded to 2 MiB of UTF-8 JSON and 128 entries. Portable script source and terminal macro step data are limited to 64 KiB per entry; terminal macros have at most 200 steps. Existing website-library validation also applies. Likely literal credentials cause refusal rather than silent redaction. Unknown fields/versions and malformed native payloads are rejected without replacing the destination.

## Manifest shape

Export is the recommended authoring path. For tooling authors, the versioned envelope has `format: "sorng-automation-index"`, `version: 1`, an ID, name, description, and `entries`. Each entry has an ID matching its payload, a four-kind discriminator, description, platform labels, and its native payload. Optional publisher/repository/provenance metadata remains informational. See the [synthetic terminal-script example]({{ '/examples/automation-index.json' | relative_url }}).

The index bundles source in the payload; it does not fetch additional script URLs, Git submodules, `@require` dependencies, or arbitrary attachments. Repository metadata contains a URL/ref/path for human review only.
