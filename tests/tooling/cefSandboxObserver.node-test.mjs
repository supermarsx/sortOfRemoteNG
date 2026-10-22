import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const root = new URL("../../", import.meta.url);
const files = ["native_tls_acceptance", "native_acceptance"].map(
  (name) =>
    new URL(
      `src-tauri/crates/sorng-browser-host/tests/${name}/observe-windows-sandbox.ps1`,
      root,
    ),
);
function implementation(source) {
  return source.slice(
    source.indexOf("# Read-only"),
    source.indexOf("$observed = @{}"),
  );
}

test("both maintained sandbox observers share the same identity and sampling policy", async () => {
  const sources = await Promise.all(
    files.map((file) => readFile(file, "utf8")),
  );
  assert.equal(implementation(sources[0]), implementation(sources[1]));
  for (const source of sources) {
    assert.match(source, /ParentProcessId -ne \$BrowserProcessId/);
    assert.match(source, /ExecutablePath -ne \$Executable/);
    assert.match(
      source,
      /CreationDate\.ToUniversalTime\(\)\.ToFileTimeUtc\(\)/,
    );
    assert.match(source, /uninspectedExitCount/);
    assert.match(source, /not all renderers or full exploit containment/);
  }
});

test(
  "actual Win32 exit identity and sticky verdicts distinguish exited PID87 from denied5",
  { skip: process.platform !== "win32", timeout: 30000 },
  async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "cef-sandbox-observer-"),
    );
    try {
      const script =
        implementation(await readFile(files[0], "utf8")) +
        String.raw`
$ErrorActionPreference = 'Stop'
function Require($condition, $message) { if (-not $condition) { throw $message } }
function Sample($token, $status='inspected', $errorCode=0, $creation=0L, $exited=$false) {
  $s=[CefTokenSample]::new(); $s.Token=$token; $s.Status=$status; $s.ErrorCode=$errorCode; $s.CreationFileTime=$creation; $s.Exited=$exited; return $s
}
$eventName='Local\CodexSandboxObserver-'+[Guid]::NewGuid().ToString('N')
$gate=[Threading.EventWaitHandle]::new($false,[Threading.EventResetMode]::ManualReset,$eventName)
$start=[Diagnostics.ProcessStartInfo]::new((Get-Command pwsh).Source)
$start.UseShellExecute=$false; $start.CreateNoWindow=$true; $start.WindowStyle=[Diagnostics.ProcessWindowStyle]::Hidden
$start.ArgumentList.Add('-NoProfile'); $start.ArgumentList.Add('-NonInteractive'); $start.ArgumentList.Add('-Command')
$start.ArgumentList.Add("[Threading.EventWaitHandle]::OpenExisting('$eventName').WaitOne(15000) | Out-Null")
$child=[Diagnostics.Process]::Start($start)
$disposed=$false
try {
  $childId=$child.Id
  $candidate=Get-CimInstance Win32_Process -Filter "ProcessId=$childId"
  Require ($null -ne $candidate) 'Owned child missing from CIM'
  $expected=$candidate.CreationDate.ToUniversalTime().ToFileTimeUtc()
  $live=[CefAcceptanceToken]::Inspect($childId,$expected)
  Require ($live.Status -eq 'inspected' -and $live.CreationFileTime -gt 0) 'Live token inspection failed'
  Require (($live.CreationFileTime - ($live.CreationFileTime % 10)) -eq $expected) 'CIM/native creation mismatch'
  $mismatch=[CefAcceptanceToken]::Inspect($childId,($expected+10000000L))
  Require ($mismatch.Status -eq 'identity-mismatch') 'Stale creation was accepted'
  $gate.Set() | Out-Null
  Require ($child.WaitForExit(10000)) 'Owned child did not exit'
  $child.Dispose(); $disposed=$true
  $gone=[CefAcceptanceToken]::Inspect($childId,$expected)
  Require ($gone.Status -eq 'exited-before-inspection' -and $gone.ErrorCode -eq 87 -and $gone.Exited) 'Dead PID did not produce exit87'
  $candidate=[pscustomobject]@{ProcessId=$childId;ParentProcessId=123;CreationDate=$candidate.CreationDate;CommandLine='owned --type=renderer'}
  $good=Sample 'restricted:0' 'inspected' 0 $live.CreationFileTime
  $rows=@{}; $exits=@{}
  Update-CefAcceptanceObservation $rows $exits $candidate $good
  Update-CefAcceptanceObservation $rows $exits $candidate $gone
  Require ((Get-CefAcceptanceVerdict $rows) -and $rows.Count -eq 1 -and $exits.Count -eq 1) 'Proven exit erased good identity evidence'
  $empty=@{}; $onlyExits=@{}
  Update-CefAcceptanceObservation $empty $onlyExits $candidate $gone
  Require (-not (Get-CefAcceptanceVerdict $empty)) 'All-uninspected sampling passed'
  foreach ($bad in @((Sample 'unavailable' 'inspection-failed' 5 $live.CreationFileTime),(Sample 'unrestricted:0' 'inspected' 0 $live.CreationFileTime),(Sample 'restricted:8192' 'inspected' 0 $live.CreationFileTime),(Sample 'unavailable' 'identity-mismatch' 0 $live.CreationFileTime))) {
    $rows=@{}; $exits=@{}
    Update-CefAcceptanceObservation $rows $exits $candidate $good
    Update-CefAcceptanceObservation $rows $exits $candidate $bad
    Update-CefAcceptanceObservation $rows $exits $candidate $good
    Update-CefAcceptanceObservation $rows $exits $candidate $gone
    Require (-not (Get-CefAcceptanceVerdict $rows)) 'A real failure was concealed by later samples'
  }
  $rows=@{}; $exits=@{}; $candidate.CommandLine+=' --no-sandbox'
  Update-CefAcceptanceObservation $rows $exits $candidate $gone
  Update-CefAcceptanceObservation $rows $exits $candidate $good
  Require (-not (Get-CefAcceptanceVerdict $rows)) 'No-sandbox argument was ignored on an exiting process'
  $candidate.CommandLine='owned --type=renderer'; $rows=@{}; $exits=@{}
  Update-CefAcceptanceObservation $rows $exits $candidate $good
  $candidate.CreationDate=$candidate.CreationDate.AddSeconds(1)
  $newFailure=Sample 'unavailable' 'inspection-failed' 5 ($live.CreationFileTime+10000000L)
  Update-CefAcceptanceObservation $rows $exits $candidate $newFailure
  Require ($rows.Count -eq 2 -and -not (Get-CefAcceptanceVerdict $rows)) 'Reused PID inherited old good evidence'
  @{ok=$true;actualLiveInspection=$true;actualExitError=$gone.ErrorCode;nativeCreationFileTime=$live.CreationFileTime;cimCreationFileTime=$expected;denied5Sticky=$true;badTokenSticky=$true;identityMismatchRejected=$true;pidReuseSeparated=$true;allUninspectableRejected=$true;noCef=$true} | ConvertTo-Json -Compress
} finally {
  $gate.Set() | Out-Null
  if (-not $disposed -and -not $child.HasExited) { $child.Kill(); $child.WaitForExit() }
  $child.Dispose(); $gate.Dispose()
}
`;
      const filename = path.join(directory, "proof.ps1");
      await writeFile(filename, script);
      const output = execFileSync(
        "pwsh",
        ["-NoProfile", "-NonInteractive", "-File", filename],
        { encoding: "utf8", windowsHide: true, timeout: 25000 },
      );
      const proof = JSON.parse(output.trim());
      assert.equal(proof.ok, true);
      assert.equal(proof.actualExitError, 87);
      assert.equal(proof.denied5Sticky, true);
      assert.equal(proof.pidReuseSeparated, true);
      console.log(JSON.stringify(proof));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);
