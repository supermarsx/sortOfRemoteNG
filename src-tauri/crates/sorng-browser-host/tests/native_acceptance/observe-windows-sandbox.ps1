param([Parameter(Mandatory=$true)][int]$BrowserProcessId,
      [Parameter(Mandatory=$true)][string]$Executable,
      [Parameter(Mandatory=$true)][string]$Output)
$ErrorActionPreference = 'Stop'
# Read-only token inspection. No privilege adjustment, injection or machine policy changes.
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public sealed class CefTokenSample {
  public string Status="inspection-failed", Stage="open-process", Token="unavailable";
  public int ErrorCode;
  public long CreationFileTime;
  public bool Exited;
}
public static class CefAcceptanceToken {
  [DllImport("kernel32.dll",SetLastError=true)] static extern IntPtr OpenProcess(uint access,bool inherit,int pid);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetProcessTimes(IntPtr p,out long c,out long e,out long k,out long u);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetExitCodeProcess(IntPtr p,out uint code);
  [DllImport("advapi32.dll",SetLastError=true)] static extern bool OpenProcessToken(IntPtr p,uint access,out IntPtr token);
  [DllImport("advapi32.dll")] static extern bool IsTokenRestricted(IntPtr token);
  [DllImport("advapi32.dll",SetLastError=true)] static extern bool GetTokenInformation(IntPtr token,int kind,IntPtr buffer,int length,out int needed);
  [DllImport("advapi32.dll")] static extern IntPtr GetSidSubAuthorityCount(IntPtr sid);
  [DllImport("advapi32.dll")] static extern IntPtr GetSidSubAuthority(IntPtr sid,uint index);
  static CefTokenSample Fail(CefTokenSample s,IntPtr p,string stage,int error) {
    s.Stage=stage; s.ErrorCode=error;
    uint code;
    // Genuine access denied remains failure, even if the process later exits.
    if(error!=5 && GetExitCodeProcess(p,out code) && code!=259) {
      s.Status="exited-before-inspection"; s.Exited=true;
    }
    return s;
  }
  public static CefTokenSample Inspect(int pid,long expectedCreation) {
    var s=new CefTokenSample(); var p=OpenProcess(0x1000,false,pid);
    if(p==IntPtr.Zero) {
      s.ErrorCode=Marshal.GetLastWin32Error();
      if(pid>0 && s.ErrorCode==87) {s.Status="exited-before-inspection";s.Exited=true;}
      return s;
    }
    IntPtr token=IntPtr.Zero;
    try {
      long c,e,k,u;
      if(!GetProcessTimes(p,out c,out e,out k,out u)) return Fail(s,p,"process-times",Marshal.GetLastWin32Error());
      s.CreationFileTime=c;
      // CIM truncates FILETIME's 100ns ticks to microseconds. Preserve raw ticks
      // but compare the exact identity precision supplied by Win32_Process.
      if(expectedCreation<=0 || c/10!=expectedCreation/10) {s.Status="identity-mismatch";s.Stage="process-times";return s;}
      uint code;
      if(!GetExitCodeProcess(p,out code)) return Fail(s,p,"exit-code",Marshal.GetLastWin32Error());
      if(code!=259) {s.Status="exited-before-inspection";s.Stage="exit-code";s.Exited=true;return s;}
      if(!OpenProcessToken(p,8,out token)) return Fail(s,p,"open-token",Marshal.GetLastWin32Error());
      int size; GetTokenInformation(token,25,IntPtr.Zero,0,out size);
      if(size<=0 || size>65536) return Fail(s,p,"integrity-size",Marshal.GetLastWin32Error());
      var memory=Marshal.AllocHGlobal(size);
      try {
        if(!GetTokenInformation(token,25,memory,size,out size)) return Fail(s,p,"integrity",Marshal.GetLastWin32Error());
        var sid=Marshal.ReadIntPtr(memory); if(sid==IntPtr.Zero)return s;
        var count=Marshal.ReadByte(GetSidSubAuthorityCount(sid)); if(count==0)return s;
        var integrity=Marshal.ReadInt32(GetSidSubAuthority(sid,(uint)(count-1)));
        s.Token=(IsTokenRestricted(token)?"restricted":"unrestricted")+":"+integrity;
        s.Status="inspected";s.Stage="token";s.ErrorCode=0;return s;
      } finally {Marshal.FreeHGlobal(memory);}
    } finally {if(token!=IntPtr.Zero)CloseHandle(token);CloseHandle(p);}
  }
}
'@
function Update-CefAcceptanceObservation {
    param([hashtable]$Observed, [hashtable]$Exited, $Candidate, $Sample)
    $expected = $Candidate.CreationDate.ToUniversalTime().ToFileTimeUtc()
    $creation = if ($Sample.Status -eq 'identity-mismatch' -or $Sample.CreationFileTime -le 0) { $expected } else { $Sample.CreationFileTime }
    $canonical = [long]($creation - ($creation % 10))
    $key = [string]$Candidate.ProcessId + ':' + [string]$canonical
    $disabled = [bool]($Candidate.CommandLine -match '--no-sandbox(?:\s|$)')
    if ($Sample.Status -eq 'exited-before-inspection' -and $Sample.Exited -and -not $disabled) {
        $Exited[$key] = @{pid=$Candidate.ProcessId; creationFileTime=$creation; stage=$Sample.Stage; errorCode=$Sample.ErrorCode; previouslyVerified=[bool]($Observed.ContainsKey($key) -and -not $Observed[$key].failed)}
        return
    }
    # Actual failures are sticky for this creation identity, including --no-sandbox.
    if ($Observed.ContainsKey($key) -and $Observed[$key].failed) { return }
    $valid = $Sample.Status -eq 'inspected' -and $Sample.Token -match '^restricted:(\d+)$' -and [int]$Matches[1] -le 4096 -and -not $disabled
    $Observed[$key] = @{pid=$Candidate.ProcessId; parent=$Candidate.ParentProcessId; creationFileTime=$creation; token=$Sample.Token; status=$Sample.Status; stage=$Sample.Stage; errorCode=$Sample.ErrorCode; failed=(-not $valid); sandboxDisabledArgument=$disabled}
}
function Get-CefAcceptanceVerdict {
    param([hashtable]$Observed)
    if ($Observed.Count -eq 0) { return $false }
    foreach ($entry in $Observed.Values) { if ($entry.failed) { return $false } }
    return $true
}

