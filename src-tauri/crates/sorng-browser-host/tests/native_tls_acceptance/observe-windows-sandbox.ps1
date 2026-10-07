param([Parameter(Mandatory=$true)][int]$BrowserProcessId,
      [Parameter(Mandatory=$true)][string]$Executable,
      [Parameter(Mandatory=$true)][string]$Output)
$ErrorActionPreference = 'Stop'
# Read-only token inspection. No privilege adjustment, injection or machine policy changes.
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class CefAcceptanceToken {
  [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  [DllImport("advapi32.dll", SetLastError=true)] static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
  [DllImport("advapi32.dll")] static extern bool IsTokenRestricted(IntPtr token);
  [DllImport("advapi32.dll", SetLastError=true)] static extern bool GetTokenInformation(IntPtr token, int kind, IntPtr buffer, int length, out int needed);
  [DllImport("advapi32.dll")] static extern IntPtr GetSidSubAuthorityCount(IntPtr sid);
  [DllImport("advapi32.dll")] static extern IntPtr GetSidSubAuthority(IntPtr sid, uint index);
  public static string Inspect(int pid) {
    var process=OpenProcess(0x1000,false,pid); if(process==IntPtr.Zero)return "open-process-denied";
    IntPtr token=IntPtr.Zero;
    try {
      if(!OpenProcessToken(process,8,out token))return "open-token-denied";
      int size; GetTokenInformation(token,25,IntPtr.Zero,0,out size);
      var memory=Marshal.AllocHGlobal(size);
      try {
        if(!GetTokenInformation(token,25,memory,size,out size))return "integrity-unavailable";
        var sid=Marshal.ReadIntPtr(memory);
        var count=Marshal.ReadByte(GetSidSubAuthorityCount(sid));
        var integrity=Marshal.ReadInt32(GetSidSubAuthority(sid,(uint)(count-1)));
        return (IsTokenRestricted(token)?"restricted":"unrestricted")+":"+integrity;
      } finally {Marshal.FreeHGlobal(memory);}
    } finally {if(token!=IntPtr.Zero)CloseHandle(token);CloseHandle(process);}
  }
}
'@
$observed = @{}
$processName = [IO.Path]::GetFileName($Executable).Replace("'", "''")
$deadline = [DateTime]::UtcNow.AddSeconds(240)
do {
    $processes = @(Get-CimInstance Win32_Process -Filter "Name='$processName'")
    foreach ($candidate in $processes) {
        if ($candidate.ExecutablePath -ne $Executable) { continue }
        if ($candidate.CommandLine -notmatch '--type=renderer(?:\s|$)') { continue }
        if ($candidate.ParentProcessId -ne $BrowserProcessId) { continue }
        $observed[[string]$candidate.ProcessId] = @{
            pid = $candidate.ProcessId
            parent = $candidate.ParentProcessId
            token = [CefAcceptanceToken]::Inspect($candidate.ProcessId)
            sandboxDisabledArgument = [bool]($candidate.CommandLine -match '--no-sandbox(?:\s|$)')
        }
    }
    if (-not (Get-Process -Id $BrowserProcessId -ErrorAction SilentlyContinue)) { break }
    Start-Sleep -Milliseconds 300
} while ([DateTime]::UtcNow -lt $deadline)
$entries = @($observed.Values)
$passed = $entries.Count -gt 0
foreach ($entry in $entries) {
    if ($entry.sandboxDisabledArgument -or $entry.token -notmatch '^restricted:(\d+)$' -or [int]$Matches[1] -gt 4096) { $passed = $false }
}
@{schema=1; platform='windows'; ok=$passed; renderers=$entries; limitation='Renderer restricted-token and low-integrity observation only; not full exploit containment'} |
    ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $Output -Encoding utf8NoBOM
