# PowerShell SSH live-test fixture

This fixture provides a deterministic PowerShell 7 SSH endpoint for the
ignored `psrp_ssh_live` integration test. It is a local test service only; its
published username and password must never be reused outside this container.

## Requirements

- Docker with Compose v2
- `ssh-keyscan` and `ssh-keygen` on `PATH`
- PowerShell 7 or Windows PowerShell to run `run-live.ps1`

Run from any directory:

```powershell
./src-tauri/crates/sorng-powershell/tests/fixtures/powershell-ssh/run-live.ps1
```

The runner builds the digest-pinned PowerShell image, waits for SSH health,
derives the fixture's Ed25519 SHA-256 fingerprint, runs the opt-in ignored Rust
test, and tears the container down even if the test fails.

The contract verifies:

- a wrong pinned host key and a wrong subsystem are explicitly rejected;
- the SSH subsystem speaks PowerShell's line-delimited OutOfProcess XML framing;
- one persistent runspace retains variables and working directory state;
- output, error, warning, verbose, debug, information, progress, and terminal
  pipeline-state events are observable through bounded replay;
- cancellation sends an OutOfProcess `Signal`, completes within a deadline,
  and leaves the runspace usable for another command;
- transport close is acknowledged and finishes within a deadline.

Set `PSRP_SSH_TEST_PORT` before running if local TCP port `2223` is unavailable.
