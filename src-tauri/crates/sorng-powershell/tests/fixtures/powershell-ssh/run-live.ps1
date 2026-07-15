$ErrorActionPreference = "Stop"

$fixture = $PSScriptRoot
$crate = (Resolve-Path (Join-Path $fixture "..\..\..")).Path
$port = if ($env:PSRP_SSH_TEST_PORT) { $env:PSRP_SSH_TEST_PORT } else { "2223" }
$compose = Join-Path $fixture "compose.yml"

try {
    docker compose -f $compose up --build --detach --wait
    if ($LASTEXITCODE -ne 0) { throw "PowerShell SSH fixture failed to start." }

    $scan = $null
    for ($attempt = 0; $attempt -lt 30 -and -not $scan; $attempt++) {
        $scan = (& ssh-keyscan -T 2 -t ed25519 -p $port 127.0.0.1 2>$null | Select-Object -First 1)
        if (-not $scan) { Start-Sleep -Milliseconds 500 }
    }
    if (-not $scan) { throw "The fixture did not expose an SSH host key." }

    $keyFile = [IO.Path]::GetTempFileName()
    try {
        [IO.File]::WriteAllText($keyFile, "$scan`n")
        $fingerprintLine = & ssh-keygen -lf $keyFile -E sha256
        if ($LASTEXITCODE -ne 0) { throw "Could not fingerprint the fixture host key." }
        $fingerprint = [regex]::Match($fingerprintLine, "SHA256:[A-Za-z0-9+/]+={0,2}").Value
        if (-not $fingerprint) { throw "Could not parse the fixture host-key fingerprint." }

        $env:PSRP_SSH_TEST_HOST = "127.0.0.1"
        $env:PSRP_SSH_TEST_PORT = $port
        $env:PSRP_SSH_TEST_USER = "psrp"
        $env:PSRP_SSH_TEST_PASSWORD = "PsrpTest!42"
        $env:PSRP_SSH_TEST_FINGERPRINT = $fingerprint

        cargo test --manifest-path (Join-Path $crate "Cargo.toml") --features psrp-ssh-e2e --test psrp_ssh_live -- --ignored --nocapture
        if ($LASTEXITCODE -ne 0) { throw "Live PowerShell-over-SSH test failed." }
    }
    finally {
        Remove-Item -LiteralPath $keyFile -Force -ErrorAction SilentlyContinue
    }
}
finally {
    docker compose -f $compose down --volumes --remove-orphans
}
