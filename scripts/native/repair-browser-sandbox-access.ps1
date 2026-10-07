param(
    [Parameter(Mandatory = $true)][string]$Bundle,
    [Parameter(Mandatory = $true)][string]$AppName
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
Import-Module (Join-Path $PSHOME 'Modules/Microsoft.PowerShell.Security/Microsoft.PowerShell.Security.psd1') -ErrorAction Stop

# Set-Acl/SetSecurityInfo can propagate unchanged inherited ACEs into unrelated
# children. The native, handle-based setter changes only the selected object's
# DACL, matching the application's startup preflight. No owner/SACL writes.
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
public static class SorngBrowserRuntimeDacl {
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern SafeFileHandle CreateFileW(string path, uint access, uint share, IntPtr security, uint creation, uint flags, IntPtr template);
    [DllImport("ntdll.dll")]
    private static extern int NtSetSecurityObject(SafeFileHandle handle, uint information, [In] byte[] descriptor);
    [DllImport("ntdll.dll")]
    private static extern uint RtlNtStatusToDosError(int status);
    public static void Set(string path, byte[] descriptor) {
        // READ_CONTROL | WRITE_DAC | FILE_READ_ATTRIBUTES; no DELETE. Pin the
        // exact entry against replacement while writing. No recursive setter.
        using (var handle = CreateFileW(path, 0x60080, 3, IntPtr.Zero, 3, 0x02200000, IntPtr.Zero)) {
            if (handle.IsInvalid) throw new Win32Exception(Marshal.GetLastWin32Error());
            int status = NtSetSecurityObject(handle, 4, descriptor);
            if (status < 0) throw new Win32Exception((int)RtlNtStatusToDosError(status));
        }
    }
}
'@

# No recursion, inherited grants, profile paths, ownership changes or elevation.
# Chromium requires both the normal and restricted application-package SIDs.
$runtimeNames = @(
    'libcef.dll', 'chrome_elf.dll', 'libEGL.dll', 'libGLESv2.dll',
    'd3dcompiler_47.dll', 'dxcompiler.dll', 'dxil.dll', 'vk_swiftshader.dll',
    'vulkan-1.dll', 'icudtl.dat', 'v8_context_snapshot.bin', 'snapshot_blob.bin',
    'resources.pak', 'chrome_100_percent.pak', 'chrome_200_percent.pak',
    'vk_swiftshader_icd.json'
)
if (-not [IO.Path]::IsPathRooted($Bundle) -or $AppName -notmatch '^[A-Za-z0-9][A-Za-z0-9 ._-]{0,79}$' -or $AppName -match '[ .]$') {
    throw 'Invalid browser bundle or application name'
}
$root = Get-Item -LiteralPath $Bundle -Force
if (-not $root.PSIsContainer -or $root.FullName.TrimEnd('\') -eq [IO.Path]::GetPathRoot($root.FullName).TrimEnd('\')) {
    throw 'A filesystem root cannot be a browser bundle'
}
for ($ancestor = $root; $null -ne $ancestor; $ancestor = $ancestor.Parent) {
    if (($ancestor.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw 'Browser bundle ancestors must not be reparse points'
    }
}
$targets = [Collections.Generic.List[object]]::new()
$targets.Add($root)
foreach ($required in @("$AppName.exe", "$AppName.dll", 'libcef.dll')) {
    $entry = Get-Item -LiteralPath (Join-Path $root.FullName $required) -Force
    if ($entry.PSIsContainer) { throw 'Browser runtime entry must be a regular file' }
    $targets.Add($entry)
}
foreach ($name in $runtimeNames) {
    if ($name -eq 'libcef.dll') { continue }
    $candidate = Join-Path $root.FullName $name
    if (Test-Path -LiteralPath $candidate) {
        $entry = Get-Item -LiteralPath $candidate -Force
        if ($entry.PSIsContainer) { throw 'Browser resource must be a regular file' }
        $targets.Add($entry)
    }
}
$localePath = Join-Path $root.FullName 'locales'
if (Test-Path -LiteralPath $localePath) {
    $localeDirectory = Get-Item -LiteralPath $localePath -Force
    if (-not $localeDirectory.PSIsContainer -or ($localeDirectory.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw 'Browser locale directory must not be redirected'
    }
    $targets.Add($localeDirectory)
    foreach ($entry in Get-ChildItem -LiteralPath $localePath -Force) {
        if ($entry.Name -match '^[A-Za-z0-9_-]+\.pak$') {
            if ($entry.PSIsContainer) { throw 'Browser locale must be a regular file' }
            $targets.Add($entry)
        }
    }
}
$sids = @('S-1-15-2-1', 'S-1-15-2-2')
$rights = [Security.AccessControl.FileSystemRights]::ReadAndExecute
$none = [Security.AccessControl.InheritanceFlags]::None
$propagation = [Security.AccessControl.PropagationFlags]::None
$allow = [Security.AccessControl.AccessControlType]::Allow
$pending = [Collections.Generic.List[object]]::new()
foreach ($entry in $targets) {
    if (($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or $entry.LinkType -eq 'HardLink') {
        throw 'Browser runtime entries must not be symbolic links, junctions or hard links'
    }
    $acl = Get-Acl -LiteralPath $entry.FullName
    $rules = $acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])
    $changed = $false
    foreach ($sidText in $sids) {
        $granted = 0
        foreach ($rule in $rules) {
            if (($rule.PropagationFlags -band [Security.AccessControl.PropagationFlags]::InheritOnly) -ne 0) { continue }
            $identity = $rule.IdentityReference.Value
            if (($identity -eq $sidText -or $identity -eq 'S-1-1-0') -and $rule.AccessControlType -ne $allow -and ($rule.FileSystemRights -band $rights) -ne 0) {
                throw 'An explicit or inherited deny prevents browser sandbox access; review the installation permissions'
            }
            if ($identity -eq $sidText -and $rule.AccessControlType -eq $allow) {
                $granted = $granted -bor [int]$rule.FileSystemRights
            }
        }
        if (($granted -band [int]$rights) -ne [int]$rights) {
            $sid = [Security.Principal.SecurityIdentifier]::new($sidText)
            $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($sid, $rights, $none, $propagation, $allow))
            $changed = $true
        }
    }
    if ($changed) { $pending.Add(@{ Path = $entry.FullName; Acl = $acl }) }
}
# Validate the complete allowlist before any changes; retain all other ACLs.
foreach ($item in $pending) {
    $entry = Get-Item -LiteralPath $item.Path -Force
    if (($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or $entry.LinkType -eq 'HardLink') {
        throw 'Browser runtime entry changed during sandbox permission preparation'
    }
    [SorngBrowserRuntimeDacl]::Set($item.Path, $item.Acl.GetSecurityDescriptorBinaryForm())
}
foreach ($entry in $targets) {
    $rules = (Get-Acl -LiteralPath $entry.FullName).GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])
    foreach ($sidText in $sids) {
        $granted = 0
        foreach ($rule in $rules) {
            if ($rule.IdentityReference.Value -eq $sidText -and $rule.AccessControlType -eq $allow -and ($rule.PropagationFlags -band [Security.AccessControl.PropagationFlags]::InheritOnly) -eq 0) {
                $granted = $granted -bor [int]$rule.FileSystemRights
            }
        }
        if (($granted -band [int]$rights) -ne [int]$rights) { throw 'Browser sandbox permission verification failed' }
    }
}
@{ ok = $true; applicable = $true; repaired = $pending.Count; checked = $targets.Count } | ConvertTo-Json -Compress
