param([Parameter(Mandatory=$true)][string]$Scratch)
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath($Scratch)
$series = Join-Path $PSScriptRoot '154.0.8037.58-682c378'
& (Join-Path $PSScriptRoot 'fetch-sources.ps1') -Destination $root
foreach ($project in @('chromium', 'cef')) {
  $tree = Join-Path $root $project
  & git -C $tree init -q
  if ($LASTEXITCODE -ne 0) { throw 'git init failed' }
}
# Each pinned digest is the exact baseline of one queued patch that modifies
# that path: upstream bytes, or the bytes left by earlier queued patches. Every
# pin must be reached by some patch in order; a stale pin fails the check.
$pins = @{}
foreach ($entry in Get-Content (Join-Path $series 'upstream-sha256.json') -Raw | ConvertFrom-Json) {
  $pins["$($entry.project)/$($entry.path)"] = $entry.sha256
}
$checked = @{}
foreach ($line in Get-Content (Join-Path $series 'series')) {
  if (-not $line.Trim()) { continue }
  $project, $patch = $line.Split(' ', 2)
  $tree = Join-Path $root $project
  $patchPath = Join-Path $series $patch
  $current = $null
  $isNew = $false
  $modified = @()
  foreach ($patchLine in [IO.File]::ReadAllLines($patchPath)) {
    if ($patchLine.StartsWith('diff --git a/')) {
      if ($current -and -not $isNew) { $modified += $current }
      $current = $patchLine.Substring($patchLine.LastIndexOf(' b/') + 3)
      $isNew = $false
    } elseif ($patchLine.StartsWith('new file mode') -and $current) {
      $isNew = $true
    }
  }
  if ($current -and -not $isNew) { $modified += $current }
  foreach ($relative in $modified) {
    $key = "$project/$relative"
    if (-not $pins.ContainsKey($key) -or $checked.ContainsKey($key)) { continue }
    $file = Join-Path $tree $relative
    if (-not (Test-Path -LiteralPath $file)) { throw "Missing baseline before ${patch}: $key" }
    $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $file).Hash.ToLowerInvariant()
    if ($actual -eq $pins[$key]) { $checked[$key] = $true }
  }
  & git -C $tree -c core.autocrlf=false apply --check --whitespace=error-all $patchPath
  if ($LASTEXITCODE -ne 0) { throw "Patch check failed: $patch" }
  & git -C $tree -c core.autocrlf=false apply --whitespace=error-all $patchPath
  if ($LASTEXITCODE -ne 0) { throw "Patch apply failed: $patch" }
  Write-Output "PASS in-order git apply: $project $patch"
}
foreach ($key in $pins.Keys) {
  if (-not $checked.ContainsKey($key)) { throw "Pinned baseline digest was never reached: $key" }
}
Write-Output "PASS pinned baseline digests: $($checked.Count)"
# The canonical ABI/policy copies must equal the engine files after the series.
foreach ($pair in @(
    @('cef_sorng_tls_bridge.h', 'cef/include/cef_sorng_tls_bridge.h'),
    @('registration_policy.h', 'cef/libcef/browser/net_service/sorng_tls_registration_policy.h'),
    @('sorng_tls_policy.h', 'chromium/net/socket/sorng_tls_policy.h'))) {
  $canonical = [IO.File]::ReadAllText((Join-Path $PSScriptRoot $pair[0])).Replace("`r`n", "`n")
  $engine = [IO.File]::ReadAllText((Join-Path $root $pair[1])).Replace("`r`n", "`n")
  if ($canonical -ne $engine) { throw "Canonical and engine copy differ: $($pair[0])" }
}
Write-Output 'PASS canonical headers equal engine copies'
