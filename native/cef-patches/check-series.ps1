param([Parameter(Mandatory=$true)][string]$Scratch)
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath($Scratch)
$series = Join-Path $PSScriptRoot '154.0.8037.58-682c378'
& (Join-Path $PSScriptRoot 'fetch-sources.ps1') -Destination $root
foreach ($entry in Get-Content (Join-Path $series 'upstream-sha256.json') -Raw | ConvertFrom-Json) {
  $path = Join-Path (Join-Path $root $entry.project) $entry.path
  $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $path).Hash.ToLowerInvariant()
  if ($actual -ne $entry.sha256) { throw "Pinned source digest mismatch: $($entry.project)/$($entry.path)" }
}
foreach ($line in Get-Content (Join-Path $series 'series')) {
  $project, $patch = $line.Split(' ', 2)
  $tree = Join-Path $root $project
  & git -C $tree init -q
  if ($LASTEXITCODE -ne 0) { throw 'git init failed' }
  & git -C $tree -c core.autocrlf=false apply --check --whitespace=error-all (Join-Path $series $patch)
  if ($LASTEXITCODE -ne 0) { throw "Patch check failed: $project" }
  Write-Output "PASS exact-upstream git apply --check: $project"
}
