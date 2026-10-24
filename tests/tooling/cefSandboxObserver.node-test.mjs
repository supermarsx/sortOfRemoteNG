import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtemp,
  readFile,
  rm,
  writeFile,
  realpath,
  lstat,
} from "node:fs/promises";
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

let fixture;
const phases = new Set([
  "startup",
  "type-compile",
  "type-ready",
  "type-load",
  "child-create",
  "cim",
  "inspect",
  "child-exit",
  "assertions",
  "complete",
  "failed",
]);
const diagnostics = String.raw`
$clock=[Diagnostics.Stopwatch]::StartNew()
function Phase([string]$name) { [Console]::Error.WriteLine((@{phase=$name;elapsedMs=[long]$clock.ElapsedMilliseconds}|ConvertTo-Json -Compress)) }
Phase 'startup'
$ErrorActionPreference='Stop'
trap { Phase 'failed'; exit 1 }
`;
function runObserved(executable, args, timeout, role) {
  const report = (stderr) => {
    for (const line of String(stderr ?? "")
      .split(/\r?\n/)
      .slice(0, 32)) {
      let row;
      try {
        row = JSON.parse(line);
      } catch {
        continue;
      }
      if (
        Object.keys(row).sort().join() === "elapsedMs,phase" &&
        phases.has(row.phase) &&
        Number.isSafeInteger(row.elapsedMs) &&
        row.elapsedMs >= 0 &&
        row.elapsedMs <= 120000
      )
        console.error(
          JSON.stringify({ role, phase: row.phase, elapsedMs: row.elapsedMs }),
        );
    }
  };
  // Same subprocess deadline, with bounded stderr available on success too.
  const result = spawnSync(executable, args, {
    encoding: "utf8",
    windowsHide: true,
    timeout,
    maxBuffer: 64 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  report(result.stderr);
  if (result.error || result.status !== 0) {
    const reason =
      result.error?.code === "ETIMEDOUT"
        ? "deadline"
        : Number.isInteger(result.status)
          ? "nonzero"
          : "process-error";
    throw new Error(`Sandbox observer ${role}: ${reason}`);
  }
  return result.stdout;
}

test.before(
  async () => {
    if (process.platform !== "win32") return;
    const parent = await realpath(os.tmpdir());
    const directory = await mkdtemp(path.join(parent, "cef-sandbox-observer-"));
    fixture = { directory, parent };
    const source = implementation(await readFile(files[0], "utf8"));
    const end = source.indexOf("\n'@");
    assert.ok(end > 0, "Exact production C# here-string is required");
    const declaration = source.slice(0, end + 3);
    assert.equal(
      (declaration.match(/Add-Type -TypeDefinition @'/g) || []).length,
      1,
    );
    fixture.functions = source.slice(end + 3);
    const filename = path.join(directory, "compile.ps1");
    fixture.assembly = path.join(directory, "observer.dll");
    await writeFile(
      filename,
      diagnostics +
        "\nPhase 'type-compile'\n" +
        declaration.replace(
          "Add-Type -TypeDefinition @'",
          "Add-Type -OutputAssembly $args[0] -TypeDefinition @'",
        ) +
        "\nPhase 'type-ready'\n@{ok=$true;executable=[Diagnostics.Process]::GetCurrentProcess().MainModule.FileName}|ConvertTo-Json -Compress\n",
    );
    const result = JSON.parse(
      runObserved(
        "pwsh",
        ["-NoProfile", "-NonInteractive", "-File", filename, fixture.assembly],
        55000,
        "setup",
      ).trim(),
    );
    assert.equal(result.ok, true);
    assert.ok(path.isAbsolute(result.executable));
    fixture.executable = result.executable;
    fixture.identity = path.join(directory, "child-identity.json");
  },
  { timeout: 60000 },
);

test.after(async () => {
  if (!fixture) return;
  const info = await lstat(fixture.directory);
  assert(info.isDirectory() && !info.isSymbolicLink());
  assert.equal(await realpath(fixture.directory), fixture.directory);
  assert.equal(path.dirname(fixture.directory), fixture.parent);
  await rm(fixture.directory, { recursive: true, force: true });
});

// .NET10 Process.SafeHandle stores a long-lived process handle. GetProcessHandle
// then reuses it for StartTime, Kill and WaitForExit (Process.Windows.cs).
// Keep its reference count elevated through all checks and termination.
const cleanupPolicy = String.raw`
function Stop-OwnedObserverChild($r,[string]$expectedExecutable) {
  $p=$null;$handle=$null;$added=$false
  try {
    try {$p=[Diagnostics.Process]::GetProcessById([int]$r.pid)} catch [ArgumentException] {return 'gone'}
    $handle=$p.SafeHandle
    $handle.DangerousAddRef([ref]$added)
    if($handle.IsInvalid -or $handle.IsClosed){throw 'handle'}
    if($p.HasExited){return 'gone'}
    if($p.StartTime.ToUniversalTime().ToFileTimeUtc().ToString() -ne $r.childCreation){throw 'creation'}
    $c=Get-CimInstance Win32_Process -Filter "ProcessId=$($r.pid)"
    if($null -eq $c -or $c.ParentProcessId -ne $r.parentId -or $c.ExecutablePath -ne $expectedExecutable){throw 'parent'}
    $parent=Get-Process -Id $r.parentId -ErrorAction SilentlyContinue
    try {
      if($null -ne $parent -and $parent.StartTime.ToUniversalTime().ToFileTimeUtc().ToString() -ne $r.parentCreation){throw 'parent'}
    } finally {if($null -ne $parent){$parent.Dispose()}}
    # No Refresh, Close, new Process object or PID-based reopen after admission.
    if($p.HasExited){return 'gone'}
    $p.Kill();if(-not $p.WaitForExit(1000)){throw 'stop'}
    return 'stopped'
  } finally {
    if($added){$handle.DangerousRelease()}
    if($null -ne $p){$p.Dispose()}
  }
}
`;

async function cleanupOwnedChild() {
  let identity;
  try {
    const info = await lstat(fixture.identity);
    assert(info.isFile() && !info.isSymbolicLink() && info.size <= 1024);
    identity = JSON.parse(await readFile(fixture.identity, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return; // Child still has its independent15s exit.
    throw new Error("Sandbox observer cleanup identity unavailable");
  }
  assert.deepEqual(Object.keys(identity).sort(), [
    "childCreation",
    "parentCreation",
    "parentId",
    "pid",
  ]);
  assert.ok(
    Number.isSafeInteger(identity.pid) &&
      identity.pid > 0 &&
      Number.isSafeInteger(identity.parentId) &&
      identity.parentId > 0,
  );
  assert.match(identity.childCreation, /^[0-9]{16,20}$/);
  assert.match(identity.parentCreation, /^[0-9]{16,20}$/);
  const script = path.join(fixture.directory, "cleanup.ps1");
  await writeFile(
    script,
    cleanupPolicy +
      String.raw`
$ErrorActionPreference='Stop'
trap { @{cleanup='denied'}|ConvertTo-Json -Compress; exit 1 }
$r=Get-Content -LiteralPath $args[0] -Raw|ConvertFrom-Json
@{cleanup=(Stop-OwnedObserverChild $r $args[1])}|ConvertTo-Json -Compress
`,
  );
  const result = JSON.parse(
    runObserved(
      fixture.executable,
      [
        "-NoProfile",
        "-NonInteractive",
        "-File",
        script,
        fixture.identity,
        fixture.executable,
      ],
      4000,
      "cleanup",
    ).trim(),
  );
  assert.ok(["gone", "stopped"].includes(result.cleanup));
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
    const directory = fixture.directory;
    let successful = false;
    try {
      const script =
        diagnostics +
        "\nPhase 'type-load'\nAdd-Type -Path $args[0]\n" +
        fixture.functions +
        "\nPhase 'type-ready'\n" +
        String.raw`
$ErrorActionPreference = 'Stop'
function Require($condition, $message) { if (-not $condition) { throw $message } }
function Sample($token, $status='inspected', $errorCode=0, $creation=0L, $exited=$false) {
  $s=[CefTokenSample]::new(); $s.Token=$token; $s.Status=$status; $s.ErrorCode=$errorCode; $s.CreationFileTime=$creation; $s.Exited=$exited; return $s
}
$eventName='Local\CodexSandboxObserver-'+[Guid]::NewGuid().ToString('N')
$gate=[Threading.EventWaitHandle]::new($false,[Threading.EventResetMode]::ManualReset,$eventName)
$start=[Diagnostics.ProcessStartInfo]::new([Diagnostics.Process]::GetCurrentProcess().MainModule.FileName)
$start.UseShellExecute=$false; $start.CreateNoWindow=$true; $start.WindowStyle=[Diagnostics.ProcessWindowStyle]::Hidden
$start.ArgumentList.Add('-NoProfile'); $start.ArgumentList.Add('-NonInteractive'); $start.ArgumentList.Add('-Command')
$start.ArgumentList.Add("[Threading.EventWaitHandle]::OpenExisting('$eventName').WaitOne(15000) | Out-Null")
Phase 'child-create'
$child=[Diagnostics.Process]::Start($start)
$disposed=$false
try {
  $childId=$child.Id
  $identity=@{pid=$childId;parentId=$PID;childCreation=$child.StartTime.ToUniversalTime().ToFileTimeUtc().ToString();parentCreation=[Diagnostics.Process]::GetCurrentProcess().StartTime.ToUniversalTime().ToFileTimeUtc().ToString()}
  $identityFile=[IO.File]::Open($args[1],[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::Read)
  try {$writer=[IO.StreamWriter]::new($identityFile);$writer.Write(($identity|ConvertTo-Json -Compress));$writer.Flush()} finally {$identityFile.Dispose()}
  Phase 'cim'
  $candidate=Get-CimInstance Win32_Process -Filter "ProcessId=$childId"
  Require ($null -ne $candidate) 'Owned child missing from CIM'
  $expected=$candidate.CreationDate.ToUniversalTime().ToFileTimeUtc()
  Phase 'inspect'
  $live=[CefAcceptanceToken]::Inspect($childId,$expected)
  Require ($live.Status -eq 'inspected' -and $live.CreationFileTime -gt 0) 'Live token inspection failed'
  Require (($live.CreationFileTime - ($live.CreationFileTime % 10)) -eq $expected) 'CIM/native creation mismatch'
  $mismatch=[CefAcceptanceToken]::Inspect($childId,($expected+10000000L))
  Require ($mismatch.Status -eq 'identity-mismatch') 'Stale creation was accepted'
  $gate.Set() | Out-Null
  Phase 'child-exit'
  Require ($child.WaitForExit(10000)) 'Owned child did not exit'
  $child.Dispose(); $disposed=$true
  $gone=[CefAcceptanceToken]::Inspect($childId,$expected)
  Phase 'assertions'
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
  Phase 'complete'
  @{ok=$true;actualLiveInspection=$true;actualExitError=$gone.ErrorCode;nativeCreationFileTime=$live.CreationFileTime;cimCreationFileTime=$expected;denied5Sticky=$true;badTokenSticky=$true;identityMismatchRejected=$true;pidReuseSeparated=$true;allUninspectableRejected=$true;noCef=$true} | ConvertTo-Json -Compress
} finally {
  $gate.Set() | Out-Null
  if (-not $disposed -and -not $child.HasExited) { $child.Kill(); $child.WaitForExit(1000) | Out-Null }
  $child.Dispose(); $gate.Dispose()
}
`;
      const filename = path.join(directory, "proof.ps1");
      await writeFile(filename, script);
      const output = runObserved(
        fixture.executable,
        [
          "-NoProfile",
          "-NonInteractive",
          "-File",
          filename,
          fixture.assembly,
          fixture.identity,
        ],
        25000,
        "semantic",
      );
      const proof = JSON.parse(output.trim());
      assert.equal(proof.ok, true);
      assert.equal(proof.actualExitError, 87);
      assert.equal(proof.denied5Sticky, true);
      assert.equal(proof.pidReuseSeparated, true);
      console.log(JSON.stringify(proof));
      successful = true;
    } finally {
      if (!successful) await cleanupOwnedChild();
    }
  },
);

test(
  "actual hidden-child cleanup holds one handle and denies wrong creation or parent before termination",
  { skip: process.platform !== "win32", timeout: 30000 },
  async () => {
    const filename = path.join(fixture.directory, "cleanup-proof.ps1");
    await writeFile(
      filename,
      diagnostics +
        cleanupPolicy +
        String.raw`
function Require($condition) {if(-not $condition){throw 'proof'}}
$eventName='Local\CodexSandboxCleanup-'+[Guid]::NewGuid().ToString('N')
$gate=[Threading.EventWaitHandle]::new($false,[Threading.EventResetMode]::ManualReset,$eventName)
$start=[Diagnostics.ProcessStartInfo]::new([Diagnostics.Process]::GetCurrentProcess().MainModule.FileName)
$start.UseShellExecute=$false;$start.CreateNoWindow=$true;$start.WindowStyle=[Diagnostics.ProcessWindowStyle]::Hidden
$start.ArgumentList.Add('-NoProfile');$start.ArgumentList.Add('-NonInteractive');$start.ArgumentList.Add('-Command')
$start.ArgumentList.Add("[Threading.EventWaitHandle]::OpenExisting('$eventName').WaitOne(15000) | Out-Null")
$child=$null
try {
  Phase 'child-create'
  $child=[Diagnostics.Process]::Start($start)
  $r=@{pid=$child.Id;parentId=$PID;childCreation=$child.StartTime.ToUniversalTime().ToFileTimeUtc().ToString();parentCreation=[Diagnostics.Process]::GetCurrentProcess().StartTime.ToUniversalTime().ToFileTimeUtc().ToString()}
  $bad=$r.Clone();$bad.childCreation=([long]$r.childCreation+10000000L).ToString()
  try {Stop-OwnedObserverChild $bad $start.FileName|Out-Null;throw 'wrong-creation-accepted'} catch {if($_.Exception.Message -ne 'creation'){throw}}
  Require (-not $child.HasExited)
  $bad=$r.Clone();$bad.parentId=$PID+1
  try {Stop-OwnedObserverChild $bad $start.FileName|Out-Null;throw 'wrong-parent-accepted'} catch {if($_.Exception.Message -ne 'parent'){throw}}
  Require (-not $child.HasExited)
  Require ((Stop-OwnedObserverChild $r $start.FileName) -eq 'stopped')
  Require ($child.WaitForExit(1000) -and $child.HasExited)
  Phase 'complete'
  @{wrongCreationDenied=$true;wrongParentDenied=$true;aliveAfterBothDenials=$true;exactIdentityStopped=$true;heldHandlePolicy=$true;childReaped=$true}|ConvertTo-Json -Compress
} finally {
  $gate.Set()|Out-Null
  if($null -ne $child){if(-not $child.HasExited){$child.Kill();$child.WaitForExit(1000)|Out-Null};$child.Dispose()}
  $gate.Dispose()
}
`,
    );
    const proof = JSON.parse(
      runObserved(
        fixture.executable,
        ["-NoProfile", "-NonInteractive", "-File", filename],
        25000,
        "cleanup-proof",
      ).trim(),
    );
    assert.deepEqual(proof, {
      wrongCreationDenied: true,
      wrongParentDenied: true,
      aliveAfterBothDenials: true,
      exactIdentityStopped: true,
      heldHandlePolicy: true,
      childReaped: true,
    });
    console.log(JSON.stringify(proof));
  },
);
