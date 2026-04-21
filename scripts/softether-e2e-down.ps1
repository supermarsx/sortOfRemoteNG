# SE-7: tear down the local SoftEther test server after e2e runs.
#
# By design the e2e test suite does NOT tear down the server (leaves
# it up for dev iteration). Run this when you're done iterating and
# want to free the ports + Docker resources.
#
# Usage:
#   .\scripts\softether-e2e-down.ps1           # preserve volume
#   .\scripts\softether-e2e-down.ps1 -Volumes  # also wipe state volume

param(
    [switch]$Volumes
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$composeFile = 'docs/cedar-reference/docker-compose.softether-test.yml'
if (-not (Test-Path $composeFile)) {
    Write-Error "$composeFile not found"
    exit 1
}

if ($Volumes) {
    Write-Host 'tearing down SoftEther test server + volumes'
    docker compose -f $composeFile down -v
} else {
    Write-Host 'tearing down SoftEther test server (preserving volume)'
    docker compose -f $composeFile down
}
