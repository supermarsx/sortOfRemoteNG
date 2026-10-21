---
title: Capture a Windows native crash
eyebrow: Development
description: Record native exception stacks and local minidumps during development.
permalink: /native-crash-capture/
---

# Capture a Windows native crash

When the development app exits with a native exception but prints no stack,
enable local crash capture before starting it:

```powershell
$env:SORNG_NATIVE_CRASH_CAPTURE = "1"
npm run tauri dev
```

The launcher prints the report directory before opening the app. Reproduce the
crash once. The debugger follows the app and its child processes and records the
native exception, thread stacks, and a small minidump there. Reports stay on your
machine and are not uploaded. Minidumps can contain private application data;
share the exception and symbolic stack first.

Stack overflows are also captured before the application's exception handler
runs. A recovered exception alone does not make a successful run fail.

This mode requires Microsoft's Windows SDK Debugging Tools (`cdb.exe`). If the
debugger is unavailable, startup explains the missing requirement. Capture does
not change the selected browser runtime, profile, proxy route, or sandbox policy.
It uses the same profile as the development command; add `--isolated-profile` if
you want a separately compiled development profile.

See Microsoft's [CDB documentation](https://learn.microsoft.com/en-us/windows-hardware/drivers/debugger/cdb-command-line-options)
for the debugger's child-process and logging options.

Disable capture in that PowerShell session with:

```powershell
Remove-Item Env:SORNG_NATIVE_CRASH_CAPTURE
```

A clean run only proves that run did not reproduce a native crash. Stack capture
does not itself fix the underlying exception.
