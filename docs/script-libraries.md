---
title: Script libraries
permalink: /scripts/libraries/
---

# Script libraries

Script Manager separates **Terminal scripts** from **Website userscripts**. Creating, importing, restoring, or editing a script never runs it.

## Editing and checking source

The local CodeMirror editor provides syntax highlighting, line numbers, search, undo, bracket matching, and snippets. JavaScript has automatic local parser diagnostics, local-variable completion, and an explicit local Prettier Format action. Formatting changes only the draft; it never saves or runs it.

Bash/sh support syntax and snippets; installed ShellCheck and shfmt can provide analysis and formatting. PowerShell supports syntax and snippets, with installed parser/PSScriptAnalyzer capabilities reported by the native tool check. **Check local tools** is explicit and installs nothing. This enables **Analyze as I type** when an analyzer is available; disable its checkbox to keep checks manual. Requests wait for one second of idle time, do not overlap, pause while hidden or read-only, and discard stale replies. Formatting remains manual. Batch provides lexical highlighting and command snippets, not a formal linter or formatter.

Tooling accepts at most 64 KiB of UTF-8 source. Larger terminal drafts remain intact with tooling disabled. A syntax-clean script is not a security audit. Unsaved website drafts require confirmation before leaving; writes temporarily make their fields read-only, and an externally changed or deleted script requires a fresh review.

PowerShell checks conservatively reject `using`, `requires`, `configuration`, `dynamicparam`, and `import-dscresource` tokens (case-insensitive, including backtick-obfuscated forms), even in comments or strings, to avoid parse-time module, assembly, or DSC loading. Module autoload is disabled; no custom analysis rules or configuration paths are accepted.

## Terminal defaults and categories

Browse default scripts to filter 32 diagnostic templates by category, platform, or text and inspect their source. The original eight defaults retain their saved IDs. The 24 additional system, service, storage, network, and package-inventory templates are catalog-only: select and import them explicitly to create independent custom copies. They are not automatically added to existing libraries.

Restoring an original default keeps its ID. Replacing a saved default version requires explicit review. Only selected defaults are restored; other custom scripts, modified defaults, and deleted-default markers remain unchanged. A concurrent library change or unavailable storage refuses the import rather than overwriting an unreviewed library.

Package inventory templates cover dpkg, RPM, pacman, APK, zypper, Homebrew, winget, Chocolatey v2+, pip, and npm. These are read-only diagnostic commands, not install/update recipes. Review the source and target platform before execution; tools, output, and required permissions vary. Commands may expose system details in terminal output. Categories remain available even when no saved script currently uses them.

## Website userscripts

Open Website userscripts explicitly to access the existing protected HTTP/HTTPS script library. The view captures its owning database and becomes unavailable after database switching, access suspension, or global encryption lock. Reopen it after unlocking the original database. There is no browser-storage fallback or empty-library reset on an access failure.

Website scripts are JavaScript records, not terminal commands or interaction macros. Editing preserves their IDs, so existing connection favorites continue referencing them. Duplication creates a new ID. Deletion is reviewed and leaves existing favorite references unresolved; remove those references in the connection editor's Favorites section if no longer needed. Interaction macros in the same protected library are preserved.

Source is limited to 64 KiB and must not contain literal credentials. The manager never executes scripts. To use a saved script, refresh/reopen the HTTP/HTTPS action library if necessary and pin it there. Running still requires global script availability, explicit per-connection JavaScript permission, the current page/session access checks, and the configured confirmation.

This is page JavaScript, not a browser-extension userscript engine. Metadata such as `@grant`, `@require`, and automatic URL matching does not provide privileges or automatic execution.
