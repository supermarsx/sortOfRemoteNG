# Runner telemetry sampler for the Windows ARM64 full-SDK qualification.
# Detached side process: samples every IntervalSeconds, appends to a local log and
# pushes each sample as a tiny file to the ci-telemetry branch (Contents API) so a
# lost hosted runner still leaves evidence. Never throws into the job; every probe
# and every push is best effort. Reads only metadata (no file handles on job output).
param(
  [Parameter(Mandatory = $true)][string]$LogDir,
  [int]$IntervalSeconds = 300,
  [int]$MaxSamples = 90
)
$ErrorActionPreference = 'Continue'
$null = New-Item -ItemType Directory -Force -Path $LogDir
$log = Join-Path $LogDir 'telemetry.log'
$run = "$($env:GITHUB_RUN_ID)-$($env:GITHUB_RUN_ATTEMPT)"
$repo = $env:GITHUB_REPOSITORY
$started = [DateTimeOffset]::UtcNow
$canPush = ($env:GH_TOKEN -and $repo -and (Get-Command gh -ErrorAction SilentlyContinue))
function Sample([int]$seq) {
  $now = [DateTimeOffset]::UtcNow
  $parts = @("seq=$seq", "utc=$($now.ToString('o'))", "elapsedMin=$([int](($now - $started).TotalMinutes))")
  try {
    foreach ($d in Get-PSDrive -PSProvider FileSystem | Where-Object { $_.Used -ne $null }) {
      $parts += "disk$($d.Name)FreeGB=$([math]::Round($d.Free / 1GB, 1))"
    }
  } catch { $parts += 'diskErr=1' }
  try {
    $os = Get-CimInstance Win32_OperatingSystem
    $parts += "ramFreeMB=$([int]($os.FreePhysicalMemory / 1024))"
    $parts += "ramTotalMB=$([int]($os.TotalVisibleMemorySize / 1024))"
    $parts += "virtFreeMB=$([int]($os.FreeVirtualMemory / 1024))"
  } catch { $parts += 'ramErr=1' }
  try {
    $procs = Get-Process -ErrorAction SilentlyContinue
    $parts += "procCount=$($procs.Count)"
    foreach ($n in 'Runner.Listener', 'Runner.Worker', 'node', 'python', 'siso', 'clang-cl', 'lld-link') {
      $parts += "$($n -replace '[^A-Za-z]', '')=$(@($procs | Where-Object { $_.ProcessName -eq $n }).Count)"
    }
    $top = $procs | Sort-Object WorkingSet64 -Descending | Select-Object -First 3 | ForEach-Object { "$($_.ProcessName):$([int]($_.WorkingSet64 / 1MB))MB" }
    $parts += "topMem=$($top -join '|')"
  } catch { $parts += 'procErr=1' }
  try {
    $lat = @(Get-ChildItem -Path (Join-Path $env:GITHUB_WORKSPACE '.artifacts\windows-arm-full-sdk-*\jobs\*\stdout.log') -ErrorAction SilentlyContinue)
    foreach ($f in $lat) { $parts += "log$($f.Directory.Name)=$($f.Length)@$($f.LastWriteTimeUtc.ToString('HH:mm:ss'))" }
  } catch { }
  return ($parts -join ' ')
}
function Push([string]$text, [int]$seq) {
  if (-not $canPush) { return }
  try {
    $b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($text))
    $path = 'telemetry/winarm/' + $run + '/' + ('{0:D4}' -f $seq) + '.txt'
    $body = @{ message = "telemetry $run #$seq"; content = $b64; branch = 'ci-telemetry' } | ConvertTo-Json -Compress
    $tmp = Join-Path $LogDir 'push.json'
    [IO.File]::WriteAllText($tmp, $body)
    & gh api -X PUT "repos/$repo/contents/$path" --input $tmp *> $null
  } catch { }
}
for ($i = 0; $i -lt $MaxSamples; $i++) {
  $line = Sample $i
  try { Add-Content -Path $log -Value $line } catch { }
  Push $line $i
  Start-Sleep -Seconds $IntervalSeconds
}
