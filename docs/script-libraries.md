---
title: Script libraries
permalink: /scripts/libraries/
---

# Script libraries

Script Manager separates **Terminal scripts** from **Website userscripts**. Creating, importing, restoring, or editing a script never runs it.

Both Script Manager and Macro Manager offer explicit app-wide and database destinations. App entries remain in their existing protected app libraries; database entries travel inside that database's existing encrypted/plain protection boundary. Switching destinations does not copy entries or redirect failed writes. Macro Manager keeps terminal command/delay sequences and website value-free interaction steps as their original distinct formats, with separate Browse/import/export families. No sequence is converted into a script.

## Editing and checking source

The local CodeMirror editor provides syntax highlighting, line numbers, search, undo, bracket matching, and snippets. Website JavaScript and TypeScript have automatic local parser diagnostics, local-variable completion, and an explicit local Prettier Format action. These are syntax checks, not project-wide semantic type checking. Formatting changes only the draft; it never saves or runs it.

Bash/sh support syntax and snippets; installed ShellCheck and shfmt can provide analysis and formatting. PowerShell supports syntax and snippets, with installed parser/PSScriptAnalyzer capabilities reported by the native tool check. **Check local tools** is explicit and installs nothing. This enables **Analyze as I type** when an analyzer is available; disable its checkbox to keep checks manual. Requests wait for one second of idle time, do not overlap, pause while hidden or read-only, and discard stale replies. Formatting remains manual. Batch provides lexical highlighting and command snippets, not a formal linter or formatter.

Tooling accepts at most 64 KiB of UTF-8 source. Larger terminal drafts remain intact with tooling disabled. A syntax-clean script is not a security audit. Unsaved website drafts require confirmation before leaving; writes temporarily make their fields read-only, and an externally changed or deleted script requires a fresh review.

PowerShell checks conservatively reject `using`, `requires`, `configuration`, `dynamicparam`, and `import-dscresource` tokens (case-insensitive, including backtick-obfuscated forms), even in comments or strings, to avoid parse-time module, assembly, or DSC loading. Module autoload is disabled; no custom analysis rules or configuration paths are accepted.

## Terminal defaults and categories

The embedded **Browse scripts** subtab includes 191 app-shipped entries: 32 Script Manager diagnostic templates and 159 Bulk SSH commands. Filter by source, category, platform, or text and inspect source; results are paged in groups of 50. Bulk entries are preview/copy-only and direct you to Bulk SSH Commander. Vendor CLI commands are not mislabeled as Bash imports.

Compact source icons provide tooltips and accessible labels instead of large badges. **Verified app template** means the content matches the trusted local catalog, not that execution is safe. Third-party/imported content remains **Third-party source** even when its publisher claims to be official or its bytes resemble a bundled template. Edited/custom content is identified separately.

Fresh Script Manager libraries are empty. All 32 bundled templates are Browse-only until you explicitly select and import them; none of the original eight are automatically inserted or restored on load. Previously saved/imported templates retain their IDs and edits. Additional system, service, storage, network, and package-inventory templates import as independent custom copies.

Restoring an original default keeps its ID. Replacing a saved default version requires explicit review. Only selected defaults are restored; other custom scripts, modified defaults, and deleted-default markers remain unchanged. A concurrent library change or unavailable storage refuses the import rather than overwriting an unreviewed library.

Package inventory templates cover dpkg, RPM, pacman, APK, zypper, Homebrew, winget, Chocolatey v2+, pip, and npm. These are read-only diagnostic commands, not install/update recipes. Review the source and target platform before execution; tools, output, and required permissions vary. Commands may expose system details in terminal output. Categories remain available even when no saved script currently uses them.

## Website userscripts

Open Website userscripts explicitly and choose its app-wide or database destination. The app library is independent of the open connection database; a database library requires that exact database to be open and unlocked. Database switching or access-generation changes invalidate database reviews and clear their private drafts. Global encryption/access revocation also hides private source. Retry the selected destination after restoring access; there is no silent app fallback, browser-storage fallback, or empty-library reset.

Writes preserve native script IDs, reviewed provenance, and unrelated macro families through the shared library authority. An externally changed library refreshes the list without discarding a draft; replacing/deleting still requires its exact reviewed version. Scope changes use the manager's unsaved-draft confirmation, while access revocation clears the private editor immediately.

Website scripts are JavaScript or standalone TypeScript records, not terminal commands or interaction macros. The language selector defaults to JavaScript, including older records with no language field. Editing preserves their IDs, so existing connection favorites continue referencing them. Duplication creates a new ID. Deletion is reviewed and leaves existing favorite references unresolved; remove those references in the connection editor's Favorites section if no longer needed. Interaction macros in the same protected library are preserved.

TypeScript source is saved and exported intact. On manual execution, a lazily loaded local compiler removes types and emits modern JavaScript before sending anything to the page. Invalid syntax, TSX, imports/exports (including dynamic imports), CommonJS, namespaces, external reference directives and top-level await are refused. Async functions inside a standalone script are supported. There is no package resolution, remote compiler, terminal TypeScript interpreter, or semantic type-checking promise. Source and compiled output are each limited to 64 KiB. After compilation the exact saved source, owner access and current document are checked again; raw TypeScript is never injected. Execution retains the same consent and page privileges as JavaScript.

Source is limited to 64 KiB and must not contain literal credentials. The manager never executes scripts. To use a saved script, refresh/reopen the HTTP/HTTPS action library if necessary and pin it there. Running still requires global script availability, explicit per-connection JavaScript permission, the current page/session access checks, and the configured confirmation.

Website favorites retain the exact app/database scope, kind and ID. Identical IDs from different libraries stay distinct; an unavailable database reference never runs the app-wide item of the same name or ID. Save and review drafts before running. Saved source is resolved again before confirmation, after confirmation, and before each macro step (including after a field-value prompt). A changed/deleted source, navigation or revoked owner access stops execution without replaying completed steps. New scripts and recorded macros default to app-wide storage; choose the current owning database explicitly in **Saved item destination** when available.

This is page JavaScript, not a browser-extension userscript engine. Metadata such as `@grant`, `@require`, and automatic URL matching does not provide privileges or automatic execution.

## Public catalogs and portable packages

Browse can also load a manually selected public raw HTTPS JSON index or local package. Select saved scripts/macros and **Export package** to create an index you can upload directly to a public Git repository; no JSON authoring is required. Refresh updates preview only. Imports require explicit destination and conflict review, and external publisher claims are never treated as verified official sources. See [Public automation catalogs]({{ '/scripts/catalogs/' | relative_url }}) for publishing, safety limits, and the four native script/macro formats.