$observed = @{}
$exited = @{}
$processName = [IO.Path]::GetFileName($Executable).Replace("'", "''")
$deadline = [DateTime]::UtcNow.AddSeconds(85)
do {
    $processes = @(Get-CimInstance Win32_Process -Filter "Name='$processName'")
    foreach ($candidate in $processes) {
        if ($candidate.ExecutablePath -ne $Executable) { continue }
        if ($candidate.CommandLine -notmatch '--type=renderer(?:\s|$)') { continue }
        if ($candidate.ParentProcessId -ne $BrowserProcessId) { continue }
        if (-not $candidate.CreationDate) { throw 'Renderer creation identity is unavailable' }
        $created = $candidate.CreationDate.ToUniversalTime().ToFileTimeUtc()
        $sample = [CefAcceptanceToken]::Inspect($candidate.ProcessId, $created)
        Update-CefAcceptanceObservation $observed $exited $candidate $sample
    }
    if (-not (Get-Process -Id $BrowserProcessId -ErrorAction SilentlyContinue)) { break }
    Start-Sleep -Milliseconds 300
} while ([DateTime]::UtcNow -lt $deadline)
$entries = @($observed.Values | Sort-Object pid, creationFileTime)
$exitEntries = @($exited.Values | Sort-Object pid, creationFileTime)
@{schema=1; platform='windows'; ok=(Get-CefAcceptanceVerdict $observed); renderers=$entries; exitedBeforeInspection=$exitEntries; uninspectedExitCount=@($exitEntries | Where-Object { -not $_.previouslyVerified }).Count; limitation='Sampled renderer restricted-token and low-integrity observation only; exited-before-inspection processes remain uninspected; not all renderers or full exploit containment'} |
    ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $Output -Encoding utf8NoBOM
